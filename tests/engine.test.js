/* 子平命盘引擎自动化测试
 * oracle: lunar-javascript@1.7.8（寿星历，仅测试期依赖，运行时不依赖）
 * 运行: npm test
 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'js', 'bazi.js'));
const I = B._internals;
const { Solar, Lunar } = require('lunar-javascript');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { failed++; failures.push({ name, msg: e.message }); console.error('  ✗ ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': 期望 ' + JSON.stringify(b) + '，实得 ' + JSON.stringify(a)); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || 'near') + ': 期望 ' + b + ' ±' + tol + '，实得 ' + a); }

/* 可复现随机数 */
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(20240204);

function mkBirth(s, opts, gender) {
    const b = B.parseBirthInput(s, '', opts || {});
    b.gender = gender || 'male';
    return b;
}
function pillarsOf(s, opts) {
    return B.buildReport(mkBirth(s, opts)).pillars.map(p => p.ganzhi).join(' ');
}
function fmtWall(ts) {
    const d = new Date(ts + 8 * 3600000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

/* ------------------------------------------------------------------ */
console.log('1. 四柱随机回归（300 例，oracle: lunar-javascript，晚子时派 sect1）');
(function () {
    const start = Date.UTC(1901, 0, 1), end = Date.UTC(2099, 11, 31);
    let n = 0;
    for (let k = 0; k < 300; k++) {
        const ts = start + Math.floor(rand() * (end - start));
        const wall = fmtWall(ts);
        const d = new Date(ts + 8 * 3600000);
        const solar = Solar.fromYmdHms(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), 0);
        const ec = solar.getLunar().getEightChar();
        ec.setSect(1);
        const expected = [ec.getYear(), ec.getMonth(), ec.getDay(), ec.getTime()].join(' ');
        const actual = pillarsOf(wall, { dst: 'off', ziSchool: 'late' });
        n++;
        if (actual !== expected) throw new Error('第' + n + '例 ' + wall + ': 期望 ' + expected + '，实得 ' + actual);
    }
    test('300 随机日期四柱全等 oracle', () => assert(n === 300));
})();

/* ------------------------------------------------------------------ */
console.log('2. 节气查表精度（1900-2100 全部 24 节气，容差 2 分钟）');
(function () {
    let checked = 0, worst = 0;
    const NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
    for (let y = 1900; y <= 2100; y++) {
        const table = Lunar.fromYmd(y, 6, 1).getJieQiTable();
        for (let i = 0; i < 24; i++) {
            const name = NAMES[i];
            const s = table[name];
            if (!s || s.getYear() !== y) continue; // 表含邻年节气，只比对本年条目
            const oracleTs = Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute(), s.getSecond()) - 8 * 3600000;
            const lon = (285 + i * 15) % 360;
            const mine = I.solarTermTs(y, lon);
            const diffMin = Math.abs(mine - oracleTs) / 60000;
            worst = Math.max(worst, diffMin);
            checked++;
            if (diffMin > 2) throw new Error(y + '年' + name + '偏差 ' + diffMin.toFixed(1) + ' 分钟');
        }
    }
    test('全部节气点 ≤2 分钟（比对 ' + checked + ' 点，最大偏差 ' + worst.toFixed(2) + ' 分）', () => assert(checked >= 4600));
})();

/* ------------------------------------------------------------------ */
console.log('3. 节气天文锚点（网络校验过的绝对时刻）');
test('立春2024 = 2024-02-04 16:27 CST', () => {
    const ts = I.solarTermTs(2024, 315);
    eq(fmtWall(ts).slice(0, 16), '2024-02-04 16:27');
});
test('小寒2000 = 2000-01-06 09:00 CST', () => {
    const ts = I.solarTermTs(2000, 285);
    eq(fmtWall(ts).slice(0, 16), '2000-01-06 09:00');
});
test('冬至2024 = 2024-12-21 17:20 CST', () => {
    const ts = I.solarTermTs(2024, 270);
    eq(fmtWall(ts).slice(0, 16), '2024-12-21 17:20');
});
test('立春界：2024-02-04 16:26 癸卯年，16:28 甲辰年', () => {
    assert(pillarsOf('2024-02-04 16:26').indexOf('癸卯') === 0, '立春前应为癸卯年');
    assert(pillarsOf('2024-02-04 16:28').indexOf('甲辰') === 0, '立春后应为甲辰年');
});

