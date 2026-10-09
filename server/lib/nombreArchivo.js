// Multer/busboy entrega los nombres de archivo como latin1: "metalica" con tilde llega como "metÃ¡lica".
// Sin escapes \u ni caracteres especiales literales: se comparan codigos con codePointAt.

function tieneMojibake(texto) {
  const chars = Array.from(String(texto || ''));
  for (let i = 0; i < chars.length - 1; i++) {
    const actual = chars[i].codePointAt(0);
    const siguiente = chars[i + 1].codePointAt(0);
    if ((actual === 0xC2 || actual === 0xC3) && siguiente >= 0x80 && siguiente <= 0xBF) return true;
  }
  return false;
}

function corregirNombreArchivo(nombre) {
  if (!nombre) return nombre;
  if (!tieneMojibake(nombre)) return nombre;
  const decodificado = Buffer.from(nombre, 'latin1').toString('utf8');
  for (const ch of decodificado) {
    if (ch.codePointAt(0) === 0xFFFD) return nombre;
  }
  return decodificado;
}

// Quita caracteres que Drive o el sistema de archivos no toleran y espacios repetidos.
function limpiarNombreArchivo(nombre) {
  const prohibidos = '\\/:*?"<>|';
  let salida = '';
  for (const ch of String(nombre || '')) {
    const code = ch.codePointAt(0);
    salida += (code < 32 || prohibidos.includes(ch)) ? ' ' : ch;
  }
  return salida.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { corregirNombreArchivo, limpiarNombreArchivo };
