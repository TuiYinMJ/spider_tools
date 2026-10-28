/* ============================================================================
   Spider Lab · pc2.js
   PC 逆向速查集：汇编指令集（JCC 全表/x86/x64/ARM64）、Win32 API 分类、
   C/C++ 逆向模式（调用约定/虚表/STL/异常/RTTI/MFC/mangled）
   ========================================================================== */
(function () {

  /* ============================================================
   * 汇编指令集速查
   * ============================================================ */
  SK.tool({
    id: 'asm-cheats',
    name: '汇编指令速查',
    group: 'pc',
    icon: '⚙',
    aliases: 'asm 汇编 x86 x64 arm arm64 jcc 指令 条件跳转',
    keywords: ['汇编', 'asm', 'x86', 'x64', 'arm', 'arm64', 'jcc', '指令', '逆向'],
    desc: 'x86/x64 指令速查 + JCC 条件跳转全表（含标志位含义）+ ARM64 常用指令（安卓 so 逆向）',
    inputs: [{ id: 'q', label: '查什么？输入关键词过滤全部速查表', placeholder: '如：je / 溢出 / VirtualAlloc / vtable / frida', small: true, allowEmpty: true }],
    allowEmpty: true,
    inline: true,
    autoExec: true,
    options: [],
    help: '<h4>怎么用</h4><p>逆向时在 IDA/x64dbg 里看到不熟的指令来查；JCC 表配合 <code>cmp/test</code> 理解条件；ARM64 表配 Frida hook so 时读反汇编。</p>',
    handler: function (q) {
      const F = SK.dom.filterTableRows;
      /* JCC 全表：助记符 | 条件 | 标志位 | 跳转时机 */
      const JCC = [
        ['JO', '溢出', 'OF=1', '有符号运算溢出时'],
        ['JNO', '无溢出', 'OF=0', ''],
        ['JB / JC / JNAE', '低于 / 进位', 'CF=1', '无符号比较 小于'],
        ['JAE / JNB / JNC', '高于等于 / 无进位', 'CF=0', '无符号比较 ≥'],
        ['JE / JZ', '相等 / 零', 'ZF=1', 'cmp 相等 / 结果为 0'],
        ['JNE / JNZ', '不相等 / 非零', 'ZF=0', '最常见：不相等继续'],
        ['JBE / JNA', '低于等于', 'CF=1 或 ZF=1', '无符号 ≤'],
        ['JA / JNBE', '高于', 'CF=0 且 ZF=0', '无符号 >'],
        ['JS', '负', 'SF=1', '结果符号位为 1'],
        ['JNS', '非负', 'SF=0', ''],
        ['JP / JPE', '偶', 'PF=1', '1 的个数为偶（少用）'],
        ['JNP / JPO', '奇', 'PF=0', ''],
        ['JL / JNGE', '小于（带符号）', 'SF≠OF', '有符号 <'],
        ['JGE / JNL', '大于等于（带符号）', 'SF=OF', '有符号 ≥'],
        ['JLE / JNG', '小于等于（带符号）', 'ZF=1 或 SF≠OF', '有符号 ≤'],
        ['JG / JNLE', '大于（带符号）', 'ZF=0 且 SF=OF', '有符号 >'],
      ];
      const X86 = [
        ['mov dst,src', '传送', 'mov eax,[rbp+8] 取参数'],
        ['lea dst,[addr]', '取地址（不读内存）', 'lea rax,[rbp-30] 取局部变量地址'],
        ['movzx / movsx', '零扩展 / 符号扩展传送', 'movzx eax, byte ptr [rsi]'],
        ['push / pop', '压栈 / 出栈', 'x64 前 32 字节影子空间，参数走寄存器'],
        ['call / ret', '调用 / 返回', 'ret n 是 stdcall 清栈'],
        ['add / sub / imul / idiv', '算术', 'idiv 前 cdq 符号扩展edx'],
        ['inc / dec / neg', '自增 / 自减 / 取反', 'inc dword ptr [rip+var]'],
        ['and / or / xor / not', '位运算', 'xor eax,eax 清零（常见）'],
        ['shl / shr / sar', '左移 / 逻辑右移 / 算术右移', 'shr eax,3 = 除以 8'],
        ['rol / ror / rcl / rcr', '循环移位', '加密常见（混淆位运算）'],
        ['test a,b', '按位与置标志（不写回）', 'test eax,eax → JZ 为空判断'],
        ['cmp a,b', '相减置标志（不写回）', 'cmp eax,[rbx] 后接 JCC'],
        ['cdq / cqo', 'eax 符号扩展到 edx:eax', '除法前奏'],
        ['xchg', '交换', 'xchg eax,ebx'],
        ['nop / multi-nop', '空指令', '填充/对齐；nop 区可能是抹掉的代码'],
        ['int 3 (0xCC)', '断点指令', '反调试会扫描 CC'],
        ['sysenter / syscall', '系统调用', '直接进内核（绕过 API hook）'],
        ['rep movsb / stosb', '串操作（批量拷贝/填充）', 'rep movsq 配 rdi/rsi/rcx'],
        ['lock 前缀', '原子操作', 'lock inc [mem] 多线程计数'],
        ['cpuid', 'CPU 信息', '虚拟机检测（厂商字符串）'],
        ['rdtsc', '读时间戳计数器', '反调试：测量执行时间差'],
        ['内存寻址', '[base + index*scale + disp]', 'x64: [rip+disp32] 相对寻址（位置无关）'],
      ];
      const ARM64 = [
        ['adrp x0, page', '取 4KB 页地址（位置无关）', 'so 里取全局：adrp x0,#0x1000; add x0,x0,#0x10'],
        ['add / sub', '加减', 'add x0, x1, x2'],
        ['mov / movz / movk', '传送 / 装立即数', 'movz w0,#0x1234; movk w0,#0x5678,lsl #16'],
        ['ldr / ldur / ldp', '读内存（单/非对齐/对）', 'ldr x0,[sp,#0x10]; ldp x29,x30,[sp]（函数收尾）'],
        ['str / stp', '写内存', 'stp x29,x30,[sp,#-0x10]!（函数序言，frida 断点好位置）'],
        ['bl / blr / br / ret', '调用（链接/寄存器/跳转/返回）', 'blr x8 = 动态调用（hook 点）'],
        ['cbz / cbnz', '为 0 / 非 0 跳转', 'cbz x0, ret 空(NULL)检查'],
        ['tbz / tbnz', '测试位跳转', 'tbz w0, #3, ...'],
        ['cmp / tst', '比较 / 位测试', '之后接 b.eq/b.ne 等条件跳'],
        ['b.eq/b.ne/b.lt/...', '条件跳转（=JCC）', 'b.hi 无符号大于'],
        ['adr', '读地址（小范围）', 'adr x0, loc_XXXX'],
        ['lsr / lsl / asr', '移位', 'lsr x0, x0, #4'],
        ['sxtw / uxtw', '符号/零扩展', 'w→x 扩展'],
        ['msub / madd', '乘减/乘加', '哈希运算常见'],
        ['rev / rev16 / rev32', '字节序反转', '大小端转换（网络协议解析）'],
        ['ldp x29,x30,[sp],#0x10', '弹栈返回（add 后缀）', '函数 epilogue 识别'],
      ];
      const regInfo = [
        ['x64 通用', 'rax(返回值) rcx/rdx/r8/r9(参数1-4) rbp(栈帧) rsp(栈顶) rdi/rsi/rdx/rcx=SysV参数', 'x64 Windows 与 Linux 调用约定不同'],
        ['x86 常用', 'eax(返回) ecx(this) edx ebx esi edi ebp esp', 'fastcall: ecx+edx'],
        ['ARM64', 'x0-x7(参数/返回) x29(fp) x30(lr) sp', 'x0 同时是返回值；x30 是返回地址'],
        ['标志位', 'ZF(零) SF(符号) CF(进位) OF(溢出) PF(奇偶)', 'JCC 全看这些'],
      ];
      return {
        text: 'JCC ' + JCC.length + ' 条 · x86/x64 ' + X86.length + ' 条 · ARM64 ' + ARM64.length + ' 条 · 寄存器 ' + regInfo.length + ' 组',
        lang: 'text',
        tabLabel: '目录',
        tabs: [
          { label: 'JCC 条件跳转全表 (' + (F(JCC.map(x=>({op:x[0],cond:x[1],flags:x[2],note:x[3]})),q)).length + ')', view: 'table', data: { columns: [{ key: 'op', label: '助记符', width: 'minmax(120px,170px)' }, { key: 'cond', label: '含义', width: 'minmax(110px,140px)' }, { key: 'flags', label: '标志位', width: '110px' }, { key: 'note', label: '说明' }], rows: F(JCC.map(([op, cond, flags, note]) => ({ op, cond, flags, note })), q), name: 'jcc', filterHint: '搜：相等 / 进位 / signed' } },
          { label: 'x86/x64 指令 (' + (F(X86.map(x=>({op:x[0],cond:x[1],note:x[2]})),q)).length + ')', view: 'table', data: { columns: [{ key: 'op', label: '指令', width: 'minmax(160px,220px)' }, { key: 'cond', label: '作用', width: 'minmax(130px,170px)' }, { key: 'note', label: '说明 / 逆向要点' }], rows: F(X86.map(([op, cond, note]) => ({ op, cond, note })), q), name: 'x86', filterHint: '搜：lea / xor / rdtsc / syscall' } },
          { label: 'ARM64 指令 (' + (F(ARM64.map(x=>({op:x[0],cond:x[1],note:x[2]})),q)).length + ')', view: 'table', data: { columns: [{ key: 'op', label: '指令', width: 'minmax(180px,240px)' }, { key: 'cond', label: '作用', width: 'minmax(150px,180px)' }, { key: 'note', label: '说明 / so 逆向要点' }], rows: F(ARM64.map(([op, cond, note]) => ({ op, cond, note })), q), name: 'arm64', filterHint: '搜：adrp / stp / blr' } },
          { label: '寄存器与标志', view: 'table', data: { columns: [{ key: 'op', label: '组', width: '90px' }, { key: 'cond', label: '寄存器' }, { key: 'note', label: '备注' }], rows: F(regInfo.map(([op, cond, note]) => ({ op, cond, note })), q), name: 'regs' } },
        ].filter(function (t) { return !t.data || !t.data.rows || t.data.rows.length > 0; }),
        stats: [{ k: '条目', v: JCC.length + X86.length + ARM64.length }],
        next: [
          { label: '📋 配套：调试速查', tool: 'debug-cheats' },
          { label: '🪟 PE 导入表找 API', tool: 'pe-inspect' },
        ],
        filename: 'asm-cheats',
      };
    },
  });

  /* ============================================================
   * Win32 API 分类速查
   * ============================================================ */
  SK.tool({
    id: 'winapi-cheats',
    name: 'Win32 API 速查',
    group: 'pc',
    icon: '🧾',
    aliases: 'win32 api windows 调用 进程 内存 文件 注册表 网络',
    keywords: ['win32', 'api', 'windows', '进程', '内存', '文件', '注册表', '网络', '加密', '注入'],
    desc: 'Win32 API 按逆向场景分类：内存/进程线程/模块/文件/注册表/网络/加密/反调试/注入/驱动，附「看到这个 API 意味着什么」',
    inputs: [{ id: 'q', label: '查什么？输入关键词过滤全部速查表', placeholder: '如：je / 溢出 / VirtualAlloc / vtable / frida', small: true, allowEmpty: true }],
    allowEmpty: true,
    inline: true,
    autoExec: true,
    options: [],
    handler: function (q) {
      const F = SK.dom.filterTableRows;
      const CATS = [
        ['内存', [
          ['VirtualAlloc / VirtualProtect', '申请/改权限内存', 'RWX 申请 → 解壳/自解密；PAGE_EXECUTE_READWRITE 是注入特征'],
          ['HeapAlloc / HeapCreate', '堆分配', '大量小对象'],
          ['ReadProcessMemory / WriteProcessMemory', '跨进程读写', '外挂/注入器标配；配合 OpenProcess 用'],
          ['CreateRemoteThread', '远程线程注入', '经典 DLL 注入三件套'],
          ['MapViewOfFile / CreateFileMapping', '内存映射文件', '大文件处理 / 进程间共享'],
        ]],
        ['进程与线程', [
          ['CreateProcess / WinExec / ShellExecute', '启动进程', '拉起子进程 / 自更新'],
          ['OpenProcess', '打开进程', '看权限参数：PROCESS_ALL_ACCESS 配 RPM/WPM'],
          ['CreateThread / _beginthreadex', '创建线程', '多线程加密/工作线程'],
          ['TerminateProcess / ExitProcess', '结束', '自毁逻辑'],
          ['GetModuleHandle / GetModuleFileName', '取模块基址/路径', '自定位'],
          ['EnumProcesses / CreateToolhelp32Snapshot', '枚举进程', '反调试找 OD/x64dbg 进程'],
        ]],
        ['模块与导出', [
          ['LoadLibrary / LoadLibraryEx', '加载 DLL', 'A/W 后缀注意；加载自家解密 DLL'],
          ['GetProcAddress', '取函数地址', '动态 API（静态导入表看不到）→ hook 藏这'],
          ['FreeLibrary', '卸载', ''],
          ['GetProcAddress+LdrLoadDll', 'nt 层加载', '绕过用户层监控'],
        ]],
        ['文件与目录', [
          ['CreateFile / CreateFileW', '打开/创建文件', 'W 版本现代程序标配；看共享模式参数'],
          ['ReadFile / WriteFile / SetFilePointer', '读写定位', '自定义文件格式解析'],
          ['GetFileSize / FindFirstFile', '大小 / 枚举', '文件遍历'],
          ['GetTempPath / GetWindowsDirectory', '系统目录', '释放文件位置'],
          ['DeleteFile / MoveFileEx', '删除/移动', '自删除（MoveFileEx 延迟删除）'],
          ['SHGetFolderPath / SHGetKnownFolderPath', '特殊目录', '桌面/AppData 落地'],
        ]],
        ['注册表与配置', [
          ['RegOpenKeyEx / RegCreateKeyEx', '开键', 'HKLM/Software/xxx 注册信息'],
          ['RegQueryValueEx / RegSetValueEx', '读写值', '配置/授权信息常藏这'],
          ['RegDeleteKey / RegEnumKeyEx', '删/枚举', ''],
        ]],
        ['网络', [
          ['WSAStartup / socket / connect / send / recv', 'BSD socket', 'C++ 原始网络'],
          ['WinHttpOpen / WinHttpSendRequest / WinHttpReadData', 'WinHTTP', '现代 HTTPS 请求（断点热点）'],
          ['InternetOpenA / HttpSendRequestA', 'WinINet', '老程序；URLDownloadToFile 拉文件'],
          ['getaddrinfo / gethostbyname', 'DNS', '域名解析（hosts 劫持检测点）'],
          ['InternetCrackUrl / WinHttpCrackUrl', '拆 URL', '协议分析前奏'],
        ]],
        ['加密与编码', [
          ['CryptAcquireContext / CryptGenKey', 'CSP 上下文/密钥', 'CryptoAPI 系列入口'],
          ['CryptEncrypt / CryptDecrypt', '加解密', '断点看参数：hKey/buffer/dwLen'],
          ['CryptCreateHash / CryptHashData', '哈希', 'MD5/SHA 由 algid 定'],
          ['BCryptOpenAlgorithmProvider / BCryptEncrypt', 'CNG（新）', 'Win7+ 程序用 BCrypt 居多'],
          ['System.Security.Cryptography（.NET）', '托管加密', '用 dnSpy 而不是 x64dbg'],
        ]],
        ['反调试与检测', [
          ['IsDebuggerPresent', 'PEB 调试标志', '最常见；ScyllaHide 直接过'],
          ['CheckRemoteDebuggerPresent', '远程检测', '传自身句柄'],
          ['NtQueryInformationProcess', 'ProcessDebugPort', '返回非 0 = 被调'],
          ['OutputDebugString', '调试器存在异常', ''],
          ['GetTickCount / QueryPerformanceCounter / GetSystemTime', '时间差', '单步执行变慢被测出'],
          ['FindWindow / EnumWindows', '找调试器窗口', '按类名找 OLLYDBG / x64dbg'],
          ['CreateMutex', '互斥体', '单实例 + 授权标记（破解常改返回）'],
        ]],
        ['注入与 HOOK', [
          ['SetWindowsHookEx', '消息钩子注入', '键盘记录/全局注入'],
          ['WriteProcessMemory + CreateRemoteThread', '远程注入三件套', '配 VirtualAllocEx'],
          ['QueueUserAPC / SetThreadContext', 'APC/上下文注入', '无模块注入'],
          ['NtMapViewOfSection', '跨进程映射', '恶意注入高级形态'],
          ['SetWindowsHookEx / GetProcAddress', 'IAT/EAT hook 前奏', 'inline hook 找 hook 引擎'],
        ]],
        ['驱动与底层', [
          ['DeviceIoControl', '驱动通信', 'ring3↔ring0 通道（保护/外挂）'],
          ['OpenSCManager / CreateService', '服务管理', '驱动加载（SERVICE_KERNEL_DRIVER）'],
          ['NtCreateFile(\Device/xxx)', '设备打开', '直接设备名通信'],
        ]],
        ['界面与字符串', [
          ['MessageBoxA/W', '弹窗', '破解定位神器：字符串→引用→跳转'],
          ['GetWindowText / SetWindowText', '窗口文本', '找注册码显示框'],
          ['LoadString / FindResource', '资源', '字符串在资源段里'],
          ['lstrlen / wsprintf', '字符串', '老程序格式化'],
        ]],
      ];
      const tabs = CATS.map(([cat, rows]) => {
        const FR = F(rows.map(x => ({ api: x[0], what: x[1], why: x[2] })), q);
        return {
        label: cat + ' (' + FR.length + ')',
        view: 'table',
        data: {
          columns: [{ key: 'api', label: 'API', width: 'minmax(210px,290px)' }, { key: 'what', label: '作用', width: 'minmax(120px,150px)' }, { key: 'why', label: '逆向时意味着' }],
          rows: F(rows.map(([api, what, why]) => ({ api, what, why })), q),
          name: 'api-' + cat,
          filterHint: '过滤 API 名 / 用途',
        },
        };
      }).filter(t => !/(0)/.test(t.label));
      const total = CATS.reduce((a, c) => a + c[1].length, 0);
      return {
        text: CATS.map(([c, rows]) => c + ': ' + rows.length).join('\n'),
        lang: 'text',
        tabLabel: '分类目录',
        tabs: tabs,
        stats: [{ k: '分类', v: CATS.length }, { k: 'API', v: total }],
        next: [
          { label: '🪟 PE 导入表对照', tool: 'pe-inspect' },
          { label: '📋 反调试对策表', tool: 'debug-cheats' },
        ],
        filename: 'winapi-cheats',
      };
    },
  });

  /* ============================================================
   * C/C++ 逆向模式速查（含 MFC / STL / 调用约定 / mangled）
   * ============================================================ */
  SK.tool({
    id: 'cpp-cheats',
    name: 'C/C++ 逆向模式',
    group: 'pc',
    icon: '🎼',
    aliases: 'c++ cpp 虚表 vtable stl 调用约定 mfc 异常 rtti mangled',
    keywords: ['c++', 'cpp', '虚函数', 'vtable', 'stl', 'string', 'vector', '调用约定', 'thiscall', 'mfc', '异常', 'rtti', 'mangled', '逆向'],
    desc: 'IDA/x64dbg 里认 C++ 代码：虚函数表 / STL 容器布局 / 调用约定（thiscall/fastcall）/ 异常与 SEH / RTTI / MFC 消息映射 / mangled 名解读',
    inputs: [{ id: 'q', label: '查什么？输入关键词过滤全部速查表', placeholder: '如：je / 溢出 / VirtualAlloc / vtable / frida', small: true, allowEmpty: true }],
    allowEmpty: true,
    inline: true,
    autoExec: true,
    options: [],
    handler: function (q) {
      const F = SK.dom.filterTableRows;
      const CALLING = [
        ['cdecl', '参数右→左压栈，调用者清栈', 'C 默认；ret 后调用方 add esp,N', 'x86 最常见'],
        ['stdcall', '参数压栈，被调清栈', 'ret N；Win32 API 全是', 'kernel32 等导出都带 stdcall'],
        ['thiscall', 'ecx=this，参数压栈', 'MSVC 成员函数', 'IDA 里看到 ecx 先被赋值→构造函数/成员调用'],
        ['fastcall', 'ecx,edx 传前两参', 'MSVC / 编译器内部', ''],
        ['x64 Windows', 'rcx,rdx,r8,r9 + 栈；调用者预留 32 字节影子空间（与 rax 无关，rax 是返回值）', '统一一种', '前 4 参看寄存器即可；栈参数从 [rsp+0x28] 起'],
        ['x64 SysV(Linux)', 'rdi,rsi,rdx,rcx,r8,r9', 'Linux/macOS', 'IDA 本地分析 so 时'],
        ['ARM64', 'x0-x7', 'this 在 x0', '安卓 native：x0=this'],
      ];
      const PATTERNS = [
        ['虚函数表 vtable', '类头部存 vptr；调用形如 mov rax,[rcx]; call [rax+0x18]', 'mov rax,[rcx] = 取 vtable；call [rax+N] 的 N/8 = 第 N/8 个虚函数（IDA F5 直接显示调用）', '识别类继承层次：多个对象共享 vtable'],
        ['构造/析构', '构造：分配后先赋 vptr（mov [rcx], offset vtable）；析构：尾调用 operator delete', '连续两个 vtable 赋值 = 多继承/继承链构造', '析构标 deleting destructor（vector deleting dtor）'],
        ['std::string (MSVC)', 'SSO：≤15 字节内联在 buf[16]；>15 转 ptr+size+capacity 联合体，共 32 字节', '[对象+0x10]=size [对象+0x18]=capacity（SSO 时）', 'IDA 里 sub_xxx(std::string) 一眼可辨'],
        ['std::vector', '三指针布局：_Myfirst/_Mylast/_Myend（24 字节）', '[obj+0]=begin [+8]=end [+16]=cap；end-begin=size*元素大小', '遍历 vector = 读前两指针'],
        ['std::map/set', '红黑树：头节点 + size；节点 [color,ptr,ptr,ptr,key,val]', '遍历走中序；key 在 +0x20 附近（MSVC）', ''],
        ['std::shared_ptr', '对象指针 + 控制块指针（16 字节）', '[obj+8]=控制块，[控制块+8]=强引用计数', ''],
        ['new / delete', 'operator new → malloc 封装；小分配走低配堆', '断点 operator new 抓分配调用栈', ''],
        ['lambda', '编译成匿名类：捕获变量在成员，operator() 是函数', '传 this 即捕获上下文', 'std::function 调用更绕（间接两层）'],
      ];
      const EXCEPTIONS = [
        ['x86 SEH', 'FS:[0] 异常链；scasb/cmp 序列 = try 块', '__except_handler；IDA 标 SEH_proc', '壳爱用 SEH 做控制流混淆'],
        ['x64 SEH', '.pdata/.xdata 表（RIP 相对）', '异常不占栈；unwind 信息可查表', 'IDA 自动解析'],
        ['C++ try/catch (MSVC)', '调用 __CxxFrameHandler；catch 表在函数数据', 'F5 直接还原 try/catch', 'throw = _CxxThrowException@8'],
        ['C++ 异常对象', 'throw 时构造临时对象 + 类型描述', '断 CxxThrowException 看 rdx=异常对象', ''],
        ['setjmp/longjmp', '非局部跳转', '壳/反调试的迷惑跳转', ''],
      ];
      const RTTI = [
        ['??_R0', 'type_info 描述（RTTI）', 'IDA Type Library 自动恢复类名', 'GF 表（complete object locator）'],
        ['??_R3 / ??_R2', '继承层次描述符', '还原多继承结构', ''],
        ['??_7', 'vtable 标记（mangled）', 'IDA 里 ??_7class@@6B@ = class 的 vtable', '类名直接可读'],
        ['??0 / ??1', '构造 / 析构', '??0Class@@QEAA@XZ = Class::ctor()', '重载参数在 @@ 后'],
        ['??_D', 'vector deleting destructor', '统一析构入口（delete p 调它）', ''],
        ['mangled 速记', '?name@@class+参数签名@Z', '?F@@YAXH@Z = void __cdecl F(int)', '用工具：demangler.com / IDA 快捷键'],
      ];
      const MFC = [
        ['BEGIN_MESSAGE_MAP', '展开为静态 messageMap 数组（{{类,基类},{msg,fn},...}）', '二进制里找 AfxMsgMap 结构，每项 {UINT msg, void* fn}', '拿到消息号→处理函数映射，破解按钮逻辑从这进'],
        ['AfxWndProc', 'MFC 总窗口过程', '全局 hook 它能看所有消息', ''],
        ['ON_BN_CLICKED(1001, OnOK)', '按钮点击→ OnOK', '1001=控件ID；找 IDA 里的 xref', ''],
        ['DoDataExchange / DDX_', '控件↔变量绑定', '改界面初值看这', ''],
        ['CWinApp::InitInstance', '程序入口逻辑', 'MFC 真正 main', ''],
        ['CString', '宽字符封装（类似 std::wstring）', 'CStringA 多字节版', ''],
        ['AfxMessageBox', 'MFC 弹窗', '同 MessageBox 定位法', ''],
        ['文档/视图', 'CDocument + CView', '数据与显示分离；数据操作找 CDocument 派生', ''],
      ];
      const IDENT = [
        ['字符串引用', 'IDA Shift+F12 搜错误提示/成功提示', '中文提示是最好突破口', '破解 90% 从这开始'],
        ['常量识别算法', '0x67452301/0xEFCDAB89=MD5；0x9E3779B9=TEA；0xC24B8B70=SHA256', '看到魔数直接认算法', '配合「哈希识别」工具'],
        ['密码学特征', '循环移位+异或+查 S 盒（0x63,0x7C...）=AES', 'S 盒/常量表是强特征', ''],
        ['游戏/软件保护', 'kernel32.CreateMutex + 注册表 HKLM/Software/xx/License', '授权校验点', ''],
        ['优化痕迹', '循环展开/内联/常量折叠', 'O2 编译，变量进寄存器，F5 更可读', ''],
      ];
      const mk = (rows) => rows.map(([a, b, c, d]) => ({ k: a, v: b, note: c, tip: d }));
      return {
        text: '调用约定 ' + CALLING.length + ' · 模式 ' + PATTERNS.length + ' · 异常 ' + EXCEPTIONS.length + ' · RTTI/mangled ' + RTTI.length + ' · MFC ' + MFC.length + ' · 识别技巧 ' + IDENT.length,
        lang: 'text',
        tabLabel: '目录',
        tabs: [
          { label: '调用约定 (' + (F(mk(CALLING),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '约定', width: 'minmax(100px,130px)' }, { key: 'v', label: '规则', width: 'minmax(180px,240px)' }, { key: 'note', label: '识别特征' }, { key: 'tip', label: '备注' }], rows: F(mk(CALLING), q), name: 'calling' } },
          { label: 'C++ 模式识别 (' + (F(mk(PATTERNS),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '结构', width: 'minmax(120px,160px)' }, { key: 'v', label: '布局/机制' }, { key: 'note', label: 'IDA/x64dbg 里长什么样' }, { key: 'tip', label: '技巧' }], rows: F(mk(PATTERNS), q), name: 'cpp', filterHint: '搜：vtable / string / vector / lambda' } },
          { label: '异常与 SEH (' + (F(mk(EXCEPTIONS),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '机制', width: 'minmax(130px,170px)' }, { key: 'v', label: '原理' }, { key: 'note', label: '识别' }, { key: 'tip', label: '' }], rows: F(mk(EXCEPTIONS), q), name: 'seh' } },
          { label: 'RTTI / mangled (' + (F(mk(RTTI),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '符号', width: 'minmax(90px,110px)' }, { key: 'v', label: '含义' }, { key: 'note', label: '利用' }, { key: 'tip', label: '' }], rows: F(mk(RTTI), q), name: 'rtti' } },
          { label: 'MFC (' + (F(mk(MFC),q)).length + ')', view: 'table', data: { columns: [{ key: 'k', label: '元素', width: 'minmax(170px,220px)' }, { key: 'v', label: '机制' }, { key: 'note', label: '逆向切入点' }, { key: 'tip', label: '' }], rows: F(mk(MFC), q), name: 'mfc', filterHint: '搜：消息 / 按钮 / 弹窗' } },
          { label: '快速识别技巧', view: 'table', data: { columns: [{ key: 'k', label: '技巧', width: 'minmax(110px,150px)' }, { key: 'v', label: '方法' }, { key: 'note', label: '说明' }, { key: 'tip', label: '' }], rows: F(mk(IDENT), q), name: 'ident' } },
        ].filter(function (t) { return !t.data || !t.data.rows || t.data.rows.length > 0; }),
        stats: [{ k: '条目', v: CALLING.length + PATTERNS.length + EXCEPTIONS.length + RTTI.length + MFC.length + IDENT.length }],
        next: [
          { label: '⚙ 汇编指令对照', tool: 'asm-cheats' },
          { label: '🧾 Win32 API 速查', tool: 'winapi-cheats' },
        ],
        filename: 'cpp-cheats',
      };
    },
  });
})();
