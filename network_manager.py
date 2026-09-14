# network_manager.py - Máquina de estados de red y exclusión mutua WiFi/BLE
import network
import time
import json
import gc
import usocket as socket
import uasyncio as asyncio
import config_manager
import sys_log
import ble_service
import dosimat_core
from mqtt_client import MQTTClient

# Estados de Red
STATE_INIT = 0
STATE_BLE_ONLY = 1
STATE_WIFI_CONNECTING = 2
STATE_WIFI_ONLINE = 3
STATE_FALLBACK_BLE = 4

current_state = STATE_INIT
wifi_conectado = False
mqtt_client = None
mqtt_loop_task = None
ventana_fallback_ble_s = 180  # 3 minutos de BLE antes de reintentar WiFi

# Servidor MQTT de prueba (se reemplazará en la integración final)
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883

def get_state_name():
    states = {
        0: "INIT",
        1: "BLE_ONLY",
        2: "WIFI_CONNECTING",
        3: "WIFI_ONLINE",
        4: "FALLBACK_BLE"
    }
    return states.get(current_state, "UNKNOWN")

def mqtt_callback(topic, msg):
    """Callback para mensajes entrantes de MQTT"""
    try:
        msg_str = msg.decode('utf-8')
        print(f"[MQTT] RX: {msg_str}")
        payload = json.loads(msg_str)
        payload['_origen'] = 'MQTT'
        # Encolar comando de forma asíncrona
        asyncio.create_task(dosimat_core.procesar_comando(payload))
    except Exception as e:
        print("[MQTT_CB] Error al procesar mensaje:", e)

mqtt_lock = asyncio.Lock()

async def conectar_mqtt_async():
    global mqtt_client, mqtt_loop_task
    if not wifi_conectado:
        return False

    async with mqtt_lock:
        try:
            # Cerrar conexión anterior si existiese
            if mqtt_client:
                try:
                    mqtt_client.disconnect()
                except:
                    pass
                mqtt_client = None

            import urandom
            client_id = f"dosimat_{dosimat_core.chip_id}_{urandom.getrandbits(16)}"
            
            print(f"[MQTT] Conectando a {MQTT_BROKER}:{MQTT_PORT}...")
            mqtt_client = MQTTClient(
                client_id=client_id,
                server=MQTT_BROKER,
                port=MQTT_PORT,
                keepalive=60
            )
            mqtt_client.set_callback(mqtt_callback)
            
            # Conectar de manera segura (con socket timeouts definidos dentro del cliente)
            mqtt_client.connect(clean_session=True)
            
            # Suscribirse al topic de comandos
            topic_sub = f"dosimat/{dosimat_core.chip_id}/cmd"
            mqtt_client.subscribe(topic_sub)
            print(f"[MQTT] Suscrito a: {topic_sub}")

            # Cancelar loop de escucha anterior si existiese
            if mqtt_loop_task:
                try:
                    mqtt_loop_task.cancel()
                except:
                    pass
            mqtt_loop_task = asyncio.create_task(loop_mqtt_escucha())
            
            # Enviar estado inicial para que la app lo reciba
            asyncio.create_task(dosimat_core.enviar_telemetria())
            
            return True
        except Exception as e:
            print("[MQTT] Error al establecer conexión MQTT:", e)
            mqtt_client = None
            return False

def feed_watchdog():
    try:
        dosimat_core.feed_wdt()
    except Exception:
        pass

async def loop_mqtt_escucha():
    """Escucha periódica de mensajes MQTT usando check_msg no bloqueante protegido por lock"""
    global mqtt_client
    last_ping = time.time()
    while wifi_conectado and mqtt_client is not None:
        feed_watchdog()
        try:
            async with mqtt_lock:
                if mqtt_client is not None:
                    mqtt_client.check_msg()
                    if time.time() - last_ping >= 30:
                        mqtt_client.ping()
                        last_ping = time.time()
        except OSError as e:
            err_code = e.args[0] if e.args else None
            # Excluir errores de socket no bloqueante (EAGAIN, etc.)
            if err_code not in (11, 110, 115, 116):
                print("[MQTT] Desconexión de socket en loop escucha. Código:", err_code)
                mqtt_client = None
                break
        except Exception as e:
            print("[MQTT] Excepción en loop de escucha:", e)
            mqtt_client = None
            break
        await asyncio.sleep_ms(200)

