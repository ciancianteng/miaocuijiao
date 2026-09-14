/**
 * MCJ Web Push client
 * - Never auto-prompts system permission on page load.
 * - Custom guide first; only then Notification.requestPermission().
 * - iOS non-standalone: require Add to Home Screen first.
 * - First standalone visit (permission=default) shows opt-in guide.
 */
(function (global) {
  "use strict";

  var DISMISS_KEY = "mcj_webpush_dismiss_until";
  var DENIED_KEY = "mcj_webpush_denied";
  var PROMPTED_KEY = "mcj_webpush_first_prompted";
  var CSS_VER = "20260914webpush2";
  var GUIDE_COPY = {
    title: "开启消息通知",
    body: "开启后可及时收到订单、陪玩状态及重要消息通知。",
    enable: "开启通知",
    later: "暂时不要",
    needPwa: "请先将妙脆角添加到主屏幕，再开启通知。",
    install: "先添加到主屏幕",
  };

  function nowMs() {
    return Date.now();
  }

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

  function tokenFromSessionBlob(raw) {
    if (!raw) return "";
    try {
      var obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== "object") return "";
      return String(obj.token || obj.accessToken || obj.access_token || "").trim();
    } catch (e) {
      return "";
    }
  }

  function getAccessToken() {
    try {
      if (global.MCJBossAuth && typeof MCJBossAuth.getAccessToken === "function") {
        var t = String(MCJBossAuth.getAccessToken() || "").trim();
        if (t) return t;
      }
    } catch (e) {}
    try {
      if (global.MCJServiceAuth && typeof MCJServiceAuth.getAccessToken === "function") {
        var st = String(MCJServiceAuth.getAccessToken() || "").trim();
        if (st) return st;
      }
    } catch (e0) {}
    try {
      var boss =
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        "";
      if (boss) return String(boss).trim();
    } catch (e2) {}
    try {
      var companion =
        sessionStorage.getItem("companionAuthToken") ||
        localStorage.getItem("companionAuthToken") ||
        "";
      if (companion) return String(companion).trim();
    } catch (e3) {}
    try {
      var fromCompanionSession =
        tokenFromSessionBlob(sessionStorage.getItem("mcjCompanionSession")) ||
        tokenFromSessionBlob(localStorage.getItem("mcjCompanionSession"));
      if (fromCompanionSession) return fromCompanionSession;
    } catch (e4) {}
    try {
      var fromServiceSession =
        tokenFromSessionBlob(sessionStorage.getItem("mcjServiceSession")) ||
        tokenFromSessionBlob(localStorage.getItem("mcjServiceSession"));
      if (fromServiceSession) return fromServiceSession;
    } catch (e5) {}
    return "";
  }

  function authFetch(url, init) {
    var opts = init || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    var token = getAccessToken();
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(url, Object.assign({}, opts, { headers: headers, cache: "no-store" })).then(function (res) {
      return res
        .json()
        .catch(function () {
          return { ok: false, message: "响应解析失败" };
        })
        .then(function (body) {
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
    try {
      return Notification.permission || "default";
    } catch (e) {
      return "unsupported";
    }
  }

  function dismissedRecently() {
    try {
      var until = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return !!(until && until > nowMs());
    } catch (e) {
      return false;
    }
  }

  function markDismissed(hours) {
    try {
      localStorage.setItem(DISMISS_KEY, String(nowMs() + (hours || 72) * 3600 * 1000));
    } catch (e) {}
  }

  function markDenied() {
    try {
      localStorage.setItem(DENIED_KEY, "1");
    } catch (e) {}
  }

  function wasDeniedStored() {
    try {
      return localStorage.getItem(DENIED_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function markFirstPrompted() {
    try {
      localStorage.setItem(PROMPTED_KEY, "1");
    } catch (e) {}
  }

  function wasFirstPrompted() {
    try {
      return localStorage.getItem(PROMPTED_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function ensureGuideCss() {
    if (document.querySelector('link[data-mcj-webpush-css]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/web-push-client.css?v=" + CSS_VER;
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
    alert(GUIDE_COPY.needPwa);
  }

  function renderStatusLabel(state) {
    if (state === "granted" || state === "active") return "已开启";
    if (state === "denied") return "已被系统拒绝";
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
      var needPwaErr = new Error(GUIDE_COPY.needPwa);
      needPwaErr.code = "NEED_PWA";
      throw needPwaErr;
    }

    var perm = permissionState();
    if (perm === "denied") {
      markDenied();
      throw new Error("通知已被系统拒绝，请到系统设置中手动开启妙脆角通知。");
    }
    // Only request system permission after an explicit user gesture (caller must gate).
    if (perm !== "granted") perm = await Notification.requestPermission();
    if (perm !== "granted") {
      if (perm === "denied") markDenied();
      await authFetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deny" }),
      }).catch(function () {});
      throw new Error(perm === "denied" ? "通知已被系统拒绝，请到系统设置中手动开启。" : "未获得通知权限");
    }

    var publicKey = await fetchVapidPublicKey();
    var reg = await ensureServiceWorker();
    var existing = await reg.pushManager.getSubscription();
    var sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    var saved = await subscribeOnServer(sub, opts.role);
    if (!saved || !saved.ok) throw new Error((saved && saved.message) || "订阅保存失败");
    try {
      localStorage.removeItem(DENIED_KEY);
    } catch (e) {}
    markFirstPrompted();
    return { ok: true, subscription: sub, server: saved };
  }

  async function disablePush() {
    if (!supportsWebPush()) return { ok: true };
    var sub = await getCurrentSubscription();
    if (sub) {
      await unsubscribeOnServer(sub).catch(function () {});
      try {
        await sub.unsubscribe();
      } catch (e) {}
    }
    return { ok: true };
  }

  /** When permission already granted, silently restore/upsert subscription (no permission prompt). */
  async function restoreIfGranted(options) {
    var opts = options || {};
    if (!getAccessToken()) return { ok: false, reason: "no_token" };
    if (!supportsWebPush()) return { ok: false, reason: "unsupported" };
    if (isIos() && !isStandalone()) return { ok: false, reason: "need_pwa" };
    if (permissionState() !== "granted") return { ok: false, reason: "not_granted" };
    try {
      var result = await enablePush({ role: opts.role });
      return { ok: true, restored: true, result: result };
    } catch (err) {
      return { ok: false, reason: (err && err.message) || "restore_failed" };
    }
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
    else if (perm === "granted") state = "granted";
    return {
      supported: support,
      permission: perm,
      standalone: isStandalone(),
      ios: isIos(),
      needPwa: needPwa,
      currentActive: currentActive,
      devices: devices,
      state: state,
      label: renderStatusLabel(state === "granted" ? "granted" : state),
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
        '<h3 id="mcjWebPushTitle">' +
        GUIDE_COPY.title +
        "</h3>" +
        "<p>" +
        GUIDE_COPY.body +
        "</p>" +
        (st.needPwa ? '<p class="mcj-webpush-ios">' + GUIDE_COPY.needPwa + "</p>" : "") +
        (st.state === "denied"
          ? '<p class="mcj-webpush-ios">通知已被系统拒绝，请到系统设置中手动开启妙脆角通知。</p>'
          : "") +
        '<div class="mcj-webpush-actions">' +
        (st.needPwa
          ? '<button type="button" class="mcj-webpush-btn primary" data-webpush-install>' +
            GUIDE_COPY.install +
            "</button>"
          : st.state === "denied"
            ? ""
            : '<button type="button" class="mcj-webpush-btn primary" data-webpush-enable>' +
              GUIDE_COPY.enable +
              "</button>") +
        '<button type="button" class="mcj-webpush-btn ghost" data-webpush-later>' +
        GUIDE_COPY.later +
        "</button>" +
        "</div></div>";
      document.body.appendChild(wrap);

      wrap.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t) return;
        if (t.closest("[data-webpush-later]")) {
          markDismissed(72);
          markFirstPrompted();
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
              btn.textContent = GUIDE_COPY.enable;
              alert((err && err.message) || "开启失败");
            });
        }
      });
    });
  }

  /**
   * First enter PWA: show guide when standalone + permission default + supported.
   * Never calls Notification.requestPermission() by itself.
   * If already granted, silently restores subscription.
   */
  function maybePromptOnFirstVisit(options) {
    var opts = options || {};
    if (!getAccessToken()) return Promise.resolve({ shown: false, reason: "no_token" });
    if (!supportsWebPush()) return Promise.resolve({ shown: false, reason: "unsupported" });

    var perm = permissionState();
    if (perm === "granted") {
      return restoreIfGranted({ role: opts.role }).then(function (r) {
        return { shown: false, restored: !!(r && r.ok), reason: "already_granted" };
      });
    }
    if (perm === "denied") {
      markDenied();
      return Promise.resolve({ shown: false, reason: "denied" });
    }

    // iOS Safari (non-standalone): do not request push; optional soft tip only via force.
    if (isIos() && !isStandalone()) {
      if (opts.force) showGuide({ force: true, role: opts.role, onEnabled: opts.onEnabled });
      return Promise.resolve({ shown: !!opts.force, reason: "need_pwa" });
    }

    // First-visit auto guide only in installed PWA / standalone.
    if (!isStandalone() && !opts.force) {
      return Promise.resolve({ shown: false, reason: "not_standalone" });
    }
    if (perm !== "default") return Promise.resolve({ shown: false, reason: "perm_" + perm });
    if (dismissedRecently() && !opts.force) return Promise.resolve({ shown: false, reason: "dismissed" });
    if (wasFirstPrompted() && !opts.force) return Promise.resolve({ shown: false, reason: "already_prompted" });

    markFirstPrompted();
    showGuide({ role: opts.role, onEnabled: opts.onEnabled, force: !!opts.force });
    return Promise.resolve({ shown: true, reason: "guide" });
  }

  function mountSettings(root, options) {
    if (!root) return;
    var opts = options || {};
    ensureGuideCss();
    root.innerHTML =
      '<div class="mcj-webpush-settings">' +
      '<div class="mcj-webpush-settings-row">' +
      "<div><strong>消息通知</strong><p data-webpush-status-text>检测中…</p></div>" +
      '<label class="mcj-webpush-switch"><input type="checkbox" data-webpush-toggle disabled /><span></span></label>' +
      "</div>" +
      '<p class="mcj-webpush-hint" data-webpush-hint></p>' +
      '<button type="button" class="mcj-webpush-btn ghost" data-webpush-open-guide>开启 / 恢复通知</button>' +
      "</div>";

    var toggle = root.querySelector("[data-webpush-toggle]");
    var statusText = root.querySelector("[data-webpush-status-text]");
    var hint = root.querySelector("[data-webpush-hint]");

    function paint() {
      return refreshStatus().then(function (st) {
        statusText.textContent = st.label;
        toggle.disabled = st.state === "unsupported" || st.state === "denied" || st.state === "need_pwa";
        toggle.checked = st.state === "active" || st.state === "granted";
        if (st.state === "need_pwa") hint.textContent = GUIDE_COPY.needPwa;
        else if (st.state === "denied")
          hint.textContent = "通知已被系统拒绝。请到系统设置允许后，再回到这里重新开启。";
        else if (st.state === "unsupported") hint.textContent = "当前浏览器不支持 Web Push。";
        else if (st.state === "active") hint.textContent = "已在本机开启。关闭开关将取消本机订阅。";
        else if (st.state === "granted") hint.textContent = "系统已授权，正在同步订阅…可点下方按钮恢复。";
        else hint.textContent = "开启后即使关闭网页，也能收到订单与重要消息推送。";
        return st;
      });
    }

    paint().then(function (st) {
      if (st && st.permission === "granted" && !st.currentActive) {
        restoreIfGranted({ role: opts.role }).then(function () {
          return paint();
        });
      }
    });

    root.addEventListener("change", function (ev) {
      if (!ev.target || !ev.target.matches("[data-webpush-toggle]")) return;
      var want = !!ev.target.checked;
      toggle.disabled = true;
      var job = want ? enablePush({ role: opts.role }) : disablePush();
      job
        .then(function () {
          return paint();
        })
        .catch(function (err) {
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
    restoreIfGranted: restoreIfGranted,
    maybePromptOnFirstVisit: maybePromptOnFirstVisit,
    showGuide: showGuide,
    closeGuide: closeGuide,
    mountSettings: mountSettings,
    renderStatusLabel: renderStatusLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
