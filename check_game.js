/* ==========================================================================
 * check_game.js — "우리동네 기후 게임" 자료 전수 검사
 * --------------------------------------------------------------------------
 *   node tools/check_game.js
 *
 * 검사 항목
 *   1. 라운드 자료 형식 (점수 범위, 필수 항목, 근거 문장 존재)
 *   2. 라운드마다 '편하면서 배출도 적은 길'과 '편하지도 않은데 배출만 많은 함정'이
 *      실제로 있는지  ← 게임이 성립하는지의 핵심
 *   3. 1,024가지 경로 전부의 점수와 등급 분포
 *   4. 점수 → 배출 경로(t) → 예측값 연결이 예측 모델과 일치하는지
 * ========================================================================== */
const fs = require("fs"), path = require("path");
const ROOT = path.dirname(__dirname);
function load(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }
eval((load("js/model.js") + "\n" + load("js/predict.js") + "\n" + load("js/game-data.js"))
     .replace(/^const CLIMATE_MODEL/m, "var CLIMATE_MODEL"));

let fail = 0;
function check(ok, msg) {
    console.log("  " + (ok ? "통과" : "실패 ✗") + "  " + msg);
    if (!ok) fail++;
}

const R = GAME_ROUNDS;
console.log("=".repeat(70));
console.log("1. 라운드 자료 형식");
console.log("=".repeat(70));
check(R.length === 5, "라운드 5개 (" + R.length + ")");
let formOk = true, whyShort = [];
R.forEach(function (r, i) {
    if (r.opts.length !== 4 || !r.when || !r.title || !r.sit) formOk = false;
    r.opts.forEach(function (o) {
        if (!o.ico || !o.label) formOk = false;
        if (!(o.comfort >= 0 && o.comfort <= 3)) formOk = false;
        if (!(o.emit >= 0 && o.emit <= 3)) formOk = false;
        if (!o.why || o.why.length < 30) whyShort.push(r.title + " / " + o.label);
    });
});
check(formOk, "모든 라운드가 행동 4개 · 점수 0~3 · 필수 항목 보유");
check(whyShort.length === 0, "모든 행동에 근거 문장(why) 있음" +
      (whyShort.length ? " — 빠짐: " + whyShort.join(", ") : ""));

console.log("");
console.log("=".repeat(70));
console.log("2. 게임이 성립하는지 (라운드별 선택 구조)");
console.log("=".repeat(70));
let allHaveSmart = true, allHaveTrap = true;
R.forEach(function (r, i) {
    const maxC = Math.max.apply(null, r.opts.map(function (o) { return o.comfort; }));
    const maxE = Math.max.apply(null, r.opts.map(function (o) { return o.emit; }));
    /* 좋은 길 : 편함이 최고치에 가까운데 배출은 최고치의 절반 이하 */
    const smart = r.opts.filter(function (o) {
        return o.comfort >= maxC - 1 && o.emit <= Math.floor(maxE / 2);
    });
    /* 함정 : '지배당하는 선택' — 다른 선택이 편함은 같거나 높은데 배출은 더 적음.
       (또는 배출은 같은데 편함이 더 높음.) 고르면 손해만 보는 선택이고,
       이런 것이 하나라도 있어야 '생각해서 고르는 보람'이 생깁니다. */
    const trap = r.opts.filter(function (o) {
        return r.opts.some(function (x) {
            return (x.comfort >= o.comfort && x.emit < o.emit) ||
                   (x.comfort > o.comfort && x.emit <= o.emit);
        });
    });
    if (!smart.length) allHaveSmart = false;
    if (!trap.length) allHaveTrap = false;
    console.log("  R" + (i + 1) + " " + r.title.padEnd(7) +
        " 편함 " + r.opts.map(function (o) { return o.comfort; }).join("") +
        " · 배출 " + r.opts.map(function (o) { return o.emit; }).join("") +
        "  | 좋은길 " + (smart[0] ? smart[0].label.slice(0, 15) : "없음 ✗") +
        "  | 손해뿐인 선택 " + trap.length + "개" +
        (trap[0] ? " (" + trap[0].label.slice(0, 15) + ")" : " ✗"));
});
check(allHaveSmart, "모든 라운드에 '편한데 배출 적은' 선택이 있음");
check(allHaveTrap, "모든 라운드에 '고르면 손해만 보는 선택'이 있음 (생각할 여지가 있음)");

console.log("");
console.log("=".repeat(70));
console.log("3. 1,024가지 경로 전수 점수");
console.log("=".repeat(70));
const EMIT_MIN = R.map(function (r) { return Math.min.apply(null, r.opts.map(function (o) { return o.emit; })); });
const EMIT_MAX = R.map(function (r) { return Math.max.apply(null, r.opts.map(function (o) { return o.emit; })); });
const COMF_MAX = R.map(function (r) { return Math.max.apply(null, r.opts.map(function (o) { return o.comfort; })); });
const sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
const E_MIN = sum(EMIT_MIN), E_MAX = sum(EMIT_MAX), C_MAX = sum(COMF_MAX);

