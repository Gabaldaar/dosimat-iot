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
estado_dosimat = "RESET" # IDLE, FILTRO_PRE, DOSIS, FILTRO_POST, PAUSA, ANTI, RESET
tiempo_restante = 0
refuerzo_activo = False
dosis_anuladas = 0

# Variables de control del ciclo
ciclo_suspendido = False
tiempo_acumulado_fase = 0
fase_actual_interrumpida = None
abort_event = asyncio.Event()
config_ref = {}

modo_ciclo = "AUTO" # "AUTO" o "MANUAL"
tfiltro_restante = 0 # Para continuar el filtrado post-dosis
ultima_dosis_ts = time.time()
ultimo_minuto_procesado = -1

chip_id = "".join(f"{b:02x}" for b in machine.unique_id()).upper()
temp_cronograma = []
rtc_hw = None

def init_hardware():
    global valvula, bomba, estado_dosimat, rtc_hw
    try:
        valvula = machine.Pin(VALVULA_PIN, machine.Pin.OUT, value=0)
        bomba = machine.Pin(BOMBA_PIN, machine.Pin.OUT, value=0)
        try:
            i2c = machine.SoftI2C(scl=machine.Pin(22), sda=machine.Pin(21))
            if 0x68 in i2c.scan():
                from ds3231 import DS3231
                rtc_hw = DS3231(i2c)
                tiempo_guardado = rtc_hw.get_time()
                if tiempo_guardado:
                    machine.RTC().datetime(tiempo_guardado)
        except Exception:
            pass
            
        estado_dosimat = "IDLE"
    except Exception as e:
        print("[CORE] Error al inicializar relés:", e)

def set_relays(bomba_on, valvula_on):
    if bomba: bomba.value(1 if bomba_on else 0)
    if valvula: valvula.value(1 if valvula_on else 0)

def es_temporada_alta():
    try:
        t = time.localtime()
        current_md = f"{t[1]:02d}-{t[2]:02d}"
        ini = config_ref.get("temporada_alta_inicio", "11-01")
        fin = config_ref.get("temporada_alta_fin", "03-31")
        if ini <= fin: return ini <= current_md <= fin
        else: return current_md >= ini or current_md <= fin
    except Exception:
        return True

async def enviar_telemetria():
    """Encola el estado actual abreviado para transmisión remota"""
    global estado_dosimat, tiempo_restante, refuerzo_activo, dosis_anuladas
    payload = {
        "est": "FILTRO" if estado_dosimat in ("FILTRO_PRE", "FILTRO_POST") else estado_dosimat,
        "fase_real": estado_dosimat,
        "modo": modo_ciclo,
        "tr": tiempo_restante,
        "ref": 1 if refuerzo_activo else 0,
        "anuladas": dosis_anuladas,
        "v": config_ref.get("config_version", 1),
        "temporada": "Alta" if es_temporada_alta() else "Baja",
        "temp_comp": 1 if config_ref.get("temp_comp_activa", False) else 0,
        "temp_offset": float(config_ref.get("temp_offset", 0.0)),
        "ult_ref_ts": int(config_ref.get("ultimo_refuerzo_temp_ts", 0))
    }
    try:
        if rtc_hw:
            t = rtc_hw.get_time()
            if t:
                payload["rtc_fecha"] = f"{t[0]}-{t[1]:02d}-{t[2]:02d}"
                payload["rtc_hora"] = f"{t[4]:02d}:{t[5]:02d}"
            temp = rtc_hw.get_temperature()
            if temp is not None:
                offset = float(config_ref.get("temp_offset", 0.0))
                payload["temp"] = temp + offset
    except Exception: pass
    await tx_queue.put({"tipo": "TELEMETRIA", "data": payload})

