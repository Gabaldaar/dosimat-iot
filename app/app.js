import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, deleteDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
var globalWifiSSID = "";
var lastConfigData = null;
var lastProgramasData = null;
var unsavedChanges = false;
var unsavedProgramasChanges = false;
var isTechRemoteActive = false;

var globalSoporteWsp = "5491136932456";
var globalSoporteMail = "soporte@dosimat.com";

var pendingCronogramaTimeoutId = null;
var unsubscribeFirestore = null;
var unsubscribeConfig = null;
var unsubscribeProgramas = null;
var unsubscribeSoporte = null;
var unsubscribeLogs = null;

// === DICCIONARIO DE AYUDA (BOTONES HELP) ===
const HELP_TOPICS = {
    "soporte-tecnico": {
        title: "Soporte Técnico",
        text: "Utiliza los botones para comunicarte directamente con el servicio de atención oficial de Dosimat vía WhatsApp o correo electrónico."
    },
    "info-equipo": {
        title: "Información del Equipo",
        text: "Muestra el identificador único (MAC) de tu equipo Dosimat IoT y la hora sincronizada del reloj en tiempo real."
    },
    "dashboard": {
        title: "Panel Principal",
        text: "Monitorea el estado actual del dosificador, bombas activas, temperatura del agua y te permite iniciar dosis manuales o pausar el equipo."
    },
    "programacion": {
        title: "Programación de Cronogramas",
        text: "Configura hasta 10 horarios diarios de filtrado y dosificación de cloro, seleccionando inicio, duración y días específicos."
    },
    "configuracion": {
        title: "Ajustes de Parámetros",
        text: "Modifica los tiempos de espera del motor, tiempos de dosis de cloro y porcentajes de ajuste para la temporada baja."
    },
    "historial": {
        title: "Logs del Sistema",
        text: "Muestra el registro cronológico de eventos, fases ejecutadas, inicios de bomba y alertas del dosificador."
    },
    "tecnicos": {
        title: "Portal Técnico",
        text: "Sección exclusiva de administración para conectarse remotamente a equipos por MAC y gestionar cuentas de técnicos."
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

document.addEventListener('DOMContentLoaded', initHelpButtons);

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

document.addEventListener('DOMContentLoaded', listenSupportContacts);
listenSupportContacts();

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
        lblTitulo.innerText = esAlta ? "Temp. Alta" : "Temp. Baja";
        lblTitulo.style.color = esAlta ? "var(--warning)" : "var(--accent)";
    }
    if (iconTemp) {
        iconTemp.innerText = esAlta ? "wb_sunny" : "ac_unit";
        iconTemp.style.color = esAlta ? "var(--warning)" : "var(--accent)";
    }
    if (lblFechas && lastConfigData) {
        const ini = lastConfigData.temporada_alta_inicio || "--/--";
        const fin = lastConfigData.temporada_alta_fin || "--/--";
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
        if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
        if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = null; }
        if (unsubscribeProgramas) { unsubscribeProgramas(); unsubscribeProgramas = null; }
        if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }
        if (mqttClient) { try { mqttClient.disconnect(); } catch (e) {} mqttClient = null; }

        await signOut(auth);
        showToast("Sesión cerrada.");
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
    
    let isSuper = (email === "gab.aldazabal@gmail.com" || email === "gabrielsew61@gmail.com");
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
                macToConnect = "841FE8694040";
            }
            currentMac = macToConnect;
            connectNube();
        } catch (e) {
            console.error("Error buscando equipos de usuario:", e);
            currentMac = "841FE8694040";
            connectNube();
        }
    } else {
        if (authOverlay) authOverlay.style.display = 'flex';
        if (userBar) userBar.style.display = 'none';
        if (lblUserName) lblUserName.style.display = 'none';
        
        if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
        if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = null; }
        if (unsubscribeProgramas) { unsubscribeProgramas(); unsubscribeProgramas = null; }
        if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }
        if (mqttClient) { try { mqttClient.disconnect(); } catch (e) {} mqttClient = null; }
        
        setConexionModo("OFFLINE");
    }
});

// === CONEXIÓN NUBE Y MQTT ===
function setConexionModo(modo, ssid = "") {
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
        badge.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1rem; vertical-align: middle;">wifi_off</span> <span>Offline</span>`;
        badge.className = "conn-badge conn-offline";
    }
}

