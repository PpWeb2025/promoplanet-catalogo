function redirectOnrender(req, res, next) {
  if (req.headers.host && req.headers.host.toLowerCase() === 'promoplanet-catalogo.onrender.com') {
    return res.redirect(301, 'https://promoplanet.ar' + req.originalUrl);
  }
  next();
}

module.exports = redirectOnrender;
