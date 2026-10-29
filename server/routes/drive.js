const router = require('express').Router();
const { google } = require('googleapis');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');
const { corregirNombreArchivo, limpiarNombreArchivo } = require('../lib/nombreArchivo');

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
const IMG_CACHE_MAX = 1500;
// Cuando se llega al tope se borra el 20 % más viejo, no todo junto:
// vaciar todo hacía que las visitas siguientes bajaran todas las fotos de Drive de nuevo.
const IMG_CACHE_PURGA = 0.2;

function cachePathFor(fileId, w, ext) {
  const safe = String(fileId).replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(IMG_CACHE_DIR, `${safe}_w${w}.${ext}`);
}

function purgarCacheVieja() {
  const archivos = [];
  for (const f of fs.readdirSync(IMG_CACHE_DIR)) {
    const ruta = path.join(IMG_CACHE_DIR, f);
    try {
      archivos.push({ ruta, mtime: fs.statSync(ruta).mtimeMs });
    } catch { /* otro proceso lo borró */ }
  }
  archivos.sort((a, b) => a.mtime - b.mtime);
  const borrar = Math.max(1, Math.ceil(archivos.length * IMG_CACHE_PURGA));
  let borrados = 0;
  for (const { ruta } of archivos.slice(0, borrar)) {
    try {
      fs.unlinkSync(ruta);
      borrados++;
    } catch { /* idem */ }
  }
  imgCacheCount = Math.max(0, archivos.length - borrados);
}

function guardarEnCache(cachePath, buffer) {
  try {
    if (imgCacheCount >= IMG_CACHE_MAX) purgarCacheVieja();
    fs.writeFile(cachePath, buffer, err => { if (!err) imgCacheCount++; });
  } catch { /* la cache es best-effort */ }
}

// Un único cliente por tipo de acceso: GoogleAuth guarda el token y lo renueva solo.
// Antes se creaba uno nuevo en cada pedido y cada imagen podía pedir un token propio.
const _clientesDrive = new Map();

function getDriveClient(write = false) {
  const clave = write ? 'write' : 'read';
  if (!_clientesDrive.has(clave)) _clientesDrive.set(clave, crearDriveClient(write));
  return _clientesDrive.get(clave);
}

function crearDriveClient(write) {
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

// ── Reintentos para la subida a Drive ──────────────────────────────────────────

function esErrorTransitorio(err) {
  const estado = Number(err?.code || err?.response?.status || err?.status);
  if ([429, 500, 502, 503, 504].includes(estado)) return true;
  const razon = err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason;
  if (['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError'].includes(razon)) return true;
  const codigoRed = typeof err?.code === 'string' ? err.code : '';
  return ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND'].includes(codigoRed);
}

async function conReintentos(descripcion, fn, intentos = 4) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fn(intento);
    } catch (err) {
      ultimoError = err;
      if (!esErrorTransitorio(err) || intento === intentos) break;
      const espera = 1000 * 2 ** (intento - 1) + Math.floor(Math.random() * 400);
      console.warn(`Drive: ${descripcion} falló (intento ${intento}/${intentos}): ${err.message}. Reintentando en ${espera} ms`);
      await new Promise(resolve => setTimeout(resolve, espera));
    }
  }
  throw ultimoError;
}

async function buscarSubidaReciente(drive, nombre, folderId, desdeISO) {
  try {
    const nombreEscapado = nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const { data } = await drive.files.list({
      q: `name = '${nombreEscapado}' and '${folderId}' in parents and trashed = false and createdTime > '${desdeISO}'`,
      fields: 'files(id)',
      pageSize: 1,
    });
    return data.files?.[0]?.id || null;
  } catch (err) {
    console.warn(`Drive: no se pudo verificar si ${nombre} ya estaba subido: ${err.message}`);
    return null;
  }
}

async function subirArchivoADrive(drive, file, nombre, folderId, desdeISO, creados) {
  const id = await conReintentos(`crear ${nombre}`, async (intento) => {
    if (intento > 1 && folderId) {
      const existente = await buscarSubidaReciente(drive, nombre, folderId, desdeISO);
      if (existente) {
        console.warn(`Drive: ${nombre} ya figuraba subido, se reutiliza (${existente})`);
        return existente;
      }
    }
    const { data } = await drive.files.create({
      requestBody: {
        name: nombre,
        ...(folderId && { parents: [folderId] }),
      },
      media: { mimeType: file.mimetype, body: fs.createReadStream(file.path) },
      fields: 'id',
    });
    return data.id;
  });
  creados.push(id);

  await conReintentos(`compartir ${nombre}`, () => drive.permissions.create({
    fileId: id,
    requestBody: { role: 'reader', type: 'user', emailAddress: SA_EMAIL },
    sendNotificationEmail: false,
  }));

  return id;
}

