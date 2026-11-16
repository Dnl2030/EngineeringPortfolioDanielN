/*
 * Fourier Lab — the Flask app (app.py, DisplayFunction.py, displayfft.py, static/script.js) ported to run
 * entirely in the browser. The server-side NumPy/SciPy steps are reproduced in JavaScript:
 *   - preprocess_input()            implicit multiplication, sinx → sin(x), ^ → **
 *   - get_plot_data / get_sum_plot_data   5,000 samples on [x_min, x_max], NaN/inf → 0, Tukey window
 *                                          (α = 1 − 150 / (x_max − x_min)), 500 zero samples padded on each side
 *   - display_fft / display_fft_from_values   N-point FFT, Tukey window, fftshift, ω = 2π f, |F| / N
 *   - winding (client side in the original): y·e^(−iωx) and its centre of mass, with the original
 *     animation that slows down and pauses near spectral peaks.
 * Expressions are parsed by a small safe parser with Python operator precedence instead of eval().
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ parsing */
  function preprocessInput(s) {
    // Mirrors DisplayFunction.preprocess_input (Python regexes)
    s = s.replace(/\bSin\b/gi, "sin").replace(/\bCos\b/gi, "cos").replace(/\bPi\b/gi, "pi").replace(/\bX\b/gi, "x");
    s = s.replace(/\b(sin|cos)\s*([-+]?\d*\.?\d*)x\b/g, "$1($2x)");
    s = s.replace(/\b(sin|cos)\s*x\b/g, "$1(x)");
    s = s.replace(/(\d)(x|\()/g, "$1*$2");
    s = s.replace(/(\))([x(])/g, "$1*$2");
    s = s.replace(/(\))(sin|cos)/g, "$1*$2");
    s = s.replace(/(sin|cos)\s*\^(\d+)\s*\(\s*(.*?)\s*\)/g, "($1($3))**$2");
    return s.replace(/\^/g, "**");
  }

  var FUNCS = { sin: Math.sin, cos: Math.cos };
  /** Compile an expression in x (and n in summation mode) to a function. Python precedence: ** binds tighter than unary minus. */
  function compile(src, allowN) {
    var tokens = [], re = /\s*(\d+\.\d*|\.\d+|\d+|\*\*|[A-Za-z_]+|[-+*/()])/y, m;
    re.lastIndex = 0;
    while (re.lastIndex < src.length) {
      if (/^\s*$/.test(src.slice(re.lastIndex))) break;
      m = re.exec(src);
      if (!m) throw new Error("Unexpected character near “" + src.slice(re.lastIndex, re.lastIndex + 4).trim() + "”");
      tokens.push(m[1]);
    }
    var i = 0;
    function peek() { return tokens[i]; }
    function take(t) { if (tokens[i] !== t) throw new Error("Expected “" + t + "”"); i++; }
    // Each binary node gets its own scope so chained operators never share captured variables.
    function bin(op, a, b) {
      if (op === "+") return function (x, n) { return a(x, n) + b(x, n); };
      if (op === "-") return function (x, n) { return a(x, n) - b(x, n); };
      if (op === "*") return function (x, n) { return a(x, n) * b(x, n); };
      return function (x, n) { return a(x, n) / b(x, n); };
    }
    function expr() {
      var f = term();
      while (peek() === "+" || peek() === "-") { var op = tokens[i++]; f = bin(op, f, term()); }
      return f;
    }
    function term() {
      var f = unary();
      while (peek() === "*" || peek() === "/") { var op = tokens[i++]; f = bin(op, f, unary()); }
      return f;
    }
    function unary() {
      if (peek() === "-") { i++; var a = unary(); return function (x, n) { return -a(x, n); }; }
      if (peek() === "+") { i++; return unary(); }
      return power();
    }
    function power() {
      var base = atom();
      if (peek() === "**") { i++; var ex = unary(); return function (x, n) { return Math.pow(base(x, n), ex(x, n)); }; }
      return base;
    }
    function atom() {
      var t = tokens[i++];
      if (t === undefined) throw new Error("Expression ends too early");
      if (t === "(") { var e = expr(); take(")"); return e; }
      if (/^[\d.]/.test(t)) { var v = parseFloat(t); return function () { return v; }; }
      if (t === "x") return function (x) { return x; };
      if (t === "n") { if (!allowN) throw new Error("“n” is only available in summation mode"); return function (x, n) { return n; }; }
      if (t === "pi") return function () { return Math.PI; };
      if (t === "e") return function () { return Math.E; };
      if (FUNCS[t]) {
        if (peek() !== "(") throw new Error("“" + t + "” must be followed by an argument, e.g. " + t + "(x)");
        take("("); var arg = expr(); take(")"); var fn = FUNCS[t];
        return function (x, n) { return fn(arg(x, n)); };
      }
      throw new Error("Unknown name “" + t + "”");
    }
    if (!tokens.length) throw new Error("Enter a function of x");
    var f = expr();
    if (i < tokens.length) throw new Error("Unexpected “" + tokens[i] + "”");
    return f;
  }

  /* ------------------------------------------------------------------ numerics */
  function linspace(a, b, n) { var o = new Float64Array(n); for (var k = 0; k < n; k++) o[k] = a + ((b - a) * k) / (n - 1); return o; }
  function clean(v) { return isFinite(v) ? v : 0; } // np.nan_to_num(..., nan=0, posinf=0, neginf=0)

  /** scipy.signal.windows.tukey(M, alpha), symmetric. */
  function tukey(M, alpha) {
    var w = new Float64Array(M);
    if (alpha <= 0) { w.fill(1); return w; }
    if (alpha >= 1) alpha = 1;
    var width = Math.floor((alpha * (M - 1)) / 2);
    for (var k = 0; k < M; k++) {
      if (k <= width) w[k] = 0.5 * (1 + Math.cos(Math.PI * (-1 + (2 * k) / (alpha * (M - 1)))));
      else if (k < M - width - 1) w[k] = 1;
      else w[k] = 0.5 * (1 + Math.cos(Math.PI * (-2 / alpha + 1 + (2 * k) / (alpha * (M - 1)))));
    }
    return w;
  }
  function windowAlpha(xmin, xmax) { return 1 - (2 * 75) / (xmax - xmin); }

  function pad(x, y, xmin, xmax) {
    var P = 500, n = x.length, X = new Float64Array(n + 2 * P), Y = new Float64Array(n + 2 * P);
    for (var k = 0; k < P; k++) { X[k] = xmin - 50 + (50 * k) / P; X[P + n + k] = xmax + (50 * k) / P; }
    for (k = 0; k < n; k++) { X[P + k] = x[k]; Y[P + k] = y[k]; }
    return { x: X, y: Y };
  }

  /** get_plot_data / get_sum_plot_data */
  function plotData(f, xmin, xmax, sum) {
    var x = linspace(xmin, xmax, 5000), y = new Float64Array(5000);
    for (var k = 0; k < 5000; k++) {
      if (sum) { var s = 0; for (var n = sum.lower; n <= sum.upper; n++) s += f(x[k], n); y[k] = clean(s); }
      else y[k] = clean(f(x[k], 0));
    }
    var w = tukey(5000, windowAlpha(xmin, xmax));
    for (k = 0; k < 5000; k++) y[k] *= w[k];
    return pad(x, y, xmin, xmax);
  }

  /** Magnitude spectrum of real data: fft, fftfreq(N, d=T), fftshift, ω = 2π f, |F| / N. */
  function spectrum(y, T) {
    var N = y.length, re = new Float64Array(N), im = new Float64Array(N);
    if ((N & (N - 1)) === 0) {
      for (var k = 0; k < N; k++) re[k] = y[k];
      fftRadix2(re, im);
    } else {
      // Direct DFT for non power-of-two lengths (summation mode), using a twiddle table.
      var c = new Float64Array(N), s = new Float64Array(N);
      for (k = 0; k < N; k++) { c[k] = Math.cos((2 * Math.PI * k) / N); s[k] = Math.sin((2 * Math.PI * k) / N); }
      for (k = 0; k <= N / 2; k++) {
        var sr = 0, si = 0, idx = 0;
        for (var n = 0; n < N; n++) { sr += y[n] * c[idx]; si -= y[n] * s[idx]; idx += k; if (idx >= N) idx -= N; }
        re[k] = sr; im[k] = si;
        if (k > 0 && k < N - k) { re[N - k] = sr; im[N - k] = -si; }
      }
    }
    var freq = new Float64Array(N), mag = new Float64Array(N), half = Math.floor(N / 2);
    for (var j = 0; j < N; j++) {
      var src = (j + (N - half)) % N; // fftshift
      var fi = src < Math.ceil(N / 2) ? src : src - N; // fftfreq index
      freq[j] = ((2 * Math.PI * fi) / (N * T));
      mag[j] = Math.hypot(re[src], im[src]) / N;
    }
    return { freq: freq, mag: mag };
  }
  function fftRadix2(re, im) {
    var N = re.length;
    for (var i = 1, j = 0; i < N; i++) {
      var bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= N; len <<= 1) {
      var ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < N; s += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var a = s + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  /** display_fft (regular mode): evaluate on 2048 samples, window, transform. */
  function fftOfFunction(f, xmin, xmax) {
    var N = 2048, T = (xmax - xmin) / N, t = linspace(xmin, xmax, N), y = new Float64Array(N), w = tukey(N, windowAlpha(xmin, xmax));
    for (var k = 0; k < N; k++) y[k] = clean(f(t[k], 0)) * w[k];
    return spectrum(y, T);
  }
  /** display_fft_from_values (summation mode): window the padded samples again and transform. */
  function fftOfValues(values, xmin, xmax) {
    var N = values.length, T = (xmax - xmin) / N, w = tukey(N, windowAlpha(xmin, xmax)), y = new Float64Array(N);
    for (var k = 0; k < N; k++) y[k] = clean(values[k]) * w[k];
    return spectrum(y, T);
  }

  /** calculateWindingLocally */
  function winding(profile, freq) {
    var x = profile.x, y = profile.y, n = x.length, re = new Float64Array(n), im = new Float64Array(n), sr = 0, si = 0;
    for (var k = 0; k < n; k++) { var a = freq * x[k]; re[k] = y[k] * Math.cos(a); im[k] = -y[k] * Math.sin(a); sr += re[k]; si += im[k]; }
    return { re: re, im: im, comRe: sr / n, comIm: si / n };
  }
  /** getPeaks: local maxima in 0 ≤ ω ≤ 10 above 5% of the maximum, grouped within 0.5. */
  function peaks(spec) {
    var f = spec.freq, m = spec.mag, max = 0, cands = [], groups = [];
    for (var k = 0; k < m.length; k++) max = Math.max(max, m[k]);
    for (k = 1; k < f.length - 1; k++) {
      if (f[k] < 0 || f[k] > 10) continue;
      if (m[k] > max * 0.05 && m[k] > m[k - 1] && m[k] > m[k + 1]) cands.push({ f: f[k], m: m[k] });
    }
    cands.forEach(function (c) {
      var g = groups.filter(function (gr) { return Math.abs(gr[0].f - c.f) < 0.5; })[0];
      if (g) g.push(c); else groups.push([c]);
    });
    return groups.map(function (g) { return g.reduce(function (b, c) { return c.m > b.m ? c : b; }).f; });
  }

  /* ------------------------------------------------------------------ examples (data/*.txt) */
  var EXAMPLES = {
    regular: ["sin(x)", "cos(x)", "sinx + cos(2x)", "sinx/x", "sinx^(2)/x", "sinx^(3)/x", "2*sinx+cosx+4*sin(7*x)+cos(13*x)+12*cos(2*x)",
      "sin(x)/x + 0.8*sin(x - 15)/(x - 15) - 0.5*sin(x + 20)/(x + 20)", "sin(x^(2))", "sin(x^(3))"],
    sum: ["sin((2*n-1)*x)/(2*n-1)", "4/pi*sin((2*n-1)*x*pi)/(2*n-1)", "sin(n*x)*0.1", "sin((2*n-1)*x)*(-1)^(n)/(2*n-1)^(2)", "cos((2*n-1)*x)/(2*n-1)",
      "sin((n-2)*x)/n", "cos(n*x)/(4*n^(2)-1)+sin(n*x)/n", "sin(n*x)/n", "sin(n*x)*(-1)^(n)/n", "sinx^(2*n)/x", "sinx^(3*n)/x", "sinx^(n)/x",
      "sin(x/n)", "sin(x/n^(2))", "sin(3x/n^(2))+cos(x/n)"]
  };

  /* ------------------------------------------------------------------ SVG plotting */
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
  function niceStep(span, count) { var raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag; return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag; }
  function fmtTick(v) { return Math.abs(v) < 1e-9 ? "0" : Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toPrecision(2).replace(/\.?0+$/, ""); }

  /** Draw a line plot. series: [{x, y, cls}], opts: {xr, yr, xl, yl, equal, marks:[{x,y}], vline} */
  function plot(svg, W, H, series, o) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var m = { l: 46, r: 12, t: 10, b: 34 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    var xr = o.xr, yr = o.yr;
    if (o.equal) { var cx = (xr[0] + xr[1]) / 2, span = Math.max(xr[1] - xr[0], ((yr[1] - yr[0]) * pw) / ph); xr = [cx - span / 2, cx + span / 2]; }
    var X = function (v) { return m.l + ((v - xr[0]) / (xr[1] - xr[0])) * pw; };
    var Y = function (v) { return m.t + ph - ((v - yr[0]) / (yr[1] - yr[0])) * ph; };
    var grid = el("g", { class: "plot-grid" }, svg), ax = el("g", { class: "plot-axis" }, svg);
    var sx = niceStep(xr[1] - xr[0], 6), sy = niceStep(yr[1] - yr[0], 4);
    for (var v = Math.ceil(xr[0] / sx) * sx; v <= xr[1] + 1e-9; v += sx) {
      el("line", { x1: X(v), x2: X(v), y1: m.t, y2: m.t + ph }, grid);
      el("text", { x: X(v), y: H - m.b + 16, "text-anchor": "middle", class: "plot-text" }, svg).textContent = fmtTick(v);
    }
    for (v = Math.ceil(yr[0] / sy) * sy; v <= yr[1] + 1e-9; v += sy) {
      el("line", { x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v) }, grid);
      el("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "plot-text" }, svg).textContent = fmtTick(v);
    }
    el("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "none" }, ax);
    el("text", { x: m.l + pw / 2, y: H - 4, "text-anchor": "middle", class: "plot-text" }, svg).textContent = o.xl;
    el("text", { x: 11, y: m.t + ph / 2, "text-anchor": "middle", class: "plot-text", transform: "rotate(-90 11 " + (m.t + ph / 2) + ")" }, svg).textContent = o.yl;
    var clipId = "c" + Math.random().toString(36).slice(2);
    el("rect", { x: m.l, y: m.t, width: pw, height: ph }, el("clipPath", { id: clipId }, el("defs", {}, svg)));
    var g = el("g", { "clip-path": "url(#" + clipId + ")" }, svg);
    if (o.vline != null) el("line", { x1: X(o.vline), x2: X(o.vline), y1: m.t, y2: m.t + ph, class: "fl-vline" }, g);
    series.forEach(function (s) {
      var d = "", step = Math.max(1, Math.floor(s.x.length / 2400));
      for (var k = 0; k < s.x.length; k += step) {
        var px = s.x[k];
        if (!s.all && (px < xr[0] - (xr[1] - xr[0]) * 0.02 || px > xr[1] + (xr[1] - xr[0]) * 0.02)) continue;
        d += (d ? "L" : "M") + X(px).toFixed(1) + "," + Y(s.y[k]).toFixed(1);
      }
      el("path", { d: d, class: s.cls, fill: "none" }, g);
    });
    (o.marks || []).forEach(function (p) { el("circle", { cx: X(p.x), cy: Y(p.y), r: 4.5, class: "fl-com" }, g); });
  }

  /* ------------------------------------------------------------------ UI */
  function init(root) {
    var input = root.querySelector("[name=fn]"), msg = root.querySelector("[data-out=msg]");
    var sumBtn = root.querySelector("[data-act=sum]"), sumBox = root.querySelector(".fl-sum");
    var lower = root.querySelector("[name=lower]"), upper = root.querySelector("[name=upper]");
    var freqIn = root.querySelector("[name=wfreq]"), freqOut = root.querySelector("[data-out=wfreq]"), playBtn = root.querySelector("[data-act=play]");
    var comOut = root.querySelector("[data-out=com]");
    var svgF = root.querySelector("[data-plot=fn]"), svgS = root.querySelector("[data-plot=fft]"), svgC = root.querySelector("[data-plot=complex]");
    var XMIN = -100, XMAX = 100;
    var isSum = false, profile = null, spec = null, pk = [], wf = 0, dir = 1, playing = false, last = null, hold = 0, held = false, lastEx = "";

    function setMsg(text, kind) { msg.textContent = text; msg.setAttribute("data-kind", kind); input.setAttribute("aria-invalid", kind === "bad" ? "true" : "false"); }

    function validate(value) {
      var p = preprocessInput(value);
      var allowed = isSum ? /^[0-9xne+\-*/.^()\sa-z]*$/i : /^[0-9xe+\-*/.^()\sa-z]*$/i;
      if (!allowed.test(p)) { setMsg("Invalid characters.", "bad"); return null; }
      try { var f = compile(p, isSum); setMsg("Proper syntax.", "good"); return f; }
      catch (e) { setMsg(e.message + ".", "bad"); return null; }
    }

    function run() {
      var f = validate(input.value);
      if (!f) return;
      var sum = null;
      if (isSum) {
        var lo = parseInt(lower.value, 10), hi = parseInt(upper.value, 10);
        if (!isFinite(lo) || !isFinite(hi) || hi < lo) { setMsg("Set summation bounds with the upper bound ≥ the lower bound.", "bad"); return; }
        if (hi - lo > 400) { setMsg("Keep the summation to 400 terms or fewer so it stays responsive.", "bad"); return; }
        sum = { lower: lo, upper: hi };
      }
      profile = plotData(f, XMIN, XMAX, sum);
      spec = isSum ? fftOfValues(profile.y, XMIN, XMAX) : fftOfFunction(f, XMIN, XMAX);
      var maxY = 0; for (var k = 0; k < profile.y.length; k++) maxY = Math.max(maxY, Math.abs(profile.y[k]));
      profile.maxR = maxY > 0 ? maxY * 1.1 : 1.5;
      pk = peaks(spec);
      wf = 0; held = false;
      drawStatic();
      drawWinding();
    }

    function drawStatic() {
      var lo = Infinity, hi = -Infinity;
      for (var k = 0; k < profile.x.length; k++) if (profile.x[k] >= -10 && profile.x[k] <= 10) { lo = Math.min(lo, profile.y[k]); hi = Math.max(hi, profile.y[k]); }
      var padY = (hi - lo) * 0.08 || 1;
      plot(svgF, 600, 260, [{ x: profile.x, y: profile.y, cls: "fl-line" }], { xr: [-10, 10], yr: [lo - padY, hi + padY], xl: "x", yl: "y" });
      drawSpectrum();
    }
    function drawSpectrum() {
      var max = 0, reach = 5;
      for (var k = 0; k < spec.mag.length; k++) max = Math.max(max, spec.mag[k]);
      for (k = 0; k < spec.mag.length; k++) if (spec.mag[k] > max * 0.01) reach = Math.max(reach, Math.abs(spec.freq[k]));
      reach = Math.min(reach * 1.15, Math.abs(spec.freq[0]));
      plot(svgS, 600, 260, [{ x: spec.freq, y: spec.mag, cls: "fl-line fl-line--fft" }], { xr: [-reach, reach], yr: [0, (max || 1) * 1.1], xl: "Frequency ω (rad / unit)", yl: "|F(ω)|", vline: wf });
    }
    function drawWinding() {
      if (!profile) return;
      var w = winding(profile, wf), r = profile.maxR;
      plot(svgC, 420, 420, [{ x: w.re, y: w.im, cls: "fl-line fl-line--wind", all: true }], { xr: [-r, r], yr: [-r, r], xl: "Re", yl: "Im", equal: true, marks: [{ x: w.comRe, y: w.comIm }] });
      freqIn.value = wf; freqOut.textContent = wf.toFixed(2);
      comOut.textContent = "(" + w.comRe.toFixed(3) + ", " + w.comIm.toFixed(3) + ")";
      drawSpectrum();
    }

    // stepWinding: the original animation, including the slow-down and pause around peaks
    function step(ts) {
      if (!playing) return;
      if (last === null) last = ts;
      var dt = ts - last; last = ts;
      if (hold > 0) { hold -= dt; drawWinding(); requestAnimationFrame(step); return; }
      var startFactor = wf < 0.1 ? 0.1 + 0.4 * (wf / 0.1) : 1;
      var near = pk.some(function (f) { return Math.abs(f - wf) < 0.1; });
      if (near) {
        var nearest = pk.reduce(function (b, f) { return Math.abs(f - wf) < Math.abs(b - wf) ? f : b; });
        var slow = Math.max(0.05, 0.5 * (Math.abs(nearest - wf) / 0.1));
        wf += dir * (dt / 1000) * 0.2 * slow;
      } else {
        wf += dir * (dt / 1000) * 0.2 * startFactor;
      }
      if (wf >= 10) { wf = 10; dir = -1; held = false; }
      if (wf <= 0) { wf = 0; dir = 1; held = false; }
      var onPeak = pk.some(function (f) { return Math.abs(wf - f) < 0.002; });
      if (onPeak && !held) { hold = 25; held = true; } else if (!near) { held = false; }
      drawWinding();
      requestAnimationFrame(step);
    }

    root.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); run(); });
    var t;
    input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { validate(input.value); }, 250); });
    sumBtn.addEventListener("click", function () {
      isSum = !isSum;
      sumBox.hidden = !isSum;
      sumBtn.setAttribute("aria-pressed", isSum ? "true" : "false");
      sumBtn.textContent = isSum ? "Summation: on" : "Summation: off";
      validate(input.value);
    });
    root.querySelector("[data-act=example]").addEventListener("click", function () {
      var list = isSum ? EXAMPLES.sum : EXAMPLES.regular, ex;
      do { ex = list[Math.floor(Math.random() * list.length)]; } while (ex === lastEx && list.length > 1);
      lastEx = ex; input.value = ex;
      if (isSum) { lower.value = 1; upper.value = 10; }
      run();
    });
    playBtn.addEventListener("click", function () {
      playing = !playing;
      playBtn.textContent = playing ? "Pause" : "Play";
      if (playing) { last = null; requestAnimationFrame(step); }
    });
    freqIn.addEventListener("input", function () {
      playing = false; playBtn.textContent = "Play"; hold = 0; held = false;
      wf = parseFloat(freqIn.value); drawWinding();
    });
    run();
  }

  window.FourierLab = { preprocessInput: preprocessInput, compile: compile, tukey: tukey, plotData: plotData, fftOfFunction: fftOfFunction, fftOfValues: fftOfValues, peaks: peaks, winding: winding };
  function boot() { document.querySelectorAll('[data-fig="fourier-lab"]').forEach(init); }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }
})();
