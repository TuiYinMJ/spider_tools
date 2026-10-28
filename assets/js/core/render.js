(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el, esc, fmtBytes, fmtNum, fmtMs, download, copy } = SK.dom;

  const views = {};

  function view(name, fn) {
    views[name] = fn;
  }

  function normalize(res) {
    if (res === null || res === undefined) return { error: '无结果' };
    if (typeof res === 'string') return { outputs: [{ label: '结果', text: res }] };
    if (Array.isArray(res)) return { outputs: [{ label: '结果', text: res.join('\n') }] };
    if (res.error) return res;
    const out = Object.assign({}, res);
    if (!out.outputs) out.outputs = [];
    if (res.text !== undefined || res.lang || res.view) out.outputs.unshift({ label: res.tabLabel || '结果', text: res.text || '', lang: res.lang, view: res.view, data: res.data });
    if (res.code !== undefined) out.outputs.unshift({ label: res.codeLabel || '代码', text: res.code, lang: res.lang });
    if (Array.isArray(res.tabs)) out.outputs = out.outputs.concat(res.tabs);
    out.outputs = out.outputs.filter((o) => o && (o.text !== undefined || o.view));
    if (!out.outputs.length && !out.stats && !out.notices) out.outputs = [{ label: '结果', text: '' }];
    return out;
  }

  function result(host, res, ctx) {
    ctx = ctx || {};
    SK.dom.clear(host);
    const data = normalize(res);
    if (data.error) {
      host.appendChild(el('div', { class: 'out-error' }, [el('div', { class: 'out-error-icon', text: '✕' }), el('div', {}, [el('strong', { text: '执行失败' }), el('p', { text: data.error })])]));
      if (data.hint) host.appendChild(el('p', { class: 'out-hint', text: data.hint }));
      return { setTab: () => {}, getText: () => '' };
    }
    if (data.empty) {
      host.appendChild(el('div', { class: 'out-empty', text: data.empty }));
      return { setTab: () => {}, getText: () => '' };
    }

    const bar = el('div', { class: 'out-bar' });
    const tabsEl = el('div', { class: 'out-tabs' });
    const toolsEl = el('div', { class: 'out-tools' });
    bar.appendChild(tabsEl);
    bar.appendChild(toolsEl);
    const stage = el('div', { class: 'out-stage' });
    const metaBar = el('div', { class: 'out-meta' });

    let active = 0;
    let activeIndex = 0;
    const instances = [];

    data.outputs.forEach((o, i) => {
      const label = o.label || '输出 ' + (i + 1);
      const btn = el('button', { class: 'out-tab', text: label, onClick: () => setTab(i) });
      tabsEl.appendChild(btn);
      instances.push({ spec: o, host: el('div', { class: 'out-body' }), built: false });
    });

    function setTab(i) {
      active = i;
      instances.forEach((inst, k) => {
        inst.host.style.display = k === i ? '' : 'none';
        tabsEl.children[k].classList.toggle('on', k === i);
      });
      const inst = instances[i];
      if (!inst.built) {
        buildBody(inst, ctx);
        inst.built = true;
      }
      stage.appendChild(inst.host);
      updateTools(inst);
      activeIndex = i;
    }

    function buildBody(inst, ctx) {
      const o = inst.spec;
      if (o.view && views[o.view]) {
        try {
          views[o.view](inst.host, o.data, Object.assign({ lang: o.lang }, ctx));
        } catch (e) {
          inst.host.appendChild(el('div', { class: 'out-error', text: '视图渲染失败: ' + e.message }));
        }
      } else if (o.html) inst.host.innerHTML = o.html;
      else {
        inst.viewer = SK.viewer.create(inst.host, { lang: o.lang || guessLang(o.text), placeholder: '结果为空' });
        inst.host.viewer = inst.viewer;
        inst.viewer.reset(o.text || '', { lang: o.lang || guessLang(o.text) });
        if (o.filterHint) inst.host.appendChild(el('div', { class: 'out-hint', text: o.filterHint }));
      }
      inst.host.appendChild(el('div', { class: 'grow-note' }));
    }

    function updateTools(inst) {
      SK.dom.clear(toolsEl);
      const o = inst.spec;
      if (inst.viewer) {
        const inp = el('input', { class: 'mini-search', type: 'search', placeholder: '定位 / 过滤行', onKeydown: (e) => {
            if (e.key === 'Enter') {
              if (e.shiftKey) inst.viewer.nextHit(-1);
              else if (e.ctrlKey || e.metaKey) inst.viewer.nextHit(1);
              else {
                const r = inst.viewer.find(inp.value, { regex: false });
                if (!r.count) SK.ui.toast('未找到匹配行', 'warn');
              }
            } else if (e.key === 'Escape') {
              inp.value = '';
              inst.viewer.find('', {});
            }
          } });
        toolsEl.appendChild(inp);
        toolsEl.appendChild(el('button', { class: 'icon-btn', text: '↓', title: '下一个匹配', onClick: () => inst.viewer.nextHit(1) }));
        toolsEl.appendChild(el('button', { class: 'icon-btn', text: '⤓', title: '仅显示匹配行（输入关键词后点此）', onClick: () => {
            if (!inp.value) return SK.ui.toast('先输入关键词', 'warn');
            const r = inst.viewer.filter(inp.value, {});
            SK.ui.toast('匹配 ' + fmtNum(r.count) + ' 行' + (r.truncated ? '（已截断）' : ''), 'ok');
          } }));
        toolsEl.appendChild(el('button', { class: 'icon-btn', text: '✕', title: '取消过滤', onClick: () => inst.viewer.unfilter() }));
        toolsEl.appendChild(el('button', { class: 'btn tiny', text: '复制筛选结果', title: '只复制当前过滤出来的行（默认“复制”始终是完整原文）', onClick: () => {
            const t = inst.viewer.getFilteredText();
            if (!t) return SK.ui.toast('没有可复制的内容', 'warn');
            copy(t).then(() => SK.ui.toast('已复制筛选结果 ' + fmtNum(t.split('\n').length) + ' 行', 'ok'));
          } }));
      }
      const txt = textareaOf(inst);
      if (txt) {
        toolsEl.appendChild(el('button', { class: 'btn tiny', text: '复制', onClick: () => copy(txt()).then(() => SK.ui.toast('已复制', 'ok')).catch((e) => SK.ui.toast('复制失败：' + e.message, 'error')) }));
        toolsEl.appendChild(el('button', { class: 'btn tiny', text: '下载', onClick: () => download(txt(), ctx.filename || (SK.currentToolId || 'output') + extOf(inst.spec), 'text/plain') }));
      }
      if (o.bytes !== undefined) toolsEl.appendChild(el('span', { class: 'out-bytes', text: fmtBytes(o.bytes) }));
    }

    function textareaOf(inst) {
      const o = inst.spec;
      if (inst.viewer) return () => inst.viewer.getText();
      if (o.text !== undefined) return () => o.text;
      return null;
    }

    instances.forEach((inst) => stage.appendChild(inst.host));
    host.appendChild(bar);
    host.appendChild(stage);
    if (!ctx.noMeta && (data.stats || data.notices)) {
      if (data.notices) data.notices.forEach((n) => metaBar.appendChild(notice(n)));
      if (data.stats) metaBar.appendChild(statsChips(data.stats));
      host.appendChild(metaBar);
    }
    /* B02：默认永远取「原始全文」，折叠与筛选都不改变导出内容。
       需要筛选结果时显式传 mode='filtered'。 */
    function getActiveText(mode) {
      const inst = instances[activeIndex];
      if (!inst) return '';
      if (inst.viewer && inst.viewer.getText) {
        if (mode === 'filtered') return inst.viewer.getFilteredText();
        if (mode === 'display') return inst.viewer.getDisplayText();
        return inst.viewer.getText();
      }
      const o = inst.spec || {};
      if (typeof o.text === 'string') return o.text;
      if (o.view === 'table' && o.data && o.data.rows) {
        const cols = o.data.columns || [];
        const head = cols.map(function (c) { return c.label; }).join(',');
        const body2 = o.data.rows.map(function (r) {
          return cols.map(function (c) { const v = r[c.key]; return v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); }).join(',');
        }).join('\n');
        return head + '\n' + body2;
      }
      return '';
    }
    host.__getActiveText = getActiveText;
    setTab(0);
    return { setTab, instances, getActiveText };
  }

  function extOf(spec) {
    const l = spec.lang || '';
    if (l === 'json') return '.json';
    if (l === 'python') return '.py';
    if (l === 'js') return '.js';
    if (l === 'html') return '.html';
    if (l === 'sql') return '.sql';
    return '.txt';
  }

  function guessLang(text) {
    const s = String(text || '').trim().slice(0, 400);
    if (!s) return 'plain';
    if (/^[{[]/.test(s)) return 'json';
    if (/^\s*<(!doctype|html|div|span|p|a|script|table|\?xml)/i.test(s)) return 'html';
    if (/^\s*(select|insert|update|delete|create|alter|drop|with)\b/i.test(s)) return 'sql';
    if (/^\s*(import|from)\s+\w+|def \w+\(|print\(/.test(s)) return 'python';
    if (/^\s*(curl|wget)\b/.test(s)) return 'shell';
    if (/^(https?:|\/\/|www\.)/.test(s)) return 'text';
    return 'plain';
  }

  function statsChips(stats) {
    const box = el('div', { class: 'stats' });
    stats.forEach((s) => {
      if (s === null || s === undefined) return;
      const k = typeof s === 'string' ? s : s.k;
      const v = typeof s === 'string' ? '' : s.v;
      box.appendChild(el('span', { class: 'chip ' + (s.level || '') }, [el('b', { text: k }), v !== '' && v !== undefined ? el('i', { text: String(v) }) : null]));
    });
    return box;
  }

  function notice(n) {
    if (typeof n === 'string') n = { level: 'info', msg: n };
    return el('div', { class: 'notice n-' + (n.level || 'info'), title: n.msg }, [el('span', { class: 'n-dot', text: n.level === 'error' ? '✕' : n.level === 'warn' ? '!' : n.level === 'ok' ? '✓' : 'i' }), el('span', { class: 'n-msg', text: n.msg }), n.action ? el('button', { class: 'n-act', text: n.action.label, onClick: n.action.onClick }) : null]);
  }

  function table(host, spec) {
    const columns = spec.columns || inferColumns(spec.rows);
    const allRows = spec.rows || [];
    const state = { filter: '', sortCol: -1, sortDir: -1, rows: allRows };
    const rowH = 30;
    host.classList.add('tbl');
    /* 行详情：rows 里带 __detail 字段时自动加「详情」列，点击弹窗展示（纯文本可跨 Worker） */
    const hasDetail = spec.rows && spec.rows.some((r) => r && r.__detail != null);
    const cols = hasDetail ? columns.concat([{ key: '__btn', label: '', width: '72px' }]) : columns;
    const controls = el('div', { class: 'tbl-ctl' }, [
      el('input', { class: 'mini-search', type: 'search', placeholder: spec.filterHint || '过滤表格（支持正则）', onInput: SK.dom.debounce((e) => {
          state.filter = e.target.value;
          applyFilter();
          render();
        }, 200) }),
      el('span', { class: 'tbl-count' }),
      el('button', { class: 'btn tiny', text: '导出 CSV', onClick: () => download(toCsv(state.rows, columns), (spec.name || 'table') + '.csv') }),
    ]);
    const tpl = cols.map((c) => c.width || 'minmax(90px,1fr)').join(' ');
    const head = el('div', { class: 'tbl-head', style: { gridTemplateColumns: tpl } });
    cols.forEach((c, i) => head.appendChild(el('button', { class: 'tbl-th', text: c.label, title: '点击排序', onClick: () => sortBy(i) })));
    const scroll = el('div', { class: 'tbl-scroll' });
    const spacer = el('div', { class: 'tbl-spacer' });
    const body = el('div', { class: 'tbl-body' });
    scroll.appendChild(spacer);
    scroll.appendChild(body);
    host.appendChild(controls);
    host.appendChild(head);
    host.appendChild(scroll);

    function openDetail(row) {
      const text = String(row.__detail || '');
      const title = String(row.__detailTitle || '详情');
      const box = el('div', { class: 'tbl-detail' });
      const pre = el('pre', { class: 'tbl-detail-pre', text: text });
      box.appendChild(pre);
      const acts = el('div', { class: 'chips-row', style: { justifyContent: 'flex-start', marginTop: '10px' } }, [
        el('button', { class: 'btn tiny primary', text: '⧉ 复制详情', onClick: () => copy(text).then(() => SK.ui.toast('已复制', 'ok')) }),
        el('button', { class: 'btn tiny', text: '⤓ 下载', onClick: () => download(text, 'detail.txt', 'text/plain') }),
      ]);
      box.appendChild(acts);
      SK.ui.openModal({ title: title, wide: true, body: box });
    }

    function applyFilter() {
      if (!state.filter) {
        state.rows = allRows;
        return;
      }
      let re;
      try {
        re = new RegExp(state.filter, 'i');
      } catch (e) {
        re = new RegExp(String(state.filter).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      const out = [];
      for (const r of allRows) {
        const s = typeof r === 'string' ? r : columns.map((c) => val(r, c)).join(' ');
        if (re.test(s)) out.push(r);
        if (out.length > 200000) break;
      }
      state.rows = out;
    }

    function sortBy(i) {
      const c = cols[i];
      if (!c || c.key === '__btn') return;
      if (state.sortCol === i) state.sortDir = -state.sortDir;
      else {
        state.sortCol = i;
        state.sortDir = 1;
      }
      const dir = state.sortDir;
      state.rows = state.rows.slice().sort((a, b) => {
        const x = val(a, c);
        const y = val(b, c);
        const nx = parseFloat(x);
        const ny = parseFloat(y);
        if (!isNaN(nx) && !isNaN(ny) && typeof x !== 'string') return (nx - ny) * dir;
        if (!isNaN(nx) && !isNaN(ny)) return (nx - ny) * dir;
        return String(x).localeCompare(String(y), 'zh') * dir;
      });
      head.querySelectorAll('.tbl-th').forEach((b, k) => b.classList.toggle('sorted', k === i));
      render();
    }

    function val(row, c) {
      const v = Array.isArray(row) ? row[c.index] : row[c.key];
      return v === null || v === undefined ? '' : v;
    }

    function render() {
      const n = state.rows.length;
      controls.querySelector('.tbl-count').textContent = fmtNum(n) + ' 行' + (n !== allRows.length ? ' / 共 ' + fmtNum(allRows.length) : '');
      spacer.style.height = Math.max(1, n * rowH) + 'px';
      const first = Math.max(0, Math.floor(scroll.scrollTop / rowH) - 6);
      let last = Math.min(n, first + Math.ceil(scroll.clientHeight / rowH) + 12);
      const frag = document.createDocumentFragment();
      for (let i = first; i < last; i++) {
        const row = state.rows[i];
        let cls = 'tbl-row';
        if (spec.rowCls && row) {
          const mv = row[spec.rowCls.field];
          const mapped = mv == null ? '' : spec.rowCls.map && spec.rowCls.map[String(mv)];
          if (mapped) cls += ' ' + mapped;
        }
        const tr = el('div', { class: cls, style: { gridTemplateColumns: tpl, height: rowH + 'px' } });
        cols.forEach((c) => {
          if (c.key === '__btn') {
            const b = el('button', { class: 'btn tiny tbl-detail-btn', text: '🔍 详情' });
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              openDetail(row);
            });
            tr.appendChild(el('span', { class: 'tbl-cell' }, [b]));
            return;
          }
          const v = val(row, c);
          tr.appendChild(buildCell(c, v, row));
        });
        frag.appendChild(tr);
      }
      body.replaceChildren(frag);
      body.style.transform = 'translateY(' + first * rowH + 'px)';
    }

    scroll.addEventListener('scroll', SK.dom.raf(render), { passive: true });
    applyFilter();
    render();
    if (spec.caption) host.appendChild(el('div', { class: 'tbl-cap', text: spec.caption }));
    return { render, state };
  }

  /* 单元格：优先用函数 render（主线程工具），否则用声明式配置（可跨 Worker 传输） */
  function buildCell(c, v, row) {
    if (typeof c.render === 'function') {
      const out = c.render(v, row);
      return typeof out === 'string' ? el('span', { class: 'tbl-cell', text: out }) : out;
    }
    const txt = v === null || v === undefined ? '' : String(v);
    /* parts：行内差异分段（worker 里算好，跨线程传输的纯数据），如 [{k:'eq',s:'var '},{k:'del',s:'2'}] */
    if (c.parts && row && Array.isArray(row[c.parts])) {
      const segs = row[c.parts];
      const s = el('span', { class: 'tbl-cell parts', title: txt });
      for (let i = 0; i < segs.length; i++) s.appendChild(el('span', { class: 'seg-' + (segs[i].k || 'eq'), text: segs[i].s }));
      return s;
    }
    if (c.diffMap) {
      const cls = c.diffMap[v] || c.diffMap.__default || 'eq';
      return el('span', { class: 'df df-' + cls, text: txt });
    }
    if (c.cls) {
      let extra = '';
      if (c.mark && c.mark.field) {
        const mv = String(row[c.mark.field] === undefined ? '' : row[c.mark.field]);
        if (String(c.mark.when || '').split('').some((ch) => ch && mv.indexOf(ch) >= 0)) extra = ' on';
      }
      return el('span', { class: c.cls + extra, text: txt, title: txt });
    }
    return el('span', { class: 'tbl-cell', text: txt, title: txt });
  }

  function inferColumns(rows) {
    if (!rows.length) return [];
    const first = rows.find((r) => r && typeof r === 'object') || rows[0];
    if (Array.isArray(first)) return first.map((_, i) => ({ key: i, index: i, label: '列' + (i + 1) }));
    return Object.keys(first).map((k) => ({ key: k, label: k }));
  }

  function toCsv(rows, columns) {
    const esc2 = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const out = [columns.map((c) => esc2(c.label)).join(',')];
    for (const r of rows) out.push(columns.map((c) => esc2(Array.isArray(r) ? r[c.index] : r[c.key])).join(','));
    return out.join('\r\n');
  }

  function tree(host, data, opts) {
    opts = opts || {};
    host.classList.add('tree');
    const expandables = [];
    const root = el('div', { class: 'tree-body' });
    const bar = el('div', { class: 'tree-bar' }, [
      el('button', { class: 'btn tiny', text: '⊞ 展开全部', title: '展开所有层级', onClick: () => setAll(true) }),
      el('button', { class: 'btn tiny', text: '⊟ 收起全部', title: '只保留根节点', onClick: () => setAll(false) }),
      el('span', { class: 'tree-hint', text: '点 ▸/▾ 折叠 · 双击值复制 · 单击值显示路径' }),
    ]);
    host.appendChild(bar);
    host.appendChild(root);
    const counter = el('div', { class: 'tree-info' });
    host.appendChild(counter);
    let nodes = 0;
    const MAXN = opts.maxNodes || 60000;

    function setAll(open) {
      for (let i = 0; i < expandables.length; i++) {
        const it = expandables[i];
        it.kids.style.display = open ? '' : 'none';
        it.arrow.textContent = open ? '▾' : '▸';
        if (!open) it.wrap.classList.add('folded');
        else it.wrap.classList.remove('folded');
      }
      // 根节点保持展开，收起后树不至于完全空白
      const first = expandables[0];
      if (!open && first) {
        first.kids.style.display = '';
        first.arrow.textContent = '▾';
        first.wrap.classList.remove('folded');
      }
    }

    function toggle(wrap, kids, arrow) {
      const open = kids.style.display !== 'none';
      kids.style.display = open ? 'none' : '';
      arrow.textContent = open ? '▸' : '▾';
      wrap.classList.toggle('folded', open);
      if (!open && kids._lazy) kids._lazy();
    }

    function label(k, v) {
      const t = tv(v);
      return el('div', { class: 'tnode' }, [
        k !== null ? el('span', { class: 'tkey', text: String(k) }) : null,
        k !== null ? el('span', { class: 'tcolon', text: ':' }) : null,
        isObj(v) ? el('button', { class: 'tarrow', text: '▸' }) : null,
        isObj(v) ? el('span', { class: 'tsum', text: summarize(v) }) : el('span', { class: 'tval t-' + t, text: show(v) }),
      ]);
    }

    function build(value, path, depth) {
      const wrap = el('div', { class: 'tnode-row' });
      wrap.appendChild(label(path.key, value));
      if (isObj(value)) {
        const kids = el('div', { class: 'tkids', style: { display: 'none' } });
        const entries = entriesOf(value);
        const shown = entries.slice(0, 500);
        for (const [k, v] of shown) {
          if (nodes++ > MAXN) {
            kids.appendChild(el('div', { class: 'tmore', text: '节点过多，已截断（' + fmtNum(nodes) + '）' }));
            break;
          }
          kids.appendChild(build(v, { key: k, path: path.path + keySep(k, value) }, depth + 1));
        }
        if (entries.length > shown.length) kids.appendChild(el('div', { class: 'tmore', text: '还有 ' + fmtNum(entries.length - shown.length) + ' 项未展开（' + path.path + '）' }));
        wrap.appendChild(kids);
        const arrow = wrap.firstChild.querySelector('.tarrow');
        expandables.push({ wrap, kids, arrow });
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          toggle(wrap, kids, arrow);
        });
        if (depth < (opts.autoExpand === undefined ? 1 : opts.autoExpand)) {
          kids.style.display = '';
          arrow.textContent = '▾';
        }
      } else {
        wrap.firstChild.addEventListener('dblclick', () => copy(JSON.stringify(value)).then(() => SK.ui.toast('已复制值', 'ok')));
        wrap.firstChild.title = '双击复制值 · ' + path.path;
        wrap.firstChild.addEventListener('click', () => {
          SK.ui.toast('路径 ' + path.path, 'info');
        });
      }
      return wrap;
    }

    function keySep(k, v) {
      return Array.isArray(v) ? '[' + k + ']' : (k ? k : '""');
    }

    function entriesOf(v) {
      if (Array.isArray(v)) return v.map((x, i) => [i, x]);
      return Object.entries(v);
    }

    function isObj(v) {
      return v !== null && typeof v === 'object';
    }

    function tv(v) {
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'array';
      return typeof v;
    }

    function show(v) {
      if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) + '…' : JSON.stringify(v);
      if (typeof v === 'number') return Object.is(v, -0) ? '0' : String(v);
      return String(v);
    }

    function summarize(v) {
      const n = Array.isArray(v) ? v.length : Object.keys(v).length;
      return (Array.isArray(v) ? '[ ' : '{ ') + fmtNum(n) + (Array.isArray(v) ? ' ]' : ' }');
    }

    const built = build(data, { key: null, path: '' }, 0);
    root.appendChild(built);
    const first = built.firstChild.querySelector('.tarrow');
    if (first) {
      first.textContent = '▾';
      const kids = built.querySelector('.tkids');
      if (kids) kids.style.display = '';
    }
    counter.textContent = fmtNum(nodes) + ' 个节点 · ' + expandables.length + ' 个可折叠层级';
    return { nodes, setAll };
  }

  function fields(host, list) {
    const box = el('div', { class: 'fields' });
    list.forEach((f) => {
      if (!f) return;
      box.appendChild(
        el('div', { class: 'field' }, [
          el('div', { class: 'fkey' }, [el('span', { text: f.k }), f.copy ? el('button', { class: 'fcopy', text: '⧉', title: '复制', onClick: () => copy(String(f.v)).then(() => SK.ui.toast('已复制', 'ok')) }) : null]),
          el('div', { class: ['fval', f.cls].filter(Boolean).join(' ') }, [el('span', { text: String(f.v), title: String(f.v).length > 200 ? String(f.v).slice(0, 400) : '' })]),
        ])
      );
    });
    host.appendChild(box);
    return box;
  }

  /* 内建视图：工具返回 view: 'table' / 'tree' / 'fields' 时直接渲染 */
  view('table', function (host, data) {
    table(host, data || {});
  });
  view('tree', function (host, data, opts) {
    tree(host, data, opts || {});
  });
  view('fields', function (host, data) {
    fields(host, data || []);
  });

  SK.render = { result, table, tree, fields, notice, statsChips, guessLang };
  SK.view = view;
  SK.views = views;
})(typeof window !== 'undefined' ? window : globalThis);