async def procesar_comando(cmd_dict):
    global estado_dosimat, tiempo_restante, refuerzo_activo, dosis_anuladas, ultima_dosis_ts
    global ciclo_suspendido, fase_actual_interrumpida, tiempo_acumulado_fase, modo_ciclo, tfiltro_restante
    
    cmd = cmd_dict.get("comando")
    origen = cmd_dict.get("_origen", "ALL")
    
    if cmd == "GET_STATE":
        await enviar_telemetria()
        
    elif cmd == "GET_CONFIG":
        await tx_queue.put({"tipo": "CONFIG", "data": config_ref.copy(), "_destino": origen})
        
    elif cmd == "UPDATE_CONFIG":
        nueva_cfg = cmd_dict.get("config", {})
        version_recibida = nueva_cfg.get("config_version", 0)
        version_local = config_ref.get("config_version", 0)
        if version_recibida > version_local:
            await config_manager.guardar_configuracion(nueva_cfg)
            config_ref.update(nueva_cfg)
            await tx_queue.put({"tipo": "ACK_CFG", "v": version_recibida, "_destino": origen})
            await sys_log.log_event({"tipo": "info", "msg": f"Config actualizada v{version_recibida}"})
        else:
            await procesar_comando({"comando": "GET_CONFIG", "_origen": origen})
            
    elif cmd == "START_CYCLE":
        if estado_dosimat in ("IDLE", "PAUSA"):
            modo_ciclo = "MANUAL"
            estado_dosimat = "FILTRO_PRE"
            ciclo_suspendido = False
            fase_actual_interrumpida = None
            abort_event.set()
            await enviar_telemetria()
            
    elif cmd == "START_PUMP":
        if estado_dosimat in ("IDLE", "PAUSA"):
            modo_ciclo = "MANUAL"
            estado_dosimat = "FILTRO_MANUAL"
            ciclo_suspendido = False
            fase_actual_interrumpida = None
            abort_event.set()
            await enviar_telemetria()
            
    elif cmd == "SET_REFUERZO":
        val = bool(cmd_dict.get("refuerzo", False))
        refuerzo_activo = val
        config_ref["refuerzo_activo"] = val
        await config_manager.guardar_configuracion(config_ref)
        await enviar_telemetria()
        
    elif cmd == "SET_VALVE_MANUAL":
        val = bool(cmd_dict.get("estado", False))
        if valvula:
            valvula.value(1 if val else 0)
        
    elif cmd == "SET_ANULADAS":
        val = cmd_dict.get("valor", cmd_dict.get("anuladas", 0))
        dosis_anuladas = int(val)
        config_ref["dosis_anuladas"] = dosis_anuladas
        await config_manager.guardar_configuracion(config_ref)
        await enviar_telemetria()

    elif cmd == "SET_TEMP_COMP":
        val = bool(cmd_dict.get("temp_comp", False))
        config_ref["temp_comp_activa"] = val
        temp_offset = cmd_dict.get("temp_offset")
        if temp_offset is not None:
            config_ref["temp_offset"] = float(temp_offset)
        await config_manager.guardar_configuracion(config_ref)
        await enviar_telemetria()

    elif cmd == "PAUSE_CYCLE":
        if estado_dosimat != "PAUSA":
            if estado_dosimat in ("FILTRO_PRE", "DOSIS", "FILTRO_POST", "FILTRO_MANUAL", "FILTRO"):
                tiempo_acumulado_fase = tiempo_restante
            else:
                tiempo_acumulado_fase = 0
                
            fase_actual_interrumpida = estado_dosimat
            estado_dosimat = "PAUSA"
            config_ref["estado_pausa"] = True
            await config_manager.guardar_configuracion(config_ref)
            set_relays(False, False)
            led_manager.actualizar_patron(estado_dosimat, False, False, refuerzo_activo)
            abort_event.set()
            await sys_log.log_event({"msg": "Inicio de Pausa/Mantenimiento"})
            await enviar_telemetria()
            
    elif cmd == "RESUME_CYCLE":
        if estado_dosimat == "PAUSA":
            ciclo_suspendido = False
            config_ref["estado_pausa"] = False
            await config_manager.guardar_configuracion(config_ref)
            abort_event.set()
            await sys_log.log_event({"msg": "Fin de Pausa/Mantenimiento"})
            await enviar_telemetria()
            
    elif cmd == "CANCEL_CYCLE":
        if estado_dosimat != "IDLE":
            ciclo_suspendido = False
            fase_actual_interrumpida = None
            estado_dosimat = "IDLE"
            config_ref["estado_pausa"] = False
            await config_manager.guardar_configuracion(config_ref)
            set_relays(False, False)
            led_manager.actualizar_patron(estado_dosimat, False, False, refuerzo_activo)
            abort_event.set()
            await enviar_telemetria()
            
    elif cmd == "RUN_ANTI":
        if estado_dosimat in ("IDLE", "PAUSA"):
            ciclo_suspendido = False
            fase_actual_interrumpida = estado_dosimat
            estado_dosimat = "ANTI"
            abort_event.set()
            
    elif cmd in ("config_wifi", "SET_WIFI"):
        ssid = cmd_dict.get("ssid")
        password = cmd_dict.get("pass") or cmd_dict.get("pwd")
        if ssid:
            await config_manager.guardar_wifi_config(ssid, password)
            await tx_queue.put({"tipo": "ACK_WIFI", "ssid": ssid, "_destino": origen})
            async def reboot_after_delay():
                await asyncio.sleep(2)
                import machine
                machine.reset()
            asyncio.create_task(reboot_after_delay())

    elif cmd == "sync_rtc":
        fecha_str = cmd_dict.get("fecha")
        hora_str = cmd_dict.get("hora")
        if fecha_str and hora_str:
            try:
                parts_f = [int(x) for x in fecha_str.split("-")]
                parts_h = [int(x) for x in hora_str.split(":")]
                import machine
                rtc = machine.RTC()
                t_epoch = time.mktime((parts_f[0], parts_f[1], parts_f[2], parts_h[0], parts_h[1], 0, 0, 0))
                t_correct = time.localtime(t_epoch)
                correct_wday = t_correct[6]
                
                t_tuple = (parts_f[0], parts_f[1], parts_f[2], correct_wday, parts_h[0], parts_h[1], 0, 0)
                rtc.datetime(t_tuple)
                if rtc_hw: rtc_hw.save_time((parts_f[0], parts_f[1], parts_f[2], correct_wday, parts_h[0], parts_h[1], 0))
                await tx_queue.put({"tipo": "ACK_RTC", "status": "OK", "_destino": origen})
            except Exception: pass

    elif cmd in ("SET_CONFIG", "config_params"):
        tespera_seg = cmd_dict.get("tespera_seg")
        tdosis_seg = cmd_dict.get("tdosis_seg")
        ajuste_baja = cmd_dict.get("ajuste_baja")
        temp_ini = cmd_dict.get("temporada_alta_inicio")
        temp_fin = cmd_dict.get("temporada_alta_fin")
        temp_offset = cmd_dict.get("temp_offset")
        
        cfg_to_save = {}
        if tespera_seg is not None: cfg_to_save["tespera_seg"] = int(tespera_seg)
        if tdosis_seg is not None: cfg_to_save["tdosis_seg"] = int(tdosis_seg)
        if ajuste_baja is not None: cfg_to_save["ajuste_baja"] = int(ajuste_baja)
        if temp_ini: cfg_to_save["temporada_alta_inicio"] = temp_ini
        if temp_fin: cfg_to_save["temporada_alta_fin"] = temp_fin
        if temp_offset is not None: cfg_to_save["temp_offset"] = float(temp_offset)

        await config_manager.guardar_configuracion(cfg_to_save)
        config_ref.update(cfg_to_save)
        await tx_queue.put({"tipo": "ACK_CONFIG", "status": "OK", "_destino": origen})
        await tx_queue.put({"tipo": "CONFIG", "data": config_ref.copy(), "_destino": origen})
        await enviar_telemetria()

    elif cmd in ("SET_PROGRAMAS", "config_cronograma"):
        cron_list = []
        raw_programas = {}
        if "cronograma" in cmd_dict and isinstance(cmd_dict["cronograma"], list):
            cron_list = cmd_dict["cronograma"]
            for i, ev in enumerate(cron_list):
                idx = i + 1
                if idx > 10: break
                
                on_val = str(ev.get("on", "00:00"))
                if len(on_val) == 4 and ":" not in on_val:
                    on_val = f"{on_val[:2]}:{on_val[2:]}"
                elif len(on_val) == 3 and ":" not in on_val:
                    on_val = f"0{on_val[0]}:{on_val[1:]}"
                    
                raw_programas[f"PR{idx}_inicio"] = on_val
                raw_programas[f"PR{idx}_duracion_min"] = ev.get("duracion", 0)
                raw_programas[f"PR{idx}_dosifica"] = ev.get("dosifica", False) or ev.get("dosis", 0) == 1
                dias_val = ev.get("dias", "0123456")
                raw_programas[f"PR{idx}_dias"] = list(str(dias_val)) if isinstance(dias_val, (str, int)) else dias_val
        else:
            raw_programas = cmd_dict.copy()
            for i in range(1, 11):
                ini = cmd_dict.get(f"PR{i}_inicio")
                dur = cmd_dict.get(f"PR{i}_duracion_min", 0)
                dos = cmd_dict.get(f"PR{i}_dosifica", False)
                dias = cmd_dict.get(f"PR{i}_dias", [0,1,2,3,4,5,6])
                if ini and ini != "00:00" and int(dur) > 0:
                    dias_str = "".join(str(d) for d in dias) if isinstance(dias, list) else str(dias)
                    cron_list.append({
                        "on": ini,
                        "duracion": int(dur),
                        "dosifica": bool(dos),
                        "dias": dias_str
                    })
        await config_manager.guardar_configuracion({"cronograma": cron_list, "raw_programas": raw_programas})
        config_ref["cronograma"] = cron_list
        config_ref["raw_programas"] = raw_programas
        await tx_queue.put({"tipo": "ACK_CRON", "status": "OK", "_destino": origen})
        await tx_queue.put({"tipo": "PROGRAMAS", "data": raw_programas, "_destino": origen})
        await enviar_telemetria()

    elif cmd == "GET_LOGS":
        try:
            logs = await sys_log.get_logs(incluir_ram=True)
            await tx_queue.put({"tipo": "LOGS_LIST", "logs": logs, "_destino": origen})
        except Exception as e:
            print("[LOGS] Error obteniendo logs:", e)
            
    elif cmd == "GET_PROGRAMAS":
        await tx_queue.put({"tipo": "PROGRAMAS", "data": config_ref.get("raw_programas", {}), "_destino": origen})
        
            
    elif cmd == "CLEAR_LOGS":
        try:
            await sys_log.limpiar_historial()
            await tx_queue.put({"tipo": "ACK_CLEAR_LOGS", "_destino": origen})
        except Exception: pass
            
    elif cmd == "FACTORY_RESET":
        try:
            import os
            try: os.remove(config_manager.CONFIG_FILE)
            except OSError: pass
            try: os.remove(config_manager.WIFI_CONFIG_FILE)
            except OSError: pass
            try: os.remove("programas.json")
            except OSError: pass
        except Exception: pass
        await sys_log.limpiar_historial()
        await tx_queue.put({"tipo": "ACK", "status": "RESETTING", "_destino": origen})
        await asyncio.sleep(1)
        machine.reset()

