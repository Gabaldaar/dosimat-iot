# 📘 Guía de Implementación: Notificaciones Push en PWA IoT con Firebase Cloud Messaging (FCM)

Esta guía documenta la arquitectura completa y el código necesario para implementar un sistema de **Notificaciones Push en tiempo real** en una Progressive Web App (PWA) de IoT conectada a Firebase y microcontroladores (ESP32/ESP8266), permitiendo alertar al usuario en su teléfono móvil **incluso con la aplicación completamente cerrada**, sin sobrecargar el microcontrolador y a costo $0.

---

## 🏛️ 1. Diagrama de Flujo y Arquitectura

```
 [ Microcontrolador ESP32 ]
         │ (MQTT Telemetría en vivo / Logs de Eventos)
         ▼
 [ Firebase Cloud Functions (Webhook / Firestore Triggers) ]
         │ 1. Identifica qué usuarios son propietarios del equipo en Firestore.
         │ 2. Consulta las preferencias del usuario (interruptores activos).
         │ 3. Recupera los Tokens FCM de sus teléfonos/dispositivos.
         ▼
 [ Google Firebase Cloud Messaging (FCM API) ]
         │ (Envío push a los servidores de Android Push / Apple APNs)
         ▼
 [ Service Worker en Móvil (firebase-messaging-sw.js) ]
         │ (El sistema operativo despierta al SW en 2do plano y muestra banner con vibración)
         ▼
 🔔 [ Notificación Nativa en Pantalla ]
```

---

## 📂 2. Service Worker Unificado (`firebase-messaging-sw.js`)

> [!CAUTION]
> **Regla de Oro:** NO registres dos Service Workers separados (`service-worker.js` para caché y `firebase-messaging-sw.js` para FCM) en el mismo dominio raíz `/`. Esto causa colisiones de ámbito (*scope*), provocando que un Service Worker sobrescriba al otro y genere un bucle infinito del cartel *"Actualización disponible"*. Ambos deben unificarse en **`firebase-messaging-sw.js`**.

```javascript
// firebase-messaging-sw.js - Service Worker unificado para PWA y Notificaciones Push FCM
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const CACHE_NAME = 'app-cache-v1.0';
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./index.css",
  "./manifest.json"
];

// === 1. CACHÉ FUERA DE LÍNEA PWA ===
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
});

self.addEventListener("fetch", event => {
  // Ignorar peticiones a Firebase, APIs u orígenes externos
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// === 2. FIREBASE CLOUD MESSAGING (PUSH EN 2DO PLANO) ===
firebase.initializeApp({
  apiKey: "TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.firebasestorage.app",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId: "TU_APP_ID"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  console.log('[SW] Push recibido con la App cerrada:', payload);
  
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || 'Dosimat IoT';
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || '';
  
  const notificationOptions = {
    body: body,
    icon: (payload.notification && payload.notification.icon) || '/manifest.json',
    badge: '/manifest.json',
    tag: (payload.data && payload.data.tag) || 'iot-alert',
    data: payload.data || {},
    vibrate: [200, 100, 200]
  };

  self.registration.showNotification(title, notificationOptions);
});

// === 3. ACCIÓN AL TOCAR LA NOTIFICACIÓN ===
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
```

---

## 💻 3. Frontend: Registro de Token y Preferencias (`app.js`)

### A. Registro del Service Worker y Obtención del Token FCM
```javascript
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";

let messaging = null;
try {
    messaging = getMessaging(app);
} catch (e) {
    console.warn("FCM no soportado en este entorno:", e);
}

// 1. Registro del Service Worker al cargar la PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then(reg => console.log('SW activo:', reg.scope))
            .catch(err => console.error('Error en SW:', err));
    });
}

// 2. Función para solicitar permisos al usuario y registrar Token en Firestore
async function solicitarPermisoYRegistrarToken() {
    if (!('Notification' in window)) {
        alert("Notificaciones no soportadas. En iOS debes agregar la app a la Pantalla de Inicio.");
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted' && currentUser) {
        try {
            const swReg = await navigator.serviceWorker.ready;
            const token = await getToken(messaging, { serviceWorkerRegistration: swReg });
            
            if (token) {
                console.log("[FCM] Token obtenido:", token);
                // Guardar en Firestore bajo la cuenta del usuario
                await setDoc(doc(db, "usuarios", currentUser.uid, "fcm_tokens", token.substring(0, 30)), {
                    token: token,
                    userAgent: navigator.userAgent,
                    updatedAt: Date.now()
                }, { merge: true });
            }
        } catch (e) {
            console.error("Error registrando token FCM:", e);
        }
    }
}
```

