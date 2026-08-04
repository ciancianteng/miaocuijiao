/**
 * Boss / home forced rule ack modal (player_rules with forceConfirm).
 *
 * P0: do NOT auto-open a full-screen lock on page load. A stuck mask made Staging
 * unusable (dark page, no click/scroll). Pending rules show as a non-blocking
 * banner; the modal only opens when the user taps the banner.
 */
(function () {
  "use strict";
  if (window.MCJBossForcedAck) return;

  var state = { pending: [], open: false, scrolled: false, clearedBodyTransform: false };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }

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

  function forcedMeta(item) {
    var html = "版本 " + esc(item.version || "1");
    if (item.updatedAt) html += "<br>最后更新：" + esc(fmtContentTime(item.updatedAt));
    html += "<br>请滚动至底部后确认";
    return html;
  }

  function ensureCss() {
    var style = document.getElementById("mcj-forced-ack-css");
    if (!style) {
      style = document.createElement("style");
      style.id = "mcj-forced-ack-css";
      document.head.appendChild(style);
    }
    style.textContent =
      ".pw-forced-banner{position:fixed;left:12px;right:12px;bottom:calc(72px + env(safe-area-inset-bottom,0px));z-index:11000;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:14px;border:1px solid rgba(244,114,182,.4);background:rgba(18,10,16,.96);box-shadow:0 12px 40px rgba(0,0,0,.45);color:#ffe4f0;font-size:13px;line-height:1.4}" +
      ".pw-forced-banner strong{display:block;font-size:14px;margin-bottom:2px}" +
      ".pw-forced-banner button{flex:0 0 auto;min-height:40px;padding:0 14px;border:0;border-radius:10px;background:linear-gradient(135deg,#f472b6,#fb7185);color:#1a0a12;font-weight:800;cursor:pointer}" +
      ".pw-forced-mask{position:fixed!important;top:0!important;right:0!important;bottom:0!important;left:0!important;width:100vw!important;width:100dvw!important;height:100vh!important;height:100dvh!important;max-width:100vw!important;max-height:100dvh!important;margin:0!important;z-index:12000!important;background:rgba(6,3,8,.78);display:flex!important;align-items:center;justify-content:center;padding:max(8px,env(safe-area-inset-top,0px)) max(8px,env(safe-area-inset-right,0px)) max(8px,env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));box-sizing:border-box;overflow:hidden}" +
      ".pw-forced-modal{width:min(560px,100%);max-width:100%;max-height:min(88vh,720px);max-height:min(88dvh,720px);background:#160e14;border:1px solid rgba(244,114,182,.35);border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.45);box-sizing:border-box}" +
      ".pw-forced-modal header{padding:14px 16px 8px;border-bottom:1px solid rgba(244,114,182,.18);flex:0 0 auto;position:relative}" +
      ".pw-forced-modal header strong{display:block;color:#fff;font-size:17px;padding-right:36px}" +
      ".pw-forced-modal header span{display:block;margin-top:4px;color:rgba(255,228,240,.62);font-size:12px}" +
      ".pw-forced-close{position:absolute;right:10px;top:10px;width:36px;height:36px;border:0;border-radius:10px;background:rgba(255,255,255,.06);color:#ffe4f0;font-size:22px;cursor:pointer}" +
      ".pw-forced-body{flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:14px 16px;color:rgba(255,228,240,.88);line-height:1.65;white-space:pre-wrap;font-size:14px;overscroll-behavior:contain}" +
      ".pw-forced-foot{flex:0 0 auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(244,114,182,.18);background:#120a10;display:grid;gap:10px}" +
      ".pw-forced-foot label{display:flex;gap:8px;align-items:flex-start;color:rgba(255,228,240,.8);font-size:13px;line-height:1.45}" +
      ".pw-forced-foot button{min-height:44px;width:100%;border:0;border-radius:12px;background:linear-gradient(135deg,#f472b6,#fb7185);color:#1a0a12;font-weight:800;cursor:pointer}" +
      ".pw-forced-foot button:disabled{opacity:.45;filter:grayscale(.2);cursor:not-allowed}" +
      "@media(max-width:720px){.pw-forced-mask{align-items:flex-end}.pw-forced-modal{border-radius:18px 18px 12px 12px}}" +
      "@media(max-width:430px){.pw-forced-modal{max-height:min(90dvh,100%)}.pw-forced-banner{bottom:calc(64px + env(safe-area-inset-bottom,0px))}}" +
      "html.pw-forced-open,body.pw-forced-open{overflow:hidden!important;overscroll-behavior:none}";
  }

  function neutralizeBodyTransform() {
    try {
      var cs = window.getComputedStyle(document.body);
      if (cs && cs.transform && cs.transform !== "none") {
        if (!state.clearedBodyTransform) {
          document.documentElement.dataset.mcjForcedBodyTransform = document.body.style.transform || "";
          state.clearedBodyTransform = true;
        }
        document.body.style.transform = "none";
      }
    } catch (e) {}
  }

  function restoreBodyTransform() {
    if (!state.clearedBodyTransform) return;
    try {
      document.body.style.transform = document.documentElement.dataset.mcjForcedBodyTransform || "";
      delete document.documentElement.dataset.mcjForcedBodyTransform;
    } catch (e) {}
    state.clearedBodyTransform = false;
  }

  function mountRoot() {
    return document.documentElement || document.body;
  }

  function removeBanner() {
    var banner = document.querySelector("[data-pw-forced-banner]");
    if (banner) banner.remove();
  }

  function showBanner() {
    ensureCss();
    removeBanner();
    if (!state.pending.length || state.open) return;
    var item = state.pending[0];
    var banner = document.createElement("div");
    banner.className = "pw-forced-banner";
    banner.setAttribute("data-pw-forced-banner", "1");
    banner.innerHTML =
      "<div><strong>待确认平台规则</strong><span>" +
      esc(item.title || "请阅读并确认最新规则") +
      "</span></div>" +
      '<button type="button" data-pw-forced-open>去确认</button>';
    banner.querySelector("[data-pw-forced-open]").addEventListener("click", function () {
      renderModal();
    });
    document.body.appendChild(banner);
  }

  function closeIfDone() {
    var mask = document.querySelector("[data-pw-forced-mask]");
    if (mask) mask.remove();
    state.open = false;
    state.scrolled = false;
    document.documentElement.classList.remove("pw-forced-open");
    document.body.classList.remove("pw-forced-open");
    restoreBodyTransform();
    if (state.pending.length) showBanner();
    else removeBanner();
  }

  function closeModalKeepPending() {
    var mask = document.querySelector("[data-pw-forced-mask]");
    if (mask) mask.remove();
    state.open = false;
    state.scrolled = false;
    document.documentElement.classList.remove("pw-forced-open");
    document.body.classList.remove("pw-forced-open");
    restoreBodyTransform();
    showBanner();
  }

  function renderModal() {
    ensureCss();
    var item = state.pending[0];
    if (!item) {
      closeIfDone();
      return;
    }
    removeBanner();
    neutralizeBodyTransform();
    document.documentElement.classList.add("pw-forced-open");
    document.body.classList.add("pw-forced-open");
    var mask = document.querySelector("[data-pw-forced-mask]");
    if (!mask) {
      mask = document.createElement("div");
      mask.className = "pw-forced-mask";
      mask.setAttribute("data-pw-forced-mask", "1");
      mountRoot().appendChild(mask);
    } else if (mask.parentNode !== mountRoot()) {
      mountRoot().appendChild(mask);
    }
    state.open = true;
    state.scrolled = false;
    mask.innerHTML =
      '<div class="pw-forced-modal" role="dialog" aria-modal="true">' +
      "<header><strong>" +
      esc(item.title || "平台使用规则") +
      "</strong><span>" +
      forcedMeta(item) +
      '</span><button type="button" class="pw-forced-close" data-pw-forced-dismiss aria-label="稍后确认">×</button></header>' +
      '<div class="pw-forced-body" data-pw-forced-body tabindex="0">' +
      esc(item.content || "") +
      "</div>" +
      '<div class="pw-forced-foot">' +
      '<label><input type="checkbox" data-pw-forced-agree disabled> 我已完整阅读并同意遵守以上规则</label>' +
      '<button type="button" data-pw-forced-confirm disabled>我已阅读并同意</button>' +
      "</div></div>";

    var body = mask.querySelector("[data-pw-forced-body]");
    var agree = mask.querySelector("[data-pw-forced-agree]");
    var btn = mask.querySelector("[data-pw-forced-confirm]");
    var dismiss = mask.querySelector("[data-pw-forced-dismiss]");
    if (dismiss) dismiss.addEventListener("click", closeModalKeepPending);

    function checkScroll() {
      if (!body) return;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) {
        state.scrolled = true;
        if (agree) agree.disabled = false;
      }
      if (btn) btn.disabled = !(state.scrolled && agree && agree.checked);
    }
    if (body) {
      body.addEventListener("scroll", checkScroll, { passive: true });
      mask.addEventListener(
        "wheel",
        function (e) {
          if (!body) return;
          body.scrollTop += e.deltaY;
          checkScroll();
          e.preventDefault();
        },
        { passive: false }
      );
      function tryUnlock() {
        if (body.scrollHeight <= body.clientHeight + 4) {
          state.scrolled = true;
          if (agree) agree.disabled = false;
        }
        checkScroll();
      }
      setTimeout(tryUnlock, 30);
      setTimeout(tryUnlock, 200);
      requestAnimationFrame(tryUnlock);
      try {
        body.focus({ preventScroll: true });
      } catch (e) {}
    }
    if (agree) {
      agree.addEventListener("change", function () {
        if (btn) btn.disabled = !(state.scrolled && agree.checked);
      });
    }
    if (btn) {
      btn.addEventListener("click", function () {
        if (!state.scrolled || !agree || !agree.checked) return;
        btn.disabled = true;
        btn.textContent = "提交中…";
        fetch("/api/auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token(),
          },
          body: JSON.stringify({
            action: "acknowledge_forced",
            content_id: item.id,
            content_version: item.version,
            content_type: item.contentType || "player_rules",
          }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (res) {
            if (res && res.ok === false) throw new Error(res.message || "确认失败");
            state.pending = (res && res.pendingForced) || state.pending.slice(1);
            if (state.pending.length) renderModal();
            else closeIfDone();
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = "我已阅读并同意";
            alert((err && err.message) || "确认失败");
          });
      });
    }
    mask.onclick = function (e) {
      if (e.target === mask) closeModalKeepPending();
    };
  }

  function show(pending) {
    state.pending = Array.isArray(pending) ? pending.slice() : [];
    // Hard rule: never auto-open full-screen mask on load / refresh.
    var orphan = document.querySelector("[data-pw-forced-mask]");
    if (orphan && !state.open) orphan.remove();
    document.documentElement.classList.remove("pw-forced-open");
    document.body.classList.remove("pw-forced-open");
    if (!state.pending.length) {
      closeIfDone();
      return false;
    }
    // Non-blocking: banner only. Modal opens on user action.
    showBanner();
    return true;
  }

  function refresh() {
    var t = token();
    if (!t) {
      removeBanner();
      var orphan = document.querySelector("[data-pw-forced-mask]");
      if (orphan) orphan.remove();
      document.documentElement.classList.remove("pw-forced-open");
      document.body.classList.remove("pw-forced-open");
      return Promise.resolve(false);
    }
    return fetch("/api/auth?action=pending_forced", {
      headers: { Authorization: "Bearer " + t, Accept: "application/json" },
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        if (!res || res.ok === false) return false;
        return show(res.pendingForced || []);
      })
      .catch(function () {
        return false;
      });
  }

  window.MCJBossForcedAck = { show: show, refresh: refresh, open: renderModal };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(refresh, 400);
    });
  } else {
    setTimeout(refresh, 400);
  }
})();
