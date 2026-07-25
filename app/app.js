import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, deleteDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

window.onerror = function (msg, url, lineNo, columnNo, error) {
    const errorMsg = `Error: ${msg}\nLínea: ${lineNo}\nArchivo: ${url}`;
    console.error(errorMsg);
    alert(errorMsg);
    return false;
};

window.addEventListener("unhandledrejection", function (event) {
    alert("Unhandled Promise Rejection: " + event.reason);
});

// === CONFIGURACIÓN Y INICIALIZACIÓN DE FIREBASE ===
const firebaseConfig = {
    apiKey: "AIzaSyDrfjhqsAdkDbQFCXqzns6UF7JByccg5vw",
    authDomain: "dosimat-iot-v2.firebaseapp.com",
    projectId: "dosimat-iot-v2",
    storageBucket: "dosimat-iot-v2.firebasestorage.app",
    messagingSenderId: "877312821470",
    appId: "1:877312821470:web:9c36c73a0efa745344da4f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === ESTADO GLOBAL DE LA APLICACIÓN ===
var currentUser = null;
var currentMac = null;
var modoConexion = "OFFLINE";
var mqttClient = null;
var globalEstadoDosificador = "IDLE";
var globalModoCiclo = "AUTO";
var globalRefuerzo = 0;
var globalDosisAnuladas = 0;
var currentDosisSec = 0;
var globalTemp = null;
var globalWifiSSID = "";
var lastConfigData = null;
var lastProgramasData = null;
var unsavedChanges = false;
var unsavedProgramasChanges = false;
var isTechRemoteActive = false;

var globalSoporteWsp = "5491153074195";
var globalSoporteMail = "soporte@dosimat.com";

var pendingCronogramaTimeoutId = null;
var unsubscribeFirestore = null;
var unsubscribeConfig = null;
var unsubscribeProgramas = null;
var unsubscribeSoporte = null;
var unsubscribeLogs = null;

const LED_PATRONES = {
    'En_espera_wifi': [[1, 200], [0, 4000]],
    'En_espera_ble': [[1, 200], [0, 2000]],
    'inactivo_refuerzo': [[1, 200], [0, 200], [1, 200], [0, 4000]],
    'dosificando': [[1, 1000], [0, 1000]],
    'dosificando_refuerzo': [[1, 4000], [0, 200]],
    'solo_bomba': [[1, 500], [0, 500]],
    'mantenimiento': [[1, 200], [0, 200]]
};

var ledTimerId = null;
var currentLedPattern = null;
var ledStepIndex = 0;

function actualizarLedVirtual() {
    const ledEl = document.getElementById('panelLed');
    if (!ledEl) return;

    const state = globalEstadoDosificador;
    const refuerzo_activo = (globalRefuerzo === 1 || globalRefuerzo === true);

    let patronSel = 'En_espera_ble';

    if (state === "PAUSA" || state === "ANTI" || state === "RESET") {
        patronSel = 'mantenimiento';
    } else if (state.startsWith("FILTRO")) {
        patronSel = 'solo_bomba';
    } else if (state === "DOSIS") {
        patronSel = refuerzo_activo ? 'dosificando_refuerzo' : 'dosificando';
    } else if (state === "IDLE") {
        if (refuerzo_activo) {
            patronSel = 'inactivo_refuerzo';
        } else {
            patronSel = (modoConexion === "NUBE") ? 'En_espera_wifi' : 'En_espera_ble';
        }
    }

    if (currentLedPattern === patronSel && ledTimerId !== null) {
        return;
    }

    if (ledTimerId) {
        clearTimeout(ledTimerId);
        ledTimerId = null;
    }

    currentLedPattern = patronSel;
    const pattern = LED_PATRONES[patronSel] || LED_PATRONES['En_espera_ble'];
    ledStepIndex = 0;

    function runLedStep() {
        const step = pattern[ledStepIndex];
        const val = step[0];
        const dur = step[1];

        if (val === 1) {
            ledEl.classList.remove('off');
            ledEl.classList.add('on');
        } else {
            ledEl.classList.remove('on');
            ledEl.classList.add('off');
        }

        ledStepIndex = (ledStepIndex + 1) % pattern.length;
        ledTimerId = setTimeout(runLedStep, dur);
    }

    runLedStep();
}

// === DICCIONARIO DE AYUDA (BOTONES HELP) ===
const HELP_TOPICS = {
    "soporte-tecnico": {
        title: "Soporte Técnico",
        text: "Utiliza los botones para comunicarte directamente con el servicio de atención oficial de Dosimat vía WhatsApp o correo electrónico."
    },
    "info-equipo": {
        title: "Información del Equipo",
        text: "Muestra el identificador único (MAC) de tu equipo Dosimat IoT y la hora sincronizada del reloj en tiempo real. Este identificador puede ser solicitado por el servicio técnico para un chequeo remoto del equipo."
    },
    "panel-estado": {
        title: "Panel Principal y LED",
        text: "Monitorea el estado actual del dosificador, bomba activa y temperatura. Permite iniciar dosis manuales, activar refuerzo y pausar el equipo.\n\n" +
            "PATRONES DEL LED:\n" +
            "• Destello breve c/ 4s: En espera del próximo evento\n" +
            "• Destello breve c/ 2s: En espera de Bluetooth\n" +
            "• Doble destello c/ 4s: En Espera con Refuerzo programado\n" +
            "• Parpadeo lento (1s): Dosificando cloro \n" +
            "• Encendido casi fijo (apaga breve): Dosificando con Refuerzo\n" +
            "• Parpadeo intermedio (0.5s): Solo bomba (Filtrando sin cloro)\n" +
            "• Parpadeo rápido (0.2s): Mantenimiento / Pausa"
    },
    "cronograma-filtrado": {
        title: "Programación de Cronogramas",
        text: "Configura hasta 10 horarios de Filtrado/Dosificación independientes. Permite seleccionar Horario, Días de la semana en que se repetirá el ciclo y si en ese horario debe dosificar cloro o no. Se recomienda establecer las dosis en horarios nocturnos. Programa Automático: establece 3 horarios estándar de filtrado, uno de ellos con dosificación."
    },
    "tiempos-dosificador": {
        title: "Ajustes de Parámetros",
        text: "Modifica los tiempos del Dosificador de cloro.\n\n" +
            "• Tiempo de Espera: filtrado previo a la dosificación, para estabilizar el caudal de agua.\n" +
            "• Duración de Dosis: tiempo durante el cual se dosificará cloro. Se verá afectado por el Refuerzo y el Ajuste estacional.\n" +
            "• Ajuste por Temporada: especifica qué porcentaje de la dosis, definida en Duración, se colocará durante la temporada baja .\n" +
            "• Inicio/Fin de Temporada Alta: define el intervalo de fechas en las que se aplicará la dosis sin ajuste estacional."
    },
    "vinculo-ble": {
        title: "Vínculo Bluetooth",
        text: "Permite conectar el celular directamente al dosificador mediante Bluetooth (BLE) sin necesidad de internet, ideal para la configuración inicial o zonas sin WiFi."
    },
    "wifi-local": {
        title: "Configuración WiFi",
        text: "Asigna la red WiFi local (SSID y Contraseña) a la que se conectará el dosificador para poder ser controlado de forma remota desde cualquier lugar."
    },
    "guia-conexion": {
        title: "Guía de Conexión y Registro",
        text: "Sigue estos 3 simples pasos para poner en marcha tu equipo:\n\n" +
            "1️⃣ Conexión Bluetooth (BLE): Toca el botón azul 'Buscar Dispositivo Bluetooth' (o ingresa tu MAC) en la pantalla inicial y selecciona tu Dosimat en la lista para acceder localmente.\n\n" +
            "2️⃣ Registro de Equipo: Al vincular tu equipo, se asociará automáticamente a tu cuenta de Google para que solo tú y tus técnicos autorizados puedan controlarlo.\n\n" +
            "3️⃣ WiFi de tu casa: En la pestaña de Ajustes (Conectividad WiFi local), ingresa el Nombre (SSID) y Contraseña de tu WiFi domiciliario y presiona 'Registrar Red WiFi'. El equipo se reiniciará y se conectará solo a la Nube."
    }
};

function initHelpButtons() {
    document.querySelectorAll('.btn-help').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const topic = btn.dataset.help;
            if (HELP_TOPICS[topic]) {
                customAlert(HELP_TOPICS[topic].text, HELP_TOPICS[topic].title);
            } else {
                customAlert("Información sobre esta sección de la aplicación.", "Ayuda");
            }
        };
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const btnToggleTheme = document.getElementById('btnToggleTheme');
    if (btnToggleTheme) {
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            btnToggleTheme.innerHTML = '<span class="material-symbols-outlined">light_mode</span>';
        }
        btnToggleTheme.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('theme', 'dark');
                btnToggleTheme.innerHTML = '<span class="material-symbols-outlined">light_mode</span>';
            } else {
                localStorage.setItem('theme', 'light');
                btnToggleTheme.innerHTML = '<span class="material-symbols-outlined">dark_mode</span>';
            }
        });
    }

    initHelpButtons();
});

// === LISTENERS DE CONTACTOS DE SOPORTE GLOBAL ===
function listenSupportContacts() {
    if (unsubscribeSoporte) unsubscribeSoporte();
    const docRef = doc(db, "configuracion_global", "contactos_soporte");
    unsubscribeSoporte = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.whatsapp) globalSoporteWsp = data.whatsapp;
            if (data.email) globalSoporteMail = data.email;

            const inpWsp = document.getElementById('inpConfigWsp');
            const inpMail = document.getElementById('inpConfigMail');
            if (inpWsp) inpWsp.value = globalSoporteWsp;
            if (inpMail) inpMail.value = globalSoporteMail;
        }
    }, (err) => {
        console.warn("Snapshot contactos_soporte:", err.message);
    });
}

// === POPULAR DROPDOWNS DE FECHAS DE TEMPORADA ===
function initSeasonDropdowns() {
    const vDia = document.getElementById('selectFVeranoDia');
    const vMes = document.getElementById('selectFVeranoMes');
    const iDia = document.getElementById('selectFInviernoDia');
    const iMes = document.getElementById('selectFInviernoMes');

    if (!vDia || !vMes || !iDia || !iMes) return;
    if (vDia.children.length > 0) return;

    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    for (let d = 1; d <= 31; d++) {
        const val = String(d).padStart(2, '0');
        vDia.add(new Option(val, val));
        iDia.add(new Option(val, val));
    }

    meses.forEach((m, idx) => {
        const val = String(idx + 1).padStart(2, '0');
        vMes.add(new Option(m, val));
        iMes.add(new Option(m, val));
    });

    vDia.value = "01";
    vMes.value = "12";
    iDia.value = "31";
    iMes.value = "03";
}

document.addEventListener('DOMContentLoaded', initSeasonDropdowns);
initSeasonDropdowns();

