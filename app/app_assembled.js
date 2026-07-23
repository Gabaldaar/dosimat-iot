// === ESTADO GLOBAL ===
var globalEstadoDosificador = "IDLE";
var globalModoCiclo = "AUTO";
var globalRefuerzo = 0;
var globalDosisAnuladas = 0;
var currentDosisSec = 0;
var lastConfigData = null;
var lastProgramasData = null;
var pendingCommand = null;

function obtenerListaProgramas() {
    const items = [];
    const rows = document.querySelectorAll('.crono-row');
    if (rows && rows.length > 0) {
        rows.forEach(row => {
            const timeInp = row.querySelector('.inp-time');
            const durInp = row.querySelector('.inp-dur');
            const dosisInp = row.querySelector('.inp-dosis');
            if (!timeInp || !durInp) return;

            let timeVal = timeInp.value;
            const durVal = parseInt(durInp.value) || 0;
            const dosifica = dosisInp ? dosisInp.checked : false;

            let diasStr = "";
            row.querySelectorAll('.day-btn').forEach((btn, idx) => {
                if (btn.classList.contains('active')) diasStr += idx;
            });

            if (timeVal && durVal > 0) {
                items.push({
                    on: timeVal,
                    duracion: durVal,
                    dosifica: dosifica,
                    dias: diasStr || "0123456"
                });
            }
        });
    }

    if (items.length > 0) return items;

    if (typeof lastProgramasData !== 'undefined' && lastProgramasData) {
        for (let i = 1; i <= 10; i++) {
            const inicio = lastProgramasData[`PR${i}_inicio`];
            const duracion = lastProgramasData[`PR${i}_duracion_min`];
            const dosifica = lastProgramasData[`PR${i}_dosifica`];
            const dias = lastProgramasData[`PR${i}_dias`];
            if (inicio && duracion > 0) {
                const diasStr = Array.isArray(dias) ? dias.join("") : (dias !== undefined ? String(dias) : "0123456");
                items.push({
                    on: inicio,
                    duracion: duracion,
                    dosifica: !!dosifica,
                    dias: diasStr
                });
            }
        }
    }

    if (items.length > 0) return items;
    return [{ on: "21:00", duracion: 60, dosifica: true, dias: "0123456" }];
}

