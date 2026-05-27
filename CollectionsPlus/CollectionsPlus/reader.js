// reader.js — Collections+ reader view
// Runs as an extension page (chrome-extension:// URL) so has full chrome API access.

(async function () {
  'use strict';

  const loadingEl  = document.getElementById('loading');
  const readerEl   = document.getElementById('reader');

  function showError(msg) {
    loadingEl.textContent = msg;
  }

  // ── 1. Parse item ID from URL ───────────────────────────────
  const params = new URLSearchParams(location.search);
  const itemId = parseInt(params.get('id'), 10);

  if (!itemId || isNaN(itemId)) {
    showError('No item specified. Please reopen from Collections+.');
    return;
  }

  // ── 2. Load item data from session storage ──────────────────
  let item;
  try {
    const stored = await chrome.storage.session.get(`reader_${itemId}`);
    item = stored[`reader_${itemId}`];
  } catch (err) {
    showError('Could not access storage: ' + err.message);
    return;
  }

  if (!item) {
    showError('Item data not found. Please close this tab and reopen the reader from Collections+.');
    return;
  }

  // ── 3. Render ───────────────────────────────────────────────
  document.title = (item.title || 'Saved Page') + ' — Collections+';
  loadingEl.style.display = 'none';
  readerEl.style.display  = '';

  // Title
  document.getElementById('item-title').textContent = item.title || 'Saved Page';

  // Meta line
  let host = '';
  try { host = new URL(item.url || '').hostname; } catch {}
  const dateStr = item.created_at
    ? new Date(item.created_at * 1000).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
      })
    : '';
  const metaParts = [host, dateStr ? 'Saved ' + dateStr : ''].filter(Boolean).join(' · ');
  document.getElementById('item-meta').textContent = metaParts;

  // Open original link
  const openBtn = document.getElementById('btn-open-original');
  openBtn.href = item.url || '#';
  if (!item.url) openBtn.style.display = 'none';

  // Notes
  if (item.notes) {
    const notesEl     = document.getElementById('item-notes');
    const notesTextEl = document.getElementById('item-notes-text');
    notesTextEl.textContent = item.notes;
    notesEl.style.display   = '';
  }

  // Content
  const contentEl = document.getElementById('item-content');
  if (item.content) {
    contentEl.innerHTML = item.content;
  } else {
    contentEl.innerHTML =
      '<p class="no-content">No content saved with this item. ' +
      'Open the item in Collections+ and click <strong>📄 Capture Content</strong> to save a readable copy.</p>';
  }

  // ── Attribution line ────────────────────────────────────────
  // Shown between the toolbar and the article title.
  // Format: "Captured with Collections+ · Richard Smith · 1 May 2026 / 19:01"
  // Name is omitted if no profile is set.
  const profile    = item.profile || {};
  const authorName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const attrEl     = document.getElementById('item-attribution');

  if (item.created_at || authorName) {
    const parts = ['Captured with Collections+'];
    if (authorName) parts.push(`by ${authorName}`);
    if (item.created_at) {
      const d = new Date(item.created_at * 1000);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      parts.push(`${dateStr} / ${timeStr}`);
    }
    attrEl.textContent = parts.join(' · ');
  } else {
    attrEl.style.display = 'none';
  }

  // ── Export meta tags ────────────────────────────────────────
  // Injected into <head> so they appear in exported HTML files.
  const metaDefs = [
    { name: 'generator', content: 'Collections+' }
  ];
  if (authorName)      metaDefs.push({ name: 'author',  content: authorName });
  if (profile.email)   metaDefs.push({ name: 'contact', content: profile.email });
  if (item.created_at) {
    metaDefs.push({
      name: 'date',
      content: new Date(item.created_at * 1000).toISOString()
    });
  }
  if (item.url) metaDefs.push({ name: 'source', content: item.url });

  metaDefs.forEach(({ name, content }) => {
    const el = document.createElement('meta');
    el.name    = name;
    el.content = content;
    document.head.appendChild(el);
  });

  // ── 4. Delete content button ────────────────────────────────
  const deleteBtn = document.getElementById('btn-delete-content');
  if (item.content) {
    const sizeKB = Math.round(item.content.length / 1024);
    const sizeMB = (item.content.length / 1024 / 1024).toFixed(1);
    const sizeStr = sizeKB >= 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
    deleteBtn.textContent = `🗑 Delete content (${sizeStr})`;

    deleteBtn.addEventListener('click', async () => {
      const confirmed = confirm(
        `Delete the saved content (${sizeStr}) for this item?\n\n` +
        'The bookmark, thumbnail and notes will be kept.\n\n' +
        'The deletion will apply the next time Collections+ is opened.'
      );
      if (!confirmed) return;

      try {
        await chrome.storage.local.set({ pendingContentDeletion: item.id });
        deleteBtn.textContent = '✓ Content queued for deletion — reopen Collections+ to apply';
        deleteBtn.disabled    = true;
        deleteBtn.classList.remove('btn-danger');
        deleteBtn.classList.add('btn-ghost');
      } catch (err) {
        alert('Could not queue deletion: ' + err.message);
      }
    });
  } else {
    deleteBtn.style.display = 'none';
  }

  // ── 5. Export HTML button ───────────────────────────────────
  document.getElementById('btn-export').addEventListener('click', () => {
    const html     = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    const blob     = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url      = URL.createObjectURL(blob);
    const filename = (item.title || 'saved-page')
      .replace(/[^a-z0-9_\-\s]/gi, '_')
      .replace(/\s+/g, '-')
      .substring(0, 60) + '.html';

    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

}());
