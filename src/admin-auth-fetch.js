(function () {
  var REFRESH_BUFFER_MS = 60 * 1000;
  var refreshPromise = null;

  // Dedicated admin keys — never shared with boss wipe of mcjAuth*.
  var ADMIN_ACCESS = "mcjAdminAccessToken";
  var ADMIN_REFRESH = "mcjAdminRefreshToken";
  var ADMIN_EXPIRES = "mcjAdminExpiresAt";
  // Legacy shared keys (migrate / fallback).
  var LEGACY_ACCESS = "mcjAuthAccessToken";
  var LEGACY_REFRESH = "mcjAuthRefreshToken";
  var LEGACY_EXPIRES = "mcjAuthExpiresAt";

  function readItem(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function writeBoth(store, key, value) {
    if (!value) return;
    try {
      store.setItem(key, value);
    } catch (e) {}
  }

  function removeBoth(key) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (e) {}
  }

  function hasAdminSoftSession() {
    var soft = readItem("adminAuthToken");
    return String(soft).indexOf("admin_session_") === 0;
  }

  function authStore() {
    // Prefer the store that already holds admin soft session / JWT.
    if (localStorage.getItem("adminAuthToken") || localStorage.getItem(ADMIN_ACCESS) || localStorage.getItem(LEGACY_ACCESS)) {
      return localStorage;
    }
    if (sessionStorage.getItem("adminAuthToken") || sessionStorage.getItem(ADMIN_ACCESS) || sessionStorage.getItem(LEGACY_ACCESS)) {
      return sessionStorage;
    }
    return localStorage;
  }

  function getAccessToken() {
    return (
      readItem(ADMIN_ACCESS) ||
      (hasAdminSoftSession() ? readItem(LEGACY_ACCESS) : "") ||
      readItem(LEGACY_ACCESS) ||
      ""
    );
  }

  function getRefreshToken() {
    return (
      readItem(ADMIN_REFRESH) ||
      (hasAdminSoftSession() ? readItem(LEGACY_REFRESH) : "") ||
      readItem(LEGACY_REFRESH) ||
      ""
    );
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
    var raw = readItem(ADMIN_EXPIRES) || readItem(LEGACY_EXPIRES);
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

  function looksLikeJwt(token) {
    var t = String(token || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (part) {
      return part.length > 0;
    });
  }

  function isJwtAuthError(message) {
    var text = String(message || "").toLowerCase();
    return text.indexOf("jwt") > -1 || text.indexOf("token is expired") > -1 || text.indexOf("invalid claims") > -1;
  }

  function saveTokens(session) {
    if (!session) return;
    var store = authStore();
    var access = session.accessToken || session.access_token || "";
    var refresh = session.refreshToken || session.refresh_token || "";
    var expires = session.expiresAt || session.expires_at || "";
    if (access) {
      writeBoth(store, ADMIN_ACCESS, access);
      // Keep legacy mirror while soft admin session is active (compat for older modules).
      writeBoth(store, LEGACY_ACCESS, access);
    }
    if (refresh) {
      writeBoth(store, ADMIN_REFRESH, refresh);
      writeBoth(store, LEGACY_REFRESH, refresh);
    }
    if (expires) {
      writeBoth(store, ADMIN_EXPIRES, String(expires));
      writeBoth(store, LEGACY_EXPIRES, String(expires));
    }
  }

  function clearSessionAndRedirect(message) {
    if (window.MCJRoleGate && window.MCJRoleGate.logout) window.MCJRoleGate.logout("admin");
    [
      ADMIN_ACCESS,
      ADMIN_REFRESH,
      ADMIN_EXPIRES,
      LEGACY_ACCESS,
      LEGACY_REFRESH,
      LEGACY_EXPIRES,
      "adminAuthToken",
      "adminUser",
      "mcjRole",
    ].forEach(removeBoth);
    if (!/\/admin\/login/.test(location.pathname)) {
      if (message) {
        try {
          sessionStorage.setItem("mcjAdminLoginNotice", message);
        } catch (e) {}
      }
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
    var access = getAccessToken();
    var refresh = getRefreshToken();
    if (!looksLikeJwt(access) && refresh) {
      try {
        return await refreshAccessToken();
      } catch (error) {
        clearSessionAndRedirect(error.message || "登录已过期，请重新登录。");
        throw error;
      }
    }
    if (!looksLikeJwt(access)) {
      if (hasAdminSoftSession()) {
        clearSessionAndRedirect("管理员登录已失效，请重新登录后台。");
      }
      return "";
    }
    if (!isAccessTokenExpired()) return access;
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
    var token = await ensureValidToken();
    var headers = Object.assign({}, getAuthHeaders(), init.headers || {});
    if (token) {
      headers.Authorization = "Bearer " + token;
      headers["x-mcj-access-token"] = token;
    }
    init.headers = headers;
    var response = await fetch(url, init);
    if (response.status === 401 || response.status === 403) {
      var clone = response.clone();
      var text = await clone.text();
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {}
      if (isJwtAuthError(body.message || text) || /请先使用管理员账号登录|登录已失效/i.test(String(body.message || ""))) {
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

  // Migrate legacy shared JWT → dedicated admin keys when soft admin session exists.
  (function migrateLegacyAdminTokens() {
    if (!hasAdminSoftSession()) return;
    if (readItem(ADMIN_ACCESS) || readItem(ADMIN_REFRESH)) return;
    var access = readItem(LEGACY_ACCESS);
    var refresh = readItem(LEGACY_REFRESH);
    var expires = readItem(LEGACY_EXPIRES);
    if (!access && !refresh) return;
    saveTokens({ accessToken: access, refreshToken: refresh, expiresAt: expires });
  })();

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
    ADMIN_ACCESS: ADMIN_ACCESS,
    ADMIN_REFRESH: ADMIN_REFRESH,
    ADMIN_EXPIRES: ADMIN_EXPIRES,
  };
})();
