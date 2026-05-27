'use strict';

// ---------------------------------------------------------------------------
// TreeRenderer  —  converts a regex AST to a hierarchical tree SVG
// ---------------------------------------------------------------------------
window.TreeRenderer = (() => {

  const BOX_W   = 126;
  const BOX_H   = 38;
  const H_GAP   = 14;   // horizontal gap between sibling nodes
  const V_GAP   = 48;   // vertical gap between parent and children
  const FONT    = 11;
  const SUB     = 9;

  // ── Node metadata ──────────────────────────────────────────────────────────
  function meta(node) {
    switch (node.type) {
      case 'sequence':
        return { top: 'Sequence', sub: `${node.items.length} tokens`, cls: 'tn-seq' };
      case 'alternation':
        return { top: 'Alternation', sub: `${node.alternatives.length} options`, cls: 'tn-alt' };
      case 'group': {
        const k = {
          capturing:            `Group #${node.groupIndex}`,
          named:                `Named "${node.name}"`,
          'non-capturing':      'Non-capturing',
          lookahead:            'Lookahead',
          'negative-lookahead': 'Neg. lookahead',
          lookbehind:           'Lookbehind',
          'negative-lookbehind':'Neg. lookbehind',
        }[node.kind] ?? node.kind;
        return { top: 'Group', sub: k, cls: 'tn-group' };
      }
      case 'quantifier': {
        const { min, max, lazy } = node;
        const range = max === Infinity
          ? (min === 0 ? '0 – ∞' : `${min} – ∞`)
          : (min === max ? `${min}` : `${min} – ${max}`);
        const sym = max === Infinity ? (min === 0 ? '*' : '+') : (min === 0 ? '?' : `{n}`);
        return { top: `Quantifier  ${sym}`, sub: range + (lazy ? ' lazy' : ''), cls: 'tn-quant' };
      }
      case 'literal':
        return { top: 'Literal', sub: node.label ?? '', cls: 'tn-literal' };
      case 'char-class':
        return { top: 'Class', sub: node.label ?? '', cls: 'tn-class' };
      case 'anchor':
        return { top: 'Anchor', sub: node.label ?? '', cls: 'tn-anchor' };
      case 'any':
        return { top: 'Any char', sub: '.', cls: 'tn-any' };
      case 'charset':
        return { top: node.negated ? 'Negated set' : 'Charset', sub: node.label ?? '', cls: 'tn-charset' };
      case 'empty':
        return { top: 'Empty', sub: 'ε', cls: 'tn-empty' };
      default:
        return { top: node.type, sub: '', cls: 'tn-node' };
    }
  }

  function children(node) {
    switch (node.type) {
      case 'sequence':    return node.items;
      case 'alternation': return node.alternatives;
      case 'group':       return [node.body];
      case 'quantifier':  return [node.body];
      default:            return [];
    }
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  function layout(node) {
    const kids = children(node).map(layout);
    if (kids.length === 0) {
      return { node, meta: meta(node), w: BOX_W, h: BOX_H, kids: [] };
    }
    const totalKidsW = kids.reduce((s, k, i) => s + k.w + (i > 0 ? H_GAP : 0), 0);
    const w = Math.max(BOX_W, totalKidsW);
    const h = BOX_H + V_GAP + Math.max(...kids.map(k => k.h));
    return { node, meta: meta(node), w, h, kids };
  }

  // ── SVG generation ─────────────────────────────────────────────────────────
  function generateSVG(ast, containerWidth = 700) {
    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const r = n => Math.round(n * 10) / 10;

    if (!ast) {
      return `<svg viewBox="0 0 ${containerWidth} 80" width="${containerWidth}" height="80" xmlns="http://www.w3.org/2000/svg">
        <text x="${containerWidth/2}" y="44" fill="#484e58" font-size="13" font-family="monospace" text-anchor="middle">Enter a regex above to visualise it</text>
      </svg>`;
    }

    const lay   = layout(ast);
    const PAD   = 20;
    const svgW  = Math.max(lay.w + PAD * 2, containerWidth);
    const svgH  = lay.h + PAD * 2 + 10;
    const els   = [];

    function renderNode(lay, x, y) {
      const { w, h, meta: m, kids } = lay;
      const cx = x + w / 2;
      const bx = cx - BOX_W / 2;

      // Box
      els.push(`<rect x="${r(bx)}" y="${r(y)}" width="${BOX_W}" height="${BOX_H}" rx="6" class="${m.cls}"/>`);

      // Top label
      const subY = m.sub ? y + BOX_H * 0.45 : y + BOX_H * 0.62;
      els.push(`<text x="${r(bx + BOX_W/2)}" y="${r(subY)}" class="tn-top" text-anchor="middle">${esc(m.top)}</text>`);

      // Sub label
      if (m.sub) {
        const sub = m.sub.length > 14 ? m.sub.slice(0, 13) + '…' : m.sub;
        els.push(`<text x="${r(bx + BOX_W/2)}" y="${r(y + BOX_H * 0.85)}" class="tn-sub" text-anchor="middle">${esc(sub)}</text>`);
      }

      // Children
      if (kids.length > 0) {
        const totalKidsW = kids.reduce((s, k, i) => s + k.w + (i > 0 ? H_GAP : 0), 0);
        let kx = x + (w - totalKidsW) / 2;
        const ky = y + BOX_H + V_GAP;

        kids.forEach(kid => {
          const kidCX = kx + kid.w / 2;
          const kidBX = kidCX - BOX_W / 2;
          // Connector
          els.push(`<line x1="${r(cx)}" y1="${r(y + BOX_H)}" x2="${r(kidCX)}" y2="${r(ky)}" class="tn-edge"/>`);
          // Dot at parent bottom
          els.push(`<circle cx="${r(cx)}" cy="${r(y + BOX_H)}" r="3" class="tn-dot"/>`);
          renderNode(kid, kx, ky);
          kx += kid.w + H_GAP;
        });
      }
    }

    renderNode(lay, PAD, PAD);

    return `<svg viewBox="0 0 ${r(svgW)} ${r(svgH)}" width="${r(svgW)}" height="${r(svgH)}" xmlns="http://www.w3.org/2000/svg" class="tn-diagram">
  <style>
    .tn-diagram { font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace; }
    .tn-edge    { stroke:#2e3e5a; stroke-width:1.5; fill:none; }
    .tn-dot     { fill:#2e3e5a; }

    .tn-seq     { fill:#131e38; stroke:#243460; stroke-width:1.5; }
    .tn-alt     { fill:#102018; stroke:#205840; stroke-width:1.5; }
    .tn-group   { fill:#1e1030; stroke:#582880; stroke-width:1.5; }
    .tn-quant   { fill:#1e1e10; stroke:#606018; stroke-width:1.5; }
    .tn-literal { fill:#141e38; stroke:#263a70; stroke-width:1.5; }
    .tn-class   { fill:#0e1e16; stroke:#1a5030; stroke-width:1.5; }
    .tn-anchor  { fill:#1a1020; stroke:#4a1870; stroke-width:1.5; }
    .tn-any     { fill:#141420; stroke:#303060; stroke-width:1.5; }
    .tn-charset { fill:#1e1a10; stroke:#605028; stroke-width:1.5; }
    .tn-empty   { fill:#141414; stroke:#303030; stroke-width:1;   stroke-dasharray:3,2; }
    .tn-node    { fill:#141414; stroke:#303030; stroke-width:1.5; }

    .tn-top  { fill:#bfcce0; font-size:${FONT}px; }
    .tn-sub  { fill:#5e7898; font-size:${SUB}px; }
  </style>
  ${els.join('\n  ')}
</svg>`;
  }

  return { generateSVG };
})();