function formatLogDate(ts) {
    const d = ts ? new Date(ts) : new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const aa = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${aa} - ${hh}:${min}:${ss}`;
}

function appendLogToTerminal(logText) {
    const term = document.getElementById('logsTerminal');
    if (!term) return;
    if (term.innerText.includes("Esperando eventos...")) {
        term.innerText = "";
    }
    const prefix = formatLogDate(Date.now());
    term.innerText = `${prefix} - ${logText}\n` + term.innerText;
}

function renderLogsList(logs) {
    const term = document.getElementById('logsTerminal');
    if (!term) return;
    if (!logs || !Array.isArray(logs)) return;
    let linesArr = logs.map(item => {
        if (typeof item === 'string') {
            if (item.includes(" - ")) return item;
            return `${formatLogDate(Date.now())} - ${item}`;
        }
        const ts = item.ts ? item.ts * 1000 : (item.timestamp || Date.now());
        const msg = item.msg || item.mensaje || item.tipo || JSON.stringify(item);
        if (msg.includes(" - ") && msg.split(" - ").length >= 2 && msg.includes("/")) {
            return msg;
        }
        return `${formatLogDate(ts)} - ${msg}`;
    });
    term.innerText = linesArr.slice(0, 20).join('\n');
}

function listenLogsCollection() {
    if (!currentMac) return;
    if (unsubscribeLogs) unsubscribeLogs();
    
    try {
        const q = query(collection(db, "equipos", currentMac, "logs"), orderBy("timestamp", "desc"), limit(20));
        unsubscribeLogs = onSnapshot(q, (snap) => {
            const term = document.getElementById('logsTerminal');
            if (!term) return;
            if (snap.empty) return;
            let logsArr = [];
            snap.forEach(docSnap => {
                const data = docSnap.data();
                const ts = data.timestamp || Date.now();
                const msg = data.mensaje || data.msg || data.log || JSON.stringify(data);
                if (msg.includes(" - ") && msg.split(" - ").length >= 2 && msg.includes("/")) {
                    logsArr.push(msg);
                } else {
                    logsArr.push(`${formatLogDate(ts)} - ${msg}`);
                }
            });
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
        try { mqttClient.disconnect(); } catch (e) {}
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
            const innerData = data.tipo === "TELEMETRIA" ? data.data : data;

            if (data.tipo === "ACK_CRON" || data.comando === "ACK_CRON" || data.status === "OK") {
                if (pendingCronogramaTimeoutId) {
                    clearTimeout(pendingCronogramaTimeoutId);
                    pendingCronogramaTimeoutId = null;
                    setCronogramaInputsDisabled(false);
                    showToast("🎉 Cronograma guardado y confirmado por el dosificador.");
                }
                return;
            }

            if (data.tipo === "ACK_CONFIG") {
                showToast("🎉 Parámetros confirmados por el dosificador.");
                return;
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
            console.log("MQTT Conectado a HiveMQ");
            mqttClient.subscribe(`dosimat/${currentMac}/telemetry`);
            mqttClient.subscribe(`dosimat/${currentMac}/config`);
            mqttClient.subscribe(`dosimat/${currentMac}/programas`);
            mqttClient.subscribe(`dosimat/${currentMac}/logs`);
            if (modoConexion !== "BLE") setConexionModo("NUBE", globalWifiSSID);
            sendCommand({ comando: "GET_STATE" }, true);
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
            updateUI(docSnap.data());
        }
    }, (err) => {
        console.warn("Firestore snapshot estado:", err.message);
    });

    if (unsubscribeConfig) unsubscribeConfig();
    const cfgRef = doc(db, "equipos", currentMac, "config", "actual");
    unsubscribeConfig = onSnapshot(cfgRef, (docSnap) => {
        if (docSnap.exists()) {
            updateConfigUI(docSnap.data());
        }
    }, (err) => {
        console.warn("Firestore snapshot config:", err.message);
    });

    if (unsubscribeProgramas) unsubscribeProgramas();
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

    listenLogsCollection();
}

// === ENVÍO DE COMANDOS Y FORMATO DE TIEMPO ===
async function sendCommand(obj, silent = false) {
    if (!currentMac) {
        if (!silent && typeof customAlert === "function") customAlert("No hay un equipo seleccionado.");
        return;
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
    const lblTemp = document.getElementById('lblTemp');
    if (lblTemp) {
        lblTemp.innerText = temp !== null ? `${temp}°C` : "--°C";
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

    // Tarjeta Dosis Manual (Activa desde que inicia el ciclo manual hasta volver a IDLE)
    const isDosisManualOn = (globalModoCiclo === "MANUAL" && globalEstadoDosificador !== "IDLE" && globalEstadoDosificador !== "PAUSA" && globalEstadoDosificador !== "RESET");
    const panelDosisManual = document.getElementById('panelDosisManual');
    const lblDosisManual = document.getElementById('lblDosisManual');
    const iconDosisManual = document.getElementById('iconDosisManual');

    if (lblDosisManual) lblDosisManual.innerText = isDosisManualOn ? "Activa" : "Iniciar";
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
            updateUI({estado: "IDLE", tr: 0});
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
        const val = isRefuerzoOn ? false : true;
        sendCommand({ comando: "SET_REFUERZO", refuerzo: val });
    };
}

const pDosisManual = document.getElementById('panelDosisManual');
if (pDosisManual) {
    pDosisManual.onclick = () => {
        const isDosisManualOn = (globalModoCiclo === "MANUAL" && globalEstadoDosificador !== "IDLE" && globalEstadoDosificador !== "PAUSA" && globalEstadoDosificador !== "RESET");
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
    const letras = ['L','M','X','J','V','S','D'];
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
                const item = cron[i-1];
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
                await sendCommand({ comando: "cron_start", total: cron.length }, true);
                await new Promise(r => setTimeout(r, 300));
                for (let i = 0; i < cron.length; i++) {
                    await sendCommand({
                        comando: "cron_add",
                        idx: i,
                        on: cron[i].on,
                        duracion: cron[i].duracion,
                        dosifica: cron[i].dosifica,
                        dias: cron[i].dias
                    }, true);
                    await new Promise(r => setTimeout(r, 300));
                }
                await sendCommand({ comando: "cron_commit" });
            } catch (e) {
                console.error("Error BLE cron:", e);
            }
        } else {
            sendCommand({ comando: "SET_PROGRAMAS", ...objPayload });
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
    btnLimpiarHistorial.onclick = () => {
        const term = document.getElementById('logsTerminal');
        if (term) term.innerText = "Historial limpiado.";
        showToast("Historial limpiado.");
    };
}

// === PESTAÑA DE SOPORTE TÉCNICO Y AJUSTE DE CONTACTOS ===
const btnSoporteWsp = document.getElementById('btnSoporteWsp');
if (btnSoporteWsp) {
    btnSoporteWsp.onclick = () => {
        const wspNum = globalSoporteWsp || "5491136932456";
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
        const snap = await getDocs(collection(db, "equipos"));
        const equipos = [];
        snap.forEach(docSnap => {
            equipos.push({ mac: docSnap.id, ...docSnap.data() });
        });
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
                <div style="font-size: 0.8rem; color: var(--text-muted);">${eq.alias || 'Sin alias'}</div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
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
        isTechRemoteActive = false;
        const headerTech = document.getElementById('headerTechMode');
        if (headerTech) headerTech.style.display = 'none';
        
        showToast("Conexión remota finalizada.");
        if (currentUser) {
            onAuthStateChanged(auth, () => {});
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
    if (await customConfirm(`¿Deseas dar de baja el equipo ${mac}?`, "Baja de Equipo")) {
        try {
            await deleteDoc(doc(db, "equipos", mac));
            showToast(`Equipo ${mac} dado de baja.`);
            loadAdminGlobal();
        } catch (e) {
            showToast("Error al dar de baja: " + e.message, true);
        }
    }
}

window.connectRemoteDevice = connectRemoteDevice;
window.deleteRemoteDevice = deleteRemoteDevice;
window.deleteTecnico = deleteTecnico;

console.log("Dosimat PWA v2 (Con animaciones CSS, SET_CONFIG, SET_PROGRAMAS y fecha DD/MM/AA) inicializada.");
