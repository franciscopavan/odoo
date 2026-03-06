const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');

const app     = express();
const PORT    = process.env.PORT    || 3000;
const ODOO_URL      = process.env.ODOO_URL      || 'https://mundocharro.odoo.com';
const ODOO_DB       = process.env.ODOO_DB       || 'mundocharro';
const ODOO_API_KEY  = process.env.ODOO_API_KEY  || '';
const ODOO_USER     = process.env.ODOO_USER     || '';
const PIN_DESCARGA  = process.env.PIN_DESCARGA  || '';

app.use(cors({ origin: '*' }));
app.use(express.json());

// ══════════════════════════════════════════
// SESION PERSISTENTE — el servidor hace login
// una sola vez y reutiliza la sesion
// ══════════════════════════════════════════
let _sessionId = null;
let _sessionTs = 0;
const SESSION_TTL = 1000 * 60 * 28; // 28 minutos

async function getSession() {
  const now = Date.now();
  if (_sessionId && (now - _sessionTs) < SESSION_TTL) {
    return _sessionId;
  }

  console.log('Iniciando sesion en Odoo...');
  const r = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { db: ODOO_DB, login: ODOO_USER, password: ODOO_API_KEY }
    })
  });

  const data = await r.json();
  if (!data.result || !data.result.uid) {
    throw new Error('Login fallido en Odoo. Verifica ODOO_USER y ODOO_API_KEY.');
  }

  // Extraer session_id de la cookie
  const cookies = r.headers.raw()['set-cookie'] || [];
  for (const c of cookies) {
    const m = c.match(/session_id=([^;]+)/);
    if (m) {
      _sessionId = m[1];
      _sessionTs = now;
      console.log('Sesion obtenida:', _sessionId.substring(0, 10) + '...');
      return _sessionId;
    }
  }

  throw new Error('No se pudo obtener session_id de Odoo.');
}

// ══════════════════════════════════════════
// Verificacion de PIN
// ══════════════════════════════════════════
app.post('/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ ok: false });
  res.json({ ok: pin.toUpperCase() === PIN_DESCARGA.toUpperCase() });
});

// ══════════════════════════════════════════
// Proxy JSON-RPC con sesion persistente
// ══════════════════════════════════════════
app.post('/odoo/*', async (req, res) => {
  const path      = req.url.replace('/odoo/', '');
  const targetUrl = `${ODOO_URL}/${path}`;

  try {
    const sessionId = await getSession();
    const headers   = {
      'Content-Type': 'application/json',
      'Cookie': `session_id=${sessionId}`
    };

    const response = await fetch(targetUrl, {
      method: 'POST', headers,
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // Si la sesion expiro, invalidarla para que se renueve en la siguiente llamada
    if (data.error && data.error.code === 100) {
      console.log('Sesion expirada, renovando...');
      _sessionId = null;
    }

    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: { data: { message: err.message } } });
  }
});

// ══════════════════════════════════════════
// Health check
// ══════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    odoo: ODOO_URL,
    configured: !!(ODOO_API_KEY && ODOO_USER && PIN_DESCARGA),
    sesion_activa: !!_sessionId
  });
});

app.listen(PORT, () => {
  console.log(`Proxy corriendo en puerto ${PORT}`);
  console.log(`Odoo: ${ODOO_URL}`);
  console.log(`Configurado: usuario=${!!ODOO_USER} apiKey=${!!ODOO_API_KEY} pin=${!!PIN_DESCARGA}`);
  // Pre-autenticar al arrancar
  getSession().catch(err => console.error('Pre-auth fallida:', err.message));
});
