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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  res.json(await db.getMarcas());
});

router.post('/upload-logo', requireAdmin, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    const url = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'promoplanet/marcas', resource_type: 'image' },
        (error, result) => error ? reject(error) : resolve(result.secure_url)
      );
      stream.end(req.file.buffer);
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: 'Error al subir logo: ' + err.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { nombre, logo_url } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const marca = await db.insertMarca({ nombre: nombre.trim(), logo_url: logo_url?.trim() || '' });
    res.status(201).json(marca);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const m = await db.getMarcaById(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrada' });
  const { nombre, logo_url } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const actualizada = await db.updateMarca(req.params.id, { nombre: nombre.trim(), logo_url: logo_url?.trim() || '' });
    res.json(actualizada);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const m = await db.getMarcaById(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrada' });
  await db.deleteMarca(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