// === RELOJ DINÁMICO DE ENCABEZADO (24H) ===
setInterval(() => {
    const lbl = document.getElementById('lblHeaderTime');
    if (lbl) {
        const now = new Date();
        lbl.innerText = now.toLocaleTimeString('es-AR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}, 1000);

// === NOTIFICACIONES TOAST Y DIÁLOGOS MODALES ===
function showToast(msg, isWarning = false) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const t = document.createElement('div');
    t.className = `toast ${isWarning ? 'warning' : 'success'}`;
    t.innerText = msg;
    container.appendChild(t);

    setTimeout(() => {
        if (t.parentNode) t.remove();
    }, 4000);
}

function customConfirm(message, title = "Confirmar acción") {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const btnConfirm = document.getElementById('btnModalConfirm');
        const btnCancel = document.getElementById('btnModalCancel');

        if (!modal || !btnConfirm || !btnCancel) {
            resolve(confirm(`${title}\n\n${message}`));
            return;
        }

        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalMessage').innerText = message;
        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        };
        const onConfirm = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
}

function customAlert(message, title = "Información") {
    return customConfirm(message, title);
}

function promptUnsavedProgramasModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const titleEl = document.getElementById('modalTitle');
        const msgEl = document.getElementById('modalMessage');
        const btnConfirm = document.getElementById('btnModalConfirm');
        const btnCancel = document.getElementById('btnModalCancel');

        if (!modal || !btnConfirm || !btnCancel) {
            if (confirm("Tienes cambios sin guardar en la programación. ¿Deseas guardarlos?")) {
                resolve('save');
            } else {
                resolve('discard');
            }
            return;
        }

        titleEl.innerText = "Cambios sin guardar";
        msgEl.innerText = "Tienes modificaciones sin guardar en los cronogramas. ¿Deseas guardar los cambios antes de salir?";

        const footer = btnConfirm.parentElement;
        const oldContent = footer.innerHTML;

        footer.innerHTML = `
            <button class="btn outline" id="btnOptDiscard" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.85rem;">Descartar</button>
            <button class="btn outline" id="btnOptCancel" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.85rem; color: var(--danger); border-color: var(--danger);">Cancelar</button>
            <button class="btn" id="btnOptSave" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.85rem;">Guardar</button>
        `;

        modal.style.display = 'flex';

        const cleanup = (choice) => {
            modal.style.display = 'none';
            footer.innerHTML = oldContent;
            resolve(choice);
        };

        document.getElementById('btnOptSave').onclick = () => cleanup('save');
        document.getElementById('btnOptDiscard').onclick = () => cleanup('discard');
        document.getElementById('btnOptCancel').onclick = () => cleanup('cancel');
    });
}

// === GESTIÓN DE PESTAÑAS (SPA) ===
async function switchTab(btn, target) {
    const currentActiveContainer = document.querySelector('.container.active');
    const isLeavingProgramacion = currentActiveContainer && currentActiveContainer.id === 'tab-programacion' && target !== 'programacion';

    if (unsavedProgramasChanges && isLeavingProgramacion) {
        const choice = await promptUnsavedProgramasModal();
        if (choice === 'cancel') {
            return;
        } else if (choice === 'save') {
            const btnSave = document.getElementById('btnGuardarCronograma');
            if (btnSave) btnSave.click();
            unsavedProgramasChanges = false;
        } else if (choice === 'discard') {
            unsavedProgramasChanges = false;
            if (lastProgramasData) updateProgramasUI(lastProgramasData);
        }
    }

    if (unsavedChanges) {
        if (!confirm("Tienes cambios sin guardar en la configuración. ¿Deseas salir de todas formas?")) {
            return;
        }
        unsavedChanges = false;
    }
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.container').forEach(c => c.classList.remove('active'));

    if (btn && btn.classList) btn.classList.add('active');
    else if (typeof btn === 'string') {
        const btnElem = document.querySelector(`nav [data-target="${btn}"]`);
        if (btnElem) btnElem.classList.add('active');
    }

    const targetElem = document.getElementById(`tab-${target}`);
    if (targetElem) targetElem.classList.add('active');

    if (target === "tecnicos" && typeof loadAdminGlobal === "function") {
        loadAdminGlobal();
        loadTecnicosUI();
    }

    initHelpButtons();
}

document.querySelectorAll('nav button').forEach(btn => {
    btn.onclick = () => {
        const target = btn.dataset.target;
        if (target) {
            switchTab(btn, target);
        }
    };
});

// === CÁLCULOS DE PRÓXIMO EVENTO Y TEMPORADA ===
function obtenerListaProgramas() {
    const items = [];
    const rows = document.querySelectorAll('#cronogramaContainer .crono-row');
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

function esTemporadaAlta() {
    if (!lastConfigData) return true;
    const inicio = lastConfigData.temporada_alta_inicio || "12-01";
    const fin = lastConfigData.temporada_alta_fin || "03-31";

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const actual = `${mm}-${dd}`;

    if (inicio <= fin) {
        return actual >= inicio && actual <= fin;
    } else {
        return actual >= inicio || actual <= fin;
    }
}

function calcularProximoEvento() {
    const cron = obtenerListaProgramas();
    if (!cron || cron.length === 0) return null;

    const now = new Date();
    const currentJsDay = now.getDay();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let candidates = [];

    for (let d = 0; d < 7; d++) {
        const targetJsDay = (currentJsDay + d) % 7;
        const cronoDayIndex = (targetJsDay + 6) % 7;
        const cronoDayStr = String(cronoDayIndex);

        for (let item of cron) {
            if (!item.on || item.duracion <= 0) continue;
            if (item.dias && item.dias.includes(cronoDayStr)) {
                let timeStr = item.on;
                if (!timeStr.includes(":") && timeStr.length === 4) {
                    timeStr = `${timeStr.substring(0, 2)}:${timeStr.substring(2, 4)}`;
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
        }
        if (candidates.length > 0) break;
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.mins - b.mins);
    const best = candidates[0];

    const nombresDias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    let diaTexto = "";
    if (best.dayOffset === 0) diaTexto = `hoy a las ${best.timeStr}h`;
    else if (best.dayOffset === 1) diaTexto = `mañana a las ${best.timeStr}h`;
    else diaTexto = `el ${nombresDias[best.targetJsDay]} a las ${best.timeStr}h`;

    const esDosis = best.dosifica;
    const tipo = esDosis ? "Dosis" : "Filtrado";

    let duracionTexto = "";
    if (esDosis) {
        let baseSec = (lastConfigData && lastConfigData.tdosis_seg) ? lastConfigData.tdosis_seg : 300;
        if (!esTemporadaAlta()) {
            const ajuste = (lastConfigData && lastConfigData.ajuste_baja !== undefined) ? parseInt(lastConfigData.ajuste_baja) : 10;
            baseSec = Math.floor(baseSec * (ajuste / 100));
        }
        if (globalRefuerzo === 1) {
            baseSec *= 2;
        }
        const m = Math.floor(baseSec / 60);
        const s = baseSec % 60;
        duracionTexto = `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    } else {
        const m = best.duracionMin;
        duracionTexto = `${m} min`;
    }

    return {
        tipo: tipo,
        diaTexto: diaTexto,
        duracionTexto: duracionTexto,
        esDosis: esDosis,
        refuerzoActivo: globalRefuerzo === 1,
        esTemporadaAlta: esTemporadaAlta()
    };
}

function actualizarPanelTemporada() {
    const iconTemp = document.getElementById('iconTemporada');
    const lblTitulo = document.getElementById('lblTemporadaTitulo');
    const lblFechas = document.getElementById('lblTemporadaFechas');

    const esAlta = esTemporadaAlta();
    if (lblTitulo) {
        lblTitulo.innerText = esAlta ? "ALTA" : "BAJA";
        lblTitulo.style.color = esAlta ? "var(--warning)" : "var(--accent)";
    }
    if (iconTemp) {
        iconTemp.innerText = esAlta ? "wb_sunny" : "ac_unit";
        iconTemp.style.color = esAlta ? "var(--warning)" : "var(--accent)";
    }
    if (lblFechas && lastConfigData) {
        let ini = lastConfigData.temporada_alta_inicio || "12-01";
        let fin = lastConfigData.temporada_alta_fin || "03-31";

        if (!esAlta) {
            const shiftDateStr = (md, offsetDays) => {
                if (!md || !md.includes("-")) return md;
                const parts = md.split("-");
                const d = new Date(2024, parseInt(parts[0]) - 1, parseInt(parts[1]));
                d.setDate(d.getDate() + offsetDays);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${mm}-${dd}`;
            };
            const bajaIni = shiftDateStr(fin, 1);
            const bajaFin = shiftDateStr(ini, -1);
            ini = bajaIni;
            fin = bajaFin;
        }

        const fmt = (str) => {
            if (!str || !str.includes("-")) return str;
            const p = str.split("-");
            return `${p[1]}/${p[0]}`;
        };
        lblFechas.innerText = `${fmt(ini)} al ${fmt(fin)}`;
    }
}

// === AUTENTICACIÓN FIREBASE Y CONTROL DE USUARIOS Y ROLES ===
const txtEmail = document.getElementById('txtEmail');
const txtPassword = document.getElementById('txtPassword');
const txtNombre = document.getElementById('txtNombre');
const btnActionAuth = document.getElementById('btnActionAuth');
const lnkAuthSwitch = document.getElementById('lnkAuthSwitch');
const lblAuthSwitchText = document.getElementById('lblAuthSwitchText');
const groupNombre = document.getElementById('groupNombre');
const lblAuthError = document.getElementById('lblAuthError');
let authMode = "LOGIN";

if (lnkAuthSwitch) {
    lnkAuthSwitch.onclick = (e) => {
        e.preventDefault();
        if (lblAuthError) lblAuthError.innerText = "";
        if (authMode === "LOGIN") {
            authMode = "REGISTER";
            if (groupNombre) groupNombre.style.display = "block";
            if (btnActionAuth) btnActionAuth.innerText = "Registrarse";
            if (lblAuthSwitchText) lblAuthSwitchText.innerText = "¿Ya tienes cuenta?";
            lnkAuthSwitch.innerText = "Inicia sesión";
        } else {
            authMode = "LOGIN";
            if (groupNombre) groupNombre.style.display = "none";
            if (btnActionAuth) btnActionAuth.innerText = "Iniciar Sesión";
            if (lblAuthSwitchText) lblAuthSwitchText.innerText = "¿No tienes cuenta?";
            lnkAuthSwitch.innerText = "Regístrate";
        }
    };
}

if (btnActionAuth) {
    btnActionAuth.onclick = async () => {
        const email = txtEmail.value.trim();
        const password = txtPassword.value.trim();
        if (lblAuthError) lblAuthError.innerText = "";

        if (!email || !password) {
            if (lblAuthError) lblAuthError.innerText = "Por favor, completa todos los campos.";
            return;
        }

        try {
            if (authMode === "LOGIN") {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                const nombre = txtNombre.value.trim();
                if (!nombre) {
                    if (lblAuthError) lblAuthError.innerText = "Ingresa tu nombre.";
                    return;
                }
                const res = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(res.user, { displayName: nombre });
            }
        } catch (e) {
            if (lblAuthError) lblAuthError.innerText = "Error: " + e.message;
        }
    };
}

const btnGoogleAuth = document.getElementById('btnGoogleAuth');
if (btnGoogleAuth) {
    btnGoogleAuth.onclick = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (e) {
            showToast("Error en inicio con Google: " + e.message, true);
        }
    };
}

const btnSignOut = document.getElementById('btnSignOut') || document.getElementById('btnLogout');
if (btnSignOut) {
    btnSignOut.onclick = async () => {
        if (await customConfirm("¿Estás seguro que deseas cerrar sesión?", "Cerrar sesión")) {
            if (window.techValveOpen) {
                sendCommand({ comando: "SET_VALVE_MANUAL", estado: false });
                window.techValveOpen = false;
                const btnTV = document.getElementById('btnTechValve');
                if (btnTV) {
                    btnTV.innerText = "ABRIR";
                    btnTV.style.backgroundColor = "transparent";
                    btnTV.style.color = "var(--text-main)";
                }
            }
            if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
            if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = null; }
            if (unsubscribeProgramas) { unsubscribeProgramas(); unsubscribeProgramas = null; }
            if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }
            if (mqttClient) { try { mqttClient.disconnect(); } catch (e) { } mqttClient = null; }

            await signOut(auth);
            showToast("Sesión cerrada.");
        }
    };
}

