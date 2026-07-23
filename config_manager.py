# config_manager.py - Manejo de configuración persistente y segura en Flash
import json
import os
import uasyncio as asyncio

CONFIG_FILE = "config_dosimat.json"
WIFI_CONFIG_FILE = "wifi_config.json"

DEFAULT_CONFIG = {
    "config_version": 1,
    "tespera_seg": 3600,       # Tiempo de espera por defecto (1 hora)
    "tdosis_seg": 300,         # Tiempo de dosificación por defecto (5 minutos)
    "ajuste_baja": 10,         # % de ajuste en temporada baja (ej: 10%)
    "temporada_alta_inicio": "11-01",  # Inicio temporada alta (MM-DD)
    "temporada_alta_fin": "03-31"      # Fin temporada alta (MM-DD)
}

config_data = {}
_lock = asyncio.Lock()

async def cargar_configuracion():
    global config_data
    async with _lock:
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
    async with _lock:
        config_data.update(nueva_config)
        await _guardar_interno(config_data)

async def _guardar_interno(data):
    """Escribe de manera atómica usando un archivo temporal para prevenir corrupción"""
    tmp_file = CONFIG_FILE + ".tmp"
    try:
        await asyncio.sleep_ms(10)
        try:
            import main
            if hasattr(main, "feed_wdt"): main.feed_wdt()
        except Exception: pass

        with open(tmp_file, "w") as f:
            json.dump(data, f)
            
        await asyncio.sleep_ms(10)
        try:
            import main
            if hasattr(main, "feed_wdt"): main.feed_wdt()
        except Exception: pass

        try:
            os.remove(CONFIG_FILE)
        except OSError:
            pass
        os.rename(tmp_file, CONFIG_FILE)
        print("[CONFIG] Guardado atómico completado.")
    except Exception as e:
        print("[CONFIG] Error al guardar configuración:", e)
        try:
            os.remove(tmp_file)
        except OSError:
            pass
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
