const router = require('express').Router();
const { google } = require('googleapis');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

const CODIGO_REGEX = /([A-Z]{1,3}\d{3,4}[A-Z]?)/;

// Cache en memoria para metadatos de Drive (TTL 1h)
const imageCache = new Map();

function getDriveClient() {
  const keyFile = path.resolve(process.env.GOOGLE_SA_KEY_FILE || './service-account.json');
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

function extraerCodigo(nombre) {
  const m = nombre.match(CODIGO_REGEX);
  return m ? m[1] : null;
}

function agruparArchivos(files) {
  const grupos = {};
  for (const file of files) {
    const cod = extraerCodigo(file.name);
    if (!cod) continue;
    if (!grupos[cod]) {
      const sinExt = file.name.replace(/\.[^.]+$/, '');
      const nombre = sinExt
        .replace(/\s+[A-Z]{1,3}\d{3,4}[A-Z]?\s+[a-z]$/, '')
        .replace(/\s+[a-z]$/, '')
        .trim();
      grupos[cod] = { codigo: cod, nombre, archivos: [] };
    }
    grupos[cod].archivos.push({ fileId: file.id, nombre: file.name });
  }
  return Object.values(grupos);
}

// GET /api/drive/listar?folderId=XXX — requiere admin
router.get('/listar', requireAdmin, async (req, res) => {
  const { folderId } = req.query;
  if (!folderId) return res.status(400).json({ error: 'Falta el parámetro folderId' });

  try {
    const drive = getDriveClient();
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: 'files(id, name, mimeType)',
      pageSize: 1000,
    });
    const grupos = agruparArchivos(response.data.files || []);
    res.json({ total: response.data.files.length, grupos });
  } catch (err) {
    console.error('Drive listar error:', err.message);
    res.status(500).json({ error: 'Error al leer la carpeta de Drive. Verificá las credenciales y los permisos.' });
  }
});

// POST /api/drive/importar — requiere admin
// Body: { productos: [{ codigo, nombre, archivos: [{fileId, nombre}] }] }
router.post('/importar', requireAdmin, (req, res) => {
  const { productos } = req.body;
  if (!Array.isArray(productos) || !productos.length) {
    return res.status(400).json({ error: 'Se esperaba un array de productos' });
  }

  const importados = [];
  const omitidos = [];

  for (const p of productos) {
    try {
      const nuevo = db.insertProducto({
        codigo: p.codigo,
        nombre: p.nombre,
        categoria: '',
        rango: 'intermedio',
        minimo: 50,
        tecnicas: [],
        destinatarios: [],
        ocasiones: [],
        estado: 'borrador',
        fotos: p.archivos.map(a => a.fileId),
        drive_code: p.codigo,
        emoji: '📦',
        descripcion: '',
      });
      importados.push(nuevo);
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        omitidos.push(p.codigo);
      } else {
        throw err;
      }
    }
  }

  res.json({ importados: importados.length, omitidos });
});

// GET /api/drive/imagen/:fileId — público, proxy con cache
router.get('/imagen/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    const drive = getDriveClient();

    // Obtener metadata para el content-type (cacheado)
    let meta = imageCache.get(fileId);
    if (!meta) {
      const metaRes = await drive.files.get({ fileId, fields: 'mimeType,name' });
      meta = metaRes.data;
      imageCache.set(fileId, meta);
      // Limpiar cache después de 1h
      setTimeout(() => imageCache.delete(fileId), 3600_000);
    }

    res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const stream = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    stream.data.pipe(res);
  } catch (err) {
    console.error('Drive imagen error:', err.message);
    res.status(404).send('Imagen no disponible');
  }
});

module.exports = router;