async function limpiarSubidasParciales(drive, ids) {
  for (const id of ids) {
    try {
      await drive.files.update({ fileId: id, requestBody: { trashed: true } });
      console.warn(`Drive: archivo ${id} de una subida incompleta movido a la papelera`);
    } catch (err) {
      console.error(`Drive: no se pudo limpiar ${id}: ${err.message}`);
    }
  }
}

// POST /api/drive/subir — requiere admin
// FormData: fotos[] (archivos), nombres (JSON array de strings)
// Sube a Google Drive con reintentos y devuelve { fileIds }.
// Si la subida falla definitivamente, mueve a la papelera lo que alcanzó a subir.
router.post('/subir', requireAdmin, uploadDisk.array('fotos', 20), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ error: 'No se recibieron archivos' });
  }

  const nombres = JSON.parse(req.body.nombres || '[]');
  const creados = [];
  let drive;

  try {
    drive = getOAuthDriveClient();
    const folderId = process.env.DRIVE_UPLOAD_FOLDER_ID;
    const desdeISO = new Date(Date.now() - 10000).toISOString();
    const fileIds = [];
    // Secuencial a propósito: subir 20 fotos en paralelo desde una
    // instancia de 512 MB era parte del problema de memoria.
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const nombre = limpiarNombreArchivo(nombres[i] || corregirNombreArchivo(file.originalname));
      const id = await subirArchivoADrive(drive, file, nombre, folderId, desdeISO, creados);
      fileIds.push(id);
    }

    res.json({ fileIds });
  } catch (err) {
    console.error('Drive subir error:', err.message);
    if (drive && creados.length) {
      await limpiarSubidasParciales(drive, creados);
    }
    const transitorio = esErrorTransitorio(err);
    res.status(500).json({
      error: 'Error al subir a Drive: ' + err.message + (transitorio
        ? ' (se reintentó automáticamente). Probá de nuevo en unos minutos.'
        : ''),
    });
  } finally {
    limpiarTmp(req.files);
  }
});

const ALLOWED_WIDTHS = new Set([200, 400, 800, 1200]);

// Tiempos máximos contra Drive. Sin ellos, una descarga colgada ocupaba para
// siempre uno de los 2 lugares del limitador y todas las imágenes nuevas
// quedaban esperando en la fila.
const DRIVE_META_TIMEOUT_MS = 15_000;
const DRIVE_DESCARGA_TIMEOUT_MS = 25_000;
// Las imágenes que tardan más que esto se registran en el log.
const IMAGEN_LENTA_MS = 5_000;

// Limitador global de trabajos de imagen. Antes solo limitaba la etapa
// de sharp: con 40 miniaturas pedidas a la vez, las 40 descargas desde
// Drive se bufferizaban en RAM al mismo tiempo (fotos de varios MB cada
// una) mientras esperaban su turno de sharp → pico de memoria → OOM.
// Ahora descarga + resize cuentan como UN trabajo y corren de a 2.
// Si `omitir()` devuelve true cuando le toca el turno (el visitante ya
// cerró la conexión), el trabajo no se ejecuta y el lugar pasa al siguiente.
let _jobsActive = 0;
const _jobQueue = [];
const MAX_IMAGE_JOBS = 2;
function siguienteDeLaCola() {
  if (_jobQueue.length > 0 && _jobsActive < MAX_IMAGE_JOBS) _jobQueue.shift()();
}
function withImageJobLimit(fn, omitir) {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (omitir && omitir()) {
        resolve();
        siguienteDeLaCola();
        return;
      }
      _jobsActive++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        _jobsActive--;
        siguienteDeLaCola();
      });
    };
    if (_jobsActive < MAX_IMAGE_JOBS) run();
    else _jobQueue.push(run);
  });
}

