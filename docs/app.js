// ══════════════════════════════════════════
// CONFIGURACION
// ══════════════════════════════════════════
var PROXY = 'https://odoo-prueba.onrender.com';

var DEFAULT_CFG = { user: '', price: 50 };

function getConfig() {
  try {
    var s = localStorage.getItem('kiosco_v2');
    return s ? Object.assign({}, DEFAULT_CFG, JSON.parse(s)) : Object.assign({}, DEFAULT_CFG);
  } catch(e) { return Object.assign({}, DEFAULT_CFG); }
}

// Token temporal — nunca las credenciales reales
function getToken() {
  return sessionStorage.getItem('kiosco_token') || null;
}
function setToken(token) {
  sessionStorage.setItem('kiosco_token', token);
}
function clearToken() {
  sessionStorage.removeItem('kiosco_token');
}

// ══════════════════════════════════════════
// CONFIGURACION — login verificado en servidor
// ══════════════════════════════════════════
async function saveConfig() {
  var user     = document.getElementById('cfg-user').value.trim();
  var password = document.getElementById('cfg-password').value.trim();
  var price    = parseFloat(document.getElementById('cfg-price').value) || 50;

  if (!user || !password) {
    document.getElementById('config-status').innerHTML =
      '<span style="color:var(--error)">Completa usuario y contraseña</span>';
    return;
  }

  document.getElementById('config-status').innerHTML =
    '<span style="color:var(--gray)">Verificando...</span>';

  try {
    var r = await fetch(PROXY + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password, precio: price })
    });
    var data = await r.json();

    if (!data.ok) {
      document.getElementById('config-status').innerHTML =
        '<span style="color:var(--error)">' + (data.message || 'Credenciales incorrectas') + '</span>';
      return;
    }

    // Guardar token temporal y precio — nunca la contraseña
    setToken(data.token);
    localStorage.setItem('kiosco_v2', JSON.stringify({ user, price }));

    document.getElementById('config-status').innerHTML =
      '<span style="color:var(--success)">Acceso concedido</span>';
    updatePrice();
    setTimeout(closeConfig, 1200);

  } catch(e) {
    document.getElementById('config-status').innerHTML =
      '<span style="color:var(--error)">Error de conexion con el servidor</span>';
  }
}

function openConfig() {
  var cfg = getConfig();
  document.getElementById('cfg-user').value = cfg.user || '';
  document.getElementById('cfg-password').value = '';
  document.getElementById('cfg-price').value = cfg.price || 50;
  document.getElementById('config-status').innerHTML = '';
  document.getElementById('config-overlay').classList.add('open');
}

function closeConfig() {
  document.getElementById('config-overlay').classList.remove('open');
  document.getElementById('barcode-input').focus();
}

function updatePrice() {
  var cfg = getConfig();
  var p = '$' + cfg.price;
  document.getElementById('display-price').textContent = p;
  document.getElementById('menu-badge').textContent = 'Menu del dia - ' + p;
  document.getElementById('nobal-required').textContent = p;
}

// ══════════════════════════════════════════
// API ODOO via PROXY — usa token temporal
// ══════════════════════════════════════════
async function odooPost(path, body) {
  var token = getToken();
  var r = await fetch(PROXY + '/odoo' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kiosco-Token': token || ''
    },
    body: JSON.stringify(body)
  });
  var d = await r.json();
  if (r.status === 401) {
    clearToken();
    throw new Error('Sesion expirada. Ve a Configuracion y vuelve a iniciar sesion.');
  }
  return d;
}

async function odooCall(model, method, args, kwargs) {
  var d = await odooPost('/web/dataset/call_kw', {
    jsonrpc: '2.0', method: 'call',
    params: {
      model: model, method: method, args: args,
      kwargs: Object.assign({ context: {} }, kwargs || {})
    }
  });
  if (d.error) throw new Error(d.error.data ? d.error.data.message : 'Error en Odoo');
  return d.result;
}

// ══════════════════════════════════════════
// FLUJO PRINCIPAL
// ══════════════════════════════════════════
var processing = false;
var buffer = '';
var bufTimer = null;

