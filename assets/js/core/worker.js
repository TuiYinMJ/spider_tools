(function (root) {
  const SK = (root.SK = root.SK || {});

  const state = {
    worker: null,
    ready: false,
    broken: false,
    seq: 0,
    tasks: new Map(),
    mode: 'boot',
    restarts: 0,
    maxRestarts: 3,
  };

  function libUrls() {
    const list = root.__SK_LIBS__ || [];
    /* 加时间戳版本参数：Worker 的 importScripts 走 HTTP 缓存，
       开发期改文件后旧缓存会导致库“加载成功但不生效” */
    const v = root.__SK_LIBS_VER__ || String(Date.now());
    return list.map((p) => new URL(p, document.baseURI).href + (p.indexOf('?') >= 0 ? '&' : '?') + 'v=' + v);
  }

  function boot() {
    if (state.worker || state.broken) return;
    if (!root.Worker) {
      state.broken = true;
      state.mode = 'inline';
      return;
    }
    try {
      /* Worker 脚本走 HTTP 缓存：加版本参数保证改版后拿到新脚本 */
      const url = new URL('assets/js/worker/worker.js', document.baseURI).href + '?v=' + Date.now();
      const w = new Worker(url);
      state.worker = w;
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') {
          if (m.ok === false) {
            console.error('[SpiderLab] Worker 库加载失败：', m.error);
            failAll(new Error('后台线程库加载失败: ' + (m.error || '')));
            return;
          }
          if (m.failed && m.failed.length) console.warn('[SpiderLab] 部分库加载失败：', m.failed);
          state.ready = true;
          state.mode = 'worker';
          flush();
          return;
        }
        if (m.type === 'progress') {
          const t = state.tasks.get(m.id);
          if (t && t.onProgress) t.onProgress(m.done, m.total, m.note);
          return;
        }
        const t = state.tasks.get(m.id);
        if (!t) return;
        if (!finishTask(m.id)) return; /* 已被超时或取消结算 */
        if (m.ok) t.resolve(m.result);
        else t.reject(Object.assign(new Error(m.message || '工作线程执行失败'), { stack: m.stack, code: m.code }));
      };
      w.onmessageerror = () => failAll(new Error('后台线程返回了无法解析的消息'));
      w.onerror = (ev) => {
        ev.preventDefault && ev.preventDefault();
        failAll(new Error('后台线程异常: ' + (ev.message || '脚本加载失败')));
      };
      w.postMessage({ type: 'init', libs: libUrls() });
      state.mode = 'boot';
    } catch (e) {
      state.broken = true;
      state.ready = false;
      state.mode = 'inline';
    }
  }

  /* B10：failAll 之前只结算 state.tasks，排队中的任务永远悬着（Promise 既不 resolve 也不 reject，
     界面按钮卡死）。这里把队列一起结算掉。 */
  function failAll(err) {
    for (const [, t] of state.tasks) {
      clearTimeout(t.timer);
      t.reject(err);
    }
    state.tasks.clear();
    while (queue.length) {
      const job = queue.shift();
      clearTimeout(job.task && job.task.timer);
      job.reject(err);
    }
    state.ready = false;
    shutdown();
    if (state.restarts < state.maxRestarts) {
      state.restarts++;
      setTimeout(boot, 120);
    } else {
      state.broken = true;
      state.mode = 'inline';
    }
  }

  function shutdown() {
    if (state.worker) {
      try {
        state.worker.terminate();
      } catch (e) {}
      state.worker = null;
    }
  }

  const queue = [];

  function flush() {
    while (queue.length && state.ready) {
      const job = queue.shift();
      dispatch(job);
    }
  }

  function dispatch(job) {
    state.seq++;
    const id = state.seq;
    job.msg.id = id;
    job.task.id = id;
    state.tasks.set(id, job.task);
    if (job.onTask) job.onTask(id);
    try {
      state.worker.postMessage(job.msg);
    } catch (e) {
      state.tasks.delete(id);
      job.reject(e);
    }
  }

  /* 结算一个任务：清定时器、从表中移除；返回 true 表示这是第一次结算（未被取消/超时抢先） */
  function finishTask(id) {
    const t = state.tasks.get(id);
    if (!t) return false;
    clearTimeout(t.timer);
    state.tasks.delete(id);
    return true;
  }

  function call(fn, args, opts) {
    opts = opts || {};
    const payload = {
      type: 'run',
      fn: typeof fn === 'function' ? fn.toString() : fn.code,
      fnName: typeof fn === 'function' ? fn.name : fn.name,
      args: args || [],
      hooks: !!opts.onProgress,
      timeout: opts.timeout || 0,
    };
    if (opts.progressEvery) payload.progressEvery = opts.progressEvery;
    return new Promise((resolve, reject) => {
      const task = { id: 0, resolve, reject, onProgress: opts.onProgress, mode: 'worker', cancelled: false, timer: 0 };
      const start = performance.now();
      task.start = start;

      /* ---- 主线程降级路径：也要支持超时与取消 ---- */
      if (state.mode === 'inline' || state.broken) {
        const id = ++state.seq;
        task.id = id;
        task.mode = 'inline';
        state.tasks.set(id, task);
        if (opts.onTask) opts.onTask(id);
        if (opts.timeout) {
          task.timer = setTimeout(() => {
            if (!state.tasks.has(id)) return;
            state.tasks.delete(id);
            reject(Object.assign(new Error('执行超时（' + Math.round(opts.timeout / 1000) + 's）。主线程降级模式无法强制中断正在跑的代码，本次结果已丢弃；用本地 http 服务打开可恢复后台线程'), { code: 'TIMEOUT' }));
          }, opts.timeout);
        }
        runInline(fn, args, opts, task).then(
          (v) => { if (finishTask(id)) resolve(v); },
          (e) => { if (finishTask(id)) reject(e); }
        );
        return;
      }

      if (!state.worker) boot();
      if (!state.ready) {
        queue.push({ msg: payload, task, reject, onTask: opts.onTask });
        if (state.broken === false && !state.worker) boot();
      } else {
        dispatch({ msg: payload, task, reject, onTask: opts.onTask });
      }
      if (opts.timeout) {
        task.timer = setTimeout(() => {
          if (!state.tasks.has(task.id)) return;
          state.tasks.delete(task.id);
          reject(Object.assign(new Error('执行超时（' + Math.round(opts.timeout / 1000) + 's）：可能是死循环，或数据量过大/算法过重'), { code: 'TIMEOUT' }));
          shutdown();
          state.ready = false;
          setTimeout(boot, 50);
        }, opts.timeout);
      }
    });
  }

  async function runInline(fn, args, opts, task) {
    const yieldTo = () => new Promise((r) => setTimeout(r, 0));
    await yieldTo();
    const hooks = makeHooks(opts, task);
    const f = typeof fn === 'function' ? fn : new Function('return (' + fn.code + ')')();
    if (task && task.cancelled) throw Object.assign(new Error('已取消'), { code: 'CANCELLED' });
    const out = await f.apply(null, args.concat([hooks]));
    if (task && task.cancelled) throw Object.assign(new Error('已取消'), { code: 'CANCELLED' });
    return out;
  }

  function makeHooks(opts, task) {
    return {
      progress(done, total, note) {
        if (opts.onProgress) opts.onProgress(done, total, note);
      },
      /* 长任务可以自己轮询这个标记做协作式取消 */
      cancelled() {
        return !!(task && task.cancelled);
      },
    };
  }

  function cancel(taskId) {
    const t = state.tasks.get(taskId);
    if (!t) {
      /* 还在排队（尚未 dispatch）：直接从队列里摘掉 */
      const i = queue.findIndex((j) => j.task && j.task.id === taskId);
      if (i >= 0) {
        const job = queue.splice(i, 1)[0];
        clearTimeout(job.task.timer);
        job.reject(Object.assign(new Error('已取消'), { code: 'CANCELLED' }));
      }
      return;
    }
    state.tasks.delete(taskId);
    clearTimeout(t.timer);
    t.reject(Object.assign(new Error('已取消'), { code: 'CANCELLED' }));
    if (t.mode === 'inline') {
      /* 主线程跑的代码无法强制终止，只做标记：handler 若支持 hooks.cancelled() 会自行退出 */
      t.cancelled = true;
      return;
    }
    shutdown();
    state.ready = false;
    setTimeout(boot, 30);
  }

  boot();

  SK.exec = {
    call,
    cancel,
    get mode() {
      return state.mode;
    },
    get ready() {
      return state.ready;
    },
    info: state,
  };
})(typeof window !== 'undefined' ? window : globalThis);
