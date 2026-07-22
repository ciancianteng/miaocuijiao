(function () {
  var SESSION_VERSION = "v3";
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
    localStorage.setItem(cfg.user, JSON.stringify({ id: publicId, account: account, user_id: publicId, name: role === "customer" ? "老板账号" : account, role: role }));
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

  window.MCJRoleGate = { routes: routes, guard: guard, login: login, logout: logout, isLogged: isLogged, user: user };
})();
