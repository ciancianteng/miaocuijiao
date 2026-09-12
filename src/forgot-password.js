/**
 * Shared email-OTP password recovery for boss / companion / customer_service.
 * API: POST /api/auth  { action: forgot_send_otp | forgot_verify_otp | forgot_reset_password, role, email, ... }
 * MVP: email only (SMS reserved for later).
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
    step: "email",
    email: "",
    emailMasked: "",
    resetToken: "",
    busy: false,
    msg: "",
    msgOk: false,
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
      ".mcj-forgot-card{width:min(460px,100%);min-height:min(420px,88dvh);max-height:min(92dvh,920px);overflow:auto;margin:auto;padding:28px 24px 24px;border-radius:20px;border:1px solid rgba(255,160,200,.28);background:linear-gradient(165deg,rgba(36,20,32,.98),rgba(12,10,16,.98));box-shadow:0 18px 48px rgba(0,0,0,.45);color:#f7f7fb;font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif}" +
      ".mcj-forgot-card h2{margin:0 0 8px;font-size:1.35rem;font-weight:800;color:#ffe6f1}" +
      ".mcj-forgot-card .mcj-forgot-desc{margin:0 0 20px;font-size:14px;line-height:1.5;color:rgba(255,220,235,.78)}" +
      ".mcj-forgot-card label{display:flex;flex-direction:column;gap:8px;margin:0 0 18px;font-size:13px;font-weight:700;color:#ffd6e7}" +
      ".mcj-forgot-card input{appearance:none;width:100%;box-sizing:border-box;min-height:52px;padding:10px 14px;border-radius:14px;border:1px solid rgba(255,160,200,.28);background:rgba(8,8,12,.75);color:#fff;font-size:15px;font-family:inherit}" +
      ".mcj-forgot-card input:focus{outline:none;border-color:rgba(255,143,197,.75);box-shadow:0 0 0 2px rgba(255,143,197,.22)}" +
      ".mcj-forgot-actions{display:flex;flex-direction:column;gap:10px;margin-top:6px}" +
      ".mcj-forgot-btn{appearance:none;min-height:52px;border-radius:14px;border:0;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer}" +
      ".mcj-forgot-btn.primary{background:linear-gradient(135deg,#ff8fc5,#ff6aa8);color:#1a0812}" +
      ".mcj-forgot-btn.ghost{background:transparent;color:#ffdceb;border:1px solid rgba(255,160,200,.35)}" +
      ".mcj-forgot-btn:disabled{opacity:.55;cursor:not-allowed}" +
      ".mcj-forgot-msg{min-height:1.2em;margin:10px 0 0;font-size:13px;font-weight:700;color:#ff8fc5;line-height:1.35}" +
      ".mcj-forgot-msg.is-ok{color:#9dffc2}" +
      ".mcj-forgot-toast{position:fixed;left:50%;bottom:max(28px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:13000;padding:12px 18px;border-radius:999px;background:rgba(20,12,18,.94);border:1px solid rgba(255,160,200,.4);color:#ffe6f1;font-size:14px;font-weight:800;box-shadow:0 10px 28px rgba(0,0,0,.4);pointer-events:none}" +
      "@media (max-width:560px){.mcj-forgot-card{min-height:0;padding:24px 18px 20px;border-radius:18px}}";
    document.head.appendChild(css);
  }

  function normalizeRole(role) {
    var r = String(role || "").trim().toLowerCase();
    if (r === "cs" || r === "service" || r === "customer-service") return "customer_service";
    if (r === "player" || r === "pw") return "companion";
    if (r === "customer" || r === "owner" || r === "user") return "boss";
    if (r === "super_admin" || r === "superadmin") return "admin";
    if (r === "companion" || r === "customer_service" || r === "boss" || r === "admin") return r;
    return "boss";
  }

  function inferRole(el) {
    if (!el || !el.getAttribute) return "boss";
    var fromAttr = el.getAttribute("data-forgot-role") || el.getAttribute("data-role");
    if (fromAttr) return normalizeRole(fromAttr);
    var path = String(location.pathname || "");
    if (/\/customer-service\//i.test(path)) return "customer_service";
    if (/\/companion\//i.test(path)) return "companion";
    if (/\/admin/i.test(path)) return "admin";
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
      try {
        el.remove();
      } catch (e) {}
    }, 2600);
  }

  function setMsg(msg, ok) {
    state.msg = String(msg || "");
    state.msgOk = !!ok;
  }

  function ensureHost() {
    if (state.host && state.host.isConnected) return state.host;
    var host = document.createElement("div");
    host.className = "mcj-forgot-host";
    host.setAttribute("data-mcj-forgot-host", "1");
    host.hidden = true;
    document.body.appendChild(host);
    state.host = host;
    host.addEventListener("click", function (e) {
      if (e.target === host) close();
    });
    host.addEventListener("submit", function (e) {
      var form = e.target && e.target.closest && e.target.closest("[data-forgot-form]");
      if (!form) return;
      e.preventDefault();
      onSubmit(form);
    });
    host.addEventListener("click", function (e) {
      if (e.target.closest("[data-forgot-back]")) {
        e.preventDefault();
        close();
        return;
      }
      if (e.target.closest("[data-forgot-resend]")) {
        e.preventDefault();
        if (state.busy || state.countdown > 0) return;
        sendOtp(state.email).catch(function () {});
      }
    });
    return host;
  }

  function paint() {
    if (!state.open) return;
    var host = ensureHost();
    host.hidden = false;
    var step = state.step;
    var busy = state.busy;
    var body = "";
    if (step === "email" || step === "phone") {
      body =
        '<label>邮箱<input name="email" type="email" inputmode="email" autocomplete="email" placeholder="请输入绑定邮箱" value="' +
        esc(state.email) +
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
      var resendLabel = state.countdown > 0 ? "重新发送（" + state.countdown + "s）" : "重新发送";
      body =
        '<p class="mcj-forgot-desc">验证码已发送至 ' +
        esc(state.emailMasked || state.email) +
        "。请输入 6 位验证码。</p>" +
        '<label>验证码<input name="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-auth-code="1" data-auth-sensitive="1" placeholder="000000" required value=""></label>' +
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
      '<p class="mcj-forgot-desc">通过绑定邮箱接收验证码后重设密码（MVP 不使用短信）。</p>' +
      body +
      '<p class="mcj-forgot-msg' +
      (state.msgOk ? " is-ok" : "") +
      '" data-forgot-msg>' +
      esc(state.msg) +
      "</p>" +
      "</form>";
  }

  function close(opts) {
    opts = opts || {};
    stopCountdown();
    state.open = false;
    state.busy = false;
    state.step = "email";
    state.email = "";
    state.emailMasked = "";
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
    if (opts.ok && typeof done === "function") {
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
    state.step = "email";
    state.email = String(opts.email || opts.phone || "").trim();
    state.emailMasked = "";
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
    if (window.MCJAuthShell && typeof window.MCJAuthShell.prepareAuthForm === "function") {
      window.MCJAuthShell.prepareAuthForm(host, { clearAccount: !state.email, keepErrors: false });
    }
    setTimeout(function () {
      var input = state.host && state.host.querySelector("input");
      if (input) input.focus();
    }, 40);
  }

  function sendOtp(email) {
    state.busy = true;
    setMsg("");
    paint();
    return api("forgot_send_otp", { email: email, account: email })
      .then(function (res) {
        state.busy = false;
        state.email = email;
        state.emailMasked = res.emailMasked || email;
        state.channel = res.channel || "email";
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
    if (state.step === "email" || state.step === "phone") {
      var email = String(fd.get("email") || fd.get("phone") || "").trim();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        setMsg("请输入有效邮箱。");
        paint();
        return;
      }
      sendOtp(email).catch(function () {});
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
      api("forgot_verify_otp", { email: state.email, account: state.email, code: code })
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
        setMsg("请先完成邮箱验证");
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
        email: state.email,
        account: state.email,
        resetToken: state.resetToken,
        newPassword: np,
        confirmPassword: cp,
      })
        .then(function (res) {
          state.busy = false;
          toast(res.message || SUCCESS_TOAST);
          close({ ok: true });
        })
        .catch(function (err) {
          state.busy = false;
          setMsg((err && err.message) || "重设失败");
          paint();
        });
    }
  }

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

  window.MCJForgotPassword = {
    open: open,
    close: close,
    SUCCESS_TOAST: SUCCESS_TOAST,
  };
})();
