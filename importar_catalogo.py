#!/usr/bin/env python3
"""
importar_catalogo.py  —  v2
Lee la estructura de Google Drive, cruza con el CSV de descripciones,
e inserta los productos en promoplanet.db usando el esquema de tres dimensiones:

  categoria   → qué ES el producto      (una sola, obligatoria)
  ocasiones   → para qué SIRVE          (array, puede acumularse desde varias carpetas)
  tags        → atributos transversales  (array: "eco", "destacado", etc.)

Si un producto aparece en una carpeta de ocasión o tag pero no en ninguna carpeta
de categoría real, queda con categoria = "sin_clasificar" para revisión en el admin.

Uso:
    python importar_catalogo.py

Archivos necesarios:
    - descripciones_final_v2.csv
    - promoplanet.db  (ya migrado con migrar_schema.py)
    - service-account.json
"""

import csv
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

# ── Configuración ──────────────────────────────────────────────────────────────

CARPETA         = Path(__file__).parent
CSV_PATH        = CARPETA / "descripciones_final_v2.csv"
DB_PATH         = CARPETA / "promoplanet.db"
SERVICE_ACCOUNT = CARPETA / "service-account.json"

DRIVE_FOLDER_ID = "1fDSb1pNQXwg28kCC8s3AKBuVQkR92Bhc"

CARPETAS_IGNORAR = {"entrada", "sin categoria", "sin categoría"}

ESTADO_DEFAULT = "borrador"

# ── Dimensión 1: qué ES el producto ───────────────────────────────────────────
# Carpetas de Drive que representan el tipo de producto.
# Un producto tiene exactamente UNA categoría.

CATEGORIA_IDS = {
    "Bolsos y Mochilas":        "bolsos_mochilas",
    "Drinkware":                "drinkware",
    "Escritorio y Oficina":     "escritorio",
    "Escritura":                "escritura",
    "Indumentaria Corporativa": "indumentaria",
    "Llaveros y Accesorios":    "llaveros",
    "Outdoors y Bienestar":     "outdoors",
    "Packaging y Presentación": "packaging",
    "Tecnología":               "tecnologia",
}

# ── Dimensión 2: para qué SIRVE ───────────────────────────────────────────────
# Carpetas de Drive que representan ocasiones o usos.
# Un producto puede tener varias ocasiones.
# En el frontend se muestran como filtros cruzados, no como categorías del sidebar.

OCASION_IDS = {
    "Capacitación y Eventos":   "capacitacion",
    "Fechas Especiales":        "fechas",
    "Onboarding y Bienvenida":  "onboarding",
    "Reconocimiento y Premios": "reconocimiento",
}

# ── Dimensión 3: atributos transversales ──────────────────────────────────────
# Carpetas de Drive que representan propiedades que cruzan todas las categorías.
# Un producto puede tener varios tags.

TAG_IDS = {
    "Eco y Sustentable": "eco",
}

# ── Emojis por categoría real ──────────────────────────────────────────────────

EMOJIS = {
    "drinkware":       "🥤",
    "bolsos_mochilas": "🎒",
    "escritura":       "✏️",
    "escritorio":      "📋",
    "tecnologia":      "💻",
    "indumentaria":    "👕",
    "outdoors":        "⛺",
    "packaging":       "📦",
    "llaveros":        "🔑",
    "sin_clasificar":  "❓",
}

# ── Google Drive ───────────────────────────────────────────────────────────────

def conectar_drive():
    creds = service_account.Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT),
        scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)

def listar_carpetas(drive, parent_id):
    resultado  = []
    page_token = None
    while True:
        resp = drive.files().list(
            q=f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields="nextPageToken, files(id, name)",
            pageToken=page_token
        ).execute()
        resultado.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return resultado

def listar_imagenes(drive, folder_id):
    resultado  = []
    page_token = None
    while True:
        resp = drive.files().list(
            q=f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false",
            fields="nextPageToken, files(id, name)",
            pageToken=page_token
        ).execute()
        resultado.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return resultado

