/* ============================================================================
   Spider Lab · antiantidebug.js
   反反调试：规则化生成绕过反调试的油猴脚本 / DevTools Snippet
   思路吸收自参考项目 AntiDebug_Breaker（chrome.debugger CDP 扩展），
   浏览器脚本形态拿不到 CDP，落地为可配置的注入脚本生成器。
   ========================================================================== */
(function () {

  SK.tool({
    id: 'anti-debug',
    name: '反调试辅助脚本',
    group: 'reverse',
    icon: '🛡',
    aliases: 'anti debug 反调试 绕过 无限debugger 检测 突破 反反调试',
    keywords: ['反调试', 'debugger', '绕过', '无限debugger', '检测', '断点', 'js逆向'],
    desc: '生成绕过站点反调试的注入脚本：Function 构造器陷阱、定时器 debugger 丢弃、toString 伪装、控制台检测禁用，支持指定域名作用域（eval 默认不接管，避免破坏 direct eval 语义）',
    sample: 'texta',
    hint: '生成的脚本用于 DevTools Snippets 或油猴（含 ==UserScript== 头）',
    inputs: [{ id: 'in', label: '作用域名（每行一个，油猴 @match 用）', placeholder: 'example.com\n*.example.com', small: true }],
    allowEmpty: true,
    options: [
      { id: 'fnCtor', type: 'toggle', label: 'Function 构造器陷阱', value: true, title: '同时接管全局 Function 与 Function.prototype.constructor，含 debugger 的入参先剔除再构造' },
      { id: 'evalMode', type: 'seg', label: 'eval 处理', value: 'keep', choices: [
        { v: 'keep', label: '不接管（保语义）' },
        { v: 'clean', label: '清洗 debugger' },
      ], title: '接管 window.eval 会让所有 eval 从 direct eval 退化成 indirect eval（作用域变成全局）：依赖 eval 读写局部变量的代码会直接报错，所以默认不接管' },
      { id: 'timerDrop', type: 'toggle', label: '定时器 debugger 丢弃', value: true, title: 'setInterval/setTimeout 回调里含 debugger 的直接不注册' },
      { id: 'toStringFake', type: 'toggle', label: 'toString 伪装', value: true, title: '被改写的函数 toString() 仍显示 native code，防反 Hook 检测' },
      { id: 'consoleGuard', type: 'toggle', label: '禁用控制台检测', value: true, title: '干掉 console.log getter 探测 / devtools 尺寸检测等常见手法' },
      { id: 'stackFake', type: 'toggle', label: '堆栈伪装', value: false, title: 'Error.prepareStackTrace 隐藏注入痕迹（部分站点检测注入函数名）' },
      { id: 'extraNames', type: 'text', label: '额外检测函数名', value: '', placeholder: '如 checkDebug, antiDevtools（逗号分隔，置空函数）' },
    ],
    help:
      '<h4>对抗的是什么</h4>' +
      '<ul><li><b>无限 debugger</b>：Function("debugger")() / setInterval 循环触发断点，让你没法下断</li>' +
      '<li><b>反 Hook 检测</b>：Function.prototype.toString 检查函数是否被改写</li>' +
      '<li><b>控制台检测</b>：console.log 的 getter 触发、devtools 窗口尺寸差、debugger 时差检测</li></ul>' +
      '<h4>用法</h4>' +
      '<ol><li>作用域名填目标站（生成 @match）；不填 = 全站可用（仅 Snippets 手动跑）</li>' +
      '<li>复制「油猴脚本」页签 → Tampermonkey 新建脚本粘贴保存 → 刷新目标页</li>' +
      '<li>仍有残留断点：DevTools 里右键该行号 → <b>Never pause here</b>，再配合 Ctrl+F8 全局禁用断点抓包看请求</li></ol>' +
      '<h4>什么时候不要开</h4>' +
      '<ul><li><b>eval 清洗</b>默认关：改写 window.eval 会让所有 eval 变成 indirect eval（作用域变全局），' +
      '靠 eval 读写局部变量的代码会直接 ReferenceError。要清 debugger 更稳的做法是先跑「JS 反混淆」删掉 debugger 再注入；</li>' +
      '<li>「定时器丢弃」会影响真的需要 debugger 场景（几乎没有）；</li>' +
      '<li>「堆栈伪装」可能干扰你自己的断点排错——默认关，只在站点检测注入名时开</li></ul>',
    handler: function (input, opts) {
      const hosts = String(input == null ? '' : input).split('\n').map(function (l) { return l.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }).filter(Boolean);
      const extra = String(opts.extraNames || '').split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);

      const M = [];
      M.push('/* SpiderLab 反反调试脚本 —— 由「反反调试」工具生成 */');
      if (hosts.length) {
        M.push('// ==UserScript==');
        M.push('// @name         SpiderLab 反反调试');
        M.push('// @namespace    spider-lab');
        M.push('// @version      1.0');
        M.push('// @run-at       document-start');
        M.push('// @grant        none');
        hosts.slice(0, 20).forEach(function (h) {
          M.push('// @match        *://' + (h.indexOf('*') === 0 ? h : h) + '/*');
        });
        M.push('// ==/UserScript==');
      }
      M.push('(function () {');
      M.push('  "use strict";');
      M.push('  if (window.__ADB__) return; window.__ADB__ = 1;');

      if (opts.fnCtor) {
        M.push('');
        M.push('  /* ---------- Function 构造器陷阱：入参里的 debugger 先剔除再构造 ---------- */');
        M.push('  /* 只改 Function.prototype.constructor 拦不住 new Function("debugger")——');
        M.push('     标识符 Function 走的是全局绑定，不是 prototype.constructor，所以两个都要接管 */');
        M.push('  var _Fn = Function.prototype.constructor;');
        M.push('  function fakeFn() {');
        M.push('    var a = Array.prototype.slice.call(arguments);');
        M.push('    for (var i = 0; i < a.length; i++) {');
        M.push('      if (typeof a[i] === "string" && /(^|[^\\w])debugger([^\\w]|$)/.test(a[i])) {');
        M.push('        console.warn("[ADB] 拦截 Function(debugger)，长度", a[i].length);');
        M.push('        a[i] = a[i].replace(/(^|[^\\w])debugger([^\\w]|$)/g, "$1 $2");');
        M.push('      }');
        M.push('    }');
        M.push('    try { return _Fn.apply(this, a); } catch (e) { console.warn("[ADB] Function 构造失败，返回空函数"); return function () {}; }');
        M.push('  }');
        M.push('  try { fakeFn.prototype = _Fn.prototype; } catch (e) {}');
        if (opts.toStringFake) {
          M.push('  try { fakeFn.toString = function () { return "function Function() { [native code] }"; }; } catch (e) {}');
        }
        M.push('  try { Function.prototype.constructor = fakeFn; } catch (e) {}');
        M.push('  try { window.Function = fakeFn; } catch (e) {}');
      }

      if (opts.evalMode === 'clean') {
        M.push('');
        M.push('  /* ---------- eval 清洗：代码里的 debugger 剔除后执行 ---------- */');
        M.push('  /* ⚠ 代价：一旦 window.eval 被改写，代码里的 eval(x) 不再是 direct eval，');
        M.push('     而是在全局作用域执行的 indirect eval——靠 eval 读写局部变量的代码会报 ReferenceError。');
        M.push('     遇到这类站点请回到「不接管（保语义）」，改用「JS 反混淆」先把 debugger 从源码里删掉再注入。 */');
        M.push('  console.warn("[ADB] eval 已被接管：direct eval 退化为 indirect eval（作用域变全局）");');
        M.push('  var _eval = window.eval;');
        M.push('  window.eval = function (code) {');
        M.push('    if (typeof code === "string" && code.indexOf("debugger") >= 0) {');
        M.push('      console.warn("[ADB] eval 内 debugger 已剔除");');
        M.push('      code = code.replace(/(^|[^\\w])debugger([^\\w]|$)/g, "$1 $2");');
        M.push('    }');
        M.push('    return _eval.call(window, code);');
        M.push('  };');
        if (opts.toStringFake) {
          M.push('  try { window.eval.toString = function () { return "function eval() { [native code] }"; }; } catch (e) {}');
        }
      } else {
        M.push('');
        M.push('  /* ---------- eval：不接管（默认）---------- */');
        M.push('  /* 保住 direct eval 语义：eval(x) 仍能在调用方局部作用域里求值。');
        M.push('     代价是 eval 里的 debugger 不会被自动剔除——需要时把开关切到「清洗 debugger」。 */');
      }

      if (opts.timerDrop) {
        M.push('');
        M.push('  /* ---------- 定时器：回调里含 debugger 的直接不注册 ---------- */');
        M.push('  ["setTimeout", "setInterval"].forEach(function (name) {');
        M.push('    var o = window[name];');
        M.push('    window[name] = function (fn) {');
        M.push('      if (typeof fn === "string" && fn.indexOf("debugger") >= 0) { console.warn("[ADB] 丢弃", name, "(字符串 debugger)"); return 0; }');
        M.push('      if (typeof fn === "function") {');
        M.push('        try { if (/debugger/.test(String(fn))) { console.warn("[ADB] 丢弃", name, "(函数体 debugger)"); return 0; } } catch (e) {}');
        M.push('      }');
        M.push('      return o.apply(window, arguments);');
        M.push('    };');
        M.push('  });');
      }

      if (opts.consoleGuard) {
        M.push('');
        M.push('  /* ---------- 控制台检测禁用 ---------- */');
        M.push('  /* 1. console.log getter 探测（读取即触发检测） */');
        M.push('  (function () {');
        M.push('    var d = Object.getOwnPropertyDescriptor(console, "log") || Object.getOwnPropertyDescriptor(console.constructor.prototype, "log");');
        M.push('    if (d && d.get) {');
        M.push('      var real = d.get.call(console);');
        M.push('      Object.defineProperty(console, "log", { value: real, writable: true, configurable: true });');
        M.push('      console.log("[ADB] console.log getter 探测已解除");');
        M.push('    }');
        M.push('  })();');
        M.push('  /* 2. devtools 尺寸检测（窗口差判断）——把阈值撑爆 */');
        M.push('  try { Object.defineProperty(window, "outerWidth", { get: function () { return window.innerWidth; }, configurable: true }); } catch (e) {}');
        M.push('  try { Object.defineProperty(window, "outerHeight", { get: function () { return window.innerHeight; }, configurable: true }); } catch (e) {}');
      }

      if (opts.stackFake) {
        M.push('');
        M.push('  /* ---------- 堆栈伪装：擦掉注入函数在栈里的痕迹 ---------- */');
        M.push('  var _pST = Error.prepareStackTrace;');
        M.push('  Error.prepareStackTrace = function (err, frames) {');
        M.push('    var cleaned = frames.filter(function (f) {');
        M.push('      var fn = f.getFunctionName && f.getFunctionName() || "";');
        M.push('      return !/fakeFn|\\(eval|ADB/.test(fn) && String(f.getFileName()).indexOf("userscript") < 0 && String(f.getFileName()).indexOf("snippet") < 0;');
        M.push('    });');
        M.push('    return (_pST || function (e2, fs) { return e2.stack; })(err, cleaned);');
        M.push('  };');
      }

      if (extra.length) {
        M.push('');
        M.push('  /* ---------- 额外检测函数置空 ---------- */');
        extra.slice(0, 30).forEach(function (n) {
          M.push('  try { if (window[' + JSON.stringify(n) + ']) { window[' + JSON.stringify(n) + '] = function () { return true; }; console.log("[ADB] 置空", ' + JSON.stringify(n) + '); } } catch (e) {}');
        });
      }

      M.push('');
      M.push('  console.log("%c[ADB] 反反调试已注入" ' + (opts.fnCtor ? '+ " · Function陷阱"' : '') + ' + (' + (opts.timerDrop ? 1 : 0) + ' ? " · 定时器过滤" : ""), "color:#35d07f;font-weight:bold");');
      M.push('})();');

      const script = M.join('\n');
      const usage = [
        '== 使用 ==',
        hosts.length
          ? '1. 复制脚本 → Tampermonkey「添加新脚本」→ 粘贴保存（@match 已生成 ' + hosts.length + ' 个域名）'
          : '1. 未填作用域名：脚本只在 DevTools Snippets 手动运行时生效；要自动生效请填域名后重新生成油猴版',
        '2. 刷新目标页面，控制台看到 [ADB] 反反调试已注入 即生效',
        '3. 顽固断点兜底：断点行右键 → Never pause here；或 Ctrl+F8 全局禁用断点抓请求',
        '',
        '== 已开启的手段 ==',
        opts.fnCtor ? '✓ Function 构造器陷阱（无限 debugger 主力）' : '✗ Function 构造器陷阱',
        opts.evalClean ? '✓ eval 清洗' : '✗ eval 清洗',
        opts.timerDrop ? '✓ 定时器 debugger 丢弃' : '✗ 定时器 debugger 丢弃',
        opts.toStringFake ? '✓ toString 伪装（防反 Hook 检测）' : '✗ toString 伪装',
        opts.consoleGuard ? '✓ 控制台检测禁用' : '✗ 控制台检测禁用',
        opts.stackFake ? '✓ 堆栈伪装' : '✗ 堆栈伪装',
        extra.length ? '✓ 额外置空：' + extra.join(', ') : '',
      ].filter(Boolean).join('\n');

      return {
        text: script,
        lang: 'js',
        tabLabel: hosts.length ? '油猴脚本（含 @match）' : '注入脚本',
        tabs: [{ label: '使用说明', text: usage, lang: 'text' }],
        stats: [
          { k: '手段', v: [opts.fnCtor, opts.evalClean, opts.timerDrop, opts.toStringFake, opts.consoleGuard, opts.stackFake].filter(Boolean).length + ' 项' },
          hosts.length ? { k: '作用域', v: hosts.length + ' 域名' } : null,
          extra.length ? { k: '置空函数', v: extra.length } : null,
        ].filter(Boolean),
        filename: 'anti-debug',
      };
    },
  });
})();
