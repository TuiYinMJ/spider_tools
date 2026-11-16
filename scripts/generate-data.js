/* 离线数据生成器：用 lunar-javascript（寿星历）生成 1900–2100 节气时刻表与农历月表。
 * 运行：npm run generate
 * 产物：js/data-terms.js（每年24节气 UTC 毫秒）、js/data-lunar.js（农历月起讫）
 * 运行时纯查表，零依赖、零网络。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Solar } = require('lunar-javascript');

const YEAR_MIN = 1900, YEAR_MAX = 2100;
const TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];

/* ---------- 节气 ---------- */
function collectTerms() {
    const years = {};
    const seen = {}; // name -> ts 去重（相邻锚点表有重叠）
    for (let y = YEAR_MIN; y <= YEAR_MAX + 1; y++) {
        // 每个太阳年取 5 个锚点，确保 24 节气全覆盖（含年初小寒与年末冬至）
        const anchors = [[y, 1, 15], [y, 4, 15], [y, 7, 15], [y, 10, 15], [y + 1, 1, 15]];
        for (const [ay, am, ad] of anchors) {
            const table = Solar.fromYmd(ay, am, ad).getLunar().getJieQiTable();
            for (const key of Object.keys(table)) {
                if (TERM_NAMES.indexOf(key) === -1) continue; // 跳过拼音键
                const s = table[key];
                // 寿星历返回的已是北京墙钟时间，转 true UTC 毫秒存储
                const ts = Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute(), s.getSecond()) - 8 * 3600000;
                const id = s.getYear() + ':' + key;
                if (seen[id] === undefined) seen[id] = ts;
            }
        }
    }
    for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
        const arr = TERM_NAMES.map(n => seen[y + ':' + n]);
        if (arr.some(t => t === undefined)) throw new Error('节气缺失: ' + y);
        for (let i = 1; i < 24; i++) if (arr[i] <= arr[i - 1]) throw new Error('节气顺序错误: ' + y);
        // 小寒必须落在 1 月、冬至必须落在 12 月
        const xh = new Date(arr[0] + 8 * 3600000), dz = new Date(arr[23] + 8 * 3600000);
        if (xh.getUTCMonth() !== 0 || dz.getUTCMonth() !== 11) throw new Error('节气年份归属错误: ' + y);
        years[y] = arr;
    }
    return years;
}

/* ---------- 农历 ---------- */
function collectLunar() {
    const months = [];
    const start = Date.UTC(1899, 0, 1), end = Date.UTC(2101, 11, 31);
    let prev = null;
    for (let t = start; t <= end; t += 86400000) {
        const d = new Date(t);
        const lunar = Solar.fromYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).getLunar();
        if (lunar.getDay() === 1) {
            const rec = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(),
                lunar.getYear(), lunar.getMonth(), 0];
            if (prev) prev[5] = Math.round((t - Date.UTC(prev[0], prev[1] - 1, prev[2])) / 86400000);
            months.push(rec);
            prev = rec;
        }
    }
    if (prev) prev[5] = 30; // 末月截断，仅影响 2101 年末边界
    return months;
}

function verify(terms, months) {
    const cst = ts => {
        const d = new Date(ts + 8 * 3600000);
        const p = n => String(n).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    };
    const checks = [
        ['立春2024', cst(terms[2024][2]), '2024-02-04 16:27'],
        ['小寒2000', cst(terms[2000][0]), '2000-01-06 09:00'],
        ['大雪2023', cst(terms[2023][22]), '2023-12-07 17:33'],
        ['冬至2024', cst(terms[2024][23]), '2024-12-21 17:20'],
        ['夏至2024', cst(terms[2024][11]), '2024-06-21 04:51']
    ];
    for (const [label, got, want] of checks) {
        const diffMin = Math.round((new Date(got.replace(' ', 'T') + ':00Z') - new Date(want.replace(' ', 'T') + ':00Z')) / 60000);
        if (Math.abs(diffMin) > 2) throw new Error('节气校验失败 ' + label + ': ' + got + ' 期望 ' + want);
        console.log('  ✓ ' + label + ' = ' + got + '（偏差 ' + diffMin + ' 分钟）');
    }
    // 农历校验：春节与闰月
    const findMonth = (sy, sm, sd) => months.find(r => r[0] === sy && r[1] === sm && r[2] === sd);
    const cny = [
        [2024, 2, 10, 2024, 1, '甲辰年春节'],
        [2023, 1, 22, 2023, 1, '癸卯年春节'],
        [2025, 1, 29, 2025, 1, '乙巳年春节'],
        [1900, 1, 31, 1900, 1, '庚子年春节'],
        [2023, 3, 22, 2023, -2, '癸卯年闰二月初一'],
        [2025, 7, 25, 2025, -6, '乙巳年闰六月初一']
    ];
    for (const [sy, sm, sd, ly, lm, label] of cny) {
        const r = findMonth(sy, sm, sd);
        if (!r || r[3] !== ly || r[4] !== lm) throw new Error('农历校验失败 ' + label + ': ' + JSON.stringify(r));
        console.log('  ✓ ' + label + ' = ' + sy + '-' + sm + '-' + sd);
    }
    console.log('  节气 ' + Object.keys(terms).length + ' 年 × 24，农历月 ' + months.length + ' 条');
}

function main() {
    console.log('生成节气表…');
    const terms = collectTerms();
    console.log('生成农历月表（约 7.4 万天迭代）…');
    const months = collectLunar();
    console.log('校验已知历书锚点…');
    verify(terms, months);

    const outDir = path.join(__dirname, '..', 'js');
    const termsSrc = '/* 自动生成：1900–2100 年 24 节气交节时刻（UTC 毫秒，寿星历）。勿手改。 */\n' +
        'var BAZI_TERMS = { names: ' + JSON.stringify(TERM_NAMES) + ', years: ' + JSON.stringify(terms) + ' };\n' +
        'if (typeof module !== "undefined" && module.exports) module.exports = BAZI_TERMS;\n';
    const lunarSrc = '/* 自动生成：农历月起讫表 [公历年,月,日, 农历年, 农历月(负=闰), 月天数]。勿手改。 */\n' +
        'var BAZI_LUNAR = { months: ' + JSON.stringify(months) + ' };\n' +
        'if (typeof module !== "undefined" && module.exports) module.exports = BAZI_LUNAR;\n';
    fs.writeFileSync(path.join(outDir, 'data-terms.js'), termsSrc);
    fs.writeFileSync(path.join(outDir, 'data-lunar.js'), lunarSrc);
    console.log('已写入 js/data-terms.js (' + (termsSrc.length / 1024).toFixed(0) + ' KB), js/data-lunar.js (' + (lunarSrc.length / 1024).toFixed(0) + ' KB)');
}

main();