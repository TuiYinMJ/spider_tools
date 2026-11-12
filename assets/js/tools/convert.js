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
    help:
      '<h4>粘什么</h4>' +
      '<p>Chrome DevTools → Network → 右键请求 → Copy as cURL（bash / cmd / PowerShell 都支持），直接贴进来。工具会自动拆 query、headers、cookie、json / form / multipart 请求体。</p>' +
      '<h4>选项</h4>' +
      '<ul><li><b>用 Session</b>：生成 <code>requests.Session()</code>，适合连续请求保持 Cookie</li>' +
      '<li><b>Cookies 单独变量</b>：Cookie 从 headers 里拆出来，方便单独改</li>' +
      '<li><b>响应变量 / 换行宽度 / 加注释</b>：控制生成代码的可读性</li></ul>' +
      '<h4>保真检查</h4>' +
      '<p>生成后会逐项核对 URL、方法、Header、Cookie、Body 是否带全；UA-CH（sec-ch-ua 等）缺失会提示。它是「代码文本的保真」，不等于目标站点一定放行；登录态、签名、风控仍要在目标环境验证。</p>',
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
    help:
      '<h4>两种产物</h4>' +
      '<ul><li><b>AirSpider</b>（默认）：一个可直接改 <code>start_requests</code> / <code>parse</code> 的爬虫类，适合单接口调试</li>' +
      '<li><b>task 版</b>：生成 <code>feapder.Task</code> 批量导入格式，适合把一批请求塞进任务队列</li></ul>' +
      '<h4>依赖与限制</h4>' +
      '<p>产物需要本机装 <code>feapder</code> 才能跑；请求里的 headers / cookies / data / json 会按 cURL 原样生成。生成的是骨架，解析字段和翻页逻辑仍要你按真实响应补。</p>',
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
    hint: 'Node 下保留 Cookie 头；浏览器 / Worker 下 Cookie 是禁用头，只能靠 credentials:"include"',
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
    help:
      '<h4>目标怎么选</h4>' +
      '<ul><li><b>requests / httpx / aiohttp / Scrapy</b>：Python 运行时，Cookie 会写进 headers 或独立变量</li>' +
      '<li><b>fetch / axios</b>：切到「浏览器 / Worker」时 Cookie 是 forbidden header，只能靠 <code>credentials:"include"</code>；Node 18+ 保留 Cookie 头</li>' +
      '<li><b>HAR</b>：把 cURL 转成一条 HAR entry，方便导入 DevTools / 回放工具</li></ul>' +
      '<p>「格式化 JSON」控制生成代码里的 JSON 请求体缩进；关闭后输出单行，适合贴进压缩过的脚本。保真检查会列出 Cookie、Header、Body 等是否完整带过去。</p>',
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input);
      const p = SK.net.parseCurl(raw);
      if (!p.ok) return { error: 'cURL 解析失败：' + (p.error ? p.error.message : '未知错误') };
      /* separateCookies 必须显式给值：net.js 的判定是 === false 才把 Cookie 写进头、
         === true 才生成独立 cookies 变量。传 undefined 等于两条路都不走 → 登录态静默丢失。 */
      /* mode 默认 node：爬虫脚本绝大多数跑在 Node，Cookie 头必须留着 */
      const pretty = opts.pretty !== false;
      const o = { spiderName: opts.name || undefined, separateCookies: false, mode: opts.mode || 'node', prettyJson: pretty };
      let r, lang = 'js';
      if (opts.target === 'requests') { r = SK.net.toRequests(p, o); lang = 'python'; }
      else if (opts.target === 'httpx') { r = SK.net.toHttpx(p, o); lang = 'python'; }
      else if (opts.target === 'aiohttp') { r = SK.net.toAiohttp(p, o); lang = 'python'; }
      else if (opts.target === 'scrapy') { r = SK.net.toScrapy(p, o); lang = 'python'; }
      else if (opts.target === 'axios') { r = SK.net.toAxios(p, o); lang = 'js'; }
      else if (opts.target === 'har') {
        /* toHar 可能直接返回对象；原实现只对字符串做 JSON.parse，对象会原样透出，
           渲染层拿到非字符串就一片空白。这里统一转成字符串，并让「格式化 JSON」真正生效。 */
        const h = SK.net.toHar(p);
        let code;
        if (typeof h === 'string') {
          try { code = JSON.stringify(JSON.parse(h), null, pretty ? 2 : 0); } catch (e) { code = h; }
        } else {
          code = JSON.stringify(h, null, pretty ? 2 : 0);
        }
        r = { code: code, warnings: [] };
        lang = 'json';
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
    desc: '把 DevTools 导出的 HAR 里任意一条请求还原成 cURL：支持整份 HAR、URL/方法过滤和选择第几条，不再只能取第一条',
    hint: '整份 HAR 可先按 URL/方法过滤，再选第几条；「请求列表」页签能看到全部候选',
    inputs: [{ id: 'in', label: 'HAR / 单条 entry JSON', placeholder: '{"log":{"entries":[…]}}', sample: 'har' }],
    options: [
      { id: 'filter', type: 'text', label: '请求过滤', value: '', placeholder: 'URL 或方法，如 api.example.com / POST' },
      { id: 'index', type: 'number', label: '选第几条（匹配后）', value: 1, min: 1, max: 100000, title: '从 1 开始；先用过滤缩小范围，再看「请求列表」确认顺序' },
      { id: 'pretty', type: 'toggle', label: '多行 cURL', value: true },
    ],
    help:
      '<h4>从整份 HAR 里挑请求</h4>' +
      '<p>默认按 HAR 顺序取第 1 条。请求很多时先填「请求过滤」（URL 片段或方法，如 <code>api.example.com</code> / <code>POST</code>），再用「选第几条」选中匹配后的第 N 条。</p>' +
      '<p>「请求列表」页签会列出所有匹配请求的序号、方法、URL 和状态码，照着序号填即可。也可以直接贴单条 entry JSON。</p>' +
      '<p>多行 cURL 关闭后输出单行，方便贴进脚本或聊天窗口。</p>',
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { error: 'HAR JSON 解析失败：' + e.message };
      }
      let entries = null;
      if (data && data.log && Array.isArray(data.log.entries)) entries = data.log.entries;
      else if (data && Array.isArray(data.entries)) entries = data.entries;
      else if (data && data.request) entries = [data];
      if (!entries || !entries.length) return { error: 'HAR 里没有条目', hint: '支持整份 HAR（log.entries）或单条 entry（含 request 字段）' };

      const kw = String(opts.filter || '').trim().toLowerCase();
      const matched = kw
        ? entries.filter((e) => {
            const r = e && e.request;
            return r && ((String(r.url || '') + ' ' + String(r.method || '')).toLowerCase().indexOf(kw) >= 0);
          })
        : entries.slice();
      if (!matched.length) return { error: '过滤后没有匹配请求', hint: '换个关键字，或清空「请求过滤」选择全部' };

      let idx = Number(opts.index || 1);
      if (!isFinite(idx)) idx = 1;
      idx = Math.max(1, Math.min(matched.length, Math.floor(idx)));
      const entry = matched[idx - 1];
      if (!entry || !entry.request) return { error: '第 ' + idx + ' 条不是有效的 HAR entry' };
      const req = SK.net.fromHarEntry(entry);
      const curl = SK.net.formatCurl(req, { pretty: !!opts.pretty });
      const list = matched.slice(0, 500).map((e, i) => ({
        i: i + 1,
        method: (e.request && e.request.method) || '',
        url: (e.request && e.request.url) || '',
        status: e.response && e.response.status != null ? e.response.status : '',
      }));
      const headCount = (e) => {
        const h = e.request.headers;
        return Array.isArray(h) ? h.length : Object.keys(h || {}).length;
      };
      return {
        text: curl,
        lang: 'shell',
        stats: [
          { k: '全部', v: entries.length },
          kw ? { k: '匹配', v: matched.length } : null,
          { k: '选中', v: '#' + idx, level: 'ok' },
          { k: '方法', v: entry.request.method || '-' },
        ].filter(Boolean),
        notices: matched.length > 1
          ? [{ level: 'info', msg: '匹配到 ' + matched.length + ' 条请求，当前选第 ' + idx + ' 条；可在「请求列表」页签确认序号，或改「选第几条」' }]
          : [],
        tabs: [
          { label: '请求信息', view: 'fields', data: [
            { k: 'URL', v: entry.request.url, copy: true },
            { k: 'Method', v: entry.request.method },
            { k: 'Headers', v: headCount(entry) + ' 个' },
            { k: 'Cookies', v: (entry.request.cookies || []).map((c) => c.name + '=' + c.value).join('; '), copy: true },
            { k: 'Status', v: entry.response ? entry.response.status : '-' },
          ] },
          { label: '请求列表 (' + matched.length + ')', view: 'table', data: {
            columns: [
              { key: 'i', label: '#', width: '60px' },
              { key: 'method', label: '方法', width: '80px' },
              { key: 'url', label: 'URL' },
              { key: 'status', label: '状态', width: '80px' },
            ],
            rows: list,
            name: 'har-requests',
            filterHint: '过滤 URL / 方法（例：api / POST）',
          } },
        ],
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
