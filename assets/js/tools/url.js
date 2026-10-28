/* URL 工具：参数提取 / 编解码 / 解析器 */
(function () {

  SK.tool({
    id: 'url-params',
    name: 'URL 参数提取',
    group: 'spider',
    icon: '?=',
    aliases: 'url params query 参数 提取 查询参数',
    keywords: ['url', 'params', 'query', '参数', '提取', '查询串'],
    desc: '把 URL 里的查询参数拆成表格：解码值 / 长度 / 是否重复，一眼看出签名参数与时间戳',
    sample: 'url',
    hint: '直接粘贴整条 URL 或 a=1&b=2 都行',
    inputs: [{ id: 'in', label: 'URL / 查询串', placeholder: 'https://a.com/list?page=1&sign=xx', sample: 'url' }],
    options: [
      { id: 'sort', type: 'toggle', label: '按名排序', value: false },
      { id: 'hash', type: 'toggle', label: '也解析 #', value: false, title: '有些 SPA 把参数放在 hash 里' },
      { id: 'dedupe', type: 'toggle', label: '同名合并', value: false },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).trim();
      if (!raw) return { error: '输入为空' };
      /* B17：
         · 裸 query（a=1&b=2）旧实现只认 ? / # 开头，直接报「没找到任何参数」
         · 完整 URL 里 ?a=1#section 会把 #section 一起并进最后一个参数值
         这里统一：先去掉 fragment，再决定用 query 还是 hash，剩下纯 k=v 也认。 */
      let search = '';
      let hashPart = '';
      const hIdx = raw.indexOf('#');
      const body = hIdx >= 0 ? raw.slice(0, hIdx) : raw;
      hashPart = hIdx >= 0 ? raw.slice(hIdx + 1) : '';
      if (/^[?#]/.test(raw)) search = raw.replace(/^#/, '');
      else {
        const q = body.indexOf('?');
        if (q >= 0) search = body.slice(q);
        else if (hashPart && opts.hash) search = hashPart;
        else if (/(^|&)[^=&\s]+=[^&\s]*/.test(body) && !/\s/.test(body) && body.indexOf('/') < 0) search = body;
        else if (hashPart && /(^|&)[^=&\s]+=[^&\s]*/.test(hashPart)) search = hashPart;
      }
      const params = SK.net.parseQueryString(search);
      if (!params.length) return { error: '没找到任何参数', hint: '支持整条 URL、?a=1 片段、裸 query（a=1&b=2），SPA 的 hash 参数请打开「也解析 #」' };
      let rows = params.map((p, i) => ({ i: i + 1, name: p.name, value: p.value, len: p.value.length }));
      const seen = {};
      rows.forEach((r) => (seen[r.name] = (seen[r.name] || 0) + 1));
      rows.forEach((r) => (r.dup = seen[r.name] > 1 ? '×' + seen[r.name] : ''));
      if (opts.dedupe) {
        const map = {};
        rows.forEach((r) => (map[r.name] = r));
        rows = Object.keys(map).map((k) => map[k]);
      }
      if (opts.sort) rows.sort((a, b) => a.name.localeCompare(b.name));
      const text = rows.map((r) => r.name + ' = ' + r.value).join('\n');
      const json = '{\n' + rows.map((r) => '  ' + JSON.stringify(r.name) + ': ' + JSON.stringify(r.value)).join(',\n') + '\n}';
      const SUSPECT_SUB = /(sign|signature|token|nonce|csrf|xsrf|hmac)/i;
      const SUSPECT_EXACT = /^(ts|t|_|_t|key|api_?key|secret|auth|authorization|timestamp|sig|session|sessionid|time)$/i;
      const suspicious = rows.filter((r) => SUSPECT_SUB.test(r.name) || SUSPECT_EXACT.test(r.name));
      return {
        text: text,
        tabLabel: '键值',
        lang: 'text',
        tabs: [
          { label: '表格', view: 'table', data: { columns: [{ key: 'i', label: '#', width: '52px' }, { key: 'name', label: '参数名', width: 'minmax(120px,220px)' }, { key: 'value', label: '值' }, { key: 'len', label: '长度', width: '70px' }, { key: 'dup', label: '重复', width: '64px' }], rows: rows, name: 'params' } },
          { label: 'JSON', text: json, lang: 'json' },
        ],
        stats: [{ k: '参数', v: rows.length }, suspicious.length ? { k: '疑似签名', v: suspicious.map((x) => x.name).join(','), level: 'warn' } : null].filter(Boolean),
        notices: suspicious.length
          ? [{
              level: 'info',
              msg:
                '检测到疑似签名/时间戳参数：' +
                suspicious.slice(0, 8).map((x) => x.name).join('、') +
                (suspicious.length > 8 ? ' 等 ' + suspicious.length + ' 个' : '') +
                '（逆向时优先盯它们）',
            }]
          : null,
        filename: 'params',
      };
    },
  });

  /* URL 编码的细节实现已移到 lib/genkit.js（Worker 里也可见），这里只留注释避免两份实现漂移 */

  function codecHandler(input, opts) {
    opts = opts || {};
    const raw = String(input == null ? '' : input);
    const dir = opts.dir === 'decode' ? 'decode' : 'encode';
    const scope = opts.scope === 'full' ? 'full' : opts.scope === 'value' ? 'value' : 'component';
    const lines = raw.split('\n');
    const perLine = opts.perLine !== false;
    const convert = (s) => {
      if (dir === 'encode') return SK.gen.encodeUrlAware(s, scope);
      let t = s;
      if (opts.plusAsSpace) t = t.replace(/\+/g, ' ');
      try {
        return decodeURIComponent(t);
      } catch (e) {
        return t.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
          try { return decodeURIComponent(m); } catch (err) { return m; }
        });
      }
    };
    let out, changed = 0;
    if (perLine && lines.length > 1) {
      out = lines.map((l) => {
        const r = convert(l);
        if (r !== l) changed++;
        return r;
      }).join('\n');
    } else {
      out = convert(raw);
      changed = out !== raw ? 1 : 0;
    }
    const stats = [{ k: dir === 'encode' ? '编码后' : '解码后', v: SK.dom.fmtBytes(out.length) }, { k: '原始', v: SK.dom.fmtBytes(raw.length) }];
    if (dir === 'encode') stats.push({ k: '示例', v: out.length > 160 ? out.slice(0, 160) + '…' : out });
    return {
      text: out,
      lang: 'text',
      stats: stats,
      notices: changed === 0 && raw ? [{ level: 'warn', msg: dir === 'decode' ? '没有可解码的 %xx 序列（可能已经是明文）' : '内容看起来不需要编码' }] : null,
    };
  }

  SK.tool({
    id: 'url-encode',
    name: 'URL 编码',
    group: 'spider',
    icon: '%↑',
    aliases: 'url encode 编码 转义',
    keywords: ['url', 'encode', '编码', '转义', 'encodeURIComponent'],
    desc: 'encodeURIComponent / 整条 URL 编码，多行输入逐行处理，适合批量造参数',
    sample: 'url',
    inputs: [{ id: 'in', label: '待编码文本', placeholder: '关键词 中文 & 符号', sample: 'url' }],
    options: [
      { id: 'dir', type: 'seg', label: '方向', value: 'encode', choices: [{ v: 'encode', label: '编码' }, { v: 'decode', label: '解码' }] },
      { id: 'scope', type: 'seg', label: '范围', value: 'component', choices: [{ v: 'component', label: '组件' }, { v: 'full', label: '整条 URL' }, { v: 'value', label: '只编 value' }] },
      { id: 'perLine', type: 'toggle', label: '逐行处理', value: true },
      { id: 'plusAsSpace', type: 'toggle', label: '解码时 + 当空格', value: true },
    ],
    handler: codecHandler,
  });

  SK.tool({
    id: 'url-decode',
    name: 'URL 解码',
    group: 'spider',
    icon: '%↓',
    aliases: 'url decode 解码 还原',
    keywords: ['url', 'decode', '解码', '还原', 'unescape'],
    desc: '还原 %E4%B8%AD 这类编码，遇到坏序列会自动跳过而不是整体失败',
    sample: 'url',
    inputs: [{ id: 'in', label: '待解码文本', placeholder: '%E8%80%B3%E6%9C%BA', sample: 'url' }],
    options: [
      { id: 'dir', type: 'seg', label: '方向', value: 'decode', choices: [{ v: 'encode', label: '编码' }, { v: 'decode', label: '解码' }] },
      { id: 'plusAsSpace', type: 'toggle', label: '+ 当空格', value: true },
      { id: 'perLine', type: 'toggle', label: '逐行处理', value: true },
    ],
    handler: codecHandler,
  });

  SK.tool({
    id: 'url-parser',
    name: 'URL 解析器',
    group: 'spider',
    icon: '🔗',
    aliases: 'url parse 解析 拆解 协议 域名 端口',
    keywords: ['url', 'parse', '解析', '协议', '域名', '端口', 'path'],
    desc: '拆出协议 / 主机 / 端口 / 路径 / 查询 / 锚点，并给出规范化后的 URL 与参数清单',
    sample: 'url',
    inputs: [{ id: 'in', label: 'URL', placeholder: 'https://user:pwd@a.com:8443/path/x?q=1#h', sample: 'url' }],
    options: [{ id: 'strip', type: 'toggle', label: '去掉跟踪参数', value: false, title: 'utm_* / gclid / fbclid / spm 等' }],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).trim();
      let u;
      try {
        u = new URL(raw);
      } catch (e) {
        return { error: 'URL 不合法：' + e.message, hint: '缺少协议时无法解析，试试补上 https://' };
      }
      const params = SK.net.parseQueryString(u.search);
      const trackRe = /^(utm_|gclid|fbclid|spm|scm|share_?token)/i;
      const kept = opts.strip ? params.filter((p) => !trackRe.test(p.name)) : params;
      const clean = new URL(u.href);
      if (opts.strip) {
        clean.search = '';
        kept.forEach((p) => clean.searchParams.append(p.name, p.value));
      }
      const rows = [
        { k: 'protocol', v: u.protocol, copy: true },
        { k: 'hostname', v: u.hostname, copy: true },
        { k: 'port', v: u.port || '默认(' + (u.protocol === 'https:' ? '443' : '80') + ')' },
        { k: 'origin', v: u.origin, copy: true },
        { k: 'pathname', v: u.pathname, copy: true },
        { k: '路径段', v: u.pathname.split('/').filter(Boolean).join(' / ') || '无' },
        { k: 'search', v: u.search || '无', copy: true },
        { k: 'hash', v: u.hash || '无' },
        { k: 'username', v: u.username || '无' },
        { k: '参数个数', v: params.length },
        { k: '规范化 URL', v: clean.href, copy: true },
      ];
      /* 顶层 text：复制全文 / 下载 / 钉住 / 发送都读它。
         纯 fields 视图如果不给 text，顶部按钮会静默拿到空串。 */
      const text = rows.map((r) => r.k + ': ' + r.v).join('\n');
      return {
        text: text,
        lang: 'text',
        tabLabel: '字段',
        tabs: [
          { label: '字段（表格）', view: 'table', data: { columns: [{ key: 'k', label: '字段', width: '130px' }, { key: 'v', label: '值' }], rows: rows, name: 'url-fields' } },
          { label: '参数 (' + params.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '参数' }, { key: 'value', label: '值' }], rows: params.map((p) => ({ name: p.name, value: p.value })), name: 'params' } },
          { label: '规范化 URL', text: clean.href, lang: 'text' },
        ],
        stats: [{ k: '域名', v: u.hostname }, { k: '参数', v: params.length }],
        action: { label: '复制规范化 URL', onClick: () => SK.dom.copy(clean.href).then(() => SK.ui.toast('已复制', 'ok')) },
        notices: opts.strip && kept.length !== params.length ? [{ level: 'info', msg: '已移除 ' + (params.length - kept.length) + ' 个跟踪参数' }] : null,
      };
    },
  });
})();
