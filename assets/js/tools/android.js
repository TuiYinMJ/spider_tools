/* ============================================================================
   Spider Lab · android.js
   安卓逆向工具集：APK 分析器 / SO(ELF) 符号分析 / Frida Hook 模板库
   ========================================================================== */
(function () {

  /* ============================================================
   * APK 分析器：文件清单 + AndroidManifest(AXML) 解析 + classes.dex 字符串
   * ============================================================ */
  SK.tool({
    id: 'apk-inspect',
    name: 'APK 分析器',
    group: 'android',
    icon: '🤖',
    aliases: 'apk android manifest 安卓 逆向 权限 axml',
    keywords: ['apk', '安卓', 'android', 'manifest', '权限', '逆向', 'axml', 'dex'],
    desc: '拖入 .apk：文件清单（dex/so/资源）、AndroidManifest 解析（包名/版本/权限/四大组件）、classes.dex 字符串提取（URL/密钥/类名）',
    hint: '直接把 .apk 拖进输入框；不用解压',
    inputs: [{ id: 'in', label: '.apk / .jar / .zip 文件', placeholder: '拖入 APK 文件', sample: 'apk' , binary: true }],
    maxBytes: 524288000,
    options: [
      { id: 'dexFilter', type: 'select', label: 'dex 字符串过滤', value: 'suspicious', choices: [
        { v: 'suspicious', label: '可疑（URL/key/加密类）' },
        { v: 'urls', label: '仅 URL / 接口' },
        { v: 'crypto', label: '加密类名/算法' },
        { v: 'all', label: '全部（前 2 万条）' },
      ] },
    ],
    bigFile: true,
    help:
      '<h4>看什么</h4>' +
      '<ul><li><b>文件清单</b>：几个 classes.dex（多 dex=大应用）、lib/ 下有哪些 ABI 的 so、assets 里藏了什么</li>' +
      '<li><b>Manifest</b>：包名/版本；权限里有没有 <code>READ_PHONE_STATE</code>（设备指纹）、<code>REQUEST_INSTALL_PACKAGES</code>（拉新）；exported 的组件是攻击面；debuggable=true 直接可调</li>' +
      '<li><b>dex 字符串</b>：加固的 APK 这里能看到壳的痕迹（jiagu/stub/360/tencent）；字符串里的 http 接口、CryptoJS 类名是抓包前的情报</li></ul>' +
      '<h4>下一步</h4>' +
      '<p>SO 拖去「SO 符号分析」找 native 导出；Frida 模板生成 Java 层 hook 挂到关键类。</p>',
    handler: async function (input, opts) {
      opts = opts || {};
      let bytes = null;
      if (input && input.__file) bytes = new Uint8Array(await input.__file.arrayBuffer());
      else if (typeof input === 'string' && input.length > 64) {
        /* base64 粘贴 */
        try {
          let t = input.trim().replace(/\s+/g, '');
          if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) {
            bytes = new Uint8Array(t.length / 2);
            for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(t.substr(i * 2, 2), 16);
          } else {
            while (t.length % 4) t += '=';
            const bin = atob(t);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          }
        } catch (e) {}
      }
      if (!bytes) return { error: '无法识别输入：既不是 base64 也不是合法 hex', hint: '推荐直接把 .apk 文件拖进输入框（无需解压）；粘贴的话需是完整 APK 的 base64' };

      const zip = SK.az.zipList(bytes);
      if (zip.error) return { error: zip.error };

      const entries = zip.entries;
      const byName = (n) => entries.find((e) => e.name === n);
      const stats = [
        { k: '文件数', v: entries.length },
        { k: 'dex', v: entries.filter((e) => /^classes\d*\.dex$/.test(e.name)).length },
        { k: 'so', v: entries.filter((e) => e.name.endsWith('.so')).length },
      ];
      const tabs = [];
      const extraNotices = [];

      /* --- Manifest --- */
      const mf = byName('AndroidManifest.xml') || entries.find((e) => /AndroidManifest/i.test(e.name));
      let manifestRows = [];
      let info = null;
      if (mf) {
        const axmlBytes = await SK.az.zipEntry(bytes, mf);
        if (axmlBytes) {
          const axml = SK.az.axml(axmlBytes);
          if (!axml.error) {
            const mi = SK.az.manifestInfo(axml);
            info = mi.info;
            manifestRows = [
              { k: '包名', v: mi.info.package, copy: true },
              { k: '版本', v: (mi.info.versionName || '?') + ' (' + (mi.info.versionCode || '?') + ')' },
              { k: 'compileSdk', v: mi.info.compileSdk || '-' },
              { k: '权限', v: String(mi.permissions.length) + ' 项' },
              { k: 'Activity', v: String(mi.activities.length) },
              { k: 'Service', v: String(mi.services.length) },
              { k: 'Receiver', v: String(mi.receivers.length) },
              { k: 'Provider', v: String(mi.providers.length) },
            ];
            if (mi.application && mi.application.debuggable === 'true') manifestRows.push({ k: 'debuggable', v: 'true（可直接 attach 调试器！）', cls: 'warn' });
            tabs.push({ label: '权限 (' + mi.permissions.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '权限' }], rows: mi.permissions.map((p) => ({ name: p })), name: 'perms', filterHint: '过滤权限（如 PHONE / SMS / LOCATION）' } });
            tabs.push({ label: '组件 (' + (mi.activities.length + mi.services.length + mi.receivers.length + mi.providers.length) + ')', view: 'table', data: {
              columns: [{ key: 'kind', label: '类型', width: '80px' }, { key: 'name', label: '组件名' }],
              rows: [].concat(
                mi.activities.map((x) => ({ kind: 'Activity', name: x })),
                mi.services.map((x) => ({ kind: 'Service', name: x })),
                mi.receivers.map((x) => ({ kind: 'Receiver', name: x })),
                mi.providers.map((x) => ({ kind: 'Provider', name: x })),
              ), name: 'components', filterHint: '过滤组件（如 Main / Push / pay）',
            } });
          }
        }
      }
      tabs.unshift({ label: 'Manifest 摘要', view: 'fields', data: manifestRows.length ? manifestRows : [{ k: 'AndroidManifest', v: '未找到或解析失败（可能被加固改了入口）' }] });

      /* --- 文件清单 --- */
      const soByAbi = {};
      entries.filter((e) => e.name.endsWith('.so')).forEach((e) => {
        const m = /^lib\/([^/]+)\//.exec(e.name);
        const abi = m ? m[1] : '其他';
        (soByAbi[abi] = soByAbi[abi] || []).push(e.name.split('/').pop());
      });
      const packers = entries.filter((e) => /jiagu|stub|secneo|360|tencent_shell|ijiami|bangcle|nqshield|baidu|alipay.*guard|mobimagic|shell/i.test(e.name));
      tabs.push({ label: '文件清单 (' + entries.length + ')', view: 'table', data: {
        columns: [{ key: 'name', label: '路径' }, { key: 'method', label: '压缩', width: '70px' }, { key: 'size', label: '解压大小', width: '90px' }],
        rows: entries.slice(0, 5000).map((e) => ({ name: e.name, method: e.method, size: SK.dom.fmtBytes(e.uncompSize) })),
        name: 'zip', filterHint: '过滤文件（dex / so / assets / .json）',
      } });
      if (Object.keys(soByAbi).length) stats.push({ k: 'ABI', v: Object.keys(soByAbi).join(' ') });
      if (packers.length) stats.push({ k: '加固特征', v: '疑似', level: 'warn' });

      /* --- dex 字符串 --- */
      const dexEntry = byName('classes.dex');
      if (dexEntry) {
        const dexBytes = await SK.az.zipEntry(bytes, dexEntry);
        if (dexBytes) {
          const filters = {
            suspicious: /https?:\/\/|api\.|\.so\b|encrypt|decrypt|aes|rsa|md5|sha1|sha256|sign|token|secret|key|password|jni|native|curl|okhttp|retrofit|cert|\.pem|\.bks|did$|deviceid/i,
            urls: /https?:\/\/|ws:\/\//i,
            crypto: /cipher|encrypt|decrypt|aes|rsa|des|md5|sha1|sha256|hmac|base64|javax\/crypto|security\/MessageDigest|KeyStore|\.so$/i,
          };
          const r = SK.az.dexStrings(dexBytes, opts.dexFilter === 'all' ? null : filters[opts.dexFilter]);
          if (!r.error) {
            stats.push({ k: 'dex 字符串', v: SK.dom.fmtNum(r.strings.length) });
            stats.push({ k: 'dex 方法', v: SK.dom.fmtNum(r.header.methods) });
            tabs.push({ label: 'dex 字符串 (' + r.strings.length + ')', view: 'table', data: {
              columns: [{ key: 's', label: '字符串' }],
              rows: r.strings.slice(0, 8000).map((s) => ({ s: s.length > 300 ? s.slice(0, 300) + '…' : s })),
              name: 'dexstr', filterHint: '过滤字符串（http / sign / Lcom/包名）',
            } });
          }
          /* 方法签名：安卓逆向真正要拿的是「类->方法(参数)返回值」，字符串池给不了 */
          try {
            const all = SK.az.dexMethods(dexBytes, null);
            if (!all.error && all.methods.length) {
              const hot = /encrypt|decrypt|sign|md5|sha|hmac|aes|des|rsa|cipher|doFinal|token|secret|key|auth|verify|jni|native/i;
              const picked = all.methods.filter((m) => hot.test(m.sig));
              tabs.push({
                label: 'dex 方法签名 (' + all.methods.length + ')',
                view: 'table',
                data: {
                  columns: [
                    { key: 'sig', label: '方法签名' },
                    { key: 'cls', label: '类', width: 'minmax(140px,240px)' },
                    { key: 'hot', label: '关注', width: '70px' },
                  ],
                  rows: (picked.length ? picked : all.methods).slice(0, 5000).map((m) => ({
                    sig: m.sig, cls: m.cls, hot: hot.test(m.sig) ? '★' : '',
                  })),
                  name: 'dexmethods',
                  filterHint: '过滤类名/方法名（如 Cipher / encrypt / SignUtil）',
                },
              });
              stats.push({ k: '加密相关方法', v: SK.dom.fmtNum(picked.length), level: picked.length ? 'ok' : '' });
            }
          } catch (e) { /* 方法表解析失败不影响其他页签 */ }
        }
      }

      /* --- v1 签名证书 --- */
      try {
        const sigEntries = entries.filter((e) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(e.name));
        const certs = [];
        for (const se of sigEntries) {
          const derBytes = await SK.az.zipEntry(bytes, se);
          if (!derBytes) continue;
          const ci = SK.az.certInfo(derBytes);
          if (ci && ci.certs) ci.certs.forEach((c) => certs.push(Object.assign({ file: se.name }, c)));
        }
        if (certs.length) {
          tabs.push({
            label: '签名证书 (' + certs.length + ')',
            view: 'table',
            data: {
              columns: [
                { key: 'subject', label: 'Subject CN', width: 'minmax(140px,220px)' },
                { key: 'sha256', label: 'SHA-256 指纹', width: 'minmax(240px,1fr)' },
                { key: 'sha1', label: 'SHA-1' },
                { key: 'valid', label: '有效期', width: '190px' },
              ],
              rows: certs.map((c) => ({
                subject: c.subject || '（无 CN）',
                sha256: c.sha256,
                sha1: c.sha1,
                valid: (c.notBefore || '?') + ' → ' + (c.notAfter || '?'),
              })),
              name: 'apk-cert',
              filterHint: '过滤 subject / 指纹',
            },
          });
          stats.push({ k: '签名证书', v: certs.length });
          if (certs.length > 1) {
            extraNotices.push({ level: 'warn', msg: '存在 ' + certs.length + ' 个签名证书：多证书通常是「重打包/二次签名」的痕迹（v2/v3 走 APK Signing Block，这里只看 v1）' });
          }
        }
      } catch (e) { /* 证书解析失败不影响其他页签 */ }

      const summary = [
        '文件数: ' + entries.length,
        info ? '包名: ' + info.package : 'manifest: 未找到',
        info ? '版本: ' + info.versionName : '',
        packers.length ? '\n⚠ 疑似加固特征文件:\n' + packers.slice(0, 8).map((p) => '  ' + p.name).join('\n') : '',
        Object.keys(soByAbi).length ? '\nso 库:\n' + Object.keys(soByAbi).map((abi) => '  ' + abi + ': ' + soByAbi[abi].slice(0, 10).join(', ')).join('\n') : '',
      ].filter(Boolean).join('\n');

      return {
        text: summary,
        lang: 'text',
        tabLabel: '摘要',
        tabs: tabs,
        stats: stats,
        notices: (packers.length ? [{ level: 'warn', msg: '检测到加固特征（' + packers.length + ' 个文件），dex 字符串可能只是壳——需要脱壳后重分析' }] : []).concat(extraNotices),
        next: [
          { label: '🪝 Frida hook（已带包名）', tool: 'frida-lib', carry: '_pkgName', input: 0 },
          { label: '🧬 分析 lib/ 下的 so（先解压 APK）', tool: 'elf-inspect' },
        ],
        _pkgName: (info && info.package) || '',
        filename: 'apk-report',
      };
    },
  });

  /* ============================================================
   * SO / ELF 符号分析
   * ============================================================ */
  SK.tool({
    id: 'elf-inspect',
    name: 'SO 符号分析',
    group: 'android',
    icon: '🧬',
    aliases: 'elf so native arm 动态库 符号 导出 frida',
    keywords: ['elf', 'so', 'native', '符号', '导出', 'jni', 'frida', 'hook', '逆向'],
    desc: '解析 .so 动态库（ELF32/64）：导出/导入符号表（Java_native 函数一眼可见）、依赖库、节信息——frida hook 的符号都在这',
    hint: 'APK 解压后 lib/arm64-v8a/*.so 拖进来',
    inputs: [{ id: 'in', label: '.so 文件', placeholder: '拖入 ELF 动态库', sample: 'elf' , binary: true }],
    maxBytes: 209715200,
    options: [],
    help:
      '<h4>看什么</h4>' +
      '<ul><li><b>导出符号（dyn GLOBAL FUNC）</b>：<code>Java_com_xxx_MainActivity_encrypt</code> 这类 JNI 注册函数就是 native 加密入口——frida <code>Module.findExportByName()</code> 直接挂</li>' +
      '<li><b>UNDEFINED 符号</b>：导入的 libc/log/OpenSSL 函数——native 层用了什么加密库一目了然</li>' +
      '<li><b>依赖</b>：DT_NEEDED 的 so 列表</li></ul>' +
      '<h4>frida 模板</h4>' +
      '<p>「Frida Hook 模板」的 native 模板配这里找的符号名使用。</p>',
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
      if (!bytes) return { error: '无法识别输入：既不是 base64 也不是合法 hex', hint: '推荐直接把 .so 文件拖进输入框（APK 解压后 lib/arm64-v8a/ 目录）；粘贴的话需是完整文件的 base64' };
      const r = SK.az.elf(bytes);
      if (r.error) return { error: r.error };

      const dynsyms = r.symbols.filter((s) => s.kind === 'dyn');
      const exports = dynsyms.filter((s) => s.defined && s.bind !== 'LOCAL');
      const imports = dynsyms.filter((s) => !s.defined);
      const jni = exports.filter((s) => /^Java_/.test(s.name) || /RegisterNatives|JNI_OnLoad/.test(s.name));
      const allSym = r.symbols.filter((s) => s.kind === 'sym');

      const rows = (list) => list.slice(0, 8000).map((s) => ({
        name: s.name.length > 200 ? s.name.slice(0, 200) + '…' : s.name,
        bind: s.bind, type: s.type,
        /* IDA 里要靠 addr+size 才能把整个函数框出来，只给 addr 等于还得自己猜长度 */
        addr: s.value ? '0x' + s.value.toString(16) : '',
        size: s.size ? '0x' + Number(s.size).toString(16) + ' (' + s.size + ')' : '',
        def: s.defined ? '导出' : '导入',
      }));

      const summary = [
        '架构: ' + r.bits + ' 位 ' + r.machine,
        '入口: 0x' + r.entry.toString(16),
        '节: ' + r.sections.length + ' 个',
        'dynsym: ' + dynsyms.length + '（导出 ' + exports.length + ' / 导入 ' + imports.length + '）',
        jni.length ? '\nJNI 入口函数:\n' + jni.slice(0, 15).map((s) => '  ' + s.name).join('\n') : '',
        r.needed.length ? '\n依赖 so:\n  ' + r.needed.join('\n  ') : '',
      ].filter(Boolean).join('\n');

      return {
        text: summary,
        lang: 'text',
        tabLabel: '摘要',
        tabs: [
          jni.length ? { label: 'JNI 入口 (' + jni.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '函数（frida 直接 hook）' }, { key: 'addr', label: '地址', width: '110px' }], rows: rows(jni), name: 'jni' } } : null,
          { label: '导出 (' + exports.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '符号' }, { key: 'bind', label: '绑定', width: '70px' }, { key: 'type', label: '类型', width: '70px' }, { key: 'addr', label: '地址', width: '110px' }, { key: 'size', label: '大小（IDA 选框用）', width: '150px' }], rows: rows(exports), name: 'exports', filterHint: '过滤符号（encrypt / sign / JNI）' } },
          imports.length ? { label: '导入 (' + imports.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '符号（依赖的外部函数）' }], rows: rows(imports), name: 'imports', filterHint: '过滤（SSL / EVP / curl → 用了什么库）' } } : null,
          allSym.length > dynsyms.length ? { label: 'symtab (' + allSym.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '符号（含 local，未 strip 才有）' }], rows: rows(allSym), name: 'symtab' } } : null,
          (r.dataStrings && r.dataStrings.length) ? { label: '数据段字符串 (' + r.dataStrings.length + ')', view: 'table', data: { columns: [{ key: 's', label: '字符串' }, { key: 'sec', label: '所在节', width: '110px' }], rows: r.dataStrings.map((x) => ({ s: x.s.length > 240 ? x.s.slice(0, 240) + '…' : x.s, sec: x.sec })), name: 'elfstr', filterHint: '过滤（AES / http / key / sign / 错误文案）' } } : null,
          { label: '节 (' + r.sections.length + ')', view: 'table', data: { columns: [{ key: 'name', label: '节名' }, { key: 'size', label: '大小', width: '90px' }], rows: r.sections.map((s) => ({ name: s.name, size: SK.dom.fmtBytes(s.size) })), name: 'sections' } },
        ].filter(Boolean),
        stats: [
          { k: '架构', v: r.bits + '位 ' + r.machine },
          { k: '导出', v: exports.length },
          { k: '导入', v: imports.length },
          jni.length ? { k: 'JNI 函数', v: jni.length, level: 'ok' } : null,
        ].filter(Boolean),
        next: [
          { label: '🪝 生成 Frida native hook', tool: 'frida-lib' },
        ],
        filename: 'elf-report',
      };
    },
  });

  /* ============================================================
   * Frida Hook 模板库
   * ============================================================ */
  const FRIDA = [
    {
      id: 'java-hook', name: 'Java 层方法 hook（万能模板）', note: '改包名类名方法名；打印入参/返回值/堆栈',
      code: `Java.perform(function () {
  // 改这里：目标类
  var cls = Java.use('com.example.app.SignUtil');
  // 改这里：目标方法与重载数量
  cls.getSign.overloads.forEach(function (ov) {
    ov.implementation = function () {
      var args = [].slice.call(arguments).map(String);
      console.log('[*] getSign 入参: ' + args.join(', '));
      var ret = ov.apply(this, arguments);
      console.log('[*] getSign 返回: ' + ret);
      console.log(Java.use('android.util.Log').getStackTraceString(
        Java.use('java.lang.Throwable').$new()));
      return ret;
    };
  });
});`,
    },
    {
      id: 'native-hook', name: 'Native 函数 hook（JNI 导出）', note: '配「SO 符号分析」找符号名；含 jstring 打印',
      code: `// 先用 SpiderLab「SO 符号分析」找 Java_xxx 导出名
var addr = Module.findExportByName('libnative.so', 'Java_com_example_Native_encrypt');
if (addr) {
  Interceptor.attach(addr, {
    onEnter: function (args) {
      // JNI 签名：args[0]=env args[1]=thiz/clazz args[2..]=参数
      var env = Java.vm.getEnv();
      var s = env.getStringUtfChars(args[2], null).readCString();
      console.log('[*] encrypt 入参: ' + s);
      this.arg2 = args[2];
    },
    onLeave: function (ret) {
      var env = Java.vm.getEnv();
      var s = env.getStringUtfChars(ret, null).readCString();
      console.log('[*] encrypt 返回: ' + s);
    }
  });
} else {
  console.log('[-] 未找到导出，可能动态注册（RegisterNatives），hook Java_com_example.Native 的 RegisterNatives');
}`,
    },
    {
      id: 'reg-natives', name: 'RegisterNatives 拦截（动态注册 JNI）', note: 'native 函数没导出时，抓注册表拿地址',
      code: `// 拦截 JNI RegisterNatives：动态注册的 native 函数地址全打印
var RegisterNatives = Module.findExportByName('libart.so', '_ZN3art3JNI15RegisterNativesEP7_JNIEnvP7_jclassPK15JNINativeMethodi');
if (!RegisterNatives) RegisterNatives = Module.findExportByName('libart.so', 'JNI_RegisterNatives');
Interceptor.attach(RegisterNatives, {
  onEnter: function (args) {
    var env = Java.vm.getEnv();
    var className = env.getClassName(args[1]);
    var methods = args[2];
    var count = args[3].toInt32();
    console.log('[*] ' + className + ' RegisterNatives: ' + count + ' 个');
    for (var i = 0; i < count; i++) {
      var name = methods.add(i * 12).readPointer().readCString();
      var sig = methods.add(i * 12 + 4).readPointer().readCString();
      var fnPtr = methods.add(i * 12 + 8).readPointer();
      console.log('    ' + name + sig + ' -> ' + fnPtr + ' (' + DebugSymbol.fromAddress(fnPtr) + ')');
    }
  }
});`,
    },
    {
      id: 'ssl-unpin', name: 'SSL Pinning 绕过（抓包必备）', note: '绕证书锁定，配抓包工具看 https',
      code: `// 通用 SSL Pinning 绕过（okhttp / TrustManager / conscrypt）
Java.perform(function () {
  var X509TM = Java.use('javax.net.ssl.X509TrustManager');
  var TM = Java.registerClass({
    name: 'com.sp.SlimTrust', implements: [X509TM],
    methods: {
      checkClientTrusted: function () {},
      checkServerTrusted: function () {},
      getAcceptedIssuers: function () { return []; }
    }
  });
  var SSLContext = Java.use('javax.net.ssl.SSLContext');
  SSLContext.init.overload('[Ljavax.net.ssl.KeyManager;', '[Ljavax.net.ssl.TrustManager;', 'java.security.SecureRandom')
    .implementation = function (km, tm, sr) {
      console.log('[*] SSLContext.init 被调，替换 TrustManager');
      this.init(km, [TM.$new()], sr);
    };
  // okhttp CertificatePinner
  try {
    var Pinner = Java.use('okhttp3.CertificatePinner');
    Pinner.check.overload('java.lang.String', 'java.util.List').implementation = function () {
      console.log('[*] okhttp pinning check 放行');
      return;
    };
  } catch (e) {}
});`,
    },
    {
      id: 'root-bypass', name: 'Root / 模拟器检测绕过', note: '常见检测位批量放行',
      code: `Java.perform(function () {
  // Build.TAGS / test-keys
  var Build = Java.use('android.os.Build');
  Build.TAGS.value = 'release-keys';
  // Settings.Secure / su 路径 / busybox
  var SysProp = Java.use('android.os.SystemProperties');
  SysProp.get.overload('java.lang.String', 'java.lang.String').implementation = function (k, d) {
    if (/ro.build.tags|ro.debuggable|ro.secure|qemu|goldfish/i.test(k)) {
      console.log('[*] prop 检测: ' + k);
      return /tags/i.test(k) ? 'release-keys' : '0';
    }
    return this.get(k, d);
  };
  // File.exists → su/busybox
  var File = Java.use('java.io.File');
  File.exists.implementation = function () {
    var p = this.getAbsolutePath();
    if (/su|busybox|magisk|xposed|supersu/i.test(p)) {
      console.log('[*] 文件检测放行: ' + p);
      return false;
    }
    return this.exists();
  };
});`,
    },
    {
      id: 'crypto-trace', name: 'Java 加密全链路追踪', note: 'Cipher/Mac/MessageDigest 入参出参全打印',
      code: `Java.perform(function () {
  var Cipher = Java.use('javax.crypto.Cipher');
  Cipher.doFinal.overload('[B').implementation = function (input) {
    var mode = this.getOpmode ? this.getOpmode() : '?';
    var alg = this.getAlgorithm();
    console.log('[*] Cipher(' + alg + ') mode=' + mode + ' in=' + bytesToHex(input));
    var ret = this.doFinal(input);
    console.log('[*] Cipher out=' + bytesToHex(ret));
    return ret;
  };
  var MD = Java.use('java.security.MessageDigest');
  MD.digest.overload('[B').implementation = function (input) {
    console.log('[*] ' + this.getAlgorithm() + '(' + bytesToHex(input) + ')');
    return this.digest(input);
  };
  var Mac = Java.use('javax.crypto.Mac');
  Mac.doFinal.overload('[B').implementation = function (input) {
    console.log('[*] Hmac(' + this.getAlgorithm() + ') in=' + bytesToHex(input));
    return this.doFinal(input);
  };
  function bytesToHex(b) {
    if (!b) return 'null';
    var r = '';
    for (var i = 0; i < Math.min(b.length, 64); i++) r += ('0' + (b[i] & 0xff).toString(16)).slice(-2);
    return b.length > 64 ? r + '…(' + b.length + ')' : r;
  }
});`,
    },
    {
      id: 'enum-cls', name: '类/方法枚举（找目标）', note: '按关键词搜已加载的类与接口',
      code: `Java.perform(function () {
  var KW = /sign|encrypt|security|token/i; // 改关键词
  Java.enumerateLoadedClasses({
    onMatch: function (name) {
      if (KW.test(name)) console.log('[cls] ' + name);
    },
    onComplete: function () { console.log('[*] 枚举完成'); }
  });
  // 枚举某个类的全部方法（改类名后跑）
  try {
    var C = Java.use('com.example.app.SignUtil');
    var ms = C.class.getDeclaredMethods();
    for (var i = 0; i < ms.length; i++) console.log('[m] ' + ms[i].toString());
  } catch (e) {}
});`,
    },
  ];

  SK.tool({
    id: 'frida-lib',
    name: 'Frida Hook 模板',
    group: 'android',
    icon: '🪝',
    aliases: 'frida hook 安卓 java native ssl 绕过',
    keywords: ['frida', 'hook', '安卓', 'java', 'native', 'ssl', 'pinning', 'root', '模板'],
    desc: '安卓逆向高频 Frida 模板：Java 方法 hook / native JNI / RegisterNatives 抓注册表 / SSL 绕过 / root 检测绕过 / 加密全链路追踪 / 类枚举',
    hint: '填目标包名/类名自动替换占位；不填输出原模板；native 模板配「SO 符号分析」',
    inputs: [
      { id: 'pkg', label: '应用包名', placeholder: 'com.example.app', small: true, allowEmpty: true },
      { id: 'cls', label: '目标类名（简名）', placeholder: 'SignUtil', small: true, allowEmpty: true },
      { id: 'mth', label: '目标方法名', placeholder: 'getSign', small: true, allowEmpty: true },
      { id: 'so', label: 'so 库名（native 用）', placeholder: 'libnative.so', small: true, allowEmpty: true },
    ],
    allowEmpty: true,
    inline: true,
    autoExec: true,
    options: [],
    help:
      '<h4>用法</h4>' +
      '<ol><li>挑模板复制，改包名/类名/方法名/so名</li>' +
      '<li>存成 hook.js：<code>frida -U -f com.example.app -l hook.js --no-pause</code>（spawn 启动）或 <code>frida -U com.example.app -l hook.js</code>（attach）</li>' +
      '<li>native 函数名先去「SO 符号分析」找；找不到导出就用 RegisterNatives 模板抓动态注册</li></ol>' +
      '<h4>组合拳</h4>' +
      '<p>APK 分析器看组件与权限 → dex 字符串找可疑类 → 本工具 Java hook 打印入参 → 加密在 native 就转 native 模板 → 抓不到包先跑 SSL 绕过。</p>',
    handler: function (pkg, cls, mth, so) {
      /* 参数化替换：占位符 → 用户目标 */
      const PKG = String(pkg || '').trim() || 'com.example.app';
      const CLS = String(cls || '').trim() || 'SignUtil';
      const MTH = String(mth || '').trim() || 'getSign';
      const SONAME = String(so || '').trim() || 'libnative.so';
      const snake = (s) => s.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      const render = (code) => code
        .replace(/com\.example\.app/g, PKG)
        .replace(/com\.example/g, PKG.split('.').slice(0, -1).join('.') || PKG)
        .replace(/com_example_Native/g, snake(PKG) + '_' + (CLS === 'SignUtil' ? 'Native' : CLS))
        .replace(/SignUtil/g, CLS)
        .replace(/getSign/g, MTH)
        .replace(/libnative\.so/g, SONAME);
      const tabs = FRIDA.map((t) => ({
        label: t.name,
        text: '/* ' + t.note + ' */\n' + render(t.code),
        lang: 'js',
      }));
      const index = FRIDA.map((t, i) => (i + 1) + '. ' + t.name + ' — ' + t.note).join('\n');
      return {
        text: index,
        lang: 'text',
        tabLabel: '模板目录',
        tabs: tabs,
        stats: [{ k: '模板', v: FRIDA.length }],
        next: [
          { label: '🤖 分析 APK 找目标', tool: 'apk-inspect' },
          { label: '🧬 找 native 符号', tool: 'elf-inspect' },
        ],
        filename: 'frida-hook',
      };
    },
  });

  /* ============================================================
   * 安卓速查：JNI 签名 / smali / adb / 常见检测
   * ============================================================ */
  SK.tool({
    id: 'android-cheats',
    name: '安卓速查',
    group: 'android',
    icon: '📱',
    aliases: 'jni 签名 smali adb logcat android 速查',
    keywords: ['jni', '签名', 'smali', 'adb', 'logcat', '安卓', '检测', 'frida', '逆向'],
    desc: 'JNI 类型签名表（()V 怎么读）/ smali 常用指令 / adb & logcat 命令 / 安卓反调试与检测手法对照',
    inputs: [{ id: 'q', label: '查什么？输入关键词过滤全部速查表', placeholder: '如：je / 溢出 / VirtualAlloc / vtable / frida', small: true, allowEmpty: true }],
    allowEmpty: true,
    inline: true,
    autoExec: true,
    options: [],
    handler: function (q) {
      const F = SK.dom.filterTableRows;
      const JNI = [
        ['Z', 'boolean', '1 字节'],
        ['B', 'byte', ''],
        ['C', 'char', '2 字节 UTF-16'],
        ['S', 'short', ''],
        ['I', 'int', '4 字节'],
        ['J', 'long', '8 字节（注意：不是 L）'],
        ['F', 'float', ''],
        ['D', 'double', ''],
        ['V', 'void', '仅返回值'],
        ['Ljava/lang/String;', '对象（类名; 结尾）', '分号必须有'],
        ['[I', 'int[]', '[ 开头'],
        ['[[B', 'byte[][]', '二维数组'],
        ['(I[BLjava/lang/String;)V', '参数: int, byte[], String → 无返回', 'RegisterNatives 的 sig 列'],
        ['(Ljava/lang/Object;)Ljava/lang/Class;', '参数 Object → 返回 Class', 'Class.forName 的签名'],
      ];
      const SMALI = [
        ['invoke-virtual {v0, v1}, Lcls;->method(I)V', '虚调用（走 vtable）', '最常见，等 Java 调用'],
        ['invoke-super / invoke-direct', '父类调用 / 私有与构造', 'direct 不查表'],
        ['invoke-static', '静态调用', ''],
        ['iget v0, p0, Lcls;->field:I', '读实例字段', 'p0=this'],
        ['sget / sput', '静态字段读写', '单例、常量'],
        ['const-string v0, "key"', '字符串常量', '搜 smali 里的 key/secret 首选'],
        ['const/16 v0, 0x10', '数字常量', '算法魔数'],
        ['if-eqz v0, :label', '为空跳转', '判空模式'],
        ['if-ne / if-lt / if-ge', '不等/小于/大于等于', '授权判断常见'],
        ['new-instance v0, Lcls;', 'new 对象', '配合 invoke-direct <init>'],
        ['array-length v0, v1', '数组长度', ''],
        ['aget / aput', '数组读写', ''],
        ['goto / goto-16', '无条件跳', '混淆产生大量 goto'],
        ['try_start_.../try_end_...', 'try 块', '配套 :catch_xxx'],
        ['.locals 4', '局部寄存器数', ''],
      ];
      const ADB = [
        ['adb devices -l', '列设备', ''],
        ['adb install -r -t xx.apk', '安装（覆盖/允许测试）', ''],
        ['adb pull /data/data/pkg/ .', '拉应用私有目录', '需 root 或 run-as'],
        ['adb shell pm path com.xx', '查 APK 路径', '再 pull 得到真实 apk'],
        ['adb shell am start -n pkg/.MainActivity', '启动组件', 'exported 组件直接拉起'],
        ['adb shell dumpsys activity top', '当前栈顶 Activity', '找当前界面类名'],
        ['adb logcat -s TAG', '过滤 TAG 日志', '再 grep sign/key 搜密钥'],
        ['adb logcat *:E', '只看 error', ''],
        ['adb forward tcp:27042 tcp:27042', '端口转发', 'frida-server 默认 27042'],
        ['adb shell ps -A | grep xx', '找进程', ''],
        ['adb shell su -c "cat /proc/pid/maps"', '看内存映射', '找 so 基址'],
        ['adb shell settings get secure android_id', '设备 ID', ''],
        ['frida-ps -U / frida -U -f pkg -l hook.js', 'frida 常用', '配「Frida 模板」工具'],
        ['objection -g pkg explore', 'objection 交互', '一键绕 SSL/root'],
        ['jadx-gui xx.apk / apktool d xx.apk', '反编译', 'jadx 看 java，apktool 改资源回编'],
      ];
      const DETECT = [
        ['packageManager.getInstallerInfo', '安装来源', '官方渠道校验'],
        ['Settings.Secure.ANDROID_ID / TelephonyManager', '设备指纹', 'getDeviceId/getImei'],
        ['Build.FINGERPRINT / MODEL', '模拟器特征', 'sdk_gphone/generic'],
        ['Emulator: qemu、goldfish、no phone', '模拟器文件/属性', '/dev/qemu_pipe 存在'],
        ['frida-server 端口 27042 / maps 找 frida', 'frida 检测', '改端口+改 so 名绕'],
        ['/data/local/tmp 可写', 'root 检测', ''],
        ['su / busybox / magisk 文件存在', 'root 检测', 'Java hook File.exists 放行'],
        ['apk 签名 v2 校验（CRC）', '自校验', '改重打包后闪退的元凶'],
        ['Debug.isDebuggerConnected()', '调试检测', 'frida 置 false'],
        ['onPause 时 FLAG_SECURE', '截屏防护', ''],
        ['SafetyNet / Play Integrity', 'Google 校验', '复杂，需专门绕'],
      ];
      const mk = (rows) => rows.map(([a, b, c]) => ({ k: a, v: b, note: c }));
      return {
        text: 'JNI 签名 ' + JNI.length + ' · smali ' + SMALI.length + ' · adb/frida ' + ADB.length + ' · 检测 ' + DETECT.length,
        lang: 'text',
        tabLabel: '目录',
        tabs: [
          { label: 'JNI 类型签名 (' + (F(mk(JNI),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '签名', width: 'minmax(180px,260px)' }, { key: 'v', label: '类型' }, { key: 'note', label: '备注' }], rows: F(mk(JNI), q), name: 'jni' } },
          { label: 'smali 指令 (' + (F(mk(SMALI),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '指令', width: 'minmax(240px,340px)' }, { key: 'v', label: '含义' }, { key: 'note', label: '备注' }], rows: F(mk(SMALI), q), name: 'smali', filterHint: '搜：invoke / const / if' } },
          { label: 'adb / frida (' + (F(mk(ADB),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '命令', width: 'minmax(240px,320px)' }, { key: 'v', label: '作用' }, { key: 'note', label: '备注' }], rows: F(mk(ADB), q), name: 'adb' } },
          { label: '检测与对抗 (' + (F(mk(DETECT),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '检测点', width: 'minmax(200px,280px)' }, { key: 'v', label: '原理' }, { key: 'note', label: '对策' }], rows: F(mk(DETECT), q), name: 'detect' } },
        ].filter(function (t) { return !t.data || !t.data.rows || t.data.rows.length > 0; }),
        stats: [{ k: '条目', v: JNI.length + SMALI.length + ADB.length + DETECT.length }],
        next: [
          { label: '🪝 Frida 模板配合用', tool: 'frida-lib' },
          { label: '🤖 先分析 APK', tool: 'apk-inspect' },
        ],
        filename: 'android-cheats',
      };
    },
  });

})();
