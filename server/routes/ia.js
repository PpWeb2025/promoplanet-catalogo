const router = require('express').Router();
const { GoogleGenAI } = require('@google/genai');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');

async function fetchTextoDesdeURL(url) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PromoPlanetBot/1.0)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al acceder a ${url}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 6000);
}

const CATEGORIAS = {
  bolsos_mochilas: 'Bolsos y Mochilas',
  drinkware:       'Drinkware',
  escritorio:      'Escritorio y Oficina',
  escritura:       'Escritura',
  indumentaria:    'Indumentaria Corporativa',
  llaveros:        'Llaveros y Accesorios',
  outdoors:        'Outdoors y Fitness',
  bienestar:       'Bienestar y Autocuidado',
  packaging:       'Packaging y Presentación',
  tecnologia:      'Tecnología',
  hogar:           'Hogar y Cocina',
};

const SUBCATEGORIAS = {
  bolsos_mochilas: ['Bolsos','Maletines y portfolios','Mochilas','Necessaires y accesorios','Tote bags y bolsas','Valijas y carry on'],
  drinkware:       ['Botellas standard','Botellas térmicas','Jarros y mugs','Mates y accesorios','Termos'],
  escritorio:      ['Cuadernos y agendas','Organizadores'],
  escritura:       ['Bolígrafos ecológicos','Bolígrafos metálicos','Bolígrafos plásticos','Escritura fina','Lápices','Marcadores y resaltadores'],
  indumentaria:    ['Abrigos','Delantales y pecheras','Gorras','Remeras y chombas'],
  llaveros:        ['Llaveros ecológicos','Llaveros plásticos','Llaveros metálicos','Llaveros multipropósito','Pins','Portacredenciales'],
  outdoors:        ['Camping','Gastronomía','Paraguas','Cooler y loncheras'],
  bienestar:       ['Cuidado personal','Ambientación'],
  packaging:       ['Bolsas','Cajas','Stickers'],
  tecnologia:      ['Accesorios de escritorio','Accesorios para celular','Audio','Carga y conectividad'],
  hogar:           ['Accesorios de cocina','Loncheras','Sets de vino y accesorios','Decoración'],
};

// Lista de IDs válidos generada desde CATEGORIAS (fuente única de verdad)
const CATEGORIA_IDS = Object.keys(CATEGORIAS).join(', ');

async function generarConReintento(ai, params, maxIntentos = 3) {
  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      ultimoError = err;
      const esSobrecarga = err?.status === 'UNAVAILABLE' || err?.status === 503 ||
        /503|UNAVAILABLE|overloaded|high demand/i.test(err?.message || '');
      if (esSobrecarga && intento < maxIntentos) {
        await new Promise(r => setTimeout(r, intento * 1500)); // espera creciente: 1.5s, 3s
        continue;
      }
      throw err;
    }
  }
  throw ultimoError;
}

