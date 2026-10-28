(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el, uid } = SK.dom;

  const NS = 'spk:';

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(NS + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(NS + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(NS + key);
      } catch (e) {}
    },
    keys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
      }
      return out;
    },
  };

  const MAX_MEM = Number(root.__SK_BLOB_MEMORY_LIMIT__) > 0 ? Number(root.__SK_BLOB_MEMORY_LIMIT__) : 64 * 1024 * 1024;
  const cache = new Map();

  function missingBlob(id) {
    return Object.assign(new Error('缓存内容已失效，请重新载入输入'), { code: 'BLOB_MISSING', blobId: id });
  }

  /* B09：
   *   1) 单条就超限 → 直接拒绝，不做无意义的淘汰（旧实现会淘汰刚放进来的活动输入，
   *      然后返回一个读出来长度为 0 的 id）。
   *   2) 淘汰只动「无人引用且已冷却」的旧条目，刚写入的输入不会被自己顶掉。
   *   3) 淘汰后仍装不下 → 明确报错并给出可操作建议，绝不静默截断。
   */
  const PROTECT_MS = 30000;

  const blobs = {
    put(text, name, opts) {
      opts = opts || {};
      const value = String(text);
      const memory = value.length * 2;
      let bytes = value.length;
      try { bytes = new Blob([value]).size; } catch (e) { bytes = value.length; }
      if (memory > MAX_MEM) {
        throw Object.assign(new Error('这段内容需要 ' + Math.ceil(memory / 1048576) + ' MB 内存缓存，超过 ' + Math.ceil(MAX_MEM / 1048576) + ' MB 上限：请改用文件输入，或先清空其他输入框'), {
          code: 'BLOB_LIMIT',
          limit: MAX_MEM,
          bytes: bytes,
          tooBigAlone: true,
        });
      }
      const replace = opts.replace && cache.get(opts.replace);
      let total = memory;
      for (const [key, entry] of cache) {
        if (key !== opts.replace || !replace || replace.refs > 1) total += entry.memory;
      }
      const now = Date.now();
      const removable = [...cache.entries()]
        .filter(([key, entry]) => !entry.refs && key !== opts.replace && now - entry.at > PROTECT_MS)
        .sort((a, b) => a[1].at - b[1].at);
      const evict = [];
      for (const [key, entry] of removable) {
        if (total <= MAX_MEM) break;
        evict.push(key);
        total -= entry.memory;
      }
      if (total > MAX_MEM) {
        throw Object.assign(new Error('内存缓存不足（还需 ' + Math.ceil((total - MAX_MEM) / 1048576) + ' MB）：请关闭/清空其他输入框后再试，或改用文件输入'), {
          code: 'BLOB_LIMIT',
          limit: MAX_MEM,
          bytes: bytes,
        });
      }
      evict.forEach((key) => cache.delete(key));
      if (replace && replace.refs <= 1) cache.delete(opts.replace);
      const id = uid('blob');
      cache.set(id, { text: value, name: name || '剪贴板内容', at: now, memory, bytes, refs: opts.retain ? 1 : 0 });
      return { id: id, bytes: bytes, chars: value.length };
    },
    has(id) {
      return cache.has(id);
    },
    get(id) {
      const e = cache.get(id);
      if (e) e.at = Date.now();
      return e || null;
    },
    text(id) {
      const e = blobs.get(id);
      if (!e) throw missingBlob(id);
      return e.text;
    },
    retain(id) {
      const e = blobs.get(id);
      if (!e) throw missingBlob(id);
      e.refs++;
      return id;
    },
    release(id) {
      const e = cache.get(id);
      if (e) e.refs = Math.max(0, e.refs - 1);
    },
    drop(id) {
      const e = cache.get(id);
      if (e && e.refs) return false;
      return cache.delete(id);
    },
    get memoryBytes() {
      let total = 0;
      for (const e of cache.values()) total += e.memory;
      return total;
    },
    limit: MAX_MEM,
  };

  function bytesToString(bytes) {
    let s = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return s;
  }

  /* Blob.prototype.stream() 在老 Safari 上没有；用 arrayBuffer + 手写写入降级，
     否则这些浏览器会静默返回 null，只能退化成未压缩的 p 前缀链接（长文本直接截断） */
  function pipeThrough(bytes, transformer) {
    const cs = transformer();
    if (typeof Blob.prototype.stream === 'function') {
      return Promise.resolve(new Response(new Blob([bytes]).stream().pipeThrough(cs)));
    }
    return new Blob([bytes]).arrayBuffer().then((buf) => {
      const resp = new Response(cs.readable);
      const w = cs.writable.getWriter();
      w.write(new Uint8Array(buf));
      w.close();
      return resp;
    });
  }

  function compress(text) {
    if (!root.CompressionStream) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const bytes = new TextEncoder().encode(text);
        pipeThrough(bytes, () => new CompressionStream('deflate'))
          .then((r) => r.arrayBuffer())
          .then((buf) => {
            const b = new Uint8Array(buf);
            const b64 = btoa(bytesToString(b));
            resolve(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
          })
          .catch(() => resolve(null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function decompress(safeB64) {
    if (!root.DecompressionStream) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        let b64 = String(safeB64).replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        pipeThrough(bytes, () => new DecompressionStream('deflate'))
          .then((r) => r.text())
          .then((t) => resolve(t))
          .catch(() => resolve(null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  const modalStack = [];
  function openModal(opts) {
    const back = el('div', { class: 'modal-back', onClick: (e) => e.target === back && close() });
    const box = el('div', { class: 'modal ' + (opts.wide ? 'modal-wide' : '') }, [
      el('div', { class: 'modal-head' }, [el('h3', { text: opts.title || '' }), el('button', { class: 'icon-btn', text: '✕', onClick: close, title: '关闭 (Esc)' })]),
      el('div', { class: 'modal-body' }, opts.body || null),
      opts.footer ? el('div', { class: 'modal-foot' }, opts.footer) : null,
    ]);
    back.appendChild(box);
    modalStack.push(close);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('open'));
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    function close() {
      const si = modalStack.indexOf(close);
      if (si >= 0) modalStack.splice(si, 1);
      document.removeEventListener('keydown', onKey);
      back.classList.remove('open');
      setTimeout(() => back.remove(), 160);
      if (opts.onClose) opts.onClose();
    }
    if (opts.actions) {
      const foot = el('div', { class: 'modal-foot' });
      opts.actions.forEach((a) => foot.appendChild(el('button', { class: 'btn ' + (a.primary ? 'btn-primary' : ''), text: a.label, onClick: () => (a.onClick ? a.onClick(close) : close()) })));
      box.appendChild(foot);
    }
    return { close, box };
  }

  function toast(message, kind, action) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const t = el('div', { class: 'toast toast-' + (kind || 'info') }, [
      el('span', { class: 'toast-msg', text: message }),
      action ? el('button', { class: 'toast-action', text: action.label, onClick: () => (action.onClick(), t.remove()) }) : null,
    ]);
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    const life = kind === 'error' ? 7000 : action ? 8000 : 2600;
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 200);
    }, life);
    return t;
  }

  SK.store = store;
  SK.blobs = blobs;
  SK.codecCompress = compress;
  SK.codecDecompress = decompress;
  function closeModal() {
    const c = modalStack[modalStack.length - 1];
    if (c) c();
  }
  SK.ui = { openModal, toast, closeModal };
  /* close 敞口：SK.ui.closeModal() 关闭最上层弹窗（openModal 返回值也可以直接 .close()） */
})(typeof window !== 'undefined' ? window : globalThis);
