// background.js — Collections+ service worker
// Handles scheduled version checks via chrome.alarms
// and right-click context menus via chrome.contextMenus.

// ─── Version check constants ───────────────────────────────
const GITHUB_REPO   = 'rsk19/CollectionsPlus';
const ALARM_NAME    = 'version-check';
const CHECK_HOURS   = [9, 12, 18, 21];
const STORAGE_KEY_V = 'latestVersion';
const STORAGE_KEY_U = 'latestVersionUrl';
const STORAGE_KEY_T = 'lastVersionCheck';

// ─── Context menu constants ────────────────────────────────
const MENU_ID_PAGE    = 'cplus-save-page';
const MENU_ID_IMAGE   = 'cplus-save-image';
const MENU_ID_LINK    = 'cplus-save-link';
const MENU_PFX_PAGE   = 'cplus-page:';
const MENU_PFX_IMAGE  = 'cplus-image:';
const MENU_PFX_LINK   = 'cplus-link:';
const STORAGE_CACHE   = 'collectionsCache';
const STORAGE_QUEUE   = 'pendingSaves';

// ─── Lifecycle ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  scheduleNextAlarm();
  doVersionCheck();
  rebuildContextMenus();
  // Open the side panel when the toolbar icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(err => console.log('Collections+: sidePanel setPanelBehavior:', err.message));
});

chrome.runtime.onStartup.addListener(() => {
  scheduleNextAlarm();
  rebuildContextMenus();
  // Re-assert panel behaviour on each browser start
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(err => console.log('Collections+: sidePanel setPanelBehavior:', err.message));
});

// Rebuild context menus whenever the collections cache is updated by the popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_CACHE]) {
    rebuildContextMenus(changes[STORAGE_CACHE].newValue ?? []);
  }
});

// ─── Context menus ─────────────────────────────────────────

/**
 * Rebuilds all context menu items from the cached collections list.
 * If collections is not supplied it is read from chrome.storage.local.
 * Safe to call at any time — always removes all existing menus first.
 */
async function rebuildContextMenus(collections) {
  if (collections === undefined) {
    const stored  = await chrome.storage.local.get(STORAGE_CACHE);
    collections   = stored[STORAGE_CACHE] ?? [];
  }

  // Remove all existing menus synchronously before recreating
  await new Promise(resolve => chrome.contextMenus.removeAll(resolve));

  if (!Array.isArray(collections) || collections.length === 0) return;

  const CTX_PAGE  = ['page', 'frame', 'editable', 'selection'];
  const CTX_IMAGE = ['image'];
  const CTX_LINK  = ['link'];

  chrome.contextMenus.create({ id: MENU_ID_PAGE,  title: 'Save page to Collections+',  contexts: CTX_PAGE  });
  chrome.contextMenus.create({ id: MENU_ID_IMAGE, title: 'Save image to Collections+', contexts: CTX_IMAGE });
  chrome.contextMenus.create({ id: MENU_ID_LINK,  title: 'Save link to Collections+',  contexts: CTX_LINK  });

  for (const col of collections) {
    const name = String(col.name || 'Unnamed');
    chrome.contextMenus.create({ id: MENU_PFX_PAGE  + col.id, parentId: MENU_ID_PAGE,  title: name, contexts: CTX_PAGE  });
    chrome.contextMenus.create({ id: MENU_PFX_IMAGE + col.id, parentId: MENU_ID_IMAGE, title: name, contexts: CTX_IMAGE });
    chrome.contextMenus.create({ id: MENU_PFX_LINK  + col.id, parentId: MENU_ID_LINK,  title: name, contexts: CTX_LINK  });
  }
}

/**
 * Queues a save request so the popup can process it on next open.
 * Screenshots are not possible from a service worker context — the
 * popup will save the item with a null thumbnail; user can refresh later.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { menuItemId } = info;

  let type, url, title, collectionId;

  if (menuItemId.startsWith(MENU_PFX_PAGE)) {
    type         = 'page';
    url          = info.pageUrl  || tab?.url   || '';
    title        = tab?.title    || url;
    collectionId = parseInt(menuItemId.slice(MENU_PFX_PAGE.length));

  } else if (menuItemId.startsWith(MENU_PFX_IMAGE)) {
    type         = 'image';
    url          = info.srcUrl   || '';
    title        = _imageTitle(url);
    collectionId = parseInt(menuItemId.slice(MENU_PFX_IMAGE.length));

  } else if (menuItemId.startsWith(MENU_PFX_LINK)) {
    type         = 'page';
    url          = info.linkUrl  || '';
    title        = url;
    collectionId = parseInt(menuItemId.slice(MENU_PFX_LINK.length));

  } else {
    return; // Parent item clicked — no action
  }

  if (!collectionId || isNaN(collectionId)) return;

  // Capture a screenshot while we still have the active tab in view.
  // contextMenus.onClicked is a user gesture that activates activeTab permission,
  // so captureVisibleTab works here for page saves.
  let screenshot = null;
  if (type === 'page' && tab?.windowId !== undefined) {
    try {
      screenshot = await chrome.tabs.captureVisibleTab(
        tab.windowId, { format: 'jpeg', quality: 65 }
      );
    } catch {
      screenshot = null; // restricted pages (edge://, chrome://, etc.) throw here
    }
  }

  const stored  = await chrome.storage.local.get(STORAGE_QUEUE);
  const queue   = Array.isArray(stored[STORAGE_QUEUE]) ? stored[STORAGE_QUEUE] : [];
  queue.push({ type, url, title, collectionId, screenshot, queuedAt: Date.now() });
  await chrome.storage.local.set({ [STORAGE_QUEUE]: queue });
  console.log('Collections+: queued', type, 'save → collection', collectionId,
    url.substring(0, 80), screenshot ? '(screenshot captured)' : '(no screenshot)');
});

function _imageTitle(url) {
  if (!url) return 'Image';
  try {
    const u    = new URL(url);
    const name = u.pathname.split('/').pop();
    return name ? decodeURIComponent(name).substring(0, 120) : u.hostname;
  } catch {
    return url.substring(0, 80);
  }
}

// ─── Version check ─────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    doVersionCheck();
    scheduleNextAlarm();
  }
});

function scheduleNextAlarm() {
  const now  = new Date();
  const next = getNextCheckTime(now);
  chrome.alarms.create(ALARM_NAME, { when: next.getTime() });
}

function getNextCheckTime(from) {
  const d = new Date(from);
  for (const hour of CHECK_HOURS) {
    if (d.getHours() < hour) {
      d.setHours(hour, 0, 0, 0);
      return d;
    }
  }
  d.setDate(d.getDate() + 1);
  d.setHours(CHECK_HOURS[0], 0, 0, 0);
  return d;
}

async function doVersionCheck() {
  try {
    const manifest   = chrome.runtime.getManifest();
    const current    = manifest.version;
    const response   = await fetch(
      'https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest',
      { headers: { 'Accept': 'application/vnd.github+json' } }
    );
    if (!response.ok) return;
    const data       = await response.json();
    const tag        = (data.tag_name || '').replace(/^v/, '');
    const releaseUrl = data.html_url || 'https://github.com/' + GITHUB_REPO + '/releases/latest';
    await chrome.storage.local.set({
      [STORAGE_KEY_T]: Date.now(),
      [STORAGE_KEY_V]: tag,
      [STORAGE_KEY_U]: releaseUrl
    });
    console.log('Collections+ version check: current=' + current + ' latest=' + tag);
  } catch (err) {
    console.log('Collections+ version check failed:', err.message);
  }
}
