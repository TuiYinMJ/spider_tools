/* ============================================================================
   Spider Lab · app.js
   应用外壳：路由 / 侧栏 / 搜索 / 主题 / 首页 / 分享页 / 快捷键
   依赖：core/* 全部、tools/* 全部
   ========================================================================== */
(function (root) {
  const SK = root.SK;
  const { el, clear, debounce } = SK.dom;
  const $ = (s) => document.querySelector(s);

  const appEl = $('#app');
  const hostEl = $('#host');
  const navEl = $('#nav');
  const crumbsEl = $('#crumbs');
  const qEl = $('#q');
  const scrimEl = $('#scrim');
  const modeEl = $('#exec-mode');

  const GROUP_ORDER = ['reverse', 'android', 'pc', 'format', 'codec', 'spider', 'text', 'misc'];
  const GROUP_ICON = {
    format: '{ }',
    convert: '⇄',
    url: '⇗',
    compare: '≠',
    text: 'T',
    reverse: '⌁',
    android: '🤖',
    pc: '🪟',
    spider: '🕷',
    codec: '🔐',
    time: '⏱',
    misc: '⋯',
  };

  const state = {
    query: '',
    active: null,
    marks: Object.create(null),
    leave: [],
    lastRoute: '',
  };

  /* ========================================================== 对外 API */
  const app = {
    /** 工具页在卸载时需要清理的副作用（事件监听 / 定时器 / 浮层） */
    onLeave(fn) {
      if (typeof fn === 'function') state.leave.push(fn);
    },
    refreshSidebar() {
      buildSidebar();
    },
    markError(id) {
      state.marks[id] = 'err';
      paintMark(id);
    },
    markSuccess(id) {
      state.marks[id] = 'ok';
      paintMark(id);
    },
    go(id) {
      if (route() !== '#/' + id) location.hash = '#/' + id;
      else renderRoute();
    },
    openHelp,
    get query() {
      return state.query;
    },
  };
  SK.app = app;
  SK.navigate = app.go;

  /* ========================================================== 主题 */
  function themeInit() {
    const saved = SK.store.get('theme', '');
    const sys =
      root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    applyTheme(saved === 'light' || saved === 'dark' ? saved : sys);
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const btn = $('#theme-btn');
    if (btn) btn.textContent = t === 'dark' ? '☀ 浅色' : '☾ 深色';
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    SK.store.set('theme', next);
    applyTheme(next);
    SK.ui.toast('已切换到' + (next === 'dark' ? '深色' : '浅色') + '主题', 'info');
  }

  /* ========================================================== 侧栏收起（桌面端） */
  function collapseInit() {
    if (SK.store.get('sbCollapsed', false)) appEl.classList.add('sb-collapsed');
  }

  function isMobileWidth() {
    return root.matchMedia && root.matchMedia('(max-width: 860px)').matches;
  }

  function toggleCollapse() {
    // 移动端没有「收起列」的概念，走抽屉逻辑
    if (isMobileWidth()) {
      appEl.classList.toggle('nav-open');
      return;
    }
    const on = appEl.classList.toggle('sb-collapsed');
    SK.store.set('sbCollapsed', on);
    const btn = $('#sb-collapse');
    if (btn) btn.textContent = on ? '»' : '«';
    if (on) closeNav();
  }

  /* ========================================================== 侧栏 */
  function sortedGroups() {
    const gs = SK.tools.groups.slice();
    gs.sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a.id);
      const ib = GROUP_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return gs;
  }

  function toolItem(tool) {
    const favs = SK.store.get('fav', []);
    const btn = el('button', {
      class: 'sb-item' + (state.active === tool.id ? ' on' : '') + (favs.includes(tool.id) ? ' fav' : ''),
      dataset: { id: tool.id, mark: state.marks[tool.id] || '' },
      title: (tool.desc || tool.name) + '\n#' + tool.id,
      onClick: () => app.go(tool.id),
    }, [
      el('span', { class: 'sb-ico', text: GROUP_ICON[tool.group] || (tool.icon || '·').slice(0, 2) }),
      el('span', { class: 'sb-name', text: tool.name }),
    ]);
    return btn;
  }

  function groupBlock(name, count, tools, key) {
    /* key 存在时组头可折叠（收藏/搜索结果固定展开） */
    const folded = key ? !!SK.store.get('fold:' + key, false) : false;
    const body = el('div', { class: 'sb-group-body' + (folded ? ' folded' : '') });
    tools.forEach((t) => body.appendChild(toolItem(t)));

    if (!key) {
      return el('div', { class: 'sb-group' }, [
        el('div', { class: 'sb-group-h' }, [el('span', { text: name }), el('span', { class: 'sb-count', text: String(count) })]),
        body,
      ]);
    }

    const head = el('button', {
      class: 'sb-group-h sb-group-toggle' + (folded ? ' folded' : ''),
      title: folded ? '展开「' + name + '」' : '收起「' + name + '」',
      onClick: () => {
        const now = !body.classList.contains('folded');
        body.classList.toggle('folded', now);
        head.classList.toggle('folded', now);
        arrow.textContent = now ? '▸' : '▾';
        SK.store.set('fold:' + key, now);
      },
    }, [
      el('span', { class: 'sb-arrow', text: folded ? '▸' : '▾' }),
      el('span', { class: 'sb-gname', text: name }),
      el('span', { class: 'sb-count', text: String(count) }),
    ]);
    const arrow = head.querySelector('.sb-arrow');
    return el('div', { class: 'sb-group' }, [head, body]);
  }

  function buildSidebar() {
    clear(navEl);
    const q = state.query.trim();

    if (q) {
      const hits = SK.tools.search(q).slice(0, 80);
      if (!hits.length) {
        navEl.appendChild(
          el('div', { class: 'sb-empty' }, [
            el('div', { text: '没有匹配「' + q + '」的工具' }),
            el('div', { text: '试试：json / curl / 反混淆 / 正则' }),
          ])
        );
        return;
      }
      navEl.appendChild(groupBlock('搜索结果', hits.length, hits));
      return;
    }

    const favs = SK.store.get('fav', []);
    const favTools = favs.map((id) => SK.tools.byId[id]).filter(Boolean);
    if (favTools.length) navEl.appendChild(groupBlock('★ 收藏', favTools.length, favTools, 'fav'));

    sortedGroups().forEach((g) => {
      const tools = g.tools || [];
      if (!tools.length) return;
      navEl.appendChild(groupBlock(g.name, tools.length, tools, g.id));
    });

    navEl.appendChild(
      el('div', { class: 'sb-empty', style: { padding: '14px 10px 4px', textAlign: 'left' } }, [
        el('div', { text: SK.tools.registry.length + ' 个工具 · 全部本地运行' }),
      ])
    );
  }

  function paintMark(id) {
    const node = navEl.querySelector('.sb-item[data-id="' + id + '"]');
    if (node) node.dataset.mark = state.marks[id] || '';
  }

  function setActive(id) {
    state.active = id;
    navEl.querySelectorAll('.sb-item').forEach((n) => n.classList.toggle('on', n.dataset.id === id));
  }

  /* ========================================================== 路由 */
  function route() {
    const h = decodeURI(location.hash || '');
    return h || '#/';
  }

  function renderRoute() {
    const h = route();
    state.lastRoute = h;
    runLeave();
    /* 小视口下侧栏是抽屉：选了工具就该自动收起，不用再点一次菜单键 */
    closeNav();

    if (!h || h === '#' || h === '#/') {
      renderHome();
      return;
    }
    if (h.indexOf('#/code-share/') === 0) {
      renderShare(h.slice('#/code-share/'.length));
      return;
    }
    const id = h.replace(/^#\/?/, '').split(/[?&]/)[0];
    const tool = SK.tools.byId[id];
    if (!tool) {
      renderHome();
      SK.ui.toast('找不到工具「' + id + '」，已回到首页', 'warn');
      return;
    }
    mountTool(tool);
  }

  function runLeave() {
    const hooks = state.leave;
    state.leave = [];
    hooks.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* 卸载钩子不应影响路由 */
      }
    });
    document.querySelectorAll('.send-menu').forEach((n) => n.remove());
  }

  function crumbs(items) {
    clear(crumbsEl);
    items.forEach((it, i) => {
      if (i) crumbsEl.appendChild(el('span', { class: 'crumb-sep', text: '/' }));
      crumbsEl.appendChild(
        el(it.href ? 'a' : 'span', { class: 'crumb' + (i === items.length - 1 ? ' cur' : ''), href: it.href, text: it.name })
      );
    });
  }

  /* ========================================================== 首页 */
  function renderHome() {
    state.active = null;
    hostEl.classList.add('home-mode');
    clear(hostEl);
    setActive(null);
    document.title = 'Spider Lab · 爬虫与 JS 逆向工具箱';
    crumbs([{ name: '全部工具' }]);

    const favs = SK.store.get('fav', []).map((id) => SK.tools.byId[id]).filter(Boolean);
    const recents = SK.store
      .get('recent', [])
      .map((id) => SK.tools.byId[id])
      .filter(Boolean)
      .slice(0, 6);

    const heroSearch = el('input', {
      type: 'search',
      placeholder: '搜索工具：json、curl、反混淆、补环境、正则…',
      autocomplete: 'off',
      onKeydown: (e) => {
        if (e.key === 'Enter') {
          const hit = SK.tools.search(heroSearch.value)[0];
          if (hit) app.go(hit.id);
          else SK.ui.toast('没有匹配的工具', 'warn');
        } else if (e.key === 'Escape') {
          heroSearch.value = '';
          heroSearch.blur();
        }
      },
    });

    const hero = el('section', { class: 'hero' }, [
      el('span', { class: 'hero-tag' }, [el('span', { class: 'dot' }), el('span', { text: '本地抓包分析与逆向辅助 · 输入不主动上传' })]),
      el('h1', {}, ['爬虫 & JS 逆向的 ', el('em', { text: '本地分析工具箱' })]),
      el('p', {
        text:
          '从抓包字符串到可运行代码的每一步：cURL 转 requests/feapder、Header/Cookie/Dict 格式化、' +
          'JS 反混淆与环境扫描、Hook 与断点表达式、URL 批处理、正则批量提取、文本与 JSON 对比、加解密与时间戳。' +
          '输入输出都在本机浏览器里处理，不经过任何服务端。',
      }),
      el('div', { class: 'hero-search' }, [
        el('span', { class: 'sb-search-icon', text: '⌕' }),
        heroSearch,
        el('kbd', { class: 'sb-kbd', text: '/' }),
      ]),
      el('div', { class: 'hero-stats' }, [
        hstat(String(SK.tools.registry.length), '个工具'),
        hstat(String(SK.tools.groups.length), '个分组'),
        hstat('5', '种能力类型'),
        hstat('Web Worker', '默认执行线程'),
        hstat('虚拟滚动', '大文件渲染'),
      ]),
    ]);

    /* 能力类型筛选：先分清「算出来的 / 只读分析的 / 生成脚本的 / 猜的 / 查表的」 */
    const grid = el('div', { class: 'hgrid' });
    let capFilter = '';
    const capRow = el('div', { class: 'cap-filter' });
    const capCounts = {};
    SK.tools.registry.forEach((t) => {
      const k = (t.cap && t.cap.id) || 'compute';
      capCounts[k] = (capCounts[k] || 0) + 1;
    });
    const renderGrid = () => {
      clear(grid);
      sortedGroups().forEach((g) => {
        const tools = (g.tools || []).filter((t) => !capFilter || (t.cap && t.cap.id) === capFilter);
        if (!tools.length) return;
        const list = el('div', { class: 'hcard-list' });
        tools.forEach((t) => {
          const tip = [t.desc || t.name, t.cap ? '\n\n【' + t.cap.label + '】' + (t.cap.boundary || t.cap.note) : ''].join('');
          list.appendChild(
            el('button', { class: 'hcard-item', title: tip, onClick: () => app.go(t.id) }, [
              el('span', { text: t.name }),
              t.cap ? el('span', { class: 'hcard-cap hcard-cap-' + t.cap.id, text: t.cap.label }) : null,
            ])
          );
        });
        grid.appendChild(
          el('div', { class: 'hcard' }, [
            el('div', { class: 'hcard-head' }, [
              el('span', { class: 'hcard-icon', text: GROUP_ICON[g.id] || '·' }),
              el('b', { text: g.name }),
              el('i', { text: tools.length + ' 项' }),
            ]),
            list,
          ])
        );
      });
      if (!grid.children.length) grid.appendChild(el('p', { class: 'cap-empty', text: '这个能力类型下暂时没有工具' }));
    };
    const capKeys = ['', 'compute', 'static', 'script', 'heuristic', 'cheatsheet'];
    capKeys.forEach((k) => {
      const meta = k ? SK.tools.CAPS[k] : { label: '全部' };
      capRow.appendChild(
        el('button', {
          class: 'cap-chip' + (k ? ' cap-chip-' + k : '') + (capFilter === k ? ' on' : ''),
          text: meta.label + (k ? ' ' + (capCounts[k] || 0) : ''),
          title: k ? SK.tools.CAPS[k].note : '显示全部工具',
          onClick: (e) => {
            capFilter = k;
            [...capRow.children].forEach((c) => c.classList.remove('on'));
            e.currentTarget.classList.add('on');
            renderGrid();
          },
        })
      );
    });
    renderGrid();

    const quickBox = (title, tools, emptyText) => {
      const box = el('div', { class: 'hnote' }, [el('h4', { text: title })]);
      if (!tools.length) {
        box.appendChild(el('p', { text: emptyText }));
        return box;
      }
      const row = el('div', { class: 'hcard-list' });
      tools.forEach((t) => row.appendChild(el('button', { class: 'hcard-item', text: t.name, onClick: () => app.go(t.id) })));
      box.appendChild(row);
      return box;
    };

    const notes = el('div', { class: 'home-notes' }, [
      el('div', { class: 'hnote' }, [
        el('h4', {}, ['🧪 管道配方']),
        el('p', { text: '常用工具链存成一键流程（如 Base64→解压→JSON）。' }),
        el('div', { class: 'chips-row', style: { justifyContent: 'flex-start', marginTop: '8px' } }, [
          el('button', { class: 'btn tiny primary', text: '管理 / 运行配方', onClick: () => SK.recipes.openManage() }),
        ]),
      ]),
      quickBox('★ 我的收藏', favs, '在工具页点「☆ 收藏」，常用工具会固定在侧栏顶部。'),
      quickBox('最近使用', recents, '打开任意工具后，这里会出现快捷入口。'),
      el('div', { class: 'hnote' }, [
        el('h4', { text: '大文件策略' }),
        el('p', {}, [
          '粘贴超过 ',
          el('code', { text: '600KB' }),
          ' 自动转为内存缓存不进编辑框；文件超过 ',
          el('code', { text: '120KB' }),
          ' 走文件模式，执行时流式读取；输出用虚拟滚动只渲染可视行。',
        ]),
      ]),
      el('div', { class: 'hnote' }, [
        el('h4', { text: '快捷键' }),
        el('p', {}, [
          el('code', { text: '⌃⏎' }),
          ' 运行 · ',
          el('code', { text: '/' }),
          ' 搜索 · ',
          el('code', { text: '?' }),
          ' 帮助 · ',
          el('code', { text: 'Esc' }),
          ' 关闭浮层',
        ]),
      ]),
    ]);

    const wrap = el('div', { class: 'home' }, [
      hero,
      capRow,
      grid,
      notes,
      el('div', { class: 'home-foot', text: 'Spider Lab · 纯前端 · 双击 index.html 也能用（Worker 受限时自动降级为主线程）' }),
    ]);

    hostEl.appendChild(wrap);
  }

  function hstat(v, label) {
    return el('div', { class: 'hstat' }, [el('b', { text: v }), el('span', { text: label })]);
  }

  /* ========================================================== 工具页 */
  function mountTool(tool) {
    state.active = tool.id;
    SK.currentToolId = tool.id;
    hostEl.classList.remove('home-mode');
    clear(hostEl);
    document.title = tool.name + ' · Spider Lab';
    crumbs([{ name: '全部工具', href: '#/' }, { name: SK.tools.groupName(tool.group), href: '#/' }, { name: tool.name }]);
    setActive(tool.id);

    const page = el('div', { class: 'page' });
    hostEl.appendChild(page);

    try {
      SK.workbench.mount(tool, page);
    } catch (e) {
      clear(hostEl);
      hostEl.appendChild(
        el('div', { class: 'center-page' }, [
          el('div', { class: 'center-card' }, [
            el('h2', { text: '这个工具加载失败了' }),
            el('p', { text: (e && e.message) || String(e) }),
            el('p', { text: '打开控制台看堆栈，或换一个工具试试。' }),
          ]),
        ])
      );
    }

    const recents = SK.store.get('recent', []).filter((x) => x !== tool.id);
    recents.unshift(tool.id);
    SK.store.set('recent', recents.slice(0, 8));

    hostEl.scrollTop = 0;
  }

  /* ========================================================== 分享页 */
  function renderShare(payload) {
    state.active = null;
    hostEl.classList.remove('home-mode');
    clear(hostEl);
    setActive(null);
    document.title = '分享内容 · Spider Lab';
    crumbs([{ name: '全部工具', href: '#/' }, { name: '分享内容' }]);

    const card = el('div', { class: 'center-card', style: { maxWidth: '100%', width: '100%' } });
    hostEl.appendChild(el('div', { class: 'center-page', style: { display: 'block', padding: '24px 0' } }, [card]));
    card.appendChild(el('h2', { text: '正在还原分享内容…' }));

    decodeShare(payload).then(
      (shared) => {
        const text = shared && typeof shared === 'object' ? shared.text : shared;
        const title = (shared && shared.title) || '';
        clear(card);
        if (title) document.title = title + ' · Spider Lab';
        const bytes = new Blob([text]).size;
        card.appendChild(
          el('div', { class: 'share-head' }, [
            el('h2', { text: title || '分享的代码 / 文本' }),
            el('p', { text: SK.dom.fmtNum(text.length) + ' 字符 · ' + SK.dom.fmtBytes(bytes) + ' · 由链接片段还原，未经过任何服务器' }),
          ])
        );

        const acts = el('div', { class: 'chips-row', style: { justifyContent: 'flex-start', margin: '12px 0 14px' } }, [
          el('button', { class: 'btn tiny primary', text: '⧉ 复制全文', onClick: () => SK.dom.copy(text).then(() => SK.ui.toast('已复制', 'ok')) }),
          el('button', { class: 'btn tiny', text: '⤓ 下载', onClick: () => SK.dom.download(text, 'shared.txt', 'text/plain') }),
          el('button', {
            class: 'btn tiny',
            text: '在 JS 格式化中打开',
            onClick: () => {
              SK.inject = { toolId: 'js', text, from: 'share' };
              app.go('js');
            },
          }),
          el('button', {
            class: 'btn tiny',
            text: '在文本对比中打开',
            onClick: () => {
              SK.inject = { toolId: 'text-diff', text, from: 'share' };
              app.go('text-diff');
            },
          }),
          el('button', { class: 'btn tiny', text: '回到首页', onClick: () => (location.hash = '#/') }),
        ]);

        const pane = el('section', { class: 'pane', style: { height: 'min(58vh, 620px)' } }, [
          el('div', { class: 'pane-head' }, [
            el('span', { class: 'pane-title', text: '内容预览' }),
            el('span', { class: 'pane-spacer' }),
          ]),
          el('div', { class: 'pane-body' }),
        ]);
        card.appendChild(acts);
        card.appendChild(pane);
        const body = pane.querySelector('.pane-body');
        const v = SK.viewer.create(body, { lang: SK.render.guessLang(text), placeholder: '内容为空' });
        v.reset(text, { lang: SK.render.guessLang(text) });

        SK.ui.toast('分享内容已还原', 'ok');
      },
      (e) => {
        clear(card);
        card.appendChild(el('h2', { text: '无法还原这段分享内容' }));
        card.appendChild(el('p', { text: (e && e.message) || String(e) }));
        card.appendChild(
          el('p', {
            text:
              '可能原因：链接被聊天软件截断了尾部、浏览器不支持 CompressionStream（老版本 Safari），' +
              '或者这段链接不是本工具生成的。',
          })
        );
        card.appendChild(el('div', { class: 'chips-row' }, [el('button', { class: 'btn tiny', text: '回到首页', onClick: () => (location.hash = '#/') })]));
      }
    );
  }

  async function decodeShare(payload) {
    if (!payload) throw new Error('链接里没有内容');
    /* 标题扩展位：payload!t=<b64url(标题)>。先切掉再做 primary 解码，
       否则 't=' 会被当成压缩串的一部分导致解压失败。 */
    let title = '';
    const tIdx = payload.indexOf('!t=');
    if (tIdx > 0) {
      try { title = b64urlDecode(payload.slice(tIdx + 3)); } catch (e) { title = ''; }
      payload = payload.slice(0, tIdx);
    }
    const out = await decodeShareBody(payload);
    return { text: out, title: title };
  }

  async function decodeShareBody(payload) {
    const flag = payload[0];
    if (flag === 'z') {
      const out = await SK.codecDecompress(payload.slice(1));
      if (out == null) throw new Error('解压失败（浏览器不支持 DecompressionStream 或数据损坏）');
      return out;
    }
    if (flag === 'p') return b64urlDecode(payload.slice(1));
    // 兼容早期无标记的链接
    const out = await SK.codecDecompress(payload);
    if (out != null) return out;
    return b64urlDecode(payload);
  }

  function b64urlDecode(s) {
    let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ========================================================== 帮助 */
  function openHelp() {
    const rows = [
      ['⌃⏎ / ⌘⏎', '运行当前工具'],
      ['⌃B / ⌘B', '收起 / 展开侧边栏'],
      ['/ 或 ⌘K / ⌃K', '聚焦搜索框（首页聚焦大搜索框）'],
      ['?', '打开这份帮助'],
      ['Esc', '关闭弹窗 / 收起侧栏'],
      ['⧉', '复制输出'],
      ['↗', '把输出发送到另一个工具，自动接续处理'],
    ];
    const body = el('div', { class: 'help-body' }, [
      el('h4', { text: '快捷键' }),
      el('div', { class: 'sheet' }, rows.map((r) => el('div', { class: 'sheet-row' }, [el('span', { class: 'k' }, [el('kbd', { text: r[0] })]), el('span', { class: 'v', text: r[1] })]))),
      el('h4', { text: '大文件怎么处理' }),
      el('ul', {}, [
        el('li', { text: '粘贴超过 600KB 的文本会移到内存缓存（有上限，超了直接报错而不是静默截断），编辑框只留提示卡片，避免输入框重排卡死。' }),
        el('li', { text: '拖入文件时，超过 120KB 走「文件模式」，执行瞬间才读取；超过 24MB 需要选支持流式的工具。' }),
        el('li', { text: '解析、排序、对比这类重计算默认在 Web Worker 里跑，超时会掐断并提示。少数标记为 inline 的工具（如 DOM 相关预览）仍在主线程执行——看运行按钮右边的徽标。' }),
        el('li', { text: '输出用虚拟滚动，只渲染可视区域的几十行：拖动和查找是恒定成本，但解析、排序、对比本身仍与数据量成正比，不是「百万行随便跑」。实际可用容量取决于工具与机器，大文件建议先切到「文件模式」并只取需要的片段。' }),
      ]),
      el('h4', { text: '执行模式说明' }),
      el('p', {}, [
        '运行按钮右边的徽标显示当前工具的真实执行位置：',
        el('code', { text: '后台线程' }),
        ' 表示 Worker 正常；',
        el('code', { text: '⚠ 主线程' }),
        ' 表示这个工具本身就在主线程跑（或 Worker 不可用——常见于直接双击 index.html 打开，浏览器禁用了 Worker）。用 ',
        el('code', { text: 'python3 -m http.server' }),
        ' 或任意静态服务器打开即可恢复 Worker。',
      ]),
      el('h4', { text: '隐私与联网边界' }),
      el('p', {
        text:
          '应用自身不主动上传你的输入：格式化、转换、加解密、反混淆都在本机内存里完成。' +
          '但「不主动上传」不等于「绝对断网」：HTML 渲染允许你手动打开外部资源加载，JS 试运行跑的是任意 JS，' +
          '脚本本身有能力发起网络请求；生成的 requests / feapder / Frida / jsdom 代码要装依赖、要联网，也都由你在外部环境里执行。',
      }),
    ]);
    SK.ui.openModal({ title: '使用说明', wide: true, body });
  }

  /* ========================================================== 事件绑定 */
  function bindShell() {
    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#help-btn').addEventListener('click', openHelp);
    $('#pins-board-btn').addEventListener('click', (e) => SK.pins.openBoard(e.target));
    $('#burger').addEventListener('click', () => {
      if (!isMobileWidth() && appEl.classList.contains('sb-collapsed')) toggleCollapse();
      else appEl.classList.add('nav-open');
    });
    $('#sb-collapse').addEventListener('click', toggleCollapse);
    $('#sb-close').addEventListener('click', closeNav);
    scrimEl.addEventListener('click', closeNav);

    const onSearch = debounce(() => {
      state.query = qEl.value;
      buildSidebar();
    }, 110);
    qEl.addEventListener('input', onSearch);
    qEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const hit = SK.tools.search(qEl.value)[0];
        if (hit) {
          app.go(hit.id);
          qEl.blur();
        }
      } else if (e.key === 'Escape') {
        qEl.value = '';
        state.query = '';
        buildSidebar();
        qEl.blur();
      }
    });

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      const tag = (t && t.tagName ? t.tagName : '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapse();
        return;
      }
      if (!typing && e.key === '/') {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (!typing && e.key === '?') {
        e.preventDefault();
        openHelp();
        return;
      }
      if (e.key === 'Escape') closeNav();
    });

    root.addEventListener('hashchange', renderRoute);

    // 执行模式指示
    const tick = () => {
      if (!modeEl) return;
      const m = SK.exec.mode;
      modeEl.textContent = m === 'worker' ? '⚡ 后台线程' : m === 'inline' ? '⚠ 主线程' : '启动中…';
      modeEl.className = 'sb-mode ' + (m === 'worker' ? 'worker' : m === 'inline' ? 'inline' : '');
    };
    tick();
    setInterval(tick, 900);
  }

  function focusSearch() {
    // 首页把焦点交给大搜索框（用户视线所在），工具页用侧栏搜索框
    const hero = hostEl.classList.contains('home-mode') ? hostEl.querySelector('.hero-search input') : null;
    const target = hero || qEl;
    if (!hero) appEl.classList.add('nav-open');
    if (!target) return;
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      target.focus();
    }
    if (target.select) target.select();
  }

  function closeNav() {
    appEl.classList.remove('nav-open');
  }

  /* ========================================================== 启动 */
  function boot() {
    themeInit();
    collapseInit();
    bindShell();
    buildSidebar();
    renderRoute();

    // 首次进入时如果 Worker 降级，给一次明确提示
    setTimeout(() => {
      if (SK.exec.mode === 'inline') {
        SK.ui.toast('Worker 不可用，已降级为主线程执行。用静态服务器打开可恢复。', 'warn', {
          label: '了解',
          onClick: openHelp,
        });
      }
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
