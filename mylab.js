/* ==========================================================================
 * mylab.js — ① 내가 만드는 미래 (mylab.html)
 * --------------------------------------------------------------------------
 * 사용자가 "CO2를 얼마나 배출할지"를 정하면, 그 배출 경로에 대해
 * XGBoost 모델(js/predict.js)이 우리 지역의 폭염일수·열대야일수·
 * 연평균기온·여름 체감온도를 예측합니다.
 *
 * 화면 구성
 *   1. 행동 버튼 4개 + CO2 슬라이더  (조작)
 *   2. 한 줄 결론 배너
 *   3. 3단 비교 : 지금(관측) / 공식 전망(SSP1-2.6) / 내가 만든 미래(예측)
 *   4. 전 기간 그래프 : 관측 · 공식 · 내 선택 세 선을 겹쳐 보여줌
 *   5. 해설과 대응 안내
 * ========================================================================== */
(function () {
    "use strict";

    var C = Climate;
    var S = Site;
    var P = Predict;
    var DATA = S.DATA;

    /* 행동 버튼 — 공식 시나리오 4종에 그대로 대응합니다. */
    var ACTIONS = [
        { t: 0, ico: "🌱", title: "태양광·풍력으로 바꿔요", tick: "크게 줄임" },
        { t: 1, ico: "🚗", title: "지금 하는 만큼만 노력해요", tick: "지금 수준" },
        { t: 2, ico: "🏭", title: "감축이 늦어져요", tick: "늦게 줄임" },
        { t: 3, ico: "🔥", title: "석탄·석유를 계속 늘려요", tick: "계속 증가" }
    ];

    /* 그래프에서 볼 수 있는 항목 */
    var VIEWS = [
        { key: "heatDays",       label: "폭염일수",      unit: "일", color: "#c2570f" },
        { key: "tropicalNights", label: "열대야일수",    unit: "일", color: "#21578f" },
        { key: "temp",           label: "연평균기온",    unit: "℃", color: "#0f7b6c" },
        { key: "feltSummer",     label: "여름 체감온도", unit: "℃", color: "#7a4bab" }
    ];

    var COLOR = {
        obs: "#8b99a9",        // 지금까지 관측
        official: "#14509b",   // 공식 전망 (SSP1-2.6)
        mine: "#a3211b",       // 내가 만든 미래
        grid: "#e3e8ef",
        axis: "#55606e",
        text: "#1a1e26"
    };

    var STEP = 0.125;          // 슬라이더 눈금 (0~3 을 25단계로)
    var HUMIDITY_MIN = -20;
    var HUMIDITY_MAX = 20;
    var el = {};
    var view = "heatDays";

    /* ======================================================================
     * 보조
     * ==================================================================== */
    function region() { return S.findRegion(S.state.region); }

    function officialRow(decade) {
        return S.rowOf(region(), decade);
    }

    /** 2000·2010년대 관측값 (지금까지) */
    function observedRows() {
        var r = region();
        if (!r) return [];
        return r.series.filter(function (x) { return x.observed; });
    }

    function fmt(v, d) {
        return C.isNum(v) ? v.toFixed(d === undefined ? 1 : d) : "–";
    }

    function signed(v, d) {
        if (!C.isNum(v)) return "–";
        var dig = d === undefined ? 1 : d;
        if (Math.abs(v) < Math.pow(10, -dig) / 2) return "±0";
        return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(dig);
    }

    function humidityText(v) {
        if (!v) return "기준";
        return (v > 0 ? "+" : "−") + Math.abs(Math.round(v)) + "%p";
    }

    function baselineHumidity(decade) {
        var row = officialRow(decade);
        if (row && C.isNum(row.relHumidity)) return row.relHumidity;
        var rows = region().series.filter(function (r) {
            return C.isNum(r.relHumidity);
        });
        return rows.length ? rows[0].relHumidity : 70;
    }

    function effectiveAirTemperature(felt, humidity) {
        if (!C.isNum(felt)) return null;
        var low = 10;
        var high = 50;
        for (var i = 0; i < 40; i++) {
            var mid = (low + high) / 2;
            if (C.apparentTemperature(mid, humidity) < felt) low = mid;
            else high = mid;
        }
        return (low + high) / 2;
    }

    function adjustedFeltSummer(decade, effort) {
        if (!P.canPredict("feltSummer", S.state.region)) return null;
        var base = P.value(
            "feltSummer",
            S.state.region,
            decade,
            P.co2At(effort, decade)
        );
        if (!C.isNum(base)) return null;
        var baseHumidity = baselineHumidity(decade);
        var adjustedHumidity = C.clamp(
            baseHumidity + S.state.humidityDelta,
            10,
            100
        );
        var airTemp = effectiveAirTemperature(base, baseHumidity);
        return C.apparentTemperature(airTemp, adjustedHumidity);
    }

    /* ======================================================================
     * 1. 조작 패널
     * ==================================================================== */
    function renderActions() {
        el.actGrid.innerHTML = ACTIONS.map(function (a) {
            var on = Math.abs(S.state.effort - a.t) < 1e-9;
            return (
                '<button type="button" class="act-btn" data-t="' + a.t + '"' +
                    ' aria-pressed="' + (on ? "true" : "false") + '">' +
                    '<span class="ab-ico" aria-hidden="true">' + a.ico + "</span>" +
                    '<span class="ab-title">' + C.escapeHtml(a.title) + "</span>" +
                "</button>"
            );
        }).join("");

        Array.prototype.forEach.call(
            el.actGrid.querySelectorAll(".act-btn"),
            function (b) {
                b.addEventListener("click", function () {
                    setEffort(parseFloat(b.getAttribute("data-t")));
                });
            }
        );
    }

    function renderSliderLabel() {
        var t = S.state.effort;
        var path = P.co2Path(t);
        var last = path[path.length - 1];

        el.co2Value.innerHTML =
            Math.round(last) + "<small>ppm</small>";
        el.co2Note.textContent = "";
        el.co2Slider.value = String(t);
        el.co2Slider.setAttribute("aria-valuetext",
            "2090년대 CO₂ " + Math.round(last) + "ppm");
    }

    function renderHumidityLabel() {
        var base = baselineHumidity(S.state.decade);
        var adjusted = C.clamp(base + S.state.humidityDelta, 10, 100);
        el.humidityValue.innerHTML = humidityText(S.state.humidityDelta);
        el.humidityNote.textContent =
            "기준 " + Math.round(base) + "% → " + Math.round(adjusted) +
            "% · 체감온도에 반영";
        el.humiditySlider.value = String(S.state.humidityDelta);
        el.humiditySlider.setAttribute(
            "aria-valuetext",
            "기준보다 습도 " + humidityText(S.state.humidityDelta)
        );
    }

    function setEffort(t) {
        S.state.effort = S.clampEffort(t);
        S.saveState();
        render();
    }

    /* ======================================================================
     * 2. 한 줄 결론
     * ==================================================================== */
    function renderVerdict() {
        var dec = S.state.decade;
        var mine = P.allAt(S.state.region, S.state.effort, dec);
        var off = officialRow(dec);
        var name = region().label;

        if (!C.isNum(mine.heatDays) || !off || !C.isNum(off.heatDays)) {
            el.verdict.className = "verdict";
            el.verdict.innerHTML =
                '<span class="vd-ico" aria-hidden="true">📄</span>' +
                '<span class="vd-text">이 조건에서는 비교할 폭염일수 자료가 없습니다.</span>';
            return;
        }
        var diff = mine.heatDays - off.heatDays;
        var tone = diff > 3 ? "tone-bad" : (diff < -1 ? "tone-good" : "");
        var ico = diff > 3 ? "🔥" : (diff < -1 ? "🌱" : "⚖");
        var cls = diff > 3 ? "" : " class=\"good\"";

        var text;
        if (Math.abs(diff) < 1) {
            text = "지금 고른 배출 경로는 공식 전망(온실가스를 크게 줄인 경우)과 " +
                   "거의 같습니다. <b" + cls + ">" + name + " " + dec + "년대 폭염일수 " +
                   fmt(mine.heatDays) + "일</b>";
        } else if (diff > 0) {
            text = "이렇게 배출하면 " + C.escapeHtml(name) + " " + dec + "년대 폭염일수가 " +
                   fmt(off.heatDays) + "일에서 " + fmt(mine.heatDays) + "일로, " +
                   "<b>" + fmt(diff) + "일 더 늘어납니다</b>";
        } else {
            text = "이렇게 배출하면 " + C.escapeHtml(name) + " " + dec + "년대 폭염일수가 " +
                   fmt(off.heatDays) + "일에서 " + fmt(mine.heatDays) + "일로, " +
                   "<b class=\"good\">" + fmt(Math.abs(diff)) + "일 더 줄어듭니다</b>";
        }

        el.verdict.className = "verdict " + tone;
        el.verdict.innerHTML =
            '<span class="vd-ico" aria-hidden="true">' + ico + "</span>" +
            '<span class="vd-text">' + text + "</span>";
    }

    /* ======================================================================
     * 3. 인과 사슬 — 내 선택이 폭염으로 이어지는 길
     * ----------------------------------------------------------------------
     * 화면에는 3단계로 보여 주지만, AI 는 각 단계를 CO2 농도에서 곧바로
     * 예측합니다. 앞 단계의 예측값을 다음 단계에 다시 넣지는 않습니다.
     * 그렇게 하면 앞 단계의 오차가 뒤로 쌓일 수 있습니다.
     * ==================================================================== */
    function renderChain() {
        var dec = S.state.decade;
        var reg = S.state.region;
        var name = region().label;
        var co2 = P.co2At(S.state.effort, dec);
        var offCo2 = P.officialCo2["SSP1-2.6"][P.DECADES.indexOf(dec)];

        var mineTemp = P.value("temp", reg, dec, co2);
        var mineHeat = P.value("heatDays", reg, dec, co2);
        var mineFelt = adjustedFeltSummer(dec, S.state.effort);
        var baseFelt = P.value("feltSummer", reg, dec, co2);
        var off = officialRow(dec);
        var offTemp = off ? off.temp : null;
        var offHeat = off ? off.heatDays : null;

        function delta(a, b, unit, dig) {
            if (!C.isNum(a) || !C.isNum(b)) return "";
            var d = a - b;
            var cls = d > 0.049 ? "up" : (d < -0.049 ? "down" : "flat");
            return '<span class="ch-delta ' + cls + '">' +
                   signed(d, dig) + unit + "</span>";
        }

        function step(n, tag, big, unit, dl) {
            return (
                '<li class="chain-step">' +
                    '<span class="ch-num" aria-hidden="true">' + n + "</span>" +
                    '<span class="ch-body">' +
                        '<span class="ch-tag">' + tag + "</span>" +
                        '<span class="ch-big">' + big +
                            '<small>' + unit + "</small>" + dl + "</span>" +
                    "</span>" +
                "</li>"
            );
        }

        var html =
            step(1, "내가 고른 배출량",
                 C.isNum(co2) ? Math.round(co2) : "–", "ppm",
                 delta(co2, offCo2, "ppm", 0)) +
            step(2, "그러면 " + C.escapeHtml(name) + " " + dec + "년대 연평균기온은",
                 fmt(mineTemp), "℃",
                 delta(mineTemp, offTemp, "℃", 1)) +
            step(3, "기온이 올라가면 폭염일수는",
                 fmt(mineHeat), "일",
                 delta(mineHeat, offHeat, "일", 1)) +
            step(4, "습도를 바꾸면 여름 체감온도는",
                 fmt(mineFelt), "℃",
                 delta(mineFelt, baseFelt, "℃", 1));

        el.chain.innerHTML = html;
    }

    /* ======================================================================
     * 4. 3단 비교
     * ==================================================================== */
    function renderCompare() {
        var dec = S.state.decade;
        var obs = observedRows();
        var base = obs.length ? obs[obs.length - 1] : null; // 2010년대
        var off = officialRow(dec);
        var mine = P.allAt(S.state.region, S.state.effort, dec);
        mine.feltSummer = adjustedFeltSummer(dec, S.state.effort);

        function rows(src, cmp, isMine) {
            return VIEWS.map(function (v) {
                var val = src ? src[v.key] : null;
                var noModel = isMine && !P.canPredict(v.key, S.state.region);
                var d = (cmp && C.isNum(val) && C.isNum(cmp[v.key]))
                    ? val - cmp[v.key] : null;
                var dcls = !C.isNum(d) ? "" :
                    (d > 0.05 ? "d-up" : (d < -0.05 ? "d-down" : "d-flat"));
                return (
                    '<div class="cmp-row">' +
                        '<span class="cr-name">' + C.escapeHtml(v.label) + "</span>" +
                        '<span class="cr-val' + (C.isNum(val) ? "" : " na") + '">' +
                            (C.isNum(val)
                                ? fmt(val) + "<small>" + v.unit + "</small>"
                                : (noModel ? "예측 안 함" : "자료 없음")) +
                            (C.isNum(d)
                                ? '<span class="cr-diff ' + dcls + '">' +
                                  signed(d) + "</span>"
                                : "") +
                        "</span>" +
                    "</div>"
                );
            }).join("");
        }

        function col(tag, title, sub, body, foot, mineFlag) {
            return (
                '<div class="cmp-col' + (mineFlag ? " is-mine" : "") + '">' +
                    '<div class="cmp-col-head">' +
                        '<p class="cch-tag">' + tag + "</p>" +
                        '<p class="cch-title">' + title + "</p>" +
                        '<p class="cch-sub">' + sub + "</p>" +
                    "</div>" +
                    '<div class="cmp-rows">' + body + "</div>" +
                    '<div class="cmp-foot">' + foot + "</div>" +
                "</div>"
            );
        }

        el.cmpGrid.innerHTML =
            col("① 지금까지", (base ? base.decade + "년대" : "관측") + " 실제 관측값",
                "이미 일어난 일입니다", rows(base, null, false),
                "기상청 관측자료", false) +
            col("② 크게 줄였다면", dec + "년대 공식 전망",
                "온실가스를 크게 줄인 경우", rows(off, base, false),
                "기상청 기후변화 시나리오 (괄호는 지금까지와 비교)", false) +
            col("③ 내가 고른 미래", dec + "년대 예측",
                "CO₂ " + Math.round(P.co2At(S.state.effort, dec)) + "ppm · 습도 " +
                humidityText(S.state.humidityDelta),
                rows(mine, off, true),
                "AI 예측 (괄호는 ②와 비교)", true);
    }

    /* ======================================================================
     * 5. 전 기간 그래프
     * ==================================================================== */
    function renderViewTabs() {
        el.viewTabs.innerHTML = VIEWS.map(function (v) {
            return (
                '<button type="button" role="tab" data-view="' + v.key + '"' +
                ' aria-selected="' + (v.key === view ? "true" : "false") + '">' +
                C.escapeHtml(v.label) + "</button>"
            );
        }).join("");
        Array.prototype.forEach.call(
            el.viewTabs.querySelectorAll("button"),
            function (b) {
                b.addEventListener("click", function () {
                    view = b.getAttribute("data-view");
                    renderViewTabs();
                    drawChart();
                });
            }
        );
    }

    function currentView() {
        for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].key === view) return VIEWS[i];
        return VIEWS[0];
    }

    function drawChart() {
        var v = currentView();
        var r = region();

        /* 이 지역에 학습 자료가 없는 항목이면 그래프 대신 안내를 보여 줍니다. */
        if (!P.canPredict(v.key, S.state.region)) {
            el.chartHeading.textContent = r.label + " " + v.label;
            if (el.chart.data) { Plotly.purge(el.chart); }
            el.chart.innerHTML =
                '<div class="empty-state">' +
                '<div class="es-ico" aria-hidden="true">📄</div>' +
                "<h3>이 지역은 " + C.escapeHtml(v.label) + " 예측을 제공하지 않습니다.</h3>" +
                "<p>기상청 자료에 " + C.escapeHtml(r.label) + "의 " + C.escapeHtml(v.label) +
                "가 없어서 모델을 학습할 수 없었습니다.<br />" +
                "없는 값을 지어내지 않기 위해 예측을 하지 않습니다. 다른 항목을 골라 보세요.</p>" +
                "</div>";
            return;
        }
        if (!el.chart.data) { el.chart.innerHTML = ""; }
        var decs = P.DECADES;
        var xs = decs.map(function (d) { return d + "년대"; });

        el.chartHeading.textContent = r.label + " " + v.label + " 변화" +
            (v.key === "feltSummer" && S.state.humidityDelta
                ? " · 습도 " + humidityText(S.state.humidityDelta) : "");

        /* 관측 구간 (2000·2010년대) */
        var obs = observedRows();
        var obsX = obs.map(function (o) { return o.decade + "년대"; });
        var obsY = obs.map(function (o) { return o[v.key]; });

        /* 공식 전망 (SSP1-2.6) */
        var offY = decs.map(function (d) {
            var row = officialRow(d);
            return row ? row[v.key] : null;
        });

        /* 내가 고른 경로 (AI 예측) */
        var mineY = v.key === "feltSummer"
            ? decs.map(function (d) {
                return adjustedFeltSummer(d, S.state.effort);
            })
            : P.series(v.key, S.state.region, S.state.effort);

        /* 관측 마지막 점과 전망 첫 점을 잇습니다. */
        var bridgeX = [], bridgeY = [];
        if (obs.length) {
            bridgeX = [obsX[obsX.length - 1], xs[0]];
            bridgeY = [obsY[obsY.length - 1], offY[0]];
        }

        var traces = [
            {
                type: "scatter", mode: "lines+markers", name: "지금까지(관측)",
                x: obsX, y: obsY,
                line: { color: COLOR.obs, width: 3 },
                marker: { color: COLOR.obs, size: 8 },
                hovertemplate: "%{x} 관측 %{y:.1f}" + v.unit + "<extra></extra>"
            },
            {
                type: "scatter", mode: "lines", name: "연결",
                x: bridgeX, y: bridgeY,
                line: { color: COLOR.obs, width: 1.5, dash: "dot" },
                hoverinfo: "skip", showlegend: false
            },
            {
                type: "scatter", mode: "lines+markers", name: "크게 줄였다면(공식)",
                x: xs, y: offY,
                line: { color: COLOR.official, width: 3 },
                marker: { color: COLOR.official, size: 7 },
                hovertemplate: "%{x} 공식 전망 %{y:.1f}" + v.unit + "<extra></extra>"
            },
            {
                type: "scatter", mode: "lines+markers", name: "내가 고른 미래(예측)",
                x: xs, y: mineY,
                line: { color: COLOR.mine, width: 4 },
                marker: { color: COLOR.mine, size: 9, symbol: "diamond" },
                hovertemplate: "%{x} 내 예측 %{y:.1f}" + v.unit + "<extra></extra>"
            }
        ];

        /* 두 선 사이를 채워 차이를 눈에 보이게 합니다. */
        traces.push({
            type: "scatter",
            x: xs.concat(xs.slice().reverse()),
            y: mineY.concat(offY.slice().reverse()),
            fill: "toself",
            fillcolor: "rgba(163,33,27,0.10)",
            line: { width: 0 }, hoverinfo: "skip", showlegend: false
        });

        var layout = {
            margin: { l: 58, r: 24, t: 16, b: 84 },
            paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
            font: { family: "Pretendard, sans-serif", size: 12.5, color: COLOR.text },
            hovermode: "x unified",
            hoverlabel: {
                bgcolor: "#fff", bordercolor: COLOR.grid,
                font: { family: "Pretendard, sans-serif", color: COLOR.text }
            },
            legend: {
                orientation: "h", x: 0, y: -0.2,
                xanchor: "left", yanchor: "top",
                bgcolor: "rgba(0,0,0,0)", font: { size: 12.5 }
            },
            xaxis: {
                tickangle: -30, showgrid: false, linecolor: COLOR.grid,
                tickfont: { size: 12, color: COLOR.axis }, fixedrange: true
            },
            yaxis: {
                title: { text: v.label + " (" + v.unit + ")",
                         font: { size: 12, color: COLOR.axis } },
                gridcolor: COLOR.grid, zerolinecolor: COLOR.grid,
                rangemode: v.unit === "일" ? "tozero" : "normal",
                tickfont: { size: 12, color: COLOR.axis }, fixedrange: true
            },
            shapes: [{
                type: "line", xref: "x", yref: "paper",
                x0: S.state.decade + "년대", x1: S.state.decade + "년대",
                y0: 0, y1: 1,
                line: { color: "rgba(26,30,38,0.35)", width: 1.5, dash: "dash" }
            }],
            annotations: [{
                x: S.state.decade + "년대", y: 1, xref: "x", yref: "paper",
                text: "위에서 고른 시기", showarrow: false,
                font: { size: 11.5, color: COLOR.axis },
                yanchor: "bottom", yshift: 2
            }]
        };

        Plotly.react(el.chart, traces, layout, {
            displayModeBar: false, responsive: true, locale: "ko"
        });
    }

    /* ======================================================================
     * 5. 해설과 대응
     * ==================================================================== */
    function renderStory() {
        var dec = S.state.decade;
        var name = region().label;
        var mine = P.allAt(S.state.region, S.state.effort, dec);
        mine.feltSummer = adjustedFeltSummer(dec, S.state.effort);
        var off = officialRow(dec);
        var obs = observedRows();
        var base = obs.length ? obs[obs.length - 1] : null;
        var near = P.nearestScenario(S.state.effort);
        var path = P.co2Path(S.state.effort);
        var p = [];

        p.push(
            "지금 고른 배출 경로에서 CO₂ 농도는 " +
            "2020년대 <strong>" + Math.round(path[0]) + "ppm</strong> → " +
            "2090년대 <strong>" + Math.round(path[path.length - 1]) + "ppm</strong> 으로 변합니다. " +
            "이는 기상청 공식 시나리오 <strong>" + near.key + "</strong>" +
            (near.exact ? "" : " 에 가까운 경로") + "이고, " +
            "‘" + C.escapeHtml(P.meta.scenarioLabels[near.key]) + "’ 에 해당합니다."
        );

        if (base && C.isNum(base.heatDays) && C.isNum(mine.heatDays)) {
            var mult = base.heatDays > 0 ? mine.heatDays / base.heatDays : null;
            p.push(
                C.escapeHtml(name) + "의 폭염일수는 " + base.decade + "년대 " +
                "<strong>" + fmt(base.heatDays) + "일</strong> 에서 " +
                dec + "년대 <strong>" + fmt(mine.heatDays) + "일</strong> 로 예측됩니다" +
                (mult ? " (약 <strong>" + mult.toFixed(1) + "배</strong>)" : "") + ". " +
                (off ? "온실가스를 크게 줄인 경우의 공식 전망 " + fmt(off.heatDays) + "일과 비교하면 " +
                       "<strong>" + signed(mine.heatDays - off.heatDays) + "일</strong> 차이입니다." : "")
            );
        }

        /* 지금 당장은 차이가 작고 뒤로 갈수록 벌어진다는 점 */
        var gapNow = null, gapEnd = null;
        var offSeries = P.DECADES.map(function (d) {
            var row = officialRow(d);
            return row ? row.heatDays : null;
        });
        var mineSeries = P.series("heatDays", S.state.region, S.state.effort);
        if (C.isNum(offSeries[0]) && C.isNum(mineSeries[0])) {
            gapNow = mineSeries[0] - offSeries[0];
        }
        var lastI = P.DECADES.length - 1;
        if (C.isNum(offSeries[lastI]) && C.isNum(mineSeries[lastI])) {
            gapEnd = mineSeries[lastI] - offSeries[lastI];
        }
        if (C.isNum(gapNow) && C.isNum(gapEnd)) {
            p.push(
                "중요한 점은 <strong>차이가 시간이 갈수록 벌어진다</strong>는 것입니다. " +
                "2020년대에는 공식 전망과 폭염일수 차이가 " +
                "<strong>" + fmt(Math.abs(gapNow)) + "일</strong>밖에 안 되지만, " +
                "2090년대에는 <strong>" + fmt(Math.abs(gapEnd)) + "일</strong>까지 벌어집니다. " +
                "온실가스의 영향은 쌓여서 나타나기 때문에, 지금 줄이기 시작해도 " +
                "당장은 변화가 잘 보이지 않지만 미래에는 큰 차이를 만듭니다."
            );
        }

        if (!P.canPredict("feltSummer", S.state.region)) {
            p.push(
                "다만 " + C.escapeHtml(name) + "은 기상청 자료에 여름 체감온도가 없어서 " +
                "그 항목은 <strong>예측하지 않습니다</strong>. 없는 값을 지어내지 않기 위한 것입니다."
            );
        }

        if (C.isNum(mine.tropicalNights) && C.isNum(mine.heatDays)) {
            var d = mine.tropicalNights - mine.heatDays;
            p.push(
                "예측된 열대야일수는 <strong>" + fmt(mine.tropicalNights) + "일</strong>로, " +
                (d > 5 ? "폭염일수보다 많습니다. 낮보다 <strong>밤의 더위</strong>가 더 큰 문제가 됩니다."
                       : (d < -5 ? "폭염일수보다 적습니다. <strong>낮 시간의 더위</strong>가 더 두드러집니다."
                                 : "폭염일수와 비슷합니다. 낮과 밤 모두 대비가 필요합니다."))
            );
        }

        el.story.innerHTML = p.map(function (t) {
            return '<p class="text-body">' + t + "</p>";
        }).join("");
    }

    /* ======================================================================
     * 전체 그리기
     * ==================================================================== */
    function render() {
        if (!region()) {
            el.resultArea.hidden = true;
            el.pendingBox.hidden = false;
            el.pendingTitle.textContent =
                "‘" + S.state.region + "’ 은(는) 아직 자료를 준비하고 있습니다.";
            var wrap = el.quickPicks;
            wrap.innerHTML = '<span class="qp-label">고를 수 있는 지역</span>';
            DATA.regions.forEach(function (r) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "btn btn-line btn-sm";
                b.textContent = r.label;
                b.addEventListener("click", function () {
                    S.state.region = r.id;
                    el.regionSelect.value = r.id;
                    S.saveState();
                    render();
                });
                wrap.appendChild(b);
            });
            return;
        }
        el.pendingBox.hidden = true;
        el.resultArea.hidden = false;

        renderActions();
        renderSliderLabel();
        renderHumidityLabel();
        renderVerdict();
        renderChain();
        renderCompare();
        drawChart();
        renderStory();
        S.decorateLinks();
    }

    /* ======================================================================
     * 초기화
     * ==================================================================== */
    document.addEventListener("DOMContentLoaded", function () {
        [
            "regionSelect", "decadeSelect", "actGrid",
            "co2Slider", "co2Value", "co2Note", "co2Ticks",
            "humiditySlider", "humidityValue", "humidityNote",
            "verdict", "chain",
            "cmpGrid", "viewTabs", "chart", "chartHeading",
            "story", "resultArea",
            "pendingBox", "pendingTitle", "quickPicks"
        ].forEach(function (id) { el[id] = document.getElementById(id); });

        /* 이 화면은 예측 모델이 배운 6개 지역만 다룹니다. */
        S.buildRegionSelect(el.regionSelect);
        if (!S.isSupported(S.state.region)) {
            S.state.region = el.regionSelect.value;
        }
        S.buildDecadeSelect(el.decadeSelect);

        el.co2Slider.min = String(P.T_MIN);
        el.co2Slider.max = String(P.T_MAX);
        el.co2Slider.step = String(STEP);
        el.co2Ticks.innerHTML = ACTIONS.map(function (a) {
            return "<span>" + a.tick + "</span>";
        }).join("");
        el.humiditySlider.min = String(HUMIDITY_MIN);
        el.humiditySlider.max = String(HUMIDITY_MAX);
        el.humiditySlider.step = "1";

        el.regionSelect.addEventListener("change", function () {
            S.state.region = el.regionSelect.value;
            S.saveState();
            render();
        });
        el.decadeSelect.addEventListener("change", function () {
            S.state.decade = parseInt(el.decadeSelect.value, 10);
            S.saveState();
            render();
        });
        /* input 이벤트로 끌는 동안 실시간 반영 */
        el.co2Slider.addEventListener("input", function () {
            S.state.effort = S.clampEffort(parseFloat(el.co2Slider.value));
            renderActions();
            renderSliderLabel();
            renderVerdict();
            renderChain();
            renderCompare();
            drawChart();
            renderStory();
        });
        el.co2Slider.addEventListener("change", function () { S.saveState(); });
        el.humiditySlider.addEventListener("input", function () {
            S.state.humidityDelta = S.clampHumidity(
                parseFloat(el.humiditySlider.value)
            );
            view = "feltSummer";
            renderHumidityLabel();
            renderViewTabs();
            renderChain();
            renderCompare();
            drawChart();
            renderStory();
        });
        el.humiditySlider.addEventListener("change", function () { S.saveState(); });

        window.addEventListener("resize", function () {
            if (el.chart && el.chart.data) Plotly.Plots.resize(el.chart);
        });

        renderViewTabs();
        render();
    });
})();
