#!/usr/bin/env python3
"""
Aplica los cambios de nomenclatura PP-XXXX en admin.html.
Uso: python3 aplicar_cambios.py
Requiere que admin.html esté en la misma carpeta.
"""

with open('admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

cambios = 0

# 1. extraerCodigo — nueva regex PP-XXXX
old1 = """function extraerCodigo(nombre) {
  const m = nombre.match(/([A-Z]{1,3}\\d{3,4}[A-Z]?)/);
  return m ? m[1] : null;
}"""
new1 = """function extraerCodigo(nombre) {
  const m = nombre.match(/PP-?(\\d{4})/i);
  return m ? `PP-${m[1]}` : null;
}"""
if old1 in content:
    content = content.replace(old1, new1)
    cambios += 1
    print("✓ extraerCodigo actualizado")
else:
    print("✗ extraerCodigo — no encontrado (verificar indentación)")

# 2. DEMO_ARCHIVOS — códigos PP-XXXX
old2 = """const DEMO_ARCHIVOS = [
  'Jarro Térmico G1603 a.jpg','Jarro Térmico G1603 b.jpg','Jarro Térmico G1603 c.png',
  'Mochila Ejecutiva M220 a.jpg','Mochila Ejecutiva M220 b.jpg',
  'Botella Deportiva BT560 a.png','Botella Deportiva BT560 b.png','Botella Deportiva BT560 c.jpg',
  'Termo Acero TE220 a.jpg','Termo Acero TE220 b.jpg',
  'Cuaderno Anillado NB500 a.jpg','Cuaderno Anillado NB500 b.jpg','Cuaderno Anillado NB500 c.jpg',
  'Lapicera Metálica LP200 a.jpg','Lapicera Metálica LP200 b.jpg',
  'Taza Cerámica TZ380 a.png','Taza Cerámica TZ380 b.jpg',
  'Auriculares BT AU890 a.jpg','Auriculares BT AU890 b.png',
  'Bolso Térmico EC450 a.jpg',
];"""
new2 = """const DEMO_ARCHIVOS = [
  'Jarro Térmico PP-0001 a.jpg','Jarro Térmico PP-0001 b.jpg','Jarro Térmico PP-0001 c.png',
  'Mochila Ejecutiva PP-0002 a.jpg','Mochila Ejecutiva PP-0002 b.jpg',
  'Botella Deportiva PP-0003 a.png','Botella Deportiva PP-0003 b.png','Botella Deportiva PP-0003 c.jpg',
  'Termo Acero PP-0004 a.jpg','Termo Acero PP-0004 b.jpg',
  'Cuaderno Anillado PP-0005 a.jpg','Cuaderno Anillado PP-0005 b.jpg','Cuaderno Anillado PP-0005 c.jpg',
  'Lapicera Metálica PP-0006 a.jpg','Lapicera Metálica PP-0006 b.jpg',
  'Taza Cerámica PP-0007 a.png','Taza Cerámica PP-0007 b.jpg',
  'Auriculares BT PP-0008 a.jpg','Auriculares BT PP-0008 b.png',
  'Bolso Térmico PP-0009 a.jpg',
];"""
if old2 in content:
    content = content.replace(old2, new2)
    cambios += 1
    print("✓ DEMO_ARCHIVOS actualizado")
else:
    print("✗ DEMO_ARCHIVOS — no encontrado")

# 3. Texto descriptivo en sección Importar
old3 = "G1603</code> en <em>Jarro Térmico G1603 a.jpg</em>"
new3 = "PP-0042</code> en <em>Jarro Térmico PP-0042 a.jpg</em>"
if old3 in content:
    content = content.replace(old3, new3)
    cambios += 1
    print("✓ Texto descriptivo actualizado")
else:
    print("✗ Texto descriptivo — no encontrado")

# 4. Placeholder campo Código
old4 = 'placeholder="G1603"'
new4 = 'placeholder="PP-0042"'
if old4 in content:
    content = content.replace(old4, new4)
    cambios += 1
    print("✓ Placeholder código actualizado")
else:
    print("✗ Placeholder código — no encontrado")

# 5. Placeholder campo Drive
old5 = 'placeholder="Código del producto (ej: G1603)'
new5 = 'placeholder="Código del producto (ej: PP-0042)'
if old5 in content:
    content = content.replace(old5, new5)
    cambios += 1
    print("✓ Placeholder Drive actualizado")
else:
    print("✗ Placeholder Drive — no encontrado")

# Guardar resultado
with open('admin.html', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"\n{cambios} cambios aplicados. Archivo guardado.")
