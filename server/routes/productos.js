const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

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

module.exports = router;
