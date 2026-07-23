# sys_log.py - Historial optimizado (RAM circular y Flash rotativo)
import json
import os
import time
import uasyncio as asyncio

LOG_FILE = "sys_log.jsonl"
LOG_FILE_OLD = "sys_log.old"
MAX_FILE_SIZE_BYTES = 8192  # 8 KB límite por archivo para evitar fragmentación y saturar Flash
MAX_RAM_LOGS = 20           # Tamaño del buffer circular en RAM (para modo offline/BLE)

_log_lock = asyncio.Lock()
logs_ram = []

async def log_event(event_dict, wifi_activo=None):
    """
    Registra un evento con timestamp de manera asíncrona.
    Si wifi_activo es False (modo BLE_ONLY/offline), almacena en un buffer circular en RAM.
    Si wifi_activo es True, añade la entrada al archivo Flash con control de rotación atómica.
    """
    event_dict["ts"] = time.time()
    
    if wifi_activo is None:
        try:
            import network
            wlan = network.WLAN(network.STA_IF)
            wifi_activo = wlan.active() and wlan.isconnected()
        except:
            wifi_activo = False

    if not wifi_activo:
        global logs_ram
        logs_ram.append(event_dict)
        if len(logs_ram) > MAX_RAM_LOGS:
            logs_ram.pop(0)
        print("[LOG_RAM]", event_dict)
        return

    async with _log_lock:
        try:
            logs_flash = []
            try:
                with open(LOG_FILE, "r") as f:
                    for line in f:
                        if line.strip():
                            try:
                                logs_flash.append(json.loads(line.strip()))
                            except ValueError:
                                pass
                        await asyncio.sleep_ms(0)
            except OSError:
                pass
                
            logs_flash.append(event_dict)
            if len(logs_flash) > 20:
                logs_flash = logs_flash[-20:]
                
            with open(LOG_FILE, "w") as f:
                for entry in logs_flash:
                    f.write(json.dumps(entry) + "\n")
                    
            print("[LOG_FLASH]", event_dict)
        except Exception as e:
            print("[LOG] Error al escribir en Flash:", e)

async def sincronizar_logs_ram_a_flash():
    """Vuelca los logs almacenados en la RAM hacia la Flash cuando hay conexión"""
    global logs_ram
    if not logs_ram:
        return
        
    print(f"[LOG] Sincronizando {len(logs_ram)} logs de RAM a Flash...")
    # Copiamos temporalmente para evitar condiciones de carrera si se añaden logs durante el proceso
    temp_logs = list(logs_ram)
    logs_ram = []
    
    async with _log_lock:
        try:
            logs_flash = []
            try:
                with open(LOG_FILE, "r") as f:
                    for line in f:
                        if line.strip():
                            try:
                                logs_flash.append(json.loads(line.strip()))
                            except ValueError: pass
                        await asyncio.sleep_ms(0)
            except OSError: pass
            
            logs_flash.extend(temp_logs)
            if len(logs_flash) > 20:
                logs_flash = logs_flash[-20:]
                
            with open(LOG_FILE, "w") as f:
                for entry in logs_flash:
                    f.write(json.dumps(entry) + "\n")
                    
        except Exception as e:
            print("[LOG] Error al sincronizar Flash:", e)

async def get_logs(incluir_ram=True):
    """Retorna la lista de logs cargando desde RAM y/o Flash"""
    logs = []
    if incluir_ram:
        logs.extend(logs_ram)
        
    async with _log_lock:
        try:
            with open(LOG_FILE, "r") as f:
                for line in f:
                    if line.strip():
                        try:
                            logs.append(json.loads(line.strip()))
                        except ValueError:
                            pass
                        await asyncio.sleep_ms(0)
        except OSError:
            pass
    return logs

async def limpiar_historial():
    """Limpia el buffer de RAM y borra los archivos de log de Flash"""
    global logs_ram
    logs_ram = []
    async with _log_lock:
        try:
            with open(LOG_FILE, "w") as f:
                f.write("")
            try:
                os.remove(LOG_FILE_OLD)
            except OSError:
                pass
            print("[LOG] Historial de logs limpiado.")
        except Exception as e:
            print("[LOG] Error al limpiar historial:", e)
