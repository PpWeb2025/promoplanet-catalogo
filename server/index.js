require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { initDb, getProductos, getProductoByCodigo } = require('./db');
const { LANDINGS } = require('./categorias');

const app = express();
const PORT = process.env.PORT || 3000;

// MemoryStore es suficiente para uso local de un solo usuario
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }, // 8h
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '20mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/marcas', require('./routes/marcas'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/drive', require('./routes/drive'));
app.use('/api/consultas', require('./routes/consultas'));
app.use('/api/ia', require('./routes/ia'));
app.use('/api/suscripciones', require('./routes/suscripciones'));
app.use('/api/clientes', require('./routes/clientes'));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nSitemap: https://promoplanet.ar/sitemap.xml');
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
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://promoplanet.ar/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n${landingUrls}\n${prodUrls}\n</urlset>`;
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

app.get('/producto/:codigo', async (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const baseHtml = fs.readFileSync(htmlPath, 'utf8');
  try {
    const p = await getProductoByCodigo(req.params.codigo);
    if (!p) return res.redirect(301, '/');
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
    res.send(
      baseHtml
        .replace('<title>PromoPlanet — Productos promocionales y regalos corporativos en Buenos Aires</title>', meta)
        .replace('<link rel="canonical" href="https://promoplanet.ar/">', `<link rel="canonical" href="${url}">`)
        .replace('</head>', `${jsonLdScript}\n</head>`)
    );
  } catch {
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
      if (landing.tipo === 'badge')     return p.badge === landing.filtro;
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
    res.send(
      baseHtml
        .replace('<title>PromoPlanet — Productos promocionales y regalos corporativos en Buenos Aires</title>',
          `<title>${escapeAttr(landing.title)}</title>`)
        .replace('<meta name="description" content="Catálogo de productos promocionales personalizados para empresas. Drinkware, indumentaria, tecnología, packaging y más. Entregas en CABA y GBA.">',
          `<meta name="description" content="${escapeAttr(landing.description)}">`)
        .replace('<link rel="canonical" href="https://promoplanet.ar/">', `<link rel="canonical" href="${canonicalUrl}">`)
        .replace('<h1>Productos promocionales<br>para equipos que <em>importan</em></h1>',
          '<p class="hero-h1-home">Productos promocionales<br>para equipos que <em>importan</em></p>')
        .replace('<!-- MAIN CONTENT -->', `${buildLandingSection(landing, productos)}\n<!-- MAIN CONTENT -->`)
        .replace('</head>', `${headExtra}\n</head>`)
    );
  } catch (err) {
    console.error('Landing render error:', err);
    res.send(baseHtml);
  }
}

app.get('/categoria/:slug', async (req, res) => {
  const landing = LANDINGS.find(l => l.tipo === 'categoria' && l.slug === req.params.slug);
  if (!landing) return res.redirect(301, '/');
  return renderLanding(res, landing, `https://promoplanet.ar/categoria/${landing.slug}`);
});

app.get('/ocasion/:slug', async (req, res) => {
  const landing = LANDINGS.find(l => l.tipo === 'ocasion' && l.slug === req.params.slug);
  if (!landing) return res.redirect(301, '/');
  return renderLanding(res, landing, `https://promoplanet.ar/ocasion/${landing.slug}`);
});

app.get('/sustentable', async (req, res) => {
  const landing = LANDINGS.find(l => l.slug === 'sustentable');
  if (!landing) return res.redirect(301, '/');
  return renderLanding(res, landing, 'https://promoplanet.ar/sustentable');
});

app.use(express.static(path.join(__dirname, '..')));

app.get('*', (req, res) => {
    res.redirect(301, '/');
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
