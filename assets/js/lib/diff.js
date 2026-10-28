(function (root) {
  const SK = (root.SK = root.SK || {});

  const FNV = 0x01000193;
  const DEF_OPTS = {
    context: 3,
    ignoreWhitespace: false,
    ignoreWhitespaceOnly: true,
    ignoreCase: false,
    ignoreBlankLines: false,
    normalizeNewlines: true,
    maxHunks: Infinity,
    maxCells: 4000000,
    maxNodes: 60000,
    intraLine: true,
    largeThreshold: 250000,
    pairModifications: true,
    modSimilarity: 0.5,
    maxIntraChars: 4000,
    depthLimit: 64,
    limitBytes: 20 * 1024 * 1024,
    matchBy: 'auto',
    ignorePaths: null,
    treatNumericStringEqual: false,
    arrayAsSet: false,
    sortBeforeCompare: false,
    maxD: 4096
  };

  function norm(o, d) {
    o = o || {};
    const r = {};
    for (const k in d) if (Object.prototype.hasOwnProperty.call(d, k)) r[k] = d[k];
    for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }

  function fnv1a(str, seed) {
    let h = (seed === undefined ? 0x811c9dc5 : seed) >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, FNV) >>> 0;
    }
    return h >>> 0;
  }

  function hashAll(arr) {
    const h = new Int32Array(arr.length);
    for (let i = 0; i < arr.length; i++) h[i] = fnv1a(arr[i]) | 0;
    return h;
  }

  function splitLines(text) {
    const lines = [], endings = [];
    const n = text.length;
    if (n === 0) return { lines: lines, endings: endings, trailingNewline: false };
    let start = 0, i = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10 || c === 13) {
        let e;
        if (c === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) e = '\r\n';
        else e = c === 13 ? '\r' : '\n';
        lines.push(text.slice(start, i));
        endings.push(e);
        i += e.length;
        start = i;
      } else i++;
    }
    const trailingNewline = start === n;
    if (!trailingNewline) lines.push(text.slice(start));
    return { lines: lines, endings: endings, trailingNewline: trailingNewline };
  }

  function keyFn(opts) {
    const iw = opts.ignoreWhitespace, iwo = opts.ignoreWhitespaceOnly, ic = opts.ignoreCase;
    if (!iw && !iwo && !ic) return null;
    return function (s) {
      let k = s;
      if (iw) k = k.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
      else if (iwo) k = k.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
      if (ic) k = k.toLowerCase();
      return k;
    };
  }

  function byteLenUnder(s, limit) {
    let bytes = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c < 0xdc00) { bytes += 4; i++; }
      else bytes += 3;
      if (bytes > limit) return bytes;
    }
    return bytes;
  }

  function sortByHash(h, lo, hi) {
    const len = hi - lo;
    const idx = new Int32Array(len);
    for (let i = 0; i < len; i++) idx[i] = lo + i;
    idx.sort(function (a, b) {
      const ua = h[a] >>> 0, ub = h[b] >>> 0;
      return ua < ub ? -1 : ua > ub ? 1 : a - b;
    });
    return idx;
  }

  function groupScan(sa, sb, cb) {
    let i = 0, j = 0;
    while (i < sa.length && j < sb.length) {
      const ga = i, gb = j;
      const ha = sa[ga], hb = sb[gb];
      while (i < sa.length && sa[i] === ha) i++;
      while (j < sb.length && sb[j] === hb) j++;
      cb(sa, ga, i, sb, gb, j);
    }
  }

  /* 返回 [[aLine, bLine], ...]：两侧各自唯一且内容相同的行，按 LIS 排成递增锚点 */
  function uniqueAnchorPairs(hA, hB, kA, kB, a0, a1, b0, b1) {
    const sa = sortByHash(hA, a0, a1), sb = sortByHash(hB, b0, b1);
    const ha = new Int32Array(sa.length), hb = new Int32Array(sb.length);
    for (let i = 0; i < sa.length; i++) ha[i] = hA[sa[i]];
    for (let j = 0; j < sb.length; j++) hb[j] = hB[sb[j]];
    const ia = [], ib = [];
    groupScan(ha, hb, function (A, ai, aEnd, B, bi, bEnd) {
      if (aEnd - ai !== 1 || bEnd - bi !== 1) return;
      const av = sa[ai], bv = sb[bi];
      if (kA[av] === kB[bv]) { ia.push(av); ib.push(bv); }
    });
    if (ia.length < 2) return null;
    const seq = lisBi(Int32Array.from(ia), Int32Array.from(ib), ia.length);
    if (seq.length < 2) return null;
    const out = [];
    for (let i = 0; i < seq.length; i++) out.push([ia[seq[i]], ib[seq[i]]]);
    return out;
  }

  function lisBi(ai, bi, cnt) {
    const tails = [], tailVals = [], prev = new Int32Array(cnt);
    for (let i = 0; i < cnt; i++) {
      const v = bi[i];
      let lo = 0, hi = tailVals.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tailVals[mid] < v) lo = mid + 1; else hi = mid;
      }
      prev[i] = lo > 0 ? tails[lo - 1] : -1;
      if (lo === tailVals.length) { tailVals.push(v); tails.push(i); }
      else { tailVals[lo] = v; tails[lo] = i; }
    }
    const out = [];
    if (tails.length === 0) return out;
    let k = tails[tails.length - 1];
    while (k >= 0) { out.push(k); k = prev[k]; }
    out.reverse();
    return out;
  }

  function lcsRuns(kA, kB, hA, hB, a0, a1, b0, b1, maxCells) {
    const n = a1 - a0, m = b1 - b0;
    if (n === 0 || m === 0) return null;
    const cells = (n + 1) * (m + 1);
    if (cells > maxCells) return null;
    const dir = new Uint8Array(cells);
    let cur = new Int32Array(m + 1);
    let nxt = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      const ka = kA[a0 + i - 1], ha = hA[a0 + i - 1];
      const base = i * (m + 1), prevBase = base - (m + 1);
      nxt[0] = 0;
      for (let j = 1; j <= m; j++) {
        if (ka === kB[b0 + j - 1] && ha === hB[b0 + j - 1]) {
          nxt[j] = cur[j - 1] + 1;
          dir[base + j] = 1;
        } else if (cur[j] >= nxt[j - 1]) {
          nxt[j] = cur[j];
          dir[base + j] = 2;
        } else {
          nxt[j] = nxt[j - 1];
          dir[base + j] = 3;
        }
      }
      const t = cur; cur = nxt; nxt = t;
    }
    const runs = [];
    let i = n, j = m;
    let eqA = -1, eqLen = 0;
    function flushEq() {
      if (eqLen > 0) { runs.push({ t: 'eq', a: a0 + eqA, b: b0 + eqA >= 0 ? j : j, n: eqLen }); eqLen = 0; }
    }
    const rev = [];
    while (i > 0 || j > 0) {
      const d = i === 0 ? 3 : j === 0 ? 2 : dir[i * (m + 1) + j];
      if (d === 1) { i--; j--; rev.push(0); }
      else if (d === 2) { i--; rev.push(-1); }
      else { j--; rev.push(1); }
    }
    rev.reverse();
    let ai = a0, bj = b0;
    for (let p = 0; p < rev.length; p++) {
      const op = rev[p];
      if (op === 0) runs.push({ t: 'eq', a: ai++, b: bj++, n: 1 });
      else if (op === -1) runs.push({ t: 'del', a: ai++, b: bj, n: 1 });
      else runs.push({ t: 'add', a: ai, b: bj++, n: 1 });
    }
    return mergeRuns(runs);
  }

  function mergeRuns(runs) {
    const out = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i], p = out[out.length - 1];
      if (p && p.t === r.t && p.a + p.n === r.a && p.b + p.n === r.b) p.n += r.n;
      else out.push({ t: r.t, a: r.a, b: r.b, n: r.n });
    }
    return out;
  }

  function align(A, B, opts, hooks) {
    const total = A.length + B.length;
    const kf = keyFn(opts);
    const kA = kf ? new Array(A.length) : A;
    const kB = kf ? new Array(B.length) : B;
    if (kf) {
      for (let i = 0; i < A.length; i++) kA[i] = kf(A[i]);
      for (let j = 0; j < B.length; j++) kB[j] = kf(B[j]);
    }
    const hA = hashAll(kA), hB = hashAll(kB);
    const maxCells = opts.maxCells;
    const runs = [];
    const state = { approximated: false, reason: null, regions: 0, processed: 0, lastProgress: 0 };
    const stack = [{ a0: 0, a1: A.length, b0: 0, b1: B.length }];
    while (stack.length) {
      const w = stack.pop();
      if (w.emit) { runs.push(w.emit); continue; }
      let a0 = w.a0, a1 = w.a1, b0 = w.b0, b1 = w.b1;
      while (a0 < a1 && b0 < b1 && hA[a0] === hB[b0] && kA[a0] === kB[b0]) { a0++; b0++; }
      if (a0 > w.a0 || b0 > w.b0) runs.push({ t: 'eq', a: w.a0, b: w.b0, n: a0 - w.a0 });
      while (a0 < a1 && b0 < b1 && hA[a1 - 1] === hB[b1 - 1] && kA[a1 - 1] === kB[b1 - 1]) { a1--; b1--; }
      if (a1 < w.a1) stack.push({ emit: { t: 'eq', a: a1, b: b1, n: w.a1 - a1 } });
      if (a0 === a1 && b0 === b1) { report(state, hooks, total); continue; }
      if (a0 === a1) { stack.push({ emit: { t: 'add', a: a0, b: b0, n: b1 - b0 } }); continue; }
      if (b0 === b1) { stack.push({ emit: { t: 'del', a: a0, b: b0, n: a1 - a0 } }); continue; }
      let anchors = null;
      if (a1 - a0 > 2 && b1 - b0 > 2) {
        try { anchors = uniqueAnchorPairs(hA, hB, kA, kB, a0, a1, b0, b1); } catch (e) { anchors = null; }
      }
      if (anchors) {
        let ca = a0, cb = b0;
        const pending = [];
        for (let i = 0; i < anchors.length; i++) {
          const pai = anchors[i][0], pbi = anchors[i][1];
          if (pai < ca || pbi < cb) continue;
          pending.push({ a0: ca, a1: pai, b0: cb, b1: pbi });
          pending.push({ emit: { t: 'eq', a: pai, b: pbi, n: 1 } });
          ca = pai + 1; cb = pbi + 1;
        }
        pending.push({ a0: ca, a1: a1, b0: cb, b1: b1 });
        for (let i = pending.length - 1; i >= 0; i--) stack.push(pending[i]);
      } else {
        const lcs = lcsRuns(kA, kB, hA, hB, a0, a1, b0, b1, maxCells);
        if (lcs) {
          for (let i = lcs.length - 1; i >= 0; i--) stack.push({ emit: lcs[i] });
        } else {
          state.approximated = true;
          state.reason = 'region ' + (a1 - a0) + 'x' + (b1 - b0) + ' exceeds maxCells=' + maxCells + '; emitted as block del+add';
          stack.push({ emit: { t: 'add', a: a0, b: b0, n: b1 - b0 } });
          stack.push({ emit: { t: 'del', a: a0, b: b0, n: a1 - a0 } });
        }
      }
      report(state, hooks, total);
    }
    return {
      runs: mergeRuns(runs), kA: kA, kB: kB, hA: hA, hB: hB,
      approximated: state.approximated, reason: state.reason
    };
  }

  function report(state, hooks, total) {
    if (!hooks || !hooks.progress) return;
    state.processed++;
    if (state.processed - state.lastProgress < 4096) return;
    state.lastProgress = state.processed;
    hooks.progress(Math.min(total, total), total);
  }

  function alignSeq(A, B, opts, hooks) {
    const al = align(A, B, opts, hooks);
    let runs = al.runs;
    if (opts.maxD > 0 && al.approximated) runs = al.runs;
    const seq = runsToSeq(runs);
    return { al: al, runs: runs, seq: seq, kA: al.kA, kB: al.kB, hA: al.hA, hB: al.hB };
  }

  function runsToSeq(runs) {
    const n = runs.length;
    let tl = 0;
    for (let i = 0; i < n; i++) tl += runs[i].n;
    const t = new Int8Array(tl), av = new Int32Array(tl), bv = new Int32Array(tl);
    let p = 0;
    for (let i = 0; i < n; i++) {
      const r = runs[i], c = r.t === 'eq' ? 0 : r.t === 'del' ? 1 : 2;
      for (let k = 0; k < r.n; k++) {
        t[p] = c; av[p] = r.a + k; bv[p] = r.b + k; p++;
      }
    }
    return { t: t, a: av, b: bv, len: tl };
  }

  function buildEvents(seq, opts, kA, kB, A, B, moves) {
    const events = [];
    const simOk = !opts.pairModifications ? null : function (x, y) {
      if (x === y) return true;
      const lx = A ? A.length : 0;
      return similarity(A[x], B[y]) >= opts.modSimilarity;
    };
    let i = 0;
    const L = seq.len;
    while (i < L) {
      const t = seq.t[i];
      if (t === 0) { events.push({ t: 0, ai: seq.a[i], bi: seq.b[i] }); i++; continue; }
      /* 连续 del/add（可能混合、顺序不定）视作一个变更块，按出现顺序两两配成“修改” */
      let end = i;
      while (end < L && seq.t[end] !== 0) end++;
      const dels = [], adds = [];
      for (let p = i; p < end; p++) {
        if (seq.t[p] === 1) dels.push(seq.a[p]);
        else adds.push(seq.b[p]);
      }
      const maxP = Math.min(dels.length, adds.length);
      let paired = 0;
      if (simOk && !opts.largeMode) {
        for (let p = 0; p < maxP; p++) {
          const ai = dels[p], bi = adds[p];
          /* movedTo/movedFrom 按行号存：0 = 无配对，>0 = 该行在对面是“移动”而非修改 */
          if (moves.movedTo && moves.movedTo[ai] > 0) break;
          if (moves.movedFrom && moves.movedFrom[bi] > 0) break;
          if (kA[ai] === kB[bi]) { paired++; continue; }
          if (!similarPair(A[ai], B[bi], opts)) break;
          paired++;
        }
      }
      for (let p = 0; p < paired; p++) events.push({ t: 3, ai: dels[p], bi: adds[p] });
      for (let p = paired; p < dels.length; p++) events.push({ t: 1, ai: dels[p], bi: -1 });
      for (let p = paired; p < adds.length; p++) events.push({ t: 2, ai: -1, bi: adds[p] });
      i = end;
      continue;
    }
    return events;
  }

  function similarPair(x, y, opts) {
    if (x === y) return true;
    const lx = x.length, ly = y.length;
    if (lx === 0 || ly === 0) return false;
    const ratio = lx > ly ? ly / lx : lx / ly;
    if (ratio < 0.34) return false;
    if (lx + ly > 2 * 4000) return false;
    /* 共同前缀+后缀占大头也视为“修改行”：日志常见的“开头相同、中段变了” */
    const cap = Math.min(lx, ly, 400);
    let p = 0;
    while (p < cap && x.charCodeAt(p) === y.charCodeAt(p)) p++;
    let s = 0;
    while (s < cap - p && x.charCodeAt(lx - 1 - s) === y.charCodeAt(ly - 1 - s)) s++;
    if ((p + s) / Math.max(lx, ly) >= 0.5) return true;
    return similarity(x, y) >= opts.modSimilarity;
  }

  function ngramHashes(s, n, cap) {
    if (s.length > cap) s = s.slice(0, cap);
    const cnt = Math.max(0, s.length - n + 1);
    const out = new Int32Array(cnt);
    let h = 0x811c9dc5;
    for (let i = 0; i < cnt; i++) {
      h = fnv1a(s.substr(i, n), 0x811c9dc5) | 0;
      out[i] = h;
    }
    out.sort();
    let w = 0;
    for (let i = 0; i < out.length; i++) {
      if (i === 0 || out[i] !== out[i - 1]) out[w++] = out[i];
    }
    return out.subarray(0, w);
  }

  function similarity(a, b) {
    a = a == null ? '' : String(a);
    b = b == null ? '' : String(b);
    if (a === b) return 1;
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const CAP = 200000;
    const n = 3;
    const ga = ngramHashes(a, n, CAP), gb = ngramHashes(b, n, CAP);
    let i = 0, j = 0, inter = 0;
    while (i < ga.length && j < gb.length) {
      const x = ga[i] >>> 0, y = gb[j] >>> 0;
      if (x === y) { inter++; i++; j++; }
      else if (x < y) i++;
      else j++;
    }
    const union = ga.length + gb.length - inter;
    return union === 0 ? 0 : inter / union;
  }

  function commonPrefixSuffix(a, b) {
    a = String(a); b = String(b);
    const min = Math.min(a.length, b.length);
    let p = 0;
    while (p < min && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let s = 0;
    while (s < min - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    return { prefix: a.slice(0, p), suffix: s > 0 ? a.slice(a.length - s) : '', prefixLen: p, suffixLen: s };
  }

  function intraDiff(a, b, mode) {
    if (a === b) return [{ op: 'eq', text: a }];
    if (a.length > 4000 || b.length > 4000) {
      return [{ op: 'del', text: a }, { op: 'ins', text: b }];
    }
    const toksA = tokenize(a, mode), toksB = tokenize(b, mode);
    if (toksA.length * toksB.length > 40000) {
      return [{ op: 'del', text: a }, { op: 'ins', text: b }];
    }
    const runs = lcsRuns(toksA, toksB, hashAll(toksA), hashAll(toksB), 0, toksA.length, 0, toksB.length, 1e9) || [];
    const out = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      const arr = r.t === 'del' ? toksA : r.t === 'add' ? toksB : toksA;
      const text = arr.slice(r.t === 'del' ? r.a : r.t === 'add' ? r.b : r.a, (r.t === 'add' ? r.b : r.a) + r.n).join('');
      out.push({ op: r.t === 'eq' ? 'eq' : r.t === 'add' ? 'ins' : 'del', text: text });
    }
    /* 词级结果再做一遍字符级细化：world → wor1d 只高亮 l/1，而不是整词 */
    if (mode !== 'char') return refineIntra(out);
    return mergeSegs(out);
  }

  /* 相邻 del+ins 片段用字符级 diff 收窄，词内改动也能精确到字符 */
  function refineIntra(segs) {
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const n = segs[i + 1];
      if (n && s.op !== 'eq' && n.op !== 'eq' && s.op !== n.op) {
        const del = s.op === 'del' ? s.text : n.text;
        const ins = s.op === 'ins' ? s.text : n.text;
        pushAll(out, charRefine(del, ins));
        i++;
      } else out.push(s);
    }
    return mergeSegs(out);
  }

  function charRefine(x, y) {
    const BUDGET = 800;
    if (x.length + y.length > BUDGET) return [{ op: 'del', text: x }, { op: 'ins', text: y }];
    let p = 0;
    while (p < x.length && p < y.length && x.charCodeAt(p) === y.charCodeAt(p)) p++;
    let s = 0;
    while (s < x.length - p && s < y.length - p && x.charCodeAt(x.length - 1 - s) === y.charCodeAt(y.length - 1 - s)) s++;
    const cx = x.slice(p, x.length - s);
    const cy = y.slice(p, y.length - s);
    if (!cx || !cy || cx === cy) {
      return [
        p ? { op: 'eq', text: x.slice(0, p) } : null,
        cx ? { op: 'del', text: cx } : null,
        cy ? { op: 'ins', text: cy } : null,
        s ? { op: 'eq', text: x.slice(x.length - s) } : null,
      ].filter(Boolean);
    }
    const mid = intraDiff(cx, cy, 'char');
    const out = [];
    if (p) out.push({ op: 'eq', text: x.slice(0, p) });
    pushAll(out, mid);
    if (s) out.push({ op: 'eq', text: x.slice(x.length - s) });
    return out;
  }

  function mergeSegs(segs) {
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      const last = out[out.length - 1];
      if (last && last.op === segs[i].op) last.text += segs[i].text;
      else if (segs[i].text) out.push(segs[i]);
    }
    return out;
  }

  function pushAll(dst, src) {
    for (let i = 0; i < src.length; i++) dst.push(src[i]);
  }

  function tokenize(s, mode) {
    if (mode === 'char') return s.split('');
    const out = [], re = /[\w$]+|[^\w$\s]|\s+/g;
    let m;
    while ((m = re.exec(s))) out.push(m[0]);
    return out;
  }

  function assign(dst, src) {
    for (const k in src) dst[k] = src[k];
    return dst;
  }

  function hasCr(endings) {
    for (let i = 0; i < endings.length; i++) if (endings[i].charCodeAt(0) === 13) return true;
    return false;
  }

  function buildHunksFinal(events, A, B, opts, moves, trFlag) {
    const context = Math.max(0, opts.context | 0);
    const L = events.length;
    let changedMask = new Uint8Array(L);
    for (let i = 0; i < L; i++) changedMask[i] = events[i].t === 0 ? 0 : 1;
    let visible = new Uint8Array(L);
    for (let i = 0; i < L; i++) {
      if (changedMask[i]) continue;
      for (let d = 1; d <= context; d++) {
        if (i - d >= 0 && changedMask[i - d]) { visible[i] = 1; break; }
        if (i + d < L && changedMask[i + d]) { visible[i] = 1; break; }
      }
    }
    for (let i = 0; i < L; i++) if (changedMask[i]) visible[i] = 1;
    const hunks = [];
    let i = 0;
    let movedCount = 0;
    while (i < L) {
      if (!visible[i]) { i++; continue; }
      let j = i;
      while (j + 1 < L && visible[j + 1]) j++;
      const changes = [];
      let oldStart = 0, newStart = 0, oldLines = 0, newLines = 0, first = true;
      for (let p = i; p <= j; p++) {
        const e = events[p];
        if (first) {
          oldStart = e.ai >= 0 ? e.ai + 1 : nextOld(events, p, L);
          newStart = e.bi >= 0 ? e.bi + 1 : nextNew(events, p, L);
          first = false;
        }
        changes.push(makeChange(e, p, A, B, opts, moves));
        if (e.t !== 2) oldLines++;
        if (e.t !== 1) newLines++;
        if (changes[changes.length - 1].moved) movedCount++;
      }
      hunks.push({ oldStart: oldStart, oldLines: oldLines, newStart: newStart, newLines: newLines, changes: changes });
      if (hunks.length >= opts.maxHunks) { trFlag.flag = true; break; }
      i = j + 1;
    }
    if (!opts.largeMode) {
      let blocks = 0, inBlock = false;
      for (let k = 0; k < hunks.length; k++) {
        const cs = hunks[k].changes;
        for (let c = 0; c < cs.length; c++) {
          if (cs[c].moved) { if (!inBlock) { blocks++; inBlock = true; } }
          else if (cs[c].type === 'add' || cs[c].type === 'del') inBlock = false;
        }
      }
      moves.blocks = Math.max(moves.blocks, blocks);
    }
    return hunks;
  }

  function nextOld(events, p, L) {
    for (let k = p; k < L; k++) if (events[k].ai >= 0) return events[k].ai + 1;
    for (let k = p - 1; k >= 0; k--) if (events[k].ai >= 0) return events[k].ai + 2;
    return 1;
  }

  function nextNew(events, p, L) {
    for (let k = p; k < L; k++) if (events[k].bi >= 0) return events[k].bi + 1;
    for (let k = p - 1; k >= 0; k--) if (events[k].bi >= 0) return events[k].bi + 2;
    return 1;
  }

  function makeChange(e, pos, A, B, opts, moves) {
    const ch = { type: 'equal', oldLine: null, newLine: null, text: '', _pos: pos };
    if (e.t === 0) {
      ch.type = 'equal'; ch.oldLine = e.ai + 1; ch.newLine = e.bi + 1; ch.text = A[e.ai];
    } else if (e.t === 1) {
      ch.type = 'del'; ch.oldLine = e.ai + 1; ch.text = A[e.ai];
      if (moves.movedTo) {
        const mv = movesMoveTo(moves, e);
        if (mv) { ch.moved = true; ch.movedTo = mv; }
      }
    } else if (e.t === 2) {
      ch.type = 'add'; ch.newLine = e.bi + 1; ch.text = B[e.bi];
      const mv = movesMoveFrom(moves, e);
      if (mv) { ch.moved = true; ch.movedFrom = mv; ch.movedSource = A[mv - 1]; }
    } else {
      ch.type = 'mod'; ch.oldLine = e.ai + 1; ch.newLine = e.bi + 1;
      ch.text = B[e.bi]; ch.aText = A[e.ai]; ch.bText = B[e.bi];
      ch.intra = [];
      if (opts.intraLine) {
        const la = A[e.ai].length, lb = B[e.bi].length;
        if (la + lb <= (opts.maxIntraChars || 4000)) {
          ch.intra = intraDiff(A[e.ai], B[e.bi], opts.intraLine === true ? 'word' : String(opts.intraLine));
        }
      }
    }
    return ch;
  }

  function movesMoveFrom(moves, e) {
    if (!moves.from) return 0;
    return moves.from[e.bi] > 0 ? moves.from[e.bi] + 1 : 0;
  }

  function movesMoveTo(moves, e) {
    if (!moves.to) return 0;
    return moves.to[e.ai] > 0 ? moves.to[e.ai] + 1 : 0;
  }

  function diffEvents(a, b, opts, hooks) {
    opts = norm(opts, DEF_OPTS);
    const rawA = splitLines(a == null ? '' : String(a));
    const rawB = splitLines(b == null ? '' : String(b));
    let A = rawA.lines, B = rawB.lines;
    if (opts.ignoreBlankLines) {
      A = A.filter(function (l) { return l.trim() !== ''; });
      B = B.filter(function (l) { return l.trim() !== ''; });
    }
    opts.largeMode = A.length + B.length > opts.largeThreshold;
    const al = alignSeq(A, B, opts, hooks);
    const moves = opts.largeMode ? { blocks: 0 } : findMovePairs(al, A, B);
    const events = buildEvents(al.seq, opts, al.kA, al.kB, A, B, { movedFrom: null, movedTo: null, blocks: moves.blocks });
    return { A: A, B: B, rawA: rawA, rawB: rawB, al: al, events: events, moves: moves, opts: opts };
  }

  function findMovePairs(al, A, B) {
    const seq = al.seq, kA = al.kA, kB = al.kB, hA = al.hA, hB = al.hB;
    let dCount = 0, aCount = 0;
    for (let i = 0; i < seq.len; i++) {
      if (seq.t[i] === 1) dCount++;
      else if (seq.t[i] === 2) aCount++;
    }
    const res = { blocks: 0, from: new Int32Array(B.length), to: new Int32Array(A.length) };
    res.from.fill(0); res.to.fill(0);
    if (!dCount || !aCount) return res;
    const dpos = new Int32Array(dCount), apos = new Int32Array(aCount);
    const dh = new Int32Array(dCount), ah = new Int32Array(aCount);
    let p = 0, q = 0;
    for (let i = 0; i < seq.len; i++) {
      if (seq.t[i] === 1) { dpos[p] = i; dh[p] = hA[seq.a[i]]; p++; }
      else if (seq.t[i] === 2) { apos[q] = i; ah[q] = hB[seq.b[i]]; q++; }
    }
    const do_ = sortByHash(dh, 0, dCount), ao = sortByHash(ah, 0, aCount);
    const dai = new Int32Array(dCount), dhs = new Int32Array(dCount);
    for (let i = 0; i < dCount; i++) { dai[i] = seq.a[dpos[do_[i]]]; dhs[i] = dh[do_[i]]; }
    const bai = new Int32Array(aCount), ahs = new Int32Array(aCount);
    for (let j = 0; j < aCount; j++) { bai[j] = seq.b[apos[ao[j]]]; ahs[j] = ah[ao[j]]; }
    /* 组内是同哈希的行号集合，按行号 1:1 配对；res.to/from 以行号为下标，0 = 无配对 */
    groupScan(dhs, ahs, function (D, di, de, Ar, ai, ae) {
      const n = Math.min(de - di, ae - ai);
      if (n === 0) return;
      const la = dai.slice(di, de), lb = bai.slice(ai, ae);
      la.sort(numasc); lb.sort(numasc);
      for (let i = 0; i < n; i++) {
        const x = la[i], y = lb[i];
        if (kA[x] !== kB[y]) continue;
        if (res.to[x] === 0) { res.to[x] = y + 1; }
        if (res.from[y] === 0) { res.from[y] = x + 1; }
      }
    });
    let blocks = 0, open = false;
    for (let i = 0; i < seq.len; i++) {
      if (seq.t[i] === 2 && res.from[seq.b[i]] > 0) { if (!open) { blocks++; open = true; } }
      else if (seq.t[i] === 2) open = false;
      else if (seq.t[i] === 0 && i + 1 < seq.len && seq.t[i + 1] === 2) open = false;
    }
    res.blocks = blocks;
    return res;
  }

  function numasc(x, y) { return x - y; }

  function lineOf(arr, idx) {
    return idx >= 0 && idx < arr.length ? arr[idx] : '';
  }

  function applyPatch(a, patchText) {
    const src = splitLines(a == null ? '' : String(a));
    const linesOut = [];
    const A = src.lines;
    const hunks = [];
    const err = [];
    const rows = patchText.split(/\r?\n/);
    let cur = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.test(r)) {
        const m = r.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
        cur = { oldStart: parseInt(m[1], 10), oldCount: m[2] === undefined ? 1 : parseInt(m[2], 10), ops: [] };
        if (cur.oldCount === 0) cur.oldStart = cur.oldStart;
        hunks.push(cur);
      } else if (cur && (r.charAt(0) === ' ' || r.charAt(0) === '-' || r.charAt(0) === '+')) {
        cur.ops.push({ t: r.charAt(0), text: r.slice(1) });
      }
    }
    let ai = 0;
    let ok = true;
    for (let h = 0; h < hunks.length; h++) {
      const hk = hunks[h];
      const wantOld = hk.ops.filter(function (o) { return o.t === ' ' || o.t === '-'; }).length;
      let pos = -1;
      const target = hk.oldStart > 0 ? hk.oldStart - 1 : ai;
      for (let off = 0; off <= 200; off++) {
        for (const cand of (off === 0 ? [target] : [target - off, target + off])) {
          if (cand < 0 || cand > A.length) continue;
          if (matchHunk(A, cand, hk.ops, wantOld)) { pos = cand; break; }
        }
        if (pos >= 0) break;
      }
      if (pos < 0) {
        ok = false;
        err.push({ index: h, oldStart: hk.oldStart, reason: 'context mismatch' });
        continue;
      }
      while (ai < pos) { linesOut.push(A[ai]); ai++; }
      for (let o = 0; o < hk.ops.length; o++) {
        const op = hk.ops[o];
        if (op.t === ' ') { linesOut.push(A[ai]); ai++; }
        else if (op.t === '-') ai++;
        else linesOut.push(op.text);
      }
      ai = pos + wantOld;
    }
    while (ai < A.length) { linesOut.push(A[ai]); ai++; }
    const crlf = src.endings.indexOf('\r\n') >= 0;
    return { text: linesOut.join(crlf ? '\r\n' : '\n') + (src.trailingNewline && linesOut.length ? (crlf ? '\r\n' : '\n') : ''), ok: ok && err.length === 0, failedHunks: err, hunkCount: hunks.length };
  }

  function matchHunk(A, pos, ops, wantOld) {
    if (pos + wantOld > A.length) return false;
    let p = pos;
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.t === ' ' || o.t === '-') {
        if (p >= A.length || A[p] !== o.text) return false;
        p++;
      }
    }
    return true;
  }

  const SET_OPTS = {
    splitBy: '\n', dedupe: true, keepOrder: true, trim: true, caseSensitive: true,
    stripQuotes: false, topNPreview: 50, limit: 20000, normalizeNewlines: true
  };

  function setDiff(aText, bText, opts) {
    opts = norm(opts, SET_OPTS);
    const t0 = now();
    const rawA = explode(aText, opts);
    const rawB = explode(bText, opts);
    /* 用字符串键的 Map 做精确成员判断：哈希索引在有碰撞时会把“仅 A”误判成交集 */
    const cntA = new Map(), cntB = new Map();
    for (let i = 0; i < rawA.length; i++) cntA.set(rawA[i], (cntA.get(rawA[i]) || 0) + 1);
    for (let j = 0; j < rawB.length; j++) cntB.set(rawB[j], (cntB.get(rawB[j]) || 0) + 1);
    const seenA = new Set(), seenB = new Set();
    const onlyA = [], onlyB = [], both = [];
    let truncated = false;
    for (let i = 0; i < rawA.length; i++) {
      const s = rawA[i];
      if (opts.dedupe) {
        if (seenA.has(s)) continue;
        seenA.add(s);
      }
      if (cntB.has(s)) {
        if (both.length < opts.limit) both.push(s);
        else truncated = true;
      } else {
        if (onlyA.length < opts.limit) onlyA.push(s);
        else truncated = true;
      }
    }
    for (let j = 0; j < rawB.length; j++) {
      const s = rawB[j];
      if (opts.dedupe) {
        if (seenB.has(s)) continue;
        seenB.add(s);
      }
      if (!cntA.has(s)) {
        if (onlyB.length < opts.limit) onlyB.push(s);
        else truncated = true;
      }
    }
    return {
      onlyA: onlyA,
      onlyB: onlyB,
      both: both,
      union: cntA.size + cntB.size - intersectionSize(cntA, cntB),
      symmetric: symmetricSize(cntA, cntB),
      counts: {
        aTotal: rawA.length, aUnique: cntA.size, bTotal: rawB.length, bUnique: cntB.size,
        dupA: rawA.length - cntA.size, dupB: rawB.length - cntB.size
      },
      normalized: { trimmed: !!opts.trim, caseFolded: !opts.caseSensitive },
      freqA: topFreq(cntA, opts.topNPreview),
      freqB: topFreq(cntB, opts.topNPreview),
      truncated: truncated,
      timeMs: now() - t0
    };
  }

  function intersectionSize(cntA, cntB) {
    let n = 0;
    for (const k of cntA.keys()) if (cntB.has(k)) n++;
    return n;
  }

  function symmetricSize(cntA, cntB) {
    let n = 0;
    for (const [k, v] of cntA) if (!cntB.has(k)) n += v;
    for (const [k, v] of cntB) if (!cntA.has(k)) n += v;
    return n;
  }

  function explode(text, opts) {
    let out;
    if (opts.splitBy && opts.splitBy !== '\n') {
      out = String(text == null ? '' : text).split(opts.splitBy);
    } else {
      out = splitLines(text == null ? '' : String(text)).lines;
    }
    const res = [];
    for (let i = 0; i < out.length; i++) {
      let s = out[i];
      if (s == null) continue;
      if (opts.stripQuotes) s = stripQuotes(String(s));
      if (opts.trim) s = s.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
      if (!opts.caseSensitive) s = s.toLowerCase();
      res.push(s);
    }
    return res;
  }

  function stripQuotes(s) {
    s = s.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
    if (s.length > 1) {
      const c = s.charAt(0), last = s.charAt(s.length - 1);
      if ((c === '"' || c === "'") && c === last) {
        try { if (c === '"') return JSON.parse(s); } catch (e) { /* fallthrough */ }
        return s.slice(1, -1);
      }
    }
    return s;
  }

  function topFreq(cnt, top) {
    const list = [];
    for (const [line, count] of cnt) list.push({ line: line, count: count });
    list.sort(function (x, y) { return y.count - x.count; });
    return list.slice(0, top);
  }

  function merge3(base, ours, theirs, hooks) {
    const B = splitLines(String(base == null ? '' : base)).lines;
    const O = splitLines(String(ours == null ? '' : ours)).lines;
    const T = splitLines(String(theirs == null ? '' : theirs)).lines;
    const oRuns = align(B, O, DEF_OPTS, hooks).runs;
    const tRuns = align(B, T, DEF_OPTS, hooks).runs;
    const mapO = new Int32Array(B.length).fill(-1);
    const mapT = new Int32Array(B.length).fill(-1);
    const insO = new Array(B.length + 1), insT = new Array(B.length + 1);
    for (let i = 0; i <= B.length; i++) { insO[i] = []; insT[i] = []; }
    function fill(runs, map, ins, side) {
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (r.t === 'eq') for (let k = 0; k < r.n; k++) map[r.a + k] = r.b + k;
        else if (r.t === 'add') {
          const at = Math.min(B.length, r.a);
          for (let k = 0; k < r.n; k++) ins[at].push(side[r.b + k]);
        }
      }
    }
    fill(oRuns, mapO, insO, O);
    fill(tRuns, mapT, insT, T);
    const out = [];
    const conflicts = [];
    let clean = 0;
    function emitInsertions(p) {
      const a = insO[p], c = insT[p];
      if (!a.length && !c.length) return;
      if (!c.length) { for (const l of a) out.push(l); clean++; return; }
      if (!a.length) { for (const l of c) out.push(l); clean++; return; }
      if (a.join('\n') === c.join('\n')) { for (const l of a) out.push(l); clean++; return; }
      const start = out.length;
      out.push('<<<<<<< ours');
      for (const l of a) out.push(l);
      out.push('=======');
      for (const l of c) out.push('' + l);
      out.push('>>>>>>> theirs');
      conflicts.push({ line: start + 1, kind: 'insert', oursText: a.join('\n'), theirsText: c.join('\n'), baseText: '' });
    }
    for (let i = 0; i < B.length; i++) {
      emitInsertions(i);
      const ok = mapO[i], tk = mapT[i];
      const oursAlive = ok >= 0, theirsAlive = tk >= 0;
      const o = oursAlive ? O[ok] : null, t = theirsAlive ? T[tk] : null;
      if (oursAlive && theirsAlive) {
        if (o === t) { out.push(o); clean++; }
        else if (o === B[i]) out.push(t);
        else if (t === B[i]) out.push(o);
        else conflict(out, conflicts, 'both-modified', o, B[i], t, i);
      } else if (!oursAlive && !theirsAlive) {
        clean++;
      } else if (!oursAlive) {
        if (t === B[i]) clean++;
        else conflict(out, conflicts, 'delete-vs-modify', '', B[i], t, i);
      } else {
        if (o === B[i]) clean++;
        else conflict(out, conflicts, 'modify-vs-delete', o, B[i], '', i);
      }
    }
    emitInsertions(B.length);
    return {
      merged: out.join('\n') + (out.length ? '\n' : ''),
      lines: out,
      conflicts: conflicts,
      stats: { cleanLines: clean, conflictBlocks: conflicts.length, total: out.length },
      limits: 'line-based merge; adjacent-but-separate edits on the same line region may both be kept; no recursive/histogram merge'
    };
  }

  function conflict(out, list, kind, o, b, t, i) {
    const start = out.length;
    out.push('<<<<<<< ours');
    if (o !== '') out.push(o);
    out.push('=======');
    if (t !== '') out.push(t);
    out.push('>>>>>>> theirs');
    list.push({ line: start + 1, kind: kind, oursText: o, baseText: b, theirsText: t, baseLine: i + 1 });
  }

  function jsonDiff(aText, bText, opts, hooks) {
    opts = norm(opts, DEF_OPTS);
    const started = now();
    const res = {
      nodes: [], stats: { total: 0, added: 0, removed: 0, changed: 0, unchanged: 0, samePercent: 0, maxDepth: 0, typeMismatches: 0 },
      onlyChanged: [], error: null, maxDepthExceeded: false, truncated: false, meta: {}
    };
    const limit = opts.limitBytes;
    if (byteLenUnder(String(aText || ''), limit) > limit || byteLenUnder(String(bText || ''), limit) > limit) {
      return { tooLarge: true, hint: 'JSON above ' + (limit / 1048576).toFixed(1) + 'MB: use the streaming path or raise opts.limitBytes', nodes: [], stats: res.stats, onlyChanged: [] };
    }
    let av, bv;
    /* B05：用保真解析，超出 2^53 的整数用 BigInt 承载，
       否则 {"id":9007199254740992} 与 {"id":9007199254740993} 会被判成完全一致 */
    const parseSide = function (t) {
      if (SK.jsonx) return SK.jsonx.parse(t);
      try { return { value: JSON.parse(t), engine: 'native' }; } catch (e) { return { error: e }; }
    };
    const pa = parseSide(aText), pb = parseSide(bText);
    if (pa.error) { res.error = { side: 'a', message: pa.error.message }; return finishJson(res, started, opts); }
    if (pb.error) { res.error = { side: 'b', message: pb.error.message }; return finishJson(res, started, opts); }
    av = pa.value; bv = pb.value;
    if (pa.warning || pb.warning) res.warnings = [pa.warning || pb.warning];
    if (opts.sortBeforeCompare) { av = sortJson(av); bv = sortJson(bv); }
    const ign = compileGlobs(opts.ignorePaths);
    const work = [{ av: av, bv: bv, path: opts.rootPath || 'data', depth: 0 }];
    let processed = 0;
    while (work.length) {
      const w = work.pop();
      processed++;
      if (hooks && hooks.shouldStop && hooks.shouldStop()) { res.truncated = true; break; }
      if (processed % 8192 === 0 && hooks && hooks.progress) hooks.progress(processed, processed + work.length);
      if (res.nodes.length > opts.maxNodes) { res.truncated = true; break; }
      if (w.depth > res.stats.maxDepth) res.stats.maxDepth = w.depth;
      if (w.depth > opts.depthLimit) { res.maxDepthExceeded = true; continue; }
      compare(w.av, w.bv, w.path, w.depth, work, res, opts, ign);
    }
    return finishJson(res, started, opts);
  }

  function finishJson(res, started, opts) {
    const s = res.stats;
    s.typeChanged = s.typeChanged || 0;
    s.total = s.added + s.removed + s.changed + s.unchanged + s.typeChanged;
    res.stats.typeMismatches = s.typeChanged;
    s.samePercent = s.total ? (100 * s.unchanged) / s.total : 100;
    res.onlyChanged = res.nodes.filter(function (n) { return n.type !== 'same'; });
    res.meta = { matchBy: opts.matchBy || 'auto', depthLimit: opts.depthLimit, ignorePaths: opts.ignorePaths || null };
    res.timeMs = now() - started;
    return res;
  }

  function sortJson(v) {
    if (Array.isArray(v)) {
      const out = v.map(sortJson);
      out.sort(function (x, y) {
        const a = typeof x === 'object' && x ? JSON.stringify(x) : String(x);
        const b = typeof y === 'object' && y ? JSON.stringify(y) : String(y);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      return out;
    }
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = sortJson(v[k]); });
      return o;
    }
    return v;
  }

  function compileGlobs(patterns) {
    if (!patterns || !patterns.length) return null;
    const list = [];
    for (let i = 0; i < patterns.length; i++) {
      const p = String(patterns[i]).trim();
      if (!p) continue;
      const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^\\[\\]]*').replace(/\u0001/g, '.*').replace(/\?/g, '[^\\[\\]]') + '$');
      /* 记住原始写法：带点但不带通配符的（a.ts）额外按「路径后缀」匹配，
         否则用户写 a.ts 想忽略 data.a.ts 时完全不生效。 */
      re.__raw = p;
      list.push(re);
    }
    return list.length ? list : null;
  }

  function isIgnored(ign, pathNorm) {
    if (!ign) return false;
    for (let i = 0; i < ign.length; i++) {
      const re = ign[i];
      if (re.test(pathNorm)) return true;
      const raw = re.__raw;
      if (raw && !/[*?]/.test(raw) && raw.indexOf('.') > 0 && pathNorm.length > raw.length) {
        if (pathNorm.slice(-(raw.length + 1)) === '.' + raw) return true;
      }
    }
    return false;
  }

  function normPath(p) {
    return p.replace(/\[\d+\]/g, '[]');
  }

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  const ID_KEYS = ['id', 'ID', 'Id', '_id', 'key', 'code', 'sku', 'orderNo', 'name', 'index', 'uuid', 'md5', 'sha1'];

  function detectArrayKey(av, bv, opts) {
    if (opts.matchBy && opts.matchBy !== 'auto' && opts.matchBy !== true) return String(opts.matchBy);
    const arr = (av && av.length >= bv.length ? av : bv) || [];
    const cand = [];
    for (let i = 0; i < arr.length && i < 20; i++) {
      const o = arr[i];
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const k in o) if (ID_KEYS.indexOf(k) >= 0 && cand.indexOf(k) < 0) cand.push(k);
      }
    }
    const pools = [av, bv];
    for (let c = 0; c < cand.length; c++) {
      let ok = true;
      for (let p = 0; p < pools.length && ok; p++) {
        const seen = Object.create(null);
        const list = pools[p] || [];
        for (let i = 0; i < list.length; i++) {
          const o = list[i];
          if (!o || typeof o !== 'object' || !(opts.matchBy in o ? true : Object.prototype.hasOwnProperty.call(o, cand[c]))) { ok = false; break; }
          const v = o[cand[c]];
          if (v === undefined || v === null || typeof v === 'object') { ok = false; break; }
          const s = typeof v + ':' + v;
          if (seen[s]) { ok = false; break; }
          seen[s] = 1;
        }
      }
      if (ok) return cand[c];
    }
    return null;
  }

  function compare(av, bv, path, depth, work, res, opts, ign) {
    const np = normPath(path);
    /* 忽略路径支持两种写法：全路径（data.meta.ts）或裸字段名（ts） */
    if (isIgnored(ign, np) || isIgnored(ign, lastKey(path))) { push(res, path, lastKey(path), 'same', av, bv, depth, null, 'ignored'); res.stats.unchanged++; return; }
    const ta = typeOf(av), tb = typeOf(bv);
    if (opts.treatNumericStringEqual && ((ta === 'string' && tb === 'number') || (ta === 'number' && tb === 'string'))) {
      if (String(av) === String(bv)) { push(res, path, lastKey(path), 'same', av, bv, depth, null, ta + '/' + tb); res.stats.unchanged++; return; }
    }
    if (ta !== tb) {
      push(res, path, lastKey(path), 'type-changed', av, bv, depth, ta, tb);
      res.stats.changed++; res.stats.typeChanged++;
      return;
    }
    if (ta === 'array') { compareArrays(av, bv, path, depth, work, res, opts, ign); return; }
    if (ta === 'object') { compareObjects(av, bv, path, depth, work, res, opts, ign); return; }
    if (av === bv) { push(res, path, lastKey(path), 'same', av, bv, depth, ta, tb); res.stats.unchanged++; return; }
    push(res, path, lastKey(path), 'changed', av, bv, depth, ta, tb);
    res.stats.changed++;
  }

  function compareObjects(av, bv, path, depth, work, res, opts, ign) {
    const keys = Object.create(null);
    const ka = Object.keys(av), kb = Object.keys(bv);
    let k;
    for (let i = 0; i < ka.length; i++) keys[ka[i]] = 1;
    for (let j = 0; j < kb.length; j++) keys[kb[j]] = 1;
    const all = Object.keys(keys);
    all.sort();
    for (let x = 0; x < all.length; x++) {
      k = all[x];
      const childPath = path + '.' + k;
      const ncp = normPath(childPath);
      const ina = Object.prototype.hasOwnProperty.call(av, k), inb = Object.prototype.hasOwnProperty.call(bv, k);
      if (isIgnored(ign, ncp) || isIgnored(ign, k)) { push(res, childPath, k, 'same', ina ? av[k] : undefined, inb ? bv[k] : undefined, depth + 1, null, 'ignored'); res.stats.unchanged++; continue; }
      if (ina && inb) work.push({ av: av[k], bv: bv[k], path: childPath, depth: depth + 1 });
      else if (ina) { push(res, childPath, k, 'removed', av[k], undefined, depth + 1, typeOf(av[k]), null); res.stats.removed++; }
      else { push(res, childPath, k, 'added', undefined, bv[k], depth + 1, null, typeOf(bv[k])); res.stats.added++; }
    }
  }

  function compareArrays(av, bv, path, depth, work, res, opts, ign) {
    const key = detectArrayKey(av, bv, opts);
    if (opts.arrayAsSet || key) {
      const mapA = Object.create(null), mapB = Object.create(null);
      let usable = true;
      const getKey = function (o, map) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
        if (key) {
          const v = o[key];
          if (v === undefined || v === null || typeof v === 'object') return null;
          return String(v);
        }
        const s = safeJson(o);
        return s === null ? null : 'h' + fnv1a(s);
      };
      for (let i = 0; i < av.length; i++) {
        const k = getKey(av[i], mapA);
        if (k === null) { usable = false; break; }
        if (mapA[k]) { usable = false; break; }
        mapA[k] = i;
      }
      if (usable) for (let j = 0; j < bv.length; j++) {
        const k = getKey(bv[j], mapB);
        if (k === null || mapB[k]) { usable = false; break; }
        mapB[k] = j;
      }
      if (usable) {
        res.arrayKeyHeuristic = res.arrayKeyHeuristic || key;
        const seenB = Object.create(null);
        const order = [];
        for (const k in mapA) order.push([k, mapA[k]]);
        order.sort(function (x, y) { return x[1] - y[1]; });
        const pairs = [];
        for (let i = 0; i < order.length; i++) {
          const k = order[i][0], ai = order[i][1];
          if (Object.prototype.hasOwnProperty.call(mapB, k)) { pairs.push([ai, mapB[k]]); seenB[k] = 1; }
          else { push(res, path + '[' + ai + ']', lastKey(path), 'removed', av[ai], undefined, depth + 1, typeOf(av[ai]), null); res.stats.removed++; }
        }
        for (const k in mapB) if (!seenB[k]) {
          push(res, path + '[' + mapB[k] + ']', lastKey(path), 'added', undefined, bv[mapB[k]], depth + 1, null, typeOf(bv[mapB[k]]));
          res.stats.added++;
        }
        for (let p = 0; p < pairs.length; p++) {
          const ai = pairs[p][0], bi = pairs[p][1];
          if (ai !== bi) {
            push(res, path + '[' + ai + ']->[' + bi + ']', lastKey(path), 'moved', av[ai], bv[bi], depth + 1, 'array', 'array', key);
          }
          work.push({ av: av[ai], bv: bv[bi], path: path + '[' + bi + ']', depth: depth + 1 });
        }
        return;
      }
    }
    const n = Math.max(av.length, bv.length);
    for (let i = 0; i < n; i++) {
      const cp = path + '[' + i + ']';
      if (i >= av.length) { push(res, cp, lastKey(path), 'added', undefined, bv[i], depth + 1, null, typeOf(bv[i])); res.stats.added++; }
      else if (i >= bv.length) { push(res, cp, lastKey(path), 'removed', av[i], undefined, depth + 1, typeOf(av[i]), null); res.stats.removed++; }
      else work.push({ av: av[i], bv: bv[i], path: cp, depth: depth + 1 });
    }
  }

  function safeJson(o) {
    try { return SK.jsonx && SK.jsonx.dump ? SK.jsonx.dump(o, 0) : JSON.stringify(o); } catch (e) { return null; }
  }

  function lastKey(path) {
    const m = /\[([^\]]*)\]$/.exec(path);
    if (m) return m[1];
    const i = path.lastIndexOf('.');
    return i < 0 ? path : path.slice(i + 1);
  }

  function push(res, path, key, type, before, after, depth, beforeType, afterType) {
    res.nodes.push({
      path: path, key: key, type: type,
      before: type === 'added' ? undefined : before,
      after: type === 'removed' ? undefined : after,
      beforeType: beforeType == null ? (before === undefined ? undefined : typeOf(before)) : beforeType,
      afterType: afterType == null ? (after === undefined ? undefined : typeOf(after)) : afterType,
      depth: depth,
      arrayKeyHeuristic: type === 'moved' ? (typeof beforeType === 'string' ? null : null) : null
    });
  }

  function jsonSummary(a, b, opts) {
    const r = jsonDiff(a, b, opts);
    if (r.tooLarge) return ['[too large for structural diff: ' + r.hint + ']'];
    if (r.error) return ['[parse error in ' + r.error.side + ': ' + r.error.message + ']'];
    const out = [];
    const list = r.onlyChanged;
    for (let i = 0; i < list.length && i < (opts && opts.maxLines ? opts.maxLines : 500); i++) {
      const n = list[i];
      if (n.type === 'added') out.push('+ ' + n.path + ' = ' + brief(n.after));
      else if (n.type === 'removed') out.push('- ' + n.path + ' = ' + brief(n.before));
      else if (n.type === 'moved') out.push('~ ' + n.path + ' (moved)');
      else if (n.type === 'type-changed') out.push('! ' + n.path + ': ' + n.beforeType + ' -> ' + n.afterType + ' (' + brief(n.before) + ' -> ' + brief(n.after) + ')');
      else out.push('~ ' + n.path + ': ' + brief(n.before) + ' -> ' + brief(n.after));
    }
    if (list.length > out.length) out.push('... ' + (list.length - out.length) + ' more');
    out.unshift('# ' + list.length + ' changed nodes, ' + r.stats.samePercent.toFixed(1) + '% identical' + (r.arrayKeyHeuristic ? ', matched by "' + r.arrayKeyHeuristic + '"' : ''));
    return out;
  }

  function brief(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'string') return v.length > 60 ? JSON.stringify(v.slice(0, 57) + '...') : JSON.stringify(v);
    if (t === 'object') return Array.isArray(v) ? '[array ' + v.length + ']' : '{object ' + Object.keys(v).length + '}';
    return String(v);
  }

  function now() {
    const p = root.performance;
    return p && p.now ? p.now() : Date.now();
  }

  const api = {
    fnv1a: fnv1a,
    splitLines: splitLines,
    lines: function (a, b, opts, hooks) {
      opts = norm(opts, DEF_OPTS);
      const t0 = now();
      const rawA = splitLines(a == null ? '' : String(a));
      const rawB = splitLines(b == null ? '' : String(b));
      let A = rawA.lines, B = rawB.lines;
      const crA = hasCr(rawA.endings), crB = hasCr(rawB.endings);
      const stripCr = opts.normalizeNewlines && (crA || crB);
      if (opts.ignoreBlankLines) {
        A = A.filter(function (l) { return l.trim() !== ''; });
        B = B.filter(function (l) { return l.trim() !== ''; });
      }
      opts.largeMode = A.length + B.length > opts.largeThreshold;
      const al = alignSeq(A, B, opts, hooks);
      const moves = opts.largeMode ? { blocks: 0, from: null, to: null } : findMovePairs(al, A, B);
      const events = buildEvents(al.seq, opts, al.kA, al.kB, A, B, { movedFrom: moves.from, movedTo: moves.to, blocks: moves.blocks });
      const tr = { flag: false };
      const hunks = buildHunksFinal(events, A, B, opts, moves, tr);
      let equal = 0, del = 0, add = 0, mod = 0;
      for (let i = 0; i < events.length; i++) {
        const t = events[i].t;
        if (t === 0) equal++; else if (t === 1) del++; else if (t === 2) add++; else mod++;
      }
      const denom = A.length + B.length;
      const stats = {
        added: add + mod, removed: del + mod, unchanged: equal, changedLines: mod,
        similarity: denom === 0 ? 1 : Math.max(0, Math.min(1, (2 * equal + mod) / denom)),
        movedBlocks: opts.largeMode ? 0 : moves.blocks,
        identical: denom === 0 ? true : (equal === A.length && A.length === B.length),
        aLines: A.length, bLines: B.length,
        timeMs: now() - t0,
        approximated: al.approximated,
        truncated: tr.flag,
        maxHunks: opts.maxHunks
      };
      return {
        hunks: hunks, stats: stats,
        meta: { ignoreWhitespace: opts.ignoreWhitespace, ignoreCase: opts.ignoreCase, stripCr: stripCr },
        reason: al.reason || null,
        events: events, align: al, A: A, B: B
      };
    },
    json: jsonDiff,
    jsonSummary: jsonSummary,
    setDiff: setDiff,
    similarity: similarity,
    intra: intraDiff,
    commonPrefixSuffix: commonPrefixSuffix,
    merge3: merge3,
    patch: function (a, b, opts, hooks) {
      opts = norm(opts, DEF_OPTS);
      const rawA = splitLines(a == null ? '' : String(a));
      const rawB = splitLines(b == null ? '' : String(b));
      let A = rawA.lines, B = rawB.lines;
      if (opts.ignoreBlankLines) {
        A = A.filter(function (l) { return l.trim() !== ''; });
        B = B.filter(function (l) { return l.trim() !== ''; });
      }
      opts.largeMode = false;
      opts.pairModifications = false;
      const al = alignSeq(A, B, opts, hooks);
      const context = Math.max(0, opts.context | 0);
      const runs = al.runs;

      /* run 序列切成 hunk：变更簇之间隔着 > 2*context 的公共块时拆分；
         前后 context 在建簇/拆簇时从相邻 eq run 的末尾/开头截取 */
      const clusters = [];
      let cur = null;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (r.t === 'eq') {
          if (cur && r.n > 2 * context) { cur.postFrom = r.a; cur.postN = context; cur = null; }
          else if (cur) cur.segs.push(r);
          continue;
        }
        if (!cur) {
          cur = { preFrom: 0, preN: 0, postFrom: 0, postN: 0, segs: [] };
          clusters.push(cur);
          const prev = i > 0 ? runs[i - 1] : null;
          if (prev && prev.t === 'eq') {
            cur.preN = Math.min(context, prev.n);
            cur.preFrom = prev.a + prev.n - cur.preN;
          }
        }
        cur.segs.push(r);
      }

      const out = [];
      out.push('--- ' + (opts.fileAName || 'a/file'));
      out.push('+++ ' + (opts.fileBName || 'b/file'));
      for (let g = 0; g < clusters.length; g++) {
        if (g >= opts.maxHunks) {
          out.push('# truncated after ' + opts.maxHunks + ' hunks');
          break;
        }
        const cl = clusters[g];
        /* 惯例：每个连续变更段内先 - 后 + 输出（对齐可能给出 add 在前的分组）。
           只调整展示顺序，' ' 与 '-'、'+' 各自的相对顺序不变，不影响补丁语义 */
        const segs = [];
        let stretch = [];
        const flushStretch = function () {
          for (let s = 0; s < stretch.length; s++) if (stretch[s].t === 'del') segs.push(stretch[s]);
          for (let s = 0; s < stretch.length; s++) if (stretch[s].t === 'add') segs.push(stretch[s]);
          stretch = [];
        };
        for (let s = 0; s < cl.segs.length; s++) {
          if (cl.segs[s].t === 'eq') { flushStretch(); segs.push(cl.segs[s]); }
          else stretch.push(cl.segs[s]);
        }
        flushStretch();
        const body = [];
        let oldCount = cl.preN + cl.postN, newCount = cl.preN + cl.postN;
        let firstOld = cl.preN ? cl.preFrom : -1;
        let firstNew = cl.preN ? cl.preFrom : -1;
        let lastOld = cl.preN ? cl.preFrom + cl.preN - 1 : -1;
        let lastNew = cl.preN ? cl.preFrom + cl.preN - 1 : -1;
        for (let k = 0; k < cl.preN; k++) body.push(' ' + lineOf(A, cl.preFrom + k));
        for (let s = 0; s < segs.length; s++) {
          const r = segs[s];
          if (r.t === 'eq') {
            for (let k = 0; k < r.n; k++) body.push(' ' + lineOf(A, r.a + k));
            oldCount += r.n; newCount += r.n;
            if (firstOld < 0) firstOld = r.a;
            if (firstNew < 0) firstNew = r.b;
            lastOld = r.a + r.n - 1; lastNew = r.b + r.n - 1;
          } else if (r.t === 'del') {
            for (let k = 0; k < r.n; k++) body.push('-' + lineOf(A, r.a + k));
            oldCount += r.n;
            if (firstOld < 0) firstOld = r.a;
            lastOld = r.a + r.n - 1;
          } else {
            for (let k = 0; k < r.n; k++) body.push('+' + lineOf(B, r.b + k));
            newCount += r.n;
            if (firstNew < 0) firstNew = r.b;
            lastNew = r.b + r.n - 1;
          }
        }
        for (let k = 0; k < cl.postN; k++) {
          body.push(' ' + lineOf(A, cl.postFrom + k));
        }
        if (cl.postN) { lastOld = cl.postFrom + cl.postN - 1; lastNew = cl.postFrom + cl.postN - 1; }
        /* 纯增/纯删的 hunk：缺失的一侧从“插入点前一行”计 0 行 */
        const oldStart = firstOld >= 0 ? firstOld + 1 : firstNew;
        const newStart = firstNew >= 0 ? firstNew + 1 : firstOld;
        out.push('@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@');
        for (let l = 0; l < body.length; l++) out.push(body[l]);
        const endA = !rawA.trailingNewline && lastOld === A.length - 1;
        const endB = !rawB.trailingNewline && lastNew === B.length - 1;
        if (endA || endB) out.push('\\ No newline at end of file');
      }
      let text = out.join('\n') + '\n';
      if (al.approximated) text = '# approximated: ' + al.reason + '\n' + text;
      return text;
    },
    applyPatch: applyPatch,
    _internals: { align: align, lcsRuns: lcsRuns, splitLines: splitLines, buildIndex: null }
  };

  SK.diff = api;
})(typeof self !== 'undefined' ? self : globalThis);
