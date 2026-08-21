/* ==========================================================================
 * app.js — 지역 조회 · 변화 추이 · 지역 비교 통합 화면
 * ========================================================================== */
(function () {
    "use strict";

    var C = Climate;
    var S = Site;
    var DATA = SEARCH_DATA;

    var COLOR = {
        heat: "#c2570f",
        night: "#21578f",
        temp: "#1a1e26",
        heatObs: "#d8b49b",
        nightObs: "#9fb3c8",
        grid: "#e3e8ef",
        axis: "#55606e",
        text: "#1a1e26",
        selected: "#a3211b"
    };
    var GRADE_COLOR = { 1: "#14684a", 2: "#8a5a00", 3: "#b0450d", 4: "#a3211b" };
    var LABEL_POS = {
        "서울특별시": "top center",
        "인천광역시": "middle left",
        "세종특별자치시": "top left",
        "강원 속초시": "top right",
        "충청남도 천안시": "top right",
        "대전광역시": "bottom center",
        "대구광역시": "middle left",
        "광주광역시": "bottom left",
        "울산광역시": "top right",
        "부산광역시": "bottom right",
        "제주특별자치도": "bottom center"
    };
    var MAP_OFFSET = {
        "서울특별시": [0.06, 0.12],
        "인천광역시": [-0.12, -0.05],
        "세종특별자치시": [-0.18, 0.15],
        "대전광역시": [0.17, -0.12],
        "충청남도 천안시": [-0.12, 0.08],
        "대구광역시": [-0.08, 0.04],
        "울산광역시": [0.10, 0.07],
        "부산광역시": [0.07, -0.10]
    };

    var el = {};
    var mapPoints = [];

    function findRegion(id) {
        for (var i = 0; i < DATA.regions.length; i++) {
            if (DATA.regions[i].id === id) return DATA.regions[i];
        }
        return null;
    }

    function rowOf(region, decade) {
        if (!region) return null;
        for (var i = 0; i < region.series.length; i++) {
            if (region.series[i].decade === decade) return region.series[i];
        }
        return null;
    }

    function isSupported(id) { return !!findRegion(id); }

    function mapLon(point) {
        return point.lon + ((MAP_OFFSET[point.id] || [0, 0])[0]);
    }

    function mapLat(point) {
        return point.lat + ((MAP_OFFSET[point.id] || [0, 0])[1]);
    }

    function buildDecadeSelect() {
        var decades = DATA.meta.decades;
        el.decadeSelect.min = "0";
        el.decadeSelect.max = String(decades.length - 1);
        el.decadeSelect.step = "1";
        el.decadeTicks.innerHTML = decades.map(function (decade) {
            return "<span>" + decade + "</span>";
        }).join("");
        syncDecadeSlider();
    }

    function syncDecadeSlider() {
        var idx = DATA.meta.decades.indexOf(S.state.decade);
        el.decadeSelect.value = String(idx === -1 ? 0 : idx);
        var observed = DATA.meta.observedDecades.indexOf(S.state.decade) !== -1;
        var text = S.decadeLabel(S.state.decade) + " · " + (observed ? "관측" : "전망");
        el.decadeValue.textContent = text;
        el.decadeSelect.setAttribute("aria-valuetext", text);
    }

    function latestObserved(region) {
        var rows = region.series.filter(function (row) { return row.observed; });
        return rows.length ? rows[rows.length - 1] : region.series[0];
    }

    function rowsForDecade() {
        return DATA.regions.map(function (region) {
            var row = rowOf(region, S.state.decade);
            var risk = C.riskIndex(row);
            return {
                id: region.id,
                label: region.label,
                short: region.short,
                lon: region.lon,
                lat: region.lat,
                national: region.id === "전국",
                score: risk.score,
                grade: C.grade(risk.score),
                heat: row.heatDays,
                night: row.tropicalNights
            };
        });
    }

    function chooseRegion(id) {
        if (!isSupported(id)) return;
        S.state.region = id;
        S.saveState();
        render();
    }

    function chooseDecade(decade) {
        if (DATA.meta.decades.indexOf(decade) === -1) return;
        S.state.decade = decade;
        syncDecadeSlider();
        S.saveState();
        render();
    }

    function render() {
        if (!isSupported(S.state.region)) S.state.region = "전국";
        syncDecadeSlider();

        renderMap();
        renderRegionPicks();
        renderSummary();
        renderTrend();
        renderRank();
        S.decorateLinks();
    }

    /* ======================================================================
     * 지도
     * ==================================================================== */
    function renderMap() {
        el.mapHeading.textContent = S.decadeLabel(S.state.decade) + " 지역별 더위";
        mapPoints = rowsForDecade().filter(function (row) { return !row.national; });

        var selected = mapPoints.filter(function (row) {
            return row.id === S.state.region;
        });

        var traces = [{
            type: "scattergeo",
            mode: "markers+text",
            lon: mapPoints.map(mapLon),
            lat: mapPoints.map(mapLat),
            text: mapPoints.map(function (p) { return p.short; }),
            textposition: mapPoints.map(function (p) {
                return LABEL_POS[p.label] || "top center";
            }),
            textfont: { size: 12.5, color: COLOR.text, family: "Pretendard, sans-serif" },
            customdata: mapPoints.map(function (p) {
                return [p.label, p.score, p.grade.label, p.heat, p.night];
            }),
            marker: {
                size: mapPoints.map(function (p) { return 14 + ((p.score || 0) / 100) * 18; }),
                color: mapPoints.map(function (p) {
                    return GRADE_COLOR[p.grade.level] || "#9aa4b2";
                }),
                opacity: 0.92,
                line: { color: "#ffffff", width: 2 }
            },
            hovertemplate:
                "<b>%{customdata[0]}</b><br>폭염위험지수 %{customdata[1]}점 (%{customdata[2]})" +
                "<br>폭염 %{customdata[3]:.1f}일 · 열대야 %{customdata[4]:.1f}일" +
                "<extra></extra>"
        }];

        if (selected.length) {
            traces.push({
                type: "scattergeo",
                mode: "markers",
                lon: [mapLon(selected[0])],
                lat: [mapLat(selected[0])],
                marker: {
                    size: 30 + ((selected[0].score || 0) / 100) * 18,
                    color: "rgba(255,255,255,0)",
                    line: { color: COLOR.selected, width: 4 }
                },
                hoverinfo: "skip",
                showlegend: false
            });
        }

        var layout = {
            margin: { l: 0, r: 0, t: 0, b: 0 },
            paper_bgcolor: "rgba(0,0,0,0)",
            font: { family: "Pretendard, sans-serif", size: 13, color: COLOR.text },
            showlegend: false,
            hoverlabel: {
                bgcolor: "#fff",
                bordercolor: COLOR.grid,
                font: { family: "Pretendard, sans-serif", color: COLOR.text }
            },
            geo: {
                scope: "asia",
                resolution: 50,
                projection: { type: "mercator" },
                lonaxis: { range: [124.4, 131.4] },
                lataxis: { range: [32.8, 39.2] },
                showland: true,
                landcolor: "#f8fafc",
                showcountries: true,
                countrycolor: "#8b99a9",
                countrywidth: 1.2,
                showcoastlines: true,
                coastlinecolor: "#6f7d8d",
                coastlinewidth: 1.2,
                showocean: true,
                oceancolor: "#dceaf4",
                showlakes: false,
                showrivers: false,
                bgcolor: "rgba(0,0,0,0)"
            }
        };

        Plotly.react(el.mapChart, traces, layout, {
            displayModeBar: false,
            responsive: true,
            locale: "ko"
        }).then(function () {
            if (typeof el.mapChart.removeAllListeners === "function") {
                el.mapChart.removeAllListeners("plotly_click");
            }
            el.mapChart.on("plotly_click", function (event) {
                var point = event.points && event.points[0];
                if (!point || point.curveNumber !== 0) return;
                var hit = mapPoints[point.pointIndex];
                if (hit) chooseRegion(hit.id);
            });
        });
    }

    function renderRegionPicks() {
        el.regionPicks.innerHTML = DATA.regions.map(function (region) {
            var active = region.id === S.state.region;
            return (
                '<button type="button" class="region-pick" data-region="' +
                    C.escapeHtml(region.id) + '" aria-pressed="' + active + '">' +
                    C.escapeHtml(region.label) +
                "</button>"
            );
        }).join("");

        Array.prototype.forEach.call(
            el.regionPicks.querySelectorAll(".region-pick"),
            function (button) {
                button.addEventListener("click", function () {
                    chooseRegion(button.getAttribute("data-region"));
                });
            }
        );
    }

    /* ======================================================================
     * 선택 지역 주요 수치
     * ==================================================================== */
    function kpiTile(label, value, unit, delta, note) {
        var valueHtml = C.isNum(value)
            ? '<span class="kpi-value">' + value.toFixed(unit === "점" ? 0 : 1) +
                '<span class="kpi-unit">' + unit + "</span></span>"
            : '<span class="kpi-value is-empty">자료 없음</span>';
        var deltaHtml = delta
            ? '<span class="kpi-delta"><span class="' + delta.cls + '">' +
                C.escapeHtml(delta.text) + "</span><span>2010년대 대비</span></span>"
            : (note ? '<span class="kpi-delta">' + C.escapeHtml(note) + "</span>" : "");

        return '<div class="kpi"><span class="kpi-label">' + C.escapeHtml(label) +
            "</span>" + valueHtml + deltaHtml + "</div>";
    }

    function renderSummary() {
        var region = findRegion(S.state.region);
        var row = rowOf(region, S.state.decade);
        var base = latestObserved(region);
        var risk = C.riskIndex(row);
        var baseRisk = C.riskIndex(base);
        var grade = C.grade(risk.score);
        var humidityDelta = C.isNum(row.absHumidity) && C.isNum(base.absHumidity)
            ? C.delta(row.absHumidity, base.absHumidity, 1) : null;

        el.resultSummary.innerHTML =
            '<div class="rs-main">' +
                '<p class="rs-cond">' + S.decadeLabel(row.decade) + " · " +
                    (row.observed ? "실제 관측값" : "미래 전망값") + "</p>" +
                '<p class="rs-title">' + C.escapeHtml(region.label) + " 폭염위험지수 " +
                    (C.isNum(risk.score) ? risk.score : "–") + "점</p>" +
                '<p class="rs-note">폭염일수·열대야일수·여름 체감온도를 합쳐 0~100점으로 나타낸 값입니다</p>' +
            "</div>" +
            '<div class="rs-grade"><span class="grade-badge ' + grade.cls + '">' +
                '<i class="gb-dot" aria-hidden="true"></i>' +
                C.escapeHtml(grade.label) + "</span></div>";

        el.kpiGrid.innerHTML =
            kpiTile("폭염위험지수", risk.score, "점", C.delta(risk.score, baseRisk.score, 0)) +
            kpiTile("연평균기온", row.temp, "℃", C.delta(row.temp, base.temp, 1)) +
            kpiTile("폭염일수", row.heatDays, "일", C.delta(row.heatDays, base.heatDays, 1)) +
            kpiTile("열대야일수", row.tropicalNights, "일", C.delta(row.tropicalNights, base.tropicalNights, 1)) +
            kpiTile("여름 체감온도", row.feltSummer, "℃",
                C.isNum(row.feltSummer) && C.isNum(base.feltSummer)
                    ? C.delta(row.feltSummer, base.feltSummer, 1) : null,
                "이 지역은 자료가 없습니다") +
            kpiTile("절대습도", row.absHumidity, "g/m³", humidityDelta,
                humidityDelta ? "" : "2020년대 이후 자료");
    }

    /* ======================================================================
     * 연대별 변화
     * ==================================================================== */
    function renderTrend() {
        var region = findRegion(S.state.region);
        var series = region.series;
        var xs = series.map(function (row) { return S.decadeLabel(row.decade); });

        el.trendHeading.textContent = region.label + " 연대별 변화";
        el.trendTitle.textContent = region.label + " 연대별 변화";

        function colors(observed, projected) {
            return series.map(function (row) { return row.observed ? observed : projected; });
        }

        var traces = [
            {
                type: "bar",
                name: "폭염일수",
                x: xs,
                y: series.map(function (row) { return row.heatDays; }),
                marker: {
                    color: colors(COLOR.heatObs, COLOR.heat),
                    line: {
                        color: series.map(function (row) {
                            return row.decade === S.state.decade ? COLOR.selected : "rgba(0,0,0,0.12)";
                        }),
                        width: series.map(function (row) {
                            return row.decade === S.state.decade ? 2.5 : 0.5;
                        })
                    }
                },
                hovertemplate: "%{x}<br>폭염일수 %{y:.1f}일<extra></extra>"
            },
            {
                type: "bar",
                name: "열대야일수",
                x: xs,
                y: series.map(function (row) { return row.tropicalNights; }),
                marker: {
                    color: colors(COLOR.nightObs, COLOR.night),
                    line: {
                        color: series.map(function (row) {
                            return row.decade === S.state.decade ? COLOR.selected : "rgba(0,0,0,0.12)";
                        }),
                        width: series.map(function (row) {
                            return row.decade === S.state.decade ? 2.5 : 0.5;
                        })
                    }
                },
                hovertemplate: "%{x}<br>열대야일수 %{y:.1f}일<extra></extra>"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "연평균기온",
                x: xs,
                y: series.map(function (row) { return row.temp; }),
                yaxis: "y2",
                line: { color: COLOR.temp, width: 2.5 },
                marker: { color: COLOR.temp, size: 7 },
                hovertemplate: "%{x}<br>연평균기온 %{y:.1f}℃<extra></extra>"
            }
        ];

        var layout = {
            barmode: "group",
            bargap: 0.28,
            bargroupgap: 0.08,
            margin: { l: 58, r: 64, t: 18, b: 56 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: { family: "Pretendard, sans-serif", size: 12.5, color: COLOR.text },
            hovermode: "x unified",
            showlegend: false,
            xaxis: {
                tickangle: -30,
                showgrid: false,
                linecolor: COLOR.grid,
                tickfont: { size: 12, color: COLOR.axis },
                fixedrange: true
            },
            yaxis: {
                title: { text: "일수 (일)", font: { size: 12, color: COLOR.axis } },
                gridcolor: COLOR.grid,
                rangemode: "tozero",
                tickfont: { size: 12, color: COLOR.axis },
                fixedrange: true
            },
            yaxis2: {
                title: { text: "연평균기온 (℃)", font: { size: 12, color: COLOR.axis } },
                overlaying: "y",
                side: "right",
                showgrid: false,
                tickfont: { size: 12, color: COLOR.axis },
                fixedrange: true
            },
            shapes: [{
                type: "rect",
                xref: "x",
                yref: "paper",
                x0: -0.5,
                x1: 1.5,
                y0: 0,
                y1: 1,
                fillcolor: "rgba(107,118,132,0.07)",
                line: { width: 0 },
                layer: "below"
            }]
        };

        Plotly.react(el.trendChart, traces, layout, {
            displayModeBar: false,
            responsive: true,
            locale: "ko"
        }).then(function () {
            if (typeof el.trendChart.removeAllListeners === "function") {
                el.trendChart.removeAllListeners("plotly_click");
            }
            el.trendChart.on("plotly_click", function (event) {
                var point = event.points && event.points[0];
                if (!point || !series[point.pointIndex]) return;
                chooseDecade(series[point.pointIndex].decade);
            });
        });
    }

    /* ======================================================================
     * 같은 시기 지역 비교
     * ==================================================================== */
    function renderRank() {
        var rows = rowsForDecade();
        var locals = rows.filter(function (row) { return !row.national; })
            .sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
        var national = rows.filter(function (row) { return row.national; });
        var maxScore = Math.max.apply(null, rows.map(function (row) {
            return row.score || 0;
        }).concat([1]));

        el.rankTitle.textContent = S.decadeLabel(S.state.decade) + " 지역 비교";
        el.compareCaption.textContent = S.decadeLabel(S.state.decade) +
            " 지역별 폭염위험지수, 폭염일수, 열대야일수 비교";

        function rowHtml(row, rank) {
            var classes = [];
            if (row.id === S.state.region) classes.push("is-self");
            if (row.national) classes.push("is-national");
            var width = Math.round(((row.score || 0) / maxScore) * 100);
            return (
                "<tr" + (classes.length ? ' class="' + classes.join(" ") + '"' : "") + ">" +
                    "<td>" + (rank === null ? "–" : rank) + "</td>" +
                    '<td class="rank-region"><button type="button" class="rank-region-button" data-region="' +
                        C.escapeHtml(row.id) + '">' + C.escapeHtml(row.label) + "</button></td>" +
                    "<td><b>" + (C.isNum(row.score) ? row.score : "–") + "점</b></td>" +
                    '<td class="bar-cell"><span class="rank-bar"><span style="width:' + width +
                        "%; background:" + (GRADE_COLOR[row.grade.level] || "#9aa4b2") +
                        ';"></span></span></td>' +
                    "<td>" + C.fmt(row.heat, 1) + "일</td>" +
                    "<td>" + C.fmt(row.night, 1) + "일</td>" +
                "</tr>"
            );
        }

        var html = "";
        locals.forEach(function (row, index) { html += rowHtml(row, index + 1); });
        national.forEach(function (row) { html += rowHtml(row, null); });
        el.compareBody.innerHTML = html;

        Array.prototype.forEach.call(
            el.compareBody.querySelectorAll(".rank-region-button"),
            function (button) {
                button.addEventListener("click", function () {
                    chooseRegion(button.getAttribute("data-region"));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                });
            }
        );
    }

    document.addEventListener("DOMContentLoaded", function () {
        [
            "decadeSelect", "decadeValue", "decadeTicks", "mapHeading", "mapChart", "regionPicks",
            "resultSummary", "kpiGrid", "trendTitle", "trendHeading", "trendChart",
            "rankTitle", "compareCaption", "compareBody"
        ].forEach(function (id) { el[id] = document.getElementById(id); });

        if (!isSupported(S.state.region)) S.state.region = "전국";
        buildDecadeSelect();
        el.decadeSelect.addEventListener("input", function () {
            chooseDecade(DATA.meta.decades[parseInt(el.decadeSelect.value, 10)]);
        });
        window.addEventListener("resize", function () {
            if (el.mapChart && el.mapChart.data) Plotly.Plots.resize(el.mapChart);
            if (el.trendChart && el.trendChart.data) Plotly.Plots.resize(el.trendChart);
        });

        render();
    });
})();
