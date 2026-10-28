/* ============================================================================
   Spider Lab · crypto2.js
   加密算法扩展：SM4（国密分组）/ DES / 3DES / RSA(PKCS#1 v1.5 + PEM)
   纯 JS、无依赖；SM4/DES 实现遵循标准 FIPS/GMT 0002。
   挂载到 SK.crypt2，worker 可用。
   ========================================================================== */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = (SK.crypt2 = {});

  /* ============================================================ 工具 */
  function bytesOf(input, enc) {
    if (input instanceof Uint8Array) return input;
    return SK.crypt.encStr(String(input == null ? '' : input), enc || 'utf8');
  }
  function outBytes(bytes, fmt) {
    return SK.crypt.decBytes(bytes, fmt || 'hex');
  }

  /* ============================================================ SM4（国密，GB/T 32907） */
  const SM4_SBOX = new Uint8Array([
    214,144,233,254,204,225,61,183,22,182,20,194,40,251,44,5,
    43,103,154,118,42,190,4,195,170,68,19,38,73,134,6,153,
    156,66,80,244,145,239,152,122,51,84,11,67,237,207,172,98,
    228,179,28,169,201,8,232,149,128,223,148,250,117,143,63,166,
    71,7,167,252,243,115,23,186,131,89,60,25,230,133,79,168,
    104,107,129,178,113,100,218,139,248,235,15,75,112,86,157,53,
    30,36,14,94,99,88,209,162,37,34,124,59,1,33,120,135,
    212,0,70,87,159,211,39,82,76,54,2,231,160,196,200,158,
    234,191,138,210,64,199,56,181,163,247,242,206,249,97,21,161,
    224,174,93,164,155,52,26,85,173,147,50,48,245,140,177,227,
    29,246,226,46,130,102,202,96,192,41,35,171,13,83,78,111,
    213,219,55,69,222,253,142,47,3,255,106,114,109,108,91,81,
    141,27,175,146,187,221,188,127,17,217,92,65,31,16,90,216,
    10,193,49,136,165,205,123,189,45,116,208,18,184,229,180,176,
    137,105,151,74,12,150,119,126,101,185,241,9,197,110,198,132,
    24,240,125,236,58,220,77,32,121,238,95,62,215,203,57,72,
  ]);
  const SM4_FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];
  const SM4_CK = [
    0x00070e15,0x1c232a31,0x383f464d,0x545b6269,0x70777e85,0x8c939aa1,0xa8afb6bd,0xc4cbd2d9,
    0xe0e7eef5,0xfc030a11,0x181f262d,0x343b4249,0x50575e65,0x6c737a81,0x888f969d,0xa4abb2b9,
    0xc0c7ced5,0xdce3eaf1,0xf8ff060d,0x141b2229,0x30373e45,0x4c535a61,0x686f767d,0x848b9299,
    0xa0a7aeb5,0xbcc3cad1,0xd8dfe6ed,0xf4fb0209,0x10171e25,0x2c333a41,0x484f565d,0x646b7279,
  ];
  function sm4Rotl(x, n) { n &= 31; return n === 0 ? (x | 0) : ((x << n) | (x >>> (32 - n))) | 0; }
  function sm4Tau(A) {
    return ((SM4_SBOX[(A >>> 24) & 0xff] << 24) | (SM4_SBOX[(A >>> 16) & 0xff] << 16) | (SM4_SBOX[(A >>> 8) & 0xff] << 8) | SM4_SBOX[A & 0xff]) | 0;
  }
  /* 标准轮函数：T(x) = L(τ(x))，L(B) = B ⊕ (B<<<2) ⊕ (B<<<10) ⊕ (B<<<18) ⊕ (B<<<24)（B 本身参与异或） */
  function sm4T(x) { const t = sm4Tau(x); return (t ^ sm4Rotl(t, 2) ^ sm4Rotl(t, 10) ^ sm4Rotl(t, 18) ^ sm4Rotl(t, 24)) | 0; }
  function sm4Tprime(x) { const t = sm4Tau(x); return (t ^ sm4Rotl(t, 13) ^ sm4Rotl(t, 23)) | 0; }
  function sm4KeySchedule(key) {
    const MK = [(key[0] << 24) | (key[1] << 16) | (key[2] << 8) | key[3],
      (key[4] << 24) | (key[5] << 16) | (key[6] << 8) | key[7],
      (key[8] << 24) | (key[9] << 16) | (key[10] << 8) | key[11],
      (key[12] << 24) | (key[13] << 16) | (key[14] << 8) | key[15]];
    const K = [MK[0] ^ SM4_FK[0], MK[1] ^ SM4_FK[1], MK[2] ^ SM4_FK[2], MK[3] ^ SM4_FK[3]];
    const rk = new Int32Array(32);
    for (let i = 0; i < 32; i++) {
      const tmp = (K[i + 1] ^ K[i + 2] ^ K[i + 3] ^ SM4_CK[i]) | 0;
      const kk = (K[i] ^ sm4Tprime(tmp)) | 0;
      K.push(kk);
      rk[i] = kk;
    }
    return rk;
  }
  function sm4CryptBlock(rk, block, out, off, decrypt) {
    const X = [];
    for (let i = 0; i < 4; i++) X[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
    for (let i = 0; i < 32; i++) {
      const k = decrypt ? rk[31 - i] : rk[i];
      const t = (X[i + 1] ^ X[i + 2] ^ X[i + 3] ^ k) | 0;
      X.push((X[i] ^ sm4T(t)) | 0);
    }
    const R = decrypt ? [X[35], X[34], X[33], X[32]] : [X[35], X[34], X[33], X[32]];
    for (let i = 0; i < 4; i++) {
      out[off + i * 4] = (R[i] >>> 24) & 0xff;
      out[off + i * 4 + 1] = (R[i] >>> 16) & 0xff;
      out[off + i * 4 + 2] = (R[i] >>> 8) & 0xff;
      out[off + i * 4 + 3] = R[i] & 0xff;
    }
  }
  function pkcs7Pad(data, bs) {
    const pad = bs - (data.length % bs);
    const out = new Uint8Array(data.length + pad);
    out.set(data);
    out.fill(pad, data.length);
    return out;
  }
  function pkcs7Unpad(data, bs) {
    if (!data.length) return data;
    const pad = data[data.length - 1];
    if (pad < 1 || pad > bs) return data;
    for (let i = data.length - pad; i < data.length; i++) if (data[i] !== pad) return data;
    return data.subarray(0, data.length - pad);
  }
  function sm4Crypt(mode, input, opts, decrypt) {
    const key = bytesOf(opts.key, opts.keyEnc || 'utf8');
    if (key.length !== 16) throw new Error('SM4 密钥必须是 16 字节（当前 ' + key.length + '）');
    /* 只实现了 ECB/CBC；其它模式必须显式报错，静默回落 CBC 会把错误答案当正确结果 */
    if (mode !== 'ecb' && mode !== 'cbc') throw new Error('SM4 不支持模式 ' + mode + '（仅 cbc / ecb）');
    const data = bytesOf(input, opts.enc || 'utf8');
    const rk = sm4KeySchedule(key);
    let work = data;
    if (!decrypt && opts.padding !== 'none') work = pkcs7Pad(data, 16);
    if (work.length % 16 !== 0) throw new Error('数据长度不是 16 的倍数（当前 ' + work.length + '），解密时尝试把填充设为 pkcs7 或检查密文');
    const out = new Uint8Array(work.length);
    if (mode === 'ecb') {
      for (let i = 0; i < work.length; i += 16) sm4CryptBlock(rk, work.subarray(i, i + 16), out, i, decrypt);
    } else {
      const iv = bytesOf(opts.iv, opts.ivEnc || opts.keyEnc || 'utf8');
      if (iv.length !== 16) throw new Error('SM4-CBC 的 IV 必须是 16 字节（当前 ' + iv.length + '）');
      if (!decrypt) {
        let prev = iv;
        for (let i = 0; i < work.length; i += 16) {
          const blk = new Uint8Array(16);
          for (let j = 0; j < 16; j++) blk[j] = work[i + j] ^ prev[j];
          sm4CryptBlock(rk, blk, out, i, false);
          prev = out.subarray(i, i + 16);
        }
      } else {
        let prev = iv;
        const tmp = new Uint8Array(work.length);
        for (let i = 0; i < work.length; i += 16) {
          sm4CryptBlock(rk, work.subarray(i, i + 16), tmp, i, true);
          for (let j = 0; j < 16; j++) tmp[i + j] ^= prev[j];
          prev = work.subarray(i, i + 16);
        }
        out.set(tmp);
      }
    }
    let final = out;
    if (decrypt && opts.padding !== 'none') final = pkcs7Unpad(out, 16);
    return outBytes(final, opts.out || 'hex');
  }
  C.sm4 = {
    encrypt: (input, opts) => sm4Crypt((opts && opts.mode) || 'cbc', input, opts || {}, false),
    decrypt: (input, opts) => sm4Crypt((opts && opts.mode) || 'cbc', input, opts || {}, true),
  };

  /* ============================================================ DES / 3DES */
  const DES_IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
  const DES_IPR = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
  const DES_E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
  const DES_P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
  const DES_PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
  const DES_PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
  const DES_SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
  const DES_S = [
    [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
    [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
    [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
    [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
    [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
    [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
    [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
    [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
  ];
  function desRotl28(v, n) { return ((v << n) | (v >>> (28 - n))) & 0x0fffffff; }
  function desSubKeys(key8) {
    const K = new Int32Array(56);
    for (let i = 0; i < 56; i++) {
      const bit = DES_PC1[i] - 1;
      K[i] = (key8[bit >> 3] >> (7 - (bit & 7))) & 1;
    }
    let C = 0, D = 0;
    for (let i = 0; i < 28; i++) { C = (C << 1) | K[i]; D = (D << 1) | K[i + 28]; }
    const keys = [];
    for (let r = 0; r < 16; r++) {
      C = desRotl28(C, DES_SHIFTS[r]);
      D = desRotl28(D, DES_SHIFTS[r]);
      const CD = new Int32Array(56);
      for (let i = 0; i < 28; i++) { CD[i] = (C >> (27 - i)) & 1; CD[i + 28] = (D >> (27 - i)) & 1; }
      const k = new Int32Array(48);
      for (let i = 0; i < 48; i++) k[i] = CD[DES_PC2[i] - 1];
      keys.push(k);
    }
    return keys;
  }
  function desBlock(keys, block, decrypt) {
    const M = new Int32Array(64);
    for (let i = 0; i < 64; i++) {
      const bit = DES_IP[i] - 1;
      M[i] = (block[bit >> 3] >> (7 - (bit & 7))) & 1;
    }
    let L = 0, R = 0;
    for (let i = 0; i < 32; i++) { L = (L << 1) | M[i]; R = (R << 1) | M[i + 32]; }
    for (let r = 0; r < 16; r++) {
      const k = decrypt ? keys[15 - r] : keys[r];
      const E = new Int32Array(48);
      for (let i = 0; i < 48; i++) E[i] = ((R >> (32 - DES_E[i])) & 1) ^ k[i];
      let fout = 0;
      for (let s = 0; s < 8; s++) {
        const row = (E[s * 6] << 1) | E[s * 6 + 5];
        const col = (E[s * 6 + 1] << 3) | (E[s * 6 + 2] << 2) | (E[s * 6 + 3] << 1) | E[s * 6 + 4];
        const v = DES_S[s][row * 16 + col];
        fout = (fout << 4) | v;
      }
      let fp = 0;
      for (let i = 0; i < 32; i++) fp = (fp << 1) | ((fout >> (32 - DES_P[i])) & 1);
      const newR = L ^ fp;
      L = R;
      R = newR | 0;
    }
    const pre = new Int32Array(64);
    for (let i = 0; i < 32; i++) { pre[i] = (R >> (31 - i)) & 1; pre[i + 32] = (L >> (31 - i)) & 1; }
    const out = new Uint8Array(8);
    for (let i = 0; i < 64; i++) {
      if (pre[DES_IPR[i] - 1]) out[i >> 3] |= 1 << (7 - (i & 7));
    }
    return out;
  }
  function desCrypt(algo, mode, input, opts, decrypt) {
    const key = bytesOf(opts.key, opts.keyEnc || 'utf8');
    if (algo === 'des' && key.length !== 8) throw new Error('DES 密钥必须是 8 字节（当前 ' + key.length + '）');
    if (algo === '3des' && key.length !== 24) throw new Error('3DES 密钥必须是 24 字节（当前 ' + key.length + '）');
    /* 同 SM4：未实现的模式不得静默回落 CBC */
    if (mode !== 'ecb' && mode !== 'cbc') throw new Error(algo.toUpperCase() + ' 不支持模式 ' + mode + '（仅 cbc / ecb）');
    const data = bytesOf(input, opts.enc || 'utf8');
    let work = data;
    if (!decrypt && opts.padding !== 'none') work = pkcs7Pad(data, 8);
    if (work.length % 8 !== 0) throw new Error('数据长度不是 8 的倍数（当前 ' + work.length + '），检查密文是否完整');
    const k1 = desSubKeys(key.subarray(0, 8));
    const k2 = algo === '3des' ? desSubKeys(key.subarray(8, 16)) : null;
    const k3 = algo === '3des' ? desSubKeys(key.subarray(16, 24)) : null;
    const run1 = (blk, dec) => desBlock(k1, blk, dec);
    /* 3DES EDE3（openssl des-ede3 语义）：
       加密 C = E_k3(D_k2(E_k1(P)))   解密 P = D_k1(E_k2(D_k3(C)))
       注意密钥顺序：第一个密钥用于最内层加密，第三个用于最外层。 */
    const ede = (blk, dec) => {
      if (algo === 'des') return run1(blk, dec);
      if (!dec) {
        const a = desBlock(k1, blk, false);   /* E_k1 */
        const b = desBlock(k2, a, true);      /* D_k2 */
        return desBlock(k3, b, false);        /* E_k3 */
      }
      const a = desBlock(k3, blk, true);      /* D_k3 */
      const b = desBlock(k2, a, false);       /* E_k2 */
      return desBlock(k1, b, true);           /* D_k1 */
    };
    const out = new Uint8Array(work.length);
    if (mode === 'ecb') {
      for (let i = 0; i < work.length; i += 8) out.set(ede(work.subarray(i, i + 8), decrypt), i);
    } else {
      const iv = bytesOf(opts.iv, opts.ivEnc || opts.keyEnc || 'utf8');
      if (iv.length !== 8) throw new Error(algo.toUpperCase() + '-CBC 的 IV 必须是 8 字节（当前 ' + iv.length + '）');
      if (!decrypt) {
        let prev = iv;
        for (let i = 0; i < work.length; i += 8) {
          const blk = new Uint8Array(8);
          for (let j = 0; j < 8; j++) blk[j] = work[i + j] ^ prev[j];
          const enc = ede(blk, false);
          out.set(enc, i);
          prev = enc;
        }
      } else {
        let prev = iv;
        for (let i = 0; i < work.length; i += 8) {
          const dec = ede(work.subarray(i, i + 8), true);
          for (let j = 0; j < 8; j++) out[i + j] = dec[j] ^ prev[j];
          prev = work.subarray(i, i + 8);
        }
      }
    }
    let final = out;
    if (decrypt && opts.padding !== 'none') final = pkcs7Unpad(out, 8);
    return outBytes(final, opts.out || 'hex');
  }
  C.des = {
    encrypt: (input, opts) => desCrypt('des', (opts && opts.mode) || 'cbc', input, opts || {}, false),
    decrypt: (input, opts) => desCrypt('des', (opts && opts.mode) || 'cbc', input, opts || {}, true),
  };
  C.des3 = {
    encrypt: (input, opts) => desCrypt('3des', (opts && opts.mode) || 'cbc', input, opts || {}, false),
    decrypt: (input, opts) => desCrypt('3des', (opts && opts.mode) || 'cbc', input, opts || {}, true),
  };

  /* ============================================================ RSA (PKCS#1 v1.5, BigInt) */
  function b64urlToB64(s) {
    let t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return t;
  }
  /* PEM / DER → BigInt 数组。支持：SPKI 公钥、PKCS#1 公钥、PKCS#8 私钥、PKCS#1 私钥 */
  function parsePem(pem) {
    const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(String(pem));
    if (!m) throw new Error('不是 PEM 格式（需要 -----BEGIN/END 标头），或直接粘贴 DER 的 base64');
    const label = m[1];
    const body = m[2].replace(/\s+/g, '');
    const bin = atob(b64urlToB64(body));
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    return { label: label, der: der };
  }
  function derRead(der, pos) {
    /* 返回 {tag, start, len, content} 或 null */
    if (pos >= der.length) return null;
    const tag = der[pos];
    let p = pos + 1;
    let len = der[p++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[p++];
    }
    return { tag: tag, content: p, len: len, end: p + len };
  }
  function derBigInt(der, seg) {
    let hex = '';
    for (let i = 0; i < seg.len; i++) hex += (der[seg.content + i] < 16 ? '0' : '') + der[seg.content + i].toString(16);
    if (!hex) return 0n;
    return BigInt('0x' + hex);
  }
  function derSeqChildren(der, seg) {
    const out = [];
    let p = seg.content;
    while (p < seg.end) {
      const s = derRead(der, p);
      if (!s) break;
      out.push(s);
      p = s.end;
    }
    return out;
  }
  function rsaKeysFromPem(pem) {
    let parsed;
    try {
      parsed = parsePem(pem);
    } catch (e) {
      /* 直接给了 base64 DER */
      const bin = atob(b64urlToB64(String(pem).replace(/\s+/g, '')));
      const der = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
      parsed = { label: 'RAW', der: der };
    }
    const der = parsed.der;
    const root = derRead(der, 0);
    if (!root || root.tag !== 0x30) throw new Error('DER 根节点不是 SEQUENCE，无法解析');
    let kids = derSeqChildren(der, root);
    let ints = [];
    if (/PRIVATE/.test(parsed.label)) {
      /* PKCS#1 私钥: SEQ { version, n, e, d, p, q, dp, dq, qinv } */
      if (kids.length >= 9 && kids[0].tag === 0x02) {
        ints = kids.slice(1);
      } else {
        /* PKCS#8 私钥: SEQ { version, AlgId, OCTET STRING { PKCS#1 } } */
        const oct = kids.find((k) => k.tag === 0x04);
        if (!oct) throw new Error('PKCS#8 私钥里找不到 OCTET STRING');
        const inner = derRead(der, oct.content);
        if (!inner) throw new Error('PKCS#8 内层解析失败');
        const ik = derSeqChildren(der, inner);
        if (ik.length < 9) throw new Error('PKCS#8 内层不是标准 RSA 私钥');
        ints = ik.slice(1);
      }
      return { n: derBigInt(der, ints[0]), e: derBigInt(der, ints[1]), d: derBigInt(der, ints[2]), isPrivate: true, der: der };
    }
    /* 公钥 */
    if (kids.length === 2 && kids[0].tag === 0x30) {
      /* SPKI: SEQ { AlgId, BIT STRING { SEQ { n, e } } } */
      const bit = kids.find((k) => k.tag === 0x03);
      if (!bit) throw new Error('SPKI 公钥里找不到 BIT STRING');
      const innerSeq = derRead(der, bit.content + 1); /* 跳过无用位字节 */
      if (!innerSeq) throw new Error('SPKI 内层解析失败');
      const ik = derSeqChildren(der, innerSeq);
      if (ik.length < 2) throw new Error('公钥参数不足');
      return { n: derBigInt(der, ik[0]), e: derBigInt(der, ik[1]), isPrivate: false, der: der };
    }
    /* PKCS#1 公钥: SEQ { n, e } */
    if (kids.length >= 2 && kids[0].tag === 0x02) {
      return { n: derBigInt(der, kids[0]), e: derBigInt(der, kids[1]), isPrivate: false, der: der };
    }
    throw new Error('无法识别的 RSA 密钥结构（label=' + parsed.label + '）');
  }
  function modpow(b, e, m) {
    let result = 1n;
    b %= m;
    while (e > 0n) {
      if (e & 1n) result = (result * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return result;
  }
  function bigToBytes(x, len) {
    if (x < 0n) throw new Error('负数不支持');
    let hex = x.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    if (!len) return bytes;
    if (bytes.length > len) throw new Error('数值超过 ' + len + ' 字节');
    const out = new Uint8Array(len);
    out.set(bytes, len - bytes.length);
    return out;
  }
  function bytesToBig(b) {
    let hex = '';
    for (let i = 0; i < b.length; i++) hex += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return hex ? BigInt('0x' + hex) : 0n;
  }
  function rsaEncrypt(input, opts) {
    const keys = rsaKeysFromPem(opts.key || '');
    const k = (keys.n.toString(2).length + 7) >> 3; /* 模数字节数 */
    const msg = bytesOf(input, opts.enc || 'utf8');
    if (msg.length > k - 11) throw new Error('明文 ' + msg.length + ' 字节超过该密钥上限 ' + (k - 11) + ' 字节（RSA 只能加密短数据，长内容请用 AES 加密 + RSA 加密 key 的混合方案）');
    /* PKCS#1 v1.5: 00 02 PS(≥8随机) 00 M */
    const em = new Uint8Array(k);
    em[0] = 0;
    em[1] = 2;
    for (let i = 2; i < k - msg.length - 1; i++) {
      let r = 0;
      do { r = Math.floor(Math.random() * 256); } while (r === 0);
      em[i] = r;
    }
    em[k - msg.length - 1] = 0;
    em.set(msg, k - msg.length);
    const c = modpow(bytesToBig(em), keys.e, keys.n);
    return outBytes(bigToBytes(c, k), opts.out || 'base64');
  }
  function rsaDecrypt(input, opts) {
    const keys = rsaKeysFromPem(opts.key || '');
    if (!keys.isPrivate) throw new Error('解密需要私钥（当前是公钥）');
    const k = (keys.n.toString(2).length + 7) >> 3;
    const c = bytesToBig(bytesOf(input, opts.enc || 'base64'));
    const m = modpow(c, keys.d, keys.n);
    const em = bigToBytes(m, k);
    /* 去 PKCS#1 v1.5 填充 */
    if (em[0] !== 0 || (em[1] !== 1 && em[1] !== 2)) throw new Error('解密结果填充不合法：密文或私钥可能不匹配');
    let i = 2;
    while (i < em.length && em[i] !== 0) i++;
    if (i >= em.length) throw new Error('找不到填充结束标志');
    return outBytes(em.subarray(i + 1), 'utf8');
  }
  C.rsa = { encrypt: rsaEncrypt, decrypt: rsaDecrypt, parsePem: rsaKeysFromPem };

/* ============================================================ WebCrypto 扩展：SHA3 / PBKDF2 / RSA-OAEP */
  const toB64 = (b) => SK.crypt.toB64(b);
  /* ---------- 纯 JS Keccak（SHA3-256/512）：不依赖 WebCrypto（Chromium 未实现 SHA3） ---------- */
  const KECCAK_RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  /* rho 旋转量，按 lane 索引 x + 5y */
  const KECCAK_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  const M64 = (1n << 64n) - 1n;
  function rotl64(x, n) { n = BigInt(n); return n === 0n ? x : ((x << n) | (x >> (64n - n))) & M64; }
  function keccakF(S) {
    for (let round = 0; round < 24; round++) {
      /* theta */
      const C = new Array(5), D = new Array(5);
      for (let x = 0; x < 5; x++) C[x] = S[x] ^ S[x + 5] ^ S[x + 10] ^ S[x + 15] ^ S[x + 20];
      for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) S[x + 5 * y] ^= D[x];
      /* rho + pi */
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(S[x + 5 * y], KECCAK_ROT[x + 5 * y]);
      }
      /* chi */
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        S[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M64 & B[(x + 2) % 5 + 5 * y]);
      }
      /* iota */
      S[0] ^= KECCAK_RC[round];
    }
  }
  function sha3Bytes(bits, data) {
    bits = Number(bits) === 512 ? 512 : 256;
    const rate = bits === 512 ? 72 : 136;
    const outLen = bits / 8;
    const S = new Array(25).fill(0n);
    /* pad10*1 with SHA3 domain byte 0x06 */
    const padded = new Uint8Array((((data.length + 1) / rate | 0) + 1) * rate);
    padded.set(data);
    padded[data.length] = 0x06;
    padded[padded.length - 1] |= 0x80;
    /* absorb */
    for (let off = 0; off < padded.length; off += rate) {
      for (let lane = 0; lane < rate / 8; lane++) {
        let v = 0n;
        for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(padded[off + lane * 8 + b]);
        S[lane] ^= v;
      }
      keccakF(S);
    }
    /* squeeze */
    const out = new Uint8Array(outLen);
    let written = 0;
    while (written < outLen) {
      for (let lane = 0; lane < rate / 8 && written < outLen; lane++) {
        let v = S[lane];
        for (let b = 0; b < 8 && written < outLen; b++) {
          out[written++] = Number(v & 0xffn);
          v >>= 8n;
        }
      }
      if (written < outLen) keccakF(S);
    }
    return out;
  }
  C.sha3 = {
    /* out 默认 hex，兼容 'hexup' / 'base64' / 'bytes' 等——调用方选了输出编码就该生效 */
    digest: async function (bits, input, opts) {
      const o = String(((opts || {}).out) || 'hex');
      return outBytes(sha3Bytes(bits, bytesOf(input, (opts && opts.enc) || 'utf8')), o);
    },
  };

  C.pbkdf2 = {
    /* 生成：随机盐 → deriveBits → PHC 格式串 */
    generate: async function (password, opts) {
      opts = opts || {};
      const hash = String(opts.hash || 'SHA-256').toUpperCase();
      const iter = Math.max(1000, Number(opts.iterations || 100000));
      const dkLen = Math.max(16, Number(opts.dkLen || 32));
      const salt = root.crypto.getRandomValues(new Uint8Array(Number(opts.saltLen) || 16));
      const key = await root.crypto.subtle.importKey('raw', bytesOf(password, 'utf8'), 'PBKDF2', false, ['deriveBits']);
      const bits = await root.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: hash, salt: salt, iterations: iter }, key, dkLen * 8);
      return '$pbkdf2-' + hash.toLowerCase().replace('-', '') + '$i=' + iter + '$' + toB64(salt) + '$' + toB64(new Uint8Array(bits));
    },
    /* 校验：PHC 串 + 口令 → 是否匹配 */
    verify: async function (phc, password) {
      const m = /^\$pbkdf2-(sha\d+)\$i=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(phc || '').trim());
      if (!m) throw new Error('不是 PHC 格式 PBKDF2（$pbkdf2-sha256$i=迭代$盐$摘要）');
      const hash = 'SHA-' + m[1].slice(3).toUpperCase();
      const iter = Number(m[2]);
      const salt = SK.crypt.fromB64(m[3]);
      const expect = SK.crypt.fromB64(m[4]);
      const key = await root.crypto.subtle.importKey('raw', bytesOf(password, 'utf8'), 'PBKDF2', false, ['deriveBits']);
      const bits = new Uint8Array(await root.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: hash, salt: salt, iterations: iter }, key, expect.length * 8));
      if (bits.length !== expect.length) return false;
      let diff = 0;
      for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expect[i];
      return diff === 0;
    },
  };

  C.rsaOAEP = {
    encrypt: async function (input, opts) {
      const keys = rsaKeysFromPem(opts.key || '');
      if (keys.der === undefined) throw new Error('RSA-OAEP 需要 PEM（SPKI 公钥 / PKCS#8 私钥）');
      const hash = String(opts.hash || 'SHA-256').toUpperCase();
      const algo = { name: 'RSA-OAEP', hash: hash };
      const isPriv = keys.isPrivate;
      const key = await root.crypto.subtle.importKey(isPriv ? 'pkcs8' : 'spki', keys.der, algo, false, isPriv ? ['encrypt'] : ['encrypt']);
      const buf = await root.crypto.subtle.encrypt(algo, key, bytesOf(input, 'utf8'));
      return toB64(new Uint8Array(buf));
    },
    decrypt: async function (input, opts) {
      const keys = rsaKeysFromPem(opts.key || '');
      if (!keys.isPrivate) throw new Error('OAEP 解密需要私钥（PKCS#8 PEM）');
      const hash = String(opts.hash || 'SHA-256').toUpperCase();
      const algo = { name: 'RSA-OAEP', hash: hash };
      const key = await root.crypto.subtle.importKey('pkcs8', keys.der, algo, false, ['decrypt']);
      const buf = await root.crypto.subtle.decrypt(algo, key, bytesOf(input, opts.enc || 'base64'));
      return outBytes(new Uint8Array(buf), 'utf8');
    },
  };


  /* ============================================================ AES-GCM（WebCrypto 委托）
     现代站点标配，且浏览器原生支持——没必要自己写 GHASH。
     密文格式与 OpenSSL/Java 一致：ciphertext || tag(16B)。 */
  C.aesGcm = {
    encrypt: async function (input, opts) {
      opts = opts || {};
      const keyB = bytesOf(opts.key, opts.keyEnc || 'utf8');
      if ([16, 24, 32].indexOf(keyB.length) < 0) throw new Error('AES-GCM 密钥必须是 16/24/32 字节（当前 ' + keyB.length + '）');
      const iv = bytesOf(opts.iv, opts.ivEnc || opts.keyEnc || 'utf8');
      if (!iv.length) throw new Error('AES-GCM 必须提供 IV/nonce（推荐 12 字节）');
      const algo = { name: 'AES-GCM', iv: iv, tagLength: 128 };
      if (opts.aad) algo.additionalData = bytesOf(opts.aad, opts.aadEnc || 'utf8');
      const k = await root.crypto.subtle.importKey('raw', keyB, algo.name, false, ['encrypt']);
      const pt = bytesOf(input, opts.enc || 'utf8');
      const buf = await root.crypto.subtle.encrypt(algo, k, pt);
      return outBytes(new Uint8Array(buf), opts.out || 'hex');
    },
    decrypt: async function (input, opts) {
      opts = opts || {};
      const keyB = bytesOf(opts.key, opts.keyEnc || 'utf8');
      const iv = bytesOf(opts.iv, opts.ivEnc || opts.keyEnc || 'utf8');
      if (!iv.length) throw new Error('AES-GCM 必须提供 IV/nonce');
      const algo = { name: 'AES-GCM', iv: iv, tagLength: 128 };
      if (opts.aad) algo.additionalData = bytesOf(opts.aad, opts.aadEnc || 'utf8');
      const k = await root.crypto.subtle.importKey('raw', keyB, algo.name, false, ['decrypt']);
      const ct = bytesOf(input, opts.enc || 'hex');
      const buf = await root.crypto.subtle.decrypt(algo, k, ct);
      return outBytes(new Uint8Array(buf), opts.out || 'utf8');
    },
  };

  /* ============================================================ 校验和 / 扩展哈希
     爬虫高频：图片 URL 签名、ETag、指纹去重都用得到。 */
  const CRC32_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  C.crc32 = function (bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  C.adler32 = function (bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  };
  C.fnv1a32 = function (bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return h >>> 0;
  };
  /* FNV-1a 64：用 BigInt 保证 64 位乘法不丢精度（浏览器/Node 均支持） */
  C.fnv1a64 = function (bytes) {
    let h = 0xcbf29ce484222325n;
    const P = 0x100000001b3n;
    for (let i = 0; i < bytes.length; i++) {
      h = BigInt.asUintN(64, (h ^ BigInt(bytes[i])) * P);
    }
    return h.toString(16).padStart(16, '0');
  };
  /* xxHash32（seed=0）
     注意：32 位乘法必须用 Math.imul，直接 * 会在超过 2^53 时丢精度（实测结果全错）。 */
  const XX_P1 = 0x9E3779B1, XX_P2 = 0x85EBCA77, XX_P3 = 0xC2B2AE3D, XX_P4 = 0x27D4EB2F, XX_P5 = 0x165667B1;
  function rotl32(x, r) { return ((x << r) | (x >>> (32 - r))) >>> 0; }
  function xxRound(acc, v) {
    acc = (acc + Math.imul(v, XX_P2)) >>> 0;
    return Math.imul(rotl32(acc, 13), XX_P1) >>> 0;
  }
  C.xxhash32 = function (bytes, seed) {
    const len = bytes.length;
    let i = 0, h;
    const s0 = (seed || 0) >>> 0;
    if (len >= 16) {
      let v1 = (s0 + XX_P1 + XX_P2) >>> 0, v2 = (s0 + XX_P2) >>> 0, v3 = s0 >>> 0, v4 = (s0 - XX_P1) >>> 0;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const end = len - 16;
      while (i <= end) {
        v1 = xxRound(v1, dv.getUint32(i, true)); i += 4;
        v2 = xxRound(v2, dv.getUint32(i, true)); i += 4;
        v3 = xxRound(v3, dv.getUint32(i, true)); i += 4;
        v4 = xxRound(v4, dv.getUint32(i, true)); i += 4;
      }
      h = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
    } else {
      h = (s0 + XX_P5) >>> 0;
    }
    h = (h + len) >>> 0;
    while (i + 4 <= len) {
      const w = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
      h = (h + Math.imul(w, XX_P3)) >>> 0;
      h = Math.imul(rotl32(h, 17), XX_P4) >>> 0;
      i += 4;
    }
    while (i < len) {
      h = (h + Math.imul(bytes[i], XX_P5)) >>> 0;
      h = Math.imul(rotl32(h, 11), XX_P1) >>> 0;
      i++;
    }
    h ^= h >>> 15; h = Math.imul(h, XX_P2) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, XX_P3) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  };

  /* ============================================================ XXTEA（国内站点高频） */
  C.xxtea = function (bytes, keyStr, decrypt) {
    const key = keyStr instanceof Uint8Array ? keyStr : SK.crypt.encStr(String(keyStr || ''), 'utf8');
    if (!key.length) throw new Error('XXTEA 需要密钥');
    const k = new Uint32Array(4);
    for (let i = 0; i < 4; i++) {
      k[i] = (key[(i * 4) % key.length] | (key[(i * 4 + 1) % key.length] << 8) | (key[(i * 4 + 2) % key.length] << 16) | (key[(i * 4 + 3) % key.length] << 24)) >>> 0;
    }
    let v;
    if (!decrypt) {
      /* PKCS7 补齐到 4 字节倍数（XXTEA 以 uint32 为单位） */
      const pad = 4 - (bytes.length % 4 || 4) + 4;
      const n = bytes.length + pad;
      const b = new Uint8Array(n);
      b.set(bytes);
      for (let i = bytes.length; i < n; i++) b[i] = pad & 0xff;
      v = new Uint32Array(n / 4);
      for (let i = 0; i < v.length; i++) v[i] = (b[i * 4] | (b[i * 4 + 1] << 8) | (b[i * 4 + 2] << 16) | (b[i * 4 + 3] << 24)) >>> 0;
    } else {
      if (bytes.length % 4) throw new Error('XXTEA 密文长度必须是 4 的倍数（当前 ' + bytes.length + '）');
      v = new Uint32Array(bytes.length / 4);
      for (let i = 0; i < v.length; i++) v[i] = (bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24)) >>> 0;
    }
    const n = v.length;
    if (n < 2) throw new Error('XXTEA 数据至少 8 字节');
    const DELTA = 0x9E3779B9;
    let sum = 0, y, z, e, p, q;
    if (!decrypt) {
      q = Math.floor(6 + 52 / n);
      z = v[n - 1];
      while (q-- > 0) {
        sum = (sum + DELTA) >>> 0;
        e = (sum >>> 2) & 3;
        for (p = 0; p < n; p++) {
          y = v[(p + 1) % n];
          const mx = ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) >>> 0;
          v[p] = (v[p] + mx) >>> 0;
          z = v[p];
        }
      }
    } else {
      q = Math.floor(6 + 52 / n);
      sum = (q * DELTA) >>> 0;
      y = v[0];
      while (sum !== 0) {
        e = (sum >>> 2) & 3;
        for (p = n - 1; p >= 0; p--) {
          z = v[(p - 1 + n) % n];
          const mx = ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z))) >>> 0;
          v[p] = (v[p] - mx) >>> 0;
          y = v[p];
        }
        sum = (sum - DELTA) >>> 0;
      }
    }
    const outB = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      outB[i * 4] = v[i] & 0xff;
      outB[i * 4 + 1] = (v[i] >>> 8) & 0xff;
      outB[i * 4 + 2] = (v[i] >>> 16) & 0xff;
      outB[i * 4 + 3] = (v[i] >>> 24) & 0xff;
    }
    if (decrypt) {
      const pad = outB[outB.length - 1];
      if (pad >= 1 && pad <= 8 && pad <= outB.length) {
        let ok = true;
        for (let i = outB.length - pad; i < outB.length; i++) if (outB[i] !== pad) { ok = false; break; }
        if (ok) return outB.subarray(0, outB.length - pad);
      }
    }
    return outB;
  };

  /* ============================================================ Base32 / Base58 */
  const B32A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  C.base32Encode = function (bytes) {
    let bits = 0, value = 0, out = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += B32A[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32A[(value << (5 - bits)) & 31];
    while (out.length % 8) out += '=';
    return out;
  };
  C.base32Decode = function (str) {
    const s = String(str).replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
    let bits = 0, value = 0;
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const idx = B32A.indexOf(s[i]);
      if (idx < 0) throw new Error('非法 Base32 字符：' + s[i]);
      value = (value << 5) | idx; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return new Uint8Array(out);
  };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  C.base58Encode = function (bytes) {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    /* 全零输入：值为 0 没有有效位，digits 必须为空。
       旧实现初始 digits=[0]，末尾会把这个 0 也打成一个 '1'，
       于是 [0]→"11"、[0,0]→"111"，解码回来凭空多出 1 个零字节。 */
    if (zeros === bytes.length) return '1'.repeat(zeros);
    const digits = [0];
    for (let i = zeros; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '1'.repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  };
  C.base58Decode = function (str) {
    const s = String(str).trim();
    let zeros = 0;
    while (zeros < s.length && s[zeros] === '1') zeros++;
    const bytes = [];
    for (let i = zeros; i < s.length; i++) {
      const idx = B58.indexOf(s[i]);
      if (idx < 0) throw new Error('非法 Base58 字符：' + s[i]);
      let carry = idx;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    const out = new Uint8Array(zeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
    return out;
  };

})(typeof self !== 'undefined' ? self : globalThis);
