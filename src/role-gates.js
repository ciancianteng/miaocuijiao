(function () {
  var SESSION_VERSION = "v3";
  var DEV_ADMIN_ACCOUNT = "admin@test.com";
  var DEV_ADMIN_PASSWORD = "12345678";
  var routes = {
    customer: { token: "customerAuthToken", user: "customerUser", login: "/index.html", allowed: [/\/index\.html$/, /\/$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/service-select\.html$/, /\/custom-order\.html$/, /\/more-gameplays\.html$/, /\/companion-apply\.html$/, /\/companion-deposit\.html$/, /\/activities\.html$/] },
    companion: { token: "companionAuthToken", user: "companionUser", login: "/companion/index.html", allowed: [/\/companion\//] },
    customer_service: { token: "customerServiceAuthToken", user: "customerServiceUser", login: "/customer-service/index.html", allowed: [/\/customer-service\//] },
    admin: { token: "adminAuthToken", user: "adminUser", login: "/admin/index.html", allowed: [/\/admin\//] }
  };

  function path() {
    return location.pathname.replace(/\\/g, "/");
  }

  function isAllowed(role) {
    var cfg = routes[role];
    if (!cfg) return true;
    return cfg.allowed.some(function (rule) { return rule.test(path()); });
  }

  function isLogged(role) {
    var cfg = routes[role];
    var token = cfg && localStorage.getItem(cfg.token);
    return Boolean(token && token.indexOf(role + "_session_" + SESSION_VERSION + "_") === 0);
  }

  function isLocalDevHost() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "::1";
  }

  function setLoginMessage(anchor, message) {
    var box = document.getElementById("loginState") || document.querySelector("[data-login-error]");
    if (!box && anchor && anchor.parentNode) {
      box = document.createElement("p");
      box.setAttribute("data-login-error", "true");
      box.style.margin = "10px 0 0";
      box.style.color = "#ff8fc5";
      box.style.fontSize = "13px";
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    if (box) box.textContent = message;
  }

  function createDevAdminSession(account) {
    var cfg = routes.admin;
    var now = Date.now();
    var adminUser = {
      id: "dev_admin",
      account: account,
      user_id: "dev_admin",
      name: "\u5f00\u53d1\u7ba1\u7406\u5458",
      role: "admin",
      adminRole: "super_admin",
      permissions: ["super_admin"],
      devOnly: true
    };
    localStorage.setItem(cfg.token, "admin_session_" + SESSION_VERSION + "_" + now);
    localStorage.setItem(cfg.user, JSON.stringify(adminUser));
    localStorage.setItem("mcjRole", "super_admin");
    localStorage.setItem("mcjDevAdminLogin", "localhost");
    return adminUser;
  }

  function loginWithPassword(account, password) {
    var normalized = String(account || "").trim().toLowerCase();
    if (!isLocalDevHost()) return { ok: false, message: "\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\u3002" };
    if (normalized === DEV_ADMIN_ACCOUNT && String(password || "") === DEV_ADMIN_PASSWORD) {
      return { ok: true, role: "admin", redirect: "admin.html", user: createDevAdminSession(normalized) };
    }
    return { ok: false, message: "\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\u3002" };
  }

  function fieldValue(ids) {
    for (var i = 0; i < ids.length; i += 1) {
      var el = document.getElementById(ids[i]);
      if (el) return el.value || "";
    }
    return "";
  }

  function bindDevAdminLogin() {
    if (!isLocalDevHost()) return;
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest && event.target.closest("[data-login-confirm]");
      if (!target) return;
      var account = fieldValue(["loginGmail", "loginEmail", "adminEmail", "email"]);
      var password = fieldValue(["loginGmailCode", "loginPassword", "adminPassword", "password"]);
      if (String(account || "").trim().toLowerCase() !== DEV_ADMIN_ACCOUNT) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      var result = loginWithPassword(account, password);
      if (!result.ok) {
        setLoginMessage(target, result.message);
        return;
      }
      location.href = result.redirect;
    }, true);
  }

  function user(role) {
    var cfg = routes[role];
    try { return JSON.parse(localStorage.getItem(cfg.user) || "{}"); } catch (e) { return {}; }
  }

  function customerNumber(account) {
    var key = "mcjCustomerIdMap.v1";
    var counterKey = "mcjCustomerIdCounter.v1";
    var map = {};
    try { map = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { map = {}; }
    if (!map[account]) {
      var next = Number(localStorage.getItem(counterKey) || 0) + 1;
      map[account] = "MCJ" + String(next).padStart(6, "0");
      localStorage.setItem(counterKey, String(next));
      localStorage.setItem(key, JSON.stringify(map));
    }
    return map[account];
  }

  function login(role, id) {
    var cfg = routes[role];
    if (!cfg) return;
    var account = id || (role === "customer" ? "customer_demo" : role === "companion" ? "companion_user" : role === "customer_service" ? "service_demo" : "admin_demo");
    var publicId = role === "customer" ? customerNumber(account) : account;
    localStorage.setItem(cfg.token, role + "_session_" + SESSION_VERSION + "_" + Date.now());
    localStorage.setItem(cfg.user, JSON.stringify({ id: publicId, account: account, user_id: publicId, name: role === "customer" ? "\u8001\u677f\u8d26\u53f7" : account, role: role }));
  }

  function logout(role) {
    var cfg = routes[role];
    if (!cfg) return;
    localStorage.removeItem(cfg.token);
    localStorage.removeItem(cfg.user);
  }

  function guard(role) {
    var cfg = routes[role];
    if (!cfg) return true;
    if (!isAllowed(role)) {
      location.replace(cfg.login);
      return false;
    }
    return true;
  }

  bindDevAdminLogin();

  window.MCJRoleGate = { routes: routes, guard: guard, login: login, loginWithPassword: loginWithPassword, logout: logout, isLogged: isLogged, user: user, isLocalDevHost: isLocalDevHost };
})();