async function processBarcode(barcode) {
  if (processing || !barcode || barcode.length < 3) return;

  var token = getToken();
  if (!token) {
    document.getElementById('not-configured-msg').innerHTML =
      '<div class="not-configured">Inicia sesion en Configuracion primero</div>';
    return;
  }

  processing = true;
  showScreen('loading');

  try {
    var cfg   = getConfig();
    var price = cfg.price;

    // ── Buscar contacto por código de barras ──
    var partnerData = await odooCall('res.partner', 'search_read',
      [[['barcode', '=', barcode]]],
      { fields: ['id', 'name'], limit: 1 }
    );

    if (!partnerData || partnerData.length === 0) {
      document.getElementById('notfound-code').textContent = barcode;
      showScreen('not-found'); autoReturn('progress3', 4000); return;
    }

    var partnerId = partnerData[0].id;
    var empName   = partnerData[0].name;

    // ── Buscar monedero del empleado ──
    var wallets = await odooCall('loyalty.card', 'search_read',
      [[['partner_id', '=', partnerId], ['program_id.name', 'ilike', 'monedero']]],
      { fields: ['id', 'points', 'program_id'], limit: 10 }
    );

    // Fallback: cualquier tarjeta de lealtad del contacto
    if (!wallets || wallets.length === 0) {
      wallets = await odooCall('loyalty.card', 'search_read',
        [[['partner_id', '=', partnerId]]],
        { fields: ['id', 'points', 'program_id'], limit: 10 }
      );
    }

    wallets.sort(function(a, b) { return b.points - a.points; });

    var balance = wallets.length > 0 ? wallets[0].points : 0;
    var cardId  = wallets.length > 0 ? wallets[0].id    : null;

    if (balance < price) {
      document.getElementById('nobal-name').textContent = empName.split(' ')[0].toUpperCase();
      document.getElementById('nobal-balance').textContent = '$' + Math.floor(balance);
      showScreen('no-balance'); autoReturn('progress2', 5000); return;
    }

    if (!cardId) throw new Error('No se encontro monedero para este contacto.');

    var newBal = balance - price;
    await odooCall('loyalty.card', 'write', [[cardId], { points: newBal }], {});

    document.getElementById('success-name').textContent = empName.split(' ')[0].toUpperCase();
    document.getElementById('success-charged').textContent = '-$' + price;
    document.getElementById('success-balance').textContent = '$' + Math.floor(newBal);
    showScreen('success'); autoReturn('progress1', 4000);

    guardarRegistro(empName, barcode, price, newBal);

  } catch(err) {
    document.getElementById('error-detail').textContent =
      (err.message || 'Error desconocido').substring(0, 80);
    showScreen('error'); autoReturn('progress4', 5000);
  } finally {
    processing = false;
  }
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s){
    s.classList.remove('active');
  });
  document.getElementById('screen-' + name).classList.add('active');
  if (name === 'idle') {
    document.getElementById('not-configured-msg').innerHTML = '';
    setTimeout(function(){ document.getElementById('barcode-input').focus(); }, 100);
  }
}

function autoReturn(pid, dur) {
  var bar = document.getElementById(pid);
  bar.style.transition = 'none'; bar.style.width = '0%';
  setTimeout(function(){
    bar.style.transition = 'width ' + dur + 'ms linear';
    bar.style.width = '100%';
  }, 50);
  setTimeout(function(){ showScreen('idle'); }, dur);
}

// ── Captura de codigo de barras ──
document.getElementById('barcode-input').addEventListener('keydown', function(e){
  if (e.key === 'Enter') {
    var v = document.getElementById('barcode-input').value.trim().replace(/^\|/, '');
    document.getElementById('barcode-input').value = '';
    if (v) processBarcode(v);
  }
});

document.addEventListener('keypress', function(e){
  if (document.getElementById('config-overlay').classList.contains('open')) return;
  if (processing) return;
  if (e.key === 'Enter') {
    var clean = buffer.replace(/^\|/, '');
    if (clean.length >= 3) processBarcode(clean);
    buffer = ''; clearTimeout(bufTimer);
  } else {
    buffer += e.key;
    clearTimeout(bufTimer);
    bufTimer = setTimeout(function(){ buffer = ''; }, 200);
  }
});