### B. Estructura de Datos en Firestore

1. **Tokens de Dispositivos:**
   `/usuarios/{uid}/fcm_tokens/{tokenId}`
   ```json
   {
     "token": "dKjs83...fcm_token_string",
     "userAgent": "Mozilla/5.0 (Android...)",
     "updatedAt": 1724950000000
   }
   ```

2. **Preferencias de Notificación del Usuario:**
   `/usuarios/{uid}/config_notificaciones/actual`
   ```json
   {
     "notificaciones_activas": true,
     "dosis_no_realizada": true,
     "refuerzo_temp": true,
     "dosis_completada": true,
     "dosis_anulada": true,
     "sistema_pausa": true
   }
   ```

### C. Botón de Prueba Local de Notificación
Permite al usuario validar que su sistema operativo y navegador permiten mostrar carteles:
```javascript
async function probarNotificacionLocal() {
    const swReg = await navigator.serviceWorker.ready;
    if (swReg && swReg.showNotification) {
        await swReg.showNotification("⚠️ Alerta (Prueba)", {
            body: "¡Prueba exitosa! Las notificaciones funcionan en tu teléfono.",
            icon: "/manifest.json",
            vibrate: [200, 100, 200]
        });
    }
}
```

---

## ☁️ 4. Backend: Firebase Cloud Functions (`functions/index.js`)

### A. Despachador Multicast Inteligente (`sendPushToDeviceOwners`)
Busca a todos los propietarios del equipo, corrobora sus preferencias individuales y despacha en masa mediante `admin.messaging().sendEachForMulticast()`.

```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

async function sendPushToDeviceOwners(chipId, notification, eventType) {
    try {
        console.log(`[FCM] Enviando push para equipo ${chipId} - Tipo: ${eventType}`);
        
        // 1. Identificar a todos los usuarios vinculados a este chipId
        const userDocsSnap = await db.collection("usuarios").get();
        const targetUids = [];

        for (const userDoc of userDocsSnap.docs) {
            const uData = userDoc.data() || {};
            // Verificar si tiene asignado el equipo en raíz o en subcolecciones
            if (uData.id_equipo === chipId || (Array.isArray(uData.equipos) && uData.equipos.includes(chipId))) {
                targetUids.push(userDoc.id);
                continue;
            }
            const eqSnap = await db.doc(`usuarios/${userDoc.id}/equipos_asignados/${chipId}`).get();
            if (eqSnap.exists) targetUids.push(userDoc.id);
        }

        if (targetUids.length === 0) return;

        // 2. Filtrar por preferencias de notificación y recolectar tokens
        const tokensToSend = [];
        const tokenDocRefs = [];

        for (const uid of targetUids) {
            const prefSnap = await db.doc(`usuarios/${uid}/config_notificaciones/actual`).get();
            const prefs = prefSnap.exists ? prefSnap.data() : {};

            if (prefs.notificaciones_activas === false) continue;
            if (eventType && prefs[eventType] === false) continue; // Desactivado por el usuario

            const fcmSnap = await db.collection(`usuarios/${uid}/fcm_tokens`).get();
            fcmSnap.forEach(tokenDoc => {
                const tokenVal = tokenDoc.data().token || tokenDoc.id;
                if (tokenVal && !tokensToSend.includes(tokenVal)) {
                    tokensToSend.push(tokenVal);
                    tokenDocRefs.push({ ref: tokenDoc.ref, token: tokenVal });
                }
            });
        }

        if (tokensToSend.length === 0) return;

        // 3. Despacho Multicast a FCM
        const messagePayload = {
            tokens: tokensToSend,
            notification: {
                title: notification.title || "Dosimat IoT",
                body: notification.body || ""
            },
            data: {
                chipId: String(chipId),
                eventType: String(eventType || "general"),
                url: "/"
            }
        };

        const response = await admin.messaging().sendEachForMulticast(messagePayload);
        console.log(`[FCM] Éxito: ${response.successCount}, Fallos: ${response.failureCount}`);

        // 4. Limpieza automática de tokens obsoletos o apps desinstaladas
        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errCode = resp.error ? resp.error.code : "";
                    if (errCode === "messaging/registration-token-not-registered" ||
                        errCode === "messaging/invalid-registration-token") {
                        if (tokenDocRefs[idx] && tokenDocRefs[idx].ref) {
                            tokenDocRefs[idx].ref.delete().catch(() => {});
                        }
                    }
                }
            });
        }
    } catch (error) {
        console.error("[FCM] Error en despacho:", error);
    }
}
```