async def cron_scheduler_task():
    global estado_dosimat, modo_ciclo, tfiltro_restante, ultima_dosis_ts, ultimo_minuto_procesado, dosis_anuladas
    while True:
        try:
            t = time.localtime()
            current_hm_colon = f"{t[3]:02d}:{t[4]:02d}"
            current_hm_nocolon = f"{t[3]:02d}{t[4]:02d}"
            
            # En JavaScript 0 es Domingo y 1 es Lunes, en ESP32 0 es Lunes y 6 es Domingo
            # Convertimos RTC (0=Lunes...6=Dom) a JS-style (0=Dom, 1=Lun...)
            js_weekday = (t[6] + 1) % 7 
            
            now_ts = time.time()
            if now_ts > 700000000 and ultima_dosis_ts < 700000000:
                ultima_dosis_ts = now_ts
                
            # Antiatasco (25h)
            if now_ts - ultima_dosis_ts > 25 * 3600:
                if estado_dosimat == "IDLE":
                    print("[CORE] Auto Antiatasco disparado (>25h)")
                    estado_dosimat = "ANTI"
                    abort_event.set()
            
            if t[4] != ultimo_minuto_procesado:
                ultimo_minuto_procesado = t[4]
                cronograma = config_ref.get("cronograma", [])
                
                if estado_dosimat != "PAUSA" and isinstance(cronograma, list):
                    for prog in cronograma:
                        if not isinstance(prog, dict): continue
                        prog_on = str(prog.get("on", ""))
                        if prog_on == current_hm_colon or prog_on == current_hm_nocolon:
                            dias = prog.get("dias", "0123456")
                            if str(js_weekday) in str(dias):
                                print(f"[CORE] Cronograma disparado: {prog}")
                                modo_ciclo = "AUTO"
                                
                                # Verificamos si tiene dosis
                                incluye_dosis = prog.get("dosifica", prog.get("dosis", True))
                                if dosis_anuladas > 0 and incluye_dosis:
                                    dosis_anuladas -= 1
                                    config_ref["dosis_anuladas"] = dosis_anuladas
                                    await config_manager.guardar_configuracion(config_ref)
                                    incluye_dosis = False
                                    print(f"[CORE] Dosis automatica anulada. Restan: {dosis_anuladas}")
                                    await sys_log.log_event({"msg": "Dosis Salteada a Pedido"})
                                    await enviar_telemetria()

                                # Compensación automática por altas temperaturas
                                if incluye_dosis and config_ref.get("temp_comp_activa", False) and rtc_hw:
                                    try:
                                        temp = rtc_hw.get_temperature()
                                        if temp is not None:
                                            offset = float(config_ref.get("temp_offset", 0.0))
                                            temp_corregida = temp + offset
                                            now_ts = time.time()
                                            if now_ts > 700000000:
                                                ultimo_ref = config_ref.get("ultimo_refuerzo_temp_ts", 0)
                                                dias_int = 0
                                                if temp_corregida > 32.0:
                                                    dias_int = 3
                                                elif temp_corregida >= 29.0:
                                                    dias_int = 4
                                                
                                                if dias_int > 0:
                                                    segundos_int = dias_int * 24 * 3600
                                                    # Tolerancia de 5 minutos (300 segundos) para evitar descalces en la hora exacta del cron
                                                    if ultimo_ref == 0 or (now_ts - ultimo_ref) >= (segundos_int - 300):
                                                        refuerzo_activo = True
                                                        config_ref["refuerzo_activo"] = True
                                                        config_ref["ultimo_refuerzo_temp_ts"] = now_ts
                                                        await config_manager.guardar_configuracion(config_ref)
                                                        print(f"[CORE] Compensación temp: Refuerzo activado (Temp corregida: {temp_corregida:.1f}°C, cada {dias_int} días)")
                                                        await sys_log.log_event({"msg": f"Refuerzo Temp Auto - Temp: {temp_corregida:.1f}°C (c/{dias_int}d)"})
                                    except Exception as ex:
                                        print("[CORE] Error en compensación de temperatura:", ex)

                                if incluye_dosis:
                                    estado_dosimat = "FILTRO_PRE"
                                    # Descontamos el tiempo de espera del total de filtrado
                                    t_espera = int(config_ref.get("tespera_seg", 1800))
                                    dur_seg = int(prog.get("duracion", 60)) * 60
                                    tfiltro_restante = max(0, dur_seg - t_espera)
                                else:
                                    # Si no hay dosis, va directo a FILTRO_POST para solo filtrar
                                    estado_dosimat = "FILTRO_POST"
                                    tfiltro_restante = int(prog.get("duracion", 60)) * 60

                                abort_event.set()
                                await enviar_telemetria()
                                break
        except Exception as e:
            print("[CORE] Error en Scheduler:", e)
        
        await asyncio.sleep(10)

