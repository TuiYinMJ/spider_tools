/* ============================================================================
   Spider Lab · crawl.js
   爬虫工程配套：代理格式转换 / m3u8 解析 / gzip 解压
   ========================================================================== */
(function () {

  /* ============================================================
   * 代理格式转换
   * ============================================================ */
  SK.tool({
    id: 'proxy-fmt',
    name: '代理格式转换',
    group: 'spider',
    icon: '⇄',
    aliases: 'proxy 代理 proxies 转换 requests feapder clash shell',
    keywords: ['proxy', '代理', '转换', 'requests', 'feapder', 'clash', 'shell', '爬虫'],
    desc: '代理商给的代理串一键转成 requests / urllib / feapder / curl / Clash / shell 环境变量格式，支持认证代理、去重、协议指定',
    sample: 'proxy',
    hint: '每行一个：ip:port、user:pass@ip:port、ip:port:user:pass、http://ip:port 都能识别',
    inputs: [{ id: 'in', label: '代理列表', placeholder: '1.2.3.4:8080\nuser:pass@5.6.7.8:3128', sample: 'proxy' }],
    options: [
      { id: 'scheme', type: 'select', label: '协议', value: 'http', choices: [{ v: 'http', label: 'http' }, { v: 'https', label: 'https' }, { v: 'socks5', label: 'socks5' }, { v: 'keep', label: '保留输入里的' }] },
      { id: 'out', type: 'select', label: '输出', value: 'requests', choices: [
        { v: 'requests', label: 'requests proxies' },
        { v: 'session', label: 'requests + Session 示例' },
        { v: 'feapder', label: 'feapder' },
        { v: 'curl', label: 'curl -x' },
        { v: 'shell', label: 'shell export' },
        { v: 'clash', label: 'Clash YAML' },
        { v: 'plain', label: '规范列表' },
      ] },
      { id: 'dedupe', type: 'toggle', label: '去重', value: true },
      { id: 'shuffle', type: 'toggle', label: '打乱顺序', value: false },
    ],
    help:
      '<h4>支持的输入</h4>' +
      '<pre>1.2.3.4:8080                 裸 ip:port\nuser:pass@1.2.3.4:8080       认证前置\n1.2.3.4:8080:user:pass       认证后置（代理商常见）\nhttp://user:pass@1.2.3.4:8080  带 scheme\nsocks5://1.2.3.4:1080        socks</pre>' +
      '<h4>输出说明</h4>' +
      '<ul><li><b>requests proxies</b>：直接可用的 proxies dict</li>' +
      '<li><b>feapder</b>：feapder 的 proxy 参数格式（ip:port 或带认证 URL）</li>' +
      '<li><b>Clash YAML</b>：proxies 列表段，粘进配置文件</li>' +
      '<li><b>shell export</b>：http_proxy/https_proxy 环境变量（认证会写入）</li></ul>' +
      '<p>提示：socks 代理在 requests 里需要 <code>pip install requests[socks]</code>。</p>',
    handler: function (input, opts) {
      let lines = String(input == null ? '' : input)
        .split('\n').map(function (l) { return l.trim().replace(/^["']|["'];?$/g, ''); })
        .filter(function (l) { return l && !l.startsWith('#') && l.indexOf('.') > 0; });
      if (!lines.length) return { error: '没有识别到代理', hint: '每行一个，支持 ip:port / user:pass@ip:port / ip:port:user:pass' };

      const parseOne = function (raw) {
        let scheme = '';
        let rest = raw;
        const sm = /^(\w+):\/\//.exec(raw);
        if (sm) { scheme = sm[1].toLowerCase(); rest = raw.slice(sm[0].length); }
        let auth = '', hostPart = rest;
        const am = /^([^@\/]+)@/.exec(rest);
        if (am) { auth = am[1]; hostPart = rest.slice(am[0].length); }
        else {
          /* ip:port:user:pass —— 4 段且后两段不含点号 */
          const parts = rest.split(':');
          if (parts.length === 4 && parts[0].indexOf('.') > 0 && parts[3].indexOf('.') < 0) {
            hostPart = parts[0] + ':' + parts[1];
            auth = parts[2] + ':' + parts[3];
          }
        }
        const hm = /^([\w.-]+):(\d+)/.exec(hostPart);
        if (!hm) return null;
        return { scheme: scheme || null, host: hm[1], port: hm[2], user: auth ? auth.split(':')[0] : '', pass: auth ? auth.slice(auth.indexOf(':') + 1) : '' };
      };

      const parsed = [];
      const seen = {};
      let bad = 0;
      lines.forEach(function (l) {
        const p = parseOne(l);
        if (!p) { bad++; return; }
        const key = p.host + ':' + p.port + ':' + p.user;
        if (opts.dedupe && seen[key]) return;
        seen[key] = 1;
        if (opts.scheme !== 'keep') p.scheme = opts.scheme;
        parsed.push(p);
      });
      if (!parsed.length) return { error: '解析全部失败', hint: '检查格式：每行 ip:port 或 user:pass@ip:port' };
      if (opts.shuffle) parsed.sort(function () { return Math.random() - 0.5; });

      const urlOf = function (p, withAuth) {
        const s = p.scheme || 'http';
        return s + '://' + (withAuth && p.user ? p.user + ':' + p.pass + '@' : '') + p.host + ':' + p.port;
      };
      const authURL = urlOf(parsed[0], true);
      const bareHost = parsed[0].host + ':' + parsed[0].port;

      let out = '';
      let lang = 'text';
      if (opts.out === 'requests') {
        lang = 'python';
        /* 原实现把 N 条代理平铺进同一个 dict，重复的 "http"/"https" 键在 Python 里只有最后一条生效，
           等于整个代理池静默退化成一条。改为「池 + 单条」两段式。 */
        out = [
          'import random',
          '',
          'PROXY_POOL = [',
          parsed.map(function (p) { return '    "' + urlOf(p, true) + '",'; }).join('\n'),
          ']',
          '',
          'def pick_proxy():',
          '    p = random.choice(PROXY_POOL)',
          '    return {"http": p, "https": p}',
          '',
          '# requests.get(url, proxies=pick_proxy(), timeout=10)',
        ].join('\n');
      } else if (opts.out === 'session') {
        lang = 'python';
        out = [
          'import requests',
          '',
          'proxies = {"http": "' + authURL + '", "https": "' + authURL + '"}',
          'sess = requests.Session()',
          'sess.proxies = proxies',
          'sess.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0"})',
          '',
          'r = sess.get("https://httpbin.org/ip", timeout=10)',
          'print(r.status_code, r.text)',
          '',
          '# 代理池轮换：每次请求前换一条',
          'POOL = [',
          parsed.slice(0, 20).map(function (p) { return '    "' + urlOf(p, true) + '",'; }).join('\n'),
          ']',
          'import itertools, random',
          'def next_proxy():',
          '    return {"http": random.choice(POOL), "https": random.choice(POOL)}',
        ].join('\n');
      } else if (opts.out === 'feapder') {
        lang = 'python';
        out = [
          '# feapder 里的用法（Spider 里）',
          'PROXY_POOL = [',
          parsed.slice(0, 30).map(function (p) { return '    "' + (p.user ? urlOf(p, true) : p.host + ':' + p.port) + '",'; }).join('\n'),
          ']',
          '',
          '# 请求时传 proxy 参数（feapder 支持带认证的 URL 或裸 ip:port）',
          'def download(self, url):',
          '    proxy = random.choice(PROXY_POOL)',
          '    resp = requests.get(url, proxies={"http": proxy, "https": proxy}, timeout=10)',
          '    return resp',
        ].join('\n');
      } else if (opts.out === 'curl') {
        lang = 'shell';
        out = parsed.slice(0, 50).map(function (p) { return 'curl -x ' + urlOf(p, true) + ' https://httpbin.org/ip'; }).join('\n');
      } else if (opts.out === 'shell') {
        lang = 'shell';
        /* 原来只导出第一条代理；多条时给出轮换函数 */
        if (parsed.length === 1) {
          out = 'export http_proxy="' + authURL + '"\nexport https_proxy="' + authURL + '"\nexport no_proxy="localhost,127.0.0.1"\n# 取消：unset http_proxy https_proxy';
        } else {
          out = [
            '# ' + parsed.length + ' 条代理轮换（shuffle 后依次 export）',
            'PROXIES=(',
            parsed.map(function (p) { return '  "' + urlOf(p, true) + '"'; }).join('\n'),
            ')',
            'SHUFFLED=($(printf "%s\\n" "${PROXIES[@]}" | shuf))',
            'export http_proxy="${SHUFFLED[0]}"',
            'export https_proxy="${SHUFFLED[0]}"',
            'export no_proxy="localhost,127.0.0.1"',
            '# 取消：unset http_proxy https_proxy',
          ].join('\n');
        }
      } else if (opts.out === 'clash') {
        lang = 'yaml';
        out = 'proxies:\n' + parsed.slice(0, 100).map(function (p, i) {
          const t = p.scheme === 'socks5' ? 'socks5' : 'http';
          return [
            '  - name: "p' + (i + 1) + '"',
            '    type: ' + t,
            '    server: ' + p.host,
            '    port: ' + p.port,
            p.user ? '    username: "' + p.user + '"' : null,
            p.pass ? '    password: "' + p.pass + '"' : null,
          ].filter(Boolean).join('\n');
        }).join('\n');
      } else {
        out = parsed.map(function (p) { return urlOf(p, true); }).join('\n');
      }

      return {
        text: out,
        lang: lang,
        stats: [
          { k: '有效', v: parsed.length },
          bad ? { k: '无法解析', v: bad, level: 'warn' } : null,
          { k: '带认证', v: parsed.filter(function (p) { return p.user; }).length },
          opts.dedupe ? { k: '去重', v: '开' } : null,
        ].filter(Boolean),
        notices: parsed.length >= 100 && opts.out === 'clash' ? [{ level: 'info', msg: 'Clash 输出只取前 100 条' }] : null,
        filename: 'proxies',
      };
    },
  });

  /* ============================================================
   * m3u8 解析
   * ============================================================ */
  SK.tool({
    id: 'm3u8',
    name: 'm3u8 解析',
    group: 'spider',
    icon: '▶',
    aliases: 'm3u8 hls ts 视频分片 ffmpeg aria2 直播',
    keywords: ['m3u8', 'hls', 'ts', '视频', '分片', 'ffmpeg', 'aria2', '下载', '直播'],
    desc: '解析 m3u8 播放列表：分片 URL 补全、EXT-X-KEY 解密参数、总时长统计，生成 ffmpeg / aria2 / N_m3u8DL 下载命令',
    sample: 'm3u8',
    hint: '粘贴 m3u8 内容；如果是 master 列表会列出所有清晰度子列表',
    inputs: [
      { id: 'in', label: 'm3u8 内容', placeholder: '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg-001.ts', sample: 'm3u8' },
      { id: 'base', label: 'm3u8 的 URL（补全相对路径用，可选）', placeholder: 'https://cdn.example.com/v/2024/index.m3u8', small: true, allowEmpty: true },
    ],
    options: [
      { id: 'cmd', type: 'select', label: '下载命令', value: 'ffmpeg', choices: [
        { v: 'ffmpeg', label: 'ffmpeg' },
        { v: 'aria2', label: 'aria2 清单' },
        { v: 'nm3u8dl', label: 'N_m3u8DL-RE' },
        { v: 'none', label: '不用命令' },
      ] },
    ],
    help:
      '<h4>怎么看</h4>' +
      '<ul><li><b>master 列表</b>（含 EXT-X-STREAM-INF）：只是清晰度目录，抓真正的视频要先挑一条子列表再请求</li>' +
      '<li><b>媒体列表</b>（含 EXTINF + 分片）：真正的视频分片，全下完合并即完整视频</li>' +
      '<li><b>EXT-X-KEY</b>：有它说明分片加密；METHOD=AES-128 时记下 URI 和 IV，解密 key 通常也是一个要抓的请求</li></ul>' +
      '<h4>直播流</h4>' +
      '<p>含 EXT-X-ENDLIST 的是点播；没有的是直播，分片一直在增长，下载方式不同（ffmpeg 挂着录）。</p>',
    handler: function (input, base, opts) {
      const text = String(input == null ? '' : input).trim();
      const baseUrl = String(base == null ? '' : base).trim();
      if (!text) return { error: '输入为空', hint: 'DevTools 里找 .m3u8 请求，复制响应体粘贴进来；URL 填到第二个框' };
      if (text.indexOf('#EXTM3U') < 0) return { error: '不是 m3u8 内容', hint: '第一行应该是 #EXTM3U；确认复制的是响应体而不是页面 HTML' };

      const resolve = function (u) {
        if (!u) return u;
        if (/^https?:\/\//i.test(u)) return u;
        if (!baseUrl) return u;
        try { return new URL(u, baseUrl).href; } catch (e) { return u; }
      };

      const lines = text.split(/\r?\n/);
      const master = [];
      const segs = [];
      const keys = {};
      const maps = [];
      let duration = 0;
      let curDur = 0;
      let isMaster = false;
      let targetDur = 0;
      let mediaSeq = 0;
      let live = true;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.indexOf('#EXT') === 0) {
          const tag = line.split(':')[0];
          const val = line.indexOf(':') > 0 ? line.slice(line.indexOf(':') + 1) : '';
          if (tag === '#EXT-X-STREAM-INF') {
            isMaster = true;
            const bw = /BANDWIDTH=(\d+)/.exec(val);
            const res = /RESOLUTION=(\d+x\d+)/.exec(val);
            let next = '';
            for (let k = i + 1; k < lines.length; k++) {
              const t = lines[k].trim();
              if (t && t.indexOf('#') !== 0) { next = t; i = k; break; }
            }
            master.push({ bandwidth: bw ? Number(bw[1]) : 0, res: res ? res[1] : '', url: resolve(next), rawUrl: next });
          } else if (tag === '#EXTINF') {
            curDur = parseFloat(val) || 0;
          } else if (tag === '#EXT-X-KEY') {
            const method = /METHOD=([A-Za-z0-9-]+)/.exec(val);
            const uri = /URI="([^"]+)"/.exec(val);
            const iv = /IV=0[xX]([0-9a-fA-F]+)/.exec(val);
            keys[method ? method[1] : 'NONE'] = {
              method: method ? method[1] : 'NONE',
              uri: uri ? resolve(uri[1]) : '',
              iv: iv ? '0x' + iv[1] : '(序列号派生)',
            };
          } else if (tag === '#EXT-X-MAP') {
            const uri = /URI="([^"]+)"/.exec(val);
            if (uri) maps.push(resolve(uri[1]));
          } else if (tag === '#EXT-X-TARGETDURATION') {
            targetDur = Number(val) || 0;
          } else if (tag === '#EXT-X-MEDIA-SEQUENCE') {
            mediaSeq = Number(val) || 0;
          } else if (tag === '#EXT-X-ENDLIST') {
            live = false;
          }
        } else if (line.indexOf('#') !== 0) {
          segs.push({ n: segs.length + 1, sec: curDur, url: resolve(line), raw: line });
          duration += curDur;
          curDur = 0;
        }
      }

      const fmtDur = function (s) {
        if (!s || s < 0) return '0s';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.round(s % 60);
        return (h ? h + '时' : '') + (m ? m + '分' : '') + sec + '秒';
      };

      if (isMaster) {
        const rows = master.slice().sort(function (a, b) { return b.bandwidth - a.bandwidth; });
        const text2 = rows.map(function (r) { return (r.res || '?') + '\t' + Math.round(r.bandwidth / 1000) + ' kbps\t' + r.url; }).join('\n');
        return {
          text: text2,
          lang: 'text',
          tabLabel: '清晰度列表',
          tabs: [
            { label: '清晰度 (' + rows.length + ')', view: 'table', data: {
              columns: [{ key: 'res', label: '分辨率', width: '110px' }, { key: 'kbps', label: '码率', width: '100px' }, { key: 'url', label: '子列表 URL' }],
              rows: rows.map(function (r) { return { res: r.res || '(未知)', kbps: Math.round(r.bandwidth / 1000) + ' kbps', url: r.url }; }),
              name: 'm3u8-master',
            } },
          ],
          stats: [{ k: '类型', v: 'master 目录' }, { k: '清晰度', v: rows.length }],
          notices: [{ level: 'info', msg: '这是 master 列表：挑一条子列表 URL 重新请求，把响应贴回来才是分片数据' }],
          filename: 'm3u8',
        };
      }

      const keyList = Object.keys(keys).map(function (k) { return keys[k]; });
      const encrypted = keyList.length > 0 && keyList[0].method !== 'NONE';
      const segUrls = segs.map(function (s) { return s.url; });
      const aria2List = maps.concat(segUrls).join('\n');

      let cmd = '';
      if (opts.cmd === 'ffmpeg') {
        const src = baseUrl || 'PLAYLIST_URL';
        cmd = '# 下载合并一步到位（推荐）\nffmpeg -i "' + src + '" -c copy output.mp4';
        if (encrypted) cmd += '  # 有 AES-128 加密，ffmpeg 会自动请求 key（URI: ' + (keyList[0].uri || '同目录 key.key') + '）';
        cmd += '\n\n# 只想看看/慢网络：限速 + 重试\nffmpeg -retries 10 -i "' + src + '" -c copy output.mp4';
        if (live) cmd = '# ⚠ 这是直播流（无 ENDLIST）：录制用下面的命令，Ctrl+C 结束\nffmpeg -i "' + src + '" -c copy -f mp4 record.mp4';
      } else if (opts.cmd === 'aria2') {
        cmd = '# 先下载 key（如果有加密）\n' + (encrypted ? 'curl -o key.key "' + (keyList[0].uri || '') + '"\n' : '') +
          '# 下载全部分片（-i 喂清单，16 并发）\naria2c -i seg.list -x 16 -j 16 --retry-wait=2 --max-tries=10\n' +
          '# 合并（分片按序拼接即可，TS 流直接 cat）\ncat seg-*.ts > all.ts   # 或 ffmpeg -i "concat:$(ls *.ts | tr \'\\n\' \'|\')" -c copy out.mp4';
      } else if (opts.cmd === 'nm3u8dl') {
        cmd = 'N_m3u8DL-RE "' + (baseUrl || 'PLAYLIST_URL') + '" --save-name video --thread-count 16 --retry-count 5\n# 自动处理 key / 合并 / 转 mp4，最省心';
      }

      return {
        text: segUrls.join('\n'),
        lang: 'text',
        tabLabel: '分片 URL (' + segs.length + ')',
        tabs: [
          { label: '分片表 (' + segs.length + ')', view: 'table', data: {
            columns: [{ key: 'n', label: '#', width: '56px' }, { key: 'sec', label: '时长(s)', width: '80px' }, { key: 'raw', label: '原始路径', width: 'minmax(150px,260px)' }, { key: 'url', label: '完整 URL' }],
            rows: segs.slice(0, 2000),
            name: 'm3u8-segs',
            filterHint: '过滤分片',
          } },
          encrypted ? { label: '解密参数', view: 'fields', data: [
            { k: '加密方式', v: keyList[0].method, copy: true },
            { k: 'Key URI', v: keyList[0].uri, copy: true },
            { k: 'IV', v: keyList[0].iv, copy: true },
            { k: '提示', v: 'AES-128-CBC：key 是 URI 返回的 16 字节；IV 没写时用分片序号的 128 位大端表示' },
          ] } : { label: '解密参数', text: '分片未加密，直接下载合并即可', lang: 'text' },
          maps.length ? { label: '初始化段', text: maps.join('\n'), lang: 'text' } : null,
          cmd ? { label: '下载命令', text: cmd, lang: 'shell' } : null,
          { label: 'aria2 清单', text: aria2List, lang: 'text' },
        ].filter(Boolean),
        stats: [
          { k: '分片', v: SK.dom.fmtNum(segs.length) },
          { k: '总时长', v: fmtDur(duration) },
          { k: '平均分片', v: (segs.length ? (duration / segs.length).toFixed(1) : 0) + 's' },
          { k: '加密', v: encrypted ? keyList[0].method : '无' },
          { k: '类型', v: live ? '直播' : '点播' },
          targetDur ? { k: '目标时长', v: targetDur + 's' } : null,
        ].filter(Boolean),
        notices: [].concat(
          encrypted ? [{ level: 'warn', msg: '分片已加密（' + keyList[0].method + '），先抓 Key URI 的请求拿到 16 字节 key' }] : [],
          !baseUrl && segs.some(function (s) { return !/^https?:/.test(s.url); }) ? [{ level: 'warn', msg: '分片是相对路径且没填 m3u8 URL，完整 URL 无法补全：把播放列表地址填到第二个输入框' }] : []
        ),
        filename: 'm3u8-segments',
      };
    },
  });

  /* ============================================================
   * 压缩解码（gzip / deflate / zlib / brotli）
   * ============================================================ */
  SK.tool({
    id: 'gunzip',
    name: '压缩解码',
    group: 'codec',
    icon: '🗜',
    aliases: 'gzip gunzip deflate zlib br brotli 解压 压缩 base64 hex',
    keywords: ['gzip', 'deflate', 'zlib', 'brotli', 'br', '解压', '压缩', 'base64', 'hex', '逆向'],
    desc: '解压 gzip / deflate / zlib / brotli 数据：逆向常见的「base64(gzip(payload))」一层扒开，自动嗅探格式，解出 JSON 自动给结构树',
    sample: 'gzip',
    hint: '响应/参数里疑似乱码的 base64 串，先试试它是不是压缩数据',
    inline: true,
    inputs: [{ id: 'in', label: '压缩数据', placeholder: 'H4sIAAAAAAAAC…（base64）或 1f8b…（hex）', sample: 'gzip' }],
    options: [
      { id: 'enc', type: 'select', label: '输入编码', value: 'auto', choices: [
        { v: 'auto', label: '自动识别' },
        { v: 'b64', label: 'Base64' },
        { v: 'urlsafe', label: 'URL-safe Base64' },
        { v: 'hex', label: '十六进制' },
        { v: 'raw', label: '原始文本(latin1)' },
      ] },
      { id: 'fmt', type: 'select', label: '压缩格式', value: 'auto', choices: [
        { v: 'auto', label: '自动（魔数判断）' },
        { v: 'gzip', label: 'gzip' },
        { v: 'deflate', label: 'zlib (deflate)' },
        { v: 'deflate-raw', label: 'deflate-raw' },
        { v: 'br', label: 'brotli' },
      ] },
      { id: 'out', type: 'select', label: '输出', value: 'text', choices: [{ v: 'text', label: '文本' }, { v: 'hex', label: '十六进制' }, { v: 'b64', label: 'Base64' }] },
    ],
    handler: async function (input, opts, hooks) {
      const raw = String(input == null ? '' : input).trim();
      if (!raw) return { error: '输入为空' };

      /* base64 → bytes / hex → bytes */
      const b64ToBytes = function (s) {
        let t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
        while (t.length % 4) t += '=';
        const bin = atob(t);
        const b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return b;
      };
      const hexToBytes = function (s) {
        const t = s.replace(/0x/gi, '').replace(/[\s,]/g, '');
        if (!/^[0-9a-f]+$/i.test(t) || t.length % 2) throw new Error('hex 内容不合法');
        const b = new Uint8Array(t.length / 2);
        for (let i = 0; i < b.length; i++) b[i] = parseInt(t.substr(i * 2, 2), 16);
        return b;
      };

      let enc = opts.enc;
      if (enc === 'auto') {
        if (/^[A-Za-z0-9+/\-_=\s]+$/.test(raw) && !/^\s*[0-9a-fA-F\s]+$/.test(raw)) enc = /[-_]/.test(raw.replace(/=/g, '')) ? 'urlsafe' : 'b64';
        else if (/^[0-9a-fA-F\s,]+$/.test(raw)) enc = 'hex';
        else enc = 'b64';
      }
      let bytes;
      try {
        if (enc === 'hex') bytes = hexToBytes(raw);
        else if (enc === 'raw') {
          bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) {
            const c = raw.charCodeAt(i);
            if (c > 255) return { error: '原始文本含非 latin1 字符', hint: '改用 Base64 / Hex 输入' };
            bytes[i] = c;
          }
        } else bytes = b64ToBytes(raw);
      } catch (e) {
        return { error: (enc === 'hex' ? 'hex' : 'Base64') + ' 解码失败：' + e.message };
      }
      if (!bytes.length) return { error: '没解出字节数据' };

      const sniff = function (b) {
        if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
        /* zlib 头：CMF=0x78 且 (CMF*256+FLG) % 31 == 0（78 01 / 78 9c / 78 da / 78 5e） */
        if (b.length >= 2 && b[0] === 0x78 && ((b[0] << 8) | b[1]) % 31 === 0) return 'deflate';
        return 'deflate-raw';
      };
      /* 'br' 是 UI 选项值，DecompressionStream 的合法枚举值是 'brotli'。
         之前直接把 'br' 传进去必然抛异常，再被 deflate-raw 兜底成垃圾字节。 */
      const FMT_ALIAS = { br: 'brotli', brotli: 'brotli', gzip: 'gzip', deflate: 'deflate', 'deflate-raw': 'deflate-raw' };
      const isAuto = (opts.fmt || 'auto') === 'auto';
      let fmt = isAuto ? sniff(bytes) : (FMT_ALIAS[opts.fmt] || opts.fmt);

      if (typeof DecompressionStream === 'undefined') {
        return { error: '当前浏览器不支持 DecompressionStream', hint: 'Chrome 80+ / Edge / Safari 16.4+ 可用' };
      }

      const tryInflate = async function (format, data) {
        try {
          const ds = new DecompressionStream(format);
          const stream = new Blob([data]).stream().pipeThrough(ds);
          const buf = await new Response(stream).arrayBuffer();
          return new Uint8Array(buf);
        } catch (e) {
          return null;
        }
      };

      let outBytes = await tryInflate(fmt, bytes);
      const attempted = [fmt].filter(Boolean);
      /* 只有「自动」模式才允许换格式重试。用户明确选了格式时，解不开就报错，
         绝不能静默用别的算法糊出一个结果——那是最危险的失败方式。 */
      if (!outBytes && isAuto) {
        /* deflate-raw 对任意字节都可能"解成功"并吐垃圾，必须放最后试 */
        for (const f of ['gzip', 'deflate', 'brotli', 'deflate-raw']) {
          if (attempted.indexOf(f) >= 0) continue;
          attempted.push(f);
          outBytes = await tryInflate(f, bytes);
          if (outBytes) { fmt = f + '（自动纠正）'; break; }
        }
      }
      if (!outBytes || !outBytes.length) {
        return {
          error: '解压失败：不是 ' + attempted.join(' / ') + ' 数据',
          hint: isAuto
            ? '确认输入编码（Base64/Hex）没选错；也可能是自定义加密后的数据'
            : '你指定的格式解不开，换成「自动」再试；若确实是 brotli，确认浏览器支持 DecompressionStream("brotli")',
        };
      }

      const toHex = function (b) {
        let s = '';
        for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        return s;
      };
      const toB64 = function (b) {
        let s = '';
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s);
      };

      let text = '';
      let utf8ok = true;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(outBytes); } catch (e) { utf8ok = false; text = new TextDecoder('utf-8').decode(outBytes); }

      let out;
      if (opts.out === 'hex') out = toHex(outBytes);
      else if (opts.out === 'b64') out = toB64(outBytes);
      else out = text;

      /* 解压结果是 JSON 时自动附结构树，逆向的压缩 payload 十有八九是 JSON */
      const tabs = outBytes.length <= 1024 * 1024 ? [
        { label: 'Hex 预览', text: toHex(outBytes.slice(0, 4096)), lang: 'text' },
      ] : [];
      let jsonNote = null;
      if (text.length > 1 && /^[{[]/.test(text.trim()) && text.length < 3 * 1024 * 1024) {
        try {
          const obj = JSON.parse(text);
          if (obj && typeof obj === 'object' && SK.tools /* worker 里也有 registry */) {
            let nodeCount = 0;
            const count = function (v) { nodeCount++; if (nodeCount > 20000) return; if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { count(v[k]); }); };
            count(obj);
            if (nodeCount <= 20000) tabs.unshift({ label: '结构树', view: 'tree', data: obj });
            jsonNote = { level: 'ok', msg: '解压结果是 JSON' + (nodeCount <= 20000 ? '，已生成结构树' : '（过大未生成树）') };
          }
        } catch (e) { /* 不是合法 JSON，忽略 */ }
      }

      const ratio = bytes.length ? (100 - (outBytes.length / bytes.length) * 100).toFixed(1) : 0;
      return {
        text: out,
        lang: opts.out === 'text' ? 'text' : 'text',
        stats: [
          { k: '压缩前', v: SK.dom.fmtBytes(bytes.length) },
          { k: '解压后', v: SK.dom.fmtBytes(outBytes.length) },
          { k: '膨胀率', v: (outBytes.length / Math.max(1, bytes.length)).toFixed(1) + 'x' },
          { k: '格式', v: fmt },
        ],
        notices: [utf8ok ? null : { level: 'warn', msg: '解压结果不是合法 UTF-8：可能是二进制数据，建议切到 Hex 输出查看' }, jsonNote].filter(Boolean),
        tabs: tabs,
        filename: 'inflated',
        next: [
          { label: '{ } JSON 格式化+结构树', tool: 'json' },
        ],
      };
    },
  });
})();
