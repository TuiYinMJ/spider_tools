/* ============================================================
   子平命盘 · UI 层（纯前端，引擎见 js/bazi.js）
   命盘 / 五行 / 格局用神 / 岁运 / 流月 / 断语 / 合盘 / 复盘 / 参数
   案例库 localStorage · URL hash 分享 · JSON 导出 · 批量 CSV
   ============================================================ */
(function () {
'use strict';

var B = window.BaziApp;
var I = B._internals;

/* ---------------- 工具 ---------------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}
function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
}
function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.hidden = true; }, 2200);
}
function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}
function scoreCls(v) { return v >= 15 ? 'score-pos' : (v <= -15 ? 'score-neg' : 'score-zero'); }
function lvCls(key) { return key === 'good' ? 'lv-good' : (key === 'bad' ? 'lv-bad' : 'lv-mid'); }
function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
function wxSpan(ch, wx) { return '<span class="wx-' + esc(wx) + '">' + esc(ch) + '</span>'; }
function pct1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

var WX5 = ['木', '火', '土', '金', '水'];
var SHICHEN_OPTS = [
    ['zi', '子时 23:00–01:00'], ['chou', '丑时 01:00–03:00'], ['yin', '寅时 03:00–05:00'],
    ['mao', '卯时 05:00–07:00'], ['chen', '辰时 07:00–09:00'], ['si', '巳时 09:00–11:00'],
    ['wu', '午时 11:00–13:00'], ['wei', '未时 13:00–15:00'], ['shen', '申时 15:00–17:00'],
    ['you', '酉时 17:00–19:00'], ['xu', '戌时 19:00–21:00'], ['hai', '亥时 21:00–23:00']
];
var EVENT_TYPES = ['婚恋', '生育', '事业', '财运', '健康', '学业', '搬迁', '丧亲', '其他'];

/* ---------------- 参数定义 ---------------- */
var PARAM_DEFS = [
    { key: 'monthWeight', name: '月令权重', desc: '月令地支相对其他宫位的力量倍数', min: 1, max: 3, step: 0.1 },
    { key: 'siLingBonus', name: '司令加成', desc: '月令藏干值司令时的力量加成', min: 1, max: 1.6, step: 0.05 },
    { key: 'transparentBonus', name: '透干加成', desc: '藏干透出天干时的力量加成', min: 1, max: 1.4, step: 0.05 },
    { key: 'rootStrong', name: '本气根加成', desc: '天干通本气根（禄刃）的力量加成', min: 1, max: 1.4, step: 0.05 },
    { key: 'rootWeak', name: '中气根系数', desc: '天干通中气根的力量系数', min: 0.6, max: 1.1, step: 0.05 },
    { key: 'rootVirtual', name: '余气根系数', desc: '天干通余气微根的力量系数', min: 0.5, max: 1, step: 0.05 },
    { key: 'clashWeak', name: '冲衰系数', desc: '六冲中衰方受损后的力量系数', min: 0.3, max: 0.9, step: 0.02 },
    { key: 'clashStrong', name: '冲旺系数', desc: '六冲中旺方受损后的力量系数', min: 0.7, max: 1, step: 0.02 },
    { key: 'bindFactor', name: '合绊系数', desc: '合而不化时双方被绊的力量系数', min: 0.4, max: 0.95, step: 0.02 },
    { key: 'kongFactor', name: '空亡系数', desc: '空亡地支的力量折减系数', min: 0.5, max: 1, step: 0.02 },
    { key: 'tiaohouWeight', name: '调候权重倍率', desc: '调候在用神评分中的权重倍率', min: 0, max: 2, step: 0.1 },
    { key: 'congThreshold', name: '从格阈值 %', desc: '日主同党占比低于此值方论从格', min: 20, max: 45, step: 1 },
    { key: 'luckAmplitude', name: '岁运振幅', desc: '大运流年评分的放大系数', min: 10, max: 60, step: 1 }
];

/* ---------------- 状态 ---------------- */
var state = {
    form: null,
    params: I.defaultParams(),
    report: null,
    caseId: null,
    events: [],
    liunianFilter: 'future',
    liuyueYear: null,
    synastry: null
};

/* ---------------- 表单 ---------------- */
function segValue(name) {
    var b = document.querySelector('.seg-btn.active[data-name="' + name + '"]');
    return b ? b.dataset.value : null;
}
function setSeg(name, value) {
    document.querySelectorAll('.seg-btn[data-name="' + name + '"]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.value === String(value));
    });
}
function readForm() {
    return {
        name: $('fName').value.trim(),
        gender: segValue('gender') || 'male',
        calendar: segValue('calendar') || 'solar',
        date: $('fDate').value,
        time: $('fTime').value || '12:00',
        leap: segValue('leap') === '1',
        shichen: $('fShichen').value,
        city: $('fCity').value.trim(),
        lon: parseFloat($('fLon').value) || 120,
        tz: parseFloat($('fTz').value) || 8,
        trueSolar: segValue('trueSolar') === '1',
        ziSchool: segValue('ziSchool') || 'late',
        dst: segValue('dst') || 'auto',
        hourUnknown: segValue('hourUnknown') === '1'
    };
}
function writeForm(f) {
    $('fName').value = f.name || '';
    setSeg('gender', f.gender || 'male');
    setSeg('calendar', f.calendar || 'solar');
    $('fDate').value = f.date || '';
    $('fTime').value = f.time || '12:00';
    setSeg('leap', f.leap ? '1' : '0');
    $('fShichen').value = f.shichen || '';
    $('fCity').value = f.city || '';
    $('fLon').value = f.lon != null ? f.lon : 120;
    $('fTz').value = String(f.tz != null ? f.tz : 8);
    setSeg('trueSolar', f.trueSolar ? '1' : '0');
    setSeg('ziSchool', f.ziSchool || 'late');
    setSeg('dst', f.dst || 'auto');
    setSeg('hourUnknown', f.hourUnknown ? '1' : '0');
    syncFormVisibility();
}
function syncFormVisibility() {
    $('leapField').hidden = segValue('calendar') !== 'lunar';
    $('timeField').style.opacity = segValue('hourUnknown') === '1' ? '.4' : '1';
    $('fTime').disabled = segValue('hourUnknown') === '1';
}

function initForm() {
    SHICHEN_OPTS.forEach(function (s) {
        $('fShichen').appendChild(el('<option value="' + s[0] + '">' + s[1] + '</option>'));
    });
    for (var tz = -12; tz <= 14; tz++) {
        var label = 'UTC' + (tz >= 0 ? '+' : '') + tz + (tz === 8 ? '（北京）' : tz === 0 ? '（格林威治）' : '');
        $('fTz').appendChild(el('<option value="' + tz + '"' + (tz === 8 ? ' selected' : '') + '>' + label + '</option>'));
    }
    var cities = [];
    (BAZI_CITIES.cn || []).forEach(function (c) { cities.push({ label: c[0] + '（' + c[1] + '）', lon: c[2], tz: 8 }); });
    (BAZI_CITIES.world || []).forEach(function (c) { cities.push({ label: c[0] + '（' + c[1] + '）', lon: c[2], tz: c[3] }); });
    cities.forEach(function (c) {
        $('cityList').appendChild(el('<option value="' + esc(c.label) + '"></option>'));
    });
    $('fCity').addEventListener('change', function () {
        var v = $('fCity').value.trim();
        var hit = cities.filter(function (c) { return c.label === v || c.label.split('（')[0] === v; })[0];
        if (hit) {
            $('fLon').value = hit.lon;
            $('fTz').value = String(hit.tz);
            toast('已设经度 ' + hit.lon + '°，时区 UTC' + (hit.tz >= 0 ? '+' : '') + hit.tz);
        }
    });
    document.querySelectorAll('.seg-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            b.parentElement.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
            b.classList.add('active');
            syncFormVisibility();
        });
    });
    $('birthForm').addEventListener('submit', function (e) {
        e.preventDefault();
        compute();
    });
}

