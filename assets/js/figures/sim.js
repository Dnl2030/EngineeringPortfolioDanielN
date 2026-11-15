/*
 * Flight simulator: piston targets from the project's own Python inverse-kinematics routine.
 * Ported line for line from the "turning left and turning up" branch shown in the code figure:
 *   beta = pitch / 8.77464958818          (0 ≤ pitch ≤ 90)
 *   beta = (180 − pitch) / 8.77464958818  (90 < pitch ≤ 180)
 *   x = 9.5;  y = 20.5·tan(α);  z = 52.5·tan(β)
 *   FL = x + 0.5y − 0.5z   FR = x + 1.5y − 0.5z   BL = x + 0.5y − 1.5z   BR = x + 1.5y − 1.5z
 *   w = 9.5 − mean(FL, FR, BL, BR);  each target += w   (re-centres the platform)
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
  var D2R = Math.PI / 180;

  function solve(pitch, alpha) {
    var beta = pitch <= 90 ? pitch / 8.77464958818 : (180 - pitch) / 8.77464958818;
    var x = 9.5, y = 20.5 * Math.tan(alpha * D2R), z = 52.5 * Math.tan(beta * D2R);
    var FrontLeft = x + 0.5 * y - 0.5 * z;
    var FrontRight = x + 1.5 * y - 0.5 * z;
    var BackLeft = x + 0.5 * y - 1.5 * z;
    var BackRight = x + 1.5 * y - 1.5 * z;
    var w = 9.5 - (FrontLeft + FrontRight + BackLeft + BackRight) / 4;
    return { beta: beta, FL: FrontLeft + w, FR: FrontRight + w, BL: BackLeft + w, BR: BackRight + w };
  }

  function init(root) {
    var svg = root.querySelector("svg");
    var pitch = root.querySelector("[name=pitch]");
    var alpha = root.querySelector("[name=alpha]");
    var out = function (n) { return root.querySelector("[data-out=" + n + "]"); };
    var order = ["FL", "FR", "BL", "BR"];
    var names = { FL: "Front left", FR: "Front right", BL: "Back left", BR: "Back right" };
    var base = 300, unit = 13, gap = 128, x0 = 72;
    // ground line + neutral reference
    el("line", { x1: 30, x2: 590, y1: base, y2: base, stroke: "currentColor", "stroke-width": 1.2 }, svg);
    for (var h = 30; h < 590; h += 10) el("line", { x1: h, x2: h - 8, y1: base, y2: base + 8, stroke: "currentColor", "stroke-width": 0.6, opacity: 0.5 }, svg);
    var neutral = el("line", { x1: 30, x2: 590, y1: base - 9.5 * unit - 40, y2: base - 9.5 * unit - 40, stroke: "#2F5F96", "stroke-dasharray": "12 3 2 3", "stroke-width": 1 }, svg);
    el("text", { x: 590, y: base - 9.5 * unit - 48, "text-anchor": "end", class: "plot-text", style: "fill:#2F5F96" }, svg).textContent = "neutral 9.5";
    var parts = {};
    order.forEach(function (k, i) {
      var cx = x0 + i * gap;
      var g = el("g", {}, svg);
      el("rect", { x: cx - 18, y: base - 40, width: 36, height: 40, fill: "none", stroke: "currentColor", "stroke-width": 1.4 }, g);
      var rod = el("line", { x1: cx, x2: cx, y1: base - 40, stroke: "currentColor", "stroke-width": 4 }, g);
      var ball = el("circle", { cx: cx, r: 8, fill: "var(--paper, #F5F3EE)", stroke: "#B66A4A", "stroke-width": 1.6 }, g);
      var val = el("text", { x: cx, "text-anchor": "middle", class: "plot-text plot-text--strong" }, g);
      el("text", { x: cx, y: base + 24, "text-anchor": "middle", class: "plot-text" }, g).textContent = names[k];
      parts[k] = { rod: rod, ball: ball, val: val, cx: cx };
    });
    var deck = el("path", { fill: "none", stroke: "#B66A4A", "stroke-width": 1.2, "stroke-dasharray": "5 4" }, svg);

    function draw() {
      var p = parseFloat(pitch.value), a = parseFloat(alpha.value);
      var r = solve(p, a);
      var pts = [];
      order.forEach(function (k) {
        var top = base - 40 - r[k] * unit;
        parts[k].rod.setAttribute("y2", top);
        parts[k].ball.setAttribute("cy", top);
        parts[k].val.setAttribute("y", top - 16);
        parts[k].val.textContent = r[k].toFixed(2);
        pts.push(parts[k].cx + "," + top);
      });
      deck.setAttribute("d", "M" + pts.join("L"));
      out("pitch").textContent = p.toFixed(0) + "°";
      out("alpha").textContent = a.toFixed(1) + "°";
      out("beta").textContent = r.beta.toFixed(2) + "°";
      out("mean").textContent = ((r.FL + r.FR + r.BL + r.BR) / 4).toFixed(2);
    }
    pitch.addEventListener("input", draw);
    alpha.addEventListener("input", draw);
    draw();
  }

  function boot() { document.querySelectorAll('[data-fig="ik"]').forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
