/* ==========================================================================
 * game.js — "우리동네 기후 게임"
 * --------------------------------------------------------------------------
 * 하루 동안의 선택 5개가 우리 지역의 2070년대 폭염으로 이어지는 것을
 * 직접 보게 하는 화면입니다.
 *
 * 흐름
 *   지역 고르기 → 라운드 1~5 (상황 하나마다 행동 4개 중 선택) → 결과
 *
 * 점수와 예측의 연결 (가장 중요한 부분)
 *   ① 라운드마다 배출 점수가 쌓입니다.
 *   ② 배출 점수 합계를 "배출 경로 위치 t (0~3)" 로 바꿉니다.
 *        가장 적게 배출하는 조합 → t = 0 → SSP1-2.6 (크게 줄인 미래)
 *        가장 많이 배출하는 조합 → t = 3 → SSP5-8.5 (계속 늘리는 미래)
 *   ③ t 를 js/predict.js 에 넣어 2070년대 값을 예측합니다.
 *      즉 게임 숫자와 ① 내가 만드는 미래 화면의 숫자는 같은 모델에서 나옵니다.
 *
 * 1. 점수 ↔ 배출 경로 변환
 * 2. 캐릭터 그림
 * 3. 지도
 * 4. 화면 그리기
 * 5. 라운드 진행
 * ========================================================================== */

