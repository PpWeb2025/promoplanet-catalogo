require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { initDb, getProductos, getProductoByCodigo } = require('./db');

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
    const productos = await getProductos({ soloPublicados: true });
    const items = productos.map(p =>
      `  <url><loc>https://promoplanet.ar/producto/${encodeURIComponent(p.codigo)}</loc><changefreq>weekly</changefreq></url>`
    ).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://promoplanet.ar/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n${items}\n</urlset>`;
    res.type('application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('Error generando sitemap');
  }
});

function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

app.get('/producto/:codigo', async (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const baseHtml = fs.readFileSync(htmlPath, 'utf8');
  try {
    const p = await getProductoByCodigo(req.params.codigo);
    if (!p) return res.send(baseHtml);
    const title = escapeAttr(`${p.nombre} — PromoPlanet`);
    const desc = escapeAttr((p.descripcion || '').replace(/\n/g, ' ').slice(0, 160));
    const fotoId = Array.isArray(p.fotos) && p.fotos[0];
    const rawImage = fotoId
      ? (fotoId.startsWith('http') || fotoId.startsWith('/') ? fotoId : `https://promoplanet.ar/api/drive/imagen/${fotoId}`)
      : 'https://promoplanet.ar/og-image.jpg';
    const image = rawImage.includes('res.cloudinary.com')
      ? rawImage.replace(/\/upload\/(?:f_auto,q_auto,w_\d+\/)?/, '/upload/f_auto,q_auto,w_1200/')
      : rawImage;
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
        .replace('</head>', `${jsonLdScript}\n</head>`)
    );
  } catch {
    res.send(baseHtml);
  }
});

app.use(express.static(path.join(__dirname, '..')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
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
