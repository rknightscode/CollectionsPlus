// popup.js — Collections+ main controller
import { CollectionsDB } from './db.js';

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
const db = new CollectionsDB();
let activeCollectionId   = null;
let activeItemId         = null;
let pendingDeleteType    = null;
let pendingDeleteId      = null;
let reorderMode          = false;
let colReorderMode       = false;
let collectionsFilter    = '';
let itemsFilter          = '';

// TODO 2 — content capture toggle
let saveContentEnabled   = true;

// TODO 3 — history suggestions
let suggestionsItems     = [];
let suggestionsRange     = 1;   // days; 0 = all available

// ─────────────────────────────────────────────────────────────
// View router
// ─────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────
async function init() {
  showView('view-loading');

  let result;
  try {
    result = await db.init();
  } catch (err) {
    showError('Failed to initialise database: ' + err.message);
    return;
  }

  if (result.status === 'setup_required') {
    showView('view-setup');
    checkVersionBanner();
  } else if (result.status === 'permission_required') {
    showView('view-unlock');
    checkVersionBanner();
  } else {
    await renderCollections();
    showView('view-collections');
    await processPendingSaves(); // TODO 1 — process any right-click queued saves
  }
}

document.getElementById('btn-unlock').addEventListener('click', async () => {
  const btn = document.getElementById('btn-unlock');
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  try {
    const granted = await db.requestPermissionAndLoad();
    if (granted) {
      await renderCollections();
      showView('view-collections');
      await processPendingSaves();
    } else {
      btn.disabled = false;
      btn.textContent = 'Unlock Collections';
      showError('Permission denied — please try again.');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Unlock Collections';
    showError('Permission error: ' + err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Setup view
// ─────────────────────────────────────────────────────────────
document.getElementById('btn-choose-folder').addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await db.setupWithDirectory(dirHandle);
    await renderCollections();
    showView('view-collections');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showError('Could not set up storage: ' + err.message);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// SVG icon constants
// ─────────────────────────────────────────────────────────────
const ICON_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>`;
const ICON_DRAG  = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"/></svg>`;
const ICON_OPEN  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v.64c.57.265.94.876.856 1.546l-.64 5.124A2.5 2.5 0 0 1 12.733 15H3.266a2.5 2.5 0 0 1-2.481-2.19l-.64-5.124A1.5 1.5 0 0 1 1 6.14zM2 6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5a.5.5 0 0 0-.5.5zm-.367 1a.5.5 0 0 0-.496.562l.64 5.124A1.5 1.5 0 0 0 3.266 14h9.468a1.5 1.5 0 0 0 1.489-1.314l.64-5.124A.5.5 0 0 0 14.367 7z"/></svg>`;

// TODO 2 — book icon for reader view button
const ICON_READ  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/></svg>`;

// Bootstrap Icons bi-person — used in the settings button and view header
const ICON_PERSON = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="currentColor" viewBox="0 0 16 16"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.029 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>`;

// ─────────────────────────────────────────────────────────────
// TODO 1 — Context menu: sync collections cache + process queue
// ─────────────────────────────────────────────────────────────

/**
 * Writes the current collection list to chrome.storage.local so that
 * background.js can rebuild the right-click context menu submenus.
 * Fire-and-forget — never await this in render hot paths.
 */
function syncCollectionsCache() {
  try {
    const cols = db.getCollections().map(c => ({ id: c.id, name: c.name, colour: c.colour }));
    chrome.storage.local.set({ collectionsCache: cols });
  } catch { /* non-fatal */ }
}

/**
 * Updates the content-size / db-size indicator in the collections header.
 * Content size is synchronous (from SQLite); db file size is async (from disk).
 * Fire-and-forget.
 */
async function updateDbSizeInfo() {
  const el = document.getElementById('db-size-info');
  if (!el || !db.db) return;
  try {
    const fmt = b => {
      if (b === null || b === undefined) return '?';
      if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
      return (b / 1024 / 1024).toFixed(1) + ' MB';
    };
    const contentBytes = db.getContentSize();
    el.textContent     = fmt(contentBytes) + ' / …';   // show content size immediately
    const dbBytes      = await db.getDbFileSize();
    el.textContent     = fmt(contentBytes) + ' / ' + fmt(dbBytes);
  } catch { el.textContent = ''; }
}

/**
 * Processes any saves queued by the background context menu handler.
 * Called once after the DB is ready and collections view is shown.
 */
async function processPendingSaves() {
  // ── Process content deletion requested from the reader page ──
  // The reader page (an extension page) can't write to the DB directly,
  // so it queues a deletion here and the popup processes it on next open.
  try {
    const stored = await chrome.storage.local.get('pendingContentDeletion');
    if (stored.pendingContentDeletion) {
      const itemId = stored.pendingContentDeletion;
      await chrome.storage.local.remove('pendingContentDeletion');
      db.db.run("UPDATE items SET content='' WHERE id=?", [itemId]);
      await db.save();
      updateDbSizeInfo();
      if (activeCollectionId) await renderItems();
      showToast('Saved content deleted.');
    }
  } catch { /* non-fatal */ }

  // ── Process queued right-click saves ─────────────────────────
  try {
    const stored2 = await chrome.storage.local.get('pendingSaves');
    const queue   = stored2.pendingSaves;
    if (!Array.isArray(queue) || queue.length === 0) return;

    await chrome.storage.local.remove('pendingSaves');

    let saved  = 0;
    let failed = 0;

    for (const pending of queue) {
      try {
        // Guard: collection may have been deleted since the save was queued
        const col = db.getCollection(pending.collectionId);
        if (!col) { failed++; continue; }

        // Resize the screenshot captured by the background worker at click time.
        // For image/link saves or restricted pages this will be null.
        let thumbnail = null;
        if (pending.screenshot) {
          try { thumbnail = await resizeThumbnail(pending.screenshot, 320, 200); } catch { thumbnail = null; }
        }

        db.addItem(pending.collectionId, {
          type:      pending.type  || 'page',
          url:       pending.url   || '',
          title:     pending.title || '',
          content:   '',
          notes:     '',
          thumbnail
        });
        saved++;
      } catch { failed++; }
    }

    if (saved > 0) {
      await db.save();
      syncCollectionsCache();
      await renderCollections();
      showToast(`${saved} item${saved !== 1 ? 's' : ''} saved from right-click menu.`);
    }
    if (failed > 0) {
      showToast(`${failed} right-click save${failed !== 1 ? 's' : ''} could not be completed — collection may have been deleted.`, true);
    }
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────
// Collections list view
// ─────────────────────────────────────────────────────────────

async function renderCollections() {
  let collections = db.getCollections();
  const list = document.getElementById('collections-list');

  const q = collectionsFilter.trim().toLowerCase();
  if (q) collections = collections.filter(c => c.name.toLowerCase().includes(q));
  document.getElementById('collections-search-clear').style.display = q ? 'flex' : 'none';

  // Sync reorder button state
  const reorderColBtn = document.getElementById('btn-reorder-collections');
  reorderColBtn.textContent = colReorderMode ? '✓ Done' : '⇅ Reorder';
  reorderColBtn.classList.toggle('btn-primary', colReorderMode);
  reorderColBtn.classList.toggle('btn-ghost',  !colReorderMode);

  if (collections.length === 0) {
    list.innerHTML = q
      ? `<div class="empty-state"><div class="empty-icon">🔍</div><p>No collections match "<strong>${esc(q)}</strong>".</p></div>`
      : `<div class="empty-state"><div class="empty-icon">📁</div><p>No collections yet.<br>Create one to get started.</p></div>`;
    syncCollectionsCache(); // keep context menus accurate (will clear them if empty)
    return;
  }

  list.innerHTML = collections.map((c, idx) => `
    <div class="collection-row${colReorderMode ? ' col-reorder-mode' : ''}"
         data-id="${c.id}"
         ${colReorderMode ? 'draggable="true"' : ''}>
      <span class="col-dot col-dot-action" data-id="${c.id}" style="background:${c.colour}" title="Open all in new tabs"></span>
      <div class="col-info">
        <span class="col-name">${esc(c.name)} <span class="col-count-inline">(${c.item_count})</span></span>
        ${c.description ? `<span class="col-desc">${esc(c.description)}</span>` : ''}
      </div>
      ${colReorderMode ? `
        <div class="col-order-btns">
          <span class="drag-handle" title="Drag to reorder">${ICON_DRAG}</span>
          <button class="order-btn col-move-up"   data-id="${c.id}" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="order-btn col-move-down" data-id="${c.id}" ${idx === collections.length - 1 ? 'disabled' : ''}>▼</button>
        </div>` : ''}
      <button class="icon-btn col-edit"   data-id="${c.id}" title="Edit">✏️</button>
      <button class="icon-btn col-delete btn-delete-red" data-id="${c.id}" title="Delete">${ICON_TRASH}</button>
      ${colReorderMode ? '' : '<span class="col-arrow">›</span>'}
    </div>
  `).join('');

  if (colReorderMode) initCollectionDrag(list);

  // TODO 1 — keep context menus in sync with collection names
  syncCollectionsCache();
  // Update content/db size display in header (fire and forget)
  updateDbSizeInfo();
}

document.getElementById('collections-list').addEventListener('click', async (e) => {
  const dotBtn    = e.target.closest('.col-dot-action');
  const upBtn     = e.target.closest('.col-move-up');
  const downBtn   = e.target.closest('.col-move-down');
  const editBtn   = e.target.closest('.col-edit');
  const deleteBtn = e.target.closest('.col-delete');
  const row       = e.target.closest('.collection-row');

  if (dotBtn) {
    e.stopPropagation();
    const id    = parseInt(dotBtn.dataset.id);
    const items = db.getItems(id).filter(i => i.url);
    if (!items.length) { showToast('No pages in this collection.'); return; }
    for (const item of items) chrome.tabs.create({ url: item.url, active: false });
    return;
  }
  if (upBtn)     { e.stopPropagation(); db.moveCollectionUp(parseInt(upBtn.dataset.id));     await db.save(); await renderCollections(); return; }
  if (downBtn)   { e.stopPropagation(); db.moveCollectionDown(parseInt(downBtn.dataset.id)); await db.save(); await renderCollections(); return; }
  if (editBtn)   { e.stopPropagation(); openCollectionModal(parseInt(editBtn.dataset.id));   return; }
  if (deleteBtn) { e.stopPropagation(); openConfirm('Delete this collection and all its saved pages?', 'collection', parseInt(deleteBtn.dataset.id)); return; }
  if (row && !colReorderMode) { await openCollection(parseInt(row.dataset.id)); }
});

document.getElementById('btn-new-collection').addEventListener('click', () => {
  openCollectionModal(null);
});

document.getElementById('btn-reorder-collections').addEventListener('click', async () => {
  colReorderMode = !colReorderMode;
  await renderCollections();
});

// Collections search filter
document.getElementById('collections-search').addEventListener('input', async (e) => {
  collectionsFilter = e.target.value;
  await renderCollections();
});
document.getElementById('collections-search-clear').addEventListener('click', async () => {
  collectionsFilter = '';
  document.getElementById('collections-search').value = '';
  await renderCollections();
});
document.getElementById('collections-search-clear').style.display = 'none';

// ─────────────────────────────────────────────────────────────
// Drag and drop — collections
// ─────────────────────────────────────────────────────────────

function initCollectionDrag(list) {
  let dragSrcId = null;

  list.querySelectorAll('.collection-row[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      dragSrcId = parseInt(row.dataset.id);
      e.dataTransfer.setData('text/plain', String(dragSrcId));
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => row.classList.add('dragging'));
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.collection-row').forEach(r => r.classList.remove('drag-over'));
      dragSrcId = null;
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (parseInt(row.dataset.id) !== dragSrcId) {
        list.querySelectorAll('.collection-row').forEach(r => r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      }
    });

    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drag-over');
      }
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over');
      const targetId = parseInt(row.dataset.id);
      if (!dragSrcId || dragSrcId === targetId) return;
      db.swapCollectionOrder(dragSrcId, targetId);
      dragSrcId = null;
      await db.save();
      await renderCollections();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Settings / Backup modal
// ─────────────────────────────────────────────────────────────

async function openSettingsModal() {
  const modal = document.getElementById('modal-settings');
  modal.classList.add('open');
  await refreshBackupStatus();
}

async function refreshBackupStatus() {
  const info        = await db.getBackupInfo();
  const locationEl  = document.getElementById('backup-location-status');
  const tsEl        = document.getElementById('backup-last-ts');
  const backupBtn   = document.getElementById('btn-backup-now');
  const restoreBtn  = document.getElementById('btn-restore-now');

  if (info.hasHandle) {
    locationEl.textContent  = 'OneDrive folder set ✓';
    locationEl.className    = 'backup-status-value status-ok';
    tsEl.textContent        = info.lastBackupTs
      ? formatDateTime(info.lastBackupTs)
      : 'Never';
    backupBtn.disabled  = false;
    restoreBtn.disabled = false;
  } else {
    locationEl.textContent = 'Not set';
    locationEl.className   = 'backup-status-value';
    tsEl.textContent       = '—';
    backupBtn.disabled  = true;
    restoreBtn.disabled = true;
  }

  renderLogs();
}

function renderLogs() {
  const logs     = db.getLogs().slice(0, 3);
  const listEl   = document.getElementById('log-list');
  const countEl  = document.getElementById('log-count');

  countEl.textContent = logs.length ? 'last 3 entries' : '';

  if (logs.length === 0) {
    listEl.innerHTML = `<div class="log-empty">No activity yet</div>`;
    return;
  }

  const ACTION_LABELS = {
    backup:            'Backup',
    restore:           'Restore',
    backup_folder_set: 'Backup folder set',
    import_edge:       'Edge import',
    paste_import:      'Paste import',
    history_import:    'History import',
  };

  listEl.innerHTML = logs.map(log => {
    const label   = ACTION_LABELS[log.action] || log.action;
    const success = log.success === 1 || log.success === true;
    const dt      = formatDateTime(log.created_at * 1000);
    const detail  = log.detail ? `<span class="log-detail">${esc(log.detail)}</span>` : '';
    return `
      <div class="log-row ${success ? 'log-ok' : 'log-fail'}">
        <span class="log-indicator">${success ? '✓' : '✗'}</span>
        <div class="log-body">
          <span class="log-action">${label}</span>
          ${detail}
        </div>
        <span class="log-time">${dt}</span>
      </div>`;
  }).join('');
}

document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

document.getElementById('modal-settings-close').addEventListener('click', () => {
  document.getElementById('modal-settings').classList.remove('open');
});

document.getElementById('modal-settings').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-settings')) {
    document.getElementById('modal-settings').classList.remove('open');
  }
});

document.getElementById('btn-choose-backup-folder').addEventListener('click', async () => {
  const btn = document.getElementById('btn-choose-backup-folder');
  btn.disabled = true;
  btn.textContent = 'Choosing…';
  try {
    await db.setupBackupFolder();
    await refreshBackupStatus();
    showToast('Backup location set and first backup complete.');
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Error: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Choose backup folder…';
  }
});

document.getElementById('btn-backup-now').addEventListener('click', async () => {
  const btn = document.getElementById('btn-backup-now');
  btn.disabled = true;
  btn.textContent = '↑ Backing up…';
  try {
    await db.backup();
    await refreshBackupStatus();
    showToast('Backup complete.');
  } catch (err) {
    showToast('Backup failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '↑ Backup to OneDrive';
  }
});

document.getElementById('btn-restore-now').addEventListener('click', async () => {
  const btn = document.getElementById('btn-restore-now');
  btn.disabled = true;
  try {
    const info = await db.getRestoreInfo();
    const modified = new Date(info.lastModified);
    document.getElementById('restore-confirm-meta').textContent =
      `Backup dated: ${formatDateTime(modified.getTime())} · ${(info.size / 1024 / 1024).toFixed(1)} MB`;
    document.getElementById('modal-restore-confirm').classList.add('open');
  } catch (err) {
    showToast('Could not read backup: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('restore-cancel').addEventListener('click', () => {
  document.getElementById('modal-restore-confirm').classList.remove('open');
});

document.getElementById('restore-ok').addEventListener('click', async () => {
  document.getElementById('modal-restore-confirm').classList.remove('open');
  document.getElementById('modal-settings').classList.remove('open');
  showView('view-loading');
  document.getElementById('loading-message').textContent = 'Restoring…';
  try {
    await db.restore();
    await renderCollections();
    syncCollectionsCache(); // TODO 1 — rebuild context menus after restore
    showView('view-collections');
    showToast('Restore complete. Collections reloaded.');
  } catch (err) {
    showError('Restore failed: ' + err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Import from Edge Collections
// ─────────────────────────────────────────────────────────────

let pendingImportBuffer = null;

document.getElementById('btn-import-edge').addEventListener('click', () => {
  document.getElementById('edge-import-file-input').click();
});

document.getElementById('edge-import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const btn = document.getElementById('btn-import-edge');
  btn.disabled = true;
  btn.textContent = '↓ Reading file…';

  try {
    const buffer  = await file.arrayBuffer();
    const preview = await db.importFromEdgePreview(buffer);
    pendingImportBuffer = preview.buffer;

    document.getElementById('import-preview-message').textContent =
      `Found ${preview.collectionCount} collection${preview.collectionCount !== 1 ? 's' : ''} and ${preview.itemCount} saved page${preview.itemCount !== 1 ? 's' : ''}.`;
    document.getElementById('import-preview-meta').textContent =
      'Collections with the same name as existing ones will be merged. Duplicate URLs within a collection will be skipped.';

    document.getElementById('modal-import-preview').classList.add('open');
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Import error: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '↓ Import from Edge Collections…';
  }
});

document.getElementById('import-cancel').addEventListener('click', () => {
  document.getElementById('modal-import-preview').classList.remove('open');
  pendingImportBuffer = null;
});

document.getElementById('import-ok').addEventListener('click', async () => {
  document.getElementById('modal-import-preview').classList.remove('open');
  document.getElementById('modal-settings').classList.remove('open');

  showView('view-loading');
  document.getElementById('loading-message').textContent = 'Importing…';

  try {
    const result = await db.importFromEdgeConfirm(pendingImportBuffer);
    pendingImportBuffer = null;
    await renderCollections();
    syncCollectionsCache(); // TODO 1 — new collections may have been created
    showView('view-collections');
    showToast(`Import complete: ${result.collectionsImported} collections, ${result.itemsImported} pages added${result.skipped ? `, ${result.skipped} duplicates skipped` : ''}.`);
  } catch (err) {
    pendingImportBuffer = null;
    showError('Import failed: ' + err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Collection modal (create / edit)
// ─────────────────────────────────────────────────────────────
const COLOURS = ['#e8963c','#4ea8de','#6bcb77','#d64f4f','#b07cff','#f7c59f','#5bc0eb','#e0ca3c'];

function openCollectionModal(id) {
  const modal     = document.getElementById('modal-collection');
  const titleEl   = document.getElementById('modal-col-title');
  const nameInput = document.getElementById('modal-col-name');
  const descInput = document.getElementById('modal-col-desc');
  const swatches  = document.getElementById('modal-col-colours');
  const saveBtn   = document.getElementById('modal-col-save');

  let selectedColour = COLOURS[0];

  swatches.innerHTML = COLOURS.map(c =>
    `<button class="swatch" data-colour="${c}" style="background:${c}" title="${c}"></button>`
  ).join('');

  swatches.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    selectedColour = btn.dataset.colour;
    swatches.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
  });

  if (id) {
    const col = db.getCollection(id);
    titleEl.textContent   = 'Edit Collection';
    nameInput.value       = col.name;
    descInput.value       = col.description;
    selectedColour        = col.colour;
    saveBtn.dataset.editId = id;
  } else {
    titleEl.textContent   = 'New Collection';
    nameInput.value       = '';
    descInput.value       = '';
    selectedColour        = COLOURS[0];
    delete saveBtn.dataset.editId;
  }

  swatches.querySelectorAll('.swatch').forEach(s => {
    if (s.dataset.colour === selectedColour) s.classList.add('active');
  });

  modal.classList.add('open');
  nameInput.focus();

  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.classList.add('error'); return; }
    nameInput.classList.remove('error');

    if (saveBtn.dataset.editId) {
      db.updateCollection(parseInt(saveBtn.dataset.editId), name, descInput.value.trim(), selectedColour);
    } else {
      db.createCollection(name, descInput.value.trim(), selectedColour);
    }
    await db.save();
    modal.classList.remove('open');
    await renderCollections(); // syncCollectionsCache called inside renderCollections
    if (activeCollectionId && saveBtn.dataset.editId) {
      updateCollectionHeader();
    }
  };
}

document.getElementById('modal-col-cancel').addEventListener('click', () => {
  document.getElementById('modal-collection').classList.remove('open');
});

document.getElementById('modal-collection').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-collection')) {
    document.getElementById('modal-collection').classList.remove('open');
  }
});

// ─────────────────────────────────────────────────────────────
// Collection view
// ─────────────────────────────────────────────────────────────
async function openCollection(id) {
  activeCollectionId = id;
  reorderMode    = false;
  colReorderMode = false;
  updateCollectionHeader();
  await renderItems();
  history.pushState({ view: 'collection', id }, '');
  showView('view-collection');
}

function updateCollectionHeader() {
  const col = db.getCollection(activeCollectionId);
  if (!col) return;
  document.getElementById('col-view-name').textContent     = col.name;
  document.getElementById('col-view-dot').style.background = col.colour;
}

async function renderItems() {
  let items  = db.getItems(activeCollectionId);
  const list = document.getElementById('items-list');

  const q = itemsFilter.trim().toLowerCase();
  if (q) items = items.filter(i =>
    (i.title || '').toLowerCase().includes(q) ||
    (i.url   || '').toLowerCase().includes(q) ||
    (i.notes || '').toLowerCase().includes(q)
  );
  document.getElementById('items-search-clear').style.display = q ? 'flex' : 'none';

  const reorderBtn = document.getElementById('btn-reorder');
  reorderBtn.textContent = reorderMode ? '✓ Done' : '⇅ Reorder';
  reorderBtn.classList.toggle('btn-primary', reorderMode);
  reorderBtn.classList.toggle('btn-ghost',  !reorderMode);

  if (items.length === 0) {
    list.innerHTML = q
      ? `<div class="empty-state"><div class="empty-icon">🔍</div><p>No items match "<strong>${esc(q)}</strong>".</p></div>`
      : `<div class="empty-state"><div class="empty-icon">🔖</div><p>No pages saved yet.<br>Browse to a page and click<br><strong>Add Current Page</strong>.</p></div>`;
    return;
  }

  list.innerHTML = items.map((item, idx) => {
    const thumb = item.thumbnail
      ? `<img class="item-thumb item-thumb-clickable" data-id="${item.id}" data-url="${esc(item.url)}" src="${item.thumbnail}" alt="" title="Open page">`
      : `<div class="item-thumb item-thumb-empty item-thumb-clickable" data-id="${item.id}" data-url="${esc(item.url)}" title="Open page"></div>`;

    const typeIcon = { page: '🌐', image: '🖼', snippet: '📋', note: '📝' }[item.type] || '🌐';
    const dateStr  = item.created_at ? formatDate(item.created_at) : '';
    const visited  = item.last_visited_at ? ` · visited ${formatDate(item.last_visited_at)}` : '';

    // TODO 2 — reader button shown only when content is saved
    const readBtn  = item.content
      ? `<button class="icon-btn item-read btn-read-accent" data-id="${item.id}" title="Open reader view">${ICON_READ}</button>`
      : '';

    const actions = reorderMode
      ? `<div class="item-actions">
           <button class="order-btn item-move-up"   data-id="${item.id}" title="Move up"   ${idx === 0 ? 'disabled' : ''}>▲</button>
           <button class="order-btn item-move-down" data-id="${item.id}" title="Move down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
         </div>`
      : `<div class="item-actions">
           <button class="icon-btn item-open btn-open-green" data-id="${item.id}" data-url="${esc(item.url)}" title="Open">${ICON_OPEN}</button>
           ${readBtn}
           <button class="icon-btn item-capture" data-id="${item.id}" data-url="${esc(item.url)}" title="Refresh screenshot">📷</button>
           <button class="icon-btn item-edit"    data-id="${item.id}" title="Edit / Notes">✏️</button>
           <button class="icon-btn item-delete btn-delete-red"  data-id="${item.id}" title="Delete">${ICON_TRASH}</button>
         </div>`;

    return `
      <div class="item-row ${reorderMode ? 'reorder-mode' : ''}" data-id="${item.id}">
        ${thumb}
        <div class="item-info">
          <div class="item-title">${esc(item.title || item.url || 'Untitled')}</div>
          <div class="item-url">${esc(truncateUrl(item.url || ''))}</div>
          ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ''}
          <div class="item-meta">${typeIcon} ${dateStr}${visited}${item.content ? ' · 📄' : ''}</div>
        </div>
        ${actions}
      </div>`;
  }).join('');
}

document.getElementById('items-list').addEventListener('click', async (e) => {
  const upBtn      = e.target.closest('.item-move-up');
  const downBtn    = e.target.closest('.item-move-down');
  const thumbBtn   = e.target.closest('.item-thumb-clickable');
  const openBtn    = e.target.closest('.item-open');
  const readBtn    = e.target.closest('.item-read');    // TODO 2
  const captureBtn = e.target.closest('.item-capture');
  const editBtn    = e.target.closest('.item-edit');
  const deleteBtn  = e.target.closest('.item-delete');

  if (upBtn)   { db.moveItemUp(parseInt(upBtn.dataset.id));     await db.save(); await renderItems(); return; }
  if (downBtn) { db.moveItemDown(parseInt(downBtn.dataset.id)); await db.save(); await renderItems(); return; }

  if (thumbBtn || openBtn) {
    const btn = thumbBtn || openBtn;
    const url = btn.dataset.url;
    const id  = parseInt(btn.dataset.id);
    if (url) {
      await db.markVisited(id);
      await db.save();
      chrome.tabs.create({ url });
    }
    return;
  }

  // TODO 2 — open reader view
  if (readBtn) {
    const item = db.getItem(parseInt(readBtn.dataset.id));
    if (item) openReaderView(item);
    return;
  }

  if (captureBtn) {
    await captureScreenshotForItem(parseInt(captureBtn.dataset.id), captureBtn.dataset.url);
    return;
  }

  if (editBtn)   { openItemModal(parseInt(editBtn.dataset.id)); return; }
  if (deleteBtn) { openConfirm('Remove this item from the collection?', 'item', parseInt(deleteBtn.dataset.id)); }
});

// Items search filter
document.getElementById('items-search').addEventListener('input', async (e) => {
  itemsFilter = e.target.value;
  await renderItems();
});
document.getElementById('items-search-clear').addEventListener('click', async () => {
  itemsFilter = '';
  document.getElementById('items-search').value = '';
  await renderItems();
});
document.getElementById('items-search-clear').style.display = 'none';

document.getElementById('btn-reorder').addEventListener('click', async () => {
  reorderMode = !reorderMode;
  await renderItems();
});

// ─────────────────────────────────────────────────────────────
// Export collection to JSON
// ─────────────────────────────────────────────────────────────

document.getElementById('btn-export-col').addEventListener('click', () => {
  const col   = db.getCollection(activeCollectionId);
  const items = db.getItems(activeCollectionId).map(item => ({
    type:           item.type,
    url:            item.url,
    title:          item.title,
    content:        item.content,
    notes:          item.notes,
    sort_order:     item.sort_order,
    created_at:     item.created_at,
    last_visited_at: item.last_visited_at
    // thumbnail intentionally excluded
  }));

  const payload = {
    export_version:  1,
    exported_at:     new Date().toISOString(),
    collection: {
      name:        col.name,
      description: col.description,
      colour:      col.colour,
      created_at:  col.created_at
    },
    items
  };

  const json     = JSON.stringify(payload, null, 2);
  const blob     = new Blob([json], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const filename = col.name.replace(/[^a-z0-9_\-]/gi, '_') + '_export.json';

  const a  = document.createElement('a');
  a.href   = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${items.length} item${items.length !== 1 ? 's' : ''} to ${filename}`);
});

// ─────────────────────────────────────────────────────────────
// Version check banner
// ─────────────────────────────────────────────────────────────

async function checkVersionBanner() {
  const manifest = chrome.runtime.getManifest();
  const current  = manifest.version;

  const vEl = document.getElementById('current-version');
  if (vEl) vEl.textContent = `Version ${current}`;
  const vEl2 = document.getElementById('setup-version');
  if (vEl2) vEl2.textContent = `Version ${current}`;

  const stored = await chrome.storage.local.get(['latestVersion', 'latestVersionUrl']);
  const latest = stored.latestVersion;
  const url    = stored.latestVersionUrl;

  if (!latest || !url) return;
  if (!isNewerVersion(latest, current)) return;

  const banner   = document.getElementById('update-banner');
  const textEl   = document.getElementById('update-banner-text');
  const linkEl   = document.getElementById('update-banner-link');

  if (!banner) return;
  textEl.textContent = `Update available — Collections+ v${latest}  `;
  linkEl.href        = url;
  banner.style.display = 'flex';
}

function isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

// ─────────────────────────────────────────────────────────────
// Paste Import (from Edge Collections clipboard copy)
// ─────────────────────────────────────────────────────────────

let parsedPasteItems = [];

document.getElementById('btn-paste-import').addEventListener('click', () => {
  const col = db.getCollection(activeCollectionId);
  document.getElementById('paste-collection-name').textContent = col?.name ?? '';
  document.getElementById('paste-input').value = '';
  document.getElementById('paste-preview').innerHTML = '';
  document.getElementById('paste-ok').disabled = true;
  parsedPasteItems = [];
  document.getElementById('modal-paste-import').classList.add('open');
  document.getElementById('paste-input').focus();

  document.getElementById('paste-input').oninput = () => {
    parsedPasteItems = parseClipboardItems(document.getElementById('paste-input').value);
    renderPastePreview(parsedPasteItems);
  };
});

document.getElementById('paste-parse').addEventListener('click', () => {
  parsedPasteItems = parseClipboardItems(document.getElementById('paste-input').value);
  renderPastePreview(parsedPasteItems);
});

document.getElementById('paste-cancel').addEventListener('click', () => {
  document.getElementById('modal-paste-import').classList.remove('open');
  parsedPasteItems = [];
});

document.getElementById('modal-paste-import').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-paste-import')) {
    document.getElementById('modal-paste-import').classList.remove('open');
    parsedPasteItems = [];
  }
});

document.getElementById('paste-ok').addEventListener('click', async () => {
  if (!parsedPasteItems.length) return;
  document.getElementById('modal-paste-import').classList.remove('open');

  let imported = 0;
  let skipped  = 0;

  for (const item of parsedPasteItems) {
    if (item.url) {
      const dup = db.db.exec(
        `SELECT id FROM items WHERE collection_id=? AND url=? LIMIT 1`,
        [activeCollectionId, item.url]
      );
      if (dup[0]?.values[0]) { skipped++; continue; }
    }
    db.addItem(activeCollectionId, {
      type:  'page',
      url:   item.url,
      title: item.title,
      notes: '',
      content: ''
    });
    imported++;
  }

  db.addLog('paste_import', true, `${imported} items imported, ${skipped} duplicates skipped`);
  await db.save();
  await renderItems();
  showToast(`Imported ${imported} item${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped` : ''}.`);
  parsedPasteItems = [];
});

function parseClipboardItems(text) {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items  = [];
  let current  = null;

  const isUrl       = s => /^https?:\/\//i.test(s);
  const isMarkdown  = s => /^\[.+\]\(https?:\/\/.+\)$/.test(s);
  const isPrice     = s => /^[£$€¥₹][\d,.]+/.test(s) || /^[\d,.]+\s?[£$€¥₹]/.test(s);

  for (const line of lines) {
    if (isMarkdown(line) || isPrice(line)) continue;

    if (isUrl(line)) {
      if (current) {
        current.url = line;
        items.push(current);
        current = null;
      } else {
        try {
          const domain = new URL(line).hostname.replace(/^www\./, '');
          items.push({ title: domain, url: line });
        } catch {
          items.push({ title: line, url: line });
        }
      }
    } else {
      if (current) items.push(current);
      current = { title: line, url: '' };
    }
  }

  if (current) items.push(current);
  return items;
}

function renderPastePreview(items) {
  const el  = document.getElementById('paste-preview');
  const btn = document.getElementById('paste-ok');

  if (!items.length) {
    el.innerHTML = `<p class="paste-none">No items found. Make sure you've pasted the copied collection content.</p>`;
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
  el.innerHTML = `
    <div class="paste-count">${items.length} item${items.length !== 1 ? 's' : ''} found</div>
    <div class="paste-item-list">
      ${items.map(item => `
        <div class="paste-item">
          <div class="paste-item-title">${esc(item.title || '(no title)')}</div>
          <div class="paste-item-url">${esc(truncateUrl(item.url || '(no URL)'))}</div>
        </div>`).join('')}
    </div>`;
}

document.getElementById('btn-back').addEventListener('click', async () => {
  itemsFilter = '';
  document.getElementById('items-search').value = '';
  await renderCollections();
  showView('view-collections');
});

// Mouse back/forward button support — fires when the user presses the
// browser back button (including mouse side buttons) inside the sidebar.
window.addEventListener('popstate', async () => {
  // Dismiss any open modal first so navigation doesn't leave one stranded
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));

  const current = document.querySelector('.view.active')?.id;

  if (current === 'view-collection') {
    itemsFilter = '';
    document.getElementById('items-search').value = '';
    await renderCollections();
    showView('view-collections');
  } else if (current === 'view-suggestions') {
    await renderCollections();
    showView('view-collections');
  }
  // All other views (loading, unlock, setup) have no meaningful back destination
});

// ─────────────────────────────────────────────────────────────
// Screenshot capture
// ─────────────────────────────────────────────────────────────

async function captureScreenshotForItem(itemId, itemUrl) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (itemUrl && tab.url !== itemUrl) {
      const confirmed = confirm(
        `Current page is:\n${tab.url}\n\nThis item is for:\n${itemUrl}\n\nCapture screenshot from current page anyway?`
      );
      if (!confirmed) return;
    }

    const raw = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 65 });
    const thumbnail = await resizeThumbnail(raw, 320, 200);

    db.db.run('UPDATE items SET thumbnail=? WHERE id=?', [thumbnail, itemId]);
    await db.save();
    await renderItems();
    showToast('Screenshot updated.');
  } catch (err) {
    showToast('Screenshot failed: ' + err.message, true);
  }
}

document.getElementById('modal-item-capture').addEventListener('click', async () => {
  const btn = document.getElementById('modal-item-capture');
  btn.disabled = true;
  btn.textContent = '📷 Capturing…';
  try {
    const item = db.getItem(activeItemId);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (item?.url && tab.url !== item.url) {
      const confirmed = confirm(
        `Current page is:\n${tab.url}\n\nThis item is for:\n${item.url}\n\nCapture from current page anyway?`
      );
      if (!confirmed) return;
    }

    const raw = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 65 });
    const thumbnail = await resizeThumbnail(raw, 320, 200);

    db.db.run('UPDATE items SET thumbnail=? WHERE id=?', [thumbnail, activeItemId]);
    await db.save();

    const thumbEl = document.getElementById('modal-item-thumb');
    thumbEl.innerHTML = `<img src="${thumbnail}" alt="thumbnail">`;
    showToast('Screenshot updated.');
  } catch (err) {
    showToast('Screenshot failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 Refresh Screenshot';
  }
});

// ─────────────────────────────────────────────────────────────
// TODO 2 — Capture content for an existing item (modal button)
// ─────────────────────────────────────────────────────────────
// Allows users to add reader-view content to items that were saved
// before content capture was enabled, or that need a refresh.

document.getElementById('modal-item-capture-content').addEventListener('click', async () => {
  const btn = document.getElementById('modal-item-capture-content');
  btn.disabled = true;
  btn.textContent = '📄 Capturing…';
  try {
    const item  = db.getItem(activeItemId);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (item?.url && tab.url !== item.url) {
      const confirmed = confirm(
        `Current page is:\n${tab.url}\n\nThis item is for:\n${item.url}\n\nCapture content from current page anyway?`
      );
      if (!confirmed) return;
    }

    const content = await capturePageContent(tab.id);
    if (content) {
      db.db.run('UPDATE items SET content=? WHERE id=?', [content, activeItemId]);
      await db.save();
      // Refresh the content status line in the modal without closing it
      const contentEl = document.getElementById('modal-item-content');
      if (contentEl) {
        contentEl.textContent = `Content saved (${Math.round(content.length / 1024)} KB) — reader view available`;
        contentEl.className   = 'item-content-meta has-content';
      }
      await renderItems(); // update reader button visibility in the list behind the modal
      showToast('Content captured — reader view now available.');
    } else {
      showToast('Content capture failed. Navigate to the page first, then try again.', true);
    }
  } catch (err) {
    showToast('Content capture failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 Capture Content';
  }
});

// Delete content for an item directly from the edit modal
document.getElementById('modal-item-delete-content').addEventListener('click', async () => {
  const item = db.getItem(activeItemId);
  if (!item?.content) return;

  const sizeKB  = Math.round(item.content.length / 1024);
  const sizeStr = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

  const confirmed = confirm(
    `Delete the saved content (${sizeStr}) for this item?\n\n` +
    'The bookmark, thumbnail and notes will be kept.'
  );
  if (!confirmed) return;

  db.db.run("UPDATE items SET content='' WHERE id=?", [activeItemId]);
  await db.save();

  // Refresh modal UI
  const contentEl   = document.getElementById('modal-item-content');
  const deleteBtn   = document.getElementById('modal-item-delete-content');
  if (contentEl) {
    contentEl.textContent = 'No content saved — add this page with Content: On to enable reader view';
    contentEl.className   = 'item-content-meta';
  }
  if (deleteBtn) deleteBtn.style.display = 'none';

  updateDbSizeInfo();
  await renderItems();
  showToast(`Content deleted (${sizeStr} freed).`);
});

// ─────────────────────────────────────────────────────────────
// Add current page (modified for TODO 2 content capture)
// ─────────────────────────────────────────────────────────────

document.getElementById('btn-add-page').addEventListener('click', async () => {
  const btn = document.getElementById('btn-add-page');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let thumbnail = null;

    try {
      const raw = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 65 });
      thumbnail  = await resizeThumbnail(raw, 320, 200);
    } catch { thumbnail = null; }

    // addItem returns the new row's id — needed for content update below
    const newId = db.addItem(activeCollectionId, {
      type:  'page',
      url:   tab.url,
      title: tab.title,
      thumbnail
    });

    // TODO 2 — optionally capture page content for reader view
    if (saveContentEnabled) {
      btn.textContent = 'Capturing content…';
      const content = await capturePageContent(tab.id);
      if (content) {
        db.db.run('UPDATE items SET content=? WHERE id=?', [content, newId]);
      }
    }

    await db.save();
    await renderItems();
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Add Current Page';
  }
});