const all = [];
(function go(i, c, e, p) {
    if (i === R.length) { all.push({ c: c, e: e, p: p.slice() }); return; }
    R[i].opts.forEach(function (o, j) { p.push(j); go(i + 1, c + o.comfort, e + o.emit, p); p.pop(); });
})(0, 0, 0, []);
check(all.length === 1024, "경로 수 1,024 (" + all.length + ")");
check(Math.min.apply(null, all.map(function (a) { return a.e; })) === E_MIN &&
      Math.max.apply(null, all.map(function (a) { return a.e; })) === E_MAX,
      "배출 총점 범위 " + E_MIN + " ~ " + E_MAX + " 가 라운드별 최소·최대 합과 일치");

const G = GAME_GOAL;
const best = all.filter(function (a) { return a.c >= G.bestComfort && a.e <= G.bestEmit; });
const ok = all.filter(function (a) { return a.c >= G.comfort && a.e <= G.emit; });
console.log("  등급 분포");
console.log("    🏆 균형 (편함≥" + G.bestComfort + " · 배출≤" + G.bestEmit + ") : " +
    best.length + "판 (" + (best.length / 10.24).toFixed(1) + "%)");
console.log("    ✅ 성공 (편함≥" + G.comfort + " · 배출≤" + G.emit + ") : " +
    ok.length + "판 (" + (ok.length / 10.24).toFixed(1) + "%)");
check(best.length > 0 && best.length < ok.length, "'균형'이 '성공'보다 좁고 도달 가능함");
check(ok.length >= 50 && ok.length <= 400,
      "성공률이 5~40% 사이 (너무 쉽지도 어렵지도 않음) — 실제 " +
      (ok.length / 10.24).toFixed(1) + "%");
/* 모두 편한 선택만 / 모두 배출 적은 선택만 골랐을 때는 실패해야 게임이 성립합니다 */
const allComfort = { c: C_MAX, e: Math.min.apply(null,
    all.filter(function (a) { return a.c === C_MAX; }).map(function (a) { return a.e; })) };
check(allComfort.e > G.emit,
      "편함만 최대로 고르면 실패한다 (편함 " + C_MAX + " · 배출 최소 " + allComfort.e +
      " > 기준 " + G.emit + ")");
const allGreen = Math.max.apply(null,
    all.filter(function (a) { return a.e === E_MIN; }).map(function (a) { return a.c; }));
check(allGreen < G.comfort,
      "배출만 최소로 고르면 실패한다 (배출 " + E_MIN + " · 편함 최대 " + allGreen +
      " < 기준 " + G.comfort + ")");

console.log("");
console.log("=".repeat(70));
console.log("4. 점수 → 배출 경로 → 예측값 연결");
console.log("=".repeat(70));
function effortOf(e, played) {
    let floor = 0;
    for (let i = 0; i < played; i++) floor += EMIT_MIN[i];
    const t = (e - floor) / (E_MAX - E_MIN) * Predict.T_MAX;
    return Math.min(Math.max(t, Predict.T_MIN), Predict.T_MAX);
}
check(effortOf(E_MIN, R.length) === Predict.T_MIN,
      "가장 적게 배출한 경로 → t = 0 (SSP1-2.6)");
check(Math.abs(effortOf(E_MAX, R.length) - Predict.T_MAX) < 1e-9,
      "가장 많이 배출한 경로 → t = 3 (SSP5-8.5)");
let rangeOk = true, monoOk = true;
all.forEach(function (a) {
    const t = effortOf(a.e, R.length);
    if (t < 0 || t > 3) rangeOk = false;
});
check(rangeOk, "모든 경로의 t 가 0~3 안에 있음 (외삽 없음)");
/* 배출이 많을수록 폭염일수가 줄어드는 일이 없어야 합니다 */
const REGIONS = Predict.meta.regions;
let viol = 0, changed = {}, nAll = 0;
REGIONS.forEach(function (reg) {
    let prev = null;
    for (let e = E_MIN; e <= E_MAX; e++) {
        const v = Predict.value("heatDays", reg, GAME_DECADE,
                                Predict.co2At(effortOf(e, R.length), GAME_DECADE));
        if (prev !== null && v < prev - 1e-9) viol++;
        prev = v;
    }
    const vals = [];
    for (let e = E_MIN; e <= E_MAX; e++) {
        vals.push(+Predict.value("heatDays", reg, GAME_DECADE,
                  Predict.co2At(effortOf(e, R.length), GAME_DECADE)).toFixed(1));
    }
    changed[reg] = new Set(vals).size;
    nAll = vals.length;
});
check(viol === 0, "배출이 늘 때 폭염일수가 줄어드는 경우 0건 (단조성)");
console.log("  지역별 서로 다른 폭염일수 단계 수 (배출 " + nAll + "단계 중)");
REGIONS.forEach(function (r) { console.log("    " + r.padEnd(9) + changed[r] + "단계"); });
check(Object.keys(changed).every(function (k) { return changed[k] >= 6; }),
      "모든 지역에서 6단계 이상 구분됨 (선택이 화면에 반영됨)");
/* 램프 색 단계가 모두 지도 육지색과 구분되는지는 game-data.js 주석 참조 */
check(GAME_RAMP.length >= 4 && GAME_RAMP.every(function (h) { return /^#[0-9a-f]{6}$/.test(h); }),
      "지도 색 램프 형식 정상 (" + GAME_RAMP.length + "단)");

console.log("");
console.log("=".repeat(70));
console.log(fail === 0 ? "모든 검사 통과" : fail + "건 실패");
console.log("=".repeat(70));
process.exit(fail === 0 ? 0 : 1);
