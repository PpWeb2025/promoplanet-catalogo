const router = require('express').Router();
const { GoogleGenAI, Type } = require('@google/genai');
const { requireAdmin } = require('../middleware/auth');

async function fetchTextoDesdeURL(url) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PromoPlanetBot/1.0)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al acceder a ${url}`);
  const html = await res.text();

  // Primero intenta una limpieza más agresiva (sin menú, encabezado ni pie) para que
  // el límite de caracteres se use en la información del producto y no en la navegación.
  const limpio = htmlATexto(extraerContenidoPrincipal(html), true);
  if (limpio.length >= 300) return limpio.slice(0, LIMITE_TEXTO_PROVEEDOR);

  // Si quedó muy poco texto, la página tiene una estructura distinta: se usa la limpieza básica.
  return htmlATexto(html, false).slice(0, LIMITE_TEXTO_PROVEEDOR);
}

const LIMITE_TEXTO_PROVEEDOR = 12000;

// Si la página tiene una etiqueta <main>, se queda con ese contenido.
function extraerContenidoPrincipal(html) {
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  return m ? m[0] : html;
}

function htmlATexto(html, agresivo) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');
  if (agresivo) {
    h = h
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<form[\s\S]*?<\/form>/gi, '');
  }
  const texto = h
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodificarEntidades(texto)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Entidades HTML con nombre que aparecen en páginas de proveedores en español.
const ENTIDADES_HTML = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
  iexcl: '¡', iquest: '¿', ordm: 'º', ordf: 'ª', deg: '°',
  times: '×', plusmn: '±', middot: '·', bull: '•',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
  sup2: '²', sup3: '³', frac12: '½', euro: '€',
};

// Decodifica entidades con nombre y numéricas (&#233; y &#xE9;). Las desconocidas quedan como están.
function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (completa, cuerpo) => {
    if (cuerpo[0] === '#') {
      const codigo = cuerpo[1].toLowerCase() === 'x' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      if (!Number.isFinite(codigo) || codigo < 1 || codigo > 0x10FFFF) return completa;
      return String.fromCodePoint(codigo);
    }
    return Object.prototype.hasOwnProperty.call(ENTIDADES_HTML, cuerpo) ? ENTIDADES_HTML[cuerpo] : completa;
  });
}

const MODELO_IA = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

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
  drinkware:       ['Botellas estándar','Botellas térmicas','Jarros y mugs','Mates y accesorios','Termos','Vasos reutilizables'],
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
const CATEGORIA_IDS = Object.keys(CATEGORIAS);

// Lista completa para los prompts: ID, nombre y subcategorías de cada categoría
const CATEGORIA_LISTA = Object.entries(CATEGORIAS)
  .map(([id, nombre]) => {
    const subs = SUBCATEGORIAS[id];
    return subs?.length ? `${id} (${nombre}): subcats → ${subs.join(', ')}` : `${id} (${nombre})`;
  })
  .join('\n');

// Modelo alternativo que se usa solo si el principal sigue saturado después de los reintentos.
// Se puede cambiar con la variable GEMINI_MODEL_FALLBACK (vacía = sin respaldo).
const MODELO_IA_RESPALDO = process.env.GEMINI_MODEL_FALLBACK ?? 'gemini-3.5-flash-lite';
const ESPERAS_REINTENTO_MS = [1500, 3000, 6000];

function esSobrecarga(err) {
  return err?.status === 'UNAVAILABLE' || err?.status === 503 || err?.code === 503 ||
    /503|UNAVAILABLE|overloaded|high demand/i.test(err?.message || '');
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

// Llama al modelo y, si responde "saturado", reintenta con las esperas indicadas.
async function reintentarModelo(ai, params, esperas) {
  for (let intento = 0; ; intento++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      if (!esSobrecarga(err) || intento >= esperas.length) throw err;
      await esperar(esperas[intento]);
    }
  }
}

// Reintenta con el modelo principal y, si sigue saturado, prueba una vez con el de respaldo.
// Si el respaldo también falla, se informa el error original.
async function generarConReintento(ai, params) {
  try {
    return await reintentarModelo(ai, params, ESPERAS_REINTENTO_MS);
  } catch (err) {
    if (!esSobrecarga(err) || !MODELO_IA_RESPALDO || MODELO_IA_RESPALDO === params.model) throw err;
    console.warn(`Modelo ${params.model} saturado, probando con ${MODELO_IA_RESPALDO}`);
    try {
      return await reintentarModelo(ai, { ...params, model: MODELO_IA_RESPALDO }, [2000]);
    } catch (errRespaldo) {
      console.error('El modelo de respaldo también falló:', errRespaldo.message);
      throw err;
    }
  }
}

// Responde con un mensaje claro según el tipo de error de la IA.
function responderErrorIA(res, err, etiqueta, mensajeGenerico) {
  console.error(`Error IA ${etiqueta}:`, err.message);
  const msg = err.message || '';
  if (esSobrecarga(err)) {
    return res.status(503).json({
      error: 'La IA de Google está saturada en este momento. Suele ser temporal: probá de nuevo en unos minutos.',
      codigo: 'IA_SATURADA',
    });
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('"code":429')) {
    return res.status(429).json({ error: 'Se agotó la cuota diaria de la API de Gemini. Volvé a intentar mañana o habilitá facturación en Google Cloud.' });
  }
  if (msg.includes('NOT_FOUND') || msg.includes('"code":404')) {
    return res.status(502).json({ error: 'El modelo de IA configurado no existe o fue dado de baja. Revisá la variable GEMINI_MODEL.' });
  }
  res.status(500).json({ error: mensajeGenerico });
}

function sinAcentos(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Devuelve un ID válido de CATEGORIAS, o '' si el valor no corresponde a ninguna.
// Acepta el ID, el nombre (con o sin mayúsculas o acentos) o un texto que contenga el ID.
function normalizarCategoria(valor) {
  const v = sinAcentos(valor);
  if (!v) return '';
  for (const [id, nombre] of Object.entries(CATEGORIAS)) {
    if (v === id || v === sinAcentos(nombre)) return id;
  }
  const palabras = v.split(/[^a-z_]+/);
  return CATEGORIA_IDS.find(id => palabras.includes(id)) || '';
}

// Devuelve el nombre exacto de la subcategoría si pertenece a la categoría, o ''.
function normalizarSubcategoria(categoria, valor) {
  const v = sinAcentos(valor);
  if (!v) return '';
  return (SUBCATEGORIAS[categoria] || []).find(s => sinAcentos(s) === v) || '';
}

// Segundo intento: la IA solo puede responder con uno de los ID de la lista.
const ESQUEMA_CATEGORIA = {
  type: Type.OBJECT,
  properties: {
    categoria:    { type: Type.STRING, enum: CATEGORIA_IDS },
    subcategoria: { type: Type.STRING },
  },
  required: ['categoria', 'subcategoria'],
};

// Deja en datos.categoria y datos.subcategoria valores válidos, o cadena vacía.
// Si la respuesta de la IA no trae una categoría válida, hace un segundo intento
// con una respuesta restringida a los ID de la lista. Si también falla, queda
// vacía y el admin avisa para que se elija a mano.
async function resolverCategoria(ai, datos, partesExtra = []) {
  let categoria = normalizarCategoria(datos.categoria);
  let subcategoria = normalizarSubcategoria(categoria, datos.subcategoria);
  if (!categoria) {
    try {
      const prompt = `Elegí la categoría y la subcategoría que corresponden a este producto promocional corporativo argentino.

