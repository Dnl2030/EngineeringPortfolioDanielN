/*
 * GameSense force footprints — the force_footprints.html viewer (three.js r128) adapted to run inside the page.
 * Plays back the simulator's four demo kicks on the cleat: every detected sensor point grows a footprint whose
 * radius is its force divided by that sensor's own peak (as in the original), with a synced sensor-grid map and
 * force-time chart. Data: assets/data/gamesense-kicks.js; mesh: assets/data/gamesense-cleat.js (public domain model).
 */
(function () {
  "use strict";
  var MAX_FORCE_RADIUS = 6.0;   // scene units at a sensor's own peak force (original value)
  var PLAYBACK_SECONDS = 3;     // wall-clock seconds for the whole kick at 1x (original value)
  var GRID = { nx: 12, ny: 16 }; // config.py NUM_X_LINES / NUM_Y_LINES
  var LIGHT_GREY = 0x7ea0ab, DARK_GREY = 0x4a4a55;
  var CLEAT_MATERIALS = { // original colour assignments by OBJ material name
    "02___Default": { color: LIGHT_GREY, roughness: 0.6 }, "03___Default": { color: LIGHT_GREY, roughness: 0.6 },
    "04___Default": { color: LIGHT_GREY, roughness: 0.6 }, "05___Default": { color: LIGHT_GREY, roughness: 0.6 },
    "07___Default": { color: DARK_GREY, roughness: 0.6 }, "08___Default": { color: LIGHT_GREY, roughness: 0.6 },
    "09___Default": { color: DARK_GREY, roughness: 0.9 }, "10___Default": { color: DARK_GREY, roughness: 0.9 },
    "11___Default": { color: 0x2b2b33, roughness: 0.6, metalness: 0.1 }, "12___Default": { color: 0xe6e6e6, roughness: 0.6, metalness: 0.1 }
  };
  var FOOT = 0xb66a4a, FOOT_EMISSIVE = 0x3a1608;

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
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
      catch (e) { status.textContent = "This browser could not start WebGL, so the 3D view is unavailable."; return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x111214, 1);
      stage.appendChild(renderer.domElement);
      var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
      scene.add(new THREE.AmbientLight(0xffffff, 0.38));
      scene.add(new THREE.HemisphereLight(0xf5f3ee, 0x26292d, 0.45)); // sky/ground fill gives the shoe its form
      var sun = new THREE.DirectionalLight(0xffffff, 0.7); scene.add(sun, sun.target);

      // ---- cleat mesh (quantized positions → BufferGeometry, one draw group per OBJ material)
      var C = window.GS_CLEAT, q = new Uint16Array(b64(C.pos)), pos = new Float32Array(q.length);
      for (var i = 0; i < q.length; i++) pos[i] = C.vmin[i % 3] + q[i] * C.vscale[i % 3];
      var index = C.index32 ? new Uint32Array(b64(C.index)) : new Uint16Array(b64(C.index));
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeVertexNormals();
      var mats = C.groups.map(function (g, k) {
        geo.addGroup(g.start, g.count, k);
        var c = Object.assign({ color: 0x8a8a99, roughness: 0.85, metalness: 0 }, CLEAT_MATERIALS[g.mat] || {});
        return new THREE.MeshStandardMaterial({ color: c.color, roughness: c.roughness, metalness: c.metalness, side: THREE.DoubleSide });
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
        var w = stage.clientWidth, h = stage.clientHeight;
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      }
      window.addEventListener("resize", resize); resize();

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

      // ---- footprints
      var group = new THREE.Group(); scene.add(group);
      var sensors = [], data = null, tEnd = 0, tMs = 0, playing = false, last = performance.now();
      var sphereGeo = new THREE.SphereGeometry(1, 32, 24);
      function clear() {
        sensors.forEach(function (s) { group.remove(s.sphere, s.dot); s.sphere.material.dispose(); s.dot.geometry.dispose(); s.dot.material.dispose(); });
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
          var sphere = new THREE.Mesh(sphereGeo, new THREE.MeshPhongMaterial({ color: FOOT, emissive: FOOT_EMISSIVE, shininess: 30, transparent: true, opacity: 0.5, depthWrite: false }));
          sphere.renderOrder = 10; sphere.position.copy(posV);
          var dot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([posV]), new THREE.PointsMaterial({ color: 0xf5f3ee, size: 5, sizeAttenuation: false }));
          dot.position.copy(normal).multiplyScalar(Math.max(0.03, diag * 0.002) * 1.5);
          group.add(sphere, dot);
          var values = k.cols[i], peak = 0; values.forEach(function (v) { if (v > peak) peak = v; });
          sensors.push({ label: label, pos: posV, values: values, peak: peak, sphere: sphere, dot: dot, force: 0, order: i });
        });
        root.querySelectorAll("[data-kick]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-kick") === name ? "true" : "false"); });
        drawGrid(); drawChart();
        tMs = 0; setPlaying(!reduced);
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
      var mouse = { x: -1e9, y: -1e9 }, tip = root.querySelector(".gs__tip"), tmp = new THREE.Vector3();
      function updateTip() {
        var best = null, bestD = 40, w = stage.clientWidth, h = stage.clientHeight;
        sensors.forEach(function (s) {
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
          sun.position.copy(camera.position); sun.target.position.copy(orbit.target); sun.target.updateMatrixWorld();
          sensors.forEach(function (s, k) {
            var f = forceAt(data.times, s.values, tMs), n = s.peak > 0 ? Math.min(1, Math.max(0, f / s.peak)) : 0, r = n * MAX_FORCE_RADIUS;
            s.force = f;
            s.sphere.visible = r > MAX_FORCE_RADIUS * 0.004;
            if (s.sphere.visible) { s.sphere.scale.setScalar(r); s.sphere.material.opacity = 0.28 + 0.5 * n; }
            if (gridDots[k]) { gridDots[k].setAttribute("r", (3 + 9 * n).toFixed(1)); gridDots[k].classList.toggle("is-on", n > 0.02); }
          });
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
