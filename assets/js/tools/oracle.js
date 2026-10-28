/* ============================================================================
   Spider Lab · oracle.js
   加密参数 oracle：已知密文 + 明文片段，暴力枚举 算法×模式×IV策略×编码，
   命中即报参数组合——正向加解密的反向工具。
   handler 内联全部逻辑（Worker 同步执行）。
   ========================================================================== */
(function () {

  SK.tool({
    id: 'cipher-oracle',
    name: '解密参数枚举',
    group: 'codec',
    icon: '🔮',
    aliases: 'oracle 反推 猜参数 枚举 试解 iv 模式 密文反推',
    keywords: ['oracle', '反推', '枚举', '解密', 'iv', '模式', 'aes', '参数', '逆向'],
    desc: '已知密文和明文片段（如 {"code":0），枚举 算法×模式×填充×IV取法×编码 共数百组合，命中明文即报出参数组合——必须给候选密钥，不做密钥破解',
    hint: '最常见命中：密文前 16 字节是 IV（openssl 风格）、key 是 hex、CBC+PKCS7',
    inputs: [
      { id: 'in', label: '密文', placeholder: 'hex 或 base64 密文', sample: 'oracle-ct' },
      { id: 'known', label: '已知明文片段', placeholder: '{"code":0 / user_name / 登录成功', small: true, sample: 'oracle-known', allowEmpty: true },
      { id: 'key', label: '密钥 Key', placeholder: '16/24/32 字节（utf8 / hex / base64 均自动尝试）', small: true, sample: 'oracle-key' },
      { id: 'ivin', label: 'IV（勾「用我的 IV」时参与枚举）', placeholder: 'hex / base64 / 文本，长度须匹配算法', small: true, allowEmpty: true },
    ],
    options: [
      { id: 'aes', type: 'toggle', label: 'AES', value: true },
      { id: 'sm4', type: 'toggle', label: 'SM4', value: true },
      { id: 'des', type: 'toggle', label: 'DES', value: false },
      { id: 'des3', type: 'toggle', label: '3DES', value: true },
      { id: 'rc4', type: 'toggle', label: 'RC4', value: true },
      { id: 'userIv', type: 'toggle', label: '用我的 IV', value: false, title: '下面的 IV 框参与枚举（作为策略之一）' },
    ],
    help:
      '<h4>解决什么</h4>' +
      '<p>加解密工具是"已知参数算结果"；逆向更常遇到反向：拿到<b>密文</b>和<b>明文开头几个字</b>（接口响应前缀 JSON 常见），不知道 mode/padding/IV 怎么取。本工具把参数组合全部跑一遍，哪个组合能解出已知明文就报哪个。</p>' +
      '<h4>枚举空间</h4>' +
      '<ul><li><b>算法</b>：AES / SM4 / DES / 3DES / RC4（按勾选）</li>' +
      '<li><b>模式</b>：CBC / ECB / CTR / CFB / OFB（流密码无模式）</li>' +
      '<li><b>IV 策略</b>：①密文前 16 字节当 IV（openssl 加密输出常见！）②key 前 16 字节 ③全 0 ④你填的 IV</li>' +
      '<li><b>编码</b>：key 的 utf8/hex/base64 × 密文的 hex/base64</li></ul>' +
      '<p>组合数百个，后台线程秒级跑完；命中后把表格里的参数抄到「加解密」工具即可稳定复现。</p>' +
      '<h4>命中不了怎么办</h4>' +
      '<ul><li>明文片段换更靠前、更稳的（响应 JSON 开头比中文文案可靠）</li>' +
      '<li>key 可能被二次处理（先 MD5 再做 key）——去「JS 沙箱执行」里跑目标站代码验证</li>' +
      '<li>多重加密（先 RC4 再 Base64）：手动剥一层再试</li></ul>',
    handler: function (ct, known, key, ivin, opts) {
      const ctText = String(ct == null ? '' : ct).trim();
      const knownText = String(known == null ? '' : known).trim();
      const keyText = String(key == null ? '' : key).trim();
      if (!ctText) return { error: '密文为空' };
      if (!knownText) return { error: '请填已知明文片段', hint: '响应类密文用 JSON 前缀（如 {"code":0）；请求参数类用参数名（如 page 或 user_id）' };
      if (!keyText) return { error: '请填密钥 Key', hint: '逆向拿到的 key 原样粘贴，编码会自动尝试' };

      /* --- 解码工具 --- */
      const fromHex = function (s) {
        const t = s.replace(/0x/gi, '').replace(/[\s,]/g, '');
        if (!/^[0-9a-f]+$/i.test(t) || t.length % 2 || !t.length) return null;
        const b = new Uint8Array(t.length / 2);
        for (let i = 0; i < b.length; i++) b[i] = parseInt(t.substr(i * 2, 2), 16);
        return b;
      };
      const fromB64 = function (s) {
        try {
          let t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
          while (t.length % 4) t += '=';
          const bin = atob(t);
          const b = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
          return b;
        } catch (e) { return null; }
      };
      const toHex = function (b) {
        let s = '';
        for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        return s;
      };
      const tryUtf8 = function (b) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 2048))); }
        catch (e) { return null; }
      };

      /* --- 密文候选（hex / base64 双试） --- */
      const ctCandidates = [];
      const h = fromHex(ctText);
      if (h && h.length >= 8) ctCandidates.push({ label: 'hex', bytes: h });
      const b = fromB64(ctText);
      if (b && b.length >= 8 && (!h || toHex(b) !== toHex(h))) ctCandidates.push({ label: 'base64', bytes: b });
      if (!ctCandidates.length) return { error: '密文既不是合法 hex 也不是合法 base64' };

      /* --- key 候选 --- */
      const keyCandidates = [];
      const asUtf8 = new TextEncoder().encode(keyText);
      if (asUtf8.length) keyCandidates.push({ label: 'utf8', bytes: asUtf8 });
      const kh = fromHex(keyText);
      if (kh && kh.length >= 8) keyCandidates.push({ label: 'hex', bytes: kh });
      const kb = fromB64(keyText);
      if (kb && kb.length >= 8 && (!kh || toHex(kb) !== toHex(kh))) keyCandidates.push({ label: 'base64', bytes: kb });

      const ivLenOf = function (cipher) { return cipher === 'des' || cipher === '3des' ? 8 : 16; };
      const keyLenOk = function (cipher, len) {
        if (cipher === 'aes') return len === 16 || len === 24 || len === 32;
        if (cipher === 'sm4') return len === 16;
        if (cipher === 'des') return len === 8;
        if (cipher === '3des') return len === 24;
        return true; /* rc4 任意 */
      };

      const hits = [];
      let tried = 0;
      const ciphers = [];
      if (opts.aes) ciphers.push('aes');
      if (opts.sm4) ciphers.push('sm4');
      if (opts.des) ciphers.push('des');
      if (opts.des3) ciphers.push('3des');
      if (opts.rc4) ciphers.push('rc4');
      if (!ciphers.length) return { error: '至少勾选一种算法' };

      const LIMIT = 4096; /* 每组合最多试解前 4KB，防大密文拖慢 */

      for (const kc of keyCandidates) {
        if (!keyLenOk('any', kc.bytes.length) && ciphers.length) { /* key 对所有算法都不合法时仍继续（rc4 任意长） */ }
        for (const cipher of ciphers) {
          if (!keyLenOk(cipher, kc.bytes.length)) continue;
          /* 流式 */
          if (cipher === 'rc4') {
            for (const cc of ctCandidates) {
              tried++;
              try {
                const outBytes = SK.crypt.rc4(cc.bytes, kc.bytes, { out: 'bytes' });
                const s = tryUtf8(outBytes.subarray(0, LIMIT));
                if (s && s.indexOf(knownText) >= 0) {
                  hits.push({ cipher: 'RC4', mode: '-', iv: '-', keyEnc: kc.label, ctEnc: cc.label, preview: s.slice(0, 120) });
                }
              } catch (e) {}
            }
            continue;
          }
          for (const mode of ['cbc', 'ecb', 'ctr', 'cfb', 'ofb']) {
            for (const cc of ctCandidates) {
              /* IV 策略 */
              const ivList = [];
              const needIv = mode !== 'ecb';
              if (needIv) {
                const L = ivLenOf(cipher);
                ivList.push({ label: '密文前 ' + L + ' 字节', strategy: 'ctPrefix' });
                if (kc.bytes.length >= L) ivList.push({ label: 'key 前 ' + L + ' 字节', strategy: 'keyPrefix' });
                ivList.push({ label: '全 0', strategy: 'zero' });
                if (opts.userIv) {
                  /* 用户填的 IV 可能是 hex / base64 / 原文。旧实现用 `fromHex || fromB64 || utf8`
                     短路取值：'abcdef9876543210' 恰好全是 hex 字符 → 先被当成 8 字节，
                     长度不匹配就被静默跳过，正确的 utf8 解读永远试不到。
                     这里三种解读都列出，按长度过滤后各自参与枚举。 */
                  const ivText = String(ivin || '');
                  if (ivText) {
                    const seenIv = {};
                    const cands = [];
                    const asH = fromHex(ivText);
                    if (asH) cands.push({ enc: 'hex', bytes: asH });
                    const asB = fromB64(ivText);
                    if (asB) cands.push({ enc: 'base64', bytes: asB });
                    const asU = new TextEncoder().encode(ivText);
                    if (asU.length) cands.push({ enc: 'utf8', bytes: asU });
                    cands.forEach(function (c) {
                      if (c.bytes.length !== L) return;
                      const key = toHex(c.bytes);
                      if (seenIv[key]) return;
                      seenIv[key] = 1;
                      ivList.push({ label: '我的 IV(' + c.enc + ')', strategy: 'user', bytes: c.bytes });
                    });
                  }
                }
              } else {
                ivList.push({ label: '-', strategy: 'none' });
              }
              for (const iv of ivList) {
                tried++;
                try {
                  let data = cc.bytes;
                  let ivBytes = null;
                  if (iv.strategy === 'ctPrefix') {
                    const L = ivLenOf(cipher);
                    if (data.length <= L) continue;
                    ivBytes = data.slice(0, L);
                    data = data.slice(L);
                  } else if (iv.strategy === 'keyPrefix') {
                    const L = ivLenOf(cipher);
                    ivBytes = kc.bytes.slice(0, L);
                  } else if (iv.strategy === 'zero') {
                    ivBytes = new Uint8Array(ivLenOf(cipher));
                  } else if (iv.strategy === 'user') {
                    ivBytes = iv.bytes;
                  }
                  let outBytes = null;
                  const kopts = { key: kc.bytes, keyEnc: 'raw', out: 'bytes', padding: 'none' };
                  if (ivBytes) kopts.iv = ivBytes;
                  kopts.ivEnc = 'raw';
                  const input = toHex(data);
                  if (cipher === 'aes') outBytes = SK.crypt.aesDecrypt(mode, input, Object.assign({}, kopts, { enc: 'hex', out: 'bytes' }));
                  else if (cipher === 'sm4') outBytes = SK.crypt2.sm4.decrypt(input, Object.assign({ mode: mode }, kopts, { enc: 'hex', out: 'bytes' }));
                  else if (cipher === 'des') outBytes = SK.crypt2.des.decrypt(input, Object.assign({ mode: mode }, kopts, { enc: 'hex', out: 'bytes' }));
                  else if (cipher === '3des') outBytes = SK.crypt2.des3.decrypt(input, Object.assign({ mode: mode }, kopts, { enc: 'hex', out: 'bytes' }));
                  if (!outBytes || !outBytes.length) continue;
                  const s = tryUtf8(outBytes);
                  if (s && s.indexOf(knownText) >= 0) {
                    hits.push({
                      cipher: cipher.toUpperCase(), mode: mode.toUpperCase(),
                      iv: iv.label, keyEnc: kc.label, ctEnc: cc.label,
                      preview: s.slice(0, 120),
                    });
                  }
                } catch (e) { /* 该组合不适用，跳过 */ }
              }
            }
          }
        }
      }

      if (!hits.length) {
        return {
          error: '试了 ' + tried + ' 种组合都没解出「' + knownText.slice(0, 30) + '」',
          hint: '① 换更靠前的明文片段 ② key 可能先经过 MD5/SHA 等处理（沙箱里验证）③ 多层加密先剥外层 ④ DES 默认没勾，老系统再勾上试',
        };
      }

      const rows = hits.map(function (x, i) {
        return {
          n: i + 1,
          cipher: x.cipher + '-' + x.mode,
          iv: x.iv,
          keyEnc: x.keyEnc,
          ctEnc: x.ctEnc,
          preview: x.preview.length > 90 ? x.preview.slice(0, 90) + '…' : x.preview,
          __detail: '算法: ' + x.cipher + '\n模式: ' + x.mode + '\nIV: ' + x.iv + '\nKey 编码: ' + x.keyEnc + '\n密文编码: ' + x.ctEnc + '\n\n解密预览:\n' + x.preview + '\n\n到「加解密」工具按以上参数复现（密文若走"密文前N字节当IV"，记得先把前 ' + (x.iv.indexOf('密文前') === 0 ? x.iv.replace(/[^0-9]/g, '') || 16 : 0) + ' 字节切出来当 IV）',
          __detailTitle: x.cipher + '-' + x.mode + ' 参数',
        };
      });

      const textOut = hits.map(function (x, i) {
        return (i + 1) + '. ' + x.cipher + '-' + x.mode + '  IV=' + x.iv + '  key=' + x.keyEnc + '  密文=' + x.ctEnc + '\n   → ' + x.preview.slice(0, 80);
      }).join('\n');

      return {
        text: textOut,
        lang: 'text',
        tabLabel: '命中组合 (' + hits.length + ')',
        tabs: [{ label: '明细表', view: 'table', data: {
          columns: [
            { key: 'n', label: '#', width: '44px' },
            { key: 'cipher', label: '算法-模式', width: '110px' },
            { key: 'iv', label: 'IV 策略', width: 'minmax(120px,160px)' },
            { key: 'keyEnc', label: 'Key 编码', width: '80px' },
            { key: 'ctEnc', label: '密文编码', width: '80px' },
            { key: 'preview', label: '解密预览' },
          ],
          rows: rows, name: 'oracle-hits',
          filterHint: '按算法/模式过滤',
        } }],
        stats: [
          { k: '命中', v: hits.length, level: 'ok' },
          { k: '枚举组合', v: SK.dom.fmtNum(tried) },
          { k: 'key 候选', v: keyCandidates.length },
        ],
        notices: [{ level: 'ok', msg: '把命中行的参数抄到「加解密」工具即可稳定复现；多个命中时优先 iv=密文前N字节 的组合（最常见）' }],
        _ct: ctText,
        _known: knownText,
        next: [
          { label: '🔐 去加解密（密文已带过去）', tool: 'crypto', carry: '_ct', input: 0 },
        ],
        filename: 'oracle-hits',
        next: [
          { label: '🔐 去加解密按参数复现', tool: 'crypto' },
          { label: '🧠 沙箱里跑目标站算法', tool: 'js-sandbox' },
        ],
      };
    },
  });
})();
