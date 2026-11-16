/*
 * GameSense force footprints — the force_footprints.html viewer (three.js r128) adapted to run inside the page.
 * Plays back three of the simulator's demo kicks on the cleat: every detected sensor point paints a footprint on the
 * surface whose radius is its force divided by that sensor's own peak (the original's sizing rule), with a synced
 * sensor-grid map and force-time chart. Data: assets/data/gamesense-kicks.js; mesh: assets/data/gamesense-cleat.js
 * (public-domain model, simplified per part).
 */
(function () {
  "use strict";
  var MAX_FORCE_RADIUS = 4.5;   // footprint radius (scene units) at a sensor's own peak force
  var PLAYBACK_SECONDS = 3;     // wall-clock seconds for the whole kick at 1x (original value)
  var GRID = { nx: 12, ny: 16 }; // config.py NUM_X_LINES / NUM_Y_LINES
  // Black-and-white finish. The model's outer skin is a set of panels (OBJ materials 02-05, 08); a full shell
  // (Line094) sits just beneath them and only shows through the stripe cut-outs, and Shape028 lines the inside.
  var WHITE = 0xd9d7d2, BLACK = 0x1d1e21, STUD = 0x2e3034, LINING = 0x26272a;
  var SKIN = { "02___Default": 1, "03___Default": 1, "04___Default": 1, "05___Default": 1, "08___Default": 1 };
  function partLook(g) {
    if (SKIN[g.mat]) return { color: WHITE, roughness: 0.55 };
    if (g.part === "Line094") return { color: BLACK, roughness: 0.5, offset: 2 };   // under-shell: pushed back
    if (g.mat === "12___Default") return { color: LINING, roughness: 0.8, offset: 4 };
    if (g.mat === "11___Default") return { color: STUD, roughness: 0.45 };
    return { color: BLACK, roughness: g.mat === "07___Default" ? 0.5 : 0.7 };    // laces, tongue, collar, sole
  }
  var FOOT = 0xb66a4a, RING = 0x9a5236, DOT = 0x111214;

  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); }; document.head.appendChild(s); });
  }
  function b64(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

  /** getInterpolatedForce from the original: linear interpolation, 0 outside the data. */
  function forceAt(times, values, t) {
    var n = times.length;
    if (!n || !(t >= times[0]) || t > times[n - 1]) return 0;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
    var span = times[hi] - times[lo];
    var f = span > 0 ? values[lo] + ((values[hi] - values[lo]) * (t - times[lo])) / span : values[lo];
    return isFinite(f) ? Math.max(0, f) : 0;
  }

  function init(root) {
    var base = root.getAttribute("data-base") || "";
    var stage = root.querySelector(".gs__stage"), status = root.querySelector("[data-out=status]");
    var started = false;
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function start() {
      if (started) return; started = true;
      status.textContent = "Loading the cleat…";
      var need = [];
      if (!window.THREE) need.push(base + "assets/vendor/three-r128.min.js");
      if (!window.GS_CLEAT) need.push(base + "assets/data/gamesense-cleat.js");
      if (!window.GS_KICKS) need.push(base + "assets/data/gamesense-kicks.js");
      need.reduce(function (p, s) { return p.then(function () { return loadScript(s); }); }, Promise.resolve())
        .then(function () { build(); status.textContent = ""; root.classList.add("is-ready"); })
        .catch(function (e) { status.textContent = e.message + "."; });
    }

    function build() {
      var THREE = window.THREE, DATA = window.GS_KICKS;
      var renderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
      catch (e) { status.textContent = "This browser could not start WebGL, so the 3D view is unavailable."; return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0); // the stage background (light or dark theme) shows through
      stage.appendChild(renderer.domElement);
      var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
      scene.add(new THREE.AmbientLight(0xffffff, 0.16));
      scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2c30, 0.5)); // sky/ground fill gives the shoe its form
      var sun = new THREE.DirectionalLight(0xffffff, 0.62); scene.add(sun, sun.target);   // key light, above and beside the camera
      var rim = new THREE.DirectionalLight(0xdfe8f5, 0.45); scene.add(rim, rim.target);   // back light: keeps the black sole's outline on a dark page

      // ---- cleat mesh (quantized positions → BufferGeometry, one draw group per model part)
      var C = window.GS_CLEAT, q = new Uint16Array(b64(C.pos)), pos = new Float32Array(q.length);
      for (var i = 0; i < q.length; i++) pos[i] = C.vmin[i % 3] + q[i] * C.vscale[i % 3];
      var index = C.index32 ? new Uint32Array(b64(C.index)) : new Uint16Array(b64(C.index));
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeVertexNormals();
      // footprints are drawn per pixel in every part's shader: a disc where the sensor's force sphere meets the surface,
      // with a thin outline, so nothing pokes through or floats off the shoe
      var NS_MAX = 8, uS = [], uK = [];
      for (var u = 0; u < NS_MAX; u++) { uS.push(new THREE.Vector4(0, 0, 0, 0)); uK.push(0); }
      var U = { uHeat: { value: new THREE.Color(FOOT) }, uRing: { value: new THREE.Color(RING) }, uS: { value: uS }, uK: { value: uK } };
      function withHeat(sh) {
        sh.uniforms.uHeat = U.uHeat; sh.uniforms.uRing = U.uRing; sh.uniforms.uS = U.uS; sh.uniforms.uK = U.uK;
        sh.vertexShader = "varying vec3 vGsPos;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vGsPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        sh.fragmentShader = "uniform vec3 uHeat;\nuniform vec3 uRing;\nuniform vec4 uS[" + NS_MAX + "];\nuniform float uK[" + NS_MAX + "];\nvarying vec3 vGsPos;\n" + sh.fragmentShader
          .replace("#include <color_fragment>", [
            "#include <color_fragment>",
            "  float gsH = 0.0, gsR = 0.0;",
            "  for (int i = 0; i < " + NS_MAX + "; i++) {",
            "    float r = uS[i].w; if (r <= 0.0) continue;",
            "    float d = distance(vGsPos, uS[i].xyz);",
            "    gsH = max(gsH, uK[i] * (1.0 - smoothstep(r * 0.5, r, d)));",
            "    gsR = max(gsR, 1.0 - smoothstep(0.0, 0.07, abs(d - r)));",
            "  }",
            "  diffuseColor.rgb = mix(diffuseColor.rgb, uHeat, gsH);",
            "  diffuseColor.rgb = mix(diffuseColor.rgb, uRing, gsR * 0.85);"].join("\n"))
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += uHeat * gsH * 0.2;");
      }
      var mats = C.groups.map(function (g, k) {
        geo.addGroup(g.start, g.count, k);
        var c = partLook(g);
        var m = new THREE.MeshStandardMaterial({ color: c.color, roughness: c.roughness, metalness: 0, side: THREE.DoubleSide });
        if (c.offset) { m.polygonOffset = true; m.polygonOffsetFactor = c.offset; m.polygonOffsetUnits = c.offset * 2; } // coplanar layers: the outer skin always wins
        m.onBeforeCompile = withHeat;
        return m;
      });
      var cleat = new THREE.Mesh(geo, mats); scene.add(cleat);

      // ---- orbit camera (original parameters, framed on the model)
      geo.computeBoundingBox();
      var box = geo.boundingBox, diag = box.getSize(new THREE.Vector3()).length();
      var orbit = { target: box.getCenter(new THREE.Vector3()), dist: diag * 1.5, az: THREE.MathUtils.degToRad(-70), el: THREE.MathUtils.degToRad(12), min: diag * 0.25, max: diag * 3 };
      // aim at the instrumented side of the cleat rather than the whole bounding box
      var sensorCentre = new THREE.Vector3(), nPos = 0;
      Object.keys(DATA.positions).forEach(function (k) { var p = DATA.positions[k]; sensorCentre.add(new THREE.Vector3(p.x, p.y, p.z)); nPos++; });
      sensorCentre.divideScalar(nPos);
      orbit.target.lerp(sensorCentre, 0.6); orbit.dist = diag * 0.95;
      camera.near = diag / 1000; camera.far = diag * 20;
      function applyOrbit() {
        var o = orbit;
        camera.position.set(o.target.x + o.dist * Math.sin(o.az) * Math.cos(o.el), o.target.y + o.dist * Math.sin(o.el), o.target.z + o.dist * Math.cos(o.az) * Math.cos(o.el));
        camera.lookAt(o.target); camera.updateMatrixWorld();
      }
      function resize() {
        var w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      }
      if ("ResizeObserver" in window) new ResizeObserver(resize).observe(stage); else window.addEventListener("resize", resize);
      resize();

      // pointer: drag to rotate, pinch or wheel (once the view is active) to zoom
      var el = renderer.domElement, pointers = {}, lastPinch = 0, active = false;
      el.setAttribute("tabindex", "0"); el.setAttribute("aria-label", "3D cleat view: drag to rotate");
      el.addEventListener("pointerdown", function (e) { pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); active = true; root.classList.add("is-active"); });
      el.addEventListener("pointerup", function (e) { delete pointers[e.pointerId]; lastPinch = 0; });
      el.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; lastPinch = 0; });
      el.addEventListener("pointermove", function (e) {
        var ids = Object.keys(pointers);
        if (ids.length === 1 && pointers[e.pointerId]) {
          var p = pointers[e.pointerId];
          orbit.az -= (e.clientX - p.x) * 0.006;
          orbit.el = Math.max(-1.45, Math.min(1.45, orbit.el + (e.clientY - p.y) * 0.006));
          p.x = e.clientX; p.y = e.clientY;
        } else if (ids.length === 2 && pointers[e.pointerId]) {
          pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
          var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (lastPinch) orbit.dist = Math.max(orbit.min, Math.min(orbit.max, orbit.dist * (lastPinch / d)));
          lastPinch = d;
        }
        var r = el.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      });
      el.addEventListener("pointerleave", function () { mouse.x = mouse.y = -1e9; });
      el.addEventListener("wheel", function (e) {
        if (!active) return; // never hijack page scrolling until the visitor has interacted with the view
        e.preventDefault();
        orbit.dist = Math.max(orbit.min, Math.min(orbit.max, orbit.dist * Math.exp(e.deltaY * 0.001)));
      }, { passive: false });
      document.addEventListener("pointerdown", function (e) { if (!root.contains(e.target)) { active = false; root.classList.remove("is-active"); } });
      root.querySelector("[data-act=zoom-in]").addEventListener("click", function () { orbit.dist = Math.max(orbit.min, orbit.dist / 1.2); });
      root.querySelector("[data-act=zoom-out]").addEventListener("click", function () { orbit.dist = Math.min(orbit.max, orbit.dist * 1.2); });

      // ---- footprints: each sensor paints a disc on the surface (radius and strength follow its force / own peak)
      var group = new THREE.Group(); scene.add(group);
      var sensors = [], data = null, tEnd = 0, tMs = 0, playing = false, last = performance.now();
      var dotGeo = new THREE.SphereGeometry(Math.max(0.12, diag * 0.0028), 12, 8), dotMat = new THREE.MeshBasicMaterial({ color: DOT });
      function clear() {
        sensors.forEach(function (s) { group.remove(s.dot); });
        sensors = [];
      }
      function loadKick(name) {
        clear();
        var k = DATA.kicks[name];
        data = { times: k.t_ms, labels: k.labels };
        tEnd = k.t_ms[k.t_ms.length - 1];
        k.labels.forEach(function (label, i) {
          var p = DATA.positions[label]; if (!p) return;
          var posV = new THREE.Vector3(p.x, p.y, p.z), normal = new THREE.Vector3(p.nx, p.ny, p.nz);
          var dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.copy(posV).addScaledVector(normal, Math.max(0.05, diag * 0.002));
          group.add(dot);
          var values = k.cols[i], peak = 0; values.forEach(function (x) { if (x > peak) peak = x; });
          sensors.push({ label: label, pos: posV, normal: normal, values: values, peak: peak, dot: dot, force: 0, n: 0 });
        });
        root.querySelectorAll("[data-kick]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-kick") === name ? "true" : "false"); });
        drawGrid(); drawChart();
        tMs = 0; setPlaying(!reduced);
      }
      function paint() {
        for (var u = 0; u < NS_MAX; u++) {
          var sn = sensors[u], r = sn ? sn.n * MAX_FORCE_RADIUS : 0;
          if (r < 0.05) { uS[u].w = 0; uK[u] = 0; continue; }
          uS[u].set(sn.pos.x, sn.pos.y, sn.pos.z, r); uK[u] = 0.55 + 0.4 * sn.n;
        }
      }

      // ---- side panels: sensor grid map + force-time chart
      var NS = "http://www.w3.org/2000/svg", gridSvg = root.querySelector("[data-plot=grid]"), chartSvg = root.querySelector("[data-plot=chart]");
      function svg(tag, attrs, parent) { var n = document.createElementNS(NS, tag); for (var a in attrs) n.setAttribute(a, attrs[a]); if (parent) parent.appendChild(n); return n; }
      var gridDots = [], chartCursor = null;
      function lab(l) { var m = /X(\d+)Y(\d+)/.exec(l); return { x: +m[1], y: +m[2] }; }
      function drawGrid() {
        while (gridSvg.firstChild) gridSvg.removeChild(gridSvg.firstChild);
        var W = 220, H = 280, m = 22, sx = (W - 2 * m) / (GRID.nx - 1), sy = (H - 2 * m) / (GRID.ny - 1);
        var X = function (i) { return m + (i - 1) * sx; }, Y = function (j) { return H - m - (j - 1) * sy; };
        for (var i = 1; i <= GRID.nx; i++) svg("line", { x1: X(i), x2: X(i), y1: Y(1), y2: Y(GRID.ny), class: "gs-line gs-line--x" }, gridSvg);
        for (var j = 1; j <= GRID.ny; j++) svg("line", { x1: X(1), x2: X(GRID.nx), y1: Y(j), y2: Y(j), class: "gs-line gs-line--y" }, gridSvg);
        svg("text", { x: X(1), y: H - 4, class: "plot-text" }, gridSvg).textContent = "X1";
        svg("text", { x: X(GRID.nx), y: H - 4, class: "plot-text", "text-anchor": "end" }, gridSvg).textContent = "X" + GRID.nx;
        svg("text", { x: 2, y: Y(1) + 4, class: "plot-text" }, gridSvg).textContent = "Y1";
        svg("text", { x: 2, y: Y(GRID.ny) + 4, class: "plot-text" }, gridSvg).textContent = "Y" + GRID.ny;
        var pts = sensors.map(function (s) { var g = lab(s.label); return [X(g.x), Y(g.y)]; });
        if (pts.length > 1) svg("path", { d: "M" + pts.map(function (p) { return p.join(","); }).join("L"), class: "gs-path" }, gridSvg);
        gridDots = sensors.map(function (s, k) {
          var c = svg("circle", { cx: pts[k][0], cy: pts[k][1], r: 3, class: "gs-dot" }, gridSvg);
          var t = svg("text", { x: pts[k][0] + 7, y: pts[k][1] - 6, class: "plot-text gs-dot-label" }, gridSvg); t.textContent = s.label;
          return c;
        });
      }
      function drawChart() {
        while (chartSvg.firstChild) chartSvg.removeChild(chartSvg.firstChild);
        var W = 300, H = 170, m = { l: 34, r: 8, t: 8, b: 24 }, pw = W - m.l - m.r, ph = H - m.t - m.b, fmax = 0;
        sensors.forEach(function (s) { fmax = Math.max(fmax, s.peak); });
        fmax = Math.ceil(fmax / 200) * 200 || 200;
        var X = function (t) { return m.l + (t / tEnd) * pw; }, Y = function (f) { return m.t + ph - (f / fmax) * ph; };
        for (var f = 0; f <= fmax; f += fmax / 4) { svg("line", { x1: m.l, x2: m.l + pw, y1: Y(f), y2: Y(f), class: "gs-grid" }, chartSvg); svg("text", { x: m.l - 4, y: Y(f) + 3, "text-anchor": "end", class: "plot-text" }, chartSvg).textContent = Math.round(f); }
        svg("text", { x: m.l, y: H - 4, class: "plot-text" }, chartSvg).textContent = "0 ms";
        svg("text", { x: m.l + pw, y: H - 4, class: "plot-text", "text-anchor": "end" }, chartSvg).textContent = tEnd.toFixed(1) + " ms";
        svg("text", { x: m.l + pw / 2, y: H - 4, class: "plot-text", "text-anchor": "middle" }, chartSvg).textContent = "force (N) vs time";
        sensors.forEach(function (s, k) {
          var d = ""; for (var i = 0; i < data.times.length; i++) d += (i ? "L" : "M") + X(data.times[i]).toFixed(1) + "," + Y(s.values[i]).toFixed(1);
          svg("path", { d: d, class: "gs-trace", style: "--k:" + (k / Math.max(1, sensors.length - 1)) }, chartSvg);
        });
        chartCursor = svg("line", { x1: m.l, x2: m.l, y1: m.t, y2: m.t + ph, class: "gs-cursor" }, chartSvg);
        chartCursor._x = X;
      }

      // ---- tooltip
      var mouse = { x: -1e9, y: -1e9 }, tip = root.querySelector(".gs__tip"), tmp = new THREE.Vector3(), camDir = new THREE.Vector3(), side = new THREE.Vector3();
      function updateTip() {
        var best = null, bestD = 40, w = stage.clientWidth, h = stage.clientHeight;
        sensors.forEach(function (s) {
          if (camDir.copy(camera.position).sub(s.pos).dot(s.normal) < 0) return; // facing away from the viewer
          tmp.copy(s.pos).project(camera);
          if (tmp.z >= 1) return;
          var sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h, d = Math.hypot(sx - mouse.x, sy - mouse.y);
          if (d < bestD) { best = s; bestD = d; }
        });
        if (!best) { tip.hidden = true; return; }
        tip.hidden = false;
        tip.style.left = Math.min(mouse.x + 16, w - 180) + "px"; tip.style.top = Math.max(8, mouse.y - 60) + "px";
        tip.innerHTML = "Sensor <b>" + best.label + "</b><br>Force " + best.force.toFixed(0) + " N<br>Peak " + best.peak.toFixed(0) + " N<br>" + tMs.toFixed(1) + " ms";
      }

      // ---- timeline
      var playBtn = root.querySelector("[data-act=play]"), scrub = root.querySelector("[name=scrub]"), timeOut = root.querySelector("[data-out=time]"), speed = root.querySelector("[name=speed]");
      function setPlaying(p) { playing = p; playBtn.textContent = p ? "Pause" : "Play"; }
      function seek(t) { tMs = Math.max(0, Math.min(tEnd, t)); }
      playBtn.addEventListener("click", function () { if (!playing && tMs >= tEnd) seek(0); setPlaying(!playing); });
      root.querySelector("[data-act=reset]").addEventListener("click", function () { setPlaying(false); seek(0); });
      scrub.addEventListener("input", function () { setPlaying(false); seek((scrub.value / 1000) * tEnd); });
      root.querySelectorAll("[data-kick]").forEach(function (b) { b.addEventListener("click", function () { loadKick(b.getAttribute("data-kick")); }); });

      var visible = true;
      if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(root);
      function frame(now) {
        var dt = (now - last) / 1000; last = now;
        if (visible) {
          if (playing && tEnd > 0) { seek(tMs + dt * (tEnd / PLAYBACK_SECONDS) * parseFloat(speed.value)); if (tMs >= tEnd) setPlaying(false); }
          applyOrbit();
          camDir.copy(camera.position).sub(orbit.target);
          sun.position.copy(orbit.target).add(camDir).addScaledVector(camera.up, orbit.dist * 0.5).addScaledVector(side.crossVectors(camDir, camera.up).normalize(), -orbit.dist * 0.35);
          rim.position.copy(orbit.target).sub(camDir).addScaledVector(camera.up, orbit.dist * 0.8);
          sun.target.position.copy(orbit.target); sun.target.updateMatrixWorld(); rim.target.position.copy(orbit.target); rim.target.updateMatrixWorld();
          sensors.forEach(function (s, k) {
            var f = forceAt(data.times, s.values, tMs), n = s.peak > 0 ? Math.min(1, Math.max(0, f / s.peak)) : 0;
            s.force = f; s.n = n;
            if (gridDots[k]) { gridDots[k].setAttribute("r", (3 + 9 * n).toFixed(1)); gridDots[k].classList.toggle("is-on", n > 0.02); }
          });
          paint();
          if (chartCursor) { var cx = chartCursor._x(tMs); chartCursor.setAttribute("x1", cx); chartCursor.setAttribute("x2", cx); }
          scrub.value = tEnd ? Math.round((tMs / tEnd) * 1000) : 0;
          timeOut.textContent = tMs.toFixed(1) + " / " + tEnd.toFixed(1) + " ms";
          updateTip();
          renderer.render(scene, camera);
        }
        requestAnimationFrame(frame);
      }
      loadKick("curved");
      requestAnimationFrame(frame);
    }

    root.querySelector("[data-act=load]").addEventListener("click", start);
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: "400px 0px" });
      io.observe(root);
    }
  }

  window.GameSenseViewer = { forceAt: forceAt };
  function boot() { document.querySelectorAll("[data-fig=gamesense]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
