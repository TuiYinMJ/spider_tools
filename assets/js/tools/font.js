/* ============================================================================
   Spider Lab · font.js
   字体反爬映射：解析 woff/ttf/otf → cmap 码位表 + glyf 字形特征（轮廓/点数/bbox）
   → 与参照字体最近邻匹配 → 码位→明文映射 + 密文批量替换。
   支持 woff1（zlib 表解压，DecompressionStream）。
   ========================================================================== */
(function () {

  const F = (SK.font = {});
  const WOFF_TO_SFNT = 'woffToSfnt';

  /* ---------- 二进制读取器（未使用，保留供扩展） ---------- */
  function reader(bytes) {
    let p = 0;
    return {
      u8: () => bytes[p++],
      u16: () => (bytes[p++] << 8) | bytes[p++] >>> 0,
      i16: () => { const v = (bytes[p++] << 8) | bytes[p++]; return v >= 0x8000 ? v - 0x10000 : v; },
      u32: () => (((bytes[p++] << 24) >>> 0) + (bytes[p++] << 16) + (bytes[p++] << 8) + bytes[p++]) >>> 0,
      bytes: (n) => bytes.subarray(p, p + n),
      seek: (n) => { p = n; },
      skip: (n) => { p += n; },
      get pos() { return p; },
    };
  }
  const tagOf = (F.tagOf = (b, off) => String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]));

  /* ---------- woff1 → sfnt ---------- */
  F.woffToSfnt = async function woffToSfnt(bytes) {
    if (tagOf(bytes, 0) !== 'wOFF') return bytes;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = dv.getUint16(12);
    const total = dv.getUint32(16);
    const out = new Uint8Array(total);
    const odv = new DataView(out.buffer);
    /* sfnt 头 12 字节 */
    odv.setUint32(0, dv.getUint32(4)); /* flavor */
    odv.setUint16(4, numTables);
    let odir = 12;
    let odata = 12 + numTables * 16;
    for (let i = 0; i < numTables; i++) {
      const rec = 44 + i * 20;
      const tag = dv.getUint32(rec);
      const off = dv.getUint32(rec + 4);
      const compLen = dv.getUint32(rec + 8);
      const origLen = dv.getUint32(rec + 12);
      let data = bytes.subarray(off, off + compLen);
      if (compLen !== origLen) {
        /* zlib/deflate 解压 */
        data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
      }
      odv.setUint32(odir, tag);
      odv.setUint32(odir + 4, 0); /* checksum 忽略 */
      odv.setUint32(odir + 8, odata);
      odv.setUint32(odir + 12, origLen);
      out.set(data, odata);
      odata += origLen;
      odir += 16;
    }
    return out;
  }

  /* ---------- sfnt 解析：表目录 ---------- */
  F.readTables = function readTables(sfnt) {
    const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
    const num = dv.getUint16(4);
    const tables = {};
    for (let i = 0; i < num; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(sfnt[rec], sfnt[rec + 1], sfnt[rec + 2], sfnt[rec + 3]);
      tables[tag] = sfnt.subarray(dv.getUint32(rec + 8), dv.getUint32(rec + 8) + dv.getUint32(rec + 12));
    }
    return tables;
  }

  /* ---------- cmap：codepoint → glyphId ---------- */
  F.parseCmap = function parseCmap(t) {
    if (!t) return {};
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const n = dv.getUint16(2);
    let best = -1, bestScore = -1;
    for (let i = 0; i < n; i++) {
      const rec = 4 + i * 8;
      const plat = dv.getUint16(rec), enc = dv.getUint16(rec + 2), off = dv.getUint32(rec + 4);
      let score = -1;
      if (plat === 3 && enc === 10) score = 5;
      else if (plat === 3 && enc === 1) score = 4;
      else if (plat === 0) score = 3;
      else if (plat === 3 && enc === 0) score = 2;
      if (score > bestScore) { bestScore = score; best = off; }
    }
    if (best < 0) return {};
    const map = {};
    const fmt = dv.getUint16(best);
    if (fmt === 4) {
      const segX2 = dv.getUint16(best + 6);
      const segCount = segX2 / 2;
      const endBase = best + 14, startBase = endBase + segX2 + 2, deltaBase = startBase + segX2, rangeBase = deltaBase + segX2;
      for (let s = 0; s < segCount; s++) {
        const end = dv.getUint16(endBase + s * 2);
        const start = dv.getUint16(startBase + s * 2);
        const delta = dv.getInt16(deltaBase + s * 2);
        const rangeOff = dv.getUint16(rangeBase + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end && c - start < 10000; c++) {
          let g;
          if (rangeOff === 0) g = (c + delta) & 0xffff;
          else {
            const gi = rangeBase + s * 2 + rangeOff + (c - start) * 2;
            if (gi + 1 < t.length) g = dv.getUint16(gi);
            else g = 0;
            if (g) g = (g + delta) & 0xffff;
          }
          if (g) map[c] = g;
        }
      }
    } else if (fmt === 12) {
      const groups = dv.getUint32(best + 12);
      for (let gI = 0; gI < groups; gI++) {
        const rec = best + 16 + gI * 12;
        const s = dv.getUint32(rec), e = dv.getUint32(rec + 4), gid = dv.getUint32(rec + 8);
        for (let c = s; c <= e && c - s < 65536; c++) map[c] = gid + (c - s);
      }
    }
    return map;
  }

  /* ---------- glyf 特征 ---------- */
  F.glyphFeatures = function glyphFeatures(tables, glyphId) {
    const head = tables.head, maxp = tables.maxp, loca = tables.loca, glyf = tables.glyf;
    if (!head || !maxp || !loca || !glyf) return null;
    const hd = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const unitsPerEm = hd.getUint16(18) || 1000;
    const longLoca = hd.getInt16(50) === 1;
    const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
    if (glyphId >= numGlyphs) return null;
    const ld = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
    const start = longLoca ? ld.getUint32(glyphId * 4) : ld.getUint16(glyphId * 2) * 2;
    const end = longLoca ? ld.getUint32(glyphId * 4 + 4) : ld.getUint16(glyphId * 2 + 2) * 2;
    if (end <= start) return { contours: 0, points: 0, w: 0, h: 0, empty: true };
    const g = new DataView(glyf.buffer, glyf.byteOffset + start, end - start);
    const nContours = g.getInt16(0);
    /* B23：组合字形（nContours < 0）旧实现把 w/h/点数全部置 0，
       两个完全不同的组合字形特征完全相同、距离 0，会被判成「高可信」并直接替换成错字。
       组合字形至少用 bbox 给出尺寸，并打上 composite 标记让距离函数区别对待。 */
    if (nContours < 0) {
      const bx = [g.getInt16(2), g.getInt16(4), g.getInt16(6), g.getInt16(8)];
      return { contours: 0, points: 0, w: (bx[2] - bx[0]) / unitsPerEm, h: (bx[3] - bx[1]) / unitsPerEm, composite: true, bbox: bx };
    }
    const xMin = g.getInt16(2), yMin = g.getInt16(4), xMax = g.getInt16(6), yMax = g.getInt16(8);
    let pts = 0;
    const endPts = [];
    for (let i = 0; i < nContours; i++) { endPts.push(g.getUint16(10 + i * 2)); pts = endPts[i] + 1; }
    return {
      contours: nContours,
      points: pts,
      w: (xMax - xMin) / unitsPerEm,
      h: (yMax - yMin) / unitsPerEm,
      bbox: [xMin, yMin, xMax, yMax],
    };
  }

  /* ---------- 特征距离 ---------- */
  F.featDist = function featDist(a, b) {
    if (!a || !b || a.empty || b.empty) return 999;
    /* 退化特征（既没轮廓也没尺寸）：无法区分，不能给 0 分 */
    const degen = (x) => !x.contours && !x.points && !x.w && !x.h;
    if (degen(a) || degen(b)) return 999;
    /* 组合字形没有轮廓/点数可分，只靠 bbox 极不可靠：单独计一大截距离，
       避免两个不同的 「明」/「月」 因为都是组合字形就被判成同一个字 */
    if (a.composite || b.composite) {
      const base = 60;
      if (a.composite && b.composite) return base + Math.abs(a.w - b.w) * 80 + Math.abs(a.h - b.h) * 80;
      return base + 40;
    }
    if (a.contours !== b.contours) return 100 + Math.abs(a.contours - b.contours) * 10;
    return Math.abs(a.points - b.points) * 1.5
      + Math.abs(a.w - b.w) * 80
      + Math.abs(a.h - b.h) * 80;
  }

  /* ============================================================
   * 渲染比对路径（woff2 / 字形重绘 都适用）
   *
   * 轮廓特征只对 glyf 有效：woff2 的 glyf 是变换编码的，直接解析要重建
   * 整套 triplet 点阵；而真实站点现在几乎只发 woff2。与其半吊子解 woff2，
   * 不如用浏览器自己的字体引擎把字形画出来比——格式无关，且对「同一字符
   * 被重绘成不同轮廓」的对抗字体更稳。
   * ============================================================ */
  /* Worker 里是 self.fonts，主线程是 document.fonts（inline 降级时走这条） */
  F.fontSet = function () {
    if (typeof self !== 'undefined' && self.fonts && typeof self.fonts.add === 'function') return self.fonts;
    if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.add === 'function') return document.fonts;
    return null;
  };
  F.canRender = function () {
    return typeof OffscreenCanvas !== 'undefined' && typeof FontFace !== 'undefined' && !!F.fontSet();
  };

  F.loadFace = async function (family, bytes) {
    const face = new FontFace(family, bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    await face.load();
    const set = F.fontSet();
    if (set) set.add(face);
    return face;
  };

  /* 画一个字符 → 归一化到 N×N 的灰度方块（裁剪到墨迹包围盒，保持长宽比） */
  F.renderGlyph = function (family, ch, size, box) {
    size = size || 64;
    box = box || 32;
    const c = new OffscreenCanvas(size, size);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    ctx.font = Math.round(size * 0.78) + 'px "' + family + '"';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText(ch, 2, Math.round(size * 0.82));
    const src = ctx.getImageData(0, 0, size, size).data;
    let minX = size, minY = size, maxX = -1, maxY = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (src[(y * size + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; /* 空白字形 */
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const out = new OffscreenCanvas(box, box);
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, box, box);
    /* 等比缩放并居中：抗锯齿差异比位置差异更小 */
    const scale = Math.min(box / w, box / h);
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    octx.imageSmoothingEnabled = true;
    octx.drawImage(c, minX, minY, w, h, Math.round((box - dw) / 2), Math.round((box - dh) / 2), dw, dh);
    const d = octx.getImageData(0, 0, box, box).data;
    const v = new Float32Array(box * box);
    for (let i = 0; i < box * box; i++) v[i] = (255 - d[i * 4]) / 255; /* 墨迹=1 */
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    const norm = Math.sqrt(sum) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return { v: v, w: w, h: h, ratio: w / h, ink: sum };
  };

  F.renderSim = function (a, b) {
    if (!a || !b) return -1;
    let dot = 0;
    for (let i = 0; i < a.v.length; i++) dot += a.v[i] * b.v[i];
    /* 长宽比差异额外罚分：'1' 和 'l' 的像素相似但比例不同 */
    const rp = Math.abs(Math.log(a.ratio / b.ratio)) * 0.12;
    return Math.max(0, dot - rp);
  };

  /* ---------- woff2 / 任意格式的渲染比对主流程 ---------- */
  async function renderPath(aBytes, refBytes, cipherText, opts) {
    const famA = 'skc' + Math.random().toString(36).slice(2, 8);
    try { await F.loadFace(famA, aBytes); } catch (e) {
      return { error: '密文字体加载失败：' + e.message, hint: '字体可能被截断，或站点下发的是分段混淆的 base64（先拼回完整文件）' };
    }
    let famB = null;
    if (refBytes) {
      famB = 'skr' + Math.random().toString(36).slice(2, 8);
      try { await F.loadFace(famB, refBytes); } catch (e) { return { error: '参照字体加载失败：' + e.message }; }
    }

    const BOX = 32;
    const inRange = function (c) {
      if (opts.range === 'digit') return c >= 48 && c <= 57;
      if (opts.range === 'ascii') return c >= 32 && c < 127;
      if (opts.range === 'all') return true;
      return (c >= 0x3400 && c <= 0x9fff) || (c >= 0xe000 && c <= 0xf8ff);
    };

    /* 候选明文：数字/ASCII 可枚举；CJK 必须靠参照字体的 cmap（woff2 的 cmap 读不出来） */
    let cands = [];
    let capNote = '';
    if (refBytes) {
      if (opts.range === 'digit') cands = '0123456789'.split('');
      else if (opts.range === 'ascii') { for (let c = 32; c < 127; c++) cands.push(String.fromCharCode(c)); }
      else {
        let sfntB = null;
        try { sfntB = await F.woffToSfnt(refBytes); } catch (e) { sfntB = null; }
        const magicB = sfntB ? tagOf(sfntB, 0) : '';
        if (!sfntB || (magicB !== String.fromCharCode(0, 1, 0, 0) && magicB !== 'OTTO' && magicB !== 'true')) {
          return { error: '参照字体是 woff2，读不出它的码位表，无法确定 CJK 候选集', hint: '把「关注码位」改成「数字 0-9 / ASCII」，或参照字体换用 ttf/woff' };
        }
        const cmapB = F.parseCmap(F.readTables(sfntB).cmap);
        cands = Object.keys(cmapB).map(Number).filter(inRange).map(function (cp) { return String.fromCodePoint(cp); });
        if (cands.length > 4000) { cands = cands.slice(0, 4000); capNote = '参照字体码位超过 4000，只比对前 4000 个（建议用子集字体）'; }
      }
    }

    const candSigs = [];
    for (const ch of cands) {
      const sig = F.renderGlyph(famB, ch, 64, BOX);
      if (sig) candSigs.push({ ch: ch, sig: sig, cp: ch.codePointAt(0) });
    }

    /* 要映射的密文字符：优先用粘贴的密文；没给就按范围探测（用 .notdef 形状过滤） */
    const ct = String(cipherText == null ? '' : cipherText);
    let cipherChars = [];
    if (ct.trim()) {
      cipherChars = Array.from(new Set(Array.from(ct).filter(function (c) { return c.trim(); })));
    } else if (opts.range === 'digit' || opts.range === 'ascii') {
      const notdef = F.renderGlyph(famA, String.fromCodePoint(0x10fffd), 64, BOX);
      const from = opts.range === 'digit' ? 48 : 32;
      const to = opts.range === 'digit' ? 57 : 126;
      for (let cp = from; cp <= to; cp++) {
        const ch = String.fromCharCode(cp);
        const sig = F.renderGlyph(famA, ch, 64, BOX);
        if (!sig) continue;
        if (notdef && F.renderSim(sig, notdef) > 0.995) continue;
        cipherChars.push(ch);
      }
    } else {
      return { error: 'CJK 的 woff2 无法枚举字形', hint: '把页面上的密文文本粘到第三个框（有密文才能知道要映射哪些码位）' };
    }

    const stats = [{ k: '解码方式', v: '字形渲染比对（支持 woff2）' }, { k: '候选字', v: candSigs.length }];
    const tabs = [];
    const rows = [];
    const mapping = {};
    const lowConf = new Set();
    let textOut = '';

    if (!refBytes) {
      cipherChars.forEach(function (ch) {
        const sig = F.renderGlyph(famA, ch, 64, BOX);
        if (!sig) return;
        rows.push({
          cipher: ch + ' (U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ')',
          plain: '—', score: sig.ratio.toFixed(2), gap: '—', conf: '待参照', _ok: false,
        });
      });
      textOut = rows.map(function (r) { return r.cipher + '  宽高比 ' + r.score; }).join('\n');
      tabs.push({ label: '字形清单 (' + rows.length + ')', view: 'table', data: {
        columns: [{ key: 'cipher', label: '密文字符', width: 'minmax(140px,200px)' }, { key: 'score', label: '宽高比', width: '80px' }, { key: 'conf', label: '状态', width: '90px' }],
        rows: rows, name: 'font-glyphs',
      } });
      return {
        text: textOut, lang: 'text', tabLabel: '字形清单', tabs: tabs,
        stats: [{ k: '字形数', v: rows.length }, { k: '解码方式', v: '渲染（woff2）' }],
        notices: [{ level: 'info', msg: 'woff2 已按字形渲染解析；拖入参照字体（ttf/woff）即可得到映射' }],
        filename: 'font-map',
      };
    }

    for (const ch of cipherChars) {
      const cp = ch.codePointAt(0);
      const sig = F.renderGlyph(famA, ch, 64, BOX);
      if (!sig) continue;
      let best = null, bestS = -1, second = -1;
      for (const c of candSigs) {
        const s = F.renderSim(sig, c.sig);
        if (s > bestS) { second = bestS; bestS = s; best = c; }
        else if (s > second) second = s;
      }
      if (!best) continue;
      const gap = bestS - (second < 0 ? 0 : second);
      let conf = bestS >= 0.94 && gap >= 0.02 ? '高' : bestS >= 0.86 ? '中' : '低';
      if (conf !== '低' && gap < 0.015) conf = '低';
      mapping[cp] = best.ch;
      rows.push({
        cipher: ch + ' (U+' + cp.toString(16).toUpperCase().padStart(4, '0') + ')',
        plain: best.ch + ' (U+' + best.cp.toString(16).toUpperCase() + ')',
        score: bestS.toFixed(3), gap: gap.toFixed(3), conf: conf, _ok: conf !== '低',
      });
      if (conf === '低') lowConf.add(cp);
    }

    tabs.push({ label: '映射表 (' + rows.length + ')', view: 'table', data: {
      columns: [
        { key: 'cipher', label: '密文码位', width: 'minmax(130px,180px)' },
        { key: 'plain', label: '匹配明文', width: 'minmax(90px,140px)' },
        { key: 'score', label: '相似度', width: '80px' },
        { key: 'gap', label: '次优差', width: '80px' },
        { key: 'conf', label: '可信度', width: '80px' },
      ],
      rows: rows, name: 'font-map', filterHint: '低分行建议人工核对或换参照字体',
    } });

    const high = rows.filter(function (r) { return r.conf === '高'; }).length;
    stats.push({ k: '已映射', v: rows.length, level: 'ok' }, { k: '高可信', v: high });

    if (ct.trim() && rows.length) {
      const apply = Object.assign({}, mapping);
      if (opts.lowConf !== true) lowConf.forEach(function (cp) { delete apply[cp]; });
      let plain = '';
      let replaced = 0;
      for (const ch of Array.from(ct)) {
        const cp = ch.codePointAt(0);
        if (apply[cp]) { plain += apply[cp]; replaced++; } else plain += ch;
      }
      tabs.unshift({ label: '明文结果', text: plain, lang: 'text' });
      textOut = plain;
      stats.push({ k: '替换率', v: ct.length ? Math.round((replaced / Array.from(ct).length) * 100) + '%' : '0%' });
      if (lowConf.size) stats.push({ k: '待确认', v: lowConf.size + ' 个', level: 'warn' });
    } else {
      textOut = rows.map(function (r) { return r.cipher + ' → ' + r.plain + '  ' + r.score; }).join('\n');
    }

    return {
      text: textOut,
      lang: 'text',
      tabLabel: ct.trim() && rows.length ? '明文结果' : '映射表',
      tabs: tabs,
      stats: stats.filter(Boolean),
      notices: [
        { level: 'info', msg: 'woff2 走渲染比对：把每个字形画成 32×32 位图做相似度匹配，比轮廓数更抗「重绘字形」' },
        capNote ? { level: 'warn', msg: capNote } : null,
        lowConf.size ? { level: 'warn', msg: lowConf.size + ' 个码位相似度不足或与次优接近，已标红且未替换；确认后可勾「低可信也参与替换」' } : null,
      ].filter(Boolean),
      filename: 'font-map',
    };
  }

  F.renderPath = renderPath;

  /* ---------- 工具 ---------- */
  SK.tool({
    id: 'font-decrypt',
    name: '字体反爬映射',
    group: 'spider',
    icon: '🔤',
    aliases: 'font woff woff2 ttf 字体 反爬 映射 字形 大众点评 汽车之家',
    keywords: ['字体', '反爬', 'woff', 'woff2', 'ttf', '映射', '字形', 'glyph', 'cmap', '点评'],
    desc: '解析 woff / woff2 / ttf / otf 字体，给出 码位→明文 候选映射并批量还原密文：ttf/woff 用轮廓特征比对，woff2 直接交给浏览器字体引擎渲染后比字形位图',
    hint: '两个框：密文字体 + 参照字体（同站明文字体或系统字体）；参照可留空仅看字形清单。结果是候选匹配，低可信项默认不替换',
    inputs: [
      { id: 'in', label: '密文字体（woff/ttf/otf，直接拖文件）', placeholder: '目标站点的混淆字体文件', sample: 'fontA', binary: true },
      { id: 'ref', label: '参照字体（明文字体，可选）', placeholder: '同站明文字体 / 系统字体（ttx/fluentui 等导出）', small: true, allowEmpty: true, sample: 'fontB', binary: true },
      { id: 'cipherText', label: '密文文本（按映射替换成明文）', placeholder: '页面抓到的乱码文本，如 㐗㘅㖠', small: true, allowEmpty: true, sample: 'fontText' },
    ],
    options: [
      { id: 'range', type: 'select', label: '关注码位', value: 'cjk', choices: [
        { v: 'cjk', label: 'CJK 区（中文反爬）' },
        { v: 'digit', label: '数字 0-9' },
        { v: 'ascii', label: 'ASCII 可见字符' },
        { v: 'all', label: '全部码位' },
      ] },
      { id: 'lowConf', type: 'toggle', label: '低可信也参与替换', value: false, title: '关闭时，候选冲突 / 组合字形 / 距离分 >15 的映射只列在表里，不会写进明文结果' },
    ],
    help:
      '<h4>字体反爬原理</h4>' +
      '<p>站点把 0-9 或常用汉字的码位打乱重制字体：接口返回 <code>㐗㘅㖠</code> 这类码位，浏览器用混淆字体渲染出来才是 <code>382</code>。爬虫拿到的是码位（密文），要还原必须解出 字形→明文 映射。</p>' +
      '<h4>用法</h4>' +
      '<ol><li>Network 里把目标站返回的 <b>.woff/.ttf</b> 拖到第一个框</li>' +
      '<li>参照字体拖到第二个框——优先同站「明文字体」（未混淆版，常在首次访问时下发），或系统常见字体的对应字重</li>' +
      '<li>运行：特征匹配给出 码位→明文 映射表（按 轮廓数/点数/bbox 比例 最近邻）</li>' +
      '<li>把页面密文贴到第三个框 → 输出明文</li></ol>' +
      '<h4>判匹配质量</h4>' +
      '<ul><li>相似度列：&lt;5 很可信，5-15 建议人工核对，&gt;15 基本不可信（换参照字体）</li>' +
      '<li>数字字体通常一次全中；汉字因字形复杂建议只信低分项，配合「字符集过滤」缩小范围</li></ul>' +
      '<p><b>woff2 直接支持</b>：走浏览器字体引擎渲染字形再比对位图，不用先转格式；CJK 候选集需要参照字体是 ttf/woff（woff2 的码位表读不出来）。</p>',
    handler: async function (input, refInput, cipherText, opts) {
      const loadFont = async (v) => {
        if (v == null) return null;
        if (v.__file) {
          const buf = await v.__file.arrayBuffer();
          return new Uint8Array(buf);
        }
        if (typeof v === 'string' && v.trim()) {
          const s = v.trim().replace(/\s+/g, '');
          if (!s) return null;
          /* base64 / hex */
          try {
            if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 && s.length > 64) {
              const b = new Uint8Array(s.length / 2);
              for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
              return b;
            }
            let t = s.replace(/-/g, '+').replace(/_/g, '/');
            while (t.length % 4) t += '=';
            const bin = atob(t);
            const b = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
            return b;
          } catch (e) { return null; }
        }
        return null;
      };
      const aBytes = await loadFont(input);
      if (!aBytes) return { error: '密文字体为空', hint: '把 .woff/.ttf 文件直接拖进第一个框，或粘贴 base64' };
      const refBytes = await loadFont(refInput);
      const magicA = SK.font.tagOf(aBytes, 0);
      const magicB = refBytes ? SK.font.tagOf(refBytes, 0) : '';

      /* ---------- woff2：走渲染比对 ---------- */
      if (magicA === 'wOF2' || magicB === 'wOF2') {
        if (!SK.font.canRender()) {
          return { error: '这个浏览器不支持在后台线程渲染字体（OffscreenCanvas / FontFace）', hint: '用 Chrome 90+ / Edge 90+ 打开；或把 woff2 转成 ttf 再传' };
        }
        return await SK.font.renderPath(aBytes, refBytes, cipherText, opts);
      }

      let sfntA;
      try { sfntA = await SK.font.woffToSfnt(aBytes); } catch (e) { return { error: 'woff 解压失败：' + e.message }; }
      const magic = String.fromCharCode(sfntA[0], sfntA[1], sfntA[2], sfntA[3]);
      if (magic !== String.fromCharCode(0, 1, 0, 0) && magic !== 'OTTO' && magic !== 'true') {
        return { error: '不是 ttf/otf/woff 字体（magic=' + magic.replace(/[^\x20-\x7e]/g, '?') + '）', hint: 'EOT/BDF 不支持；确认文件没被截断' };
      }
      const tablesA = SK.font.readTables(sfntA);
      const cmapA = SK.font.parseCmap(tablesA.cmap);

      /* 关注范围过滤 */
      const inRange = function (c) {
        if (opts.range === 'digit') return c >= 48 && c <= 57;
        if (opts.range === 'ascii') return c >= 32 && c < 127;
        if (opts.range === 'all') return true;
        return c >= 0x3400 && c <= 0x9fff || c >= 0xe000 && c <= 0xf8ff;
      };
      const entriesA = [];
      Object.keys(cmapA).forEach((c) => {
        const cp = Number(c);
        if (!inRange(cp)) return;
        const f = SK.font.glyphFeatures(tablesA, cmapA[cp]);
        if (f && !f.empty) entriesA.push({ cp: cp, gid: cmapA[cp], feat: f });
      });

      if (!entriesA.length) {
        return { error: '没解析到字形', hint: '换「全部码位」再试；或文件是 woff2（先转 woff/ttf）' };
      }

      const stats = [
        { k: '字形数', v: entriesA.length },
        { k: '表', v: Object.keys(tablesA).join(',') },
      ];
      const tabs = [];
      let textOut = entriesA.map((e) => 'U+' + e.cp.toString(16).toUpperCase().padStart(4, '0') + ' → glyph ' + e.gid + '  轮廓' + e.feat.contours + ' 点' + e.feat.points + ' 宽' + e.feat.w.toFixed(2) + ' 高' + e.feat.h.toFixed(2)).join('\n');
      let mapText = '';
      const lowConf = new Set(); /* 低可信码位：只列在表里，默认不参与替换 */

      /* 参照字体匹配 */
      let mapping = null;
      if (refBytes) {
        let sfntB;
        try { sfntB = await SK.font.woffToSfnt(refBytes); } catch (e) { return { error: '参照字体 woff 解压失败：' + e.message }; }
        const tablesB = SK.font.readTables(sfntB);
        const cmapB = SK.font.parseCmap(tablesB.cmap);
        const entriesB = [];
        Object.keys(cmapB).forEach((c) => {
          const cp = Number(c);
          const f = SK.font.glyphFeatures(tablesB, cmapB[cp]);
          if (f && !f.empty) entriesB.push({ cp: cp, feat: f });
        });
        if (!entriesB.length) return { error: '参照字体没解析到字形' };
        /* 最近邻 */
        mapping = {};
        const matchRows = [];
        entriesA.forEach((a) => {
          let best = null, bestD = Infinity, second = Infinity;
          for (const b of entriesB) {
            const d = SK.font.featDist(a.feat, b.feat);
            if (d < bestD) { second = bestD; bestD = d; best = b; }
            else if (d < second) second = d;
          }
          if (best && bestD < 999) {
            /* B23：置信度不能只看距离分，还要看「第二名差多少」。
               两个候选分数几乎一样时就是歧义，必须降为低可信并要求人工确认。 */
            const gap = (second === Infinity ? 999 : second) - bestD;
            let conf = bestD <= 5 ? '高' : bestD <= 15 ? '中' : '低';
            if (conf !== '低' && gap < 3) conf = '低';
            if (a.feat && a.feat.composite) conf = '低';
            mapping[a.cp] = String.fromCodePoint(best.cp);
            matchRows.push({
              cipher: 'U+' + a.cp.toString(16).toUpperCase().padStart(4, '0') + ' ' + String.fromCodePoint(a.cp),
              plain: String.fromCodePoint(best.cp) + ' (U+' + best.cp.toString(16).toUpperCase() + ')',
              score: bestD.toFixed(1),
              gap: gap > 900 ? '—' : gap.toFixed(1),
              conf: conf,
              _ok: conf !== '低',
            });
            if (conf === '低') lowConf.add(a.cp);
          }
        });
        tabs.push({ label: '映射表 (' + Object.keys(mapping).length + ')', view: 'table', data: {
          columns: [
            { key: 'cipher', label: '密文码位', width: 'minmax(120px,160px)' },
            { key: 'plain', label: '匹配明文', width: 'minmax(90px,140px)' },
            { key: 'score', label: '距离分', width: '80px' },
            { key: 'gap', label: '次优差', width: '80px' },
            { key: 'conf', label: '可信度', width: '80px' },
          ],
          rows: matchRows, name: 'font-map',
          filterHint: '低分行建议人工核对或换参照字体',
        } });
        mapText = Object.keys(mapping).sort((x, y) => x - y).map((cp) => String.fromCodePoint(cp) + '=' + mapping[cp]).join('\n');
        stats.push({ k: '已映射', v: Object.keys(mapping).length, level: 'ok' });
        stats.push({ k: '高可信', v: matchRows.filter((r) => r.conf === '高').length });
      }

      /* 密文替换 —— 低可信映射默认不参与替换，避免把字替换错 */
      const ct = String(cipherText == null ? '' : cipherText);
      if (ct && mapping) {
        const apply = Object.assign({}, mapping);
        if (opts.lowConf !== true) lowConf.forEach((cp) => delete apply[cp]);
        let plain = '';
        for (const ch of ct) {
          const cp = ch.codePointAt(0);
          plain += apply[cp] || ch;
        }
        tabs.push({ label: '明文结果', text: plain, lang: 'text' });
        textOut = plain;
        const replaced = [...ct].filter((c) => apply[c.codePointAt(0)]).length;
        stats.push({ k: '替换率', v: ct.length ? Math.round(replaced / ct.length * 100) + '%' : '0%' });
        if (lowConf.size) stats.push({ k: '待确认', v: lowConf.size + ' 个', level: 'warn' });
      }

      return {
        text: textOut,
        lang: 'text',
        tabLabel: refBytes ? (ct && mapping ? '明文结果' : '字形清单') : '字形清单',
        tabs: tabs,
        stats: stats,
        notices: [].concat(
          refBytes ? [{ level: 'info', msg: '映射按 轮廓数+点数+bbox比例 最近邻；距离分>15 或与次优差距<3 的标为低可信，默认不写进明文结果' }] : [{ level: 'info', msg: '只填了密文字体：先看字形清单；拖参照字体进第二框可得映射' }],
          lowConf.size ? [{ level: 'warn', msg: lowConf.size + ' 个码位匹配不可靠（组合字形 / 候选冲突 / 距离过大），已在映射表标红且未替换，请人工确认后再勾选「低可信也参与替换」' }] : [],
        ),
        filename: 'font-map',
      };
    },
  });
})();
