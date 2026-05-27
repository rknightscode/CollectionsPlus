const CACHE_TTL_MS = 60 * 60 * 1000;

const tabProducts = {};
const priceCache  = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  chrome.sidePanel.setOptions({ tabId, path: 'sidebar.html', enabled: true });

  if (tabProducts[tabId] && !isSteamGamePage(tab.url)) {
    delete tabProducts[tabId];
    chrome.runtime.sendMessage({ type: 'PRODUCT_CLEARED' }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabProducts[tabId];
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'PRODUCT_DETECTED') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    tabProducts[tabId] = {
      appId:        msg.appId,
      currentPrice: msg.currentPrice,
      discount:     msg.discount,
      productName:  msg.productName,
    };
    chrome.runtime.sendMessage({ type: 'PRODUCT_UPDATED', ...tabProducts[tabId] }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'GET_TAB_PRODUCT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse(tabs[0] ? (tabProducts[tabs[0].id] || null) : null);
    });
    return true;
  }

  if (msg.type === 'FETCH_PRICE_DATA') {
    const cached = priceCache[msg.appId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      sendResponse({ ok: true, data: cached.data });
      return false;
    }

    chrome.storage.sync.get({ itadApiKey: '' }, ({ itadApiKey }) => {
      if (!itadApiKey) {
        sendResponse({ ok: false, error: 'NO_ITAD_KEY' });
        return;
      }
      fetchITAD(msg.appId, itadApiKey.trim())
        .then(data => {
          priceCache[msg.appId] = { data, timestamp: Date.now() };
          sendResponse({ ok: true, data });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
    });
    return true;
  }
});

async function fetchITAD(appId, apiKey) {
  const BASE = 'https://api.isthereanydeal.com';

  const lookupRes = await fetch(
    `${BASE}/games/lookup/v1?key=${encodeURIComponent(apiKey)}&appid=${appId}`
  );
  if (lookupRes.status === 401) throw new Error('ITAD API key invalid or expired');
  if (lookupRes.status === 404) throw new Error('Game not found on IsThereAnyDeal');
  if (!lookupRes.ok)            throw new Error(`ITAD lookup failed (HTTP ${lookupRes.status})`);

  const lookupJson = await lookupRes.json();
  const gameId   = lookupJson?.game?.id;
  const gameSlug = lookupJson?.game?.slug;
  if (!gameId) throw new Error('Could not resolve game ID from ITAD');

  const histRes = await fetch(
    `${BASE}/games/history/v2?key=${encodeURIComponent(apiKey)}&id=${gameId}&country=GB&shops[]=steam`
  );
  if (!histRes.ok) throw new Error(`ITAD history failed (HTTP ${histRes.status})`);

  const histJson = await histRes.json();

  const shopEntry = Array.isArray(histJson)
    ? histJson.find(s => s.shop?.id === 'steam')
    : null;
  const deals = shopEntry?.deals
    ?? (Array.isArray(histJson) ? histJson.flatMap(s => s.deals ?? []) : []);

  if (!deals.length) throw new Error('No Steam price history found on ITAD');

  const MS_12M  = 365 * 24 * 60 * 60 * 1000;
  const cutoff  = Date.now() - MS_12M;

  const toPrice = p => p > 500 ? p / 100 : p; // handle pence vs pounds

  const recent = deals
    .filter(d => new Date(d.timestamp).getTime() > cutoff)
    .map(d => d.price?.amount)
    .filter(p => typeof p === 'number' && p >= 0)
    .map(toPrice);

  const all = deals
    .map(d => d.price?.amount)
    .filter(p => typeof p === 'number' && p >= 0)
    .map(toPrice);

  const prices = recent.length >= 2 ? recent : all;
  const period = recent.length >= 2 ? '12 months' : 'all time';

  if (prices.length < 2) throw new Error('Not enough price history data on ITAD');

  return {
    low12m:     Math.min(...prices),
    high12m:    Math.max(...prices),
    dataPoints: prices.length,
    period,
    itadUrl:    `https://isthereanydeal.com/game/${gameSlug ?? appId}/history/`,
    steamdbUrl: `https://steamdb.info/app/${appId}/`,
  };
}

function isSteamGamePage(url) {
  return /store\.steampowered\.com\/app\/\d+/.test(url ?? '');
}