Producto: ${datos.nombre || '(sin nombre)'}
${datos.material ? `Material: ${datos.material}\n` : ''}${datos.descripcion ? `Descripción: ${String(datos.descripcion).slice(0, 1500)}\n` : ''}
Categorías disponibles:
${CATEGORIA_LISTA}

Respondé con un JSON con "categoria" (solo el ID) y "subcategoria" (nombre exacto de la lista, o cadena vacía si ninguna aplica).`;
      const response = await generarConReintento(ai, {
        model: MODELO_IA,
        contents: partesExtra.length ? [...partesExtra, { text: prompt }] : prompt,
        config: { responseMimeType: 'application/json', responseSchema: ESQUEMA_CATEGORIA },
      });
      const json = JSON.parse(response.text);
      categoria = normalizarCategoria(json.categoria);
      subcategoria = normalizarSubcategoria(categoria, json.subcategoria);
    } catch (err) {
      console.error('Error IA categoría (segundo intento):', err.message);
    }
  }
  datos.categoria = categoria;
  datos.subcategoria = subcategoria;
}

router.post('/adaptar', requireAdmin, async (req, res) => {
  let { texto, url, textoManual } = req.body;

  let textoScraped = '';
  let errorScraping = '';
  if (url) {
    try {
      textoScraped = await fetchTextoDesdeURL(url);
    } catch (err) {
      errorScraping = err.message;
      console.error('Error al scrapear URL:', err.message);
    }
  }

  const partes = [];
  if (textoManual?.trim()) partes.push(`## Texto pegado por el usuario (prioritario)\n${textoManual.trim()}`);
  if (textoScraped)        partes.push(`## Contenido de la página del proveedor\n${textoScraped}`);
  if (texto?.trim() && !textoScraped && !textoManual) partes.push(texto.trim());

  const contenidoFuente = partes.join('\n\n---\n\n');
  if (!contenidoFuente) {
    if (errorScraping) {
      return res.status(422).json({ error: `No se pudo leer la página del proveedor (${errorScraping}). Pegá el texto de la descripción en el campo de texto y probá de nuevo.` });
    }
    if (url) {
      return res.status(422).json({ error: 'La página del proveedor no devolvió texto legible (puede cargar el contenido con JavaScript). Pegá el texto de la descripción en el campo de texto y probá de nuevo.' });
    }
    return res.status(400).json({ error: 'Enviá texto o URL del producto' });
  }

  const fuenteLabel = [
    textoManual?.trim() ? 'texto pegado manualmente' : null,
    textoScraped        ? `página web: ${url}`        : null,
    texto?.trim() && !textoScraped && !textoManual ? 'texto' : null,
  ].filter(Boolean).join(' + ') || 'texto';

  const prompt = `Sos el asistente de contenido de PromoPlanet, una empresa argentina de productos promocionales corporativos.

Tu tarea es analizar información de un producto de proveedor y adaptarla al estilo editorial de PromoPlanet.

## Quién lee la descripción

La lee un posible cliente: una empresa (áreas de RR. HH., Marketing o compras) que busca un producto promocional para regalar con su marca impresa.
Todos los productos de PromoPlanet se compran con ese fin: que la marca del cliente quede presente y asociada a un momento o a un ámbito agradable de la vida de quien recibe el regalo (por ejemplo, un parlante se asocia con un momento de música y descanso).

Al elegir qué datos destacar y qué usos mencionar, pensá qué le resulta atractivo a ese comprador para ese fin:
- que el producto se use seguido y quede a la vista en la vida cotidiana de quien lo recibe;
- que sea útil o agradable en momentos y ámbitos concretos (casa, escritorio, oficina, viaje, aire libre, bienestar);
- que tenga una presentación cuidada, si el proveedor la informa;
- que tenga atributos ecológicos, si los hay.

Esta perspectiva guía qué información se prioriza y cómo se redacta la oración final de usos.
No cambia el tono: la redacción sigue siendo objetiva y descriptiva, en tercera persona, sin dirigirse al lector, sin decir "tu marca", "tu logo" ni "tu empresa", sin mencionar la impresión o personalización del producto y sin las fórmulas prohibidas más abajo.

## Ejemplos de estilo PromoPlanet

Estos cinco ejemplos definen el estilo. Imitá su registro, su orden y su nivel de detalle. No imites su contenido.
Fijate que el largo depende de la cantidad de información que hay: un producto simple lleva pocas oraciones y uno técnico o con varios componentes lleva más.

Cargador inalámbrico de bambú y RPET:
El cargador inalámbrico tiene base de bambú, un material renovable, y detalles en RPET.
Es compatible con carga inalámbrica QI y entrega hasta 10 W a smartphones.
La superficie de carga lleva un aro de silicona antideslizante y una luz LED indica que la carga está en curso.
Incluye cable USB a USB-C de 1,2 m.
Se presenta en una caja de cartón reciclado.

Es ideal para cargar el celular en el escritorio o en la mesa de luz, y para kits de onboarding.

Libreta A6 de tapa dura:
La libreta tiene tapa dura, formato A6 y 80 hojas rayadas de papel reciclado.
Incluye banda elástica de cierre, señalador de tela al tono y bolsillo interior para notas sueltas.

Apropiada para tomar notas en reuniones y capacitaciones, y para kits de bienvenida.

Botella térmica deportiva:
La botella es de acero inoxidable de doble pared, con capacidad de 550 ml.
Mantiene frío hasta 24 horas y calor hasta 12.
La tapa cuenta con pico reforzado y sistema antiderrame, y la base es antideslizante.
Es libre de BPA y cuenta con aval del I.N.A.L.
Es apta para bebidas frías y calientes, y se lava a mano.

Recomendada para el uso diario en la oficina, el gimnasio o al aire libre, y para acciones de bienestar.

Mochila porta notebook:
La mochila está confeccionada en poliéster engomado impermeable.
Cuenta con compartimento acolchado para notebook de hasta 17 pulgadas y bolsillos de acceso rápido en el frente y los laterales.
Tiene correas ajustables con refuerzo en los hombros y una banda de sujeción para valija en la parte trasera.

Suele elegirse para el trayecto diario al trabajo y para viajes cortos, y como reconocimiento a equipos de liderazgo.

Llavero metálico redondo:
El llavero es de metal, de formato redondo.

Es apropiado para el uso diario en las llaves de casa, la oficina o el auto.

## Información del proveedor (${fuenteLabel})
${contenidoFuente}

## DESCRIPCIÓN

La descripción describe el producto como objeto: qué es, de qué está hecho, qué
incluye, cómo funciona. No describe la operación comercial ni le vende nada al
lector.

### BLOQUE 1 — el producto

Largo: depende de la información que da el proveedor.
Un producto simple lleva de dos a tres oraciones.
Un producto con varias funciones, componentes o datos técnicos lleva de cuatro a seis oraciones.
Las oraciones pueden ser completas, de entre 15 y 30 palabras cuando hay contenido que las justifique.
No omitas datos relevantes del proveedor solo para acortar la descripción. Tampoco rellenes con frases vacías si no hay más datos.

Inicio: la primera oración empieza con artículo y el sustantivo del producto: "El cargador...", "La libreta...", "La botella...", "El llavero...".
Nunca empieces con "Este" ni "Esta", y no te dirijas al lector.

Orden: cada oración trata un solo tema, y los temas siguen este orden. Los que no tengan datos se omiten sin mencionarlos.
1. Qué es y para qué sirve: tipo de producto, función principal y qué hace.
2. Funcionamiento y datos técnicos: compatibilidad, potencias, voltajes, capacidad, autonomía, conexión, certificaciones.
3. Diseño y construcción: material (con la aclaración eco si corresponde), componentes, sistemas de cierre, partes plegables, soportes, bolsillos, luces indicadoras u otros detalles físicos o funciones integradas al producto. En indumentaria, los talles disponibles también van en este tema (por ejemplo "Disponible en talles del S al XXL"); no tienen campo propio.
4. Qué incluye: solo los elementos que acompañan al producto (cables, fundas, accesorios, repuestos). Una luz, un soporte o cualquier función integrada NO es parte de lo que incluye: va en el tema 3.

Datos numéricos: transcribilos completos y con el dispositivo o la parte a la que corresponden, por ejemplo "15 W para el teléfono, 3 W para el reloj y 2 W para los auriculares" o "entradas de 5 V/3 A, 9 V/2 A y 12 V/1,5 A".
No los resumas en rangos ni en promedios ("entre 5 W y 15 W") porque se pierde información.
Si un valor del proveedor es ambiguo o parece inconsistente, usá solo la parte clara y omití el resto.
Nombres de dispositivos o marcas que mencione el proveedor (por ejemplo Apple Watch) se conservan tal como figuran.
5. Presentación: la caja o el envase, solo si es destacable (ver más abajo).
No mezcles temas en una misma oración: una característica técnica no se junta con una de packaging, ni un accesorio con un dato de funcionamiento.
Respetá el orden de los temas de punta a punta: una vez que pasaste a un tema, no vuelvas a uno anterior (por ejemplo, un detalle de diseño como una base antideslizante va antes de "Incluye", nunca después).
No menciones colores de ningún elemento (ni de cables, cuerdas, tapas ni accesorios): los colores tienen campo propio.
Si un tema tiene pocos datos, se puede unir con el tema vecino siempre que sean del mismo orden (por ejemplo, funcionamiento con compatibilidad).

Presentación y packaging:
No es información de la operación comercial, así que se puede describir.
Se menciona únicamente cuando el proveedor indica una presentación concreta y destacable: una caja de regalo, un estuche, un material reciclado o reutilizable, un envase especial.
Va siempre en la última oración del bloque 1.
Si el proveedor no dice nada sobre el packaging, no lo menciones ni aclares que no hay datos: puede existir aunque no esté informado.
Nunca escribas frases como "no incluye packaging", "se entrega sin caja" ni "no se especifica".

Cada oración va en su propia línea, sin líneas en blanco entre ellas.

### BLOQUE 2 — usos reales del producto

Una sola oración corta, precedida de una línea en blanco.

Antes de escribirla, pensá cómo usa de verdad el producto la persona que lo recibe:
dónde lo usa (casa, oficina, escritorio, viaje, aire libre, gimnasio, cocina, auto),
en qué momentos y para qué. La oración tiene que describir esos usos reales,
deducidos de lo que el producto es y hace (su tipo, su tamaño, si es portátil,
si es de uso diario, si es para escribir, para llevar, para tomar, etc.).

Después, y solo si encaja de forma evidente con ese uso, se puede sumar un contexto
de entrega corporativa: kits de onboarding, kits de bienvenida, capacitaciones,
reconocimientos, fechas especiales, acciones de bienestar.
El uso real va primero. El contexto de entrega es opcional y nunca reemplaza al uso.

Control obligatorio: preguntate "¿una persona usaría o recibiría este producto en esa
situación?". Si la respuesta no es un sí claro, descartá ese contexto.
- Ferias y eventos: nombralos solo si el producto es algo que se usa o se lleva puesto
  en esas situaciones (por ejemplo credenciales, portacredenciales, gorras o bolsas).
  No los uses para productos de uso personal, doméstico o de escritorio.
  Ejemplo de error: decir que un parlante portátil es "para eventos y ferias".
  Ejemplo correcto para un parlante portátil: "Es apropiado para escuchar música en casa, llevarlo de una habitación a otra o usarlo al aire libre, y para kits de bienvenida y reconocimientos."
- No inventes usos que el producto no permite (un termo no es para cocinar, una libreta
  no es para cargar dispositivos).
- Nunca un valor abstracto de marca (profesionalismo, innovación, sustentabilidad,
  estilo de vida).

Alterná la construcción de una descripción a otra:
"Es ideal para...", "Apropiado para...", "Recomendado para...",
"Suele elegirse para...", "Se puede usar en...". No uses siempre la misma.

Si vienen los campos Ocasiones y Destinatarios, usalos como apoyo, pero siempre
verificándolos contra el producto con el control obligatorio de arriba. Si están
vacíos, deducí el uso a partir del tipo de producto.

Este bloque va siempre, después de una línea en blanco.
Omitilo únicamente si el producto es tan genérico que cualquier uso sería inventado.

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
   precio, plazos de entrega, técnicas de marcación o personalización y datos
   de packing logístico (medidas de la caja de embalaje, unidades por caja,
   peso de la caja). La presentación del producto (caja de regalo, estuche) no
   entra en esta prohibición: se rige por la regla de "Presentación y packaging". Tampoco
   de forma indirecta: nada de "artículo de entrega masiva", "opción accesible",
   "para grandes volúmenes". Esos datos tienen campos propios y cambian con el
   tiempo.

4. Colores. Tienen campo propio y no se repiten en el texto.
   Gramajes y medidas físicas: se pueden incluir en la descripción SOLO si el texto o link del proveedor los menciona explícitamente. Si la fuente no los da, omitirlos por completo — nunca inventarlos ni estimarlos. Un dato técnico omitido no daña; uno inventado sí.

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

Si el proveedor indica que la caja o el envase es reciclable, reciclado o
reutilizable, mencionalo en la oración de presentación, con esas mismas palabras
y sin ampliar la afirmación al producto.
Usá solo la característica que el proveedor menciona: si dice "reciclado", escribí
"reciclado" y no agregues "reutilizable", "renovable", "biodegradable" ni otra
cualidad que no figure en los datos. Vale para el packaging y para cualquier material.

Nunca menciones certificaciones (FSC, GRS, OEKO-TEX, GOTS) salvo que estén
explícitas en los datos del proveedor.

### FORMATO DE LA DESCRIPCIÓN

Cada oración del bloque 1 va en su propia línea, siguiendo el orden de temas indicado arriba.
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
  "categoria": "ID de la categoría que corresponde, elegido de esta lista (solo el ID, sin el nombre ni paréntesis):\n${CATEGORIA_LISTA}",
  "subcategoria": "Nombre exacto de una subcategoría de la categoría elegida, o cadena vacía si ninguna aplica",
  "tecnicas": ["array", "con", "técnicas de personalización sugeridas de esta lista: laser, dtf, tampografia, bordado, sublimacion, hotstamping, serigrafia, dtf-textil"],
  "badges": ["array con badges sugeridos de: sale, oportunidad, ecofriendly, termico, premium, popular, exclusivo, corporativo, importado, kit, limitado"],
  "rango": "economico, intermedio o premium según el perfil del producto"
}

Respondé SOLO con el JSON, sin texto adicional antes ni después.`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await generarConReintento(ai, {
      model: MODELO_IA,
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const json = JSON.parse(response.text);
    await resolverCategoria(ai, json);
    res.json(json);
  } catch (err) {
    responderErrorIA(res, err, 'adaptar', 'No se pudo procesar con IA. Intentá de nuevo.');
  }
});

router.post('/analizar-fotos', requireAdmin, async (req, res) => {
  const { fotos, urlProveedor, textoManual } = req.body;
  if (!Array.isArray(fotos) || !fotos.length) {
    return res.status(400).json({ error: 'Se esperaba un array de fotos' });
  }

  const catList = CATEGORIA_LISTA;

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
    const partesFotos = fotos.slice(0, 4).map(f => ({ inlineData: { mimeType: f.mimeType, data: f.base64 } }));
    const response = await generarConReintento(ai, {
      model: MODELO_IA,
      contents: [
        ...partesFotos,
        { text: prompt },
      ],
      config: { responseMimeType: 'application/json' },
    });
    const json = JSON.parse(response.text);
    await resolverCategoria(ai, json, partesFotos);
    res.json(json);
  } catch (err) {
    responderErrorIA(res, err, 'analizar-fotos', 'No se pudo analizar con IA. Intentá de nuevo.');
  }
});

module.exports = router;
