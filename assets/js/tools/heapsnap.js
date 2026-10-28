/* ============================================================================
   Spider Lab · heapsnap.js
   V8 堆快照分析：解析 DevTools Memory 导出的 .heapsnapshot（公开 JSON 格式）
   - 字符串搜索：在内存快照里找加密参数值 / 密钥 / 手机号
   - 构造器统计：对象数量与浅大小 Top
   思路吸收自参考项目 spder heap.mjs（CDP 拉取版），此处为本地文件解析版。
   ========================================================================== */
(function () {

  /* 保留者路径推导。挂 SK 上：handler 在 Worker 里序列化执行，模块级函数不可见。 */
  SK.heapUtils = {
    buildRetainerPaths: function (data, meta, nodes, strings, hitSet, NF, FI, nodeTypes) {
      const out = [];
      const edges = data.edges;
      const edgeFields = meta.edge_fields || [];
      if (!edges || !edgeFields.length || !edges.length) return out;
      const EF = edgeFields.length;
      const EI = {};
      edgeFields.forEach(function (f, i) { EI[f] = i; });
      const eType = EI.type, eName = EI.name_or_index, eTo = EI.to_node;
      if (eType === undefined || eName === undefined || eTo === undefined) return out;
      const edgeTypes = (meta.edge_types && meta.edge_types[0]) || [];
      const nameIdx = FI.name;
      const typeIdx = FI.type;
      const edgeCountIdx = FI.edge_count;
      if (edgeCountIdx === undefined) return out;
      const nodeTotal = Math.floor(nodes.length / NF);
      if (nodeTotal > 600000) return out; /* 超大快照跳过，避免 OOM */

      /* 反向索引：to_node(字节偏移) → 若干 {from, type, name} */
      const parents = new Map();
      let e = 0;
      const edgeTotal = Math.floor(edges.length / EF);
      for (let off = 0; off < nodes.length; off += NF) {
        const cnt = nodes[off + edgeCountIdx] || 0;
        for (let k = 0; k < cnt; k++) {
          if (e >= edgeTotal) break;
          const base = e * EF;
          const to = edges[base + eTo];
          let arr = parents.get(to);
          if (!arr) { arr = []; parents.set(to, arr); }
          if (arr.length < 4) arr.push({ from: off, type: edges[base + eType], name: edges[base + eName] });
          e++;
        }
      }

      const edgeLabel = function (p) {
        const t = edgeTypes[p.type] || 'edge';
        /* element / hidden 的 name_or_index 是数字下标，其余是 strings 下标 */
        if (t === 'element' || t === 'hidden') return '[' + p.name + ']';
        const nm = strings[p.name];
        return nm == null ? t : String(nm);
      };
      const nodeLabel = function (off) {
        const t = nodeTypes[nodes[off + typeIdx]] || 'object';
        const nm = strings[nodes[off + nameIdx]];
        if (t === 'string') return 'String("' + String(nm == null ? '' : nm).slice(0, 24) + '")';
        return String(nm == null ? t : nm);
      };

      /* 找出名字命中 hitSet 的节点 */
      const hitNodes = [];
      for (let off = 0; off < nodes.length; off += NF) {
        if (hitSet[nodes[off + nameIdx]] !== undefined) hitNodes.push(off);
        if (hitNodes.length >= 200) break;
      }

      hitNodes.forEach(function (leaf) {
        const parts = [];
        let cur = leaf;
        let depth = 0;
        const seen = new Set();
        while (depth < 10) {
          const ps = parents.get(cur);
          if (!ps || !ps.length) break;
          /* 优先走 property 边（语义最清楚） */
          let pick = ps[0];
          for (let k = 0; k < ps.length; k++) {
            const t = edgeTypes[ps[k].type] || '';
            if (t === 'property' || t === 'internal') { pick = ps[k]; break; }
          }
          parts.unshift(edgeLabel(pick));
          cur = pick.from;
          if (seen.has(cur)) break;
          seen.add(cur);
          depth++;
        }
        if (!parts.length) return;
        parts.unshift(nodeLabel(cur) || '(root)');
        out.push({
          path: parts.join(' → '),
          leaf: nodeLabel(leaf).slice(0, 60),
          type: nodeTypes[nodes[leaf + typeIdx]] || 'object',
        });
      });
      return out;
    },
  };

  SK.tool({
    id: 'heap-snap',
    name: '堆快照分析',
    group: 'reverse',
    icon: '🏔',
    aliases: 'heap snapshot 内存 快照 v8 devtools memory',
    keywords: ['堆快照', 'heapsnapshot', '内存', '快照', 'v8', '搜索', '密钥', 'js逆向'],
    desc: '解析 DevTools → Memory → Heap snapshot 导出的 .heapsnapshot：按值搜内存（找密钥/加密参数残留）、构造器数量与浅大小 Top',
    hint: 'DevTools → Memory → Heap snapshot → 拍完右键 Save；加密刚发生后的快照里常能搜到明文',
    inputs: [{ id: 'in', label: '.heapsnapshot 文件（直接拖进来）', placeholder: '{"snapshot":{"meta":…},"nodes":[…],"strings":[…]}', sample: 'heapsnap' }],
    maxBytes: 400 * 1024 * 1024,
    bigFile: true,
    options: [
      { id: 'q', type: 'text', label: '搜索值', value: '', placeholder: '加密参数值 / 密钥片段 / 手机号' },
      { id: 'top', type: 'number', label: '构造器 Top', value: 50, min: 5, max: 500 },
    ],
    help:
      '<h4>和「内存漫游」的区别</h4>' +
      '<p>内存漫游抓的是注入之后<b>正在发生</b>的赋值；堆快照是<b>某一时刻</b>的全量内存。加密已经发生了、没抓到过程时，拍个快照搜残留值。</p>' +
      '<h4>用法</h4>' +
      '<ol><li>目标页操作触发加密（此时明文/密钥大概率还在内存里）</li>' +
      '<li>DevTools → Memory → <b>Heap snapshot</b> → Take snapshot</li>' +
      '<li>快照上右键 → <b>Save</b>… 得到 .heapsnapshot 文件（JSON）</li>' +
      '<li>拖进本工具，「搜索值」填你想找的明文片段 → 运行</li></ol>' +
      '<h4>怎么读结果</h4>' +
      '<ul><li><b>字符串命中</b>：该值在内存里存在，出现次数即实例数——加密前明文没被清掉，回头在赋值点下断</li>' +
      '<li><b>构造器 Top</b>：哪个对象数量异常多（混淆 JS 常见：海量 String / ArrayBuffer）</li></ul>' +
      '<p>提示：文件几百 MB 时解析需数秒（后台线程执行）；搜索用短片段（8~12 字符）命中率更高。</p>',
    handler: async function (input, opts) {
      opts = opts || {};
      let inputText = null;
      if (input && input.__file) {
        try { inputText = await input.__file.text(); } catch (e) { return { error: '读取文件失败：' + e.message }; }
      } else if (typeof input === 'string') {
        inputText = input;
      }
      const text = String(inputText == null ? '' : inputText);
      if (!text.trim()) return { error: '输入为空', hint: '把 .heapsnapshot 文件拖进输入框' };
      const q = String(opts.q || '').trim();
      if (text.length > 400 * 1024 * 1024) return { error: '文件超过 400MB', hint: '在 DevTools 里排除 node_modules 等再导出，或用 Take allocation profile' };

      let data;
      const t0 = Date.now();
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { error: 'JSON 解析失败：' + e.message, hint: '确认是完整导出的 .heapsnapshot 文件' };
      }
      const parseMs = Date.now() - t0;
      if (!data.snapshot || !data.nodes || !data.strings) {
        return { error: '不是 heapsnapshot 结构', hint: '需要包含 snapshot/nodes/strings 字段的 V8 快照 JSON' };
      }

      /* ---- 解析 meta ---- */
      const meta = data.snapshot.meta || {};
      const nodeFields = meta.node_fields || [];
      const nodeTypes = (meta.node_types && meta.node_types[0]) || [];
      const FI = {};
      nodeFields.forEach(function (f, i) { FI[f] = i; });
      const NF = nodeFields.length;
      const nodes = data.nodes;
      const strings = data.strings;
      const nodeCount = data.snapshot.node_count || Math.floor(nodes.length / NF);
      const typeIdx = FI.type;
      const nameIdx = FI.name;
      const sizeIdx = FI.self_size;

      const TYPE_STRING = nodeTypes.indexOf('string');
      const typeIsString = function (nodeOff) { return nodes[nodeOff + typeIdx] === TYPE_STRING; };

      /* ---- 构造器统计（按 name 分组：对象用构造器名，字符串用内容前缀） ---- */
      const byName = {};
      let totalSize = 0;
      let strNodeCount = 0;
      for (let off = 0; off < nodes.length; off += NF) {
        const nameIdx2 = nodes[off + nameIdx];
        const selfSize = nodes[off + sizeIdx] || 0;
        totalSize += selfSize;
        const isStr = typeIsString(off);
        if (isStr) { strNodeCount++; continue; } /* 字符串单独统计，不进构造器表 */
        const name = strings[nameIdx2] || ('#' + nameIdx2);
        const rec = byName[name] = byName[name] || { name: name, n: 0, size: 0 };
        rec.n++;
        rec.size += selfSize;
      }
      const ctorRows = Object.keys(byName).map(function (k) { return byName[k]; })
        .sort(function (a, b) { return b.size - a.size; })
        .slice(0, Math.max(5, Math.min(500, Number(opts.top || 50))))
        .map(function (r) { return { 构造器: r.name, 实例数: r.n, 浅大小: SK.dom.fmtBytes(r.size) }; });

      /* ---- 字符串搜索：strings 数组命中 + 引用计数 ---- */
      const tabs = [];
      const stats = [
        { k: '节点', v: SK.dom.fmtNum(nodeCount) },
        { k: '字符串', v: SK.dom.fmtNum(strNodeCount) },
        { k: '总浅大小', v: SK.dom.fmtBytes(totalSize) },
        { k: '解析耗时', v: SK.dom.fmtMs(parseMs) },
      ];

      if (q) {
        let qLow = q.toLowerCase();
        let isRe = false;
        let re = null;
        if (/^\/.+\/[gimsu]*$/.test(q)) {
          isRe = true;
          try { re = new RegExp(q.slice(1, q.lastIndexOf('/')), q.slice(q.lastIndexOf('/') + 1)); } catch (e) { return { error: '正则不合法：' + e.message }; }
        }
        /* strings 数组命中 → 全字串列表 */
        const hitStrs = [];
        for (let i = 0; i < strings.length; i++) {
          const s = strings[i];
          if (isRe ? re.test(s) : String(s).toLowerCase().indexOf(qLow) >= 0) hitStrs.push(i);
          if (hitStrs.length >= 500) break;
        }
        /* 每个 hit 字符串被多少 node 引用（name 字段指向它） */
        const hitSet = {};
        hitStrs.forEach(function (i) { hitSet[i] = 0; });
        let nodeRefs = 0;
        for (let off = 0; off < nodes.length; off += NF) {
          const ni = nodes[off + nameIdx];
          if (hitSet[ni] !== undefined) { hitSet[ni]++; nodeRefs++; }
        }
        const rows = hitStrs.slice(0, 200).map(function (si) {
          const s = String(strings[si]);
          return {
            命中字符串: s.length > 80 ? s.slice(0, 80) + '…(' + s.length + ')' : s,
            引用节点数: hitSet[si],
            类型: hitSet[si] > 0 ? '被对象/字符串引用' : '仅字面量',
          };
        });

        /* ---- 保留者路径：谁持有这个字符串（逆向找 key 的关键一步） ---- */
        const chainRows = SK.heapUtils.buildRetainerPaths(data, meta, nodes, strings, hitSet, NF, FI, nodeTypes);

        tabs.push({ label: '搜索命中 (' + hitStrs.length + ')', view: 'table', data: {
          columns: [{ key: '命中字符串', label: '命中字符串' }, { key: '引用节点数', label: '引用节点', width: '90px' }, { key: '类型', label: '说明', width: '150px' }],
          rows: rows, name: 'heap-search',
          filterHint: '在命中结果里再过滤',
        } });
        if (chainRows.length) {
          tabs.push({ label: '保留者路径 (' + chainRows.length + ')', view: 'table', data: {
            columns: [
              { key: 'path', label: '持有链（从根往下）', width: 'minmax(240px,1fr)' },
              { key: 'leaf', label: '叶子对象', width: '160px' },
              { key: 'type', label: '类型', width: '100px' },
            ],
            rows: chainRows, name: 'heap-retainers',
            filterHint: '过滤路径片段',
          } });
        }
        stats.push({ k: '命中字串', v: hitStrs.length, level: hitStrs.length ? 'ok' : 'warn' });
        if (!hitStrs.length) {
          return {
            error: '内存里没搜到「' + (isRe ? q : q.slice(0, 30)) + '」',
            hint: '试试更短片段（8~12 字符）/去掉大小写差异；或在加密动作刚结束的瞬间重新拍快照（值可能被 GC）',
            stats: stats,
          };
        }
      }

      tabs.push({ label: '构造器 Top (' + ctorRows.length + ')', view: 'table', data: {
        columns: [{ key: '构造器', label: '构造器/类名', width: 'minmax(160px,260px)' }, { key: '实例数', label: '实例数', width: '110px' }, { key: '浅大小', label: '浅大小合计', width: '110px' }],
        rows: ctorRows, name: 'heap-ctors',
        filterHint: '过滤构造器名',
      } });

      /* 概览文本（Worker 里拼） */
      const brief = [
        '节点总数: ' + SK.dom.fmtNum(nodeCount),
        '字符串节点: ' + SK.dom.fmtNum(strNodeCount),
        '总浅大小: ' + SK.dom.fmtBytes(totalSize),
        '边数量: ' + SK.dom.fmtNum(data.snapshot.edge_count || 0),
        '',
        'Top 构造器（按浅大小）:',
        ctorRows.slice(0, 15).map(function (r) { return '  ' + r.构造器.padEnd(24) + ' ' + String(r.实例数).padStart(8) + ' 个  ' + r.浅大小; }).join('\n'),
      ].join('\n');

      return {
        text: brief,
        lang: 'text',
        tabLabel: '概览',
        tabs: tabs,
        stats: stats,
        notices: q ? null : [{ level: 'info', msg: '填「搜索值」后在内存里找目标字符串' }],
        filename: 'heap-report',
      };
    },
  });
})();
