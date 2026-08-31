const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

router.get('/', requireAdmin, async (req, res) => {
  res.json(await db.getProveedores());
});

router.get('/candidatos', requireAdmin, async (req, res) => {
  const [candidatos, ajustes] = await Promise.all([
    db.getProveedoresCandidatos(),
    db.getProductosANormalizar(),
  ]);
  res.json({ candidatos, ajustes });
});

router.post('/retroactivo', requireAdmin, async (req, res) => {
  const resultado = await db.promoverRetroactivo();
  res.json(resultado);
});

module.exports = router;