document.getElementById('btn-open-all').addEventListener('click', async () => {
  const items = db.getItems(activeCollectionId).filter(i => i.url);
  if (!items.length) { showToast('No pages to open.'); return; }

  const col = db.getCollection(activeCollectionId);

  const tabIds = [];
  for (const item of items) {
    await db.markVisited(item.id);
    const tab = await chrome.tabs.create({ url: item.url, active: false });
    tabIds.push(tab.id);
  }
  await db.save();

  try {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: col?.name ?? 'Collection',
      color: hexToTabGroupColour(col?.colour)
    });
  } catch (_) {
    // tabGroups API not available in this context — tabs still open fine
  }

  await renderItems();
});

document.getElementById('btn-open-all-inprivate').addEventListener('click', async () => {
  const items = db.getItems(activeCollectionId).filter(i => i.url);
  if (!items.length) { showToast('No pages to open.'); return; }

  try {
    const urls = items.map(i => i.url);
    await chrome.windows.create({ incognito: true, url: urls });
    // Mark all items visited (best-effort — non-fatal if save fails)
    for (const item of items) await db.markVisited(item.id);
    await db.save();
    await renderItems();
  } catch (err) {
    if (err.message?.toLowerCase().includes('incognito')) {
      showToast(
        'InPrivate not available — enable Collections+ in InPrivate via edge://extensions.',
        true
      );
    } else {
      showToast('Could not open InPrivate window: ' + err.message, true);
    }
  }
});