async def conectar_wifi_non_blocking(wlan):
    """Intenta conectar a la red WiFi guardada sin bloquear el loop de uasyncio"""
    global wifi_conectado
    cred = await config_manager.cargar_wifi_config()
    if not cred:
        print("[WIFI] Sin credenciales configuradas.")
        return False

    ssid = str(cred.get("ssid", "")).strip()
    password = str(cred.get("pass", "")).strip()
    
    if not ssid:
        return False

    print(f"[WIFI] Conectando a AP: {ssid}...")
    try:
        if not wlan.isconnected():
            wlan.connect(ssid, password)
    except OSError as e_conn:
        print("[WIFI] Aviso al conectar (reconexión):", e_conn)
    
    # Bucle de espera no bloqueante de 15 segundos máximo (30 * 500ms)
    for _ in range(30):
        if wlan.isconnected():
            wifi_conectado = True
            print("[WIFI] Conectado. IP Config:", wlan.ifconfig())
            
            # Sincronización horaria NTP
            try:
                import ntptime
                ntptime.host = "pool.ntp.org"
                ntptime.settime()
                # Ajuste de zona horaria local (ej: Argentina UTC-3)
                import machine
                rtc = machine.RTC()
                t = time.localtime(time.time() - 10800) # Restar 3 horas en segundos
                # Estructura RTC: (year, month, day, weekday, hours, minutes, seconds, subseconds)
                rtc.datetime((t[0], t[1], t[2], t[6], t[3], t[4], t[5], 0))
                print("[NTP] Hora del sistema sincronizada (UTC-3):", time.localtime())
                
                # Sincronizar también con el RTC externo DS3231
                try:
                    import dosimat_core
                    if dosimat_core.rtc_hw:
                        dosimat_core.rtc_hw.save_time((t[0], t[1], t[2], t[6], t[3], t[4], t[5]))
                        print("[NTP] DS3231 actualizado con hora NTP.")
                except Exception as ex:
                    print("[NTP] Error al guardar en DS3231:", ex)
            except Exception as ntp_err:
                print("[NTP] No se pudo sincronizar hora por NTP:", ntp_err)
                
            return True
        await asyncio.sleep_ms(500)
    return False

