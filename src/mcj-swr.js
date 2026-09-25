/**
 * Tiny stale-while-revalidate cache with inflight coalescing.
 * Shared across hall / home / gifts / profile helpers.
 */
(function (root) {
  "use strict";
  if (root.MCJSwr) return;

  var memory = Object.create(null);
  var inflight = Object.create(null);

  function now() {
    return Date.now();
  }

  function get(key) {
    var hit = memory[key];
    if (!hit) return null;
    return hit;
  }

  function set(key, value, ttlMs) {
    memory[key] = {
      value: value,
      savedAt: now(),
      ttlMs: ttlMs != null ? Number(ttlMs) || 0 : 30000,
    };
    return value;
  }

  function isFresh(entry) {
    if (!entry) return false;
    var ttl = entry.ttlMs != null ? entry.ttlMs : 30000;
    return now() - Number(entry.savedAt || 0) <= ttl;
  }

  function invalidate(key) {
    if (key == null) {
      memory = Object.create(null);
      inflight = Object.create(null);
      return;
    }
    delete memory[key];
    delete inflight[key];
  }

  /**
   * @param {string} key
   * @param {function(): Promise<any>} loader
   * @param {{ ttlMs?: number, staleMs?: number, force?: boolean }} [opts]
   * @returns {Promise<{ value: any, fromCache: boolean, stale: boolean }>}
   */
  function load(key, loader, opts) {
    opts = opts || {};
    var ttlMs = opts.ttlMs != null ? opts.ttlMs : 30000;
    var staleMs = opts.staleMs != null ? opts.staleMs : ttlMs * 4;
    var hit = get(key);
    var fresh = isFresh(hit);
    if (hit && fresh && !opts.force) {
      return Promise.resolve({ value: hit.value, fromCache: true, stale: false });
    }
    if (hit && !opts.force && now() - Number(hit.savedAt || 0) <= staleMs) {
      // Return stale immediately; refresh in background.
      if (!inflight[key]) {
        inflight[key] = Promise.resolve()
          .then(loader)
          .then(function (value) {
            set(key, value, ttlMs);
            return value;
          })
          .finally(function () {
            delete inflight[key];
          });
      }
      return Promise.resolve({ value: hit.value, fromCache: true, stale: true });
    }
    if (inflight[key] && !opts.force) {
      return inflight[key].then(function (value) {
        return { value: value, fromCache: false, stale: false };
      });
    }
    inflight[key] = Promise.resolve()
      .then(loader)
      .then(function (value) {
        set(key, value, ttlMs);
        return value;
      })
      .finally(function () {
        delete inflight[key];
      });
    return inflight[key].then(function (value) {
      return { value: value, fromCache: false, stale: false };
    });
  }

  root.MCJSwr = {
    get: get,
    set: set,
    isFresh: isFresh,
    invalidate: invalidate,
    load: load,
  };
})(typeof window !== "undefined" ? window : globalThis);
