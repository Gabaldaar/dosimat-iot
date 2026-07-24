with open('app/app.js', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace('var globalSoporteWsp = "5491136932456";', 'var globalSoporteWsp = "5491153074195";')
c = c.replace('globalSoporteWsp || "5491136932456"', 'globalSoporteWsp || "5491153074195"')
c = c.replace('const docRef = doc(db, "equipos", currentMac, "contactos_soporte");', 'const docRef = doc(db, "configuracion_global", "contactos_soporte");')

with open('app/app.js', 'w', encoding='utf-8') as f:
    f.write(c)
