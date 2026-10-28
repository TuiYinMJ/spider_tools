(function (root) {
  const SK = (root.SK = root.SK || {});

  function decodeBytes(bytes, enc) {
    try {
      return new TextDecoder(enc || 'utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  function encodeBytes(str, enc) {
    if (!enc || enc === 'utf-8' || enc === 'utf8') return new TextEncoder().encode(str);
    const map = { gbk: 'gbk', gb2312: 'gb18030', big5: 'big5', latin1: 'latin1', windows1252: 'windows-1252', shift_jis: 'shift_jis', euckr: 'euc-kr', utf16le: 'utf-16le' };
    try {
      if (enc === 'latin1') {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
        return out;
      }
      if (enc === 'hex') return hexToBytes(str);
      if (enc === 'base64' || enc === 'base64url') return base64ToBytes(str);
      return new TextEncoder().encode(str);
    } catch (e) {
      return new TextEncoder().encode(str);
    }
  }

  function hexToBytes(s) {
    const clean = String(s).replace(/0x[\s,]*/gi, '').replace(/[^0-9a-fA-F]/g, '');
    const n = Math.floor(clean.length / 2);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes, sep) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) out.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
    return out.join(sep || '');
  }

  const B64ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64ToBytes(s) {
    const clean = String(s).replace(/[\s'"\\]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(clean.replace(/=+$/, '') + '='.repeat((4 - (clean.replace(/=+$/, '').length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes, urlSafe) {
    const chunk = 8192;
    let s = '';
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    let out = btoa(s);
    if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return out;
  }

  async function fileBytes(file, hooks) {
    const buf = await file.arrayBuffer();
    if (hooks && hooks.progress) hooks.progress(buf.byteLength, buf.byteLength, '读取完成');
    return new Uint8Array(buf);
  }

  async function fileText(file, opts) {
    opts = opts || {};
    const max = opts.maxBytes || 32 * 1024 * 1024;
    if (file.size > max && !opts.force) {
      return { ok: false, error: 'TOO_LARGE', bytes: file.size, max, name: file.name, text: '' };
    }
    const bytes = await fileBytes(file, opts.hooks);
    let text = decodeBytes(bytes, opts.encoding);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { ok: true, text, bytes: file.size, name: file.name, encoding: opts.encoding || 'utf-8' };
  }

  async function forEachChunk(file, size, fn, hooks) {
    size = size || 2 * 1024 * 1024;
    let offset = 0;
    let index = 0;
    let carry = '';
    while (offset < file.size) {
      const end = Math.min(offset + size, file.size);
      const slice = await file.slice(offset, end).text();
      let { chunk, carry: next } = splitAtNewline(carry + slice, end >= file.size);
      const r = await fn(chunk, { offset, end, index, final: end >= file.size });
      if (r === false) return { stopped: true, offset };
      carry = next;
      offset = end;
      index++;
      if (hooks && hooks.progress) hooks.progress(offset, file.size, '分块 ' + (index + 1));
    }
    return { done: true, chunks: index };
  }

  function splitAtNewline(text, final) {
    if (final) return { chunk: text, carry: '' };
    const i = text.lastIndexOf('\n');
    if (i < 0) return { chunk: '', carry: text };
    return { chunk: text.slice(0, i + 1), carry: text.slice(i + 1) };
  }

  function splitLines(text) {
    const out = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        let end = i;
        if (end > start && text.charCodeAt(end - 1) === 13) end--;
        out.push(text.slice(start, end));
        start = i + 1;
      }
    }
    if (start < text.length) out.push(text.slice(start));
    else if (start === text.length && text.length === 0) out.push('');
    return out;
  }

  function detectNewline(text) {
    const sample = text.slice(0, 100000);
    let crlf = 0;
    let cr = 0;
    let lf = 0;
    for (let i = 0; i < sample.length; i++) {
      const c = sample.charCodeAt(i);
      if (c === 13) {
        if (sample.charCodeAt(i + 1) === 10) {
          crlf++;
          i++;
        } else cr++;
      } else if (c === 10) lf++;
    }
    if (crlf > lf && crlf > cr) return '\r\n';
    if (cr > lf) return '\r';
    return '\n';
  }

  function stripBom(s) {
    return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  function guessCharset(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    let high = 0;
    let utf8seq = 0;
    const n = Math.min(bytes.length, 65536);
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b > 127) {
        high++;
        if ((b & 0xe0) === 0xc0 || (b & 0xf0) === 0xe0 || (b & 0xf8) === 0xf0) utf8seq++;
      }
    }
    if (!high) return 'ascii';
    if (utf8seq / high >= 0.4) return 'utf-8';
    return 'gbk?';
  }

  SK.io = {
    decodeBytes,
    encodeBytes,
    hexToBytes,
    bytesToHex,
    base64ToBytes,
    bytesToBase64,
    fileBytes,
    fileText,
    forEachChunk,
    splitLines,
    detectNewline,
    stripBom,
    guessCharset,
  };
})(typeof self !== 'undefined' ? self : globalThis);
