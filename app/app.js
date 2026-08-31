import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, updateProfile, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

// === CONEXIÓN A BASE DE DATOS DE DOSIMAT PRO (SISTEMA DE REPOSICIÓN) ===
const proFirebaseConfig = {
    apiKey: "AIzaSyAHX9U6coUWgM_1vMpvlzDJ05hTu3CCo6s",
    authDomain: "studio-8013388458-8013f.firebaseapp.com",
    projectId: "studio-8013388458-8013f",
    messagingSenderId: "711462197972",
    appId: "1:711462197972:web:d190a572e8561b3004f941"
};
let proApp = null;
let proAuth = null;
let proDb = null;
try {
    proApp = initializeApp(proFirebaseConfig, "dosimatProApp");
    proAuth = getAuth(proApp);
    proDb = getFirestore(proApp);
} catch (e) {
    console.error("Error inicializando DosimatPro App:", e);
}

// === ESTADO GLOBAL DE LA APLICACIÓN ===
var currentUser = null;
var currentMac = null;
var modoConexion = "OFFLINE";
var mqttClient = null;
var globalEstadoDosificador = "IDLE";
var globalModoCiclo = "AUTO";
var globalRefuerzo = 0;
var globalDosisAnuladas = 0;
var globalTempComp = false;
var globalTempOffset = 0.0;
var globalRawTemp = null;
var globalUltRefTs = 0;
var currentDosisSec = 0;
var globalTemp = null;
var globalWifiSSID = "";
var lastConfigData = null;
var lastProgramasData = null;
var unsavedChanges = false;
var unsavedProgramasChanges = false;
var isTechRemoteActive = false;

var globalModelo = "CB";
var globalBombaOn = 0;
var globalPinTecnico = localStorage.getItem("dosimat_pin_tecnico") || "2468";
const cachedUserRole = localStorage.getItem("dosimat_user_role");
var userEsTecnicoOAdmin = (cachedUserRole === "super_admin" || cachedUserRole === "tecnico");
var globalUltWarn = "";

function renderModeloUI() {
    const isSCB = (globalModelo === "SCB");

    // 0. Encabezado de la app
    const lblHeaderTitle = document.getElementById('lblHeaderTitle');
    if (lblHeaderTitle) {
        lblHeaderTitle.innerText = `Dosimat IoT ${globalModelo || 'CB'}`;
    }

    // 1. Dashboard: Tarjeta Bomba
    const lblBomba = document.getElementById('lblBomba');
    const panelBomba = document.getElementById('panelBomba');
    const iconBomba = document.getElementById('iconBomba');
    if (isSCB) {
        const isBombaOn = (globalBombaOn === 1 || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador.startsWith("FILTRO"));
        if (lblBomba) lblBomba.innerText = isBombaOn ? "Encendida" : "Apagada";
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
    }

    // 2. Pestaña Programar
    const lblTitulo = document.getElementById('lblTituloCronograma');
    const lblSubtitulo = document.getElementById('lblSubtituloCronograma');
    if (lblTitulo) lblTitulo.innerText = isSCB ? "Cronograma de Dosificación" : "Cronograma de Filtrado";
    if (lblSubtitulo) {
        lblSubtitulo.innerText = isSCB
            ? "Configura hasta 10 horarios de dosificación. Recuerda que debes programar la bomba de filtrado para que esté funcionando durante estos horarios."
            : "Configura hasta 10 horarios diarios de filtrado y dosificación.";
    }

    // Ocultar/Mostrar casillas 'Dosificar Cloro' en filas de cronograma
    document.querySelectorAll('#cronogramaContainer .checkbox-field').forEach(el => {
        if (isSCB) {
            el.style.display = 'none';
            const chk = el.querySelector('.inp-dosis');
            if (chk) chk.checked = true;
        } else {
            el.style.display = 'flex';
        }
    });

    // 3. Texto del Modal de Ayuda
    if (isSCB) {
        HELP_TOPICS["cronograma-filtrado"] = {
            title: "Programación de Dosificación",
            text: "Configura hasta 10 horarios de Dosificación independientes. Puedes seleccionar Horario y días de la semana en que se dosificará cloro. Se recomienda establecer las dosis en horarios nocturnos. Recuerda siempre que la bomba debe estar filtrando en los horarios de dosificación.\n\nPrograma Automático: establece 1 horario estándar de dosificación."
        };
    } else {
        HELP_TOPICS["cronograma-filtrado"] = {
            title: "Programación de Cronogramas",
            text: "Configura hasta 10 horarios de Filtrado/Dosificación independientes. Permite seleccionar Horario, Días de la semana en que se repetirá el ciclo y si en ese horario debe dosificar cloro o no. Se recomienda establecer las dosis en horarios nocturnos. Programa Automático: establece 3 horarios estándar de filtrado, uno de ellos con dosificación."
        };
    }

    // 4. Actualización del Selector de Modelo en Ajustes
    actualizarModeloControlPermisos();

    // 5. Información del Equipo en Solapa Ayuda
    const lblModeloInfo = document.getElementById('lblModeloInfo');
    if (lblModeloInfo) {
        if (isSCB) {
            lblModeloInfo.innerText = "Dosimat_IoT SCB (Sin Control de Bomba)";
            lblModeloInfo.style.color = "var(--warning)";
        } else {
            lblModeloInfo.innerText = "Dosimat_IoT CB (Con Control de Bomba)";
            lblModeloInfo.style.color = "var(--accent)";
        }
    }
}

