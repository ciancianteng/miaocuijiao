/**
 * Shared public companions list cache (SWR).
 * Hall / home / gifts must share one inflight + short TTL to avoid triple full fetches.
 */
(function (root) {
  "use strict";
  if (root.MCJCompanionsCache) return;

  var KEY = "public.companions.list.v1";
  var TTL_MS = 25 * 1000;
  var STALE_MS = 120 * 1000;

  function fetchList(limit) {
    var lim = Number(limit) > 0 ? Math.min(200, Number(limit)) : 80;
    var url = "/api/public/companions?limit=" + encodeURIComponent(String(lim));
    return fetch(url, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "default",
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!res.ok || !body || body.ok === false) {
          throw new Error((body && body.message) || "陪玩列表读取失败");
        }
        return Array.isArray(body.companions) ? body.companions : [];
      });
    });
  }

  function load(opts) {
    opts = opts || {};
    var Swr = root.MCJSwr;
    if (!Swr) {
      return fetchList(opts.limit).then(function (rows) {
        return { value: rows, fromCache: false, stale: false };
      });
    }
    return Swr.load(
      KEY + "." + (opts.limit || 80),
      function () {
        return fetchList(opts.limit);
      },
      { ttlMs: opts.ttlMs != null ? opts.ttlMs : TTL_MS, staleMs: opts.staleMs != null ? opts.staleMs : STALE_MS, force: !!opts.force }
    );
  }

  function peek(limit) {
    var Swr = root.MCJSwr;
    if (!Swr) return null;
    var hit = Swr.get(KEY + "." + (limit || 80));
    return hit && hit.value ? hit.value : null;
  }

  function invalidate() {
    var Swr = root.MCJSwr;
    if (!Swr) return;
    ["80", "60", "100", "120", "200"].forEach(function (n) {
      Swr.invalidate(KEY + "." + n);
    });
    Swr.invalidate(KEY);
  }

  root.MCJCompanionsCache = {
    load: load,
    peek: peek,
    invalidate: invalidate,
    TTL_MS: TTL_MS,
  };
})(typeof window !== "undefined" ? window : globalThis);
