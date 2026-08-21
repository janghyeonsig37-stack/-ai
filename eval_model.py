#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
XGBOOST.md 에 실린 모든 성능 지표를 다시 계산합니다.

    python tools/eval_model.py

tools/train_model.py 는 모델을 만들어 js/model.js 로 내보내는 스크립트이고,
이 파일은 그 모델의 성능을 여러 각도로 측정해 문서용 표를 출력하는 스크립트입니다.
모델 파일을 바꾸지 않으므로 언제든 실행해도 안전합니다.

측정 항목
   1. 데이터셋 구성            2. 성능 총괄 (MAE·RMSE·R2·MAPE·편향·최대오차)
   3. 베이스라인 대비          4. 시나리오별 오차
   5. 지역별 오차              6. 연대별 오차
   7. 변수 중요도              8. 단조 제약 유무 비교
   9. 하이퍼파라미터 탐색      10. 슬라이더 해상도
  11. 공식값 재현도

모든 성능 수치는 leave-one-scenario-out 기준입니다.
(시나리오 하나를 학습에서 완전히 빼고 그것을 예측 — 사용자가 학습에 없던
 CO2 값을 넣는 상황과 같은 조건)
"""
import csv, itertools, json, os, sys
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.linear_model import LinearRegression
from sklearn.dummy import DummyRegressor

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
SSP = ["SSP1-2.6", "SSP2-4.5", "SSP3-7.0", "SSP5-8.5"]
DECADES = [2020, 2030, 2040, 2050, 2060, 2070, 2080, 2090]
REGIONS = ["전국", "서울특별시", "부산광역시", "대전광역시", "강원 속초시", "충청남도 천안시"]
TARGETS = [
    ("heatDays", "폭염일수", "heat wave.csv", "폭염일수", "일"),
    ("tropicalNights", "열대야일수", "heat wave.csv", "열대야일수", "일"),
    ("temp", "연평균기온", "air temperature.csv", "평균기온", "℃"),
    ("feltSummer", "여름 체감온도", "Temperature.csv", "체감온도(여름)", "℃"),
]
PARAMS = dict(n_estimators=150, max_depth=3, learning_rate=0.15,
              subsample=0.9, colsample_bytree=0.9, reg_lambda=1.0,
              objective="reg:squarederror", random_state=42, n_jobs=2)
BASE_DECADE = 2000
OBS_SCENARIO = "현재기후"
BASE_KEYS = [("baseHeat", "heat wave.csv", "폭염일수"),
             ("baseNight", "heat wave.csv", "열대야일수"),
             ("baseTemp", "air temperature.csv", "평균기온")]
MONO = ("(" + ",".join(["0"] * len(REGIONS) + ["0"] * len(BASE_KEYS)
        + ["0", "1"]) + ")")
FEATNAMES = (["지역:" + r for r in REGIONS]
             + ["기준:" + k for k, _, _ in BASE_KEYS] + ["연대", "CO2농도"])


def read(n):
    with open(os.path.join(DATA, n), encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    v = (v or "").strip()
    try:
        return float(v) if v else None
    except ValueError:
        return None


CO2 = {}
for r in read("CO2.csv"):
    sc, yr = r["시나리오"].strip(), int(r["연도"])
    if sc in SSP and yr in DECADES:
        CO2[(sc, yr)] = num(r["CO2농도(ppm)"])


def load_baseline():
    """지역별 2000년대 관측 기준값 (미래 자료가 아니므로 누출이 아님)"""
    out = {}
    for reg in REGIONS:
        vals = []
        for _, fname, col in BASE_KEYS:
            hit = None
            for r in read(fname):
                if (r["지역"].strip() == reg and r["시나리오"].strip() == OBS_SCENARIO
                        and int(r["연대"]) == BASE_DECADE):
                    hit = num(r[col]); break
            if hit is None:
                raise SystemExit("기준값 결측: %s / %s" % (reg, col))
            vals.append(hit)
        out[reg] = vals
    return out


BASELINE = load_baseline()


def build(fname, col):
    idx = {}
    for r in read(fname):
        idx[(r["지역"].strip(), r["시나리오"].strip(), int(r["연대"]))] = num(r[col])
    X, y, meta = [], [], []
    for reg, sc, dec in itertools.product(REGIONS, SSP, DECADES):
        v = idx.get((reg, sc, dec))
        if v is None:
            continue
        X.append([1.0 if reg == R else 0.0 for R in REGIONS]
                 + [float(v) for v in BASELINE[reg]]
                 + [float(dec), float(CO2[(sc, dec)])])
        y.append(v); meta.append((reg, sc, dec))
    return np.array(X, dtype=np.float32), np.array(y), meta


def stats(t, p):
    t, p = np.asarray(t, float), np.asarray(p, float)
    e = p - t
    nz = t != 0
    return dict(
        mae=mean_absolute_error(t, p),
        rmse=float(np.sqrt(mean_squared_error(t, p))),
        r2=r2_score(t, p),
        mape=float(np.mean(np.abs(e[nz] / t[nz])) * 100) if nz.any() else float("nan"),
        bias=float(np.mean(e)),
        maxerr=float(np.max(np.abs(e))),
        p90=float(np.percentile(np.abs(e), 90)),
    )


def loso(X, y, meta, model_fn):
    """leave-one-scenario-out 예측 모으기"""
    t, p, keys = [], [], []
    for held in SSP:
        tr = [i for i, m in enumerate(meta) if m[1] != held]
        te = [i for i, m in enumerate(meta) if m[1] == held]
        if not te:
            continue
        m = model_fn(); m.fit(X[tr], y[tr])
        pr = m.predict(X[te])
        t += list(y[te]); p += list(pr); keys += [meta[i] for i in te]
    return np.array(t), np.array(p), keys


OUT = {}

print("=" * 90)
print("1. 데이터셋 구성")
print("=" * 90)
for key, label, fname, col, unit in TARGETS:
    X, y, meta = build(fname, col)
    regs = sorted({m[0] for m in meta}, key=REGIONS.index)
    print("%-14s 행 %3d  지역 %d  시나리오 %d  연대 %d   min %.1f  max %.1f  평균 %.1f  표준편차 %.1f"
          % (label, len(y), len(regs), len({m[1] for m in meta}), len({m[2] for m in meta}),
             y.min(), y.max(), y.mean(), y.std()))
    if len(regs) < len(REGIONS):
        print("               └ 결측 지역: %s" % ", ".join(r for r in REGIONS if r not in regs))

print()
print("=" * 90)
print("2. 성능 (leave-one-scenario-out) — 지표 총괄")
print("=" * 90)
print("%-14s %8s %8s %8s %8s %8s %8s %8s" %
      ("항목", "MAE", "RMSE", "R2", "MAPE%", "편향", "최대오차", "90%오차"))
models = {}
for key, label, fname, col, unit in TARGETS:
    X, y, meta = build(fname, col)
    t, p, keys = loso(X, y, meta, lambda: xgb.XGBRegressor(**PARAMS, monotone_constraints=MONO))
    s = stats(t, p)
    print("%-14s %8.3f %8.3f %8.3f %8.2f %+8.3f %8.3f %8.3f" %
          (label, s["mae"], s["rmse"], s["r2"], s["mape"], s["bias"], s["maxerr"], s["p90"]))
    OUT[key] = dict(label=label, unit=unit, n=len(y), ymin=float(y.min()), ymax=float(y.max()),
                    ymean=float(y.mean()), ystd=float(y.std()), loso=s,
                    keys=keys, t=t.tolist(), p=p.tolist())
    m = xgb.XGBRegressor(**PARAMS, monotone_constraints=MONO); m.fit(X, y)
    models[key] = (m, X, y, meta)

print()
print("=" * 90)
print("3. 베이스라인 대비 (같은 leave-one-scenario-out 조건)")
print("=" * 90)
print("%-14s %12s %12s %12s %12s %10s" %
      ("항목", "전체평균", "지역평균", "선형회귀", "XGBoost", "개선율"))
for key, label, fname, col, unit in TARGETS:
    X, y, meta = build(fname, col)
    r = {}
    r["mean"] = stats(*loso(X, y, meta, lambda: DummyRegressor(strategy="mean"))[:2])["mae"]
    # 지역평균 : 지역 one-hot 만 쓰는 선형회귀 = 지역별 평균
    Xr = X[:, :len(REGIONS)]
    tt, pp = [], []
    for held in SSP:
        tr = [i for i, m in enumerate(meta) if m[1] != held]
        te = [i for i, m in enumerate(meta) if m[1] == held]
        mm = LinearRegression(); mm.fit(Xr[tr], y[tr])
        tt += list(y[te]); pp += list(mm.predict(Xr[te]))
    r["regmean"] = mean_absolute_error(tt, pp)
    r["lin"] = stats(*loso(X, y, meta, lambda: LinearRegression())[:2])["mae"]
    r["xgb"] = OUT[key]["loso"]["mae"]
    imp = (1 - r["xgb"] / r["lin"]) * 100
    print("%-14s %10.3f%-2s %10.3f%-2s %10.3f%-2s %10.3f%-2s %+9.1f%%" %
          (label, r["mean"], unit, r["regmean"], unit, r["lin"], unit, r["xgb"], unit, imp))
    OUT[key]["baseline"] = r

print()
print("=" * 90)
print("4. 시나리오별 오차 (해당 시나리오를 학습에서 제외했을 때)")
print("=" * 90)
print("%-14s %s" % ("항목", "".join("%14s" % s for s in SSP)))
for key in OUT:
    o = OUT[key]
    per = {}
    for s in SSP:
        idx = [i for i, k in enumerate(o["keys"]) if k[1] == s]
        per[s] = mean_absolute_error(np.array(o["t"])[idx], np.array(o["p"])[idx])
    print("%-14s %s" % (o["label"], "".join("%11.3f%-3s" % (per[s], o["unit"]) for s in SSP)))
    o["perScenario"] = per

print()
print("=" * 90)
print("5. 지역별 오차")
print("=" * 90)
print("%-14s %s" % ("항목", "".join("%12s" % r.replace("특별시", "").replace("광역시", "").replace("충청남도 ", "").replace("강원 ", "") for r in REGIONS)))
for key in OUT:
    o = OUT[key]
    per = {}
    for r in REGIONS:
        idx = [i for i, k in enumerate(o["keys"]) if k[0] == r]
        per[r] = mean_absolute_error(np.array(o["t"])[idx], np.array(o["p"])[idx]) if idx else None
    print("%-14s %s" % (o["label"], "".join(
        ("%9.3f%-3s" % (per[r], o["unit"])) if per[r] is not None else "%12s" % "—"
        for r in REGIONS)))
    o["perRegion"] = per

print()
print("=" * 90)
print("6. 연대별 오차")
print("=" * 90)
print("%-14s %s" % ("항목", "".join("%11s" % (str(d)[2:] + "s") for d in DECADES)))
for key in OUT:
    o = OUT[key]
    per = {}
    for d in DECADES:
        idx = [i for i, k in enumerate(o["keys"]) if k[2] == d]
        per[d] = mean_absolute_error(np.array(o["t"])[idx], np.array(o["p"])[idx])
    print("%-14s %s" % (o["label"], "".join("%8.3f%-3s" % (per[d], o["unit"]) for d in DECADES)))
    o["perDecade"] = per

print()
print("=" * 90)
print("7. 변수 중요도 (전체 자료 학습 모델, gain 기준 %)")
print("=" * 90)
print("%-14s %s" % ("항목", "".join("%14s" % f for f in
      ["CO2농도", "연대", "지역(6개합)", "기준값(3개합)"])))
for key in models:
    m, X, y, meta = models[key]
    b = m.get_booster()
    g = b.get_score(importance_type="gain")
    tot = sum(g.values()) or 1
    def pct(names):
        return sum(v for k, v in g.items() if k in names) / tot * 100
    nb = len(BASE_KEYS)
    co2 = pct({"f%d" % (len(REGIONS) + nb + 1)})
    dec = pct({"f%d" % (len(REGIONS) + nb)})
    reg = pct({"f%d" % i for i in range(len(REGIONS))})
    bse = pct({"f%d" % (len(REGIONS) + i) for i in range(nb)})
    print("%-14s %12.1f%% %12.1f%% %12.1f%% %12.1f%%"
          % (OUT[key]["label"], co2, dec, reg, bse))
    OUT[key]["importance"] = {"co2": co2, "decade": dec,
                              "region": reg, "baseline": bse}

print()
print("=" * 90)
print("8. 단조 증가 제약 유무 비교 (MAE)")
print("=" * 90)
print("%-14s %12s %12s %10s" % ("항목", "제약 없음", "제약 있음", "차이"))
for key, label, fname, col, unit in TARGETS:
    X, y, meta = build(fname, col)
    free = stats(*loso(X, y, meta, lambda: xgb.XGBRegressor(**PARAMS))[:2])["mae"]
    mono = OUT[key]["loso"]["mae"]
    print("%-14s %10.3f%-2s %10.3f%-2s %+9.3f" % (label, free, unit, mono, unit, mono - free))
    OUT[key]["monoCompare"] = {"free": free, "mono": mono}

print()
print("=" * 90)
print("9. 하이퍼파라미터 탐색 결과 (MAE, leave-one-scenario-out)")
print("=" * 90)
CFG = [("n400 d3 lr0.06", dict(n_estimators=400, max_depth=3, learning_rate=0.06)),
       ("n250 d3 lr0.10", dict(n_estimators=250, max_depth=3, learning_rate=0.10)),
       ("n150 d3 lr0.15", dict(n_estimators=150, max_depth=3, learning_rate=0.15)),
       ("n120 d4 lr0.15", dict(n_estimators=120, max_depth=4, learning_rate=0.15)),
       ("n80 d4 lr0.20",  dict(n_estimators=80,  max_depth=4, learning_rate=0.20)),
       ("n60 d5 lr0.25",  dict(n_estimators=60,  max_depth=5, learning_rate=0.25))]
COMMON = dict(subsample=0.9, colsample_bytree=0.9, reg_lambda=1.0,
              objective="reg:squarederror", random_state=42, n_jobs=2,
              monotone_constraints=MONO)
print("%-16s %s %12s" % ("설정", "".join("%14s" % t[1] for t in TARGETS), "model.js"))
for name, cfg in CFG:
    row, size = [], 0
    for key, label, fname, col, unit in TARGETS:
        X, y, meta = build(fname, col)
        row.append(stats(*loso(X, y, meta, lambda: xgb.XGBRegressor(**COMMON, **cfg))[:2])["mae"])
        m = xgb.XGBRegressor(**COMMON, **cfg); m.fit(X, y)
        size += len(json.dumps([json.loads(d) for d in m.get_booster().get_dump(dump_format="json")],
                               separators=(",", ":")))
    print("%-16s %s %9.0f KB" % (name, "".join("%11.3f%-3s" % (v, TARGETS[i][4])
          for i, v in enumerate(row)), size / 1024))

print()
print("=" * 90)
print("10. 슬라이더 해상도 — 0→3 을 151단계로 끌 때 서로 다른 예측값 개수 (서울, 폭염일수)")
print("=" * 90)
def co2_path(t):
    lo = int(np.floor(min(max(t, 0), 3))); hi = min(lo + 1, 3); f = t - lo
    a = [CO2[(SSP[lo], d)] for d in DECADES]; b = [CO2[(SSP[hi], d)] for d in DECADES]
    return [a[i] * (1 - f) + b[i] * f for i in range(len(DECADES))]
m, X, y, meta = models["heatDays"]
print("%-10s %s" % ("", "".join("%9s" % (str(d)[2:] + "s") for d in DECADES)))
cnt = []
for di, d in enumerate(DECADES):
    vals = set()
    for t in np.arange(0, 3.0001, 0.02):
        c = co2_path(t)[di]
        row = np.array([[1.0 if r == "서울특별시" else 0.0 for r in REGIONS]
                        + [float(v) for v in BASELINE["서울특별시"]]
                        + [float(d), c]], dtype=np.float32)
        vals.add(round(float(m.predict(row)[0]), 2))
    cnt.append(len(vals))
print("%-10s %s" % ("단계 수", "".join("%9d" % c for c in cnt)))
print("%-10s %s" % ("CO2 폭", "".join("%9d" % (CO2[("SSP5-8.5", d)] - CO2[("SSP1-2.6", d)]) for d in DECADES)))

print()
print("=" * 90)
print("11. 공식값 재현도 — 학습 자료 전체로 학습한 모델이 공식 4개 시나리오를 얼마나 맞추나")
print("=" * 90)
print("%-14s %s" % ("항목", "".join("%14s" % s for s in SSP)))
for key in models:
    m, X, y, meta = models[key]
    p = m.predict(X)
    per = {}
    for s in SSP:
        idx = [i for i, k in enumerate(meta) if k[1] == s]
        per[s] = mean_absolute_error(y[idx], p[idx])
    print("%-14s %s" % (OUT[key]["label"], "".join("%11.3f%-3s" % (per[s], OUT[key]["unit"]) for s in SSP)))
    OUT[key]["inSample"] = per

json.dump({k: {kk: vv for kk, vv in v.items() if kk not in ("keys", "t", "p")}
           for k, v in OUT.items()},
          open(os.path.join(BASE, "tools", "metrics.json"), "w"), ensure_ascii=False, indent=1)
print("\n지표를 tools/metrics.json 에 저장했습니다.")