// Descarga el archivo de Drive completo en un Buffer. Se corta si la señal
// se aborta (tiempo agotado o visitante que se fue), liberando la conexión.
async function descargarBuffer(drive, fileId, signal) {
  const { data: flujo } = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream', signal },
  );
  return new Promise((resolve, reject) => {
    const chunks = [];
    const alAbortar = () => {
      flujo.destroy();
      reject(new Error('Descarga interrumpida'));
    };
    if (signal.aborted) return alAbortar();
    signal.addEventListener('abort', alAbortar, { once: true });
    flujo.on('data', c => chunks.push(c));
    flujo.on('end', () => {
      signal.removeEventListener('abort', alAbortar);
      resolve(Buffer.concat(chunks));
    });
    flujo.on('error', err => {
      signal.removeEventListener('abort', alAbortar);
      reject(err);
    });
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

  const inicio = Date.now();
  const ac = new AbortController();
  const estado = { vencido: false, cancelado: false, colaMs: 0, descargaMs: 0 };

  // Si el visitante cierra la conexión antes de recibir la imagen, se corta
  // lo que esté en curso y se descarta el trabajo si todavía está en la fila.
  res.on('close', () => {
    if (!res.writableFinished) {
      estado.cancelado = true;
      ac.abort();
    }
  });

  const conLimite = async (ms, fn) => {
    const timer = setTimeout(() => {
      estado.vencido = true;
      ac.abort();
    }, ms);
    try {
      return await fn();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const drive = getDriveClient();

    let meta = imageCache.get(fileId);
    if (!meta) {
      const metaRes = await conLimite(DRIVE_META_TIMEOUT_MS,
        () => drive.files.get({ fileId, fields: 'mimeType,name' }, { signal: ac.signal }));
      meta = metaRes.data;
      imageCache.set(fileId, meta);
      setTimeout(() => imageCache.delete(fileId), 3600_000);
    }

    if (!resize) {
      // Sin ?w válido: devolver original en streaming (no se bufferiza)
      res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const stream = await conLimite(DRIVE_META_TIMEOUT_MS,
        () => drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream', signal: ac.signal }));
      stream.data.on('error', () => res.destroy());
      res.on('close', () => stream.data.destroy());
      stream.data.pipe(res);
      return;
    }

    // 2) Con ?w válido: descarga + resize dentro del limitador global
    const entroEnLaFila = Date.now();
    await withImageJobLimit(async () => {
      estado.colaMs = Date.now() - entroEnLaFila;

      const inicioDescarga = Date.now();
      let buffer;
      try {
        buffer = await conLimite(DRIVE_DESCARGA_TIMEOUT_MS,
          () => descargarBuffer(drive, fileId, ac.signal));
      } finally {
        estado.descargaMs = Date.now() - inicioDescarga;
      }

      // Si el visitante ya se fue, no vale la pena gastar CPU en sharp.
      if (estado.cancelado || res.destroyed) return;

      try {
        const pipe = sharp(buffer).resize({ width: w, withoutEnlargement: true });
        const output = useWebp
          ? await pipe.webp({ quality: 78 }).toBuffer()
          : await pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();

        // La miniatura se guarda aunque el visitante se haya ido: la próxima visita ya la tiene.
        guardarEnCache(cachePathFor(fileId, w, ext), output);

        if (res.destroyed) return;
        res.setHeader('Content-Type', contentTypeOut);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Length', output.length);
        res.send(output);
      } catch (sharpErr) {
        // Fallback: devolver original si sharp no puede procesarlo
        console.error('Drive imagen sharp error:', sharpErr.message, '— enviando original');
        if (res.destroyed) return;
        res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(buffer);
      }
    }, () => estado.cancelado);
  } catch (err) {
    if (estado.cancelado || res.destroyed) {
      // El visitante cerró la conexión: no hay a quién responder.
    } else {
      console.error('Drive imagen error:', estado.vencido ? 'tiempo agotado esperando a Drive' : err.message);
      if (res.headersSent) {
        res.destroy();
      } else {
        // Un error transitorio no debe quedar cacheado en Cloudflare ni en el navegador.
        res.removeHeader('Content-Type');
        res.setHeader('Cache-Control', 'no-store');
        res.status(estado.vencido ? 504 : 404).send(estado.vencido ? 'Drive no respondió a tiempo' : 'Imagen no disponible');
      }
    }
  } finally {
    const total = Date.now() - inicio;
    if (total > IMAGEN_LENTA_MS || estado.vencido) {
      console.warn(
        `Imagen lenta: ${fileId} ${resize ? 'w=' + w : 'original'} total ${total} ms ` +
        `(fila ${estado.colaMs} ms, descarga ${estado.descargaMs} ms)` +
        `${estado.vencido ? ' [tiempo agotado]' : ''}${estado.cancelado ? ' [cancelada por el visitante]' : ''}`
      );
    }
  }
});

module.exports = router;
