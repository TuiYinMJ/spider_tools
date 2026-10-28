(function (root) {
  const SK = (root.SK = root.SK || {});

  const KW = {
    js: 'var let const function return if else for while do break continue new delete typeof instanceof in of this class extends super try catch finally throw switch case default await async yield static get set import export from null undefined true false NaN Infinity void debugger',
    python: 'def class return if elif else for while break continue pass import from as with try except finally raise lambda yield global nonlocal assert del in is not and or None True False async await self print range len str int float list dict set tuple',
    sql: 'select from where group by order limit offset having join inner left right full outer cross on as insert into values update set delete create table alter drop index primary key foreign not null unique default autoincrement constraint using case when then else end union all distinct like between in exists and or desc asc count sum avg min max',
  };

  const KWSET = {};
  for (const k in KW) KWSET[k] = new Set(KW[k].split(' '));

  function esc(s) {
    return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  function span(cls, text) {
    return '<span class="tk-' + cls + '">' + esc(text) + '</span>';
  }

  function jsIdent(ch) {
    return /[A-Za-z0-9_$]/.test(ch);
  }

  function hlJs(line, st) {
    const out = [];
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (st.inStr) {
        const end = findStrEnd(line, i, st.inStr);
        out.push(span('str', line.slice(i, end)));
        i = end;
        if (end >= n) break;
        out.push(span('str', line[end]));
        i = end + 1;
        st.inStr = null;
        continue;
      }
      if (st.tpl > 0) {
        const seg = line.indexOf('`', i);
        if (seg < 0) {
          out.push(span('str', line.slice(i)));
          i = n;
          break;
        }
        out.push(span('str', line.slice(i, seg + 1)));
        i = seg + 1;
        st.tpl--;
        continue;
      }
      if (st.block) {
        const end = line.indexOf('*/', i);
        if (end < 0) {
          out.push(span('com', line.slice(i)));
          i = n;
          break;
        }
        out.push(span('com', line.slice(i, end + 2)));
        i = end + 2;
        st.block = false;
        continue;
      }
      if (c === '/' && line[i + 1] === '/') {
        out.push(span('com', line.slice(i)));
        i = n;
        break;
      }
      if (c === '/' && line[i + 1] === '*') {
        st.block = true;
        out.push(span('com', '/*'));
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        if (c === '`') {
          st.tpl++;
          out.push(span('str', '`'));
          i++;
          continue;
        }
        const end = findStrEnd(line, i, c);
        if (end >= n) {
          st.inStr = c;
          out.push(span('str', line.slice(i)));
          i = n;
          break;
        }
        out.push(span('str', line.slice(i, end + 1)));
        i = end + 1;
        continue;
      }
      if (/[0-9]/.test(c) && !jsIdent(line[i - 1])) {
        const m = /^(0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?n?)/.exec(line.slice(i));
        if (m) {
          out.push(span('num', m[0]));
          i += m[0].length;
          continue;
        }
      }
      if (jsIdent(c)) {
        const m = /^[A-Za-z0-9_$]+/.exec(line.slice(i));
        const w = m[0];
        let j = i + w.length;
        while (j < n && line[j] === ' ') j++;
        if (KWSET.js.has(w)) out.push(span('kw', w));
        else if (line[j] === '(') out.push(span('fn', w));
        else if (/^[A-Z]/.test(w) && w.length > 1) out.push(span('cls', w));
        else out.push(esc(w));
        i += w.length;
        continue;
      }
      if (/[{}()\[\].,;:?+\-*/%<>=!&|^~]/.test(c)) {
        out.push(span('pun', c));
        i++;
        continue;
      }
      out.push(esc(c));
      i++;
    }
    return out.join('');
  }

  function findStrEnd(line, i, q) {
    for (let j = i + 1; j < line.length; j++) {
      const c = line[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === q) return j;
    }
    return line.length;
  }

  function hlJson(line, st) {
    let i = 0;
    const n = line.length;
    const out = [];
    while (i < n) {
      const c = line[i];
      if (c === '"') {
        const end = findStrEnd(line, i, '"');
        let j = end + 1;
        while (j < n && line[j] === ' ') j++;
        if (line[j] === ':') {
          out.push(span('key', line.slice(i, end + 1)));
          i = end + 1;
          continue;
        }
        out.push(span('str', line.slice(i, end + 1)));
        i = end + 1;
        continue;
      }
      if (/[0-9-]/.test(c)) {
        const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(line.slice(i));
        if (m) {
          out.push(span('num', m[0]));
          i += m[0].length;
          continue;
        }
      }
      const m2 = /^[A-Za-z_]+/.exec(line.slice(i));
      if (m2) {
        const w = m2[0];
        out.push(w === 'true' || w === 'false' || w === 'null' ? span('lit', w) : esc(w));
        i += w.length;
        continue;
      }
      out.push(span('pun', c));
      i++;
    }
    return out.join('');
  }

  function hlHtml(line, st) {
    const out = [];
    let i = 0;
    const n = line.length;
    while (i < n) {
      if (st.inComment) {
        const e = line.indexOf('-->', i);
        if (e < 0) {
          out.push(span('com', line.slice(i)));
          i = n;
          break;
        }
        out.push(span('com', line.slice(i, e + 3)));
        i = e + 3;
        st.inComment = false;
        continue;
      }
      if (st.mode === 'script') {
        const e = /<\/\s*script/i.exec(line.slice(i));
        const seg = e ? line.slice(i, i + e.index) : line.slice(i);
        out.push(hlJs(seg, st));
        i += seg.length;
        if (!e) break;
        st.mode = null;
        continue;
      }
      if (st.mode === 'style') {
        const e = /<\/\s*style/i.exec(line.slice(i));
        const seg = e ? line.slice(i, i + e.index) : line.slice(i);
        out.push(hlCss(seg));
        i += seg.length;
        if (!e) break;
        st.mode = null;
        continue;
      }
      if (line[i] === '<') {
        if (line.startsWith('<!--', i)) {
          st.inComment = true;
          out.push(span('com', '<!--'));
          i += 4;
          continue;
        }
        const m = /^(<\/?)([a-zA-Z][\w:-]*)/.exec(line.slice(i));
        if (!m) {
          out.push(esc('<'));
          i++;
          continue;
        }
        out.push(span('pun', m[1]));
        out.push(span('tag', m[2]));
        i += m[0].length;
        const name = m[2].toLowerCase();
        const closing = m[1] === '</';
        const gt = findGt(line, i);
        if (gt < 0) {
          out.push(hlAttrs(line.slice(i)));
          i = n;
          break;
        }
        out.push(hlAttrs(line.slice(i, gt)));
        out.push(span('pun', '>'));
        i = gt + 1;
        if (!closing && (name === 'script' || name === 'style') && !/\/\s*$/.test(line.slice(gt - 1, gt))) st.mode = name;
        continue;
      }
      const lt = line.indexOf('<', i);
      out.push(esc(lt < 0 ? line.slice(i) : line.slice(i, lt)));
      i = lt < 0 ? n : lt;
    }
    return out.join('');
  }

  function findGt(s, from) {
    let q = null;
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") {
        q = c;
        continue;
      }
      if (c === '>') return i;
    }
    return -1;
  }

  function hlAttrs(seg) {
    const out = [];
    let i = 0;
    while (i < seg.length) {
      const c = seg[i];
      if (c === '"' || c === "'") {
        const e = seg.indexOf(c, i + 1);
        const str = e < 0 ? seg.slice(i) : seg.slice(i, e + 1);
        out.push(span('str', str));
        i += str.length;
        continue;
      }
      const m = /^[a-zA-Z_:][\w:.-]*/.exec(seg.slice(i));
      if (m) {
        out.push(span('attr', m[0]));
        i += m[0].length;
        continue;
      }
      out.push(esc(c));
      i++;
    }
    return out.join('');
  }

  /* CSS：单遍扫描，保证每个字符都被输出（旧实现只输出第一条声明，会吃掉后半行） */
  function hlCss(line) {
    const out = [];
    const n = line.length;
    let i = 0;
    while (i < n) {
      const c = line[i];
      if (c === '/' && line[i + 1] === '*') {
        const e = line.indexOf('*/', i + 2);
        const seg = e < 0 ? line.slice(i) : line.slice(i, e + 2);
        out.push(span('com', seg));
        i += seg.length;
        continue;
      }
      if (c === ' ' || c === '\t') {
        let j = i;
        while (j < n && (line[j] === ' ' || line[j] === '\t')) j++;
        out.push(esc(line.slice(i, j)));
        i = j;
        continue;
      }
      if (c === '@') {
        const m = /^@[-\w]+/.exec(line.slice(i));
        if (m) {
          out.push(span('kw', m[0]));
          i += m[0].length;
          continue;
        }
      }
      if (c === '#' || (c === '-' && /\d/.test(line[i + 1] || '')) || /\d/.test(c)) {
        const m = /^#[0-9a-fA-F]{3,8}\b|^-?\d*\.?\d+(?:[a-z]{1,4}|%)?/.exec(line.slice(i));
        if (m && m[0]) {
          out.push(span('num', m[0]));
          i += m[0].length;
          continue;
        }
      }
      if (c === '"' || c === "'") {
        const e = line.indexOf(c, i + 1);
        const seg = e < 0 ? line.slice(i) : line.slice(i, e + 1);
        out.push(span('str', seg));
        i += seg.length;
        continue;
      }
      const word = /^[-\w]+/.exec(line.slice(i));
      if (word) {
        let j = i + word[0].length;
        while (j < n && (line[j] === ' ' || line[j] === '\t')) j++;
        const next = line[j];
        if (next === '{' || next === ',' || next === undefined) out.push(span('tag', word[0]));
        else if (next === ':') out.push(span('attr', word[0]));
        else if (next === '(') out.push(span('fn', word[0]));
        else out.push(esc(word[0]));
        i += word[0].length;
        continue;
      }
      if ('{}();,:.>+~*&[]=/!'.indexOf(c) >= 0) {
        out.push(span('pun', c));
        i++;
        continue;
      }
      out.push(esc(c));
      i++;
    }
    return out.join('');
  }

  /* Python：单遍扫描，避免多轮正则替换把已插入的标签当成源码再着色 */
  function hlPy(line) {
    const out = [];
    const n = line.length;
    const pyKw = KWSET.python;
    let i = 0;
    while (i < n) {
      const c = line[i];
      if (c === '#') {
        out.push(span('com', line.slice(i)));
        break;
      }
      if (c === '"' || c === "'") {
        const q = c;
        const triple = line.slice(i, i + 3) === q + q + q;
        let j = i + (triple ? 3 : 1);
        while (j < n) {
          if (line[j] === '\\') {
            j += 2;
            continue;
          }
          if (triple) {
            if (line.slice(j, j + 3) === q + q + q) {
              j += 3;
              break;
            }
          } else if (line[j] === q) {
            j++;
            break;
          }
          j++;
        }
        if (j > n) j = n;
        out.push(span('str', line.slice(i, j)));
        i = j;
        continue;
      }
      if (c >= '0' && c <= '9') {
        const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(line.slice(i));
        const tok = m ? m[0] : c;
        out.push(span('num', tok));
        i += tok.length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
        const w = line.slice(i, j);
        if (w === 'True' || w === 'False' || w === 'None') out.push(span('lit', w));
        else if (pyKw.has(w) || pyKw.has(w.toLowerCase())) out.push(span('kw', w));
        else if (line[j] === '(') out.push(span('fn', w));
        else out.push(esc(w));
        i = j;
        continue;
      }
      if ('{}[](),:;.='.indexOf(c) >= 0) {
        out.push(span('pun', c));
        i++;
        continue;
      }
      out.push(esc(c));
      i++;
    }
    return out.join('');
  }

  function newLineState() {
    return { block: false, inStr: null, tpl: 0, inComment: false, mode: null };
  }

  /* 统一 diff：hunk 头 / 文件头 / +,- 行 / \ No newline */
  function hlDiff(line) {
    if (line.charCodeAt(0) === 64 && line.slice(0, 2) === '@@') return span('kw', line);
    if (line.slice(0, 4) === '--- ' || line.slice(0, 4) === '+++ ') return span('dim', line);
    const c = line.charAt(0);
    if (c === '+') return span('add', line);
    if (c === '-') return span('del', line);
    if (c === '\\') return span('dim', line);
    return esc(line);
  }

  function line(text, lang, st) {
    const state = st || newLineState();
    const MAX = 4000;
    let body = text;
    let tail = '';
    if (body.length > MAX) {
      tail = span('dim', ' … +' + (body.length - MAX) + ' 字符未高亮');
      body = body.slice(0, MAX);
    }
    let html;
    switch (lang) {
      case 'json':
        html = hlJson(body, state);
        break;
      case 'html':
      case 'xml':
        html = hlHtml(body, state);
        break;
      case 'css':
        html = hlCss(body, state);
        break;
      case 'python':
        html = hlPy(body, state);
        break;
      case 'sql':
        html = hlSql(body, state);
        break;
      case 'diff':
        html = hlDiff(body);
        break;
      case 'plain':
      case 'text':
        html = esc(body);
        break;
      default:
        html = hlJs(body, state);
    }
    return { html: html + tail, state };
  }

  function hlSql(line) {
    const out = [];
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === '-' && line[i + 1] === '-') {
        out.push(span('com', line.slice(i)));
        break;
      }
      if (c === "'" || c === '"') {
        const q = c;
        let j = i + 1;
        while (j < line.length && line[j] !== q) j++;
        out.push(span('str', line.slice(i, Math.min(j + 1, line.length))));
        i = j + 1;
        continue;
      }
      if (c === '`') {
        const j = line.indexOf('`', i + 1);
        out.push(span('attr', line.slice(i, j < 0 ? line.length : j + 1)));
        i = j < 0 ? line.length : j + 1;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const m = /^\d+(\.\d+)?/.exec(line.slice(i));
        out.push(span('num', m[0]));
        i += m[0].length;
        continue;
      }
      const m2 = /^[A-Za-z_][\w$]*/.exec(line.slice(i));
      if (m2) {
        out.push(KWSET.sql.has(m2[0].toLowerCase()) ? span('kw', m2[0]) : esc(m2[0]));
        i += m2[0].length;
        continue;
      }
      out.push(esc(c));
      i++;
    }
    return out.join('');
  }

  SK.hl = { line, newLineState, KW, esc, span };
})(typeof self !== 'undefined' ? self : globalThis);
