# ble_service.py - Servicio Nordic UART sobre BLE usando aioble
import uasyncio as asyncio
import aioble
import bluetooth
import json
import gc

# UUIDs de Nordic UART Service
_UART_SERVICE_UUID = bluetooth.UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_RX_CHAR_UUID = bluetooth.UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_TX_CHAR_UUID = bluetooth.UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")

# Configuración del servicio y características UART
_uart_service = aioble.Service(_UART_SERVICE_UUID)
_uart_rx = aioble.Characteristic(_uart_service, _UART_RX_CHAR_UUID, write=True, write_no_response=True, capture=True)
_uart_tx = aioble.Characteristic(_uart_service, _UART_TX_CHAR_UUID, read=True, notify=True)

# Registrar servicio en aioble
aioble.register_services(_uart_service)

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

# Cola asíncrona para comandos entrantes
rx_queue = AsyncQueue()

# Estado de la conexión y del servicio
_current_connection = None
_ble_sending = False
_ble_running = False
ble_tasks = []

def is_ble_connected():
    return _current_connection is not None

async def ble_rx_task():
    """Recibe datos desde la característica RX de BLE UART, acumulándolos hasta encontrar saltos de línea"""
    buffer = b""
    while _ble_running:
        try:
            conn, data = await _uart_rx.written()
            if data:
                print(f"[BLE_RX] Raw data: {data}")
                buffer += data
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    print(f"[BLE_RX] Línea recibida: {line}")
                    try:
                        payload = line.decode("utf-8").strip()
                        if payload:
                            cmd_dict = json.loads(payload)
                            print(f"[BLE_RX] JSON parseado correctamente. Comando: {cmd_dict.get('comando')}")
                            await rx_queue.put(cmd_dict)
                    except Exception as e:
                        print(f"[BLE_RX] Error al decodificar JSON: {e}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print("[BLE_RX] Excepción en RX task:", e)
            buffer = b""
            await asyncio.sleep_ms(1000)

async def send_json_async(datos_dict):
    """Envía un diccionario JSON serializado a través de BLE UART en fragmentos de MTU"""
    global _current_connection, _ble_sending
    if _current_connection is None:
        print("[BLE_TX] Sin conexión activa. Envío descartado.")
        return

    try:
        json_str = json.dumps(datos_dict) + "\n"
    except Exception as e:
        print(f"[BLE_TX] Error al serializar a JSON: {e}")
        return

    # Evitar payloads masivos para proteger la memoria RAM
    if len(json_str) > 2048:
        print(f"[BLE_TX] Error: Payload excede el límite BLE ({len(json_str)} > 2048 bytes)")
        return

    # Esperar a que se libere el canal de envío (máximo ~2s)
    for _ in range(50):
        if not _ble_sending:
            break
        await asyncio.sleep_ms(40)
    else:
        print("[BLE_TX] Timeout esperando liberación de TX.")
        return

    _ble_sending = True
    try:
        max_chunk = 20  # MTU conservador de 20 bytes
        print(f"[BLE_TX] Enviando {len(json_str)} bytes en fragmentos de {max_chunk}...")
        for i in range(0, len(json_str), max_chunk):
            if _current_connection is None:
                print("[BLE_TX] Desconexión durante transmisión.")
                break
            chunk = json_str[i:i + max_chunk].encode('utf-8')
            try:
                _uart_tx.notify(_current_connection, chunk)
            except asyncio.TimeoutError:
                print("[BLE_TX] Timeout en notify.")
            except Exception as e:
                print("[BLE_TX] Error en notify:", e)
                break
            await asyncio.sleep_ms(40)  # Breve retardo para no saturar el buffer del host
        print("[BLE_TX] Envío completado exitosamente.")
    except Exception as e:
        print("[BLE_TX] Error en envío BLE:", e)
    finally:
        _ble_sending = False

async def ble_advertise_task(name="DosimatBLE"):
    """Publicita el servicio BLE UART de forma indefinida hasta que se detenga el servicio"""
    global _current_connection
    while _ble_running:
        try:
            print(f"[BLE] Publicitando como '{name}'...")
            connection = await aioble.advertise(
                250_000, # Intervalo en microsegundos
                name=name,
                services=[_UART_SERVICE_UUID],
                appearance=0x00
            )
            if connection:
                print(f"[BLE] Dispositivo conectado: {connection.device}")
                _current_connection = connection
                # Esperar hasta desconexión
                await connection.disconnected(timeout_ms=None)
                print("[BLE] Dispositivo desconectado.")
            _current_connection = None
        except asyncio.CancelledError:
            print("[BLE] Publicidad cancelada de forma asíncrona.")
            _current_connection = None
            raise
        except Exception as e:
            print("[BLE] Error en publicidad:", e)
            _current_connection = None
            await asyncio.sleep_ms(2000)

async def start_ble_service(name="DosimatBLE"):
    """Inicializa la pila física de BLE y arranca las tareas asíncronas de publicidad y RX"""
    global ble_tasks, _ble_running
    if _ble_running:
        return
        
    _ble_running = True
    try:
        # Inicializar el chip físico de BLE
        ble_hw = bluetooth.BLE()
        if not ble_hw.active():
            ble_hw.active(True)
            
        t1 = asyncio.create_task(ble_advertise_task(name))
        t2 = asyncio.create_task(ble_rx_task())
        ble_tasks = [t1, t2]
        print("[BLE] Servicio Bluetooth activado e iniciado.")
    except Exception as e:
        print("[BLE] Error al iniciar servicio BLE:", e)
        _ble_running = False

async def stop_ble_service():
    """Detiene las tareas asociadas, cierra conexiones y desactiva el chip BLE física y lógicamente"""
    global ble_tasks, _ble_running, _current_connection
    if not _ble_running:
        return

    _ble_running = False
    _current_connection = None

    # Cancelar tareas activas
    for t in ble_tasks:
        try:
            t.cancel()
        except:
            pass
    ble_tasks = []

    # Desactivar chip de radio Bluetooth nativo
    try:
        ble_hw = bluetooth.BLE()
        ble_hw.active(False)
        print("[BLE] Hardware Bluetooth desactivado por exclusión mutua.")
    except Exception as e:
        print("[BLE] Error al desactivar hardware Bluetooth:", e)

    gc.collect()
