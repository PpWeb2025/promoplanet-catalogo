require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { initDb, getProductos, getProductoByCodigo } = require('./db');
const { LANDINGS } = require('./categorias');

// Mapa de redirecciones 301 para slugs del sitio anterior.
// Agregar entradas según aparezcan en Search Console.
const REDIRECTS_301 = {
  // '/mochila-porta-notebook-17-g1382': '/categoria/bolsos-y-mochilas',
  // '/es-ar/mochila-g1597':             '/categoria/bolsos-y-mochilas',
  '/home':                    '/',
  // Slugs viejos de Wix (formato -gNNN / prefijo /es-ar/)
  '/jarro-termico-g141':      '/categoria/drinkware',
  '/botella-g420':            '/categoria/drinkware',
  '/es-ar/posavasos-g210r':   '/categoria/drinkware',
  '/mochila-g724':            '/categoria/bolsos-y-mochilas',
  '/bolsa-g552':              '/categoria/bolsos-y-mochilas',
  '/cooler-g376':             '/categoria/outdoors-y-fitness',
  '/cooler-g103':             '/categoria/outdoors-y-fitness',
  // Slugs de categoría viejos
  '/outdoor':                 '/categoria/outdoors-y-fitness',
  '/oficina':                 '/categoria/escritorio-y-oficina',
  '/llaveros':                '/categoria/llaveros-y-accesorios',
  // Producto dado de baja
  '/producto/PP-464':         '/',
  // Rutas de colección sin slug
  '/categoria':               '/',
  '/ocasion':                 '/',
  // Misc
  '/producto/PP-435':         '/',
  '/producto/PP-419':         '/',
  '/producto/PP-437':         '/',
  '/producto/PP-463':         '/',
  '/catalogo':                '/',
};

const app = express();
const PORT = process.env.PORT || 3000;

app.use(require('./middleware/redirectOnrender'));

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('Falta SESSION_SECRET. Definila en el .env o en Render.');
}

app.set('trust proxy', 1);

// MemoryStore es suficiente para uso local de un solo usuario
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000, secure: 'auto', sameSite: 'lax' }, // 8h
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '20mb' }));

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const cleanPath = req.path.replace(/\/$/, '') || '/';
  if (REDIRECTS_301[cleanPath]) return res.redirect(301, REDIRECTS_301[cleanPath]);
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/marcas', require('./routes/marcas'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/drive', require('./routes/drive'));
app.use('/api/consultas', require('./routes/consultas'));
app.use('/api/ia', require('./routes/ia'));
app.use('/api/suscripciones', require('./routes/suscripciones'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/propuestas', require('./routes/propuestas'));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /api/\nAllow: /\nSitemap: https://promoplanet.ar/sitemap.xml');
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const landingUrls = LANDINGS.map(l => {
      const seg = l.tipo === 'badge' ? '/sustentable'
        : l.tipo === 'categoria' ? `/categoria/${l.slug}`
        : `/ocasion/${l.slug}`;
      return `  <url><loc>https://promoplanet.ar${seg}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    }).join('\n');
    const productos = await getProductos({ soloPublicados: true });
    const prodUrls = productos.map(p =>
      `  <url><loc>https://promoplanet.ar/producto/${encodeURIComponent(p.codigo)}</loc><changefreq>weekly</changefreq></url>`
    ).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://promoplanet.ar/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n  <url><loc>https://promoplanet.ar/clientes</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n${landingUrls}\n${prodUrls}\n</urlset>`;
    res.type('application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('Error generando sitemap');
  }
});

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const CANONICAL_PLACEHOLDER = '<link rel="canonical" href="https://promoplanet.ar/">';

function renderSPA(res, canonicalPath) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const replaced = html.replace(
    CANONICAL_PLACEHOLDER,
    `<link rel="canonical" href="https://promoplanet.ar${canonicalPath}">`
  );
  if (replaced === html) {
    console.warn(`[renderSPA] WARNING: canonical placeholder not found in index.html — path: ${canonicalPath}`);
  }
  res.set('Cache-Control', 'no-cache');
  res.send(replaced);
}