/* ---------------- 排盘 ---------------- */
function compute() {
    var f = readForm();
    if (!f.date) { toast('请先选择出生日期'); return; }
    var dateTime = f.date + (f.hourUnknown ? '' : ' ' + f.time);
    var birth;
    try {
        birth = B.parseBirthInput(dateTime, f.shichen, {
            calendar: f.calendar, leap: f.leap, tz: f.tz, longitude: f.lon,
            trueSolar: f.trueSolar, ziSchool: f.ziSchool, hourUnknown: f.hourUnknown, dst: f.dst
        });
    } catch (err) {
        toast('输入有误：' + err.message);
        return;
    }
    birth.gender = f.gender;
    birth.name = f.name;
    birth.params = state.params;
    var report;
    try { report = B.buildReport(birth); }
    catch (err) { toast('排盘失败：' + err.message); return; }

    state.form = f;
    state.report = report;
    state.liuyueYear = null;
    state.synastry = null;
    $('emptyState').hidden = true;
    $('resultArea').hidden = false;
    $('btnSaveCase').disabled = false;

    var w = $('warnings');
    var warns = (birth.warnings || []).concat(report.meta.warnings || []);
    if (warns.length) {
        w.innerHTML = '<ul>' + warns.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
        w.hidden = false;
    } else w.hidden = true;

    renderAll();
    $('chartBanner').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAll() {
    var r = state.report;
    renderBanner(r);
    renderMingpan(r);
    renderWuxing(r);
    renderGeju(r);
    renderSuiyun(r);
    renderLiuyue(r);
    renderDuanyu(r);
    renderHepanShell();
    renderFupan(r);
    renderParams();
}

/* ---------------- 横幅 ---------------- */
function renderBanner(r) {
    var m = r.meta;
    var html = '<div class="banner-name">' + esc(m.name || '未命名') +
        '<span class="gender-tag">' + esc(m.genderText) + ' · ' + esc(m.birthDate) + ' ' + esc(m.birthTime) + '</span></div>' +
        '<div class="banner-pillars">' + r.pillars.map(function (p) {
            return '<span>' + (p.unknown ? '？？' : wxSpan(p.gan, p.ganWx) + wxSpan(p.zhi, p.zhiWx)) + '</span>';
        }).join('') + '</div>' +
        '<div class="banner-meta">' +
        '<span>日主 <b>' + esc(m.dayMaster) + esc(m.dayMasterWx) + '</b>（' + esc(m.dayMasterYy) + '）</span>' +
        '<span>格局 <b>' + esc(r.geju.name) + '</b></span>' +
        '<span>身强弱 <b>' + esc(r.strength.status) + ' ' + pct1(r.strength.ratio) + '%</b></span>' +
        '<span>用神 <b>' + esc(r.yongshen.favorableText) + '</b></span>' +
        '<span>空亡 <b>' + esc(m.kongWang) + '</b></span>' +
        (m.lunar ? '<span>' + esc(m.lunar.text) + '</span>' : '') +
        '</div>';
    $('chartBanner').innerHTML = html;
}

/* ---------------- 命盘页 ---------------- */
function pillarCard(p, shenshaDict) {
    if (p.unknown) {
        return '<div class="pillar unknown"><div class="pillar-head"><div class="pname">' + esc(p.name) + '</div><div class="pgong">' + esc(p.gong) + '</div></div>' +
            '<div class="pillar-gz"><span class="gz-char">？</span><span class="gz-char">？</span><span class="gz-ss">时辰未知 · 从略</span></div></div>';
    }
    var cang = p.cang.map(function (c) {
        return '<div class="cang-row">' + wxSpan(c.gan, c.wx) + '<span class="cs">' + esc(c.tenGod) + '</span>' +
            '<span class="cs">' + (c.transparent ? '透' : '藏') + '</span></div>';
    }).join('');
    var ss = (p.shensha || []).map(function (n) {
        var d = shenshaDict[n];
        var tier = d && d.tier ? d.tier : '中性';
        var tip = d ? d.text : '';
        return '<span class="ss-tag tier-' + esc(tier) + '" title="' + esc(tip) + '">' + esc(n) + '</span>';
    }).join('');
    var kong = (p.kongWang || []).length ? '<div>旬空 ' + esc(p.kongWang.join('、')) + '</div>' : '';
    return '<div class="pillar">' +
        '<div class="pillar-head"><div class="pname">' + esc(p.name) + '</div><div class="pgong">' + esc(p.gong) + '</div></div>' +
        '<div class="pillar-gz">' +
        '<span class="gz-char wx-' + esc(p.ganWx) + '">' + esc(p.gan) + '</span><span class="gz-ss">' + esc(p.isDay ? '日主' : p.shishen) + '</span>' +
        '<span class="gz-char wx-' + esc(p.zhiWx) + '">' + esc(p.zhi) + '</span><span class="gz-ss">' + esc(p.cang[0] ? p.cang[0].tenGod : '') + '</span>' +
        '</div>' +
        '<div class="pillar-cang">' + cang + '</div>' +
        '<div class="pillar-extra">' +
        '<div>星运 ' + esc(p.xingYun) + ' · 自坐 ' + esc(p.ziZuo) + '</div>' +
        '<div>纳音 ' + esc(p.nayin) + '</div>' +
        (p.seatNote ? '<div>' + esc(p.seat) + '</div>' : '') + kong +
        '</div>' +
        (ss ? '<div class="pillar-shensha">' + ss + '</div>' : '') +
        '</div>';
}

function renderMingpan(r) {
    var m = r.meta, c = r.chart;
    var html = '<div class="card"><h2>四柱命盘</h2><div class="pillars-row">' +
        r.pillars.map(function (p) { return pillarCard(p, r.shensha.dict); }).join('') + '</div>' +
        '<p style="margin-top:12px;font-size:13px;color:var(--ink-faint)">' + esc(m.solarTimeNote || '') + '</p></div>';

    html += '<div class="card"><h2>节气与宫位</h2><div class="info-grid">' +
        '<div><span class="ik">月令</span>' + esc(m.monthJie) + ' ' + esc(m.monthJieTime) + '（' + esc(m.monthJieElapsed) + '）</div>' +
        '<div><span class="ik">下节</span>' + esc(m.nextJie) + ' ' + esc(m.nextJieTime) + '（' + esc(m.nextJieIn) + '）</div>' +
        '<div><span class="ik">司令</span>' + esc(m.siLingText) + '</div>' +
        '<div><span class="ik">命宫</span>' + (m.mingGong ? esc(m.mingGong.ganzhi) : '—') + '</div>' +
        '<div><span class="ik">身宫</span>' + (m.shenGong ? esc(m.shenGong.ganzhi) : '—') + '</div>' +
        '<div><span class="ik">胎元</span>' + (m.taiYuan ? esc(m.taiYuan.ganzhi) : '—') + '</div>' +
        '<div><span class="ik">胎息</span>' + (m.taiXi ? esc(m.taiXi.ganzhi) : '—') + '</div>' +
        '<div><span class="ik">日空</span>' + esc(m.kongWang) + '</div>' +
        '</div>' +
        (m.taiXi && m.taiXi.note ? '<p style="font-size:12.5px;color:var(--ink-faint)">' + esc(m.taiXi.note) + '；' + esc(m.shenGong ? m.shenGong.note : '') + '</p>' : '') +
        '</div>';

    html += '<div class="card"><h2>干支关系</h2>';
    if (r.relationships.length) {
        html += '<div class="rel-list">' + r.relationships.map(function (x) {
            return '<div class="rel-item"><span class="rel-type">' + esc(x.type) + '</span><span class="rel-pair">' + esc(x.pair) + '</span>' +
                '<span class="rel-note">' + esc(x.positions) + ' · ' + esc(x.effect || x.note) + '</span></div>';
        }).join('') + '</div>';
    } else html += '<p>原局干支无显著合冲刑害。</p>';
    html += '<h3>伏吟反吟</h3><p>' + esc(r.fuyin.text) + '</p>';
    if (r.model.kongEffects && r.model.kongEffects.length) {
        html += '<h3>空亡入论</h3><div class="rel-list">' + r.model.kongEffects.map(function (k) {
            return '<div class="rel-item"><span class="rel-type">空亡</span><span class="rel-note">' + esc(k.text || k.note || JSON.stringify(k)) + '</span></div>';
        }).join('') + '</div>';
    }
    html += '</div>';

    if (r.xiaoyun.list.length) {
        html += '<div class="card"><h2>小运（起运前）</h2><p style="font-size:13px;color:var(--ink-faint)">' + esc(r.xiaoyun.text) + '</p>' +
            '<div class="tbl-wrap"><table><thead><tr><th>虚岁</th><th>年份</th><th>干支</th><th>十神</th><th>星运</th></tr></thead><tbody>' +
            r.xiaoyun.list.map(function (x) {
                return '<tr><td>' + x.age + '</td><td>' + x.year + '</td><td class="gz-cell">' + esc(x.ganzhi) + '</td><td>' + esc(x.shishen) + '</td><td>' + esc(x.xingYun) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>';
    }
    $('page-mingpan').innerHTML = html;
}

/* ---------------- 五行页 ---------------- */
function flowSvg(r) {
    var pct = r.model.percent;
    var cx = 230, cy = 220, R = 150;
    var order = ['火', '土', '金', '水', '木'];
    var pos = {};
    order.forEach(function (w, i) {
        var a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        pos[w] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });
    var sheng = [['木', '火'], ['火', '土'], ['土', '金'], ['金', '水'], ['水', '木']];
    var ke = [['木', '土'], ['土', '水'], ['水', '火'], ['火', '金'], ['金', '木']];
    var chainQ = {};
    (r.flow.chain || []).forEach(function (ch) { chainQ[ch.fromEl + '>' + ch.toEl] = ch.quality; });

    var s = '<svg class="flow-svg" viewBox="0 0 460 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="五行流通图">' +
        '<defs><marker id="arrS" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#4a463f"/></marker>' +
        '<marker id="arrK" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#b5402a"/></marker></defs>';

    function edge(a, b, kind) {
        var pa = pos[a], pb = pos[b];
        var ra = nodeR(a), rb = nodeR(b);
        var dx = pb.x - pa.x, dy = pb.y - pa.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        var ux = dx / len, uy = dy / len;
        var x1 = pa.x + ux * (ra + 4), y1 = pa.y + uy * (ra + 4);
        var x2 = pb.x - ux * (rb + 10), y2 = pb.y - uy * (rb + 10);
        var w, color, dash, marker, q;
        if (kind === 'sheng') {
            q = chainQ[a + '>' + b];
            w = 1.5 + (q != null ? q / 100 * 4 : (pct[a] + pct[b]) / 40 * 2);
            color = '#4a463f'; dash = ''; marker = 'arrS';
        } else {
            w = 1 + Math.min(pct[a], pct[b]) / 12;
            color = '#b5402a'; dash = '5 5'; marker = 'arrK';
        }
        return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
            '" stroke="' + color + '" stroke-width="' + w.toFixed(1) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') +
            ' marker-end="url(#' + marker + ')" opacity=".75"><title>' + a + (kind === 'sheng' ? '生' : '克') + b + (q != null ? '，流通质量 ' + q : '') + '</title></line>';
    }
    function nodeR(w) { return 24 + Math.min(pct[w], 55) * 0.42; }

    ke.forEach(function (p) { s += edge(p[0], p[1], 'ke'); });
    sheng.forEach(function (p) { s += edge(p[0], p[1], 'sheng'); });

    var wxColor = { 木: '#3a7d5c', 火: '#c14a32', 土: '#b98a2f', 金: '#8f9aa8', 水: '#2b5f8a' };
    order.forEach(function (w) {
        var p = pos[w], rad = nodeR(w);
        s += '<g class="flow-node"><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + rad.toFixed(1) + '" fill="' + wxColor[w] + '" opacity=".92"/>' +
            '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - 2).toFixed(1) + '" text-anchor="middle" fill="#f7f2e7" font-size="22" font-weight="700">' + w + '</text>' +
            '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 17).toFixed(1) + '" text-anchor="middle" fill="#f7f2e7" font-size="11">' + pct1(pct[w]) + '%</text>' +
            '<title>' + w + ' ' + pct1(pct[w]) + '%，' + esc(r.model.state[w] || '') + '</title></g>';
    });
    s += '<text x="' + cx + '" y="' + (cy - 8) + '" text-anchor="middle" font-size="15" fill="#1c1a17" font-weight="700">日主 ' + esc(r.chart.dayGan) + esc(r.chart.dayWx) + '</text>' +
        '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" font-size="12" fill="#8a8478">' + esc(r.strength.status) + ' · 流通 ' + r.flow.quality + ' 分</text>' +
        '<text x="' + cx + '" y="' + (cy + 34) + '" text-anchor="middle" font-size="11" fill="#8a8478">实线为生 · 虚线为克 · 粗细象力量</text></svg>';
    return s;
}

function renderWuxing(r) {
    var m = r.model;
    var html = '<div class="card"><h2>五行流通</h2><div class="flow-svg-wrap">' + flowSvg(r) + '</div>' +
        '<p style="text-align:center;font-size:13px;color:var(--ink-soft)">' + esc(m.stateText) + ' ｜ ' + esc(m.multText) + '</p></div>';

    html += '<div class="card"><h2>五行力量</h2>';
    WX5.forEach(function (w) {
        var v = m.percent[w];
        html += '<div class="bar-row"><span class="wx-' + w + '" style="font-weight:700">' + w + '</span>' +
            '<div class="bar-track"><div class="bar-fill wx-bg-' + w + '" style="width:' + Math.min(v, 100) + '%"></div></div>' +
            '<span class="bar-val">' + pct1(v) + '%</span></div>';
    });
    html += '<div class="tag-row" style="margin-top:10px">' +
        (m.missing.length ? '<span class="tag">缺行：' + m.missing.join('、') + '</span>' : '<span class="tag">五行不缺</span>') +
        (m.weak.length ? '<span class="tag">偏弱：' + m.weak.join('、') + '</span>' : '') +
        (m.excess.length ? '<span class="tag">偏亢：' + m.excess.join('、') + '</span>' : '') + '</div>';
    html += '<h3>十神分组</h3>';
    r.tenGods.groups.forEach(function (g) {
        html += '<div class="bar-row"><span>' + esc(g.name) + '</span>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + Math.min(g.percent, 100) + '%;background:var(--ink-soft)"></div></div>' +
            '<span class="bar-val">' + pct1(g.percent) + '%</span></div>';
    });
    html += '<p style="font-size:13px;color:var(--ink-soft);margin-top:8px">' + esc(r.tenGods.summary) + '</p></div>';

    html += '<div class="card"><h2>寒暖燥湿</h2>' +
        '<div class="bar-row"><span>寒暖</span><div class="bar-track"><div class="bar-fill" style="width:' + r.tiaohou.warmth + '%;background:linear-gradient(90deg,var(--water),var(--fire))"></div></div>' +
        '<span class="bar-val">' + r.tiaohou.warmth + ' ' + esc(r.tiaohou.warmthLabel) + '</span></div>' +
        '<div class="bar-row"><span>燥湿</span><div class="bar-track"><div class="bar-fill" style="width:' + r.tiaohou.dryness + '%;background:linear-gradient(90deg,var(--water),var(--earth))"></div></div>' +
        '<span class="bar-val">' + r.tiaohou.dryness + ' ' + esc(r.tiaohou.drynessLabel) + '</span></div>' +
        '<p style="font-size:13px;color:var(--ink-soft)">' + esc(r.tiaohou.climate.text) + '</p></div>';

    html += '<div class="card"><h2>干支能量明细</h2><div class="tbl-wrap"><table><thead><tr><th>柱</th><th>干支</th><th>五行</th><th>能量</th><th>通根</th></tr></thead><tbody>' +
        m.topology.nodes.map(function (n) {
            var p = r.pillars.filter(function (x) { return x.key === n.pillarKey; })[0];
            var root = n.kind === '天干' && p && p.rootNote ? p.rootNote : '—';
            return '<tr><td>' + esc(p ? p.name : n.pillarKey) + '</td><td class="gz-cell">' + wxSpan(n.char, n.wx) + '</td><td>' + esc(n.wx) + '</td>' +
                '<td>' + n.power.toFixed(2) + '</td><td class="note-cell">' + esc(root) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    $('page-wuxing').innerHTML = html;
}

/* ---------------- 格局用神页 ---------------- */
function renderGeju(r) {
    var g = r.geju, y = r.yongshen;
    var html = '<div class="card"><h2>格局</h2>' +
        '<p style="font-size:22px;font-weight:700;letter-spacing:3px">' + esc(g.name) +
        ' <span class="lv-tag ' + lvCls(g.success.level) + '">' + esc(g.success.status) + '</span></p>' +
        '<p>' + esc(g.basis) + '</p>' +
        '<p style="color:var(--ink-soft)">' + esc(g.description) + '</p>' +
        '<p style="font-size:13.5px">成败：' + esc(g.success.reason) + '</p>' +
        '<div class="tag-row">' + g.success.combos.map(function (x) { return '<span class="tag" style="color:var(--good)">成 · ' + esc(x) + '</span>'; }).join('') +
        g.success.breaks.map(function (x) { return '<span class="tag" style="color:var(--bad)">防 · ' + esc(x) + '</span>'; }).join('') + '</div></div>';

    html += '<div class="card"><h2>用神喜忌</h2>' +
        '<p style="font-size:16px">喜用 <b class="wx-' + esc(y.favorable[0] || '') + '">' + esc(y.favorableText) + '</b> ｜ 忌 <b>' + esc(y.unfavorableText) + '</b></p>' +
        '<p style="font-size:13.5px;color:var(--ink-soft)">' + esc(y.principle) + '</p><h3>五行评分</h3>';
    WX5.forEach(function (w) {
        var v = y.scores[w];
        var wPct = Math.min(Math.abs(v) / 60 * 100, 100);
        var color = v > 5 ? 'var(--good)' : (v < -5 ? 'var(--bad)' : 'var(--mid)');
        html += '<div class="bar-row"><span class="wx-' + w + '" style="font-weight:700">' + w + '</span>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + wPct + '%;background:' + color + '"></div></div>' +
            '<span class="bar-val ' + scoreCls(v) + '">' + (v > 0 ? '+' : '') + pct1(v) + '</span></div>';
    });
    html += '<h3>评分依据</h3><div class="tbl-wrap"><table><thead><tr><th>五行</th><th>依据</th><th>分值</th></tr></thead><tbody>';
    WX5.forEach(function (w) {
        (y.reasons[w] || []).forEach(function (x, i) {
            html += '<tr><td>' + (i === 0 ? '<b class="wx-' + w + '">' + w + '</b>' : '') + '</td>' +
                '<td class="note-cell">' + esc(x.why) + '</td><td class="' + scoreCls(x.v) + '">' + (x.v > 0 ? '+' : '') + pct1(x.v) + '</td></tr>';
        });
    });
    html += '</tbody></table></div></div>';

    var t = r.tiaohou;
    html += '<div class="card"><h2>调候</h2>' +
        '<p>《穷通宝鉴》' + esc(r.chart.dayGan) + '日' + esc(r.chart.monthZhi) + '月取 <b>' + esc(t.classical || '无') + '</b>；调候用 <b>' + esc(t.primary || '无') + '</b>' + (t.secondary ? '、' + esc(t.secondary) : '') + '，权重 ' + t.weight + '%。</p>' +
        '<p style="font-size:13.5px;color:var(--ink-soft)">' + esc(t.note) + '</p></div>';

    var d = r.disease;
    html += '<div class="card"><h2>病药</h2>';
    if (d.hasDisease && d.primary) {
        html += '<p style="font-size:16px"><b>' + esc(d.primary.name) + '</b>（严重度 ' + d.primary.severity + '）</p>' +
            '<p>病在 ' + esc(d.primary.diseaseElements.join('、')) + '，药取 <b>' + esc(d.primary.medicine) + '</b>' + (d.primary.assistant ? '，佐 ' + esc(d.primary.assistant) : '') + '。</p>' +
            '<p style="font-size:13.5px;color:var(--ink-soft)">' + esc(d.primary.note) + '</p>';
    } else html += '<p>原局无明显之病，以流通平衡为要。</p>';
    html += '</div>';

    html += '<div class="card"><h2>流通与做功</h2><div class="rel-list">' +
        r.flow.chain.map(function (ch) {
            return '<div class="rel-item"><span class="rel-pair">' + esc(ch.from) + ' → ' + esc(ch.to) + '</span>' +
                '<span class="lv-tag ' + (ch.quality >= 60 ? 'lv-good' : ch.quality >= 35 ? 'lv-mid' : 'lv-bad') + '">' + esc(ch.state) + ' ' + ch.quality + '</span>' +
                '<span class="rel-note">' + esc(ch.note) + '</span></div>';
        }).join('') + '</div>' +
        '<p style="margin-top:10px;font-size:13.5px;color:var(--ink-soft)">' + esc(r.flow.text) + '</p></div>';
    $('page-geju').innerHTML = html;
}

/* ---------------- 岁运页 ---------------- */
function renderSuiyun(r) {
    var dy = r.dayun;
    var html = '<div class="card"><h2>大运</h2>' +
        '<p style="font-size:13.5px;color:var(--ink-soft)">' + esc(dy.direction) + ' · ' + esc(dy.directionReason) + ' · ' + esc(dy.startText) + '起运（' + esc(dy.startDate) + '）</p>' +
        '<div class="dayun-strip">' + dy.list.map(function (d, i) {
            return '<div class="dy-cell' + (d.isCurrent ? ' current' : '') + '" data-dy="' + i + '" title="' + esc(d.notes.join('；')) + '">' +
                '<div class="dy-gz">' + wxSpan(d.gan, d.ganWx) + wxSpan(d.zhi, d.zhiWx) + '</div>' +
                '<div class="dy-age">' + d.ageStart + '–' + d.ageEnd + '岁</div>' +
                '<div class="dy-age">' + d.yearStart + '–' + d.yearEnd + '</div>' +
                '<div class="dy-score ' + scoreCls(d.score) + '">' + (d.score > 0 ? '+' : '') + pct1(d.score) + '</div>' +
                '<div><span class="lv-tag ' + lvCls(d.levelKey) + '">' + esc(d.level) + '</span></div></div>';
        }).join('') + '</div>' +
        '<p style="font-size:12px;color:var(--ink-faint);margin-top:8px">点击大运可筛选对应流年。</p></div>';

    html += '<div class="card"><h2>人生窗口（应期年月联动）</h2><div class="liuyue-grid">';
    var wins = r.milestones.windows;
    var winNames = { career: '事业跃升', wealth: '财富开库', love: '婚恋喜庆', caution: '重点防守' };
    Object.keys(winNames).forEach(function (k) {
        var w = wins[k];
        if (!w) return;
        html += '<div class="ly-card' + (k === 'caution' ? '" style="border-color:var(--bad)' : '') + '">' +
            '<div class="ly-head"><span class="ly-title">' + winNames[k] + '</span><span class="lv-tag ' + lvCls(k === 'caution' ? 'bad' : 'good') + '">' + w.year + ' ' + esc(w.ganzhi) + '</span></div>' +
            '<div class="ly-range">' + w.age + '岁 · ' + esc(w.dayun) + '运 · <span class="' + scoreCls(w.score) + '">' + (w.score > 0 ? '+' : '') + pct1(w.score) + '</span></div>' +
            '<div class="ly-notes">' + esc(w.note) + '</div>' +
            (w.months && w.months.length ? '<div class="ly-notes"><b>应期流月：</b><ul>' + w.months.map(function (mo) {
                return '<li>' + esc(mo.month) + ' ' + esc(mo.ganzhi) + '（' + esc(mo.jieqi) + '起，' + esc(mo.start.slice(5, 10)) + '）<span class="' + scoreCls(mo.score) + '">' + (mo.score > 0 ? '+' : '') + pct1(mo.score) + '</span></li>';
            }).join('') + '</ul></div>' : '') +
            '</div>';
    });
    html += '</div><p style="font-size:13px;color:var(--ink-soft);margin-top:10px">' + esc(r.milestones.summary) + '</p></div>';

    html += '<div class="card"><h2>流年</h2><div class="seg" id="liunianFilter" style="max-width:520px;margin-bottom:12px">' +
        '<button type="button" class="seg-btn' + (state.liunianFilter === 'future' ? ' active' : '') + '" data-lf="future">未来十年</button>' +
        '<button type="button" class="seg-btn' + (state.liunianFilter === 'past' ? ' active' : '') + '" data-lf="past">过去复盘</button>' +
        '<button type="button" class="seg-btn' + (state.liunianFilter === 'all' ? ' active' : '') + '" data-lf="all">全部</button>' +
        '</div><div class="tbl-wrap"><table><thead><tr><th>年份</th><th>干支</th><th>虚岁</th><th>大运</th><th>十神</th><th>评分</th><th>等级</th><th>要点</th></tr></thead><tbody id="liunianBody"></tbody></table></div></div>';

    $('page-suiyun').innerHTML = html;
    document.querySelectorAll('#liunianFilter .seg-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            state.liunianFilter = b.dataset.lf;
            document.querySelectorAll('#liunianFilter .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
            renderLiunianRows();
        });
    });
    document.querySelectorAll('.dy-cell').forEach(function (cell) {
        cell.addEventListener('click', function () {
            state.liunianFilter = Number(cell.dataset.dy);
            document.querySelectorAll('#liunianFilter .seg-btn').forEach(function (x) { x.classList.remove('active'); });
            renderLiunianRows();
        });
    });
    renderLiunianRows();
}

function renderLiunianRows() {
    var r = state.report;
    var nowY = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
    var list = r.liunian.filter(function (n) {
        if (state.liunianFilter === 'future') return n.year >= nowY;
        if (state.liunianFilter === 'past') return n.year < nowY;
        if (typeof state.liunianFilter === 'number') {
            var d = r.dayun.list[state.liunianFilter];
            return d && n.year >= d.yearStart && n.year <= d.yearEnd;
        }
        return true;
    });
    $('liunianBody').innerHTML = list.map(function (n) {
        return '<tr class="' + (n.isCurrent ? 'row-current ' : '') + 'row-' + n.levelKey + '">' +
            '<td>' + n.year + (n.isCurrent ? ' <b style="color:var(--cinnabar)">今年</b>' : '') + '</td>' +
            '<td class="gz-cell">' + wxSpan(n.gan, n.ganWx) + wxSpan(n.zhi, n.zhiWx) + '</td>' +
            '<td>' + n.age + '</td><td class="gz-cell">' + esc(n.dayunGanzhi) + '</td>' +
            '<td>' + esc(n.shishen) + '</td>' +
            '<td class="' + scoreCls(n.score) + '">' + (n.score > 0 ? '+' : '') + pct1(n.score) + '</td>' +
            '<td><span class="lv-tag ' + lvCls(n.levelKey) + '">' + esc(n.level) + '</span> <span style="color:var(--earth)">' + stars(n.stars) + '</span></td>' +
            '<td class="note-cell">' + esc(n.notes.slice(0, 3).join('；')) + '</td></tr>';
    }).join('');
}

/* ---------------- 流月页 ---------------- */
function renderLiuyue(r) {
    var nowY = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
    var year = state.liuyueYear || nowY;
    var data = year === nowY ? r.liuyue : I.computeLiuYue(r.chart, r.model, r.yongshen, r.strength, r.dayun, year);
    var html = '<div class="card"><h2>流月推演</h2>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">' +
        '<button type="button" class="btn small ghost" id="lyPrev">← 上年</button>' +
        '<b style="font-size:18px;letter-spacing:2px">' + data.year + ' ' + esc(data.yearGanzhi) + '年</b>' +
        '<button type="button" class="btn small ghost" id="lyNext">下年 →</button>' +
        '<input type="number" id="lyYearInput" min="1900" max="2100" value="' + data.year + '" style="width:90px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-family:var(--serif)">' +
        '<button type="button" class="btn small ghost" id="lyGo">跳转</button></div>' +
        '<div class="liuyue-grid">' + data.list.map(function (mo) {
            return '<div class="ly-card' + (mo.isCurrent ? ' current' : '') + '">' +
                '<div class="ly-head"><span class="ly-title">' + esc(mo.month) + ' ' + wxSpan(mo.gan, mo.ganWx) + wxSpan(mo.zhi, mo.zhiWx) + '</span>' +
                '<span class="lv-tag ' + lvCls(mo.levelKey) + '">' + esc(mo.level) + ' <span class="' + scoreCls(mo.score) + '">' + (mo.score > 0 ? '+' : '') + pct1(mo.score) + '</span></span></div>' +
                '<div class="ly-range">' + esc(mo.jieqi) + ' ' + esc(mo.start.slice(5, 16)) + ' → ' + esc(mo.end.slice(5, 16)) + ' · ' + esc(mo.shishen) + ' · ' + esc(mo.dayunGanzhi === '未起运' ? '未起运' : mo.dayunGanzhi + '运') + (mo.isCurrent ? ' · <b style="color:var(--cinnabar)">本月</b>' : '') + '</div>' +
                (mo.notes.length ? '<ul class="ly-notes">' + mo.notes.slice(0, 4).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
                '</div>';
        }).join('') + '</div></div>';
    $('page-liuyue').innerHTML = html;
    $('lyPrev').addEventListener('click', function () { state.liuyueYear = data.year - 1; renderLiuyue(state.report); });
    $('lyNext').addEventListener('click', function () { state.liuyueYear = data.year + 1; renderLiuyue(state.report); });
    $('lyGo').addEventListener('click', function () {
        var y = parseInt($('lyYearInput').value, 10);
        if (y >= 1900 && y <= 2100) { state.liuyueYear = y; renderLiuyue(state.report); }
        else toast('年份须在 1900–2100 之间');
    });
}

/* ---------------- 断语页 ---------------- */
function renderDuanyu(r) {
    var html = '<div class="card"><h2>总断</h2><div class="narrative">' + esc(r.narrative) + '</div></div>';

    html += '<div class="card"><h2>分项建议</h2>' + r.advice.map(function (a) {
        return '<div class="advice-card"><div class="advice-kicker">' + esc(a.kicker) + '</div>' +
            '<div class="advice-title">' + esc(a.title) + '</div><div class="advice-body">' + esc(a.body) + '</div></div>';
    }).join('') + '</div>';

    var c = r.career;
    html += '<div class="card"><h2>事业财运</h2><p>' + esc(c.summary) + '</p>' +
        '<h3>做功模式</h3><div class="tag-row">' + c.patterns.map(function (p) {
            return '<span class="tag">' + esc(p.name) + ' ' + pct1(p.score) + '</span>';
        }).join('') + '</div>' +
        '<h3>求财模式</h3>' + c.modes.map(function (mo) {
            return '<div class="bar-row"><span style="min-width:110px">' + esc(mo.name) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + Math.min(mo.score, 100) + '%;background:var(--earth)"></div></div>' +
                '<span class="bar-val">' + pct1(mo.score) + '</span></div>';
        }).join('') +
        '<p style="font-size:13px;color:var(--ink-soft)">' + esc(c.primaryMode.desc) + '</p>' +
        (c.traps.length ? '<h3>风险提示</h3><ul style="font-size:13.5px;color:var(--ink-soft)">' + c.traps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';

    var f = r.family;
    html += '<div class="card"><h2>六亲家庭</h2>';
    ['parents', 'marriage', 'children', 'social'].forEach(function (k) {
        var x = f[k];
        html += '<h3>' + esc(x.title) + '</h3><p style="font-size:14px;color:var(--ink-soft)">' + esc(x.text) + '</p>' +
            '<div class="tag-row">' + x.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>';
        if (x.windows && x.windows.length) {
            html += '<p style="font-size:13px;margin-top:6px">窗口：' + x.windows.map(function (w) {
                return w.year + '（' + esc(w.ganzhi) + '，' + esc((w.reasons || []).join('、')) + '）';
            }).join('；') + '</p>';
        }
        if (x.crisis && x.crisis.length) {
            html += '<p style="font-size:13px;color:var(--bad)">磨合：' + x.crisis.map(function (w) { return w.year + '（' + esc(w.ganzhi) + '）'; }).join('；') + '</p>';
        }
    });
    html += '</div>';

    var h = r.health;
    html += '<div class="card"><h2>健康体质</h2>' +
        '<p><b>' + esc(h.constitution.label) + '</b> — ' + esc(h.constitution.text) + '</p>' +
        '<h3>重点养护</h3><div class="tbl-wrap"><table><thead><tr><th>系统</th><th>状态</th><th>依据</th></tr></thead><tbody>' +
        h.riskOrgans.slice(0, 6).map(function (o) {
            return '<tr><td>' + esc(o.name) + '</td><td>' + esc(o.stateText) + '</td><td class="note-cell">' + esc(o.source) + (o.note ? ' · ' + esc(o.note) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<h3>调养建议</h3>' + h.prescriptions.map(function (p) {
            return '<div class="advice-card"><div class="advice-title">' + esc(p.title) + '</div><div class="advice-body">' + esc(p.body) + '</div></div>';
        }).join('') + '</div>';

    html += '<div class="card"><h2>星宫同参</h2>' + r.palaces.list.map(function (p) {
        return '<div class="advice-card"><div class="advice-kicker">' + esc(p.name) + ' · ' + esc(p.domain) + '</div>' +
            '<div class="advice-title">' + esc(p.ganzhi) + ' <span class="lv-tag ' + (p.state === 'fav' ? 'lv-good' : p.state === 'bad' ? 'lv-bad' : 'lv-mid') + '">' + esc(p.stateText) + '</span></div>' +
            '<div class="advice-body">' + esc(p.reading) + '</div></div>';
    }).join('') +
    '<p style="font-size:13.5px;color:var(--ink-soft)">' + esc(r.palaces.spouseText) + '</p></div>';
    $('page-duanyu').innerHTML = html;
}

/* ---------------- 合盘页 ---------------- */
function renderHepanShell() {
    var html = '<div class="card"><h2>双人合盘</h2>' +
        '<p style="font-size:13px;color:var(--ink-faint)">甲方为当前命盘。录入乙方生辰，合婚看姻缘磨合，合伙看事业分工。</p>' +
        '<div class="input-grid" style="margin-top:12px">' +
        '<label class="field"><span class="field-label">乙方姓名</span><input type="text" id="synName" maxlength="20"></label>' +
        '<div class="field"><span class="field-label">乙方性别</span><div class="seg" id="synGenderSeg">' +
        '<button type="button" class="seg-btn" data-sg="male">男</button><button type="button" class="seg-btn active" data-sg="female">女</button></div></div>' +
        '<label class="field"><span class="field-label">出生日期（公历）</span><input type="date" id="synDate" min="1900-01-01" max="2100-12-31"></label>' +
        '<label class="field"><span class="field-label">出生时间</span><input type="time" id="synTime" value="12:00"></label>' +
        '<div class="field"><span class="field-label">时辰</span><div class="seg" id="synHourSeg">' +
        '<button type="button" class="seg-btn active" data-sh="0">已知</button><button type="button" class="seg-btn" data-sh="1">未知</button></div></div>' +
        '<div class="field"><span class="field-label">模式</span><div class="seg" id="synModeSeg">' +
        '<button type="button" class="seg-btn active" data-sm="marriage">合婚</button><button type="button" class="seg-btn" data-sm="business">合伙</button></div></div>' +
        '</div><div class="input-foot"><button type="button" class="btn primary" id="btnSyn">合盘</button></div></div>' +
        '<div id="synResult"></div>';
    $('page-hepan').innerHTML = html;
    [['synGenderSeg', 'sg'], ['synHourSeg', 'sh'], ['synModeSeg', 'sm']].forEach(function (cfg) {
        document.querySelectorAll('#' + cfg[0] + ' .seg-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                document.querySelectorAll('#' + cfg[0] + ' .seg-btn').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active');
            });
        });
    });
    $('btnSyn').addEventListener('click', computeSynastry);
    if (state.synastry) renderSynastry(state.synastry);
}

function computeSynastry() {
    var date = $('synDate').value;
    if (!date) { toast('请录入乙方出生日期'); return; }
    var hourUnknown = document.querySelector('#synHourSeg .seg-btn.active').dataset.sh === '1';
    var gender = document.querySelector('#synGenderSeg .seg-btn.active').dataset.sg;
    var mode = document.querySelector('#synModeSeg .seg-btn.active').dataset.sm;
    try {
        var birth = B.parseBirthInput(date + (hourUnknown ? '' : ' ' + ($('synTime').value || '12:00')), '', { hourUnknown: hourUnknown });
        birth.gender = gender;
        birth.name = $('synName').value.trim() || '乙方';
        birth.params = state.params;
        var rb = B.buildReport(birth);
        var syn = B.computeSynastry(state.report, rb, mode);
        state.synastry = syn;
        renderSynastry(syn);
    } catch (err) { toast('合盘失败：' + err.message); }
}

function renderSynastry(syn) {
    var html = '<div class="card" style="text-align:center">' +
        '<div class="syn-score">' + syn.score + '</div><div class="syn-grade">' + esc(syn.grade) + '</div>' +
        '<p style="font-size:13px;color:var(--ink-faint)">' + esc(syn.modeText) + ' · ' + esc(syn.nameA) + ' × ' + esc(syn.nameB) + '</p></div>';

    html += '<div class="card"><h2>五维评分</h2>' + syn.dims.map(function (d) {
        return '<div class="syn-dim"><div class="syn-dim-head"><span class="syn-dim-name">' + esc(d.name) + '（权重 ' + d.weight + '%）</span>' +
            '<span class="' + scoreCls(d.score - 50) + '">' + d.score + '</span></div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + d.score + '%;background:' + (d.score >= 65 ? 'var(--good)' : d.score >= 45 ? 'var(--earth)' : 'var(--bad)') + '"></div></div>' +
            '<div class="syn-dim-text">' + esc(d.text) + '</div>' +
            '<div class="syn-dim-text" style="color:var(--cinnabar)">建议：' + esc(d.advice) + '</div></div>';
    }).join('') + '</div>';

    html += '<div class="card"><h2>双方命盘</h2><div class="tbl-wrap"><table><thead><tr><th></th><th>四柱</th><th>日主</th><th>身强弱</th><th>格局</th><th>用神</th></tr></thead><tbody>' +
        ['a', 'b'].map(function (k) {
            var c = syn.charts[k];
            return '<tr><td><b>' + esc(c.name) + '</b> ' + esc(c.genderText) + '</td><td class="gz-cell">' + c.pillars.map(esc).join(' ') + '</td>' +
                '<td>' + esc(c.dayGan) + esc(c.dayWx) + '</td><td>' + esc(c.strength) + ' ' + pct1(c.ratio) + '%</td>' +
                '<td>' + esc(c.geju) + '</td><td>' + esc(c.yongshen) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p style="font-size:13.5px;margin-top:8px">角色：' + esc(syn.roles.a.name) + '（' + esc(syn.nameA) + '） × ' + esc(syn.roles.b.name) + '（' + esc(syn.nameB) + '）</p></div>';

    html += '<div class="card"><h2>未来十年岁运同步</h2><div class="tbl-wrap"><table><thead><tr><th>年份</th><th>' + esc(syn.nameA) + '</th><th>' + esc(syn.nameB) + '</th><th>态势</th><th>提示</th></tr></thead><tbody>' +
        syn.yearSync.map(function (y) {
            return '<tr class="row-' + y.key + '"><td>' + y.year + '</td>' +
                '<td class="gz-cell">' + esc(y.ganzhiA) + ' <span class="' + scoreCls(y.scoreA) + '">' + (y.scoreA > 0 ? '+' : '') + pct1(y.scoreA) + '</span></td>' +
                '<td class="gz-cell">' + esc(y.ganzhiB) + ' <span class="' + scoreCls(y.scoreB) + '">' + (y.scoreB > 0 ? '+' : '') + pct1(y.scoreB) + '</span></td>' +
                '<td><span class="lv-tag ' + lvCls(y.key) + '">' + esc(y.state) + '</span></td>' +
                '<td class="note-cell">' + esc(y.note) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';

    html += '<div class="card"><h2>经营建议</h2>' + syn.advice.map(function (a) {
        return '<div class="advice-card"><div class="advice-body">' + esc(a) + '</div></div>';
    }).join('') +
    '<h3>风险清单</h3><ul style="font-size:13.5px;color:var(--ink-soft)">' + syn.risks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    $('synResult').innerHTML = html;
}

/* ---------------- 复盘页 ---------------- */
function predictNature(score) { return score >= 15 ? '吉' : (score <= -15 ? '凶' : '平'); }

function renderFupan(r) {
    var yearMap = {};
    r.liunian.forEach(function (n) { yearMap[n.year] = n; });
    var events = state.events;
    var hits = 0, jiTotal = 0, jiHit = 0, xiongTotal = 0, xiongHit = 0;
    events.forEach(function (ev) {
        var n = yearMap[ev.year];
        ev._score = n ? n.score : null;
        ev._pred = n ? predictNature(n.score) : null;
        ev._hit = ev._pred != null && ev.nature !== '平' && ev._pred === ev.nature;
        if (ev.nature !== '平' && ev._pred != null) {
            if (ev._hit) hits++;
            if (ev.nature === '吉') { jiTotal++; if (ev._hit) jiHit++; }
            if (ev.nature === '凶') { xiongTotal++; if (ev._hit) xiongHit++; }
        }
    });
    var judged = events.filter(function (e) { return e.nature !== '平' && e._pred != null; }).length;
    var rate = judged ? Math.round(hits / judged * 100) : null;

    var html = '<div class="card"><h2>事件标注与回测</h2>' +
        '<p style="font-size:13px;color:var(--ink-faint)">标注已发生的人生事件，引擎以流年评分（≥15 吉 / ≤-15 凶）回测命中率，用于校准参数与研判思路。事件随案例保存。</p>' +
        '<div class="backtest-summary" style="margin-top:12px">' +
        '<div><div class="bt-num">' + (rate == null ? '—' : rate + '%') + '</div><div class="bt-label">总命中率（' + hits + '/' + judged + '）</div></div>' +
        '<div><div class="bt-num">' + (jiTotal ? Math.round(jiHit / jiTotal * 100) + '%' : '—') + '</div><div class="bt-label">吉事命中（' + jiHit + '/' + jiTotal + '）</div></div>' +
        '<div><div class="bt-num">' + (xiongTotal ? Math.round(xiongHit / xiongTotal * 100) + '%' : '—') + '</div><div class="bt-label">凶事命中（' + xiongHit + '/' + xiongTotal + '）</div></div>' +
        '<div><div class="bt-num">' + events.length + '</div><div class="bt-label">已标注事件</div></div></div>' +
        '<div class="event-form">' +
        '<label class="field"><span class="field-label">年份</span><input type="number" id="evYear" min="1900" max="2100" placeholder="2020"></label>' +
        '<label class="field"><span class="field-label">类型</span><select id="evType">' + EVENT_TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></label>' +
        '<div class="field"><span class="field-label">性质</span><div class="seg" id="evNatureSeg">' +
        '<button type="button" class="seg-btn active" data-en="吉">吉</button><button type="button" class="seg-btn" data-en="凶">凶</button><button type="button" class="seg-btn" data-en="平">平</button></div></div>' +
        '<label class="field"><span class="field-label">备注</span><input type="text" id="evNote" placeholder="如：结婚 / 跳槽 / 手术" maxlength="60"></label>' +
        '<button type="button" class="btn primary" id="btnAddEvent" style="letter-spacing:2px">标注</button></div>' +
        '<div id="eventList" style="margin-top:14px"></div></div>';

    html += '<div class="card"><h2>复盘说明</h2><p style="font-size:13.5px;color:var(--ink-soft)">' +
        '回测以流年干支对原局的扶抑喜忌评分为依据，未含流月应期与个人选择因素；命中率用于检验模型倾向，而非断定因果。' +
        '样本越多越有参考价值，建议至少标注 8 件以上性质明确的事件。凶事未命中而吉事命中偏高时，可在参数页适当下调岁运振幅或上调从格阈值再试。</p></div>';
    $('page-fupan').innerHTML = html;

    document.querySelectorAll('#evNatureSeg .seg-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            document.querySelectorAll('#evNatureSeg .seg-btn').forEach(function (x) { x.classList.remove('active'); });
            b.classList.add('active');
        });
    });
    $('btnAddEvent').addEventListener('click', function () {
        var y = parseInt($('evYear').value, 10);
        if (!y || y < 1900 || y > 2100) { toast('请填写有效年份'); return; }
        state.events.push({
            id: 'ev' + Date.now(),
            year: y,
            type: $('evType').value,
            nature: document.querySelector('#evNatureSeg .seg-btn.active').dataset.en,
            note: $('evNote').value.trim()
        });
        $('evYear').value = '';
        $('evNote').value = '';
        persistEvents();
        renderFupan(state.report);
    });
    renderEventList();
}

function renderEventList() {
    var box = $('eventList');
    if (!box) return;
    if (!state.events.length) {
        box.innerHTML = '<p style="color:var(--ink-faint);font-size:14px">尚未标注事件。</p>';
        return;
    }
    box.innerHTML = state.events.slice().sort(function (a, b) { return a.year - b.year; }).map(function (ev) {
        var badge = ev._pred == null ? '<span class="hit-badge hit-flat">超出流年范围</span>'
            : ev.nature === '平' ? '<span class="hit-badge hit-flat">平 · 不计入</span>'
            : ev._hit ? '<span class="hit-badge hit-yes">命中</span>' : '<span class="hit-badge hit-no">未中</span>';
        return '<div class="event-item"><span class="event-year">' + ev.year + '</span>' +
            '<span class="tag">' + esc(ev.type) + ' · ' + esc(ev.nature) + '</span>' +
            '<span>流年 <span class="' + scoreCls(ev._score || 0) + '">' + (ev._score != null ? (ev._score > 0 ? '+' : '') + pct1(ev._score) : '—') + '</span> 判' + esc(ev._pred || '—') + '</span>' +
            badge +
            (ev.note ? '<span style="color:var(--ink-soft)">' + esc(ev.note) + '</span>' : '') +
            '<button type="button" class="btn small ghost" data-del-ev="' + ev.id + '">删除</button></div>';
    }).join('');
    box.querySelectorAll('[data-del-ev]').forEach(function (b) {
        b.addEventListener('click', function () {
            state.events = state.events.filter(function (e) { return e.id !== b.dataset.delEv; });
            persistEvents();
            renderFupan(state.report);
        });
    });
}

function persistEvents() {
    if (!state.caseId) return;
    var cases = loadCases();
    var c = cases.filter(function (x) { return x.id === state.caseId; })[0];
    if (c) { c.events = state.events; c.updatedAt = Date.now(); saveCases(cases); }
}

/* ---------------- 参数页 ---------------- */
function renderParams() {
    var html = '<div class="card"><h2>模型参数</h2>' +
        '<p style="font-size:13px;color:var(--ink-faint)">参数即时生效并重算全盘；随案例与分享链接保存。不同流派可在此校准，复盘命中率是检验标准。</p>' +
        '<div class="param-grid" style="margin-top:14px">' +
        PARAM_DEFS.map(function (d) {
            return '<div class="param-item"><div class="param-head"><span class="param-name">' + d.name + '</span>' +
                '<span class="param-val" id="pv-' + d.key + '">' + state.params[d.key] + '</span></div>' +
                '<div class="param-desc">' + d.desc + '（默认 ' + I.defaultParams()[d.key] + '）</div>' +
                '<input type="range" data-param="' + d.key + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + state.params[d.key] + '"></div>';
        }).join('') + '</div>' +
        '<div class="input-foot"><button type="button" class="btn ghost" id="btnResetParams">恢复默认</button>' +
        '<span class="input-note">当前：' + esc(state.report.geju.name) + ' · ' + esc(state.report.strength.status) + ' ' + pct1(state.report.strength.ratio) + '% · 用神 ' + esc(state.report.yongshen.favorableText) + '</span></div></div>';
    $('page-params').innerHTML = html;

    var recompute = debounce(function () {
        state.report = null;
        var f = state.form;
        writeForm(f);
        compute();
    }, 250);
    document.querySelectorAll('[data-param]').forEach(function (s) {
        s.addEventListener('input', function () {
            state.params[s.dataset.param] = parseFloat(s.value);
            $('pv-' + s.dataset.param).textContent = s.value;
            recompute();
        });
    });
    $('btnResetParams').addEventListener('click', function () {
        state.params = I.defaultParams();
        renderParams();
        recompute();
    });
}

/* ---------------- 案例库 ---------------- */
var CASE_KEY = 'bazi.cases.v1';
function loadCases() {
    try { return JSON.parse(localStorage.getItem(CASE_KEY) || '[]'); }
    catch (e) { return []; }
}
function saveCases(cases) {
    try { localStorage.setItem(CASE_KEY, JSON.stringify(cases)); }
    catch (e) { toast('本地存储不可用（隐私模式？）'); }
}
function snapshot(r) {
    return {
        pillars: r.meta.chartText,
        geju: r.geju.name,
        strength: r.strength.status,
        yongshen: r.yongshen.favorableText
    };
}
function saveCurrentCase() {
    if (!state.report) return;
    var cases = loadCases();
    var now = Date.now();
    if (state.caseId) {
        var c = cases.filter(function (x) { return x.id === state.caseId; })[0];
        if (c) {
            c.name = state.form.name || c.name;
            c.form = state.form;
            c.params = state.params;
            c.events = state.events;
            c.snapshot = snapshot(state.report);
            c.updatedAt = now;
            saveCases(cases);
            toast('案例已更新');
            return;
        }
    }
    var nc = {
        id: 'c' + now,
        name: state.form.name || '未命名 ' + state.report.meta.chartText,
        form: state.form,
        params: state.params,
        events: state.events,
        snapshot: snapshot(state.report),
        createdAt: now,
        updatedAt: now
    };
    cases.unshift(nc);
    saveCases(cases);
    state.caseId = nc.id;
    toast('已存入案例库');
}
function loadCase(id) {
    var c = loadCases().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    state.caseId = c.id;
    state.params = Object.assign(I.defaultParams(), c.params || {});
    state.events = c.events || [];
    writeForm(c.form);
    closeDrawer();
    compute();
    toast('已载入案例：' + c.name);
}
function deleteCase(id) {
    saveCases(loadCases().filter(function (x) { return x.id !== id; }));
    if (state.caseId === id) state.caseId = null;
    renderCaseList();
    toast('案例已删除');
}
function renderCaseList() {
    var q = $('caseSearch').value.trim().toLowerCase();
    var cases = loadCases().filter(function (c) {
        if (!q) return true;
        var hay = (c.name + ' ' + (c.snapshot ? c.snapshot.pillars + ' ' + c.snapshot.geju : '')).toLowerCase();
        return hay.indexOf(q) !== -1;
    });
    var box = $('caseList');
    if (!cases.length) {
        box.innerHTML = '<div class="case-empty">' + (q ? '无匹配案例' : '案例库为空。排盘后点击「存入案例库」。') + '</div>';
        return;
    }
    box.innerHTML = cases.map(function (c) {
        var d = new Date(c.updatedAt);
        var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return '<div class="case-item"><div class="case-item-head"><span class="case-name">' + esc(c.name) + '</span>' +
            '<span class="case-meta">' + dateStr + '</span></div>' +
            '<div class="case-pillars">' + esc(c.snapshot ? c.snapshot.pillars : '') + '</div>' +
            '<div class="case-meta">' + esc(c.snapshot ? c.snapshot.geju + ' · ' + c.snapshot.strength + ' · 用神 ' + c.snapshot.yongshen : '') +
            ' · 事件 ' + (c.events || []).length + '</div>' +
            '<div class="case-btns"><button type="button" class="btn small" data-load="' + c.id + '">载入</button>' +
            '<button type="button" class="btn small ghost" data-export="' + c.id + '">导出</button>' +
            '<button type="button" class="btn small ghost" data-del="' + c.id + '">删除</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-load]').forEach(function (b) { b.addEventListener('click', function () { loadCase(b.dataset.load); }); });
    box.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { deleteCase(b.dataset.del); }); });
    box.querySelectorAll('[data-export]').forEach(function (b) {
        b.addEventListener('click', function () {
            var c = loadCases().filter(function (x) { return x.id === b.dataset.export; })[0];
            if (c) download('八字案例-' + c.name + '.json', JSON.stringify(c, null, 2), 'application/json');
        });
    });
}
function openDrawer() {
    $('caseDrawer').hidden = false;
    $('drawerMask').hidden = false;
    renderCaseList();
}
function closeDrawer() {
    $('caseDrawer').hidden = true;
    $('drawerMask').hidden = true;
}

/* ---------------- 分享 / 导出 / 打印 / 批量 ---------------- */
function b64urlEncode(obj) {
    var json = JSON.stringify(obj);
    var bytes = new TextEncoder().encode(json);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
}
function shareCurrent() {
    if (!state.form) { toast('请先排盘'); return; }
    var payload = { f: state.form, p: state.params };
    var url = location.origin + location.pathname + '#p=' + b64urlEncode(payload);
    history.replaceState(null, '', '#p=' + b64urlEncode(payload));
    function done() { toast('分享链接已复制'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    } else { fallbackCopy(url); done(); }
}
function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
}
function exportReport() {
    if (!state.report) { toast('请先排盘'); return; }
    var name = state.form.name || '命盘';
    download('子平命盘-' + name + '.json', JSON.stringify(state.report, null, 2), 'application/json');
    toast('命盘 JSON 已导出');
}
function batchCsv() {
    var lines = $('batchInput').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) { toast('请先输入批量数据'); return; }
    var rows = [['姓名', '性别', '出生时间', '四柱', '日主', '身强弱', '格局', '用神', '当前大运', '今年流年', '流年评分']];
    var ok = 0, fail = 0;
    lines.forEach(function (line) {
        var parts = line.split(/[,，]/).map(function (x) { return x.trim(); });
        if (parts.length < 3) { fail++; return; }
        var name = parts[0], gender = /女|female|f/i.test(parts[1]) ? 'female' : 'male', dt = parts[2];
        try {
            var birth = B.parseBirthInput(dt, '', {});
            birth.gender = gender;
            birth.name = name;
            var r = B.buildReport(birth);
            var cur = r.liunian.filter(function (n) { return n.isCurrent; })[0];
            var dy = r.dayun.list.filter(function (d) { return d.isCurrent; })[0];
            rows.push([name, gender === 'male' ? '男' : '女', dt, r.meta.chartText, r.chart.dayGan + r.chart.dayWx,
                r.strength.status + ' ' + pct1(r.strength.ratio) + '%', r.geju.name, r.yongshen.favorableText,
                dy ? dy.ganzhi : '未起运', cur ? cur.ganzhi : '', cur ? cur.score : '']);
            ok++;
        } catch (e) { fail++; }
    });
    var csv = '﻿' + rows.map(function (row) {
        return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    download('批量排盘.csv', csv, 'text/csv;charset=utf-8');
    toast('成功 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''));
}

/* ---------------- 分页 ---------------- */
function initTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () {
            document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
            document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + t.dataset.tab); });
        });
    });
}

