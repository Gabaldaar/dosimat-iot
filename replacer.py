with open('app/app.js', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace(
    'function listenConfigCollection() {\n    if (unsubscribeConfig) {\n        unsubscribeConfig();\n        unsubscribeConfig = null;\n    }\n    if (!currentMac) return;',
    'function listenConfigCollection() {\n    if (unsubscribeConfig) {\n        unsubscribeConfig();\n        unsubscribeConfig = null;\n    }\n    if (!currentMac) return;\n    if (modoConexion === "BLE") return;'
)

c = c.replace(
    'function listenProgramasCollection() {\n    if (unsubscribeProgramas) {\n        unsubscribeProgramas();\n        unsubscribeProgramas = null;\n    }\n    if (!currentMac) return;',
    'function listenProgramasCollection() {\n    if (unsubscribeProgramas) {\n        unsubscribeProgramas();\n        unsubscribeProgramas = null;\n    }\n    if (!currentMac) return;\n    if (modoConexion === "BLE") return;'
)

c = c.replace(
    'btnVinculacionBle.onclick = () => {\n        setConexionModo("BLE");\n        startBLEConnection();\n    };',
    'btnVinculacionBle.onclick = () => {\n        setConexionModo("BLE");\n        const auth = document.getElementById("authOverlay");\n        if (auth) auth.style.display = "none";\n        const connect = document.getElementById("connectOverlay");\n        if (connect) connect.style.display = "flex";\n    };'
)

with open('app/app.js', 'w', encoding='utf-8') as f:
    f.write(c)
