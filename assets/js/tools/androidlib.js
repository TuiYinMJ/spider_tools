/* ============================================================================
   Spider Lab · androidlib.js
   安卓逆向解析库（纯 JS，Worker 可用）：
   - SK.az.zipList:   APK/zip 中央目录解析（文件清单 + 按名提取条目）
   - SK.az.axml:      AndroidManifest 二进制 XML(AXML) 解析（包名/版本/权限/组件）
   - SK.az.dex:       DEX header + 字符串池（URL/类名/密钥提取）
   - SK.az.elf:       ELF32/64 解析（.dynsym 导出符号——frida hook 必备）
   ========================================================================== */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const Z = (SK.az = {});

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const i32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

  /* ---------------- ZIP（APK/JAR）中央目录 ---------------- */
  Z.zipList = function (bytes) {
    /* 从尾部找 EOCD */
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return { error: '没找到 ZIP EOCD（不是 apk/jar/zip？）' };
    const count = u16(bytes, eocd + 10);
    let off = u32(bytes, eocd + 16);
    /* ZIP64 粗处理 */
    if (off === 0xffffffff || count === 0xffff) {
      /* 找 ZIP64 EOCD locator */
      for (let i = eocd - 20; i >= 0; i--) {
        if (u32(bytes, i) === 0x07064b50) { off = Number(BigInt(u32(bytes, i + 8)) | (BigInt(u32(bytes, i + 12)) << 32n)); break; }
      }
    }
    const entries = [];
    for (let i = 0; i < count && off < bytes.length; i++) {
      if (u32(bytes, off) !== 0x02014b50) break;
      const method = u16(bytes, off + 10);
      const compSize = u32(bytes, off + 20);
      const uncompSize = u32(bytes, off + 24);
      const nameLen = u16(bytes, off + 28);
      const extraLen = u16(bytes, off + 30);
      const commentLen = u16(bytes, off + 32);
      const localOff = u32(bytes, off + 42);
      const name = utf8(bytes.subarray(off + 46, off + 46 + nameLen));
      entries.push({ name: name, method: method === 8 ? 'deflate' : method === 0 ? 'store' : method, compSize: compSize, uncompSize: uncompSize, localOff: localOff });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries };
  };

  /* 提取条目原始（可能压缩）字节 */
  Z.zipEntryRaw = function (bytes, entry) {
    const lo = entry.localOff;
    if (u32(bytes, lo) !== 0x04034b50) return null;
    const nameLen = u16(bytes, lo + 26);
    const extraLen = u16(bytes, lo + 28);
    const compSize = entry.compSize || u32(bytes, lo + 18);
    return bytes.subarray(lo + 30 + nameLen + extraLen, lo + 30 + nameLen + extraLen + compSize);
  };
  Z.zipEntry = async function (bytes, entry) {
    const raw = Z.zipEntryRaw(bytes, entry);
    if (!raw) return null;
    if (entry.method === 'store') return raw;
    if (entry.method === 'deflate') {
      return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    return null;
  };

  function decode16(b) {
    try { return new TextDecoder('utf-16le').decode(b); } catch (e) { return String.fromCharCode.apply(null, b); }
  }

  function utf8(b) {
    try { return new TextDecoder('utf-8').decode(b); } catch (e) { return String.fromCharCode.apply(null, b); }
  }

  /* ---------------- AXML（AndroidManifest 二进制 XML） ---------------- */
  Z.axml = function (bytes) {
    if (u32(bytes, 0) !== 0x00080003) return { error: '不是 AXML（magic 应为 0x00080003）' };
    const strings = [];
    let p = 8;
    const stack = [];
    const out = { elements: [] };
    while (p + 8 <= bytes.length) {
      const type = u16(bytes, p);
      const size = u32(bytes, p + 4);
      if (size <= 0 || p + size > bytes.length) break;
      if (type === 0x0001) {
        /* RES_STRING_POOL_TYPE */
        const count = u32(bytes, p + 8);
        const flags = u32(bytes, p + 16);
        const strStart = u32(bytes, p + 20);
        const isUTF8 = (flags & (1 << 8)) !== 0;
        const offsets = [];
        for (let i = 0; i < count && p + 28 + i * 4 + 4 <= bytes.length; i++) offsets.push(u32(bytes, p + 28 + i * 4));
        for (const o of offsets) {
          const s = p + strStart + o;
          try {
            if (isUTF8) {
              let u8len = bytes[s]; /* u8 长度可能两字节 */
              let q = s;
              const skipLen = () => { const b1 = bytes[q]; q++; if (b1 & 0x80) q++; };
              skipLen(); /* 字符数 */
              const byteLen = bytes[q]; q++;
              const byteLen2 = byteLen & 0x80 ? ((byteLen & 0x7f) << 8) | bytes[q++] : byteLen;
              strings.push(utf8(bytes.subarray(q, q + byteLen2)));
            } else {
              const len = u16(bytes, s);
              const len2 = len & 0x8000 ? ((len & 0x7fff) << 16) | u16(bytes, s + 2) : len;
              const start = len & 0x8000 ? s + 4 : s + 2;
              strings.push(decode16(bytes.subarray(start, start + len2 * 2)));
            }
          } catch (e) { strings.push(''); }
        }
      } else if (type === 0x0102) {
        /* RES_XML_START_ELEMENT_TYPE */
        const nameIdx = u32(bytes, p + 20);
        /* AXML START_ELEMENT 无 attributeCount 字段：由 chunkSize 推导 */
        const attrCount = Math.max(0, Math.floor((u32(bytes, p + 4) - 36) / 20));
        const attrs = {};
        for (let i = 0; i < attrCount; i++) {
          const a = p + 36 + i * 20;
          const nsIdx = u32(bytes, a);
          const nameI = u32(bytes, a + 4);
          const rawIdx = u32(bytes, a + 8);
          const valType = bytes[a + 15];
          const valIdx = u32(bytes, a + 16);
          const key = strings[nameI] || ('@' + nameI);
          let val;
          if (valType === 0x03 /* STRING */) val = strings[valIdx] !== undefined ? strings[valIdx] : '';
          else if (valType === 0x10 /* INT */) val = '#' + i32(bytes, a + 16).toString(16);
          else if (valType === 0x12 /* BOOL */) val = valIdx ? 'true' : 'false';
          else val = rawIdx >= 0 && strings[rawIdx] !== undefined ? strings[rawIdx] : ('@' + valIdx);
          attrs[key] = val;
        }
        const el = { name: strings[nameIdx] || '?', attrs: attrs, children: [] };
        if (stack.length) stack[stack.length - 1].children.push(el);
        /* elements 是平铺视图（manifestInfo 按名字找节点用），children 是树视图，
           两者并存不是重复；此前报告把这里判成 "重复 push" 属误读。 */
        out.elements.push(el);
        stack.push(el);
      } else if (type === 0x0103) {
        stack.pop();
      }
      p += size;
    }
    return out;
  };

  /* manifest 摘要：从 AXML 元素树提取关键信息 */
  Z.manifestInfo = function (axml) {
    if (axml.error) return axml;
    const find = (name) => axml.elements.filter((e) => e.name === name);
    const info = {};
    const man = find('manifest')[0];
    if (man) {
      info.package = man.attrs.package || '?';
      info.versionName = man.attrs.versionName || '';
      info.versionCode = man.attrs.versionCode || '';
      info.compileSdk = man.attrs.compileSdkVersion || '';
      info.platformBuild = man.attrs.platformBuildVersionName || '';
    }
    const perms = find('uses-permission').map((e) => e.attrs.name).filter(Boolean);
    const usesFeature = find('uses-feature').map((e) => e.attrs['android:name'] || e.attrs.name).filter(Boolean);
    const app = find('application')[0];
    const activities = find('activity').map((e) => e.attrs['android:name'] || e.attrs.name || '?');
    const services = find('service').map((e) => e.attrs['android:name'] || e.attrs.name || '?');
    const receivers = find('receiver').map((e) => e.attrs['android:name'] || e.attrs.name || '?');
    const providers = find('provider').map((e) => e.attrs['android:name'] || e.attrs.name || '?');
    const launcher = find('activity').filter((e) => JSON.stringify(e.children || []).indexOf('android.intent.category.LAUNCHER') >= 0 || (e.attrs['android:exported']) === 'true').map((e) => e.attrs['android:name'] || '?');
    return {
      info: info,
      permissions: perms,
      usesFeature: usesFeature,
      application: app ? { label: app.attrs.label || app.attrs['android:label'] || '', debuggable: app.attrs.debuggable || app.attrs['android:debuggable'] || '', allowBackup: app.attrs.allowBackup || '' } : null,
      activities: activities, services: services, receivers: receivers, providers: providers,
      launcher: launcher,
    };
  };

  /* ---------------- DEX ---------------- */
  Z.dexStrings = function (bytes, filterRe) {
    if (u32(bytes, 0) !== 0x0a786564 /* 'dex\n' */) return { error: '不是 DEX 文件（magic 应为 dex\\n035）' };
    const stringIdsSize = u32(bytes, 0x38);
    const stringIdsOff = u32(bytes, 0x3c);
    const out = [];
    const re = filterRe || null;
    for (let i = 0; i < stringIdsSize && i < 500000; i++) {
      const sdo = u32(bytes, stringIdsOff + i * 4);
      /* ULEB128 长度 */
      let q = sdo, len = 0, shift = 0, b;
      do { b = bytes[q++]; len += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80 && q < sdo + 8);
      if (len > 20000 || len === 0) continue;
      const s = utf8(bytes.subarray(q, q + len));
      if (!re || re.test(s)) out.push(s);
      if (out.length > 20000) break;
    }
    return {
      header: {
        version: utf8(bytes.subarray(4, 8)),
        dexSize: u32(bytes, 0x20),
        strings: stringIdsSize,
        types: u32(bytes, 0x40),
        /* DEX header 规范：0x48 是 proto_ids_size，method_ids_size 在 0x58。
           原实现读 0x48 当 methods，错位一格，永远报 0。 */
        protos: u32(bytes, 0x48),
        fields: u32(bytes, 0x50),
        methods: u32(bytes, 0x58),
        classes: u32(bytes, 0x60),
      },
      strings: out,
    };
  };

  /* 方法签名：解析 type_ids / proto_ids / method_ids，拼出
     Lcom/x/Y;->encrypt(Ljava/lang/String;)Ljava/lang/String;
     这是安卓逆向第一步（拿到方法签名才能下 hook）。 */
  Z.dexMethods = function (bytes, filterRe) {
    if (u32(bytes, 0) !== 0x0a786564) return { error: '不是 DEX 文件' };
    const u32s = (o) => u32(bytes, o);
    const strCount = u32s(0x38), strOff = u32s(0x3c);
    const typeCount = u32s(0x40), typeOff = u32s(0x44);
    const protoCount = u32s(0x48), protoOff = u32s(0x4c);
    const methodCount = u32s(0x58), methodOff = u32s(0x5c);
    if (!strCount || !typeCount || !methodCount) return { methods: [], error: null };

    const strAt = (i) => {
      if (i >= strCount) return '';
      const sdo = u32s(strOff + i * 4);
      let q = sdo, len = 0, shift = 0, b;
      do { b = bytes[q++]; len += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80 && q < sdo + 8);
      if (len > 20000) return '';
      return utf8(bytes.subarray(q, q + len));
    };
    const typeAt = (i) => (i < typeCount ? strAt(u32s(typeOff + i * 4)) : '');
    /* 参数列表：type_list = { u32 size; u16 type_idx[size] } */
    const paramsAt = (off) => {
      if (!off) return [];
      const n = u32s(off);
      if (n > 64) return [];
      const out = [];
      for (let k = 0; k < n; k++) out.push(typeAt(u16(bytes, off + 4 + k * 2)));
      return out;
    };

    const methods = [];
    const cap = Math.min(methodCount, 200000);
    for (let i = 0; i < cap; i++) {
      const base = methodOff + i * 8;
      const classIdx = u16(bytes, base);
      const protoIdx = u16(bytes, base + 2);
      const nameIdx = u32s(base + 4);
      const cls = typeAt(classIdx);
      const name = strAt(nameIdx);
      if (!cls || !name) continue;
      let ret = '', params = [];
      if (protoIdx < protoCount) {
        const pb = protoOff + protoIdx * 12;
        ret = typeAt(u32s(pb + 4));
        params = paramsAt(u32s(pb + 8));
      }
      const sig = cls + '->' + name + '(' + params.join('') + ')' + ret;
      if (filterRe && !filterRe.test(sig)) continue;
      methods.push({ cls: cls, name: name, params: params, ret: ret, sig: sig });
      if (methods.length > 50000) break;
    }
    return { methods: methods, total: methodCount, error: null };
  };

  /* ---------------- v1 签名证书（META-INF/*.RSA|DSA|EC → PKCS#7 → X.509）----------------
     APK 的「签名指纹」是圈内高频查询项（判断是否同一开发者/是否二次打包）。
     这里用一个极小的 DER 遍历器把证书从 PKCS#7 里挖出来，算 SHA-1/SHA-256。 */
  Z.certInfo = function (der) {
    const b = der;
    function tlv(o, end) {
      if (o + 2 > end) return null;
      const tag = b[o];
      let len, hdr;
      if (b[o + 1] & 0x80) {
        const n = b[o + 1] & 0x7f;
        if (n === 0 || n > 4 || o + 2 + n > end) return null;
        len = 0;
        for (let i = 0; i < n; i++) len = len * 256 + b[o + 2 + i];
        hdr = 2 + n;
      } else { len = b[o + 1]; hdr = 2; }
      const start = o + hdr;
      if (len < 0 || start + len > end) return null;
      return { tag: tag, start: start, end: start + len, raw: b.subarray(o, start + len) };
    }
    function kids(node) {
      const out = [];
      let p = node.start;
      while (p < node.end) {
        const t = tlv(p, node.end);
        if (!t) break;
        out.push(t);
        p = t.end;
        if (p <= node.start) break;
      }
      return out;
    }
    /* 深度优先收集所有节点，找形如 Certificate 的 SEQUENCE：
       [0]=SEQUENCE(tbs) [1]=SEQUENCE(algid) [2]=BIT STRING(sig) */
    const certs = [];
    const stack = [{ tag: 0x30, start: 0, end: b.length, raw: b }];
    let guard = 0;
    while (stack.length && guard++ < 20000) {
      const n = stack.pop();
      const ch = kids(n);
      if (n.tag === 0x30 && ch.length === 3 && ch[0].tag === 0x30 && ch[1].tag === 0x30 && ch[2].tag === 0x03) {
        if (certs.length < 8) certs.push(n);
        continue;
      }
      for (let i = ch.length - 1; i >= 0; i--) {
        /* 必须下钻所有「构造类型」（tag & 0x20），PKCS#7 的证书装在 [0] IMPLICIT 上下文标签里，
           只认 SEQUENCE(0x30) 会整片漏掉。 */
        if (ch[i].tag & 0x20) stack.push(ch[i]);
      }
    }
    if (!certs.length) return { error: '没在签名块里找到 X.509 证书' };
    const CN_OID = [0x06, 0x03, 0x55, 0x04, 0x03];
    const findOidText = (node) => {
      /* 在节点内找 2.5.4.3(CN) 后紧跟的字符串元素 */
      const lim = node.end - 4;
      for (let p = node.start; p < lim; p++) {
        let ok = true;
        for (let k = 0; k < 5; k++) if (b[p + k] !== CN_OID[k]) { ok = false; break; }
        if (!ok) continue;
        const after = p + 5;
        for (let q = after; q < Math.min(node.end - 1, after + 4); q++) {
          const t = b[q];
          if (t === 0x0c || t === 0x13 || t === 0x16 || t === 0x1e) {
            const s = tlv(q, node.end);
            if (s && s.end - s.start < 300) {
              const txt = utf8(b.subarray(s.start, s.end));
              if (txt) return txt;
            }
          }
        }
      }
      return '';
    };
    return {
      certs: certs.map(function (c) {
        const tbs = kids(c)[0] || c;
        /* 有效期直接按字节扫 UTCTime(0x17, 13 字节) / GeneralizedTime(0x18, 15 字节)，
           比递归遍历更稳（不依赖父节点是否被下钻到） */
        const times = [];
        for (let p = tbs.start; p < tbs.end - 2 && times.length < 2; p++) {
          const t = b[p];
          if (t !== 0x17 && t !== 0x18) continue;
          const len = b[p + 1];
          if ((t === 0x17 && len !== 13) || (t === 0x18 && len !== 15)) continue;
          const s = utf8(b.subarray(p + 2, p + 2 + len));
          if (/^\d{12}Z$/.test(s) || /^\d{14}Z$/.test(s)) { times.push(s); p += len + 1; }
        }
        return {
          subject: findOidText(tbs),
          notBefore: times[0] || '',
          notAfter: times[1] || '',
          size: c.raw.length,
          sha1: SK.crypt.hash('sha1', c.raw, { inEnc: 'bytes', enc: 'hex' }).toUpperCase(),
          sha256: SK.crypt.hash('sha256', c.raw, { inEnc: 'bytes', enc: 'hex' }).toUpperCase(),
        };
      }),
    };
  };

  /* ---------------- ELF（.so）---------------- */
  Z.elf = function (bytes) {
    if (!(bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)) {
      return { error: '不是 ELF 文件（magic 应为 \\x7fELF）——注意 Windows DLL 是 PE 格式，用 PE 分析器' };
    }
    const is64 = bytes[4] === 2;
    const le = bytes[5] === 1;
    if (!le) return { error: '大端 ELF 不支持' };
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const e = {
      bits: is64 ? 64 : 32,
      machine: ({ 0x03: 'x86', 0x28: 'ARM', 0xb7: 'AArch64', 0xf3: 'RISC-V', 0x3e: 'x86-64', 0x08: 'MIPS', 0xf7: 'loongarch64' })[dv.getUint16(18, true)] || ('0x' + dv.getUint16(18, true).toString(16)),
      entry: is64 ? Number(dv.getBigUint64(24, true)) : dv.getUint32(24, true),
    };
    const shoff = is64 ? Number(dv.getBigUint64(0x28, true)) : dv.getUint32(0x28, true);
    const shentsize = dv.getUint16(is64 ? 0x3a : 0x2e, true);
    const shnum = dv.getUint16(is64 ? 0x3c : 0x30, true);
    const shstrndx = dv.getUint16(is64 ? 0x3e : 0x32, true);
    if (!shoff || shnum > 200) return Object.assign(e, { sections: [], symbols: [] });
    const sec = (i) => shoff + i * shentsize;
    const shName = (i) => u32(bytes, sec(i));
    const shType = (i) => u32(bytes, sec(i) + 4);
    const shOff = (i) => is64 ? Number(dv.getBigUint64(sec(i) + 24, true)) : dv.getUint32(sec(i) + 16, true);
    const shSize = (i) => is64 ? Number(dv.getBigUint64(sec(i) + 32, true)) : dv.getUint32(sec(i) + 20, true);
    const shLink = (i) => u32(bytes, sec(i) + (is64 ? 40 : 24));
    const shEntSize = (i) => u32(bytes, sec(i) + (is64 ? 56 : 36));
    const shFlags = (i) => is64 ? Number(dv.getBigUint64(sec(i) + 8, true)) : dv.getUint32(sec(i) + 8, true);
    /* shstrtab */
    const strtabOff = shOff(shstrndx);
    const strtabSize = shSize(shstrndx);
    const nameOf = (tabOff, idx, tabSize) => {
      const lim = tabOff + (tabSize || 262144);
      let end = tabOff + idx;
      while (end < lim && bytes[end] !== 0) end++;
      return utf8(bytes.subarray(tabOff + idx, end));
    };
    const sections = [];
    for (let i = 0; i < shnum; i++) {
      sections.push({ name: nameOf(strtabOff, shName(i), strtabSize), type: shType(i), size: shSize(i), flags: shFlags(i), offset: shOff(i) });
    }
    /* .rodata / .data 字符串扫描：so 里的 AES key、接口地址、错误文案都在这 */
    e.dataStrings = (function () {
      const wanted = ['.rodata', '.data.rel.ro', '.data', '.text'];
      const out = [];
      const seen = {};
      for (let i = 0; i < shnum; i++) {
        const nm = nameOf(strtabOff, shName(i), strtabSize);
        if (wanted.indexOf(nm) < 0) continue;
        const off = shOff(i), sz = Math.min(shSize(i), 8 * 1024 * 1024);
        if (!off || !sz || off + sz > bytes.length) continue;
        let start = -1;
        for (let p = off; p < off + sz; p++) {
          const c = bytes[p];
          const printable = c >= 0x20 && c < 0x7f;
          if (printable) { if (start < 0) start = p; }
          else {
            if (start >= 0 && p - start >= 5) {
              const s = utf8(bytes.subarray(start, p));
              if (!seen[s]) { seen[s] = 1; out.push({ s: s, sec: nm }); }
            }
            start = -1;
          }
          if (out.length > 4000) break;
        }
        if (out.length > 4000) break;
      }
      return out;
    })();
    /* .dynsym / .symtab 符号 */
    const symbols = [];
    for (let i = 0; i < shnum; i++) {
      const st = shType(i);
      if (st !== 2 && st !== 11) continue; /* SYMTAB / DYNSYM */
      const strtabIdx = shLink(i);
      const tab = shOff(strtabIdx);
      const entSize = shEntSize(i) || (is64 ? 24 : 16);
      const count = Math.floor(shSize(i) / entSize);
      for (let j = 0; j < count && symbols.length < 20000; j++) {
        const so = shOff(i) + j * entSize;
        const nameIdx = u32(bytes, so);
        const info = bytes[so + 4];
        const shndx = is64 ? u16(bytes, so + 6) : u16(bytes, so + 14);
        const value = is64 ? Number(dv.getBigUint64(so + 8, true)) : dv.getUint32(so + 8, true);
        const size = is64 ? Number(dv.getBigUint64(so + 16, true)) : dv.getUint32(so + 12, true);
        const bind = info >> 4;
        const type = info & 0xf;
        if (!nameIdx) continue;
        const name = nameOf(tab, nameIdx, shSize(strtabIdx));
        if (!name) continue;
        symbols.push({
          name: name,
          kind: st === 11 ? 'dyn' : 'sym',
          bind: bind === 1 ? 'GLOBAL' : bind === 2 ? 'WEAK' : bind === 0 ? 'LOCAL' : String(bind),
          type: type === 2 ? 'FUNC' : type === 1 ? 'OBJECT' : String(type),
          defined: shndx !== 0,
          value: value,
          size: size,
        });
      }
    }
    /* 依赖 so（.dynamic 的 DT_NEEDED 简析：找 DT_STRTAB+DT_NEEDED 太繁，用 dynstr 里的 .so 名过滤） */
    const dynstr = sections.find((s) => s.name === '.dynstr');
    const needed = [];
    if (dynstr) {
      const so = sections.indexOf(dynstr);
      const tab = shOff(so);
      const raw = utf8(bytes.subarray(tab, tab + Math.min(dynstr.size, 262144)));
      raw.split('\0').forEach((s) => { if (/\.so(\.\d+)?$/.test(s) && !needed.includes(s)) needed.push(s); });
    }
    return Object.assign(e, { sections: sections, symbols: symbols, needed: needed });
  };
})(typeof self !== 'undefined' ? self : globalThis);