### B. Disparadores en Tiempo Real (Telemetría + Logs)

```javascript
// 1. Webhook MQTT / Telemetría en Vivo (Inmediatez absoluta)
exports.mqttWebhook = functions.https.onRequest(async (req, res) => {
    const { topic, payload } = req.body;
    const chipId = topic.split("/")[1];
    const data = typeof payload === "string" ? JSON.parse(payload) : payload;

    if (topic.includes("telemetry")) {
        const prevEstadoSnap = await db.doc(`equipos/${chipId}/estado/actual`).get();
        const prevEstado = prevEstadoSnap.exists ? prevEstadoSnap.data() : {};

        await db.doc(`equipos/${chipId}/estado/actual`).set(data, { merge: true });

        // Advertencia en vivo (ej: Bomba apagada)
        if (data.ult_warn && data.ult_warn !== prevEstado.ult_warn) {
            await sendPushToDeviceOwners(chipId, {
                title: "⚠️ Alerta Dosimat",
                body: data.ult_warn
            }, "dosis_no_realizada");
        }

        // Transición a Pausa
        if (data.est === "PAUSA" && prevEstado.estado !== "PAUSA") {
            await sendPushToDeviceOwners(chipId, {
                title: "⏸️ Sistema en Pausa",
                body: "El dosificador ha sido puesto en Pausa/Mantenimiento."
            }, "sistema_pausa");
        }
    }
    return res.status(200).send("OK");
});

// 2. Trigger Firestore ante creación de logs de historial
exports.onLogCreated = functions.firestore.document("equipos/{chipId}/logs/{logId}").onCreate(async (snap, context) => {
    const chipId = context.params.chipId;
    const logData = snap.data();
    if (!logData) return;

    const msg = String(logData.msg || "");
    const tipo = String(logData.tipo || "");

    if (tipo === "warning" || msg.includes("Dosis no realizada")) {
        await sendPushToDeviceOwners(chipId, { title: "⚠️ Alerta Dosimat", body: msg }, "dosis_no_realizada");
    } else if (msg.includes("Refuerzo automático") || tipo === "refuerzo_temp") {
        await sendPushToDeviceOwners(chipId, { title: "🌡️ Refuerzo por Temperatura", body: msg }, "refuerzo_temp");
    } else if (msg.includes("Dosis completada") || tipo === "dosis_ok") {
        await sendPushToDeviceOwners(chipId, { title: "✅ Dosis Completada", body: msg }, "dosis_completada");
    }
});
```

---

## 🔑 5. Puntos Clave y Errores a Evitar

1. **Doble Disparador (Telemetría + Logs):** Si el microcontrolador retiene los logs en memoria RAM y solo los vuelca esporádicamente, la telemetría en vivo (`ult_warn`) debe ser la encargada de disparar el push inmediatamente.
2. **Requisitos en iOS:** En iPhones/iPads con iOS 16.4+, las Web Push solo funcionan si el usuario agregó la PWA a la pantalla de inicio desde Safari (*"Compartir > Agregar a pantalla de inicio"*).
3. **Limpieza de Tokens:** Manejar siempre el error `registration-token-not-registered` para eliminar tokens muertos de Firestore y optimizar el rendimiento.
4. **Vibración y Visibilidad:** Configurar `vibrate: [200, 100, 200]` en el Service Worker para asegurar que el teléfono vibre al recibir la alerta en reposo.