async def dispenser_loop():
    global estado_dosimat, tiempo_restante, refuerzo_activo, dosis_anuladas
    global ciclo_suspendido, fase_actual_interrumpida, tiempo_acumulado_fase
    global config_ref, modo_ciclo, tfiltro_restante, ultima_dosis_ts
    
    config_ref = await config_manager.cargar_configuracion()
    refuerzo_activo = config_ref.get("refuerzo_activo", False)
    dosis_anuladas = config_ref.get("dosis_anuladas", 0)
    estado_dosimat = "PAUSA" if config_ref.get("estado_pausa", False) else "IDLE"
    set_relays(bomba_on=False, valvula_on=False)
    
    asyncio.create_task(cron_scheduler_task())
    print("[CORE] Bucle del dosificador iniciado.")
    
    while True:
        abort_event.clear()
        
        # ----------------------------------------------------
        # 1. ESTADO: IDLE (En Espera Inactivo)
        # ----------------------------------------------------
        if estado_dosimat == "IDLE":
            set_relays(False, False)
            tiempo_restante = 0
            await enviar_telemetria()
            await abort_event.wait() 
            
        # ----------------------------------------------------
        # 2. ESTADO: FILTRO_PRE (Esperando estabilizacion antes de dosis)
        # ----------------------------------------------------
        elif estado_dosimat == "FILTRO_PRE":
            if fase_actual_interrumpida == "FILTRO_PRE" and tiempo_acumulado_fase > 0:
                tiempo_restante = tiempo_acumulado_fase
            else:
                tiempo_restante = int(config_ref.get("tespera_seg", 1800))
                
            fase_actual_interrumpida = None
            tiempo_acumulado_fase = 0
            
            set_relays(bomba_on=True, valvula_on=False)
            await enviar_telemetria()
            
            while tiempo_restante > 0:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            if estado_dosimat == "FILTRO_PRE":
                estado_dosimat = "DOSIS"
                    
        # ----------------------------------------------------
        # 3. ESTADO: DOSIS
        # ----------------------------------------------------
        elif estado_dosimat == "DOSIS":
            if fase_actual_interrumpida == "DOSIS" and tiempo_acumulado_fase > 0:
                tiempo_restante = tiempo_acumulado_fase
            else:
                base_time = config_ref.get("tdosis_seg", 300)
                if not es_temporada_alta():
                    porcentaje_baja = config_ref.get("ajuste_baja", 10)
                    tiempo_restante = int(base_time * (porcentaje_baja / 100.0))
                else:
                    tiempo_restante = base_time
                if refuerzo_activo:
                    tiempo_restante *= 2
                    
                m = tiempo_restante // 60
                s = tiempo_restante % 60
                dur_str = f"{m:02d}m {s:02d}s"
                ref_str = " - Refuerzo activo" if refuerzo_activo else ""
                temp_str = "Alta" if es_temporada_alta() else "Baja"
                tipo_dosis = "Dosis Manual" if modo_ciclo == "MANUAL" else "Dosis Automática"
                msg_log = f"{tipo_dosis} - Duración: {dur_str}{ref_str} - Temp: {temp_str}"
                await sys_log.log_event({"msg": msg_log})
                
            fase_actual_interrumpida = None
            tiempo_acumulado_fase = 0
            
            set_relays(bomba_on=True, valvula_on=True)
            await enviar_telemetria()
            
            while tiempo_restante > 0:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            if estado_dosimat == "DOSIS":
                set_relays(bomba_on=True, valvula_on=False)
                ultima_dosis_ts = time.time()
                refuerzo_activo = False
                config_ref["refuerzo_activo"] = False
                await config_manager.guardar_configuracion(config_ref)
                estado_dosimat = "FILTRO_POST"
                await enviar_telemetria()
                
        # ----------------------------------------------------
        # 3.5. ESTADO: FILTRO_POST (Limpieza de tuberías / Fin de ciclo)
        # ----------------------------------------------------
        elif estado_dosimat == "FILTRO_POST":
            if fase_actual_interrumpida == "FILTRO_POST" and tiempo_acumulado_fase > 0:
                tiempo_restante = tiempo_acumulado_fase
            else:
                if modo_ciclo == "MANUAL":
                    tiempo_restante = 1800 # 30 min obligatorios
                else:
                    tiempo_restante = tfiltro_restante
            
            fase_actual_interrumpida = None
            tiempo_acumulado_fase = 0
            
            set_relays(bomba_on=True, valvula_on=False)
            await enviar_telemetria()
            
            while tiempo_restante > 0:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            if estado_dosimat == "FILTRO_POST":
                set_relays(False, False)
                estado_dosimat = "IDLE"
                
        # ----------------------------------------------------
        # 3.8. ESTADO: FILTRO_MANUAL (Solo bomba encendida, cronómetro ascendente en UI)
        # ----------------------------------------------------
        elif estado_dosimat == "FILTRO_MANUAL":
            if fase_actual_interrumpida == "FILTRO_MANUAL" and tiempo_acumulado_fase > 0:
                tiempo_restante = tiempo_acumulado_fase
            else:
                tiempo_restante = 0 # Usamos 0 y en UI podemos mostrar como tiempo libre o ascendente
                
            fase_actual_interrumpida = None
            tiempo_acumulado_fase = 0
            
            set_relays(bomba_on=True, valvula_on=False)
            await enviar_telemetria()
            
            while True:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    break
                except asyncio.TimeoutError:
                    tiempo_restante += 1 # Cuenta ascendente
                    # Opcionalmente enviar telemetria cada 1 minuto
                    if tiempo_restante % 60 == 0:
                        await enviar_telemetria()
                        
        # ----------------------------------------------------
        # 4. ESTADO: PAUSA (Ciclo suspendido)
        # ----------------------------------------------------
        elif estado_dosimat == "PAUSA":
            set_relays(False, False)
            await enviar_telemetria()
            await abort_event.wait()
            if estado_dosimat == "PAUSA":
                estado_dosimat = "IDLE"
                
        # ----------------------------------------------------
        # 5. ESTADO: ANTI (Secuencia Antiatasco)
        # ----------------------------------------------------
        elif estado_dosimat == "ANTI":
            tiempo_restante = 3
            await sys_log.log_event({"tipo": "estado_anti"})
            await enviar_telemetria()
            
            set_relays(bomba_on=False, valvula_on=True)
            while tiempo_restante > 0:
                try:
                    await asyncio.wait_for(abort_event.wait(), timeout=1.0)
                    break
                except asyncio.TimeoutError:
                    tiempo_restante -= 1
                    
            if estado_dosimat == "ANTI":
                set_relays(False, False)
                ultima_dosis_ts = time.time()
                estado_dosimat = fase_actual_interrumpida if fase_actual_interrumpida in ("IDLE", "PAUSA") else "IDLE"
                fase_actual_interrumpida = None
                
        # ----------------------------------------------------
        # 6. ESTADO: RESET (Reinicio de Hardware)
        # ----------------------------------------------------
        elif estado_dosimat == "RESET":
            set_relays(False, False)
            estado_dosimat = "IDLE"
            await asyncio.sleep(1)
