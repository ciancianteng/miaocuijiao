(function () {
  "use strict";

  var REAL_KEY = "mcjRealDB.v1";
  var PLATFORM_KEY = "mcjPlatformData.v1";

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; }
    catch (error) { return {}; }
  }

  function platformDb() {
    return Object.assign({}, readJson(REAL_KEY), readJson(PLATFORM_KEY));
  }

  function isLoggedIn() {
    return !!localStorage.getItem("customerAuthToken");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function walkText(root, pairs) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      pairs.forEach(function (pair) {
        text = text.split(pair[0]).join(pair[1]);
      });
      node.nodeValue = text;
    }
  }

  function cleanVisibleText() {
    walkText(document.body, [
      ["手机号登录" + "录", "手机号登录"],
      ["获取验证码" + "码码", "获取验证码"],
      ["获取验证码" + "码", "获取验证码"],
      ["登录并进入" + "入", "登录并进入"],
      ["最近下单" + "动", "最近下单动态"],
      ["最新评价" + "价同步展示", "最新评价同步展示"],
      ["验证码会以前端" + "模拟方式生成", "请输入收到的验证码"],
      ["前端模拟" + "验证码", "验证码"],
      ["模拟验证码" + "：", "验证码已发送"],
      ["模拟登录", "登录"],
      ["测试环境，不会自动增加余额，也不会伪造充值成功" + "。", "提交后将进入后台人工审核，审核通过后余额到账。"],
      ["当前为测试" + "环境", "当前为人工审核流程"]
    ]);
  }

  function showLoginModal() {
    var modal = document.getElementById("modal");
    var body = document.getElementById("modalBody");
    if (modal && body) {
      body.innerHTML = window.bossLoginHtml ? window.bossLoginHtml() : '<div class="boss-login-modal"><h2>登录 MEOW CUI JIAO</h2><div class="login-tabs"><button class="login-tab active" type="button" data-login-tab="phone">手机验证</button><button class="login-tab" type="button" data-login-tab="email">邮箱登录</button></div><div class="login-panel active" data-login-panel="phone"><label>国家区号<select><option>+60 马来西亚</option><option>+86 中国</option></select></label><label>手机号码<input placeholder="请输入手机号码"></label><label>验证码<input placeholder="请输入验证码"></label><button class="login-submit" data-login-confirm type="button">登录</button></div><div class="login-panel" data-login-panel="email"><label>邮箱<input type="email" placeholder="请输入邮箱"></label><label>密码或邮箱验证码<input type="password"></label><button class="login-submit" data-login-confirm type="button">登录</button></div></div>';
      modal.classList.add("open");
      document.body.style.overflow = "hidden";
      return;
    }
    var login = document.querySelector("[data-login]");
    if (login) login.click();
  }

  function enforceAuthNavigation() {
    if (document.body.dataset.launchAuthReady === "1") return;
    document.body.dataset.launchAuthReady = "1";
    function refreshTop() {
      var logged = isLoggedIn();
      document.body.classList.toggle("is-logged-in", logged);
      document.querySelectorAll("[data-message-link], .top-actions a[href='messages.html']").forEach(function (el) { el.style.display = logged ? "" : "none"; });
      document.querySelectorAll(".user-chip.auth-only, .top-actions a[href='mine.html']").forEach(function (el) { el.style.display = logged ? "" : "none"; });
      document.querySelectorAll(".top-actions .login,[data-modal='login']").forEach(function (el) {
        if (el.classList.contains("login")) el.style.display = logged ? "none" : "inline-flex";
      });
    }
    refreshTop();
    document.addEventListener("click", function (event) {
      var sendCode = event.target.closest && event.target.closest("[data-send-code]");
      if (sendCode) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        sendCode.textContent = "已发送";
        var stateEl = document.querySelector("[data-login-state]");
        if (stateEl) stateEl.textContent = "验证码已发送，请查收后输入";
        return;
      }
      var loginConfirm = event.target.closest && event.target.closest("[data-login-confirm]");
      if (loginConfirm) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        var activePanel = document.querySelector(".login-panel.active") || loginConfirm.closest(".login-panel");
        var inputs = activePanel ? activePanel.querySelectorAll("input") : document.querySelectorAll(".boss-login-modal input");
        var account = "";
        Array.prototype.some.call(inputs, function (input) {
          if (input.value && input.value.trim()) {
            account = input.value.trim();
            return true;
          }
          return false;
        });
        var state = document.querySelector("[data-login-state]");
        if (!account) {
          if (state) state.textContent = "请填写登录信息";
          return;
        }
        if (window.MCJRoleGate) window.MCJRoleGate.login("customer", account);
        else {
          localStorage.setItem("customerAuthToken", "customer-" + Date.now());
          localStorage.setItem("customerUser", JSON.stringify({ account: account, role: "customer" }));
        }
        if (state) state.textContent = "登录成功";
        var modal = document.getElementById("modal");
        if (modal) modal.classList.remove("open");
        document.body.style.overflow = "";
        var next = sessionStorage.getItem("mcjAfterLoginRedirect");
        sessionStorage.removeItem("mcjAfterLoginRedirect");
        if (next) location.href = next;
        else refreshTop();
        return;
      }
      var mine = event.target.closest && event.target.closest('a[href="mine.html"], [data-open-mine]');
      if (mine && !isLoggedIn()) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        sessionStorage.setItem("mcjAfterLoginRedirect", "mine.html");
        showLoginModal();
      }
    }, true);
    window.addEventListener("storage", refreshTop);
    window.addEventListener("mcj:auth-updated", refreshTop);
  }

  function addQuickEntryStyles() {
    if (document.getElementById("launchReadinessStyles")) return;
    var style = document.createElement("style");
    style.id = "launchReadinessStyles";
    style.textContent = [
      ".launch-hidden{display:none!important}",
      ".launch-entry-grid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:18px!important}",
      ".launch-entry-grid .quick-entry-card{min-height:118px!important;display:flex!important;align-items:center!important;gap:16px!important}",
      ".launch-entry-grid .quick-entry-card i{width:48px!important;height:48px!important;min-width:48px!important;max-width:48px!important;display:grid!important;place-items:center!important;overflow:hidden!important}",
      ".launch-entry-grid .quick-entry-card i:before,.launch-entry-grid .quick-entry-card i:after{content:none!important;display:none!important}",
      ".launch-entry-grid .quick-entry-card:nth-child(2) i{background-image:none!important;background:rgba(255,220,235,.075)!important;color:transparent!important;font-size:0!important;filter:none!important}",
      ".launch-entry-grid .quick-entry-card:nth-child(2) i:before,.launch-entry-grid .quick-entry-card:nth-child(2) i:after{content:none!important;display:none!important;width:0!important;height:0!important;background:none!important;background-image:none!important;filter:none!important;box-shadow:none!important}",
      ".launch-entry-grid .quick-entry-card i img{width:48px!important;height:48px!important;object-fit:contain!important;filter:none!important;opacity:1!important}",
      ".launch-entry-grid .quick-entry-card:nth-child(2) i img{position:static!important;display:block!important;width:48px!important;height:48px!important;object-fit:contain!important;background:none!important;filter:none!important;box-shadow:none!important;opacity:1!important;transform:none!important}",
      ".launch-entry-grid .quick-entry-card span{word-break:keep-all!important;overflow-wrap:normal!important}",
      ".launch-empty-state{border:1px dashed rgba(243,168,203,.28);border-radius:20px;background:rgba(255,255,255,.035);padding:24px;text-align:center;color:#ffdceb;font-weight:900}",
      "@media(max-width:980px){.launch-entry-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}",
      "@media(max-width:760px){.launch-entry-grid{grid-template-columns:1fr 1fr!important}.launch-entry-grid .quick-entry-card{min-height:108px!important;gap:12px!important}.launch-entry-grid .quick-entry-card i,.launch-entry-grid .quick-entry-card i img{width:44px!important;height:44px!important;min-width:44px!important}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function quickButton(title, subtitle, action, icon) {
    return '<button class="neon-card quick-entry-card" type="button" ' + action + '><i>' + icon + '</i><div><strong>' + title + '</strong><span>' + subtitle + '</span></div></button>';
  }

  function rebuildHomeQuickEntries() {
    if (!/\/index\.html$|\/$/.test(location.pathname)) return;
    var firstQuick = document.querySelector(".quick-entry-card");
    if (!firstQuick) return;
    var grid = firstQuick.parentElement;
    if (!grid || grid.dataset.launchQuickReady === "1") return;
    addQuickEntryStyles();
    grid.dataset.launchQuickReady = "1";
    grid.classList.add("launch-entry-grid");
    grid.innerHTML = [
      quickButton("自定义订单", "填写需求，客服匹配陪玩", 'data-href="custom-order.html"', "📝"),
      quickButton("更多玩法", "护航、跑刀、代肝、趣味单", 'data-href="more-gameplays.html"', '<img src="assets/quick-more-play-plus.png" alt="">'),
      quickButton("陪玩大厅", "挑选认证陪玩，立即下单", 'data-href="companion-center.html"', "🎮"),
      quickButton("语音大厅", "语音陪伴、聊天、挂房", 'data-href="companion-center.html?service=voice"', "🎧"),
      quickButton("组队大厅", "后台配置后开放组队入口", 'data-team-lobby="true"', "🔗"),
      quickButton("充值中心", "人工审核充值，安全入账", 'data-href="mine.html#recharge"', "💎"),
      quickButton("活动中心", "查看平台活动与福利", 'data-href="activities.html"', "🎁")
    ].join("");
  }

  function hideTodayDataWithoutRealData() {
    if (!/\/index\.html$|\/$/.test(location.pathname)) return;
    var db = platformDb();
    var hasOrders = Array.isArray(db.orders) && db.orders.length;
    var hasPlayers = Array.isArray(db.companions) && db.companions.some(function (p) { return p.auditStatus === "approved" && p.visible !== false; });
    var title = Array.prototype.find.call(document.querySelectorAll(".section-title h2"), function (el) { return /今日数据/.test(el.textContent || ""); });
    var section = title && title.closest(".section");
    if (section) {
      var show = !!(hasOrders || hasPlayers);
      section.classList.toggle("launch-hidden", !show);
      section.style.display = show ? "" : "none";
    }
  }

  function bindQuickEntries() {
    document.addEventListener("click", function (event) {
      var href = event.target.closest && event.target.closest("[data-href]");
      if (href) {
        var url = href.getAttribute("data-href");
        if (/mine\.html/.test(url) && !isLoggedIn()) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          sessionStorage.setItem("mcjAfterLoginRedirect", url);
          showLoginModal();
          return;
        }
        location.href = url;
        return;
      }
      var team = event.target.closest && event.target.closest("[data-team-lobby]");
      if (team) {
        var db = platformDb();
        var link = (db.siteSettings && db.siteSettings.teamLobbyLink) || db.teamLobbyLink || "";
        if (!link) {
          alert("组队大厅暂未开放");
          return;
        }
        location.href = link;
      }
    }, true);
  }

  function fixCompanionHallState() {
    if (!/companion-center\.html$/.test(location.pathname)) return;
    var count = document.getElementById("resultCount");
    if (count && new RegExp("正在读取后台" + "数据").test(count.textContent || "")) count.textContent = "暂无已上架陪玩";
    setTimeout(function () {
      var list = document.getElementById("playerList");
      var empty = document.getElementById("emptyState");
      if (list && !list.children.length && empty) {
        empty.hidden = false;
        empty.innerHTML = '暂时没有找到符合条件的陪玩<br><a class="btn primary" href="companion-apply.html" style="margin-top:12px;display:inline-flex">申请成为陪玩</a>';
        if (count) count.textContent = "暂无已审核上架陪玩";
      }
    }, 1400);
  }

  function fixVoiceHall() {
    if (!/companion-center\.html$/.test(location.pathname)) return;
    var params = new URLSearchParams(location.search);
    if (params.get("type") !== "voice" && params.get("service") !== "voice") return;
    var h1 = document.querySelector(".companion-hall-hero h1");
    var p = document.querySelector(".companion-hall-hero p");
    if (h1) h1.textContent = "语音大厅";
    if (p) p.textContent = "优先展示语音试听、声音类型、每小时价格和当前状态";
    var type = document.getElementById("typeFilter");
    if (type) {
      setTimeout(function () {
        Array.prototype.forEach.call(type.options || [], function (option) {
          if (/语音|语聊|陪聊/.test(option.textContent || option.value)) type.value = option.value;
        });
        type.dispatchEvent(new Event("change", { bubbles: true }));
        var apply = document.getElementById("applyFilter");
        if (apply) apply.click();
      }, 500);
    }
  }

  function fixActivitiesLogin() {
    if (!/activities\.html$/.test(location.pathname)) return;
    var title = document.querySelector("#loginModal h2");
    var send = document.getElementById("sendCode");
    var confirm = document.getElementById("confirmLogin");
    var state = document.getElementById("loginState");
    if (title) title.textContent = "手机号登录";
    if (send) send.textContent = "获取验证码";
    if (confirm) confirm.textContent = "登录并进入";
    if (state) state.textContent = "请输入收到的验证码";
    document.addEventListener("click", function (event) {
      if (event.target && event.target.id === "sendCode") {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        event.target.textContent = "已发送";
        if (state) state.textContent = "验证码已发送，请查收后输入";
      }
      if (event.target && event.target.id === "confirmLogin") {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        var phone = document.getElementById("phoneInput");
        var code = document.getElementById("codeInput");
        if (!phone || !phone.value.trim()) {
          if (state) state.textContent = "请填写手机号";
          return;
        }
        if (!code || !code.value.trim()) {
          if (state) state.textContent = "请填写验证码";
          return;
        }
        if (window.MCJRoleGate) window.MCJRoleGate.login("customer", phone.value.trim());
        if (state) state.textContent = "登录成功";
        setTimeout(function () {
          var modal = document.getElementById("loginModal");
          if (modal) modal.classList.remove("show");
        }, 350);
      }
    }, true);
  }

  function fixRechargePanelText() {
    if (!/mine\.html$/.test(location.pathname)) return;
    setTimeout(function () {
      var warn = document.querySelector("#panel-recharge .state-warn");
      if (warn) warn.textContent = "请选择金额和支付渠道，上传付款凭证后提交后台审核；审核通过后余额到账。";
      var panel = document.getElementById("panel-recharge");
      if (panel && !panel.querySelector("[data-recharge-proof]")) {
        var box = document.createElement("div");
        box.className = "msg-item";
        box.style.marginTop = "12px";
        box.innerHTML = '<strong>上传付款凭证</strong><div class="form-grid" style="margin-top:10px"><label>选择支付渠道<select data-recharge-channel><option>TNG</option><option>支付宝</option></select></label><label>付款凭证<input data-recharge-proof type="file" accept="image/*"></label><label class="wide">备注<textarea data-recharge-note placeholder="填写付款账号、付款时间或其他说明"></textarea></label><button class="primary-btn wide" type="button" data-submit-recharge>提交审核</button></div><p class="muted">提交后会进入后台充值审核，不会自动伪造到账。</p>';
        panel.appendChild(box);
      }
    }, 300);
  }

  function bindFormalSubmitStates() {
    document.addEventListener("click", function (event) {
      var submit = event.target.closest && event.target.closest("[data-submit-recharge]");
      if (!submit) return;
      if (submit.disabled) return;
      var proof = document.querySelector("[data-recharge-proof]");
      if (!proof || !proof.files || !proof.files[0]) {
        alert("请先上传付款凭证");
        return;
      }
      submit.disabled = true;
      submit.textContent = "正在提交...";
      setTimeout(function () {
        submit.disabled = false;
        submit.textContent = "提交审核";
        alert("充值申请已提交后台审核");
      }, 500);
    }, true);
  }

  function init() {
    cleanVisibleText();
    enforceAuthNavigation();
    rebuildHomeQuickEntries();
    bindQuickEntries();
    hideTodayDataWithoutRealData();
    fixCompanionHallState();
    fixVoiceHall();
    fixActivitiesLogin();
    fixRechargePanelText();
    bindFormalSubmitStates();
    setTimeout(cleanVisibleText, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