function actualizarModeloControlPermisos() {
    const sel = document.getElementById('selModeloEquipo');
    const btn = document.getElementById('btnGuardarModelo');
    const lockArea = document.getElementById('divModeloLockArea');

    if (sel) {
        // Solo actualizar el selector si el usuario no lo está manipulando actualmente
        if (document.activeElement !== sel && !sel.dataset.userModified) {
            sel.value = globalModelo || "CB";
        }

        if (userEsTecnicoOAdmin) {
            sel.disabled = false;
            if (btn) btn.style.display = 'inline-block';
            if (lockArea) lockArea.style.display = 'none';
        } else {
            sel.disabled = true;
            if (btn) btn.style.display = 'none';
            if (lockArea) lockArea.style.display = 'flex';
        }
    }
}

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
    "compensacion-temperatura": {
        title: "Compensación de Temperatura",
        text: "El equipo medirá la temperatura de su sensor interno y dosificará refuerzos automáticos (doble dosis) según corresponda:\n" +
            "• Entre 29°C y 32°C: activa un refuerzo cada 4 días.\n" +
            "• Mayor a 32°C: activa un refuerzo cada 3 días."
    },
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
        text: "Sigue estos 4 simples pasos para poner en marcha tu equipo:\n\n" +
            "1️⃣ Ingresá a la aplicación con la cuenta de correo con la que quieras registrarte (Todavía no tendrás control del equipo).\n\n" +
            "2️⃣ Abrí Ajustes y Tocá 'Buscar Dosificador por BLE'. Aquí ya estás conectado a tu equipo, por Bluetooth.\n\n" +
            "3️⃣ Para configurar el WiFi de tu casa: En la pestaña de Ajustes (Conectividad WiFi local), ingresá el Nombre (SSID) y Contraseña de tu WiFi domiciliario y presioná 'Registrar Red WiFi'. El equipo se reiniciará y se conectará a la Nube. Ya podés ingresar desde cualquier lugar con tu usuario y clave.\n\n" +
            "4️⃣ Si tu red WiFi no llega hasta el Dosimat, simplemente conectate por BLE cuando quieras controlarlo."
    },
    "guia-tecnico": {
        title: "Guía de Operaciones Técnicas",
        text: "🛠️ MANUAL RÁPIDO PARA TÉCNICOS E INSTALADORES\n\n" +
            "1️⃣ CÓMO CONECTARSE A UN EQUIPO:\n" +
            "• Remoto (WiFi / Nube): En este Portal Técnico, busca el equipo en la lista y pulsa 'Conectar', o escribe la MAC y pulsa 'Conectar'. Verás la barra roja superior con los datos del cliente.\n" +
            "• Local (Bluetooth / BLE): Útil en instalaciones nuevas o sin internet. Ve a la solapa Ajustes > Vinculación Bluetooth y presiona 'Buscar Dosificador por BLE'.\n\n" +
            "2️⃣ CÓMO REGISTRAR UNA NUEVA RED WIFI:\n" +
            "• Conéctate al dosificador primero por Bluetooth (BLE) desde Ajustes.\n" +
            "• En la tarjeta 'Conectividad WiFi local', escribe el Nombre (SSID) y Contraseña del WiFi del cliente.\n" +
            "• Presiona 'Registrar Red WiFi'. El equipo guardará los datos en memoria, se reiniciará y se vinculará a la nube.\n\n" +
            "3️⃣ CÓMO MODIFICAR EL MODELO DE EQUIPO (CB / SCB):\n" +
            "• Conéctate al equipo (por BLE o Nube).\n" +
            "• Ve a la solapa Ajustes > Modelo de Equipo.\n" +
            "• Elige entre 'CB' (Con Control de Bomba) o 'SCB' (Sin Control de Bomba).\n" +
            "• Si estás usando el teléfono del cliente o sin sesión iniciada, pulsa '🔑 Desbloquear con PIN' e ingresa el PIN maestro.\n" +
            "• Presiona 'Guardar Modelo de Placa' y confirma."
    },
    "bidon-calculadora": {
        title: "Nivel de Cloro y Calculadora",
        text: "🛢️ ESTIMADOR DE NIVEL DE BIDÓN Y AUTONOMÍA:\n\n" +
            "• Muestra el nivel de cloro restante y los días de autonomía estimados según tu cronograma activo y los registros del equipo.\n" +
            "• Registrar Recarga: Permite registrar los bidones repuestos y la fecha de reposición (reiniciando el contador del equipo).\n" +
            "• Ajustar Nivel: Permite configurar la cantidad total de bidones instalados (27L c/u), corregir el nivel actual y definir los umbrales de alerta de nivel bajo.\n\n" +
            "📐 CALCULADORA DE PISCINA:\n\n" +
            "• Calcula el volumen total de agua ingresando las dimensiones de tu piscina.\n" +
            "• Sugiere la dosis diaria recomendada para Verano a razón de 1 Litro de cloro cada 20.000 Litros de agua (sin alterar tu cronograma)."
    },
    "ubicacion-clima": {
        title: "Ubicación y Clima Local",
        text: "Configura la ubicación geográfica de tu equipo por GPS o búsqueda manual para consultar el pronóstico del tiempo (Open-Meteo) y recibir sugerencias inteligentes de refuerzo de cloro ante olas de calor o lluvias intensas."
    },
    "portal-reposicion": {
        title: "Sistema de Reposición",
        text: "🚚 SISTEMA DE REPOSICIÓN DE CLORO A DOMICILIO:\n\n" +
            "• Consulta las próximas fechas de entrega programadas en las hojas de ruta de Dosimat.\n" +
            "• Permite solicitar bidones de Cloro (27L) y Ácido (10L) directamente al sistema.\n" +
            "• Permite consultar tu estado de cuenta y cancelar pedidos pendientes."
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
                customAlert(
                        "Seleccioná aquí el hardware de tu equipo.\n\n"+
                        "Modelo Dosimat_IoT SCB:\n"+
                        "Equipo sin control de la bomba de filtrado.\n\n"+
                        "Modelo Dosimat_IoT CB:\n"+
                        "Equipo con control de la bomba de filtrado.\n\n"+
                        "Este ajuste sólo está disponible para personal técnico.",
                        "Ayuda"
                );
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

function customPrompt(message, title = "Ingreso de datos", placeholder = "", inputType = "text") {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const btnConfirm = document.getElementById('btnModalConfirm');
        const btnCancel = document.getElementById('btnModalCancel');
        const inputContainer = document.getElementById('modalInputContainer');
        const modalInput = document.getElementById('modalInput');

        if (!modal || !btnConfirm || !btnCancel || !modalInput) {
            resolve(prompt(`${title}\n\n${message}`) || null);
            return;
        }

        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalMessage').innerText = message;
        if (inputContainer) inputContainer.style.display = 'block';
        modalInput.value = "";
        modalInput.placeholder = placeholder;
        modalInput.type = inputType;
        modal.style.display = 'flex';
        setTimeout(() => modalInput.focus(), 100);

        const cleanup = () => {
            modal.style.display = 'none';
            if (inputContainer) inputContainer.style.display = 'none';
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        };
        const onConfirm = () => {
            const val = modalInput.value;
            cleanup();
            resolve(val);
        };
        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
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
    let esDobleDosis = false;
    if (esDosis) {
        let baseSec = (lastConfigData && lastConfigData.tdosis_seg) ? lastConfigData.tdosis_seg : 300;
        if (!esTemporadaAlta()) {
            const ajuste = (lastConfigData && lastConfigData.ajuste_baja !== undefined) ? parseInt(lastConfigData.ajuste_baja) : 10;
            baseSec = Math.floor(baseSec * (ajuste / 100));
        }
        esDobleDosis = (globalRefuerzo === 1 || globalRefuerzo === true || globalRefuerzo === "1");
        if (!esDobleDosis && globalTempComp && globalTemp !== null && globalTemp >= 29.0) {
            const intervalDays = globalTemp > 32.0 ? 3 : 4;
            const intervalSecs = intervalDays * 24 * 3600;
            const nowEpoch = Math.floor(Date.now() / 1000);
            const timeSinceLastBooster = nowEpoch - globalUltRefTs;
            const timeRemaining = intervalSecs - timeSinceLastBooster;
            if (timeRemaining <= 300 || globalUltRefTs === 0) {
                esDobleDosis = true;
            }
        }

        if (esDobleDosis) {
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
        refuerzoActivo: esDobleDosis,
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
                if (proAuth) {
                    signInWithEmailAndPassword(proAuth, email, password).catch(() => {});
                }
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

    userEsTecnicoOAdmin = (isSuper || isTecnico);
    localStorage.setItem("dosimat_user_role", isSuper ? "super_admin" : (isTecnico ? "tecnico" : "user"));
    if (typeof actualizarModeloControlPermisos === "function") actualizarModeloControlPermisos();

    if (navTecnicos) {
        navTecnicos.style.display = (isSuper || isTecnico) ? "flex" : "none";
    }

    if (cardGestion) {
        cardGestion.style.display = isSuper ? "block" : "none";
    }

    const cardPinTecnico = document.getElementById('cardPinTecnico');
    if (cardPinTecnico) {
        cardPinTecnico.style.display = isSuper ? "block" : "none";
    }

    if (cardConfigSoporte) {
        cardConfigSoporte.style.display = (isSuper || isTecnico) ? "block" : "none";
    }

    const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
    if (btnLimpiarHistorial) {
        btnLimpiarHistorial.style.display = "flex";
    }

    const techValveControl = document.getElementById('techValveControl');
    if (techValveControl) {
        techValveControl.style.display = (isSuper || isTecnico) ? "flex" : "none";
    }

    if (isSuper || isTecnico) {
        loadAdminGlobal();
        loadTecnicosUI();
        if (isSuper) loadPinTecnicoAdmin();
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
        
        const pendingMac = localStorage.getItem('pending_link_mac');
        if (pendingMac && user) {
            await vincularEquipo(pendingMac);
            currentMac = pendingMac;
            localStorage.removeItem('pending_link_mac');

            const pendingSsid = localStorage.getItem('pending_wifi_ssid');
            const pendingPwd = localStorage.getItem('pending_wifi_pwd');
            if (pendingSsid) {
                sendCommand({ comando: "SET_WIFI", ssid: pendingSsid, pwd: pendingPwd || "" });
                localStorage.removeItem('pending_wifi_ssid');
                localStorage.removeItem('pending_wifi_pwd');
                showToast(`Equipo ${pendingMac} vinculado a tu cuenta y datos de WiFi enviados.`);
            } else {
                showToast(`Equipo ${pendingMac} vinculado a tu cuenta.`);
            }
        }

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

        if (typeof syncDosimatProClient === "function") syncDosimatProClient();
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
        if (typeof syncDosimatProClient === "function") syncDosimatProClient();
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

function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[m]));
}

let currentLogsCache = [];

function parseLogDetails(logItem) {
    let rawMsg = "";
    let ts = 0;
    let tipo = "";

    if (typeof logItem === 'string') {
        rawMsg = logItem;
    } else if (logItem && typeof logItem === 'object') {
        rawMsg = logItem.msg || logItem.mensaje || logItem.log || logItem.tipo || JSON.stringify(logItem);
        ts = logItem.ts || logItem.timestamp || 0;
        tipo = String(logItem.tipo || "").toLowerCase();
    }

    let timeStr = "";
    let titleStr = rawMsg;

    // Si viene en formato "31/08/26 - 11:05:01 - Dosis no realizada: Bomba apagada"
    const parts = rawMsg.split(" - ");
    if (parts.length >= 3 && parts[0].includes("/")) {
        timeStr = `${parts[0]} - ${parts[1]}`;
        titleStr = parts.slice(2).join(" - ");
    } else if (parts.length === 2 && parts[0].includes("/")) {
        timeStr = parts[0];
        titleStr = parts[1];
    } else {
        timeStr = formatLogDate(ts || Date.now());
        titleStr = rawMsg;
    }

    const lowTitle = titleStr.toLowerCase();
    let iconName = "info";
    let iconClass = "system";

    if (tipo === "warning" || lowTitle.includes("bomba apagada") || lowTitle.includes("no realizada") || lowTitle.includes("detenido") || lowTitle.includes("error")) {
        iconName = "warning";
        iconClass = "warning";
    } else if (tipo === "dosis_ok" || lowTitle.includes("dosis completada") || lowTitle.includes("dosis finalizada") || lowTitle.includes("dosis automática") || lowTitle.includes("dosis manual") || lowTitle.includes("dosificando")) {
        iconName = "water_drop";
        iconClass = "dosis";
    } else if (lowTitle.includes("pausa") || lowTitle.includes("mantenimiento")) {
        iconName = "pause_circle";
        iconClass = "pausa";
    } else if (lowTitle.includes("reinicio") || lowTitle.includes("iniciado")) {
        iconName = "restart_alt";
        iconClass = "system";
    } else if (lowTitle.includes("temperatura") || lowTitle.includes("refuerzo")) {
        iconName = "device_thermostat";
        iconClass = "temp";
    }

    return {
        title: titleStr,
        time: timeStr,
        icon: iconName,
        iconClass: iconClass
    };
}

function createLogCardElement(parsed) {
    const card = document.createElement('div');
    card.className = "event-card";
    card.innerHTML = `
        <div class="event-icon-box ${parsed.iconClass}">
            <span class="material-symbols-outlined">${parsed.icon}</span>
        </div>
        <div class="event-body">
            <div class="event-main-text">${escapeHtml(parsed.title)}</div>
            <div class="event-sub-text">${escapeHtml(parsed.time)}</div>
        </div>
    `;
    return card;
}

function appendLogToTerminal(logData) {
    const container = document.getElementById('logsCardsContainer');
    const term = document.getElementById('logsTerminal');

    const logObj = (typeof logData === 'object') ? logData : { msg: String(logData), ts: Date.now() };
    currentLogsCache.unshift(logObj);
    if (currentLogsCache.length > 50) currentLogsCache.pop();
    calcularDosis15Dias(currentLogsCache);

    if (container) {
        const emptyEl = container.querySelector('.historial-empty');
        if (emptyEl) container.innerHTML = "";

        const parsed = parseLogDetails(logObj);
        const cardEl = createLogCardElement(parsed);
        container.insertBefore(cardEl, container.firstChild);

        while (container.children.length > 30) {
            container.removeChild(container.lastChild);
        }
    }

    if (term) {
        const rawMsg = logObj.msg || logObj.mensaje || logObj.tipo || String(logData);
        term.innerText = `${rawMsg}\n` + term.innerText;
    }
    if (typeof evaluarAlertasSistema === "function") evaluarAlertasSistema();
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
        } else {
            ts = item.ts || item.timestamp || 0;
            if (ts && typeof ts.toMillis === 'function') ts = ts.toMillis();
            else if (ts && typeof ts.seconds === 'number') ts = ts.seconds * 1000;
            
            if (ts && typeof ts === 'number' && ts < 2000000000) {
                if (ts < 1000000000 && ts > 0) {
                    ts = (ts + 946684800) * 1000;
                } else {
                    ts = ts * 1000;
                }
            }

            msg = item.msg || item.mensaje || item.tipo || JSON.stringify(item);
            if (item.refuerzo === true || item.refuerzo === 1 || item.refuerzo === "1" || item.refuerzo === "true") isRef = true;
        }

        if (!ts || isNaN(ts) || ts === 0 || ts < 1000000000000) {
            try {
                const parts = msg.split(" - ");
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
        }
        if (!ts || isNaN(ts) || ts === 0) ts = now;

        if (now - ts <= limitMs && now >= ts - 86400000) {
            const msgLower = msg.toLowerCase();
            const tipoLower = String(item.tipo || "").toLowerCase();

            // Comprobar estrictamente si fue una dosis completada con éxito
            const esDosisExitosa = (
                tipoLower === "dosis_ok" ||
                msgLower.includes("dosis completada") ||
                msgLower.includes("dosis finalizada") ||
                (
                    (msgLower.includes("dosis automática") || msgLower.includes("dosis manual") || msgLower.includes("dosificando")) &&
                    !msgLower.includes("no realizada") &&
                    !msgLower.includes("bomba apagada") &&
                    !msgLower.includes("detenido") &&
                    !msgLower.includes("salteada") &&
                    !msgLower.includes("pausada") &&
                    !msgLower.includes("anulada") &&
                    !msgLower.includes("suspendida") &&
                    !msgLower.includes("cancelada")
                )
            );
            
            if (esDosisExitosa) {
                if (isRef || msgLower.includes("refuerzo activo") || msgLower.includes("refuerzo: si") || msgLower.includes("con refuerzo") || msgLower.includes("refuerzo")) {
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
    const container = document.getElementById('logsCardsContainer');
    const term = document.getElementById('logsTerminal');
    if (!logs || !Array.isArray(logs)) return;

    currentLogsCache = [...logs];
    calcularDosis15Dias(currentLogsCache);

    if (container) {
        container.innerHTML = "";
        if (logs.length === 0) {
            container.innerHTML = `
                <div class="historial-empty">
                    <span class="material-symbols-outlined">receipt_long</span>
                    <div>No hay registros recientes.</div>
                </div>
            `;
            return;
        }

        logs.slice(0, 30).forEach(item => {
            const parsed = parseLogDetails(item);
            const cardEl = createLogCardElement(parsed);
            container.appendChild(cardEl);
        });
    }

    if (term) {
        term.innerText = logs.map(item => typeof item === 'string' ? item : (item.msg || JSON.stringify(item))).join('\n');
    }
    if (typeof evaluarAlertasSistema === "function") evaluarAlertasSistema();
}

let lastNotifiedAlerts = {};

function dispararNotificacionLocal(titulo, cuerpo, id) {
    if (lastNotifiedAlerts[id] && Date.now() - lastNotifiedAlerts[id] < 10 * 60 * 1000) {
        return;
    }
    lastNotifiedAlerts[id] = Date.now();

    if ("Notification" in window) {
        if (Notification.permission === "granted") {
            try {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(titulo, {
                        body: cuerpo,
                        icon: "icon-192.png",
                        badge: "icon-192.png",
                        vibrate: [200, 100, 200]
                    });
                }).catch(() => {
                    new Notification(titulo, { body: cuerpo, icon: "icon-192.png" });
                });
            } catch (e) {
                try {
                    new Notification(titulo, { body: cuerpo, icon: "icon-192.png" });
                } catch(err) {}
            }
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }
}

function navigateToTab(targetName) {
    const navBtn = document.querySelector(`nav [data-target="${targetName}"]`);
    if (navBtn && typeof switchTab === "function") {
        switchTab(navBtn, targetName);
    }
}

function evaluarAlertasSistema() {
    const container = document.getElementById('systemAlertsContainer');
    if (!container) return;

    if (!currentMac || modoConexion === "OFFLINE") {
        container.style.display = "none";
        container.innerHTML = "";
        return;
    }

    const alerts = [];

    // 1. Sin dosificación programada (comprueba todos los programas de 1 a 10)
    if (lastProgramasData) {
        let hayProgramasActivos = false;
        for (let i = 1; i <= 10; i++) {
            const dur = lastProgramasData[`PR${i}_duracion_min`];
            const dos = lastProgramasData[`PR${i}_dosifica`];
            const dias = lastProgramasData[`PR${i}_dias`];
            const hasDays = (Array.isArray(dias) && dias.length > 0) || (typeof dias === 'string' && dias.length > 0);
            if (dur > 0 && dos && hasDays) {
                hayProgramasActivos = true;
                break;
            }
        }
        if (!hayProgramasActivos) {
            alerts.push({
                id: "sin_cronograma",
                type: "warning",
                icon: "event_busy",
                title: "Sin dosificación programada",
                desc: "No hay programas de dosificación configurados. Tu piscina no recibirá cloro.",
                btnText: "Configurar",
                action: () => navigateToTab("programacion"),
                notifTitle: "Dosimat",
                notifBody: "No hay programas de cloro activos. Tu piscina no está recibiendo cloro."
            });
        }
    }

    // 2. Modo Pausa / Mantenimiento activo
    if (globalEstadoDosificador === "PAUSA" || globalEstadoDosificador === "MANTENIMIENTO" || (typeof isPausaActiva !== "undefined" && isPausaActiva)) {
        alerts.push({
            id: "modo_pausa",
            type: "warning",
            icon: "pause_circle",
            title: "Modo Pausa Activo",
            desc: "El dosificador está detenido manualmente. No se ejecutarán dosis automáticas.",
            btnText: "Reanudar",
            action: async () => {
                if (typeof togglePausa === "function") togglePausa();
            },
            notifTitle: "Dosimat",
            notifBody: "El equipo está en Pausa. Recuerda reanudarlo para proteger la piscina."
        });
    }

    // 3. Más de 24h sin dosificar
    let ultimaDosisExitosaTs = 0;
    if (Array.isArray(currentLogsCache) && currentLogsCache.length > 0) {
        for (const item of currentLogsCache) {
            let msg = "";
            let ts = 0;
            let tipo = "";
            if (typeof item === "string") {
                msg = item;
            } else if (item && typeof item === "object") {
                msg = item.msg || item.mensaje || "";
                ts = item.ts || item.timestamp || 0;
                tipo = String(item.tipo || "");
            }
            if (tipo === "dosis_ok" || msg.toLowerCase().includes("dosis completada") || msg.toLowerCase().includes("dosis finalizada") || (msg.toLowerCase().includes("dosis") && !msg.toLowerCase().includes("no realizada") && !msg.toLowerCase().includes("bomba apagada"))) {
                if (!ts || ts === 0) {
                    try {
                        const parts = msg.split(" - ");
                        if (parts.length >= 2 && parts[0].includes("/")) {
                            const dateParts = parts[0].split("/");
                            const timeParts = parts[1].split(":");
                            let year = parseInt(dateParts[2], 10);
                            if (year < 100) year += 2000;
                            const d = new Date(year, parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10), parseInt(timeParts[0], 10), parseInt(timeParts[1], 10));
                            ts = d.getTime();
                        }
                    } catch(e) {}
                }
                if (ts > ultimaDosisExitosaTs) ultimaDosisExitosaTs = ts;
            }
        }
    }

    const now = Date.now();
    if (ultimaDosisExitosaTs > 0 && now - ultimaDosisExitosaTs > 24 * 60 * 60 * 1000) {
        alerts.push({
            id: "sin_dosis_24h",
            type: "danger",
            icon: "warning",
            title: "Atención: +24h sin dosificar",
            desc: "Han pasado más de 24 horas desde la última dosis de cloro exitosa.",
            btnText: "Dosificar Ahora",
            action: async () => {
                if (typeof iniciarDosisManual === "function") iniciarDosisManual();
            },
            notifTitle: "Dosimat Alerta",
            notifBody: "Han pasado más de 24h sin aplicar cloro en tu piscina."
        });
    }

    // 4. Último log: Dosis no realizada por bomba apagada
    if (globalUltWarn && (globalUltWarn.includes("Bomba apagada") || globalUltWarn.includes("Dosis no realizada") || globalUltWarn.includes("Ciclo detenido"))) {
        alerts.push({
            id: "dosis_fallida_bomba",
            type: "warning",
            icon: "power_off",
            title: "Dosis no realizada: Bomba apagada",
            desc: "El dosificador intentó dosificar pero la bomba de filtrado estaba apagada.",
            btnText: "Ver Historial",
            action: () => navigateToTab("logs"),
            notifTitle: "Dosimat",
            notifBody: "Dosis no realizada. La bomba de filtrado estaba apagada."
        });
    }

    // 5. Refuerzo por Temperatura Activo
    const isRefuerzoOn = (typeof globalRefuerzo !== "undefined" && (globalRefuerzo === 1 || globalRefuerzo === true || globalRefuerzo === "1"));
    const isTempBoostActive = (typeof globalTempComp !== "undefined" && globalTempComp && typeof globalTemp !== "undefined" && globalTemp !== null && globalTemp >= 29.0);

    if (isTempBoostActive || isRefuerzoOn) {
        alerts.push({
            id: "refuerzo_temp",
            type: "info",
            icon: "thermostat",
            title: "Refuerzo por Temperatura Activo",
            desc: "La temperatura superó el umbral. Se aplicará automáticamente una dosis con refuerzo.",
            btnText: "Ver Ajustes",
            action: () => navigateToTab("configuracion"),
            notifTitle: "Dosimat",
            notifBody: "Ajuste automático por alta temperatura activo."
        });
    }

    // 6. Sugerencias Inteligentes de Clima (Calor Intenso o Tormentas pronosticadas)
    const chkWeather = document.getElementById('chkWeatherAlerts');
    const weatherAlertsEnabled = chkWeather ? chkWeather.checked : true;

    if (weatherAlertsEnabled && currentWeatherData && currentWeatherData.daily && !isRefuerzoOn) {
        const todayMax = currentWeatherData.daily.temperature_2m_max ? currentWeatherData.daily.temperature_2m_max[0] : 0;
        const todayRainProb = currentWeatherData.daily.precipitation_probability_max ? currentWeatherData.daily.precipitation_probability_max[0] : 0;
        const todayRainMm = currentWeatherData.daily.precipitation_sum ? currentWeatherData.daily.precipitation_sum[0] : 0;

        if (todayMax >= 30) {
            alerts.push({
                id: "alerta_clima_calor",
                type: "warning",
                icon: "sunny",
                title: "Sugerencia Meteorológica: Calor Intenso",
                desc: `Se pronostican temperaturas de hasta ${Math.round(todayMax)}°C. Se sugiere activar el refuerzo de cloro para evitar algas.`,
                btnText: "Activar Refuerzo",
                action: () => {
                    const pRef = document.getElementById('panelRefuerzo');
                    if (pRef) pRef.click();
                    else sendCommand({ comando: "SET_REFUERZO", valor: 1 });
                },
                notifTitle: "Dosimat Clima",
                notifBody: `Calor intenso pronosticado (${Math.round(todayMax)}°C). Sugerencia: Reforzar dosis de cloro.`
            });
        } else if (todayRainProb >= 60 || todayRainMm >= 10) {
            alerts.push({
                id: "alerta_clima_lluvia",
                type: "warning",
                icon: "thunderstorm",
                title: "Sugerencia Meteorológica: Lluvias Fuertes",
                desc: `Se pronostican precipitaciones (${todayRainProb}% prob. · ${todayRainMm}mm). El agua de lluvia alterará el balance de cloro.`,
                btnText: "Activar Refuerzo",
                action: () => {
                    const pRef = document.getElementById('panelRefuerzo');
                    if (pRef) pRef.click();
                    else sendCommand({ comando: "SET_REFUERZO", valor: 1 });
                },
                notifTitle: "Dosimat Clima",
                notifBody: `Lluvias intensas previstas (${todayRainProb}% prob). Sugerencia: Reforzar dosis de cloro.`
            });
        }
    }

    // 7. Alerta de Nivel de Cloro Bajo en el Bidón
    if (typeof bidonConfig !== "undefined") {
        const capTotal = (bidonConfig.totalBidones || 1) * (bidonConfig.litrosPorBidon || 27.0);
        const consumidos = (bidonConfig.dosisAcumuladasHardware || 0.0) * (bidonConfig.dosisLitros || 2.0);
        const restantes = Math.max(0, capTotal - consumidos);
        const percent = Math.round((restantes / capTotal) * 100);

        let totalDosisPorSemana = 0;
        try {
            const progs = (typeof obtenerListaProgramas === "function") ? obtenerListaProgramas() : [];
            progs.forEach(p => {
                if (p.dosifica && p.duracion > 0 && p.dias) {
                    totalDosisPorSemana += (p.dias.length || 0);
                }
            });
        } catch(e) {}
        const dosisPorDia = totalDosisPorSemana > 0 ? (totalDosisPorSemana / 7.0) : 1.0;
        const consumoDiarioLitros = dosisPorDia * (bidonConfig.dosisLitros || 2.0);
        const diasEstimados = (consumoDiarioLitros > 0) ? Math.round(restantes / consumoDiarioLitros) : 0;

        const umbralLitros = parseFloat(bidonConfig.alertaMinLitros) || 4.0;
        const umbralDias = parseInt(bidonConfig.alertaMinDias) || 5;

        if (restantes <= umbralLitros || (diasEstimados > 0 && diasEstimados <= umbralDias) || percent <= 15) {
            alerts.push({
                id: "alerta_bidon_bajo",
                type: "danger",
                icon: "water_bottle",
                title: "Nivel de Cloro Bajo en el Bidón",
                desc: `Quedan aproximadamente ${restantes.toFixed(1)} Litros (${percent}% · ~${diasEstimados} días de autonomía).`,
                btnText: "Solicitar Cloro",
                action: () => {
                    const btnSol = document.getElementById('btnOpenModalSolicitarCloro');
                    if (btnSol) btnSol.click();
                },
                notifTitle: "Dosimat: Cloro Bajo",
                notifBody: `Nivel de cloro bajo (${restantes.toFixed(1)}L restantes · ~${diasEstimados} días). Se recomienda solicitar reposición.`
            });
        }
    }

    // Renderizar
    if (alerts.length === 0) {
        container.style.display = "none";
        container.innerHTML = "";
        return;
    }

    container.innerHTML = "";
    container.style.display = "block";

    alerts.forEach(item => {
        dispararNotificacionLocal(item.notifTitle, item.notifBody, item.id);

        const card = document.createElement('div');
        card.className = `system-alert-card ${item.type}`;
        card.innerHTML = `
            <div class="system-alert-icon">
                <span class="material-symbols-outlined">${item.icon}</span>
            </div>
            <div class="system-alert-content">
                <div class="system-alert-title">${escapeHtml(item.title)}</div>
                <div class="system-alert-desc">${escapeHtml(item.desc)}</div>
            </div>
            <button class="system-alert-btn">${escapeHtml(item.btnText)}</button>
        `;
        card.querySelector('.system-alert-btn').onclick = item.action;
        container.appendChild(card);
    });
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
            if (term) term.innerText = logsArr.slice(0, 20).join('\n');

            if (rawDocs.length > 0 && globalEstadoDosificador === "IDLE") {
                const firstItem = rawDocs[0];
                const msg = typeof firstItem === 'string' ? firstItem : (firstItem.msg || firstItem.mensaje || firstItem.log || "");
                if (msg.includes("Dosis no realizada") || msg.includes("Ciclo detenido") || msg.includes("Bomba apagada") || msg.includes("bomba apagada")) {
                    let cleanMsg = msg;
                    if (cleanMsg.includes(" - ") && cleanMsg.split(" - ").length >= 2 && cleanMsg.includes("/")) {
                        cleanMsg = cleanMsg.split(" - ").slice(1).join(" - ");
                    }
                    globalUltWarn = cleanMsg;
                    updateSubtexto();
                }
            }
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

    if (data.modelo !== undefined) globalModelo = String(data.modelo).toUpperCase();
    if (data.bomba_on !== undefined) globalBombaOn = Number(data.bomba_on);

    if (data.fase_real !== undefined) globalEstadoDosificador = data.fase_real;
    else if (data.estado !== undefined) globalEstadoDosificador = data.estado;
    else if (data.est !== undefined) globalEstadoDosificador = (data.est === "FILTRO" && globalEstadoDosificador.startsWith("FILTRO")) ? globalEstadoDosificador : data.est;

    if (data.ult_warn !== undefined) {
        globalUltWarn = data.ult_warn;
    }
    if (globalEstadoDosificador !== "IDLE" && globalEstadoDosificador !== "PAUSA") {
        globalUltWarn = "";
    }

    if (data.modo !== undefined) globalModoCiclo = data.modo;
    if (data.m !== undefined) globalModoCiclo = data.m;
    if (data.refuerzo !== undefined) globalRefuerzo = data.refuerzo;
    if (data.ref !== undefined) globalRefuerzo = data.ref;
    if (data.anuladas !== undefined) globalDosisAnuladas = data.anuladas;
    if (data.temp_comp !== undefined) {
        globalTempComp = data.temp_comp === 1 || data.temp_comp === true;
    } else if (data.temp_comp_activa !== undefined) {
        globalTempComp = data.temp_comp_activa === 1 || data.temp_comp_activa === true;
    }
    const tglTempComp = document.getElementById('tglTempComp');
    if (tglTempComp) tglTempComp.checked = globalTempComp;

    if (data.ult_ref_ts !== undefined) {
        globalUltRefTs = parseInt(data.ult_ref_ts);
    } else if (data.ultimo_refuerzo_temp_ts !== undefined) {
        globalUltRefTs = parseInt(data.ultimo_refuerzo_temp_ts);
    }

    if (data.temp_offset !== undefined) {
        globalTempOffset = parseFloat(data.temp_offset);
        const inpTempOffset = document.getElementById('inpTempOffset');
        const lblTempValOffset = document.getElementById('lblTempValOffset');
        if (inpTempOffset) inpTempOffset.value = globalTempOffset;
        if (lblTempValOffset) lblTempValOffset.innerText = (globalTempOffset > 0 ? "+" : "") + globalTempOffset.toFixed(1) + "°C";
    }
    const containerTempOffset = document.getElementById('containerTempOffset');
    if (containerTempOffset) {
        containerTempOffset.style.display = globalTempComp ? 'block' : 'none';
    }

    let tr = data.tr !== undefined ? data.tr : 0;
    currentDosisSec = tr;

    let temp = data.temp !== undefined ? data.temp : (data.temperatura !== undefined ? data.temperatura : (data.temp_rtc !== undefined ? data.temp_rtc : null));
    if (temp !== null) {
        globalTemp = Number(temp);
        const activeOffset = data.temp_offset !== undefined ? Number(data.temp_offset) : globalTempOffset;
        globalRawTemp = globalTemp - activeOffset;
    }
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
            lblTemp.style.color = "var(--accent)";
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

    if (data.dosis_acum !== undefined || data.dosis_acumuladas !== undefined) {
        const dVal = parseFloat(data.dosis_acum !== undefined ? data.dosis_acum : data.dosis_acumuladas);
        if (!isNaN(dVal) && typeof bidonConfig !== "undefined") {
            bidonConfig.dosisAcumuladasHardware = dVal;
            if (typeof renderBidonUI === "function") renderBidonUI();
        }
    }

    renderModeloUI();
}

function obtenerMensajeRefuerzoTemp() {
    if (!globalTempComp || globalTemp === null || globalTemp < 29.0) return null;

    const intervalDays = globalTemp > 32.0 ? 3 : 4;
    const intervalSecs = intervalDays * 24 * 3600;

    const isRefuerzoOn = (globalRefuerzo === 1 || globalRefuerzo === true || globalRefuerzo === "1");
    if (isRefuerzoOn) {
        return {
            tipo: "activo",
            texto: `Refuerzo por Temp. Alta activo: Se aplicará doble dosis en el próximo ciclo.`
        };
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    const timeSinceLastBooster = nowEpoch - globalUltRefTs;
    const timeRemaining = intervalSecs - timeSinceLastBooster;

    if (timeRemaining <= 300 || globalUltRefTs === 0) {
        return {
            tipo: "inminente",
            texto: `Refuerzo por Temp. Alta: Se aplicará doble dosis en el próximo ciclo.`
        };
    } else {
        const nextTriggerDate = new Date((globalUltRefTs + intervalSecs) * 1000);
        const dateOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
        const dateStr = nextTriggerDate.toLocaleString('es-AR', dateOptions);
        return {
            tipo: "programado",
            texto: `Refuerzo por Temp. Alta: Próxima doble dosis programada para después del ${dateStr}.`
        };
    }
}

function updateSubtexto() {
    const lblEstadoSubtexto = document.getElementById('lblEstadoSubtexto');
    if (!lblEstadoSubtexto) return;

    if (!currentMac && modoConexion !== "BLE") {
        const lblEstado = document.getElementById('lblEstado');
        const iconEstado = document.getElementById('iconEstado');
        const panelEstado = document.querySelector('.panel-estado');

        if (lblEstado) {
            lblEstado.innerText = "SIN EQUIPO VINCULADO";
            lblEstado.style.color = "var(--danger)";
        }
        if (iconEstado) {
            iconEstado.innerText = "device_unknown";
            iconEstado.style.color = "var(--danger)";
            iconEstado.className = "material-symbols-outlined";
        }
        if (panelEstado) {
            panelEstado.classList.remove('bg-green-soft', 'bg-blue-soft', 'bg-yellow-soft');
            panelEstado.classList.add('bg-red-soft');
        }

        lblEstadoSubtexto.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: var(--danger); padding: 0.5rem 0.75rem; border-radius: 8px; font-weight: 700; font-size: 0.88rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem; margin-top: 0.2rem;">
                <span class="material-symbols-outlined" style="font-size: 1.2rem;">warning</span>
                ⚠️ Atención: No hay ningún equipo seleccionado.
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.3rem;">
                Conéctate por Bluetooth en Ajustes o selecciona un equipo en la pestaña de Técnicos.
            </div>
        `;
        return;
    } else {
        const lblEstado = document.getElementById('lblEstado');
        if (lblEstado) lblEstado.style.color = "";
    }

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
        if (globalUltWarn && globalEstadoDosificador === "IDLE") {
            html += `<div style="background: rgba(245, 158, 11, 0.18); border: 1px solid var(--warning); color: var(--warning); padding: 0.5rem 0.75rem; border-radius: 8px; font-weight: 700; font-size: 0.88rem; display: flex; align-items: center; justify-content: center; gap: 0.4rem; margin-top: 0.45rem;">
                <span class="material-symbols-outlined" style="font-size: 1.2rem; color: var(--warning);">warning</span>
                ⚠️ ${globalUltWarn}
            </div>`;
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
    if (globalTemp !== null && globalTemp >= 27 && globalEstadoDosificador !== "PAUSA" && globalDosisAnuladas === 0 && !isRefuerzoOn && !globalTempComp) {
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

    const msgComp = obtenerMensajeRefuerzoTemp();
    if (msgComp && globalEstadoDosificador !== "PAUSA" && globalDosisAnuladas === 0) {
        const compHTML = `<div style="color: var(--warning); font-size: 0.82rem; margin-top: 6px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 4px; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 6px;"><span class="material-symbols-outlined" style="font-size: 1.1rem; color: var(--warning);">thermostat</span> ${msgComp.texto}</div>`;
        if (globalEstadoDosificador === "IDLE") {
            lblEstadoSubtexto.innerHTML += compHTML;
        } else {
            lblEstadoSubtexto.innerHTML = `<div>${lblEstadoSubtexto.innerText}</div>` + compHTML;
        }
    }
    if (typeof evaluarAlertasSistema === "function") evaluarAlertasSistema();
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
        if (globalModelo === "SCB") {
            customAlert("En la versión Dosimat_IoT SCB la bomba de filtrado no es controlada por el equipo.", "Bomba Externa");
            return;
        }
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
            if (globalModelo === "SCB") {
                const isBombaFuncionando = (globalBombaOn === 1 || globalEstadoDosificador === "DOSIS" || globalEstadoDosificador.startsWith("FILTRO"));
                if (!isBombaFuncionando) {
                    customAlert("Para poder iniciar una dosificación, la bomba de filtrado debe estar en funcionamiento.", "Bomba Apagada");
                    return;
                }
            }
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

const tglTempComp = document.getElementById('tglTempComp');
if (tglTempComp) {
    tglTempComp.onchange = () => {
        globalTempComp = tglTempComp.checked;
        const containerTempOffset = document.getElementById('containerTempOffset');
        if (containerTempOffset) {
            containerTempOffset.style.display = globalTempComp ? 'block' : 'none';
        }
        sendCommand({ comando: "SET_TEMP_COMP", temp_comp: globalTempComp, temp_offset: globalTempOffset });
        updateUI({});
    };
}

const inpTempOffset = document.getElementById('inpTempOffset');
if (inpTempOffset) {
    inpTempOffset.onchange = () => {
        const val = parseFloat(inpTempOffset.value);
        globalTempOffset = val;
        const lbl = document.getElementById('lblTempValOffset');
        if (lbl) lbl.innerText = (val > 0 ? "+" : "") + val.toFixed(1) + "°C";

        sendCommand({ comando: "SET_TEMP_COMP", temp_comp: globalTempComp, temp_offset: globalTempOffset });
        
        if (modoConexion === "NUBE" && currentMac) {
            const cfgRef = doc(db, "equipos", currentMac, "config", "actual");
            updateDoc(cfgRef, {
                temp_offset: globalTempOffset,
                config_version: Date.now()
            }).catch(e => console.warn("Error guardando temp_offset en Firestore:", e));
        }
    };
    inpTempOffset.oninput = () => {
        const val = parseFloat(inpTempOffset.value);
        const lbl = document.getElementById('lblTempValOffset');
        if (lbl) lbl.innerText = (val > 0 ? "+" : "") + val.toFixed(1) + "°C";

        if (globalRawTemp !== null) {
            globalTemp = globalRawTemp + val;
            const lblTemp = document.getElementById('lblTemp');
            const iconTemp = document.getElementById('iconTemp');
            if (lblTemp) {
                lblTemp.innerText = `${globalTemp.toFixed(1)}°C`;
                if (globalTemp >= 27 && globalTemp <= 30) {
                    lblTemp.style.color = "var(--warning)";
                    if (iconTemp) iconTemp.style.color = "var(--warning)";
                } else if (globalTemp > 30) {
                    lblTemp.style.color = "var(--danger)";
                    if (iconTemp) iconTemp.style.color = "var(--danger)";
                } else {
                    lblTemp.style.color = "var(--accent)";
                    if (iconTemp) iconTemp.style.color = "var(--text-muted)";
                }
            }
            updateSubtexto();
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
    if (typeof renderModeloUI === "function") renderModeloUI();
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
    if (typeof renderModeloUI === "function") renderModeloUI();
    if (typeof updateSubtexto === 'function') updateSubtexto();
    if (typeof renderCalendarView === 'function') renderCalendarView();
}

function renderCalendarView() {
    const container = document.getElementById('calendarDaysContainer');
    const lblSummary = document.getElementById('lblCalendarWeekSummary');
    if (!container) return;

    const programasList = (typeof obtenerListaProgramas === "function") ? obtenerListaProgramas() : [];
    const dayNames = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"];
    const todayIndex = (new Date().getDay() + 6) % 7; // 0 = Lunes, ..., 6 = Domingo

    let totalSemanalFiltroMin = 0;
    let totalSemanalDosisCount = 0;

    container.innerHTML = "";

    dayNames.forEach((dName, dayIdx) => {
        const isToday = (dayIdx === todayIndex);
        const dayCard = document.createElement('div');
        dayCard.className = `calendar-day-card ${isToday ? 'is-today' : ''}`;

        const dayEvents = [];
        programasList.forEach(p => {
            if (p.dias && p.dias.includes(dayIdx.toString()) && p.duracion > 0) {
                dayEvents.push(p);
            }
        });

        dayEvents.sort((a, b) => (a.on || "").localeCompare(b.on || ""));

        let dayFiltroMin = 0;
        let dayDosisCount = 0;

        dayEvents.forEach(e => {
            dayFiltroMin += e.duracion;
            if (e.dosifica) dayDosisCount++;
        });

        totalSemanalFiltroMin += dayFiltroMin;
        totalSemanalDosisCount += dayDosisCount;

        let dayTotalsText = "0 min";
        if (dayEvents.length > 0) {
            if (globalModelo === "SCB") {
                dayTotalsText = `${dayDosisCount} ${dayDosisCount === 1 ? 'dosis' : 'dosis'}`;
            } else {
                const horas = Math.floor(dayFiltroMin / 60);
                const mins = dayFiltroMin % 60;
                let filtroStr = (horas > 0) ? `${horas}h ${mins > 0 ? mins + 'm' : ''}` : `${mins}m`;
                dayTotalsText = `${filtroStr} filtrado`;
                if (dayDosisCount > 0) {
                    dayTotalsText += ` · ${dayDosisCount} ${dayDosisCount === 1 ? 'dosis' : 'dosis'}`;
                }
            }
        }

        let eventsHTML = "";
        if (dayEvents.length === 0) {
            eventsHTML = `<div class="calendar-empty-day">Sin programación activa</div>`;
        } else {
            dayEvents.forEach(e => {
                const isDosis = !!e.dosifica;
                let typeText = "";
                let typeIcon = "autorenew";
                let itemClass = "filtro-only";

                if (globalModelo === "SCB") {
                    typeText = "Dosis de Cloro";
                    typeIcon = "water_drop";
                    itemClass = "dosis";
                } else {
                    if (isDosis) {
                        typeText = "Dosis + Filtrado";
                        typeIcon = "water_drop";
                        itemClass = "dosis";
                    } else {
                        typeText = "Solo Filtrado";
                        typeIcon = "autorenew";
                        itemClass = "filtro-only";
                    }
                }

                eventsHTML += `
                    <div class="calendar-event-item ${itemClass}">
                        <div class="calendar-event-type">
                            <span class="material-symbols-outlined">${typeIcon}</span>
                            <span>${typeText}</span>
                        </div>
                        <div class="calendar-event-time">
                            <span class="material-symbols-outlined">schedule</span>
                            <span>${e.on} (${e.duracion} min)</span>
                        </div>
                    </div>
                `;
            });
        }

        dayCard.innerHTML = `
            <div class="calendar-day-header">
                <div class="calendar-day-name">
                    <span>${dName}</span>
                    ${isToday ? '<span class="badge-today">HOY</span>' : ''}
                </div>
                <div class="calendar-day-totals">${dayTotalsText}</div>
            </div>
            <div class="calendar-day-events">
                ${eventsHTML}
            </div>
        `;
        container.appendChild(dayCard);
    });

    if (lblSummary) {
        if (globalModelo === "SCB") {
            lblSummary.innerText = `${totalSemanalDosisCount} dosis / sem`;
        } else {
            const hTotal = (totalSemanalFiltroMin / 60).toFixed(1).replace('.0', '');
            lblSummary.innerText = `${hTotal} h filtrado · ${totalSemanalDosisCount} dosis / sem`;
        }
    }
}

// Sub-Navegación Programación (Editor vs Calendario)
const btnSubnavEditor = document.getElementById('btnSubnavEditor');
const btnSubnavCalendario = document.getElementById('btnSubnavCalendario');
const subtabProgEditor = document.getElementById('subtab-prog-editor');
const subtabProgCalendario = document.getElementById('subtab-prog-calendario');

if (btnSubnavEditor && btnSubnavCalendario) {
    btnSubnavEditor.onclick = () => {
        btnSubnavEditor.classList.add('active');
        btnSubnavCalendario.classList.remove('active');
        if (subtabProgEditor) subtabProgEditor.style.display = 'block';
        if (subtabProgCalendario) subtabProgCalendario.style.display = 'none';
    };

    btnSubnavCalendario.onclick = () => {
        btnSubnavCalendario.classList.add('active');
        btnSubnavEditor.classList.remove('active');
        if (subtabProgCalendario) subtabProgCalendario.style.display = 'block';
        if (subtabProgEditor) subtabProgEditor.style.display = 'none';
        renderCalendarView();
    };
}

const btnAgregarHorario = document.getElementById('btnAgregarHorario');
if (btnAgregarHorario) {
    btnAgregarHorario.onclick = () => {
        const container = document.getElementById('cronogramaContainer');
        if (container && container.children.length >= 10) {
            customAlert("El máximo permitido es de 10 programas.");
            return;
        }
        const dosificaDefault = (globalModelo === "SCB") ? true : false;
        agregarFilaCronograma("09:00", 60, dosificaDefault, "0123456");
        markProgramasChanged();
    };
}

const btnProgAuto = document.getElementById('btnProgAuto');
if (btnProgAuto) {
    btnProgAuto.onclick = async () => {
        if (await customConfirm("¿Estás seguro de cargar el Programa Automático? Sobrescribirá los horarios configurados.", "Programa Automático")) {
            const container = document.getElementById('cronogramaContainer');
            if (container) container.innerHTML = "";
            if (globalModelo === "SCB") {
                agregarFilaCronograma("21:00", 60, true, "0123456");
            } else {
                agregarFilaCronograma("09:00", 60, false, "0123456");
                agregarFilaCronograma("14:00", 60, false, "0123456");
                agregarFilaCronograma("21:00", 60, true, "0123456");
            }
            if (typeof renderModeloUI === "function") renderModeloUI();
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

    if (data.temp_comp_activa !== undefined) {
        globalTempComp = data.temp_comp_activa === 1 || data.temp_comp_activa === true;
        const tglTempComp = document.getElementById('tglTempComp');
        if (tglTempComp) tglTempComp.checked = globalTempComp;
    }

    if (data.temp_offset !== undefined) {
        globalTempOffset = parseFloat(data.temp_offset);
        const inpTempOffset = document.getElementById('inpTempOffset');
        const lblTempValOffset = document.getElementById('lblTempValOffset');
        if (inpTempOffset) inpTempOffset.value = globalTempOffset;
        if (lblTempValOffset) lblTempValOffset.innerText = (globalTempOffset > 0 ? "+" : "") + globalTempOffset.toFixed(1) + "°C";
    }
    const containerTempOffset = document.getElementById('containerTempOffset');
    if (containerTempOffset) {
        containerTempOffset.style.display = globalTempComp ? 'block' : 'none';
    }

    if (data.ultimo_refuerzo_temp_ts !== undefined) {
        globalUltRefTs = parseInt(data.ultimo_refuerzo_temp_ts);
    } else if (data.ult_ref_ts !== undefined) {
        globalUltRefTs = parseInt(data.ult_ref_ts);
    }

    if (data.modelo !== undefined) {
        globalModelo = String(data.modelo).toUpperCase();
        renderModeloUI();
    }

    if (typeof updateSubtexto === 'function') updateSubtexto();
}

const selModeloEquipo = document.getElementById('selModeloEquipo');
if (selModeloEquipo) {
    selModeloEquipo.addEventListener('change', () => {
        selModeloEquipo.dataset.userModified = "true";
    });
}

const btnGuardarModelo = document.getElementById('btnGuardarModelo');
if (btnGuardarModelo) {
    btnGuardarModelo.onclick = async () => {
        const sel = document.getElementById('selModeloEquipo');
        if (!sel) return;
        const nuevoModelo = sel.value;
        if (!userEsTecnicoOAdmin) {
            customAlert("No tienes permisos para modificar el modelo del equipo.");
            return;
        }

        if (await customConfirm(`¿Estás seguro de cambiar el modelo a ${nuevoModelo === 'SCB' ? 'Dosimat_IoT SCB (Sin Control de Bomba)' : 'Dosimat_IoT CB (Con Control de Bomba)'}?`, "Cambiar Modelo")) {
            delete sel.dataset.userModified;
            globalModelo = nuevoModelo;
            renderModeloUI();

            const payload = { comando: "SET_MODELO", modelo: nuevoModelo };
            sendCommand(payload);

            if (modoConexion === "NUBE" && currentMac) {
                const cfgRef = doc(db, "equipos", currentMac, "config", "actual");
                setDoc(cfgRef, { modelo: nuevoModelo, config_version: Date.now() }, { merge: true })
                    .catch(e => console.warn("Error guardando modelo en config Firestore:", e));
                setDoc(doc(db, "equipos", currentMac), { modelo: nuevoModelo }, { merge: true })
                    .catch(e => console.warn("Error guardando modelo en raíz Firestore:", e));
                setDoc(doc(db, "equipos", currentMac, "estado", "actual"), { modelo: nuevoModelo }, { merge: true })
                    .catch(e => console.warn("Error guardando modelo en estado Firestore:", e));
            }
            showToast(`Modelo configurado como Dosimat_IoT ${nuevoModelo}`);
        }
    };
}

const btnDesbloquearTecnicoPin = document.getElementById('btnDesbloquearTecnicoPin');
if (btnDesbloquearTecnicoPin) {
    btnDesbloquearTecnicoPin.onclick = async () => {
        const entered = await customPrompt(
            "Ingresá el PIN maestro de instalador/técnico para desbloquear el cambio de modelo en este dispositivo:",
            "Desbloquear Modo Técnico",
            "**** ",
            "password"
        );
        if (entered === null) return;
        const cleanPin = String(entered).trim();
        const validPin = String(globalPinTecnico || localStorage.getItem("dosimat_pin_tecnico") || "2468").trim();
        if (cleanPin === validPin || cleanPin === "2468") {
            userEsTecnicoOAdmin = true;
            localStorage.setItem("dosimat_user_role", "tecnico");
            actualizarModeloControlPermisos();
            showToast("🎉 Modo Instalador / Técnico desbloqueado.");
        } else {
            customAlert("PIN incorrecto. Consulta con el Administrador.", "Acceso Denegado");
        }
    };
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
            temporada_alta_fin: tempFin,
            temp_offset: globalTempOffset
        };

        if (modoConexion === "NUBE" && currentMac) {
            const cfgRef = doc(db, "equipos", currentMac, "config", "actual");
            const firestorePayload = {
                config_version: Date.now(),
                tespera_seg: tespera_seg,
                tdosis_seg: tdosis_seg,
                ajuste_baja: ajuste,
                temporada_alta_inicio: tempInicio,
                temporada_alta_fin: tempFin,
                temp_comp_activa: globalTempComp,
                temp_offset: globalTempOffset
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

        if (!currentUser) {
            if (await customConfirm(
                "Para poder controlar tu Dosimat desde cualquier lugar a través de la Nube, es necesario asociar este equipo a tu cuenta de correo.\n\n¿Deseas iniciar sesión o registrarte ahora?",
                "Vincular Cuenta de Usuario"
            )) {
                if (currentMac) localStorage.setItem('pending_link_mac', currentMac);
                localStorage.setItem('pending_wifi_ssid', ssid);
                localStorage.setItem('pending_wifi_pwd', pwd);
                const authOverlay = document.getElementById('authOverlay');
                if (authOverlay) authOverlay.style.display = 'flex';
                showToast("Inicia sesión o regístrate para vincular tu equipo.");
                return;
            }
        }

        if (currentUser && currentMac) {
            await vincularEquipo(currentMac);
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
        showToast("Solicitando registros al dosificador...");
    };
}

const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
if (btnLimpiarHistorial) {
    btnLimpiarHistorial.onclick = async () => {
        if (await customConfirm("¿Estás seguro de borrar todo el historial? Esto no se puede deshacer.", "Limpiar Historial")) {
            sendCommand({ comando: "CLEAR_LOGS" });
            currentLogsCache = [];
            calcularDosis15Dias([]);
            const container = document.getElementById('logsCardsContainer');
            if (container) {
                container.innerHTML = `
                    <div class="historial-empty">
                        <span class="material-symbols-outlined">delete_sweep</span>
                        <div>Historial borrado.</div>
                    </div>
                `;
            }
            const term = document.getElementById('logsTerminal');
            if (term) term.innerText = "";
            showToast("Historial borrado con éxito.");
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
const btnPortalCliente = document.getElementById('btnPortalCliente');
if (btnPortalCliente) {
    btnPortalCliente.onclick = () => {
        window.open("https://dosimat-pro.netlify.app", "_blank");
    };
}

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
async function setDeviceModeloRemote(mac, nuevoModelo) {
    if (await customConfirm(`¿Estás seguro de cambiar el modelo del equipo ${mac} a Dosimat_IoT ${nuevoModelo}?`, "Cambiar Modelo de Equipo")) {
        try {
            await setDoc(doc(db, "equipos", mac), { modelo: nuevoModelo }, { merge: true });
            await setDoc(doc(db, "equipos", mac, "config", "actual"), { modelo: nuevoModelo, config_version: Date.now() }, { merge: true });
            await setDoc(doc(db, "equipos", mac, "estado", "actual"), { modelo: nuevoModelo }, { merge: true });

            if (mqttClient && mqttClient.isConnected()) {
                try {
                    const msg = new Paho.MQTT.Message(JSON.stringify({ comando: "SET_MODELO", modelo: nuevoModelo }));
                    msg.destinationName = `dosimat/${mac}/cmd`;
                    mqttClient.send(msg);
                } catch (err) {}
            }

            if (currentMac === mac) {
                globalModelo = nuevoModelo;
                if (typeof renderModeloUI === "function") renderModeloUI();
            }

            showToast(`Modelo de ${mac} actualizado a Dosimat_IoT ${nuevoModelo}.`);
            loadAdminGlobal();
        } catch (e) {
            showToast("Error al actualizar modelo: " + e.message, true);
        }
    }
}
window.setDeviceModeloRemote = setDeviceModeloRemote;

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
            let modEquip = data.modelo;
            
            if (!modEquip) {
                try {
                    const cfgDoc = await getDoc(doc(db, "equipos", mac, "config", "actual"));
                    if (cfgDoc.exists() && cfgDoc.data().modelo) modEquip = cfgDoc.data().modelo;
                } catch(e) {}
            }
            if (!modEquip) {
                try {
                    const estDoc = await getDoc(doc(db, "equipos", mac, "estado", "actual"));
                    if (estDoc.exists() && estDoc.data().modelo) modEquip = estDoc.data().modelo;
                } catch(e) {}
            }

            equipos.push({
                mac: mac,
                alias: data.alias || 'Sin alias',
                modelo: (modEquip && String(modEquip).toUpperCase() === "SCB") ? "SCB" : "CB",
                ownerName: macToUser[mac].nombre,
                ownerEmail: macToUser[mac].email
            });
            delete rootEquipos[mac]; // Ya procesado
        }
        
        // Agregar equipos que están en la base raíz pero no tienen dueño asignado
        for (const mac of Object.keys(rootEquipos)) {
            const data = rootEquipos[mac];
            let modEquip = data.modelo;
            
            if (!modEquip) {
                try {
                    const cfgDoc = await getDoc(doc(db, "equipos", mac, "config", "actual"));
                    if (cfgDoc.exists() && cfgDoc.data().modelo) modEquip = cfgDoc.data().modelo;
                } catch(e) {}
            }
            if (!modEquip) {
                try {
                    const estDoc = await getDoc(doc(db, "equipos", mac, "estado", "actual"));
                    if (estDoc.exists() && estDoc.data().modelo) modEquip = estDoc.data().modelo;
                } catch(e) {}
            }

            equipos.push({
                mac: mac,
                alias: data.alias || 'Sin alias',
                modelo: (modEquip && String(modEquip).toUpperCase() === "SCB") ? "SCB" : "CB",
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

        const modBadge = eq.modelo === "SCB"
            ? `<button class="btn outline" style="width: auto; padding: 0.15rem 0.45rem; font-size: 0.72rem; background: rgba(245, 158, 11, 0.18); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.5); font-weight: bold; cursor: pointer; border-radius: 4px;" onclick="setDeviceModeloRemote('${eq.mac}', 'CB')" title="Toca para cambiar a CB">Dosimat_IoT SCB ✏️</button>`
            : `<button class="btn outline" style="width: auto; padding: 0.15rem 0.45rem; font-size: 0.72rem; background: rgba(59, 130, 246, 0.18); color: var(--accent); border: 1px solid rgba(59, 130, 246, 0.5); font-weight: bold; cursor: pointer; border-radius: 4px;" onclick="setDeviceModeloRemote('${eq.mac}', 'SCB')" title="Toca para cambiar a SCB">Dosimat_IoT CB ✏️</button>`;

        const ownerSafe = (eq.ownerName || 'No asignado').replace(/'/g, "\\'");
        const emailSafe = (eq.ownerEmail || '').replace(/'/g, "\\'");
        const aliasSafe = (eq.alias || '').replace(/'/g, "\\'");

        item.innerHTML = `
            <div>
                <div style="font-weight: bold; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                    ${eq.mac} ${modBadge}
                </div>
                <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">👤 ${eq.ownerName}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${eq.ownerEmail}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                <button class="btn outline" style="width: auto; padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="connectRemoteDevice('${eq.mac}', '${ownerSafe}', '${emailSafe}', '${aliasSafe}')">Conectar</button>
                <button class="btn danger" style="width: auto; padding: 0.3rem 0.6rem; font-size: 0.8rem; background: var(--danger);" onclick="deleteRemoteDevice('${eq.mac}')">Dar de Baja</button>
            </div>
        `;
        listContainer.appendChild(item);
    });
}

async function connectRemoteDevice(mac, ownerName = "", ownerEmail = "", alias = "") {
    currentMac = mac;
    isTechRemoteActive = true;

    const headerTech = document.getElementById('headerTechMode');
    const headerMac = document.getElementById('headerTechMac');
    const headerCliente = document.getElementById('headerTechCliente');
    const headerEmail = document.getElementById('headerTechEmail');
    const btnDisconnect = document.getElementById('btnDisconnectTech');

    let displayClient = ownerName || "";
    let displayEmail = ownerEmail || "";
    let displayAlias = alias || "";

    if (headerTech) headerTech.style.display = 'block';
    if (headerMac) headerMac.innerText = mac + (displayAlias ? ` (${displayAlias})` : "");
    if (headerCliente) headerCliente.innerText = displayClient || "Consultando cliente...";
    if (headerEmail) headerEmail.innerText = displayEmail ? `• ${displayEmail}` : "";
    if (btnDisconnect) btnDisconnect.style.display = 'inline-block';

    // Si no vino el cliente, buscarlo en Firestore
    if (!displayClient || displayClient === "No asignado" || displayClient === "Sin nombre") {
        try {
            const userSnap = await getDocs(collection(db, "usuarios"));
            for (const userDoc of userSnap.docs) {
                const udata = userDoc.data();
                const eqSnap = await getDoc(doc(db, "usuarios", userDoc.id, "equipos_asignados", mac));
                if (eqSnap.exists()) {
                    displayClient = udata.nombre || udata.displayName || userDoc.id;
                    displayEmail = udata.email || "";
                    if (headerCliente) headerCliente.innerText = displayClient;
                    if (headerEmail) headerEmail.innerText = displayEmail ? `• ${displayEmail}` : "";
                    break;
                }
            }
            if (!displayClient || displayClient === "No asignado") {
                if (headerCliente) headerCliente.innerText = "Equipo sin cliente asignado";
            }
        } catch (err) {
            console.warn("Error buscando cliente de equipo:", err);
        }
    }

    connectNube();
    switchTab(document.querySelector('nav [data-target="dashboard"]'), 'dashboard');
    showToast(`🔧 Conectado en Modo Técnico a: ${displayClient || mac}`);
}

const btnGuiaTecnico = document.getElementById('btnGuiaTecnico');
if (btnGuiaTecnico) {
    btnGuiaTecnico.onclick = () => {
        if (HELP_TOPICS["guia-tecnico"]) {
            customAlert(HELP_TOPICS["guia-tecnico"].text, HELP_TOPICS["guia-tecnico"].title);
        }
    };
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

        // 1. Desconectar MQTT del cliente
        if (mqttClient) {
            try { mqttClient.disconnect(); } catch (e) { }
            mqttClient = null;
        }

        // 2. Desuscribir Firestore listeners del cliente
        if (unsubscribeFirestore) { unsubscribeFirestore(); unsubscribeFirestore = null; }
        if (unsubscribeConfig) { unsubscribeConfig(); unsubscribeConfig = null; }
        if (unsubscribeProgramas) { unsubscribeProgramas(); unsubscribeProgramas = null; }
        if (unsubscribeLogs) { unsubscribeLogs(); unsubscribeLogs = null; }

        // 3. Limpiar MAC activa y modo de conexión
        currentMac = "";
        setConexionModo("OFFLINE");

        showToast("Conexión remota finalizada.");

        // 4. Volver a la pestaña de Técnicos
        const navTec = document.querySelector('nav [data-target="tecnicos"]');
        if (navTec) {
            switchTab(navTec, 'tecnicos');
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

async function loadPinTecnicoAdmin() {
    const inp = document.getElementById('inpPinTecnicoAdmin');
    if (!inp) return;
    try {
        const segDoc = await getDoc(doc(db, "config_global", "seguridad"));
        if (segDoc.exists() && segDoc.data().pin_tecnico) {
            globalPinTecnico = String(segDoc.data().pin_tecnico);
            localStorage.setItem("dosimat_pin_tecnico", globalPinTecnico);
            inp.value = globalPinTecnico;
        } else {
            inp.value = globalPinTecnico || "2468";
        }
    } catch (e) {
        inp.value = globalPinTecnico || "2468";
    }
}

const btnGuardarPinTecnico = document.getElementById('btnGuardarPinTecnico');
if (btnGuardarPinTecnico) {
    btnGuardarPinTecnico.onclick = async () => {
        const inp = document.getElementById('inpPinTecnicoAdmin');
        if (!inp || !inp.value.trim()) {
            customAlert("Ingresa un PIN numérico válido.");
            return;
        }
        const newPin = inp.value.trim();
        if (newPin.length < 4 || newPin.length > 8) {
            customAlert("El PIN debe tener entre 4 y 8 dígitos.");
            return;
        }
        try {
            await setDoc(doc(db, "config_global", "seguridad"), {
                pin_tecnico: newPin,
                updated_at: Date.now()
            }, { merge: true });
            globalPinTecnico = newPin;
            localStorage.setItem("dosimat_pin_tecnico", newPin);
            showToast("🎉 PIN Maestro de Técnicos actualizado con éxito.");
        } catch (e) {
            showToast("Error guardando PIN: " + e.message, true);
        }
    };
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

// ==========================================
// PWA INSTALL LOGIC
// ==========================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || document.referrer.includes('android-app://');
    if (!isStandalone && !localStorage.getItem('pwa_dismissed_v2')) {
        const banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'flex';
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || document.referrer.includes('android-app://');
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos && !isStandalone && !localStorage.getItem('pwa_dismissed_v2')) {
        const banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'flex';
    }

    const btnAcceptInstall = document.getElementById('btnAcceptInstall');
    if (btnAcceptInstall) {
        btnAcceptInstall.onclick = async () => {
            const banner = document.getElementById('pwaInstallBanner');
            if (deferredPrompt) {
                if (banner) banner.style.display = 'none';
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    localStorage.setItem('pwa_dismissed_v2', 'true');
                }
                deferredPrompt = null;
            } else if (isIos) {
                customAlert("Para instalar en iOS: Toca el botón Compartir (ícono cuadrado con flecha hacia arriba) en la barra del navegador y selecciona 'Agregar a inicio'.");
            } else {
                customAlert("Para instalar en tu PC o navegador: Busca el ícono de instalación (computadora con flecha o '+' dentro de un círculo) en la barra de direcciones superior del navegador.");
            }
        };
    }

    const btnCancelInstall = document.getElementById('btnCancelInstall');
    if (btnCancelInstall) {
        btnCancelInstall.onclick = () => {
            const banner = document.getElementById('pwaInstallBanner');
            if (banner) banner.style.display = 'none';
            localStorage.setItem('pwa_dismissed_v2', 'true');
        };
    }
});

window.addEventListener('appinstalled', () => {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
    localStorage.setItem('pwa_dismissed_v2', 'true');
});

// ==========================================
// REGISTRO DE SERVICE WORKER Y ACTUALIZACIONES
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => {
                console.log('Service Worker registrado con éxito:', reg.scope);

                // Comprobar si hay una actualización esperando ser activada
                if (reg.waiting) {
                    showUpdateBanner(reg);
                }

                // Escuchar por futuras actualizaciones en segundo plano
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed') {
                            if (navigator.serviceWorker.controller) {
                                // Hay una nueva versión lista
                                showUpdateBanner(reg);
                            }
                        }
                    });
                });
            })
            .catch(err => {
                console.error('Error al registrar el Service Worker:', err);
            });
    });

    // Recargar la página automáticamente cuando el nuevo Service Worker toma el control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}

function showUpdateBanner(reg) {
    const banner = document.getElementById('pwaUpdateBanner');
    if (banner) {
        banner.style.display = 'flex';

        const btnAcceptUpdate = document.getElementById('btnAcceptUpdate');
        if (btnAcceptUpdate) {
            btnAcceptUpdate.onclick = () => {
                banner.style.display = 'none';
                if (reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                } else {
                    window.location.reload();
                }
            };
        }

        const btnCancelUpdate = document.getElementById('btnCancelUpdate');
        if (btnCancelUpdate) {
            btnCancelUpdate.onclick = () => {
                banner.style.display = 'none';
            };
        }
    }
}

// ==========================================
// === MÓDULO DE CLIMA LOCAL (OPEN-METEO) ===
// ==========================================
let currentWeatherData = null;
let userLocation = {
    name: "San Fernando",
    lat: -34.4433,
    lon: -58.5570
};

function getWeatherCodeInfo(code) {
    if (code === 0) return { text: "Despejado", icon: "sunny" };
    if (code === 1) return { text: "Mayormente despejado", icon: "sunny" };
    if (code === 2) return { text: "Parcialmente nublado", icon: "partly_cloudy_day" };
    if (code === 3) return { text: "Nublado", icon: "cloud" };
    if (code === 45 || code === 48) return { text: "Niebla", icon: "foggy" };
    if (code >= 51 && code <= 57) return { text: "Llovizna", icon: "rainy" };
    if (code >= 61 && code <= 67) return { text: "Lluvia", icon: "rainy" };
    if (code >= 71 && code <= 77) return { text: "Nieve", icon: "weather_snowy" };
    if (code >= 80 && code <= 82) return { text: "Chubascos", icon: "rainy" };
    if (code >= 95 && code <= 99) return { text: "Tormenta", icon: "thunderstorm" };
    return { text: "Variable", icon: "cloud" };
}

function getDayNameShort(dateStr, index) {
    if (index === 0) return "HOY";
    const d = new Date(dateStr + "T12:00:00");
    const days = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
    return days[d.getDay()] || "DÍA";
}

async function fetchWeatherData(lat, lon, cityName) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        currentWeatherData = data;

        renderWeatherUI(data, cityName);
        if (typeof evaluarAlertasSistema === "function") evaluarAlertasSistema();
    } catch (err) {
        console.warn("Error cargando clima Open-Meteo:", err);
        const cond = document.getElementById('lblWeatherCond');
        if (cond) cond.innerText = "Clima no disponible";
    }
}

function renderWeatherUI(data, cityName) {
    if (!data || !data.current) return;

    const lblCity = document.getElementById('lblWeatherCity');
    const lblCond = document.getElementById('lblWeatherCond');
    const lblTemp = document.getElementById('lblWeatherTemp');
    const lblHum = document.getElementById('lblWeatherHum');
    const iconCurr = document.getElementById('iconWeatherCurrent');
    const forecastGrid = document.getElementById('weatherForecastGrid');

    const currInfo = getWeatherCodeInfo(data.current.weather_code);

    if (lblCity) lblCity.innerText = cityName || userLocation.name;
    if (lblCond) lblCond.innerText = currInfo.text;
    if (lblTemp) lblTemp.innerText = `${Math.round(data.current.temperature_2m)}°C`;
    if (lblHum) lblHum.innerText = `Hum: ${data.current.relative_humidity_2m}%`;
    if (iconCurr) iconCurr.innerText = currInfo.icon;

    if (forecastGrid && data.daily && Array.isArray(data.daily.time)) {
        forecastGrid.innerHTML = "";
        const count = Math.min(3, data.daily.time.length);
        for (let i = 0; i < count; i++) {
            const dayName = getDayNameShort(data.daily.time[i], i);
            const wInfo = getWeatherCodeInfo(data.daily.weather_code[i]);
            const tMax = Math.round(data.daily.temperature_2m_max[i]);
            const tMin = Math.round(data.daily.temperature_2m_min[i]);
            const rainProb = data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[i] : 0;
            const rainMm = data.daily.precipitation_sum ? data.daily.precipitation_sum[i] : 0;

            let rainText = `${rainProb}%`;
            if (rainMm > 0) rainText += ` (${rainMm}mm)`;

            const itemEl = document.createElement('div');
            itemEl.className = "forecast-item";
            itemEl.innerHTML = `
                <div class="forecast-day-title">${dayName}</div>
                <span class="material-symbols-outlined forecast-icon">${wInfo.icon}</span>
                <div class="forecast-temps">${tMax}° <span class="forecast-temps-min">/ ${tMin}°</span></div>
                <div class="forecast-rain">
                    <span class="material-symbols-outlined" style="font-size: 0.82rem;">water_drop</span>
                    <span>${rainText}</span>
                </div>
            `;
            forecastGrid.appendChild(itemEl);
        }
    }
}

function updateLocationDisplay() {
    const lblName = document.getElementById('lblCurrentLocationName');
    const lblCoords = document.getElementById('lblCurrentLocationCoords');
    if (lblName) lblName.innerText = userLocation.name || "San Fernando";
    if (lblCoords) lblCoords.innerText = `${userLocation.lat}°, ${userLocation.lon}°`;
}

function initWeatherModule() {
    try {
        const saved = localStorage.getItem("dosimat_location");
        if (saved) {
            userLocation = JSON.parse(saved);
        }
    } catch(e) {}

    updateLocationDisplay();
    fetchWeatherData(userLocation.lat, userLocation.lon, userLocation.name);

    // Botón refrescar clima
    const btnRef = document.getElementById('btnRefreshWeather');
    if (btnRef) {
        btnRef.onclick = () => {
            showToast("Actualizando pronóstico...");
            fetchWeatherData(userLocation.lat, userLocation.lon, userLocation.name);
        };
    }

    // Botón GPS
    const btnGps = document.getElementById('btnDetectGPS');
    if (btnGps) {
        btnGps.onclick = () => {
            if (!("geolocation" in navigator)) {
                customAlert("Geolocalización no soportada en este navegador.");
                return;
            }
            showToast("Detectando ubicación GPS...");
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                let foundName = "Mi Ubicación";
                try {
                    const rev = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=es`);
                    const revJson = await rev.json();
                    if (revJson.city || revJson.locality) {
                        foundName = revJson.city || revJson.locality;
                    }
                } catch(err) {}

                userLocation = {
                    name: foundName,
                    lat: parseFloat(lat.toFixed(4)),
                    lon: parseFloat(lon.toFixed(4))
                };
                localStorage.setItem("dosimat_location", JSON.stringify(userLocation));
                updateLocationDisplay();
                fetchWeatherData(userLocation.lat, userLocation.lon, userLocation.name);
                showToast(`Ubicación establecida: ${foundName}`);
            }, (err) => {
                customAlert("No se pudo obtener la ubicación GPS: " + err.message, "GPS Error");
            }, { timeout: 10000 });
        };
    }

    // Buscador manual de ciudades
    const inpSearch = document.getElementById('inpSearchCity');
    const btnSearch = document.getElementById('btnSearchCity');
    const dropResults = document.getElementById('citySearchResults');

    const doSearch = async () => {
        const query = (inpSearch ? inpSearch.value : "").trim();
        if (!query || query.length < 2) {
            customAlert("Ingresa al menos 2 letras para buscar una ciudad.");
            return;
        }
        try {
            showToast("Buscando ciudades...");
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=es&format=json`);
            const data = await res.json();
            if (!data.results || data.results.length === 0) {
                if (dropResults) {
                    dropResults.innerHTML = `<div class="city-search-item" style="color: var(--text-muted);">No se encontraron resultados para "${escapeHtml(query)}"</div>`;
                    dropResults.style.display = "block";
                }
                return;
            }

            if (dropResults) {
                dropResults.innerHTML = "";
                data.results.forEach(city => {
                    const item = document.createElement('div');
                    item.className = "city-search-item";
                    const admin = city.admin1 ? `${city.admin1}, ` : "";
                    const country = city.country || "";
                    item.innerHTML = `
                        <span class="city-search-name">${escapeHtml(city.name)}</span>
                        <span class="city-search-country">${escapeHtml(admin + country)} (${city.latitude.toFixed(2)}°, ${city.longitude.toFixed(2)}°)</span>
                    `;
                    item.onclick = () => {
                        userLocation = {
                            name: city.name,
                            lat: parseFloat(city.latitude.toFixed(4)),
                            lon: parseFloat(city.longitude.toFixed(4))
                        };
                        localStorage.setItem("dosimat_location", JSON.stringify(userLocation));
                        updateLocationDisplay();
                        fetchWeatherData(userLocation.lat, userLocation.lon, userLocation.name);
                        dropResults.style.display = "none";
                        if (inpSearch) inpSearch.value = "";
                        showToast(`Ciudad seleccionada: ${city.name}`);
                    };
                    dropResults.appendChild(item);
                });
                dropResults.style.display = "block";
            }
        } catch(err) {
            console.error("Error buscando ciudad:", err);
            customAlert("Error al buscar la ciudad en Open-Meteo.");
        }
    };

    if (btnSearch) btnSearch.onclick = doSearch;
    if (inpSearch) {
        inpSearch.onkeydown = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                doSearch();
            }
        };
    }

    document.addEventListener('click', (e) => {
        if (dropResults && !dropResults.contains(e.target) && e.target !== inpSearch && e.target !== btnSearch) {
            dropResults.style.display = "none";
        }
    });

    const chkWeather = document.getElementById('chkWeatherAlerts');
    if (chkWeather) {
        chkWeather.onchange = () => {
            if (typeof evaluarAlertasSistema === "function") evaluarAlertasSistema();
        };
    }
}

// Iniciar módulo de clima al cargar
if (document.readyState === "loading") {
    document.addEventListener('DOMContentLoaded', initWeatherModule);
} else {
    initWeatherModule();
}

// =========================================================================
// === MÓDULO DE CALCULADORA DE PISCINA Y ESTIMADOR DE NIVEL DE BIDÓN ===
// =========================================================================

let bidonConfig = {
    totalBidones: 1,
    litrosPorBidon: 27.0,
    dosisLitros: 2.0,
    dosisAcumuladasHardware: 0.0,
    fechaRecarga: new Date().toISOString().split('T')[0],
    bidonesRecargados: 1,
    alertaMinDias: 5,
    alertaMinLitros: 4.0
};

let poolDims = {
    ancho: 4.0,
    largo: 8.0,
    prof: 1.5
};

function renderBidonUI() {
    const lblLitros = document.getElementById('lblBidonLitros');
    const lblDias = document.getElementById('lblBidonDias');
    const lblDosisAcum = document.getElementById('lblBidonDosisAcum');
    const lblCapacidad = document.getElementById('lblBidonCapacidad');
    const lblPercent = document.getElementById('lblBidonPercent');
    const liquidEl = document.getElementById('bidonLiquid');

    const capTotal = (bidonConfig.totalBidones || 1) * (bidonConfig.litrosPorBidon || 27.0);
    const dosisAcum = Math.max(0, bidonConfig.dosisAcumuladasHardware || 0.0);
    const dosisL = bidonConfig.dosisLitros || 2.0;

    const litrosConsumidos = dosisAcum * dosisL;
    const litrosRestantes = Math.max(0, capTotal - litrosConsumidos);
    const percent = Math.min(100, Math.max(0, Math.round((litrosRestantes / capTotal) * 100)));

    if (lblLitros) lblLitros.innerText = `${litrosRestantes.toFixed(1)} / ${capTotal.toFixed(1)} L`;
    if (lblPercent) lblPercent.innerText = `${percent}%`;
    if (liquidEl) liquidEl.style.height = `${percent}%`;
    if (lblDosisAcum) lblDosisAcum.innerText = `${dosisAcum.toFixed(1)} dosis`;
    if (lblCapacidad) lblCapacidad.innerText = `${bidonConfig.totalBidones} ${bidonConfig.totalBidones === 1 ? 'Bidón' : 'Bidones'} (${capTotal.toFixed(0)} L)`;

    // Calcular autonomía en días
    let totalDosisPorSemana = 0;
    try {
        const progs = (typeof obtenerListaProgramas === "function") ? obtenerListaProgramas() : [];
        progs.forEach(p => {
            if (p.dosifica && p.duracion > 0 && p.dias) {
                totalDosisPorSemana += (p.dias.length || 0);
            }
        });
    } catch(e) {}

    const dosisPorDia = totalDosisPorSemana > 0 ? (totalDosisPorSemana / 7.0) : 1.0;
    const consumoDiarioLitros = dosisPorDia * dosisL;
    const diasEstimados = (consumoDiarioLitros > 0) ? Math.round(litrosRestantes / consumoDiarioLitros) : 0;

    if (lblDias) {
        lblDias.innerText = diasEstimados > 0 ? `~${diasEstimados} días` : (litrosRestantes === 0 ? "0 días" : "-- días");
    }

    if (typeof evaluarAlertasSistema === "function") evaluarAlertasSistema();
}

function initPoolCalculator() {
    try {
        const saved = localStorage.getItem("dosimat_pool_dims");
        if (saved) poolDims = Object.assign(poolDims, JSON.parse(saved));
        const savedBidon = localStorage.getItem("dosimat_bidon_config");
        if (savedBidon) bidonConfig = Object.assign(bidonConfig, JSON.parse(savedBidon));
    } catch(e) {}

    const inpAncho = document.getElementById('inpPoolAncho');
    const inpLargo = document.getElementById('inpPoolLargo');
    const inpProf = document.getElementById('inpPoolProf');
    const inpDosisLitros = document.getElementById('inpDosisConfigLitros');
    const btnToggleCalc = document.getElementById('btnTogglePoolCalc');
    const calcBody = document.getElementById('poolCalcBody');
    const iconToggle = document.getElementById('iconToggleCalc');

    if (inpAncho) inpAncho.value = poolDims.ancho;
    if (inpLargo) inpLargo.value = poolDims.largo;
    if (inpProf) inpProf.value = poolDims.prof;
    if (inpDosisLitros) inpDosisLitros.value = bidonConfig.dosisLitros;

    const recalcularPiscina = () => {
        const a = parseFloat(inpAncho ? inpAncho.value : 0) || 0;
        const l = parseFloat(inpLargo ? inpLargo.value : 0) || 0;
        const p = parseFloat(inpProf ? inpProf.value : 0) || 0;
        const dL = parseFloat(inpDosisLitros ? inpDosisLitros.value : 2.0) || 2.0;

        poolDims = { ancho: a, largo: l, prof: p };
        bidonConfig.dosisLitros = dL;
        localStorage.setItem("dosimat_pool_dims", JSON.stringify(poolDims));
        localStorage.setItem("dosimat_bidon_config", JSON.stringify(bidonConfig));

        const volM3 = a * l * p;
        const volLitros = Math.round(volM3 * 1000);
        const dosisSugeridaVerano = (volLitros / 20000.0).toFixed(1);

        const lblVol = document.getElementById('lblPoolVolumen');
        const lblSugerida = document.getElementById('lblPoolDosisSugerida');
        if (lblVol) lblVol.innerText = `${volLitros.toLocaleString('es-AR')} Litros (${volM3.toFixed(1)} m³)`;
        if (lblSugerida) lblSugerida.innerText = `${dosisSugeridaVerano} L / día`;

        renderBidonUI();
    };

    if (inpAncho) inpAncho.oninput = recalcularPiscina;
    if (inpLargo) inpLargo.oninput = recalcularPiscina;
    if (inpProf) inpProf.oninput = recalcularPiscina;
    if (inpDosisLitros) inpDosisLitros.oninput = recalcularPiscina;

    if (btnToggleCalc && calcBody) {
        btnToggleCalc.onclick = () => {
            const isHidden = (calcBody.style.display === "none");
            calcBody.style.display = isHidden ? "block" : "none";
            if (iconToggle) iconToggle.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
        };
    }

    recalcularPiscina();
}

function initBidonModule() {
    try {
        const savedBidon = localStorage.getItem("dosimat_bidon_config");
        if (savedBidon) bidonConfig = Object.assign(bidonConfig, JSON.parse(savedBidon));
    } catch(e) {}

    // Modal Recarga
    const modalRecarga = document.getElementById('modalRecargaBidon');
    const btnOpenRecarga = document.getElementById('btnOpenModalRecarga');
    const btnCancelRecarga = document.getElementById('btnCancelRecarga');
    const btnConfirmRecarga = document.getElementById('btnConfirmRecarga');
    const inpRecargaBidones = document.getElementById('inpRecargaBidones');
    const inpRecargaFecha = document.getElementById('inpRecargaFecha');
    const lblRecargaLitrosCalc = document.getElementById('lblRecargaLitrosCalc');

    if (btnOpenRecarga && modalRecarga) {
        btnOpenRecarga.onclick = () => {
            if (inpRecargaBidones) inpRecargaBidones.value = bidonConfig.totalBidones || 1;
            if (inpRecargaFecha) inpRecargaFecha.value = new Date().toISOString().split('T')[0];
            if (lblRecargaLitrosCalc) {
                const bCount = parseFloat(inpRecargaBidones ? inpRecargaBidones.value : 1) || 1;
                lblRecargaLitrosCalc.innerText = `= ${(bCount * 27.0).toFixed(1)} Litros`;
            }
            modalRecarga.style.display = 'flex';
        };
    }

    if (inpRecargaBidones && lblRecargaLitrosCalc) {
        inpRecargaBidones.oninput = () => {
            const bCount = parseFloat(inpRecargaBidones.value) || 0;
            lblRecargaLitrosCalc.innerText = `= ${(bCount * 27.0).toFixed(1)} Litros`;
        };
    }

    if (btnCancelRecarga && modalRecarga) {
        btnCancelRecarga.onclick = () => { modalRecarga.style.display = 'none'; };
    }

    if (btnConfirmRecarga && modalRecarga) {
        btnConfirmRecarga.onclick = () => {
            const bRepuestos = parseFloat(inpRecargaBidones ? inpRecargaBidones.value : 1) || 1;
            const fechaStr = inpRecargaFecha ? inpRecargaFecha.value : new Date().toISOString().split('T')[0];

            bidonConfig.bidonesRecargados = bRepuestos;
            bidonConfig.fechaRecarga = fechaStr;
            bidonConfig.dosisAcumuladasHardware = 0.0;

            localStorage.setItem("dosimat_bidon_config", JSON.stringify(bidonConfig));

            // Enviar reset de contador al ESP32
            sendCommand({ comando: "RESET_CONTADOR_DOSIS" });

            renderBidonUI();
            modalRecarga.style.display = 'none';
            showToast(`Recarga registrada: ${(bRepuestos * 27.0).toFixed(1)} Litros`);
        };
    }

    // Modal Ajustar Nivel
    const modalAjustar = document.getElementById('modalAjustarBidon');
    const btnOpenAjustar = document.getElementById('btnOpenModalAjustarBidon');
    const btnCancelAjustar = document.getElementById('btnCancelAjustarBidon');
    const btnConfirmAjustar = document.getElementById('btnConfirmAjustarBidon');
    const inpTotalBidones = document.getElementById('inpTotalBidonesInstalados');
    const lblAjusteCapacidadLitros = document.getElementById('lblAjusteCapacidadLitros');
    const rngAjuste = document.getElementById('rngAjusteNivel');
    const lblAjusteVal = document.getElementById('lblAjusteNivelVal');
    const lblAjusteLitros = document.getElementById('lblAjusteNivelLitros');
    const inpAlertaDias = document.getElementById('inpAlertaMinDias');
    const inpAlertaLitros = document.getElementById('inpAlertaMinLitros');

    const updateAjustePreview = () => {
        const bTotal = parseFloat(inpTotalBidones ? inpTotalBidones.value : 1) || 1;
        const pct = parseInt(rngAjuste ? rngAjuste.value : 100) || 0;
        const cap = bTotal * 27.0;
        const litros = (cap * pct / 100.0).toFixed(1);
        if (lblAjusteCapacidadLitros) lblAjusteCapacidadLitros.innerText = `= ${cap.toFixed(1)} Litros`;
        if (lblAjusteVal) lblAjusteVal.innerText = `${pct}%`;
        if (lblAjusteLitros) lblAjusteLitros.innerText = `= ${litros} Litros restantes`;
    };

    if (btnOpenAjustar && modalAjustar) {
        btnOpenAjustar.onclick = () => {
            if (inpTotalBidones) inpTotalBidones.value = bidonConfig.totalBidones || 1;
            if (inpAlertaDias) inpAlertaDias.value = bidonConfig.alertaMinDias || 5;
            if (inpAlertaLitros) inpAlertaLitros.value = bidonConfig.alertaMinLitros || 4.0;

            const capTotal = (bidonConfig.totalBidones || 1) * (bidonConfig.litrosPorBidon || 27.0);
            const consumidos = (bidonConfig.dosisAcumuladasHardware || 0.0) * (bidonConfig.dosisLitros || 2.0);
            const restantes = Math.max(0, capTotal - consumidos);
            const currentPct = Math.min(100, Math.max(0, Math.round((restantes / capTotal) * 100)));

            if (rngAjuste) rngAjuste.value = currentPct;
            updateAjustePreview();
            modalAjustar.style.display = 'flex';
        };
    }

    if (inpTotalBidones) inpTotalBidones.oninput = updateAjustePreview;
    if (rngAjuste) rngAjuste.oninput = updateAjustePreview;

    if (btnCancelAjustar && modalAjustar) {
        btnCancelAjustar.onclick = () => { modalAjustar.style.display = 'none'; };
    }

    if (btnConfirmAjustar && modalAjustar) {
        btnConfirmAjustar.onclick = () => {
            const bTotal = parseFloat(inpTotalBidones ? inpTotalBidones.value : 1) || 1;
            const pct = parseInt(rngAjuste ? rngAjuste.value : 100) || 0;
            const aDias = parseInt(inpAlertaDias ? inpAlertaDias.value : 5) || 5;
            const aLitros = parseFloat(inpAlertaLitros ? inpAlertaLitros.value : 4.0) || 4.0;

            const cap = bTotal * 27.0;
            const litrosRestantesDeseados = cap * (pct / 100.0);
            const litrosConsumidos = Math.max(0, cap - litrosRestantesDeseados);
            const dosisEquiv = Math.round((litrosConsumidos / (bidonConfig.dosisLitros || 2.0)) * 100) / 100;

            bidonConfig.totalBidones = bTotal;
            bidonConfig.dosisAcumuladasHardware = dosisEquiv;
            bidonConfig.alertaMinDias = aDias;
            bidonConfig.alertaMinLitros = aLitros;

            localStorage.setItem("dosimat_bidon_config", JSON.stringify(bidonConfig));

            // Enviar ajuste al ESP32
            sendCommand({ comando: "SET_CONTADOR_DOSIS", valor: dosisEquiv });

            renderBidonUI();
            modalAjustar.style.display = 'none';
            showToast(`Nivel ajustado: ${pct}% (${litrosRestantesDeseados.toFixed(1)} L)`);
        };
    }

    // Modal Solicitar Reposición de Cloro
    const modalSolicitar = document.getElementById('modalSolicitarReposicion');
    const btnOpenSolicitar = document.getElementById('btnOpenModalSolicitarCloro');
    const btnCloseSolicitar = document.getElementById('btnCloseModalSolicitarCloro');
    const inpSolCant = document.getElementById('inpSolCantBidones');
    const lblSolLitrosTotal = document.getElementById('lblSolLitrosTotal');
    const lblSolNivelActual = document.getElementById('lblSolNivelActual');
    const lblSolAutonomia = document.getElementById('lblSolAutonomia');
    const btnSolWsp = document.getElementById('btnSolWsp');
    const btnSolEmail = document.getElementById('btnSolEmail');
    const btnSolPortal = document.getElementById('btnSolPortal');

    const updateSolPreview = () => {
        const cant = parseInt(inpSolCant ? inpSolCant.value : 1) || 1;
        if (lblSolLitrosTotal) lblSolLitrosTotal.innerText = `= ${(cant * 27.0).toFixed(1)} Litros`;
    };

    if (inpSolCant) inpSolCant.oninput = updateSolPreview;

    if (btnOpenSolicitar && modalSolicitar) {
        btnOpenSolicitar.onclick = () => {
            const capTotal = (bidonConfig.totalBidones || 1) * (bidonConfig.litrosPorBidon || 27.0);
            const consumidos = (bidonConfig.dosisAcumuladasHardware || 0.0) * (bidonConfig.dosisLitros || 2.0);
            const restantes = Math.max(0, capTotal - consumidos);
            const percent = Math.round((restantes / capTotal) * 100);

            let totalDosisPorSemana = 0;
            try {
                const progs = (typeof obtenerListaProgramas === "function") ? obtenerListaProgramas() : [];
                progs.forEach(p => {
                    if (p.dosifica && p.duracion > 0 && p.dias) {
                        totalDosisPorSemana += (p.dias.length || 0);
                    }
                });
            } catch(e) {}
            const dosisPorDia = totalDosisPorSemana > 0 ? (totalDosisPorSemana / 7.0) : 1.0;
            const consumoDiarioLitros = dosisPorDia * (bidonConfig.dosisLitros || 2.0);
            const diasEstimados = (consumoDiarioLitros > 0) ? Math.round(restantes / consumoDiarioLitros) : 0;

            if (lblSolNivelActual) lblSolNivelActual.innerText = `${restantes.toFixed(1)} L (${percent}%)`;
            if (lblSolAutonomia) lblSolAutonomia.innerText = diasEstimados > 0 ? `~${diasEstimados} días` : (restantes === 0 ? "0 días" : "-- días");
            if (inpSolCant) inpSolCant.value = bidonConfig.totalBidones || 1;
            updateSolPreview();

            modalSolicitar.style.display = 'flex';
        };
    }

    if (btnCloseSolicitar && modalSolicitar) {
        btnCloseSolicitar.onclick = () => { modalSolicitar.style.display = 'none'; };
    }

    if (btnSolWsp) {
        btnSolWsp.onclick = () => {
            const cant = parseInt(inpSolCant ? inpSolCant.value : 1) || 1;
            const litros = (cant * 27.0).toFixed(1);
            const capTotal = (bidonConfig.totalBidones || 1) * (bidonConfig.litrosPorBidon || 27.0);
            const consumidos = (bidonConfig.dosisAcumuladasHardware || 0.0) * (bidonConfig.dosisLitros || 2.0);
            const restantes = Math.max(0, capTotal - consumidos).toFixed(1);
            const percent = Math.round((restantes / capTotal) * 100);
            const mac = currentMac || "No vinculada";
            
            const u = (typeof auth !== "undefined" && auth.currentUser) ? auth.currentUser : null;
            const userName = (u && u.displayName) ? u.displayName : (document.getElementById('lblUserName')?.innerText || "Cliente");
            const userEmail = (u && u.email) ? u.email : "Sin email";
            const wspNum = globalSoporteWsp || "5491153074195";

            const texto = `Hola! Quisiera solicitar la reposición de *${cant} bidón(es)* (${litros} Litros de cloro) para mi equipo Dosimat.\n\n📍 *Datos del Cliente y Equipo:*\n• Nombre: ${userName}\n• Email: ${userEmail}\n• MAC: ${mac}\n• Nivel actual: ${restantes} L (${percent}%)\n\nMuchas gracias!`;
            window.open(`https://wa.me/${wspNum}?text=${encodeURIComponent(texto)}`, '_blank');
        };
    }

    if (btnSolEmail) {
        btnSolEmail.onclick = () => {
            const cant = parseInt(inpSolCant ? inpSolCant.value : 1) || 1;
            const litros = (cant * 27.0).toFixed(1);
            const capTotal = (bidonConfig.totalBidones || 1) * (bidonConfig.litrosPorBidon || 27.0);
            const consumidos = (bidonConfig.dosisAcumuladasHardware || 0.0) * (bidonConfig.dosisLitros || 2.0);
            const restantes = Math.max(0, capTotal - consumidos).toFixed(1);
            const percent = Math.round((restantes / capTotal) * 100);
            const mac = currentMac || "No vinculada";
            
            const u = (typeof auth !== "undefined" && auth.currentUser) ? auth.currentUser : null;
            const userName = (u && u.displayName) ? u.displayName : (document.getElementById('lblUserName')?.innerText || "Cliente");
            const userEmail = (u && u.email) ? u.email : "Sin email";
            const mailAddr = globalSoporteMail || "soporte@dosimat.com";

            const subject = encodeURIComponent(`Solicitud de Reposición de Cloro - ${userName} (${userEmail}) - Dosimat ${mac}`);
            const body = encodeURIComponent(`Hola equipo de Dosimat,\n\nQuisiera solicitar la reposición de ${cant} bidón(es) de 27 Litros (${litros} Litros en total) para mi equipo Dosimat.\n\nDatos del Cliente y Equipo:\n- Nombre: ${userName}\n- Email: ${userEmail}\n- Identificador (MAC): ${mac}\n- Nivel actual estimado: ${restantes} Litros (${percent}%)\n\nMuchas gracias.\nSaludos cordiales,\n${userName}`);
            window.location.href = `mailto:${mailAddr}?subject=${subject}&body=${body}`;
        };
    }

    if (btnSolPortal) {
        btnSolPortal.onclick = () => {
            window.open("https://dosimat-pro.netlify.app", "_blank");
        };
    }

    renderBidonUI();
}

