const router = require('express').Router();
const { GoogleGenAI } = require('@google/genai');
const { requireAdmin } = require('../middleware/auth');

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

  const prompt = `Sos el asistente de contenido de PromoPlanet, una empresa argentina de productos promocionales corporativos.

Tu tarea es analizar información de un producto de proveedor y adaptarla al estilo editorial de PromoPlanet.

## Ejemplos de estilo PromoPlanet

Estos cinco ejemplos definen el estilo. Imitá su registro, su longitud y su estructura. No imites su contenido.

Cargador inalámbrico de bambú y RPET:
El cargador tiene base de bambú, un material renovable, y detalles en RPET.
Es compatible con carga inalámbrica QI y se conecta por USB.

Es ideal para kits de onboarding y programas de reconocimiento.

Libreta A6 de tapa dura:
La libreta tiene tapa dura, formato A6 y hojas rayadas.
Incluye banda elástica de cierre y señalador de tela al tono.

Apropiada para capacitaciones y kits de bienvenida.

Botella térmica deportiva:
La botella es de acero inoxidable de doble pared, con capacidad de 550 ml.
Mantiene frío hasta 24 horas y calor hasta 12.
La tapa cuenta con pico reforzado y sistema antiderrame, y la base es antideslizante.
Es libre de BPA y cuenta con aval del I.N.A.L.

Recomendada para kits de bienvenida y acciones de bienestar.

Mochila porta notebook:
La mochila está confeccionada en poliéster engomado impermeable.
Cuenta con compartimento para notebook de hasta 17 pulgadas, bolsillos de acceso rápido y banda de sujeción para valija.

Suele elegirse para reconocimientos y entregas a equipos de liderazgo.

Llavero metálico redondo:
El llavero es de metal, de formato redondo.

Es ideal para ferias, eventos y acciones de alcance amplio.

## Información del proveedor (${fuenteLabel})
${contenidoFuente}

## DESCRIPCIÓN

La descripción describe el producto como objeto: qué es, de qué está hecho, qué
incluye, cómo funciona. No describe la operación comercial ni le vende nada al
lector.

### BLOQUE 1 — el producto

De dos a cuatro oraciones.
Contenido: material, componentes, capacidad, funcionamiento, certificaciones.
Empezá con artículo y verbo: "La botella es de...", "El cuaderno tiene...",
"La mochila está confeccionada en...".
Nunca empieces con "Este" ni "Esta".
Cada oración va en su propia línea, sin líneas en blanco entre ellas.

### BLOQUE 2 — contexto de uso

Una sola oración corta, precedida de una línea en blanco.
Recomendá en qué tipo de entrega corporativa conviene el producto.

Alterná la construcción de una descripción a otra:
"Es ideal para...", "Apropiado para...", "Recomendado para...",
"Suele elegirse para...". No uses siempre la misma.

Lo que sigue tiene que ser un contexto concreto de entrega: kits de onboarding,
kits de bienvenida, capacitaciones, reconocimientos, ferias, eventos, fechas
especiales, acciones de bienestar. Nunca un valor abstracto de marca
(profesionalismo, innovación, sustentabilidad, estilo de vida).

Si vienen los campos Ocasiones y Destinatarios, usalos como base. Si están
vacíos, deducí el contexto de la categoría del producto.

Omití este bloque solamente si tendrías que inventar algo que los datos no
respaldan. Una descripción de dos oraciones es correcta.

### PROHIBIDO

1. Adjetivos valorativos: elegante, sofisticado, moderno, práctico, distintivo,
   versátil, exclusivo, premium, perfecto, innovador, funcional, consciente,
   responsable. Si el adjetivo no se puede verificar mirando el producto, no va.
   "Ideal" se admite únicamente en el bloque 2, seguido de un contexto concreto
   de entrega. Nunca en el bloque 1.

2. Fórmulas de cierre: "asociar tu marca con...", "el regalo corporativo ideal
   para...", "una excelente opción para...", "un estilo de vida...", "un toque
   de...", "en cada momento".

3. Información de la operación comercial: cantidad mínima, precio, rango de
   precio, plazos de entrega y técnicas de marcación o personalización. Tampoco
   de forma indirecta: nada de "artículo de entrega masiva", "opción accesible",
   "para grandes volúmenes". Esos datos tienen campos propios y cambian con el
   tiempo.

4. Medidas y colores. Tienen campos propios y no se repiten en el texto.

5. Datos inventados: certificaciones, materiales, capacidades o funciones que no
   aparezcan en la información del proveedor.

6. Negrita, cursiva, viñetas, emojis, signo "¿" de apertura.

7. Español neutro o peninsular. Usá "talle" (no "talla"), "cuaderno anillado"
   (no "espiralado"), "entregas" (no "despachos"), "vos" (no "tú" ni "contigo").

### MATERIALES ECO

Si el material incluye bambú, corcho, algodón orgánico, PET reciclado, RPET,
papel reciclado, trigo o PLA, identificalo con una aclaración de tres o cuatro
palabras dentro de la misma oración donde nombrás el material. Por ejemplo:
"base de bambú, un material renovable" o "cuerpo de PET reciclado".
No expliques por qué el material es renovable ni le dediques una oración aparte.
No uses etiquetas vacías: "consciente", "responsable", "amigable con el planeta".

Calibrá el alcance de la afirmación:
- Si el material eco es el cuerpo principal del producto, podés decir que el
  producto es de ese material.
- Si es un componente o un detalle (tapa, aplique, tapón, manija), atribuí la
  característica solo a esa parte. Nunca digas que el producto entero es
  ecológico o sustentable cuando el resto es plástico, símil cuero, poliéster
  o aluminio.

El mismo criterio vale para el badge "ecofriendly": no lo sugieras si lo eco es
apenas un detalle del producto.

Nunca menciones certificaciones (FSC, GRS, OEKO-TEX, GOTS) salvo que estén
explícitas en los datos del proveedor.

### FORMATO DE LA DESCRIPCIÓN

Cada oración del bloque 1 va en su propia línea.
Entre el bloque 1 y el bloque 2 va una línea en blanco.
Respetá esos saltos de línea en el valor del campo "descripcion".

## Reglas de formato de campos

### MEDIDAS
- Separador de dimensiones: el símbolo × (no la letra x), con un espacio a cada lado.
- Decimales con coma: 4,5 (nunca 4.5).
- Una sola unidad al final de la expresión, abreviada y con punto: cm. / mm. / m. Si el proveedor mezcla unidades, convertir todo a la más adecuada.
- No incluir la palabra "Medidas:" al inicio.
- Producto circular o cilíndrico: diámetro primero con el símbolo Ø, luego la otra medida. Ejemplo: Ø 4,5 × 23,4 cm. Sin aclaración entre paréntesis.
- Tres medidas: 14 × 2,5 × 2 cm. (largo × ancho × alto)
- Dos medidas no circulares: 14 × 2,5 cm. (largo × ancho) — la aclaración entre paréntesis indica las dimensiones que correspondan al producto, en el mismo orden que los números.
- Una sola medida: 23 cm. (largo) — o la dimensión que corresponda.
- Si el proveedor da medidas por variante o estado (abierto/cerrado, plegado/extendido): Abierto: 23 × 22 cm., Cerrado: 7 × 22 cm.
- Capacidad de drinkware: indicarla en ml con punto (473 ml.) además de las medidas físicas si están disponibles.

### COLORES
- Lista separada por coma y espacio, cada color con mayúscula inicial: Crudo, Azul marino, Verde.
- Sin conjunción "y" antes del último color.
- Usar nombres de color simples y consistentes; evitar nombres de fantasía del proveedor cuando exista un equivalente común.

## Tu respuesta debe ser un JSON válido con esta estructura exacta:
{
  "nombre": "Nombre del producto limpio y comercial (sin código ni marca de proveedor)",
  "descripcion": "Ver la sección DESCRIPCIÓN de este prompt.",
  "material": "Material principal del producto",
  "medidas": "Medidas formateadas según las reglas de formato, o cadena vacía si no hay.",
  "colores": "Colores formateados según las reglas de formato, o cadena vacía si no hay.",
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
