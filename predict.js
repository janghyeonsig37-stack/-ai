/* ==========================================================================
 * predict.js — 브라우저에서 XGBoost 예측을 실행하는 모듈
 * --------------------------------------------------------------------------
 * tools/train_model.py 가 학습한 트리를 js/model.js 에 배열로 적어 두었고,
 * 이 파일이 그 배열을 따라 내려가며 파이썬과 똑같은 계산을 합니다.
 * 서버도 파이썬도 필요하지 않습니다.
 *
 * 1. 트리 순회 (예측의 핵심)
 * 2. CO2 배출 경로 만들기 (슬라이더 위치 -> 연대별 CO2 농도)
 * 3. 예측 결과 묶음 만들기
 * ========================================================================== */

var Predict = (function () {
    "use strict";

    var M = CLIMATE_MODEL;
    var REGIONS = M.meta.regions;
    var DECADES = M.meta.decades;
    var SSP = M.meta.scenarios;

    /* 특징 순서는 학습 때와 반드시 같아야 합니다. (11차원)
       [지역 6개 one-hot] + [지역 기준값 3종] + [연대] + [CO2 농도]

       지역 기준값은 그 지역의 2000년대 관측값(폭염일수·열대야일수·평균기온)
       입니다. 미래 자료가 아니므로 정답을 미리 알려 주는 것이 아니고,
       "이 지역은 원래 얼마나 더운 곳인가" 를 모델에게 알려 주는 역할만
       합니다. 값은 js/model.js 의 meta.regionBaseline 에 들어 있습니다. */
    var N_REGION = REGIONS.length;
    var BASELINE = M.meta.regionBaseline || {};
    var N_BASE = (M.meta.baselineKeys || []).length;
    var IDX_BASE = N_REGION;
    var IDX_DECADE = N_REGION + N_BASE;
    var IDX_CO2 = N_REGION + N_BASE + 1;
    var N_FEAT = N_REGION + N_BASE + 2;

    /* 학습 때 쓴 차원 수와 어긋나면 조용히 틀린 값을 내놓는 대신
       바로 알아차릴 수 있게 해 둡니다. */
    if (M.meta.featureNames && M.meta.featureNames.length !== N_FEAT) {
        throw new Error("predict.js 의 특징 개수(" + N_FEAT +
            ")가 model.js(" + M.meta.featureNames.length + ")와 다릅니다.");
    }

    function makeRow(region, decade, co2) {
        var row = new Array(N_FEAT);
        for (var i = 0; i < N_REGION; i++) {
            row[i] = (REGIONS[i] === region) ? 1 : 0;
        }
        var base = BASELINE[region] || [];
        for (var j = 0; j < N_BASE; j++) {
            row[IDX_BASE + j] = base[j];
        }
        row[IDX_DECADE] = decade;
        row[IDX_CO2] = co2;
        return row;
    }

    /* ======================================================================
     * 1. 트리 순회
     * ----------------------------------------------------------------------
     * 노드 형식
     *   분기 [특징번호, 기준값, 작을때_다음, 크거나같을때_다음]
     *   잎   [-1, 더할 값]
     * XGBoost 규칙과 같게 (값 < 기준값) 이면 왼쪽으로 갑니다.
     * ==================================================================== */
    function runTrees(target, row) {
        var t = M.targets[target];
        if (!t) return null;
        var sum = t.base;
        var trees = t.trees;
        for (var k = 0; k < trees.length; k++) {
            var nodes = trees[k];
            var i = 0;
            var node = nodes[i];
            while (node[0] !== -1) {
                i = (row[node[0]] < node[1]) ? node[2] : node[3];
                node = nodes[i];
            }
            sum += node[1];
        }
        return sum;
    }

    /** 이 항목을 이 지역에 대해 예측할 수 있는지 (학습 자료가 있었는지) */
    function canPredict(target, region) {
        var t = M.targets[target];
        if (!t) return false;
        if (!BASELINE[region]) return false;      // 기준값이 없으면 예측 불가
        if (!t.regions) return true;
        return t.regions.indexOf(region) !== -1;
    }

    /** 지역·연대·CO2 로 한 값 예측.
     *  학습 자료가 없던 지역이면 값을 만들어 내지 않고 null 을 돌려줍니다. */
    function value(target, region, decade, co2) {
        if (!canPredict(target, region)) return null;
        return runTrees(target, makeRow(region, decade, co2));
    }

    /* ======================================================================
     * 2. CO2 배출 경로 만들기
     * ----------------------------------------------------------------------
     * 슬라이더 위치 t 는 0~3 사이의 실수입니다.
     *   0 = SSP1-2.6 (온실가스를 크게 줄인 미래)
     *   3 = SSP5-8.5 (화석연료를 계속 늘리는 미래)
     * 중간값은 이웃한 두 공식 시나리오의 CO2 농도를 비례로 섞습니다.
     *
     * 이렇게 하면 어떤 값을 골라도 연대별 CO2 가 항상 공식 시나리오 사이에
     * 머물러, 모델이 배운 적 없는 범위를 예측하는 일이 생기지 않습니다.
     * ==================================================================== */
    var T_MIN = 0;
    var T_MAX = SSP.length - 1;

    function clampT(t) {
        return Math.min(Math.max(t, T_MIN), T_MAX);
    }

    /** 슬라이더 위치 -> 연대별 CO2 농도 배열 */
    function co2Path(t) {
        t = clampT(t);
        var lo = Math.floor(t);
        var hi = Math.min(lo + 1, T_MAX);
        var f = t - lo;
        var a = M.co2[SSP[lo]];
        var b = M.co2[SSP[hi]];
        return DECADES.map(function (d, i) {
            return a[i] * (1 - f) + b[i] * f;
        });
    }

    /** 슬라이더 위치 -> 특정 연대의 CO2 농도 */
    function co2At(t, decade) {
        var i = DECADES.indexOf(decade);
        if (i < 0) return null;
        return co2Path(t)[i];
    }

    /** 슬라이더 위치에 가장 가까운 공식 시나리오 */
    function nearestScenario(t) {
        t = clampT(t);
        var i = Math.round(t);
        return {
            key: SSP[i],
            label: M.meta.scenarioLabels[SSP[i]],
            exact: Math.abs(t - i) < 1e-9,
            distance: Math.abs(t - i)
        };
    }

    /** 공식 시나리오 이름 -> 슬라이더 위치 */
    function scenarioT(key) {
        var i = SSP.indexOf(key);
        return i < 0 ? 0 : i;
    }

    /* ======================================================================
     * 3. 예측 결과 묶음
     * ==================================================================== */
    /** 한 지역·한 경로에 대해 연대별 예측값 배열 */
    function series(target, region, t) {
        var path = co2Path(t);
        return DECADES.map(function (d, i) {
            return value(target, region, d, path[i]);
        });
    }

    /** 한 지역·한 경로·한 연대에 대해 4개 항목 전부 */
    function allAt(region, t, decade) {
        var co2 = co2At(t, decade);
        var out = { co2: co2, decade: decade };
        Object.keys(M.targets).forEach(function (k) {
            out[k] = value(k, region, decade, co2);
        });
        return out;
    }

    /** 예측 항목의 검증 성능 (화면에 오차를 표시하기 위함) */
    function accuracy(target) {
        var t = M.targets[target];
        if (!t) return null;
        return { mae: t.mae, r2: t.r2, unit: t.unit, label: t.label };
    }

    return {
        meta: M.meta,
        DECADES: DECADES,
        SSP: SSP,
        T_MIN: T_MIN,
        T_MAX: T_MAX,
        targetKeys: Object.keys(M.targets),
        target: function (k) { return M.targets[k]; },
        value: value,
        canPredict: canPredict,
        series: series,
        allAt: allAt,
        co2Path: co2Path,
        co2At: co2At,
        nearestScenario: nearestScenario,
        scenarioT: scenarioT,
        accuracy: accuracy,
        officialCo2: M.co2
    };
})();
