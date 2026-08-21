/* ==========================================================================
 * common.js — 모든 페이지가 함께 쓰는 공통 기능
 * --------------------------------------------------------------------------
 * 1. 조회 조건(지역 · 연대 · 배출 경로) 보관과 페이지 간 전달
 * 2. 조회 조건 선택 상자 만들기
 * 3. 주메뉴 열기 / 닫기
 *
 * 이 서비스는 페이지가 여러 개로 나뉘어 있습니다. 사용자가 ①에서 고른
 * 지역과 연대가 ②③ 페이지에서도 그대로 유지되어야 하므로,
 *   (1) 주소 뒤 #region=...&decade=... 로 넘기고
 *   (2) 브라우저 저장소에도 남겨 두어
 * 어느 경로로 들어와도 같은 조건이 이어지게 했습니다.
 * ========================================================================== */

var Site = (function () {
    "use strict";

    var DATA = CLIMATE_DATA;
    var C = Climate;
    var STORE_KEY = "climate-condition";

    var DEFAULT_REGION = "전국";
    var DEFAULT_DECADE = 2050;

    /* 페이지 순서 — 아래·위 이동 링크와 홈 메뉴 카드가 이 목록을 씁니다. */
    var PAGES = [
        { file: "index.html",   step: "홈", label: "처음 화면",       ico: "🏠",
          desc: "지역별 폭염 전망을 한눈에 봅니다." },
        { file: "game.html",    step: "게임", label: "우리동네 기후 게임",  ico: "🎮",
          desc: "다섯 번의 선택으로 2070년대 결과를 만듭니다." },
        { file: "search.html",  step: "1",  label: "우리 지역 보기",   ico: "📍",
          desc: "지도에서 지역을 골라 수치와 변화를 함께 봅니다." },
        { file: "mylab.html",   step: "2",  label: "내가 만드는 미래", ico: "🎛",
          desc: "CO₂와 습도를 조절해 미래 폭염을 비교합니다." },
        { file: "guide.html",   step: "3",  label: "개념 정리",     ico: "📚",
          desc: "폭염과 행동의 관계를 정리하고 퀴즈를 풉니다." }
    ];

    /* ======================================================================
     * 1. 조회 조건 보관
     * ==================================================================== */
    /* effort = "내가 만드는 미래" 화면의 배출 경로 위치(0~3).
       0 = 온실가스를 크게 줄인 미래(SSP1-2.6)
       3 = 화석연료를 계속 늘리는 미래(SSP5-8.5) */
    var DEFAULT_EFFORT = 1;
    var state = {
        region: DEFAULT_REGION,
        decade: DEFAULT_DECADE,
        effort: DEFAULT_EFFORT,
        humidityDelta: 0
    };

    function isSupported(name) {
        return !!findRegion(name);
    }

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

    function validDecade(d) {
        var list = DATA.meta.decades;
        for (var i = 0; i < list.length; i++) if (list[i] === d) return true;
        return false;
    }

    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (!raw) return null;
            var o = JSON.parse(raw);
            return (o && typeof o.region === "string") ? o : null;
        } catch (e) { return null; }
    }

    function writeStore() {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) { /* 저장이 막힌 환경에서도 화면은 정상 동작합니다 */ }
    }

    function readHash() {
        var h = window.location.hash.replace(/^#/, "");
        if (!h) return null;
        var out = {};
        h.split("&").forEach(function (p) {
            var kv = p.split("=");
            if (kv.length === 2) out[kv[0]] = decodeURIComponent(kv[1]);
        });
        if (!out.region && !out.decade && out.effort === undefined &&
                out.humidity === undefined) return null;
        return out;
    }

    function loadState() {
        var stored = readStore();
        if (stored) {
            state.region = stored.region;
            if (validDecade(Number(stored.decade))) state.decade = Number(stored.decade);
        }
        if (stored && isFinite(Number(stored.effort))) {
            state.effort = clampEffort(Number(stored.effort));
        }
        if (stored && isFinite(Number(stored.humidityDelta))) {
            state.humidityDelta = clampHumidity(Number(stored.humidityDelta));
        }
        var h = readHash();
        if (h) {
            if (h.region) state.region = h.region;
            if (h.decade && validDecade(Number(h.decade))) state.decade = Number(h.decade);
            if (h.effort !== undefined && isFinite(Number(h.effort))) {
                state.effort = clampEffort(Number(h.effort));
            }
            if (h.humidity !== undefined && isFinite(Number(h.humidity))) {
                state.humidityDelta = clampHumidity(Number(h.humidity));
            }
        }
        if (!validDecade(state.decade)) state.decade = DEFAULT_DECADE;
    }

    /** 조건을 저장하고 주소와 페이지 링크를 갱신합니다. */
    function saveState() {
        writeStore();
        var h = hashString();
        try { window.history.replaceState(null, "", h); }
        catch (e) { window.location.hash = h; }
        decorateLinks();
    }

    function clampEffort(v) { return Math.min(Math.max(v, 0), 3); }
    function clampHumidity(v) { return Math.min(Math.max(v, -20), 20); }

    function hashString() {
        return "#region=" + encodeURIComponent(state.region) +
               "&decade=" + state.decade +
               "&effort=" + Number(state.effort).toFixed(3) +
               "&humidity=" + Math.round(state.humidityDelta);
    }

    /** 서비스 내부 페이지 링크에 현재 조건을 붙입니다.
     *  이미 조건이 붙어 있는 링크도 새 조건으로 다시 씁니다.
     *  (href 뒤에 #... 이 붙으면 '.html 로 끝나는 링크' 선택자에 걸리지 않으므로
     *   모든 링크를 훑어 파일명으로 판단합니다.) */
    var PAGE_FILES = PAGES.map(function (p) { return p.file; });

    function decorateLinks() {
        var links = document.querySelectorAll("a[href]");
        Array.prototype.forEach.call(links, function (a) {
            var href = a.getAttribute("href") || "";
            var hashAt = href.indexOf("#");
            var base = hashAt === -1 ? href : href.slice(0, hashAt);
            var frag = hashAt === -1 ? "" : href.slice(hashAt);
            if (PAGE_FILES.indexOf(base) === -1) return;

            /* 같은 페이지 안의 특정 위치로 가는 링크(예: guide.html#quiz)는
               위치 표시를 그대로 두어야 하므로 건드리지 않습니다. */
            if (frag && frag.indexOf("#region=") !== 0) return;

            a.setAttribute("href", base + hashString());
        });
    }

    /* ======================================================================
     * 2. 선택 상자
     * ==================================================================== */
    function buildRegionSelect(sel) {
        if (!sel) return;
        sel.innerHTML = "";
        DATA.regions.forEach(function (r) {
            var o = document.createElement("option");
            o.value = r.id;
            o.textContent = r.label;
            sel.appendChild(o);
        });
        sel.value = state.region;
        if (!sel.value) sel.value = DEFAULT_REGION;
    }

    function buildDecadeSelect(sel) {
        if (!sel) return;
        sel.innerHTML = "";
        var national = findRegion("전국");
        national.series.forEach(function (r) {
            if (r.observed) return;
            var o = document.createElement("option");
            o.value = String(r.decade);
            o.textContent = decadeLabel(r.decade);
            sel.appendChild(o);
        });
        sel.value = String(state.decade);
        if (!sel.value) {
            state.decade = DEFAULT_DECADE;
            sel.value = String(DEFAULT_DECADE);
        }
    }

    function decadeLabel(d) { return d + "년대"; }

    /* ======================================================================
     * 3. 주메뉴 열기 / 닫기
     * ==================================================================== */
    function initGnb() {
        var toggle = document.getElementById("gnbToggle");
        var gnb = document.getElementById("gnb");
        if (!toggle || !gnb) return;

        function setState(collapsed) {
            gnb.setAttribute("data-collapsed", collapsed ? "true" : "false");
            toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
            var t = toggle.querySelector(".gt-text");
            if (t) t.textContent = collapsed ? "메뉴 열기" : "메뉴 닫기";
        }
        setState(true);
        toggle.addEventListener("click", function () {
            setState(gnb.getAttribute("data-collapsed") !== "true");
        });
    }

    /* ======================================================================
     * 5. 페이지 아래 이전 / 다음 이동
     * ==================================================================== */
    function renderPageFlow(id, currentFile) {
        var el = document.getElementById(id);
        if (!el) return;
        var idx = -1;
        PAGES.forEach(function (p, i) { if (p.file === currentFile) idx = i; });
        if (idx < 0) return;

        var prev = idx > 0 ? PAGES[idx - 1] : null;
        var next = idx < PAGES.length - 1 ? PAGES[idx + 1] : null;
        var html = "";

        if (prev) {
            html +=
                '<a class="pf-prev" href="' + prev.file + '">' +
                    '<span class="pf-chev" aria-hidden="true">‹</span>' +
                    "<span><span class=\"pf-dir\">이전</span>" +
                    '<span class="pf-title">' + C.escapeHtml(prev.label) + "</span></span>" +
                "</a>";
        }
        if (next) {
            html +=
                '<a class="pf-next" href="' + next.file + '">' +
                    "<span><span class=\"pf-dir\">다음</span>" +
                    '<span class="pf-title">' + C.escapeHtml(next.label) + "</span></span>" +
                    '<span class="pf-chev" aria-hidden="true">›</span>' +
                "</a>";
        }
        el.innerHTML = html;
    }

    /* ======================================================================
     * 초기화
     * ==================================================================== */
    loadState();

    document.addEventListener("DOMContentLoaded", function () {
        initGnb();
        decorateLinks();
        var flow = document.querySelector("[data-page-flow]");
        if (flow) renderPageFlow(flow.id, flow.getAttribute("data-page-flow"));
    });

    return {
        state: state,
        PAGES: PAGES,
        DATA: DATA,
        findRegion: findRegion,
        rowOf: rowOf,
        isSupported: isSupported,
        decadeLabel: decadeLabel,
        buildRegionSelect: buildRegionSelect,
        buildDecadeSelect: buildDecadeSelect,
        clampEffort: clampEffort,
        clampHumidity: clampHumidity,
        saveState: saveState,
        decorateLinks: decorateLinks
    };
})();