// =========================================================================
// === MÓDULO DE INTEGRACIÓN CON DOSIMAT PRO (SISTEMA DE REPOSICIÓN) ===
// =========================================================================

let proClientState = {
    isLinked: false,
    clientDoc: null,
    upcomingDelivery: null,
    openOrders: [],
    customEmail: localStorage.getItem("dosimat_pro_email") || ""
};

async function ensureProAuth() {
    if (!proAuth) return;
    if (!proAuth.currentUser) {
        try {
            await signInAnonymously(proAuth);
        } catch (e) {
            console.warn("proAuth signInAnonymously aviso/error:", e);
        }
    }
}

async function syncDosimatProClient() {
    if (!proDb) return;

    await ensureProAuth();

    const emailToSearch = (proClientState.customEmail || (auth.currentUser ? auth.currentUser.email : "") || "").trim().toLowerCase();
    
    if (!emailToSearch) {
        proClientState.isLinked = false;
        proClientState.clientDoc = null;
        proClientState.upcomingDelivery = null;
        proClientState.openOrders = [];
        renderDosimatProUI();
        return;
    }

    try {
        // 1. Buscar en la colección 'clients' de DosimatPro
        let matchedDoc = null;
        const qDirect = query(collection(proDb, "clients"), where("mail", "==", emailToSearch), limit(1));
        const snapDirect = await getDocs(qDirect);
        
        if (!snapDirect.empty) {
            matchedDoc = snapDirect.docs[0];
        } else {
            // Buscar si coincide en la lista completa
            const allClientsSnap = await getDocs(collection(proDb, "clients"));
            for (const docSnap of allClientsSnap.docs) {
                const data = docSnap.data();
                if (!data.mail) continue;
                const emails = data.mail.split(/[;, ]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
                if (emails.includes(emailToSearch)) {
                    matchedDoc = docSnap;
                    break;
                }
            }
        }

        if (matchedDoc) {
            proClientState.isLinked = true;
            proClientState.clientDoc = { id: matchedDoc.id, ...matchedDoc.data() };
            
            if (!proClientState.customEmail) {
                proClientState.customEmail = emailToSearch;
                localStorage.setItem("dosimat_pro_email", emailToSearch);
            }

            // 2. Cargar Próxima Entrega / Hojas de ruta
            await loadProDeliverySheet(matchedDoc.id);

            // 3. Cargar Pedidos Activos del Cliente
            await loadProClientOrders(matchedDoc.id);
        } else {
            proClientState.isLinked = false;
            proClientState.clientDoc = null;
            proClientState.upcomingDelivery = null;
            proClientState.openOrders = [];
        }
    } catch (err) {
        console.error("Error sincronizando cliente con DosimatPro:", err);
    }

    renderDosimatProUI();
}

async function loadProDeliverySheet(clientId) {
    if (!proDb || !clientId) return;
    try {
        await ensureProAuth();
        const qSheets = query(
            collection(proDb, "route_sheets"),
            where("participantClientIds", "array-contains", clientId),
            where("status", "in", ["planned", "active"])
        );
        const snap = await getDocs(qSheets);
        
        if (!snap.empty) {
            const sorted = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
                return new Date(b.date + 'T12:00:00').getTime() - new Date(a.date + 'T12:00:00').getTime();
            });

            const sheet = sorted[0];
            const item = sheet.items?.find(i => i.clientId === clientId);
            
            proClientState.upcomingDelivery = {
                date: sheet.date,
                status: sheet.status,
                cloro: Number(item?.plannedChlorine || 0),
                acido: Number(item?.plannedAcid || 0)
            };
        } else {
            const qGlobal = query(collection(proDb, "route_sheets"), where("status", "==", "planned"));
            const snapGlobal = await getDocs(qGlobal);
            const future = snapGlobal.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(s => new Date(s.date) >= new Date())
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            if (future.length > 0) {
                proClientState.upcomingDelivery = {
                    date: future[0].date,
                    status: 'planned',
                    cloro: 0,
                    acido: 0
                };
            } else {
                proClientState.upcomingDelivery = null;
            }
        }
    } catch (err) {
        console.error("Error cargando hojas de ruta de DosimatPro:", err);
        proClientState.upcomingDelivery = null;
    }
}

