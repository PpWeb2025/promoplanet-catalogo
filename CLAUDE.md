# PromoPlanet — Catálogo de Productos Promocionales

## Contexto del proyecto

Empresa de Buenos Aires especializada en productos promocionales corporativos. Este repositorio es el catálogo digital: una SPA (Single Page Application) sin backend que permite explorar productos, filtrarlos y gestionarlos desde un panel de administración.

## Archivos principales

| Archivo | Rol |
|---|---|
| `index.html` | Catálogo público (~1 072 líneas) |
| `admin.html` | Panel de administración (~1 171 líneas) |
| `aplicar_cambios.py` | Script Python para actualizaciones masivas de nomenclatura |

## Stack tecnológico

- **100% HTML/CSS/JavaScript vanilla** — sin frameworks, sin npm, sin build tools
- **Sin backend** — toda la persistencia usa `localStorage` (clave `pp_productos`, JSON)
- **Sin base de datos** — los datos solo existen en el navegador donde se cargaron
- **Google Fonts** — DM Sans (variable 300–600), DM Serif Display, DM Mono
- **No hay dependencias externas** — corre directo en el navegador

## Diseño visual

- Colores de marca: azul oscuro `#003471`, cian `#00A8B4`
- Variables CSS para theming consistente
- Grid CSS responsivo, mobile-first con `@media` queries
- Nav con glassmorphism (`backdrop-filter: blur(8px)`)

## Catálogo público (`index.html`)

### Filtros disponibles

1. **Categoría** — tabs superiores, 12 categorías (Onboarding, Drinkware, Reconocimiento, etc.)
2. **Búsqueda de texto** — coincidencia parcial case-insensitive sobre nombre, código y descripción
3. **Destinatario** — Colaborador / Cliente / Directivo
4. **Ocasión** — Onboarding / Capacitación / Reconocimiento / Eventos / Fechas especiales
5. **Rango de precio** — Económico / Intermedio / Premium
6. **Técnica de personalización** — Laser, DTF, Tampografía, Bordado, Sublimación, etc.

Todos los filtros son combinables; el resultado se pasa a `renderProductos(visible)`.

## Panel de administración (`admin.html`)

**Acceso:** contraseña hardcodeada como `promoplanet2026` (línea ~662). Muestra/oculta `.login-screen` y `.app.visible`.

### Secciones

- **Dashboard** — estadísticas (total, publicados, borradores, categorías), tabla de productos recientes, acceso rápido a importación desde Drive
- **Productos** — tabla con búsqueda, filtro de categoría y estado, botones editar/eliminar/publicar
- **Importar de Drive** — UI para pegar una URL de carpeta de Google Drive; la importación actual es **simulada/demo** (no hay llamadas reales a la API de Drive)
- **Categorías** — listado con conteo de productos por categoría
- **Exportar datos** — descarga JSON del catálogo completo o CSV de la lista de productos

### Modal de producto

Formulario con 25+ campos: código (`PP-XXXX`), nombre, categoría, rango de precio, cantidad mínima, material, medidas, colores, descripción, técnicas (checkboxes), destinatarios, ocasiones, imagen y código de Drive para importación por lote.

## Imágenes y Google Drive

- La integración con Google Drive **no está implementada** — el formulario de URL existe pero `simularImport()` usa datos hardcodeados de `DEMO_ARCHIVOS`
- La función `extraerCodigo()` parsea nombres de archivo con regex `/([A-Z]{1,3}\d{3,4}[A-Z]?)/` (ej: `G1603`, `M220`)
- El script `aplicar_cambios.py` migra la nomenclatura a formato `PP-XXXX`
- Para producción se necesitaría implementar OAuth + Google Drive API

## Nomenclatura de productos

Formato objetivo: `PP-XXXX` (ej: `PP-1234`). El script Python `aplicar_cambios.py` realiza actualizaciones masivas de códigos en lote.

## Limitaciones actuales (pendientes para producción)

- **Sin persistencia multi-dispositivo** — datos aislados en un navegador
- **Contraseña hardcodeada** — no apta para producción
- **Sin autenticación real** — cualquiera con la URL accede al admin
- **Importación de Drive simulada** — requiere implementar Google Drive API + OAuth
- **Sin almacenamiento de imágenes** — pendiente integrar Cloudinary, S3 o similar
- **Sin backend** — para multi-usuario se necesitaría Node/Express, Python/Flask u otro

## Comandos útiles

```bash
# Abrir catálogo en el navegador (no requiere servidor)
open index.html

# Abrir panel de admin
open admin.html

# Ejecutar script de actualización de nomenclatura
python aplicar_cambios.py
```

> No hay servidor de desarrollo ni proceso de build. Cualquier cambio en los `.html` se refleja al recargar el navegador.