(function () {
    "use strict";

    var C = Climate;
    var S = Site;
    var P = Predict;
    var R = GAME_ROUNDS;
    var GOAL = GAME_GOAL;
    var DECADE = GAME_DECADE;
    var RAMP_MAX = GAME_RAMP_MAX;
    var IMPACT_RAMP = ["#2f8f6b", "#76a943", "#c5a12c", "#df7629", "#c9472f", "#8f2633"];
    var REVIEW_STORE_KEY = "climate-game-review";
    var REGION_PROFILE = GAME_REGION_PROFILE;

    var el = {};

    /* 게임 상태 */
    var g = {
        region: null,
        round: 0,          // 0~4 = 진행 중, 5 = 끝
        comfort: 0,
        emit: 0,
        picks: [],         // 라운드별로 고른 행동 번호
        locked: false      // 해설을 읽는 동안 다음 라운드로 넘어가지 않게
    };

    /* 지점이 서로 가까워 이름표가 겹치므로 표기 위치를 지정합니다.
       (통합 지역 지도의 값과 같습니다.) */
    var LABEL_POS = {
        "서울특별시": "top center",
        "강원 속초시": "top right",
        "충청남도 천안시": "middle left",
        "대전광역시": "bottom center",
        "부산광역시": "middle right"
    };

    /* ======================================================================
     * 1. 점수 ↔ 배출 경로 변환
     * ==================================================================== */
    /* 라운드별 최소·최대 배출 점수를 자료에서 직접 계산합니다.
       (라운드 점수를 나중에 고쳐도 변환이 저절로 맞습니다.) */
    var EMIT_MIN = [], EMIT_MAX = [], COMF_MAX = [];
    R.forEach(function (r) {
        var e = r.opts.map(function (o) { return o.emit; });
        var c = r.opts.map(function (o) { return o.comfort; });
        EMIT_MIN.push(Math.min.apply(null, e));
        EMIT_MAX.push(Math.max.apply(null, e));
        COMF_MAX.push(Math.max.apply(null, c));
    });
    function sum(a, n) {
        var t = 0;
        for (var i = 0; i < (n === undefined ? a.length : n); i++) t += a[i];
        return t;
    }
    var EMIT_TOTAL_MIN = sum(EMIT_MIN);
    var EMIT_TOTAL_MAX = sum(EMIT_MAX);
    var COMF_TOTAL_MAX = sum(COMF_MAX);

    /** 지금까지의 배출 점수 → 배출 경로 위치 t (0~3)
     *  아직 안 지난 라운드는 계산에 넣지 않으므로, 라운드가 진행될수록
     *  t 가 조금씩 올라갑니다. 5라운드를 마치면 최종 t 가 됩니다. */
    function effortNow() {
        var played = g.picks.length;
        var floor = sum(EMIT_MIN, played);              // 그 라운드들의 최소 합
        var span = EMIT_TOTAL_MAX - EMIT_TOTAL_MIN;
        if (span <= 0) return 0;
        var t = (g.emit - floor) / span * P.T_MAX;
        return Math.min(Math.max(t, P.T_MIN), P.T_MAX);
    }

    /** 지금 상태에서 예측한 2070년대 값 묶음 */
    function outlook() {
        var t = effortNow();
        var o = P.allAt(g.region, t, DECADE);
        o.t = t;
        o.scenario = P.nearestScenario(t);
        return o;
    }

    function regionProfile(region) {
        return REGION_PROFILE[region] || REGION_PROFILE["전국"];
    }

    function heatBalance(o) {
        if (!C.isNum(o.heatDays) || !C.isNum(o.tropicalNights)) return "";
        var heat = o.heatDays.toFixed(1);
        var night = o.tropicalNights.toFixed(1);
        if (o.tropicalNights > o.heatDays + 2) {
            return "폭염 " + heat + "일보다 열대야 " + night + "일이 더 두드러집니다.";
        }
        if (o.heatDays > o.tropicalNights + 2) {
            return "열대야 " + night + "일보다 낮 폭염 " + heat + "일이 더 두드러집니다.";
        }
        return "낮 폭염 " + heat + "일과 열대야 " + night + "일이 비슷하게 나타납니다.";
    }

    function saveReview(o) {
        try {
            window.localStorage.setItem(REVIEW_STORE_KEY, JSON.stringify({
                version: 1,
                region: g.region,
                picks: g.picks.slice(),
                outlook: {
                    heatDays: o.heatDays,
                    tropicalNights: o.tropicalNights,
                    temp: o.temp,
                    co2: o.co2
                },
                createdAt: Date.now()
            }));
        } catch (e) { /* 저장할 수 없어도 게임은 그대로 진행합니다. */ }
    }

    /* ======================================================================
     * 2. 캐릭터 그림
     * ----------------------------------------------------------------------
     * 그림 파일 없이 인라인 SVG 로 그립니다. 표정은 두 가지로 정해집니다.
     *   편함 정도  → 입 모양 (찡그림 → 웃음)
     *   더위 정도  → 볼 색과 땀방울 개수
     * ==================================================================== */
    function charSvg(comfortPct, heatPct) {
        var mouth;
        if (comfortPct < 30) {
            mouth = "M40,64 Q50,56 60,64";              // 찡그림
        } else if (comfortPct < 65) {
            mouth = "M40,62 L60,62";                    // 무표정
        } else {
            mouth = "M40,58 Q50,68 60,58";              // 웃음
        }
        var cheek = 0.15 + (heatPct / 100) * 0.55;      // 더울수록 볼이 붉어짐
        var drops = heatPct < 25 ? 0 : (heatPct < 55 ? 1 : (heatPct < 80 ? 2 : 3));
        var dropXY = [[70, 30], [26, 34], [72, 46]];
        var sweat = "";
        for (var i = 0; i < drops; i++) {
            sweat += '<path d="M' + dropXY[i][0] + "," + dropXY[i][1] +
                     " c-4,6 -4,10 0,10 c4,0 4,-4 0,-10z\" fill=\"#4a90c4\" opacity=\"0.85\"/>";
        }
        return (
            '<svg viewBox="0 0 100 118" role="img" aria-hidden="true" focusable="false">' +
                /* 몸통 */
                '<path d="M22,118 V96 q0,-16 16,-20 h24 q16,4 16,20 v22z" fill="#2f5d8f"/>' +
                '<path d="M44,80 h12 v18 h-12z" fill="#e8c9a6"/>' +
                /* 얼굴 */
                '<circle cx="50" cy="52" r="30" fill="#f3d6b3"/>' +
                /* 머리카락 */
                '<path d="M20,48 q2,-30 30,-30 q28,0 30,30 q-6,-14 -30,-14 q-24,0 -30,14z" fill="#2b2b33"/>' +
                /* 볼 */
                '<circle cx="34" cy="56" r="7" fill="#e05a44" opacity="' + cheek.toFixed(2) + '"/>' +
                '<circle cx="66" cy="56" r="7" fill="#e05a44" opacity="' + cheek.toFixed(2) + '"/>' +
                /* 눈 */
                '<circle cx="39" cy="46" r="3.4" fill="#2b2b33"/>' +
                '<circle cx="61" cy="46" r="3.4" fill="#2b2b33"/>' +
                /* 입 */
                '<path d="' + mouth + '" stroke="#8a4a3a" stroke-width="3" ' +
                    'fill="none" stroke-linecap="round"/>' +
                sweat +
            "</svg>"
        );
    }

    function moodText(comfortPct, heat) {
        var body = comfortPct < 30 ? "몸이 힘들다."
                 : (comfortPct < 65 ? "그럭저럭 버틸 만하다." : "몸은 아주 편하다.");
        var air;
        if (!C.isNum(heat)) air = "";
        else if (heat < 25) air = " 2070년대 여름도 아직 견딜 만해 보인다.";
        else if (heat < 45) air = " 2070년대 여름이 조금 걱정된다.";
        else if (heat < 65) air = " 2070년대 여름은 꽤 위험해 보인다.";
        else air = " 2070년대 여름은 밖에 나가기 어려울 것 같다.";
        return body + air;
    }

    /* ======================================================================
     * 3. 지도
     * ==================================================================== */
    /** 지금까지 쌓인 배출을 초록에서 짙은 빨강까지 단계적으로 바꿉니다. */
    function impactVisual() {
        var played = g.picks.length;
        if (!played) return { marker: "#55606e" };

        var ratio = Math.min(Math.max(g.emit / EMIT_TOTAL_MAX, 0), 1);
        var index = Math.min(
            Math.ceil(ratio * (IMPACT_RAMP.length - 1)),
            IMPACT_RAMP.length - 1
        );
        return { marker: IMPACT_RAMP[index] };
    }

    function mapRows() {
        var t = effortNow();
        return P.meta.regions.filter(function (r) {
            return g.region === "전국" ? r === "전국" : r !== "전국";
        })
            .map(function (r) {
                var row = S.findRegion(r);
                var o = P.allAt(r, t, DECADE);
                return {
                    id: r,
                    label: row ? row.label : r,
                    lon: row ? row.lon : null,
                    lat: row ? row.lat : null,
                    heat: o.heatDays,
                    night: o.tropicalNights,
                    mine: r === g.region
                };
            }).filter(function (p) { return C.isNum(p.lon); });
    }

    var mapReady = false;
    function drawMap() {
        var pts = mapRows();
        var impact = impactVisual();
        var trace = {
            type: "scattergeo", mode: "markers+text",
            lon: pts.map(function (p) { return p.lon; }),
            lat: pts.map(function (p) { return p.lat; }),
            text: pts.map(function (p) { return p.mine ? "★ " + p.label : p.label; }),
            textposition: pts.map(function (p) {
                return LABEL_POS[p.label] || "top center";
            }),
            textfont: {
                /* 글자는 본문 잉크 색으로 둡니다. 색은 원이 담당합니다. */
                size: pts.map(function (p) { return p.mine ? 14 : 11.5; }),
                color: pts.map(function (p) { return p.mine ? "#1a1e26" : "#55606e"; }),
                family: "Pretendard, sans-serif"
            },
            customdata: pts.map(function (p) {
                return [C.isNum(p.heat) ? p.heat.toFixed(1) : "–",
                        C.isNum(p.night) ? p.night.toFixed(1) : "–"];
            }),
            marker: {
                size: pts.map(function (p) { return p.mine ? 38 : 17; }),
                color: pts.map(function (p) {
                    return p.mine ? impact.marker : "#c4ccd7";
                }),
                /* 겹치는 원을 떼어 놓는 2px 배경색 테두리. 우리 지역만 더 굵게. */
                line: {
                    color: pts.map(function (p) { return p.mine ? "#1a1e26" : "#ffffff"; }),
                    width: pts.map(function (p) { return p.mine ? 2.6 : 2; })
                }
            },
            hovertemplate:
                "<b>%{text}</b><br>폭염 %{customdata[0]}일 · 열대야 %{customdata[1]}일" +
                "<extra></extra>"
        };

        var layout = {
            margin: { l: 0, r: 0, t: 0, b: 0 },
            paper_bgcolor: "rgba(0,0,0,0)",
            font: { family: "Pretendard, sans-serif", size: 12, color: "#1a1e26" },
            showlegend: false,
            hoverlabel: {
                bgcolor: "#fff", bordercolor: "#e3e8ef",
                font: { family: "Pretendard, sans-serif", color: "#1a1e26" }
            },
            geo: {
                scope: "asia", resolution: 50,
                projection: { type: "mercator" },
                lonaxis: { range: [124.4, 131.4] },
                lataxis: { range: [32.8, 39.2] },
                showland: true, landcolor: "#fcfdfe",
                showcountries: true, countrycolor: "#aab5c3", countrywidth: 1.1,
                showcoastlines: true, coastlinecolor: "#8b99a9", coastlinewidth: 1.1,
                showocean: true, oceancolor: "#dde8f3",
                showlakes: false, showrivers: false,
                bgcolor: "rgba(0,0,0,0)"
            }
        };

        var job = mapReady
            ? Plotly.react(el.gameMap, [trace], layout)
            : Plotly.newPlot(el.gameMap, [trace], layout,
                { displayModeBar: false, responsive: true, locale: "ko" });

        job.then(function () { mapReady = true; }).catch(function () {
            el.gameMap.innerHTML =
                '<div class="empty-state">' +
                '<div class="es-ico" aria-hidden="true">🗺</div>' +
                "<h3>지도를 표시할 수 없습니다.</h3>" +
                "<p>지도 배경 자료를 불러오지 못했습니다.</p>" +
                "</div>";
        });

        /* 색 눈금 (지도와 같은 램프) */
        el.scaleBar.style.background =
            "linear-gradient(90deg," + IMPACT_RAMP.join(",") + ")";

    }

    /* ======================================================================
     * 4. 화면 그리기
     * ==================================================================== */
    function pct(v, lo, hi) {
        if (hi <= lo) return 0;
        return Math.min(Math.max((v - lo) / (hi - lo), 0), 1) * 100;
    }

    function renderOutlook() {
        var o = outlook();
        var heat = o.heatDays;

        el.heroVal.textContent = C.isNum(heat) ? heat.toFixed(1) : "–";
        el.co2Val.textContent = C.isNum(o.co2) ? Math.round(o.co2) : "–";
        el.nightVal.textContent = C.isNum(o.tropicalNights)
            ? o.tropicalNights.toFixed(1) : "–";
        el.tempVal.textContent = C.isNum(o.temp) ? o.temp.toFixed(1) : "–";

        var name = S.findRegion(g.region);
        el.heroSub.innerHTML =
            C.escapeHtml(name ? name.label : g.region) + " · 지금 배출 경로는 " +
            "<b>" + C.escapeHtml(o.scenario.label) + "</b>" +
            (o.scenario.exact ? "" : " 쪽") + "에 가깝습니다.";

        el.charArt.innerHTML = charSvg(
            pct(g.comfort, 0, COMF_TOTAL_MAX),
            C.isNum(heat) ? pct(heat, 0, RAMP_MAX) : 0
        );
        el.charMood.textContent = moodText(pct(g.comfort, 0, COMF_TOTAL_MAX), heat);

        drawMap();
    }

    function renderDots() {
        el.roundDots.innerHTML = R.map(function (r, i) {
            var cls = i < g.picks.length ? "is-done"
                    : (i === g.round && g.round < R.length ? "is-now" : "");
            return (
                '<li class="' + cls + '">' +
                    '<span class="gd-name">라운드</span>' +
                    '<span class="gd-num">' + (i + 1) + "</span>" +
                "</li>"
            );
        }).join("");
    }

    function renderRound() {
        var r = R[g.round];
        el.sitTitle.textContent = "라운드 " + (g.round + 1);
        el.sitWhen.textContent = r.when;
        el.sitText.textContent = r.sit;
        el.askTitle.textContent = "어떻게 할까요? (하나만 고를 수 있습니다)";

        el.cardArea.innerHTML = r.opts.map(function (o, i) {
            return (
                '<button type="button" class="gm-card" data-pick="' + i + '">' +
                    '<span class="gc-ico" aria-hidden="true">' + o.ico + "</span>" +
                    '<span class="gc-label">' + C.escapeHtml(o.label) + "</span>" +
                "</button>"
            );
        }).join("");

        Array.prototype.forEach.call(
            el.cardArea.querySelectorAll(".gm-card"),
            function (b) {
                b.addEventListener("click", function () {
                    pick(parseInt(b.getAttribute("data-pick"), 10));
                });
            }
        );

        el.feedback.hidden = true;
        el.whereLabel.textContent = (S.findRegion(g.region) || {}).label || g.region;
    }

    /* ======================================================================
     * 5. 라운드 진행
     * ==================================================================== */
    function pick(i) {
        if (g.locked || g.round >= R.length) return;
        var r = R[g.round];
        var o = r.opts[i];

        var before = outlook();

        g.locked = true;
        g.picks.push(i);
        g.comfort += o.comfort;
        g.emit += o.emit;

        var after = outlook();
        var dHeat = (C.isNum(after.heatDays) && C.isNum(before.heatDays))
            ? after.heatDays - before.heatDays : null;
        var dCo2 = (C.isNum(after.co2) && C.isNum(before.co2))
            ? after.co2 - before.co2 : null;

        renderOutlook();
        renderDots();

        /* 고른 카드만 남기고 나머지는 흐리게 */
        Array.prototype.forEach.call(
            el.cardArea.querySelectorAll(".gm-card"),
            function (b) {
                var mine = parseInt(b.getAttribute("data-pick"), 10) === i;
                b.classList.add(mine ? "is-picked" : "is-dim");
                b.disabled = true;
            }
        );

        var last = g.round === R.length - 1;
        var change;
        if (!C.isNum(dHeat)) {
            change = "";
        } else if (Math.abs(dHeat) < 0.05) {
            change = "<b>2070년대 폭염일수는 그대로입니다.</b>";
        } else if (dHeat > 0) {
            change = "이 선택으로 2070년대 폭염일수가 <b>" + dHeat.toFixed(1) +
                "일 늘었습니다.</b>" +
                (C.isNum(dCo2) && dCo2 >= 0.5
                    ? " (CO₂ +" + Math.round(dCo2) + "ppm)" : "");
        } else {
            change = "이 선택으로 2070년대 폭염일수가 <b>" + Math.abs(dHeat).toFixed(1) +
                "일 줄었습니다.</b>";
        }

        el.feedback.className = "gm-feedback" + (o.warn ? " has-warn" : "");
        el.feedback.innerHTML =
            '<p class="fb-head">' +
                '<span class="fb-ico" aria-hidden="true">' + o.ico + "</span>" +
                C.escapeHtml(o.label) +
                (o.warn ? ' <span class="fb-warn">' + C.escapeHtml(o.warn) + "</span>" : "") +
            "</p>" +
            '<p class="fb-why">' + o.why + "</p>" +
            (change ? '<p class="fb-change">' + change + "</p>" : "") +
            '<p class="fb-go"><button type="button" class="btn btn-primary" id="nextBtn">' +
                (last ? "결과 보기" : "다음 라운드로") +
            "</button></p>";
        el.feedback.hidden = false;

        document.getElementById("nextBtn").addEventListener("click", function () {
            g.locked = false;
            g.round += 1;
            if (g.round >= R.length) {
                showResult();
            } else {
                renderDots();
                renderRound();
                el.sitTitle.scrollIntoView({ block: "nearest" });
            }
        });
        S.decorateLinks();
    }

    function showResult() {
        /* 끝나면 선택 카드가 사라져 왼쪽이 비므로, 한 칸 배치로 바꿉니다.
           칸 너비가 바뀌므로 지도에게 다시 그리라고 알려 줘야 합니다.
           (Plotly 의 responsive 옵션은 창 크기 변화만 감지합니다.) */
        el.stage.classList.add("is-done");
        if (mapReady && el.gameMap && el.gameMap.data) {
            window.requestAnimationFrame(function () {
                Plotly.Plots.resize(el.gameMap);
            });
        }
        el.cardArea.innerHTML = "";
        el.askTitle.hidden = true;
        el.feedback.hidden = true;
        el.sitTitle.textContent = "하루가 끝났습니다";
        el.sitWhen.textContent = "선택 5개 완료";
        el.sitText.textContent = "선택이 만든 2070년대를 확인하세요.";

        renderDots();

        var okC = g.comfort >= GOAL.comfort;
        var okE = g.emit <= GOAL.emit;
        var best = g.comfort >= GOAL.bestComfort && g.emit <= GOAL.bestEmit;
        var o = outlook();

        var ico, tone, title;
        if (best) {
            ico = "🏆"; tone = "is-best"; title = "균형을 찾았습니다";
        } else if (okC && okE) {
            ico = "✅"; tone = "is-ok"; title = "성공했습니다";
        } else if (!okC && okE) {
            ico = "🥶"; tone = "is-half"; title = "기후는 지켰지만 하루가 너무 힘들었습니다";
        } else if (okC && !okE) {
            ico = "🔥"; tone = "is-half"; title = "편했지만 미래가 뜨거워졌습니다";
        } else {
            ico = "😵"; tone = "is-bad"; title = "둘 다 놓쳤습니다";
        }

        var name = (S.findRegion(g.region) || {}).label || g.region;

        el.resultBox.className = "gm-result " + tone;
        el.resultBox.innerHTML =
            '<p class="gr-ico" aria-hidden="true">' + ico + "</p>" +
            '<div class="gr-body">' +
                "<h3>" + C.escapeHtml(title) + "</h3>" +
                '<ul class="gr-num">' +
                    "<li><span>편함</span><b>" + g.comfort + " / " + COMF_TOTAL_MAX +
                        "</b></li>" +
                    "<li><span>배출</span><b>" + g.emit + " / " + EMIT_TOTAL_MAX +
                        "</b></li>" +
                    "<li><span>" + C.escapeHtml(name) + " 2070년대 폭염</span><b>" +
                        (C.isNum(o.heatDays) ? o.heatDays.toFixed(1) + "일" : "–") +
                        "</b></li>" +
                "</ul>" +
            "</div>";

        var profile = regionProfile(g.region);
        el.regionInsight.innerHTML =
            '<span class="gri-ico" aria-hidden="true">' + profile.ico + "</span>" +
            '<div class="gri-body">' +
                '<span class="gri-label">' + C.escapeHtml(name) + "에서 눈여겨볼 변화</span>" +
                "<h3>" + C.escapeHtml(profile.focus) + "</h3>" +
                "<p>" + C.escapeHtml(heatBalance(o)) + " " +
                    C.escapeHtml(profile.reason) + "</p>" +
            "</div>";

        el.choiceLog.innerHTML = g.picks.map(function (pi, i) {
            var r = R[i];
            var o2 = r.opts[pi];
            var bestE = Math.min.apply(null, r.opts.map(function (x) { return x.emit; }));

            /* ① 완전히 더 나은 선택 — 편함은 같거나 높은데 배출은 더 적은 것.
                  (배출이 같고 편함만 높은 경우도 포함합니다.) */
            var better = r.opts.filter(function (x) {
                return (x.comfort >= o2.comfort && x.emit < o2.emit) ||
                       (x.comfort > o2.comfort && x.emit <= o2.emit);
            }).sort(function (a, b) {
                return (a.emit - b.emit) || (b.comfort - a.comfort);
            });

            /* ② 완전히 더 나은 것은 없지만, 편함을 조금 내주면 배출을 줄일 수 있었는지.
                  배출이 같으면 편함이 높은 쪽을 권합니다. */
            var cheaper = r.opts.filter(function (x) {
                return x.emit < o2.emit && x.comfort < o2.comfort;
            }).sort(function (a, b) {
                return (a.emit - b.emit) || (b.comfort - a.comfort);
            });

            var hint, cls;
            if (o2.warn) {
                /* 점수만으로는 판단할 수 없는 선택 (예: 무단투기).
                   배출 점수가 낮다는 이유로 '괜찮은 선택'이라고 말해서는 안 됩니다. */
                cls = " is-miss";
                hint = "배출과 별개로 <b>" + C.escapeHtml(o2.warn) +
                       " 문제</b>를 남깁니다.";
            } else if (better.length) {
                var bt = better[0];
                cls = " is-miss";
                hint = "<b>저렴하게 더 나은 선택이 있었습니다</b> → " + bt.ico + " " +
                       C.escapeHtml(bt.label) +
                       " (편함 +" + bt.comfort + " · 배출 +" + bt.emit + ")";
            } else if (o2.emit === bestE) {
                cls = " is-good";
                hint = "이 라운드에서 <b>배출이 가장 적은</b> 선택입니다.";
            } else if (cheaper.length) {
                var ch = cheaper[0];
                cls = "";
                hint = ch.ico + " " + C.escapeHtml(C.josa(ch.label, "을를")) +
                       " 골랐다면 배출을 " +
                       (o2.emit - ch.emit) + "점 줄일 수 있었습니다.";
            } else {
                cls = " is-good";
                hint = "편함을 포기하지 않는 선에서 배출이 가장 적은 선택입니다.";
            }

            return (
                '<li class="' + cls.trim() + '">' +
                    '<span class="gl-when">라운드 ' + (i + 1) + "</span>" +
                    '<span class="gl-pick"><i aria-hidden="true">' + o2.ico + "</i>" +
                        C.escapeHtml(o2.label) + "</span>" +
                    '<span class="gl-score">편함 +' + o2.comfort +
                        " · 배출 +" + o2.emit + "</span>" +
                    '<span class="gl-hint">' + hint + "</span>" +
                "</li>"
            );
        }).join("");

        /* 게임이 만든 배출 경로를 그대로 다른 화면으로 넘깁니다.
           그러면 "CO₂를 직접 조절해 보기" 를 눌렀을 때 ① 화면이 방금 만든
           것과 똑같은 상태로 열려, 같은 숫자를 슬라이더로 이어서 만질 수
           있습니다. (decorateLinks 가 링크에 이 값을 붙여 줍니다.) */
        S.state.region = g.region;
        S.state.decade = DECADE;
        S.state.effort = S.clampEffort(o.t);
        S.saveState();
        saveReview(o);

        el.resultSection.hidden = false;
        el.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
        S.decorateLinks();
    }

    function start(region) {
        g.region = region;
        g.round = 0;
        g.comfort = 0;
        g.emit = 0;
        g.picks = [];
        g.locked = false;
        mapReady = false;

        /* 게임에서 고른 지역을 다른 페이지에도 이어 줍니다. */
        S.state.region = region;
        S.saveState();

        el.startScreen.hidden = true;
        el.playScreen.hidden = false;
        el.resultSection.hidden = true;
        el.stage.classList.remove("is-done");
        el.askTitle.hidden = false;

        renderDots();
        renderRound();
        renderOutlook();
        S.decorateLinks();
        el.playScreen.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function reset() {
        el.playScreen.hidden = true;
        el.resultSection.hidden = true;
        el.startScreen.hidden = false;
        mapReady = false;
        el.startScreen.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function renderRegionPick() {
        el.regionPick.innerHTML = "";
        S.DATA.regions.forEach(function (r) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "gm-region" + (r.id === S.state.region ? " is-pref" : "");
            var sub = r.id === "전국"
                ? "특정 지점이 아닌 남한 전체 평균값입니다."
                : "";
            var profile = regionProfile(r.id);
            b.innerHTML =
                '<span class="gr-name">' + C.escapeHtml(r.label) + "</span>" +
                (sub ? '<span class="gr-sub">' + sub + "</span>" : "") +
                '<span class="gr-feature">' + profile.ico + " " +
                    C.escapeHtml(profile.focus) + "</span>" +
                '<span class="gr-go">이 지역으로 시작</span>';
            b.addEventListener("click", function () { start(r.id); });
            el.regionPick.appendChild(b);
        });
    }

    /* ======================================================================
     * 초기화
     * ==================================================================== */
    document.addEventListener("DOMContentLoaded", function () {
        [
            "startScreen", "playScreen", "regionPick", "stage",
            "roundDots", "whereLabel", "restartBtn",
            "sitTitle", "sitWhen", "sitText", "charArt", "charMood",
            "askTitle", "cardArea", "feedback",
            "heroVal", "heroSub", "co2Val", "nightVal", "tempVal",
            "gameMap", "scaleBar",
            "resultSection", "resultBox", "regionInsight", "choiceLog", "againBtn",
            "learnFromGameLink"
        ].forEach(function (id) { el[id] = document.getElementById(id); });

        el.scaleBar.style.background =
            "linear-gradient(90deg," + IMPACT_RAMP.join(",") + ")";

        renderRegionPick();
        el.restartBtn.addEventListener("click", reset);
        el.againBtn.addEventListener("click", reset);

        window.addEventListener("resize", function () {
            if (mapReady && el.gameMap && el.gameMap.data) {
                Plotly.Plots.resize(el.gameMap);
            }
        });
    });
})();
