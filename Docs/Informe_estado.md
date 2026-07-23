# Estado del Proyecto Dosimat IoT V2
## Estructura de Tópicos MQTT
- Comandos entrantes (PWA -> ESP32): `dosimat/<CHIP_ID>/cmd`
- Telemetría general (ESP32 -> PWA): `dosimat/<CHIP_ID>/telemetry`
- Configuración y Parámetros: `dosimat/<CHIP_ID>/config`
- Cronogramas y Programación: `dosimat/<CHIP_ID>/programas`
- Historial y Logs: `dosimat/<CHIP_ID>/logs`
## Tiempos por Defecto de Fábrica (Ajustados)
- `tespera_seg`: 90 segundos (1m 30s)
- `tdosis_seg`: 90 segundos (1m 30s)
- `ajuste_baja`: 50%
- Temporada Alta: 30 de Octubre a 30 de Marzo
## PWA Desplegada
- Hosting: Firebase Hosting (`https://dosimat-iot-v2.web.app`)
- Versión actual: `v=6.50`
- Repositorio GitHub: `https://github.com/Gabaldaar/dosimat-iot.git` (rama `main`, commit `c9aeae2`)