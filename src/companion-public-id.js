/**
 * Customer-facing companion display ID helpers (browser).
 * Never treat DB UUID as a public companion ID.
 */
(function (global) {
  "use strict";
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUuid(v) {
    return UUID_RE.test(String(v || "").trim());
  }

  function formatPw(n) {
    var num = Math.max(1, Math.floor(Number(n) || 0));
    return "PW" + String(num).padStart(5, "0");
  }

  function customerFacingCompanionId(item) {
    var src = item || {};
    var candidates = [
      src.publicId,
      src.companionCode,
      src.companion_code,
      src.companionPublicId,
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var s = String(candidates[i] || "").trim();
      if (!s || isUuid(s)) continue;
      if (/^PW\d+$/i.test(s)) return s.toUpperCase().replace(/^pw/i, "PW");
      if (/^P\d+$/i.test(s)) {
        var n = Number(String(s).replace(/^P/i, ""));
        if (n >= 100001) return formatPw(n - 100000);
        if (n > 0) return formatPw(n);
      }
      if (s.length <= 24) return s;
    }
    var uid = Number(src.companionUid || src.companion_uid || 0);
    if (uid >= 100001) return formatPw(uid - 100000);
    if (uid > 0) return formatPw(uid);
    return "";
  }

  function displayOrPending(item, pendingLabel) {
    return customerFacingCompanionId(item) || pendingLabel || "未生成";
  }

  global.MCJCompanionPublicId = {
    isUuid: isUuid,
    customerFacingCompanionId: customerFacingCompanionId,
    displayOrPending: displayOrPending,
  };
})(typeof window !== "undefined" ? window : globalThis);
