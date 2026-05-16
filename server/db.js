const { createClient } = require('@libsql/client');

const JSON_FIELDS = ['tecnicas', 'destinatarios', 'ocasiones', 'fotos', 'badges'];

const KNOWN_COLUMNS = new Set([
  'id', 'codigo', 'nombre', 'categoria', 'rango', 'minimo', 'material',
  'medidas', 'colores', 'descripcion', 'tecnicas', 'destinatarios', 'ocasiones',
  'proveedor', 'notas', 'drive_code', 'subcategoria', 'estado', 'fecha_carga',
  'emoji', 'badge', 'badges', 'fotos', 'precio_proveedor',
]);

let client;

function parseRow(obj) {
  if (!obj) return null;
  const out = { ...obj };
  for (const f of JSON_FIELDS) {
    try { out[f] = JSON.parse(out[f] || '[]'); } catch { out[f] = []; }
  }
  return out;
}

function serializeRow(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (KNOWN_COLUMNS.has(k)) out[k] = v;
  }
  for (const f of JSON_FIELDS) {
    if (Array.isArray(out[f])) out[f] = JSON.stringify(out[f]);
  }
  return out;
}

async function query(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows.map(row => parseRow({ ...row }));
}

async function queryOne(sql, args = []) {
  const rows = await query(sql, args);
  return rows[0] || null;
}

async function initDb() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.TURSO_URL;
  client = createClient(
    isProduction
      ? { url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN }
      : { url: 'file:../promoplanet.db' }
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS productos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo        TEXT NOT NULL UNIQUE,
      nombre        TEXT NOT NULL,
      categoria     TEXT NOT NULL,
      rango         TEXT NOT NULL DEFAULT 'intermedio',
      minimo        INTEGER NOT NULL DEFAULT 50,
      material      TEXT DEFAULT '',
      medidas       TEXT DEFAULT '',
      colores       TEXT DEFAULT '',
      descripcion   TEXT DEFAULT '',
      tecnicas      TEXT DEFAULT '[]',
      destinatarios TEXT DEFAULT '[]',
      ocasiones     TEXT DEFAULT '[]',
      proveedor     TEXT DEFAULT '',
      notas         TEXT DEFAULT '',
      drive_code    TEXT DEFAULT '',
      subcategoria  TEXT DEFAULT '',
      estado        TEXT NOT NULL DEFAULT 'borrador',
      fecha_carga   TEXT NOT NULL,
      emoji            TEXT DEFAULT '📦',
      badge            TEXT DEFAULT '',
      fotos            TEXT DEFAULT '[]',
      precio_proveedor REAL DEFAULT NULL
    )
  `);

  for (const col of [
    "ALTER TABLE productos ADD COLUMN subcategoria TEXT DEFAULT ''",
    "ALTER TABLE productos ADD COLUMN badges TEXT DEFAULT '[]'",
    "ALTER TABLE productos ADD COLUMN precio_proveedor REAL DEFAULT NULL",
  ]) {
    try { await client.execute(col); } catch {}
  }

  const migracionCats = [
    ['kits',      'onboarding'],
    ['papeleria', 'escritorio'],
    ['bolsos',    'bolsos_mochilas'],
    ['cotidiano', 'escritorio'],
    ['premium',   'reconocimiento'],
  ];
  for (const [viejo, nuevo] of migracionCats) {
    await client.execute({ sql: 'UPDATE productos SET categoria = ? WHERE categoria = ?', args: [nuevo, viejo] });
  }
}

async function getProductos({ soloPublicados = false, cat = null, q = null } = {}) {
  let sql = 'SELECT * FROM productos';
  const args = [];
  const where = [];
  if (soloPublicados) where.push("estado = 'publicado'");
  if (cat)  { where.push('categoria = ?'); args.push(cat); }
  if (q) {
    where.push('(nombre LIKE ? OR codigo LIKE ? OR descripcion LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC';
  return query(sql, args);
}

async function getProductoById(id) {
  return queryOne('SELECT * FROM productos WHERE id = ?', [id]);
}

async function insertProducto(data) {
  const row = serializeRow({
    ...data,
    fecha_carga: data.fecha_carga || new Date().toISOString(),
  });
  delete row.id;
  const cols = Object.keys(row);
  const result = await client.execute({
    sql: `INSERT INTO productos (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    args: cols.map(c => row[c]),
  });
  return getProductoById(Number(result.lastInsertRowid));
}

async function updateProducto(id, data) {
  const row = serializeRow(data);
  delete row.id;
  const cols = Object.keys(row);
  await client.execute({
    sql: `UPDATE productos SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
    args: [...cols.map(c => row[c]), id],
  });
  return getProductoById(id);
}

async function deleteProducto(id) {
  await client.execute({ sql: 'DELETE FROM productos WHERE id = ?', args: [id] });
}

async function getProductoByCodigo(codigo) {
  return queryOne('SELECT * FROM productos WHERE codigo = ?', [codigo]);
}

module.exports = { initDb, getProductos, getProductoById, insertProducto, updateProducto, deleteProducto, getProductoByCodigo };
