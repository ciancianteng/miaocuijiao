(function () {
  "use strict";

  if (window.MCJHomeClubLevelsModal) return;

  var state = {
    loaded: false,
    loading: false,
    guide: { title: "俱乐部等级说明", intro: "" },
    levels: [],
  };

  function fmtContentTime(v) {
    if (window.MCJContentTime && window.MCJContentTime.fmtContentTime) return window.MCJContentTime.fmtContentTime(v);
    if (!v) return "";
    try {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(new Date(v))
        .replace(" ", " ");
    } catch (e) {
      return String(v).slice(0, 16).replace("T", " ");
    }
  }

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

  function ensureModal() {
    var modal = document.getElementById("homeClubLevelsModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "homeClubLevelsModal";
    modal.className = "home-club-levels-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="home-club-levels-dialog" role="dialog" aria-modal="true" aria-labelledby="homeClubLevelsModalTitle">' +
      '<button type="button" class="home-club-levels-close" data-club-levels-close aria-label="关闭">×</button>' +
      '<div class="home-club-levels-scroll">' +
      '<header class="home-club-levels-hero">' +
      '<h3 id="homeClubLevelsModalTitle">俱乐部等级说明</h3>' +
      '<p class="home-club-levels-intro"></p>' +
      '<p class="home-club-levels-updated" data-club-levels-updated hidden></p>' +
      "</header>" +
      '<div class="home-club-levels-grid" data-club-levels-grid>' +
      '<div class="club-levels-loading">正在加载最新等级说明…</div>' +
      "</div>" +
      "</div>" +
      "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.closest("[data-club-levels-close]")) closeModal();
    });
    return modal;
  }

  function renderModal() {
    var modal = ensureModal();
    var titleEl = modal.querySelector("#homeClubLevelsModalTitle");
    var introEl = modal.querySelector(".home-club-levels-intro");
    var updatedEl = modal.querySelector("[data-club-levels-updated]");
    var gridEl = modal.querySelector("[data-club-levels-grid]");
    if (titleEl) titleEl.textContent = state.guide.title || "俱乐部等级说明";
    if (introEl) introEl.textContent = state.guide.intro || "";
    if (updatedEl) {
      var at = state.guide.updatedAt || state.guide.updated_at || "";
      if (at) {
        updatedEl.hidden = false;
        updatedEl.textContent = "最后更新：" + fmtContentTime(at);
      } else {
        updatedEl.hidden = true;
        updatedEl.textContent = "";
      }
    }
    if (gridEl) {
      var list = (state.levels || []).filter(function (l) {
        return l.enabled !== false;
      });
      gridEl.innerHTML = list.length
        ? list.map(card).join("")
        : '<div class="club-levels-empty">后台暂未发布等级说明</div>';
    }
  }

  function load() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
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
    ])
      .then(function (pair) {
        var guideRows = (((pair[0] || {}).byType || {}).club_level_guide) || [];
        state.guide = guideRows[0] || { title: "俱乐部等级说明", intro: "" };
        var levels = (pair[1] && (pair[1].levels || pair[1].data || [])) || [];
        if (window.MCJCompanionLevels && window.MCJCompanionLevels.hydrateFromList) {
          window.MCJCompanionLevels.hydrateFromList(levels);
          levels = window.MCJCompanionLevels.list ? window.MCJCompanionLevels.list() : levels;
        }
        state.levels = levels;
        state.loaded = true;
      })
      .catch(function () {
        state.levels = [];
        state.loaded = true;
      })
      .then(function () {
        state.loading = false;
        renderModal();
      });
  }

  function openModal() {
    var modal = ensureModal();
    renderModal();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (!state.loaded) load();
  }

  function closeModal() {
    var modal = document.getElementById("homeClubLevelsModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-club-levels-open]");
    if (!trigger) return;
    e.preventDefault();
    openModal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var modal = document.getElementById("homeClubLevelsModal");
    if (modal && !modal.hidden) closeModal();
  });

  window.MCJHomeClubLevelsModal = {
    open: openModal,
    close: closeModal,
    reload: load,
  };
})();
