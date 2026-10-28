/* ============================================================================
   Spider Lab · pins.js
   工作台留存层：钉子板（跨工具暂存中间结果）+ 片段库（常用值 key/IV/UA）。
   - 输出区 📌 钉住当前结果；任何输入框 📎 一键插入
   - 输入框 🔑 保存/插入常用片段（逆向反复用同一组 key/UA）
   ========================================================================== */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el } = SK.dom;

  const MAX_PIN_TEXT = 64 * 1024;
  const MAX_SNIP_TEXT = 8 * 1024;

  function list() { return SK.store.get('pins', []) || []; }
  function save(l) { SK.store.set('pins', l.slice(0, 50)); }
  function snips() { return SK.store.get('snips', []) || []; }
  function saveSnips(l) { SK.store.set('snips', l.slice(0, 100)); }

  function pin(text, label, toolId) {
    text = String(text == null ? '' : text);
    if (!text.trim()) return { error: '内容为空' };
    const origLen = text.length;
    let truncated = false;
    if (text.length > MAX_PIN_TEXT) { text = text.slice(0, MAX_PIN_TEXT); truncated = true; }
    const l = list();
    l.unshift({ id: 'p' + Date.now(), label: label || ('来自 ' + ((SK.tools.byId[toolId] || {}).name || '?')), text: text, t: Date.now(), toolId: toolId });
    save(l);
    return { ok: true, count: l.length, truncated: truncated, origLen: origLen, savedLen: text.length };
  }
  function unpin(id) { save(list().filter((p) => p.id !== id)); }

  const preview = (s) => {
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > 64 ? t.slice(0, 40) + '…' + t.slice(-18) : t || '(空)';
  };

  /* ---------- 菜单通用：定位/关闭 ---------- */
  function floatMenu(anchor) {
    const menu = el('div', { class: 'send-menu pin-menu' });
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 300)) + 'px';
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - 340) + 'px';
    document.body.appendChild(menu);
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 10);
    SK.app.onLeave(() => menu.remove());
    return menu;
  }

  /* ---------- 📎 插入钉子到输入框 ---------- */
  function openPinPicker(anchor, ed) {
    const l = list();
    const menu = floatMenu(anchor);
    menu.appendChild(el('div', { class: 'sm-title', text: '📌 插入钉住的内容' }));
    if (!l.length) {
      menu.appendChild(el('div', { class: 'sm-empty', text: '还没有钉子 —— 在任何工具输出区点 📌 钉住结果' }));
      return;
    }
    const box = el('div', { class: 'sm-list' });
    l.forEach((p) => {
      box.appendChild(el('button', {
        class: 'sm-item pin-item',
        title: '插入到当前输入框',
        html: '<span class="pin-label"></span><span class="pin-prev"></span>',
        onClick: () => {
          const v = ed.getValue();
          ed.setValue(v.kind === 'text' && v.text ? v.text + '\n' + p.text : p.text);
          menu.remove();
          SK.ui.toast('已插入「' + p.label + '」(' + SK.dom.fmtNum(p.text.length) + ' 字符)', 'ok');
        },
      }));
      const b = box.lastChild;
      b.querySelector('.pin-label').textContent = p.label;
      b.querySelector('.pin-prev').textContent = preview(p.text);
    });
    menu.appendChild(box);
  }

  /* ---------- 🔑 片段库 ---------- */
  function openSnipPicker(anchor, ed, spec, toolId) {
    const menu = floatMenu(anchor);
    const l = snips();
    menu.appendChild(el('div', { class: 'sm-title', text: '🔑 常用值（key / IV / UA / 域名…）' }));
    /* 保存当前内容为片段 */
    const saveBtn = el('button', { class: 'sm-item snip-save', text: '＋ 把当前输入保存为常用值' });
    saveBtn.addEventListener('click', () => {
      const v = ed.getValue();
      const text = v.kind === 'text' ? v.text : '';
      if (!text || !text.trim() || text.length > MAX_SNIP_TEXT) return SK.ui.toast('当前输入为空或过长（>8KB）', 'warn');
      const m = SK.ui.openModal({
        title: '保存常用值',
        body: (() => {
          const nameIn = el('input', { type: 'text', placeholder: '起个名字，如 dianping-key / 通用UA', style: { width: '100%', padding: '7px 9px', marginTop: '6px' } });
          const box = el('div', {}, [
            el('div', { class: 'out-hint', text: preview(text) }),
            nameIn,
            el('div', { class: 'chips-row', style: { justifyContent: 'flex-start', marginTop: '10px' } }, [
              el('button', { class: 'btn primary', text: '保存', onClick: () => {
                const name = nameIn.value.trim() || ('片段 ' + new Date().toLocaleTimeString());
                const sl = snips();
                sl.unshift({ id: 's' + Date.now(), name: name, text: text, t: Date.now() });
                saveSnips(sl);
                SK.ui.toast('已保存「' + name + '」', 'ok');
                if (m && m.close) m.close(); else SK.ui.closeModal();
              } }),
            ]),
          ]);
          setTimeout(() => nameIn.focus(), 60);
          return box;
        })(),
      });
      menu.remove();
    });
    menu.appendChild(saveBtn);
    if (!l.length) {
      menu.appendChild(el('div', { class: 'sm-empty', text: '还没有常用值 —— 保存后任何输入框一键插入' }));
      return;
    }
    const box = el('div', { class: 'sm-list' });
    l.forEach((s) => {
      const row = el('button', {
        class: 'sm-item pin-item',
        html: '<span class="pin-label"></span><span class="pin-prev"></span><span class="pin-del" title="删除">✕</span>',
      });
      row.querySelector('.pin-label').textContent = s.name;
      row.querySelector('.pin-prev').textContent = preview(s.text);
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('pin-del')) {
          saveSnips(snips().filter((x) => x.id !== s.id));
          row.remove();
          return;
        }
        const v = ed.getValue();
        ed.setValue(v.kind === 'text' && v.text && v.text.trim() ? v.text + s.text : s.text);
        menu.remove();
        SK.ui.toast('已插入「' + s.name + '」', 'ok');
      });
      box.appendChild(row);
    });
    menu.appendChild(box);
  }

  /* ---------- 顶栏钉子板面板 ---------- */
  function openBoard(anchor) {
    const l = list();
    const menu = floatMenu(anchor);
    menu.classList.add('pin-board');
    menu.appendChild(el('div', { class: 'sm-title', text: '📌 钉子板（跨工具暂存 · 最多 50 条）' }));
    if (!l.length) {
      menu.appendChild(el('div', { class: 'sm-empty', text: '在任何工具输出区点 📌 把结果钉到这里，\n然后到别的工具输入框点 📎 插入。' }));
      return;
    }
    const box = el('div', { class: 'sm-list' });
    l.forEach((p) => {
      const row = el('div', {
        class: 'pin-row',
        html: '<div class="pin-meta"><span class="pin-label"></span><span class="pin-time"></span></div><div class="pin-prev"></div><div class="pin-acts"></div>',
      });
      row.querySelector('.pin-label').textContent = p.label;
      row.querySelector('.pin-time').textContent = new Date(p.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' · ' + SK.dom.fmtNum(p.text.length) + ' 字符';
      row.querySelector('.pin-prev').textContent = preview(p.text);
      const acts = row.querySelector('.pin-acts');
      acts.appendChild(el('button', { class: 'btn tiny', text: '⧉ 复制', onClick: () => SK.dom.copy(p.text).then(() => SK.ui.toast('已复制', 'ok')) }));
      if (p.toolId && SK.tools.byId[p.toolId]) acts.appendChild(el('button', { class: 'btn tiny', text: '↗ 打开来源', onClick: () => { SK.inject = { toolId: p.toolId, text: p.text, from: 'pins' }; location.hash = '#/' + p.toolId; menu.remove(); } }));
      acts.appendChild(el('button', { class: 'btn tiny danger', text: '删除', onClick: () => { unpin(p.id); row.remove(); } }));
      row.addEventListener('click', (e) => { if (e.target === row || e.target.classList.contains('pin-prev')) SK.dom.copy(p.text).then(() => SK.ui.toast('已复制整条', 'ok')); });
      box.appendChild(row);
    });
    menu.appendChild(box);
    const foot = el('div', { class: 'pin-foot' });
    foot.appendChild(el('button', { class: 'btn tiny danger', text: '清空钉子板', onClick: () => { save([]); menu.remove(); SK.ui.toast('已清空', 'info'); } }));
    menu.appendChild(foot);
  }

  SK.pins = { pin, unpin, list, openPinPicker, openSnipPicker, openBoard, snips };
})(typeof window !== 'undefined' ? window : globalThis);
