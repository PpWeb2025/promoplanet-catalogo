require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// MemoryStore es suficiente para uso local de un solo usuario
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }, // 8h
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/drive', require('./routes/drive'));
app.use('/api/consultas', require('./routes/consultas'));
app.use('/api/ia', require('./routes/ia'));

app.use(express.static(path.join(__dirname, '..')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`PromoPlanet corriendo en http://localhost:${PORT}`);
      console.log(`  Catálogo:  http://localhost:${PORT}/`);
      console.log(`  Admin:     http://localhost:${PORT}/admin.html`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err);
    process.exit(1);
  });
