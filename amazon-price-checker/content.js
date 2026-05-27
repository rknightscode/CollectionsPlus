// Runs on amazon.co.uk pages
// Responsible for: detecting product pages, extracting ASIN + price, notifying background

(function () {
  'use strict';

  const IGNORED = [
    /\/gp\/prime/i, /\/gp\/yourstore/i, /\/gp\/css/i,
    /\/gp\/cart/i,  /\/gp\/checkout/i,  /\/account/i,
    /\/wishlist/i,  /[?&]field-keywords/i, /\/s[?/]/i,
  ];

  function isProductPage(url) {
    if (IGNORED.some(p => p.test(url))) return false;
    return /\/dp\/[A-Z0-9]{10}/i.test(url) || /\/gp\/product\/[A-Z0-9]{10}/i.test(url);
  }

  function extractASIN(url) {
    const patterns = [
      /\/dp\/([A-Z0-9]{10})/i,
      /\/gp\/product\/([A-Z0-9]{10})/i,
      /\/gp\/aw\/d\/([A-Z0-9]{10})/i,
      /[?&]asin=([A-Z0-9]{10})/i,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1].toUpperCase();
    }
    return null;
  }

  function extractPrice() {
    // Amazon uses many different price selectors depending on page type
    const selectors = [
      '.priceToPay .a-offscreen',
      '.priceToPay .a-price-whole',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '.a-price.a-text-price.a-size-medium.apexPriceToPay .a-offscreen',
      '.a-price .a-offscreen',
      '#corePrice_feature_div .a-offscreen',
      '#apex_offerDisplay_desktop .a-price .a-offscreen',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent.trim();
      const price = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (!isNaN(price) && price > 0) return price;
    }
    return null;
  }

  function extractProductName() {
    const el = document.querySelector('#productTitle, #title');
    return el ? el.textContent.trim().slice(0, 150) : 'Unknown product';
  }

  function report() {
    const url = window.location.href;
    if (!isProductPage(url)) return;

    const asin = extractASIN(url);
    if (!asin) return;

    const payload = {
      type:         'PRODUCT_DETECTED',
      asin,
      currentPrice: extractPrice(),
      productName:  extractProductName(),
      url,
    };

    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  // Run immediately on load
  report();

  // Also watch for SPA-style navigations (Amazon occasionally does this)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(report, 800); // brief delay for DOM to settle
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
