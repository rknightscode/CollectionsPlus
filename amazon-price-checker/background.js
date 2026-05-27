// ─── Constants ────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── In-memory state ──────────────────────────────────────────────────────────
const tabProducts = {};   // tabId → { asin, currentPrice, productName, url }
const priceCache  = {};   // asin  → { data, timestamp }

// ─── Extension icon / side panel setup ───────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  // Always keep the side panel available; let the sidebar decide what to show
  chrome.sidePanel.setOptions({ tabId, path: 'sidebar.html', enabled: true });

  // If navigating away from a product page, clear stored data
  if (tabProducts[tabId] && !isProductPage(tab.url)) {
    delete tabProducts[tabId];
    broadcastToSidebar({ type: 'PRODUCT_CLEARED' });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabProducts[tabId];
});

// Open sidebar when toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content script reporting a product page
  if (msg.type === 'PRODUCT_DETECTED') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    tabProducts[tabId] = {
      asin:         msg.asin,
      currentPrice: msg.currentPrice,
      productName:  msg.productName,
      url:          msg.url,
    };
    // Notify any open sidebar
    broadcastToSidebar({ type: 'PRODUCT_UPDATED', ...tabProducts[tabId] });
    sendResponse({ ok: true });
    return false;
  }

  // Sidebar asking for current tab's product info
  if (msg.type === 'GET_TAB_PRODUCT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) return sendResponse(null);
      sendResponse(tabProducts[tab.id] || null);
    });
    return true; // async
  }

  // Sidebar asking for CCC price data
  if (msg.type === 'FETCH_CCC_DATA') {
    fetchWithCache(msg.asin)
      .then(data  => sendResponse({ ok: true,  data }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }
});

// ─── CCC fetch & parse ────────────────────────────────────────────────────────
async function fetchWithCache(asin) {
  const cached = priceCache[asin];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchCCCData(asin);
  priceCache[asin] = { data, timestamp: Date.now() };
  return data;
}

async function fetchCCCData(asin) {
  const url = `https://uk.camelcamelcamel.com/product/${asin}`;
  const res = await fetch(url, {
    headers: {
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Cache-Control':   'no-cache',
    },
  });

  if (res.status === 404) throw new Error('Product not found on CamelCamelCamel');
  if (!res.ok)           throw new Error(`CamelCamelCamel returned HTTP ${res.status}`);

  const html = await res.text();
  return parseCCCPage(html, asin);
}

/**
 * Multi-strategy parser for CamelCamelCamel product pages.
 *
 * Strategy 1 – Highcharts data arrays  (most accurate – gives real 12m range)
 * Strategy 2 – HTML price stats table  (all-time low/high labels in DOM)
 * Strategy 3 – Regex £ patterns near keywords (last resort)
 */
function parseCCCPage(html, asin) {
  const MS_12M = 365 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - MS_12M;

  // ── Strategy 1: Highcharts series data ──────────────────────────────────
  // CCC embeds: data:[[1712000000000,24.99],[...]]
  // 13-digit timestamps = milliseconds epoch
  const chartRe = /data\s*:\s*(\[\s*\[\s*\d{13}[\d\s.,\[\]]+?\])/g;
  let s1match;
  let bestSeries = null;

  while ((s1match = chartRe.exec(html)) !== null) {
    try {
      // Grab everything from the opening [ up to a closing ]] that marks end of array
      // Find the full balanced array starting at s1match index
      const startIdx = html.indexOf(s1match[1], s1match.index);
      const raw = extractJsonArray(html, startIdx);
      if (!raw) continue;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) continue;

      const recent = parsed
        .filter(([ts]) => ts > cutoff)
        .map(([, price]) => price)
        .filter(p => typeof p === 'number' && p > 0 && p < 100000);

      if (recent.length > (bestSeries?.length ?? 0)) {
        bestSeries = recent;
      }
    } catch (_) {}
  }

  if (bestSeries && bestSeries.length >= 2) {
    return {
      low12m:     Math.min(...bestSeries),
      high12m:    Math.max(...bestSeries),
      dataPoints: bestSeries.length,
      period:     '12 months',
      confidence: 'high',
      cccUrl:     `https://uk.camelcamelcamel.com/product/${asin}`,
    };
  }

  // ── Strategy 2: DOM price stats table ───────────────────────────────────
  // Strip scripts/styles so we only search visible text
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const lowestRe  = /[Ll]owest\s+[Pp]rice[^\d£]*£\s*([\d,]+\.?\d*)/;
  const highestRe = /[Hh]ighest\s+[Pp]rice[^\d£]*£\s*([\d,]+\.?\d*)/;

  const lm = body.match(lowestRe);
  const hm = body.match(highestRe);

  if (lm && hm) {
    const low  = parseFloat(lm[1].replace(',', ''));
    const high = parseFloat(hm[1].replace(',', ''));
    if (low > 0 && high >= low) {
      return {
        low12m:     low,
        high12m:    high,
        dataPoints: 0,
        period:     'all time',
        confidence: 'medium',
        cccUrl:     `https://uk.camelcamelcamel.com/product/${asin}`,
      };
    }
  }

  // ── Strategy 3: Any adjacent price pair ─────────────────────────────────
  // Look for two distinct £ prices in proximity — likely the range
  const allPrices = [...body.matchAll(/£\s*([\d,]+\.?\d*)/g)]
    .map(m => parseFloat(m[1].replace(',', '')))
    .filter(p => p > 0.5 && p < 100000);

  const unique = [...new Set(allPrices)].sort((a, b) => a - b);
  if (unique.length >= 2) {
    return {
      low12m:     unique[0],
      high12m:    unique[unique.length - 1],
      dataPoints: 0,
      period:     'approx',
      confidence: 'low',
      cccUrl:     `https://uk.camelcamelcamel.com/product/${asin}`,
    };
  }

  throw new Error('Could not extract price history — product may not be tracked yet.');
}

/**
 * Extracts a balanced JSON array starting at `startIdx` in `str`.
 * Stops when bracket depth returns to 0.
 */
function extractJsonArray(str, startIdx) {
  let depth = 0;
  let i = startIdx;
  const start = str.indexOf('[', i);
  if (start === -1) return null;
  i = start;

  for (; i < str.length; i++) {
    if (str[i] === '[') depth++;
    else if (str[i] === ']') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isProductPage(url) {
  if (!url?.includes('amazon.co.uk')) return false;
  const ignored = [
    /\/gp\/prime/i, /\/gp\/yourstore/i, /\/gp\/css/i,
    /\/gp\/cart/i,  /\/gp\/checkout/i,  /\/account/i,
    /\/wishlist/i,  /[?&]field-keywords/i, /\/s[?/]/i,
  ];
  if (ignored.some(p => p.test(url))) return false;
  return /\/dp\/[A-Z0-9]{10}/i.test(url) || /\/gp\/product\/[A-Z0-9]{10}/i.test(url);
}

function broadcastToSidebar(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Sidebar may not be open — silently ignore
  });
}
