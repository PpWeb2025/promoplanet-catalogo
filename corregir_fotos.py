#!/usr/bin/env python3
"""
corregir_fotos.py
Convierte el campo fotos de [{driveId, nombre}] a [driveId, driveId, ...]
para que el frontend pueda cargar las imágenes desde /api/drive/imagen/:fileId

Uso:
    python corregir_fotos.py

Archivos necesarios en la misma carpeta:
    - promoplanet.db
"""

import json
import sqlite3
from pathlib import Path

CARPETA = Path(__file__).parent
DB_PATH = CARPETA / "promoplanet.db"

def main():
    print("Corrigiendo formato de fotos en promoplanet.db")
    print("=" * 40)

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.execute("SELECT id, codigo, fotos FROM productos")
    rows = cur.fetchall()

    corregidos = 0
    errores = []

    for row_id, codigo, fotos_raw in rows:
        try:
            fotos = json.loads(fotos_raw or "[]")
        except json.JSONDecodeError:
            errores.append(codigo)
            continue

        if not fotos:
            continue

        # Si ya es una lista de strings, no hacer nada
        if isinstance(fotos[0], str):
            continue

        # Convertir de [{driveId, nombre}] a [driveId]
        fotos_corregidas = [f["driveId"] for f in fotos if isinstance(f, dict) and "driveId" in f]
        conn.execute(
            "UPDATE productos SET fotos = ? WHERE id = ?",
            (json.dumps(fotos_corregidas), row_id)
        )
        corregidos += 1

    conn.commit()
    conn.close()

    print(f"Corregidos: {corregidos} productos")
    if errores:
        print(f"Errores: {errores}")
    print("\nListo. Reiniciá el servidor y verificá las imágenes.")

if __name__ == "__main__":
    main()
