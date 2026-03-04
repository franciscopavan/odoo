// ══════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════
const DEFAULT_CONFIG = {
  url: 'https://mundocharro.odoo.com',
  user: '',
  apiKey: 'd61bda4c97b84718faaafd7c30fba01b881b0312',
  price: 50,
  walletName: 'Saldo empleados'
};

function getConfig() {
  const saved = localStorage.getItem('kiosco_config');
  return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
}

function saveConfig() {
  const cfg = {
    url: document.getElementById('cfg-url').value.trim().replace(/\/$/, ''),
    user: document.getElementById('cfg-user').value.trim(),
    apiKey: document.getElementById('cfg-key').value.trim(),
    price: parseFloat(document.getElementById('cfg-price').value) || 50,
    walletName: document.getElementById('cfg-wallet').value.trim() || 'Saldo empleados'
  };
  if (!cfg.url || !cfg.user || !cfg.apiKey) {
    document.getElementById('config-status').innerHTML = '<span style="color:var(--error)">Completa todos los campos obligatorios</span>';
    return;
  }
  localStorage.setItem('kiosco_config', JSON.stringify(cfg));
  document.getElementById('config-status').innerHTML = '<span style="color:var(--success)">Guardado correctamente</span>';
  updateDisplayPrice();
  setTimeout(closeConfig, 1200);
}

function openConfig() {
  const cfg = getConfig();
  document.getElementById('cfg-url').value = cfg.url;
  document.getElementById('cfg-user').value = cfg.user;
  document.getElementById('cfg-key').value = cfg.apiKey;
  document.getElementById('cfg-price').value = cfg.price;
  document.getElementById('cfg-wallet').value = cfg.walletName;
  document.getElementById('config-status').innerHTML = '';
  document.getElementById('config-overlay').classList.add('open');
}

function closeConfig() {
  document.getElementById('config-overlay').classList.remove('open');
  document.getElementById('barcode-input').focus();
}

function updateDisplayPrice() {
  const cfg = getConfig();
  const price = '$' + cfg.price.toFixed(0);
  document.getElementById('display-price').textContent = price;
  document.getElementById('menu-badge').textContent = 'Menu del dia · ' + price;
  document.getElementById('nobal-required').textContent = price;
}

// ══════════════════════════════════════════
// ODOO API
// ══════════════════════════════════════════
async function odooAuth() {
  const cfg = getConfig();
  const dbName = cfg.url.replace('https://', '').split('.')[0];
  const response = await fetch(cfg.url + '/web/session/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { db: dbName, login: cfg.user, password: cfg.apiKey }
    }),
    credentials: 'include'
  });
  const data = await response.json();
  if (!data.result || !data.result.uid) {
    throw new Error('Autenticacion fallida. Verifica usuario y clave API.');
  }
  return data.result.uid;
}

async function odooCall(model, method, args, kwargs) {
  const cfg = getConfig();
  kwargs = kwargs || {};
  const response = await fetch(cfg.url + '/web/dataset/call_kw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { model: model, method: method, args: args, kwargs: Object.assign({ context: {} }, kwargs) }
    }),
    credentials: 'include'
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.data ? data.error.data.message : JSON.stringify(data.error));
  return data.result;
}

async function findEmployee(barcode) {
  const results = await odooCall('hr.employee', 'search_read',
    [[['barcode', '=', barcode]]],
    { fields: ['id', 'name', 'barcode'], limit: 1 }
  );
  return results.length > 0 ? results[0] : null;
}

async function getEmployeePartner(employeeId) {
  const results = await odooCall('hr.employee', 'read',
    [[employeeId]],
    { fields: ['address_home_id', 'name'] }
  );
  return results.length > 0 ? results[0] : null;
}

async function getWalletBalance(partnerId) {
  const wallets = await odooCall('loyalty.card', 'search_read',
    [[['partner_id', '=', partnerId], ['program_id.program_type', '=', 'ewallet']]],
    { fields: ['id', 'points', 'program_id'], limit: 1 }
  );
  if (wallets.length === 0) return { balance: 0, cardId: null };
  return { balance: wallets[0].points, cardId: wallets[0].id };
}

// ══════════════════════════════════════════
// FLUJO PRINCIPAL
// ══════════════════════════════════════════
var isProcessing = false;
var barcodeBuffer = '';
var barcodeTimer = null;

