(function () {
  "use strict";
  if (window.MCJDiscordDesk) return;

  var dismissedFill = {};
  var submitted = {};
  var ackedWait = {};
  var openKind = "";

  function ensureCss() {
    if (document.querySelector("link[data-mcj-dd-css]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/boss-discord-desk.css?v=20261019discord1";
    link.setAttribute("data-mcj-dd-css", "");
    document.head.appendChild(link);
  }

  function token() {
    try {
      var raw = localStorage.getItem("mcjBossSession") || sessionStorage.getItem("mcjBossSession") || "";
      var session = JSON.parse(raw || "null");
      return (session && (session.token || session.accessToken || session.access_token)) || "";
    } catch (e) {
      return "";
    }
  }

  function closeLayer() {
    var node = document.querySelector("[data-mcj-dd-layer]");
    if (node) node.remove();
    openKind = "";
  }

  function layer(html) {
    ensureCss();
    closeLayer();
    var wrap = document.createElement("div");
    wrap.className = "mcj-dd-layer";
    wrap.setAttribute("data-mcj-dd-layer", "");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    return wrap;
  }

  function post(action, body) {
    return fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + token(),
      },
      body: JSON.stringify(Object.assign({ action: action }, body || {})),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || json.ok === false) throw new Error((json && json.message) || "提交失败");
        return json;
      });
    });
  }

  function showPaymentThanks(onDone) {
    openKind = "thanks";
    var wrap = layer(
      '<div class="mcj-dd-card" data-mcj-dd-card>' +
      "<h2>谢谢款待喵～🐱💗</h2>" +
      "<p>我们已经收到您的付款资料，客服正在认真核对中，请稍等一下哦！</p>" +
      '<div class="mcj-dd-actions"><button type="button" class="mcj-dd-btn" data-mcj-dd-thanks>好的</button></div>' +
      "</div>"
    );
    var btn = wrap.querySelector("[data-mcj-dd-thanks]");
    if (btn) btn.focus();
    wrap.addEventListener("click", function (e) {
      if (!e.target.closest("[data-mcj-dd-thanks]")) return;
      closeLayer();
      if (typeof onDone === "function") onDone();
    });
  }

  function showFill(order) {
    openKind = "fill";
    var wrap = layer(
      '<div class="mcj-dd-card" data-mcj-dd-card>' +
      "<h2>喵～准备进入语音房啦！🎧💕</h2>" +
      "<p>老板，请填写您的 Discord 用户名，客服才能邀请您和陪玩进入专属语音房哦～</p>" +
      '<label><input data-mcj-dd-name maxlength="80" autocomplete="off" placeholder="请输入您的 Discord 用户名"></label>' +
      '<p class="mcj-dd-error" data-mcj-dd-error></p>' +
      '<div class="mcj-dd-actions">' +
      '<button type="button" class="mcj-dd-btn" data-mcj-dd-submit>确认提交 💗</button>' +
      "</div></div>"
    );
    var input = wrap.querySelector("[data-mcj-dd-name]");
    var error = wrap.querySelector("[data-mcj-dd-error]");
    var submit = wrap.querySelector("[data-mcj-dd-submit]");
    if (input) input.focus();
    wrap.addEventListener("click", function (e) {
      if (!e.target.closest("[data-mcj-dd-submit]")) return;
      var name = input ? String(input.value || "").trim() : "";
      if (!name) {
        if (error) error.textContent = "请输入您的 Discord 用户名";
        return;
      }
      if (submit) submit.disabled = true;
      post("submit_discord_username", { id: order.id, discordUsername: name }).then(function (res) {
        var next = (res && res.order) || order;
        submitted[order.id] = 1;
        closeLayer();
        showWait(next);
      }).catch(function (err) {
        if (submit) submit.disabled = false;
        if (error) error.textContent = err.message || "提交失败，请重试";
      });
    });
  }

  function showWait(order) {
    openKind = "wait";
    var wrap = layer(
      '<div class="mcj-dd-card" data-mcj-dd-card>' +
      "<h2>正在为您安排语音房～🐱💕</h2>" +
      "<p>老板请稍等一下喵～客服正在邀请您和陪玩加入 Discord 专属语音房，准备好一起开心玩耍吧！💗</p>" +
      '<div class="mcj-dd-actions"><button type="button" class="mcj-dd-btn" data-mcj-dd-wait>好的，耐心等待 💕</button></div>' +
      "</div>"
    );
    var btn = wrap.querySelector("[data-mcj-dd-wait]");
    if (btn) btn.focus();
    wrap.addEventListener("click", function (e) {
      if (!e.target.closest("[data-mcj-dd-wait]")) return;
      if (btn) btn.disabled = true;
      post("ack_discord_wait", { id: order.id }).catch(function () { return null; }).then(function () {
        ackedWait[order.id] = 1;
        try { sessionStorage.setItem("mcjDdWait:" + order.id, "1"); } catch (err) {}
        closeLayer();
      });
    });
  }

  function sync(orders) {
    if (openKind) return;
    var list = Array.isArray(orders) ? orders : [];
    var wait = null;
    var fill = null;
    for (var i = 0; i < list.length; i++) {
      var order = list[i] || {};
      if (!wait && order.discordShowWait && !ackedWait[order.id]) {
        var seen = "";
        try { seen = sessionStorage.getItem("mcjDdWait:" + order.id) || ""; } catch (e) {}
        if (!seen) wait = order;
      }
      if (!fill && order.discordShowFill && !dismissedFill[order.id] && !submitted[order.id]) fill = order;
    }
    if (wait) showWait(wait);
    else if (fill) showFill(fill);
  }

  window.MCJDiscordDesk = {
    sync: sync,
    showPaymentThanks: showPaymentThanks,
    showFill: showFill,
    showWait: showWait,
  };
})();
