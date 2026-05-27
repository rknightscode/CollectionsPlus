'use strict';

// ---------------------------------------------------------------------------
// RegexPlus — side panel application
// ---------------------------------------------------------------------------

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  pattern:    '',
  flags:      '',
  ast:        null,
  errors:     [],
  nodeMap:    new Map(),
  activeTab:  'railroad',
  selectedNid: null,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const patternInput   = $('patternInput');
const flagsInput     = $('flagsInput');
const statusBar      = $('statusBar');
const statusText     = $('statusText');
const railroadViz    = $('railroadViz');
const treeViz        = $('treeViz');
const nodeInfo       = $('nodeInfo');
const nodeInfoType   = $('nodeInfoType');
const nodeInfoBody   = $('nodeInfoBody');
const closeNodeInfo  = $('closeNodeInfo');
const testInput      = $('testInput');
const testStatus     = $('testStatus');
const testOutput     = $('testOutput');
const matchList      = $('matchList');

// ── Utility ────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getVizWidth() {
  return Math.max(railroadViz.clientWidth - 32, 300);
}

// ── Parse & render ─────────────────────────────────────────────────────────
function rebuild() {
  const raw = state.pattern;

  if (!raw.trim()) {
    setStatus('idle', 'Enter a pattern above');
    renderEmptyViz();
    clearTest();
    return;
  }

  // Parse
  let ast = null, errors = [];
  try {
    const result = parseRegex(raw);
    ast    = result.ast;
    errors = result.errors;
  } catch(e) {
    errors = [e.message];
  }

  state.ast    = ast;
  state.errors = errors;

  if (errors.length > 0) {
    setStatus('error', errors[0]);
  } else {
    const flagStr = state.flags ? `  /${state.flags}` : '';
    setStatus('valid', `Valid regex${flagStr}`);
  }

  renderRailroad();
  renderTree();

  if (state.activeTab === 'test') runTest();
}

function setStatus(cls, msg) {
  statusBar.className = `status-bar ${cls}`;
  statusText.textContent = msg;
}

function renderEmptyViz() {
  const w = getVizWidth();
  const empty = `<svg viewBox="0 0 ${w} 80" width="${w}" height="80" xmlns="http://www.w3.org/2000/svg">
    <text x="${w/2}" y="44" fill="#484e58" font-size="13" font-family="monospace" text-anchor="middle">Enter a regex above to visualise it</text>
  </svg>`;
  railroadViz.innerHTML = empty;
  treeViz.innerHTML = empty;
  state.nodeMap = new Map();
}

function renderRailroad() {
  try {
    const { svg, nodeMap } = RailroadRenderer.generateSVG(state.ast, getVizWidth());
    railroadViz.innerHTML  = svg;
    state.nodeMap          = nodeMap;
    // Re-apply selected highlight if any
    if (state.selectedNid) {
      railroadViz.querySelector(`[data-nid="${state.selectedNid}"]`)?.classList.add('selected');
    }
  } catch(e) {
    railroadViz.innerHTML = `<p style="color:var(--error);padding:16px;font-size:12px">${escHtml(e.message)}</p>`;
  }
}

function renderTree() {
  try {
    const svg = TreeRenderer.generateSVG(state.ast, getVizWidth());
    treeViz.innerHTML = svg;
  } catch(e) {
    treeViz.innerHTML = `<p style="color:var(--error);padding:16px;font-size:12px">${escHtml(e.message)}</p>`;
  }
}

