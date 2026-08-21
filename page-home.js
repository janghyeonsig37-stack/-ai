/* ==========================================================================
 * page-home.js — 홈 화면
 * --------------------------------------------------------------------------
 * 메뉴 카드 (게임과 ①~③ 페이지로 이동)
 * ========================================================================== */
(function () {
    "use strict";

    var C = Climate;
    var S = Site;

    /* ---- 메뉴 카드 ---- */
    function renderMenu() {
        var grid = document.getElementById("menuGrid");
        if (!grid) return;

        var items = S.PAGES.filter(function (p) {
            return p.file !== "index.html";
        });

        grid.innerHTML = items.map(function (p) {
            return (
                '<a class="menu-card" href="' + p.file + '">' +
                    '<span class="mc-top">' +
                        '<span class="mc-step" aria-hidden="true">' + p.step + "</span>" +
                        '<span class="mc-ico" aria-hidden="true">' + p.ico + "</span>" +
                    "</span>" +
                    '<span class="mc-title">' + C.escapeHtml(p.label) + "</span>" +
                    '<span class="mc-desc">' + C.escapeHtml(p.desc) + "</span>" +
                    '<span class="mc-go">바로가기 <span aria-hidden="true">→</span></span>' +
                "</a>"
            );
        }).join("");
    }

    document.addEventListener("DOMContentLoaded", function () {
        renderMenu();
        S.decorateLinks();
    });
})();
