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

# Forzar recolección de basura para liberar RAM
gc.collect()
