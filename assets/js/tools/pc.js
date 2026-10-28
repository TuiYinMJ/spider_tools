/* ============================================================================
   Spider Lab · pc.js
   PC 逆向工具集：PE 分析器（导入/导出/节/壳检测）+ 调试速查
   ========================================================================== */
(function () {

  SK.tool({
    id: 'pe-inspect',
    name: 'PE 分析器',
    group: 'pc',
    icon: '🪟',
    aliases: 'pe exe dll windows 逆向 导入 导出 节 壳',
    keywords: ['pe', 'exe', 'dll', 'windows', '导入', '导出', '壳', 'upx', '逆向'],
    desc: '解析 PE/EXE/DLL：导入表（用了什么 API）、导出表、节表（壳/加壳特征识别）、入口点/编译时间戳',
    hint: '拖入 .exe / .dll / .sys；看导入表判断加密与反调试手法',
    inputs: [{ id: 'in', label: '.exe / .dll 文件', placeholder: '拖入 PE 文件', sample: 'pe' , binary: true }],
    maxBytes: 209715200,
    options: [],
    help:
      '<h4>看什么</h4>' +
      '<ul><li><b>导入表</b>：有 <code>IsDebuggerPresent</code>/<code>CheckRemoteDebuggerPresent</code>（反调试）、<code>VirtualAlloc</code>+<code>WriteProcessMemory</code>（自修改/注入）、<code>CryptEncrypt/BCryptXxx</code>（加密）、<code>WinHttp/InternetOpenA</code>（网络）</li>' +
      '<li><b>节表</b>：<code>UPX0/UPX1</code>=UPX 壳、节名乱码/VMP=虚拟机壳、<code>.themida</code>=Themida；节的可写可执行（RWX）特征</li>' +
      '<li><b>导出表</b>：DLL 的接口；序号导出（无名字）要按序号调</li>' +
      '<li><b>编译时间戳</b>：与 PDB 路径、Rich 头辅助判断编译环境</li></ul>' +
      '<h4>下一步</h4>' +
      '<p>x64dbg 命令看「调试速查」；壳先脱（UPX 直接 -d），VMP 类用动态 trace。</p>',
    handler: async function (input, opts) {
      opts = opts || {};
      let bytes = null;
      if (input && input.__file) bytes = new Uint8Array(await input.__file.arrayBuffer());
      else if (typeof input === 'string' && input.length > 64) {
        try {
          let t = input.trim().replace(/\s+/g, '');
          if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) { bytes = new Uint8Array(t.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(t.substr(i * 2, 2), 16); }
          else { while (t.length % 4) t += '='; const bin = atob(t); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
        } catch (e) {}
      }
      if (!bytes) return { error: '无法识别输入：既不是 base64 也不是合法 hex', hint: '推荐直接把 .exe/.dll 文件拖进输入框；粘贴的话需是完整文件的 base64' };
      if (u16(bytes, 0) !== 0x5a4d) return { error: '不是 PE 文件（无 MZ 头）', hint: 'Linux 的 so 请用「SO 符号分析」' };

      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      /* 全量边界防护：截断/加壳/伪造的 PE 很容易在头部就读越界，
         原来会抛 "Offset is outside the bounds of the DataView" 直接崩掉整个工具。 */
      const U16 = (o) => (o >= 0 && o + 2 <= bytes.byteLength ? dv.getUint16(o, true) : 0);
      const U32 = (o) => (o >= 0 && o + 4 <= bytes.byteLength ? dv.getUint32(o, true) : 0);
      const U64 = (o) => (o >= 0 && o + 8 <= bytes.byteLength ? Number(dv.getBigUint64(o, true)) : 0);
      if (bytes.byteLength < 0x40) return { error: 'PE 文件头被截断（不足 64 字节）', hint: '确认文件完整下载；分片/加密流不能直接分析' };
      const peOff = dv.getUint32(0x3c, true);
      if (peOff + 24 > bytes.byteLength) return { error: 'PE 头偏移越界（e_lfanew=' + peOff + '，文件仅 ' + bytes.byteLength + ' 字节）', hint: '文件可能被截断，或不是标准 PE' };
      if (u32(bytes, peOff) !== 0x00004550) return { error: '没找到 PE 签名' };
      const machine = U16(peOff + 4);
      const numSections = U16(peOff + 6);
      const timestamp = U32(peOff + 8);
      const optSize = U16(peOff + 20);
      const opt = peOff + 24;
      const magic = U16(opt);
      const is64 = magic === 0x20b;
      const entryRva = U32(opt + 16);
      const imageBase = is64 ? U64(opt + 24) : U32(opt + 28);
      const subsystem = U16(opt + 68);
      const ddOff = opt + (is64 ? 112 : 96);
      const dirs = [];
      for (let i = 0; i < 16; i++) {
        const rva = U32(ddOff + i * 8);
        const size = U32(ddOff + i * 8 + 4);
        if (rva) dirs.push({ i: i, rva: rva, size: size });
      }
      /* 节数量异常（伪造头常见 0 或几万）时截断，避免长时间空转 */
      if (numSections > 512) return { error: '节数量异常（' + numSections + '），疑似伪造/损坏的 PE 头' };

      /* 节表 → RVA 转文件偏移 */
      const secOff = opt + optSize;
      const sections = [];
      for (let i = 0; i < numSections; i++) {
        const s = secOff + i * 40;
        let name = '';
        for (let j = 0; j < 8; j++) { if (!bytes[s + j]) break; name += String.fromCharCode(bytes[s + j]); }
        const vsize = dv.getUint32(s + 8, true);
        const vaddr = dv.getUint32(s + 12, true);
        const rawSize = dv.getUint32(s + 16, true);
        const rawOff = dv.getUint32(s + 20, true);
        const chars = dv.getUint32(s + 36, true);
        /* 熵值：判断「加壳/加密」最直接的指标（>7.2 基本可以怀疑压缩/加密） */
        let entropy = 0;
        try {
          const end = Math.min(rawOff + rawSize, bytes.byteLength);
          const n = end - rawOff;
          if (rawOff > 0 && n > 16) {
            const freq = new Uint32Array(256);
            for (let p = rawOff; p < end; p++) freq[bytes[p]]++;
            for (let k = 0; k < 256; k++) {
              if (!freq[k]) continue;
              const pr = freq[k] / n;
              entropy -= pr * Math.log2(pr);
            }
          }
        } catch (e) { entropy = 0; }
        /* B21：PE 节权限位写反了 —— IMAGE_SCN_MEM_READ=0x40000000、MEM_WRITE=0x80000000、
           MEM_EXECUTE=0x20000000。0x60000020 应该是 R-X，旧代码显示成 -WX。 */
        const SC = { READ: 0x40000000, WRITE: 0x80000000, EXEC: 0x20000000 };
        sections.push({ name: name, vsize: vsize, vaddr: vaddr, rawSize: rawSize, rawOff: rawOff, chars: chars, entropy: entropy, rwx: ((chars & SC.READ) ? 'R' : '-') + ((chars & SC.WRITE) ? 'W' : '-') + ((chars & SC.EXEC) ? 'X' : '-') });
      }
      /* overlay：最后一个节之后多出来的数据（自解压/追加马/安装包绑定） */
      let secEnd = 0;
      sections.forEach((s) => { if (s.rawOff && s.rawSize) secEnd = Math.max(secEnd, s.rawOff + s.rawSize); });
      const overlaySize = Math.max(0, bytes.byteLength - secEnd);
      const totalEntropy = (() => {
        try {
          const freq = new Uint32Array(256);
          const n = bytes.byteLength;
          for (let p = 0; p < n; p++) freq[bytes[p]]++;
          let e = 0;
          for (let k = 0; k < 256; k++) { if (!freq[k]) continue; const pr = freq[k] / n; e -= pr * Math.log2(pr); }
          return e;
        } catch (x) { return 0; }
      })();
      /* Rich Header：MSVC 编译器的厂商/产品/次数表，逆向时用来判断编译环境与工具链 */
      const richInfo = (() => {
        const lim = Math.min(bytes.byteLength, 4096);
        let richAt = -1;
        for (let p = 0x40; p < lim - 4; p++) {
          if (bytes[p] === 0x52 && bytes[p + 1] === 0x69 && bytes[p + 2] === 0x63 && bytes[p + 3] === 0x68) { richAt = p; break; }
        }
        if (richAt < 0) return null;
        /* DanS 标记（0x536E6144 异或 key）之前的 4 字节是 key */
        const key = dv.getUint32(richAt + 4, true);
        for (let p = 0x40; p < richAt; p += 4) {
          if ((dv.getUint32(p, true) ^ key) === 0x536E6144) {
            const entries = [];
            for (let q = p + 16; q + 8 <= richAt; q += 8) {
              const compid = dv.getUint32(q, true) ^ key;
              const cnt = dv.getUint32(q + 4, true) ^ key;
              entries.push({ product: (compid >>> 16) & 0xffff, build: compid & 0xffff, count: cnt });
            }
            return { entries: entries.slice(0, 64), key: key };
          }
        }
        return null;
      })();
      const rva2off = (rva) => {
        for (const s of sections) {
          if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize)) return s.rawOff + (rva - s.vaddr);
        }
        return -1;
      };

      /* 导入表 */
      const impDir = dirs.find((d) => d.i === 1);
      const imports = [];
      if (impDir) {
        let off = rva2off(impDir.rva);
        if (off > 0) {
          for (let i = 0; i < 100; i++) {
            const oftRva = dv.getUint32(off, true);
            const nameRva = dv.getUint32(off + 12, true);
            if (!nameRva) break;
            const nameOff = rva2off(nameRva);
            let dllName = '';
            if (nameOff > 0) { let q = nameOff; while (bytes[q]) dllName += String.fromCharCode(bytes[q++]); }
            const thunks = oftRva || dv.getUint32(off + 16, true);
            let tOff = rva2off(thunks);
            if (tOff > 0) {
              const step = is64 ? 8 : 4;
              for (let j = 0; j < 4096; j++) {
                /* B21：64 位 thunk 必须先保持 BigInt 再判定。
                   Number(0x8000000000000001n) 会丢成 9007199254740992，
                   低 16 位被抹平，序号 #1 显示成 #0。 */
                const vBig = is64 ? dv.getBigUint64(tOff + j * step, true) : BigInt(dv.getUint32(tOff + j * step, true));
                if (vBig === BigInt(0)) break;
                const ORD = is64 ? BigInt(0x8000000000000000) : BigInt(0x80000000);
                const byOrdinal = (vBig & ORD) !== BigInt(0);
                let fname = '#' + (vBig & BigInt(0xffff)).toString();
                if (!byOrdinal) {
                  const v = Number(vBig & BigInt(0xffffffff));
                  const fOff = rva2off(v);
                  if (fOff > 0) { let q = fOff + 2; let n = ''; while (bytes[q]) n += String.fromCharCode(bytes[q++]); fname = n || fname; }
                }
                imports.push({ dll: dllName, fn: fname });
              }
            }
            off += 20;
          }
        }
      }

      /* 导出表 */
      const expDir = dirs.find((d) => d.i === 0);
      const exports = [];
      if (expDir) {
        const eOff = rva2off(expDir.rva);
        if (eOff > 0) {
          let dllName = '';
          { const nOff = rva2off(dv.getUint32(eOff + 12, true)); if (nOff > 0) { let q = nOff; while (bytes[q]) dllName += String.fromCharCode(bytes[q++]); } }
          const nNames = dv.getUint32(eOff + 24, true);
          const namesRva = dv.getUint32(eOff + 32, true);
          const ordBase = dv.getUint32(eOff + 16, true);
          const fnRvaArr = dv.getUint32(eOff + 28, true);
          const ordArr = dv.getUint32(eOff + 36, true);
          const nOff2 = rva2off(namesRva);
          for (let i = 0; i < Math.min(nNames, 5000); i++) {
            const nmRva = dv.getUint32(nOff2 + i * 4, true);
            const o = rva2off(nmRva);
            if (o <= 0) continue;
            let nm = ''; let q = o; while (bytes[q]) nm += String.fromCharCode(bytes[q++]);
            const ord = dv.getUint16(rva2off(ordArr) + i * 2, true);
            const fnRva = dv.getUint32(rva2off(fnRvaArr) + ord * 4, true);
            exports.push({ name: nm, ordinal: ordBase + ord, addr: '0x' + (imageBase + fnRva).toString(16) });
          }
        }
      }

      /* 壳/特征识别 */
      const packerSigs = [
        [/^UPX[0-9]?$/, 'UPX（可 upx -d 直接脱）'],
        [/.themida/i, 'Themida'],
        [/vmp/i, 'VMProtect'],
        [/aspack/i, 'ASPack'],
        [/petite/i, 'Petite'],
        [/nsp/i, 'NsPack'],
        [/pecompact/i, 'PECompact'],
        [/enigma/i, 'Enigma Protector'],
      ];
      const packers = [];
      sections.forEach((s) => {
        packerSigs.forEach(([re, name]) => { if (re.test(s.name) && !packers.includes(name)) packers.push(name); });
      });
      const rwxSecs = sections.filter((s) => s.rwx === 'RWX');
      const antiDbg = imports.filter((x) => /IsDebuggerPresent|CheckRemoteDebuggerPresent|OutputDebugString|NtQueryInformationProcess/i.test(x.fn));
      const cryptoApis = imports.filter((x) => /CryptEncrypt|CryptDecrypt|BCrypt|CryptAcquireContext|CryptCreateHash/i.test(x.fn));
      const netApis = imports.filter((x) => /WinHttp|InternetOpen|URLDownload|WSAStartup|connect|send$/i.test(x.fn));

      const highEntropy = sections.filter((x) => x.entropy > 7.2 && x.rawSize > 512);
      const summary = [
        '架构: ' + (machine === 0x14c ? 'x86 (32位)' : machine === 0x8664 ? 'x64' : '0x' + machine.toString(16)) + (is64 ? ' PE32+' : ' PE32'),
        '入口: 0x' + (imageBase + entryRva).toString(16),
        '编译时间: ' + new Date(timestamp * 1000).toLocaleString('zh-CN') + (timestamp > 0 && timestamp < 946684800 ? '（可疑/伪造）' : ''),
        '节: ' + numSections + ' 个' + (packers.length ? '  ⚠ 壳特征: ' + packers.join(', ') : ''),
        '导入: ' + imports.length + ' 个函数 / ' + new Set(imports.map((x) => x.dll)).size + ' 个 DLL',
        '导出: ' + exports.length,
        antiDbg.length ? '\n⚠ 反调试 API:\n' + antiDbg.map((x) => '  ' + x.fn).join('\n') : '',
        cryptoApis.length ? '\n加密 API:\n' + cryptoApis.slice(0, 6).map((x) => '  ' + x.fn).join('\n') : '',
        netApis.length ? '\n网络 API: ' + netApis.slice(0, 6).map((x) => x.fn).join(', ') : '',
        rwxSecs.length ? '\n⚠ RWX 节: ' + rwxSecs.map((s) => s.name).join(', ') : '',
        '整体熵: ' + totalEntropy.toFixed(3) + (totalEntropy > 7.2 ? '  ⚠ 偏高，疑似加壳/全文件加密' : ''),
        highEntropy.length ? '\n⚠ 高熵节（>7.2）: ' + highEntropy.map((s) => s.name + '=' + s.entropy.toFixed(2)).join(', ') : '',
        overlaySize ? '\noverlay: ' + SK.dom.fmtBytes(overlaySize) + '（末节之后的数据，自解压/绑定安装包常见）' : '',
      ].filter((x) => x !== '').join('\n').replace(/（(?:, )?$/, '');

      return {
        text: summary,
        lang: 'text',
        tabLabel: '摘要',
        tabs: [
          { label: '导入 (' + imports.length + ')', view: 'table', data: {
            columns: [{ key: 'dll', label: 'DLL', width: 'minmax(110px,170px)' }, { key: 'fn', label: '函数' }],
            rows: imports, name: 'imports',
            filterHint: '过滤（Debug / Crypt / Http / VirtualAlloc）',
          } },
          exports.length ? { label: '导出 (' + exports.length + ')', view: 'table', data: {
            columns: [{ key: 'name', label: '函数名' }, { key: 'ordinal', label: '序号', width: '70px' }, { key: 'addr', label: '地址', width: '120px' }],
            rows: exports, name: 'exports',
          } } : null,
          { label: '节 (' + numSections + ')', view: 'table', data: {
            columns: [{ key: 'name', label: '节名', width: '90px' }, { key: 'rwx', label: '权限', width: '60px' }, { key: 'entropy', label: '熵', width: '70px' }, { key: 'vsize', label: '虚拟大小', width: '90px' }, { key: 'rawSize', label: '文件大小', width: '90px' }, { key: 'note', label: '备注' }],
            rows: sections.map((s) => ({
              name: s.name, rwx: s.rwx, entropy: s.entropy ? s.entropy.toFixed(3) : '-',
              vsize: SK.dom.fmtBytes(s.vsize), rawSize: SK.dom.fmtBytes(s.rawSize),
              note: s.rawSize === 0 && s.vsize > 0 ? '文件无内容（壳解压目标区）'
                : s.rwx === 'RWX' ? '可写可执行 ⚠'
                  : s.entropy > 7.2 ? '高熵（压缩/加密）'
                    : s.name === '.rsrc' ? '资源段（版本/图标/清单）' : '',
            })),
            name: 'sections',
          } },
          richInfo && richInfo.entries.length ? { label: 'Rich Header (' + richInfo.entries.length + ')', view: 'table', data: {
            columns: [{ key: 'product', label: '产品 ID', width: '90px' }, { key: 'build', label: 'Build', width: '90px' }, { key: 'count', label: '链接次数', width: '90px' }],
            rows: richInfo.entries, name: 'rich',
          } } : null,
        ].filter(Boolean),
        stats: [
          { k: '架构', v: (machine === 0x14c ? 'x86' : 'x64') },
          { k: '节', v: numSections },
          { k: '导入函数', v: imports.length },
          exports.length ? { k: '导出', v: exports.length } : null,
          packers.length ? { k: '壳', v: packers.join(','), level: 'warn' } : null,
          antiDbg.length ? { k: '反调试', v: antiDbg.length, level: 'warn' } : null,
          { k: '整体熵', v: totalEntropy.toFixed(2), level: totalEntropy > 7.2 ? 'warn' : '' },
          overlaySize ? { k: 'overlay', v: SK.dom.fmtBytes(overlaySize), level: 'warn' } : null,
        ].filter(Boolean),
        notices: [].concat(
          packers.length ? [{ level: 'warn', msg: '识别到壳：' + packers.join(', ') + '——UPX 可直接脱，VMP/Themida 类需动态分析' }] : [],
          antiDbg.length ? [{ level: 'warn', msg: '存在反调试 API，x64dbg 里用 ScyllaHide 插件隐藏' }] : [],
          highEntropy.length ? [{ level: 'warn', msg: '高熵节 ' + highEntropy.map((x) => x.name).join('/') + '：基本可判定为压缩/加密，先脱壳再静态分析' }] : [],
          overlaySize ? [{ level: 'warn', msg: '发现 overlay ' + SK.dom.fmtBytes(overlaySize) + '：常见于自解压程序、绑定安装包、追加 payload' }] : [],
        ),
        filename: 'pe-report',
      };

      function u16(b, o) { return b[o] | (b[o + 1] << 8); }
      function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
    },
  });

  /* ============================================================
   * 调试速查（x64dbg / IDA / 常见手法）
   * ============================================================ */
  SK.tool({
    id: 'debug-cheats',
    name: '调试速查',
    group: 'pc',
    icon: '📋',
    aliases: 'x64dbg od ida 命令 速查 断点 反调试',
    keywords: ['x64dbg', 'ollydbg', 'ida', '调试', '断点', '速查', '命令', '反调试'],
    desc: 'x64dbg / IDA / Ghidra 常用命令速查 + 反调试手法对照表 + 常见破解套路',
    inputs: [{ id: 'q', label: '查什么？输入关键词过滤全部速查表', placeholder: '如：je / 溢出 / VirtualAlloc / vtable / frida', small: true, allowEmpty: true }],
    allowEmpty: true,
    inline: true,
    autoExec: true,
    options: [],
    handler: function (q) {
      const F = SK.dom.filterTableRows;
      const x64 = [
        ['F2', '下/取消断点（INT3）'],
        ['F4', '运行到光标'],
        ['F7 / F8', '单步进入 / 单步越过'],
        ['Ctrl+F9', '执行到返回（跳出当前函数）'],
        ['Alt+F9', '执行到用户代码（从系统 DLL 跳回）'],
        ['Ctrl+G', '跳到地址/符号（输入 API 名如 VirtualAlloc）'],
        ['bp <api|addr>', '命令版下断点：bp CreateFileW'],
        ['bp <module>!<addr>', '模块内偏移断点：bp test.exe+1234'],
        ['bphws <addr>, r/w', '硬件断点（读/写，抓谁改了这个值）'],
        ['bc / bpc', '清软件/条件断点'],
        ['Find <addr>, "str"', '内存搜字符串'],
        ['Dump <addr>', '转储到 Dump 窗口跟进'],
        ['ScyllaHide', '插件：反反调试（隐藏调试器特征）'],
      ];
      const ida = [
        ['Shift+F12', '字符串窗口（先找 URL/密钥/错误提示）'],
        ['Ctrl+F（字符串窗）', '搜可疑字符串'],
        ['X（函数上）', '查交叉引用（谁调用了它）'],
        ['F5', 'Hex-Rays 反编译为伪 C（最常用）'],
        ['Y', '改变量/函数类型'],
        ['N', '重命名（把 sub_1234 改成 encrypt）'],
        ['G', '跳到地址'],
        ['Alt+T', '文本搜索（搜整个反汇编）'],
        ['D', '数据转字节/字/双字'],
        ['Shift+E', '导出数据为 C 数组'],
      ];
      const anti = [
        ['IsDebuggerPresent', 'PEB.BeingDebugged 标志', 'ScyllaHide / 手动清 PEB 标志 / x64dbg 命令 SetPEB'],
        ['CheckRemoteDebuggerPresent', '远程调试检测', 'ScyllaHide'],
        ['NtQueryInformationProcess', 'ProcessDebugPort(0x7)', 'ScyllaHide / hook 返回 0'],
        ['OutputDebugString', '调试器存在时行为差异', 'ScyllaHide'],
        ['INT 3 扫描', '自检 CC 断点', '用硬件断点 bphws 代替 F2'],
        ['时间差检测', 'rdtsc / GetTickCount 差值', 'ScyllaHide 的时钟模拟'],
        ['FindWindow', '找 OD/x64dbg 窗口类名', 'ScyllaHide 或改窗口标题'],
        ['CRC/自校验', '代码段完整性检查', '用硬件断点+内存断点避免改字节'],
      ];
      const patterns = [
        ['弹窗/试用限制', '字符串窗搜提示语 → 交叉引用 → 找跳转 → F5 看逻辑 → 改 jnz 为 jmp（或 XOR eax,eax）'],
        ['网络验证', '断点 WinHttpSendRequest/InternetReadFile 看响应 → 找判断函数 → 本地构造响应'],
        ['加密算法确认', '导入表 Crypt*/BCrypt* → 断点 CryptEncrypt 看入参出参；自定义算法 F5 逐步读'],
        ['DLL 劫持', '导出表看缺什么 → 造转发 DLL（把原函数 Forward）'],
        ['去壳后修复', 'Scylla 插件 dump + 修复 IAT（Import Reconstruction）'],
      ];
      const tabs = [
        { label: 'x64dbg (' + (F(x64.map(x=>({k:x[0],v:x[1]})),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '命令/快捷键', width: 'minmax(120px,170px)' }, { key: 'v', label: '作用' }], rows: F(x64.map(([k, v]) => ({ k, v })), q), name: 'x64dbg' } },
        { label: 'IDA (' + (F(ida.map(x=>({k:x[0],v:x[1]})),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '快捷键', width: 'minmax(120px,170px)' }, { key: 'v', label: '作用' }], rows: F(ida.map(([k, v]) => ({ k, v })), q), name: 'ida' } },
        { label: '反调试对照 (' + (F(anti.map(x=>({k:x[0],v:x[1],fix:x[2]})),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '手法', width: 'minmax(160px,200px)' }, { key: 'v', label: '原理' }, { key: 'fix', label: '对策' }], rows: F(anti.map(([k, v, f]) => ({ k, v, fix: f })), q), name: 'anti' } },
        { label: '破解套路', view: 'table', data: { columns: [{ key: 'k', label: '场景', width: 'minmax(110px,150px)' }, { key: 'v', label: '步骤' }], rows: F(patterns.map(([k, v]) => ({ k, v })), q), name: 'crack' } },
      ];
      return {
        text: 'x64dbg ' + x64.length + ' 条 · IDA ' + ida.length + ' 条 · 反调试 ' + anti.length + ' 种 · 套路 ' + patterns.length + ' 个\n\n先看「破解套路」页签选场景，「反调试对照」配 ScyllaHide。',
        lang: 'text',
        tabLabel: '目录',
        tabs: tabs.filter(function (t) { return !t.data || !t.data.rows || t.data.rows.length > 0; }),
        stats: [{ k: '条目', v: x64.length + ida.length + anti.length }],
        next: [
          { label: '🪟 先分析 PE 看导入表', tool: 'pe-inspect' },
        ],
        filename: 'debug-cheats',
      };
    },
  });
})();
