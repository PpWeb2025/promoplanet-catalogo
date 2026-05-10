const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
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
  // Eliminar scripts, estilos y etiquetas HTML; colapsar espacios
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
    .slice(0, 6000); // Limitar para no exceder tokens
}

const CATEGORIAS = {
  bolsos_mochilas: 'Bolsos y Mochilas',
  capacitacion: 'Capacitación y Eventos',
  drinkware: 'Drinkware',
  eco: 'Eco y Sustentable',
  escritorio: 'Escritorio y Oficina',
  escritura: 'Escritura',
  fechas: 'Fechas Especiales',
  indumentaria: 'Indumentaria Corporativa',
  llaveros: 'Llaveros y Accesorios',
  onboarding: 'Onboarding y Bienvenida',
  outdoors: 'Outdoors y Bienestar',
  packaging: 'Packaging y Presentación',
  reconocimiento: 'Reconocimiento y Premios',
  tecnologia: 'Tecnología',
};

router.post('/adaptar', requireAdmin, async (req, res) => {
  let { texto, url } = req.body;
  if (!texto && !url) return res.status(400).json({ error: 'Enviá texto o URL del producto' });

  // Si se recibió una URL, hacer fetch del contenido
  if (url) {
    try {
      texto = await fetchTextoDesdeURL(url);
    } catch (err) {
      console.error('Error al scrapear URL:', err.message);
      return res.status(400).json({ error: `No se pudo acceder a la página: ${err.message}` });
    }
  }

  // Tomar hasta 8 productos publicados como referencia de estilo
  const muestra = (await db.getProductos({ soloPublicados: true }))
    .filter(p => p.descripcion && p.descripcion.length > 40)
    .slice(0, 8)
    .map(p => `Producto: ${p.nombre}\nDescripción: ${p.descripcion}\nCategoría: ${CATEGORIAS[p.categoria] || p.categoria}${p.material ? `\nMaterial: ${p.material}` : ''}${p.tecnicas?.length ? `\nTécnicas: ${p.tecnicas.join(', ')}` : ''}`)
    .join('\n\n---\n\n');

  const fuenteLabel = url ? `Página web: ${url}` : 'Texto pegado manualmente';
  const contenidoFuente = texto;

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
  "categoria": "Una de estas exactas: bolsos_mochilas, capacitacion, drinkware, eco, escritorio, escritura, fechas, indumentaria, llaveros, onboarding, outdoors, packaging, reconocimiento, tecnologia",
  "tecnicas": ["array", "con", "técnicas de personalización sugeridas de esta lista: laser, dtf, tampografia, bordado, sublimacion, hotstamping, serigrafia, dtf-textil"],
  "badges": ["array con badges sugeridos de: sale, oportunidad, nuevo, ecofriendly, termico, premium, popular, exclusivo, corporativo, importado, kit, limitado"],
  "rango": "economico, intermedio o premium según el perfil del producto"
}

Respondé SOLO con el JSON, sin texto adicional antes ni después.`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const json = JSON.parse(raw.replace(/^```json\n?/, '').replace(/\n?```$/, ''));
    res.json(json);
  } catch (err) {
    console.error('Error IA:', err.message);
    res.status(500).json({ error: 'No se pudo procesar con IA. Intentá de nuevo.' });
  }
});

module.exports = router;
