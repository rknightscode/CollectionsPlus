'use strict';

// ---------------------------------------------------------------------------
// RailroadRenderer  —  converts a regex AST to a railroad-diagram SVG
// ---------------------------------------------------------------------------
window.RailroadRenderer = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────
  const C = {
    BOX_H:     32,    // height of each terminal box
    BOX_R:      6,    // corner radius of terminal boxes
    PAD_X:     13,    // horizontal padding inside a terminal box
    MIN_BOX_W: 72,    // minimum terminal box width
    SEQ_GAP:   18,    // gap between sequential items
    ALT_GAP:   12,    // vertical gap between alternation rows
    BRANCH_W:  28,    // width of the alternation branch arms
    GRP_PAD_X: 20,    // horizontal padding inside a group border
    GRP_PAD_T: 22,    // top padding inside a group border (label area)
    GRP_PAD_B: 10,    // bottom padding inside a group border
    GRP_R:      8,    // group border corner radius
    QUANT_GAP:  4,    // gap between box bottom and quantifier label
    QUANT_H:   16,    // height reserved for quantifier label
    RAIL_PAD:  36,    // outer padding around the whole diagram
    FONT_SZ:   12,    // main box label font size (px)
    LABEL_SZ:  10,    // smaller label font size (px)
    CHR_W:      7.2,  // approx character width at FONT_SZ
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const r = n => Math.round(n * 10) / 10;

  function tw(str, sz = C.FONT_SZ) {
    return str.length * (sz / C.FONT_SZ) * C.CHR_W;
  }
  function boxW(label) {
    return Math.max(tw(String(label)) + C.PAD_X * 2, C.MIN_BOX_W);
  }
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Returns { w, h, railY, ...extra }
  // railY: Y offset from node top where the main rail passes through
  function computeLayout(node) {
    if (!node) return { w: 60, h: C.BOX_H, railY: C.BOX_H / 2 };

    switch (node.type) {
      case 'literal':
      case 'char-class':
      case 'anchor':
      case 'any':
      case 'charset':
      case 'empty': {
        const w = boxW(node.label ?? '?');
        return { w, h: C.BOX_H, railY: C.BOX_H / 2 };
      }

      case 'quantifier': {
        const body = computeLayout(node.body);
        return {
          w: body.w,
          h: body.h + C.QUANT_GAP + C.QUANT_H,
          railY: body.railY,
          body
        };
      }

      case 'group': {
        const body = computeLayout(node.body);
        const w = body.w + C.GRP_PAD_X * 2;
        const h = C.GRP_PAD_T + body.h + C.GRP_PAD_B;
        return { w, h, railY: C.GRP_PAD_T + body.railY, body };
      }

      case 'sequence': {
        const kids = node.items.map(computeLayout);
        const maxRailY = Math.max(...kids.map(k => k.railY));
        const w = kids.reduce((s, k, i) => s + k.w + (i > 0 ? C.SEQ_GAP : 0), 0);
        const h = Math.max(...kids.map(k => (maxRailY - k.railY) + k.h));
        return { w, h, railY: maxRailY, kids };
      }

      case 'alternation': {
        const alts = node.alternatives.map(computeLayout);
        const innerW = Math.max(...alts.map(a => a.w));
        const w = innerW + C.BRANCH_W * 2;
        const h = alts.reduce((s, a, i) => s + a.h + (i > 0 ? C.ALT_GAP : 0), 0);
        return { w, h, railY: alts[0].railY, alts };
      }

      default:
        return { w: 80, h: C.BOX_H, railY: C.BOX_H / 2 };
    }
  }

  // ── SVG generation ─────────────────────────────────────────────────────────
  function generateSVG(ast, containerWidth = 700) {

    const els = [];           // SVG element strings
    const nodeMap = new Map();// nid → AST node
    let nidCounter = 0;

    // ── Primitive emitters ─────────────────────────────────────────────────
    function line(x1, y1, x2, y2, cls = 'rr-rail') {
      if (Math.abs(x2-x1) < 0.5 && Math.abs(y2-y1) < 0.5) return;
      els.push(`<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" class="${cls}"/>`);
    }
    function hline(x1, railY, x2) {
      line(x1, railY, x2, railY);
    }
    function box(x, y, w, h, rx, cls) {
      els.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${rx}" class="${cls}"/>`);
    }
    function txt(x, y, content, cls, anchor = 'middle') {
      els.push(`<text x="${r(x)}" y="${r(y)}" class="${cls}" text-anchor="${anchor}">${esc(content)}</text>`);
    }

    // ── Node renderers ─────────────────────────────────────────────────────
    // Each returns { exitX, exitY } — exit point of the rail leaving this node

    function render(node, lay, x, y) {
      switch (node.type) {
        case 'literal':
        case 'char-class':
        case 'anchor':
        case 'any':
        case 'charset':
        case 'empty':       return renderLeaf(node, lay, x, y);
        case 'quantifier':  return renderQuantifier(node, lay, x, y);
        case 'group':       return renderGroup(node, lay, x, y);
        case 'sequence':    return renderSequence(node, lay, x, y);
        case 'alternation': return renderAlternation(node, lay, x, y);
        default:            return renderLeaf({ label: '?' }, lay, x, y);
      }
    }

    function renderLeaf(node, lay, x, y) {
      const { w, railY } = lay;
      const nid = `n${nidCounter++}`;
      nodeMap.set(nid, node);

      const cy  = y + railY;
      const by  = cy - C.BOX_H / 2;
      const cls = {
        anchor:      'rr-anchor',
        'char-class':'rr-class',
        any:         'rr-any',
        charset:     'rr-charset',
        literal:     'rr-literal',
        empty:       'rr-empty',
      }[node.type] || 'rr-literal';

      // Wrap in a clickable group
      els.push(`<g data-nid="${nid}" class="rr-node">`);
      box(x, by, w, C.BOX_H, C.BOX_R, cls);
      txt(x + w / 2, cy + C.FONT_SZ * 0.38, node.label ?? '?', 'rr-lbl');
      els.push(`</g>`);

      return { exitX: x + w, exitY: cy };
    }

    function renderQuantifier(node, lay, x, y) {
      const { w, railY, body } = lay;
      const railAbsY = y + railY;

      // Render the wrapped body at same x,y (quant layout == body layout except height)
      const conn = render(node.body, body, x, y);

      // Quantifier label below the body
      const { min, max, lazy } = node;
      let range = '';
      if (min === max)            range = `${min === Infinity ? '∞' : min}`;
      else if (max === Infinity)  range = `${min} – ∞`;
      else                        range = `${min} – ${max}`;
      const sym = max === Infinity ? (min === 0 ? '*' : '+') : (min === 0 ? '?' : `{${range}}`);
      const labelStr = `↺  ${range}${lazy ? '  ?' : ''}`;

      const labelY = y + body.h + C.QUANT_GAP + C.QUANT_H * 0.72;
      txt(x + w / 2, labelY, labelStr, 'rr-quant-lbl');

      return { exitX: conn.exitX, exitY: railAbsY };
    }

    function renderGroup(node, lay, x, y) {
      const { w, h, railY, body } = lay;
      const railAbsY = y + railY;

      // Dashed group border
      box(x, y, w, h, C.GRP_R, 'rr-group');

      // Group kind label inside the border, near the top
      const labels = {
        capturing:            node.groupIndex ? `Group #${node.groupIndex}` : 'Group',
        named:                `"${node.name}"`,
        'non-capturing':      'Non-capturing',
        lookahead:            'Lookahead (?=)',
        'negative-lookahead': 'Neg. lookahead (?!)',
        lookbehind:           'Lookbehind (?<=)',
        'negative-lookbehind':'Neg. lookbehind (?<!)',
      };
      txt(x + w / 2, y + C.GRP_PAD_T * 0.62, labels[node.kind] ?? 'Group', 'rr-group-lbl');

      // Render body
      const bodyX = x + C.GRP_PAD_X;
      const bodyY = y + C.GRP_PAD_T;
      const conn  = render(node.body, body, bodyX, bodyY);

      // Rails bridging the group padding (left and right)
      hline(x,         railAbsY, bodyX);
      hline(conn.exitX, railAbsY, x + w);

      return { exitX: x + w, exitY: railAbsY };
    }

    function renderSequence(node, lay, x, y) {
      const { kids, railY } = lay;
      const seqRailAbsY = y + railY;
      let cx = x;
      let firstConn = null, lastConn = null;

      node.items.forEach((item, i) => {
        const kl = kids[i];
        const ky = y + (railY - kl.railY); // shift so rails align

        // Draw connector gap BEFORE rendering item (so box sits on top)
        if (lastConn) {
          hline(lastConn.exitX, seqRailAbsY, cx);
        }

        const conn = render(item, kl, cx, ky);

        if (i === 0) firstConn = conn;
        lastConn = conn;
        cx += kl.w + C.SEQ_GAP;
      });

      return {
        exitX: lastConn?.exitX ?? x,
        exitY: seqRailAbsY
      };
    }

    function renderAlternation(node, lay, x, y) {
      const { alts, w, railY } = lay;
      const branchLX   = x + C.BRANCH_W;
      const branchRX   = x + w - C.BRANCH_W;
      const mainRailY  = y + railY;
      const innerW     = branchRX - branchLX;

      // Cumulative Y positions for each alternative
      const altYStarts = [];
      let curY = y;
      alts.forEach((al, i) => {
        altYStarts.push(curY);
        curY += al.h + (i < alts.length - 1 ? C.ALT_GAP : 0);
      });

      const lastRailY = altYStarts.at(-1) + alts.at(-1).railY;

      // Entry / exit rails to branch bars
      hline(x,        mainRailY, branchLX);
      hline(branchRX, mainRailY, x + w);

      // Vertical branch bars
      if (alts.length > 1) {
        line(branchLX, mainRailY, branchLX, lastRailY);
        line(branchRX, mainRailY, branchRX, lastRailY);
      }

      // Render each alternative row
      alts.forEach((al, i) => {
        const altTop      = altYStarts[i];
        const altRailAbsY = altTop + al.railY;
        const offsetX     = Math.max(0, (innerW - al.w) / 2);
        const altX        = branchLX + offsetX;

        const conn = render(node.alternatives[i], al, altX, altTop);

        // Stubs from branch bars to the alternative
        if (altX > branchLX)        hline(branchLX, altRailAbsY, altX);
        if (conn.exitX < branchRX)  hline(conn.exitX, altRailAbsY, branchRX);
      });

      return { exitX: x + w, exitY: mainRailY };
    }

    // ── Top-level ──────────────────────────────────────────────────────────
    if (!ast) {
      return {
        svg: `<svg viewBox="0 0 ${containerWidth} 80" width="${containerWidth}" height="80" xmlns="http://www.w3.org/2000/svg">
          ${svgStyles()}
          <text x="${containerWidth/2}" y="44" class="rr-placeholder" text-anchor="middle">Enter a regex above to visualise it</text>
        </svg>`,
        nodeMap
      };
    }

    const lay  = computeLayout(ast);
    const PAD  = C.RAIL_PAD;
    const svgW = Math.max(lay.w + PAD * 2 + 40, containerWidth);
    const svgH = lay.h + PAD * 2 + 10;

    // Position root
    const nodeX    = PAD + 20;
    const nodeY    = PAD;
    const conn     = render(ast, lay, nodeX, nodeY);
    const railAbsY = nodeY + lay.railY;

    // Entry / exit rail arms
    hline(PAD, railAbsY, nodeX);
    hline(conn.exitX, railAbsY, svgW - PAD);

    // Entry / exit caps
    els.push(`<circle cx="${r(PAD)}" cy="${r(railAbsY)}" r="4" class="rr-cap-start"/>`);
    els.push(`<circle cx="${r(svgW - PAD)}" cy="${r(railAbsY)}" r="4" class="rr-cap-end"/>`);

    const svg = `<svg viewBox="0 0 ${r(svgW)} ${r(svgH)}" width="${r(svgW)}" height="${r(svgH)}" xmlns="http://www.w3.org/2000/svg" class="rr-diagram">
  ${svgStyles()}
  ${els.join('\n  ')}
</svg>`;

    return { svg, nodeMap };
  }

  // ── Embedded styles ────────────────────────────────────────────────────────
  function svgStyles() {
    return `<style>
  .rr-diagram { font-family: 'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace; }

  .rr-rail    { stroke:#3d5070; stroke-width:1.5; fill:none; }
  .rr-cap-start { fill:#00d4b8; }
  .rr-cap-end   { fill:#3d5070; }

  /* Terminal boxes */
  .rr-literal  { fill:#16213a; stroke:#2e4c84; stroke-width:1.5; }
  .rr-class    { fill:#0e2218; stroke:#1f6040; stroke-width:1.5; }
  .rr-anchor   { fill:#1e1020; stroke:#5a2880; stroke-width:1.5; }
  .rr-any      { fill:#1a1a2c; stroke:#3a3a80; stroke-width:1.5; }
  .rr-charset  { fill:#201a0e; stroke:#7a5020; stroke-width:1.5; }
  .rr-empty    { fill:#1a1a1a; stroke:#404040; stroke-width:1;   stroke-dasharray:3,2; }

  /* Group border */
  .rr-group { fill:none; stroke:#3a4e6e; stroke-width:1.2; stroke-dasharray:6,3; }

  /* Labels */
  .rr-lbl        { fill:#c8d4ea; font-size:12px; pointer-events:none; }
  .rr-group-lbl  { fill:#6e88b0; font-size:10px; pointer-events:none; }
  .rr-quant-lbl  { fill:#00d4b8; font-size:10px; }
  .rr-placeholder{ fill:#484e58; font-size:13px; font-family:monospace; }

  /* Clickable nodes */
  .rr-node { cursor:pointer; }
  .rr-node:hover > rect { stroke:#00d4b8; stroke-width:2; }
  .rr-node.selected > rect { stroke:#00d4b8; stroke-width:2.5; }
</style>`;
  }

  return { generateSVG };
})();
