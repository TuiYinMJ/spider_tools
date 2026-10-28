/* ============================================================================
   Spider Lab · recipes.js
   管道配方：把「↗ 发送到」的接力链存成可复现的流程。

   配方 = 步骤数组，每步形如 { tool, opts, out, input }：
     tool   工具 ID（兼容旧格式：直接写字符串）
     opts   该步使用的选项（保存时快照，保证可复现；缺失则用工具默认值）
     out    取哪一路输出：'text' | 'code' | 数字下标 | 页签名
     input  多输入工具把上一步结果喂给第几个输入框（单输入工具忽略）

   B07 修复要点：
     · skipped 从未声明 → 单步成功配方必抛 ReferenceError，运行按钮永久禁用
     · 运行前做兼容性预检，不兼容直接拒绝，而不是默默跳过核心步骤
     · 支持取消；任何路径都用 try/finally 恢复按钮并保留中间结果
   ========================================================================== */
(function () {
  const { el } = SK.dom;

  /* 内置示例（首次生成）——每一步都用真实样例端到端验证过 */
  const BUILTIN = [
    { id: 'b64-gunzip', name: 'Base64 → 解压 → JSON 识别', desc: '响应/参数里的 base64(gzip(payload)) 一层扒开', steps: [{ tool: 'gunzip', opts: { enc: 'auto', fmt: 'auto' }, out: 'text' }] },
    { id: 'url-clean', name: 'URL 解码 → 参数提取', desc: '把编码过的跳转链接还原成可读参数表', steps: [{ tool: 'url-decode', out: 'text' }, { tool: 'url-params', out: 'text' }] },
    { id: 'curl-requests', name: 'cURL → requests 代码', desc: '浏览器复制的 cURL 直接转成可运行 Python', steps: [{ tool: 'curl-requests', out: 'text' }] },
  ];

  function list() {
    const saved = SK.store.get('recipes', null);
    if (saved) return saved;
    SK.store.set('recipes', BUILTIN);
    return BUILTIN;
  }

  function normalizeSteps(steps) {
    return (steps || []).map((s) => (typeof s === 'string' ? { tool: s, opts: null, out: 'text' } : Object.assign({ out: 'text' }, s)));
  }

  /* 运行前预检：把「跑不完 / 跑出来是垃圾」的情况挡在运行之前 */
  function plan(recipe) {
    const steps = normalizeSteps(recipe.steps);
    const problems = [];
    const ready = [];
    steps.forEach((st, i) => {
      const tool = SK.tools.byId[st.tool];
      if (!tool) { problems.push({ i: i, tool: st.tool, reason: '工具不存在（可能已改名或移除）' }); return; }
      if (tool.custom) { problems.push({ i: i, tool: st.tool, name: tool.name, reason: '需要交互界面，不能在配方里自动跑' }); return; }
      const n = (tool.inputs || []).length;
      if (n > 1 && st.input == null) { problems.push({ i: i, tool: st.tool, name: tool.name, reason: '有 ' + n + ' 个输入框，需要指定上一步结果喂给哪一个' }); return; }
      if (st.input != null && st.input >= n) { problems.push({ i: i, tool: st.tool, name: tool.name, reason: '指定的输入框下标 ' + st.input + ' 越界' }); return; }
      ready.push({ i: i, step: st, tool: tool });
    });
    return { steps: steps, ready: ready, problems: problems };
  }

  function defaultOpts(tool) {
    const o = {};
    (tool.options || []).forEach((s) => { if (s.value !== undefined) o[s.id] = s.value; });
    return o;
  }

  /* 从结果里取出该步要接力的文本 */
  function pickOut(res, want) {
    if (res == null) return '';
    if (typeof res === 'string') return res;
    if (want === 'code' && res.code !== undefined) return String(res.code);
    if (Array.isArray(res.outputs) && res.outputs.length) {
      if (typeof want === 'number' && res.outputs[want]) return String(res.outputs[want].text == null ? '' : res.outputs[want].text);
      if (typeof want === 'string' && want !== 'text' && want !== 'code') {
        const hit = res.outputs.find((o) => o.label === want);
        if (hit) return String(hit.text == null ? '' : hit.text);
      }
      const first = res.outputs.find((o) => typeof o.text === 'string');
      if (first) return first.text;
    }
    if (res.text !== undefined) return String(res.text);
    if (res.code !== undefined) return String(res.code);
    return '';
  }

  /* 执行一个配方；返回 { ok, refused, failedAt, skipped, text, steps[] } */
  async function runRecipe(recipe, inputText, onStep, ctl) {
    ctl = ctl || {};
    let text = String(inputText == null ? '' : inputText);
    let skipped = 0;
    const p = plan(recipe);

    if (p.problems.length) {
      p.problems.forEach((pr) => onStep(pr.i, 'skip', (pr.name ? pr.name + '：' : pr.tool + '：') + pr.reason));
      return { ok: false, refused: true, skipped: p.problems.length, problems: p.problems, text: text, steps: [] };
    }

    const trace = [];
    for (let k = 0; k < p.ready.length; k++) {
      const item = p.ready[k];
      const i = item.i;
      const tool = item.tool;
      if (ctl.cancelled && ctl.cancelled()) { onStep(i, 'skip', '已取消'); return { ok: false, cancelled: true, skipped: skipped, text: text, steps: trace }; }
      const opts = Object.assign(defaultOpts(tool), item.step.opts || {});
      onStep(i, 'run', tool.name + (Object.keys(item.step.opts || {}).length ? '（已存选项）' : '（默认选项）'));
      let res;
      try {
        /* 与 panel.js 保持一致：values.concat([opts, hooks, ctx]) */
        const args = (tool.inputs || []).length > 1
          ? (tool.inputs || []).map((inp, idx) => (idx === (item.step.input || 0) ? text : '')).concat([opts])
          : [text, opts];
        res = await SK.exec.call(tool.handler, args, { timeout: 120000 });
      } catch (e) {
        onStep(i, 'fail', e && e.message ? e.message : String(e));
        return { ok: false, failedAt: i, skipped: skipped, text: text, steps: trace };
      }
      if (res && res.error) {
        onStep(i, 'fail', String(res.error));
        return { ok: false, failedAt: i, skipped: skipped, text: text, steps: trace };
      }
      const out = pickOut(res, item.step.out);
      trace.push({ i: i, tool: tool.id, name: tool.name, out: out });
      if (!out && !(res && (res.tabs || res.outputs))) {
        onStep(i, 'fail', '该步没有文本输出，无法接力（可在配方里指定 out 取某一路）');
        return { ok: false, failedAt: i, skipped: skipped, text: text, steps: trace };
      }
      text = out;
      onStep(i, 'ok', SK.dom.fmtNum(text.length) + ' 字符');
    }
    return { ok: true, skipped: skipped, text: text, steps: trace };
  }

  /* 配方运行对话框 */
  function openRunDialog(recipe) {
    const runModalRef = {};
    const input = el('textarea', {
      class: 'recipe-input',
      placeholder: '初始输入（第一步工具的输入内容）…',
      spellcheck: 'false',
    });
    const logBox = el('div', { class: 'recipe-log' });
    const outBox = el('textarea', { class: 'recipe-out', readonly: 'readonly', placeholder: '最终输出…', style: { display: 'none' } });
    const runBtn = el('button', { class: 'btn primary', text: '▶ 运行配方' });
    const cancelBtn = el('button', { class: 'btn', text: '■ 取消', disabled: true });
    let cancelled = false;
    const stepsBar = el('div', { class: 'recipe-steps' }, normalizeSteps(recipe.steps).map((st) => el('span', { class: 'recipe-step', text: (SK.tools.byId[st.tool] || { name: st.tool }).name, title: st.out && st.out !== 'text' ? '取输出：' + st.out : '' })));

    const pre = plan(recipe);
    const preBox = pre.problems.length
      ? el('div', { class: 'recipe-precheck err', text: '⚠ 运行前检查未通过，共 ' + pre.problems.length + ' 处：' + pre.problems.map((x) => '第 ' + (x.i + 1) + ' 步 ' + (x.name || x.tool) + '（' + x.reason + '）').join('；') })
      : el('div', { class: 'recipe-precheck ok', text: '✓ 运行前检查通过：' + pre.ready.length + ' 步全部可执行' });

    const body = el('div', { class: 'recipe-body' }, [
      el('div', { class: 'recipe-chain' }, [el('b', { text: '链路：' }), stepsBar]),
      preBox,
      input,
      el('div', { class: 'chips-row', style: { justifyContent: 'flex-start', margin: '10px 0' } }, [
        runBtn,
        cancelBtn,
        el('button', { class: 'btn', text: '⧉ 复制结果', onClick: () => outBox.value && SK.dom.copy(outBox.value).then(() => SK.ui.toast('已复制', 'ok')) }),
        el('button', { class: 'btn', text: '↗ 结果送入工具', onClick: () => { if (!outBox.value) return SK.ui.toast('先运行出结果', 'warn'); const last = normalizeSteps(recipe.steps).slice(-1)[0]; const tid = last && last.tool; if (!tid || !SK.tools.byId[tid]) return SK.ui.toast('末步工具不存在', 'warn'); SK.inject = { toolId: tid, text: outBox.value, from: 'recipe' }; location.hash = '#/' + tid; if (runModalRef.close) runModalRef.close(); } }),
      ]),
      logBox,
      outBox,
    ]);

    cancelBtn.addEventListener('click', () => { cancelled = true; cancelBtn.disabled = true; SK.ui.toast('已请求取消，当前步骤结束后停止', 'warn'); });

    runBtn.addEventListener('click', async () => {
      if (!input.value.trim()) return SK.ui.toast('先填初始输入', 'warn');
      SK.dom.clear(logBox);
      runBtn.disabled = true;
      cancelBtn.disabled = false;
      cancelled = false;
      const onStep = (i, st, msg) => {
        const stp = normalizeSteps(recipe.steps)[i] || {};
        const name = (SK.tools.byId[stp.tool] || { name: stp.tool || i }).name;
        const icon = st === 'ok' ? '✓' : st === 'fail' ? '✕' : st === 'run' ? '…' : '→';
        const cls = st === 'ok' ? 'ok' : st === 'fail' ? 'err' : 'skip';
        logBox.appendChild(el('div', { class: 'recipe-log-line ' + cls, text: icon + ' [' + (i + 1) + '] ' + name + (msg ? ' — ' + msg : '') }));
      };
      let r;
      try {
        r = await runRecipe(recipe, input.value, onStep, { cancelled: () => cancelled });
      } catch (e) {
        /* B07：任何异常都必须恢复按钮，否则运行按钮永久禁用 */
        logBox.appendChild(el('div', { class: 'recipe-log-line err', text: '✕ 配方引擎异常：' + (e && e.message ? e.message : e) }));
        r = { ok: false, failedAt: -1, text: '' };
      } finally {
        runBtn.disabled = false;
        cancelBtn.disabled = true;
      }
      if (r.refused) {
        logBox.appendChild(el('div', { class: 'recipe-log-line err', text: '✕ 已拒绝运行：修好上面的步骤后再跑，避免得到半成品结果' }));
        return;
      }
      if (r.cancelled) {
        logBox.appendChild(el('div', { class: 'recipe-log-line skip', text: '■ 已取消，保留最后一步的中间结果' }));
        outBox.style.display = '';
        outBox.value = r.text || '(无文本输出)';
        return;
      }
      if (r.ok) {
        outBox.style.display = '';
        outBox.value = r.text || '(无文本输出)';
        logBox.appendChild(el('div', { class: 'recipe-log-line ok', text: '✓ 完成，输出 ' + SK.dom.fmtNum((r.text || '').length) + ' 字符' }));
        if (r.skipped) logBox.appendChild(el('div', { class: 'recipe-log-line err', text: '⚠ 跳过了 ' + r.skipped + ' 步，结果可能不是最终产物' }));
      } else {
        outBox.style.display = '';
        outBox.value = r.text || '';
        logBox.appendChild(el('div', { class: 'recipe-log-line err', text: '✕ 链路在第 ' + (r.failedAt + 1) + ' 步中断，上面已保留中间内容，可手动送入对应工具' }));
      }
    });

    const runModal = SK.ui.openModal({ title: '🧪 ' + recipe.name + '（' + normalizeSteps(recipe.steps).length + ' 步）', wide: true, body });
    runModalRef.close = runModal && runModal.close;
  }

  /* 新建/管理对话框 */
  function openManage() {
    const recipes = list();
    const box = el('div', { class: 'recipe-manage' });
    const render = () => {
      SK.dom.clear(box);
      recipes.forEach((r, i) => {
        const pre = plan(r);
        box.appendChild(el('div', { class: 'recipe-row' }, [
          el('div', { class: 'recipe-meta' }, [
            el('b', { text: r.name }),
            el('span', { class: 'recipe-desc', text: normalizeSteps(r.steps).map((s) => (SK.tools.byId[s.tool] || { name: s.tool }).name).join(' → ') }),
            pre.problems.length ? el('span', { class: 'recipe-badge bad', text: pre.problems.length + ' 处不可执行', title: pre.problems.map((x) => x.reason).join('；') }) : el('span', { class: 'recipe-badge ok', text: '可执行' }),
          ]),
          el('div', { class: 'recipe-acts' }, [
            el('button', { class: 'btn tiny primary', text: '▶ 运行', onClick: () => openRunDialog(r) }),
            el('button', { class: 'btn tiny', text: '复制', onClick: () => { recipes.push(Object.assign({}, r, { id: 'r' + Date.now(), name: r.name + ' 副本' })); SK.store.set('recipes', recipes); render(); } }),
            el('button', { class: 'btn tiny danger', text: '删除', onClick: () => { recipes.splice(i, 1); SK.store.set('recipes', recipes); render(); } }),
          ]),
        ]));
      });
    };
    render();

    const nameIn = el('input', { type: 'text', placeholder: '配方名，如 密文→解压→JSON', class: 'opt-text' });
    const steps = [];
    const pick = el('select', { class: 'opt-select' });
    SK.tools.registry.filter((t) => !t.custom).forEach((t) => {
      pick.appendChild(el('option', { value: t.id, text: t.name + (((t.inputs || []).length > 1) ? '（多输入）' : '') }));
    });
    const addBtn = el('button', { class: 'btn tiny', text: '＋ 添加步骤' });
    const stepBar = el('div', { class: 'recipe-steps-edit' });
    const optBar = el('div', { class: 'recipe-opts' });

    let optCtl = null;
    function editStep(idx) {
      SK.dom.clear(optBar);
      optCtl = null;
      const st = steps[idx];
      if (!st) return;
      const tool = SK.tools.byId[st.tool];
      if (!tool) return;
      optBar.appendChild(el('div', { class: 'recipe-opt-title', text: '第 ' + (idx + 1) + ' 步「' + tool.name + '」的选项（会随配方一起保存）' }));
      const host = el('div', { class: 'opt-bar' });
      optBar.appendChild(host);
      st.opts = st.opts || defaultOpts(tool);
      optCtl = SK.options.bar(host, tool.options || [], 'recipe:' + tool.id, () => {
        st.opts = Object.assign({}, optCtl.values());
      });
      if ((tool.inputs || []).length > 1) {
        const sel = el('select', { class: 'opt-select' });
        (tool.inputs || []).forEach((inp, k) => sel.appendChild(el('option', { value: String(k), text: '上一步结果送入：' + (inp.label || inp.id) })));
        sel.value = String(st.input || 0);
        sel.addEventListener('change', () => { st.input = Number(sel.value); });
        optBar.appendChild(sel);
      }
      const outSel = el('select', { class: 'opt-select' });
      [{ v: 'text', t: '取主输出' }, { v: 'code', t: '取代码输出' }].forEach((x) => outSel.appendChild(el('option', { value: x.v, text: x.t })));
      outSel.value = st.out || 'text';
      outSel.addEventListener('change', () => { st.out = outSel.value; });
      optBar.appendChild(outSel);
    }

    const syncBar = () => {
      SK.dom.clear(stepBar);
      steps.forEach((st, i) => {
        stepBar.appendChild(el('span', {
          class: 'recipe-step' + (st === steps[steps.length - 1] ? ' on' : ''),
          text: (i + 1) + '.' + (SK.tools.byId[st.tool] || { name: st.tool }).name,
          title: '点击选中并可编辑选项；双击移除',
          onClick: () => { editStep(i); syncBar(); },
          onDblclick: () => { steps.splice(i, 1); SK.dom.clear(optBar); syncBar(); },
        }));
      });
    };
    addBtn.addEventListener('click', () => {
      if (!pick.value) return;
      steps.push({ tool: pick.value, opts: null, out: 'text' });
      syncBar();
      editStep(steps.length - 1);
    });
    const saveBtn = el('button', { class: 'btn primary', text: '保存配方' });
    saveBtn.addEventListener('click', () => {
      if (!nameIn.value.trim() || steps.length < 1) return SK.ui.toast('填名称并至少加 1 步', 'warn');
      const rec = { id: 'r' + Date.now(), name: nameIn.value.trim(), steps: steps.map((s) => ({ tool: s.tool, opts: s.opts || null, out: s.out || 'text', input: s.input })) };
      const pre = plan(rec);
      if (pre.problems.length) return SK.ui.toast('第 ' + (pre.problems[0].i + 1) + ' 步不可执行：' + pre.problems[0].reason, 'error');
      recipes.push(rec);
      SK.store.set('recipes', recipes);
      nameIn.value = ''; steps.length = 0; SK.dom.clear(optBar); syncBar(); render();
      SK.ui.toast('已保存', 'ok');
    });

    const body = el('div', {}, [
      box,
      el('hr'),
      el('h4', { text: '新建配方' }),
      el('div', { class: 'chips-row', style: { justifyContent: 'flex-start', gap: '8px' } }, [nameIn, pick, addBtn, saveBtn]),
      stepBar,
      optBar,
      el('p', { class: 'out-hint', text: '运行方式：上一步的文本输出自动作为下一步输入；每步选项会随配方保存，保证可复现。点击步骤标签编辑选项，双击移除。运行前会做兼容性检查，不兼容直接拒绝而不是默默跳过。' }),
    ]);
    SK.ui.openModal({ title: '🧪 管道配方', wide: true, body });
  }

  /* 首页挂载入口（由 app.js 调用） */
  SK.recipes = { openManage, openRunDialog, list, plan, runRecipe, normalizeSteps, defaultOpts };
})();
