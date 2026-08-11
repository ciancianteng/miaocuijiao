(function () {
  "use strict";

  if (window.MCJBossAuth) return;

  var REFRESH_BUFFER_MS = 60 * 1000;
  var EXPIRED_MESSAGE = "登录已过期，请重新登录。";
  var refreshPromise = null;
  var sessionReadyPromise = null;
  var authLoading = true;
  var readyResolvers = [];
  var AUTH_EVENT = "mcj:auth-updated";

  var BOSS_KEYS = [
    "mcjAuthAccessToken",
    "mcjAuthRefreshToken",
    "mcjAuthExpiresAt",
    "customerAuthToken",
    "customerUser",
    "mcjCurrentUser",
    "mcjRole",
  ];

  function hasAdminSoftSession() {
    try {
      var soft = localStorage.getItem("adminAuthToken") || sessionStorage.getItem("adminAuthToken") || "";
      return String(soft).indexOf("admin_session_") === 0;
    } catch (e) {
      return false;
    }
  }

  /** Clear boss auth from both stores (logout / expired). Keep admin JWT keys. */
  function wipeLocalBossAuth() {
    var preserveSharedAuth = hasAdminSoftSession();
    BOSS_KEYS.forEach(function (key) {
      if (preserveSharedAuth && /^mcjAuth(AccessToken|RefreshToken|ExpiresAt)$/.test(key)) return;
      if (/^mcjAdmin/.test(key)) return;
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
  }

  function readItem(key) {
    // Single SoT read order for the whole boss portal: session tab → durable local.
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function emitAuthUpdated(detail) {
    try {
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: detail || {} }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("mcj:auth-changed", { detail: detail || {} }));
    } catch (e2) {}
  }

  function markReady() {
    authLoading = false;
    var waiters = readyResolvers.splice(0, readyResolvers.length);
    waiters.forEach(function (resolve) {
      try {
        resolve(snapshot());
      } catch (e) {}
    });
  }

  function getAccessToken() {
    return readItem("mcjAuthAccessToken");
  }

  function getRefreshToken() {
    return readItem("mcjAuthRefreshToken");
  }

  function decodeJwtExpMs(raw) {
    try {
      var parts = String(raw || "").split(".");
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
    return decodeJwtExpMs(getAccessToken());
  }

  function looksLikeJwt(token) {
    var t = String(token || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (part) {
      return part.length > 0;
    });
  }

  function hasValidAccessToken() {
    var access = getAccessToken();
    if (!looksLikeJwt(access)) return false;
    var exp = getExpiresAtMs();
    if (exp && Date.now() >= exp) return false;
    return true;
  }

  function needsRefresh() {
    var access = getAccessToken();
    var refresh = getRefreshToken();
    if (!access && refresh) return true;
    if (!looksLikeJwt(access)) return !!refresh;
    var exp = getExpiresAtMs();
    if (!exp) return false;
    return Date.now() >= exp - REFRESH_BUFFER_MS;
  }

  function parseStoredUser() {
    try {
      var raw = readItem("customerUser") || readItem("mcjCurrentUser");
      if (!raw) return null;
      var user = JSON.parse(raw);
      return user && typeof user === "object" ? user : null;
    } catch (e) {
      return null;
    }
  }

  function getStoredRoles() {
    var user = parseStoredUser() || {};
    var roles = Array.isArray(user.roles) ? user.roles.slice() : [];
    var primary = String(user.role || readItem("mcjRole") || "").trim().toLowerCase();
    if (primary && roles.indexOf(primary) < 0) roles.push(primary);
    return roles.map(function (r) {
      return String(r || "").trim().toLowerCase();
    }).filter(Boolean);
  }

  function hasBossCapability() {
    var roles = getStoredRoles();
    var bossLike = { boss: 1, customer: 1, owner: 1, user: 1 };
    if (roles.some(function (r) { return bossLike[r]; })) return true;
    var user = parseStoredUser();
    if (user && user.hasBoss === true) return true;
    // JWT present on boss portal without role hint yet — treat as pending, not denied.
    return hasValidAccessToken() || !!getRefreshToken();
  }

  function snapshot() {
    var user = parseStoredUser();
    return {
      authLoading: authLoading,
      authenticated: hasValidAccessToken(),
      hasRefresh: !!getRefreshToken(),
      isBoss: hasBossCapability() && (hasValidAccessToken() || !!getRefreshToken()),
      user: user,
      roles: getStoredRoles(),
      portal: "boss",
      accessToken: getAccessToken() || "",
    };
  }

  function whenReady() {
    if (!authLoading) return Promise.resolve(snapshot());
    return new Promise(function (resolve) {
      readyResolvers.push(resolve);
    });
  }

  function saveSession(session, persist) {
    if (!session) return;
    // Dual-write when remember/persist: current tab (sessionStorage) + durable (localStorage).
    // Tab-only login (persist === false) keeps sessionStorage only.
    var stores = persist === false ? [sessionStorage] : [sessionStorage, localStorage];
    stores.forEach(function (store) {
      try {
        if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
        if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
        if (session.expiresAt != null && session.expiresAt !== "") {
          store.setItem("mcjAuthExpiresAt", String(session.expiresAt));
        }
      } catch (e) {}
    });
    if (persist === false) {
      try {
        localStorage.removeItem("mcjAuthAccessToken");
        localStorage.removeItem("mcjAuthRefreshToken");
        localStorage.removeItem("mcjAuthExpiresAt");
      } catch (e2) {}
    } else {
      // Keep stores aligned: avoid stale local JWT disagreeing with session after refresh.
      try {
        if (session.accessToken) localStorage.setItem("mcjAuthAccessToken", session.accessToken);
        if (session.refreshToken) localStorage.setItem("mcjAuthRefreshToken", session.refreshToken);
        if (session.expiresAt != null && session.expiresAt !== "") {
          localStorage.setItem("mcjAuthExpiresAt", String(session.expiresAt));
        }
      } catch (e3) {}
    }
    emitAuthUpdated({ reason: "saveSession", persist: persist !== false });
  }

  function clearSession() {
    wipeLocalBossAuth();
    try {
      window.dispatchEvent(new CustomEvent("mcj:auth-expired"));
    } catch (e2) {}
    emitAuthUpdated({ reason: "clearSession" });
  }

  function hasSession() {
    return hasValidAccessToken();
  }

  function canRestoreSession() {
    return hasValidAccessToken() || !!getRefreshToken();
  }

  function getSession() {
    return Promise.resolve().then(function () {
      if (!hasSession()) {
        return { data: { session: null }, error: null };
      }
      var expMs = getExpiresAtMs();
      return {
        data: {
          session: {
            expires_at: expMs ? Math.floor(expMs / 1000) : null,
          },
        },
        error: null,
      };
    });
  }

  function refreshSession() {
    if (refreshPromise) return refreshPromise;
    var refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearSession();
      return Promise.reject(new Error(EXPIRED_MESSAGE));
    }
    var persistRefresh = false;
    try {
      persistRefresh = !!localStorage.getItem("mcjAuthRefreshToken");
    } catch (e) {}
    refreshPromise = fetch("/api/auth", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refreshToken: refreshToken }),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || !body.ok || !body.session || !body.session.accessToken) {
            clearSession();
            throw new Error((body && body.message) || EXPIRED_MESSAGE);
          }
          saveSession(body.session, persistRefresh);
          return { data: { session: { expires_at: body.session.expiresAt || null } }, error: null };
        });
      })
      .catch(function () {
        clearSession();
        throw new Error(EXPIRED_MESSAGE);
      })
      .finally(function () {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function ensureSession() {
    if (sessionReadyPromise) return sessionReadyPromise;
    authLoading = true;
    var pending = getSession()
      .then(function (result) {
        var access = getAccessToken();
        var refresh = getRefreshToken();
        if (!access && !refresh) return result;
        if (hasValidAccessToken() && !needsRefresh()) return result;
        if (!refresh) {
          clearSession();
          return { data: { session: null }, error: null };
        }
        return refreshSession().then(function () {
          return getSession();
        });
      })
      .catch(function () {
        return { data: { session: null }, error: null };
      })
      .finally(function () {
        markReady();
        // Do not broadcast ensureSession on every coalesce — widgets listen for login/logout flips.
      });
    sessionReadyPromise = pending;
    return pending;
  }

  function authHeaders(extra) {
    var headers = Object.assign({ Accept: "application/json" }, extra || {});
    var token = getAccessToken();
    if (token) {
      headers.Authorization = "Bearer " + token;
      headers["x-mcj-access-token"] = token;
    }
    return headers;
  }

  function isAuthUnauthorized(status, message) {
    if (Number(status) === 401) return true;
    var text = String(message || "").toLowerCase();
    return (
      text.indexOf("登录已过期") > -1 ||
      text.indexOf("jwt") > -1 ||
      text.indexOf("token is expired") > -1 ||
      text.indexOf("invalid claims") > -1 ||
      text.indexOf("unable to parse or verify signature") > -1
    );
  }

  function authFetch(url, init, retried) {
    init = init || {};
    return ensureSession()
      .then(function () {
        if (!hasSession()) throw new Error("请先登录");
        var headers = authHeaders(init.headers || {});
        return fetch(url, Object.assign({}, init, { headers: headers, cache: init.cache || "no-store" }));
      })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch (e) {
            body = { message: text || "请求失败" };
          }
          var message = body.message || "请求失败";
          if ((!res.ok || body.ok === false) && !retried && isAuthUnauthorized(res.status, message)) {
            return refreshSession()
              .then(function () {
                return authFetch(url, init, true);
              })
              .catch(function () {
                clearSession();
                throw new Error(EXPIRED_MESSAGE);
              });
          }
          if (!res.ok || body.ok === false) {
            var err = new Error(message);
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
  }

  window.MCJBossAuth = {
    getSession: getSession,
    refreshSession: refreshSession,
    ensureSession: ensureSession,
    authFetch: authFetch,
    authHeaders: authHeaders,
    saveSession: saveSession,
    clearSession: clearSession,
    wipeLocalBossAuth: wipeLocalBossAuth,
    hasSession: hasSession,
    canRestoreSession: canRestoreSession,
    hasValidAccessToken: hasValidAccessToken,
    getAccessToken: getAccessToken,
    getRefreshToken: getRefreshToken,
    getStoredUser: parseStoredUser,
    getStoredRoles: getStoredRoles,
    hasBossCapability: hasBossCapability,
    snapshot: snapshot,
    whenReady: whenReady,
    isAuthLoading: function () {
      return !!authLoading;
    },
    looksLikeJwt: looksLikeJwt,
    expiredMessage: EXPIRED_MESSAGE,
    AUTH_EVENT: AUTH_EVENT,
  };

  // Kick restore immediately so route guards / widgets can await authLoading=false.
  try {
    ensureSession();
  } catch (bootErr) {
    markReady();
  }
})();