async def gestionar_interfaces_network():
    """Orquestador de la máquina de estados de red que garantiza la exclusión mutua de RF"""
    global current_state, wifi_conectado, mqtt_client
    
    gc.collect()
    wlan = None
    for attempt in range(3):
        try:
            wlan = network.WLAN(network.STA_IF)
            break
        except Exception as e_wlan:
            print(f"[NET] Aviso obteniendo interfaz WLAN (intento {attempt+1}/3):", e_wlan)
            gc.collect()
            await asyncio.sleep_ms(300)

    while True:
        # Verificar credenciales en cada ciclo por si se configuraron nuevas vía BLE
        cred = await config_manager.cargar_wifi_config()
        tiene_creds = cred is not None and bool(cred.get("ssid"))

        # ----------------------------------------------------
        # STATE_INIT
        # ----------------------------------------------------
        if current_state == STATE_INIT:
            if tiene_creds:
                print("[NET] Credenciales detectadas en inicio. Conectando WiFi...")
                current_state = STATE_WIFI_CONNECTING
            else:
                print("[NET] Sin credenciales en inicio. Arrancando BLE...")
                current_state = STATE_BLE_ONLY

        # ----------------------------------------------------
        # STATE_BLE_ONLY
        # ----------------------------------------------------
        elif current_state == STATE_BLE_ONLY:
            # Exclusión: Asegurar WiFi OFF
            if wlan and wlan.active():
                try:
                    wlan.active(False)
                except:
                    pass
                gc.collect()
                
            name = f"Dosimat_{dosimat_core.chip_id[-4:]}"
            await ble_service.start_ble_service(name=name)
            
            # Transicionar si hay credenciales disponibles
            if tiene_creds:
                print("[NET] Credenciales recibidas. Apagando BLE y yendo a WiFi...")
                current_state = STATE_WIFI_CONNECTING
            await asyncio.sleep(2)

        # ----------------------------------------------------
        # STATE_WIFI_CONNECTING
        # ----------------------------------------------------
        elif current_state == STATE_WIFI_CONNECTING:
            # Exclusión: Detener BLE antes de encender WiFi
            await ble_service.stop_ble_service()
            gc.collect()
            await asyncio.sleep_ms(150)
            if wlan and not wlan.active():
                try:
                    wlan.active(True)
                except Exception as e_wlan:
                    print("[WIFI] Error activando interfaz STA:", e_wlan)
                    await asyncio.sleep_ms(500)
                    try:
                        wlan.active(True)
                    except Exception:
                        pass
            gc.collect()
            
            success = False
            if wlan:
                success = await conectar_wifi_non_blocking(wlan)
            if success:
                current_state = STATE_WIFI_ONLINE
                # Volcar logs acumulados en RAM a Flash
                await sys_log.sincronizar_logs_ram_a_flash()
            else:
                print("[NET] Fallo al conectar WiFi. Activando Fallback BLE...")
                current_state = STATE_FALLBACK_BLE

        # ----------------------------------------------------
        # STATE_WIFI_ONLINE
        # ----------------------------------------------------
        elif current_state == STATE_WIFI_ONLINE:
            # Monitorear enlace de red
            if not wlan.isconnected():
                print("[NET] Enlace WiFi perdido.")
                wifi_conectado = False
                mqtt_client = None
                current_state = STATE_FALLBACK_BLE
            else:
                # Mantener conexión MQTT activa
                if mqtt_client is None:
                    await conectar_mqtt_async()
            await asyncio.sleep(5)

        # ----------------------------------------------------
        # STATE_FALLBACK_BLE
        # ----------------------------------------------------
        elif current_state == STATE_FALLBACK_BLE:
            # Exclusión: Apagar WiFi, encender BLE temporal
            wlan.active(False)
            wifi_conectado = False
            mqtt_client = None
            gc.collect()
            
            name = f"Dosimat_{dosimat_core.chip_id[-4:]}"
            await ble_service.start_ble_service(name=name)
            
            # Esperar en ventana de emergencia (con pausa si hay usuario conectado por BLE)
            print(f"[NET] Ventana de Fallback BLE activa por {ventana_fallback_ble_s} segundos...")
            segundos_esperados = 0
            while segundos_esperados < int(ventana_fallback_ble_s):
                if current_state != STATE_FALLBACK_BLE:
                    break
                # Si hay un usuario conectado por BLE, reiniciar el contador para no cortar su sesión
                if ble_service.is_ble_connected():
                    segundos_esperados = 0
                else:
                    segundos_esperados += 1
                await asyncio.sleep(1)
                
            # Finalizada la ventana sin clientes activos, apagar BLE y volver a intentar WiFi
            if current_state == STATE_FALLBACK_BLE:
                print("[NET] Ventana de fallback completada (sin clientes BLE activos). Reintentando WiFi...")
                await ble_service.stop_ble_service()
                current_state = STATE_WIFI_CONNECTING

async def procesar_cola_ble():
    """Lee comandos de la cola BLE y los reenvía al núcleo funcional"""
    while True:
        cmd_dict = await ble_service.rx_queue.get()
        if isinstance(cmd_dict, dict):
            cmd_dict['_origen'] = 'BLE'
            await dosimat_core.procesar_comando(cmd_dict)

