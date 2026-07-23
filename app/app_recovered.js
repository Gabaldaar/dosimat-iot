The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// === CONFIGURACIÓN DE FIREBASE (PLACEHOLDERS) ===
let firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MSG_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Autoconfiguración dinámica de Firebase Hosting para producción
try {
    const response = await fetch("/__/firebase/init.json").catch(() => null);
    if (response && response.ok) {
        const autoConfig = await response.json();
        firebaseConfig = { ...firebaseConfig, ...autoConfig };
        console.log("Firebase autoconfigurado desde Hosting.");
    }
} catch (e) {
    console.warn("No se pudo cargar la autoconfiguración del Hosting.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === ESTADO GLOBAL ===
let currentUser = null;
let currentMac = null;
let modoConexion = "OFFLINE"; // NUBE | BLE | OFFLINE
let mqttClient = null;
let bleDevice = null;
let bleServer = null;
let rxCharacteristic = null;
let txCharacteristic = null;
let rxBuffer = "";
let logsSyncTriggered = false;
let bleLogsTemp = [];
let localTimer = null;
let currentDosisSec = 0;
let unsavedChanges = false;
let unsubscribeFirestore = null;
let unsubscribeConfig = null;
let unsubscribeProgramas = null;
let pendingCommand = null;

let pendingConfigVersion = null;
let pendingConfigTimeoutId = null;
let lastConfigData = null;

let pendingCronogramaTimeoutId = null;
let lastCronogramaData = null;

let pendingWifiTimeoutId = null;

// UUIDs BLE Nordic UART Service
const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX_UUID      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const TX_UUID      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

// === PATRONES LED VIRTUAL ===
let globalEstadoDosificador = "IDLE";
let globalRefuerzo = 0;

const LED_PATRONES = {
    'En_espera_wifi':       [[1, 200], [0, 4000]],
    'En_espera_ble':        [[1, 200], [0, 2000]],
    'inactivo_refuerzo':    [[1, 200], [0, 200], [1, 200], [0, 4000]],
    'dosificando':          [[1, 1000], [0, 1000]],
    'dosificando_refuerzo': [[1, 4000], [0, 200]],
    'solo_bomba':           [[1, 500], [0, 500]],
    'mantenimiento':        [[1, 200], [0, 200]]
};

let estadoLedActual = {
    patron: LED_PATRONES['En_espera_ble'],
    indice: 0,
    ultimoCambio: Date.now()
};

// Loop de simulación del LED a 50ms
setInterval(() => {
    if (modoConexion === "OFFLINE") {
        setLedUi(0);
        return;
    }

    let patronSel = 'En_espera_ble';

    if (globalEstadoDosificador === "RESET" || globalEstadoDosificador === "PAUSA" || globalEstadoDosificador === "ANTI") {
        patronSel = 'mantenimiento';
    } else if (globalEstadoDosificador === "FILTRO") {
        patronSel = 'solo_bomba';
    } else if (globalEstadoDosificador === "DOSIS") {
        patronSel = (globalRefuerzo === 1) ? 'dosificando_refuerzo' : 'dosificando';
    } else {
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

        document.getElementById('btnModalConfirm').addEventListener('click', onConfirm);
        document.getElementById('btnModalCancel').addEventListener('click', onCancel);
    });
}

function customAlert(message, title = "Información") {
    return customConfirm(message, title);
}

// === GESTIÓN DE PESTAÑAS (SPA) ===
document.querySelectorAll('nav button').forEach(btn => {
    btn.onclick = () => {
        const target = btn.dataset.target;
        document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.container').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`tab-${target}`).classList.add('active');
        
        if (target === "soporte" && currentMac) {
            document.getElementById('lblMac').innerText = currentMac;
        }
    };
});

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

    try {
        if (authMode === "LOGIN") {
            await signInWithEmailAndPassword(auth, email, password);
        } else {