function calcularProximoEvento() {
    const cron = obtenerListaProgramas();
    if (!cron || cron.length === 0) return null;

    const now = new Date();
    const currentJsDay = now.getDay(); // 0=Dom, 1=Lun ... 6=Sab
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let candidates = [];

    for (let d = 0; d < 7; d++) {
        const targetJsDay = (currentJsDay + d) % 7;
        const cronoDayIndex = (targetJsDay + 6) % 7; // 0=Lun ... 6=Dom
        const cronoDayStr = String(cronoDayIndex);

        for (let item of cron) {
            if (!item.on || item.duracion <= 0) continue;
            if (item.dias && item.dias.includes(cronoDayStr)) {
                let timeStr = item.on;
                if (!timeStr.includes(":") && timeStr.length === 4) {
                    timeStr = `${timeStr.substring(0,2)}:${timeStr.substring(2,4)}`;
                }
                const parts = timeStr.split(":");
                const itemMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);

                if (d === 0 && itemMins <= currentMins) continue;

                candidates.push({
                    dayOffset: d,
                    targetJsDay: targetJsDay,
                    mins: itemMins,
                    timeStr: timeStr,
                    duracionMin: item.duracion,
                    dosifica: (item.dosifica === true || item.dosis === 1 || item.dosis === true)
                });
            }
    console.warn("No se pudo cargar la autoconfiguración del Hosting.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === ESTADO GLOBAL ===
let currentUser = null;
let currentMac = null;
        </div>
    </div>

    <!-- Banner de Instalación PWA -->
    <div id="pwaInstallBanner" class="install-banner" style="display: none;">
        <div class="install-banner-content">
            <span class="material-symbols-outlined install-icon">add_to_home_screen</span>
            <div style="flex: 1; text-align: left;">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">Instalar Dosimat IoT</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">Accede más rápido y sin conexión desde tu pantalla de inicio.</div>
            </div>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
                <button class="btn outline" id="btnCancelInstall" style="width: auto; padding: 0.4rem 0.65rem; font-size: 0.75rem; border-color: var(--text-muted); color: var(--text-muted);">Ahora no</button>
                <button class="btn" id="btnAcceptInstall" style="width: auto; padding: 0.4rem 0.65rem; font-size: 0.75rem;">Instalar</button>
            </div>
        </div>
    </div>

    <!-- 1. Pantalla: Dashboard / Control -->
    <div id="tab-dashboard" class="container active">
        <!-- Tarjeta de Estado Principal -->
        <div class="card panel-estado" id="panelEstado" style="min-height: 140px; display: flex; flex-direction: column; justify-content: center; position: relative;">
            <span id="panelLed" class="panel-led off" style="position: absolute; top: 15px; left: 15px; margin: 0;"></span>
            <span class="material-symbols-outlined btn-help" data-help="panel-estado" style="position: absolute; top: 15px; right: 15px;">help</span>
            <div class="estado-header" style="display: flex; align-items: center; justify-content: center; gap: 0.8rem; margin: 0;">
                <span id="iconEstado" class="material-symbols-outlined anim-clock" style="font-size: 2.5rem; color: var(--text-muted);">schedule</span>
                <span class="estado-titulo" id="lblEstado" style="display: block; margin: 0; text-align: left;">Inactivo</span>
            </div>
            <p id="lblEstadoSubtexto" class="estado-subtexto" style="margin-top: 0.8rem; display: flex; align-items: center; justify-content: center; min-height: 40px; margin-bottom: 0;">Esperando telemetría del equipo...</p>
        </div>

        <!-- Indicadores Rápidos -->
        <div class="status-grid">
            <div class="status-item" id="panelBomba">
                <span class="material-symbols-outlined" style="color: var(--text-muted);">mode_fan</span>
                <div class="status-label">Bomba</div>
                <div class="status-val" id="lblBomba">OFF</div>
            </div>
            <div class="status-item" id="panelTemporada">
                <span class="material-symbols-outlined" id="iconTemporada" style="color: var(--warning);">wb_sunny</span>
                <div class="status-label" id="lblTemporadaFechas" style="color: var(--text-muted);">--/-- al --/--</div>
                <div class="status-val" id="lblTemporadaTitulo" style="color: var(--accent); margin-top: 2px;">Temp. Alta</div>
            </div>
            <div class="status-item" id="panelRefuerzo">
                <span class="material-symbols-outlined" style="color: var(--text-muted);">bolt</span>
                <div class="status-label">Refuerzo</div>
                <div class="status-val" id="lblRefuerzo">OFF</div>
            </div>
            <div class="status-item" id="panelTemp">
                <span id="iconTemp" class="material-symbols-outlined" style="color: var(--text-muted);">thermostat</span>
                <div class="status-label">Temp. RTC</div>
                <div class="status-val" id="lblTemp">--°C</div>
            </div>
            <div class="status-item" id="panelProxDosis">
                <span class="material-symbols-outlined" style="color: var(--text-muted);">schedule</span>
                <div class="status-label">Próxima Dosis</div>
                <div class="status-val" id="lblProxDosis" style="font-size: 1.1rem; line-height: 1.6rem;">--:--</div>
            </div>
        </div>

    const tr = currentDosisSec;
    const isManual = globalModoCiclo === "MANUAL";
    
    if (globalEstadoDosificador === "IDLE") {
        const prox = calcularProximoEvento();
        let html = "";
        if (prox) {
            const iconTempHTML = prox.esTemporadaAlta 
                ? `<span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--warning); vertical-align: middle;" title="Temporada Alta">wb_sunny</span>`
                : `<span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--accent); vertical-align: middle;" title="Temporada Baja">ac_unit</span>`;
            
            const iconRefuerzoHTML = prox.refuerzoActivo
                ? ` - <span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--warning); vertical-align: middle;" title="Refuerzo Activo">bolt</span>`
                : "";

            const line1 = `${prox.tipo} - ${prox.diaTexto}`;
            let line2 = `<span class="material-symbols-outlined" style="font-size: 1rem; vertical-align: middle; color: var(--text-muted);">schedule</span> - ${prox.duracionTexto}`;
            
            if (prox.esDosis) {
                line2 += ` - ${iconTempHTML}${iconRefuerzoHTML}`;
            }

            html = `<div style="font-size: 0.95rem; color: var(--text-main); margin-bottom: 2px;">${line1}</div>`;
            html += `<div style="font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 4px;">${line2}</div>`;
        } else {
            html = `<div style="font-size: 0.9rem; color: var(--text-muted);">Esperando ciclo de dosificación.</div>`;
        }

        if (globalDosisAnuladas > 0) {
            html += `<div style="color: var(--warning); font-size: 0.8rem; margin-top: 4px; font-weight: 600;">⚠️ Próxima dosis automática ANULADA (restan: ${globalDosisAnuladas})</div>`;
        }
        lblEstadoSubtexto.innerHTML = html;
    } else if (globalEstadoDosificador === "FILTRO_PRE") {
        lblEstadoSubtexto.innerText = isManual ? `DOSIS MANUAL\nFiltrando. Esperando Dosis - Restan: ${formatTime(tr)}` : `Bomba de filtrado activa (Estabilizando). Fin de fase en: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "FILTRO_POST" || globalEstadoDosificador === "FILTRO") {
        lblEstadoSubtexto.innerText = isManual ? `DOSIS MANUAL\nFiltrado post Dosis - Restan: ${formatTime(tr)}` : `Bomba de filtrado activa (Post-lavado). Fin de fase en: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "FILTRO_MANUAL") {
        lblEstadoSubtexto.innerText = `FILTRANDO\nBomba activa por ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "DOSIS") {
        lblEstadoSubtexto.innerText = isManual ? `DOSIS MANUAL\nDosificando cloro - Restan: ${formatTime(tr)}` : `Dosificando cloro - Restan: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "PAUSA") {
        lblEstadoSubtexto.innerText = "Ciclo suspendido temporalmente por mantenimiento.";
    } else if (globalEstadoDosificador === "ANTI") {
        lblEstadoSubtexto.innerText = `Ciclo antiatasco activo. Tiempo restante: ${tr}s`;
    } else if (globalEstadoDosificador === "RESET") {
        lblEstadoSubtexto.innerText = "Inicializando hardware...";
    }
}

// Simulated Countdown
setInterval(() => {
    if (globalEstadoDosificador === "FILTRO_MANUAL") {
        currentDosisSec++;
        updateSubtexto();
    } else if (currentDosisSec > 0 && globalEstadoDosificador !== "IDLE" && globalEstadoDosificador !== "PAUSA" && globalEstadoDosificador !== "RESET") {
        currentDosisSec--;
        updateSubtexto();
        if (currentDosisSec === 0) {
            globalEstadoDosificador = "IDLE";
            updateSubtexto();
            updateUI({estado: "IDLE", tr: 0});
        }
    }
}, 1000);

// === LOGS TERMINAL UI ===
function formatLogEvent(logData) {
    let timestamp = logData.fecha || "";
    if (!timestamp && logData.ts) {
        const tsJS = logData.ts < 100000 ? Date.now() : (logData.ts + 946684800) * 1000;
        timestamp = new Date(tsJS).toLocaleString('es-AR', { timeZone: 'UTC', hour12: false });
    }
    if (!timestamp) timestamp = new Date().toLocaleString('es-AR', { hour12: false });

    const tipo = logData.tipo || "";
    
    if (tipo === "info" && logData.msg && logData.msg.includes("Sistema Dosimat iniciado")) {
        return `${timestamp} - Se reinició el equipo`;
    }
    
    if (tipo === "estado_dosis") {
        const isManual = logData.modo === "MANUAL";
        const d = logData.duracion || logData.segundos || 0;
        const durMin = Math.floor(d / 60).toString().padStart(2, '0');
        const durSeg = (d % 60).toString().padStart(2, '0');
        const refStr = logData.refuerzo ? "on" : "off";
        const tempStr = logData.temporada || "Desconocida";
        const modoStr = isManual ? "Dosis Manual" : "Dosis Automática";
        return `${timestamp} - ${modoStr} - Durac. ${durMin}:${durSeg} - Refuerzo: ${refStr} - Temp: ${tempStr}`;
    }
    
    if (tipo === "dosis_anulada") {
        return `${timestamp} - Dosis Automática: anulada a petición del usuario`;
    }
    
    if (tipo === "estado_anti") {
        return `${timestamp} - Protección Antiatasco`;
    }
    
    if (tipo === "pausa") {
        return `${timestamp} - Modo Mantenimiento Activado`;
    }
    
    if (tipo === "reanudar") {
        return `${timestamp} - Modo Mantenimiento Desactivado`;
    }
    
    return null;
}

function renderMqttLog(logData) {
    const term = document.getElementById('logsTerminal');
    if (term) {
        if (term.innerText.includes("Esperando")) term.innerText = "";
        
        const eventStr = formatLogEvent(logData);
        if (eventStr) {
            term.innerText = eventStr + "\n" + term.innerText;
        }
    }
}

document.getElementById('btnPedirHistorial').onclick = () => {
    const term = document.getElementById('logsTerminal');
    if (term) term.innerText = "Solicitando historial al equipo...\n";
    sendCommand({comando: "GET_LOGS"});
};

// === CONTROL SWITCHES AUXILIARY FUNCTIONS ===
function setSwitchesDisabled(disabled) {
            </h2>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">Configura hasta 10 horarios diarios de filtrado y dosificación.</p>
            
            <div id="cronogramaContainer">
                <!-- Se inyectan las filas dinámicamente -->
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.50rem; margin-top: 1rem;">
                <button class="btn outline" id="btnAgregarHorario">Agregar Horario</button>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn outline" id="btnProgAuto" style="flex: 1;">Programa Automático</button>
                    <button class="btn" id="btnGuardarCronograma" style="flex: 1;">Guardar Cronograma</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 3. Pantalla: Configuración General (WiFi y Diagnósticos del Sistema) -->
    <div id="tab-configuracion" class="container">
        <!-- Tarjeta de Conexión BLE Local -->
        <div class="card">
            <h2 style="display: flex; align-items: center; width: 100%;">
                <span>Vinculación Bluetooth</span>
                <span class="material-symbols-outlined btn-help" data-help="vinculo-ble">help</span>
            </h2>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem;">Conéctate directamente al dosificador por Bluetooth para realizar configuraciones locales y sincronizar logs.</p>
            <button class="btn" id="btnShowConnectBLE">Buscar Dosificador por BLE</button>
        </div>

        <div class="card">
            <h2 style="display: flex; align-items: center; width: 100%;">
                <span>Conectividad WiFi local</span>
                <span class="material-symbols-outlined btn-help" data-help="wifi-local">help</span>
            </h2>
            <div class="form-group">
                <label>Red WiFi (SSID)</label>
                <input type="text" id="inpWifiSsid" placeholder="Nombre de la red">
            </div>
            <div class="form-group">
                <label>Contraseña WiFi</label>
                <div class="pass-wrapper">
                    <input type="password" id="inpWifiPwd" placeholder="••••••••">
                    <span class="material-symbols-outlined btn-toggle-pass" id="btnToggleWifiPass">visibility</span>
                </div>
            </div>
            <button class="btn outline" id="btnGuardarWifi">Registrar Red WiFi</button>
        </div>
    </div>

        btnActionAuth.innerText = "Registrar Cuenta";
        lblAuthSwitchText.innerText = "¿Ya tienes cuenta?";
        lnkAuthSwitch.innerText = "Inicia Sesión";
    } else {
        authMode = "LOGIN";
        groupNombre.style.display = "none";
        btnActionAuth.innerText = "Iniciar Sesión";
        lblAuthSwitchText.innerText = "¿No tienes cuenta?";
        lnkAuthSwitch.innerText = "Regístrate";
    }
};

btnActionAuth.onclick = async () => {
    const email = txtEmail.value.trim();
    const password = txtPassword.value.trim();
    lblAuthError.innerText = "";

    if (!email || !password) {
        lblAuthError.innerText = "Por favor, completa todos los campos.";
        return;
    }

    try {
        if (authMode === "LOGIN") {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            const name = txtNombre.value.trim();
            if (!name) {
                lblAuthError.innerText = "Por favor, ingresa tu nombre.";
                return;
            }
            const credentials = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(credentials.user, { displayName: name });
        }
    } catch (e) {
        lblAuthError.innerText = e.message.replace("Firebase:", "").trim();
    }
};

// Iniciar Sesión con Google
document.getElementById('btnGoogleAuth').onclick = async () => {
                        <li><strong>Calcule la cantidad diaria de cloro necesaria</strong> para su piscina, según la temporada:
                            <ul style="list-style-type: disc;">
                                <li>Verano: 1 litro de cloro cada 20.000 litros de agua.</li>
                                <li>Invierno: 1 litro de cloro cada 40.000 litros de agua.</li>
                            </ul>
                        </li>
                        <li><strong>Sume un 20% al valor calculado</strong>, ya que la calibración se realiza con agua (con menor peso específico que el cloro).
                            <ul style="list-style-type: disc;">
                                <li>Ejemplo: Para una piscina de 40.000 litros, en verano:</li>
                                <li>Dosis = 40.000L agua ÷ (1L cloro / 20.000L agua) = 2L cloro</li>
                                <li>Dosis + 20% = 2L + 0,4L = 2,4 Litros</li>
                            </ul>
                        </li>
                        <li><strong>Llene un balde</strong> con una cantidad conocida de agua (por ejemplo, 10 litros) usando una jarra medidora o un balde graduado.</li>
                        <li><strong>Coloque los succionadores</strong> de cloro (ubicados en los reservorios) dentro del balde.<br>
                        <em>Atención: Manipule los succionadores con cuidado, ya que pueden estar cubiertos de cloro.</em></li>
                        <li><strong>Encienda la bomba.</strong></li>
                        <li>En la pantalla <strong>Panel</strong>, active la función <strong>Dosis Manual</strong>.</li>
                        <li>El equipo comenzará a dosificar y verá que el nivel de agua en el balde disminuye.</li>
                        <li>Al finalizar el ciclo, <strong>mida cuánta agua queda</strong> en el balde. Reste este valor al inicial para obtener la dosis de agua aplicada.
                            <ul style="list-style-type: disc;">
                                <li>Ejemplo: 10L (inicial) - 7L (final) = 3 litros dosificados</li>
                            </ul>
                        </li>
                        <li>Repita desde el paso 3, ajustando la dosis en "Program", hasta alcanzar el valor deseado.</li>
                        <li>Vuelva a colocar los succionadores en los reservorios de cloro.</li>
                    </ol>
                </div>
            </details>

            <details name="ayuda-accordion" class="accordion">
                <summary>Sugerencias para mantener su pileta</summary>
                <div class="accordion-content">
                    <ul style="list-style-type: disc;">
                        <li>Controle periódicamente el valor del pH del agua. Debe mantenerse entre 7.2 y 7.6. Un pH incorrecto neutraliza la acción del cloro.</li>
                        <li>Asegúrese de que el nivel de agua esté siempre por encima de la mitad de la boca del skimmer.</li>
                        <li>Verifique regularmente el buen funcionamiento de la bomba.</li>
                        <li>Si realiza modificaciones en la instalación (como colocar un calefactor, reparar o cambiar la bomba) es posible que el caudal de agua cambie y el dosificador requiera una nueva calibración.</li>
                        <li>Procure no desechar el agua al pasar el barrefondo, ya que es agua tratada. Solo deséchela si tiene demasiada suciedad.</li>

    if (unsubscribeFirestore) unsubscribeFirestore();
    if (unsubscribeConfig) unsubscribeConfig();
    if (unsubscribeProgramas) unsubscribeProgramas();
    if (unsubscribeLogs) unsubscribeLogs();
    
    // Escuchar Firestore en tiempo real para Estado
    unsubscribeFirestore = onSnapshot(doc(db, "equipos", currentMac, "estado", "actual"), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            updateUI(data);
        }
    });

    // Escuchar Firestore en tiempo real para Configuración
    unsubscribeConfig = onSnapshot(doc(db, "equipos", currentMac, "config", "actual"), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            updateConfigUI(data);
        }
    });

    // Escuchar Firestore en tiempo real para Programas
    unsubscribeProgramas = onSnapshot(doc(db, "equipos", currentMac, "programas", "actual"), (snapshot) => {
        if (snapshot.exists()) {
            updateProgramasUI(snapshot.data());
        } else {
            updateProgramasUI(null);
        }
    });

    // Escuchar Firestore en tiempo real para Logs
    unsubscribeLogs = onSnapshot(query(collection(db, "equipos", currentMac, "logs"), orderBy("timestamp", "desc"), limit(50)), (snapshot) => {
        const term = document.getElementById('logsTerminal');
        if (term) {
            term.innerText = "";
            const docs = [];
            snapshot.forEach(docSnap => docs.push(docSnap.data()));
            docs.reverse().forEach(logData => {
                const eventStr = formatLogEvent(logData);
                if (eventStr) {
                    term.innerText = eventStr + "\n" + term.innerText;
                }
            });
        }
    });

    // Conectar Paho MQTT para logs e interactivos
    if (mqttClient) {
        try { mqttClient.disconnect(); } catch(e){}
    }

    const clientId = `pwa_client_${currentMac}_${Math.floor(Math.random() * 10000)}`;
    const isHttps = window.location.protocol === "https:";
    const port = isHttps ? 8884 : 8000; // WebSocket ports
    const path = isHttps ? "/mqtt" : "/mqtt";

    // Nota: Usamos broker.hivemq.com WebSocket público
    mqttClient = new Paho.MQTT.Client("broker.hivemq.com", port, path, clientId);
    
    mqttClient.onConnectionLost = (responseObject) => {
        if (responseObject.errorCode !== 0) {
            console.error("MQTT Connection Lost:", responseObject.errorMessage);
            if (modoConexion !== "BLE") setConexionModo("OFFLINE");
            setTimeout(connectNube, 5000);
        }
    };

    mqttClient.onMessageArrived = (message) => {
        const topic = message.destinationName;
        const payload = message.payloadString;
        try {
            const data = JSON.parse(payload);
            const innerData = data.tipo === "TELEMETRIA" ? data.data : data;

            if (topic === `dosimat/${currentMac}/telemetry`) {
                if (modoConexion !== "BLE") {
                    setConexionModo("NUBE", innerData.wifi_ssid || "");
                    updateUI(innerData);
                }
            } else if (topic === `dosimat/${currentMac}/sys_log`) {
                const logItem = innerData.tipo === "LOG_ENTRY" ? innerData.data : innerData;
                renderMqttLog(logItem);
            } else if (topic === `dosimat/${currentMac}/config`) {
                if (data.tipo && data.tipo.startsWith("ACK_")) {
                    updateUI(data);
                } else {
                    updateConfigUI(innerData);
                }
            }
        } catch (e) {
        <button class="nav-btn" data-target="programacion">
            <span class="material-symbols-outlined">calendar_today</span>
            <span>Programar</span>
        </button>
        <button class="nav-btn" data-target="configuracion">
            <span class="material-symbols-outlined">settings</span>
            <span>Ajustes</span>
        </button>
        <button class="nav-btn" data-target="logs">
            <span class="material-symbols-outlined">receipt_long</span>
            <span>Historial</span>
        </button>
        <button class="nav-btn" data-target="soporte">
            <span class="material-symbols-outlined">help</span>
            <span>Ayuda</span>
        </button>
        <button class="nav-btn" data-target="tecnicos" id="navTecnicos" style="display: none;">
            <span class="material-symbols-outlined">manage_accounts</span>
            <span>Técnicos</span>
        </button>
    </nav>

    <!-- Modal de confirmaciones personalizado -->
    <div id="customModal" class="overlay">
        <div class="overlay-content">
            <h3 id="modalTitle">Confirmación</h3>
            <p id="modalMessage" style="margin: 1rem 0; color: var(--text-muted);"></p>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
                <button class="btn outline" id="btnModalCancel" style="width: auto; padding: 0.5rem 1rem;">Cancelar</button>
                <button class="btn" id="btnModalConfirm" style="width: auto; padding: 0.5rem 1rem;">Confirmar</button>
            </div>
        </div>
    </div>

    <script type="module" src="app.js"></script>
</body>
</html>

                }

                // 2. Parser de telemetría compacta
                const innerData = data.tipo === "TELEMETRIA" ? data.data : data;
                const chipId = innerData.id_equipo || data.id_equipo;

                // 3. Vinculación y registro automático libre
                if (chipId && currentUser) {
                    const oldMac = currentMac;
                    currentMac = chipId;
                    document.getElementById('lblMac').innerText = currentMac;

                    if (oldMac !== currentMac) {
                        try {
                            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js");
                            
                            // Escribir propietario del equipo
                            const refProp = doc(db, "equipos", currentMac, "propietarios", currentUser.uid);
                            await setDoc(refProp, { activo: true }, { merge: true });
                            
                            // Escribir equipo asignado al usuario
                            const refAsign = doc(db, "usuarios", currentUser.uid, "equipos_asignados", currentMac);
                            await setDoc(refAsign, { activo: true }, { merge: true });
                            
                            // Guardar mac activa en el perfil del usuario
                            const refUser = doc(db, "usuarios", currentUser.uid);
                            await setDoc(refUser, { id_equipo: currentMac }, { merge: true });

                            console.log(`Hardware ${currentMac} vinculado automáticamente en Firestore.`);
                        } catch (err) {
                            console.error("Fallo al escribir vinculación:", err);
                        }
                        connectNube();
                    }

                    // Solicitar descarga de logs offline una sola vez
                    if (!logsSyncTriggered) {
                        logsSyncTriggered = true;
                        bleLogsTemp = [];
                        console.log("Iniciando descarga de logs...");
                        setTimeout(() => {
                            sendCommand({comando: "GET_LOGS"}, true);
// MISSING LINE 601
// MISSING LINE 602
// MISSING LINE 603
// MISSING LINE 604
// MISSING LINE 605
// MISSING LINE 606
// MISSING LINE 607
// MISSING LINE 608
// MISSING LINE 609
// MISSING LINE 610
// MISSING LINE 611
// MISSING LINE 612
// MISSING LINE 613
// MISSING LINE 614
// MISSING LINE 615
// MISSING LINE 616
// MISSING LINE 617
// MISSING LINE 618
// MISSING LINE 619
        // Enviar por BLE en chunks de 20 bytes
        const rawStr = JSON.stringify(obj) + "\n";
        const encoder = new TextEncoder();
        const rawBytes = encoder.encode(rawStr);
        
        try {
            const chunkSize = 20;
            for (let i = 0; i < rawBytes.length; i += chunkSize) {
                const subArray = rawBytes.subarray(i, i + chunkSize);
                await rxCharacteristic.writeValueWithoutResponse(subArray);
                        bleLogsTemp = [];
                        console.log("Iniciando descarga de logs...");
                        setTimeout(() => {
                            sendCommand({comando: "GET_LOGS"}, true);
                            sendCommand({comando: "GET_CONFIG"}, true);
                        }, 1500);
                    }
                }
                
                updateUI(data);

            } catch (e) {
                console.error("Fallo decodificación BLE:", e);
            }
        }
        boundary = rxBuffer.indexOf('\n');
    }
}

async function sendCommand(obj, silent = false) {
    if (!silent) showToast("Enviando orden al dosificador...", true);

    if (modoConexion === "BLE" && rxCharacteristic) {
        bleTxQueue.push(obj);
        if (!isBleTxActive) _processBleQueue();
    } else if (currentMac) {
        // Enviar vía Nube (Firestore / triggers)
        try {
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js");
            const payload = {
                comando_solicitado: obj.comando
            };
            if (obj.refuerzo !== undefined) payload.refuerzo_solicitado = !!obj.refuerzo;
            
            await setDoc(doc(db, "equipos", currentMac, "estado", "actual"), payload, { merge: true });
            console.log("Comando guardado en Firestore:", obj.comando);
        } catch (e) {
            console.error("Fallo envío Nube:", e);
            showToast("Error de conexión a la nube", true);
        }
    }
}

async function _processBleQueue() {
    if (bleTxQueue.length === 0) {
        isBleTxActive = false;
        return;
    }
    isBleTxActive = true;
    const obj = bleTxQueue.shift();
    const rawStr = JSON.stringify(obj) + "\n";
    const encoder = new TextEncoder();
    const rawBytes = encoder.encode(rawStr);
    
    try {
        const chunkSize = 20;
        for (let i = 0; i < rawBytes.length; i += chunkSize) {
            const subArray = rawBytes.subarray(i, i + chunkSize);
            await rxCharacteristic.writeValueWithoutResponse(subArray);
            await new Promise(r => setTimeout(r, 45));
        }
        console.log("Comando enviado por BLE:", obj.comando);
    } catch (e) {
        console.error("Fallo envío BLE:", e);
        showToast("No se pudo enviar orden por Bluetooth", true);
    }
    setTimeout(_processBleQueue, 100);
}

function syncRtcBLE() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    sendCommand({
        comando: "sync_rtc",
        fecha: `${y}-${m}-${d}`,
        hora: `${h}:${min}`
    }, true);
}