// ── Test functionality ─────────────────────────────────────────────────────
function runTest() {
  const testStr = testInput.value;
  if (!testStr || !state.pattern || state.errors.length > 0) {
    testStatus.className = 'test-status';
    testStatus.textContent = state.errors.length > 0 ? 'Fix the regex first' : '—';
    testOutput.textContent = '—';
    matchList.innerHTML = '';
    return;
  }

  let regex;
  try {
    regex = new RegExp(state.pattern, state.flags);
  } catch(e) {
    testStatus.className = 'test-status err';
    testStatus.textContent = e.message;
    testOutput.textContent = '—';
    matchList.innerHTML = '';
    return;
  }

  // Collect matches
  const matches = [];
  if (state.flags.includes('g') || state.flags.includes('y')) {
    regex.lastIndex = 0;
    let m;
    let safetyLimit = 2000;
    while ((m = regex.exec(testStr)) !== null && safetyLimit-- > 0) {
      matches.push(m);
      if (m.index === regex.lastIndex) regex.lastIndex++;
    }
  } else {
    const m = regex.exec(testStr);
    if (m) matches.push(m);
  }

  // Status
  if (matches.length === 0) {
    testStatus.className = 'test-status none';
    testStatus.textContent = 'No matches';
    testOutput.innerHTML = escHtml(testStr) || '—';
    matchList.innerHTML = '';
    return;
  }

  testStatus.className = 'test-status found';
  testStatus.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;

  // Highlighted output
  const colors = ['', 'm1', 'm2'];
  let html = '';
  let last = 0;
  matches.forEach((m, i) => {
    if (m.index < last) return; // overlapping — skip
    html += escHtml(testStr.slice(last, m.index));
    html += `<mark class="${colors[i % 3]}">${escHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
  });
  html += escHtml(testStr.slice(last));
  testOutput.innerHTML = html || '<em style="color:var(--text-dim)">Empty match</em>';

  // Match list
  matchList.innerHTML = matches.slice(0, 20).map((m, i) => {
    const colorCls = colors[i % 3];
    const groupsHtml = m.length > 1
      ? `<div class="match-groups">${m.slice(1).map((g,gi) => `  $${gi+1}: ${g === undefined ? '<em>—</em>' : `<code>${escHtml(g)}</code>`}`).join('  ')}</div>`
      : '';
    const namedHtml = m.groups
      ? Object.entries(m.groups).map(([k,v]) => `<code>${escHtml(k)}</code>: <code>${escHtml(v)}</code>`).join('  ')
      : '';
    return `<div class="match-item ${colorCls}">
      <div class="match-value">${escHtml(m[0] === '' ? '(empty string)' : m[0])}</div>
      <div class="match-meta">index ${m.index} · length ${m[0].length}</div>
      ${groupsHtml}${namedHtml ? `<div class="match-groups">${namedHtml}</div>` : ''}
    </div>`;
  }).join('');

  if (matches.length > 20) {
    matchList.innerHTML += `<div style="color:var(--text-dim);font-size:11px;padding:4px 0">…and ${matches.length - 20} more</div>`;
  }
}

function clearTest() {
  testStatus.className = 'test-status';
  testStatus.textContent = '—';
  testOutput.textContent = '—';
  matchList.innerHTML = '';
}

// ── Node info panel ────────────────────────────────────────────────────────
function showNodeInfo(nid) {
  const node = state.nodeMap.get(nid);
  if (!node) return;

  // Highlight in SVG
  railroadViz.querySelectorAll('.rr-node.selected').forEach(el => el.classList.remove('selected'));
  railroadViz.querySelector(`[data-nid="${nid}"]`)?.classList.add('selected');
  state.selectedNid = nid;

  // Get description
  const desc = describeNode(node);
  nodeInfoType.textContent = desc.title;
  nodeInfoBody.innerHTML   = desc.body ?? '';

  nodeInfo.classList.remove('hidden');
}

function hideNodeInfo() {
  nodeInfo.classList.add('hidden');
  railroadViz.querySelectorAll('.rr-node.selected').forEach(el => el.classList.remove('selected'));
  state.selectedNid = null;
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `panel-${tab}`);
  });
  if (tab === 'test') runTest();
}

// ── Flags ──────────────────────────────────────────────────────────────────
function syncFlagButtons() {
  document.querySelectorAll('.flag-btn').forEach(btn => {
    btn.classList.toggle('active', state.flags.includes(btn.dataset.flag));
  });
}

function toggleFlag(flag) {
  if (state.flags.includes(flag)) {
    state.flags = state.flags.replace(flag, '');
  } else {
    state.flags += flag;
  }
  flagsInput.value = state.flags;
  syncFlagButtons();
  rebuild();
}

// ── Event wiring ───────────────────────────────────────────────────────────
patternInput.addEventListener('input', () => {
  state.pattern = patternInput.value;
  rebuild();
});

flagsInput.addEventListener('input', () => {
  state.flags = flagsInput.value.replace(/[^gimsyud]/g, '');
  flagsInput.value = state.flags;
  syncFlagButtons();
  rebuild();
});

document.querySelectorAll('.flag-btn').forEach(btn => {
  btn.addEventListener('click', () => toggleFlag(btn.dataset.flag));
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

railroadViz.addEventListener('click', e => {
  const g = e.target.closest('[data-nid]');
  if (g) showNodeInfo(g.dataset.nid);
});

closeNodeInfo.addEventListener('click', hideNodeInfo);

testInput.addEventListener('input', () => {
  if (state.activeTab === 'test') runTest();
});

// Also run test whenever the test tab becomes visible
document.querySelector('[data-tab="test"]').addEventListener('click', runTest);

// Window resize → re-render at new width
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.ast) { renderRailroad(); renderTree(); }
  }, 120);
});

// ── Incoming messages (from background / context menu) ────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'ANALYZE_REGEX') return;
  const text = (msg.text ?? '').trim();
  if (!text) return;

  // Detect /pattern/flags wrapper
  const wrapped = text.match(/^\/(.+)\/([gimsuy]*)$/s);
  if (wrapped) {
    state.pattern = wrapped[1];
    state.flags   = wrapped[2];
  } else {
    state.pattern = text;
    state.flags   = '';
  }

  patternInput.value = state.pattern;
  flagsInput.value   = state.flags;
  syncFlagButtons();

  // Switch to railroad tab for new input
  switchTab('railroad');
  rebuild();
});

// ── Init ───────────────────────────────────────────────────────────────────
renderEmptyViz();
