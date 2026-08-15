(function () {
  "use strict";
  /**
   * Popularity admin panel — temporarily soft-disabled.
   * Ranking / gifts / favorites / online-duration pipelines are not fully verified.
   * Do not re-enable recompute / adjust / rewards until those REAL API chains are accepted.
   * Never fall back to random, fixed arrays, or localStorage leaderboard mock data.
   */
  var TARGET = "popularityManagement";

  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    box.innerHTML =
      '<div class="admin-sync-note" style="padding:18px;line-height:1.7">' +
      "<strong>人气榜功能暂时停用</strong>" +
      '<p style="margin:10px 0 0">为避免假榜单进入正式后台，人气榜规则保存、分数调整与「立即重算」已关闭。</p>' +
      '<p style="margin:8px 0 0">待礼物 / 收藏 / 在线时长等真实数据链路验收通过后再恢复。当前无排行榜业务数据可展示。</p>' +
      '<p style="margin:8px 0 0" class="empty">暂无数据</p>' +
      "</div>";
  }

  document.addEventListener("DOMContentLoaded", paint);
  if (document.readyState !== "loading") paint();
})();
