/*
 * Site behaviour: line drawing + reveals, ambient video loops, mobile navigation,
 * image lightbox, project index filtering, FSAE process rail. No dependencies.
 */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var root = document.documentElement;
  if (!reduced.matches && "IntersectionObserver" in window) root.classList.add("motion");

  /* ---- Lines draw / content settles once, when scrolled into view ---- */
  if ("IntersectionObserver" in window) {
    var once = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        once.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.2 });
    document.querySelectorAll("[data-draw], [data-reveal]").forEach(function (el) { once.observe(el); });

    /* ---- Ambient loops play only while visible (never with reduced motion) ---- */
    var play = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var v = entry.target;
        if (entry.isIntersecting && !reduced.matches) {
          if (v.preload === "none") v.preload = "auto";
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.2 });
    document.querySelectorAll("video[data-autoplay]").forEach(function (v) { play.observe(v); });
  }

  /* ---- Mobile navigation ---- */
  var toggle = document.querySelector(".nav__toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Close" : "Menu";
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "Menu"; }
    });
  }

  /* ---- Lightbox for figures marked data-zoom ---- */
  var zoomables = document.querySelectorAll("img[data-zoom]");
  if (zoomables.length && typeof HTMLDialogElement === "function") {
    var dlg = document.createElement("dialog");
    dlg.className = "lightbox";
    dlg.setAttribute("aria-label", "Enlarged figure");
    dlg.innerHTML = '<button class="lightbox__close" type="button">Close</button><img alt=""><p class="lightbox__cap"></p>';
    document.body.appendChild(dlg);
    var big = dlg.querySelector("img");
    var cap = dlg.querySelector(".lightbox__cap");
    dlg.querySelector(".lightbox__close").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    zoomables.forEach(function (im) {
      im.classList.add("zoomable");
      im.setAttribute("tabindex", "0");
      im.setAttribute("role", "button");
      var open = function () {
        big.src = im.getAttribute("data-zoom");
        big.alt = im.alt;
        var fig = im.closest("figure");
        var fc = fig && fig.querySelector("figcaption");
        cap.textContent = fc ? fc.textContent.replace(/\s+/g, " ").trim() : im.alt;
        dlg.showModal();
      };
      im.addEventListener("click", open);
      im.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  /* ---- Project index: discipline filter + hover thumbnail ---- */
  var register = document.querySelector("[data-register]");
  if (register) {
    var rows = register.querySelectorAll("tbody tr");
    var chips = document.querySelectorAll("[data-filter]");
    var count = document.querySelector("[data-register-count]");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var f = chip.getAttribute("data-filter");
        chips.forEach(function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
        var shown = 0;
        rows.forEach(function (r) {
          var on = f === "all" || (r.getAttribute("data-disc") || "").split(" ").indexOf(f) > -1;
          r.classList.toggle("is-hidden", !on);
          if (on) shown++;
        });
        if (count) count.textContent = shown + (shown === 1 ? " project" : " projects");
      });
    });
    var thumb = document.createElement("img");
    thumb.className = "register__thumb";
    thumb.alt = "";
    document.body.appendChild(thumb);
    var fine = window.matchMedia("(hover: hover) and (min-width: 821px)");
    rows.forEach(function (r) {
      var src = r.getAttribute("data-thumb");
      if (!src) return;
      r.addEventListener("mouseenter", function () { if (!fine.matches) return; thumb.src = src; thumb.classList.add("is-on"); });
      r.addEventListener("mouseleave", function () { thumb.classList.remove("is-on"); });
      r.addEventListener("mousemove", function (e) {
        var x = Math.min(window.innerWidth - 290, e.clientX + 28);
        var y = Math.min(window.innerHeight - 220, Math.max(70, e.clientY - 90));
        thumb.style.left = x + "px";
        thumb.style.top = y + "px";
      });
    });
  }

  /* ---- Process rail (FSAE): active stage + progress line ---- */
  var rail = document.querySelector("[data-rail]");
  if (rail) {
    var links = Array.prototype.slice.call(rail.querySelectorAll("a[href^='#']"));
    var stages = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var fill = rail.querySelector(".rail__fill");
    var ticking = false;
    var update = function () {
      ticking = false;
      var mid = window.innerHeight * 0.35;
      var active = 0;
      stages.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < mid) active = i; });
      links.forEach(function (a, i) {
        var li = a.parentElement;
        li.classList.toggle("is-active", i === active);
        li.classList.toggle("is-done", i < active);
        if (i === active) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current");
      });
      var first = stages[0], last = stages[stages.length - 1];
      if (first && last && fill) {
        var top = first.getBoundingClientRect().top;
        var end = last.getBoundingClientRect().bottom;
        var p = Math.min(1, Math.max(0, (mid - top) / (end - top)));
        fill.style.setProperty("--progress", p.toFixed(3));
      }
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
})();
