/* 文本处理：解码 / 正则校验 / 批量提取 / 行操作 */
(function () {

  SK.tool({
    id: 'text-decode',
    name: '文本解码',
    group: 'text',
    icon: '⇣',
    aliases: 'decode unicode 转义 html实体 url 解码 乱码',
    keywords: ['解码', 'unicode', '转义', 'html', '实体', '乱码', 'gbk', 'utf8'],
    desc: '一键还原 \\u4e2d、\\x68、&lt;div&gt;、%E4%B8%AD 以及 æµ‹è¯• 这类编码/乱码，逐步套用多个解码器',
    sample: 'escaped',
    hint: '“乱码修复”能救回 UTF-8 被当 latin1 打印出来的那种 æµ‹è¯•',
    inputs: [{ id: 'in', label: '待解码文本', placeholder: '{"msg":"\\u4f60\\u597d"}', sample: 'escaped' }],
    options: [
      { id: 'mode', type: 'seg', label: '解码器', value: 'auto', choices: [{ v: 'auto', label: '自动全解' }, { v: 'unicode', label: 'Unicode' }, { v: 'hex', label: '\\xNN' }, { v: 'html', label: 'HTML 实体' }, { v: 'url', label: 'URL' }, { v: 'mojibake', label: '乱码修复' }, { v: 'base64', label: 'Base64' }, { v: 'hexstr', label: '纯 Hex' }] },
      { id: 'esc', type: 'toggle', label: '也解 \\n \\t 等', value: true },
      { id: 'times', type: 'number', label: '重复轮数', value: 1, min: 1, max: 5, title: '多层编码时调大，例如 %25E4%25B8%25AD' },
    ],
    handler: function (input, opts) {
      let text = String(input == null ? '' : input);
      const rounds = Math.max(1, Math.min(5, Number(opts.times || 1)));
      const counts = {};
      const unicode = (s) => s.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (m, cp, u) => {
        try {
          counts.unicode = (counts.unicode || 0) + 1;
          return cp ? String.fromCodePoint(parseInt(cp, 16)) : String.fromCharCode(parseInt(u, 16));
        } catch (e) { return m; }
      });
      const hex = (s) => s.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => {
        counts.hex = (counts.hex || 0) + 1;
        return String.fromCharCode(parseInt(h, 16));
      });
      const html = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]{2,8});/g, (m, ent) => {
        if (ent[0] === '#') {
          const num = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
          if (isFinite(num) && num > 0 && num <= 0x10ffff) { counts.html = (counts.html || 0) + 1; return String.fromCodePoint(num); }
          return m;
        }
        const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', times: '×', divide: '÷', yen: '¥', euro: '€', deg: '°' };
        if (map[ent] !== undefined) { counts.html = (counts.html || 0) + 1; return map[ent]; }
        return m;
      });
      const url = (s) => s.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
        try { counts.url = (counts.url || 0) + 1; return decodeURIComponent(m); } catch (e) { return m; }
      });
      const mojibake = (s) => {
        if (!/[ÃÂâãåæçèéêëìíîïðñòóôõöøùúûüýþÿ]|[\u00c0-\u00ff]{2}/.test(s)) return s;
        try {
          const bytes = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (c > 255) return s;
            bytes[i] = c;
          }
          const dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          counts.mojibake = 1;
          return dec;
        } catch (e) {
          return s;
        }
      };
      /* 自动模式下的保守门槛：整串都是 base64 字符、长度是 4 的倍数、且含数字/+/=，
         解出来还必须是合法 UTF-8 且无控制字符——否则「HelloWorldHello1」这类英文也会被误判。
         但用户显式选了「Base64」解码器时这些门槛必须让路，否则 SGVsbG8= （8 字符）会被原样吐回。 */
      const strict = opts.mode === 'base64';
      const notes = [];
      const b64dec = (s) => {
        const t = s.replace(/\s+/g, '');
        if (!t) return s;
        if (!/^[A-Za-z0-9+/=_-]+$/.test(t)) {
          if (strict) notes.push('Base64 解码失败：含有非 base64 字符');
          return s;
        }
        if (!strict) {
          if (t.length < 16 || t.length % 4 !== 0) return s;
          if (!/[0-9+/=]/.test(t)) return s;
        }
        try {
          let u = t.replace(/-/g, '+').replace(/_/g, '/');
          while (u.length % 4) u += '=';
          const bin = atob(u);
          if (!bin.length) return s;
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (!dec || /[\u0000-\u0008\u000b\u000e-\u001f]/.test(dec)) {
            if (strict) notes.push('Base64 能解出字节，但不是合法文本（可能是二进制/别的编码）——去「编解码转换」按字节看');
            return s;
          }
          counts.base64 = (counts.base64 || 0) + 1;
          return dec;
        } catch (e) {
          if (strict) notes.push('Base64 解码失败：' + (e && e.message ? e.message : '非法输入'));
          return s;
        }
      };
      /* 纯 hex 串（无 \x 前缀）：2f3a... → 文本 */
      const hexstr = (s) => {
        const t = s.replace(/\s+/g, '');
        if (!/^[0-9a-fA-F]+$/.test(t)) {
          if (opts.mode === 'hexstr') notes.push('纯 Hex 解码失败：含有非十六进制字符');
          return s;
        }
        if (t.length % 2 !== 0) {
          if (opts.mode === 'hexstr') notes.push('纯 Hex 解码失败：长度不是偶数（' + t.length + ' 个 hex 字符）');
          return s;
        }
        if (t.length < 8 && opts.mode !== 'hexstr') return s;
        try {
          const bytes = new Uint8Array(t.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(t.substr(i * 2, 2), 16);
          const dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (!dec || /[\u0000-\u0008\u000b\u000e-\u001f]/.test(dec)) {
            if (opts.mode === 'hexstr') notes.push('纯 Hex 能解出字节，但不是合法文本——去「编解码转换」按字节看');
            return s;
          }
          counts.hexstr = (counts.hexstr || 0) + 1;
          return dec;
        } catch (e) { return s; }
      };
      const trace = [];
      for (let r = 0; r < rounds; r++) {
        const before = text;
        if (opts.mode === 'auto' || opts.mode === 'unicode') text = unicode(text);
        if (opts.mode === 'auto' || opts.mode === 'hex') text = hex(text);
        if (opts.mode === 'auto' || opts.mode === 'html') text = html(text);
        if (opts.mode === 'auto' || opts.mode === 'url') text = url(text);
        if (opts.mode === 'auto' || opts.mode === 'mojibake') text = mojibake(text);
        if (opts.mode === 'auto' || opts.mode === 'base64') text = b64dec(text);
        if (opts.mode === 'auto' || opts.mode === 'hexstr') text = hexstr(text);
        if (opts.esc) {
          text = text.replace(/\\([nrtbfv0'"\\])/g, (m, c) => {
            counts.esc = (counts.esc || 0) + 1;
            return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '"': '"', "'": "'", '\\': '\\' })[c] || m;
          });
        }
        if (text !== before) trace.push({ 轮次: r + 1, 结果: text.length > 400 ? text.slice(0, 400) + '…' : text });
      }
      const total = Object.keys(counts).reduce((a, k) => a + counts[k], 0);
      const out = {
        text: text,
        lang: 'text',
        stats: Object.keys(counts).map((k) => ({ k: k, v: counts[k] })).concat([{ k: '总替换', v: total }]),
        notices: [].concat(
          total === 0 ? [{ level: 'warn', msg: '没有识别到可解码的内容，试试换解码器或加大轮数（自动模式下 base64/纯 hex 需要整串都是对应字符才会尝试）' }] : [],
          notes.filter((v, i, a) => a.indexOf(v) === i).map((m) => ({ level: 'warn', msg: m })),
        ),
        filename: 'decoded',
      };
      if (trace.length > 1) {
        out.tabs = [{
          label: '解码过程 (' + trace.length + ')',
          view: 'table',
          data: {
            columns: [{ key: '轮次', label: '轮次', width: '70px' }, { key: '结果', label: '本轮结果' }],
            rows: trace, name: 'decode-trace',
          },
        }];
      }
      return out;
    },
  });

  SK.tool({
    id: 'regex-test',
    name: '正则校验',
    group: 'text',
    icon: '.*',
    aliases: 'regex 正则 匹配 测试 校验 replace',
    keywords: ['regex', '正则', '匹配', '测试', '替换', '分组'],
    desc: '实时校验正则表达式：命中位置、分组捕获、替换预览一屏看完，附爬虫常用正则速查',
    sample: 'regex',
    hint: '第二个输入框填正则；左侧是被匹配的文本',
    inputs: [
      { id: 'in', label: '待匹配文本', placeholder: '粘贴日志/HTML/JSON', sample: 'regex' },
      { id: 're', label: '正则表达式', placeholder: '(\\d{4})-(\\d{2})-(\\d{2})', small: true, sample: 'regex-re' },
    ],
    options: [
      { id: 'flags', type: 'text', label: 'flags', value: 'gm', placeholder: 'gimsu' },
      { id: 'replace', type: 'text', label: '替换为', value: '', placeholder: '留空只看匹配；$1 引用分组' },
      { id: 'limit', type: 'number', label: '最多匹配', value: 5000, min: 1, max: 200000 },
    ],
    help:
      '<h4>三分钟上手</h4>' +
      '<p>正则就是「描述一段文本长什么样」的模板。比如 <code>\\d{4}-\\d{2}-\\d{2}</code> 描述的是「4位数字-2位数字-2位数字」，也就是 <code>2024-01-31</code> 这种日期。把模板填进第二个输入框，左边文本里所有符合的部分都会被找出来。</p>' +
      '<h4>常用符号速查</h4>' +
      '<table><tr><th>符号</th><th>含义</th><th>示例</th></tr>' +
      '<tr><td><code>.</code></td><td>任意一个字符（换行除外）</td><td><code>a.c</code> → abc / a1c</td></tr>' +
      '<tr><td><code>\\d</code> / <code>\\w</code> / <code>\\s</code></td><td>数字 / 字母数字下划线 / 空白</td><td><code>\\d\\d</code> → 42</td></tr>' +
      '<tr><td><code>\\D</code> / <code>\\W</code> / <code>\\S</code></td><td>上面三种的「反义」</td><td><code>\\S+</code> → 一串非空白</td></tr>' +
      '<tr><td><code>^</code> / <code>$</code></td><td>行首 / 行尾（有 m 标志时按行算）</td><td><code>^http</code> → 以 http 开头</td></tr>' +
      '<tr><td><code>*</code> / <code>+</code> / <code>?</code></td><td>重复 0+ 次 / 1+ 次 / 0 或 1 次</td><td><code>go?d</code> → gd / god</td></tr>' +
      '<tr><td><code>{n}</code> <code>{n,}</code> <code>{n,m}</code></td><td>重复 n 次 / 至少 n 次 / n 到 m 次</td><td><code>\\d{11}</code> → 手机号</td></tr>' +
      '<tr><td><code>[abc]</code> / <code>[a-z]</code> / <code>[^a-z]</code></td><td>集合内任一 / 范围 / 反义集合</td><td><code>[A-Za-z0-9_]</code> 同 <code>\\w</code></td></tr>' +
      '<tr><td><code>(abc)</code></td><td>分组捕获，可在「替换为」里用 <code>$1</code> 引用</td><td><code>(\\d{4})-(\\d{2})</code> → $2/$1</td></tr>' +
      '<tr><td><code>(?:abc)</code></td><td>只分组不捕获（省资源）</td><td><code>(?:ab)+</code></td></tr>' +
      '<tr><td><code>a|b</code></td><td>或</td><td><code>cat|dog</code></td></tr>' +
      '<tr><td><code>\\b</code></td><td>单词边界</td><td><code>\\bkey\\b</code> 不会匹配 keyword</td></tr>' +
      '<tr><td><code>\\</code></td><td>转义：匹配符号本身要加 <code>\\</code></td><td><code>\\.</code> 匹配点号</td></tr></table>' +
      '<h4>贪婪与懒惰</h4>' +
      '<p><code>&lt;div&gt;.*&lt;/div&gt;</code> 会一路吃到<b>最后一个</b> &lt;/div&gt;（贪婪）；在量词后加 <code>?</code> 变懒惰，吃到<b>第一个</b>就停：<code>&lt;div&gt;.*?&lt;/div&gt;</code>。抓网页时优先用懒惰模式。</p>' +
      '<h4>前后断言（只匹配位置，不消耗字符）</h4>' +
      '<table><tr><th>写法</th><th>含义</th><th>示例</th></tr>' +
      '<tr><td><code>(?=x)</code></td><td>后面跟着 x</td><td><code>\\d+(?=元)</code> → 「100元」里的 100</td></tr>' +
      '<tr><td><code>(?!x)</code></td><td>后面不是 x</td><td><code>\\d{4}(?!-)</code></td></tr>' +
      '<tr><td><code>(?&lt;=x)</code></td><td>前面是 x</td><td><code>(?&lt;=token=)\\w+</code> → 取 token= 后面的值</td></tr>' +
      '<tr><td><code>(?&lt;!x)</code></td><td>前面不是 x</td><td><code>(?&lt;!\\d)\\d{3}</code></td></tr></table>' +
      '<h4>flags 标志</h4>' +
      '<p><code>g</code> 全局（不加只匹配第一处）· <code>i</code> 忽略大小写 · <code>m</code> 多行（^ $ 按行）· <code>s</code> 让点号匹配换行 · <code>u</code> Unicode 模式。</p>' +
      '<h4>爬虫高频正则</h4>' +
      '<pre>URL:      https?://[^\\s"\'&lt;&gt;]+\n手机号:   1[3-9]\\d{9}\n邮箱:     [\\w.+-]+@[\\w-]+\\.[\\w.]+\nIP:       \\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b\n身份证:   \\d{17}[\\dXx]\nJS 变量:  (?:var|let|const)\\s+(\\w+)\\s*=\n签名参数: ["\']?(sign|token|nonce|timestamp)["\']?\\s*[:=]\\s*["\']?([^&\'"\\s,}]+)\n时间戳:   \\b1[6-9]\\d{8}(?:\\d{3})?\\b\n中文字符: [\\u4e00-\\u9fa5]+\nimg 标签: &lt;img[^&gt;]*src=["\']([^"\']+)["\'][^&gt;]*&gt;</pre>' +
      '<h4>小白常见坑</h4>' +
      '<ul><li>想匹配 <code>1.5</code> 写 <code>1.5</code> 会把 <code>1x5</code> 也匹配上——点号要写成 <code>\\.</code></li>' +
      '<li>忘记 <code>g</code> 标志时只会命中第一处，然后怀疑正则写错了</li>' +
      '<li>括号一定要配对；本工具报错时会把位置和原因直接标出来</li>' +
      '<li>匹配 HTML 优先考虑用「XPath / CSS 选择器」工具，比正则稳</li></ul>',
    handler: function (text, pattern, opts) {
      opts = opts || {};
      const src = String(pattern == null ? '' : pattern).trim();
      const body = String(text == null ? '' : text);
      if (!src) return { error: '请填写正则表达式', hint: '输入框右上角 ✨ 有示例' };
      let re;
      const flagsRaw = String(opts.flags || 'gm');
      const flags = flagsRaw.indexOf('g') >= 0 ? flagsRaw : flagsRaw + 'g';
      /* 从 Python/Go 拷过来的正则直接跑会报 "Invalid group"，给一句人话提示 */
      if (/\(\?P[<=]/.test(src)) {
        return { error: 'Python 命名捕获组语法不受支持', hint: '把 (?P<name>…) 改成 JS 写法 (?<name>…)，(?P=name) 需要改成 \\k<name>' };
      }
      try {
        re = new RegExp(src, flags);
      } catch (e) {
        return { error: '正则有语法错误：' + e.message, hint: '检查括号是否配对、特殊字符是否转义（. * + ? ( ) [ ] { } | ^ $ \\）' };
      }
      /* ReDoS 预检：危险形态 + 长文本时先跑一次受控试探，避免直接卡死线程 */
      const risk = SK.gen && SK.gen.redosRisk ? SK.gen.redosRisk(src) : { risky: false, hits: [] };
      const limit = Math.max(1, Number(opts.limit || 5000));
      const rows = [];
      let m;
      let truncated = false;
      const start = Date.now();
      /* ReDoS 静态拦截：危险形态**不试跑**（试跑它本身就会卡死线程），
         直接拒绝并给出改写建议；确实要跑可在选项里勾「允许危险正则」。 */
      if (risk.risky && !opts.allowRisky) {
        return {
          error: '检测到「灾难性回溯」风险，已阻止执行：' + risk.hits[0].pattern,
          hint: (risk.hits[0].hint || '') + '。改法：(a+)+ → a+，(.*)* → .*?，改用 [^\s]+ 这类不含空量词的字符类。确认数据量很小时，勾「允许危险正则」再运行',
        };
      }
      while ((m = re.exec(body))) {
        const idx = m.index;
        rows.push({
          n: rows.length + 1,
          pos: idx,
          line: body.slice(0, idx).split('\n').length,
          text: m[0].length > 300 ? m[0].slice(0, 300) + '…' : m[0],
          groups: m.slice(1).map((g, i) => (g === undefined ? '' : g)).join(' | ').slice(0, 300),
        });
        if (rows.length >= limit) { truncated = true; break; }
        if (m[0] === '') re.lastIndex++;
        if (Date.now() - start > 8000) { truncated = true; break; }
      }
      const groupNames = [];
      const tabs = [{ label: '匹配 (' + rows.length + ')', view: 'table', data: {
        columns: [
          { key: 'n', label: '#', width: '54px' },
          { key: 'line', label: '行', width: '64px' },
          { key: 'pos', label: '位置', width: '80px' },
          { key: 'text', label: '匹配内容' },
          { key: 'groups', label: '分组' },
        ],
        rows: rows, name: 'matches', filterHint: '过滤匹配内容',
      } }];
      let outText = rows.map((r) => r.text).join('\n');
      if (opts.replace) {
        try {
          outText = body.replace(new RegExp(src, flags.indexOf('g') >= 0 ? flags : flags + 'g'), opts.replace);
          tabs.unshift({ label: '替换结果', text: outText, lang: 'text' });
        } catch (e) {
          outText = '替换失败：' + e.message;
        }
      }
      return {
        text: outText,
        lang: 'text',
        tabLabel: opts.replace ? '替换结果' : '匹配内容',
        tabs: tabs,
        stats: [{ k: '匹配', v: rows.length }, { k: '耗时', v: SK.dom.fmtMs(Date.now() - start) }, truncated ? { k: '截断', v: '是', level: 'warn' } : null].filter(Boolean),
        notices: rows.length
          ? (risk.risky ? [{ level: 'info', msg: '正则含疑似危险结构（' + risk.hits[0].pattern + '），本次数据量小所以跑完了；处理大文本可能卡死，建议改写' }] : null)
          : [{ level: 'warn', msg: '没有匹配到任何内容' }],
        filename: 'matches',
        next: [
          { label: '🗜 结果可能是压缩数据？去解压', tool: 'gunzip' },
        ],
      };
    },
  });

  SK.tool({
    id: 'regex-extract',
    name: '批量正则提取',
    group: 'text',
    icon: '⧉',
    aliases: 'extract 提取 批量 正则 抓取',
    keywords: ['正则', '提取', '批量', '抓取', 'extract', '爬虫'],
    desc: '从大段 HTML / JSON / 日志里批量抽出目标字段，多分组自动排成表格，可直接导出 CSV',
    sample: 'html',
    help:
      '<h4>怎么用</h4>' +
      '<p>用<b>分组括号</b>圈出要提取的部分，每个分组会成为输出表格的一列。例如 HTML 里有 <code>&lt;a href="/item/123"&gt;商品A&lt;/a&gt;</code>，正则写 <code>href="([^"]+)"[^&gt;]*&gt;([^&lt;]+)&lt;</code>，就会得到「分组1 = /item/123，分组2 = 商品A」两列，可导出 CSV。</p>' +
      '<h4>要点</h4>' +
      '<ul><li>只分组不捕获用 <code>(?:...)</code>，不会多出一列</li><li>正则语法看「正则校验」工具里的 ❔ 说明，有完整速查表</li><li>命名分组 <code>(?&lt;name&gt;...)</code> 的列头会显示 name（新版浏览器）</li></ul>',
    inputs: [
      { id: 'in', label: '源文本', placeholder: 'HTML / JSON / 日志', sample: 'html' },
      { id: 're', label: '正则（带分组）', placeholder: 'data-id="(\\d+)"[^>]*>([^<]+)<', small: true, sample: 'extract-re' },
    ],
    options: [
      { id: 'flags', type: 'text', label: 'flags', value: 'gm' },
      { id: 'uniq', type: 'toggle', label: '整行去重', value: true },
      { id: 'join', type: 'text', label: '输出分隔', value: '\t' },
      { id: 'allowRisky', type: 'toggle', label: '允许危险正则', value: false, title: '关闭时，检测到嵌套量词这类易导致灾难性回溯的写法会直接拒绝；数据量很小时可打开强制运行' },
    ],
    handler: function (text, pattern, opts) {
      opts = opts || {};
      const src = String(pattern == null ? '' : pattern).trim();
      const body = String(text == null ? '' : text);
      if (!src) return { error: '请填写正则表达式', hint: '输入框右上角 ✨ 有示例' };
      if (/\(\?P[<=]/.test(src)) {
        return { error: 'Python 命名捕获组语法不受支持', hint: '把 (?P<name>…) 改成 JS 写法 (?<name>…)' };
      }
      let re;
      try {
        re = new RegExp(src, (String(opts.flags || 'gm').indexOf('g') >= 0 ? opts.flags : (opts.flags || 'gm') + 'g'));
      } catch (e) {
        return { error: '正则语法错误：' + e.message };
      }
      /* 与「正则校验」同一套 ReDoS 预检：超大文本 + 嵌套量词先拦一次，
         否则 40 个字符就能把线程锁 20 秒（超时后还得重启 Worker）。 */
      const risk = SK.gen && SK.gen.redosRisk ? SK.gen.redosRisk(src) : { risky: false, hits: [] };
      if (risk.risky && !opts.allowRisky) {
        return {
          error: '检测到「灾难性回溯」风险，已阻止执行：' + risk.hits[0].pattern,
          hint: (risk.hits[0].hint || '') + '。改法：(a+)+ → a+，(.*)* → .*?；确需运行请勾「允许危险正则」',
        };
      }
      const rows = [];
      const seen = {};
      let m;
      let maxGroup = 0;
      while ((m = re.exec(body))) {
        const groups = m.length > 1 ? m.slice(1) : [m[0]];
        if (groups.length > maxGroup) maxGroup = groups.length;
        const key = groups.join('\u0001');
        if (!opts.uniq || !seen[key]) {
          seen[key] = 1;
          rows.push(groups);
        }
        if (m[0] === '') re.lastIndex++;
        if (rows.length >= 200000) break;
      }
      const columns = [];
      for (let i = 0; i < Math.max(1, maxGroup); i++) columns.push({ key: 'c' + i, label: m && m.length > 1 ? '分组 ' + (i + 1) : '匹配' });
      const objs = rows.map((g) => {
        const o = {};
        for (let i = 0; i < columns.length; i++) o['c' + i] = g[i] == null ? '' : g[i];
        return o;
      });
      const joinStr = String(opts.join == null ? '\t' : opts.join).replace(/\\t/g, '\t').replace(/\\n/g, '\n');
      const textOut = rows.map((g) => g.join(joinStr)).join('\n');
      return {
        text: textOut,
        tabLabel: '提取结果',
        lang: 'text',
        tabs: [{ label: '表格 (' + rows.length + ')', view: 'table', data: { columns: columns, rows: objs, name: 'extract', filterHint: '过滤结果' } }],
        stats: [{ k: '条数', v: rows.length }, { k: '分组', v: maxGroup }],
        notices: rows.length ? null : [{ level: 'warn', msg: '没有匹配到内容，检查正则是否包含分组' }],
        filename: 'extract',
      };
    },
  });

  SK.tool({
    id: 'text-tools',
    name: '文本处理',
    group: 'text',
    icon: '≡',
    aliases: 'text 行处理 去重 排序 反转 前后缀 编号',
    keywords: ['文本', '行处理', '去重', '排序', '反转', '前后缀', '编号', '大小写'],
    desc: '行级批处理：去重 / 排序 / 反转 / 去空行 / 去首尾空白 / 加前后缀 / 加序号 / 改大小写 / 提取 URL 和 IP / 统计',
    sample: 'urls',
    inputs: [{ id: 'in', label: '文本', placeholder: '一行一条', sample: 'urls' }],
    options: [
      { id: 'op', type: 'select', label: '操作', value: 'dedupe', choices: [
        { v: 'dedupe', label: '去重（保序）' },
        { v: 'dedupeCount', label: '去重 + 计数' },
        { v: 'sort', label: '排序 A→Z' },
        { v: 'sortNum', label: '按数字排序' },
        { v: 'reverse', label: '反转顺序' },
        { v: 'shuffle', label: '随机打乱' },
        { v: 'dropEmpty', label: '删空行' },
        { v: 'trim', label: '去首尾空白' },
        { v: 'prefix', label: '加前缀' },
        { v: 'suffix', label: '加后缀' },
        { v: 'number', label: '加序号' },
        { v: 'quote', label: '加引号+逗号' },
        { v: 'upper', label: '转大写' },
        { v: 'lower', label: '转小写' },
        { v: 'urls', label: '提取 URL' },
        { v: 'ips', label: '提取 IP' },
        { v: 'emails', label: '提取邮箱' },
        { v: 'nums', label: '提取数字' },
        { v: 'dedupeDomain', label: '提取域名并去重' },
        { v: 'stat', label: '统计信息' },
      ] },
      { id: 'arg', type: 'text', label: '参数', value: 'https://a.com/', placeholder: '前缀/后缀内容、序号起始' },
      { id: 'ci', type: 'toggle', label: '忽略大小写', value: false },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).replace(/\r\n/g, '\n');
      if (!raw.trim()) return { error: '输入为空' };
      const lines = raw.split('\n');
      const arg = String(opts.arg == null ? '' : opts.arg);
      const ci = !!opts.ci;
      const keyOf = (s) => (ci ? s.toLowerCase() : s);
      let out = lines;
      let extra = null;
      switch (opts.op) {
        case 'dedupe': {
          /* 必须用无原型对象：普通 {} 上 seen['toString'] / ['constructor'] / ['__proto__']
             天生就是真值，会把同名文本行误判成“已出现过”而丢掉 */
          const seen = Object.create(null);
          out = lines.filter((l) => {
            const k = keyOf(l);
            if (seen[k]) return false;
            seen[k] = 1;
            return true;
          });
          const removed = lines.length - out.length;
          if (removed > 0) extra = '去除 ' + removed + ' 行重复';
          break;
        }
        case 'dedupeCount': {
          const cnt = Object.create(null);
          const order = [];
          lines.forEach((l) => {
            const k = keyOf(l);
            if (cnt[k] === undefined) { cnt[k] = 0; order.push(l); }
            cnt[k]++;
          });
          out = order.map((l) => l + '\t' + cnt[keyOf(l)]);
          break;
        }
        case 'sort': out = lines.slice().sort((a, b) => a.localeCompare(b, 'zh')); break;
        case 'sortNum': out = lines.slice().sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)); break;
        case 'reverse': out = lines.slice().reverse(); break;
        case 'shuffle': {
          out = lines.slice();
          for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = out[i]; out[i] = out[j]; out[j] = t;
          }
          break;
        }
        case 'dropEmpty': out = lines.filter((l) => l.trim() !== ''); break;
        case 'trim': out = lines.map((l) => l.trim()); break;
        case 'prefix': out = lines.map((l) => arg + l); break;
        case 'suffix': out = lines.map((l) => l + arg); break;
        case 'number': {
          const startAt = Number(arg || 1) || 1;
          out = lines.map((l, i) => startAt + i + '. ' + l);
          break;
        }
        case 'quote': out = lines.map((l) => '"' + l.replace(/"/g, '\\"') + '",'); break;
        case 'upper': out = lines.map((l) => l.toUpperCase()); break;
        case 'lower': out = lines.map((l) => l.toLowerCase()); break;
        case 'urls': out = (raw.match(/https?:\/\/[^\s"'<>()\][]+/g) || []); break;
        case 'ips': out = (raw.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []); break;
        case 'emails': out = (raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []); break;
        case 'nums': out = (raw.match(/-?\d+(?:\.\d+)?/g) || []); break;
        case 'dedupeDomain': {
          const set = Object.create(null);
          (raw.match(/https?:\/\/[^\s"'<>()\][]+/g) || []).forEach((u) => {
            try { set[new URL(u).hostname] = 1; } catch (e) {}
          });
          out = Object.keys(set).sort();
          break;
        }
        case 'stat': {
          const chars = raw.length;
          const words = (raw.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_]+/g) || []).length;
          const len = lines.map((l) => l.length);
          const avg = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
          out = ['行数: ' + lines.length, '字符数: ' + chars, '字节数(UTF-8): ' + new TextEncoder().encode(raw).length, '词数(中日韩按字): ' + words, '平均行长: ' + avg.toFixed(1), '最长行: ' + Math.max.apply(null, len), '含 http 行: ' + lines.filter((l) => /https?:\/\//.test(l)).length];
          break;
        }
        default: out = lines;
      }
      const text = out.join('\n');
      return {
        text: text,
        lang: 'text',
        stats: [{ k: '行数', v: out.length }, { k: '字符', v: SK.dom.fmtNum(text.length) }],
        notices: extra ? [{ level: 'ok', msg: extra }] : null,
        filename: 'text',
      };
    },
  });
})();
