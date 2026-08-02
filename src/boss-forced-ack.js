/**
 * Boss / home forced rule ack modal (player_rules with forceConfirm).
 * Reuses companion modal CSS class names for consistent mobile behavior.
 */
(function () {
  "use strict";
  if (window.MCJBossForcedAck) return;

  var state = { pending: [], open: false, scrolled: false };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }

  function ensureCss() {
    if (document.getElementById("mcj-forced-ack-css")) return;
    var style = document.createElement("style");
    style.id = "mcj-forced-ack-css";
    style.textContent =
      ".pw-forced-mask{position:fixed;inset:0;z-index:12000;background:rgba(6,3,8,.78);display:flex;align-items:flex-end;justify-content:center;padding:max(8px,env(safe-area-inset-top,0px)) max(8px,env(safe-area-inset-right,0px)) max(8px,env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));box-sizing:border-box;overflow:hidden}" +
      ".pw-forced-modal{width:min(560px,100%);max-width:100%;max-height:min(88vh,720px);max-height:min(88dvh,720px);background:#160e14;border:1px solid rgba(244,114,182,.35);border-radius:18px 18px 12px 12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.45);box-sizing:border-box}" +
      ".pw-forced-modal header{padding:14px 16px 8px;border-bottom:1px solid rgba(244,114,182,.18);flex:0 0 auto}" +
      ".pw-forced-modal header strong{display:block;color:#fff;font-size:17px}" +
      ".pw-forced-modal header span{display:block;margin-top:4px;color:rgba(255,228,240,.62);font-size:12px}" +
      ".pw-forced-body{flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:14px 16px;color:rgba(255,228,240,.88);line-height:1.65;white-space:pre-wrap;font-size:14px;overscroll-behavior:contain}" +
      ".pw-forced-foot{flex:0 0 auto;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(244,114,182,.18);background:#120a10;display:grid;gap:10px}" +
      ".pw-forced-foot label{display:flex;gap:8px;align-items:flex-start;color:rgba(255,228,240,.8);font-size:13px;line-height:1.45}" +
      ".pw-forced-foot button{min-height:44px;width:100%;border:0;border-radius:12px;background:linear-gradient(135deg,#f472b6,#fb7185);color:#1a0a12;font-weight:800}" +
      ".pw-forced-foot button:disabled{opacity:.45;filter:grayscale(.2)}" +
      "@media(max-width:430px){.pw-forced-modal{max-height:min(90dvh,100%);border-radius:16px 16px 10px 10px}.pw-forced-modal header strong{font-size:16px}.pw-forced-body{font-size:13px;padding:12px 14px}}" +
      "@media(max-width:360px){.pw-forced-mask{padding:6px}.pw-forced-modal header{padding:12px 12px 6px}.pw-forced-foot{padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px))}}" +
      "@media(min-width:720px){.pw-forced-mask{align-items:center}.pw-forced-modal{border-radius:18px}}" +
      "html.pw-forced-open,body.pw-forced-open{overflow:hidden;overscroll-behavior:none}";
    document.head.appendChild(style);
  }

  function closeIfDone() {
    var mask = document.querySelector("[data-pw-forced-mask]");
    if (mask) mask.remove();
    state.open = false;
    state.scrolled = false;
    document.documentElement.classList.remove("pw-forced-open");
    document.body.classList.remove("pw-forced-open");
  }

  function renderModal() {
    ensureCss();
    var item = state.pending[0];
    if (!item) {
      closeIfDone();
      return;
    }
    document.documentElement.classList.add("pw-forced-open");
    document.body.classList.add("pw-forced-open");
    var mask = document.querySelector("[data-pw-forced-mask]");
    if (!mask) {
      mask = document.createElement("div");
      mask.className = "pw-forced-mask";
      mask.setAttribute("data-pw-forced-mask", "1");
      document.body.appendChild(mask);
    }
    state.open = true;
    state.scrolled = false;
    mask.innerHTML =
      '<div class="pw-forced-modal" role="dialog" aria-modal="true">' +
      "<header><strong>" +
      esc(item.title || "平台使用规则") +
      "</strong><span>版本 " +
      esc(item.version) +
      " · 请滚动至底部后确认</span></header>" +
      '<div class="pw-forced-body" data-pw-forced-body>' +
      esc(item.content || "") +
      "</div>" +
      '<div class="pw-forced-foot">' +
      '<label><input type="checkbox" data-pw-forced-agree disabled> 我已完整阅读并同意遵守以上规则</label>' +
      '<button type="button" data-pw-forced-confirm disabled>我已阅读并同意</button>' +
      "</div></div>";

    var body = mask.querySelector("[data-pw-forced-body]");
    var agree = mask.querySelector("[data-pw-forced-agree]");
    var btn = mask.querySelector("[data-pw-forced-confirm]");
    function checkScroll() {
      if (!body) return;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) {
        state.scrolled = true;
        if (agree) agree.disabled = false;
      }
      if (btn) btn.disabled = !(state.scrolled && agree && agree.checked);
    }
    if (body) {
      body.addEventListener("scroll", checkScroll);
      setTimeout(function () {
        if (body.scrollHeight <= body.clientHeight + 4) {
          state.scrolled = true;
          if (agree) agree.disabled = false;
        }
        checkScroll();
      }, 30);
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
      if (e.target === mask) e.stopPropagation();
    };
  }

  function show(pending) {
    state.pending = Array.isArray(pending) ? pending.slice() : [];
    if (!state.pending.length) {
      closeIfDone();
      return false;
    }
    renderModal();
    return true;
  }

  function refresh() {
    var t = token();
    if (!t) return Promise.resolve(false);
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

  window.MCJBossForcedAck = { show: show, refresh: refresh };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(refresh, 400);
    });
  } else {
    setTimeout(refresh, 400);
  }
})();
