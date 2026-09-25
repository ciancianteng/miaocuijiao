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
      (level.description ? '<p class="club-level-desc">' + esc(level.description) + "</p>" : "") +
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
  function clubNoteModule() {
    var paras = [
      "我们不是不重视陪玩的能力，而是经过多年对陪玩行业的观察与审核后发现：",
      "“考核通过”与“真正会接单、会服务老板”，其实是两件不同的事情。",
      "有的人考核成绩很好，却不一定懂得沟通、照顾老板的游戏体验；也有人并不擅长应付统一标准的考核，但在真实接单过程中认真、负责、有耐心，能够让老板获得很好的陪伴体验。",
      "所以在妙脆角，我们更希望把选择权交给双方。",
      "陪玩对自己的资料、能力、服务态度与每一张订单负责；老板则通过真实下单，亲自感受这位陪玩的服务。",
      "平台不会替任何一位陪玩“保证一定适合所有老板”，但我们会通过真实评价、订单记录、投诉与售后记录，让真正认真服务的陪玩逐渐获得更高的等级、曝光和机会。",
    ];
    var summaryHtml = paras
      .slice(0, 3)
      .map(function (p) {
        return "<p>" + esc(p) + "</p>";
      })
      .join("");
    var fullHtml = paras
      .map(function (p) {
        return "<p>" + esc(p) + "</p>";
      })
      .join("");
    return (
      '<section class="club-levels-note" data-club-note aria-label="本俱乐部说明">' +
      '<div class="club-levels-note-card">' +
      "<header>" +
      "<h2>本俱乐部说明</h2>" +
      '<p class="club-levels-note-sub">为什么妙脆角没有传统的陪玩考核？</p>' +
      "</header>" +
      '<div class="club-levels-note-body" data-club-note-body data-expanded="0">' +
      '<div class="club-levels-note-summary" data-club-note-summary>' +
      summaryHtml +
      "</div>" +
      '<div class="club-levels-note-full" data-club-note-full hidden>' +
      fullHtml +
      "</div>" +
      "</div>" +
      '<button type="button" class="club-levels-note-toggle" data-club-note-toggle aria-expanded="false">展开全文</button>' +
      "</div></section>"
    );
  }
  function bindClubNote(root) {
    if (!root) return;
    var note = root.querySelector("[data-club-note]");
    if (!note || note.getAttribute("data-bound") === "1") return;
    note.setAttribute("data-bound", "1");
    var btn = note.querySelector("[data-club-note-toggle]");
    var body = note.querySelector("[data-club-note-body]");
    var summary = note.querySelector("[data-club-note-summary]");
    var full = note.querySelector("[data-club-note-full]");
    if (!btn || !body || !summary || !full) return;
    btn.addEventListener("click", function () {
      var open = body.getAttribute("data-expanded") === "1";
      if (open) {
        body.setAttribute("data-expanded", "0");
        full.hidden = true;
        summary.hidden = false;
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "展开全文";
      } else {
        body.setAttribute("data-expanded", "1");
        summary.hidden = true;
        full.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        btn.textContent = "收起";
      }
    });
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
      (guide.updatedAt
        ? "<small>更新时间：" +
          esc(new Date(guide.updatedAt).toLocaleString("zh-CN", { hour12: false })) +
          "</small>"
        : "") +
      "</section>" +
      clubNoteModule() +
      '<section class="club-levels-grid">' +
      (list.length ? list.map(card).join("") : '<div class="club-levels-empty">后台暂未发布等级说明</div>') +
      "</section>";
    bindClubNote(root);
  }
  function load() {
    return Promise.all([
      fetch("/api/platform/content?types=club_level_guide", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          return r.json();
        })
        .catch(function () {
          return {};
        }),
      fetch("/api/platform/companion-levels", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          return r.json();
        })
        .catch(function () {
          return {};
        }),
    ]).then(function (pair) {
      var guideRows = ((pair[0] || {}).byType || {}).club_level_guide || [];
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