async function checkUserRole(user) {
    const navTecnicos = document.getElementById('navTecnicos');
    const cardGestion = document.getElementById('cardGestionTecnicos');
    const cardConfigSoporte = document.getElementById('cardConfigSoporte');

    if (navTecnicos) navTecnicos.style.display = "none";
    if (cardGestion) cardGestion.style.display = "none";
    if (cardConfigSoporte) cardConfigSoporte.style.display = "none";

    if (!user || !user.email) return;
    const email = user.email.toLowerCase().trim();

    let isSuper = (email === "gab.aldazabal@gmail.com" || email === "gab.aldazabal@gmail.com.ar");
    let isTecnico = isSuper;

    if (!isSuper) {
        try {
            const tecDoc = await getDoc(doc(db, "administradores", email));
            if (tecDoc.exists() && tecDoc.data() && (tecDoc.data().rol === "tecnico" || tecDoc.data().rol === "admin")) {
                isTecnico = true;
            } else {
                isTecnico = false;
            }
        } catch (e) {
            isTecnico = false;
        }
    }

    if (navTecnicos) {
        navTecnicos.style.display = (isSuper || isTecnico) ? "flex" : "none";
    }

    if (cardGestion) {
        cardGestion.style.display = isSuper ? "block" : "none";
    }

    if (cardConfigSoporte) {
        cardConfigSoporte.style.display = (isSuper || isTecnico) ? "block" : "none";
    }

    const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
    if (btnLimpiarHistorial) {
        btnLimpiarHistorial.style.display = (isSuper || isTecnico) ? "inline-block" : "none";
    }

    const techValveControl = document.getElementById('techValveControl');
    if (techValveControl) {
        techValveControl.style.display = (isSuper || isTecnico) ? "flex" : "none";
    }

    if (isSuper || isTecnico) {
        loadAdminGlobal();
        loadTecnicosUI();
    } else {
        const activeTab = document.querySelector('.container.active');
        if (activeTab && activeTab.id === 'tab-tecnicos') {
            switchTab(document.querySelector('nav [data-target="dashboard"]'), 'dashboard');
        }
    }
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const authOverlay = document.getElementById('authOverlay');
    const userBar = document.getElementById('userBar');
    const lblUserName = document.getElementById('lblUserName');

    if (user) {
        if (authOverlay) authOverlay.style.display = 'none';
        if (userBar) userBar.style.display = 'flex';
        if (lblUserName) {
            lblUserName.innerText = user.displayName || user.email;
            lblUserName.style.display = 'block';
        }

        checkUserRole(user);

        // Ensure root document exists so it can be queried by getDocs(collection(db, "usuarios"))
        const uDocRef = doc(db, "usuarios", user.uid);
        setDoc(uDocRef, {
            email: user.email,
            nombre: user.displayName || user.email,
            ultima_conexion: new Date()
        }, { merge: true }).catch(e => console.error("Error setting user doc:", e));
        
        listenSupportContacts();

        try {
            const userDoc = await getDoc(doc(db, "usuarios", user.uid));
            let macToConnect = null;
            if (userDoc.exists()) {
                const udata = userDoc.data();
                if (udata.id_equipo) macToConnect = udata.id_equipo;
                else if (udata.equipos && udata.equipos.length > 0) macToConnect = udata.equipos[0];
            }
            if (!macToConnect) {
                const snap = await getDocs(collection(db, "usuarios", user.uid, "equipos_asignados"));
                if (!snap.empty) {
                    macToConnect = snap.docs[0].id;
                }
            }
            if (!macToConnect) {
                // Si no tiene equipo, no conectar automáticamente.
                currentMac = null;
                const status = document.getElementById('connectStatus');
                if (status) status.innerText = "No tienes equipos vinculados. Vincula tu equipo por Bluetooth.";
                const lblMac = document.getElementById('lblMac');
                if (lblMac) lblMac.innerText = "-";
            } else {
                currentMac = macToConnect;
                connectNube();
            }
        } catch (e) {
            console.error("Error buscando equipos de usuario:", e);
            currentMac = null;
        }
    } else {
        if (authOverlay) authOverlay.style.display = 'flex';
        if (userBar) userBar.style.display = 'none';
        if (lblUserName) lblUserName.style.display = 'none';

        if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
        if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = null; }
        if (unsubscribeProgramas) { unsubscribeProgramas(); unsubscribeProgramas = null; }
        if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }
        if (mqttClient) { try { mqttClient.disconnect(); } catch (e) { } mqttClient = null; }

        setConexionModo("OFFLINE");
    }
});

// === CONEXIÓN NUBE Y MQTT ===
function setConexionModo(modo, ssid = "", msg = "Offline") {
    modoConexion = modo;
    if (ssid) globalWifiSSID = ssid;

    const badge = document.getElementById('lblConnState') || document.getElementById('badgeConexion');
    if (!badge) return;

    if (modo === "NUBE") {
        const nombreRed = globalWifiSSID || "Conectado";
        badge.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1rem; vertical-align: middle;">wifi</span> <span>${nombreRed}</span>`;
        badge.className = "conn-badge conn-nube";
    } else if (modo === "BLE") {
        badge.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1rem; vertical-align: middle;">bluetooth</span> <span>BLE</span>`;
        badge.className = "conn-badge conn-ble";
    } else {
        badge.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1rem; vertical-align: middle;">wifi_off</span> <span>${msg}</span>`;
        badge.className = "conn-badge conn-offline";
    }
}

function formatLogDate(ts) {
    if (typeof ts === 'string') {
        if (ts.includes("-") && ts.includes("/")) return ts;
        ts = Number(ts) || Date.now();
    }

    if (ts && typeof ts.toMillis === 'function') ts = ts.toMillis();
    else if (ts && typeof ts.seconds === 'number') ts = ts.seconds * 1000;
    if (!ts || isNaN(ts)) ts = Date.now();

    let isEsp32Epoch = false;

    // ESP32 returns seconds since 2000 (epoch 946684800 in JS Unix). 
    // Si ts es menor a 1500000000, asumimos que es el epoch del ESP32 o Unix en segundos.
    if (ts < 2000000000) {
        // Si el timestamp es muy pequeño, asumimos que es desde 2000 y ya está en hora local del equipo
        if (ts < 1000000000) {
            ts = (ts + 946684800) * 1000;
            isEsp32Epoch = true;
        } else {
            // Es unix en segundos
            ts = ts * 1000;
        }
    }

    let d = new Date(ts);
    if (isNaN(d.getTime()) || d.getFullYear() < 2000) {
        d = new Date();
        isEsp32Epoch = false;
    }

    let dd, mm, aa, hh, min, ss;
    if (isEsp32Epoch) {
        dd = String(d.getUTCDate()).padStart(2, '0');
        mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        aa = String(d.getUTCFullYear()).slice(-2);
        hh = String(d.getUTCHours()).padStart(2, '0');
        min = String(d.getUTCMinutes()).padStart(2, '0');
        ss = String(d.getUTCSeconds()).padStart(2, '0');
    } else {
        dd = String(d.getDate()).padStart(2, '0');
        mm = String(d.getMonth() + 1).padStart(2, '0');
        aa = String(d.getFullYear()).slice(-2);
        hh = String(d.getHours()).padStart(2, '0');
        min = String(d.getMinutes()).padStart(2, '0');
        ss = String(d.getSeconds()).padStart(2, '0');
    }

    return `${dd}/${mm}/${aa} - ${hh}:${min}:${ss}`;
}

function appendLogToTerminal(logText) {
    const term = document.getElementById('logsTerminal');
    if (!term) return;
    if (term.innerText.includes("Esperando eventos...")) {
        term.innerText = "";
    }
    const prefix = formatLogDate(Date.now());
    term.innerText = prefix ? `${prefix} - ${logText}\n` + term.innerText : `${logText}\n` + term.innerText;
}

function calcularDosis15Dias(logs) {
    const valDosisNormales = document.getElementById('valDosisNormales');
    const valDosisRefuerzo = document.getElementById('valDosisRefuerzo');
    if (!valDosisNormales || !valDosisRefuerzo) return;
    if (!logs || !Array.isArray(logs)) return;

    const limitMs = 15 * 24 * 60 * 60 * 1000; // 15 días
    const now = Date.now();
    let normCount = 0;
    let refCount = 0;

    logs.forEach(item => {
        let ts = 0;
        let msg = "";
        let isRef = false;

        if (typeof item === 'string') {
            msg = item;
            try {
                const parts = item.split(" - ");
                if (parts.length >= 2 && parts[0].includes("/")) {
                    const dateParts = parts[0].split("/");
                    const timeParts = parts[1].split(":");
                    if (dateParts.length === 3 && timeParts.length === 3) {
                        let year = parseInt(dateParts[2], 10);
                        if (year < 100) year += 2000;
                        const logDate = new Date(year, parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10), parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), parseInt(timeParts[2], 10));
                        ts = logDate.getTime();
                    }
                }
            } catch(e) {}
            if (!ts || isNaN(ts)) ts = now;
        } else {
            ts = item.ts || item.timestamp || 0;
            if (ts && typeof ts.toMillis === 'function') ts = ts.toMillis();
            else if (ts && typeof ts.seconds === 'number') ts = ts.seconds * 1000;
            else if (ts && ts < 10000000000) ts = ts * 1000;
            if (!ts || isNaN(ts)) ts = now;

            msg = item.msg || item.mensaje || item.tipo || JSON.stringify(item);
            if (item.refuerzo === true || item.refuerzo === 1) isRef = true;
        }

        if (now - ts <= limitMs) {
            const msgLower = msg.toLowerCase();
            const esDosis = (msgLower.includes("dosis automática") || msgLower.includes("dosis manual") || msgLower.includes("dosificando") || (msgLower.includes("dosis") && !msgLower.includes("salteada") && !msgLower.includes("pausada") && !msgLower.includes("anulada") && !msgLower.includes("suspendida") && !msgLower.includes("cancelada")));
            
            if (esDosis) {
                if (isRef || msgLower.includes("refuerzo activo") || msgLower.includes("refuerzo: si") || msgLower.includes("con refuerzo")) {
                    refCount++;
                } else {
                    normCount++;
                }
            }
        }
    });

    valDosisNormales.innerText = normCount;
    valDosisRefuerzo.innerText = refCount;
}

function renderLogsList(logs) {
    const term = document.getElementById('logsTerminal');
    if (!term) return;
    if (!logs || !Array.isArray(logs)) return;
    calcularDosis15Dias(logs);
    let linesArr = logs.map(item => {
        if (typeof item === 'string') {
            if (item.includes(" - ") && item.includes("/")) return item;
            const pfx = formatLogDate(Date.now());
            return pfx ? `${pfx} - ${item}` : item;
        }
        const ts = item.ts ? item.ts : (item.timestamp || Date.now());
        const msg = item.msg || item.mensaje || item.tipo || JSON.stringify(item);
        if (msg.includes(" - ") && msg.split(" - ").length >= 2 && msg.includes("/")) {
            return msg;
        }
        const pfx = formatLogDate(ts);
        return pfx ? `${pfx} - ${msg}` : msg;
    });
    term.innerText = linesArr.slice(0, 20).join('\n');
}

