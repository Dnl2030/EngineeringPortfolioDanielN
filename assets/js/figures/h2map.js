/*
 * H2 spark-ignition 3D flammability map — a port of Plot_3D_Flammability.py (Dash + Plotly) to the browser.
 * The precomputed grid (plot3D_data.npy) ships as assets/data/h2-flammability-map.js; Plotly's 3D bundle is
 * vendored in assets/vendor. Both load only when the figure scrolls near the viewport.
 *
 * Ported faithfully from build_figure() and the Dash callbacks:
 *   full view · highlight (log10 τ ± 0.025, boundary by 6-neighbour binary erosion, as scipy.ndimage.binary_erosion)
 *   slice (surface coloured by log10 τ plus 8 contour levels, camera presets) · optimizer (fix two axes,
 *   find the shortest ignition delay along the third).
 */
(function () {
  "use strict";
  var WINDOW = 0.025;
  // plotly.colors.sequential.Plasma, reversed ("plasma_r" in the Python, which Plotly's Python layer expands to these stops)
  var PLASMA = ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"];
  var PLASMA_R = PLASMA.slice().reverse().map(function (c, i, a) { return [i / (a.length - 1), c]; });
  var AXES = ["P", "φ", "T_spark"];
  var LABEL = { P: "Pressure (P)", "φ": "Equivalence ratio (φ)", T_spark: "Spark temperature" };
  var CAMERA = {
    P: { eye: { x: 2.05, y: 0, z: 0.5 }, up: { x: 0, y: 0, z: 1 } },
    "φ": { eye: { x: 0, y: 2.05, z: 0.5 }, up: { x: 0, y: 0, z: 1 } },
    T_spark: { eye: { x: 0, y: 0.5, z: 2.05 }, up: { x: 0, y: 1, z: 0 } }
  };

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------------ data */
  function prepare(raw) {
    var bin = atob(raw.cube), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var cube = new Float32Array(bytes.buffer); // [iT][iPhi][iP]
    var phi = raw.phi, P = raw.P, T = raw.T, nP = P.length, nF = phi.length, nT = T.length;
    var at = function (iT, iF, iP) { return cube[(iT * nF + iF) * nP + iP]; };
    // Flatten as in the Python: meshgrid(P, phi, T, indexing='ij').flatten(), values = cube.transpose(2,1,0).flatten()
    var X = [], Y = [], Z = [], V = [], Xn = [], Yn = [], Zn = [], validIdx = [];
    var tmin = Infinity, tmax = -Infinity;
    for (var a = 0; a < nP; a++) for (var b = 0; b < nF; b++) for (var c = 0; c < nT; c++) {
      var v = at(c, b, a);
      if (isNaN(v)) { Xn.push(P[a]); Yn.push(phi[b]); Zn.push(T[c]); continue; }
      X.push(P[a]); Y.push(phi[b]); Z.push(T[c]); V.push(v); validIdx.push((a * nF + b) * nT + c);
      if (v < tmin) tmin = v; if (v > tmax) tmax = v;
    }
    return { raw: raw, at: at, phi: phi, P: P, T: T, nP: nP, nF: nF, nT: nT, X: X, Y: Y, Z: Z, V: V, Xn: Xn, Yn: Yn, Zn: Zn,
      validIdx: validIdx, tmin: tmin, tmax: tmax, arrays: { P: P, "φ": phi, T_spark: T } };
  }

  /** get_boundary: in-range voxels that are not interior under 6-neighbour erosion (border counts as outside). */
  function boundary(D, inRange) {
    var full = new Uint8Array(D.nP * D.nF * D.nT);
    D.validIdx.forEach(function (fi, k) { if (inRange[k]) full[fi] = 1; });
    var nF = D.nF, nT = D.nT;
    var id = function (a, b, c) { return (a * nF + b) * nT + c; };
    return D.validIdx.map(function (fi, k) {
      if (!inRange[k]) return false;
      var c = fi % nT, b = Math.floor(fi / nT) % nF, a = Math.floor(fi / (nT * nF));
      var interior = a > 0 && a < D.nP - 1 && b > 0 && b < nF - 1 && c > 0 && c < nT - 1 &&
        full[id(a - 1, b, c)] && full[id(a + 1, b, c)] && full[id(a, b - 1, c)] && full[id(a, b + 1, c)] && full[id(a, b, c - 1)] && full[id(a, b, c + 1)];
      return !interior;
    });
  }

  /** get_contour_lines: marching squares on a 2-D grid (rows = y, cols = x), NaN filled with the mean, 8 levels. */
  function contours(grid, xs, ys, nLevels) {
    nLevels = nLevels || 8;
    var rows = grid.length, cols = grid[0].length, sum = 0, n = 0, lo = Infinity, hi = -Infinity;
    grid.forEach(function (r) { r.forEach(function (v) { if (!isNaN(v)) { sum += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!n) return [];
    var mean = sum / n, g = grid.map(function (r) { return r.map(function (v) { return isNaN(v) ? mean : v; }); });
    var out = [];
    for (var L = 0; L < nLevels; L++) {
      var level = lo + ((hi - lo) * L) / (nLevels - 1), sx = [], sy = [];
      for (var i = 0; i < rows - 1; i++) for (var j = 0; j < cols - 1; j++) {
        var v0 = g[i][j], v1 = g[i][j + 1], v2 = g[i + 1][j + 1], v3 = g[i + 1][j];
        var pts = [];
        var edge = function (va, vb, xa, ya, xb, yb) {
          if ((va < level) !== (vb < level)) { var t = (level - va) / (vb - va); pts.push([xa + t * (xb - xa), ya + t * (yb - ya)]); }
        };
        edge(v0, v1, xs[j], ys[i], xs[j + 1], ys[i]);
        edge(v1, v2, xs[j + 1], ys[i], xs[j + 1], ys[i + 1]);
        edge(v2, v3, xs[j + 1], ys[i + 1], xs[j], ys[i + 1]);
        edge(v3, v0, xs[j], ys[i + 1], xs[j], ys[i]);
        for (var p = 0; p + 1 < pts.length; p += 2) { sx.push(pts[p][0], pts[p + 1][0], null); sy.push(pts[p][1], pts[p + 1][1], null); }
      }
      if (sx.length) out.push({ x: sx, y: sy, level: level });
    }
    return out;
  }

  function nearest(arr, v) { var best = 0; for (var i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i; return best; }
  function fmt(v, d) { return Number(v).toFixed(d); }
  function filt(arr, mask) { return arr.filter(function (_, k) { return mask[k]; }); }

  /* ------------------------------------------------------------------ build_figure */
  function build(D, st, theme) {
    var traces = [], camera = null, title, cs = PLASMA_R, rev = false;
    var cbar = { title: { text: "log₁₀(τ / s)", side: "right" }, x: 0.98, len: 0.75, thickness: 12, tickfont: { color: theme.fg2 } };
    var hover = "P: %{x:.1f} atm<br>φ: %{y:.2f}<br>T_spark: %{z:.0f} K<br>log₁₀(τ): %{customdata:.2f}<extra></extra>";
    var head = "H₂ Spark Ignition — 3D Flammability Map  |  V_chamber = " + D.raw.V_chamber + " cm³";

    if (st.mode === "highlight") {
      var tc = st.tau;
      var inR = D.V.map(function (v) { return v >= tc - WINDOW && v <= tc + WINDOW; });
      var outR = inR.map(function (b) { return !b; });
      var bnd = boundary(D, inR);
      traces.push({ type: "scatter3d", mode: "markers", x: filt(D.X, outR), y: filt(D.Y, outR), z: filt(D.Z, outR), marker: { size: 6, color: "#cccccc", opacity: 0.03 }, hoverinfo: "skip", showlegend: false });
      var vin = filt(D.V, inR);
      traces.push({ type: "scatter3d", mode: "markers", x: filt(D.X, inR), y: filt(D.Y, inR), z: filt(D.Z, inR),
        marker: { size: 8, color: "white", opacity: 1, line: { width: 2, color: vin, colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax } },
        customdata: vin, hovertemplate: hover, showlegend: false });
      traces.push({ type: "scatter3d", mode: "markers", x: filt(D.X, bnd), y: filt(D.Y, bnd), z: filt(D.Z, bnd), marker: { size: 10, color: "white", opacity: 1, line: { width: 3, color: "black" } }, hoverinfo: "skip", showlegend: false });
      traces.push({ type: "scatter3d", mode: "markers", x: D.Xn, y: D.Yn, z: D.Zn, marker: { size: 5, color: "#5c5c5c", opacity: 0.04 }, hoverinfo: "skip", showlegend: false });
      traces.push({ type: "scatter3d", mode: "markers", x: [null], y: [null], z: [null], marker: { size: 0, color: [D.tmin, D.tmax], colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax, showscale: true, colorbar: cbar }, showlegend: false, hoverinfo: "skip" });
      title = head + "<br>Highlighting log₁₀(τ) = " + fmt(tc, 2) + " ± " + WINDOW;
    } else if (st.mode === "slice") {
      var ax = st.sliceAxis, idx = st.sliceIdx, grid, sx, sy, sz, label, paths, xs, ys;
      camera = CAMERA[ax];
      traces.push({ type: "scatter3d", mode: "markers", x: D.X, y: D.Y, z: D.Z, marker: { size: 5, color: D.V, colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax, showscale: false, opacity: 0.02 }, hoverinfo: "skip", showlegend: false });
      traces.push({ type: "scatter3d", mode: "markers", x: D.Xn, y: D.Yn, z: D.Zn, marker: { size: 4, color: "#5c5c5c", opacity: 0.02 }, hoverinfo: "skip", showlegend: false });
      var surf = { type: "surface", colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax, showscale: true, colorbar: cbar, opacity: 1, showlegend: false };
      if (ax === "P") {
        grid = D.T.map(function (_, iT) { return D.phi.map(function (_, iF) { return D.at(iT, iF, idx); }); }); // (T, phi)
        sx = D.T.map(function () { return D.phi.map(function () { return D.P[idx]; }); });
        sy = D.T.map(function () { return D.phi.slice(); });
        sz = D.T.map(function (t) { return D.phi.map(function () { return t; }); });
        label = "P = " + fmt(D.P[idx], 1) + " atm";
        surf.hovertemplate = "P: " + fmt(D.P[idx], 1) + " atm<br>φ: %{y:.2f}<br>T_spark: %{z:.0f} K<br>log₁₀(τ): %{surfacecolor:.2f}<extra></extra>";
        paths = contours(grid, D.phi, D.T);
        paths.forEach(function (p) { traces.push(line3d(p.x.map(function (v) { return v === null ? null : D.P[idx]; }), p.x, p.y, p.level)); });
      } else if (ax === "φ") {
        grid = D.T.map(function (_, iT) { return D.P.map(function (_, iP) { return D.at(iT, idx, iP); }); }); // (T, P)
        sx = D.T.map(function () { return D.P.slice(); });
        sy = D.T.map(function () { return D.P.map(function () { return D.phi[idx]; }); });
        sz = D.T.map(function (t) { return D.P.map(function () { return t; }); });
        label = "φ = " + fmt(D.phi[idx], 2);
        surf.hovertemplate = "P: %{x:.1f} atm<br>φ: " + fmt(D.phi[idx], 2) + "<br>T_spark: %{z:.0f} K<br>log₁₀(τ): %{surfacecolor:.2f}<extra></extra>";
        paths = contours(grid, D.P, D.T);
        paths.forEach(function (p) { traces.push(line3d(p.x, p.x.map(function (v) { return v === null ? null : D.phi[idx]; }), p.y, p.level)); });
      } else {
        grid = D.phi.map(function (_, iF) { return D.P.map(function (_, iP) { return D.at(idx, iF, iP); }); }); // (phi, P)
        sx = D.phi.map(function () { return D.P.slice(); });
        sy = D.phi.map(function (f) { return D.P.map(function () { return f; }); });
        sz = D.phi.map(function () { return D.P.map(function () { return D.T[idx]; }); });
        label = "T_spark = " + fmt(D.T[idx], 0) + " K";
        surf.hovertemplate = "P: %{x:.1f} atm<br>φ: %{y:.2f}<br>T_spark: " + fmt(D.T[idx], 0) + " K<br>log₁₀(τ): %{surfacecolor:.2f}<extra></extra>";
        paths = contours(grid, D.P, D.phi);
        paths.forEach(function (p) { traces.push(line3d(p.x, p.y, p.x.map(function (v) { return v === null ? null : D.T[idx]; }), p.level)); });
      }
      surf.x = sx; surf.y = sy; surf.z = sz; surf.surfacecolor = grid;
      traces.splice(2, 0, surf);
      title = head + "<br>Slice: " + label;
    } else if (st.mode === "opt" && st.opt) {
      var o = st.opt, fi = o.fixed, lv, lx, ly, lz;
      if (o.free === "T_spark") { lv = D.T.map(function (_, i) { return D.at(i, fi["φ"], fi.P); }); lx = D.T.map(function () { return D.P[fi.P]; }); ly = D.T.map(function () { return D.phi[fi["φ"]]; }); lz = D.T.slice(); }
      else if (o.free === "φ") { lv = D.phi.map(function (_, i) { return D.at(fi.T_spark, i, fi.P); }); lx = D.phi.map(function () { return D.P[fi.P]; }); ly = D.phi.slice(); lz = D.phi.map(function () { return D.T[fi.T_spark]; }); }
      else { lv = D.P.map(function (_, i) { return D.at(fi.T_spark, fi["φ"], i); }); lx = D.P.slice(); ly = D.P.map(function () { return D.phi[fi["φ"]]; }); lz = D.P.map(function () { return D.T[fi.T_spark]; }); }
      traces.push({ type: "scatter3d", mode: "markers", x: D.X, y: D.Y, z: D.Z, marker: { size: 4, color: D.V, colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax, showscale: false, opacity: 0.03 }, hoverinfo: "skip", showlegend: false });
      traces.push({ type: "scatter3d", mode: "markers", x: D.Xn, y: D.Yn, z: D.Zn, marker: { size: 3, color: "#5c5c5c", opacity: 0.03 }, hoverinfo: "skip", showlegend: false });
      var ok = lv.map(function (v) { return !isNaN(v); });
      if (ok.some(Boolean)) {
        var lvv = filt(lv, ok);
        traces.push({ type: "scatter3d", mode: "markers+lines", x: filt(lx, ok), y: filt(ly, ok), z: filt(lz, ok),
          marker: { size: 9, color: lvv, colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax, showscale: true, colorbar: cbar, opacity: 1 },
          line: { color: "white", width: 3 }, customdata: lvv, hovertemplate: hover, showlegend: false });
        var bi = o.bestIdx;
        traces.push({ type: "scatter3d", mode: "markers", x: [lx[bi]], y: [ly[bi]], z: [lz[bi]], marker: { size: 14, color: "white", opacity: 1, line: { width: 3, color: "gold" } }, hoverinfo: "skip", showlegend: false });
      }
      var parts = Object.keys(fi).map(function (k) { return k === "P" ? "P = " + fmt(D.P[fi[k]], 1) + " atm" : k === "φ" ? "φ = " + fmt(D.phi[fi[k]], 3) : "T_spark = " + fmt(D.T[fi[k]], 0) + " K"; });
      title = "H₂ Spark Ignition — Optimizer  |  Free: " + { P: "Pressure (atm)", "φ": "φ", T_spark: "T_spark (K)" }[o.free] + "  |  Fixed: " + parts.join(", ");
    } else {
      traces.push({ type: "scatter3d", mode: "markers", x: D.X, y: D.Y, z: D.Z, marker: { size: 7, color: D.V, colorscale: cs, reversescale: rev, cmin: D.tmin, cmax: D.tmax, showscale: true, colorbar: cbar }, customdata: D.V, hovertemplate: hover, showlegend: false });
      traces.push({ type: "scatter3d", mode: "markers", x: D.Xn, y: D.Yn, z: D.Zn, marker: { size: 5, color: "#5c5c5c", opacity: 0.15 }, hoverinfo: "skip", showlegend: false });
      title = "H₂ Spark Ignition — 3D Flammability Map<br>V_chamber = " + D.raw.V_chamber + " cm³  |  Full view";
    }

    function line3d(x, y, z, level) {
      return { type: "scatter3d", mode: "lines", x: x, y: y, z: z, line: { color: "black", width: 2 }, hovertemplate: "log₁₀(τ) = " + fmt(level, 2) + "<extra></extra>", showlegend: false };
    }

    var axis = function (t, arr) {
      return { title: { text: t, font: { color: theme.fg2, size: 11 } }, range: [Math.min.apply(null, arr), Math.max.apply(null, arr)],
        color: theme.fg2, gridcolor: theme.grid, zerolinecolor: theme.grid, backgroundcolor: "rgba(0,0,0,0)", showbackground: false, tickfont: { size: 10 } };
    };
    var layout = {
      title: { text: title, x: 0.5, font: { size: 12.5, color: theme.fg, family: "Geist Mono, ui-monospace, monospace" } },
      scene: { xaxis: axis("Pressure (atm)", D.P), yaxis: axis("Equivalence Ratio φ", D.phi), zaxis: axis("T_spark (K)", D.T), aspectmode: "cube" },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Geist, system-ui, sans-serif", color: theme.fg2 },
      margin: { t: 64, b: 8, l: 0, r: 0 }, autosize: true, uirevision: "constant",
      hoverlabel: { font: { family: "Geist Mono, ui-monospace, monospace", size: 12 } }
    };
    if (camera) layout.scene.camera = camera;
    return { data: traces, layout: layout };
  }

  /* ------------------------------------------------------------------ optimizer (run_optimizer) */
  function optimize(D, free, fixedVals) {
    var fixed = {};
    Object.keys(fixedVals).forEach(function (k) {
      var arr = D.arrays[k], v = fixedVals[k];
      if (v === null || isNaN(v)) v = arr[Math.floor(arr.length / 2)];
      fixed[k] = nearest(arr, v);
    });
    var lv, freeArr, unit, dec;
    if (free === "T_spark") { lv = D.T.map(function (_, i) { return D.at(i, fixed["φ"], fixed.P); }); freeArr = D.T; unit = "K"; dec = 0; }
    else if (free === "φ") { lv = D.phi.map(function (_, i) { return D.at(fixed.T_spark, i, fixed.P); }); freeArr = D.phi; unit = ""; dec = 3; }
    else { lv = D.P.map(function (_, i) { return D.at(fixed.T_spark, fixed["φ"], i); }); freeArr = D.P; unit = "atm"; dec = 2; }
    var best = -1;
    lv.forEach(function (v, i) { if (!isNaN(v) && (best < 0 || v < lv[best])) best = i; });
    if (best < 0) return { error: "No valid data at these fixed values." };
    return { free: free, fixed: fixed, bestIdx: best, best: freeArr[best], tau: lv[best], unit: unit, dec: dec };
  }

  /* ------------------------------------------------------------------ UI */
  function init(root) {
    var plotEl = root.querySelector(".h2map__plot"), status = root.querySelector("[data-out=status]");
    var base = root.getAttribute("data-base") || "";
    var started = false, D = null, st = { mode: "full", tau: null, sliceAxis: "T_spark", sliceIdx: 20, opt: null };
    var q = function (s) { return root.querySelector(s); };
    var btnH = q("[data-act=highlight]"), btnS = q("[data-act=slice]"), boxH = q(".h2map__hl"), boxS = q(".h2map__sl");
    var tauR = q("[name=tau]"), tauN = q("[name=tau-num]"), axisSel = q("[name=slice-axis]"), sliceR = q("[name=slice-pos]"), sliceOut = q("[data-out=slice]");
    var freeSel = q("[name=opt-free]"), fixedBox = q(".h2map__fixed"), result = q("[data-out=opt]");

    function theme() {
      var cs = getComputedStyle(root);
      return { fg: cs.getPropertyValue("--fg").trim() || "#f5f3ee", fg2: cs.getPropertyValue("--fg-2").trim() || "#8a8d90", grid: "rgba(138,141,144,0.28)" };
    }
    function render() {
      var fig = build(D, st, theme());
      window.Plotly.react(plotEl, fig.data, fig.layout, { responsive: true, displayModeBar: false });
    }
    function setModeButtons() {
      btnH.setAttribute("aria-pressed", st.mode === "highlight" ? "true" : "false");
      btnS.setAttribute("aria-pressed", st.mode === "slice" ? "true" : "false");
      btnH.textContent = st.mode === "highlight" ? "Disable highlight mode" : "Enable highlight mode";
      btnS.textContent = st.mode === "slice" ? "Disable slice mode" : "Enable slice mode";
      boxH.hidden = st.mode !== "highlight"; boxS.hidden = st.mode !== "slice";
    }
    function sliceLabel() {
      var arr = D.arrays[st.sliceAxis], v = arr[st.sliceIdx];
      sliceOut.textContent = st.sliceAxis === "P" ? fmt(v, 2) + " atm" : st.sliceAxis === "φ" ? fmt(v, 3) : fmt(v, 1) + " K";
    }
    function renderFixed() {
      var labels = { P: "Pressure (atm)", "φ": "Equiv. ratio φ", T_spark: "T_spark (K)" };
      fixedBox.innerHTML = "";
      AXES.filter(function (a) { return a !== freeSel.value; }).forEach(function (a) {
        var arr = D.arrays[a], mid = arr[Math.floor(arr.length / 2)], id = "h2fix-" + (a === "φ" ? "phi" : a);
        var wrap = document.createElement("div"); wrap.className = "ctrl";
        wrap.innerHTML = '<div class="ctrl__label"><label for="' + id + '">' + labels[a] + '</label><output>' + Number(arr[0].toPrecision(2)) + "–" + Number(arr[arr.length - 1].toPrecision(2)) + "</output></div>" +
          '<input id="' + id + '" type="number" data-axis="' + a + '" min="' + arr[0] + '" max="' + arr[arr.length - 1] + '" step="any" value="' + Number(mid.toFixed(4)) + '">';
        fixedBox.appendChild(wrap);
      });
      fixedBox.querySelectorAll("input").forEach(function (inp) { inp.addEventListener("change", clearOpt); });
    }
    function clearOpt() { if (st.mode === "opt") { st.mode = "full"; st.opt = null; render(); } result.innerHTML = ""; }

    function wire() {
      var mid = Math.round(((D.tmin + D.tmax) / 2) * 100) / 100;
      [tauR, tauN].forEach(function (el) { el.min = (Math.round(D.tmin * 100) / 100); el.max = (Math.round(D.tmax * 100) / 100); el.step = 0.05; el.value = mid; });
      st.tau = mid;
      btnH.addEventListener("click", function () { st.mode = st.mode === "highlight" ? "full" : "highlight"; st.opt = null; result.innerHTML = ""; setModeButtons(); render(); });
      btnS.addEventListener("click", function () { st.mode = st.mode === "slice" ? "full" : "slice"; st.opt = null; result.innerHTML = ""; setModeButtons(); render(); });
      tauR.addEventListener("input", function () { st.tau = parseFloat(tauR.value); tauN.value = st.tau.toFixed(2); render(); });
      tauN.addEventListener("change", function () { var v = Math.max(+tauR.min, Math.min(+tauR.max, parseFloat(tauN.value))); if (isNaN(v)) return; st.tau = v; tauR.value = v; render(); });
      axisSel.addEventListener("change", function () { st.sliceAxis = axisSel.value; st.sliceIdx = Math.floor(D.arrays[st.sliceAxis].length / 2); sliceR.max = D.arrays[st.sliceAxis].length - 1; sliceR.value = st.sliceIdx; sliceLabel(); render(); });
      sliceR.addEventListener("input", function () { st.sliceIdx = +sliceR.value; sliceLabel(); render(); });
      freeSel.addEventListener("change", function () { renderFixed(); clearOpt(); });
      q("[data-act=optimize]").addEventListener("click", function () {
        var fixedVals = {};
        fixedBox.querySelectorAll("input").forEach(function (inp) { fixedVals[inp.getAttribute("data-axis")] = parseFloat(inp.value); });
        var r = optimize(D, freeSel.value, fixedVals);
        if (r.error) { result.innerHTML = '<span class="h2map__err">' + r.error + "</span>"; return; }
        var names = { P: "Pressure", "φ": "φ", T_spark: "T_spark" }, units = { P: "atm", "φ": "", T_spark: "K" }, decs = { P: 2, "φ": 3, T_spark: 0 };
        var fixedDesc = Object.keys(r.fixed).map(function (k) { return (k + " = " + fmt(D.arrays[k][r.fixed[k]], decs[k]) + " " + units[k]).trim(); });
        result.innerHTML = '<span class="label">Optimal <span class="sym">' + names[r.free] + '</span></span><span class="h2map__big">' + (fmt(r.best, r.dec) + " " + r.unit).trim() +
          '</span><span class="label"><span class="sym">log₁₀(τ)</span> at optimum</span><span class="h2map__big h2map__big--tau">' + fmt(r.tau, 3) + '</span><span class="h2map__fixed-desc">Fixed: ' + fixedDesc.join(", ") + "</span>";
        if (st.mode === "full" || st.mode === "opt") { st.mode = "opt"; st.opt = r; render(); }
      });
      sliceR.max = D.arrays[st.sliceAxis].length - 1; sliceR.value = st.sliceIdx; sliceLabel();
      renderFixed(); setModeButtons();
      new MutationObserver(function () { if (D) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }

    function start() {
      if (started) return; started = true;
      status.textContent = "Loading the 3D map…";
      var need = [];
      if (!window.Plotly) need.push(base + "assets/vendor/plotly-gl3d-2.35.3.min.js");
      if (!window.H2_FLAMMABILITY) need.push(base + "assets/data/h2-flammability-map.js");
      need.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve())
        .then(function () {
          D = prepare(window.H2_FLAMMABILITY);
          root.classList.add("is-ready");
          status.textContent = "";
          wire();
          render();
        })
        .catch(function (e) { status.textContent = e.message + ". The recording below shows the same map."; root.classList.add("is-failed"); });
    }
    root.querySelector("[data-act=load]").addEventListener("click", start);
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: "600px 0px" });
      io.observe(root);
    }
  }

  window.H2Map = { prepare: prepare, boundary: boundary, contours: contours, optimize: optimize, build: build };
  function boot() { document.querySelectorAll("[data-fig=h2map]").forEach(init); }
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
})();
