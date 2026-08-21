#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/*.csv  ->  js/model.js  (XGBoost 예측 모델 학습 및 내보내기)

원본 CSV를 수정한 뒤 아래 명령으로 다시 실행하면 js/model.js 가 갱신됩니다.

    python tools/train_model.py

--------------------------------------------------------------------------
무엇을 하는 스크립트인가
--------------------------------------------------------------------------
사용자가 "CO2를 이만큼 배출하는 미래"를 고르면 그때의 폭염일수·열대야일수·
연평균기온·여름 체감온도가 얼마가 될지 예측하는 모델을 학습합니다.

학습 자료
  기상청 기후변화 시나리오 4종(SSP1-2.6 / 2-4.5 / 3-7.0 / 5-8.5)의
  6개 지점 × 8개 연대 값 = 192행.
  입력(11차원) = [지역 one-hot 6] + [그 지역의 2000년대 관측 기준값 3] +
                 [연대] + [그 시나리오·연대의 CO2 농도(ppm)]
  출력 = 폭염일수 / 열대야일수 / 연평균기온 / 여름 체감온도

지역 기준값을 입력에 넣는 이유
  지역을 one-hot 만으로 표현하면 모델은 "서울"이라는 이름만 알고
  서울이 원래 얼마나 더운 곳인지는 모릅니다. 2000년대 관측값
  (폭염일수·열대야일수·연평균기온)을 함께 넣으면 "이 지역은 원래 이 정도인데
  CO2 가 이만큼 오르면 얼마나 더 더워지는가"를 배울 수 있습니다.
  이 값은 과거 관측 자료이므로 미래를 훔쳐보는 누출이 아닙니다.
  실측 결과 4개 출력 모두 정확도가 개선되었습니다.

연쇄 모델을 쓰지 않은 이유
  CO2 → 기온 → 폭염일수 순서로 이어 붙이는 구조를 측정해 보았으나
  열대야일수 정확도가 11~34% 나빠졌습니다. 예측기온은 CO2·지역·기준값이
  이미 담고 있는 정보를 오차가 섞인 형태로 다시 넣는 것이어서,
  192행 규모에서는 1단계 오차가 2단계로 전파되기만 합니다.
  따라서 네 항목을 각각 CO2 에서 직접 예측합니다.

CO2 단조 증가 제약
  monotone_constraints 로 "CO2가 올라가면 결과가 절대 내려가지 않도록"
  강제합니다. 물리적으로 맞고, 교육용으로도 필수입니다.
  (제약을 걸어도 정확도 손실이 없음을 확인했습니다.)

성능 검증 방법
  leave-one-scenario-out : 시나리오 하나를 학습에서 완전히 빼고 그것을
  예측하게 합니다. 사용자가 학습 자료에 없는 CO2 값을 넣는 상황과
  동일한 조건이므로, 이 값이 실제 사용 성능입니다.

브라우저에서 어떻게 쓰는가
  학습한 트리를 아주 단순한 배열 형태로 js/model.js 에 적어 둡니다.
  js/predict.js 가 그 배열을 따라 내려가며 같은 계산을 수행하므로,
  파이썬 없이 브라우저만으로 예측이 됩니다.
  내보낸 뒤 파이썬 예측값과 자바스크립트 계산식이 일치하는지 검사합니다.
