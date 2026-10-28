/* 格式化组：JSON / Header / Cookie / Dict / JS / HTML / HTML 渲染 */
(function () {
  const { el } = SK.dom;

  /* ---------------- HTML 预览视图 ----------------
   * 安全模型（B01 修复）：
   *   1) 默认「静态」：sandbox="" —— 脚本、表单、弹窗、同源全部禁止，只做布局渲染。
   *   2) 「执行脚本」模式：sandbox="allow-scripts"，**绝不同时给 allow-same-origin**，
   *      此时 iframe 为不透明源，无法读写本应用 DOM / localStorage / IndexedDB。
   *   3) 联网开关独立于脚本开关：关闭时注入 CSP 掐断 fetch/XHR/外链资源。
   *   4) 「新窗口打开」沿用同一策略：外层页面用 noopener 打开且自注入严格 CSP，
   *      真正的目标 HTML 仍装在不透明源的沙箱 iframe 里。
   */
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 生成 CSP meta：network=false 时断网；scripts=false 时禁脚本 */
  function previewCsp(scripts, network) {
    if (network) return scripts ? '' : "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src 'none'; frame-src 'none'; connect-src *\">";
    return '<meta http-equiv="Content-Security-Policy" content="' + [
      "default-src 'none'",
      "script-src " + (scripts ? "'unsafe-inline' 'unsafe-eval' blob:" : "'none'"),
      "style-src 'unsafe-inline' data: blob:",
      "img-src data: blob:",
      "font-src data: blob:",
      "media-src data: blob:",
      "frame-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ') + '">';
  }

  /* 把 CSP 与可选的 base 注入到 head（必须在任何正文之前） */
  function injectHead(html, csp, base) {
    let out = html;
    const head = csp + (base ? '<base href="' + escapeAttr(base) + '">' : '');
    if (!head) return out;
    if (/<head\b[^>]*>/i.test(out)) return out.replace(/<head\b[^>]*>/i, (m) => m + head);
    if (/<html\b[^>]*>/i.test(out)) return out.replace(/<html\b[^>]*>/i, (m) => m + '<head>' + head + '</head>');
    if (/<!doctype\b[^>]*>/i.test(out)) return out.replace(/<!doctype\b[^>]*>/i, (m) => m + '<head>' + head + '</head>');
    return '<head>' + head + '</head>' + out;
  }

  function previewSandbox(scripts) {
    return scripts ? 'allow-scripts' : '';
  }

  /* 新窗口：外层零能力页面 + 沙箱 iframe，noopener 断开 opener 引用 */
  function openIsolatedWindow(html, scripts, network, base) {
    const inner = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      injectHead('', previewCsp(scripts, network), base).replace(/<\/?head>/g, '') +
      '</head><body>' + injectHtmlBody(html) + '</body></html>';
    const wrapper = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; frame-src about: blob: data:;">' +
      '<title>Spider Lab · 隔离预览</title>' +
      '<style>html,body{margin:0;height:100%;background:#fff}' +
      'iframe{border:0;width:100%;height:100%;display:block}</style></head><body>' +
      '<iframe sandbox="' + previewSandbox(scripts) + '" srcdoc="' + escapeAttr(inner) + '"></iframe>' +
      '</body></html>';
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }));
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (!w) SK.ui.toast('已在新标签页打开（隔离预览）', 'ok');
  }

  /* 目标 HTML 里可能自带 head/meta，直接放进 body 会导致 head 标签被丢弃，
     这里只做最小化处理：保留原样，由浏览器容错解析 */
  function injectHtmlBody(html) { return html; }

  SK.view('htmlpreview', function (host, data) {
    const wrap = el('div', { class: 'pv' });
    let scripts = data.scripts === true;   /* 默认静态 */
    let network = false;                   /* 默认不联网 */
    const frame = el('iframe', { class: 'pv-frame', sandbox: previewSandbox(scripts), referrerpolicy: 'no-referrer' });
    const widths = [375, 768, 1024, 0];
    const labels = ['手机', '平板', '桌面', '自适应'];
    let idx = 3;

    const policy = el('span', { class: 'pv-policy' });
    const scriptBtn = el('button', { class: 'btn tiny', onClick: () => { scripts = !scripts; sync(); } });
    const netBtn = el('button', { class: 'btn tiny', onClick: () => { network = !network; sync(); } });

    const bar = el('div', { class: 'pv-bar' }, [
      el('span', { class: 'pv-title', text: data.title || 'HTML 预览' }),
      scriptBtn,
      netBtn,
      policy,
      el('span', { class: 'pane-spacer' }),
      el('div', { class: 'pv-seg' }, labels.map((t, i) =>
        el('button', {
          class: 'seg' + (i === idx ? ' on' : ''),
          text: t,
          onClick: (e) => {
            idx = i;
            bar.querySelectorAll('.seg').forEach((b) => b.classList.remove('on'));
            e.target.classList.add('on');
            apply();
          },
        })
      )),
      el('button', { class: 'btn tiny', text: '新窗口', onClick: () => openIsolatedWindow(data.html, scripts, network, data.base) }),
      el('button', { class: 'btn tiny', text: '刷新', onClick: () => render() }),
    ]);

    function render() {
      frame.setAttribute('sandbox', previewSandbox(scripts));
      frame.srcdoc = injectHead(data.html, previewCsp(scripts, network), data.base);
    }
    function sync() {
      scriptBtn.textContent = scripts ? '脚本：执行（隔离）' : '脚本：禁用';
      scriptBtn.classList.toggle('primary', scripts);
      netBtn.textContent = network ? '联网：允许' : '联网：断开';
      netBtn.classList.toggle('primary', network);
      policy.textContent = scripts
        ? (network ? '沙箱：allow-scripts，不透明源，可联网' : '沙箱：allow-scripts，不透明源，已断网')
        : (network ? '沙箱：静态渲染（无脚本），外链资源可加载' : '沙箱：静态渲染（无脚本、断网）');
      render();
    }
    function apply() {
      const w = widths[idx];
      frame.style.width = w ? w + 'px' : '100%';
      frame.style.margin = w ? '0' : '';
    }
    wrap.appendChild(bar);
    wrap.appendChild(el('div', { class: 'pv-stage' }, [frame]));
    host.appendChild(wrap);
    sync();
    apply();
  });

  /* ============================================================
   * JSON
   * ============================================================ */
  SK.tool({
    id: 'json',
    name: 'JSON 格式化',
    group: 'format',
    icon: '{ }',
    aliases: 'json jsonfmt jsonformat 格式化 美化 压缩 校验 修复',
    keywords: ['json', '格式化', '美化', '压缩', '校验', '修复', '排序', 'pretty'],
    desc: '美化 / 压缩 / 排序键 / 语法校验 / 一键修复；超大 JSON 自动走流式打印，百万级对象也不卡界面',
    sample: 'json',
    hint: '支持带注释、单引号、尾逗号的“脏 JSON”——切到「修复」模式即可',
    inputs: [{ id: 'in', label: 'JSON 文本', placeholder: '在此粘贴 JSON，或把 .json 文件拖进编辑框', sample: 'json' }],
    options: [
      { id: 'mode', type: 'seg', label: '模式', value: 'pretty', choices: [{ v: 'pretty', label: '美化' }, { v: 'minify', label: '压缩' }, { v: 'sort', label: '排序键' }, { v: 'repair', label: '修复' }, { v: 'check', label: '校验' }] },
      { id: 'indent', type: 'select', label: '缩进', value: '2', choices: [{ v: '2', label: '2 空格' }, { v: '4', label: '4 空格' }, { v: 'tab', label: 'Tab' }] },
      { id: 'ascii', type: 'toggle', label: '转义中文', value: false, title: '把中文转成 \\uXXXX，某些老接口需要' },
      { id: 'sortDeep', type: 'toggle', label: '深层排序', value: true, title: '排序模式下是否递归排序所有层级的键' },
    ],
    help: '<h4>能做什么</h4><ul><li><b>美化</b>：2/4 空格或 Tab 缩进，保留大整数精度（不走 JS Number）</li><li><b>压缩</b>：去掉所有空白，生成最小体积</li><li><b>排序键</b>：递归按 key 字典序排列，方便对比两个响应</li><li><b>校验</b>：给出精确到行列的语法错误位置与上下文</li><li><b>修复</b>：去注释、单引号转双引号、去尾逗号、补右括号、Python 字面量转 JSON</li></ul><p>超过 5MB 自动启用流式打印（chunk 输出），内存占用恒定。</p>',
    handler: function (input, opts, hooks) {
      const text = String(input == null ? '' : input);
      opts = opts || {};
      const indent = opts.indent === 'tab' ? '\t' : Number(opts.indent || 2);

      if (opts.mode === 'check') {
        const v = SK.fmt.jsonValidate(text);
        if (v.ok) {
          const s = v.stats || {};
          return {
            text: '✓ JSON 合法\n\n节点数: ' + (s.nodes || 0) + '\n最大深度: ' + (s.depth || 0) + '\n对象: ' + (s.objects || 0) + ' · 数组: ' + (s.arrays || 0) + ' · 键: ' + (s.keys || 0) + '\n字节: ' + text.length,
            lang: 'text',
            stats: [{ k: '合法', v: '✓', level: 'ok' }, { k: '节点', v: s.nodes }, { k: '深度', v: s.depth }],
          };
        }
        const e = v.error || {};
        return {
          error: 'JSON 语法错误：' + (e.message || '未知错误') + (e.line ? ' （第 ' + e.line + ' 行第 ' + e.column + ' 列）' : ''),
          hint: '切到「修复」模式可自动尝试修复；或把光标定位到第 ' + (e.line || 1) + ' 行检查引号/逗号',
          text: (e.contextSnippet || '') + '\n\n' + (e.message || ''),
          lang: 'text',
          notices: [{ level: 'error', msg: '第 ' + (e.line || 1) + ' 行附近语法不合法' }],
        };
      }

      if (opts.mode === 'repair') {
        const r = SK.fmt.jsonRepair(text);
        const changes = (r.changes || []).map((c) => '第 ' + c.line + ' 行  [' + c.type + '] ' + c.desc);
        /* 顶层 text 必须是修复后的正文：复制/下载/钉住/发送都读它。
           旧实现只把正文塞进 tabs[0]，于是顶部按钮全部「没有可复制的输出」。 */
        const outText = String(r.text == null ? '' : r.text);
        if (!outText.trim()) {
          return {
            error: '修复失败：没能从输入里还原出 JSON 结构',
            hint: '先确认粘贴的是不是 JSON（HTML / JS 对象 / 表单串需要先换格式）；可以切到「校验」看第一处语法错误在哪一行',
          };
        }
        return {
          text: outText,
          lang: 'json',
          tabLabel: '修复结果',
          tabs: [{ label: '修复记录 (' + (r.changes || []).length + ')', text: changes.join('\n') || '无需修改', lang: 'text' }],
          notices: r.stats && r.stats.stillInvalid ? [{ level: 'warn', msg: '仍有语法问题，需要手动处理' }] : [{ level: 'ok', msg: '已生成合法 JSON' }],
          stats: [{ k: '改动', v: (r.changes || []).length }, { k: '原始', v: SK.dom.fmtBytes(text.length) }],
          filename: 'repaired',
        };
      }

      const r = SK.fmt.jsonFormat(text, {
        indent: indent,
        sortKeys: opts.mode === 'sort' ? (opts.sortDeep ? 'deep' : true) : false,
        ensureAscii: !!opts.ascii,
        compact: opts.mode === 'minify',
      });
      const err = r.stats && r.stats.error;
      if (err) {
        return {
          error: 'JSON 语法错误：' + (err.message || err) + (err.line ? ' （第 ' + err.line + ' 行第 ' + err.column + ' 列）' : ''),
          hint: '切到「修复」模式试试自动修复；或先看「校验」模式给出的上下文片段',
          text: (err.contextSnippet || ''),
          lang: 'text',
        };
      }
      const stats = [
        { k: '输出', v: SK.dom.fmtBytes(r.stats.bytes) },
        { k: '行数', v: SK.dom.fmtNum(r.stats.lines) },
        { k: '节点', v: SK.dom.fmtNum(r.stats.nodes) },
        { k: '深度', v: r.stats.depth },
      ];
      if (r.stats.keys) stats.push({ k: '键', v: SK.dom.fmtNum(r.stats.keys) });
      const tabs = [];
      /* 节点数可控时附一棵可折叠的结构树，逐层展开/收起看结构 */
      if (r.stats.nodes <= 20000 && r.text.length <= 3 * 1024 * 1024) {
        try {
          tabs.push({ label: '结构树', view: 'tree', data: JSON.parse(r.text) });
        } catch (e) {}
      }
      return {
        text: r.text,
        lang: 'json',
        tabLabel: '格式化结果',
        tabs: tabs,
        stats: stats,
        notices: r.notice ? [{ level: 'info', msg: '超大输入已使用流式打印：' + r.notice }] : null,
        filename: 'data',
      };
    },
  });

  /* ============================================================
   * Header
   * ============================================================ */
  SK.tool({
    id: 'header',
    name: 'Header 格式化',
    group: 'format',
    icon: 'H',
    aliases: 'header headers 请求头 响应头 格式化',
    keywords: ['header', '请求头', '响应头', 'dict', 'curl', 'httpclient'],
    desc: '把 Chrome「Copy as cURL」或原始请求头转成 Python dict / JSON / curl -H / http.client，自动清理伪头与重复头',
    sample: 'header',
    hint: '支持带 GET /path HTTP/1.1 起始行的完整请求头块',
    inputs: [{ id: 'in', label: '原始 Header', placeholder: 'accept: */*\ncookie: a=1', sample: 'header' }],
    options: [
      { id: 'style', type: 'seg', label: '输出', value: 'dict', choices: [{ v: 'dict', label: 'Python dict' }, { v: 'json', label: 'JSON' }, { v: 'curl', label: 'curl -H' }, { v: 'http', label: '原名: 值' }] },
      { id: 'align', type: 'toggle', label: '冒号对齐', value: false },
      { id: 'dropPseudo', type: 'toggle', label: '去伪头', value: true, title: '去掉 :authority :method :path :scheme 等 HTTP/2 伪头' },
      { id: 'lower', type: 'toggle', label: '小写名', value: false },
      { id: 'dedupe', type: 'toggle', label: '去重复', value: true },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      let list = SK.net.parseHeaderBlock(text);
      if (opts.dropPseudo) list = list.filter((h) => !/^:/.test(h.name) && !/^(host|content-length|connection)$/i.test(h.name));
      if (opts.lower) list = list.map((h) => ({ name: h.name.toLowerCase(), value: h.value }));
      if (opts.dedupe) {
        const seen = {};
        const out = [];
        for (const h of list) {
          const k = h.name.toLowerCase();
          if (seen[k] !== undefined) {
            out[seen[k]].value = h.value;
            continue;
          }
          seen[k] = out.length;
          out.push(h);
        }
        list = out;
      }
      if (!list.length) return { error: '没有解析到任何 Header', hint: '每行一个 name: value；从浏览器复制请用「Copy as cURL」或「Copy request headers」' };

      let out = '';
      if (opts.style === 'json') out = JSON.stringify(list.reduce((a, h) => ((a[h.name] = h.value), a), {}), null, 2);
      else if (opts.style === 'curl') out = list.map((h) => "-H '" + h.name + ': ' + String(h.value).replace(/'/g, "'\\''") + "'").join(' \\\n  ');
      else if (opts.style === 'http') out = SK.net.formatHeaderBlock(list, { align: opts.align });
      else {
        const pad = opts.align ? Math.max.apply(null, list.map((h) => h.name.length)) : 0;
        out = 'headers = {\n' + list.map((h) => '    ' + JSON.stringify(h.name) + ':' + ' '.repeat(Math.max(1, pad - h.name.length + 1)) + JSON.stringify(h.value) + ',').join('\n') + '\n}';
      }
      return {
        text: out,
        tabLabel: '代码',
        lang: opts.style === 'json' ? 'json' : opts.style === 'dict' ? 'python' : 'text',
        stats: [{ k: '头数量', v: list.length }, { k: 'Cookie 头', v: list.filter((h) => /^cookie$/i.test(h.name)).length }],
        tabs: [
          { label: '表格', view: 'table', data: { columns: [{ key: 'name', label: 'Name', width: 'minmax(140px,220px)' }, { key: 'value', label: 'Value' }], rows: list, name: 'headers', filterHint: '过滤 header（支持正则）' } },
        ],
      };
    },
  });

  /* ============================================================
   * Cookie
   * ============================================================ */
  SK.tool({
    id: 'cookie',
    name: 'Cookie 格式化',
    group: 'format',
    icon: 'C',
    aliases: 'cookie setcookie 格式化',
    keywords: ['cookie', 'set-cookie', '格式化', 'netscape', 'json'],
    desc: '解析 Set-Cookie / Cookie / JSON 数组，输出 Cookie 头、Set-Cookie、JSON、document.cookie 或键值对，并标注过期时间',
    sample: 'cookie',
    hint: '同时支持多条 Set-Cookie，以及浏览器插件导出的 JSON',
    inputs: [{ id: 'in', label: 'Cookie 文本', placeholder: 'a=1; Path=/; HttpOnly', sample: 'cookie' }],
    options: [
      { id: 'style', type: 'seg', label: '输出', value: 'header', choices: [{ v: 'header', label: 'Cookie 头' }, { v: 'set', label: 'Set-Cookie' }, { v: 'json', label: 'JSON' }, { v: 'doc', label: 'document' }, { v: 'pair', label: 'a=1&b=2' }] },
      { id: 'decode', type: 'toggle', label: 'URL 解码值', value: false },
      { id: 'dedupe', type: 'toggle', label: '同名去重', value: true },
    ],
    handler: function (input, opts) {
      const r = SK.net.parseCookie(String(input == null ? '' : input));
      let entries = r.entries || [];
      if (opts.dedupe) {
        const map = {};
        entries.forEach((e) => (map[e.name] = e));
        entries = Object.keys(map).map((k) => map[k]);
      }
      if (opts.decode) entries = entries.map((e) => Object.assign({}, e, { value: (function (v) { try { return decodeURIComponent(v); } catch (err) { return v; } })(e.value) }));
      if (!entries.length) return { error: '没有解析到 Cookie', hint: '格式示例：a=1; b=2 或 Set-Cookie: sid=xx; Path=/; HttpOnly' };
      const text = SK.net.formatCookie(entries, { style: opts.style });
      const now = Date.now();
      const rows = entries.map((e) => ({
        name: e.name,
        value: e.value.length > 200 ? e.value.slice(0, 200) + '…' : e.value,
        domain: e.domain || '',
        path: e.path || '',
        expires: e.expires && e.expires.iso ? new Date(e.expires.iso).toLocaleString('zh-CN') : '',
        state: e.expires && e.expires.iso ? (new Date(e.expires.iso).getTime() < now ? '已过期' : '有效') : '会话',
        flags: ['httponly', 'secure', 'partitioned'].filter((f) => e.attributes[f]).join(' ') + (e.attributes.samesite ? ' ' + e.attributes.samesite : ''),
      }));
      const expired = rows.filter((x) => x.state === '已过期').length;
      return {
        text: text,
        tabLabel: '文本',
        lang: opts.style === 'json' ? 'json' : 'text',
        tabs: [
          { label: '表格', view: 'table', data: { columns: [{ key: 'name', label: 'Name', width: 'minmax(120px,200px)' }, { key: 'value', label: 'Value' }, { key: 'domain', label: 'Domain', width: 'minmax(110px,160px)' }, { key: 'path', label: 'Path', width: '80px' }, { key: 'expires', label: '过期时间', width: 'minmax(150px,180px)' }, { key: 'state', label: '状态', width: '80px' }, { key: 'flags', label: 'Flags', width: 'minmax(120px,160px)' }], rows: rows, name: 'cookies' } },
        ],
        stats: [{ k: '条目', v: entries.length }, expired ? { k: '已过期', v: expired, level: 'warn' } : null].filter(Boolean),
        notices: r.errors && r.errors.length ? [{ level: 'warn', msg: '解析告警：' + r.errors.slice(0, 3).map((e) => e.message || e).join('；') }] : null,
        filename: 'cookies',
      };
    },
  });

  /* ============================================================
   * Python dict
   * ============================================================ */
  SK.tool({
    id: 'dict',
    name: 'Dict 格式化',
    group: 'format',
    icon: 'py',
    aliases: 'dict python 字典 字面量 格式化',
    keywords: ['dict', 'python', '字典', '字面量', 'json', '转换'],
    desc: '把 Python 的 dict / list / tuple 字面量转成标准 JSON，也能反向生成 Python repr，支持 None/True/单引号/尾逗号/注释',
    sample: 'dict',
    hint: '从 JS 里扒下来的对象也能用（单引号、无引号 key 会自动处理）',
    inputs: [{ id: 'in', label: 'Python 字面量', placeholder: "{'a': 1, 'b': [1, 2], 'c': None}", sample: 'dict' }],
    options: [
      { id: 'to', type: 'seg', label: '输出', value: 'json', choices: [{ v: 'json', label: 'JSON' }, { v: 'python', label: 'Python repr' }, { v: 'tree', label: '树' }] },
      { id: 'indent', type: 'number', label: '缩进', value: 2, min: 0, max: 8 },
      { id: 'sort', type: 'toggle', label: '键排序', value: false },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      let r;
      try {
        r = SK.code.parsePy(text);
      } catch (e) {
        return { error: '解析失败：' + e.message, hint: '检查是否有多余的赋值语句、函数调用或未闭合的括号；只支持纯字面量' };
      }
      if (r.empty) return { error: '输入为空' };
      let value = r.value;
      if (opts.sort) {
        const sortObj = (v) => {
          if (Array.isArray(v)) return v.map(sortObj);
          if (v && typeof v === 'object') {
            const o = {};
            Object.keys(v).sort().forEach((k) => (o[k] = sortObj(v[k])));
            return o;
          }
          return v;
        };
        value = sortObj(value);
      }
      const indent = Math.max(0, Number(opts.indent == null ? 2 : opts.indent));
      const treeTab = r.stats.nodes <= 20000 ? [{ label: '结构树', view: 'tree', data: value }] : [];
      if (opts.to === 'python') {
        return {
          text: SK.code.pyRepr(value, indent, 0), lang: 'python', tabLabel: 'Python repr',
          tabs: treeTab,
          stats: [{ k: '节点', v: r.stats.nodes }, { k: '深度', v: r.stats.depth }], notices: r.warnings.map((w) => ({ level: 'warn', msg: w })),
        };
      }
      if (opts.to === 'tree') {
        return { view: 'tree', data: value, text: JSON.stringify(value, null, indent), lang: 'json' };
      }
      return {
        text: JSON.stringify(value, null, indent),
        lang: 'json',
        tabLabel: 'JSON',
        tabs: treeTab,
        stats: [{ k: '节点', v: r.stats.nodes }, { k: '深度', v: r.stats.depth }, { k: '字符串', v: r.stats.strings }],
        notices: r.warnings.length ? r.warnings.slice(0, 6).map((w) => ({ level: 'warn', msg: w })) : null,
      };
    },
  });

  /* ============================================================
   * JavaScript
   * ============================================================ */
  SK.tool({
    id: 'js',
    name: 'JS 格式化',
    group: 'format',
    icon: 'JS',
    aliases: 'js javascript 格式化 美化 minify 压缩',
    keywords: ['js', 'javascript', '格式化', '美化', '压缩', 'beautify', 'uglify'],
    desc: '用 Terser 做 JS 美化 / 压缩：走完整 AST，自动分号插入、正则、模板串、现代语法与数字字面量（0x10 / 大整数）都保真',
    sample: 'js',
    hint: '默认「安全压缩」只删空白和注释，不改名不改结构；需要极致体积再选「深度压缩」',
    inputs: [{ id: 'in', label: 'JavaScript', placeholder: 'function a(){...}', sample: 'js' }],
    options: [
      { id: 'mode', type: 'seg', label: '模式', value: 'pretty', choices: [{ v: 'pretty', label: '美化' }, { v: 'min', label: '压缩' }] },
      { id: 'indent', type: 'select', label: '缩进', value: '2', choices: [{ v: '2', label: '2 空格' }, { v: '4', label: '4 空格' }, { v: 'tab', label: 'Tab' }] },
      { id: 'level', type: 'select', label: '压缩强度', value: 'safe', choices: [{ v: 'safe', label: '安全：仅去空白/注释' }, { v: 'full', label: '深度：含改名与结构优化' }] },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      if (!text.trim()) return { error: '输入为空' };
      const indent = opts.indent === 'tab' ? '\t' : Number(opts.indent || 2);
      if (opts.mode === 'min') {
        const r = SK.code.jsMinify(text, { compress: opts.level === 'full', mangle: opts.level === 'full' });
        const notices = [];
        if (r.warning) notices.push({ level: 'warn', msg: r.warning });
        else if (opts.level === 'full') notices.push({ level: 'warn', msg: '深度压缩会重命名局部变量与优化结构；若原代码依赖 Function.prototype.toString / fn.name / 全局引用，请勿直接使用' });
        return {
          text: r.code, lang: 'js', notices: notices.length ? notices : undefined,
          stats: [{ k: '原始', v: SK.dom.fmtBytes(text.length) }, { k: '压缩后', v: SK.dom.fmtBytes(r.code.length) }, { k: '压缩率', v: (100 - (r.code.length / Math.max(1, text.length)) * 100).toFixed(1) + '%' }, { k: '引擎', v: r.engine }], filename: 'min',
        };
      }
      const r = SK.code.jsPretty(text, { indent: indent });
      return {
        text: r.code, lang: 'js',
        notices: r.warning ? [{ level: 'warn', msg: r.warning }] : undefined,
        stats: [{ k: '行数', v: r.code.split('\n').length }, { k: '字节', v: SK.dom.fmtBytes(r.code.length) }, { k: '引擎', v: r.engine }], filename: 'pretty',
      };
    },
  });

  /* ============================================================
   * HTML
   * ============================================================ */
  SK.tool({
    id: 'html',
    name: 'HTML 格式化',
    group: 'format',
    icon: '</>',
    aliases: 'html 格式化 美化',
    keywords: ['html', '格式化', '美化', 'dom'],
    desc: '标签缩进美化，保留 script/style/textarea 原文，可自动格式化内嵌 JS 与 CSS，长属性自动换行',
    sample: 'html',
    hint: '想直接看效果？用「HTML 渲染」工具',
    inputs: [{ id: 'in', label: 'HTML', placeholder: '<div>...</div>', sample: 'html' }],
    options: [
      { id: 'indent', type: 'select', label: '缩进', value: '2', choices: [{ v: '2', label: '2 空格' }, { v: '4', label: '4 空格' }, { v: 'tab', label: 'Tab' }] },
      { id: 'wrap', type: 'select', label: '属性换行', value: '0', choices: [{ v: '0', label: '不换行' }, { v: '100', label: '>100 字符' }, { v: '120', label: '>120 字符' }] },
      { id: 'embed', type: 'toggle', label: '格式化内嵌 JS/CSS', value: false },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      if (!text.trim()) return { error: '输入为空' };
      const out = SK.code.html(text, { indent: opts.indent === 'tab' ? '\t' : Number(opts.indent || 2), wrapWidth: Number(opts.wrap || 0), formatEmbedded: !!opts.embed });
      const tags = (text.match(/<[a-zA-Z][\w:-]*/g) || []).length;
      return { text: out, lang: 'html', stats: [{ k: '标签', v: tags }, { k: '行数', v: out.split('\n').length }, { k: '字节', v: SK.dom.fmtBytes(out.length) }], filename: 'index' };
    },
  });

  /* ============================================================
   * HTML 渲染
   * ============================================================ */
  SK.tool({
    id: 'html-render',
    name: 'HTML 渲染',
    group: 'format',
    icon: '▤',
    aliases: 'html render 渲染 预览 沙箱',
    keywords: ['html', '渲染', '预览', 'iframe', '截图'],
    desc: '在隔离沙箱 iframe 里渲染 HTML，默认不执行脚本、不联网；可在预览区临时开启脚本执行（不透明源）与联网，适合检查爬下来的页面结构',
    sample: 'html',
    hint: '默认静态渲染：脚本被禁用、无同源、无联网。需要跑页面脚本时点预览区「脚本：禁用」切换，此时 iframe 为不透明源，读不到本工具任何数据',
    inputs: [{ id: 'in', label: 'HTML 源码', placeholder: '<html>…</html>', sample: 'html' }],
    options: [
      { id: 'json', type: 'toggle', label: '同时提取链接/脚本', value: true },
    ],
    handler: function (input, opts) {
      const html = String(input == null ? '' : input);
      if (!html.trim()) return { error: '输入为空' };
      const links = [];
      const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && links.length < 500) links.push({ url: m[1], text: m[2].replace(/<[^>]+>/g, '').trim().slice(0, 60) });
      const scripts = (html.match(/<script\b[^>]*src\s*=\s*["']([^"']+)["']/gi) || []).map((s) => (s.match(/["']([^"']+)["']/) || [])[1]).filter(Boolean);
      const tabs = [{ label: '渲染预览', view: 'htmlpreview', data: { html: html, title: 'HTML 隔离预览' } }];
      if (opts.json && links.length) {
        tabs.push({ label: '链接 (' + links.length + ')', view: 'table', data: { columns: [{ key: 'url', label: 'URL' }, { key: 'text', label: '文本', width: 'minmax(120px,240px)' }], rows: links, name: 'links' } });
      }
      if (opts.json && scripts.length) tabs.push({ label: '外链脚本', text: scripts.join('\n'), lang: 'text' });
      return { tabs: tabs, text: html, lang: 'html', stats: [{ k: '链接', v: links.length }, { k: '外链脚本', v: scripts.length }, { k: '大小', v: SK.dom.fmtBytes(html.length) }] };
    },
  });

  /* ---------------- JSONPath 提取 ---------------- */
  SK.tool({
    id: 'jsonpath',
    name: 'JSONPath 提取',
    group: 'format',
    icon: '$..',
    aliases: 'jsonpath json path 提取 取值 路径 查询',
    keywords: ['jsonpath', 'json', 'path', '提取', '取值', '查询', '字段', '接口'],
    desc: '用 JSONPath 从接口响应里精确取值：支持 $.a.b、$.list[*].id、$..key 递归、[0] 下标，结果表可直接复制',
    hint: '左侧贴 JSON，右上填路径。常见写法：$.data.list[*].id / $..token / $.items[0].name',
    sample: 'json',
    inputs: [
      { id: 'in', label: 'JSON', placeholder: '{"data":{"list":[{"id":1}]}}', sample: 'json' },
      { id: 'path', label: 'JSONPath', placeholder: '$.data.list[*].id', small: true, value: '$.data.list[*].id' },
    ],
    options: [
      { id: 'limit', type: 'number', label: '最多返回', value: 200, min: 1, max: 5000 },
      { id: 'asLines', type: 'toggle', label: '一行一个值', value: true },
    ],
    handler: function (input, path, opts) {
      opts = opts || {};
      const src = String(input == null ? '' : input);
      const p = String(path == null ? '' : path).trim();
      if (!src.trim()) return { error: '请粘贴 JSON' };
      if (!p) return { error: '请填写 JSONPath', hint: '如 $.data.list[*].id 或 $..token' };
      const r = SK.fmt.jsonQuery(src, p, { limit: Number(opts.limit || 200), lenient: true });
      if (r.error) return { error: 'JSONPath 执行失败：' + (r.error.message || r.error) };
      if (r.tooLarge) return { error: 'JSON 太大', hint: r.hint };
      if (!r.count) {
        return { error: '没有匹配到任何节点：' + p, hint: '检查路径大小写；数组通配要写 [*]；递归用 $..key（只写一次 ..）' };
      }
      const vals = r.values || [];
      /* 精度保真：超 2^53 的整数在内部以 {__jsonNumber:'...'} 承载（避免 JSON.parse 丢位）。
         但爬虫要的是能直接粘进 URL / 数据库的原始数字，不能把内部包装泄露给用户。
         texts（renderRef 的结果）是保真原文，优先用它；取不到再退回 values。 */
      const texts = r.texts || [];
      const show = (v, i) => {
        const t = texts[i];
        if (typeof t === 'string' && t.length) return t;
        if (v === null) return 'null';
        if (typeof v === 'object' && v && v.__jsonNumber !== undefined) return String(v.__jsonNumber);
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
      };
      const rows = vals.map((v, i) => {
        const s = show(v, i);
        return { i: i + 1, value: s.length > 500 ? s.slice(0, 500) + '…' : s };
      });
      const text = opts.asLines === false
        ? '[' + vals.map((v, i) => show(v, i)).join(',\n  ') + ']'
        : vals.map((v, i) => {
          const s = show(v, i);
          /* 一行一个值的场景通常是数字/字符串，字符串不该带外层引号（要直接拼进 URL） */
          return typeof v === 'string' ? s.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '\n') : s;
        }).join('\n');
      return {
        text: text,
        lang: 'json',
        tabs: [{
          label: '匹配 (' + r.count + ')',
          view: 'table',
          data: {
            columns: [{ key: 'i', label: '#', width: '60px' }, { key: 'value', label: '值' }],
            rows: rows, name: 'jsonpath', filterHint: '过滤值',
          },
        }],
        stats: [
          { k: '匹配', v: r.count, level: 'ok' },
          { k: '返回', v: rows.length },
          r.truncated ? { k: '截断', v: '是（调大「最多返回」）', level: 'warn' } : null,
        ].filter(Boolean),
        notices: [
          r.notice ? { level: 'info', msg: r.notice } : null,
          r.truncated ? { level: 'warn', msg: '结果超过上限，已截断（当前上限 ' + (opts.limit || 200) + '）' } : null,
        ].filter(Boolean),
        filename: 'jsonpath',
      };
    },
  });
})();
