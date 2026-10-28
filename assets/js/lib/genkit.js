/* genkit.js —— 生成器/编码器共用的小工具
 *
 * 为什么单独放在 lib 里：工具的 handler 在 Worker 中会被 fn.toString() 序列化后再 eval，
 * 那个作用域里只有 __SK_LIBS__ 加载过的库和 SK 全局，工具文件自身的模块级函数/常量全都看不见。
 * 所以凡是被 handler 引用的共享辅助，必须落在 lib 并挂到 SK 上。
 */
(function (root) {
  'use strict';
  const SK = (root.SK = root.SK || {});

  /* 生成器要交代的外部环境：语言版本 / 装什么包 / 在哪跑 */
  const ENV = {
    requests: { lang: 'Python 3.8+', deps: 'pip install requests', where: '本机 / 服务器' },
    feapder: { lang: 'Python 3.8+', deps: 'pip install feapder', where: '本机 / 服务器' },
    httpx: { lang: 'Python 3.8+', deps: 'pip install httpx', where: '本机 / 服务器' },
    aiohttp: { lang: 'Python 3.8+', deps: 'pip install aiohttp', where: '本机 / 服务器' },
    scrapy: { lang: 'Python 3.8+', deps: 'pip install scrapy', where: 'Scrapy 项目内' },
    fetch: { lang: 'JavaScript', deps: '无（Node 18+ 原生 fetch / 浏览器原生 fetch）', where: '浏览器或 Node' },
    axios: { lang: 'JavaScript', deps: 'npm i axios', where: 'Node / 浏览器' },
  };

  /* 轻量结构检查：Python 在浏览器里没法真编译，别假装做过语法校验 */
  function structureCheck(code, lang) {
    const src = String(code || '');
    if (lang === 'js') {
      if (/^\s*(?:import|export)\s/m.test(src)) return { state: '未校验', note: '含 import/export，浏览器里不能直接编译验证' };
      try {
        new Function(src); /* eslint-disable-line no-new-func */
        return { state: '语法可解析', note: '已用 new Function 编译通过（只编译不执行）' };
      } catch (e) {
        return { state: '语法错误', note: String(e && e.message) };
      }
    }
    if (lang === 'python') {
      const pairs = { '(': ')', '[': ']', '{': '}' };
      const stack = [];
      let q = null;
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
        if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (pairs[c]) stack.push(pairs[c]);
        else if (c === ')' || c === ']' || c === '}') {
          if (stack.pop() !== c) return { state: '结构异常', note: '第 ' + (src.slice(0, i).split('\n').length) + ' 行括号不配对' };
        }
      }
      if (stack.length) return { state: '结构异常', note: '括号没闭合' };
      if (/\t/.test(src) && /^ {2,}/m.test(src)) return { state: '结构存疑', note: '同时出现 Tab 与空格缩进，Python 可能报 IndentationError' };
      return { state: '结构检查通过', note: '未做真正的语法校验，粘到本地跑一次最稳' };
    }
    return { state: '未校验', note: '' };
  }

  /* 「生成成功」「语法可解析」「请求保真」是三个不同状态，这里分开给 */
  function qualityBlock(parsed, code, target, opts) {
    const env = ENV[target] || { lang: '-', deps: '-', where: '-' };
    const syntax = structureCheck(code, env.lang.indexOf('Python') === 0 ? 'python' : env.lang === 'JavaScript' ? 'js' : 'other');
    const f = SK.net.fidelityCheck(parsed, code, opts || {});
    const rows = f.items.map(function (x) {
      return { 部位: x.part, 内容: x.name, 状态: x.ok ? '✓ 已带上' : '✗ 缺失', 说明: x.note };
    });
    const tab = {
      label: '保真检查 ' + (f.total - f.missing) + '/' + f.total,
      view: 'table',
      data: {
        columns: [{ key: '部位', label: '部位', width: '90px' }, { key: '内容', label: '内容' }, { key: '状态', label: '状态', width: '90px' }, { key: '说明', label: '说明', width: 'minmax(140px,240px)' }],
        rows: rows, name: 'fidelity',
        filterHint: '过滤：缺失',
      },
    };
    const notices = [];
    if (f.missing) {
      notices.push({ level: 'error', msg: f.missing + ' 项没出现在生成代码里（' + f.items.filter(function (x) { return !x.ok; }).map(function (x) { return x.part + ':' + x.name; }).join('、') + '）——直接跑会得到和浏览器不一样的响应' });
    } else {
      notices.push({ level: 'ok', msg: '原请求的 ' + f.total + ' 项（method/URL/query/header/Cookie/body）都出现在生成代码里' });
    }
    if (syntax.state === '语法错误' || syntax.state === '结构异常') notices.push({ level: 'error', msg: '代码可能不合法：' + syntax.note });
    return { env: env, syntax: syntax, fidelity: f, tab: tab, notices: notices };
  }

  /* ---------- URL 编码：只编未编码的字符，避免二次编码 ---------- */
  function encKeepPct(s) {
    return String(s).replace(/%[0-9a-fA-F]{2}|[^%]+|%/g, function (m) {
      if (/^%[0-9a-fA-F]{2}$/.test(m)) return m;
      return encodeURIComponent(m);
    });
  }
  function encPath(s) {
    return String(s).replace(/[^\w\-._~:/?#[\]@!$&'()*+,;=%]/g, function (c) {
      return encodeURIComponent(c);
    });
  }
  function encQuery(q) {
    return String(q).split('&').map(function (pair) {
      if (!pair) return pair;
      const i = pair.indexOf('=');
      if (i < 0) return encKeepPct(pair);
      return encKeepPct(pair.slice(0, i)) + '=' + encKeepPct(pair.slice(i + 1));
    }).join('&');
  }
  function encodeUrlAware(raw, scope) {
    const s = String(raw);
    if (scope === 'component') return encodeURIComponent(s);
    if (scope === 'value') {
      if (/(^|&)[^=&\s]+=/.test(s)) {
        return s.split('&').map(function (pair) {
          const i = pair.indexOf('=');
          return i < 0 ? pair : pair.slice(0, i) + '=' + encKeepPct(pair.slice(i + 1));
        }).join('&');
      }
      return encKeepPct(s);
    }
    const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
    if (m) {
      let out = m[1] + encPath(m[2] || '/');
      if (m[3]) out += '?' + encQuery(m[3].slice(1));
      if (m[4]) out += '#' + encKeepPct(m[4].slice(1));
      return out;
    }
    if (/(^|&)[^=&\s]+=[^&\s]*/.test(s) && !/\s/.test(s) && s.indexOf('/') < 0) return encQuery(s);
    return encPath(s);
  }

  function tagOf(b, off) {
    return String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
  }

  /* ============================================================
   * 正则复杂度预检（ReDoS 防护）
   * 用户从 StackOverflow 抄来的 (a+)+ / (.*)*$ 这类正则会让 V8 的回溯引擎指数爆炸：
   * 40 个字符就能把线程锁死十几秒，界面上表现为「点了运行没反应」。
   * Worker 超时能兜住，但每次要等 20s 再重启线程，体验很差。
   * 这里只做静态识别：能确定有嵌套量词且内层可空/可重叠时提前告知，
   * 不误报普通正则（不确认就放过，交给超时兜底）。
   * ========================================================== */
  const NESTED_QUANT = /\((?:\?:|\?<[^>]+>)?([^()]*?[*+][^()]*?)\)\s*([*+]|\{\d+,\d*\})/;
  const OVERLAP_ALT = /\(([^()|]+)\|([^()|]+)\)\s*([*+]|\{\d+,\d*\})/;
  function redosRisk(src) {
    const s = String(src == null ? '' : src);
    const hits = [];
    let m = NESTED_QUANT.exec(s);
    if (m) {
      const inner = m[1];
      /* 内层量词套在外层量词里，且内层不是「固定宽度」时才真正危险。
         (ab+)+ 这类仍是危险形态（'ab' 前缀可重叠），一并报出。 */
      hits.push({ kind: 'nested', pattern: m[0], hint: '嵌套量词 (…+)+ / (…*)* ，输入不匹配时会指数回溯' });
    }
    m = OVERLAP_ALT.exec(s);
    if (m && (m[1].indexOf(m[2].charAt(0)) === 0 || m[2].indexOf(m[1].charAt(0)) === 0)) {
      hits.push({ kind: 'alt', pattern: m[0], hint: '分支前缀重叠 (a|ab)+ ，失败分支会反复重试' });
    }
    if (/\.\*\.\*/.test(s) || /\.\+\.\+/.test(s)) {
      hits.push({ kind: 'dotstar', pattern: '(.*.*)', hint: '连续的 .*.* 会成倍回溯，改成 [\\s\\S]*? 或直接用懒惰匹配' });
    }
    return { risky: hits.length > 0, hits: hits };
  }

  SK.gen = { ENV: ENV, structureCheck: structureCheck, qualityBlock: qualityBlock, encodeUrlAware: encodeUrlAware, encKeepPct: encKeepPct, encPath: encPath, encQuery: encQuery, tagOf: tagOf, redosRisk: redosRisk };
})(typeof self !== 'undefined' ? self : globalThis);
