/*
 * Flight simulator: from aircraft attitude to four piston lengths, after the project's own Python routine
 * (processData in PythonAnalyze.py), with all four of its sign branches folded into one signed form:
 *   platform roll  α = roll  / 3.61973529319   (roll folded into −90…90; sign = turning left / right)
 *   platform pitch β = pitch / 8.77464958818   (pitch folded into −90…90; sign = turning up / down)
 *   x = 9.5;  y = 20.5·tan α;  z = 52.5·tan β
 *   FL = x + 0.5y − 0.5z   FR = x + 1.5y − 0.5z   BL = x + 0.5y − 1.5z   BR = x + 1.5y − 1.5z
 *   w = 9.5 − mean(FL, FR, BL, BR);  each target += w   (re-centres the platform)
 * Checked against the Python for 1,924 roll/pitch pairs. The 3D view draws the deck as the plane through
 * the four piston tops; the attitude chart shows every (α, β) that keeps all pistons within 0–19.
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg", D2R = Math.PI / 180;
  var KR = 3.61973529319, KP = 8.77464958818, W = 20.5, L = 52.5, MID = 9.5, STROKE = 19;
  var ORDER = ["FL", "FR", "BL", "BR"];
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /** Aircraft roll/pitch (degrees) → signed platform angles, as processData's branches choose them. */
  function platform(roll, pitch) {
    if (roll <= -180) roll += 360;                                  // −180 and 180 are the same attitude
    var a, left, b, up;
    if (roll >= 0 && roll <= 90) { a = roll / KR; left = true; }
    else if (roll > 90 && roll <= 180) { a = (180 - roll) / KR; left = true; }
    else if (roll > -180 && roll < -90) { a = (roll + 180) / KR; left = false; }
    else { a = -roll / KR; left = false; }
    if (pitch >= 0 && pitch <= 90) { b = pitch / KP; up = true; }
    else if (pitch > 90 && pitch <= 180) { b = (180 - pitch) / KP; up = true; }
    else if (pitch >= -180 && pitch < -90) { b = (pitch + 180) / KP; up = false; }
    else { b = -pitch / KP; up = false; }
    return { a: left ? a : -a, b: up ? b : -b };
  }
  /** Signed platform angles → piston targets (the routine's formulas with signed y and z). */
  function pistons(a, b) {
    var x = MID, y = W * Math.tan(a * D2R), z = L * Math.tan(b * D2R);
    var FL = x + 0.5 * y - 0.5 * z, FR = x + 1.5 * y - 0.5 * z, BL = x + 0.5 * y - 1.5 * z, BR = x + 1.5 * y - 1.5 * z;
    var w = MID - (FL + FR + BL + BR) / 4;
    return { FL: FL + w, FR: FR + w, BL: BL + w, BR: BR + w, y: y, z: z };
  }
  /** Clamp a platform attitude into the stroke envelope |y| + |z| ≤ 19 along the ray from level. */
  function reachable(a, b) {
    var y = W * Math.tan(a * D2R), z = L * Math.tan(b * D2R), s = Math.abs(y) + Math.abs(z);
    if (s <= STROKE) return { a: a, b: b };
    var k = STROKE / s;
    return { a: Math.atan(y * k / W) / D2R, b: Math.atan(z * k / L) / D2R };
  }
  function fmt(v) { return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2); }   // no "-0.00"
  window.SimIK = { platform: platform, pistons: pistons, reachable: reachable };

  function init(root) {
    var svg = root.querySelector(".sim3d__svg"), env = root.querySelector(".sim3d__env");
    var rollIn = root.querySelector("[name=roll]"), pitchIn = root.querySelector("[name=pitch]");
    var flyBtn = root.querySelector("[data-act=fly]");
    var out = function (n) { return root.querySelector("[data-out=" + n + "]"); };
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var state = { mode: "map", a: 0, b: 0 };

    /* ---------------- 3D view: orthographic, yaw + elevation ---------------- */
    var S = 6.8, CX = 320, CY = 282, BODY = 12, view = { yaw: -38 * D2R, el: 24 * D2R };
    function P(x, y, z) {   // x: to the pilot's right, y: up, z: forward
      var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), ce = Math.cos(view.el), se = Math.sin(view.el);
      var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      return { x: CX + x1 * S, y: CY - (y * ce - z1 * se) * S, d: z1 * ce + y * se };
    }
    var corners = { FL: [-W / 2, L / 2], FR: [W / 2, L / 2], BL: [-W / 2, -L / 2], BR: [W / 2, -L / 2] };
    var gBase = el("g", { class: "sim3d__base" }, svg);
    var gGhost = el("g", { class: "sim3d__ghost" }, svg);
    var gAct = el("g", {}, svg), gDeck = el("g", {}, svg), gTop = el("g", {}, svg);
    function poly(pts) { return pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" "); }

    function drawBase() {
      while (gBase.firstChild) gBase.removeChild(gBase.firstChild);
      var m = 4, fr = [[-W / 2 - m, -L / 2 - m], [W / 2 + m, -L / 2 - m], [W / 2 + m, L / 2 + m], [-W / 2 - m, L / 2 + m]];
      el("polygon", { points: poly(fr.map(function (c) { return P(c[0], 0, c[1]); })), class: "sim3d__frame" }, gBase);
      // floor hatching along the frame, lengthwise
      for (var i = -2; i <= 2; i++) {
        var xx = i * (W + 2 * m) / 5;
        var p1 = P(xx, 0, -L / 2 - m), p2 = P(xx, 0, L / 2 + m);
        el("line", { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: "sim3d__hatch" }, gBase);
      }
      var f1 = P(0, 0, L / 2 + m + 2), f2 = P(0, 0, L / 2 + m + 9);
      el("line", { x1: f1.x, y1: f1.y, x2: f2.x, y2: f2.y, class: "sim3d__fwd", "marker-end": "url(#sim-arrow)" }, gBase);
      var ft = P(0, 0, L / 2 + m + 13);
      el("text", { x: ft.x, y: ft.y + 4, "text-anchor": "middle", class: "plot-text" }, gBase).textContent = "front";
    }
    var defs = el("defs", {}, svg);
    var mk = el("marker", { id: "sim-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0 0 L10 5 L0 10 z", fill: "currentColor" }, mk);

    function deckPoint(lx, lz, h) { return P(lx, BODY + h(lx, lz), lz); }

    function draw3d(t) {
      // deck plane: height of any (lx, lz) on the plate, through the four piston tops
      var ta = Math.tan(state.a * D2R), tb = Math.tan(state.b * D2R);
      var h = function (lx, lz) { return MID + lx * ta + lz * tb; };
      var flat = function () { return MID; };
      [gGhost, gAct, gDeck, gTop].forEach(function (g) { while (g.firstChild) g.removeChild(g.firstChild); });
      var pm = 3, plate = [[-W / 2 - pm, -L / 2 - pm], [W / 2 + pm, -L / 2 - pm], [W / 2 + pm, L / 2 + pm], [-W / 2 - pm, L / 2 + pm]];
      el("polygon", { points: poly(plate.map(function (c) { return deckPoint(c[0], c[1], flat); })), class: "sim3d__neutral" }, gGhost);
      // actuators, back to front
      var acts = ORDER.map(function (k) {
        var c = corners[k], b0 = P(c[0], 0, c[1]), b1 = P(c[0], BODY, c[1]), top = deckPoint(c[0], c[1], h);
        return { k: k, b0: b0, b1: b1, top: top, d: b0.d };
      }).sort(function (u, v) { return u.d - v.d; });
      var r = 1.6 * S, ry = r * Math.sin(view.el);
      acts.forEach(function (q) {
        var g = el("g", { class: "sim3d__act" }, gAct);
        el("path", { d: "M" + (q.b0.x - r) + "," + q.b0.y + " L" + (q.b1.x - r) + "," + q.b1.y + " A" + r + "," + ry + " 0 0 1 " + (q.b1.x + r) + "," + q.b1.y + " L" + (q.b0.x + r) + "," + q.b0.y + " A" + r + "," + ry + " 0 0 1 " + (q.b0.x - r) + "," + q.b0.y + "z", class: "sim3d__body" }, g);
        el("ellipse", { cx: q.b1.x, cy: q.b1.y, rx: r, ry: ry, class: "sim3d__cap" }, g);
        el("line", { x1: q.b1.x, y1: q.b1.y, x2: q.top.x, y2: q.top.y, class: "sim3d__rod" }, g);
      });
      // deck plate, then joints and labels on top
      var platePts = plate.map(function (c) { return deckPoint(c[0], c[1], h); });
      el("polygon", { points: poly(platePts), class: "sim3d__deck" }, gDeck);
      // the pilot's forward direction, drawn in the deck plane
      var a1 = deckPoint(0, -6, h), a2 = deckPoint(0, 14, h);
      el("line", { x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y, class: "sim3d__fwd", "marker-end": "url(#sim-arrow)" }, gDeck);
      acts.forEach(function (q) {
        el("circle", { cx: q.top.x, cy: q.top.y, r: 5, class: "sim3d__ball" }, gTop);
        var tx = el("text", { x: q.top.x + (q.k.charAt(1) === "R" ? 10 : -10), y: q.top.y - 8, "text-anchor": q.k.charAt(1) === "R" ? "start" : "end", class: "plot-text plot-text--strong" }, gTop);
        tx.textContent = q.k + " " + fmt(t[q.k]);
      });
    }

    /* ---------------- attitude chart: what the stroke allows vs. what the mapping uses ---------------- */
    var E = { w: 260, h: 176, l: 38, r: 12, t: 10, b: 26, amax: 46, bmax: 22 };
    var ex = function (a) { return E.l + (a + E.amax) / (2 * E.amax) * (E.w - E.l - E.r); };
    var ey = function (b) { return E.t + (E.bmax - b) / (2 * E.bmax) * (E.h - E.t - E.b); };
    (function drawEnv() {
      var pts = [], amax = Math.atan(STROKE / W) / D2R, n = 60, i, a;
      for (i = 0; i <= n; i++) { a = -amax + 2 * amax * i / n; pts.push([a, Math.atan((STROKE - W * Math.abs(Math.tan(a * D2R))) / L) / D2R]); }
      for (i = n; i >= 0; i--) { a = -amax + 2 * amax * i / n; pts.push([a, -Math.atan((STROKE - W * Math.abs(Math.tan(a * D2R))) / L) / D2R]); }
      el("line", { x1: ex(-E.amax), x2: ex(E.amax), y1: ey(0), y2: ey(0), class: "sim3d__axis" }, env);
      el("line", { x1: ex(0), x2: ex(0), y1: ey(E.bmax), y2: ey(-E.bmax), class: "sim3d__axis" }, env);
      el("polygon", { points: pts.map(function (p) { return ex(p[0]).toFixed(1) + "," + ey(p[1]).toFixed(1); }).join(" "), class: "sim3d__reach" }, env);
      var ra = 90 / KR, rb = 90 / KP;
      el("rect", { x: ex(-ra), y: ey(rb), width: ex(ra) - ex(-ra), height: ey(-rb) - ey(rb), class: "sim3d__map" }, env);
      [-40, -20, 0, 20, 40].forEach(function (v) { el("text", { x: ex(v), y: E.h - 8, "text-anchor": "middle", class: "plot-text" }, env).textContent = v + "°"; });
      [-20, 0, 20].forEach(function (v) { el("text", { x: E.l - 5, y: ey(v) + 3, "text-anchor": "end", class: "plot-text" }, env).textContent = v + "°"; });
      el("text", { x: E.w - E.r, y: E.h - 8 - 12, "text-anchor": "end", class: "plot-text sim3d__axlabel" }, env).textContent = "roll α";
      el("text", { x: ex(0) + 5, y: E.t + 8, class: "plot-text sim3d__axlabel" }, env).textContent = "pitch β";
    })();
    var dot = el("circle", { r: 6, class: "sim3d__dot" }, env);
    var hit = el("rect", { x: 0, y: 0, width: E.w, height: E.h, fill: "transparent", class: "sim3d__hit" }, env);

    function setDirect(clientX, clientY) {
      var box = env.getBoundingClientRect();
      var px = (clientX - box.left) / box.width * E.w, py = (clientY - box.top) / box.height * E.h;
      var a = (px - E.l) / (E.w - E.l - E.r) * 2 * E.amax - E.amax, b = E.bmax - (py - E.t) / (E.h - E.t - E.b) * 2 * E.bmax;
      var r = reachable(Math.max(-E.amax, Math.min(E.amax, a)), Math.max(-E.bmax, Math.min(E.bmax, b)));
      state.mode = "direct"; state.a = r.a; state.b = r.b; stopFly(); update();
    }
    var dragging = false;
    hit.addEventListener("pointerdown", function (e) { dragging = true; hit.setPointerCapture(e.pointerId); setDirect(e.clientX, e.clientY); });
    hit.addEventListener("pointermove", function (e) { if (dragging) setDirect(e.clientX, e.clientY); });
    hit.addEventListener("pointerup", function () { dragging = false; });
    hit.addEventListener("pointercancel", function () { dragging = false; });

    /* ---------------- 3D view orbit ---------------- */
    var orbit = null;
    svg.addEventListener("pointerdown", function (e) { orbit = { x: e.clientX, yaw: view.yaw }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener("pointermove", function (e) { if (!orbit) return; view.yaw = orbit.yaw - (e.clientX - orbit.x) * 0.008; drawBase(); update(); });
    svg.addEventListener("pointerup", function () { orbit = null; });
    svg.addEventListener("pointercancel", function () { orbit = null; });

    /* ---------------- readouts ---------------- */
    var gauges = {};
    ORDER.forEach(function (k) { gauges[k] = root.querySelector('[data-g="' + k + '"]'); });
    function side(v, pos, neg) { return Math.abs(v) < 0.05 ? "level" : Math.abs(v).toFixed(1) + "° " + (v > 0 ? pos : neg); }
    function update() {
      if (state.mode === "map") { var p = platform(parseFloat(rollIn.value), parseFloat(pitchIn.value)); state.a = p.a; state.b = p.b; }
      var t = pistons(state.a, state.b);
      draw3d(t);
      dot.setAttribute("cx", ex(state.a)); dot.setAttribute("cy", ey(state.b));
      root.classList.toggle("is-direct", state.mode === "direct");
      out("roll").textContent = state.mode === "map" ? parseFloat(rollIn.value).toFixed(0) + "°" : "—";
      out("pitch").textContent = state.mode === "map" ? parseFloat(pitchIn.value).toFixed(0) + "°" : "—";
      out("alpha").textContent = side(state.a, "left", "right");
      out("beta").textContent = side(state.b, "nose up", "nose down");
      out("mode").textContent = state.mode === "map" ? "From the aircraft, through the project’s mapping" : "Set directly on the chart";
      ORDER.forEach(function (k) {
        var v = Math.max(0, Math.min(STROKE, t[k])), g = gauges[k];
        g.style.setProperty("--v", (v / STROKE).toFixed(4));
        g.classList.toggle("is-stop", v < 0.05 || v > STROKE - 0.05);
        g.querySelector(".gauge__v").textContent = fmt(t[k]);
      });
      svg.setAttribute("aria-label", "Platform rolled " + out("alpha").textContent + " and pitched " + out("beta").textContent + "; pistons " + ORDER.map(function (k) { return k + " " + fmt(t[k]); }).join(", "));
    }
    function fromSliders() { state.mode = "map"; stopFly(); update(); }
    rollIn.addEventListener("input", fromSliders);
    pitchIn.addEventListener("input", fromSliders);

    /* ---------------- a short maneuver: bank, climb, reverse, descend ---------------- */
    var flying = false, t0 = 0;
    function fly(now) {
      if (!flying) return;
      var s = (now - t0) / 1000;
      rollIn.value = Math.round(80 * Math.sin(s * 0.7));
      pitchIn.value = Math.round(55 * Math.sin(s * 0.45 + 0.6));
      state.mode = "map"; update();
      requestAnimationFrame(fly);
    }
    function startFly() { flying = true; t0 = performance.now(); flyBtn.textContent = "Stop"; flyBtn.setAttribute("aria-pressed", "true"); requestAnimationFrame(fly); }
    function stopFly() { if (!flying) return; flying = false; flyBtn.textContent = "Fly a maneuver"; flyBtn.setAttribute("aria-pressed", "false"); }
    flyBtn.addEventListener("click", function () { if (flying) stopFly(); else startFly(); });
    if (!reduced && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && !root.dataset.flown) { root.dataset.flown = "1"; startFly(); } else if (!e.isIntersecting) stopFly(); });
      }, { threshold: 0.5 });
      io.observe(root);
    }

    drawBase();
    update();
  }

  function boot() { document.querySelectorAll('[data-fig="ik"]').forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
