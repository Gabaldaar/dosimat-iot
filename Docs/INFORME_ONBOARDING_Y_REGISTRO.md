# 📄 Informe Técnico: Flujo de Usuarios, Alta de Equipos y Vinculación BLE

Este documento detalla la implementación del proceso de autenticación de usuarios nuevos, el alta de equipos en la base de datos Firestore y el mecanismo de vinculación mediante Bluetooth Low Energy (BLE).

---

## 1. Proceso de Registro e Ingreso de Usuarios Nuevos

La aplicación maneja el flujo de acceso mediante **Firebase Authentication** y **Firestore**.

### A. Pantalla de Bienvenida / Autenticación (`authOverlay`)
Cuando un usuario ingresa a la PWA sin una sesión activa, la aplicación bloquea el acceso mediante un modal flotante (`authOverlay`) que ofrece dos caminos:

1. **Registro con Correo Electrónico y Contraseña:**
   - El usuario hace clic en `¿No tienes cuenta? Regístrate` (cambiando `authMode = "REGISTER"`).
   - Se habilitan los campos: **Nombre**, **Correo Electrónico** y **Contraseña**.
   - Al presionar *Registrarse*, la PWA ejecuta:
     ```javascript
     const res = await createUserWithEmailAndPassword(auth, email, password);
     await updateProfile(res.user, { displayName: nombre });
     ```
2. **Registro e Ingreso Rápido con Google:**
   - El usuario presiona el botón *Iniciar con Google*.
   - Ejecuta `signInWithPopup(auth, new GoogleAuthProvider())`. Si el usuario no existía previamente en Firebase Auth, la cuenta se crea de forma automática.

### B. Creación del Perfil en Firestore
Cada vez que la PWA detecta un usuario autenticado mediante el listener `onAuthStateChanged(auth, user)`:
- Crea o actualiza de forma transparente su registro en la colección `/usuarios/{UID}`:
  ```javascript
  setDoc(doc(db, "usuarios", user.uid), {
      email: user.email,
      nombre: user.displayName || user.email,
      ultima_conexion: new Date()
  }, { merge: true });
  ```

---

## 2. Registro de Equipos Nuevos en la Base de Datos (Firestore)

Un equipo nuevo (placa ESP32 de fábrica) se identifica en el sistema por su **MAC ID** (12 caracteres hexadecimales únicos del chip, por ejemplo: `841FE8694040`).

El alta de un equipo en Firestore puede realizarse de dos formas:

### A. Alta Previa Administrativa (Consola Firebase o Portal Técnico):
Se crea el documento principal en `/equipos/{MAC}` con sus datos descriptivos y sus subcolecciones iniciales con valores por defecto de fábrica:
- `/equipos/{MAC}` $\rightarrow$ `alias`, `modelo`, `registradoAt`.
- `/equipos/{MAC}/estado/actual` $\rightarrow$ `estado: "IDLE"`, `modo: "AUTO"`, `tr: 0`.
- `/equipos/{MAC}/config/actual` $\rightarrow$ `tespera_seg: 90`, `tdosis_seg: 90`, `ajuste_baja: 50`.
- `/equipos/{MAC}/programas/actual` $\rightarrow$ `PR1_inicio: "21:00"`, `PR1_duracion_min: 60`, `PR1_dosifica: true`.

### B. Autodiscovery / Registro Automático:
Si un equipo nuevo transmite telemetría o vinculación BLE por primera vez sin estar previamente registrado, la PWA o el backend crea automáticamente el nodo del equipo utilizando su ID único.

---

## 3. Estado Inicial de un Usuario Nuevo (Sin Equipos Vinculados)

Al iniciar sesión, la función `onAuthStateChanged` consulta la información del usuario en Firestore:
1. Revisa si el documento `/usuarios/{UID}` tiene el campo `id_equipo` o un arreglo en `equipos`.
2. Si no lo encuentra, consulta la subcolección `/usuarios/{UID}/equipos_asignados`.
3. **Si el usuario no posee ningún equipo asignado:**
   - La PWA **no establece conexión MQTT a la nube**.
   - En la barra superior de estado muestra: **`"No tienes equipos vinculados. Vincula tu equipo por Bluetooth."`**
   - Muestra el botón desplegable para abrir el **Modal de Vinculación Bluetooth (`btnShowConnectBLE`)**.

---

## 4. Proceso de Vinculación y Configuración del Equipo (BLE)

Cuando un usuario nuevo está físicamente cerca de su dosificador Dosimat y desea vincularlo a su cuenta y conectarlo a su red WiFi:

### Paso 1: Activar el servicio BLE en el ESP32
- Si el ESP32 no tiene credenciales WiFi guardadas o no logra conectarse a la red, entra automáticamente en estado `STATE_BLE_ONLY` (o `STATE_FALLBACK_BLE`), transmitiendo publicidad Bluetooth bajo el nombre `Dosimat_XXXX` (donde `XXXX` son los últimos 4 dígitos de su MAC).

### Paso 2: Escaneo y Conexión desde la PWA
- El usuario hace clic en el botón de vinculación (`btnShowConnectBLE`).
- La PWA ejecuta `navigator.bluetooth.requestDevice(...)` solicitando el servicio Bluetooth GATT personalizado de Dosimat.
- La PWA se conecta directamente al equipo vía Bluetooth sin necesidad de internet.

### Paso 3: Envío de Credenciales WiFi y Asignación de Propiedad
- La PWA solicita al usuario el **SSID (nombre de red)** y la **Contraseña del WiFi**.
- Envía por el canal BLE el comando de configuración:
  ```json
  { "comando": "config_wifi", "ssid": "MiRedWiFi", "pass": "ClaveWiFi" }
  ```
- Al mismo tiempo, la PWA registra la vinculación en Firestore:
  1. Agrega la MAC del equipo a la subcolección `/usuarios/{UID}/equipos_asignados/{MAC}`.
  2. Guarda la relación en `/equipos/{MAC}/propietarios/{UID}`.

### Paso 4: Transición a Modo Nube (MQTT)
- El ESP32 recibe las credenciales vía BLE, guarda `wifi_config.json` en Flash, apaga el Bluetooth para evitar interferencias RF y enciende la interfaz WiFi.
- Se conecta a la red WiFi local y establece la sesión MQTT con el broker HiveMQ en los tópicos `dosimat/{MAC}/...`.
- La PWA cambia su indicador de estado a **NUBE (WiFi)** y comienza a recibir y mostrar la telemetría en tiempo real del equipo recién vinculado.
