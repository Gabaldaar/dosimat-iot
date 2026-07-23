# main.py - Punto de entrada principal y orquestación de tareas asíncronas
import machine
import time

# Delay de seguridad inicial de 3 segundos para permitir Ctrl+C en consola de desarrollo
try:
    led_panel = machine.Pin(2, machine.Pin.OUT)
    led_panel.value(1)  # Encender LED del panel
    print("[MAIN] Iniciando... Tienes 3 segundos para pulsar Ctrl+C en la consola.")
    time.sleep(3)
    led_panel.value(0)  # Apagar
except Exception as e:
    pass

import uasyncio as asyncio
import gc
import dosimat_core
import network_manager
import led_manager
import sys_log

async def main():
    print("[MAIN] Inicializando tareas del sistema...")
    
    # 1. Registrar eventos en el log
    await sys_log.log_event({"tipo": "info", "msg": "Sistema Dosimat iniciado"}, wifi_activo=False)
    
    # 2. Iniciar tareas del LED indicador de forma inmediata
    asyncio.create_task(led_manager.led_task())
    
    # 3. Iniciar lógica funcional del dosificador
    asyncio.create_task(dosimat_core.dispenser_loop())
    
    # 4. Iniciar tareas de red y comunicación asíncronas
    asyncio.create_task(network_manager.gestionar_interfaces_network())
    asyncio.create_task(network_manager.procesar_cola_ble())
    asyncio.create_task(network_manager.tarea_tx_queue())
    
    # 5. Tarea periódica para actualizar el patrón de destello del LED
    asyncio.create_task(tarea_actualizar_leds_periodica())
    
    # 6. Inicializar Watchdog Timer de hardware (WDT) para mitigar bloqueos severos
    try:
        wdt = machine.WDT(timeout=30000)  # 30 segundos de margen
        print("[MAIN] Watchdog Timer inicializado (30s).")
    except Exception as e:
        print("[MAIN] Watchdog Timer no soportado o error al iniciar:", e)
        wdt = None
        
    # Bucle de vida principal (alimentando WDT)
    while True:
        if wdt:
            wdt.feed()
        
        # Opcional: Reportar uso de memoria RAM cada hora
        await asyncio.sleep(2)

async def tarea_actualizar_leds_periodica():
    """Monitorea el estado funcional y de red para actualizar el patrón de LED de forma reactiva"""
    while True:
        try:
            # Obtener estado de conexión wifi y BLE
            wifi_ok = network_manager.wifi_conectado
            ble_ok = ble_service_active()
            refuerzo = dosimat_core.refuerzo_activo
            estado_disp = dosimat_core.estado_dosimat
            
            # Cambiar patrón de LED
            led_manager.actualizar_patron(
                state=estado_disp,
                wifi_online=wifi_ok,
                ble_active=ble_ok,
                refuerzo_activo=refuerzo
            )
        except Exception as e:
            print("[MAIN] Error en actualización de patrón de LED:", e)
            
        await asyncio.sleep(1)

def ble_service_active():
    try:
        import ble_service
        return ble_service._ble_running
    except:
        return False

# Ejecutar bucle principal
try:
    asyncio.run(main())
except KeyboardInterrupt:
    print("[MAIN] Ejecución interrumpida por el usuario.")
except Exception as e:
    print("[MAIN] Error fatal en bucle principal:", e)
    # Forzar reinicio si ocurre un error no controlado en el loop principal
    time.sleep(2)
    machine.reset()
