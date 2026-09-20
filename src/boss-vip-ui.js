/**
 * Boss VIP front-end panel (display only).
 * Data SoT remains /api/boss/vip — no business logic here.
 * Single premium card only — no duplicate detail blocks below.
 */
(function (global) {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function normalize(vip) {
    var v = vip && typeof vip === "object" ? vip : {};
    var spend = money(v.confirmedSpend);
    var nextTh = v.nextThreshold != null && v.nextThreshold !== "" ? money(v.nextThreshold) : null;
    var remain = v.isMaxLevel ? 0 : money(v.remaining != null ? v.remaining : 0);
    var progressSpend = nextTh != null ? Math.max(0, Math.min(spend, nextTh)) : spend;
    var pct = 100;
    if (!v.isMaxLevel && nextTh != null && nextTh > 0) {
      pct = Math.max(0, Math.min(100, Math.round((progressSpend / nextTh) * 1000) / 10));
    }
    return {
      name: v.currentLevelName || "普通会员",
      spend: spend,
      next: v.nextLevelName || (v.isMaxLevel ? "已是最高等级" : "—"),
      nextTh: nextTh,
      remain: remain,
      benefits: v.benefits || "暂无专属福利",
      isMax: !!v.isMaxLevel,
      pct: pct,
      progressSpend: progressSpend,
    };
  }

  function BossVipHeroCard(n) {
    var progressLabel = n.isMax
      ? "已达最高等级"
      : esc(n.progressSpend) + " / " + esc(n.nextTh) + " 猫粮";
    return (
      '<article class="bv-hero-card" aria-label="Boss VIP 会员卡">' +
      '<div class="bv-hero-sheen" aria-hidden="true"></div>' +
      '<div class="bv-hero-top">' +
      '<div class="bv-hero-brand">' +
      '<span class="bv-hero-mark" aria-hidden="true">◆</span>' +
      "<span>MEOW CUI JIAO VIP</span>" +
      "</div>" +
      '<span class="bv-hero-chip">Boss Member</span>' +
      "</div>" +
      '<div class="bv-hero-level">' +
      '<p class="bv-hero-kicker">当前等级</p>' +
      '<h2 class="bv-hero-title">' +
      esc(n.name) +
      "</h2>" +
      "</div>" +
      '<div class="bv-hero-stats">' +
      "<div><span>累计有效消费</span><strong>" +
      esc(n.spend) +
      " 猫粮</strong></div>" +
      "<div><span>下一等级</span><strong>" +
      esc(n.next) +
      "</strong></div>" +
      "<div><span>" +
      (n.isMax ? "状态" : "距离升级") +
      "</span><strong>" +
      (n.isMax ? "已满级" : "还差 " + esc(n.remain) + " 猫粮") +
      "</strong></div>" +
      "</div>" +
      '<div class="bv-hero-progress" aria-label="升级进度">' +
      '<div class="bv-hero-progress-head">' +
      "<span>升级进度</span>" +
      "<strong>" +
      progressLabel +
      "</strong>" +
      "</div>" +
      '<div class="bv-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      esc(n.pct) +
      '">' +
      '<div class="bv-progress-fill" style="width:' +
      esc(n.pct) +
      '%"></div>' +
      "</div>" +
      "</div>" +
      '<p class="bv-hero-perk"><span>Exclusive Benefits</span>' +
      esc(n.benefits) +
      "</p>" +
      '<p class="bv-hero-foot">客服确认的有效消费自动累计 · 达标即升</p>' +
      "</article>"
    );
  }

  function renderBossVipPanel(vip) {
    var n = normalize(vip);
    return (
      '<section class="bv-panel bv-panel--card-only" data-boss-vip-panel="1">' +
      '<div class="bv-panel-card">' +
      BossVipHeroCard(n) +
      "</div>" +
      "</section>"
    );
  }

  global.MCJBossVipUI = {
    renderPanel: renderBossVipPanel,
    BossVipHeroCard: function (vip) {
      return BossVipHeroCard(normalize(vip));
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
