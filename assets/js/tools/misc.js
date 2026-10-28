/* 其他工具：时间转换 / 加解密 / Base64 图片 / 代码分享 / cron 解析 */
(function () {
  const { el } = SK.dom;

  /* ---------------- 图片视图 ---------------- */
  SK.view('image', function (host, data) {
    if (!data || !data.b64) {
      host.appendChild(el('div', { class: 'out-error', text: '没有图片数据' }));
      return;
    }
    const uri = data.mime ? 'data:' + data.mime + ';base64,' + data.b64 : 'data:image/png;base64,' + data.b64;
    const img = el('img', { class: 'img-preview', src: uri });
    const info = el('div', { class: 'img-info' });
    img.addEventListener('load', () => {
      info.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px · ' + SK.dom.fmtBytes(data.bytes || 0);
    });
    const box = el('div', { class: 'img-box' }, [img]);
    const zoom = el('input', { type: 'range', min: '10', max: '300', value: '100', class: 'img-zoom', onInput: (e) => (img.style.width = e.target.value + '%') });
    const bar = el('div', { class: 'pv-bar' }, [
      el('span', { class: 'pv-title', text: data.mime || 'image' }),
      el('span', { class: 'pane-spacer' }),
      zoom,
      el('button', { class: 'btn tiny', text: '下载', onClick: () => {
          try {
            const blob = new Blob([SK.crypt.fromB64(data.b64)], { type: data.mime || 'application/octet-stream' });
            SK.dom.download(blob, data.name || 'image');
          } catch (e) {
            SK.ui.toast('下载失败：' + e.message, 'error');
          }
        } }),
      el('button', { class: 'btn tiny', text: '复制 Base64', onClick: () => SK.dom.copy(data.b64).then(() => SK.ui.toast('已复制 Base64', 'ok')) }),
      el('button', { class: 'btn tiny', text: '复制 DataURI', onClick: () => SK.dom.copy(uri).then(() => SK.ui.toast('已复制 DataURI', 'ok')) }),
    ]);
    host.appendChild(bar);
    host.appendChild(box);
    host.appendChild(info);
  });

  /* ============================================================
   * 时间转换
   * ============================================================ */
  SK.tool({
    id: 'time',
    name: '时间转换',
    group: 'misc',
    icon: '⏱',
    aliases: 'time timestamp 时间戳 转换 日期',
    keywords: ['时间', '时间戳', 'timestamp', '日期', '时区', 'unix'],
    desc: '时间戳 ↔ 日期互转：自动识别秒/毫秒/微秒/纳秒，支持批量、任意时区偏移、相对时间与星期',
    sample: 'times',
    inputs: [{ id: 'in', label: '时间戳 / 日期（可多行）', placeholder: '1729900800 或 2026-10-23 21:51:46', sample: 'times' }],
    allowEmpty: true,
    options: [
      { id: 'from', type: 'seg', label: '输入', value: 'auto', choices: [{ v: 'auto', label: '自动' }, { v: 's', label: '秒' }, { v: 'ms', label: '毫秒' }] },
      { id: 'tz', type: 'select', label: '时区', value: '8', choices: [{ v: '8', label: 'UTC+8 北京' }, { v: '0', label: 'UTC' }, { v: '9', label: 'UTC+9 东京' }, { v: '-5', label: 'UTC-5 纽约' }, { v: '-8', label: 'UTC-8 洛杉矶' }, { v: '7', label: 'UTC+7 曼谷' }] },
      { id: 'now', type: 'toggle', label: '空输入用当前时间', value: true },
    ],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).trim();
      const tz = Number(opts.tz || 8);
      const lines = raw ? raw.split('\n').map((l) => l.trim()).filter(Boolean) : ['now'];
      const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const pad = (n) => String(n).padStart(2, '0');
      const fmtLocal = (ms) => {
        const d = new Date(ms + tz * 3600 * 1000);
        const g = (k) => d['getUTC' + k]();
        return g('FullYear') + '-' + pad(g('Month') + 1) + '-' + pad(g('Date')) + ' ' + pad(g('Hours')) + ':' + pad(g('Minutes')) + ':' + pad(g('Seconds'));
      };
      const parseOne = (line) => {
        if (/^now$/i.test(line) || line === '') return Date.now();
        if (/^-?\d+(\.\d+)?$/.test(line)) {
          let n = Number(line);
          /* 单位判定必须把 us/ns 真正换算掉。旧实现识别出 'us'/'ns' 后什么也没做，
             直接把 1729900800000000 当毫秒用，算出公元 56788 年。 */
          const from = opts.from === 'auto'
            ? (Math.abs(n) >= 1e17 ? 'ns' : Math.abs(n) >= 1e14 ? 'us' : Math.abs(n) >= 1e11 ? 'ms' : 's')
            : opts.from;
          if (from === 's') n *= 1000;
          else if (from === 'us') n /= 1000;
          else if (from === 'ns') n /= 1e6;
          if (!isFinite(n)) return null;
          return Math.round(n);
        }
        /* 中文日期：2026年10月23日 08:00(:00) —— 接口文档、日志里非常常见 */
        const cn = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:[ T]*(\d{1,2})[:：时](\d{1,2})(?:[:：分](\d{1,2}))?分?秒?)?/.exec(line);
        if (cn) {
          const ms = Date.UTC(+cn[1], +cn[2] - 1, +cn[3], +(cn[4] || 0), +(cn[5] || 0), +(cn[6] || 0)) - tz * 3600 * 1000;
          if (!isNaN(ms)) return ms;
        }
        /* 2026/10/23 12:01:22 与 2026-10-23 12:01:22 走同一条（原实现只认连字符，
          斜杠形式落到 Date.parse，在非 UTC 环境会被当本地时间，结果差一个时区） */
        const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,3}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(line);
        if (iso) {
          const ms = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0), +((iso[7] || '0').padEnd(3, '0')));
          /* 显式带 Z/+08:00 时按字符串里的偏移算，不再套用界面时区 */
          if (iso[8]) {
            if (iso[8] === 'Z') return ms;
            const sign = iso[8][0] === '-' ? -1 : 1;
            const oh = Number(iso[8].slice(1, 3));
            const om = Number(iso[8].slice(-2));
            return ms - sign * (oh * 60 + om) * 60000;
          }
          return ms - tz * 3600 * 1000;
        }
        const t = Date.parse(line);
        return isNaN(t) ? null : t;
      };
      const rows = [];
      const OUT_OF_RANGE = 8.64e15; /* Date 可表示的最大毫秒 */
      for (const line of lines.slice(0, 2000)) {
        const ms = parseOne(line);
        if (ms === null || !isFinite(ms) || Math.abs(ms) > OUT_OF_RANGE) {
          rows.push({ input: line, out: Math.abs(ms) > OUT_OF_RANGE ? '超出可表示范围' : '无法解析' });
          continue;
        }
        const d = new Date(ms);
        rows.push({
          input: line,
          ts: Math.floor(ms / 1000),
          ms: ms,
          local: fmtLocal(ms) + ' (UTC' + (tz >= 0 ? '+' : '') + tz + ')',
          utc: d.toISOString().replace('T', ' ').replace('Z', ''),
          week: WEEK[new Date(ms + tz * 3600e3).getUTCDay()] || '',
          rel: relTime(ms),
        });
      }
      /* 批量里一条失败不该让整列变成空白：把原因写进同一行，用户才知道是哪条没解析 */
      rows.forEach((r) => {
        if (r.out && !r.local) {
          r.ts = ''; r.ms = ''; r.local = '⚠ ' + r.out; r.utc = ''; r.rel = '';
        }
      });
      function relTime(ms) {
        const diff = Date.now() - ms;
        const abs = Math.abs(diff);
        const unit = abs < 60000 ? [Math.round(abs / 1000), '秒'] : abs < 3600000 ? [Math.round(abs / 60000), '分钟'] : abs < 86400000 ? [Math.round(abs / 3600000), '小时'] : abs < 2592000000 ? [Math.round(abs / 86400000), '天'] : [Math.round(abs / 2592000000), '个月'];
        return diff >= 0 ? unit[0] + ' ' + unit[1] + '前' : unit[0] + ' ' + unit[1] + '后';
      }
      if (rows.length === 1) {
        const r = rows[0];
        if (r.out) return { error: '无法解析：' + r.input, hint: '支持 1729900800 / 1729900800000 / 1729900800000000（微秒）/ 2026-10-23 21:51:46 / 2026年10月23日 08:00 / ISO 8601' };
        return {
          tabs: [
            { label: '详情', view: 'fields', data: [
              { k: '时间戳（秒）', v: r.ts, copy: true },
              { k: '时间戳（毫秒）', v: r.ms, copy: true },
              { k: '北京时间', v: r.local, copy: true },
              { k: 'UTC', v: r.utc, copy: true },
              { k: '星期', v: r.week },
              { k: '相对现在', v: r.rel },
            ] },
            { label: '时间戳', text: String(r.ts) + '\n' + r.ms, lang: 'text' },
          ],
          stats: [{ k: '时间戳', v: r.ts }, { k: '本地', v: r.local }],
          filename: 'time',
        };
      }
      return {
        tabs: [{ label: '结果', view: 'table', data: {
          columns: [
            { key: 'input', label: '输入' },
            { key: 'ts', label: '秒', width: 'minmax(100px,130px)' },
            { key: 'ms', label: '毫秒', width: 'minmax(130px,160px)' },
            { key: 'local', label: '本地时间' },
            { key: 'utc', label: 'UTC', width: 'minmax(160px,180px)' },
            { key: 'rel', label: '相对', width: '90px' },
          ],
          rows: rows, name: 'times',
        } }],
        text: rows.map((r) => r.local).join('\n'),
        tabLabel: '本地时间',
        lang: 'text',
        stats: [{ k: '条数', v: rows.length }, { k: '时区', v: 'UTC' + (tz >= 0 ? '+' : '') + tz }],
      };
    },
  });

  /* ============================================================
   * 加解密
   * ============================================================ */
  SK.tool({
    id: 'crypto',
    name: '加解密',
    autoRun: false,
    group: 'codec',
    icon: '🔐',
    aliases: 'crypto aes des 3des rc4 sm2 sm3 sm4 rsa md5 sha hmac 加密 解密 哈希 国密',
    keywords: ['加密', '解密', '哈希', 'aes', 'md5', 'sha256', 'sm3', 'sm4', 'rsa', 'hmac', 'rc4', 'des', 'base64', '国密'],
    desc: '哈希(MD5/SHA全系/SHA3/SM3) + HMAC + 对称(AES五种模式/SM4/DES/3DES/RC4/XOR) + RSA(PKCS1v1.5/OAEP) + PBKDF2(生成/校验) + Base64/Hex，选项按算法自动显隐',
    sample: 'texta',
    hint: '密钥填第二个输入框：对称算法填 key（IV 在选项里）；RSA 粘贴 PEM',
    inputs: [
      { id: 'in', label: '明文 / 密文', placeholder: '要计算的文本', sample: 'texta' },
      { id: 'keyin', label: '密钥（对称 key 或 RSA 的 PEM）', placeholder: '对称：16/24/32 字节 key；RSA：-----BEGIN PUBLIC KEY-----…', small: true, allowEmpty: true },
    ],
    options: [
      { id: 'algo', type: 'select', label: '算法', value: 'md5', choices: [
        { v: 'md5', label: 'MD5' }, { v: 'sha1', label: 'SHA1' }, { v: 'sha224', label: 'SHA224' }, { v: 'sha256', label: 'SHA256' }, { v: 'sha384', label: 'SHA384' }, { v: 'sha512', label: 'SHA512' },
        { v: 'sm3', label: 'SM3（国密哈希）' },
        { v: 'sha3-256', label: 'SHA3-256' }, { v: 'sha3-512', label: 'SHA3-512' },
        { v: 'pbkdf2-gen', label: 'PBKDF2 生成(PHC)' }, { v: 'pbkdf2-verify', label: 'PBKDF2 校验口令' },
        { v: 'hmac-md5', label: 'HMAC-MD5' }, { v: 'hmac-sha1', label: 'HMAC-SHA1' }, { v: 'hmac-sha256', label: 'HMAC-SHA256' }, { v: 'hmac-sha512', label: 'HMAC-SHA512' }, { v: 'hmac-sm3', label: 'HMAC-SM3' },
        { v: 'aes-cbc', label: 'AES-CBC' }, { v: 'aes-ecb', label: 'AES-ECB' }, { v: 'aes-ctr', label: 'AES-CTR' }, { v: 'aes-cfb', label: 'AES-CFB' }, { v: 'aes-ofb', label: 'AES-OFB' }, { v: 'aes-gcm', label: 'AES-GCM（AEAD）' },
        { v: 'sm4-cbc', label: 'SM4-CBC（国密）' }, { v: 'sm4-ecb', label: 'SM4-ECB（国密）' },
        { v: 'des-cbc', label: 'DES-CBC' }, { v: 'des-ecb', label: 'DES-ECB' },
        { v: '3des-cbc', label: '3DES-CBC' }, { v: '3des-ecb', label: '3DES-ECB' },
        { v: 'rc4', label: 'RC4' }, { v: 'xor', label: 'XOR' },
        { v: 'rsa', label: 'RSA（PKCS#1 v1.5）' }, { v: 'rsa-oaep', label: 'RSA-OAEP(SHA-256)' },
        { v: 'base64', label: 'Base64' }, { v: 'hex', label: 'Hex' },
      ] },
      { id: 'dir', type: 'seg', label: '方向', value: 'enc', choices: [{ v: 'enc', label: '加密/编码' }, { v: 'dec', label: '解密/解码' }] },
      { id: 'keyEnc', type: 'select', label: 'Key 编码', value: 'utf8', choices: [{ v: 'utf8', label: 'utf8' }, { v: 'hex', label: 'hex' }, { v: 'base64', label: 'base64' }] },
      { id: 'iv', type: 'text', label: 'IV', value: '', placeholder: 'CBC 需要（AES/SM4 16字节，DES 8字节）' },
      { id: 'padding', type: 'select', label: '填充', value: 'pkcs7', choices: [{ v: 'pkcs7', label: 'PKCS7' }, { v: 'zero', label: 'Zero' }, { v: 'none', label: '无' }] },
      { id: 'out', type: 'select', label: '输出', value: 'hex', choices: [{ v: 'hex', label: 'hex' }, { v: 'hexup', label: 'HEX 大写' }, { v: 'base64', label: 'base64' }, { v: 'utf8', label: '文本' }] },
    ],
    /* 按算法动态显隐选项：哈希只要输出，ECB 不要 IV，RSA 只要方向 */
    onOptions: function (values, bar) {
      const a = String(values.algo || 'md5');
      const isHash = /^(md5|sha\d+|sm3)$/.test(a);
      const isHmac = a.indexOf('hmac-') === 0;
      const isSym = /^(aes|sm4|des|3des)-/.test(a);
      const isStream = a === 'rc4' || a === 'xor';
      const isRsa = a === 'rsa' || a === 'rsa-oaep';
      const isPbkdf = a.indexOf('pbkdf2') === 0;
      const ecb = /-ecb$/.test(a);
      const show = function (ids, on) { (on ? bar.show : bar.hide)(ids); };
      show(['dir'], !isHash && !isPbkdf);
      show(['keyEnc'], isHmac || isSym || isStream);
      show(['iv'], (isSym && !ecb) || a === 'aes-gcm');
      show(['padding'], isSym && /^(aes|sm4|des|3des)-(cbc|ecb)/.test(a));
      show(['out'], !isRsa);
    },
    help:
      '<h4>逆向常见场景对照</h4>' +
      '<ul><li>前端 <b>CryptoJS.AES.encrypt(x, key)</b>（key 是字符串）：等价 AES-ECB + key=utf8 + 输出 base64（CryptoJS 默认 ECB/PKCS7）</li>' +
      '<li>Python <b>DES.new(key, DES.MODE_ECB)</b>：DES-ECB + PKCS7</li>' +
      '<li><b>JSEncrypt.encrypt</b>：RSA-PKCS1v1.5，公钥 PEM 粘到密钥框，输出 base64</li>' +
      '<li>国密站点：SM3 哈希 / SM4 分组（key 16 字节）</li></ul>' +
      '<h4>提示</h4>' +
      '<ul><li>解密时「输出」表示<b>密文的编码</b>（选 hex 或 base64），不是明文格式</li>' +
      '<li>解密失败先检查：key/iv 编码、密文编码、ECB/CBC 是否选对</li>' +
      '<li>RSA 只能加密「密钥位数÷8 − 11」字节以内的数据</li></ul>',
    handler: async function (input, keyin, opts) {
      const text = String(input == null ? '' : input);
      const keyText = String(keyin == null ? '' : keyin).trim();
      if (!text) return { error: '输入为空' };
      const algo = String(opts.algo || 'md5');
      const dir = opts.dir === 'dec' ? 'dec' : 'enc';
      const out = String(opts.out || 'hex');
      /* padding 必须原样透传：旧写法把 'zero' 一律降级成 'pkcs7'，
         选 Zero 填充却按 PKCS7 解/加，和 Python `pad(multiple=0)` 站点的结果对不上 */
      const pad = opts.padding === 'zero' ? 'zero' : opts.padding === 'none' ? 'none' : 'pkcs7';
      /* 摘要是二进制，'utf8' 输出只会得到乱码——落到 hex 并提示 */
      const digestOut = out === 'utf8' ? 'hex' : out;
      const digestWarn = out === 'utf8' ? [{ level: 'info', msg: '哈希/HMAC 结果是二进制，无法按「文本」显示，已按 hex 输出' }] : null;
      const kOpts = { key: keyText || '', iv: opts.iv || '', keyEnc: opts.keyEnc || 'utf8', ivEnc: opts.keyEnc || 'utf8', padding: pad, out: out === 'hexup' ? 'hex' : out };

      const hashTab = () => {
        const tabs = [];
        try {
          const list = ['md5', 'sha1', 'sha256', 'sm3'].map((a) => ({ 算法: a, 结果: SK.crypt.hash(a, text, { out: digestOut }) }));
          tabs.push({ label: '常用哈希', view: 'table', data: { columns: [{ key: '算法', label: '算法', width: '110px' }, { key: '结果', label: '结果' }], rows: list, name: 'hashes' } });
        } catch (e) {}
        return tabs;
      };

      try {
        if (/^(md5|sha1|sha224|sha256|sha384|sha512|sm3)$/.test(algo)) {
          if (dir === 'dec') return { error: '哈希算法不可逆', hint: '只能做字典/彩虹表碰撞；试试「文本对比」验证猜测值' };
          const hex = SK.crypt.hash(algo, text, { out: digestOut });
          return {
            text: hex,
            lang: 'text',
            stats: [{ k: '算法', v: algo.toUpperCase() }, { k: '输出', v: out }, { k: '长度', v: hex.length + ' 字符' }, { k: '输入', v: SK.dom.fmtBytes(text.length) }],
            tabs: hashTab(),
            notices: digestWarn,
          };
        }
        if (algo.indexOf('hmac-') === 0) {
          if (!keyText) return { error: 'HMAC 需要密钥（填到第二个输入框）' };
          const h = SK.crypt.hmac(algo.replace('hmac-', ''), keyText, text, { out: digestOut, keyEnc: opts.keyEnc || 'utf8' });
          return {
            text: h, lang: 'text',
            stats: [{ k: '算法', v: algo.toUpperCase() }, { k: '输出', v: digestOut }, { k: 'Key 编码', v: opts.keyEnc || 'utf8' }],
            notices: digestWarn,
          };
        }
        if (algo.indexOf('sha3') === 0) {
          if (dir === 'dec') return { error: '哈希算法不可逆' };
          const bits = algo.split('-')[1] === '512' ? 512 : 256;
          const hex = await SK.crypt2.sha3.digest(bits, text, { out: digestOut });
          return { text: hex, lang: 'text', stats: [{ k: '算法', v: 'SHA3-' + bits }, { k: '输出', v: digestOut }, { k: '长度', v: hex.length + ' 字符' }], notices: [{ level: 'info', msg: 'SHA3 系浏览器 WebCrypto 实现（Chrome 113+）' }].concat(digestWarn || []) };
        }
        if (algo === 'pbkdf2-gen') {
          const phc = await SK.crypt2.pbkdf2.generate(text, { iterations: 100000, hash: 'SHA-256' });
          return {
            text: phc, lang: 'text',
            stats: [{ k: '参数', v: 'PBKDF2-SHA256 × 100000' }],
            notices: [{ level: 'ok', msg: '把 PHC 串存库，口令自行保管；校验用「PBKDF2 校验口令」' }],
          };
        }
        if (algo === 'pbkdf2-verify') {
          if (!keyText) return { error: '口令填到第二个输入框，PHC 串留在第一个', hint: 'PHC 格式：$pbkdf2-sha256$i=迭代$盐$摘要' };
          const ok = await SK.crypt2.pbkdf2.verify(text, keyText);
          return {
            text: ok ? 'OK 口令正确' : 'FAIL 口令错误',
            lang: 'text',
            stats: [{ k: '结果', v: ok ? '匹配' : '不匹配', level: ok ? 'ok' : 'error' }],
          };
        }
        if (algo === 'rsa-oaep') {
          if (!keyText) return { error: 'RSA-OAEP 需要 PEM 密钥（公钥加密 / PKCS#8 私钥解密）' };
          const r = dir === 'enc' ? await SK.crypt2.rsaOAEP.encrypt(text, { key: keyText, hash: 'SHA-256' }) : await SK.crypt2.rsaOAEP.decrypt(text, { key: keyText, hash: 'SHA-256', enc: 'base64' });
          return { text: r, lang: 'text', stats: [{ k: '算法', v: 'RSA-OAEP-SHA256' }, { k: '方向', v: dir === 'enc' ? '加密' : '解密' }] };
        }
        if (algo === 'rsa') {
          if (!keyText) return { error: 'RSA 需要 PEM 密钥（公钥加密 / 私钥解密），粘贴到第二个输入框', hint: '-----BEGIN PUBLIC KEY----- 开头的整段，包括头尾行' };
          const r = dir === 'enc' ? SK.crypt2.rsa.encrypt(text, { key: keyText, out: 'base64' }) : SK.crypt2.rsa.decrypt(text, { key: keyText, enc: 'base64' });
          let info = null;
          try {
            const ki = SK.crypt2.rsa.parsePem(keyText);
            info = [{ k: '密钥', v: ki.isPrivate ? '私钥' : '公钥' }, { k: '位数', v: ki.n.toString(2).length + ' bit' }, { k: 'e', v: ki.e.toString() }];
          } catch (e) {}
          return { text: r, lang: 'text', stats: info || [], notices: [{ level: 'info', msg: 'RSA-PKCS#1 v1.5，与 JSEncrypt / Python PKCS1_v1.5 互通' }] };
        }
        if (algo === 'aes-gcm') {
          if (!keyText) return { error: 'AES-GCM 需要密钥（16/24/32 字节）' };
          if (!opts.iv) return { error: 'AES-GCM 必须填 IV / nonce', hint: '常见 12 字节；也兼容 16 字节。抓包里 JSON 字段名常叫 iv / nonce' };
          const gOpts = Object.assign({}, kOpts, { aad: opts.aad || '' });
          if (dir === 'enc') {
            const r = await SK.crypt2.aesGcm.encrypt(text, Object.assign({ out: out === 'hexup' ? 'hex' : out }, gOpts));
            return { text: out === 'hexup' ? String(r).toUpperCase() : r, lang: 'text', stats: [{ k: '模式', v: 'AES-GCM' }, { k: 'Tag', v: '128 bit（附在密文尾）' }], notices: [{ level: 'info', msg: '密文格式 = ciphertext||tag，与 OpenSSL / Java / 浏览器 WebCrypto 一致' }] };
          }
          const inEnc = out === 'hex' || out === 'hexup' ? 'hex' : out === 'base64' ? 'base64' : 'utf8';
          if (inEnc === 'utf8') throw new Error('解密时请把「输出」选成 hex 或 base64 —— 它表示密文的编码');
          const r = await SK.crypt2.aesGcm.decrypt(text, Object.assign({}, gOpts, { enc: inEnc, out: 'utf8' }));
          return { text: r, lang: 'text', stats: [{ k: '模式', v: 'AES-GCM' }, { k: '校验', v: 'Tag 验证通过', level: 'ok' }] };
        }
        if (algo.indexOf('aes') === 0) {
          const mode = algo.split('-')[1];
          if (!keyText) return { error: 'AES 需要密钥（16/24/32 字节）' };
          if (dir === 'enc') {
            const r = SK.crypt.aesEncrypt(text, Object.assign({ mode: mode }, kOpts));
            return { text: r, lang: 'text', stats: [{ k: '模式', v: 'AES-' + mode.toUpperCase() }, { k: 'Key 编码', v: opts.keyEnc }, { k: '输出', v: out }] };
          }
          const inEnc = out === 'hex' || out === 'hexup' ? 'hex' : out === 'base64' ? 'base64' : 'utf8';
          if (inEnc === 'utf8') throw new Error('解密时请把「输出」选成 hex 或 base64 —— 它表示密文的编码');
          const r = SK.crypt.aesDecrypt(mode, text, Object.assign({}, kOpts, { enc: inEnc, out: 'utf8' }));
          return { text: r, lang: 'text', stats: [{ k: '模式', v: 'AES-' + mode.toUpperCase() }, { k: '密文编码', v: inEnc }] };
        }
        if (/^(sm4|des|3des)-/.test(algo)) {
          const fam = algo.split('-')[0];
          const mode = algo.split('-')[1];
          if (!keyText) return { error: fam.toUpperCase() + ' 需要密钥' + (fam === 'sm4' ? '（16 字节）' : fam === 'des' ? '（8 字节）' : '（24 字节）') };
          const lib = fam === 'sm4' ? SK.crypt2.sm4 : fam === 'des' ? SK.crypt2.des : SK.crypt2.des3;
          if (dir === 'enc') {
            const r = lib.encrypt(text, Object.assign({ mode: mode }, kOpts));
            return { text: r, lang: 'text', stats: [{ k: '模式', v: fam.toUpperCase() + '-' + mode.toUpperCase() }, { k: 'Key 编码', v: opts.keyEnc }, { k: '输出', v: out }] };
          }
          const inEnc = out === 'hex' || out === 'hexup' ? 'hex' : out === 'base64' ? 'base64' : 'utf8';
          if (inEnc === 'utf8') throw new Error('解密时请把「输出」选成 hex 或 base64 —— 它表示密文的编码');
          const r = lib.decrypt(text, Object.assign({}, kOpts, { mode: mode, enc: inEnc, out: 'utf8' }));
          return { text: r, lang: 'text', stats: [{ k: '模式', v: fam.toUpperCase() + '-' + mode.toUpperCase() }, { k: '密文编码', v: inEnc }] };
        }
        if (algo === 'rc4' || algo === 'xor') {
          if (!keyText) return { error: algo.toUpperCase() + ' 需要密钥' };
          const r = SK.crypt[algo](text, keyText, { enc: dir === 'enc' ? 'utf8' : (/^hex/i.test(out) ? 'hex' : 'base64'), keyEnc: opts.keyEnc, out: out });
          return { text: r, lang: 'text', stats: [{ k: '算法', v: algo.toUpperCase() }, { k: '方向', v: dir === 'enc' ? '加密' : '解密' }] };
        }
        if (algo === 'base64') {
          if (dir === 'enc') {
            const b = SK.crypt.toB64(SK.crypt.encStr(text, 'utf8'));
            return { text: b, lang: 'text', stats: [{ k: '输入', v: SK.dom.fmtBytes(text.length) }, { k: '输出', v: SK.dom.fmtBytes(b.length) }] };
          }
          const bytes = SK.crypt.fromB64(text.replace(/\s+/g, ''));
          return { text: SK.crypt.decBytes(bytes, 'utf8'), lang: 'text', stats: [{ k: '解码后字节', v: bytes.length }] };
        }
        if (algo === 'hex') {
          if (dir === 'enc') {
            const b = SK.crypt.encStr(text, 'utf8');
            const h = SK.crypt.toHex(b);
            return { text: out === 'hexup' ? h.toUpperCase() : h, lang: 'text', stats: [{ k: '字节', v: b.length }] };
          }
          const bytes = SK.crypt.fromHex(text.replace(/[^0-9a-fA-F]/g, ''));
          return { text: SK.crypt.decBytes(bytes, 'utf8'), lang: 'text', stats: [{ k: '字节', v: bytes.length }] };
        }
        return { error: '不支持的算法：' + algo };
      } catch (e) {
        return { error: '计算失败：' + e.message, hint: '常见错误：key/iv 长度不符（AES 16/24/32、SM4 16、DES 8、3DES 24 字节）、密文不是块的倍数、密文编码选错' };
      }
    },
  });

  /* ============================================================
   * Base64 → 图片
   * ============================================================ */
  SK.tool({
    id: 'b64-image',
    name: 'Base64 转图片',
    group: 'misc',
    icon: '🖼',
    aliases: 'base64 image 图片 datauri 验证码',
    keywords: ['base64', '图片', 'image', 'datauri', '验证码', '预览'],
    desc: 'Base64 / DataURI 直接还原成图片：识别真实格式、显示尺寸、可缩放、可下载，验证码和字体图一站看',
    sample: 'b64img',
    hint: '支持带 data:image/png;base64, 前缀或纯 Base64',
    inputs: [{ id: 'in', label: 'Base64 / DataURI', placeholder: 'data:image/png;base64,iVBORw0…', sample: 'b64img' }],
    options: [{ id: 'mime', type: 'select', label: '未知时按', value: 'png', choices: [{ v: 'png', label: 'PNG' }, { v: 'jpeg', label: 'JPEG' }, { v: 'gif', label: 'GIF' }, { v: 'webp', label: 'WEBP' }] }],
    handler: function (input, opts) {
      let s = String(input == null ? '' : input).trim();
      if (!s) return { error: '输入为空' };
      let mime = '';
      const m = /^data:([^;,]+)?(;base64)?,/.exec(s);
      if (m) {
        mime = m[1] || '';
        s = s.slice(m[0].length);
      }
      s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if (!/^[A-Za-z0-9+/=]+$/.test(s)) return { error: '不是合法的 Base64（含非法字符）', hint: '检查是否混入了换行以外的符号，或复制时漏掉了前缀' };
      while (s.length % 4) s += '=';
      let bytes;
      try {
        bytes = SK.crypt.fromB64(s);
      } catch (e) {
        return { error: 'Base64 解码失败：' + e.message };
      }
      if (!bytes || !bytes.length) return { error: '解码后为空' };
      const b = bytes;
      if (!mime) {
        if (b[0] === 0x89 && b[1] === 0x50) mime = 'image/png';
        else if (b[0] === 0xff && b[1] === 0xd8) mime = 'image/jpeg';
        else if (b[0] === 0x47 && b[1] === 0x49) mime = 'image/gif';
        else if (b[0] === 0x42 && b[1] === 0x4d) mime = 'image/bmp';
        else if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42) mime = 'image/webp';
        else {
          const head = String.fromCharCode.apply(null, b.subarray(0, 200));
          if (/<svg|<\?xml/i.test(head)) mime = 'image/svg+xml';
          else if (head.slice(0, 4) === '%PDF') mime = 'application/pdf';
          else mime = 'image/' + (opts.mime || 'png');
        }
      }
      const ext = (mime.split('/')[1] || 'bin').replace(/\+xml/, '');
      const isImage = /^image\//.test(mime);
      return {
        view: isImage ? 'image' : null,
        data: { b64: s, mime: mime, bytes: b.length, name: 'image.' + ext },
        stats: [{ k: '类型', v: mime }, { k: '大小', v: SK.dom.fmtBytes(b.length) }, { k: 'Base64', v: SK.dom.fmtBytes(s.length) }],
        notices: isImage ? null : [{ level: 'warn', msg: '识别为非图片格式（' + mime + '），已按文件处理，可点下载保存' }],
      };
    },
  });

  /* ============================================================
   * 代码分享
   * ============================================================ */
  SK.tool({
    id: 'code-share',
    name: '代码分享',
    group: 'misc',
    icon: '↗',
    aliases: 'share 分享 代码 链接 短链',
    keywords: ['分享', '代码', '链接', 'share', 'url', '压缩'],
    desc: '把代码/文本压缩后塞进 URL 片段生成分享长链，不经过任何服务器，打开即还原',
    hint: '内容全在 # 之后，不会被服务端日志记录；超长文本浏览器可能截断',
    inline: true,
    inputs: [{ id: 'in', label: '要分享的内容', placeholder: '粘贴代码或文本', sample: 'js' }],
    options: [
      { id: 'title', type: 'text', label: '标题', value: '' },
      { id: 'open', type: 'toggle', label: '生成后直接打开', value: false },
    ],
    handler: async function (input, opts) {
      const text = String(input == null ? '' : input);
      if (!text) return { error: '内容为空' };
      const packed = await SK.codecCompress(text);
      const payload = packed ? 'z' + packed : 'p' + btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return {
        payload: payload,
        title: String(opts.title || '').trim(),
        open: !!opts.open,
        stats: [
          { k: '原文', v: SK.dom.fmtBytes(text.length) },
          { k: '压缩', v: packed ? 'deflate + base64url' : '仅 base64' },
        ],
      };
    },
    post: function (res) {
      if (!res || !res.payload) return res;
      const base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href.split('#')[0];
      /* 标题拼在 payload 前面（t= base64url(标题)），接收端还原成页面标题；
         带上它以后聊天软件里的链接预览才不是一串压缩串。 */
      let payload = res.payload;
      const title = String(res.title || '').trim();
      if (title) {
        const tb = btoa(unescape(encodeURIComponent(title))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        payload = payload + '!t=' + tb;
      }
      const url = base + '#/code-share/' + payload;
      if (res.open) {
        try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
      }
      const tooLong = url.length > 30000;
      return {
        text: url,
        lang: 'text',
        stats: (res.stats || []).concat([{ k: '链接长度', v: SK.dom.fmtNum(url.length), level: tooLong ? 'warn' : '' }]),
        notices: tooLong ? [{ level: 'warn', msg: '链接超过 3 万字符，部分浏览器/聊天软件会截断' }] : [{ level: 'ok', msg: '链接已生成，复制后任何浏览器打开都能还原原文' }],
        action: { label: '复制链接', onClick: () => SK.dom.copy(url).then(() => SK.ui.toast('已复制分享链接', 'ok')) },
      };
    },
  });

  /* ============================================================
   * crontab 解析
   * ============================================================ */
  SK.tool({
    id: 'cron',
    name: 'cron 表达式',
    group: 'misc',
    icon: '⏲',
    aliases: 'cron crontab 定时 表达式 解析',
    keywords: ['cron', 'crontab', '定时', '表达式', '调度'],
    desc: '解析 5/6 段 cron 表达式，解释每一段含义并算出未来 5 次执行时间，写采集定时任务不再靠猜',
    sample: 'crontab',
    inputs: [{ id: 'in', label: 'cron 表达式', placeholder: '*/5 9-18 * * 1-5', sample: 'crontab' }],
    options: [{ id: 'tz', type: 'select', label: '时区', value: '8', choices: [{ v: '8', label: 'UTC+8' }, { v: '0', label: 'UTC' }] }],
    handler: function (input, opts) {
      const raw = String(input == null ? '' : input).trim().replace(/\s+/g, ' ');
      if (!raw) return { error: '输入为空' };
      /* 宏别名：k8s / spring / cronie 都支持，写采集定时任务时最常用；
         以前直接报「不支持 @daily」，但用户输入的就是它，展开比拒绝有用。 */
      const ALIAS = {
        '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
        '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
        '@hourly': '0 * * * *', '@every_minute': '* * * * *',
      };
      let expr = raw;
      let aliasNote = null;
      const aliasKey = raw.toLowerCase();
      if (ALIAS[aliasKey]) {
        expr = ALIAS[aliasKey];
        aliasNote = raw.toLowerCase() + ' 等价于 ' + expr;
      } else if (/^@every\s+\d+[smh]$/i.test(raw)) {
        const m = /^@every\s+(\d+)([smh])$/i.exec(raw);
        const n = Number(m[1]);
        expr = m[2].toLowerCase() === 's' ? '*/' + Math.min(59, n) + ' * * * * *'
          : m[2].toLowerCase() === 'm' ? '*/' + Math.min(59, n) + ' * * * *'
            : '0 */' + Math.min(23, n) + ' * * *';
        aliasNote = raw.toLowerCase() + ' 等价于 ' + expr;
      }
      const fields = expr.split(' ');
      if (fields.length !== 5 && fields.length !== 6) return { error: '段数不对：需要 5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）', hint: '也支持 @daily / @hourly / @weekly / @monthly / @yearly / @every 30s 这类别名' };
      const six = fields.length === 6;
      const names = six ? ['秒', '分', '时', '日', '月', '周'] : ['分', '时', '日', '月', '周'];
      const bounds = six ? [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] : [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
      const parsed = [];
      for (let i = 0; i < fields.length; i++) {
        const r = expandField(fields[i], bounds[i][0], bounds[i][1]);
        if (r.error) return { error: names[i] + ' 段解析失败：' + r.error };
        parsed.push(r);
      }
      function expandField(src, lo, hi) {
        const set = {};
        let step = 1;
        for (const part of src.split(',')) {
          let p = part;
          let st = 1;
          if (p.indexOf('/') >= 0) {
            const seg = p.split('/');
            p = seg[0];
            st = Number(seg[1]);
            if (!st || st < 1) return { error: '步长不合法 ' + part };
          }
          let a, b;
          if (p === '*') { a = lo; b = hi; }
          else if (p.indexOf('-') > 0) {
            const seg = p.split('-');
            a = Number(seg[0]); b = Number(seg[1]);
          } else {
            a = Number(p); b = p === '*' ? hi : a;
            if (isNaN(a)) return { error: '无法识别 ' + part };
            if (st === 1) { set[a] = 1; continue; }
            b = hi;
          }
          if (isNaN(a) || isNaN(b) || a < lo || b > hi || a > b) return { error: '范围越界 ' + part + '（允许 ' + lo + '-' + hi + '）' };
          for (let v = a; v <= b; v += st) set[v] = 1;
          step = st;
        }
        return { set: Object.keys(set).map(Number).sort((x, y) => x - y) };
      }
      const desc = parsed.map((p, i) => names[i] + ': ' + summarize(p.set, names[i], bounds[i])).join('\n');
      function summarize(vals, name, b) {
        if (vals.length === b[1] - b[0] + 1) return '每' + name;
        if (vals.length > 12) return '在 ' + vals.slice(0, 10).join(',') + ' … 共 ' + vals.length + ' 个值';
        return '在 ' + vals.join(',');
      }

      /* ---- 未来执行时间 ----
       * 旧实现有两个硬伤，导致「预测」永远是 0 次：
       *   1) 推进分钟时用 `+60000 - (t % 60000) + 1000`，对齐后多加了 1 秒，
       *      时间永远停在 :01 秒；而 5 段表达式的秒集合是 [0]，于是秒判定永不通过。
       *   2) 分钟/小时不匹配时一律按分钟推进，遇到「每月 1 号」这类要跑几十万次，
       *      直接撞上 guard 上限。
       * 现在按「秒 → 分 → 时 → 日 → 月」逐级跳到下一个可能的取值，不做暴力递增，
       * 并在 5 年内找不到就明确报「永不触发」而不是「算不出来」。
       */
      const tz = Number(opts.tz || 8);
      /* 在 UTC 毫秒上工作，再偏移 tz：Date 的 getUTC* 即在目标时区的墙上时间 */
      const OFF = tz * 3600e3;
      let cur = new Date(Date.now() + OFF);
      cur.setUTCMilliseconds(0);
      const secs = six ? parsed[0].set : [0];
      const mins = six ? parsed[1].set : parsed[0].set;
      const hours = six ? parsed[2].set : parsed[1].set;
      const doms = six ? parsed[3].set : parsed[2].set;
      const months = six ? parsed[4].set : parsed[3].set;
      const dowsRaw = six ? parsed[5].set : parsed[4].set;
      const dows = Array.from(new Set(dowsRaw.map((d) => (d === 7 ? 0 : d)))).sort((a, b) => a - b);
      const domAny = doms.length === bounds[six ? 3 : 2][1] - bounds[six ? 3 : 2][0] + 1;
      const dowAny = dowsRaw.length === 7;
      const nextIn = (arr, v) => {
        for (const x of arr) if (x >= v) return x;
        return null;
      };
      const dayMatches = (d) => {
        const domOk = doms.indexOf(d.getUTCDate()) >= 0;
        const dowOk = dows.indexOf(d.getUTCDay()) >= 0;
        /* 标准 cron：两个字段都受限时取并集（Vixie cron 语义），任一受限则只看受限的那个 */
        if (domAny && dowAny) return true;
        if (domAny) return dowOk;
        if (dowAny) return domOk;
        return domOk || dowOk;
      };
      const LIMIT_DATE = Date.now() + OFF + 5 * 366 * 86400e3;
      const runs = [];
      const MAX_GUESS = 60 * 24 * 366 * 5; /* 最多试这么多次「日」跳跃，防死循环 */
      let miss = 0;
      for (let guard = 0; runs.length < 5 && guard < MAX_GUESS; guard++) {
        /* 月 */
        const mo = nextIn(months, cur.getUTCMonth() + 1);
        if (mo === null) {
          cur = new Date(Date.UTC(cur.getUTCFullYear() + 1, months[0] - 1, 1, 0, 0, 0));
          if (cur.getTime() > LIMIT_DATE + OFF) break;
          continue;
        }
        if (mo !== cur.getUTCMonth() + 1) {
          cur = new Date(Date.UTC(cur.getUTCFullYear(), mo - 1, 1, 0, 0, 0));
          continue;
        }
        /* 日 */
        if (!dayMatches(cur)) {
          cur = new Date(cur.getTime() + 86400e3);
          cur.setUTCHours(0, 0, 0, 0);
          miss++;
          if (miss > MAX_GUESS) break;
          continue;
        }
        /* 时 */
        const h = nextIn(hours, cur.getUTCHours());
        if (h === null) {
          cur = new Date(cur.getTime() + 86400e3);
          cur.setUTCHours(0, 0, 0, 0);
          continue;
        }
        if (h !== cur.getUTCHours()) {
          cur.setUTCHours(h, 0, 0, 0);
          continue;
        }
        /* 分 */
        const mi = nextIn(mins, cur.getUTCMinutes());
        if (mi === null) {
          cur = new Date(cur.getTime() + 3600e3);
          cur.setUTCMinutes(0, 0, 0);
          continue;
        }
        if (mi !== cur.getUTCMinutes()) cur.setUTCMinutes(mi, 0, 0);
        /* 秒 */
        const se = nextIn(secs, cur.getUTCSeconds());
        if (se === null) {
          cur = new Date(cur.getTime() + 60000);
          cur.setUTCSeconds(0, 0);
          continue;
        }
        if (se !== cur.getUTCSeconds()) cur.setUTCSeconds(se, 0);
        runs.push(
          cur.getUTCFullYear() + '-' + String(cur.getUTCMonth() + 1).padStart(2, '0') + '-' + String(cur.getUTCDate()).padStart(2, '0') +
          ' ' + String(cur.getUTCHours()).padStart(2, '0') + ':' + String(cur.getUTCMinutes()).padStart(2, '0') + ':' + String(cur.getUTCSeconds()).padStart(2, '0') +
          ' (UTC' + (tz >= 0 ? '+' : '') + tz + ')'
        );
        cur = new Date(cur.getTime() + 1000);
      }
      const runText = runs.length
        ? runs.join('\n')
        : '永不触发：未来 5 年内找不到匹配时间。检查「日」与「周」是否互相矛盾（两个字段都受限时按标准 cron 取并集，但像 2-30 2 月这种日历上不存在）';

      return {
        text: '表达式: ' + expr + (aliasNote ? '\n别名: ' + aliasNote : '') + '\n\n' + desc + '\n\n未来 5 次执行:\n' + runText,
        lang: 'text',
        stats: [{ k: '段数', v: fields.length }, { k: '预测', v: runs.length + ' 次', level: runs.length ? 'ok' : 'warn' }],
        tabs: [{ label: '字段', view: 'table', data: { columns: [{ key: 'f', label: '段' }, { key: 'src', label: '原文', width: '110px' }, { key: 'vals', label: '展开值' }], rows: parsed.map((p, i) => ({ f: names[i], src: fields[i], vals: p.set.length > 40 ? p.set.slice(0, 40).join(',') + ' …' : p.set.join(',') })), name: 'cron' } }],
      };
    },
  });
})();
