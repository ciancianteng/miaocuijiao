/**
 * Shared Admin Overlay — desktop: right drawer; mobile: centered modal.
 * One interaction model for 更多 / 编辑 / 审核 / 设置.
 */
(function () {
  "use strict";

  var root = null;
  var bodyEl = null;
  var titleEl = null;
  var onCloseCb = null;
  var lastFocus = null;

  function ensure() {
    if (root) return root;
    root = document.getElementById("adminOverlay");
    if (!root) {
      root = document.createElement("div");
      root.id = "adminOverlay";
      root.className = "admin-overlay";
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      root.innerHTML =
        '<div class="admin-overlay-backdrop" data-admin-overlay-close></div>' +
        '<aside class="admin-overlay-panel" role="dialog" aria-modal="true" aria-labelledby="adminOverlayTitle">' +
        '<header class="admin-overlay-head">' +
        '<div class="admin-overlay-title" id="adminOverlayTitle" data-admin-overlay-title></div>' +
        '<button type="button" class="admin-overlay-close" data-admin-overlay-close aria-label="关闭">×</button>' +
        "</header>" +
        '<div class="admin-overlay-body" data-admin-overlay-body></div>' +
        "</aside>";
      document.body.appendChild(root);
    }
    bodyEl = root.querySelector("[data-admin-overlay-body]");
    titleEl = root.querySelector("[data-admin-overlay-title]");
    if (!root.dataset.bound) {
      root.dataset.bound = "1";
      root.addEventListener("click", function (e) {
        if (e.target.closest("[data-admin-overlay-close]")) close();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isOpen()) close();
      });
    }
    return root;
  }

  function isOpen() {
    return !!(root && !root.hidden && root.classList.contains("is-open"));
  }

  function open(opts) {
    opts = opts || {};
    ensure();
    lastFocus = document.activeElement;
    onCloseCb = typeof opts.onClose === "function" ? opts.onClose : null;
    if (titleEl) titleEl.textContent = opts.title || "";
    if (bodyEl) {
      if (opts.html != null) bodyEl.innerHTML = opts.html;
      else if (opts.node) {
        bodyEl.innerHTML = "";
        bodyEl.appendChild(opts.node);
      }
    }
    root.hidden = false;
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("admin-overlay-lock");
    document.body.classList.add("admin-overlay-lock");
    try {
      if (window.MCJAdminForms && typeof window.MCJAdminForms.enhance === "function") {
        window.MCJAdminForms.enhance(bodyEl);
      }
    } catch (e) {}
    var closeBtn = root.querySelector(".admin-overlay-close");
    if (closeBtn) {
      try {
        closeBtn.focus({ preventScroll: true });
      } catch (e2) {}
    }
    return bodyEl;
  }

  function setTitle(title) {
    ensure();
    if (titleEl) titleEl.textContent = title || "";
  }

  function setBody(html) {
    ensure();
    if (!bodyEl) return;
    bodyEl.innerHTML = html || "";
    try {
      if (window.MCJAdminForms && typeof window.MCJAdminForms.enhance === "function") {
        window.MCJAdminForms.enhance(bodyEl);
      }
    } catch (e) {}
  }

  function getBody() {
    ensure();
    return bodyEl;
  }

  function close() {
    if (!root) return;
    var cb = onCloseCb;
    onCloseCb = null;
    if (bodyEl) bodyEl.innerHTML = "";
    if (titleEl) titleEl.textContent = "";
    root.classList.remove("is-open");
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("admin-overlay-lock");
    document.body.classList.remove("admin-overlay-lock");
    if (typeof cb === "function") {
      try {
        cb();
      } catch (e) {}
    }
    if (lastFocus && typeof lastFocus.focus === "function") {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (e2) {}
    }
    lastFocus = null;
  }

  window.MCJAdminOverlay = {
    open: open,
    close: close,
    isOpen: isOpen,
    setTitle: setTitle,
    setBody: setBody,
    getBody: getBody,
    ensure: ensure,
  };
})();
