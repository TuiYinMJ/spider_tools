(function (root) {
  'use strict';

  const SK = (root.SK = root.SK || {});

  /* ============================================================
   * low level helpers
   * ============================================================ */

  function isStr(v) {
    return typeof v === 'string';
  }

  function utf8Len(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }

  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  }

  function offsetToPos(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  }

  function err(message, line, column) {
    const e = { message: String(message) };
    if (line != null) e.line = line;
    if (column != null) e.column = column;
    return e;
  }

  function fail(message, offset, text) {
    if (offset == null || !isStr(text)) return { ok: false, error: err(message) };
    const p = offsetToPos(lineStarts(text), offset);
    return { ok: false, error: err(message, p.line, p.column) };
  }

  function warn(list, code, message) {
    list.push({ code: code, message: message });
  }

  /* ============================================================
   * shell tokenizer (bash / cmd / powershell), position aware
   * ============================================================ */

  const WS = ' \t\f\v';

  function detectShell(text) {
    const crlf = (text.match(/\r\n/g) || []).length;
    const backslashCont = (text.match(/\\\r?\n/g) || []).length;
    const caretCont = (text.match(/\^\r?\n/g) || []).length;
    const tickCont = (text.match(/`\r?\n/g) || []).length;
    if (/^\s*PS [A-Za-z]:[^>]*>/m.test(text) || (tickCont > backslashCont && tickCont > caretCont))
      return 'ps';
    if (crlf && caretCont >= backslashCont && caretCont > 0) return 'cmd';
    if (backslashCont === 0 && caretCont > 0) return 'cmd';
    return 'posix';
  }

  function tokenizeShell(text, mode) {
    /* ---- cmd.exe 预处理 ----
     * Chrome「Copy as cURL (cmd)」会写成 curl ^"url^" ^ / -H ^"k: v^" / --data-raw ^"^{^\^"a^\^":1^}^"。
     * 旧实现把 ^" 当成「转义后的字面引号」直接塞进参数，url 变成 "https://…"（带引号），
     * header 变成 "accept:（值全丢），JSON 体变成引号乱码 —— Windows 用户第一条 cURL 就翻车。
     * cmd 的真实规则是：^ 转义紧随其后的一个字符，^" 就是给 argv 用的引号。
     * 因此先把组合转义还原，再把 ^X 一律还原成 X，剩下的引号交给正常的引号分支处理。 */
    if (mode === 'cmd') {
      text = text.replace(/\^\r?\n/g, ' ').replace(/\^\\\^"/g, '\\"').replace(/\^([\s\S])/g, '$1');
    }
    const items = [];
    const n = text.length;
    let i = 0;
    let buf = null;
    let bufStart = 0;

    function flush(end) {
      if (buf !== null) {
        items.push({ t: 'w', v: buf.join(''), s: bufStart, e: end });
        buf = null;
      }
    }
    function word() {
      if (buf === null) {
        buf = [];
        bufStart = i;
      }
    }
    function contLen(idx) {
      // 返回 idx 处换行（含行继续）应被吞掉的字符数
      const c = text[idx];
      if (c === '\r') return text[idx + 1] === '\n' ? 2 : 1;
      if (c === '\n') return 1;
      return 0;
    }

    while (i < n) {
      const c = text[i];
      if (WS.indexOf(c) >= 0) {
        flush(i);
        i++;
        continue;
      }
      if (c === '\n' || c === '\r') {
        flush(i);
        const s = i;
        i = c === '\r' && text[i + 1] === '\n' ? i + 2 : i + 1;
        items.push({ t: 'nl', v: '', s: s, e: i });
        continue;
      }
      if (c === '#' && buf === null) {
        const s = i;
        while (i < n && text[i] !== '\n') i++;
        items.push({ t: '#', v: text.slice(s, i), s: s, e: i });
        continue;
      }
      if (c === ';') {
        flush(i);
        items.push({ t: 'sep', v: ';', s: i, e: i + 1 });
        i++;
        continue;
      }
      if (c === '|') {
        flush(i);
        const two = text[i + 1] === '|';
        items.push({ t: 'sep', v: two ? '||' : '|', s: i, e: i + (two ? 2 : 1) });
        i += two ? 2 : 1;
        continue;
      }
      if (c === '&') {
        if (text[i + 1] === '&') {
          flush(i);
          items.push({ t: 'sep', v: '&&', s: i, e: i + 2 });
          i += 2;
          continue;
        }
        if (mode === 'ps') {
          word();
          buf.push(c);
          i++;
          continue;
        }
        flush(i);
        items.push({ t: 'sep', v: '&', s: i, e: i + 1 });
        i++;
        continue;
      }

      if (mode === 'posix') {
        if (c === "'") {
          word();
          const s = i;
          i++;
          let closed = false;
          while (i < n) {
            if (text[i] === "'") {
              i++;
              closed = true;
              break;
            }
            buf.push(text[i]);
            i++;
          }
          if (!closed) return { error: err('单引号未闭合 (unterminated single quote)', s) };
          continue;
        }
        if (c === '"') {
          word();
          const s = i;
          i++;
          let closed = false;
          while (i < n) {
            const d = text[i];
            if (d === '"') {
              i++;
              closed = true;
              break;
            }
            if (d === '\\') {
              const nx = text[i + 1];
              if (nx === '\n' || nx === '\r') {
                const l = contLen(i + 1);
                if (l) {
                  i += 1 + l;
                  continue;
                }
                if (nx === '\n' || nx === '\r') {
                  return { error: err('双引号跨物理行且未闭合 (unterminated double quote)', s) };
                }
              }
              if (nx === undefined) return { error: err('转义符后缺少字符', i) };
              if (nx === '"' || nx === '\\' || nx === '$' || nx === '`' || nx === '\n') {
                buf.push(nx);
                i += 2;
                continue;
              }
              buf.push(d);
              i++;
              continue;
            }
            buf.push(d);
            i++;
          }
          if (!closed) return { error: err('双引号未闭合 (unterminated double quote)', s) };
          continue;
        }
        if (c === '\\') {
          const l = contLen(i + 1);
          if (l) {
            i += 1 + l;
            continue;
          }
          const nx = text[i + 1];
          if (nx === undefined) {
            i++;
            continue;
          }
          word();
          buf.push(nx);
          i += 2;
          continue;
        }
        word();
        buf.push(c);
        i++;
        continue;
      }

      if (mode === 'cmd') {
        if (c === '"') {
          word();
          const s = i;
          i++;
          let closed = false;
          while (i < n) {
            const d = text[i];
            if (d === '"' && text[i + 1] === '"') {
              buf.push('"');
              i += 2;
              continue;
            }
            if (d === '\\' && text[i + 1] === '"') {
              buf.push('"');
              i += 2;
              continue;
            }
            if (d === '"') {
              i++;
              closed = true;
              break;
            }
            if (d === '\n') break;
            buf.push(d);
            i++;
          }
          if (!closed) return { error: err('双引号未闭合 (unterminated double quote)', s) };
          continue;
        }
        if (c === '^') {
          const l = contLen(i + 1);
          if (l) {
            flush(i + 1 + l);
            i += 1 + l;
            continue;
          }
          const nx = text[i + 1];
          if (nx === undefined) {
            i++;
            continue;
          }
          word();
          buf.push(nx);
          i += 2;
          continue;
        }
        word();
        buf.push(c);
        i++;
        continue;
      }

      // powershell
      if (c === "'") {
        word();
        const s = i;
        i++;
        let closed = false;
        while (i < n) {
          if (text[i] === "'") {
            if (text[i + 1] === "'") {
              buf.push("'");
              i += 2;
              continue;
            }
            i++;
            closed = true;
            break;
          }
          buf.push(text[i]);
          i++;
        }
        if (!closed) return { error: err('单引号未闭合 (unterminated single quote)', s) };
        continue;
      }
      if (c === '"') {
        word();
        const s = i;
        i++;
        let closed = false;
        while (i < n) {
          const d = text[i];
          if (d === '`') {
            const l = contLen(i + 1);
            if (l) {
              i += 1 + l;
              continue;
            }
            const nx = text[i + 1];
            if (nx === undefined) break;
            buf.push(nx);
            i += 2;
            continue;
          }
          if (d === '"' && text[i + 1] === '"') {
            buf.push('"');
            i += 2;
            continue;
          }
          if (d === '"' && text[i + 1] === '\n') {
            i += 2;
            closed = true;
            break;
          }
          if (d === '"') {
            i++;
            closed = true;
            break;
          }
          buf.push(d);
          i++;
        }
        if (!closed) return { error: err('双引号未闭合 (unterminated double quote)', s) };
        continue;
      }
      if (c === '`') {
        const l = contLen(i + 1);
        if (l) {
          flush(i + 1 + l);
          i += 1 + l;
          continue;
        }
        const nx = text[i + 1];
        if (nx === undefined) {
          i++;
          continue;
        }
        word();
        buf.push(nx);
        i += 2;
        continue;
      }
      word();
      buf.push(c);
      i++;
    }
    flush(n);
    return { items: items };
  }

  const CURL_WORD = /^(?:.*[\\/])?curl(?:\.exe)?$/i;

  function splitCommands(items) {
    const commands = [];
    let seg = [];
    let segStart = 0;
    function push(end) {
      if (seg.length) {
        commands.push({ words: seg, s: segStart, e: end });
        seg = [];
      }
    }
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (it.t === '#') continue;
      if (it.t === 'nl' || it.t === 'sep') {
        /* 换行续行容错：从网页/文档里复制多行 cURL 时，行尾的 \ 经常丢。
           下一行以 - 或 -- 开头说明仍是同一条命令的参数，这里接上而不是当成新命令，
           否则用户得到的是一句「只有一个 URL、没有任何 header」的残缺代码。 */
        if (seg.length) {
          let j = k + 1;
          while (j < items.length && (items[j].t === 'nl' || items[j].t === '#')) j++;
          const nx = items[j];
          const startsFlag = nx && nx.t === 'w' && /^-{1,2}[A-Za-z]/.test(nx.v);
          if (startsFlag) continue;
        }
        push(it.e);
        continue;
      }
      if (!seg.length) segStart = it.s;
      seg.push(it);
    }
    push(items.length ? items[items.length - 1].e : 0);
    return commands;
  }

  function findCurlCommand(commands) {
    for (let k = 0; k < commands.length; k++) {
      const words = commands[k].words;
      for (let j = 0; j < words.length; j++) {
        const v = words[j].v;
        if (CURL_WORD.test(v)) {
          const before = words.slice(0, j);
          const ignorable = before.every(function (w) {
            return /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.v) || /^(sudo|doas|env|command|time|&)$/.test(w.v);
          });
          if (ignorable) return { index: k, cmdToken: j };
          break;
        }      }
    }
    return null;
  }

  /* ============================================================
   * url / header / cookie primitives
   * ============================================================ */

  const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21' };

  function parseUrlParts(url) {
    try {
      const u = new URL(url);
      return {
        protocol: u.protocol,
        host: u.host,
        hostname: u.hostname,
        port: u.port || (DEFAULT_PORTS[u.protocol] ? null : null) || null,
        path: u.pathname,
        search: u.search,
        hash: u.hash,
        origin: u.origin,
      };
    } catch (e) {
      return null;
    }
  }

  function parseQueryString(search) {
    const out = [];
    const s = String(search || '').replace(/^[?#]/, '');
    if (!s) return out;
    const pieces = s.split('&');
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p) continue;
      const eq = p.indexOf('=');
      const rawName = eq < 0 ? p : p.slice(0, eq);
      const rawVal = eq < 0 ? '' : p.slice(eq + 1);
      out.push({ name: decodePiece(rawName), value: decodePiece(rawVal) });
    }
    return out;
  }

  function decodePiece(v) {
    try {
      return decodeURIComponent(String(v).replace(/\+/g, ' '));
    } catch (e) {
      return String(v);
    }
  }

  function encodePiece(v) {
    return encodeURIComponent(String(v == null ? '' : v)).replace(/%20/g, '+');
  }

  const SPECIAL_HEADER = /^(content-type|content-length|transfer-encoding|host|connection|cookie|set-cookie|authorization|proxy-authorization|expect|date|keep-alive|upgrade)$/i;

  function parseHeaderBlock(text) {
    const out = [];
    if (!isStr(text)) return out;
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let seenBodyBoundary = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (!line.trim()) {
        if (out.length) seenBodyBoundary = true;
        continue;
      }
      if (seenBodyBoundary) break;
      line = line.replace(/^[<>]\s?/, '').trim();
      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+\S+\s+HTTP\//i.test(line)) continue;
      if (/^HTTP\/[\d.]+\s+\d{3}/i.test(line)) continue;
      if (/^[A-Za-z][A-Za-z0-9+ .-]*headers?$/i.test(line)) continue;
      if (/^-{3,}$/.test(line) || /^=+$/.test(line)) continue;
      if (/^\s+\S/.test(lines[i]) && out.length) {
        out[out.length - 1].value += ' ' + line.trim();
        continue;
      }
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const name = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).replace(/^\s+/, '').replace(/\s+$/, '');
      if (!/^[\x21-\x7e]+$/.test(name)) continue;
      out.push({ name: name, value: value });
    }
    return out;
  }

  function formatHeaderBlock(list, opts) {
    opts = opts || {};
    const rows = (list || []).map(function (h) {
      return { name: h.name || h.n || '', value: h.value != null ? h.value : h.v };
    });
    if (!rows.length) return '';
    let pad = 0;
    if (opts.align) {
      rows.forEach(function (r) {
        const len = r.name.length + 1;
        if (len > pad) pad = len;
      });
    }
    const out = [];
    rows.forEach(function (r) {
      const head = r.name + ':';
      out.push(opts.align ? (head + ' ').padEnd(pad + 1) + String(r.value) : head + ' ' + String(r.value));
    });
    return out.join('\n') + (opts.trailingBlank ? '\n' : '');
  }

  function cookiePairs(str) {
    const out = [];
    const s = String(str == null ? '' : str).trim();
    if (!s) return out;
    const parts = s.split(';');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].trim();
      if (!p) continue;
      const eq = p.indexOf('=');
      if (eq < 0) out.push({ name: p, value: '' });
      else out.push({ name: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim() });
    }
    return out;
  }

  const IMF = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
  const RFC850 = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
  const ASCTIME = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Za-z]{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  function parseHttpDate(raw, now) {
    const s = String(raw == null ? '' : raw).trim();
    const ref = now == null ? Date.now() : now;
    if (!s) return { raw: raw == null ? null : raw, iso: null, expired: false };
    let m = IMF.exec(s);
    let ms = NaN;
    if (m) {
      const mo = MONTHS[m[2]];
      if (mo != null) ms = Date.UTC(Number(m[3]), mo, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
    } else if ((m = RFC850.exec(s))) {
      const mo = MONTHS[m[2]];
      let y = Number(m[3]);
      y = y < 70 ? 2000 + y : 1900 + y;
      if (mo != null) ms = Date.UTC(y, mo, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
    } else if ((m = ASCTIME.exec(s))) {
      const mo = MONTHS[m[1]];
      if (mo != null) ms = Date.UTC(Number(m[6]), mo, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
    } else if (/^(?:never|unset)$/i.test(s)) {
      ms = Infinity;
    } else {
      const d = Date.parse(s);
      if (!isNaN(d)) ms = d;
    }
    if (ms === Infinity) return { raw: s, iso: null, expired: false };
    if (isNaN(ms)) return { raw: s, iso: null, expired: false };
    return { raw: s, iso: new Date(ms).toISOString(), expired: ms <= ref };
  }

  const SET_COOKIE_ATTRS = ['expires', 'max-age', 'domain', 'path', 'secure', 'httponly', 'samesite', 'partitioned', 'priority', 'sameorigin'];

  function parseCookie(str, opts) {
    opts = opts || {};
    const now = opts.now == null ? Date.now() : opts.now;
    const entries = [];
    const errors = [];
    const text = isStr(str) ? str : str == null ? '' : String(str);
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.trim(); });

    for (let li = 0; li < lines.length; li++) {
      let line = lines[li].trim();
      line = line.replace(/^set-cookie\d?\s*:\s*/i, '').replace(/^cookie\s*:\s*/i, '').replace(/^cookie\s*=\s*/i, '').replace(/^document\.cookie\s*=\s*/i, '').trim();
      if (!line) continue;
      if (/^[{[]/.test(line)) {
        try {
          const data = JSON.parse(line);
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(function (o) {
            if (!o || typeof o !== 'object') {
              errors.push(err('JSON cookie 项不是对象'));
              return;
            }
            entries.push(entryFromObject(o, now));
          });
        } catch (e) {
          errors.push(err('JSON cookie 解析失败: ' + e.message));
        }
        continue;
      }
      const attrMode = lines.length === 1 || /;\s*(expires|max-age|path|domain|samesite|httponly|secure|partitioned)\b/i.test(line) || /\bhttponly\b|\bsecure\b|\bpartitioned\b/i.test(line);
      const delim = line.indexOf(';') < 0 && line.indexOf('&') >= 0 ? '&' : ';';
      const chunks = attrMode ? splitCookieLine(line, delim) : [line];
      let first = true;
      let cur = null;
      for (let ci = 0; ci < chunks.length; ci++) {
        const raw = chunks[ci];
        const piece = raw.trim();
        if (!piece) continue;
        const eq = piece.indexOf('=');
        const name = eq < 0 ? piece : piece.slice(0, eq).trim();
        const value = eq < 0 ? '' : piece.slice(eq + 1).trim();
        const lower = name.toLowerCase();
        if (first) {
          if (!name) {
            errors.push(err('cookie 名称为空'));
            continue;
          }
          cur = makeEntry(name, unquote(value), now);
          entries.push(cur);
          first = false;
          continue;
        }
        if (SET_COOKIE_ATTRS.indexOf(lower) < 0) {
          if (attrMode && cur) cur.attributes[lower] = value ? unquote(value) : true;
          else if (attrMode && cur) {
            // 未知属性：按额外 cookie 处理更贴近浏览器行为
            entries.push(makeEntry(name, unquote(value), now));
          } else {
            entries.push(makeEntry(name, unquote(value), now));
          }
          continue;
        }
        if (!cur) continue;
        if (lower === 'expires') cur.expires = parseHttpDate(value, now);
        else if (lower === 'max-age') {
          const secs = Number(value);
          if (isNaN(secs)) errors.push(err('Max-Age 非法: ' + value));
          else {
            const ms = now + secs * 1000;
            cur.attributes['max-age'] = value;
            if (!cur.expires.raw || cur.expires.iso == null)
              cur.expires = { raw: 'max-age=' + value, iso: new Date(ms).toISOString(), expired: ms <= now };
          }
        } else if (lower === 'domain') {
          cur.domain = value.replace(/^\./, '');
          cur.attributes.domain = value;
        } else if (lower === 'path') {
          cur.path = value;
          cur.attributes.path = value;
        } else if (lower === 'samesite') cur.attributes.samesite = value;
        else cur.attributes[lower] = true;
      }
      if (first) errors.push(err('无法解析 cookie 行: ' + line.slice(0, 60)));
    }

    if (opts.dedupe) {
      const seen = Object.create(null);
      const kept = [];
      for (let k = entries.length - 1; k >= 0; k--) {
        const e = entries[k];
        const key = (e.domain || '') + '|' + (e.path || '') + '|' + e.name;
        if (seen[key]) continue;
        seen[key] = 1;
        kept.push(e);
      }
      kept.reverse();
      return { entries: kept, errors: errors };
    }
    return { entries: entries, errors: errors };
  }

  function splitCookieLine(line, delim) {
    // Expires 值内含空格/逗号，不能直接按分隔符切；先保护日期片段
    const protectedLine = line.replace(/(expires\s*=\s*)([^;]+)/i, function (_, k, v) {
      return k + '\u0001' + v.replace(/[\u0001;]/g, '\u0002') + '\u0001';
    });
    return protectedLine.split(delim).map(function (p) {
      return p.replace(/\u0001/g, '').replace(/\u0002/g, ';');
    });
  }

  function unquote(v) {
    const s = String(v == null ? '' : v);
    if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
    return s;
  }

  function makeEntry(name, value, now) {
    return {
      name: name,
      value: value,
      attributes: {},
      domain: null,
      path: null,
      expires: { raw: null, iso: null, expired: false },
      size: utf8Len(name) + utf8Len(value),
    };
  }

  function entryFromObject(o, now) {
    const e = makeEntry(String(o.name != null ? o.name : o.n != null ? o.n : ''), String(o.value != null ? o.value : o.v != null ? o.v : ''), now);
    if (o.domain) e.domain = String(o.domain).replace(/^\./, '');
    if (o.path) e.path = String(o.path);
    if (o.expires) e.expires = parseHttpDate(o.expires, now);
    if (o.maxAge != null || o['max-age'] != null) {
      const secs = Number(o.maxAge != null ? o.maxAge : o['max-age']);
      if (!isNaN(secs)) e.expires = { raw: 'max-age=' + secs, iso: new Date(now + secs * 1000).toISOString(), expired: now + secs * 1000 <= now };
    }
    if (o.attributes && typeof o.attributes === 'object') {
      Object.keys(o.attributes).forEach(function (k) {
        e.attributes[String(k).toLowerCase()] = o.attributes[k];
      });
    }
    if (o.httpOnly || o.httponly) e.attributes.httponly = true;
    if (o.secure) e.attributes.secure = true;
    if (o.sameSite) e.attributes.samesite = o.sameSite;
    if (o.partitioned) e.attributes.partitioned = true;
    return e;
  }

  function formatCookie(list, opts) {
    opts = opts || {};
    const style = opts.style || 'header';
    const arr = normalizeCookieList(list);
    if (style === 'json') {
      return JSON.stringify(
        arr.map(function (e) {
          const o = { name: e.name, value: e.value };
          if (e.domain) o.domain = e.domain;
          if (e.path) o.path = e.path;
          if (e.expires && e.expires.raw) o.expires = e.expires.raw;
          if (Object.keys(e.attributes).length) o.attributes = e.attributes;
          return o;
        }),
        null,
        2
      );
    }
    if (style === 'set') {
      return arr
        .map(function (e) {
          const parts = [e.name + '=' + e.value];
          if (e.path) parts.push('Path=' + e.path);
          if (e.domain) parts.push('Domain=' + e.domain);
          if (e.expires && e.expires.raw && !/^max-age=/i.test(e.expires.raw)) parts.push('Expires=' + e.expires.raw);
          if (e.attributes['max-age']) parts.push('Max-Age=' + e.attributes['max-age']);
          if (e.attributes.samesite) parts.push('SameSite=' + e.attributes.samesite);
          if (e.attributes.secure) parts.push('Secure');
          if (e.attributes.httponly) parts.push('HttpOnly');
          if (e.attributes.partitioned) parts.push('Partitioned');
          return (opts.prefix === false ? '' : 'Set-Cookie: ') + parts.join('; ');
        })
        .join('\n');
    }
    if (style === 'pair') return arr.map(function (e) { return e.name + '=' + e.value; }).join('&');
    if (style === 'doc')
      return arr
        .map(function (e) { return 'document.cookie = ' + JSON.stringify(e.name + '=' + e.value + (e.path ? ';path=' + e.path : '') + (e.domain ? ';domain=' + e.domain : '')) + ';'; })
        .join('\n');
    return (opts.prefix === false ? '' : 'Cookie: ') + arr.map(function (e) { return e.name + '=' + e.value; }).join('; ');
  }

  function normalizeCookieList(list) {
    if (list == null) return [];
    if (!Array.isArray(list)) {
      if (typeof list === 'object' && list.entries) return list.entries;
      if (typeof list === 'object' && !Array.isArray(list)) {
        return Object.keys(list).map(function (k) { return makeEntry(k, String(list[k]), Date.now()); });
      }
      list = parseCookie(String(list)).entries;
    }
    return list.map(function (e) {
      if (typeof e === 'string') return parseCookie(e).entries[0] || makeEntry(e, '', Date.now());
      return makeEntry(String(e.name != null ? e.name : ''), String(e.value != null ? e.value : ''), Date.now());
    });
  }

  /* ============================================================
   * curl flag tables
   * ============================================================ */

  const ARITY = {
    request: 1, url: 1, header: 1, data: 1, 'data-raw': 1, 'data-binary': 1, 'data-urlencode': 1,
    form: 1, 'form-string': 1, cookie: 1, 'cookie-jar': 1, user: 1, 'user-agent': 1, referer: 1,
    output: 1, proxy: 1, 'proxy-user': 1, 'socks5-hostname': 1, 'max-time': 1, 'connect-timeout': 1,
    'max-redirs': 1, resolve: 1, 'connect-to': 1, 'limit-rate': 1, retry: 1, 'retry-delay': 1,
    cacert: 1, capath: 1, cert: 1, key: 1, pass: 1, 'output-dir': 1, 'write-out': 1, range: 1,
    interface: 1, 'local-port': 1, 'abstract-unix-socket': 1, config: 1, stderr: 1, 'dump-header': 1,
    'oauth2-bearer': 1, 'upload-file': 1, 'time-cond': 1, 'speed-limit': 1, 'speed-time': 1, quote: 1,
    noproxy: 1, 'dns-servers': 1, 'next': 0,
    insecure: 0, location: 0, compressed: 0, silent: 0, 'show-error': 0, verbose: 0, head: 0,
    version: 0, httpVersion: 0, 'no-keepalive': 0, keepalive: 0, 'no-buffer': 0, get: 0, include: 0,
    fail: 0, globoff: 0, 'retry-connrefused': 0, 'ignore-content-length': 0, 'junk-session-cookies': 0,
    'remote-name': 0, 'remote-time': 0, proxytunnel: 0, netrc: 0, parallel: 0, 'progress-bar': 0,
    help: 0, manual: 0, 'list-only': 0, anyauth: 0, basic: 0, digest: 0, ntlm: 0, negotiate: 0,
    'create-dirs': 0, 'fail-early': 0, 'tcp-nodelay': 0, 'http0.9': 0,
  };

  const SHORT_FLAGS = {
    X: 'request', A: 'user-agent', b: 'cookie', c: 'cookie-jar', d: 'data', D: 'dump-header',
    e: 'referer', f: 'fail', F: 'form', g: 'globoff', G: 'get', h: 'help', H: 'header', i: 'include',
    I: 'head', j: 'junk-session-cookies', k: 'insecure', K: 'config', l: 'list-only', L: 'location',
    m: 'max-time', M: 'manual', n: 'netrc', N: 'no-buffer', o: 'output', O: 'remote-name',
    p: 'proxytunnel', q: 'quote', r: 'range', R: 'remote-time', s: 'silent', S: 'show-error',
    t: 'ftp-create-dirs', T: 'upload-file', u: 'user', v: 'verbose', V: 'version', w: 'write-out',
    x: 'proxy', y: 'speed-limit', Y: 'speed-time', z: 'time-cond', Z: 'parallel', '#': 'progress-bar',
    '0': 'http0.9',
    /* 补齐实际抓包里高频出现、但一直报 unknown_flag 的短参数：
       -G --get（把 --data 转成查询串，很多搜索接口用）、
       -E --cert（双向认证）、-U --proxy-user、-J --remote-header-name、
       -C --continue-at、-B --use-ascii、-Q --quote。 */
    B: 'use-ascii', C: 'continue-at', E: 'cert', J: 'remote-header-name', Q: 'quote', U: 'proxy-user',
  };

  const LONG_FLAGS = {
    request: 'request', url: 'url', header: 'header', data: 'data', 'data-ascii': 'data',
    'data-raw': 'data-raw', 'data-binary': 'data-binary', 'data-urlencode': 'data-urlencode',
    form: 'form', 'form-string': 'form-string', cookie: 'cookie', 'cookie-jar': 'cookie-jar',
    user: 'user', 'user-agent': 'user-agent', referer: 'referer', ref: 'referer', output: 'output',
    proxy: 'proxy', 'proxy1.0': 'proxy', 'proxy-user': 'proxy-user', socks5: 'socks5-hostname',
    'socks5-hostname': 'socks5-hostname', socks4: 'socks5-hostname', 'socks4a': 'socks5-hostname',
    'max-time': 'max-time', 'connect-timeout': 'connect-timeout', 'max-redirs': 'max-redirs',
    insecure: 'insecure', location: 'location', 'location-trusted': 'location', compressed: 'compressed',
    silent: 'silent', 'show-error': 'show-error', verbose: 'verbose', head: 'head', version: 'version',
    'http1.0': 'httpVersion', 'http1.1': 'httpVersion', 'http2': 'httpVersion',
    'http2-prior-knowledge': 'httpVersion', 'http3': 'httpVersion', 'http3-only': 'httpVersion',
    'no-keepalive': 'no-keepalive', keepalive: 'keepalive', 'no-buffer': 'no-buffer', noproxy: 'noproxy',
    resolve: 'resolve', 'connect-to': 'connect-to', 'limit-rate': 'limit-rate', retry: 'retry',
    'retry-delay': 'retry-delay', 'retry-connrefused': 'retry-connrefused', cacert: 'cacert',
    capath: 'capath', cert: 'cert', key: 'key', pass: 'pass', 'anyauth': 'anyauth', basic: 'basic',
    digest: 'digest', ntlm: 'ntlm', negotiate: 'negotiate', 'oauth2-bearer': 'oauth2-bearer',
    get: 'get', include: 'include', fail: 'fail', globoff: 'globoff', netrc: 'netrc',
    'output-dir': 'output-dir', 'write-out': 'write-out', range: 'range', interface: 'interface',
    'local-port': 'local-port', 'abstract-unix-socket': 'abstract-unix-socket', config: 'config',
    stderr: 'stderr', 'dump-header': 'dump-header', 'ignore-content-length': 'ignore-content-length',
    'upload-file': 'upload-file', 'junk-session-cookies': 'junk-session-cookies',
    'remote-name': 'remote-name', 'remote-time': 'remote-time', proxytunnel: 'proxytunnel',
    'create-dirs': 'create-dirs', 'fail-early': 'fail-early', 'tcp-nodelay': 'tcp-nodelay',
    'dns-servers': 'dns-servers', parallel: 'parallel', manual: 'manual', help: 'help',
  };

  const LONG_HTTP = {
    'http1.0': 'HTTP/1.0', 'http1.1': 'HTTP/1.1', 'http2': 'HTTP/2',
    'http2-prior-knowledge': 'HTTP/2', 'http3': 'HTTP/3', 'http3-only': 'HTTP/3',
  };

  const SPECIAL_HEADERS = /^(cookie|set-cookie)$/i;

  const HOP_BY_HOP = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
    'transfer-encoding', 'upgrade', 'proxy-connection', 'content-length', 'host',
  ];

  /* ============================================================
   * parseCurl
   * ============================================================ */

  function parseCurl(raw, opts) {
    opts = opts || {};
    if (!isStr(raw)) return { ok: false, error: err('输入必须是字符串') };
    const warnings = [];
    const text = raw.replace(/\r\n/g, '\n');
    if (text.indexOf('\r') >= 0) warn(warnings, 'crlf', '输入含单独 CR，已按 LF 处理');
    const mode = opts.terminal && opts.terminal !== 'auto' ? (opts.terminal === 'bash' || opts.terminal === 'zsh' ? 'posix' : opts.terminal === 'cmd' ? 'cmd' : 'ps') : detectShell(text);
    const tk = tokenizeShell(text, mode);
    if (tk.error) return { ok: false, error: tk.error };
    const commands = splitCommands(tk.items);
    if (!commands.length) return { ok: false, error: err('没有可解析的命令') };
    const hit = findCurlCommand(commands);
    if (!hit) return { ok: false, error: err('未找到 curl 命令') };

    const extraCommands = commands.slice(hit.index + 1).filter(function (c) {
      return c.words.some(function (w) { return CURL_WORD.test(w.v); });
    }).length;
    if (extraCommands) warn(warnings, 'extra_commands', '命令串中含 ' + extraCommands + ' 条其它 curl 命令，只解析第一条');

    const words = commands[hit.index].words;
    const st = {
      warnings: warnings,
      headers: [],
      cookies: [],
      dataParts: [],
      formParts: [],
      customRequests: [],
      rawFlags: [],
      resolve: [],
      connectTo: [],
      verbose: 0,
      url: null,
      positionals: [],
    };

    let i = hit.cmdToken + 1;
    let endOfFlags = false;
    for (; i < words.length; i++) {
      const tok = words[i].v;
      if (!endOfFlags && tok === '--') { endOfFlags = true; continue; }
      if (!endOfFlags && tok.length > 2 && tok[0] === '-' && tok[1] === '-') {
        const body = tok.slice(2);
        const eq = body.indexOf('=');
        const name = eq < 0 ? body : body.slice(0, eq);
        const attached = eq < 0 ? null : body.slice(eq + 1);
        const canon = LONG_FLAGS[name];
        if (!canon) {
          st.rawFlags.push({ flag: '--' + name, value: attached });
          warn(warnings, 'unknown_flag', '未知参数 --' + name + '，已原样保留');
          continue;
        }
        if (name.indexOf('http') === 0 && LONG_HTTP[name]) st.httpVersion = LONG_HTTP[name];
        if (ARITY[canon] === 1) {
          let value = attached;
          if (value === null) {
            const nx = words[i + 1];
            if (!nx) { warn(warnings, 'missing_value', '--' + name + ' 缺少参数值'); value = ''; }
            else { value = nx.v; i++; }
          }
          applyFlag(st, canon, '--' + name, value);
        } else {
          if (attached !== null) warn(warnings, 'flag_value_ignored', '--' + name + ' 不接受值，=' + attached + ' 已忽略');
          applyFlag(st, canon, '--' + name, attached === null ? '' : attached);
        }
        continue;
      }
      if (!endOfFlags && tok[0] === '-' && tok.length > 1 && tok !== '-' && !/^-\d/.test(tok)) {
        const chars = tok.slice(1);
        let consumedNext = false;
        for (let j = 0; j < chars.length; j++) {
          const ch = chars[j];
          const canon = SHORT_FLAGS[ch];
          if (!canon) {
            st.rawFlags.push({ flag: '-' + ch, value: chars.slice(j + 1) || null });
            warn(warnings, 'unknown_flag', '未知参数 -' + ch + '，已原样保留');
            break;
          }
          if (ARITY[canon] === 1) {
            let value = chars.slice(j + 1);
            if (!value) {
              const nx = words[i + 1];
              if (!nx) { warn(warnings, 'missing_value', '-' + ch + ' 缺少参数值'); value = ''; }
              else { value = nx.v; consumedNext = true; }
            }
            applyFlag(st, canon, '-' + ch, value);
            if (consumedNext) i++;
            break;
          }
          applyFlag(st, canon, '-' + ch, '');
        }
        continue;
      }
      if (tok === '-' && !st.url) { st.positionals.push(tok); continue; }
      if (/^[<>&]/.test(tok) || /^\d*>&/.test(tok)) {
        warn(warnings, 'shell_syntax', '已忽略 shell 重定向片段: ' + tok);
        continue;
      }
      st.positionals.push(tok);
    }

    /* cookies merge：-b/--cookie 与 -H 'cookie: …'（浏览器复制的常见形态）都折算进来 */
    const cookieMap = Object.create(null);
    const cookieOrder = [];
    const pushCookie = function (name, value) {
      if (!(name in cookieMap)) cookieOrder.push(name);
      cookieMap[name] = value;
    };
    st.cookies.forEach(function (c) { pushCookie(c.name, c.value); });
    st.headers.forEach(function (h) {
      if (/^cookie$/i.test(String(h.name))) cookiePairs(h.value).forEach(function (p) { if (p.name) pushCookie(p.name, p.value); });
    });
    const cookies = cookieOrder.map(function (n) { return { name: n, value: cookieMap[n] }; });
    const cookieString = cookies.map(function (c) { return c.name + '=' + c.value; }).join('; ');

    /* body */
    const body = buildBody(st, cookieString, warnings);

    /* url + -G */
    let url = st.url;
    if (!url) {
      const first = st.positionals.length ? st.positionals[0] : null;
      if (first) url = first;
      if (st.positionals.length > 1) warn(warnings, 'extra_positional', '忽略多余的 URL: ' + st.positionals.slice(1).join(', '));
    }
    if (!url) { url = ''; warn(warnings, 'no_url', '命令中未识别到 URL'); }
    let originalUrl = url;
    if (st.forceGet && body.raw && url) {
      url = url + (url.indexOf('?') >= 0 ? '&' : '?') + body.raw;
      warn(warnings, 'get_query', '--get/-G：表单体已并入查询串');
    }

    let parsedUrl = parseUrlParts(url);
    if (!parsedUrl && url) {
      parsedUrl = parseUrlParts(addScheme(url));
      if (parsedUrl) warn(warnings, 'missing_scheme', 'URL 缺少协议，按 http:// 解析');
      else warn(warnings, 'invalid_url', 'URL 无法解析: ' + url.slice(0, 80));
    }
    if (!parsedUrl) parsedUrl = { protocol: null, host: null, hostname: null, port: null, path: null, search: null, hash: null, origin: null };

    /* method */
    let method;
    if (st.methodOverride) method = st.methodOverride;
    else if (st.forceGet) method = 'GET';
    else if (body.present) method = 'POST';
    else if (st.head) method = 'HEAD';
    else method = 'GET';

    /* auth */
    let auth = null;
    if (st.userinfo) {
      const idx = st.userinfo.indexOf(':');
      auth = {
        type: st.authScheme || 'basic',
        user: idx < 0 ? st.userinfo : st.userinfo.slice(0, idx),
        pass: idx < 0 ? '' : st.userinfo.slice(idx + 1),
      };
    } else if (st.bearer) auth = { type: 'bearer', token: st.bearer, user: null, pass: null };
    else if (st.authScheme) auth = { type: st.authScheme, user: null, pass: null };

    const headers = st.headers.map(function (h) {
      return {
        name: h.name,
        value: h.value,
        fromFlag: h.fromFlag,
        isCookieHeader: SPECIAL_HEADERS.test(h.name),
        isSpecial: SPECIAL_HEADERS.test(h.name) || HOP_BY_HOP.indexOf(h.name.toLowerCase()) >= 0,
      };
    });

    const options = {
      compressed: !!st.compressed,
      insecure: !!st.insecure,
      followRedirects: !!st.location,
      maxRedends: st.maxRedirs == null ? null : st.maxRedirs,
      maxRedirects: st.maxRedirs == null ? null : st.maxRedirs,
      timeout: st.maxTime == null ? null : st.maxTime,
      connectTimeout: st.connectTimeout == null ? null : st.connectTimeout,
      retry: st.retry == null ? null : st.retry,
      limitRate: st.limitRate || null,
      proxy: st.proxy || null,
      noProxy: st.noproxy || null,
      socks: st.socks || null,
      userAgent: st.userAgent || null,
      referer: st.referer || null,
      output: st.output || null,
      verbose: st.verbose,
      head: !!st.head,
      get: !!st.forceGet,
      resolve: st.resolve,
      connectTo: st.connectTo,
      cookieJar: st.cookieJar || null,
      cookieFile: st.cookieFile || null,
      httpVersion: st.httpVersion || null,
      noKeepAlive: !!st.noKeepAlive,
      keepAlive: !!st.keepAlive,
      noBuffer: !!st.noBuffer,
      include: !!st.include,
      netrc: !!st.netrc,
      auth: st.authScheme || null,
      certs: st.certs,
      customRequests: st.customRequests,
      raw: st.rawFlags,
    };

    return {
      ok: true,
      shell: mode,
      method: method,
      url: url,
      originalUrl: originalUrl,
      parsed: parsedUrl,
      headers: headers,
      cookies: cookies,
      cookieString: cookieString,
      auth: auth,
      body: body,
      options: options,
      warnings: warnings,
      stats: { argCount: words.length, bytes: utf8Len(raw) },
    };
  }

  function addScheme(u) {
    return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'http://' + u.replace(/^\/\//, '');
  }

  function num(v) {
    const n = Number(String(v).trim());
    return isNaN(n) ? null : n;
  }

  function applyFlag(st, canon, display, value) {
    st.rawFlags.push({ flag: display, value: value === '' ? null : value });
    switch (canon) {
      case 'request':
        if (st.methodOverride != null) st.customRequests.push(String(value).toUpperCase());
        else st.methodOverride = String(value).toUpperCase();
        break;
      case 'url':
        if (st.url != null) warn(st.warnings, 'extra_positional', '多个 --url，使用最后一个');
        st.url = String(value);
        break;
      case 'header':
        parseOneHeader(st, String(value));
        break;
      case 'data':
      case 'data-raw':
      case 'data-binary':
        st.dataParts.push({ flag: canon, value: String(value) });
        break;
      case 'data-urlencode':
        st.dataParts.push({ flag: canon, value: String(value) });
        break;
      case 'form':
      case 'form-string':
        st.formParts.push({ type: canon === 'form' ? 'form' : 'form-string', value: String(value) });
        break;
      case 'cookie':
        addCookieFlag(st, String(value));
        break;
      case 'cookie-jar':
        st.cookieJar = String(value);
        break;
      case 'user':
        st.userinfo = String(value);
        break;
      case 'user-agent':
        st.userAgent = String(value);
        break;
      case 'referer':
        st.referer = String(value);
        break;
      case 'output':
        st.output = String(value);
        break;
      case 'proxy':
      case 'proxy-user':
        if (canon === 'proxy') st.proxy = String(value);
        else st.proxyUser = String(value);
        break;
      case 'socks5-hostname':
        st.socks = String(value);
        st.proxy = st.proxy || String(value);
        break;
      case 'noproxy':
        st.noproxy = String(value);
        break;
      case 'max-time':
        st.maxTime = num(value);
        break;
      case 'connect-timeout':
        st.connectTimeout = num(value);
        break;
      case 'max-redirs':
        st.maxRedirs = num(value);
        break;
      case 'retry':
      case 'retry-delay':
        st[canon] = num(value);
        break;
      case 'limit-rate':
        st.limitRate = String(value);
        break;
      case 'insecure':
        st.insecure = true;
        break;
      case 'location':
        st.location = true;
        break;
      case 'compressed':
        st.compressed = true;
        break;
      case 'verbose':
        st.verbose++;
        break;
      case 'head':
        st.head = true;
        break;
      case 'get':
        st.forceGet = true;
        break;
      case 'no-keepalive':
        st.noKeepAlive = true;
        break;
      case 'keepalive':
        st.keepAlive = true;
        break;
      case 'no-buffer':
        st.noBuffer = true;
        break;
      case 'include':
        st.include = true;
        break;
      case 'netrc':
        st.netrc = true;
        break;
      case 'resolve':
        st.resolve.push(String(value));
        break;
      case 'connect-to':
        st.connectTo.push(String(value));
        break;
      case 'oauth2-bearer':
        st.bearer = String(value);
        break;
      case 'anyauth':
      case 'basic':
      case 'digest':
      case 'ntlm':
      case 'negotiate':
        st.authScheme = canon;
        break;
      case 'cacert':
      case 'capath':
      case 'cert':
      case 'key':
      case 'pass':
        st.certs = st.certs || {};
        st.certs[canon] = String(value);
        break;
      case 'upload-file':
        st.uploadFile = String(value);
        break;
      case 'output-dir':
        st.outputDir = String(value);
        break;
      case 'range':
        st.range = String(value);
        break;
      case 'interface':
        st.interface = String(value);
        break;
      case 'dns-servers':
        st.dnsServers = String(value);
        break;
      default:
        break;
    }
  }

  function parseOneHeader(st, text) {
    const value = text;
    if (value[0] === '@' || value[0] === '<') {
      warn(st.warnings, 'header_from_file', '-H 从文件读取头 (' + value.slice(0, 1) + ')，内容未解析');
      st.headers.push({ name: '@file', value: value.slice(1), fromFlag: 'H' });
      return;
    }
    if (/;\s*$/.test(value) && value.indexOf(':') < 0) {
      const name = value.replace(/;\s*$/, '');
      warn(st.warnings, 'header_removed', '头 ' + name + ' 被显式移除 (curl 语义 Name;)');
      st.headers.push({ name: name, value: '', fromFlag: 'H' });
      return;
    }
    const idx = value.indexOf(':');
    if (idx < 0) {
      warn(st.warnings, 'bad_header', '忽略无法解析的头: ' + value.slice(0, 60));
      return;
    }
    const name = value.slice(0, idx).trim();
    const val = value.slice(idx + 1).replace(/^ /, '');
    if (!name) {
      warn(st.warnings, 'bad_header', '忽略空头: ' + value.slice(0, 60));
      return;
    }
    if (/^[a-z]*sec-fetch-site$/i.test(name)) {
      warn(st.warnings, 'sec_fetch_site', 'sec-fetch-site 由浏览器控制，requests 等库通常无法设置');
    }
    st.headers.push({ name: name, value: val, fromFlag: 'H' });
  }

  function addCookieFlag(st, value) {
    if (value.indexOf('=') < 0) {
      /* -b cookies.txt 在真实抓包里很常见（curl 用它读 Netscape cookie 文件）。
         原来只记了个 warning，生成代码里既不读文件、也不提示去了哪，
         用户拿到的是「没有任何 Cookie」的脚本，还以为是转换器把登录态吞了。
         这里明确告诉用户：文件内容不在命令里，需要先把 Cookie 展开。 */
      st.cookieFile = value;
      warn(st.warnings, 'cookie_file', '-b ' + value + ' 是从文件读 Cookie：文件内容不在命令里。打开该文件把 name=value 贴进 -H "cookie: …"，或在生成的代码里用 MozillaCookieJar 加载');
      return;
    }
    cookiePairs(value).forEach(function (p) {
      st.cookies.push({ name: p.name, value: p.value });
    });
  }

  function looksJson(s) {
    const t = String(s).trim();
    if (!t) return false;
    if (t[0] !== '{' && t[0] !== '[') return false;
    try {
      JSON.parse(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  function buildBody(st, cookieString, warnings) {
    const body = { present: false, kind: 'none', raw: '', pretty: null, form: null, json: null, pairs: null };
    const ct = headerValue(st.headers, 'content-type') || '';

    if (st.formParts.length) {
      body.present = true;
      body.kind = 'multipart';
      body.form = st.formParts.map(function (f) { return parseFormPart(f, warnings); });
      const parts = [];
      body.form.forEach(function (f) {
        if (f.file) parts.push(f.name + '@' + f.file);
        else parts.push(f.name + '=' + f.value);
      });
      body.raw = parts.join('&');
      return body;
    }

    if (!st.dataParts.length) {
      if (st.uploadFile) {
        body.present = true;
        body.kind = 'file-ref';
        body.raw = '@' + st.uploadFile;
        warn(warnings, 'upload_file', '--upload-file/PUT 上传文件，未内联内容');
      }
      return body;
    }

    let stdinUsed = false;
    const rendered = st.dataParts.map(function (p) {
      if (p.flag === 'data-urlencode') {
        const eq = p.value.indexOf('=');
        if (eq < 0) return encodePiece(p.value);
        return p.value.slice(0, eq) + '=' + encodePiece(p.value.slice(eq + 1));
      }
      if (p.value === '@-') stdinUsed = true;
      return p.value;
    });
    body.raw = rendered.join('&');
    body.present = true;
    if (stdinUsed) warn(warnings, 'body_stdin', '-d @- 表示从标准输入读取请求体');
    if (/@[A-Za-z0-9_.\-\/\\]/.test(st.dataParts.map(function (p) { return p.flag === 'data' ? p.value : ''; }).join('&')))
      warn(warnings, 'data_from_file', '-d @file 从文件读取，内容未内联');

    if (/^application\/json/i.test(ct) || looksJson(body.raw)) {
      body.kind = looksJson(body.raw) || /^application\/json/i.test(ct) ? 'json' : 'data';
      if (looksJson(body.raw)) {
        try {
          const p = SK.jsonx ? SK.jsonx.parse(body.raw) : { value: JSON.parse(body.raw), engine: 'native' };
          if (p.error) throw p.error;
          body.json = p.value;
          /* B05：用 token 级打印，数字字面量（大整数 / 1.0 / 1e3）一个字符都不改 */
          body.pretty = (SK.jsonx ? SK.jsonx.pretty(body.raw, 2).text : JSON.stringify(body.json, null, 2));
          body.jsonRaw = body.raw;
          body.kind = 'json';
          if (SK.jsonx) {
            const sc = SK.jsonx.scan(body.raw);
            if (sc.unsafeCount) {
              body.unsafeNumbers = sc.unsafe;
              warn(warnings, 'bigint_body', '请求体含 ' + sc.unsafeCount + ' 个超过 2^53 的整数字面量（如 ' + sc.unsafe[0].literal + '），已按原文保留；若在 JS/JSON.parse 中处理会被改写成 ' + sc.unsafe[0].becomes);
            }
          }
        } catch (e) {
          body.kind = /^application\/json/i.test(ct) ? 'json' : 'data';
          warn(warnings, 'json_body_invalid', 'Content-Type 为 JSON 但请求体解析失败: ' + e.message);
          body.json = null;
        }
      } else {
        body.kind = 'json';
        warn(warnings, 'json_body_unparseable', 'Content-Type 为 application/json，但请求体不是完整 JSON');
      }
      return body;
    }

    if (st.dataParts.some(function (p) { return p.flag === 'data-urlencode'; })) {
      body.kind = /^application\/x-www-form-urlencoded/i.test(ct) || st.dataParts.length ? 'urlencoded-form' : 'data-urlencode';
      if (body.kind === 'urlencoded-form') body.pairs = splitForm(body.raw);
      else body.pairs = splitForm(body.raw);
      return body;
    }
    if (/^application\/x-www-form-urlencoded/i.test(ct) || isFormish(body.raw)) {
      body.kind = 'urlencoded-form';
      body.pairs = splitForm(body.raw);
      return body;
    }
    if (st.dataParts.length === 1 && st.dataParts[0].value[0] === '@') {
      body.kind = 'file-ref';
      return body;
    }
    const only = st.dataParts[0] ? st.dataParts[0].flag : 'data';
    body.kind = only === 'data-binary' ? 'data-binary' : only === 'data-urlencode' ? 'data-urlencode' : 'data';
    if (st.dataParts.length > 1) warn(warnings, 'multiple_data', '多个 -d 参数已用 & 连接');
    return body;
  }

  function isFormish(s) {
    const t = String(s);
    if (!t || t.indexOf('=') < 0) return false;
    return t.split('&').every(function (p) {
      return /^[^=&]+?=/.test(p);
    });
  }

  function splitForm(s) {
    const out = [];
    String(s || '').split('&').forEach(function (p) {
      if (!p) return;
      const eq = p.indexOf('=');
      if (eq < 0) out.push({ name: decodePiece(p), value: '' });
      else out.push({ name: decodePiece(p.slice(0, eq)), value: decodePiece(p.slice(eq + 1)) });
    });
    return out;
  }

  function parseFormPart(f, warnings) {
    const value = f.value;
    const eq = value.indexOf('=');
    if (eq < 0) {
      warn(warnings, 'bad_form', '忽略无法解析的 -F 片段: ' + value.slice(0, 40));
      return { name: value, value: '', file: null, type: null };
    }
    const name = value.slice(0, eq);
    let rest = value.slice(eq + 1);
    const part = { name: name, value: null, file: null, type: null, filename: null };
    const attrs = [];
    if (f.type === 'form') {
      const chunks = splitFormAttrs(rest);
      rest = chunks.shift() || '';
      chunks.forEach(function (c) {
        const i2 = c.indexOf('=');
        if (i2 < 0) { if (c) attrs.push([c, '']); return; }
        attrs.push([c.slice(0, i2).trim().toLowerCase(), c.slice(i2 + 1).trim()]);
      });
    }
    if (rest[0] === '@' || rest[0] === '<') {
      const isBuf = rest[0] === '<';
      let ref = rest.slice(1);
      if (isBuf) {
        warn(warnings, 'form_buf', '-F name=<file 从文件读取内容作为值');
        part.value = '@' + ref;
      } else {
        part.file = ref;
        part.value = null;
      }
    } else part.value = rest;
    attrs.forEach(function (a) {
      if (a[0] === 'type') part.type = a[1];
      else if (a[0] === 'filename') part.filename = a[1];
      else if (a[0] === 'encoder') part.encoder = a[1];
      else part['attr_' + a[0]] = a[1];
    });
    if (!part.type && part.file) part.type = mimeFromExt(part.file);
    return part;
  }

  function splitFormAttrs(s) {
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === ';' && /(;(type|filename|encoder|removal|content-disposition)=|;[a-z-]+$|;[a-z-]+=)/i.test(s.slice(i))) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function headerValue(headers, name) {
    const lower = String(name).toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) {
      if (String(headers[i].name).toLowerCase() === lower) return headers[i].value;
    }
    return null;
  }

  /* ============================================================
   * formatCurl
   * ============================================================ */

  function quoteArg(s, terminal) {
    const v = String(s == null ? '' : s);
    if (terminal === 'cmd') {
      let out = '';
      for (let i = 0; i < v.length; i++) {
        const c = v[i];
        if (c === '"') out += '\\"';
        else if (c === '%') out += terminal === 'cmd' ? '%%' : c;
        else if (c === '\n') out += ' ';
        else if (c === '\r') continue;
        else out += c;
      }
      return '"' + out + '"';
    }
    if (terminal === 'powershell') return "'" + v.replace(/'/g, "''") + "'";
    if (terminal === 'zsh' || terminal === 'bash') return "'" + v.replace(/'/g, "'\\''") + "'";
    return JSON.stringify(v);
  }

  function formatCurl(input, opts) {
    opts = opts || {};
    const terminal = opts.terminal || 'bash';
    const cont = terminal === 'cmd' ? ' ^' : terminal === 'powershell' ? ' `' : ' \\';
    const indent = opts.indent == null ? '  ' : opts.indent;
    let parsed = input;
    if (isStr(input) || typeof input === 'number') {
      parsed = parseCurl(String(input), { terminal: terminal === 'auto' ? undefined : terminal });
      if (!parsed || parsed.ok !== true) return String(input == null ? '' : input).trim();
    } else if (input && input.ok !== true && input.method == null && input.entries) {
      return '';
    }
    if (!parsed) return '';
    const isDescriptor = input && input.ok !== true && input.method != null;
    const p = isDescriptor ? normalizeRequest(input) : parsed;
    const body = p.body || { kind: 'none', raw: '' };
    const out = [];
    const urlToken = quoteArg(p.url || (p.parsed && p.parsed.origin) || '', terminal);
    out.push('curl' + (opts.showMaxTime === false ? '' : '') + ' ' + urlToken);
    if (p.method && p.method !== 'GET' || (p.options && p.options.head)) {
      if (p.method && p.method !== 'GET') out.push('-X ' + quoteArg(p.method, terminal));
    }
    if (p.auth && p.auth.user != null && p.auth.type !== 'bearer') {
      out.push('-u ' + quoteArg(p.auth.user + ':' + (p.auth.pass || ''), terminal));
    }

    let headerList = (p.headerList || []).slice();
    const cookieHeaderIdx = [];
    headerList.forEach(function (h, k) {
      if (/^cookie$/i.test(h.name)) cookieHeaderIdx.push(k);
    });
    if (opts.sortHeaders) {
      headerList.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    }
    const keepCookieHeader = !opts.cookieFlag && !!(p.cookieString || cookieHeaderIdx.length);
    cookieHeaderIdx.forEach(function (k) {
      if (keepCookieHeader) headerList[k] = { name: 'Cookie', value: p.cookieString || headerList[k].value };
    });
    const seenCookie = { n: 0 };
    headerList.forEach(function (h) {
      if (/^cookie$/i.test(h.name)) {
        seenCookie.n++;
        if (seenCookie.n > 1) return;
        if (!keepCookieHeader) return;
      }
      out.push('-H ' + quoteArg(h.name + ': ' + h.value, terminal));
    });
    if (!keepCookieHeader && (p.cookieString || (p.cookies && p.cookies.length))) {
      out.push('-b ' + quoteArg(p.cookieString || formatCookie(p.cookies, { style: 'pair' }), terminal));
    }
    if (p.options && p.options.cookieJar) out.push('-c ' + quoteArg(p.options.cookieJar, terminal));

    if (body.kind === 'multipart' && body.form) {
      body.form.forEach(function (f) {
        const suffix = f.type ? ';type=' + f.type : '';
        const fname = f.filename ? ';filename=' + f.filename : '';
        const val = f.file ? '@' + f.file : (f.value == null ? '' : f.value);
        out.push('-F ' + quoteArg(f.name + '=' + val + fname + suffix, terminal));
      });
    } else if (body.raw != null && body.raw !== '') {
      const flag = body.kind === 'json' ? (opts.dataRawForJson === false ? '--data' : '--data-raw')
        : body.kind === 'data-binary' ? '--data-binary'
        : body.kind === 'data-urlencode' || body.kind === 'urlencoded-form' && body.fromUrlencode ? '--data-urlencode'
        : (p.options && p.options.get) ? '-G --data' : body.kind === 'file-ref' ? '--data' : '-d';
      if (body.kind === 'json') out.push(flag + ' ' + quoteArg(body.raw, terminal));
      else if (body.pairs && body.kind === 'urlencoded-form' && opts.splitForm)
        body.pairs.forEach(function (pr) {
          out.push('--data-urlencode ' + quoteArg(pr.name + '=' + pr.value, terminal));
        });
      else out.push(flag + ' ' + quoteArg(body.raw, terminal));
    }

    const o = p.options || {};
    if (o.userAgent && !hasHeader(p, 'user-agent')) out.push('-A ' + quoteArg(o.userAgent, terminal));
    if (o.referer && !hasHeader(p, 'referer')) out.push('-e ' + quoteArg(o.referer, terminal));
    if (o.proxy) out.push('-x ' + quoteArg(o.proxy, terminal));
    if (o.noProxy) out.push('--noproxy ' + quoteArg(o.noProxy, terminal));
    if (o.compressed) out.push('--compressed');
    if (o.insecure) out.push('-k');
    if (o.followRedirects) out.push('-L');
    if (o.maxRedends != null) out.push('--max-redirs ' + quoteArg(String(o.maxRedends), terminal));
    if (o.timeout != null) out.push('-m ' + quoteArg(String(o.timeout), terminal));
    if (o.connectTimeout != null) out.push('--connect-timeout ' + quoteArg(String(o.connectTimeout), terminal));
    if (o.retry != null) out.push('--retry ' + quoteArg(String(o.retry), terminal));
    if (o.limitRate) out.push('--limit-rate ' + quoteArg(String(o.limitRate), terminal));
    if (o.httpVersion) out.push('--' + String(o.httpVersion).toLowerCase().replace('/', ''));
    if (o.noKeepAlive) out.push('--no-keepalive');
    if (o.head) out.push('-I');
    if (o.get) out.push('-G');
    if (o.output) out.push('-o ' + quoteArg(o.output, terminal));
    if (o.verbose) out.push('-' + 'v'.repeat(Math.min(3, o.verbose)));
    if (o.resolve) o.resolve.forEach(function (r) { out.push('--resolve ' + quoteArg(r, terminal)); });
    if (o.connectTo) o.connectTo.forEach(function (r) { out.push('--connect-to ' + quoteArg(r, terminal)); });
    if (o.certs) Object.keys(o.certs).forEach(function (k) { out.push('--' + k + ' ' + quoteArg(o.certs[k], terminal)); });
    (o.raw || []).forEach(function (r) {
      if (!/^-{1,2}$/.test(r.flag) && !/^-[\w#]$/.test(r.flag) && !/^--[\w.:-]+$/.test(r.flag)) return;
      if (KNOWN_FORMAT_FLAGS.test(r.flag)) return;
      out.push(r.flag + (r.value == null ? '' : ' ' + quoteArg(r.value, terminal)));
    });

    if (opts.collapse) return out.join(' ');
    const joiner = cont + '\n';
    return out.join(joiner) + (opts.trailingSemicolon ? ';' : '');
  }

  const KNOWN_FORMAT_FLAGS = /^(-(?:X|A|e|b|c|u|o|d|x|k|L|m|I|G|v{1,3}|F|H)|--(?:data(?:-raw|-binary|-urlencode)?|url|compressed|noproxy|max-redirs|connect-timeout|retry|limit-rate|http[0-9.]+|no-keepalive|resolve|connect-to|cacert|capath|cert|key|pass|output-dir|cookie|cookie-jar|request|header|form|form-string|get|head|user|user-agent|referer|location|insecure|max-time|silent|show-error|verbose|netrc|ignore-content-length))$/;

  function hasHeader(p, name) {
    const lower = String(name).toLowerCase();
    return (p.headerList || []).some(function (h) { return String(h.name).toLowerCase() === lower; });
  }

  /* ============================================================
   * request descriptor
   * ============================================================ */

  function normalizeRequest(parsed) {
    if (!parsed) return { method: 'GET', url: '', headers: {}, cookies: {}, bodyType: 'none', body: null, timeout: null, proxies: null, verify: true };
    if (parsed.ok !== true && parsed.method != null && parsed.bodyType != null) return parsed;
    if (parsed.ok !== true && parsed.request) return fromHarEntry(parsed);
    const warnings = parsed.warnings || [];
    const headers = {};
    const headerList = [];
    const headerIndex = Object.create(null);
    /* Cookie 头不进 headerList，但必须折算进 cookies/cookieString，否则生成的代码会静默丢登录态。
       来源可能是 -b/--cookie（parsed.cookies）或 -H 'cookie: …'（浏览器复制最常见的形态） */
    const cookieMap = new Map();
    (parsed.cookies || []).forEach(function (c) {
      cookieMap.set(String(c.name), String(c.value));
    });
    (parsed.headers || []).forEach(function (h) {
      const name = String(h.name);
      if (/^cookie$/i.test(name)) {
        cookiePairs(h.value).forEach(function (p) {
          if (p.name) cookieMap.set(p.name, p.value);
        });
        return;
      }
      const lower = name.toLowerCase();
      if (lower in headerIndex) {
        warn(warnings, 'duplicate_header', '重复头 ' + name + '，保留最后一次取值');
        headerList[headerIndex[lower]].value = h.value;
        headers[headerList[headerIndex[lower]].name] = h.value;
        return;
      }
      headerIndex[lower] = headerList.length;
      headerList.push({ name: name, value: h.value });
      headers[name] = h.value;
    });
    const cookies = {};
    cookieMap.forEach(function (v, k) {
      cookies[k] = v;
    });
    const cookieString = cookieMap.size
      ? Array.from(cookieMap, function (kv) { return kv[0] + '=' + kv[1]; }).join('; ')
      : '';
    const body = parsed.body || { kind: 'none', raw: '', pretty: null, form: null, json: null, pairs: null };
    const o = parsed.options || {};
    let bodyType = body.kind;
    if (bodyType === 'data' || bodyType === 'data-binary' || bodyType === 'data-urlencode') bodyType = 'text';
    if (bodyType === 'urlencoded-form') bodyType = 'form';
    if (!body.present) bodyType = 'none';

    let proxies = null;
    if (o.proxy) {
      const p = /^([a-z0-9+.-]+:\/\/)?/i.exec(o.proxy)[0];
      const scheme = p ? p.replace(/:\/\//, '') : 'http';
      proxies = {};
      proxies[scheme === 'socks5' || scheme === 'socks5h' ? 'socks5' : scheme] = o.proxy;
      if (scheme === 'http') {
        proxies.https = o.proxy;
      }
    }
    const search = (parsed.parsed && parsed.parsed.search) || (parseUrlParts(parsed.url) || {}).search || '';
    const qs = parseQueryString(search);
    const urlBase = search ? String(parsed.url).slice(0, String(parsed.url).length - search.length) : parsed.url;

    return {
      method: parsed.method || 'GET',
      url: parsed.url || '',
      urlBase: urlBase,
      headers: headers,
      headerList: headerList,
      cookies: cookies,
      cookieString: cookieString || parsed.cookieString || '',
      auth: parsed.auth || null,
      bodyType: bodyType,
      body: body.present ? body.raw : null,
      bodyKind: body.kind,
      json: body.json,
      pairs: body.pairs,
      form: body.form,
      pretty: body.pretty,
      params: qs,
      timeout: o.timeout == null ? null : o.timeout,
      connectTimeout: o.connectTimeout == null ? null : o.connectTimeout,
      proxies: proxies,
      proxyRaw: o.proxy || null,
      noProxy: o.noProxy || null,
      verify: o.insecure ? false : true,
      followRedirects: !!o.followRedirects,
      maxRedirects: o.maxRedends == null ? null : o.maxRedends,
      compressed: !!o.compressed,
      httpVersion: o.httpVersion || null,
      userAgent: o.userAgent || headerValue(parsed.headers || [], 'user-agent'),
      referer: o.referer || headerValue(parsed.headers || [], 'referer'),
      head: !!o.head,
      get: !!o.get,
      cookieJar: o.cookieJar || null,
      options: o,
      parsed: parsed.parsed || null,
      warnings: warnings,
      ok: true,
    };
  }

  function toRequest(parsed) {
    return normalizeRequest(parsed);
  }

  function asDescriptor(input, warnings, who) {
    if (!input) return null;
    if (input.request) return normalizeRequest(fromHarEntry(input));
    if (input.ok === true && input.parsed) return normalizeRequest(input);
    if (input.bodyType != null) return input;
    if (input.method != null && input.url != null) return normalizeRequest(Object.assign({ ok: true, headers: [], cookies: [] }, input));
    if (isStr(input)) {
      const p = parseCurl(input);
      if (p.ok) return normalizeRequest(p);
      warn(warnings, 'parse_failed', who + ': curl 解析失败，已生成占位代码');
      return null;
    }
    return null;
  }

  function pick(input, opts, name, dflt) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, name)) return opts[name];
    if (input && Object.prototype.hasOwnProperty.call(input, name)) return input[name];
    return dflt;
  }

  /* ============================================================
   * python literal emitters
   * ============================================================ */

  function hexPad(n, w) {
    let s = n.toString(16);
    if (n < 0x10000 && w === 4) while (s.length < 4) s = '0' + s;
    return s;
  }

  function choosePyQuote(s) {
    const dq = s.indexOf('"') >= 0;
    const sq = s.indexOf("'") >= 0;
    if (sq && !dq) return "'";
    return '"';
  }

  function pyUnits(s, quote) {
    const units = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const ch = s[i];
      if (ch === '\\') units.push('\\\\');
      else if (ch === quote) units.push('\\' + quote);
      else if (ch === '\n') units.push('\\n');
      else if (ch === '\r') units.push('\\r');
      else if (ch === '\t') units.push('\\t');
      else if (c < 0x20 || c === 0x7f) units.push('\\x' + hexPad(c, 2));
      else if (c === 0x2028) units.push('\\u2028');
      else if (c === 0x2029) units.push('\\u2029');
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
        units.push(ch + s[i + 1]);
        i++;
      } else if (c >= 0xd800 && c <= 0xdfff) units.push('\\u' + hexPad(c, 4));
      else units.push(ch);
    }
    return units;
  }

  function packUnits(units, avail) {
    const lines = [];
    let cur = '';
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (cur && cur.length + u.length > avail) {
        lines.push(cur);
        cur = u;
      } else cur += u;
    }
    if (cur) lines.push(cur);
    if (!lines.length) lines.push('');
    return lines;
  }

  function pyStringChunks(s, width, indent) {
    const quote = choosePyQuote(s);
    const units = pyUnits(s, quote);
    const avail = Math.max(16, width - indent.length - 4 - 2);
    return { quote: quote, chunks: packUnits(units, avail) };
  }

  function pyLiteral(s, width, indent) {
    const r = pyStringChunks(s, width, indent || '');
    if (r.chunks.length === 1) return r.quote + r.chunks[0] + r.quote;
    return '(\n' + r.chunks.map(function (c) { return (indent || '') + '    ' + r.quote + c + r.quote; }).join('\n') + '\n' + (indent || '') + ')';
  }

  /* B15：Python bytes 字面量只能含 ASCII，非 ASCII 必须 encode */
  function pyBytesLiteral(s, width, indent) {
    if (/^[\x00-\x7F]*$/.test(s)) return 'b' + pyLiteral(s, width, indent || '');
    return pyLiteral(s, width, indent || '') + '.encode("utf-8")';
  }

  function pyValue(v, width, indent) {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? String(v) : 'None';
    if (t === 'bigint') return String(v); /* B05：大整数原样输出，不经过 JS Number */
    if (t === 'string') return pyLiteral(v, width, indent);
    const inner = (indent || '') + '    ';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[\n' + v.map(function (x) { return inner + pyValue(x, width, inner) + ','; }).join('\n') + '\n' + (indent || '') + ']';
    }
    if (t === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) return '{}';
      return '{\n' + keys.map(function (k) {
        return inner + pyLiteral(k, width, inner) + ': ' + pyValue(v[k], width, inner) + ',';
      }).join('\n') + '\n' + (indent || '') + '}';
    }
    return pyLiteral(String(v), width, indent);
  }

  function pyAssign(name, value, opts, indent) {
    const width = (opts && opts.lineWidth) || 100;
    const ind = indent || '';
    if (typeof value === 'string') {
      const r = pyStringChunks(value, width, ind);
      const one = r.quote + r.chunks.join('') + r.quote;
      if (r.chunks.length === 1 && ind.length + name.length + 3 + one.length <= width) return ind + name + ' = ' + one;
      return ind + name + ' = (\n' + r.chunks.map(function (c) { return ind + '    ' + r.quote + c + r.quote; }).join('\n') + '\n' + ind + ')';
    }
    const expr = pyValue(value, width, ind);
    return ind + name + ' = ' + expr;
  }

  function pyDictFromPairs(pairs, opts, indent) {
    const obj = Object.create(null);
    (pairs || []).forEach(function (p) {
      if (Object.prototype.hasOwnProperty.call(obj, p.name)) {
        const cur = obj[p.name];
        if (Array.isArray(cur)) cur.push(p.value);
        else obj[p.name] = [cur, p.value];
      } else obj[p.name] = p.value;
    });
    return pyValue(obj, (opts && opts.lineWidth) || 100, indent || '');
  }

  /* ============================================================
   * shared pieces for python generators
   * ============================================================ */

  function filterHeaders(req, o, warnings) {
    let list = (req.headerList || []).slice();
    if (o.includeCookies === false) list = list.filter(function (h) { return !/^cookie$/i.test(h.name); });
    if (o.dedupeHeaders === 'auto') {
      const dropped = [];
      list = list.filter(function (h) {
        const l = String(h.name).toLowerCase();
        if (HOP_BY_HOP.indexOf(l) >= 0 || l === 'accept-encoding' || l.indexOf('sec-ch-ua') === 0 || l === 'cookie') {
          dropped.push(h.name);
          return false;
        }
        return true;
      });
      if (dropped.length) warn(warnings, 'headers_dropped', 'dedupeHeaders=auto 已剔除: ' + dropped.join(', '));
    } else if (o.dedupeHeaders === 'hop') {
      list = list.filter(function (h) { return HOP_BY_HOP.indexOf(String(h.name).toLowerCase()) < 0; });
    }
    const seen = Object.create(null);
    const out = [];
    list.forEach(function (h) {
      const l = String(h.name).toLowerCase();
      if (seen[l]) {
        for (let k = 0; k < out.length; k++) if (String(out[k].name).toLowerCase() === l) out[k].value = h.value;
        return;
      }
      seen[l] = 1;
      out.push(h);
    });
    return out;
  }

  function pythonBody(req, o, warnings) {
    const width = o.lineWidth || 100;
    const kind = req.bodyKind;
    const res = { decls: [], kwargs: [], needsFiles: false, byteBody: null };
    if (!req.body && kind !== 'multipart' && req.bodyType === 'none') return res;

    if (kind === 'multipart') {
      const lines = [];
      (req.form || []).forEach(function (f) {
        const fname = f.filename || (f.file ? String(f.file).split(/[\\/]/).pop() : null);
        const type = f.type || (f.file ? mimeFromExt(f.file) : 'text/plain');
        let valExpr;
        if (f.file) {
          valExpr = 'open(' + pyLiteral(f.file, width, '') + ', "rb")';
          warn(warnings, 'multipart_file', 'multipart 字段 ' + f.name + ' 引用本地文件 ' + f.file + '，运行前需保证路径存在');
        } else if (f.value != null && /^@/.test(f.value) && f.value !== '@-') {
          valExpr = 'open(' + pyLiteral(f.value.slice(1), width, '') + ', "rb")';
        } else if (f.value === '@-' || f.value == null) {
          valExpr = 'b""';
          warn(warnings, 'multipart_stdin', 'multipart 字段 ' + f.name + ' 内容未在命令中内联，用占位空字节串');
        } else valExpr = pyBytesLiteral(String(f.value), width, '');
        lines.push('    ' + pyLiteral(f.name, width, '') + ': (' + (fname ? pyLiteral(fname, width, '') : 'None') + ', ' + valExpr + (type ? ', ' + pyLiteral(type, width, '') : '') + '),');
      });
      res.decls.push('files = {\n' + lines.join('\n') + '\n}');
      res.kwargs.push('files=files');
      res.needsFiles = true;
      return res;
    }

    const raw = req.body == null ? '' : String(req.body);
    const ct = String(headerValue(req.headerList || [], 'content-type') || '');
    const style = o.dataStyle || 'auto';

    if (kind === 'json' && req.json !== null && req.json !== undefined && prettyWanted(o) && style !== 'string') {
      res.decls.push(pyAssign('payload', req.json, o, ''));
      res.kwargs.push('json=payload');
      return res;
    }
    if (style === 'json') {
      const obj = {};
      (req.pairs || []).forEach(function (p) { obj[p.name] = p.value; });
      if (Object.keys(obj).length) {
        res.decls.push(pyAssign('payload', obj, o, ''));
        res.kwargs.push('json=payload');
        warn(warnings, 'data_style_json', 'dataStyle=json：表单体改为 JSON 发送，请确认服务端接受');
        return res;
      }
    }
    if (req.json !== null && req.json !== undefined && prettyWanted(o)) {
      res.decls.push(pyAssign('payload', req.json, o, ''));
      res.kwargs.push('json=payload');
      return res;
    }
    if (kind === 'form' || (kind === 'data-urlencode' && req.pairs)) {
      if (style === 'string' || !req.pairs || !req.pairs.length) {
        res.decls.push(pyAssign('payload', raw, o, ''));
      } else res.decls.push(pyAssign('payload', pairsToObject(req.pairs), o, ''));
      res.kwargs.push('data=payload');
      return res;
    }
    if (kind === 'file-ref') {
      const path = raw.replace(/^@/, '') || 'payload.bin';
      res.decls.push('payload = open(' + pyLiteral(path, width, '') + ', "rb").read()');
      res.kwargs.push('data=payload');
      warn(warnings, 'body_from_file', '请求体来自文件 ' + path + '，未在代码中内联');
      return res;
    }
    res.decls.push(pyAssign('payload', raw, o, ''));
    res.kwargs.push('data=payload');
    if (ct && /charset=/i.test(ct)) warn(warnings, 'charset', 'Content-Type 含 charset，requests 不会重编码请求体');
    return res;
  }

  function prettyWanted(o) {
    return o.prettyJson !== false;
  }

  function pairsToObject(pairs) {
    const obj = Object.create(null);
    (pairs || []).forEach(function (p) { obj[p.name] = p.value; });
    return obj;
  }

  function pythonUrlAndParams(req, o, warnings) {
    const decls = [];
    let kwargs = [];
    const useParams = o.paramsExtract && req.params && req.params.length;
    if (useParams) {
      decls.push(pyAssign('url', req.urlBase, o, ''));
      const list = [];
      req.params.forEach(function (p) { list.push('    ' + pyLiteral(p.name, (o.lineWidth || 100), '') + ': ' + pyLiteral(p.value, (o.lineWidth || 100), '') + ','); });
      decls.push('params = {\n' + list.join('\n') + '\n}');
      kwargs.push('params=params');
      if (o.commentQuery) warnings.__queryComment = '原始查询串: ' + (req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?') + 1) : '');
    } else decls.push(pyAssign('url', req.url, o, ''));
    return { decls: decls, kwargs: kwargs };
  }

  function pythonSecurity(req, o, warnings, target) {
    const kwargs = [];
    const decls = [];
    const proxies = o.proxies != null ? o.proxies : req.proxies;
    if (proxies) {
      let obj;
      if (typeof proxies === 'string') obj = { http: proxies, https: proxies };
      else obj = Object.assign({}, proxies);
      if (req.noProxy) obj.no_proxy = req.noProxy;
      decls.push(pyAssign('proxies', obj, o, ''));
      kwargs.push('proxies=proxies');
      if (target !== 'requests' && o.warnProxies !== false) warn(warnings, 'proxy_' + target, '该生成器仅示意代理配置，实际请按框架文档设置');
    } else if (req.proxyRaw) {
      decls.push('# 代理: ' + req.proxyRaw + '（curl -x）');
    }
    const verify = o.verify !== undefined ? o.verify : req.verify;
    if (verify === false || (target === 'requests' && o.verify === true)) kwargs.push('verify=' + (verify ? 'True' : 'False'));
    if (target === 'requests' && req.followRedirects) kwargs.push('allow_redirects=True');
    if (o.timeout !== undefined && o.timeout !== null) kwargs.push('timeout=' + Number(o.timeout));
    else if (req.timeout != null && target !== 'scrapy') kwargs.push('timeout=' + Number(req.timeout));
    return { decls: decls, kwargs: kwargs };
  }

  /* ============================================================
   * toRequests
   * ============================================================ */

  function toRequests(input, opts) {
    const o = opts || {};
    const warnings = [];
    const req = asDescriptor(input, warnings, 'toRequests');
    const lines = [];
    if (!req) return { code: '# curl 解析失败，无法生成 requests 代码\n', language: 'python', warnings: warnings };
    const name = o.name || 'response';
    const session = !!o.session;
    const importBlock = o.importBlock !== false;

    if (o.comment) String(o.comment).split('\n').forEach(function (l) { lines.push('# ' + l); });
    if (o.commentQuery && req.params && req.params.length) lines.push('# 原始查询串: ' + req.url.slice(req.url.indexOf('?') + 1));

    const head = [];
    if (importBlock) head.push('import requests');
    if (o.userAgentRotate) head.push('import random');
    if (head.length) {
      lines.push(head.join('\n'));
      lines.push('');
    }

    const urlPart = pythonUrlAndParams(req, o, warnings);
    lines.push(urlPart.decls.join('\n'));

    let headerList = filterHeaders(req, o, warnings);
    if (o.includeCookies !== false && !o.separateCookies && req.cookieString)
      headerList = headerList.concat([{ name: 'Cookie', value: req.cookieString }]);
    if (o.includeHeaders !== false && headerList.length) {
      const rows = headerList.map(function (h) {
        return '    ' + pyLiteral(h.name, (o.lineWidth || 100), '') + ': ' + pyLiteral(h.value, (o.lineWidth || 100), '    ') + ',';
      });
      lines.push('');
      lines.push('headers = {\n' + rows.join('\n') + '\n}');
    }
    if (o.userAgentRotate) {
      const pool = Array.isArray(o.userAgentRotate) ? o.userAgentRotate : [req.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'];
      const rows = pool.map(function (u) { return '    ' + pyLiteral(u, (o.lineWidth || 100), '    ') + ','; });
      lines.push('');
      lines.push('USER_AGENTS = [\n' + rows.join('\n') + '\n]');
      lines.push('');
      lines.push('headers["User-Agent"] = random.choice(USER_AGENTS)');
      warn(warnings, 'ua_rotate', '已生成随机 UA，注意 UA 与 sec-ch-ua / UA-CH 头必须成套替换');
    }
    const hasCookieVar = o.includeCookies !== false && o.separateCookies && Object.keys(req.cookies || {}).length > 0;
    if (hasCookieVar) {
      lines.push('');
      lines.push('cookies = ' + pyDictFromPairs(Object.keys(req.cookies).map(function (k) { return { name: k, value: req.cookies[k] }; }), o, ''));
    }

    const body = pythonBody(req, o, warnings);
    if (body.decls.length) {
      lines.push('');
      lines.push(body.decls.join('\n'));
    }

    let callArgs = [pyLiteral(req.method, (o.lineWidth || 100), ''), 'url'];
    if (o.includeHeaders !== false && headerList.length) callArgs.push('headers=headers');
    if (hasCookieVar && !session) callArgs.push('cookies=cookies');
    callArgs = callArgs.concat(urlPart.kwargs).concat(body.kwargs);
    const sec = pythonSecurity(req, o, warnings, 'requests');
    if (sec.decls.length) {
      lines.push('');
      lines.push(sec.decls.join('\n'));
    }
    callArgs = callArgs.concat(sec.kwargs);
    if (req.auth && req.auth.type !== 'bearer' && req.auth.user) {
      if (o.authTuple) callArgs.push('auth=(' + pyLiteral(req.auth.user, 100, '') + ', ' + pyLiteral(req.auth.pass || '', 100, '') + ')');
      else lines.push('# HTTP 认证: ' + req.auth.user + ':' + (req.auth.pass || '') + '（可用 requests.auth.HTTPBasicAuth）');
    }

    lines.push('');
    if (session) {
      lines.push('session = requests.Session()');
      if (o.includeHeaders !== false && headerList.length) lines.push('session.headers.update(headers)');
      if (hasCookieVar) lines.push('session.cookies.update(cookies)');
      lines.push('');
    }
    const callStr = (session ? name + ' = session.' : name + ' = requests.') + 'request(\n' + callArgs.map(function (a) { return '    ' + a + ','; }).join('\n') + '\n)';
    lines.push(callStr);
    lines.push('');
    if (o.printBody === false) lines.push('print(' + name + '.status_code)');
    else {
      lines.push('print(' + name + '.status_code)');
      lines.push('print(' + name + '.text)');
    }
    if (req.compressed) warn(warnings, 'compressed', 'curl 用了 --compressed，requests 会自动加 Accept-Encoding: gzip, deflate 并解压');
    if (session && hasCookieVar) warn(warnings, 'session_cookie', 'session 模式下 cookies 已注入 Session，未重复传 cookies= 参数');

    return { code: lines.join('\n') + '\n', language: 'python', warnings: warnings };
  }

  /* ============================================================
   * httpx / aiohttp 生成器（复用 requests 的 url/headers/body 构造）
   * ============================================================ */

  function buildPyParts(input, opts, tag) {
    const o = opts || {};
    const warnings = [];
    const req = asDescriptor(input, warnings, tag);
    if (!req) return { req: null, warnings: warnings };
    const urlPart = pythonUrlAndParams(req, o, warnings);
    let hl = filterHeaders(req, o, warnings);
    if (o.includeCookies !== false && !o.separateCookies && req.cookieString)
      hl = hl.concat([{ name: 'Cookie', value: req.cookieString }]);
    const hasCookieVar = o.includeCookies !== false && o.separateCookies && Object.keys(req.cookies || {}).length > 0;
    const body = pythonBody(req, o, warnings);
    return { req: req, o: o, warnings: warnings, urlPart: urlPart, headers: hl, hasCookieVar: hasCookieVar, body: body };
  }

  function toHttpx(input, opts) {
    const p = buildPyParts(input, opts, 'toHttpx');
    if (!p.req) return { code: '# 解析失败：不是 cURL / HAR\n', language: 'python', warnings: p.warnings };
    const req = p.req, o = p.o, lines = [];
    lines.push('import httpx');
    lines.push('');
    lines.push(p.urlPart.decls.join('\n'));
    if (p.headers.length && o.includeHeaders !== false) {
      lines.push('');
      lines.push('headers = {\n' + p.headers.map(function (h) {
        return '    ' + pyLiteral(h.name, 100, '') + ': ' + pyLiteral(h.value, 100, '    ') + ',';
      }).join('\n') + '\n}');
    }
    if (p.hasCookieVar) {
      lines.push('');
      lines.push('cookies = ' + pyDictFromPairs(Object.keys(req.cookies).map(function (k) { return { name: k, value: req.cookies[k] }; }), o, ''));
    }
    if (p.body.decls.length) { lines.push(''); lines.push(p.body.decls.join('\n')); }
    const args = [pyLiteral(req.method, 100, ''), 'url'];
    if (p.headers.length && o.includeHeaders !== false) args.push('headers=headers');
    if (p.hasCookieVar) args.push('cookies=cookies');
    const all = args.concat(p.urlPart.kwargs).concat(p.body.kwargs);
    lines.push('');
    lines.push('# httpx 支持 HTTP/2；如需关闭改成 http2=False');
    lines.push('with httpx.Client(http2=True, timeout=10.0) as client:');
    lines.push('    response = client.request(');
    all.forEach(function (a) { lines.push('        ' + a + ','); });
    lines.push('    )');
    lines.push('    response.raise_for_status()');
    lines.push('    print(response.status_code)');
    lines.push('    print(response.text)');
    if (req.verify === false) warn(p.warnings, 'httpx_verify', 'httpx 用 verify=False 关闭校验（Client 参数），不要写在 request() 里');
    if (req.proxy) warn(p.warnings, 'httpx_proxy', 'httpx 代理写法为 Client(proxy="http://…")');
    return { code: lines.join('\n') + '\n', language: 'python', warnings: p.warnings };
  }

  function toAiohttp(input, opts) {
    const p = buildPyParts(input, opts, 'toAiohttp');
    if (!p.req) return { code: '# 解析失败：不是 cURL / HAR\n', language: 'python', warnings: p.warnings };
    const req = p.req, o = p.o, lines = [];
    lines.push('import asyncio');
    lines.push('import aiohttp');
    lines.push('');
    lines.push(p.urlPart.decls.join('\n'));
    if (p.headers.length && o.includeHeaders !== false) {
      lines.push('');
      lines.push('headers = {\n' + p.headers.map(function (h) {
        return '    ' + pyLiteral(h.name, 100, '') + ': ' + pyLiteral(h.value, 100, '    ') + ',';
      }).join('\n') + '\n}');
    }
    if (p.hasCookieVar) {
      lines.push('');
      lines.push('cookies = ' + pyDictFromPairs(Object.keys(req.cookies).map(function (k) { return { name: k, value: req.cookies[k] }; }), o, ''));
    }
    if (p.body.decls.length) { lines.push(''); lines.push(p.body.decls.join('\n')); }
    const args = ['url'];
    if (p.hasCookieVar) args.push('cookies=cookies');
    const all = args.concat(p.urlPart.kwargs).concat(p.body.kwargs);
    lines.push('');
    lines.push('async def main():');
    lines.push('    timeout = aiohttp.ClientTimeout(total=10)');
    lines.push('    async with aiohttp.ClientSession(timeout=timeout) as session:');
    lines.push('        async with session.request(');
    lines.push('            ' + pyLiteral(req.method, 100, '') + ',');
    all.forEach(function (a) { lines.push('            ' + a + ','); });
    if (p.headers.length && o.includeHeaders !== false) lines.push('            headers=headers,');
    lines.push('        ) as response:');
    lines.push('            response.raise_for_status()');
    lines.push('            print(response.status)');
    lines.push('            print(await response.text())');
    lines.push('');
    lines.push('');
    lines.push('asyncio.run(main())');
    if (req.verify === false) warn(p.warnings, 'aiohttp_ssl', 'aiohttp 关闭校验需传 connector=aiohttp.TCPConnector(ssl=False)');
    return { code: lines.join('\n') + '\n', language: 'python', warnings: p.warnings };
  }

  /* ============================================================
   * feapder / scrapy generators
   * ============================================================ */

  function pascal(s) {
    return String(s || '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
      .join('');
  }

  function spiderNameFrom(req, o) {
    if (o.spiderName) return /^[A-Z]/.test(o.spiderName) ? o.spiderName : pascal(o.spiderName);
    const host = (req.parsed && req.parsed.hostname) || '';
    const labels = host.split('.').filter(Boolean);
    let base = null;
    const generic = { www: 1, api: 1, m: 1, http: 1, https: 1, app: 1, open: 1, data: 1 };
    for (let i = labels.length - 1; i >= 0; i--) {
      if (!generic[labels[i]] && !/^\d+$/.test(labels[i])) { base = labels[i]; break; }
    }
    if (!base) base = labels[0] || 'demo';
    return pascal(o.project ? o.project + ' ' + base : base) + 'Spider';
  }

  function pyModuleDecls(req, o, warnings) {
    const out = [];
    const urlPart = pythonUrlAndParams(req, o, warnings);
    out.push(urlPart.decls.join('\n'));
    const headerList = filterHeaders(req, o, warnings);
    const withCookie = o.includeCookies !== false && !o.separateCookies && req.cookieString;
    const hl = withCookie ? headerList.concat([{ name: 'Cookie', value: req.cookieString }]) : headerList;
    if (hl.length) {
      const rows = hl.map(function (h) {
        return '    ' + pyLiteral(h.name, (o.lineWidth || 100), '') + ': ' + pyLiteral(h.value, (o.lineWidth || 100), '    ') + ',';
      });
      out.push('headers = {\n' + rows.join('\n') + '\n}');
    }
    const body = pythonBody(req, o, warnings);
    if (body.decls.length) out.push(body.decls.join('\n'));
    return { lines: out.filter(Boolean), kwargs: urlPart.kwargs.concat(body.kwargs), headerCount: hl.length, bodyKind: body.kwargs.join(','), needsFiles: body.needsFiles };
  }

  function toFeapder(input, opts) {
    const o = opts || {};
    const warnings = [];
    const req = asDescriptor(input, warnings, 'toFeapder');
    if (!req) return { code: '# curl 解析失败\n', language: 'python', warnings: warnings };
    const cls = spiderNameFrom(req, o);
    const lines = [];
    if (o.project) lines.push('# project: ' + o.project);
    lines.push('import feapder');
    lines.push('');
    const mod = pyModuleDecls(req, o, warnings);
    if (mod.lines.length) {
      lines.push(mod.lines.join('\n\n'));
      lines.push('');
    }
    if (req.timeout != null && o.timeout === undefined) warn(warnings, 'feapder_timeout', 'curl 的超时请在 SPIDER_REQUEST_RETRY_* / setting 中配置');
    lines.push('');
    lines.push('class ' + cls + '(feapder.AirSpider):');
    const custom = [];
    if (o.concurrentNum != null) custom.push('    "SPIDER_THREAD_COUNT": ' + Number(o.concurrentNum) + ',');
    if (o.retryTimes != null) custom.push('    "SPIDER_MAX_RETRY_TIMES": ' + Number(o.retryTimes) + ',');
    if (o.sleepTime != null) custom.push('    "SPIDER_SLEEP_TIME": [' + Number(o.sleepTime) + ', ' + Number(o.sleepTime) + '],');
    if (custom.length) {
      lines.push('    __custom_setting__ = {');
      lines.push(custom.join('\n'));
      lines.push('    }');
      lines.push('');
    }
    lines.push('    def start_requests(self):');
    let callArgs = ['url'];
    if (req.method && req.method !== 'GET') callArgs.push('method=' + pyLiteral(req.method, 100, ''));
    if (mod.headerCount) callArgs.push('headers=headers');
    callArgs = callArgs.concat(mod.kwargs);
    if (o.includeCookies !== false && o.separateCookies && Object.keys(req.cookies).length) callArgs.push('cookies=' + pyDictFromPairs(Object.keys(req.cookies).map(function (k) { return { name: k, value: req.cookies[k] }; }), o, ''));
    if (req.followRedirects) callArgs.push('allow_redirects=True');
    callArgs.push('callback=self.parse');
    lines.push('        yield feapder.Request(');
    callArgs.forEach(function (a) { lines.push('            ' + a + ','); });
    lines.push('        )');
    lines.push('');
    lines.push('    def parse(self, request, response):');
    lines.push('        # response 为 feapder.Response：.text / .json / .status_code / .response(requests 原始响应)');
    lines.push('        if response.status_code != 200:');
    lines.push('            self.log.warning("异常状态码: %s", response.status_code)');
    lines.push('            return');
    const hint = bodyHint(req);
    if (hint === 'json') {
      lines.push('        data = response.json');
      lines.push('        # TODO 按真实结构取值，例如 data["data"]["list"]');
      lines.push('        for item in data.get("data", []) if isinstance(data, dict) else []:');
      lines.push('            yield item');
    } else if (hint === 'html') {
      lines.push('        # TODO 用 xpath / css 抽取');
      lines.push('        title = response.xpath("//title/text()").extract_first()');
      lines.push('        yield {"title": title}');
    } else {
      lines.push('        text = response.text');
      lines.push('        # TODO 解析 text');
      lines.push('        yield {"raw": text[:200]}');
    }
    lines.push('');
    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    ' + cls + '().start()');
    if (o.useSetting) {
      lines.push('');
      lines.push('# 建议放在同目录 setting.py 中统一管理（feapder 会自动读取）：');
      lines.push('# SPIDER_THREAD_COUNT = 5');
      lines.push('# SPIDER_SLEEP_TIME = [1, 3]');
      lines.push('# SPIDER_MAX_RETRY_TIMES = 3');
      lines.push('# REDISDB_IP_PORTS = "127.0.0.1:6379"');
      lines.push('# ITEM_PIPELINES = ["feapder.pipeline.collector_pipeline"]');
      lines.push('# USER_AGENT = "..."  # 随机 UA 池见 feapder.user_agent');
    }
    return { code: lines.join('\n') + '\n', language: 'python', warnings: warnings };
  }

  function toFeapderTask(input, opts) {
    const o = opts || {};
    const warnings = [];
    const req = asDescriptor(input, warnings, 'toFeapderTask');
    if (!req) return { code: '# curl 解析失败\n', language: 'python', warnings: warnings };
    const cls = spiderNameFrom(req, o).replace(/Spider$/, 'TaskSpider');
    const project = o.project || 'spider_lab';
    const host = (req.parsed && req.parsed.hostname) || 'demo';
    const table = o.taskTable || (host.split('.').slice(-2)[0] + '_task');
    const redisKey = o.redisKey || project + ':' + table + ':task';
    const lines = [];
    if (o.project) lines.push('# project: ' + o.project);
    lines.push('import feapder');
    lines.push('');
    const mod = pyModuleDecls(req, o, warnings);
    if (mod.lines.length) {
      lines.push(mod.lines.join('\n\n'));
      lines.push('');
    }
    lines.push('class ' + cls + '(feapder.TaskSpider):');
    lines.push('    __custom_setting__ = {');
    lines.push('        "SPIDER_THREAD_COUNT": ' + (o.concurrentNum != null ? Number(o.concurrentNum) : 5) + ',');
    lines.push('        "SPIDER_MAX_RETRY_TIMES": 3,');
    lines.push('        "TASK_KEEP_TASK_SPACE": 3,');
    lines.push('    }');
    lines.push('');
    lines.push('    def start_requests(self, task):');
    lines.push('        # task 是任务表返回的一行 dict，可用其字段覆盖 url / 参数');
    lines.push('        url = task.get("url") or globals()["url"]');
    let callArgs = ['url'];
    if (req.method && req.method !== 'GET') callArgs.push('method=' + pyLiteral(req.method, 100, ''));
    if (mod.headerCount) callArgs.push('headers=headers');
    callArgs = callArgs.concat(mod.kwargs).concat(['callback=self.parse', 'priority=task.get("priority", 0)']);
    lines.push('        yield feapder.Request(');
    callArgs.forEach(function (a) { lines.push('            ' + a + ','); });
    lines.push('        )');
    lines.push('');
    lines.push('    def parse(self, request, response):');
    lines.push('        if response.status_code != 200:');
    lines.push('            return');
    lines.push('        data = response.json if "json" in response.content_type else {"raw": response.text}');
    lines.push('        # TODO 抽取字段后用 add_task 追加下一批任务');
    lines.push('        yield data');
    lines.push('');
    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    spider = ' + cls + '(');
    lines.push('        redis_key=' + pyLiteral(redisKey, 100, '        ') + ',');
    lines.push('        task_table=' + pyLiteral(table, 100, '        ') + ',');
    lines.push('        task_table_fields="id, url, priority, state",');
    lines.push('        task_condition="state = 0",');
    lines.push('        min_task_count=10,');
    lines.push('    )');
    lines.push('    # 初始化任务：spider.add_task({"url": "...", "priority": 0})');
    lines.push('    spider.start()');
    warn(warnings, 'task_queue', 'TaskSpider 依赖 MySQL 任务表 ' + table + ' 与 Redis ' + redisKey);
    return { code: lines.join('\n') + '\n', language: 'python', warnings: warnings };
  }

  function toScrapy(input, opts) {
    const o = opts || {};
    const warnings = [];
    const req = asDescriptor(input, warnings, 'toScrapy');
    if (!req) return { code: '# curl 解析失败\n', language: 'python', warnings: warnings };
    const cls = spiderNameFrom(req, o);
    const name = o.spiderKey || cls.replace(/Spider$/, '').toLowerCase();
    const width = o.lineWidth || 100;
    const lines = [];
    if (o.project) lines.push('# project: ' + o.project);
    lines.push('import scrapy');
    const hint = bodyHint(req);
    if (hint === 'json') lines.push('import json');
    lines.push('');
    lines.push('');
    lines.push('class ' + cls + '(scrapy.Spider):');
    lines.push('    name = ' + pyLiteral(name, width, '    '));
    const host = (req.parsed && req.parsed.hostname) || '';
    if (host) lines.push('    allowed_domains = [' + pyLiteral(host, width, '    ') + ']');
    const headerList = filterHeaders(req, o, warnings);
    const withCookie = o.includeCookies !== false && !o.separateCookies && req.cookieString;
    const hl = withCookie ? headerList.concat([{ name: 'Cookie', value: req.cookieString }]) : headerList;
    const hrows = hl.map(function (h) {
      return '        ' + pyLiteral(h.name, width, '        ') + ': ' + pyLiteral(h.value, width, '        ') + ',';
    });
    lines.push('    custom_headers = ' + (hrows.length ? '{\n' + hrows.join('\n') + '\n    }' : '{}'));
    if (o.includeCookies !== false && Object.keys(req.cookies).length && !!o.separateCookies) {
      const rows = Object.keys(req.cookies).map(function (k) {
        return '        ' + pyLiteral(k, width, '        ') + ': ' + pyLiteral(req.cookies[k], width, '        ') + ',';
      });
      lines.push('');
      lines.push('    cookies = {');
      lines.push(rows.join('\n'));
      lines.push('    }');
    }
    const settings = ['    "ROBOTSTXT_OBEY": False,', '    "DOWNLOAD_TIMEOUT": ' + (req.timeout != null ? Number(req.timeout) : 15) + ','];
    if (o.concurrentNum != null) settings.push('    "CONCURRENT_REQUESTS": ' + Number(o.concurrentNum) + ',');
    if (o.userAgentRotate) settings.push('    "USER_AGENT_LISTS": [],  # 随机 UA 需自写 DownloaderMiddleware');
    lines.push('');
    lines.push('    custom_settings = {');
    lines.push(settings.join('\n'));
    lines.push('    }');
    lines.push('');
    if (req.verify === false) {
      lines.push('    # curl -k 等价：在 settings.py 中设');
      lines.push('    # DOWNLOADER_ALLOW_INSECURE = True');
      lines.push('    # 或 DOWNLOAD_HANDLERS = {"https": "scrapy.core.downloader.handlers.http.HTTPDownloadHandler"}');
      lines.push('');
    }
    const urlFor = o.paramsExtract && req.params.length ? req.urlBase : req.url;
    lines.push('    start_urls = [' + pyLiteral(urlFor, width, '    ') + ']');
    const needOverride = (req.bodyType !== 'none' && !req.get) || (o.paramsExtract && req.params.length) || req.method !== 'GET' || (o.includeCookies !== false && Object.keys(req.cookies).length && !!o.separateCookies);
    if (needOverride) {
      lines.push('');
      lines.push('    def start_requests(self):');
      lines.push('        for url in self.start_urls:');
      const args = ['url'];
      if (req.method !== 'GET') args.push('method=' + pyLiteral(req.method, width, '            '));
      args.push('headers=self.custom_headers');
      if (o.paramsExtract && req.params.length) {
        const rows = req.params.map(function (p) {
          return '                ' + pyLiteral(p.name, width, '                ') + ': ' + pyLiteral(p.value, width, '                ') + ',';
        });
        lines.push('            params = {');
        lines.push(rows.join('\n'));
        lines.push('            }');
        args.push('params=params');
      }
      if (req.bodyType !== 'none' && !req.get) {
        if (req.bodyKind === 'multipart' && req.form) {
          warn(warnings, 'scrapy_multipart', 'scrapy 上传文件需用 FormRequest + 文件对象，这里只给出 formdata 骨架');
          lines.push('            formdata = {');
          req.form.forEach(function (f) {
            lines.push('                ' + pyLiteral(f.name, width, '                ') + ': ' + pyLiteral(f.value == null ? '' : String(f.value), width, '                ') + ',');
          });
          lines.push('            }');
        } else if (req.json !== null && req.json !== undefined && o.prettyJson !== false) {
          lines.push(pyAssign('payload', JSON.stringify(req.json), o, '            '));
          args.push('body=payload');
        } else {
          lines.push(pyAssign('payload', String(req.body == null ? '' : req.body), o, '            '));
          args.push('body=payload');
        }
      }
      args.push('callback=self.parse');
      args.push('dont_filter=True');
      if (req.followRedirects) args.push('redirect_enabled=True');
      lines.push('            yield scrapy.' + (req.bodyKind === 'multipart' && req.form ? 'FormRequest' : 'Request') + '(');
      args.forEach(function (a) { lines.push('                ' + a + ','); });
      lines.push('            )');
    }
    lines.push('');
    lines.push('    def parse(self, response):');
    if (hint === 'json') {
      lines.push('        data = json.loads(response.text)');
      lines.push('        # TODO 按真实结构取值');
      lines.push('        yield data');
    } else if (hint === 'html') {
      lines.push('        yield {"title": response.css("title::text").get()}');
      lines.push('        # next_page = response.css("a.next::attr(href)").get()');
      lines.push('        # if next_page:');
      lines.push('        #     yield response.follow(next_page, callback=self.parse)');
    } else {
      lines.push('        yield {"raw": response.text[:200], "status": response.status}');
    }
    return { code: lines.join('\n') + '\n', language: 'python', warnings: warnings };
  }

  function bodyHint(req) {
    const ct = String(headerValue(req.headerList || [], 'content-type') || '');
    const k = contentKindHint(ct, req.body);
    return k === 'form' ? 'text' : k;
  }

  function contentKindHint(ct, body) {
    const c = String(ct || '').toLowerCase();
    if (/json/.test(c)) return 'json';
    if (/x-www-form-urlencoded|multipart\/form-data/.test(c)) return 'form';
    if (/xml/.test(c)) return 'xml';
    if (/javascript/.test(c)) return 'js';
    if (/html/.test(c)) return 'html';
    const b = String(body == null ? '' : body).trim();
    if (/^[{[]/.test(b)) {
      try { JSON.parse(b); return 'json'; } catch (e) {}
    }
    if (/^[\w.\-\[\]]+=[^&]*(&[\w.\-\[\]]+=[^&]*)+$/.test(b)) return 'form';
    return 'text';
  }

  const MIME_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', pdf: 'application/pdf',
    json: 'application/json', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
    js: 'application/javascript', css: 'text/css', xml: 'application/xml', zip: 'application/zip',
    mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', bin: 'application/octet-stream',
  };

  function mimeFromExt(file) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(file || ''));
    const ext = m ? m[1].toLowerCase() : '';
    return MIME_MAP[ext] || 'application/octet-stream';
  }

  /* ============================================================
   * JS generators
   * ============================================================ */

  function jsStr(s) {
    return JSON.stringify(String(s == null ? '' : s)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function jsValue(v, indent) {
    const inner = (indent || '') + '  ';
    if (v === null || v === undefined) return 'null';
    const t = typeof v;
    if (t === 'string') return jsStr(v);
    if (t === 'number' || t === 'boolean') return String(v);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[\n' + v.map(function (x) { return inner + jsValue(x, inner) + ','; }).join('\n') + '\n' + (indent || '') + ']';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(function (k) { return inner + jsStr(k) + ': ' + jsValue(v[k], inner) + ','; }).join('\n') + '\n' + (indent || '') + '}';
  }

  function jsHeaders(req, o, warnings, kw) {
    const list = filterHeaders(req, o, warnings);
    const out = [];
    const dropCT = req.bodyKind === 'multipart' && o.multipartAutoContentType !== false;
    /* 浏览器 / Worker 里 Cookie 是 forbidden header name，写了会被忽略（浏览器自己带）；
       Node 端 fetch/axios 没有这个限制，必须原样带上，否则登录态静默丢失 */
    const forbiddenCookie = o.mode === 'browser' || o.mode === 'worker';
    if (o.includeCookies === false || (forbiddenCookie && o.strippedCookies !== false)) {
      for (let i = list.length - 1; i >= 0; i--) if (/^cookie$/i.test(list[i].name)) list.splice(i, 1);
    }
    if (o.includeCookies !== false && !o.separateCookies && req.cookieString && !forbiddenCookie)
      list.push({ name: 'Cookie', value: req.cookieString });
    list.forEach(function (h) {
      if (dropCT && /^content-type$/i.test(h.name)) {
        if (!out.some(function (x) { return /content-type/i.test(x); })) warnings.__dropCT = true;
        return;
      }
      out.push('  ' + jsStr(h.name) + ': ' + jsStr(h.value) + ',');
    });
    return out;
  }

  function jsBodyParts(req, o, warnings) {
    const decls = [];
    let expr = 'undefined';
    if (req.bodyType === 'none' || req.get) return { decls: decls, expr: null };
    if (req.bodyKind === 'multipart') {
      decls.push('const formData = new FormData();');
      (req.form || []).forEach(function (f) {
        if (f.file) {
          decls.push('// TODO 用真实文件：formData.append(' + jsStr(f.name) + ', fileInput.files[0]' + (f.filename ? ', ' + jsStr(f.filename) : '') + ');');
          decls.push('formData.append(' + jsStr(f.name) + ', new Blob([new Uint8Array()], { type: ' + jsStr(f.type || 'application/octet-stream') + ' })' + (f.filename ? ', ' + jsStr(f.filename) : '') + ');');
          warn(warnings, 'multipart_file_js', '字段 ' + f.name + ' 引用文件 ' + f.file + '，浏览器端需用 File/Blob 替换');
        } else {
          decls.push('formData.append(' + jsStr(f.name) + ', ' + jsStr(f.value == null ? '' : String(f.value)) + ');');
        }
      });
      expr = 'formData';
      return { decls: decls, expr: expr };
    }
    if (req.bodyKind === 'json' && req.json !== null && req.json !== undefined) {
      if (o.rawJsonBody === true) {
        decls.push('const body = ' + jsStr(String(req.body || '')) + ';');
        expr = 'body';
      } else {
        decls.push('const payload = ' + jsValue(req.json, '') + ';');
        expr = 'JSON.stringify(payload)';
      }
      return { decls: decls, expr: expr };
    }
    if (req.bodyKind === 'urlencoded-form' && req.pairs && req.pairs.length && o.useUrlSearchParams !== false) {
      decls.push('const body = new URLSearchParams(' + jsValue(pairsToObject(req.pairs), '') + ');');
      expr = 'body';
      warn(warnings, 'urlsearchparams', '使用 URLSearchParams 时请删除手动设置的 Content-Type，否则 boundary/charset 可能不一致');
      return { decls: decls, expr: expr };
    }
    decls.push('const body = ' + jsStr(String(req.body == null ? '' : req.body)) + ';');
    expr = 'body';
    return { decls: decls, expr: expr };
  }

  function toFetch(input, opts) {
    const o = Object.assign({ mode: 'auto' }, opts || {});
    const warnings = [];
    const req = asDescriptor(input, warnings, 'toFetch');
    if (!req) return { code: '// curl 解析失败\n', language: 'javascript', warnings: warnings };
    if (!o.mode || o.mode === 'auto') o.mode = typeof self !== 'undefined' && typeof document === 'undefined' ? 'worker' : 'browser';
    const lines = [];
    if (o.mode === 'node') lines.push('/* Node 18+ 原生 fetch：Cookie 头照写（Node 没有 forbidden header 限制） */');
    if (o.comment) String(o.comment).split('\n').forEach(function (l) { lines.push('// ' + l); });
    const url = o.paramsExtract && req.params.length ? req.urlBase : req.url;
    lines.push('const url = ' + jsStr(url) + ';');
    if (o.paramsExtract && req.params.length) {
      lines.push('const params = new URLSearchParams(' + jsValue(req.params.reduce(function (acc, p) { acc[p.name] = p.value; return acc; }, {}), '') + ');');
      warn(warnings, 'params', 'URLSearchParams 会对参数重新编码，注意与浏览器原请求保持一致');
    }
    const hrows = jsHeaders(req, o, warnings);
    if (hrows.length) lines.push('const headers = {\n' + hrows.join('\n') + '\n};');
    else lines.push('const headers = {};');
    const bp = jsBodyParts(req, o, warnings);
    if (bp.decls.length) lines.push(bp.decls.join('\n'));
    if (warnings.__dropCT) warn(warnings, 'multipart_ct', '浏览器会自动生成 multipart 的 Content-Type/boundary，已移除该头');
    if (o.mode === 'browser' && req.cookieString) warn(warnings, 'browser_cookie', '浏览器 fetch 不能手写 Cookie，请用 credentials: "include" 由浏览器携带');
    if (req.verify === false) warn(warnings, 'insecure', 'curl -k 在浏览器端无对应；Node 需 NODE_TLS_REJECT_UNAUTHORIZED=0 或自定义 Agent');

    const callArgs = ['url' + (o.paramsExtract && req.params.length ? ' + "?" + params.toString()' : '')];
    const cfg = [];
    cfg.push('  method: ' + jsStr(req.method) + ',');
    cfg.push('  headers,');
    if (bp.expr) cfg.push('  body: ' + bp.expr + ',');
    if (req.followRedirects) cfg.push('  redirect: "follow",');
    if (o.mode === 'browser' || o.credentials) cfg.push('  credentials: ' + jsStr(o.credentials || 'include') + ',');
    if (req.auth && req.auth.user) cfg.push('  headers: { ...headers, Authorization: "Basic " + btoa(' + jsStr(req.auth.user + ':' + (req.auth.pass || '')) + ') },');
    const timeout = o.timeout != null ? o.timeout : req.timeout != null ? req.timeout * 1000 : null;
    if (timeout) cfg.push('  signal: AbortSignal.timeout(' + Math.round(Number(timeout)) + '),');
    callArgs.push('{\n' + cfg.join('\n') + '\n}');
    const parse = o.parse || (bodyHint(req) === 'json' || /json/i.test(String(headerValue(req.headerList, 'accept') || '')) ? 'json' : 'text');
    lines.push('');
    lines.push('async function main() {');
    lines.push('  const res = await fetch(' + callArgs.join(', ') + ');');
    lines.push('  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);');
    if (parse === 'json') lines.push('  const data = await res.json();');
    else if (parse === 'blob') lines.push('  const data = await res.blob();');
    else lines.push('  const data = await res.text();');
    lines.push('  console.log(data);');
    lines.push('}');
    lines.push('');
    lines.push('main();');
    return { code: lines.join('\n') + '\n', language: 'javascript', warnings: warnings };
  }

  function toAxios(input, opts) {
    const o = Object.assign({ module: 'cjs' }, opts || {});
    const warnings = [];
    const req = asDescriptor(input, warnings, 'toAxios');
    if (!req) return { code: '// curl 解析失败\n', language: 'javascript', warnings: warnings };
    const lines = [];
    if (o.comment) String(o.comment).split('\n').forEach(function (l) { lines.push('// ' + l); });
    if (o.module === 'esm') lines.push('import axios from "axios";');
    else lines.push('const axios = require("axios");');
    if (req.verify === false) {
      if (o.module === 'esm') lines.push('import https from "node:https";');
      else lines.push('const https = require("node:https");');
      warn(warnings, 'insecure_node', 'curl -k：Node 端用 https.Agent({rejectUnauthorized:false}) 近似');
    }
    const url = o.paramsExtract && req.params.length ? req.urlBase : req.url;
    lines.push('');
    lines.push('const url = ' + jsStr(url) + ';');
    const hrows = jsHeaders(req, o, warnings);
    lines.push('const headers = {\n' + hrows.join('\n') + '\n};');
    const bp = jsBodyParts(req, o, warnings);
    if (bp.decls.length) lines.push(bp.decls.join('\n'));
    if (o.paramsExtract && req.params.length) lines.push('const params = ' + jsValue(req.params.reduce(function (a, p) { a[p.name] = p.value; return a; }, {}), '') + ';');
    const cfg = [];
    cfg.push('    url,');
    cfg.push('    method: ' + jsStr(req.method.toLowerCase()) + ',');
    cfg.push('    headers,');
    if (o.paramsExtract && req.params.length) cfg.push('    params,');
    if (bp.expr) cfg.push('    data: ' + bp.expr + ',');
    const timeout = o.timeout != null ? o.timeout : req.timeout != null ? req.timeout * 1000 : null;
    if (timeout) cfg.push('    timeout: ' + Math.round(Number(timeout)) + ',');
    if (req.maxRedirects != null) cfg.push('    maxRedirects: ' + Number(req.maxRedirects) + ',');
    else if (!req.followRedirects) cfg.push('    maxRedirects: 0,');
    if (req.proxyRaw) {
      cfg.push('    // 代理需 axios-proxy-builder / http-proxy-agent，见 https 文档');
      warn(warnings, 'proxy', 'curl -x ' + req.proxyRaw + '：axios 需额外安装 agent 才能走代理');
    }
    if (req.verify === false) cfg.push('    httpsAgent: new https.Agent({ rejectUnauthorized: false }),');
    if (req.auth && req.auth.user) {
      if (req.auth.type === 'bearer') cfg.push('    headers: { ...headers, Authorization: ' + jsStr('Bearer ' + req.auth.token) + ' },');
      else cfg.push('    auth: { username: ' + jsStr(req.auth.user) + ', password: ' + jsStr(req.auth.pass || '') + ' },');
    }
    if (req.compressed) cfg.push('    // axios 默认带 Accept-Encoding: gzip 并自动解压');
    if (req.httpVersion && /2/.test(req.httpVersion)) warn(warnings, 'http2', 'curl --http2：Node axios 默认 HTTP/1.1，需 http2 适配层');
    lines.push('');
    lines.push('async function main() {');
    lines.push('  const { data, status } = await axios.request({');
    lines.push(cfg.join('\n'));
    lines.push('  });');
    lines.push('  console.log(status);');
    lines.push('  console.log(data);');
    lines.push('}');
    lines.push('');
    lines.push('main().catch((e) => {');
    lines.push('  console.error(e.response ? [e.response.status, e.response.data] : e.message);');
    lines.push('});');
    return { code: lines.join('\n') + '\n', language: 'javascript', warnings: warnings };
  }

  /* ============================================================
   * HAR bridge
   * ============================================================ */

  function toHar(parsed) {
    const warnings = [];
    const req = asDescriptor(parsed, warnings, 'toHar');
    if (!req) return { error: err('无法识别的输入') };
    const qs = req.params.map(function (p) { return { name: p.name, value: p.value }; });
    const entry = {
      startedDateTime: new Date(0).toISOString(),
      time: 0,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion || 'HTTP/2',
        headers: req.headerList.map(function (h) { return { name: h.name, value: h.value }; }),
        queryString: qs,
        cookies: Object.keys(req.cookies).map(function (k) { return { name: k, value: req.cookies[k], path: null, domain: null, expires: null, httpOnly: false, secure: false, sameSite: null }; }),
        headersSize: -1,
        bodySize: req.body == null ? 0 : utf8Len(String(req.body)),
      },
      response: {
        status: 0,
        statusText: '',
        httpVersion: req.httpVersion || 'HTTP/2',
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: '' },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { blocked: -1, dns: -1, ssl: -1, connect: -1, send: 0, wait: -1, receive: -1 },
      _source: 'spider-lab',
    };
    if (req.cookieString) entry.request.headers.push({ name: 'Cookie', value: req.cookieString });
    const ct = headerValue(req.headerList, 'content-type') || (req.bodyKind === 'urlencoded-form' ? 'application/x-www-form-urlencoded;charset=UTF-8' : req.bodyKind === 'json' ? 'application/json' : 'text/plain;charset=UTF-8');
    if (req.bodyType !== 'none') {
      const pd = { mimeType: ct, text: String(req.body == null ? '' : req.body) };
      if (req.bodyKind === 'multipart' && req.form)
        pd.params = req.form.map(function (f) {
          return { name: f.name, value: f.value == null ? '' : String(f.value), fileName: f.file || f.filename || undefined, contentType: f.type || undefined };
        });
      else if (req.pairs && req.bodyKind === 'urlencoded-form') pd.params = req.pairs.map(function (p) { return { name: p.name, value: p.value }; });
      entry.request.postData = pd;
    }
    if (req.auth && req.auth.user) entry.request.headers.push({ name: 'Authorization', value: 'Basic ' + btoaSafe(req.auth.user + ':' + (req.auth.pass || '')) });
    if (req.timeout != null) entry._meta = { timeout: req.timeout };
    return { log: { version: '1.2', creator: { name: 'spider-lab net.js', version: '1' }, entries: [entry] }, entry: entry, warnings: warnings };
  }

  function btoaSafe(s) {
    const T = {
      browser: typeof root !== 'undefined' && typeof root.btoa === 'function',
    };
    if (T.browser) return root.btoa(s);
    const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += B[b0 >> 2];
      out += B[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
      out += b1 === undefined ? '=' : B[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
      out += b2 === undefined ? '=' : B[b2 & 63];
    }
    return out;
  }

  function fromHarEntry(entry) {
    const e = entry && entry.log && entry.log.entries ? entry.log.entries[0] : entry;
    const warnings = [];
    if (!e || !e.request) return { ok: false, error: err('不是 HAR entry（缺少 request）'), warnings: warnings };
    const r = e.request;
    /* Charles / Fiddler / 部分代理导出的 HAR 会把 headers 写成对象 map（{name: value}）而不是数组，
       直接 .map 会抛 "reduce is not a function"。统一归一化。 */
    const rawHeaders = Array.isArray(r.headers) ? r.headers
      : (r.headers && typeof r.headers === 'object')
        ? Object.keys(r.headers).map(function (k) { return { name: k, value: r.headers[k] }; })
        : [];
    const headers = rawHeaders.map(function (h) {
      return { name: String(h.name), value: String(h.value), fromFlag: 'H', isCookieHeader: /^cookie$/i.test(h.name), isSpecial: SPECIAL_HEADERS.test(h.name) };
    });
    const cookies = [];
    (r.cookies || []).forEach(function (c) { cookies.push({ name: String(c.name), value: String(c.value) }); });
    headers.forEach(function (h) {
      if (/^cookie$/i.test(h.name)) cookiePairs(h.value).forEach(function (p) { cookies.push({ name: p.name, value: p.value }); });
    });
    const cookieMap = Object.create(null);
    const order = [];
    cookies.forEach(function (c) {
      if (!(c.name in cookieMap)) order.push(c.name);
      cookieMap[c.name] = c.value;
    });
    const merged = order.map(function (n) { return { name: n, value: cookieMap[n] }; });
    const pd = r.postData || {};
    let kind = 'none';
    const ctText = String(pd.mimeType || headerValue(headers, 'content-type') || '');
    if (/multipart\/form-data/i.test(ctText)) kind = 'multipart';
    else if (/x-www-form-urlencoded/i.test(ctText)) kind = pd.params && pd.params.length ? 'urlencoded-form' : 'urlencoded-form';
    else if (/json/i.test(ctText)) kind = 'json';
    else if (pd.text != null && pd.text !== '') kind = 'data';
    const body = { present: kind !== 'none', kind: kind, raw: pd.text != null ? String(pd.text) : '', pretty: null, form: null, json: null, pairs: null };
    if (body.present && pd.params) {
      if (kind === 'multipart') body.form = pd.params.map(function (p) { return { name: p.name, value: p.value == null ? null : String(p.value), file: p.fileName || null, type: p.contentType || null }; });
      else body.pairs = pd.params.map(function (p) { return { name: p.name, value: p.value == null ? '' : String(p.value) }; });
    }
    if (kind === 'json') {
      try {
        const p2 = SK.jsonx ? SK.jsonx.parse(body.raw) : { value: JSON.parse(body.raw) };
        if (p2.error) throw p2.error;
        body.json = p2.value;
        body.jsonRaw = body.raw;
        body.pretty = SK.jsonx ? SK.jsonx.pretty(body.raw, 2).text : JSON.stringify(body.json, null, 2);
      } catch (x) {
        warn(warnings, 'json_body_unparseable', 'HAR postData 声明 JSON 但无法解析');
      }
    }
    if (body.kind === 'urlencoded-form' && !body.pairs) body.pairs = splitForm(body.raw);
    let url = String(r.url || '');
    if (!url) warn(warnings, 'no_url', 'HAR entry 无 url');
    const authH = headerValue(headers, 'authorization');
    let auth = null;
    if (authH) {
      const m = /^basic\s+(.+)$/i.exec(authH.trim());
      if (m) {
        const dec = atobSafe(m[1]);
        const i = dec.indexOf(':');
        auth = { type: 'basic', user: i < 0 ? dec : dec.slice(0, i), pass: i < 0 ? '' : dec.slice(i + 1) };
      } else {
        const b = /^bearer\s+(.+)$/i.exec(authH.trim());
        if (b) auth = { type: 'bearer', token: b[1], user: null, pass: null };
      }
    }
    const headersNoAuth = headers.filter(function (h) { return !/^authorization$/i.test(h.name) || !auth; });
    return {
      ok: true,
      shell: 'har',
      method: String(r.method || 'GET').toUpperCase(),
      url: url,
      originalUrl: url,
      parsed: parseUrlParts(url) || { protocol: null, host: null, hostname: null, port: null, path: null, search: null, hash: null, origin: null },
      headers: headersNoAuth,
      /* formatCurl() 只读 headerList；缺了它导出的 cURL 会静默丢掉全部请求头（Cookie / sign / X-Token） */
      headerList: headersNoAuth,
      cookies: merged,
      cookieString: merged.map(function (c) { return c.name + '=' + c.value; }).join('; '),
      auth: auth,
      body: body,
      options: {
        compressed: false, insecure: false, followRedirects: false, maxRedends: null, maxRedirects: null,
        timeout: (e._meta && e._meta.timeout) || null, connectTimeout: null, proxy: null, userAgent: headerValue(headersNoAuth, 'user-agent'),
        referer: headerValue(headersNoAuth, 'referer'), output: null, verbose: 0, head: String(r.method).toUpperCase() === 'HEAD',
        get: false, resolve: [], connectTo: [], cookieJar: null, httpVersion: r.httpVersion || null, noKeepAlive: false,
        customRequests: [], raw: [],
      },
      warnings: warnings,
      stats: { argCount: headers.length, bytes: utf8Len(body.raw) },
      _har: true,
    };
  }

  function atobSafe(s) {
    try {
      if (typeof root !== 'undefined' && typeof root.atob === 'function') return root.atob(s);
    } catch (e) {
      /* fall through */
    }
    try {
      const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const clean = String(s).replace(/=+$/, '');
      let bits = 0;
      let acc = 0;
      const bytes = [];
      for (let i = 0; i < clean.length; i++) {
        const v = B.indexOf(clean[i]);
        if (v < 0) continue;
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes.push((acc >> bits) & 0xff);
        }
      }
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out += b < 0x80 ? String.fromCharCode(b) : b < 0xe0 ? String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f)) : String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
      }
      return out;
    } catch (e) {
      return '';
    }
  }

  /* ------------------------------------------------------------------------
     请求保真检查：生成代码里到底有没有把原请求的每一部分带上。
     它做的是「覆盖率」而不是语义等价——但恰好能抓到最常见的一类事故：
     生成器在某条分支上把 Cookie / 某个 header / 某个 body 字段默默丢了。
     ---------------------------------------------------------------------- */
  function fidelityCheck(parsed, code, opts) {
    const o = opts || {};
    const text = String(code == null ? '' : code);
    /* Python 生成器把长 header / UA / Cookie 折成多段隐式拼接：
         "passport_csrf_token=…; dw_sync_deviceid=72498341029384"
         "72345"
       两段之间还可能隔着 "( " 和缩进。直接 indexOf 原始整串必然失配，
       于是「Cookie 丢了」这类假警报满天飞。这里额外做一份「把折行拼回整串」
       的文本，只在原文失配时兜底比对。 */
    const flat = text
      .replace(/"\s*\n\s*"/g, '')      /* 相邻两段引号字符串：拼接 */
      .replace(/"\(\s*\n\s*"/g, '(')   /* "( \n " 折行开头 */
      .replace(/"\s*\n\s*\)"/g, ')')   /* 折行结尾的 ) */;
    const lower = text.toLowerCase();
    const lowerFlat = flat.toLowerCase();
    const has = function (needle) { return text.indexOf(needle) >= 0 || flat.indexOf(needle) >= 0; };
    const hasLower = function (needle) { return lower.indexOf(needle) >= 0 || lowerFlat.indexOf(needle) >= 0; };
    const items = [];
    const add = (part, name, ok, note) => items.push({ part: part, name: String(name), ok: !!ok, note: note || (ok ? '' : '生成代码里没找到') });

    if (!parsed || !parsed.ok) return { items: items, missing: 0, total: 0 };

    /* method：GET 通常省略，不算缺失 */
    const method = String(parsed.method || 'GET').toUpperCase();
    if (method !== 'GET') add('method', method, new RegExp("['\"\\.]" + method + "['\"\\.]|\\b" + method + "\\b", 'i').test(text));

    /* URL 与查询参数 */
    const url = String(parsed.url || '');
    const qIdx = url.indexOf('?');
    const base = qIdx >= 0 ? url.slice(0, qIdx) : url;
    const pathOnly = (function () {
      try { const u = new URL(url); return u.pathname; } catch (e) { return base; }
    })();
    add('url', base, has(base) || (pathOnly && has(pathOnly)));
    if (qIdx >= 0) {
      String(url.slice(qIdx + 1)).split('&').filter(Boolean).forEach(function (pair) {
        const k = pair.split('=')[0];
        add('query', pair, text.indexOf(pair) >= 0 || (k && new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text)));
      });
    }

    /* headers（Cookie 单列） */
    let cookieSeen = false;
    (parsed.headers || []).forEach(function (h) {
      if (!h || !h.name) return;
      if (h.isCookieHeader || /^cookie$/i.test(h.name)) { cookieSeen = true; return; }
      if (o.dropContentType && /^content-type$/i.test(h.name) && o.multipart) return;
      const nameOk = hasLower(String(h.name));
      add('header', h.name, nameOk, nameOk ? '' : '这个 header 没出现在生成代码里');
    });

    /* cookie 文件形态（-b cookies.txt）：文件内容不在命令里，生成代码必然缺登录态，
       必须记成缺失项，否则上面的「全部已带上」会盖住下面的警告，用户被误导。 */
    if (parsed.options && parsed.options.cookieFile) {
      add('cookie', '-b ' + parsed.options.cookieFile, false, 'Cookie 在外部文件里，命令本身没带值；生成代码不会有登录态');
    }

    /* Cookie：整串或逐个 name=value 命中都算 */
    const cookieString = String(parsed.cookieString || '');
    if (cookieString) {
      const whole = has(cookieString);
      const jars = (parsed.cookies || []).filter(function (c) { return c && c.name; });
      const hitNames = jars.filter(function (c) { return text.indexOf(String(c.name) + '=' + String(c.value)) >= 0 || new RegExp('["\']' + String(c.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']\\s*:').test(text); });
      const ok = whole || jars.length === 0 || hitNames.length === jars.length;
      add('cookie', jars.length ? jars.length + ' 个 cookie' : 'Cookie 头', ok, ok ? '' : 'Cookie 丢了或只带了一部分——登录态会失效');
    }

    /* body */
    const body = parsed.body || {};
    if (body.present) {
      if (body.kind === 'json' && body.json && typeof body.json === 'object') {
        Object.keys(body.json).forEach(function (k) { add('body', k, text.indexOf('"' + k + '"') >= 0 || text.indexOf("'" + k + "'") >= 0 || new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text)); });
      } else if (body.form && body.form.length) {
        body.form.forEach(function (f) { if (f && f.name) add('body', f.name, text.indexOf(String(f.name)) >= 0); });
      } else if (body.raw) {
        const raw = String(body.raw);
        const probe = raw.length > 24 ? raw.slice(0, 24) : raw;
        add('body', probe + (raw.length > 24 ? '…' : ''), text.indexOf(probe) >= 0 || text.indexOf(raw) >= 0);
      }
    }

    const missing = items.filter(function (x) { return !x.ok; }).length;
    return { items: items, missing: missing, total: items.length };
  }

  SK.net = {
    parseCurl: parseCurl,
    fidelityCheck: fidelityCheck,
    toRequests: toRequests,
    toHttpx: toHttpx,
    toAiohttp: toAiohttp,
    toFeapder: toFeapder,
    toFeapderTask: toFeapderTask,
    toScrapy: toScrapy,
    toFetch: toFetch,
    toAxios: toAxios,
    toHar: toHar,
    fromHarEntry: fromHarEntry,
    toRequest: toRequest,
    normalizeRequest: normalizeRequest,
    parseHeaderBlock: parseHeaderBlock,
    formatHeaderBlock: formatHeaderBlock,
    parseCookie: parseCookie,
    formatCookie: formatCookie,
    formatCurl: formatCurl,
    parseUrlParts: parseUrlParts,
    parseQueryString: parseQueryString,
    encodePiece: encodePiece,
    decodePiece: decodePiece,
    detectShell: detectShell,
  };
  SK.urlkit = SK.net;

})(typeof self !== 'undefined' ? self : globalThis);
