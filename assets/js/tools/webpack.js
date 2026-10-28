/* ============================================================================
   Spider Lab · webpack.js
   webpack 模块提取器：检测打包特征 → 提取指定模块 + 递归依赖 → 生成可运行骨架
   （喂给「JS 沙箱执行」验证扣代码）
   ========================================================================== */
(function () {

  SK.tool({
    id: 'webpack-extract',
    name: 'webpack 模块提取',
    group: 'reverse',
    icon: '📦',
    aliases: 'webpack 模块 提取 扣代码 chunk require',
    keywords: ['webpack', '模块', '提取', '扣代码', 'chunk', 'require', '逆向'],
    desc: '从 webpack 打包 JS 里按 ID 提取模块源码与依赖闭包，生成带 __webpack_require__ 桩的骨架（runtime 桩为兼容版，跑通前算「待补全」）',
    sample: 'webpack',
    hint: '填模块 ID（可多个逗号分隔）；ID 形态见运行后的特征提示',
    inputs: [
      { id: 'in', label: '打包后的 JS', placeholder: '(self.webpackChunkxxx = self.webpackChunkxxx || []).push(...)', sample: 'webpack' },
      { id: 'ids', label: '模块 ID（逗号分隔，如 123, "abc"）', placeholder: '123 或 123,456', small: true, allowEmpty: true },
    ],
    options: [
      { id: 'depth', type: 'number', label: '依赖递归深度', value: 5, min: 1, max: 20 },
    ],
    help:
      '<h4>支持的打包形态</h4>' +
      '<ul><li><b>webpack 5</b>：`(self.webpackChunkXXX = self.webpackChunkXXX || []).push([[id], { 模块字典 }, ...])`</li>' +
      '<li><b>webpack 4</b>：`window["webpackJsonp"] = function(...){...}` / push 数组</li>' +
      '<li><b>内联</b>：`__webpack_require__` + 大模块对象字面量</li></ul>' +
      '<h4>输出</h4>' +
      '<ul><li><b>模块源码</b>：指定 ID 的函数体（美化）</li>' +
      '<li><b>依赖树</b>：递归扫描 `__webpack_require__(数字)` 的依赖链</li>' +
      '<li><b>可运行骨架</b>：模块字典 + CommonJS 桩 + 调用入口——复制到「JS 沙箱执行」跑通即扣代码成功</li></ul>' +
      '<p>不填 ID 会列出文件里的<b>全部模块 ID 清单</b>（配「结构分析」找 sign 模块）。</p>',
    handler: function (input, idsText, opts) {
      const src = String(input == null ? '' : input);
      if (!src.trim()) return { error: '输入为空' };

      /* ---- 特征检测 ---- */
      const feats = [];
      if (/\(self\.webpackChunk[\w$]*\s*=\s*self\.webpackChunk[\w$]*\s*\|\|\s*\[\]\)/.test(src) || /self\["webpackChunk/.test(src)) feats.push('webpack 5 chunk push');
      if (/webpackJsonp/.test(src)) feats.push('webpack 4 jsonp');
      if (/__webpack_require__/.test(src)) feats.push('内联 __webpack_require__');
      /* webpack 5 在「模块 id 全是小整数」时会输出数组形态：
         var __webpack_modules__=[,(t,e)=>{…},,(t,e,n)=>{…}]  —— pdf.js 这类产物就是这样，
         数组下标即模块 id，空位表示该 id 不存在。老实现只找对象字典，会直接报「没识别到特征」。 */
      const arrayModules = (function parseArrayModules(text) {
        if (text.indexOf('__webpack_modules__') < 0) return null;
        /* 优先用 acorn：数组里全是正则/字符串/箭头函数，手写括号扫描遇到 /[\]]/ 这种正则会错位 */
        if (typeof acorn !== 'undefined') {
          let ast = null;
          try { ast = acorn.parse(text, { ecmaVersion: 'latest' }); } catch (e) { ast = null; }
          if (ast) {
            let found = null;
            (function walk(n) {
              if (!n || typeof n !== 'object' || found) return;
              if (n.type === 'VariableDeclarator' && n.id && n.id.name === '__webpack_modules__' && n.init && n.init.type === 'ArrayExpression') { found = n.init; return; }
              for (const k in n) {
                const v = n[k];
                if (Array.isArray(v)) { for (const x of v) walk(x); }
                else if (v && typeof v === 'object' && v.type) walk(v);
              }
            })(ast);
            if (found) {
              const members = {};
              let count = 0;
              found.elements.forEach(function (el, i) {
                if (!el) return;
                members[String(i)] = text.slice(el.start, el.end);
                count++;
              });
              if (count) return { members: members, length: found.end - found.start, count: count };
            }
          }
        }
        return null;
      })(src);
      if (arrayModules) feats.push('webpack 5 数组模块');
      if (!feats.length) {
        return { error: '没识别到 webpack 特征', hint: '确认是 webpack 打包产物；若是 vite/rollup/esbuild 产物没有模块字典，直接用「JS 格式化」+「结构分析」' };
      }

      /* ---- 定位模块字典：所有「大对象字面量且成员是模块工厂」的候选 ----
         成员值三种形态都要认：webpack4 的 `123: function(...)`，
         webpack5 的 `123: (module, __unused_webpack_exports, __webpack_require__) => {...}`，
         以及路径键 `"./src/a.js": (...)=>{...}`（键里的 / 和 . 老正则不认） */
      const FACTORY_HEAD = /(?:function\b|async\s+function\b|\()/;
      const findModulesDict = function (text) {
        const dictRe = /(?:\(\s*\[|,\s*)\{\s*(?:(?:['"][^'"\n]{1,160}['"]|[\w$.-]+)\s*:\s*(?:function\b|async\s+function\b|\())/g;
        let dm;
        const cands = [];
        while ((dm = dictRe.exec(text))) {
          const open = text.indexOf('{', dm.index);
          let depth = 0, q = null;
          let i = open;
          for (; i < text.length; i++) {
            const c = text[i];
            if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
            if (c === '"' || c === "'" || c === '`') { q = c; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (!depth) break; }
          }
          if (depth !== 0) continue;
          const body = text.slice(open + 1, i);
          /* 校验：数一数有多少成员的值长得像模块工厂（function / 箭头） */
          const fnCount = (body.match(/:\s*(?:function\s*\(|async\s+function|\(\s*[^()]*\)\s*=>|[\w$]+\s*=>)/g) || []).length;
          if (fnCount >= 1) cands.push({ start: open, end: i, body: body, fnCount: fnCount });
          dictRe.lastIndex = i;
        }
        /* 工厂数优先（模块字典成员基本都是工厂），同分取体积最大的 */
        return cands.sort((a, b) => b.fnCount - a.fnCount || b.body.length - a.body.length);
      };
      const dicts = arrayModules ? [] : findModulesDict(src);
      if (!arrayModules && !dicts.length) return { error: '没找到模块字典', hint: '文件可能是压缩后的多 chunk，先跑「JS 格式化」再试' };
      const dict = dicts[0] || { body: '', fnCount: 0 };

      /* ---- 解析模块成员（key → 函数体文本） ---- */
      const parseMembers = function (body) {
        const members = {};
        let i = 0;
        const n = body.length;
        const skipWs = () => { while (i < n && /\s/.test(body[i])) i++; };
        while (i < n) {
          skipWs();
          if (body[i] === ',') { i++; continue; }
          if (i >= n) break;
          /* key */
          let key = null;
          if (body[i] === '"' || body[i] === "'") {
            const q = body[i];
            let j = i + 1, k = '';
            while (j < n && body[j] !== q) { if (body[j] === '\\') { k += body[j] + body[j + 1]; j += 2; continue; } k += body[j]; j++; }
            key = k;
            i = j + 1;
          } else {
            let j = i;
            while (j < n && /[,\s:]/.test(body[j]) === false) j++;
            key = body.slice(i, j);
            i = j;
          }
          skipWs();
          if (body[i] !== ':') { /* 结构异常，跳过到下一个逗号顶层 */ 
            let depth = 0;
            while (i < n) { const c = body[i]; if (c === '{' || c === '[' || c === '(') depth++; else if (c === '}' || c === ']' || c === ')') depth--; else if (c === ',' && depth <= 0) break; i++; }
            if (body[i] === ',') i++;
            continue;
          }
          i++; skipWs();
          /* value：括号配对到顶层逗号 */
          let depth = 0, q = null, start = i;
          while (i < n) {
            const c = body[i];
            if (q) { if (c === '\\') { i += 2; continue; } if (c === q) q = null; i++; continue; }
            if (c === '"' || c === "'" || c === '`') { q = c; i++; continue; }
            if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
            if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
            if (c === ',' && depth === 0) break;
            i++;
          }
          members[key] = body.slice(start, i).trim();
        }
        return members;
      };
      const members = arrayModules ? arrayModules.members : parseMembers(dict.body);
      const modIds = Object.keys(members);
      if (!modIds.length) return { error: '模块字典解析失败' };

      /* ---- 无 ID：列出清单 ---- */
      const wanted = String(idsText == null ? '' : idsText).split(/[,，\s]+/).map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      if (!wanted.length) {
        const rows = modIds.slice(0, 3000).map((id) => ({
          id: id,
          size: SK.dom.fmtBytes(members[id].length),
          preview: members[id].slice(0, 90).replace(/\s+/g, ' '),
          __detail: '模块 ' + id + ' 源码（前 4000 字符）：\n\n' + members[id].slice(0, 4000),
          __detailTitle: '模块 ' + id,
        }));
        return {
          text: modIds.join('\n'),
          lang: 'text',
          tabLabel: '模块 ID 清单 (' + modIds.length + ')',
          tabs: [{ label: '模块清单', view: 'table', data: { columns: [{ key: 'id', label: '模块 ID', width: 'minmax(90px,160px)' }, { key: 'size', label: '大小', width: '80px' }, { key: 'preview', label: '源码预览' }], rows: rows, name: 'wp-mods', filterHint: '过滤 ID 或源码关键词（如 sign/encrypt）' } }],
          stats: [{ k: '特征', v: feats.join(' + ') }, { k: '模块数', v: modIds.length }, { k: '字典体积', v: SK.dom.fmtBytes(arrayModules ? arrayModules.length : dict.body.length) }],
          notices: [{ level: 'info', msg: '填模块 ID 到第二个框可提取+生成骨架；清单可按源码关键词过滤直接定位加密模块' }],
          filename: 'wp-ids',
        };
      }

      /* ---- 递归提取依赖 ---- */
      const maxDepth = Math.max(1, Number(opts.depth || 5));
      /* webpack 把 __webpack_require__ 当第三个形参传进工厂，压缩后名字会被改成 n / r 之类。
         从工厂签名里把「require 形参」认出来，才不会漏依赖。 */
      const requireNameOf = function (code) {
        let params = null;
        const m1 = /^\s*(?:function\s*[\w$]*\s*)?\(([^()]*)\)/.exec(code);
        if (m1) params = m1[1];
        if (!params) {
          const m2 = /^\s*\(?\s*([^()=]+?)\s*\)?\s*=>/.exec(code);
          if (m2) params = m2[1];
        }
        if (!params) return '__webpack_require__';
        const list = params.split(',').map((s) => s.trim()).filter(Boolean);
        const hit = list.filter((n) => /webpack_require|^require$|__webpack/.test(n));
        if (hit.length) return hit[0];
        return list.length >= 3 ? list[2] : '__webpack_require__';
      };
      const depReOf = function (name) {
        return new RegExp('\\b' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(\\s*(?:"([^"\\n]{1,160})"|\'([^\'\\n]{1,160})\'|([\\w$./@-]+))\\s*\\)', 'g');
      };
      const depsOf = function (code) {
        const names = [requireNameOf(code), '__webpack_require__'];
        const out = [];
        const seen = Object.create(null);
        names.forEach((nm) => {
          if (!nm) return;
          const re = depReOf(nm);
          let m;
          while ((m = re.exec(code))) {
            const quoted = m[1] !== undefined || m[2] !== undefined;
            const dep = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
            if (!dep || seen[dep]) continue;
            /* 裸标识符：只有数字 ID、或确实在字典里，才当成模块引用；否则是局部变量 */
            if (!quoted && !/^\d+$/.test(dep) && members[dep] === undefined) continue;
            if (/^(?:module|exports|require)$/.test(dep)) continue;
            seen[dep] = 1;
            out.push(dep);
          }
        });
        return out;
      };

      const collected = {};
      const depTree = {};
      const visited = Object.create(null);
      const visit = function (id, depth) {
        if (visited[id] || depth > maxDepth) return;
        visited[id] = 1;
        if (members[id] === undefined) { collected[id] = null; return; } /* 不在本文件：其他 chunk / runtime */
        collected[id] = members[id];
        const deps = depsOf(collected[id]);
        depTree[id] = deps.filter((d) => d !== id);
        depTree[id].forEach((d) => visit(d, depth + 1));
      };
      wanted.forEach((id) => visit(id, 1));

      const have = Object.keys(collected).filter((k) => collected[k]);
      const missing = Object.keys(collected).filter((k) => !collected[k]);

      /* ---- 骨架生成 ---- */
      /* webpack 4 / 5 的 runtime 帮手调用约定不一样，最典型是 __webpack_require__.d：
         v4 是 d(exports, name, getter)，v5 是 d(exports, { a: () => a, b: () => b })。
         只按 v4 写桩的话，v5 的 .d(exports, {value:()=>42}) 会把整个字典当成员名、
         getter 传成 undefined，导出直接是空的（且没报错，很难发现）。下面的桩两种都认。 */
      const wpVer = /webpackJsonp/.test(src) ? 4 : /webpackChunk/.test(src) || /__webpack_modules__/.test(src) ? 5 : 0;
      const skeleton = [
        '/* SpiderLab webpack 骨架 —— 粘到「JS 沙箱执行」或 Node 里运行 */',
        '/* 识别形态：webpack ' + (wpVer || '未知') + '；runtime 桩同时兼容 4 / 5 两种约定 */',
        '(function () {',
        '  const __mods = {',
        have.map((id) => '    ' + JSON.stringify(String(id)) + ': ' + collected[id] + ',').join('\n'),
        '  };',
        '  const __cache = {};',
        '  function __webpack_require__(id) {',
        '    id = String(id);',
        '    if (__cache[id]) return __cache[id].exports;',
        '    const mod = (__cache[id] = { exports: {} });',
        '    const fn = __mods[id];',
        '    if (!fn) throw new Error("模块 " + id + " 不在提取集合里（回工具补提取）");',
        '    fn.call(mod.exports, mod, mod.exports, __webpack_require__);',
        '    return mod.exports;',
        '  }',
        '  /* ---- runtime 帮手 ---- */',
        '  __webpack_require__.m = __mods;',
        '  __webpack_require__.c = __cache;',
        '  __webpack_require__.o = function (obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop); };',
        '  __webpack_require__.d = function (exports, definition, getter) {',
        '    if (definition && typeof definition === "object") {',
        '      /* webpack 5：d(exports, { a: () => a, b: () => b }) */',
        '      for (const key in definition) {',
        '        if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {',
        '          Object.defineProperty(exports, key, { enumerable: true, configurable: true, get: definition[key] });',
        '        }',
        '      }',
        '      return;',
        '    }',
        '    /* webpack 4：d(exports, name, getter) */',
        '    if (!__webpack_require__.o(exports, definition)) {',
        '      Object.defineProperty(exports, definition, { enumerable: true, configurable: true, get: getter });',
        '    }',
        '  };',
        '  __webpack_require__.r = function (exports) {',
        '    if (typeof Symbol !== "undefined" && Symbol.toStringTag) Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
        '    Object.defineProperty(exports, "__esModule", { value: true });',
        '  };',
        '  __webpack_require__.n = function (m) {',
        '    const getter = m && m.__esModule ? function () { return m["default"]; } : function () { return m; };',
        '    __webpack_require__.d(getter, { a: getter });',
        '    return getter;',
        '  };',
        '  __webpack_require__.g = (function () {',
        '    if (typeof globalThis === "object") return globalThis;',
        '    try { return Function("return this")(); } catch (e) { return {}; }',
        '  })();',
        '  __webpack_require__.p = "";',
        '  __webpack_require__.u = function (id) { return id + ".js"; };',
        '  /* __webpack_require__.t：v5 的「兼容命名空间」包装，很多 ESM/CJS 混用的包会走到 */',
        '  __webpack_require__.t = function (value, mode) {',
        '    if (mode & 1) value = __webpack_require__(value);',
        '    if (mode & 8) return value;',
        '    if (typeof value === "object" && value) {',
        '      if ((mode & 4) && value.__esModule) return value;',
        '      if ((mode & 16) && typeof value.then === "function") return value;',
        '    }',
        '    const ns = Object.create(null);',
        '    __webpack_require__.r(ns);',
        '    Object.defineProperty(ns, "default", { enumerable: true, value: value });',
        '    if (mode & 2 && typeof value !== "string") {',
        '      for (const key in value) {',
        '        __webpack_require__.d(ns, key, (function (k) { return function () { return value[k]; }; })(key));',
        '      }',
        '    }',
        '    return ns;',
        '  };',
        '',
        '  /* 入口：改成你要的模块与调用方式 */',
        '  const entry = __webpack_require__(' + JSON.stringify(String(wanted[0])) + ');',
        '  console.log("入口模块导出:", entry);',
        '  /* 例: entry.encrypt(...) / entry.default(...) */',
        '})();',
      ].join('\n');

      const treeRows = [];
      Object.keys(depTree).forEach((id) => {
        (depTree[id] || []).forEach((d) => treeRows.push({ from: id, to: d, ok: collected[d] ? '已提取' : '缺失' }));
      });

      return {
        text: have.map((id) => '/* ===== 模块 ' + id + ' ===== */\n' + collected[id]).join('\n\n'),
        lang: 'js',
        tabLabel: '模块源码 (' + have.length + ')',
        tabs: [
          { label: '可运行骨架', text: skeleton, lang: 'js' },
          treeRows.length ? { label: '依赖树', view: 'table', data: { columns: [{ key: 'from', label: '模块', width: '100px' }, { key: 'to', label: '依赖', width: '100px' }, { key: 'ok', label: '状态', width: '80px' }], rows: treeRows, name: 'wp-deps' } } : null,
        ].filter(Boolean),
        stats: [
          { k: '特征', v: feats[0] },
          { k: '版本', v: wpVer ? 'webpack ' + wpVer : '未识别' },
          { k: '总模块', v: modIds.length },
          { k: '已提取', v: have.length, level: 'ok' },
          missing.length ? { k: '缺失依赖', v: missing.length, level: 'warn' } : null,
        ].filter(Boolean),
        notices: [].concat(
          missing.length ? [{ level: 'warn', msg: '这些依赖不在本文件（其他 chunk）：' + missing.join(', ') + '——需要把对应 chunk 也拖进来合并，或骨架里 stub 掉' }] : [],
          [{ level: 'info', msg: '把「可运行骨架」粘到 JS 沙箱执行，改入口调用即可验证扣代码' }],
        ),
        filename: 'wp-modules',
        next: [
          { label: '▶ 骨架丢沙箱跑', tool: 'js-sandbox' },
        ],
      };
    },
  });

  /* 示例：webpack5 形态迷你 bundle（数字键 + 箭头模块 + harmony 导出） */
  if (SK.samples) {
    SK.samples['webpack'] = '(self.webpackChunkspider = self.webpackChunkspider || []).push([[777], {\n'
      + '  101: (module, __unused_webpack_exports, __webpack_require__) => {\n'
      + '    const hash = __webpack_require__(202);\n'
      + '    module.exports = function sign(params) {\n'
      + '      return hash(JSON.stringify(params) + "SECRET");\n'
      + '    };\n'
      + '  },\n'
      + '  202: (module, exports, __webpack_require__) => {\n'
      + '    __webpack_require__.d(exports, { value: () => 42 });\n'
      + '    module.exports = function simpleHash(s) {\n'
      + '      let h = 0;\n'
      + '      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;\n'
      + '      return h.toString(16);\n'
      + '    };\n'
      + '  },\n'
      + '  303: (module, exports, __webpack_require__) => {\n'
      + '    module.exports = { track: function (e) { return "reported:" + e; } };\n'
      + '  }\n'
      + '}]);';
  }
})();
