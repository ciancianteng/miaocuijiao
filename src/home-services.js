(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mount(services) {
    var section = document.querySelector(".game-companions .section-title > div");
    if (!section) return;
    var existing = document.getElementById("homeServiceStrip");
    if (existing) existing.remove();
    if (!services.length) {
      var title = section.querySelector("h2");
      var desc = section.querySelector("p");
      if (title) title.textContent = "热门服务陪玩";
      if (desc) desc.textContent = "后台暂无首页服务，启用后将在这里同步";
      return;
    }
    var titleEl = section.querySelector("h2");
    var descEl = section.querySelector("p");
    if (titleEl) titleEl.textContent = "热门服务陪玩";
    if (descEl) descEl.textContent = "服务列表同步后台「服务管理」";
    var strip = document.createElement("div");
    strip.id = "homeServiceStrip";
    strip.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px";
    strip.innerHTML = services
      .map(function (item) {
        var label = (item.icon ? item.icon + " " : "") + (item.name || "");
        var price = item.defaultPrice || item.default_price || "";
        return (
          '<a href="companion-center.html?service=' +
          encodeURIComponent(item.name || "") +
          '" style="display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(243,168,203,.28);background:rgba(243,168,203,.10);color:#ffe7f2;text-decoration:none;font-size:12px;font-weight:800">' +
          esc(label) +
          (price ? '<small style="opacity:.78;font-weight:700">' + esc(price) + "</small>" : "") +
          "</a>"
        );
      })
      .join("");
    section.appendChild(strip);
  }

  function boot() {
    fetch("/api/platform/services?scope=home", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().catch(function () {
          return { services: [] };
        });
      })
      .then(function (body) {
        var rows = (body.services || [])
          .filter(function (item) {
            return item.enabled !== false && item.showHome !== false;
          })
          .sort(function (a, b) {
            return Number(a.sort || 100) - Number(b.sort || 100);
          });
        mount(rows);
      })
      .catch(function () {
        mount([]);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
