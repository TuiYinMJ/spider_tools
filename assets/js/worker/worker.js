let libsLoaded = false;
const SK = (self.SK = self.SK || {});

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      if (!libsLoaded) {
        /* 逐个加载：单个失败不影响其他库，并把失败项报给主线程 */
        const failed = [];
        for (const url of msg.libs) {
          try {
            importScripts(url);
          } catch (e) {
            failed.push(url + ' :: ' + String(e && e.message ? e.message : e));
          }
        }
        self.__libFailed = failed;
        self.__libLoaded = msg.libs;
        libsLoaded = true;
        self.postMessage({ type: 'ready', ok: true, failed: failed.length ? failed : null });
      } else {
        self.postMessage({ type: 'ready', ok: true });
      }
    } catch (e) {
      self.postMessage({ type: 'ready', ok: false, error: String(e && e.message ? e.message : e) });
    }
    return;
  }
  if (msg.type !== 'run') return;
  const id = msg.id;
  let lastPost = 0;
  const hooks = {
    progress(done, total, note) {
      if (!msg.hooks) return;
      const now = Date.now();
      if (now - lastPost < (msg.progressEvery || 80) && !(total && done >= total)) return;
      lastPost = now;
      self.postMessage({ type: 'progress', id, done: done || 0, total: total || 0, note: note || '' });
    },
    log() {},
  };
  try {
    const fn = self.eval('(' + msg.fn + ')');
    const args = (msg.args || []).slice();
    args.push(hooks);
    const result = await fn.apply(null, args);
    self.postMessage({ type: 'result', id, ok: true, result: makeSafe(result) });
  } catch (e) {
    self.postMessage({
      type: 'result',
      id,
      ok: false,
      message: String(e && e.message ? e.message : e),
      code: e && e.code,
      stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : '',
    });
  }
};

function makeSafe(v, depth) {
  const d = depth || 0;
  if (v === undefined || v === null) return null;
  const t = typeof v;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t === 'bigint') return String(v);
  if (t !== 'object') return v;
  if (v instanceof Error) return { __error: v.message, stack: v.stack };
  if (d > 200) return '[max depth]';
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
  if (v instanceof Date) return v;
  if (v instanceof RegExp) return String(v);
  try {
    structuredClone(v);
    return v;
  } catch (e) {
    /* 含函数/宿主对象，需要逐个字段清洗 */
  }
  if (Array.isArray(v)) {
    const arr = [];
    for (const x of v) {
      const s = makeSafe(x, d + 1);
      arr.push(s === undefined ? null : s);
    }
    return arr;
  }
  const out = {};
  for (const k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    let s;
    try {
      s = makeSafe(v[k], d + 1);
    } catch (e2) {
      s = String(v[k]).slice(0, 2000);
    }
    if (s !== undefined) out[k] = s;
  }
  return out;
}

self.postMessage({ type: 'hello' });
