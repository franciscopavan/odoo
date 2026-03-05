// ══════════════════════════════════════════
// CONFIGURACION — sin secretos aqui
// ══════════════════════════════════════════
var PROXY = 'https://odoo-ewzf.onrender.com';

var DEFAULT_CFG = {
  user: '',
  price: 50
};

function getConfig() {
  try {
    var s = localStorage.getItem('kiosco_v2');
    return s ? Object.assign({}, DEFAULT_CFG, JSON.parse(s)) : Object.assign({}, DEFAULT_CFG);
  } catch(e) { return Object.assign({}, DEFAULT_CFG); }
}

function saveConfig() {
  var cfg = {
    user: document.getElementById('cfg-user').value.trim(),
    price: parseFloat(document.getElementById('cfg-price').value) || 50
  };
  if (!cfg.user) {
    document.getElementById('config-status').innerHTML =
      '<span style="color:var(--error)">Completa el usuario</span>';
    return;
  }
  localStorage.setItem('kiosco_v2', JSON.stringify(cfg));
  document.getElementById('config-status').innerHTML =
    '<span style="color:var(--success)">Guardado correctamente</span>';
  updatePrice();
  setTimeout(closeConfig, 1200);
}

function openConfig() {
  var cfg = getConfig();
  document.getElementById('cfg-user').value = cfg.user;
  document.getElementById('cfg-price').value = cfg.price;
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
// API ODOO via PROXY — API Key vive en server.js
// ══════════════════════════════════════════
var _session = null;

async function odooPost(path, body) {
  var cfg = getConfig();
  var headers = { 'Content-Type': 'application/json' };
  if (_session) headers['X-Session-Id'] = _session;
  // Solo enviamos el usuario, la API Key la agrega el servidor
  headers['X-Odoo-User'] = cfg.user;
  var r = await fetch(PROXY + '/odoo' + path, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });
  var d = await r.json();
  if (d.result && d.result._session_id) {
    _session = d.result._session_id;
    delete d.result._session_id;
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

async function odooAuth() {
  var cfg = getConfig();
  if (!cfg.user) throw new Error('Configura tu correo en el boton Configuracion.');
  var d = await odooPost('/web/dataset/call_kw', {
    jsonrpc: '2.0', method: 'call',
    params: {
      model: 'res.users', method: 'search_read',
      args: [[['login', '=', cfg.user]]],
      kwargs: { fields: ['id'], limit: 1, context: {} }
    }
  });
  if (d.result && d.result.length > 0) return d.result[0].id;
  var auth = await odooPost('/web/session/authenticate', {
    jsonrpc: '2.0', method: 'call',
    params: { db: 'mundocharro', login: cfg.user, password: '' }
  });
  if (!auth.result || !auth.result.uid)
    throw new Error('Autenticacion fallida. Verifica tu correo.');
  return auth.result.uid;
}

// ══════════════════════════════════════════
// FLUJO PRINCIPAL
// ══════════════════════════════════════════
var processing = false;
var buffer = '';
var bufTimer = null;

async function processBarcode(barcode) {
  if (processing || !barcode || barcode.length < 3) return;
  var cfg = getConfig();
  if (!cfg.user) {
    document.getElementById('not-configured-msg').innerHTML =
      '<div class="not-configured">Configura tu correo en el boton Configuracion</div>';
    return;
  }

  processing = true;
  showScreen('loading');

  try {
    await odooAuth();

    var partnerId = parseInt(barcode);

    var partnerData = await odooCall('res.partner', 'read', [[partnerId]], {
      fields: ['id', 'name']
    });

    if (!partnerData || partnerData.length === 0 || !partnerData[0]) {
      document.getElementById('notfound-code').textContent = barcode;
      showScreen('not-found'); autoReturn('progress3', 4000); return;
    }

    var empName = partnerData[0].name;

    var wallets = await odooCall('loyalty.card', 'search_read',
      [[['partner_id', '=', partnerId], ['program_id.name', 'ilike', 'monedero']]],
      { fields: ['id', 'points', 'program_id'], limit: 10 }
    );

    if (!wallets || wallets.length === 0) {
      var firstName = empName.split(' ')[0];
      var allPartners = await odooCall('res.partner', 'search_read',
        [[['name', 'ilike', firstName]]],
        { fields: ['id', 'name'], limit: 20 }
      );
      for (var pi = 0; pi < allPartners.length; pi++) {
        var wTest = await odooCall('loyalty.card', 'search_read',
          [[['partner_id', '=', allPartners[pi].id], ['program_id.name', 'ilike', 'monedero']]],
          { fields: ['id', 'points', 'program_id'], limit: 5 }
        );
        if (wTest && wTest.length > 0) {
          wallets = wTest;
          partnerId = allPartners[pi].id;
          break;
        }
      }
    }

    if (!wallets || wallets.length === 0) {
      wallets = await odooCall('loyalty.card', 'search_read',
        [[['partner_id', '=', partnerId]]],
        { fields: ['id', 'points', 'program_id'], limit: 10 }
      );
    }

    wallets.sort(function(a, b) { return b.points - a.points; });

    var balance = wallets.length > 0 ? wallets[0].points : 0;
    var cardId  = wallets.length > 0 ? wallets[0].id    : null;
    var price   = cfg.price;

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
  if (!document.getElementById('config-overlay').classList.contains('open'))
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
// PIN — verificado en el servidor
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

// PIN se verifica en el servidor — nunca viaja de vuelta al frontend
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
    document.getElementById('pin-error').textContent = 'Error de conexion. Intenta de nuevo.';
  }
}

function descargarExcel() {
  if (_registros.length === 0) return;
  var BOM = '\uFEFF';
  var headers = ['Fecha','Hora','Nombre','Codigo Credencial','Turno','Saldo Descontado','Saldo Restante'];
  var rows = _registros.map(function(r) {
    return [r.fecha, r.hora, r.nombre, r.codigo, r.turno, r.descontado, r.saldo]
      .map(function(v){ return '"' + String(v).replace(/"/g,'""') + '"'; })
      .join(',');
  });
  var csv = BOM + headers.join(',') + '\n' + rows.join('\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  var hoy  = new Date().toLocaleDateString('es-MX').replace(/\//g,'-');
  a.href = url;
  a.download = 'Comedor_MundoCharro_' + hoy + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════
// RELOJ
// ══════════════════════════════════════════
function tick() {
  var n = new Date();
  var h = String(n.getHours()).padStart(2,'0');
  var m = String(n.getMinutes()).padStart(2,'0');
  document.getElementById('clock').textContent = h + ':' + m;
  var days   = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
  var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  document.getElementById('date-display').textContent =
    days[n.getDay()] + ' ' + n.getDate() + ' ' + months[n.getMonth()] + ' ' + n.getFullYear();
}
setInterval(tick, 1000); tick();

// ── Init ──
updatePrice();
document.getElementById('barcode-input').focus();
var _initCfg = getConfig();
if (!_initCfg.user) {
  document.getElementById('not-configured-msg').innerHTML =
    '<div class="not-configured">Falta configurar tu correo. Haz clic en Configuracion</div>';
}
