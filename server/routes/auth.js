const router = require('express').Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (
    !username || !password ||
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  req.session.admin = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (req.session && req.session.admin) return res.json({ ok: true });
  res.status(401).json({ error: 'No autorizado' });
});

module.exports = router;
