// firebase-messaging-sw.js - Manejador de notificaciones Push en segundo plano para Dosimat IoT
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

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