// === INTERFAZ GRÁFICA (PWA UPDATE) ===
function updateUI(raw_data) {
    if (!raw_data) return;

    if (raw_data.tipo === "ACK_CFG") {
        const receivedVersion = raw_data.v;
        if (pendingConfigVersion && receivedVersion >= pendingConfigVersion) {
            console.log("Config confirmada por ACK_CFG!");
            clearTimeout(pendingConfigTimeoutId);
            pendingConfigVersion = null;
            setFormInputsDisabled(false);
            showToast("Tiempos actualizados en el hardware.");
        }
        return;
    }

    if (raw_data.tipo === "ACK_CRON") {
    if (modoConexion === "BLE" && rxCharacteristic) {
        bleTxQueue.push(obj);
        if (!isBleTxActive) _processBleQueue();
    } else if (currentMac) {
        // Enviar vía Nube (Firestore / triggers)
        try {
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js");
            const payload = {
                comando_solicitado: obj.comando,
                _ts: Date.now() // Forzar actualización de documento siempre

                // 2. Parser de telemetría compacta
                const innerData = data.tipo === "TELEMETRIA" ? data.data : data;
                const chipId = innerData.id_equipo || data.id_equipo;

                // 3. Vinculación y registro automático libre
                if (chipId && currentUser) {
                    const oldMac = currentMac;
                    currentMac = chipId;
                    document.getElementById('lblMac').innerText = currentMac;

                    if (oldMac !== currentMac) {
                        try {
                            
                            // Escribir propietario del equipo
                            const refProp = doc(db, "equipos", currentMac, "propietarios", currentUser.uid);
                            await setDoc(refProp, { activo: true }, { merge: true });
                            
                            // Escribir equipo asignado al usuario
                            const refAsign = doc(db, "usuarios", currentUser.uid, "equipos_asignados", currentMac);
                            await setDoc(refAsign, { activo: true }, { merge: true });
                            
                            // Guardar mac activa en el perfil del usuario
                            const refUser = doc(db, "usuarios", currentUser.uid);
                            await setDoc(refUser, { id_equipo: currentMac }, { merge: true });

                            console.log(`Hardware ${currentMac} vinculado automáticamente en Firestore.`);
                        } catch (err) {
                            console.error("Fallo al escribir vinculación:", err);
                        }
                        connectNube();
                    }

                    // Solicitar descarga de logs offline una sola vez
                    if (!logsSyncTriggered) {
                        logsSyncTriggered = true;
// MISSING LINE 776
// MISSING LINE 777
// MISSING LINE 778
// MISSING LINE 779
// MISSING LINE 780
// MISSING LINE 781
// MISSING LINE 782
// MISSING LINE 783
// MISSING LINE 784
// MISSING LINE 785
// MISSING LINE 786
// MISSING LINE 787
// MISSING LINE 788
// MISSING LINE 789
            document.getElementById('inpWifiSsid').disabled = false;
            document.getElementById('inpWifiPwd').disabled = false;
            showToast("Credenciales WiFi guardadas en el equipo.");
        }
        return;
    }

    const data = raw_data.tipo === "TELEMETRIA" ? raw_data.data : raw_data;
    
    globalEstadoDosificador = data.est || data.estado || "IDLE";
    globalRefuerzo = data.ref !== undefined ? data.ref : (data.Refuerzo || 0);

    // Validar si el estado coincide con lo que el usuario ordenó
    if (pendingCommand) {
        if (pendingCommand.checkFn(globalEstadoDosificador, globalRefuerzo)) {
            console.log("Comando confirmado por el hardware!");
            clearTimeout(pendingCommand.timeoutId);
            pendingCommand = null;
            setSwitchesDisabled(false);
            showToast("Orden ejecutada con éxito");
        }
    }

    // También verificar si la telemetría Nube/MQTT reporta la versión de configuración actualizada
    const receivedVer = data.config_version !== undefined ? data.config_version : (data.v !== undefined ? data.v : null);
    if (pendingConfigVersion && receivedVer >= pendingConfigVersion) {
        console.log("Config confirmada por telemetría!");
        clearTimeout(pendingConfigTimeoutId);
        pendingConfigVersion = null;
        setFormInputsDisabled(false);
        showToast("Tiempos actualizados en el hardware.");
    }

    const panelEstado = document.getElementById('panelEstado');
    const lblEstado = document.getElementById('lblEstado');
    const lblEstadoSubtexto = document.getElementById('lblEstadoSubtexto');

    const mapaEstados = {
        "IDLE": "En espera",
        "FILTRO_PRE": "Filtrando (Estabilización)",
        "FILTRO_POST": "Filtrando (Post-dosis)",
        "FILTRO_MANUAL": "Bomba Encendida (Manual)",
        "DOSIS": "Dosificando",
        "PAUSA": "Pausado",
        "ANTI": "Antiatasco",
        "RESET": "Reinicio"
    };

    lblEstado.innerText = mapaEstados[globalEstadoDosificador] || globalEstadoDosificador;
    panelEstado.className = "card panel-estado";

    if (globalEstadoDosificador === "DOSIS") {
        panelEstado.classList.add("bg-green-soft");
    } else if (globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "FILTRO_POST" || globalEstadoDosificador === "FILTRO") {
        panelEstado.classList.add("bg-blue-soft");
    } else if (globalEstadoDosificador === "PAUSA" || globalEstadoDosificador === "ANTI" || globalEstadoDosificador === "RESET") {
        panelEstado.style.backgroundColor = "var(--danger-light)";
        panelEstado.style.borderColor = "var(--danger)";
        panelEstado.style.color = "var(--danger)";
    } else {
        panelEstado.style.backgroundColor = "";
    }

    let tr = data.tr !== undefined ? data.tr : 0;
    currentDosisSec = tr;
    updateSubtexto(); // Llamada a renderizar el texto

function updateSubtexto() {
    const lblEstadoSubtexto = document.getElementById('lblEstadoSubtexto');
    const tr = currentDosisSec;
    if (globalEstadoDosificador === "IDLE") {
        lblEstadoSubtexto.innerText = `Esperando ciclo de dosificación.`;
    } else if (globalEstadoDosificador === "FILTRO_PRE") {
        lblEstadoSubtexto.innerText = `Bomba de filtrado activa (Estabilizando). Fin de fase en: ${tr}s`;
    } else if (globalEstadoDosificador === "FILTRO_POST" || globalEstadoDosificador === "FILTRO") {
        lblEstadoSubtexto.innerText = `Bomba de filtrado activa (Post-lavado). Fin de fase en: ${tr}s`;
    } else if (globalEstadoDosificador === "DOSIS") {
        lblEstadoSubtexto.innerText = `Dosificando cloro. Fin de fase en: ${tr}s`;
    } else if (globalEstadoDosificador === "PAUSA") {
        lblEstadoSubtexto.innerText = "Ciclo suspendido temporalmente por mantenimiento.";
    } else if (globalEstadoDosificador === "ANTI") {
        lblEstadoSubtexto.innerText = `Ciclo antiatasco activo. Tiempo restante: ${tr}s`;
    } else if (globalEstadoDosificador === "RESET") {
        lblEstadoSubtexto.innerText = "Inicializando hardware...";
    }
}

// Simulated Countdown
setInterval(() => {
    if (currentDosisSec > 0 && globalEstadoDosificador !== "IDLE" && globalEstadoDosificador !== "PAUSA" && globalEstadoDosificador !== "RESET") {
        currentDosisSec--;
        updateSubtexto();
    }
}, 1000);

    // Bomba Switch UI
    const panelBomba = document.getElementById('panelBomba');
    const lblBomba = document.getElementById('lblBomba');
    const tglBomba = document.getElementById('tglBomba');
    if (globalEstadoDosificador === "FILTRO" || globalEstadoDosificador === "DOSIS") {
        lblBomba.innerText = "ON";
        if (!pendingCommand) tglBomba.checked = true;
    } else {
        lblBomba.innerText = "OFF";
        if (!pendingCommand) tglBomba.checked = false;
    }

    // Refuerzo
    const panelRefuerzo = document.getElementById('panelRefuerzo');
    const lblRefuerzo = document.getElementById('lblRefuerzo');
    const tglRefuerzo = document.getElementById('tglRefuerzo');
    if (espera !== undefined) {
        const segs = parseInt(espera);
        document.getElementById('inpEsperaMin').value = Math.floor(segs / 60);
        document.getElementById('inpEsperaSeg').value = segs % 60;
    }

    const dosis = configData.tdosis_seg !== undefined ? configData.tdosis_seg : configData.Dosis;
    if (dosis !== undefined) {
        const segs = parseInt(dosis);
        document.getElementById('inpDosisMin').value = Math.floor(segs / 60);
    // Fechas (Formato MM-DD a dropdowns Dia/Mes)
    const vInicio = configData.temporada_alta_inicio || configData.Fverano;
    if (vInicio) {
        const parts = vInicio.split("-");
        if (parts.length === 2) {
            document.getElementById('selectFVeranoMes').value = parts[0];
            document.getElementById('selectFVeranoDia').value = parts[1];
        }
    }

    const fFin = configData.temporada_alta_fin || configData.Finvierno;
    if (fFin) {
        const parts = fFin.split("-");
        if (parts.length === 2) {
            document.getElementById('selectFInviernoMes').value = parts[0];
            document.getElementById('selectFInviernoDia').value = parts[1];
        }
    }
}
        console.log("Configuración confirmada por la nube!");
        clearTimeout(pendingConfigTimeoutId);
        pendingConfigVersion = null;
        setFormInputsDisabled(false);
        showToast("Tiempos actualizados en el hardware.");
    }

    if (unsavedChanges) return;

    // Tiempos (Segundos a Minutos/Segundos)
    const espera = configData.tespera_seg !== undefined ? configData.tespera_seg : configData.Espera;
    if (espera !== undefined) {
        const segs = parseInt(espera);
        document.getElementById('inpEsperaMin').value = Math.floor(segs / 60);
        document.getElementById('inpEsperaSeg').value = segs % 60;
    }

    const dosis = configData.tdosis_seg !== undefined ? configData.tdosis_seg : configData.Dosis;
    if (dosis !== undefined) {
        const segs = parseInt(dosis);
        document.getElementById('inpDosisMin').value = Math.floor(segs / 60);
        document.getElementById('inpDosisSeg').value = segs % 60;
    }

    // Ajuste de temporada baja
    const ajuste = configData.ajuste_baja !== undefined ? configData.ajuste_baja : configData.ajuste_baja;
    if (ajuste !== undefined) {
        const val = parseInt(ajuste);
        document.getElementById('inpAjusteBaja').value = val;
        document.getElementById('lblValAjusteBaja').innerText = `${val}%`;
    }

    // Fechas (Formato MM-DD a dropdowns Dia/Mes)
    const vInicio = configData.temporada_alta_inicio || configData.Fverano;
    if (vInicio) {
        const parts = vInicio.split("-");
        if (parts.length === 2) {
            document.getElementById('selectFVeranoMes').value = parts[0];
            document.getElementById('selectFVeranoDia').value = parts[1];
        }
    }

    const fFin = configData.temporada_alta_fin || configData.Finvierno;
    if (fFin) {
        const parts = fFin.split("-");
        if (parts.length === 2) {
            document.getElementById('selectFInviernoMes').value = parts[0];
            document.getElementById('selectFInviernoDia').value = parts[1];
        }
    }
}
    document.getElementById('tglRefuerzo').checked = (globalRefuerzo === 1);
    document.getElementById('tglMantenimiento').checked = (globalEstadoDosificador === "PAUSA");
}

function triggerSwitchCommand(switchId, commandObj, checkFn) {
    if (pendingCommand) return;

    const switchEl = document.getElementById(switchId);
    const prevVal = !switchEl.checked; // Estado anterior antes del click

    setSwitchesDisabled(true);

    const timeoutId = setTimeout(() => {
        // Rollback
        switchEl.checked = prevVal;
        setSwitchesDisabled(false);
        pendingCommand = null;
        customAlert("El dosificador no respondió a la orden. Comprueba la conexión del equipo (WiFi o Bluetooth).", "Error de comunicación");
        reaplicarEstadoUI();
        panelEstado.style.color = "var(--danger)";
        if (iconEstado) {
            iconEstado.innerText = globalEstadoDosificador === "ANTI" ? "autorenew" : "pause_circle";
            iconEstado.className = globalEstadoDosificador === "ANTI" ? "material-symbols-outlined anim-spin" : "material-symbols-outlined";
            iconEstado.style.color = "var(--danger)";
        }
    } else {
        // IDLE o por defecto
        if (globalDosisAnuladas > 0) {
            panelEstado.style.backgroundColor = "var(--warning-light)";
            panelEstado.style.borderColor = "var(--warning)";
            panelEstado.style.color = "var(--warning-dark)";
        } else {
            panelEstado.style.backgroundColor = "";
            panelEstado.style.borderColor = "";
            panelEstado.style.color = "";
        }
        if (iconEstado) {
            iconEstado.innerText = "schedule";
            iconEstado.className = "material-symbols-outlined anim-clock";
            iconEstado.style.color = globalDosisAnuladas > 0 ? "var(--warning-dark)" : "var(--text-muted)";
        }
    }

    let tr = data.tr !== undefined ? data.tr : 0;
    currentDosisSec = tr;

    // Bomba Switch UI
    const panelBomba = document.getElementById('panelBomba');
    const lblBomba = document.getElementById('lblBomba');
    const tglBomba = document.getElementById('tglBomba');
    const iconBomba = panelBomba.querySelector('.material-symbols-outlined');
    if (globalEstadoDosificador === "FILTRO" || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "FILTRO_POST" || globalEstadoDosificador === "FILTRO_MANUAL") {
        lblBomba.innerText = "ON";
        if (iconBomba) {
            iconBomba.classList.add("anim-spin");
            iconBomba.style.color = "var(--success)";
        }
        if (!pendingCommand) tglBomba.checked = true;
    } else {
        lblBomba.innerText = "OFF";
        if (iconBomba) {
            iconBomba.classList.remove("anim-spin");
            iconBomba.style.color = "var(--text-muted)";
        }
        if (!pendingCommand) tglBomba.checked = false;
    }

    // Refuerzo
    const panelRefuerzo = document.getElementById('panelRefuerzo');
    const lblRefuerzo = document.getElementById('lblRefuerzo');
    const tglRefuerzo = document.getElementById('tglRefuerzo');
    const iconRefuerzo = panelRefuerzo.querySelector('.material-symbols-outlined');
    if (globalRefuerzo === 1) {
        lblRefuerzo.innerText = "ON";
        if (iconRefuerzo) iconRefuerzo.style.color = "var(--success)";
        if (!pendingCommand) tglRefuerzo.checked = true;
    } else {
        lblRefuerzo.innerText = "OFF";
        if (iconRefuerzo) iconRefuerzo.style.color = "var(--text-muted)";
        if (!pendingCommand) tglRefuerzo.checked = false;
    }

    // Mantenimiento (PAUSA)
    if (!pendingCommand) {
        document.getElementById('tglMantenimiento').checked = (globalEstadoDosificador === "PAUSA");
    }

    // Dosis Manual Switch
    if (!pendingCommand) {
        document.getElementById('tglDosisManual').checked = (globalModoCiclo === "MANUAL" && (globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador === "FILTRO_POST") && globalRefuerzo === 0);
    }

    // Temp
    if (data.temperatura_rtc !== undefined || data.temp !== undefined) {
        const temp = data.temperatura_rtc !== undefined ? data.temperatura_rtc : data.temp;
        const lblTemp = document.getElementById('lblTemp');
        const iconTemp = document.getElementById('iconTemp');
        const panelTemp = document.getElementById('panelTemp');
        
        lblTemp.innerText = `${temp.toFixed(1)}°C`;
        comando: commandObj.comando,
        checkFn: checkFn,
        timeoutId: timeoutId,
        prevVal: prevVal
    };

    sendCommand(commandObj);
}

// === CONTROL SWITCHES LISTENERS ===
document.getElementById('tglBomba').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglBomba', {comando: "START_CYCLE", refuerzo: false}, (est, ref) => est === "FILTRO" || est === "DOSIS");
    } else {
        triggerSwitchCommand('tglBomba', {comando: "CANCEL_CYCLE"}, (est, ref) => est === "IDLE");
    }
};

document.getElementById('tglDosisManual').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglDosisManual', {comando: "START_CYCLE", refuerzo: false}, (est, ref) => est === "DOSIS");
    } else {
        triggerSwitchCommand('tglDosisManual', {comando: "CANCEL_CYCLE"}, (est, ref) => est === "IDLE");
    }
};

