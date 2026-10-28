/* ============================================================================
   Spider Lab · extra.js
   补充工具：校验和 / 扩展编码 / 签名构造器
   - checksum：CRC32 / Adler-32 / FNV-1a 32/64 / xxHash32（图片 URL 签名、ETag 高频）
   - codec-extra：Base32 / Base58 / XXTEA
   - sign-build：把「参数字典 + 密钥 → 签名字符串」这条最常手工拼的链条固化下来
   ========================================================================== */
(function () {

  /* ---------------- 校验和 ---------------- */
  SK.tool({
    id: 'checksum',
    name: '校验和 / 扩展哈希',
    group: 'codec',
    icon: '#',
    aliases: 'crc32 adler32 fnv xxhash 校验和 指纹 etag',
    keywords: ['crc32', 'adler32', 'fnv', 'fnv1a', 'xxhash', '校验和', 'checksum', 'etag', '去重', '指纹'],
    desc: '一次算出 CRC32 / Adler-32 / FNV-1a 32/64 / xxHash32：图片 URL 签名、ETag 反推、去重指纹都用得到',
    hint: '输入文本，或把「输入编码」切成 hex/base64 直接喂二进制',
    sample: 'texta',
    inputs: [{ id: 'in', label: '内容', placeholder: '文本，或 hex/base64 字节', sample: 'texta' }],
    options: [
      { id: 'inEnc', type: 'select', label: '输入编码', value: 'utf8', choices: [{ v: 'utf8', label: 'utf8' }, { v: 'hex', label: 'hex' }, { v: 'base64', label: 'base64' }] },
      { id: 'upper', type: 'toggle', label: '大写输出', value: true },
    ],
    handler: function (input, opts) {
      opts = opts || {};
      const text = String(input == null ? '' : input);
      if (!text) return { error: '输入为空' };
      let bytes;
      try { bytes = SK.crypt.encStr(text, opts.inEnc || 'utf8'); }
      catch (e) { return { error: '按 ' + opts.inEnc + ' 解码失败：' + e.message }; }
      const up = (s) => (opts.upper === false ? String(s).toLowerCase() : String(s).toUpperCase());
      const pad8 = (n) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
      const rows = [
        { 算法: 'CRC32', 值: up(pad8(SK.crypt2.crc32(bytes))), 说明: '标准 IEEE 802.3（zlib/PNG 同款）' },
        { 算法: 'Adler-32', 值: up(pad8(SK.crypt2.adler32(bytes))), 说明: 'zlib 流尾部校验' },
        { 算法: 'FNV-1a 32', 值: up(pad8(SK.crypt2.fnv1a32(bytes))), 说明: '短键散列，前端常用' },
        { 算法: 'FNV-1a 64', 值: up(SK.crypt2.fnv1a64(bytes)), 说明: '64 位不碰撞版' },
        { 算法: 'xxHash32', 值: up(pad8(SK.crypt2.xxhash32(bytes, 0))), 说明: 'seed=0，高速指纹' },
      ];
      return {
        text: rows.map((r) => r.算法 + '\t' + r.值).join('\n'),
        lang: 'text',
        tabs: [{
          label: '结果', view: 'table',
          data: { columns: [{ key: '算法', label: '算法', width: '110px' }, { key: '值', label: '值' }, { key: '说明', label: '说明', width: 'minmax(160px,260px)' }], rows: rows, name: 'checksum' },
        }],
        stats: [{ k: '字节数', v: bytes.length }, { k: '算法', v: rows.length }],
        notices: [{ level: 'info', msg: '同一份数据在不同工具里 CRC32 大小写/字节序可能不同；比对时先统一按数值比' }],
        filename: 'checksums',
      };
    },
  });

  /* ---------------- 扩展编码 / XXTEA ---------------- */
  SK.tool({
    id: 'codec-extra',
    name: 'Base32 / Base58 / XXTEA',
    group: 'codec',
    icon: '⇄',
    aliases: 'base32 base58 xxtea 编码 解码 加解密',
    keywords: ['base32', 'base58', 'xxtea', '编码', '解码', '加密', '国密', '比特币', '短链'],
    desc: 'Base32 / Base58 编解码 + XXTEA 加解密（爱奇艺/微博等国内站常见的 xxtea）',
    hint: 'XXTEA 的密钥按 utf8 取前 16 字节循环填充；Base58 用比特币字母表',
    sample: 'texta',
    inputs: [
      { id: 'in', label: '输入', placeholder: '要编码/解码的内容', sample: 'texta' },
      { id: 'key', label: 'XXTEA 密钥', placeholder: '选 XXTEA 时必填', small: true, allowEmpty: true },
    ],
    options: [
      { id: 'codec', type: 'select', label: '算法', value: 'base32', choices: [{ v: 'base32', label: 'Base32' }, { v: 'base58', label: 'Base58' }, { v: 'xxtea', label: 'XXTEA' }] },
      { id: 'dir', type: 'seg', label: '方向', value: 'enc', choices: [{ v: 'enc', label: '编码/加密' }, { v: 'dec', label: '解码/解密' }] },
      { id: 'inEnc', type: 'select', label: '密文编码', value: 'hex', choices: [{ v: 'hex', label: 'hex' }, { v: 'base64', label: 'base64' }] },
    ],
    handler: function (input, key, opts) {
      opts = opts || {};
      const text = String(input == null ? '' : input);
      const k = String(key == null ? '' : key).trim();
      const dir = opts.dir === 'dec' ? 'dec' : 'enc';
      const codec = opts.codec || 'base32';
      if (!text) return { error: '输入为空' };
      try {
        if (codec === 'base32') {
          if (dir === 'enc') {
            const out = SK.crypt2.base32Encode(SK.crypt.encStr(text, 'utf8'));
            return { text: out, lang: 'text', stats: [{ k: '算法', v: 'Base32' }, { k: '长度', v: out.length }] };
          }
          const bytes = SK.crypt2.base32Decode(text);
          return { text: SK.crypt.decBytes(bytes, 'utf8'), lang: 'text', stats: [{ k: '算法', v: 'Base32' }, { k: '字节', v: bytes.length }] };
        }
        if (codec === 'base58') {
          if (dir === 'enc') {
            const out = SK.crypt2.base58Encode(SK.crypt.encStr(text, 'utf8'));
            return { text: out, lang: 'text', stats: [{ k: '算法', v: 'Base58' }, { k: '长度', v: out.length }] };
          }
          const bytes = SK.crypt2.base58Decode(text);
          return { text: SK.crypt.decBytes(bytes, 'utf8'), lang: 'text', stats: [{ k: '算法', v: 'Base58' }, { k: '字节', v: bytes.length }] };
        }
        if (!k) return { error: 'XXTEA 需要密钥', hint: '密钥一般就是抓包里那个常量字符串，或从 JS 里搜出来的 key' };
        if (dir === 'enc') {
          const out = SK.crypt2.xxtea(SK.crypt.encStr(text, 'utf8'), k, false);
          const shown = SK.crypt.decBytes(out, opts.inEnc === 'base64' ? 'base64' : 'hex');
          return {
            text: shown, lang: 'text',
            stats: [{ k: '算法', v: 'XXTEA' }, { k: '密文', v: out.length + ' 字节' }],
            notices: [{ level: 'info', msg: 'XXTEA 按 uint32 小端处理，末尾做了 PKCS7 补齐；与常见 JS 版 xxtea 实现互通' }],
          };
        }
        const bytes = SK.crypt.encStr(text, opts.inEnc === 'base64' ? 'base64' : 'hex');
        const out = SK.crypt2.xxtea(bytes, k, true);
        return { text: SK.crypt.decBytes(out, 'utf8'), lang: 'text', stats: [{ k: '算法', v: 'XXTEA' }, { k: '明文', v: out.length + ' 字节' }] };
      } catch (e) {
        return { error: (codec || '').toUpperCase() + ' 处理失败：' + e.message, hint: dir === 'dec' ? '检查密钥是否正确、密文编码是否选对（hex/base64）' : '检查输入是否为空或含非法字符' };
      }
    },
  });

  /* ---------------- 签名构造器 ---------------- */
  SK.tool({
    id: 'sign-build',
    name: '签名构造器',
    group: 'codec',
    icon: '✍',
    aliases: 'sign signature 签名 构造 md5 排序 拼接 secret',
    keywords: ['签名', 'sign', 'signature', 'md5', 'sha1', 'sha256', 'hmac', '排序', '拼接', 'secret', '加签'],
    desc: '电商/接口签名的标准套路一把梭：参数字典 → 排序 → 拼接 → 加 secret → 哈希，直接给出待签串和签名值',
    hint: '参数支持 k=v&k=v 或 JSON；签名规则按目标站点勾选即可',
    sample: 'texta',
    inputs: [
      { id: 'params', label: '参数（k=v&k=v 或 JSON）', placeholder: 'page=1&size=20&keyword=手机', sample: 'texta' },
      { id: 'secret', label: '密钥 / secret', placeholder: '留空则不加密钥', small: true, allowEmpty: true },
    ],
    options: [
      { id: 'sort', type: 'select', label: '排序', value: 'ascii', choices: [{ v: 'ascii', label: '按 key ASCII 升序' }, { v: 'none', label: '保持原顺序' }, { v: 'desc', label: 'ASCII 降序' }, { v: 'value', label: '按 value 升序' }] },
      { id: 'join', type: 'select', label: '拼接形态', value: 'kv', choices: [{ v: 'kv', label: 'k=v&k=v' }, { v: 'kvnoeq', label: 'kv&kv（无等号）' }, { v: 'valonly', label: '只拼 value' }, { v: 'json', label: '紧凑 JSON' }] },
      { id: 'secretPos', type: 'seg', label: '密钥位置', value: 'append', choices: [{ v: 'append', label: '尾部' }, { v: 'prepend', label: '头部' }, { v: 'none', label: '不加' }] },
      { id: 'algo', type: 'select', label: '算法', value: 'md5', choices: [{ v: 'md5', label: 'MD5' }, { v: 'sha1', label: 'SHA1' }, { v: 'sha256', label: 'SHA256' }, { v: 'sm3', label: 'SM3' }, { v: 'hmac-sha256', label: 'HMAC-SHA256' }, { v: 'hmac-md5', label: 'HMAC-MD5' }] },
      { id: 'upper', type: 'toggle', label: '大写签名', value: false },
      { id: 'skipEmpty', type: 'toggle', label: '跳过空值参数', value: true },
      { id: 'encode', type: 'toggle', label: '先 URL 编码 value', value: false },
    ],
    handler: function (params, secret, opts) {
      opts = opts || {};
      const raw = String(params == null ? '' : params).trim();
      const sec = String(secret == null ? '' : secret);
      if (!raw) return { error: '请填参数', hint: '支持 page=1&size=20 或 {"page":1,"size":20}' };

      /* 解析参数 */
      let pairs = [];
      if (/^[[{]/.test(raw)) {
        let obj;
        try { obj = JSON.parse(raw); } catch (e) { return { error: 'JSON 解析失败：' + e.message }; }
        const walk = (o, prefix) => {
          for (const k in o) {
            const v = o[k];
            const name = prefix ? prefix + '.' + k : k;
            if (v && typeof v === 'object') walk(v, name);
            else pairs.push({ k: name, v: v == null ? '' : String(v) });
          }
        };
        walk(obj, '');
      } else {
        pairs = raw.replace(/^\?/, '').split('&').filter(Boolean).map((seg) => {
          const i = seg.indexOf('=');
          if (i < 0) return { k: decodeURIComponent(seg), v: '' };
          return { k: decodeURIComponent(seg.slice(0, i)), v: decodeURIComponent(seg.slice(i + 1)) };
        });
      }
      if (opts.skipEmpty !== false) pairs = pairs.filter((p) => p.v !== '');
      if (!pairs.length) return { error: '没有有效参数（可能全被「跳过空值」过滤了）' };

      /* 排序 */
      const sort = opts.sort || 'ascii';
      const arr = pairs.slice();
      if (sort === 'ascii') arr.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
      else if (sort === 'desc') arr.sort((a, b) => (a.k > b.k ? -1 : a.k < b.k ? 1 : 0));
      else if (sort === 'value') arr.sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0));

      /* 拼接 */
      const enc = (s) => (opts.encode ? encodeURIComponent(s) : s);
      const join = opts.join || 'kv';
      let body;
      if (join === 'kv') body = arr.map((p) => p.k + '=' + enc(p.v)).join('&');
      else if (join === 'kvnoeq') body = arr.map((p) => p.k + enc(p.v)).join('&');
      else if (join === 'valonly') body = arr.map((p) => enc(p.v)).join('');
      else body = JSON.stringify(arr.reduce((acc, p) => { acc[p.k] = p.v; return acc; }, {}));

      const pos = opts.secretPos || 'append';
      const signStr = pos === 'none' || !sec ? body : pos === 'prepend' ? sec + body : body + sec;

      /* 计算。注意底层约定：hash(algo, input, {enc:输入编码, out:输出编码})；
         hmac 的参数顺序是 hmac(algo, key, msg, opts)。 */
      const algo = opts.algo || 'md5';
      let digest;
      try {
        if (algo.indexOf('hmac-') === 0) {
          digest = SK.crypt.hmac(algo.slice(5), sec, signStr, { enc: 'utf8', out: 'hex' });
        } else {
          digest = SK.crypt.hash(algo, signStr, { enc: 'utf8', out: 'hex' });
        }
      } catch (e) {
        return { error: '计算失败：' + e.message, hint: 'HMAC 需要密钥，检查是否填了 secret' };
      }
      if (opts.upper) digest = String(digest).toUpperCase();

      const sortedText = arr.map((p) => p.k + '=' + p.v).join('&');
      return {
        text: digest,
        lang: 'text',
        tabs: [
          { label: '待签串', text: signStr, lang: 'text' },
          { label: '参数明细', view: 'table', data: {
            columns: [{ key: 'i', label: '#', width: '50px' }, { key: 'k', label: 'key' }, { key: 'v', label: 'value' }],
            rows: arr.map((p, i) => ({ i: i + 1, k: p.k, v: p.v })), name: 'sign-params',
          } },
          { label: '可直接用', text: [
            '# 签名规则：' + (sort === 'none' ? '原顺序' : sort === 'desc' ? 'ASCII 降序' : sort === 'value' ? '按 value 升序' : 'ASCII 升序') + ' / ' + join + ' / 密钥在' + (pos === 'none' ? '（不参与）' : pos === 'prepend' ? '头部' : '尾部') + ' / ' + algo.toUpperCase(),
            'sign_str = "' + signStr.replace(/"/g, '\\"') + '"',
            'sign     = "' + digest + '"',
            '',
            '# Python',
            (algo.indexOf('hmac-') === 0
              ? 'import hmac, hashlib\nsign = hmac.new(SECRET.encode(), sign_str.encode(), hashlib.' + algo.slice(5).replace('-', '') + ').hexdigest()'
              : 'import hashlib\nsign = hashlib.' + algo.replace('-', '') + '(sign_str.encode()).hexdigest()'),
            opts.upper ? 'sign = sign.upper()' : '# sign = sign.upper()  # 需要大写签名时打开',
            '',
            '# JS（CryptoJS）',
            algo.indexOf('hmac-') === 0
              ? "const sign = CryptoJS.Hmac" + (algo.slice(5) === 'md5' ? 'MD5' : 'SHA256') + "(signStr, SECRET).toString()"
              : "const sign = CryptoJS." + (algo === 'md5' ? 'MD5' : algo === 'sha1' ? 'SHA1' : algo === 'sm3' ? 'SM3' : 'SHA256') + "(signStr).toString()",
          ].join('\n'), lang: 'text' },
        ],
        stats: [{ k: '参数', v: arr.length }, { k: '算法', v: algo.toUpperCase() }, { k: '待签串', v: signStr.length + ' 字符' }],
        notices: [{ level: 'info', msg: '排序规则和拼接形态每家都不一样：签名对不上时先换「排序」和「拼接形态」再试，不要急着怀疑算法' }],
        filename: 'sign',
      };
    },
  });

})();
