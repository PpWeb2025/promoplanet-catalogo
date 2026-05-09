"""
corregir_nombres_local.py
Replica la lógica del Apps Script "CORRECTOR DE NOMBRES — PromoPlanet v2"
pero para archivos locales en tu PC.

Uso:
    python corregir_nombres_local.py --carpeta "C:\\ruta\\a\\imagenes"

    # Solo ver qué cambiaría (sin renombrar):
    python corregir_nombres_local.py --carpeta "C:\\ruta\\a\\imagenes" --simular

Requisitos: Python 3.x (sin dependencias externas)
"""

import os
import re
import argparse

# ============================================================
# REEMPLAZOS EXACTOS (se aplican al inicio del nombre)
# ============================================================
REEMPLAZOS_EXACTOS = [
    # Bolígrafos
    (re.compile(r'^Bolígrafo Eco\b'),                     'Bolígrafo Ecológico'),
    (re.compile(r'^Bolígrafo Metal\b'),                   'Bolígrafo Metálico'),
    (re.compile(r'^Boligrafo Eco\b'),                     'Bolígrafo Ecológico'),
    (re.compile(r'^Boligrafo Metal\b'),                   'Bolígrafo Metálico'),
    (re.compile(r'^Boligrafo Metalico\b'),                'Bolígrafo Metálico'),
    (re.compile(r'^Boligrafo Plastico\b'),                'Bolígrafo Plástico'),
    (re.compile(r'^Boligrafo\b(?! (Eco|Metal|Metálico|Plástico|Plastico|PM))'), 'Bolígrafo Plástico'),
    (re.compile(r'^Bolígrafo\b(?! (Eco|Ecológico|Metal|Metálico|Plástico|PM))'), 'Bolígrafo Plástico'),

    # Auriculares
    (re.compile(r'^Auricular Bluetooth\b'),               'Auriculares'),
    (re.compile(r'^Auriculares BT\b'),                    'Auriculares'),
    (re.compile(r'^Auriculares Inalambricos\b'),          'Auriculares'),
    (re.compile(r'^Auriculares Inalámbricos\b'),          'Auriculares'),
    (re.compile(r'^Auriculares Vincha Jbl\b'),            'Auriculares'),
    (re.compile(r'^Auriculares Vincha JBL\b'),            'Auriculares'),

    # Parlantes
    (re.compile(r'^Parlante JBL Flip 6\b'),               'Parlante'),
    (re.compile(r'^Parlante Portátil JBL Flip7\b'),       'Parlante'),
    (re.compile(r'^Parlante Portátil JBL\b'),             'Parlante'),
    (re.compile(r'^Parlante Portátil Xiaomi\b'),          'Parlante'),
    (re.compile(r'^Parlante Portátil\b'),                 'Parlante'),
    (re.compile(r'^Parlante Smart\b'),                    'Parlante'),

    # Parker
    (re.compile(r'^Parker Jotter Original\b(?!s)'),       'Parker Jotter Originals'),

    # Mayúsculas y tildes
    (re.compile(r'^Bolso ejecutivo\b'),                   'Bolso Ejecutivo'),
    (re.compile(r'^Jarro térmico\b'),                     'Jarro Térmico'),
    (re.compile(r'^Vaso térmico\b'),                      'Vaso Térmico'),
    (re.compile(r'^Mate autocebante\b'),                  'Mate Autocebante'),
    (re.compile(r'^necessaire\b'),                        'Necessaire'),
    (re.compile(r'^Power bank\b'),                        'Power Bank'),
    (re.compile(r'^Set Lapices\b'),                       'Set Lápices'),
    (re.compile(r'^Lapices PMG'),                         'Lápices PMG'),
    (re.compile(r'^Lapices cortos\b'),                    'Lápices Cortos'),
    (re.compile(r'^Set Parrilllero\b'),                   'Set Parrillero'),
    (re.compile(r'^termo metálico\b'),                    'Termo Metálico'),
    (re.compile(r'^Kit preescolar\b'),                    'Kit Preescolar'),
    (re.compile(r'^Set dibujo\b'),                        'Set Dibujo'),
    (re.compile(r'^Set resaltadores\b'),                  'Set Resaltadores'),
    (re.compile(r'^Taza termica\b'),                      'Taza Térmica'),
]