document.getElementById('tglRefuerzo').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglRefuerzo', {comando: "START_CYCLE", refuerzo: true}, (est, ref) => ref === 1);
    } else {
        triggerSwitchCommand('tglRefuerzo', {comando: "START_CYCLE", refuerzo: false}, (est, ref) => ref === 0);
    }
};

document.getElementById('tglMantenimiento').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglMantenimiento', {comando: "PAUSE_CYCLE"}, (est, ref) => est === "PAUSA");
    } else {
        triggerSwitchCommand('tglMantenimiento', {comando: "RESUME_CYCLE"}, (est, ref) => est !== "PAUSA");
    }
document.querySelectorAll('#tab-programacion input, #tab-programacion select').forEach(inp => {
    inp.addEventListener('input', () => {
        unsavedChanges = true;
    });
});

document.getElementById('btnGuardarWifi').onclick = async () => {
    const ssid = document.getElementById('inpWifiSsid').value.trim();
    const pass = document.getElementById('inpWifiPwd').value;
    
    if (!ssid) {
        customAlert("El SSID de la red no puede estar vacío.");
        return;
    }

    const wifiBtn = document.getElementById('btnGuardarWifi');
    const wifiSsid = document.getElementById('inpWifiSsid');
    const wifiPwd = document.getElementById('inpWifiPwd');

    wifiBtn.disabled = true;
    wifiSsid.disabled = true;
    wifiPwd.disabled = true;

    pendingWifiTimeoutId = setTimeout(() => {
        wifiBtn.disabled = false;
        wifiSsid.disabled = false;
        wifiPwd.disabled = false;
        pendingWifiTimeoutId = null;
        customAlert("El dosificador no confirmó las credenciales de red. Comprueba la conexión.", "Error de comunicación");
    }, 5000);

    sendCommand({
        comando: "config_wifi",
        ssid: ssid,
        pass: pass
    });

    // Guardar también el SSID en Firestore para desestimar el prompt BLE
    if (currentMac) {
        try {
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js");
            await setDoc(doc(db, "equipos", currentMac, "config", "actual"), { wifi_ssid: ssid }, { merge: true });
        } catch(e) {
            console.error("Fallo al escribir SSID en Firestore:", e);
        }
    }
};

