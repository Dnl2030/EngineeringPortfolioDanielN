/*
 * Companion phase-matching calculator for SPDC in congruent LiNbO3 (see physics.js for the model).
 * Plots the phase-matching angle against signal wavelength for a fixed pump, with the selected
 * point, idler wavelength and spatial walk-off. Requires physics.js.
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function scale(d0, d1, r0, r1) { return function (v) { return r0 + ((v - d0) * (r1 - r0)) / (d1 - d0); }; }
  var LMAX = 5000; // nm — upper end of the Sellmeier fit and of LiNbO3's useful transparency

  function init(root) {
    var O = window.Physics.optics;
    var svg = root.querySelector("svg");
    var pump = root.querySelector("[name=pump]");
    var sig = root.querySelector("[name=signal]");
    var out = function (n) { return root.querySelector("[data-out=" + n + "]"); };
    var type = "I";
    var W = 640, H = 360, m = { l: 56, r: 20, t: 20, b: 46 };
    var gAxes = el("g", {}, svg);
    var curve = el("path", { fill: "none", stroke: "#2F5F96", "stroke-width": 2 }, svg);
    var vline = el("line", { stroke: "#B66A4A", "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    var hline = el("line", { stroke: "#B66A4A", "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    var dot = el("circle", { r: 5, fill: "#B66A4A" }, svg);
    var degen = el("line", { stroke: "currentColor", opacity: 0.35, "stroke-dasharray": "12 3 2 3" }, svg);
    var degenLabel = el("text", { class: "plot-text", "text-anchor": "middle" }, svg);
    var none = el("text", { class: "plot-text plot-text--strong", "text-anchor": "middle", x: (m.l + W - m.r) / 2, y: (m.t + H - m.b) / 2 }, svg);

    function sigRange(p) { return [Math.ceil((p * LMAX) / (LMAX - p)), LMAX]; }

    function axes(x, y, r) {
      while (gAxes.firstChild) gAxes.removeChild(gAxes.firstChild);
      var grid = el("g", { class: "plot-grid" }, gAxes);
      var ax = el("g", { class: "plot-axis" }, gAxes);
      for (var t = 0; t <= 90; t += 15) {
        el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, grid);
        el("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "plot-text" }, gAxes).textContent = t + "°";
      }
      var step = r[1] - r[0] > 3000 ? 1000 : 500;
      for (var s = Math.ceil(r[0] / step) * step; s <= r[1]; s += step) {
        el("line", { x1: x(s), x2: x(s), y1: H - m.b, y2: H - m.b + 5 }, ax);
        el("text", { x: x(s), y: H - m.b + 18, "text-anchor": "middle", class: "plot-text" }, gAxes).textContent = s;
      }
      el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, ax);
      el("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b }, ax);
      el("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "plot-text" }, gAxes).textContent = "Signal wavelength λs (nm)";
      var cy = (m.t + H - m.b) / 2;
      el("text", { x: 14, y: cy, "text-anchor": "middle", class: "plot-text", transform: "rotate(-90 14 " + cy + ")" }, gAxes).textContent = "Phase-matching angle θ to optic axis";
    }

    function draw() {
      var p = parseFloat(pump.value);
      var r = sigRange(p);
      sig.min = r[0]; sig.max = r[1];
      var s = Math.min(Math.max(parseFloat(sig.value), r[0]), r[1]);
      sig.value = s;
      var x = scale(r[0], r[1], m.l, W - m.r);
      var y = scale(0, 90, H - m.b, m.t);
      axes(x, y, r);
      var d = "", pen = false, any = false, N = 260;
      for (var i = 0; i <= N; i++) {
        var ls = r[0] + ((r[1] - r[0]) * i) / N;
        var res = O.phaseMatch(type, p, ls);
        if (res.thetaDeg == null) { pen = false; continue; }
        any = true;
        d += (pen ? "L" : "M") + x(ls).toFixed(1) + "," + y(res.thetaDeg).toFixed(1);
        pen = true;
      }
      curve.setAttribute("d", d);
      none.textContent = any ? "" : "No birefringent phase-matching angle for this pump at room temperature";
      var dg = 2 * p;
      var showDeg = dg > r[0] && dg < r[1];
      degen.setAttribute("x1", showDeg ? x(dg) : -10); degen.setAttribute("x2", showDeg ? x(dg) : -10);
      degen.setAttribute("y1", m.t); degen.setAttribute("y2", H - m.b);
      degenLabel.setAttribute("x", showDeg ? x(dg) : -100); degenLabel.setAttribute("y", m.t + 10);
      degenLabel.textContent = "degenerate λs = λi";

      var cur = O.phaseMatch(type, p, s);
      var ok = cur.thetaDeg != null;
      [vline, hline, dot].forEach(function (n) { n.style.display = ok ? "" : "none"; });
      if (ok) {
        dot.setAttribute("cx", x(s)); dot.setAttribute("cy", y(cur.thetaDeg));
        vline.setAttribute("x1", x(s)); vline.setAttribute("x2", x(s)); vline.setAttribute("y1", y(cur.thetaDeg)); vline.setAttribute("y2", H - m.b);
        hline.setAttribute("x1", m.l); hline.setAttribute("x2", x(s)); hline.setAttribute("y1", y(cur.thetaDeg)); hline.setAttribute("y2", y(cur.thetaDeg));
      }
      out("pump").textContent = p.toFixed(0) + " nm";
      out("signal").textContent = s.toFixed(0) + " nm";
      out("idler").textContent = cur.idlerNm.toFixed(0) + " nm";
      out("theta").textContent = ok ? cur.thetaDeg.toFixed(2) + "°" : "none";
      out("walk").textContent = ok ? (cur.walkoffDeg).toFixed(2) + "° (" + (cur.walkoffDeg * Math.PI / 180 * 1000).toFixed(1) + " mrad)" : "—";
      out("np").textContent = O.nO(p).toFixed(4) + " / " + O.nE(p).toFixed(4);
    }

    root.querySelectorAll("[data-type]").forEach(function (b) {
      b.addEventListener("click", function () {
        type = b.getAttribute("data-type");
        root.querySelectorAll("[data-type]").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        out("convention").textContent = type === "I" ? "e → o + o" : "e → e (signal) + o (idler)";
        draw();
      });
    });
    pump.addEventListener("input", draw);
    sig.addEventListener("input", draw);
    draw();
  }

  function boot() { if (window.Physics) document.querySelectorAll('[data-fig="spdc"]').forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
