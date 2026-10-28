/* ============================================================================
   Spider Lab · hashid.js
   哈希识别：粘贴哈希串 → 指纹识别（长度/字符集/格式前缀），给破解建议
   思路吸收自参考项目 spder toolbox.mjs 的识别段，规则重写扩充。
   handler 内联全部函数（Worker 可执行）。
   ========================================================================== */
(function () {

  SK.tool({
    id: 'hash-id',
    name: '哈希类型识别',
    group: 'misc',
    icon: '#',
    aliases: 'hash id identify 识别 md5 sha1 bcrypt 类型 哈希识别',
    keywords: ['哈希', '识别', 'hash', 'md5', 'sha', 'bcrypt', '类型', '破解'],
    desc: '按长度/字符集/前缀推测候选算法（MD5/SHA 全系/NTLM/bcrypt/Django-PBKDF2/MySQL 等 40+ 指纹），给的是候选清单不是确证结果',
    sample: 'hashes',
    hint: '支持一次粘贴多行批量识别',
    inputs: [{ id: 'in', label: '哈希串（可多行）', placeholder: '5d41402abc4b2a76b9719d911017c592 或 $2b$12$…', sample: 'hashes' }],
    options: [],
    help:
      '<h4>识别维度</h4>' +
      '<ul><li><b>长度 + 字符集</b>：32 位 hex → MD5 家族；64 位 → SHA256 家族…（同类长度给多个候选，按常见度排序）</li>' +
      '<li><b>格式前缀</b>：$2b$ → bcrypt；pbkdf2_sha256$ → Django；$argon2 → Argon2；* 开头 40 位 → MySQL5</li>' +
      '<li><b>结构</b>：三段点分 Base64URL → JWT（可直接用「JWT 解析」工具拆开）</li></ul>' +
      '<h4>常见转化关系（同长度不同算法）</h4>' +
      '<ul><li>NTLM = MD4(UTF-16LE(密码))——老 Windows 内网常见</li>' +
      '<li>MySQL5(SHA1) = SHA1(SHA1(密码)) 且带 * 前缀</li>' +
      '<li>MD5(中间值)：接口签名里 32 位小写 hex 大概率是普通 MD5</li></ul>',
    handler: function (input) {
      const lines = String(input == null ? '' : input).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return { error: '输入为空' };
      if (lines.length > 500) return { error: '一次最多 500 行' };

      const HEX = /^[0-9a-fA-F]+$/;
      const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
      const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

      /* 长度 → 候选（按常见度排序，附建议） */
      const BY_LEN = {
        8: [['CRC32', '8 位 hex，校验用，非密码哈希；可查表直接反查']],
        16: [['MySQL323 / 老版 MySQL PASSWORD()', '只取前两个字符做盐的不安全哈希，秒查表'], ['LM Hash（Windows 老域）', '全大写、7 字符分组，秒破']],
        32: [['MD5', '彩虹表/GPU 秒级；hashcat -m 0'], ['MD4', '同 MD5 级别；hashcat -m 900'], ['NTLM', '= MD4(UTF-16LE)；hashcat -m 1000，秒级'], ['HMAC-MD5(需密钥)', '需要拿到 key 才能离线暴破'], ['RIPEMD-128 / Haval128 / Tiger128 / Snefru128', '冷门，先按 MD5 试']],
        40: [['SHA-1', 'hashcat -m 100'], ['RIPEMD-160', 'hashcat -m 6000'], ['MySQL5（* 前缀时）', '= SHA1(SHA1(pwd))；hashcat -m 300']],
        48: [['Tiger-192', '冷门'], ['HAVAL-192', '冷门']],
        56: [['SHA-224 / SHA3-224', 'hashcat -m 1300 / 17700'], ['BLAKE2s-224', '较少见']],
        64: [['SHA-256 / SHA3-256', 'hashcat -m 1400'], ['SM3（国密）', '国内站点常见'], ['BLAKE2s', '较少见'], ['RIPEMD-256 / Haval256', '冷门'], ['HMAC-SHA256(需密钥)', '接口签名最常见的形态；暴破需带 key']],
        80: [['RIPEMD-320', '冷门']],
        96: [['SHA-384 / SHA3-384', 'hashcat -m 10800'], ['BLAKE2b-384', '较少见']],
        128: [['SHA-512 / SHA3-512', 'hashcat -m 1700'], ['BLAKE2b', '较少见'], ['Whirlpool', '冷门']],
      };

      const identify = function (s) {
        const cands = [];
        const notes = [];

        /* 格式化格式优先 */
        if (/^\$2[abxy]\$\d{2}\$[.\/A-Za-z0-9]{53}$/.test(s)) {
          const cost = /^\$2[abxy]\$(\d{2})\$/.exec(s)[1];
          cands.push(['bcrypt（前缀 $' + s[1] + '$，cost=' + cost + '）', '不可逆慢哈希，只能字典/规则暴破；hashcat -m 3200，cost 越高越慢']);
        }
        if (/^pbkdf2_(sha1|sha256|sha384|sha512)\$\d+\$/.test(s)) {
          cands.push(['Django PBKDF2-' + /^pbkdf2_(sha\d+)/.exec(s)[1].toUpperCase(), '格式 pbkdf2_H$迭代$盐$摘要；hashcat -m 10000，先拆出盐和迭代数']);
        }
        if (/^\$pbkdf2(-sha(1|256|512))?\$/.test(s) || /^\$pbkdf2-sha(1|256|512)\$i=\d+\$/.test(s)) {
          cands.push(['PHC 格式 PBKDF2', 'passlib/Django 常见；hashcat -m 12000 系'],
            ['可校验', '本工具「加解密」的 PBKDF2 可用盐+迭代数离线验证口令']);
        }
        if (/^\$argon2(id|i|d)\$/.test(s)) cands.push(['Argon2（PHC）', '现代慢哈希；hashcat -m 23000 系']);
        if (/^\$6\$/.test(s)) cands.push(['sha512crypt（$6$）', 'Linux /etc/shadow 常见；hashcat -m 1800']);
        if (/^\$5\$/.test(s)) cands.push(['sha256crypt（$5$）', 'Linux shadow；hashcat -m 7400']);
        if (/^\$1\$/.test(s)) cands.push(['md5crypt（$1$）', '老 Linux/路由器；hashcat -m 500']);
        if (/^\$md5,base64:/.test(s) || /^\$smd5\$/.test(s)) cands.push(['AIX/SMD5', '少见']);
        if (/^\*[0-9A-F]{40}$/.test(s)) cands.push(['MySQL5 PASSWORD()', '= SHA1(SHA1(pwd)) 带 *；hashcat -m 300']);
        if (/^\$NT\$/.test(s)) cands.push(['NTLM（$NT$ 前缀）', 'hashcat -m 1000']);
        if (/^\{SSHA\}/i.test(s)) cands.push(['Salted SHA-1（OpenLDAP）', 'base64 里含 20 字节摘要 + 盐，先解码拆开']);
        if (/^\{SHA\}/i.test(s)) cands.push(['SHA-1（{SHA}，OpenLDAP）', '无盐，直接查表']);
        if (/^bcrypt\$\$/.test(s)) cands.push(['Django bcrypt', '后面是标准 bcrypt 串']);
        if (/^0x[0-9a-fA-F]+$/i.test(s)) {
          s = s.slice(2);
          notes.push('已去掉 0x 前缀');
        }

        /* JWT */
        if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$/.test(s)) {
          cands.push(['JWT（JWS 三段）', '用「JWT 解析」工具直接拆 header/payload，填密钥还能验 HS256']);
          return { cands: cands, kind: '结构化令牌', notes: notes };
        }

        /* hex 家族 */
        if (HEX.test(s)) {
          const L = s.length;
          const list = BY_LEN[L];
          if (list) {
            for (const c of list) cands.push(c);
          } else {
            cands.push(['未知长度 hex（' + L + ' 位）', '可能是自定义截断/多次拼接']);
          }
          if (L === 32 && s === s.toUpperCase() && /[A-F]/.test(s)) notes.push('全大写：Windows/部分老系统习惯，也可能只是大小写不同');
          if (L === 32 && /30{4,}/.test(s)) notes.push('含大量 0：注意可能是截断的二进制数据而非哈希');
        } else if (B64.test(s) || B64URL.test(s)) {
          /* 猜 base64 长度 → 原始字节数 */
          const pad = s.length % 4 === 0 ? s.length : s.length + (4 - (s.length % 4));
          const bytes = Math.floor(pad / 4) * 3;
          const map = { 20: 'SHA-1 的 Base64', 28: 'SHA-224 的 Base64', 32: 'SHA-256 的 Base64', 48: 'SHA-384 的 Base64', 64: 'SHA-512 的 Base64', 16: 'MD5 的 Base64' };
          if (map[bytes]) cands.push([map[bytes], '先 Base64 解码再按 hex 流程识别']);
          else cands.push(['Base64 编码数据（解码后 ' + bytes + ' 字节）', '用「加解密」的 Base64 解码后看是否 hex']);
          if (B64URL.test(s) && !B64.test(s)) notes.push('URL-safe 字母表（-_ 而非 +/）');
        } else if (/^[0-9]+$/.test(s)) {
          cands.push(['纯数字串（' + s.length + ' 位）', '可能不是哈希，而是手机号/时间戳/ID']);
        } else {
          cands.push(['无法识别的字符集', '含 hex/base64 之外的字符；可能是自定义加密结果，先试「加解密」反推']);
        }
        return { cands: cands, kind: HEX.test(s) ? 'hex ' + s.length + ' 位' : '其他', notes: notes };
      };

      const rows = [];
      lines.forEach(function (s, i) {
        const r = identify(s);
        r.cands.forEach(function (c, j) {
          rows.push({
            n: i + 1,
            input: s.length > 48 ? s.slice(0, 24) + '…' + s.slice(-16) : s,
            kind: j === 0 ? r.kind : '',
            algo: j === 0 ? '★ ' + c[0] : c[0],
            advice: c[1],
          });
        });
        (r.notes || []).forEach(function (n) {
          rows.push({ n: '', input: '', kind: '', algo: '↳ ' + n, advice: '' });
        });
      });

      const summary = lines.map(function (s, i) {
        const r = identify(s);
        return (i + 1) + '. ' + (s.length > 40 ? s.slice(0, 32) + '…' : s) + '  →  ' + (r.cands[0] ? r.cands[0][0] : '未知');
      }).join('\n');

      return {
        text: summary,
        lang: 'text',
        tabLabel: '识别结果',
        tabs: [
          { label: '明细表', view: 'table', data: {
            columns: [
              { key: 'n', label: '#', width: '44px' },
              { key: 'input', label: '输入', width: 'minmax(150px,260px)' },
              { key: 'kind', label: '形态', width: '100px' },
              { key: 'algo', label: '可能算法', width: 'minmax(160px,260px)' },
              { key: 'advice', label: '破解/下一步建议' },
            ],
            rows: rows, name: 'hash-id',
            filterHint: '按算法名过滤，如 bcrypt / NTLM',
          } },
        ],
        stats: [
          { k: '输入', v: lines.length },
          { k: '识别', v: lines.filter(function (s) { const r = identify(s); return r.cands.length; }).length },
        ],
        filename: 'hash-id',
        next: [
          { label: '🔐 去加解密验算', tool: 'crypto' },
        ],
      };
    },
  });
})();