// === RESET DE FÁBRICA ===
document.getElementById('btnResetFabrica').onclick = async () => {
    if (await customConfirm("¿Estás seguro de restablecer el equipo a valores de fábrica? Esto borrará las configuraciones y los logs locales.", "Reset de Fábrica")) {
        sendCommand({comando: "FACTORY_RESET"});
    }
};

// === GESTIÓN DE CRONOGRAMA ===
function agregarFilaCronograma(timeVal, durVal, dosisVal, diasVal = "0123456") {
    const container = document.getElementById('cronogramaContainer');
    const div = document.createElement('div');
    div.className = 'crono-row';
    
    const topRow = document.createElement('div');
    topRow.className = 'crono-fields-grid';
    
    topRow.innerHTML = `
        <div class="crono-field">
            <label>Hora Inicio</label>
            <input type="time" class="inp-time" value="${timeVal}">
        </div>
        <div class="crono-field">
            <label>Duración (min)</label>
            <input type="number" class="inp-dur" value="${durVal}" placeholder="Min">
        </div>
        <div class="crono-field checkbox-field">
            <label>Dosificar</label>
            <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.85rem; margin:0; font-weight:600; cursor:pointer;">
                <input type="checkbox" class="inp-dosis" ${dosisVal ? 'checked' : ''}> Cloro
            </label>
        </div>
        <button class="btn-del" title="Eliminar horario">X</button>
    `;
    
    topRow.querySelector('.btn-del').onclick = () => {
        div.remove();
        updateNextDoseIndicator();
    };

    // Listeners locales para recalcular próxima dosis
    topRow.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
            updateNextDoseIndicator();
        });
    });

    const diasRow = document.createElement('div');
    diasRow.className = 'day-container';
    const letras = ['L','M','X','J','V','S','D'];
    letras.forEach((l, index) => {
        const btn = document.createElement('div');
        btn.className = 'day-btn';
        if (diasVal.includes(index.toString())) btn.classList.add('active');
        btn.innerText = l;
        btn.onclick = () => {
            btn.classList.toggle('active');
            setTimeout(updateNextDoseIndicator, 50);
        };
        diasRow.appendChild(btn);
    });

    div.appendChild(topRow);
    div.appendChild(diasRow);
    container.appendChild(div);
}

document.getElementById('btnAgregarHorario').onclick = () => {
    agregarFilaCronograma("09:00", 60, false, "0123456");
};

// Programa Automático
document.getElementById('btnProgAuto').onclick = () => {
    const container = document.getElementById('cronogramaContainer');
    container.innerHTML = ""; // Vaciar existentes
    agregarFilaCronograma("09:00", 60, false, "0123456");
    agregarFilaCronograma("14:00", 60, false, "0123456");
    agregarFilaCronograma("21:00", 60, true, "0123456");
    showToast("Programa automático precargado. Recuerda Guardar.");
    updateNextDoseIndicator();
};

document.getElementById('btnGuardarCronograma').onclick = async () => {
    const items = [];
    document.querySelectorAll('.crono-row').forEach(row => {
        const timeVal = row.querySelector('.inp-time').value.replace(":", "");
        const durVal = parseInt(row.querySelector('.inp-dur').value) || 0;
        const dosisVal = row.querySelector('.inp-dosis').checked ? 1 : 0;
        
        let diasStr = "";
        row.querySelectorAll('.day-btn').forEach((btn, idx) => {
            if (btn.classList.contains('active')) diasStr += idx;
        });

        if (timeVal && durVal > 0) {
            items.push({
                on: timeVal,
                duracion: durVal,
                dosis: dosisVal,
                dias: diasStr
            });
        }
    });

    setCronogramaInputsDisabled(true);

    const waitTime = (modoConexion === "BLE") ? 10000 : 5000;
    pendingCronogramaTimeoutId = setTimeout(() => {
        setCronogramaInputsDisabled(false);
        pendingCronogramaTimeoutId = null;
        customAlert("El dosificador no confirmó los cambios del cronograma. Se revirtieron los cambios locales.", "Error de comunicación");
        updateProgramasUI(lastCronogramaData);
    }, waitTime);

    if (modoConexion === "BLE") {
        showToast("Enviando cronograma por BLE...");
        try {
            await sendCommand({comando: "cron_start", total: items.length}, true);
            await new Promise(r => setTimeout(r, 300));
            
            for (let i = 0; i < items.length; i++) {
                await sendCommand({
                    comando: "cron_add",
                    idx: i,
                    on: items[i].on,
                    duracion: items[i].duracion,
                    dosis: items[i].dosis,
                    dias: items[i].dias
                }, true);
                await new Promise(r => setTimeout(r, 300));
            }
            await sendCommand({comando: "cron_commit"});
        } catch(e) {
// MISSING LINE 1301
// MISSING LINE 1302
// MISSING LINE 1303
// MISSING LINE 1304
// MISSING LINE 1305
// MISSING LINE 1306
// MISSING LINE 1307
// MISSING LINE 1308
// MISSING LINE 1309
// MISSING LINE 1310
// MISSING LINE 1311
// MISSING LINE 1312
// MISSING LINE 1313
// MISSING LINE 1314
// MISSING LINE 1315
// MISSING LINE 1316
// MISSING LINE 1317
// MISSING LINE 1318
// MISSING LINE 1319
// MISSING LINE 1320
// MISSING LINE 1321
// MISSING LINE 1322
// MISSING LINE 1323
// MISSING LINE 1324
// MISSING LINE 1325
// MISSING LINE 1326
// MISSING LINE 1327
// MISSING LINE 1328
// MISSING LINE 1329
// MISSING LINE 1330
// MISSING LINE 1331
// MISSING LINE 1332
// MISSING LINE 1333
// MISSING LINE 1334
// MISSING LINE 1335
// MISSING LINE 1336
// MISSING LINE 1337
// MISSING LINE 1338
// MISSING LINE 1339
// MISSING LINE 1340
// MISSING LINE 1341
// MISSING LINE 1342
// MISSING LINE 1343
// MISSING LINE 1344
// MISSING LINE 1345
// MISSING LINE 1346
// MISSING LINE 1347
// MISSING LINE 1348
// MISSING LINE 1349
// MISSING LINE 1350
// MISSING LINE 1351
// MISSING LINE 1352
// MISSING LINE 1353
// MISSING LINE 1354
// MISSING LINE 1355
// MISSING LINE 1356
// MISSING LINE 1357
// MISSING LINE 1358
// MISSING LINE 1359
// MISSING LINE 1360
// MISSING LINE 1361
// MISSING LINE 1362
// MISSING LINE 1363
// MISSING LINE 1364
// MISSING LINE 1365
// MISSING LINE 1366
// MISSING LINE 1367
// MISSING LINE 1368
// MISSING LINE 1369
// MISSING LINE 1370
// MISSING LINE 1371
// MISSING LINE 1372
// MISSING LINE 1373
// MISSING LINE 1374
// MISSING LINE 1375
// MISSING LINE 1376
// MISSING LINE 1377
// MISSING LINE 1378
// MISSING LINE 1379
// MISSING LINE 1380
// MISSING LINE 1381
// MISSING LINE 1382
// MISSING LINE 1383
// MISSING LINE 1384
// MISSING LINE 1385
// MISSING LINE 1386
// MISSING LINE 1387
// MISSING LINE 1388
// MISSING LINE 1389
// MISSING LINE 1390
// MISSING LINE 1391
// MISSING LINE 1392
// MISSING LINE 1393
// MISSING LINE 1394
// MISSING LINE 1395
// MISSING LINE 1396
// MISSING LINE 1397
// MISSING LINE 1398
// MISSING LINE 1399
// MISSING LINE 1400
// MISSING LINE 1401
// MISSING LINE 1402
// MISSING LINE 1403
// MISSING LINE 1404
// MISSING LINE 1405
// MISSING LINE 1406
// MISSING LINE 1407
// MISSING LINE 1408
// MISSING LINE 1409
// MISSING LINE 1410
// MISSING LINE 1411
// MISSING LINE 1412
// MISSING LINE 1413
// MISSING LINE 1414
// MISSING LINE 1415
// MISSING LINE 1416
// MISSING LINE 1417
// MISSING LINE 1418
// MISSING LINE 1419
// MISSING LINE 1420
// MISSING LINE 1421
// MISSING LINE 1422
// MISSING LINE 1423
// MISSING LINE 1424
// MISSING LINE 1425
// MISSING LINE 1426
// MISSING LINE 1427
// MISSING LINE 1428
// MISSING LINE 1429
// MISSING LINE 1430
// MISSING LINE 1431
// MISSING LINE 1432
// MISSING LINE 1433
// MISSING LINE 1434
// MISSING LINE 1435
// MISSING LINE 1436
// MISSING LINE 1437
// MISSING LINE 1438
// MISSING LINE 1439
// MISSING LINE 1440
// MISSING LINE 1441
// MISSING LINE 1442
// MISSING LINE 1443
// MISSING LINE 1444
// MISSING LINE 1445
// MISSING LINE 1446
// MISSING LINE 1447
// MISSING LINE 1448
// MISSING LINE 1449
// MISSING LINE 1450
// MISSING LINE 1451
// MISSING LINE 1452
// MISSING LINE 1453
// MISSING LINE 1454
// MISSING LINE 1455
// MISSING LINE 1456
// MISSING LINE 1457
// MISSING LINE 1458
// MISSING LINE 1459
// MISSING LINE 1460
// MISSING LINE 1461
// MISSING LINE 1462
// MISSING LINE 1463
// MISSING LINE 1464
// MISSING LINE 1465
// MISSING LINE 1466
// MISSING LINE 1467
// MISSING LINE 1468
// MISSING LINE 1469
// MISSING LINE 1470
// MISSING LINE 1471
// MISSING LINE 1472
// MISSING LINE 1473
// MISSING LINE 1474
// MISSING LINE 1475
// MISSING LINE 1476
// MISSING LINE 1477
// MISSING LINE 1478
// MISSING LINE 1479
// MISSING LINE 1480
// MISSING LINE 1481
// MISSING LINE 1482
// MISSING LINE 1483
// MISSING LINE 1484
// MISSING LINE 1485
// MISSING LINE 1486
// MISSING LINE 1487
// MISSING LINE 1488
// MISSING LINE 1489
// MISSING LINE 1490
// MISSING LINE 1491
// MISSING LINE 1492
// MISSING LINE 1493
// MISSING LINE 1494
// MISSING LINE 1495
// MISSING LINE 1496
// MISSING LINE 1497
// MISSING LINE 1498
// MISSING LINE 1499
                    btn.innerText = "visibility_off";
                } else {
                    input.type = "password";
                    btn.innerText = "visibility";
                }
            };
        }
    };
    setupToggle("btnToggleAuthPass", "txtPassword");
    setupToggle("btnToggleWifiPass", "inpWifiPwd");
}

