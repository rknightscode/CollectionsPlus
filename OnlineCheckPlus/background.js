// OnlineCheckPlus - Background Service Worker v4

const pending = new Map();

// ── Shared URL builder for SRA ────────────────────────────────────────────────
// Regex: if selection is digits-only (ignoring spaces/hyphens) → SRANumber param
//        otherwise → Name param
function sraUrl(q) {
  const stripped = q.replace(/[\s\-]/g, "");
  const isNumber = /^\d+$/.test(stripped);
  const param = isNumber
    ? `SRANumber=${encodeURIComponent(stripped)}`
    : `Name=${encodeURIComponent(q)}`;
  return `https://solicitors.lawsociety.org.uk/search/results?Pro=True&${param}`;
}

// ── Inject functions (run inside the target page) ─────────────────────────────

/** SRA – Person: click #Pro_Type_2 and re-submit the search form. */
function injectSRAPerson() {
  function attempt(n) {
    const radio = document.querySelector("#Pro_Type_2");
    if (!radio) {
      if (n > 0) setTimeout(() => attempt(n - 1), 400);
      return;
    }
    if (!radio.checked) {
      radio.click();
      // Submit the enclosing form so results refresh
      setTimeout(() => {
        const form = radio.closest("form") || document.querySelector("form");
        if (form) form.submit();
      }, 250);
    }
    // Verify it stuck; retry if page reset it
    if (n > 0) {
      setTimeout(() => { if (!radio.checked) attempt(n - 1); }, 500);
    }
  }
  setTimeout(() => attempt(4), 600);
}

/** SRA – Organisation: click #Pro_Type_1 (already the default, but be explicit) and re-submit. */
function injectSRAOrganisation() {
  function attempt(n) {
    const radio = document.querySelector("#Pro_Type_1");
    if (!radio) {
      if (n > 0) setTimeout(() => attempt(n - 1), 400);
      return;
    }
    if (!radio.checked) {
      radio.click();
      setTimeout(() => {
        const form = radio.closest("form") || document.querySelector("form");
        if (form) form.submit();
      }, 250);
    }
    if (n > 0) {
      setTimeout(() => { if (!radio.checked) attempt(n - 1); }, 500);
    }
  }
  setTimeout(() => attempt(4), 600);
}

/** HMRC VAT: strip everything except digits, fill VRN field, submit. */
function injectHMRCVAT(rawText) {
  const vatNum = rawText.replace(/[^0-9]/g, "");
  const selectors = ["#vatNumber", 'input[name="vrn"]', 'input[name*="vat" i]', 'input[id*="vat" i]', 'input[type="text"]'];
  let input = null;
  for (const sel of selectors) { input = document.querySelector(sel); if (input) break; }
  if (input) {
    input.focus();
    input.value = vatNum;
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  setTimeout(() => {
    const btn = document.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) btn.click();
  }, 400);
}

// ── Menu definitions ──────────────────────────────────────────────────────────
const MENUS = [
  // ── SRA (2 entries — regex auto-routes name vs number in the URL) ─────────
  {
    id:     "sra_person",
    title:  "🔎 SRA – Person / Individual",
    url:    sraUrl,
    inject: injectSRAPerson       // clicks #Pro_Type_2
  },
  {
    id:     "sra_org",
    title:  "🔎 SRA – Firm / Organisation",
    url:    sraUrl,
    inject: injectSRAOrganisation // clicks #Pro_Type_1
  },
  // ── Companies House ───────────────────────────────────────────────────────
  {
    id:    "ch_search",
    title: "🏢 Companies House – Search by Name",
    url:   (q) => `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(q)}`
  },
  {
    id:    "ch_number",
    title: "🏢 Companies House – Go to Company Number",
    url:   (q) => `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(q.replace(/[\s\-\.]/g, ""))}`
  },
  // ── HMRC ──────────────────────────────────────────────────────────────────
  {
    id:     "hmrc_vat",
    title:  "💷 HMRC – VAT Number Check",
    url:    () => "https://www.tax.service.gov.uk/check-vat-number/enter-vat-details",
    inject: injectHMRCVAT
  }
];

// ── Build context menus ───────────────────────────────────────────────────────
function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ocp_parent", title: "OnlineCheckPlus ›", contexts: ["selection"] });
    MENUS.forEach((m) => {
      chrome.contextMenus.create({ id: m.id, parentId: "ocp_parent", title: m.title, contexts: ["selection"] });
    });
  });
}

chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);

// ── Handle context menu click ─────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info) => {
  const selectedText = (info.selectionText || "").trim();
  if (!selectedText) return;

  const match = MENUS.find((m) => m.id === info.menuItemId);
  if (!match) return;

  const targetUrl = match.url(selectedText);

  if (match.inject) {
    chrome.tabs.create({ url: targetUrl, active: true }, (newTab) => {
      pending.set(newTab.id, { func: match.inject, args: [selectedText] });
    });
  } else {
    chrome.tabs.create({ url: targetUrl, active: true });
  }
});

// ── Fire injection once tab finishes loading ──────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!pending.has(tabId)) return;

  const { func, args } = pending.get(tabId);
  pending.delete(tabId);

  chrome.scripting.executeScript({ target: { tabId }, func, args })
    .catch((err) => console.warn("OnlineCheckPlus inject failed:", err.message));
});
