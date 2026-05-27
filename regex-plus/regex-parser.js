'use strict';

// ---------------------------------------------------------------------------
// Regex Parser — recursive descent, produces a typed AST
// ---------------------------------------------------------------------------

class RegexParser {
  constructor(pattern) {
    this.src = pattern;
    this.pos = 0;
    this.groupCount = 0;
    this.errors = [];
  }

  parse() {
    const ast = this.parseAlternation();
    if (this.pos < this.src.length) {
      this.errors.push(`Unexpected character '${this.src[this.pos]}' at position ${this.pos}`);
    }
    return { ast, errors: this.errors };
  }

  // a | b | c
  parseAlternation() {
    const alts = [this.parseSequence()];
    while (this.pos < this.src.length && this.src[this.pos] === '|') {
      this.pos++;
      alts.push(this.parseSequence());
    }
    if (alts.length === 1) return alts[0];
    return { type: 'alternation', alternatives: alts };
  }

  // sequence of atoms
  parseSequence() {
    const items = [];
    while (this.pos < this.src.length &&
           this.src[this.pos] !== '|' &&
           this.src[this.pos] !== ')') {
      const atom = this.parseAtom();
      if (atom) items.push(this.wrapQuantifier(atom));
    }
    if (items.length === 0) return { type: 'empty', label: 'ε' };
    if (items.length === 1) return items[0];
    return { type: 'sequence', items };
  }

  parseAtom() {
    const ch = this.src[this.pos];
    if (ch === '(')  return this.parseGroup();
    if (ch === '[')  return this.parseCharset();
    if (ch === '^')  { this.pos++; return { type: 'anchor', kind: 'start',    label: 'Begins with' }; }
    if (ch === '$')  { this.pos++; return { type: 'anchor', kind: 'end',      label: 'Ends with'   }; }
    if (ch === '\\') return this.parseEscape();
    if (ch === '.')  { this.pos++; return { type: 'any', label: 'Any char'  }; }
    this.pos++;
    return { type: 'literal', value: ch, label: `"${ch}"` };
  }

  parseGroup() {
    this.pos++; // skip (
    let kind = 'capturing';
    let name = null;
    let groupIndex = null;

    if (this.src[this.pos] === '?') {
      this.pos++;
      const next = this.src[this.pos];
      if      (next === ':') { this.pos++; kind = 'non-capturing'; }
      else if (next === '=') { this.pos++; kind = 'lookahead'; }
      else if (next === '!') { this.pos++; kind = 'negative-lookahead'; }
      else if (next === '<') {
        this.pos++;
        const peek = this.src[this.pos];
        if      (peek === '=') { this.pos++; kind = 'lookbehind'; }
        else if (peek === '!') { this.pos++; kind = 'negative-lookbehind'; }
        else {
          kind = 'named';
          const start = this.pos;
          while (this.pos < this.src.length && this.src[this.pos] !== '>') this.pos++;
          name = this.src.slice(start, this.pos);
          if (this.src[this.pos] === '>') this.pos++;
          groupIndex = ++this.groupCount;
        }
      }
    } else {
      groupIndex = ++this.groupCount;
    }

    const body = this.parseAlternation();

    if (this.src[this.pos] === ')') this.pos++;
    else this.errors.push('Missing closing parenthesis');

    return { type: 'group', kind, name, groupIndex, body };
  }

  parseCharset() {
    this.pos++; // skip [
    let negated = false;
    if (this.src[this.pos] === '^') { negated = true; this.pos++; }

    const parts = [];
    while (this.pos < this.src.length && this.src[this.pos] !== ']') {
      if (this.src[this.pos] === '\\') {
        this.pos++;
        parts.push(`\\${this.src[this.pos++]}`);
      } else {
        const ch = this.src[this.pos++];
        if (this.src[this.pos] === '-' && this.src[this.pos + 1] !== ']' && this.pos + 1 < this.src.length) {
          this.pos++; // skip -
          const end = this.src[this.pos++];
          parts.push(`${ch}-${end}`);
        } else {
          parts.push(ch);
        }
      }
    }
    if (this.src[this.pos] === ']') this.pos++;
    const inner = parts.join('');
    const label = (negated ? `[^${inner}]` : `[${inner}]`);
    return { type: 'charset', negated, parts, label };
  }