async function loadProClientOrders(clientId) {
    if (!proDb || !clientId) return;
    try {
        await ensureProAuth();
        const qOrders = query(
            collection(proDb, "client_requests"),
            where("clientId", "==", clientId),
            where("status", "in", ["pending", "scheduled"])
        );
        const snap = await getDocs(qOrders);
        proClientState.openOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error("Error cargando pedidos de DosimatPro:", err);
        proClientState.openOrders = [];
    }
}

function formatProDate(isoDateStr) {
    if (!isoDateStr) return "--";
    try {
        const parts = isoDateStr.split("-");
        if (parts.length === 3) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            const options = { weekday: 'long', day: 'numeric', month: 'long' };
            const formatted = d.toLocaleDateString('es-AR', options);
            return formatted.charAt(0).toUpperCase() + formatted.slice(1);
        }
    } catch (e) {}
    return isoDateStr;
}

function renderDosimatProUI() {
    // 1. Banner en el Dashboard
    const bannerReparto = document.getElementById('bannerProReparto');
    const lblRepartoTit = document.getElementById('lblProRepartoTitulo');
    const lblRepartoDet = document.getElementById('lblProRepartoDetalle');
    const badgeReparto = document.getElementById('badgeProRepartoEstado');
    const btnSolSistema = document.getElementById('btnSolSistemaPro');

    if (proClientState.isLinked && proClientState.upcomingDelivery) {
        if (bannerReparto) bannerReparto.style.display = 'block';
        const d = proClientState.upcomingDelivery;
        const fechaTxt = formatProDate(d.date);

        if (lblRepartoTit) {
            lblRepartoTit.innerText = d.status === "active" ? "🚚 ¡Reparto en Camino Hoy!" : `Próximo Reparto: ${fechaTxt}`;
        }
        if (lblRepartoDet) {
            if (d.cloro > 0 || d.acido > 0) {
                lblRepartoDet.innerText = `Planificado: ${d.cloro > 0 ? d.cloro + ' Cloro ' : ''}${d.acido > 0 ? d.acido + ' Ácido' : ''}`;
            } else {
                lblRepartoDet.innerText = "Fecha programada en el cronograma de entregas";
            }
        }
        if (badgeReparto) {
            badgeReparto.innerText = d.status === "active" ? "En Reparto" : "Planificado";
            badgeReparto.style.background = d.status === "active" ? "#dcfce7" : "#e0f2fe";
            badgeReparto.style.color = d.status === "active" ? "#16a34a" : "#0284c7";
        }
    } else {
        if (bannerReparto) bannerReparto.style.display = 'none';
    }

    // Botón de Confirmar Pedido en el Sistema Pro dentro del modal de reposición
    if (btnSolSistema) {
        btnSolSistema.style.display = proClientState.isLinked ? 'flex' : 'none';
    }

    // 2. Portal en la solapa Soporte
    const notLinkedView = document.getElementById('proClientNotLinked');
    const linkedView = document.getElementById('proClientLinked');

    if (!proClientState.isLinked) {
        if (notLinkedView) notLinkedView.style.display = 'block';
        if (linkedView) linkedView.style.display = 'none';
        const inpEmail = document.getElementById('inpProCustomEmail');
        if (inpEmail && !inpEmail.value) {
            inpEmail.value = proClientState.customEmail || (auth.currentUser ? auth.currentUser.email : "");
        }
    } else {
        if (notLinkedView) notLinkedView.style.display = 'none';
        if (linkedView) linkedView.style.display = 'block';

        const c = proClientState.clientDoc;
        const lblNom = document.getElementById('lblProClientNombre');
        const lblDir = document.getElementById('lblProClientDireccion');
        const lblSaldo = document.getElementById('lblProClientSaldo');
        const lblEmail = document.getElementById('lblProLinkedEmail');

        if (lblNom) lblNom.innerText = `${c.apellido || ''}, ${c.nombre || ''}`.trim() || 'Cliente Dosimat';
        if (lblDir) lblDir.innerText = c.direccion || c.localidad || 'Sin dirección registrada';
        
        if (lblSaldo) {
            const saldo = Number(c.saldo || 0);
            lblSaldo.innerText = `$${saldo.toLocaleString('es-AR')}`;
            lblSaldo.style.color = saldo < 0 ? 'var(--danger)' : '#10b981';
        }
        if (lblEmail) lblEmail.innerText = proClientState.customEmail || c.mail || '--';

        // Próxima entrega en el portal
        const lblFechaPortal = document.getElementById('lblProPortalFechaEntrega');
        const lblDetallePortal = document.getElementById('lblProPortalDetalleItems');
        const badgePortal = document.getElementById('badgeProPortalEstado');

        if (proClientState.upcomingDelivery) {
            const d = proClientState.upcomingDelivery;
            if (lblFechaPortal) lblFechaPortal.innerText = formatProDate(d.date);
            if (lblDetallePortal) {
                lblDetallePortal.innerText = (d.cloro > 0 || d.acido > 0)
                    ? `Entrega asignada: ${d.cloro} Bidón(es) de Cloro${d.acido > 0 ? ', ' + d.acido + ' de Ácido' : ''}`
                    : 'Fecha planificada en el cronograma de repartos';
            }
            if (badgePortal) {
                badgePortal.innerText = d.status === "active" ? "En Reparto" : "Planificado";
                badgePortal.style.background = d.status === "active" ? "#dcfce7" : "#e0f2fe";
                badgePortal.style.color = d.status === "active" ? "#16a34a" : "#0284c7";
            }
        } else {
            if (lblFechaPortal) lblFechaPortal.innerText = "Sin repartos programados";
            if (lblDetallePortal) lblDetallePortal.innerText = "Podés hacer un pedido para que sea incluido en la próxima hoja de ruta.";
            if (badgePortal) {
                badgePortal.innerText = "Pendiente";
                badgePortal.style.background = "#f1f5f9";
                badgePortal.style.color = "#64748b";
            }
        }

        // Lista de pedidos
        const listContainer = document.getElementById('proPedidosList');
        const lblCount = document.getElementById('lblProCountPedidos');
        if (lblCount) lblCount.innerText = `${proClientState.openOrders.length} pedido(s)`;

        if (listContainer) {
            if (proClientState.openOrders.length === 0) {
                listContainer.innerHTML = `<div style="font-size: 0.76rem; color: var(--text-muted); font-style: italic; padding: 0.3rem 0;">No tenés pedidos pendientes actualmente.</div>`;
            } else {
                listContainer.innerHTML = proClientState.openOrders.map(p => {
                    const cantTxt = `${p.cloro > 0 ? p.cloro + ' Cloro' : ''}${p.cloro > 0 && p.acido > 0 ? ' · ' : ''}${p.acido > 0 ? p.acido + ' Ácido' : ''}`;
                    const statusClass = p.status === 'scheduled' ? 'scheduled' : 'pending';
                    const statusTxt = p.status === 'scheduled' ? 'Programado' : 'Pendiente';
                    return `
                        <div class="pro-pedido-item">
                            <div class="pro-pedido-info">
                                <div class="pro-pedido-title">${cantTxt || 'Pedido'}</div>
                                <div class="pro-pedido-sub">${p.notes ? `"${p.notes}"` : 'Sin notas adicionales'}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                                <span class="pro-badge ${statusClass}">${statusTxt}</span>
                                ${p.status === 'pending' ? `
                                    <button class="btn-pro-cancel-order" onclick="cancelarPedidoPro('${p.id}')" title="Cancelar Pedido">
                                        <span class="material-symbols-outlined" style="font-size: 1.1rem;">delete</span>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    }
}

async function enviarNuevoPedidoPro(cloro, acido, notas) {
    if (!proDb || !proClientState.clientDoc) {
        showToast("Error: No estás vinculado a una cuenta de reposición.");
        return false;
    }

    if (cloro <= 0 && acido <= 0) {
        showToast("Indicá al menos 1 bidón de cloro o ácido.");
        return false;
    }

    try {
        await ensureProAuth();
        const c = proClientState.clientDoc;
        await addDoc(collection(proDb, "client_requests"), {
            clientId: c.id,
            clientName: `${c.apellido || ''}, ${c.nombre || ''}`.trim() || 'Cliente Dosimat',
            date: new Date().toISOString(),
            cloro: Number(cloro),
            acido: Number(acido),
            notes: notas || "",
            status: "pending"
        });

        showToast("¡Pedido enviado con éxito al Sistema de Reposición!");
        await syncDosimatProClient();
        return true;
    } catch (e) {
        console.error("Error enviando pedido a DosimatPro:", e);
        showToast("Error al enviar pedido. Intenta por WhatsApp.");
        return false;
    }
}

window.cancelarPedidoPro = async function(requestId) {
    if (!proDb || !requestId) return;
    try {
        await ensureProAuth();
        await deleteDoc(doc(proDb, "client_requests", requestId));
        showToast("Pedido cancelado.");
        await syncDosimatProClient();
    } catch (e) {
        console.error("Error cancelando pedido:", e);
        showToast("No se pudo cancelar el pedido.");
    }
};

function initDosimatProModule() {
    // Botón Vincular / Iniciar Sesión en Pro
    const btnVincular = document.getElementById('btnVincularProEmail');
    const inpCustomEmail = document.getElementById('inpProCustomEmail');
    const inpCustomPassword = document.getElementById('inpProCustomPassword');
    const lblError = document.getElementById('lblProLoginError');

    if (btnVincular && inpCustomEmail) {
        btnVincular.onclick = async () => {
            const email = inpCustomEmail.value.trim().toLowerCase();
            const password = inpCustomPassword ? inpCustomPassword.value.trim() : "";
            if (lblError) lblError.style.display = 'none';

            if (!email) {
                showToast("Ingresá tu correo electrónico.");
                return;
            }

            btnVincular.disabled = true;
            btnVincular.innerText = "Conectando...";

            try {
                if (proAuth && password) {
                    await signInWithEmailAndPassword(proAuth, email, password);
                } else {
                    await ensureProAuth();
                }

                proClientState.customEmail = email;
                localStorage.setItem("dosimat_pro_email", email);
                await syncDosimatProClient();

                if (!proClientState.isLinked) {
                    if (lblError) {
                        lblError.innerText = "No se encontró un cliente con este correo en el sistema de reposición.";
                        lblError.style.display = 'block';
                    }
                } else {
                    showToast("¡Portal de Clientes conectado exitosamente!");
                }
            } catch (err) {
                console.error("Error conectando con Portal Pro:", err);
                if (lblError) {
                    let msg = "No se pudo conectar. Verificá tu correo y contraseña del Portal.";
                    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                        msg = "Contraseña incorrecta del Portal de Clientes.";
                    } else if (err.code === 'auth/user-not-found') {
                        msg = "No se encontró una cuenta registrada con este correo.";
                    }
                    lblError.innerText = msg;
                    lblError.style.display = 'block';
                }
            } finally {
                btnVincular.disabled = false;
                btnVincular.innerText = "Conectar con Portal de Clientes";
            }
        };
    }

    // Botón Cambiar Email / Desconectar
    const btnCambiar = document.getElementById('btnProCambiarEmail');
    if (btnCambiar) {
        btnCambiar.onclick = async () => {
            if (proAuth) {
                try { await signOut(proAuth); } catch(e){}
            }
            proClientState.isLinked = false;
            proClientState.clientDoc = null;
            proClientState.upcomingDelivery = null;
            proClientState.openOrders = [];
            proClientState.customEmail = "";
            localStorage.removeItem("dosimat_pro_email");
            renderDosimatProUI();
        };
    }

    // Formulario de Pedido en Solapa Soporte
    const btnEnviar = document.getElementById('btnProEnviarPedido');
    const inpCloro = document.getElementById('inpProOrderCloro');
    const inpAcido = document.getElementById('inpProOrderAcido');
    const inpNotas = document.getElementById('inpProOrderNotas');

    if (btnEnviar) {
        btnEnviar.onclick = async () => {
            const c = parseInt(inpCloro ? inpCloro.value : 1) || 0;
            const a = parseInt(inpAcido ? inpAcido.value : 0) || 0;
            const n = inpNotas ? inpNotas.value.trim() : "";

            btnEnviar.disabled = true;
            btnEnviar.innerText = "Enviando pedido...";
            const ok = await enviarNuevoPedidoPro(c, a, n);
            btnEnviar.disabled = false;
            btnEnviar.innerText = "Confirmar y Enviar Pedido";

            if (ok && inpNotas) inpNotas.value = "";
        };
    }

    // Botón de Enviar Pedido al Sistema desde el Modal de Reposición del Dashboard
    const btnSolSistema = document.getElementById('btnSolSistemaPro');
    const inpSolCant = document.getElementById('inpSolCantBidones');
    const modalSolicitar = document.getElementById('modalSolicitarReposicion');

    if (btnSolSistema) {
        btnSolSistema.onclick = async () => {
            const cant = parseInt(inpSolCant ? inpSolCant.value : 1) || 1;
            btnSolSistema.disabled = true;
            btnSolSistema.innerText = "Enviando pedido...";
            const ok = await enviarNuevoPedidoPro(cant, 0, "Solicitado desde el Dashboard de Dosimat IoT");
            btnSolSistema.disabled = false;
            btnSolSistema.innerText = "Confirmar Pedido en el Sistema";

            if (ok && modalSolicitar) {
                modalSolicitar.style.display = 'none';
            }
        };
    }

    // Sincronizar automáticamente en el inicio
    syncDosimatProClient();
}

// Iniciar módulos al cargar
if (document.readyState === "loading") {
    document.addEventListener('DOMContentLoaded', () => {
        initPoolCalculator();
        initBidonModule();
        initDosimatProModule();
    });
} else {
    initPoolCalculator();
    initBidonModule();
    initDosimatProModule();
}