function listenLogsCollection() {
    if (unsubscribeLogs) {
        unsubscribeLogs();
        unsubscribeLogs = null;
    }
    if (!currentMac) return;
    if (modoConexion === "BLE") {
        return;
    }

    try {
        const q = query(collection(db, "equipos", currentMac, "logs"), orderBy("timestamp", "desc"), limit(100));
        unsubscribeLogs = onSnapshot(q, (snap) => {
            const term = document.getElementById('logsTerminal');
            if (!term) return;
            if (snap.empty) return;
            let logsArr = [];
            let rawDocs = [];
            snap.forEach(docSnap => {
                const data = docSnap.data();
                rawDocs.push(data);

                let ts = data.ts || data.timestamp || Date.now();
                if (ts && typeof ts.toMillis === 'function') ts = ts.toMillis();
                else if (ts && typeof ts.seconds === 'number') ts = ts.seconds * 1000;

                const msg = data.mensaje || data.msg || data.log || JSON.stringify(data);
                if (msg.includes(" - ") && msg.split(" - ").length >= 2 && msg.includes("/")) {
                    logsArr.push(msg);
                } else {
                    const pfx = formatLogDate(ts);
                    logsArr.push(pfx ? `${pfx} - ${msg}` : msg);
                }
            });
            calcularDosis15Dias(rawDocs);
            term.innerText = logsArr.slice(0, 20).join('\n');
        }, (err) => {
            console.warn("Snapshot logs:", err.message);
        });
    } catch (e) {
        console.warn("Error buscando colección de logs:", e);
    }
}

function connectNube() {
    if (!currentMac) return;

    const lblMac = document.getElementById('lblMac');
    if (lblMac) lblMac.innerText = currentMac;

    if (mqttClient) {
        try { mqttClient.disconnect(); } catch (e) { }
    }

    const clientId = "dosimat_pwa_" + Math.random().toString(16).substr(2, 8);
    const host = "broker.hivemq.com";
    const isHttps = window.location.protocol === "https:";

    mqttClient = new Paho.MQTT.Client(host, isHttps ? 8884 : 8000, clientId);

    mqttClient.onConnectionLost = (responseObject) => {
        if (responseObject.errorCode !== 0) {
            console.log("MQTT Conexión perdida: " + responseObject.errorMessage);
            if (modoConexion !== "BLE") setConexionModo("OFFLINE");
            setTimeout(connectNube, 5000);
        }
    };

    mqttClient.onMessageArrived = (message) => {
        const topic = message.destinationName;
        const payload = message.payloadString;
        try {
            const data = JSON.parse(payload);
            const innerData = data.tipo === "TELEMETRIA" ? data.data : (data.data || data);

            if (data.tipo === "ACK_CRON" || data.comando === "ACK_CRON" || data.status === "OK") {
                if (pendingCronogramaTimeoutId) {
                    clearTimeout(pendingCronogramaTimeoutId);
                    pendingCronogramaTimeoutId = null;
                    setCronogramaInputsDisabled(false);
                    showToast("🎉 Cronograma guardado y confirmado por el dosificador.");
                }
            }

            if (data.tipo === "ACK_CONFIG" || data.tipo === "ACK_CFG") {
                showToast("🎉 Parámetros confirmados por el dosificador.");
            }

            if (data.tipo === "LOGS_LIST" && data.logs) {
                renderLogsList(data.logs);
                return;
            }

            if (topic === `dosimat/${currentMac}/telemetry`) {
                if (modoConexion !== "BLE") {
                    setConexionModo("NUBE", innerData.wifi_ssid || innerData.ssid || "");
                    updateUI(data);
                }
            } else if (topic === `dosimat/${currentMac}/config`) {
                updateConfigUI(innerData);
            } else if (topic === `dosimat/${currentMac}/programas`) {
                updateProgramasUI(innerData);
            } else if (topic === `dosimat/${currentMac}/logs`) {
                if (Array.isArray(innerData)) {
                    renderLogsList(innerData);
                } else {
                    appendLogToTerminal(typeof innerData === 'string' ? innerData : JSON.stringify(innerData));
                }
            }
        } catch (e) {
            console.error("Error procesando MQTT:", e);
        }
    };

    const options = {
        timeout: 4,
        useSSL: isHttps,
        onSuccess: () => {
            console.log("MQTT Conectado a HiveMQ (Esperando datos del equipo...)");
            
            // ¡CRÍTICO! Si no cambiamos esto, sendCommand NO envía nada a MQTT
            modoConexion = "NUBE"; 
            
            const connectStatus = document.getElementById('connectStatus');
            if (connectStatus) connectStatus.innerText = "Nube conectada (Esperando datos...)";
            
            mqttClient.subscribe(`dosimat/${currentMac}/telemetry`);
            mqttClient.subscribe(`dosimat/${currentMac}/config`);
            mqttClient.subscribe(`dosimat/${currentMac}/programas`);
            mqttClient.subscribe(`dosimat/${currentMac}/logs`);
            
            sendCommand({ comando: "GET_STATE" }, true);
            
            if (window.mqttRescuePoll) clearInterval(window.mqttRescuePoll);
            window.mqttRescuePoll = setInterval(() => {
                const statusStr = connectStatus ? connectStatus.innerText : "";
                if (statusStr.includes("Esperando datos")) {
                    console.log("Reintentando GET_STATE...");
                    sendCommand({ comando: "GET_STATE" }, true);
                } else {
                    clearInterval(window.mqttRescuePoll);
                }
            }, 3000);
        },
        onFailure: (err) => {
            console.error("MQTT Failure:", err);
            if (modoConexion !== "BLE") setConexionModo("OFFLINE");
            setTimeout(connectNube, 5000);
        }
    };

    mqttClient.connect(options);

    if (unsubscribeFirestore) unsubscribeFirestore();
    const docRef = doc(db, "equipos", currentMac, "estado", "actual");
    unsubscribeFirestore = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            updateUI(data);
            
            if (modoConexion !== "BLE") {
                if (data.ultima_sincronizacion) {
                    const now = Date.now();
                    const syncTime = data.ultima_sincronizacion.toMillis ? data.ultima_sincronizacion.toMillis() : data.ultima_sincronizacion;
                    if (now - syncTime > 180000) { // 3 minutos sin reportar
                        setConexionModo("OFFLINE", "", "Equipo Offline (Datos de caché)");
                    } else {
                        setConexionModo("NUBE", data.wifi_ssid || "");
                    }
                } else {
                    setConexionModo("OFFLINE", "", "Equipo Offline");
                }
            }
        }
    }, (err) => {
        console.warn("Firestore snapshot estado:", err.message);
    });

    if (unsubscribeConfig) unsubscribeConfig();
    if (modoConexion !== "BLE") {
        const cfgRef = doc(db, "equipos", currentMac, "config", "actual");
        unsubscribeConfig = onSnapshot(cfgRef, (docSnap) => {
            if (docSnap.exists()) {
                updateConfigUI(docSnap.data());
            }
        }, (err) => {
            console.warn("Firestore snapshot config:", err.message);
        });
    }

    if (unsubscribeProgramas) unsubscribeProgramas();
    if (modoConexion !== "BLE") {
        const progRef = doc(db, "equipos", currentMac, "programas", "actual");
        unsubscribeProgramas = onSnapshot(progRef, (docSnap) => {
        if (docSnap.exists()) {
            if (pendingCronogramaTimeoutId) {
                clearTimeout(pendingCronogramaTimeoutId);
                pendingCronogramaTimeoutId = null;
                setCronogramaInputsDisabled(false);
                showToast("🎉 Cronograma confirmado por el dosificador.");
            }
            updateProgramasUI(docSnap.data());
        }
    }, (err) => {
        console.warn("Firestore snapshot programas:", err.message);
    });
    }

    listenLogsCollection();
}

// === ENVÍO DE COMANDOS Y FORMATO DE TIEMPO ===
async function sendCommand(obj, silent = false) {
    if (!currentMac && modoConexion !== "BLE") {
        if (!silent && typeof customAlert === "function") customAlert("No hay un equipo seleccionado.");
        return;
    }

    if (modoConexion === "BLE" && typeof rxCharacteristic !== "undefined" && rxCharacteristic) {
        if (typeof bleTxQueue !== "undefined") {
            bleTxQueue.push(obj);
            if (!isBleTxActive) _processBleQueue();
        }
        if (!silent && typeof showToast === "function") showToast(`Comando enviado por BLE: ${obj.comando}`);
        return true;
    }

    if (modoConexion === "NUBE" && mqttClient && mqttClient.isConnected()) {
        try {
            const msg = new Paho.MQTT.Message(JSON.stringify(obj));
            msg.destinationName = `dosimat/${currentMac}/cmd`;
            mqttClient.send(msg);
            if (!silent && typeof showToast === "function") showToast(`Comando enviado: ${obj.comando}`);
        } catch (e) {
            console.error("Error enviando MQTT:", e);
        }
    }

    if (modoConexion === "NUBE") {
        try {
            const cmdRef = doc(db, "equipos", currentMac, "comandos", "solicitado");
            await setDoc(cmdRef, { ...obj, timestamp: Date.now() }, { merge: true });
        } catch (e) {
            console.warn("Resguardo Firestore omite escritura:", e);
        }
    }
}

function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

