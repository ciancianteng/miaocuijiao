(function () {
  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function authFetch() {
    return window.MCJAdminAuthFetch || null;
  }

  function formatTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function request(action, body) {
    var api = authFetch();
    if (!api || !api.post) return Promise.reject(new Error("未登录或鉴权模块不可用。"));
    return api.post("/api/auth", Object.assign({ action: action }, body || {}));
  }

  function loadMe() {
    var api = authFetch();
    if (!api) return Promise.reject(new Error("未登录或鉴权模块不可用。"));
    var ready = api.ensureValidToken ? api.ensureValidToken() : Promise.resolve();
    return ready.then(function () {
      if (!api.get) return Promise.reject(new Error("鉴权模块不可用。"));
      return api.get("/api/auth?action=me");
    }).then(function (data) {
      return (data && data.user) || {};
    });
  }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#ff8ea6" : "rgba(255,255,255,.68)";
  }

  function renderProfile(user) {
    var mount = document.getElementById("adminProfileMount");
    if (!mount) return;
    user = user || {};
    mount.innerHTML =
      '<form class="admin-self-form" data-admin-profile-form>' +
      '<div class="form-grid">' +
      '<label class="wide"><span>头像 URL</span><input name="avatarUrl" value="' + esc(user.avatarUrl || "") + '" placeholder="https://..."></label>' +
      '<label><span>昵称</span><input name="displayName" value="' + esc(user.displayName || "") + '" required maxlength="40"></label>' +
      '<label><span>邮箱</span><input name="email" type="email" value="' + esc(user.email || "") + '" required></label>' +
      '<label><span>手机号</span><input name="phone" value="' + esc(user.phone || "") + '" maxlength="30"></label>' +
      '<label><span>最近登录时间</span><input value="' + esc(formatTime(user.lastSignInAt)) + '" readonly></label>' +
      "</div>" +
      '<div class="row" style="margin-top:14px;gap:12px;align-items:center">' +
      '<button class="primary-btn" type="submit">保存</button>' +
      '<span data-admin-profile-msg></span>' +
      "</div>" +
      "</form>";
  }

  function renderPassword() {
    var mount = document.getElementById("adminPasswordMount");
    if (!mount) return;
    mount.innerHTML =
      '<form class="admin-self-form" data-admin-password-form>' +
      '<p style="margin:0 0 10px;color:rgba(255,255,255,.62);font-size:13px">密码至少 8 位，须同时包含字母和数字。其他管理员无法查看你的密码。</p>' +
      '<div class="form-grid">' +
      '<label><span>当前密码</span><input name="currentPassword" type="password" required autocomplete="current-password"></label>' +
      '<label><span>新密码</span><input name="newPassword" type="password" required minlength="8" autocomplete="new-password"></label>' +
      '<label><span>确认密码</span><input name="confirmPassword" type="password" required minlength="8" autocomplete="new-password"></label>' +
      "</div>" +
      '<div class="row" style="margin-top:14px;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<button class="primary-btn" type="submit">保存</button>' +
      '<button class="ghost-btn" type="button" data-admin-forgot-password>忘记密码</button>' +
      '<button class="ghost-btn" type="button" data-admin-revoke-sessions>注销其他登录设备</button>' +
      '<span data-admin-password-msg></span>' +
      "</div>" +
      "</form>";
  }

  function updateToggleLabel(user) {
    var btn = document.querySelector("[data-admin-profile-toggle]");
    if (!btn) return;
    var role = String((user && user.role) || "").toLowerCase();
    btn.textContent = role === "admin" ? "超级管理员" : "管理员";
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var forgot = e.target.closest("[data-admin-forgot-password]");
      if (forgot) {
        e.preventDefault();
        function openForgot() {
          if (window.MCJForgotPassword && window.MCJForgotPassword.open) {
            window.MCJForgotPassword.open({ role: "admin" });
            return;
          }
          alert("请到登录页使用忘记密码。");
        }
        if (!window.MCJForgotPassword) {
          var s = document.createElement("script");
          s.src = "/src/forgot-password.js?v=20260805acctSec1";
          s.onload = openForgot;
          document.head.appendChild(s);
        } else openForgot();
        return;
      }
      var revoke = e.target.closest("[data-admin-revoke-sessions]");
      if (revoke) {
        e.preventDefault();
        if (!confirm("确认注销全部登录会话？当前设备也需要重新登录。")) return;
        request("revoke_sessions", {})
          .then(function (data) {
            alert(data.message || "已注销全部会话");
            location.href = "/admin/login/";
          })
          .catch(function (err) {
            alert(err.message || "操作失败");
          });
      }
    });
    document.addEventListener("submit", function (e) {
      var profileForm = e.target.closest("[data-admin-profile-form]");
      if (profileForm) {
        e.preventDefault();
        var fd = new FormData(profileForm);
        var msg = profileForm.querySelector("[data-admin-profile-msg]");
        var btn = profileForm.querySelector('[type="submit"]');
        setMsg(msg, "保存中…", false);
        if (btn) btn.disabled = true;
        request("update_profile", {
          displayName: String(fd.get("displayName") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phone: String(fd.get("phone") || "").trim(),
          avatarUrl: String(fd.get("avatarUrl") || "").trim(),
        })
          .then(function (data) {
            setMsg(msg, data.message || "资料已保存", false);
            if (data.user) {
              updateToggleLabel(data.user);
              renderProfile(data.user);
            }
          })
          .catch(function (err) {
            setMsg(msg, err.message || "保存失败", true);
          })
          .then(function () {
            if (btn) btn.disabled = false;
          });
        return;
      }

      var passwordForm = e.target.closest("[data-admin-password-form]");
      if (passwordForm) {
        e.preventDefault();
        var pfd = new FormData(passwordForm);
        var currentPassword = String(pfd.get("currentPassword") || "");
        var newPassword = String(pfd.get("newPassword") || "");
        var confirmPassword = String(pfd.get("confirmPassword") || "");
        var pmsg = passwordForm.querySelector("[data-admin-password-msg]");
        var pbtn = passwordForm.querySelector('[type="submit"]');
        if (newPassword !== confirmPassword) {
          setMsg(pmsg, "两次输入的新密码不一致。", true);
          return;
        }
        setMsg(pmsg, "保存中…", false);
        if (pbtn) pbtn.disabled = true;
        request("change_password", {
          currentPassword: currentPassword,
          newPassword: newPassword,
          confirmPassword: confirmPassword,
        })
          .then(function (data) {
            setMsg(pmsg, data.message || "密码已更新", false);
            passwordForm.reset();
          })
          .catch(function (err) {
            setMsg(pmsg, err.message || "修改失败", true);
          })
          .then(function () {
            if (pbtn) pbtn.disabled = false;
          });
      }
    });
  }

  function init() {
    renderPassword();
    bind();
    loadMe()
      .then(function (user) {
        updateToggleLabel(user);
        renderProfile(user);
      })
      .catch(function (err) {
        var mount = document.getElementById("adminProfileMount");
        if (mount) mount.innerHTML = '<div class="empty">' + esc(err.message || "无法加载管理员资料") + "</div>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
