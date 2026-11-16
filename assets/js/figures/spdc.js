/*
 * SPDC Type II phase-matching heatmap — a line-for-line port of Phase_matching_graphs.py
 * (NumPy + Matplotlib) to plain JavaScript and <canvas>.
 *
 * Model (unchanged from the Python):
 *   Sellmeier for congruent LiNbO3, λ in µm
 *     n_o(λ)  = sqrt(4.9048 − 0.11768 / (0.0475 − λ²) − 0.027169 λ²)
 *     n_e(λ)  = sqrt(4.582  − 0.11768 / (0.0475 − λ²) − 0.02195  λ²)
 *   Type II: pump extraordinary, signal ordinary, idler extraordinary.
 *   For each pump angle θpm and internal signal emission angle αs:
 *     transverse momentum  ks·sin αs = ki·sin αi   (idler index first guessed at θpm, then refined at θi = θpm − αi)
 *     longitudinal mismatch Δkz = kp − ks cos αs − ki cos αi
 *     efficiency = sinc²(Δkz·L / 2π) with NumPy's normalized sinc and crystal length L = 5000 µm.
 *   Energy conservation 1/λp = 1/λs + 1/λi with one wavelength locked (lock P / S / I).
 */
(function () {
  "use strict";

  /* ---------- physics (ported) ---------- */
  function n_o(lam) { var l2 = lam * lam; return Math.sqrt(4.9048 - 0.11768 / (0.0475 - l2) - 0.027169 * l2); }
  function n_e_axis(lam) { var l2 = lam * lam; return Math.sqrt(4.582 - 0.11768 / (0.0475 - l2) - 0.02195 * l2); }
  function n_e_theta(lam, th) {
    var no = n_o(lam), ne = n_e_axis(lam), c = Math.cos(th), s = Math.sin(th);
    return 1 / Math.sqrt((c * c) / (no * no) + (s * s) / (ne * ne));
  }
  function npSinc(x) { if (x === 0) return 1; var px = Math.PI * x; return Math.sin(px) / px; }
  function linspace(a, b, n) { var out = new Float64Array(n); for (var i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1); return out; }

  var D2R = Math.PI / 180;
  var THETA = linspace(50, 130, 400);   // pump phase-matching angle, degrees (columns)
  var ALPHA = linspace(-3.5, 3.5, 400); // internal signal emission angle, degrees (rows, bottom → top)

  /** Efficiency grid, rows = alpha (index 0 = −3.5°), cols = theta. Mirrors calculate_efficiency_matrix. */
  function efficiencyMatrix(lp, ls, li, L) {
    L = L || 5000;
    var nT = THETA.length, nA = ALPHA.length;
    var Z = new Float32Array(nT * nA);
    var ns = n_o(ls), ks = (2 * Math.PI * ns) / ls;
    var noP = n_o(lp), neP = n_e_axis(lp), noI = n_o(li), neI = n_e_axis(li);
    var kp = new Float64Array(nT), kiGuess = new Float64Array(nT), th = new Float64Array(nT);
    for (var j = 0; j < nT; j++) {
      var t = THETA[j] * D2R, c = Math.cos(t), s = Math.sin(t);
      th[j] = t;
      var npv = 1 / Math.sqrt((c * c) / (noP * noP) + (s * s) / (neP * neP));
      kp[j] = (2 * Math.PI * npv) / lp;
      kiGuess[j] = (2 * Math.PI * n_e_theta(li, t)) / li;
    }
    for (var i = 0; i < nA; i++) {
      var a = ALPHA[i] * D2R, sa = Math.sin(a), ca = Math.cos(a);
      for (var k = 0; k < nT; k++) {
        var sinAi = (ks * sa) / kiGuess[k];
        if (sinAi > 1) sinAi = 1; else if (sinAi < -1) sinAi = -1;
        var ai = Math.asin(sinAi);
        var ti = th[k] - ai, ct = Math.cos(ti), st = Math.sin(ti);
        var niFinal = 1 / Math.sqrt((ct * ct) / (noI * noI) + (st * st) / (neI * neI));
        var ki = (2 * Math.PI * niFinal) / li;
        var dkz = kp[k] - ks * ca - ki * Math.cos(ai);
        var v = npSinc((dkz * L) / (2 * Math.PI));
        Z[i * nT + k] = v * v;
      }
    }
    return Z;
  }

  /** Lock logic from sync_wavelengths(). lock: 0 = pump, 1 = signal, 2 = idler; sender: 'P' | 'S' | 'I'. */
  function sync(state, lock, sender) {
    var lp = state.lp, ls = state.ls, li = state.li;
    if (lock === 0) {
      if (sender === "P") { ls = li = 2 * lp; }
      else if (sender === "S") { li = 1 / (1 / lp - 1 / ls); }
      else if (sender === "I") { ls = 1 / (1 / lp - 1 / li); }
    } else if (lock === 1) {
      if (sender === "S") { lp = ls / 2; li = ls; }
      else if (sender === "P") { li = 1 / (1 / lp - 1 / ls); }
      else if (sender === "I") { lp = 1 / (1 / ls + 1 / li); }
    } else {
      if (sender === "I") { lp = li / 2; ls = li; }
      else if (sender === "P") { ls = 1 / (1 / lp - 1 / li); }
      else if (sender === "S") { lp = 1 / (1 / ls + 1 / li); }
    }
    return { lp: lp, ls: ls, li: li };
  }

  /* ---------- magma colormap (Matplotlib control points, linearly interpolated) ---------- */
  var MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 89, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
  var LUT = (function () {
    var lut = new Uint8ClampedArray(256 * 3);
    for (var i = 0; i < 256; i++) {
      var p = (i / 255) * (MAGMA.length - 1), k = Math.min(MAGMA.length - 2, Math.floor(p)), f = p - k;
      for (var c = 0; c < 3; c++) lut[i * 3 + c] = MAGMA[k][c] + (MAGMA[k + 1][c] - MAGMA[k][c]) * f;
    }
    return lut;
  })();

  /* ---------- UI ---------- */
  function init(root) {
    var canvas = root.querySelector("canvas");
    var ctx = canvas.getContext("2d");
    var heat = document.createElement("canvas");
    heat.width = THETA.length; heat.height = ALPHA.length;
    var hctx = heat.getContext("2d");
    var img = hctx.createImageData(heat.width, heat.height);
    var sliders = { P: root.querySelector("[name=lp]"), S: root.querySelector("[name=ls]"), I: root.querySelector("[name=li]") };
    var outs = { P: root.querySelector("[data-out=lp]"), S: root.querySelector("[data-out=ls]"), I: root.querySelector("[data-out=li]") };
    var status = root.querySelector("[data-out=status]");
    var state = { lp: parseFloat(sliders.P.value), ls: parseFloat(sliders.S.value), li: parseFloat(sliders.I.value) };
    var lock = 0;
    var pending = false;

    function css(name) { return getComputedStyle(root).getPropertyValue(name).trim() || "#111"; }

    function compute() {
      var valid = state.lp > 0 && state.ls > 0 && state.li > 0 && isFinite(state.lp + state.ls + state.li);
      var Z = valid ? efficiencyMatrix(state.lp, state.ls, state.li) : null;
      var W = heat.width, H = heat.height, d = img.data;
      for (var r = 0; r < H; r++) {
        for (var c = 0; c < W; c++) {
          var v = Z ? Z[r * W + c] : NaN;
          var o = ((H - 1 - r) * W + c) * 4; // origin='lower': row 0 (αs = −3.5°) at the bottom
          if (!isFinite(v)) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 0; continue; }
          var idx = Math.max(0, Math.min(255, Math.round(v * 255))) * 3;
          d[o] = LUT[idx]; d[o + 1] = LUT[idx + 1]; d[o + 2] = LUT[idx + 2]; d[o + 3] = 255;
        }
      }
      hctx.putImageData(img, 0, 0);
      status.textContent = valid ? "" : "These wavelengths have no physical solution (a computed wavelength is zero or negative).";
      draw();
    }

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var cssW = canvas.clientWidth, cssH = Math.round(cssW * 0.62);
      canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var small = cssW < 560;
      var m = { l: small ? 46 : 64, r: small ? 58 : 78, t: small ? 30 : 36, b: small ? 40 : 48 };
      var pw = cssW - m.l - m.r, ph = cssH - m.t - m.b;
      var fg = css("--fg"), fg2 = css("--fg-2"), rule = css("--rule-strong");
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#000004";
      ctx.fillRect(m.l, m.t, pw, ph);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(heat, m.l, m.t, pw, ph);
      ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.strokeRect(m.l + 0.5, m.t + 0.5, pw - 1, ph - 1);
      var font = (small ? 10 : 11) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.font = font; ctx.fillStyle = fg2; ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (var t = 50; t <= 130; t += small ? 20 : 10) {
        var x = m.l + ((t - 50) / 80) * pw;
        ctx.fillRect(x, m.t + ph, 1, 4);
        ctx.fillText(String(t), x, m.t + ph + 7);
      }
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (var a = -3; a <= 3; a += 1) {
        var y = m.t + ph - ((a + 3.5) / 7) * ph;
        ctx.fillRect(m.l - 4, y, 4, 1);
        ctx.fillText(String(a), m.l - 8, y);
      }
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(small ? "θpm (degrees)" : "Pump phase-matching angle θpm (degrees)", m.l + pw / 2, cssH - 6);
      ctx.save(); ctx.translate(small ? 11 : 14, m.t + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText(small ? "αs (degrees)" : "Internal signal emission angle αs (degrees)", 0, 0); ctx.restore();
      // title, as in the Python
      ctx.fillStyle = fg; ctx.font = (small ? 10 : 12.5) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.fillText("SPDC Type II: P=" + (state.lp * 1000).toFixed(1) + "nm | S=" + (state.ls * 1000).toFixed(1) + "nm | I=" + (state.li * 1000).toFixed(1) + "nm", m.l + pw / 2, m.t - 12);
      // colorbar
      var cbx = m.l + pw + (small ? 12 : 16), cbw = small ? 10 : 14;
      for (var k = 0; k < ph; k++) {
        var idx = Math.round((1 - k / (ph - 1)) * 255) * 3;
        ctx.fillStyle = "rgb(" + LUT[idx] + "," + LUT[idx + 1] + "," + LUT[idx + 2] + ")";
        ctx.fillRect(cbx, m.t + k, cbw, 1.5);
      }
      ctx.strokeStyle = rule; ctx.strokeRect(cbx + 0.5, m.t + 0.5, cbw - 1, ph - 1);
      ctx.font = font; ctx.fillStyle = fg2; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      for (var v = 0; v <= 1.0001; v += 0.2) ctx.fillText(v.toFixed(1), cbx + cbw + 4, m.t + ph - v * ph);
      ctx.save(); ctx.translate(cssW - 6, m.t + ph / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = "center";
      ctx.fillText(small ? "Efficiency (sinc²)" : "Phase-matching efficiency (sinc²)", 0, 0); ctx.restore();
    }

    function show() {
      ["P", "S", "I"].forEach(function (k) {
        var v = k === "P" ? state.lp : k === "S" ? state.ls : state.li;
        if (isFinite(v)) sliders[k].value = v;
        outs[k].textContent = isFinite(v) ? v.toFixed(3) + " µm" : "—";
      });
    }

    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; compute(); });
    }

    ["P", "S", "I"].forEach(function (k) {
      sliders[k].addEventListener("input", function () {
        var v = parseFloat(sliders[k].value);
        if (k === "P") state.lp = v; else if (k === "S") state.ls = v; else state.li = v;
        state = sync(state, lock, k);
        show();
        schedule();
      });
    });
    root.querySelectorAll("[name=lock]").forEach(function (r) {
      r.addEventListener("change", function () { if (r.checked) lock = +r.value; });
    });
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    var lastW = 0;
    window.addEventListener("resize", function () { if (canvas.clientWidth !== lastW) { lastW = canvas.clientWidth; draw(); } });
    show();
    compute();
  }

  window.SPDC = { n_o: n_o, n_e_axis: n_e_axis, efficiencyMatrix: efficiencyMatrix, sync: sync, THETA: THETA, ALPHA: ALPHA };
  function boot() { document.querySelectorAll('[data-fig="spdc-heatmap"]').forEach(init); }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }
})();