async def tarea_tx_queue():
    """Desencola reportes/telemetría y los envía por el canal de comunicación activo"""
    global mqtt_client
    while True:
        feed_watchdog()
        msg_dict = await dosimat_core.tx_queue.get()
        feed_watchdog()
        destino = msg_dict.get("_destino", "ALL")
        
        # Remover clave de destino interno para la transmisión limpia
        if "_destino" in msg_dict:
            del msg_dict["_destino"]
            
        # Inyectar chip_id para que la PWA pueda vincularse por BLE
        msg_dict["id_equipo"] = dosimat_core.chip_id
            
        # 1. Transmitir por BLE si está conectado
        if destino in ("ALL", "BLE"):
            if ble_service.is_ble_connected():
                # Enviar solo telemetría o ACKs compactos vía BLE
                await ble_service.send_json_async(msg_dict)
                
        # 2. Transmitir por MQTT si está conectado
        if destino in ("ALL", "MQTT"):
            if mqtt_client and wifi_conectado:
                try:
                    gc.collect()
                    tipo = msg_dict.get("tipo", "")
                    if tipo in ("LOG_ENTRY", "LOGS_END", "LOGS_LIST"):
                        topic_pub = f"dosimat/{dosimat_core.chip_id}/logs"
                    elif tipo in ("CONFIG", "ACK_CFG", "ACK_CONFIG", "ACK_RTC", "ACK_CLEAR_LOGS", "ACK_WIFI"):
                        topic_pub = f"dosimat/{dosimat_core.chip_id}/config"
                    elif tipo in ("PROGRAMAS", "ACK_CRON"):
                        topic_pub = f"dosimat/{dosimat_core.chip_id}/programas"
                    else:
                        topic_pub = f"dosimat/{dosimat_core.chip_id}/telemetry"
                    
                    if tipo == "LOGS_LIST":
                        num_logs = len(msg_dict.get("logs", []))
                        print(f"[MQTT] TX ({topic_pub}): LOGS_LIST ({num_logs} registros)")
                    elif tipo != "TELEMETRIA":
                        print(f"[MQTT] TX ({topic_pub}): {msg_dict}")
                        
                    json_bytes = json.dumps(msg_dict).encode('utf-8')
                    async with mqtt_lock:
                        if mqtt_client is not None:
                            mqtt_client.publish(topic_pub, json_bytes)
                    gc.collect()
                except MemoryError:
                    print("[NET_TX] Memoria insuficiente temporal para publicar MQTT. Reclamando RAM...")
                    gc.collect()
                except OSError as e:
                    print("[NET_TX] Error de socket publicando MQTT:", e)
                    mqtt_client = None
                except Exception as e:
                    print("[NET_TX] Error publicando telemetría MQTT:", e)
        feed_watchdog()
        await asyncio.sleep_ms(10)


# ======================================================================
# WEBHOOK DIRECTO A NTFY.SH (NOTIFICACIONES PUSH PWA / MÓVIL)
# ======================================================================

def disparar_webhook_notificacion(evento, extra=None):
    """Lanza una tarea asíncrona no bloqueante para enviar push a ntfy.sh."""
    if not wifi_conectado:
        return
    try:
        asyncio.create_task(_enviar_http_push(evento, extra or {}))
    except Exception as e:
        print("[PUSH_HTTP] Error creando tarea:", e)


