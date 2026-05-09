const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'promoplanet.db');
const JSON_FIELDS = ['tecnicas', 'destinatarios', 'ocasiones', 'fotos', 'badges'];

let db;

function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function parseRow(obj) {
  if (!obj) return null;
  const out = { ...obj };
  for (const f of JSON_FIELDS) {
    try { out[f] = JSON.parse(out[f] || '[]'); } catch { out[f] = []; }
  }
  return out;
}

function serializeRow(data) {
  const out = { ...data };
  for (const f of JSON_FIELDS) {
    if (Array.isArray(out[f])) out[f] = JSON.stringify(out[f]);
  }
  return out;
}

// Ejecuta un SELECT y devuelve filas como array de objetos
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(parseRow(stmt.getAsObject()));
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

async function initDb() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`
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
      emoji         TEXT DEFAULT '📦',
      badge         TEXT DEFAULT '',
      fotos         TEXT DEFAULT '[]'
    )
  `);
  // Migraciones: agregar columnas si la DB ya existía sin ellas
  try { db.run("ALTER TABLE productos ADD COLUMN subcategoria TEXT DEFAULT ''"); } catch {}
  try { db.run("ALTER TABLE productos ADD COLUMN badges TEXT DEFAULT '[]'"); } catch {}

  // Migración: renombrar IDs de categoría viejos a los nuevos
  const migracionCats = [
    ['kits',      'onboarding'],
    ['papeleria',  'escritorio'],
    ['bolsos',     'bolsos_mochilas'],
    ['cotidiano',  'escritorio'],
    ['premium',    'reconocimiento'],
  ];
  for (const [viejo, nuevo] of migracionCats) {
    db.run('UPDATE productos SET categoria = ? WHERE categoria = ?', [nuevo, viejo]);
  }

  save();
}

function getProductos({ soloPublicados = false, cat = null, q = null } = {}) {
  let sql = 'SELECT * FROM productos';
  const params = [];
  const where = [];
  if (soloPublicados) where.push("estado = 'publicado'");
  if (cat) { where.push('categoria = ?'); params.push(cat); }
  if (q) {
    where.push('(nombre LIKE ? OR codigo LIKE ? OR descripcion LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC';
  return query(sql, params);
}

function getProductoById(id) {
  return queryOne('SELECT * FROM productos WHERE id = ?', [id]);
}

function insertProducto(data) {
  const row = serializeRow({
    ...data,
    fecha_carga: data.fecha_carga || new Date().toISOString(),
  });
  delete row.id;
  const cols = Object.keys(row);
  db.run(
    `INSERT INTO productos (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map(c => row[c])
  );
  const newId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  save();
  return getProductoById(newId);
}

function updateProducto(id, data) {
  const row = serializeRow(data);
  delete row.id;
  const cols = Object.keys(row);
  db.run(
    `UPDATE productos SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map(c => row[c]), id]
  );
  save();
  return getProductoById(id);
}

function deleteProducto(id) {
  db.run('DELETE FROM productos WHERE id = ?', [id]);
  save();
}

module.exports = { initDb, getProductos, getProductoById, insertProducto, updateProducto, deleteProducto };
