const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ODOO_URL = process.env.ODOO_URL || 'https://mundocharro.odoo.com';

app.use(cors());
app.use(express.json());

// Redirige todas las peticiones a Odoo
app.post('/odoo/*', async (req, res) => {
  const path = req.params[0];
  const targetUrl = `${ODOO_URL}/${path}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Reenviar cookies de sesión si existen
        ...(req.headers.cookie ? { 'Cookie': req.headers.cookie } : {})
      },
      body: JSON.stringify(req.body)
    });

    // Reenviar cookies de respuesta al cliente
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) res.setHeader('Set-Cookie', setCookie);

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', odoo: ODOO_URL }));

app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
