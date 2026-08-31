const functions = require("firebase-functions");
const admin = require("firebase-admin");
const mqtt = require("mqtt");

admin.initializeApp();
const db = admin.firestore();

// Configuración del Broker MQTT Privado HiveMQ Cloud
const MQTT_BROKER_URL = "mqtts://Dosimat:Ga210295@d7e739cc51844a9699a70616d89a2b99.s1.eu.hivemq.cloud:8883";

/**
 * Función auxiliar para verificar roles y permisos del usuario en Firestore.
 * Valida si el usuario es Propietario del equipo, Técnico o Super Admin.
 */
async function checkUserPermission(chipId, auth) {
    if (!auth || !auth.uid) return { role: null, allowed: false };
    const uid = auth.uid;
    const email = auth.token ? auth.token.email : null;

    if (email === "gab.aldazabal@gmail.com") {
        return { role: "super_admin", allowed: true };
    }

    if (email) {
        const tecnicoSnap = await db.doc(`administradores/${email}`).get();
        if (tecnicoSnap.exists && tecnicoSnap.data().rol === "tecnico") {
            return { role: "tecnico", allowed: true };
        }
    }

    // 1. Verificar si es Super Admin
    const superAdminSnap = await db.doc("roles/super_admin").get();
    if (superAdminSnap.exists && superAdminSnap.data()[uid] === true) {
        return { role: "super_admin", allowed: true };
    }

    // 2. Verificar si es Propietario del equipo
    const propietarioSnap = await db.doc(`equipos/${chipId}/propietarios/${uid}`).get();
    const isOwner = propietarioSnap.exists && propietarioSnap.data().activo === true;

    if (isOwner) {
        return { role: "owner", allowed: true };
    }

    return { role: null, allowed: false };
}

/**
 * Función auxiliar para enviar un comando al Broker MQTT
 */
function publishToMqtt(chipId, payload) {
    return new Promise((resolve, reject) => {
        const client = mqtt.connect(MQTT_BROKER_URL);
        client.on("connect", () => {
            const topic = `dosimat/${chipId}/cmd`;
            client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
                client.end();
                if (err) {
                    console.error(`Error publicando en MQTT para ${chipId}:`, err);
                    reject(err);
                } else {
                    console.log(`Mensaje publicado en ${topic}:`, payload);
                    resolve();
                }
            });
        });
        client.on("error", (err) => {
            client.end();
            reject(err);
        });
    });
}

/**
 * 1. Webhook HTTP para recibir Telemetría y Logs desde el Broker MQTT.
 */
