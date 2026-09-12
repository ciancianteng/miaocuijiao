/**
 * Shared account-security UI for boss (mine) and companion account pages.
 * Never stores or displays password plaintext beyond the input fields.
 */
(function () {
  "use strict";
  if (window.MCJAccountSecurity) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTime(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(v);
    }
  }

  function authToken(opts) {
    opts = opts || {};
    try {
      if (opts.token) return opts.token;
      if (opts.role === "companion") {
        return (
          sessionStorage.getItem("companionAuthToken") ||
          localStorage.getItem("companionAuthToken") ||
          ""
        );
      }
      return (
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        sessionStorage.getItem("customerAuthToken") ||
        localStorage.getItem("customerAuthToken") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function postAuth(action, body, token) {
    return fetch("/api/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(Object.assign({ action: action }, body || {})),
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (json) {
        if (!res.ok || json.ok === false) {
          var err = new Error(json.message || "操作失败");
          err.code = json.code || "";
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  function renderPanel(user, opts) {
    opts = opts || {};
    user = user || {};
    var hasPwd = user.hasPassword === true || user.has_password === true;
    var hint = opts.passwordHint || "至少 8 位，须同时包含字母和数字";
    var role = opts.role || user.role || "boss";
    var forgotRole = role === "companion" ? "companion" : role === "admin" || role === "super_admin" ? "admin" : "boss";
    var statusBlock =
      '<div class="mcj-sec-grid">' +
      '<div><span>是否已设置密码</span><strong>' +
      (hasPwd ? "是" : "尚未设置密码") +
      "</strong></div>" +
      "<div><span>注册邮箱</span><strong>" +
      esc(user.email || "-") +
      "</strong></div>" +
      "<div><span>最后登录时间</span><strong>" +
      esc(fmtTime(user.lastLoginAt || user.last_login_at || user.lastSignInAt)) +
      "</strong></div>" +
      "<div><span>最近密码修改时间</span><strong>" +
      esc(fmtTime(user.passwordSetAt || user.password_set_at)) +
      "</strong></div>" +
      "</div>";

    var formHtml;
    if (!hasPwd) {
      formHtml =
        '<form class="mcj-sec-form" data-sec-set-password>' +
        "<h4>设置密码</h4>" +
        '<p class="mcj-sec-hint">设置后可用邮箱+密码登录。' +
        esc(hint) +
        "</p>" +
        '<label>新密码<input name="newPassword" type="password" autocomplete="new-password" required minlength="8"></label>' +
        '<label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8"></label>' +
        '<button type="submit">设置密码</button>' +
        '<p class="mcj-sec-msg" data-sec-msg hidden></p>' +
        "</form>";
    } else {
      formHtml =
        '<form class="mcj-sec-form" data-sec-change-password>' +
        "<h4>修改密码</h4>" +
        '<p class="mcj-sec-hint">' +
        esc(hint) +
        "。修改后其他设备将退出登录。</p>" +
        '<label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label>' +
        '<label>新密码<input name="newPassword" type="password" autocomplete="new-password" required minlength="8"></label>' +
        '<label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8"></label>' +
        '<button type="submit">修改密码</button>' +
        '<p class="mcj-sec-msg" data-sec-msg hidden></p>' +
        "</form>";
    }

    var actions =
      '<div class="mcj-sec-actions">' +
      '<button type="button" class="mcj-sec-link" data-sec-forgot data-forgot-role="' +
      esc(forgotRole) +
      '">忘记密码</button>' +
      '<button type="button" class="mcj-sec-link danger" data-sec-revoke>注销其他登录设备</button>' +
      "</div>";

    return (
      '<section class="mcj-account-security" data-account-security data-sec-role="' +
      esc(role) +
      '">' +
      "<h3>账号安全</h3>" +
      statusBlock +
      formHtml +
      actions +
      "</section>"
    );
  }

  function ensureStyles() {
    if (document.getElementById("mcjAccountSecurityCss")) return;
    var style = document.createElement("style");
    style.id = "mcjAccountSecurityCss";
    style.textContent =
      ".mcj-account-security{margin-top:18px;padding:18px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04)}" +
      ".mcj-account-security h3{margin:0 0 12px;font-size:18px}" +
      ".mcj-account-security h4{margin:16px 0 8px;font-size:15px}" +
      ".mcj-sec-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
      ".mcj-sec-grid div{padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06)}" +
      ".mcj-sec-grid span{display:block;color:#9ca3af;font-size:12px;margin-bottom:4px}" +
      ".mcj-sec-grid strong{color:#ffe7f2;font-size:14px;word-break:break-all}" +
      ".mcj-sec-form{display:grid;gap:10px;margin-top:8px;max-width:420px}" +
      ".mcj-sec-form label{display:grid;gap:6px;font-size:13px;color:#cdb8c4}" +
      ".mcj-sec-form input{min-height:42px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.28);color:#fff;padding:0 12px}" +
      ".mcj-sec-form button,.mcj-sec-actions button{min-height:40px;border-radius:10px;border:1px solid rgba(243,168,203,.35);background:rgba(243,168,203,.16);color:#fff;font-weight:700;cursor:pointer;padding:0 14px}" +
      ".mcj-sec-hint{margin:0;color:#9ca3af;font-size:12px;line-height:1.5}" +
      ".mcj-sec-msg{margin:0;font-size:13px}.mcj-sec-msg.err{color:#ff8fab}.mcj-sec-msg.ok{color:#86efac}" +
      ".mcj-sec-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}" +
      ".mcj-sec-link{background:transparent!important}.mcj-sec-link.danger{border-color:rgba(248,113,113,.45);color:#fecaca}" +
      "@media(max-width:640px){.mcj-sec-grid{grid-template-columns:1fr}}";
    document.head.appendChild(style);
  }

  function setMsg(root, text, isErr) {
    var el = root.querySelector("[data-sec-msg]");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("err", !!isErr);
    el.classList.toggle("ok", !isErr && !!text);
  }

  function saveSessionIfPossible(session, role) {
    if (!session || !session.accessToken) return;
    try {
      if (window.MCJRoleGate && typeof window.MCJRoleGate.saveSession === "function") {
        window.MCJRoleGate.saveSession(
          {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt,
            user: session.user,
          },
          true
        );
        return;
      }
      if (role === "companion") {
        localStorage.setItem("companionAuthToken", session.accessToken);
        sessionStorage.setItem("companionAuthToken", session.accessToken);
        if (session.user) {
          localStorage.setItem("companionUser", JSON.stringify(session.user));
          sessionStorage.setItem("companionUser", JSON.stringify(session.user));
        }
      }
    } catch (e) {}
  }

  function bind(root, opts) {
    if (!root || root.dataset.secBound === "1") return;
    root.dataset.secBound = "1";
    ensureStyles();
    opts = opts || {};
    var role = root.getAttribute("data-sec-role") || opts.role || "boss";

    root.addEventListener("submit", function (e) {
      var setForm = e.target.closest("[data-sec-set-password]");
      var changeForm = e.target.closest("[data-sec-change-password]");
      if (!setForm && !changeForm) return;
      e.preventDefault();
      var form = setForm || changeForm;
      var fd = new FormData(form);
      var token = authToken({ role: role, token: opts.token });
      var payload = {
        newPassword: String(fd.get("newPassword") || ""),
        confirmPassword: String(fd.get("confirmPassword") || ""),
      };
      if (changeForm) payload.currentPassword = String(fd.get("currentPassword") || "");
      setMsg(form, "保存中…", false);
      var btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      postAuth(setForm ? "set_password" : "change_password", payload, token)
        .then(function (data) {
          setMsg(form, data.message || "已保存", false);
          if (data.session) saveSessionIfPossible(data.session, role);
          form.reset();
          if (typeof opts.onUpdated === "function") opts.onUpdated(data);
          else if (opts.reload !== false) setTimeout(function () {
            location.reload();
          }, 700);
        })
        .catch(function (err) {
          setMsg(form, err.message || "操作失败", true);
        })
        .then(function () {
          if (btn) btn.disabled = false;
        });
    });

    root.addEventListener("click", function (e) {
      var forgot = e.target.closest("[data-sec-forgot]");
      if (forgot) {
        e.preventDefault();
        var fr = forgot.getAttribute("data-forgot-role") || role;
        function openForgot() {
          if (window.MCJForgotPassword && typeof window.MCJForgotPassword.open === "function") {
            window.MCJForgotPassword.open({ role: fr });
            return;
          }
          alert("请到登录页使用「忘记密码」。");
        }
        if (!window.MCJForgotPassword) {
          var s = document.createElement("script");
          s.src = "/src/forgot-password.js?v=20260805acctSec1";
          s.onload = openForgot;
          document.head.appendChild(s);
        } else openForgot();
        return;
      }
      var revoke = e.target.closest("[data-sec-revoke]");
      if (revoke) {
        e.preventDefault();
        if (!confirm("确认注销全部登录会话？当前设备也需要重新登录。")) return;
        var token = authToken({ role: role, token: opts.token });
        postAuth("revoke_sessions", {}, token)
          .then(function (data) {
            alert(data.message || "已注销全部会话");
            try {
              if (window.MCJRoleGate && window.MCJRoleGate.logout) window.MCJRoleGate.logout();
            } catch (err) {}
            location.href = role === "companion" ? "/companion/" : "/";
          })
          .catch(function (err) {
            alert(err.message || "操作失败");
          });
      }
    });
  }

  function mount(target, user, opts) {
    ensureStyles();
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return null;
    el.innerHTML = renderPanel(user, opts);
    var panel = el.querySelector("[data-account-security]") || el;
    bind(panel, opts);
    return panel;
  }

  window.MCJAccountSecurity = {
    render: renderPanel,
    mount: mount,
    bind: bind,
    load: function (opts) {
      opts = opts || {};
      var token = authToken(opts);
      return postAuth("account_security", {}, token);
    },
  };
})();