// === RENDERIZADO DEL DASHBOARD, ESTADOS Y TARJETAS TÁCTILES ===
function updateUI(raw_data) {
    if (!raw_data) return;
    const data = raw_data.tipo === "TELEMETRIA" ? raw_data.data : raw_data;

    if (data.fase_real !== undefined) globalEstadoDosificador = data.fase_real;
    else if (data.estado !== undefined) globalEstadoDosificador = data.estado;
    else if (data.est !== undefined) globalEstadoDosificador = (data.est === "FILTRO" && globalEstadoDosificador.startsWith("FILTRO")) ? globalEstadoDosificador : data.est;

    if (data.modo !== undefined) globalModoCiclo = data.modo;
    if (data.m !== undefined) globalModoCiclo = data.m;
    if (data.refuerzo !== undefined) globalRefuerzo = data.refuerzo;
    if (data.ref !== undefined) globalRefuerzo = data.ref;
    if (data.anuladas !== undefined) globalDosisAnuladas = data.anuladas;

    let tr = data.tr !== undefined ? data.tr : 0;
    currentDosisSec = tr;

    let temp = data.temp !== undefined ? data.temp : (data.temperatura !== undefined ? data.temperatura : (data.temp_rtc !== undefined ? data.temp_rtc : null));
    if (temp !== null) globalTemp = Number(temp);
    const lblTemp = document.getElementById('lblTemp');
    const iconTemp = document.getElementById('iconTemp');
    if (lblTemp) {
        lblTemp.innerText = temp !== null ? `${Number(temp).toFixed(1)}°C` : "--°C";
        if (globalTemp !== null && globalTemp >= 27 && globalTemp <= 30) {
            lblTemp.style.color = "var(--warning)";
            if (iconTemp) iconTemp.style.color = "var(--warning)";
        } else if (globalTemp !== null && globalTemp > 30) {
            lblTemp.style.color = "var(--danger)";
            if (iconTemp) iconTemp.style.color = "var(--danger)";
        } else {
            lblTemp.style.color = "var(--text-main)";
            if (iconTemp) iconTemp.style.color = "var(--text-muted)";
        }
    }

    let rtcStr = data.rtc || data.rtc_time || data.hora_rtc || data.hora || data.time;
    const lblRTC = document.getElementById('lblRTC');
    if (lblRTC) {
        if (rtcStr) {
            lblRTC.innerText = rtcStr;
        } else {
            const now = new Date();
            lblRTC.innerText = now.toLocaleDateString('es-AR') + ' ' + now.toLocaleTimeString('es-AR', { hour12: false });
        }
    }

    if (modoConexion !== "BLE") {
        const wifiName = data.wifi_ssid || data.ssid || "";
        setConexionModo("NUBE", wifiName);
    }

    actualizarPanelTemporada();
    updateSubtexto();
    actualizarLedVirtual();

    // Actualización dinámica del FONDO del Panel de Estado
    const panelEstado = document.querySelector('.panel-estado');
    if (panelEstado) {
        panelEstado.classList.remove('bg-green-soft', 'bg-blue-soft', 'bg-red-soft', 'bg-yellow-soft');
        if (globalEstadoDosificador === "PAUSA") {
            panelEstado.classList.add('bg-red-soft');
        } else if (globalEstadoDosificador === "DOSIS") {
            panelEstado.classList.add('bg-yellow-soft');
        } else if (globalEstadoDosificador.startsWith("FILTRO")) {
            panelEstado.classList.add('bg-blue-soft');
        } else if (globalDosisAnuladas > 0) {
            panelEstado.classList.add('bg-yellow-soft');
        } else {
            panelEstado.classList.add('bg-green-soft');
        }
    }

    // Texto de Estado Principal según especificaciones exactas
    const lblEstado = document.getElementById('lblEstado');
    const iconEstado = document.getElementById('iconEstado');

    let textoEstadoMostrar = globalEstadoDosificador;
    if (globalEstadoDosificador === "IDLE") textoEstadoMostrar = "EN ESPERA...";
    else if (globalEstadoDosificador === "DOSIS") textoEstadoMostrar = "DOSIFICANDO...";
    else if (globalEstadoDosificador.startsWith("FILTRO")) textoEstadoMostrar = "FILTRANDO...";
    else if (globalEstadoDosificador === "PAUSA") textoEstadoMostrar = "PAUSA";
    else if (globalEstadoDosificador === "RESET") textoEstadoMostrar = "REINICIANDO...";

    if (lblEstado) lblEstado.innerText = textoEstadoMostrar;
    if (iconEstado) {
        iconEstado.className = "material-symbols-outlined";
        if (globalEstadoDosificador === "IDLE") {
            iconEstado.innerText = "schedule";
            iconEstado.style.color = "var(--text-muted)";
        } else if (globalEstadoDosificador === "PAUSA") {
            iconEstado.innerText = "pause_circle";
            iconEstado.style.color = "var(--danger)";
        } else if (globalEstadoDosificador === "DOSIS") {
            iconEstado.innerText = "water_drop";
            iconEstado.style.color = "var(--warning)";
            iconEstado.classList.add('anim-drop');
        } else if (globalEstadoDosificador.startsWith("FILTRO")) {
            iconEstado.innerText = "mode_fan";
            iconEstado.style.color = "var(--accent)";
            iconEstado.classList.add('anim-fan');
        }
    }

    // Tarjeta Bomba
    const isBombaOn = (globalEstadoDosificador === "FILTRO" || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "FILTRO_POST" || globalEstadoDosificador === "FILTRO_MANUAL");
    const panelBomba = document.getElementById('panelBomba');
    const lblBomba = document.getElementById('lblBomba');
    const iconBomba = document.getElementById('iconBomba');

    if (lblBomba) lblBomba.innerText = isBombaOn ? "ON" : "OFF";
    if (panelBomba) {
        if (isBombaOn) {
            panelBomba.classList.add('active-on');
            if (iconBomba) {
                iconBomba.style.color = "var(--success)";
                iconBomba.classList.add('anim-fan');
            }
        } else {
            panelBomba.classList.remove('active-on');
            if (iconBomba) {
                iconBomba.style.color = "var(--text-muted)";
                iconBomba.classList.remove('anim-fan');
            }
        }
    }

    // Tarjeta Refuerzo
    const isRefuerzoOn = (globalRefuerzo === 1 || globalRefuerzo === true);
    const panelRefuerzo = document.getElementById('panelRefuerzo');
    const lblRefuerzo = document.getElementById('lblRefuerzo');
    const iconRefuerzo = document.getElementById('iconRefuerzo');

    if (lblRefuerzo) lblRefuerzo.innerText = isRefuerzoOn ? "ON" : "OFF";
    if (panelRefuerzo) {
        if (isRefuerzoOn) {
            panelRefuerzo.classList.add('active-warning');
            if (iconRefuerzo) iconRefuerzo.style.color = "var(--warning)";
        } else {
            panelRefuerzo.classList.remove('active-warning');
            if (iconRefuerzo) iconRefuerzo.style.color = "var(--text-muted)";
        }
    }

    // Tarjeta Dosis Manual (Activa exclusivamente durante fases de dosis manual)
    const isDosisManualOn = (globalModoCiclo === "MANUAL" && (globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador === "FILTRO_POST"));
    const panelDosisManual = document.getElementById('panelDosisManual');
    const lblDosisManual = document.getElementById('lblDosisManual');
    const iconDosisManual = document.getElementById('iconDosisManual');

    if (lblDosisManual) lblDosisManual.innerText = isDosisManualOn ? "Activa" : "INICIAR";
    if (iconDosisManual) {
        if (isDosisManualOn) {
            iconDosisManual.style.color = "var(--warning)";
            if (globalEstadoDosificador === "DOSIS") iconDosisManual.classList.add('anim-drop');
            else iconDosisManual.classList.remove('anim-drop');
        } else {
            iconDosisManual.style.color = "var(--accent)";
            iconDosisManual.classList.remove('anim-drop');
        }
    }
    if (panelDosisManual) {
        if (isDosisManualOn) {
            panelDosisManual.classList.add('active-warning');
        } else {
            panelDosisManual.classList.remove('active-warning', 'active-on');
        }
    }

    // Tarjeta Pausa
    const isPausaOn = (globalEstadoDosificador === "PAUSA");
    const panelPausa = document.getElementById('panelPausa');
    const lblPausa = document.getElementById('lblPausa');
    const iconPausa = document.getElementById('iconPausa');

    if (lblPausa) lblPausa.innerText = isPausaOn ? "ON" : "OFF";
    if (panelPausa) {
        if (isPausaOn) {
            panelPausa.classList.remove('active-warning');
            panelPausa.classList.add('active-danger');
            if (iconPausa) iconPausa.style.color = "var(--danger)";
        } else {
            panelPausa.classList.remove('active-danger', 'active-warning');
            if (iconPausa) iconPausa.style.color = "var(--text-muted)";
        }
    }

    const lblAnuladas = document.getElementById('lblAnuladas');
    const lblAnuladasControl = document.getElementById('lblAnuladasControl');
    if (lblAnuladas) lblAnuladas.innerText = globalDosisAnuladas;
    if (lblAnuladasControl) lblAnuladasControl.innerText = globalDosisAnuladas;
}

function updateSubtexto() {
    const lblEstadoSubtexto = document.getElementById('lblEstadoSubtexto');
    if (!lblEstadoSubtexto) return;

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
    } else if (globalEstadoDosificador === "FILTRO_MANUAL") {
        lblEstadoSubtexto.innerText = `Bomba de filtrado activa durante: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "FILTRO_PRE") {
        lblEstadoSubtexto.innerText = `Filtrado de estabilización de caudal - Fin de fase en: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "DOSIS") {
        lblEstadoSubtexto.innerText = isManual ? `DOSIS MANUAL - Dosificando cloro - Restan: ${formatTime(tr)}` : `Dosificando cloro - Restan: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "FILTRO_POST") {
        lblEstadoSubtexto.innerText = `Bomba de filtrado activa (Post-Dosis). Fin de fase en: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "FILTRO") {
        lblEstadoSubtexto.innerText = `Bomba de filtrado activa. Fin de fase en: ${formatTime(tr)}`;
    } else if (globalEstadoDosificador === "PAUSA") {
        lblEstadoSubtexto.innerText = "Ciclo suspendido temporalmente por mantenimiento.";
    } else if (globalEstadoDosificador === "RESET") {
        lblEstadoSubtexto.innerText = "Inicializando hardware...";
    }

    const isRefuerzoOn = (globalRefuerzo === 1 || globalRefuerzo === true || globalRefuerzo === "1");
    if (globalTemp !== null && globalTemp >= 27 && globalEstadoDosificador !== "PAUSA" && globalDosisAnuladas === 0 && !isRefuerzoOn) {
        const colorRec = globalTemp > 30 ? "var(--danger)" : "var(--warning)";
        const iconRec = globalTemp > 30 ? "local_fire_department" : "wb_sunny";
        const textoRec = globalTemp > 30 
            ? "🔥 Temperatura crítica (>30°C). Se recomienda activar el Refuerzo."
            : "☀️ Temperatura elevada (27-30°C). Se recomienda activar el Refuerzo.";
        
        const recHTML = `<div style="color: ${colorRec}; font-size: 0.82rem; margin-top: 6px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 4px; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 6px;"><span class="material-symbols-outlined" style="font-size: 1rem;">${iconRec}</span> ${textoRec}</div>`;
        
        if (globalEstadoDosificador === "IDLE") {
            lblEstadoSubtexto.innerHTML += recHTML;
        } else {
            lblEstadoSubtexto.innerHTML = `<div>${lblEstadoSubtexto.innerText}</div>` + recHTML;
        }
    }
}

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
            updateUI({ estado: "IDLE", tr: 0 });
        }
    }
}, 1000);

// === EVENTOS CLICK TARJETAS TÁCTILES DASHBOARD ===
const pBomba = document.getElementById('panelBomba');
if (pBomba) {
    pBomba.onclick = () => {
        const isBombaOn = (globalEstadoDosificador === "FILTRO" || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "FILTRO_POST" || globalEstadoDosificador === "FILTRO_MANUAL");
        if (isBombaOn) {
            sendCommand({ comando: "CANCEL_CYCLE" });
        } else {
            sendCommand({ comando: "START_PUMP" });
        }
    };
}

const pRefuerzo = document.getElementById('panelRefuerzo');
if (pRefuerzo) {
    pRefuerzo.onclick = () => {
        const isRefuerzoOn = (globalRefuerzo === 1 || globalRefuerzo === true);
        const nuevoValor = isRefuerzoOn ? 0 : 1;
        globalRefuerzo = nuevoValor;
        updateUI({});
        sendCommand({ comando: "SET_REFUERZO", refuerzo: nuevoValor === 1 });
    };
}

const pDosisManual = document.getElementById('panelDosisManual');
if (pDosisManual) {
    pDosisManual.onclick = () => {
        const isDosisManualOn = (globalModoCiclo === "MANUAL" && (globalEstadoDosificador === "FILTRO_PRE" || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador === "FILTRO_POST"));
        if (isDosisManualOn) {
            globalModoCiclo = "AUTO";
            globalEstadoDosificador = "IDLE";
            updateUI({ estado: "IDLE", modo: "AUTO" });
            sendCommand({ comando: "CANCEL_CYCLE" });
        } else {
            globalModoCiclo = "MANUAL";
            globalEstadoDosificador = "FILTRO_PRE";
            updateUI({ estado: "FILTRO_PRE", modo: "MANUAL" });
            sendCommand({ comando: "START_CYCLE", refuerzo: false });
        }
    };
}

const pPausa = document.getElementById('panelPausa');
if (pPausa) {
    pPausa.onclick = () => {
        const isPausaOn = (globalEstadoDosificador === "PAUSA");
        if (isPausaOn) {
            sendCommand({ comando: "RESUME_CYCLE" });
        } else {
            sendCommand({ comando: "PAUSE_CYCLE" });
        }
    };
}

const btnSumar = document.getElementById('btnSumarAnulada');
if (btnSumar) {
    btnSumar.onclick = () => {
        if (globalDosisAnuladas < 5) {
            globalDosisAnuladas++;
            updateUI({});
            sendCommand({ comando: "SET_ANULADAS", anuladas: globalDosisAnuladas });
        }
    };
}

const btnRestar = document.getElementById('btnRestarAnulada');
if (btnRestar) {
    btnRestar.onclick = () => {
        if (globalDosisAnuladas > 0) {
            globalDosisAnuladas--;
            updateUI({});
            sendCommand({ comando: "SET_ANULADAS", anuladas: globalDosisAnuladas });
        }
    };
}

