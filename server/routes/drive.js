const router = require('express').Router();
const { google } = require('googleapis');
const { Readable } = require('stream');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Detecta PP-1234 (nuevo formato) y G1603 / M220 (formato legacy)
const CODIGO_REGEX = /(PP-\d{3,5}|[A-Z]{1,3}\d{3,4}[A-Z]?)/;

// Cache en memoria para metadatos de Drive (TTL 1h)
const imageCache = new Map();

function getDriveClient(write = false) {
  const authOptions = {
    scopes: [write
      ? 'https://www.googleapis.com/auth/drive'
      : 'https://www.googleapis.com/auth/drive.readonly'],
  };
  if (process.env.GOOGLE_SA_CREDENTIALS) {
    authOptions.credentials = JSON.parse(process.env.GOOGLE_SA_CREDENTIALS);
  } else {
    authOptions.keyFile = path.resolve(process.env.GOOGLE_SA_KEY_FILE || './service-account.json');
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  return google.drive({ version: 'v3', auth });
}

function getOAuthDriveClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

const SA_EMAIL = process.env.GOOGLE_SA_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_SA_CREDENTIALS).client_email
  : 'promoplanet-drive@promoplanet-495303.iam.gserviceaccount.com';

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
      grupos[cod] = { codigo: cod, nombre, archivos: [], subcarpeta: file._subfolder || '' };
    }
    grupos[cod].archivos.push({ fileId: file.id, nombre: file.name });
  }
  return Object.values(grupos);
}

// Escaneo recursivo: retorna imágenes con _subfolder = nombre de la carpeta que las contiene
async function listFilesRecursive(drive, folderId, folderName, depth = 0) {
  if (depth > 3) return [];

  const [foldersRes, filesRes] = await Promise.all([
    drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      pageSize: 100,
    }),
    drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: 'files(id, name, mimeType)',
      pageSize: 1000,
    }),
  ]);

  const subfolders = foldersRes.data.files || [];
  const images = (filesRes.data.files || []).map(f => ({ ...f, _subfolder: folderName }));

  const subImages = (await Promise.all(
    subfolders.map(sf => listFilesRecursive(drive, sf.id, sf.name, depth + 1))
  )).flat();

  return [...images, ...subImages];
}

// GET /api/drive/listar?folderId=XXX[&recursive=true] — requiere admin
router.get('/listar', requireAdmin, async (req, res) => {
  const { folderId, recursive } = req.query;
  if (!folderId) return res.status(400).json({ error: 'Falta el parámetro folderId' });

  try {
    const drive = getDriveClient();
    const folderMeta = await drive.files.get({ fileId: folderId, fields: 'name' });
    const folderName = folderMeta.data.name;

    let files;
    if (recursive === 'true') {
      files = await listFilesRecursive(drive, folderId, folderName);
    } else {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
        fields: 'files(id, name, mimeType)',
        pageSize: 1000,
      });
      files = response.data.files || [];
    }

    const grupos = agruparArchivos(files);
    res.json({ total: files.length, grupos, folderName });
  } catch (err) {
    console.error('Drive listar error:', err.message);
    res.status(500).json({ error: 'Error al leer la carpeta de Drive. Verificá las credenciales y los permisos.' });
  }
});

