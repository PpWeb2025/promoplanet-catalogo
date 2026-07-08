const router = require('express').Router();
const { google } = require('googleapis');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

// --- Ajustes de memoria para instancias chicas (Render 512 MB) ---
// libvips por defecto cachea operaciones y usa varios threads; en un
// contenedor chico eso suma cientos de MB. Lo limitamos.
sharp.cache(false);
sharp.concurrency(1);

// Subidas a disco temporal en lugar de RAM (antes: memoryStorage
// con hasta 20 archivos x 20 MB = 400 MB en memoria en un solo request).
const UPLOAD_TMP = path.join(os.tmpdir(), 'pp-uploads');
fs.mkdirSync(UPLOAD_TMP, { recursive: true });
const uploadDisk = multer({ dest: UPLOAD_TMP, limits: { fileSize: 20 * 1024 * 1024 } });

async function limpiarTmp(files) {
  await Promise.all((files || []).map(f => fs.promises.unlink(f.path).catch(() => {})));
}

// Detecta PP-1234 (nuevo formato) y G1603 / M220 (formato legacy)
const CODIGO_REGEX = /(PP-\d{3,5}|[A-Z]{1,3}\d{3,4}[A-Z]?)/;

// Cache en memoria para metadatos de Drive (TTL 1h)
const imageCache = new Map();

// Cache en disco de miniaturas ya procesadas: evita volver a bajar de
// Drive y re-procesar con sharp en cada visita. El disco de Render es
// efímero (se limpia en cada deploy/restart), lo cual es aceptable.
const IMG_CACHE_DIR = path.join(os.tmpdir(), 'pp-img-cache');
fs.mkdirSync(IMG_CACHE_DIR, { recursive: true });
let imgCacheCount = fs.readdirSync(IMG_CACHE_DIR).length;
const IMG_CACHE_MAX = 500;

function cachePathFor(fileId, w, ext) {
  const safe = String(fileId).replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(IMG_CACHE_DIR, `${safe}_w${w}.${ext}`);
}

function guardarEnCache(cachePath, buffer) {
  try {
    if (imgCacheCount >= IMG_CACHE_MAX) {
      for (const f of fs.readdirSync(IMG_CACHE_DIR)) {
        fs.unlinkSync(path.join(IMG_CACHE_DIR, f));
      }
      imgCacheCount = 0;
    }
    fs.writeFile(cachePath, buffer, err => { if (!err) imgCacheCount++; });
  } catch { /* la cache es best-effort */ }
}

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
router.post('/subir', requireAdmin, uploadDisk.array('fotos', 20), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No se recibieron archivos' });
  }

  const nombres = JSON.parse(req.body.nombres || '[]');

  try {
    const drive = getOAuthDriveClient();
    const folderId = process.env.DRIVE_UPLOAD_FOLDER_ID;
    const fileIds = [];
    // Secuencial a propósito: subir 20 fotos en paralelo desde una
    // instancia de 512 MB era parte del problema de memoria.
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const nombre = nombres[i] || file.originalname;
      const { data } = await drive.files.create({
        requestBody: {
          name: nombre,
          ...(folderId && { parents: [folderId] }),
        },
        media: { mimeType: file.mimetype, body: fs.createReadStream(file.path) },
        fields: 'id',
      });
      await drive.permissions.create({
        fileId: data.id,
        requestBody: { role: 'reader', type: 'user', emailAddress: SA_EMAIL },
        sendNotificationEmail: false,
      });
      fileIds.push(data.id);
    }

    res.json({ fileIds });
  } catch (err) {
    console.error('Drive subir error:', err.message);
    res.status(500).json({ error: 'Error al subir a Drive: ' + err.message });
  } finally {
    limpiarTmp(req.files);
  }
});

const ALLOWED_WIDTHS = new Set([200, 400, 800, 1200]);

// Limitador global de trabajos de imagen. Antes solo limitaba la etapa
// de sharp: con 40 miniaturas pedidas a la vez, las 40 descargas desde
// Drive se bufferizaban en RAM al mismo tiempo (fotos de varios MB cada
// una) mientras esperaban su turno de sharp → pico de memoria → OOM.
// Ahora descarga + resize cuentan como UN trabajo y corren de a 2.
let _jobsActive = 0;
const _jobQueue = [];
const MAX_IMAGE_JOBS = 2;
function withImageJobLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _jobsActive++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        _jobsActive--;
        if (_jobQueue.length > 0) _jobQueue.shift()();
      });
    };
    if (_jobsActive < MAX_IMAGE_JOBS) run();
    else _jobQueue.push(run);
  });
}

// GET /api/drive/imagen/:fileId — público, proxy con cache
router.get('/imagen/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const w = parseInt(req.query.w, 10);
  const resize = ALLOWED_WIDTHS.has(w);

  const fmt = req.query.fmt;
  const useWebp = fmt !== 'jpg' && fmt !== 'jpeg';
  const ext = useWebp ? 'webp' : 'jpg';
  const contentTypeOut = useWebp ? 'image/webp' : 'image/jpeg';

  // 1) Si la miniatura ya está en la cache de disco, servirla directo:
  //    cero llamadas a Drive, cero sharp, memoria mínima.
  if (resize) {
    const cached = cachePathFor(fileId, w, ext);
    if (fs.existsSync(cached)) {
      res.setHeader('Content-Type', contentTypeOut);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(cached);
    }
  }

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
      // Sin ?w válido: devolver original en streaming (no se bufferiza)
      res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const stream = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
      stream.data.pipe(res);
      return;
    }

    // 2) Con ?w válido: descarga + resize dentro del limitador global
    await withImageJobLimit(async () => {
      const driveStream = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
      const chunks = [];
      await new Promise((resolve, reject) => {
        driveStream.data.on('data', c => chunks.push(c));
        driveStream.data.on('end', resolve);
        driveStream.data.on('error', reject);
      });
      const buffer = Buffer.concat(chunks);

      try {
        const pipe = sharp(buffer).resize({ width: w, withoutEnlargement: true });
        const output = useWebp
          ? await pipe.webp({ quality: 78 }).toBuffer()
          : await pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();

        guardarEnCache(cachePathFor(fileId, w, ext), output);

        res.setHeader('Content-Type', contentTypeOut);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Length', output.length);
        res.send(output);
      } catch (sharpErr) {
        // Fallback: devolver original si sharp no puede procesarlo
        console.error('Drive imagen sharp error:', sharpErr.message, '— enviando original');
        res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(buffer);
      }
    });
  } catch (err) {
    console.error('Drive imagen error:', err.message);
    res.status(404).send('Imagen no disponible');
  }
});

module.exports = router;