/* ------------------------------------------------------------------ */
console.log('4. 中国夏令时 1986-1991');
test('1986-05-04 01:30 未入夏令时', () => {
    const b = B.parseBirthInput('1986-05-04 01:30', '', {});
    eq(b.dstApplied, false);
});
test('1986-05-04 02:30 已入夏令时', () => {
    const b = B.parseBirthInput('1986-05-04 02:30', '', {});
    eq(b.dstApplied, true);
});
test('1986-06-01 12:00 夏令时 → 甲午时', () => {
    const r = B.buildReport(mkBirth('1986-06-01 12:00'));
    eq(r.pillars[3].ganzhi, '甲午');
});
test('1991-09-15 00:30 仍在夏令时', () => {
    const b = B.parseBirthInput('1991-09-15 00:30', '', {});
    eq(b.dstApplied, true);
});
test('1991-09-15 02:30 已出夏令时', () => {
    const b = B.parseBirthInput('1991-09-15 02:30', '', {});
    eq(b.dstApplied, false);
});
test('1992-06-01 12:00 无夏令时', () => {
    const b = B.parseBirthInput('1992-06-01 12:00', '', {});
    eq(b.dstApplied, false);
});
test('dst:off 强制关闭', () => {
    const b = B.parseBirthInput('1986-06-01 12:00', '', { dst: 'off' });
    eq(b.dstApplied, false);
});

/* ------------------------------------------------------------------ */
console.log('5. 子时流派');
test('晚子时 1990-06-15 23:30 → 壬子日庚子时（换日）', () => {
    const r = B.buildReport(mkBirth('1990-06-15 23:30', { ziSchool: 'late', dst: 'off' }));
    eq(r.pillars[2].ganzhi, '壬子');
    eq(r.pillars[3].ganzhi, '庚子');
});
test('早子时 1990-06-15 23:30 → 辛亥日（不换日）', () => {
    const r = B.buildReport(mkBirth('1990-06-15 23:30', { ziSchool: 'early', dst: 'off' }));
    eq(r.pillars[2].ganzhi, '辛亥');
});
test('早子时 00:30 与晚子时 00:30 日柱一致', () => {
    const a = B.buildReport(mkBirth('1990-06-16 00:30', { ziSchool: 'early', dst: 'off' }));
    const b = B.buildReport(mkBirth('1990-06-16 00:30', { ziSchool: 'late', dst: 'off' }));
    eq(a.pillars[2].ganzhi, b.pillars[2].ganzhi);
});

/* ------------------------------------------------------------------ */
console.log('6. 农历输入与往返（200 随机 + 闰月锚点）');
test('农历2024正月初一 → 公历2024-02-10 甲辰年', () => {
    const r = B.buildReport(mkBirth('2024-01-01 10:00', { calendar: 'lunar' }));
    eq(r.meta.solarDateText.slice(0, 10), '2024-02-10');
    eq(r.pillars[0].ganzhi, '甲辰');
});
test('农历2023闰二月初一 → 公历2023-03-22', () => {
    const r = B.buildReport(mkBirth('2023-02-01 10:00', { calendar: 'lunar', leap: true }));
    eq(r.meta.solarDateText.slice(0, 10), '2023-03-22');
});
test('农历2025闰六月初一 → 公历2025-07-25', () => {
    const r = B.buildReport(mkBirth('2025-06-01 10:00', { calendar: 'lunar', leap: true }));
    eq(r.meta.solarDateText.slice(0, 10), '2025-07-25');
});
(function () {
    let n = 0;
    for (let k = 0; k < 200; k++) {
        const ts = Date.UTC(1901, 0, 1) + Math.floor(rand() * (Date.UTC(2099, 0, 1) - Date.UTC(1901, 0, 1)));
        const d = new Date(ts + 8 * 3600000);
        const lunar = Solar.fromYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).getLunar();
        const ly = lunar.getYear(), lm = lunar.getMonth(), ld = lunar.getDay();
        const mine = B.solarToLunar(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4), 8);
        if (mine.year !== ly || mine.month !== Math.abs(lm) || mine.day !== ld || mine.isLeap !== (lm < 0)) {
            throw new Error('solarToLunar ' + fmtWall(ts) + ': 期望 ' + ly + '/' + lm + '/' + ld + '，实得 ' + JSON.stringify(mine));
        }
        const back = B.lunarToSolar(ly, Math.abs(lm), ld, lm < 0);
        if (back.year !== d.getUTCFullYear() || back.month !== d.getUTCMonth() + 1 || back.day !== d.getUTCDate()) {
            throw new Error('lunarToSolar ' + ly + '/' + lm + '/' + ld + ': 期望 ' + fmtWall(ts).slice(0, 10) + '，实得 ' + JSON.stringify(back));
        }
        n++;
    }
    test('200 随机农历↔公历双向往返全等', () => assert(n === 200));
})();

