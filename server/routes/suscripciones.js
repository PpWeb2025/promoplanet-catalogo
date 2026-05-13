const router = require('express').Router();

router.post('/', async (req, res) => {
  const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Email inválido' });
          }

            if (!process.env.BREVO_API_KEY) {
                console.log('[suscripcion] Sin API key — email recibido:', email);
                    return res.json({ ok: true, modo: 'consola' });
                      }

                        try {
                            const response = await fetch('https://api.brevo.com/v3/contacts', {
                                  method: 'POST',
                                        headers: {
                                                'accept': 'application/json',
                                                        'content-type': 'application/json',
                                                                'api-key': process.env.BREVO_API_KEY,
                                                                      },
                                                                            body: JSON.stringify({
                                                                                    email,
                                                                                            listIds: [2],
                                                                                                    updateEnabled: true,
                                                                                                          }),
                                                                                                              });
                                                                                                              
                                                                                                                  if (!response.ok && response.status !== 204) {
                                                                                                                        const err = await response.json();
                                                                                                                              if (err.code === 'DUPLICATE_PARAMETER') {
                                                                                                                                      return res.json({ ok: true, yaExistia: true });
                                                                                                                                            }
                                                                                                                                                  console.error('[suscripcion] Error Brevo:', err);
                                                                                                                                                        return res.status(500).json({ error: 'Error al registrar el email' });
                                                                                                                                                            }
                                                                                                                                                            
                                                                                                                                                                return res.json({ ok: true });
                                                                                                                                                                  } catch (err) {
                                                                                                                                                                      console.error('[suscripcion] Error de red:', err);
                                                                                                                                                                          return res.status(500).json({ error: 'Error de conexión' });
                                                                                                                                                                            }
                                                                                                                                                                            });
                                                                                                                                                                            
                                                                                                                                                                            module.exports = router;
