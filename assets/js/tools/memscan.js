/* ============================================================================
   Spider Lab · memscan.js
   内存漫游：给浏览器 window 全量变量赋值打点 + 字符串指纹入库 + 控制台搜索定位
   思路吸收自参考项目 ast-hook-for-js-RE（代理+AST 注入版），此处为控制台注入版：
   用户把生成的脚本粘进 DevTools Snippets / 油猴 document-start，
   之后在控制台用 __sp('加密参数值') 搜索变量名与代码位置。
   ========================================================================== */
(function () {

  SK.tool({
    id: 'mem-scan',
    name: '页面对象追踪脚本',
    group: 'reverse',
    icon: '🧠',
    aliases: 'memory scan 漫游 变量 搜索 内存定位 加密参数 内存漫游',
    keywords: ['内存漫游', '变量', '搜索', '定位', '加密参数', '内存', 'ast-hook', 'js逆向'],
    desc: '生成注入脚本：拦截对象属性写入与字符串出现位置，控制台 __sp("参数值") 反查它在哪被赋值——“加密参数在哪生成”的通杀辅助',
    /* 名称如实：它抓的是对象属性写入与字符串，抓不到闭包里的 let/const 局部变量 */
    capNote: '抓不到闭包内 let/const 变量；页面 load 之前就要注入',
    sample: 'texta',
    hint: '生成脚本粘到 DevTools Sources → Snippets 运行（或油猴 document-start），然后操作页面，最后 __sp() 搜索',
    inputs: [{ id: 'in', label: '额外监听的对象路径（可选，每行一个）', placeholder: 'app.store\n__INITIAL_STATE__', small: true }],
    allowEmpty: true,
    options: [
      { id: 'depth', type: 'number', label: '遍历深度', value: 2, min: 1, max: 5, title: 'window 之下递归打点的层数，太深会卡' },
      { id: 'minLen', type: 'number', label: '最短字符串', value: 4, min: 1, max: 100, title: '短于此的字符串不入库（噪声）' },
      { id: 'cap', type: 'number', label: '库容量', value: 80000, min: 1000, max: 300000, title: '超过后停止入库，防止内存爆' },
      { id: 'evalHook', type: 'toggle', label: '顺带 Hook eval/Function/stringify', value: true, title: '这三个入口途经的字符串一并入库' },
      { id: 'stack', type: 'toggle', label: '记录调用栈', value: true, title: '关闭可提速，只记赋值位置' },
    ],
    help:
      '<h4>是什么</h4>' +
      '<p>把页面上<b>所有变量赋值</b>的值存进一个本地指纹库，之后拿着加密参数的值反查「它在哪一行被赋给了谁」。定位加密逻辑的通杀辅助，等价于浏览器版的 objection 内存漫游。</p>' +
      '<h4>用法（三步）</h4>' +
      '<ol><li>复制「注入脚本」页签全部内容 → DevTools Sources → Snippets → New snippet → 粘贴 → 运行（▶）。<b>要在页面 JS 执行前</b>生效就用油猴 @run-at document-start</li>' +
      '<li>在页面上正常操作：登录、搜索、翻页……触发目标加密</li>' +
      '<li>控制台执行：<code>__sp("拿到的加密参数值")</code> —— 精确匹配→包含匹配→正则 逐级搜索；<code>__sp(/sign/i)</code> 正则模式；返回表格并列出变量名、行号、调用栈</li></ol>' +
      '<h4>常用 API</h4>' +
      '<pre>__sp("值")        搜索（字符串为包含匹配，/re/ 为正则）\n__spStats()       看库状态（条数/容量/类型分布）\n__spExport()      导出全部指纹为 JSON（配合本工具分析）\n__spClear()       清库重来</pre>' +
      '<h4>注意</h4>' +
      '<ul><li>库有容量上限，超了就停（防内存爆），够定位参数用</li>' +
      '<li>遍历深度默认 2 层：第 3 层以下对象太多会卡；要深挖某个对象用「额外监听的对象路径」精确指定</li>' +
      '<li>页面若有 CSP 阻止 Snippets 运行，改用油猴；反调试站先跑「反反调试」</li></ul>',
    handler: function (input, opts) {
      const extra = String(input == null ? '' : input).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      const depth = Math.max(1, Math.min(5, Number(opts.depth || 2)));
      const minLen = Math.max(1, Number(opts.minLen || 4));
      const cap = Math.max(1000, Number(opts.cap || 80000));
      const evalHook = !!opts.evalHook;
      const stack = !!opts.stack;

      /* 注入脚本：ES5 语法（兼容性优先），全部逻辑内联 */
      const script = [
        '/* SpiderLab 内存漫游注入脚本 —— DevTools Snippets / 油猴 document-start 运行 */',
        '/* 深度 ' + depth + ' 层 · 最短 ' + minLen + ' 字符 · 容量 ' + cap + ' 条 · ' + (evalHook ? '含 eval/stringify 入库' : '不 hook eval') + ' */',
        '(function () {',
        '  if (window.__SPDB__) { console.warn("[漫游] 已注入过"); return; }',
        '  var CAP = ' + cap + ', MINLEN = ' + minLen + ', DEPTH = ' + depth + ', WITH_STACK = ' + (stack ? 'true' : 'false') + ';',
        '  var DB = new Map();   /* 字符串值 -> [{var, loc, stack, t}] */',
        '  var size = 0, dropped = 0;',
        '  var inHook = false;   /* 重入锁：入库过程自身的赋值不再打点 */',
        '',
        '  function put(v, varName, loc) {',
        '    if (inHook) return;',
        '    var t = typeof v, s;',
        '    if (t === "string") s = v;',
        '    else if (t === "number" || t === "boolean") s = String(v);',
        '    else return;',
        '    if (s.length < MINLEN || s.length > 8192) return;',
        '    inHook = true;',
        '    try {',
        '      if (size >= CAP) { dropped++; return; }',
        '      var arr = DB.get(s);',
        '      if (!arr) { DB.set(s, arr = []); size++; }',
        '      if (arr.length < 6) arr.push({',
        '        var: varName,',
        '        loc: loc || "",',
        '        stack: WITH_STACK ? String(new Error().stack || "").split("\\n").slice(2, 5).join("  <-  ") : "",',
        '        t: Date.now()',
        '      });',
        '    } finally { inHook = false; }',
        '  }',
        '',
        '  /* ---------- 给对象子树打点（defineProperty get/set） ---------- */',
        '  var BLACK = /^(webkit|chrome|Intl|WebGL|CSS|SVG|Math|JSON|console|performance|crypto|speech|caches|indexedDB|navigator|location|document|history|external|origin|close|open|focus|blur|frames|self|top|parent|window|globalThis|postMessage|alert|confirm|prompt|fetch|XMLHttpRequest|Event|CustomEvent|Node|Element|HTMLElement|Object|Array|Function|String|Number|Boolean|Date|RegExp|Error|Promise|Proxy|Reflect|Symbol|Map|Set|WeakMap|WeakSet|ArrayBuffer|DataView|Uint8Array|Int8Array|Uint16Array|Uint32Array|Float|BigInt|Worker|WebSocket|Blob|File|FileReader|URL|URLSearchParams|TextEncoder|TextDecoder|AbortController|MutationObserver|ResizeObserver|IntersectionObserver|requestAnimationFrame|setTimeout|setInterval|queueMicrotask|structuredClone|atob|btoa|eval|Function|NaN|Infinity|undefined)$/;',
        '  var touched = 0, failed = 0;',
        '',
        '  function tapObject(obj, path, depthLeft, seen) {',
        '    if (!obj || typeof obj !== "object" || depthLeft < 0) return;',
        '    if (!seen) seen = new WeakSet();',
        '    if (seen.has(obj)) return;',
        '    try { seen.add(obj); } catch (e) { return; }',
        '    var names;',
        '    try { names = Object.getOwnPropertyNames(obj); } catch (e) { return; }',
        '    if (names.length > 1200) names = names.slice(0, 1200); /* 超大对象截断 */',
        '    for (var i = 0; i < names.length; i++) {',
        '      var k = names[i];',
        '      if (BLACK.test(k)) continue;',
        '      var desc;',
        '      try { desc = Object.getOwnPropertyDescriptor(obj, k); } catch (e) { continue; }',
        '      if (!desc || !desc.configurable || !("value" in desc)) continue;',
        '      if (typeof desc.value === "function") continue; /* 函数本身不监听 */',
        '      (function (obj, k, path) {',
        '        var cur = desc.value;',
        '        try {',
        '          Object.defineProperty(obj, k, {',
        '            get: function () { return cur; },',
        '            set: function (v) {',
        '              put(v, path, "");',
        '              cur = v;',
        '              /* 新值是对象时继续向下打点（限同深度预算） */',
        '              if (v && typeof v === "object" && depthLeft > 0) tapObject(v, path, depthLeft - 1, seen);',
        '            },',
        '            configurable: true, enumerable: desc.enumerable',
        '          });',
        '          touched++;',
        '          /* 打点时就记一次当前值：否则「已有变量」永远搜不到，只能等它被重新赋值。 */',
        '          put(cur, path, "(初始值)");',
        '        } catch (e) { failed++; }',
        '        if (cur && typeof cur === "object" && depthLeft > 0) tapObject(cur, path, depthLeft - 1, seen);',
        '      })(obj, k, path + "." + k);',
        '    }',
        '  }',
        '',
        '  tapObject(window, "", DEPTH, new WeakSet());',
        '',
        '  /* ---------- 后建变量补打点 ---------- */',
        '  /* 注入时只给「已经存在」的属性装了 get/set；页面后续 window.NEW = ... 新建的变量不在打点范围内，',
        '     这正是「注入后新建变量 0 命中」的根因。这里定期重扫 window：已打点的属性描述符里没有 value，',
        '     会被自动跳过，只有新出现的属性才会被补装 get/set，开销很小。 */',
        '  var rescanCount = 0;',
        '  function rescan() {',
        '    if (rescanCount++ > 1200) { clearInterval(rescanTimer); return; }',
        '    var before = touched;',
        '    try { tapObject(window, "", DEPTH, new WeakSet()); } catch (e) {}',
        '    if (touched > before) console.log("[漫游] 新捕获 " + (touched - before) + " 个属性（累计 " + touched + "）");',
        '  }',
        '  var rescanTimer = setInterval(rescan, 800);',
        '  window.__spRescan = rescan;',
        extra.length ? extra.map(function (p) {
          return '  try { var __t = (function(){ return ' + p + ';})(); if (__t) tapObject(__t, "' + p + '", 1); } catch (e) { console.warn("[漫游] 额外路径不可达: ' + p + '"); }';
        }).join('\n') : '',
        '',
        evalHook ? [
          '  /* ---------- eval / Function / JSON.stringify 途经字符串入库 ---------- */',
          '  var _eval = window.eval;',
          '  window.eval = function (code) { if (typeof code === "string") put(code, "eval()", "(eval)"); return _eval.apply(this, arguments); };',
          '  var _Fn = window.Function;',
          '  window.Function = function () { var a = Array.prototype.slice.call(arguments); if (a.length) put(String(a[a.length - 1]), "Function()", "(new Function)"); var f = _Fn.apply(null, arguments); f.prototype = _Fn.prototype; return f; };',
          '  try { window.Function.prototype = _Fn.prototype; window.Function.prototype.constructor = window.Function; } catch (e) {}',
          '  var _str = JSON.stringify;',
          '  JSON.stringify = function (v) { var out = _str.apply(JSON, arguments); if (typeof out === "string" && out.length >= MINLEN && out.length <= 8192) put(out, "JSON.stringify→", "(stringify)"); return out; };',
        ].join('\n') : '',
        '',
        '  /* ---------- 搜索 API ---------- */',
        '  function search(q) {',
        '    var t0 = performance.now();',
        '    var hits = [];',
        '    var isRe = q instanceof RegExp;',
        '    DB.forEach(function (arr, key) {',
        '      var m = isRe ? q.test(key) : key.indexOf(q) >= 0;',
        '      if (!m) return;',
        '      for (var i = 0; i < arr.length; i++) {',
        '        hits.push({ 值: key.length > 60 ? key.slice(0, 60) + "…" : key, 变量: arr[i].var || "(eval/stringify)", 位置: arr[i].loc, 调用栈: arr[i].stack, 时间: new Date(arr[i].t).toLocaleTimeString() });',
        '      }',
        '      if (hits.length > 200) return;',
        '    });',
        '    var ms = Math.round(performance.now() - t0);',
        '    console.log("%c[漫游] 命中 " + hits.length + " 条 / " + size + " 条库存，耗时 " + ms + "ms", "color:#4f8cff;font-weight:bold");',
        '    if (hits.length) console.table(hits);',
        '    else console.warn("[漫游] 没搜到。试试更短的片段（如参数值中间 8 个字符），或 __spStats() 确认库里有数据");',
        '    return hits;',
        '  }',
        '  window.__sp = search;',
        '  window.__spStats = function () {',
        '    var st = { 库条数: size, 容量: CAP, 丢弃: dropped, 打点属性: touched, 打点失败: failed };',
        '    console.table([st]);',
        '    return st;',
        '  };',
        '  window.__spExport = function () { var o = {}; DB.forEach(function (a, k) { if (o[k] === undefined) o[k] = a; }); return o; };',
        '  window.__spClear = function () { DB = new Map(); size = 0; console.log("[漫游] 已清库"); };',
        '  window.__SPDB__ = true;',
        '  console.log("%c[漫游] 注入完成：打点 " + touched + " 个属性（失败 " + failed + "），现在去操作页面，然后 __sp(\'关键词\') 搜索", "color:#35d07f;font-weight:bold");',
        '})();',
      ].filter(Boolean).join('\n');

      const usage = [
        '== 使用步骤 ==',
        '1. DevTools → Sources → Snippets → ➕ 新建 → 粘贴「注入脚本」页签全部内容 → ▶ 运行',
        '   （要赶在页面 JS 之前：油猴新建脚本 @run-at document-start 粘贴同内容）',
        '2. 在页面上操作：登录 / 搜索 / 下单…… 触发你要的加密行为',
        '3. Network 里复制目标加密参数的值，控制台执行：',
        '     __sp("9F2C1A7B3E5D4C6A")     # 包含匹配',
        '     __sp(/sign|token/i)          # 正则模式',
        '     __spStats()                  # 库状态（确认有数据）',
        '     __spExport()                 # 导出全部指纹 JSON',
        '',
        '== 输出说明 ==',
        '变量列：window.a.b.c 形式的赋值路径（(eval)/(stringify) 表示途经字符串）',
        '调用栈列：赋值发生时的栈顶 3 帧 —— 点开 Source 定位，往上翻就是加密函数',
        '',
        '== 定位技巧 ==',
        '· 加密值搜不到 → 搜它中间的 8~12 字符（可能被二次包装）',
        '· 命中太多 → 加长关键词，或先 __spClear() 再精确触发一次',
        '· 找到变量名后：控制台 watch 该变量 / 在赋值行下断点，参数与密钥就在附近',
        '· 配合「Hook 脚本生成」的 XHR 模板：一个管请求参数，一个管变量来源',
      ].join('\n');

      return {
        text: script,
        lang: 'js',
        tabLabel: '注入脚本',
        tabs: [
          { label: '使用说明', text: usage, lang: 'text' },
        ],
        stats: [
          { k: '遍历深度', v: depth + ' 层' },
          { k: '库容量', v: SK.dom.fmtNum(cap) },
          evalHook ? { k: '附加入口', v: 'eval/Function/stringify' } : null,
          extra.length ? { k: '额外路径', v: extra.length + ' 个' } : null,
        ].filter(Boolean),
        filename: 'mem-scan',
      };
    },
  });
})();