async def _enviar_http_push(evento, extra):
    """Envío HTTP POST puro (Puerto 80, sin SSL) a ntfy.sh con cero sobrecarga de RAM."""
    s = None
    try:
        prefs = dosimat_core.config_ref.get("notificaciones", {})

        # Comprobar selectores de usuario antes de enviar
        if evento == "inicio_dosis" and not prefs.get("inicio_dosis", True):
            return
        if evento == "fin_dosis" and not prefs.get("fin_dosis", True):
            return
        if evento == "bomba_apagada" and not prefs.get("bomba_apagada", True):
            return
        if evento == "bidon_bajo" and not prefs.get("bidon_bajo", True):
            return
        if evento == "equipo_pausado" and not prefs.get("equipo_pausado", True):
            return
        if evento == "clima_alerta" and not prefs.get("clima_alerta", True):
            return

        gc.collect()
        topic = f"dosimat_{dosimat_core.chip_id[-4:].lower()}"

        if evento == "inicio_dosis":
            titulo = "Inicio de Dosis"
            mensaje = extra.get("msg", "Se inició la dosificación de cloro.")
            tags = "test_tube"
            prioridad = "default"
        elif evento == "fin_dosis":
            titulo = "Dosis Completada"
            hora = extra.get("hora", "")
            hora_txt = f" a las {hora}" if hora else ""
            mensaje = f"Dosificación de cloro finalizada correctamente{hora_txt}."
            tags = "white_check_mark"
            prioridad = "default"
        elif evento == "bomba_apagada":
            titulo = "Dosis Suspendida"
            mensaje = "Dosis cancelada: no se detectó funcionamiento de la bomba de filtrado."
            tags = "warning"
            prioridad = "high"
        elif evento == "bidon_bajo":
            titulo = "Nivel de Cloro Bajo"
            litros = extra.get("litros", "")
            dias = extra.get("dias", "")
            if litros and dias:
                mensaje = f"Nivel de cloro bajo: quedan {litros} L (~{dias} días). Se sugiere recargar bidón."
            elif litros:
                mensaje = f"Nivel de cloro bajo: quedan {litros} L restantes. Se sugiere recargar bidón."
            else:
                mensaje = extra.get("msg", "El nivel de cloro restante es bajo. Se sugiere recargar el bidón.")
            tags = "oil_drum"
            prioridad = "high"
        elif evento == "equipo_pausado":
            titulo = "Dosificador en Pausa"
            mensaje = "El dosificador Dosimat se encuentra en Modo Pausa. La dosificación automática está suspendida."
            tags = "pause_button"
            prioridad = "default"
        elif evento == "clima_alerta":
            titulo = extra.get("titulo", "Sugerencia Meteorológica")
            mensaje = extra.get("msg", "Condiciones climáticas cambiantes. Te sugerimos revisar el dosificador.")
            tags = extra.get("tag", "sunny")
            prioridad = "default"
        else:
            titulo = "Alerta Dosimat IoT"
            mensaje = extra.get("msg", f"Evento: {evento}")
            tags = "bell"
            prioridad = "default"

        feed_watchdog()

        # Socket TCP estándar en puerto 80 (< 1KB RAM, sin SSL)
        s = socket.socket()
        s.settimeout(4.0)
        addr = socket.getaddrinfo("ntfy.sh", 80)[0][-1]
        s.connect(addr)

        msg_bytes = mensaje.encode("utf-8")
        req = (
            f"POST /{topic} HTTP/1.1\r\n"
            f"Host: ntfy.sh\r\n"
            f"Title: {titulo}\r\n"
            f"Priority: {prioridad}\r\n"
            f"Tags: {tags}\r\n"
            f"Actions: view, Abrir Dosimat IoT, https://dosimat-iot-v2.web.app\r\n"
            f"Content-Type: text/plain; charset=utf-8\r\n"
            f"Content-Length: {len(msg_bytes)}\r\n"
            f"Connection: close\r\n\r\n"
        )

        s.write(req.encode("utf-8") + msg_bytes)
        print(f"[PUSH_HTTP] Notificación enviada a https://ntfy.sh/{topic} (Título: {titulo})")
    except Exception as e:
        print(f"[PUSH_HTTP] Error notificando \"{evento}\":", e)
    finally:
        if s:
            try:
                s.close()
            except:
                pass
        gc.collect()

