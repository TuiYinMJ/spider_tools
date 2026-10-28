/* ============================================================================
   Spider Lab · wasm.js
   wasm 静态分析（信息级）：段结构解析 → 导出函数 / import 依赖 / 函数与段体积 /
   内嵌字符串提取 + name 段函数名还原。定位 _encrypt 入口、看要补哪些 env.*。
   ========================================================================== */
(function () {

  SK.tool({
    id: 'wasm-inspect',
    name: 'wasm 静态分析',
    group: 'reverse',
    icon: '🧵',
    aliases: 'wasm webassembly 模块 导出 导入 字节码',
    keywords: ['wasm', 'webassembly', '导出', '导入', 'encrypt', '逆向', '模块'],
    desc: '解析 wasm 二进制：导出函数清单（加密入口一眼可见）、import 依赖（要补的 env.*）、各段体积、内嵌字符串与 name 段函数名',
    hint: '拖入 .wasm 文件；导出名单里的 _encrypt/getSign 就是扣代码的目标入口',
    inputs: [{ id: 'in', label: '.wasm 文件（直接拖进来）', placeholder: '二进制或 base64/hex', sample: 'wasm' , binary: true }],
    maxBytes: 209715200,
    options: [],
    help:
      '<h4>逆向 wasm 的第一步</h4>' +
      '<ol><li><b>导出表</b>：`_encrypt`、`getSign` 这类名字直接暴露加密入口；带 name 段的（未 strip）连内部函数名都有</li>' +
      '<li><b>导入表</b>：`env.rand` 之类的 import 就是要在 JS 里补的环境——扣 wasm 时缺一不可</li>' +
      '<li><b>字符串</b>：data 段里的常量（密钥片段、URL、magic）直接可搜</li></ol>' +
      '<h4>下一步</h4>' +
      '<ul><li>Chrome DevTools 的 wasm 调试（Sources → wasm 断点）比反汇编工具直接</li>' +
      '<li>扣代码：把 wasm 二进制 + import 桩一起下载，Python 用 wasmtime/pywasm 跑</li></ul>',
    handler: async function (input, opts) {
      opts = opts || {};
      /* 输入 → bytes */
      let bytes = null;
      if (input && input.__file) {
        bytes = new Uint8Array(await input.__file.arrayBuffer());
      } else if (typeof input === 'string' && input.trim()) {
        const s = input.trim().replace(/\s+/g, '');
        if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 && s.length > 32) {
          bytes = new Uint8Array(s.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.substr(i * 2, 2), 16);
        } else {
          let t = s.replace(/-/g, '+').replace(/_/g, '/');
          while (t.length % 4) t += '=';
          try {
            const bin = atob(t);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          } catch (e) { bytes = null; }
        }
      }
      if (!bytes || bytes.length < 8) return { error: '输入为空或不是二进制/base64/hex' };
      if (!(bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d)) {
        return { error: '不是 wasm 模块（magic 应为 \\0asm）', hint: '确认是原始 .wasm 二进制；wasm 文本格式(.wat)或 wasm-gc 预览特性不支持' };
      }

      /* LEB128 */
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let p = 8;
      const uleb = () => {
        let r = 0, shift = 0, b;
        do { b = bytes[p++]; r += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
        return r;
      };
      const str = () => {
        const len = uleb();
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[p++]);
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
      };
      /* limits：flags(bit0=有 max) + min + [max] —— table/memory 都要吃，
         旧实现读完 kind 就不管了，下一条 import 会把 typeidx 当成字符串长度读，
         于是第二条开始全部错位（空模块名 / env 被当成字段名 / 类型乱套） */
      const limits = () => {
        const flags = bytes[p++];
        const min = uleb();
        const max = (flags & 1) ? uleb() : null;
        return { min: min, max: max };
      };
      const VALTYPE = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128', 0x70: 'funcref', 0x6f: 'externref' };
      const vtName = (b) => VALTYPE[b] || ('0x' + Number(b).toString(16));
      const parseWarn = [];
      const SECTION = { 0: 'custom', 1: 'type', 2: 'import', 3: 'function', 4: 'table', 5: 'memory', 6: 'global', 7: 'export', 8: 'start', 9: 'element', 10: 'code', 11: 'data', 12: 'datacount' };

      const sections = [];
      const exports = [];
      const imports = [];
      const strings = [];
      let numFuncBodies = 0;
      let version = dv.getUint32(4, true);

      while (p < bytes.length) {
        const id = bytes[p++];
        const size = uleb();
        const start = p;
        const end = p + size;
        sections.push({ id: id, name: SECTION[id] || ('#' + id), size: size });

        if (id === 7) {
          const n = uleb();
          for (let i = 0; i < n; i++) {
            const name = str();
            const kind = bytes[p++];
            const idx = uleb();
            exports.push({ name: name, kind: kind === 0 ? 'func' : kind === 1 ? 'table' : kind === 2 ? 'memory' : kind === 3 ? 'global' : '?' + kind, idx: idx });
          }
        } else if (id === 2) {
          const n = uleb();
          for (let i = 0; i < n; i++) {
            const mod = str();
            const field = str();
            const kind = bytes[p++];
            let desc = '';
            let typeidx = null;
            if (kind === 0) {
              typeidx = uleb();
              desc = 'type#' + typeidx;
            } else if (kind === 1) {
              const et = bytes[p++];
              const lim = limits();
              desc = vtName(et) + ' min=' + lim.min + (lim.max != null ? ' max=' + lim.max : '');
            } else if (kind === 2) {
              const lim = limits();
              desc = 'min=' + lim.min + ' 页' + (lim.max != null ? ' max=' + lim.max + ' 页' : '');
            } else if (kind === 3) {
              const vt = bytes[p++];
              const mut = bytes[p++];
              desc = vtName(vt) + (mut ? '（可变）' : '（不可变）');
            }
            imports.push({
              mod: mod, field: field,
              kind: kind === 0 ? 'func' : kind === 1 ? 'table' : kind === 2 ? 'memory' : kind === 3 ? 'global' : '?' + kind,
              desc: desc, idx: typeidx,
            });
            if (p > end + 1) break;
          }
          if (p !== end) parseWarn.push('import 段解析后位置偏移 ' + (p - end) + ' 字节（可能是本解析器未覆盖的扩展类型）');
        } else if (id === 10) {
          numFuncBodies = uleb();
        } else if (id === 11) {
          /* data 段：提取可打印字符串（≥4 连续可见字符） */
          const seg = bytes.subarray(start, end);
          let run = '';
          for (let i = 0; i < seg.length; i++) {
            const c = seg[i];
            if (c >= 32 && c < 127) run += String.fromCharCode(c);
            else {
              if (run.length >= 4 && /[a-zA-Z0-9]/.test(run)) strings.push(run.slice(0, 200));
              run = '';
            }
          }
          if (run.length >= 4) strings.push(run.slice(0, 200));
        } else if (id === 0) {
          /* custom：name 段解析函数名（子段 id=1） */
          try {
            const saveP = p;
            const custName = str();
            if (custName === 'name' && p < end) {
              const sub = bytes[p++];
              const subSize = uleb();
              if (sub === 1) {
                const count = uleb();
                for (let i = 0; i < count && p < end; i++) {
                  const idx = uleb();
                  const nm = str();
                  exports.push({ name: nm, kind: 'fn(name段)', idx: idx });
                }
              }
            }
            p = saveP;
          } catch (e) { /* name 段异常忽略 */ }
        }
        p = end;
      }

      /* 汇总 */
      const funcExports = exports.filter((e) => e.kind === 'func');
      const suspicious = funcExports.filter((e) => /encrypt|decrypt|sign|md5|aes|rsa|hmac|hash|key|token|sec/i.test(e.name));
      const importMods = {};
      imports.forEach((im) => { (importMods[im.mod] = importMods[im.mod] || []).push(im.field); });

      const summary = [
        'wasm 版本: ' + version,
        '大小: ' + SK.dom.fmtBytes(bytes.length),
        '段数: ' + sections.length,
        '函数体: ' + numFuncBodies + ' 个（code 段）',
        '导出: ' + exports.length + ' 项（函数 ' + funcExports.length + '）',
        '导入: ' + imports.length + ' 项（模块: ' + Object.keys(importMods).join(', ') + '）',
        '',
        suspicious.length ? '疑似加密入口（导出名匹配关键词）:' + suspicious.map((e) => '\n  → ' + e.name + ' (func#' + e.idx + ')').join('') : '（导出名里没匹配到加密关键词）',
        Object.keys(importMods).length ? '\n要补的 import 模块:' + Object.keys(importMods).map((m) => '\n  ' + m + ': ' + importMods[m].slice(0, 12).join(', ')).join('') : '',
      ].join('\n');

      return {
        text: summary,
        lang: 'text',
        tabLabel: '分析摘要',
        tabs: [
          { label: '导出 (' + exports.length + ')', view: 'table', data: {
            columns: [{ key: 'name', label: '名称' }, { key: 'kind', label: '类型', width: '100px' }, { key: 'idx', label: '索引', width: '70px' }],
            rows: exports, name: 'wasm-exports',
            filterHint: '搜 encrypt / sign / key',
          } },
          imports.length ? { label: '导入 (' + imports.length + ')', view: 'table', data: {
            columns: [{ key: 'mod', label: '模块', width: 'minmax(90px,150px)' }, { key: 'field', label: '成员' }, { key: 'kind', label: '类型', width: '70px' }, { key: 'desc', label: '签名/限制', width: 'minmax(90px,180px)' }],
            rows: imports, name: 'wasm-imports',
          } } : null,
          { label: '段结构', view: 'table', data: {
            columns: [{ key: 'id', label: 'ID', width: '50px' }, { key: 'name', label: '段', width: '100px' }, { key: 'size', label: '大小(字节)', width: '110px' }],
            rows: sections.map((s) => ({ id: s.id, name: s.name, size: s.size })), name: 'wasm-sections',
          } },
          strings.length ? { label: '内嵌字符串 (' + strings.length + ')', view: 'table', data: {
            columns: [{ key: 's', label: '字符串' }],
            rows: strings.slice(0, 500).map((s) => ({ s: s })), name: 'wasm-strings',
            filterHint: '搜密钥片段 / URL / magic',
          } } : null,
        ].filter(Boolean),
        stats: [
          { k: '大小', v: SK.dom.fmtBytes(bytes.length) },
          { k: '函数体', v: numFuncBodies },
          { k: '导出', v: exports.length },
          { k: '导入', v: imports.length },
          suspicious.length ? { k: '疑似入口', v: suspicious.length, level: 'ok' } : null,
        ].filter(Boolean),
        notices: [].concat(
          parseWarn.map((m) => ({ level: 'warn', msg: m })),
          suspicious.length
            ? [{ level: 'ok', msg: '找到疑似加密导出: ' + suspicious.slice(0, 3).map((e) => e.name).join(', ') + ' —— DevTools 里 wasm 断点跟进去' }]
            : [{ level: 'info', msg: '导出名无加密关键词：可能被 strip，看 name 段是否保留或用反汇编工具' }],
        ),
        filename: 'wasm-report',
      };
    },
  });

  /* 示例：真实结构的最小 wasm（getSign 导出 + env.rand 导入 + data 字符串） */
  if (SK.samples) {
    SK.samples['wasm'] = "AGFzbQEAAAABBgFgAX8BfwIMAQNlbnYEcmFuZAAAAwIBAAccAgdnZXRTaWduAAEOaGVscGVyX2VuY3J5cHQAAQoGAQQAIAALCxcBAEEACxFrZXlfcHJlZml4X3NlY3JldA==";
  }
})();