(function () {
  function headers() {
    var actor = {};
    try { actor = JSON.parse(localStorage.getItem("customerServiceUser") || "{}"); } catch (e) { actor = {}; }
    var id = actor.user_id || actor.id || "svc_1";
    return {
      "Content-Type": "application/json",
      "x-ops-role": "service",
      "x-ops-actor-id": id,
      "x-ops-actor-name": encodeURIComponent(actor.name || "客服")
    };
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function panel(title, html) {
    var old = document.getElementById("opsDesk");
    if (old) old.remove();
    var node = document.createElement("aside");
    node.id = "opsDesk";
    node.style.cssText = "position:fixed;top:0;right:0;z-index:85;width:min(420px,100%);height:100%;overflow:auto;background:#120910;color:#fff;padding:calc(16px + env(safe-area-inset-top)) 16px 24px;border-left:1px solid rgba(255,190,224,.3)";
    node.innerHTML = '<button type="button" data-close-desk>关闭</button><h2>' + title + '</h2>' + html;
    document.body.appendChild(node);
    node.addEventListener("click", function (event) {
      if (event.target.closest("[data-close-desk]")) node.remove();
    });
    return node;
  }
  function loadGifts() {
    var node = panel("收到的礼物", "<p>正在读取…</p>");
    fetch("/api/ops/gifts", { headers: headers(), cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
      var rows = (payload && payload.data) || [];
      var heading = node.querySelector("h2");
      if (heading && heading.nextElementSibling) heading.nextElementSibling.remove();
      heading.insertAdjacentHTML("afterend", rows.map(function (item) {
        var actions = item.status === "pending_review"
          ? '<button type="button" data-gift-review="' + esc(item.id) + '" data-result="confirmed">确认到账</button> <button type="button" data-gift-review="' + esc(item.id) + '" data-result="review_failed">未到账</button>'
          : "";
        return '<article class="ops-card"><b>' + esc(item.giftName) + " × " + esc(item.quantity) + '</b><p>' + esc(item.bossName) + " · RM" + Number(item.totalAmount).toFixed(2) + '</p><p>' + esc(item.createdAt) + " · " + esc(item.status) + '</p><p>' + esc(item.proof || "") + '</p><p>' + esc(item.reviewNote || "确认后按礼物抽成入账，这里不直接发放。") + "</p>" + actions + "</article>";
      }).join("") || "<p>还没有礼物记录</p>");
    }).catch(function () { node.insertAdjacentHTML("beforeend", "<p>礼物暂时读不到</p>"); });
    node.addEventListener("click", function (event) {
      var button = event.target.closest("[data-gift-review]");
      if (!button) return;
      var reason = button.dataset.result === "confirmed" ? "到账已确认" : (window.prompt("未到账原因") || "");
      if (button.dataset.result !== "confirmed" && !reason.trim()) return;
      fetch("/api/ops/gifts/" + encodeURIComponent(button.dataset.giftReview) + "/review", {
        method: "POST", headers: headers(), body: JSON.stringify({ result: button.dataset.result, reason: reason })
      }).then(function (res) { return res.json(); }).then(function (payload) {
        if (!payload.ok) { alert((payload && payload.error) || "审核失败"); return; }
        loadGifts();
      });
    });
  }
  function loadGrabs() {
    var node = panel("派单", '<form id="grabForm"><label>服务编号<input name="serviceId" required placeholder="从推荐搜索复制服务编号"></label><label>数量<input name="quantity" type="number" min="1" value="1"></label><label>时长<input name="duration" placeholder="1小时"></label><label>价格<input name="price" type="number" min="0" step="0.01"></label><label>要求<textarea name="requirements"></textarea></label><button type="submit">发布到抢单大厅</button></form><div data-grab-list>正在读取…</div>');
    fetch("/api/ops/grabs", { cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
      var rows = (payload && payload.data) || [];
      node.querySelector("[data-grab-list]").innerHTML = rows.map(function (item) {
        return '<article><b>' + esc(item.id) + '</b><p>' + esc(item.serviceName) + " · RM" + Number(item.price).toFixed(2) + " · " + esc(item.duration) + " · " + esc(item.status) + '</p><p>' + esc(item.requirements || "") + '</p><button type="button" data-grab-cancel="' + esc(item.id) + '">取消</button></article>';
      }).join("") || "<p>没有开放中的派单</p>";
    });
    node.addEventListener("submit", function (event) {
      if (event.target.id !== "grabForm") return;
      event.preventDefault();
      var form = event.target;
      fetch("/api/ops/service/grabs", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ serviceId: form.elements.serviceId.value, quantity: form.elements.quantity.value, duration: form.elements.duration.value, price: form.elements.price.value, requirements: form.elements.requirements.value })
      }).then(function (res) { return res.json(); }).then(function (payload) {
        if (!payload.ok) { alert((payload && payload.error) || "没有发布"); return; }
        loadGrabs();
      });
    });
    node.addEventListener("click", function (event) {
      var button = event.target.closest("[data-grab-cancel]");
      if (!button) return;
      fetch("/api/ops/grabs/" + encodeURIComponent(button.dataset.grabCancel) + "/cancel", { method: "POST", headers: headers(), body: "{}" })
        .then(function () { loadGrabs(); });
    });
  }
  function loadDiscord() {
    var node = panel("Discord 语音房", "<p>正在读取…</p>");
    fetch("/api/ops/service/discord-orders", { headers: headers(), cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
      var rows = (payload && payload.data) || [];
      var heading = node.querySelector("h2");
      if (heading && heading.nextElementSibling) heading.nextElementSibling.remove();
      heading.insertAdjacentHTML("afterend", rows.map(function (item) {
        var label = item.discordStatus === "arranged" ? "已安排语音房" : item.discordId ? "等待客服邀请" : "待填写 Discord ID";
        return '<article><b>' + esc(item.id) + "</b><p>" + esc(item.bossName) + " · " + esc(item.serviceName) + "</p><p>" + esc(label) + "</p><p>" + (item.discordId ? esc(item.discordId) + ' <button type="button" data-copy="' + esc(item.discordId) + '">复制</button>' : "老板还没填写") + "</p>" + (item.discordId && item.discordStatus !== "arranged" ? '<button type="button" data-arrange="' + esc(item.id) + '">标记已安排</button>' : "") + "</article>";
      }).join("") || "<p>没有 Discord 语音房订单</p>");
    });
    node.addEventListener("click", function (event) {
      var copy = event.target.closest("[data-copy]");
      if (copy && navigator.clipboard) navigator.clipboard.writeText(copy.dataset.copy || "");
      var arrange = event.target.closest("[data-arrange]");
      if (!arrange) return;
      fetch("/api/ops/orders/" + encodeURIComponent(arrange.dataset.arrange) + "/discord-status", {
        method: "POST", headers: headers(), body: JSON.stringify({ status: "arranged" })
      }).then(function () { loadDiscord(); });
    });
  }
  function mount() {
    var nav = document.querySelector(".service-nav");
    if (!nav || nav.querySelector("[data-ops-desk]")) return;
    ["收到的礼物", "派单", "Discord"].forEach(function (label) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.opsDesk = label;
      button.textContent = label;
      nav.appendChild(button);
    });
    nav.addEventListener("click", function (event) {
      var button = event.target.closest("[data-ops-desk]");
      if (!button) return;
      if (button.dataset.opsDesk === "收到的礼物") loadGifts();
      if (button.dataset.opsDesk === "派单") loadGrabs();
      if (button.dataset.opsDesk === "Discord") loadDiscord();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
