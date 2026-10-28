/* codefmt.js — JS / HTML / Python-literal 解析与格式化内核
 * 供 worker 与主线程共用，只依赖自身，不依赖 DOM。
 * 暴露：SK.code = { js, jsMin, analyze, deobf, html, dict, dictToPy, segs }
 */
(function (root) {
  'use strict';
  const SK = (root.SK = root.SK || {});

  /* ============================================================
   * 基础工具
   * ============================================================ */

  const CONTROL = { if: 1, for: 1, while: 1, switch: 1, catch: 1, with: 1, return: 1, throw: 1, typeof: 1, delete: 1, void: 1, in: 1, of: 1, new: 1, do: 1, else: 1, instanceof: 1, function: 1, await: 1, yield: 1, case: 1 };
  const REGEX_PREV = { '(': 1, ',': 1, '=': 1, ':': 1, '[': 1, '!': 1, '&': 1, '|': 1, '?': 1, '{': 1, '}': 1, ';': 1, '=>': 1, '+': 1, '-': 1, '*': 1, '%': 1, '~': 1, '^': 1, '<': 1, '>': 1, 'return': 1, typeof: 1, instanceof: 1, in: 1, of: 1, new: 1, delete: 1, void: 1, case: 1, do: 1, else: 1, yield: 1, await: 1, throw: 1 };
  const MULTI = ['>>>=', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>', '::'];
  const BINOP = { '=': 1, '+': 1, '-': 1, '*': 1, '/': 1, '%': 1, '==': 1, '===': 1, '!=': 1, '!==': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&&': 1, '||': 1, '??': 1, '&': 1, '|': 1, '^': 1, '<<': 1, '>>': 1, '>>>': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1, '&=': 1, '|=': 1, '^=': 1, '**': 1, '=>': 1 };

  function isWordStart(c) {
    return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || c > 127;
  }
  function isWordPart(c) {
    return isWordStart(c) || (c >= 48 && c <= 57);
  }
  function isDigit(c) {
    return c >= 48 && c <= 57;
  }
  function fmtNum(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ============================================================
   * JS tokenizer
   * ============================================================ */

  function tokenizeJs(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    let prev = null;

    function adv(text) {
      let k = 0;
      for (let p = 0; p < text.length; p++) if (text.charCodeAt(p) === 10) k++;
      line += k;
      return text;
    }

    while (i < n) {
      const c = src[i];
      const cc = src.charCodeAt(i);
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '\n') { line++; i++; continue; }

      if (c === '/' && src[i + 1] === '/') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        const v = src.slice(i, j);
        toks.push({ k: 'lc', v: v, ln: line });
        i = j;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        let j = src.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        const v = adv(src.slice(i, j));
        toks.push({ k: 'bc', v: v, ln: line - (v.match(/\n/g) || []).length });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        const r = readStr(src, i, c);
        toks.push({ k: 'str', v: r.v, ln: line });
        adv(r.v);
        i = r.end;
        prev = r.v;
        continue;
      }
      if (c === '`') {
        const r = readTemplate(src, i);
        toks.push({ k: 'tpl', v: r.v, ln: line });
        adv(r.v);
        i = r.end;
        prev = '`';
        continue;
      }
      if (c === '/' && (prev === null || REGEX_PREV[prev] === 1)) {
        const r = readRegex(src, i);
        if (r) {
          toks.push({ k: 're', v: r.v, ln: line });
          i = r.end;
          prev = r.v;
          continue;
        }
      }
      if (isDigit(cc) || (c === '.' && isDigit(src.charCodeAt(i + 1)))) {
        const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/.exec(src.slice(i, i + 400));
        const v = m ? m[0] : c;
        toks.push({ k: 'num', v: v, ln: line });
        i += v.length;
        prev = v;
        continue;
      }
      if (isWordStart(cc)) {
        let j = i + 1;
        while (j < n && isWordPart(src.charCodeAt(j))) j++;
        const v = src.slice(i, j);
        toks.push({ k: 'id', v: v, ln: line });
        i = j;
        prev = v;
        continue;
      }
      let matched = null;
      for (let m = 0; m < MULTI.length; m++) {
        if (src.startsWith(MULTI[m], i)) { matched = MULTI[m]; break; }
      }
      const v = matched || c;
      toks.push({ k: 'p', v: v, ln: line });
      i += v.length;
      prev = v;
    }
    return toks;
  }

  function readStr(src, i, q) {
    const n = src.length;
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === q) { j++; break; }
      if (c === '\n') break;
      j++;
    }
    return { v: src.slice(i, j), end: j };
  }

  function readTemplate(src, i) {
    const n = src.length;
    let j = i + 1;
    let depth = 0;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (depth === 0 && c === '`') { j++; break; }
      if (c === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
      if (depth > 0) {
        if (c === '{') { depth++; j++; continue; }
        if (c === '}') { depth--; j++; continue; }
        if (c === '"' || c === "'") { j = readStr(src, j, c).end; continue; }
        if (c === '`') { j = readTemplate(src, j).end; continue; }
      }
      j++;
    }
    return { v: src.slice(i, j), end: j };
  }

  function readRegex(src, i) {
    const n = src.length;
    let j = i + 1;
    let inClass = false;
    let closed = false;
    while (j < n) {
      const c = src[j];
      if (c === '\n') return null;
      if (c === '\\') { j += 2; continue; }
      if (c === '[') { inClass = true; j++; continue; }
      if (c === ']') { inClass = false; j++; continue; }
      if (c === '/' && !inClass) { j++; closed = true; break; }
      j++;
    }
    if (!closed) return null;
    while (j < n && /[a-z]/i.test(src[j])) j++;
    return { v: src.slice(i, j), end: j };
  }

  /* ============================================================
   * 代码/字符串/注释 分段（用于只改代码不改字面量）
   * ============================================================ */

  function segments(src) {
    const out = [];
    const n = src.length;
    let i = 0;
    let buf = '';
    let prev = null;

    function flush() {
      if (buf) { out.push({ type: 'code', text: buf }); buf = ''; }
    }
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {
        flush();
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        out.push({ type: 'comment', text: src.slice(i, j) });
        i = j;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        flush();
        let j = src.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        out.push({ type: 'comment', text: src.slice(i, j) });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        flush();
        const r = readStr(src, i, c);
        out.push({ type: 'str', quote: c, text: r.v });
        i = r.end;
        prev = r.v;
        continue;
      }
      if (c === '`') {
        flush();
        const r = readTemplate(src, i);
        out.push({ type: 'str', quote: '`', text: r.v, tpl: true });
        i = r.end;
        prev = '`';
        continue;
      }
      if (c === '/' && (prev === null || REGEX_PREV[prev] === 1)) {
        const r = readRegex(src, i);
        if (r) {
          flush();
          out.push({ type: 're', text: r.v });
          i = r.end;
          prev = r.v;
          continue;
        }
      }
      if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? 'word' : c;
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /* ============================================================
   * JS 美化
   * ============================================================ */

  /* B03 修复：改用真正的 parser + printer（Terser）做美化 / 压缩。
   * 旧实现是「删空白后重拼 token」，会破坏自动分号插入（ASI）：
   *   var a=1⏎var b=2   →  变成 var a = 1 var b = 2（语法错误）
   *   return⏎1          →  语义从 undefined 变成 1
   * Terser 走完整 AST，ASI、正则、模板串、现代语法都保真；
   * keep_numbers 保证 0x10 / 1_000_000 / 大整数字面量不被改写。
   * 只有 Terser 不可用或源码无法解析时才退回旧的文本级缩进，并给出 notice。 */
  function terserReady() {
    return typeof Terser === 'object' && Terser && typeof Terser.minify_sync === 'function';
  }
  function terserErrMsg(e) {
    const m = String((e && e.message) || e || '未知错误');
    return m.length > 160 ? m.slice(0, 160) + '…' : m;
  }
  function looksLikeModule(text) {
    return /(^|\n)\s*(import|export)[\s{*]/.test(text) || /\bexport\s+default\b/.test(text);
  }
  function terserBase(text, opts) {
    return {
      ecma: 2022,
      module: looksLikeModule(text),
      toplevel: false,
      sourceMap: false,
      compress: false,
      mangle: false,
      format: Object.assign(
        {
          ecma: 2022,
          comments: 'all',
          keep_numbers: true /* 保真数字字面量：0x10 / 1_000_000 / 大整数 */,
          keep_quoted_props: true,
          preserve_annotations: true,
          semicolons: true,
        },
        opts.format || {}
      ),
    };
  }

  function jsPretty(src, opts) {
    opts = opts || {};
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    if (!text.trim()) return { code: '', engine: 'none' };
    if (opts.engine === 'legacy' || !terserReady()) {
      return {
        code: legacyJs(text, opts),
        engine: 'legacy',
        warning: '未加载 Terser，正在使用文本级缩进：不保证自动分号插入（ASI）语义，输出仅供阅读，不要直接运行',
      };
    }
    const cfg = terserBase(text, opts);
    cfg.format.beautify = true;
    cfg.format.indent_level = opts.indent === '\t' ? 4 : Math.max(1, Number(opts.indent) || 2);
    cfg.format.indent_start = 0;
    try {
      const r = Terser.minify_sync(text, cfg);
      if (r && !r.error && typeof r.code === 'string') return { code: r.code, engine: 'terser' };
      return {
        code: legacyJs(text, opts),
        engine: 'legacy',
        warning: '源码无法被完整解析（' + terserErrMsg(r && r.error) + '），已降级为文本级缩进：不保证 ASI 语义，输出不要直接运行',
      };
    } catch (e) {
      return {
        code: legacyJs(text, opts),
        engine: 'legacy',
        warning: '美化器异常（' + terserErrMsg(e) + '），已降级为文本级缩进：不保证 ASI 语义',
      };
    }
  }

  function jsMinify(src, opts) {
    opts = opts || {};
    const text = String(src == null ? '' : src);
    if (!text.trim()) return { code: '', engine: 'none' };
    if (opts.engine === 'legacy' || !terserReady()) {
      return { code: legacyJsMin(text), engine: 'legacy', warning: '未加载 Terser，使用文本级压缩：不保证 ASI 语义，压缩结果请先语法校验' };
    }
    const cfg = terserBase(text, opts);
    cfg.compress = opts.compress === false ? false : { passes: 2, unsafe: false, keep_fargs: true, hoist_funs: false };
    cfg.mangle = opts.mangle === false ? false : { toplevel: false, keep_fnames: !!opts.keepFnames };
    cfg.format.comments = false;
    cfg.format.beautify = false;
    try {
      const r = Terser.minify_sync(text, cfg);
      if (r && !r.error && typeof r.code === 'string') return { code: r.code, engine: 'terser' };
      return { code: legacyJsMin(text), engine: 'legacy', warning: '压缩失败（' + terserErrMsg(r && r.error) + '），已降级为文本级压缩：不保证 ASI 语义' };
    } catch (e) {
      return { code: legacyJsMin(text), engine: 'legacy', warning: '压缩器异常（' + terserErrMsg(e) + '），已降级为文本级压缩' };
    }
  }

  function legacyJs(src, opts) {
    opts = opts || {};
    const unit = opts.indent === '\t' ? '\t' : ' '.repeat(Math.max(0, Math.min(8, opts.indent == null ? 2 : Number(opts.indent) || 0)));
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    if (!text.trim()) return '';
    const toks = tokenizeJs(text);
    const lines = [];
    const stack = [];
    let cur = '';
    let lvl = 0;
    let prev = null;
    let lineStart = 0;

    function ind() { return unit.repeat(lvl); }
    function put(s) { cur += s; }
    function trim() { cur = cur.replace(/[ \t]+$/, ''); }
    function nl() {
      trim();
      if (cur.trim() !== '') lines.push(cur);
      cur = ind();
    }
    function space() { if (cur && !/[ \t]$/.test(cur)) cur += ' '; }
    function bump(d) { lvl = Math.max(0, lvl + d); }
    function top() { return stack.length ? stack[stack.length - 1] : null; }

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const next = toks[i + 1];
      const v = t.v;

      if (t.k === 'lc') {
        if (cur.trim() === '') { put(v); nl(); }
        else { space(); put(v); nl(); }
        prev = t;
        continue;
      }
      if (t.k === 'bc') {
        if (cur.trim() !== '') nl();
        const parts = v.split('\n');
        parts.forEach((p, k) => {
          if (k) { nl(); }
          put(k ? ' ' + p.replace(/^\s+/, '') : p);
        });
        nl();
        prev = t;
        continue;
      }

      if (t.k === 'p') {
        if (v === '{') {
          if (next && next.v === '}') {
            if (prev && (prev.k === 'id' || prev.v === ')' || prev.v === ']' || prev.v === '>')) space();
            put('{}');
            i++;
            prev = { k: 'p', v: '}' };
            continue;
          }
          if (prev && (prev.k === 'id' || prev.v === ')' || prev.v === ']')) space();
          put('{');
          stack.push('{');
          bump(1);
          nl();
          prev = t;
          continue;
        }
        if (v === '}') {
          if (top() === '{') stack.pop();
          bump(-1);
          nl();
          put('}');
          prev = t;
          if (next && (next.v === ')' || next.v === ',' || next.v === ';' || next.v === '.' || next.v === ']')) continue;
          if (next && (next.k === 'id' && (next.v === 'else' || next.v === 'catch' || next.v === 'finally' || next.v === 'while'))) continue;
          if (next && next.v === '}') continue;
          nl();
          continue;
        }
        if (v === '[') {
          if (next && next.v === ']') {
            put('[]');
            i++;
            prev = { k: 'p', v: ']' };
            continue;
          }
          put('[');
          stack.push('[');
          prev = t;
          continue;
        }
        if (v === ']') {
          if (top() === '[') stack.pop();
          put(']');
          prev = t;
          continue;
        }
        if (v === '(') {
          const needSpace = prev && prev.k === 'id' && CONTROL[prev.v] === 1;
          if (needSpace) space();
          put('(');
          stack.push(prev && prev.v === 'for' ? 'for(' : '(');
          prev = t;
          continue;
        }
        if (v === ')') {
          if (top() === '(' || top() === 'for(') stack.pop();
          trim();
          put(')');
          prev = t;
          continue;
        }
        if (v === ';') {
          put(';');
          prev = t;
          if (top() === '(' || top() === 'for(') { space(); continue; }
          if (next && next.v === '}') { nl(); continue; }
          nl();
          continue;
        }
        if (v === ',') {
          trim();
          put(',');
          prev = t;
          if (top() === '[') { space(); continue; }
          if (top() === '(' || top() === 'for(') { space(); continue; }
          nl();
          continue;
        }
        if (v === ':') {
          trim();
          put(':');
          prev = t;
          const head = cur.trim();
          if (/^(case\b|default$)/.test(head)) { nl(); continue; }
          space();
          continue;
        }
        if (v === '?') {
          trim();
          space();
          put('? ');
          prev = t;
          continue;
        }
        if (v === '.') {
          trim();
          put('.');
          prev = t;
          continue;
        }
        if (v === '?.') {
          trim();
          put('?.');
          prev = t;
          continue;
        }
        if (v === '++' || v === '--') {
          put(v);
          prev = t;
          continue;
        }
        if (v === '!' || v === '~') {
          if (prev && (prev.k === 'id' || prev.k === 'num' || prev.k === 'str' || prev.v === ')' || prev.v === ']')) space();
          put(v);
          prev = t;
          continue;
        }
        if (BINOP[v]) {
          trim();
          space();
          put(v);
          space();
          prev = t;
          continue;
        }
        if (v === '...') {
          trim();
          put('...');
          prev = t;
          continue;
        }
        put(v);
        prev = t;
        continue;
      }

      /* 字面量 / 标识符 */
      if (prev) {
        const wordy = prev.k === 'id' || prev.k === 'num' || prev.k === 'str' || prev.k === 'tpl' || prev.k === 're' || prev.v === ')' || prev.v === ']';
        const alsoWord = t.k === 'id' || t.k === 'num' || t.k === 'str' || t.k === 'tpl' || t.k === 're';
        if (wordy && alsoWord) space();
      }
      if (v === 'else' || v === 'catch' || v === 'finally') {
        if (cur.trim() === '}') { space(); }
        else if (cur.trim() !== '') nl();
      }
      if (v === 'case' || v === 'default') {
        if (cur.trim() !== '') nl();
      }
      put(v);
      prev = t;
    }
    trim();
    if (cur.trim() !== '') lines.push(cur);

    const cleaned = [];
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k].replace(/[ \t]+$/, '');
      if (l === '' && cleaned.length && cleaned[cleaned.length - 1] === '') continue;
      cleaned.push(l);
    }
    while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
    return cleaned.join('\n') + '\n';
  }

  function legacyJsMin(src) {
    const text = String(src == null ? '' : src);
    const toks = tokenizeJs(text);
    let out = '';
    let prev = null;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'lc') { out = out.replace(/[ \t]+$/, '') + '\n'; continue; }
      if (t.k === 'bc') { continue; }
      const need = prev && ((prev.k === 'id' || prev.k === 'num') && (t.k === 'id' || t.k === 'num') || (prev.v === '++' || prev.v === '--') && (t.v === '+' || t.v === '-') || prev.v === '+' && t.v === '+' || prev.v === '-' && t.v === '-');
      if (need) out += ' ';
      out += t.v;
      prev = t;
    }
    return out.replace(/\n{2,}/g, '\n').replace(/\n([}\]);,])/g, '$1').trim() + '\n';
  }

  /* ============================================================
   * JS 结构 / 敏感点分析
   * ============================================================ */

  const HOT_WORDS = [
    { re: /CryptoJS|JSEncrypt|sm2|sm3|sm4|jsencrypt/i, kind: 'crypto', msg: '加密库调用（CryptoJS / JSEncrypt / SM 系列）' },
    { re: /\bMD5\b|\bSHA1\b|\bSHA256\b|\bHMAC\b|\bAES\b|\bDES\b|\bRSA\b/i, kind: 'crypto', msg: '常见加密算法名' },
    { re: /\b(sign|signature|_signature|x-sign|x_sign|token|nonce|timestamp|ts|_t|_ts)\b/i, kind: 'sign', msg: '疑似签名/防重放参数' },
    { re: /\batob\b|\bbtoa\b/, kind: 'codec', msg: 'Base64 编解码' },
    { re: /\beval\b|new\s+Function\b/, kind: 'danger', msg: '动态执行（常见于混淆/风控）' },
    { re: /XMLHttpRequest|\bfetch\s*\(|\.setRequestHeader\b/, kind: 'net', msg: '网络请求相关' },
    { re: /document\.cookie|localStorage|sessionStorage/, kind: 'env', msg: '浏览器存储/Cookie' },
    { re: /navigator\.(userAgent|webdriver|plugins|languages)|canvas|WebGL|AudioContext/, kind: 'fp', msg: '指纹检测特征' },
    { re: /webdriver|__driver_evaluate|callPhantom|_phantom|domAutomation/i, kind: 'fp', msg: '自动化/无头浏览器检测' },
    { re: /debugger/, kind: 'anti', msg: 'debugger 反调试' },
    { re: /_0x[a-f0-9]{3,}/i, kind: 'obf', msg: '十六进制标识符（典型混淆）' },
  ];

  function analyze(src) {
    const text = String(src == null ? '' : src);
    const toks = tokenizeJs(text);
    const functions = [];
    const hits = [];
    const urls = [];
    const seenFn = {};

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k !== 'id') continue;
      if (t.v === 'function') {
        let name = '(anonymous)';
        let j = i + 1;
        if (toks[j] && toks[j].k === 'id') { name = toks[j].v; j++; }
        const params = readParams(toks, j);
        if (!seenFn[name + ':' + t.ln]) {
          seenFn[name + ':' + t.ln] = 1;
          functions.push({ name: name, params: params.join(', '), line: t.ln, kind: 'function' });
        }
        continue;
      }
      if (toks[i + 1] && toks[i + 1].v === '=' && toks[i + 2] && toks[i + 2].v === 'function') {
        const params = readParams(toks, i + 3);
        const key = t.v + ':' + t.ln;
        if (!seenFn[key]) { seenFn[key] = 1; functions.push({ name: t.v, params: params.join(', '), line: t.ln, kind: 'assign' }); }
        continue;
      }
      if (toks[i + 1] && toks[i + 1].v === '=' && toks[i + 2] && toks[i + 2].v === '(' && toks[i + 3] && toks[i + 3].v === ')' && toks[i + 4] && toks[i + 4].v === '=>') {
        const key = t.v + ':' + t.ln;
        if (!seenFn[key]) { seenFn[key] = 1; functions.push({ name: t.v, params: '', line: t.ln, kind: 'arrow' }); }
      }
    }

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const lineText = lineOf(text, t.ln);
      for (let h = 0; h < HOT_WORDS.length; h++) {
        if (HOT_WORDS[h].re.test(t.v) || (t.k === 'id' && t.v.length > 1 && HOT_WORDS[h].re.test(t.v))) {
          hits.push({ line: t.ln, kind: HOT_WORDS[h].kind, kw: t.v, msg: HOT_WORDS[h].msg, text: lineText.trim().slice(0, 220) });
          break;
        }
      }
    }

    const urlRe = /https?:\/\/[^\s'"`<>\\)]{6,300}/g;
    let m;
    while ((m = urlRe.exec(text))) {
      if (urls.length > 300) break;
      urls.push({ url: m[0], line: lineOfPos(text, m.index) });
    }

    const uniq = {};
    const dedup = [];
    for (const h of hits) {
      const k = h.line + '|' + h.kw;
      if (uniq[k]) continue;
      uniq[k] = 1;
      dedup.push(h);
    }
    dedup.sort((a, b) => a.line - b.line);
    return {
      functions: functions,
      hits: dedup,
      urls: urls,
      stats: { bytes: text.length, lines: (text.match(/\n/g) || []).length + 1, functions: functions.length, hits: dedup.length, urls: urls.length },
    };
  }

  function readParams(toks, j) {
    const out = [];
    if (!toks[j] || toks[j].v !== '(') return out;
    let depth = 0;
    for (let k = j; k < toks.length && k < j + 400; k++) {
      const v = toks[k].v;
      if (v === '(') { depth++; continue; }
      if (v === ')') { depth--; if (depth === 0) break; continue; }
      if (depth === 1 && toks[k].k === 'id') {
        if (k > 0 && toks[k - 1].v === ',') out.push(toks[k].v);
        else if (k > 0 && toks[k - 1].v === '(') out.push(toks[k].v);
      }
    }
    return out;
  }

  function lineOf(text, ln) {
    let i = 0;
    let cur = 1;
    while (cur < ln) {
      const j = text.indexOf('\n', i);
      if (j < 0) return text.slice(i);
      i = j + 1;
      cur++;
    }
    const e = text.indexOf('\n', i);
    return text.slice(i, e < 0 ? text.length : e);
  }

  function lineOfPos(text, pos) {
    let n = 1;
    for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  /* ============================================================
   * JS 反混淆
   * ============================================================ */

  /* 把字符串字面量的「内部文本」解码成真实值（含全部 JS 转义），
     再由 encodeJsString 重新编码。直接在原文上替换 \xNN 是不安全的：
     '\x27' 解出来是单引号，会把字符串边界打断（真实混淆产物里很常见）。 */
  function decodeJsStringBody(body) {
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== '\\') { out += c; continue; }
      const n = body[++i];
      if (n === undefined) { out += '\\'; break; }
      if (n === 'x') {
        const h = body.substr(i + 1, 2);
        if (/^[0-9a-fA-F]{2}$/.test(h)) { out += String.fromCharCode(parseInt(h, 16)); i += 2; continue; }
        out += 'x'; continue;
      }
      if (n === 'u') {
        if (body[i + 1] === '{') {
          const close = body.indexOf('}', i + 2);
          const h = close > 0 ? body.slice(i + 2, close) : '';
          if (/^[0-9a-fA-F]{1,6}$/.test(h)) {
            const cp = parseInt(h, 16);
            out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
            i = close;
            continue;
          }
        }
        const h = body.substr(i + 1, 4);
        if (/^[0-9a-fA-F]{4}$/.test(h)) { out += String.fromCharCode(parseInt(h, 16)); i += 4; continue; }
        out += 'u'; continue;
      }
      if (n === '\r') { if (body[i + 1] === '\n') i++; continue; } /* 续行 */
      if (n === '\n' || n === '\u2028' || n === '\u2029') continue;
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
      if (map[n] !== undefined) { out += map[n]; continue; }
      out += n; /* \\ \' \" 以及未定义转义（JS 语义就是取该字符） */
    }
    return out;
  }

  function encodeJsString(value, quote) {
    const q = quote === '"' ? '"' : "'";
    let out = '';
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      const code = c.charCodeAt(0);
      if (c === '\\') out += '\\\\';
      else if (c === q) out += '\\' + q;
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c === '\b') out += '\\b';
      else if (c === '\f') out += '\\f';
      else if (c === '\v') out += '\\v';
      else if (code === 0) out += '\\0';
      else if (code < 0x20 || code === 0x2028 || code === 0x2029) out += '\\u' + code.toString(16).padStart(4, '0');
      else out += c;
    }
    return q + out + q;
  }

  function unescapeJsString(body) {
    return decodeJsStringBody(body);
  }

  /* ============================================================
   * 轻量常量折叠（受限求值，无 AST）：字面量 二元运算 字面量
   * 只折叠能静态确定且结果安全的结果，不执行任何代码。
   * ============================================================ */
  let foldCount = 0;
  const LIT_NUM = '(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)';
  const LIT_STR = "(?:'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\")";
  const LIT_ANY = '(?:' + LIT_STR + '|' + LIT_NUM + '|true|false|null)';
  const OPS = ['===', '!==', '<<', '>>', '>>>', '&&', '||', '==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '&', '|', '^', '<', '>'];

  function parseLit(tok) {
    const t = tok.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^['"]/.test(t)) {
      try { return JSON.parse(t.replace(/^'|'$/g, '"')); } catch (e) { return undefined; }
    }
    const n = Number(t);
    return isNaN(n) ? undefined : n;
  }
  function litToStr(v) {
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  }
  function evalOp(op, a, b) {
    switch (op) {
      case '+': return (typeof a === 'string' || typeof b === 'string') && !(typeof a === 'string' && typeof b === 'string') && (typeof a !== 'number' && typeof b !== 'number') && typeof a !== 'string' && typeof b !== 'string' ? undefined : a + b;
      case '-': return typeof a === 'number' && typeof b === 'number' ? a - b : undefined;
      case '*': return typeof a === 'number' && typeof b === 'number' ? a * b : undefined;
      case '/': return typeof a === 'number' && typeof b === 'number' && b !== 0 && (a / b) === Math.round(a / b) ? a / b : undefined;
      case '%': return typeof a === 'number' && typeof b === 'number' && b !== 0 ? a % b : undefined;
      case '<<': case '>>': case '>>>': case '&': case '|': case '^':
        if (typeof a !== 'number' || typeof b !== 'number') return undefined;
        try {
          const r = op === '<<' ? a << b : op === '>>' ? a >> b : op === '>>>' ? a >>> b : op === '&' ? a & b : op === '|' ? a | b : a ^ b;
          return Number.isSafeInteger(r) ? r : undefined;
        } catch (e) { return undefined; }
      case '==': return a == b; case '!=': return a != b;
      case '===': return a === b; case '!==': return a !== b;
      case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
      case '&&': return (a && b) === a ? a : (a && b); case '||': return (a || b) === a ? a : (a || b);
      default: return undefined;
    }
  }
  /* 折叠 code 文本里的字面量二元表达式（一轮），返回新文本 */
  function foldConstants(text) {
    /* 单遍扫描 + 字符串边界感知：只在「字符串字面量之外」的位置尝试匹配，
       避免 '3|1|0|2' 这类字符串内部的 0|2 被误当位运算折叠 */
    const re = new RegExp('(\\s*)(' + LIT_ANY + ')\\s*(' + OPS.map((o) => o.replace(/[+*/%&|^<>=!]/g, (c) => '\\' + c)).join('|') + ')\\s*(' + LIT_ANY + ')', 'y');
    const tryFold = (chunk) => {
      re.lastIndex = 0;
      const m = re.exec(chunk);
      if (!m) return null;
      const a = parseLit(m[2]);
      const b = parseLit(m[4]);
      if (a === undefined || b === undefined) return null;
      if (a === null && m[3] !== '==' && m[3] !== '!=' && m[3] !== '===' && m[3] !== '!==') return null;
      const r = evalOp(m[3], a, b);
      if (r === undefined || r === null) return null;
      if (typeof r === 'number' && !Number.isSafeInteger(r)) return null;
      if (typeof r === 'string' && (r.length > 2000 || /[\n\r]/.test(r))) return null;
      foldCount++;
      return { replaced: m[1] + litToStr(r), len: m[0].length };
    };
    let out = '';
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      /* 字符串字面量：整体拷贝（含转义） */
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === c) { j++; break; }
          j++;
        }
        out += text.slice(i, j);
        i = j;
        continue;
      }
      /* 标识符整体拷贝：否则逐字符前进时会落到 _0xd 中间，把 0xd 当数字字面量折叠掉，
         产出 var s=_\"13\" 这种非法代码（真实踩坑：var _0xd=1; s=_0xd+"x" → 语法错误）。 */
      if (c === '_' || c === '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
        let j = i + 1;
        while (j < text.length) {
          const d = text[j];
          if (d === '_' || d === '$' || (d >= 'a' && d <= 'z') || (d >= 'A' && d <= 'Z') || (d >= '0' && d <= '9')) j++;
          else break;
        }
        out += text.slice(i, j);
        i = j;
        continue;
      }
      /* 代码位置：尝试折叠（窗口取 512 字符足够一个 表达式） */
      const win = text.slice(i, i + 512);
      const f = tryFold(win);
      if (f) {
        out += f.replaced;
        i += f.len;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }
  /* 整条表达式折叠为数字（供旋转次数等场景），失败返回 null */
  function foldNum(expr) {
    let cur = String(expr == null ? '' : expr).trim();
    for (let i = 0; i < 8; i++) {
      if (/^-?(?:0x[0-9a-fA-F]+|\d+)$/.test(cur)) return cur.indexOf('0x') === 0 || cur.indexOf('0X') === 0 ? parseInt(cur, 16) : parseInt(cur, 10);
      const next = foldConstants(cur);
      if (next === cur) return /^-?\d+$/.test(next) ? parseInt(next, 10) : null;
      cur = next.replace(/"/g, '');
    }
    return null;
  }
  const foldConstExpr = foldConstants;

  /* ============================================================
   * 控制流平坦化还原（obfuscator.io 顺序数组型）：
   * var O='3|1|0|2'.split('|'), i=0; while(!![]){ switch(O[i++]){ case '3': ...; continue; ... } break; }
   * → 按 3,1,0,2 顺序把 case 体线性拼接
   * ============================================================ */
  function matchBrace(text, start) {
    /* start 指向 '{'，返回配对 '}' 的下标（跳过字符串），失败 -1 */
    let depth = 0, q = null;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) return i; }
    }
    return -1;
  }
  function restoreFlat(src) {
    const declRe = /var\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])(\d+(?:\|\d+)+)\2\s*\.split\(\s*['"][^'"]*['"]\s*\)\s*,\s*([A-Za-z_$][\w$]*)\s*=\s*0\s*;/;;
    const dm = declRe.exec(src);
    if (!dm) return null;
    const ordStr = dm[3];
    const after = src.slice(dm.index + dm[0].length);
    const whileM = /^\s*while\s*\(\s*(?:!!\s*\[\]|true|1|!0)\s*\)\s*\{/.exec(after);
    if (!whileM) return null;
    const wOpen = dm.index + dm[0].length + whileM[0].length - 1;
    const wClose = matchBrace(src, wOpen);
    if (wClose < 0) return null;
    const body = src.slice(wOpen + 1, wClose);
    const swM = /switch\s*\(\s*[A-Za-z_$][\w$]*\s*\[\s*[A-Za-z_$][\w$]*\s*\+\+\s*\]\s*\)\s*\{/.exec(body);
    if (!swM) return null;
    const sOpen = body.indexOf('{', swM.index);
    const sClose = matchBrace(body, sOpen);
    if (sClose < 0) return null;
    const swBody = body.slice(sOpen + 1, sClose);
    /* case 分段 */
    const caseRe = /case\s+(['"])([\w-]+)\1\s*:/g;
    const marks = [];
    let cm;
    while ((cm = caseRe.exec(swBody))) marks.push({ key: cm[2], start: cm.index + cm[0].length });
    if (marks.length < 2) return null;
    const cases = {};
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].start - caseRe.lastKeyLen : swBody.length;
      /* 直接重算 end：下一段 case 的 match 开头 */
      let end2 = swBody.length;
      if (i + 1 < marks.length) {
        /* 重新扫下个 case 的位置 */
        const re2 = /case\s+(['"])([\w-]+)\1\s*:/g;
        re2.lastIndex = marks[i].start;
        const nm = re2.exec(swBody);
        if (nm) end2 = nm.index;
      }
      let piece = swBody.slice(marks[i].start, end2);
      /* 去尾 continue / break / 空语句 */
      piece = piece.replace(/\bcontinue\s*;?\s*$/, '').replace(/\bbreak\s*;?\s*$/, '').trim();
      cases[marks[i].key] = piece;
    }
    /* 按序拼接 */
    const order = ordStr.split('|');
    const restored = order.map(function (k) { return cases[k] || ('/* missing case ' + k + ' */'); }).join('\n');
    /* 尾部 break; 也可能是独立语句——保留 while 后内容 */
    const tail = src.slice(wClose + 1);
    return src.slice(0, dm.index) + restored + tail;
  }

  /* ============================================================
   * AST 辅助（B04）——acorn 可用且源码可解析时，变换才被允许
   * 旧实现用全文正则删 debugger / 内联字符串数组，会：
   *   globalThis.result="debugger"  →  字符串内容被删空
   *   {debugger:1}                  →  属性名被删
   *   const a=["x","y"];a[0]="new"  →  生成 "x"="new" 非法赋值
   * ============================================================ */

  function jsAst(text) {
    if (typeof acorn === 'undefined' || !acorn || typeof acorn.parse !== 'function') return null;
    try {
      return acorn.parse(text, {
        ecmaVersion: 'latest',
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowHashBang: true,
        allowSuperOutsideMethod: true,
        allowImportExportEverywhere: true,
      });
    } catch (e) {
      return null;
    }
  }

  function astWalk(node, visit, parent, key) {
    if (!node || typeof node.type !== 'string') return;
    visit(node, parent, key);
    for (const k in node) {
      if (k === 'loc' || k === 'range' || k === 'parent' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i].type === 'string') astWalk(v[i], visit, node, k);
      } else if (v && typeof v.type === 'string') astWalk(v, visit, node, k);
    }
  }

  /* 只删真正的 DebuggerStatement；字符串、注释、属性名里的 debugger 一律不动 */
  function stripDebugger(text) {
    const ast = jsAst(text);
    if (!ast) return null;
    const spans = [];
    astWalk(ast, function (n) {
      if (n.type === 'DebuggerStatement') spans.push([n.start, n.end]);
    });
    if (!spans.length) return { text: text, count: 0 };
    spans.sort((a, b) => a[0] - b[0]);
    let out = text;
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i][0];
      let j = spans[i][1];
      /* 吃掉紧跟的分号；没有分号就留一个空语句，避免把 if/while 的 body 吞掉 */
      while (j < out.length && /[\s\uFEFF]/.test(out[j])) j++;
      const end = out[j] === ';' ? j + 1 : spans[i][1];
      out = out.slice(0, s) + ';' + out.slice(end);
    }
    return { text: out, count: spans.length };
  }

  function patternHasIdent(node, name) {
    let hit = false;
    astWalk(node, function (n) {
      if (n.type === 'Identifier' && n.name === name) hit = true;
    });
    return hit;
  }

  /* 常量字符串数组内联：只替换「读」，且只在证明安全后才动 */
  function inlineConstArrays(text) {
    const ast = jsAst(text);
    if (!ast) return null;
    const decls = new Map();
    let unsafe = false;

    astWalk(ast, function (n) {
      if (n.type !== 'VariableDeclarator') return;
      if (!n.id || n.id.type !== 'Identifier' || !n.init || n.init.type !== 'ArrayExpression') return;
      const els = n.init.elements;
      if (!els || !els.length) return;
      const ok = els.every(function (e) {
        if (!e) return false;
        if (e.type === 'Literal') return true;
        if (e.type === 'UnaryExpression' && (e.operator === '-' || e.operator === '+') && e.argument && e.argument.type === 'Literal') return true;
        return false;
      });
      if (!ok) return;
      if (decls.has(n.id.name)) { unsafe = true; return; } /* 重复声明，放弃 */
      decls.set(n.id.name, els.map(function (e) { return text.slice(e.start, e.end); }));
    });
    if (!decls.size || unsafe) return { text: text, count: 0, reason: unsafe ? '数组被重复声明，已跳过' : '' };

    const reads = [];
    astWalk(ast, function (n, parent) {
      if (unsafe) return;
      /* 写入 / 自增 / 解构赋值：整组放弃 */
      if (n.type === 'AssignmentExpression' && n.left) {
        for (const nm of decls.keys()) if (patternHasIdent(n.left, nm)) unsafe = true;
      }
      if (n.type === 'UpdateExpression' && n.argument) {
        for (const nm of decls.keys()) if (patternHasIdent(n.argument, nm)) unsafe = true;
      }
      if (n.type === 'ArrayExpression' || n.type === 'ObjectExpression') return;

      if (n.type === 'MemberExpression' && n.object && n.object.type === 'Identifier' && decls.has(n.object.name)) {
        const arr = decls.get(n.object.name);
        const p = n.property;
        const idx = n.computed && p && p.type === 'Literal' && typeof p.value === 'number' && Number.isInteger(p.value) && p.value >= 0 ? p.value : null;
        if (idx === null || idx >= arr.length) { unsafe = true; return; }
        let src = arr[idx];
        /* -1 这类带符号字面量在 `-a[0]` / `a[0]**2` 上下文会变成 --1 / -1**2（语法错误），加括号 */
        if (/^[-+]/.test(src)) src = '(' + src + ')';
        reads.push({ start: n.start, end: n.end, src: src });
        return;
      }
      /* 裸标识符：只有当它作为被内联 MemberExpression 的 object 时才允许，
         其余（传参、别名、.length、for-of 迭代等）一律判定为不安全 */
      if (n.type === 'Identifier' && decls.has(n.name)) {
        if (parent && parent.type === 'MemberExpression' && parent.object === n) return;
        if (parent && parent.type === 'VariableDeclarator' && parent.id === n) return;
        unsafe = true;
      }
    });
    if (unsafe) return { text: text, count: 0, reason: '数组存在写入 / 别名 / 非字面量下标，已跳过内联（避免生成非法赋值）' };
    if (!reads.length) return { text: text, count: 0 };
    reads.sort((a, b) => a.start - b.start);
    let out = text;
    for (let i = reads.length - 1; i >= 0; i--) out = out.slice(0, reads[i].start) + reads[i].src + out.slice(reads[i].end);
    return { text: out, count: reads.length };
  }

  /* ============================================================
   * obfuscator.io 标准字符串数组还原
   *
   * 真实产物形态（缺一不可，少认一个就还原不出来）：
   *   function _0x42c2(){ var _0x2cdc=['a','b',…]; _0x42c2=function(){return _0x2cdc;};
   *                       return _0x42c2(); }
   *   (function(a,b){ while(true){ try{ …校验和… if(x===b)break; else arr.push(arr.shift()); }
   *                    catch(e){ arr.push(arr.shift()); } } }(_0x42c2, 0xa4a22));
   *   function _0x53ec(a,b){ var A=_0x42c2(); return _0x53ec=function(x,y){ x=x-0x150;
   *                          var v=A[x]; return v; }, _0x53ec(a,b); }
   *   var _0x2ec7e0=_0x53ec;          ← 别名，调用点用的是别名
   *
   * 旋转次数由「校验和 == 目标值」决定，静态算不出来（要调用解码器，循环依赖）。
   * 唯一可靠做法是只把这三个片段放进受限作用域跑一次——不执行目标文件的业务代码。
   * ============================================================ */
  function matchBrace(text, openIdx) {
    let depth = 0;
    let q = null;
    for (let i = openIdx; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '\\') { i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return -1; continue; }
      if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) return i; }
    }
    return -1;
  }

  function fnSourceAt(text, name) {
    const re = new RegExp('function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
    const m = re.exec(text);
    if (!m) return null;
    const open = text.indexOf('{', m.index + m[0].length);
    if (open < 0) return null;
    const close = matchBrace(text, open);
    if (close < 0) return null;
    return { start: m.index, end: close + 1, src: text.slice(m.index, close + 1), body: text.slice(open + 1, close) };
  }

  function obfuscatorIoInline(src) {
    /* 1) 找自改写解码器：函数体里出现 `自己 = function(...)` 且读取某个数组 */
    const decNameRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    let dec = null;
    while ((m = decNameRe.exec(src))) {
      const name = m[1];
      const fn = fnSourceAt(src, name);
      if (!fn) continue;
      const selfRew = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\s*=\\s*function').test(fn.body);
      const builderCall = /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(fn.body);
      const arrUse = /\[\s*[A-Za-z_$][\w$]*\s*\]/.test(fn.body);
      if (selfRew && builderCall && arrUse) { dec = { name: name, fn: fn, arrVar: builderCall[1], builder: builderCall[2] }; break; }
    }
    if (!dec) return null;

    /* 2) 数组构建函数：体内有 `var A=[…]` 且 `return A()` */
    const builderFn = fnSourceAt(src, dec.builder);
    if (!builderFn) return null;
    const litM = /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*\[/.exec(builderFn.body);
    if (!litM) return null;
    const arrVar = litM[1];

    /* 3) 旋转 IIFE：`(function(…){…}(BUILDER, 0xNN))` */
    let rot = null;
    const rotRe = new RegExp('\\(\\s*function\\s*\\([^)]*\\)\\s*\\{', 'g');
    while ((m = rotRe.exec(src))) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(src, open);
      if (close < 0) continue;
      let tail = src.slice(close + 1, close + 200);
      const call = new RegExp('^\\s*\\(\\s*' + dec.builder.replace(/\$/g, '\\$') + '\\s*,').exec(tail);
      if (!call) continue;
      const endParen = src.indexOf('))', close + 1);
      if (endParen < 0) continue;
      rot = { start: m.index, end: endParen + 2, src: src.slice(m.index, endParen + 2) };
      break;
    }

    /* 4) 别名：真实产物会把解码器层层转手
          var _0x326650=_0x53ec,_0x1abf47=_0x326650,_0x3c0824=_0x1abf47,…
       必须迭代到不动点，只认第一层会漏掉绝大多数调用点。 */
    const aliases = [dec.name];
    const known = new Set(aliases);
    for (let round = 0; round < 12; round++) {
      let changed = false;
      const assignRe = /(^|[^.\w$])(?:var\s+|let\s+|const\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?=[,;)])/gm;
      let am;
      while ((am = assignRe.exec(src))) {
        const to = am[2];
        const from = am[3];
        if (known.has(from) && !known.has(to)) {
          known.add(to);
          aliases.push(to);
          changed = true;
        }
      }
      if (!changed) break;
    }

    /* 5) 受限执行：只跑「构建器 + 解码器 + 旋转」，清掉宿主入口 */
    let arr = null;
    try {
      const sandboxSrc = [
        '"use strict";',
        builderFn.src,
        dec.fn.src,
        rot ? rot.src : '',
        'var __out = ' + dec.builder + '();',
        'return Array.isArray(__out) ? __out : null;',
      ].join('\n');
      /* 关掉常见外泄口：window/document/self/fetch/importScripts 全部置 undefined */
      const blocked = ['window', 'document', 'self', 'globalThis', 'fetch', 'XMLHttpRequest', 'importScripts', 'postMessage', 'WebSocket', 'localStorage', 'indexedDB', 'Worker'];
      const runner = Function.apply(null, blocked.concat([sandboxSrc]));
      arr = runner.apply(null, blocked.map(function () { return undefined; }));
    } catch (e) {
      return { text: src, count: 0, reason: '字符串数组由自改写解码器保护，执行还原失败：' + (e && e.message) };
    }
    if (!Array.isArray(arr) || !arr.length) return { text: src, count: 0, reason: '字符串数组解码器没有返回数组，已跳过' };

    /* 6) 计算解码后的值：优先用解码器自身（它可能还含 base64/偏移逻辑），失败则直接取数组 */
    const decoded = new Map();
    let decFn = null;
    try {
      const sandboxSrc = [
        '"use strict";',
        builderFn.src,
        dec.fn.src,
        rot ? rot.src : '',
        'return ' + dec.name + ';',
      ].join('\n');
      const blocked = ['window', 'document', 'self', 'globalThis', 'fetch', 'XMLHttpRequest', 'importScripts', 'postMessage', 'WebSocket', 'localStorage', 'indexedDB', 'Worker'];
      decFn = Function.apply(null, blocked.concat([sandboxSrc])).apply(null, blocked.map(function () { return undefined; }));
    } catch (e) { decFn = null; }

    /* 7) 替换所有 `解码器(0xNN)` / `别名(0xNN[, …])` */
    let hits = 0;
    const nameAlt = aliases.map(function (a) { return a.replace(/\$/g, '\\$'); }).join('|');
    const callRe = new RegExp('\\b(?:' + nameAlt + ')\\s*\\(\\s*(0x[0-9a-fA-F]+|\\d+)\\s*(?:,\\s*[^()]*)?\\)', 'g');
    const out = src.replace(callRe, function (all, idx) {
      const n = /^0x/i.test(idx) ? parseInt(idx, 16) : parseInt(idx, 10);
      let val;
      if (decFn) {
        try { val = decFn(n); } catch (e) { val = undefined; }
      }
      if (val === undefined) val = arr[n];
      if (typeof val !== 'string') return all;
      hits++;
      return encodeJsString(val, "'");
    });
    return { text: out, count: hits, reason: hits ? '' : '解码器已就绪但调用点不是数字字面量（可能被变量下标混淆），未替换' };
  }

  function deobf(src, opts) {
    opts = opts || {};
    let s = String(src == null ? '' : src);
    const report = [];

    /* 6b. 控制流平坦化还原（obfuscator.io 顺序数组型） */
    let flatHit = 0;
    for (let guard = 0; guard < 100; guard++) {
      const next = restoreFlat(s);
      if (!next) break;
      s = next;
      flatHit++;
    }
    if (flatHit) report.push({ step: 'flat-switch', count: flatHit, msg: '还原控制流平坦化（while+switch 顺序数组重排为线性代码）' });

    /* 1. 去 debugger —— B04：优先按 AST 只删 DebuggerStatement */
    if (opts.debugger !== false) {
      const r = stripDebugger(s);
      if (r && r.count) {
        s = r.text;
        report.push({ step: 'debugger', count: r.count, msg: '删除 debugger 语句（AST 定位，字符串与属性名不受影响）' });
      } else if (!r) {
        /* acorn 不可用或不完整片段：退回正则，但排除字符串 / 注释里的 debugger */
        const guarded = s.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1|(\/[*][\s\S]*?[*]\/|\/\/[^\n]*)|(\bdebugger\b\s*;?)/g,
          function (mm, q, cm, dbg) { return dbg ? '' : mm; });
        if (guarded !== s) {
          const cnt = (s.match(/\bdebugger\b/g) || []).length - (guarded.match(/\bdebugger\b/g) || []).length;
          s = guarded;
          report.push({ step: 'debugger', count: cnt, msg: '删除 debugger 语句（正则降级，已跳过字符串与注释）' });
        }
      }
    }

    /* 2. 空死循环反调试 */
    const deadRe = /while\s*\(\s*(?:!!\s*\[\]|true|1|!0|!!\s*1)\s*\)\s*\{\s*\}/g;
    const dead = s.match(deadRe);
    if (dead) {
      s = s.replace(deadRe, '');
      report.push({ step: 'deadloop', count: dead.length, msg: '删除空死循环反调试' });
    }

    /* 2b. obfuscator.io：自改写解码器 + 校验和旋转的字符串数组（真实产物最常见形态） */
    if (opts.unescape !== false) {
      const ob = obfuscatorIoInline(s);
      if (ob) {
        if (ob.count) {
          s = ob.text;
          report.push({ step: 'ob-string-array', count: ob.count, msg: '还原 obfuscator.io 字符串数组（自改写解码器 + 旋转校验，已就地内联 ' + ob.count + ' 处）' });
        } else if (ob.reason) {
          report.push({ step: 'ob-skip', count: 0, msg: ob.reason });
        }
      }
    }

    /* 3. 字符串数组还原 —— B04：优先 AST 内联（只替换读取，写入/别名一律跳过） */
    let arrHits = 0;
    let inlineReason = '';
    function restoreArrays(text) {
      const safe = inlineConstArrays(text);
      if (safe) {
        if (safe.count) arrHits += safe.count;
        if (safe.reason) inlineReason = safe.reason;
        return safe.text;
      }
      /* 降级：正则替换，但先排除有写入风险的数组，避免生成 "x"="new" 这类非法赋值 */
      let out = text;
      for (const arr of findArrays(text)) {
        const nm = arr.name.replace(/\$/g, '\\$');
        if (new RegExp('\\b' + nm + '\\s*=(?!=)').test(out)) continue;
        if (new RegExp('\\b' + nm + '\\s*\\[[^\\]]*\\]\\s*(?:=(?!=)|\\+\\+|--|[-+*/%|&^]=)').test(out)) continue;
        const items = splitTopLevel(arr.body).map(litOf);
        if (items.length < 3) continue;
        const idxUse = new RegExp('\\b' + nm + '\\s*\\[\\s*(0x[0-9a-fA-F]+|\\d+)\\s*\\]', 'g');
        out = out.replace(idxUse, (mm, idx) => {
          const n = /^0x/i.test(idx) ? parseInt(idx, 16) : parseInt(idx, 10);
          if (n < 0 || n >= items.length || items[n] === null) return mm;
          arrHits++;
          return items[n];
        });
      }
      return out;
    }
    function findArrays(text) {
      const re = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;
      const res = [];
      let m;
      while ((m = re.exec(text))) {
        const start = m.index + m[0].length;
        let depth = 1;
        let i = start;
        let q = null;
        for (; i < text.length; i++) {
          const c = text[i];
          if (q) {
            if (c === '\\') { i++; continue; }
            if (c === q) q = null;
            continue;
          }
          if (c === '"' || c === "'" || c === '`') { q = c; continue; }
          if (c === '[') depth++;
          else if (c === ']') { depth--; if (depth === 0) break; }
        }
        if (depth !== 0) continue;
        res.push({ name: m[1], body: text.slice(start, i) });
        re.lastIndex = i + 1;
      }
      return res;
    }
    function splitTopLevel(body) {
      const out = [];
      let buf = '';
      let depth = 0;
      let q = null;
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (q) {
          buf += c;
          if (c === '\\') { buf += body[++i] || ''; continue; }
          if (c === q) q = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; buf += c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') depth--;
        if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
        buf += c;
      }
      if (buf.trim()) out.push(buf);
      return out;
    }
    function litOf(src) {
      const s = String(src || '').trim();
      if (!s) return null;
      if (/^(['"])(?:\\.|(?!\1)[^\\])*\1$/.test(s)) return s;
      const parts = s.split(/\s*\+\s*/);
      if (parts.length > 1 && parts.every((p) => /^(['"])(?:\\.|(?!\1)[^\\])*\1$/.test(p))) {
        const q = parts[0][0];
        return q + parts.map((p) => p.slice(1, -1)).join('') + q;
      }
      if (/^(?:0x[0-9a-fA-F]+|\d+)(?:\s*\+\s*(?:0x[0-9a-fA-F]+|\d+))*$/.test(s)) {
        const sum = s.split('+').reduce((a, b) => a + Number(b.trim()), 0);
        if (isFinite(sum)) return String(sum);
      }
      const fcc = /^String\.fromCharCode\(([^)]*)\)$/.exec(s);
      if (fcc) {
        const codes = fcc[1].split(',').map((x) => parseInt(x.trim(), 0)).filter((n) => n >= 0 && n <= 0x10ffff);
        if (codes.length && codes.length < 500) return JSON.stringify(String.fromCharCode.apply(null, codes));
      }
      return null;
    }
    /* 3c. OB 字符串数组旋转还原：(function(a,b){ ...a.push(a.shift())... }(arr, N))
       旧实现用非贪婪正则 `\{([\s\S]{0,3000}?)\}` 取函数体，遇到体内嵌套的 function(){…}
       就在第一个 } 处截断，导致几乎从不命中（真实 OB 输出 100% 命中不了）。
       这里改成花括号配对定位函数体。 */
    try {
      let rotHit = 0;
      const headRe = /\(\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g;
      let hm;
      const jobs = [];
      while ((hm = headRe.exec(s))) {
        const p1 = hm[1], p2 = hm[2];
        const bodyStart = hm.index + hm[0].length;
        let depth = 1, q = null, i = bodyStart;
        for (; i < s.length; i++) {
          const c = s[i];
          if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
          if (c === '"' || c === "'" || c === '`') { q = c; continue; }
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (!depth) break; }
        }
        if (depth !== 0) continue;
        const body = s.slice(bodyStart, i);
        const e1 = p1.replace(/\$/g, '\\$');
        /* 真实 OB 常见 _0x1['push']() 方括号写法，成员访问还原是在后面才做的，这里两种都要认 */
        const dotOrBr = '\\s*(?:\\.\\s*|\\[\\s*[\'"])';
        if (!new RegExp('\\b' + e1 + dotOrBr + '(?:push|unshift)[\'"]?\\s*\\]?\\s*\\(').test(body)) continue;
        if (!new RegExp('\\b' + e1 + dotOrBr + '(?:shift|pop)[\'"]?\\s*\\]?\\s*\\(').test(body)) continue;
        const after = s.slice(i + 1, i + 220);
        const callM = /^\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([^)]{1,60})\s*\)\s*\)\s*;?/.exec(after);
        if (!callM) continue;
        /* while(--x) 的迭代次数 = 初值-1；若内层调用是 x(++b) 则初值已是 b+1 */
        const inner = new RegExp('\\w+\\s*\\(\\s*(\\+\\+|--)?\\s*' + p2.replace(/\$/g, '\\$') + '\\s*\\)').exec(body);
        jobs.push({
          arrName: callM[1], countExpr: callM[2].trim(), pre: inner ? (inner[1] || '') : '',
          start: hm.index, end: i + 1 + callM[0].length,
        });
        headRe.lastIndex = i + 1 + callM[0].length;
      }
      /* 从后往前处理：前面的替换会让后面的下标失效 */
      for (let ji = jobs.length - 1; ji >= 0; ji--) {
        const it = jobs[ji];
        const n0 = foldNum(it.countExpr);
        if (n0 === null || n0 < 0 || n0 > 100000) continue;
        const n = it.pre === '++' ? n0 : it.pre === '--' ? n0 - 2 : n0 - 1;
        if (n <= 0) continue;
        /* 先删 IIFE（用扫描时算好的区间；从后往前，前面 job 的下标仍有效） */
        s = s.slice(0, it.start) + '/* 旋转 IIFE 已应用 */' + s.slice(it.end);
        /* 再旋转数组（此时位置已变，重新定位） */
        const arr = findArrays(s).find((a) => a.name === it.arrName);
        if (!arr) continue;
        const items = splitTopLevel(arr.body).map((x) => litOf(x) || foldConstExpr(x) || x.trim());
        if (items.length < 3) continue;
        const k = ((n % items.length) + items.length) % items.length;
        const rotated = items.slice(k).concat(items.slice(0, k));
        const arrRe = new RegExp('(var|let|const)\\s+' + it.arrName.replace(/\$/g, '\\$') + '\\s*=\\s*\\[', 'g');
        const am2 = arrRe.exec(s);
        if (!am2) continue;
        const st = am2.index + am2[0].length;
        let d2 = 1, q2 = null, j = st;
        for (; j < s.length; j++) {
          const c = s[j];
          if (q2) { if (c === '\\') { j++; continue; } if (c === q2) q2 = null; continue; }
          if (c === '"' || c === "'" || c === '`') { q2 = c; continue; }
          if (c === '[') d2++;
          else if (c === ']') { d2--; if (!d2) break; }
        }
        s = s.slice(0, st) + rotated.join(', ') + s.slice(j);
        rotHit++;
      }
      if (rotHit) {
        s = restoreArrays(s);
        report.push({ step: 'array-rotate', count: rotHit, msg: '还原字符串数组旋转（OB shuffle），并按索引回填' });
      }
    } catch (e) { /* 旋转还原失败不影响其他步骤 */ }

    s = restoreArrays(s);
    if (arrHits) report.push({ step: 'string-array', count: arrHits, msg: '还原字符串数组访问（仅替换读取，写入与别名已跳过）' });
    else if (inlineReason) report.push({ step: 'string-array-skip', count: 0, msg: inlineReason });

    /* 3a2. OB 标准取值函数（obfuscator.io 默认形态）：
         var _0x9c0d = function(_0x1,_0x2){ _0x1 = _0x1 - 0x0; var _0x3 = _0x1a2b[_0x1]; return _0x3; };
       原来的 fnRe 只认「function 声明 + 单参数直取」，覆盖不到这种多参数 + 偏移 + 中间变量的写法，
       而它恰恰是 OB 输出的默认形态——不还原这一步，反混淆基本等于没做。 */
    let objDecHit = 0;
    try {
      const decRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\)\s*\{([\s\S]{0,600}?)\}\s*;/g;
      const defs = [];
      let dm;
      while ((dm = decRe.exec(s))) {
        const name = dm[1];
        const arg = dm[2];
        const body = dm[3];
        const argEsc = arg.replace(/\$/g, '\\$');
        const offM = new RegExp('\\b' + argEsc + '\\s*=\\s*' + argEsc + '\\s*-\\s*(0x[0-9a-fA-F]+|\\d+)').exec(body);
        const arrM = new RegExp('([A-Za-z_$][\\w$]*)\\s*\\[\\s*' + argEsc + '\\s*\\]').exec(body);
        if (!arrM) continue;
        /* 只认「体内只有取数组元素并返回」的纯取值函数，避免误伤业务函数 */
        if (/[^.\w$]window[.\s]|document\.|eval\s*\(|function\s*\(/.test(body)) continue;
        defs.push({
          name: name, arg: arg, arr: arrM[1],
          off: offM ? parseInt(offM[1], 0) : 0,
          start: dm.index, end: dm.index + dm[0].length,
        });
      }
      const cut = [];
      for (const df of defs) {
        const arrs = findArrays(s);
        const arr = arrs.find((a) => a.name === df.arr);
        if (!arr) continue;
        const items = splitTopLevel(arr.body).map((x) => litOf(x) || foldConstExpr(x) || x.trim());
        if (items.length < 2) continue;
        const callRe = new RegExp('\\b' + df.name.replace(/\$/g, '\\$') + '\\s*\\(\\s*(0x[0-9a-fA-F]+|\\d+)\\s*(?:,[^)]{0,40})?\\)', 'g');
        let localHit = 0;
        s = s.replace(callRe, function (all, idx) {
          const n = /^0x/i.test(idx) ? parseInt(idx, 16) : parseInt(idx, 10);
          const real = n - df.off;
          if (!isFinite(real) || real < 0 || real >= items.length) return all;
          const v = items[real];
          if (v == null) return all;
          localHit++;
          return v;
        });
        if (localHit) { objDecHit += localHit; cut.push(df); }
      }
      /* 取值函数已全部内联 → 定义本身删掉，减少噪音 */
      for (let i = cut.length - 1; i >= 0; i--) {
        const df = cut[i];
        s = s.slice(0, df.start) + '/* 取值函数 ' + df.name + ' 已内联 */' + s.slice(df.end);
      }
      if (objDecHit) {
        s = restoreArrays(s);
        report.push({ step: 'decoder-inline', count: objDecHit, msg: '内联 OB 取值函数 _0xN(0xM)（含索引偏移）' });
      }
    } catch (e) { /* 内联失败不影响其他步骤 */ }

    /* 3b. 取值函数 _0xabc(0x1) */
    const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*return\s+([A-Za-z_$][\w$]*)\s*\[\s*\2\s*\]\s*;?\s*\}/g;
    let fnHit = 0;
    {
      const defs = [];
      let dm;
      while ((dm = fnRe.exec(s))) defs.push([dm[1], dm[3]]);
      for (const [fname, arrName] of defs) {
        const callRe = new RegExp('\\b' + fname.replace(/\$/g, '\\$') + '\\s*\\(\\s*(0x[0-9a-fA-F]+|\\d+)\\s*\\)', 'g');
        s = s.replace(callRe, (mm, idx) => {
          const n = /^0x/i.test(idx) ? parseInt(idx, 16) : parseInt(idx, 10);
          fnHit++;
          return arrName + '[' + n + ']';
        });
      }
    }
    if (fnHit) {
      s = restoreArrays(s);
      report.push({ step: 'decoder-fn', count: fnHit, msg: '内联字符串取值函数并还原' });
    }

    /* 4. 字符串内转义还原 + 十六进制数字（只处理字面量与代码段，不破坏注释） */
    const segs = segments(s);
    let escHit = 0;
    let hexHit = 0;
    const rebuilt = segs.map((sg) => {
      if (sg.type === 'str' && opts.unescape !== false && sg.quote !== '`') {
        const q = sg.text[0];
        const body = sg.text.slice(1, -1);
        const next = unescapeJsString(body);
        if (next === body) return sg.text;
        escHit++;
        /* 必须重新编码：解出来的可能是引号/反斜杠/换行 */
        return encodeJsString(next, q);
      }
      if (sg.type === 'code') {
        const next = sg.text.replace(/\b0x([0-9a-fA-F]+)\b/g, (all, h) => {
          hexHit++;
          return String(parseInt(h, 16));
        });
        return next;
      }
      return sg.text;
    });
    s = rebuilt.join('');
    if (escHit) report.push({ step: 'escape', count: escHit, msg: '还原字符串中的 \\xNN / \\uNNNN 转义' });
    if (hexHit) report.push({ step: 'hex-number', count: hexHit, msg: '十六进制数字转十进制' });

    /* 5. 通用常量折叠：字符串拼接 / 数字运算 / 字符串+数字（受限求值，多轮迭代）
       直接对全文折叠：LIT_STR 自带引号匹配，不会误伤字符串内部 */
    let foldHit = 0;
    for (let round = 0; round < 6; round++) {
      const before = s;
      s = foldConstants(s);
      if (s === before) break;
    }
    foldHit = foldCount;
    foldCount = 0;
    if (foldHit) report.push({ step: 'const-fold', count: foldHit, msg: '折叠常量表达式（拼接/算术/位运算）' });

    /* 6. String.fromCharCode */
    let fccHit = 0;
    s = s.replace(/String\.fromCharCode\(\s*((?:0x[0-9a-fA-F]+|\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|\d+))*)\s*\)/g, (all, args) => {
      const codes = args.split(',').map((x) => parseInt(x.trim(), 0)).filter((n) => n >= 0 && n <= 0x10ffff);
      if (!codes.length || codes.length > 2000) return all;
      fccHit++;
      return JSON.stringify(String.fromCharCode.apply(null, codes));
    });
    if (fccHit) report.push({ step: 'fromCharCode', count: fccHit, msg: '还原 String.fromCharCode' });

    /* 7. obj['prop'] -> obj.prop */
    let memHit = 0;
    const memRe = /([A-Za-z_$][\w$]*)\s*\[\s*(['"])([A-Za-z_$][\w$]*)\2\s*\]/g;
    s = s.replace(memRe, (all, obj, q, prop) => {
      memHit++;
      return obj + '.' + prop;
    });
    if (memHit) report.push({ step: 'member', count: memHit, msg: '把 obj["prop"] 改为 obj.prop' });

    /* 8. 常见 eval/Function 包壳提示 */
    if (/\beval\s*\(|\bFunction\s*\(/.test(s)) {
      report.push({ step: 'eval', count: 0, msg: '仍存在 eval / Function 动态执行，需要用调试器跟栈或在控制台打印实参' });
    }

    return { text: s, report: report, stats: { inBytes: src.length, outBytes: s.length } };
  }

  /* ============================================================
   * HTML 格式化
   * ============================================================ */

  const VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  const RAW_TAGS = { script: 1, style: 1, textarea: 1, pre: 1, xmp: 1 };
  const INLINE_TAGS = { a: 1, abbr: 1, b: 1, bdi: 1, bdo: 1, br: 1, cite: 1, code: 1, data: 1, del: 1, dfn: 1, em: 1, i: 1, ins: 1, kbd: 1, label: 1, mark: 1, q: 1, rp: 1, rt: 1, ruby: 1, s: 1, samp: 1, small: 1, span: 1, strong: 1, sub: 1, sup: 1, time: 1, u: 1, var: 1, wbr: 1, button: 1, option: 1, img: 1 };

  function html(src, opts) {
    opts = opts || {};
    const unit = opts.indent === '\t' ? '\t' : ' '.repeat(Math.max(0, Math.min(8, opts.indent == null ? 2 : Number(opts.indent) || 0)));
    const wrapWidth = opts.wrapWidth || 0;
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const out = [];
    let lvl = 0;
    let i = 0;
    const n = text.length;
    let inlineBuf = '';

    function ind() { return unit.repeat(lvl); }
    function pushLine(s) {
      if (inlineBuf.trim()) { flushInline(); }
      out.push(ind() + s);
    }
    function flushInline() {
      const s = inlineBuf.replace(/\s+/g, ' ').trim();
      if (s) out.push(ind() + s);
      inlineBuf = '';
    }
    function appendInline(s) {
      inlineBuf += s;
      if (inlineBuf.length > 100000) flushInline();
    }

    while (i < n) {
      if (text.startsWith('<!--', i)) {
        const j = text.indexOf('-->', i + 4);
        const end = j < 0 ? n : j + 3;
        pushLine(text.slice(i, end).trim());
        i = end;
        continue;
      }
      if (text.startsWith('<![CDATA[', i)) {
        const j = text.indexOf(']]>', i);
        const end = j < 0 ? n : j + 3;
        pushLine(text.slice(i, end).trim());
        i = end;
        continue;
      }
      if (text[i] === '<' && /[a-zA-Z!/]/.test(text[i + 1] || '')) {
        const tagEnd = findTagEnd(text, i);
        const raw = text.slice(i, tagEnd);
        const m = /^<\s*(\/?)\s*([a-zA-Z][\w:.-]*)/.exec(raw);
        if (!m) { appendInline(raw); i = tagEnd; continue; }

        const closing = m[1] === '/';
        const name = m[2].toLowerCase();
        const selfClose = /\/\s*>$/.test(raw);
        const isInline = INLINE_TAGS[name] === 1 && !closing;

        if (closing) {
          if (INLINE_TAGS[name] === 1) {
            appendInline(raw);
            i = tagEnd;
            continue;
          }
          flushInline();
          lvl = Math.max(0, lvl - 1);
          pushLine(raw.replace(/\s+/g, ' ').trim());
          i = tagEnd;
          continue;
        }

        if (RAW_TAGS[name] === 1) {
          flushInline();
          const closeRe = new RegExp('</\\s*' + name + '\\s*>', 'i');
          const rest = text.slice(tagEnd);
          const cm = closeRe.exec(rest);
          const innerEnd = cm ? tagEnd + cm.index : n;
          const inner = text.slice(tagEnd, innerEnd);
          pushLine(formatTag(raw, wrapWidth, ind));
          if (inner.trim()) {
            const body = opts.formatEmbedded && (name === 'script' || name === 'style')
              ? (name === 'script' ? js(inner, { indent: unit }) : css(inner, unit)).replace(/\s+$/, '')
              : inner.replace(/^\n+|\n+$/g, '');
            body.split('\n').forEach((l) => {
              out.push(ind() + unit + l.replace(/\s+$/, ''));
            });
          }
          if (cm) pushLine('</' + name + '>');
          i = cm ? innerEnd + cm[0].length : n;
          continue;
        }

        if (isInline) {
          appendInline(formatTag(raw, 0, null));
          if (VOID_TAGS[name] || selfClose) { /* 空元素不入栈 */ }
          i = tagEnd;
          continue;
        }

        flushInline();
        /* 短纯文本内容与标签同排，例如 <title>T</title>、<li>one</li> */
        if (!VOID_TAGS[name] && !selfClose) {
          const rest = text.slice(tagEnd);
          const nextLt = rest.indexOf('<');
          if (nextLt > 0) {
            const inner = rest.slice(0, nextLt);
            const after = rest.slice(nextLt);
            const closeRe2 = new RegExp('^<\\/\\s*' + name + '\\s*>', 'i');
            if (!/[<>]/.test(inner) && inner.trim() && inner.length < 90 && closeRe2.test(after)) {
              const closeLen = closeRe2.exec(after)[0].length;
              pushLine(formatTag(raw, wrapWidth, ind) + inner.replace(/\s+/g, ' ').trim() + after.slice(0, closeLen));
              i = tagEnd + nextLt + closeLen;
              continue;
            }
          }
        }
        pushLine(formatTag(raw, wrapWidth, ind));
        if (!VOID_TAGS[name] && !selfClose) lvl++;
        i = tagEnd;
        continue;
      }

      /* 文本节点 */
      const lt = text.indexOf('<', i);
      const end = lt < 0 ? n : lt;
      const chunk = text.slice(i, end);
      if (chunk.trim()) {
        const pretty = chunk.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s{2,}/g, ' ');
        if (inlineBuf) appendInline(pretty);
        else pushLine(pretty.trim());
      }
      i = end;
    }
    flushInline();
    return out.join('\n') + '\n';
  }

  function findTagEnd(text, i) {
    let j = i + 1;
    let q = null;
    while (j < text.length) {
      const c = text[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '>') return j + 1;
      j++;
    }
    return text.length;
  }

  function formatTag(raw, wrapWidth, indentFn) {
    const flat = raw.replace(/\s+/g, ' ').replace(/\s*\/>$/, ' />').replace(/\s*>$/, '>');
    if (!wrapWidth || flat.length + (indentFn ? indentFn().length : 0) <= wrapWidth) return flat;
    const m = /^<\s*(\/?)\s*([a-zA-Z][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(flat);
    if (!m) return flat;
    const attrs = [];
    const re = /([^\s=/>]+)(?:\s*=\s*("(?:[^"]*)"|'(?:[^']*)'|[^\s>]+))?/g;
    let am;
    const body = m[3];
    while ((am = re.exec(body))) attrs.push(am[1] + (am[2] ? '=' + am[2] : ''));
    if (attrs.length < 2) return flat;
    const pad = (indentFn ? indentFn() : '') + '  ';
    return '<' + (m[1] || '') + m[2] + '\n' + attrs.map((a) => pad + a).join('\n') + (m[4] ? '\n' + (indentFn ? indentFn() : '') + '/>' : '>');
  }

  function css(src, unit) {
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    let out = '';
    let depth = 0;
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '{') {
        out += buf.trim() + ' {\n';
        depth++;
        out += unit.repeat(depth);
        buf = '';
        continue;
      }
      if (c === '}') {
        out += buf.trim() ? buf.trim() + '\n' : '';
        depth = Math.max(0, depth - 1);
        out += unit.repeat(depth) + '}\n';
        buf = '';
        continue;
      }
      if (c === ';') {
        out += buf.trim() + ';\n' + unit.repeat(depth);
        buf = '';
        continue;
      }
      if (c === '\n') { if (buf.trim()) { out += buf.trim() + ' '; buf = ''; } continue; }
      buf += c;
    }
    if (buf.trim()) out += buf.trim() + '\n';
    return out.replace(/\n{2,}/g, '\n');
  }

  /* ============================================================
   * Python dict / list 字面量 -> JS
   * ============================================================ */

  function parsePy(text, opts) {
    opts = opts || {};
    const s = String(text == null ? '' : text);
    let i = 0;
    const warnings = [];
    let nodes = 0;
    let maxDepth = 0;
    let strings = 0;

    function ws() {
      for (;;) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === '#') {
          while (i < s.length && s[i] !== '\n') i++;
          continue;
        }
        break;
      }
    }
    function fail(msg) {
      const before = s.slice(0, i);
      const ln = (before.match(/\n/g) || []).length + 1;
      const col = i - before.lastIndexOf('\n');
      throw Object.assign(new Error(msg + ' (第 ' + ln + ' 行第 ' + col + ' 列)'), { line: ln, column: col });
    }
    function parseStr() {
      let prefix = '';
      while (i < s.length && /[a-zA-Z]/.test(s[i])) {
        const c = s[i];
        if ('rRbBuUfF'.indexOf(c) < 0) break;
        prefix += c;
        i++;
      }
      const q = s[i];
      if (q !== '"' && q !== "'") fail('期望字符串');
      const triple = s.slice(i, i + 3) === q + q + q;
      const quote = triple ? q + q + q : q;
      i += quote.length;
      let raw = '';
      const isRaw = /r/i.test(prefix);
      while (i < s.length && !s.startsWith(quote, i)) {
        const c = s[i];
        if (c === '\\' && !isRaw) {
          raw += c + (s[i + 1] || '');
          i += 2;
          continue;
        }
        if (c === '\\' && isRaw) {
          raw += c + (s[i + 1] || '');
          i += 2;
          continue;
        }
        raw += c;
        i++;
      }
      if (i >= s.length) fail('字符串未闭合');
      i += quote.length;
      strings++;
      let val;
      if (isRaw) val = raw;
      else val = decodePyEscapes(raw);
      if (/f/i.test(prefix)) warnings.push('f-string 已按普通字符串处理（{...} 原样保留）');
      if (/b/i.test(prefix)) warnings.push('bytes 字面量已按文本处理');
      return val;
    }
    /* 相邻字符串字面量在 Python 里是隐式拼接。pprint / 日志换行会产出
       'long text... '
       'continued...'，旧实现只吃第一个串，于是报「期望逗号或 }」。 */
    function atStrToken() {
      return s[i] === '"' || s[i] === "'" || /^[rRbBuUfF]?['"]/.test(s.slice(i, i + 3));
    }
    function parseStrChain() {
      let v = parseStr();
      for (;;) {
        const save = i;
        ws();
        if (!atStrToken()) { i = save; break; }
        v += parseStr();
      }
      return v;
    }
    function parseNumber() {
      const m = /^[+-]?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)(?:[jJ])?/.exec(s.slice(i));
      if (!m) fail('非法数字');
      const raw = m[0];
      i += raw.length;
      if (/[jJ]$/.test(raw)) { warnings.push('复数 ' + raw + ' 已忽略虚部'); }
      let t = raw.replace(/_/g, '').replace(/[jJ]$/, '');
      if (/^[+-]?0[xX]/.test(t)) return t[0] === '-' ? -parseInt(t.slice(1), 16) : parseInt(t, 16);
      if (/^[+-]?0[bB]/.test(t)) return t[0] === '-' ? -parseInt(t.slice(1), 2) : parseInt(t, 2);
      if (/^[+-]?0[oO]/.test(t)) return t[0] === '-' ? -parseInt(t.slice(1), 8) : parseInt(t, 8);
      return Number(t);
    }
    function parseValue(depth) {
      ws();
      if (depth > maxDepth) maxDepth = depth;
      if (depth > 300) fail('嵌套过深');
      nodes++;
      const c = s[i];
      if (c === '{') {
        i++;
        const obj = {};
        ws();
        if (s[i] === '}') { i++; return obj; }
        for (;;) {
          ws();
          let k;
          if (s[i] === '"' || s[i] === "'" || /^[rRbBuUfF]/.test(s.slice(i, i + 1)) && /^[rRbBuUfF]?['"]/.test(s.slice(i, i + 3))) k = parseStrChain();
          else if (/[\d.+-]/.test(s[i])) k = String(parseNumber());
          else if (s[i] === '(') { i++; const v = parseValue(depth + 1); ws(); if (s[i] === ',') i++; ws(); if (s[i] === ')') i++; k = String(v); }
          else if (/[A-Za-z_]/.test(s[i])) {
            const m = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
            k = m[0];
            i += k.length;
            warnings.push('未加引号的键 ' + k + ' 已按字符串处理');
          } else fail('非法字典键');
          ws();
          if (s[i] !== ':') fail('期望冒号');
          i++;
          obj[k] = parseValue(depth + 1);
          ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === '}') { i++; break; } continue; }
          if (s[i] === '}') { i++; break; }
          fail('期望逗号或 }');
        }
        return obj;
      }
      if (c === '[') {
        i++;
        const arr = [];
        ws();
        if (s[i] === ']') { i++; return arr; }
        for (;;) {
          arr.push(parseValue(depth + 1));
          ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === ']') { i++; break; } continue; }
          if (s[i] === ']') { i++; break; }
          fail('期望逗号或 ]');
        }
        return arr;
      }
      if (c === '(') {
        i++;
        ws();
        if (s[i] === ')') { i++; return []; }
        const arr = [];
        let trailing = false;
        for (;;) {
          arr.push(parseValue(depth + 1));
          ws();
          if (s[i] === ',') { i++; trailing = true; ws(); if (s[i] === ')') { i++; break; } trailing = false; continue; }
          if (s[i] === ')') { i++; break; }
          fail('期望逗号或 )');
        }
        if (arr.length === 1 && !trailing) return arr[0];
        return arr;
      }
      if (c === '"' || c === "'") return parseStrChain();
      if (/^[rRbBuUfF]?['"]/.test(s.slice(i, i + 3))) return parseStrChain();
      if (c === '-' || c === '+' || (c >= '0' && c <= '9') || (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) return parseNumber();
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][\w]*/.exec(s.slice(i));
        const w = m[0];
        i += w.length;
        if (w === 'None' || w === 'none' || w === 'null') return null;
        if (w === 'True' || w === 'true') return true;
        if (w === 'False' || w === 'false') return false;
        if (w === 'set' || w === 'frozenset' || w === 'bytes' || w === 'bytearray') {
          ws();
          if (s[i] === '(') { i++; const v = parseValue(depth + 1); ws(); if (s[i] === ')') i++; return v; }
        }
        if (w === 'datetime' || w === 'Decimal' || w === 'UUID') {
          ws();
          if (s[i] === '(') {
            i++;
            const v = parseValue(depth + 1);
            ws();
            if (s[i] === ')') i++;
            return v;
          }
        }
        warnings.push('未识别的裸标识符 ' + w + '（已按字符串保留）');
        return w;
      }
      fail('无法解析的值');
    }

    ws();
    if (!s.trim()) return { value: null, empty: true, warnings: warnings, stats: { nodes: 0, depth: 0, strings: 0 } };
    /* 允许 "result = {...}" 这类赋值前缀 */
    const assign = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=(?![=>])\s*/.exec(s.slice(i));
    if (assign) {
      const rest = s.slice(i + assign[0].length).replace(/^\s+/, '');
      if (/^[[{('"rRbBuUfF]/.test(rest)) {
        i += assign[0].length;
        warnings.push('已忽略赋值前缀 ' + assign[1].replace(/\s+/g, '') + ' =');
      }
    }
    const value = parseValue(0);
    ws();
    if (i < s.length) {
      const rest = s.slice(i, i + 40).replace(/\s+/g, ' ');
      warnings.push('解析在第 ' + i + ' 字节后停止，剩余内容：' + rest);
    }
    return {
      value: value,
      warnings: warnings,
      stats: { nodes: nodes, depth: maxDepth, strings: strings, bytes: s.length },
    };
  }

  function decodePyEscapes(raw) {
    return raw.replace(/\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})|\\([nrtbfv0'"\\])/g, (all, h, u, U, ch) => {
      if (h) return String.fromCharCode(parseInt(h, 16));
      if (u) return String.fromCharCode(parseInt(u, 16));
      if (U) return String.fromCodePoint(parseInt(U, 16));
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\' };
      if (ch && map[ch] !== undefined) return map[ch];
      return all;
    });
  }

  function pyRepr(v, indent, level) {
    const pad = ' '.repeat((level || 0) * indent);
    const padIn = ' '.repeat(((level || 0) + 1) * indent);
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (v.every((x) => x === null || typeof x !== 'object')) return '[' + v.map((x) => pyRepr(x, indent, 0)).join(', ') + ']';
      return '[\n' + v.map((x) => padIn + pyRepr(x, indent, (level || 0) + 1) + ',').join('\n') + '\n' + pad + ']';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    if (keys.every((k) => v[k] === null || typeof v[k] !== 'object')) {
      return '{' + keys.map((k) => JSON.stringify(k) + ': ' + pyRepr(v[k], indent, 0)).join(', ') + '}';
    }
    return '{\n' + keys.map((k) => padIn + JSON.stringify(k) + ': ' + pyRepr(v[k], indent, (level || 0) + 1) + ',').join('\n') + '\n' + pad + '}';
  }

  /* 兼容旧签名（返回字符串）；需要引擎信息 / 降级提示时用 jsPretty / jsMinify */
  function js(src, opts) {
    return jsPretty(src, opts).code;
  }
  function jsMin(src, opts) {
    return jsMinify(src, opts).code;
  }

  SK.code = {
    js: js,
    jsMin: jsMin,
    jsPretty: jsPretty,
    jsMinify: jsMinify,
    terserReady: terserReady,
    analyze: analyze,
    deobf: deobf,
    html: html,
    parsePy: parsePy,
    pyRepr: pyRepr,
    tokenizeJs: tokenizeJs,
    segments: segments,
    fmtNum: fmtNum,
  };
})(typeof self !== 'undefined' ? self : globalThis);