function render404(res) {
  res.status(404).set('Cache-Control', 'no-cache').send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Página no encontrada — PromoPlanet</title>
<meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',sans-serif;color:#1a1f2e;background:#f4f5f7;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem}
  .num{font-size:7rem;font-weight:600;color:#003471;line-height:1}
  h1{font-size:1.5rem;font-weight:500;color:#003471;margin:.75rem 0 .5rem}
  p{color:#5a6070;margin-bottom:2rem;max-width:420px}
  .btn{display:inline-block;background:#00A8B4;color:#fff;text-decoration:none;border-radius:8px;padding:.75rem 2rem;font-weight:600;font-size:.95rem;transition:opacity .2s}
  .btn:hover{opacity:.85}
</style>
</head>
<body>
  <div class="num">404</div>
  <h1>Página no encontrada</h1>
  <p>El link que seguiste no existe o fue removido. Buscá lo que necesitás en el catálogo.</p>
  <a href="/" class="btn">Ir al catálogo</a>
</body>
</html>`);
}

app.get('/producto/:codigo', async (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const baseHtml = fs.readFileSync(htmlPath, 'utf8');
  try {
    const p = await getProductoByCodigo(req.params.codigo);
    if (!p) return render404(res);
    const title = escapeAttr(`${p.nombre} — PromoPlanet`);
    const desc = escapeAttr((p.descripcion || '').replace(/\n/g, ' ').slice(0, 160));
    const fotoId = Array.isArray(p.fotos) && p.fotos[0];
    const image = fotoId
      ? (fotoId.startsWith('http') || fotoId.startsWith('/') ? fotoId : `https://promoplanet.ar/api/drive/imagen/${fotoId}`)
      : 'https://promoplanet.ar/og-image.jpg';
    const url = `https://promoplanet.ar/producto/${encodeURIComponent(p.codigo)}`;
    const meta = [
      `<title>${title}</title>`,
      `<meta name="description" content="${desc}">`,
      `<meta property="og:title" content="${title}">`,
      `<meta property="og:description" content="${desc}">`,
      `<meta property="og:image" content="${image}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:type" content="product">`,
    ].join('\n');
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.nombre || '',
      description: (p.descripcion || '').replace(/\n/g, ' ').slice(0, 500),
      sku: p.codigo || '',
      image,
      brand: { '@type': 'Brand', name: 'PromoPlanet' },
      offers: {
        '@type': 'Offer',
        availability: 'https://schema.org/InStock',
        price: '0',
        priceValidUntil: '2027-12-31',
        priceCurrency: 'ARS',
        description: 'Precio a consultar según cantidad y personalización',
        seller: { '@type': 'Organization', name: 'PromoPlanet' },
      },
    };
    const jsonLdScript = `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
    res.set('Cache-Control', 'no-cache');
    res.send(
      baseHtml
        .replace('<title>PromoPlanet — Productos promocionales y regalos corporativos en Buenos Aires</title>', meta)
        .replace('<link rel="canonical" href="https://promoplanet.ar/">', `<link rel="canonical" href="${url}">`)
        .replace('</head>', `${jsonLdScript}\n</head>`)
    );
  } catch {
    res.set('Cache-Control', 'no-cache');
    res.send(baseHtml);
  }
});

function buildLandingSection(landing, productos) {
  const items = productos.map(p =>
    `    <li><a href="/producto/${encodeURIComponent(p.codigo)}">${escapeHtml(p.nombre)}</a></li>`
  ).join('\n');
  return `<section id="landing-seo" data-tipo="${landing.tipo}" data-filtro="${landing.filtro}">
  <div class="landing-intro"><h1>${escapeHtml(landing.h1)}</h1><p>${escapeHtml(landing.intro[0])}</p><p>${escapeHtml(landing.intro[1])}</p></div>
  <ul class="landing-lista">
${items}
  </ul>
</section>`;
}

async function renderLanding(res, landing, canonicalUrl) {
  const baseHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  try {
    const todos = await getProductos({ soloPublicados: true });
    const productos = todos.filter(p => {
      if (landing.tipo === 'categoria') return p.categoria === landing.filtro;
      if (landing.tipo === 'ocasion')   return parseArray(p.ocasiones).includes(landing.filtro);
      if (landing.tipo === 'badge')     return parseArray(p.badges).includes(landing.filtro);
      return false;
    });
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: landing.title,
      description: landing.description,
      url: canonicalUrl,
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: productos.slice(0, 50).map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `https://promoplanet.ar/producto/${encodeURIComponent(p.codigo)}`,
          name: p.nombre || '',
        })),
      },
    };
    const jsonLdScript = `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
    const headExtra = [
      `<meta property="og:title" content="${escapeAttr(landing.title)}">`,
      `<meta property="og:description" content="${escapeAttr(landing.description)}">`,
      `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`,
      `<meta property="og:type" content="website">`,
      jsonLdScript,
    ].join('\n');
    res.set('Cache-Control', 'no-cache');
    res.send(
      baseHtml
        .replace('<title>PromoPlanet — Productos promocionales y regalos corporativos en Buenos Aires</title>',
          `<title>${escapeAttr(landing.title)}</title>`)
        .replace('<meta name="description" content="Catálogo de productos promocionales personalizados para empresas. Drinkware, indumentaria, tecnología, packaging y más. Entregas en CABA y GBA.">',
          `<meta name="description" content="${escapeAttr(landing.description)}">`)
        .replace('<link rel="canonical" href="https://promoplanet.ar/">', `<link rel="canonical" href="${canonicalUrl}">`)
        .replace('<h1>Productos promocionales<br>para equipos que <em>importan</em></h1>',
          '<p class="hero-h1-home">Productos promocionales<br>para equipos que <em>importan</em></p>')
        .replace('<!-- LANDING SEO SECTION -->', buildLandingSection(landing, productos))
        .replace('</head>', `${headExtra}\n</head>`)
    );
  } catch (err) {
    console.error('Landing render error:', err);
    res.set('Cache-Control', 'no-cache');
    res.send(baseHtml);
  }
}

app.get('/categoria/:slug', async (req, res) => {
  const landing = LANDINGS.find(l => l.tipo === 'categoria' && l.slug === req.params.slug);
  if (!landing) return render404(res);
  return renderLanding(res, landing, `https://promoplanet.ar/categoria/${landing.slug}`);
});

