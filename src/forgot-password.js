/**
 * Shared phone-OTP password recovery for boss / companion / customer_service.
 * API: POST /api/auth  { action: forgot_send_otp | forgot_verify_otp | forgot_reset_password, role, ... }
 */
(function () {
  "use strict";

  if (window.MCJForgotPassword) return;

  var SUCCESS_TOAST = "密码修改成功，请重新登录。";
  var COUNTDOWN_SEC = 60;
  var STYLE_ID = "mcj-forgot-password-style";

  var state = {
    open: false,
    role: "boss",
    step: "phone",
    phone: "",
    resetToken: "",
    busy: false,
    msg: "",
    countdown: 0,
    countdownTimer: null,
    onDone: null,
    host: null,
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = document.createElement("style");
    css.id = STYLE_ID;
    css.textContent =
      ".mcj-forgot-host{position:fixed;inset:0;z-index:12000;display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 16px max(12px,env(safe-area-inset-bottom));background:rgba(4,4,8,.72);-webkit-overflow-scrolling:touch;overflow:auto}" +
      ".mcj-forgot-host[hidden]{display:none!important}" +
      ".mcj-forgot-card{width:min(420px,100%);max-height:min(92dvh,920px);overflow:auto;margin:auto;padding:22px 20px 20px;border-radius:18px;border:1px solid rgba(255,160,200,.28);background:linear-gradient(165deg,rgba(36,20,32,.98),rgba(12,10,16,.98));box-shadow:0 18px 48px rgba(0,0,0,.45);color:#f7f7fb;font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif}" +
      ".mcj-forgot-card h2{margin:0 0 6px;font-size:1.2rem;font-weight:800;color:#ffe6f1}" +
      ".mcj-forgot-card .mcj-forgot-desc{margin:0 0 14px;font-size:13px;line-height:1.45;color:rgba(255,220,235,.78)}" +
      ".mcj-forgot-card label{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;font-size:13px;font-weight:700;color:#ffd6e7}" +
      ".mcj-forgot-card input{appearance:none;width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,160,200,.28);background:rgba(8,8,12,.75);color:#fff;font-size:15px;font-family:inherit}" +
      ".mcj-forgot-card input:focus{outline:none;border-color:rgba(255,143,197,.75);box-shadow:0 0 0 2px rgba(255,143,197,.22)}" +
      ".mcj-forgot-actions{display:flex;flex-direction:column;gap:8px;margin-top:4px}" +
      ".mcj-forgot-btn{appearance:none;min-height:44px;border-radius:12px;border:0;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer}" +
      ".mcj-forgot-btn.primary{background:linear-gradient(135deg,#ff8fc5,#ff6aa8);color:#1a0812}" +
      ".mcj-forgot-btn.ghost{background:transparent;color:#ffdceb;border:1px solid rgba(255,160,200,.35)}" +
      ".mcj-forgot-btn:disabled{opacity:.55;cursor:not-allowed}" +
      ".mcj-forgot-msg{min-height:1.2em;margin:8px 0 0;font-size:13px;font-weight:700;color:#ff8fc5;line-height:1.35}" +
      ".mcj-forgot-msg.is-ok{color:#9dffc2}" +
      ".mcj-forgot-toast{position:fixed;left:50%;bottom:max(28px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:13000;padding:12px 18px;border-radius:999px;background:rgba(20,12,18,.94);border:1px solid rgba(255,160,200,.4);color:#ffe6f1;font-size:14px;font-weight:800;box-shadow:0 10px 28px rgba(0,0,0,.4);pointer-events:none}" +
      "@media (max-width:560px){.mcj-forgot-card{padding:20px 16px 18px;border-radius:16px}}";
    document.head.appendChild(css);
  }

  function normalizeRole(role) {
    var r = String(role || "").trim().toLowerCase();
    if (r === "cs" || r === "service" || r === "customer-service") return "customer_service";
    if (r === "player" || r === "pw") return "companion";
    if (r === "customer" || r === "owner" || r === "user") return "boss";
    if (r === "companion" || r === "customer_service" || r === "boss") return r;
    return "boss";
  }

  function inferRole(el) {
    if (!el || !el.getAttribute) return "boss";
    var fromAttr = el.getAttribute("data-forgot-role") || el.getAttribute("data-role");
    if (fromAttr) return normalizeRole(fromAttr);
    var path = String(location.pathname || "");
    if (/\/customer-service\//i.test(path)) return "customer_service";
    if (/\/companion\//i.test(path)) return "companion";
    return "boss";
  }

  function api(action, body) {
    return fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(Object.assign({ action: action, role: state.role }, body || {})),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || (j && j.ok === false)) {
          throw new Error((j && j.message) || "请求失败");
        }
        return j || {};
      });
    });
  }

  function stopCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
    state.countdown = 0;
  }

  function startCountdown(sec) {
    stopCountdown();
    state.countdown = Math.max(0, Number(sec) || COUNTDOWN_SEC);
    paint();
    state.countdownTimer = setInterval(function () {
      state.countdown -= 1;
      if (state.countdown <= 0) {
        stopCountdown();
        state.countdown = 0;
      }
      paint();
    }, 1000);
  }

  function toast(msg) {
    var text = String(msg || "").trim();
    if (!text) return;
    if (window.MCJNotify && typeof window.MCJNotify.push === "function") {
      window.MCJNotify.push("system", "找回密码", text);
      return;
    }
    var el = document.createElement("div");
    el.className = "mcj-forgot-toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 2800);
  }

  function ensureHost() {
    ensureStyles();
    if (state.host && document.body.contains(state.host)) return state.host;
    var host = document.createElement("div");
    host.className = "mcj-forgot-host";
    host.setAttribute("data-mcj-forgot-host", "1");
    host.hidden = true;
    host.addEventListener("click", function (e) {
      if (e.target === host) close();
    });
    document.body.appendChild(host);
    state.host = host;
    return host;
  }

  function setMsg(msg, ok) {
    state.msg = msg || "";
    state.msgOk = !!ok;
  }

  function paint() {
    if (!state.open) return;
    var host = ensureHost();
    host.hidden = false;
    var step = state.step;
    var busy = state.busy;
    var body = "";
    if (step === "phone") {
      body =
        '<label>手机号<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="绑定手机号（Staging 可填邮箱）" value="' +
        esc(state.phone) +
        '" required></label>' +
        '<div class="mcj-forgot-actions">' +
        '<button class="mcj-forgot-btn primary" type="submit" data-forgot-submit' +
        (busy ? " disabled" : "") +
        ">" +
        (busy ? "发送中…" : "发送验证码") +
        "</button>" +
        '<button class="mcj-forgot-btn ghost" type="button" data-forgot-back>返回登录</button>' +
        "</div>";
    } else if (step === "code") {
      var resendLabel =
        state.countdown > 0 ? "重新发送（" + state.countdown + "s）" : "重新发送";
      body =
        '<p class="mcj-forgot-desc">验证码已发送至 ' +
        esc(state.phoneMasked || state.phone) +
        "。请输入 6 位验证码。</p>" +
        '<label>验证码<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" required></label>' +
        '<div class="mcj-forgot-actions">' +
        '<button class="mcj-forgot-btn primary" type="submit" data-forgot-submit' +
        (busy ? " disabled" : "") +
        ">" +
        (busy ? "验证中…" : "验证") +
        "</button>" +
        '<button class="mcj-forgot-btn ghost" type="button" data-forgot-resend' +
        (busy || state.countdown > 0 ? " disabled" : "") +
        ">" +
        resendLabel +
        "</button>" +
        '<button class="mcj-forgot-btn ghost" type="button" data-forgot-back>返回登录</button>' +
        "</div>";
    } else {
      body =
        '<label>新密码<input name="new_password" type="password" autocomplete="new-password" minlength="8" placeholder="至少 8 位" required></label>' +
        '<label>确认新密码<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" placeholder="再次输入新密码" required></label>' +
        '<div class="mcj-forgot-actions">' +
        '<button class="mcj-forgot-btn primary" type="submit" data-forgot-submit' +
        (busy ? " disabled" : "") +
        ">" +
        (busy ? "提交中…" : "设置新密码") +
        "</button>" +
        '<button class="mcj-forgot-btn ghost" type="button" data-forgot-back>返回登录</button>' +
        "</div>";
    }
    host.innerHTML =
      '<form class="mcj-forgot-card" data-forgot-form autocomplete="on">' +
      "<h2>找回密码</h2>" +
      '<p class="mcj-forgot-desc">通过绑定手机号接收短信验证码后重设密码。</p>' +
      body +
      '<p class="mcj-forgot-msg' +
      (state.msgOk ? " is-ok" : "") +
      '" data-forgot-msg>' +
      esc(state.msg) +
      "</p>" +
      "</form>";
  }

  function close() {
    stopCountdown();
    state.open = false;
    state.busy = false;
    state.step = "phone";
    state.phone = "";
    state.phoneMasked = "";
    state.resetToken = "";
    state.msg = "";
    state.msgOk = false;
    if (state.host) {
      state.host.hidden = true;
      state.host.setAttribute("hidden", "");
      state.host.style.display = "none";
      state.host.innerHTML = "";
    }
    var done = state.onDone;
    state.onDone = null;
    if (typeof done === "function") {
      try {
        done();
      } catch (e) {}
    }
  }

  function open(opts) {
    opts = opts || {};
    ensureStyles();
    stopCountdown();
    state.open = true;
    state.role = normalizeRole(opts.role || "boss");
    state.step = "phone";
    state.phone = String(opts.phone || "").trim();
    state.phoneMasked = "";
    state.resetToken = "";
    state.busy = false;
    state.msg = "";
    state.msgOk = false;
    state.onDone = typeof opts.onDone === "function" ? opts.onDone : null;
    var host = ensureHost();
    host.hidden = false;
    host.removeAttribute("hidden");
    host.style.display = "";
    paint();
    setTimeout(function () {
      var input = state.host && state.host.querySelector("input");
      if (input) input.focus();
    }, 40);
  }

  function sendOtp(phone) {
    state.busy = true;
    setMsg("");
    paint();
    return api("forgot_send_otp", { phone: phone, account: phone })
      .then(function (res) {
        state.busy = false;
        state.phone = phone;
        state.phoneMasked = res.phoneMasked || res.emailMasked || phone;
        state.channel = res.channel || "";
        state.step = "code";
        var hint = res.message || "验证码已发送";
        if (res.devCode) hint += "（测试验证码 " + res.devCode + "）";
        setMsg(hint, true);
        startCountdown(COUNTDOWN_SEC);
        paint();
        return res;
      })
      .catch(function (err) {
        state.busy = false;
        setMsg((err && err.message) || "发送失败");
        paint();
        throw err;
      });
  }

  function onSubmit(form) {
    if (state.busy) return;
    var fd = new FormData(form);
    if (state.step === "phone") {
      var phone = String(fd.get("phone") || "").trim();
      if (!phone) {
        setMsg("请输入绑定手机号。");
        paint();
        return;
      }
      if (!/@/.test(phone) && phone.replace(/\D/g, "").length < 7) {
        setMsg("请输入有效的绑定手机号。");
        paint();
        return;
      }
      sendOtp(phone).catch(function () {});
      return;
    }
    if (state.step === "code") {
      var code = String(fd.get("code") || "").trim();
      if (!/^\d{6}$/.test(code)) {
        setMsg("请输入 6 位验证码");
        paint();
        return;
      }
      state.busy = true;
      setMsg("");
      paint();
      api("forgot_verify_otp", { phone: state.phone, account: state.phone, code: code })
        .then(function (res) {
          state.busy = false;
          state.resetToken = res.resetToken || "";
          if (!state.resetToken) {
            setMsg("验证失败，请重试");
            paint();
            return;
          }
          state.step = "reset";
          setMsg(res.message || "验证成功，请设置新密码", true);
          paint();
        })
        .catch(function (err) {
          state.busy = false;
          setMsg((err && err.message) || "验证失败");
          paint();
        });
      return;
    }
    if (state.step === "reset") {
      if (!state.resetToken) {
        setMsg("请先完成手机验证");
        paint();
        return;
      }
      var np = String(fd.get("new_password") || "");
      var cp = String(fd.get("confirm_password") || "");
      if (np.length < 8) {
        setMsg("新密码至少 8 位");
        paint();
        return;
      }
      if (np !== cp) {
        setMsg("两次输入的新密码不一致");
        paint();
        return;
      }
      state.busy = true;
      setMsg("");
      paint();
      api("forgot_reset_password", {
        phone: state.phone,
        account: state.phone,
        newPassword: np,
        confirmPassword: cp,
        resetToken: state.resetToken,
      })
        .then(function () {
          state.busy = false;
          toast(SUCCESS_TOAST);
          close();
        })
        .catch(function (err) {
          state.busy = false;
          setMsg((err && err.message) || "重置失败");
          paint();
        });
    }
  }

  function onHostClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-forgot-back]")) {
      e.preventDefault();
      close();
      return;
    }
    if (t.closest("[data-forgot-resend]")) {
      e.preventDefault();
      if (state.busy || state.countdown > 0 || !state.phone) return;
      sendOtp(state.phone).catch(function () {});
    }
  }

  function onHostSubmit(e) {
    var form = e.target && e.target.closest && e.target.closest("[data-forgot-form]");
    if (!form) return;
    e.preventDefault();
    e.stopPropagation();
    onSubmit(form);
  }

  function bindDocument() {
    if (window.__MCJForgotBound) return;
    window.__MCJForgotBound = true;
    document.addEventListener(
      "click",
      function (e) {
        var btn = e.target && e.target.closest && e.target.closest("[data-forgot-password]");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        open({ role: inferRole(btn) });
      },
      true
    );
    document.addEventListener(
      "click",
      function (e) {
        if (!state.open || !state.host) return;
        if (!state.host.contains(e.target)) return;
        onHostClick(e);
      },
      true
    );
    document.addEventListener(
      "submit",
      function (e) {
        if (!state.open || !state.host) return;
        if (!state.host.contains(e.target)) return;
        onHostSubmit(e);
      },
      true
    );
  }

  bindDocument();

  window.MCJForgotPassword = {
    open: open,
    close: close,
    normalizeRole: normalizeRole,
    SUCCESS_TOAST: SUCCESS_TOAST,
  };
})();