async function processBarcode(barcode) {
  if (isProcessing) return;
  if (!barcode || barcode.length < 3) return;

  const cfg = getConfig();
  if (!cfg.user) {
    showScreen('idle');
    document.getElementById('not-configured-msg').innerHTML =
      '<div class="not-configured">Configura el usuario de Odoo antes de usar el kiosco</div>';
    return;
  }

  isProcessing = true;
  showScreen('loading');

  try {
    await odooAuth();

    const employee = await findEmployee(barcode);
    if (!employee) {
      document.getElementById('notfound-code').textContent = barcode;
      showScreen('not-found');
      autoReturn('progress3', 4000);
      return;
    }

    const empData = await getEmployeePartner(employee.id);
    const partnerId = empData && empData.address_home_id ? empData.address_home_id[0] : null;

    if (!partnerId) {
      throw new Error('El empleado no tiene contacto vinculado. Configuralo en su perfil.');
    }

    const walletData = await getWalletBalance(partnerId);
    const balance = walletData.balance;
    const cardId = walletData.cardId;
    const price = cfg.price;

    if (balance < price) {
      document.getElementById('nobal-name').textContent = employee.name.split(' ')[0].toUpperCase();
      document.getElementById('nobal-balance').textContent = '$' + balance.toFixed(0);
      showScreen('no-balance');
      autoReturn('progress2', 5000);
      return;
    }

    if (cardId) {
      const newBalance = balance - price;
      await odooCall('loyalty.card', 'write', [[cardId], { points: newBalance }], {});
      document.getElementById('success-name').textContent = employee.name.split(' ')[0].toUpperCase();
      document.getElementById('success-charged').textContent = '-$' + price.toFixed(0);
      document.getElementById('success-balance').textContent = '$' + newBalance.toFixed(0);
    } else {
      throw new Error('No se encontro monedero para este empleado. Recargalo primero.');
    }

    showScreen('success');
    autoReturn('progress', 4000);

  } catch (err) {
    console.error(err);
    var msg = err.message || 'Error desconocido';
    document.getElementById('error-detail').textContent = msg.substring(0, 80);
    showScreen('error');
    autoReturn('progress4', 5000);
  } finally {
    isProcessing = false;
  }
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  if (name !== 'idle') {
    document.getElementById('barcode-input').blur();
  } else {
    document.getElementById('not-configured-msg').innerHTML = '';
    setTimeout(function() { document.getElementById('barcode-input').focus(); }, 100);
  }
}

function autoReturn(progressId, duration) {
  var bar = document.getElementById(progressId);
  bar.style.transition = 'none';
  bar.style.width = '0%';
  setTimeout(function() {
    bar.style.transition = 'width ' + duration + 'ms linear';
    bar.style.width = '100%';
  }, 50);
  setTimeout(function() { showScreen('idle'); }, duration);
}

// ══════════════════════════════════════════
// CAPTURA DE CÓDIGO DE BARRAS
// ══════════════════════════════════════════
document.getElementById('barcode-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    var val = document.getElementById('barcode-input').value.trim();
    document.getElementById('barcode-input').value = '';
    if (val) processBarcode(val);
  }
});

document.addEventListener('keypress', function(e) {
  if (document.getElementById('config-overlay').classList.contains('open')) return;
  if (isProcessing) return;
  if (e.key === 'Enter') {
    if (barcodeBuffer.length >= 3) processBarcode(barcodeBuffer);
    barcodeBuffer = '';
    clearTimeout(barcodeTimer);
  } else {
    barcodeBuffer += e.key;
    clearTimeout(barcodeTimer);
    barcodeTimer = setTimeout(function() { barcodeBuffer = ''; }, 200);
  }
});

document.addEventListener('click', function(e) {
  if (!document.getElementById('config-overlay').classList.contains('open')) {
    document.getElementById('barcode-input').focus();
  }
});

// ══════════════════════════════════════════
// RELOJ Y FECHA
// ══════════════════════════════════════════
function updateClock() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, '0');
  var m = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = h + ':' + m;
  var days = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
  var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  document.getElementById('date-display').textContent =
    days[now.getDay()] + ' ' + now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
}
setInterval(updateClock, 1000);
updateClock();

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
updateDisplayPrice();
document.getElementById('barcode-input').focus();

var cfg = getConfig();
if (!cfg.user) {
  document.getElementById('not-configured-msg').innerHTML =
    '<div class="not-configured">Falta configurar el correo de usuario. Haz clic en Configuracion</div>';
}
