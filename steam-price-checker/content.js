(function () {
  'use strict';

  function getAppId(url) {
    // Only fire on store.steampowered.com/app/{id} pages
    const m = url.match(/store\.steampowered\.com\/app\/(\d+)/);
    return m ? m[1] : null;
  }

  function getCurrentPrice() {
    // On sale
    const sale = document.querySelector('.discount_final_price');
    if (sale) {
      const p = parseFloat(sale.textContent.replace(/[^0-9.]/g, ''));
      if (!isNaN(p)) return p;
    }
    // Full price
    const full = document.querySelector('.game_purchase_price.price');
    if (full) {
      if (/free/i.test(full.textContent)) return 0;
      const p = parseFloat(full.textContent.replace(/[^0-9.]/g, ''));
      if (!isNaN(p)) return p;
    }
    return null;
  }

  function getDiscount() {
    const el = document.querySelector('.discount_pct');
    if (!el) return null;
    const m = el.textContent.match(/-?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function getProductName() {
    const el = document.querySelector('.apphub_AppName, #appHubAppName');
    return el ? el.textContent.trim().slice(0, 150) : null;
  }

  function report() {
    const appId = getAppId(window.location.href);
    if (!appId) return;

    chrome.runtime.sendMessage({
      type:         'PRODUCT_DETECTED',
      appId,
      currentPrice: getCurrentPrice(),
      discount:     getDiscount(),
      productName:  getProductName() || `AppID ${appId}`,
    }).catch(() => {});
  }

  report();

  // Steam does client-side navigation between store pages
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(report, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
