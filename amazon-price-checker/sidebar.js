'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const states = {
  idle:    $('state-idle'),
  loading: $('state-loading'),
  error:   $('state-error'),
  result:  $('state-result'),
};

const ui = {
  productName:    $('product-name'),
  verdictBlock:   $('verdict-block'),
  verdictLabel:   $('verdict-label'),
  currentPrice:   $('current-price'),
  aboveLowText:   $('above-low-text'),
  lowPrice:       $('low-price'),
  highPrice:      $('high-price'),
  rangeFill:      $('range-fill'),
  rangeMarker:    $('range-marker'),
  errorMessage:   $('error-message'),
  cccLink:        $('ccc-link'),
  dataPeriod:     $('data-period'),
  confidenceChip: $('confidence-chip'),
  amazonPriceNote:$('amazon-price-note'),
  btnRefresh:     $('btn-refresh'),
  btnSettings:    $('btn-settings'),
  btnRetry:       $('btn-retry'),
  btnSave:        $('btn-save-settings'),
  btnClose:       $('btn-close-settings'),
  settingsPanel:  $('settings-panel'),
  sGreen:         $('s-green'),
  sRed:           $('s-red'),
};

// ── App state ─────────────────────────────────────────────────────────────────
let currentProduct = null;
let currentCCCData  = null;
let settings = { greenPct: 10, redPct: 30 };

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  showState('idle');
  requestProductFromBackground();

  // Listen for background broadcasts
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PRODUCT_UPDATED') {
      currentProduct = msg;
      currentCCCData = null;
      loadPriceData();
    }
    if (msg.type === 'PRODUCT_CLEARED') {
      currentProduct = null;
      currentCCCData = null;
      showState('idle');
    }
  });
}

function requestProductFromBackground() {
  chrome.runtime.sendMessage({ type: 'GET_TAB_PRODUCT' }, (product) => {
    if (chrome.runtime.lastError) return;
    if (product) {
      currentProduct = product;
      loadPriceData();
    }
  });
}

// ── Data loading ──────────────────────────────────────────────────────────────
function loadPriceData() {
  if (!currentProduct?.asin) { showState('idle'); return; }

  showState('loading');

  chrome.runtime.sendMessage(
    { type: 'FETCH_CCC_DATA', asin: currentProduct.asin },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        showError('Extension error — please reload the sidebar.');
        return;
      }
      if (!response.ok) {
        showError(response.error || 'Failed to fetch price data.');
        return;
      }
      currentCCCData = response.data;
      renderResult();
    }
  );
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderResult() {
  const { asin, currentPrice, productName } = currentProduct;
  const { low12m, high12m, period, confidence, cccUrl } = currentCCCData;

  // Determine which price to display
  const displayPrice = currentPrice ?? null;
  const range = high12m - low12m;

  // Calculate % above 12m low
  let aboveLowPct = null;
  let barPct = 0;
  let color = 'orange';

  if (displayPrice !== null) {
    aboveLowPct = low12m > 0 ? ((displayPrice - low12m) / low12m) * 100 : 0;

    if (aboveLowPct <= settings.greenPct) color = 'green';
    else if (aboveLowPct >= settings.redPct) color = 'red';
    else color = 'orange';

    barPct = range > 0 ? Math.min(100, Math.max(0, ((displayPrice - low12m) / range) * 100)) : 0;
  } else {
    // No current price — just show 12m range without verdict colour
    color = 'orange';
    barPct = 50;
  }

  // Verdict labels
  const labels = {
    green:  '✓ Near 12-month Low',
    orange: '~ Mid-range Price',
    red:    '✕ Near 12-month High',
  };

  // Product name
  ui.productName.textContent = productName || `ASIN: ${asin}`;

  // Verdict block
  ui.verdictBlock.className = `verdict-block is-${color}`;
  ui.verdictLabel.textContent = labels[color];

  if (displayPrice !== null) {
    ui.currentPrice.textContent = `£${displayPrice.toFixed(2)}`;
    ui.aboveLowText.textContent = aboveLowPct >= 0
      ? `${aboveLowPct >= 0 ? '+' : ''}${aboveLowPct.toFixed(1)}% vs 12m low`
      : `${aboveLowPct.toFixed(1)}% vs 12m low`;
    ui.amazonPriceNote.classList.add('hidden');
  } else {
    ui.currentPrice.textContent = '–';
    ui.aboveLowText.textContent = 'Current price not detected';
    ui.amazonPriceNote.classList.remove('hidden');
  }

  // Range bar
  ui.lowPrice.textContent  = `£${low12m.toFixed(2)}`;
  ui.highPrice.textContent = `£${high12m.toFixed(2)}`;
  ui.rangeFill.style.width = `${barPct}%`;
  ui.rangeMarker.style.left = `${barPct}%`;
  ui.rangeMarker.className = `range-marker is-${color}`;

  // Metadata
  ui.dataPeriod.textContent     = period || 'period unknown';
  ui.confidenceChip.textContent = `${confidence ?? '?'} confidence`;

  // CCC link
  ui.cccLink.href = cccUrl || `https://uk.camelcamelcamel.com/product/${asin}`;

  showState('result');
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ greenPct: 10, redPct: 30 }, (data) => {
      settings = data;
      ui.sGreen.value = data.greenPct;
      ui.sRed.value   = data.redPct;
      resolve();
    });
  });
}

function saveSettings() {
  const greenPct = Math.max(0, parseInt(ui.sGreen.value, 10) || 10);
  const redPct   = Math.max(greenPct + 1, parseInt(ui.sRed.value, 10) || 30);

  settings = { greenPct, redPct };
  chrome.storage.sync.set(settings, () => {
    closeSettings();
    if (currentCCCData) renderResult(); // re-render with new bands
  });
}

function openSettings()  { ui.settingsPanel.classList.remove('hidden'); }
function closeSettings() { ui.settingsPanel.classList.add('hidden'); }

// ── State management ──────────────────────────────────────────────────────────
function showState(name) {
  Object.entries(states).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

function showError(msg) {
  ui.errorMessage.textContent = msg;
  showState('error');
}

// ── Event listeners ───────────────────────────────────────────────────────────
ui.btnRefresh.addEventListener('click', () => {
  if (currentProduct?.asin) loadPriceData();
  else requestProductFromBackground();
});

ui.btnRetry.addEventListener('click', () => {
  if (currentProduct?.asin) loadPriceData();
  else requestProductFromBackground();
});

ui.btnSettings.addEventListener('click', openSettings);
ui.btnClose.addEventListener('click', closeSettings);
ui.btnSave.addEventListener('click', saveSettings);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
init();