// POST /api/drive/importar — requiere admin
// Body: { productos: [...], actualizarExistentes?: boolean }
router.post('/importar', requireAdmin, async (req, res) => {
  const { productos, actualizarExistentes = false } = req.body;
  if (!Array.isArray(productos) || !productos.length) {
    return res.status(400).json({ error: 'Se esperaba un array de productos' });
  }

  const importados = [];
  const omitidos = [];
  const actualizados = [];

  for (const p of productos) {
    try {
      const nuevo = await db.insertProducto({
        codigo: p.codigo,
        nombre: p.nombre,
        categoria: p.categoria || '',
        subcategoria: p.subcategoria || '',
        rango: '',
        minimo: 0,
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
        if (actualizarExistentes) {
          const existing = await db.getProductoByCodigo(p.codigo);
          if (existing) {
            const nuevosIds = p.archivos.map(a => a.fileId);
            const fotosActualizadas = [...new Set([...existing.fotos, ...nuevosIds])];
            await db.updateProducto(existing.id, { fotos: fotosActualizadas });
            actualizados.push(p.codigo);
          }
        } else {
          omitidos.push(p.codigo);
        }
      } else {
        throw err;
      }
    }
  }

  res.json({ importados: importados.length, omitidos, actualizados });
});

// POST /api/drive/subir — requiere admin
// FormData: fotos[] (archivos), nombres (JSON array de strings)
// Sube a Google Drive y devuelve { fileIds }
router.post('/subir', requireAdmin, uploadMem.array('fotos', 20), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No se recibieron archivos' });
  }

  const nombres = JSON.parse(req.body.nombres || '[]');

  try {
    const drive = getOAuthDriveClient();
    const folderId = process.env.DRIVE_UPLOAD_FOLDER_ID;
    const fileIds = await Promise.all(req.files.map(async (file, i) => {
      const nombre = nombres[i] || file.originalname;
      const { data } = await drive.files.create({
        requestBody: {
          name: nombre,
          ...(folderId && { parents: [folderId] }),
        },
        media: { mimeType: file.mimetype, body: Readable.from(file.buffer) },
        fields: 'id',
      });
      await drive.permissions.create({
        fileId: data.id,
        requestBody: { role: 'reader', type: 'user', emailAddress: SA_EMAIL },
        sendNotificationEmail: false,
      });
      return data.id;
    }));

    res.json({ fileIds });
  } catch (err) {
    console.error('Drive subir error:', err.message);
    res.status(500).json({ error: 'Error al subir a Drive: ' + err.message });
  }
});

// POST /api/drive/crear-carpeta-uploads — endpoint temporal de un solo uso
// Crear la carpeta destino de imágenes subidas vía OAuth. Borrar después de obtener el folderId.
router.post('/crear-carpeta-uploads', requireAdmin, async (req, res) => {
  try {
    const drive = getOAuthDriveClient();
    const { data } = await drive.files.create({
      requestBody: {
        name: 'Catálogo - Imágenes subidas',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id,name',
    });
    res.json({ id: data.id, nombre: data.name });
  } catch (err) {
    console.error('crear-carpeta-uploads error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const ALLOWED_WIDTHS = new Set([200, 400, 800, 1200]);

// GET /api/drive/imagen/:fileId — público, proxy con cache
router.get('/imagen/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const w = parseInt(req.query.w, 10);
  const resize = ALLOWED_WIDTHS.has(w);

  try {
    const drive = getDriveClient();

    let meta = imageCache.get(fileId);
    if (!meta) {
      const metaRes = await drive.files.get({ fileId, fields: 'mimeType,name' });
      meta = metaRes.data;
      imageCache.set(fileId, meta);
      setTimeout(() => imageCache.delete(fileId), 3600_000);
    }

    if (!resize) {
      // Sin ?w válido: devolver original (retrocompatibilidad)
      res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const stream = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
      stream.data.pipe(res);
      return;
    }

    // Con ?w válido: bajar a buffer y convertir a WebP
    const driveStream = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    const chunks = [];
    await new Promise((resolve, reject) => {
      driveStream.data.on('data', c => chunks.push(c));
      driveStream.data.on('end', resolve);
      driveStream.data.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);

    try {
      const webp = await sharp(buffer)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', webp.length);
      res.send(webp);
    } catch (sharpErr) {
      // Fallback: devolver original si sharp no puede procesarlo
      console.error('Drive imagen sharp error:', sharpErr.message, '— enviando original');
      res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    }
  } catch (err) {
    console.error('Drive imagen error:', err.message);
    res.status(404).send('Imagen no disponible');
  }
});

module.exports = router;
