/* ============================================================================
   Spider Lab · verify.js
   算法验证台：贴入还原的加密函数 + N 组向量（入参→期望输出），
   沙箱批量执行 → 通过率表 + 失败项字符级 diff。
   向量闭环：HAR 分析器「验证向量」页签一键抽取；Hook 模板 __vectors__ 导出。
   ========================================================================== */
(function () {

  SK.tool({
    id: 'sign-verify',
    name: '算法验证台',
    group: 'reverse',
    icon: '✓',
    aliases: 'verify 验证 差分 向量 sign 还原 校验',
    keywords: ['验证', '差分', '向量', 'sign', '还原', '校验', 'diff', '测试'],
    desc: '还原出加密函数后别急着上生产：贴函数 + N 组（入参→期望输出）向量批量跑，失败项给字符级 diff——是时间戳漂移还是算法错了，一眼看出',
    sample: 'verify',
    hint: '函数怎么写看 ✨ 示例；向量可从「HAR 分析器」的验证向量页签一键导出',
    inputs: [
      { id: 'fn', label: '加密函数代码（末行 return；或完整 function 声明）', placeholder: 'function sign(params, ts) {\n  ...\n  return hash;\n}', sample: 'verify-fn' },
      { id: 'vec', label: '向量集 JSON 数组', placeholder: '[{"args": [{"page":1}], "expect": "9F2C1A7B"}]', sample: 'verify-vec' },
    ],
    options: [
      { id: 'match', type: 'select', label: '比对方式', value: 'exact', choices: [
        { v: 'exact', label: '完全相等' },
        { v: 'ci', label: '忽略大小写' },
        { v: 'contains', label: '包含即可' },
      ] },
      { id: 'timeout', type: 'number', label: '单组超时(ms)', value: 5000, min: 500, max: 30000 },
      { id: 'env', type: 'text', label: '环境变量 JSON', value: '', placeholder: '{"KEY":"abc","window":{"__sign_secret":"xyz"}}', title: '真实混淆函数几乎都依赖外部全局变量（window.KEY / secret 常量），这里注入后函数才能跑' },
    ],
    help:
      '<h4>三步用起来</h4>' +
      '<ol><li>把还原出的加密函数粘到第一个框（示例给三种写法：完整 function / 顶层 return / async）</li>' +
      '<li>第二个框贴向量：<code>[{"args":[参数], "expect":"期望值"}]</code>——args 数组按函数参数顺序；单参数可写对象或字符串</li>' +
      '<li>运行：通过率 + 每组结果表；<b>失败行有字符级 diff</b>（红=期望有，绿=实际有）</li></ol>' +
      '<h4>向量从哪来（不用手写）</h4>' +
      '<ul><li><b>HAR 分析器</b>：跑完 HAR 切「验证向量」页签——POST 参数做 args、签名头做 expect，复制即用</li>' +
      '<li><b>Hook 模板</b>：XHR/CryptoJS 增强版内置 <code>__vectors__</code> 收集器，控制台 <code>copy(__vectors__())</code> 直接得向量</li></ul>' +
      '<h4>怎么读失败 diff</h4>' +
      '<ul><li>只有<b>时间戳那几位</b>不一样 → 算法对，是时间取整/时区问题</li>' +
      '<li>末尾几位不一样 → 大概率拼接顺序或编码大小写</li>' +
      '<li>完全不同 → 算法本体不对，回 Hook 看入参</li></ul>',
    handler: async function (fnCode, vecText, opts) {
      const code = String(fnCode == null ? '' : fnCode).trim();
      const vText = String(vecText == null ? '' : vecText).trim();
      if (!code) return { error: '函数代码为空' };
      if (!vText) return { error: '向量集为空', hint: '[{"args":[...], "expect":"..."}]；或从 HAR 分析器的「验证向量」页签导出' };

      let vectors;
      try { vectors = JSON.parse(vText); } catch (e) { return { error: '向量不是合法 JSON：' + e.message }; }
      if (!Array.isArray(vectors) || !vectors.length) return { error: '向量必须是数组且非空' };
      if (vectors.length > 500) return { error: '一次最多 500 组向量' };

      const matchMode = String(opts.match || 'exact');
      const tLimit = Math.max(500, Number(opts.timeout || 5000));

      /* 执行器：编译用户代码 → 找入口函数（用户指定 fn 名 / 第一个 function 声明 / 整体当函数体） */
      const compile = function () {
        /* 形态1：完整 function 声明（允许前导注释/空白，取第一个声明名） */
        const decl = /(?:^|[\n;])\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(code);
        if (decl) {
          return { fnName: decl[1], wrap: code + '\nreturn ' + decl[1] + ';' };
        }
        /* 形态2：const/let fn = ...（含 async） */
        const assign = /(?:^|[\n;])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\()/.exec(code);
        if (assign) {
          return { fnName: assign[1], wrap: code + '\nreturn ' + assign[1] + ';' };
        }
        /* 形态3：顶层函数体（补成函数并返回） */
        return { fnName: '(inline)', wrap: 'return (function (...args) {\n' + code + '\n});' };
      };
      const c = compile();

      const logs = [];
      const pushLog = function (t, s) { if (logs.length < 200) logs.push({ t: t, s: s }); };
      const con = { log: function () { pushLog('log', Array.prototype.join.call(arguments, ' ')); }, warn: function () { pushLog('warn', Array.prototype.join.call(arguments, ' ')); }, error: function () { pushLog('error', Array.prototype.join.call(arguments, ' ')); }, info: function () { pushLog('info', Array.prototype.join.call(arguments, ' ')); } };

      /* 注入外部环境：还原出来的函数 90% 依赖 window.KEY / 常量 secret，
         不注入只会得到 "KEY is not defined"。用「函数参数注入 + 构造 window」双保险。 */
      let envObj = {};
      let envErr = '';
      try {
        const rawEnv = String(opts.env || '').trim();
        if (rawEnv) envObj = JSON.parse(rawEnv);
      } catch (e) { envErr = e.message; }
      if (envErr) return { error: '环境变量 JSON 不合法：' + envErr, hint: '形如 {"KEY":"abc"}' };
      const envKeys = Object.keys(envObj || {}).filter(function (k) { return /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'window'; });
      const fakeWindow = Object.assign({}, (envObj && typeof envObj.window === 'object' && envObj.window) || {});
      envKeys.forEach(function (k) { if (fakeWindow[k] === undefined) fakeWindow[k] = envObj[k]; });
      fakeWindow.window = fakeWindow;
      fakeWindow.globalThis = fakeWindow;

      let fn;
      try {
        const params = ['console', '__win'].concat(envKeys);
        const vals = [con, fakeWindow].concat(envKeys.map(function (k) { return envObj[k]; }));
        /* 注意：new Function.apply(...) 会报 "Function.apply is not a constructor"，
           必须用不带 new 的 Function(...) 再 apply 实参 */
        fn = Function.apply(null, params.concat(['"use strict";\nvar window = __win, globalThis = __win, self = __win;\n' + c.wrap + '\n'])).apply(null, vals);
      } catch (e) {
        return { error: '函数编译失败：' + e.message, hint: '确认是完整函数声明，或顶层直接写函数体（末行 return 结果）' };
      }
      if (typeof fn !== 'function') {
        return { error: '没找到入口函数（' + c.fnName + ' 不是函数）', hint: '写法①：function sign(a){...return x}；写法②：直接贴函数体，末行 return' };
      }

      /* 批量执行 */
      const tAll = Date.now();
      const rows = [];
      let pass = 0;
      for (let i = 0; i < vectors.length; i++) {
        const v = vectors[i] || {};
        const args = Array.isArray(v.args) ? v.args : [v.args];
        /* B18：缺 expect 不能当成「期望空字符串」——那样随便一个返回空的算法都能 100% 通过。
           必须区分「没写 expect」「写了 null」「写了空串」三种情况。 */
        const hasExpect = !!(v && Object.prototype.hasOwnProperty.call(v, 'expect'));
        const expect = v.expect === undefined || v.expect === null ? '' : String(v.expect);
        const t0 = Date.now();
        let got = '', err = '';
        try {
          let out = fn.apply(null, args);
          if (out && typeof out.then === 'function') {
            out = await Promise.race([
              out,
              new Promise(function (_, rej) { setTimeout(function () { rej(new Error('单组执行超时(>' + tLimit + 'ms)')); }, tLimit); }),
            ]);
          }
          got = out === undefined || out === null ? '' : String(out);
        } catch (e) { err = e.message; }
        const ms = Date.now() - t0;
        /* 同步死循环无法真正中断，但至少不能算「通过」：如实标记为超时 */
        if (!err && ms > tLimit) err = '单组执行超时（同步代码耗时 ' + ms + 'ms > 上限 ' + tLimit + 'ms，同步代码无法中断）';
        let ok = false;
        let missing = false;
        if (!hasExpect) { missing = true; err = err || '这一组没写 expect，无法判定'; }
        if (!err) {
          if (matchMode === 'contains') ok = got.indexOf(expect) >= 0;
          else if (matchMode === 'ci') ok = got.toLowerCase() === expect.toLowerCase();
          else ok = got === expect;
        }
        if (ok) pass++;
        const row = {
          i: i + 1,
          args: safeJson(args).slice(0, 120),
          expect: expect.length > 80 ? expect.slice(0, 80) + '…' : expect,
          got: err ? '' : (got.length > 80 ? got.slice(0, 80) + '…' : got),
          result: missing ? '⚠ 缺 expect' : err ? '✕ ' + (/超时/.test(err) ? '超时' : '抛错') : ok ? '✓ 通过' : '✕ 不符',
          ms: ms,
          _ok: ok,
          _err: err,
        };
        /* 失败行做字符级 diff（worker 内算 segs） */
        if (!ok && !err && expect && got) {
          const segs = SK.diff.intra(expect, got, 'word');
          row.expectParts = segs.filter(function (s) { return s.op !== 'ins'; }).map(function (s) { return { k: s.op === 'del' ? 'del' : 'eq', s: s.text }; });
          row.gotParts = segs.filter(function (s) { return s.op !== 'del'; }).map(function (s) { return { k: s.op === 'ins' ? 'ins' : 'eq', s: s.text }; });
        }
        rows.push(row);
      }
      const totalMs = Date.now() - tAll;

      function safeJson(v) {
        try { return JSON.stringify(v); } catch (e) { return String(v); }
      }

      const fails = rows.filter(function (r) { return !r._ok; });
      const cols = [
        { key: 'i', label: '#', width: '48px' },
        { key: 'result', label: '结果', width: '86px' },
        { key: 'args', label: '入参', width: 'minmax(140px,240px)' },
        { key: 'expect', label: '期望', parts: 'expectParts' },
        { key: 'got', label: '实际' + (matchMode === 'exact' ? '' : '（' + (matchMode === 'ci' ? '忽略大小写' : '包含') + '）'), parts: 'gotParts' },
        { key: 'ms', label: '耗时', width: '64px' },
      ];

      const summary = [
        '通过: ' + pass + ' / ' + vectors.length + '（' + (pass / vectors.length * 100).toFixed(1) + '%）',
        '入口: ' + c.fnName + ' · 比对: ' + (matchMode === 'exact' ? '完全相等' : matchMode === 'ci' ? '忽略大小写' : '包含'),
        '总耗时: ' + SK.dom.fmtMs(totalMs),
        /* 只陈述事实：这套向量在当前环境下全部通过，不等于生产等价 */
        fails.length ? '\n失败向量:\n' + fails.map(function (r) { return '  #' + r.i + ' args=' + r.args.slice(0, 50) + (r._err ? ' ERROR: ' + r._err.slice(0, 60) : ''); }).slice(0, 20).join('\n') : '\n全部通过 ✓ 当前这组向量全部匹配（只代表覆盖了这些输入，不等于生产环境等价）',
      ].join('\n');

      return {
        text: summary,
        lang: 'text',
        tabLabel: '结果摘要',
        tabs: [
          { label: '向量明细 (' + vectors.length + ')', view: 'table', data: {
            columns: cols, rows: rows, name: 'verify-rows',
            rowCls: { field: '_ok', map: { 'true': 'row-add', 'false': 'row-del' } },
            filterHint: '过滤：true 只看过 / false 只看失败',
          } },
          logs.length ? { label: 'console 输出', text: logs.map(function (l) { return '[' + l.t + '] ' + l.s; }).join('\n'), lang: 'text' } : null,
        ].filter(Boolean),
        stats: [
          { k: '通过', v: pass + '/' + vectors.length, level: pass === vectors.length ? 'ok' : 'warn' },
          { k: '通过率', v: (pass / vectors.length * 100).toFixed(1) + '%' },
          { k: '总耗时', v: SK.dom.fmtMs(totalMs) },
        ],
        notices: pass === vectors.length
          ? [{ level: 'ok', msg: '当前这组向量全部通过。这只说明覆盖了这些输入，不等于与线上实现等价：还需覆盖边界输入、随机源与时间相关分支' }]
          : [{ level: 'warn', msg: fails.length + ' 组失败；看明细表红绿 diff：只有时间位不同=取整问题，全不同=算法本体问题' }],
        filename: 'verify-result',
      };
    },
  });

  /* 示例向量：与 HAR 抽取格式一致 */
  function addSamples() {
    if (!SK.samples) return;
    SK.samples['verify-fn'] = [
      '/* 还原出的签名函数（示例）：MD5(排序参数 + key) 大写 */',
      'function sign(params, ts) {',
      '  const keys = Object.keys(params).sort();',
      '  const base = keys.map(k => k + "=" + params[k]).join("&") + "&ts=" + ts + "&key=SECRET_123";',
      '  /* 真实场景这里是站点算法；示例用简单 hash 演示向量机制 */',
      '  let h = 0;',
      '  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;',
      '  return h.toString(16).toUpperCase().padStart(8, "0");',
      '}',
    ].join('\n');
    SK.samples['verify'] = 'verify';
    SK.samples['verify-vec'] = JSON.stringify([{"args":[{"page":1,"size":20,"kw":"耳机"},1729900800000],"expect":"A6E96EA0"},{"args":[{"page":2,"size":20,"kw":"耳机"},1729900900000],"expect":"40228F22"},{"args":[{"page":1,"size":20,"kw":"键盘"},1729900800000],"expect":"7D677A3D"}], null, 2);
  }
  addSamples();
})();