function hexToTabGroupColour(hex) {
  const map = {
    '#e8963c': 'orange',
    '#4ea8de': 'blue',
    '#6bcb77': 'green',
    '#d64f4f': 'red',
    '#b07cff': 'purple',
    '#f7c59f': 'orange',
    '#5bc0eb': 'cyan',
    '#e0ca3c': 'yellow',
  };
  return map[hex] ?? 'grey';
}

// ─────────────────────────────────────────────────────────────
// TODO 2 — Content toggle button
// ─────────────────────────────────────────────────────────────

document.getElementById('btn-toggle-content').addEventListener('click', () => {
  saveContentEnabled = !saveContentEnabled;
  const btn = document.getElementById('btn-toggle-content');
  btn.textContent = `📄 Content: ${saveContentEnabled ? 'On' : 'Off'}`;
  btn.classList.toggle('btn-primary', saveContentEnabled);
  btn.classList.toggle('btn-ghost',  !saveContentEnabled);
});

// ─────────────────────────────────────────────────────────────
// TODO 2 — Page content capture via scripting API
// ─────────────────────────────────────────────────────────────

/**
 * Injects a self-contained function into the active tab to extract
 * the main article/body HTML. Strips scripts, iframes, and noise
 * selectors before returning. Caps output at 500 KB.
 * Returns null on any failure (restricted page, permission denied, etc.)
 */
