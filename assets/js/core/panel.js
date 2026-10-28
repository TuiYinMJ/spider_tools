(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el, fmtBytes, fmtNum, fmtMs, copy, download } = SK.dom;

  /* ---------- 输入历史（工具+输入框 级，最近 3 次） ---------- */
  function rememberInput(toolId, specId, text) {
    try {
      if (!text) return;
      if (text.length > 100 * 1024) {
        /* 超 100KB 不记录（避免撑爆 localStorage），打点提示一次 */
        if (!SK.store.get('ih:warned', false)) {
          SK.store.set('ih:warned', true);
          SK.ui.toast('超过 100KB 的输入不进历史（防撑爆本地存储）', 'info');
        }
        return;
      }
      const key = 'ih:' + toolId + ':' + specId;
      const list = SK.store.get(key, []) || [];
      const idx = list.indexOf(text);
      if (idx >= 0) list.splice(idx, 1);
      list.unshift(text);
      SK.store.set(key, list.slice(0, 3));
    } catch (e) { /* 历史失败无碍 */ }
  }

  function openInputHistory(anchor, tool, spec, ed, ctx) {
    const list = (SK.store.get('ih:' + tool.id + ':' + spec.id, []) || []).filter(Boolean);
    if (!list.length) return SK.ui.toast('这个输入框还没有历史', 'info');
    const menu = el('div', { class: 'send-menu' });
    const box = el('div', { class: 'sm-list' });
    menu.appendChild(box);
    list.forEach((t) => {
      const preview = t.length > 72 ? t.slice(0, 40) + ' … ' + t.slice(-24) : t.replace(/\n/g, ' ⏎ ');
      box.appendChild(el('button', {
        class: 'sm-item',
        text: preview || '(空)',
        title: '长度 ' + SK.dom.fmtNum(t.length) + ' 字符',
        onClick: () => { ed.setValue(t); if (ctx && ctx.touch) ctx.touch(); menu.remove(); },
      }));
    });
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 260) + 'px';
    menu.style.top = r.bottom + 6 + 'px';
    document.body.appendChild(menu);
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 10);
    SK.app.onLeave(() => menu.remove());
  }

  /* 草稿留存：切走工具后回来，输入自动恢复（≤200KB/框） */
  function saveDraft(toolId, specId, text) {
    if (!text) { SK.store.remove('draft:' + toolId + ':' + specId); return; }
    if (text.length <= 200 * 1024) SK.store.set('draft:' + toolId + ':' + specId, text);
  }
  function restoreDrafts(toolId, list) {
    let restored = 0;
    list.forEach(function (inp) {
      const d = SK.store.get('draft:' + toolId + ':' + inp.spec.id, '');
      if (d) { inp.ed.setValue(d); restored++; }
    });
    return restored;
  }
  function makeInput(spec, tool, ctx) {
    const body = el('div', { class: 'pane-body' });
    const ed = SK.editor.create(body, { label: spec.label || '输入', placeholder: spec.placeholder || '', binary: !!spec.binary, onChange: () => ctx.touch() });
    /* 输入框声明的默认值（如 JSONPath 的 $.data.list[*].id）以前只写在注册表里，
       编辑器根本没读 —— 用户进来看到空框，点 ✨ 还会被样例 JSON 覆盖掉。
       这里落地默认值；草稿恢复在后面，仍以草稿优先。 */
    if (typeof spec.value === 'string' && spec.value) {
      try { ed.setValue(spec.value); } catch (e) {}
    }
    if (ed.ta) {
      let dt = null;
      ed.ta.addEventListener('input', function () {
        clearTimeout(dt);
        dt = setTimeout(function () {
          const v = ed.getValue();
          if (v.kind === 'text') saveDraft(tool.id, spec.id, v.text);
        }, 700);
      });
    }
    const head = el('div', { class: 'pane-head' }, [
      el('span', { class: 'pane-title', text: spec.label || '输入' }),
      el('span', { class: 'pane-tag', text: spec.tag || '' }),
      el('span', { class: 'pane-spacer' }),
      el('button', { class: 'icon-btn', text: '⟲', title: '最近输入（本框最近 3 次内容）', onClick: (e) => openInputHistory(e.target, tool, spec, ed, ctx) }),
      el('button', { class: 'icon-btn', text: '📎', title: '插入钉住的内容（输出区 📌 钉的结果）', onClick: (e) => SK.pins.openPinPicker(e.target, ed) }),
      el('button', { class: 'icon-btn', text: '🔑', title: '常用值：保存 / 插入 key、IV、UA 等高频输入', onClick: (e) => SK.pins.openSnipPicker(e.target, ed, spec, tool.id) }),
      el('button', { class: 'icon-btn', text: '📂', title: '选择文件（也可直接拖拽/粘贴到编辑框）', onClick: () => ed.pickFile() }),
      el('button', { class: 'icon-btn', text: '✨', title: '填入示例数据', onClick: () => ctx.fillSample(spec) }),
      el('button', { class: 'icon-btn', text: '⌫', title: '清空（同时删除本框草稿）', onClick: () => {
          ed.clear();
          /* 清空必须连草稿一起删，否则下次进工具旧内容又被恢复出来 */
          SK.store.remove('draft:' + tool.id + ':' + spec.id);
          ctx.touch();
        } }),
    ]);
    const pane = el('section', { class: 'pane pane-in' + (spec.small ? ' small' : '') }, [head, body]);
    return { pane, ed, spec };
  }

  function resolveValue(v, tool, spec) {
    if (v.kind === 'text') return Promise.resolve(v.text);
    if (v.kind === 'blob') return Promise.resolve(SK.blobs.text(v.id));
    const file = v.file;
    if ((spec && spec.binary) || tool.bigFile) return Promise.resolve({ __file: file, name: file.name, bytes: file.size });
    const limit = tool.maxBytes || SK.editor.READ_FILE_LIMIT;
    if (file.size > limit) {
      return Promise.reject(
        Object.assign(new Error('文件 ' + fmtBytes(file.size) + ' 超过该工具 ' + fmtBytes(limit) + ' 上限'), {
          hint: '点输入框右上角 ✨ 取前 500KB，或改用支持分块流式的大文件工具（JSON 流式格式化 / 文本行处理 / 差集 / 正则提取）。',
        })
      );
    }
    return file.text().then((t) => t.replace(/^﻿/, ''));
  }

  function mount(tool, host) {
    SK.dom.clear(host);
    host.classList.add('tool-mount');
    SK.currentToolId = tool.id;

    const state = { running: false, taskId: 0, lastMs: 0, lastResult: null, lastInputs: null };
    let opts, inputs, runRow, progress, pbar, ptext, errLine, runBtn, cancelBtn, outBody, outMeta, auto, scheduleAuto, modeBadge;

    const favList = SK.store.get('fav', []);
    const head = el('header', { class: 'tool-head' }, [
      el('div', { class: 'th-left' }, [
        el('h2', { class: 'th-name' }, [
          tool.name,
          tool.cap ? el('span', { class: 'th-cap th-cap-' + tool.cap.id, text: tool.cap.label, title: (tool.cap.boundary ? tool.cap.boundary + '\n\n' : '') + tool.cap.note }) : null,
          el('span', { class: 'th-group', text: SK.tools.groupName(tool.group) }),
        ]),
        el('p', { class: 'th-desc' }, [
          el('span', { text: tool.desc || '' }),
          tool.cap && tool.cap.boundary ? el('span', { class: 'th-bound', text: '边界：' + tool.cap.boundary }) : null,
        ]),
      ]),
      el('div', { class: 'th-actions' }, [
        el('button', {
          class: 'btn tiny' + (favList.includes(tool.id) ? ' on' : ''),
          text: favList.includes(tool.id) ? '★ 已收藏' : '☆ 收藏',
          onClick: (e) => {
            const list = SK.store.get('fav', []);
            const i = list.indexOf(tool.id);
            if (i >= 0) list.splice(i, 1);
            else list.push(tool.id);
            SK.store.set('fav', list);
            e.target.textContent = i >= 0 ? '☆ 收藏' : '★ 已收藏';
            e.target.classList.toggle('on', i < 0);
            SK.app.refreshSidebar();
          },
        }),
        el('button', { class: 'btn tiny', text: '🔗', title: '复制该工具直达链接', onClick: () => copy(location.href.split('#')[0] + '#/' + tool.id).then(() => SK.ui.toast('已复制工具链接', 'ok')) }),
        tool.help ? el('button', { class: 'btn tiny', text: '❔ 说明', onClick: () => SK.ui.openModal({ title: tool.name, wide: true, body: el('div', { class: 'help-body', html: tool.help }) }) }) : null,
      ]),
    ]);

    const optHost = el('div', { class: 'opt-host' });
    progress = el('div', { class: 'progress', style: { display: 'none' } });
    pbar = el('div', { class: 'pbar' });
    ptext = el('span', { class: 'ptext', text: '' });
    progress.appendChild(pbar);
    progress.appendChild(ptext);
    errLine = el('div', { class: 'errline', style: { display: 'none' } });
    runBtn = el('button', { class: 'btn btn-run' }, [el('span', { text: '▶ 运行 ' }), el('kbd', { text: '⌃⏎' })]);
    cancelBtn = el('button', { class: 'btn tiny danger', text: '停止', style: { display: 'none' } });
    auto = el('input', { type: 'checkbox', class: 'cb' });
    auto.checked = !!SK.store.get('autorun', false);
    modeBadge = el('span', { class: 'exec-mode' });
    runRow = el('div', { class: 'run-row' }, [runBtn, cancelBtn, el('label', { class: 'autorun', title: '输入或选项变化时自动运行（仅小数据）' }, [auto, el('span', { text: '实时' })]), modeBadge, progress, errLine]);

    outBody = el('div', { class: 'pane-body out-body' });
    outMeta = el('div', { class: 'out-meta' });
    const outHead = el('div', { class: 'pane-head' }, [
      el('span', { class: 'pane-title', text: '输出' }),
      el('span', { class: 'pane-tag run-time' }),
      el('span', { class: 'pane-spacer' }),
      el('button', { class: 'icon-btn', text: '⧉', title: '复制全部输出', onClick: () => doCopy() }),
      el('button', { class: 'icon-btn', text: '⤓', title: '下载输出', onClick: () => doDownload() }),
      el('span', { class: 'sendto' }, [
        el('button', { class: 'icon-btn', text: '↗', title: '把输出发送到其他工具', onClick: (e) => openSendMenu(e.target) }),
      ]),
      el('button', { class: 'icon-btn', text: '📌', title: '钉到钉子板（跨工具暂存，输入框 📎 可插入）', onClick: () => {
        const t = grabText();
        if (!t) return SK.ui.toast('先运行出结果再钉', 'warn');
        const pr = SK.pins.pin(t, tool.name + ' 输出', tool.id);
        if (pr.error) return SK.ui.toast(pr.error, 'error');
        if (pr.truncated) SK.ui.toast('内容超过 64KB，已截断保存前 ' + SK.dom.fmtNum(pr.savedLen) + ' 字符（完整内容请用复制/下载）', 'warn');
        else SK.ui.toast('已钉住 ' + SK.dom.fmtNum(t.length) + ' 字符 → 其他工具输入框 📎 插入', 'ok');
      } }),
    ]);
    const outPane = el('section', { class: 'pane pane-out' }, [outHead, outBody, outMeta]);

    const ctx = {
      host,
      tool,
      toolId: tool.id,
      get inputs() {
        return inputs;
      },
      get editors() {
        return inputs.map((i) => i.ed);
      },
      input(i) {
        return (inputs[i || 0] || {}).ed;
      },
      get opts() {
        return opts ? opts.values() : {};
      },
      optBar: null,
      out: outBody,
      outMeta,
      outHead,
      state,
      render: (res) => renderResult(res),
      error: (e) => showError(e),
      run: () => run(),
      touch: () => {
        if (auto.checked) scheduleAuto();
      },
      fillSample: (spec) => fillSample(spec),
      setSample: (key) => {
        ctx.sampleKey = key;
      },
      stage: null,
      fmtBytes,
      fmtNum,
      toast: SK.ui.toast,
    };

    const colIn = el('div', { class: 'col-in' });
    inputs = (tool.inputs || []).map((s) => makeInput(s, tool, ctx));
    inputs.forEach((i) => colIn.appendChild(i.pane));

    /* 恢复上次输入草稿（inject 之前） */
    {
      const restored = restoreDrafts(tool.id, inputs || []);
      if (restored) outMeta.appendChild(SK.render.notice({ level: 'info', msg: '已恢复上次输入（' + restored + ' 框）' }));
    }
    if (inputs.length > 1) colIn.classList.add('multi');

    const stage = el('div', { class: 'bench' });
    ctx.stage = stage;

    host.appendChild(head);

    /* 最近工具快捷条：逆向常在几个工具间横跳，一键切回 */
    {
      const recents = SK.store.get('recent', []).filter((x) => x !== tool.id).slice(0, 6);
      if (recents.length >= 2) {
        const bar = el('div', { class: 'recent-bar' }, [el('span', { class: 'rb-label', text: '最近' })]);
        recents.forEach((id) => {
          const t = SK.tools.byId[id];
          if (!t) return;
          bar.appendChild(el('button', { class: 'rb-item', text: t.name, title: '切回 ' + t.name, onClick: () => SK.app.go(id) }));
        });
        host.appendChild(bar);
      }
    }

    opts = SK.options.bar(optHost, tool.options || [], tool.id, (values, optId) => {
      ctx.touch();
      /* 工具级选项联动：onOptions(values, bar, optId) 可动态显隐其他选项 */
      if (typeof tool.onOptions === 'function') {
        try {
          tool.onOptions(values, opts, optId, ctx);
        } catch (e) {
          /* 联动失败不影响运行 */
        }
      }
    });
    ctx.optBar = opts;
    /* 挂载后立即应用一次选项联动（初始显隐） */
    if (typeof tool.onOptions === 'function') {
      try {
        tool.onOptions(opts.values(), opts, null, ctx);
      } catch (e) {}
    }
    if ((tool.options || []).length && !tool.hideRun) host.appendChild(optHost);
    if (!tool.hideRun) host.appendChild(runRow);

    if (tool.custom) {
      const customHost = el('div', { class: 'custom-host' });
      stage.appendChild(customHost);
      host.appendChild(stage);
      host.appendChild(outPane);
      ctx.customHost = customHost;
      outPane.style.display = tool.hideOutput ? 'none' : '';
      try {
        tool.mount(ctx);
      } catch (e) {
        showError(e);
      }
    } else {
      stage.appendChild(colIn);
      stage.appendChild(outPane);
      host.appendChild(stage);
      outBody.appendChild(
        el('div', { class: 'out-idle' }, [
          el('div', { class: 'oi-icon', text: tool.icon || '⌁' }),
          el('p', { text: tool.idleText || '粘贴数据后运行，或点右上角 ✨ 看示例' }),
          tool.hint ? el('p', { class: 'oi-sub', text: tool.hint }) : null,
        ])
      );
    }

    runBtn.addEventListener('click', () => run());
    cancelBtn.addEventListener('click', () => {
      SK.exec.cancel(state.taskId);
      SK.ui.toast('已停止（线程重启中）', 'warn');
    });
    auto.addEventListener('change', () => SK.store.set('autorun', auto.checked));

    scheduleAuto = SK.dom.debounce(() => {
      const first = inputs[0] && inputs[0].ed.getValue();
      if (!first) return;
      if (first.kind === 'text' && first.text.length > 400000) return;
      if (first.kind === 'file' || first.kind === 'blob') return;
      run();
    }, 460);

    host.addEventListener('tool-run', () => run());
    const keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        /* B14：编辑框内部已自行派发 tool-run，这里再跑一次会触发两遍 */
        const t = e.target;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && host.contains(t)) return;
        e.preventDefault();
        run();
      }
    };
    if (!tool.hideRun) document.addEventListener('keydown', keyHandler);
    SK.app.onLeave(() => {
      document.removeEventListener('keydown', keyHandler);
      if (state.running) SK.exec.cancel(state.taskId);
    });

    refreshMode();
    const modeTimer = setInterval(refreshMode, 700);
    SK.app.onLeave(() => clearInterval(modeTimer));

    function refreshMode() {
      const mode = SK.exec.mode;
      /* 徽标只描述「这个工具真实跑在哪」，不承诺「都在后台线程」：
         有 9 个工具本身标记 inline（要碰 DOM / 预览），它们永远在主线程 */
      const selfInline = !!tool.inline;
      modeBadge.textContent = selfInline ? '主线程（本工具）' : mode === 'worker' ? '后台线程' : mode === 'inline' ? '⚠ 主线程降级' : '启动中…';
      modeBadge.className = 'exec-mode ' + (selfInline ? 'inline' : mode);
      modeBadge.title = selfInline
        ? '这个工具依赖 DOM/预览，设计上就在主线程执行；大输入请先裁剪或改用同类后台线程工具'
        : mode === 'inline'
          ? '后台线程不可用（直接双击打开 html 时浏览器会禁用 Worker）。用 python3 -m http.server 打开可恢复。'
          : '这个工具的解析/转换在 Web Worker 里跑，不阻塞界面';
    }

    function fillSample(spec) {
      /* 条件样例：sample 为 {by, map, default} 时按当前选项值取键（如 js-env 按模式切 dump/源码） */
      const resolveKey = (s) => {
        if (s && typeof s === 'object' && s.by) {
          const cur = String(ctx.opts ? ctx.opts[s.by] : '');
          return (s.map && s.map[cur]) || s.default || null;
        }
        return s || null;
      };
      const key = resolveKey(spec && spec.sample) || ctx.sampleKey || resolveKey(tool.sample) || (spec && spec.sample) || tool.sample || tool.id;
      const text = SK.samples ? SK.samples.resolve(key) : '';
      if (!text) {
        SK.ui.toast('该工具没有内置示例', 'warn');
        return;
      }
      const target = spec ? inputs.find((i) => i.spec === spec) || inputs[0] : inputs[0];
      /* 一键完整示例：把所有带样例的输入框都填上，避免多输入工具半截报错。
         条件样例（sample = {by, map, default}）必须走 resolveKey，否则「补环境检测」这类
         按模式切样例的工具永远填到 default（JS 源码）而不是当前模式要的 dump JSON。 */
      let filled = 0;
      inputs.forEach(function (inp) {
        const own = inp.spec.sample;
        let k = own ? (typeof own === 'object' && own.by ? resolveKey(own) : (typeof own === 'object' ? own.default || own : own)) : resolveKey(tool.sample) || tool.id;
        const t = SK.samples ? SK.samples.resolve(typeof k === 'object' ? (k.default || k) : k) : '';
        if (!t) return;
        /* 没有自己样例的输入框：只在它是空的时候才用工具级样例兜底。
           否则多输入工具会把 JSONPath 这类「路径/表达式」框也填成样例 JSON，
           一点示例就报「路径解析失败」——第一次用就踩坑。
           small（单行小框：路径 / 模块 ID / 选择器 / 密钥）一律不兜底：
           它们装的是「参数」不是「数据」，塞一段 JSON 进去只会让工具报错。 */
        if (!own && (inp.spec.small || inp.spec.binary)) return;
        if (!own) {
          const cur = inp.ed.getValue();
          if (cur && cur.kind === 'text' && cur.text.trim()) return;
        }
        inp.ed.setValue(t);
        filled++;
      });
      if (!filled) target.ed.setValue(text);
      /* 多输入工具：只填了部分输入时不自动跑（避免半截报错） */
      const missing = inputs.filter(function (inp) {
        const v = inp.ed.getValue();
        return v.kind === 'text' && !v.text.trim() && !inp.spec.allowEmpty;
      }).length;
      if (tool.autoRun !== false && missing === 0) run();
      else if (missing > 0) SK.ui.toast('已填入示例，还差 ' + missing + ' 个输入请补齐后再运行', 'info');
    }

    async function run() {
      if (state.running) return;
      if (tool.custom && tool.needsRun === false) return tool.mount(ctx);
      /* B14：在任何 await 之前先锁定运行状态。旧实现先 await resolveValue 再置位，
         快速连按 ⌃⏎ 会同时进来两个 run（编辑框与 document 各触发一次）。 */
      state.running = true;
      setRunning(true);
      const bail = () => { state.running = false; setRunning(false); };
      const values = [];
      for (const inp of inputs) {
        const v = inp.ed.getValue();
        if (v.kind === 'text' && !v.text.trim() && !tool.allowEmpty && !inp.spec.allowEmpty) {
          showError(Object.assign(new Error('输入为空'), { hint: '点输入框右上角 ✨ 可填入示例数据' }));
          bail();
          return;
        }
        try {
          values.push(await resolveValue(v, tool, inp.spec));
        } catch (e) {
          showError(e);
          bail();
          return;
        }
      }
      /* 记录输入历史（每框最近 3 次，本地存储） */
      inputs.forEach((inp, i) => {
        const v = inp.ed ? inp.ed.getValue() : null;
        if (v && v.kind === 'text' && v.text && v.text.trim()) rememberInput(tool.id, inp.spec.id, v.text);
      });
      state.running = true;
      state.lastInputs = values.slice();
      setRunning(true);
      const t0 = performance.now();
      try {
        if (!tool.handler) throw new Error('该工具未定义处理函数');
        /* 统一兜底：任一工具在无选项场景（直调 / 配方 / 注入）下都拿到对象，
           避免 "Cannot read properties of undefined (reading 'flags')" 这类崩溃。 */
        const optsArg = ctx.opts || {};
        let res;
        if (tool.inline) res = await tool.handler.apply(null, values.concat([optsArg, { progress: () => {} }, ctx]));
        else res = await SK.exec.call(tool.handler, values.concat([optsArg]), {
          timeout: tool.timeout || (tool.bigFile ? 600000 : 150000),
          onProgress: (done, total, note) => showProgress(done, total, note),
          onTask: (id) => (state.taskId = id),
        });
        state.lastMs = performance.now() - t0;
        if (tool.post) res = tool.post(res, ctx) || res;
        /* 只在真正成功时留存：软失败（返回 {error}）不能覆盖上一次的好结果 */
        if (!(res && res.error)) state.lastResult = res;
        renderResult(res);
      } catch (e) {
        state.lastMs = performance.now() - t0;
        showError(e);
      } finally {
        state.running = false;
        setRunning(false);
      }
    }

    function setRunning(on) {
      runBtn.disabled = on;
      runBtn.classList.toggle('busy', on);
      cancelBtn.style.display = on ? '' : 'none';
      progress.style.display = on ? '' : 'none';
      if (!on) {
        pbar.style.width = '0%';
        ptext.textContent = '';
      }
      outHead.querySelector('.run-time').textContent = on ? '执行中…' : state.lastMs ? fmtMs(state.lastMs) : '';
    }

    function showProgress(done, total, note) {
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      pbar.style.width = pct + '%';
      pbar.classList.toggle('indeterm', !total);
      ptext.textContent = (total ? pct + '% ' : '') + (note || '');
      outHead.querySelector('.run-time').textContent = '执行中 ' + (total ? pct + '%' : '…');
    }

    /* 错误分类：把「输入写错了」「这个格式不支持」「本机容量不够」「执行崩了」
       分开说。原来所有失败都挂一句「换小数据或流式工具」，
       对语法错误、缺密钥、目标格式不支持这类问题完全是误导。 */
    function classifyError(e, softHint) {
      const msg = (e && e.message) || String(e);
      const code = String((e && e.code) || '');
      if (code === 'CANCEL' || /已取消|cancell?ed/i.test(msg)) return { kind: 'cancel', label: '已取消', hint: '中间结果已经保留在输出区，改完参数可以直接再跑' };
      if (code === 'TIMEOUT' || /超时/.test(msg)) return { kind: 'timeout', label: '执行超时', hint: '先用更小的片段定位问题；确属数据量大，改用「文件模式」或裁剪后再跑（后台线程可用时才能强制中断）' };
      if (code === 'BLOB_LIMIT' || /内存缓存|超过.*上限|MB 上限|容量/.test(msg)) return { kind: 'limit', label: '超出本机容量', hint: '这不是格式问题：把输入改成文件模式，或只取需要的那一段再分析' };
      if (/不支持|unsupported|未实现|not implemented/i.test(msg)) return { kind: 'unsupported', label: '当前不支持', hint: '先做一次转码/格式转换，或换一个能力相近的工具（首页可按能力类型筛）' };
      if (/输入为空|不是合法|解析失败|无法解析|缺少|需要.*框|格式错误|JSON/.test(msg)) return { kind: 'input', label: '输入问题', hint: '对照工具页的「输入」说明检查格式；多输入工具要确认内容填在正确的框里' };
      if (code === 'WORKER' || /Worker|后台线程|脚本加载失败/.test(msg)) return { kind: 'env', label: '运行环境问题', hint: '后台线程不可用时部分工具会降级或失败；用本地静态服务器（python3 -m http.server）打开可恢复' };
      return { kind: 'exec', label: '执行异常', hint: '先缩小到最小可复现片段；如果是本工具的 bug，错误信息本身就是线索' };
    }

    function showError(e) {
      const msg = (e && e.message) || String(e);
      const cls = classifyError(e);
      errLine.textContent = '[' + cls.label + '] ' + msg;
      errLine.style.display = '';
      setTimeout(() => (errLine.style.display = 'none'), 9000);
      const hint = (e && e.hint) || cls.hint;
      SK.render.result(outBody, { error: msg, hint: hint }, { tool, filename: tool.filename });
      outMeta.appendChild(SK.render.notice({ level: 'error', msg: cls.label + '：' + cls.hint }));
      /* 失败不要污染上一次的结果：留一个一键恢复 */
      if (state.lastResult) {
        outMeta.appendChild(
          el('button', {
            class: 'btn tiny',
            text: '↩ 恢复上次成功结果',
            onClick: () => {
              SK.dom.clear(outMeta);
              renderResult(state.lastResult);
            },
          })
        );
      }
      SK.app.markError(tool.id);
    }

    function renderResult(res) {
      /* 工具返回 {error} 的软失败：渲染错误卡的同时亮 errline、侧栏记红，
         不能当成功吞掉（否则回归全盲） */
      const softErr = res && res.error ? res.error : null;
      const cls = softErr ? classifyError(Object.assign(new Error(softErr), { hint: res && res.hint })) : null;
      if (softErr) {
        errLine.textContent = '[' + cls.label + '] ' + softErr;
        errLine.style.display = '';
        setTimeout(() => (errLine.style.display = 'none'), 9000);
      } else {
        errLine.style.display = 'none';
      }
      SK.dom.clear(outMeta);
      SK.render.result(outBody, res, { tool, filename: tool.filename, ctx, noMeta: true });
      const chips = [];
      if (res && res.stats) chips.push(SK.render.statsChips(res.stats));
      chips.forEach((c) => outMeta.appendChild(c));
      if (res && res.notices) res.notices.forEach((n) => outMeta.insertBefore(SK.render.notice(n), outMeta.firstChild));
      if (cls) outMeta.appendChild(SK.render.notice({ level: 'error', msg: cls.label + '：' + ((res && res.hint) || cls.hint) }));
      if (res && res.action) outMeta.appendChild(el('button', { class: 'btn tiny primary', text: res.action.label, onClick: () => res.action.onClick(ctx) }));
      /* 下一步建议：工具声明 res.next = [{label, tool, carry?}]，一键带数据接力 */
      if (res && !softErr && Array.isArray(res.next) && res.next.length) {
        const row = el('div', { class: 'next-steps' }, [el('span', { class: 'ns-label', text: '下一步：' })]);
        res.next.forEach((n) => {
          if (!SK.tools.byId[n.tool]) return;
          row.appendChild(el('button', {
            class: 'btn tiny ns-btn',
            text: n.label || ((SK.tools.byId[n.tool] || {}).name),
            title: '带本次输出跳到「' + ((SK.tools.byId[n.tool] || {}).name) + '」',
            onClick: () => {
              const carry = typeof n.carry === 'string' && n.carry in res ? res[n.carry] : (typeof res.text === 'string' ? res.text : '');
              SK.inject = { toolId: n.tool, text: String(carry || ''), from: tool.id, input: n.input || 0 };
              location.hash = '#/' + n.tool;
            },
          }));
        });
        if (row.children.length > 1) outMeta.appendChild(row);
      }
      if (softErr) SK.app.markError(tool.id);
      else SK.app.markSuccess(tool.id);
    }

    function currentText() {
      const first = outBody.querySelector('.out-body');
      const inst = first && first.viewer;
      if (inst && inst.getText) return inst.getText();
      const t = outBody.__lastText;
      return t || '';
    }

    function doCopy() {
      const t = grabText();
      if (!t) return SK.ui.toast('没有可复制的输出', 'warn');
      copy(t).then(() => SK.ui.toast('已复制 ' + fmtNum(t.length) + ' 字符', 'ok'));
    }

    function doDownload() {
      const t = grabText();
      if (!t) return SK.ui.toast('没有可下载的输出', 'warn');
      const name = (tool.filename || tool.id) + guessExt(t);
      download(t, name, 'text/plain');
      SK.ui.toast('已下载 ' + name, 'ok');
    }

    function grabText() {
      /* 优先当前页签内容（复制/钉住/发送与所见一致） */
      if (outBody.__getActiveText) {
        try { const t = outBody.__getActiveText(); if (t) return t; } catch (e) {}
      }
      const res = state.lastResult;
      if (!res) return '';
      if (typeof res === 'string') return res;
      if (res.text) return res.text;
      if (res.code) return res.code;
      if (res.outputs && res.outputs[0]) return res.outputs[0].text || '';
      if (res.lines) return res.lines.join('\n');
      /* 纯视图结果（图片 / HTML 预览）：视图内部有自己的下载与复制；
         这里兜底给出可下载的 base64，避免顶部「复制/下载」变成静默失败。 */
      if (res.view === 'image' && res.data && res.data.b64) return res.data.b64;
      return '';
    }

    function guessExt(t) {
      const l = SK.render.guessLang(t);
      return { json: '.json', python: '.py', js: '.js', html: '.html', sql: '.sql' }[l] || '.txt';
    }

    function openSendMenu(anchor) {
      const t = grabText();
      if (!t) return SK.ui.toast('先运行出结果再发送', 'warn');
      const list = SK.tools.registry.filter((x) => x.id !== tool.id && !x.noReceive);
      const menu = el('div', { class: 'send-menu' });
      const search = el('input', { class: 'mini-search', placeholder: '选择目标工具…', onInput: () => fill(search.value) });
      menu.appendChild(search);
      const scrollBox = el('div', { class: 'sm-list' });
      menu.appendChild(scrollBox);
      function fill(q) {
        SK.dom.clear(scrollBox);
        SK.tools.search(q || '').slice(0, 60).forEach((x) => {
          scrollBox.appendChild(el('button', { class: 'sm-item', text: x.name, onClick: () => {
              SK.inject = { toolId: x.id, text: t, from: tool.id };
              menu.remove();
              location.hash = '#/' + x.id;
            } }));
        });
      }
      fill('');
      menu.style.left = anchor.getBoundingClientRect().left + 'px';
      menu.style.top = anchor.getBoundingClientRect().bottom + 6 + 'px';
      document.body.appendChild(menu);
      search.focus();
      const close = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('mousedown', close);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', close), 10);
      SK.app.onLeave(() => menu.remove());
    }

    if (SK.inject && SK.inject.toolId === tool.id) {
      const inj = SK.inject;
      SK.inject = null;
      const targetIn = inputs[inj.input || 0] || inputs[0];
      if (targetIn) {
        targetIn.ed.setValue(inj.text);
        outMeta.appendChild(SK.render.notice({ level: 'ok', msg: '已接收来自「' + (SK.tools.byId[inj.from] || {}).name + '」的输出' }));
        if (tool.autoRun !== false) run();
      }
    }

    if (tool.autoSample) fillSample(inputs[0] ? inputs[0].spec : null);

    /* autoExec：速查/生成类工具打开即出结果，不用手点运行 */
    if (tool.autoExec) run();

    return ctx;
  }

  SK.workbench = { mount, resolveValue };
})(typeof window !== 'undefined' ? window : globalThis);
