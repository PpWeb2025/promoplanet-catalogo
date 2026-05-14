const router = require('express').Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Público — solo publicados
router.get('/', async (req, res) => {
  const { cat, q } = req.query;
  res.json(await db.getProductos({ soloPublicados: true, cat, q }));
});

router.get('/:id', async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p || p.estado !== 'publicado') return res.status(404).json({ error: 'No encontrado' });
  res.json(p);
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
  if (!data.codigo || !data.nombre || !data.categoria) {
    return res.status(400).json({ error: 'Faltan campos requeridos: codigo, nombre, categoria' });
  }
  try {
    const nuevo = await db.insertProducto(data);
    res.status(201).json(nuevo);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Ya existe un producto con el código ${data.codigo}` });
    }
    throw err;
  }
});

router.put('/admin/:id', requireAdmin, async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const actualizado = await db.updateProducto(req.params.id, req.body);
  res.json(actualizado);
});

router.delete('/admin/:id', requireAdmin, async (req, res) => {
  const p = await db.getProductoById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  await db.deleteProducto(req.params.id);
  res.json({ ok: true });
});

// POST /api/productos/upload-foto — sube una imagen a Cloudinary y devuelve la URL pública
router.post('/upload-foto', requireAdmin, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    const url = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'promoplanet', resource_type: 'image' },
        (error, result) => error ? reject(error) : resolve(result.secure_url)
      );
      stream.end(req.file.buffer);
    });
    res.json({ url });
  } catch (err) {
    console.error('Cloudinary upload-foto error:', err.message);
    res.status(500).json({ error: 'Error al subir a Cloudinary: ' + err.message });
  }
});

module.exports = router;
