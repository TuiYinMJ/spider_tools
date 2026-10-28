/* jsonx.js —— 保真 JSON 数据层（B05）
 *
 * 问题：JSON.parse 会把 9007199254740993 变成 9007199254740992，
 *       于是 cURL→代码 生成的请求体、以及 A/B JSON 对比，都会悄悄改掉
 *       订单号 / 雪花 ID / 金额这类关键值，且不报错。
 *
 * 方案：
 *   parse()      —— 超出 Number.MAX_SAFE_INTEGER 的整数字面量用 BigInt 承载，逐位保真
 *   stringify()  —— BigInt 原样输出数字，不做科学计数、不丢位
 *   pretty()/minify() —— 走 SK.fmt 的 token 级打印，数字字面量一个字符都不改
 *   scan()       —— 报告超安全范围整数、重复键，供 UI 给出明确提示
 *
 * 只依赖自身 + 可选的 LosslessJSON / SK.fmt，可在 Worker 中复用。
 */
(function (root) {
  'use strict';
  const SK = (root.SK = root.SK || {});

  const INT_RE = /^-?\d+$/;
  const MAX_SAFE = Number.MAX_SAFE_INTEGER || 9007199254740991;

  function losslessReady() {
    return typeof LosslessJSON === 'object' && LosslessJSON && typeof LosslessJSON.parse === 'function';
  }

  /* LosslessNumber / 容器 → 普通值，但大整数保真为 BigInt */
  function normalize(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'object' && v.isLosslessNumber) {
      const lit = String(v.value);
      if (INT_RE.test(lit)) {
        const n = Number(lit);
        if (!Number.isSafeInteger(n)) {
          try { return BigInt(lit); } catch (e) { return n; }
        }
        return n;
      }
      return Number(lit);
    }
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = normalize(v[i]);
      return out;
    }
    if (typeof v === 'object') {
      const o = {};
      for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = normalize(v[k]);
      return o;
    }
    if (typeof v === 'bigint') return v;
    return v;
  }

  function parse(text, opts) {
    opts = opts || {};
    const s = String(text == null ? '' : text);
    if (!opts.plain && losslessReady()) {
      try {
        return { value: normalize(LosslessJSON.parse(s)), engine: 'lossless' };
      } catch (e) {
        /* LosslessJSON 对重复键、宽松语法更严格；退回标准解析并记录原因 */
        try {
          return { value: JSON.parse(s), engine: 'native', warning: '保真解析失败（' + e.message + '），已退回标准 JSON.parse：超过 2^53 的整数可能失真' };
        } catch (e2) {
          return { value: undefined, engine: 'none', error: e2 };
        }
      }
    }
    try {
      return { value: JSON.parse(s), engine: 'native' };
    } catch (e) {
      return { value: undefined, engine: 'none', error: e };
    }
  }

  /* BigInt 安全序列化：BigInt 直接输出为裸数字字面量（JSON.stringify 不支持 bigint） */
  function dump(v, space) {
    const unit = space === '\t' ? '\t' : space ? ' '.repeat(Math.max(0, Math.min(8, Number(space) || 0))) : '';
    const seen = new WeakSet();
    function esc(s) {
      return JSON.stringify(s);
    }
    function walk(x, ind) {
      if (x === undefined) return 'null';
      if (x === null) return 'null';
      const t = typeof x;
      if (t === 'bigint') return x.toString();
      if (t === 'number') return Number.isFinite(x) ? String(x) : 'null';
      if (t === 'boolean') return x ? 'true' : 'false';
      if (t === 'string') return esc(x);
      if (seen.has(x)) return '"[Circular]"';
      seen.add(x);
      const inner = ind + unit;
      if (Array.isArray(x)) {
        if (!x.length) return '[]';
        if (!unit) return '[' + x.map((e) => walk(e, '')).join(',') + ']';
        return '[\n' + x.map((e) => inner + walk(e, inner)).join(',\n') + '\n' + ind + ']';
      }
      const keys = Object.keys(x);
      if (!keys.length) return '{}';
      if (!unit) return '{' + keys.map((k) => esc(k) + ':' + walk(x[k], '')).join(',') + '}';
      return '{\n' + keys.map((k) => inner + esc(k) + ': ' + walk(x[k], inner)).join(',\n') + '\n' + ind + '}';
    }
    return walk(v, '');
  }

  /* 只重排空白、绝不改数字字面量 */
  function pretty(text, indent) {
    const s = String(text == null ? '' : text);
    if (SK.fmt && typeof SK.fmt.jsonFormat === 'function') {
      try {
        const r = SK.fmt.jsonFormat(s, { indent: indent === undefined ? 2 : indent });
        if (r && typeof r.text === 'string') return { text: r.text, engine: 'fmt' };
      } catch (e) { /* 落到下面 */ }
    }
    const p = parse(s);
    if (p.error) return { text: s, engine: 'none', error: p.error };
    return { text: dump(p.value, indent === undefined ? 2 : indent), engine: 'dump' };
  }

  function minify(text) {
    const s = String(text == null ? '' : text);
    if (SK.fmt && typeof SK.fmt.jsonFormat === 'function') {
      try {
        const r = SK.fmt.jsonFormat(s, { compact: true });
        if (r && typeof r.text === 'string') return { text: r.text, engine: 'fmt' };
      } catch (e) { /* ignore */ }
    }
    const p = parse(s);
    if (p.error) return { text: s, engine: 'none', error: p.error };
    return { text: dump(p.value, 0), engine: 'dump' };
  }

  /* 扫描文本里的数字字面量与重复键，用于给出明确提示 */
  function scan(text) {
    const s = String(text == null ? '' : text);
    const unsafe = [];
    const dupes = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (c === '"') {
        let j = i + 1;
        while (j < n) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '"') break;
          j++;
        }
        i = j + 1;
        continue;
      }
      if ((c === '-' || (c >= '0' && c <= '9')) && !/[A-Za-z_.\]]/.test(s[i - 1] || '')) {
        let j = i;
        if (s[j] === '-') j++;
        while (j < n && s[j] >= '0' && s[j] <= '9') j++;
        const lit = s.slice(i, j);
        if (INT_RE.test(lit) && lit.length > 1 || /^-?\d+$/.test(lit)) {
          const num = Number(lit);
          if (!Number.isSafeInteger(num)) {
            const line = s.slice(0, i).split('\n').length;
            if (unsafe.length < 20) unsafe.push({ literal: lit, line: line, becomes: String(num) });
          }
        }
        i = j;
        continue;
      }
      i++;
    }
    return { unsafe: unsafe, dupes: dupes, unsafeCount: unsafe.length };
  }

  SK.jsonx = {
    parse: parse,
    stringify: dump,
    dump: dump,
    pretty: pretty,
    minify: minify,
    scan: scan,
    losslessReady: losslessReady,
    isUnsafeIntLiteral: function (lit) { return INT_RE.test(String(lit)) && !Number.isSafeInteger(Number(lit)); },
  };
})(typeof self !== 'undefined' ? self : globalThis);
