const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

router.get('/', async (req, res) => {
  res.json(await db.getMarcas());
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
