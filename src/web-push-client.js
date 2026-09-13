/**
 * MCJ Web Push client
 * - Never auto-prompts system permission on page load.
 * - Custom guide first; only then Notification.requestPermission().
 * - iOS non-standalone: require Add to Home Screen first.
 */
(function (global) {
  "use strict";

  var DISMISS_KEY = "mcj_webpush_dismiss_until";
  var DENIED_KEY = "mcj_webpush_denied";

  function nowMs() { return Date.now(); }

  function isStandalone() {
    try {
      if (global.navigator && navigator.standalone === true) return true;
      if (global.matchMedia && matchMedia("(display-mode: standalone)").matches) return true;
      if (global.matchMedia && matchMedia("(display-mode: minimal-ui)").matches) return true;
    } catch (e) {}
    return false;
  }

  function isIos() {
    var ua = String((navigator && navigator.userAgent) || "");
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function supportsWebPush() {
    return !!(global.Notification && global.PushManager && navigator.serviceWorker && global.isSecureContext);
  }

  function getAccessToken() {
    try {
      if (global.MCJBossAuth && typeof MCJBossAuth.getAccessToken === "function") {
        var t = String(MCJBossAuth.getAccessToken() || "").trim();
        if (t) return t;
      }
    } catch (e) {}
    try {
      var boss =
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        "";
      if (boss) return boss;
    } catch (e2) {}
    try {
      return (
        sessionStorage.getItem("companionAuthToken") ||
        localStorage.getItem("companionAuthToken") ||
        ""
      );
    } catch (e3) {
      return "";
    }
  }

  function authFetch(url, init) {
    var opts = init || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    var token = getAccessToken();
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(url, Object.assign({}, opts, { headers: headers, cache: "no-store" })).then(function (res) {
      return res.json().catch(function () { return { ok: false, message: "响应解析失败" }; }).then(function (body) {
        body = body || {};
        body._httpStatus = res.status;
        return body;
      });
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function permissionState() {
    if (!supportsWebPush()) return "unsupported";
    try { return Notification.permission || "default"; } catch (e) { return "unsupported"; }
  }

  function dismissedRecently() {
    try {
      var until = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return !!(until && until > nowMs());
    } catch (e) { return false; }
  }

  function markDismissed(hours) {
    try { localStorage.setItem(DISMISS_KEY, String(nowMs() + (hours || 72) * 3600 * 1000)); } catch (e) {}
  }

  function markDenied() {
    try { localStorage.setItem(DENIED_KEY, "1"); } catch (e) {}
  }

  function wasDeniedStored() {
    try { return localStorage.getItem(DENIED_KEY) === "1"; } catch (e) { return false; }
  }

  function ensureGuideCss() {
    if (document.querySelector('link[data-mcj-webpush-css]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/web-push-client.css?v=20260913webpush1";
    link.setAttribute("data-mcj-webpush-css", "1");
    document.head.appendChild(link);
  }

  function openIosInstallGuide() {
    if (global.MCJPwaInstall && typeof MCJPwaInstall.open === "function") {
      MCJPwaInstall.open({ force: true });
      return;
    }
    if (global.MCJPwaInstall && typeof MCJPwaInstall.openGuide === "function") {
      MCJPwaInstall.openGuide();
      return;
    }
    alert("要接收妙脆角即时通知，请先将妙脆角添加到主屏幕，然后从主屏幕图标打开。");
  }

  function renderStatusLabel(state) {
    if (state === "granted" || state === "active") return "已开启";
    if (state === "denied") return "浏览器已禁止";
    if (state === "unsupported") return "当前设备不支持";
    if (state === "need_pwa") return "请先添加到主屏幕";
    return "未开启";
  }

  async function fetchVapidPublicKey() {
    var data = await authFetch("/api/push?action=vapidPublicKey");
    if (!data || !data.ok || !data.publicKey) throw new Error((data && data.message) || "无法获取 VAPID 公钥");
    return data.publicKey;
  }

  async function ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) throw new Error("当前浏览器不支持 Service Worker");
    var reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register("/sw-mcj.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function getCurrentSubscription() {
    var reg = await ensureServiceWorker();
    return reg.pushManager.getSubscription();
  }

  async function subscribeOnServer(subscription, role) {
    var json = subscription.toJSON ? subscription.toJSON() : subscription;
    return authFetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "subscribe", role: role || "", subscription: json }),
    });
  }

  async function unsubscribeOnServer(subscription) {
    var json = subscription.toJSON ? subscription.toJSON() : subscription;
    return authFetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unsubscribe", subscription: json }),
    });
  }

  async function enablePush(options) {
    var opts = options || {};
    if (!getAccessToken()) throw new Error("请先登录后再开启通知");
    if (!supportsWebPush()) throw new Error("当前设备不支持 Web Push");
    if (isIos() && !isStandalone()) {
      openIosInstallGuide();
      var needPwaErr = new Error("要接收妙脆角即时通知，请先将妙脆角添加到主屏幕。");
      needPwaErr.code = "NEED_PWA";
      throw needPwaErr;
    }

    var perm = permissionState();
    if (perm === "denied") {
      markDenied();
      throw new Error("浏览器已禁止通知，请到系统设置中允许妙脆角通知。");
    }
    if (perm !== "granted") perm = await Notification.requestPermission();
    if (perm !== "granted") {
      if (perm === "denied") markDenied();
      await authFetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deny" }),
      }).catch(function () {});
      throw new Error(perm === "denied" ? "你已拒绝通知权限" : "未获得通知权限");
    }

    var publicKey = await fetchVapidPublicKey();
    var reg = await ensureServiceWorker();
    var existing = await reg.pushManager.getSubscription();
    var sub = existing || (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
    var saved = await subscribeOnServer(sub, opts.role);
    if (!saved || !saved.ok) throw new Error((saved && saved.message) || "订阅保存失败");
    try { localStorage.removeItem(DENIED_KEY); } catch (e) {}
    return { ok: true, subscription: sub, server: saved };
  }

  async function disablePush() {
    if (!supportsWebPush()) return { ok: true };
    var sub = await getCurrentSubscription();
    if (sub) {
      await unsubscribeOnServer(sub).catch(function () {});
      try { await sub.unsubscribe(); } catch (e) {}
    }
    return { ok: true };
  }

  async function refreshStatus() {
    var support = supportsWebPush();
    var perm = permissionState();
    var needPwa = isIos() && !isStandalone();
    var currentActive = false;
    var devices = [];
    if (support && getAccessToken()) {
      try {
        var sub = await getCurrentSubscription();
        var endpoint = sub && sub.endpoint ? sub.endpoint : "";
        var q = "/api/push?action=status" + (endpoint ? "&endpoint=" + encodeURIComponent(endpoint) : "");
        var data = await authFetch(q);
        if (data && data.ok) {
          currentActive = !!data.currentActive;
          devices = data.devices || [];
        }
      } catch (e) {}
    }
    var state = "default";
    if (!support) state = "unsupported";
    else if (needPwa) state = "need_pwa";
    else if (perm === "denied" || wasDeniedStored()) state = "denied";
    else if (perm === "granted" && currentActive) state = "active";
    return {
      supported: support,
      permission: perm,
      standalone: isStandalone(),
      ios: isIos(),
      needPwa: needPwa,
      currentActive: currentActive,
      devices: devices,
      state: state,
      label: renderStatusLabel(state),
    };
  }

  function closeGuide() {
    var el = document.getElementById("mcjWebPushGuide");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showGuide(options) {
    var opts = options || {};
    if (document.getElementById("mcjWebPushGuide")) return;
    ensureGuideCss();
    refreshStatus().then(function (st) {
      if (st.state === "active" && !opts.force) return;
      if (st.state === "denied" && !opts.force) return;
      if (dismissedRecently() && !opts.force) return;

      var wrap = document.createElement("div");
      wrap.id = "mcjWebPushGuide";
      wrap.className = "mcj-webpush-guide";
      wrap.innerHTML =
        '<div class="mcj-webpush-card" role="dialog" aria-modal="true" aria-labelledby="mcjWebPushTitle">' +
        '<button type="button" class="mcj-webpush-close" data-webpush-later aria-label="关闭">×</button>' +
        '<h3 id="mcjWebPushTitle">开启妙脆角通知</h3>' +
        "<p>开启后可及时收到订单状态、陪玩接单、客服消息和重要账户通知。</p>" +
        (st.needPwa ? '<p class="mcj-webpush-ios">要接收妙脆角即时通知，请先将妙脆角添加到主屏幕。</p>' : "") +
        '<div class="mcj-webpush-actions">' +
        (st.needPwa
          ? '<button type="button" class="mcj-webpush-btn primary" data-webpush-install>先添加到主屏幕</button>'
          : '<button type="button" class="mcj-webpush-btn primary" data-webpush-enable>开启通知</button>') +
        '<button type="button" class="mcj-webpush-btn ghost" data-webpush-later>稍后再说</button>' +
        "</div></div>";
      document.body.appendChild(wrap);

      wrap.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t) return;
        if (t.closest("[data-webpush-later]")) {
          markDismissed(72);
          closeGuide();
          return;
        }
        if (t.closest("[data-webpush-install]")) {
          openIosInstallGuide();
          return;
        }
        if (t.closest("[data-webpush-enable]")) {
          var btn = t.closest("[data-webpush-enable]");
          btn.disabled = true;
          btn.textContent = "开启中…";
          enablePush({ role: opts.role })
            .then(function () {
              closeGuide();
              if (typeof opts.onEnabled === "function") opts.onEnabled();
            })
            .catch(function (err) {
              btn.disabled = false;
              btn.textContent = "开启通知";
              alert((err && err.message) || "开启失败");
            });
        }
      });
    });
  }

  function mountSettings(root, options) {
    if (!root) return;
    var opts = options || {};
    ensureGuideCss();
    root.innerHTML =
      '<div class="mcj-webpush-settings">' +
      '<div class="mcj-webpush-settings-row">' +
      "<div><strong>通知设置</strong><p data-webpush-status-text>检测中…</p></div>" +
      '<label class="mcj-webpush-switch"><input type="checkbox" data-webpush-toggle disabled /><span></span></label>' +
      "</div>" +
      '<p class="mcj-webpush-hint" data-webpush-hint></p>' +
      '<button type="button" class="mcj-webpush-btn ghost" data-webpush-open-guide>打开通知引导</button>' +
      "</div>";

    var toggle = root.querySelector("[data-webpush-toggle]");
    var statusText = root.querySelector("[data-webpush-status-text]");
    var hint = root.querySelector("[data-webpush-hint]");

    function paint() {
      return refreshStatus().then(function (st) {
        statusText.textContent = st.label;
        toggle.disabled = st.state === "unsupported" || st.state === "denied" || st.state === "need_pwa";
        toggle.checked = st.state === "active";
        if (st.state === "need_pwa") hint.textContent = "要接收妙脆角即时通知，请先将妙脆角添加到主屏幕。";
        else if (st.state === "denied") hint.textContent = "浏览器已禁止通知。请到系统设置允许后，再回到这里重新开启。";
        else if (st.state === "unsupported") hint.textContent = "当前浏览器不支持 Web Push。";
        else if (st.state === "active") hint.textContent = "已在本机开启。关闭开关将取消本机订阅。";
        else hint.textContent = "开启后即使关闭网页，也能收到订单与重要消息推送。";
        return st;
      });
    }

    paint();

    root.addEventListener("change", function (ev) {
      if (!ev.target || !ev.target.matches("[data-webpush-toggle]")) return;
      var want = !!ev.target.checked;
      toggle.disabled = true;
      var job = want ? enablePush({ role: opts.role }) : disablePush();
      job.then(function () { return paint(); }).catch(function (err) {
        alert((err && err.message) || "操作失败");
        return paint();
      });
    });

    root.addEventListener("click", function (ev) {
      if (ev.target && ev.target.closest("[data-webpush-open-guide]")) {
        showGuide({ force: true, role: opts.role, onEnabled: paint });
      }
    });
  }

  global.MCJWebPush = {
    supportsWebPush: supportsWebPush,
    isStandalone: isStandalone,
    isIos: isIos,
    permissionState: permissionState,
    refreshStatus: refreshStatus,
    enablePush: enablePush,
    disablePush: disablePush,
    showGuide: showGuide,
    closeGuide: closeGuide,
    mountSettings: mountSettings,
    renderStatusLabel: renderStatusLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