# ============================================================
# CORRECCIONES GENERALES DE TILDES
# ============================================================
CORRECCIONES_TILDES = [
    (re.compile(r'\bTermica\b'),      'Térmica'),
    (re.compile(r'\btermico\b'),      'térmico'),
    (re.compile(r'\bTermico\b'),      'Térmico'),
    (re.compile(r'\bBoligrafo\b'),    'Bolígrafo'),
    (re.compile(r'\bBoligrafos\b'),   'Bolígrafos'),
    (re.compile(r'\bLapiz\b'),        'Lápiz'),
    (re.compile(r'\blapiz\b'),        'lápiz'),
    (re.compile(r'\bMetalico\b'),     'Metálico'),
    (re.compile(r'\bmetalico\b'),     'metálico'),
    (re.compile(r'\bMetalica\b'),     'Metálica'),
    (re.compile(r'\bPlastico\b'),     'Plástico'),
    (re.compile(r'\bplastico\b'),     'plástico'),
    (re.compile(r'\bEcologico\b'),    'Ecológico'),
    (re.compile(r'\becologico\b'),    'ecológico'),
    (re.compile(r'\bEcologica\b'),    'Ecológica'),
    (re.compile(r'\bAcrilico\b'),     'Acrílico'),
    (re.compile(r'\bCeramica\b'),     'Cerámica'),
    (re.compile(r'\bceramica\b'),     'cerámica'),
    (re.compile(r'\bPortatil\b'),     'Portátil'),
    (re.compile(r'\bportatil\b'),     'portátil'),
    (re.compile(r'\bMovil\b'),        'Móvil'),
    (re.compile(r'\bInalambricas\b'), 'Inalámbricas'),
    (re.compile(r'\bTraslucido\b'),   'Traslúcido'),
    (re.compile(r'\btraslucido\b'),   'traslúcido'),
]


def aplicar_correcciones(nombre):
    ext_match = re.search(r'\.[^.]+$', nombre)
    ext = ext_match.group(0) if ext_match else ''
    sin_ext = nombre[:len(nombre) - len(ext)] if ext else nombre

    # 1. Reemplazos exactos (solo el primero que matchee)
    for patron, reemplazo in REEMPLAZOS_EXACTOS:
        if patron.search(sin_ext):
            sin_ext = patron.sub(reemplazo, sin_ext, count=1)
            break

    # 2. Correcciones generales de tildes
    for patron, reemplazo in CORRECCIONES_TILDES:
        sin_ext = patron.sub(reemplazo, sin_ext)

    return sin_ext + ext


def procesar_carpeta(carpeta, simular=False):
    cambios = []
    for raiz, dirs, archivos in os.walk(carpeta):
        for nombre in archivos:
            nombre_corregido = aplicar_correcciones(nombre)
            if nombre != nombre_corregido:
                ruta_original = os.path.join(raiz, nombre)
                ruta_nueva = os.path.join(raiz, nombre_corregido)
                if simular:
                    print(f'  "{nombre}" → "{nombre_corregido}"')
                else:
                    os.rename(ruta_original, ruta_nueva)
                    print(f'✅ "{nombre}" → "{nombre_corregido}"')
                cambios.append((nombre, nombre_corregido))
    return cambios


def main():
    parser = argparse.ArgumentParser(description='Corrector de nombres PromoPlanet — versión local')
    parser.add_argument('--carpeta', required=True, help='Carpeta con las imágenes a corregir')
    parser.add_argument('--simular', action='store_true', help='Solo muestra los cambios sin renombrar')
    args = parser.parse_args()

    if not os.path.isdir(args.carpeta):
        print(f'Error: la carpeta no existe: {args.carpeta}')
        return

    if args.simular:
        print('SIMULACIÓN — cambios que se aplicarían:\n')
    else:
        print('Aplicando correcciones...\n')

    cambios = procesar_carpeta(args.carpeta, simular=args.simular)

    print()
    if args.simular:
        print(f'Total: {len(cambios)} archivos se renombrarían.')
    else:
        print(f'Listo. {len(cambios)} archivos renombrados.')


if __name__ == '__main__':
    main()