// === GESTIÓN DE PROGRAMAS / CRONOGRAMAS ===
function setCronogramaInputsDisabled(disabled) {
    document.querySelectorAll('#cronogramaContainer input, #cronogramaContainer button, #cronogramaContainer .day-btn, #btnAgregarHorario, #btnProgAuto, #btnGuardarCronograma').forEach(el => {
        if (el.classList.contains('day-btn')) {
            el.style.pointerEvents = disabled ? 'none' : 'auto';
        } else {
            el.disabled = disabled;
        }
    });
}

function markProgramasChanged() {
    unsavedProgramasChanges = true;
    actualizarPanelTemporada();
}

function agregarFilaCronograma(inicio = "21:00", duracion = 60, dosifica = true, dias = "0123456") {
    const container = document.getElementById('cronogramaContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'crono-row';

    const topRow = document.createElement('div');
    topRow.className = 'crono-fields-grid';

    topRow.innerHTML = `
        <div class="crono-field">
            <label>Hora Inicio</label>
            <input type="time" class="inp-time" value="${inicio}">
        </div>
        <div class="crono-field">
            <label>Duración (min)</label>
            <input type="number" class="inp-dur" value="${duracion}" placeholder="Min">
        </div>
        <div class="crono-field checkbox-field">
            <label>Dosificar</label>
            <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.85rem; margin:0; font-weight:600; cursor:pointer;">
                <input type="checkbox" class="inp-dosis" ${dosifica ? 'checked' : ''}> Cloro
            </label>
        </div>
        <button class="btn-del" title="Eliminar horario">X</button>
    `;

    topRow.querySelector('.btn-del').onclick = () => {
        div.remove();
        markProgramasChanged();
    };

    topRow.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
            markProgramasChanged();
        });
    });

    const diasRow = document.createElement('div');
    diasRow.className = 'day-container';
    const letras = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    letras.forEach((l, index) => {
        const btn = document.createElement('div');
        btn.className = 'day-btn';
        if (dias.includes(index.toString())) btn.classList.add('active');
        btn.innerText = l;
        btn.onclick = () => {
            btn.classList.toggle('active');
            markProgramasChanged();
        };
        diasRow.appendChild(btn);
    });

    div.appendChild(topRow);
    div.appendChild(diasRow);
    container.appendChild(div);
}

function updateProgramasUI(data) {
    console.log("Recibido updateProgramasUI:", data);
    if (!data) return;
    lastProgramasData = data;
    const list = document.getElementById('cronogramaContainer');
    if (!list) return;

    list.innerHTML = '';

    for (let i = 1; i <= 10; i++) {
        const inicio = data[`PR${i}_inicio`];
        const duracion = data[`PR${i}_duracion_min`];
        const dosifica = data[`PR${i}_dosifica`];
        const dias = data[`PR${i}_dias`];

        if (inicio && duracion > 0) {
            const diasStr = Array.isArray(dias) ? dias.join('') : (dias !== undefined ? String(dias) : "0123456");
            agregarFilaCronograma(inicio, duracion, !!dosifica, diasStr);
        }
    }

    if (list.children.length === 0) {
        agregarFilaCronograma("21:00", 60, true, "0123456");
    }
    unsavedProgramasChanges = false;
    if (typeof updateSubtexto === 'function') updateSubtexto();
}

const btnAgregarHorario = document.getElementById('btnAgregarHorario');
if (btnAgregarHorario) {
    btnAgregarHorario.onclick = () => {
        const container = document.getElementById('cronogramaContainer');
        if (container && container.children.length >= 10) {
            customAlert("El máximo permitido es de 10 programas.");
            return;
        }
        agregarFilaCronograma("09:00", 60, false, "0123456");
        markProgramasChanged();
    };
}

const btnProgAuto = document.getElementById('btnProgAuto');
if (btnProgAuto) {
    btnProgAuto.onclick = async () => {
        if (await customConfirm("¿Estás seguro de cargar el Programa Automático? Sobrescribirá los horarios configurados.", "Programa Automático")) {
            const container = document.getElementById('cronogramaContainer');
            if (container) container.innerHTML = "";
            agregarFilaCronograma("09:00", 60, false, "0123456");
            agregarFilaCronograma("14:00", 60, false, "0123456");
            agregarFilaCronograma("21:00", 60, true, "0123456");
            markProgramasChanged();
            showToast("Programa automático cargado. Recuerda Guardar.");
        }
    };
}

const btnGuardarCronograma = document.getElementById('btnGuardarCronograma');
if (btnGuardarCronograma) {
    btnGuardarCronograma.onclick = async () => {
        const cron = obtenerListaProgramas();
        const objPayload = {};
        for (let i = 1; i <= 10; i++) {
            if (i <= cron.length) {
                const item = cron[i - 1];
                objPayload[`PR${i}_inicio`] = item.on;
                objPayload[`PR${i}_duracion_min`] = item.duracion;
                objPayload[`PR${i}_dosifica`] = item.dosifica;
                objPayload[`PR${i}_dias`] = item.dias.split("").map(Number);
            } else {
                objPayload[`PR${i}_inicio`] = "00:00";
                objPayload[`PR${i}_duracion_min`] = 0;
                objPayload[`PR${i}_dosifica`] = false;
                objPayload[`PR${i}_dias`] = [];
            }
        }

        unsavedProgramasChanges = false;
        setCronogramaInputsDisabled(true);
        showToast("Guardando cronograma en el equipo...");

        const waitTime = (modoConexion === "BLE") ? 10000 : 8000;
        pendingCronogramaTimeoutId = setTimeout(() => {
            setCronogramaInputsDisabled(false);
            pendingCronogramaTimeoutId = null;
            customAlert("El dosificador no confirmó los cambios del cronograma. Es posible que haya mala señal. Se revirtieron los cambios locales.", "Error de comunicación");
            if (lastProgramasData) updateProgramasUI(lastProgramasData);
        }, waitTime);

        if (modoConexion === "BLE") {
            try {
                await sendCommand({ comando: "config_cronograma", cronograma: cron });
            } catch (e) {
                console.error("Error BLE cron:", e);
            }
        } else {
            sendCommand({ comando: "config_cronograma", cronograma: cron });
            if (currentMac) {
                const progRef = doc(db, "equipos", currentMac, "programas", "actual");
                setDoc(progRef, objPayload).catch(e => console.warn("Error guardando en Firestore:", e));
            }
        }
    };
}

// === GESTIÓN DE CONFIGURACIÓN Y PARÁMETROS ===
function updateConfigUI(data) {
    if (!data) return;
    lastConfigData = data;

    if (data.wifi_ssid || data.ssid) {
        globalWifiSSID = data.wifi_ssid || data.ssid;
        if (modoConexion !== "BLE") setConexionModo("NUBE", globalWifiSSID);
    }
    actualizarPanelTemporada();

    const espSegs = data.tespera_seg !== undefined ? data.tespera_seg : 90;
    const inpEspMin = document.getElementById('inpEsperaMin');
    const inpEspSeg = document.getElementById('inpEsperaSeg');
    if (inpEspMin) inpEspMin.value = Math.floor(espSegs / 60);
    if (inpEspSeg) inpEspSeg.value = espSegs % 60;

    const dosSegs = data.tdosis_seg !== undefined ? data.tdosis_seg : 90;
    const inpDosMin = document.getElementById('inpDosisMin');
    const inpDosSeg = document.getElementById('inpDosisSeg');
    if (inpDosMin) inpDosMin.value = Math.floor(dosSegs / 60);
    if (inpDosSeg) inpDosSeg.value = dosSegs % 60;

    const ajuste = data.ajuste_baja !== undefined ? data.ajuste_baja : 50;
    const inpAjuste = document.getElementById('inpAjusteBaja');
    const lblAjuste = document.getElementById('lblValAjusteBaja');
    if (inpAjuste) inpAjuste.value = ajuste;
    if (lblAjuste) lblAjuste.innerText = `${ajuste}%`;

    if (data.temporada_alta_inicio && data.temporada_alta_inicio.includes("-")) {
        const parts = data.temporada_alta_inicio.split("-");
        const vDia = document.getElementById('selectFVeranoDia');
        const vMes = document.getElementById('selectFVeranoMes');
        if (vMes) vMes.value = parts[0];
        if (vDia) vDia.value = parts[1];
    }
    if (data.temporada_alta_fin && data.temporada_alta_fin.includes("-")) {
        const parts = data.temporada_alta_fin.split("-");
        const iDia = document.getElementById('selectFInviernoDia');
        const iMes = document.getElementById('selectFInviernoMes');
        if (iMes) iMes.value = parts[0];
        if (iDia) iDia.value = parts[1];
    }

    if (typeof updateSubtexto === 'function') updateSubtexto();
}

const btnGuardarConfig = document.getElementById('btnGuardarConfig');
if (btnGuardarConfig) {
    btnGuardarConfig.onclick = async () => {
        const espMin = parseInt(document.getElementById('inpEsperaMin').value) || 0;
        const espSeg = parseInt(document.getElementById('inpEsperaSeg').value) || 0;
        const dosMin = parseInt(document.getElementById('inpDosisMin').value) || 0;
        const dosSeg = parseInt(document.getElementById('inpDosisSeg').value) || 0;
        const ajuste = parseInt(document.getElementById('inpAjusteBaja').value) || 50;

        const vDia = document.getElementById('selectFVeranoDia').value || "01";
        const vMes = document.getElementById('selectFVeranoMes').value || "12";
        const iDia = document.getElementById('selectFInviernoDia').value || "31";
        const iMes = document.getElementById('selectFInviernoMes').value || "03";

        const tespera_seg = (espMin * 60) + espSeg;
        const tdosis_seg = (dosMin * 60) + dosSeg;
        const tempInicio = `${vMes}-${vDia}`;
        const tempFin = `${iMes}-${iDia}`;

        const payload = {
            comando: "SET_CONFIG",
            tespera_seg: tespera_seg,
            tdosis_seg: tdosis_seg,
            ajuste_baja: ajuste,
            temporada_alta_inicio: tempInicio,
            temporada_alta_fin: tempFin
        };

        if (modoConexion === "NUBE" && currentMac) {
            const cfgRef = doc(db, "equipos", currentMac, "config", "actual");
            const firestorePayload = {
                config_version: Date.now(),
                tespera_seg: tespera_seg,
                tdosis_seg: tdosis_seg,
                ajuste_baja: ajuste,
                temporada_alta_inicio: tempInicio,
                temporada_alta_fin: tempFin
            };
            setDoc(cfgRef, firestorePayload).catch(e => console.warn("Error guardando en Firestore:", e));
        }

        sendCommand(payload);
        showToast("Parámetros de tiempos guardados.");
    };
}

const inpAjusteBaja = document.getElementById('inpAjusteBaja');
if (inpAjusteBaja) {
    inpAjusteBaja.oninput = () => {
        const lbl = document.getElementById('lblValAjusteBaja');
        if (lbl) lbl.innerText = `${inpAjusteBaja.value}%`;
    };
}

// === CONEXIÓN Y REGISTRO DE RED WIFI ===
const btnGuardarWifi = document.getElementById('btnGuardarWifi');
if (btnGuardarWifi) {
    btnGuardarWifi.onclick = async () => {
        const ssidInp = document.getElementById('inpWifiSsid');
        const pwdInp = document.getElementById('inpWifiPwd');
        if (!ssidInp) return;

        const ssid = ssidInp.value.trim();
        const pwd = pwdInp ? pwdInp.value : "";

        if (!ssid) {
            customAlert("Ingresa el nombre de la red WiFi.");
            return;
        }

        sendCommand({ comando: "SET_WIFI", ssid: ssid, pwd: pwd });
        showToast("Datos de WiFi enviados al equipo.");
    };
}

