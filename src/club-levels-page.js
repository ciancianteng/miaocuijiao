(function () {
  "use strict";
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rangeText(level) {
    if (window.MCJCompanionLevels && window.MCJCompanionLevels.formatRange) {
      return window.MCJCompanionLevels.formatRange(level);
    }
    return (level.min || 0) + "–" + (level.max || 0) + (level.maxPlus ? "+" : "") + " 猫粮";
  }
  function card(level) {
    var bg =
      window.MCJCompanionLevels && window.MCJCompanionLevels.cardBackgroundCss
        ? window.MCJCompanionLevels.cardBackgroundCss(level)
        : "linear-gradient(135deg,#1a1218,#2a1824)";
    return (
      '<article class="club-level-card" style="--lvl:' +
      esc(level.color || "#f472b6") +
      ";background:" +
      esc(bg) +
      '">' +
      '<header><span class="club-level-badge">' +
      esc(level.icon || "●") +
      " " +
      esc(level.code) +
      "</span><strong>" +
      esc(level.name) +
      "</strong></header>" +
      '<p class="club-level-price">' +
      esc(rangeText(level)) +
      "</p>" +
      (level.description ? "<p class=\"club-level-desc\">" + esc(level.description) + "</p>" : "") +
      '<dl class="club-level-meta">' +
      (level.requirements || level.upgradeCondition
        ? "<div><dt>等级要求 / 升级条件</dt><dd>" + esc(level.requirements || level.upgradeCondition) + "</dd></div>"
        : "") +
      (level.downgradeCondition
        ? "<div><dt>降级条件</dt><dd>" + esc(level.downgradeCondition) + "</dd></div>"
        : "") +
      (level.benefits ? "<div><dt>等级权益</dt><dd>" + esc(level.benefits) + "</dd></div>" : "") +
      "</dl></article>"
    );
  }
  function render(guide, levels) {
    var root = document.getElementById("clubLevelsRoot");
    if (!root) return;
    var list = (levels || []).filter(function (l) {
      return l.enabled !== false;
    });
    root.innerHTML =
      '<section class="club-levels-hero"><h1>' +
      esc(guide.title || "俱乐部等级说明") +
      "</h1><p>" +
      esc(guide.intro || "") +
      "</p>" +
      (guide.updatedAt ? "<small>更新时间：" + esc(new Date(guide.updatedAt).toLocaleString("zh-CN", { hour12: false })) + "</small>" : "") +
      '</section><section class="club-levels-grid">' +
      (list.length ? list.map(card).join("") : '<div class="club-levels-empty">后台暂未发布等级说明</div>') +
      "</section>";
  }
  function load() {
    return Promise.all([
      fetch("/api/platform/content?types=club_level_guide", { cache: "no-store", headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .catch(function () {
          return {};
        }),
      fetch("/api/platform/companion-levels", { cache: "no-store", headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .catch(function () {
          return {};
        }),
    ]).then(function (pair) {
      var guideRows = (((pair[0] || {}).byType || {}).club_level_guide) || [];
      var guide = guideRows[0] || { title: "俱乐部等级说明", intro: "" };
      var levels = (pair[1] && (pair[1].levels || pair[1].data || [])) || [];
      if (window.MCJCompanionLevels && window.MCJCompanionLevels.hydrateFromList) {
        window.MCJCompanionLevels.hydrateFromList(levels);
        levels = window.MCJCompanionLevels.list ? window.MCJCompanionLevels.list() : levels;
      }
      render(guide, levels);
    });
  }
  load();
})();
