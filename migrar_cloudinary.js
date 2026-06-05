#!/usr/bin/env node
/**
 * migrar_cloudinary.js
 *
 * Agrega parámetros de optimización a todas las URLs de Cloudinary ya
 * almacenadas en la base de datos que todavía no los tienen.
 *
 * Tablas y campos afectados:
 *   productos.fotos   — JSON array de URLs
 *   marcas.logo_url   — URL directa
 *
 * Transformación aplicada:
 *   /upload/<versión o path>  →  /upload/f_auto,q_auto,w_800/<versión o path>
 *
 * URLs que ya tienen parámetros (contienen "/upload/f_auto") se omiten.
 *
 * Uso:
 *   node migrar_cloudinary.js          → usa SQLite local (promoplanet.db)
 *   node migrar_cloudinary.js --dry    → muestra qué cambiaría sin escribir
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');

const DRY = process.argv.includes('--dry');
const TRANSFORM = 'f_auto,q_auto,w_800';

const client = createClient(
  process.env.TURSO_URL
    ? { url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN }
    : { url: 'file:./promoplanet.db' }
);

function necesitaTransform(url) {
  return (
    typeof url === 'string' &&
    url.includes('res.cloudinary.com') &&
    !url.includes('/upload/f_auto')
  );
}

function aplicarTransform(url) {
  return url.replace('/upload/', `/upload/${TRANSFORM}/`);
}

async function migrarProductos() {
  const { rows } = await client.execute('SELECT id, codigo, fotos FROM productos');
  let actualizados = 0;
  let urlsMigradas = 0;

  for (const row of rows) {
    let fotos;
    try { fotos = JSON.parse(row.fotos || '[]'); } catch { fotos = []; }

    const nuevasFotos = fotos.map(url => {
      if (necesitaTransform(url)) { urlsMigradas++; return aplicarTransform(url); }
      return url;
    });

    if (JSON.stringify(fotos) !== JSON.stringify(nuevasFotos)) {
      if (DRY) {
        console.log(`  [productos] id=${row.id} (${row.codigo})`);
        fotos.forEach((url, i) => {
          if (url !== nuevasFotos[i]) console.log(`    - ${url}\n    + ${nuevasFotos[i]}`);
        });
      } else {
        await client.execute({
          sql: 'UPDATE productos SET fotos = ? WHERE id = ?',
          args: [JSON.stringify(nuevasFotos), row.id],
        });
      }
      actualizados++;
    }
  }

  return { total: rows.length, actualizados, urlsMigradas };
}

async function migrarMarcas() {
  const { rows } = await client.execute('SELECT id, nombre, logo_url FROM marcas');
  let actualizados = 0;

  for (const row of rows) {
    if (!necesitaTransform(row.logo_url)) continue;

    const nuevo = aplicarTransform(row.logo_url);
    if (DRY) {
      console.log(`  [marcas] id=${row.id} (${row.nombre})`);
      console.log(`    - ${row.logo_url}\n    + ${nuevo}`);
    } else {
      await client.execute({
        sql: 'UPDATE marcas SET logo_url = ? WHERE id = ?',
        args: [nuevo, row.id],
      });
    }
    actualizados++;
  }

  return { total: rows.length, actualizados };
}

async function main() {
  console.log(`Migración Cloudinary — PromoPlanet${DRY ? ' (DRY RUN, sin cambios)' : ''}`);
  console.log('='.repeat(50));

  const productos = await migrarProductos();
  const marcas    = await migrarMarcas();

  console.log('\nResumen:');
  console.log(`  productos.fotos  → ${productos.actualizados} filas con cambios (${productos.urlsMigradas} URLs) de ${productos.total} total`);
  console.log(`  marcas.logo_url  → ${marcas.actualizados} filas con cambios de ${marcas.total} total`);

  if (DRY) {
    console.log('\nEjecutá sin --dry para aplicar los cambios.');
  } else {
    console.log('\nListo.');
  }
}

main().then(() => process.exit(0)).catch(err => { console.error('Error:', err.message); process.exit(1); });
