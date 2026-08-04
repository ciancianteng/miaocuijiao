(function () {
  var REFRESH_BUFFER_MS = 60 * 1000;
  var refreshPromise = null;

  function authStore() {
    if (localStorage.getItem("mcjAuthAccessToken") || localStorage.getItem("adminAuthToken")) return localStorage;
    if (sessionStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("adminAuthToken")) return sessionStorage;
    return localStorage;
  }

  function readItem(key) {
    return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
  }

  function getAccessToken() {
    return readItem("mcjAuthAccessToken");
  }

  function getRefreshToken() {
    return readItem("mcjAuthRefreshToken");
  }

  function decodeJwtExp(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length < 2) return 0;
      var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.exp ? Number(payload.exp) * 1000 : 0;
    } catch (e) {
      return 0;
    }
  }

  function getExpiresAtMs() {
    var raw = readItem("mcjAuthExpiresAt");
    if (raw) {
      var n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    }
    return decodeJwtExp(getAccessToken());
  }

  function isAccessTokenExpired() {
    var exp = getExpiresAtMs();
    if (!exp) return false;
    return Date.now() >= exp - REFRESH_BUFFER_MS;
  }

  function isJwtAuthError(message) {
    var text = String(message || "").toLowerCase();
    return text.indexOf("jwt") > -1 || text.indexOf("token is expired") > -1 || text.indexOf("invalid claims") > -1;
  }

  function saveTokens(session) {
    if (!session) return;
    var store = authStore();
    if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
    if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
    if (session.expiresAt) store.setItem("mcjAuthExpiresAt", String(session.expiresAt));
  }

  function clearSessionAndRedirect(message) {
    if (window.MCJRoleGate && window.MCJRoleGate.logout) window.MCJRoleGate.logout("admin");
    localStorage.removeItem("mcjAuthAccessToken");
    localStorage.removeItem("mcjAuthRefreshToken");
    localStorage.removeItem("mcjAuthExpiresAt");
    sessionStorage.removeItem("mcjAuthAccessToken");
    sessionStorage.removeItem("mcjAuthRefreshToken");
    sessionStorage.removeItem("mcjAuthExpiresAt");
    if (!/\/admin\/login/.test(location.pathname)) {
      if (message) sessionStorage.setItem("mcjAdminLoginNotice", message);
      location.replace("/admin/login");
    }
  }

  function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async function () {
      var refreshToken = getRefreshToken();
      if (!refreshToken) throw new Error("缺少 refreshToken");
      var response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", refreshToken: refreshToken }),
      });
      var body = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !body.ok || !body.session || !body.session.accessToken) {
        throw new Error(body.message || "登录已过期，请重新登录。");
      }
      saveTokens(body.session);
      return body.session.accessToken;
    })().finally(function () {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function ensureValidToken() {
    if (!getAccessToken()) return "";
    if (!isAccessTokenExpired()) return getAccessToken();
    try {
      return await refreshAccessToken();
    } catch (error) {
      clearSessionAndRedirect(error.message || "登录已过期，请重新登录。");
      throw error;
    }
  }

  function getAuthHeaders(extra) {
    var token = getAccessToken();
    var headers = Object.assign({ Accept: "application/json" }, extra || {});
    if (token) {
      headers.Authorization = "Bearer " + token;
      headers["x-mcj-access-token"] = token;
    }
    return headers;
  }

  async function adminFetch(url, init) {
    init = init || {};
    await ensureValidToken();
    var headers = Object.assign({}, getAuthHeaders(), init.headers || {});
    init.headers = headers;
    var response = await fetch(url, init);
    if (response.status === 401 || response.status === 403) {
      var clone = response.clone();
      var text = await clone.text();
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {}
      if (isJwtAuthError(body.message || text)) {
        try {
          await refreshAccessToken();
          init.headers = Object.assign({}, getAuthHeaders(), init.headers || {});
          return fetch(url, init);
        } catch (error) {
          clearSessionAndRedirect(error.message || "登录已过期，请重新登录。");
          throw new Error("登录已过期，请重新登录。");
        }
      }
    }
    return response;
  }

  function parseJson(response) {
    return response.text().then(function (text) {
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error("接口返回格式错误");
      }
      if (!response.ok || body.ok === false) {
        if ((response.status === 401 || response.status === 403) && isJwtAuthError(body.message)) {
          throw new Error("登录已过期，请重新登录。");
        }
        throw new Error(body.message || "请求失败：HTTP " + response.status);
      }
      return body;
    });
  }

  function get(url, extraHeaders) {
    return adminFetch(url, { headers: Object.assign({}, extraHeaders || {}) }).then(parseJson);
  }

  function post(url, body, extraHeaders) {
    return adminFetch(url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, extraHeaders || {}),
      body: JSON.stringify(body || {}),
    }).then(parseJson);
  }

  window.MCJAdminAuthFetch = {
    authStore: authStore,
    getAccessToken: getAccessToken,
    getRefreshToken: getRefreshToken,
    getAuthHeaders: getAuthHeaders,
    ensureValidToken: ensureValidToken,
    refreshAccessToken: refreshAccessToken,
    saveTokens: saveTokens,
    clearSessionAndRedirect: clearSessionAndRedirect,
    fetch: adminFetch,
    get: get,
    post: post,
    parseJson: parseJson,
    isJwtAuthError: isJwtAuthError,
  };
})();
