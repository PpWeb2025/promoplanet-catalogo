"""
generar_descripciones_vision.py
Genera descripciones de productos para el catálogo PromoPlanet
analizando las imágenes reales con visión IA.

Uso:
    python generar_descripciones_vision.py

Archivos necesarios en la misma carpeta:
    - api_key.txt

El resultado se guarda en: descripciones_vision.csv
Si se interrumpe, al volver a correr retoma desde donde quedó.
"""

import anthropic
import base64
import csv
import time
import re
import json
from pathlib import Path

CARPETA        = Path(__file__).parent
CARPETA_IMGS   = Path(r"C:\Users\Gilda\Documents\imagenes_pp2")
ARCHIVO_KEY    = CARPETA / "api_key.txt"
ARCHIVO_SALIDA = CARPETA / "descripciones_vision.csv"

EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}

# Solo procesar la imagen principal de cada producto (sin variantes a/b/c/d)
# Se considera principal: sin sufijo de letra, o la variante "a" si no hay principal
PROMPT_SISTEMA = """Sos un redactor de catálogos para PromoPlanet, empresa argentina de regalos corporativos y productos promocionales.

Analizás imágenes de productos y generás fichas para el catálogo.

Reglas de redacción estrictas:
- Tono objetivo y descriptivo
- Cada oración en su propia línea (separadas con \\n)
- Comienza con artículo (El, La, Los, Las, Un, Una)
- Sin dirigirse al lector
- Sin frases como "elegancia y funcionalidad", sin entusiasmo
- Sin mencionar personalización, logos ni marcas de empresas
- Mencioná material, capacidad, cierre, colores disponibles si son visibles
- Si el producto parece eco-friendly o sustentable, mencionarlo
- Entre 3 y 5 oraciones
- Lenguaje rioplatense (talle en vez de talla, etc.)
- Respondé SOLO con JSON válido, sin texto adicional ni backticks"""

def leer_key():
    if not ARCHIVO_KEY.exists():
        raise FileNotFoundError(f"No se encontró: {ARCHIVO_KEY}")
    key = ARCHIVO_KEY.read_text(encoding="utf-8").strip()
    if not key.startswith("sk-"):
        raise ValueError("API key inválida.")
    return key

def extraer_codigo(nombre):
    match = re.search(r'PP-?\d+', nombre, re.IGNORECASE)
    return match.group(0).upper().replace("-", "") if match else ""

def es_imagen_principal(path):
    """Devuelve True si es la imagen principal del producto (sin variante o variante 'a')"""
    nombre = path.stem  # sin extensión
    # Patrones: "Producto PP123.png" o "Producto PP123 a.png"
    # No queremos: "Producto PP123 b.png", "Producto PP123 c.png", etc.
    if re.search(r'\s[b-z]$', nombre, re.IGNORECASE):
        return False
    return True

def imagen_a_base64(path):
    with open(path, "rb") as f:
        data = f.read()
    ext = path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(ext, "image/jpeg")
    return base64.standard_b64encode(data).decode("utf-8"), mime

def nombre_limpio(path):
    """Extrae el nombre del producto sin código PP ni variante"""
    nombre = path.stem
    nombre = re.sub(r'\s*PP-?\d+.*$', '', nombre, flags=re.IGNORECASE).strip()
    return nombre

def generar_descripcion(cliente, path):
    nombre = nombre_limpio(path)
    codigo = extraer_codigo(path.stem)
    
    img_b64, mime = imagen_a_base64(path)
    
    prompt = f"""Producto: {nombre}
Código: {codigo}

Analizá esta imagen y generá la ficha del producto.

Respondé SOLO con este JSON (sin backticks ni texto extra):
{{"nombre": "nombre para el catálogo", "descripcion": "oración 1.\\noración 2.\\noración 3."}}"""

    mensaje = cliente.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        system=PROMPT_SISTEMA,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime,
                        "data": img_b64
                    }
                },
                {"type": "text", "text": prompt}
            ]
        }]
    )
    
    texto = mensaje.content[0].text.strip()
    texto = texto.replace("```json", "").replace("```", "").strip()
    datos = json.loads(texto)
    return datos.get("nombre", nombre), datos.get("descripcion", "")

def main():
    print("Generador de descripciones con visión — PromoPlanet")
    print("=" * 50)

    try:
        api_key = leer_key()
        print("API key cargada.")
    except Exception as e:
        print(f"Error: {e}")
        return

    if not CARPETA_IMGS.exists():
        print(f"No se encontró la carpeta de imágenes: {CARPETA_IMGS}")
        return

    # Recopilar imágenes principales
    todas = [
        p for p in CARPETA_IMGS.rglob("*")
        if p.suffix.lower() in EXTENSIONES and es_imagen_principal(p)
    ]
    todas.sort(key=lambda p: p.stem)
    print(f"{len(todas)} imágenes principales encontradas.")

    # Retomar desde donde quedó
    procesados = set()
    if ARCHIVO_SALIDA.exists():
        with open(ARCHIVO_SALIDA, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                procesados.add(row["archivo"])
        print(f"Ya procesados: {len(procesados)} — retomando.")

    pendientes = [p for p in todas if p.name not in procesados]
    total = len(pendientes)
    print(f"Pendientes: {total}\n")

    cliente = anthropic.Anthropic(api_key=api_key)
    modo = "a" if procesados else "w"

    with open(ARCHIVO_SALIDA, modo, newline="", encoding="utf-8") as f:
        campos = ["archivo", "codigo", "nombre_catalogo", "descripcion"]
        writer = csv.DictWriter(f, fieldnames=campos)
        if not procesados:
            writer.writeheader()

        for i, path in enumerate(pendientes, 1):
            codigo = extraer_codigo(path.stem)
            print(f"[{i}/{total}] {path.name}...", end=" ", flush=True)
            try:
                nombre_cat, descripcion = generar_descripcion(cliente, path)
                writer.writerow({
                    "archivo": path.name,
                    "codigo": codigo,
                    "nombre_catalogo": nombre_cat,
                    "descripcion": descripcion
                })
                f.flush()
                print("OK")
            except json.JSONDecodeError:
                print("ERROR (respuesta inválida)")
            except Exception as e:
                print(f"ERROR: {e}")

            # Pausa para no saturar la API
            if i % 10 == 0:
                print("  Pausa breve...")
                time.sleep(3)
            else:
                time.sleep(0.8)

    print(f"\nListo. Resultado en: {ARCHIVO_SALIDA}")

if __name__ == "__main__":
    main()