async function capturePageContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      // IMPORTANT: this function runs in the PAGE context — no outer scope access
      func: function extractReadableContent() {
        var STRIP_TAGS = ['script','iframe','frame','object','embed','form',
                          'input','select','textarea','style','noscript',
                          'svg','canvas','video','audio','button'];
        var NOISE_SEL  = [
          '[class*="ad-"],[class*="advertisement"],[data-ad],[id*="advert"]',
          '[class*="cookie"],[class*="consent"],[class*="gdpr"]',
          '[class*="banner"],[class*="popup"],[class*="overlay"]',
          '[class*="subscribe"],[class*="newsletter"]',
          'nav','footer','header','aside'
        ].join(',');

        var src = document.querySelector('article')
               || document.querySelector('[role="main"]')
               || document.querySelector('main')
               || document.body;

        var clone = src.cloneNode(true);

        STRIP_TAGS.forEach(function(tag) {
          clone.querySelectorAll(tag).forEach(function(el) { el.remove(); });
        });

        try {
          clone.querySelectorAll(NOISE_SEL).forEach(function(el) { el.remove(); });
        } catch (_) {}

        var html = clone.innerHTML.trim();
        return html.length > 500000 ? html.substring(0, 500000) : html;
      }
    });
    return results?.[0]?.result ?? null;
  } catch {
    return null; // page may be restricted (chrome://, edge://, etc.)
  }
}