  parseEscape() {
    this.pos++; // skip backslash
    const ch = this.src[this.pos++];

    const classes = {
      d: { type: 'char-class', kind: 'digit',       label: 'Any digit'    },
      D: { type: 'char-class', kind: 'non-digit',   label: 'Non-digit'    },
      w: { type: 'char-class', kind: 'word',        label: 'Any word'     },
      W: { type: 'char-class', kind: 'non-word',    label: 'Non-word'     },
      s: { type: 'char-class', kind: 'space',       label: 'Whitespace'   },
      S: { type: 'char-class', kind: 'non-space',   label: 'Non-space'    },
      b: { type: 'anchor',     kind: 'word-bound',  label: 'Word boundary'},
      B: { type: 'anchor',     kind: 'non-bound',   label: 'Non-boundary' },
      n: { type: 'literal', value: '\n', label: '"\\n"' },
      t: { type: 'literal', value: '\t', label: '"\\t"' },
      r: { type: 'literal', value: '\r', label: '"\\r"' },
      '0': { type: 'literal', value: '\0', label: '"\\0"' },
    };

    if (ch === 'x' && this.pos + 1 < this.src.length) {
      const hex = this.src.slice(this.pos, this.pos + 2); this.pos += 2;
      return { type: 'literal', value: String.fromCharCode(parseInt(hex, 16)), label: `"\\x${hex}"` };
    }
    if (ch === 'u' && this.pos + 3 < this.src.length) {
      const hex = this.src.slice(this.pos, this.pos + 4); this.pos += 4;
      return { type: 'literal', value: String.fromCharCode(parseInt(hex, 16)), label: `"\\u${hex}"` };
    }

    return classes[ch] || { type: 'literal', value: ch, label: `"\\${ch}"` };
  }

