const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

let _warned = false;

async function purgeCatalogCache() {
  if (!ZONE_ID || !API_TOKEN) {
    if (!_warned) {
      console.warn('[cloudflare] CLOUDFLARE_ZONE_ID o CLOUDFLARE_API_TOKEN no configurados; purga deshabilitada');
      _warned = true;
    }
    return;
  }
  fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: ['https://promoplanet.ar/api/productos'] }),
    }
  ).then(async r => {
    if (!r.ok) console.error('[cloudflare] purge_cache falló:', await r.text());
  }).catch(err => console.error('[cloudflare] purge_cache error:', err.message));
}

module.exports = { purgeCatalogCache };
