(function () {
  var cache = { home: [], companion: [], service: [] };

  function titles(audience) {
    return (cache[audience] || []).map(function (item) { return item.title; }).filter(Boolean);
  }

  function paint(audience) {
    var list = cache[audience] || [];
    var strip = document.querySelector("[data-ops-notice], .announcement-strip");
    var span = strip && strip.querySelector("span");
    if (strip && span) {
      if (!list.length) {
        strip.hidden = true;
        span.textContent = "";
      } else {
        strip.hidden = false;
        span.textContent = list.map(function (item) { return item.title; }).join(" · ");
      }
    }
    var mount = document.querySelector("[data-ops-notice-list]");
    if (mount) {
      mount.innerHTML = list.map(function (item) {
        return "<article><b>" + item.title + "</b><p>" + (item.body || "") + "</p></article>";
      }).join("") || "<p>暂无公告</p>";
    }
    var popup = list.find(function (item) { return item.forcePopup && !sessionStorage.getItem("mcj-notice-" + item.id); });
    if (popup) {
      sessionStorage.setItem("mcj-notice-" + popup.id, "1");
      window.alert(popup.title + (popup.body ? "\n" + popup.body : ""));
    }
  }

  function load(audience) {
    return fetch("/api/ops/public/announcements?audience=" + encodeURIComponent(audience), { cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        cache[audience] = (payload && payload.data) || [];
        paint(audience);
      })
      .catch(function () { paint(audience); });
  }

  window.MCJOpsNotices = { titles: titles, load: load };
  var audience = document.body && document.body.dataset.opsAudience || "home";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { load(audience); });
  else load(audience);
})();