// === CONTROL DESLIZABLE DE TEMPORADA BAJA ===
const slider = document.getElementById('inpAjusteBaja');
const valLabel = document.getElementById('lblValAjusteBaja');
if (slider && valLabel) {
    slider.addEventListener('input', () => {
        valLabel.innerText = `${slider.value}%`;
    });
}
        customAlert("El dosificador está demorando en responder. Es posible que el comando se ejecute con retraso o que haya mala señal WiFi en el equipo.", "Demora en la comunicación");
        reaplicarEstadoUI();
    }, 15000);

    pendingCommand = {
        switchId: switchId,
        comando: commandObj.comando,
        checkFn: checkFn,
        timeoutId: timeoutId,
        prevVal: prevVal
    };

    sendCommand(commandObj);
}

// === CONTROL SWITCHES LISTENERS ===
document.getElementById('tglBomba').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglBomba', {comando: "START_PUMP"}, (est, ref) => est === "FILTRO_MANUAL");
    } else {
        triggerSwitchCommand('tglBomba', {comando: "CANCEL_CYCLE"}, (est, ref) => est === "IDLE");
    }
};

document.getElementById('tglDosisManual').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglDosisManual', {comando: "START_CYCLE", refuerzo: false}, (est, ref) => est === "FILTRO_PRE");
    } else {
        triggerSwitchCommand('tglDosisManual', {comando: "CANCEL_CYCLE"}, (est, ref) => est === "IDLE");
    }
};

document.getElementById('tglRefuerzo').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglRefuerzo', {comando: "SET_REFUERZO", refuerzo: true}, (est, ref) => ref === 1);
    } else {
        triggerSwitchCommand('tglRefuerzo', {comando: "SET_REFUERZO", refuerzo: false}, (est, ref) => ref === 0);
    }
};

document.getElementById('tglMantenimiento').onchange = (e) => {
    if (e.target.checked) {
        triggerSwitchCommand('tglMantenimiento', {comando: "PAUSE_CYCLE"}, (est, ref) => est === "PAUSA");
    } else {
        triggerSwitchCommand('tglMantenimiento', {comando: "RESUME_CYCLE"}, (est, ref) => est !== "PAUSA");
    }
};

