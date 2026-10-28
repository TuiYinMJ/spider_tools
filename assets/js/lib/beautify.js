(function (root) {
  'use strict';
  const SK = (root.SK = root.SK || {});

  const VERSION = '1.0.0';
  const DEFAULT_LIMIT_BYTES = 5 * 1024 * 1024;
  const CHUNK_SIZE = 256 * 1024;

  const SUPPORTED_LANGS = [
    { id: 'json', label: 'JSON' },
    { id: 'js', label: 'JavaScript' },
    { id: 'ts', label: 'TypeScript' },
    { id: 'html', label: 'HTML' },
    { id: 'xml', label: 'XML' },
    { id: 'css', label: 'CSS' },
    { id: 'python', label: 'Python / dict literal' }
  ];

  function isIdStart(c) {
    return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || c > 127;
  }
  function isIdPart(c) {
    return isIdStart(c) || (c >= 48 && c <= 57);
  }
  function isDigit(c) {
    return c >= 48 && c <= 57;
  }
  function isWsCode(c) {
    return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 0xa0;
  }
  function countNewlines(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
  }
  function indentUnit(indent) {
    if (indent === '\t' || indent === 'tab') return '\t';
    let n = typeof indent === 'string' ? parseInt(indent, 10) : indent;
    if (!Number.isFinite(n) || n < 0) n = 2;
    if (n > 8) n = 8;
    return ' '.repeat(n);
  }
  function identName(s) {
    return typeof s === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
  }

  function escapeHtml(s) {
    const str = s == null ? '' : String(s);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (c === '&') out += '&amp;';
      else if (c === '<') out += '&lt;';
      else if (c === '>') out += '&gt;';
      else if (c === '"') out += '&quot;';
      else if (c === "'") out += '&#39;';
      else out += c;
    }
    return out;
  }

  const HTML_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
    hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    bull: '•', middot: '·', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½',
    sup2: '²', sup3: '³', micro: 'µ', para: '¶', sect: '§', laquo: '«', raquo: '»',
    trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', dagger: '†', Dagger: '‡',
    larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', ne: '≠', le: '≤', ge: '≥',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', omega: 'ω', pi: 'π', sum: '∑', infin: '∞'
  };

  function unescapeHtml(s) {
    const str = s == null ? '' : String(s);
    let out = '';
    for (let i = 0; i < str.length;) {
      const c = str.charCodeAt(i);
      if (c !== 38) { out += str.charAt(i); i++; continue; }
      const semi = str.indexOf(';', i + 1);
      if (semi < 0 || semi - i > 12) { out += '&'; i++; continue; }
      const body = str.slice(i + 1, semi);
      let decoded = null;
      if (body.charCodeAt(0) === 35) {
        const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        const num = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (Number.isFinite(num) && num >= 0 && num <= 0x10ffff) decoded = numToString(num);
      } else if (HTML_ENTITIES[body] !== undefined) {
        decoded = HTML_ENTITIES[body];
      } else {
        const lower = body.toLowerCase();
        if (HTML_ENTITIES[lower] !== undefined) decoded = HTML_ENTITIES[lower];
      }
      if (decoded === null) { out += '&'; i++; continue; }
      out += decoded;
      i = semi + 1;
    }
    return out;
  }
  function numToString(cp) {
    try { return String.fromCodePoint(cp); } catch (e) { return ''; }
  }

  function prettyBytes(n) {
    let v = Number(n);
    if (!Number.isFinite(v) || v < 0) v = 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    const digits = u === 0 ? 0 : (v >= 100 ? 0 : v >= 10 ? 1 : 2);
    return (u === 0 ? String(Math.round(v)) : v.toFixed(digits)) + ' ' + units[u];
  }

  function truncateMiddle(str, n) {
    let s = str == null ? '' : String(str);
    let max = Math.max(0, n | 0 || 60);
    if (s.length <= max) return s;
    if (max < 8) return s.slice(0, max);
    const head = Math.ceil((max - 1) / 2);
    const tail = max - 1 - head;
    return s.slice(0, head) + '…' + (tail > 0 ? s.slice(s.length - tail) : '');
  }

  function clampInt(v, dflt, min, max) {
    let n = typeof v === 'string' ? parseInt(v, 10) : v;
    if (!Number.isFinite(n)) return dflt;
    if (n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n | 0;
  }

  function StopSignal(scope) {
    const e = new Error('stopped');
    e.name = 'StopSignal';
    e.scope = scope || '';
    return e;
  }
  function mkHooks(h) {
    h = h || {};
    return {
      progress: typeof h.progress === 'function' ? h.progress : null,
      shouldStop: typeof h.shouldStop === 'function' ? h.shouldStop : null,
      yieldEvery: clampInt(h.yieldEvery, 8192, 256)
    };
  }
  function reportProgress(hk, done, total) {
    if (hk.progress) { try { hk.progress(done, total); } catch (e) {} }
  }
  function tick(hk, done, total, scope) {
    if (done === 0) return;
    if (done % hk.yieldEvery === 0) {
      if (hk.shouldStop && safeStop(hk)) throw StopSignal(scope);
      if (hk.progress) reportProgress(hk, Math.min(done, total), total);
    }
  }
  function safeStop(hk) {
    try { return !!hk.shouldStop(); } catch (e) { return false; }
  }
  function isStop(e) { return !!e && e.name === 'StopSignal'; }

  function preview(v, max) {
    const limit = max || 60;
    let s;
    if (typeof v === 'string') s = JSON.stringify(v);
    else if (v === null || v === undefined) s = String(v);
    else if (typeof v === 'object') s = Array.isArray(v) ? '[array]' : '[object]';
    else s = String(v);
    return s.length > limit ? s.slice(0, limit - 1) + '…' : s;
  }

  const JSON_TYPES = { o: 'object', a: 'array', s: 'string', n: 'number', k: 'literal' };

  function jsonTypeLabel(t) {
    if (t === 'o') return 'object';
    if (t === 'a') return 'array';
    if (t === 's') return 'string';
    if (t === 'n') return 'number';
    return 'literal';
  }

  function lineColAt(text, pos) {
    let line = 1, last = 0;
    const n = Math.min(pos, text.length);
    for (let i = 0; i < n; i++) {
      if (text.charCodeAt(i) === 10) { line++; last = i + 1; }
    }
    return { line: line, column: pos - last + 1 };
  }

  function snippetAt(text, pos, span) {
    const width = span || 80;
    const start = Math.max(0, pos - width);
    const end = Math.min(text.length, pos + width);
    let lineStart = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    if (lineEnd - lineStart > width * 2) { lineEnd = lineStart + width * 2; }
    const lc = lineColAt(text, pos);
    const col = pos - lineStart + 1;
    const snip = text.slice(lineStart, lineEnd).replace(/\t/g, ' ');
    const shown = snip.length > width * 2 ? snip.slice(0, width * 2) : snip;
    const caret = ' '.repeat(Math.max(0, Math.min(col, shown.length) - 1)) + '^';
    return (start > 0 || end < text.length ? '…' : '') + '\n' + shown + '\n' + caret +
      '\nline ' + lc.line + ', column ' + lc.column + ' (offset ' + pos + ')';
  }

  function jsonError(message, pos, text, kind) {
    const lc = lineColAt(text, pos);
    return {
      message: message, kind: kind || 'syntax',
      line: lc.line, column: lc.column, position: pos,
      contextSnippet: snippetAt(text, pos)
    };
  }

  const SIMPLE_ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  // String decoder shared by JSON + Python paths; strict controls invalid escape reporting.
  function decodeStringLit(src, start, end, quote, opts) {
    const out = [];
    let invalid = null;
    let i = start;
    while (i < end) {
      const c = src.charAt(i);
      if (c !== '\\') { out.push(c); i++; continue; }
      const e = src.charAt(i + 1);
      if (e === undefined) { invalid = 'dangling backslash'; break; }
      if (SIMPLE_ESCAPES[e] !== undefined) { out.push(SIMPLE_ESCAPES[e]); i += 2; continue; }
      if (e === 'u' || e === 'x') {
        const wide = e === 'u';
        const digits = src.substr(i + 2, wide ? 4 : 2);
        if (!new RegExp('^[0-9a-fA-F]{' + (wide ? 4 : 2) + '}$').test(digits)) {
          if (opts && opts.rawString === true) { out.push('\\', e); i += 2; continue; }
          invalid = 'bad \\' + e + ' escape';
          out.push('\\', e); i += 2; continue;
        }
        out.push(String.fromCharCode(parseInt(digits, 16)));
        i += 2 + digits.length;
        continue;
      }
      if (e === '\n') { i += 2; continue; }
      if (opts && opts.rawString === true) { out.push('\\', e); i += 2; continue; }
      out.push(e);
      i += 2;
    }
    return { value: out.join(''), invalid: invalid };
  }

  function encodeStringLit(str, quote, ensureAscii) {
    const q = quote || '"';
    let out = q;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      const ch = str.charAt(i);
      if (c === 92) out += '\\\\';
      else if (ch === q) out += '\\' + q;
      else if (c === 10) out += '\\n';
      else if (c === 13) out += '\\r';
      else if (c === 9) out += '\\t';
      else if (c === 8) out += '\\b';
      else if (c === 12) out += '\\f';
      else if (c < 32 || c === 0x7f) out += '\\u' + c.toString(16).padStart(4, '0');
      else if (ensureAscii && c > 126) {
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
          const lo = str.charCodeAt(i + 1);
          out += '\\u' + c.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
          i++;
        } else out += '\\u' + c.toString(16).padStart(4, '0');
      } else out += ch;
    }
    return out + q;
  }

  function jsonSkipWs(s, i, allowComments) {
    const n = s.length;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
      if (allowComments && c === 47) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 === 47) {
          i += 2;
          while (i < n && s.charCodeAt(i) !== 10) i++;
          continue;
        }
        if (c2 === 42) {
          i += 2;
          while (i < n && !(s.charCodeAt(i) === 42 && s.charCodeAt(i + 1) === 47)) i++;
          i = Math.min(n, i + 2);
          continue;
        }
      }
      break;
    }
    return i;
  }

  const NUM_RE = /^(?:-|\+)?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/;

  // Number precision strategy: raw-token rewriting. Numbers are never passed through
  // JSON.parse/stringify; their exact source text is carried in node.r and re-emitted.
  function jsonScanNumber(s, i) {
    const rest = s.slice(i, i + 40);
    const m = NUM_RE.exec(rest);
    if (!m) return null;
    let raw = m[0];
    let pos = i + raw.length;
    if (raw === '-Infinity' || raw === '+Infinity') return null;
    if (raw.charCodeAt(0) === 43) { raw = raw.slice(1); pos = i + m[0].length; }
    return { raw: raw, end: pos };
  }

  function jsonLiteralWord(s, i) {
    for (const w of ['true', 'false', 'null', 'NaN', 'Infinity', '-Infinity']) {
      if (s.startsWith(w, i)) return w;
    }
    return null;
  }

  // Recursive-descent model builder. Returns { root, error, issues, stats }.
  function jsonBuildModel(text, hooks, opt) {
    opt = opt || {};
    const hk = mkHooks(hooks || opt.hooks);
    const lenient = opt.lenient !== false;
    const maxDepth = opt.maxDepth || 4096;
    const maxNodes = opt.maxNodes || 0;
    const issues = {
      trailingComma: 0, singleQuotes: 0, unquotedKeys: 0, comments: 0,
      nanInfinity: 0, pythonLiterals: 0, plusNumbers: 0, leadingZeros: 0, controlChars: 0
    };
    const stats = {
      bytes: text.length, depth: 0, keys: 0, nodes: 0, arrays: 0, objects: 0,
      maxKeyLength: 0, dupKeys: [], numbers: [], numbersLong: 0,
      types: { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 }
    };
    const hasBOM = text.charCodeAt(0) === 0xfeff;
    let i = hasBOM ? 1 : 0;
    let stopped = false;
    const stack = [];

    function fail(msg, pos, kind) { throw { __json: true, err: jsonError(msg, pos, text, kind) }; }

    function ws() {
      const j = jsonSkipWs(text, i, lenient);
      if (lenient && j > i) {
        let k = i;
        while (k < j) {
          if (text.charCodeAt(k) === 47 && (text.charCodeAt(k + 1) === 47 || text.charCodeAt(k + 1) === 42)) issues.comments++;
          k = jsonSkipWs(text, k + (text.charCodeAt(k + 1) === 47 ? 2 : 2), lenient) === k ? k + 1 : jsonSkipWs(text, k, false);
        }
      }
      i = j;
    }

    function readString(quote) {
      const start = i;
      i++;
      const chars = [];
      let raw = null;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c === quote) { i++; raw = null; break; }
        if (c === 92) {
          const e = text.charAt(i + 1);
          if (e === 'u' || e === 'x') {
            const wide = e === 'u';
            const digits = text.substr(i + 2, wide ? 4 : 2);
            if (/^[0-9a-fA-F]+$/.test(digits) && digits.length === (wide ? 4 : 2)) {
              chars.push(String.fromCharCode(parseInt(digits, 16)));
              i += 2 + digits.length;
              continue;
            }
            chars.push(e); i += 2; continue;
          }
          chars.push(SIMPLE_ESCAPES[e] !== undefined ? SIMPLE_ESCAPES[e] : (e === '\n' ? '' : e));
          i += 2;
          continue;
        }
        if (c === 10) fail('Unterminated string', start, 'string');
        if (c < 32) { issues.controlChars++; }
        chars.push(text.charAt(i));
        i++;
        if (raw === null && chars.length > 4096) raw = null;
      }
      if (i >= text.length && text.charCodeAt(start) !== quote) fail('Unterminated string', start, 'string');
      if (quote === 39) {
        issues.singleQuotes++;
        if (i < text.length && text.charCodeAt(i) === 39) { i++; }
      }
      return { value: chars.join(''), start: start, end: i };
    }

    function value(depth, pathLabel) {
      if (stopped) return null;
      ws();
      if (hk.progress && (stats.nodes % hk.yieldEvery === 0)) {
        tick(hk, stats.nodes, 0, 'json');
      }
      if (maxNodes && stats.nodes >= maxNodes) fail('Node limit reached (' + maxNodes + ')', i, 'limit');
      if (depth > maxDepth) fail('Maximum nesting depth exceeded (' + maxDepth + ')', i, 'depth');
      if (i >= text.length) fail('Unexpected end of input', i, 'eof');
      const c = text.charCodeAt(i);
      stats.nodes++;
      if (c === 123) return object(depth, pathLabel);
      if (c === 91) return array(depth, pathLabel);
      if (c === 34) { const r = readString(34); stats.types.string++; return { t: 's', v: r.value, s: r.start, e: r.end }; }
      if (c === 39 && lenient) { const r = readString(39); stats.types.string++; return { t: 's', v: r.value, s: r.start, e: r.end, single: true }; }
      if (c === 45 || (c >= 48 && c <= 57) || (c === 43 && lenient)) {
        let sign = 1, j = i;
        if (text.charCodeAt(j) === 43) { issues.plusNumbers++; j++; }
        let negative = false;
        if (text.charCodeAt(j) === 45) { negative = true; j++; }
        if (lenient) {
          if (text.startsWith('Infinity', j)) {
            issues.nanInfinity++;
            i = j + 8;
            return { t: 'n', r: (negative ? '-' : '') + 'Infinity', s: i, e: i };
          }
          if (text.startsWith('NaN', j) && !negative) {
            issues.nanInfinity++;
            i = j + 3;
            return { t: 'n', r: 'NaN', s: i, e: i };
          }
        }
        if (j < text.length && text.charCodeAt(j) === 48 && isDigit(text.charCodeAt(j + 1))) issues.leadingZeros++;
        const num = jsonScanNumber(text, i);
        if (!num) fail('Invalid number at "' + text.substr(i, 12) + '"', i, 'number');
        i = num.end;
        stats.types.number++;
        const digits = num.raw.replace(/[-+.eE]/g, '').length;
        if (digits > 15) stats.numbersLong++;
        if (stats.numbers.length < (opt.maxNumbers || 120)) stats.numbers.push({ path: pathLabel || '$', value: num.raw, len: num.raw.length });
        return { t: 'n', r: num.raw, s: i - num.raw.length, e: i };
      }
      const w = jsonLiteralWord(text, i);
      if (w && (!lenient || w === 'true' || w === 'false' || w === 'null' || w === 'NaN' || w === 'Infinity')) {
        i += w.length;
        if (w === 'NaN' || w === 'Infinity') issues.nanInfinity++;
        if (w === 'true' || w === 'false') stats.types.boolean++;
        else if (w === 'null') stats.types.null++;
        else { stats.types.number++; return { t: 'n', r: w, s: i - w.length, e: i }; }
        return { t: 'k', v: w, s: i - w.length, e: i };
      }
      if (lenient) {
        for (const py of ['None', 'True', 'False']) {
          if (text.startsWith(py, i)) {
            issues.pythonLiterals++;
            i += py.length;
            const map = { None: 'null', True: 'true', False: 'false' };
            const v = map[py];
            if (v === 'null') stats.types.null++; else stats.types.boolean++;
            return { t: 'k', v: v, s: i - py.length, e: i, python: py };
          }
        }
      }
      fail('Unexpected token "' + text.charAt(i) + '" expecting a value', i, 'token');
      return null;
    }

    function object(depth, pathLabel) {
      const node = { t: 'o', e: [], s: i, l: 0 };
      stats.types.object++;
      stats.objects++;
      if (depth + 1 > stats.depth) stats.depth = depth + 1;
      stack.push(node);
      i++;
      ws();
      if (text.charCodeAt(i) === 125) { i++; stack.pop(); return node; }
      const seen = Object.create(null);
      for (;;) {
        ws();
        let key;
        const cc = text.charCodeAt(i);
        if (cc === 34) { const r = readString(34); key = r.value; }
        else if (cc === 39 && lenient) { const r = readString(39); key = r.value; }
        else if (cc === 125) {
          issues.trailingComma++;
          i++;
          stack.pop();
          return node;
        } else if (lenient && (isIdStart(cc) || cc === 45)) {
          issues.unquotedKeys++;
          const start = i;
          while (i < text.length && (isIdPart(text.charCodeAt(i)) || text.charCodeAt(i) === 45 || text.charCodeAt(i) === 46)) i++;
          key = text.slice(start, i);
          const num = NUM_RE.exec(key);
          if (!num || num[0].length !== key.length) { /* bare word key */ }
        } else {
          fail('Expected a string key in object', i, 'key');
        }
        if (key.length > stats.maxKeyLength) stats.maxKeyLength = key.length;
        seen[key] = (seen[key] || 0) + 1;
        if (seen[key] === 2) {
          stats.dupKeys.push({ path: pathLabel || '$', name: key, count: 2 });
        } else if (seen[key] > 2) {
          for (const d of stats.dupKeys) if (d.path === (pathLabel || '$') && d.name === key) d.count = seen[key];
        }
        stats.keys++;
        ws();
        if (text.charCodeAt(i) !== 58) {
          if (lenient && text.charCodeAt(i) === 61) { i++; }
          else fail('Expected ":" after object key', i, 'colon');
        }
        i++;
        const childPath = (pathLabel || '$') + '.' + key;
        const v = value(depth + 1, childPath);
        node.e.push([key, v]);
        ws();
        const nx = text.charCodeAt(i);
        if (nx === 44) { i++; ws(); if (text.charCodeAt(i) === 125) { issues.trailingComma++; i++; stack.pop(); return node; } continue; }
        if (nx === 125) { i++; stack.pop(); return node; }
        if (nx === 58) fail('Missing comma between object members (found ":")', i, 'comma');
        if (nx !== 34) fail('Expected "," or "}" in object, found "' + (text.charAt(i) || 'EOF') + '"', i, 'comma');
        if (lenient) { i++; continue; }
        fail('Expected "," or "}" in object', i, 'comma');
        return node;
      }
    }

    function array(depth, pathLabel) {
      const node = { t: 'a', e: [], s: i, l: 0 };
      stats.types.array++;
      stats.arrays++;
      if (depth + 1 > stats.depth) stats.depth = depth + 1;
      stack.push(node);
      i++;
      ws();
      if (text.charCodeAt(i) === 93) { i++; stack.pop(); return node; }
      let idx = 0;
      for (;;) {
        const childPath = (pathLabel || '$') + '[' + idx + ']';
        const v = value(depth + 1, childPath);
        node.e.push(v);
        idx++;
        ws();
        const nx = text.charCodeAt(i);
        if (nx === 44) {
          i++; ws();
          if (text.charCodeAt(i) === 93) { issues.trailingComma++; i++; stack.pop(); return node; }
          continue;
        }
        if (nx === 93) { i++; stack.pop(); return node; }
        fail('Expected "," or "]" in array, found "' + (text.charAt(i) || 'EOF') + '"', i, 'comma');
        return node;
      }
    }

    let root = null;
    let error = null;
    try {
      root = value(0, '$');
      ws();
      if (i < text.length) {
        const extra = text.charCodeAt(i) === 125 ? 'Unexpected "}"' : 'Unexpected trailing content "' + text.charAt(i) + '"';
        error = jsonError(extra, i, text, 'trailing');
      }
    } catch (e) {
      if (e && e.__json) error = e.err;
      else if (isStop(e)) stopped = true;
      else throw e;
    }
    if (!error && stopped) error = jsonError('Scan stopped by caller', i, text, 'stopped');
    reportProgress(hk, text.length, text.length);
    return {
      root: root, error: error, issues: issues, stopped: stopped,
      stats: stats, hasBOM: hasBOM, consumed: i
    };
  }

  function jsonStats(text, opts) {
    const r = jsonBuildModel(String(text == null ? '' : text), opts && opts.hooks, opts);
    const s = r.stats;
    return {
      ok: !r.error, error: r.error, bytes: s.bytes, depth: s.depth, keys: s.keys, nodes: s.nodes,
      objects: s.objects, arrays: s.arrays, maxKeyLength: s.maxKeyLength,
      types: s.types, dupKeys: s.dupKeys, numbersLong: s.numbersLong,
      lines: countNewlines(String(text)) + 1, issues: r.issues, hasBOM: r.hasBOM,
      truncated: s.nodes >= (opts && opts.maxNodes ? opts.maxNodes : 0)
    };
  }

  function jsonRender(node, ctx) {
    const unit = ctx.unit, compact = ctx.compact;
    const nl = compact ? '' : '\n';
    return render(node, ctx.level, true);

    function render(n, level, isRoot) {
      if (n === null || n === undefined) return 'null';
      switch (n.t) {
        case 'n': return ctx.keepPrecision !== false ? n.r : String(Number(n.r));
        case 'k': return n.v;
        case 's': {
          let lit;
          if (n.single && ctx.keepSingleQuotes) lit = text_of(n);
          else lit = encodeStringLit(n.v, '"', ctx.ensureAscii);
          return lit;
        }
        case 'a': {
          if (!n.e.length) return '[]';
          const inline = tryInline(n, level);
          if (inline !== null) return inline;
          const pad = compact ? '' : unit.repeat(level + 1);
          const parts = [];
          for (const c of n.e) parts.push(pad + render(c, level + 1, false));
          return '[' + nl + parts.join(',' + nl) + nl + (compact ? '' : unit.repeat(level)) + ']';
        }
        case 'o': {
          if (!n.e.length) return '{}';
          const entries = orderedEntries(n, ctx);
          const inline = tryInlineObj(n, entries, level);
          if (inline !== null) return inline;
          const pad = compact ? '' : unit.repeat(level + 1);
          const parts = [];
          for (const en of entries) {
            if (ctx.dropNulls && en[1] && en[1].t === 'k' && en[1].v === 'null') continue;
            parts.push(pad + encodeStringLit(en[0], '"', ctx.ensureAscii) + ':' + (compact ? '' : ' ') + render(en[1], level + 1, false));
          }
          if (!parts.length) return '{}';
          return '{' + nl + parts.join(',' + nl) + nl + (compact ? '' : unit.repeat(level)) + '}';
        }
        default: return 'null';
      }
    }

    function text_of(n) { return n.v; }

    function tryInline(n, level) {
      if (compact || !ctx.maxWidth) return null;
      if (n.e.length > ctx.maxInlineItems) return null;
      let fits = true;
      const sub = {
        unit: unit, compact: true, level: 0, maxWidth: 0, ensureAscii: ctx.ensureAscii,
        dropNulls: ctx.dropNulls, sortKeys: ctx.sortKeys, keyOrder: ctx.keyOrder,
        keepPrecision: ctx.keepPrecision, maxInlineItems: ctx.maxInlineItems, keepSingleQuotes: ctx.keepSingleQuotes
      };
      const parts = [];
      for (const c of n.e) {
        const t = sub.render ? null : renderRef(c, sub, level + 1);
        if (t === null) { fits = false; break; }
        parts.push(t);
      }
      if (!fits) return null;
      const out = '[' + parts.join(',') + ']';
      return unit.repeat(level).length + out.length <= ctx.maxWidth ? out : null;
    }
    function tryInlineObj(n, entries, level) {
      if (compact || !ctx.maxWidth) return null;
      if (entries.length > ctx.maxInlineItems) return null;
      const parts = [];
      for (const en of entries) {
        if (ctx.dropNulls && en[1] && en[1].t === 'k' && en[1].v === 'null') continue;
        const t = renderRef(en[1], {
          unit: unit, compact: true, level: 0, maxWidth: 0, ensureAscii: ctx.ensureAscii,
          dropNulls: ctx.dropNulls, sortKeys: ctx.sortKeys, keyOrder: ctx.keyOrder,
          keepPrecision: ctx.keepPrecision, maxInlineItems: ctx.maxInlineItems, keepSingleQuotes: ctx.keepSingleQuotes
        }, level + 1);
        if (t === null) return null;
        parts.push(JSON.stringify(en[0]) + ':' + t);
      }
      const out = '{' + parts.join(',') + '}';
      return unit.repeat(level).length + out.length <= ctx.maxWidth ? out : null;
    }
  }

  // renderRef renders a node with an explicit ctx (kept separate so inline probes do not recurse into
  // the caller's maxWidth settings and risk quadratic work).
  function renderRef(n, ctx, level) {
    switch (n.t) {
      case 'n': return ctx.keepPrecision !== false ? n.r : String(Number(n.r));
      case 'k': return n.v;
      case 's': return encodeStringLit(n.v, '"', ctx.ensureAscii);
      case 'a': {
        if (n.e.length > ctx.maxInlineItems) return null;
        const parts = [];
        for (const c of n.e) { const t = renderRef(c, ctx, level + 1); if (t === null) return null; parts.push(t); }
        return '[' + parts.join(',') + ']';
      }
      case 'o': {
        if (n.e.length > ctx.maxInlineItems) return null;
        const entries = orderedEntries(n, ctx);
        const parts = [];
        for (const en of entries) {
          if (ctx.dropNulls && en[1] && en[1].t === 'k' && en[1].v === 'null') continue;
          const t = renderRef(en[1], ctx, level + 1);
          if (t === null) return null;
          parts.push(JSON.stringify(en[0]) + ':' + t);
        }
        return '{' + parts.join(',') + '}';
      }
      default: return null;
    }
  }
  jsonRender.renderRef = renderRef;

  function orderedEntries(node, ctx) {
    let entries = node.e;
    const order = ctx.keyOrder;
    if (order && order.length) {
      const idx = Object.create(null);
      order.forEach((k, n) => { idx[k] = n; });
      entries = entries.slice().sort((a, b) => {
        const ai = idx[a[0]] === undefined ? order.length : idx[a[0]];
        const bi = idx[b[0]] === undefined ? order.length : idx[b[0]];
        return ai === bi ? 0 : ai - bi;
      });
    }
    if (ctx.sortKeys === true || ctx.sortKeys === 'deep') {
      entries = entries.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }
    return entries;
  }

  function jsonFormat(text, opts) {
    opts = opts || {};
    const src = String(text == null ? '' : text);
    const hk = mkHooks(opts.hooks);
    const limit = opts.limitBytes || DEFAULT_LIMIT_BYTES;
    if (src.length > limit) {
      const streamed = jsonStreamFormat(src, hk, Object.assign({}, opts, { streaming: true }));
      const out = streamed.chunks.join('');
      return {
        text: out,
        stats: Object.assign(streamed.stats, { inBytes: src.length, lines: countNewlines(out) + 1, error: streamed.error || null }),
        truncated: !!streamed.truncated,
        outPathHint: streamed.outPathHint,
        streamed: true,
        notice: 'Input above limitBytes (' + prettyBytes(limit) + ') used the chunked streaming printer; ' +
          'stats are approximate and opts.sortKeys/keyOrder/maxWidth are not applied on this path.'
      };
    }
    const built = jsonBuildModel(src, hk, opts);
    if (built.error) {
      return {
        text: src,
        stats: {
          bytes: src.length, inBytes: src.length, lines: countNewlines(src) + 1,
          keys: built.stats.keys, arrays: built.stats.arrays, depth: built.stats.depth,
          error: built.error
        },
        truncated: false
      };
    }
    const ctx = {
      unit: indentUnit(opts.indent === undefined ? 2 : opts.indent),
      compact: !!opts.compact,
      level: 0,
      sortKeys: opts.sortKeys === true || opts.sortKeys === 'deep' ? (opts.sortKeys === 'deep' ? 'deep' : true) : false,
      ensureAscii: !!opts.ensureAscii,
      keyOrder: Array.isArray(opts.keyOrder) ? opts.keyOrder : null,
      maxWidth: clampInt(opts.maxWidth, 0, 0, 100000),
      keepPrecision: opts.keepNumberPrecision !== false,
      dropNulls: !!opts.dropNulls,
      maxInlineItems: opts.maxInlineItems || 8,
      keepSingleQuotes: false
    };
    const body = renderWhole(built.root, ctx);
    const out = opts.trailingNewline === false ? body : body + '\n';
    return {
      text: out,
      stats: {
        bytes: out.length, inBytes: src.length, lines: countNewlines(out) + 1,
        keys: built.stats.keys, arrays: built.stats.arrays, objects: built.stats.objects,
        nodes: built.stats.nodes, depth: built.stats.depth, error: null
      },
      truncated: false
    };
  }

  function renderWhole(node, ctx) {
    // deep sort needs recursion; shallow sort only affects the root object.
    if (ctx.sortKeys === 'deep') deepSortKeys(node);
    return jsonRender(node, ctx);
  }

  function deepSortKeys(node) {
    const seen = [];
    function walk(n) {
      if (!n || seen.length > 2000000) return;
      if (n.t === 'o') { n.e.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); for (const e of n.e) walk(e[1]); }
      else if (n.t === 'a') for (const c of n.e) walk(c);
    }
    walk(node);
    void seen;
  }

  function jsonValidate(text, hooks) {
    const src = String(text == null ? '' : text);
    const hk = mkHooks(hooks && hooks.hooks ? hooks.hooks : hooks);
    if (src.length > DEFAULT_LIMIT_BYTES && !hk.forceSmall) {
      const streamed = jsonStreamScan(src, hk, {});
      return {
        ok: !streamed.error,
        error: streamed.error,
        stats: Object.assign(streamed.stats, {
          numbers: streamed.numbersSample || [], hasBOM: streamed.hasBOM,
          trailingComma: streamed.issues.trailingComma, singleQuotes: streamed.issues.singleQuotes,
          unquotedKeys: streamed.issues.unquotedKeys, comments: streamed.issues.comments,
          nanInfinity: streamed.issues.nanInfinity, pythonLiterals: streamed.issues.pythonLiterals,
          controlChars: streamed.issues.controlChars, plusNumbers: streamed.issues.plusNumbers,
          leadingZeros: streamed.issues.leadingZeros
        }),
        streamed: true,
        truncated: !!streamed.stopped
      };
    }
    const built = jsonBuildModel(src, hk, { lenient: true, maxNodes: 0 });
    const s = built.stats;
    const errorCount = built.issues.trailingComma + built.issues.singleQuotes + built.issues.unquotedKeys +
      built.issues.comments + built.issues.nanInfinity + built.issues.pythonLiterals + built.issues.controlChars;
    return {
      ok: !built.error,
      error: built.error,
      stats: {
        bytes: s.bytes, lines: countNewlines(src) + 1, depth: s.depth, keys: s.keys, nodes: s.nodes,
        objects: s.objects, arrays: s.arrays, maxKeyLength: s.maxKeyLength, types: s.types,
        dupKeys: s.dupKeys, numbers: s.numbers, numbersLong: s.numbersLong,
        hasBOM: built.hasBOM, trailingComma: built.issues.trailingComma,
        singleQuotes: built.issues.singleQuotes, unquotedKeys: built.issues.unquotedKeys,
        comments: built.issues.comments, nanInfinity: built.issues.nanInfinity,
        pythonLiterals: built.issues.pythonLiterals, controlChars: built.issues.controlChars,
        plusNumbers: built.issues.plusNumbers, leadingZeros: built.issues.leadingZeros,
        fixable: errorCount, consumed: built.consumed, streamed: false
      }
    };
  }

  // ---- incremental (chunk-safe) JSON scanner -------------------------------
  // Feeds slices of the source through a resumable state machine so ≥5MB documents never
  // build a full node tree or a full output string at once.
  function jsonStreamScan(text, hooks, opts) {
    opts = opts || {};
    const hk = mkHooks(hooks);
    const st = {
      i: 0, len: text.length,
      depth: 0, maxDepth: 0, nodes: 0, keys: 0, arrays: 0, objects: 0,
      types: { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 },
      issues: { trailingComma: 0, singleQuotes: 0, unquotedKeys: 0, comments: 0, nanInfinity: 0, controlChars: 0 },
      dupKeys: [], numbersSample: [], numbersLong: 0, maxKeyLength: 0,
      error: null, hasBOM: text.charCodeAt(0) === 0xfeff, stopped: false
    };
    const stack = [];
    let i = st.hasBOM ? 1 : 0;
    let pathParts = [];

    function curPath() {
      let p = '$';
      for (const s of pathParts) p += s.key === undefined ? '[' + s.idx + ']' : '.' + s.key;
      return p;
    }
    function ws() {
      for (;;) {
        while (i < st.len && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9 || text.charCodeAt(i) === 10 || text.charCodeAt(i) === 13)) i++;
        if (i < st.len && text.charCodeAt(i) === 47) {
          const c2 = text.charCodeAt(i + 1);
          if (c2 === 47) { i += 2; while (i < st.len && text.charCodeAt(i) !== 10) i++; st.issues.comments++; continue; }
          if (c2 === 42) {
            i += 2;
            while (i < st.len && !(text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 47)) i++;
            i = Math.min(st.len, i + 2);
            st.issues.comments++;
            continue;
          }
        }
        return;
      }
    }
    function str() {
      const start = i;
      const q = text.charCodeAt(i);
      i++;
      const out = [];
      while (i < st.len) {
        const c = text.charCodeAt(i);
        if (c === q) { i++; break; }
        if (c === 92) {
          const e = text.charAt(i + 1);
          if ((e === 'u' || e === 'x')) {
            const wide = e === 'u';
            const d = text.substr(i + 2, wide ? 4 : 2);
            if (d.length === (wide ? 4 : 2) && /^[0-9a-fA-F]+$/.test(d)) { out.push(String.fromCharCode(parseInt(d, 16))); i += 2 + d.length; continue; }
          }
          out.push(SIMPLE_ESCAPES[e] !== undefined ? SIMPLE_ESCAPES[e] : e);
          i += 2;
          continue;
        }
        if (c === 10) { st.error = st.error || jsonError('Unterminated string', start, text, 'string'); i = st.len; break; }
        if (c < 32) st.issues.controlChars++;
        out.push(text.charAt(i));
        i++;
      }
      if (q === 39) { st.issues.singleQuotes++; if (i < st.len && text.charCodeAt(i) === 39) i++; }
      if (i >= st.len && !st.error) st.error = jsonError('Unterminated string', start, text, 'string');
      return out.join('');
    }
    function num() {
      const start = i;
      if (text.charCodeAt(i) === 45) i++;
      if (text.startsWith('Infinity', i)) { i += 8; st.issues.nanInfinity++; return text.slice(start, i); }
      while (i < st.len && isDigit(text.charCodeAt(i))) i++;
      if (text.charCodeAt(i) === 46) { i++; while (i < st.len && isDigit(text.charCodeAt(i))) i++; }
      const c = text.charCodeAt(i);
      if (c === 101 || c === 69) {
        i++;
        if (text.charCodeAt(i) === 43 || text.charCodeAt(i) === 45) i++;
        while (i < st.len && isDigit(text.charCodeAt(i))) i++;
      }
      return text.slice(start, i);
    }
    function value() {
      if (hk.shouldStop && st.nodes % hk.yieldEvery === 0 && safeStop(hk)) { st.stopped = true; return; }
      ws();
      if (i >= st.len) { if (!st.error) st.error = jsonError('Unexpected end of input', i, text, 'eof'); return; }
      st.nodes++;
      if (st.depth > st.maxDepth) st.maxDepth = st.depth;
      const c = text.charCodeAt(i);
      if (c === 123) {
        st.types.object++; st.objects++; st.depth++;
        const frame = { o: true, keys: Object.create(null) };
        stack.push(frame);
        pathParts.push({});
        i++;
        ws();
        if (text.charCodeAt(i) === 125) { i++; stack.pop(); pathParts.pop(); st.depth--; return; }
        while (i <= st.len) {
          ws();
          if (i >= st.len) { st.error = st.error || jsonError('Unexpected end of input inside object', i, text, 'eof'); break; }
          if (text.charCodeAt(i) === 125) { i++; st.depth--; stack.pop(); pathParts.pop(); return; }
          let key;
          if (text.charCodeAt(i) === 34 || text.charCodeAt(i) === 39) {
            const s = str();
            key = s;
          } else if (isIdStart(text.charCodeAt(i))) {
            st.issues.unquotedKeys++;
            const s = i;
            while (i < st.len && (isIdPart(text.charCodeAt(i)) || text.charCodeAt(i) === 45)) i++;
            key = text.slice(s, i);
          } else { st.error = st.error || jsonError('Expected object key, found "' + text.charAt(i) + '"', i, text, 'key'); break; }
          if (key.length > st.maxKeyLength) st.maxKeyLength = key.length;
          const frame2 = stack[stack.length - 1];
          frame2.keys[key] = (frame2.keys[key] || 0) + 1;
          if (frame2.keys[key] === 2) st.dupKeys.push({ path: curPath(), name: key, count: 2 });
          else if (frame2.keys[key] > 2) {
            for (const d of st.dupKeys) if (d.path === curPath() && d.name === key) d.count = frame2.keys[key];
          }
          st.keys++;
          pathParts[pathParts.length - 1].key = key;
          ws();
          if (text.charCodeAt(i) !== 58) { st.error = st.error || jsonError('Expected ":" after key', i, text, 'colon'); break; }
          i++;
          value();
          if (st.stopped) { stack.pop(); pathParts.pop(); st.depth--; return; }
          ws();
          if (text.charCodeAt(i) === 44) { i++; ws(); if (text.charCodeAt(i) === 125) { st.issues.trailingComma++; i++; st.depth--; stack.pop(); pathParts.pop(); return; } continue; }
          if (text.charCodeAt(i) === 125) { i++; st.depth--; stack.pop(); pathParts.pop(); return; }
          st.error = st.error || jsonError('Expected "," or "}" in object', i, text, 'comma');
          break;
        }
        return;
      }
      if (c === 91) {
        st.types.array++; st.arrays++; st.depth++;
        stack.push({ o: false });
        pathParts.push({ idx: 0 });
        i++;
        ws();
        if (text.charCodeAt(i) === 93) { i++; stack.pop(); pathParts.pop(); st.depth--; return; }
        for (;;) {
          value();
          if (st.stopped) { stack.pop(); pathParts.pop(); st.depth--; return; }
          ws();
          if (text.charCodeAt(i) === 44) {
            i++; ws();
            if (text.charCodeAt(i) === 93) { st.issues.trailingComma++; i++; st.depth--; stack.pop(); pathParts.pop(); return; }
            pathParts[pathParts.length - 1].idx++;
            continue;
          }
          if (text.charCodeAt(i) === 93) { i++; st.depth--; stack.pop(); pathParts.pop(); return; }
          st.error = st.error || jsonError('Expected "," or "]" in array', i, text, 'comma');
          break;
        }
        return;
      }
      if (c === 34 || c === 39) { str(); st.types.string++; return; }
      if (c === 45 || isDigit(c)) {
        const r = num();
        st.types.number++;
        const digits = r.replace(/[-+.eE]/g, '').length;
        if (digits > 15) st.numbersLong++;
        if (st.numbersSample.length < 120) st.numbersSample.push({ path: curPath(), value: r, len: r.length });
        return;
      }
      for (const w of ['true', 'false', 'null', 'NaN', 'Infinity', 'None', 'True', 'False']) {
        if (text.startsWith(w, i)) {
          i += w.length;
          if (w === 'true' || w === 'false' || w === 'True' || w === 'False') st.types.boolean++;
          else if (w === 'null' || w === 'None') st.types.null++;
          else { st.types.number++; st.issues.nanInfinity++; }
          if (w === 'None' || w === 'True' || w === 'False') st.issues.pythonLiterals = (st.issues.pythonLiterals || 0) + 1;
          return;
        }
      }
      st.error = st.error || jsonError('Unexpected token "' + text.charAt(i) + '"', i, text, 'token');
      i = st.len;
    }

    value();
    if (!st.error && !st.stopped) {
      ws();
      if (i < st.len) st.error = jsonError('Unexpected trailing content "' + text.charAt(i) + '"', i, text, 'trailing');
    }
    if (st.depth !== 0 && !st.error) st.error = jsonError('Unexpected end of input: ' + st.depth + ' container(s) still open', st.len, text, 'eof');
    reportProgress(hk, st.len, st.len);
    st.stats = {
      bytes: st.len, depth: st.maxDepth, keys: st.keys, nodes: st.nodes, arrays: st.arrays,
      objects: st.objects, maxKeyLength: st.maxKeyLength, types: st.types, dupKeys: st.dupKeys.slice(0, 200),
      numbersLong: st.numbersLong, lines: countNewlines(text) + 1, streamed: true
    };
    return st;
  }

  // ---- streaming pretty printer -------------------------------------------
  // A resumable, explicit-stack JSON machine: feed() accepts arbitrary slices (chunk
  // boundaries may fall inside strings, numbers or keywords) and returns finished output
  // lines so the UI can append progressively without ever holding the whole document tree.
  function parseJsonPath(expr) {
    const segs = [];
    const s = String(expr == null ? '' : expr).trim();
    if (!s) return segs;
    let i = 0;
    if (s.charCodeAt(0) === 36) i = 1;
    if (s.charCodeAt(i) === 46 && s.charCodeAt(i + 1) === 46) { segs.push({ t: 'recur', name: readName(i + 2) }); return segs; }
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 46) { i++; const name = readName(i); if (name) segs.push({ t: 'key', name: name }); i = skipName(i); continue; }
      if (c === 91) {
        const close = s.indexOf(']', i);
        if (close < 0) { const name = readName(i + 1); if (name) segs.push({ t: 'key', name: name }); break; }
        const inner = s.slice(i + 1, close).trim();
        if (inner === '*') segs.push({ t: 'star' });
        else if (/^-?\d+$/.test(inner)) segs.push({ t: 'index', i: parseInt(inner, 10) });
        else segs.push({ t: 'key', name: inner.replace(/^['"]|['"]$/g, '') });
        i = close + 1;
        continue;
      }
      const name = readName(i);
      if (!name) break;
      segs.push({ t: 'key', name: name });
      i = skipName(i);
    }
    return segs;
    function readName(from) {
      let k = from;
      while (k < s.length && s.charCodeAt(k) !== 46 && s.charCodeAt(k) !== 91 && s.charCodeAt(k) !== 93) k++;
      return s.slice(from, k).replace(/^['"]|['"]$/g, '');
    }
    function skipName(from) {
      let k = from;
      while (k < s.length && s.charCodeAt(k) !== 46 && s.charCodeAt(k) !== 91) k++;
      return k;
    }
  }

  function LineWriter(unit, compact) {
    this.unit = unit;
    this.compact = compact;
    this.buf = '';
    this.level = 0;
    this.started = false;
    this.out = [];
    this.bytes = 0;
    this.lines = 0;
  }
  LineWriter.prototype.newline = function (level) {
    this.flush();
    this.level = level < 0 ? 0 : level;
    this.started = true;
  };
  LineWriter.prototype.text = function (s) {
    if (!s) return;
    this.buf += s;
    this.bytes += s.length;
  };
  LineWriter.prototype.flush = function () {
    if (!this.started && !this.buf) return;
    const line = this.unit.repeat(this.level) + this.buf;
    this.out.push(line + '\n');
    this.lines++;
    this.buf = '';
    this.started = false;
  };

  const NEED = { need: true };

  function JsonStreamPrinter(opts, hooks) {
    opts = opts || {};
    this.unit = indentUnit(opts.indent === undefined ? 2 : opts.indent);
    this.compact = !!opts.compact;
    this.ensureAscii = !!opts.ensureAscii;
    this.segs = opts.rootFilter ? parseJsonPath(opts.rootFilter) : [];
    this.hasFilter = this.segs.length > 0;
    this.maxDepth = opts.maxDepth || 4096;
    this.w = new LineWriter(this.unit, this.compact);
    this.stack = [];
    this.state = 'value';
    this.buf = '';
    this.i = 0;
    this.base = 0;
    this.totalFed = 0;
    this.hk = mkHooks(hooks);
    this.error = null;
    this.stopped = false;
    this.done = false;
    this.prettyLevel = 0;
    this.pendingMembers = 0;
    this.issues = { trailingComma: 0, singleQuotes: 0, unquotedKeys: 0, comments: 0, nanInfinity: 0, pythonLiterals: 0 };
    this.stats = {
      bytes: 0, keys: 0, nodes: 0, objects: 0, arrays: 0, depth: 0, maxDepth: 0,
      numbersLong: 0, dupKeys: [], maxKeyLength: 0, lines: 0, chunks: 0,
      types: { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 }
    };
    this.pathParts = [];
    this.hasBOM = false;
  }
  JsonStreamPrinter.prototype.err = function (msg, at, kind) {
    if (this.error) return;
    const pos = this.base + at;
    this.error = { message: msg, kind: kind || 'syntax', line: 0, column: 0, position: pos, contextSnippet: '' };
    const lc = lineColAt(this.bufFull || '', pos);
    this.error.line = lc.line;
    this.error.column = lc.column;
  }
  ;
  JsonStreamPrinter.prototype.pathLabel = function () {
    let p = '$';
    for (const s of this.pathParts) p += s.key === undefined ? '[' + s.idx + ']' : '.' + s.key;
    return p;
  };
  JsonStreamPrinter.prototype.feed = function (chunk) {
    this.w.out.length = 0;
    this.buf = this.buf ? this.buf + chunk : chunk;
    this.totalFed += chunk.length;
    this.bufFull = this.buf;
    this.run(false);
    const out = this.w.out.slice();
    this.w.out.length = 0;
    this.compactBuf();
    return out;
  };
  JsonStreamPrinter.prototype.end = function () {
    this.w.out.length = 0;
    this.bufFull = this.buf;
    this.run(true);
    if (!this.error && !this.stopped) {
      this.skipWs(true);
      if (this.i < this.buf.length && !this.done) this.err('Unexpected trailing content "' + this.buf.charAt(this.i) + '"', this.i, 'trailing');
    }
    if (this.stack.length && !this.error) {
      this.err('Unexpected end of input: ' + this.stack.length + ' container(s) still open', this.buf.length, 'eof');
    }
    this.w.flush();
    const out = this.w.out.slice();
    this.w.out.length = 0;
    this.stats.bytes = this.stats.bytesOut;
    this.stats.lines = this.linesEmitted || 0;
    return out;
  };
  JsonStreamPrinter.prototype.compactBuf = function () {
    if (this.i > 0) {
      this.base += this.i;
      this.buf = this.buf.slice(this.i);
      this.i = 0;
    }
  };
  JsonStreamPrinter.prototype.atEnd = function () {
    return this.i >= this.buf.length;
  };
  JsonStreamPrinter.prototype.skipWs = function (final) {
    let comments = 0;
    for (;;) {
      while (this.i < this.buf.length) {
        const c = this.buf.charCodeAt(this.i);
        if (c === 32 || c === 9 || c === 10 || c === 13) { this.i++; continue; }
        break;
      }
      if (this.i >= this.buf.length) return;
      if (this.buf.charCodeAt(this.i) === 47) {
        if (this.i + 1 >= this.buf.length && !final) return;
        const c2 = this.buf.charCodeAt(this.i + 1);
        if (c2 === 47) {
          this.i += 2;
          while (this.i < this.buf.length && this.buf.charCodeAt(this.i) !== 10) this.i++;
          if (this.i >= this.buf.length && !final) return;
          comments++;
          continue;
        }
        if (c2 === 42) {
          const start = this.i;
          this.i += 2;
          let closed = false;
          while (this.i < this.buf.length) {
            if (this.buf.charCodeAt(this.i) === 42 && this.buf.charCodeAt(this.i + 1) === 47) { this.i += 2; closed = true; break; }
            this.i++;
          }
          if (!closed) {
            if (!final) { this.i = start; return; }
            this.err('Unterminated block comment', start, 'comment');
            return;
          }
          comments++;
          continue;
        }
      }
      return;
    }
  };
  JsonStreamPrinter.prototype.readString = function () {
    const start = this.i;
    const q = this.buf.charCodeAt(start);
    let k = start + 1;
    const chars = [];
    let terminated = false;
    while (k < this.buf.length) {
      const c = this.buf.charCodeAt(k);
      if (c === 92) {
        if (k + 1 >= this.buf.length) return NEED;
        const e = this.buf.charAt(k + 1);
        if (e === 'u' || e === 'x') {
          const wid = e === 'u' ? 4 : 2;
          if (k + 2 + wid > this.buf.length) return NEED;
          const d = this.buf.substr(k + 2, wid);
          if (/^[0-9a-fA-F]+$/.test(d)) { chars.push(String.fromCharCode(parseInt(d, 16))); k += 2 + wid; continue; }
          chars.push(e); k += 2; continue;
        }
        chars.push(SIMPLE_ESCAPES[e] !== undefined ? SIMPLE_ESCAPES[e] : (e === '\n' ? '' : e));
        k += 2;
        continue;
      }
      if (c === q) { terminated = true; k++; break; }
      if (c === 10) { this.err('Unterminated string', start, 'string'); this.i = this.buf.length; return null; }
      chars.push(this.buf.charAt(k));
      k++;
    }
    if (!terminated) return NEED;
    this.i = k;
    if (q === 39) {
      this.issues.singleQuotes++;
      if (this.buf.charCodeAt(k) === 39) { this.i = k + 1; }
    }
    return chars.join('');
  };
  JsonStreamPrinter.prototype.readNumber = function (final) {
    const start = this.i;
    let k = start;
    if (this.buf.charCodeAt(k) === 45 || this.buf.charCodeAt(k) === 43) k++;
    if (this.buf.startsWith('Infinity', k)) {
      if (k + 8 > this.buf.length && !final) return NEED;
      this.i = k + 8;
      this.issues.nanInfinity++;
      return (this.buf.charCodeAt(start) === 45 ? '-' : '') + '"Infinity"';
    }
    while (k < this.buf.length && isDigit(this.buf.charCodeAt(k))) k++;
    if (this.buf.charCodeAt(k) === 46) {
      k++;
      if (k >= this.buf.length && !final) return NEED;
      while (k < this.buf.length && isDigit(this.buf.charCodeAt(k))) k++;
    }
    const ec = this.buf.charCodeAt(k);
    if (ec === 101 || ec === 69) {
      k++;
      if (k >= this.buf.length && !final) return NEED;
      if (this.buf.charCodeAt(k) === 43 || this.buf.charCodeAt(k) === 45) {
        k++;
        if (k >= this.buf.length && !final) return NEED;
      }
      while (k < this.buf.length && isDigit(this.buf.charCodeAt(k))) k++;
    }
    if (k >= this.buf.length && !final) return NEED;
    if (k === start) return null;
    const raw = this.buf.slice(start, k);
    this.i = k;
    if (raw.charCodeAt(0) === 43) return raw.slice(1);
    return raw;
  };
  JsonStreamPrinter.prototype.readWord = function (final) {
    const start = this.i;
    let k = start;
    while (k < this.buf.length && /[A-Za-z_\-]/.test(this.buf.charAt(k))) k++;
    if (k >= this.buf.length && !final) return NEED;
    const word = this.buf.slice(start, k);
    this.i = k;
    return word;
  };

  JsonStreamPrinter.prototype.frameLevel = function () { return this.prettyLevel; };

  JsonStreamPrinter.prototype.run = function (final) {
    const hk = this.hk;
    for (;;) {
      if (this.error || this.stopped) return;
      if (hk.shouldStop && (this.stats.nodes % hk.yieldEvery === 0) && safeStop(hk)) { this.stopped = true; return; }
      this.bufFull = this.buf;
      const r = this.step(final);
      if (r === NEED) {
        if (final) { this.err('Unexpected end of input inside a ' + this.state, this.i, 'eof'); return; }
        return;
      }
      if (r === 'halt') return;
      if (this.i > this.buf.length) this.i = this.buf.length;
    }
  };

  JsonStreamPrinter.prototype.step = function (final) {
    const st = this.state;
    if (st === 'value') return this.doValue(final);
    if (st === 'objKey') return this.doObjKey(final);
    if (st === 'objColon') return this.doObjColon(final);
    if (st === 'sep') return this.doSep(final);
    if (st === 'arrValue') return this.doArrValue(final);
    if (st === 'comma') return this.doComma(final);
    if (st === 'objMember') {
      const f = this.stack[this.stack.length - 1];
      this.skipWs(final);
      if (this.i >= this.buf.length) {
        if (final) { this.err('Unexpected end of input in object', this.i, 'eof'); return 'halt'; }
        return NEED;
      }
      return this.objMember(f, final);
    }
    if (st === 'rootDone') {
      this.skipWs(final);
      if (this.i >= this.buf.length) return final ? 'halt' : NEED;
      this.err('Unexpected trailing content "' + this.buf.charAt(this.i) + '"', this.i, 'trailing');
      return 'halt';
    }
    this.err('Internal state error at ' + st, this.i, 'internal');
    return 'halt';
  };

  JsonStreamPrinter.prototype.doValue = function (final) {
    this.skipWs(final);
    if (this.i >= this.buf.length) {
      if (!final) return NEED;
      this.err('Unexpected end of input expecting a value', this.i, 'eof');
      return 'halt';
    }
    if (this.stack.length >= this.maxDepth) {
      this.err('Maximum nesting depth exceeded (' + this.maxDepth + ')', this.i, 'depth');
      return 'halt';
    }
    const c = this.buf.charCodeAt(this.i);
    if (c === 123 || c === 91) {
      const kind = c === 123 ? 'o' : 'a';
      const parent = this.stack.length ? this.stack[this.stack.length - 1] : null;
      const inside = !parent ? false : parent.inside;
      const active = !parent ? 0 : parent.active;
      const pretty = this.computePretty(kind, active, inside, parent);
      const frame = {
        kind: kind, pretty: pretty, inside: inside || (this.segs.length > 0 && active + 1 >= this.segs.length && pretty),
        active: active, empty: true, idx: 0, keys: Object.create(null)
      };
      this.stack.push(frame);
      this.stats.nodes++;
      this.stats.types[kind === 'o' ? 'object' : 'array']++;
      this.stats[kind === 'o' ? 'objects' : 'arrays']++;
      if (this.stack.length > this.stats.maxDepth) this.stats.maxDepth = this.stack.length;
      this.stats.depth = this.stats.maxDepth;
      this.i++;
      this.w.text(kind === 'o' ? '{' : '[');
      this.state = kind === 'o' ? 'objKey' : 'arrValue';
      return;
    }
    if (c === 34 || c === 39) {
      const s = this.readString();
      if (s === NEED) return NEED;
      if (s === null) return 'halt';
      this.w.text(encodeStringLit(s, '"', this.ensureAscii));
      this.stats.types.string++;
      this.stats.nodes++;
      this.state = 'sep';
      return;
    }
    if (c === 45 || c === 43 || isDigit(c)) {
      const n = this.readNumber(final);
      if (n === NEED) return NEED;
      if (n === null) { this.err('Invalid number at "' + this.buf.substr(this.i, 12) + '"', this.i, 'number'); return 'halt'; }
      this.w.text(n);
      this.stats.types.number++;
      this.stats.nodes++;
      const digits = n.replace(/[-+.eE"]|Infinity/g, '').length;
      if (digits > 15) this.stats.numbersLong++;
      this.state = 'sep';
      return;
    }
    const word = this.readWord(final);
    if (word === NEED) return NEED;
    const map = { None: 'null', True: 'true', False: 'false' };
    if (map[word] !== undefined) {
      this.issues.pythonLiterals++;
      this.w.text(map[word]);
      this.stats.types[word === 'None' ? 'null' : 'boolean']++;
      this.stats.nodes++;
      this.state = 'sep';
      return;
    }
    if (word === 'true' || word === 'false' || word === 'null') {
      this.w.text(word);
      this.stats.types[word === 'null' ? 'null' : 'boolean']++;
      this.stats.nodes++;
      this.state = 'sep';
      return;
    }
    if (word === 'NaN' || word === 'Infinity' || word === '-Infinity') {
      this.issues.nanInfinity++;
      this.w.text(word === 'NaN' ? 'null' : '"' + word + '"');
      this.stats.nodes++;
      this.state = 'sep';
      return;
    }
    if (isIdStart(c)) {
      this.issues.unquotedKeys++;
      const s = this.i;
      while (this.i < this.buf.length && (isIdPart(this.buf.charCodeAt(this.i)) || this.buf.charCodeAt(this.i) === 45 || this.buf.charCodeAt(this.i) === 46)) this.i++;
      const name = this.buf.slice(s, this.i);
      const save = this.i;
      this.skipWs(final);
      if (this.buf.charCodeAt(this.i) === 58) {
        this.i = save;
        this.w.text(encodeStringLit(name, '"', this.ensureAscii));
        this.state = 'objColon';
        return;
      }
      this.i = save;
      this.err('Unexpected token "' + name + '" expecting a value', s, 'token');
      return 'halt';
    }
    this.err('Unexpected token "' + this.buf.charAt(this.i) + '" expecting a value', this.i, 'token');
    return 'halt';
  };

  JsonStreamPrinter.prototype.computePretty = function (kind, active, inside, parent) {
    if (this.compact) return false;
    if (!this.hasFilter) return true;
    if (inside) return true;
    if (!parent) return true;
    return parent.pretty && active > 0;
  };

  JsonStreamPrinter.prototype.doObjKey = function (final) {
    const frame = this.stack[this.stack.length - 1];
    this.skipWs(final);
    if (this.i >= this.buf.length) return final ? (this.err('Unexpected end of input in object', this.i, 'eof'), 'halt') : NEED;
    const c = this.buf.charCodeAt(this.i);
    if (c === 125) {
      this.i++;
      if (frame.empty) this.w.text('}');
      else {
        if (frame.pretty) { this.prettyLevel--; this.w.newline(this.prettyLevel); }
        this.w.text('}');
      }
      this.popFrame(frame);
      this.state = 'sep';
      return;
    }
    if (!frame.empty) {
      this.err('Expected "," or "}" in object, found "' + this.buf.charAt(this.i) + '"', this.i, 'comma');
      return 'halt';
    }
    return this.objMember(frame, final);
  };

  JsonStreamPrinter.prototype.objMember = function (frame, final) {
    const c = this.buf.charCodeAt(this.i);
    let key = null;
    if (c === 34 || c === 39) {
      const s = this.readString();
      if (s === NEED) return NEED;
      if (s === null) return 'halt';
      key = s;
    } else if (isIdStart(c)) {
      const s = this.i;
      let k = s;
      while (k < this.buf.length && (isIdPart(this.buf.charCodeAt(k)) || this.buf.charCodeAt(k) === 45 || this.buf.charCodeAt(k) === 46)) k++;
      if (k >= this.buf.length && !final) return NEED;
      key = this.buf.slice(s, k);
      this.i = k;
      if (c !== 34 && c !== 39) this.issues.unquotedKeys++;
    } else {
      this.err('Expected a string key in object, found "' + this.buf.charAt(this.i) + '"', this.i, 'key');
      return 'halt';
    }
    frame.empty = false;
    this.stats.keys++;
    if (key.length > this.stats.maxKeyLength) this.stats.maxKeyLength = key.length;
    frame.keys[key] = (frame.keys[key] || 0) + 1;
    if (frame.keys[key] === 2) this.stats.dupKeys.push({ path: this.pathLabel(), name: key, count: 2 });
    else if (frame.keys[key] > 2) {
      for (const d of this.stats.dupKeys) if (d.path === this.pathLabel() && d.name === key) d.count = frame.keys[key];
    }
    const seg = this.hasFilter && !frame.inside ? this.segs[frame.active] : null;
    const stepMatch = !!seg && ((seg.t === 'key' && seg.name === key) || seg.t === 'star');
    frame.active = stepMatch ? frame.active + 1 : frame.active;
    if (stepMatch && this.segs.length && frame.active >= this.segs.length) frame.inside = true;
    const pathFrame = this.pathParts[this.pathParts.length - 1];
    if (pathFrame && pathFrame.frame === frame) pathFrame.key = key;
    else this.pathParts.push({ key: key, frame: frame });
    if (frame.pretty && !this.compact) {
      if (!frame.levelOn) {
        this.prettyLevel++;
        frame.levelOn = true;
      }
      this.w.newline(this.prettyLevel);
    }
    this.w.text(encodeStringLit(key, '"', this.ensureAscii));
    this.state = 'objColon';
    void c;
    return;
  };

  JsonStreamPrinter.prototype.doObjColon = function (final) {
    const frame = this.stack[this.stack.length - 1];
    this.skipWs(final);
    if (this.i >= this.buf.length) return final ? (this.err('Unexpected end of input: expected ":"', this.i, 'eof'), 'halt') : NEED;
    if (this.buf.charCodeAt(this.i) === 58) this.i++;
    else if (this.buf.charCodeAt(this.i) === 61) { this.i++; this.err('Found "=" where ":" was expected in object', this.i - 1, 'colon'); return 'halt'; }
    else { this.err('Expected ":" after object key', this.i, 'colon'); return 'halt'; }
    if (frame.pretty && !this.compact) this.w.text(': ');
    else this.w.text(':');
    this.state = 'value';
    return;
  };

  JsonStreamPrinter.prototype.doSep = function (final) {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) { this.state = 'rootDone'; return; }
    this.skipWs(final);
    if (this.i >= this.buf.length) return final ? (this.err('Unexpected end of input', this.i, 'eof'), 'halt') : NEED;
    const closer = frame.kind === 'o' ? 125 : 93;
    const c = this.buf.charCodeAt(this.i);
    if (c === 44) {
      this.i++;
      frame.empty = false;
      frame.cw = false;
      this.state = 'comma';
      return this.doComma(final);
    }
    if (c === closer) {
      this.i++;
      if (frame.levelOn) this.prettyLevel--;
      if (frame.empty) this.w.text(frame.kind === 'o' ? '}' : ']');
      else {
        if (frame.pretty && !this.compact) this.w.newline(this.prettyLevel);
        this.w.text(frame.kind === 'o' ? '}' : ']');
      }
      this.popFrame(frame);
      this.state = 'sep';
      return;
    }
    this.err('Expected ' + (frame.kind === 'o' ? '"," or "}"' : '"," or "]"') + ', found "' + this.buf.charAt(this.i) + '"', this.i, 'comma');
    return 'halt';
  };

  JsonStreamPrinter.prototype.doComma = function (final) {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) { this.state = 'rootDone'; return; }
    const closer = frame.kind === 'o' ? 125 : 93;
    if (frame.kind === 'a') this.pathParts[this.pathParts.length - 1] = { idx: frame.idx, frame: frame };
    if (!frame.cw) {
      /* 逗号是结构符，任何模式都必须输出；只有换行/缩进才跟 pretty 走。
         旧实现把逗号也挂在 pretty 上，导致 >5MB 走流式压缩时输出
         {"a":1"b":2} 这种非法 JSON。 */
      this.w.text(',');
      frame.cw = true;
    }
    this.skipWs(final);
    if (this.i >= this.buf.length) {
      if (final) { this.err('Unexpected end of input after ","', this.i, 'eof'); return 'halt'; }
      return NEED;
    }
    if (this.buf.charCodeAt(this.i) === closer) {
      this.issues.trailingComma++;
      this.i++;
      frame.cw = false;
      if (frame.levelOn) this.prettyLevel--;
      if (frame.pretty && !this.compact && !frame.empty) this.w.newline(this.prettyLevel);
      this.w.text(frame.kind === 'o' ? '}' : ']');
      this.popFrame(frame);
      this.state = 'sep';
      return;
    }
    frame.cw = false;
    if (frame.kind === 'o') { this.state = 'objMember'; return this.objMember(frame, final); }
    frame.emptyStarted = false;
    this.state = 'arrValue';
    return this.doArrValue(final);
  };

  JsonStreamPrinter.prototype.objMemberFromState = function (final) {
    const frame = this.stack[this.stack.length - 1];
    this.skipWs(final);
    if (this.i >= this.buf.length) return final ? (this.err('Unexpected end of input in object', this.i, 'eof'), 'halt') : NEED;
    if (this.buf.charCodeAt(this.i) === 125) {
      this.issues.trailingComma++;
      this.i++;
      if (frame.levelOn) this.prettyLevel--;
      if (frame.pretty) this.w.newline(this.prettyLevel);
      this.w.text('}');
      this.popFrame(frame);
      this.state = 'sep';
      return;
    }
    return this.objMember(frame, final);
  };

  JsonStreamPrinter.prototype.doArrValue = function (final) {
    const frame = this.stack[this.stack.length - 1];
    this.skipWs(final);
    if (this.i >= this.buf.length) {
      if (final) {
        this.err('Unexpected end of input inside an array', this.i, 'eof');
        return 'halt';
      }
      return NEED;
    }
    if (frame && this.buf.charCodeAt(this.i) === 93) {
      this.i++;
      if (frame.levelOn) this.prettyLevel--;
      this.w.text(']');
      this.popFrame(frame);
      this.state = 'sep';
      return;
    }
    if (frame && frame.pretty && !this.compact) {
      if (!frame.levelOn) {
        this.prettyLevel++;
        frame.levelOn = true;
      }
      if (!frame.emptyStarted) {
        this.w.newline(this.prettyLevel);
        frame.emptyStarted = true;
      }
    }
    frame.empty = false;
    this.state = 'value';
    return this.doValue(final);
  };

  JsonStreamPrinter.prototype.popFrame = function (frame) {
    const at = this.stack.lastIndexOf(frame);
    if (at >= 0) this.stack.splice(at, 1);
    const pp = this.pathParts[this.pathParts.length - 1];
    if (pp && pp.frame === frame) this.pathParts.pop();
    if (!this.stack.length) {
      this.state = 'rootDone';
      if (frame.pretty && !this.compact) { /* keep level */ }
    }
  };

  function streamDrive(src, printer, hooks, opts) {
    const hk = printer.hk;
    const chunks = [];
    let lines = 0;
    let bytesOut = 0;
    let stopped = false;
    const onChunk = typeof opts.onChunk === 'function' ? opts.onChunk : null;
    const maxChunks = opts.maxOutputChunks || 0;
    const step = Math.max(4096, opts.chunkSize || CHUNK_SIZE);
    let off = 0;
    function take(linesArr) {
      for (let k = 0; k < linesArr.length; k++) {
        lines++;
        bytesOut += linesArr[k].length;
      }
      if (!linesArr.length) return;
      if (onChunk) { try { onChunk(linesArr.join('')); } catch (e) {} }
      if (maxChunks && chunks.length >= maxChunks) { stopped = true; return; }
      for (const l of linesArr) chunks.push(l);
    }
    while (off < src.length) {
      const slice = src.slice(off, off + step);
      off += slice.length;
      take(printer.feed(slice));
      if (printer.error || printer.stopped || stopped) { stopped = stopped || printer.stopped; break; }
      if (hk.progress && off % (step * 4) < step) reportProgress(hk, off, src.length);
    }
    if (!stopped && !printer.error) take(printer.end());
    else if (printer.stopped || stopped) {
      printer.stopped = true;
    }
    printer.linesEmitted = lines;
    printer.stats.bytesOut = bytesOut;
    if (hk.progress) reportProgress(hk, src.length, src.length);
    return { chunks: chunks, stopped: stopped || printer.stopped, lines: lines, bytesOut: bytesOut };
  }

  function jsonStreamFormat(text, hooks, opts) {
    opts = opts || {};
    const src = String(text == null ? '' : text);
    const printer = new JsonStreamPrinter(opts, hooks);
    printer.bufFull = src;
    const run = streamDrive(src, printer, printer.hk, opts);
    const error = printer.error ? decorateStreamError(printer.error, src) : null;
    const stats = printer.stats;
    stats.inBytes = src.length;
    stats.bytes = run.bytesOut;
    stats.lines = run.lines;
    stats.chunks = run.chunks.length;
    stats.error = error;
    stats.issues = printer.issues;
    stats.hasBOM = src.charCodeAt(0) === 0xfeff;
    stats.trailingComma = printer.issues.trailingComma;
    stats.singleQuotes = printer.issues.singleQuotes;
    stats.unquotedKeys = printer.issues.unquotedKeys;
    stats.comments = printer.issues.comments;
    stats.dupKeys = stats.dupKeys.slice(0, 200);
    return {
      chunks: run.chunks,
      text: null,
      stats: stats,
      error: error,
      issues: printer.issues,
      stopped: run.stopped,
      truncated: run.stopped || !!error,
      outPathHint: run.stopped
        ? 'stopped early: ' + run.chunks.length + ' chunks written so far'
        : 'chunked output: ' + run.chunks.length + ' string chunks (append progressively)',
      notice: opts.rootFilter ? 'rootFilter "' + opts.rootFilter + '": matched subtree pretty-printed, sibling branches kept compact.' : null
    };
  }

  function decorateStreamError(error, src) {
    if (!error) return null;
    const lc = lineColAt(src, error.position);
    return {
      message: error.message, kind: error.kind, line: lc.line, column: lc.column,
      position: error.position, contextSnippet: snippetAt(src, error.position)
    };
  }

  function jsonToLines(text, optsOrCb, cb) {
    const src = String(text == null ? '' : text);
    let opts = optsOrCb;
    let callback = cb;
    if (typeof optsOrCb === 'function') { callback = optsOrCb; opts = {}; }
    opts = opts || {};
    const printer = new JsonStreamPrinter(opts, opts.hooks);
    printer.bufFull = src;
    const step = Math.max(4096, opts.chunkSize || CHUNK_SIZE);
    if (callback) {
      let n = 0, stop = false;
      const emit = function (arr) {
        for (const l of arr) { n++; if (callback(l, n) === false) { stop = true; return; } }
      };
      for (let off = 0; off < src.length && !stop && !printer.error; off += step) {
        const slice = src.slice(off, off + step);
        emit(splitLine(printer.feed(slice)));
        if (printer.stopped) break;
      }
      if (!stop && !printer.error && !printer.stopped) emit(splitLine(printer.end()));
      return { lines: n, error: printer.error ? decorateStreamError(printer.error, src) : null, stopped: printer.stopped, stats: printer.stats };
    }
    return (function* gen() {
      let n = 0;
      const partial = { s: '' };
      function* drain(arr) {
        for (const l of arr) {
          partial.s += l;
          const parts = partial.s.split('\n');
          partial.s = parts.pop();
          for (const p of parts) { n++; yield { n: n, text: p }; }
        }
      }
      for (let off = 0; off < src.length; off += step) {
        if (printer.error || printer.stopped) break;
        const slice = src.slice(off, off + step);
        yield* drain(splitLine(printer.feed(slice)));
      }
      if (!printer.error && !printer.stopped) yield* drain(splitLine(printer.end()));
      if (partial.s) { n++; yield { n: n, text: partial.s }; }
    })();
  }
  function splitLine(arr) { return arr; }

  function jsonPaths(text, opts) {
    opts = opts || {};
    const src = String(text == null ? '' : text);
    const limit = opts.limit || 2000;
    const hk = mkHooks(opts.hooks);
    const out = [];
    let truncated = false;
    let error = null;
    if (src.length > (opts.limitBytes || DEFAULT_LIMIT_BYTES)) {
      const scan = jsonStreamScan(src, hk, {});
      return {
        paths: out, truncated: true, error: scan.error,
        notice: 'File larger than limitBytes: only aggregate stats are available. Use jsonStreamFormat with rootFilter for subtree views.',
        stats: scan.stats
      };
    }
    const built = jsonBuildModel(src, hk, { lenient: true });
    error = built.error;
    if (built.root) {
      const seen = [];
      const walk = function (node, path) {
        if (!node || out.length >= limit) { truncated = true; return; }
        if (node.t === 'o') {
          for (const e of node.e) {
            if (out.length >= limit) { truncated = true; return; }
            const p = path + '.' + e[0];
            out.push({ path: p, type: jsonTypeLabel(e[1] ? e[1].t : 'k'), preview: leafPreview(e[1]), size: e[1] && (e[1].t === 'o' || e[1].t === 'a') ? e[1].e.length : null });
            walk(e[1], p);
          }
        } else if (node.t === 'a') {
          for (let k = 0; k < node.e.length; k++) {
            if (out.length >= limit) { truncated = true; return; }
            const p = path + '[' + k + ']';
            out.push({ path: p, type: jsonTypeLabel(node.e[k] ? node.e[k].t : 'k'), preview: leafPreview(node.e[k]), size: node.e[k] && (node.e[k].t === 'o' || node.e[k].t === 'a') ? node.e[k].e.length : null });
            walk(node.e[k], p);
          }
        }
        void seen;
      };
      out.push({ path: '$', type: jsonTypeLabel(built.root.t), preview: leafPreview(built.root), size: built.root.e ? built.root.e.length : null });
      walk(built.root, '$');
    }
    return { paths: out, count: out.length, truncated: truncated, error: error, limit: limit };
  }
  function leafPreview(node) {
    if (!node) return '';
    if (node.t === 's') return node.v.length > 60 ? node.v.slice(0, 59) + '…' : node.v;
    if (node.t === 'n') return node.r;
    if (node.t === 'k') return node.v;
    if (node.t === 'o') return '{' + node.e.length + ' keys}';
    if (node.t === 'a') return '[' + node.e.length + ' items]';
    return '';
  }

  function nodeToPlain(n) {
    if (!n) return null;
    switch (n.t) {
      case 'n': {
        const num = Number(n.r);
        return Number.isFinite(num) && String(num) === n.r ? num : { __jsonNumber: n.r };
      }
      case 'k': return n.v === 'null' ? null : n.v === 'true';
      case 's': return n.v;
      case 'o': {
        const o = {};
        for (const e of n.e) o[e[0]] = nodeToPlain(e[1]);
        return o;
      }
      case 'a': return n.e.map(nodeToPlain);
      default: return null;
    }
  }

  function collectMatches(node, segs, si, path, out, opts, depth) {
    if (!node || depth > 5000) return;
    if (si >= segs.length) {
      out.push({ path: path, node: node, value: nodeToPlain(node) });
      return;
    }
    const seg = segs[si];
    if (seg.t === 'recur') {
      /* 递归下降：遍历每个节点一次，在对象节点上比对键名。
         原实现分三段各递归一遍（还混用 si / si+1），同一个命中会被重复计入，
         `$..id` 对 2 个 id 能报出 24 条。 */
      const visit = (n, p, d) => {
        if (!n || d > 5000) return;
        if (n.t === 'o') {
          for (const e of n.e) {
            const np = p + '.' + e[0];
            if (e[0] === seg.name) collectMatches(e[1], segs, si + 1, np, out, opts, d + 1);
            visit(e[1], np, d + 1);
          }
        } else if (n.t === 'a') {
          for (let k = 0; k < n.e.length; k++) visit(n.e[k], p + '[' + k + ']', d + 1);
        }
      };
      visit(node, path, depth);
      return;
    }
    if (seg.t === 'star') {
      for (const c of childSteps(node)) collectMatches(c.node, segs, si + 1, path + c.step, out, opts, depth + 1);
      return;
    }
    if (node.t === 'o') {
      for (const e of node.e) {
        if (e[0] === seg.name) {
          if (seg.next) { collectMatches(e[1], [seg.next], 0, path + '.' + seg.name, out, opts, depth + 1); }
          else collectMatches(e[1], segs, si + 1, path + '.' + seg.name, out, opts, depth + 1);
        }
      }
      return;
    }
    if (node.t === 'a') {
      if (seg.t === 'index') {
        const idx = seg.i < 0 ? node.e.length + seg.i : seg.i;
        if (idx >= 0 && idx < node.e.length) collectMatches(node.e[idx], segs, si + 1, path + '[' + idx + ']', out, opts, depth + 1);
      }
      return;
    }
  }
  function hasKey(node, name) {
    if (!node || node.t !== 'o') return false;
    for (const e of node.e) if (e[0] === name) return true;
    return false;
  }
  function childSteps(node) {
    const list = [];
    if (!node) return list;
    if (node.t === 'o') for (const e of node.e) list.push({ node: e[1], step: '.' + e[0] });
    else if (node.t === 'a') for (let k = 0; k < node.e.length; k++) list.push({ node: node.e[k], step: '[' + k + ']' });
    return list;
  }

  /* 纯 JS 值上的 JSONPath 匹配：与 collectMatches 的语义保持一致
     （$.a.b / $.list[*].id / $..key / [0] / 负下标），只是不做模型树。 */
  function collectPlainMatches(v, segs, si, path, out, depth) {
    if (depth > 5000) return;
    if (si >= segs.length) { out.push({ path: path, value: v }); return; }
    const seg = segs[si];
    if (seg.t === 'recur') {
      const walk = (n, p, d) => {
        if (!n || typeof n !== 'object' || d > 5000) return;
        if (Array.isArray(n)) { for (let k = 0; k < n.length; k++) walk(n[k], p + '[' + k + ']', d + 1); return; }
        const keys = Object.keys(n);
        for (let ki = 0; ki < keys.length; ki++) {
          const k = keys[ki];
          const np = p + '.' + k;
          if (k === seg.name) collectPlainMatches(n[k], segs, si + 1, np, out, d + 1);
          walk(n[k], np, d + 1);
        }
      };
      walk(v, path, depth);
      return;
    }
    if (seg.t === 'star') {
      if (Array.isArray(v)) {
        for (let k = 0; k < v.length; k++) collectPlainMatches(v[k], segs, si + 1, path + '[' + k + ']', out, depth + 1);
      } else if (v && typeof v === 'object') {
        const keys = Object.keys(v);
        for (let k = 0; k < keys.length; k++) collectPlainMatches(v[keys[k]], segs, si + 1, path + '.' + keys[k], out, depth + 1);
      }
      return;
    }
    if (seg.t === 'index') {
      if (Array.isArray(v)) {
        const idx = seg.i < 0 ? v.length + seg.i : seg.i;
        if (idx >= 0 && idx < v.length) collectPlainMatches(v[idx], segs, si + 1, path + '[' + idx + ']', out, depth + 1);
      }
      return;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, seg.name)) {
      collectPlainMatches(v[seg.name], segs, si + 1, path + '.' + seg.name, out, depth + 1);
    }
  }
  function plainTypeLabel(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    const t = typeof v;
    return t === 'object' ? 'object' : t === 'string' ? 'string' : t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : t;
  }
  function plainPreview(v) {
    if (v === undefined) return 'undefined';
    let s;
    try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = String(v); }
    if (s == null) s = String(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }

  function jsonQuery(text, path, opts) {
    opts = opts || {};
    const src = String(text == null ? '' : text);
    const limit = opts.limitBytes || DEFAULT_LIMIT_BYTES;
    if (src.length > limit) {
      /* 大输入走标准 JSON.parse 直接查询：接口响应动辄几十 MB，
         用带位置信息的模型树建索引内存翻好几倍，而查询只要值。
         代价是重复键/超 2^53 整数按 JS 语义处理——查询场景可接受，且明确告知。 */
      if (src.length > 256 * 1024 * 1024) {
        return { tooLarge: true, values: [], matches: [], hint: '输入 ' + prettyBytes(src.length) + ' 超过查询上限 256MB，请先用 jq / 流式工具裁出需要的子树' };
      }
      let plain;
      try {
        plain = JSON.parse(src.charCodeAt(0) === 0xfeff ? src.slice(1) : src);
      } catch (e) {
        return { tooLarge: true, values: [], matches: [], error: e, hint: '输入 ' + prettyBytes(src.length) + ' 且不是合法 JSON：' + e.message };
      }
      const psegs = parseJsonPath(path);
      const pout = [];
      collectPlainMatches(plain, psegs, 0, '$', pout, 0);
      const pcap = opts.limit || 200;
      return {
        error: null, tooLarge: false, count: pout.length, truncated: pout.length > pcap,
        matches: pout.slice(0, pcap).map((m) => ({ path: m.path, type: plainTypeLabel(m.value), preview: plainPreview(m.value) })),
        values: pout.slice(0, pcap).map((m) => m.value),
        texts: pout.slice(0, pcap).map((m) => (typeof m.value === 'string' ? JSON.stringify(m.value) : JSON.stringify(m.value))),
        notice: '大输入（' + prettyBytes(src.length) + '）走标准解析：重复键与超 2^53 整数按 JS 语义处理',
      };
    }
    const built = jsonBuildModel(src, mkHooks(opts.hooks), { lenient: opts.lenient !== false });
    if (built.error) return { error: built.error, values: [], matches: [], tooLarge: false };
    const segs = parseJsonPath(path);
    const out = [];
    collectMatches(built.root, segs, 0, '$', out, opts, 0);
    const cap = opts.limit || 200;
    const truncated = out.length > cap;
    const sliced = out.slice(0, cap);
    const ctx = {
      unit: indentUnit(opts.indent === undefined ? 0 : opts.indent), compact: opts.compact !== false, level: 0,
      maxWidth: 0, ensureAscii: !!opts.ensureAscii, dropNulls: !!opts.dropNulls, sortKeys: false,
      keyOrder: null, keepPrecision: opts.keepNumberPrecision !== false, maxInlineItems: 1e6, keepSingleQuotes: false
    };
    return {
      error: null, tooLarge: false, count: out.length, truncated: truncated,
      matches: sliced.map(m => ({ path: m.path, type: jsonTypeLabel(m.node.t), preview: leafPreview(m.node) })),
      values: sliced.map(m => m.value),
      texts: sliced.map(m => renderRef(m.node, ctx, 0))
    };
  }

  function jsonGet(text, path, opts) {    const r = jsonQuery(text, path, opts);
    if (r.tooLarge || r.error) return r;
    const first = r.texts && r.texts[0];
    return {
      found: !!(r.matches && r.matches.length), value: r.values && r.values[0], text: first,
      path: r.matches && r.matches[0] ? r.matches[0].path : null,
      count: r.count, truncated: r.truncated, tooLarge: false, error: r.error
    };
  }

  const PY_TO_JSON_LITERAL = { None: 'null', True: 'true', False: 'false' };

  function jsonRepair(text, opts) {
    opts = opts || {};
    const src = String(text == null ? '' : text);
    const changes = [];
    const out = [];
    const len = src.length;
    let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
    if (i === 1) changes.push({ type: 'bom', line: 1, desc: 'removed UTF-8 BOM' });
    let line = 1;
    const openStack = [];
    let pendingComma = null; // {at, line}
    let lastMeaningful = '';
    /* Python 的隐式字符串拼接：pprint 会把长字符串折成
       'aaa '
       'bbb'
       这不是"脏数据"，是从 Python 直接复制出来的常态。合并成同一个 JSON 字符串。 */
    let prevStr = null; // {mark, value} 最近一个已输出的字符串值

    function push(s) { out.push(s); }
    function note(type, ln, desc) { changes.push({ type: type, line: ln, desc: desc }); }

    function skipWsPush() {
      while (i < len) {
        const c = src.charCodeAt(i);
        if (c === 10) { line++; push('\n'); i++; continue; }
        if (c === 32 || c === 9 || c === 13) { push(src.charAt(i)); i++; continue; }
        break;
      }
    }
    function handleComments() {
      for (;;) {
        if (i >= len - 1 || src.charCodeAt(i) !== 47) return false;
        const c2 = src.charCodeAt(i + 1);
        if (c2 !== 47 && c2 !== 42) return false;
        if (c2 === 47) {
          const start = i;
          i += 2;
          while (i < len && src.charCodeAt(i) !== 10) i++;
          note('comment', line, 'removed line comment ' + JSON.stringify(src.slice(start, Math.min(i, start + 40))));
          continue;
        }
        const startLine = line;
        const start = i;
        i += 2;
        while (i < len && !(src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47)) { if (src.charCodeAt(i) === 10) line++; i++; }
        i = Math.min(len, i + 2);
        note('comment', startLine, 'removed block comment ' + JSON.stringify(src.slice(start, Math.min(i, start + 40))));
      }
    }
    function decodeIntoChars() {}

    /* 输出一个字符串字面量；若紧邻上一个字符串，则视为 Python 隐式拼接并合并 */
    function mergeOrPushString(lit, prev, ln) {
      let val;
      try { val = JSON.parse(lit); } catch (e) { push(lit); return null; }
      if (prev && prev.value !== undefined) {
        const merged = prev.value + val;
        out.length = prev.mark + 1; /* 丢掉两段之间的空白 */
        out[prev.mark] = encodeStringLit(merged, '"', false);
        note('python-concat', ln, 'merged adjacent string literals (Python implicit concatenation)');
        return { mark: prev.mark, value: merged };
      }
      push(lit);
      return { mark: out.length - 1, value: val };
    }

    while (i < len) {
      const nodeLine = line;
      skipWsPush();
      if (i >= len) break;
      handleComments();
      skipWsPush();
      if (i >= len) break;
      const c = src.charCodeAt(i);
      if (c !== 34 && c !== 39) prevStr = null;
      if (c === 123 || c === 91) {
        openStack.push({ kind: c === 123 ? 'o' : 'a', line: nodeLine });
        push(c === 123 ? '{' : '[');
        i++;
        lastMeaningful = c === 123 ? '{' : '[';
        continue;
      }
      if (c === 125 || c === 93) {
        const want = c === 125 ? 'o' : 'a';
        if (pendingComma) {
          dropPendingComma();
          note('trailing-comma', nodeLine, 'removed trailing comma before ' + (c === 125 ? '}' : ']'));
          pendingComma = null;
        }
        const top = openStack.length ? openStack[openStack.length - 1] : null;
        if (!top) {
          note('extra-close', nodeLine, 'removed unmatched ' + (c === 125 ? '}' : ']'));
          i++;
          continue;
        }
        if (top.kind !== want) {
          note('mismatched-close', nodeLine, 'replaced ' + (top.kind === 'o' ? '}' : ']') + '-expecting container with ' + (c === 125 ? '}' : ']'));
        }
        openStack.pop();
        push(c === 125 ? '}' : ']');
        i++;
        lastMeaningful = c === 125 ? '}' : ']';
        continue;
      }
      /* 逗号后面又出现了别的 token → 它不是尾逗号，必须清掉跟踪，
         否则收尾的 dropPendingComma() 会把正常分隔符删掉（{"a":1,"b":2} → {"a":1"b":2}）。 */
      if (pendingComma) pendingComma = null;
      if (c === 44) {
        out.push(',');
        const mark = out.length - 1;
        pendingComma = { mark: mark };
        i++;
        lastMeaningful = ',';
        continue;
      }
      if (c === 58) { push(':'); i++; lastMeaningful = ':'; continue; }
      if (c === 34) {
        const r = repairString(34, nodeLine);
        prevStr = mergeOrPushString(r, prevStr, nodeLine);
        lastMeaningful = 'value';
        continue;
      }
      if (c === 39) {
        const r = repairString(39, nodeLine);
        note('single-quote', nodeLine, 'converted single-quoted string to double quotes');
        prevStr = mergeOrPushString(r, prevStr, nodeLine);
        lastMeaningful = 'value';
        continue;
      }
      if (c === 45 || c === 43 || isDigit(c)) {
        const start = i;
        if (c === 43) { note('plus-number', nodeLine, 'removed leading + from number'); i++; }
        if (src.charCodeAt(i) === 45) i++;
        if (src.startsWith('Infinity', i)) {
          i += 8;
          note('infinity', nodeLine, 'replaced Infinity with string "Infinity"');
          push('"Infinity"');
          lastMeaningful = 'value';
          continue;
        }
        while (i < len && isDigit(src.charCodeAt(i))) i++;
        if (src.charCodeAt(i) === 46) { i++; while (i < len && isDigit(src.charCodeAt(i))) i++; }
        const ec = src.charCodeAt(i);
        if (ec === 101 || ec === 69) {
          const save = i;
          i++;
          if (src.charCodeAt(i) === 43 || src.charCodeAt(i) === 45) i++;
          if (!isDigit(src.charCodeAt(i))) i = save;
          else while (i < len && isDigit(src.charCodeAt(i))) i++;
        }
        let raw = src.slice(start, i).replace(/^\+/, '');
        if (raw === '-' || raw === '') {
          note('broken-number', nodeLine, 'dropped incomplete number literal "' + raw + '"');
          continue;
        }
        push(raw);
        lastMeaningful = 'value';
        continue;
      }
      if (src.startsWith('NaN', i)) {
        i += 3;
        note('nan', nodeLine, 'replaced NaN with null');
        push('null');
        lastMeaningful = 'value';
        continue;
      }
      let pyMatched = false;
      for (const py of ['None', 'True', 'False', 'null', 'true', 'false', 'Infinity']) {
        if (src.startsWith(py, i)) {
          i += py.length;
          if (PY_TO_JSON_LITERAL[py]) {
            note('python-literal', nodeLine, 'replaced ' + py + ' with ' + PY_TO_JSON_LITERAL[py]);
            push(PY_TO_JSON_LITERAL[py]);
          } else if (py === 'Infinity') {
            note('infinity', nodeLine, 'replaced Infinity with string "Infinity"');
            push('"Infinity"');
          } else push(py);
          lastMeaningful = 'value';
          pyMatched = true;
          break;
        }
      }
      if (pyMatched) continue;
      if (lastMeaningful !== 'value') {
        if (isIdStart(src.charCodeAt(i))) {
          const start = i;
          while (i < len && (isIdPart(src.charCodeAt(i)) || src.charCodeAt(i) === 45 || src.charCodeAt(i) === 46 || src.charCodeAt(i) === 32)) {
            if (src.charCodeAt(i) === 10) break;
            i++;
          }
          const word = src.slice(start, i).replace(/\s+$/, '');
          const after = src.charCodeAt(i);
          const isKeyPos = after === 58 || (after === 32 && src.slice(i).trimStart().charCodeAt(0) === 58);
          if (isKeyPos) {
            if (/^-?([1-9][0-9]*|0)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(word)) {
              note('bare-number-key', nodeLine, 'quoted numeric key "' + word + '"');
            } else {
              note('unquoted-key', nodeLine, 'quoted bare key "' + word + '"');
            }
            push(encodeStringLit(word, '"', false));
            lastMeaningful = 'value';
            continue;
          }
          note('bare-word', nodeLine, 'replaced unquoted word "' + word + '" with string');
          push(encodeStringLit(word, '"', false));
          lastMeaningful = 'value';
          continue;
        }
        if (i < len) {
          note('unexpected-char', nodeLine, 'removed unexpected character ' + JSON.stringify(src.charAt(i)));
          i++;
          continue;
        }
      }
      /* 兜底：走到这里说明当前字符不属于任何分支（典型是 `=`、`@`、裸 `\\`）。
         原来这里直接落到 while 末尾而不推进 i，遇到 `= 1=2` 这类输入会原地死循环、冻死整个页面。
         统一按「不认识的字符」丢弃并前进一位，保证 i 单调递增。 */
      if (i < len) {
        note('unexpected-char', nodeLine, 'removed unexpected character ' + JSON.stringify(src.charAt(i)));
        i++;
        continue;
      }
      void nodeLine;
      break;
    }

    function dropPendingComma() {
      for (let k = out.length - 1; k >= 0; k--) {
        const s = out[k];
        if (s === undefined) continue;
        if (/^[\s]+$/.test(s) || s === '') continue;
        if (/,$/.test(s)) { out[k] = s.replace(/,+$/, ''); return; }
        if (s === ',') { out[k] = ''; return; }
        break;
      }
      if (pendingComma && pendingComma.mark !== undefined) out[pendingComma.mark] = '';
    }

    function repairString(q, nodeLine) {
      i++;
      const chars = [];
      let closed = false;
      while (i < len) {
        const c = src.charCodeAt(i);
        if (c === 92) {
          const e = src.charAt(i + 1);
          if (e === '/') {
            chars.push('/');
            i += 2;
            note('escaped-solidus', nodeLine, 'unescaped \\/ to /');
            continue;
          }
          if ((e === 'u' || e === 'x') && /^[0-9a-fA-F]+$/.test(src.substr(i + 2, e === 'u' ? 4 : 2))) {
            const w = e === 'u' ? 4 : 2;
            chars.push(String.fromCharCode(parseInt(src.substr(i + 2, w), 16)));
            i += 2 + w;
            if (e === 'x') note('hex-escape', nodeLine, 'expanded \\x escape inside string');
            continue;
          }
          chars.push(e === '\n' ? '' : (SIMPLE_ESCAPES[e] !== undefined ? SIMPLE_ESCAPES[e] : e));
          i += 2;
          continue;
        }
        if (c === q) { i++; closed = true; break; }
        if (c === 34 && q === 39) {
          chars.push('"');
          note('inner-quote', nodeLine, 'escaped double quote found inside single-quoted string');
          i++;
          continue;
        }
        if (c === 10 && q === 39) { note('unterminated-string', line, 'closed unterminated single-quoted string at line break'); break; }
        if (c === 10) line++;
        chars.push(src.charAt(i));
        i++;
      }
      if (!closed && i >= len) note('unterminated-string', nodeLine, 'closed string that never terminated');
      if (q === 39) return encodeStringLit(chars.join(''), '"', false);
      return encodeStringLit(chars.join(''), '"', opts.ensureAscii);
    }

    skipWsPush();
    handleComments();
    skipWsPush();
    if (pendingComma) { dropPendingComma(); }
    let tail = '';
    const closing = [];
    while (openStack.length) {
      const f = openStack.pop();
      closing.push(f.kind === 'o' ? '}' : ']');
    }
    if (closing.length) {
      note('close-containers', line, 'closed ' + closing.length + ' unterminated container(s): ' + closing.join(''));
      tail = closing.join('');
    }
    let repaired = out.join('').replace(/,(\s*)([}\]])/g, function (m, w, c) { return w + c; });
    if (tail) repaired += tail;
    if (/,\s*$/.test(repaired)) repaired = repaired.replace(/,\s*$/, '');
    const check = jsonBuildModel(repaired, null, { lenient: true });
    const res = {
      text: repaired,
      changes: changes,
      stats: {
        bytes: repaired.length, inBytes: src.length, changes: changes.length,
        stillInvalid: !!check.error, error: check.error || null,
        closedContainers: closing.length
      }
    };
    return res;
  }

  /*JSON*/

  /*__JSTOK__*/

  /*__JSFMT__*/

  /*__JSANALYZE__*/

  /*__DEOBF__*/

  /*__HTMLTOK__*/

  /*__HTMLFMT__*/

  /*__OUTLINE__*/

  /*__DICT__*/

  SK.fmt = {
    jsonFormat: jsonFormat,
    jsonValidate: jsonValidate,
    jsonStreamFormat: jsonStreamFormat,
    jsonStreamScan: jsonStreamScan,
    jsonToLines: jsonToLines,
    jsonPaths: jsonPaths,
    jsonQuery: jsonQuery,
    jsonGet: jsonGet,
    jsonRepair: jsonRepair,
    jsonStats: jsonStats,
    parseJsonPath: parseJsonPath,
    lineColAt: lineColAt,
    VERSION: VERSION,
    SUPPORTED_LANGS: SUPPORTED_LANGS,
    escapeHtml: escapeHtml,
    unescapeHtml: unescapeHtml,
    prettyBytes: prettyBytes,
    truncateMiddle: truncateMiddle
  };
})(typeof self !== 'undefined' ? self : globalThis);
