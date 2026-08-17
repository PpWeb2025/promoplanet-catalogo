const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

router.get('/', requireAdmin, async (req, res) => {
  res.json(await db.getPropuestas());
});

router.get('/:id', requireAdmin, async (req, res) => {
  const p = await db.getPropuestaById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json(p);
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const propuesta = await db.insertPropuesta(req.body);
    res.status(201).json(propuesta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const p = await db.getPropuestaById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  try {
    const actualizado = await db.updatePropuesta(req.params.id, req.body);
    res.json(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const p = await db.getPropuestaById(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  await db.deletePropuesta(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
