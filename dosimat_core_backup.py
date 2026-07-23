# dosimat_core.py - Núcleo funcional y máquina de estados del dosificador
import machine
import time
import uasyncio as asyncio
import config_manager
import sys_log
import led_manager

# Configuración de relés (Activos en Alto)
VALVULA_PIN = 25  # Válvula / Motor dosificador
BOMBA_PIN = 23    # Bomba de filtrado

valvula = None
bomba = None

# Cola de transmisión global (para enviar hacia BLE/MQTT)
class AsyncQueue:
    def __init__(self):
        self._queue = []
        self._event = asyncio.Event()

    async def put(self, item):
        self._queue.append(item)
        self._event.set()

    async def get(self):
        while not self._queue:
            self._event.clear()
            await self._event.wait()
        return self._queue.pop(0)

tx_queue = AsyncQueue()

# Estados del equipo
estado_dosimat = "RESET" # IDLE, FILTRO, DOSIS, PAUSA, ANTI, RESET
tiempo_restante = 0
refuerzo_activo = False

# Variables de control del ciclo
ciclo_suspendido = False
tiempo_acumulado_fase = 0
fase_actual_interrumpida = None  # Para restaurar tras pausa
abort_event = asyncio.Event()
config_ref = {}

# Identificador único de chip
chip_id = "".join(f"{b:02x}" for b in machine.unique_id()).upper()
temp_cronograma = []
rtc_hw = None

def init_hardware():
    global valvula, bomba, estado_dosimat, rtc_hw
    try:
        valvula = machine.Pin(VALVULA_PIN, machine.Pin.OUT, value=0)
        bomba = machine.Pin(BOMBA_PIN, machine.Pin.OUT, value=0)
        
        # Inicializar SoftI2C según mapeo de hardware (SDA=21, SCL=22)
        try:
            i2c = machine.SoftI2C(scl=machine.Pin(22), sda=machine.Pin(21))
            print("[CORE] SoftI2C inicializado en SDA=21, SCL=22.")
            
            # Buscar el chip DS3231 en el bus I2C (dirección por defecto 0x68)
            if 0x68 in i2c.scan():
                from ds3231 import DS3231
                rtc_hw = DS3231(i2c)
                tiempo_guardado = rtc_hw.get_time()
                if tiempo_guardado:
                    # Inyectar el tiempo leído del DS3231 al RTC interno del ESP32
                    machine.RTC().datetime(tiempo_guardado)
                    print("[CORE] Hora del sistema inicializada desde DS3231 física:", tiempo_guardado)
            else:
                print("[CORE] No se detectó el chip DS3231 en la dirección 0x68.")
        except Exception as e:
            print("[CORE] Error al inicializar SoftI2C o leer DS3231:", e)
            
        estado_dosimat = "IDLE"
        print("[CORE] Hardware de potencia inicializado (Apagado).")
    except Exception as e:
        print("[CORE] Error al inicializar relés:", e)

def set_relays(bomba_on, valvula_on):
    """Control físico seguro de las salidas de relé"""
    if bomba:
        bomba.value(1 if bomba_on else 0)
    if valvula:
        valvula.value(1 if valvula_on else 0)

def es_temporada_alta():
    """Determina si la fecha actual está en temporada alta según configuración local"""
    try:
        t = time.localtime()
        # MM-DD
        current_md = f"{t[1]:02d}-{t[2]:02d}"
        ini = config_ref.get("temporada_alta_inicio", "11-01")
        fin = config_ref.get("temporada_alta_fin", "03-31")
        
        if ini <= fin:
            return ini <= current_md <= fin
        else:
            # Cruza de año (ej: 11-01 a 03-31)
            return current_md >= ini or current_md <= fin
    except Exception as e:
        print("[CORE] Error al verificar temporada, asumiendo Alta por seguridad:", e)
        return True