"""

import csv
import itertools
import json
import os
import sys

try:
    import numpy as np
    import xgboost as xgb
    from sklearn.metrics import mean_absolute_error, r2_score
except ImportError:
    print("먼저 필요한 패키지를 설치하세요:  pip install xgboost scikit-learn")
    sys.exit(1)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, "js", "model.js")

SSP = ["SSP1-2.6", "SSP2-4.5", "SSP3-7.0", "SSP5-8.5"]
SSP_LABEL = {
    "SSP1-2.6": "온실가스를 크게 줄인 미래",
    "SSP2-4.5": "지금 정도로 노력하는 미래",
    "SSP3-7.0": "감축이 늦어지는 미래",
    "SSP5-8.5": "화석연료를 계속 늘리는 미래",
}
DECADES = [2020, 2030, 2040, 2050, 2060, 2070, 2080, 2090]
REGIONS = ["전국", "서울특별시", "부산광역시", "대전광역시", "강원 속초시", "충청남도 천안시"]

# key, 화면 표기, 파일, 열, 단위, 소수점
TARGETS = [
    ("heatDays",       "폭염일수",      "heat wave.csv",       "폭염일수",       "일", 1),
    ("tropicalNights", "열대야일수",    "heat wave.csv",       "열대야일수",     "일", 1),
    ("temp",           "연평균기온",    "air temperature.csv", "평균기온",       "℃", 1),
    ("feltSummer",     "여름 체감온도", "Temperature.csv",     "체감온도(여름)", "℃", 1),
]

PARAMS = dict(
    n_estimators=150, max_depth=3, learning_rate=0.15,
    subsample=0.9, colsample_bytree=0.9, reg_lambda=1.0,
    objective="reg:squarederror", random_state=42, n_jobs=2,
)

# 지역 기준값으로 쓰는 항목 (2000년대 현재기후 관측값)
BASE_DECADE = 2000
BASE_KEYS = [
    ("baseHeat",  "heat wave.csv",       "폭염일수"),
    ("baseNight", "heat wave.csv",       "열대야일수"),
    ("baseTemp",  "air temperature.csv", "평균기온"),
]

# 특징 순서 (11차원)
#   [지역 6개 one-hot] + [기준 폭염·열대야·기온] + [연대] + [CO2]
#   → CO2 에만 단조 증가 제약
FEATURES = (["reg" + str(i) for i in range(len(REGIONS))]
            + [k for k, _, _ in BASE_KEYS] + ["decade", "co2"])
MONOTONE = ("(" + ",".join(["0"] * len(REGIONS) + ["0"] * len(BASE_KEYS)
            + ["0", "1"]) + ")")
IDX_CO2 = len(FEATURES) - 1


# ---------------------------------------------------------------------------
# 자료 읽기
# ---------------------------------------------------------------------------
def read_csv(name):
    with open(os.path.join(DATA, name), encoding="utf-8-sig", newline="") as fp:
        return list(csv.DictReader(fp))


def num(v):
    v = (v or "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load_co2():
    """시나리오 × 연대 별 CO2 농도(ppm)."""
    out = {}
    for r in read_csv("CO2.csv"):
        sc = r["시나리오"].strip()
        yr = int(r["연도"])
        if sc in SSP and yr in DECADES:
            out[(sc, yr)] = num(r["CO2농도(ppm)"])
    missing = [(s, d) for s in SSP for d in DECADES if out.get((s, d)) is None]
    if missing:
        raise SystemExit("CO2 자료 결측: %s" % missing[:5])
    return out


CO2 = load_co2()


OBS_SCENARIO = "현재기후"


def load_baseline():
    """지역별 2000년대 관측 기준값. 미래 자료가 아니므로 누출이 아닙니다."""
    out = {}
    for reg in REGIONS:
        vals = []
        for _, fname, col in BASE_KEYS:
            hit = None
            for r in read_csv(fname):
                if (r["지역"].strip() == reg and r["시나리오"].strip() == OBS_SCENARIO
                        and int(r["연대"]) == BASE_DECADE):
                    hit = num(r[col])
                    break
            if hit is None:
                raise SystemExit("기준값 결측: %s / %s" % (reg, col))
            vals.append(hit)
        out[reg] = vals
    return out


BASELINE = None      # 아래에서 채웁니다


def build(fname, col):
    idx = {}
    for r in read_csv(fname):
        idx[(r["지역"].strip(), r["시나리오"].strip(), int(r["연대"]))] = num(r[col])

    X, y, meta = [], [], []
    for reg, sc, dec in itertools.product(REGIONS, SSP, DECADES):
        v = idx.get((reg, sc, dec))
        if v is None:
            continue
        onehot = [1.0 if reg == R else 0.0 for R in REGIONS]
        X.append(onehot + [float(v) for v in BASELINE[reg]]
                 + [float(dec), float(CO2[(sc, dec)])])
        y.append(v)
        meta.append((reg, sc, dec))
    # X32 : XGBoost 가 실제로 학습에 쓰는 값(float32)
    # Xjs : 웹페이지(js)가 넣게 되는 값(10진수 그대로, float64)
    return (np.array(X, dtype=np.float32), np.array(X, dtype=np.float64),
            np.array(y, dtype=np.float64), meta)


# ---------------------------------------------------------------------------
# 트리를 단순 배열로 변환
# ---------------------------------------------------------------------------
def flatten_tree(node):
    """XGBoost 덤프(중첩 객체)를 [노드...] 배열로 바꿉니다.

    분기 노드 : [특징번호, 기준값, 왼쪽(작을 때), 오른쪽(크거나 같을 때)]
    잎   노드 : [-1, 예측값]
    XGBoost 규칙은 (값 < 기준값) 이면 yes 쪽으로 갑니다.
    """
    nodes = []

    def walk(nd):
        me = len(nodes)
        if "leaf" in nd:
            nodes.append([-1, round(float(nd["leaf"]), 8)])
            return me
        nodes.append(None)                       # 자리 확보
        feat = int(nd["split"].replace("f", ""))
        # 덤프의 기준값은 10진수 문자열이라 float64 로 그냥 읽으면 미세하게
        # 어긋납니다. XGBoost 는 float32 로 비교하므로 float32 로 되돌립니다.
        thr = float(np.float32(nd["split_condition"]))
        children = {c["nodeid"]: c for c in nd["children"]}
        yes = walk(children[nd["yes"]])
        no = walk(children[nd["no"]])
        nodes[me] = [feat, thr, yes, no]         # 기준값은 아직 반올림하지 않음
        return me

    walk(node)
    return nodes


def snap_thresholds(trees, X32, Xjs):
    """분기 기준값을 '관측값 사이의 중간값'으로 다시 적어 줍니다.

    XGBoost 는 내부적으로 float32 로 비교하지만 웹페이지(js)는 float64 로
    비교합니다. 기준값이 자료값과 거의 같으면(예: 자료 13.3, 기준 13.3000002)
    반올림·형변환 과정에서 비교 방향이 뒤집혀 두 쪽 결과가 달라집니다.
    기준값을 인접한 두 자료값의 정확한 중간으로 옮기면 나뉘는 결과는 그대로
    유지되면서 어떤 정밀도로 계산해도 방향이 뒤집히지 않습니다.

    단, CO2 는 예외입니다. 사용자가 슬라이더를 끌면 학습 자료에 없는 중간
    농도가 들어오므로, 기준값을 옮기면 그 중간 농도에서 파이썬과 다른 결과가
    나옵니다. CO2 만은 XGBoost 가 정한 기준값을 그대로 둡니다.
    (CO2 값은 학습 자료에서 정수이고 기준값과 멀어 뒤집힐 위험이 없습니다.)
    """
    n_feat = X32.shape[1]
    pairs = []          # 특징별 [(float32 값, js 가 넣는 값)] 오름차순
    for f in range(n_feat):
        seen = {}
        for i in range(X32.shape[0]):
            seen[float(X32[i][f])] = float(Xjs[i][f])
        pairs.append(sorted(seen.items()))

    moved = 0
    for nodes in trees:
        for nd in nodes:
            if nd[0] == -1:
                continue
            f, thr = nd[0], nd[1]
            if f == IDX_CO2:
                continue                 # CO2 는 그대로 둡니다 (위 설명 참조)
            vals = pairs[f]
            left = [js for v32, js in vals if v32 < thr]
            right = [js for v32, js in vals if not (v32 < thr)]
            if not left:
                new = vals[0][1] - 1.0
            elif not right:
                new = vals[-1][1] + 1.0
            else:
                new = (max(left) + min(right)) / 2.0
            new = round(new, 6)
            # 반올림 뒤에도 자료값과 겹치지 않아야 합니다.
            if any(js == new for _, js in vals):
                raise SystemExit("기준값 조정 실패: 특징 %d, %r" % (f, thr))
            if new != thr:
                moved += 1
            nd[1] = new
    return moved


def export_trees(model):
    booster = model.get_booster()
    dumps = booster.get_dump(dump_format="json")
    trees = [flatten_tree(json.loads(d)) for d in dumps]
    cfg = json.loads(booster.save_config())
    raw = cfg["learner"]["learner_model_param"]["base_score"]
    # XGBoost 버전에 따라 "41.17" 또는 "[4.117E1]" 형태로 나옵니다.
    base = float(str(raw).strip().lstrip("[").rstrip("]"))
    return trees, base


def predict_js_equivalent(trees, base, row):
    """js/predict.js 와 완전히 같은 순서로 계산합니다(검산용)."""
    total = base
    for nodes in trees:
        i = 0
        while nodes[i][0] != -1:
            feat, thr, yes, no = nodes[i]
            i = yes if row[feat] < thr else no
        total += nodes[i][1]
    return total


# ---------------------------------------------------------------------------
# 학습 · 검증 · 내보내기
# ---------------------------------------------------------------------------
def main():
    global BASELINE
    BASELINE = load_baseline()

    payload = {
        "meta": {
            "algorithm": "XGBoost (gradient boosted trees)",
            "nEstimators": PARAMS["n_estimators"],
            "maxDepth": PARAMS["max_depth"],
            "learningRate": PARAMS["learning_rate"],
            "monotoneOnCo2": True,
            "features": ["지역(6개 one-hot)", "지역 기준값 3종(2000년대 관측)",
                         "연대", "CO₂ 농도(ppm)"],
            "featureNames": FEATURES,
            "baselineDecade": BASE_DECADE,
            "baselineKeys": [k for k, _, _ in BASE_KEYS],
            "regionBaseline": None,   # 아래에서 채움
            "trainRows": None,
            "validation": "leave-one-scenario-out (학습에 없던 시나리오를 예측)",
            "scenarios": SSP,
            "scenarioLabels": SSP_LABEL,
            "decades": DECADES,
            "regions": REGIONS,
        },
        "co2": {s: [CO2[(s, d)] for d in DECADES] for s in SSP},
        "targets": {},
    }

    print("=" * 72)
    print("XGBoost 학습 및 검증")
    print("=" * 72)

    total_rows = None
    for key, label, fname, col, unit, digits in TARGETS:
        X, Xjs, y, meta = build(fname, col)
        if total_rows is None or len(y) > total_rows:
            total_rows = len(y)

        # ---- leave-one-scenario-out 검증 ----
        t_all, p_all, per_sc = [], [], {}
        for held in SSP:
            tr = [i for i, m in enumerate(meta) if m[1] != held]
            te = [i for i, m in enumerate(meta) if m[1] == held]
            if not te:
                continue
            m = xgb.XGBRegressor(**PARAMS, monotone_constraints=MONOTONE)
            m.fit(X[tr], y[tr])
            pr = m.predict(X[te])
            per_sc[held] = round(float(mean_absolute_error(y[te], pr)), 3)
            t_all += list(y[te]); p_all += list(pr)

        mae = float(mean_absolute_error(t_all, p_all))
        r2 = float(r2_score(t_all, p_all))

        # ---- 전체 자료로 최종 학습 ----
        final = xgb.XGBRegressor(**PARAMS, monotone_constraints=MONOTONE)
        final.fit(X, y)
        trees, base = export_trees(final)
        moved = snap_thresholds(trees, X, Xjs)

        # ---- 파이썬 예측 == 배열 순회 결과 인지 검산 ----
        # 검산에는 웹페이지가 실제로 넣는 값(Xjs)을 씁니다.
        py = final.predict(X)
        worst = 0.0
        n_chk = 0
        for i in range(len(X)):
            js = predict_js_equivalent(trees, base, [float(v) for v in Xjs[i]])
            worst = max(worst, abs(js - float(py[i])))
            n_chk += 1

        # 슬라이더는 공식 시나리오 사이의 '중간 CO2 농도'도 만들어 냅니다.
        # 학습 자료 위에서만 검산하면 그 구간의 어긋남을 놓치므로,
        # 실제 슬라이더가 만들 수 있는 농도로도 전수 검사합니다.
        for reg in sorted(set(m[0] for m in meta)):
            onehot = [1.0 if reg == R else 0.0 for R in REGIONS]
            head = onehot + [float(v) for v in BASELINE[reg]]
            for step in range(49):                       # 0 ~ 3 을 48등분
                t = step * (len(SSP) - 1) / 48.0
                lo = int(t) if t < len(SSP) - 1 else len(SSP) - 2
                f = t - lo
                for dec in DECADES:
                    co2 = (CO2[(SSP[lo], dec)] * (1 - f)
                           + CO2[(SSP[lo + 1], dec)] * f)
                    row = head + [float(dec), float(co2)]
                    js = predict_js_equivalent(trees, base, row)
                    pv = float(final.predict(np.array([row], dtype=np.float32))[0])
                    worst = max(worst, abs(js - pv))
                    n_chk += 1

        print("\n■ %s  (표본 %d개, 특징 %d차원, 트리 %d개)"
              % (label, len(y), X.shape[1], len(trees)))
        print("   학습에 없던 시나리오 예측 MAE %.2f%s   R2 %.3f" % (mae, unit, r2))
        print("   시나리오별 MAE : %s" %
              "  ".join("%s %.2f" % (s.replace("SSP", ""), v) for s, v in per_sc.items()))
        print("   실측 범위 %.1f ~ %.1f%s  (MAE는 범위의 %.1f%%)" %
              (y.min(), y.max(), unit, mae / (y.max() - y.min()) * 100))
        print("   파이썬 ↔ 배열 순회 %d건 검산, 최대 오차 %.2e  %s"
              % (n_chk, worst, "일치" if worst < 1e-4 else "★ 불일치 ★"))
        if worst >= 1e-4:
            raise SystemExit("내보낸 트리와 파이썬 예측이 다릅니다. 중단합니다.")

        # 이 항목의 학습에 실제로 등장한 지역만 기록합니다.
        # (예: 천안시는 여름 체감온도 자료가 없어 학습되지 않았으므로
        #  예측값을 내놓아서는 안 됩니다.)
        trained_regions = sorted({m[0] for m in meta}, key=REGIONS.index)
        skipped = [r for r in REGIONS if r not in trained_regions]
        if skipped:
            print("   [주의] 학습 자료가 없어 예측하지 않는 지역 : %s" % ", ".join(skipped))

        payload["targets"][key] = {
            "label": label,
            "unit": unit,
            "digits": digits,
            "regions": trained_regions,
            "base": round(base, 6),
            "trees": trees,
            "mae": round(mae, 2),
            "r2": round(r2, 3),
            "maePerScenario": per_sc,
            "observedMin": round(float(y.min()), 1),
            "observedMax": round(float(y.max()), 1),
            "sampleCount": int(len(y)),
        }

    payload["meta"]["trainRows"] = total_rows
    payload["meta"]["regionBaseline"] = {r: BASELINE[r] for r in REGIONS}

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    js = (
        "/* eslint-disable */\n"
        "/*\n"
        " * 자동 생성 파일 — 직접 수정하지 마세요.\n"
        " * data/*.csv 를 고친 뒤 `python tools/train_model.py` 로 다시 생성합니다.\n"
        " *\n"
        " * 안에 들어 있는 것\n"
        " *   co2     : 공식 시나리오 4종의 연대별 CO2 농도(ppm)\n"
        " *   targets : 예측 항목별 XGBoost 트리와 검증 성능\n"
        " *\n"
        " * 트리 노드 형식\n"
        " *   분기 [특징번호, 기준값, 작을때_다음노드, 크거나같을때_다음노드]\n"
        " *   잎   [-1, 더할 값]\n"
        " */\n"
        "const CLIMATE_MODEL = " + body + ";\n\n"
        "if (typeof module !== \"undefined\" && module.exports) {\n"
        "    module.exports = CLIMATE_MODEL;\n"
        "}\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fp:
        fp.write(js)

    print("\n" + "=" * 72)
    print("생성 완료 : %s  (%.0f KB)" %
          (os.path.relpath(OUT, BASE), len(js) / 1024))
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
