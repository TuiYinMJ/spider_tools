/* SK.crypt - offline crypto/encoding primitives for page and classic worker. */
(function (root) {
  'use strict';
  var SK = (root.SK = root.SK || {});

  var B64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64URL_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var HEX_DOWN = '0123456789abcdef';
  var HEX_UP = '0123456789ABCDEF';
  var EMPTY = new Uint8Array(0);

  function u8(len) { return new Uint8Array(len); }

  function isBytes(v) {
    return v instanceof Uint8Array || v instanceof ArrayBuffer ||
      (v && typeof v === 'object' && typeof v.byteLength === 'number' &&
        typeof v.length === 'number' && ArrayBuffer.isView(v));
  }

  function viewOf(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (Array.isArray(v)) return Uint8Array.from(v);
    throw new TypeError('expected Uint8Array/ArrayBuffer, got ' + Object.prototype.toString.call(v));
  }

  var te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function utf8Len(str) {
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xe000) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function utf8Encode(str) {
    if (te) return te.encode(str);
    var max = utf8Len(str), out = u8(max), o = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out[o++] = c;
      else if (c < 0x800) { out[o++] = 0xc0 | (c >> 6); out[o++] = 0x80 | (c & 63); }
      else if (c >= 0xd800 && c < 0xe000) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out[o++] = 0xf0 | (cp >> 18); out[o++] = 0x80 | ((cp >> 12) & 63);
        out[o++] = 0x80 | ((cp >> 6) & 63); out[o++] = 0x80 | (cp & 63);
      } else {
        out[o++] = 0xe0 | (c >> 12); out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63);
      }
    }
    return o === max ? out : out.subarray(0, o);
  }

  function utf8Decode(bytes, fatal) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8', { fatal: !!fatal }).decode(bytes); }
      catch (e) { if (fatal) throw e; }
    }
    var out = [], i = 0, n = bytes.length;
    while (i < n) {
      var b = bytes[i++], cp;
      if (b < 0x80) cp = b;
      else if (b < 0xc0) { if (fatal) throw new Error('BAD_UTF8: invalid continuation byte at ' + (i - 1)); cp = 0xfffd; }
      else if (b < 0xe0) { cp = ((b & 31) << 6) | (bytes[i++] & 63); }
      else if (b < 0xf0) { cp = ((b & 15) << 12) | ((bytes[i] & 63) << 6) | (bytes[i + 1] & 63); i += 2; }
      else { cp = ((b & 7) << 18) | ((bytes[i] & 63) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
      if (cp > 0xffff) {
        cp -= 0x10000;
        out.push(String.fromCharCode(0xd800 + (cp >> 10)), String.fromCharCode(0xdc00 + (cp & 1023)));
      } else out.push(String.fromCharCode(cp));
    }
    return out.join('');
  }

  function decodeCharset(bytes, charset) {
    if (typeof TextDecoder === 'undefined') {
      throw new Error('ENC_UNSUPPORTED: this platform has no TextDecoder for "' +
        charset + '"; use utf8/latin1/hex/base64 instead');
    }
    var d;
    try { d = new TextDecoder(charset); }
    catch (e) {
      throw new Error('ENC_UNSUPPORTED: TextDecoder label "' + charset + '" is not available here');
    }
    return d.decode(bytes);
  }

  var B64_LOOKUP = (function () {
    var t = new Int16Array(256);
    t.fill(-1);
    for (var i = 0; i < 64; i++) t[B64_ALPHA.charCodeAt(i)] = i;
    t[B64_ALPHA.charCodeAt(62)] = 62;
    return t;
  })();

  function hexClean(str) {
    var s = String(str).trim();
    if (/^0[xX]/.test(s)) s = s.slice(2);
    var out = [], buf = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (/[0-9a-fA-F]/.test(c)) buf += c;
      else if (c === ':' || c === '-' || c === ' ' || c === ',' || c === '\n' || c === '\r' || c === '\t') {
        if (buf.length) { out.push(buf); buf = ''; }
      } else throw new Error('HEX_ERROR: invalid character "' + c + '" at index ' + i);
    }
    if (buf.length) out.push(buf);
    var joined = out.join('');
    if (joined.length % 2) throw new Error('HEX_ERROR: odd number of hex digits (' + joined.length + ')');
    return joined;
  }

  function hexDecodeBytes(str) {
    var s = hexClean(str), n = s.length >> 1, out = u8(n);
    var hi = function (c) {
      return c >= 48 && c <= 57 ? c - 48 : (c >= 65 && c <= 70 ? c - 55 : c - 87);
    };
    for (var i = 0; i < n; i++) out[i] = (hi(s.charCodeAt(2 * i)) << 4) | hi(s.charCodeAt(2 * i + 1));
    return out;
  }

  function bytesToHex(bytes, upper) {
    var table = upper ? HEX_UP : HEX_DOWN, out = new Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      out[i] = table.charAt(b >> 4) + table.charAt(b & 15);
    }
    return out.join('');
  }

  function latin1(bytes) {
    var chunks = [], step = 8192;
    for (var i = 0; i < bytes.length; i += step) {
      chunks.push(String.fromCharCode.apply(String, bytes.subarray(i, Math.min(i + step, bytes.length))));
    }
    return chunks.join('');
  }

  function latin1ToBytes(str) {
    var n = str.length, out = u8(n);
    for (var i = 0; i < n; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  function b64ToBytes(str, opts) {
    opts = opts || {};
    var alpha = opts.alphabet || B64_ALPHA;
    var map = new Int16Array(256).fill(-1);
    for (var i = 0; i < 64; i++) map[alpha.charCodeAt(i)] = i;
    var pad = opts.padChar === undefined ? '=' : opts.padChar;
    var clean = [], idx = [];
    for (var j = 0; j < str.length; j++) {
      var ch = str.charAt(j);
      if (ch === pad || ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') continue;
      if (map[str.charCodeAt(j)] < 0) {
        if (opts.strict) return { error: 'B64_ERROR: invalid character "' + ch + '" at index ' + j, index: j };
        continue;
      }
      clean.push(ch);
      idx.push(map[str.charCodeAt(j)]);
    }
    if (opts.strict && opts.requirePadding && pad && str.length % 4 !== 0) {
      return { error: 'B64_ERROR: length ' + str.length + ' is not a multiple of 4', index: str.length };
    }
    var n = idx.length, outLen = (n * 6) >> 3, out = u8(outLen), o = 0, acc = 0, bits = 0;
    for (var k = 0; k < n; k++) {
      acc = (acc << 6) | idx[k];
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
    }
    return { bytes: out.subarray(0, o) };
  }

  function bytesToB64(bytes, opts) {
    opts = opts || {};
    var alpha = opts.alphabet || B64_ALPHA;
    var padChar = opts.padChar === undefined ? '=' : opts.padChar;
    var n = bytes.length, out = new Array(Math.ceil(n / 3) * 4), o = 0;
    var a64 = function (v) { return alpha.charAt(v); };
    for (var i = 0; i < n; i += 3) {
      var b0 = bytes[i], b1 = i + 1 < n ? bytes[i + 1] : -1, b2 = i + 2 < n ? bytes[i + 2] : -1;
      out[o++] = a64(b0 >> 2);
      if (b1 < 0) {
        out[o++] = a64((b0 & 3) << 4);
        if (padChar) { out[o++] = padChar; out[o++] = padChar; }
      } else if (b2 < 0) {
        out[o++] = a64(((b0 & 3) << 4) | (b1 >> 4));
        out[o++] = a64((b1 & 15) << 2);
        if (padChar) { out[o++] = padChar; }
      } else {
        out[o++] = a64(((b0 & 3) << 4) | (b1 >> 4));
        out[o++] = a64(((b1 & 15) << 2) | (b2 >> 6));
        out[o++] = a64(b2 & 63);
      }
    }
    return out.join('');
  }

  var ENC_ALIAS = {
    utf8: 1, 'utf-8': 1, u8: 1,
    latin1: 1, 'latin-1': 1, binary: 1, ascii: 1, windows1252: 1, raw: 1,
    hex: 1, base64: 1, base64url: 1, b64: 1, b64u: 1,
    gbk: 1, gb2312: 1, gb18030: 1,
    bytes: 1, buffer: 1, Uint8Array: 1
  };

  function normalizeInput(input, enc) {
    if (input == null) return EMPTY;
    if (isBytes(input)) {
      var v = viewOf(input);
      return v;
    }
    if (typeof input !== 'string') {
      if (Array.isArray(input)) return viewOf(input);
      throw new TypeError('unsupported input type ' + typeof input);
    }
    var e = String(enc || 'utf8').toLowerCase();
    if (!ENC_ALIAS[e]) throw new Error('ENC_UNSUPPORTED: unknown input encoding "' + enc + '"');
    switch (e) {
      case 'utf8': case 'utf-8': case 'u8': return utf8Encode(input);
      case 'latin1': case 'latin-1': case 'binary': case 'raw': return latin1ToBytes(input);
      case 'ascii': return latin1ToBytes(input);
      case 'hex': return hexDecodeBytes(input);
      case 'base64': case 'b64': {
        var r = b64ToBytes(input, { strict: true });
        if (r.error) throw new Error(r.error);
        return r.bytes;
      }
      case 'base64url': case 'b64u': {
        var r2 = b64ToBytes(input, { strict: true, alphabet: B64URL_ALPHA, padChar: '' });
        if (r2.error) throw new Error(r2.error);
        return r2.bytes;
      }
      case 'bytes': throw new Error('ENC_UNSUPPORTED: "bytes" is an output encoding only');
      default: return utf8Encode(decodeCharset(latin1ToBytes(input), e));
    }
  }

  function outputBytes(bytes, out, encHint) {
    out = String(out || 'hex').toLowerCase();
    switch (out) {
      case 'hex': return bytesToHex(bytes, false);
      case 'hexup': case 'HEX': return bytesToHex(bytes, true);
      case 'base64': case 'b64': return bytesToB64(bytes, {});
      case 'base64url': case 'b64u': return bytesToB64(bytes, { alphabet: B64URL_ALPHA, padChar: '' });
      case 'bytes': case 'uint8array': case 'buffer': return bytes;
      case 'raw': case 'latin1': case 'binary': return latin1(bytes);
      case 'utf8': case 'utf-8': return utf8Decode(bytes, false);
      case 'array': case 'arr': return Array.prototype.slice.call(bytes);
      default:
        if (encHint && /^(gbk|gb2312|gb18030)$/.test(out)) return decodeCharset(bytes, out);
        throw new Error('ENC_UNSUPPORTED: unknown output encoding "' + out + '"');
    }
  }

  function bytesFromOpts(opts, name, encName, fallbackEnc) {
    opts = opts || {};
    var v = opts[name];
    if (v === undefined || v === null || v === '') return EMPTY;
    if (isBytes(v)) return viewOf(v);
    return normalizeInput(String(v), opts[encName] || fallbackEnc || 'utf8');
  }
  var MD5_K = new Int32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ]);
  var MD5_S = new Int32Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ]);
  var MD5_ORDER = new Int32Array([0, 3, 2, 1]);
  var MD5_W = new Int32Array(16);
  var MD5_R = new Int32Array(4);

  function rotl32(x, n) { return (x << n) | (x >>> (32 - n)); }

  function md5Compress(st, d, off) {
    for (var i = 0; i < 16; i++) {
      var p = off + 4 * i;
      MD5_W[i] = d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
    }
    MD5_R[0] = st[0]; MD5_R[1] = st[1]; MD5_R[2] = st[2]; MD5_R[3] = st[3];
    for (i = 0; i < 64; i++) {
      var f, g;
      if (i < 16) { f = (MD5_R[1] & MD5_R[2]) | (~MD5_R[1] & MD5_R[3]); g = i; }
      else if (i < 32) { f = (MD5_R[3] & MD5_R[1]) | (~MD5_R[3] & MD5_R[2]); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = MD5_R[1] ^ MD5_R[2] ^ MD5_R[3]; g = (3 * i + 5) & 15; }
      else { f = MD5_R[2] ^ (MD5_R[1] | ~MD5_R[3]); g = (7 * i) & 15; }
      var t = MD5_ORDER[i & 3];
      var b = MD5_R[(t + 1) & 3];
      MD5_R[t] = (b + rotl32((MD5_R[t] + f + MD5_K[i] + MD5_W[g]) | 0, MD5_S[i])) | 0;
    }
    for (i = 0; i < 4; i++) st[i] = (st[i] + MD5_R[i]) | 0;
  }

  function md5Out(st) {
    var out = u8(16);
    for (var i = 0; i < 4; i++) {
      var v = st[i];
      out[4 * i] = v & 255; out[4 * i + 1] = (v >>> 8) & 255;
      out[4 * i + 2] = (v >>> 16) & 255; out[4 * i + 3] = (v >>> 24) & 255;
    }
    return out;
  }

  var SHA1_W = new Int32Array(80);

  function sha1Compress(st, d, off) {
    var w = SHA1_W, i;
    for (i = 0; i < 16; i++) {
      var p = off + 4 * i;
      w[i] = (d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3];
    }
    for (i = 16; i < 80; i++) w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    var a = st[0], b = st[1], c = st[2], dd = st[3], e = st[4];
    for (i = 0; i < 80; i++) {
      var f, k;
      if (i < 20) { f = (b & c) | (~b & dd); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ dd; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & dd) | (c & dd); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ dd; k = 0xca62c1d6; }
      var t = (rotl32(a, 5) + f + e + k + w[i]) | 0;
      e = dd; dd = c; c = rotl32(b, 30); b = a; a = t;
    }
    st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0;
    st[3] = (st[3] + dd) | 0; st[4] = (st[4] + e) | 0;
  }

  var SHA256_K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  var SHA256_IV = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  var SHA224_IV = new Int32Array([
    0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4
  ]);
  var SHA2_W = new Int32Array(64);

  function sha256Compress(st, d, off) {
    var w = SHA2_W, i;
    for (i = 0; i < 16; i++) {
      var p = off + 4 * i;
      w[i] = (d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3];
    }
    for (i = 16; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var s0 = (rotl32(w15, 31) | rotl32(w15, 18) | (w15 >>> 7)) | 0;
      var s1 = (rotl32(w2, 17) | rotl32(w2, 19) | (w2 >>> 10)) | 0;
      w[i] = (w[i - 7] + s0 + w[i - 16] + s1) | 0;
    }
    var a = st[0], b = st[1], c = st[2], dd = st[3], e = st[4], f2 = st[5], g = st[6], h = st[7];
    for (i = 0; i < 64; i++) {
      var S1 = (rotl32(e, 6) | rotl32(e, 19) | rotl32(e, 10)) | 0;
      var ch = (e & f2) | (~e & g);
      var t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      var S0 = (rotl32(a, 2) | rotl32(a, 13) | rotl32(a, 22)) | 0;
      var maj = (a & b) | (a & c) | (b & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f2; f2 = e; e = (dd + t1) | 0;
      dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + dd) | 0;
    st[4] = (st[4] + e) | 0; st[5] = (st[5] + f2) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
  }

  function sha32Out(st, words) {
    var out = u8(words * 4);
    for (var i = 0; i < words; i++) {
      var v = st[i], o = 4 * i;
      out[o] = v >>> 24; out[o + 1] = (v >>> 16) & 255; out[o + 2] = (v >>> 8) & 255; out[o + 3] = v & 255;
    }
    return out;
  }
  function sha1Out(st) { return sha32Out(st, 5); }
  function sha256Out(st) { return sha32Out(st, 8); }
  function sha224Out(st) { return sha32Out(st, 7); }

  var SHA512_K = new Int32Array([
    0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
    0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
    0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
    0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
    0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
    0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
    0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
    0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
    0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
    0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
    0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
    0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
    0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
    0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
    0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
    0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
    0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
    0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
    0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
    0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817
  ]);
  var SHA512_IV = new Int32Array([
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179
  ]);
  var SHA384_IV = new Int32Array([
    0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
    0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4
  ]);
  var SHA512_W = new Int32Array(160);
  var R5 = new Int32Array(2);

  /* SHA-512 keeps each 64-bit word as a signed (hi, lo) 32-bit pair; R5 returns the pair. */
  function rotr512(h, l, n) {
    if (n === 32) { R5[0] = l; R5[1] = h; }
    else if (n < 32) { R5[0] = (h >>> n) | (l << (32 - n)); R5[1] = (l >>> n) | (h << (32 - n)); }
    else { var m = n - 32; R5[0] = (l >>> m) | (h << (32 - m)); R5[1] = (h >>> m) | (l << (32 - m)); }
  }

  function shr512(h, l, n) {
    if (n === 32) { R5[0] = 0; R5[1] = h; }
    else if (n < 32) { R5[0] = h >>> n; R5[1] = (l >>> n) | (h << (32 - n)); }
    else { R5[0] = 0; R5[1] = h >>> (n - 32); }
  }

  function sha512Compress(st, d, off) {
    var w = SHA512_W, i, t;
    for (i = 0; i < 16; i++) {
      t = off + 8 * i;
      w[2 * i] = (d[t] << 24) | (d[t + 1] << 16) | (d[t + 2] << 8) | d[t + 3];
      w[2 * i + 1] = (d[t + 4] << 24) | (d[t + 5] << 16) | (d[t + 6] << 8) | d[t + 7];
    }
    for (i = 16; i < 80; i++) {
      var xh = w[2 * i - 30], xl = w[2 * i - 29];
      rotr512(xh, xl, 1); var s0h = R5[0], s0l = R5[1];
      rotr512(xh, xl, 8); s0h ^= R5[0]; s0l ^= R5[1];
      shr512(xh, xl, 7); s0h ^= R5[0]; s0l ^= R5[1];
      var yh = w[2 * i - 4], yl = w[2 * i - 3];
      rotr512(yh, yl, 19); var s1h = R5[0], s1l = R5[1];
      rotr512(yh, yl, 61); s1h ^= R5[0]; s1l ^= R5[1];
      shr512(yh, yl, 6); s1h ^= R5[0]; s1l ^= R5[1];
      s0h ^= s1h; s0l ^= s1l;
      var lo = ((s0l >>> 0) + (w[2 * i - 14] >>> 0) + (w[2 * i - 32] >>> 0));
      var hi = ((s0h + w[2 * i - 13] + w[2 * i - 31] + Math.floor(lo / 4294967296)) | 0);
      w[2 * i] = hi; w[2 * i + 1] = lo >>> 0;
    }
    var ah0 = st[0], al0 = st[1], bh0 = st[2], bl0 = st[3], ch0 = st[4], cl0 = st[5],
      dh0 = st[6], dl0 = st[7], eh0 = st[8], el0 = st[9], fh0 = st[10], fl0 = st[11],
      gh0 = st[12], gl0 = st[13], hh0 = st[14], hl0 = st[15];
    for (i = 0; i < 80; i++) {
      rotr512(eh0, el0, 14); var s1h = R5[0], s1l = R5[1];
      rotr512(eh0, el0, 18); s1h ^= R5[0]; s1l ^= R5[1];
      rotr512(eh0, el0, 41); s1h ^= R5[0]; s1l ^= R5[1];
      var chh = (eh0 & fh0) | (~eh0 & gh0), chl = (el0 & fl0) | (~el0 & gl0);
      var kh = SHA512_K[4 * i], kl = SHA512_K[4 * i + 1];
      var wh = w[2 * i], wl = w[2 * i + 1];
      var t1lo = ((hl0 >>> 0) + (s1l >>> 0) + (chl >>> 0) + (kl >>> 0) + (wl >>> 0));
      var c1 = Math.floor(t1lo / 4294967296);
      var t1h = ((hh0 + s1h + chh + kh + wh) + c1) | 0, t1l = t1lo >>> 0;
      rotr512(ah0, al0, 28); var s0h = R5[0], s0l = R5[1];
      rotr512(ah0, al0, 34); s0h ^= R5[0]; s0l ^= R5[1];
      rotr512(ah0, al0, 39); s0h ^= R5[0]; s0l ^= R5[1];
      var majh = (ah0 & bh0) | (ah0 & ch0) | (bh0 & ch0), majl = (al0 & bl0) | (al0 & cl0) | (bl0 & cl0);
      var t2lo = ((s0l >>> 0) + (majl >>> 0));
      var t2h = ((s0h + majh) + Math.floor(t2lo / 4294967296)) | 0, t2l = t2lo >>> 0;
      var dlo = ((dl0 >>> 0) + (t1l >>> 0));
      var dhi = ((dh0 + t1h) + Math.floor(dlo / 4294967296)) | 0, dls = dlo >>> 0;
      hh0 = gh0; hl0 = gl0;
      gh0 = fh0; gl0 = fl0;
      fh0 = eh0; fl0 = el0;
      eh0 = dhi; el0 = dls;
      dh0 = ch0; dl0 = cl0;
      ch0 = bh0; cl0 = bl0;
      bh0 = ah0; bl0 = al0;
      var alo = ((t1l >>> 0) + (t2l >>> 0));
      ah0 = ((t1h + t2h) + Math.floor(alo / 4294967296)) | 0; al0 = alo >>> 0;
    }
    var hadds = [st[0] + ah0, st[2] + bh0, st[4] + ch0, st[6] + dh0,
      st[8] + eh0, st[10] + fh0, st[12] + gh0, st[14] + hh0];
    var ladds = [
      (st[1] >>> 0) + (al0 >>> 0), (st[3] >>> 0) + (bl0 >>> 0), (st[5] >>> 0) + (cl0 >>> 0),
      (st[7] >>> 0) + (dl0 >>> 0), (st[9] >>> 0) + (el0 >>> 0), (st[11] >>> 0) + (fl0 >>> 0),
      (st[13] >>> 0) + (gl0 >>> 0), (st[15] >>> 0) + (hl0 >>> 0)
    ];
    for (i = 0; i < 8; i++) {
      st[2 * i] = (hadds[i] + Math.floor(ladds[i] / 4294967296)) | 0;
      st[2 * i + 1] = ladds[i] >>> 0;
    }
  }

  function sha512Out(st, words) {
    var out = u8(words * 8);
    for (var i = 0; i < words; i++) {
      var hi = st[2 * i], lo = st[2 * i + 1], o = 8 * i;
      out[o] = hi >>> 24; out[o + 1] = (hi >>> 16) & 255; out[o + 2] = (hi >>> 8) & 255; out[o + 3] = hi & 255;
      out[o + 4] = lo >>> 24; out[o + 5] = (lo >>> 16) & 255; out[o + 6] = (lo >>> 8) & 255; out[o + 7] = lo & 255;
    }
    return out;
  }
  function sha512Full(st) { return sha512Out(st, 8); }
  function sha384Out(st) { return sha512Out(st, 6); }

  var HASH_SPECS = {
    md5: {
      blockSize: 64, digestSize: 16, le: true, iv: function () {
        return new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
      }, compress: md5Compress, out: md5Out
    },
    sha1: {
      blockSize: 64, digestSize: 20, le: false, iv: function () {
        return new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
      }, compress: sha1Compress, out: sha1Out
    },
    sha256: { blockSize: 64, digestSize: 32, le: false, iv: function () { return SHA256_IV.slice(); }, compress: sha256Compress, out: sha256Out },
    sha224: { blockSize: 64, digestSize: 28, le: false, iv: function () { return SHA224_IV.slice(); }, compress: sha256Compress, out: sha224Out },
    sha512: { blockSize: 128, digestSize: 64, le: false, iv: function () { return SHA512_IV.slice(); }, compress: sha512Compress, out: sha512Full },
    sha384: { blockSize: 128, digestSize: 48, le: false, iv: function () { return SHA384_IV.slice(); }, compress: sha512Compress, out: sha384Out }
  };

  function addBE64(out, off, lo, hi) {
    for (var i = 7; i >= 0; i--) {
      var w = i >= 4 ? hi : lo;
      var shift = (i & 3) * 8;
      out[off + i] = (w >>> shift) & 255;
    }
  }

  function addLE64(out, off, lo, hi) {
    for (var i = 0; i < 8; i++) {
      var w = i < 4 ? lo : hi;
      out[off + i] = (w >>> ((i & 3) * 8)) & 255;
    }
  }

  function createHash(algo, opts) {
    var name = String(algo || '').toLowerCase().replace(/[-_\s]/g, '');
    var spec = HASH_SPECS[name];
    if (!spec) {
      throw new Error('UNSUPPORTED hash "' + algo + '". Supported: ' + Object.keys(HASH_SPECS).join(', '));
    }
    var BS = spec.blockSize;
    var st = spec.iv();
    var buf = u8(BS), bufLen = 0, bytesLo = 0, bytesHi = 0, done = false;

    function addLen(n) {
      var s = (bytesLo >>> 0) + (n >>> 0);
      bytesHi = (bytesHi + Math.floor(s / 4294967296)) >>> 0;
      bytesLo = s >>> 0;
    }

    var api = {
      algo: name,
      blockSize: BS,
      digestSize: spec.digestSize,
      update: function (chunk, o) {
        if (done) throw new Error('HASH_STATE: update() called after digest()');
        var data = typeof chunk === 'string' ? normalizeInput(chunk, (o && o.enc) || (opts && opts.enc) || 'utf8') : viewOf(chunk);
        var n = data.length;
        addLen(n);
        var i = 0;
        if (bufLen) {
          var need = BS - bufLen, take = Math.min(need, n);
          buf.set(data.subarray(0, take), bufLen);
          bufLen += take; i = take;
          if (bufLen === BS) { spec.compress(st, buf, 0); bufLen = 0; }
        }
        if (n - i >= BS) {
          var end = i + (((n - i) / BS) | 0) * BS;
          for (; i < end; i += BS) spec.compress(st, data, i);
        }
        if (n > i) { buf.set(data.subarray(i), 0); bufLen = n - i; }
        return api;
      },
      digest: function (o) {
        o = o || opts || {};
        if (!done) {
          var bitLo = ((bytesLo << 3) >>> 0);
          var bitHi = (((bytesHi << 3) >>> 0) + Math.floor((bytesLo >>> 0) * 8 / 4294967296)) >>> 0;
          var blocks = bufLen + 9 <= BS ? BS : 2 * BS;
          var tail = u8(blocks);
          tail.set(buf.subarray(0, bufLen));
          tail[bufLen] = 0x80;
          var lenOff = blocks - 8;
          if (spec.le) addLE64(tail, lenOff, bitLo, bitHi); else addBE64(tail, lenOff, bitLo, bitHi);
          for (var k = 0; k < blocks; k += BS) spec.compress(st, tail, k);
          done = true;
        }
        var bytes = spec.out(st);
        var outName = o.out || o.encoding;
        return outName ? outputBytes(bytes, outName, o.enc) : bytesToHex(bytes, false);
      }
    };
    return api;
  }
  function hash(algo, input, opts) {
    return createHash(algo).update(input, opts).digest(opts);
  }

  SK.crypt = {
    createHash: createHash,
    hash: hash
  };
  /* ============================================================
   * 追加：HMAC / AES / SM3 / RC4 / 编码工具
   * ============================================================ */

  function toHex(bytes) { return bytesToHex(bytes, false); }
  function fromHex(s) { return hexDecodeBytes(s); }
  function toB64(bytes) { return bytesToB64(bytes, {}); }
  function fromB64(s) { return b64ToBytes(s, {}).bytes || new Uint8Array(0); }
  function encStr(s, enc) { return normalizeInput(String(s == null ? '' : s), enc || 'utf8'); }
  function decBytes(bytes, enc) {
    const e = String(enc || 'utf8').toLowerCase();
    /* 原始字节直通：供 oracle / 二次处理（多算法级联、试解码）使用，不能被转成字符串 */
    if (e === 'bytes' || e === 'uint8array' || e === 'buffer' || e === 'rawbytes') return bytes;
    if (e === 'hex') return toHex(bytes);
    if (e === 'hexup' || e === 'HEX') return toHex(bytes).toUpperCase();
    if (e === 'base64' || e === 'b64') return toB64(bytes);
    if (e === 'base64url') return outputBytes(bytes, 'base64url');
    if (e === 'latin1' || e === 'binary' || e === 'raw') return latin1(bytes);
    if (e === 'array') return Array.prototype.slice.call(bytes).join(',');
    return utf8Decode(bytes, false);
  }

  /* ---------- 正确的哈希内核（覆盖旧实现） ---------- */
  function rotr32(x, n) { return (x >>> n) | (x << (32 - n)); }

  function padBlocks(data, blockSize, lenBytes, le) {
    const bitLen = data.length * 8;
    let total = data.length + 1 + lenBytes;
    if (total % blockSize !== 0) total += blockSize - (total % blockSize);
    const out = u8(total);
    out.set(data);
    out[data.length] = 0x80;
    for (var i = 0; i < lenBytes; i++) {
      var byteVal = Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff;
      out[le ? total - lenBytes + i : total - 1 - i] = byteVal;
    }
    return out;
  }

  function md5Bytes(data) {
    var padded = padBlocks(data, 64, 8, true);
    var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    var M = new Int32Array(16);
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        var p = off + 4 * i;
        M[i] = padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        var tmp = D;
        D = C; C = B;
        B = (B + rotl32((A + F + MD5_K[i] + M[g]) | 0, MD5_S[i])) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = u8(16);
    [a0, b0, c0, d0].forEach(function (v, k) {
      out[4 * k] = v & 255; out[4 * k + 1] = (v >>> 8) & 255;
      out[4 * k + 2] = (v >>> 16) & 255; out[4 * k + 3] = (v >>> 24) & 255;
    });
    return out;
  }

  function sha1Bytes(data) {
    var padded = padBlocks(data, 64, 8, false);
    var h0 = 0x67452301 | 0, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476 | 0, h4 = 0xc3d2e1f0 | 0;
    var w = new Int32Array(80);
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        var p = off + 4 * i;
        w[i] = (padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3];
      }
      for (i = 16; i < 80; i++) w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var t = (rotl32(a, 5) + f + e + k + w[i]) | 0;
        e = d; d = c; c = rotl32(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    var out = u8(20);
    [h0, h1, h2, h3, h4].forEach(function (v, k) {
      out[4 * k] = (v >>> 24) & 255; out[4 * k + 1] = (v >>> 16) & 255;
      out[4 * k + 2] = (v >>> 8) & 255; out[4 * k + 3] = v & 255;
    });
    return out;
  }

  function sha256Bytes(data, is224) {
    var padded = padBlocks(data, 64, 8, false);
    var H = (is224 ? SHA224_IV : SHA256_IV).slice();
    var w = new Int32Array(64);
    for (var off = 0; off < padded.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        var p = off + 4 * i;
        w[i] = (padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3];
      }
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3);
        var s1 = rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
        var S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var words = is224 ? 7 : 8;
    var out = u8(words * 4);
    for (i = 0; i < words; i++) {
      var v = H[i];
      out[4 * i] = (v >>> 24) & 255; out[4 * i + 1] = (v >>> 16) & 255;
      out[4 * i + 2] = (v >>> 8) & 255; out[4 * i + 3] = v & 255;
    }
    return out;
  }

  function rotr64(h, l, n) {
    if (n === 0) return [h, l];
    if (n < 32) return [(h >>> n) | (l << (32 - n)), (l >>> n) | (h << (32 - n))];
    var m = n - 32;
    return [(l >>> m) | (h << (32 - m)), (h >>> m) | (l << (32 - m))];
  }
  function shr64(h, l, n) {
    if (n === 0) return [h, l];
    if (n < 32) return [h >>> n, (l >>> n) | (h << (32 - n))];
    var m = n - 32;
    return [0, h >>> m];
  }
  function add64(ah, al, bh, bl) {
    var lo = (al >>> 0) + (bl >>> 0);
    var carry = lo >= 4294967296 ? 1 : 0;
    return [((ah >>> 0) + (bh >>> 0) + carry) | 0, lo | 0];
  }
  function xor64(a, b) { return [a[0] ^ b[0], a[1] ^ b[1]]; }

  function sha512Bytes(data, is384) {
    var padded = padBlocks(data, 128, 16, false);
    var IV = is384 ? SHA384_IV : SHA512_IV;
    var H = new Int32Array(16);
    for (var q = 0; q < 16; q++) H[q] = IV[q];
    var Wh = new Int32Array(80), Wl = new Int32Array(80);
    for (var off = 0; off < padded.length; off += 128) {
      for (var t = 0; t < 16; t++) {
        var p = off + 8 * t;
        Wh[t] = (padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3];
        Wl[t] = (padded[p + 4] << 24) | (padded[p + 5] << 16) | (padded[p + 6] << 8) | padded[p + 7];
      }
      for (t = 16; t < 80; t++) {
        var s0 = xor64(xor64(rotr64(Wh[t - 15], Wl[t - 15], 1), rotr64(Wh[t - 15], Wl[t - 15], 8)), shr64(Wh[t - 15], Wl[t - 15], 7));
        var s1 = xor64(xor64(rotr64(Wh[t - 2], Wl[t - 2], 19), rotr64(Wh[t - 2], Wl[t - 2], 61)), shr64(Wh[t - 2], Wl[t - 2], 6));
        var sum = add64(Wh[t - 16], Wl[t - 16], s0[0], s0[1]);
        sum = add64(sum[0], sum[1], Wh[t - 7], Wl[t - 7]);
        sum = add64(sum[0], sum[1], s1[0], s1[1]);
        Wh[t] = sum[0]; Wl[t] = sum[1];
      }
      var ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
      var eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
      for (t = 0; t < 80; t++) {
        var S1 = xor64(xor64(rotr64(eh, el, 14), rotr64(eh, el, 18)), rotr64(eh, el, 41));
        var chv = [(eh & fh) ^ (~eh & gh), (el & fl) ^ (~el & gl)];
        var t1 = add64(hh, hl, S1[0], S1[1]);
        t1 = add64(t1[0], t1[1], chv[0], chv[1]);
        t1 = add64(t1[0], t1[1], SHA512_K[t * 2], SHA512_K[t * 2 + 1]);
        t1 = add64(t1[0], t1[1], Wh[t], Wl[t]);
        var S0 = xor64(xor64(rotr64(ah, al, 28), rotr64(ah, al, 34)), rotr64(ah, al, 39));
        var maj = [(ah & bh) ^ (ah & ch) ^ (bh & ch), (al & bl) ^ (al & cl) ^ (bl & cl)];
        var t2 = add64(S0[0], S0[1], maj[0], maj[1]);
        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        var e2 = add64(dh, dl, t1[0], t1[1]);
        eh = e2[0]; el = e2[1];
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        var a2 = add64(t1[0], t1[1], t2[0], t2[1]);
        ah = a2[0]; al = a2[1];
      }
      var st = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
      for (var s = 0; s < 16; s += 2) {
        var pair = add64(H[s], H[s + 1], st[s], st[s + 1]);
        H[s] = pair[0]; H[s + 1] = pair[1];
      }
    }
    var words = is384 ? 6 : 8;
    var out = u8(words * 8);
    for (var i = 0; i < words; i++) {
      var hiV = H[i * 2], loV = H[i * 2 + 1];
      out[i * 8] = (hiV >>> 24) & 255; out[i * 8 + 1] = (hiV >>> 16) & 255;
      out[i * 8 + 2] = (hiV >>> 8) & 255; out[i * 8 + 3] = hiV & 255;
      out[i * 8 + 4] = (loV >>> 24) & 255; out[i * 8 + 5] = (loV >>> 16) & 255;
      out[i * 8 + 6] = (loV >>> 8) & 255; out[i * 8 + 7] = loV & 255;
    }
    return out;
  }

  var HASH_SIZES = { md5: 16, sha1: 20, sha224: 28, sha256: 32, sha384: 48, sha512: 64, sm3: 32 };

  function hashBytes(name, data) {
    if (name === 'md5') return md5Bytes(data);
    if (name === 'sha1') return sha1Bytes(data);
    if (name === 'sha256') return sha256Bytes(data, false);
    if (name === 'sha224') return sha256Bytes(data, true);
    if (name === 'sha512') return sha512Bytes(data, false);
    if (name === 'sha384') return sha512Bytes(data, true);
    if (name === 'sm3') return sm3(data, { out: 'bytes' });
    throw new Error('不支持的哈希算法 "' + name + '"，可用：' + Object.keys(HASH_SIZES).join(' / '));
  }

  function createHash2(algo, opts) {
    var name = String(algo || '').toLowerCase().replace(/[-_\s]/g, '');
    if (!HASH_SIZES[name]) throw new Error('不支持的哈希算法 "' + algo + '"，可用：' + Object.keys(HASH_SIZES).join(' / '));
    var chunks = [];
    var total = 0;
    var api = {
      algo: name,
      blockSize: name === 'sha512' || name === 'sha384' ? 128 : 64,
      digestSize: HASH_SIZES[name],
      update: function (chunk, o) {
        if (chunk === null || chunk === undefined) return api;
        var bytes = isBytes(chunk) ? viewOf(chunk) : normalizeInput(String(chunk), (o && o.enc) || (opts && opts.enc) || 'utf8');
        chunks.push(bytes);
        total += bytes.length;
        return api;
      },
      digest: function (o) {
        o = o || {};
        var all = u8(total);
        var p = 0;
        for (var i = 0; i < chunks.length; i++) { all.set(chunks[i], p); p += chunks[i].length; }
        var bytes = hashBytes(name, all);
        var outName = o.out || o.encoding;
        return outName ? outputBytes(bytes, outName, o.enc) : bytesToHex(bytes, false);
      }
    };
    return api;
  }

  function hmac2(algo, key, msg, opts) {
    opts = opts || {};
    var name = String(algo || 'md5').toLowerCase().replace(/[-_\s]/g, '');
    if (!HASH_SIZES[name]) throw new Error('不支持的哈希算法 "' + algo + '"');
    var bs = name === 'sha512' || name === 'sha384' ? 128 : 64;
    var k = isBytes(key) ? viewOf(key) : normalizeInput(String(key == null ? '' : key), opts.keyEnc || 'utf8');
    if (k.length > bs) k = hashBytes(name, k);
    var ipad = u8(bs), opad = u8(bs);
    for (var i = 0; i < bs; i++) {
      ipad[i] = (k[i] || 0) ^ 0x36;
      opad[i] = (k[i] || 0) ^ 0x5c;
    }
    var inner = createHash2(name).update(ipad).update(isBytes(msg) ? msg : String(msg == null ? '' : msg), { enc: opts.enc || 'utf8' }).digest({ out: 'bytes' });
    var out = createHash2(name).update(opad).update(inner).digest({ out: 'bytes' });
    var fmt = String(opts.out || 'hex').toLowerCase();
    return fmt === 'bytes' ? out : decBytes(out, fmt);
  }

  function hmacLegacy(algo, key, msg, opts) {
    opts = opts || {};
    const bs = (createHash(algo).blockSize) || 64;
    let k = isBytes(key) ? viewOf(key) : encStr(key, opts.keyEnc || 'utf8');
    if (k.length > bs) k = createHash(algo).update(k).digest({ out: 'bytes' });
    const ipad = u8(bs), opad = u8(bs);
    for (var i = 0; i < bs; i++) {
      ipad[i] = (k[i] || 0) ^ 0x36;
      opad[i] = (k[i] || 0) ^ 0x5c;
    }
    var inner = createHash(algo).update(ipad).update(isBytes(msg) ? msg : encStr(msg, opts.enc || 'utf8')).digest({ out: 'bytes' });
    var out = createHash(algo).update(opad).update(inner).digest({ out: 'bytes' });
    var name = String(opts.out || 'hex').toLowerCase();
    return name === 'bytes' ? out : decBytes(out, name);
  }

  /* ---------- SM3 ---------- */
  var SM3_IV = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];

  function sm3Rotl(x, n) { n &= 31; return n === 0 ? x | 0 : ((x << n) | (x >>> (32 - n))) | 0; }

  function sm3(input, opts) {
    opts = opts || {};
    var data = isBytes(input) ? viewOf(input) : encStr(input, opts.enc || 'utf8');
    var bitLen = data.length * 8;
    var total = data.length + 1;
    while (total % 64 !== 56) total++;
    var msg = u8(total + 8);
    msg.set(data);
    msg[data.length] = 0x80;
    var hi = Math.floor(bitLen / 4294967296);
    var lo = bitLen >>> 0;
    msg[total] = (hi >>> 24) & 0xff; msg[total + 1] = (hi >>> 16) & 0xff;
    msg[total + 2] = (hi >>> 8) & 0xff; msg[total + 3] = hi & 0xff;
    msg[total + 4] = (lo >>> 24) & 0xff; msg[total + 5] = (lo >>> 16) & 0xff;
    msg[total + 6] = (lo >>> 8) & 0xff; msg[total + 7] = lo & 0xff;

    var V = SM3_IV.slice();
    var W = new Int32Array(68);
    var W1 = new Int32Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (var j = 0; j < 16; j++) {
        W[j] = ((msg[off + j * 4] << 24) | (msg[off + j * 4 + 1] << 16) | (msg[off + j * 4 + 2] << 8) | msg[off + j * 4 + 3]) | 0;
      }
      for (j = 16; j < 68; j++) {
        var x = (W[j - 16] ^ W[j - 9] ^ sm3Rotl(W[j - 3], 15)) | 0;
        var p1 = (x ^ sm3Rotl(x, 15) ^ sm3Rotl(x, 23)) | 0;
        W[j] = (p1 ^ sm3Rotl(W[j - 13], 7) ^ W[j - 6]) | 0;
      }
      for (j = 0; j < 64; j++) W1[j] = (W[j] ^ W[j + 4]) | 0;

      var A = V[0], B = V[1], C = V[2], D = V[3], E = V[4], F = V[5], G = V[6], H = V[7];
      for (j = 0; j < 64; j++) {
        var T = j < 16 ? 0x79cc4519 : 0x7a879d8a;
        var A12 = sm3Rotl(A, 12);
        var SS1 = sm3Rotl((A12 + E + sm3Rotl(T, j)) | 0, 7);
        var SS2 = (SS1 ^ A12) | 0;
        var FF = j < 16 ? (A ^ B ^ C) : ((A & B) | (A & C) | (B & C));
        var GG = j < 16 ? (E ^ F ^ G) : ((E & F) | (~E & G));
        var TT1 = (FF + D + SS2 + W1[j]) | 0;
        var TT2 = (GG + H + SS1 + W[j]) | 0;
        D = C; C = sm3Rotl(B, 9); B = A; A = TT1;
        H = G; G = sm3Rotl(F, 19); F = E;
        var t2 = TT2 | 0;
        E = (t2 ^ sm3Rotl(t2, 9) ^ sm3Rotl(t2, 17)) | 0;
      }
      V[0] = (V[0] ^ A) | 0; V[1] = (V[1] ^ B) | 0; V[2] = (V[2] ^ C) | 0; V[3] = (V[3] ^ D) | 0;
      V[4] = (V[4] ^ E) | 0; V[5] = (V[5] ^ F) | 0; V[6] = (V[6] ^ G) | 0; V[7] = (V[7] ^ H) | 0;
    }
    var out = u8(32);
    for (var k = 0; k < 8; k++) {
      out[k * 4] = (V[k] >>> 24) & 0xff;
      out[k * 4 + 1] = (V[k] >>> 16) & 0xff;
      out[k * 4 + 2] = (V[k] >>> 8) & 0xff;
      out[k * 4 + 3] = V[k] & 0xff;
    }
    var fmt = String(opts.out || 'hex').toLowerCase();
    return fmt === 'bytes' ? out : decBytes(out, fmt);
  }

  /* ---------- AES (128/192/256, ECB/CBC/CTR) ---------- */
  var AES_T = null;
  function aesTables() {
    if (AES_T) return AES_T;
    function gmul(a, b) {
      var p = 0;
      for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi2 = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi2) a ^= 0x1b;
        b >>= 1;
      }
      return p & 0xff;
    }
    function rotl8(x, n) { return ((x << n) | (x >> (8 - n))) & 0xff; }
    var inv = new Uint8Array(256), S = new Uint8Array(256), Si = new Uint8Array(256);
    for (var a = 1; a < 256; a++) {
      for (var b = 1; b < 256; b++) if (gmul(a, b) === 1) { inv[a] = b; break; }
    }
    for (a = 0; a < 256; a++) {
      var x = inv[a];
      S[a] = (x ^ rotl8(x, 1) ^ rotl8(x, 2) ^ rotl8(x, 3) ^ rotl8(x, 4) ^ 0x63) & 0xff;
    }
    for (a = 0; a < 256; a++) Si[S[a]] = a;
    AES_T = { S: S, Si: Si, gmul: gmul };
    return AES_T;
  }

  function aesExpandKey(key) {
    var T = aesTables();
    var S = T.S;
    var Nk = key.length / 4;
    if (Nk !== 4 && Nk !== 6 && Nk !== 8) throw new Error('AES 密钥长度必须是 16/24/32 字节，当前 ' + key.length);
    var Nr = Nk + 6;
    var rk = u8(16 * (Nr + 1));
    rk.set(key);
    var RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var rcon = 0;
    var tmp = u8(4);
    for (var i = Nk; i < 4 * (Nr + 1); i++) {
      tmp[0] = rk[(i - 1) * 4]; tmp[1] = rk[(i - 1) * 4 + 1]; tmp[2] = rk[(i - 1) * 4 + 2]; tmp[3] = rk[(i - 1) * 4 + 3];
      if (i % Nk === 0) {
        var t0 = tmp[0];
        tmp[0] = S[tmp[1]] ^ RCON[rcon++];
        tmp[1] = S[tmp[2]];
        tmp[2] = S[tmp[3]];
        tmp[3] = S[t0];
      } else if (Nk > 6 && i % Nk === 4) {
        for (var k = 0; k < 4; k++) tmp[k] = S[tmp[k]];
      }
      for (k = 0; k < 4; k++) rk[i * 4 + k] = rk[(i - Nk) * 4 + k] ^ tmp[k];
    }
    return { rk: rk, Nr: Nr };
  }

  function aesAddRK(st, rk, round) {
    for (var i = 0; i < 16; i++) st[i] ^= rk[round * 16 + i];
  }
  function aesSub(st, box) {
    for (var i = 0; i < 16; i++) st[i] = box[st[i]];
  }
  function aesShift(st, inverse) {
    var t = st.slice();
    for (var r = 1; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var from = inverse ? (c - r + 4) % 4 : (c + r) % 4;
        st[r + 4 * c] = t[r + 4 * from];
      }
    }
  }
  function aesMix(st, inverse) {
    var g = aesTables().gmul;
    for (var c = 0; c < 4; c++) {
      var a0 = st[4 * c], a1 = st[4 * c + 1], a2 = st[4 * c + 2], a3 = st[4 * c + 3];
      if (!inverse) {
        st[4 * c] = g(a0, 2) ^ g(a1, 3) ^ a2 ^ a3;
        st[4 * c + 1] = a0 ^ g(a1, 2) ^ g(a2, 3) ^ a3;
        st[4 * c + 2] = a0 ^ a1 ^ g(a2, 2) ^ g(a3, 3);
        st[4 * c + 3] = g(a0, 3) ^ a1 ^ a2 ^ g(a3, 2);
      } else {
        st[4 * c] = g(a0, 14) ^ g(a1, 11) ^ g(a2, 13) ^ g(a3, 9);
        st[4 * c + 1] = g(a0, 9) ^ g(a1, 14) ^ g(a2, 11) ^ g(a3, 13);
        st[4 * c + 2] = g(a0, 13) ^ g(a1, 9) ^ g(a2, 14) ^ g(a3, 11);
        st[4 * c + 3] = g(a0, 11) ^ g(a1, 13) ^ g(a2, 9) ^ g(a3, 14);
      }
    }
  }

  function aesEncBlock(ks, input) {
    var st = u8(16);
    st.set(input);
    aesAddRK(st, ks.rk, 0);
    for (var r = 1; r <= ks.Nr; r++) {
      aesSub(st, aesTables().S);
      aesShift(st, false);
      if (r !== ks.Nr) aesMix(st, false);
      aesAddRK(st, ks.rk, r);
    }
    return st;
  }

  function aesDecBlock(ks, input) {
    var st = u8(16);
    st.set(input);
    aesAddRK(st, ks.rk, ks.Nr);
    for (var r = ks.Nr - 1; r >= 0; r--) {
      aesShift(st, true);
      aesSub(st, aesTables().Si);
      aesAddRK(st, ks.rk, r);
      if (r !== 0) aesMix(st, true);
    }
    return st;
  }

  function pkcs7Pad(bytes, bs) {
    var pad = bs - (bytes.length % bs);
    var out = u8(bytes.length + pad);
    out.set(bytes);
    for (var i = 0; i < pad; i++) out[bytes.length + i] = pad;
    return out;
  }
  function zeroPad(bytes, bs) {
    if (bytes.length % bs === 0) return bytes;
    var out = u8(bytes.length + (bs - (bytes.length % bs)));
    out.set(bytes);
    return out;
  }
  function zeroUnpad(bytes) {
    var end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return bytes.subarray(0, end);
  }
  /* 流模式不需要也绝不能去填充；块模式才按用户选择的填充规则处理 */
  var STREAM_MODES = { ctr: 1, cfb: 1, ofb: 1, cfb8: 1, cfb1: 1, gcm: 1, xts: 1 };
  function unpadResult(out, mode, padding) {
    if (STREAM_MODES[String(mode || '').toLowerCase()]) return out;
    return padding === 'none' ? out : padding === 'zero' ? zeroUnpad(out) : pkcs7Unpad(out, 16, padding || 'pkcs7');
  }

  function pkcs7Unpad(bytes, bs, mode) {
    if (mode === 'none') return bytes;
    if (!bytes.length) return bytes;
    var pad = bytes[bytes.length - 1];
    if (pad < 1 || pad > bs) return bytes;
    for (var i = bytes.length - pad; i < bytes.length; i++) if (bytes[i] !== pad) return bytes;
    return bytes.subarray(0, bytes.length - pad);
  }

  function aes(mode, input, opts) {
    opts = opts || {};
    var g = String(mode || 'cbc').toLowerCase();
    var key = bytesFromOpts(opts, 'key', 'keyEnc', 'utf8');
    var iv = bytesFromOpts(opts, 'iv', 'ivEnc', 'utf8');
    var data = isBytes(input) ? viewOf(input) : encStr(input, opts.enc || 'utf8');
    var padding = opts.padding || 'pkcs7';
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) throw new Error('AES 密钥长度需为 16/24/32 字节（当前 ' + key.length + ' 字节），检查 key 编码');
    var ks = aesExpandKey(key);
    var out, i;
    if (g === 'ecb') {
      var padded = padding === 'none' ? data : padding === 'zero' ? zeroPad(data, 16) : pkcs7Pad(data, 16);
      if (padded.length % 16 !== 0) throw new Error('数据长度不是 16 的倍数，且未启用填充');
      out = u8(padded.length);
      for (i = 0; i < padded.length; i += 16) out.set(aesEncBlock(ks, padded.subarray(i, i + 16)), i);
    } else if (g === 'cbc') {
      if (iv.length !== 16) throw new Error('CBC 模式 IV 必须是 16 字节（当前 ' + iv.length + ' 字节）');
      var p2 = padding === 'none' ? data : padding === 'zero' ? zeroPad(data, 16) : pkcs7Pad(data, 16);
      if (p2.length % 16 !== 0) throw new Error('数据长度不是 16 的倍数，且未启用填充');
      out = u8(p2.length);
      var prev = iv.slice();
      for (i = 0; i < p2.length; i += 16) {
        var blk = u8(16);
        for (var k = 0; k < 16; k++) blk[k] = p2[i + k] ^ prev[k];
        var enc = aesEncBlock(ks, blk);
        out.set(enc, i);
        prev = enc;
      }
    } else if (g === 'ctr') {
      if (iv.length !== 16) throw new Error('CTR 模式计数器必须是 16 字节');
      out = u8(data.length);
      var ctr = iv.slice();
      for (i = 0; i < data.length; i += 16) {
        var ksBlock = aesEncBlock(ks, ctr);
        var n = Math.min(16, data.length - i);
        for (var j = 0; j < n; j++) out[i + j] = data[i + j] ^ ksBlock[j];
        for (var b = 15; b >= 0; b--) {
          ctr[b] = (ctr[b] + 1) & 0xff;
          if (ctr[b] !== 0) break;
        }
      }
    } else if (g === 'cfb' || g === 'ofb') {
      /* 流式模式：长度不取整、无需填充；CFB-128 / OFB-128 */
      if (iv.length !== 16) throw new Error((g.toUpperCase()) + ' 模式 IV 必须是 16 字节（当前 ' + iv.length + ' 字节）');
      out = u8(data.length);
      var chain = iv.slice();
      for (i = 0; i < data.length; i += 16) {
        var stream = aesEncBlock(ks, chain);
        var nn = Math.min(16, data.length - i);
        for (var jj = 0; jj < nn; jj++) out[i + jj] = data[i + jj] ^ stream[jj];
        if (g === 'cfb') chain = out.subarray(i, i + 16).slice();
        else chain = stream;
      }
    } else {
      throw new Error('不支持的模式 ' + mode + '（支持 cbc / ecb / ctr / cfb / ofb）');
    }
    var fmt = String(opts.out || 'hex').toLowerCase();
    return fmt === 'bytes' ? out : decBytes(out, fmt);
  }

  function aesDecrypt(mode, input, opts) {
    opts = opts || {};
    var g = String(mode || 'cbc').toLowerCase();
    var key = bytesFromOpts(opts, 'key', 'keyEnc', 'utf8');
    var iv = bytesFromOpts(opts, 'iv', 'ivEnc', 'utf8');
    var data = isBytes(input) ? viewOf(input) : encStr(input, opts.enc || 'hex');
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) throw new Error('AES 密钥长度需为 16/24/32 字节（当前 ' + key.length + ' 字节）');
    var ks = aesExpandKey(key);
    var out, i;
    if (g === 'ecb' || g === 'cbc') {
      if (data.length % 16 !== 0) throw new Error('密文长度不是 16 的倍数（当前 ' + data.length + ' 字节），检查密文编码或是否包含 IV');
      if (g === 'cbc' && iv.length !== 16) throw new Error('CBC 模式 IV 必须是 16 字节（当前 ' + iv.length + ' 字节）');
      out = u8(data.length);
      var prev = g === 'cbc' ? iv.slice() : null;
      for (i = 0; i < data.length; i += 16) {
        var dec = aesDecBlock(ks, data.subarray(i, i + 16));
        if (prev) for (var k = 0; k < 16; k++) out[i + k] = dec[k] ^ prev[k];
        else out.set(dec, i);
        /* 只有 CBC 才把上一块密文带进下一块；ECB 必须各块独立。
           旧实现无条件赋值 prev，导致 ECB 从第 2 块起被错误地按 CBC 解（多块明文全错）。*/
        if (g === 'cbc') prev = data.subarray(i, i + 16).slice();
      }
    } else if (g === 'ctr' || g === 'cfb' || g === 'ofb') {
      if (iv.length !== 16) throw new Error((g.toUpperCase()) + ' 模式 IV 必须是 16 字节');
      out = u8(data.length);
      var ctr = iv.slice();
      for (i = 0; i < data.length; i += 16) {
        var kb = aesEncBlock(ks, g === 'cfb' ? ctr : ctr);
        var n = Math.min(16, data.length - i);
        for (var j = 0; j < n; j++) out[i + j] = data[i + j] ^ kb[j];
        if (g === 'cfb') ctr = data.subarray(i, i + 16).slice();
        else if (g === 'ofb') ctr = kb;
        else {
          for (var b = 15; b >= 0; b--) {
            ctr[b] = (ctr[b] + 1) & 0xff;
            if (ctr[b] !== 0) break;
          }
        }
      }
    } else throw new Error('不支持的模式 ' + mode);
    /* B08：CTR / CFB / OFB 是流模式，密文与明文等长、从不填充。
       旧实现无条件走 pkcs7Unpad，遇到结尾恰好是 0x01/0x02 的合法字节就被当成填充吃掉
       （abc\x01 往返后只剩 abc）。这里按模式强制 padding=none。 */
    var res = unpadResult(out, g, opts.padding);
    var fmt = String(opts.out || 'utf8').toLowerCase();
    return fmt === 'bytes' ? res : decBytes(res, fmt);
  }

  /* ---------- RC4 / XOR ---------- */
  function rc4(input, key, opts) {
    opts = opts || {};
    var data = isBytes(input) ? viewOf(input) : encStr(input, opts.enc || 'utf8');
    var k = isBytes(key) ? viewOf(key) : encStr(key, opts.keyEnc || 'utf8');
    if (!k.length) throw new Error('RC4 密钥不能为空');
    var S = new Uint8Array(256);
    for (var i = 0; i < 256; i++) S[i] = i;
    var j = 0;
    for (i = 0; i < 256; i++) {
      j = (j + S[i] + k[i % k.length]) & 0xff;
      var t = S[i]; S[i] = S[j]; S[j] = t;
    }
    var out = u8(data.length);
    var a = 0, b = 0;
    for (i = 0; i < data.length; i++) {
      a = (a + 1) & 0xff;
      b = (b + S[a]) & 0xff;
      var tmp = S[a]; S[a] = S[b]; S[b] = tmp;
      out[i] = data[i] ^ S[(S[a] + S[b]) & 0xff];
    }
    var fmt = String(opts.out || 'hex').toLowerCase();
    return fmt === 'bytes' ? out : decBytes(out, fmt);
  }

  function xorBytes(input, key, opts) {
    opts = opts || {};
    var data = isBytes(input) ? viewOf(input) : encStr(input, opts.enc || 'utf8');
    var k = isBytes(key) ? viewOf(key) : encStr(key, opts.keyEnc || 'utf8');
    if (!k.length) throw new Error('XOR 密钥不能为空');
    var out = u8(data.length);
    for (var i = 0; i < data.length; i++) out[i] = data[i] ^ k[i % k.length];
    var fmt = String(opts.out || 'hex').toLowerCase();
    return fmt === 'bytes' ? out : decBytes(out, fmt);
  }

  var extra = {
    createHash: createHash2,
    hash: function (algo, input, opts) { return createHash2(algo).update(input, opts).digest(opts); },
    hmac: hmac2,
    sm3: sm3,
    /* 对称签名容错：历史上 aesEncrypt 用 (input, opts)、aesDecrypt 用 (mode, input, opts)，
       两边不一致，调用方照对称写法传就会把密文当成 mode。这里两种都认。 */
    aesEncrypt: function (a, b, c) {
      if (b && typeof b === 'object' && !isBytes(b)) return aes(((b || {}).mode) || 'cbc', a, b);
      return aes(String(a || 'cbc'), b, c || {});
    },
    aesDecrypt: function (a, b, c) {
      if (b && typeof b === 'object' && !isBytes(b)) return aesDecrypt(((b || {}).mode) || 'cbc', a, b);
      return aesDecrypt(String(a || 'cbc'), b, c || {});
    },
    aesDecryptRaw: aesDecrypt,
    aesEncryptRaw: aes,
    rc4: rc4,
    xor: xorBytes,
    toHex: toHex,
    fromHex: fromHex,
    toB64: toB64,
    fromB64: fromB64,
    encStr: encStr,
    decBytes: decBytes,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    bytesToHex: bytesToHex,
    bytesToB64: bytesToB64,
    b64ToBytes: b64ToBytes,
    hexDecodeBytes: hexDecodeBytes,
    decodeCharset: decodeCharset,
  };
  for (var kk in extra) SK.crypt[kk] = extra[kk];

  /*__APPEND__*/
})(typeof self !== 'undefined' ? self : globalThis);