exports.mqttWebhook = functions.https.onRequest(async (req, res) => {
    const { topic, payload } = req.body;
    if (!topic || !payload) {
        return res.status(400).send("Falta topic o payload en el cuerpo de la solicitud.");
    }

    console.log(`Webhook MQTT recibido - Topic: ${topic}`);

    try {
        const topicParts = topic.split("/");
        const chipId = topicParts[1];
        const subTopic = topicParts[2];
        const rawData = typeof payload === "string" ? JSON.parse(payload) : payload;

        const data = (rawData.tipo === "TELEMETRIA" || rawData.tipo === "LOG_ENTRY") ? rawData.data : rawData;

        if (subTopic === "telemetry") {
            const estadoData = {
                estado: data.est || "IDLE",
                temperatura_rtc: data.temp_rtc !== undefined ? data.temp_rtc : (data.temp || 0.0),
                refuerzo: data.ref === 1,
                pausado: data.est === "PAUSA",
                tr: data.tr !== undefined ? data.tr : 0,
                config_version: data.v !== undefined ? data.v : 1,
                ultima_sincronizacion: admin.firestore.FieldValue.serverTimestamp()
            };
            if (data.modelo !== undefined) estadoData.modelo = String(data.modelo).toUpperCase();
            if (data.bomba_on !== undefined) estadoData.bomba_on = Number(data.bomba_on);
            if (data.ult_warn !== undefined) estadoData.ult_warn = data.ult_warn;

            const prevEstadoSnap = await db.doc(`equipos/${chipId}/estado/actual`).get();
            const prevEstado = prevEstadoSnap.exists ? prevEstadoSnap.data() : {};

            await db.doc(`equipos/${chipId}/estado/actual`).set(estadoData, { merge: true });

            const rootData = { ultima_sincronizacion: admin.firestore.FieldValue.serverTimestamp() };
            if (data.modelo !== undefined) rootData.modelo = String(data.modelo).toUpperCase();
            await db.doc(`equipos/${chipId}`).set(rootData, { merge: true });

            // 1. Advertencia en tiempo real (ej: Bomba apagada / Dosis cancelada)
            if (data.evento_tipo === "warning" || (data.ult_warn && data.ult_warn !== prevEstado.ult_warn)) {
                console.log(`[FCM] Advertencia en telemetría para ${chipId}: ${data.ult_warn || data.msg}`);
                await sendPushToDeviceOwners(chipId, {
                    title: "⚠️ Alerta Dosimat",
                    body: data.ult_warn || data.msg || "Dosis no realizada: la bomba de filtrado no estuvo encendida."
                }, "dosis_no_realizada");
            }

            // 2. Transición a PAUSA
            if (data.evento_tipo === "sistema_pausa" || (data.est === "PAUSA" && prevEstado.estado !== "PAUSA")) {
                console.log(`[FCM] Transición a PAUSA detectada para ${chipId}`);
                await sendPushToDeviceOwners(chipId, {
                    title: "⏸️ Sistema en Pausa",
                    body: "El dosificador ha sido puesto en Pausa/Mantenimiento."
                }, "sistema_pausa");
            }

            // 3. Dosis completada
            if (data.evento_tipo === "dosis_completada" || (prevEstado.estado === "DOSIS" && (data.est === "IDLE" || data.est === "FILTRO_POST" || data.est === "FILTRO"))) {
                if (!data.ult_warn || data.ult_warn === prevEstado.ult_warn || data.evento_tipo === "dosis_completada") {
                    console.log(`[FCM] Dosis completada detectada para ${chipId}`);
                    await sendPushToDeviceOwners(chipId, {
                        title: "✅ Dosis Completada",
                        body: data.msg || "La dosificación de cloro programada ha finalizado con éxito."
                    }, "dosis_completada");
                }
            }

            // 4. Refuerzo de temperatura
            if (data.evento_tipo === "refuerzo_temp") {
                console.log(`[FCM] Refuerzo por temperatura detectado para ${chipId}`);
                await sendPushToDeviceOwners(chipId, {
                    title: "🌡️ Refuerzo por Temperatura",
                    body: data.msg || "Se ha programado una dosis reforzada preventiva por alta temperatura."
                }, "refuerzo_temp");
            }

            console.log(`Estado de telemetría de ${chipId} escrito en Firestore.`);
            return res.status(200).send("Telemetría procesada exitosamente.");

        } else if (subTopic === "sys_log") {
            if (rawData.tipo === "LOGS_END" || data.tipo === "LOGS_END") {
                return res.status(200).send("Ignorado.");
            }
            const logId = data.ts ? `log_${data.ts}` : `log_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const tsJS = data.ts ? (data.ts < 100000 ? Date.now() : (data.ts + 946684800) * 1000) : Date.now();
            await db.doc(`equipos/${chipId}/logs/${logId}`).set({
                ...data,
                fecha: data.fecha || new Date(tsJS).toLocaleString('es-AR', { timeZone: 'UTC' }),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                origen: "MQTT"
            });

            console.log(`Log de ${chipId} guardado en Firestore con ID ${logId}.`);
            return res.status(200).send("Log procesado exitosamente.");
        }

        return res.status(400).send("Topic secundario no soportado.");
    } catch (error) {
        console.error("Error procesando Webhook MQTT:", error);
        return res.status(500).send("Error interno de procesamiento: " + error.message);
    }
});

/**
 * 2. Trigger de Firestore: Escucha cambios en 'config/actual' y los envía por MQTT al ESP32.
 */
exports.onConfigWrite = functions.firestore.document("equipos/{chipId}/config/actual").onWrite(async (change, context) => {
    const chipId = context.params.chipId;
    const nextData = change.after.data();
    
    const uid = context.auth ? context.auth.uid : null;
    if (context.auth) {
        const permissions = await checkUserPermission(chipId, context.auth);
        if (!permissions.allowed) {
            console.warn(`Usuario no autorizado ${uid} intentó modificar configuración de ${chipId}`);
            return;
        }
    }

    if (!nextData) return;

    console.log(`Detectada nueva configuración en Firestore para ${chipId}. Enviando al ESP32...`);
    const payload = {
        comando: "UPDATE_CONFIG",
        config: {
            config_version: nextData.config_version || 1,
            tespera_seg: nextData.tespera_seg || 3600,
            tdosis_seg: nextData.tdosis_seg || 300,
            ajuste_baja: nextData.ajuste_baja || 10,
            temporada_alta_inicio: nextData.temporada_alta_inicio || "11-01",
            temporada_alta_fin: nextData.temporada_alta_fin || "03-31"
        }
    };

    await publishToMqtt(chipId, payload);
});

/**
 * 3. Trigger de Firestore: Escucha cambios en 'programas/actual' y los envía por MQTT al ESP32.
 */
exports.onProgramasWrite = functions.firestore.document("equipos/{chipId}/programas/actual").onWrite(async (change, context) => {
    const chipId = context.params.chipId;
    const nextData = change.after.data();

    const uid = context.auth ? context.auth.uid : null;
    if (context.auth) {
        const permissions = await checkUserPermission(chipId, context.auth);
        if (!permissions.allowed) {
            console.warn(`Usuario no autorizado ${uid} intentó modificar programas de ${chipId}`);
            return;
        }
    }

    if (!nextData) return;

    console.log(`Detectado cambio en programas de ${chipId}. Transmitiendo horarios al equipo...`);
    
    const cronograma = [];
    for (let i = 1; i <= 10; i++) {
        const inicio = nextData[`PR${i}_inicio`];
        const duracion = nextData[`PR${i}_duracion_min`];
        const dosifica = nextData[`PR${i}_dosifica`];
        const dias = nextData[`PR${i}_dias`];

        if (inicio && duracion) {
            cronograma.push({
                on: inicio.replace(":", ""),
                duracion: parseFloat(duracion),
                dosis: dosifica ? 1 : 0,
                dias: Array.isArray(dias) ? dias.join("") : (dias || "0123456")
            });
        }
    }

    const payload = {
        comando: "config_cronograma",
        cronograma: cronograma
    };

    await publishToMqtt(chipId, payload);
});

/**
 * 4. Trigger de Firestore: Escucha comandos de estado y los envía por MQTT al ESP32.
 */
exports.onEstadoWrite = functions.firestore.document("equipos/{chipId}/estado/actual").onWrite(async (change, context) => {
    const chipId = context.params.chipId;
    const nextData = change.after.data();
    const prevData = change.before.data();

    const uid = context.auth ? context.auth.uid : null;
    if (context.auth) {
        const permissions = await checkUserPermission(chipId, context.auth);
        if (!permissions.allowed) {
            console.warn(`Usuario no autorizado ${uid} intentó enviar comando a ${chipId}`);
            return;
        }
        
        if (permissions.role === "tecnico" && nextData.comando_solicitado === "FACTORY_RESET") {
            console.warn(`Técnico ${uid} intentó hacer reset de fábrica en ${chipId}. Bloqueado.`);
            return;
        }
    }

    if (nextData) {
        // 1. Detección de advertencia en estado
        if (nextData.ult_warn && (!prevData || prevData.ult_warn !== nextData.ult_warn)) {
            console.log(`[FCM] onEstadoWrite detectó advertencia para ${chipId}: ${nextData.ult_warn}`);
            await sendPushToDeviceOwners(chipId, {
                title: "⚠️ Alerta Dosimat",
                body: nextData.ult_warn
            }, "dosis_no_realizada");
        }
        // 2. Detección de transición a Pausa
        if (nextData.estado === "PAUSA" && (!prevData || prevData.estado !== "PAUSA")) {
            console.log(`[FCM] onEstadoWrite detectó PAUSA para ${chipId}`);
            await sendPushToDeviceOwners(chipId, {
                title: "⏸️ Sistema en Pausa",
                body: "El dosificador ha sido puesto en Pausa/Mantenimiento."
            }, "sistema_pausa");
        }
    }

    if (!nextData || !nextData.comando_solicitado) return;
    
    // Si el timestamp es el mismo (o ambos no lo tienen y el comando es igual), salimos
    if (prevData && prevData._ts === nextData._ts && prevData.comando_solicitado === nextData.comando_solicitado) return;

    console.log(`Detectado comando solicitado '${nextData.comando_solicitado}' para ${chipId}.`);
    
    let payload = null;
    switch (nextData.comando_solicitado) {
        case "START_CYCLE":
            payload = { comando: "START_CYCLE", refuerzo: !!nextData.refuerzo_solicitado };
            break;
        case "PAUSE_CYCLE":
            payload = { comando: "PAUSE_CYCLE" };
            break;
        case "RESUME_CYCLE":
            payload = { comando: "RESUME_CYCLE" };
            break;
        case "CANCEL_CYCLE":
            payload = { comando: "CANCEL_CYCLE" };
            break;
        case "RUN_ANTI":
            payload = { comando: "RUN_ANTI" };
            break;
        case "FACTORY_RESET":
            payload = { comando: "FACTORY_RESET" };
            break;
        case "START_PUMP":
            payload = { comando: "START_PUMP" };
            break;
        case "SET_REFUERZO":
            payload = { comando: "SET_REFUERZO", refuerzo: !!nextData.refuerzo_solicitado };
            break;
        case "SET_ANULADAS":
            payload = { comando: "SET_ANULADAS", valor: nextData.anuladas_solicitadas !== undefined ? nextData.anuladas_solicitadas : 0 };
            break;
        case "GET_STATE":
            payload = { comando: "GET_STATE" };
            break;
        case "GET_LOGS":
            payload = { comando: "GET_LOGS" };
            break;
        case "CLEAR_LOGS":
            payload = { comando: "CLEAR_LOGS" };
            // También borrar los logs de Firestore
            try {
                const logsSnapshot = await db.collection(`equipos/${chipId}/logs`).get();
                const batch = db.batch();
                logsSnapshot.docs.forEach((doc) => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                console.log(`Logs de ${chipId} borrados en Firestore.`);
            } catch (e) {
                console.error("Error borrando logs en Firestore", e);
            }
            break;
        case "GET_CONFIG":
            payload = { comando: "GET_CONFIG" };
            break;
        case "sync_rtc":
            payload = { comando: "sync_rtc", fecha: nextData.fecha, hora: nextData.hora };
            break;
        case "config_wifi":
            payload = { comando: "config_wifi", ssid: nextData.ssid, pwd: nextData.pwd };
            break;
        default:
            console.log(`Comando no reconocido: ${nextData.comando_solicitado}`);
            return;
    }

    if (payload) {
        await publishToMqtt(chipId, payload);
        
        await db.doc(`equipos/${chipId}/estado/actual`).update({
            comando_solicitado: admin.firestore.FieldValue.delete(),
            refuerzo_solicitado: admin.firestore.FieldValue.delete()
        });
    }
});

/**
 * Función auxiliar para enviar notificaciones Push vía FCM a todos los usuarios asignados al equipo,
 * verificando las preferencias individuales de notificación de cada cliente.
 */
async function sendPushToDeviceOwners(chipId, notification, eventType) {
    try {
        console.log(`[FCM] Evaluando envío de notificación para equipo ${chipId} - Tipo: ${eventType}`);
        
        // 1. Buscar todos los usuarios que tienen asignado este chipId
        const userDocsSnap = await db.collection("usuarios").get();
        const targetUids = [];

        for (const userDoc of userDocsSnap.docs) {
            const uData = userDoc.data() || {};
            if (uData.id_equipo === chipId || (Array.isArray(uData.equipos) && uData.equipos.includes(chipId))) {
                targetUids.push(userDoc.id);
                continue;
            }
            const eqRef = db.doc(`usuarios/${userDoc.id}/equipos_asignados/${chipId}`);
            const eqSnap = await eqRef.get();
            if (eqSnap.exists) {
                targetUids.push(userDoc.id);
            }
        }

        // Si no se encontró en subcolecciones, verificar propietarios directos
        const propSnap = await db.collection(`equipos/${chipId}/propietarios`).get();
        propSnap.forEach(doc => {
            if (!targetUids.includes(doc.id)) targetUids.push(doc.id);
        });

        if (targetUids.length === 0) {
            console.log(`[FCM] No se encontraron usuarios vinculados al equipo ${chipId}`);
            return;
        }

        // 2. Para cada usuario, verificar preferencias y recolectar tokens FCM
        const tokensToSend = [];
        const tokenDocRefs = [];

        for (const uid of targetUids) {
            // Preferencias del usuario
            const prefSnap = await db.doc(`usuarios/${uid}/config_notificaciones/actual`).get();
            const prefs = prefSnap.exists ? prefSnap.data() : {};

            // Si el switch maestro está desactivado, omitir
            if (prefs.notificaciones_activas === false) continue;

            // Si el switch específico para este evento está desactivado, omitir
            if (eventType && prefs[eventType] === false) continue;

            // Obtener tokens de FCM del usuario
            const fcmSnap = await db.collection(`usuarios/${uid}/fcm_tokens`).get();
            fcmSnap.forEach(tokenDoc => {
                const tokenVal = tokenDoc.data().token || tokenDoc.id;
                if (tokenVal && typeof tokenVal === "string" && !tokensToSend.includes(tokenVal)) {
                    tokensToSend.push(tokenVal);
                    tokenDocRefs.push({ ref: tokenDoc.ref, token: tokenVal });
                }
            });
        }

        if (tokensToSend.length === 0) {
            console.log(`[FCM] No hay tokens FCM activos o autorizados para ${chipId}`);
            return;
        }

        console.log(`[FCM] Enviando mensaje a ${tokensToSend.length} dispositivo(s)...`);

        const messagePayload = {
            tokens: tokensToSend,
            notification: {
                title: notification.title || "Dosimat IoT",
                body: notification.body || ""
            },
            webpush: {
                notification: {
                    icon: "https://dosimat-iot-v2.web.app/icon-192.png",
                    badge: "https://dosimat-iot-v2.web.app/icon-192.png"
                },
                fcmOptions: {
                    link: "https://dosimat-iot-v2.web.app/"
                }
            },
            data: {
                chipId: String(chipId),
                eventType: String(eventType || "general"),
                url: "/"
            }
        };

        const response = await admin.messaging().sendEachForMulticast(messagePayload);
        console.log(`[FCM] Resultado de envío: ${response.successCount} exitosos, ${response.failureCount} fallidos.`);

        // Limpiar tokens inválidos o expirados
        if (response.failureCount > 0) {
            const deletePromises = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errCode = resp.error ? resp.error.code : "";
                    if (errCode === "messaging/registration-token-not-registered" ||
                        errCode === "messaging/invalid-registration-token" ||
                        errCode === "messaging/invalid-argument") {
                        const tokenInfo = tokenDocRefs[idx];
                        if (tokenInfo && tokenInfo.ref) {
                            deletePromises.push(tokenInfo.ref.delete().catch(() => {}));
                        }
                    }
                }
            });
            await Promise.all(deletePromises);
        }
    } catch (error) {
        console.error(`[FCM] Error enviando notificaciones para ${chipId}:`, error);
    }
}

/**
 * 5. Trigger de Firestore: Escucha la creación de logs y despacha notificaciones push automáticas.
 */
exports.onLogCreated = functions.firestore.document("equipos/{chipId}/logs/{logId}").onCreate(async (snap, context) => {
    const chipId = context.params.chipId;
    const logData = snap.data();
    if (!logData) return;

    const msg = String(logData.msg || "");
    const tipo = String(logData.tipo || "");

    // 1. Advertencia de dosis no realizada
    if (tipo === "warning" || msg.includes("Dosis no realizada") || msg.includes("Bomba apagada")) {
        await sendPushToDeviceOwners(chipId, {
            title: "⚠️ Alerta Dosimat",
            body: msg || "Dosis no realizada: la bomba de filtrado no estuvo encendida."
        }, "dosis_no_realizada");
    }
    // 2. Refuerzo por temperatura
    else if (msg.includes("Refuerzo automático") || msg.includes("Refuerzo por temperatura") || tipo === "refuerzo_temp") {
        await sendPushToDeviceOwners(chipId, {
            title: "🌡️ Refuerzo por Temperatura",
            body: msg || "Se ha programado una dosis reforzada preventiva por alta temperatura."
        }, "refuerzo_temp");
    }
    // 3. Dosis completada
    else if (msg.includes("Dosis completada") || msg.includes("Dosis finalizada") || tipo === "dosis_ok") {
        await sendPushToDeviceOwners(chipId, {
            title: "✅ Dosis Completada",
            body: msg || "La dosificación de cloro programada ha finalizado con éxito."
        }, "dosis_completada");
    }
    // 4. Dosis anulada
    else if (msg.includes("Dosis anulada") || msg.includes("Próxima dosis anulada") || msg.includes("anuladas")) {
        await sendPushToDeviceOwners(chipId, {
            title: "🚫 Dosis Anulada",
            body: msg || "Se ha anulado la próxima dosis programada."
        }, "dosis_anulada");
    }
    // 5. Sistema en Pausa
    else if (msg.includes("Inicio de Pausa") || msg.includes("Pausa/Mantenimiento")) {
        await sendPushToDeviceOwners(chipId, {
            title: "⏸️ Sistema en Pausa",
            body: "El dosificador ha sido puesto en Pausa/Mantenimiento."
        }, "sistema_pausa");
    }
});
