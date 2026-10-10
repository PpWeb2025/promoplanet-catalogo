# PromoPlanet — Catálogo de Productos Promocionales

Última actualización: 10/10/2026. Lo marcado como (verificado) se comprobó leyendo `index.html` y `clientes.html`. El resto viene de lo ya documentado del proyecto; ante una duda sobre `server/`, revisar el código antes de asumir.

## Contexto del proyecto

PromoPlanet (promoplanet.ar) es una empresa de Buenos Aires que vende productos promocionales y regalos corporativos a empresas. Los clientes son sobre todo áreas de RR. HH. y Marketing que compran para onboarding, reconocimientos, capacitaciones y fechas especiales.

Este repositorio es el catálogo web y el generador de propuestas comerciales. No es una SPA sin backend: tiene servidor propio y base de datos remota.

## Stack e infraestructura

- Frontend: HTML, CSS y JavaScript vanilla, sin frameworks ni build (verificado). Las páginas son `index.html`, `clientes.html`, `admin.html`, `propuesta.html` y `propuestas.html`.
- Backend: Node.js + Express en `server/` (punto de entrada `server/index.js`).
- Base de datos: Turso (libSQL), base `promoplanet`. La base local `promoplanet.db` es de la etapa anterior, con SQLite, y no es la de producción.
- Imágenes: Google Drive, servidas por un proxy en `/api/drive/imagen/:fileId` con Sharp (anchos permitidos 200, 400, 800 y 1200; salida WebP o JPEG con `?fmt=`). Cloudinary se abandonó.
- Hosting: Render (servicio `srv-d7vjdi3rjlhs73dq8j2g`). Dominio `promoplanet.ar` detrás de Cloudflare.
- Descripciones de producto: generadas con Gemini (modelo configurable con la variable `GEMINI_MODEL`).
- Newsletter: Brevo (la clave está en las variables de entorno de Render).
- Repositorio: GitHub `PpWeb2025/promoplanet-catalogo`, rama `main`.

## Archivos principales

| Archivo | Rol |
|---|---|
| `index.html` | Catálogo público (HTML, CSS y JS en un solo archivo) |
| `badges.js` | Definición de insignias (`BADGES`), cargada desde la raíz del sitio |
| `clientes.html` | Página `/clientes` con la grilla de logos de clientes |
| `admin.html` | Panel de administración |
| `propuesta.html`, `propuestas.html` | Generador y listado de propuestas comerciales |
| `server/` | Servidor Express, rutas y acceso a la base |
| `logos-clientes/` | Logos de clientes y `clientes.json` |
| `firma/` | Firmas HTML de los mails, con imágenes alojadas en `promoplanet.ar/firma/` |

## Archivos con claves: no abrir ni pegar su contenido

`.env`, `service-account.json`, `api_key.txt`, `Brevo Api.txt` y `turso token.txt` contienen credenciales. No se leen, no se copian a otras carpetas y no se muestran en ninguna respuesta. Si hace falta saber si un archivo contiene claves, usar `grep -c` y mostrar solo el número.

## Catálogo público (`index.html`)

Todo se verificó en el código.

- Categorías (11): `bienestar`, `bolsos_mochilas`, `drinkware`, `escritorio`, `escritura`, `hogar`, `indumentaria`, `llaveros`, `outdoors`, `packaging`, `tecnologia`. Están definidas en `CATEGORIAS`, `CAT_NAMES` y `SUBCATS`.
- Páginas SEO: `/categoria/:slug` (slugs en `CAT_LANDING_SLUGS`), `/ocasion/:slug` (slugs en `OCC_LANDING_SLUGS`), `/sustentable` y `/clientes`.
- Filtros del lateral: Categoría y subcategoría, Eco / Sustentable, Ocasión (evento, fechas, onboarding, capacitacion), Destinatario (colaborador, cliente, directivo) y Marca. Hay un buscador de texto fijo arriba del catálogo (`#search-input`, `filtrar()`).
- Los filtros son combinables y el resultado pasa por `renderProductos(lista)`.
- Cada tarjeta muestra el código (`Cód. PP-XXX`), la categoría, hasta 2 ocasiones, el mínimo y el botón "+ Cotizar".
- Endpoints que consume: `/api/productos`, `/api/marcas`, `/api/consultas` (envío de la solicitud), `/api/suscripciones`, `/api/auth/login` y `/logos-clientes/clientes.json`.
- El candado del menú llama a `iniciarAdmin()`, que pide usuario y contraseña. La sesión de administración dura unos 15 minutos.