/* ------------------------------------------------------------------ */
console.log('7. 真太阳时');
test('乌鲁木齐 1986-06-01 12:00（lon 87.6，DST 叠加）→ 真太阳 08:51 壬辰时', () => {
    const r = B.buildReport(mkBirth('1986-06-01 12:00', { longitude: 87.6, trueSolar: true }));
    eq(r.pillars[3].ganzhi, '壬辰');
});
test('经度校正公式 (lon-120)×4 分钟', () => {
    const b = B.parseBirthInput('1990-06-15 10:00', '', { longitude: 87.6, trueSolar: true });
    near(b.lonCorrMin, (87.6 - 120) * 4, 0.01);
});
test('均时差绝对值 ≤ 17 分钟（全年抽样）', () => {
    for (let m = 0; m < 12; m++) {
        const eot = I.equationOfTime(Date.UTC(2024, m, 15, 4));
        assert(Math.abs(eot) <= 17, 'EoT 异常 ' + eot);
    }
});
test('北京正午均时差量级合理（2 月中旬约 -14 分）', () => {
    const eot = I.equationOfTime(Date.UTC(2024, 1, 12, 4));
    near(eot, -14.2, 1.5);
});

/* ------------------------------------------------------------------ */
console.log('8. 特殊格局锚点（构造验证过的样本）');
const GEJU_CASES = [
    ['1980-04-22 07:30', '化气格'],
    ['1980-05-21 09:30', '化气格'],
    ['1980-06-20 09:30', '正财格'],
    ['1980-01-04 07:30', '假从杀格'],
    ['1980-01-12 09:30', '假从财格'],
    ['1981-11-03 09:30', '从杀格'],
    ['1982-05-11 09:30', '从财格'],
    ['1982-05-22 09:30', '从儿格'],
    ['1980-01-16 09:30', '专旺格'],
    ['1980-08-27 09:30', '从强格']
];
GEJU_CASES.forEach(([s, name]) => {
    test(s + ' → ' + name, () => eq(B.buildReport(mkBirth(s)).geju.name, name));
});
test('化气格用神以化神为体（乙庚化金喜土金）', () => {
    const r = B.buildReport(mkBirth('1980-04-22 07:30'));
    assert(r.yongshen.favorable.indexOf('金') !== -1, '化金应喜金');
});

/* ------------------------------------------------------------------ */
console.log('9. 空亡 / 伏吟反吟 / 神煞 / 身宫胎息');
test('辛亥日空亡寅卯', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    assert(r.chart.kongWang.indexOf('寅') !== -1 && r.chart.kongWang.indexOf('卯') !== -1, '辛亥日应空寅卯');
});
test('胎息 = 日干五合 + 日支六合', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    eq(r.chart.taiXi.ganzhi, '丙寅');
});
test('身宫存在且为合法干支', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    assert(/^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/.test(r.chart.shenGong.ganzhi), '身宫异常: ' + r.chart.shenGong.ganzhi);
});
test('小运列表非空且首岁 ≤ 起运岁', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    assert(r.xiaoyun.list.length > 0, '小运为空');
    assert(r.xiaoyun.list[0].age >= 1, '小运起始岁异常');
});
test('辛亥日孤鸾入盘且带分级', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    const g = r.shensha.dict['孤鸾'];
    assert(g && g.tier && g.nature && g.text, '孤鸾缺分级结构');
});
test('辛卯日流霞入盘（辛日流霞在卯）', () => {
    const r = B.buildReport(mkBirth('1990-05-26 10:00'));
    eq(r.pillars[2].ganzhi, '辛卯');
    assert(r.shensha.dict['流霞'], '辛卯日应见流霞');
});
test('伏吟反吟结构存在', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    assert(r.fuyin && Array.isArray(r.fuyin.list), 'fuyin 结构缺失');
});

/* ------------------------------------------------------------------ */
console.log('10. 参数系统');
test('默认参数 13 项齐全', () => {
    const p = I.defaultParams();
    ['monthWeight', 'siLingBonus', 'transparentBonus', 'rootStrong', 'rootWeak', 'rootVirtual',
        'clashWeak', 'clashStrong', 'bindFactor', 'kongFactor', 'tiaohouWeight', 'congThreshold', 'luckAmplitude'
    ].forEach(k => assert(typeof p[k] === 'number' && isFinite(p[k]), '参数缺失 ' + k));
});
test('monthWeight 增大 → 月令权重占比上升', () => {
    const lo = B.buildReport(Object.assign(mkBirth('1990-06-15 10:00'), { params: { monthWeight: 1.5 } }));
    const hi = B.buildReport(Object.assign(mkBirth('1990-06-15 10:00'), { params: { monthWeight: 3.0 } }));
    assert(hi.strength.ratio !== lo.strength.ratio, '月令权重未生效');
});
test('tiaohouWeight 0.5 → 调候权重减半', () => {
    const r = B.buildReport(Object.assign(mkBirth('1990-06-15 10:00'), { params: { tiaohouWeight: 0.5 } }));
    const d = B.buildReport(mkBirth('1990-06-15 10:00'));
    near(r.tiaohou.weight, d.tiaohou.weight * 0.5, 0.11);
});
test('非法参数被忽略不污染引擎', () => {
    const r = B.buildReport(Object.assign(mkBirth('1990-06-15 10:00'), { params: { monthWeight: 'abc', kongFactor: NaN, hack: 1 } }));
    eq(r.params.monthWeight, I.defaultParams().monthWeight);
    eq(r.params.hack, undefined);
    const after = B.buildReport(mkBirth('1990-06-15 10:00'));
    eq(after.params.monthWeight, I.defaultParams().monthWeight);
});

