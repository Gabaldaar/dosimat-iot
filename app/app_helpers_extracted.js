import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, getDocs, deleteDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// === FIREBASE INIT ===
const firebaseConfig = {
  apiKey: "AIzaSyCkkrfiHOcMG1_djAxg1G3ZzrD7F8SwcOY",
  authDomain: "dosimat-iot.firebaseapp.com",
  projectId: "dosimat-iot",
  storageBucket: "dosimat-iot.firebasestorage.app",
  messagingSenderId: "547969144575",
  appId: "1:547969144575:web:d7934b008655932cf29eca"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.getElementById('btnGuardarWifi').onclick = async () => {
    const ssid = document.getElementById('inpWifiSsid').value.trim();
    const pwd = document.getElementById('inpWifiPwd').value;
    if (!ssid) {
        customAlert("Debes ingresar el nombre de la red.");
        return;
    }
    
    if (!pwd) {
        if (!await customConfirm("No ingresaste ninguna contraseña. La mayoría de las redes Wi-Fi requieren una. ¿Estás seguro de que tu red es abierta y deseas continuar?", "Red sin contraseña", "Sí, continuar", "Cancelar")) {
            return;
        }
    }
    
    const isConnected = modoConexion !== "OFFLINE";
    const title = isConnected ? "Cambiar Wi-Fi" : "Vincular a Wi-Fi";
    const btnText = isConnected ? "Sí, cambiar" : "Sí, vincular";
    const warnText = isConnected ? `Si los datos son incorrectos, perderás la conexión remota.` : `El equipo intentará conectarse a internet.`;
    
    if (await customConfirm(`¿Estás seguro de enviar estas credenciales? El equipo se reiniciará para conectarse a "<b>${ssid}</b>". ${warnText}`, title, btnText, "Cancelar")) {
        sendCommand({comando: "config_wifi", ssid: ssid, pass: pwd});
        document.getElementById('inpWifiSsid').value = "";
        document.getElementById('inpWifiPwd').value = "";
        unsavedWifiChanges = false;
    }
};

document.getElementById('inpWifiSsid').addEventListener('input', () => unsavedWifiChanges = true);
document.getElementById('inpWifiSsid').addEventListener('change', () => unsavedWifiChanges = true);
document.getElementById('inpWifiSsid').addEventListener('focus', () => unsavedWifiChanges = true);
document.getElementById('inpWifiPwd').addEventListener('input', () => unsavedWifiChanges = true);
document.getElementById('inpWifiPwd').addEventListener('change', () => unsavedWifiChanges = true);
document.getElementById('inpWifiPwd').addEventListener('focus', () => unsavedWifiChanges = true);

// Toggle Password Visibility
const btnToggleWifiPwd = document.getElementById('btnToggleWifiPwd');
if (btnToggleWifiPwd) {
    btnToggleWifiPwd.onclick = () => {
        const inp = document.getElementById('inpWifiPwd');
        if (inp.type === "password") {
            inp.type = "text";
            btnToggleWifiPwd.innerText = "🙈";
        } else {
            inp.type = "password";
            btnToggleWifiPwd.innerText = "👁️";
        }
    };
}

// ==========================================
// PWA INSTALL LOGIC
// ==========================================
let deferredPrompt;
const installBanner = document.getElementById('installBanner');
const btnInstall = document.getElementById('btnInstall');
const btnInstallDismiss = document.getElementById('btnInstallDismiss');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('pwa_dismissed')) {
        installBanner.style.display = 'flex';
    }
});

btnInstall.addEventListener('click', async () => {
    installBanner.style.display = 'none';
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
    }
});

btnInstallDismiss.addEventListener('click', () => {
    installBanner.style.display = 'none';
    localStorage.setItem('pwa_dismissed', 'true');
});

window.addEventListener('appinstalled', () => {
    installBanner.style.display = 'none';
        // IDLE
        patronSel = (globalRefuerzo === 1) ? 'inactivo_refuerzo' : (modoConexion === "NUBE" ? 'En_espera_wifi' : 'En_espera_ble');
    }

    const patronEsperado = LED_PATRONES[patronSel] || LED_PATRONES['En_espera_ble'];

    if (estadoLedActual.patron !== patronEsperado) {
        estadoLedActual.patron = patronEsperado;
        estadoLedActual.indice = 0;
        estadoLedActual.ultimoCambio = Date.now();
        setLedUi(patronEsperado[0][0]);
    }

    let ahora = Date.now();
    let pasoActual = estadoLedActual.patron[estadoLedActual.indice];

    if (ahora - estadoLedActual.ultimoCambio >= pasoActual[1]) {
        estadoLedActual.indice = (estadoLedActual.indice + 1) % estadoLedActual.patron.length;
        estadoLedActual.ultimoCambio = ahora;
        let siguientePaso = estadoLedActual.patron[estadoLedActual.indice];
        setLedUi(siguientePaso[0]);
    }
}, 50);

