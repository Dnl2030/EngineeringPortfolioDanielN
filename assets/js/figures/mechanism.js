/*
 * Hydrogen page: pick a species to trace every elementary reaction it takes part in.
 */
(function () {
  "use strict";
  var NAMES = { H2: "H₂", O2: "O₂", H: "H", O: "O", OH: "OH", HO2: "HO₂", H2O2: "H₂O₂", H2O: "H₂O", M: "a third body M" };
  function init(root) {
    var btns = root.querySelectorAll(".sp-btn"), rows = root.querySelectorAll(".rx"), status = root.querySelector("[data-out=mech]");
    var idle = status.textContent, active = null;
    function apply() {
      root.classList.toggle("is-filtering", !!active);
      btns.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-sp") === active ? "true" : "false"); });
      var n = 0;
      rows.forEach(function (r) {
        var hit = !!active && (" " + r.getAttribute("data-sp") + " ").indexOf(" " + active + " ") > -1;
        r.classList.toggle("is-hit", hit);
        if (hit) n++;
        r.querySelectorAll(".sp").forEach(function (s) { s.classList.toggle("is-hit", !!active && s.getAttribute("data-sp") === active); });
      });
      status.textContent = active ? NAMES[active] + " takes part in " + n + " of " + rows.length + " reactions." : idle;
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () { var sp = b.getAttribute("data-sp"); active = active === sp ? null : sp; apply(); });
    });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape" && active) { active = null; apply(); } });
  }
  function boot() { document.querySelectorAll("[data-fig=mechanism]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
