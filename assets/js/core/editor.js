(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el, fmtBytes, fmtNum, copy } = SK.dom;

  const TEXTAREA_LIMIT = 600 * 1024;

  function create(host, opts) {
    opts = opts || {};
    host.classList.add('editor');
    const gutter = el('div', { class: 'eg-gutter', text: '1' });
    const ta = el('textarea', {
      class: 'eg-area',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      autocorrect: 'off',
      placeholder: opts.placeholder || '',
      wrap: 'off',
    });
    const card = el('div', { class: 'eg-card', style: { display: 'none' } });
    const foot = el('div', { class: 'eg-foot' });
    const wrap = el('div', { class: 'eg-wrap' }, [gutter, ta, card]);
    const picker = el('input', { type: 'file', style: { display: 'none' }, onChange: (e) => e.target.files[0] && setFile(e.target.files[0]) });
    host.appendChild(wrap);
    host.appendChild(foot);
    host.appendChild(picker);

    let mode = 'text';
    let file = null;
    let blobInfo = null;

    function countLines(v) {
      if (!v) return 0;
      let n = 1;
      const scan = v.length > 300000 ? v.slice(0, 300000) : v;
      for (let i = 0; i < scan.length; i++) if (scan.charCodeAt(i) === 10) n++;
      if (v.length > 300000) {
        const ratio = n / scan.length;
        n = Math.round(v.length * ratio) + 1;
      }
      return n;
    }

    function refresh() {
      if (mode === 'file') foot.textContent = fmtBytes(file.size) + ' · ' + file.name;
      else if (mode === 'blob') foot.textContent = fmtBytes(blobInfo.bytes) + ' · 已缓存，不参与编辑';
      else {
        const v = ta.value;
        let lines = 0;
        if (!v) foot.textContent = '空';
        else {
          lines = countLines(v);
          foot.textContent = fmtNum(v.length) + ' 字符 · ' + (lines > 299998 ? '≈' : '') + fmtNum(lines) + ' 行 · ≈' + fmtBytes(Math.round(v.length * avgBytes(v)));
        }
        foot.classList.toggle('warn', v.length > 200000);
        const shown = Math.min(lines || 1, 20000);
        if (lines > 4000) gutter.style.display = 'none';
        else {
          gutter.style.display = '';
          let nums = '';
          for (let i = 1; i <= shown; i++) nums += i + '\n';
          gutter.textContent = nums;
        }
      }
    }

    function avgBytes(v) {
      const s = v.slice(0, 4000);
      let b = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        b += c < 128 ? 1 : c < 2048 ? 2 : c < 0xd800 || c > 0xdfff ? 3 : 4;
      }
      return Math.max(1, b / Math.max(1, s.length));
    }

    function switchMode(next, info) {
      mode = next;
      ta.style.display = next === 'text' ? '' : 'none';
      gutter.style.display = next === 'text' ? '' : 'none';
      card.style.display = next === 'text' ? 'none' : '';
      SK.dom.clear(card);
      if (next === 'file') {
        file = info.file;
        card.appendChild(el('div', { class: 'eg-card-in' }, [
          el('div', { class: 'eg-icon', text: '📄' }),
          el('div', { class: 'eg-info' }, [el('strong', { text: file.name }), el('span', { text: fmtBytes(file.size) + (file.type ? ' · ' + file.type : '') }), el('p', { text: '执行时读取完整文件，不会截断内容。' })]),
          el('div', { class: 'eg-acts' }, [
            el('button', { class: 'btn tiny', text: '取前 500KB 进编辑框', onClick: async () => setValue(await file.slice(0, 500 * 1024).text()) }),
            el('button', { class: 'btn tiny', text: '换成文本', onClick: async () => setValue(await readWhole()) }),
            el('button', { class: 'btn tiny danger', text: '移除', onClick: () => clear() }),
          ]),
        ]));
      } else if (next === 'blob') {
        blobInfo = info;
        card.appendChild(el('div', { class: 'eg-card-in' }, [
          el('div', { class: 'eg-icon', text: '🗃' }),
          el('div', { class: 'eg-info' }, [el('strong', { text: '大文本已移出编辑框' }), el('span', { text: fmtBytes(info.bytes) + ' · 仍参与计算' }), el('p', { text: '编辑框只保留小文本，避免浏览器卡顿。' })]),
          el('div', { class: 'eg-acts' }, [
            /* 预览不能覆盖编辑框：旧实现 setValue(前200KB) 会把「仍参与计算」的完整大文本
               替换成截断片段，用户以为没变，实际算的已经不是原文了。改为只读弹窗预览。 */
            el('button', { class: 'btn tiny', text: '预览前 200KB', title: '只读预览，不会改动编辑框内容', onClick: () => {
              const full = SK.blobs.text(info.id);
              const slice = full.slice(0, 200 * 1024);
              const box = el('div', {}, [
                el('p', { class: 'out-hint', text: '共 ' + SK.dom.fmtNum(full.length) + ' 字符，下面只显示前 200KB（只读，不参与运行）' }),
                el('textarea', { class: 'recipe-out', readonly: 'readonly', value: slice, style: { minHeight: '320px' } }),
              ]);
              SK.ui.openModal({ title: '大文本预览', wide: true, body: box });
            } }),
            el('button', { class: 'btn tiny danger', text: '清空', onClick: () => clear() }),
          ]),
        ]));
      }
      refresh();
    }

    async function readWhole() {
      if (file.size > SK.editor.READ_FILE_LIMIT) throw new Error('文件 ' + fmtBytes(file.size) + ' 超过 ' + fmtBytes(SK.editor.READ_FILE_LIMIT) + ' 上限，请使用支持大文件流式的工具');
      return (await file.text()).replace(/^﻿/, '');
    }

    function setValue(text) {
      text = text == null ? '' : String(text);
      if (text.length > TEXTAREA_LIMIT) {
        const b = SK.blobs.put(text, opts.label || '文本');
        switchMode('blob', { id: b.id, bytes: b.bytes });
      } else {
        mode = 'text';
        card.style.display = 'none';
        ta.style.display = '';
        ta.value = text;
        refresh();
      }
      if (opts.onChange) opts.onChange();
    }

    function getValue() {
      if (mode === 'file') return { kind: 'file', file, name: file.name, bytes: file.size };
      if (mode === 'blob') return { kind: 'blob', id: blobInfo.id, bytes: blobInfo.bytes };
      return { kind: 'text', text: ta.value };
    }

    function clear() {
      mode = 'text';
      file = null;
      blobInfo = null;
      ta.value = '';
      card.style.display = 'none';
      ta.style.display = '';
      refresh();
      if (opts.onChange) opts.onChange();
    }

    function setFile(f) {
      /* binary 模式（PE/ELF/APK/字体等）：任何大小都进文件卡片，绝不文本化 */
      if (opts.binary || f.size > 120 * 1024) switchMode('file', { file: f });
      else f.text().then((t) => setValue(t.replace(/^﻿/, '')));
      if (opts.onChange) opts.onChange();
    }

    ta.addEventListener('input', () => {
      refresh();
      if (opts.onChange) opts.onChange();
    });
    ta.addEventListener('scroll', () => {
      gutter.style.transform = 'translateY(' + -ta.scrollTop + 'px)';
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        const en = ta.selectionEnd;
        ta.setRangeText(e.shiftKey ? '' : '  ', s, en, 'end');
        refresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        host.dispatchEvent(new CustomEvent('tool-run', { bubbles: true }));
      }
    });
    ta.addEventListener('paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) {
        e.preventDefault();
        setFile(files[0]);
        return;
      }
      const dt = e.clipboardData && e.clipboardData.getData('text/plain');
      if (dt && dt.length > TEXTAREA_LIMIT) {
        e.preventDefault();
        const b = SK.blobs.put(dt, '粘贴内容');
        switchMode('blob', { id: b.id, bytes: b.bytes });
        SK.ui.toast('粘贴内容 ' + fmtBytes(b.bytes) + '，已移出编辑框（避免卡死）', 'info');
      }
    });
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrap.classList.add('drop');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drop');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFile(f);
    });

    refresh();
    return {
      el: host,
      ta,
      getValue,
      setValue,
      setFile,
      clear,
      pickFile: () => picker.click(),
      text() {
        const v = getValue();
        if (v.kind === 'blob') return SK.blobs.text(v.id);
        if (v.kind === 'file') return '';
        return v.text;
      },
      focus: () => ta.focus(),
      get mode() {
        return mode;
      },
      refresh,
    };
  }

  SK.editor = {
    create,
    TEXTAREA_LIMIT,
    READ_FILE_LIMIT: 24 * 1024 * 1024,
  };
})(typeof window !== 'undefined' ? window : globalThis);
