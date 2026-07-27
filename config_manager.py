# config_manager.py - Manejo de configuración persistente y segura en Flash
import json
import os
import uasyncio as asyncio

CONFIG_FILE = "config_dosimat.json"
WIFI_CONFIG_FILE = "wifi_config.json"

DEFAULT_CONFIG = {
    "config_version": 1,
    "tespera_seg": 90,         # Tiempo de espera por defecto de fábrica (90 segundos / 1m 30s)
    "tdosis_seg": 90,          # Tiempo de dosificación por defecto de fábrica (90 segundos / 1m 30s)
    "ajuste_baja": 50,         # % de ajuste en temporada baja (50%)
    "temporada_alta_inicio": "10-30",  # Inicio temporada alta (MM-DD)
    "temporada_alta_fin": "03-30",     # Fin temporada alta (MM-DD)
    "temp_comp_activa": False,         # Compensación automática por altas temperaturas activa
    "ultimo_refuerzo_temp_ts": 0       # Timestamp del último refuerzo por temperatura
}

config_data = {}
_lock = None

def _get_lock():
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock

async def cargar_configuracion():
    global config_data
    async with _get_lock():
        try:
            with open(CONFIG_FILE, "r") as f:
                config_data = json.load(f)
                # Asegurar que existan todos los campos por defecto
                modificado = False
                for k, v in DEFAULT_CONFIG.items():
                    if k not in config_data:
                        config_data[k] = v
                        modificado = True
                if modificado:
                    await _guardar_interno(config_data)
                print("[CONFIG] Configuración cargada correctamente.")
        except Exception as e:
            print("[CONFIG] Archivo no encontrado o corrupto. Cargando valores por defecto...", e)
            config_data = DEFAULT_CONFIG.copy()
            await _guardar_interno(config_data)
        return config_data

async def guardar_configuracion(nueva_config):
    global config_data
    async with _get_lock():
        config_data.update(nueva_config)
        await _guardar_interno(config_data)

async def _guardar_interno(data):
    """Escribe la configuración de forma directa y segura en la Flash"""
    try:
        await asyncio.sleep_ms(10)


        with open(CONFIG_FILE, "w") as f:
            json.dump(data, f)
            f.flush()
        try:
            os.sync()
        except AttributeError:
            pass
            
        print("[CONFIG] Guardado completado en Flash.")
    except Exception as e:
        print("[CONFIG] Error al guardar configuración:", e)
    finally:
        await asyncio.sleep_ms(10)

async def cargar_wifi_config():
    try:
        if not archivo_existe(WIFI_CONFIG_FILE):
            return None
        with open(WIFI_CONFIG_FILE, "r") as f:
            cred = json.load(f)
            return cred
    except Exception as e:
        print("[CONFIG] Error al leer configuración WiFi:", e)
        return None

async def guardar_wifi_config(ssid, password):
    tmp_file = WIFI_CONFIG_FILE + ".tmp"
    try:
        with open(tmp_file, "w") as f:
            json.dump({"ssid": ssid, "pass": password}, f)
        try:
            os.remove(WIFI_CONFIG_FILE)
        except OSError:
            pass
        os.rename(tmp_file, WIFI_CONFIG_FILE)
        print("[CONFIG] Credenciales WiFi guardadas de forma atómica.")
        return True
    except Exception as e:
        print("[CONFIG] Error al guardar WiFi config:", e)
        try:
            os.remove(tmp_file)
        except OSError:
            pass
        return False

def archivo_existe(filepath):
    try:
        os.stat(filepath)
        return True
    except OSError:
        return False
