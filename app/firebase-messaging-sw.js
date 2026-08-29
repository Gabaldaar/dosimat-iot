// firebase-messaging-sw.js - Service Worker unificado para PWA y Notificaciones Push FCM
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const CACHE_NAME = 'dosimat-iot-v2-cache-v6.79';
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./index.css",
  "./manifest.json"
];

// === 1. CACHÉ PWA ===
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
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
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// === 2. FIREBASE CLOUD MESSAGING (PUSH) ===
firebase.initializeApp({
  apiKey: "AIzaSyDrfjhqsAdkDbQFCXqzns6UF7JByccg5vw",
  authDomain: "dosimat-iot-v2.firebaseapp.com",
  projectId: "dosimat-iot-v2",
  storageBucket: "dosimat-iot-v2.firebasestorage.app",
  messagingSenderId: "877312821470",
  appId: "1:877312821470:web:9c36c73a0efa745344da4f"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación Push recibida en segundo plano:', payload);
  
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || 'Dosimat IoT';
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || '';
  
  const notificationOptions = {
    body: body,
    icon: (payload.notification && payload.notification.icon) || '/manifest.json',
    badge: '/manifest.json',
    tag: (payload.data && payload.data.tag) || 'dosimat-alert',
    data: payload.data || {},
    vibrate: [200, 100, 200]
  };

  self.registration.showNotification(title, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