function setLedUi(estado) {
    const led = document.getElementById('panelLed');
    if (led) {
        if (estado === 1) {
            led.classList.remove('off');
            led.classList.add('on');
        } else {
            led.classList.remove('on');
            led.classList.add('off');
        }
    }
}

// === TOAST SYSTEM ===
function showToast(msg, isWarning = false) {
    const container = document.getElementById('toastContainer') || (() => {
        const c = document.createElement('div');
        c.id = 'toastContainer';
        c.className = 'toast-container';
        document.body.appendChild(c);
        return c;
    })();

    const t = document.createElement('div');
    t.className = `toast ${isWarning ? 'warning' : ''}`;
    })();

    const t = document.createElement('div');
    t.className = `toast ${isWarning ? 'warning' : ''}`;
    t.innerText = msg;
    container.appendChild(t);

    setTimeout(() => t.classList.add('show'), 50);
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
    }, 3500);
}

// === MODAL DE CONFIRMACIÓN ===
function customConfirm(message, title = "Confirmar acción") {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalMessage').innerText = message;
        modal.style.display = 'flex';

        const onConfirm = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            document.getElementById('btnModalConfirm').removeEventListener('click', onConfirm);
            document.getElementById('btnModalCancel').removeEventListener('click', onCancel);
        };

            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        };

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
}

function customAlert(message, title = "Información") {
    return customConfirm(message, title);
}

// === GESTIÓN DE PESTAÑAS (SPA) ===
document.querySelectorAll('nav button').forEach(btn => {
    btn.onclick = () => {
        const target = btn.dataset.target;
        
        if (unsavedChanges && target !== "programacion") {
            customConfirm("Tienes cambios sin guardar en la programación. ¿Qué deseas hacer?", "Advertencia", 
                () => {
                    // Guardar y cambiar
                    document.getElementById('btnGuardarConfig').click();
                    setTimeout(() => switchTab(btn, target), 500);

// === AUTENTICACIÓN FIREBASE ===
const txtEmail = document.getElementById('txtEmail');
const txtPassword = document.getElementById('txtPassword');
const txtNombre = document.getElementById('txtNombre');
const btnActionAuth = document.getElementById('btnActionAuth');
const lnkAuthSwitch = document.getElementById('lnkAuthSwitch');
const lblAuthSwitchText = document.getElementById('lblAuthSwitchText');
const groupNombre = document.getElementById('groupNombre');
const lblAuthError = document.getElementById('lblAuthError');
let authMode = "LOGIN";

lnkAuthSwitch.onclick = (e) => {
    e.preventDefault();
    lblAuthError.innerText = "";
    if (authMode === "LOGIN") {
        authMode = "REGISTER";
        groupNombre.style.display = "block";
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
                    updateUI(data);
                }
            } else if (topic === `dosimat/${currentMac}/sys_log`) {
                renderMqttLog(innerData);
            } else if (topic === `dosimat/${currentMac}/config`) {
                updateConfigUI(innerData);
            }
        } catch (e) {
            console.error("Error procesando MQTT:", e);
        }
    };

    const options = {
        timeout: 4,
        useSSL: isHttps,
        onSuccess: () => {
            console.log("MQTT Conectado a HiveMQ");
            mqttClient.subscribe(`dosimat/${currentMac}/telemetry`);
            mqttClient.subscribe(`dosimat/${currentMac}/sys_log`);
            if (modoConexion !== "BLE") setConexionModo("NUBE");
        },
        onFailure: (err) => {
            console.error("MQTT Failure:", err);
            if (modoConexion !== "BLE") setConexionModo("OFFLINE");
            setTimeout(connectNube, 5000);
        }
    };

    mqttClient.connect(options);
}

// === GESTIÓN DE RED / CONEXIÓN ===
function setConexionModo(modo, ssid = "") {
    modoConexion = modo;
    const badge = document.getElementById('lblConnState');
    badge.className = "conn-badge";
    
    if (modo === "NUBE") {
        badge.classList.add("conn-nube");
        badge.innerText = `Nube ${ssid ? `(${ssid})` : ""}`;
    } else if (modo === "BLE") {
        badge.classList.add("conn-ble");
        badge.innerText = "BLE Local";
    } else {
        badge.classList.add("conn-offline");
        badge.innerText = "Offline";
    }
}

// === CONEXIÓN BLE (WEB BLUETOOTH) ===
document.getElementById('btnConnectBLE').onclick = async () => {
    const status = document.getElementById('connectStatus');
    status.innerText = "Escaneando dispositivos DOSIMAT...";
    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "Dosimat" }],
            optionalServices: [SERVICE_UUID]
        });

        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
        status.innerText = "Conectando al servidor GATT...";
        bleServer = await bleDevice.gatt.connect();

        status.innerText = "Buscando UART Service...";
        const service = await bleServer.getPrimaryService(SERVICE_UUID);

        status.innerText = "Configurando características...";
        rxCharacteristic = await service.getCharacteristic(RX_UUID);
        txCharacteristic = await service.getCharacteristic(TX_UUID);

        await txCharacteristic.startNotifications();
        txCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);

        status.innerText = "¡Conexión BLE establecida!";
        setConexionModo("BLE");
        setTimeout(() => {
            document.getElementById('connectOverlay').style.display = 'none';
        }, 800);

        // RTC sync inicial
        syncRtcBLE();

    } catch (e) {
        status.innerText = `Error BLE: ${e.message}`;
        console.error(e);
    }
};

