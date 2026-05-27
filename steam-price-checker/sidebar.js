'use strict';

const $ = id => document.getElementById(id);

const states = {
  idle:    $('state-idle'),
  loading: $('state-loading'),
  error:   $('state-error'),
  nokey:   $('state-no-key'),
  result:  $('state-result'),
};

const ui = {
  productName:   $('product-name'),
  verdictBlock:  $('verdict-block'),
  verdictLabel:  $('verdict-label'),
  currentPrice:  $('current-price'),
  discountBadge: $('discount-badge'),
  aboveLowText:  $('above-low-text'),
  lowPrice:      $('low-price'),
  highPrice:     $('high-price'),
  rangeFill:     $('range-fill'),
  rangeMarker:   $('range-marker'),
  errorMessage:  $('error-message'),
  itadLink:      $('itad-link'),
  steamdbLink:   $('steamdb-link'),
  dataPeriod:    $('data-period'),
  dataPoints:    $('data-points'),
  priceNote:     $('price-note'),
  btnRefresh:    $('btn-refresh'),
  btnSettings:   $('btn-settings'),
  btnRetry:      $('btn-retry'),
  btnNokeySettings: $('btn-nokey-settings'),
  nokeysteamdbLink: $('nokey-steamdb-link'),
  btnSave:       $('btn-save-settings'),
  btnClose:      $('btn-close-settings'),
  settingsPanel: $('settings-panel'),
  sItadKey:      $('s-itad-key'),
  sGreen:        $('s-green'),
  sRed:          $('s-red'),
};

let currentProduct = null;
let currentData    = null;
let settings = { greenPct: 10, redPct: 30, itadApiKey: '' };

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  showState('idle');
  requestProduct();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PRODUCT_UPDATED') {
      currentProduct = msg;
      currentData = null;
      loadPriceData();
    }
    if (msg.type === 'PRODUCT_CLEARED') {
      currentProduct = null;
      currentData = null;
      showState('idle');
    }
  });
}

function requestProduct() {
  chrome.runtime.sendMessage({ type: 'GET_TAB_PRODUCT' }, (product) => {
    if (chrome.runtime.lastError) return;
    if (product) { currentProduct = product; loadPriceData(); }
  });
}

// ── Data ──────────────────────────────────────────────────────────────────────
function loadPriceData() {
  if (!currentProduct?.appId) { showState('idle'); return; }
  showState('loading');

  chrome.runtime.sendMessage({ type: 'FETCH_PRICE_DATA', appId: currentProduct.appId }, (res) => {
    if (chrome.runtime.lastError || !res) { showError('Extension error — please reload.'); return; }
    if (!res.ok) {
      if (res.error === 'NO_ITAD_KEY') {
        if (currentProduct?.appId) {
          ui.nokeysteamdbLink.href = `https://steamdb.info/app/${currentProduct.appId}/`;
          ui.nokeysteamdbLink.classList.remove('hidden');
        }
        showState('nokey');
        return;
      }
      showError(res.error || 'Failed to fetch price data.');
      return;
    }
    currentData = res.data;
    renderResult();
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResult() {
  const { appId, currentPrice, discount, productName } = currentProduct;
  const { low12m, high12m, period, dataPoints, itadUrl, steamdbUrl } = currentData;
  const range = high12m - low12m;

  let aboveLowPct = null, barPct = 50, color = 'orange';

  if (currentPrice != null && currentPrice > 0) {
    aboveLowPct = low12m > 0 ? ((currentPrice - low12m) / low12m) * 100 : 0;
    color  = aboveLowPct <= settings.greenPct ? 'green'
           : aboveLowPct >= settings.redPct   ? 'red'
           : 'orange';
    barPct = range > 0 ? Math.min(100, Math.max(0, ((currentPrice - low12m) / range) * 100)) : 0;
  } else if (currentPrice === 0) {
    color = 'green'; barPct = 0;
  }

  const labels = {
    green:  '✓ Near 12-month Low',
    orange: '~ Mid-range Price',
    red:    '✕ Near 12-month High',
  };

  ui.productName.textContent    = productName || `AppID ${appId}`;
  ui.verdictBlock.className     = `verdict-block is-${color}`;
  ui.verdictLabel.textContent   = labels[color];

  if (currentPrice === 0) {
    ui.currentPrice.textContent  = 'Free';
    ui.aboveLowText.textContent  = 'Free to Play';
    ui.discountBadge.classList.add('hidden');
    ui.priceNote.classList.add('hidden');
  } else if (currentPrice != null) {
    ui.currentPrice.textContent  = `£${currentPrice.toFixed(2)}`;
    ui.aboveLowText.textContent  = aboveLowPct !== null
      ? `${aboveLowPct >= 0 ? '+' : ''}${aboveLowPct.toFixed(1)}% vs 12m low` : '';
    if (discount && discount < 0) {
      ui.discountBadge.textContent = `${discount}%`;
      ui.discountBadge.classList.remove('hidden');
    } else {
      ui.discountBadge.classList.add('hidden');
    }
    ui.priceNote.classList.add('hidden');
  } else {
    ui.currentPrice.textContent  = '–';
    ui.aboveLowText.textContent  = '';
    ui.discountBadge.classList.add('hidden');
    ui.priceNote.classList.remove('hidden');
  }

  ui.lowPrice.textContent      = `£${low12m.toFixed(2)}`;
  ui.highPrice.textContent     = `£${high12m.toFixed(2)}`;
  ui.rangeFill.style.width     = `${barPct}%`;
  ui.rangeMarker.style.left    = `${barPct}%`;
  ui.rangeMarker.className     = `range-marker is-${color}`;
  ui.dataPeriod.textContent    = period || '';
  ui.dataPoints.textContent    = dataPoints ? `${dataPoints} data points` : '';
  ui.itadLink.href             = itadUrl   || '#';
  ui.steamdbLink.href          = steamdbUrl || `https://steamdb.info/app/${appId}/`;

  showState('result');
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ greenPct: 10, redPct: 30, itadApiKey: '' }, (data) => {
      settings = data;
      ui.sGreen.value   = data.greenPct;
      ui.sRed.value     = data.redPct;
      ui.sItadKey.value = data.itadApiKey;
      resolve();
    });
  });
}

function saveSettings() {
  const greenPct   = Math.max(0, parseInt(ui.sGreen.value, 10) || 10);
  const redPct     = Math.max(greenPct + 1, parseInt(ui.sRed.value, 10) || 30);
  const itadApiKey = ui.sItadKey.value.trim();
  settings = { greenPct, redPct, itadApiKey };
  chrome.storage.sync.set(settings, () => {
    closeSettings();
    if (currentData) renderResult();
    else if (currentProduct?.appId && itadApiKey) loadPriceData();
  });
}

function openSettings()  { loadSettings(); ui.settingsPanel.classList.remove('hidden'); }
function closeSettings() { ui.settingsPanel.classList.add('hidden'); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function showState(name) {
  Object.entries(states).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}
function showError(msg) { ui.errorMessage.textContent = msg; showState('error'); }

// ── Events ────────────────────────────────────────────────────────────────────
ui.btnRefresh.addEventListener('click',        () => currentProduct?.appId ? loadPriceData() : requestProduct());
ui.btnRetry.addEventListener('click',          () => currentProduct?.appId ? loadPriceData() : requestProduct());
ui.btnSettings.addEventListener('click',       openSettings);
ui.btnNokeySettings.addEventListener('click',  openSettings);
ui.btnClose.addEventListener('click',          closeSettings);
ui.btnSave.addEventListener('click',           saveSettings);

init();
