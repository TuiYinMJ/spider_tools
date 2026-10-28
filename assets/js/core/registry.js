(function (root) {
  const SK = (root.SK = root.SK || {});

  const registry = [];
  const byId = {};
  const groups = [];
  const groupIndex = {};

  function registerGroup(g) {
    if (!groupIndex[g.id]) {
      g.tools = g.tools || [];
      groupIndex[g.id] = g;
      groups.push(g);
    }
    return groupIndex[g.id];
  }

  function register(spec) {
    if (!spec || !spec.id) throw new Error('tool 缺少 id');
    if (byId[spec.id]) return byId[spec.id];
    const tool = Object.assign({ options: [], inputs: [{ id: 'in', label: '输入' }], group: 'misc', keywords: [] }, spec);
    if (!tool.cap) tool.cap = capOf(tool.id, tool.group);
    /* 工具可以就地覆盖边界说明（capNote），比集中表更好维护 */
    if (tool.capNote) tool.cap = Object.assign({}, tool.cap, { boundary: tool.capNote });
    registry.push(tool);
    byId[tool.id] = tool;
    const g = registerGroup({ id: tool.group, name: GROUP_NAMES[tool.group] || tool.group });
    if (!g.tools.includes(tool)) g.tools.push(tool);
    return tool;
  }

  const GROUP_NAMES = {
    format: '格式化与转换',
    convert: '转换工具',
    url: 'URL 工具',
    compare: '文本对比',
    text: '文本与对比',
    codec: '编解码 / 加解密',
    reverse: 'JS 逆向',
    android: '安卓逆向',
    pc: 'PC 逆向',
    spider: 'URL 与爬虫',
    time: '时间工具',
    misc: '时间与其他',
  };

  function groupName(id) {
    return GROUP_NAMES[id] || id;
  }

  /* ------------------------------------------------------------------------
     能力类型：每个工具都标清「产物是什么 / 有没有真的执行目标代码 /
     需不需要外部运行时」。名称可以简化，但类型与边界必须能查。
     ---------------------------------------------------------------------- */
  const CAPS = {
    compute: { id: 'compute', label: '本地计算', note: '在浏览器内直接算出结果，不联网、不依赖外部运行时' },
    static: { id: 'static', label: '静态分析', note: '只读文件/代码的结构与元信息，不执行目标代码' },
    script: { id: 'script', label: '脚本生成', note: '产物是要拿到目标环境（浏览器 / Node / Python / Frida）里运行的代码，本工具不替你执行' },
    heuristic: { id: 'heuristic', label: '启发式推断', note: '结果是候选与推测，需要人工确认，不能当确证结论' },
    cheatsheet: { id: 'cheatsheet', label: '速查', note: '静态知识条目，不处理你的输入' },
  };

  const GROUP_CAP = {
    format: 'compute',
    convert: 'compute',
    url: 'compute',
    compare: 'compute',
    text: 'compute',
    codec: 'compute',
    reverse: 'static',
    android: 'static',
    pc: 'cheatsheet',
    spider: 'compute',
    time: 'compute',
    misc: 'compute',
  };

  /* id → [能力类型, 边界说明]；没列出的按分组默认 */
  const TOOL_CAP = {
    'apk-inspect': ['static', '解析清单/DEX/签名，不解包加密壳、不执行 APK'],
    'elf-inspect': ['static', '读 ELF 符号与依赖，不做反汇编/反编译'],
    'frida-lib': ['script', '生成 Frida 注入脚本模板，需自行在已 root/越狱设备或模拟器上跑'],
    'font-decrypt': ['heuristic', '按字形特征做候选匹配，不是普适字体解密；低可信项默认不替换'],
    'har': ['static', '分析已有 HAR 文件，不发起真实请求'],
    'hash-id': ['heuristic', '按长度/字符集/前缀推测候选算法，同一串可能对应多种'],
    'curl-requests': ['script', '生成 Python 代码，需在本机装 requests 才能跑'],
    'curl-feapder': ['script', '生成 feapder 爬虫代码，需装 feapder'],
    'curl-multi': ['script', '生成目标语言代码，依赖目标语言运行时与第三方包'],
    'json-sql': ['script', '生成建表/插入 SQL，需拿到目标数据库执行'],
    'html-render': ['compute', '在无脚本、无同源的沙箱 iframe 里渲染；开脚本后仍不允许同源'],
    'sign-verify': ['compute', '在本机 Worker 里试跑你贴的函数，只证明这些向量通过'],
    'webpack-extract': ['static', '提取模块源码与依赖闭包并给骨架；骨架未经真实运行验证，标为「待补全」'],
    'wasm-inspect': ['static', '解析段/导入/导出，不反编译函数体'],
    'anti-debug': ['script', '生成注入脚本，需在目标页 document-start 阶段运行，可能改变页面语义'],
    'js-deobf': ['compute', 'AST 级等价变换：删 debugger、还原常量数组，不改业务逻辑'],
    'js-outline': ['static', '扫描函数/敏感点/URL，不做数据流分析'],
    'js-env': ['script', '静态扫描 + 生成补环境骨架 + 环境 dump 对照；不保证真实页面逻辑能跑通'],
    'js-hook': ['script', '生成 Hook 脚本，需在目标页运行才能生效'],
    'js-breakpoint': ['cheatsheet', '生成断点条件表达式，粘到 DevTools 用'],
    'js-sandbox': ['compute', '在 Worker 里试运行；不是安全隔离，降级时可能跑在主线程'],
    'mem-scan': ['script', '生成对象属性/字符串追踪脚本，抓不到闭包内 let/const 变量'],
    'heap-snap': ['static', '解析已导出的堆快照 JSON，不能直接抓取运行时内存'],
    'cipher-oracle': ['heuristic', '枚举算法/模式/填充/IV/编码组合，必须提供候选密钥，不做密钥破解'],
    'checksum': ['compute', '本地算校验和与扩展哈希'],
    'sign-build': ['script', '生成签名构造代码，需按目标站点的拼接规则补全'],
    'debug-cheats': ['cheatsheet', '调试命令/快捷键速查，不处理输入'],
    'asm-cheats': ['cheatsheet', '指令语义速查'],
    'winapi-cheats': ['cheatsheet', 'API 速查'],
    'cpp-cheats': ['cheatsheet', 'C++ 逆向模式速查'],
    'android-cheats': ['cheatsheet', '命令与路径速查'],
    'proxy-fmt': ['compute', '代理串在常见格式间互转'],
    'm3u8': ['compute', '解析播放列表并给出下载命令'],
    'gunzip': ['compute', '本机解压 gzip/deflate/base64 链'],
  };

  function capOf(id, group) {
    const row = TOOL_CAP[id];
    const base = CAPS[(row && row[0]) || GROUP_CAP[group] || 'compute'];
    return row && row[1] ? Object.assign({}, base, { boundary: row[1] }) : Object.assign({}, base);
  }

  /* 场景词直达：口语/任务词 → 工具 ID 列表（搜索精确命中，排最前） */
  const INTENTS = {
    '脱壳': ['apk-inspect', 'debug-cheats'],
    '加固': ['apk-inspect'],
    '壳': ['pe-inspect', 'apk-inspect'],
    '重定向': ['har'],
    '302': ['har'],
    '模拟器': ['frida-lib', 'debug-cheats'],
    '模拟器检测': ['frida-lib', 'debug-cheats'],
    '抓包': ['har', 'curl-requests', 'curl-feapder'],
    '抓包到代码': ['har', 'curl-requests'],
    '签名': ['sign-verify', 'js-hook', 'js-outline'],
    '签名验证': ['sign-verify'],
    '.so': ['elf-inspect'],
    '安卓so': ['elf-inspect', 'apk-inspect'],
    'so': ['elf-inspect'],
    'native': ['elf-inspect', 'frida-lib'],
    'jni': ['elf-inspect', 'frida-lib'],
    '注入': ['frida-lib', 'winapi-cheats'],
    '加密参数': ['cipher-oracle', 'sign-verify'],
    '反推': ['cipher-oracle'],
    '注册码': ['debug-cheats', 'winapi-cheats'],
    '弹窗': ['debug-cheats', 'winapi-cheats'],
    '打日志': ['js-hook'],
    '抓明文': ['js-hook', 'cipher-oracle'],
    '字体': ['font-decrypt'],
    '字体反爬': ['font-decrypt'],
    '乱码': ['charset'],
    '内存': ['heap-snap', 'mem-scan'],
    '内存漫游': ['mem-scan', 'heap-snap'],
    '堆快照': ['heap-snap'],
    '汇编': ['asm-cheats'],
    'jcc': ['asm-cheats'],
    'mfc': ['cpp-cheats'],
    '虚函数': ['cpp-cheats'],
    'stl': ['cpp-cheats'],
    '反调试': ['debug-cheats', 'anti-debug', 'pe-inspect'],
    '绕过': ['anti-debug', 'frida-lib'],
  };

  /* B12 修复：旧实现把「场景映射的 tool id」拼进**每一个**工具的检索串，
     于是搜索「脱壳」时所有工具都因为自己 haystack 里被塞进了 apk-inspect 而命中，
     66 个工具全部返回。现在场景映射只用于**加分**，不再污染 haystack。 */
  function search(q) {
    q = String(q == null ? '' : q).trim().toLowerCase();
    if (!q) return registry.slice();
    const terms = q.split(/\s+/).filter(Boolean);
    const queryAll = terms.join(' ');

    /* 命中的场景键 → 只给映射到的工具加分。
       拉丁词必须按词边界匹配：旧实现用 indexOf，搜 "json" 时 'so'（SO 符号分析）
       命中了 "json" 里的 "so"，把 SO 分析器顶到第一名。 */
    const boost = {};
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keys = Object.keys(INTENTS).filter((k) => {
      if (k.length < 2) return false;
      if (q === k) return true;
      if (/^[a-z0-9.]+$/i.test(k)) {
        return new RegExp('(^|[^a-z0-9])' + escapeRe(k) + '([^a-z0-9]|$)', 'i').test(queryAll);
      }
      return queryAll.indexOf(k) >= 0;
    });
    keys.forEach((key, ri) => {
      INTENTS[key].forEach((tid, ti) => {
        const s = 120 - ri * 8 - ti;
        if (boost[tid] === undefined || boost[tid] < s) boost[tid] = s;
      });
    });

    const out = [];
    const escapeTerm = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const t of registry) {
      const cap = t.cap || {};
      const hay = (t.name + ' ' + t.id + ' ' + (t.aliases || '') + ' ' + (t.keywords || []).join(' ') + ' ' + (t.desc || '') + ' ' + (cap.label || '') + ' ' + (cap.boundary || '')).toLowerCase();
      let score = 0;
      let ok = true;
      for (const term of terms) {
        /* 极短的拉丁词按词边界匹配：'so' 不该命中 "json"（j-so-n），
           否则搜 so 会带出一堆 JSON 工具 */
        let i;
        if (/^[a-z0-9.]+$/i.test(term) && term.length <= 3) {
          const m = new RegExp('(^|[^a-z0-9])' + escapeTerm(term) + '([^a-z0-9]|$)', 'i').exec(hay);
          i = m ? m.index + m[1].length : -1;
        } else {
          i = hay.indexOf(term);
        }
        if (i < 0) { ok = false; break; }
        score += i === 0 ? 12 : 5;
        if (t.name.toLowerCase() === term) score += 20;
        else if (t.name.toLowerCase().indexOf(term) >= 0) score += 8;
        if (t.id.toLowerCase() === term) score += 15;
      }
      if (!ok) {
        /* 文本没命中：只有被场景直达选中的工具才保留 */
        if (boost[t.id] === undefined) continue;
        score = 0;
      }
      if (boost[t.id] !== undefined) score += boost[t.id];
      out.push({ tool: t, score: score });
    }
    out.sort((a, b) => b.score - a.score || String(a.tool.name).localeCompare(String(b.tool.name), 'zh'));
    return out.map((x) => x.tool);
  }

  SK.tools = { registry, byId, groups, register, registerGroup, search, groupName, GROUP_NAMES, CAPS, capOf };
  SK.tool = register;
  SK.toolGroup = registerGroup;
})(typeof self !== 'undefined' ? self : globalThis);
