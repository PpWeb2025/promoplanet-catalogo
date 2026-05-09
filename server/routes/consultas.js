const router = require('express').Router();
const { Resend } = require('resend');

router.post('/', async (req, res) => {
  const { nombre, empresa, email, telefono, fecha, area, comentarios, productos } = req.body;
  if (!nombre || !empresa || !email) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const productosTexto = (productos || [])
    .map(p => `• ${p.nombre} (${p.codigo}) — ${p.cantidad} unidades`)
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
          <tr><td style="padding:10px 16px;font-size:13px;color:#666;width:130px">Nombre</td><td style="padding:10px 16px;font-size:13px;font-weight:500">${nombre}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:10px 16px;font-size:13px;color:#666">Empresa</td><td style="padding:10px 16px;font-size:13px;font-weight:500">${empresa}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666">Email</td><td style="padding:10px 16px;font-size:13px"><a href="mailto:${email}" style="color:#00A8B4">${email}</a></td></tr>
          <tr style="background:#f9f9f9"><td style="padding:10px 16px;font-size:13px;color:#666">Teléfono</td><td style="padding:10px 16px;font-size:13px">${telefono || '—'}</td></tr>
          <tr><td style="padding:10px 16px;font-size:13px;color:#666">Área</td><td style="padding:10px 16px;font-size:13px">${area || '—'}</td></tr>
          <tr style="background:#f9f9f9"><td style="padding:10px 16px;font-size:13px;color:#666">Entrega estimada</td><td style="padding:10px 16px;font-size:13px">${fecha || '—'}</td></tr>
        </table>

        ${productosTexto ? `
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:16px">
          <tr><td style="padding:12px 16px;background:#e8eef6;font-weight:700;font-size:13px;color:#003471">PRODUCTOS SELECCIONADOS</td></tr>
          <tr><td style="padding:14px 16px;font-size:13px;line-height:1.8">${productosTexto}</td></tr>
        </table>` : ''}

        ${comentarios ? `
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
          <tr><td style="padding:12px 16px;background:#e8eef6;font-weight:700;font-size:13px;color:#003471">COMENTARIOS</td></tr>
          <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#444">${comentarios}</td></tr>
        </table>` : ''}

      </div>
      <div style="padding:14px 28px;background:#fff;border-top:1px solid #e2e4e8;border-radius:0 0 10px 10px;text-align:center">
        <p style="font-size:12px;color:#999;margin:0">Respondé directamente a este email — el reply va a <strong>${email}</strong></p>
      </div>
    </div>
  `;

  if (!process.env.RESEND_API_KEY) {
    console.log('\n========== CONSULTA RECIBIDA (sin API key) ==========');
    console.log(`De: ${nombre} <${email}> — ${empresa}`);
    console.log('=====================================================\n');
    return res.json({ ok: true, modo: 'consola' });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Catálogo PromoPlanet <noreply@contact.promoplanet.ar>',
      to: 'hola@promoplanet.ar',
      reply_to: email,
      subject: `Cotización — ${empresa}`,
      html: cuerpoHtml,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error Resend:', err.message);
    res.status(500).json({ error: 'No se pudo enviar el mensaje. Intentá más tarde.' });
  }
});

module.exports = router;
