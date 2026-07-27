(function () {
  var SESSION_VERSION = "v4";
  var routes = {
    customer: { token: "customerAuthToken", user: "customerUser", login: "/index.html", allowed: [/\/index\.html$/, /\/$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/custom-order\.html$/, /\/more-gameplays\.html$/, /\/companion-apply\.html$/, /\/activities\.html$/] },
    boss: { token: "customerAuthToken", user: "customerUser", login: "/index.html", allowed: [/\/index\.html$/, /\/$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/custom-order\.html$/, /\/more-gameplays\.html$/, /\/companion-apply\.html$/, /\/activities\.html$/] },
    companion: { token: "companionAuthToken", user: "companionUser", login: "/companion/login", allowed: [/\/companion\//] },
    customer_service: { token: "customerServiceAuthToken", user: "customerServiceUser", login: "/customer-service/login", allowed: [/\/customer-service\//] },
    admin: { token: "adminAuthToken", user: "adminUser", login: "/index.html", allowed: [/\/admin\.html$/, /\/admin\//] }
  };

  function path() { return location.pathname.replace(/\\/g, "/"); }
  function storageRole(role) { role = String(role || ""); if (role === "boss") return "customer"; if (role === "service") return "customer_service"; if (role === "player") return "companion"; return role; }
  function profileRole(role) { role = String(role || ""); if (role === "customer") return "boss"; if (role === "service") return "customer_service"; if (role === "player") return "companion"; return role; }
  function roleMatches(expected, actual) { return profileRole(expected) === profileRole(actual); }
  function routeFor(role) { return { boss: "/index.html", customer: "/index.html", companion: "/companion/", customer_service: "/customer-service/", admin: "/admin/" }[storageRole(role)] || "/index.html"; }

  function cfgFor(role) { return routes[storageRole(role)] || routes[role]; }
  function readUser(role) { var cfg = cfgFor(role); try { return JSON.parse(localStorage.getItem(cfg.user) || sessionStorage.getItem(cfg.user) || "{}"); } catch (e) { return {}; } }
  function readToken(role) { var cfg = cfgFor(role); return localStorage.getItem(cfg.token) || sessionStorage.getItem(cfg.token) || ""; }
  function isAllowed(role) { var cfg = cfgFor(role); if (!cfg) return true; return cfg.allowed.some(function (rule) { return rule.test(path()); }); }
  function isLogged(role) { var token = readToken(role); var u = readUser(role); if (!token) return false; if (String(token).indexOf(storageRole(role) + "_session_" + SESSION_VERSION + "_") === 0) return roleMatches(role, u.role || role); if (String(token).indexOf(storageRole(role) + "_session_") === 0) return roleMatches(role, u.role || role); return false; }

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

  function fieldValue(ids) { for (var i = 0; i < ids.length; i += 1) { var el = document.getElementById(ids[i]); if (el) return el.value || ""; } return ""; }
  function closeLoginModal() { var modal = document.getElementById("modal"); if (modal) modal.classList.remove("open"); document.body.style.overflow = ""; }
  function refreshAuthUi() { document.body.classList.toggle("is-logged-in", isLogged("customer") || isLogged("boss")); window.dispatchEvent(new CustomEvent("mcj:auth-updated")); }

  function saveSession(session, remember) {
    var userData = session && session.user || {};
    var role = storageRole(userData.role || "boss");
    var cfg = cfgFor(role);
    if (!cfg) return null;
    var store = remember === false ? sessionStorage : localStorage;
    var token = role + "_session_" + SESSION_VERSION + "_" + Date.now();
    var user = {
      id: userData.id || "",
      uid: userData.id || "",
      account: userData.email || "",
      user_id: userData.id || "",
      name: userData.displayName || userData.email || "",
      nickname: userData.displayName || "",
      email: userData.email || "",
      phone: userData.phone || "",
      avatarUrl: userData.avatarUrl || "",
      role: userData.role || role,
      status: userData.status || "active",
      adminRole: userData.role === "admin" ? "admin" : "",
      permissions: userData.role === "admin" ? ["admin"] : []
    };
    store.setItem(cfg.token, token);
    store.setItem(cfg.user, JSON.stringify(user));
    store.setItem("mcjRole", userData.role || role);
    if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
    if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
    ["customer", "companion", "customer_service", "admin"].forEach(function (other) {
      if (other === role) return;
      var otherCfg = cfgFor(other);
      localStorage.removeItem(otherCfg.token); localStorage.removeItem(otherCfg.user);
      sessionStorage.removeItem(otherCfg.token); sessionStorage.removeItem(otherCfg.user);
    });
    return user;
  }

  async function loginWithDatabase(account, password, remember) {
    var response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email: account, password: password }) });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || !body.ok) throw new Error(body.message || "账号或密码错误。");
    saveSession(body.session, remember);
    return body;
  }

  function loginWithPassword() { return { ok: false, message: "请使用数据库账号邮箱登录。" }; }
  function login() { return null; }
  function user(role) { return readUser(role); }
  function logout(role) { var cfg = cfgFor(role); if (!cfg) return; localStorage.removeItem(cfg.token); localStorage.removeItem(cfg.user); sessionStorage.removeItem(cfg.token); sessionStorage.removeItem(cfg.user); }
  function guard(role) { var cfg = cfgFor(role); if (!cfg) return true; if (!isAllowed(role)) { location.replace(cfg.login); return false; } if ((storageRole(role) === "admin") && !isLogged("admin")) { location.replace("/index.html"); return false; } return true; }

  function bindLoginButtons() {
    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest && event.target.closest("[data-login-confirm]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      var account = fieldValue(["loginGmail", "loginEmail", "adminEmail", "email"]);
      var password = fieldValue(["loginGmailCode", "loginPassword", "adminPassword", "password"]);
      if (!account || !password) { setLoginMessage(target, "第一阶段仅支持邮箱 + 密码登录。"); return; }
      if (target.disabled) return;
      target.disabled = true;
      var oldText = target.textContent;
      target.textContent = "登录中...";
      loginWithDatabase(account, password, true).then(function (result) {
        closeLoginModal();
        refreshAuthUi();
        var role = result.session && result.session.user && result.session.user.role || "boss";
        var redirect = sessionStorage.getItem("mcjAfterLoginRedirect") || result.redirect || routeFor(role);
        sessionStorage.removeItem("mcjAfterLoginRedirect");
        if (profileRole(role) !== "boss") location.href = redirect;
        else if (redirect && redirect !== location.pathname && !/index\.html$/.test(location.pathname)) location.href = redirect;
      }).catch(function (error) {
        setLoginMessage(target, error.message || "账号或密码错误。");
      }).finally(function () {
        target.disabled = false;
        target.textContent = oldText || "登录";
      });
    }, true);
  }

  bindLoginButtons();
  refreshAuthUi();

  window.MCJRoleGate = { routes: routes, guard: guard, login: login, loginWithPassword: loginWithPassword, loginWithDatabase: loginWithDatabase, saveSession: saveSession, logout: logout, isLogged: isLogged, user: user };
})();
