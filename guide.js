/* ==========================================================================
 * guide.js — 기후 개념 안내 페이지
 * --------------------------------------------------------------------------
 * 1. 기준 지점 선택
 * 2. 개념 4종의 단계별 설명 (모든 수치는 data.js 원자료에서 직접 산출)
 * 3. 폭염·기후·행동을 다루는 5문제 퀴즈
 * ========================================================================== */
(function () {
    "use strict";

    var C = Climate;
    var S = Site;
    var DATA = S.DATA;
    var REVIEW_STORE_KEY = "climate-game-review";

    /* 지점은 다른 페이지와 공유합니다(Site.state). 주제만 이 화면의 상태입니다. */
    var state = { region: S.state.region, topic: "hot" };
    var el = {};
    var gameReview = readGameReview();

    if (gameReview) state.region = gameReview.region;

    function readGameReview() {
        try {
            var raw = window.localStorage.getItem(REVIEW_STORE_KEY);
            if (!raw) return null;
            var saved = JSON.parse(raw);
            if (!saved || !S.findRegion(saved.region) || !Array.isArray(saved.picks) ||
                    saved.picks.length !== GAME_ROUNDS.length) return null;
            for (var i = 0; i < saved.picks.length; i++) {
                if (!Number.isInteger(saved.picks[i]) ||
                        !GAME_ROUNDS[i].opts[saved.picks[i]]) return null;
            }
            return saved;
        } catch (e) { return null; }
    }

    function activeGameReview() {
        return gameReview && gameReview.region === state.region ? gameReview : null;
    }

    /* ---- 자료 접근 보조 ---- */
    function region() {
        for (var i = 0; i < DATA.regions.length; i++) {
            if (DATA.regions[i].id === state.region) return DATA.regions[i];
        }
        return DATA.regions[0];
    }

    function at(decade) {
        var s = region().series;
        for (var i = 0; i < s.length; i++) if (s[i].decade === decade) return s[i];
        return null;
    }

    function f(v, d) { return C.fmt(v, d === undefined ? 1 : d); }

    /** 유효한 값이 있는 마지막 연대 행을 찾습니다. */
    function lastWith(key) {
        var s = region().series;
        for (var i = s.length - 1; i >= 0; i--) {
            if (C.isNum(s[i][key])) return s[i];
        }
        return null;
    }

    /** 값이 있는 첫 연대 행 */
    function firstWith(key) {
        var s = region().series;
        for (var i = 0; i < s.length; i++) {
            if (C.isNum(s[i][key])) return s[i];
        }
        return null;
    }

    function name() { return region().label; }
    function subj() { return C.josa(name(), "은는"); }

    /* ======================================================================
     * 2. 개념 정의
     * ====================================================================
     * 각 step 의 body 는 함수로 두어, 지점을 바꿀 때마다 해당 지점의
     * 실제 자료값으로 문장이 다시 만들어지도록 했습니다.
     * ==================================================================== */
    var TOPICS = [
        {
            key: "hot",
            ico: "🔥",
            title: "왜 더워지나요?",
            desc: "온실가스 → 기온 → 폭염일수로 이어지는 과정",
            heading: "왜 점점 더워지나요?",
            subhead: "온실가스 농도 · 연평균기온 · 폭염일수를 차례로 확인합니다.",
            foot: "폭염일수는 33℃라는 고정된 문턱을 넘는 날을 세는 값이므로, " +
                  "평균기온이 조금만 올라도 문턱을 넘는 날이 크게 늘어납니다. " +
                  "이것이 평균기온 변화보다 폭염일수 변화가 훨씬 크게 보이는 이유입니다.",
            steps: function () {
                var d2020 = at(2020), d2090 = at(2090), d2000 = at(2000);
                var sel = at(2050);
                var out = [];

                out.push({
                    h: "온실가스가 공기 중에 쌓입니다",
                    p: "석탄·석유를 태우면 이산화탄소(CO₂)가 공기 중에 늘어납니다. " +
                       "CO₂는 지표에서 나가는 열을 붙잡아 두기 때문에, 농도가 높아지면 " +
                       "지구가 내보내는 열이 줄어들어 기온이 올라갑니다.",
                    data: "SSP1-2.6 시나리오 CO₂ 농도 : " +
                          "2020년대 <b>" + f(d2020.co2, 0) + " ppm</b> → " +
                          "2050년대 <b>" + f(sel.co2, 0) + " ppm</b> → " +
                          "2090년대 <b>" + f(d2090.co2, 0) + " ppm</b>"
                });

                out.push({
                    h: "기온이 올라갑니다",
                    p: subj() + " 연평균기온이 꾸준히 올라갑니다. 다만 상승폭 자체는 " +
                       "몇 ℃ 수준으로 크지 않아 보입니다. 여기서 끝이 아니라는 것이 중요합니다.",
                    data: name() + " 연평균기온 : " +
                          "2000년대 <b>" + f(d2000.temp) + "℃</b>(관측) → " +
                          "2090년대 <b>" + f(d2090.temp) + "℃</b>(전망) · " +
                          "차이 <b>" + plus(d2090.temp - d2000.temp) + "℃</b>"
                });

                out.push({
                    h: "폭염일수는 훨씬 크게 늘어납니다",
                    p: "폭염일수는 ‘일최고기온 33℃ 이상’인 날을 세는 값입니다. " +
                       "평균이 조금만 올라가도 33℃ 문턱을 넘는 날은 크게 늘어납니다. " +
                       "기온 그래프보다 폭염일수 그래프가 훨씬 급하게 오르는 이유입니다.",
                    data: name() + " 폭염일수 : " +
                          "2000년대 <b>" + f(d2000.heatDays) + "일</b> → " +
                          "2090년대 <b>" + f(d2090.heatDays) + "일</b> · " +
                          "차이 <b>" + plus(d2090.heatDays - d2000.heatDays) + "일</b>"
                });

                out.push({
                    h: "감축하면 달라집니다",
                    p: "위 수치는 온실가스 감축이 상당히 이행되는 SSP1-2.6 경로의 결과입니다. " +
                       "이 경로에서는 CO₂ 농도가 21세기 중반 이후 정점을 지나 다시 낮아집니다. " +
                       "감축이 지연되는 경로에서는 같은 시점의 폭염일수가 더 크게 늘어납니다.",
                    data: co2PeakLine()
                });

                return out;
            }
        },

        {
            key: "night",
            ico: "🌙",
            title: "폭염과 열대야는 뭐가 다른가요?",
            desc: "낮의 더위와 밤의 더위는 지역마다 다릅니다",
            heading: "폭염과 열대야는 어떻게 다른가요?",
            subhead: "낮의 더위(폭염)와 밤의 더위(열대야)는 지역별로 크게 갈립니다.",
            foot: "지역 대책도 달라집니다. 폭염이 두드러지는 곳은 낮 시간 옥외 활동 " +
                  "조정과 주간 쉼터가 중요하고, 열대야가 두드러지는 곳은 야간 냉방과 " +
                  "수면 환경 관리가 더 중요합니다.",
            steps: function () {
                var sel = at(2050);
                var d2000 = at(2000);
                var out = [];

                out.push({
                    h: "정의가 다릅니다",
                    p: "폭염일수는 <strong>일최고기온 33℃ 이상</strong>인 날을 셉니다. " +
                       "열대야일수는 <strong>밤 최저기온 25℃ 이상</strong>인 날을 셉니다. " +
                       "폭염은 낮의 최고점을, 열대야는 밤의 최저점을 보는 지표입니다.",
                    data: null
                });

                out.push({
                    h: subj() + " 어느 쪽이 두드러질까요",
                    p: (function () {
                        var diff = sel.tropicalNights - sel.heatDays;
                        if (diff > 5) {
                            return subj() + " 열대야가 폭염보다 " + Math.abs(diff).toFixed(1) +
                                   "일 많습니다. 낮 더위보다 밤에 기온이 충분히 " +
                                   "내려가지 않는 것이 더 큰 문제인 지역입니다.";
                        }
                        if (diff < -5) {
                            return subj() + " 폭염이 열대야보다 " + Math.abs(diff).toFixed(1) +
                                   "일 많습니다. 낮 시간대의 고온이 두드러지는 지역입니다.";
                        }
                        return subj() + " 폭염과 열대야가 비슷한 수준(차이 " +
                               Math.abs(diff).toFixed(1) + "일)으로, 낮과 밤의 " +
                               "부담이 함께 나타나는 지역입니다.";
                    })(),
                    data: name() + " 2050년대 : 폭염 <b>" + f(sel.heatDays) + "일</b> · " +
                          "열대야 <b>" + f(sel.tropicalNights) + "일</b>"
                });

                out.push({
                    h: "지역차가 매우 큽니다",
                    p: "같은 2050년대라도 지역에 따라 낮·밤의 더위 구조가 다릅니다. " +
                       "바다에 접한 지역은 낮 최고기온은 상대적으로 낮아도 " +
                       "밤에 열이 잘 식지 않아 열대야가 많고, 내륙 분지는 " +
                       "낮 최고기온이 크게 올라 폭염일수가 많습니다.",
                    data: compareLine(2050)
                });

                out.push({
                    h: "밤의 더위가 더 빠르게 늘고 있습니다",
                    p: "관측 기간과 비교하면 " + name() + "에서도 열대야의 증가폭이 " +
                       "폭염의 증가폭에 못지않게 큽니다. 밤 기온은 도시화와 " +
                       "습도의 영향을 함께 받기 때문입니다.",
                    data: name() + " 2000년대 → 2050년대 : 폭염 " +
                          "<b>" + plus(sel.heatDays - d2000.heatDays) + "일</b> · " +
                          "열대야 <b>" + plus(sel.tropicalNights - d2000.tropicalNights) + "일</b>"
                });

                return out;
            }
        },

        {
            key: "humid",
            ico: "💧",
            title: "왜 더 습해지나요?",
            desc: "기온이 오르면 대기 중 수증기량도 늘어납니다",
            heading: "왜 점점 더 습해지나요?",
            subhead: "절대습도와 체감온도의 관계를 확인합니다.",
            foot: "본 서비스의 절대습도 자료는 원자료에 SSP1-2.6 값이 없어 " +
                  "SSP2-4.5 값을 사용합니다. 시나리오가 다르므로 기온·폭염일수와 " +
                  "직접 비교할 때에는 이 점을 함께 고려해야 합니다.",
            steps: function () {
                var h1 = firstWith("absHumidity");
                var h2 = lastWith("absHumidity");
                var sel = at(2050);
                var out = [];

                out.push({
                    h: "따뜻한 공기는 수증기를 더 많이 품습니다",
                    p: "기온이 1℃ 오르면 공기가 품을 수 있는 수증기 최대량은 " +
                       "약 7% 늘어납니다(클라우지우스–클라페이롱 관계). " +
                       "따라서 기온이 오르면 대기 중 실제 수증기량인 " +
                       "절대습도도 함께 증가하는 경향이 나타납니다.",
                    data: null
                });

                out.push({
                    h: name() + "의 절대습도 변화",
                    p: "절대습도는 공기 1m³ 안에 들어 있는 수증기의 질량입니다. " +
                       "상대습도(%)와 달리 기온이 변해도 값이 바뀌지 않아 " +
                       "수증기 총량의 변화를 보기에 적합합니다.",
                    data: h1 && h2
                        ? name() + " 절대습도 : " + h1.decade + "년대 <b>" +
                          f(h1.absHumidity, 2) + " g/m³</b> → " + h2.decade + "년대 <b>" +
                          f(h2.absHumidity, 2) + " g/m³</b> · 차이 <b>" +
                          plus(h2.absHumidity - h1.absHumidity, 2) + " g/m³</b>"
                        : "이 지점은 절대습도 자료가 없습니다."
                });

                out.push({
                    h: "습도가 오르면 체감온도가 오릅니다",
                    p: "사람은 땀이 증발할 때 몸의 열을 빼앗기며 시원해집니다. " +
                       "습도가 높으면 땀이 잘 증발하지 않아 열이 빠져나가지 못하고, " +
                       "기온이 같아도 훨씬 더 덥게 느껴집니다. " +
                       "그래서 <strong>기온만으로는 더위의 위험을 판단할 수 없습니다.</strong>",
                    data: C.isNum(sel.feltSummer)
                        ? name() + " 2050년대 : 연평균기온 <b>" + f(sel.temp) + "℃</b> · " +
                          "여름 체감온도 <b>" + f(sel.feltSummer) + "℃</b>"
                        : "이 지점은 원자료에 여름 체감온도가 수록되어 있지 않습니다."
                });

                out.push({
                    h: "폭염일수는 습도와 무관하게 정의됩니다",
                    p: "여기서 자주 오해가 생깁니다. 폭염일수와 열대야일수는 " +
                       "<strong>기온만으로</strong> 정의됩니다(33℃, 25℃). " +
                       "따라서 습도가 올라도 폭염일수 자체는 변하지 않습니다. " +
                       "달라지는 것은 <strong>체감온도와 실제 건강 위험</strong>입니다. " +
                       "같은 폭염일수라도 습도가 높은 지역이 더 위험합니다.",
                    data: C.isNum(sel.relHumidity)
                        ? name() + " 2050년대 환산 상대습도 : 약 <b>" +
                          f(sel.relHumidity, 0) + "%</b> (연평균 기준 참고값)"
                        : null
                });

                return out;
            }
        },

        {
            key: "winter",
            ico: "❄️",
            title: "겨울은 어떻게 바뀌나요?",
            desc: "겨울 평균은 오르지만 한파가 사라지지는 않습니다",
            heading: "겨울은 어떻게 바뀌나요?",
            subhead: "겨울 체감온도 자료로 확인하고, 흔한 오해를 함께 정리합니다.",
            foot: "‘지구가 더워지는데 왜 한파가 오나’라는 의문이 자주 제기됩니다. " +
                  "평균값이 오르는 것과 특정 해에 강한 한파가 오는 것은 서로 " +
                  "모순되지 않습니다. 평균은 추세를, 한파는 개별 사건을 나타냅니다.",
            steps: function () {
                var w1 = firstWith("feltWinter");
                var w2 = lastWith("feltWinter");
                var out = [];

                out.push({
                    h: "겨울 평균은 분명히 올라갑니다",
                    p: "겨울철 체감온도 자료를 보면 " + name() + "의 겨울은 " +
                       "시간이 갈수록 덜 추워지는 방향으로 변합니다. " +
                       "이는 연평균기온 상승과 같은 방향의 변화입니다.",
                    data: w1 && w2
                        ? name() + " 겨울 체감온도 : " + w1.decade + "년대 <b>" +
                          f(w1.feltWinter) + "℃</b> → " + w2.decade + "년대 <b>" +
                          f(w2.feltWinter) + "℃</b> · 차이 <b>" +
                          plus(w2.feltWinter - w1.feltWinter) + "℃</b>"
                        : "이 지점은 원자료에 겨울 체감온도가 수록되어 있지 않습니다."
                });

                out.push({
                    h: "그런데도 한파는 계속 옵니다",
                    p: "평균이 오른다는 것은 ‘추운 해가 없어진다’는 뜻이 아닙니다. " +
                       "겨울 기온은 해마다 크게 오르내리므로, 상승 추세 속에서도 " +
                       "특정 해에는 예전보다 더 강한 한파가 나타날 수 있습니다.",
                    data: null
                });

                out.push({
                    h: "자료를 볼 때 주의할 점",
                    p: "본 서비스의 값은 <strong>10년 평균</strong>입니다. " +
                       "따라서 특정 연도의 최저기온이나 한파 일수를 나타내지 않습니다. " +
                       "실제 자료에서도 폭염일수가 매 연대 단조롭게 늘지 않고 " +
                       "오르내리는 구간이 나타나는데, 이는 10년 평균에 남아 있는 " +
                       "자연 변동 때문입니다.",
                    data: (function () {
                        var a = at(2040), b = at(2050);
                        if (!a || !b) return null;
                        return name() + " 폭염일수 : 2040년대 <b>" + f(a.heatDays) +
                               "일</b> → 2050년대 <b>" + f(b.heatDays) + "일</b>" +
                               (b.heatDays < a.heatDays
                                   ? " (일시적으로 감소 — 자연 변동)" : "");
                    })()
                });

                out.push({
                    h: "여름과 겨울을 함께 봐야 합니다",
                    p: "기후변화의 영향은 여름의 더위만이 아닙니다. " +
                       "겨울이 덜 추워지면 난방 수요는 줄지만, 병해충 월동 조건이나 " +
                       "농작물 개화 시기 등 다른 영향이 함께 나타납니다. " +
                       "여름 체감온도와 겨울 체감온도를 같이 보면 " +
                       "연중 변화의 방향을 파악할 수 있습니다.",
                    data: (function () {
                        var s = at(2050);
                        if (!s || !C.isNum(s.feltSummer) || !C.isNum(s.feltWinter)) return null;
                        return name() + " 2050년대 체감온도 : 여름 <b>" +
                               f(s.feltSummer) + "℃</b> · 겨울 <b>" +
                               f(s.feltWinter) + "℃</b>";
                    })()
                });

                return out;
            }
        }
    ];

    function plus(v, d) {
        if (!C.isNum(v)) return "–";
        var dig = d === undefined ? 1 : d;
        return (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(dig);
    }

    /** SSP1-2.6 CO2 농도의 정점과 말기 값을 자료에서 직접 찾아 문장으로 만듭니다. */
    function co2PeakLine() {
        var s = DATA.regions[0].series.filter(function (r) { return C.isNum(r.co2); });
        if (!s.length) return null;
        var peak = s.reduce(function (a, b) { return b.co2 > a.co2 ? b : a; }, s[0]);
        var last = s[s.length - 1];
        if (peak.decade === last.decade) {
            return "SSP1-2.6 CO₂ 농도 : " + last.decade + "년대 <b>" +
                   f(last.co2, 0) + " ppm</b>";
        }
        return "SSP1-2.6 CO₂ 농도 정점 : " + peak.decade + "년대 <b>" +
               f(peak.co2, 0) + " ppm</b> → " + last.decade + "년대 <b>" +
               f(last.co2, 0) + " ppm</b> (감소 전환)";
    }

    /** 특정 연대의 지점별 폭염/열대야 대비 한 줄 */
    function compareLine(decade) {
        var rows = DATA.regions
            .filter(function (r) { return r.id !== "전국"; })
            .map(function (r) {
                var s = null;
                for (var i = 0; i < r.series.length; i++) {
                    if (r.series[i].decade === decade) s = r.series[i];
                }
                return { label: r.short, heat: s.heatDays, night: s.tropicalNights };
            });
        var maxHeat = rows.slice().sort(function (a, b) { return b.heat - a.heat; })[0];
        var maxNight = rows.slice().sort(function (a, b) { return b.night - a.night; })[0];
        return decade + "년대 폭염일수 최다 <b>" + maxHeat.label + " " +
               f(maxHeat.heat) + "일</b> · 열대야일수 최다 <b>" + maxNight.label + " " +
               f(maxNight.night) + "일</b>";
    }

    /* ======================================================================
     * 렌더링
     * ==================================================================== */
    function buildRegionSelect() {
        S.buildRegionSelect(el.guideRegion);
        if (el.guideRegion.value !== state.region) {
            // 상세 자료가 없는 지역이 저장돼 있으면 첫 지점으로 맞춥니다.
            state.region = el.guideRegion.value;
        }
    }

    function renderTopics() {
        el.topicGrid.innerHTML = TOPICS.map(function (t) {
            return (
                '<button type="button" class="topic-card" data-topic="' + t.key + '"' +
                    ' aria-pressed="' + (t.key === state.topic ? "true" : "false") + '">' +
                    '<span class="tc-ico" aria-hidden="true">' + t.ico + "</span>" +
                    '<span class="tc-title">' + C.escapeHtml(t.title) + "</span>" +
                    '<span class="tc-desc">' + C.escapeHtml(t.desc) + "</span>" +
                "</button>"
            );
        }).join("");

        Array.prototype.forEach.call(
            el.topicGrid.querySelectorAll(".topic-card"),
            function (btn) {
                btn.addEventListener("click", function () {
                    state.topic = btn.getAttribute("data-topic");
                    renderTopics();
                    renderSteps();
                    el.stepHeading.scrollIntoView({ behavior: "smooth", block: "center" });
                });
            }
        );
    }

    function currentTopic() {
        for (var i = 0; i < TOPICS.length; i++) {
            if (TOPICS[i].key === state.topic) return TOPICS[i];
        }
        return TOPICS[0];
    }

    function renderSteps() {
        var t = currentTopic();
        el.stepHeading.textContent = t.heading;
        el.stepDesc.textContent = t.subhead;
        el.stepFoot.textContent = t.foot;

        var steps = t.steps();
        el.stepList.innerHTML = steps.map(function (s) {
            return (
                '<div class="step-item">' +
                    "<h4>" + s.h + "</h4>" +
                    "<p>" + s.p + "</p>" +
                    (s.data ? '<span class="step-data">' + s.data + "</span>" : "") +
                "</div>"
            );
        }).join("");
    }

    function syncLink() {
        // 고른 지점을 다른 페이지와 공유합니다.
        S.state.region = state.region;
        S.saveState();
    }

    function reviewBalance(outlook) {
        if (!outlook || !C.isNum(outlook.heatDays) ||
                !C.isNum(outlook.tropicalNights)) return "";
        var heat = f(outlook.heatDays);
        var night = f(outlook.tropicalNights);
        if (outlook.tropicalNights > outlook.heatDays + 2) {
            return "낮 폭염 " + heat + "일보다 열대야 " + night + "일이 더 많았습니다.";
        }
        if (outlook.heatDays > outlook.tropicalNights + 2) {
            return "열대야 " + night + "일보다 낮 폭염 " + heat + "일이 더 많았습니다.";
        }
        return "낮 폭염 " + heat + "일과 열대야 " + night + "일이 비슷했습니다.";
    }

    function renderGameReview() {
        var saved = activeGameReview();
        el.gameReview.hidden = !saved;
        if (!saved) return;

        var profile = GAME_REGION_PROFILE[saved.region] || GAME_REGION_PROFILE["전국"];
        var regionName = (S.findRegion(saved.region) || {}).label || saved.region;
        el.gameReviewRegion.textContent = regionName;
        el.gameReviewSummary.innerHTML =
            '<span class="grs-ico" aria-hidden="true">' + profile.ico + "</span>" +
            '<div class="grs-body">' +
                "<h3>" + C.escapeHtml(profile.focus) + "</h3>" +
                "<p>" + C.escapeHtml(reviewBalance(saved.outlook)) + " " +
                    C.escapeHtml(profile.reason) + "</p>" +
            "</div>";

        el.gameReviewChoices.innerHTML = saved.picks.map(function (pickIndex, i) {
            var round = GAME_ROUNDS[i];
            var choice = round.opts[pickIndex];
            return (
                "<li>" +
                    '<span class="grc-round">라운드 ' + (i + 1) + "</span>" +
                    '<span class="grc-choice"><i aria-hidden="true">' + choice.ico + "</i>" +
                        C.escapeHtml(choice.label) + "</span>" +
                    '<span class="grc-why">' + C.escapeHtml(choice.why) + "</span>" +
                "</li>"
            );
        }).join("");
    }

    /* ======================================================================
     * 3. 확인 퀴즈
     * ==================================================================== */
    var PAIRS = [
        { a: { t: 30, h: 40 }, b: { t: 27, h: 85 } },
        { a: { t: 33, h: 35 }, b: { t: 29, h: 80 } },
        { a: { t: 34, h: 35 }, b: { t: 29, h: 85 } },
        { a: { t: 32, h: 45 }, b: { t: 30, h: 75 } },
        { a: { t: 32, h: 60 }, b: { t: 29, h: 90 } },
        { a: { t: 31, h: 50 }, b: { t: 28, h: 90 } }
    ];
    var QUIZ_LENGTH = 5;
    var quiz = { questions: [], index: 0, score: 0, answered: false };

    function shuffle(items) {
        var out = items.slice();
        for (var i = out.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
        }
        return out;
    }

    function makeQuestion(category, prompt, correctText, wrongTexts, explain) {
        var choices = [{ text: correctText, correct: true }].concat(
            wrongTexts.map(function (text) { return { text: text, correct: false }; })
        );
        choices = shuffle(choices);
        var answer = 0;
        choices.forEach(function (choice, i) {
            if (choice.correct) answer = i;
        });
        return {
            category: category,
            prompt: prompt,
            choices: choices.map(function (choice) { return choice.text; }),
            answer: answer,
            explain: explain
        };
    }

    function buildQuestions() {
        var questions = [
            makeQuestion(
                "🔥 폭염", "폭염일수는 어떤 날을 세는 값일까요?",
                "낮 최고기온이 33℃ 이상인 날",
                ["낮 평균기온이 30℃ 이상인 날", "밤 최저기온이 25℃ 이상인 날"],
                "폭염일수는 하루 최고기온이 33℃ 이상인 날의 수입니다."
            ),
            makeQuestion(
                "🌙 열대야", "열대야를 판단할 때 보는 기온은 무엇일까요?",
                "밤 최저기온 25℃",
                ["낮 최고기온 25℃", "하루 평균기온 33℃"],
                "열대야는 저녁부터 다음 날 아침까지 최저기온이 25℃ 이상인 밤입니다."
            ),
            makeQuestion(
                "💧 습도", "절대습도는 무엇을 나타낼까요?",
                "공기 1m³ 안에 들어 있는 수증기의 무게",
                ["공기가 품을 수 있는 최대 수증기 비율", "하루 동안 내린 비의 양"],
                "절대습도는 공기 1m³ 안의 실제 수증기 질량을 g/m³로 나타냅니다."
            ),
            makeQuestion(
                "🌡 기온과 폭염", "평균기온이 조금만 올라도 폭염일수가 크게 늘 수 있는 이유는 무엇일까요?",
                "33℃를 넘는 날이 빠르게 많아질 수 있기 때문",
                ["하루의 길이가 더 길어지기 때문", "비가 오는 날을 폭염일수에 포함하기 때문"],
                "폭염일수는 최고기온이 33℃ 이상인 날을 셉니다. 평균기온이 조금만 올라도 이 문턱을 넘는 날은 크게 늘 수 있습니다."
            ),
            makeQuestion(
                "❄️ 겨울", "지구가 더워지면 한파는 완전히 사라질까요?",
                "아니요. 겨울 평균은 올라도 강한 한파는 나타날 수 있습니다.",
                ["네. 평균기온이 오르면 한파는 바로 사라집니다.", "한파와 기후변화는 전혀 관계가 없습니다."],
                "평균의 상승과 특정 시기의 강한 한파는 함께 나타날 수 있습니다."
            ),
            makeQuestion(
                "🌍 온실가스", "온실가스를 많이 줄이면 미래의 더위는 어떻게 될까요?",
                "계속 늘리는 경우보다 폭염과 기온 상승을 줄일 수 있습니다.",
                ["어떤 선택을 해도 미래 더위는 완전히 같습니다.", "온실가스를 줄일수록 폭염이 더 늘어납니다."],
                "배출을 줄여도 변화가 바로 멈추지는 않지만, 시간이 갈수록 미래의 차이를 줄일 수 있습니다."
            )
        ];

        questions.push(makeQuestion(
            "🚌 이동과 기후", "이동할 때 온실가스 배출을 줄이는 방법은 무엇일까요?",
            "걷거나 자전거·대중교통을 이용한다",
            ["가까운 거리도 혼자 승용차를 탄다", "이동 수단은 기후와 관계없다"],
            "걷기와 자전거는 이동 중 배출이 없고, 대중교통은 여러 사람이 함께 이용해 한 사람당 배출을 줄일 수 있습니다."
        ));

        questions.push(makeQuestion(
            "🌀 냉방과 기후", "시원함을 유지하면서 전기 사용을 줄이는 방법은 무엇일까요?",
            "에어컨을 적정 온도로 켜고 선풍기를 함께 사용한다",
            ["에어컨을 가장 낮은 온도로 계속 켠다", "에어컨을 켠 채 창문을 열어 둔다"],
            "선풍기로 찬 공기를 퍼뜨리면 에어컨 설정 온도를 지나치게 낮추지 않아도 시원함을 유지할 수 있습니다."
        ));

        questions.push(makeQuestion(
            "🍚 음식과 기후", "음식과 관련된 온실가스 배출을 줄이는 행동은 무엇일까요?",
            "먹을 만큼 담고 음식을 남기지 않는다",
            ["먹지 않을 음식도 많이 담는다", "남은 음식은 무조건 버린다"],
            "음식을 남기지 않으면 생산과 운반에 들어간 자원과 배출이 낭비되는 것을 줄일 수 있습니다."
        ));

        var pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
        var pairItems = [pair.a, pair.b];
        var felt = pairItems.map(function (item) {
            return C.apparentTemperature(item.t, item.h);
        });
        var hotIndex = felt[0] >= felt[1] ? 0 : 1;
        var coolIndex = hotIndex === 0 ? 1 : 0;
        function pairLabel(item) {
            return "기온 " + item.t + "℃ · 습도 " + item.h + "%";
        }
        questions.push(makeQuestion(
            "🌡 체감온도", "사람이 더 덥게 느끼는 조건은 어느 쪽일까요?",
            pairLabel(pairItems[hotIndex]),
            [pairLabel(pairItems[coolIndex])],
            "체감온도는 각각 " + felt[hotIndex].toFixed(1) + "℃와 " +
                felt[coolIndex].toFixed(1) + "℃입니다. 기온과 습도를 함께 봐야 합니다."
        ));

        return questions;
    }

    function startQuiz() {
        quiz.questions = shuffle(buildQuestions()).slice(0, QUIZ_LENGTH);
        quiz.index = 0;
        quiz.score = 0;
        quiz.answered = false;
        el.quizPlay.hidden = false;
        el.quizFinish.hidden = true;
        renderQuizQuestion();
    }

    function renderQuizQuestion() {
        var question = quiz.questions[quiz.index];
        quiz.answered = false;

        el.quizProgress.textContent = (quiz.index + 1) + " / " + quiz.questions.length;
        el.quizProgressBar.style.width =
            ((quiz.index + 1) / quiz.questions.length * 100).toFixed(0) + "%";
        el.quizScore.textContent = (quiz.score * 20) + "점";
        el.quizCategory.textContent = question.category;
        el.quizPrompt.textContent = question.prompt;
        el.quizFeedback.hidden = true;
        el.quizFeedback.className = "quiz-feedback";
        el.quizNext.hidden = true;
        el.quizNext.innerHTML = quiz.index === quiz.questions.length - 1
            ? '결과 보기 <span aria-hidden="true">→</span>'
            : '다음 문제 <span aria-hidden="true">→</span>';

        el.quizOptions.innerHTML = question.choices.map(function (choice, i) {
            return (
                '<button type="button" class="quiz-option" data-i="' + i + '">' +
                    '<span class="qo-letter" aria-hidden="true">' + (i + 1) + "</span>" +
                    '<span class="qo-text">' + C.escapeHtml(choice) + "</span>" +
                "</button>"
            );
        }).join("");

        Array.prototype.forEach.call(
            el.quizOptions.querySelectorAll(".quiz-option"),
            function (button) {
                button.addEventListener("click", function () {
                    answerQuiz(parseInt(button.getAttribute("data-i"), 10));
                });
            }
        );
    }

    function answerQuiz(picked) {
        if (quiz.answered) return;
        quiz.answered = true;

        var question = quiz.questions[quiz.index];
        var correct = question.answer;
        var ok = picked === correct;
        if (ok) quiz.score += 1;

        Array.prototype.forEach.call(
            el.quizOptions.querySelectorAll(".quiz-option"),
            function (button) {
                var index = parseInt(button.getAttribute("data-i"), 10);
                button.disabled = true;
                if (index === correct) button.classList.add("is-correct");
                if (index === picked && !ok) button.classList.add("is-wrong");
            }
        );

        el.quizScore.textContent = (quiz.score * 20) + "점";
        el.quizFeedback.hidden = false;
        el.quizFeedback.className = "quiz-feedback " + (ok ? "is-correct" : "is-wrong");
        el.quizFeedbackIcon.textContent = ok ? "✓" : "×";
        el.quizVerdict.textContent = ok ? "정답!" : "오답!";
        el.quizExplain.textContent = question.explain;
        el.quizNext.hidden = false;
    }

    function nextQuiz() {
        if (!quiz.answered) return;
        if (quiz.index >= quiz.questions.length - 1) {
            finishQuiz();
            return;
        }
        quiz.index += 1;
        renderQuizQuestion();
    }

    function finishQuiz() {
        el.quizPlay.hidden = true;
        el.quizFinish.hidden = false;
        el.quizProgress.textContent = quiz.questions.length + " / " + quiz.questions.length;
        el.quizProgressBar.style.width = "100%";
        el.quizScore.textContent = (quiz.score * 20) + "점";
        el.quizFinalScore.textContent = quiz.score + " / " + quiz.questions.length;

        if (quiz.score === quiz.questions.length) {
            el.quizFinalMessage.textContent = "모든 개념을 정확히 알고 있어요!";
        } else if (quiz.score >= quiz.questions.length - 1) {
            el.quizFinalMessage.textContent = "거의 다 맞혔어요. 새 문제에도 도전해 보세요.";
        } else if (quiz.score >= 2) {
            el.quizFinalMessage.textContent = "배운 내용을 다시 떠올리며 한 번 더 도전해 보세요.";
        } else {
            el.quizFinalMessage.textContent = "위의 개념을 다시 살펴본 뒤 새 문제를 풀어 보세요.";
        }
    }

    /* ======================================================================
     * 초기화
     * ==================================================================== */
    function init() {
        var jumpToGameReview = window.location.hash === "#gameReview";
        [
            "guideRegion", "goSearchLink", "gameReview", "gameReviewRegion",
            "gameReviewSummary", "gameReviewChoices", "topicGrid",
            "stepHeading", "stepDesc", "stepList", "stepFoot",
            "quizProgress", "quizProgressBar", "quizScore", "quizPlay",
            "quizCategory", "quizPrompt", "quizOptions", "quizFeedback",
            "quizFeedbackIcon", "quizVerdict", "quizExplain", "quizNext",
            "quizFinish", "quizFinalScore", "quizFinalMessage", "quizRestart"
        ].forEach(function (id) { el[id] = document.getElementById(id); });

        buildRegionSelect();

        el.guideRegion.addEventListener("change", function () {
            state.region = el.guideRegion.value;
            renderGameReview();
            renderSteps();
            syncLink();
            startQuiz();
        });
        el.quizNext.addEventListener("click", nextQuiz);
        el.quizRestart.addEventListener("click", startQuiz);

        renderTopics();
        renderGameReview();
        renderSteps();
        syncLink();
        startQuiz();

        if (jumpToGameReview && !el.gameReview.hidden) {
            window.requestAnimationFrame(function () {
                el.gameReview.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
