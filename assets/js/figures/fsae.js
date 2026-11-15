/*
 * Interactive figures for the Formula SAE valvetrain page.
 *  [data-fig="restrictor"]  engine air demand vs. the 20 mm choked-flow ceiling
 *  [data-fig="motion-laws"] normalized cam rise laws: lift, velocity, acceleration, jerk
 * Requires physics.js (window.Physics).
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
  function fmt(v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }

  /* ------------------------------------------------------------------ restrictor */
  function restrictor(root) {
    var R = window.Physics.restrictor;
    var svg = root.querySelector("svg");
    var ve = root.querySelector("[name=ve]");
    var cd = root.querySelector("[name=cd]");
    var out = function (n) { return root.querySelector("[data-out=" + n + "]"); };
    var W = 640, H = 360, m = { l: 52, r: 18, t: 18, b: 44 };
    var VD = 599e-6, D = 0.02;
    var x = scale(2000, 16000, m.l, W - m.r);
    var y = scale(0, 110, H - m.b, m.t);

    var grid = el("g", { class: "plot-grid" }, svg);
    for (var g = 0; g <= 110; g += 20) el("line", { x1: m.l, x2: W - m.r, y1: y(g), y2: y(g) }, grid);
    var ax = el("g", { class: "plot-axis" }, svg);
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }, ax);
    el("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b }, ax);
    for (var r = 2000; r <= 16000; r += 2000) {
      el("line", { x1: x(r), x2: x(r), y1: H - m.b, y2: H - m.b + 5 }, ax);
      el("text", { x: x(r), y: H - m.b + 18, "text-anchor": "middle", class: "plot-text" }, svg).textContent = r / 1000 + "k";
    }
    for (var v = 0; v <= 100; v += 20) el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "plot-text" }, svg).textContent = v;
    el("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "plot-text" }, svg).textContent = "Engine speed (rpm)";
    var yl = el("text", { x: 14, y: (m.t + H - m.b) / 2, "text-anchor": "middle", class: "plot-text", transform: "rotate(-90 14 " + (m.t + H - m.b) / 2 + ")" }, svg);
    yl.textContent = "Air mass flow (g/s)";

    var defs = el("defs", {}, svg);
    var pat = el("pattern", { id: "hatch-r", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#B66A4A", "stroke-width": 1.2, opacity: 0.55 }, pat);
    var starved = el("path", { fill: "url(#hatch-r)", stroke: "none" }, svg);
    var demand = el("path", { fill: "none", stroke: "currentColor", "stroke-width": 2 }, svg);
    var ceiling = el("line", { stroke: "#B66A4A", "stroke-width": 2 }, svg);
    var ceilLabel = el("text", { class: "plot-text", style: "fill:#9A5236" }, svg);
    var mark = el("circle", { r: 4.5, fill: "#B66A4A" }, svg);
    var markLine = el("line", { stroke: "#B66A4A", "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    var markLabel = el("text", { class: "plot-text plot-text--strong", "text-anchor": "middle" }, svg);
    var demandLabel = el("text", { class: "plot-text plot-text--strong", "text-anchor": "end" }, svg);

    function draw() {
      var VE = parseFloat(ve.value), CD = parseFloat(cd.value);
      var cap = R.chokedMassFlow(D, R.STD, CD) * 1000;
      var cross = R.crossoverRpm(D, VD, VE, R.STD, CD);
      var d = "", s = "";
      for (var n = 2000; n <= 16000; n += 100) {
        var f = R.airDemand(n, VD, VE) * 1000;
        d += (n === 2000 ? "M" : "L") + x(n).toFixed(1) + "," + y(Math.min(f, 110)).toFixed(1);
      }
      demand.setAttribute("d", d);
      if (cross < 16000) {
        s = "M" + x(cross) + "," + y(cap);
        for (var k = Math.ceil(cross / 100) * 100; k <= 16000; k += 100) s += "L" + x(k).toFixed(1) + "," + y(Math.min(R.airDemand(k, VD, VE) * 1000, 110)).toFixed(1);
        s += "L" + x(16000) + "," + y(cap) + "Z";
      }
      starved.setAttribute("d", s);
      ceiling.setAttribute("x1", m.l); ceiling.setAttribute("x2", W - m.r);
      ceiling.setAttribute("y1", y(cap)); ceiling.setAttribute("y2", y(cap));
      ceilLabel.setAttribute("x", m.l + 8); ceilLabel.setAttribute("y", y(cap) - 8);
      ceilLabel.textContent = "Choked-flow ceiling, 20 mm throat: " + fmt(cap, 1) + " g/s";
      var cx = x(Math.min(cross, 16000));
      mark.setAttribute("cx", cx); mark.setAttribute("cy", y(cap));
      markLine.setAttribute("x1", cx); markLine.setAttribute("x2", cx); markLine.setAttribute("y1", y(cap)); markLine.setAttribute("y2", H - m.b);
      markLabel.setAttribute("x", Math.min(cx, W - 70)); markLabel.setAttribute("y", y(cap) + 22);
      markLabel.textContent = cross < 16000 ? fmt(Math.round(cross / 10) * 10, 0) + " rpm" : "";
      var need = R.airDemand(16000, VD, VE) * 1000;
      demandLabel.setAttribute("x", W - m.r - 4); demandLabel.setAttribute("y", y(Math.min(need, 110)) - 8);
      demandLabel.textContent = "Unrestricted demand";
      out("ve").textContent = fmt(VE, 2);
      out("cd").textContent = fmt(CD, 2);
      out("cap").textContent = fmt(cap, 1) + " g/s";
      out("cross").textContent = cross < 16000 ? fmt(Math.round(cross / 10) * 10, 0) + " rpm" : "above 16,000 rpm";
      out("need").textContent = fmt(need, 1) + " g/s";
      out("short").textContent = need > cap ? fmt((1 - cap / need) * 100, 0) + "%" : "0%";
    }
    ve.addEventListener("input", draw);
    cd.addEventListener("input", draw);
    draw();
  }

  /* ------------------------------------------------------------------ motion laws */
  function motionLaws(root) {
    var C = window.Physics.cams;
    var svg = root.querySelector("svg");
    var W = 640, H = 340, m = { l: 52, r: 18, t: 18, b: 40 };
    var STYLE = {
      harmonic: { color: "#5B5E61", dash: "6 4", width: 1.6 },
      p345: { color: "#B66A4A", dash: "", width: 2.4 },
      p4567: { color: "#2F5F96", dash: "", width: 1.6 },
      p56789: { color: "currentColor", dash: "2 3", width: 1.6 }
    };
    var QTY = [
      { id: 0, label: "Lift", unit: "fraction of max lift", range: [0, 1.05] },
      { id: 1, label: "Velocity", unit: "per unit lift, per event", range: [-5.4, 5.4] },
      { id: 2, label: "Acceleration", unit: "per unit lift, per event²", range: [-40, 40] },
      { id: 3, label: "Jerk", unit: "per unit lift, per event³", range: [-700, 700] }
    ];
    var state = { q: 0, on: { harmonic: true, p345: true, p4567: false, p56789: true } };
    var gStatic = el("g", {}, svg);
    var gLines = el("g", {}, svg);
    var x = scale(0, 1, m.l, W - m.r);

    function axes(q) {
      while (gStatic.firstChild) gStatic.removeChild(gStatic.firstChild);
      var y = scale(q.range[0], q.range[1], H - m.b, m.t);
      var grid = el("g", { class: "plot-grid" }, gStatic);
      var ax = el("g", { class: "plot-axis" }, gStatic);
      var step = q.id === 0 ? 0.25 : q.id === 1 ? 2.5 : q.id === 2 ? 20 : 350;
      for (var v = Math.ceil(q.range[0] / step) * step; v <= q.range[1] + 1e-9; v += step) {
        el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
        el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "plot-text" }, gStatic).textContent = +v.toFixed(2);
      }
      el("line", { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, ax);
      el("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b }, ax);
      el("line", { x1: x(0.5), x2: x(0.5), y1: m.t, y2: H - m.b, stroke: "currentColor", opacity: 0.3, "stroke-dasharray": "12 3 2 3" }, gStatic);
      el("text", { x: x(0.5) + 6, y: m.t + 10, class: "plot-text" }, gStatic).textContent = "nose (max lift)";
      [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
        el("text", { x: x(t), y: H - m.b + 18, "text-anchor": "middle", class: "plot-text" }, gStatic).textContent = Math.round(t * 100) + "%";
      });
      el("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", class: "plot-text" }, gStatic).textContent = "Position through the valve event (opening → closing)";
      return y;
    }

    function draw() {
      var q = QTY[state.q];
      var y = axes(q);
      while (gLines.firstChild) gLines.removeChild(gLines.firstChild);
      C.LAWS.forEach(function (law) {
        if (!state.on[law.id]) return;
        var d = "";
        var N = 400;
        for (var i = 0; i <= N; i++) {
          var t = i / N;
          var k = C.eventKinematics(law, t);
          var val = Math.max(q.range[0] - 50, Math.min(q.range[1] + 50, k[q.id]));
          d += (i ? "L" : "M") + x(t).toFixed(1) + "," + y(val).toFixed(1);
          // harmonic acceleration is discontinuous at the event ends: show the jump explicitly
        }
        var st = STYLE[law.id];
        el("path", { d: d, fill: "none", stroke: st.color, "stroke-width": st.width, "stroke-dasharray": st.dash, "stroke-linejoin": "round" }, gLines);
      });
      root.querySelector("[data-out=unit]").textContent = q.unit;
    }

    // stats table
    var tbody = root.querySelector("[data-stats]");
    C.LAWS.forEach(function (law) {
      var p = C.peaks(law);
      var tr = document.createElement("tr");
      var jerk = law.id === "harmonic" ? "∞ at ends" : fmt(p.j * 8, 0);
      tr.innerHTML = "<th scope=row>" + law.label + "</th><td>" + fmt(p.v * 2, 2) + "</td><td>" + fmt(p.a * 4, 1) + "</td><td>" + jerk + "</td><td>" + fmt(C.fractionAbove(law, 0.9) * 100, 0) + "%</td>";
      tbody.appendChild(tr);
    });

    root.querySelectorAll("[data-q]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.q = +b.getAttribute("data-q");
        root.querySelectorAll("[data-q]").forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        draw();
      });
    });
    root.querySelectorAll("[data-law]").forEach(function (b) {
      var id = b.getAttribute("data-law");
      b.setAttribute("aria-pressed", state.on[id] ? "true" : "false");
      b.addEventListener("click", function () {
        state.on[id] = !state.on[id];
        b.setAttribute("aria-pressed", state.on[id] ? "true" : "false");
        draw();
      });
    });
    draw();
  }

  function init() {
    if (!window.Physics) return;
    document.querySelectorAll('[data-fig="restrictor"]').forEach(restrictor);
    document.querySelectorAll('[data-fig="motion-laws"]').forEach(motionLaws);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
