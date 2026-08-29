# led_manager.py - Control asíncrono y no bloqueante de los LEDs
import machine
import time
import uasyncio as asyncio

# Configuración del pin de LED de panel (Activo en Alto)
LED_PANEL_PIN = 2

# Definición de patrones según la especificación [(valor, duracion_ms)]
LED_PATRONES = {
    'En_espera_wifi':       [(1, 200), (0, 4000)],
    'En_espera_ble':        [(1, 200), (0, 2000)],
    'inactivo_refuerzo':    [(1, 200), (0, 200), (1, 200), (0, 4000)],
    'dosificando':          [(1, 1000), (0, 1000)],
    'dosificando_refuerzo': [(1, 4000), (0, 200)],
    'solo_bomba':           [(1, 500), (0, 500)],
    'mantenimiento':        [(1, 200), (0, 200)]
}

# Variables de control
current_pattern = 'En_espera_ble'
led_panel = None
_pattern_event = asyncio.Event()
_is_running = False

def init_leds():
    global led_panel
    if led_panel is None:
        try:
            led_panel = machine.Pin(LED_PANEL_PIN, machine.Pin.OUT, value=0)
            print("[LED] Controlador de LED inicializado en Pin 2.")
        except Exception as e:
            print("[LED] Error inicializando pin de LED:", e)

def set_pattern(pattern_name):
    """Establece un nuevo patrón y despierta el loop del LED si estaba durmiendo"""
    global current_pattern
    if pattern_name in LED_PATRONES:
        if current_pattern != pattern_name:
            print(f"[LED] Cambiando patrón a: {pattern_name}")
            current_pattern = pattern_name
            _pattern_event.set()
    else:
        print(f"[LED] Error: Patrón '{pattern_name}' no existe.")

def actualizar_patron(state, wifi_online, ble_active, refuerzo_activo):
    """
    Decide y cambia el patrón del LED basado en el estado funcional, 
    de conexión y si el modo de dosificación reforzado está activo.
    """
    # 1. Mapeo de estados de mantenimiento o transitorios
    if state in ("PAUSA", "ANTI", "RESET"):
        set_pattern('mantenimiento')
        
    # 2. Filtrando (solo bomba)
    elif state in ("FILTRO", "FILTRO_PRE", "FILTRO_POST", "FILTRO_MANUAL"):
        set_pattern('solo_bomba')
        
    # 3. Dosificando (cloro)
    elif state == "DOSIS":
        if refuerzo_activo:
            set_pattern('dosificando_refuerzo')
        else:
            set_pattern('dosificando')
            
    # 4. En espera (IDLE)
    elif state == "IDLE":
        if refuerzo_activo:
            set_pattern('inactivo_refuerzo')
        else:
            if wifi_online:
                set_pattern('En_espera_wifi')
            else:
                set_pattern('En_espera_ble')

async def led_task():
    """Tarea asíncrona de loop infinito que reproduce el patrón activo con reloj exacto (Singleton)"""
    global _is_running
    if _is_running:
        print("[LED] Tarea led_task ya activa. Evitando tarea duplicada.")
        return
    _is_running = True
    init_leds()
    
    try:
        while True:
            _pattern_event.clear()
            pattern = LED_PATRONES.get(current_pattern, [(0, 1000)])
            
            for val, dur in pattern:
                if _pattern_event.is_set():
                    break
                    
                if led_panel:
                    led_panel.value(val)
                    
                start_ms = time.ticks_ms()
                while time.ticks_diff(time.ticks_ms(), start_ms) < dur:
                    if _pattern_event.is_set():
                        break
                    restante = dur - time.ticks_diff(time.ticks_ms(), start_ms)
                    await asyncio.sleep_ms(min(50, max(1, restante)))
                    
            if _pattern_event.is_set():
                if led_panel: led_panel.value(0)
                await asyncio.sleep_ms(20)
    finally:
        _is_running = False