async def enviar_telemetria():
    """Encola el estado actual abreviado para transmisión remota"""
    global estado_dosimat, tiempo_restante, refuerzo_activo
    payload = {
        "est": estado_dosimat,
        "tr": tiempo_restante,
        "ref": 1 if refuerzo_activo else 0,
        "v": config_ref.get("config_version", 1),
        "temporada": "Alta" if es_temporada_alta() else "Baja"
    }
    try:
        if rtc_hw:
            t = rtc_hw.get_time()
            if t:
                payload["rtc_fecha"] = f"{t[0]}-{t[1]:02d}-{t[2]:02d}"
                payload["rtc_hora"] = f"{t[4]:02d}:{t[5]:02d}"
            temp = rtc_hw.get_temperature()
            if temp is not None:
                payload["temp"] = temp
    except Exception as e:
        print("[CORE] Error al obtener datos RTC para telemetría:", e)
    await tx_queue.put({
        "tipo": "TELEMETRIA",
        "data": payload
    })

async def procesar_comando(cmd_dict):
    """Procesador de comandos recibidos vía BLE o MQTT"""
    global estado_dosimat, tiempo_restante, refuerzo_activo
    global ciclo_suspendido, fase_actual_interrumpida, tiempo_acumulado_fase
    
    cmd = cmd_dict.get("comando")
    origen = cmd_dict.get("_origen", "ALL")
    print(f"[CORE] Comando recibido [{origen}]: {cmd}")
    
    if cmd == "GET_STATE":
        await enviar_telemetria()
        
    elif cmd == "GET_CONFIG":
        # Retornar configuración local omitiendo credenciales WiFi sensibles
        cfg = config_ref.copy()
        await tx_queue.put({
            "tipo": "CONFIG",
            "data": cfg,
            "_destino": origen
        })
        
    elif cmd == "UPDATE_CONFIG":
        nueva_cfg = cmd_dict.get("config", {})
        version_recibida = nueva_cfg.get("config_version", 0)
        version_local = config_ref.get("config_version", 0)
        
        if version_recibida > version_local:
            print(f"[CORE] Actualizando configuración a versión {version_recibida}")
            await config_manager.guardar_configuracion(nueva_cfg)
            config_ref.update(nueva_cfg)
            await tx_queue.put({"tipo": "ACK_CFG", "v": version_recibida, "_destino": origen})
            await sys_log.log_event({"tipo": "info", "msg": f"Config actualizada v{version_recibida}"})
        else:
            print("[CORE] Configuración recibida obsoleta. Enviando versión local.")
            await procesar_comando({"comando": "GET_CONFIG", "_origen": origen})
            
    elif cmd == "START_CYCLE":
        # Iniciar ciclo de dosificación manualmente
        if estado_dosimat in ("IDLE", "PAUSA"):
            refuerzo_activo = bool(cmd_dict.get("refuerzo", False))
            ciclo_suspendido = False
            abort_event.set()
            print(f"[CORE] Ciclo iniciado manualmente. Refuerzo: {refuerzo_activo}")
            await sys_log.log_event({"tipo": "ciclo_manual", "refuerzo": refuerzo_activo})
            
    elif cmd == "PAUSE_CYCLE":
        # Pausar ciclo actual
        if estado_dosimat in ("FILTRO", "DOSIS", "ANTI") and not ciclo_suspendido:
            ciclo_suspendido = True
            fase_actual_interrumpida = estado_dosimat
            tiempo_acumulado_fase = tiempo_restante
            estado_dosimat = "PAUSA"
            set_relays(bomba_on=False, valvula_on=False)
            led_manager.actualizar_patron(estado_dosimat, False, False, refuerzo_activo)
            abort_event.set()
            await sys_log.log_event({"tipo": "pausa"})
            await enviar_telemetria()
            
    elif cmd == "RESUME_CYCLE":
        # Reanudar ciclo pausado
        if estado_dosimat == "PAUSA" and ciclo_suspendido:
            ciclo_suspendido = False
            abort_event.set()
            await sys_log.log_event({"tipo": "reanudar"})
            
    elif cmd == "CANCEL_CYCLE":
        # Cancelar ciclo actual por completo
        if estado_dosimat != "IDLE":
            ciclo_suspendido = False
            fase_actual_interrumpida = None
            estado_dosimat = "IDLE"
            set_relays(bomba_on=False, valvula_on=False)
            led_manager.actualizar_patron(estado_dosimat, False, False, refuerzo_activo)
            abort_event.set()
            await sys_log.log_event({"tipo": "cancelar"})
            await enviar_telemetria()
            
    elif cmd == "RUN_ANTI":
        # Forzar un ciclo de antiatasco de 10 segundos
        if estado_dosimat in ("IDLE", "PAUSA"):
            ciclo_suspendido = False
            fase_actual_interrumpida = estado_dosimat
            estado_dosimat = "ANTI"
            abort_event.set()
            
    elif cmd == "config_wifi":
        ssid = cmd_dict.get("ssid")
        password = cmd_dict.get("pass")
        if ssid:
            await config_manager.guardar_wifi_config(ssid, password)
            await sys_log.log_event({"tipo": "info", "msg": "Nuevas credenciales WiFi registradas"})
            await tx_queue.put({
                "tipo": "ACK_WIFI",
                "ssid": ssid,
                "_destino": origen
            })

    elif cmd == "sync_rtc":
        fecha_str = cmd_dict.get("fecha")
        hora_str = cmd_dict.get("hora")
        if fecha_str and hora_str:
            try:
                parts_f = [int(x) for x in fecha_str.split("-")] # [Y, M, D]
                parts_h = [int(x) for x in hora_str.split(":")] # [H, M]
                import machine
                rtc = machine.RTC()
                
                # Seteamos el RTC interno del ESP32
                t_tuple = (parts_f[0], parts_f[1], parts_f[2], 0, parts_h[0], parts_h[1], 0, 0)
                rtc.datetime(t_tuple)
                
                # Si la placa DS3231 está activa, sincronizarla también para persistencia
                if rtc_hw:
                    rtc_hw.save_time((parts_f[0], parts_f[1], parts_f[2], 0, parts_h[0], parts_h[1], 0))
                    print("[CORE] DS3231 sincronizado por Bluetooth.")
                
                await sys_log.log_event({"tipo": "info", "msg": f"RTC sincronizado por BLE: {fecha_str} {hora_str}"})
                await tx_queue.put({
                    "tipo": "ACK_RTC",
                    "status": "OK",
                    "_destino": origen
                })
            except Exception as e:
                print("[CORE] Error al sincronizar RTC por BLE:", e)

    elif cmd == "config_cronograma":
        cron = cmd_dict.get("cronograma", [])
        await config_manager.guardar_configuracion({"cronograma": cron})
        await sys_log.log_event({"tipo": "info", "msg": "Cronograma actualizado"})
        await tx_queue.put({
            "tipo": "ACK_CRON",
            "status": "OK",
            "_destino": origen
        })

    elif cmd == "cron_start":
        global temp_cronograma
        temp_cronograma = []
        await tx_queue.put({"tipo": "ACK_CRON_START", "_destino": origen})

    elif cmd == "cron_add":
        global temp_cronograma
        idx = cmd_dict.get("idx")
        on_time = cmd_dict.get("on")
        dur = cmd_dict.get("duracion")
        dosis = cmd_dict.get("dosis")
        dias = cmd_dict.get("dias")
        temp_cronograma.append({
            "on": on_time,
            "duracion": dur,
            "dosis": dosis,
            "dias": dias
        })
        await tx_queue.put({"tipo": "ACK_CRON_ADD", "idx": idx, "_destino": origen})

    elif cmd == "cron_commit":
        global temp_cronograma
        await config_manager.guardar_configuracion({"cronograma": temp_cronograma})
        await sys_log.log_event({"tipo": "info", "msg": "Cronograma actualizado por BLE"})
        temp_cronograma = []
        await tx_queue.put({"tipo": "ACK_CRON", "status": "OK", "_destino": origen})
            
    elif cmd == "GET_LOGS":
        try:
            logs = await sys_log.get_logs(incluir_ram=True)
            print(f"[CORE] Obtenidos {len(logs)} logs para enviar.")
            for item in logs:
                await tx_queue.put({
                    "tipo": "LOG_ENTRY",
                    "data": item,
                    "_destino": origen
                })
                await asyncio.sleep_ms(300)
            await tx_queue.put({
                "tipo": "LOGS_END",
                "_destino": origen
            })
        except Exception as e:
            print("[CORE] Error en GET_LOGS:", e)
            
    elif cmd == "CLEAR_LOGS":
        try:
            await sys_log.limpiar_historial()
            await tx_queue.put({
                "tipo": "ACK_CLEAR_LOGS",
                "_destino": origen
            })
        except Exception as e:
            print("[CORE] Error en CLEAR_LOGS:", e)
            
    elif cmd == "FACTORY_RESET":
        await sys_log.log_event({"tipo": "alerta", "msg": "Factory Reset recibido"})
        # Borrar configuración de WiFi y dosificador
        try:
            os.remove(config_manager.CONFIG_FILE)
            os.remove(config_manager.WIFI_CONFIG_FILE)
        except OSError:
            pass
        await sys_log.limpiar_historial()
        await tx_queue.put({"tipo": "ACK", "status": "RESETTING", "_destino": origen})
        await asyncio.sleep(1)
        import machine
        machine.reset()

