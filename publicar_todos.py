#!/usr/bin/env python3
"""
publicar_todos.py
Publica todos los productos en estado borrador en promoplanet.db.

Uso:
    python publicar_todos.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "promoplanet.db"

conn = sqlite3.connect(str(DB_PATH))
cur = conn.execute("UPDATE productos SET estado = 'publicado' WHERE estado = 'borrador'")
conn.commit()
print(f"Publicados: {cur.rowcount} productos.")
conn.close()