router.post('/adaptar', requireAdmin, async (req, res) => {
  let { texto, url, textoManual } = req.body;

  let textoScraped = '';
  if (url) {
    try {
      textoScraped = await fetchTextoDesdeURL(url);
    } catch (err) {
      console.error('Error al scrapear URL:', err.message);
    }
  }

  const partes = [];
  if (textoManual?.trim()) partes.push(`## Texto pegado por el usuario (prioritario)\n${textoManual.trim()}`);
  if (textoScraped)        partes.push(`## Contenido de la página del proveedor\n${textoScraped}`);
  if (texto?.trim() && !textoScraped && !textoManual) partes.push(texto.trim());

  const contenidoFuente = partes.join('\n\n---\n\n');
  if (!contenidoFuente) return res.status(400).json({ error: 'Enviá texto o URL del producto' });

  const fuenteLabel = [
    textoManual?.trim() ? 'texto pegado manualmente' : null,
    textoScraped        ? `página web: ${url}`        : null,
    texto?.trim() && !textoScraped && !textoManual ? 'texto' : null,
  ].filter(Boolean).join(' + ') || 'texto';

  const muestra = (await db.getProductos({ soloPublicados: true }))
    .filter(p => p.descripcion && p.descripcion.length > 40)
    .slice(0, 8)
    .map(p => `Producto: ${p.nombre}\nDescripción: ${p.descripcion}\nCategoría: ${CATEGORIAS[p.categoria] || p.categoria}${p.material ? `\nMaterial: ${p.material}` : ''}${p.tecnicas?.length ? `\nTécnicas: ${p.tecnicas.join(', ')}` : ''}`)
    .join('\n\n---\n\n');

  const prompt = `Sos el asistente de contenido de PromoPlanet, una empresa argentina de productos promocionales corporativos.

Tu tarea es analizar información de un producto de proveedor y adaptarla al estilo editorial de PromoPlanet.

## Ejemplos de estilo PromoPlanet
${muestra || 'No hay productos de referencia aún — usá un tono profesional, directo y orientado a empresas argentinas.'}

## Información del proveedor (${fuenteLabel})
${contenidoFuente}

## Tu respuesta debe ser un JSON válido con esta estructura exacta:
{
  "nombre": "Nombre del producto limpio y comercial (sin código ni marca de proveedor)",
  "descripcion": "Descripción en el estilo PromoPlanet: 2-3 oraciones, tono profesional, orientada a empresas, resalta el valor del producto como regalo o artículo promocional. En español rioplatense.",
  "material": "Material principal del producto",
  "medidas": "Medidas si las hay, sino vacío",
  "colores": "Colores disponibles si los hay, sino vacío",
  "categoria": "Una de estas exactas: ${CATEGORIA_IDS}",
  "tecnicas": ["array", "con", "técnicas de personalización sugeridas de esta lista: laser, dtf, tampografia, bordado, sublimacion, hotstamping, serigrafia, dtf-textil"],
  "badges": ["array con badges sugeridos de: sale, oportunidad, nuevo, ecofriendly, termico, premium, popular, exclusivo, corporativo, importado, kit, limitado"],
  "rango": "economico, intermedio o premium según el perfil del producto"
}

Respondé SOLO con el JSON, sin texto adicional antes ni después.`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await generarConReintento(ai, {
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const json = JSON.parse(response.text);
    res.json(json);
  } catch (err) {
    console.error('Error IA:', err.message);
    res.status(500).json({ error: 'No se pudo procesar con IA. Intentá de nuevo.' });
  }
});

router.post('/analizar-fotos', requireAdmin, async (req, res) => {
  const { fotos, urlProveedor, textoManual } = req.body;
  if (!Array.isArray(fotos) || !fotos.length) {
    return res.status(400).json({ error: 'Se esperaba un array de fotos' });
  }

  const catList = Object.entries(CATEGORIAS)
    .map(([id, nombre]) => {
      const subs = SUBCATEGORIAS[id];
      return subs?.length ? `${id} (${nombre}): subcats → ${subs.join(', ')}` : `${id} (${nombre})`;
    })
    .join('\n');

  let textoScraped = '';
  if (urlProveedor) {
    try {
      textoScraped = await fetchTextoDesdeURL(urlProveedor);
    } catch { /* ignorar */ }
  }

  const contextoParts = [];
  if (textoManual?.trim()) contextoParts.push(`## Texto pegado por el usuario (prioritario)\n${textoManual.trim().slice(0, 2000)}`);
  if (textoScraped)        contextoParts.push(`## Contenido de la página del proveedor\n${textoScraped.slice(0, 3000)}`);
  const tieneContexto = contextoParts.length > 0;
  const contextoProveedor = tieneContexto
    ? `\n\n## Información del proveedor (prioritaria para el nombre y descripción)\n${contextoParts.join('\n\n---\n\n')}`
    : '';

  const prompt = `Analizá las imágenes de este producto promocional corporativo argentino${tieneContexto ? ' y la información del proveedor incluida abajo' : ''}.

${tieneContexto ? 'Priorizá el nombre y la descripción del proveedor sobre lo que muestra la imagen sola, ya que la imagen puede ser genérica o de catálogo.' : ''}

Respondé con un JSON:
{
  "nombre": "Nombre descriptivo y comercial del producto, sin código ni marca de proveedor, en español",
  "categoria": "ID de categoría de esta lista:\n${catList}",
  "subcategoria": "Nombre exacto de subcategoría de la lista de arriba, o cadena vacía si no aplica"
}${contextoProveedor}

Respondé SOLO con el JSON, sin texto adicional.`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await generarConReintento(ai, {
      model: 'gemini-2.5-flash',
      contents: [
        ...fotos.slice(0, 4).map(f => ({ inlineData: { mimeType: f.mimeType, data: f.base64 } })),
        { text: prompt },
      ],
      config: { responseMimeType: 'application/json' },
    });
    const json = JSON.parse(response.text);
    res.json(json);
  } catch (err) {
    console.error('Error IA analizar-fotos:', err.message);
    res.status(500).json({ error: 'No se pudo analizar con IA. Intentá de nuevo.' });
  }
});

module.exports = router;