async def dispenser_loop():
    """Bucle asíncrono principal que gestiona los tiempos y la máquina de estados del dosificador"""
    global estado_dosimat, tiempo_restante, refuerzo_activo
    global ciclo_suspendido, fase_actual_interrumpida, tiempo_acumulado_fase
    global config_ref
    
    init_hardware()
    config_ref = await config_manager.cargar_configuracion()
    
    # Prevenir que inicie encendido
    set_relays(bomba_on=False, valvula_on=False)
    
    print("[CORE] Bucle del dosificador iniciado.")
    
    while True:
        abort_event.clear()
        
        # ----------------------------------------------------
        # 1. ESTADO: IDLE (En Espera)
        # ----------------------------------------------------
        if estado_dosimat == "IDLE":
            tiempo_restante = config_ref.get("tespera_seg", 3600)
            print(f"[CORE] Entrando en IDLE. Esperando {tiempo_restante}s...")
            await sys_log.log_event({"tipo": "estado_idle", "espera": tiempo_restante})
            await enviar_telemetria()
            
            # Dormir de forma reactiva al comando START_CYCLE
            while tiempo_restante > 0:
                # Comprobar eventos cada segundo
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    # Si se despertó por evento, evaluar si el estado cambió a START_CYCLE u otro
                    if estado_dosimat != "IDLE":
                        break
                    # En caso contrario, se fuerza ciclo manual
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            if estado_dosimat == "IDLE":
                # Si completó el tiempo de espera, inicia el ciclo normal
                estado_dosimat = "FILTRO"
                fase_actual_interrumpida = None
                
        # ----------------------------------------------------
        # 2. ESTADO: FILTRO (Filtrando - Pre o Post Dosis)
        # ----------------------------------------------------
        elif estado_dosimat == "FILTRO":
            # Si venimos de una pausa, restauramos el tiempo restante
            if fase_actual_interrumpida == "FILTRO" and tiempo_acumulado_fase > 0:
                tiempo_restante = tiempo_acumulado_fase
                fase_actual_interrumpida = None
                tiempo_acumulado_fase = 0
                print(f"[CORE] Reanudando FILTRO. Tiempo restante: {tiempo_restante}s")
            else:
                # Filtrado inicial de estabilización (15 segundos)
                tiempo_restante = 15
                print(f"[CORE] Iniciando FILTRO (Pre-dosificación). Tiempo: {tiempo_restante}s")
                await sys_log.log_event({"tipo": "estado_filtro"})
                
            set_relays(bomba_on=True, valvula_on=False)
            await enviar_telemetria()
            
            while tiempo_restante > 0:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    # Evaluar si fue pausado o cancelado
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            # Si terminó exitosamente la fase y no fue interrumpido por comandos
            if estado_dosimat == "FILTRO":
                # Si fue pre-dosificación, pasamos a DOSIS. Si fue post-dosificación, regresamos a IDLE
                if valvula and valvula.value() == 0 and fase_actual_interrumpida is None:
                    # Veníamos de pre-filtración, vamos a DOSIS
                    estado_dosimat = "DOSIS"
                else:
                    # Veníamos de post-filtración, apagamos bomba y volvemos a IDLE
                    set_relays(bomba_on=False, valvula_on=False)
                    estado_dosimat = "IDLE"
                    
        # ----------------------------------------------------
        # 3. ESTADO: DOSIS (Dosificando Cloro)
        # ----------------------------------------------------
        elif estado_dosimat == "DOSIS":
            if fase_actual_interrumpida == "DOSIS" and tiempo_acumulado_fase > 0:
                tiempo_restante = tiempo_acumulado_fase
                fase_actual_interrumpida = None
                tiempo_acumulado_fase = 0
                print(f"[CORE] Reanudando DOSIS. Tiempo restante: {tiempo_restante}s")
            else:
                # Calcular tiempo base
                base_time = config_ref.get("tdosis_seg", 300)
                
                # Ajuste por temporada baja si aplica (y refuerzo no está activo)
                if not es_temporada_alta() and not refuerzo_activo:
                    porcentaje_baja = config_ref.get("ajuste_baja", 10)
                    tiempo_restante = int(base_time * (porcentaje_baja / 100.0))
                    print(f"[CORE] Temporada Baja. Tiempo ajustado al {porcentaje_baja}%: {tiempo_restante}s")
                else:
                    tiempo_restante = base_time
                    print(f"[CORE] Temporada Alta o Modo Refuerzo. Tiempo completo: {tiempo_restante}s")
                    
                await sys_log.log_event({"tipo": "estado_dosis", "duracion": tiempo_restante, "refuerzo": refuerzo_activo})
                
            # Activar bomba y válvula dosificadora
            set_relays(bomba_on=True, valvula_on=True)
            await enviar_telemetria()
            
            while tiempo_restante > 0:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    # Interrupción por comando
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            if estado_dosimat == "DOSIS":
                # Fin de dosificación. Apagar dosificador pero dejar bomba para post-filtrado
                set_relays(bomba_on=True, valvula_on=False)
                # Transicionamos a FILTRO (para 15s de post-filtrado y lavado de conductos)
                estado_dosimat = "FILTRO"
                # Limpiar flag de refuerzo al finalizar el ciclo
                refuerzo_activo = False
                
        # ----------------------------------------------------
        # 4. ESTADO: PAUSA (Ciclo suspendido)
        # ----------------------------------------------------
        elif estado_dosimat == "PAUSA":
            print(f"[CORE] Sistema en PAUSA. Esperando reanudación o cancelación...")
            # Relés apagados
            set_relays(bomba_on=False, valvula_on=False)
            await enviar_telemetria()
            
            # Esperar reactivación reactiva
            await abort_event.wait()
            
            if estado_dosimat == "PAUSA":
                # Si abort_event fue seteado pero seguimos en estado PAUSA, significa RESUME_CYCLE
                estado_dosimat = fase_actual_interrumpida if fase_actual_interrumpida else "IDLE"
                print(f"[CORE] Reanudando ciclo hacia estado: {estado_dosimat}")
                
        # ----------------------------------------------------
        # 5. ESTADO: ANTI (Secuencia Antiatasco / Liberar Válvula)
        # ----------------------------------------------------
        elif estado_dosimat == "ANTI":
            print("[CORE] Iniciando secuencia antiatasco (Pulsos de válvula)...")
            await sys_log.log_event({"tipo": "estado_anti"})
            
            # Ejecutar 5 ciclos de 2 segundos (1s ON, 1s OFF)
            tiempo_restante = 10
            await enviar_telemetria()
            
            for pulso in range(5):
                if estado_dosimat != "ANTI" or abort_event.is_set():
                    break
                # Pulso ON
                set_relays(bomba_on=False, valvula_on=True)
                await asyncio.sleep(1)
                # Pulso OFF
                set_relays(bomba_on=False, valvula_on=False)
                await asyncio.sleep(1)
                tiempo_restante -= 2
                
            if estado_dosimat == "ANTI":
                # Regresar al estado previo interrumpido o a IDLE
                estado_dosimat = fase_actual_interrumpida if fase_actual_interrumpida in ("IDLE", "PAUSA") else "IDLE"
                fase_actual_interrumpida = None
                print(f"[CORE] Secuencia antiatasco terminada. Regresando a {estado_dosimat}")
                
        # ----------------------------------------------------
        # 6. ESTADO: RESET (Reinicio de Hardware)
        # ----------------------------------------------------
        elif estado_dosimat == "RESET":
            print("[CORE] Estado RESET activo. Limpiando salidas físicas...")
            set_relays(bomba_on=False, valvula_on=False)
            estado_dosimat = "IDLE"
            await asyncio.sleep(1)
