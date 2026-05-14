#!/usr/bin/env python3
"""
importar_catalogo.py
Lee la estructura de Google Drive (categoría/subcategoría/imágenes),
cruza con el CSV de descripciones, e inserta todo en promoplanet.db.

Uso:
    python importar_catalogo.py

Archivos necesarios en la misma carpeta:
    - descripciones_final_v2.csv
    - promoplanet.db
    - service-account.json

Requiere:
    pip install google-api-python-client google-auth
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

CATEGORIA_IDS = {
    "Bolsos y Mochilas":        "bolsos_mochilas",
    "Capacitación y Eventos":   "capacitacion",
    "Drinkware":                "drinkware",
    "Eco y Sustentable":        "eco",
    "Escritorio y Oficina":     "escritorio",
    "Escritura":                "escritura",
    "Fechas Especiales":        "fechas",
    "Indumentaria corporativa": "indumentaria",
    "Llaveros y Accesorios":    "llaveros",
    "Onboarding y Bienvenida":  "onboarding",
    "Outdoors y Bienestar":     "outdoors",
    "Packaging y Presentación": "packaging",
    "Reconocimiento y Premios": "reconocimiento",
    "Tecnología":               "tecnologia",
}

EMOJIS = {
    "drinkware":      "🥤",
    "bolsos_mochilas":"🎒",
    "escritura":      "✏️",
    "escritorio":     "📋",
    "tecnologia":     "💻",
    "indumentaria":   "👕",
    "eco":            "🌿",
    "outdoors":       "⛺",
    "packaging":      "📦",
    "llaveros":       "🔑",
    "fechas":         "🎉",
    "capacitacion":   "📚",
    "onboarding":     "🚀",
    "reconocimiento": "🏆",
}

# ── Google Drive ───────────────────────────────────────────────────────────────

def conectar_drive():
    creds = service_account.Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT),
        scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)

def listar_carpetas(drive, parent_id):
    resultado = []
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
    resultado = []
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
            tecnicas, destinatarios, ocasiones,
            proveedor, notas, drive_code, estado,
            fecha_carga, emoji, badge, fotos
        ) VALUES (
            :codigo, :nombre, :categoria, :subcategoria, :rango, :minimo,
            :material, :medidas, :colores, :descripcion,
            :tecnicas, :destinatarios, :ocasiones,
            :proveedor, :notas, :drive_code, :estado,
            :fecha_carga, :emoji, :badge, :fotos
        )
    """, producto)
    conn.commit()

# ── Importación ────────────────────────────────────────────────────────────────

def recorrer_drive(drive):
    productos = {}
    categorias_drive = listar_carpetas(drive, DRIVE_FOLDER_ID)

    for cat_folder in categorias_drive:
        cat_nombre = cat_folder["name"]
        if cat_nombre.lower() in CARPETAS_IGNORAR:
            continue
        cat_id = CATEGORIA_IDS.get(cat_nombre)
        if not cat_id:
            print(f"  ⚠ Categoría no mapeada: {cat_nombre}")
            continue

        print(f"  Categoría: {cat_nombre}")
        subcarpetas = listar_carpetas(drive, cat_folder["id"])

        if not subcarpetas:
            subcarpetas = [{"id": cat_folder["id"], "name": ""}]

        for sub_folder in subcarpetas:
            sub_nombre = sub_folder["name"]
            imagenes = listar_imagenes(drive, sub_folder["id"])

            for img in imagenes:
                codigo = extraer_codigo(img["name"])
                if not codigo:
                    continue
                principal = es_imagen_principal(img["name"])
                foto = {"id": img["id"], "nombre": img["name"], "principal": principal}

                if codigo not in productos:
                    productos[codigo] = {
                        "categoria":   cat_id,
                        "subcategoria": sub_nombre,
                        "fotos": []
                    }
                productos[codigo]["fotos"].append(foto)

    return productos

def main():
    print("Importador de catálogo PromoPlanet")
    print("=" * 40)

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

    conn = conectar_db()
    ahora = datetime.now().isoformat()

    insertados = 0
    omitidos = 0
    sin_descripcion = []

    print("\nImportando productos...")
    for codigo, info in sorted(productos_drive.items()):
        if codigo_existe(conn, codigo):
            omitidos += 1
            continue

        desc = descripciones.get(codigo, {})
        nombre = desc.get("nombre_catalogo") or codigo
        descripcion = desc.get("descripcion", "")

        if not desc:
            sin_descripcion.append(codigo)

        fotos = sorted(info["fotos"], key=lambda f: (0 if f["principal"] else 1, f["nombre"]))
        fotos_json = json.dumps([{"driveId": f["id"], "nombre": f["nombre"]} for f in fotos])
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
            "ocasiones":     "[]",
            "proveedor":     "",
            "notas":         "",
            "drive_code":    drive_code,
            "estado":        ESTADO_DEFAULT,
            "fecha_carga":   ahora,
            "emoji":         EMOJIS.get(info["categoria"], "📦"),
            "badge":         "",
            "fotos":         fotos_json,
        }

        insertar_producto(conn, producto)
        print(f"  ✅ {codigo} — {nombre}")
        insertados += 1

    conn.close()

    print(f"\n{'='*40}")
    print(f"Insertados:             {insertados}")
    print(f"Omitidos (ya existían): {omitidos}")
    if sin_descripcion:
        print(f"Sin descripción en CSV: {len(sin_descripcion)}")
        for c in sin_descripcion:
            print(f"  - {c}")
    print("\nListo. Abrí el admin para revisar y publicar los productos.")

if __name__ == "__main__":
    main()
