const router = require('express').Router();
const multer = require('multer');
const { google } = require('googleapis');
const { Readable } = require('stream');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');
const { purgeCatalogCache } = require('../lib/cloudflare');

const os = require('os');
const fs = require('fs');
const UPLOAD_TMP = require('path').join(os.tmpdir(), 'pp-uploads');
fs.mkdirSync(UPLOAD_TMP, { recursive: true });
// A disco en lugar de RAM: en la instancia de 512 MB de Render,
// bufferizar fotos en memoria contribuia a los reinicios por OOM.
const upload = multer({ dest: UPLOAD_TMP, limits: { fileSize: 10 * 1024 * 1024 } });

const DIAS_NUEVO = 60;
function _esNuevo(createdAt) {
  if (!createdAt || createdAt === '2020-01-01') return false;
  const ms = Date.now() - new Date(createdAt).getTime();
  return ms >= 0 && ms < DIAS_NUEVO * 24 * 60 * 60 * 1000;
}
function _conBadgeNuevo(p) {
  if (!_esNuevo(p.created_at)) return p;
  const badges = Array.isArray(p.badges) ? p.badges : [];
  if (badges.includes('nuevo')) return p;
  return { ...p, badges: ['nuevo', ...badges] };
}

// Público — solo publicados
router.get('/', async (req, res) => {
  const { cat, q } = req.query;
  if (!cat && !q) {
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300');
  }
  res.json((await db.getProductos({ soloPublicados: true, cat, q })).map(_conBadgeNuevo));
});

router.get('/:id', async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p || p.estado !== 'publicado') return res.status(404).json({ error: 'No encontrado' });
  res.json(_conBadgeNuevo(p));
});

// Admin — todos los productos
router.get('/admin/next-code', requireAdmin, async (req, res) => {
  const todos = await db.getProductos();
  const maxNum = todos.reduce((max, p) => {
    const m = p.codigo.match(/^PP-?(\d+)$/i);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  res.json({ codigo: `PP-${String(maxNum + 1).padStart(3, '0')}` });
});

router.get('/admin/list', requireAdmin, async (req, res) => {
  const { cat, q, estado } = req.query;
  let lista = await db.getProductos({ cat, q });
  if (estado) lista = lista.filter(p => p.estado === estado);
  res.json(lista);
});

router.post('/admin', requireAdmin, async (req, res) => {
  const data = req.body;
  console.log('POST /api/productos/admin body:', JSON.stringify(data, null, 2));
  if (!data.codigo || !data.nombre || !data.categoria) {
    return res.status(400).json({ error: 'Faltan campos requeridos: codigo, nombre, categoria' });
  }
  try {
    if (data.proveedor) data.proveedor = await db.getCanonicoProveedor(data.proveedor);
    const nuevo = await db.insertProducto(data);
    const proveedorPromovido = data.proveedor ? await db.checkYPromoverProveedor(data.proveedor) : null;
    res.status(201).json({ ...nuevo, proveedorPromovido });
    purgeCatalogCache();
  } catch (err) {
    console.error('Error insertProducto:', err.message);
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Ya existe un producto con el código ${data.codigo}` });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/:id', requireAdmin, async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const body = req.body;
  if (body.proveedor) body.proveedor = await db.getCanonicoProveedor(body.proveedor);
  const actualizado = await db.updateProducto(req.params.id, body);
  const proveedorPromovido = body.proveedor ? await db.checkYPromoverProveedor(body.proveedor) : null;
  res.json({ ...actualizado, proveedorPromovido });
  purgeCatalogCache();
});

router.patch('/admin/:id', requireAdmin, async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  if (!Object.keys(req.body).length) return res.status(400).json({ error: 'Sin datos' });
  const actualizado = await db.updateProducto(req.params.id, req.body);
  res.json(actualizado);
  purgeCatalogCache();
});

router.delete('/admin/:id', requireAdmin, async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  await db.deleteProducto(req.params.id);
  res.json({ ok: true });
  purgeCatalogCache();
});

// POST /api/productos/upload-foto — sube una imagen a Google Drive y devuelve el fileId
router.post('/upload-foto', requireAdmin, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oauth2 });
    const folderId = process.env.DRIVE_UPLOAD_FOLDER_ID;
    const saEmail = process.env.GOOGLE_SA_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_SA_CREDENTIALS).client_email
      : 'promoplanet-drive@promoplanet-495303.iam.gserviceaccount.com';
    const { data } = await drive.files.create({
      requestBody: {
        name: req.file.originalname,
        ...(folderId && { parents: [folderId] }),
      },
      media: { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) },
      fields: 'id',
    });
    await drive.permissions.create({
      fileId: data.id,
      requestBody: { role: 'reader', type: 'user', emailAddress: saEmail },
      sendNotificationEmail: false,
    });
    res.json({ fileId: data.id });
  } catch (err) {
    console.error('Drive upload-foto error:', err.message);
    res.status(500).json({ error: 'Error al subir a Drive: ' + err.message });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

module.exports = router;