document.getElementById('btnCancelBLE').onclick = () => {
    document.getElementById('connectOverlay').style.display = 'none';
};

function onDisconnected() {
    console.log("Servidor GATT BLE desconectado.");
    rxCharacteristic = null;
    txCharacteristic = null;
    logsSyncTriggered = false;
    
    if (currentMac) {
        setConexionModo("NUBE");
    } else {
        setConexionModo("OFFLINE");
    }
}

async function handleNotifications(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const chunk = decoder.decode(value);
    
    rxBuffer += chunk;
    
    let boundary = rxBuffer.indexOf('\n');
    while (boundary !== -1) {
        const line = rxBuffer.substring(0, boundary).trim();
        rxBuffer = rxBuffer.substring(boundary + 1);
        
        if (line) {
            try {
                const data = JSON.parse(line);
                
                // 1. Sincronización automática de Logs Offline
                if (data.tipo === "LOG_ENTRY" && data.data) {
                    bleLogsTemp.push(data.data);
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }
                
                if (data.tipo === "LOGS_END") {
                    if (bleLogsTemp.length > 0 && currentMac) {
                        try {
                            const { collection, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js");
                            const logsCol = collection(db, "equipos", currentMac, "logs");
                            for (const logItem of bleLogsTemp) {
                                const logId = `log_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                                await setDoc(doc(logsCol, logId), {
                                    fecha: logItem.fecha || new Date(logItem.ts * 1000).toLocaleString(),
                                    segundos: parseFloat(logItem.segundos || logItem.duracion || 0),
                                    tipo: logItem.tipo || "evento",
                                    refuerzo: !!logItem.refuerzo
                                });
                            }
                            showToast(`Sincronizados ${bleLogsTemp.length} logs locales`);
                        } catch (err) {
                            console.error("Fallo al subir logs BLE:", err);
                        }
                    }
                    bleLogsTemp = [];
                    // Vaciado de Flash en el ESP32
                    await sendCommand({comando: "CLEAR_LOGS"}, true);
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }
                
                if (data.tipo === "ACK_CLEAR_LOGS") {
                    showToast("Historial local de logs limpiado en placa.");
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }

                if (data.tipo === "CONFIG") {
                    updateConfigUI(data.data);
                    boundary = rxBuffer.indexOf('\n');
                    continue;
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
    const prevVal = !switchEl.checked; // Estado anterior antes del click

    setSwitchesDisabled(true);

    const timeoutId = setTimeout(() => {
        // Rollback
        switchEl.checked = prevVal;
        setSwitchesDisabled(false);
        pendingCommand = null;
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
        else adjustmentSlider.style.pointerEvents = 'auto';
    }
}

function setCronogramaInputsDisabled(disabled) {
    document.querySelectorAll('#cronogramaContainer input, #cronogramaContainer button, #cronogramaContainer .day-btn, #btnAgregarHorario, #btnProgAuto, #btnGuardarCronograma').forEach(el => {
        if (el.classList.contains('day-btn')) {
            if (disabled) el.style.pointerEvents = 'none';
            else el.style.pointerEvents = 'auto';
        } else {
            el.disabled = disabled;
        }
    });
}

function reaplicarEstadoUI() {
    document.getElementById('tglBomba').checked = (globalEstadoDosificador === "FILTRO" || globalEstadoDosificador === "DOSIS");
    document.getElementById('tglDosisManual').checked = (globalEstadoDosificador === "DOSIS" && globalRefuerzo === 0);
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
