/* 文本对比：文本 diff / JSON diff / 字符串差集 */
(function () {

  SK.tool({
    id: 'text-diff',
    name: '文本对比',
    group: 'text',
    icon: '±',
    aliases: 'diff 对比 文本比较 差异',
    keywords: ['diff', '对比', '比较', '差异', '文本'],
    desc: '逐行对比两份文本：行号对照、增删改标色、相似行配对、可选忽略空白/大小写，并输出统一 diff 补丁',
    sample: 'texta',
    hint: '两份内容分别粘到左边两个输入框；N 行以上的大文件会切到近似算法保证不卡',
    inputs: [
      { id: 'a', label: '原文 A', placeholder: '第一份文本', sample: 'texta' },
      { id: 'b', label: '新文 B', placeholder: '第二份文本', sample: 'textb' },
    ],
    options: [
      { id: 'ws', type: 'toggle', label: '忽略空白', value: false },
      { id: 'case', type: 'toggle', label: '忽略大小写', value: false },
      { id: 'blank', type: 'toggle', label: '忽略空行', value: false },
      { id: 'ctx', type: 'number', label: '上下文行', value: 3, min: 0, max: 20 },
    ],
    handler: function (a, b, opts, hooks) {
      const A = String(a == null ? '' : a);
      const B = String(b == null ? '' : b);
      if (!A && !B) return { error: '两侧都为空' };
      const o = { ignoreWhitespace: !!opts.ws, ignoreCase: !!opts.case, ignoreBlankLines: !!opts.blank, context: Number(opts.ctx || 3), largeThreshold: 250000 };
      const r = SK.diff.lines(A, B, o, hooks);
      const AR = r.A || [];
      const BR = r.B || [];
      const evs = r.events || [];
      const rows = [];
      const canIntra = !r.stats.approximated;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.t === 0) {
          rows.push({ la: e.ai + 1, lb: e.bi + 1, t: '=', old: AR[e.ai], neu: BR[e.bi] });
        } else if (e.t === 3) {
          const oa = AR[e.ai], nb = BR[e.bi];
          /* 修改行：把词级差异算成 segs，旧列只保留 eq/del，新列只保留 eq/ins */
          const segs = canIntra && oa.length + nb.length <= 4000 ? SK.diff.intra(oa, nb, 'word') : null;
          rows.push({
            la: e.ai + 1, lb: e.bi + 1, t: '~', old: oa, neu: nb,
            oldParts: segs ? segs.filter(function (s) { return s.op !== 'ins'; }).map(function (s) { return { k: s.op === 'del' ? 'del' : 'eq', s: s.text }; }) : null,
            neuParts: segs ? segs.filter(function (s) { return s.op !== 'del'; }).map(function (s) { return { k: s.op === 'ins' ? 'ins' : 'eq', s: s.text }; }) : null,
          });
        } else if (e.t === 1) {
          rows.push({ la: e.ai + 1, lb: '', t: '-', old: AR[e.ai], neu: '' });
        } else {
          rows.push({ la: '', lb: e.bi + 1, t: '+', old: '', neu: BR[e.bi] });
        }
      }
      const patch = SK.diff.patch(A, B, o);
      const s = r.stats;
      const unchanged = s.identical;
      return {
        text: patch,
        lang: 'diff',
        tabLabel: '统一 diff',
        tabs: [
          { label: '并排对照 (' + SK.dom.fmtNum(rows.length) + ' 行)', view: 'table', data: {
              columns: [
                { key: 'la', label: 'A', width: '62px' },
                { key: 'old', label: '原文', parts: 'oldParts' },
                { key: 't', label: '', width: '38px', diffMap: { '+': 'add', '-': 'del', '~': 'mod', __default: 'eq' } },
                { key: 'lb', label: 'B', width: '62px' },
                { key: 'neu', label: '新文', parts: 'neuParts' },
              ],
              rows: rows, name: 'diff',
              rowCls: { field: 't', map: { '+': 'row-add', '-': 'row-del', '~': 'row-mod' } },
              filterHint: '只看变化：输入 ^[~+-]；或直接搜关键词',
            } },
        ],
        stats: [
          { k: '相同行', v: SK.dom.fmtNum(s.unchanged) },
          { k: '新增', v: SK.dom.fmtNum(s.added), level: 'ok' },
          { k: '删除', v: SK.dom.fmtNum(s.removed), level: 'warn' },
          { k: '修改', v: SK.dom.fmtNum(s.changedLines), level: s.changedLines ? 'warn' : '' },
          { k: '相似度', v: (s.similarity * 100).toFixed(1) + '%' },
          { k: '耗时', v: SK.dom.fmtMs(s.timeMs) },
        ],
        notices: unchanged ? [{ level: 'ok', msg: '两份内容完全一致' }] : s.approximated ? [{ level: 'warn', msg: '数据量较大，已启用近似对齐（结果可能有少量偏差）' }] : null,
        filename: 'changes',
      };
    },
  });

  SK.tool({
    id: 'json-diff',
    name: 'JSON 对比',
    group: 'text',
    icon: '{±}',
    aliases: 'json diff 对比 比较 差异 结构',
    keywords: ['json', 'diff', '对比', '比较', '结构', '字段'],
    desc: '按结构对比两个 JSON：精确到字段路径的增删改，数组自动按 id 等主键匹配，避免“改一个字段就全红”',
    sample: 'json',
    inputs: [
      { id: 'a', label: 'JSON A', placeholder: '旧响应', sample: 'json' },
      { id: 'b', label: 'JSON B', placeholder: '新响应', sample: 'json-b' },
    ],
    options: [
      { id: 'numStr', type: 'toggle', label: '数字与字符串等值', value: false, title: '1 与 "1" 视为相同' },
      { id: 'arraySet', type: 'toggle', label: '数组按集合比较', value: false },
      { id: 'ignoreKeys', type: 'tags', label: '忽略字段', value: [], placeholder: 'timestamp, traceId' },
    ],
    handler: function (a, b, opts, hooks) {
      opts = opts || {};
      const A = String(a == null ? '' : a);
      const B = String(b == null ? '' : b);
      /* tags 给的是数组，但手输/直调可能给 "traceId, ts" 这种字符串。
         不归一化就会被 compileGlobs 当成字符数组逐个匹配，等于完全失效。 */
      const rawIgn = opts.ignoreKeys;
      let ignList = [];
      if (Array.isArray(rawIgn)) ignList = rawIgn.slice();
      else if (typeof rawIgn === 'string') ignList = rawIgn.split(/[,，\s]+/);
      ignList = ignList.map((x) => String(x).trim()).filter(Boolean);
      const r = SK.diff.json(A, B, { treatNumericStringEqual: !!opts.numStr, arrayAsSet: !!opts.arraySet, ignorePaths: ignList.length ? ignList : null }, hooks);
      if (r.tooLarge) return { error: 'JSON 太大，无法做结构对比：' + (r.hint || ''), hint: '改用「文本对比」或先把两边裁剪到需要的子树' };
      if (r.error) return { error: '对比失败：' + (r.error.message || r.error) };
      const nodes = r.nodes || [];
      const rows = nodes.map((n) => {
        /* BigInt（超过 2^53 的整数）不能进 JSON.stringify，统一走保真 dump */
        const show = (v) => (v === undefined ? '' : v === null ? 'null' : typeof v === 'object' ? (SK.jsonx ? SK.jsonx.dump(v, 0) : JSON.stringify(v)) : String(v));
        const before = show(n.before);
        const after = show(n.after);
        let oldParts = null, neuParts = null;
        if (n.type === 'changed' && before.length + after.length <= 400) {
          const segs = SK.diff.intra(before, after, 'word');
          oldParts = segs.filter((s) => s.op !== 'ins').map((s) => ({ k: s.op === 'del' ? 'del' : 'eq', s: s.text }));
          neuParts = segs.filter((s) => s.op !== 'del').map((s) => ({ k: s.op === 'ins' ? 'ins' : 'eq', s: s.text }));
        }
        return {
          type: n.type === 'added' ? '+' : n.type === 'removed' ? '-' : n.type === 'moved' ? '↕' : '~',
          path: n.path,
          before: before,
          after: after,
          kind: n.type,
          oldParts: oldParts,
          neuParts: neuParts,
        };
      });
      const changedRows = rows.filter((x) => x.kind !== 'same');
      const lines = changedRows.map((x) => x.type + ' ' + x.path + (x.kind === 'changed' ? '\n    - ' + x.before + '\n    + ' + x.after : x.kind === 'added' ? '  → ' + x.after : x.kind === 'removed' ? '  ← ' + x.before : ''));
      const stats = r.stats || {};
      return {
        text: lines.join('\n') || '两个 JSON 结构完全一致',
        lang: 'text',
        tabs: [
          { label: '差异 (' + changedRows.length + ')', view: 'table', data: {
              columns: [
                { key: 'type', label: '', width: '38px', diffMap: { '+': 'add', '-': 'del', '↕': 'eq', __default: 'mod' } },
                { key: 'path', label: '路径' },
                { key: 'before', label: 'A', parts: 'oldParts' },
                { key: 'after', label: 'B', parts: 'neuParts' },
              ],
              rows: changedRows, name: 'json-diff',
              rowCls: { field: 'kind', map: { added: 'row-add', removed: 'row-del', changed: 'row-mod', 'type-changed': 'row-mod' } },
              filterHint: '按路径过滤',
            } },
        ],
        stats: [
          { k: '新增', v: stats.added || 0, level: 'ok' },
          { k: '删除', v: stats.removed || 0, level: 'warn' },
          { k: '修改', v: stats.changed || 0 },
          { k: '相同', v: SK.dom.fmtNum(stats.unchanged || 0) },
          { k: '一致度', v: (stats.samePercent == null ? 100 : Number(stats.samePercent).toFixed(1)) + '%' },
        ],
        notices: changedRows.length ? null : [{ level: 'ok', msg: '两个 JSON 完全一致' }],
        filename: 'json-diff',
      };
    },
  });

  SK.tool({
    id: 'set-diff',
    name: '字符串差集',
    group: 'text',
    icon: '⊖',
    aliases: 'set diff 差集 交集 去重 集合',
    keywords: ['set', 'diff', '差集', '交集', '去重', '集合'],
    desc: '按行做集合运算：只在 A、只在 B、两边都有，支持去重、去空白、按分隔符切分，导出 CSV',
    sample: 'urls',
    inputs: [
      { id: 'a', label: '集合 A', placeholder: '一行一个', sample: 'urls' },
      { id: 'b', label: '集合 B', placeholder: '一行一个', sample: 'urls2' },
    ],
    options: [
      { id: 'split', type: 'text', label: '切分符', value: '', placeholder: '留空=按行；可填 , 或 |' },
      { id: 'trim', type: 'toggle', label: '去首尾空白', value: true },
      { id: 'dedupe', type: 'toggle', label: '去重', value: true },
      { id: 'case', type: 'toggle', label: '区分大小写', value: true },
    ],
    handler: function (a, b, opts) {
      const A = String(a == null ? '' : a);
      const B = String(b == null ? '' : b);
      if (!A && !B) return { error: '两侧都为空' };
      const splitBy = opts.split ? String(opts.split) : '\n';
      const r = SK.diff.setDiff(A, B, { splitBy: splitBy, trim: !!opts.trim, dedupe: !!opts.dedupe, caseSensitive: !!opts.case, keepOrder: true, limit: 500000 });
      const onlyA = r.onlyA || [];
      const onlyB = r.onlyB || [];
      const both = (r.both || []).map((x) => (typeof x === 'string' ? x : x.line));
      return {
        text: '仅在 A（' + onlyA.length + '）:\n' + onlyA.join('\n') + '\n\n仅在 B（' + onlyB.length + '）:\n' + onlyB.join('\n') + '\n\n交集（' + both.length + '）:\n' + both.join('\n'),
        lang: 'text',
        tabs: [
          { label: '仅 A (' + onlyA.length + ')', text: onlyA.join('\n'), lang: 'text' },
          { label: '仅 B (' + onlyB.length + ')', text: onlyB.join('\n'), lang: 'text' },
          { label: '交集 (' + both.length + ')', text: both.join('\n'), lang: 'text' },
        ],
        stats: [{ k: '仅 A', v: SK.dom.fmtNum(onlyA.length) }, { k: '仅 B', v: SK.dom.fmtNum(onlyB.length) }, { k: '交集', v: SK.dom.fmtNum(both.length) }],
        notices: r.stats && r.stats.truncated ? [{ level: 'warn', msg: '超出上限已截断' }] : null,
        filename: 'set-diff',
      };
    },
  });
})();