// === HISTORIAL / LOGS DEL SISTEMA ===
const btnPedirHistorial = document.getElementById('btnPedirHistorial');
if (btnPedirHistorial) {
    btnPedirHistorial.onclick = () => {
        sendCommand({ comando: "GET_LOGS" });
        listenLogsCollection();
        showToast("Solicitando historial...");
    };
}

const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
if (btnLimpiarHistorial) {
    btnLimpiarHistorial.onclick = async () => {
        if (await customConfirm("¿Estás seguro de borrar todo el historial? Esto no se puede deshacer.", "Limpiar Historial")) {
            sendCommand({ comando: "CLEAR_LOGS" });
            try {
                const logsRef = collection(db, "equipos", currentMac, "logs");
                const snapshot = await getDocs(logsRef);
                for (const docSnap of snapshot.docs) {
                    await deleteDoc(docSnap.ref);
                }
                const term = document.getElementById('logsTerminal');
                if (term) term.innerHTML = "Historial limpiado.";
                showToast("Historial borrado.");
            } catch (e) {
                console.error("Error borrando logs:", e);
            }
        }
    };
}

window.techValveOpen = false;
const btnTechValve = document.getElementById('btnTechValve');
if (btnTechValve) {
    btnTechValve.onclick = () => {
        window.techValveOpen = !window.techValveOpen;
        sendCommand({ comando: "SET_VALVE_MANUAL", estado: window.techValveOpen });
        if (window.techValveOpen) {
            btnTechValve.innerText = "CERRAR";
            btnTechValve.style.backgroundColor = "var(--danger)";
            btnTechValve.style.color = "white";
        } else {
            btnTechValve.innerText = "ABRIR";
            btnTechValve.style.backgroundColor = "transparent";
            btnTechValve.style.color = "var(--text-main)";
        }
    };
}

// === PESTAÑA DE SOPORTE TÉCNICO Y AJUSTE DE CONTACTOS ===
const btnSoporteWsp = document.getElementById('btnSoporteWsp');
if (btnSoporteWsp) {
    btnSoporteWsp.onclick = () => {
        const wspNum = globalSoporteWsp || "5491153074195";
        window.open(`https://wa.me/${wspNum}?text=Hola,%20necesito%20soporte%20técnico%20con%20mi%20Dosimat%20IoT`, '_blank');
    };
}

const btnSoporteMail = document.getElementById('btnSoporteMail');
if (btnSoporteMail) {
    btnSoporteMail.onclick = () => {
        const mailAddr = globalSoporteMail || "soporte@dosimat.com";
        window.location.href = `mailto:${mailAddr}?subject=Soporte%20Dosimat%20IoT`;
    };
}

const btnCopyMac = document.getElementById('btnCopyMac');
if (btnCopyMac) {
    btnCopyMac.onclick = () => {
        if (currentMac) {
            navigator.clipboard.writeText(currentMac);
            showToast("MAC copiada al portapapeles: " + currentMac);
        }
    };
}

const btnRecomendar = document.getElementById('btnRecomendar');
if (btnRecomendar) {
    btnRecomendar.onclick = () => {
        const targetUrl = 'https://www.dosimat.com.ar';
        if (navigator.share) {
            navigator.share({
                title: 'Dosimat IoT',
                text: 'Te recomiendo Dosimat para el control inteligente de tu piscina.',
                url: targetUrl
            }).catch(() => {
                window.open(targetUrl, '_blank');
            });
        } else {
            window.open(targetUrl, '_blank');
        }
    };
}

const btnResetFabrica = document.getElementById('btnResetFabrica');
if (btnResetFabrica) {
    btnResetFabrica.onclick = async () => {
        if (await customConfirm("¿Estás seguro de reiniciar el equipo a valores de fábrica?", "Restablecer Fábrica")) {
            sendCommand({ comando: "RESET_FACTORY" });
        }
    };
}

const btnGuardarContactosSoporte = document.getElementById('btnGuardarContactosSoporte');
if (btnGuardarContactosSoporte) {
    btnGuardarContactosSoporte.onclick = async () => {
        const inpWsp = document.getElementById('inpConfigWsp');
        const inpMail = document.getElementById('inpConfigMail');
        if (!inpWsp || !inpMail) return;

        const wsp = inpWsp.value.trim();
        const mail = inpMail.value.trim().toLowerCase();

        if (!wsp || !mail) {
            customAlert("Debes completar el número de WhatsApp y el Email de soporte.");
            return;
        }

        try {
            await setDoc(doc(db, "configuracion_global", "contactos_soporte"), {
                whatsapp: wsp,
                email: mail,
                updatedAt: Date.now()
            }, { merge: true });

            globalSoporteWsp = wsp;
            globalSoporteMail = mail;
            showToast("Contactos de soporte guardados correctamente.");
        } catch (e) {
            console.error("Error guardando contactos:", e);
            showToast("Error al guardar contactos: " + e.message, true);
        }
    };
}

// === PORTAL TÉCNICO / ADMIN GLOBAL ===
async function loadAdminGlobal() {
    const listElem = document.getElementById('adminListContainer');
    if (!listElem) return;

    try {
        const userSnap = await getDocs(collection(db, "usuarios"));
        const macToUser = {};
        for (const userDoc of userSnap.docs) {
            const udata = userDoc.data();
            const eqSnap = await getDocs(collection(db, "usuarios", userDoc.id, "equipos_asignados"));
            eqSnap.forEach(eqDoc => {
                macToUser[eqDoc.id] = {
                    nombre: udata.nombre || udata.displayName || 'Sin nombre',
                    email: udata.email || 'Sin email'
                };
            });
        }

        // Recuperar root collection equipos por si hay equipos no asignados o para obtener alias si existen
        const snap = await getDocs(collection(db, "equipos"));
        const rootEquipos = {};
        snap.forEach(docSnap => {
            rootEquipos[docSnap.id] = docSnap.data();
        });

        const equipos = [];
        // Agregar todos los equipos asignados a usuarios
        for (const mac of Object.keys(macToUser)) {
            const data = rootEquipos[mac] || {};
            equipos.push({
                mac: mac,
                alias: data.alias || 'Sin alias',
                ownerName: macToUser[mac].nombre,
                ownerEmail: macToUser[mac].email
            });
            delete rootEquipos[mac]; // Ya procesado
        }
        
        // Agregar equipos que están en la base raíz pero no tienen dueño asignado
        for (const mac of Object.keys(rootEquipos)) {
            const data = rootEquipos[mac];
            equipos.push({
                mac: mac,
                alias: data.alias || 'Sin alias',
                ownerName: 'No asignado',
                ownerEmail: 'N/A'
            });
        }
        
        renderDevicesTable(equipos);
    } catch (e) {
        console.error("Error cargando equipos globales:", e);
    }
}

function renderDevicesTable(equipos) {
    const listContainer = document.getElementById('adminListContainer');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    if (equipos.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:1rem; color:var(--text-muted);">No hay equipos registrados</div>';
        return;
    }

    equipos.forEach(eq => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '0.75rem';
        item.style.background = 'var(--bg-color)';
        item.style.borderRadius = '8px';
        item.style.border = '1px solid var(--card-border)';
        item.style.marginBottom = '0.5rem';

        item.innerHTML = `
            <div>
                <div style="font-weight: bold; color: var(--text-main);">${eq.mac}</div>
                <div style="font-size: 0.85rem; color: var(--text-muted);">${eq.ownerName}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${eq.ownerEmail}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                <button class="btn outline" style="width: auto; padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="connectRemoteDevice('${eq.mac}')">Conectar</button>
                <button class="btn danger" style="width: auto; padding: 0.3rem 0.6rem; font-size: 0.8rem; background: var(--danger);" onclick="deleteRemoteDevice('${eq.mac}')">Dar de Baja</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

function connectRemoteDevice(mac) {
    currentMac = mac;
    isTechRemoteActive = true;

    const headerTech = document.getElementById('headerTechMode');
    const headerMac = document.getElementById('headerTechMac');
    const btnDisconnect = document.getElementById('btnDisconnectTech');

    if (headerTech) headerTech.style.display = 'block';
    if (headerMac) headerMac.innerText = mac;
    if (btnDisconnect) btnDisconnect.style.display = 'inline-block';

    connectNube();
    switchTab(document.querySelector('nav [data-target="dashboard"]'), 'dashboard');
    showToast(`Conectado en Modo Técnico a: ${mac}`);
}

const btnDisconnectTech = document.getElementById('btnDisconnectTech');
if (btnDisconnectTech) {
    btnDisconnectTech.onclick = () => {
        if (window.techValveOpen) {
            sendCommand({ comando: "SET_VALVE_MANUAL", estado: false });
            window.techValveOpen = false;
            const btnTV = document.getElementById('btnTechValve');
            if (btnTV) {
                btnTV.innerText = "ABRIR";
                btnTV.style.backgroundColor = "transparent";
                btnTV.style.color = "var(--text-main)";
            }
        }
        isTechRemoteActive = false;
        const headerTech = document.getElementById('headerTechMode');
        if (headerTech) headerTech.style.display = 'none';

        showToast("Conexión remota finalizada.");
        if (currentUser) {
            onAuthStateChanged(auth, () => { });
        }
    };
}

const btnConnectRemote = document.getElementById('btnConnectRemote');
if (btnConnectRemote) {
    btnConnectRemote.onclick = () => {
        const inp = document.getElementById('inpRemoteMac');
        if (inp && inp.value.trim()) {
            connectRemoteDevice(inp.value.trim().toUpperCase());
        } else {
            customAlert("Ingresa la MAC del equipo.");
        }
    };
}

async function loadTecnicosUI() {
    const container = document.getElementById('listaTecnicos');
    if (!container) return;

    try {
        const snap = await getDocs(collection(db, "administradores"));
        container.innerHTML = '';
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.style.padding = '0.5rem 0.75rem';
            div.style.background = 'var(--bg-color)';
            div.style.borderRadius = '6px';
            div.style.border = '1px solid var(--card-border)';

            div.innerHTML = `
                <div>
                    <strong>${data.nombre || 'Técnico'}</strong> (${docSnap.id})
                </div>
                <button class="btn danger" style="width: auto; padding: 0.2rem 0.5rem; font-size: 0.75rem; background: var(--danger);" onclick="deleteTecnico('${docSnap.id}')">Eliminar</button>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        console.error("Error cargando técnicos:", e);
    }
}

const btnAddTecnico = document.getElementById('btnAddTecnico');
if (btnAddTecnico) {
    btnAddTecnico.onclick = async () => {
        const inpEmail = document.getElementById('inpNewTecnico');
        const inpNombre = document.getElementById('inpNewTecnicoNombre');
        if (!inpEmail || !inpEmail.value.trim()) {
            customAlert("Ingresa el email del técnico.");
            return;
        }
        const email = inpEmail.value.trim().toLowerCase();
        const nombre = inpNombre ? inpNombre.value.trim() : "";

        try {
            await setDoc(doc(db, "administradores", email), { nombre: nombre, rol: "tecnico", ts: Date.now() });
            showToast("Técnico agregado.");
            inpEmail.value = "";
            if (inpNombre) inpNombre.value = "";
            loadTecnicosUI();
        } catch (e) {
            showToast("Error agregando técnico: " + e.message, true);
        }
    };
}

