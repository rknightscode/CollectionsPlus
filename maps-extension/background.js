// ─── UK Postcode Regex ───────────────────────────────────────────────────────
// Matches full postcodes like "SW1A 1AA", "EC1A 1BB", "W1A 0AX", "M1 1AE" etc.
// Optional space in the middle.
const POSTCODE_RE = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;

const MAPS_BASE = "https://www.google.co.uk/maps/search/";

// Search engines to watch for postcode redirects.
// Each entry: { urlPattern, getQuery(url) }
const SEARCH_ENGINES = [
  {
    match: (url) => url.hostname.includes("bing.com") && url.pathname === "/search",
    getQuery: (url) => url.searchParams.get("q"),
  },
  {
    match: (url) =>
      (url.hostname.includes("google.co.uk") || url.hostname.includes("google.com")) &&
      url.pathname === "/search",
    getQuery: (url) => url.searchParams.get("q"),
  },
  {
    match: (url) => url.hostname.includes("duckduckgo.com") && url.pathname === "/",
    getQuery: (url) => url.searchParams.get("q"),
  },
  {
    match: (url) => url.hostname.includes("search.yahoo.com") && url.pathname.startsWith("/search"),
    getQuery: (url) => url.searchParams.get("p"),
  },
];

// ─── Context Menu ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "searchGoogleMaps",
    title: 'Search Google Maps for "%s"',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "searchGoogleMaps" && info.selectionText) {
    const query = encodeURIComponent(info.selectionText.trim());
    chrome.tabs.create({ url: MAPS_BASE + query });
  }
});

// ─── Postcode Redirect ────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when the URL changes (loading state), not on every update
  if (changeInfo.status !== "loading" || !changeInfo.url) return;

  let url;
  try {
    url = new URL(changeInfo.url);
  } catch {
    return;
  }

  for (const engine of SEARCH_ENGINES) {
    if (engine.match(url)) {
      const query = engine.getQuery(url);
      if (query && POSTCODE_RE.test(query.trim())) {
        const encoded = encodeURIComponent(query.trim().toUpperCase());
        chrome.tabs.update(tabId, { url: MAPS_BASE + encoded });
      }
      break;
    }
  }
});
