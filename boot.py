# boot.py - Configuraciones iniciales de hardware seguras
import gc
from machine import Pin

# Pines de relés (Activos en Alto)
VALVULA_PIN = 25
BOMBA_PIN = 23

try:
    # Asegurar apagado inmediato de las salidas físicas al energizar
    valvula = Pin(VALVULA_PIN, Pin.OUT, value=0)
    bomba = Pin(BOMBA_PIN, Pin.OUT, value=0)
    print("[BOOT] Salidas físicas inicializadas en BAJO (Apagado)")
except Exception as e:
    print("[BOOT] Error al inicializar pines en boot.py:", e)

# Inicializar interface WLAN temprana antes de que se fragmente la RAM
try:
    import network
    wlan = network.WLAN(network.STA_IF)
    wlan.active(False)
    print("[BOOT] Interfaz WLAN inicializada en reposo.")
except Exception as e_wlan:
    print("[BOOT] Aviso inicializando WLAN en boot:", e_wlan)

# Forzar recolección de basura para liberar RAM
gc.collect()
