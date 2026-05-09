# PromoPlanet — Catálogo de Productos Promocionales

## Contexto del proyecto

Empresa de Buenos Aires especializada en productos promocionales corporativos. Este repositorio es el catálogo digital: una SPA (Single Page Application) sin backend que permite explorar productos, filtrarlos y gestionarlos desde un panel de administración.

## Archivos principales

| Archivo | Rol |
|---|---|
| `index.html` | Catálogo público |
| `admin.html` | Panel de administración |
| `server/index.js` | Servidor Express (punto de entrada) |
| `server/db.js` | Base de datos SQLite con sql.js |
| `server/routes/auth.js` | Login / logout / sesión |
| `server/routes/productos.js` | CRUD de productos |
| `server/routes/drive.js` | Integración Google Drive |
| `aplicar_cambios.py` | Script Python para actualizaciones masivas de nomenclatura |

## Stack tecnológico

- **HTML/CSS/JavaScript vanilla** — sin frameworks, sin build tools
- **Backend Node.js + Express** — servidor en `server/`
- **Base de datos SQLite** — `promoplanet.db` vía `sql.js`
- **Autenticación por sesión** — `express-session`, contraseña en `.env`
- **Google Fonts** — DM Sans (variable 300–600), DM Serif Display, DM Mono
- **Correr localmente:** `node server/index.js` → http://localhost:3000

## Diseño visual

- Colores de marca: azul oscuro `#003471`, cian `#00A8B4`
- Variables CSS para theming consistente
- Grid CSS responsivo, mobile-first con `@media` queries
- Nav con glassmorphism (`backdrop-filter: blur(8px)`)

## Categorías y subcategorías

| Categoría | ID | Subcategorías |
|---|---|---|
| Bolsos y Mochilas | `bolsos_mochilas` | Bolsos, Maletines y portfolios, Mochilas, Neceseres y accesorios, Viaje |
| Capacitación y Eventos | `capacitacion` | — |
| Drinkware | `drinkware` | Botellas standard, Botellas térmicas, Tazas mugs y jarros, Termos y mates |
| Eco y Sustentable | `eco` | Bambu y madera, Reciclados, Tote bags y bolsas |
| Escritorio y Oficina | `escritorio` | Cuadernos y agendas, Organizadores |
| Escritura | `escritura` | Bolígrafos ecológicos, Bolígrafos metálicos, Bolígrafos plásticos, Escritura fina, Lápices, Marcadores y resaltadores |
| Fechas Especiales | `fechas` | — |
| Indumentaria Corporativa | `indumentaria` | Abrigos, Camisas, Delantales y pecheras, Gorras, Remeras y chombas |
| Llaveros y Accesorios | `llaveros` | Llaveros de madera, Llaveros metálicos, Llaveros plásticos, Multipropósito |
| Onboarding y Bienvenida | `onboarding` | — |
| Outdoors y Bienestar | `outdoors` | Coolers y loncheras, Cuidado personal, Deporte y fitness, Gastronomía, Paraguas |
| Packaging y Presentación | `packaging` | Bolsas y papel, Cajas |
| Reconocimiento y Premios | `reconocimiento` | — |
| Tecnología | `tecnologia` | Accesorios de escritorio, Accesorios para celular, Audio, Carga y conectividad |

## Catálogo público (`index.html`)

### Filtros disponibles

1. **Categoría** — sidebar con 14 categorías
2. **Búsqueda de texto** — coincidencia parcial case-insensitive sobre nombre, código y descripción
3. **Destinatario** — Colaborador / Cliente / Directivo
4. **Ocasión** — Onboarding / Capacitación / Reconocimiento / Eventos / Fechas especiales
5. **Rango de precio** — Económico / Intermedio / Premium
6. **Técnica de personalización** — Laser, DTF, Tampografía, Bordado, Sublimación, etc.

Todos los filtros son combinables; el resultado se pasa a `renderProductos(visible)`.

## Panel de administración (`admin.html`)

**Acceso:** contraseña configurada en `.env` (`ADMIN_PASSWORD`). Autenticación via API `/api/auth/login`.

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

- **Sin deploy** — el servidor solo corre localmente en `localhost:3000`
- **Importación de Drive** — la ruta `/api/drive` existe; verificar si las llamadas son reales o simuladas
- **Sin almacenamiento de imágenes externo** — las fotos se sirven vía Drive; pendiente evaluar Cloudinary/S3
- **MemoryStore de sesión** — las sesiones se pierden al reiniciar el servidor (aceptable para uso de un solo usuario local)

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
