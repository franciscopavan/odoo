
Copiar

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ODOO_URL = process.env.ODOO_URL || 'https://mundocharro.odoo.com';

app.use(cors({ origin: '*' }));
app.use(express.json());

app.post('/odoo/*', async (req, res) => {
  const path = req.url.replace('/odoo/', '');
  const targetUrl = `${ODOO_URL}/${path}`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers['x-session-id']) {
      headers['Cookie'] = `session_id=${req.headers['x-session-id']}`;
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // Extraer session_id de set-cookie y meterlo en el resultado
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
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', odoo: ODOO_URL }));
app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
