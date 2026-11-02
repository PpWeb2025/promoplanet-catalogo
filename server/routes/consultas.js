const router = require('express').Router();
const { Resend } = require('resend');

const DESTINO = process.env.CONSULTAS_TO || 'hola@promoplanet.ar';
const REMITENTE = 'Catálogo PromoPlanet <noreply@contact.promoplanet.ar>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MSG_ERROR = 'No pudimos enviar tu solicitud en este momento. Escribinos a hola@promoplanet.ar y te respondemos a la brevedad.';

// Texto de una sola línea (sin saltos de línea), recortado
function linea(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Texto con saltos de línea permitidos, recortado
function bloque(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// Escapa HTML para que lo que escribe el cliente no rompa ni altere el mail
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

router.post('/', async (req, res) => {
  const body = req.body || {};

  const nombre = linea(body.nombre, 120);
  const empresa = linea(body.empresa, 120);
  const email = linea(body.email, 160);
  const telefono = linea(body.telefono, 60);
  const fecha = linea(body.fecha, 30);
  const area = linea(body.area, 60);
  const comentarios = bloque(body.comentarios, 3000);
  const productos = (Array.isArray(body.productos) ? body.productos : [])
    .slice(0, 200)
    .map(p => ({
      nombre: linea(p && p.nombre, 200),
      codigo: linea(p && p.codigo, 40),
      cantidad: linea(p && p.cantidad, 20),
    }));

  if (!nombre || !empresa || !email) {
    return res.status(400).json({ error: 'Faltan campos requeridos: nombre, empresa y email.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'El email no parece válido. Revisalo, por favor.' });
  }

  // Datos de la consulta para dejar en los logs si el envío falla,
  // así se puede recuperar el pedido aunque el mail no haya salido.
  const resumen = JSON.stringify({ nombre, empresa, email, telefono, fecha, area, comentarios, productos });

  const productosTexto = productos
    .map(p => `• ${esc(p.nombre)} (${esc(p.codigo)}) — ${esc(p.cantidad)} unidades`)
    .join('<br>');

  const cuerpoHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#003471;padding:20px 28px;border-radius:10px 10px 0 0">
        <h1 style="color:#fff;margin:0;font-size:20px">Nueva solicitud de cotización</h1>
        <p style="color:#00A8B4;margin:4px 0 0;font-size:13px">PromoPlanet — Catálogo</p>
      </div>
      <div style="background:#f4f5f7;padding:24px 28px">

        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:16px">
          <tr><td colspan="2" style="padding:12px 16px;background:#e8eef6;font-weight:700;font-size:13px;color:#003471">DATOS DE CONTACTO</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666;width:130px">Nombre</td><td style="padding:10px 16px;font-size:13px;font-weight:500">${esc(nombre)}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:10px 16px;font-size:13px;color:#666">Empresa</td><td style="padding:10px 16px;font-size:13px;font-weight:500">${esc(empresa)}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666">Email</td><td style="padding:10px 16px;font-size:13px"><a href="mailto:${esc(email)}" style="color:#00A8B4">${esc(email)}</a></td></tr>
          <tr style="background:#f9f9f9"><td style="padding:10px 16px;font-size:13px;color:#666">Teléfono</td><td style="padding:10px 16px;font-size:13px">${esc(telefono) || '—'}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666">Área</td><td style="padding:10px 16px;font-size:13px">${esc(area) || '—'}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:10px 16px;font-size:13px;color:#666">Entrega estimada</td><td style="padding:10px 16px;font-size:13px">${esc(fecha) || '—'}</td></tr>
        </table>

        ${productosTexto ? `
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:16px">
          <tr><td style="padding:12px 16px;background:#e8eef6;font-weight:700;font-size:13px;color:#003471">PRODUCTOS SELECCIONADOS</td></tr>
          <tr><td style="padding:14px 16px;font-size:13px;line-height:1.8">${productosTexto}</td></tr>
        </table>` : ''}

        ${comentarios ? `
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
          <tr><td style="padding:12px 16px;background:#e8eef6;font-weight:700;font-size:13px;color:#003471">COMENTARIOS</td></tr>
          <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#444">${esc(comentarios).replace(/\n/g, '<br>')}</td></tr>
        </table>` : ''}

      </div>
      <div style="padding:14px 28px;background:#fff;border-top:1px solid #e2e4e8;border-radius:0 0 10px 10px;text-align:center">
        <p style="font-size:12px;color:#999;margin:0">Respondé directamente a este email — el reply va a <strong>${esc(email)}</strong></p>
      </div>
    </div>
  `;

  if (!process.env.RESEND_API_KEY) {
    // En Render (producción) la falta de la clave es un error real: no se debe decir "enviada".
    if (process.env.RENDER) {
      console.error('[consultas] ERROR: falta RESEND_API_KEY. Consulta NO enviada:', resumen);
      return res.status(500).json({ error: MSG_ERROR });
    }
    // En desarrollo local se muestra en consola.
    console.log('\n========== CONSULTA RECIBIDA (sin API key) ==========');
    console.log(`De: ${nombre} <${email}> — ${empresa}`);
    console.log('=====================================================\n');
    return res.json({ ok: true, modo: 'consola' });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    // Resend NO lanza una excepción cuando rechaza un envío: devuelve { data, error }.
    const { data, error } = await resend.emails.send({
      from: REMITENTE,
      to: DESTINO,
      reply_to: email,
      subject: `Cotización — ${empresa}`,
      html: cuerpoHtml,
    });

    if (error) {
      console.error(
        `[consultas] ERROR: Resend rechazó el envío (${error.statusCode || 's/c'} ${error.name || ''}): ${error.message}. Consulta NO enviada:`,
        resumen
      );
      return res.status(502).json({ error: MSG_ERROR });
    }

    console.log(`[consultas] Enviada OK (Resend id ${data && data.id}) — ${empresa} <${email}>`);
    return res.json({ ok: true });
  } catch (err) {
    console.error(`[consultas] ERROR inesperado al enviar: ${err.message}. Consulta NO enviada:`, resumen);
    return res.status(500).json({ error: MSG_ERROR });
  }
});

module.exports = router;
