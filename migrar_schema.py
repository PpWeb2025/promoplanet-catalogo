#!/usr/bin/env python3
"""
migrar_schema.py
Migra promoplanet.db al nuevo esquema de tres dimensiones:

  categoria  → qué ES el producto      (string, una sola)
  ocasiones  → para qué SIRVE          (JSON array, múltiples)
  tags       → atributos transversales  (JSON array: "eco", "destacado", etc.)

Qué hace este script:
  1. Agrega la columna `tags` si no existe.
  2. Productos con categoria en {onboarding, reconocimiento, capacitacion, fechas}:
       → mueve ese valor al array `ocasiones`
       → pone categoria = "sin_clasificar"  (requieren revisión manual en el admin)
  3. Productos con categoria = "eco":
       → agrega "eco" al array `tags`
       → pone categoria = "sin_clasificar"

Uso:
    python migrar_schema.py

Archivos necesarios:
    - promoplanet.db
"""

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "promoplanet.db"

# Categorías del esquema viejo que eran realmente ocasiones/usos
OCASIONES_LEGACY = {"onboarding", "reconocimiento", "capacitacion", "fechas"}

# Categorías del esquema viejo que eran realmente atributos transversales
TAGS_LEGACY = {"eco"}


def main():
    print("Migración de esquema — PromoPlanet")
    print("=" * 42)

    if not DB_PATH.exists():
        print(f"Error: no se encontró {DB_PATH}")
        return

    conn = sqlite3.connect(str(DB_PATH))

    # ── 1. Agregar columna tags ────────────────────────────────────────────────
    try:
        conn.execute("ALTER TABLE productos ADD COLUMN tags TEXT DEFAULT '[]'")
        conn.commit()
        print("✅  Columna 'tags' agregada.")
    except sqlite3.OperationalError:
        print("⚠   Columna 'tags' ya existía, se omite.")

    # ── 2. Migrar productos mal clasificados ───────────────────────────────────
    cur = conn.execute("SELECT id, codigo, categoria, ocasiones, tags FROM productos")
    rows = cur.fetchall()

    migrados_ocasion = []
    migrados_eco     = []

    for row_id, codigo, categoria, ocasiones_raw, tags_raw in rows:
        ocasiones = json.loads(ocasiones_raw or "[]")
        tags      = json.loads(tags_raw      or "[]")
        nueva_cat = categoria
        changed   = False

        if categoria in OCASIONES_LEGACY:
            if categoria not in ocasiones:
                ocasiones.append(categoria)
            nueva_cat = "sin_clasificar"
            changed   = True
            migrados_ocasion.append(codigo)

        elif categoria in TAGS_LEGACY:
            if "eco" not in tags:
                tags.append("eco")
            nueva_cat = "sin_clasificar"
            changed   = True
            migrados_eco.append(codigo)

        if changed:
            conn.execute(
                "UPDATE productos SET categoria = ?, ocasiones = ?, tags = ? WHERE id = ?",
                (nueva_cat, json.dumps(ocasiones), json.dumps(tags), row_id)
            )

    conn.commit()
    conn.close()

    # ── 3. Resumen ─────────────────────────────────────────────────────────────
    print(f"\nProductos migrados desde ocasiones ({len(migrados_ocasion)}):")
    for c in migrados_ocasion:
        print(f"   - {c}")

    print(f"\nProductos migrados desde eco ({len(migrados_eco)}):")
    for c in migrados_eco:
        print(f"   - {c}")

    total = len(migrados_ocasion) + len(migrados_eco)
    if total:
        print(f"\n→ {total} productos quedaron con categoria = 'sin_clasificar'.")
        print("  Abrí el admin, filtrá por esa categoría y asigná la real a cada uno.")
    else:
        print("\nNo había productos para migrar.")

    print("\nListo.")


if __name__ == "__main__":
    main()
