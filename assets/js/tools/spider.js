/* 爬虫工程：选择器测试 / URL 批处理 / robots / UA / 编码修复 */
(function () {

  SK.tool({
    id: 'selector',
    name: 'XPath / CSS 选择器',
    group: 'spider',
    icon: '⌕',
    aliases: 'selector xpath css 选择器 测试 提取',
    keywords: ['xpath', 'css', 'selector', '选择器', '匹配', '提取', '爬虫'],
    desc: '在真实 DOM 上测试 XPath / CSS 选择器，直接看到匹配数量、文本、属性与 HTML，采集规则先在这里验证',
    sample: 'html',
    inline: true,
    hint: '先贴 HTML，再填选择器；支持 //div[@class="a"]/text() 这类 XPath',
    help:
      '<h4>怎么判断我该写哪种</h4>' +
      '<p>以 <code>//</code> 或 <code>/</code> 开头按 <b>XPath</b> 解析，否则按 <b>CSS</b>。拿不准就用「自动」，本工具会自己判断。Python 里 XPath 对应 lxml/parsel 的 <code>.xpath()</code>，CSS 对应 <code>.css()</code> 或 BeautifulSoup 的 <code>select()</code>。</p>' +
      '<h4>XPath 速查</h4>' +
      '<table><tr><th>写法</th><th>含义</th></tr>' +
      '<tr><td><code>//div</code></td><td>任意位置的 div（<code>/</code> 则是直接子级）</td></tr>' +
      '<tr><td><code>//div[@class="card"]</code></td><td>class 完全等于 card 的 div</td></tr>' +
      '<tr><td><code>//*[contains(@class,"card")]</code></td><td>class <b>包含</b> card 的任意元素（最常用，不怕多 class）</td></tr>' +
      '<tr><td><code>//a/@href</code></td><td>取 a 标签的 href 属性值</td></tr>' +
      '<tr><td><code>//div/text()</code></td><td>取文本节点</td></tr>' +
      '<tr><td><code>//a[text()="下一页"]</code></td><td>按文本找元素</td></tr>' +
      '<tr><td><code>//*[starts-with(@id,"item")]</code></td><td>属性以 item 开头</td></tr>' +
      '<tr><td><code>//h3/span[1]</code></td><td>第 1 个 span（下标从 1 开始）</td></tr>' +
      '<tr><td><code>//div/span[last()]</code></td><td>最后一个</td></tr>' +
      '<tr><td><code>//li[@class="x"]/following-sibling::li</code></td><td>后面的兄弟节点（<code>preceding-sibling</code> 是前面）</td></tr>' +
      '<tr><td><code>//div[@id="main"]//a</code></td><td>main 里所有 a（中间隔多少层都算）</td></tr>' +
      '<tr><td><code>//a[contains(@href,"detail")]/parent::div</code></td><td>父节点（<code>ancestor::</code> 是所有祖先）</td></tr>' +
      '<tr><td><code>string(//h1)</code></td><td>取整段文本结果（本工具支持）</td></tr></table>' +
      '<h4>CSS 选择器速查</h4>' +
      '<table><tr><th>写法</th><th>含义</th></tr>' +
      '<tr><td><code>div.card</code></td><td>class 含 card 的 div</td></tr>' +
      '<tr><td><code>div#main</code></td><td>id 为 main 的 div</td></tr>' +
      '<tr><td><code>div &gt; a</code></td><td>直接子级 a（空格则是任意后代）</td></tr>' +
      '<tr><td><code>div a:nth-child(2)</code></td><td>第 2 个子元素（下标从 1 开始）</td></tr>' +
      '<tr><td><code>a[href^="https"]</code></td><td>属性以 https 开头</td></tr>' +
      '<tr><td><code>a[href$=".pdf"]</code></td><td>属性以 .pdf 结尾</td></tr>' +
      '<tr><td><code>a[href*="detail"]</code></td><td>属性包含 detail</td></tr>' +
      '<tr><td><code>li:not(.active)</code></td><td>排除</td></tr>' +
      '<tr><td><code>div:has(&gt; img)</code></td><td>包含直接 img 子级的 div</td></tr>' +
      '<tr><td><code>td + td</code></td><td>紧跟在另一个 td 后面的（相邻兄弟）</td></tr></table>' +
      '<h4>踩坑提示</h4>' +
      '<ul><li>页面上的元素常常是 JS 动态渲染的——「查看网页源代码」里找不到的 class，要用 DevTools 的 Elements 面板确认，请求接口往往比解析 HTML 更省事</li>' +
      '<li>XPath 的 <code>@[class="a b"]</code> 要求完全相等，多 class 元素用 <code>contains()</code></li>' +
      '<li>CSS 取不到「文本」和「父节点」，需要这两种就换 XPath</li>' +
      '<li>Chrome DevTools 里 <code>$x("//div")</code> 可以直接试 XPath，<code>$$("div")</code> 试 CSS</li></ul>',
    inputs: [
      { id: 'in', label: 'HTML', placeholder: '粘贴页面源码', sample: 'html' },
      { id: 'sel', label: '选择器（XPath 或 CSS）', placeholder: '//li[@class="card"] 或 li.card a', small: true, sample: 'css-sel' },
    ],
    options: [
      { id: 'type', type: 'seg', label: '类型', value: 'auto', choices: [{ v: 'auto', label: '自动' }, { v: 'css', label: 'CSS' }, { v: 'xpath', label: 'XPath' }] },
      { id: 'attr', type: 'text', label: '取属性', value: '', placeholder: '留空取文本；可填 href / data-id' },
      { id: 'limit', type: 'number', label: '最多', value: 500, min: 1, max: 20000 },
    ],
    handler: function (html, sel, opts) {
      const src = String(html == null ? '' : html);
      const q = String(sel == null ? '' : sel).trim();
      if (!src.trim()) return { error: 'HTML 为空' };
      if (!q) return { error: '请填写选择器' };
      const doc = new DOMParser().parseFromString(src, 'text/html');
      /* 自动判型必须覆盖 XPath 的函数式写法：帮助里明确写了支持 string(//h1)，
         但旧正则只认 ^( / // ./ id( )，string(…)/count(…)/normalize-space(…) 全被判成 CSS，
         然后报一句 "not a valid selector" —— 用户会以为是自己的式子写错了。 */
      const isXpath = opts.type === 'xpath' || (opts.type === 'auto' && /^\(*\s*([/.]|id\(|(string|count|normalize-space|concat|boolean|number|sum|local-name|name)\s*\()/.test(q));
      const limit = Number(opts.limit || 500);
      let nodes = [];
      try {
        if (isXpath) {
          /* 标量 XPath（string()/count()/boolean()）必须走 STRING/NUMBER/BOOLEAN 求值，
             SNAPSHOT 会直接抛类型错误 */
          const scalar = /^\s*(string|count|normalize-space|concat|boolean|number|sum|local-name|name)\s*\(/i.exec(q);
          if (scalar) {
            const fn = scalar[1].toLowerCase();
            const type = fn === 'count' || fn === 'number' || fn === 'sum' ? XPathResult.NUMBER_TYPE
              : fn === 'boolean' ? XPathResult.BOOLEAN_TYPE
                : XPathResult.STRING_TYPE;
            const out = doc.evaluate(q, doc, null, type, null);
            const value = type === XPathResult.NUMBER_TYPE ? out.numberValue
              : type === XPathResult.BOOLEAN_TYPE ? out.booleanValue
                : out.stringValue;
            return {
              text: String(value),
              lang: 'text',
              tabs: [{ label: '标量结果', view: 'fields', data: [{ k: q, v: String(value), copy: true }] }],
              stats: [{ k: '结果', v: String(value).slice(0, 60) }, { k: '类型', v: 'XPath 标量' }],
            };
          }
          const res = doc.evaluate(q, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < Math.min(limit, res.snapshotLength); i++) nodes.push(res.snapshotItem(i));
          if (!res.snapshotLength) {
            const any = doc.evaluate('string(' + q + ')', doc, null, XPathResult.STRING_TYPE, null);
            if (any && any.stringValue) {
              return { text: any.stringValue, lang: 'text', stats: [{ k: '模式', v: 'XPath 字符串结果' }] };
            }
          }
        } else {
          nodes = Array.prototype.slice.call(doc.querySelectorAll(q), 0, limit);
        }
      } catch (e) {
        return { error: '选择器语法错误：' + e.message, hint: 'XPath 以 // 或 / 开头；CSS 直接写 div.a > span' };
      }
      if (!nodes.length) return { error: '没有匹配到节点', hint: '检查 class 是否被 JS 动态渲染；可以用 //*[contains(@class,"card")] 放宽条件' };
      const attr = String(opts.attr || '').trim();
      const rows = nodes.map((n, i) => {
        let value = '';
        if (n.nodeType === 1) {
          value = attr ? (n.getAttribute(attr) || '') : (n.textContent || '').replace(/\s+/g, ' ').trim();
        } else {
          value = String(n.nodeValue || n.textContent || '').trim();
        }
        return {
          i: i + 1,
          tag: n.nodeType === 1 ? n.tagName.toLowerCase() : '#text',
          value: value.length > 300 ? value.slice(0, 300) + '…' : value,
          html: n.nodeType === 1 ? n.outerHTML.slice(0, 200).replace(/\s+/g, ' ') : '',
        };
      });
      const text = rows.map((r) => r.value).join('\n');
      return {
        text: text,
        lang: 'text',
        tabs: [{ label: '节点 (' + rows.length + ')', view: 'table', data: { columns: [{ key: 'i', label: '#', width: '54px' }, { key: 'tag', label: '标签', width: '90px' }, { key: 'value', label: attr ? '@' + attr : '文本' }, { key: 'html', label: 'HTML 片段' }], rows: rows, name: 'selector' } }],
        stats: [{ k: '匹配', v: rows.length }, { k: '类型', v: isXpath ? 'XPath' : 'CSS' }],
      };
    },
  });

  SK.tool({
    id: 'url-batch',
    name: 'URL 批处理',
    group: 'spider',
    icon: '≣',
    aliases: 'url batch 批量 去重 域名 提取 过滤',
    keywords: ['url', '批量', '去重', '域名', '提取', '过滤', '爬虫'],
    desc: '批量清洗 URL：去重、提取域名/路径、按关键字或正则过滤、加前缀、替换参数、排序，采集种子一步到位',
    sample: 'urls',
    inputs: [{ id: 'in', label: 'URL 列表', placeholder: '一行一个 URL', sample: 'urls' }],
    options: [
      { id: 'op', type: 'select', label: '操作', value: 'dedupe', choices: [
        { v: 'dedupe', label: '去重（保序）' },
        { v: 'dedupeHost', label: '按域名去重' },
        { v: 'hosts', label: '提取域名' },
        { v: 'paths', label: '提取路径' },
        { v: 'filter', label: '按关键字过滤' },
        { v: 'exclude', label: '排除关键字' },
        { v: 'regex', label: '按正则过滤' },
        { v: 'prefix', label: '加前缀' },
        { v: 'stripQuery', label: '去掉 query' },
        { v: 'stripHash', label: '去掉 #' },
        { v: 'param', label: '只保留某参数' },
        { v: 'sort', label: '排序' },
        { v: 'valid', label: '过滤非法 URL' },
      ] },
      { id: 'arg', type: 'text', label: '参数', value: '', placeholder: '关键字 / 正则 / 前缀 / 参数名' },
    ],
    handler: function (input, opts) {
      const lines = String(input == null ? '' : input).split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return { error: '没有 URL' };
      const arg = String(opts.arg || '').trim();
      let out = lines.slice();
      let badCount = 0;
      const needArg = ['filter', 'exclude', 'regex', 'prefix', 'param'].includes(opts.op);
      if (needArg && !arg) return { error: '该操作需要填写「参数」', hint: '关键字 / 正则 / 前缀 / 参数名' };
      switch (opts.op) {
        case 'dedupe': out = Array.from(new Set(lines)); break;
        case 'dedupeHost': {
          const seen = {};
          out = [];
          lines.forEach((u) => {
            let h = u;
            try { h = new URL(u).hostname; } catch (e) {}
            if (!seen[h]) { seen[h] = 1; out.push(u); }
          });
          break;
        }
        case 'hosts': out = Array.from(new Set(lines.map((u) => { try { return new URL(u).hostname; } catch (e) { return ''; } }).filter(Boolean))); break;
        case 'paths': out = lines.map((u) => { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return u; } }); break;
        case 'filter': out = lines.filter((u) => u.indexOf(arg) >= 0); break;
        case 'exclude': out = lines.filter((u) => u.indexOf(arg) < 0); break;
        case 'regex': {
          let re;
          try { re = new RegExp(arg); } catch (e) { return { error: '正则不合法：' + e.message }; }
          out = lines.filter((u) => re.test(u));
          break;
        }
        case 'prefix': out = lines.map((u) => (/^https?:\/\//.test(u) ? u : arg.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, ''))); break;
        case 'stripQuery': out = lines.map((u) => u.split('?')[0]); break;
        case 'stripHash': out = lines.map((u) => u.split('#')[0]); break;
        case 'param': {
          out = lines.map((u) => {
            try {
              const x = new URL(u);
              const v = x.searchParams.get(arg);
              return v === null ? '' : v;
            } catch (e) { return ''; }
          }).filter((v) => v !== '');
          break;
        }
        case 'sort': out = lines.slice().sort(); break;
        case 'valid': {
          const bad = [];
          out = lines.filter((u) => {
            try { const x = new URL(u); const ok = /^https?:$/.test(x.protocol) && x.hostname.indexOf('.') > 0; if (!ok) bad.push(u); return ok; } catch (e) { bad.push(u); return false; }
          });
          badCount = bad.length;
          break;
        }
        default: out = lines;
      }
      const text = out.join('\n');
      return {
        text: text,
        lang: 'text',
        stats: [{ k: '输入', v: lines.length }, { k: '输出', v: out.length }, out.length !== lines.length ? { k: '变化', v: (out.length - lines.length > 0 ? '+' : '') + (out.length - lines.length) } : null].filter(Boolean),
        notices: out.length === 0 ? [{ level: 'warn', msg: '结果为空：条件可能过严' }] : badCount ? [{ level: 'info', msg: '已剔除 ' + badCount + ' 条非法 URL（协议非 http/https 或域名缺少）' }] : null,
        filename: 'urls',
      };
    },
  });

  SK.tool({
    id: 'robots',
    name: 'robots.txt 解析',
    group: 'spider',
    icon: '🤖',
    aliases: 'robots 协议 爬虫 规则 allow disallow sitemap',
    keywords: ['robots', 'robots.txt', '允许', '禁止', 'sitemap', '爬虫', '合规'],
    desc: '按 UA 解析 robots.txt 的 Allow / Disallow 规则、Crawl-delay 与 Sitemap，并能直接测试某个路径是否允许抓取',
    sample: 'robots',
    inputs: [{ id: 'in', label: 'robots.txt', placeholder: 'User-agent: *\nDisallow: /admin', sample: 'robots' }],
    options: [
      { id: 'ua', type: 'select', label: 'User-Agent', value: '*', choices: [{ v: '*', label: '* 通用' }, { v: 'googlebot', label: 'Googlebot' }, { v: 'baiduspider', label: 'Baiduspider' }, { v: 'bingbot', label: 'Bingbot' }] },
      { id: 'path', type: 'text', label: '测试路径', value: '', placeholder: '/item/123' },
    ],
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      const lines = text.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
      const groups = [];
      let cur = null;
      for (const line of lines) {
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'user-agent') {
          if (!cur || cur.rules.length) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
          cur.agents.push(val.toLowerCase());
          continue;
        }
        if (!cur) { cur = { agents: ['*'], rules: [], delay: null }; groups.push(cur); }
        if (key === 'allow' || key === 'disallow') cur.rules.push({ type: key, path: val });
        else if (key === 'crawl-delay') cur.delay = val;
        else if (key === 'sitemap') (groups.sitemaps = groups.sitemaps || []).push(val);
        else if (key === 'host') cur.host = val;
        else if (key === 'clean-param') (groups.cleanParams = groups.cleanParams || []).push(val);
        else if (key === 'request-rate') cur.rate = val;
      }
      const ua = String(opts.ua || '*').toLowerCase();
      /* B22：RFC 9309 —— 同一个 UA 命中**多个**规则组时，规则要合并生效。
         旧实现只取第一个命中的组，于是「Googlebot 组 A 禁 /one、组 B 禁 /two」
         检查 /two 会被判成允许。 */
      const named = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.indexOf(a) >= 0));
      const pool = named.length ? named : groups.filter((g) => g.agents.indexOf('*') >= 0);
      if (!pool.length) return { error: '没有匹配到任何规则组', hint: '检查文件是否是标准 robots.txt 格式' };
      const label = pool.map((g) => g.agents.join(',')).join(' + ') + (named.length > 1 ? '（' + named.length + ' 个组已按 RFC 9309 合并）' : '');
      const chosen = {
        agents: pool.reduce((a, g) => a.concat(g.agents), []),
        rules: pool.reduce((a, g) => a.concat(g.rules), []),
        delay: (pool.find((g) => g.delay != null) || {}).delay,
        host: (pool.find((g) => g.host != null) || {}).host,
      };
      const rules = chosen.rules.filter((r) => r.path !== '');
      const dis = rules.filter((r) => r.type === 'disallow').map((r) => r.path);
      const allow = rules.filter((r) => r.type === 'allow').map((r) => r.path);
      let verdict = null;
      if (opts.path) {
        const p = String(opts.path).indexOf('/') === 0 ? opts.path : '/' + opts.path;
        /* RFC 9309 语义：
           - `*` 任意字符序列，`$` 结尾锚点（原实现把 $ 当普通字符转义，导致 *.pdf$ 永不命中）
           - 前缀匹配即可命中（原实现 .replace(/\/$/,'') 把 /private/ 变成 ^/private，
             会误伤 /privatexyz）
           - 最长匹配优先，等长时 Allow 胜出 */
        const toRe = (pattern) => {
          let raw = String(pattern);
          let anchor = false;
          if (raw.slice(-1) === '$') { anchor = true; raw = raw.slice(0, -1); }
          const body = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
          return new RegExp('^' + body + (anchor ? '$' : ''));
        };
        const spec = (pattern) => String(pattern).replace(/\*/g, '').replace(/\$$/, '').length;
        const hits = (list) => list.filter((pt) => { try { return toRe(pt).test(p); } catch (e) { return false; } })
          .sort((x, y) => spec(y) - spec(x));
        const hitDis = hits(dis)[0];
        const hitAllow = hits(allow)[0];
        /* Allow 与 Disallow 等长时 Allow 生效 */
        const allowed = !hitDis || (hitAllow && spec(hitAllow) >= spec(hitDis));
        verdict = { allowed: allowed, pattern: allowed ? hitAllow : hitDis, rule: allowed ? 'Allow' : 'Disallow' };
      }
      const summary = [
        '规则组: ' + label,
        'Disallow: ' + dis.length + ' 条',
        'Allow: ' + allow.length + ' 条',
        'Crawl-delay: ' + (chosen.delay || '未设置'),
        'Sitemap: ' + ((groups.sitemaps || []).join(', ') || '未声明'),
      ].join('\n') + (verdict ? '\n\n路径 ' + opts.path + ' → ' + (verdict.allowed ? '✓ 允许抓取' : '✕ 被 Disallow 禁止') + (verdict.pattern ? '（命中 ' + verdict.rule + ' 规则 ' + verdict.pattern + '）' : '（无规则命中，默认允许）') : '');
      const rows = rules.map((r) => ({ type: r.type, path: r.path }));
      const sitemaps = groups.sitemaps || [];
      const tabs = [
        { label: 'Disallow (' + dis.length + ')', text: dis.join('\n') || '无', lang: 'text' },
        { label: 'Allow (' + allow.length + ')', text: allow.join('\n') || '无', lang: 'text' },
        { label: '全部规则', view: 'table', data: { columns: [{ key: 'type', label: '类型', width: '100px' }, { key: 'path', label: '路径' }], rows: rows, name: 'robots' } },
      ];
      /* 真实爬虫第一步就是拿 sitemap 列表，单独给页签才有用 */
      if (sitemaps.length) {
        tabs.push({
          label: 'Sitemap (' + sitemaps.length + ')',
          view: 'table',
          data: {
            columns: [{ key: 'url', label: 'Sitemap 地址' }],
            rows: sitemaps.map((u) => ({ url: u })),
            name: 'robots-sitemap',
          },
        });
      }
      if ((groups.cleanParams || []).length) {
        tabs.push({
          label: 'Clean-param (' + groups.cleanParams.length + ')',
          text: groups.cleanParams.join('\n'),
          lang: 'text',
        });
      }
      return {
        text: summary,
        lang: 'text',
        tabs: tabs,
        stats: [{ k: 'Disallow', v: dis.length }, { k: 'Allow', v: allow.length }, verdict ? { k: '测试', v: verdict.allowed ? '允许' : '禁止', level: verdict.allowed ? 'ok' : 'warn' } : null].filter(Boolean),
        notices: chosen.delay && Number(chosen.delay) > 1 ? [{ level: 'warn', msg: '站点声明 Crawl-delay=' + chosen.delay + ' 秒，采集频率别超过它' }] : null,
        filename: 'robots',
      };
    },
  });

  SK.tool({
    id: 'ua',
    name: 'UA 解析 / 生成',
    group: 'spider',
    icon: '🖥',
    aliases: 'ua useragent user-agent 解析 生成 随机',
    keywords: ['ua', 'user-agent', '解析', '生成', '随机', '浏览器', '指纹'],
    desc: '解析 User-Agent 的浏览器/版本/系统/内核/设备，或按平台批量生成可用的 UA，配套 sec-ch-ua 提示',
    sample: 'ua',
    inputs: [{ id: 'in', label: 'User-Agent', placeholder: '粘贴 UA；留空则生成', sample: 'ua' }],
    allowEmpty: true,
    options: [
      { id: 'mode', type: 'seg', label: '模式', value: 'parse', choices: [{ v: 'parse', label: '解析' }, { v: 'gen', label: '生成' }] },
      { id: 'platform', type: 'select', label: '生成平台', value: 'all', choices: [{ v: 'all', label: '混合' }, { v: 'win', label: 'Windows' }, { v: 'mac', label: 'macOS' }, { v: 'linux', label: 'Linux' }, { v: 'mobile', label: '移动端' }, { v: 'wechat', label: '微信内置' }, { v: 'bot', label: '爬虫/搜索引擎' }] },
      { id: 'count', type: 'number', label: '生成数量', value: 10, min: 1, max: 500 },
    ],
    handler: function (input, opts) {
      opts = opts || {};
      /* UA 池按平台分组：版本号取自真实发布版本，不编造。
         bot / wechat 单列——爬虫工程师最常见的就是这两类。 */
      const UA_POOL = {
        win: [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/131.0.0.0',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
          'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
        ],
        mac: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:133.0) Gecko/20100101 Firefox/133.0',
        ],
        linux: [
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
        ],
        mobile: [
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
          'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
          'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
          'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
          'Mozilla/5.0 (Linux; Android 14; V2309A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        ],
        wechat: [
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.54(0x18003628) NetType/WIFI Language/zh_CN',
          'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 MicroMessenger/8.0.54.2840(0x28003655) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
          'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x28003135) WeChat/arm64 Weixin NetType/5G Language/zh_CN ABI/arm64',
        ],
        bot: [
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36',
          'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
          'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
          'Mozilla/5.0 (compatible; YisouSpider; +http://www.yisou.com/)',
          'Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)',
          'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
          'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)',
          'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
          'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        ],
      };
      const FLAT = [].concat(UA_POOL.win, UA_POOL.mac, UA_POOL.linux, UA_POOL.mobile, UA_POOL.wechat, UA_POOL.bot);

      if (opts.mode === 'gen') {
        const pf = opts.platform || 'all';
        const cand = pf === 'all' ? FLAT.slice() : (UA_POOL[pf] || FLAT).slice();
        const n = Math.max(1, Number(opts.count || 10));
        /* 无放回抽样：原实现随机取，count>池大小时大量重复 */
        const shuffle = (arr) => {
          const a = arr.slice();
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = a[i]; a[i] = a[j]; a[j] = t;
          }
          return a;
        };
        const out = [];
        let bag = shuffle(cand);
        for (let i = 0; i < n; i++) {
          if (!bag.length) bag = shuffle(cand);
          out.push(bag.pop());
        }
        return {
          text: out.join('\n'),
          lang: 'text',
          stats: [{ k: '生成', v: out.length }, { k: '平台', v: pf }, { k: '池', v: cand.length }],
          notices: [
            'User-Agent 必须与 sec-ch-ua / Accept-Language / 时区 成套使用，单换 UA 更容易被识别',
            n > cand.length ? '请求数量超过池容量（' + cand.length + '），已循环使用，同一会话内仍可能重复' : null,
          ].filter(Boolean),
        };
      }

      const ua = String(input == null ? '' : input).trim() || FLAT[0];
      const pick = (re) => { const m = re.exec(ua); return m ? m[1] : ''; };

      /* ① 爬虫/机器人优先判定：这类 UA 里常同时含 Chrome 字样，顺序错了会误判成浏览器 */
      const BOTS = [
        [/Googlebot\/([\d.]+)/i, 'Googlebot'], [/Googlebot-Image/i, 'Googlebot-Image'],
        [/bingbot\/([\d.]+)/i, 'bingbot'], [/Baiduspider/i, 'Baiduspider'],
        [/YisouSpider/i, 'YisouSpider'], [/Sogou web spider\/([\d.]+)/i, 'Sogou Spider'],
        [/Bytespider/i, 'Bytespider'], [/Applebot\/([\d.]+)/i, 'Applebot'],
        [/YandexBot\/([\d.]+)/i, 'YandexBot'], [/DuckDuckBot\/([\d.]+)/i, 'DuckDuckBot'],
        [/facebookexternalhit\/([\d.]+)/i, 'facebookexternalhit'], [/Twitterbot\/([\d.]+)/i, 'Twitterbot'],
        [/AhrefsBot/i, 'AhrefsBot'], [/SemrushBot/i, 'SemrushBot'], [/MJ12bot/i, 'MJ12bot'],
        [/PetalBot/i, 'PetalBot'], [/Bytespider/i, 'Bytespider'],
      ];
      let browser = '未知', bot = null, botVer = '';
      for (const [re, name] of BOTS) {
        if (re.test(ua)) { bot = name; const m = re.exec(ua); botVer = m && m[1] ? m[1] : ''; break; }
      }
      if (bot) browser = bot + (botVer ? ' ' + botVer : '') + '（爬虫）';
      /* ② 微信内置浏览器 / 各家 App 内置 WebView */
      else if (/MicroMessenger\/([\d.]+)/i.test(ua)) browser = '微信内置浏览器 ' + pick(/MicroMessenger\/([\d.]+)/i);
      else if (/QQ\/[\d.]+/.test(ua) && /MQQBrowser/.test(ua)) browser = 'QQ 浏览器 ' + pick(/MQQBrowser\/([\d.]+)/);
      else if (/UCBrowser\/([\d.]+)/i.test(ua)) browser = 'UC 浏览器 ' + pick(/UCBrowser\/([\d.]+)/i);
      else if (/baiduboxapp/i.test(ua)) browser = '百度 App 内置';
      else if (/aweme|ByteLocale/i.test(ua)) browser = '抖音内置';
      /* ③ 常规浏览器 */
      else if (/Edg\/([\d.]+)/.test(ua)) browser = 'Edge ' + pick(/Edg\/([\d.]+)/);
      else if (/OPR\/([\d.]+)/.test(ua)) browser = 'Opera ' + pick(/OPR\/([\d.]+)/);
      else if (/Chrome\/([\d.]+)/.test(ua)) browser = 'Chrome ' + pick(/Chrome\/([\d.]+)/);
      else if (/Firefox\/([\d.]+)/.test(ua)) browser = 'Firefox ' + pick(/Firefox\/([\d.]+)/);
      else if (/Version\/([\d.]+).*Safari/.test(ua)) browser = 'Safari ' + pick(/Version\/([\d.]+)/);

      let os = '未知';
      if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
      else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
      else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
      else if (/Mac OS X ([\d_]+)/.test(ua)) os = 'macOS ' + pick(/Mac OS X ([\d_]+)/).replace(/_/g, '.');
      else if (/Android ([\d.]+)/.test(ua)) os = 'Android ' + pick(/Android ([\d.]+)/);
      else if (/iPhone OS ([\d_]+)/.test(ua)) os = 'iOS ' + pick(/iPhone OS ([\d_]+)/).replace(/_/g, '.');
      else if (/CPU OS ([\d_]+)/.test(ua)) os = 'iPadOS ' + pick(/CPU OS ([\d_]+)/).replace(/_/g, '.');
      else if (/Linux/.test(ua)) os = 'Linux';

      const engine = bot ? '—（爬虫）'
        : /AppleWebKit/.test(ua) ? (/Chrome|Edg|OPR|MicroMessenger/.test(ua) ? 'Blink' : 'WebKit')
        : /Gecko\/|Firefox/.test(ua) ? 'Gecko' : '未知';
      const device = bot ? '爬虫/机器人'
        : /iPad|Tablet/.test(ua) ? '平板'
        : /Mobile|iPhone|Android/.test(ua) ? '手机' : '桌面';
      const chUa = (() => {
        if (bot) return '（爬虫 UA，不需要 sec-ch-ua）';
        const m = /Chrome\/(\d+)/.exec(ua);
        if (!m) return '（非 Chromium，不需要 sec-ch-ua）';
        const v = m[1];
        return '"Chromium";v="' + v + '", "Google Chrome";v="' + v + '", "Not?A_Brand";v="99"';
      })();
      const rows = [
        { k: '浏览器', v: browser, copy: true },
        { k: '操作系统', v: os },
        { k: '内核', v: engine },
        { k: '设备类型', v: device },
        { k: '完整 UA', v: ua, copy: true },
        { k: 'sec-ch-ua', v: chUa, copy: true },
      ];
      const notes = [];
      if (!bot && device === '桌面' && /Mobile/.test(ua)) notes.push({ level: 'warn', msg: 'UA 自相矛盾（桌面系统却标 Mobile），容易被风控识别' });
      if (bot) notes.push({ level: 'info', msg: '这是搜索引擎/爬虫 UA：多数站点会放行，但需注意 robots 与频率；伪造时务必带上真实 IP 段' });
      if (/MicroMessenger/.test(ua)) notes.push({ level: 'info', msg: '微信内置浏览器：只能拿到「微信 OAuth」授权的登录态，普通 SSO 往往走不通' });
      return {
        tabs: [{ label: '字段', view: 'fields', data: rows }],
        text: rows.map((r) => r.k + ': ' + r.v).join('\n'),
        lang: 'text',
        stats: [{ k: '浏览器', v: browser }, { k: '系统', v: os }, { k: '设备', v: device }],
        notices: notes.length ? notes : null,
        filename: 'ua',
      };
    },
  });

  SK.tool({
    id: 'charset',
    name: '编码识别 / 乱码修复',
    group: 'spider',
    icon: 'ᵺ',
    aliases: 'charset 编码 gbk utf8 乱码 转码',
    keywords: ['编码', 'charset', 'gbk', 'gb2312', 'utf8', '乱码', '转码'],
    desc: '识别并修复乱码：UTF-8 被当 latin1、GBK 页面被当 UTF-8、HTML 实体混排，一次转成正常中文',
    sample: 'escaped',
    inputs: [{ id: 'in', label: '乱码文本', placeholder: 'æµ‹è¯• 或 ÖÐÎÄ', sample: 'escaped' }],
    options: [
      { id: 'from', type: 'select', label: '原编码', value: 'auto', choices: [{ v: 'auto', label: '自动尝试' }, { v: 'latin1', label: 'latin1 / iso-8859-1' }, { v: 'gbk', label: 'GBK / GB2312' }, { v: 'gbk-reverse', label: '反修复（UTF8被当GBK显示）' }, { v: 'big5', label: 'BIG5' }, { v: 'utf8', label: 'UTF-8' }] },
      { id: 'to', type: 'select', label: '目标', value: 'utf8', choices: [{ v: 'utf8', label: 'UTF-8 文本' }, { v: 'hex', label: '十六进制字节' }, { v: 'base64', label: 'Base64' }] },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input);
      if (!raw) return { error: '输入为空' };
      /* Windows-1252：抓包工具把 0x80-0x9F 区字节显示成弯引号/€ 等，先映射回字节 */
      const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
      const toBytesLatin1 = (s) => {
        const b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c > 255) {
            const cp = CP1252[c];
            if (cp === undefined) return null;
            b[i] = cp;
            continue;
          }
          b[i] = c;
        }
        return b;
      };
      const tryDecode = (bytes, enc) => {
        try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch (e) { return null; }
      };
      /* 汉字形态乱码：UTF-8 字节被按 GBK 显示（如 娴嬭瘯）。逆操作 = 按 GBK 编码回字节再按 UTF-8 解码 */
      const tryUnmojibakeGbk = (s) => {
        if (typeof SK.gbkEncode !== 'function') return null;
        if (!/[\u4e00-\u9fff]/.test(s)) return null;
        const bytes = SK.gbkEncode(s);
        if (!bytes) return null;
        return tryDecode(bytes, 'utf-8');
      };
      /* 反向：GBK 字节被按 UTF-8 显示成 U+FFFD 或拉丁扩展的情形由上面 bytes 路径覆盖 */
      const candidates = [];
      const bytes = toBytesLatin1(raw);
      if (opts.from === 'auto') {
        if (bytes) {
          ['utf-8', 'gbk', 'big5'].forEach((enc) => {
            const t = tryDecode(bytes, enc);
            if (t) candidates.push({ enc: enc, text: t });
          });
        }
        const un = tryUnmojibakeGbk(raw);
        if (un) candidates.push({ enc: 'utf8→gbk 反修复', text: un });
        candidates.push({ enc: 'plain', text: raw });
      } else if (opts.from === 'utf8') {
        candidates.push({ enc: 'utf8', text: raw });
      } else if (opts.from === 'gbk-reverse') {
        const t = tryUnmojibakeGbk(raw);
        if (!t) return { error: '反修复失败：文本无法按 GBK 编码回字节', hint: '确认乱码是「UTF-8 被当 GBK 显示」的形态（汉字里夹杂生僻字），例如 娴嬭瘯 → 测试' };
        candidates.push({ enc: 'gbk-reverse', text: t });
      } else {
        if (!bytes) return { error: '输入含非 latin1 字符，无法按 ' + opts.from + ' 重新编码', hint: '先把文本复制成纯 latin1 乱码形态，或直接用「文本解码」' };
        const t = tryDecode(bytes, opts.from === 'gbk' ? 'gbk' : opts.from === 'big5' ? 'big5' : 'iso-8859-1');
        if (!t) return { error: '按 ' + opts.from + ' 解码失败' };
        candidates.push({ enc: opts.from, text: t });
      }
      /* 常见汉字（现代汉语高频 + 爬虫语境），命中一个权重远高于生僻汉字 */
      const COMMON = /的|一|是|不|了|在|人|有|我|他|这|中|大|来|上|国|和|地|也|子|时|道|出|而|要|于|就|下|得|可|你|年|生|自|会|那|后|能|对|着|事|其|里|所|去|行|过|家|十|用|发|天|如|然|作|方|成|者|多|日|都|三|小|军|二|无|同|么|经|法|当|起|与|好|看|学|进|种|将|还|分|此|心|前|面|又|定|见|只|主|没|公|从|测|试|数|据|请|求|响|应|页|用|户|名|密|码|登|录|成|功|失|败|时|间|系|统|标|题|价|格|商|品|搜|索|结|果|服|务|接|口|参|数|错|误|完|开|始|结|束|状|态|类|型|编|号|地|址|内|容|信|息|已|次|获|取|验|证|克|隆/g;
      const score = (s, enc) => {
        const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
        const bad = (s.match(/[\ufffd\u0000-\u0008]/g) || []).length;
        const latin = (s.match(/[\u00c0-\u00ff]/g) || []).length;
        const common = (s.match(COMMON) || []).length;
        /* 反修复是强信号：一段文字恰好能按 GBK 编回字节且字节是合法 UTF-8，随机文本很难做到 */
        const bonus = enc === 'utf8→gbk 反修复' ? 40 : 0;
        return cjk * 3 + common * 8 + bonus - bad * 10 - latin;
      };
      candidates.sort((a, b) => score(b.text, b.enc) - score(a.text, a.enc));
      const best = candidates[0];
      const outText = best.text;
      let out = outText;
      if (opts.to === 'hex') {
        const b = SK.crypt.encStr(outText, 'utf8');
        out = SK.crypt.toHex(b);
      } else if (opts.to === 'base64') {
        const b = SK.crypt.encStr(outText, 'utf8');
        out = SK.crypt.toB64(b);
      }
      return {
        text: out,
        lang: 'text',
        tabs: candidates.length > 1 ? [{ label: '候选 (' + candidates.length + ')', view: 'table', data: { columns: [{ key: 'enc', label: '按编码', width: '140px' }, { key: 'sample', label: '解码结果' }], rows: candidates.map((c) => ({ enc: c.enc, sample: c.text.slice(0, 200) })), name: 'charset' } }] : [],
        stats: [{ k: '判定', v: best.enc }, { k: '字符', v: outText.length }].concat(candidates.slice(1, 3).map((c) => ({ k: '备选', v: c.enc }))),
        notices: score(outText, best.enc) < 0 ? [{ level: 'warn', msg: '解码结果仍像乱码，试试切换「原编码」或分段处理' }] : null,
        filename: 'decoded',
      };
    },
  });
})();
