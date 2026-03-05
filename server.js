const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');

const app      = express();
const PORT     = process.env.PORT     || 3000;
const ODOO_URL = process.env.ODOO_URL || 'https://mundocharro.odoo.com';
const ODOO_API_KEY  = process.env.ODOO_API_KEY  || '';
const ODOO_USER     = process.env.ODOO_USER     || '';
const PIN_DESCARGA  = process.env.PIN_DESCARGA  || '';

app.use(cors({ origin: '*' }));
app.use(express.json());

// ══════════════════════════════════════════
// Verificacion de PIN — el valor nunca sale del servidor
// ══════════════════════════════════════════
app.post('/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ ok: false, message: 'PIN requerido' });
  const ok = pin.toUpperCase() === PIN_DESCARGA.toUpperCase();
  res.json({ ok });
});

// ══════════════════════════════════════════
// Proxy JSON-RPC — agrega API Key internamente
// ══════════════════════════════════════════
app.post('/odoo/*', async (req, res) => {
  const path      = req.url.replace('/odoo/', '');
  const targetUrl = `${ODOO_URL}/${path}`;
  try {
    const headers = { 'Content-Type': 'application/json' };

    // Session cookie si existe
    if (req.headers['x-session-id']) {
      headers['Cookie'] = `session_id=${req.headers['x-session-id']}`;
    }

    // La API Key la agrega el servidor, no el frontend
    if (ODOO_API_KEY && ODOO_USER) {
      const credentials = Buffer.from(`${ODOO_USER}:${ODOO_API_KEY}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // Capturar session_id si viene en la respuesta
    const rawCookies = response.headers.raw()['set-cookie'];
    if (rawCookies) {
      for (const cookie of rawCookies) {
        const match = cookie.match(/session_id=([^;]+)/);
        if (match && data.result) {
          data.result._session_id = match[1];
          break;
        }
      }
    }

    res.json(data);
  } catch (err) {
    console.error('Proxy JSON-RPC error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════
// Proxy REST API
// ══════════════════════════════════════════
app.all('/api/*', async (req, res) => {
  const targetUrl = `${ODOO_URL}${req.url}`;
  try {
    const headers = { 'Content-Type': 'application/json' };

    if (ODOO_API_KEY && ODOO_USER) {
      const credentials = Buffer.from(`${ODOO_USER}:${ODOO_API_KEY}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const options = { method: req.method, headers };
    if (req.method !== 'GET' && req.body) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const text     = await response.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = { error: text }; }
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy REST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════
// Health check
// ══════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    odoo: ODOO_URL,
    configured: !!(ODOO_API_KEY && ODOO_USER && PIN_DESCARGA)
  });
});

app.listen(PORT, () => {
  console.log(`Proxy corriendo en puerto ${PORT}`);
  console.log(`Odoo: ${ODOO_URL}`);
  console.log(`Configurado: usuario=${!!ODOO_USER} apiKey=${!!ODOO_API_KEY} pin=${!!PIN_DESCARGA}`);
});
