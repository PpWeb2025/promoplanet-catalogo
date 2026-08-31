const { createClient } = require('@libsql/client');

const JSON_FIELDS = ['tecnicas', 'destinatarios', 'ocasiones', 'fotos', 'badges'];

const KNOWN_COLUMNS = new Set([
  'id', 'codigo', 'nombre', 'categoria', 'rango', 'minimo', 'material',
  'medidas', 'colores', 'descripcion', 'tecnicas', 'destinatarios', 'ocasiones',
  'proveedor', 'notas', 'drive_code', 'subcategoria', 'estado', 'fecha_carga',
  'emoji', 'badge', 'badges', 'fotos', 'precio_proveedor', 'marca_id', 'created_at',
]);

let client;

const PROVEEDOR_PROMOCION_UMBRAL = 3;

function normalizeProveedor(s) {
  // Descompone a NFD y descarta los diacríticos combinantes (U+0300 a U+036F)
  const desc = (s || '').trim().toLowerCase().normalize('NFD');
  let out = '';
  for (const ch of desc) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    out += ch;
  }
  return out;
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
    CREATE TABLE IF NOT EXISTS marcas (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre   TEXT NOT NULL UNIQUE,
      logo_url TEXT DEFAULT ''
    )
  `);

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
    "ALTER TABLE productos ADD COLUMN marca_id INTEGER DEFAULT NULL",
    "ALTER TABLE productos ADD COLUMN created_at TEXT DEFAULT '2020-01-01'",
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

  await client.execute(`
    CREATE TABLE IF NOT EXISTS clientes (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      razon_social        TEXT NOT NULL,
      contacto            TEXT,
      cargo               TEXT,
      email               TEXT,
      telefono            TEXT,
      condicion_pago      TEXT DEFAULT '30 días corridos desde la fecha de factura',
      plazo_entrega       TEXT DEFAULT '15 días hábiles',
      envio               TEXT DEFAULT 'Sin costo dentro de CABA y Buenos Aires (primer cordón)',
      validez_presupuesto INTEGER DEFAULT 7,
      notas               TEXT,
      fecha_alta          TEXT
    )
  `);

  await client.execute(`ALTER TABLE clientes ADD COLUMN produccion TEXT`)
    .catch(e => { if (!String(e.message || e).includes('duplicate column')) console.error('ALTER clientes produccion:', e); });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS propuestas (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id           INTEGER,
      cliente_nombre       TEXT DEFAULT '',
      estado               TEXT NOT NULL DEFAULT 'borrador',
      productos            TEXT DEFAULT '[]',
      cliente_form         TEXT DEFAULT '{}',
      fecha_creacion       TEXT NOT NULL,
      fecha_actualizacion  TEXT NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS proveedores (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre             TEXT NOT NULL,
      nombre_normalizado TEXT NOT NULL UNIQUE,
      creado_at          TEXT DEFAULT (datetime('now'))
    )
  `);

  for (const nombre of ['Zecat', 'Stocksur', 'Xtrade', 'Improm', 'Nuevas Formas', 'Maya']) {
    await client.execute({
      sql: 'INSERT OR IGNORE INTO proveedores (nombre, nombre_normalizado) VALUES (?, ?)',
      args: [nombre, normalizeProveedor(nombre)],
    });
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
    created_at: new Date().toISOString(),
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
  delete row.created_at;
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

async function getMarcas() {
  return query('SELECT * FROM marcas ORDER BY nombre ASC');
}

async function getMarcaById(id) {
  return queryOne('SELECT * FROM marcas WHERE id = ?', [id]);
}

async function insertMarca(data) {
  const result = await client.execute({
    sql: 'INSERT INTO marcas (nombre, logo_url) VALUES (?, ?)',
    args: [data.nombre, data.logo_url || ''],
  });
  return getMarcaById(Number(result.lastInsertRowid));
}

async function updateMarca(id, data) {
  await client.execute({
    sql: 'UPDATE marcas SET nombre = ?, logo_url = ? WHERE id = ?',
    args: [data.nombre, data.logo_url || '', id],
  });
  return getMarcaById(id);
}

async function deleteMarca(id) {
  await client.execute({ sql: 'DELETE FROM marcas WHERE id = ?', args: [id] });
}

const CLIENTE_COLS = ['razon_social','contacto','cargo','email','telefono','condicion_pago','plazo_entrega','envio','validez_presupuesto','notas'];

async function getClientes(q = null) {
  let sql = 'SELECT * FROM clientes';
  const args = [];
  if (q) { sql += ' WHERE razon_social LIKE ?'; args.push(`%${q}%`); }
  sql += ' ORDER BY razon_social ASC';
  return query(sql, args);
}

async function getClienteById(id) {
  return queryOne('SELECT * FROM clientes WHERE id = ?', [id]);
}

async function insertCliente(data) {
  const row = {};
  for (const c of [...CLIENTE_COLS, 'fecha_alta']) if (data[c] !== undefined) row[c] = data[c];
  const keys = Object.keys(row);
  const result = await client.execute({
    sql: `INSERT INTO clientes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    args: keys.map(k => row[k]),
  });
  return getClienteById(Number(result.lastInsertRowid));
}

async function updateCliente(id, data) {
  const row = {};
  for (const c of CLIENTE_COLS) if (data[c] !== undefined) row[c] = data[c];
  const keys = Object.keys(row);
  await client.execute({
    sql: `UPDATE clientes SET ${keys.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
    args: [...keys.map(k => row[k]), id],
  });
  return getClienteById(id);
}

async function deleteCliente(id) {
  await client.execute({ sql: 'DELETE FROM clientes WHERE id = ?', args: [id] });
}

async function getPropuestas() {
  return query(
    `SELECT id, cliente_id, cliente_nombre, estado, fecha_creacion, fecha_actualizacion,
            COALESCE(json_array_length(productos), 0) AS cantidad_productos
     FROM propuestas
     ORDER BY fecha_actualizacion DESC`
  );
}

async function getPropuestaById(id) {
  const row = await queryOne('SELECT * FROM propuestas WHERE id = ?', [id]);
  if (!row) return null;
  try { row.productos    = JSON.parse(row.productos    || '[]'); } catch { row.productos    = []; }
  try { row.cliente_form = JSON.parse(row.cliente_form || '{}'); } catch { row.cliente_form = {}; }
  return row;
}

async function insertPropuesta(data) {
  const now = new Date().toISOString();
  const clienteNombre = (data.cliente_form && data.cliente_form.razon_social) || data.cliente_nombre || '';
  const result = await client.execute({
    sql: `INSERT INTO propuestas (cliente_id, cliente_nombre, estado, productos, cliente_form, fecha_creacion, fecha_actualizacion)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.cliente_id || null,
      clienteNombre,
      data.estado || 'borrador',
      JSON.stringify(data.productos    || []),
      JSON.stringify(data.cliente_form || {}),
      now,
      now,
    ],
  });
  return getPropuestaById(Number(result.lastInsertRowid));
}

async function updatePropuesta(id, data) {
  const now = new Date().toISOString();
  const clienteNombre = (data.cliente_form && data.cliente_form.razon_social) || data.cliente_nombre || '';
  await client.execute({
    sql: `UPDATE propuestas SET cliente_id = ?, cliente_nombre = ?, estado = ?, productos = ?, cliente_form = ?, fecha_actualizacion = ?
          WHERE id = ?`,
    args: [
      data.cliente_id !== undefined ? data.cliente_id : null,
      clienteNombre,
      data.estado || 'borrador',
      JSON.stringify(data.productos    || []),
      JSON.stringify(data.cliente_form || {}),
      now,
      id,
    ],
  });
  return getPropuestaById(id);
}

async function deletePropuesta(id) {
  await client.execute({ sql: 'DELETE FROM propuestas WHERE id = ?', args: [id] });
}

async function getProveedores() {
  return query('SELECT * FROM proveedores ORDER BY nombre ASC');
}

async function getCanonicoProveedor(nombre) {
  const norm = normalizeProveedor(nombre);
  if (!norm) return (nombre || '').trim();
  const p = await queryOne('SELECT nombre FROM proveedores WHERE nombre_normalizado = ?', [norm]);
  return p ? p.nombre : (nombre || '').trim();
}

async function checkYPromoverProveedor(nombre) {
  const norm = normalizeProveedor(nombre);
  if (!norm) return null;
  const existente = await queryOne('SELECT id FROM proveedores WHERE nombre_normalizado = ?', [norm]);
  if (existente) return null;
  const todos = await query("SELECT id, proveedor FROM productos WHERE proveedor != ''");
  const coinciden = todos.filter(r => normalizeProveedor(r.proveedor) === norm);
  const idsDistintos = [...new Set(coinciden.map(r => r.id))];
  if (idsDistintos.length < PROVEEDOR_PROMOCION_UMBRAL) return null;
  const canonico = coinciden.sort((a, b) => a.id - b.id)[0].proveedor.trim();
  await client.execute({
    sql: 'INSERT OR IGNORE INTO proveedores (nombre, nombre_normalizado) VALUES (?, ?)',
    args: [canonico, norm],
  });
  for (const r of coinciden) {
    if (r.proveedor !== canonico) {
      await client.execute({ sql: 'UPDATE productos SET proveedor = ? WHERE id = ?', args: [canonico, r.id] });
    }
  }
  return { nombre: canonico, conteo: idsDistintos.length };
}

async function getProveedoresCandidatos() {
  const promovidos = await query('SELECT nombre_normalizado FROM proveedores');
  const normsPromovidos = new Set(promovidos.map(p => p.nombre_normalizado));
  const todos = await query("SELECT id, proveedor FROM productos WHERE proveedor != ''");
  const grupos = {};
  for (const r of todos) {
    const norm = normalizeProveedor(r.proveedor);
    if (!norm || normsPromovidos.has(norm)) continue;
    if (!grupos[norm]) grupos[norm] = { ids: new Set(), primerNombre: r.proveedor, primerId: r.id };
    grupos[norm].ids.add(r.id);
    if (r.id < grupos[norm].primerId) { grupos[norm].primerId = r.id; grupos[norm].primerNombre = r.proveedor; }
  }
  return Object.entries(grupos)
    .filter(([, g]) => g.ids.size >= PROVEEDOR_PROMOCION_UMBRAL)
    .map(([norm, g]) => ({ nombre: g.primerNombre, nombre_normalizado: norm, conteo: g.ids.size }))
    .sort((a, b) => b.conteo - a.conteo);
}

async function getProductosANormalizar() {
  const promovidos = await query('SELECT nombre, nombre_normalizado FROM proveedores');
  const todos = await query("SELECT id, codigo, nombre, proveedor FROM productos WHERE proveedor != ''");
  const ajustes = [];
  for (const r of todos) {
    const norm = normalizeProveedor(r.proveedor);
    const prom = promovidos.find(p => p.nombre_normalizado === norm);
    if (prom && r.proveedor !== prom.nombre) {
      ajustes.push({ id: r.id, codigo: r.codigo, nombre: r.nombre, de: r.proveedor, a: prom.nombre });
    }
  }
  return ajustes;
}

async function normalizarProductosExistentes() {
  const ajustes = await getProductosANormalizar();
  for (const a of ajustes) {
    await client.execute({ sql: 'UPDATE productos SET proveedor = ? WHERE id = ?', args: [a.a, a.id] });
  }
  return ajustes;
}

async function promoverRetroactivo() {
  const ajustes = await normalizarProductosExistentes();
  const candidatos = await getProveedoresCandidatos();
  const promovidos = [];
  for (const c of candidatos) {
    const promovido = await checkYPromoverProveedor(c.nombre);
    if (promovido) promovidos.push(promovido);
  }
  return { ajustes, promovidos };
}

module.exports = {
  initDb,
  getProductos, getProductoById, insertProducto, updateProducto, deleteProducto, getProductoByCodigo,
  getMarcas, getMarcaById, insertMarca, updateMarca, deleteMarca,
  getClientes, getClienteById, insertCliente, updateCliente, deleteCliente,
  getPropuestas, getPropuestaById, insertPropuesta, updatePropuesta, deletePropuesta,
  getProveedores, getCanonicoProveedor, checkYPromoverProveedor,
  getProveedoresCandidatos, getProductosANormalizar, normalizarProductosExistentes, promoverRetroactivo,
};
