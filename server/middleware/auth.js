function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  res.status(401).json({ error: 'No autorizado' });
}

module.exports = { requireAdmin };
