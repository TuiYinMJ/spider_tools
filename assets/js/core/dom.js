(function (root) {
  const SK = (root.SK = root.SK || {});

  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, props, children) {
    let node;
    if (tag && tag.indexOf('|') > 0) {
      const p = tag.split('|');
      node = document.createElementNS(SVGNS, p[1]);
    } else {
      node = document.createElement(tag);
    }
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      }
    }
    if (children !== undefined && children !== null) append(node, children);
    return node;
  }

  function append(node, children) {
    if (Array.isArray(children)) {
      for (const c of children) if (c !== null && c !== undefined && c !== false) append(node, c);
    } else if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts || false);
    return () => target.removeEventListener(type, handler, opts || false);
  }

  function debounce(fn, wait) {
    let t;
    const w = wait === undefined ? 220 : wait;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), w);
    };
  }

  function raf(fn) {
    let queued = false;
    const pending = [];
    return function () {
      pending.push(arguments);
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const args = pending[pending.length - 1];
        pending.length = 0;
        fn.apply(null, args);
      });
    };
  }

  function fmtBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    const a = Math.abs(n);
    if (a < 1024) return n + ' B';
    if (a < 1048576) return (n / 1024).toFixed(a < 10240 ? 2 : 1) + ' KB';
    if (a < 1073741824) return (n / 1048576).toFixed(a < 10485760 ? 2 : 1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    return Number(n).toLocaleString('en-US');
  }

  function fmtMs(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    if (n < 1000) return Math.round(n) + ' ms';
    if (n < 60000) return (n / 1000).toFixed(2) + ' s';
    return Math.floor(n / 60000) + 'm' + Math.round((n % 60000) / 1000) + 's';
  }

  function uid(prefix) {
    uid._n = (uid._n || 0) + 1;
    return (prefix || 'id') + '-' + uid._n + '-' + Math.random().toString(36).slice(2, 7);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    return new Promise((resolve, reject) => {
      try {
        const ta = el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('execCommand 被拒绝'));
      } catch (e) {
        reject(e);
      }
    });
  }

  function download(content, filename, mime) {
    let url;
    if (content instanceof Blob) url = URL.createObjectURL(content);
    else if (content instanceof ArrayBuffer) url = URL.createObjectURL(new Blob([content], { type: mime || 'application/octet-stream' }));
    else if (content && content.bytes !== undefined) url = URL.createObjectURL(new Blob([content.bytes], { type: mime || 'application/octet-stream' }));
    else url = URL.createObjectURL(new Blob([String(content)], { type: (mime || 'text/plain') + ';charset=utf-8' }));
    const a = el('a', { href: url, download: filename || 'download.txt' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function pad(s, n, ch) {
    s = String(s);
    n = n || 0;
    while (s.length < n) s += ch || ' ';
    return s;
  }

  function lpad(s, n, ch) {
    s = String(s);
    while (s.length < n) s = (ch || '0') + s;
    return s;
  }

  /* 速查工具通用：按关键词过滤表格行（任意字段包含即命中，忽略大小写） */
  function filterTableRows(rows, q) {
    if (!q) return rows;
    const lq = String(q).toLowerCase();
    return rows.filter(function (r) {
      return Object.keys(r).some(function (k) {
        return String(r[k] == null ? "" : r[k]).toLowerCase().indexOf(lq) >= 0;
      });
    });
  }

  SK.dom = { el, append, clear, esc, on, debounce, raf, fmtBytes, fmtNum, fmtMs, uid, clamp, copy, download, truncate, pad, lpad , filterTableRows: filterTableRows
  };
})(typeof window !== 'undefined' ? window : globalThis);
