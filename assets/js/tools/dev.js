/* ============================================================================
   Spider Lab · dev.js
   JS 沙箱执行（V8）：带代码提示的脚本编辑器 + 沙箱运行 + console 捕获
   - 代码提示：关键字 / 全局对象 / 成员补全 / 片段模板
   - 查找：编辑器内查找（Ctrl+F / 工具栏）
   - 美化 / 压缩：调 codefmt（主线程，小代码直接处理）
   - 执行：SK.exec 后台线程，console 全捕获、超时自动掐死
   - 载入文件 / 保存下载 / 复制 / 分享链接；代码自动存本地
   ========================================================================== */
(function () {
  const { el } = SK.dom;

  /* ------------------------------------------------------------ 代码提示数据 */
  const KEYWORDS = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'super', 'this', 'typeof', 'instanceof', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'delete', 'void', 'in', 'of', 'static', 'get', 'set', 'true', 'false', 'null', 'undefined'];

  const GLOBALS = [
    ['console', '控制台输出（沙箱里已捕获到右侧面板）'],
    ['JSON', 'JSON.parse / stringify'],
    ['Math', '数学函数：floor/abs/random/max…'],
    ['Object', 'keys / values / entries / assign / defineProperty'],
    ['Array', 'from / isArray / of'],
    ['String', 'fromCharCode / raw'],
    ['Number', 'isInteger / parseInt / parseFloat'],
    ['Boolean', '布尔包装'],
    ['Date', 'now / parse / new Date()'],
    ['RegExp', '正则'],
    ['Promise', 'all / race / resolve / reject'],
    ['Map', '键值集合'],
    ['Set', '去重集合'],
    ['Symbol', '唯一符号'],
    ['BigInt', '大整数（爬虫里处理超长 ID）'],
    ['atob', 'Base64 解码'],
    ['btoa', 'Base64 编码'],
    ['fetch', '发请求（Worker 环境）'],
    ['setTimeout', '延时执行'],
    ['setInterval', '定时执行'],
    ['encodeURIComponent', 'URL 编码'],
    ['decodeURIComponent', 'URL 解码'],
    ['crypto', 'getRandomValues / subtle（MD5、AES 原生实现）'],
    ['TextEncoder', '字符串 → UTF-8 字节'],
    ['TextDecoder', '字节 → 字符串'],
    ['URL', 'URL 解析 / 构造'],
    ['URLSearchParams', 'query 串解析'],
    ['structuredClone', '深拷贝'],
    ['globalThis', '全局对象'],
  ];

  /* 成员补全：'对象路径.' → [{n: 名称, d: 说明, f: 是否函数}] */
  const MEMBERS = {
    'console.': [
      ['log', '打印日志', 1], ['info', '信息', 1], ['warn', '警告（黄色）', 1], ['error', '错误（红色）', 1],
      ['table', '表格展示数组/对象', 1], ['dir', '展开对象', 1], ['time', '计时开始', 1], ['timeEnd', '计时结束并输出', 1],
    ],
    'JSON.': [['parse', '字符串 → 对象', 1], ['stringify', '对象 → 字符串', 1]],
    'Math.': [
      ['floor', '向下取整', 1], ['ceil', '向上取整', 1], ['round', '四舍五入', 1], ['abs', '绝对值', 1],
      ['max', '最大值', 1], ['min', '最小值', 1], ['random', '0~1 随机数', 1], ['pow', '幂', 1], ['sqrt', '平方根', 1], ['trunc', '取整', 1],
    ],
    'Object.': [
      ['keys', '键数组', 1], ['values', '值数组', 1], ['entries', '[键,值] 数组', 1], ['fromEntries', '键值对 → 对象', 1],
      ['assign', '合并对象', 1], ['freeze', '冻结', 1], ['defineProperty', '定义属性（Hook 常用）', 1],
      ['getOwnPropertyDescriptor', '取属性描述符（Hook 常用）', 1], ['prototype', '原型', 0],
    ],
    'Array.': [['isArray', '是否数组', 1], ['from', '类数组/迭代器 → 数组', 1], ['of', '创建数组', 1]],
    'String.': [['fromCharCode', '码点 → 字符', 1], ['fromCodePoint', '码点 → 字符（支持增补平面）', 1]],
    'Number.': [['isInteger', '整数判断', 1], ['isSafeInteger', '安全整数判断', 1], ['parseInt', '转整数', 1], ['parseFloat', '转小数', 1], ['MAX_SAFE_INTEGER', '2^53-1', 0]],
    'Date.': [['now', '当前毫秒时间戳', 1], ['parse', '解析时间字符串', 1]],
    'Promise.': [['all', '全部完成', 1], ['allSettled', '全部落地（含失败）', 1], ['race', '任一完成', 1], ['resolve', '包装为 Promise', 1], ['reject', '拒绝', 1]],
    'crypto.': [['subtle', '原生加解密（digest/encrypt/AES…）', 1], ['getRandomValues', '安全随机数', 1]],
    'crypto.subtle.': [
      ['digest', '哈希：SHA-1/256/384/512（MD5 不支持）', 1], ['encrypt', '加密（AES-CBC/GCM…）', 1], ['decrypt', '解密', 1],
      ['sign', '签名（HMAC）', 1], ['verify', '验签', 1], ['importKey', '导入密钥', 1],
    ],
    'URLSearchParams.': [['toString', '转 query 串', 1]],
    'document.': [['cookie', 'cookie 读写', 0], ['createElement', '创建元素', 1]],
    'window.': [['atob', 'Base64 解码', 1], ['btoa', 'Base64 编码', 1], ['fetch', '请求', 1], ['navigator', '浏览器信息', 0], ['location', '地址', 0], ['crypto', '原生加密', 0]],
  };

  const SNIPPETS = [
    { n: 'for 循环', d: 'for (let i = 0; i < arr.length; i++) {\n  \n}', k: 'for' },
    { n: '函数', d: 'function name(params) {\n  \n}', k: 'function' },
    { n: '箭头函数', d: 'const fn = (x) => {\n  \n};', k: '=>' },
    { n: 'try/catch', d: 'try {\n  \n} catch (e) {\n  console.error(e);\n}', k: 'try' },
    { n: 'JSON 解析', d: 'const obj = JSON.parse(text);', k: 'JSON' },
    { n: 'SHA-256 摘要', d: 'crypto.subtle.digest("SHA-256", new TextEncoder().encode("hello"))\n  .then((buf) => {\n    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");\n    console.log(hex);\n  });', k: 'digest' },
    { n: '异步主函数', d: '// 沙箱支持顶层返回 Promise：\n(async () => {\n  \n})();', k: 'async' },
    { n: '正则批量提取', d: 'const re = /(\\d{4})-(\\d{2})-(\\d{2})/g;\nlet m;\nwhile ((m = re.exec(text))) {\n  console.log(m[1], m[2], m[3]);\n}', k: 'exec' },
  ];

  /* ------------------------------------------------------------ 沙箱运行器（Worker 里执行） */
  /* 注意：整个函数体会被序列化传进 Worker，不能引用任何外部变量 */
  function sandboxRunner(code, envJson) {
    const logs = [];
    const LIMIT = 4000;
    const t0 = Date.now();
    /* ---------- 补最小浏览器环境 ----------
       真实混淆代码 90% 依赖 window/document/navigator/XHR。
       原来只有 console + print，跑真实样本第一步就 ReferenceError。 */
    const G = self;
    const injected = [];
    const restore = [];
    function def(name, value, opts) {
      const own = Object.prototype.hasOwnProperty.call(G, name);
      const prev = own ? G[name] : undefined;
      restore.push(function () { try { if (own) G[name] = prev; else delete G[name]; } catch (e) {} });
      try { G[name] = value; } catch (e) {}
      void opts;
    }
    function mkEl(tag) {
      const node = {
        tagName: String(tag || 'div').toUpperCase(), nodeName: String(tag || 'div').toUpperCase(),
        style: {}, dataset: {}, children: [], childNodes: [], attributes: {},
        innerHTML: '', outerHTML: '', textContent: '', value: '', id: '', className: '',
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
        appendChild: function (c) { node.children.push(c); return c; },
        insertBefore: function (c) { node.children.push(c); return c; },
        removeChild: function () {}, append: function () {}, remove: function () {},
        setAttribute: function (k, v) { node.attributes[k] = String(v); },
        getAttribute: function (k) { return node.attributes[k] === undefined ? null : node.attributes[k]; },
        addEventListener: function () {}, removeEventListener: function () {},
        querySelector: function () { return null; }, querySelectorAll: function () { return []; },
        getContext: function () { return null; },
        getBoundingClientRect: function () { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
        cloneNode: function () { return mkEl(tag); },
        focus: function () {}, blur: function () {}, click: function () {},
      };
      return node;
    }
    const fakeDoc = {
      cookie: '', title: '', referrer: '', readyState: 'complete', characterSet: 'UTF-8',
      documentElement: mkEl('html'), head: mkEl('head'), body: mkEl('body'),
      createElement: function (t) { return mkEl(t); },
      createElementNS: function (ns, t) { return mkEl(t); },
      createTextNode: function (t) { return { nodeType: 3, textContent: String(t) }; },
      getElementById: function () { return null; },
      getElementsByTagName: function () { return []; },
      getElementsByClassName: function () { return []; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      addEventListener: function () {}, removeEventListener: function () {},
      write: function () {}, writeln: function () {},
    };
    const fakeNav = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      platform: 'Win32', language: 'zh-CN', languages: ['zh-CN', 'zh'], webdriver: false,
      hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, vendor: 'Google Inc.',
      plugins: { length: 0 }, mimeTypes: { length: 0 },
      permissions: { query: function () { return Promise.resolve({ state: 'prompt' }); } },
      sendBeacon: function () { return true; },
    };
    const fakeLoc = {
      href: 'https://example.com/', origin: 'https://example.com', protocol: 'https:',
      host: 'example.com', hostname: 'example.com', port: '', pathname: '/',
      search: '', hash: '', reload: function () {}, assign: function () {}, replace: function () {},
      toString: function () { return 'https://example.com/'; },
    };
    function FakeXHR() {
      this.readyState = 0; this.status = 0; this.responseText = ''; this.response = '';
      this.readyState_ = 0;
      this.open = function () { this.readyState = 1; };
      this.setRequestHeader = function () {};
      this.send = function () { this.readyState = 4; this.status = 200; if (this.onreadystatechange) this.onreadystatechange(); if (this.onload) this.onload(); };
      this.abort = function () {};
      this.getAllResponseHeaders = function () { return ''; };
      this.addEventListener = function () {};
      this.removeEventListener = function () {};
    }
    const fakeFetch = function () {
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        headers: { get: function () { return null; } },
        json: function () { return Promise.resolve({}); },
        text: function () { return Promise.resolve(''); },
        arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); },
        clone: function () { return this; },
      });
    };
    /* 兜底：补 window/self 互相引用与常用构造器 */
    def('window', G);
    def('globalThis', G);
    def('document', fakeDoc);
    def('navigator', fakeNav);
    def('location', fakeLoc);
    def('history', { length: 1, pushState: function () {}, replaceState: function () {}, back: function () {}, forward: function () {} });
    def('screen', { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24 });
    def('XMLHttpRequest', FakeXHR);
    def('fetch', fakeFetch);
    def('localStorage', { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}, clear: function () {}, key: function () { return null; }, length: 0 });
    def('sessionStorage', { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}, clear: function () {}, length: 0 });
    def('matchMedia', function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; });
    def('requestAnimationFrame', function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); });
    def('cancelAnimationFrame', function (id) { clearTimeout(id); });
    def('getComputedStyle', function () { return { getPropertyValue: function () { return ''; } }; });
    def('Image', function () { return mkEl('img'); });
    def('Event', function (t) { return { type: t, preventDefault: function () {}, stopPropagation: function () {} }; });
    def('CustomEvent', function (t, o) { return { type: t, detail: (o || {}).detail, preventDefault: function () {} }; });
    if (typeof G.performance === 'undefined') def('performance', { now: function () { return Date.now() - t0; } });
    if (typeof G.crypto === 'undefined') def('crypto', { getRandomValues: function (a) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } });
    /* 注入用户提供的环境变量 */
    let envObj = {};
    try { envObj = envJson ? JSON.parse(envJson) : {}; } catch (e) { envObj = {}; }
    let envCount = 0;
    Object.keys(envObj || {}).forEach(function (k) {
      const v = envObj[k];
      try {
        G[k] = v;
        if (typeof v === 'object' && v && !Array.isArray(v)) { for (const kk in v) G[kk] = v[kk]; }
        injected.push(k);
        envCount++;
      } catch (e) {}
    });
    const beforeKeys = {};
    try { Object.getOwnPropertyNames(G).forEach(function (k) { beforeKeys[k] = 1; }); } catch (e) {}
    function fmt(v, depth) {
      try {
        if (v === undefined) return 'undefined';
        if (v === null) return 'null';
        const t = typeof v;
        if (t === 'string') return v.length > 3000 ? v.slice(0, 3000) + '…(' + v.length + ' 字符)' : v;
        if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
        if (t === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
        if (v instanceof Error) return (v.stack || String(v)).split('\n').slice(0, 3).join('\n');
        if (v instanceof Uint8Array || v instanceof Int8Array || v instanceof Uint32Array) {
          const arr = Array.prototype.slice.call(v.slice(0, 48));
          return v.constructor.name + '(' + v.length + ') [' + arr.join(', ') + (v.length > 48 ? ', …' : '') + ']';
        }
        const d = depth || 0;
        if (d > 3) return Array.isArray(v) ? '[…]' : '{…}';
        if (v instanceof Map) return 'Map(' + v.size + ') {' + Array.from(v.entries()).slice(0, 30).map(function (e2) { return fmt(e2[0], d + 1) + ' => ' + fmt(e2[1], d + 1); }).join(', ') + '}';
        if (v instanceof Set) return 'Set(' + v.size + ') {' + Array.from(v).slice(0, 30).map(function (x) { return fmt(x, d + 1); }).join(', ') + '}';
        if (Array.isArray(v)) {
          return '[' + v.slice(0, 100).map(function (x) { return fmt(x, d + 1); }).join(', ') + (v.length > 100 ? ', … 共 ' + v.length + ' 项' : '') + ']';
        }
        const keys = Object.keys(v);
        return '{ ' + keys.slice(0, 40).map(function (k) { return k + ': ' + fmt(v[k], d + 1); }).join(', ') + (keys.length > 40 ? ', …' : '') + ' }';
      } catch (e) {
        return String(v);
      }
    }
    function push(t, args) {
      if (logs.length < LIMIT) logs.push({ t: t, s: args.map(function (a) { return fmt(a); }).join(' ') });
      else if (logs.length === LIMIT) logs.push({ t: 'warn', s: '… 输出超过 ' + LIMIT + ' 条，已截断（逻辑还在跑）' });
    }
    const con = {
      log: function () { push('log', Array.prototype.slice.call(arguments)); },
      info: function () { push('info', Array.prototype.slice.call(arguments)); },
      warn: function () { push('warn', Array.prototype.slice.call(arguments)); },
      error: function () { push('error', Array.prototype.slice.call(arguments)); },
      debug: function () { push('log', Array.prototype.slice.call(arguments)); },
      table: function (v) { push('log', [v]); },
      dir: function (v) { push('log', [v]); },
      trace: function () { push('warn', [new Error().stack.split('\n').slice(1, 6).join('\n')]); },
      time: function (label) { con.__t = con.__t || {}; con.__t[label || 'default'] = Date.now(); },
      timeEnd: function (label) {
        con.__t = con.__t || {};
        const s = con.__t[label || 'default'];
        if (s !== undefined) { push('info', [(label || 'default') + ': ' + (Date.now() - s) + 'ms']); delete con.__t[label || 'default']; }
      },
    };
    const print = function () { push('log', Array.prototype.slice.call(arguments)); };
    const errInfo = function (e) {
      const st = String((e && e.stack) || e);
      /* 用户代码的位置在第一个栈帧里；嵌套 eval 会让一行里出现多个
         <anonymous>:L:C，最靠后那个才是 new Function 编译体的位置 */
      const firstFrame = (st.split('\n').find((l) => l.trim().indexOf('at ') === 0) || st);
      const all = [];
      let mm;
      const GRE = /<anonymous>:(\d+):(\d+)/g;
      while ((mm = GRE.exec(firstFrame))) all.push(mm);
      const m = all.length ? all[all.length - 1] : GRE.exec(st);
      /* new Function 编译体头部有 3 行：function anonymous(... / ) / "use strict";
         所以栈里的行号 - 3 才是用户代码的行号 */
      return {
        error: st.split('\n').slice(0, 3).join('\n').replace(/^Error:\s*/, '').replace(/^SyntaxError:\s*/, '语法错误：').replace(/^TypeError:\s*/, '类型错误：').replace(/^ReferenceError:\s*/, '未定义变量：'),
        errorLine: m ? Number(m[1]) - 3 : 0,
        errorCol: m ? Number(m[2]) : 0,
        ms: Date.now() - t0,
        ua: (self.navigator && self.navigator.userAgent) || '',
      };
    };
    /* 先按普通函数编译；失败且代码里有顶层 await 时，包一层 async 重试 */
    let fn;
    try {
      fn = new Function('console', 'print', '"use strict";\n' + code + '\n');
    } catch (e1) {
      if (/\bawait\s/.test(code)) {
        try {
          fn = new Function('console', 'print', '"use strict";return (async () => {\n' + code + '\n})();');
        } catch (e2) {
          const out = errInfo(e1);
          out.logs = logs;
          return out;
        }
      } else {
        const out = errInfo(e1);
        out.logs = logs;
        return out;
      }
    }
    let result;
    try {
      result = fn(con, print);
    } catch (e) {
      const out = errInfo(e);
      out.logs = logs;
      out.ua = (G.navigator && G.navigator.userAgent) || '';
      restoreAll();
      return out;
    }
    function restoreAll() { for (let i = restore.length - 1; i >= 0; i--) { try { restore[i](); } catch (e) {} } }
    /* 执行后枚举「新增的全局变量」——补环境/找 key 最需要的就是这个 */
    function collectGlobals() {
      const out = [];
      try {
        Object.getOwnPropertyNames(G).forEach(function (k) {
          if (beforeKeys[k]) return;
          if (/^(console|print)$/.test(k)) return;
          let v;
          try { v = G[k]; } catch (e) { return; }
          if (typeof v === 'function') {
            out.push({ name: k, type: 'function', value: 'ƒ ' + (v.name || 'anonymous') + '()' });
          } else {
            out.push({ name: k, type: typeof v, value: fmt(v) });
          }
        });
      } catch (e) {}
      return out.slice(0, 300);
    }
    function finish(r) {
      const globals = collectGlobals();
      /* ua 必须在 restoreAll 之前取：restore 会把 navigator 删掉 */
      const ua = (G.navigator && G.navigator.userAgent) || '';
      restoreAll();
      return {
        logs: logs, result: r === undefined ? undefined : fmt(r), ms: Date.now() - t0,
        ua: ua,
        globals: globals,
        envCount: envCount,
        envKeys: injected,
      };
    }
    if (result && typeof result.then === 'function') {
      return result.then(function (v) { return finish(v); }, function (e) {
        const st = String((e && e.stack) || e);
        const ua2 = (G.navigator && G.navigator.userAgent) || '';
        restoreAll();
        return { logs: logs, error: 'Promise 拒绝：' + st.split('\n').slice(0, 3).join('\n'), ms: Date.now() - t0, ua: ua2 };
      });
    }
    return finish(result);
  }

  /* ------------------------------------------------------------ 示例代码 */
  const SAMPLES = [
    {
      name: '基础：数组与对象',
      code: [
        '// 沙箱里 console.log 全部被捕获到右侧面板',
        'const list = [3, 1, 4, 1, 5, 9, 2, 6];',
        'console.log("原始:", list);',
        'console.log("排序:", [...list].sort((a, b) => a - b));',
        '',
        'const data = { name: "spider", tags: ["爬虫", "逆向"], depth: 2 };',
        'console.info("对象:", data);',
        'console.log("JSON:", JSON.stringify(data));',
        '',
        'console.time("循环");',
        'let sum = 0;',
        'for (let i = 0; i < 100000; i++) sum += i;',
        'console.timeEnd("循环");',
        'return sum; // 最后一行可以 return，会显示「返回值」',
      ].join('\n'),
    },
    {
      name: '正则批量提取',
      code: [
        'const text = `',
        '2024-01-31 12:30:00 [INFO] user=alice action=login',
        '2024-02-01 08:11:45 [WARN] user=bob action=pay amount=199.00',
        '2024-02-02 22:05:10 [INFO] user=carol action=view item=sku_12345',
        '`;',
        '',
        '// 日期 + 用户 + 动作 三列提取',
        'const re = /(\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2}:\\d{2}).*?user=(\\w+) action=(\\w+)/g;',
        'let m, rows = [];',
        'while ((m = re.exec(text))) {',
        '  rows.push({ date: m[1], time: m[2], user: m[3], action: m[4] });',
        '}',
        'console.table(rows);',
        'return rows;',
      ].join('\n'),
    },
    {
      name: 'Base64 与字节处理',
      code: [
        'const raw = "Spider Lab 爬虫工具箱";',
        '',
        '// UTF-8 安全的 Base64（直接 btoa 处理中文会报错）',
        'const bytes = new TextEncoder().encode(raw);',
        'let bin = "";',
        'bytes.forEach((b) => (bin += String.fromCharCode(b)));',
        'const b64 = btoa(bin);',
        'console.log("Base64:", b64);',
        '',
        '// 解回来',
        'const back = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));',
        'console.log("还原:", back);',
        '',
        '// 十六进制',
        'const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");',
        'console.log("HEX:", hex.slice(0, 60) + "…");',
        'return b64;',
      ].join('\n'),
    },
    {
      name: 'SHA-256 摘要（WebCrypto）',
      code: [
        '// 原生加密：不依赖任何库，直接算 SHA 系列',
        'async function sha256(text) {',
        '  const data = new TextEncoder().encode(text);',
        '  const buf = await crypto.subtle.digest("SHA-256", data);',
        '  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");',
        '}',
        '',
        'const h1 = await sha256("hello"); // 顶层 await：直接写',
        'console.log("SHA-256(hello) =", h1);',
        '',
        'const h2 = await sha256("123456");',
        'console.log("SHA-256(123456) =", h2);',
        'return { h1, h2 };',
      ].join('\n'),
    },
    {
      name: '模拟补环境跑混淆代码',
      code: [
        '// 演示：给一段依赖浏览器环境的代码补环境后在沙箱跑通',
        'const window = globalThis;',
        'const navigator = {',
        '  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",',
        '  language: "zh-CN",',
        '  platform: "Win32",',
        '  webdriver: false,',
        '};',
        'const document = { cookie: "", referrer: "https://example.com/" };',
        'const location = { href: "https://example.com/list?page=1" };',
        '',
        '// —— 从目标站抠出来的逻辑（示例：拼签名）——',
        'function getSign(params, ts) {',
        '  const keys = Object.keys(params).sort();',
        '  const base = keys.map((k) => k + "=" + params[k]).join("&");',
        '  return "v1_" + btoa(unescape(encodeURIComponent(base + "&ts=" + ts))).replace(/=/g, "");',
        '}',
        '',
        'const sign = getSign({ page: 1, size: 20, kw: "鞋" }, Date.now());',
        'console.log("签名:", sign);',
        'console.log("UA:", navigator.userAgent);',
        'return sign;',
      ].join('\n'),
    },
  ];

  /* ------------------------------------------------------------ 工具注册 */
  SK.tool({
    id: 'js-sandbox',
    name: 'JS 试运行',
    group: 'reverse',
    icon: '▶',
    aliases: 'sandbox v8 执行 脚本 运行 js console 代码提示 补环境 JS 沙箱执行 沙箱',
    keywords: ['v8', '沙箱', 'sandbox', '执行', '脚本', 'console', '运行', '代码提示', '编辑器'],
    desc: '带代码提示的脚本编辑器 + 试运行：console 捕获、查找、美化、压缩、载入/保存/分享，超时自动掐死死循环（Worker 内执行，不是安全隔离）',
    custom: true,
    hideRun: true,
    hideOutput: true,
    needsRun: false,
    autoRun: false,
    sample: 'js',
    inputs: [],
    mount: mount,
  });

  function mount(ctx) {
    const host = ctx.customHost;
    SK.dom.clear(host);
    const STORE_KEY = 'sandbox:code';

    /* ---------------- 编辑器 ---------------- */
    const gutter = el('div', { class: 'pg-gutter', text: '1' });
    const ta = el('textarea', {
      class: 'pg-area',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      autocorrect: 'off',
      wrap: 'off',
      placeholder: '在这里写 JS…\n· console.log 输出到右侧\n· Ctrl+Enter 运行\n· 输入对象名后打 . 触发代码提示',
    });
    const acBox = el('div', { class: 'pg-ac', style: { display: 'none' } });
    const findBar = el('div', { class: 'pg-find', style: { display: 'none' } });
    const edWrap = el('div', { class: 'pg-wrap' }, [gutter, ta, acBox, findBar]);
    const edFoot = el('div', { class: 'pg-foot' });
    const edPane = el('section', { class: 'pane pane-in pg-ed' }, [
      el('div', { class: 'pane-head' }, [
        el('span', { class: 'pane-title', text: '脚本' }),
        el('span', { class: 'pane-spacer' }),
        el('button', { class: 'icon-btn', text: '📂', title: '载入 .js 文件', onClick: () => filePicker.click() }),
        el('button', { class: 'icon-btn', text: '✨', title: '内置示例', onClick: (e) => openSampleMenu(e.target) }),
        el('button', { class: 'icon-btn', text: '⌫', title: '清空', onClick: () => { ta.value = ''; refresh(); save(); } }),
      ]),
      edWrap,
      edFoot,
    ]);
    const filePicker = el('input', { type: 'file', style: { display: 'none' }, accept: '.js,.txt,.json,.mjs', onChange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) {
        SK.ui.toast('文件超过 2MB，编辑器会卡，建议只载入需要的部分', 'warn');
      }
      const text = (await f.slice(0, 2 * 1024 * 1024).text()).replace(/^﻿/, '');
      setValue(text);
      SK.ui.toast('已载入 ' + f.name + '（' + SK.dom.fmtBytes(Math.min(f.size, 2 * 1024 * 1024)) + '）', 'ok');
      e.target.value = '';
    } });

    /* ---------------- 输出台 ---------------- */
    const conBody = el('div', { class: 'pg-console' });
    const conFoot = el('div', { class: 'pg-confoot' });
    const conPane = el('section', { class: 'pane pane-out pg-out' }, [
      el('div', { class: 'pane-head' }, [
        el('span', { class: 'pane-title', text: '输出（V8 沙箱）' }),
        el('span', { class: 'pane-spacer' }),
        el('button', { class: 'btn tiny', text: '↗ 发送', title: '把输出文本发送到其他工具', onClick: sendOut }),
        el('button', { class: 'icon-btn', text: '⌫', title: '清空输出', onClick: () => { SK.dom.clear(conBody); conFoot.textContent = ''; } }),
      ]),
      conBody,
      conFoot,
    ]);

    /* ---------------- 工具条 ---------------- */
    let envJson = '';
    const runBtn = el('button', { class: 'btn-run', title: 'Ctrl+Enter' }, [el('span', { text: '▶ V8 执行' }), el('kbd', { text: '⌃⏎' })]);
    const bar = el('div', { class: 'run-row pg-bar' }, [
      runBtn,
      el('button', { class: 'btn tiny', text: '✂ 压缩', title: '压缩当前代码（jsMin）', onClick: () => doFormat('min') }),
      el('button', { class: 'btn tiny', text: '⌘ 美化', title: '美化当前代码', onClick: () => doFormat('pretty') }),
      el('button', { class: 'btn tiny', text: '⌕ 查找', title: '在代码中查找（Ctrl+F）', onClick: openFind }),
      el('button', { class: 'btn tiny', text: '⧉ 复制', onClick: () => SK.dom.copy(ta.value).then(() => SK.ui.toast('已复制 ' + SK.dom.fmtNum(ta.value.length) + ' 字符', 'ok')) }),
      el('button', { class: 'btn tiny', text: '⤓ 保存', onClick: () => { SK.dom.download(ta.value || '', 'sandbox.js', 'text/javascript'); SK.ui.toast('已下载 sandbox.js', 'ok'); } }),
      el('button', { class: 'btn tiny', text: '🌐 环境', title: '注入环境变量（JSON），并模拟 window/document/navigator/XHR/fetch', onClick: () => {
        const cur = envJson || '{\n  "KEY": "abc123"\n}';
        const v = window.prompt('环境变量 JSON（注入到沙箱全局，嵌套对象会展开成顶层变量）：', cur);
        if (v === null) return;
        if (v.trim()) {
          try { JSON.parse(v); envJson = v; SK.ui.toast('环境变量已设置（下次执行生效）', 'ok'); }
          catch (e) { SK.ui.toast('JSON 不合法：' + e.message, 'err'); }
        } else { envJson = ''; SK.ui.toast('已清空环境变量', 'ok'); }
      } }),
      el('button', { class: 'btn tiny', text: '↗ 分享', title: '生成包含当前代码的分享链接', onClick: doShare }),
      el('span', { class: 'exec-mode', id: 'sb-engine', text: '引擎检测中…' }),
    ]);

    host.appendChild(el('div', { class: 'pg-layout' }, [edPane, bar, conPane]));

    /* ---------------- 状态 ---------------- */
    let running = false;
    let engineInfo = '';

    const saved = SK.store.get(STORE_KEY, '');
    if (saved && !ta.value) ta.value = saved;

    /* ---------------- 编辑器基础 ---------------- */
    function lineCount(v) {
      let n = 1;
      for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
      return n;
    }

    function refresh() {
      const v = ta.value;
      const lines = lineCount(v);
      if (lines > 4000) gutter.style.display = 'none';
      else {
        gutter.style.display = '';
        let nums = '';
        for (let i = 1; i <= lines; i++) nums += i + '\n';
        gutter.textContent = nums;
      }
      const pos = caretPos();
      edFoot.textContent = SK.dom.fmtNum(v.length) + ' 字符 · ' + lines + ' 行 · 光标 ' + pos.line + ':' + pos.col;
      gutter.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
    }

    function caretPos() {
      const upto = ta.value.slice(0, ta.selectionStart);
      const line = (upto.match(/\n/g) || []).length + 1;
      const col = upto.length - (upto.lastIndexOf('\n') + 1) + 1;
      return { line: line, col: col };
    }

    function setValue(text) {
      ta.value = text;
      closeAC();
      /* 消费 SK.inject：反混淆/结构分析的结果直接进编辑器 */
    if (SK.inject && SK.inject.toolId === 'js-sandbox') {
      const inj = SK.inject;
      SK.inject = null;
      if (inj.text) {
        ta.value = inj.text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        refresh();
        ctx.toast('已接收来自「' + ((SK.tools.byId[inj.from] || {}).name || inj.from) + '」的代码', 'ok');
      }
    }
    refresh();
      save();
    }

    let saveTimer = null;
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => SK.store.set(STORE_KEY, ta.value), 400);
    }

    ta.addEventListener('input', () => {
      refresh();
      save();
      updateAC();
    });
    ta.addEventListener('scroll', () => {
      gutter.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
      positionAC();
    });
    ta.addEventListener('click', () => { closeAC(); refresh(); });
    ta.addEventListener('keyup', refresh);

    /* 缩进 / 反缩进 / 自动括号配对 */
    ta.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        run();
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFind();
        return;
      }
      if (acOn && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        if (e.key === 'ArrowDown') moveAC(1);
        else if (e.key === 'ArrowUp') moveAC(-1);
        else acceptAC();
        return;
      }
      if (e.key === 'Escape' && acOn) {
        e.preventDefault();
        closeAC();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        const multi = s !== en && ta.value.slice(s, en).indexOf('\n') >= 0;
        if (multi) {
          indentBlock(e.shiftKey);
        } else if (e.shiftKey) {
          const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
          const seg = ta.value.slice(lineStart, lineStart + 2);
          if (seg === '  ') ta.setRangeText('', lineStart, lineStart + 2, 'end');
          else if (seg[0] === ' ' || seg[0] === '\t') ta.setRangeText('', lineStart, lineStart + 1, 'end');
        } else {
          ta.setRangeText('  ', s, en, 'end');
        }
        refresh();
        save();
        return;
      }
      if (e.key === 'Enter') {
        // 自动缩进：继承上一行前导空白；{ 后回车补右括号
        const s = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
        const line = ta.value.slice(lineStart, s);
        const indent = (line.match(/^[ \t]*/) || [''])[0];
        const openBlock = /[{([]\s*$/.test(line);
        const pair = openBlock && /[{[]/.test(line.trim().slice(-1));
        e.preventDefault();
        if (pair) {
          const next = ta.value[s] === '}' || ta.value[s] === ']' ? '\n' + indent : '';
          ta.setRangeText('\n' + indent + '  ' + next, s, ta.selectionEnd, 'end');
          ta.selectionStart = ta.selectionEnd = s + 1 + indent.length + 2;
        } else {
          ta.setRangeText('\n' + indent, s, ta.selectionEnd, 'end');
        }
        refresh();
        save();
        updateAC();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
        if (pairs[e.key] && ta.selectionStart !== ta.selectionEnd) {
          e.preventDefault();
          const s = ta.selectionStart, en = ta.selectionEnd;
          ta.setRangeText(e.key + ta.value.slice(s, en) + pairs[e.key], s, en, 'end');
          refresh();
          save();
        }
      }
    });

    function indentBlock(out) {
      const s0 = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const s = Math.min(s0, ta.selectionStart);
      const en0 = ta.value.indexOf('\n', ta.selectionEnd);
      const en = en0 < 0 ? ta.value.length : en0;
      const block = ta.value.slice(s, en);
      const changed = block.split('\n').map((l) => (out ? l.replace(/^  |^\t/, '') : '  ' + l)).join('\n');
      ta.setRangeText(changed, s, en, 'end');
    }

    /* ---------------- 代码提示 ---------------- */
    let acOn = false;
    let acItems = [];
    let acIdx = 0;
    let acPrefix = '';
    let acMember = null;

    function updateAC() {
      if (running) return closeAC();
      const s = ta.selectionStart;
      const before = ta.value.slice(0, s);
      /* 成员补全：xxx. 前缀（支持两层：crypto.subtle.） */
      const dm = /\.([\w$]{0,40})$/.exec(before);
      if (dm) {
        const path = memberPath(before, s);
        const key = path ? path + '.' : null;
        if (key && MEMBERS[key]) {
          openAC(MEMBERS[key].map((m) => ({ n: m[0], d: m[1], f: m[2] })), dm[1], path, true);
          return;
        }
        closeAC();
        return;
      }
      /* 词补全 / 片段 */
      const wm = /([\w$]{1,40})$/.exec(before);
      if (!wm) return closeAC();
      const w = wm[1];
      if (w.length < 1) return closeAC();
      const lower = w.toLowerCase();
      const items = [];
      for (const g of GLOBALS) if (g[0].toLowerCase().startsWith(lower)) items.push({ n: g[0], d: g[1], f: 0 });
      for (const k of KEYWORDS) if (k.startsWith(lower) && k !== w) items.push({ n: k, d: '关键字', f: 0 });
      for (const sn of SNIPPETS) if (lower.length >= 2 && (sn.k.toLowerCase().startsWith(lower) || sn.n.toLowerCase().includes(lower))) items.push({ n: sn.n, d: sn.d.split('\n')[0], f: 2, snip: sn.d });
      if (!items.length) return closeAC();
      openAC(items.slice(0, 12), w, null, false);
    }

    function memberPath(before, s) {
      /* 从光标往前找连续的 a.b. 链，最多两层（光标前一个字符是 '.'） */
      let i = s - 1; /* 指向 '.' */
      if (i < 0 || before[i] !== '.') return null;
      const parts = [];
      while (i >= 0 && parts.length < 2) {
        const m = /([\w$]+)$/.exec(before.slice(0, i));
        if (!m) break;
        parts.unshift(m[1]);
        i -= m[1].length;
        if (i > 0 && before[i - 1] === '.') i--; /* 越过前面的 '.' 继续 */
        else break;
      }
      return parts.length ? parts.join('.') : null;
    }

    function openAC(items, prefix, member, isMember) {
      acItems = items;
      acIdx = 0;
      acPrefix = prefix;
      acMember = member;
      acOn = true;
      renderAC(isMember);
      acBox.style.display = '';
      positionAC();
    }

    function renderAC(isMember) {
      SK.dom.clear(acBox);
      acItems.forEach((it, i) => {
        const row = el('div', { class: 'pg-ac-item' + (i === acIdx ? ' on' : '') }, [
          el('span', { class: 'pg-ac-name' + (it.f ? ' fn' : ''), text: (isMember && it.f ? 'ƒ ' : '') + it.n }),
          el('span', { class: 'pg-ac-desc', text: it.d }),
        ]);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          acceptAC();
        });
        acBox.appendChild(row);
      });
      const hint = el('div', { class: 'pg-ac-foot', text: '↑↓ 选择 · Tab/Enter 补全 · Esc 关闭' });
      acBox.appendChild(hint);
    }

    function moveAC(dir) {
      if (!acOn) return;
      acIdx = (acIdx + dir + acItems.length) % acItems.length;
      renderAC(!!acMember);
    }

    function acceptAC() {
      if (!acOn || !acItems.length) return closeAC();
      const it = acItems[acIdx];
      const s = ta.selectionStart;
      const start = s - acPrefix.length;
      const insert = it.snip ? it.snip : it.n;
      ta.setRangeText(insert, start, s, 'end');
      if (it.snip) {
        const body = it.snip.indexOf('\n  \n');
        if (body >= 0) ta.selectionStart = ta.selectionEnd = start + body + 3;
      }
      closeAC();
      refresh();
      save();
      ta.focus();
    }

    function closeAC() {
      acOn = false;
      acBox.style.display = 'none';
    }

    function positionAC() {
      if (!acOn) return;
      const pos = caretXY();
      acBox.style.left = Math.max(4, pos.x) + 'px';
      acBox.style.top = Math.min(pos.y + 20, edWrap.clientHeight - acBox.offsetHeight - 8) + 'px';
    }

    function caretXY() {
      const upto = ta.value.slice(0, ta.selectionStart);
      const line = (upto.match(/\n/g) || []).length;
      const col = upto.length - (upto.lastIndexOf('\n') + 1);
      const style = getComputedStyle(ta);
      const lineH = parseFloat(style.lineHeight) || 19;
      const padL = parseFloat(style.paddingLeft) || 0;
      const chW = measureChar();
      return {
        x: gutter.offsetWidth + padL + col * chW - ta.scrollLeft,
        y: line * lineH - ta.scrollTop + 8,
      };
    }

    let chWCache = 0;
    function measureChar() {
      if (chWCache) return chWCache;
      const probe = el('span', { text: '0123456789abcdefghij', style: { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', font: getComputedStyle(ta).font } });
      edWrap.appendChild(probe);
      chWCache = probe.getBoundingClientRect().width / 20 || 7.2;
      probe.remove();
      return chWCache;
    }

    /* ---------------- 查找 ---------------- */
    let findInput = null;
    let findInfo = null;

    function buildFindBar() {
      if (findInput) return;
      findInput = el('input', { class: 'mini-search', type: 'search', placeholder: '查找…', onInput: () => findNext(0), onKeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') closeFind();
      } });
      findInfo = el('span', { class: 'pg-find-info', text: '' });
      findBar.appendChild(findInput);
      findBar.appendChild(el('button', { class: 'icon-btn', text: '↑', title: '上一个（Shift+Enter）', onClick: () => findNext(-1) }));
      findBar.appendChild(el('button', { class: 'icon-btn', text: '↓', title: '下一个（Enter）', onClick: () => findNext(1) }));
      findBar.appendChild(findInfo);
      findBar.appendChild(el('button', { class: 'icon-btn', text: '✕', title: '关闭（Esc）', onClick: closeFind }));
    }

    function openFind() {
      buildFindBar();
      findBar.style.display = '';
      findInput.focus();
      findInput.select();
    }

    function closeFind() {
      findBar.style.display = 'none';
      ta.focus();
    }

    function findNext(dir) {
      const q = findInput.value;
      if (!q) { findInfo.textContent = ''; return; }
      const text = ta.value;
      const lower = q.toLowerCase();
      const pos = [];
      let i = 0;
      while ((i = text.toLowerCase().indexOf(lower, i)) >= 0 && pos.length < 9999) { pos.push(i); i += lower.length; }
      if (!pos.length) { findInfo.textContent = '无匹配'; return; }
      const cur = ta.selectionEnd;
      let next;
      if (dir > 0) next = pos.find((p) => p > cur);
      else if (dir < 0) { const back = pos.filter((p) => p < cur); next = back[back.length - 1]; }
      if (next === undefined) next = dir < 0 ? pos[pos.length - 1] : pos[0];
      ta.setSelectionRange(next, next + q.length);
      scrollToCaret();
      findInfo.textContent = (pos.indexOf(next) + 1) + '/' + pos.length;
    }

    function scrollToCaret() {
      const pos = caretXY();
      if (pos.y < ta.scrollTop || pos.y > ta.scrollTop + ta.clientHeight - 30) {
        const line = (ta.value.slice(0, ta.selectionStart).match(/\n/g) || []).length;
        ta.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(ta).lineHeight) || 19) - ta.clientHeight / 2);
        gutter.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
      }
    }

    /* ---------------- 美化 / 压缩 ---------------- */
    function doFormat(mode) {
      const v = ta.value;
      if (!v.trim()) return SK.ui.toast('代码为空', 'warn');
      if (v.length > 1024 * 1024) return SK.ui.toast('超过 1MB，请用「JS 格式化」工具（走后台线程）', 'warn');
      try {
        const out = mode === 'min' ? SK.code.jsMin(v) : SK.code.js(v, { indent: 2 });
        setValue(out);
        SK.ui.toast(mode === 'min' ? '已压缩：' + SK.dom.fmtBytes(v.length) + ' → ' + SK.dom.fmtBytes(out.length) : '已美化', 'ok');
      } catch (e) {
        SK.ui.toast('处理失败：' + e.message, 'error');
      }
    }

    /* ---------------- 分享 ---------------- */
    async function doShare() {
      const v = ta.value;
      if (!v) return SK.ui.toast('代码为空', 'warn');
      try {
        const packed = await SK.codecCompress(v);
        const payload = packed ? 'z' + packed : 'p' + btoa(unescape(encodeURIComponent(v))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href.split('#')[0];
        const url = base + '#/code-share/' + payload;
        await SK.dom.copy(url);
        SK.ui.toast('分享链接已复制（' + SK.dom.fmtNum(url.length) + ' 字符），任何浏览器打开即还原', 'ok');
      } catch (e) {
        SK.ui.toast('分享失败：' + e.message, 'error');
      }
    }

    function sendOut() {
      const text = Array.from(conBody.children).map((r) => r.textContent).join('\n');
      if (!text) return SK.ui.toast('还没有输出', 'warn');
      const menu = el('div', { class: 'send-menu' });
      const scrollBox = el('div', { class: 'sm-list' });
      menu.appendChild(scrollBox);
      SK.tools.search('').filter((x) => x.id !== 'js-sandbox' && !x.noReceive).slice(0, 40).forEach((x) => {
        scrollBox.appendChild(el('button', { class: 'sm-item', text: x.name, onClick: () => {
          SK.inject = { toolId: x.id, text: text, from: 'js-sandbox' };
          menu.remove();
          location.hash = '#/' + x.id;
        } }));
      });
      const anchor = bar.getBoundingClientRect();
      menu.style.left = anchor.left + 'px';
      menu.style.top = anchor.bottom + 6 + 'px';
      document.body.appendChild(menu);
      const close = (e) => {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
      };
      setTimeout(() => document.addEventListener('mousedown', close), 10);
      SK.app.onLeave(() => menu.remove());
    }

    /* ---------------- 示例菜单 ---------------- */
    function openSampleMenu(anchor) {
      const menu = el('div', { class: 'send-menu' });
      const list = el('div', { class: 'sm-list' });
      menu.appendChild(list);
      SAMPLES.forEach((s) => {
        list.appendChild(el('button', { class: 'sm-item', text: s.name, onClick: () => {
          setValue(s.code);
          menu.remove();
          SK.ui.toast('已填入示例：' + s.name, 'ok');
          run();
        } }));
      });
      menu.style.left = anchor.getBoundingClientRect().left + 'px';
      menu.style.top = anchor.getBoundingClientRect().bottom + 6 + 'px';
      document.body.appendChild(menu);
      const close = (e) => {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
      };
      setTimeout(() => document.addEventListener('mousedown', close), 10);
      SK.app.onLeave(() => menu.remove());
    }

    /* ---------------- 执行 ---------------- */
    async function run() {
      if (running) return;
      const code = ta.value;
      if (!code.trim()) { SK.ui.toast('先写点代码，或点 ✨ 填示例', 'warn'); return; }
      closeAC();
      closeFind();
      running = true;
      runBtn.disabled = true;
      runBtn.classList.add('busy');
      clearConsole();
      addLine({ t: 'info', s: '正在提交到 V8 沙箱（' + (engineInfo || '后台线程') + '）…' });
      const t0 = performance.now();
      try {
        const r = await SK.exec.call(sandboxRunner, [code, envJson], { timeout: 15000 });
        engineInfo = engineLabel(r && r.ua);
        paintResult(r);
      } catch (e) {
        addLine({ t: 'error', s: (e && e.message) || String(e) });
        if (e && e.code === 'TIMEOUT') addLine({ t: 'warn', s: '执行超过 15 秒已被掐死：多半是 while(true) 或超大的同步循环' });
      } finally {
        running = false;
        runBtn.disabled = false;
        runBtn.classList.remove('busy');
        conFoot.textContent = '耗时 ' + SK.dom.fmtMs(performance.now() - t0) + (engineInfo ? ' · ' + engineInfo : '');
      }
    }

    function engineLabel(ua) {
      if (!ua) return '浏览器 JS 引擎';
      const m = /Chrome\/([\d.]+)/.exec(ua) || /Firefox\/([\d.]+)/.exec(ua) || /Version\/([\d.]+).*Safari/.exec(ua);
      const name = /Firefox/.test(ua) ? 'SpiderMonkey' : /Safari/.test(ua) && !/Chrome/.test(ua) ? 'JavaScriptCore' : 'V8';
      return name + (m ? ' · ' + m[1].split('.')[0] : '');
    }

    function clearConsole() {
      SK.dom.clear(conBody);
    }

    function addLine(item) {
      const row = el('div', { class: 'pg-line pg-' + (item.t || 'log') }, [
        el('span', { class: 'pg-line-mark', text: item.t === 'error' ? '✕' : item.t === 'warn' ? '!' : item.t === 'info' ? 'i' : '›' }),
        el('span', { class: 'pg-line-text', text: item.s }),
      ]);
      conBody.appendChild(row);
      conBody.scrollTop = conBody.scrollHeight;
      return row;
    }

    function paintResult(r) {
      if (!r) return;
      (r.logs || []).forEach(addLine);
      if (r.error) {
        const row = addLine({ t: 'error', s: r.error });
        if (r.errorLine > 0) {
          row.appendChild(el('button', { class: 'btn tiny pg-goto', text: '→ 第 ' + r.errorLine + ' 行', onClick: () => gotoLine(r.errorLine) }));
        }
      }
      const hasResult = r.result !== undefined && r.result !== null && r.result !== '';
      if (hasResult) addLine({ t: 'ok', s: '返回值: ' + r.result });
      if (r.envCount) addLine({ t: 'dim', s: '已注入环境变量 ' + r.envCount + ' 个：' + (r.envKeys || []).slice(0, 12).join(', ') + ((r.envKeys || []).length > 12 ? ' …' : '') });
      const gl = (r.globals || []).filter(function (g) { return !/^(window|self|globalThis|document|navigator|location|history|screen|localStorage|sessionStorage|performance|matchMedia|getComputedStyle|requestAnimationFrame|cancelAnimationFrame|XMLHttpRequest|fetch|Image|Event|CustomEvent|crypto)$/.test(g.name); });
      if (gl.length) {
        addLine({ t: 'info', s: '新增全局变量 ' + gl.length + ' 个（补环境/找 key 用）' });
        gl.slice(0, 60).forEach(function (g) { addLine({ t: 'log', s: '  window.' + g.name + ' = ' + g.value }); });
        if (gl.length > 60) addLine({ t: 'dim', s: '  …还有 ' + (gl.length - 60) + ' 个' });
      }
      if (!hasResult && !r.error) addLine({ t: 'dim', s: '（无返回值；用 return 或 console.log 输出内容）' });
      conFoot.textContent = '执行 ' + SK.dom.fmtMs(r.ms || 0) + ' · ' + engineLabel(r.ua);
    }

    function gotoLine(n) {
      const lines = ta.value.split('\n');
      let pos = 0;
      for (let i = 0; i < Math.min(n - 1, lines.length); i++) pos += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
      const line = n - 1;
      ta.scrollTop = Math.max(0, line * (parseFloat(getComputedStyle(ta).lineHeight) || 19) - ta.clientHeight / 2);
      gutter.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
    }

    runBtn.addEventListener('click', run);

    /* 引擎信息：主线程即可获取（同一浏览器） */
    engineInfo = engineLabel(navigator.userAgent);
    const engineEl = host.querySelector('#sb-engine');
    if (engineEl) engineEl.textContent = engineInfo;

    refresh();
    ctx.toast('提示：输入对象后打 . 出代码提示；Ctrl+F 查找；Ctrl+Enter 运行', 'info');
  }
})();
