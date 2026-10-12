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

  function statusLabel(status) {
    var map = {
      pending_accept: "待接单",
      rejected: "已拒单",
      accept_timeout: "接单超时",
      pending_payment: "待付款",
      payment_timeout: "付款超时",
      pending_review: "待核实",
      review_failed: "审核未通过",
      payment_exception: "异常付款",
      confirmed: "已确认",
      in_service: "服务中",
      completed: "已完成",
      cancelled: "已取消"
    };
    return map[status] || status || "";
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
    var bossId = "";
    try { bossId = localStorage.getItem("mcjOpsBossId") || ""; } catch (e) { bossId = ""; }
    options.headers = Object.assign({ "x-ops-role": "boss", "x-ops-boss-id": bossId }, options.headers || {});
    return request(path, options);
  }

  window.MCJOps = {
    formatMoney: formatMoney,
    statusLabel: statusLabel,
    formatRange: formatRange,
    esc: esc,
    request: request,
    admin: admin,
    companion: companion,
    boss: boss
  };
})();
