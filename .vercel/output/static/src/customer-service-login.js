(function () {
  "use strict";
  // Login-page only: never remount the static form, never call paint/innerHTML.
  if (window.__MCJCsLoginOnly) return;
  window.__MCJCsLoginOnly = true;

  var SESSION_KEY = "mcjServiceSession";
  var root = document.getElementById("serviceApp");
  var form = root && root.querySelector("form[data-login]");
  if (!form) return;

  var draft = {
    account: "",
    password: "",
    remember: !!(form.elements.remember && form.elements.remember.checked),
  };

  function readSession() {
    try {
      return JSON.parse(
        localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null"
      );
    } catch (e) {
      return null;
    }
  }

  // Already logged in → leave login page (after session restore/refresh).
  function goDashboardIfLoggedIn() {
    var existing = readSession();
    var has =
      (window.MCJServiceAuth && window.MCJServiceAuth.hasSession && window.MCJServiceAuth.hasSession()) ||
      (existing && (existing.token || existing.accessToken || existing.refreshToken));
    if (has) {
      location.replace("/customer-service/dashboard/");
      return true;
    }
    return false;
  }
  if (window.MCJServiceAuth && typeof window.MCJServiceAuth.ensureSession === "function") {
    window.MCJServiceAuth.ensureSession().then(function () {
      goDashboardIfLoggedIn();
    }).catch(function () {
      goDashboardIfLoggedIn();
    });
  } else if (goDashboardIfLoggedIn()) {
    return;
  }

  function captureDraft() {
    if (!form) return;
    draft.account = form.elements.account ? String(form.elements.account.value || "") : draft.account;
    draft.password = form.elements.password
      ? String(form.elements.password.value || "")
      : draft.password;
    draft.remember = !!(form.elements.remember && form.elements.remember.checked);
  }

  function restoreDraft() {
    if (!form) return;
    if (form.elements.account && draft.account !== form.elements.account.value) {
      form.elements.account.value = draft.account;
    }
    if (form.elements.password && draft.password !== form.elements.password.value) {
      form.elements.password.value = draft.password;
    }
    if (form.elements.remember) {
      form.elements.remember.checked = !!draft.remember;
    }
  }

  function setError(msg) {
    var box = form && form.querySelector("[data-auth-error]");
    if (box) box.textContent = msg || "";
  }

  function bindPasswordToggle() {
    if (window.__MCJCsAuthTogglesBound) return;
    window.__MCJCsAuthTogglesBound = true;
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-toggle-password]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var wrap = btn.closest(".mcj-auth-password, .password-field") || btn.parentElement;
      var input =
        wrap && wrap.querySelector('input[name="password"], input[type="password"], input[type="text"]');
      if (!input) return;
      captureDraft();
      var value = input.value;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      input.value = value;
      draft.password = value;
      btn.textContent = show ? "隐藏" : "显示";
    });
  }

  bindPasswordToggle();

  form.addEventListener(
    "input",
    function () {
      captureDraft();
    },
    true
  );
  form.addEventListener(
    "change",
    function () {
      captureDraft();
    },
    true
  );

  var nativeReset = form.reset.bind(form);
  form.reset = function () {
    captureDraft();
  };
  form.addEventListener("reset", function (e) {
    e.preventDefault();
    e.stopPropagation();
    restoreDraft();
  });

  if (typeof MutationObserver === "function") {
    var mo = new MutationObserver(function () {
      var next = root.querySelector("form[data-login]");
      if (!next) return;
      if (next !== form) {
        form = next;
        form.reset = function () {};
        form.addEventListener(
          "input",
          function () {
            captureDraft();
          },
          true
        );
        form.addEventListener(
          "change",
          function () {
            captureDraft();
          },
          true
        );
        form.addEventListener("submit", onSubmit);
        form.addEventListener("reset", function (e) {
          e.preventDefault();
          restoreDraft();
        });
      }
      restoreDraft();
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  var guardTimer = setInterval(function () {
    if (!document.body || !root.isConnected) {
      clearInterval(guardTimer);
      return;
    }
    form = root.querySelector("form[data-login]") || form;
    if (!form) return;
    var a = form.elements.account;
    var p = form.elements.password;
    if (a && draft.account && !a.value) a.value = draft.account;
    if (p && draft.password && !p.value) p.value = draft.password;
    if (a && a.value) draft.account = String(a.value);
    if (p && p.value) draft.password = String(p.value);
  }, 400);

  function ensureRoleGate() {
    return new Promise(function (resolve, reject) {
      if (window.MCJRoleGate && typeof window.MCJRoleGate.loginPortal === "function") {
        resolve(window.MCJRoleGate);
        return;
      }
      var existing = document.querySelector('script[src*="role-gates.js"]');
      if (!existing) {
        var s = document.createElement("script");
        s.src = "/src/role-gates.js";
        s.onload = function () {
          if (window.MCJRoleGate) resolve(window.MCJRoleGate);
          else reject(new Error("登录模块加载失败"));
        };
        s.onerror = function () {
          reject(new Error("登录模块加载失败"));
        };
        document.head.appendChild(s);
        return;
      }
      var tries = 0;
      var t = setInterval(function () {
        tries += 1;
        if (window.MCJRoleGate && typeof window.MCJRoleGate.loginPortal === "function") {
          clearInterval(t);
          resolve(window.MCJRoleGate);
        } else if (tries > 40) {
          clearInterval(t);
          reject(new Error("登录模块加载失败"));
        }
      }, 50);
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    captureDraft();
    var account = String(draft.account || "").trim();
    var password = String(draft.password || "");
    var remember = !!draft.remember;
    var btn = form.querySelector('[type="submit"]');
    if (!account || !password) {
      setError("请输入邮箱和密码。");
      restoreDraft();
      return;
    }
    setError("");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "登录中…";
    }
    ensureRoleGate()
      .then(function (Gate) {
        return Gate.loginPortal("customer_service", account, password, remember);
      })
      .then(function (body) {
        clearInterval(guardTimer);
        if (window.MCJServiceAuth && typeof window.MCJServiceAuth.saveSession === "function" && body && body.session) {
          window.MCJServiceAuth.saveSession(body.session, remember !== false);
        }
        location.assign("/customer-service/dashboard/");
      })
      .catch(function (err) {
        var msg = (window.MCJRoleGate && window.MCJRoleGate.humanizeAuthError)
          ? window.MCJRoleGate.humanizeAuthError(err)
          : (err && err.message) || "账号或密码错误。";
        setError(msg);
        restoreDraft();
        if (btn) {
          btn.disabled = false;
          btn.textContent = "登录";
        }
      });
  }

  form.addEventListener("submit", onSubmit);
  void nativeReset;

  // Forgot password: shared MCJForgotPassword (src/forgot-password.js) binds [data-forgot-password].
})();