def extraer_codigo(nombre_archivo):
    m = re.search(r'PP(\d+)', nombre_archivo, re.IGNORECASE)
    return f"PP{m.group(1)}" if m else None

def es_imagen_principal(nombre):
    stem = Path(nombre).stem
    return not bool(re.search(r'\s[b-z]$', stem, re.IGNORECASE))

# ── CSV ────────────────────────────────────────────────────────────────────────

def cargar_descripciones():
    datos = {}
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            datos[row["codigo"]] = row
    return datos

# ── Base de datos ──────────────────────────────────────────────────────────────

def conectar_db():
    return sqlite3.connect(str(DB_PATH))

def codigo_existe(conn, codigo):
    cur = conn.execute("SELECT id FROM productos WHERE codigo = ?", (codigo,))
    return cur.fetchone() is not None

def insertar_producto(conn, producto):
    conn.execute("""
        INSERT INTO productos (
            codigo, nombre, categoria, subcategoria, rango, minimo,
            material, medidas, colores, descripcion,
            tecnicas, destinatarios, ocasiones, tags,
            proveedor, notas, drive_code, estado,
            fecha_carga, emoji, badge, fotos
        ) VALUES (
            :codigo, :nombre, :categoria, :subcategoria, :rango, :minimo,
            :material, :medidas, :colores, :descripcion,
            :tecnicas, :destinatarios, :ocasiones, :tags,
            :proveedor, :notas, :drive_code, :estado,
            :fecha_carga, :emoji, :badge, :fotos
        )
    """, producto)
    conn.commit()

# ── Recorrido de Drive ─────────────────────────────────────────────────────────

def recorrer_drive(drive):
    """
    Recorre todas las carpetas de Drive y construye un dict de productos.
    Cada producto acumula su categoría real, sus ocasiones y sus tags
    a medida que aparece en distintas carpetas.
    """
    productos       = {}
    carpetas_raiz   = listar_carpetas(drive, DRIVE_FOLDER_ID)

    for cat_folder in carpetas_raiz:
        cat_nombre = cat_folder["name"]

        if cat_nombre.lower() in CARPETAS_IGNORAR:
            continue

        cat_id     = CATEGORIA_IDS.get(cat_nombre)
        ocasion_id = OCASION_IDS.get(cat_nombre)
        tag_id     = TAG_IDS.get(cat_nombre)

        if cat_id:
            tipo = "categoria"
        elif ocasion_id:
            tipo = "ocasion"
        elif tag_id:
            tipo = "tag"
        else:
            print(f"  ⚠ Carpeta no mapeada: '{cat_nombre}'")
            continue

        etiqueta = {"categoria": "Categoría", "ocasion": "Ocasión", "tag": "Tag"}[tipo]
        print(f"  {etiqueta}: {cat_nombre}")

        subcarpetas = listar_carpetas(drive, cat_folder["id"])
        if not subcarpetas:
            subcarpetas = [{"id": cat_folder["id"], "name": ""}]

        for sub_folder in subcarpetas:
            sub_nombre = sub_folder["name"]
            imagenes   = listar_imagenes(drive, sub_folder["id"])

            for img in imagenes:
                codigo = extraer_codigo(img["name"])
                if not codigo:
                    continue

                if codigo not in productos:
                    productos[codigo] = {
                        "categoria":    None,
                        "subcategoria": "",
                        "ocasiones":    [],
                        "tags":         [],
                        "fotos":        [],
                    }

                p = productos[codigo]

                # Categoría: se asigna con la primera carpeta de tipo "categoria" que se encuentre.
                # Si el mismo código aparece en varias categorías reales, prevalece la primera.
                if tipo == "categoria":
                    if p["categoria"] is None:
                        p["categoria"]    = cat_id
                        p["subcategoria"] = sub_nombre

                elif tipo == "ocasion":
                    if ocasion_id not in p["ocasiones"]:
                        p["ocasiones"].append(ocasion_id)

                elif tipo == "tag":
                    if tag_id not in p["tags"]:
                        p["tags"].append(tag_id)

                # Fotos: se acumulan sin duplicados por id
                if not any(f["id"] == img["id"] for f in p["fotos"]):
                    principal = es_imagen_principal(img["name"])
                    p["fotos"].append({"id": img["id"], "nombre": img["name"], "principal": principal})

    # Productos que no aparecieron en ninguna carpeta de categoría real
    for codigo, p in productos.items():
        if p["categoria"] is None:
            p["categoria"] = "sin_clasificar"

    return productos

