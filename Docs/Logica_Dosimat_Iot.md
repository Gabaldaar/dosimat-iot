LÓGICA DEL DOSIMAT IoT
🧠 1. Objetivo del sistema
El Dosimat IoT controla automáticamente:
•	Filtrado de piscina
•	Dosificación automática y manual de cloro
•	Ajustes estacionales
•	Antiatasco
•	Registro de eventos
•	Control manual del equipo
Toda la lógica corre en un ESP32 con un RTC DS3231.
⚙️ 2. Componentes funcionales
Hardware relevante
•	Bomba de filtrado
•	Válvula dosificadora
•	RTC DS3231 (hora + temperatura)
•	ESP32 (control general)
Parámetros configurables
•	TFILTRO (duración del filtrado)
•	TDOSIS (duración base de la dosis)
•	TESPERA (tiempo previo a abrir válvula)
•	Temporada Alta (inicio/fin)
•	Temporada Baja (ajuste porcentual)
•	Programas de filtrado (hasta 10)
•	Anulación de dosis (hasta 5)
•	Refuerzo (duplica la próxima dosis)
🔄 3. Estados del sistema
El equipo opera en estados definidos:
•	En_espera
•	Filtrando
•	Dosificando
•	Pausado
•	Antiatasco
•	Reinicio
Reglas de transición
•	En_espera → Filtrando (cuando inicia un programa)
•	Filtrando → Dosificando (si el programa incluye dosis)
•	Dosificando → Filtrando (al terminar TDOSISTOTAL)
•	Filtrando → En_espera (al terminar TFILTRO)
•	Cualquier estado → Pausado (si el usuario lo activa)
•	Pausado → En_espera (al desactivarse)
•	En_espera → Antiatasco (>25h sin abrir válvula)
•	Antiatasco → En_espera (al terminar 3s)
🧩 4. Acciones del sistema
Automáticas
•	Encender bomba
•	Apagar bomba
•	Abrir válvula
•	Cerrar válvula
•	Ejecutar antiatasco
•	Registrar evento
•	Calcular dosis según temporada y refuerzo
•	Ejecutar programas de filtrado
Manuales
•	Encender/apagar bomba
•	Iniciar dosis manual
•	Activar refuerzo
•	Activar pausa
•	Reset de fábrica (solo técnico)
📏 5. Reglas de operación
5.1 Filtrado
•	Se ejecuta según programas configurados
•	Requiere bomba ON
•	Puede incluir dosificación
•	Si la bomba se apaga → cerrar válvula inmediatamente
5.2 Dosis automática (si el programa la incluye)
1.	Encender bomba
2.	Esperar TESPERA
3.	Abrir válvula
4.	Mantenerla abierta por TDOSISTOTAL
5.	Cerrar válvula
6.	Continuar filtrado hasta completar TFILTRO
7.	Registrar evento
Si la bomba se apaga → cerrar válvula inmediatamente
5.3 Dosis manual
1.	Encender bomba
2.	Esperar TESPERA
3.	Abrir válvula
4.	Mantenerla abierta por TDOSISTOTAL 
5.	Cerrar válvula
6.	Mantener bomba encendida 30 minutos
7.	Apagar bomba
8.	Registrar evento
9.	Si la bomba se apaga → cerrar válvula inmediatamente

5.4 Temporadas
Temporada Alta
Código
TDOSISTOTAL = TDOSIS
Temporada Baja
Código
TDOSISTOTAL = TDOSIS × ajuste_baja
5.5 Refuerzo (regla integrada)
Si el refuerzo está activado, duplica el tiempo final, sin importar la temporada.
Código
Si refuerzo = true:
    TDOSISTOTAL = TDOSISTOTAL × 2
El refuerzo se desactiva automáticamente después de aplicarse.
5.6 Anulación de dosis
•	Se pueden anular hasta 5 dosis futuras
•	Cada dosis ejecutada reduce el contador
•	Al llegar a 0, el sistema vuelve al comportamiento normal
5.7 Antiatasco
•	Si pasan >25h sin abrir válvula
•	Abrir válvula 3 segundos
•	Registrar evento
•	Volver a En_espera
🗓️ 6. Programas de filtrado
Cada programa define:
•	Hora de inicio
•	Duración del filtrado
•	Si incluye dosificación
•	Días de la semana
Máximo: 10 programas
Reglas:
•	Si el equipo está Pausado → no se ejecuta
•	Si incluye dosis → aplicar lógica de dosificación automática
•	Si la bomba se apaga → cerrar válvula
•	Si se solapan programas → ejecutar el primero que coincide
🧾 7. Eventos
Se registran los últimos 10 eventos:
•	Dosis automática
•	Dosis manual
•	Antiatasco
•	Reinicio
•	Inicio de pausa
•	Fin de pausa
Cada evento incluye:
•	Fecha y hora
•	Descripción del evento
•	Duración
•	Modo (manual/automático)
•	Refuerzo (true/false)

8. Flujos completos
Flujo de dosis automática
1.	Programa coincide
2.	Encender bomba
3.	TESPERA
4.	Abrir válvula
5.	TDOSISTOTAL (con temporada + refuerzo)
6.	Cerrar válvula
7.	Continuar filtrado
8.	Registrar evento
Flujo de dosis manual
1.	Usuario inicia
2.	Encender bomba
3.	TESPERA
4.	Abrir válvula
5.	TDOSISTOTAL (con temporada + refuerzo)
6.	Cerrar válvula
7.	Bomba 30 min
8.	Apagar bomba
9.	Registrar evento
Flujo de pausa
•	Activar pausa → detener ejecución de programas (Aviso llamativo)
•	Desactivar pausa → volver a En_espera
Flujo de antiatasco
•	Detectar >25h sin dosis
•	Abrir válvula 3s
•	Registrar evento
•	Volver a En_espera
