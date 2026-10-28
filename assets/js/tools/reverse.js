/* JS 逆向辅助：反混淆 / 结构分析 / 补环境 / Hook 脚本 / 断点表达式 / JWT */
(function () {

  SK.tool({
    id: 'js-deobf',
    name: 'JS 反混淆',
    group: 'reverse',
    icon: '🜁',
    aliases: 'deobf 反混淆 还原 混淆 解密 debugger',
    keywords: ['反混淆', 'deobf', '混淆', '还原', '字符串数组', 'debugger', 'js逆向'],
    desc: '字符串数组还原、\\x/\\u 转义还原、十六进制数字、常量折叠、obj["prop"] 转 .prop、去 debugger 与空死循环，并输出改动报告',
    sample: 'obf',
    hint: '还原后建议再跑一次「JS 格式化」，可读性会更好',
    inputs: [{ id: 'in', label: '混淆 JS', placeholder: '粘贴 _0x 开头的混淆代码', sample: 'obf' }],
    options: [
      { id: 'fmt', type: 'toggle', label: '顺带格式化', value: true },
      { id: 'debugger', type: 'toggle', label: '删 debugger', value: true },
      { id: 'unescape', type: 'toggle', label: '还原转义', value: true },
      { id: 'indent', type: 'select', label: '缩进', value: '2', choices: [{ v: '2', label: '2 空格' }, { v: '4', label: '4 空格' }, { v: 'tab', label: 'Tab' }] },
    ],
    help: '<h4>能做到 / 做不到</h4><p><b>能</b>：字符串数组与取值函数、十六进制/Unicode 转义、常量拼接、fromCharCode、成员访问、反调试片段。</p><p><b>不能</b>：控制流平坦化（switch-case 调度器）、OB 混淆的 Proxy 防护、自定义虚拟机。这类要靠动态调试。</p><h4>处理顺序</h4><ol><li>先反混淆拿到可读结构</li><li>用「结构分析」找 sign / encrypt 函数</li><li>用「Hook 脚本」在浏览器里打印入参</li><li>用「加解密」验证算法</li></ol>',
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      if (!text.trim()) return { error: '输入为空' };
      const r = SK.code.deobf(text, { debugger: !!opts.debugger, unescape: !!opts.unescape });
      let out = r.text;
      if (opts.fmt) out = SK.code.js(out, { indent: opts.indent === 'tab' ? '\t' : Number(opts.indent || 2) });
      const reportLines = r.report.map((x) => '• ' + x.msg + (x.count ? '（' + x.count + ' 处）' : ''));
      return {
        text: out,
        lang: 'js',
        tabs: [{ label: '改动报告 (' + r.report.length + ')', text: reportLines.join('\n') || '没有检测到可自动还原的混淆特征', lang: 'text' }],
        stats: [{ k: '原始', v: SK.dom.fmtBytes(r.stats.inBytes) }, { k: '输出', v: SK.dom.fmtBytes(out.length) }, { k: '改动', v: r.report.length + ' 项' }],
        notices: r.report.length ? null : [{ level: 'warn', msg: '没识别到常见混淆特征，可能是控制流平坦化或自定义 VM，需要动态调试' }],
        filename: 'deobf',
        next: [
          { label: '🔍 接着结构分析找 sign', tool: 'js-outline' },
          { label: '▶ 丢进沙箱跑一跑', tool: 'js-sandbox' },
        ],
      };
    },
  });

  SK.tool({
    id: 'js-outline',
    name: 'JS 结构分析',
    group: 'reverse',
    icon: '⌗',
    aliases: 'outline 结构 函数列表 敏感点 定位 找函数',
    keywords: ['js逆向', '结构', '函数', '定位', 'sign', '加密', '接口', 'url'],
    desc: '提取函数清单（含参数与行号）、加密/签名/请求/指纹等敏感点、URL 与 API 端点，快速定位关键函数',
    sample: 'js',
    hint: '大文件先跑「JS 反混淆」，敏感点会更清晰',
    inputs: [{ id: 'in', label: 'JS 源码', placeholder: '粘贴目标站点 JS', sample: 'js' }],
    options: [
      { id: 'max', type: 'number', label: '最多显示', value: 400, min: 20, max: 5000 },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      if (!text.trim()) return { error: '输入为空' };
      const r = SK.code.analyze(text);
      const max = Number(opts.max || 400);
      const fns = r.functions.slice(0, max).map((f) => ({ line: f.line, name: f.name, params: f.params, kind: f.kind }));
      const hits = r.hits.slice(0, max).map((h) => ({ line: h.line, kind: h.kind, kw: h.kw, msg: h.msg, code: h.text }));
      const urls = r.urls.slice(0, max).map((u) => ({ line: u.line, url: u.url }));
      const summary = [
        '文件: ' + SK.dom.fmtBytes(text.length) + ' / ' + r.stats.lines + ' 行',
        '函数: ' + r.functions.length + ' 个',
        '敏感点: ' + r.hits.length + ' 处',
        'URL: ' + r.urls.length + ' 条',
        '',
        '优先看的函数（名字含 sign/token/encrypt/get/post 等）:',
        r.functions.filter((f) => /sign|token|encrypt|decrypt|hash|auth|verify|get|post|request|ajax/i.test(f.name)).slice(0, 30).map((f) => '  L' + f.line + '  ' + f.name + '(' + f.params + ')').join('\n') || '  （没有明显命名，建议按敏感点行号查看）',
      ].join('\n');
      return {
        text: summary,
        lang: 'text',
        tabs: [
          { label: '函数 (' + fns.length + ')', view: 'table', data: { columns: [{ key: 'line', label: '行', width: '70px' }, { key: 'name', label: '函数名', width: 'minmax(140px,240px)' }, { key: 'params', label: '参数' }, { key: 'kind', label: '形式', width: '90px' }], rows: fns, name: 'functions', filterHint: '按函数名过滤，例如 sign' } },
          { label: '敏感点 (' + hits.length + ')', view: 'table', data: { columns: [{ key: 'line', label: '行', width: '70px' }, { key: 'kind', label: '类型', width: '80px' }, { key: 'kw', label: '命中', width: '140px' }, { key: 'msg', label: '说明', width: 'minmax(150px,240px)' }, { key: 'code', label: '代码片段' }], rows: hits, name: 'hits', filterHint: '过滤：crypto / sign / fp / net' } },
          { label: 'URL (' + urls.length + ')', view: 'table', data: { columns: [{ key: 'line', label: '行', width: '70px' }, { key: 'url', label: 'URL' }], rows: urls, name: 'urls' } },
        ],
        stats: [{ k: '函数', v: r.functions.length }, { k: '敏感点', v: r.hits.length }, { k: 'URL', v: r.urls.length }],
        filename: 'outline',
        next: [
          { label: '▶ 拿去沙箱验证', tool: 'js-sandbox' },
        ],
      };
    },
  });

  SK.tool({
    id: 'js-env',
    name: '环境扫描与骨架生成',
    group: 'reverse',
    icon: '🧩',
    aliases: 'env 补环境 补环境检测 jsdom 环境检测 指纹 navigator',
    keywords: ['补环境', 'js逆向', '环境', 'navigator', 'webdriver', '指纹', 'jsdom'],
    desc: '扫描代码用到的 window/navigator/document/location 属性，列出检测点、生成补环境骨架，并支持真机 dump 与 Node dump 的属性级对照',
    sample: 'js',
    inputs: [
      { id: 'in', label: 'JS 源码 / 环境A dump JSON（对照模式）', placeholder: '粘贴需要补环境的代码；对照模式贴真机 dump JSON', sample: { by: 'style', map: { diff: 'envDumpA', node: 'js', jsdom: 'js' }, default: 'js' } },
      { id: 'in2', label: '环境B dump JSON（对照模式用，Node 补环境那份）', placeholder: '{ "userAgent": "Mozilla...", ... }', small: true, allowEmpty: true, sample: 'envDumpB' },
    ],
    options: [
      { id: 'style', type: 'seg', label: '模式', value: 'node', choices: [{ v: 'node', label: '骨架' }, { v: 'jsdom', label: 'jsdom 骨架' }, { v: 'diff', label: '环境对照 diff' }] },
      { id: 'proxy', type: 'toggle', label: '加 Proxy 兜底', value: true, title: '未定义属性返回空字符串，避免 undefined 报错' },
    ],
    handler: function (input, input2, opts) {
      const text = String(input == null ? '' : input);
      const inputs1Text = String(input2 == null ? '' : input2);
      if (!text.trim()) return { error: '输入为空' };
      /* ---------- 对照模式：两份 dump JSON 的属性路径级 diff ---------- */
      if (opts.style === 'diff') {
        let A, B;
        try { A = JSON.parse(text); } catch (e) { return { error: '环境A 不是合法 JSON：' + e.message, hint: '对照模式：第一个框贴真机 dump JSON，第二个框贴 Node 补环境 dump JSON' }; }
        if (!inputs1Text.trim()) return { error: '环境B（第二个输入框）为空', hint: '先两边跑「① dump 对照脚本」，输出 JSON 分别贴到两个框，模式切到「环境对照 diff」' };
        try { B = JSON.parse(inputs1Text); } catch (e) { return { error: '环境B 不是合法 JSON：' + e.message }; }
        const flat = function (obj, prefix, out) {
          for (const k in obj) {
            const v = obj[k];
            const p = prefix ? prefix + '.' + k : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out);
            else out[p] = Array.isArray(v) ? '[array:' + v.length + ']' : (v === null ? 'null' : String(v).slice(0, 160));
          }
          return out;
        };
        const fa = flat(A, '', {});
        const fb = flat(B, '', {});
        const onlyA = [], onlyB = [], diffVal = [];
        const RISK = /webdriver|plugins|languages|hardwareConcurrency|deviceMemory|platform|userAgent|vendor|chrome|phantom|selenium|cdc_/i;
        for (const k in fa) {
          if (!(k in fb)) onlyA.push({ path: k, a: fa[k], risk: RISK.test(k) ? '⚠ 检测位' : '' });
          else if (fa[k] !== fb[k]) diffVal.push({ path: k, a: fa[k].slice(0, 80), b: fb[k].slice(0, 80), risk: RISK.test(k) ? '⚠ 检测位' : '' });
        }
        for (const k in fb) if (!(k in fa)) onlyB.push({ path: k, b: fb[k], risk: RISK.test(k) ? '⚠ 检测位' : '' });
        const summary = [
          '环境A(真机) 属性数: ' + Object.keys(fa).length,
          '环境B(补环境) 属性数: ' + Object.keys(fb).length,
          '只在真机有: ' + onlyA.length + '  ← 补环境缺的，可能被检测',
          '只在补环境有: ' + onlyB.length + '  ← 多余的，暴露特征',
          '值不同: ' + diffVal.length,
        ].join('\n');
        return {
          text: summary,
          lang: 'text',
          tabLabel: '对照摘要',
          tabs: [
            { label: '缺的属性 (' + onlyA.length + ')', view: 'table', data: { columns: [{ key: 'path', label: '属性路径' }, { key: 'a', label: '真机值' }, { key: 'risk', label: '风险', width: '90px' }], rows: onlyA, name: 'env-missing' } },
            { label: '多余属性 (' + onlyB.length + ')', view: 'table', data: { columns: [{ key: 'path', label: '属性路径' }, { key: 'b', label: '补环境值' }, { key: 'risk', label: '风险', width: '90px' }], rows: onlyB, name: 'env-extra' } },
            { label: '值不同 (' + diffVal.length + ')', view: 'table', data: { columns: [{ key: 'path', label: '属性路径' }, { key: 'a', label: '真机' }, { key: 'b', label: '补环境' }, { key: 'risk', label: '风险', width: '90px' }], rows: diffVal, name: 'env-diff' } },
          ],
          stats: [
            { k: '缺失', v: onlyA.length, level: onlyA.length ? 'warn' : 'ok' },
            { k: '多余', v: onlyB.length, level: onlyB.length ? 'warn' : 'ok' },
            { k: '值不同', v: diffVal.length, level: diffVal.length ? 'warn' : 'ok' },
          ],
          notices: onlyA.length ? [{ level: 'warn', msg: '把「缺的属性」补进环境骨架；⚠ 检测位 标记的属性优先处理' }] : [{ level: 'ok', msg: '两边环境一致' }],
          filename: 'env-diff',
        };
      }
      const groups = {};
      const push = (obj, prop) => {
        (groups[obj] = groups[obj] || {})[prop] = 1;
      };
      const re = /\b(window|navigator|document|location|screen|history|performance)\.([A-Za-z_$][\w$]*)/g;
      let m;
      while ((m = re.exec(text))) push(m[1], m[2]);
      const re2 = /\b(window|navigator|document|location|screen)\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/g;
      while ((m = re2.exec(text))) push(m[1], m[2]);
      const total = Object.keys(groups).reduce((a, k) => a + Object.keys(groups[k]).length, 0);
      if (!total) return { error: '没有扫描到浏览器环境属性访问', hint: '可能代码被压缩成别名（如 var n=navigator），先反混淆再试' };

      const DEFAULTS = {
        navigator: { webdriver: 'false', userAgent: '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"', platform: '"Win32"', language: '"zh-CN"', languages: '["zh-CN", "zh"]', hardwareConcurrency: '8', deviceMemory: '8', cookieEnabled: 'true', onLine: 'true', vendor: '"Google Inc."', plugins: '[]', mimeTypes: '[]', maxTouchPoints: '0', doNotTrack: 'null', appVersion: '"5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"' },
        document: { cookie: '""', referrer: '""', title: '""', domain: '"example.com"', URL: '"https://example.com/"', hidden: 'false', visibilityState: '"visible"', readyState: '"complete"' },
        location: { href: '"https://example.com/"', protocol: '"https:"', host: '"example.com"', hostname: '"example.com"', port: '""', pathname: '"/"', search: '""', hash: '""', origin: '"https://example.com"' },
        screen: { width: '1920', height: '1080', availWidth: '1920', availHeight: '1040', colorDepth: '24', pixelDepth: '24' },
        window: { innerWidth: '1920', innerHeight: '1080', outerWidth: '1920', outerHeight: '1080', devicePixelRatio: '1', name: '""', isSecureContext: 'true' },
        history: { length: '1' },
        performance: { now: '() => Date.now() - __t0', timeOrigin: 'Date.now()' },
      };
      const lines = [];
      lines.push('// 由 SpiderLab 生成：补环境骨架（按需修改取值，别直接上生产）');
      lines.push('// 用法: node env.js 之后 require 目标脚本，或把目标代码粘贴到文件末尾');
      if (opts.style === 'jsdom') {
        lines.push("const { JSDOM } = require('jsdom');");
        lines.push("const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/', referrer: 'https://example.com/', pretendToBeVisual: true });");
        lines.push('const { window } = dom;');
        lines.push('global.window = window;');
        lines.push('global.document = window.document;');
        lines.push('global.navigator = window.navigator;');
        lines.push('global.location = window.location;');
        lines.push('global.screen = window.screen;');
        lines.push('');
      } else {
        lines.push('const __t0 = Date.now();');
        lines.push('const window = globalThis;');
        lines.push('const document = {');
        lines.push('  cookie: "", referrer: "", title: "", domain: "example.com",');
        lines.push('  documentElement: { clientWidth: 1920, clientHeight: 1080 },');
        lines.push('  createElement: () => ({ getContext: () => null, style: {}, appendChild() {}, setAttribute() {} }),');
        lines.push('  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],');
        lines.push('  getElementsByTagName: () => [], getElementById: () => null,');
        lines.push('};');
        lines.push('const navigator = {};');
        lines.push('const location = {};');
        lines.push('const screen = {};');
        lines.push('const history = {};');
        lines.push('const performance = { now: () => Date.now() - __t0, timeOrigin: __t0 };');
        lines.push('');
      }
      Object.keys(groups).sort().forEach((obj) => {
        const props = Object.keys(groups[obj]).sort();
        const defs = DEFAULTS[obj] || {};
        lines.push('/* ---- ' + obj + ' ---- */');
        if (opts.proxy) {
          lines.push('const __' + obj + 'Raw = ' + obj + ';');
        }
        props.forEach((p) => {
          const val = defs[p] !== undefined ? defs[p] : '""';
          const needsGet = !/^\(|^\[|^"/.test(val) && val !== 'null' && !/^\d+$/.test(val) && !/^(true|false)$/.test(val);
          if (needsGet) lines.push('Object.defineProperty(' + obj + ", '" + p + "', { get: () => (" + val + '), configurable: true });');
          else lines.push('Object.defineProperty(' + obj + ", '" + p + "', { get: () => " + val + ', configurable: true });');
        });
        lines.push('');
      });
      if (opts.proxy && opts.style !== 'jsdom') {
        lines.push('/* ---- Proxy 兜底：未定义属性返回空串，避免读取时报错 ---- */');
        lines.push('function __wrap(name, target) {');
        lines.push('  return new Proxy(target, {');
        lines.push('    get(t, k) {');
        lines.push('      if (k in t) return t[k];');
        lines.push('      if (typeof k === "symbol") return undefined;');
        lines.push('      return "";');
        lines.push('    },');
        lines.push('  });');
        lines.push('}');
        lines.push('globalThis.navigator = __wrap("navigator", navigator);');
        lines.push('globalThis.document = __wrap("document", document);');
        lines.push('globalThis.location = __wrap("location", location);');
        lines.push('globalThis.screen = __wrap("screen", screen);');
        lines.push('');
      }
      lines.push('/* ---- 常见检测兜底 ---- */');
      lines.push('// 1. webdriver 检测');
      lines.push("try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch (e) {}");
      lines.push('// 2. toString 检测：让补的函数看起来像原生');
      lines.push('const __native = Function.prototype.toString;');
      lines.push('Function.prototype.toString = function () {');
      lines.push("  if (this === Function.prototype.toString) return 'function toString() { [native code] }';");
      lines.push('  return __native.call(this);');
      lines.push('};');
      lines.push('// 3. 定时器/调试检测（按需删掉）');
      lines.push('// globalThis.setInterval = () => 0;');
      lines.push('// globalThis.setTimeout = (fn) => 0;');

      const detect = [];
      if (/webdriver/i.test(text)) detect.push({ k: 'navigator.webdriver', v: '检测自动化标志', level: 'warn' });
      if (/plugins/i.test(text)) detect.push({ k: 'navigator.plugins', v: '检测插件列表（无头浏览器为空）', level: 'warn' });
      if (/canvas|getImageData|toDataURL/i.test(text)) detect.push({ k: 'canvas 指纹', v: 'toDataURL/getImageData 结果与环境相关', level: 'warn' });
      if (/WebGLRenderingContext|getParameter/i.test(text)) detect.push({ k: 'WebGL 指纹', v: 'UNMASKED_RENDERER 会暴露显卡', level: 'warn' });
      if (/AudioContext|OscillatorNode/i.test(text)) detect.push({ k: 'Audio 指纹', v: '音频指纹', level: 'info' });
      if (/toString\(\)/i.test(text)) detect.push({ k: 'Function.toString', v: '检测函数是否被 hook', level: 'info' });
      if (detect.length < 4) {
        if (/Date\.now|performance\.now/i.test(text)) detect.push({ k: '时间检测', v: '对比时间差判断是否调试', level: 'info' });
        if (/window\.top|self\.top|frameElement/i.test(text)) detect.push({ k: 'iframe 检测', v: '判断是否被嵌入', level: 'info' });
      }
      const rows = [];
      Object.keys(groups).sort().forEach((obj) => Object.keys(groups[obj]).sort().forEach((p) => rows.push({ obj: obj, prop: p, hit: '源码中出现' })));

      /* dump 对照脚本：真机浏览器 / Node 补环境各跑一份，输出 JSON 喂给「环境对照 diff」模式 */
      const dumpScript = [
        '/* SpiderLab 环境 dump —— 分别在 ①真机浏览器控制台 ②Node 补环境 里执行，各复制一份输出 JSON */',
        '(function () {',
        '  function val(v) {',
        '    try {',
        '      if (typeof v === "function") return "[fn]";',
        '      if (v && typeof v === "object") return Array.isArray(v) ? "[array:" + v.length + "]" : (v instanceof Date ? v.toISOString() : "[object]");',
        '      if (typeof v === "symbol" || typeof v === "bigint") return String(v);',
        '      return v === undefined ? "undefined" : String(v).slice(0, 160);',
        '    } catch (e) { return "[throw]"; }',
        '  }',
        '  function props(name, obj, list) {',
        '    const out = {};',
        '    if (!obj) return out;',
        '    let names = [];',
        '    try { names = names.concat(Object.getOwnPropertyNames(obj)); } catch (e) {}',
        '    try { names = names.concat(Object.getOwnPropertyNames(Object.getPrototypeOf(obj) || {})); } catch (e) {}',
        '    names.filter(function (n) { return list ? list.indexOf(n) >= 0 : true; }).forEach(function (n) { out[n] = val(obj[n]); });',
        '    return out;',
        '  }',
        '  const g = (typeof globalThis !== "undefined") ? globalThis : self;',
        '  const dump = {};',
        '  try { dump.navigator = props("navigator", g.navigator); } catch (e) { dump.navigator = { error: String(e) }; }',
        '  try { dump.screen = props("screen", g.screen); } catch (e) {}',
        '  try { dump.location = props("location", g.location); } catch (e) {}',
        '  try { dump.document = props("document", g.document, ["cookie","referrer","title","domain","URL","readyState","hidden","visibilityState","characterSet"]); } catch (e) {}',
        '  try { dump.window = props("window", g, ["innerWidth","innerHeight","outerWidth","outerHeight","devicePixelRatio","name","isSecureContext","origin","chrome"]); } catch (e) {}',
        '  try { dump.performance = props("performance", g.performance, ["timeOrigin"]); } catch (e) {}',
        '  try { dump.history = props("history", g.history); } catch (e) {}',
        '  try { dump.navigator_plugins = Array.from(g.navigator.plugins || []).map(function (p) { return p.name + "|" + (p.filename || ""); }); } catch (e) {}',
        '  console.log("%c[dump] 复制下面整段 JSON", "color:#35d07f;font-weight:bold");',
        '  console.log(JSON.stringify(dump, null, 2));',
        '})();',
      ].join('\n');

      return {
        text: lines.join('\n'),
        lang: 'js',
        tabs: [
          { label: '属性清单 (' + rows.length + ')', view: 'table', data: { columns: [{ key: 'obj', label: '对象', width: '120px' }, { key: 'prop', label: '属性' }, { key: 'hit', label: '来源', width: '140px' }], rows: rows, name: 'env', filterHint: '过滤属性名' } },
          { label: '检测点', view: 'table', data: { columns: [{ key: 'k', label: '检测项', width: 'minmax(140px,220px)' }, { key: 'v', label: '说明' }], rows: detect, name: 'detect' } },
          { label: '① dump 对照脚本', text: dumpScript, lang: 'js' },
          { label: '② 用法', text: ['== 环境对照三步 ==', '1. 复制「dump 对照脚本」→ 真机浏览器控制台执行 → 复制输出的 JSON → 贴到本工具第一个输入框', '2. 在 Node 补环境骨架里 require 或粘贴同一脚本执行 → 输出 JSON 贴到第二个输入框', '3. 模式切到「环境对照 diff」→ 运行：缺的属性（要补）/ 多余属性（会暴露）/ 值不同（标红检测位）'].join('\n'), lang: 'text' },
        ],
        stats: [{ k: '对象', v: Object.keys(groups).length }, { k: '属性', v: total }, { k: '检测点', v: detect.length }],
        filename: 'env',
      };
    },
  });

  SK.tool({
    id: 'js-hook',
    name: 'Hook 脚本生成',
    group: 'reverse',
    icon: '🪝',
    aliases: 'hook 脚本 xhr fetch cookie cryptojs 拦截 websocket canvas debugger',
    keywords: ['hook', '拦截', 'xhr', 'fetch', 'cookie', 'cryptojs', 'websocket', 'canvas', 'js逆向', '断点', '模板'],
    desc: '生成可直接粘进控制台的 Hook 脚本：XHR/fetch/WebSocket/Cookie/CryptoJS/Canvas 等全覆盖，每个 Hook 另附「简单版 + 增强版」模板',
    inputs: [{ id: 'in', label: '补充关键字（可选）', placeholder: '例如 sign,deviceId；用于堆栈过滤', sample: 'js' }],
    allowEmpty: true,
    options: [
      { id: 'xhr', type: 'toggle', label: 'XHR', value: true },
      { id: 'fetch', type: 'toggle', label: 'fetch', value: true },
      { id: 'cookie', type: 'toggle', label: 'document.cookie', value: true },
      { id: 'storage', type: 'toggle', label: 'localStorage', value: false },
      { id: 'crypto', type: 'toggle', label: 'CryptoJS', value: true },
      { id: 'json', type: 'toggle', label: 'JSON.stringify', value: false },
      { id: 'ws', type: 'toggle', label: 'WebSocket', value: false },
      { id: 'canvas', type: 'toggle', label: 'Canvas 指纹', value: false },
      { id: 'debugger', type: 'toggle', label: 'debugger 绕过', value: false },
      { id: 'timer', type: 'toggle', label: '定时器', value: false },
      { id: 'date', type: 'toggle', label: 'Date.now', value: false },
      { id: 'stack', type: 'toggle', label: '打印调用栈', value: true },
    ],
    help:
      '<h4>两种用法</h4>' +
      '<ul><li><b>组合脚本</b>：勾选要的 Hook 点运行，得到一段合并脚本，粘进 DevTools Console 即可（Hook 必须在目标代码执行前注入，粘完刷新页面）。</li>' +
      '<li><b>模板页签</b>：每个 Hook 有独立页签，内含「简单版」（大众写法，几行即用）和「增强版」（防重复注入、调用栈、toString 伪装），按场景整段复制。</li></ul>' +
      '<h4>怎么选版本</h4>' +
      '<ul><li>快速看一眼参数 → 简单版</li><li>站点有反调试 / 反 Hook 检测，或要长时间挂机分析 → 增强版</li></ul>' +
      '<h4>常见套路</h4>' +
      '<ol><li>先挂 XHR/fetch 看哪些请求带加密参数</li><li>用关键字过滤（输入框填 sign/token）+ 调用栈定位加密函数</li><li>加密在 cookie 里就挂 Cookie，长连接就挂 WebSocket，图片指纹就挂 Canvas</li><li>断不进去先跑「无限 debugger 绕过」</li></ol>',
    handler: function (input, opts) {
      const kw = String(input == null ? '' : input).split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      const L = [];
      L.push('/* SpiderLab Hook 脚本 — 打开 DevTools Console 粘贴执行，刷新页面后生效 */');
      L.push('(function () {');
      L.push("  const TAG = '%c[Hook]';");
      L.push("  const CSS = 'color:#fff;background:#4f46e5;padding:1px 4px;border-radius:3px';");
      L.push('  const stack = () => {');
      if (opts.stack) L.push('    const s = new Error().stack || ""; return s.split("\\n").slice(2, 7).join("\\n");');
      else L.push('    return "";');
      L.push('  };');
      if (kw.length) {
        L.push('  const KW = ' + JSON.stringify(kw) + ';');
        L.push('  const hitKw = (s) => KW.some((k) => String(s).indexOf(k) >= 0);');
      }
      L.push('');
      if (opts.xhr) {
        L.push('  /* ---------- XHR ---------- */');
        L.push('  const XO = XMLHttpRequest.prototype.open;');
        L.push('  const XS = XMLHttpRequest.prototype.send;');
        L.push('  const XH = XMLHttpRequest.prototype.setRequestHeader;');
        L.push('  XMLHttpRequest.prototype.open = function (m, u) {');
        L.push('    this.__m = m; this.__u = u; this.__h = {};');
        L.push('    return XO.apply(this, arguments);');
        L.push('  };');
        L.push('  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {');
        L.push('    this.__h[k] = v;');
        L.push('    return XH.apply(this, arguments);');
        L.push('  };');
        L.push('  XMLHttpRequest.prototype.send = function (body) {');
        L.push('    this.addEventListener("load", () => {');
        L.push('      console.log(TAG, CSS, this.__m, this.__u);');
        L.push('      console.log("  headers:", this.__h);');
        L.push('      console.log("  body:", body);');
        L.push('      console.log("  resp:", String(this.responseText || "").slice(0, 500));');
        L.push('      console.log("  stack:\\n" + stack());');
        L.push('    });');
        L.push('    return XS.apply(this, arguments);');
        L.push('  };');
        L.push('');
      }
      if (opts.fetch) {
        L.push('  /* ---------- fetch ---------- */');
        L.push('  const F = window.fetch;');
        L.push('  /* Headers 实例直接打日志只能看到 "Headers {…}"，复制不出来；');
        L.push('     转普通对象再 JSON.stringify，签名头/UA 才能一眼看到并复制 */');
        L.push('  const hdrObj = (h) => {');
        L.push('    const o = {};');
        L.push('    if (!h) return o;');
        L.push('    try {');
        L.push('      if (typeof h.forEach === "function" && !Array.isArray(h)) h.forEach((v, k) => { o[k] = v; });');
        L.push('      else if (Array.isArray(h)) h.forEach((p) => { o[p[0]] = p[1]; });');
        L.push('      else Object.assign(o, h);');
        L.push('    } catch (e) {}');
        L.push('    return o;');
        L.push('  };');
        L.push('  window.fetch = function (input, init) {');
        L.push('    const url = typeof input === "string" ? input : input && input.url;');
        L.push('    const method = (init && init.method) || (input && input.method) || "GET";');
        L.push('    console.log(TAG, CSS, method, url);');
        L.push('    console.log("  headers:", JSON.stringify(hdrObj((init && init.headers) || (input && input.headers))));');
        L.push('    if (init && init.body != null) console.log("  body:", typeof init.body === "string" ? init.body : init.body);');
        L.push('    console.log("  stack:\\n" + stack());');
        L.push('    return F.apply(this, arguments).then((res) => {');
        L.push('      console.log("  resp:", res.status, res.url);');
        L.push('      const clone = res.clone();');
        L.push('      clone.text().then((t) => console.log("  resp-body:", String(t).slice(0, 500))).catch(() => {});');
        L.push('      return res;');
        L.push('    });');
        L.push('  };');
        L.push('');
      }
      if (opts.cookie) {
        L.push('  /* ---------- document.cookie ---------- */');
        L.push('  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");');
        L.push('  if (desc && desc.set) {');
        L.push('    Object.defineProperty(document, "cookie", {');
        L.push('      get() { return desc.get.call(document); },');
        L.push('      set(v) { console.log(TAG, CSS, "set cookie:", v); console.log("  stack:\\n" + stack()); return desc.set.call(document, v); },');
        L.push('      configurable: true,');
        L.push('    });');
        L.push('  }');
        L.push('');
      }
      if (opts.storage) {
        L.push('  /* ---------- localStorage ---------- */');
        L.push('  const LS = Storage.prototype.setItem;');
        L.push('  Storage.prototype.setItem = function (k, v) {');
        L.push('    console.log(TAG, CSS, "localStorage.setItem", k, "=", v);');
        L.push('    return LS.apply(this, arguments);');
        L.push('  };');
        L.push('');
      }
      if (opts.crypto) {
        L.push('  /* ---------- CryptoJS ---------- */');
        L.push('  const wrap = (obj, name) => {');
        L.push('    if (!obj || typeof obj[name] !== "function") return;');
        L.push('    const orig = obj[name];');
        L.push('    obj[name] = function () {');
        L.push('      const out = orig.apply(this, arguments);');
        L.push('      try {');
        L.push('        console.log(TAG, CSS, name, "输入:", arguments[0], "→ 输出:", String(out));');
        L.push('        console.log("  stack:\\n" + stack());');
        L.push('      } catch (e) {}');
        L.push('      return out;');
        L.push('    };');
        L.push('  };');
        L.push('  const hookCryptoJS = () => {');
        L.push('    if (!window.CryptoJS) return;');
        L.push('    ["MD5", "SHA1", "SHA256", "HmacMD5", "HmacSHA256", "AES"].forEach((n) => {');
        L.push('      wrap(CryptoJS, n);');
        L.push('      if (CryptoJS[n] && CryptoJS[n].encrypt) wrap(CryptoJS[n], "encrypt");');
        L.push('    });');
        L.push('  };');
        L.push('  hookCryptoJS();');
        L.push('  let tries = 0;');
        L.push('  const timer = setInterval(() => { if (window.CryptoJS) { hookCryptoJS(); clearInterval(timer); } else if (++tries > 100) clearInterval(timer); }, 200);');
        L.push('');
      }
      if (opts.json) {
        L.push('  /* ---------- JSON.stringify ---------- */');
        L.push('  const JS = JSON.stringify;');
        L.push('  JSON.stringify = function (v) {');
        L.push('    const out = JS.apply(this, arguments);');
        L.push('    try { if (out && out.length > 20) { console.log(TAG, CSS, "stringify:", v); console.log("  →", String(out).slice(0, 800)); } } catch (e) {}');
        L.push('    return out;');
        L.push('  };');
        L.push('');
      }
      if (opts.date) {
        L.push('  /* ---------- Date.now ---------- */');
        L.push('  const DN = Date.now;');
        L.push('  Date.now = function () { const v = DN.apply(Date, arguments); console.log(TAG, CSS, "Date.now →", v); return v; };');
        L.push('  const DP = Date.prototype.getTime;');
        L.push('  Date.prototype.getTime = function () { const v = DP.apply(this, arguments); return v; };');
        L.push('');
      }
      if (opts.ws) {
        L.push('  /* ---------- WebSocket ---------- */');
        L.push('  const _WS = window.WebSocket;');
        L.push('  function HookedWS(url, protocols) {');
        L.push('    console.log(TAG, CSS, "WS 连接:", url);');
        L.push('    const ws = protocols === undefined ? new _WS(url) : new _WS(url, protocols);');
        L.push('    ws.addEventListener("message", (e) => console.log(TAG, CSS, "WS 收:", String(e.data).slice(0, 500)));');
        L.push('    const send = ws.send;');
        L.push('    ws.send = function (data) { console.log(TAG, CSS, "WS 发:", String(data).slice(0, 500)); return send.apply(ws, arguments); };');
        L.push('    return ws;');
        L.push('  }');
        L.push('  HookedWS.prototype = _WS.prototype;');
        L.push('  HookedWS.CONNECTING = 0; HookedWS.OPEN = 1; HookedWS.CLOSING = 2; HookedWS.CLOSED = 3;');
        L.push('  window.WebSocket = HookedWS;');
        L.push('');
      }
      if (opts.canvas) {
        L.push('  /* ---------- Canvas 指纹 ---------- */');
        L.push('  const _TD = HTMLCanvasElement.prototype.toDataURL;');
        L.push('  HTMLCanvasElement.prototype.toDataURL = function () {');
        L.push('    console.log(TAG, CSS, "toDataURL", this.width + "x" + this.height);');
        L.push('    console.log("  stack:\\n" + stack());');
        L.push('    return _TD.apply(this, arguments);');
        L.push('  };');
        L.push('');
      }
      if (opts.timer) {
        L.push('  /* ---------- 定时器 ---------- */');
        L.push('  const _SI = window.setInterval;');
        L.push('  window.setInterval = function (fn, t) {');
        L.push('    if (String(fn).indexOf("debugger") >= 0) return 0;');
        L.push('    console.log(TAG, CSS, "setInterval", t + "ms", fn);');
        L.push('    return _SI.apply(window, arguments);');
        L.push('  };');
        L.push('');
      }
      if (opts.debugger) {
        L.push('  /* ---------- 无限 debugger 绕过 ---------- */');
        L.push('  const _C = Function.prototype.constructor;');
        L.push('  Function.prototype.constructor = function () {');
        L.push('    if (arguments.length && String(arguments[0]).indexOf("debugger") >= 0) return function () {};');
        L.push('    return _C.apply(this, arguments);');
        L.push('  };');
        L.push('  const _E = window.eval;');
        L.push('  window.eval = function (code) {');
        L.push('    if (typeof code === "string" && code.indexOf("debugger") >= 0) code = code.replace(/debugger/g, "");');
        L.push('    return _E.call(window, code);');
        L.push('  };');
        L.push('');
      }
      L.push('  console.log(TAG, CSS, "Hook 已注入");');
      L.push('})();');
      L.push('');
      if (!opts.debugger) {
        L.push('/* ---------- 无限 debugger 绕过（粘在 Sources → Snippets，设置断点后执行） ---------- */');
        L.push('// 方式 1：重写 Function 构造器，让 debugger 语句失效');
        L.push('// const _c = Function.prototype.constructor;');
        L.push('// Function.prototype.constructor = function (...a) {');
        L.push('//   if (a[0] === "debugger") return function () {};');
        L.push('//   return _c.apply(this, a);');
        L.push('// };');
        L.push('// 方式 2：右键行号 → Never pause here，或用 DevTools 的 Deactivate breakpoints (Ctrl+F8)');
        L.push('');
      }

      /* 模板库页签：每个 Hook 独立一页，含简单版 + 增强版 */
      const tplTabs = (SK.hookLib || []).map((t) => ({
        label: t.name,
        lang: 'js',
        text:
          '/* ════════ 简单版 · ' + t.name + '（大众写法，直接粘贴即用） ════════ */\n\n' +
          t.simple +
          '\n\n\n/* ════════ 增强版 · ' + t.name + '（防重复注入 + 调用栈，复杂/对抗场景用） ════════ */\n\n' +
          t.pro +
          (t.note ? '\n\n/* 场景提示：' + t.note + ' */' : ''),
      }));

      return {
        text: L.join('\n'),
        lang: 'js',
        tabLabel: '组合脚本',
        tabs: tplTabs,
        stats: [
          { k: 'Hook 项', v: [opts.xhr, opts.fetch, opts.cookie, opts.storage, opts.crypto, opts.json, opts.ws, opts.canvas, opts.debugger, opts.timer, opts.date].filter(Boolean).length },
          { k: '模板', v: (SK.hookLib || []).length + ' 个' },
          { k: '行数', v: L.length },
        ],
        filename: 'hook',
      };
    },
  });

  SK.tool({
    id: 'js-breakpoint',
    name: '断点表达式',
    group: 'reverse',
    icon: '⛌',
    aliases: 'breakpoint 断点 xhr 搜索 关键字 调试',
    keywords: ['断点', 'breakpoint', 'xhr', '搜索', '调试', 'js逆向'],
    desc: '生成 DevTools 断点方案：全局搜索词、XHR 断点 URL、事件断点、条件断点表达式，把“找不到加密位置”变成体力活',
    inputs: [{ id: 'in', label: 'URL / 参数名（可选）', placeholder: 'https://api.example.com/list?sign=xx', sample: 'url' }],
    allowEmpty: true,
    options: [
      { id: 'target', type: 'seg', label: '场景', value: 'sign', choices: [{ v: 'sign', label: '签名参数' }, { v: 'cookie', label: 'Cookie 生成' }, { v: 'json', label: '响应加密' }, { v: 'all', label: '全都给' }] },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).trim();
      let path = '';
      let params = [];
      try {
        if (/^https?:\/\//.test(raw)) {
          const u = new URL(raw);
          path = u.pathname;
          params = SK.net.parseQueryString(u.search).map((p) => p.name);
        }
      } catch (e) {}
      const kw = [];
      ['sign', 'signature', '_signature', 'x-sign', 'x_sign', 'token', 'nonce', 'timestamp', 'ts', '_t', 'auth', 'key', 'secret', 'encrypt', 'decrypt', 'md5', 'aes', 'rsa', 'sm3', 'btoa', 'atob'].forEach((k) => kw.push(k));
      params.forEach((p) => kw.push(p));
      if (path) {
        const last = path.split('/').filter(Boolean).pop();
        if (last) kw.push(last);
      }
      const uniq = Array.from(new Set(kw));
      const L = [];
      L.push('== 1. 全局搜索（Ctrl+Shift+F，勾选 Regular expression）==');
      L.push(uniq.map((k) => '  ' + k).join('   '));
      L.push('');
      L.push('== 2. 组合搜索表达式 ==');
      L.push('  (sign|signature|nonce|timestamp)\\s*[:=]');
      L.push('  (encrypt|decrypt|CryptoJS|JSEncrypt|sm2|sm3|sm4)');
      L.push('  (setRequestHeader|XMLHttpRequest|fetch)\\s*\\(');
      L.push('  JSON\\.(stringify|parse)\\s*\\(');
      L.push('  (?:\\.|\\[)(?:encrypt|getSign|sign)\\b');
      L.push('');
      L.push('== 3. XHR/Fetch 断点 ==');
      L.push('  Sources → XHR/fetch Breakpoints → + → 填 URL 片段：');
      L.push('    ' + (path ? path : '/api/') + '        （只留路径关键字，不要带 query）');
      L.push('  命中后看 Call Stack，从下往上第二三层通常就是业务代码');
      L.push('');
      L.push('== 4. 事件断点 ==');
      L.push('  Sources → Event Listener Breakpoints：');
      L.push('    Script → Script First Statement（页面加载即断，便于找入口）');
      L.push('    Mouse → click（找点击触发的加密）');
      L.push('    Load → load');
      L.push('');
      L.push('== 5. 条件断点表达式 ==');
      L.push('  在可疑函数首行右键 Add conditional breakpoint：');
      L.push('    arguments.length > 0            // 只停在有入参时');
      L.push('    typeof arguments[0] === "string" && arguments[0].length > 8');
      L.push('    /sign|token/i.test(JSON.stringify(arguments))');
      L.push('    this && this.responseURL && this.responseURL.includes("' + (path || '/api') + '")');
      L.push('');
      L.push('== 6. 控制台快速验证 ==');
      L.push('  // 打印所有函数入参（在某函数内执行）');
      L.push('  console.log(JSON.stringify([...arguments]))');
      L.push('  // 跟踪字符串拼接');
      L.push('  String.prototype.concat = new Proxy(String.prototype.concat, { apply(t, s, a) { console.log(s, a); return Reflect.apply(t, s, a); } });');
      L.push('');
      L.push('== 7. 定位到算法之后 ==');
      L.push('  1) 把可疑函数体复制到本工具「加解密」验证算法');
      L.push('  2) 用「JS 反混淆」清掉字符串数组');
      L.push('  3) 用「补环境检测」看是否有环境依赖，决定是否要 Node 复现');
      return {
        text: L.join('\n'),
        lang: 'text',
        stats: [{ k: '搜索词', v: uniq.length }, { k: '场景', v: opts.target }],
        filename: 'breakpoints',
      };
    },
  });

  SK.tool({
    id: 'jwt',
    name: 'JWT 解析',
    group: 'reverse',
    icon: '🎫',
    aliases: 'jwt token 解析 校验 hs256',
    keywords: ['jwt', 'token', '解析', 'hs256', '签名', 'payload'],
    desc: '拆解 JWT 的 header / payload，标出过期时间与剩余有效期；填了密钥还能校验 HS256/384/512 签名',
    sample: 'jwt',
    inputs: [{ id: 'in', label: 'JWT', placeholder: 'eyJhbGciOi…', sample: 'jwt' }],
    options: [
      { id: 'secret', type: 'text', label: '密钥（可选）', value: '', placeholder: '校验 HS256 时填写' },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).trim().replace(/^Bearer\s+/i, '');
      const parts = raw.split('.');
      if (parts.length !== 3) return { error: '不是标准 JWT（应为 3 段，用 . 分隔）', hint: 'JWE 是 5 段，本工具只支持 JWS（header.payload.signature）' };
      const dec = (s) => {
        let t = s.replace(/-/g, '+').replace(/_/g, '/');
        while (t.length % 4) t += '=';
        const bytes = SK.crypt.fromB64(t);
        return SK.crypt.decBytes(bytes, 'utf8');
      };
      let header, payload;
      try {
        header = JSON.parse(dec(parts[0]));
        payload = JSON.parse(dec(parts[1]));
      } catch (e) {
        return { error: '解码失败：' + e.message, hint: '检查是否复制完整，或用「Base64」工具手动解前两段' };
      }
      const now = Math.floor(Date.now() / 1000);
      const rows = [];
      const walk = (obj, prefix) => {
        Object.keys(obj).forEach((k) => {
          const v = obj[k];
          const key = prefix ? prefix + '.' + k : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
          else rows.push({ k: key, v: typeof v === 'object' ? JSON.stringify(v) : String(v) });
        });
      };
      walk(payload, '');
      const exp = payload.exp;
      const iat = payload.iat;
      const nbf = payload.nbf;
      const verdict = [];
      // 人类可读的时长：秒 → 分 → 小时 → 天
      const dur = (sec) => {
        const s = Math.abs(Math.round(sec));
        if (s < 60) return s + ' 秒';
        if (s < 3600) return Math.floor(s / 60) + ' 分钟';
        if (s < 172800) return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分';
        return Math.floor(s / 86400) + ' 天 ' + Math.floor((s % 86400) / 3600) + ' 小时';
      };
      if (exp) {
        const left = exp - now;
        verdict.push(left > 0 ? { level: 'ok', msg: '有效，剩余 ' + dur(left) } : { level: 'error', msg: '已过期 ' + dur(left) });
        rows.push({ k: 'exp（过期）', v: new Date(exp * 1000).toLocaleString('zh-CN') + '  (' + exp + ')' });
      }
      if (iat) rows.push({ k: 'iat（签发）', v: new Date(iat * 1000).toLocaleString('zh-CN') + '  (' + iat + ')' });
      if (nbf) rows.push({ k: 'nbf（生效）', v: new Date(nbf * 1000).toLocaleString('zh-CN') + '  (' + nbf + ')' });

      let verify = null;
      if (opts.secret) {
        const alg = String(header.alg || '').toUpperCase();
        const map = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
        if (!map[alg]) verify = { error: '该算法不支持本地校验：' + alg + '（仅支持 HS256/384/512）' };
        else {
          const expect = SK.crypt.hmac(map[alg], opts.secret, parts[0] + '.' + parts[1], { out: 'base64url' });
          verify = { ok: expect === parts[2], expect: expect, actual: parts[2], alg: alg };
        }
      }
      return {
        tabs: [
          { label: 'Header', text: JSON.stringify(header, null, 2), lang: 'json' },
          { label: 'Payload', text: JSON.stringify(payload, null, 2), lang: 'json' },
          { label: '字段', view: 'table', data: { columns: [{ key: 'k', label: '字段', width: 'minmax(110px,200px)' }, { key: 'v', label: '值' }], rows: rows, name: 'claims' } },
        ],
        text: JSON.stringify({ header: header, payload: payload }, null, 2),
        lang: 'json',
        stats: [
          header.alg ? { k: 'alg', v: header.alg } : null,
          header.typ ? { k: 'typ', v: header.typ } : null,
          exp ? { k: '剩余', v: exp > now ? dur(exp - now) : '已过期' } : null,
          verify ? { k: '签名', v: verify.ok ? '校验通过 ✓' : '校验失败 ✕', level: verify.ok ? 'ok' : 'error' } : null,
        ].filter(Boolean),
        notices: verdict.concat(verify ? [verify.error ? { level: 'warn', msg: verify.error } : { level: verify.ok ? 'ok' : 'error', msg: verify.ok ? '签名与密钥匹配' : '签名不匹配：密钥错误或内容被篡改' }] : []),
        filename: 'jwt',
      };
    },
  });
})();