/* ---------------- 初始化 ---------------- */
function init() {
    initForm();
    initTabs();
    $('btnCompute').addEventListener('click', function (e) { e.preventDefault(); compute(); });
    $('btnSaveCase').addEventListener('click', saveCurrentCase);
    $('btnCases').addEventListener('click', openDrawer);
    $('btnCloseDrawer').addEventListener('click', closeDrawer);
    $('drawerMask').addEventListener('click', closeDrawer);
    $('caseSearch').addEventListener('input', debounce(renderCaseList, 150));
    $('btnShare').addEventListener('click', shareCurrent);
    $('btnExport').addEventListener('click', exportReport);
    $('btnPrint').addEventListener('click', function () {
        if (!state.report) { toast('请先排盘'); return; }
        window.print();
    });
    $('btnExportCases').addEventListener('click', function () {
        var cases = loadCases();
        if (!cases.length) { toast('案例库为空'); return; }
        download('八字案例库.json', JSON.stringify(cases, null, 2), 'application/json');
    });
    $('btnImportCases').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
        var file = $('importFile').files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var data = JSON.parse(reader.result);
                var arr = Array.isArray(data) ? data : [data];
                var cases = loadCases();
                var added = 0;
                arr.forEach(function (c) {
                    if (!c || !c.form || !c.id) return;
                    if (cases.some(function (x) { return x.id === c.id; })) return;
                    cases.unshift(c);
                    added++;
                });
                saveCases(cases);
                renderCaseList();
                toast('导入 ' + added + ' 个案例');
            } catch (e) { toast('导入失败：文件不是有效案例 JSON'); }
            $('importFile').value = '';
        };
        reader.readAsText(file);
    });
    $('btnBatch').addEventListener('click', batchCsv);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
    });

    if (location.hash.indexOf('#p=') === 0) {
        try {
            var payload = b64urlDecode(location.hash.slice(3));
            if (payload && payload.f) {
                state.params = Object.assign(I.defaultParams(), payload.p || {});
                writeForm(payload.f);
                compute();
                toast('已载入分享命盘');
            }
        } catch (e) { toast('分享链接无效'); }
    }
}

document.addEventListener('DOMContentLoaded', init);
})();