app.get('/ocasion/:slug', async (req, res) => {
  const landing = LANDINGS.find(l => l.tipo === 'ocasion' && l.slug === req.params.slug);
  if (!landing) return render404(res);
  return renderLanding(res, landing, `https://promoplanet.ar/ocasion/${landing.slug}`);
});

app.get('/sustentable', async (req, res) => {
  const landing = LANDINGS.find(l => l.slug === 'sustentable');
  if (!landing) return render404(res);
  return renderLanding(res, landing, 'https://promoplanet.ar/sustentable');
});

app.get('/clientes', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'clientes.html'));
});

const STATIC_CACHE = {
  html:  'no-cache',
  js:    'public, max-age=3600',
  css:   'public, max-age=3600',
  svg:   'public, max-age=604800',
  png:   'public, max-age=604800',
  jpg:   'public, max-age=604800',
  jpeg:  'public, max-age=604800',
  webp:  'public, max-age=604800',
  ico:   'public, max-age=604800',
  woff:  'public, max-age=604800',
  woff2: 'public, max-age=604800',
};

const STATIC_ALLOWED_FILES = new Set([
  '/',
  '/index.html',
  '/admin.html',
  '/propuesta.html',
  '/propuestas.html',
  '/clientes.html',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/PP_Slogan.png',
  '/og-image.jpg',
  '/logo-pp-color.svg',
  '/logo-pp-completo-blanco.svg',
  '/logo-pp-texto-blanco.svg',
  '/mariposa-blanca.svg',
  '/badges.js',
]);
const STATIC_ALLOWED_DIRS = ['/firma/', '/logos-clientes/'];

const _static = express.static(path.join(__dirname, '..'), {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.setHeader('Cache-Control', STATIC_CACHE[ext] ?? 'public, max-age=0');
  },
});

function guardedStatic(req, res, next) {
  let p;
  try {
    p = decodeURIComponent(req.path);
  } catch {
    return next();
  }
  if (STATIC_ALLOWED_FILES.has(p) || STATIC_ALLOWED_DIRS.some(d => p.startsWith(d))) {
    return _static(req, res, next);
  }
  next();
}

app.use(guardedStatic);

app.get('*', (req, res) => {
  render404(res);
});

initDb()
  .then(() => {
        app.listen(PORT, () => {
                console.log(`PromoPlanet corriendo en http://localhost:${PORT}`);
                console.log(` Catálogo: http://localhost:${PORT}/`);
                console.log(` Admin: http://localhost:${PORT}/admin.html`);
        });
  })
  .catch(err => {
        console.error('Error al inicializar la base de datos:', err);
        process.exit(1);
  });
