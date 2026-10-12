(function () {
  if (window.MCJOps) return;

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "";
    var n = typeof value === "number" ? value : Number(value);
    if (!isFinite(n) || n < 0) return "";
    return "RM" + n.toFixed(2);
  }

  function formatRange(min, max, unit) {
    var a = formatMoney(min);
    var b = formatMoney(max);
    if (!a || !b) return "";
    return a + " – " + b + (unit ? " / " + unit : "");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function request(path, options) {
    options = options || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    return fetch("/api/ops" + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: "服务器没有返回 JSON" }; }).then(function (payload) {
        if (!res.ok || !payload.ok) throw new Error((payload && payload.error) || "请求失败");
        return payload.data;
      });
    });
  }

  function admin(path, options) {
    options = options || {};
    options.headers = Object.assign({ "x-ops-role": "admin" }, options.headers || {});
    return request(path, options);
  }

  function companion(path, options, companionId) {
    options = options || {};
    options.headers = Object.assign({
      "x-ops-role": "companion",
      "x-ops-companion-id": companionId || ""
    }, options.headers || {});
    return request(path, options);
  }

  function boss(path, options) {
    options = options || {};
    options.headers = Object.assign({ "x-ops-role": "boss" }, options.headers || {});
    return request(path, options);
  }

  window.MCJOps = {
    formatMoney: formatMoney,
    formatRange: formatRange,
    esc: esc,
    request: request,
    admin: admin,
    companion: companion,
    boss: boss
  };
})();
