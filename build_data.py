#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
data/*.csv  ->  js/data.js  변환 스크립트

원본 CSV를 수정한 뒤 아래 명령으로 다시 실행하면 js/data.js가 갱신됩니다.

    python tools/build_data.py

브라우저에서 file:// 로 열어도 동작하도록, CSV를 fetch 하지 않고
자바스크립트 파일로 미리 변환해 둡니다.

--------------------------------------------------------------------------
자료 구성
--------------------------------------------------------------------------
* 대상 지역(6) : 전국 / 서울특별시 / 부산광역시 / 대전광역시 /
                 강원 속초시 / 충청남도 천안시
* 대상 연대    : 2000, 2010 = 현재기후(관측)
                 2020~2090  = SSP1-2.6 (10년 단위)
* 기온·폭염·체감온도 : SSP1-2.6
* 절대습도            : 원본에 SSP1-2.6 자료가 없어 SSP2-4.5 값을 사용
                        (화면·산출방법 페이지에 명시)
* CO2 농도            : SSP1-2.6 (전 지역 공통)
"""

import csv
import json
import math
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, "js", "data.js")

# 분석 대상 지역 (CSV 표기 → 화면 표기)
# slug 는 내려받기 파일명에 사용합니다. 일부 브라우저가 한글 파일명을
# 처리하지 못하고 이름을 통째로 버리는 경우가 있어 ASCII 로 둡니다.
REGIONS = [
    # csv_name,          label,             short,  slug,        lon,    lat
    ("전국",             "전국",            "전국", "nationwide", 127.80, 36.40),
    ("서울특별시",       "서울특별시",      "서울", "seoul",      126.98, 37.57),
    ("부산광역시",       "부산광역시",      "부산", "busan",      129.08, 35.18),
    ("대전광역시",       "대전광역시",      "대전", "daejeon",    127.38, 36.35),
    ("강원 속초시",      "강원 속초시",     "속초", "sokcho",     128.59, 38.21),
    ("충청남도 천안시",  "충청남도 천안시", "천안", "cheonan",    127.15, 36.82),
]

DECADES = [2000, 2010, 2020, 2030, 2040, 2050, 2060, 2070, 2080, 2090]
OBS_DECADES = {2000, 2010}          # 현재기후(관측)
SCENARIO = "SSP1-2.6"
OBS_SCENARIO = "현재기후"
HUMIDITY_SCENARIO = "SSP2-4.5"      # 원본에 SSP1-2.6 없음


def read_csv(name):
    path = os.path.join(DATA, name)
    with open(path, encoding="utf-8-sig", newline="") as fp:
        return list(csv.DictReader(fp))


def num(v):
    """빈 문자열/공백은 None, 그 외는 float."""
    if v is None:
        return None
    v = str(v).strip()
    if v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def scenario_for(decade):
    return OBS_SCENARIO if decade in OBS_DECADES else SCENARIO


# ---------------------------------------------------------------------------
# 파생값 계산
# ---------------------------------------------------------------------------
def saturation_vapor_pressure(t_c):
    """포화수증기압(hPa) — Magnus-Tetens 식."""
    return 6.112 * math.exp(17.67 * t_c / (t_c + 243.5))


def absolute_humidity_saturated(t_c):
    """해당 기온에서의 포화 절대습도(g/m3)."""
    es = saturation_vapor_pressure(t_c)
    return 216.7 * es / (273.15 + t_c)


def relative_humidity(t_c, ah_gm3):
    """절대습도(g/m3) + 기온(C) -> 상대습도(%). 연평균 기준 환산 참고값."""
    if t_c is None or ah_gm3 is None:
        return None
    sat = absolute_humidity_saturated(t_c)
    if sat <= 0:
        return None
    return round(min(100.0, max(0.0, ah_gm3 / sat * 100.0)), 1)


# ---------------------------------------------------------------------------
# 병합
# ---------------------------------------------------------------------------
def build():
    air = read_csv("air temperature.csv")
    heat = read_csv("heat wave.csv")
    felt = read_csv("Temperature.csv")
    humid = read_csv("Humidity.csv")
    co2 = read_csv("CO2.csv")

    def index_by(rows, value_fn):
        out = {}
        for r in rows:
            key = (r["지역"].strip(), r["시나리오"].strip(), int(r["연대"]))
            out[key] = value_fn(r)
        return out

    air_i = index_by(air, lambda r: num(r["평균기온"]))
    heat_i = index_by(heat, lambda r: (num(r["폭염일수"]), num(r["열대야일수"])))
    felt_i = index_by(felt, lambda r: (
        num(r["체감온도"]), num(r["체감온도(여름)"]), num(r["체감온도(겨울)"]),
        (r.get("비고") or "").strip(),
    ))
    humid_i = {}
    for r in humid:
        humid_i[(r["지역"].strip(), int(r["연대"]))] = num(r["절대습도(g/m3)"])

    co2_i = {}
    for r in co2:
        if r["시나리오"].strip() != SCENARIO:
            continue
        co2_i[int(r["연도"])] = num(r["CO2농도(ppm)"])

    regions = []
    missing = []

    for csv_name, label, short, slug, lon, lat in REGIONS:
        series = []
        for dec in DECADES:
            sc = scenario_for(dec)
            k = (csv_name, sc, dec)

            temp = air_i.get(k)
            hw = heat_i.get(k) or (None, None)
            ft = felt_i.get(k) or (None, None, None, "")
            ah = humid_i.get((csv_name, dec))          # 2000/2010은 자료 없음
            co2v = co2_i.get(dec)

            if temp is None:
                missing.append(f"{label} {dec} 평균기온")

            row = {
                "decade": dec,
                "scenario": sc,
                "observed": dec in OBS_DECADES,
                "temp": temp,                    # 연평균기온 (C)
                "heatDays": hw[0],               # 폭염일수 (일)
                "tropicalNights": hw[1],         # 열대야일수 (일)
                "feltYear": ft[0],               # 연평균 체감온도 (C)
                "feltSummer": ft[1],             # 여름 체감온도 (C)
                "feltWinter": ft[2],             # 겨울 체감온도 (C)
                "absHumidity": ah,               # 절대습도 (g/m3, SSP2-4.5)
                "relHumidity": relative_humidity(temp, ah),
                "co2": co2v,                     # CO2 농도 (ppm, SSP1-2.6)
            }
            if ft[3]:
                row["note"] = ft[3]
            series.append(row)

        regions.append({
            "id": csv_name,
            "label": label,
            "short": short,
            "slug": slug,
            "lon": lon,
            "lat": lat,
            "hasSummerFelt": any(r["feltSummer"] is not None for r in series),
            "series": series,
        })

    return regions, missing


def main():
    regions, missing = build()

    payload = {
        "meta": {
            "scenario": SCENARIO,
            "observedScenario": OBS_SCENARIO,
            "humidityScenario": HUMIDITY_SCENARIO,
            "decades": DECADES,
            "observedDecades": sorted(OBS_DECADES),
            "baseDecade": 2000,
            "source": "기상청 기후변화 시나리오(SSP) 남한 상세 전망",
            "sourceFiles": [
                "air temperature.csv", "heat wave.csv",
                "Temperature.csv", "Humidity.csv", "CO2.csv",
            ],
        },
        "regions": regions,
    }

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    js = (
        "/* eslint-disable */\n"
        "/*\n"
        " * 자동 생성 파일 — 직접 수정하지 마세요.\n"
        " * data/*.csv 를 고친 뒤 `python tools/build_data.py` 로 다시 생성합니다.\n"
        " */\n"
        "const CLIMATE_DATA = " + body + ";\n\n"
        "if (typeof module !== \"undefined\" && module.exports) {\n"
        "    module.exports = CLIMATE_DATA;\n"
        "}\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fp:
        fp.write(js)

    print(f"생성 완료: {os.path.relpath(OUT, BASE)}")
    print(f"  지역 {len(regions)}개 × 연대 {len(DECADES)}개 = {len(regions)*len(DECADES)}행")
    if missing:
        print("  [경고] 결측:", ", ".join(missing[:10]),
              f"... 총 {len(missing)}건" if len(missing) > 10 else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
