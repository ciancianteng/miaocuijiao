(function () {
  var ops = window.MCJOps;
  function esc(value) { return ops.esc(value); }
  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("cardMain");
    var id = new URLSearchParams(location.search).get("id") || "";
    if (!id) {
      root.innerHTML = '<div class="ops-card">缺少陪玩编号。</div>';
      return;
    }
    ops.request("/public/cards/" + encodeURIComponent(id)).then(function (card) {
      var avatar = card.companion.avatar || "assets/meow-cuijiao-brand.jpg";
      root.innerHTML = '<article class="ops-card profile-card"><img src="' + esc(avatar) + '" alt=""><div><span class="ops-kicker">PUBLIC CARD</span><h2>' + esc(card.companion.name) + "</h2><p>" + esc(card.companion.game || "") + "</p><p>" + esc(card.companion.bio || "") + '</p><div class="ops-badges">' + (card.badges || []).map(function (badge) {
        return '<span class="ops-badge">' + esc(badge.label) + "</span>";
      }).join("") + "</div></div></article>" + (card.services.length ? card.services.map(function (service) {
        return '<article class="ops-card"><div class="ops-split"><h3>' + esc(service.name) + "</h3>" + (service.acceptOrders ? '<span class="ops-chip ok">可接单</span>' : '<span class="ops-chip wait">暂不接单</span>') + "</div><p class='ops-price'>" + esc(service.priceText || "价格未展示") + "</p><p>" + esc(service.intro || "介绍未展示") + '</p><div class="ops-badges">' + (service.badges || []).map(function (badge) { return '<span class="ops-badge">' + esc(badge.label) + "</span>"; }).join("") + "</div>" + (service.acceptOrders ? '<a class="ops-btn primary" href="boss-order.html?service=' + encodeURIComponent(service.serviceId) + "&companion=" + encodeURIComponent(card.companion.id) + '">按这个单价下单</a>' : "") + "</article>";
      }).join("") : '<div class="ops-card">这位陪玩还没有把服务展示到个人卡片。</div>');
    }).catch(function (error) {
      root.innerHTML = '<div class="ops-card"><h2>卡片无法显示</h2><p>' + esc(error.message) + "</p></div>";
    });
  });
})();
