(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el, esc } = SK.dom;

  const BUFFER = 12;
  const WARMUP = 140;
  const INDEX_BUDGET = 6 * 1024 * 1024;

  function create(host, opts) {
    opts = opts || {};
    const scroll = el('div', { class: 'v-scroll', tabindex: '0' });
    const spacer = el('div', { class: 'v-spacer' });
    const rows = el('div', { class: 'v-rows' });
    scroll.appendChild(spacer);
    scroll.appendChild(rows);
    const bar = el('div', { class: 'v-bar' });
    const barText = el('span', { class: 'v-bar-text' });
    const foldCtl = el('span', { class: 'v-foldctl', style: { display: 'none' } }, [
      el('button', { class: 'v-fbtn', text: '⊟ 折叠', title: '折叠所有代码块（仅 JS / JSON）', onClick: foldAll }),
      el('button', { class: 'v-fbtn', text: '⊞ 展开', title: '展开所有折叠的代码块', onClick: unfoldAll }),
    ]);
    bar.appendChild(barText);
    bar.appendChild(foldCtl);
    const empty = el('div', { class: 'v-empty', text: opts.placeholder || '暂无内容' });
    host.classList.add('viewer');
    host.appendChild(scroll);
    host.appendChild(bar);
    host.appendChild(empty);

    let text = '';
    let lines = null;
    let offsets = [0];
    let scanned = 0;
    let indexed = false;
    let rowH = 22;
    let lang = opts.lang || 'plain';
    let filtered = null;
    let matchInfo = null;
    let dirty = true;
    let maxLen = 0;
    let chW = 7.6;
    let onSel = opts.onSelect || null;

    /* ---------- 代码折叠（{ [ 开头的行可折叠，懒求值结束行） ---------- */
    let folds = new Map(); /* startIdx -> endIdx（已折叠） */
    let foldEnds = new Map(); /* startIdx -> endIdx 缓存（含未折叠的） */
    let foldList = null; /* 可见行 -> 源行映射；null = 未折叠任何块 */

    function foldEnabled() {
      if (lang !== 'js' && lang !== 'json') return false;
      if (opts.noFold) return false;
      if (lines) return lines.length <= 400000;
      return indexed && text.length <= 8 * 1024 * 1024;
    }

    function srcOf(i) {
      let s = foldList ? foldList[i] : i;
      if (filtered) s = filtered[s];
      return s;
    }

    /* 该行是否以 { 或 [ 结尾（容忍尾随注释；字符串里的大括号属少数误报，折叠结果用户可再展开） */
    function lineOpens(line) {
      const t = stripTrailingComment(String(line).trim());
      if (t.endsWith('{') || t.endsWith('[')) return t.slice(-1);
      return '';
    }

    function stripTrailingComment(s) {
      let q = '';
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) {
          if (c === '\\') i++;
          else if (c === q) q = '';
          continue;
        }
        if (c === '"' || c === "'" || c === '`') q = c;
        else if (c === '/' && s[i + 1] === '/') return s.slice(0, i);
        else if (c === '/' && s[i + 1] === '*') return s.slice(0, i);
      }
      return s;
    }

    /* 从 start 行向下找配对的收括号行；跳过字符串与注释 */
    function findFoldEnd(start) {
      if (foldEnds.has(start)) return foldEnds.get(start);
      const total = fullCount();
      const opener = lineOpens(raw(start));
      if (!opener) return -1;
      const closeCh = opener === '{' ? '}' : ']';
      let depth = 0;
      const LIMIT = Math.min(total, start + 200000);
      for (let i = start; i < LIMIT; i++) {
        const line = raw(i);
        let q = '';
        for (let j = 0; j < line.length; j++) {
          const c = line[j];
          if (q) {
            if (c === '\\') j++;
            else if (c === q) q = '';
            continue;
          }
          if (c === '"' || c === "'" || c === '`') {
            q = c;
            continue;
          }
          if (c === '/' && line[j + 1] === '/') break;
          if (c === '/' && line[j + 1] === '*') {
            const end = line.indexOf('*/', j + 2);
            j = end >= 0 ? end + 1 : line.length;
            continue;
          }
          if (c === opener) depth++;
          else if (c === closeCh) {
            depth--;
            if (depth === 0) {
              foldEnds.set(start, i);
              return i;
            }
          }
        }
      }
      return -1;
    }

    function fullCount() {
      if (lines) return lines.length;
      if (indexed) return offsets.length;
      return offsets.length + Math.max(0, Math.round((text.length - scanned) / avgLen()));
    }

    function rebuildFoldList() {
      if (!folds.size) {
        foldList = null;
        return;
      }
      const total = fullCount();
      const out = [];
      let i = 0;
      while (i < total) {
        out.push(i);
        const end = folds.get(i);
        i = end !== undefined && end > i ? end + 1 : i + 1;
      }
      foldList = out;
    }

    function toggleFold(start) {
      if (folds.has(start)) folds.delete(start);
      else {
        const end = findFoldEnd(start);
        if (end < 0 || end <= start) return;
        folds.set(start, end);
      }
      rebuildFoldList();
      render();
    }

    function foldAll() {
      if (!foldEnabled()) return;
      const total = fullCount();
      folds = new Map();
      let i = 0;
      while (i < total) {
        if (lineOpens(raw(i))) {
          const end = findFoldEnd(i);
          if (end > i) {
            folds.set(i, end);
            i = end + 1;
            continue;
          }
        }
        i++;
      }
      rebuildFoldList();
      render();
    }

    function unfoldAll() {
      folds = new Map();
      rebuildFoldList();
      render();
    }

    function measure() {
      const probe = el('div', { class: 'vrow', text: 'M' });
      rows.appendChild(probe);
      const h = probe.offsetHeight;
      if (h > 8) rowH = h;
      const span = el('span', { text: '0123456789abcdefghij' });
      probe.appendChild(span);
      const w = span.getBoundingClientRect().width / 20;
      if (w > 2) chW = w;
      probe.remove();
    }

    function raw(i) {
      if (lines) return lines[i] === undefined ? '' : lines[i];
      if (!offsets) return '';
      if (!indexed && i >= offsets.length) ensureIndexed(i + 2);
      if (i >= offsets.length) return '';
      const s = offsets[i];
      const e = i + 1 < offsets.length ? offsets[i + 1] - 1 : text.length;
      let out = text.slice(s, e);
      if (out.charCodeAt(out.length - 1) === 13) out = out.slice(0, -1);
      return out;
    }

    function totalLines() {
      if (foldList) return foldList.length;
      if (filtered) return filtered.length;
      if (!offsets) return 0;
      if (lines) return lines.length;
      if (indexed) return offsets.length;
      return offsets.length + Math.max(0, Math.round((text.length - scanned) / avgLen()));
    }

    function avgLen() {
      if (offsets.length < 2) return 40;
      return Math.max(4, scanned / (offsets.length - 1));
    }

    function ensureIndexed(needLines) {
      if (indexed || lines) {
        indexed = true;
        return;
      }
      const from = scanned;
      const stopChar = Math.min(text.length, from + INDEX_BUDGET);
      let i = from;
      if (offsets.length === 0) offsets.push(0);
      while (i < stopChar) {
        const nl = text.indexOf('\n', i);
        if (nl < 0) {
          i = text.length;
          break;
        }
        const len = nl - i + 1;
        if (len > maxLen) maxLen = len;
        i = nl + 1;
        offsets.push(i);
      }
      scanned = i >= text.length ? text.length : i;
      if (scanned >= text.length) {
        indexed = true;
        while (offsets.length > 1 && offsets[offsets.length - 1] >= text.length) offsets.pop();
      }
      if (needLines && !indexed && offsets.length < needLines) ensureIndexed(0);
    }

    function reset(textContent, options) {
      options = options || {};
      text = textContent == null ? '' : String(textContent);
      lines = options.lines || null;
      offsets = lines ? null : [0];
      scanned = lines ? 0 : 0;
      indexed = !!lines;
      maxLen = 0;
      filtered = null;
      matchInfo = null;
      folds = new Map();
      foldEnds = new Map();
      foldList = null;
      if (options.lang) lang = options.lang;
      if (!lines) ensureIndexed(0);
      else {
        for (let i = 0; i < Math.min(lines.length, 5000); i++) if (lines[i].length > maxLen) maxLen = lines[i].length;
      }
      dirty = true;
      if (!text) {
        offsets = [];
        indexed = true;
      }
      scroll.scrollTop = 0;
      render();
    }

    function render() {
      const count = totalLines();
      empty.style.display = count === 0 ? '' : 'none';
      spacer.style.height = Math.max(1, count * rowH) + 'px';
      const width = Math.min(4000000, Math.max(200, (maxLen || 40) * chW + 90));
      spacer.style.minWidth = width + 'px';
      rows.style.minWidth = width + 'px';
      const top = scroll.scrollTop;
      let first = Math.floor(top / rowH) - BUFFER;
      if (first < 0) first = 0;
      let last = first + Math.ceil(scroll.clientHeight / rowH) + BUFFER * 2;
      if (last > count) last = count;
      if (last < first) last = first;
      const frag = document.createDocumentFragment();
      const state = SK.hl.newLineState();
      const canFold = foldEnabled();
      let warm = Math.max(0, first - WARMUP);
      if (warm < first) {
        const limit = Math.min(first, warm + 900);
        for (let i = warm; i < limit; i++) SK.hl.line(raw(srcOf(i)), lang, state);
      }
      for (let i = first; i < last; i++) {
        const src = srcOf(i);
        const content = raw(src);
        const res = SK.hl.line(content, lang, state);
        const hit = matchInfo && matchInfo.lines.has(i);
        const row = el('div', { class: 'vrow' + (hit ? ' hit' : '') + (filtered ? ' filtered' : ''), style: { height: rowH + 'px' } });
        row.appendChild(el('span', { class: 'vnum', text: String(src + 1) }));
        /* 折叠标记：可折叠行显示 ▾，已折叠显示 ▸（徽标加在行尾） */
        if (canFold) {
          const openable = lineOpens(content);
          const folded = folds.has(src);
          if (openable || folded) {
            const marker = el('button', { class: 'vfold', text: folded ? '▸' : '▾', title: folded ? '展开这一块' : '折叠这一块' });
            marker.addEventListener('click', (e) => {
              e.stopPropagation();
              toggleFold(src);
            });
            row.appendChild(marker);
          } else {
            row.appendChild(el('span', { class: 'vfold none', text: '' }));
          }
        }
        row.appendChild(el('span', { class: 'vtext', html: res.html || ' ' }));
        if (folds.has(src)) {
          const badge = el('span', { class: 'vfold-badge', text: '⋯ ' + (folds.get(src) - src) + ' 行', title: '点击展开' });
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFold(src);
          });
          row.appendChild(badge);
        }
        if (onSel) row.addEventListener('click', () => onSel({ line: src, text: content, lang }));
        frag.appendChild(row);
      }
      rows.replaceChildren(frag);
      rows.style.transform = 'translateY(' + first * rowH + 'px)';
      dirty = false;
      updateBar();
    }

    function updateBar() {
      const count = totalLines();
      const bytes = lines ? lines.reduce((a, b) => a + b.length + 1, 0) : text.length;
      const parts = [
        SK.dom.fmtNum(count) + (indexed || lines ? ' 行' : ' 行 (≈)'),
        SK.dom.fmtBytes(bytes),
      ];
      if (foldList) parts.push('已折叠 ' + folds.size + ' 块');
      if (filtered) parts.push('筛选 ' + SK.dom.fmtNum(filtered.length) + ' 行');
      if (!indexed) parts.push('已索引 ' + Math.round((scanned / Math.max(1, text.length)) * 100) + '%');
      barText.textContent = parts.join(' · ');
      foldCtl.style.display = foldEnabled() && count > 6 ? '' : 'none';
      bar.style.display = count ? '' : 'none';
    }

    scroll.addEventListener(
      'scroll',
      SK.dom.raf(() => {
        const count = totalLines();
        if (!indexed && count - Math.floor(scroll.scrollTop / rowH) < 4000) ensureIndexed(0);
        render();
      }),
      { passive: true }
    );

    const api = {
      el: host,
      scroll,
      get text() {
        return text;
      },
      get lines() {
        return lines;
      },
      reset,
      setLang(l) {
        lang = l;
        render();
      },
      get lang() {
        return lang;
      },
      count: totalLines,
      lineAt: raw,
      line(index) {
        return raw(srcOf(index));
      },
      selectLine(index) {
        const target = index * rowH - scroll.clientHeight / 2;
        scroll.scrollTop = Math.max(0, target);
        render();
        host.classList.add('flash');
        setTimeout(() => host.classList.remove('flash'), 500);
      },
      clear() {
        reset('', {});
      },
      filter(query, options) {
        options = options || {};
        if (foldList) unfoldAll();
        if (!query) {
          filtered = null;
          render();
          return { count: totalLines(), scanned: totalLines() };
        }
        const re = buildRe(query, options);
        const out = [];
        const limit = options.limit || 200000;
        const total = totalLines();
        for (let i = 0; i < total && out.length < limit; i++) {
          if (re.test(raw(i))) out.push(i);
        }
        filtered = out;
        render();
        return { count: out.length, total, truncated: out.length >= limit };
      },
      unfilter() {
        filtered = null;
        render();
      },
      find(query, options) {
        options = options || {};
        if (foldList) unfoldAll();
        if (!query) {
          matchInfo = null;
          render();
          return { count: 0 };
        }
        const re = buildRe(query, options);
        const total = totalLines();
        const found = [];
        const set = new Set();
        const limit = options.limit || 20000;
        for (let i = 0; i < total && found.length < limit; i++) {
          const src = i;
          if (re.test(raw(src))) {
            found.push(i);
            set.add(i);
          }
        }
        matchInfo = { lines: set, hits: found, query };
        render();
        if (found.length) api.selectLine(found[0]);
        return { count: found.length, truncated: found.length >= limit, first: found.length ? found[0] + 1 : 0 };
      },
      nextHit(dir) {
        if (!matchInfo || !matchInfo.hits.length) return;
        const cur = Math.floor((scroll.scrollTop + scroll.clientHeight / 2) / rowH);
        let idx = -1;
        if (dir > 0) {
          for (let i = 0; i < matchInfo.hits.length; i++)
            if (matchInfo.hits[i] > cur) {
              idx = i;
              break;
            }
          if (idx < 0) idx = 0;
        } else {
          for (let i = matchInfo.hits.length - 1; i >= 0; i--)
            if (matchInfo.hits[i] < cur) {
              idx = i;
              break;
            }
          if (idx < 0) idx = matchInfo.hits.length - 1;
        }
        api.selectLine(matchInfo.hits[idx]);
        return { at: idx + 1, of: matchInfo.hits.length };
      },
      /* B02 修复：导出语义三分离
       *   getText()         —— 原始全文，永不受折叠 / 筛选 / 滚动影响（复制、下载、发送、钉住都用它）
       *   getFilteredText() —— 筛选结果；无筛选时等于全文（需要显式调用才会拿到）
       *   getDisplayText()  —— 当前屏幕呈现（含折叠省略），仅用于「复制当前视图」这类明确要求
       */
      getText() {
        if (lines) return lines.join('\n');
        return text;
      },
      getFilteredText() {
        if (!filtered) return api.getText();
        return filtered.map((i) => raw(i)).join('\n');
      },
      getDisplayText() {
        if (foldList) return foldList.map((i) => raw(i)).join('\n');
        return api.getFilteredText();
      },
      get isFiltered() {
        return !!filtered;
      },
      get isFolded() {
        return !!foldList;
      },
      foldAll,
      unfoldAll,
      get foldCount() {
        return folds.size;
      },
      toggleFoldAt(start) {
        toggleFold(start);
      },
      getVisibleRange() {
        const first = Math.floor(scroll.scrollTop / rowH);
        return { first, last: Math.min(totalLines(), first + Math.ceil(scroll.clientHeight / rowH)) };
      },
      refresh() {
        measure();
        render();
      },
      onSelect(fn) {
        onSel = fn;
      },
    };

    measure();
    render();
    return api;
  }

  /* B13 修复：这里只用 test()，带 g 标志会让 lastIndex 跨行残留，导致隔行漏匹配 */
  function buildRe(query, options) {
    let src;
    if (options.regex) src = query;
    else src = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return new RegExp(src, options.caseSensitive ? '' : 'i');
    } catch (e) {
      return new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
  }

  SK.viewer = { create };
})(typeof window !== 'undefined' ? window : globalThis);