// ─────────────────────────────────────────────────────────────
// TODO 2 — Reader view
// ─────────────────────────────────────────────────────────────

/**
 * Stores the item in session storage then opens the dedicated reader extension
 * page. The extension page has chrome API access (needed for export + delete).
 */
async function openReaderView(item) {
  const profile = db.getProfile();
  await chrome.storage.session.set({
    [`reader_${item.id}`]: {
      id:         item.id,
      title:      item.title      || '',
      url:        item.url        || '',
      notes:      item.notes      || '',
      content:    item.content    || '',
      created_at: item.created_at || null,
      profile:    {                         // for attribution line and export meta
        firstName: profile.firstName,
        lastName:  profile.lastName,
        email:     profile.email
      }
    }
  });
  chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?id=${item.id}`) });
}

// ─────────────────────────────────────────────────────────────
// Item edit modal
// ─────────────────────────────────────────────────────────────
function openItemModal(id) {
  const item    = db.getItem(id);
  if (!item) return;
  activeItemId  = id;

  const modal       = document.getElementById('modal-item');
  const thumbEl     = document.getElementById('modal-item-thumb');
  const titleInput  = document.getElementById('modal-item-title');
  const urlInput    = document.getElementById('modal-item-url');
  const notesInput  = document.getElementById('modal-item-notes');
  const dateEl      = document.getElementById('modal-item-date');
  const contentEl   = document.getElementById('modal-item-content');

  if (item.thumbnail) {
    thumbEl.innerHTML = `<img src="${item.thumbnail}" alt="thumbnail">`;
  } else {
    thumbEl.innerHTML = `<div class="thumb-placeholder">No screenshot</div>`;
  }

  titleInput.value  = item.title    || '';
  urlInput.value    = item.url      || '';
  notesInput.value  = item.notes    || '';
  dateEl.textContent = item.created_at
    ? 'Saved ' + formatDate(item.created_at)
    : '';

  // TODO 2 — show content status in modal
  if (contentEl) {
    contentEl.textContent = item.content
      ? `Content saved (${Math.round(item.content.length / 1024)} KB) — reader view available`
      : 'No content saved — add this page with Content: On to enable reader view';
    contentEl.className = item.content ? 'item-content-meta has-content' : 'item-content-meta';
  }

  // Show delete-content button with size if content exists
  const deleteContentBtn = document.getElementById('modal-item-delete-content');
  if (deleteContentBtn) {
    if (item.content) {
      const sizeKB  = Math.round(item.content.length / 1024);
      const sizeStr = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
      deleteContentBtn.textContent = `🗑 Delete Content (${sizeStr})`;
      deleteContentBtn.style.display = '';
    } else {
      deleteContentBtn.style.display = 'none';
    }
  }

  modal.classList.add('open');
  notesInput.focus();
}

document.getElementById('modal-item-save').addEventListener('click', async () => {
  const titleInput = document.getElementById('modal-item-title');
  const urlInput   = document.getElementById('modal-item-url');
  const notesInput = document.getElementById('modal-item-notes');
  const item       = db.getItem(activeItemId);

  db.updateItem(activeItemId, {
    title:   titleInput.value.trim(),
    url:     urlInput.value.trim(),
    notes:   notesInput.value.trim(),
    content: item.content || ''
  });
  await db.save();
  document.getElementById('modal-item').classList.remove('open');
  await renderItems();
});

document.getElementById('modal-item-cancel').addEventListener('click', () => {
  document.getElementById('modal-item').classList.remove('open');
});

document.getElementById('modal-item').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-item')) {
    document.getElementById('modal-item').classList.remove('open');
  }
});

// ─────────────────────────────────────────────────────────────
// Confirm / delete modal
// ─────────────────────────────────────────────────────────────
function openConfirm(message, type, id) {
  pendingDeleteType = type;
  pendingDeleteId   = id;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('modal-confirm').classList.add('open');
}

document.getElementById('confirm-ok').addEventListener('click', async () => {
  document.getElementById('modal-confirm').classList.remove('open');

  if (pendingDeleteType === 'collection') {
    db.deleteCollection(pendingDeleteId);
    await db.save();
    syncCollectionsCache(); // TODO 1 — removed collection must be purged from menus
    await renderCollections();
    showView('view-collections');
  } else if (pendingDeleteType === 'item') {
    db.deleteItem(pendingDeleteId);
    await db.save();
    await renderItems();
  }

  pendingDeleteType = null;
  pendingDeleteId   = null;
});

document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('modal-confirm').classList.remove('open');
  pendingDeleteType = null;
  pendingDeleteId   = null;
});

// ─────────────────────────────────────────────────────────────
// Settings view (profile, device info, about)
// ─────────────────────────────────────────────────────────────

document.getElementById('btn-open-settings').addEventListener('click', openSettingsView);

document.getElementById('btn-settings-back').addEventListener('click', async () => {
  await renderCollections();
  showView('view-collections');
});

function openSettingsView() {
  const profile = db.getProfile();

  document.getElementById('settings-firstname').value       = profile.firstName;
  document.getElementById('settings-lastname').value        = profile.lastName;
  document.getElementById('settings-email').value           = profile.email;
  document.getElementById('settings-profile-status').textContent = '';
  document.getElementById('settings-profile-status').className   = 'settings-status';

  // Device info
  document.getElementById('settings-device-id').textContent =
    profile.deviceId || '—';
  document.getElementById('settings-db-created').textContent =
    profile.dbCreatedAt
      ? new Date(parseInt(profile.dbCreatedAt) * 1000)
          .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '—';

  // Version
  const manifest = chrome.runtime.getManifest();
  document.getElementById('settings-version').textContent =
    `Collections+ v${manifest.version}`;

  showView('view-settings');
}

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const firstName = document.getElementById('settings-firstname').value.trim();
  const lastName  = document.getElementById('settings-lastname').value.trim();
  const email     = document.getElementById('settings-email').value.trim();

  db.setProfile({ firstName, lastName, email });
  await db.save();

  const statusEl = document.getElementById('settings-profile-status');
  statusEl.textContent = '✓ Profile saved';
  statusEl.className   = 'settings-status settings-status-ok';
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className   = 'settings-status';
  }, 3000);
});

document.getElementById('btn-copy-device-id').addEventListener('click', () => {
  const id  = document.getElementById('settings-device-id').textContent;
  const btn = document.getElementById('btn-copy-device-id');
  if (!id || id === '—') return;
  navigator.clipboard.writeText(id).then(() => {
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }).catch(() => {
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
});

// ─────────────────────────────────────────────────────────────
// TODO 3 — History Suggestions
// ─────────────────────────────────────────────────────────────

document.getElementById('btn-suggestions').addEventListener('click', async () => {
  if (!db.db) { showToast('Database not loaded yet.'); return; }
  const cols = db.getCollections();
  if (!cols.length) { showToast('Create a collection first.'); return; }
  await openSuggestions();
});

document.getElementById('btn-suggestions-back').addEventListener('click', async () => {
  await renderCollections();
  showView('view-collections');
});

async function openSuggestions() {
  suggestionsRange = 1;
  history.pushState({ view: 'suggestions' }, '');
  populateSuggestionsPicker();
  await loadSuggestions();
  showView('view-suggestions');
}

/** Populates the collection drop-down, preserving selection if possible. */
function populateSuggestionsPicker() {
  const picker     = document.getElementById('suggestions-collection-picker');
  const prevVal    = picker.value;
  const collections = db.getCollections();
  picker.innerHTML = collections
    .map(c => `<option value="${c.id}"${String(c.id) === prevVal ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('');
}

/** Fetches history for the current range and renders the suggestion rows. */
async function loadSuggestions() {
  const list    = document.getElementById('suggestions-list');
  const countEl = document.getElementById('suggestions-count');
  const addBtn  = document.getElementById('btn-suggestions-add');

  // Update range button states
  document.querySelectorAll('.range-btn').forEach(btn => {
    const days     = parseInt(btn.dataset.days);
    const isActive = days === suggestionsRange;
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-ghost',  !isActive);
  });

  // Show spinner while fetching
  list.innerHTML = `<div class="empty-state"><div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto"></div></div>`;
  addBtn.disabled    = true;
  addBtn.textContent = 'Add Selected';

  const query = suggestionsRange > 0
    ? { text: '', startTime: Date.now() - (suggestionsRange * 86400000), maxResults: 500 }
    : { text: '', maxResults: 500 };

  let histItems = [];
  try {
    histItems = await chrome.history.search(query);
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>Could not load history: ${esc(err.message)}</p></div>`;
    return;
  }

  // Filter: http(s) URLs only; deduplicate by URL within results
  const seen = new Set();
  suggestionsItems = histItems.filter(h => {
    if (!h.url || !h.url.startsWith('http')) return false;
    if (seen.has(h.url)) return false;
    seen.add(h.url);
    return true;
  });

  countEl.textContent = suggestionsItems.length ? `${suggestionsItems.length} pages` : '';

  if (!suggestionsItems.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🕐</div><p>No browsing history in this time range.</p></div>`;
    return;
  }

  list.innerHTML = suggestionsItems.map((h, idx) => {
    let host = '';
    try { host = new URL(h.url).hostname.replace(/^www\./, ''); } catch {}
    const dateStr  = h.lastVisitTime ? formatDate(Math.round(h.lastVisitTime / 1000)) : '';
    const visits   = h.visitCount || 1;
    const meta     = [visits > 1 ? `${visits} visits` : '', dateStr].filter(Boolean).join(' · ');
    return `
      <label class="suggestion-row">
        <input type="checkbox" class="suggestion-check" data-idx="${idx}">
        <div class="suggestion-info">
          <div class="suggestion-title">${esc(h.title || h.url || 'Untitled')}</div>
          <div class="suggestion-url">${esc(host || h.url.substring(0, 60))}</div>
          ${meta ? `<div class="suggestion-meta">${esc(meta)}</div>` : ''}
        </div>
      </label>`;
  }).join('');
}

function updateSuggestionsAddBtn() {
  const checked = document.querySelectorAll('#suggestions-list .suggestion-check:checked').length;
  const btn     = document.getElementById('btn-suggestions-add');
  btn.disabled     = checked === 0;
  btn.textContent  = checked > 0 ? `Add ${checked} Selected` : 'Add Selected';
}

// Range button clicks
document.getElementById('suggestions-controls').addEventListener('click', async (e) => {
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  suggestionsRange = parseInt(btn.dataset.days);
  await loadSuggestions();
});

// Checkbox changes → update Add button label
document.getElementById('suggestions-list').addEventListener('change', updateSuggestionsAddBtn);

// Select / Deselect All
document.getElementById('btn-suggestions-select-all').addEventListener('click', () => {
  document.querySelectorAll('#suggestions-list .suggestion-check').forEach(cb => { cb.checked = true; });
  updateSuggestionsAddBtn();
});
document.getElementById('btn-suggestions-deselect-all').addEventListener('click', () => {
  document.querySelectorAll('#suggestions-list .suggestion-check').forEach(cb => { cb.checked = false; });
  updateSuggestionsAddBtn();
});

// Add Selected
document.getElementById('btn-suggestions-add').addEventListener('click', async () => {
  const picker = document.getElementById('suggestions-collection-picker');
  const collId = parseInt(picker.value);
  if (!collId) { showToast('Please select a collection.'); return; }

  const checked = [...document.querySelectorAll('#suggestions-list .suggestion-check:checked')];
  if (!checked.length) return;

  let added   = 0;
  let skipped = 0;

  for (const cb of checked) {
    const idx  = parseInt(cb.dataset.idx);
    const hist = suggestionsItems[idx];
    if (!hist?.url) continue;

    // Skip duplicates already in this collection
    const dup = db.db.exec(
      'SELECT id FROM items WHERE collection_id=? AND url=? LIMIT 1',
      [collId, hist.url]
    );
    if (dup[0]?.values[0]) { skipped++; continue; }

    db.addItem(collId, {
      type:      'page',
      url:       hist.url,
      title:     hist.title || hist.url,
      content:   '',
      notes:     '',
      thumbnail: null
    });
    added++;
  }

  if (added > 0) {
    db.addLog('history_import', true, `${added} pages added, ${skipped} duplicates skipped`);
    await db.save();
    syncCollectionsCache();
    showToast(`Added ${added} page${added !== 1 ? 's' : ''}${skipped ? `, ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped` : ''}.`);
    // Uncheck processed items and reset button
    checked.forEach(cb => { cb.checked = false; });
    updateSuggestionsAddBtn();
  } else if (skipped > 0) {
    showToast(`All ${skipped} selected page${skipped !== 1 ? 's' : ''} are already in that collection.`);
  }
});

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30
      ? u.pathname.substring(0, 28) + '…'
      : u.pathname;
    return u.hostname + path;
  } catch {
    return url.substring(0, 50);
  }
}

function formatDate(epoch) {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

let toastTimer = null;
function showToast(message, isError = false) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }

  if (isError) {
    toast.innerHTML = `
      <span class="toast-msg">${esc(message)}</span>
      <button class="toast-copy" title="Copy error message">⎘ Copy</button>`;
    toast.querySelector('.toast-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(message).then(() => {
        toast.querySelector('.toast-copy').textContent = '✓ Copied';
      });
    });
  } else {
    toast.textContent = message;
  }

  toast.className   = 'toast' + (isError ? ' toast-error' : '');
  toast.classList.add('toast-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast-visible'), isError ? 8000 : 3000);
}

function resizeThumbnail(dataUrl, maxW, maxH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(maxW / img.width, maxH / img.height);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function showError(msg) {
  document.getElementById('loading-message').textContent = '⚠ ' + msg;
}

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
