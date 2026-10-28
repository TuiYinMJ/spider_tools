/* 转换工具：curl → requests / feapder / scrapy / fetch / axios / HAR，JSON → SQL */
(function () {

  const CURL_INPUT = { id: 'in', label: 'cURL 命令', placeholder: "curl 'https://a.com/api' -H 'cookie: a=1' --data-raw '{}'", sample: 'curl' };

  /* GEN_ENV / qualityBlock / structureCheck 已移到 lib/genkit.js：
     handler 会被序列化进 Worker，模块级定义在那边不可见 */

  SK.tool({
    id: 'curl-requests',
    name: 'cURL 转 requests',
    group: 'format',
    icon: '🐍',
    aliases: 'curl requests python 转换',
    keywords: ['curl', 'requests', 'python', '转换', '代码生成', 'session'],
    desc: '把浏览器复制的 cURL 转成可直接运行的 requests 代码：自动拆 query、headers、cookies、json/form/multipart，并提示 UA-CH 等易错点',
    sample: 'curl',
    hint: '支持 cmd / PowerShell / bash 三种转义风格，自动识别',
    inputs: [CURL_INPUT],
    options: [
      { id: 'session', type: 'toggle', label: '用 Session', value: false },
      { id: 'separateCookies', type: 'toggle', label: 'Cookies 单独变量', value: true },
      { id: 'name', type: 'text', label: '响应变量', value: 'response' },
      { id: 'width', type: 'number', label: '换行宽度', value: 100, min: 40, max: 200 },
      { id: 'comment', type: 'toggle', label: '加注释', value: true, title: '在顶部写入来源 URL / 方法等说明' },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input);
      const p = SK.net.parseCurl(raw);
      if (!p.ok) return { error: 'cURL 解析失败：' + (p.error ? p.error.message : '未知错误'), hint: '确认以 curl 开头，换行用 \\ 续行；PowerShell 的 ` 续行也支持' };
      const r = SK.net.toRequests(p, {
        session: !!opts.session,
        separateCookies: !!opts.separateCookies,
        name: opts.name || 'response',
        lineWidth: Number(opts.width || 100),
        comment: opts.comment ? 'source: ' + p.method + ' ' + p.url : null,
      });
      const fields = [
        { k: 'Method', v: p.method, copy: true },
        { k: 'URL', v: p.url, copy: true },
        { k: 'Shell', v: p.shell },
        { k: 'Headers', v: p.headers.length + ' 个' },
        { k: 'Cookies', v: (p.cookies || []).map((c) => c.name + '=' + c.value).join('; ') || '无', copy: true },
        { k: 'Body 类型', v: (p.body && p.body.kind) || 'none' },
        { k: 'Body', v: p.body && p.body.raw ? String(p.body.raw).slice(0, 2000) : '无', copy: true },
      ];
      if (p.options && p.options.proxy) fields.push({ k: 'Proxy', v: p.options.proxy, copy: true });
      fields.push({ k: '运行环境', v: SK.gen.ENV.requests.lang + ' · ' + SK.gen.ENV.requests.deps });
      const q = SK.gen.qualityBlock(p, r.code, 'requests');
      return {
        text: r.code,
        lang: 'python',
        stats: [
          { k: '方法', v: p.method },
          { k: 'Headers', v: p.headers.length },
          { k: 'Cookies', v: p.cookies.length },
          { k: 'Body', v: p.body && p.body.kind !== 'none' ? p.body.kind : '无' },
          { k: '保真', v: (q.fidelity.total - q.fidelity.missing) + '/' + q.fidelity.total, level: q.fidelity.missing ? 'warn' : 'ok' },
          { k: '语法', v: q.syntax.state },
        ],
        notices: q.notices.concat((r.warnings || []).concat(p.warnings || []).slice(0, 6).map((w) => ({ level: 'warn', msg: w.message || w }))),
        tabs: [
          q.tab,
          { label: '解析结果', view: 'fields', data: fields },
        ],
        filename: 'request',
      };
    },
  });

  SK.tool({
    id: 'curl-feapder',
    name: 'cURL 转 feapder',
    group: 'format',
    icon: '🕷',
    aliases: 'curl feapder spider 转换',
    keywords: ['curl', 'feapder', 'spider', 'python', '转换'],
    desc: '生成 feapder AirSpider 骨架：Request 参数、headers/cookies/data/json 全部就位，改两行就能跑',
    sample: 'curl',
    hint: 'feapder 的 Request 支持 json=、data=，比 requests 更好维护',
    inputs: [CURL_INPUT],
    options: [
      { id: 'name', type: 'text', label: 'Spider 名', value: '' , placeholder: '留空按域名自动生成' },
      { id: 'task', type: 'toggle', label: '生成 task 版', value: false, title: '生成 feapder.Task 批量导入格式' },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input);
      const p = SK.net.parseCurl(raw);
      if (!p.ok) return { error: 'cURL 解析失败：' + (p.error ? p.error.message : '未知错误') };
      const r = opts.task ? SK.net.toFeapderTask(p, { spiderName: opts.name || undefined }) : SK.net.toFeapder(p, { spiderName: opts.name || undefined });
      const q = SK.gen.qualityBlock(p, r.code, 'feapder', { separateCookies: false });
      return {
        text: r.code,
        lang: 'python',
        stats: [
          { k: '方法', v: p.method },
          { k: 'Headers', v: p.headers.length },
          { k: '保真', v: (q.fidelity.total - q.fidelity.missing) + '/' + q.fidelity.total, level: q.fidelity.missing ? 'warn' : 'ok' },
          { k: '语法', v: q.syntax.state },
          { k: '依赖', v: SK.gen.ENV.feapder.deps },
        ],
        notices: q.notices.concat((r.warnings || []).slice(0, 5).map((w) => ({ level: 'warn', msg: w.message || w }))),
        tabs: [q.tab],
        filename: 'spider',
      };
    },
  });

  SK.tool({
    id: 'curl-multi',
    name: 'cURL 转其他语言',
    group: 'format',
    icon: '⇄',
    aliases: 'curl scrapy fetch axios har 转换',
    keywords: ['curl', 'scrapy', 'fetch', 'axios', 'har', 'js', '转换'],
    desc: '一份 cURL 转 Scrapy / fetch / axios / HAR，方便对照排查“为什么代码请求不到、浏览器能”',
    sample: 'curl',
    inputs: [CURL_INPUT],
    options: [
      { id: 'target', type: 'seg', label: '目标', value: 'fetch', choices: [{ v: 'requests', label: 'requests' }, { v: 'httpx', label: 'httpx' }, { v: 'aiohttp', label: 'aiohttp' }, { v: 'scrapy', label: 'Scrapy' }, { v: 'fetch', label: 'fetch' }, { v: 'axios', label: 'axios' }, { v: 'har', label: 'HAR' }] },
      { id: 'mode', type: 'seg', label: 'JS 运行环境', value: 'node', choices: [{ v: 'node', label: 'Node 18+' }, { v: 'browser', label: '浏览器' }, { v: 'worker', label: 'Worker' }], title: '浏览器/Worker 里 Cookie 是 forbidden header，写了也被忽略，只能靠 credentials:"include"；Node 端必须原样带上 Cookie 头，否则登录态静默丢失' },
      { id: 'name', type: 'text', label: 'Spider/变量名', value: '' },
      { id: 'pretty', type: 'toggle', label: '格式化 JSON', value: true },
    ],
    onOptions: function (values, bar) {
      const js = values.target === 'fetch' || values.target === 'axios';
      (js ? bar.show : bar.hide)(['mode']);
    },
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input);
      const p = SK.net.parseCurl(raw);
      if (!p.ok) return { error: 'cURL 解析失败：' + (p.error ? p.error.message : '未知错误') };
      /* separateCookies 必须显式给值：net.js 的判定是 === false 才把 Cookie 写进头、
         === true 才生成独立 cookies 变量。传 undefined 等于两条路都不走 → 登录态静默丢失。 */
      /* mode 默认 node：爬虫脚本绝大多数跑在 Node，Cookie 头必须留着 */
      const o = { spiderName: opts.name || undefined, separateCookies: false, mode: opts.mode || 'node' };
      let r, lang = 'js';
      if (opts.target === 'requests') { r = SK.net.toRequests(p, o); lang = 'python'; }
      else if (opts.target === 'httpx') { r = SK.net.toHttpx(p, o); lang = 'python'; }
      else if (opts.target === 'aiohttp') { r = SK.net.toAiohttp(p, o); lang = 'python'; }
      else if (opts.target === 'scrapy') { r = SK.net.toScrapy(p, o); lang = 'python'; }
      else if (opts.target === 'axios') { r = SK.net.toAxios(p, o); lang = 'js'; }
      else if (opts.target === 'har') {
        /* toHar 可能直接返回对象；原实现只对字符串做 JSON.parse，对象会原样透出，
           渲染层拿到非字符串就一片空白。这里统一转成格式化后的字符串。 */
        const h = SK.net.toHar(p);
        r = { code: typeof h === 'string' ? h : JSON.stringify(h, null, 2), warnings: [] };
        lang = 'json';
        try { r.code = JSON.stringify(JSON.parse(r.code), null, 2); } catch (e) {}
      } else { r = SK.net.toFetch(p, o); lang = 'js'; }
      const out = typeof r.code === 'string' ? r.code : JSON.stringify(r.code, null, 2);
      const env = SK.gen.ENV[opts.target];
      /* HAR 是结构化数据，不做「代码里是否出现」这种文本保真检查 */
      if (opts.target === 'har' || !env) {
        return { text: out, lang: lang, notices: (r.warnings || []).slice(0, 5).map((w) => ({ level: 'warn', msg: w.message || w })), stats: [{ k: '目标', v: opts.target }] };
      }
      const q = SK.gen.qualityBlock(p, out, opts.target, { separateCookies: false });
      return {
        text: out,
        lang: lang,
        notices: q.notices.concat((r.warnings || []).slice(0, 5).map((w) => ({ level: 'warn', msg: w.message || w }))),
        stats: [
          { k: '目标', v: opts.target },
          { k: '环境', v: env.lang + ' / ' + env.where },
          { k: '依赖', v: env.deps },
          { k: '保真', v: (q.fidelity.total - q.fidelity.missing) + '/' + q.fidelity.total, level: q.fidelity.missing ? 'warn' : 'ok' },
          { k: '语法', v: q.syntax.state },
        ],
        tabs: [q.tab],
      };
    },
  });

  SK.tool({
    id: 'har-curl',
    name: 'HAR 转 cURL',
    group: 'format',
    icon: '↺',
    aliases: 'har curl 转换 复制',
    keywords: ['har', 'curl', '转换', 'devtools'],
    desc: '把 DevTools 导出的 HAR 里任意一条请求还原成 cURL，支持整份 HAR（取第一条请求）',
    inputs: [{ id: 'in', label: 'HAR / 单条 entry JSON', placeholder: '{"log":{"entries":[…]}}', sample: 'har' }],
    options: [
      { id: 'pretty', type: 'toggle', label: '多行输出', value: true },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { error: 'HAR JSON 解析失败：' + e.message };
      }
      let entry = data;
      if (data.log && data.log.entries) {
        if (!data.log.entries.length) return { error: 'HAR 里没有条目' };
        entry = data.log.entries[0];
      }
      if (!entry || !entry.request) return { error: '不是有效的 HAR entry', hint: '需要包含 request 字段，或整份 HAR（log.entries）' };
      const req = SK.net.fromHarEntry(entry);
      const curl = SK.net.formatCurl(req, { pretty: !!opts.pretty });
      return {
        text: curl,
        lang: 'shell',
        stats: [{ k: '方法', v: entry.request.method }, { k: 'URL', v: String(entry.request.url).slice(0, 80) }],
        tabs: [{ label: '请求信息', view: 'fields', data: [
          { k: 'URL', v: entry.request.url, copy: true },
          { k: 'Method', v: entry.request.method },
          { k: 'Headers', v: (SK.harUtils ? SK.harUtils.toArr(entry.request.headers).length : (Array.isArray(entry.request.headers) ? entry.request.headers.length : Object.keys(entry.request.headers || {}).length)) + ' 个' },
          { k: 'Cookies', v: (entry.request.cookies || []).map((c) => c.name + '=' + c.value).join('; '), copy: true },
          { k: 'Status', v: entry.response ? entry.response.status : '-' },
        ] }],
      };
    },
  });

  SK.tool({
    id: 'json-sql',
    name: 'JSON 转 SQL',
    group: 'format',
    icon: 'SQL',
    aliases: 'json sql 建表 insert mysql postgres sqlite',
    keywords: ['json', 'sql', '建表', 'insert', 'mysql', 'postgres', 'sqlite'],
    desc: 'JSON 数组 → 建表语句 + 批量 INSERT，自动推断字段类型、合并并集字段、处理嵌套 JSON 与 NULL',
    sample: 'json',
    hint: '嵌套对象/数组默认写成 JSON 文本，方便后续用 JSON 函数查询',
    inputs: [{ id: 'in', label: 'JSON 数据（数组或含 list 的对象）', placeholder: '[{"id":1,"name":"a"}]', sample: 'json' }],
    options: [
      { id: 'dialect', type: 'seg', label: '方言', value: 'mysql', choices: [{ v: 'mysql', label: 'MySQL' }, { v: 'postgres', label: 'PostgreSQL' }, { v: 'sqlite', label: 'SQLite' }] },
      { id: 'table', type: 'text', label: '表名', value: 't_items' },
      { id: 'batch', type: 'number', label: '每批行数', value: 100, min: 1, max: 1000 },
      { id: 'create', type: 'toggle', label: '生成建表', value: true },
      { id: 'pk', type: 'toggle', label: '加自增主键', value: true },
      { id: 'nest', type: 'toggle', label: '嵌套转 JSON', value: true, title: '关闭则把嵌套对象展开成扁平列 a_b_c' },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      let data;
      try {
        /* B16：旧实现用正则把 16 位以上数字套上引号，遇到「字符串里嵌了一层 JSON」
           （{\"n\":1234567890123456}）会在字符串内部插入裸引号，直接把 JSON 改坏。
           改用保真解析：大整数以 BigInt 承载，既不丢精度也不动原文。 */
        const p = SK.jsonx ? SK.jsonx.parse(text) : { value: JSON.parse(text), engine: 'native' };
        if (p.error) throw p.error;
        data = p.value;
      } catch (e) {
        return { error: 'JSON 解析失败：' + e.message, hint: '先用「JSON 格式化 → 修复」处理脏数据' };
      }
      let rows = null;
      if (Array.isArray(data)) rows = data;
      else if (data && typeof data === 'object') {
        const keys = ['list', 'data', 'items', 'rows', 'result', 'records'];
        for (const k of keys) {
          if (Array.isArray(data[k])) { rows = data[k]; break; }
          if (data[k] && Array.isArray(data[k].list)) { rows = data[k].list; break; }
        }
        if (!rows) {
          for (const k of Object.keys(data)) if (Array.isArray(data[k]) && data[k].length && typeof data[k][0] === 'object') { rows = data[k]; break; }
        }
        if (!rows) rows = [data];
      }
      if (!rows || !rows.length) return { error: '没有可转换的数组数据', hint: 'JSON 顶层需要是数组，或对象里含 list/data/items 数组' };
      rows = rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
      if (!rows.length) return { error: '数组元素不是对象', hint: '只支持对象数组，标量数组请先包一层 {value: x}' };

      const cols = [];
      /* 用无原型对象做索引：字段名叫 toString / constructor / __proto__ 时
         colSet[name] 会命中 Object.prototype 上的同名成员而被当成「已存在」丢掉 */
      const colSet = Object.create(null);
      const addCol = (name, sample) => {
        const len = String(sample == null ? '' : typeof sample === 'bigint' ? String(sample) : typeof sample === 'object' ? JSON.stringify(sample) : sample).length;
        const hit = Object.prototype.hasOwnProperty.call(colSet, name) ? colSet[name] : null;
        if (hit) {
          /* VARCHAR 长度必须取全量最大值：只看第一行会把后面更长的值截断 */
          if (len > hit.max) hit.max = len;
          return;
        }
        const c = { name: name, type: typeOf(sample), max: len };
        colSet[name] = c;
        cols.push(c);
      };
      function typeOf(v) {
        if (v === null || v === undefined) return 'TEXT';
        if (typeof v === 'bigint') return 'BIGINT';
        if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? 'BIGINT' : 'INT') : 'DOUBLE';
        if (typeof v === 'boolean') return 'TINYINT';
        if (typeof v === 'object') return opts.nest ? 'JSON' : 'TEXT';
        return 'VARCHAR';
      }
      const flat = [];
      const visit = (obj, prefix) => {
        const out = {};
        for (const k in obj) {
          const v = obj[k];
          const name = prefix ? prefix + '_' + k : k;
          if (opts.nest && v && typeof v === 'object') {
            out[name] = v;
            addCol(name, v);
          } else if (!opts.nest && v && typeof v === 'object' && !Array.isArray(v)) {
            const sub = visit(v, name);
            Object.assign(out, sub);
          } else {
            out[name] = v;
            addCol(name, v);
          }
        }
        return out;
      };
      for (const r of rows) flat.push(visit(r, ''));
      // 补齐缺列（用 hasOwnProperty：`in` 会把原型链上的 toString/constructor 当成已有列）
      for (const r of flat) for (const c of cols) if (!Object.prototype.hasOwnProperty.call(r, c.name)) r[c.name] = null;

      const d = opts.dialect;
      const q = (n) => (d === 'mysql' ? '`' + n + '`' : '"' + n + '"');
      /* \w 只覆盖 ASCII，中文表名会被整段替换成 ___。用 Unicode 感知的字符类。 */
      const table = String(opts.table || 't_items').replace(/[^\p{L}\p{N}_$]/gu, '_');
      const lines = [];
      const typeMap = (c) => {
        if (c.type === 'VARCHAR') {
          const n = Math.max(32, Math.min(2000, Math.ceil(c.max * 1.5) + 16));
          return d === 'postgres' ? 'VARCHAR(' + n + ')' : 'VARCHAR(' + n + ')';
        }
        if (c.type === 'JSON') return d === 'postgres' ? 'JSONB' : d === 'mysql' ? 'JSON' : 'TEXT';
        if (c.type === 'TINYINT') return d === 'postgres' ? 'BOOLEAN' : 'TINYINT(1)';
        if (c.type === 'DOUBLE') return d === 'postgres' ? 'DOUBLE PRECISION' : d === 'mysql' ? 'DOUBLE' : 'REAL';
        if (c.type === 'BIGINT') return 'BIGINT';
        if (c.type === 'INT') return 'INT';
        return 'TEXT';
      };
      if (opts.create) {
        lines.push('-- 由 SpiderLab 生成（' + rows.length + ' 行 / ' + cols.length + ' 列）');
        lines.push('CREATE TABLE IF NOT EXISTS ' + q(table) + ' (');
        const defs = [];
        if (opts.pk) {
          /* 数据里已经有 id 列时再补主键会得到重复列，SQL 直接执行失败。
             有 id 就复用它当主键，没有才新增。 */
          const hasId = cols.some((c) => String(c.name).toLowerCase() === 'id');
          if (hasId) {
            const idCol = cols.find((c) => String(c.name).toLowerCase() === 'id');
            idCol._pk = true;
          } else {
            defs.push('  ' + q('id') + (d === 'mysql' ? ' BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY' : d === 'postgres' ? ' BIGSERIAL PRIMARY KEY' : ' INTEGER PRIMARY KEY AUTOINCREMENT'));
          }
        }
        cols.forEach((c) => defs.push('  ' + q(c.name) + ' ' + typeMap(c) + (c._pk ? ' PRIMARY KEY' : '')));
        lines.push(defs.join(',\n'));
        lines.push(');');
        lines.push('');
      }
      /* 字符串转义按方言区分：
         MySQL 默认把 \ 当转义符，必须写成 \\；
         PostgreSQL（standard_conforming_strings=on）与 SQLite 里 \ 就是普通字符，
         再翻倍一次会让 C:\path 这种数据插进去就变了。 */
      const needBackslashEscape = d === 'mysql';
      const qStr = (s) => "'" + String(s).replace(/'/g, "''").replace(needBackslashEscape ? /\\/g : /(?!)/g, '\\\\') + "'";
      const esc = (v, type) => {
        if (v === null || v === undefined) return 'NULL';
        if (type === 'JSON') return qStr(SK.jsonx && SK.jsonx.dump ? SK.jsonx.dump(v, 0) : JSON.stringify(v));
        if (typeof v === 'bigint') return String(v); /* 大整数原样输出，不加引号 */
        if (typeof v === 'number') return String(v);
        if (typeof v === 'boolean') return d === 'postgres' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0';
        return qStr(v);
      };
      const batch = Math.max(1, Math.min(1000, Number(opts.batch || 100)));
      for (let i = 0; i < flat.length; i += batch) {
        const chunk = flat.slice(i, i + batch);
        const values = chunk.map((r) => '(' + cols.map((c) => esc(r[c.name], c.type)).join(', ') + ')').join(',\n  ');
        lines.push('INSERT INTO ' + q(table) + ' (' + cols.map((c) => q(c.name)).join(', ') + ') VALUES\n  ' + values + ';');
      }
      return {
        text: lines.join('\n'),
        lang: 'sql',
        stats: [{ k: '行', v: rows.length }, { k: '列', v: cols.length }, { k: '方言', v: d }],
        tabs: [{ label: '字段', view: 'table', data: { columns: [{ key: 'name', label: '字段' }, { key: 'type', label: '推断类型', width: '120px' }, { key: 'max', label: '最长值', width: '90px' }], rows: cols, name: 'columns' } }],
        filename: table,
      };
    },
  });
})();
