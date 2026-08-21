#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""우리 지역 보기 전용 데이터 생성기.

기존 6개 지역은 build_data.py의 결과를 사용하고, data 폴더의 통합지표
CSV를 합쳐 js/search-data.js를 만듭니다. 다른 화면의 js/data.js는
변경하지 않습니다.
"""

import csv
import glob
import json
import os
import unicodedata

from build_data import DECADES, OBS_DECADES, SCENARIO, build, num, relative_humidity


BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE, "data")
OUT = os.path.join(BASE, "js", "search-data.js")

KNOWN_SOURCE_FILES = {
    "CO2.csv", "Humidity.csv", "Temperature.csv",
    "air temperature.csv", "heat wave.csv",
}

# 화면 순서와 지도 위치. 대전은 새 통합자료로 기존 값을 교체합니다.
SEARCH_REGIONS = [
    ("전국", "nationwide", 127.80, 36.40),
    ("서울특별시", "seoul", 126.98, 37.57),
    ("부산광역시", "busan", 129.08, 35.18),
    ("대구광역시", "daegu", 128.60, 35.87),
    ("인천광역시", "incheon", 126.63, 37.46),
    ("광주광역시", "gwangju", 126.85, 35.16),
    ("대전광역시", "daejeon", 127.38, 36.35),
    ("울산광역시", "ulsan", 129.31, 35.54),
    ("세종특별자치시", "sejong", 127.29, 36.48),
    ("제주특별자치도", "jeju", 126.53, 33.50),
    ("강원 속초시", "sokcho", 128.59, 38.21),
    ("충청남도 천안시", "cheonan", 127.15, 36.82),
]

SHORT_NAMES = {
    "전국": "전국", "서울특별시": "서울", "부산광역시": "부산",
    "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주",
    "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
    "제주특별자치도": "제주", "강원 속초시": "속초",
    "충청남도 천안시": "천안",
}


def normalized_name(path):
    return unicodedata.normalize("NFC", os.path.basename(path))


def integrated_files():
    files = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.csv")):
        filename = normalized_name(path)
        if filename in KNOWN_SOURCE_FILES or "_SSP시나리오_통합지표_연대별" not in filename:
            continue
        region = filename.split("_SSP시나리오_통합지표_연대별", 1)[0]
        files[region] = path
    return files


def build_integrated_region(region, slug, lon, lat, path, co2_by_decade):
    with open(path, encoding="utf-8-sig", newline="") as fp:
        source_rows = list(csv.DictReader(fp))

    rows_by_key = {}
    for row in source_rows:
        scenario = row["시나리오"].strip()
        decade = int(row["연대"])
        if decade not in DECADES:
            continue
        if decade in OBS_DECADES and scenario != "현재기후":
            continue
        if decade not in OBS_DECADES and scenario != SCENARIO:
            continue
        rows_by_key[decade] = row

    missing = [decade for decade in DECADES if decade not in rows_by_key]
    if missing:
        raise ValueError(f"{region}: 빠진 연대 {missing}")

    series = []
    for decade in DECADES:
        source = rows_by_key[decade]
        temp = num(source["기온(℃)"])
        humidity = num(source["절대습도(g/m³)"])
        series.append({
            "decade": decade,
            "scenario": "현재기후" if decade in OBS_DECADES else SCENARIO,
            "observed": decade in OBS_DECADES,
            "temp": temp,
            "heatDays": num(source["폭염일수(일)"]),
            "tropicalNights": num(source["열대야(일)"]),
            "feltYear": num(source["체감온도_연평균(℃)"]),
            "feltSummer": num(source["체감온도_여름(℃)"]),
            "feltWinter": None,
            "absHumidity": humidity,
            "relHumidity": relative_humidity(temp, humidity),
            "co2": co2_by_decade.get(decade),
        })

    return {
        "id": region,
        "label": region,
        "short": SHORT_NAMES[region],
        "slug": slug,
        "lon": lon,
        "lat": lat,
        "hasSummerFelt": True,
        "series": series,
    }


def main():
    base_regions, missing = build()
    if missing:
        raise ValueError("기존 데이터에 결측값이 있어 검색 데이터를 만들 수 없습니다.")

    base_by_name = {region["id"]: region for region in base_regions}
    co2_by_decade = {
        row["decade"]: row["co2"] for row in base_by_name["전국"]["series"]
    }
    files = integrated_files()
    expected_new = {name for name, _, _, _ in SEARCH_REGIONS if name not in base_by_name}
    expected_new.add("대전광역시")
    absent = sorted(expected_new - set(files))
    if absent:
        raise ValueError("통합지표 파일이 없습니다: " + ", ".join(absent))

    regions = []
    for name, slug, lon, lat in SEARCH_REGIONS:
        if name in files:
            region = build_integrated_region(name, slug, lon, lat, files[name], co2_by_decade)
        else:
            region = base_by_name[name]
        regions.append(region)

    payload = {
        "meta": {
            "scenario": SCENARIO,
            "observedScenario": "현재기후",
            "decades": DECADES,
            "observedDecades": sorted(OBS_DECADES),
            "baseDecade": 2000,
            "source": "우리 지역 보기 전용 통합지표",
            "sourceFiles": sorted(normalized_name(path) for path in files.values()),
        },
        "regions": regions,
    }

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    js = (
        "/* eslint-disable */\n"
        "/* tools/build_search_data.py로 생성한 우리 지역 보기 전용 데이터 */\n"
        "const SEARCH_DATA = " + body + ";\n\n"
        "if (typeof module !== \"undefined\" && module.exports) {\n"
        "    module.exports = SEARCH_DATA;\n"
        "}\n"
    )
    with open(OUT, "w", encoding="utf-8") as fp:
        fp.write(js)

    print(f"생성 완료: {os.path.relpath(OUT, BASE)}")
    print(f"  지역 {len(regions)}개 × 연대 {len(DECADES)}개 = {len(regions) * len(DECADES)}행")


if __name__ == "__main__":
    main()