async function deleteTecnico(email) {
    if (await customConfirm(`¿Eliminar al técnico ${email}?`, "Eliminar Técnico")) {
        try {
            await deleteDoc(doc(db, "administradores", email));
            showToast("Técnico eliminado.");
            loadTecnicosUI();
        } catch (e) {
            showToast("Error al eliminar técnico: " + e.message, true);
        }
    }
}

async function deleteRemoteDevice(mac) {
    if (await customConfirm(`¿Deseas dar de baja el equipo ${mac}? Esto lo restablecerá a valores de fábrica y borrará sus datos.`, "Baja de Equipo")) {
        try {
            // 1. Enviar comando de factory reset (intentamos conectarnos por MQTT si no estamos)
            if (mqttClient && mqttClient.isConnected() && isTechRemoteActive && currentMac === mac) {
                sendCommand({ comando: "FACTORY_RESET" });
            } else {
                const clientId = "temp_admin_" + Date.now();
                const tempClient = new Paho.MQTT.Client("broker.hivemq.com", 8000, clientId);
                tempClient.connect({
                    onSuccess: () => {
                        const msg = new Paho.MQTT.Message(JSON.stringify({ comando: "FACTORY_RESET" }));
                        msg.destinationName = `dosimat/${mac}/cmd`;
                        tempClient.send(msg);
                        setTimeout(() => tempClient.disconnect(), 1000);
                    },
                    onFailure: () => console.log("No se pudo conectar MQTT temporal para Factory Reset")
                });
            }

            // 2. Eliminar referencias de dueños
            const userSnap = await getDocs(collection(db, "usuarios"));
            for (const userDoc of userSnap.docs) {
                const eqRef = doc(db, "usuarios", userDoc.id, "equipos_asignados", mac);
                const eqDoc = await getDoc(eqRef);
                if (eqDoc.exists()) {
                    await deleteDoc(eqRef);
                }
                const udata = userDoc.data();
                if (udata.equipos && udata.equipos.includes(mac)) {
                    const newEquipos = udata.equipos.filter(e => e !== mac);
                    await updateDoc(doc(db, "usuarios", userDoc.id), { equipos: newEquipos });
                }
            }

            // 3. Eliminar subcolecciones conocidas y root doc
            await deleteDoc(doc(db, "equipos", mac, "estado", "actual"));
            await deleteDoc(doc(db, "equipos", mac, "config", "actual"));
            await deleteDoc(doc(db, "equipos", mac, "programas", "actual"));
            
            try {
                const logsSnap = await getDocs(collection(db, "equipos", mac, "logs"));
                for (const d of logsSnap.docs) { await deleteDoc(d.ref); }
            } catch(e) {}
            
            try {
                const propSnap = await getDocs(collection(db, "equipos", mac, "propietarios"));
                for (const d of propSnap.docs) { await deleteDoc(d.ref); }
            } catch(e) {}
            
            await deleteDoc(doc(db, "equipos", mac));

            showToast(`Equipo ${mac} dado de baja exitosamente.`);
            loadAdminGlobal();
        } catch (e) {
            showToast("Error al dar de baja: " + e.message, true);
        }
    }
}

window.connectRemoteDevice = connectRemoteDevice;
window.deleteRemoteDevice = deleteRemoteDevice;
window.deleteTecnico = deleteTecnico;

console.log("Dosimat PWA v2 (Con LED virtual, timestamps seguros y refuerzo instantáneo) inicializada.");

// ==========================================
// RESTAURACIÓN LOGICA BLE Y VINCULACIÓN
// ==========================================

const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();
const RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();
const TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E".toLowerCase();

let bleDevice = null;
let bleServer = null;
let rxCharacteristic = null;
let txCharacteristic = null;
let rxBuffer = "";
let bleTxQueue = [];
let isBleTxActive = false;
let logsSyncTriggered = false;
let bleLogsTemp = [];

async function onDisconnected() {
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

async function vincularEquipo(chipId) {
    if (!currentUser) return false;
    
    // Verificación de seguridad: ¿Está asignado a otra persona?
    try {
        const q = query(collection(db, "usuarios"), where("equipos", "array-contains", chipId));
        const snaps = await getDocs(q);
        let alreadyOwned = false;
        snaps.forEach(s => {
            if (s.id !== currentUser.uid) {
                alreadyOwned = true;
            }
        });
        
        if (alreadyOwned) {
            const navTecnicos = document.querySelector('nav [data-target="tecnicos"]');
            if (typeof checkUserRole === "function" && navTecnicos && navTecnicos.style.display !== "none") {
                showToast("Equipo de otro usuario (Acceso Técnico)");
                return true; // Techs can link
            } else {
                customAlert("Este equipo ya se encuentra registrado por otro usuario. Si consideras que es un error, solicita un reseteo de fábrica al soporte técnico.");
                return false;
            }
        }
        
        // Proceder con la vinculación
        const refProp = doc(db, "equipos", chipId, "propietarios", currentUser.uid);
        await setDoc(refProp, { activo: true }, { merge: true });
        
        const refAsign = doc(db, "usuarios", currentUser.uid, "equipos_asignados", chipId);
        await setDoc(refAsign, { activo: true }, { merge: true });
        
        const refUser = doc(db, "usuarios", currentUser.uid);
        const userDoc = await getDoc(refUser);
        let eqList = [];
        if (userDoc.exists() && userDoc.data().equipos) eqList = userDoc.data().equipos;
        if (!eqList.includes(chipId)) eqList.push(chipId);
        await setDoc(refUser, { id_equipo: chipId, equipos: eqList }, { merge: true });
        
        return true;
    } catch(e) {
        console.error("Error validando/vinculando:", e);
        return false;
    }
}

let bleDecoder = new TextDecoder('utf-8');

async function handleNotifications(event) {
    const value = event.target.value;
    const chunk = bleDecoder.decode(value, { stream: true });
    
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
                    showToast("Historial descargado por BLE.");
                    logsSyncTriggered = false; // Resetear para permitir nueva descarga
                    
                    // Procesar registros históricos si los hay
                    if (bleLogsTemp.length > 0 && currentMac) {
                        if (currentUser) {
                            try {
                                const logsCol = collection(db, "equipos", currentMac, "logs");
                                for (const logItem of bleLogsTemp) {
                                    const logId = `log_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                                    await setDoc(doc(logsCol, logId), {
                                        fecha: logItem.fecha || new Date(logItem.ts * 1000).toLocaleString(),
                                        segundos: parseFloat(logItem.segundos || logItem.duracion || 0),
                                        tipo: logItem.tipo || "evento",
                                        refuerzo: !!logItem.refuerzo,
                                        timestamp: logItem.ts * 1000
                                    });
                                }
                                showToast(`Sincronizados ${bleLogsTemp.length} logs locales`);
                            } catch (err) {
                                console.error("Fallo al subir logs BLE:", err);
                            }
                        } else {
                            // Mostrar logs locales si no hay Firestore
                            const tbody = document.querySelector('#tablaHistorial tbody');
                            if (tbody) {
                                let html = "";
                                for (const lg of bleLogsTemp) {
                                    html += `<tr>
                                        <td>${lg.fecha || new Date(lg.ts * 1000).toLocaleString()}</td>
                                        <td>${lg.tipo || "evento"}</td>
                                    </tr>`;
                                }
                                tbody.innerHTML = html;
                            }
                        }
                    }
                    bleLogsTemp = [];
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
                    if (typeof updateConfigUI === "function") updateConfigUI(data.data);
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }

                if (data.tipo === "LOGS_LIST" && data.logs) {
                    if (typeof renderLogsList === "function") renderLogsList(data.logs);
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }

                if (data.tipo === "PROGRAMAS") {
                    if (typeof updateProgramasUI === "function") updateProgramasUI(data.data || data);
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }

                if (data.tipo === "ACK_CRON") {
                    if (pendingCronogramaTimeoutId) {
                        clearTimeout(pendingCronogramaTimeoutId);
                        pendingCronogramaTimeoutId = null;
                        setCronogramaInputsDisabled(false);
                        showToast("✅ Cronograma guardado y confirmado por el dosificador.");
                    }
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }

                if (data.tipo === "ACK_CONFIG" || data.tipo === "ACK_CFG") {
                    showToast("✅ Parámetros confirmados por el dosificador.");
                    boundary = rxBuffer.indexOf('\n');
                    continue;
                }

                // 2. Parser de telemetría compacta
                const innerData = data.tipo === "TELEMETRIA" ? data.data : data;
                const chipId = innerData.id_equipo || data.id_equipo;

                // 3. Vinculación y registro automático libre
                if (chipId) {
                    const oldMac = currentMac;
                    
                    if (oldMac !== chipId) {
                        if (currentUser) {
                            const canLink = await vincularEquipo(chipId);
                            if (!canLink) {
                                if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
                                return; // Rechazado por seguridad
                            }
                            connectNube();
                        }
                        currentMac = chipId;
                        const lbl = document.getElementById('lblMac');
                        if (lbl) lbl.innerText = currentMac;
                    }

                    // Solicitar descarga de logs offline una sola vez
                    if (!logsSyncTriggered) {
                        logsSyncTriggered = true;
                        bleLogsTemp = [];
                        setTimeout(() => {
                            sendCommand({comando: "GET_LOGS"}, true);
                            sendCommand({comando: "GET_CONFIG"}, true);
                            sendCommand({comando: "GET_PROGRAMAS"}, true);
                        }, 1500);
                    }
                }
                
                if (typeof updateUI === "function") updateUI(data);

            } catch (e) {
                console.error("Fallo decodificación BLE:", e);
            }
        }
        boundary = rxBuffer.indexOf('\n');
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

// BINDINGS DE LOS BOTONES
document.addEventListener('DOMContentLoaded', () => {
    const btnConnectBLE = document.getElementById('btnConnectBLE');
    if (btnConnectBLE) {
        btnConnectBLE.onclick = async () => {
            if (!navigator.bluetooth) {
                customAlert("Tu navegador no soporta Bluetooth Web o la página no es segura. Usa Chrome en Android y asegúrate de acceder mediante HTTPS.");
                return;
            }
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
                    const overlay = document.getElementById('connectOverlay');
                    if (overlay) overlay.style.display = 'none';
                }, 800);

                // RTC sync inicial
                syncRtcBLE();
                sendCommand({comando: "GET_STATE"}, true);

            } catch (e) {
                status.innerText = `Error BLE: ${e.message}`;
                console.error(e);
            }
        };
    }

    const btnCancelBLE = document.getElementById('btnCancelBLE');
    if (btnCancelBLE) {
        btnCancelBLE.onclick = () => {
            const overlay = document.getElementById('connectOverlay');
            if (overlay) overlay.style.display = 'none';
        };
    }

    const btnConnectManual = document.getElementById('btnConnectManual');
    if (btnConnectManual) {
        btnConnectManual.onclick = async () => {
            const txtManualMac = document.getElementById('txtManualMac');
            if (!txtManualMac) return;
            const mac = txtManualMac.value.trim().toUpperCase();
            if (!mac) {
                customAlert("Ingresa un ID válido.");
                return;
            }
            const canLink = await vincularEquipo(mac);
            if (canLink) {
                currentMac = mac;
                document.getElementById('lblMac').innerText = currentMac;
                connectNube();
                const overlay = document.getElementById('connectOverlay');
                if (overlay) overlay.style.display = 'none';
                showToast("Equipo vinculado exitosamente.");
            }
        };
    }
});

const btnShowConnectBLE = document.getElementById('btnShowConnectBLE');
if (btnShowConnectBLE) {
    btnShowConnectBLE.onclick = () => {
        setConexionModo("BLE");
        const auth = document.getElementById("authOverlay");
        if (auth) auth.style.display = "none";
        const connect = document.getElementById("connectOverlay");
        if (connect) connect.style.display = "flex";
    };
}


