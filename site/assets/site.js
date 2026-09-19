/* booklens — progressive enhancement only. No network calls.
   Theme toggle, copy-to-clipboard, nav shadow on scroll, mobile nav, and a
   scroll-reveal that is a no-op when JavaScript is unavailable. */
(function () {
  "use strict";

  var STORAGE_KEY = "booklens-theme";

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /* ----- Theme toggle ---------------------------------------------------
     The stored preference is applied before paint by a tiny inline script;
     this wires up the button and follows the system preference until the
     visitor makes an explicit choice. */
  function storedTheme() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveTheme(value) {
    try {
      if (value) {
        window.localStorage.setItem(STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      /* Storage can be blocked; the toggle still works for this session. */
    }
  }

  function systemTheme() {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  }

  function effectiveTheme() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return systemTheme();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    var next = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    toggle.setAttribute("aria-label", "Switch to " + next + " theme");
    toggle.setAttribute("title", "Switch to " + next + " theme");
  }

  function initTheme() {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    applyTheme(effectiveTheme());

    toggle.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      saveTheme(next);
      applyTheme(next);
    });

    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (!storedTheme()) applyTheme(systemTheme());
      };
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", onChange);
      } else if (typeof query.addListener === "function") {
        query.addListener(onChange);
      }
    }
  }

  /* ----- Mobile navigation ----------------------------------------------
     Enhancement only: without JS the nav is always visible. We reveal the
     toggle, mark the header, and let CSS collapse the menu below 860px. */
  function initNav() {
    var header = document.querySelector(".site-header");
    var toggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("primary-nav");
    if (!header || !toggle || !nav) return;

    header.classList.add("is-enhanced");
    toggle.hidden = false;

    function closeNav() {
      nav.classList.remove("is-open");
      header.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    }

    function openNav() {
      nav.classList.add("is-open");
      header.classList.add("nav-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
    }

    toggle.addEventListener("click", function () {
      if (nav.classList.contains("is-open")) {
        closeNav();
      } else {
        openNav();
      }
    });

    nav.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a") : null;
      if (link) closeNav();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeNav();
    });

    if (window.matchMedia) {
      var wide = window.matchMedia("(min-width: 861px)");
      var reset = function () {
        if (wide.matches) closeNav();
      };
      if (typeof wide.addEventListener === "function") {
        wide.addEventListener("change", reset);
      } else if (typeof wide.addListener === "function") {
        wide.addListener(reset);
      }
    }
  }

  /* ----- Nav shadow on scroll ------------------------------------------- */
  function initHeaderShadow() {
    var header = document.querySelector(".site-header");
    if (!header) return;

    var ticking = false;

    function update() {
      ticking = false;
      if (window.scrollY > 8) {
        header.classList.add("header-scrolled");
      } else {
        header.classList.remove("header-scrolled");
      }
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ----- Scroll reveal --------------------------------------------------
     Content is visible by default (no-JS and SSR). We only hide elements
     once we know we can observe them, so nothing can be stranded. */
  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;

    if (
      !("IntersectionObserver" in window) ||
      prefersReducedMotion()
    ) {
      return;
    }

    Array.prototype.forEach.call(items, function (item) {
      item.classList.add("reveal-hidden");
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove("reveal-hidden");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    Array.prototype.forEach.call(items, function (item) {
      observer.observe(item);
    });
  }

  /* ----- Active nav highlight -------------------------------------------
     Marks the nav link matching the current page. The layout does not
     depend on this. */
  function highlightActiveNav() {
    var here = location.pathname.split("/").pop() || "index.html";
    var links = document.querySelectorAll(".nav a[href]");

    Array.prototype.forEach.call(links, function (link) {
      var target = link.getAttribute("href").split("/").pop();
      if (target && target === here) {
        link.setAttribute("aria-current", "page");
      }
    });
  }

  /* ----- Copy-to-clipboard ---------------------------------------------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.appendChild(area);
      area.select();

      try {
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (err) {
        document.body.removeChild(area);
        reject(err);
      }
    });
  }

  function setCopied(button, ok) {
    var label = ok ? "Copied" : "Copy failed";
    button.textContent = label;
    button.setAttribute("data-copied", ok ? "true" : "false");
    button.setAttribute("aria-live", "polite");

    window.clearTimeout(button._resetTimer);
    button._resetTimer = window.setTimeout(function () {
      button.textContent = "Copy";
      button.removeAttribute("data-copied");
    }, 1600);
  }

  function wireCopyButton(button, getText) {
    button.addEventListener("click", function () {
      copyText(getText()).then(
        function () {
          setCopied(button, true);
        },
        function () {
          setCopied(button, false);
        }
      );
    });
  }

  function enhanceCodeBlocks() {
    var blocks = document.querySelectorAll("pre.code");

    Array.prototype.forEach.call(blocks, function (pre) {
      var code = pre.querySelector("code") || pre;
      var text = code.textContent;

      var button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code to clipboard");
      wireCopyButton(button, function () {
        return text;
      });

      if (getComputedStyle(pre).position === "static") {
        pre.style.position = "relative";
      }
      pre.appendChild(button);
    });
  }

  function enhanceInstallChip() {
    var button = document.getElementById("install-copy");
    if (!button) return;
    var code = button.parentNode.querySelector(".install-code");
    var text = code ? code.textContent : "";
    button.setAttribute("aria-label", "Copy install command to clipboard");
    wireCopyButton(button, function () {
      return text;
    });
  }

  function canCopy() {
    if (navigator.clipboard && window.isSecureContext) {
      return true;
    }
    return (
      typeof document.queryCommandSupported === "function" &&
      document.queryCommandSupported("copy")
    );
  }

  /* ----- Offline sample EPUB --------------------------------------------
     Build a tiny, deliberately inaccessible book in memory with the same
     library the CLI uses. No fixture is fetched, so the playground keeps
     its "no network request" promise. Exposed for the page's inline wiring
     to call on the "Try a sample book" button. */
  function buildSampleEpub() {
    if (
      typeof BookLens === "undefined" ||
      typeof BookLens.buildEpub !== "function"
    ) {
      return null;
    }

    var container =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
      "</container>";
    var opf =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:identifier id="pub-id">sample-booklens</dc:identifier>' +
      "</metadata>" +
      '<manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
      '<spine><itemref idref="ch1"/></spine></package>';
    var chapter =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>A sample book</title></head>' +
      "<body><h1>Chapter one</h1>" +
      "<p>This book ships without a language, a title, or any accessibility metadata.</p>" +
      '<img src="cover.png">' +
      "</body></html>";

    return BookLens.buildEpub([
      { path: "META-INF/container.xml", data: container },
      { path: "OEBPS/content.opf", data: opf },
      { path: "OEBPS/ch1.xhtml", data: chapter },
    ]);
  }

  window.booklensBuildSample = buildSampleEpub;

  function init() {
    initTheme();
    initNav();
    initHeaderShadow();
    initReveal();
    highlightActiveNav();

    if (canCopy()) {
      enhanceCodeBlocks();
      enhanceInstallChip();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