## Vocabulario del sitio (definido en octubre 2026)

- Todo el circuito de pedido se llama "cotización": "Solicitar cotización", "Mi cotización", "Agregar a mi cotización", botón "+ Cotizar" y mensaje "Solicitud enviada".
- "Consultar precio" se usa solo cuando un producto no tiene rango de precio.
- El menú y el footer dicen "Personalización" (no "Técnicas de personalización").
- Tarjetas de producto: máximo 2 insignias y máximo 2 ocasiones. `badgesHtml(badges, max)` recibe el máximo como segundo argumento.
- Los nombres internos (`abrirConsulta`, `cantidadConsulta`, `/api/consultas`) no se renombran.

## Reglas de datos

- El campo vigente es `badges` (plural, arreglo JSON). `badge` (singular) es un resto de los scripts de importación viejos; la API manda sobre los scripts locales.
- Las ocasiones se guardan en singular: `evento`, `fechas`, `onboarding`, `capacitacion`, `reconocimiento`. `OCC_LABEL` traduce cada una.
- Formato de código de producto: `PP-XXX`. Hoy conviven códigos con guion (`PP-635`) y sin guion (`PP394`). Está pendiente normalizarlos, y se hace desde la base.
- Nombres de producto: hay nombres repetidos (por ejemplo "Bolígrafo Plástico" en 16 productos), uno sin nombre (PP275) y unas pocas inconsistencias de mayúsculas, puntos finales y orden de palabras. Se corrigen en el admin o en la base, no en el HTML.
- La cantidad "+500 productos" del encabezado se actualiza a mano.

## Seguridad y archivos estáticos

- `express.static` se reemplazó por `guardedStatic`, con una lista de directorios permitidos (`STATIC_ALLOWED_DIRS`). Un archivo o carpeta nueva devuelve 404 hasta que se agrega a esa lista.
- Las rutas sensibles pasan por el middleware `requireAdmin`.
- Cloudflare bloquea con WAF los tipos de archivo sensibles.

## Cómo trabajar acá

- Probar siempre contra `promoplanet-catalogo.onrender.com` con Ctrl+Shift+R. `promoplanet.ar` está cacheado por Cloudflare.
- Antes de probar, confirmar en Render que el deploy figura como "Live" y corresponde al commit correcto.
- La base de Turso no se puede consultar desde la PC local: toda verificación de datos se hace contra producción, después del deploy.
- Después de editar archivos del servidor, correr `node --check server/index.js` antes de hacer commit.
- No encadenar verificaciones con `&&`: `grep -c` sale con código 1 si no hay coincidencias. Usar `;`.
- Agregar archivos a git de a uno (`git add archivo`), nunca `git add .`. Para confirmar que un push llegó: `git log origin/main -1 --oneline`.
- Cada cambio se revisa antes de aplicarse, hunk por hunk. Primero se hace un diagnóstico de solo lectura y después la implementación.
- Los archivos HTML usan saltos de línea de Windows (CRLF). Al editarlos por script hay que conservarlos.

## Redacción

- Español rioplatense con "vos", tono formal pero cercano, sin giros porteños estereotipados. Se usa "talle" y no "talla", "entregas" y no "despachos", "cuaderno anillado" y no "espiralado".
- Descripciones de producto: tono objetivo y descriptivo, empiezan con artículo, sin negrita, sin dirigirse al lector, cada oración en su propia línea sin líneas en blanco. Se destacan los atributos ecológicos cuando corresponde.
- Plazo de respuesta de las cotizaciones: 24 a 48 hs. Entregas sin cargo en CABA y GBA.

## Pendientes conocidos

- La selección de productos no sobrevive a una recarga o a la navegación.
- El login del catálogo usa `prompt()` nativo; la propuesta usa un modal.
- Primera campaña de Brevo sin enviar.
- Revisar errores 404 en Search Console y la indexación de las páginas SEO.
- Limpiar scripts y archivos que ya no se usan en la carpeta del proyecto (ver diagnóstico).
