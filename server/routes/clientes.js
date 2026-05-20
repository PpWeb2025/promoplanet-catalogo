const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

router.get('/', async (req, res) => {
  res.json(await db.getClientes(req.query.q || null));
});

router.get('/:id', async (req, res) => {
  const c = await db.getClienteById(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  res.json(c);
});

router.post('/', requireAdmin, async (req, res) => {
  const { razon_social } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ error: 'La razón social es obligatoria' });
  try {
    const cliente = await db.insertCliente({
      ...req.body,
      razon_social: razon_social.trim(),
      fecha_alta: new Date().toISOString(),
    });
    res.status(201).json(cliente);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const c = await db.getClienteById(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  const { razon_social } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ error: 'La razón social es obligatoria' });
  try {
    const actualizado = await db.updateCliente(req.params.id, { ...req.body, razon_social: razon_social.trim() });
    res.json(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const c = await db.getClienteById(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  await db.deleteCliente(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