// === CONTROL ANULAR DOSIS ===
let globalDosisAnuladas = 0;
document.getElementById('btnSumarAnulada').onclick = () => {
        
        querySnapshot.forEach((docSnap) => {
            const email = docSnap.id;
            
            const div = document.createElement('div');
            div.style.display = "flex";
            div.style.alignItems = "center";
            div.style.justifyContent = "space-between";
            div.style.padding = "0.5rem";
            div.style.background = "var(--bg-color)";
            div.style.borderRadius = "6px";
            div.style.border = "1px solid var(--card-border)";
            
            const span = document.createElement('span');
            span.innerText = email;
            
            const btnDelete = document.createElement('button');
            btnDelete.className = "btn-icon";
            btnDelete.innerHTML = '<span class="material-symbols-outlined" style="color: var(--danger);">delete</span>';
            btnDelete.onclick = async () => {
                if (await customConfirm(`¿Eliminar al técnico ${email}?`, "Eliminar Técnico")) {
                    await deleteDoc(doc(db, "tecnicos", email));
                    cargarTecnicosUI();
                }
            };
            
            div.appendChild(span);
            div.appendChild(btnDelete);
            lista.appendChild(div);
    document.getElementById('lblAnuladasControl').innerText = val;
    sendCommand({comando: "SET_ANULADAS", anuladas: val});
}

// === GUARDAR CONFIGURACIÓN ===
document.getElementById('btnGuardarConfig').onclick = async () => {
    const esperaMin = parseInt(document.getElementById('inpEsperaMin').value) || 0;
    const esperaSeg = parseInt(document.getElementById('inpEsperaSeg').value) || 0;
    const dosisMin = parseInt(document.getElementById('inpDosisMin').value) || 0;
    const dosisSeg = parseInt(document.getElementById('inpDosisSeg').value) || 0;

    const tespera_seg = (esperaMin * 60) + esperaSeg;
    const tdosis_seg = (dosisMin * 60) + dosisSeg;

    if (tespera_seg > 1800) {
        customAlert("El tiempo de espera no puede ser mayor a 30 minutos.", "Error de configuración");
        return;
    }
    if (tdosis_seg > 2700) {
        customAlert("El tiempo de dosis no puede ser mayor a 45 minutos.", "Error de configuración");
        return;
    }

    const ajusteBajaVal = parseInt(document.getElementById('inpAjusteBaja').value);
    
    const vMes = document.getElementById('selectFVeranoMes').value;
    const vDia = document.getElementById('selectFVeranoDia').value;
    const fVeranoVal = `${vMes}-${vDia}`; // Formato MM-DD

    const iMes = document.getElementById('selectFInviernoMes').value;
    const iDia = document.getElementById('selectFInviernoDia').value;
    const fInviernoVal = `${iMes}-${iDia}`; // Formato MM-DD

    const pendingVersion = Date.now();

    const payload = {
        comando: "UPDATE_CONFIG",
        config: {
            config_version: pendingVersion,
            tespera_seg: tespera_seg,
            tdosis_seg: tdosis_seg,
            ajuste_baja: ajusteBajaVal,
            temporada_alta_inicio: fVeranoVal,
            temporada_alta_fin: fInviernoVal
        }
    };

    setFormInputsDisabled(true);
    pendingConfigVersion = pendingVersion;
    pendingConfigTimeoutId = setTimeout(() => {
        setFormInputsDisabled(false);
        pendingConfigVersion = null;
        customAlert("El dosificador no respondió a los parámetros de tiempos. Se revirtieron los cambios locales.", "Error de comunicación");
        if (lastConfigData) {
            updateConfigUI(lastConfigData);
        }
    }, 5000);

    if (modoConexion === "BLE") {
        await sendCommand(payload);
    } else if (currentMac) {
        try {
            await setDoc(doc(db, "equipos", currentMac, "config", "actual"), payload.config);
            showToast("Guardando configuración en Nube...");
        } catch (e) {
            console.error("Fallo al escribir config:", e);
            clearTimeout(pendingConfigTimeoutId);
            pendingConfigVersion = null;
            setFormInputsDisabled(false);
            showToast("Fallo al guardar en la nube", true);
        }
    }
    unsavedChanges = false;
    
    const tempElement = document.getElementById('lblTemporada');
    if (tempElement && tempElement.innerText !== "-") {
        actualizarPanelTemporada(tempElement.innerText);
    }
};

// detectar ediciones locales para evitar sobreescribir formulario
// MISSING LINE 1681
// MISSING LINE 1682
// MISSING LINE 1683
// MISSING LINE 1684
// MISSING LINE 1685
// MISSING LINE 1686
// MISSING LINE 1687
// MISSING LINE 1688
// MISSING LINE 1689
// MISSING LINE 1690
// MISSING LINE 1691
// MISSING LINE 1692
// MISSING LINE 1693
// MISSING LINE 1694
// MISSING LINE 1695
// MISSING LINE 1696
// MISSING LINE 1697
// MISSING LINE 1698
// MISSING LINE 1699
// MISSING LINE 1700
// MISSING LINE 1701
// MISSING LINE 1702
// MISSING LINE 1703
// MISSING LINE 1704
// MISSING LINE 1705
// MISSING LINE 1706
// MISSING LINE 1707
// MISSING LINE 1708
// MISSING LINE 1709
// === CÁLCULO DE PRÓXIMA DOSIS CON DURACIÓN TOTAL ===
function updateNextDoseIndicator() {
    const lblProxDosis = document.getElementById('lblProxDosis');
    if (!lblProxDosis) return;

    // Obtener la duración de dosis activa
    const dosisMin = parseInt(document.getElementById('inpDosisMin').value) || 1;
    const dosisSeg = parseInt(document.getElementById('inpDosisSeg').value) || 30;
    const duracionDosisStr = `${dosisMin}m ${dosisSeg}s`;

    // Leer los horarios de filtrado que tienen cloro activo
    const items = [];
    document.querySelectorAll('.crono-row').forEach(row => {
        const timeVal = row.querySelector('.inp-time').value;
        const dosisVal = row.querySelector('.inp-dosis').checked;
        
        let diasStr = "";
        row.querySelectorAll('.day-btn').forEach((btn, idx) => {
            if (btn.classList.contains('active')) diasStr += idx;
        });

        if (timeVal && dosisVal) {
            items.push({
                time: timeVal,
                dias: diasStr.split("").map(Number)
            });
        }
    });

    if (items.length === 0) {
        lblProxDosis.innerText = "--:--";
        return;
    }

    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7; // Convertir Lunes=0 ... Domingo=6
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    let closestDiffMs = Infinity;
            <label>Duración (min)</label>
            <input type="number" class="inp-dur" value="${durVal}" placeholder="Min">
        </div>
        <div class="crono-field checkbox-field">
            <label>Dosificar</label>
            <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.85rem; margin:0; font-weight:600; cursor:pointer;">
                <input type="checkbox" class="inp-dosis" ${dosisVal ? 'checked' : ''}> Cloro
            </label>
        </div>
        <button class="btn-del" title="Eliminar horario">X</button>
    `;
    
    topRow.querySelector('.btn-del').onclick = () => {
        div.remove();
        updateNextDoseIndicator();
    };

    // Listeners locales para recalcular próxima dosis
    topRow.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
            updateNextDoseIndicator();
        });
    });

    const diasRow = document.createElement('div');
    diasRow.className = 'day-container';
    const letras = ['L','M','X','J','V','S','D'];
    letras.forEach((l, index) => {
        const btn = document.createElement('div');
        btn.className = 'day-btn';
        if (diasVal.includes(index.toString())) btn.classList.add('active');
        btn.innerText = l;
        btn.onclick = () => {
            btn.classList.toggle('active');
            setTimeout(updateNextDoseIndicator, 50);
        };
        diasRow.appendChild(btn);
    });

    div.appendChild(topRow);
    div.appendChild(diasRow);
    container.appendChild(div);
    return div;
}

document.getElementById('btnAgregarHorario').onclick = () => {
    const container = document.getElementById('cronogramaContainer');
    if (container.children.length >= 10) {
        customAlert("El máximo permitido es de 10 programas.");
        return;
    }
    agregarFilaCronograma("09:00", 60, false, "0123456");
};

// Programa Automático
document.getElementById('btnProgAuto').onclick = async () => {
    const result = await customConfirm("¿Estás seguro de cargar el Programa Automático? Esto sobrescribirá todos los horarios configurados actualmente.", "Programa Automático");
    if (result) {
        const container = document.getElementById('cronogramaContainer');
        container.innerHTML = ""; // Vaciar existentes
        agregarFilaCronograma("09:00", 60, false, "0123456");
        agregarFilaCronograma("14:00", 60, false, "0123456");
        agregarFilaCronograma("21:00", 60, true, "0123456");
        showToast("Programa automático precargado. Recuerda Guardar.");
        updateNextDoseIndicator();
        unsavedChanges = true;
    }
};

document.getElementById('btnGuardarCronograma').onclick = async () => {
    const items = [];
    let hasError = false;
    document.querySelectorAll('.crono-row').forEach(row => {
        const timeVal = row.querySelector('.inp-time').value.replace(":", "");
        const durVal = parseInt(row.querySelector('.inp-dur').value) || 0;
        const dosisVal = row.querySelector('.inp-dosis').checked ? 1 : 0;
        
        let diasStr = "";
        row.querySelectorAll('.day-btn').forEach((btn, idx) => {
            if (btn.classList.contains('active')) diasStr += idx;
        });

        if (timeVal && durVal > 0) {
            if (dosisVal === 1) {
                const tespera = lastConfigData?.tespera_seg || 0;
                const tdosis = lastConfigData?.tdosis_seg || 0;
                if ((durVal * 60) < (tespera + tdosis)) {
                    hasError = true;
                    customAlert(`El programa de las ${timeVal} tiene un tiempo de filtrado (${durVal} min) menor a la suma de Espera + Dosis. Por favor aumente la duración del filtrado.`, "Error en Cronograma");
                }
            }
            items.push({
                on: timeVal,
                duracion: durVal,
                dosis: dosisVal,
                dias: diasStr
            });
        }
    });

    if (hasError) return;
// MISSING LINE 1851
// MISSING LINE 1852
// MISSING LINE 1853
// MISSING LINE 1854
// MISSING LINE 1855
// MISSING LINE 1856
// MISSING LINE 1857
// MISSING LINE 1858
// MISSING LINE 1859
// MISSING LINE 1860
// MISSING LINE 1861
// MISSING LINE 1862
// MISSING LINE 1863
// MISSING LINE 1864
// MISSING LINE 1865
// MISSING LINE 1866
// MISSING LINE 1867
// MISSING LINE 1868
// MISSING LINE 1869
// MISSING LINE 1870
// MISSING LINE 1871
// MISSING LINE 1872
// MISSING LINE 1873
// MISSING LINE 1874
// MISSING LINE 1875
// MISSING LINE 1876
// MISSING LINE 1877
// MISSING LINE 1878
// MISSING LINE 1879
// MISSING LINE 1880
// MISSING LINE 1881
// MISSING LINE 1882
// MISSING LINE 1883
// MISSING LINE 1884
// MISSING LINE 1885
// MISSING LINE 1886
// MISSING LINE 1887
// MISSING LINE 1888
// MISSING LINE 1889
// MISSING LINE 1890
// MISSING LINE 1891
// MISSING LINE 1892
// MISSING LINE 1893
// MISSING LINE 1894
// MISSING LINE 1895
// MISSING LINE 1896
// MISSING LINE 1897
// MISSING LINE 1898
// MISSING LINE 1899
// MISSING LINE 1900
// MISSING LINE 1901
// MISSING LINE 1902
// MISSING LINE 1903
// MISSING LINE 1904
// MISSING LINE 1905
// MISSING LINE 1906
// MISSING LINE 1907
// MISSING LINE 1908
// MISSING LINE 1909
// MISSING LINE 1910
// MISSING LINE 1911
// MISSING LINE 1912
// MISSING LINE 1913
// MISSING LINE 1914
// MISSING LINE 1915
// MISSING LINE 1916
// MISSING LINE 1917
// MISSING LINE 1918
// MISSING LINE 1919
// MISSING LINE 1920
// MISSING LINE 1921
// MISSING LINE 1922
// MISSING LINE 1923
// MISSING LINE 1924
// MISSING LINE 1925
// MISSING LINE 1926
// MISSING LINE 1927
// MISSING LINE 1928
// MISSING LINE 1929
// MISSING LINE 1930
// MISSING LINE 1931
// MISSING LINE 1932
// MISSING LINE 1933
// MISSING LINE 1934
// MISSING LINE 1935
// MISSING LINE 1936
// MISSING LINE 1937
// MISSING LINE 1938
// MISSING LINE 1939
// MISSING LINE 1940
// MISSING LINE 1941
// MISSING LINE 1942
// MISSING LINE 1943
// MISSING LINE 1944
// MISSING LINE 1945
// MISSING LINE 1946
// MISSING LINE 1947
// MISSING LINE 1948
// MISSING LINE 1949
// MISSING LINE 1950
// MISSING LINE 1951
// MISSING LINE 1952
// MISSING LINE 1953
// MISSING LINE 1954
// MISSING LINE 1955
// MISSING LINE 1956
// MISSING LINE 1957
// MISSING LINE 1958
// MISSING LINE 1959
// MISSING LINE 1960
// MISSING LINE 1961
// MISSING LINE 1962
// MISSING LINE 1963
// MISSING LINE 1964
// MISSING LINE 1965
// MISSING LINE 1966
// MISSING LINE 1967
// MISSING LINE 1968
// MISSING LINE 1969
// MISSING LINE 1970
// MISSING LINE 1971
// MISSING LINE 1972
// MISSING LINE 1973
// MISSING LINE 1974
// MISSING LINE 1975
// MISSING LINE 1976
// MISSING LINE 1977
// MISSING LINE 1978
// MISSING LINE 1979
// MISSING LINE 1980
// MISSING LINE 1981
// MISSING LINE 1982
// MISSING LINE 1983
// MISSING LINE 1984
// MISSING LINE 1985
// MISSING LINE 1986
// MISSING LINE 1987
// MISSING LINE 1988
// MISSING LINE 1989
// MISSING LINE 1990
// MISSING LINE 1991
// MISSING LINE 1992
// MISSING LINE 1993
// MISSING LINE 1994
// MISSING LINE 1995
// MISSING LINE 1996
// MISSING LINE 1997
// MISSING LINE 1998
// MISSING LINE 1999
// MISSING LINE 2000
// MISSING LINE 2001
// MISSING LINE 2002
// MISSING LINE 2003
// MISSING LINE 2004
// MISSING LINE 2005
// MISSING LINE 2006
// MISSING LINE 2007
// MISSING LINE 2008
// MISSING LINE 2009
// MISSING LINE 2010
// MISSING LINE 2011
// MISSING LINE 2012
// MISSING LINE 2013
// MISSING LINE 2014
// MISSING LINE 2015
// MISSING LINE 2016
// MISSING LINE 2017
// MISSING LINE 2018
// MISSING LINE 2019
// MISSING LINE 2020
// MISSING LINE 2021
// MISSING LINE 2022
// MISSING LINE 2023
// MISSING LINE 2024
// MISSING LINE 2025
// MISSING LINE 2026
// MISSING LINE 2027
// MISSING LINE 2028
// MISSING LINE 2029
// MISSING LINE 2030
// MISSING LINE 2031
// MISSING LINE 2032
// MISSING LINE 2033
// MISSING LINE 2034
// MISSING LINE 2035
// MISSING LINE 2036
// MISSING LINE 2037
// MISSING LINE 2038
// MISSING LINE 2039
// MISSING LINE 2040
// MISSING LINE 2041
// MISSING LINE 2042
// MISSING LINE 2043
// MISSING LINE 2044
// MISSING LINE 2045
// MISSING LINE 2046
// MISSING LINE 2047
// MISSING LINE 2048
// MISSING LINE 2049
// MISSING LINE 2050
// MISSING LINE 2051
// MISSING LINE 2052
// MISSING LINE 2053
// MISSING LINE 2054
// MISSING LINE 2055
// MISSING LINE 2056
// MISSING LINE 2057
// MISSING LINE 2058
// MISSING LINE 2059
// MISSING LINE 2060
// MISSING LINE 2061
// MISSING LINE 2062
// MISSING LINE 2063
// MISSING LINE 2064
// MISSING LINE 2065
// MISSING LINE 2066
// MISSING LINE 2067
// MISSING LINE 2068
// MISSING LINE 2069
// MISSING LINE 2070
// MISSING LINE 2071
// MISSING LINE 2072
// MISSING LINE 2073
// MISSING LINE 2074
// MISSING LINE 2075
// MISSING LINE 2076
// MISSING LINE 2077
// MISSING LINE 2078
// MISSING LINE 2079
// MISSING LINE 2080
// MISSING LINE 2081
// MISSING LINE 2082
// MISSING LINE 2083
// MISSING LINE 2084
// MISSING LINE 2085
// MISSING LINE 2086
// MISSING LINE 2087
// MISSING LINE 2088
// MISSING LINE 2089
// MISSING LINE 2090
// MISSING LINE 2091
// MISSING LINE 2092
// MISSING LINE 2093
// MISSING LINE 2094
// MISSING LINE 2095
// MISSING LINE 2096
// MISSING LINE 2097
// MISSING LINE 2098
// MISSING LINE 2099
// MISSING LINE 2100
// MISSING LINE 2101
// MISSING LINE 2102
// MISSING LINE 2103
// MISSING LINE 2104
// MISSING LINE 2105
// MISSING LINE 2106
// MISSING LINE 2107
// MISSING LINE 2108
// MISSING LINE 2109
// MISSING LINE 2110
// MISSING LINE 2111
// MISSING LINE 2112
// MISSING LINE 2113
// MISSING LINE 2114
// MISSING LINE 2115
// MISSING LINE 2116
// MISSING LINE 2117
// MISSING LINE 2118
// MISSING LINE 2119
// MISSING LINE 2120
// MISSING LINE 2121
// MISSING LINE 2122
// MISSING LINE 2123
// MISSING LINE 2124
// MISSING LINE 2125
// MISSING LINE 2126
// MISSING LINE 2127
// MISSING LINE 2128
// MISSING LINE 2129
// MISSING LINE 2130
// MISSING LINE 2131
// MISSING LINE 2132
// MISSING LINE 2133
// MISSING LINE 2134
// MISSING LINE 2135
// MISSING LINE 2136
// MISSING LINE 2137
// MISSING LINE 2138
// MISSING LINE 2139
// MISSING LINE 2140
// MISSING LINE 2141
// MISSING LINE 2142
// MISSING LINE 2143
// MISSING LINE 2144
// MISSING LINE 2145
// MISSING LINE 2146
// MISSING LINE 2147
// MISSING LINE 2148
// MISSING LINE 2149
// MISSING LINE 2150
// MISSING LINE 2151
// MISSING LINE 2152
// MISSING LINE 2153
// MISSING LINE 2154
// MISSING LINE 2155
// MISSING LINE 2156
// MISSING LINE 2157
// MISSING LINE 2158
// MISSING LINE 2159
// MISSING LINE 2160
// MISSING LINE 2161
// MISSING LINE 2162
// MISSING LINE 2163
// MISSING LINE 2164
// MISSING LINE 2165
// MISSING LINE 2166
// MISSING LINE 2167
// MISSING LINE 2168
// MISSING LINE 2169
        updateNextDoseIndicator();
    });
});

// Mostrar vinculación BLE desde Ajustes
document.getElementById('btnShowConnectBLE').onclick = () => {
    document.getElementById('connectStatus').innerText = "Conéctate por Bluetooth para vincular y configurar tu equipo localmente.";
    document.getElementById('connectOverlay').style.display = "flex";
};



// Reloj dinámico del encabezado
setInterval(() => {
    const lblHeaderTime = document.getElementById('lblHeaderTime');
    if (lblHeaderTime) {
        const now = new Date();
        lblHeaderTime.innerText = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
}, 1000);

// Limpiar historial
const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
if (btnLimpiarHistorial) {
    btnLimpiarHistorial.onclick = () => {
        if(confirm("¿Estás seguro de que deseas vaciar el historial de eventos en el hardware?")) {
            sendCommand({ comando: "CLEAR_LOGS" });
        }
    };
}

console.log("Dosimat PWA v2 (Re-implementación) inicializada. v2.03");

// Botn Recomendar a un amigo
const btnRecomendar = document.getElementById("btnRecomendar");
if (btnRecomendar) {
    btnRecomendar.addEventListener("click", async () => {
        const shareData = {
            title: "Dosimat IoT - Automatiza tu piscina",
            text: "Hola! Estoy usando el equipo Dosimat para automatizar el cuidado de mi piscina y te lo recomiendo. Controla todo desde tu celular.",
            url: "https://dosimat-iot.web.app" // Cambiar por la URL real si es necesario
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                console.log("Compartido exitosamente");
            } else {
                // Fallback: copiar al portapapeles si Web Share API no est disponible (ej. PC)
                await navigator.clipboard.writeText(`${shareData.text} \n\n ${shareData.url}`);
                alert("El texto de recomendacin ha sido copiado al portapapeles! Puedes pegarlo donde quieras.");
            }
// MISSING LINE 2221
// MISSING LINE 2222
// MISSING LINE 2223
// MISSING LINE 2224
// MISSING LINE 2225
// MISSING LINE 2226
// MISSING LINE 2227
// MISSING LINE 2228
// MISSING LINE 2229
// MISSING LINE 2230
// MISSING LINE 2231
// MISSING LINE 2232
// MISSING LINE 2233
// MISSING LINE 2234
// MISSING LINE 2235
// MISSING LINE 2236
// MISSING LINE 2237
// MISSING LINE 2238
// MISSING LINE 2239
            
            // Buscar dueño
            let owner = "Sin asignar";
            const q = query(collection(db, "usuarios"), where("id_equipo", "==", mac));
            const userSnaps = await getDocs(q);
            if (!userSnaps.empty) {
                const userData = userSnaps.docs[0].data();
                owner = userData.email || "Usuario sin email";
                if (userData.nombre) owner = `${userData.nombre} (${owner})`;
            }
            
            const div = document.createElement('div');
            div.style = "background: var(--bg-color); padding: 1rem; border-radius: 6px; margin-bottom: 0.5rem; border: 1px solid var(--border);";
            
            div.innerHTML = `
                <div style="font-weight:bold; color:var(--text-main); font-size:1.1rem; margin-bottom:0.2rem;">${mac}</div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem;">Dueño: ${owner}</div>
                <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                    <button class="btn primary" style="padding: 0.4rem; flex:1;" onclick="connectRemoteDevice('${mac}')">Conectar</button>
                    ${currentUser && currentUser.email === "gab.aldazabal@gmail.com" ? `<button class="btn danger" style="padding: 0.4rem; flex:1;" onclick="adminResetEquipo('${mac}')">Reset Fábrica</button>` : ''}
                </div>
            `;
            container.appendChild(div);
        }
    } catch(e) {
        console.error("Error cargando admin:", e);
        container.innerHTML = "<p style='color: var(--danger); font-size: 0.9rem;'>Error cargando equipos.</p>";
    }
}

window.connectRemoteDevice = async (mac, isFromList = false, ownerName = "Sin asignar") => {
    if (!isFromList) {
        document.getElementById('inpRemoteMac').value = mac;
        document.getElementById('btnConnectRemote').click();
    } else {
        currentMac = mac;
        document.getElementById('headerTechMode').style.display = "block";
        document.getElementById('headerTechMac').innerText = `${mac} (${ownerName})`;
        document.getElementById('btnDisconnectTech').style.display = "inline-block";
        
        connectNube();
        const dbBtn = document.querySelector('nav [data-target="dashboard"]');
        if (dbBtn) switchTab(dbBtn, 'dashboard');
        showToast(`Conectado al equipo: ${mac}`);
    }
};

document.getElementById('btnConnectRemote').onclick = async () => {
    const mac = document.getElementById('inpRemoteMac').value.trim();
    if (!mac) {
        customAlert("Ingrese una MAC o ID de equipo.");
        return;
    }
    
    // Buscar dueño si no fue clickeado desde la lista
    let ownerName = "Buscando...";
    document.getElementById('headerTechMac').innerText = `${mac} (${ownerName})`;
    
    try {
        const q = query(collection(db, "usuarios"), where("id_equipo", "==", mac));
        const userSnaps = await getDocs(q);
// MISSING LINE 2301
// MISSING LINE 2302
// MISSING LINE 2303
// MISSING LINE 2304
// MISSING LINE 2305
// MISSING LINE 2306
// MISSING LINE 2307
// MISSING LINE 2308
// MISSING LINE 2309
// MISSING LINE 2310
// MISSING LINE 2311
// MISSING LINE 2312
// MISSING LINE 2313
// MISSING LINE 2314
// MISSING LINE 2315
// MISSING LINE 2316
// MISSING LINE 2317
// MISSING LINE 2318
// MISSING LINE 2319
// MISSING LINE 2320
// MISSING LINE 2321
// MISSING LINE 2322
// MISSING LINE 2323
// MISSING LINE 2324
// MISSING LINE 2325
// MISSING LINE 2326
// MISSING LINE 2327
// MISSING LINE 2328
// MISSING LINE 2329
// MISSING LINE 2330
// MISSING LINE 2331
// MISSING LINE 2332
// MISSING LINE 2333
// MISSING LINE 2334
// MISSING LINE 2335
// MISSING LINE 2336
// MISSING LINE 2337
// MISSING LINE 2338
// MISSING LINE 2339
// MISSING LINE 2340
// MISSING LINE 2341
// MISSING LINE 2342
// MISSING LINE 2343
// MISSING LINE 2344
// MISSING LINE 2345
// MISSING LINE 2346
// MISSING LINE 2347
// MISSING LINE 2348
// MISSING LINE 2349
// MISSING LINE 2350
// MISSING LINE 2351
// MISSING LINE 2352
// MISSING LINE 2353
// MISSING LINE 2354
// MISSING LINE 2355
// MISSING LINE 2356
// MISSING LINE 2357
// MISSING LINE 2358
// MISSING LINE 2359
// MISSING LINE 2360
// MISSING LINE 2361
// MISSING LINE 2362
// MISSING LINE 2363
// MISSING LINE 2364
// MISSING LINE 2365
// MISSING LINE 2366
// MISSING LINE 2367
// MISSING LINE 2368
// MISSING LINE 2369
// MISSING LINE 2370
// MISSING LINE 2371
// MISSING LINE 2372
// MISSING LINE 2373
// MISSING LINE 2374
// MISSING LINE 2375
// MISSING LINE 2376
// MISSING LINE 2377
// MISSING LINE 2378
// MISSING LINE 2379
// MISSING LINE 2380
// MISSING LINE 2381
// MISSING LINE 2382
// MISSING LINE 2383
// MISSING LINE 2384
// MISSING LINE 2385
// MISSING LINE 2386
// MISSING LINE 2387
// MISSING LINE 2388
// MISSING LINE 2389
// MISSING LINE 2390
// MISSING LINE 2391
// MISSING LINE 2392
// MISSING LINE 2393
// MISSING LINE 2394
// MISSING LINE 2395
// MISSING LINE 2396
// MISSING LINE 2397
// MISSING LINE 2398
// MISSING LINE 2399
// MISSING LINE 2400
// MISSING LINE 2401
// MISSING LINE 2402
// MISSING LINE 2403
// MISSING LINE 2404
// MISSING LINE 2405
// MISSING LINE 2406
// MISSING LINE 2407
// MISSING LINE 2408
// MISSING LINE 2409
// MISSING LINE 2410
// MISSING LINE 2411
// MISSING LINE 2412
// MISSING LINE 2413
// MISSING LINE 2414
// MISSING LINE 2415
// MISSING LINE 2416
// MISSING LINE 2417
// MISSING LINE 2418
// MISSING LINE 2419
// MISSING LINE 2420
// MISSING LINE 2421
// MISSING LINE 2422
// MISSING LINE 2423
// MISSING LINE 2424
// MISSING LINE 2425
// MISSING LINE 2426
// MISSING LINE 2427
// MISSING LINE 2428
// MISSING LINE 2429
// MISSING LINE 2430
// MISSING LINE 2431
// MISSING LINE 2432
// MISSING LINE 2433
// MISSING LINE 2434
// MISSING LINE 2435
// MISSING LINE 2436
// MISSING LINE 2437
// MISSING LINE 2438
// MISSING LINE 2439
// MISSING LINE 2440
// MISSING LINE 2441
// MISSING LINE 2442
// MISSING LINE 2443
// MISSING LINE 2444
// MISSING LINE 2445
// MISSING LINE 2446
// MISSING LINE 2447
// MISSING LINE 2448
// MISSING LINE 2449
// MISSING LINE 2450
// MISSING LINE 2451
// MISSING LINE 2452
// MISSING LINE 2453
// MISSING LINE 2454
// MISSING LINE 2455
// MISSING LINE 2456
// MISSING LINE 2457
// MISSING LINE 2458
// MISSING LINE 2459
// MISSING LINE 2460
// MISSING LINE 2461
// MISSING LINE 2462
// MISSING LINE 2463
// MISSING LINE 2464
// MISSING LINE 2465
// MISSING LINE 2466
// MISSING LINE 2467
// MISSING LINE 2468
// MISSING LINE 2469
// MISSING LINE 2470
// MISSING LINE 2471
// MISSING LINE 2472
// MISSING LINE 2473
// MISSING LINE 2474
// MISSING LINE 2475
// MISSING LINE 2476
// MISSING LINE 2477
// MISSING LINE 2478
// MISSING LINE 2479
// MISSING LINE 2480
// MISSING LINE 2481
// MISSING LINE 2482
// MISSING LINE 2483
// MISSING LINE 2484
// MISSING LINE 2485
// MISSING LINE 2486
// MISSING LINE 2487
// MISSING LINE 2488
// MISSING LINE 2489
// MISSING LINE 2490
// MISSING LINE 2491
// MISSING LINE 2492
// MISSING LINE 2493
// MISSING LINE 2494
// MISSING LINE 2495
// MISSING LINE 2496
// MISSING LINE 2497
// MISSING LINE 2498
// MISSING LINE 2499
    document.getElementById('lblMac').innerText = "-";
    setConexionModo("OFFLINE");
    
    const tecBtn = document.querySelector('nav [data-target="tecnicos"]');
    if (tecBtn) switchTab(tecBtn, 'tecnicos');
    showToast("Desconectado. Seleccione otro equipo.");
};

window.adminResetEquipo = async function(mac) {
    if (!await customConfirm(`¿Borrar TODO el historial y configuración del equipo ${mac}?`, "Reset de Fábrica")) return;
    try {
        await deleteDoc(doc(db, "equipos", mac, "configuracion", "actual"));
        await deleteDoc(doc(db, "equipos", mac, "programas", "actual"));
        await deleteDoc(doc(db, "equipos", mac, "estado", "actual"));
        const histSnap = await getDocs(collection(db, "equipos", mac, "historial_dosis"));
        histSnap.forEach(async (d) => { await deleteDoc(d.ref); });
        showToast("Equipo formateado con éxito");
    } catch(e) {
        customAlert("Error al formatear: " + e.message);
    }
};

// === FIN PORTAL TECNICO ===

// Eventos táctiles interactivas para las tarjetas del Dashboard
document.addEventListener("DOMContentLoaded", () => {
    const pBomba = document.getElementById('panelBomba');
    if (pBomba) {
        pBomba.onclick = () => {
            if (globalEstadoDosificador === "FILTRO_MANUAL") {
                sendCommand({ comando: "PAUSE_CYCLE" });
            } else {
                sendCommand({ comando: "START_PUMP" });
            }
        };
    }

    const pRefuerzo = document.getElementById('panelRefuerzo');
    if (pRefuerzo) {
        pRefuerzo.onclick = () => {
            const val = (globalRefuerzo === 1) ? false : true;
            sendCommand({ comando: "SET_REFUERZO", refuerzo: val });
        };
    }

    const pDosisManual = document.getElementById('panelDosisManual');
    if (pDosisManual) {