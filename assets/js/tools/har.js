/* ============================================================================
   Spider Lab · har.js
   HAR 分析器：抓包文件一键透视
   - 请求总表：方法/状态/类型/域名/大小/耗时，支持关键字、类型、状态过滤
   - 失败请求 / 慢请求 TOP / 域名统计
   - 导出：URL 清单、批量 cURL、批量 Python requests、Cookie 与请求头汇总
   - 单条详情：请求头 / Cookie / 请求体 / 响应摘要
   ========================================================================== */
(function () {

  const TYPE_ORDER = { document: 'doc', xhr: 'xhr', fetch: 'xhr', script: 'js', stylesheet: 'css', image: 'img', font: 'font', manifest: 'other', other: 'other' };

  /* 挂到 SK 上：handler 在 Worker 里执行，模块顶层函数对 Worker 不可见 */
  SK.harUtils = {
    /* Charles / Fiddler / 部分代理导出的 HAR 会把 headers 写成对象 map，
       直接 .reduce / .find 会抛 TypeError 把整个工具打死。统一归一化成数组。 */
    toArr: function (x) {
      if (Array.isArray(x)) return x;
      if (x && typeof x === 'object') {
        return Object.keys(x).map(function (k) { return { name: k, value: String(x[k]) }; });
      }
      return [];
    },
    pickType: function (entry) {
      const t = String(entry._resourceType || entry._initiator && entry._initiator.type || '').toLowerCase();
      if (TYPE_ORDER[t]) return TYPE_ORDER[t];
      const mime = String((entry.response && entry.response.content && entry.response.content.mimeType) || '').toLowerCase();
      if (mime.indexOf('json') >= 0 || mime.indexOf('text/plain') >= 0) return 'xhr';
      if (mime.indexOf('javascript') >= 0 || mime.indexOf('ecmascript') >= 0) return 'js';
      if (mime.indexOf('css') >= 0) return 'css';
      if (mime.indexOf('image') >= 0) return 'img';
      if (mime.indexOf('font') >= 0 || mime.indexOf('woff') >= 0) return 'font';
      if (mime.indexOf('html') >= 0) return 'doc';
      return 'other';
    },
    entryRows: function (entries) {
      return entries.map(function (e, i) {
        const req = e.request || {};
        const res = e.response || {};
        let host = '';
        try { host = new URL(req.url).hostname; } catch (err) {}
        const bodySize = (res.content && res.content.size) || res.bodySize || 0;
        const inSize = SK.harUtils.toArr(req.headers).reduce(function (a, h) { return a + (h.name || '').length + (h.value || '').length + 2; }, 0) + ((req.postData && req.postData.text) || '').length;
        return {
          i: i + 1,
          method: req.method || '?',
          status: res.status || 0,
          statusShow: !res.status ? '✕ 0' : res.status >= 400 ? '✕ ' + res.status : res.status >= 300 ? '↻ ' + res.status : '✓ ' + res.status,
          type: SK.harUtils.pickType(e),
          host: host,
          url: String(req.url || ''),
          mime: String((res.content && res.content.mimeType) || '').split(';')[0],
          respBytes: bodySize,
          reqBytes: inSize,
          ms: Math.round(e.time || 0),
          started: e.startedDateTime || '',
        };
      });
    },
    entryDetail: function (e, r) {
      const req = e.request || {};
      const res = e.response || {};
      const BAR = '─'.repeat(64);
      const L = [];
      L.push('[' + r.i + '] ' + req.method + ' ' + req.url);
      L.push('状态: ' + res.status + ' ' + (res.statusText || '') + ' · 类型: ' + r.type + ' · 耗时: ' + r.ms + 'ms · 响应大小: ' + SK.dom.fmtBytes(r.respBytes));
      if (e.timings) {
        const t = e.timings;
        const fmt = function (v) { return v > 0 ? Math.round(v) + 'ms' : '-'; };
        L.push('耗时分解: DNS ' + fmt(t.dns) + ' · 连接 ' + fmt(t.connect) + ' · SSL ' + fmt(t.ssl) + ' · 等待(TTFB) ' + fmt(t.wait) + ' · 下载 ' + fmt(t.receive));
      }
      if (req.httpVersion) L.push('协议: ' + req.httpVersion + (res.httpVersion ? ' → ' + res.httpVersion : ''));
      L.push(BAR);
      L.push('■ 请求');
      const reqHeaders = SK.harUtils.toArr(req.headers);
      if (reqHeaders.length) {
        L.push('  头 (' + reqHeaders.length + '):');
        reqHeaders.slice(0, 40).forEach(function (h) { L.push('    ' + h.name + ': ' + String(h.value).slice(0, 500)); });
      }
      if ((req.cookies || []).length) {
        L.push('  Cookie (' + req.cookies.length + '):');
        req.cookies.slice(0, 30).forEach(function (c) { L.push('    ' + c.name + '=' + String(c.value).slice(0, 200)); });
      }
      if ((req.queryString || []).length) {
        L.push('  Query 参数:');
        req.queryString.forEach(function (q) { L.push('    ' + q.name + '=' + q.value); });
      }
      if (req.postData && req.postData.text) {
        L.push('  请求体 (' + (req.postData.mimeType || '未知类型') + '):');
        L.push('    ' + String(req.postData.text).slice(0, 6000));
      }
      L.push(BAR);
      L.push('■ 响应');
      const resHeaders = SK.harUtils.toArr(res.headers);
      if (resHeaders.length) {
        L.push('  头 (' + resHeaders.length + '):');
        resHeaders.slice(0, 40).forEach(function (h) { L.push('    ' + h.name + ': ' + String(h.value).slice(0, 500)); });
      }
      if (res.redirectURL) L.push('  重定向到: ' + res.redirectURL);
      const body = res.content && res.content.text;
      if (body) {
        const b64 = res.content.encoding === 'base64';
        const total = String(body).length;
        const cap = b64 ? 2000 : 8000;
        L.push('  响应体 (' + (res.content.mimeType || '') + (b64 ? '，base64 编码' : '') + '，' + total + ' 字符):');
        /* 截断必须写清楚「截断了多少」，否则用户拿去喂 json 工具只会得到一句语法错误 */
        L.push(b64 ? '    [base64 内容前 ' + cap + ' 字] ' + String(body).slice(0, cap) : '    ' + String(body).slice(0, cap));
        if (total > cap) {
          L.push('    …（已截断：完整 ' + total + ' 字符，这里只显示前 ' + cap + ' 字符。要看全文请用「JSON 格式化」粘贴完整响应，或在 DevTools 里 Copy response）');
        }
      } else {
        L.push('  响应体: HAR 里没有保存内容（导出时选「Save all as HAR with content」才有）');
      }
      return L.join('\n');
    },
  };

  SK.tool({
    id: 'har',
    name: 'HAR 分析器',
    group: 'spider',
    icon: '≡',
    aliases: 'har 抓包 分析 chrrome devtools 导出 导航瀑布',
    keywords: ['har', '抓包', '分析', '请求', '瀑布', 'devtools', '导出', 'curl', 'requests', '失败', '慢'],
    desc: '拖入 .har 抓包文件：请求总表 + 失败/慢请求定位 + 域名统计，一键批量导出 cURL / Python requests / URL 清单 / Cookie 汇总',
    sample: 'har',
    hint: 'Chrome DevTools → Network → 右键 → Save all as HAR；然后把 .har 文件拖进左边输入框',
    inputs: [{ id: 'in', label: 'HAR JSON（.har 文件直接拖进来）', placeholder: '{"log":{"entries":[…]}}', sample: 'har' }],
    options: [
      { id: 'kw', type: 'text', label: 'URL 过滤', value: '', placeholder: '域名或关键字，如 api.example.com' },
      { id: 'type', type: 'select', label: '类型', value: 'all', choices: [
        { v: 'all', label: '全部' },
        { v: 'xhr', label: 'XHR / 接口' },
        { v: 'doc', label: '文档' },
        { v: 'js', label: 'JS' },
        { v: 'img', label: '图片' },
        { v: 'css', label: '样式' },
        { v: 'font', label: '字体' },
      ] },
      { id: 'status', type: 'select', label: '状态', value: 'all', choices: [
        { v: 'all', label: '全部' },
        { v: 'fail', label: '仅失败' },
        { v: 'redirect', label: '仅重定向' },
        { v: 'ok', label: '仅 2xx' },
      ] },
      { id: 'limit', type: 'number', label: '导出上限', value: 300, min: 10, max: 5000, title: '批量转 cURL / requests 的最大条数，防止输出爆炸' },
      { id: 'bundle', type: 'toggle', label: '整合成单个脚本', value: true, title: '把整份 HAR 的输出合成一个可直接运行的 Session 脚本（共享登录态 / 重试 / 限速），而不是每条各生成一段' },
      { id: 'delay', type: 'number', label: '整合脚本间隔(秒)', value: 0.5, min: 0, max: 60, step: 0.1, title: '整合脚本里两条请求之间的 sleep，别把人家站打挂' },
    ],
    help:
      '<h4>怎么用</h4>' +
      '<ol><li>Chrome / Edge DevTools → Network 面板，复现需要的操作</li>' +
      '<li>右键请求列表 → <b>Save all as HAR with content</b>（带内容能看响应体）</li>' +
      '<li>把 .har 文件拖进左边输入框，运行</li></ol>' +
      '<h4>输出页签</h4>' +
      '<ul><li><b>请求总表</b>：全部请求，表格顶部可再过滤（支持正则）；点列头排序</li>' +
      '<li><b>失败请求</b>：4xx/5xx/0，先排查风控和参数错误</li>' +
      '<li><b>慢请求 TOP</b>：耗时排序，接口性能一目了然</li>' +
      '<li><b>域名统计</b>：每域名请求数和流量，找第三方上报</li>' +
      '<li><b>导出 cURL / Python</b>：按左侧过滤条件批量转换，粘到终端 / PyCharm 直接跑</li>' +
      '<li><b>单条详情</b>：每条请求的头 / Cookie / 请求体 / 响应摘要</li></ul>',
    handler: function (input, opts) {
      const text = String(input == null ? '' : input);
      if (!text.trim()) return { error: '输入为空', hint: '把 .har 文件拖进来，或粘贴 HAR JSON' };
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { error: 'HAR JSON 解析失败：' + e.message, hint: '确认是完整的 HAR 文件（大文件别用记事本复制，直接拖文件）' };
      }
      /* 兼容三种形态：整份 HAR / entries 数组 / 单条 entry */
      let entries;
      if (data.log && Array.isArray(data.log.entries)) entries = data.log.entries;
      else if (Array.isArray(data)) entries = data;
      else if (data.request) entries = [data];
      else return { error: '不是 HAR 格式', hint: '需要 {"log":{"entries":[…]}} 结构；单条请求请用「HAR 转 cURL」' };
      if (!entries.length) return { error: 'HAR 里没有条目' };

      const all = SK.harUtils.entryRows(entries);
      const kw = String(opts.kw || '').trim().toLowerCase();

      let rows = all;
      if (kw) rows = rows.filter(function (r) { return r.url.toLowerCase().indexOf(kw) >= 0; });
      if (opts.type !== 'all') rows = rows.filter(function (r) { return r.type === opts.type; });
      if (opts.status === 'fail') rows = rows.filter(function (r) { return r.status >= 400 || r.status === 0; });
      else if (opts.status === 'redirect') rows = rows.filter(function (r) { return r.status >= 300 && r.status < 400; });
      else if (opts.status === 'ok') rows = rows.filter(function (r) { return r.status >= 200 && r.status < 300; });
      if (!rows.length) return { error: '过滤后没有请求', hint: '放宽「URL 过滤 / 类型 / 状态」条件' };

      /* ---- 失败 / 慢 / 域名 ---- */
      const fails = all.filter(function (r) { return r.status >= 400 || r.status === 0; });
      const slow = all.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 20);
      const hostMap = {};
      all.forEach(function (r) {
        const h = hostMap[r.host] = hostMap[r.host] || { host: r.host, n: 0, bytes: 0, ms: 0 };
        h.n++;
        h.bytes += r.respBytes;
        h.ms = Math.max(h.ms, r.ms);
      });
      const hostRows = Object.keys(hostMap).map(function (k) { return hostMap[k]; }).sort(function (a, b) { return b.n - a.n; });

      /* ---- 导出 ---- */
      const limit = Math.max(10, Number(opts.limit || 300));
      const picked = rows.slice(0, limit);
      const skipped = rows.length - picked.length;

      const curlOut = [];
      const pyOut = [];
      const httpxOut = [];
      const aioOut = [];
      picked.forEach(function (r) {
        const e = entries[r.i - 1];
        const req = SK.net.fromHarEntry(e);
        curlOut.push('# ' + r.method + ' ' + r.status + ' ' + r.url.split('?')[0] + '\n' + SK.net.formatCurl(req, { pretty: true }));
        /* toRequests 返回 { code, warnings }，直接 push 整个对象会渲染成 [object Object]。
           separateCookies 必须显式 false，否则 Cookie 既不进头也不生成独立变量 → 登录态丢失。 */
        const opts = { separateCookies: false };
        const py = SK.net.toRequests(req, opts);
        pyOut.push(typeof py === 'string' ? py : (py && py.code) || '');
        if (SK.net.toHttpx) { const x = SK.net.toHttpx(req, opts); httpxOut.push((x && x.code) || ''); }
        if (SK.net.toAiohttp) { const a = SK.net.toAiohttp(req, opts); aioOut.push((a && a.code) || ''); }
      });

      /* ---- 整合脚本：一整份 HAR → 一个能直接跑的 Session 采集脚本 ----
       * 逐条生成的版本每段都带 import / 独立 headers，粘到同一个文件里会互相覆盖变量，
       * 而且丢了登录态（每条各建连接、各带一份 Cookie）。真实采集第一步需要的是
       * 「同一会话、按顺序、带节流与重试地回放这些请求」。
       */
      function buildBundle(pickUa, cookieStr) {
        const L = [];
        const want = picked;
        const hostSet = {};
        want.forEach(function (r) { if (r.host) hostSet[r.host] = 1; });
        const hosts = Object.keys(hostSet);
        const uaPick = pickUa || '';
        L.push('#!/usr/bin/env python3');
        L.push('# -*- coding: utf-8 -*-');
        L.push('"""由 Spider Lab 从 HAR 生成的采集脚本');
        L.push('');
        L.push('  来源请求数: ' + want.length + ' · 域名: ' + hosts.join(', '));
        L.push('  生成时间: ' + new Date().toISOString());
        L.push('');
        L.push('  说明:');
        L.push('    1. 所有请求走同一个 requests.Session —— Cookie / 登录态自动延续；');
        L.push('    2. 自带指数退避重试 + 请求间隔；403/429 会拉长等待（风控信号）；');
        L.push('    3. 风控参数（sign / token / timestamp）是抓包时的静态值，过期后需要在');
        L.push('       fetch_one() 里换成现算的 —— 先用「算法验证台」复现算法。');
        L.push('"""');
        L.push('');
        L.push('import random');
        L.push('import time');
        L.push('');
        L.push('import requests');
        L.push('');
        L.push('DELAY = ' + JSON.stringify(Number(opts.delay == null ? 0.5 : opts.delay)));
        L.push('RETRY = 3');
        L.push('TIMEOUT = 20');
        L.push('');
        L.push('# 采集目标：按需删改');
        L.push('TARGETS = [');
        want.forEach(function (r) { L.push('    ' + JSON.stringify(r.url) + ','); });
        L.push(']');
        L.push('');
        L.push('session = requests.Session()');
        if (uaPick) L.push('session.headers.update({"User-Agent": ' + JSON.stringify(uaPick) + '})');
        if (cookieStr) L.push('session.headers.update({"Cookie": ' + JSON.stringify(cookieStr) + '})');
        L.push('');
        L.push('');
        L.push('def fetch_one(url, method="GET", headers=None, **kw):');
        L.push('    """带退避重试的单请求；403/429 视为风控并延长等待。"""');
        L.push('    last = None');
        L.push('    for attempt in range(RETRY):');
        L.push('        try:');
        L.push('            resp = session.request(method, url, headers=headers, timeout=TIMEOUT, **kw)');
        L.push('            if resp.status_code in (403, 429):');
        L.push('                wait = (attempt + 1) * 5 + random.uniform(0, 2)');
        L.push('                print(f"  ! {resp.status_code} 疑似风控，等待 {wait:.1f}s 后重试")');
        L.push('                time.sleep(wait)');
        L.push('                last = resp');
        L.push('                continue');
        L.push('            return resp');
        L.push('        except requests.RequestException as exc:');
        L.push('            last = exc');
        L.push('            wait = 2 ** attempt + random.uniform(0, 1)');
        L.push('            print(f"  ! 请求异常 {exc!r}，{wait:.1f}s 后重试")');
        L.push('            time.sleep(wait)');
        L.push('    return last');
        L.push('');
        L.push('');
        L.push('def main():');
        L.push('    for i, url in enumerate(TARGETS, 1):');
        L.push('        print(f"[{i}/{len(TARGETS)}] {url}")');
        L.push('        resp = fetch_one(url)');
        L.push('        if resp is None or isinstance(resp, Exception):');
        L.push('            print("  x 失败:", resp)');
        L.push('            continue');
        L.push('        print(f"  -> {resp.status_code} · {len(resp.content)} bytes")');
        L.push('        # TODO: 在这里解析 resp.text / resp.json()，写库或落盘');
        L.push('        if DELAY and i < len(TARGETS):');
        L.push('            time.sleep(DELAY + random.uniform(0, DELAY / 2))');
        L.push('');
        L.push('');
        L.push('if __name__ == "__main__":');
        L.push('    main();');
        return L.join('\n');
      }
      const urlText = rows.map(function (r) { return r.url; }).join('\n');

      /* ---- 验证向量：POST 请求参数做 args、签名头做 expect（喂「算法验证台」） ---- */
      const SIGN_HEADERS = /^(x-)?(sign|signature|sign_str|nonce-sign)$/i;
      const vecs = [];
      picked.forEach(function (r) {
        const e = entries[r.i - 1];
        const req = e.request || {};
        if (String(req.method).toUpperCase() !== 'POST') return;
        const signHeader = SK.harUtils.toArr(req.headers).find(function (h) { return SIGN_HEADERS.test(h.name); });
        const args = {};
        (req.queryString || []).forEach(function (q) { args[q.name] = q.value; });
        if (req.postData && req.postData.text) {
          const mt = String(req.postData.mimeType || '');
          if (mt.indexOf('json') >= 0) {
            try { const b = JSON.parse(req.postData.text); if (b && typeof b === 'object') Object.keys(b).forEach(function (k) { args[k] = b[k]; }); } catch (err) {}
          } else if (mt.indexOf('urlencoded') >= 0 || (req.postData.text.indexOf('=') > 0 && req.postData.text.indexOf('&') >= 0)) {
            req.postData.text.split('&').forEach(function (pair) {
              const ix = pair.indexOf('=');
              if (ix > 0) { try { args[decodeURIComponent(pair.slice(0, ix))] = decodeURIComponent(pair.slice(ix + 1)); } catch (err) {} }
            });
          } else {
            args.__body = String(req.postData.text).slice(0, 2000);
          }
        }
        if (!signHeader) return;
        const tsHeader = SK.harUtils.toArr(req.headers).find(function (h) { return /^(x-)?(t|ts|timestamp|time)$/i.test(h.name); });
        if (tsHeader && args.ts === undefined) args.ts = Number(tsHeader.value) || tsHeader.value;
        vecs.push({ args: [args], expect: String(signHeader.value) });
      });
      const vecText = vecs.length
        ? JSON.stringify(vecs, null, 2)
        : '没有可抽向量的请求：需要 POST 且带 sign/signature/x-sign 等签名头的请求';

      /* ---- Cookie / 请求头汇总（取请求次数最多的 UA） ---- */
      const uaCount = {};
      let mergedCookies = {};
      rows.forEach(function (r) {
        const e = entries[r.i - 1];
        SK.harUtils.toArr(e.request.headers).forEach(function (h) {
          const n = h.name.toLowerCase();
          if (n === 'user-agent') uaCount[h.value] = (uaCount[h.value] || 0) + 1;
          if (n === 'cookie') String(h.value).split(';').forEach(function (pair) {
            const ix = pair.indexOf('=');
            if (ix > 0) {
              const k = pair.slice(0, ix).trim();
              if (!mergedCookies[k]) mergedCookies[k] = pair.slice(ix + 1).trim();
            }
          });
        });
      });
      const ua = Object.keys(uaCount).sort(function (a, b) { return uaCount[b] - uaCount[a]; })[0] || '';
      const cookieText = Object.keys(mergedCookies).map(function (k) { return k + '=' + mergedCookies[k]; }).join('; ');

      const bundleText = buildBundle(ua, cookieText);
      const totalBytes = all.reduce(function (a, r) { return a + r.respBytes; }, 0);
      const avgMs = all.length ? Math.round(all.reduce(function (a, r) { return a + r.ms; }, 0) / all.length) : 0;

      const cols = [
        { key: 'i', label: '#', width: '52px' },
        { key: 'method', label: '方法', width: '64px' },
        { key: 'statusShow', label: '状态', width: '72px' },
        { key: 'type', label: '类型', width: '58px' },
        { key: 'host', label: '域名', width: 'minmax(130px,200px)' },
        { key: 'url', label: 'URL' },
        { key: 'respBytes', label: '响应', width: '78px' },
        { key: 'ms', label: '耗时', width: '64px' },
      ];

      /* 每行附完整请求/响应详情（表格行尾「🔍 详情」弹窗查看；详情文本参与过滤，可按响应内容搜） */
      const withDetail = function (rs) {
        rs.forEach(function (r) {
          if (r.__detail !== undefined) return;
          const e = entries[r.i - 1];
          r.__detail = SK.harUtils.entryDetail(e, r);
          r.__detailTitle = '#' + r.i + ' ' + r.method + ' ' + String(r.url).split('?')[0];
        });
        return rs;
      };
      withDetail(rows);
      if (fails.length) withDetail(fails);
      withDetail(slow);

      return {
        view: 'table',
        data: {
          columns: cols, rows: rows, name: 'har-requests',
          caption: '点行尾「🔍 详情」查看完整请求头 / 请求体 / 响应头 / 响应体；过滤框可直接搜响应内容',
          filterHint: '过滤 URL / 域名 / 响应内容（支持正则）',
        },
        /* text 供「复制/下载输出」用：全部 URL 清单 */
        text: urlText,
        lang: 'text',
        tabLabel: '请求总表 (' + rows.length + ')',
        tabs: [
          fails.length ? { label: '失败请求 (' + fails.length + ')', view: 'table', data: {
            columns: cols, rows: fails, name: 'har-fails',
            filterHint: '4xx/5xx/0，先看这些',
          } } : null,
          { label: '慢请求 TOP', view: 'table', data: {
            columns: cols, rows: slow, name: 'har-slow',
          } },
          { label: '域名统计 (' + hostRows.length + ')', view: 'table', data: {
            columns: [
              { key: 'host', label: '域名' },
              { key: 'n', label: '请求数', width: '90px' },
              { key: 'bytes', label: '流量', width: '100px' },
              { key: 'maxMs', label: '最慢', width: '80px' },
            ],
            rows: hostRows.map(function (h) { return { host: h.host, n: h.n, bytes: SK.dom.fmtBytes(h.bytes), maxMs: h.ms + 'ms' }; }),
            name: 'har-hosts',
          } },
          { label: '导出 cURL' + (skipped ? ' (前' + picked.length + ')' : ''), text: curlOut.join('\n\n'), lang: 'shell' },
          { label: '导出 Python', text: pyOut.join('\n\n'), lang: 'python' },
          opts.bundle === false ? null : { label: '整合脚本 (可直接跑)', text: bundleText, lang: 'python' },
          { label: '导出 httpx', text: httpxOut.join('\n\n'), lang: 'python' },
          { label: '导出 aiohttp', text: aioOut.join('\n\n'), lang: 'python' },
          { label: '验证向量 (POST+签名头)', text: vecText, lang: 'text' },
          { label: 'URL 清单 (' + rows.length + ')', text: urlText, lang: 'text' },
          cookieText ? { label: 'Cookie 汇总', text: cookieText, lang: 'text' } : null,
        ].filter(Boolean),
        stats: [
          { k: '请求', v: SK.dom.fmtNum(all.length) },
          { k: '过滤后', v: SK.dom.fmtNum(rows.length) },
          fails.length ? { k: '失败', v: fails.length, level: 'warn' } : { k: '失败', v: 0, level: 'ok' },
          { k: '域名', v: hostRows.length },
          { k: '总流量', v: SK.dom.fmtBytes(totalBytes) },
          { k: '平均耗时', v: avgMs + 'ms' },
        ],
        notices: skipped ? [{ level: 'warn', msg: '导出页签只包含前 ' + picked.length + ' 条（共 ' + rows.length + ' 条），可在选项里调大「导出上限」' }] : null,
        filename: 'har-report',
        vecText: vecText,
        next: [
          { label: '✓ 抽的向量去验证台跑', tool: 'sign-verify', carry: 'vecText', input: 1 },
          { label: '≣ URL 清单去批处理', tool: 'url-batch' },
        ],
      };
    },
  });
})();
