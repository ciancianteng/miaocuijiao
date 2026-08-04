(function () {
  "use strict";

  if (window.MCJCertification) return;

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function badge(label) {
    return '<span class="cert-badge">' + esc(label) + '</span>';
  }

  function render(root, items) {
    var target = typeof root === "string" ? document.querySelector(root) : root;
    if (!target) return;
    var list = Array.isArray(items) && items.length ? items : ["实名认证", "官方认证"];
    target.innerHTML = list.map(badge).join("");
  }

  function apply() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-certification-badges]"), function (node) {
      var raw = node.getAttribute("data-certification-badges") || "";
      render(node, raw ? raw.split(/[，,]/).map(function (x) { return x.trim(); }).filter(Boolean) : null);
    });
  }

  window.MCJCertification = {
    render: render,
    apply: apply
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();