document.addEventListener('click', function(){
  var configAbierto = document.getElementById('config-overlay').classList.contains('open');
  var pinAbierto    = document.getElementById('pin-overlay').classList.contains('open');
  if (!configAbierto && !pinAbierto)
    document.getElementById('barcode-input').focus();
});

// ══════════════════════════════════════════
// REGISTRO DE ASISTENCIAS
// ══════════════════════════════════════════
var _registros = [];

function getTurno() {
  var totalMin = new Date().getHours() * 60 + new Date().getMinutes();
  return totalMin < 14 * 60 ? '1pm - 2pm' : '2pm - 3pm';
}

function guardarRegistro(nombre, codigo, descontado, saldoRestante) {
  var now = new Date();
  _registros.push({
    fecha: now.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' }),
    hora:  now.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
    nombre: nombre,
    codigo: codigo,
    turno: getTurno(),
    descontado: '$' + descontado,
    saldo: '$' + Math.floor(saldoRestante)
  });
  document.getElementById('reg-count').textContent = _registros.length;
}

// ══════════════════════════════════════════
// PIN — verificado en servidor
// ══════════════════════════════════════════
var _pinBuffer = '';

function abrirPinOverlay() {
  if (_registros.length === 0) {
    alert('No hay registros aun. Escanea algunas credenciales primero.');
    return;
  }
  _pinBuffer = '';
  actualizarPinDots();
  document.getElementById('pin-error').textContent = '';
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-overlay').classList.add('open');
  setTimeout(function(){ document.getElementById('pin-input').focus(); }, 100);
}

function closePinOverlay() {
  _pinBuffer = '';
  actualizarPinDots();
  document.getElementById('pin-overlay').classList.remove('open');
  document.getElementById('barcode-input').focus();
}

function actualizarPinDots() {
  for (var i = 0; i < 8; i++) {
    var dot = document.getElementById('pd' + i);
    if (dot) dot.classList.toggle('filled', i < _pinBuffer.length);
  }
}

function pinFromInput(val) {
  _pinBuffer = val.toUpperCase();
  actualizarPinDots();
  document.getElementById('pin-error').textContent = '';
}

function pinClear() {
  _pinBuffer = _pinBuffer.slice(0, -1);
  document.getElementById('pin-input').value = _pinBuffer;
  actualizarPinDots();
  document.getElementById('pin-error').textContent = '';
}

async function pinConfirmar() {
  try {
    var r = await fetch(PROXY + '/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: _pinBuffer })
    });
    var data = await r.json();
    if (data.ok) {
      closePinOverlay();
      descargarExcel();
    } else {
      document.getElementById('pin-error').textContent = 'PIN incorrecto. Intenta de nuevo.';
      _pinBuffer = '';
      document.getElementById('pin-input').value = '';
      actualizarPinDots();
    }
  } catch(e) {
    document.getElementById('pin-error').textContent = 'Error de conexion.';
  }
}

function descargarExcel() {
  if (_registros.length === 0) return;
  var BOM  = '\uFEFF';
  var headers = ['Fecha','Hora','Nombre','Codigo Credencial','Turno','Saldo Descontado','Saldo Restante'];
  var rows = _registros.map(function(r) {
    return [r.fecha, r.hora, r.nombre, r.codigo, r.turno, r.descontado, r.saldo]
      .map(function(v){ return '"' + String(v).replace(/"/g,'""') + '"'; })
      .join(',');
  });
  var csv  = BOM + headers.join(',') + '\n' + rows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'Comedor_MundoCharro_' + new Date().toLocaleDateString('es-MX').replace(/\//g,'-') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════
// RELOJ
// ══════════════════════════════════════════
function tick() {
  var n = new Date();
  document.getElementById('clock').textContent =
    String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
  var days   = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
  var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  document.getElementById('date-display').textContent =
    days[n.getDay()] + ' ' + n.getDate() + ' ' + months[n.getMonth()] + ' ' + n.getFullYear();
}
setInterval(tick, 1000); tick();

// ── Init ──
updatePrice();
document.getElementById('barcode-input').focus();
if (!getToken()) {
  document.getElementById('not-configured-msg').innerHTML =
    '<div class="not-configured">Inicia sesion en Configuracion para activar el kiosco</div>';
}
