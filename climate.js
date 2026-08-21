/* ==========================================================================
 * climate.js — 기후 지표 산출 공용 모듈
 * ==========================================================================
 * 이 파일에는 화면에 표시되는 모든 파생 수치의 산출식이 모여 있습니다.
 * 파생 수치의 기준과 산식은 이 모듈에서 관리합니다.
 *
 * 원자료(연평균기온, 폭염일수, 열대야일수, 체감온도, 절대습도, CO2 농도)는
 * 가공하지 않고 그대로 표시합니다. 아래 함수들은 원자료를 조합해
 *   (1) 폭염위험지수  (2) 등급 구분  (3) 체감온도 산출
 * 을 계산하는 데만 사용됩니다.
 * ========================================================================== */

var Climate = (function () {
    "use strict";

    /* ----------------------------------------------------------------------
     * 1. 폭염위험지수
     * ----------------------------------------------------------------------
     * 서로 단위가 다른 세 지표를 고정 기준구간으로 0~1 정규화한 뒤
     * 가중합하여 0~100 점수로 환산합니다. 절대적인 위험 수준이 아니라
     * 지역·연대 사이의 비교를 위한 상대지표입니다.
     *
     *   폭염일수      0 ~ 50 일   가중치 0.40
     *   열대야일수    0 ~ 50 일   가중치 0.35
     *   여름 체감온도 27 ~ 34 ℃   가중치 0.25
     *
     * 기준구간은 본 서비스가 다루는 6개 지점 · 2000~2090년 자료의
     * 실측 범위(폭염 5.2~48.4일, 열대야 0.8~46.4일, 체감 27.2~33.5℃)를
     * 모두 포함하도록 정한 값입니다.
     *
     * 특정 지표가 결측인 지점(예: 천안시 여름 체감온도)은 해당 항목을
     * 제외하고 남은 가중치를 재정규화합니다. 이때 지수 옆에 결측 표시를
     * 함께 노출합니다.
     * -------------------------------------------------------------------- */
    var RISK_TERMS = [
        { key: "heatDays",       label: "폭염일수",      weight: 0.40, min: 0,  max: 50, unit: "일" },
        { key: "tropicalNights", label: "열대야일수",    weight: 0.35, min: 0,  max: 50, unit: "일" },
        { key: "feltSummer",     label: "여름 체감온도", weight: 0.25, min: 27, max: 34, unit: "℃" }
    ];

    var GRADES = [
        { min: 0,  max: 25,  level: 1, label: "낮음",     cls: "grade-1",
          advice: "현 수준의 예방 관리와 시민 안내를 유지하는 단계입니다." },
        { min: 25, max: 50,  level: 2, label: "보통",     cls: "grade-2",
          advice: "무더위쉼터 위치 안내와 취약계층 명단 정비가 필요한 단계입니다." },
        { min: 50, max: 75,  level: 3, label: "높음",     cls: "grade-3",
          advice: "쉼터 운영시간 확대와 야간 냉방 대책을 함께 준비해야 하는 단계입니다." },
        { min: 75, max: 101, level: 4, label: "매우 높음", cls: "grade-4",
          advice: "폭염 대응 매뉴얼 상시 가동과 옥외 작업·활동 시간 조정이 필요한 단계입니다." }
    ];

    function clamp(v, lo, hi) {
        return Math.min(Math.max(v, lo), hi);
    }

    function normalize(value, min, max) {
        return clamp((value - min) / (max - min), 0, 1);
    }

    function isNum(v) {
        return typeof v === "number" && isFinite(v);
    }

    /**
     * 폭염위험지수 산출.
     * @param {object} row - data.js 의 series 한 행
     * @returns {{score:number|null, terms:Array, missing:Array}}
     */
    function riskIndex(row) {
        var terms = [];
        var missing = [];
        var weightSum = 0;
        var acc = 0;

        RISK_TERMS.forEach(function (t) {
            var v = row[t.key];
            if (!isNum(v)) {
                missing.push(t.label);
                return;
            }
            var n = normalize(v, t.min, t.max);
            weightSum += t.weight;
            acc += t.weight * n;
            terms.push({
                label: t.label,
                value: v,
                unit: t.unit,
                normalized: n,
                weight: t.weight,
                range: t.min + "~" + t.max + t.unit
            });
        });

        if (weightSum === 0) {
            return { score: null, terms: terms, missing: missing };
        }
        return {
            score: Math.round((acc / weightSum) * 100),
            terms: terms,
            missing: missing
        };
    }

    /** 점수 -> 등급 객체 */
    function grade(score) {
        if (!isNum(score)) {
            return { level: 0, label: "산출 불가", cls: "grade-1", advice: "" };
        }
        for (var i = 0; i < GRADES.length; i++) {
            if (score >= GRADES[i].min && score < GRADES[i].max) return GRADES[i];
        }
        return GRADES[GRADES.length - 1];
    }

    /* ----------------------------------------------------------------------
     * 2. 체감온도 (개념 안내 페이지 퀴즈에 사용)
     * ----------------------------------------------------------------------
     * 기상청 여름철 체감온도 산식(2020년 개정)을 그대로 구현합니다.
     *   체감온도 = -0.2442 + 0.55399·Tw + 0.45535·Ta
     *              - 0.0022·Tw² + 0.00278·Tw·Ta + 3.0
     * 습구온도 Tw 는 Stull(2011) 근사식으로 계산합니다.
     *   Tw = Ta·atan(0.151977·√(RH+8.313659)) + atan(Ta+RH)
     *        - atan(RH-1.676331) + 0.00391838·RH^1.5·atan(0.023101·RH)
     *        - 4.686035
     * -------------------------------------------------------------------- */
    function wetBulbTemperature(taC, rhPct) {
        var Ta = taC;
        var RH = rhPct;
        return (
            Ta * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
            Math.atan(Ta + RH) -
            Math.atan(RH - 1.676331) +
            0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
            4.686035
        );
    }

    function apparentTemperature(taC, rhPct) {
        var Tw = wetBulbTemperature(taC, rhPct);
        return (
            -0.2442 +
            0.55399 * Tw +
            0.45535 * taC -
            0.0022 * Tw * Tw +
            0.00278 * Tw * taC +
            3.0
        );
    }

    /* ----------------------------------------------------------------------
     * 3. 표시 보조
     * -------------------------------------------------------------------- */
    /** 숫자 포맷. 값이 없으면 '자료 없음' 대체문자 반환 */
    function fmt(v, digits, fallback) {
        if (!isNum(v)) return fallback === undefined ? "–" : fallback;
        return v.toFixed(digits === undefined ? 1 : digits);
    }

    /** 증감 표기. { text, cls, sign } */
    function delta(current, base, digits) {
        if (!isNum(current) || !isNum(base)) {
            return { text: "비교 자료 없음", cls: "d-flat", value: null };
        }
        var d = current - base;
        var dig = digits === undefined ? 1 : digits;
        var abs = Math.abs(d).toFixed(dig);
        if (Math.abs(d) < Math.pow(10, -dig) / 2) {
            return { text: "변화 없음", cls: "d-flat", value: 0 };
        }
        return {
            text: (d > 0 ? "▲ " : "▼ ") + abs,
            cls: d > 0 ? "d-up" : "d-down",
            value: d
        };
    }

    /* ----------------------------------------------------------------------
     * 5. 한국어 조사 처리
     * ----------------------------------------------------------------------
     * 지역명 뒤에 붙는 조사를 받침 유무에 따라 자동으로 고릅니다.
     * (예: 전국 + 은/는 -> "전국은",  서울특별시 + 은/는 -> "서울특별시는")
     * -------------------------------------------------------------------- */
    var JOSA = {
        "은는": ["은", "는"],
        "이가": ["이", "가"],
        "을를": ["을", "를"],
        "과와": ["과", "와"],
        "으로": ["으로", "로"]
    };

    /** 마지막 글자에 받침이 있는지 */
    function hasFinalConsonant(word) {
        if (!word) return false;
        var code = word.charCodeAt(word.length - 1);
        if (code < 0xac00 || code > 0xd7a3) return false;   // 한글 음절이 아니면 없음 취급
        return (code - 0xac00) % 28 !== 0;
    }

    /** 'ㄹ' 받침 여부 ('으로/로' 판단에 사용) */
    function hasRieulFinal(word) {
        if (!word) return false;
        var code = word.charCodeAt(word.length - 1);
        if (code < 0xac00 || code > 0xd7a3) return false;
        return (code - 0xac00) % 28 === 8;
    }

    function josa(word, type) {
        var pair = JOSA[type];
        if (!pair) return word;
        if (type === "으로") {
            return word + (hasFinalConsonant(word) && !hasRieulFinal(word) ? pair[0] : pair[1]);
        }
        return word + (hasFinalConsonant(word) ? pair[0] : pair[1]);
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    return {
        riskIndex: riskIndex,
        grade: grade,
        apparentTemperature: apparentTemperature,
        clamp: clamp,
        isNum: isNum,
        fmt: fmt,
        delta: delta,
        josa: josa,
        escapeHtml: escapeHtml
    };
})();
