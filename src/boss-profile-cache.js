/**
 * Shared boss profile (/api/auth?action=me) short-lived cache.
 * Prevents mine / header / secondary widgets from each hitting /me on the same navigation.
 * Never caches balances/order/unread critical payloads — only the profile user object.
 */
(function () {
  "use strict";
  if (window.MCJBossProfileCache) return;

  var TTL_MS = 45 * 1000;
  var STORAGE_KEY = "mcjBossProfileCache.v1";
  var memory = null;
  var inflight = null;

  function now() {
    return Date.now();
  }

  function readStorage() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.user || !parsed.savedAt) return null;
      if (now() - Number(parsed.savedAt) > TTL_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeStorage(entry) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    } catch (e) {}
  }

  function peek() {
    if (memory && now() - memory.savedAt <= TTL_MS) return memory;
    memory = readStorage();
    return memory;
  }

  function invalidate() {
    memory = null;
    inflight = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function token() {
    try {
      return (
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  /**
   * @param {{force?:boolean,timeoutMs?:number}} opts
   * @returns {Promise<{ok:boolean,user?:object,passwordHint?:string,fromCache?:boolean,response?:Response}>}
   */
  function getMe(opts) {
    opts = opts || {};
    if (!opts.force) {
      var cached = peek();
      if (cached && cached.user) {
        return Promise.resolve({
          ok: true,
          user: cached.user,
          passwordHint: cached.passwordHint || "",
          fromCache: true,
        });
      }
    }
    if (inflight) return inflight;

    var access = token();
    if (!access) {
      return Promise.resolve({ ok: false, message: "未登录" });
    }

    var timeoutMs = opts.timeoutMs || 10000;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (e) {}
    }, timeoutMs);

    inflight = fetch("/api/auth?action=me", {
      headers: { Authorization: "Bearer " + access, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (body) {
          return { res: res, body: body || {} };
        });
      })
      .then(function (pack) {
        clearTimeout(timer);
        var res = pack.res;
        var body = pack.body;
        if (!res.ok || !body.ok || !body.user) {
          return {
            ok: false,
            message: (body && body.message) || "账号资料读取失败",
            response: res,
            body: body,
          };
        }
        var entry = {
          savedAt: now(),
          user: body.user,
          passwordHint: body.passwordHint || "",
        };
        memory = entry;
        writeStorage(entry);
        return {
          ok: true,
          user: body.user,
          passwordHint: entry.passwordHint,
          fromCache: false,
          response: res,
          body: body,
        };
      })
      .catch(function (err) {
        clearTimeout(timer);
        return {
          ok: false,
          message:
            err && err.name === "AbortError"
              ? "加载超时，请重试"
              : (err && err.message) || "账号资料读取失败",
        };
      })
      .finally(function () {
        inflight = null;
      });

    return inflight;
  }

  window.MCJBossProfileCache = {
    TTL_MS: TTL_MS,
    peek: peek,
    getMe: getMe,
    invalidate: invalidate,
  };

  window.addEventListener("mcj:auth-updated", function (ev) {
    var detail = (ev && ev.detail) || {};
    if (detail.loggedIn === false || detail.reason === "logout" || detail.reason === "expired") {
      invalidate();
    }
  });
  window.addEventListener("mcj:auth-changed", function (ev) {
    var detail = (ev && ev.detail) || {};
    if (detail.loggedIn === false) invalidate();
  });
})();
