/* =========================================================================
 * 子平命盘 · 动态旺衰与岁运推演引擎
 * 无外部依赖，直接与 index.html 对接。
 * 历法：格里高利历 → 儒略日 → 六十甲子；节气：Meeus 太阳视黄经 + 牛顿迭代。
 * ========================================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * 0. 基础常量
     * ------------------------------------------------------------------- */
    var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    var ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    var WX = ['木', '火', '土', '金', '水'];
    var GAN_WX = {
        甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
        己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水'
    };
    var ZHI_WX = {
        子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
        午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水'
    };
    var GAN_YANG = { 甲: true, 乙: false, 丙: true, 丁: false, 戊: true, 己: false, 庚: true, 辛: false, 壬: true, 癸: false };
    var ZHI_YANG = { 子: true, 丑: false, 寅: true, 卯: false, 辰: true, 巳: false, 午: true, 未: false, 申: true, 酉: false, 戌: true, 亥: false };
    var WX_SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
    var WX_KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
    var WX_SHENG_BY = { 火: '木', 土: '火', 金: '土', 水: '金', 木: '水' };
    var WX_KE_BY = { 土: '木', 水: '土', 火: '水', 金: '火', 木: '金' };
    var WX_CLASS = { 木: 'wx-mu', 火: 'wx-huo', 土: 'wx-tu', 金: 'wx-jin', 水: 'wx-shui' };
    var WX_EMOJI = { 木: '木', 火: '火', 土: '土', 金: '金', 水: '水' };

    var CANG = {
        子: [['癸', 1.0]],
        丑: [['己', 0.6], ['癸', 0.3], ['辛', 0.1]],
        寅: [['甲', 0.6], ['丙', 0.3], ['戊', 0.1]],
        卯: [['乙', 1.0]],
        辰: [['戊', 0.6], ['乙', 0.3], ['癸', 0.1]],
        巳: [['丙', 0.6], ['戊', 0.3], ['庚', 0.1]],
        午: [['丁', 0.7], ['己', 0.3]],
        未: [['己', 0.6], ['丁', 0.3], ['乙', 0.1]],
        申: [['庚', 0.6], ['壬', 0.3], ['戊', 0.1]],
        酉: [['辛', 1.0]],
        戌: [['戊', 0.6], ['辛', 0.3], ['丁', 0.1]],
        亥: [['壬', 0.7], ['甲', 0.3]]
    };

    var GAN_POS = { year: 0.8, month: 1.2, day: 1.0, hour: 0.9 };
    var ZHI_POS = { year: 0.8, month: 2.0, day: 1.2, hour: 0.9 };
    var PILLAR_NAMES = { year: '年柱', month: '月柱', day: '日柱', hour: '时柱' };
    var PILLAR_GONG = { year: '祖上 · 少年', month: '父母 · 兄弟', day: '自身 · 配偶', hour: '子女 · 晚年' };
    var POS_ORDER = { year: 0, month: 1, day: 2, hour: 3 };

    /* 人元司令分野：寅一日起算，月支对应的当令藏干与天数。 */
    var SI_LING = {
        寅: [['戊', 7], ['丙', 7], ['甲', 16]],
        卯: [['甲', 10], ['乙', 20]],
        辰: [['乙', 9], ['癸', 3], ['戊', 18]],
        巳: [['戊', 7], ['庚', 7], ['丙', 16]],
        午: [['丙', 10], ['己', 9], ['丁', 11]],
        未: [['丁', 9], ['乙', 3], ['己', 18]],
        申: [['戊', 7], ['壬', 7], ['庚', 16]],
        酉: [['庚', 10], ['辛', 20]],
        戌: [['辛', 9], ['丁', 3], ['戊', 18]],
        亥: [['戊', 7], ['甲', 7], ['壬', 16]],
        子: [['壬', 10], ['癸', 20]],
        丑: [['癸', 9], ['辛', 3], ['己', 18]]
    };

    var TOMB_ELEMENT = { 辰: '水', 戌: '火', 丑: '金', 未: '木' };
    var WET_EARTH = ['辰', '丑'];
    var DRY_EARTH = ['戌', '未'];

    var LU = { 甲: '寅', 乙: '卯', 丙: '巳', 丁: '午', 戊: '巳', 己: '午', 庚: '申', 辛: '酉', 壬: '亥', 癸: '子' };
    var CHANG_SHENG_START = { 甲: '亥', 乙: '午', 丙: '寅', 丁: '酉', 戊: '寅', 己: '酉', 庚: '巳', 辛: '子', 壬: '申', 癸: '卯' };
    var CHANG_SHENG_ORDER = ['长生', '沐浴', '冠带', '临官', '帝旺', '衰', '病', '死', '墓', '绝', '胎', '养'];

    var SIXTY = [
        '甲子', '乙丑', '丙寅', '丁卯', '戊辰', '己巳', '庚午', '辛未', '壬申', '癸酉',
        '甲戌', '乙亥', '丙子', '丁丑', '戊寅', '己卯', '庚辰', '辛巳', '壬午', '癸未',
        '甲申', '乙酉', '丙戌', '丁亥', '戊子', '己丑', '庚寅', '辛卯', '壬辰', '癸巳',
        '甲午', '乙未', '丙申', '丁酉', '戊戌', '己亥', '庚子', '辛丑', '壬寅', '癸卯',
        '甲辰', '乙巳', '丙午', '丁未', '戊申', '己酉', '庚戌', '辛亥', '壬子', '癸丑',
        '甲寅', '乙卯', '丙辰', '丁巳', '戊午', '己未', '庚申', '辛酉', '壬戌', '癸亥'
    ];

    var NAYIN = [
        '海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火',
        '涧下水', '城头土', '白蜡金', '杨柳木', '泉中水', '屋上土',
        '霹雳火', '松柏木', '长流水', '沙中金', '山下火', '平地木',
        '壁上土', '金箔金', '覆灯火', '天河水', '大驿土', '钗钏金',
        '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水'
    ];

    var YIN_START = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 };

    /* 十二节：从立春开始，order 0 = 寅月 */
    var JIE_DEFS = [
        { name: '立春', lon: 315, zhi: '寅', order: 0 },
        { name: '惊蛰', lon: 345, zhi: '卯', order: 1 },
        { name: '清明', lon: 15, zhi: '辰', order: 2 },
        { name: '立夏', lon: 45, zhi: '巳', order: 3 },
        { name: '芒种', lon: 75, zhi: '午', order: 4 },
        { name: '小暑', lon: 105, zhi: '未', order: 5 },
        { name: '立秋', lon: 135, zhi: '申', order: 6 },
        { name: '白露', lon: 165, zhi: '酉', order: 7 },
        { name: '寒露', lon: 195, zhi: '戌', order: 8 },
        { name: '立冬', lon: 225, zhi: '亥', order: 9 },
        { name: '大雪', lon: 255, zhi: '子', order: 10 },
        { name: '小寒', lon: 285, zhi: '丑', order: 11 }
    ];

    /* 《穷通宝鉴》调候用干表（十天干 × 十二月令） */
    var TIAOHOU = {
        甲: { 寅: '丙癸', 卯: '庚丙丁', 辰: '庚丁壬', 巳: '癸丁庚', 午: '癸丁庚', 未: '癸丁庚', 申: '庚丁壬', 酉: '庚丙丁', 戌: '庚甲丁壬', 亥: '庚丁丙戊', 子: '丁庚丙', 丑: '丁庚丙' },
        乙: { 寅: '丙癸', 卯: '丙癸', 辰: '癸丙戊', 巳: '癸', 午: '癸丙', 未: '癸丙', 申: '丙癸己', 酉: '癸丙', 戌: '癸辛', 亥: '丙戊', 子: '丙', 丑: '丙' },
        丙: { 寅: '壬庚', 卯: '壬己', 辰: '壬甲', 巳: '壬癸庚', 午: '壬庚', 未: '壬庚', 申: '壬戊', 酉: '壬癸', 戌: '甲壬', 亥: '甲戊庚壬', 子: '壬戊己', 丑: '壬甲' },
        丁: { 寅: '甲庚', 卯: '庚甲', 辰: '甲庚', 巳: '甲庚', 午: '壬庚癸', 未: '甲壬庚', 申: '甲庚丙戊', 酉: '甲庚丙戊', 戌: '甲庚戊', 亥: '甲庚', 子: '甲庚', 丑: '甲庚' },
        戊: { 寅: '丙甲癸', 卯: '丙甲癸', 辰: '甲丙癸', 巳: '甲丙癸', 午: '壬甲丙', 未: '癸丙甲', 申: '丙癸甲', 酉: '丙癸', 戌: '甲丙癸', 亥: '甲丙', 子: '丙甲', 丑: '丙甲' },
        己: { 寅: '丙庚甲', 卯: '甲癸丙', 辰: '丙癸甲', 巳: '癸丙', 午: '癸丙', 未: '癸丙', 申: '丙癸', 酉: '丙癸', 戌: '甲丙癸', 亥: '丙甲戊', 子: '丙甲戊', 丑: '丙甲戊' },
        庚: { 寅: '丙甲壬', 卯: '丁甲庚丙', 辰: '甲丁壬癸', 巳: '壬戊丙丁', 午: '壬癸', 未: '丁甲', 申: '丁甲', 酉: '丁甲丙', 戌: '甲壬', 亥: '丁丙', 子: '丁甲丙', 丑: '丙丁甲' },
        辛: { 寅: '己壬庚', 卯: '壬甲', 辰: '壬甲', 巳: '壬甲癸', 午: '壬己癸', 未: '壬庚甲', 申: '壬甲戊', 酉: '壬甲', 戌: '壬甲', 亥: '壬丙', 子: '丙戊壬甲', 丑: '丙壬戊己' },
        壬: { 寅: '庚丙戊', 卯: '戊辛庚', 辰: '甲庚', 巳: '壬辛庚癸', 午: '癸庚辛', 未: '辛甲', 申: '戊丁', 酉: '甲庚', 戌: '甲丙', 亥: '戊丙庚', 子: '戊丙', 丑: '丙丁甲' },
        癸: { 寅: '辛丙', 卯: '庚辛', 辰: '丙辛甲', 巳: '辛', 午: '庚辛壬癸', 未: '庚辛壬癸', 申: '丁', 酉: '辛丙', 戌: '辛甲壬癸', 亥: '庚辛戊丁', 子: '丙辛', 丑: '丙丁' }
    };

    var SHENSHA_BRANCH = {
        申子辰: { 桃花: '酉', 驿马: '寅', 华盖: '辰', 将星: '子', 劫煞: '巳', 灾煞: '午', 亡神: '亥' },
        寅午戌: { 桃花: '卯', 驿马: '申', 华盖: '戌', 将星: '午', 劫煞: '亥', 灾煞: '子', 亡神: '巳' },
        巳酉丑: { 桃花: '午', 驿马: '亥', 华盖: '丑', 将星: '酉', 劫煞: '寅', 灾煞: '卯', 亡神: '申' },
        亥卯未: { 桃花: '子', 驿马: '巳', 华盖: '未', 将星: '卯', 劫煞: '申', 灾煞: '酉', 亡神: '寅' }
    };

    var SHENSHA_DESC = {
        天乙贵人: ['吉', '命中最吉之神，主逢凶化吉、贵人扶持、遇难呈祥。'],
        天德贵人: ['吉', '主品德端正、福泽深厚，遇事多有转机。'],
        月德贵人: ['吉', '主心地慈良、人缘和顺，能化解凶煞。'],
        文昌贵人: ['吉', '主聪明好学、文思敏捷，利考试、文书与名声。'],
        太极贵人: ['吉', '主悟性高、喜哲理玄学，易得异路学问。'],
        禄神: ['吉', '主衣食丰足、自立自强，得俸禄之助。'],
        羊刃: ['凶', '主性格刚烈、行事果决，需防冲动与意外。'],
        金舆: ['吉', '主婚姻财富得助，得配偶或异性之利。'],
        红鸾: ['吉', '主婚恋喜庆、人缘桃花。'],
        天喜: ['吉', '主喜庆之事，利婚恋、添丁与升学。'],
        桃花: ['中', '主异性缘佳、社交魅力，需防情缘纠葛。'],
        驿马: ['中', '主奔波变动，利外出、迁移与远方发展。'],
        华盖: ['中', '主才华孤高、喜艺术宗教，易有独处之象。'],
        将星: ['吉', '主领导才能与掌权之象，利组织管理。'],
        劫煞: ['凶', '主波折破财、竞争争夺，需防小人。'],
        灾煞: ['凶', '主突发灾厄与意外，行事宜稳。'],
        亡神: ['凶', '主心思深沉，易有口舌官非，需守正。'],
        孤辰: ['中', '主性格独立、六亲缘薄，宜晚婚。'],
        寡宿: ['中', '主内心孤清、独立自守，宜多沟通。'],
        天医: ['吉', '主利健康医疗，遇病易得良医。'],
        魁罡: ['中', '主刚毅果断、聪明好胜，性急需敛。'],
        十恶大败: ['凶', '主理财宜谨慎，忌投机冒进，宜守成。'],
        阴阳差错: ['中', '主婚姻感情多波折，宜晚婚、多包容。'],
        流霞: ['凶', '主血光、产厄与意外伤灾，女命尤忌，逢冲刃之运宜谨慎。'],
        孤鸾: ['凶', '主婚恋孤清、配偶缘薄，宜晚婚，相处宜留彼此空间。'],
        八专: ['中', '干支同气专一，主性情执着、婚姻易有竞争，宜修包容。'],
        天罗: ['凶', '戌亥天罗，主困顿阻滞、官非缠身，行事宜守法度、忌冒险。'],
        地网: ['凶', '辰巳地网，主羁绊束缚、谋事多阻，宜稳守、忌投机。']
    };

    /* 神煞分级：上吉 / 中吉 / 中性 / 中性偏凶 / 中凶，供 UI 分层展示 */
    var SHENSHA_TIER = {
        天乙贵人: '上吉', 天德贵人: '上吉', 月德贵人: '上吉',
        文昌贵人: '中吉', 太极贵人: '中吉', 禄神: '中吉', 金舆: '中吉', 红鸾: '中吉', 天喜: '中吉', 将星: '中吉', 天医: '中吉',
        桃花: '中性', 驿马: '中性', 华盖: '中性',
        孤辰: '中性偏凶', 寡宿: '中性偏凶', 八专: '中性偏凶', 魁罡: '中性', 阴阳差错: '中凶',
        羊刃: '中凶', 劫煞: '中凶', 灾煞: '中凶', 亡神: '中凶', 十恶大败: '中凶', 流霞: '中凶', 孤鸾: '中凶', 天罗: '中凶', 地网: '中凶'
    };

    var LIU_CHONG = [['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥']];
    var LIU_HE = [['子', '丑', '土'], ['寅', '亥', '木'], ['卯', '戌', '火'], ['辰', '酉', '金'], ['巳', '申', '水'], ['午', '未', '土']];
    var LIU_HAI = [['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌']];
    var AN_HE = [['子', '巳'], ['寅', '丑'], ['卯', '申'], ['午', '亥']];
    var GAN_HE = [['甲', '己', '土'], ['乙', '庚', '金'], ['丙', '辛', '水'], ['丁', '壬', '木'], ['戊', '癸', '火']];
    var GAN_CHONG = [['甲', '庚'], ['乙', '辛'], ['丙', '壬'], ['丁', '癸']];
    var SAN_HE = [['申', '子', '辰', '水'], ['寅', '午', '戌', '火'], ['亥', '卯', '未', '木'], ['巳', '酉', '丑', '金']];
    var SAN_HUI = [['寅', '卯', '辰', '木'], ['巳', '午', '未', '火'], ['申', '酉', '戌', '金'], ['亥', '子', '丑', '水']];
    var XING_PAIRS = [['寅', '巳'], ['巳', '申'], ['寅', '申'], ['丑', '戌'], ['戌', '未'], ['丑', '未'], ['子', '卯']];
    var SELF_XING = ['辰', '午', '酉', '亥'];

    var SHICHEN = {
        zi: { range: [23, 0], mid: 0, text: '子时 23:00–01:00' },
        chou: { range: [1, 2], mid: 2, text: '丑时 01:00–03:00' },
        yin: { range: [3, 4], mid: 4, text: '寅时 03:00–05:00' },
        mao: { range: [5, 6], mid: 6, text: '卯时 05:00–07:00' },
        chen: { range: [7, 8], mid: 8, text: '辰时 07:00–09:00' },
        si: { range: [9, 10], mid: 10, text: '巳时 09:00–11:00' },
        wu: { range: [11, 12], mid: 12, text: '午时 11:00–13:00' },
        wei: { range: [13, 14], mid: 14, text: '未时 13:00–15:00' },
        shen: { range: [15, 16], mid: 16, text: '申时 15:00–17:00' },
        you: { range: [17, 18], mid: 18, text: '酉时 17:00–19:00' },
        xu: { range: [19, 20], mid: 20, text: '戌时 19:00–21:00' },
        hai: { range: [21, 22], mid: 22, text: '亥时 21:00–23:00' }
    };

    var SHICHEN_RANGE = {
        子: '23:00–01:00', 丑: '01:00–03:00', 寅: '03:00–05:00', 卯: '05:00–07:00',
        辰: '07:00–09:00', 巳: '09:00–11:00', 午: '11:00–13:00', 未: '13:00–15:00',
        申: '15:00–17:00', 酉: '17:00–19:00', 戌: '19:00–21:00', 亥: '21:00–23:00'
    };

    var ELEM_INFO = {
        木: { industry: '教育、出版、文化创意、农林、成长型行业', dir: '东方', color: '青绿、竹青', health: '肝胆、筋骨、情绪疏泄', trait: '生发、仁和、重计划与长期主义' },
        火: { industry: '能源、传媒、餐饮、演艺、科技', dir: '南方', color: '暖红、橙', health: '心血管、睡眠、眼睛', trait: '热情、表达、行动力强' },
        土: { industry: '地产、建筑、农业、管理、仓储', dir: '中部及西南、东北', color: '米黄、赭石', health: '脾胃、消化、肌肉', trait: '稳重、承载、重信用' },
        金: { industry: '金融、法律、机械、汽车、珠宝、精密制造', dir: '西方', color: '白、银灰', health: '肺、呼吸、皮肤', trait: '果断、原则、重效率' },
        水: { industry: '贸易、物流、互联网、咨询、旅游、流动性行业', dir: '北方', color: '黑、深蓝', health: '肾、泌尿、内分泌', trait: '灵活、洞察、重流通' }
    };

    var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

    /* ---------------------------------------------------------------------
     * 1. 通用工具
     * ------------------------------------------------------------------- */
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function mod(n, m) { return ((n % m) + m) % m; }
    function norm360(deg) { return ((deg % 360) + 360) % 360; }
    function round1(n) { return Math.round(n * 10) / 10; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
    function uniq(arr) {
        var seen = {}, out = [];
        arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
        return out;
    }
    function topoDistance(aKey, bKey) {
        if (aKey === bKey) return 1.0;
        if (POS_ORDER[aKey] == null || POS_ORDER[bKey] == null) return 0.15;
        var d = Math.abs(POS_ORDER[aKey] - POS_ORDER[bKey]);
        if (d === 1) return 0.85;
        if (d === 2) return 0.40;
        return 0.15;
    }
    function distanceText(v) {
        return v >= 1 ? '同柱1.00' : ('距离' + v.toFixed(2));
    }
    function spanText(ms) {
        var totalMinutes = Math.max(0, Math.round(Math.abs(ms) / 60000));
        var days = Math.floor(totalMinutes / 1440);
        var hours = Math.floor((totalMinutes % 1440) / 60);
        var minutes = totalMinutes % 60;
        if (days > 0) return days + '天' + hours + '小时' + (minutes ? minutes + '分' : '');
        if (hours > 0) return hours + '小时' + (minutes ? minutes + '分' : '');
        return minutes + '分钟';
    }
    function byEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function wxClass(wx) { return WX_CLASS[wx] || ''; }
    function starsText(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

    /* ---------------------------------------------------------------------
     * 2. 天文历法：太阳视黄经与十二节
     * ------------------------------------------------------------------- */
    function julianDay(ts) { return ts / 86400000 + 2440587.5; }

    function sunLongitude(ts) {
        var jd = julianDay(ts);
        var t = (jd - 2451545.0) / 36525.0;
        var l0 = norm360(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
        var m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
        var mr = m * Math.PI / 180;
        var c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(mr)
            + (0.019993 - 0.000101 * t) * Math.sin(2 * mr)
            + 0.000289 * Math.sin(3 * mr);
        var omega = 125.04 - 1934.136 * t;
        return norm360(l0 + c - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180));
    }

    /* 历法数据表（js/data-terms.js / js/data-lunar.js，由 scripts/generate-data.js 生成）。
     * 浏览器经 script 标签注入全局；Node 经 require 加载。缺表时回退天文推算。 */
    var TERMS = (typeof BAZI_TERMS !== 'undefined') ? BAZI_TERMS : null;
    var LUNAR = (typeof BAZI_LUNAR !== 'undefined') ? BAZI_LUNAR : null;
    if (typeof require === 'function') {
        if (!TERMS) { try { TERMS = require('./data-terms.js'); } catch (e) { } }
        if (!LUNAR) { try { LUNAR = require('./data-lunar.js'); } catch (e) { } }
    }

    function solarTermTsAstro(year, longitude) {
        var start = Date.UTC(year, 0, 1, 0, 0, 0);
        var days = norm360(longitude - 280.0) / 0.98564736;
        var ts = start + days * 86400000.0;
        for (var i = 0; i < 8; i++) {
            var current = sunLongitude(ts);
            var diff = ((longitude - current + 540) % 360) - 180;
            ts += diff / 0.98564736 * 86400000.0;
        }
        return Math.round(ts / 60000) * 60000;
    }

    function solarTermTs(year, longitude) {
        if (TERMS && TERMS.years[year]) {
            var idx = Math.round(mod(longitude - 285, 360) / 15);
            if (idx >= 0 && idx < 24) return TERMS.years[year][idx];
        }
        return solarTermTsAstro(year, longitude);
    }

    /* 均时差（Meeus《天文算法》28 章，精度约 ±0.5 分钟），返回分钟 */
    function equationOfTime(ts) {
        var t = (julianDay(ts) - 2451545.0) / 36525.0;
        var l0 = norm360(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
        var m = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) * Math.PI / 180;
        var e = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t;
        var omega = (125.04 - 1934.136 * t) * Math.PI / 180;
        var lambda = (l0 + (1.914602 - 0.004817 * t) * Math.sin(m) + 0.019993 * Math.sin(2 * m)) * Math.PI / 180;
        var eps = (23.4392911 - 0.013004167 * t) * Math.PI / 180;
        var dPsi = -0.00478 * Math.sin(omega) * Math.PI / 180;
        var alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
        var eot = l0 * Math.PI / 180 - 0.0057183 - alpha + dPsi * Math.cos(eps);
        eot = ((eot + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        return eot * 180 / Math.PI * 4;
    }

    /* 中国夏令时 1986–1991：起始日凌晨 2:00（标准时）拨快，结束日凌晨 2:00（夏令时）拨回 */
    var DST_RANGES = [
        [1986, 5, 4, 9, 14], [1987, 4, 12, 9, 13], [1988, 4, 10, 9, 11],
        [1989, 4, 16, 9, 17], [1990, 4, 15, 9, 16], [1991, 4, 14, 9, 15]
    ];
    var DST_INTERVALS = DST_RANGES.map(function (r) {
        return [Date.UTC(r[0], r[1] - 1, r[2], 2) - 8 * 3600000, Date.UTC(r[0], r[3] - 1, r[4], 1) - 8 * 3600000];
    });
    function isChinaDST(ts) {
        for (var i = 0; i < DST_INTERVALS.length; i++) {
            if (ts >= DST_INTERVALS[i][0] && ts < DST_INTERVALS[i][1]) return true;
        }
        return false;
    }

    var LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
    var LUNAR_DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
        '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
        '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
    var LUNAR_STARTS = null;
    function lunarStarts() {
        if (!LUNAR_STARTS && LUNAR) {
            LUNAR_STARTS = LUNAR.months.map(function (r) {
                return Math.floor(Date.UTC(r[0], r[1] - 1, r[2]) / 86400000);
            });
        }
        return LUNAR_STARTS;
    }

    function solarToLunar(ts, tz) {
        if (!LUNAR) return null;
        var d = new Date(ts + (tz == null ? 8 : tz) * 3600000);
        var dayNum = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
        var starts = lunarStarts();
        var lo = 0, hi = starts.length - 1, idx = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (starts[mid] <= dayNum) { idx = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (idx < 0) return null;
        var rec = LUNAR.months[idx];
        var day = dayNum - starts[idx] + 1;
        var lm = rec[4], isLeap = lm < 0;
        var monthText = (isLeap ? '闰' : '') + LUNAR_MONTH_NAMES[Math.abs(lm) - 1] + '月';
        var yearGz = SIXTY[mod(rec[3] - 4, 60)];
        return {
            year: rec[3], month: Math.abs(lm), day: day, isLeap: isLeap,
            yearGanZhi: yearGz, monthText: monthText, dayText: LUNAR_DAY_NAMES[day - 1] || String(day),
            text: '农历' + yearGz + '年' + monthText + LUNAR_DAY_NAMES[day - 1]
        };
    }

    function lunarToSolar(ly, lm, ld, isLeap) {
        if (!LUNAR) throw new Error('农历数据表未加载');
        var target = isLeap ? -lm : lm;
        for (var i = 0; i < LUNAR.months.length; i++) {
            var r = LUNAR.months[i];
            if (r[3] === ly && r[4] === target) {
                if (ld < 1 || ld > r[5]) throw new Error('农历' + ly + '年' + (isLeap ? '闰' : '') + lm + '月只有' + r[5] + '天');
                var d = new Date(Date.UTC(r[0], r[1] - 1, r[2]) + (ld - 1) * 86400000);
                return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
            }
        }
        throw new Error('未找到农历' + ly + '年' + (isLeap ? '闰' : '') + lm + '月（支持 1900–2100）');
    }

    /* 可调参数（学者参数面板）。buildReport 时以 input.params 覆盖。 */
    function defaultParams() {
        return {
            monthWeight: 2.0,        // 月令地支权重
            siLingBonus: 1.25,       // 司令藏干加成
            transparentBonus: 1.15,  // 透干加成
            rootStrong: 1.15,        // 通根·强根系数
            rootWeak: 0.85,          // 通根·微根系数
            rootVirtual: 0.75,       // 无根虚浮系数
            clashWeak: 0.62,         // 六冲·弱方受损系数
            clashStrong: 0.90,       // 六冲·旺方受损系数
            bindFactor: 0.72,        // 合绊减力系数
            kongFactor: 0.80,        // 空亡减力系数
            tiaohouWeight: 1.0,      // 调候权重倍率
            congThreshold: 32,       // 从格身弱阈值（%）
            luckAmplitude: 34        // 岁运评分幅度
        };
    }
    var P = defaultParams();

    function jieTerms(year) {
        return JIE_DEFS.map(function (def) {
            return { name: def.name, lon: def.lon, zhi: def.zhi, order: def.order, ts: solarTermTs(year, def.lon) };
        });
    }

    function allJie(year) {
        var list = jieTerms(year - 1).concat(jieTerms(year), jieTerms(year + 1));
        list.sort(function (a, b) { return a.ts - b.ts; });
        return list;
    }

    function beijingTs(y, m, d, h, mi) {
        return Date.UTC(y, m - 1, d, h, mi, 0) - 8 * 3600000;
    }

    function bjDate(ts) { return new Date(ts + 8 * 3600000); }

    function fmtDate(ts) {
        var d = bjDate(ts);
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }

    function fmtDateTime(ts) {
        var d = bjDate(ts);
        return fmtDate(ts) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    }

    function addCalendar(ts, years, months, days) {
        var d = bjDate(ts);
        var nd = new Date(Date.UTC(
            d.getUTCFullYear() + years,
            d.getUTCMonth() + months,
            d.getUTCDate() + days,
            d.getUTCHours(),
            d.getUTCMinutes()
        ));
        return nd.getTime() - 8 * 3600000;
    }

    function gregorianToJdn(y, m, d) {
        var a = Math.floor((14 - m) / 12);
        var yy = y + 4800 - a;
        var mm = m + 12 * a - 3;
        return d + Math.floor((153 * mm + 2) / 5) + 365 * yy
            + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
    }

    /* 解析出生输入。
     * dateTime: 'YYYY-MM-DD[ HH:MM]'（公历或农历，由 opts.calendar 决定）
     * shichenKey: 可选时辰键（子丑寅…）。与实际时刻冲突时仅警告，不再静默改写。
     * opts: { calendar, leap, tz, longitude, trueSolar, ziSchool, hourUnknown, dst } */
    function parseBirthInput(dateTime, shichenKey, opts) {
        opts = opts || {};
        var warnings = [];
        var match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(dateTime || ''));
        if (!match) throw new Error('出生日期格式不正确，请使用 YYYY-MM-DD HH:MM');
        var y = parseInt(match[1], 10);
        var mo = parseInt(match[2], 10);
        var d = parseInt(match[3], 10);
        var hasTime = match[4] != null;
        var h = hasTime ? parseInt(match[4], 10) : 0;
        var mi = hasTime ? parseInt(match[5], 10) : 0;
        var calendar = opts.calendar === 'lunar' ? 'lunar' : 'solar';
        var lunarInput = null;
        if (calendar === 'lunar') {
            lunarInput = { year: y, month: mo, day: d, isLeap: !!opts.leap };
            var conv = lunarToSolar(y, mo, d, !!opts.leap);
            y = conv.year; mo = conv.month; d = conv.day;
        }
        if (y < 1900 || y > 2100) throw new Error('当前版本支持 1900 年至 2100 年的出生日期');
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
            throw new Error('出生日期或时间超出有效范围');
        }
        var timeSource = 'clock';
        var hourUnknown = !!opts.hourUnknown;
        if (!hasTime && shichenKey && SHICHEN[shichenKey]) {
            h = SHICHEN[shichenKey].mid;
            mi = 0;
            timeSource = 'shichen';
        } else if (!hasTime && !shichenKey) {
            hourUnknown = true;
        }
        if (hasTime && shichenKey && SHICHEN[shichenKey]) {
            var def = SHICHEN[shichenKey];
            if (def.range.indexOf(h) === -1) {
                warnings.push('所选「' + def.text.charAt(0) + '时」（' + def.text + '）与出生时刻 ' + pad2(h) + ':' + pad2(mi) + ' 不符，已按实际时刻排盘。');
            }
        }
        if (hourUnknown) {
            warnings.push('未提供出生时辰，按三柱排盘：时柱从略，子女宫与晚年断语仅供参考。');
            h = 0; mi = 0;
        }

        var tz = opts.tz == null ? 8 : Number(opts.tz);
        if (isNaN(tz) || tz < -12 || tz > 14) throw new Error('时区偏移超出有效范围（-12 至 +14）');
        var ts = Date.UTC(y, mo - 1, d, h, mi, 0) - tz * 3600000;

        /* 三柱模式只取日历日期：不做夏令时与真太阳时位移，避免跨日污染日柱与农历 */
        var dstApplied = false;
        if (!hourUnknown && tz === 8 && opts.dst !== 'off') {
            if (opts.dst === 'on' || (opts.dst !== 'off' && isChinaDST(ts))) {
                ts -= 3600000;
                dstApplied = true;
            }
        }

        var longitude = opts.longitude == null ? null : Number(opts.longitude);
        if (longitude != null && (isNaN(longitude) || longitude < -180 || longitude > 180)) {
            throw new Error('经度超出有效范围（-180 至 180）');
        }
        var trueSolar = !hourUnknown && opts.trueSolar !== false && longitude != null;
        var lonCorrMin = 0, eotMin = 0, solarTs = ts;
        if (trueSolar) {
            lonCorrMin = (longitude - tz * 15) * 4;
            eotMin = equationOfTime(ts);
            solarTs = ts + Math.round((lonCorrMin + eotMin) * 60000);
        }

        var lunar = solarToLunar(ts, tz);
        var solarWall = new Date(solarTs + tz * 3600000);
        return {
            year: y, month: mo, day: d, hour: h, minute: mi,
            ts: ts, solarTs: solarTs, tz: tz,
            longitude: longitude, trueSolarApplied: trueSolar,
            lonCorrMin: round2(lonCorrMin), eotMin: round2(eotMin), dstApplied: dstApplied,
            ziSchool: opts.ziSchool === 'early' ? 'early' : 'late',
            hourUnknown: hourUnknown, calendar: calendar, lunarInput: lunarInput, lunar: lunar,
            timeSource: timeSource, warnings: warnings,
            dateText: y + '年' + mo + '月' + d + '日',
            timeText: hourUnknown ? '时辰未知' : (timeSource === 'shichen' ? SHICHEN[shichenKey].text : pad2(h) + ':' + pad2(mi)),
            solarTimeText: pad2(solarWall.getUTCHours()) + ':' + pad2(solarWall.getUTCMinutes()),
            solarDateText: solarWall.getUTCFullYear() + '-' + pad2(solarWall.getUTCMonth() + 1) + '-' + pad2(solarWall.getUTCDate())
        };
    }

    /* ---------------------------------------------------------------------
     * 3. 干支、十神、长生
     * ------------------------------------------------------------------- */
    function sixtyIndex(gan, zhi) {
        var gi = GAN.indexOf(gan);
        var zi = ZHI.indexOf(zhi);
        for (var i = 0; i < 60; i++) {
            if (i % 10 === gi && i % 12 === zi) return i;
        }
        return 0;
    }

    function tenGod(dayGan, targetGan) {
        var d = GAN_WX[dayGan];
        var t = GAN_WX[targetGan];
        var same = GAN_YANG[dayGan] === GAN_YANG[targetGan];
        if (t === d) return same ? '比肩' : '劫财';
        if (WX_SHENG[d] === t) return same ? '食神' : '伤官';
        if (WX_KE[d] === t) return same ? '偏财' : '正财';
        if (WX_KE[t] === d) return same ? '七杀' : '正官';
        if (WX_SHENG[t] === d) return same ? '偏印' : '正印';
        return '比肩';
    }

    function changSheng(gan, zhi) {
        var start = ZHI.indexOf(CHANG_SHENG_START[gan]);
        var target = ZHI.indexOf(zhi);
        var pos = GAN_YANG[gan] ? mod(target - start, 12) : mod(start - target, 12);
        return CHANG_SHENG_ORDER[pos];
    }

    function bladeZhi(gan) {
        for (var i = 0; i < ZHI.length; i++) {
            if (changshengSafe(gan, ZHI[i]) === '帝旺') return ZHI[i];
        }
        return '';
    }

    function changshengSafe(gan, zhi) {
        try { return changSheng(gan, zhi); } catch (e) { return ''; }
    }

    function seasonState(monthZhi) {
        /* 四季土月：土旺金相，但藏干须论余气与库气——
         * 辰为春末，乙木余气未绝（囚→休）、癸水入库有气（死→囚）；
         * 未为夏末，火旺土相，乙木库气（休）；
         * 戌为秋末，丁火库气（休）；丑为冬末，癸水余气（死→囚）。 */
        if (monthZhi === '辰') return { 土: '旺', 金: '相', 火: '休', 木: '休', 水: '囚' };
        if (monthZhi === '未') return { 火: '旺', 土: '相', 木: '休', 水: '囚', 金: '死' };
        if (monthZhi === '戌') return { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '死' };
        if (monthZhi === '丑') return { 土: '旺', 金: '相', 火: '休', 木: '囚', 水: '囚' };
        var m = ZHI_WX[monthZhi];
        var sheng = WX_SHENG[m];
        var xiu = WX_SHENG_BY[m];
        var qiu = WX_KE_BY[m];
        var si = WX_KE[m];
        var map = {};
        map[m] = '旺'; map[sheng] = '相'; map[xiu] = '休'; map[qiu] = '囚'; map[si] = '死';
        return map;
    }

    function seasonMultiplier(state) {
        return { 旺: 1.35, 相: 1.15, 休: 0.85, 囚: 0.65, 死: 0.45 }[state] || 1.0;
    }

    function seasonName(monthZhi) {
        if (['寅', '卯', '辰'].indexOf(monthZhi) !== -1) return '春季';
        if (['巳', '午', '未'].indexOf(monthZhi) !== -1) return '夏季';
        if (['申', '酉', '戌'].indexOf(monthZhi) !== -1) return '秋季';
        return '冬季';
    }

    function branchGroup(zhi) {
        var groups = Object.keys(SHENSHA_BRANCH);
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].indexOf(zhi) !== -1) return groups[i];
        }
        return '';
    }

    function computeSiLing(monthZhi, prevJie, ts) {
        var list = SI_LING[monthZhi] || [];
        var elapsed = (ts - prevJie.ts) / 86400000;
        var totalDays = sum(list.map(function (x) { return x[1]; }));
        var cursor = 0, active = list[list.length - 1] || ['', 0], start = 0;
        for (var i = 0; i < list.length; i++) {
            if (elapsed < cursor + list[i][1] || i === list.length - 1) {
                active = list[i];
                start = cursor;
                break;
            }
            cursor += list[i][1];
        }
        start = Math.min(start, Math.max(0, totalDays - active[1]));
        var gan = active[0];
        var wx = GAN_WX[gan];
        var exact = (CANG[monthZhi] || []).filter(function (c) { return c[0] === gan; })[0];
        var same = (CANG[monthZhi] || []).filter(function (c) { return GAN_WX[c[0]] === wx; })[0];
        var carrier = exact ? exact[0] : (same ? same[0] : '');
        var remaining = Math.max(0, start + active[1] - elapsed);
        return {
            gan: gan,
            wx: wx,
            days: active[1],
            startDay: round1(start),
            endDay: round1(start + active[1]),
            elapsed: round1(elapsed),
            remainingDays: round1(remaining),
            totalDays: totalDays,
            carrier: carrier,
            text: '月令' + monthZhi + '，' + prevJie.name + '后第' + Math.max(1, Math.ceil(elapsed))
                + '天，' + gan + wx + '司令（' + gan + '主令' + active[1] + '天，余' + round1(remaining) + '天）',
            short: '月令' + monthZhi + ' · ' + gan + wx + '司令'
        };
    }

    function computeMingGong(yearGan, monthZhi, hourZhi) {
        var monthNum = mod(ZHI.indexOf(monthZhi) - 2, 12) + 1;
        var hourNum = mod(ZHI.indexOf(hourZhi) - 2, 12) + 1;
        var sumNum = monthNum + hourNum;
        var gongNum = 14 - sumNum;
        while (gongNum <= 0) gongNum += 12;
        var gongZhi = ZHI[(gongNum + 1) % 12];
        var order = mod(ZHI.indexOf(gongZhi) - 2, 12);
        var gongGan = GAN[(YIN_START[yearGan] + order) % 10];
        return {
            gan: gongGan,
            zhi: gongZhi,
            ganzhi: gongGan + gongZhi,
            note: '命宫以月支、时支合数推得，作辅助参考'
        };
    }

    function computeTaiYuan(monthGan, monthZhi) {
        var gan = GAN[(GAN.indexOf(monthGan) + 1) % 10];
        var zhi = ZHI[(ZHI.indexOf(monthZhi) + 3) % 12];
        return { gan: gan, zhi: zhi, ganzhi: gan + zhi, note: '胎元为受胎之月，月干进一、月支进三' };
    }

    /* 身宫：子上起正月顺数至生月，再于落处起子时顺数至生时；干以五虎遁从年干起 */
    function computeShenGong(yearGan, monthZhi, hourZhi) {
        var monthNum = mod(ZHI.indexOf(monthZhi) - 2, 12);
        var hourNum = ZHI.indexOf(hourZhi);
        var gongZhi = ZHI[(monthNum + hourNum) % 12];
        var order = mod(ZHI.indexOf(gongZhi) - 2, 12);
        var gongGan = GAN[(YIN_START[yearGan] + order) % 10];
        return { gan: gongGan, zhi: gongZhi, ganzhi: gongGan + gongZhi, note: '身宫主后天修为与中年后际遇，与命宫互为表里' };
    }

    /* 胎息：与日柱天合地合之干支 */
    function computeTaiXi(dayGan, dayZhi) {
        var gan = null, zhi = null;
        GAN_HE.forEach(function (g) {
            if (g[0] === dayGan) gan = g[1];
            else if (g[1] === dayGan) gan = g[0];
        });
        LIU_HE.forEach(function (z) {
            if (z[0] === dayZhi) zhi = z[1];
            else if (z[1] === dayZhi) zhi = z[0];
        });
        return { gan: gan, zhi: zhi, ganzhi: gan + zhi, note: '胎息与日柱天合地合，主先天禀赋与暗助' };
    }

    /* 原局伏吟（两柱干支相同）与反吟（两柱天克地冲） */
    function detectFuyin(chart) {
        var list = [];
        var ps = activePillars(chart);
        for (var i = 0; i < ps.length; i++) {
            for (var j = i + 1; j < ps.length; j++) {
                var a = ps[i], b = ps[j];
                if (a.gan === b.gan && a.zhi === b.zhi) {
                    list.push({
                        type: '伏吟', pair: a.name + '·' + b.name, ganzhi: a.ganzhi,
                        text: a.name + b.name + '同为' + a.ganzhi + '，伏吟主重叠反复：' +
                            (a.key === 'day' || b.key === 'day' ? '日柱涉伏吟，自身与婚恋易有旧事重提、进退两难之象' : '两宫之事相互牵绊，宜分清边界')
                    });
                }
                var ganChong = GAN_CHONG.some(function (h) {
                    return (h[0] === a.gan && h[1] === b.gan) || (h[1] === a.gan && h[0] === b.gan);
                });
                var zhiChong = LIU_CHONG.some(function (h) {
                    return (h[0] === a.zhi && h[1] === b.zhi) || (h[1] === a.zhi && h[0] === b.zhi);
                });
                if (ganChong && zhiChong) {
                    list.push({
                        type: '反吟', pair: a.name + '·' + b.name, ganzhi: a.ganzhi + '↔' + b.ganzhi,
                        text: a.name + a.ganzhi + '与' + b.name + b.ganzhi + '天克地冲，反吟主对冲变动：两宫之事难两全，人生阶段多切换'
                    });
                }
            }
        }
        return {
            list: list,
            text: list.length ? list.map(function (x) { return x.text; }).join(' ') : '原局四柱无伏吟反吟，宫位之间无重叠对冲之象。'
        };
    }

    /* 小运：自时柱起，阳男阴女顺行、阴男阳女逆行，一年一柱，用于起运前之童限 */
    function computeXiaoYun(chart, dayun) {
        if (chart.hourUnknown) return { list: [], text: '时辰未知，小运从略。' };
        var yearYang = GAN_YANG[chart.yearGan];
        var male = chart.gender === 'male';
        var forward = (yearYang && male) || (!yearYang && !male);
        var ganIdx = GAN.indexOf(chart.hourGan);
        var zhiIdx = ZHI.indexOf(chart.hourZhi);
        var birthYear = chart.birth.year;
        var limit = Math.max(dayun.startYears, 1);
        var list = [];
        for (var i = 0; i < limit && i < 12; i++) {
            var offset = forward ? i + 1 : -(i + 1);
            var gan = GAN[mod(ganIdx + offset, 10)];
            var zhi = ZHI[mod(zhiIdx + offset, 12)];
            list.push({
                age: i + 1,
                year: birthYear + i,
                ganzhi: gan + zhi,
                shishen: tenGod(chart.dayGan, gan),
                xingYun: changSheng(chart.dayGan, zhi)
            });
        }
        return {
            list: list,
            text: list.length
                ? '童限小运（' + (forward ? '顺行' : '逆行') + '）：' + list.map(function (x) { return x.age + '岁' + x.ganzhi; }).join('、') + '。'
                : '起运甚早，小运从略。'
        };
    }

    /* ---------------------------------------------------------------------
     * 4. 命盘构建
     * ------------------------------------------------------------------- */
    function makePillar(key, gan, zhi, dayGan) {
        var idx = sixtyIndex(gan, zhi);
        var xunStart = Math.floor(idx / 10) * 10;
        var cang = CANG[zhi].map(function (item) {
            return {
                gan: item[0],
                wx: GAN_WX[item[0]],
                ratio: item[1],
                tenGod: tenGod(dayGan, item[0]),
                base: 0,
                power: 0,
                transparent: false
            };
        });
        return {
            key: key,
            name: PILLAR_NAMES[key],
            gong: PILLAR_GONG[key],
            gan: gan,
            zhi: zhi,
            ganzhi: gan + zhi,
            ganWx: GAN_WX[gan],
            zhiWx: ZHI_WX[zhi],
            ganYang: GAN_YANG[gan],
            zhiYang: ZHI_YANG[zhi],
            shishen: key === 'day' ? '日主' : tenGod(dayGan, gan),
            cang: cang,
            xingYun: changSheng(dayGan, zhi),
            ziZuo: changSheng(gan, zhi),
            kongWang: [ZHI[(xunStart + 10) % 12], ZHI[(xunStart + 11) % 12]],
            xunShou: SIXTY[xunStart],
            nayin: NAYIN[Math.floor(idx / 2)],
            shensha: [],
            isDay: key === 'day'
        };
    }

    function unknownHourPillar() {
        return {
            key: 'hour', name: PILLAR_NAMES.hour, gong: PILLAR_GONG.hour,
            gan: null, zhi: null, ganzhi: '？？', ganWx: null, zhiWx: null,
            ganYang: null, zhiYang: null, shishen: '未知', cang: [],
            xingYun: '', ziZuo: '', kongWang: [], xunShou: '', nayin: '',
            shensha: [], isDay: false, unknown: true
        };
    }

    function activePillars(chart) {
        return chart.pillars.filter(function (p) { return !p.unknown; });
    }

    function buildChart(birth, gender, name) {
        var ts = birth.solarTs || birth.ts;
        var tz = birth.tz == null ? 8 : birth.tz;
        var wall = new Date(ts + tz * 3600000);
        var year = wall.getUTCFullYear(), month = wall.getUTCMonth() + 1, day = wall.getUTCDate();
        var hour = wall.getUTCHours(), minute = wall.getUTCMinutes();
        var ziSchool = birth.ziSchool === 'early' ? 'early' : 'late';
        var hourUnknown = !!birth.hourUnknown;

        var lichunTs = solarTermTs(year, 315);
        var solarYear = ts < lichunTs ? year - 1 : year;
        var yearGanIdx = mod(solarYear - 4, 10);
        var yearZhiIdx = mod(solarYear - 4, 12);
        var yearGan = GAN[yearGanIdx];
        var yearZhi = ZHI[yearZhiIdx];

        var jie = allJie(year);
        var prevJie = null, nextJie = null;
        for (var i = 0; i < jie.length; i++) {
            if (jie[i].ts <= ts) prevJie = jie[i];
            else { nextJie = jie[i]; break; }
        }
        if (!prevJie) prevJie = jie[0];
        if (!nextJie) nextJie = jie[jie.length - 1];

        var monthOrder = prevJie.order;
        var monthZhi = ZHI[(monthOrder + 2) % 12];
        var monthGan = GAN[(YIN_START[yearGan] + monthOrder) % 10];

        var jdn = gregorianToJdn(year, month, day);
        var lateZi = hour >= 23 && ziSchool === 'late';
        if (lateZi) jdn += 1;
        var dayIndex = mod(jdn + 49, 60);
        var dayGan = GAN[dayIndex % 10];
        var dayZhi = ZHI[dayIndex % 12];

        var hourZhiIdx = Math.floor((hour + 1) / 2) % 12;
        var hourZhi = hourUnknown ? null : ZHI[hourZhiIdx];
        var hourGan = hourUnknown ? null : GAN[((dayIndex % 10 % 5) * 2 + hourZhiIdx) % 10];

        var pillars = [
            makePillar('year', yearGan, yearZhi, dayGan),
            makePillar('month', monthGan, monthZhi, dayGan),
            makePillar('day', dayGan, dayZhi, dayGan),
            hourUnknown ? unknownHourPillar() : makePillar('hour', hourGan, hourZhi, dayGan)
        ];

        var daysSinceJie = (ts - prevJie.ts) / 86400000;
        var daysToNextJie = (nextJie.ts - ts) / 86400000;
        var siLing = computeSiLing(monthZhi, prevJie, ts);
        var mingGong = hourUnknown ? null : computeMingGong(yearGan, monthZhi, hourZhi);
        var shenGong = hourUnknown ? null : computeShenGong(yearGan, monthZhi, hourZhi);
        var taiYuan = computeTaiYuan(monthGan, monthZhi);
        var taiXi = computeTaiXi(dayGan, dayZhi);

        var noteParts = [];
        if (birth.trueSolarApplied) {
            noteParts.push('真太阳时已校正：经度差 ' + (birth.lonCorrMin >= 0 ? '+' : '') + birth.lonCorrMin
                + ' 分钟，均时差 ' + (birth.eotMin >= 0 ? '+' : '') + birth.eotMin + ' 分钟');
        } else {
            noteParts.push('未作真太阳时校正（提供出生地经度可启用）');
        }
        if (birth.dstApplied) noteParts.push('已扣除夏令时 1 小时（中国 1986–1991 年实行）');
        noteParts.push(ziSchool === 'late' ? '晚子时派：23:00 换日' : '早子时派：00:00 换日，夜子时不换日');
        noteParts.push('年柱以立春换年，月柱以十二节换月');
        if (hourUnknown) noteParts.push('时辰未知，时柱从略');

        return {
            birth: birth,
            ts: ts,
            physicalTs: birth.ts,
            gender: gender === 'female' ? 'female' : 'male',
            genderText: gender === 'female' ? '女命' : '男命',
            name: name || '匿名',
            pillars: pillars,
            dayGan: dayGan,
            dayZhi: dayZhi,
            dayWx: GAN_WX[dayGan],
            yearGan: yearGan,
            yearZhi: yearZhi,
            monthGan: monthGan,
            monthZhi: monthZhi,
            hourGan: hourGan,
            hourZhi: hourZhi,
            hourUnknown: hourUnknown,
            ziSchool: ziSchool,
            monthOrder: monthOrder,
            prevJie: prevJie,
            nextJie: nextJie,
            lateZi: lateZi,
            jdn: jdn,
            dayIndex: dayIndex,
            allJie: jie,
            daysSinceJie: round2(daysSinceJie),
            daysToNextJie: round2(daysToNextJie),
            prevJieAgoText: spanText(ts - prevJie.ts),
            nextJieInText: spanText(nextJie.ts - ts),
            monthLengthDays: round2((nextJie.ts - prevJie.ts) / 86400000),
            siLing: siLing,
            mingGong: mingGong,
            shenGong: shenGong,
            taiYuan: taiYuan,
            taiXi: taiXi,
            kongWang: pillars[2].kongWang,
            warnings: birth.warnings || [],
            solarTimeNote: noteParts.join('；') + '。'
        };
    }

    /* ---------------------------------------------------------------------
     * 5. 五维动态力量模型
     * ------------------------------------------------------------------- */
    function branchPower(p) {
        return sum(p.cang.map(function (c) { return c.power; }));
    }

    function scaleBranch(p, factor) {
        p.cang.forEach(function (c) { c.power *= factor; });
    }

    function scaleBranchElement(p, wx, factor) {
        p.cang.forEach(function (c) { if (c.wx === wx) c.power *= factor; });
    }

    function addFlag(p, flag) {
        if (!p.flags) p.flags = [];
        if (p.flags.indexOf(flag) === -1) p.flags.push(flag);
    }

    function applyEarthPhysics(pillars, chart, state) {
        var summer = ['巳', '午', '未'].indexOf(chart.monthZhi) !== -1;
        var fireBranches = pillars.filter(function (p) { return p.zhi === '巳' || p.zhi === '午'; }).length;
        var fireStems = pillars.filter(function (p) { return p.ganWx === '火'; }).length;
        var fireDominant = summer || state['火'] === '旺' || (fireBranches + fireStems >= 3);
        var effects = [];

        function near(p) {
            return pillars.filter(function (q) {
                return q.key !== p.key && topoDistance(p.key, q.key) === 0.85;
            });
        }
        function fireBranchesNear(p) {
            return near(p).filter(function (q) { return q.zhi === '巳' || q.zhi === '午'; });
        }

        pillars.forEach(function (p) {
            if (WET_EARTH.indexOf(p.zhi) !== -1) {
                var effect = { zhi: p.zhi, key: p.key, type: '湿土', items: [] };
                if (fireDominant) {
                    fireBranchesNear(p).forEach(function (q) {
                        scaleBranchElement(q, '火', 0.80);
                        effect.items.push('晦' + q.name + q.zhi + '火20%');
                    });
                }
                var metalNear = [p].concat(near(p)).filter(function (q) { return q.zhiWx === '金' || q.cang.some(function (c) { return c.wx === '金'; }); });
                metalNear.forEach(function (q) { scaleBranchElement(q, '金', 1.20); });
                if (metalNear.length) effect.items.push('生金×1.20');
                var waterNear = [p].concat(near(p)).filter(function (q) { return q.zhiWx === '水' || q.cang.some(function (c) { return c.wx === '水'; }); });
                waterNear.forEach(function (q) { scaleBranchElement(q, '水', 1.15); });
                if (waterNear.length) effect.items.push('蓄水护水×1.15');
                addFlag(p, '湿土润局');
                effects.push(effect);
            } else if (DRY_EARTH.indexOf(p.zhi) !== -1) {
                var dry = { zhi: p.zhi, key: p.key, type: '燥土', items: [] };
                var fireNear = [p].concat(fireBranchesNear(p)).filter(function (q) { return q.cang.some(function (c) { return c.wx === '火'; }); });
                fireNear.forEach(function (q) { scaleBranchElement(q, '火', 1.15); });
                if (fireNear.length) dry.items.push('助火助燥×1.15');
                var metalNear2 = [p].concat(near(p)).filter(function (q) { return q.cang.some(function (c) { return c.wx === '金'; }); });
                metalNear2.forEach(function (q) { scaleBranchElement(q, '金', 0.80); });
                if (metalNear2.length) dry.items.push('脆金20%');
                var waterNear2 = [p].concat(near(p)).filter(function (q) { return q.cang.some(function (c) { return c.wx === '水'; }); });
                waterNear2.forEach(function (q) { scaleBranchElement(q, '水', 0.75); });
                if (waterNear2.length) dry.items.push('煏水25%');
                addFlag(p, '燥土助燥');
                effects.push(dry);
            }
        });

        return {
            fireDominant: fireDominant,
            list: effects,
            text: effects.length
                ? effects.map(function (e) {
                    return e.zhi + e.type + (e.items.length ? '（' + e.items.join('、') + '）' : '（无邻近作用）');
                }).join('；')
                : '原局无辰戌丑未四土，湿燥土物理修正不触发'
        };
    }

    function zhiPos(key) { return key === 'month' ? P.monthWeight : ZHI_POS[key]; }

    function computePower(chart) {
        var pillars = activePillars(chart);
        var monthZhi = chart.monthZhi;
        var dayWx = chart.dayWx;
        var state = seasonState(monthZhi);
        var mult = {};
        WX.forEach(function (el) { mult[el] = seasonMultiplier(state[el]); });

        /* 第一层：宫位基准 × 月令旺相休囚死 */
        pillars.forEach(function (p) {
            p.flags = [];
            p.ganBase = GAN_POS[p.key];
            p.ganPower = p.ganBase * mult[p.ganWx];
            p.cang.forEach(function (c) {
                c.base = c.ratio * zhiPos(p.key);
                c.power = c.base * mult[c.wx];
            });
        });

        /* 第一层续：人元司令分野，当值司令之气 ×1.25 */
        var siLingApplied = null;
        if (chart.siLing && chart.siLing.carrier) {
            var monthPillar = pillars[1];
            monthPillar.cang.forEach(function (c) {
                if (c.gan === chart.siLing.carrier) {
                    var before = c.power;
                    c.power *= P.siLingBonus;
                    c.siLing = true;
                    siLingApplied = {
                        gan: c.gan,
                        wx: c.wx,
                        branch: monthPillar.zhi,
                        before: round2(before),
                        after: round2(c.power)
                    };
                    addFlag(monthPillar, '司令' + chart.siLing.gan + '×' + P.siLingBonus);
                }
            });
            if (!siLingApplied) {
                var sameWx = monthPillar.cang.filter(function (c) { return c.wx === chart.siLing.wx; })[0];
                if (sameWx) {
                    var before2 = sameWx.power;
                    sameWx.power *= P.siLingBonus;
                    sameWx.siLing = true;
                    siLingApplied = {
                        gan: sameWx.gan,
                        wx: sameWx.wx,
                        branch: monthPillar.zhi,
                        before: round2(before2),
                        after: round2(sameWx.power)
                    };
                    addFlag(monthPillar, '司令' + chart.siLing.gan + '×' + P.siLingBonus);
                }
            }
        }

        /* 第二层：藏干透出联动 */
        var stemWx = {};
        var hiddenWx = {};
        pillars.forEach(function (p) {
            stemWx[p.ganWx] = true;
            p.cang.forEach(function (c) { hiddenWx[c.wx] = true; });
        });
        pillars.forEach(function (p) {
            if (hiddenWx[p.ganWx]) {
                p.ganPower *= P.transparentBonus;
                addFlag(p, '透干×' + P.transparentBonus);
            }
            p.cang.forEach(function (c) {
                if (stemWx[c.wx]) {
                    c.power *= P.transparentBonus;
                    c.transparent = true;
                }
            });
        });

        /* 第三层：自坐生克（盖头、截脚、得生、比和） */
        pillars.forEach(function (p) {
            var g = p.ganWx, z = p.zhiWx;
            p.seat = '平和';
            p.seatNote = '干支无明显生克偏倚';
            if (g === z) {
                p.ganPower *= 1.15;
                scaleBranch(p, 1.15);
                p.seat = '比和';
                p.seatNote = '干支比和，同柱力量×1.15';
            } else if (WX_SHENG[z] === g) {
                p.ganPower *= 1.15;
                scaleBranch(p, 0.90);
                p.seat = '得生';
                p.seatNote = '支生干，天干×1.15，地支×0.90';
            } else if (WX_KE[z] === g) {
                p.ganPower *= 0.75;
                p.seat = '截脚';
                p.seatNote = '支克干，天干力量×0.75（截脚）';
            } else if (WX_KE[g] === z) {
                scaleBranch(p, 0.85);
                p.seat = '盖头';
                p.seatNote = '干克支，地支力量×0.85（盖头）';
            } else if (WX_SHENG[g] === z) {
                p.ganPower *= 0.90;
                scaleBranch(p, 1.10);
                p.seat = '泄气';
                p.seatNote = '干生支，天干×0.90，地支×1.10';
            }
        });

        /* 第三层续：湿土/燥土物理修正（晦火、生金、蓄水；助火、脆金、煏水） */
        var earthPhysics = applyEarthPhysics(pillars, chart, state);

        /* 第四层：原局合冲刑害先于通根判定——根气以冲合后的实际状态计 */
        pillars.forEach(function (p) {
            p.cang.forEach(function (c) { c.preInteract = c.power; });
        });
        var relations = detectRelations(pillars);
        var extra = applyNatalInteractions(pillars, relations, chart);

        /* 第五层：天干通根 / 虚浮，根气按空间拓扑距离衰减，并随冲合损益 */
        pillars.forEach(function (p) {
            var roots = [];
            pillars.forEach(function (q) {
                q.cang.forEach(function (c) {
                    if (c.wx === p.ganWx) {
                        var dist = topoDistance(p.key, q.key);
                        var intact = c.preInteract > 0 ? clamp(c.power / c.preInteract, 0.15, 1.2) : 1;
                        roots.push({
                            position: q.name + '支' + q.zhi,
                            branch: q.zhi,
                            pillarKey: q.key,
                            gan: c.gan,
                            ratio: c.ratio,
                            distance: dist,
                            intact: round2(intact),
                            weight: c.ratio * zhiPos(q.key) * dist * intact,
                            type: c.ratio >= 0.6 ? '本气强根' : (c.ratio >= 0.25 ? '中气中根' : '余气微根'),
                            lu: LU[p.gan] === q.zhi,
                            blade: bladeZhi(p.gan) === q.zhi
                        });
                    }
                });
            });
            roots.sort(function (a, b) { return b.weight - a.weight; });
            var strongRoots = roots.filter(function (r) { return (r.ratio >= 0.6 || r.lu || r.blade) && r.intact >= 0.5; });
            var rootScore = sum(roots.map(function (r) { return r.weight; }));
            var damaged = roots.filter(function (r) { return r.intact < 0.7; });
            p.roots = roots;
            p.rootScore = rootScore;
            p.strongRootCount = strongRoots.length;
            p.mediumRootCount = roots.filter(function (r) { return r.ratio >= 0.25 && r.ratio < 0.6 && !r.lu && !r.blade && r.intact >= 0.5; }).length;
            var damageNote = damaged.length ? '，' + damaged.map(function (r) { return r.branch; }).join('、') + '根逢冲合受损（存留' + damaged.map(function (r) { return Math.round(r.intact * 100) + '%'; }).join('、') + '）' : '';
            if (roots.length === 0) {
                var wetSupport = pillars.filter(function (q) {
                    return WET_EARTH.indexOf(q.zhi) !== -1 && topoDistance(p.key, q.key) >= 0.85;
                }).map(function (q) { return q.name + q.zhi; });
                var supportWx = p.ganWx === chart.dayWx || p.ganWx === WX_SHENG_BY[chart.dayWx];
                var virtualFactor = supportWx ? P.rootVirtual : 0.55;
                p.ganPower *= virtualFactor;
                p.rootType = '虚浮少根';
                p.rootNote = '地支无同气之根，' + (wetSupport.length ? '仅赖' + wetSupport.join('、') + '湿土微生，' : '')
                    + (supportWx ? '同党实效×' + P.rootVirtual : '克泄日主的异党实效×0.55');
            } else if (strongRoots.length > 0 || rootScore >= 0.8) {
                p.ganPower *= P.rootStrong;
                p.rootType = '强根';
                p.rootNote = '通根于' + uniq(roots.map(function (r) {
                    return r.branch + '（距离' + r.distance.toFixed(2) + '）';
                })).join('、') + '，根气通透，天干×' + P.rootStrong + damageNote;
            } else if (rootScore >= 0.30) {
                p.rootType = '中根';
                p.rootNote = '通根于' + uniq(roots.map(function (r) {
                    return r.branch + '（距离' + r.distance.toFixed(2) + '）';
                })).join('、') + '，距离衰减后天干力量持平' + damageNote;
            } else {
                p.ganPower *= P.rootWeak;
                p.rootType = '微根';
                p.rootNote = '通根于' + uniq(roots.map(function (r) {
                    return r.branch + '（距离' + r.distance.toFixed(2) + '）';
                })).join('、') + '，余气微根，天干×' + P.rootWeak + damageNote;
            }
        });

        /* 第六层：空亡入论（日柱旬空）。冲空则实，合空解绊，空支减力 */
        var kongEffects = [];
        pillars.forEach(function (p) {
            if (chart.kongWang.indexOf(p.zhi) === -1) return;
            var clashed = relations.some(function (r) { return r.type === '地支六冲' && r.keys.indexOf(p.key) !== -1; });
            var bound = relations.some(function (r) {
                return (r.type === '地支六合' || r.type === '三合局' || r.type === '半合局' || r.type === '三会局') && r.keys.indexOf(p.key) !== -1;
            });
            if (clashed) {
                addFlag(p, '空亡逢冲则实');
                kongEffects.push({ key: p.key, zhi: p.zhi, text: p.name + p.zhi + '落日柱旬空，原局逢冲，冲空则实，不作空论' });
            } else {
                var factor = bound ? (1 + P.kongFactor) / 2 : P.kongFactor;
                scaleBranch(p, factor);
                p.ganPower *= (1 + factor) / 2;
                addFlag(p, '旬空减力×' + round2(factor));
                kongEffects.push({
                    key: p.key, zhi: p.zhi,
                    text: p.name + p.zhi + '落日柱旬空' + (bound ? '，逢合解空、减力折半' : '') + '，藏干×' + round2(factor) + '，其力难实'
                });
            }
        });

        var totals = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
        var visible = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
        var hidden = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
        pillars.forEach(function (p) {
            p.branchPower = branchPower(p);
            totals[p.ganWx] += p.ganPower;
            visible[p.ganWx] += 1;
            visible[p.zhiWx] += 1;
            p.cang.forEach(function (c) {
                totals[c.wx] += c.power;
                hidden[c.wx] += 1;
            });
        });
        WX.forEach(function (el) { totals[el] += extra[el] || 0; });
        var total = sum(WX.map(function (el) { return totals[el]; }));
        var percent = {};
        WX.forEach(function (el) { percent[el] = total > 0 ? round1(totals[el] / total * 100) : 0; });

        var strongest = WX.slice().sort(function (a, b) { return totals[b] - totals[a]; });
        var weakest = strongest.slice().reverse();
        var missing = WX.filter(function (el) { return totals[el] <= 0.001; });
        var weak = WX.filter(function (el) { return totals[el] > 0.001 && percent[el] < 8; });
        var excess = WX.filter(function (el) { return percent[el] > 30; });

        var stateText = WX.map(function (el) { return el + state[el]; }).join('、');
        var multText = WX.map(function (el) { return el + '×' + mult[el].toFixed(2); }).join('、');

        var topologyNodes = [];
        pillars.forEach(function (p) {
            topologyNodes.push({ key: p.key + '-gan', pillarKey: p.key, kind: '天干', char: p.gan, wx: p.ganWx, power: round2(p.ganPower) });
            topologyNodes.push({ key: p.key + '-zhi', pillarKey: p.key, kind: '地支', char: p.zhi, wx: p.zhiWx, power: round2(branchPower(p)) });
        });
        var topologyMatrix = topologyNodes.map(function (a) {
            return topologyNodes.map(function (b) {
                return a.pillarKey === b.pillarKey ? 1.0 : topoDistance(a.pillarKey, b.pillarKey);
            });
        });

        var summary = buildWuXingSummary(percent, state, missing, weak, excess, strongest, weakest)
            + chart.siLing.short + '；' + earthPhysics.text + '。';

        return {
            pillars: pillars,
            state: state,
            mult: mult,
            stateText: stateText,
            multText: multText,
            relations: relations,
            extra: extra,
            totals: totals,
            total: total,
            percent: percent,
            visible: visible,
            hidden: hidden,
            strongest: strongest,
            weakest: weakest,
            missing: missing,
            weak: weak,
            excess: excess,
            siLing: chart.siLing,
            siLingApplied: siLingApplied,
            earthPhysics: earthPhysics,
            kongEffects: kongEffects,
            topology: { nodes: topologyNodes, matrix: topologyMatrix },
            summary: summary
        };
    }

    function buildWuXingSummary(percent, state, missing, weak, excess, strongest, weakest) {
        var parts = [];
        if (excess.length) parts.push(excess.join('、') + '偏旺');
        if (missing.length) parts.push(missing.join('、') + '全无');
        else if (weak.length) parts.push(weak.join('、') + '偏弱');
        if (!parts.length) parts.push('五行流通较为均衡');
        return parts.join('，') + '；月令' + WX.map(function (el) { return el + state[el]; }).join('、')
            + '；最旺' + strongest[0] + '（' + percent[strongest[0]] + '%），最弱' + weakest[0] + '（' + percent[weakest[0]] + '%）。';
    }

    /* ---------------------------------------------------------------------
     * 6. 原局关系：天干五合冲、地支刑冲合害暗合
     * ------------------------------------------------------------------- */
    function pairOf(list, a, b) {
        for (var i = 0; i < list.length; i++) {
            if ((list[i][0] === a && list[i][1] === b) || (list[i][0] === b && list[i][1] === a)) return list[i];
        }
        return null;
    }

    function detectRelations(pillars) {
        var out = [];
        var pairs = [];
        for (var i = 0; i < pillars.length; i++) {
            for (var j = i + 1; j < pillars.length; j++) pairs.push([i, j]);
        }

        function rel(type, pair, keys, note, extra) {
            var positions = keys.map(function (k, idx) {
                var p = pillars.filter(function (x) { return x.key === k; })[0];
                return p ? p.name : '岁运';
            }).join('·');
            var item = {
                type: type,
                pair: pair,
                keys: keys,
                positions: positions,
                note: note,
                effect: ''
            };
            if (extra) Object.keys(extra).forEach(function (k) { item[k] = extra[k]; });
            out.push(item);
        }

        pairs.forEach(function (pair) {
            var a = pillars[pair[0]], b = pillars[pair[1]];
            var keys = [a.key, b.key];

            GAN_HE.forEach(function (h) {
                if ((a.gan === h[0] && b.gan === h[1]) || (a.gan === h[1] && b.gan === h[0])) {
                    rel('天干五合', a.gan + b.gan, keys, a.gan + b.gan + '合化' + h[2], { targetElement: h[2] });
                }
            });
            GAN_CHONG.forEach(function (h) {
                if ((a.gan === h[0] && b.gan === h[1]) || (a.gan === h[1] && b.gan === h[0])) {
                    rel('天干相冲', a.gan + b.gan, keys, a.gan + b.gan + '相冲，双方天干力量折损');
                }
            });
            LIU_CHONG.forEach(function (h) {
                if ((a.zhi === h[0] && b.zhi === h[1]) || (a.zhi === h[1] && b.zhi === h[0])) {
                    rel('地支六冲', a.zhi + b.zhi, keys, a.zhi + b.zhi + '相冲');
                }
            });
            LIU_HE.forEach(function (h) {
                if ((a.zhi === h[0] && b.zhi === h[1]) || (a.zhi === h[1] && b.zhi === h[0])) {
                    rel('地支六合', a.zhi + b.zhi, keys, a.zhi + b.zhi + '六合化' + h[2], { targetElement: h[2] });
                }
            });
            LIU_HAI.forEach(function (h) {
                if ((a.zhi === h[0] && b.zhi === h[1]) || (a.zhi === h[1] && b.zhi === h[0])) {
                    rel('地支六害', a.zhi + b.zhi, keys, a.zhi + b.zhi + '相害，主暗耗与误会');
                }
            });
            AN_HE.forEach(function (h) {
                if ((a.zhi === h[0] && b.zhi === h[1]) || (a.zhi === h[1] && b.zhi === h[0])) {
                    rel('地支暗合', a.zhi + b.zhi, keys, a.zhi + b.zhi + '暗合，主暗中牵引与消耗');
                }
            });
            XING_PAIRS.forEach(function (h) {
                if ((a.zhi === h[0] && b.zhi === h[1]) || (a.zhi === h[1] && b.zhi === h[0])) {
                    rel('地支相刑', a.zhi + b.zhi, keys, a.zhi + b.zhi + '相刑，主摩擦与内耗');
                }
            });
        });

        /* 三合、三会、半合 */
        var zhis = pillars.map(function (p) { return p.zhi; });
        var uniqueZhi = uniq(zhis);
        SAN_HE.forEach(function (group) {
            var present = group.slice(0, 3).filter(function (z) { return uniqueZhi.indexOf(z) !== -1; });
            var keys = pillars.filter(function (p) { return present.indexOf(p.zhi) !== -1; }).map(function (p) { return p.key; });
            if (present.length === 3) {
                rel('三合局', present.join(''), keys, present.join('') + '三合' + group[3] + '局', { targetElement: group[3], powerFactor: 0.28 });
            } else if (present.length === 2 && present.indexOf(group[1]) !== -1) {
                rel('半合局', present.join(''), keys, present.join('') + '半合' + group[3] + '局', { targetElement: group[3], powerFactor: 0.14 });
            } else if (present.length === 2) {
                rel('拱合局', present.join(''), keys, present.join('') + '拱' + group[1] + group[3] + '局', { targetElement: group[3], archZhi: group[1], powerFactor: 0.08 });
            }
        });
        SAN_HUI.forEach(function (group) {
            var present = group.slice(0, 3).filter(function (z) { return uniqueZhi.indexOf(z) !== -1; });
            var keys = pillars.filter(function (p) { return present.indexOf(p.zhi) !== -1; }).map(function (p) { return p.key; });
            if (present.length === 3) {
                rel('三会局', present.join(''), keys, present.join('') + '三会' + group[3] + '局', { targetElement: group[3], powerFactor: 0.32 });
            }
        });

        /* 完整三刑 */
        [['寅', '巳', '申'], ['丑', '戌', '未']].forEach(function (group) {
            if (group.every(function (z) { return uniqueZhi.indexOf(z) !== -1; })) {
                var keys = pillars.filter(function (p) { return group.indexOf(p.zhi) !== -1; }).map(function (p) { return p.key; });
                rel('三刑', group.join(''), keys, group.join('') + '三刑齐备，主压力、是非与健康留意');
            }
        });

        /* 自刑 */
        SELF_XING.forEach(function (z) {
            var group = pillars.filter(function (p) { return p.zhi === z; });
            if (group.length >= 2) {
                rel('自刑', z + z, group.map(function (p) { return p.key; }), z + z + '自刑，同气燥气被放大');
            }
        });

        var seen = {};
        return out.filter(function (r) {
            var key = r.type + '|' + r.pair + '|' + r.positions;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function monthSupportsElement(chart, el) {
        var state = seasonState(chart.monthZhi);
        if (state[el] === '旺' || state[el] === '相') return true;
        if (GAN_WX[chart.monthGan] === el || ZHI_WX[chart.monthZhi] === el) return true;
        var main = (CANG[chart.monthZhi] || [])[0];
        return !!(main && GAN_WX[main[0]] === el);
    }

    function applyNatalInteractions(pillars, relations, chart) {
        var map = {};
        pillars.forEach(function (p) { map[p.key] = p; });
        var extra = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };

        function scale(key, factor) {
            if (map[key]) scaleBranch(map[key], factor);
        }
        function addExtra(el, v) { if (extra[el] != null) extra[el] += v; }

        relations.forEach(function (r) {
            var a = map[r.keys[0]], b = map[r.keys[1]];
            if (!a || !b) return;

            if (r.type === '地支六冲') {
                var pa = branchPower(a), pb = branchPower(b);
                var weak = pa <= pb ? a : b;
                var strong = pa <= pb ? b : a;
                scaleBranch(weak, P.clashWeak);
                scaleBranch(strong, P.clashStrong);
                r.effect = '衰者' + weak.name + weak.zhi + '受冲，力量×' + P.clashWeak + '；旺者' + strong.name + strong.zhi + '×' + P.clashStrong;
            } else if (r.type === '地支六合') {
                if (monthSupportsElement(chart, r.targetElement)) {
                    var bp = (branchPower(a) + branchPower(b)) * 0.12;
                    scaleBranch(a, 0.92);
                    scaleBranch(b, 0.92);
                    addExtra(r.targetElement, bp);
                    r.transformed = true;
                    r.effect = '真合化' + r.targetElement + '（月令化神得助），双方各×0.92，' + r.targetElement + '得气+' + round2(bp);
                } else {
                    scaleBranch(a, P.bindFactor);
                    scaleBranch(b, P.bindFactor);
                    r.transformed = false;
                    r.effect = '合绊（化神无月令支持），双方地支各减力' + Math.round((1 - P.bindFactor) * 100) + '%，不化' + r.targetElement;
                }
            } else if (r.type === '地支暗合') {
                if (r.pair.indexOf('亥') !== -1) {
                    var hai = a.zhi === '亥' ? a : (b.zhi === '亥' ? b : null);
                    if (hai) {
                        scaleBranchElement(hai, '水', 0.82);
                        r.effect = '亥水被午暗合夹耗，水气×0.82';
                    }
                } else {
                    var weaker = branchPower(a) <= branchPower(b) ? a : b;
                    scaleBranch(weaker, 0.88);
                    r.effect = weaker.name + weaker.zhi + '被暗合牵制，力量×0.88';
                }
            } else if (r.type === '三合局' || r.type === '三会局' || r.type === '半合局' || r.type === '拱合局') {
                var totalBranch = 0;
                r.keys.forEach(function (k) { if (map[k]) totalBranch += branchPower(map[k]); });
                if (r.type === '拱合局') {
                    var archGain = totalBranch * (r.powerFactor || 0);
                    addExtra(r.targetElement, archGain);
                    r.transformed = null;
                    r.effect = r.pair + '拱' + r.archZhi + '，虚神得气，' + r.targetElement + '力量+' + round2(archGain);
                } else if (monthSupportsElement(chart, r.targetElement)) {
                    var gain = totalBranch * (r.powerFactor || 0);
                    addExtra(r.targetElement, gain);
                    r.transformed = true;
                    r.effect = r.pair + '真合化' + r.targetElement + '局（月令得助），' + r.targetElement + '力量+' + round2(gain);
                } else {
                    r.keys.forEach(function (k) { if (map[k]) scaleBranch(map[k], 0.75); });
                    r.transformed = false;
                    r.effect = r.pair + '合绊（化神无月令支持），涉事地支各减力25%，不化' + r.targetElement;
                }
            } else if (r.type === '三刑') {
                r.keys.forEach(function (k) { scale(k, 0.88); });
                r.effect = '三刑齐备，涉事地支力量各×0.88';
            } else if (r.type === '自刑') {
                var el = ZHI_WX[r.pair[0]];
                r.keys.forEach(function (k) {
                    if (map[k]) scaleBranchElement(map[k], el, 1.15);
                });
                r.effect = r.pair[0] + '气自刑，' + el + '力量各×1.15';
            } else if (r.type === '地支六害') {
                scaleBranch(a, 0.92);
                scaleBranch(b, 0.92);
                r.effect = '相害，双方地支力量×0.92';
            } else if (r.type === '天干五合') {
                if (monthSupportsElement(chart, r.targetElement)) {
                    var gp = (a.ganPower + b.ganPower) * 0.08;
                    a.ganPower *= 0.90;
                    b.ganPower *= 0.90;
                    addExtra(r.targetElement, gp);
                    r.transformed = true;
                    r.effect = '真合化' + r.targetElement + '（月令化神得助），双方天干×0.90，' + r.targetElement + '得气+' + round2(gp);
                } else {
                    a.ganPower *= P.bindFactor;
                    b.ganPower *= P.bindFactor;
                    r.transformed = false;
                    r.effect = '天干合绊（化神无月令支持），双方天干各减力' + Math.round((1 - P.bindFactor) * 100) + '%，不化' + r.targetElement;
                }
            } else if (r.type === '天干相冲') {
                a.ganPower *= 0.88;
                b.ganPower *= 0.88;
                r.effect = '天干相冲，双方天干×0.88';
            } else if (r.type === '地支相刑') {
                scaleBranch(a, 0.94);
                scaleBranch(b, 0.94);
                r.effect = '相刑，双方地支力量×0.94';
            }
        });

        return extra;
    }

    /* ---------------------------------------------------------------------
     * 7. 旺衰、格局、调候
     * ------------------------------------------------------------------- */
    function computeStrength(chart, model) {
        var dayWx = chart.dayWx;
        var resourceWx = WX_SHENG_BY[dayWx];
        var support = model.totals[dayWx] + model.totals[resourceWx];
        var total = model.total;
        var opposition = total - support;
        var rawRatio = total > 0 ? support / total * 100 : 0;

        var dayPillar = activePillars(chart).filter(function (p) { return p.key === 'day'; })[0];
        var roots = dayPillar.roots || [];
        var strongRootCount = dayPillar.strongRootCount || 0;
        var mediumRootCount = dayPillar.mediumRootCount || 0;
        var rootScore = dayPillar.rootScore || 0;

        var state = model.state;
        var lingStatus = state[dayWx];
        var deLing = lingStatus === '旺' || lingStatus === '相';
        var deDi = strongRootCount >= 1 || mediumRootCount >= 2;

        var helpers = [];
        activePillars(chart).forEach(function (p) {
            if (p.key === 'day') return;
            if (p.ganWx === dayWx || p.ganWx === resourceWx) {
                helpers.push({
                    position: p.name + '干',
                    gan: p.gan,
                    type: p.ganWx === dayWx ? '比劫帮身' : '印星生身',
                    power: round2(p.ganPower)
                });
            }
        });
        var deShi = helpers.length >= 1;

        var effRatio = rawRatio;
        var floorApplied = false;
        var floorNote = '';
        if (deLing && strongRootCount >= 2) {
            if (effRatio < 58) {
                effRatio = 58;
                floorApplied = true;
                floorNote = '日主得月令且地支强根≥2，按规则同党占比下限取 58%';
            }
            if (rootScore >= 2.0 || (rootScore >= 1.5 && deShi)) {
                if (effRatio < 72) {
                    effRatio = 72;
                    floorApplied = true;
                    floorNote = '根气深厚（根气系数 ' + round2(rootScore) + '），按规则下限取 72%';
                }
            }
        }

        var status;
        if (effRatio >= 72) status = '身强';
        else if (effRatio >= 58) status = '偏强';
        else if (effRatio >= 45) status = '中和';
        else if (effRatio >= 32) status = '偏弱';
        else status = '身弱';

        var lingText = '日主' + chart.dayGan + dayWx + '生于' + chart.monthZhi + '月，'
            + ZHI_WX[chart.monthZhi] + '气当令，日主' + dayWx + lingStatus + '，' + (deLing ? '得令' : '失令');
        var rootText = roots.length
            ? '地支见' + uniq(roots.map(function (r) { return r.branch; })).join('、') + '通根（根气系数 ' + round2(rootScore) + '），' + (deDi ? '得地' : '根气尚浅')
            : '地支无同气之根，' + (deDi ? '得地' : '不得地');
        var helperText = helpers.length
            ? '天干见' + helpers.map(function (h) { return h.gan; }).join('、') + '帮扶，得势'
            : '天干无印比帮扶，不得势';

        var factors = [];
        factors.push('月令' + chart.monthZhi + '：' + model.stateText + '；季节乘数 ' + model.multText);
        factors.push('人元司令：' + chart.siLing.text + '；司令之气在月支藏干中额外×1.25（藏干无该干时取同气藏干承载）。');
        factors.push('8节点空间拓扑：同柱1.00、相邻0.85、隔一0.40、遥隔0.15；通根、生克与合冲均按柱位距离衰减，不再使用固定宫位系数。');
        if (model.siLingApplied) {
            var sla = model.siLingApplied;
            factors.push('司令加成：' + (sla.gan === chart.siLing.gan
                ? sla.branch + '月' + sla.gan + '（' + sla.wx + '）司令，月支藏干力量 ' + sla.before + ' → ' + sla.after + '（×1.25）。'
                : chart.siLing.gan + sla.wx + '司令，' + sla.branch + '支藏干无' + chart.siLing.gan + '，以同气'
                    + sla.gan + sla.wx + '承载，藏干力量 ' + sla.before + ' → ' + sla.after + '（×1.25）。'));
        }
        factors.push('湿燥土物理：' + model.earthPhysics.text);
        activePillars(chart).forEach(function (p) {
            factors.push(p.name + ' ' + p.ganzhi + '：天干' + p.rootType + '（' + p.rootNote + '）；自坐' + p.seat + '（' + p.seatNote + '）');
        });
        var factorSeen = {};
        model.relations.forEach(function (r) {
            if (!r.effect) return;
            var key = r.type + '|' + r.pair.split('').sort().join('') + '|' + r.effect;
            if (factorSeen[key]) return;
            factorSeen[key] = true;
            factors.push(r.type + ' ' + r.pair + '：' + r.effect);
        });

        var summary = lingText + '；' + rootText + '；' + helperText + '。同党（' + dayWx + '、' + resourceWx + '）'
            + round2(support) + '，异党 ' + round2(opposition) + '，占比 ' + round1(effRatio) + '%，判为' + status
            + (floorApplied ? '（动态下限校验）' : '') + '。';

        return {
            ratio: round1(effRatio),
            rawRatio: round1(rawRatio),
            support: round2(support),
            opposition: round2(opposition),
            total: round2(total),
            status: status,
            isStrong: effRatio >= 58,
            deLing: deLing,
            deDi: deDi,
            deShi: deShi,
            lingStatus: lingStatus,
            lingText: lingText,
            rootText: rootText,
            helperText: helperText,
            rootScore: round2(rootScore),
            strongRootCount: strongRootCount,
            mediumRootCount: mediumRootCount,
            roots: roots,
            helpers: helpers,
            floorApplied: floorApplied,
            floorNote: floorNote,
            summary: summary,
            factors: factors,
            special: ''
        };
    }

    function detectSpecial(strength, model, chart) {
        var total = model.total;
        var pct = function (el) { return total > 0 ? model.totals[el] / total * 100 : 0; };
        var dayWx = chart.dayWx;
        var officer = WX_KE_BY[dayWx];
        var wealth = WX_KE[dayWx];
        var output = WX_SHENG[dayWx];
        var resource = WX_SHENG_BY[dayWx];
        var strongRoot = strength.strongRootCount;

        function hasSupportRoot(wx) {
            return chart.pillars.some(function (p) {
                return p.cang.some(function (c) {
                    return c.wx === wx && c.ratio >= 0.3;
                });
            });
        }

        if (strength.rawRatio >= 80 && pct(dayWx) + pct(resource) >= 86 && pct(officer) <= 8 && pct(wealth) <= 8) {
            return pct(dayWx) >= 45 ? '专旺格' : '从强格';
        }
        if (strength.rawRatio < P.congThreshold && pct(wealth) >= 40 && strongRoot === 0
            && pct(resource) < 10 && !hasSupportRoot(resource) && !hasSupportRoot(dayWx)
            && pct(officer) < 18) {
            return '从财格';
        }
        if (strength.rawRatio < P.congThreshold - 4 && pct(officer) >= 42 && strongRoot === 0
            && pct(resource) < 8 && !hasSupportRoot(resource) && !hasSupportRoot(dayWx)
            && pct(output) < 15) {
            return '从杀格';
        }
        if (strength.rawRatio < P.congThreshold - 4 && pct(output) >= 48 && strongRoot === 0
            && pct(resource) < 8 && !hasSupportRoot(resource) && !hasSupportRoot(dayWx)
            && pct(officer) < 12) {
            return '从儿格';
        }

        /* 假从格：从势已成而日主有微根或印星虚透——根气被冲克受损则从之不真，
         * 行运去其病（克去微根/印比）则假从成真，扶起微根则破格还原。 */
        if (strength.rawRatio < P.congThreshold + 8 && strongRoot === 0 && pct(resource) < 14) {
            var supportCang = [];
            activePillars(chart).forEach(function (p) {
                p.cang.forEach(function (c) {
                    if ((c.wx === dayWx || c.wx === resource) && c.ratio >= 0.3) supportCang.push(c);
                });
            });
            var allDamaged = supportCang.length > 0 && supportCang.every(function (c) {
                return (c.preInteract > 0 ? c.power / c.preInteract : 1) < 0.6;
            });
            var noRealSupport = allDamaged || supportCang.length === 0 || pct(resource) < 6;
            if (noRealSupport) {
                if (pct(wealth) >= 38 && pct(wealth) >= pct(officer) && pct(wealth) >= pct(output)) return '假从财格';
                if (pct(officer) >= 40 && pct(officer) >= pct(wealth) && pct(output) < 18) return '假从杀格';
                if (pct(output) >= 44 && pct(output) >= pct(wealth) && pct(officer) < 14) return '假从儿格';
            }
        }
        return '';
    }

    /* 化气格：日干与月干或时干五合，化神得月令或成方成局，无强根还原、无争合、无克化神强旺 */
    function detectHuaQi(chart, model, strength) {
        var dayGan = chart.dayGan;
        var partner = null;
        [chart.monthGan, chart.hourGan].forEach(function (g) {
            if (!g || partner) return;
            GAN_HE.forEach(function (h) {
                if ((h[0] === dayGan && h[1] === g) || (h[1] === dayGan && h[0] === g)) {
                    partner = { gan: g, element: h[2] };
                }
            });
        });
        if (!partner) return null;
        if (strength.strongRootCount > 0) return null;
        /* 印星本气根完好则生身不化；中余气微印不碍合化 */
        var resEl = WX_SHENG_BY[chart.dayWx];
        var resRoot = chart.pillars.some(function (p) {
            return p.cang.some(function (c) {
                return c.wx === resEl && c.ratio >= 0.5
                    && (c.preInteract > 0 ? c.power / c.preInteract : 1) >= 0.75;
            });
        });
        if (resRoot) return null;
        /* 印星透干且有气，生身有力，亦不化 */
        var resTransparent = [chart.yearGan, chart.monthGan, chart.hourGan].some(function (g) {
            return g && GAN_WX[g] === resEl;
        });
        var resPct = model.total > 0 ? model.totals[resEl] / model.total * 100 : 0;
        if (resTransparent && resPct >= 8) return null;
        var yearHe = GAN_HE.some(function (h) {
            return (h[0] === dayGan && h[1] === chart.yearGan) || (h[1] === dayGan && h[0] === chart.yearGan);
        });
        if (yearHe && chart.yearGan !== partner.gan) return null;
        var el = partner.element;
        var state = seasonState(chart.monthZhi);
        var monthSupport = state[el] === '旺' || state[el] === '相';
        var juSupport = model.relations.some(function (r) {
            return (r.type === '三合局' || r.type === '三会局') && r.targetElement === el;
        });
        var keEl = WX_KE_BY[el];
        var pctKe = model.total > 0 ? model.totals[keEl] / model.total * 100 : 0;
        if ((monthSupport || juSupport) && pctKe < 12) return partner;
        return null;
    }

    function determineGeju(chart, model, strength) {
        var monthCang = activePillars(chart)[1].cang;
        var monthMain = monthCang[0].gan;
        var monthMainSS = tenGod(chart.dayGan, monthMain);
        var lu = LU[chart.dayGan];
        var blade = bladeZhi(chart.dayGan);
        var gans = activePillars(chart).map(function (p) { return p.gan; });
        var transparent = monthCang.filter(function (c) {
            return gans.indexOf(c.gan) !== -1 && c.tenGod !== '比肩' && c.tenGod !== '劫财';
        }).map(function (c) { return c.gan; });

        var name = '', basisGan = monthMain, basis = '';
        if (chart.monthZhi === lu) {
            name = '建禄格';
            basis = '月令' + chart.monthZhi + '为日主' + chart.dayGan + '之禄，取建禄格';
        } else if (chart.monthZhi === blade && chart.monthZhi !== lu) {
            name = '阳刃格';
            basis = '月令' + chart.monthZhi + '为日主' + chart.dayGan + '之刃，取阳刃格';
        } else {
            basisGan = transparent.length ? transparent[0] : monthMain;
            var ss = tenGod(chart.dayGan, basisGan);
            if (ss === '比肩' || ss === '劫财') name = '月劫格';
            else name = ss + '格';
            basis = transparent.length
                ? '月令' + chart.monthZhi + '藏' + basisGan + '（' + ss + '）透干，取' + name
                : '月令' + chart.monthZhi + '本气' + basisGan + '（' + ss + '）不透，以月令本气取格';
        }

        var desc = {
            正官格: '正官格：官星当令，为人守礼重名；身旺喜官星与财生官，身弱则取印化官护身，忌伤官见官。',
            七杀格: '七杀格：杀星当令，行事果断有魄力；身旺喜食伤制杀，身弱喜印化杀或比劫帮身，忌杀重无制。',
            正财格: '正财格：财星当令，务实理财；身旺能任财则喜财，身弱或财寒则先扶身暖局，忌比劫夺财。',
            偏财格: '偏财格：偏财当令，善交际经营；身旺能任财则喜财，身弱或财寒则先扶身暖局，忌劫财争夺。',
            食神格: '食神格：食神当令，温和有才艺；身旺喜食神生财，身弱则取印制食护身，忌枭神夺食。',
            伤官格: '伤官格：伤官当令，聪明有创意；身旺喜财星转化，身弱则取印制伤，忌伤官见官。',
            正印格: '正印格：印星当令，重学有涵养；身弱喜官杀生印，印重身强则取财坏印、食伤泄秀。',
            偏印格: '偏印格：偏印当令，思辨独特；身弱喜印，印重则取食伤泄秀，忌枭神夺食。',
            建禄格: '建禄格：日主得禄于月令，自立自强，喜财官食伤透出，忌比劫过重。',
            阳刃格: '阳刃格：月令羊刃，性格刚强果决，喜官杀制刃，忌刃旺无制。',
            月劫格: '月劫格：月令劫财，喜官杀制劫、食伤生财，忌比劫争财。',
            从强格: '从强格：日主成势，顺势取强，喜印比顺其气势，忌财官逆势破格。',
            专旺格: '专旺格：一气专旺，格局纯粹，喜印比顺气，忌财官逆势。',
            从财格: '从财格：财星成势，日主无根，顺势取财，喜食伤生财、财星助势，忌比劫印星破格。',
            从杀格: '从杀格：官杀成势，日主无根，顺势从杀，喜财官助势，忌食伤印比逆势。',
            从儿格: '从儿格：食伤成势，日主无根，顺势从儿，喜食伤财星，忌印比逆势。',
            假从财格: '假从财格：财势已成而日主微根未尽，从之不真；行运克去微根则假从成真而发，扶起根印则破格还原，吉凶随运摇摆。',
            假从杀格: '假从杀格：杀势已成而日主微根未尽，从之不真；行运去病则假从成真，扶身则破格，宜察运之去留。',
            假从儿格: '假从儿格：食伤成势而日主微根未尽，从之不真；行运去病则秀气流行，扶身则破格，宜察运之去留。',
            化气格: '化气格：日干合化成功，以化神为体论命，喜生助化神，忌克化神与日主得根还原。'
        };

        var special = detectSpecial(strength, model, chart);
        var hua = detectHuaQi(chart, model, strength);
        var huaElement = null;
        if (hua && !special) {
            special = '化气格';
            huaElement = hua.element;
            name = '化气格';
            basis = '日干' + chart.dayGan + '与' + hua.gan + '五合化' + hua.element + '，化神得令成势，以化气格论';
        } else if (special) {
            name = special;
            basis = special.indexOf('假') === 0
                ? '原局气势偏向' + special.replace('假', '').replace('格', '') + '，而日主微根未尽，以假从格论，行运去病则真'
                : '原局气势偏向' + special.replace('格', '') + '，以特殊格局论';
        }
        strength.special = special;

        return {
            name: name,
            mainShishen: monthMainSS,
            basisGan: basisGan,
            basis: basis,
            transparent: transparent,
            special: special,
            huaElement: huaElement,
            description: desc[name] || name
        };
    }

    function tiaohouElementList(dayGan, monthZhi) {
        var str = (TIAOHOU[dayGan] && TIAOHOU[dayGan][monthZhi]) || '';
        return uniq(str.split('').map(function (g) { return GAN_WX[g]; }));
    }

    function computeTiaohou(chart, model) {
        var dayGan = chart.dayGan;
        var monthZhi = chart.monthZhi;
        var total = model.total;
        var pct = function (el) { return total > 0 ? model.totals[el] / total * 100 : 0; };
        var isSummer = ['巳', '午', '未'].indexOf(monthZhi) !== -1;
        var isWinter = ['亥', '子', '丑'].indexOf(monthZhi) !== -1;
        var countWu = activePillars(chart).filter(function (p) { return p.zhi === '午'; }).length;
        var countZi = activePillars(chart).filter(function (p) { return p.zhi === '子'; }).length;
        var selfWu = model.relations.some(function (r) { return r.type === '自刑' && r.pair === '午午'; });
        var selfZi = model.relations.some(function (r) { return r.type === '自刑' && r.pair === '子子'; });

        /* 寒暖指数与燥湿指数各自独立计算，均以 50 为中和基准。 */
        var seasonWarm = { 寅: 4, 卯: 3, 辰: 2, 巳: 10, 午: 14, 未: 13, 申: -2, 酉: -3, 戌: -2, 亥: -8, 子: -14, 丑: -9 };
        var seasonDry = { 寅: -2, 卯: -1, 辰: 2, 巳: 8, 午: 12, 未: 14, 申: 2, 酉: 0, 戌: 8, 亥: -3, 子: -4, 丑: -5 };
        var wetBranches = [], dryBranches = [], wetPower = 0, dryPower = 0;
        activePillars(chart).forEach(function (p) {
            if (WET_EARTH.indexOf(p.zhi) !== -1) {
                wetBranches.push(p.zhi);
                wetPower += branchPower(p);
            } else if (DRY_EARTH.indexOf(p.zhi) !== -1) {
                dryBranches.push(p.zhi);
                dryPower += branchPower(p);
            }
        });
        var firePct = pct('火'), waterPct = pct('水'), woodPct = pct('木'), metalPct = pct('金'), earthPct = pct('土');
        var warmth = 50 + seasonWarm[monthZhi]
            + (firePct - 20) * 0.95 + (woodPct - 20) * 0.30
            - (waterPct - 20) * 0.85 - (metalPct - 20) * 0.20
            + wetPower * 0.80 - dryPower * 0.90;
        var dryness = 50 + seasonDry[monthZhi]
            + (firePct - 20) * 0.85 + (earthPct - 20) * 0.35
            - (waterPct - 20) * 0.90 - (woodPct - 20) * 0.10
            + dryPower * 2.20 - wetPower * 2.00;
        warmth = round1(clamp(warmth, 0, 100));
        dryness = round1(clamp(dryness, 0, 100));

        function warmthLabel(v) {
            if (v >= 70) return '极热';
            if (v >= 58) return '偏热';
            if (v >= 44) return '温和';
            if (v >= 32) return '偏寒';
            return '极寒';
        }
        function drynessLabel(v) {
            if (v >= 68) return '极燥';
            if (v >= 56) return '偏燥';
            if (v >= 44) return '润燥适中';
            if (v >= 32) return '偏湿';
            return '极湿';
        }
        var warmLabel = warmthLabel(warmth);
        var dryLabel = drynessLabel(dryness);
        var extremeHot = warmth >= 70 && dryness >= 62;
        var extremeCold = warmth <= 32 && dryness <= 38;
        var dryHot = extremeHot || (isSummer && warmth >= 58 && dryness >= 50);
        var coldWet = extremeCold || (isWinter && warmth <= 42 && dryness <= 48);

        var classical = (TIAOHOU[dayGan] && TIAOHOU[dayGan][monthZhi]) || '';
        var mode = dryHot ? 'dry-hot' : (coldWet ? 'cold-wet' : 'balanced');
        var elements, primary, secondary, avoid, note, weight;

        if (dryHot) {
            elements = ['水', '金'];
            primary = '水';
            secondary = '金';
            avoid = ['火', '土'];
            weight = round1(clamp((extremeHot ? 50 : 45) * P.tiaohouWeight, 0, 80));
            note = '夏火当令、火炎土燥' + (selfWu ? '，且午午自刑' : '') + '；寒暖 ' + warmth + '（' + warmLabel + '）、燥湿 ' + dryness + '（' + dryLabel + '）'
                + '，调候以水润局为先、金生水为佐，火与燥土助燥为忌。'
                + (wetBranches.length ? '原局见' + uniq(wetBranches).join('、') + '湿土，燥性稍减，但仍不宜再见火土。' : '原局无湿土润局，水金尤为紧要。');
        } else if (coldWet) {
            elements = ['火', '木'];
            primary = '火';
            secondary = '木';
            avoid = ['水', '金'];
            weight = round1(clamp((extremeCold ? 50 : 45) * P.tiaohouWeight, 0, 80));
            note = '冬水当令、水冷金寒' + (selfZi ? '，且子子自刑' : '') + '；寒暖 ' + warmth + '（' + warmLabel + '）、燥湿 ' + dryness + '（' + dryLabel + '）'
                + '，调候以火暖局为先、木生火为佐，水与金助寒为忌。'
                + (dryBranches.length ? '原局见' + uniq(dryBranches).join('、') + '燥土，寒气稍解，但仍需火来发荣。' : '');
        } else {
            var list = tiaohouElementList(dayGan, monthZhi);
            elements = list.slice(0, 2);
            primary = elements[0] || '';
            secondary = elements[1] || '';
            avoid = [];
            weight = round1(clamp(((isSummer || isWinter) ? 45 : 25) * P.tiaohouWeight, 0, 80));
            note = dayGan + '日' + monthZhi + '月，寒暖 ' + warmth + '（' + warmLabel + '）、燥湿 ' + dryness + '（' + dryLabel + '）；'
                + '《穷通宝鉴》调候取' + (primary || '无') + (secondary ? '、' + secondary : '')
                + '。气候未至极偏，调候权重 ' + weight + '%，以扶抑与格局为主、调候为辅。';
        }

        var climate = {
            warmth: warmth,
            dryness: dryness,
            warmthLabel: warmLabel,
            drynessLabel: dryLabel,
            wetBranches: uniq(wetBranches),
            dryBranches: uniq(dryBranches),
            wetPower: round2(wetPower),
            dryPower: round2(dryPower),
            extremeHot: extremeHot,
            extremeCold: extremeCold,
            weight: weight,
            text: '寒暖指数 ' + warmth + '/100（' + warmLabel + '），燥湿指数 ' + dryness + '/100（' + dryLabel + '）'
                + (wetBranches.length ? '，湿土' + uniq(wetBranches).join('、') + '润局' : '')
                + (dryBranches.length ? '，燥土' + uniq(dryBranches).join('、') + '助燥' : '')
                + '；调候权重 ' + weight + '%。'
        };

        return {
            classical: classical,
            elements: elements,
            primary: primary,
            secondary: secondary,
            avoid: avoid,
            mode: mode,
            weight: weight,
            warmth: warmth,
            dryness: dryness,
            warmthLabel: warmLabel,
            drynessLabel: dryLabel,
            climate: climate,
            note: note,
            description: '调候：' + (classical ? '《穷通宝鉴》取' + classical + '；' : '') + note
        };
    }

    /* ---------------------------------------------------------------------
     * 7.5 全局流通链、格局成败与病药
     * ------------------------------------------------------------------- */
    function computeFlow(chart, model, strength, geju, tiaohou) {
        var dayWx = chart.dayWx;
        var resource = WX_SHENG_BY[dayWx];
        var output = WX_SHENG[dayWx];
        var wealth = WX_KE[dayWx];
        var officer = WX_KE_BY[dayWx];
        var total = model.total || 1;
        var pct = function (el) { return model.totals[el] / total * 100; };

        var roles = [
            { key: '印星', el: resource, value: pct(resource) },
            { key: '日主', el: dayWx, value: pct(dayWx) },
            { key: '食伤', el: output, value: pct(output) },
            { key: '财星', el: wealth, value: pct(wealth) },
            { key: '官杀', el: officer, value: pct(officer) }
        ];

        var god = {
            比肩: 0, 劫财: 0, 食神: 0, 伤官: 0, 偏财: 0, 正财: 0,
            七杀: 0, 正官: 0, 偏印: 0, 正印: 0
        };
        var godCount = {};
        Object.keys(god).forEach(function (n) { godCount[n] = 0; });
        activePillars(chart).forEach(function (p) {
            if (p.key !== 'day' && god[p.shishen] != null) {
                god[p.shishen] += p.ganPower;
                godCount[p.shishen] += 1;
            }
            p.cang.forEach(function (c) {
                if (god[c.tenGod] != null) {
                    god[c.tenGod] += c.power;
                    godCount[c.tenGod] += 1;
                }
            });
        });

        var chain = [];
        [['印星', '日主'], ['日主', '食伤'], ['食伤', '财星'], ['财星', '官杀'], ['官杀', '印星']].forEach(function (pair) {
            var a = roles.filter(function (r) { return r.key === pair[0]; })[0];
            var b = roles.filter(function (r) { return r.key === pair[1]; })[0];
            var q = clamp(Math.min(a.value, b.value) / 13 * 100, 0, 100);
            var state = q >= 55 ? '通' : (q >= 28 ? '偏滞' : '断');
            var note = a.key + '（' + a.el + ' ' + round1(a.value) + '%）生' + b.key + '（' + b.el + ' ' + round1(b.value) + '%）';
            if (state !== '通') note += '，通道' + state;
            chain.push({
                from: a.key, to: b.key, fromEl: a.el, toEl: b.el,
                quality: Math.round(q), state: state, note: note
            });
        });

        var quality = Math.round(sum(chain.map(function (c) { return c.quality; })) / chain.length);
        if (tiaohou.mode === 'dry-hot') {
            quality = clamp(quality - (tiaohou.warmth >= 70 ? 12 : 6), 0, 100);
            chain.forEach(function (c) {
                if (c.toEl === '水' || c.fromEl === '水') {
                    c.quality = clamp(c.quality - 18, 0, 100);
                    c.state = c.quality >= 55 ? '通' : (c.quality >= 28 ? '偏滞' : '断');
                    c.note += '；火炎土燥，水气受熬，通道偏滞';
                }
            });
        } else if (tiaohou.mode === 'cold-wet') {
            quality = clamp(quality - 8, 0, 100);
            chain.forEach(function (c) {
                if (c.toEl === '火' || c.fromEl === '火') {
                    c.quality = clamp(c.quality - 15, 0, 100);
                    c.state = c.quality >= 55 ? '通' : (c.quality >= 28 ? '偏滞' : '断');
                    c.note += '；水冷金寒，火气受抑，通道偏滞';
                }
            });
        }
        var qualityLabel = quality >= 70 ? '流通顺畅' : (quality >= 52 ? '流通尚可' : (quality >= 34 ? '流通偏滞' : '流通阻滞'));

        function has(name, min) {
            var c = godCount[name] || 0;
            if (!c) return false;
            return min == null || (god[name] || 0) >= min * 0.35;
        }
        var wealthFav = tiaohou.elements.indexOf(wealth) !== -1
            || (strength.ratio >= 58 && pct(wealth) >= 8);
        var patterns = [];
        function pat(name, type, reason) {
            if (!patterns.some(function (p) { return p.name === name; })) {
                patterns.push({ name: name, type: type, reason: reason });
            }
        }

        if ((has('伤官', 0.6) && (has('正财') || has('偏财'))) && tiaohou.avoid.indexOf(output) === -1) {
            pat('伤官生财', '成', '伤官透出而财星有根，才华可转化为现金流');
        }
        if ((has('食神', 0.6) && (has('正财') || has('偏财'))) && tiaohou.avoid.indexOf(output) === -1) {
            pat('食神生财', '成', '食神吐秀生财，稳健经营之象');
        }
        if (has('食神', 0.6) && has('七杀', 0.5) && pct(officer) >= 8) {
            pat('食神制杀', '成', '食神制杀，能以专业与规则化解压力');
        }
        if (has('七杀', 0.5) && (has('正印', 0.5) || has('偏印', 0.5)) && pct(officer) >= 8) {
            pat('杀印相生', '成', '七杀生印、印再生身，压力可转为权柄');
        }
        if (has('正官', 0.5) && (has('正印', 0.5) || has('偏印', 0.5)) && pct(officer) >= 8) {
            pat('官印相生', '成', '官星得印，名位与学识相承');
        }
        if ((has('正财') || has('偏财')) && has('正官', 0.5) && pct(wealth) >= 8 && pct(officer) >= 8) {
            pat('财官相生', '成', '财星生官，资源可转为地位');
        }
        var luYue = ['建禄格', '阳刃格', '月劫格'].indexOf(geju.name) !== -1;
        if (!luYue && has('伤官', 0.8) && has('正官', 0.8) && pct(officer) >= 10) {
            pat('伤官见官', '破', '伤官与正官并见，规则与锋芒相冲');
        }
        if (has('偏印', 0.6) && has('食神', 0.6) && pct(resource) >= 24) {
            pat('枭神夺食', '破', '偏印压食神，计划与福气易被打断');
        }
        if (pct(dayWx) >= 30 && pct(wealth) >= 6 && pct(wealth) < 18 && has('正财')
            && !has('伤官') && !has('食神') && !has('正官') && !has('七杀')) {
            pat('群比争财', '破', '比劫成群而财星单薄且无食伤官杀通关，合伙与借贷易生争夺');
        }
        if (pct(officer) >= 30 && strength.ratio < 48) {
            pat('官杀攻身', '破', '官杀成势而日主偏弱，压力先于机会');
        }
        if (pct(wealth) >= 32 && strength.ratio < 45) {
            pat('财多身弱', '破', '财星过重而日主难任，宜先扶身');
        }

        var combos = patterns.filter(function (p) { return p.type === '成'; }).map(function (p) { return p.name; });
        var breaks = patterns.filter(function (p) { return p.type === '破'; }).map(function (p) { return p.name; });
        var status, level, reason;
        var special = geju.special;

        if (special) {
            status = '成格（清）';
            level = 'good';
            reason = '特殊格局气势专一，顺势为清';
        } else if (['建禄格', '阳刃格', '月劫格'].indexOf(geju.name) !== -1) {
            var drains = ['伤官生财', '食神生财', '财官相生', '食神制杀', '杀印相生', '官印相生'].filter(function (n) {
                return combos.indexOf(n) !== -1;
            });
            if (drains.length) {
                status = breaks.length ? '成格（浊）' : '成格（清）';
                level = breaks.length ? 'mid' : 'good';
                reason = '月令禄刃得' + drains.join('、') + '泄秀制衡，格局有出路' + (breaks.length ? '，但兼见' + breaks.join('、') : '');
            } else {
                status = '破格（待运）';
                level = 'bad';
                reason = '建禄/月刃而财官食伤无透，比劫自成气势，须待岁运引出财官';
            }
        } else if (geju.name === '正官格') {
            if (breaks.indexOf('伤官见官') !== -1) { status = '破格'; level = 'bad'; reason = '伤官见官，格局被破，须以印制伤或财通关'; }
            else if (combos.indexOf('官印相生') !== -1 || combos.indexOf('财官相生') !== -1) { status = '成格（清）'; level = 'good'; reason = '官星有印化或财生，格局流通'; }
            else { status = '成格（浊）'; level = 'mid'; reason = '官星当令而辅佐不足，格局可用而不纯'; }
        } else if (geju.name === '七杀格') {
            if (combos.indexOf('食神制杀') !== -1 || combos.indexOf('杀印相生') !== -1) { status = '成格（清）'; level = 'good'; reason = '七杀有制有化，压力可成权柄'; }
            else if (pct(officer) >= 28 && pct(output) < 8 && pct(resource) < 10) { status = '破格'; level = 'bad'; reason = '杀重无制无化，攻身太过'; }
            else { status = '成格（浊）'; level = 'mid'; reason = '杀星当令而制化不显，须待运助'; }
        } else if (geju.name === '正财格' || geju.name === '偏财格') {
            if (breaks.indexOf('群比争财') !== -1) { status = '破格'; level = 'bad'; reason = '比劫争财，财来财去，须官杀制劫或食伤通关'; }
            else if (combos.indexOf('食神生财') !== -1 || combos.indexOf('伤官生财') !== -1 || combos.indexOf('财官相生') !== -1) { status = '成格（清）'; level = 'good'; reason = '食伤生财或财官相生，财有源有归'; }
            else { status = '成格（浊）'; level = 'mid'; reason = '财星当令而源流不足，宜稳守现金流'; }
        } else if (geju.name === '食神格') {
            if (breaks.indexOf('枭神夺食') !== -1) { status = '破格'; level = 'bad'; reason = '枭神夺食，福气与计划受阻'; }
            else if (combos.indexOf('食神生财') !== -1) { status = '成格（清）'; level = 'good'; reason = '食神生财，秀气有归'; }
            else { status = '成格（浊）'; level = 'mid'; reason = '食神当令而财星不显，才艺待运转化'; }
        } else if (geju.name === '伤官格') {
            if (breaks.indexOf('伤官见官') !== -1) { status = '破格'; level = 'bad'; reason = '伤官见官，须以印制伤或财化伤'; }
            else if (combos.indexOf('伤官生财') !== -1) { status = '成格（清）'; level = 'good'; reason = '伤官生财，才华有出口'; }
            else { status = '成格（浊）'; level = 'mid'; reason = '伤官当令而财星不透，锋芒待运安置'; }
        } else if (geju.name === '正印格' || geju.name === '偏印格') {
            if (pct(wealth) >= 22 && pct(resource) >= 24) { status = '破格'; level = 'bad'; reason = '财星坏印，学业与靠山易受现实利益牵动'; }
            else if (combos.indexOf('官印相生') !== -1 || combos.indexOf('杀印相生') !== -1) { status = '成格（清）'; level = 'good'; reason = '官杀生印，印星有源，名位可成'; }
            else { status = '成格（浊）'; level = 'mid'; reason = '印星当令而官杀不显，宜以学识自立'; }
        } else {
            status = breaks.length ? '成格（浊）' : (combos.length ? '成格（清）' : '成格（待运）');
            level = breaks.length ? 'mid' : (combos.length ? 'good' : 'mid');
            reason = combos.length ? '命局见' + combos.join('、') : '格局清而做功待岁运引发';
        }

        var chainText = chain.map(function (c) {
            return c.from + '(' + c.fromEl + round1(roles.filter(function (r) { return r.key === c.from; })[0].value) + '%)→'
                + c.to + '(' + c.toEl + round1(roles.filter(function (r) { return r.key === c.to; })[0].value) + '%)';
        }).join('；');
        var text = '流通链：' + chainText + '。整体' + quality + '分，' + qualityLabel + '。'
            + (patterns.length ? '做功：' + patterns.map(function (p) { return p.name + '（' + p.type + '）'; }).join('、') + '。' : '')
            + '格局判为' + status + '：' + reason + '。';

        return {
            roles: roles,
            chain: chain,
            quality: quality,
            qualityLabel: qualityLabel,
            patterns: patterns,
            combos: combos,
            breaks: breaks,
            gejuSuccess: { status: status, level: level, reason: reason, combos: combos, breaks: breaks },
            text: text
        };
    }

    function detectDisease(chart, model, strength, geju, tiaohou, flow) {
        var dayWx = chart.dayWx;
        var resource = WX_SHENG_BY[dayWx];
        var output = WX_SHENG[dayWx];
        var wealth = WX_KE[dayWx];
        var officer = WX_KE_BY[dayWx];
        var total = model.total || 1;
        var pct = function (el) { return model.totals[el] / total * 100; };
        var god = {};
        ['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印'].forEach(function (n) { god[n] = 0; });
        activePillars(chart).forEach(function (p) {
            if (p.key !== 'day') god[p.shishen] += p.ganPower;
            p.cang.forEach(function (c) { god[c.tenGod] += c.power; });
        });
        function has(n) { return (god[n] || 0) > 0.25; }
        var list = [];
        function add(name, severity, diseaseEls, medicine, assistant, note, source) {
            list.push({
                name: name,
                severity: Math.round(severity),
                diseaseElements: diseaseEls,
                medicine: medicine,
                assistant: assistant,
                note: note,
                source: source || ''
            });
        }

        if (tiaohou.mode === 'dry-hot') {
            var heatSev = 56 + Math.max(0, tiaohou.dryness - 58) * 0.9 + Math.max(0, tiaohou.warmth - 58) * 0.6;
            add('火炎土燥，煎熬水气', Math.min(96, heatSev), ['火', '土'], '水', '金',
                '火土燥烈而水气受熬' + (pct(wealth) < 14 ? '，财星亦失润泽' : '') + '；以水润局、金生水为药，火土为病。', '调候');
        }

        if (tiaohou.mode === 'cold-wet') {
            var coldSev = 52 + Math.max(0, 42 - tiaohou.warmth) * 0.9;
            add('水冷金寒，阳气不振', Math.min(92, coldSev), ['水', '金'], '火', '木',
                '寒湿凝滞，火气受抑；以火暖局、木生火为药，水金为病。', '调候');
        }
        if (pct(dayWx) >= 32 && pct(wealth) >= 6 && pct(wealth) < 18
            && (has('正财') || has('偏财'))
            && !has('食神') && !has('伤官') && !has('正官') && !has('七杀')) {
            add('群比争财', 48 + (pct(dayWx) - 30) * 1.2, [dayWx], officer, output,
                '比劫成群而财星单薄，且无食伤官杀通关；合伙、借贷与分利易起争端。以官杀制劫为药，食伤通关生财为佐。', '格局');
        }
        if (has('偏印') && has('食神') && pct(resource) >= 24) {
            add('枭神夺食', 44 + (pct(resource) - 24), [resource], wealth, output,
                '偏印压食神，计划、饮食与福气易被打断；以财坏印为药，食伤吐秀为佐。', '十神');
        }
        var luYue = ['建禄格', '阳刃格', '月劫格'].indexOf(geju.name) !== -1;
        var hasByProduct = flow.patterns.some(function (p) { return p.name === '伤官生财' || p.name === '食神生财'; });
        if (!luYue && !hasByProduct && has('伤官') && has('正官') && pct(officer) >= 9 && pct(output) >= 10
            && tiaohou.avoid.indexOf(output) === -1) {
            add('伤官见官', 40 + pct(output) * 0.4, [output], resource, wealth,
                '伤官与正官并见，锋芒冲撞规则；以印制伤为药，财星通关为佐。', '格局');
        }
        if (pct(officer) >= 30 && strength.ratio < 48) {
            add('官杀攻身', 46 + (pct(officer) - 30), [officer], resource, dayWx,
                '官杀成势而日主偏弱，压力先于机会；以印化杀为药，比劫帮身为佐。', '扶抑');
        }
        if (pct(wealth) >= 32 && strength.ratio < 45) {
            add('财多身弱', 44 + (pct(wealth) - 32), [wealth], resource, dayWx,
                '财星过重而日主难任，宜先扶身再谈扩张；以印生身为药，比劫任财为佐。', '扶抑');
        }
        if (pct(output) >= 35 && strength.ratio < 45) {
            add('食伤泄身过重', 42 + (pct(output) - 35), [output], resource, dayWx,
                '食伤过旺泄身，才思外泄而元气不足；以印制食伤为药，比劫帮身为佐。', '扶抑');
        }
        if (pct(resource) >= 38 && strength.rootScore < 0.35) {
            add('印重身轻', 48 + (pct(resource) - 38), [resource], wealth, output,
                '印星成势而日主无根，母旺子相，不宜再助印；以财坏印为药，食伤泄秀为佐。', '扶抑');
        }
        if (strength.ratio >= 62 && pct(officer) < 6 && pct(wealth) < 6 && !geju.special) {
            add('比劫无制、财官不显', 36, [dayWx], output, officer,
                '日主成势而财官不显，气无所归；以食伤泄秀为药，官杀制衡为佐。', '扶抑');
        }

        list.sort(function (a, b) { return b.severity - a.severity; });
        var primary = list[0] || null;
        var text = list.length
            ? list.map(function (d) {
                return d.name + '（' + d.severity + '分）：病在' + d.diseaseElements.join('、')
                    + '，药取' + d.medicine + (d.assistant ? '、' + d.assistant : '') + '；' + d.note;
            }).join(' ')
            : '原局五行流通未见明显病神，以调候与格局顺用为主。';

        return {
            list: list,
            primary: primary,
            text: text,
            hasDisease: !!primary
        };
    }

    /* ---------------------------------------------------------------------
     * 8. 扶抑 + 格局 + 调候 + 通关 联合用神评分
     * ------------------------------------------------------------------- */
    function computeYongShen(chart, model, strength, geju, tiaohou, flow, disease) {
        var dayWx = chart.dayWx;
        var output = WX_SHENG[dayWx];
        var wealth = WX_KE[dayWx];
        var officer = WX_KE_BY[dayWx];
        var resource = WX_SHENG_BY[dayWx];
        var scores = {}, reasons = {};
        WX.forEach(function (el) { scores[el] = 0; reasons[el] = []; });

        function add(el, v, why) {
            if (scores[el] == null) return;
            scores[el] += v;
            if (why) reasons[el].push({ v: round1(v), why: why });
        }
        var total = model.total;
        var pct = function (el) { return total > 0 ? model.totals[el] / total * 100 : 0; };
        var special = geju.special;
        var specialBase = special ? special.replace('假', '') : special;
        var weak = strength.ratio < 45;
        var strong = strength.ratio >= 58;
        var yinHeavy = !special && strength.rootScore < 0.35
            && pct(resource) >= 38 && pct(dayWx) < 12;

        if (specialBase === '从强格' || specialBase === '专旺格') {
            add(dayWx, 35, '特殊格局：一气成势，顺其强势');
            add(resource, 20, '特殊格局：印星顺气');
            add(output, 10, '特殊格局：食伤泄秀为佐');
            add(wealth, -30, '特殊格局：财星逆势破格');
            add(officer, -30, '特殊格局：官杀逆势破格');
        } else if (special === '化气格') {
            var huaEl = geju.huaElement;
            add(huaEl, 35, '化气格：化神为体，喜生助化神');
            add(WX_SHENG_BY[huaEl], 20, '化气格：生化神者为喜');
            add(WX_KE_BY[huaEl], -30, '化气格：克化神者破格');
            add(WX_KE[huaEl], -15, '化气格：化神所克，耗气化神');
        } else if (specialBase === '从财格') {
            add(wealth, 35, '特殊格局：财星成势，顺势取财');
            add(output, 20, '特殊格局：食伤生财');
            add(officer, 10, '特殊格局：官星护财');
            add(dayWx, -25, '特殊格局：比劫破格');
            add(resource, -25, '特殊格局：印星逆势');
        } else if (specialBase === '从杀格') {
            add(officer, 35, '特殊格局：官杀成势，顺势从杀');
            add(wealth, 15, '特殊格局：财星生杀');
            add(output, -25, '特殊格局：食伤制杀逆势');
            add(dayWx, -20, '特殊格局：比劫抗杀');
            add(resource, -15, '特殊格局：印星化杀逆势');
        } else if (specialBase === '从儿格') {
            add(output, 35, '特殊格局：食伤成势，顺势从儿');
            add(wealth, 20, '特殊格局：食伤生财');
            add(resource, -25, '特殊格局：印星夺食');
            add(dayWx, -15, '特殊格局：比劫逆势');
        } else {
            /* 扶抑：先定身强身弱，再叠加格局条件 */
            if (strong) {
                var m = 20 + Math.min(16, (strength.ratio - 58) * 0.8);
                add(output, m * 0.9, '扶抑：身强喜食伤泄秀');
                add(wealth, m, '扶抑：身强喜财星耗身');
                add(officer, m * 0.75, '扶抑：身强喜官杀制身');
                add(resource, -m, '扶抑：身强忌印星再生');
                add(dayWx, -m * 1.05, '扶抑：身强忌比劫帮身');
            } else if (weak) {
                var w = 20 + Math.min(16, (45 - strength.ratio) * 0.8);
                add(resource, w, '扶抑：身弱喜印星生身');
                add(dayWx, w * 0.9, '扶抑：身弱喜比劫帮身');
                add(output, -w * 0.7, '扶抑：身弱忌食伤泄身');
                add(wealth, -w * 0.8, '扶抑：身弱忌财星耗身');
                add(officer, -w, '扶抑：身弱忌官杀克身');
            } else {
                var weakest = WX.slice().sort(function (a, b) { return model.totals[a] - model.totals[b]; })[0];
                add(weakest, 8, '扶抑：中和之局，补偏弱以取流通');
            }

            /* 格局：同一格局在身强/身弱时喜忌相反，不再静态加喜 */
            switch (geju.name) {
                case '建禄格':
                case '阳刃格':
                case '月劫格':
                    add(dayWx, -26, '格局：' + geju.name + '忌比劫再旺');
                    add(resource, -10, '格局：印星生扶过度亦非所宜');
                    add(wealth, 20, '格局：喜财星透出');
                    add(officer, 16, '格局：喜官杀制衡');
                    add(output, 12, '格局：喜食伤泄秀生财');
                    break;
                case '正官格':
                    add(resource, weak ? 18 : 8, weak ? '格局：身弱官重，取印化官护身' : '格局：印能护官');
                    add(officer, weak ? 4 : 20, weak ? '格局：官星有印可承受，略取' : '格局：正官格喜官星');
                    add(wealth, weak ? -6 : 12, weak ? '格局：身弱财生官为忌' : '格局：财能生官');
                    add(output, -15, '格局：伤官见官为忌');
                    add(dayWx, weak ? 6 : -5, weak ? '格局：略喜比劫帮身' : '格局：比劫争官为忌');
                    break;
                case '七杀格':
                    if (weak) {
                        add(resource, 20, '格局：身弱杀重，印星化杀为第一要义');
                        add(dayWx, 8, '格局：比劫帮身抗杀');
                        add(officer, -4, '格局：杀重不宜再助');
                        add(output, -8, '格局：身弱食伤制杀反泄身');
                        add(wealth, -10, '格局：财星生杀为忌');
                    } else {
                        add(output, 16, '格局：食伤制杀');
                        add(resource, 10, '格局：印星化杀');
                        add(wealth, -8, '格局：财星生杀为忌');
                        add(dayWx, -5, '格局：身强杀轻，比劫为忌');
                    }
                    break;
                case '正财格':
                case '偏财格':
                    if (weak) {
                        add(resource, 16, '格局：身弱财重，取印生身');
                        add(dayWx, 10, '格局：比劫帮身任财');
                        add(wealth, -8, '格局：财多身弱，财为负担');
                        add(output, -8, '格局：食伤生财反泄身');
                        add(officer, -6, '格局：财生官克身');
                    } else {
                        add(output, 15, '格局：食伤生财');
                        add(wealth, 10, '格局：财星为用');
                        add(officer, 8, '格局：财官相生');
                        add(dayWx, -10, '格局：比劫夺财为忌');
                        add(resource, -5, '格局：印星碍财');
                    }
                    break;
                case '食神格':
                    if (weak) {
                        add(resource, 16, '格局：身弱食神泄身，取印生身');
                        add(dayWx, 8, '格局：比劫帮身');
                        add(output, -12, '格局：食神泄身为忌');
                        add(wealth, -6, '格局：食神生财反耗身');
                    } else {
                        add(wealth, 15, '格局：食神生财');
                        add(output, 10, '格局：食神为用');
                        add(resource, -12, '格局：枭神夺食为忌');
                        add(officer, -5, '格局：官星碍食');
                    }
                    break;
                case '伤官格':
                    if (weak) {
                        add(resource, 18, '格局：身弱伤官泄身，取印制伤');
                        add(dayWx, 8, '格局：比劫帮身');
                        add(output, -14, '格局：伤官泄身为忌');
                        add(officer, -10, '格局：伤官见官为忌');
                    } else {
                        add(wealth, 15, '格局：伤官生财');
                        add(resource, 8, '格局：印星制伤');
                        add(officer, -12, '格局：伤官见官为忌');
                        add(dayWx, 5, '格局：比劫助伤');
                    }
                    break;
                case '正印格':
                case '偏印格':
                    if (strong) {
                        add(wealth, 16, '格局：印重身强，取财坏印');
                        add(output, 12, '格局：食伤泄秀');
                        add(resource, -14, '格局：印星过重为忌');
                        add(officer, -6, '格局：官杀生印，反助印重');
                    } else {
                        add(officer, 12, '格局：官杀生印');
                        add(resource, 8, '格局：印星为用');
                        add(wealth, -10, '格局：财星坏印为忌');
                        add(output, -5, '格局：食伤泄印');
                    }
                    break;
            }
        }

        /* 通关与病药 */
        var sorted = WX.slice().sort(function (a, b) { return model.totals[b] - model.totals[a]; });
        var top = sorted[0], second = sorted[1];
        if (WX_KE[top] === second && pct(top) > 15 && pct(second) > 15) {
            var mediator = WX_SHENG[top];
            if (tiaohou.avoid.indexOf(mediator) === -1) {
                add(mediator, 12, '通关：' + top + '克' + second + '，取' + mediator + '通关');
            }
        }
        var strongest = sorted[0];
        if (pct(strongest) > 35) {
            var controller = WX_KE_BY[strongest];
            if (pct(controller) < 8 && tiaohou.avoid.indexOf(controller) === -1) {
                add(controller, 12, '病药：' + strongest + '过旺，取' + controller + '制衡');
            }
        }
        if (strong && pct(wealth) > 20 && pct(output) < 8) {
            add(output, 8, '通关：身强财旺，取食伤通关泄秀');
        }
        if (weak && pct(officer) > 25 && pct(resource) < 10) {
            add(resource, 10, '通关：官杀重而印弱，取印化杀');
        }

        /* 调候加权：夏冬权重 ≥ 45%，火燥/水寒时达到 50% */
        var tiaoW = (tiaohou.weight || 0) / 100;
        if (special) tiaoW = Math.min(tiaoW, 0.15);
        var tiaoScores = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
        if (tiaohou.mode === 'dry-hot') {
            tiaoScores = { 木: 0, 火: -100, 土: -75, 金: 70, 水: 100 };
        } else if (tiaohou.mode === 'cold-wet') {
            tiaoScores = { 木: 70, 火: 100, 土: 0, 金: -75, 水: -100 };
        } else {
            tiaohou.elements.forEach(function (el, idx) {
                tiaoScores[el] = idx === 0 ? 100 : (idx === 1 ? 70 : 40);
            });
            (tiaohou.avoid || []).forEach(function (el) { tiaoScores[el] = -70; });
        }
        WX.forEach(function (el) {
            var tv = tiaoScores[el] || 0;
            var contribution = tv * tiaoW;
            scores[el] = scores[el] * (1 - tiaoW) + contribution;
            if (tv !== 0) {
                reasons[el].push({
                    v: round1(contribution),
                    why: '调候加权 ' + Math.round(tiaoW * 100) + '%：' + (tv > 0 ? '助' : '抑') + el
                });
            }
        });

        /* 病药加权：克制病神、疏通流通、调候润局者优先 */
        if (!special && disease && disease.primary) {
            var med = disease.primary.medicine;
            var asst = disease.primary.assistant;
            add(med, 26, '病药：' + disease.primary.name + '，取' + med + '为药神');
            if (asst && asst !== med) add(asst, 12, '病药佐助：' + asst + '生助药神或通关');
            disease.primary.diseaseElements.forEach(function (el) {
                add(el, -20, '病药：' + el + '为病神，宜制不宜助');
            });
        }
        if (flow) {
            if (flow.quality < 40) {
                flow.chain.forEach(function (c) {
                    if (c.state === '断') add(c.toEl, 8, '流通：' + c.from + '→' + c.to + '通道断，补' + c.toEl + '以续气');
                });
            }
            flow.patterns.forEach(function (p) {
                if (p.type === '成') {
                    var el = p.name.indexOf('杀') !== -1 ? officer
                        : (p.name.indexOf('官') !== -1 ? officer
                            : (p.name.indexOf('财') !== -1 ? wealth
                                : (p.name.indexOf('印') !== -1 ? resource : output)));
                    add(el, 6, '做功：' + p.name + '成立，助其气势');
                }
            });
        }

        /* 印重身轻：日主无根而印星成势，母旺子相，不宜再助印生身 */
        if (yinHeavy) {
            scores[resource] = Math.min(scores[resource], -20);
            scores[officer] = Math.min(scores[officer], -10);
            scores[wealth] = Math.max(scores[wealth], 14);
            scores[dayWx] = Math.max(scores[dayWx], 10);
            if (scores[output] > 6) scores[output] = 6;
        }

        /* 建禄/月刃/月劫强制校验：比劫、过旺之印不得为喜 */
        var luYue = !special && ['建禄格', '阳刃格', '月劫格'].indexOf(geju.name) !== -1;
        if (luYue) {
            scores[dayWx] = Math.min(scores[dayWx], -18);
            if (pct(resource) >= 18 || strength.ratio >= 70) {
                scores[resource] = Math.min(scores[resource], -8);
            }
            var drains = [wealth, officer, output];
            var bestDrain = drains.slice().sort(function (a, b) { return scores[b] - scores[a]; })[0];
            if (!drains.some(function (el) { return scores[el] > 5; })) {
                scores[bestDrain] = Math.max(scores[bestDrain], 8);
            }
        }

        /* 身弱/身强的反向校验，避免“身弱却喜财官食”“身强却喜印比” */
        if (!special) {
            if (weak) {
                [officer, wealth, output].forEach(function (el) {
                    var floor = tiaohou.elements.indexOf(el) !== -1 ? 0 : -8;
                    if (scores[el] > floor) scores[el] = Math.min(scores[el], floor);
                });
            } else if (strong) {
                if (scores[dayWx] > -8) scores[dayWx] = Math.min(scores[dayWx], -8);
                var resAllowed = tiaohou.elements.indexOf(resource) !== -1 && pct(resource) < 18;
                if (!resAllowed && scores[resource] > -8) scores[resource] = Math.min(scores[resource], -8);
            }
        }

        WX.forEach(function (el) {
            scores[el] = Math.max(-120, Math.min(120, Math.round(scores[el])));
        });

        var order = WX.slice().sort(function (a, b) { return scores[b] - scores[a]; });
        var primary = order[0];
        var medicineForced = false;
        if (!special && disease && disease.primary && disease.primary.medicine) {
            var medEl = disease.primary.medicine;
            var medAllowed = !luYue || [wealth, officer, output].indexOf(medEl) !== -1;
            if (strength.ratio >= 58 && (medEl === resource || medEl === dayWx)
                && pct(medEl) >= 18 && disease.primary.assistant
                && disease.primary.assistant !== medEl) {
                medEl = disease.primary.assistant;
                medAllowed = !luYue || [wealth, officer, output].indexOf(medEl) !== -1;
            }
            if (medAllowed && scores[medEl] >= 0) {
                primary = medEl;
                medicineForced = true;
            }
        }
        var secondary = '';
        if (disease && disease.primary && disease.primary.assistant
            && disease.primary.assistant !== primary && scores[disease.primary.assistant] > 8) {
            secondary = disease.primary.assistant;
        } else {
            var next = order.filter(function (el) { return el !== primary; })[0];
            if (next && scores[next] > 8) secondary = next;
        }

        /* 特殊格局只顺其气势，不取逆势之神；身强不取印比作次选 */
        var specialAllowed = null;
        if (specialBase === '从强格' || specialBase === '专旺格') specialAllowed = [dayWx, resource, output];
        else if (special === '化气格') specialAllowed = [geju.huaElement, WX_SHENG_BY[geju.huaElement], WX_SHENG[geju.huaElement]];
        else if (specialBase === '从财格') specialAllowed = [wealth, output, officer];
        else if (specialBase === '从杀格') specialAllowed = [officer, wealth];
        else if (specialBase === '从儿格') specialAllowed = [output, wealth];
        if (special && special.indexOf('假') === 0) {
            reasons[primary] = reasons[primary] || [];
            reasons[primary].push({ v: 0, why: '假从格：从之不真，用神随运之去病而定，逢扶起微根之运须防破格' });
        }
        if (specialAllowed) {
            if (specialAllowed.indexOf(primary) === -1) {
                var alt = order.filter(function (el) { return specialAllowed.indexOf(el) !== -1; })[0];
                if (alt) primary = alt;
            }
            if (secondary && specialAllowed.indexOf(secondary) === -1) {
                secondary = order.filter(function (el) {
                    return el !== primary && specialAllowed.indexOf(el) !== -1 && scores[el] > 8;
                })[0] || '';
            }
        } else if (!special && strength.ratio >= 58 && secondary && (secondary === resource || secondary === dayWx)) {
            secondary = order.filter(function (el) {
                return el !== primary && el !== resource && el !== dayWx && scores[el] > 8;
            })[0] || '';
        }
        var favorable = [primary];
        if (secondary) favorable.push(secondary);
        var unfavorable = WX.filter(function (el) { return scores[el] < -5; })
            .sort(function (a, b) { return scores[a] - scores[b]; });
        var idle = WX.filter(function (el) {
            return favorable.indexOf(el) === -1 && unfavorable.indexOf(el) === -1;
        });
        var favText = favorable.join('、');
        var unfavText = unfavorable.length ? unfavorable.join('、') : '无明显忌神';
        var principle = (yinHeavy ? '日主无根而印星成势，属印重身轻，不宜再助印生身；' : '')
            + (disease && disease.primary
                ? '病药：' + disease.primary.name + '，病在' + disease.primary.diseaseElements.join('、')
                    + '，取' + disease.primary.medicine + '为药神' + (disease.primary.assistant ? '、' + disease.primary.assistant + '为佐' : '') + '；'
                : '')
            + '扶抑、格局、调候、通关合参：首选' + primary
            + (medicineForced ? '（病药优先）' : '')
            + (secondary ? '，次选' + secondary : '')
            + (idle.length ? '；闲神' + idle.join('、') : '')
            + '；忌' + unfavText + '。';

        return {
            primary: primary,
            secondary: secondary,
            favorable: favorable,
            unfavorable: unfavorable,
            idle: idle,
            scores: scores,
            reasons: reasons,
            principle: principle,
            favorableText: favText,
            unfavorableText: unfavText,
            special: special,
            yinHeavy: yinHeavy,
            medicineForced: medicineForced,
            flowQuality: flow ? flow.quality : null
        };
    }

    /* ---------------------------------------------------------------------
     * 9. 十神、神煞
     * ------------------------------------------------------------------- */
    function computeTenGods(chart, model) {
        var list = ['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印'];
        var result = {};
        list.forEach(function (name) {
            result[name] = { name: name, count: 0, visible: [], hidden: [], power: 0 };
        });
        activePillars(chart).forEach(function (p) {
            if (p.key !== 'day') {
                var ss = p.shishen;
                if (result[ss]) {
                    result[ss].count += 1;
                    result[ss].visible.push(p.name + '干' + p.gan);
                    result[ss].power += p.ganPower;
                }
            }
            p.cang.forEach(function (c) {
                if (result[c.tenGod]) {
                    result[c.tenGod].count += 1;
                    result[c.tenGod].hidden.push(p.name + '支' + p.zhi + '藏' + c.gan);
                    result[c.tenGod].power += c.power;
                }
            });
        });
        list.forEach(function (name) { result[name].power = round2(result[name].power); });

        var dayWx = chart.dayWx;
        var groups = [
            { name: '比劫', elements: [dayWx], power: model.totals[dayWx], cls: 'g-bijie' },
            { name: '食伤', elements: [WX_SHENG[dayWx]], power: model.totals[WX_SHENG[dayWx]], cls: 'g-shishang' },
            { name: '财星', elements: [WX_KE[dayWx]], power: model.totals[WX_KE[dayWx]], cls: 'g-cai' },
            { name: '官杀', elements: [WX_KE_BY[dayWx]], power: model.totals[WX_KE_BY[dayWx]], cls: 'g-guan' },
            { name: '印星', elements: [WX_SHENG_BY[dayWx]], power: model.totals[WX_SHENG_BY[dayWx]], cls: 'g-yin' }
        ];
        groups.forEach(function (g) {
            g.percent = model.total > 0 ? round1(g.power / model.total * 100) : 0;
            g.power = round2(g.power);
        });
        groups.sort(function (a, b) { return b.power - a.power; });

        return {
            list: list.map(function (name) { return result[name]; }),
            map: result,
            groups: groups,
            summary: '按五行总量统计（比劫含日主本身）：' + groups[0].name + '最旺（' + groups[0].percent + '%），' + groups[groups.length - 1].name + '最弱（' + groups[groups.length - 1].percent + '%）。'
        };
    }

    function computeShenSha(chart) {
        var pillars = activePillars(chart);
        var dayGan = chart.dayGan;
        var yearGan = chart.yearGan;
        var yearZhi = chart.yearZhi;
        var dayZhi = chart.dayZhi;
        var monthZhi = chart.monthZhi;
        var result = { year: [], month: [], day: [], hour: [] };

        function add(name, keys) {
            keys.forEach(function (k) {
                if (result[k] && result[k].indexOf(name) === -1) result[k].push(name);
            });
        }
        function byZhi(zhi) {
            return pillars.filter(function (p) { return p.zhi === zhi; }).map(function (p) { return p.key; });
        }
        function byGan(gan) {
            return pillars.filter(function (p) { return p.gan === gan; }).map(function (p) { return p.key; });
        }

        var tianYi = {
            甲: ['丑', '未'], 戊: ['丑', '未'], 庚: ['丑', '未'],
            乙: ['子', '申'], 己: ['子', '申'],
            丙: ['亥', '酉'], 丁: ['亥', '酉'],
            壬: ['卯', '巳'], 癸: ['卯', '巳'], 辛: ['午', '寅']
        };
        uniq([dayGan, yearGan]).forEach(function (base) {
            (tianYi[base] || []).forEach(function (zhi) { add('天乙贵人', byZhi(zhi)); });
        });

        var wenChang = { 甲: '巳', 乙: '午', 丙: '申', 戊: '申', 丁: '酉', 己: '酉', 庚: '亥', 辛: '子', 壬: '寅', 癸: '卯' };
        add('文昌贵人', byZhi(wenChang[dayGan]));

        var taiJi = {
            甲: ['子', '午'], 乙: ['子', '午'], 丙: ['卯', '酉'], 丁: ['卯', '酉'],
            戊: ['辰', '戌', '丑', '未'], 己: ['辰', '戌', '丑', '未'],
            庚: ['寅', '亥'], 辛: ['寅', '亥'], 壬: ['巳', '申'], 癸: ['巳', '申']
        };
        (taiJi[dayGan] || []).forEach(function (zhi) { add('太极贵人', byZhi(zhi)); });

        add('禄神', byZhi(LU[dayGan]));
        add('羊刃', byZhi(bladeZhi(dayGan)));

        var jinYu = { 甲: '辰', 乙: '巳', 丙: '未', 丁: '申', 戊: '未', 己: '申', 庚: '戌', 辛: '亥', 壬: '丑', 癸: '寅' };
        add('金舆', byZhi(jinYu[dayGan]));

        var hongLuan = { 子: '卯', 丑: '寅', 寅: '丑', 卯: '子', 辰: '亥', 巳: '戌', 午: '酉', 未: '申', 申: '未', 酉: '午', 戌: '巳', 亥: '辰' };
        var hl = hongLuan[yearZhi];
        add('红鸾', byZhi(hl));
        add('天喜', byZhi(ZHI[(ZHI.indexOf(hl) + 6) % 12]));

        var guChen = { 亥: '寅', 子: '寅', 丑: '寅', 寅: '巳', 卯: '巳', 辰: '巳', 巳: '申', 午: '申', 未: '申', 申: '亥', 酉: '亥', 戌: '亥' };
        var guaSu = { 亥: '戌', 子: '戌', 丑: '戌', 寅: '丑', 卯: '丑', 辰: '丑', 巳: '辰', 午: '辰', 未: '辰', 申: '未', 酉: '未', 戌: '未' };
        add('孤辰', byZhi(guChen[yearZhi]));
        add('寡宿', byZhi(guaSu[yearZhi]));

        add('天医', byZhi(ZHI[(ZHI.indexOf(monthZhi) - 1 + 12) % 12]));

        var monthDe = { 寅: '丙', 午: '丙', 戌: '丙', 申: '壬', 子: '壬', 辰: '壬', 亥: '甲', 卯: '甲', 未: '甲', 巳: '庚', 酉: '庚', 丑: '庚' };
        add('月德贵人', byGan(monthDe[monthZhi]));

        var tianDe = { 寅: '丁', 卯: '申', 辰: '壬', 巳: '辛', 午: '亥', 未: '甲', 申: '癸', 酉: '寅', 戌: '丙', 亥: '乙', 子: '巳', 丑: '庚' };
        var td = tianDe[monthZhi];
        if (GAN.indexOf(td) !== -1) add('天德贵人', byGan(td));
        else add('天德贵人', byZhi(td));

        uniq([yearZhi, dayZhi]).forEach(function (base) {
            var group = branchGroup(base);
            if (group) {
                Object.keys(SHENSHA_BRANCH[group]).forEach(function (name) {
                    add(name, byZhi(SHENSHA_BRANCH[group][name]));
                });
            }
        });

        if (['庚辰', '庚戌', '壬辰', '戊戌'].indexOf(pillars[2].ganzhi) !== -1) add('魁罡', ['day']);
        if (['甲辰', '乙巳', '丙申', '丁亥', '戊戌', '己丑', '庚辰', '辛巳', '壬申', '癸亥'].indexOf(pillars[2].ganzhi) !== -1) add('十恶大败', ['day']);
        if (['丙子', '丁丑', '戊寅', '辛卯', '壬辰', '癸巳', '丙午', '丁未', '戊申', '辛酉', '壬戌', '癸亥'].indexOf(pillars[2].ganzhi) !== -1) add('阴阳差错', ['day']);

        /* 流霞（日干查）：甲鸡乙犬丙羊丁猴戊蛇己马庚龙辛兔壬猪癸虎 */
        var liuXia = { 甲: '酉', 乙: '戌', 丙: '未', 丁: '申', 戊: '巳', 己: '午', 庚: '辰', 辛: '卯', 壬: '亥', 癸: '寅' };
        add('流霞', byZhi(liuXia[dayGan]));
        /* 孤鸾煞（日柱）：乙巳丁巳辛亥戊申甲寅戊午壬子丙午 */
        if (['乙巳', '丁巳', '辛亥', '戊申', '甲寅', '戊午', '壬子', '丙午'].indexOf(pillars[2].ganzhi) !== -1) add('孤鸾', ['day']);
        /* 八专（日柱干支同气）：甲寅乙卯丁未己未庚申辛酉戊戌癸丑 */
        if (['甲寅', '乙卯', '丁未', '己未', '庚申', '辛酉', '戊戌', '癸丑'].indexOf(pillars[2].ganzhi) !== -1) add('八专', ['day']);
        /* 天罗地网：火命见戌亥全为天罗，水土命见辰巳全为地网（以年柱纳音论） */
        var yearNayinWx = pillars[0].nayin.charAt(pillars[0].nayin.length - 1);
        var allZhis = pillars.map(function (p) { return p.zhi; });
        if (yearNayinWx === '火' && allZhis.indexOf('戌') !== -1 && allZhis.indexOf('亥') !== -1) {
            add('天罗', pillars.filter(function (p) { return p.zhi === '戌' || p.zhi === '亥'; }).map(function (p) { return p.key; }));
        }
        if ((yearNayinWx === '水' || yearNayinWx === '土') && allZhis.indexOf('辰') !== -1 && allZhis.indexOf('巳') !== -1) {
            add('地网', pillars.filter(function (p) { return p.zhi === '辰' || p.zhi === '巳'; }).map(function (p) { return p.key; }));
        }

        var present = uniq([].concat(result.year, result.month, result.day, result.hour));
        var dict = {};
        present.forEach(function (name) {
            if (SHENSHA_DESC[name]) {
                dict[name] = {
                    nature: SHENSHA_DESC[name][0],
                    text: SHENSHA_DESC[name][1],
                    tier: SHENSHA_TIER[name] || '中性'
                };
            }
        });
        return { byPillar: result, dict: dict, kongWang: chart.kongWang };
    }

    /* ---------------------------------------------------------------------
     * 9.5 星宫同参与四墓库
     * ------------------------------------------------------------------- */
    var SPOUSE_TRAIT = {
        正财: '务实、重家庭财务、能经营',
        偏财: '外向、善交际、有生意头脑',
        正官: '守礼、有责任感、重名分',
        七杀: '强势、果断、行动力强',
        正印: '包容、重精神、像长辈般照顾',
        偏印: '独立、思辨强、需要空间',
        食神: '温和、重生活品质、有才艺',
        伤官: '聪明、表达强、个性鲜明',
        比肩: '与己同类、平等相处但易争',
        劫财: '主见强、财务上易有分歧'
    };

    function computePalaces(chart, model, yongshen) {
        var domain = {
            year: '祖上根基与少年环境',
            month: '父母兄弟与事业起点',
            day: '自身、配偶与中年',
            hour: '子女与晚年'
        };
        var list = chart.pillars.map(function (p) {
            if (p.unknown) {
                return { key: p.key, name: p.name, ganzhi: p.ganzhi, domain: domain[p.key], star: '未知', zhiStar: '未知', element: null, state: 'idle', stateText: '从略', relations: [], reading: p.name + '为' + domain[p.key] + '；时辰未知，本宫从略。' };
            }
            var mainCang = p.cang[0];
            var star = p.key === 'day' ? mainCang.tenGod : p.shishen;
            var el = p.key === 'day' ? mainCang.wx : p.ganWx;
            var score = yongshen.scores[el] || 0;
            var state = score > 5 ? 'fav' : (score < -5 ? 'bad' : 'idle');
            var stateText = state === 'fav' ? '喜用' : (state === 'bad' ? '忌神' : '闲神');
            var rels = model.relations.filter(function (r) { return r.keys.indexOf(p.key) !== -1; });
            var relSeen = {}, relTexts = [];
            rels.forEach(function (r) {
                var key = r.type + '|' + r.pair;
                if (relSeen[key]) return;
                relSeen[key] = true;
                relTexts.push(r.type + ' ' + r.pair + '（' + (r.effect || r.note) + '）');
            });
            var reading = p.name + '为' + domain[p.key] + '；天干' + p.shishen + '、地支本气' + mainCang.tenGod
                + '，' + el + '为' + stateText + '。';
            return {
                key: p.key,
                name: p.name,
                ganzhi: p.ganzhi,
                domain: domain[p.key],
                star: star,
                zhiStar: mainCang.tenGod,
                element: el,
                state: state,
                stateText: stateText,
                relations: relTexts,
                reading: reading
            };
        });

        var day = chart.pillars.filter(function (p) { return p.key === 'day'; })[0];
        var dayPalace = list.filter(function (p) { return p.key === 'day'; })[0];
        var spouseGod = day.cang[0].tenGod;
        var dayRels = model.relations.filter(function (r) { return r.keys.indexOf('day') !== -1; });
        var anhe = dayRels.filter(function (r) { return r.type === '地支暗合'; });
        var chong = dayRels.filter(function (r) { return r.type === '地支六冲'; });
        var he = dayRels.filter(function (r) { return r.type === '地支六合' || r.type === '三合局' || r.type === '半合局'; });
        var xing = dayRels.filter(function (r) { return r.type === '自刑' || r.type === '地支相刑' || r.type === '三刑'; });

        var spouseText = '日支' + day.zhi + '藏' + day.cang.map(function (c) { return c.gan + '（' + c.tenGod + '）'; }).join('、')
            + '，' + spouseGod + '坐夫妻宫，主配偶' + (SPOUSE_TRAIT[spouseGod] || '性情有自身特点') + '。';
        spouseText += dayPalace.state === 'fav'
            ? '该支五行属' + dayPalace.element + '、为命局喜用，配偶能助我、婚姻可得实际支持。'
            : (dayPalace.state === 'bad'
                ? '该支五行属' + dayPalace.element + '、为命局忌神，配偶或婚姻带来的压力大于助力，需分清关心与干预。'
                : '该支五行属' + dayPalace.element + '、为闲神，婚姻以平顺为主，重在经营。');
        if (anhe.length) {
            spouseText += '夫妻宫暗合' + anhe.length + '见（' + anhe.map(function (r) { return r.pair; }).join('、') + '），'
                + (anhe[0].effect || '感情有隐性牵引') + '；'
                + (dayPalace.state === 'fav' ? '配偶能力可借，但易被长辈、工作或家庭事务分薄，需防“关心变干预”。' : '感情牵连较多，需防隐性消耗。');
        }
        if (chong.length) spouseText += '夫妻宫受冲，聚少离多或关系易有阶段变动。';
        if (he.length) spouseText += '夫妻宫逢合，婚缘人缘皆有牵引。';
        if (xing.length) spouseText += '夫妻宫带刑，易有内耗，沟通宜留余地。';
        dayPalace.spouseText = spouseText;
        dayPalace.reading += spouseText;

        var starPalaceText = list.map(function (p) {
            return p.name + ' ' + p.ganzhi + '（' + p.star + '·' + p.zhiStar + '，' + p.stateText + '）';
        }).join('；') + '。' + spouseText;

        return {
            list: list,
            day: dayPalace,
            spouseText: spouseText,
            starPalaceText: starPalaceText
        };
    }

    var ELEMENT_STEM = { 木: '甲', 火: '丙', 土: '戊', 金: '庚', 水: '壬' };
    var TOMB_CLASH = { 辰: '戌', 戌: '辰', 丑: '未', 未: '丑' };
    var TOMB_HE = { 辰: '酉', 酉: '辰', 戌: '卯', 卯: '戌', 丑: '子', 子: '丑', 未: '午', 午: '未' };

    function computeTombs(chart, model, yongshen) {
        var list = [];
        chart.pillars.forEach(function (p) {
            if (!TOMB_ELEMENT[p.zhi]) return;
            var el = TOMB_ELEMENT[p.zhi];
            var stem = ELEMENT_STEM[el];
            var god = tenGod(chart.dayGan, stem);
            var type = (god === '正财' || god === '偏财') ? '财库'
                : ((god === '正官' || god === '七杀') ? '官杀库'
                    : ((god === '正印' || god === '偏印') ? '印库'
                        : ((god === '食神' || god === '伤官') ? '食伤库' : '比劫库')));
            var clashZhi = TOMB_CLASH[p.zhi];
            var heZhi = TOMB_HE[p.zhi];
            var natalClash = chart.pillars.some(function (q) { return q.zhi === clashZhi; });
            var natalHe = chart.pillars.some(function (q) { return q.zhi === heZhi; });
            var stateText = natalClash ? '原局逢' + clashZhi + '冲，库门已开'
                : (natalHe ? '原局逢' + heZhi + '合，库气被牵动' : '原局无冲无合，库门紧闭');
            var score = yongshen.scores[el] || 0;
            var valueText = score > 5 ? '库中' + el + '为喜用，开库得力'
                : (score < -5 ? '库中' + el + '为忌神，开库反成负担' : '库中' + el + '为闲神，开库影响中性');
            list.push({
                key: p.key,
                pillarName: p.name,
                zhi: p.zhi,
                element: el,
                type: type,
                god: god,
                stateText: stateText,
                natalClash: natalClash,
                natalHe: natalHe,
                valueText: valueText,
                openYears: [],
                luckWindows: [],
                note: p.name + p.zhi + '为' + el + '库，藏' + stem + '（' + god + '），属' + type + '；' + stateText + '；' + valueText + '。'
            });
        });
        var text = list.length
            ? list.map(function (t) { return t.note; }).join(' ')
            : '原局无辰戌丑未四库，不论开库。';
        return { list: list, text: text };
    }

    function annotateTombs(tombs, dayun, liunian) {
        if (!tombs) return;
        var liuChong = function (a, b) { return TOMB_CLASH[a] === b; };
        tombs.list.forEach(function (t) {
            liunian.forEach(function (n) {
                if (liuChong(t.zhi, n.zhi)) {
                    t.openYears.push({
                        year: n.year, ganzhi: n.ganzhi,
                        text: n.year + '年' + n.ganzhi + '冲' + t.zhi + '，' + t.type + '开库'
                    });
                } else if (TOMB_HE[t.zhi] === n.zhi) {
                    t.openYears.push({
                        year: n.year, ganzhi: n.ganzhi,
                        text: n.year + '年' + n.ganzhi + '合' + t.zhi + '，' + t.type + '库气被引动'
                    });
                }
            });
            dayun.list.forEach(function (d) {
                if (liuChong(t.zhi, d.zhi)) {
                    t.luckWindows.push(d.ganzhi + '大运（' + d.yearStart + '–' + d.yearEnd + '）冲' + t.zhi + '，' + t.type + '开库');
                } else if (TOMB_HE[t.zhi] === d.zhi) {
                    t.luckWindows.push(d.ganzhi + '大运（' + d.yearStart + '–' + d.yearEnd + '）合' + t.zhi + '，' + t.type + '库气被引动');
                }
            });
            if (t.openYears.length) t.note += ' 近运开库：' + t.openYears.map(function (x) { return x.ganzhi + '年'; }).join('、') + '。';
            if (t.luckWindows.length) t.note += ' 大运：' + t.luckWindows[0] + '。';
        });
        tombs.text = tombs.list.length
            ? tombs.list.map(function (t) { return t.note; }).join(' ')
            : "原局无辰戌丑未四库，不论开库。";
    }

    /* ---------------------------------------------------------------------
     * 10. 大运、流年、流月动态评分
     * ------------------------------------------------------------------- */
    function elementPreference(el, yongshen) {
        var s = yongshen.scores[el] || 0;
        if (yongshen.favorable.indexOf(el) !== -1) {
            return Math.max(0.6, Math.min(2.5, 0.6 + s / 60));
        }
        if (yongshen.unfavorable.indexOf(el) !== -1) {
            return Math.min(-0.6, Math.max(-2.5, -0.6 + s / 60));
        }
        return Math.max(-0.35, Math.min(0.35, s / 100));
    }

    function luckShenSha(chart, zhi) {
        var tags = [];
        var tianYi = {
            甲: ['丑', '未'], 戊: ['丑', '未'], 庚: ['丑', '未'],
            乙: ['子', '申'], 己: ['子', '申'],
            丙: ['亥', '酉'], 丁: ['亥', '酉'],
            壬: ['卯', '巳'], 癸: ['卯', '巳'], 辛: ['午', '寅']
        };
        (tianYi[chart.dayGan] || []).forEach(function (z) { if (z === zhi) tags.push('天乙贵人'); });
        var wenChang = { 甲: '巳', 乙: '午', 丙: '申', 戊: '申', 丁: '酉', 己: '酉', 庚: '亥', 辛: '子', 壬: '寅', 癸: '卯' };
        if (wenChang[chart.dayGan] === zhi) tags.push('文昌贵人');
        var group = branchGroup(chart.dayZhi);
        if (group) {
            var map = SHENSHA_BRANCH[group];
            ['桃花', '驿马', '华盖', '将星'].forEach(function (name) {
                if (map[name] === zhi) tags.push(name);
            });
        }
        if (LU[chart.dayGan] === zhi) tags.push('禄神');
        if (bladeZhi(chart.dayGan) === zhi) tags.push('羊刃');
        return uniq(tags);
    }

    function natalGods(chart) {
        var set = {};
        activePillars(chart).forEach(function (p) {
            if (p.key !== 'day') set[p.shishen] = true;
            p.cang.forEach(function (c) { set[c.tenGod] = true; });
        });
        return set;
    }

    function scoreLuck(chart, model, yongshen, strength, gan, zhi, opts) {
        opts = opts || {};
        var label = opts.label || '岁运';
        var ganWx = GAN_WX[gan], zhiWx = ZHI_WX[zhi];
        var prefGan = elementPreference(ganWx, yongshen);
        var prefZhi = elementPreference(zhiWx, yongshen);
        var ganWeight = label === '大运' ? 0.35 : 0.40;
        var score = (prefGan * ganWeight + prefZhi * (1 - ganWeight)) * P.luckAmplitude;
        var notes = [];

        if (prefGan >= 1) notes.push(label + '天干' + gan + '（' + ganWx + '）为喜用');
        else if (prefGan <= -1) notes.push(label + '天干' + gan + '（' + ganWx + '）为忌神');
        if (prefZhi >= 1) notes.push(label + '地支' + zhi + '（' + zhiWx + '）为喜用');
        else if (prefZhi <= -1) notes.push(label + '地支' + zhi + '（' + zhiWx + '）为忌神');

        var ss = tenGod(chart.dayGan, gan);
        if (yongshen.unfavorable.indexOf(ganWx) !== -1) {
            score -= (ss === '七杀' || ss === '伤官' || ss === '劫财' || ss === '偏印') ? 4 : 2;
        } else if (yongshen.favorable.indexOf(ganWx) !== -1) {
            score += (ss === '正官' || ss === '正印' || ss === '正财' || ss === '食神') ? 4 : 2;
        }

        var virtualPillar = makePillar('luck', gan, zhi, chart.dayGan);
        virtualPillar.name = label;
        var all = activePillars(chart).concat([virtualPillar]);
        var dyGz = opts.dayunGanzhi || '';
        var dyPillar = null;
        if (dyGz && dyGz.length >= 2 && dyGz !== gan + zhi) {
            dyPillar = makePillar('dayun', dyGz.charAt(0), dyGz.charAt(1), chart.dayGan);
            dyPillar.name = '大运';
            all.push(dyPillar);
        }
        var relations = detectRelations(all).filter(function (r) {
            return r.keys.indexOf('luck') !== -1;
        });
        var gods = natalGods(chart);
        var sameNatal = activePillars(chart).filter(function (p) { return p.zhi === zhi; }).length;
        if (SELF_XING.indexOf(zhi) !== -1 && sameNatal >= 1) {
            var totalSame = sameNatal + 1;
            var fireBad = zhi === '午' && yongshen.unfavorable.indexOf('火') !== -1;
            score -= fireBad ? (totalSame >= 3 ? 16 : 10) : (totalSame >= 3 ? 12 : 7);
            notes.push(label + '与原局' + (totalSame >= 3 ? '两' : '一') + zhi + '构成'
                + (totalSame >= 3 ? '三' : '两') + zhi + '自刑，'
                + (fireBad ? '火炎土燥为忌，需防精神内耗与盲目投资' : '同气内耗，宜稳守节奏'));
        }

        relations.forEach(function (r) {
            var isDay = r.keys.indexOf('day') !== -1;
            var isMonth = r.keys.indexOf('month') !== -1;
            var isYear = r.keys.indexOf('year') !== -1;
            var isHour = r.keys.indexOf('hour') !== -1;
            var hasYun = r.keys.indexOf('dayun') !== -1;
            var hasLuck = r.keys.indexOf('luck') !== -1;
            var relLabel = hasYun && hasLuck ? '岁运' : (hasYun ? '大运' : label);
            var pos = isDay ? '日支（夫妻宫）' : (isMonth ? '月支（事业宫）' : (isYear ? '年支（祖辈宫）' : '时支（子女宫）'));
            if (r.type === '地支六冲') {
                score -= isDay ? 16 : (isMonth ? 12 : (isYear ? 8 : 10));
                notes.push(isDay
                    ? relLabel + r.pair + '冲夫妻宫（日支），婚恋、居所或合作易有变动，宜预留缓冲'
                    : relLabel + r.pair + '冲' + pos + '，主变动、关系或环境调整');
            } else if (r.type === '地支六合') {
                var good = elementPreference(r.targetElement, yongshen) >= 0;
                score += good ? 7 : -4;
                notes.push(relLabel + r.pair + '合' + pos + '，' + (r.transformed === false ? '合而不化，' : '') + (good ? '利合作与人缘' : '合中带耗，需防牵连'));
            } else if (r.type === '三合局' || r.type === '三会局' || r.type === '半合局') {
                var gp = elementPreference(r.targetElement, yongshen);
                score += gp * 9;
                notes.push(relLabel + r.pair + (r.transformed === false ? '合而不化' : '成') + r.targetElement + '局，' + (gp > 0 ? '助起喜用' : '助起忌神'));
            } else if (r.type === '拱合局') {
                var ga = elementPreference(r.targetElement, yongshen);
                score += ga * 5;
                notes.push(relLabel + r.pair + '拱' + r.archZhi + '，虚拱' + r.targetElement + '气，' + (ga > 0 ? '暗助喜用' : '暗助忌神'));
            } else if (r.type === '三刑') {
                score -= 10;
                notes.push(relLabel + r.pair + '三刑，注意压力、是非与健康');
            } else if (r.type === '自刑') {
                /* 已在岁运与原局同支计数中统一处理，避免重复扣分 */
            } else if (r.type === '地支六害') {
                score -= 5;
                notes.push(relLabel + r.pair + '相害，防暗耗与误会');
            } else if (r.type === '地支暗合') {
                score -= 4;
                notes.push(relLabel + r.pair + '暗合，暗中牵引，需防隐性消耗');
            } else if (r.type === '天干五合') {
                var gh = elementPreference(r.targetElement, yongshen) >= 0;
                score += gh ? 4 : -3;
                notes.push(relLabel + r.pair + '天干相合，' + (r.transformed === false ? '合而不化，' : '') + (gh ? '利合作' : '合化助忌'));
            } else if (r.type === '天干相冲') {
                score -= 5;
                notes.push(relLabel + r.pair + '天干相冲，易有口舌与反复');
            } else if (r.type === '地支相刑') {
                score -= 5;
                notes.push(relLabel + r.pair + '相刑，注意摩擦与内耗');
            }
        });

        /* 天克地冲（反吟）与伏吟：岁运与原局某柱同柱重叠或对冲 */
        activePillars(chart).forEach(function (p) {
            var ganChong = GAN_CHONG.some(function (h) {
                return (h[0] === gan && h[1] === p.gan) || (h[1] === gan && h[0] === p.gan);
            });
            var zhiChong = LIU_CHONG.some(function (h) {
                return (h[0] === zhi && h[1] === p.zhi) || (h[1] === zhi && h[0] === p.zhi);
            });
            if (ganChong && zhiChong) {
                score -= 14;
                notes.push(label + '与' + p.name + '天克地冲（反吟），变动较大，宜守不宜攻');
            }
            if (p.gan === gan && p.zhi === zhi) {
                if (p.key === 'day') {
                    score -= 6;
                    notes.push(label + '与日柱伏吟（' + gan + zhi + '），夫妻宫与自身重叠，主反复、内耗与旧事重提');
                } else {
                    var fuPref = elementPreference(p.ganWx, yongshen) + elementPreference(p.zhiWx, yongshen);
                    score += fuPref >= 0 ? 2 : -4;
                    notes.push(label + '与' + p.name + '伏吟（' + gan + zhi + '），' + (fuPref >= 0 ? '喜用叠加，旧业可续' : '忌神叠加，防原地打转'));
                }
            }
        });
        if (label === '大运' && LIU_CHONG.some(function (h) {
            return (h[0] === zhi && h[1] === chart.monthZhi) || (h[1] === zhi && h[0] === chart.monthZhi);
        })) {
            notes.push('大运' + zhi + '冲提纲（月令' + chart.monthZhi + '），十年环境多变动，宜主动应变、忌刻舟求剑');
        }

        /* 岁运并临、岁运天克地冲与合处逢冲 */
        if (dyPillar) {
            if (dyGz === gan + zhi) {
                var samePref = elementPreference(dyPillar.ganWx, yongshen) + elementPreference(dyPillar.zhiWx, yongshen);
                score += samePref >= 0 ? 4 : -8;
                notes.push('岁运并临：' + label + '与当前大运同为' + dyGz + '，喜忌气势叠加，'
                    + (samePref >= 0 ? '可顺势推进，但防过犹不及' : '忌神集中，宜守成减仓'));
            } else {
                var dyGanChong = GAN_CHONG.some(function (h) {
                    return (h[0] === gan && h[1] === dyPillar.gan) || (h[1] === gan && h[0] === dyPillar.gan);
                });
                var dyZhiChong = LIU_CHONG.some(function (h) {
                    return (h[0] === zhi && h[1] === dyPillar.zhi) || (h[1] === zhi && h[0] === dyPillar.zhi);
                });
                if (dyGanChong && dyZhiChong) {
                    score -= 16;
                    notes.push('岁运' + gan + zhi + '与大运' + dyGz + '天克地冲，环境与节奏同时受冲击，忌大额扩张与硬碰硬');
                }
            }
        }
        activePillars(chart).forEach(function (p) {
            LIU_HE.forEach(function (h) {
                if (p.zhi !== h[0] && p.zhi !== h[1]) return;
                var other = p.zhi === h[0] ? h[1] : h[0];
                if (activePillars(chart).some(function (q) { return q.zhi === other; })) {
                    if (LIU_CHONG.some(function (c) { return (c[0] === zhi && c[1] === p.zhi) || (c[1] === zhi && c[0] === p.zhi); })) {
                        score -= 6;
                        notes.push('合处逢冲：原局' + h[0] + h[1] + '六合，' + label + zhi + '冲' + p.zhi + '，合局被冲开，合作或承诺易生反复');
                    }
                }
            });
        });

        /* 四墓库开闭 */
        if (chart.tombs && chart.tombs.list) {
            chart.tombs.list.forEach(function (t) {
                if (TOMB_CLASH[t.zhi] === zhi) {
                    var tombGood = elementPreference(t.element, yongshen) >= 0;
                    score += tombGood ? 7 : -6;
                    notes.push(label + zhi + '冲' + t.pillarName + t.zhi + '（' + t.element + '库/' + t.type + '），开库（' + t.god + '），'
                        + (tombGood ? '库中所藏为喜用，利资源变现与旧事重启' : '库中所藏为忌，开库易有破耗与旧账翻出'));
                } else if (TOMB_HE[t.zhi] === zhi) {
                    score += 2;
                    notes.push(label + zhi + '合' + t.pillarName + t.zhi + '，' + t.type + '库气被引动，宜循序渐进');
                }
            });
        }
        if (changSheng(chart.dayGan, zhi) === '墓' && sameNatal === 0) {
            score -= 3;
            notes.push(label + zhi + '为日主墓库之地，气机收敛，宜守成、忌冒进');
        }

        /* 食伤生财得禄、日主得禄 */
        var outGod = tenGod(chart.dayGan, gan);
        var wealthEl = WX_KE[chart.dayWx];
        var wealthInZhi = ZHI_WX[zhi] === wealthEl
            || CANG[zhi].some(function (c) { return GAN_WX[c[0]] === wealthEl; });
        if ((outGod === '伤官' || outGod === '食神') && wealthInZhi
            && yongshen.favorable.indexOf(wealthEl) !== -1) {
            score += 8;
            notes.push(label + '食伤生财，财气得禄，利专业变现、作品转化与经营扩张');
        }
        if (LU[chart.dayGan] === zhi) {
            var luGood = elementPreference(GAN_WX[chart.dayGan], yongshen) >= 0;
            score += luGood ? 5 : -2;
            notes.push(label + '日主临禄（' + zhi + '），' + (luGood ? '自立得助，利主动出击' : '比劫得势，防分财与过度自信'));
        }

        var yearShiShen = tenGod(chart.dayGan, gan);
        var flowGods = {};
        flowGods[yearShiShen] = true;
        CANG[zhi].forEach(function (c) { flowGods[tenGod(chart.dayGan, c[0])] = true; });
        function hasGod(name) { return !!(gods[name] || flowGods[name]); }

        if (yearShiShen === '伤官' && hasGod('正官')) {
            score -= 12;
            notes.push('伤官见官，防口舌、规则冲突与职业变动');
        }
        if (yearShiShen === '正官' && hasGod('伤官')) {
            score -= 10;
            notes.push('官星引动原局伤官，防是非与压力');
        }
        if (yearShiShen === '偏印' && hasGod('食神')) {
            score -= 10;
            notes.push('枭神夺食，注意饮食、情绪与计划受阻');
        }
        if (yearShiShen === '食神' && hasGod('七杀')) {
            score += 6;
            notes.push('食神制杀，利以专业能力化解压力');
        }

        score = Math.max(-100, Math.min(100, score));
        var level, levelKey, stars;
        if (score >= 35) { level = '大吉'; levelKey = 'good'; stars = 5; }
        else if (score >= 15) { level = '吉'; levelKey = 'good'; stars = 4; }
        else if (score > -15) { level = '平'; levelKey = 'mid'; stars = 3; }
        else if (score > -35) { level = '小凶'; levelKey = 'bad'; stars = 2; }
        else { level = '凶'; levelKey = 'bad'; stars = 1; }

        if (!notes.length) notes.push(label + '五行与原局无明显引动，以平稳论');

        return {
            score: round1(score),
            level: level,
            levelKey: levelKey,
            stars: stars,
            notes: uniq(notes)
        };
    }

    function computeDaYun(chart, model, yongshen, strength) {
        var yearYang = GAN_YANG[chart.yearGan];
        var male = chart.gender === 'male';
        var forward = (yearYang && male) || (!yearYang && !male);

        var target = null;
        if (forward) {
            for (var i = 0; i < chart.allJie.length; i++) {
                if (chart.allJie[i].ts > chart.ts) { target = chart.allJie[i]; break; }
            }
        } else {
            for (var j = 0; j < chart.allJie.length; j++) {
                if (chart.allJie[j].ts <= chart.ts) target = chart.allJie[j];
                else break;
            }
        }
        var days = Math.abs(target.ts - chart.ts) / 86400000;
        var totalMonths = days * 4;
        var startYears = Math.floor(totalMonths / 12);
        var startMonths = Math.floor(totalMonths % 12);
        var startDays = Math.round((totalMonths % 1) * 30);
        var startTs = addCalendar(chart.ts, startYears, startMonths, startDays);
        var monthGanIdx = GAN.indexOf(chart.monthGan);
        var monthZhiIdx = ZHI.indexOf(chart.monthZhi);
        var now = Date.now();
        var list = [];

        for (var k = 0; k < 10; k++) {
            var offset = forward ? (k + 1) : -(k + 1);
            var gan = GAN[mod(monthGanIdx + offset, 10)];
            var zhi = ZHI[mod(monthZhiIdx + offset, 12)];
            var yunStart = addCalendar(startTs, k * 10, 0, 0);
            var yunEnd = addCalendar(startTs, (k + 1) * 10, 0, 0);
            var luck = scoreLuck(chart, model, yongshen, strength, gan, zhi, {
                label: '大运',
                dayunGanzhi: gan + zhi
            });
            var yunGz = gan + zhi;
            list.push({
                index: k + 1,
                ganzhi: yunGz,
                gan: gan,
                zhi: zhi,
                ganWx: GAN_WX[gan],
                zhiWx: ZHI_WX[zhi],
                ageStart: startYears + k * 10,
                ageEnd: startYears + k * 10 + 9,
                yearStart: bjDate(yunStart).getUTCFullYear(),
                yearEnd: bjDate(yunEnd).getUTCFullYear() - 1,
                dateStart: fmtDate(yunStart),
                dateEnd: fmtDate(yunEnd),
                shishen: tenGod(chart.dayGan, gan),
                zhiShishen: tenGod(chart.dayGan, CANG[zhi][0][0]),
                xingYun: changSheng(chart.dayGan, zhi),
                nayin: NAYIN[Math.floor(sixtyIndex(gan, zhi) / 2)],
                shensha: luckShenSha(chart, zhi),
                score: luck.score,
                level: luck.level,
                levelKey: luck.levelKey,
                stars: luck.stars,
                notes: luck.notes,
                isCurrent: now >= yunStart && now < yunEnd
            });
        }

        return {
            direction: forward ? '顺排' : '逆排',
            directionReason: (yearYang ? '阳年' : '阴年') + (male ? '男命' : '女命') + '，' + (forward ? '顺排' : '逆排'),
            startYears: startYears,
            startMonths: startMonths,
            startDays: startDays,
            startText: startYears + '岁' + startMonths + '个月',
            startDate: fmtDate(startTs),
            list: list,
            currentIndex: (function () {
                for (var i2 = 0; i2 < list.length; i2++) if (list[i2].isCurrent) return i2;
                return -1;
            })()
        };
    }

    function computeLiuNian(chart, model, yongshen, strength, dayun) {
        var currentYear = bjDate(Date.now()).getUTCFullYear();
        var birthYear = chart.birth.year;
        var list = [];
        var natal = natalGods(chart);

        /* 全流年：自出生年起至未来九年，过去流年供复盘回测 */
        for (var year = birthYear; year <= currentYear + 9; year++) {
            var gan = GAN[mod(year - 4, 10)];
            var zhi = ZHI[mod(year - 4, 12)];
            var currentYun = null;
            for (var i = 0; i < dayun.list.length; i++) {
                if (year >= dayun.list[i].yearStart && year <= dayun.list[i].yearEnd) {
                    currentYun = dayun.list[i];
                    break;
                }
            }
            var luck = scoreLuck(chart, model, yongshen, strength, gan, zhi, {
                label: '流年',
                dayunGanzhi: currentYun ? currentYun.ganzhi : ''
            });
            var gz = gan + zhi;
            list.push({
                year: year,
                age: year - birthYear + 1,
                ganzhi: gz,
                gan: gan,
                zhi: zhi,
                ganWx: GAN_WX[gan],
                zhiWx: ZHI_WX[zhi],
                shishen: tenGod(chart.dayGan, gan),
                zhiShishen: tenGod(chart.dayGan, CANG[zhi][0][0]),
                dayunGanzhi: currentYun ? currentYun.ganzhi : '未起运',
                xingYun: changSheng(chart.dayGan, zhi),
                shensha: luckShenSha(chart, zhi),
                score: luck.score,
                level: luck.level,
                levelKey: luck.levelKey,
                stars: luck.stars,
                notes: uniq(luck.notes),
                isCurrent: year === currentYear,
                isPast: year < currentYear
            });
        }
        return list;
    }

    function computeLiuYue(chart, model, yongshen, strength, dayun, targetYear) {
        var nowYear = targetYear || bjDate(Date.now()).getUTCFullYear();
        var yearGan = GAN[mod(nowYear - 4, 10)];
        var yearGz = yearGan + ZHI[mod(nowYear - 4, 12)];
        var now = Date.now();
        var list = [];
        var monthTerms = [
            { name: '立春', lon: 315 }, { name: '惊蛰', lon: 345 }, { name: '清明', lon: 15 },
            { name: '立夏', lon: 45 }, { name: '芒种', lon: 75 }, { name: '小暑', lon: 105 },
            { name: '立秋', lon: 135 }, { name: '白露', lon: 165 }, { name: '寒露', lon: 195 },
            { name: '立冬', lon: 225 }, { name: '大雪', lon: 255 }, { name: '小寒', lon: 285 }
        ];
        for (var i = 0; i < 12; i++) {
            var startYear = i === 11 ? nowYear + 1 : nowYear;
            var startTs = solarTermTs(startYear, monthTerms[i].lon);
            var endTerm = monthTerms[(i + 1) % 12];
            var endYear = i >= 10 ? nowYear + 1 : nowYear;
            var endTs = solarTermTs(endYear, endTerm.lon);
            var gan = GAN[(YIN_START[yearGan] + i) % 10];
            var zhi = ZHI[(i + 2) % 12];
            var currentYun = null;
            var y = bjDate(startTs).getUTCFullYear();
            dayun.list.forEach(function (dy) {
                if (y >= dy.yearStart && y <= dy.yearEnd) currentYun = dy;
            });
            var luck = scoreLuck(chart, model, yongshen, strength, gan, zhi, {
                label: '流月',
                dayunGanzhi: currentYun ? currentYun.ganzhi : ''
            });
            list.push({
                index: i + 1,
                month: zhi + '月',
                jieqi: monthTerms[i].name,
                ganzhi: gan + zhi,
                gan: gan,
                zhi: zhi,
                ganWx: GAN_WX[gan],
                zhiWx: ZHI_WX[zhi],
                shishen: tenGod(chart.dayGan, gan),
                zhiShishen: tenGod(chart.dayGan, CANG[zhi][0][0]),
                xingYun: changSheng(chart.dayGan, zhi),
                shensha: luckShenSha(chart, zhi),
                start: fmtDateTime(startTs),
                end: fmtDateTime(endTs),
                dayunGanzhi: currentYun ? currentYun.ganzhi : '未起运',
                score: luck.score,
                level: luck.level,
                levelKey: luck.levelKey,
                stars: luck.stars,
                notes: uniq(luck.notes),
                isCurrent: now >= startTs && now < endTs
            });
        }
        return { year: nowYear, yearGanzhi: yearGz, list: list };
    }

    /* ---------------------------------------------------------------------
     * 11. 盲派事业财运 · 主宾做功与求财模式
     * ------------------------------------------------------------------- */
    var STEM_ORGAN = {
        甲: '胆', 乙: '肝', 丙: '小肠（肩额）', 丁: '心（心血管/眼/神志）', 戊: '胃',
        己: '脾', 庚: '大肠（筋骨）', 辛: '肺（呼吸道/皮肤）',
        壬: '膀胱（三焦/代谢）', 癸: '肾（内分泌/生殖/耳骨）'
    };

    var BRANCH_ORGAN = {
        子: '膀胱/耳/泌尿', 丑: '脾腹/湿气', 寅: '胆/四肢关节/神经', 卯: '肝/目/筋脉',
        辰: '胃/胸肤/湿滞', 巳: '心/咽喉/面部', 午: '心脑血管/眼目/睡眠神志',
        未: '脾胃/膈膜/燥热', 申: '大肠/肺/骨骼经络', 酉: '肺/呼吸道/皮毛',
        戌: '命门/心包/下肢燥火', 亥: '肾水/血液代谢/头脑'
    };

    var ELEMENT_ORGANS = {
        木: '肝胆、筋骨、眼目与情绪疏泄',
        火: '心、小肠、血压、睡眠与神志',
        土: '脾胃、消化、肌肉与代谢',
        金: '肺、大肠、呼吸道与皮肤',
        水: '肾、膀胱、泌尿、内分泌与耳骨'
    };

    var RED_LUAN = {
        子: '卯', 丑: '寅', 寅: '丑', 卯: '子', 辰: '亥', 巳: '戌',
        午: '酉', 未: '申', 申: '未', 酉: '午', 戌: '巳', 亥: '辰'
    };

    function godPowerMap(chart) {
        var map = {};
        ['比肩', '劫财', '食神', '伤官', '偏财', '正财', '七杀', '正官', '偏印', '正印'].forEach(function (n) { map[n] = 0; });
        chart.pillars.forEach(function (p) {
            if (p.key !== 'day' && map[p.shishen] != null) map[p.shishen] += p.ganPower;
            p.cang.forEach(function (c) {
                if (map[c.tenGod] != null) map[c.tenGod] += c.power;
            });
        });
        return map;
    }

    function godPctMap(chart) {
        var raw = godPowerMap(chart);
        var total = sum(Object.keys(raw).map(function (k) { return raw[k]; })) || 1;
        var pct = {};
        Object.keys(raw).forEach(function (k) { pct[k] = raw[k] / total * 100; });
        var groups = {
            比劫: pct['比肩'] + pct['劫财'],
            食伤: pct['食神'] + pct['伤官'],
            财星: pct['正财'] + pct['偏财'],
            官杀: pct['正官'] + pct['七杀'],
            印星: pct['正印'] + pct['偏印']
        };
        return { raw: raw, pct: pct, groups: groups };
    }

    function elementPct(model, el) {
        return model.total > 0 ? model.totals[el] / model.total * 100 : 0;
    }

    function stemPairRelation(a, b) {
        if (!a || !b) return '';
        var has = function (list) {
            return list.some(function (h) {
                return (h[0] === a && h[1] === b) || (h[0] === b && h[1] === a);
            });
        };
        if (has(GAN_HE)) return '五合';
        if (has(GAN_CHONG)) return '相冲';
        var aw = GAN_WX[a], bw = GAN_WX[b];
        if (aw === bw) return '比和';
        if (WX_SHENG[aw] === bw || WX_SHENG[bw] === aw) return '相生';
        return '相克';
    }

    function branchPairRelation(a, b) {
        if (!a || !b) return '';
        var has = function (list) {
            return list.some(function (h) {
                return (h[0] === a && h[1] === b) || (h[0] === b && h[1] === a);
            });
        };
        if (a === b) return SELF_XING.indexOf(a) !== -1 ? '自刑' : '同气';
        if (has(LIU_HE)) return '六合';
        var half = false;
        SAN_HE.forEach(function (g) {
            if (g.indexOf(a) !== -1 && g.indexOf(b) !== -1) half = true;
        });
        if (half) return '半合';
        if (has(LIU_CHONG)) return '六冲';
        if (has(XING_PAIRS)) return '相刑';
        if (has(LIU_HAI)) return '六害';
        if (has(AN_HE)) return '暗合';
        return '';
    }

    function tombOpenInfo(tombs, zhi) {
        var reasons = [];
        if (!tombs || !tombs.list) return reasons;
        tombs.list.forEach(function (t) {
            if (TOMB_CLASH[t.zhi] === zhi) reasons.push('冲开' + t.pillarName + t.zhi + '（' + t.type + '）');
            else if (TOMB_HE[t.zhi] === zhi) reasons.push('合动' + t.pillarName + t.zhi + '（' + t.type + '）');
        });
        return reasons;
    }

    function computeCareerWealth(chart, model, strength, geju, yongshen, flow, disease, dayun, liunian, tombs) {
        var dayWx = chart.dayWx;
        var wealth = WX_KE[dayWx];
        var officer = WX_KE_BY[dayWx];
        var output = WX_SHENG[dayWx];
        var resource = WX_SHENG_BY[dayWx];
        var gp = godPctMap(chart);
        var g = gp.groups;
        var pct = function (el) { return elementPct(model, el); };

        var guest = 0, host = 0;
        activePillars(chart).forEach(function (p) {
            var power = p.ganPower + sum(p.cang.map(function (c) { return c.power; }));
            if (p.key === 'year' || p.key === 'month') guest += power;
            else host += power;
        });
        var guestPct = guest + host > 0 ? guest / (guest + host) * 100 : 50;
        var hostPct = 100 - guestPct;

        var patterns = [];
        function addPattern(key, name, desc, score) {
            patterns.push({
                key: key,
                name: name,
                desc: desc,
                score: Math.round(clamp(score, 0, 98))
            });
        }

        var s1 = 30 + Math.min(28, g.食伤 * 1.05) + Math.min(20, g.财星 * 1.05)
            + ((flow.combos.indexOf('食神生财') !== -1 || flow.combos.indexOf('伤官生财') !== -1) ? 18 : 0)
            + (yongshen.favorable.indexOf(wealth) !== -1 ? 8 : 0)
            - (g.食伤 < 8 ? 18 : 0) - (g.财星 < 5 ? 13 : 0);
        addPattern('output-wealth', '食伤生财做功',
            '以专业技术、内容表达、产品创意或销售转化直接换取现金流；才华即产能，作品与口碑可复利。', s1);

        var s2 = 26 + Math.min(26, g.官杀 * 1.1) + Math.min(22, g.印星 * 1.1)
            + ((flow.combos.indexOf('官印相生') !== -1 || flow.combos.indexOf('杀印相生') !== -1) ? 20 : 0)
            + ((yongshen.favorable.indexOf(officer) !== -1 || yongshen.favorable.indexOf(resource) !== -1) ? 8 : 0)
            - (g.官杀 < 6 ? 16 : 0) - (g.印星 < 6 ? 12 : 0);
        addPattern('officer-resource', '官印 / 杀印相生做功',
            '依托组织、制度、资质与授权体系上位；以证书、管理半径与责任承担换取层级、稳定性与话语权。', s2);

        var s3 = 24 + Math.min(26, g.食伤 * 1.2) + Math.min(24, g.官杀 * 1.1)
            + (flow.combos.indexOf('食神制杀') !== -1 ? 18 : 0)
            + (flow.breaks.indexOf('伤官见官') !== -1 ? -14 : 8)
            + (yongshen.favorable.indexOf(output) !== -1 ? 8 : 0)
            - (g.食伤 < 8 ? 14 : 0);
        addPattern('control-officer', '食神制杀 / 伤官合杀做功',
            '处理行业痛点、风险与危机：风控合规、法务安保、运维救援、质量治理与高难度交付，压力越大约显价值。', s3);

        var wealthTombs = tombs.list.filter(function (t) { return t.type === '财库'; });
        var s4 = 22 + Math.min(24, g.财星 * 1.2) + (wealthTombs.length ? 24 : 0)
            + (wealthTombs.some(function (t) { return t.natalClash || t.natalHe || (t.openYears && t.openYears.length); }) ? 12 : 0)
            + (g.比劫 >= 18 ? 8 : 0)
            + (yongshen.favorable.indexOf(wealth) !== -1 ? 8 : 0)
            - (strength.ratio < 38 ? 12 : 0);
        addPattern('control-wealth', '制财 / 开财库做功',
            '以资源整合、并购重组、渠道经营与周期低买高卖获利；重点在财库开闭、现金流节奏与退出纪律。', s4);

        patterns.sort(function (a, b) { return b.score - a.score; });
        var primaryPattern = patterns[0];
        var secondaryPattern = patterns[1];

        var zhengCai = gp.pct['正财'];
        var pianCai = gp.pct['偏财'];
        var openTomb = wealthTombs.some(function (t) {
            return t.natalClash || t.natalHe || (t.openYears && t.openYears.length);
        });
        var modes = [
            {
                key: 'salary', name: '稳健薪资型',
                desc: '以固定薪酬、职级与长期福利积累；重稳定、可预期与组织信用。',
                score: 34 + g.官杀 * 0.85 + g.印星 * 0.7 + zhengCai * 0.9
                    + ((flow.combos.indexOf('官印相生') !== -1 || flow.combos.indexOf('杀印相生') !== -1) ? 12 : 0)
                    + (flow.quality >= 55 ? 8 : 0)
                    - pianCai * 0.35 - Math.max(0, g.食伤 - 18) * 0.4
            },
            {
                key: 'commission', name: '专业佣金型',
                desc: '以项目制、提成制、顾问/设计/技术外包变现；收入随专业口碑波动。',
                score: 32 + g.食伤 * 1.05 + (zhengCai + pianCai) * 0.75
                    + ((flow.combos.indexOf('食神生财') !== -1 || flow.combos.indexOf('伤官生财') !== -1) ? 16 : 0)
                    + (flow.quality >= 50 ? 6 : 0) - g.印星 * 0.2
            },
            {
                key: 'business', name: '业务经营型',
                desc: '适合公司化经营、渠道/供应链/门店与团队分成；重现金流与库存周转。',
                score: 30 + pianCai * 1.15 + g.食伤 * 0.65 + (wealthTombs.length ? 16 : 0)
                    + (g.比劫 >= 15 ? 6 : 0) + (flow.combos.indexOf('财官相生') !== -1 ? 6 : 0)
                    - (strength.ratio < 40 ? 10 : 0)
            },
            {
                key: 'asset', name: '资产爆发型',
                desc: '适合资产周期、并购、股权与资源型机会；收益集中，重开库年份与退出纪律。',
                score: 24 + pianCai * 1.2 + (wealthTombs.length ? 20 : 0) + (openTomb ? 12 : 0)
                    + (yongshen.favorable.indexOf(wealth) !== -1 ? 8 : 0)
                    - (g.印星 > 25 ? 10 : 0) - (strength.ratio < 38 ? 8 : 0)
            }
        ];
        modes.forEach(function (m) { m.score = Math.round(clamp(m.score, 0, 98)); });
        modes.sort(function (a, b) { return b.score - a.score; });
        var primaryMode = modes[0];

        var nowYear = bjDate(Date.now()).getUTCFullYear();
        var futureYun = dayun.list.filter(function (d) { return d.yearEnd >= nowYear; });
        if (!futureYun.length) futureYun = dayun.list.slice();
        var bestYun = futureYun.slice().sort(function (a, b) { return b.score - a.score; })[0];

        var wealthYears = [];
        liunian.forEach(function (n) {
            var reasons = [];
            var bonus = 0;
            tombOpenInfo(tombs, n.zhi).forEach(function (txt) {
                reasons.push(txt);
                bonus += txt.indexOf('冲开') !== -1 ? 22 : 12;
            });
            if (n.zhiWx === wealth) { reasons.push('财星临支'); bonus += 10; }
            if (n.shishen === '正财' || n.shishen === '偏财') { reasons.push('财星透干'); bonus += 8; }
            if (LU[chart.dayGan] === n.zhi) { reasons.push('日主得禄'); bonus += 8; }
            if (n.score >= 20) bonus += 8;
            if (reasons.length && bonus >= 12) {
                wealthYears.push({
                    year: n.year, ganzhi: n.ganzhi, age: n.age,
                    score: n.score, bonus: bonus, reasons: uniq(reasons)
                });
            }
        });
        wealthYears.sort(function (a, b) { return (b.bonus + b.score * 0.2) - (a.bonus + a.score * 0.2); });
        wealthYears = wealthYears.slice(0, 4);

        var traps = [];
        if (g.比劫 >= 20 || flow.breaks.indexOf('群比争财') !== -1) {
            traps.push('比劫夺财：合伙必须预先约定股权、分红、决策权与退出机制，避免担保、代持与无上限借款。');
        }
        if (g.印星 >= 26 || yongshen.unfavorable.indexOf(resource) !== -1) {
            traps.push('印星过重：忌以学历、资历或情怀驱动重资产扩张，先小规模验证现金流，再谈规模化。');
        }
        if (g.财星 >= 30 && strength.ratio < 48) {
            traps.push('财多身弱：忌高杠杆与多线投资，先固本再扩张；重大投入宜分阶段并预留现金缓冲。');
        }
        if (g.食伤 >= 30 && strength.ratio < 45) {
            traps.push('食伤泄身：创意与项目并行易透支，忌同时开启三条以上战线，先做减法再做乘法。');
        }
        if (pianCai >= 15 && g.比劫 >= 15) {
            traps.push('偏财遇比劫：合作分利易生争议，钱账与决策权要分离，定期对账并保留书面凭证。');
        }
        if (!traps.length) {
            traps.push('原局财官流通尚可，仍忌在忌神流年做高杠杆决策；所有合作以书面条款落地。');
        }
        traps = traps.slice(0, 3);

        var guestText = guestPct >= 55
            ? '宾位（年月）力量 ' + round1(guestPct) + '%，原生家庭、外部平台与社会资源影响更大；宜先借势、借平台、借信用，再逐步建立自有品牌与资产。'
            : (hostPct >= 55
                ? '主位（日时）力量 ' + round1(hostPct) + '%，自主性、核心资产与配偶/团队助力更强；适合自建体系、自己定规则，不宜长期寄人篱下。'
                : '主宾力量接近（宾 ' + round1(guestPct) + '% / 主 ' + round1(hostPct) + '%），内外资源可相互转化；关键是选对平台并保留自主决策权。');

        var levelText = primaryPattern.score >= 75 ? '主线清晰'
            : (primaryPattern.score >= 55 ? '主线可用'
                : (primaryPattern.score >= 40 ? '需岁运引发' : '多元待定'));

        var summary = '命局' + (guestPct >= hostPct
            ? '宾位偏重，外部平台与原生资源影响大，宜借势而起；'
            : '主位偏重，自主性与核心资产掌控力强，宜自建体系；')
            + '做功主线为' + primaryPattern.name + '，求财模式偏向' + primaryMode.name + '。'
            + (bestYun ? '近运最佳大运为' + bestYun.ganzhi + '（' + bestYun.yearStart + '–' + bestYun.yearEnd + '，' + bestYun.level + '）。' : '')
            + (wealthYears.length
                ? '近十年可重点把握' + wealthYears.slice(0, 3).map(function (y) { return y.year + '年'; }).join('、') + '的财库与得禄窗口。'
                : '近十年财库引动不显，宜以专业复利与稳定现金流为主。');

        return {
            guestPct: round1(guestPct),
            hostPct: round1(hostPct),
            guestText: guestText,
            patterns: patterns,
            primaryPattern: primaryPattern,
            secondaryPattern: secondaryPattern,
            modes: modes,
            primaryMode: primaryMode,
            bestDayun: bestYun || null,
            wealthYears: wealthYears,
            traps: traps,
            levelText: levelText,
            score: primaryPattern.score,
            combos: flow.combos,
            summary: summary
        };
    }

    /* ---------------------------------------------------------------------
     * 12. 婚恋家庭 · 六亲全息与正缘应期
     * ------------------------------------------------------------------- */
    function computeFamily(chart, model, strength, yongshen, dayun, liunian, palaces, tombs) {
        var dayWx = chart.dayWx;
        var wealth = WX_KE[dayWx];
        var officer = WX_KE_BY[dayWx];
        var output = WX_SHENG[dayWx];
        var resource = WX_SHENG_BY[dayWx];
        var gp = godPctMap(chart);
        var g = gp.groups;
        var pct = function (el) { return elementPct(model, el); };
        var stateOf = function (el) {
            var s = yongshen.scores[el] || 0;
            return s > 5 ? '喜用' : (s < -5 ? '忌神' : '闲神');
        };
        var male = chart.gender === 'male';
        var yearP = activePillars(chart)[0], monthP = activePillars(chart)[1], dayP = activePillars(chart)[2], hourP = chart.pillars[3];

        var yearRels = model.relations.filter(function (r) { return r.keys.indexOf('year') !== -1; });
        var monthRels = model.relations.filter(function (r) { return r.keys.indexOf('month') !== -1; });
        var moveOut = yearRels.concat(monthRels).some(function (r) {
            return r.type === '地支六冲' || (r.effect && r.effect.indexOf('驿马') !== -1);
        });
        var fatherPct = g.财星;
        var motherPct = g.印星;
        var parentText = '年柱' + yearP.ganzhi + '（' + yearP.shishen + '）主祖辈与少年环境，月柱' + monthP.ganzhi
            + '（' + monthP.shishen + '）为父母宫。印星' + round1(motherPct) + '%为母系支持，财星'
            + round1(fatherPct) + '%为父系资源。'
            + (motherPct >= 18 ? '印星有力，母亲或长辈照顾较多，早年安全感较足；' : (motherPct <= 8 ? '印星偏弱，早年多需自立，长辈助力有限；' : '印星适中，亲情支持有度；'))
            + (fatherPct >= 18 ? '财星有力，父亲务实、重资源，家教偏现实导向。' : (fatherPct <= 8 ? '财星偏弱，与父亲聚少离多或沟通需主动。' : '财星适中，父辈助力平稳。'))
            + (motherPct > fatherPct * 1.5 ? '家中母系话语权更重，易被照顾过度，成年后需建立决策边界。' : (fatherPct > motherPct * 1.5 ? '家中父系与现实资源导向更强，早年压力与期待并存。' : '财印相对平衡，家庭支持与要求并存。'))
            + (moveOut ? '年月见冲或驿马，早年环境变动较多，成年后离乡发展更能舒展。' : '年月较稳，若本地资源契合，就近发展亦有根基；不必为“离开”而离开。');

        var parentTags = [
            '年柱' + stateOf(yearP.ganWx),
            '月柱' + stateOf(monthP.ganWx),
            '印星' + round1(motherPct) + '%',
            '财星' + round1(fatherPct) + '%',
            moveOut ? '宜离乡发展' : '可就近扎根'
        ];

        var spouseStarGroup = male ? '财星' : '官杀';
        var spouseStarPct = male ? g.财星 : g.官杀;
        var spouseStarName = male
            ? (gp.pct['正财'] >= gp.pct['偏财'] ? '正财' : '偏财')
            : (gp.pct['正官'] >= gp.pct['七杀'] ? '正官' : '七杀');
        var dayMain = dayP.cang[0];
        var spouseTrait = SPOUSE_TRAIT[dayMain.tenGod] || '性情有自身特点';
        var scene = ['子', '午', '卯', '酉'].indexOf(dayP.zhi) !== -1
            ? '社交场合、公开活动或异地机缘'
            : (['寅', '申', '巳', '亥'].indexOf(dayP.zhi) !== -1
                ? '工作协作、出行途中或朋友引荐'
                : '熟人圈、同事同学或长辈介绍');
        var marriageText = '日支' + dayP.zhi + '藏' + dayP.cang.map(function (c) { return c.gan + '（' + c.tenGod + '）'; }).join('、')
            + '，夫妻宫' + palaces.day.stateText + '。配偶星' + spouseStarName + '占' + round1(spouseStarPct) + '%，'
            + (spouseStarPct >= 18 ? '配偶星有力，婚恋机会不缺，但选择多也需定力；' : (spouseStarPct <= 7 ? '配偶星偏弱，正缘多需主动经营或经人介绍；' : '配偶星适中，感情发展以稳为主；'))
            + '正缘画像：' + spouseTrait + '，相识场景偏向' + scene + '。'
            + palaces.spouseText;

        var hongLuan = RED_LUAN[chart.yearZhi] || '';
        var tianXi = hongLuan ? ZHI[(ZHI.indexOf(hongLuan) + 6) % 12] : '';
        var marriageWindows = [];
        var crisisWindows = [];

        liunian.forEach(function (n) {
            var positives = [], negatives = [], pos = 0, neg = 0;
            var relDay = branchPairRelation(n.zhi, dayP.zhi);
            if (relDay === '六合') { pos += 24; positives.push('六合引动夫妻宫'); }
            else if (relDay === '暗合') { pos += 18; positives.push('暗合牵引夫妻宫'); }
            else if (relDay === '同气') { pos += 10; positives.push('夫妻宫伏吟'); }
            if (relDay === '六冲') { neg += 20; negatives.push('六冲夫妻宫'); }
            if (relDay === '相刑' || relDay === '自刑') { neg += 14; negatives.push(relDay + '夫妻宫'); }
            if (relDay === '六害') { neg += 10; negatives.push('六害夫妻宫'); }
            if (n.zhi === hongLuan) { pos += 20; positives.push('红鸾入年'); }
            if (n.zhi === tianXi) { pos += 16; positives.push('天喜入年'); }
            if (male && (n.shishen === '正财' || n.shishen === '偏财')) { pos += 16; positives.push('配偶星透干'); }
            if (!male && (n.shishen === '正官' || n.shishen === '七杀')) { pos += 16; positives.push('夫星透干'); }
            if (CANG[n.zhi].some(function (c) { return tenGod(chart.dayGan, c[0]) === spouseStarName; })) {
                pos += 8;
                positives.push('流年藏配偶星');
            }
            if (n.score >= 20) pos += 10;
            if (n.score <= -20) neg += 10;

            if (male && (n.shishen === '比肩' || n.shishen === '劫财') && g.比劫 >= 18) {
                neg += 18;
                negatives.push('比劫争妻');
            }
            if (!male && n.shishen === '伤官' && (g.官杀 >= 10 || gp.raw['正官'] > 0.3)) {
                neg += 18;
                negatives.push('伤官见官');
            }
            if (n.score <= -25 && neg === 0) { neg += 12; negatives.push('流年整体承压'); }

            if (pos >= 28) {
                marriageWindows.push({
                    year: n.year, ganzhi: n.ganzhi, age: n.age, score: pos,
                    reasons: uniq(positives), dayun: n.dayunGanzhi
                });
            }
            if (neg >= 22) {
                crisisWindows.push({
                    year: n.year, ganzhi: n.ganzhi, age: n.age, score: neg,
                    reasons: uniq(negatives), dayun: n.dayunGanzhi
                });
            }
        });
        marriageWindows.sort(function (a, b) { return b.score - a.score; });
        crisisWindows.sort(function (a, b) { return b.score - a.score; });

        var childStar = male ? '官杀' : '食伤';
        var childPct = male ? g.官杀 : g.食伤;
        var childGod = male
            ? (gp.pct['正官'] >= gp.pct['七杀'] ? '正官' : '七杀')
            : (gp.pct['食神'] >= gp.pct['伤官'] ? '食神' : '伤官');
        var hourState = hourP.unknown ? '未知' : stateOf(hourP.ganWx);
        var hourRels = model.relations.filter(function (r) { return r.keys.indexOf('hour') !== -1; });
        var hourHurt = hourRels.some(function (r) {
            return r.type === '地支六冲' || r.type === '三刑' || r.type === '自刑' || r.type === '地支相刑';
        });
        var childWindows = [];
        liunian.forEach(function (n) {
            var reasons = [], score = 0;
            var relHour = hourP.unknown ? '' : branchPairRelation(n.zhi, hourP.zhi);
            if (male && (n.shishen === '正官' || n.shishen === '七杀')) { score += 20; reasons.push('子女星透干'); }
            if (!male && (n.shishen === '食神' || n.shishen === '伤官')) { score += 20; reasons.push('子女星透干'); }
            if (relHour === '六合') { score += 18; reasons.push('合动子女宫'); }
            if (relHour === '六冲') { score -= 12; reasons.push('冲动子女宫'); }
            if (n.zhi === tianXi) { score += 12; reasons.push('天喜入年'); }
            if (n.score >= 20) score += 8;
            if (score >= 20) childWindows.push({ year: n.year, ganzhi: n.ganzhi, age: n.age, score: score, reasons: uniq(reasons) });
        });
        childWindows.sort(function (a, b) { return b.score - a.score; });

        var lateYun = dayun.list[dayun.list.length - 1];
        var childText = (hourP.unknown ? '时辰未知，子女宫从略' : '时柱' + hourP.ganzhi + '为子女宫，藏' + hourP.cang.map(function (c) { return c.gan + '（' + c.tenGod + '）'; }).join('、'))
            + '；' + (male ? '男命以官杀为子女星' : '女命以食伤为子女星') + '，' + childStar + '占' + round1(childPct) + '%。'
            + (childPct >= 18 ? '子女缘分较旺，子女个性鲜明、能量足；' : (childPct <= 7 ? '子女星偏弱，缘分宜顺其自然，重在质量而非数量；' : '子女缘分适中，亲子互动以稳为主；'))
            + (hourP.unknown ? '时柱未知，晚年与子女宫断语从略。' : '时柱' + hourState + '，' + (hourState === '喜用'
                ? '晚年与子女宫为喜用，子女多能带来实际助力，晚景安稳。'
                : (hourState === '忌神' ? '时柱为忌，晚年易为子女或晚辈操心，宜提前安排养老与财务边界。' : '时柱为闲神，晚年平顺，亲子关系重在日常经营。')))
            + (hourP.unknown ? '' : (hourHurt ? '时柱逢冲刑，子女成长阶段环境变动较多，教养上忌焦虑投射与高压控制，宜给空间、立底线。' : '时柱无重冲刑，亲子关系可循循善诱，避免把自己的未完成投射到孩子身上。'))
            + (lateYun ? '晚运' + lateYun.ganzhi + '（' + lateYun.ageStart + '–' + lateYun.ageEnd + '岁）评分' + lateYun.level + '，宜早做健康与资产的双重安排。' : '');

        var socialState = stateOf(dayWx);
        var peerBreak = model.relations.filter(function (r) {
            return r.keys.indexOf('month') !== -1 && (r.type === '地支六冲' || r.type === '地支相刑' || r.type === '三刑');
        });
        var socialText = '月柱' + monthP.ganzhi + '为同辈与事业起点，比劫占' + round1(g.比劫) + '%，'
            + (g.比劫 >= 22 || socialState === '忌神'
                ? '同辈与合伙人带来的分利、比较与消耗较明显；朋友宜精不宜多，涉及金钱务必书面化。'
                : (g.比劫 <= 10 ? '同辈助力有限，更多靠自己开路；可主动加入高质量团队与行业社群，补足外部支持。' : '同辈关系总体可控，既有助力也有竞争，关键在规则先行。'))
            + (peerBreak.length ? '月柱见冲刑，同事与合作伙伴流动性较大，核心岗位要有备份与交接机制。' : '')
            + '合伙边界：不担保、不代持、不口头承诺；要书面协议、要分权制衡、要定期对账。'
            + '优先与五行属' + yongshen.favorable.join('、') + '、性格互补且职责清晰的人合作。';

        var familySummary = '原生家庭：' + (motherPct >= fatherPct ? '母系支持更显，' : '父系资源影响更大，')
            + (moveOut ? '早年环境多变，离乡更易舒展。' : '早年环境相对稳定。')
            + '婚姻：' + (spouseStarPct >= 18 ? '配偶星有力，正缘机会不缺，重点在筛选与经营。' : '配偶星偏弱，正缘需主动经营或借助介绍。')
            + (marriageWindows.length ? '近十年动婚窗口在' + marriageWindows.slice(0, 3).map(function (x) { return x.year + '年'; }).join('、') + '。' : '近十年动婚信号不集中，宜先稳自身。')
            + '子女：' + (childPct >= 18 ? '子女缘旺，教养重边界。' : '子女缘宜顺其自然。');

        return {
            parents: { title: '父母与原生家庭', kicker: '年柱 · 月柱 · 财印', text: parentText, tags: parentTags },
            marriage: {
                title: '正缘画像与婚姻周期', kicker: '日支夫妻宫 · 配偶星',
                text: marriageText, tags: [
                    '配偶星' + spouseStarName,
                    '夫妻宫' + palaces.day.stateText,
                    '红鸾' + (hongLuan || '—'),
                    '天喜' + (tianXi || '—')
                ],
                windows: marriageWindows.slice(0, 3),
                crisis: crisisWindows.slice(0, 3)
            },
            children: {
                title: '子女缘分与晚年归宿', kicker: '时柱子女宫 · 晚运',
                text: childText,
                tags: ['子女星' + childGod, '时柱' + hourState, '晚运' + (lateYun ? lateYun.level : '—')],
                windows: childWindows.slice(0, 3)
            },
            social: {
                title: '同辈社交与合伙边界', kicker: '月柱 · 比劫',
                text: socialText,
                tags: ['比劫' + round1(g.比劫) + '%', socialState === '忌神' ? '宜精不宜多' : '可借团队之力']
            },
            summary: familySummary
        };
    }

    /* ---------------------------------------------------------------------
     * 13. 身心健康 · 干支脏腑与寒暖燥湿
     * ------------------------------------------------------------------- */
    function computeHealth(chart, model, strength, geju, tiaohou, disease, yongshen, liunian) {
        var pct = function (el) { return elementPct(model, el); };
        var dayWx = chart.dayWx;

        function elementState(el) {
            var states = [];
            if (pct(el) >= 32) states.push('过旺');
            else if (pct(el) <= 8) states.push('偏弱');
            if (tiaohou.mode === 'dry-hot' && (el === '火' || el === '土')) states.push('燥热');
            if (tiaohou.mode === 'cold-wet' && (el === '水' || el === '金')) states.push('寒湿');
            if (disease.primary && disease.primary.diseaseElements.indexOf(el) !== -1) states.push('受病');
            return states;
        }

        function organItem(name, source, element, states, note) {
            var risky = states.indexOf('过旺') !== -1 || states.indexOf('燥热') !== -1
                || states.indexOf('寒湿') !== -1 || states.indexOf('受病') !== -1 || states.indexOf('受冲刑') !== -1;
            return {
                name: name, source: source, element: element,
                state: risky ? 'risk' : (states.indexOf('偏弱') !== -1 ? 'weak' : 'normal'),
                stateText: states.length ? states.join('·') : '平和',
                note: note || ''
            };
        }

        var stemMap = GAN.map(function (gan) {
            var states = elementState(GAN_WX[gan]);
            var present = activePillars(chart).some(function (p) { return p.gan === gan; });
            return organItem(STEM_ORGAN[gan], gan + '（' + GAN_WX[gan] + '）', GAN_WX[gan], states, present ? '命局透出' : '未透');
        });
        var branchMap = ZHI.map(function (zhi) {
            var states = elementState(ZHI_WX[zhi]);
            var present = activePillars(chart).some(function (p) { return p.zhi === zhi; });
            var hurt = model.relations.some(function (r) {
                return r.keys.some(function (k) {
                    var p = activePillars(chart).filter(function (x) { return x.key === k; })[0];
                    return p && p.zhi === zhi;
                }) && (r.type === '地支六冲' || r.type === '三刑' || r.type === '自刑' || r.type === '地支相刑' || r.type === '地支六害');
            });
            if (hurt) states.push('受冲刑');
            return organItem(BRANCH_ORGAN[zhi], zhi + '（' + ZHI_WX[zhi] + '）', ZHI_WX[zhi], states, present ? '命局见支' : '未现');
        });

        var riskOrgans = stemMap.concat(branchMap).filter(function (o) { return o.state !== 'normal'; });
        riskOrgans.sort(function (a, b) {
            return (b.state === 'risk' ? 1 : 0) - (a.state === 'risk' ? 1 : 0);
        });

        var constitutionLabel, constitutionText;
        if (tiaohou.mode === 'dry-hot') {
            constitutionLabel = '燥热体质';
            constitutionText = '寒暖指数 ' + tiaohou.warmth + '/100、燥湿指数 ' + tiaohou.dryness
                + '/100，火土偏旺、水气受熬。常见口干咽燥、上火、睡眠浅、皮肤干痒、血压与心血管负担，情绪易急。'
                + '调养方向：润燥养阴、清心降火，少辛辣烧烤与熬夜。';
        } else if (tiaohou.mode === 'cold-wet') {
            constitutionLabel = '寒湿体质';
            constitutionText = '寒暖指数 ' + tiaohou.warmth + '/100、燥湿指数 ' + tiaohou.dryness
                + '/100，水金偏寒、阳气受抑。常见畏寒、手脚凉、湿气重、代谢慢、关节不适与情绪低落。'
                + '调养方向：温阳健脾、祛湿通络，少生冷寒凉与久坐。';
        } else {
            constitutionLabel = (tiaohou.warmth >= 55 ? '偏温' : (tiaohou.warmth <= 45 ? '偏凉' : '寒暖平和'))
                + ' · ' + (tiaohou.dryness >= 55 ? '偏燥' : (tiaohou.dryness <= 45 ? '偏湿' : '燥湿适中'));
            constitutionText = '寒暖指数 ' + tiaohou.warmth + '/100、燥湿指数 ' + tiaohou.dryness
                + '/100，整体气候未至极偏。以脾胃运化与情志作息为主要抓手，按季节微调即可。';
        }

        var pathologies = [];
        pathologies.push({ title: '寒暖燥湿体质', body: constitutionText });
        if (disease.primary) {
            var diseaseEls = disease.primary.diseaseElements;
            var organText = diseaseEls.map(function (el) { return el + '系统（' + ELEMENT_ORGANS[el] + '）'; }).join('、');
            pathologies.push({
                title: '过旺克绝 · 受煎熬脏腑',
                body: '首要病机为“' + disease.primary.name + '”（' + disease.primary.severity + '分）：病在'
                    + diseaseEls.join('、') + '，重点波及' + organText + '。药取' + disease.primary.medicine
                    + (disease.primary.assistant ? '、' + disease.primary.assistant + '为佐' : '')
                    + '。' + disease.primary.note
            });
        } else {
            pathologies.push({
                title: '过旺克绝 · 受煎熬脏腑',
                body: '原局未见突出病神，脏腑风险以五行偏枯与生活习惯为主，按下方体质与作息调养即可。'
            });
        }

        var relationHits = model.relations.filter(function (r) {
            return ['地支六冲', '三刑', '自刑', '地支相刑', '地支六害'].indexOf(r.type) !== -1;
        });
        var relationTexts = relationHits.map(function (r) {
            var zhis = r.keys.map(function (k) {
                var p = activePillars(chart).filter(function (x) { return x.key === k; })[0];
                return p ? p.zhi : '';
            }).filter(Boolean);
            var parts = uniq(zhis).map(function (z) { return z + '（' + BRANCH_ORGAN[z] + '）'; }).join('、');
            return r.type + ' ' + r.pair + '：' + parts + '，' + (r.effect || r.note || '注意对应部位的外伤、劳损或慢性不适');
        });
        pathologies.push({
            title: '刑冲自刑 · 身体部位提示',
            body: relationTexts.length ? relationTexts.join('；') + '。'
                : '原局无明显刑冲自刑，身体信号多与五行偏枯、作息与情绪相关，不必过度对号入座。'
        });

        var riskYears = [];
        var weakBranches = activePillars(chart).filter(function (p) { return pct(ZHI_WX[p.zhi]) <= 8; }).map(function (p) { return p.zhi; });
        liunian.forEach(function (n) {
            var reasons = [], score = 0;
            if (disease.primary) {
                if (disease.primary.diseaseElements.indexOf(n.ganWx) !== -1) { score += 14; reasons.push('流年天干加临病神' + n.ganWx); }
                if (disease.primary.diseaseElements.indexOf(n.zhiWx) !== -1) { score += 12; reasons.push('流年地支助起病神' + n.zhiWx); }
            }
            var relDay = branchPairRelation(n.zhi, chart.dayZhi);
            if (relDay === '六冲') { score += 20; reasons.push('冲日支本命'); }
            if (relDay === '相刑' || relDay === '自刑') { score += 16; reasons.push(relDay + '日支本命'); }
            if (relDay === '六害') { score += 10; reasons.push('害日支本命'); }
            weakBranches.forEach(function (z) {
                if (n.zhi === z) { score += 12; reasons.push('引动偏弱' + z + '支'); }
                if (LIU_CHONG.some(function (h) { return (h[0] === n.zhi && h[1] === z) || (h[1] === n.zhi && h[0] === z); })) {
                    score += 14;
                    reasons.push('冲克偏弱' + z + '支');
                }
            });
            if (n.score <= -25) { score += 10; reasons.push('流年整体承压'); }
            if (score >= 18) {
                riskYears.push({
                    year: n.year, ganzhi: n.ganzhi, age: n.age, score: n.score, risk: score,
                    level: score >= 36 ? '重点' : (score >= 26 ? '留意' : '观察'),
                    reasons: uniq(reasons)
                });
            }
        });
        riskYears.sort(function (a, b) { return b.risk - a.risk; });
        riskYears = riskYears.slice(0, 4);

        var primaryOrgan = riskOrgans.filter(function (o) { return o.state === 'risk'; })[0] || riskOrgans[0];
        var organTime = {
            胆: '23:00–01:00', 肝: '01:00–03:00', 肺: '03:00–05:00', 大肠: '05:00–07:00',
            胃: '07:00–09:00', 脾: '09:00–11:00', 心: '11:00–13:00', 小肠: '13:00–15:00',
            膀胱: '15:00–17:00', 肾: '17:00–19:00', 心包: '19:00–21:00', 三焦: '21:00–23:00'
        };
        var timeAdvice = '23:00 前入睡，保证 7 小时睡眠；午间 11:00–13:00 小憩 15–20 分钟。';
        if (primaryOrgan) {
            var organKey = Object.keys(organTime).filter(function (k) { return primaryOrgan.name.indexOf(k) !== -1; })[0];
            if (organKey) timeAdvice = '重点关注' + organKey + '经当令的 ' + organTime[organKey] + '：' + (organKey === '心' || organKey === '小肠' ? '午后避免情绪激动与过量咖啡因。' : (organKey === '肾' || organKey === '膀胱' ? '傍晚补水、忌憋尿与过咸。' : (organKey === '肝' || organKey === '胆' ? '尽量在 23:00 前入睡，忌熬夜与情绪憋闷。' : '按经络节律安排休息与进食，避免长期逆作息。')));
        }

        var favEl = yongshen.primary;
        var flavor = { 木: '酸', 火: '苦', 土: '甘', 金: '辛', 水: '咸' };
        var food = {
            木: '绿叶菜、山楂、乌梅、枸杞、少量醋；少酒与油炸。',
            火: '莲子、百合、绿豆、苦瓜、深色浆果；少辛辣烧烤与烈酒。',
            土: '小米、山药、南瓜、红枣、茯苓；少生冷甜腻与暴饮暴食。',
            金: '白萝卜、梨、银耳、百合、杏仁；少烟酒与过度辛辣。',
            水: '黑豆、黑芝麻、海带、核桃、桑葚；控盐并规律补水。'
        };
        var dietAdvice = '五味以“' + flavor[favEl] + '”为用，适量增加' + favEl + '性食物：' + food[favEl]
            + (tiaohou.mode === 'dry-hot' ? ' 当前燥热偏重，可加银耳、梨、麦冬、莲藕润燥，忌羊肉、辣椒与熬夜。' : '')
            + (tiaohou.mode === 'cold-wet' ? ' 当前寒湿偏重，可适量姜、桂圆、山药、陈皮温阳健脾，忌冰饮与生冷沙拉。' : '');

        var exerciseAdvice;
        if (strength.ratio >= 58) {
            exerciseAdvice = '身强气足，适合有氧 + 抗阻结合：每周 3–4 次，每次 40–50 分钟，强度约 70%，注意运动后补水与降火，避免连续高强度透支。';
        } else if (strength.ratio < 45) {
            exerciseAdvice = '身偏弱，宜“微汗即止”：八段锦、太极、快走、瑜伽为主，每周 3–5 次，每次 25–35 分钟；忌空腹剧烈运动与大汗淋漓。';
        } else {
            exerciseAdvice = '身中和，宜规律有氧与拉伸并重：每周 3 次快走/慢跑/游泳，配合 2 次柔韧与核心训练，保持气血流通。';
        }
        exerciseAdvice += ' 结合' + dayWx + '性体质，可多做' + ({ 木: '舒展、拉伸、登山与户外行走', 火: '游泳、慢跑与呼吸训练', 土: '力量训练、徒步与腹部按摩', 金: '器械训练、深呼吸与扩胸运动', 水: '游泳、骑行与踝泵练习' }[dayWx]) + '。';

        var healthSummary = '体质判为' + constitutionLabel + '；重点防守' + (riskOrgans.slice(0, 3).map(function (o) { return o.name; }).join('、') || '脾胃与睡眠')
            + (riskYears.length ? '；未来十年健康重点年份为' + riskYears.slice(0, 3).map(function (y) { return y.year + '年'; }).join('、') + '。' : '。');

        return {
            constitution: {
                label: constitutionLabel,
                text: constitutionText,
                warmth: tiaohou.warmth,
                dryness: tiaohou.dryness
            },
            stemMap: stemMap,
            branchMap: branchMap,
            riskOrgans: riskOrgans.slice(0, 10),
            pathologies: pathologies,
            riskYears: riskYears,
            prescriptions: [
                { title: '时辰作息', body: timeAdvice },
                { title: '饮食五味', body: dietAdvice },
                { title: '运动调养', body: exerciseAdvice }
            ],
            summary: healthSummary
        };
    }

    /* ---------------------------------------------------------------------
     * 14. 性情心性与人生应期雷达
     * ------------------------------------------------------------------- */
    var GOD_TRAIT = {
        比肩: { out: '自持、讲原则、不轻易求助', inside: '需要被看见，又怕麻烦别人' },
        劫财: { out: '果断、敢争、行动快', inside: '对资源与公平高度敏感' },
        食神: { out: '温和、松弛、有生活感', inside: '渴望稳定与创造的自由' },
        伤官: { out: '锋利、表达强、审美高', inside: '怕被误解，内心需要认可' },
        正财: { out: '务实、守约、重结果', inside: '对安全感与现金流有执念' },
        偏财: { out: '大方、善交际、机会感强', inside: '怕被束缚，也怕失去掌控' },
        正官: { out: '克制、负责、守规则', inside: '在意评价，压力常内化' },
        七杀: { out: '强硬、抗压、执行力强', inside: '警觉高，习惯先做最坏的打算' },
        正印: { out: '温和、好学、讲道理', inside: '需要被理解，容易想太多' },
        偏印: { out: '独立、洞察、边界感强', inside: '敏感多思，渴望精神共鸣' }
    };

    function computeMilestones(chart, model, strength, geju, yongshen, dayun, liunian, flow, disease, family) {
        var gp = godPctMap(chart);
        var male = chart.gender === 'male';
        var visible = activePillars(chart).filter(function (p) { return p.key !== 'day'; }).map(function (p) {
            return { gan: p.gan, shishen: p.shishen, power: p.ganPower, position: p.name };
        }).sort(function (a, b) { return b.power - a.power; });
        var visibleGods = uniq(visible.map(function (x) { return x.shishen; })).slice(0, 3);

        var dayMain = activePillars(chart)[2].cang[0];
        var siLingGod = tenGod(chart.dayGan, chart.siLing.gan);
        var innerGods = uniq([dayMain.tenGod, siLingGod]);

        var outerText = '外显以' + visibleGods.join('、') + '为主：'
            + visibleGods.map(function (n) { return GOD_TRAIT[n] ? GOD_TRAIT[n].out : ''; }).filter(Boolean).join('；')
            + '。这是你给人的第一印象，也是你在人群中习惯扮演的角色。';
        var innerText = '内隐以日支本气' + dayMain.tenGod + '与月令司令' + chart.siLing.gan + '（' + siLingGod + '）为底色：'
            + innerGods.map(function (n) { return GOD_TRAIT[n] ? GOD_TRAIT[n].inside : ''; }).filter(Boolean).join('；')
            + '。这是独处时真实的驱动力与焦虑来源。';
        var sameTop = visibleGods[0] === innerGods[0];
        var contrastText = sameTop
            ? '外显与内隐高度一致，价值主张清晰，行事不太内耗；但也要防止把单一优势用到极致而忽略环境变化。'
            : '外显' + visibleGods[0] + '与内隐' + innerGods[0] + '存在张力：对外要撑住的形象，与内心真正渴望的东西并不完全相同。学会在安全关系里表达真实需求，比继续“硬撑”更能减少消耗。';

        var nowYear = bjDate(Date.now()).getUTCFullYear();
        var rows = liunian.map(function (n) {
            var tags = [];
            var notes = [];
            var yunStart = dayun.list.some(function (d) { return d.yearStart === n.year; });
            var career = n.score >= 32 || yunStart
                || (['正官', '七杀', '正印', '偏印'].indexOf(n.shishen) !== -1 && n.score >= 18);
            if (career) {
                tags.push('career');
                notes.push(yunStart ? '大运交接，事业轨道切换' : '事业动能增强，宜争取资源与位置');
            }
            var tombReasons = tombOpenInfo(chart.tombs, n.zhi);
            var wealth = tombReasons.length > 0
                || (n.zhiWx === WX_KE[chart.dayWx] && n.score >= 15)
                || (['正财', '偏财'].indexOf(n.shishen) !== -1 && n.score >= 15);
            if (wealth) {
                tags.push('wealth');
                notes.push(tombReasons.length ? tombReasons[0] + '，财库引动' : '财星得势，利回款、签约与资产兑现');
            }
            var love = family.marriage.windows.some(function (w) { return w.year === n.year; });
            var loveCrisis = family.marriage.crisis.some(function (w) { return w.year === n.year; });
            if (love) {
                tags.push('love');
                notes.push('引动夫妻宫，正缘/婚恋信号增强');
            }
            var risk = n.score <= -25 || loveCrisis
                || n.notes.some(function (x) { return x.indexOf('天克地冲') !== -1 || x.indexOf('岁运并临') !== -1; });
            if (risk) {
                tags.push('risk');
                notes.push(loveCrisis ? '感情磨合或边界冲突，宜沟通与留白' : '变动与压力并存，宜守成、避冲撞');
            }
            if (!tags.length) {
                tags.push('stable');
                notes.push('平稳蓄力年，宜积累专业、健康与现金流');
            }
            return {
                year: n.year, ganzhi: n.ganzhi, age: n.age, dayun: n.dayunGanzhi,
                score: n.score, level: n.level, stars: n.stars,
                tags: tags, note: uniq(notes).slice(0, 2).join('；')
            };
        });

        /* 窗口取未来年份；历史流年保留在 rows 中供复盘回测 */
        var futureRows = rows.filter(function (r) { return r.year >= nowYear; });
        var pool = futureRows.length ? futureRows : rows;
        var careerBest = pool.filter(function (r) { return r.tags.indexOf('career') !== -1; })
            .sort(function (a, b) { return b.score - a.score; })[0];
        var wealthBest = pool.filter(function (r) { return r.tags.indexOf('wealth') !== -1; })
            .sort(function (a, b) { return b.score - a.score; })[0];
        var caution = pool.filter(function (r) { return r.tags.indexOf('risk') !== -1; })
            .sort(function (a, b) { return a.score - b.score; })[0];
        var loveBest = pool.filter(function (r) { return r.tags.indexOf('love') !== -1; })
            .sort(function (a, b) { return b.score - a.score; })[0];

        /* 应期年月联动：关键窗口年份下钻到流月，取最应事的三个月 */
        function monthsFor(year, wantHigh) {
            if (!year) return [];
            var ly = computeLiuYue(chart, model, yongshen, strength, dayun, year);
            return ly.list.slice().sort(function (a, b) {
                return wantHigh ? b.score - a.score : a.score - b.score;
            }).slice(0, 3).map(function (m) {
                return {
                    month: m.month, ganzhi: m.ganzhi, jieqi: m.jieqi,
                    start: m.start, end: m.end, score: m.score, level: m.level,
                    note: m.notes[0] || ''
                };
            });
        }
        if (careerBest) careerBest.months = monthsFor(careerBest.year, true);
        if (wealthBest) wealthBest.months = monthsFor(wealthBest.year, true);
        if (loveBest) loveBest.months = monthsFor(loveBest.year, true);
        if (caution) caution.months = monthsFor(caution.year, false);

        function monthText(win, verb) {
            if (!win || !win.months || !win.months.length) return '';
            return verb + win.months.map(function (m) {
                return m.month + '（' + m.ganzhi + '，' + m.jieqi + '起）';
            }).join('、') + '；';
        }

        var summary = (careerBest ? '事业跃升窗口：' + careerBest.year + '年（' + careerBest.ganzhi + '），' + monthText(careerBest, '应期在') : '')
            + (wealthBest ? '财富丰收/开库窗口：' + wealthBest.year + '年（' + wealthBest.ganzhi + '），' + monthText(wealthBest, '应期在') : '')
            + (loveBest ? '婚恋喜庆窗口：' + loveBest.year + '年，' + monthText(loveBest, '应期在') : '')
            + (caution ? '重点防守：' + caution.year + '年（' + caution.ganzhi + '，' + caution.level + '），' + monthText(caution, '尤须留意') + caution.note + '。' : '未来十年整体节奏平稳，宜按部就班积累。');

        return {
            outerGods: visibleGods,
            innerGods: innerGods,
            outerText: outerText,
            innerText: innerText,
            contrastText: contrastText,
            traits: {
                outer: visibleGods.map(function (n) { return GOD_TRAIT[n] ? GOD_TRAIT[n].out : ''; }).filter(Boolean),
                inside: innerGods.map(function (n) { return GOD_TRAIT[n] ? GOD_TRAIT[n].inside : ''; }).filter(Boolean)
            },
            rows: rows,
            summary: summary,
            windows: { career: careerBest, wealth: wealthBest, love: loveBest, caution: caution }
        };
    }

    /* ---------------------------------------------------------------------
     * 15. 双人合盘 · 五维加权
     * ------------------------------------------------------------------- */
    var ROLE_INFO = {
        pioneer: {
            name: '前端开拓 / 技术产品',
            desc: '负责获客、产品、内容、渠道与技术交付，适合对外冲锋、定义方向。'
        },
        manager: {
            name: '内部管理 / 风控合规',
            desc: '负责组织、制度、交付质量与风险控制，适合对内定盘、守住底线。'
        },
        keeper: {
            name: '管账守财 / 现金流',
            desc: '负责财务、合同、库存与资产安全，适合守住利润、控制节奏。'
        }
    };

    function roleProfile(report) {
        var gp = godPctMap(report.chart);
        var tombCount = (report.chart.tombs && report.chart.tombs.list
            ? report.chart.tombs.list.filter(function (t) { return t.type === '财库'; }).length : 0);
        var scores = {
            pioneer: gp.pct['食神'] + gp.pct['伤官'] + gp.pct['偏财'] * 0.7,
            manager: gp.pct['正官'] + gp.pct['七杀'] + gp.pct['正印'] + gp.pct['偏印'] * 0.6,
            keeper: gp.pct['正财'] + gp.pct['正印'] * 0.3 + tombCount * 7
        };
        var order = Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; });
        return {
            primary: order[0],
            secondary: order[1],
            scores: scores,
            roleName: ROLE_INFO[order[0]].name,
            secondaryName: ROLE_INFO[order[1]].name,
            desc: ROLE_INFO[order[0]].desc
        };
    }

    function strongElements(report) {
        var dist = {};
        WX.forEach(function (el) { dist[el] = elementPct(report.model, el); });
        var sorted = WX.slice().sort(function (a, b) { return dist[b] - dist[a]; });
        var strong = sorted.filter(function (el) { return dist[el] >= 15; }).slice(0, 3);
        if (!strong.length) strong = sorted.slice(0, 2);
        return strong;
    }

    function computeSynastry(reportA, reportB, mode) {
        var A = reportA, B = reportB;
        var marriage = mode === 'marriage';
        var modeText = marriage ? '双人合婚合盘' : '事业合伙合盘';
        var nameA = A.meta.name || '甲方';
        var nameB = B.meta.name || '乙方';
        var favA = A.yongshen.favorable.slice();
        var favB = B.yongshen.favorable.slice();
        var unfavA = A.yongshen.unfavorable.slice();
        var unfavB = B.yongshen.unfavorable.slice();
        var strongA = strongElements(A);
        var strongB = strongElements(B);
        var aw = A.chart.dayWx, bw = B.chart.dayWx;

        /* 1. 五行喜忌互补度 30 */
        var d1 = 50;
        var supplyToA = strongB.filter(function (el) { return favA.indexOf(el) !== -1; });
        var supplyToB = strongA.filter(function (el) { return favB.indexOf(el) !== -1; });
        var crossClash = strongA.filter(function (el) { return unfavB.indexOf(el) !== -1; })
            .concat(strongB.filter(function (el) { return unfavA.indexOf(el) !== -1; }));
        d1 += supplyToA.length * 13 + supplyToB.length * 13;
        d1 -= crossClash.length * 9;
        if (WX_SHENG[aw] === bw || WX_SHENG[bw] === aw) d1 += 6;
        else if (aw === bw) d1 += 2;
        else d1 -= 5;
        if (favA.indexOf(bw) !== -1) d1 += 8;
        if (favB.indexOf(aw) !== -1) d1 += 8;

        /* 年命纳音生克（古法合婚以年柱纳音为根基） */
        var nayinA = A.pillars[0].nayin, nayinB = B.pillars[0].nayin;
        var nyWxA = nayinA.charAt(nayinA.length - 1), nyWxB = nayinB.charAt(nayinB.length - 1);
        var nayinRel = '', nayinNote = '';
        if (nyWxA === nyWxB) {
            d1 += 5; nayinRel = '比和';
            nayinNote = '年命纳音' + nayinA + '／' + nayinB + '比和，同气相求，根基相投';
        } else if (WX_SHENG[nyWxA] === nyWxB || WX_SHENG[nyWxB] === nyWxA) {
            d1 += 8; nayinRel = '相生';
            nayinNote = '年命纳音' + nayinA + '／' + nayinB + '相生，古法谓“根基互养”，家世与早年环境易相容';
        } else {
            nayinRel = '相克';
            if (marriage && A.meta.gender === 'male' && B.meta.gender === 'female' && WX_KE[nyWxA] === nyWxB) {
                d1 -= 3;
                nayinNote = '年命纳音' + nayinA + '／' + nayinB + '相克，男命克女命古法不忌，仍主男方主导，宜尊重女方节奏';
            } else if (marriage && A.meta.gender === 'female' && B.meta.gender === 'male' && WX_KE[nyWxA] === nyWxB) {
                d1 -= 8;
                nayinNote = '年命纳音' + nayinA + '／' + nayinB + '相克，女命克男命古法谓“根基有磨”，原生家庭观念差异需提前沟通';
            } else {
                d1 -= 6;
                nayinNote = '年命纳音' + nayinA + '／' + nayinB + '相克，根基有磨，原生家庭观念与处事底色差异需提前沟通';
            }
        }
        d1 = clamp(d1, 0, 100);

        var d1Text = 'A喜' + favA.join('、') + '，B的强势五行在' + strongB.join('、') + '；B喜' + favB.join('、')
            + '，A的强势五行在' + strongA.join('、') + '。'
            + nayinNote + '。'
            + (supplyToA.length && supplyToB.length
                ? '双向补给：B的' + supplyToA.join('、') + '补A所需，A的' + supplyToB.join('、') + '回补B，属于互相成就型。'
                : (supplyToA.length || supplyToB.length
                    ? '单向补给：' + (supplyToA.length ? 'B补A较多' : 'A补B较多') + '，受益方要主动回馈，避免关系失衡。'
                    : '双方喜用交集较少，天然互补有限，更需靠沟通、边界与共同目标经营。'))
            + (crossClash.length
                ? ' 需注意：' + uniq(crossClash).join('、') + '落在对方忌神，长期相处要控制相关生活方式与决策节奏。'
                : ' 双方强势五行未明显踩中对方忌神，相处阻力较小。');

        /* 2. 寒暖燥湿调候中和度 15 */
        var avgWarm = (A.tiaohou.warmth + B.tiaohou.warmth) / 2;
        var avgDry = (A.tiaohou.dryness + B.tiaohou.dryness) / 2;
        var warmScore = clamp(100 - Math.abs(avgWarm - 50) * 1.7, 0, 100);
        var dryScore = clamp(100 - Math.abs(avgDry - 50) * 1.35, 0, 100);
        var d2 = warmScore * 0.62 + dryScore * 0.38;
        var climateComplement = (A.tiaohou.mode === 'dry-hot' && B.tiaohou.mode === 'cold-wet')
            || (A.tiaohou.mode === 'cold-wet' && B.tiaohou.mode === 'dry-hot');
        if (climateComplement) d2 += 8;
        else if (A.tiaohou.mode && A.tiaohou.mode === B.tiaohou.mode) d2 -= 10;
        d2 = clamp(d2, 0, 100);
        var d2Text = 'A寒暖 ' + A.tiaohou.warmth + ' / 燥湿 ' + A.tiaohou.dryness
            + '，B寒暖 ' + B.tiaohou.warmth + ' / 燥湿 ' + B.tiaohou.dryness
            + '；合并寒暖 ' + round1(avgWarm) + '、燥湿 ' + round1(avgDry) + '。'
            + (climateComplement
                ? '一燥一寒、互为调候，属“水火既济、冷暖相宜”的组合，生活环境与情绪节奏容易互相校准。'
                : (A.tiaohou.mode && A.tiaohou.mode === B.tiaohou.mode
                    ? '两人气候同向叠加：' + (A.tiaohou.mode === 'dry-hot' ? '同燥同热，易一起急躁、上火，需主动增加水润与留白。' : '同寒同湿，易一起低沉、拖延，需主动增加阳光、运动与社交。')
                    : '寒暖燥湿整体居中，无明显互补也无明显冲突，靠共同生活习惯微调即可。'));

        /* 3. 四柱星宫干支耦合度 30 */
        var pillarWeight = { year: 0.7, month: 0.95, day: 1.55, hour: 0.7 };
        var stemPoints = { 五合: 6, 相生: 3.5, 比和: 2, 相冲: -5, 相克: -2 };
        var branchPoints = { 六合: 7, 半合: 5.5, 同气: 2.5, 暗合: 3.5, 六冲: -6, 相刑: -4.5, 自刑: -4.5, 六害: -3.5 };
        var raw3 = 0;
        var d3Details = [];
        var dayStemRel = '', dayBranchRel = '';
        for (var i = 0; i < 4; i++) {
            var pa = A.pillars[i], pb = B.pillars[i];
            if (pa.unknown || pb.unknown) { d3Details.push(pa.name + '：一方时辰未知，本柱从略'); continue; }
            var sr = stemPairRelation(pa.gan, pb.gan);
            var br = branchPairRelation(pa.zhi, pb.zhi);
            var w = pillarWeight[pa.key] || 0.8;
            raw3 += ((stemPoints[sr] || 0) + (branchPoints[br] || 0)) * w;
            d3Details.push(pa.name + '：天干' + pa.gan + '/' + pb.gan + '（' + (sr || '无特殊关系') + '），地支'
                + pa.zhi + '/' + pb.zhi + '（' + (br || '无特殊关系') + '）');
            if (pa.key === 'day') { dayStemRel = sr; dayBranchRel = br; }
        }
        var d3 = clamp(58 + raw3 * 1.45, 0, 100);
        var dayHighlight = '';
        if (dayStemRel === '五合' && (dayBranchRel === '六合' || dayBranchRel === '半合')) {
            dayHighlight = marriage
                ? '日干五合 + 日支' + dayBranchRel + '：灵魂与夫妻宫双重契合，默契、吸引力与生活节奏都容易同频。'
                : '日干五合 + 日支' + dayBranchRel + '：日主与工作节奏高度同频，沟通成本低，适合长期并肩。';
        } else if (dayBranchRel === '六冲' || dayBranchRel === '相刑' || dayBranchRel === '自刑') {
            dayHighlight = marriage
                ? '日支' + dayBranchRel + '：生活习惯与亲密边界易起冲突，需聚少离多或分权相处，重要决定避开情绪高峰。'
                : '日支' + dayBranchRel + '：工作习惯与决策边界易冲突，宜分权、分时区、分职责，设固定复盘机制。';
        } else if (dayStemRel === '五合' || dayStemRel === '相生') {
            dayHighlight = '日干' + dayStemRel + '：底层价值观与表达方式较易互相理解，冲突后修复速度快。';
        } else if (dayBranchRel === '六合' || dayBranchRel === '半合' || dayBranchRel === '暗合') {
            dayHighlight = '日支' + dayBranchRel + '：生活/工作节奏有天然默契，暗合之处也需防“默契变默认”。';
        } else {
            dayHighlight = '日柱无强合冲：关系基础中性，长期走向更多取决于沟通方式与共同目标。';
        }
        var d3Text = '逐柱比对：' + d3Details.join('；') + '。' + dayHighlight;

        /* 4. 十神心性与做功角色配合 15 */
        var roleA = roleProfile(A);
        var roleB = roleProfile(B);
        var gpA = godPctMap(A.chart);
        var gpB = godPctMap(B.chart);
        var d4Details = [];
        var d4Risks = [];
        var d4 = marriage ? 60 : 58;

        if (marriage) {
            var aSpouseEl = A.meta.gender === 'male' ? WX_KE[A.chart.dayWx] : WX_KE_BY[A.chart.dayWx];
            var bSpouseEl = B.meta.gender === 'male' ? WX_KE[B.chart.dayWx] : WX_KE_BY[B.chart.dayWx];
            if (B.chart.dayWx === aSpouseEl) {
                d4 += 10;
                d4Details.push(nameB + '日主' + B.chart.dayGan + B.chart.dayWx + '正是' + nameA + '的配偶星五行，天然具吸引力');
            }
            if (A.chart.dayWx === bSpouseEl) {
                d4 += 10;
                d4Details.push(nameA + '日主' + A.chart.dayGan + A.chart.dayWx + '正是' + nameB + '的配偶星五行，彼此吸引');
            }
            if (favA.indexOf(B.chart.dayWx) !== -1 || favB.indexOf(A.chart.dayWx) !== -1) {
                d4 += 6;
                d4Details.push('至少一方日主为另一方喜用，相处有滋养感');
            }
            var aShang = gpA.pct['伤官'], bGuan = gpB.pct['正官'];
            var bShang = gpB.pct['伤官'], aGuan = gpA.pct['正官'];
            if (A.meta.gender === 'female' && aShang >= 18 && bGuan >= 12) {
                d4 -= 14;
                d4Risks.push(nameA + '伤官偏旺而' + nameB + '正官有根，女命锋芒易压男命规则感，需减少否定式表达');
            }
            if (B.meta.gender === 'female' && bShang >= 18 && aGuan >= 12) {
                d4 -= 14;
                d4Risks.push(nameB + '伤官偏旺而' + nameA + '正官有根，女方表达锋利，男方宜先听后辩');
            }
            if (gpA.groups.比劫 >= 20 && gpB.groups.比劫 >= 20) {
                d4 -= 12;
                d4Risks.push('双方比劫皆旺，容易“硬碰硬”与争夺主导权，财务与家务边界要提前约定');
            }
            if (gpA.groups.印星 >= 25 && gpB.groups.印星 >= 25) {
                d4 -= 6;
                d4Risks.push('双方印星皆重，容易互相猜测、内耗而不直说，需建立“事实优先”的沟通规则');
            }
            d4Details.push('相处角色：' + nameA + '偏' + roleA.roleName + '，' + nameB + '偏' + roleB.roleName);
        } else {
            if (roleA.primary !== roleB.primary) {
                d4 += 18;
                d4Details.push(nameA + '偏' + roleA.roleName + '，' + nameB + '偏' + roleB.roleName + '，职责天然互补');
            } else {
                d4 -= 8;
                d4Risks.push('两人主角色同为“' + ROLE_INFO[roleA.primary].name + '”，优势叠加但盲区重合，需明确谁对最终结果负责');
            }
            if (roleA.secondary !== roleB.secondary) {
                d4 += 5;
                d4Details.push('第二角色互补：' + roleA.secondaryName + ' / ' + roleB.secondaryName);
            }
            var hasKeeper = roleA.primary === 'keeper' || roleB.primary === 'keeper'
                || roleA.secondary === 'keeper' || roleB.secondary === 'keeper';
            if (!hasKeeper) {
                d4 -= 8;
                d4Risks.push('双方均不偏向“管账守财”，需单独指定财务负责人并设置对账机制');
            }
            if (gpA.groups.比劫 >= 20 && gpB.groups.比劫 >= 20) {
                d4 -= 10;
                d4Risks.push('双方比劫皆旺，股权与决策权易争，建议 50:50 起盘 + 明确一票否决事项');
            }
            if (gpA.groups.官杀 >= 26 && gpB.groups.官杀 >= 26) {
                d4 -= 6;
                d4Risks.push('双方官杀皆重，都想定规则，需划分“谁主外、谁主内”');
            }
            if (gpA.groups.食伤 >= 26 && gpB.groups.食伤 >= 26) {
                d4 -= 4;
                d4Risks.push('双方食伤皆旺，点子多而落地易分散，需设项目止损线');
            }
            d4Details.push('建议分工：' + nameA + '主' + roleA.roleName + '，' + nameB + '主' + roleB.roleName);
        }
        d4 = clamp(d4, 0, 100);
        var d4Text = d4Details.join('；') + '。'
            + (d4Risks.length ? '风险提示：' + d4Risks.join('；') + '。' : '十神心性未见结构性冲突，按角色分工即可。');

        /* 5. 未来十年岁运同步 10 */
        var mapA = {}, mapB = {};
        A.liunian.forEach(function (n) { mapA[n.year] = n; });
        B.liunian.forEach(function (n) { mapB[n.year] = n; });
        var currentYear = bjDate(Date.now()).getUTCFullYear();
        var syncYears = [];
        var goodCount = 0, badCount = 0;
        for (var y = currentYear; y < currentYear + 10; y++) {
            var na = mapA[y], nb = mapB[y];
            var sa = na ? na.score : 0, sb = nb ? nb.score : 0;
            var state, key;
            if (sa >= 15 && sb >= 15) { state = '同吉共振'; key = 'good'; goodCount++; }
            else if ((sa >= 15 && sb < 0) || (sb >= 15 && sa < 0)) { state = '互补托底'; key = 'good'; goodCount++; }
            else if (sa <= -10 && sb <= -10) { state = '双冲磨合预警'; key = 'bad'; badCount++; }
            else if (sa <= -20 || sb <= -20) { state = '一方承压'; key = 'mid'; }
            else { state = '平稳过渡'; key = 'mid'; }

            var syncNote = '';
            if (na && na.notes && na.notes.length) syncNote = na.notes[0];
            if (marriage) {
                var aDayRel = na ? branchPairRelation(na.zhi, A.chart.dayZhi) : '';
                var bDayRel = nb ? branchPairRelation(nb.zhi, B.chart.dayZhi) : '';
                if (aDayRel === '六冲' || aDayRel === '相刑' || aDayRel === '自刑'
                    || bDayRel === '六冲' || bDayRel === '相刑' || bDayRel === '自刑') {
                    syncNote = (syncNote ? syncNote + '；' : '') + '流年引动夫妻宫，注意婚恋磨合与边界';
                }
            } else {
                if (na && ['正官', '七杀'].indexOf(na.shishen) !== -1 && nb && ['伤官', '食神'].indexOf(nb.shishen) !== -1) {
                    syncNote = (syncNote ? syncNote + '；' : '') + '一人主规则、一人主创意，宜先定决策流程';
                }
            }
            syncYears.push({
                year: y,
                ganzhiA: na ? na.ganzhi : '—',
                ganzhiB: nb ? nb.ganzhi : '—',
                ageA: na ? na.age : '',
                ageB: nb ? nb.age : '',
                scoreA: sa,
                scoreB: sb,
                levelA: na ? na.level : '—',
                levelB: nb ? nb.level : '—',
                state: state,
                key: key,
                note: syncNote || '岁运平稳，按既定节奏推进'
            });
        }
        var d5 = clamp(50 + goodCount * 7 - badCount * 9, 0, 100);
        var d5Text = '未来十年中，同吉共振/互补托底 ' + goodCount + ' 年，双冲磨合预警 ' + badCount + ' 年。'
            + (badCount === 0
                ? '整体岁运同步度较高，适合共同推进长期计划。'
                : '预警年份宜降低重大决策密度，先处理情绪与边界，再谈扩张。');

        var dims = [
            {
                key: 'elements', name: '五行喜忌互补度', short: '五行互补', weight: 30, score: round1(d1),
                text: d1Text,
                advice: d1 >= 65 ? '保持“互相补给”的良性循环，受益方主动回馈。' : '减少把对方当“资源提供者”的期待，先建立各自稳定的能量来源。'
            },
            {
                key: 'climate', name: '寒暖燥湿中和度', short: '调候中和', weight: 15, score: round1(d2),
                text: d2Text,
                advice: d2 >= 65 ? '共同生活环境保持中庸，季节变化时互相提醒调候。' : '居家与工位避免同一种极端气候，主动增加互补元素与户外活动。'
            },
            {
                key: 'pillars', name: '四柱星宫耦合度', short: '星宫耦合', weight: 30, score: round1(d3),
                text: d3Text,
                advice: d3 >= 65 ? '日柱与四柱耦合良好，适合长期并肩；仍要保留各自空间。' : '用制度补默契：固定沟通时段、分权清单与冲突暂停机制。'
            },
            {
                key: 'gods', name: '十神心性与做功角色', short: '角色配合', weight: 15, score: round1(d4),
                text: d4Text,
                advice: d4 >= 65 ? '角色分工清晰，按各自强项承担结果即可。' : '先定角色、再谈感情/股权；把“谁负责、谁拍板、谁对账”写清楚。'
            },
            {
                key: 'sync', name: '未来十年岁运同步', short: '岁运共振', weight: 10, score: round1(d5),
                text: d5Text,
                advice: d5 >= 65 ? '同步度高，可共同规划长期目标。' : '重大投资、婚期与扩张避开双方同时低分的年份。'
            }
        ];

        var total = 0;
        dims.forEach(function (d) { total += d.score * d.weight / 100; });
        total = round1(total);

        var grade, gradeKey;
        if (total >= 86) { grade = marriage ? '天作之合' : '黄金搭档'; gradeKey = 'good'; }
        else if (total >= 76) { grade = '上佳契合'; gradeKey = 'good'; }
        else if (total >= 66) { grade = '良好匹配'; gradeKey = 'good'; }
        else if (total >= 56) { grade = '中等磨合'; gradeKey = 'mid'; }
        else { grade = '需谨慎经营'; gradeKey = 'bad'; }

        var strongest = dims.slice().sort(function (a, b) { return b.score - a.score; })[0];
        var weakest = dims.slice().sort(function (a, b) { return a.score - b.score; })[0];
        var summary = '综合得分 ' + total + '，判为“' + grade + '”。最强项在' + strongest.name + '（' + strongest.score
            + '），' + strongest.advice + '最需经营的是' + weakest.name + '（' + weakest.score + '），' + weakest.advice;

        var advice = [];
        if (marriage) {
            advice.push('把“日支' + dayBranchRel + '”当作相处说明书：' + (dayBranchRel === '六冲' || dayBranchRel === '相刑' || dayBranchRel === '自刑'
                ? '保留各自空间、聚少离多或分权相处，反而比黏在一起更稳。'
                : '默契是资产，但别把默契当默认，重要需求仍要说出口。'));
            advice.push('金钱与原生家庭边界前置：婚前/同居前把债务、赡养、消费观与居住安排谈清楚。');
            advice.push('冲突处理遵循“先降燥/祛湿，再讲道理”：情绪高峰不做分手、投资与搬家决定。');
            advice.push('用共同目标替代互相改造：一起做一件需要协作的事，比反复沟通更能校准关系。');
        } else {
            advice.push('分工按“' + roleA.roleName + ' / ' + roleB.roleName + '”落地，写成岗位说明书，而不是靠默契。');
            advice.push('股权建议 50:50 起盘 + 动态调整：按出资、客户、交付、管理四因子年度复盘；一方主导经营可 55:45。');
            advice.push('设一票否决清单：对外担保、重大采购、核心人事、增资稀释，必须双方书面同意。');
            advice.push('每月固定对账与复盘：现金流、应收账款、库存与项目止损线，用数据而不是情绪决策。');
        }
        var risks = d4Risks.slice(0, 3);
        if (!risks.length) {
            risks.push('未发现结构性十神冲突，仍需在金钱、边界与决策权上保持透明。');
        }
        if (crossClash.length) risks.push('五行层面：' + uniq(crossClash).join('、') + '为对方忌神，长期相处需控制相关生活方式。');
        if (d5 < 55) risks.push('岁运层面：未来十年同步度偏低，重大决定避开双方同时承压的年份。');

        var chartBrief = function (report) {
            return {
                name: report.meta.name || '未命名',
                genderText: report.meta.genderText,
                pillars: report.pillars.map(function (p) { return p.ganzhi; }),
                dayGan: report.chart.dayGan,
                dayWx: report.chart.dayWx,
                strength: report.strength.status,
                ratio: report.strength.ratio,
                geju: report.geju.name,
                yongshen: report.yongshen.favorableText,
                tiaohou: report.tiaohou.primary || '无',
                climate: '寒暖 ' + report.tiaohou.warmth + ' / 燥湿 ' + report.tiaohou.dryness
            };
        };

        return {
            mode: mode,
            modeText: modeText,
            score: total,
            grade: grade,
            gradeKey: gradeKey,
            dims: dims,
            nameA: nameA,
            nameB: nameB,
            charts: { a: chartBrief(A), b: chartBrief(B) },
            roles: {
                a: { primary: roleA.primary, name: roleA.roleName, secondary: roleA.secondaryName, desc: roleA.desc },
                b: { primary: roleB.primary, name: roleB.roleName, secondary: roleB.secondaryName, desc: roleB.desc }
            },
            dayHighlight: dayHighlight,
            advice: advice,
            risks: risks,
            yearSync: syncYears,
            summary: summary
        };
    }

    /* ---------------------------------------------------------------------
     * 11. 开运建议
     * ------------------------------------------------------------------- */
    function computeAdvice(chart, model, strength, geju, yongshen, tiaohou, dayun, liunian, flow, disease, palaces, tombs) {
        var primary = yongshen.primary;
        var secondary = yongshen.secondary;
        var unfav = yongshen.unfavorable;
        var mainEl = chart.dayWx;
        var pInfo = ELEM_INFO[primary] || ELEM_INFO[mainEl];
        var sInfo = secondary ? ELEM_INFO[secondary] : null;
        var uInfo = unfav.length ? ELEM_INFO[unfav[0]] : null;
        var currentYun = dayun.list.filter(function (x) { return x.isCurrent; })[0];
        var currentNian = liunian.filter(function (x) { return x.isCurrent; })[0];
        var nextNian = liunian.filter(function (x) { return x.year === (currentNian ? currentNian.year + 1 : 0); })[0];
        var strongest = model.strongest[0];
        var weakest = model.weakest[0];
        var wealthEl = WX_KE[mainEl];
        var wealthFav = yongshen.favorable.indexOf(wealthEl) !== -1;
        var advice = [];

        var success = geju.success || { status: '成格（待运）', reason: '' };
        var combos = flow.patterns.filter(function (p) { return p.type === '成'; }).map(function (p) { return p.name; });
        var breaks = flow.patterns.filter(function (p) { return p.type === '破'; }).map(function (p) { return p.name; });
        var career = '命取' + geju.name + '，' + success.status + '：' + success.reason + '。'
            + (combos.length ? '做功路径为' + combos.join('、') + '，' : '')
            + (breaks.length ? '须防' + breaks.join('、') + '反噬，' : '')
            + '事业宜取' + pInfo.industry + (sInfo ? '；兼取' + sInfo.industry : '') + '。'
            + (uInfo ? '少在' + uInfo.industry + '中做长期重仓。' : '')
            + (currentYun ? '当前' + currentYun.ganzhi + '大运（' + currentYun.level + '，' + currentYun.score + '分），'
                + (currentYun.levelKey === 'good' ? '可稳步扩张、争取主导权。' : (currentYun.levelKey === 'mid' ? '以优化结构为主，不宜盲目加杠杆。' : '宜守成、修内功，少做高风险决策。')) : '');
        advice.push({ kicker: '格局做功 · 事业', title: '先立主线，再谈扩张', body: career });

        var wealthTypes = [];
        if (tombs && tombs.list.length) {
            tombs.list.forEach(function (t) {
                wealthTypes.push(t.pillarName + t.zhi + t.type + (t.openYears.length ? '（' + t.openYears.map(function (x) { return x.year; }).join('、') + '年开库）' : '（库门未开）'));
            });
        }
        var wealth = '日主' + chart.dayGan + chart.dayWx + '以' + wealthEl + '为财，财星'
            + (wealthFav ? '为喜用，适合以专业能力换取稳定现金流，再逐步扩大可复制收入。' : '非首选，比劫或印星偏重时更忌合伙分财与情绪化消费，宜先立专业壁垒。')
            + (wealthTypes.length ? '墓库结构：' + wealthTypes.join('；') + '。开财库之年可盘活旧资源、收款或资产重组，但忌一次性押注。' : '原局无财库，财务以现金流管理为主。')
            + (disease.primary && disease.primary.diseaseElements.indexOf(wealthEl) !== -1 ? '财星同时为病神，见好即收，忌用杠杆放大。' : '');
        advice.push({ kicker: '财富结构 · 墓库', title: '让钱有来路，也有归处', body: wealth });

        var spouseTiming = liunian.filter(function (n) {
            return n.notes.some(function (x) {
                return x.indexOf('夫妻宫') !== -1 || x.indexOf('红鸾') !== -1 || x.indexOf('天喜') !== -1 || x.indexOf('桃花') !== -1;
            });
        }).slice(0, 3);
        var spouse = (palaces ? palaces.spouseText : '') + ' '
            + (spouseTiming.length
                ? '近运触发：' + spouseTiming.map(function (n) {
                    return n.year + '年' + n.ganzhi + '（' + n.level + '）';
                }).join('、') + '，婚恋、居所或合作契约易有阶段变化，宜提前沟通边界。'
                : '近十年夫妻宫无强冲合，感情以稳定经营为主。')
            + (tiaohou.mode === 'dry-hot' ? '原局燥热，亲密关系中忌急躁与说教，降温、倾听比争胜更重要。' : '')
            + (tiaohou.mode === 'cold-wet' ? '原局偏寒，关系中宜主动表达温度，避免长期冷战。' : '');
        advice.push({ kicker: '夫妻宫 · 婚恋', title: '亲密关系也是用神', body: spouse });

        var recent = '';
        if (currentNian) {
            recent += currentNian.year + '年' + currentNian.ganzhi + '（' + currentNian.level + '，' + currentNian.score + '分）：'
                + currentNian.notes.slice(0, 3).join('；') + '。';
        }
        if (nextNian) {
            recent += ' ' + nextNian.year + '年' + nextNian.ganzhi + '（' + nextNian.level + '，' + nextNian.score + '分）：'
                + nextNian.notes.slice(0, 3).join('；') + '。';
        }
        if (currentYun) {
            recent += ' 大运' + currentYun.ganzhi + '以地支' + currentYun.zhi + '（' + currentYun.zhiWx + '）为主（65%），'
                + (currentYun.levelKey === 'bad' ? '忌神当运，先保现金流与健康。' : '喜用得气时可主动布局，但留足回撤空间。');
        }
        advice.push({ kicker: '近期岁运 · 避坑', title: '今年与明年，先避大坑', body: recent || '近运平稳，按既定节奏推进。' });

        var health = '寒暖 ' + tiaohou.warmth + '（' + tiaohou.warmthLabel + '），燥湿 ' + tiaohou.dryness + '（' + tiaohou.drynessLabel + '）。'
            + '五行最旺为' + strongest + '，' + ELEM_INFO[strongest].health + '易受压力影响；'
            + '最弱为' + weakest + '，' + ELEM_INFO[weakest].health + '需重点养护。'
            + (tiaohou.mode === 'dry-hot'
                ? '夏燥之局尤忌熬夜、辛辣、酒精与情绪上火；宜早睡、足量饮水、舒缓有氧，酉时后减少高强度工作。'
                : (tiaohou.mode === 'cold-wet'
                    ? '冬寒之局宜保暖、晒太阳、规律作息与下肢循环，少食生冷；早晨见光有助于稳定情绪。'
                    : '气候未至偏极，重点在规律作息与五行流通，忌长期单一姿势与情绪压抑。'))
            + (disease.primary ? '病药提示：' + disease.primary.name + '，可优先用' + disease.primary.medicine + '对应的生活方式做日常调理。' : '');
        advice.push({ kicker: '五脏调候 · 作息', title: '把身体调成“喜用”的环境', body: health });

        var tombDir = '';
        if (tombs && tombs.list.length) {
            tombDir = '四库方位：' + tombs.list.map(function (t) { return t.zhi + '（' + t.type + '·' + t.element + '）'; }).join('、') + '；开库之年再动相关资产。';
        }
        var direction = '有利方位：' + pInfo.dir + '；有利色系：' + pInfo.color + '。'
            + (sInfo ? '次选' + sInfo.dir + '、' + sInfo.color + '。' : '')
            + (uInfo ? '少长期停留在' + uInfo.dir + '的强刺激环境，居家与工位避免' + uInfo.color + '大面积堆叠。' : '')
            + tombDir
            + (currentNian ? ' ' + currentNian.year + '年可把重要谈判、签约安排在' + pInfo.dir + '或' + (sInfo ? sInfo.dir : pInfo.dir) + '。' : '');
        advice.push({ kicker: '地理方位 · 环境', title: '让空间替你补气', body: direction });

        return advice;
    }

    /* ---------------------------------------------------------------------
     * 12. 报告组装
     * ------------------------------------------------------------------- */
    function buildReport(input) {
        var birth = input;
        P = defaultParams();
        if (input.params) {
            for (var pk in input.params) {
                if (Object.prototype.hasOwnProperty.call(P, pk) && typeof input.params[pk] === 'number' && isFinite(input.params[pk])) {
                    P[pk] = input.params[pk];
                }
            }
        }
        var chart = buildChart(birth, input.gender, input.name);
        var model = computePower(chart);
        var strength = computeStrength(chart, model);
        var geju = determineGeju(chart, model, strength);
        var tiaohou = computeTiaohou(chart, model);
        var flow = computeFlow(chart, model, strength, geju, tiaohou);
        var disease = detectDisease(chart, model, strength, geju, tiaohou, flow);
        geju.success = flow.gejuSuccess;
        var yongshen = computeYongShen(chart, model, strength, geju, tiaohou, flow, disease);
        var tenGods = computeTenGods(chart, model);
        var shensha = computeShenSha(chart);
        chart.pillars.forEach(function (p) { p.shensha = shensha.byPillar[p.key] || []; });
        var palaces = computePalaces(chart, model, yongshen);
        var tombs = computeTombs(chart, model, yongshen);
        chart.tombs = tombs;
        var dayun = computeDaYun(chart, model, yongshen, strength);
        var liunian = computeLiuNian(chart, model, yongshen, strength, dayun);
        annotateTombs(tombs, dayun, liunian);
        var liuyue = computeLiuYue(chart, model, yongshen, strength, dayun);
        var fuyin = detectFuyin(chart);
        var xiaoyun = computeXiaoYun(chart, dayun);
        var career = computeCareerWealth(chart, model, strength, geju, yongshen, flow, disease, dayun, liunian, tombs);
        var family = computeFamily(chart, model, strength, yongshen, dayun, liunian, palaces, tombs);
        var health = computeHealth(chart, model, strength, geju, tiaohou, disease, yongshen, liunian);
        var milestones = computeMilestones(chart, model, strength, geju, yongshen, dayun, liunian, flow, disease, family);
        var advice = computeAdvice(chart, model, strength, geju, yongshen, tiaohou, dayun, liunian, flow, disease, palaces, tombs);

        var narrative = strength.summary
            + '命取' + geju.name + '，' + geju.description.replace(/^[^：]+：/, '')
            + '格局' + geju.success.status + '。'
            + flow.text
            + yongshen.principle
            + tiaohou.description;

        return {
            meta: {
                name: chart.name,
                gender: chart.gender,
                genderText: chart.genderText,
                birthDate: birth.dateText,
                birthTime: birth.timeText,
                weekday: '星期' + WEEK[bjDate(birth.ts).getUTCDay()],
                chartText: chart.pillars.map(function (p) { return p.ganzhi; }).join(' '),
                monthJie: chart.prevJie.name,
                monthJieTime: fmtDateTime(chart.prevJie.ts),
                monthJieElapsed: chart.prevJieAgoText,
                nextJie: chart.nextJie.name,
                nextJieTime: fmtDateTime(chart.nextJie.ts),
                nextJieIn: chart.nextJieInText,
                monthLengthDays: chart.monthLengthDays,
                siLingText: chart.siLing.text,
                siLingShort: chart.siLing.short,
                season: seasonName(chart.monthZhi),
                timeRange: chart.hourUnknown ? '时辰未知' : SHICHEN_RANGE[chart.hourZhi],
                lateZi: chart.lateZi,
                ziSchool: chart.ziSchool,
                hourUnknown: chart.hourUnknown,
                dayMaster: chart.dayGan,
                dayMasterWx: chart.dayWx,
                dayMasterYy: GAN_YANG[chart.dayGan] ? '阳' : '阴',
                kongWang: chart.kongWang.join('、'),
                mingGong: chart.mingGong,
                shenGong: chart.shenGong,
                taiYuan: chart.taiYuan,
                taiXi: chart.taiXi,
                lunar: birth.lunar || null,
                warnings: chart.warnings,
                trueSolarApplied: !!birth.trueSolarApplied,
                solarTimeText: birth.solarTimeText || null,
                solarDateText: birth.solarDateText || null,
                dstApplied: !!birth.dstApplied,
                solarTimeNote: chart.solarTimeNote,
                note: chart.solarTimeNote
            },
            chart: chart,
            pillars: chart.pillars,
            params: (function () { var o = {}; for (var k in P) o[k] = P[k]; return o; })(),
            model: model,
            strength: strength,
            geju: geju,
            tiaohou: tiaohou,
            flow: flow,
            disease: disease,
            yongshen: yongshen,
            tenGods: tenGods,
            shensha: shensha,
            palaces: palaces,
            tombs: tombs,
            relationships: model.relations,
            dayun: dayun,
            liunian: liunian,
            liuyue: liuyue,
            fuyin: fuyin,
            xiaoyun: xiaoyun,
            career: career,
            family: family,
            health: health,
            milestones: milestones,
            advice: advice,
            narrative: narrative
        };
    }
    /* ---------------------------------------------------------------------
     * 13. 导出（纯引擎，无 DOM；UI 见 js/app.js）
     * ------------------------------------------------------------------- */
    var api = {
        buildReport: buildReport,
        parseBirthInput: parseBirthInput,
        computeSynastry: computeSynastry,
        solarToLunar: solarToLunar,
        lunarToSolar: lunarToSolar,
        _internals: {
            buildChart: buildChart, computePower: computePower, computeStrength: computeStrength,
            detectSpecial: detectSpecial, detectHuaQi: detectHuaQi, determineGeju: determineGeju,
            computeLiuYue: computeLiuYue,
            solarTermTs: solarTermTs, allJie: allJie, tenGod: tenGod, seasonState: seasonState,
            equationOfTime: equationOfTime, isChinaDST: isChinaDST, defaultParams: defaultParams,
            GAN: GAN, ZHI: ZHI, CANG: CANG, JIE_DEFS: JIE_DEFS
        }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.BaziApp = api;
})();