  wrapQuantifier(node) {
    if (this.pos >= this.src.length) return node;
    const ch = this.src[this.pos];
    let min, max;

    if      (ch === '*') { this.pos++; min = 0; max = Infinity; }
    else if (ch === '+') { this.pos++; min = 1; max = Infinity; }
    else if (ch === '?') { this.pos++; min = 0; max = 1; }
    else if (ch === '{') {
      const saved = this.pos++;
      const numStart = this.pos;
      while (this.pos < this.src.length && /\d/.test(this.src[this.pos])) this.pos++;
      if (this.pos === numStart) { this.pos = saved; return node; }
      min = parseInt(this.src.slice(numStart, this.pos));
      if (this.src[this.pos] === ',') {
        this.pos++;
        const maxStart = this.pos;
        while (this.pos < this.src.length && /\d/.test(this.src[this.pos])) this.pos++;
        max = (maxStart === this.pos) ? Infinity : parseInt(this.src.slice(maxStart, this.pos));
      } else {
        max = min;
      }
      if (this.src[this.pos] === '}') this.pos++;
      else { this.pos = saved; return node; }
    } else {
      return node;
    }

    const lazy = (this.src[this.pos] === '?') ? (this.pos++, true) : false;
    return { type: 'quantifier', min, max, lazy, body: node };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function parseRegex(raw) {
  // Strip /pattern/flags wrapper if present
  const wrapped = raw.match(/^\/(.+)\/([gimsuy]*)$/s);
  const pattern = wrapped ? wrapped[1] : raw;
  const flags   = wrapped ? wrapped[2] : '';

  let ast = null, errors = [];
  try {
    const parser = new RegexParser(pattern);
    const result = parser.parse();
    ast = result.ast;
    errors = result.errors;
  } catch(e) {
    errors = [e.message];
  }

  return { pattern, flags, ast, errors };
}

function describeNode(node) {
  if (!node) return { title: 'Unknown', body: '' };
  switch (node.type) {
    case 'literal':
      return {
        title: 'Literal Character',
        body: `Matches the exact character <code>${escHtml(node.value ?? node.label)}</code>.`
      };
    case 'char-class': {
      const map = {
        digit:     ['\\d', 'Any digit', 'Matches any digit character: <code>0–9</code>.'],
        'non-digit': ['\\D', 'Non-digit', 'Matches any character that is <em>not</em> a digit.'],
        word:      ['\\w', 'Word character', 'Matches <code>[a-zA-Z0-9_]</code>.'],
        'non-word':['\\W', 'Non-word', 'Matches any character that is <em>not</em> a word character.'],
        space:     ['\\s', 'Whitespace', 'Matches spaces, tabs, and newlines.'],
        'non-space':['\\S','Non-whitespace','Matches any character that is <em>not</em> whitespace.'],
      };
      const [code, label, body] = map[node.kind] || ['?', node.kind, ''];
      return { title: label, code, body };
    }
    case 'anchor': {
      const map = {
        start:      ['Begins with (^)',  'Asserts the start of the string (or line in multiline mode).'],
        end:        ['Ends with ($)',    'Asserts the end of the string (or line in multiline mode).'],
        'word-bound':['Word boundary (\\b)', 'Asserts a position between a word and non-word character.'],
        'non-bound': ['Non-boundary (\\B)',  'Asserts a position that is <em>not</em> a word boundary.'],
      };
      const [title, body] = map[node.kind] || [node.kind, ''];
      return { title, body };
    }
    case 'any':
      return { title: 'Any Character', body: 'Matches any single character except a newline (<code>\\n</code>).' };
    case 'charset':
      return {
        title: node.negated ? 'Negated Character Set' : 'Character Set',
        body: node.negated
          ? `Matches any character <em>not</em> in: <code>${escHtml(node.label)}</code>`
          : `Matches any one character in: <code>${escHtml(node.label)}</code>`
      };
    case 'group': {
      const labels = {
        capturing:            'Capturing Group',
        named:                `Named Capturing Group "${node.name}"`,
        'non-capturing':      'Non-capturing Group',
        lookahead:            'Positive Lookahead',
        'negative-lookahead': 'Negative Lookahead',
        lookbehind:           'Positive Lookbehind',
        'negative-lookbehind':'Negative Lookbehind',
      };
      const bodies = {
        capturing:            `Captures the matched text into group <strong>#${node.groupIndex}</strong>. Accessible as <code>$${node.groupIndex}</code> or <code>match[${node.groupIndex}]</code>.`,
        named:                `Captures into named group <strong>"${node.name}"</strong>. Accessible as <code>match.groups.${node.name}</code>.`,
        'non-capturing':      'Groups the expression without capturing. Useful for applying quantifiers to multiple tokens.',
        lookahead:            'Asserts that the enclosed pattern <strong>follows</strong> the current position (without consuming characters).',
        'negative-lookahead': 'Asserts that the enclosed pattern does <strong>not follow</strong> the current position.',
        lookbehind:           'Asserts that the enclosed pattern <strong>precedes</strong> the current position.',
        'negative-lookbehind':'Asserts that the enclosed pattern does <strong>not precede</strong> the current position.',
      };
      return { title: labels[node.kind] || 'Group', body: bodies[node.kind] || '' };
    }
    case 'quantifier': {
      const { min, max, lazy } = node;
      const sym = max === Infinity ? (min === 0 ? '*' : '+') : (min === 0 ? '?' : `{${min}${max === min ? '' : ',' + (max === Infinity ? '' : max)}}`);
      const range = max === Infinity ? `${min} to unlimited` : min === max ? `exactly ${min}` : `${min} to ${max}`;
      return {
        title: `Quantifier  ${sym}`,
        body: `Repeats the preceding token <strong>${range}</strong> time${min === 1 && max === 1 ? '' : 's'}.${lazy ? ' <em>Lazy</em> — matches as few times as possible.' : ' <em>Greedy</em> — matches as many times as possible.'}`
      };
    }
    case 'alternation':
      return { title: 'Alternation (|)', body: `Matches one of <strong>${node.alternatives.length}</strong> alternatives.` };
    case 'sequence':
      return { title: 'Sequence', body: `A sequence of ${node.items.length} tokens, all of which must match in order.` };
    case 'empty':
      return { title: 'Empty', body: 'Matches the empty string at this position.' };
    default:
      return { title: node.type, body: '' };
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