# ── Importación principal ──────────────────────────────────────────────────────

def main():
    print("Importador de catálogo PromoPlanet  —  v2")
    print("=" * 42)

    if not CSV_PATH.exists():
        print(f"Error: no se encontró {CSV_PATH}")
        return

    descripciones = cargar_descripciones()
    print(f"{len(descripciones)} descripciones cargadas desde CSV.")

    print("\nConectando a Google Drive...")
    drive = conectar_drive()
    print("Recorriendo carpetas de Drive...")
    productos_drive = recorrer_drive(drive)
    print(f"{len(productos_drive)} productos encontrados en Drive.")

    conn   = conectar_db()
    ahora  = datetime.now().isoformat()

    insertados       = 0
    omitidos         = 0
    sin_descripcion  = []
    sin_clasificar   = []

    print("\nImportando productos...")
    for codigo, info in sorted(productos_drive.items()):
        if codigo_existe(conn, codigo):
            omitidos += 1
            continue

        desc      = descripciones.get(codigo, {})
        nombre    = desc.get("nombre_catalogo") or codigo
        descripcion = desc.get("descripcion", "")

        if not desc:
            sin_descripcion.append(codigo)

        if info["categoria"] == "sin_clasificar":
            sin_clasificar.append(codigo)

        fotos = sorted(
            info["fotos"],
            key=lambda f: (0 if f["principal"] else 1, f["nombre"])
        )
        fotos_json = json.dumps([f["id"] for f in fotos])
        drive_code = fotos[0]["id"] if fotos else ""

        producto = {
            "codigo":        codigo,
            "nombre":        nombre,
            "categoria":     info["categoria"],
            "subcategoria":  info["subcategoria"],
            "rango":         "intermedio",
            "minimo":        50,
            "material":      "",
            "medidas":       "",
            "colores":       "",
            "descripcion":   descripcion,
            "tecnicas":      "[]",
            "destinatarios": "[]",
            "ocasiones":     json.dumps(info["ocasiones"]),
            "tags":          json.dumps(info["tags"]),
            "proveedor":     "",
            "notas":         "",
            "drive_code":    drive_code,
            "estado":        ESTADO_DEFAULT,
            "fecha_carga":   ahora,
            "emoji":         EMOJIS.get(info["categoria"], "📦"),
            "badge":         "ECO" if "eco" in info["tags"] else "",
            "fotos":         fotos_json,
        }

        insertar_producto(conn, producto)
        ocasiones_str = ", ".join(info["ocasiones"]) if info["ocasiones"] else ""
        tags_str      = ", ".join(info["tags"])      if info["tags"]      else ""
        extras        = " | ".join(filter(None, [ocasiones_str, tags_str]))
        sufijo        = f"  [{extras}]" if extras else ""
        print(f"  ✅ {codigo} — {nombre}{sufijo}")
        insertados += 1

    conn.close()

    print(f"\n{'='*42}")
    print(f"Insertados:                  {insertados}")
    print(f"Omitidos (ya existían):      {omitidos}")

    if sin_descripcion:
        print(f"Sin descripción en CSV:      {len(sin_descripcion)}")
        for c in sin_descripcion:
            print(f"   - {c}")

    if sin_clasificar:
        print(f"Sin categoría real:          {len(sin_clasificar)}")
        print("  Estos productos solo aparecen en carpetas de ocasión o tag.")
        print("  Revisalos en el admin y asigná su categoría.")
        for c in sin_clasificar:
            print(f"   - {c}")

    print("\nListo. Abrí el admin para revisar y publicar los productos.")


if __name__ == "__main__":
    main()
