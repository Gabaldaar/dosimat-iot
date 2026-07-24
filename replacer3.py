with open('app/app.js', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace(
    'const docRef = doc(db, "equipos", currentMac, "contactos_soporte");',
    'const docRef = doc(db, "configuracion_global", "contactos_soporte");'
)

c = c.replace(
    'function listenSoporteContactos() {\n    if (!currentMac) return;',
    'function listenSoporteContactos() {'
)

with open('app/app.js', 'w', encoding='utf-8') as f:
    f.write(c)
