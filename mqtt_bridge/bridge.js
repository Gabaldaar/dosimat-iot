// bridge.js - Puente MQTT a Firebase Cloud Functions 24/7
const mqtt = require('mqtt');
const https = require('https');

const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const WEBHOOK_URL = 'https://us-central1-dosimat-iot-v2.cloudfunctions.net/mqttWebhook';

console.log('[BRIDGE] Iniciando puente MQTT 24/7 hacia Firebase Cloud Functions...');

const client = mqtt.connect(MQTT_BROKER, {
    keepalive: 60,
    reconnectPeriod: 5000
});

client.on('connect', () => {
    console.log('[BRIDGE] Conectado exitosamente a HiveMQ (broker.hivemq.com:1883).');
    client.subscribe(['dosimat/+/logs', 'dosimat/+/telemetry'], (err) => {
        if (!err) {
            console.log('[BRIDGE] Suscrito a los canales "dosimat/+/logs" y "dosimat/+/telemetry".');
        } else {
            console.error('[BRIDGE] Error suscribiendo a topics:', err);
        }
    });
});

client.on('message', (topic, message) => {
    try {
        const payloadStr = message.toString();
        const payloadJson = JSON.parse(payloadStr);
        
        console.log(`[BRIDGE] Mensaje recibido en [${topic}]:`, payloadStr.substring(0, 120));
        
        const postData = JSON.stringify({
            topic: topic,
            payload: payloadJson
        });
        
        const url = new URL(WEBHOOK_URL);
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 8000
        }, (res) => {
            console.log(`[BRIDGE] Forward a Firebase exitoso -> Código HTTP: ${res.statusCode}`);
        });
        
        req.on('error', (e) => {
            console.error('[BRIDGE] Error enviando webhook a Firebase:', e.message);
        });
        
        req.write(postData);
        req.end();
    } catch (e) {
        console.error('[BRIDGE] Error procesando JSON recibido:', e.message);
    }
});

client.on('error', (err) => {
    console.error('[BRIDGE] Error de conexion MQTT:', err);
});
