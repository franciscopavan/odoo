const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const crypto  = require('crypto');

const app     = express();
const PORT    = process.env.PORT    || 3000;
const ODOO_URL     = process.env.ODOO_URL     || 'https://mundocharro.odoo.com';
const ODOO_DB      = process.env.ODOO_DB      || 'mundocharro';
const ODOO_API_KEY = process.env.ODOO_API_KEY || '';
const ODOO_USER    = process.env.ODOO_USER    || '';
const PIN_DESCARGA = process.env.PIN_DESCARGA || '';

app.use(cors({ origin: '*' }));
app.use(express.json());

// ══════════════════════════════════════════
// SESION ODOO — el servidor hace login una vez
// y reutiliza la sesion
// ══════════════════════════════════════════
let _odooSession = null;
let _odooSessionTs = 0;
const SESSION_TTL = 1000 * 60 * 28; // 28 minutos

async function getOdooSession() {
  const now = Date.now();
  if (_odooSession && (now - _odooSessionTs) < SESSION_TTL) {
    return _odooSession;
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
    throw new Error('Login fallido en Odoo.');
  }
  const cookies = r.headers.raw()['set-cookie'] || [];
  for (const c of cookies) {
    const m = c.match(/session_id=([^;]+)/);
    if (m) {
      _odooSession = m[1];
      _odooSessionTs = now;
      console.log('Sesion Odoo obtenida.');
      return _odooSession;
    }
  }
  throw new Error('No se pudo obtener session_id de Odoo.');
}

// ══════════════════════════════════════════
// TOKENS TEMPORALES — el kiosco recibe un token
// que expira en 8 horas, nunca las credenciales reales
// ══════════════════════════════════════════
const _tokens = new Map();
const TOKEN_TTL = 1000 * 60 * 60 * 8; // 8 horas

function crearToken(precio) {
  const token = crypto.randomBytes(32).toString('hex');
  _tokens.set(token, { ts: Date.now(), precio });
  return token;
}

function validarToken(token) {
  if (!token) return null;
  const data = _tokens.get(token);
  if (!data) return null;
  if (Date.now() - data.ts > TOKEN_TTL) {
    _tokens.delete(token);
    return null;
  }
  return data;
}

// ══════════════════════════════════════════
// LOGIN del kiosco — verifica credenciales
// y devuelve token temporal
// ══════════════════════════════════════════
app.post('/login', async (req, res) => {
  const { user, password, precio } = req.body;
  if (!user || !password) {
    return res.status(400).json({ ok: false, message: 'Usuario y contraseña requeridos' });
  }

  // Verificar que coincidan con las variables de Render
  const userOk     = user.trim().toLowerCase() === ODOO_USER.trim().toLowerCase();
  const passwordOk = password.trim() === ODOO_API_KEY.trim();

  if (!userOk || !passwordOk) {
    return res.status(401).json({ ok: false, message: 'Credenciales incorrectas' });
  }

  // Asegurar sesion activa con Odoo
  try {
    await getOdooSession();
  } catch(err) {
    return res.status(500).json({ ok: false, message: 'Error conectando con Odoo: ' + err.message });
  }

  const token = crearToken(precio || 50);
  res.json({ ok: true, token });
});

// ══════════════════════════════════════════
// Middleware — verifica token en rutas protegidas
// ══════════════════════════════════════════
function requireToken(req, res, next) {
  const token = req.headers['x-kiosco-token'];
  const data  = validarToken(token);
  if (!data) {
    return res.status(401).json({ error: { data: { message: 'Sesion expirada. Vuelve a iniciar sesion en Configuracion.' } } });
  }
  req.tokenData = data;
  next();
}

// ══════════════════════════════════════════
// Proxy JSON-RPC — protegido con token
// ══════════════════════════════════════════
app.post('/odoo/*', requireToken, async (req, res) => {
  const path      = req.url.replace('/odoo/', '');
  const targetUrl = `${ODOO_URL}/${path}`;
  try {
    const sessionId = await getOdooSession();
    const headers   = {
      'Content-Type': 'application/json',
      'Cookie': `session_id=${sessionId}`
    };
    const response = await fetch(targetUrl, {
      method: 'POST', headers,
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    // Si la sesion expiro, renovar
    if (data.error && data.error.code === 100) {
      _odooSession = null;
    }
    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: { data: { message: err.message } } });
  }
});

// ══════════════════════════════════════════
// Verificacion de PIN
// ══════════════════════════════════════════
app.post('/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ ok: false });
  res.json({ ok: pin.toUpperCase() === PIN_DESCARGA.toUpperCase() });
});

// ══════════════════════════════════════════
// Health check
// ══════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    odoo: ODOO_URL,
    configured: !!(ODOO_API_KEY && ODOO_USER && PIN_DESCARGA),
    sesion_activa: !!_odooSession
  });
});

app.listen(PORT, () => {
  console.log(`Proxy corriendo en puerto ${PORT}`);
  console.log(`Configurado: usuario=${!!ODOO_USER} apiKey=${!!ODOO_API_KEY} pin=${!!PIN_DESCARGA}`);
  getOdooSession().catch(err => console.error('Pre-auth fallida:', err.message));
});