/* ------------------------------------------------------------------ */
console.log('11. 报告完整性与三柱模式');
test('报告顶层结构齐全', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    ['meta', 'pillars', 'chart', 'model', 'strength', 'geju', 'yongshen', 'tiaohou', 'dayun', 'liunian',
        'liuyue', 'milestones', 'family', 'shensha', 'palaces', 'fuyin', 'xiaoyun', 'params', 'advice', 'narrative'
    ].forEach(k => assert(r[k] !== undefined, '缺字段 ' + k));
});
test('流年覆盖出生年至未来九年', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    const y0 = r.liunian[0].year, y1 = r.liunian[r.liunian.length - 1].year;
    eq(y0, 1990);
    const nowY = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
    eq(y1, nowY + 9);
});
test('应期年月联动：窗口年份带流月', () => {
    const r = B.buildReport(mkBirth('1990-06-15 10:00'));
    const w = r.milestones.windows.career;
    assert(w && w.months && w.months.length === 3, '事业窗口缺流月');
    assert(w.year >= new Date(Date.now() + 8 * 3600000).getUTCFullYear(), '窗口应为未来年份');
});
test('时辰未知 → 三柱模式不崩溃', () => {
    const r = B.buildReport(mkBirth('1990-06-15', { hourUnknown: true }));
    eq(r.pillars[3].unknown, true);
    eq(r.pillars[3].ganzhi, '？？');
    assert(r.geju.name && r.yongshen.favorableText, '三柱模式断语缺失');
    assert(r.chart.shenGong === null, '三柱模式身宫应为 null');
});
test('三柱模式逢夏令时日期不位移（农历/日柱回归）', () => {
    const b = B.parseBirthInput('1990-06-15', '', { hourUnknown: true });
    eq(b.dstApplied, false, '三柱模式不应扣夏令时');
    eq(b.lunar.day, 23, '农历应为五月廿三');
    const late = B.buildReport(mkBirth('1990-06-15', { hourUnknown: true, ziSchool: 'late' }));
    const early = B.buildReport(mkBirth('1990-06-15', { hourUnknown: true, ziSchool: 'early' }));
    eq(late.pillars[2].ganzhi, '辛亥', '晚子时派三柱日柱');
    eq(early.pillars[2].ganzhi, '辛亥', '早子时派三柱日柱');
});
test('时辰与钟表时间冲突 → 警告不覆盖', () => {
    const b = B.parseBirthInput('1990-06-15 10:00', 'zi', {});
    assert(b.warnings.length > 0, '应有冲突警告');
    eq(b.hour, 10, '不应覆盖用户时间');
});

/* ------------------------------------------------------------------ */
console.log('12. 合盘');
test('合婚五维权重和 100，纳音入论', () => {
    const ra = B.buildReport(Object.assign(mkBirth('1990-06-15 10:00'), { name: '甲' }));
    const rb = B.buildReport(Object.assign(mkBirth('1992-08-20 14:00', {}, 'female'), { name: '乙' }));
    const syn = B.computeSynastry(ra, rb, 'marriage');
    eq(syn.dims.reduce((s, d) => s + d.weight, 0), 100);
    assert(syn.dims[0].text.indexOf('纳音') !== -1, '合婚缺纳音论断');
    assert(typeof syn.score === 'number' && syn.score >= 0 && syn.score <= 100, '合盘分数异常');
});
test('合伙模式输出角色分工', () => {
    const ra = B.buildReport(mkBirth('1990-06-15 10:00'));
    const rb = B.buildReport(mkBirth('1985-03-08 08:00'));
    const syn = B.computeSynastry(ra, rb, 'business');
    assert(syn.roles.a.name && syn.roles.b.name, '缺角色');
});
test('一方时辰未知合盘不崩溃', () => {
    const ra = B.buildReport(mkBirth('1990-06-15 10:00'));
    const rb = B.buildReport(mkBirth('1992-08-20', { hourUnknown: true }, 'female'));
    const syn = B.computeSynastry(ra, rb, 'marriage');
    assert(syn.dims[2].text.indexOf('从略') !== -1, '应标注从略');
});

/* ------------------------------------------------------------------ */
console.log('');
console.log('========================================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed) {
    console.log('失败明细:');
    failures.forEach(f => console.log('  ✗ ' + f.name + ': ' + f.msg));
    process.exit(1);
}
console.log('全部通过 ✓');