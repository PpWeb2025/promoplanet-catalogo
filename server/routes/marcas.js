const router = require('express').Router();
const multer = require('multer');
const { google } = require('googleapis');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

// A disco temporal en lugar de RAM, consistente con drive.js y productos.js
const UPLOAD_TMP = path.join(os.tmpdir(), 'pp-uploads');
fs.mkdirSync(UPLOAD_TMP, { recursive: true });
const upload = multer({ dest: UPLOAD_TMP, limits: { fileSize: 5 * 1024 * 1024 } });

const SA_EMAIL = process.env.GOOGLE_SA_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_SA_CREDENTIALS).client_email
  : 'promoplanet-drive@promoplanet-495303.iam.gserviceaccount.com';

router.get('/', async (req, res) => {
  res.json(await db.getMarcas());
});

// POST /api/marcas/upload-logo — sube el logo a Google Drive y devuelve
// una URL servible por el proxy propio (/api/drive/imagen/:fileId).
// Antes subía a Cloudinary; la cuenta quedó deshabilitada.
router.post('/upload-logo', requireAdmin, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
    const drive = google.drive({ version: 'v3', auth: oauth2 });
    const folderId = process.env.DRIVE_UPLOAD_FOLDER_ID;

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
      requestBody: { role: 'reader', type: 'user', emailAddress: SA_EMAIL },
      sendNotificationEmail: false,
    });

    res.json({ url: `/api/drive/imagen/${data.id}` });
  } catch (err) {
    console.error('Marcas upload-logo error:', err.message);
    res.status(500).json({ error: 'Error al subir logo: ' + err.message });
  } finally {
    fs.promises.unlink(req.file.path).catch(() => {});
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
