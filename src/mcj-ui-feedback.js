/**
 * Unified click feedback + light page transitions.
 * - Buttons with data-mcj-busy or [data-action-loading] get immediate pressed/busy state
 * - Network buttons: call MCJUiFeedback.wrap(btn, promise)
 */
(function (root) {
  "use strict";
  if (root.MCJUiFeedback) return;

  function setBusy(el, busy, label) {
    if (!el) return;
    if (busy) {
      if (!el.getAttribute("data-mcj-busy-label")) {
        el.setAttribute("data-mcj-busy-label", el.textContent || "");
      }
      el.classList.add("is-busy", "is-pressed");
      el.setAttribute("aria-busy", "true");
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
        el.disabled = true;
      }
      if (label) el.textContent = label;
    } else {
      var prev = el.getAttribute("data-mcj-busy-label");
      el.classList.remove("is-busy", "is-pressed");
      el.removeAttribute("aria-busy");
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
        el.disabled = false;
      }
      if (prev != null) {
        el.textContent = prev;
        el.removeAttribute("data-mcj-busy-label");
      }
    }
  }

  function wrap(el, promise, opts) {
    opts = opts || {};
    setBusy(el, true, opts.label || "处理中…");
    return Promise.resolve(promise)
      .then(function (v) {
        setBusy(el, false);
        return v;
      })
      .catch(function (err) {
        setBusy(el, false);
        throw err;
      });
  }

  function markNavClick(e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href],button,[data-nav]") : null;
    if (!a) return;
    a.classList.add("is-pressed");
    setTimeout(function () {
      a.classList.remove("is-pressed");
    }, 280);
  }

  document.addEventListener("pointerdown", markNavClick, { passive: true });
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-mcj-busy-auto]") : null;
    if (!btn || btn.classList.contains("is-busy")) return;
    setBusy(btn, true, btn.getAttribute("data-mcj-busy-label-active") || "处理中…");
  }, true);

  // Light enter transition without breaking fixed tab bars (transform-free).
  try {
    document.documentElement.classList.add("mcj-perf-ready");
    requestAnimationFrame(function () {
      document.body.classList.add("mcj-page-ready");
    });
  } catch (e) {}

  root.MCJUiFeedback = {
    setBusy: setBusy,
    wrap: wrap,
  };
})(typeof window !== "undefined" ? window : globalThis);
