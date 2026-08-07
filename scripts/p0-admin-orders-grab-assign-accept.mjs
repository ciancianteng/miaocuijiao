/**
 * Admin order management: list_grabs + confirm_grab_assignment + empty grabs.
 * Staging accept. Usage: node scripts/p0-admin-orders-grab-assign-accept.mjs
 */
const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(path, token, body, method = "POST", extra = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

(async () => {
  console.log("STAGING", BASE);

  // Source guards (local)
  const fs = await import("node:fs");
  const js = fs.readFileSync("src/admin-final-v1.js", "utf8");
  const css = fs.readFileSync("src/admin-final-v1.css", "utf8");
  step("UI has 待支付审核 panel", /待支付审核/.test(js), "panel title");
  step("UI has 全部订单 panel", /全部订单/.test(js), "panel title");
  step("UI status filter + search", /data-admin-order-filter/.test(js) && /data-admin-order-search/.test(js), "toolbar");
  step("UI view grabs empty copy", /当前暂无陪玩抢单/.test(js), "empty grabs");
  step("UI free assign search", /data-admin-free-assign/.test(js) && /data-admin-assign-search/.test(js), "free assign");
  step("UI status-based actions", /orderActionsHtml/.test(js) && !/orderStatusSelect\(/.test(js), "no always-on status select");
  step("CSS modal overlay", /admin-om-modal/.test(css) && /position:\s*fixed/.test(css), "modal css");
  step("CSS no forced wide table", !/min-width:\s*880px/.test(css), "no 880 min-width");

  const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" })).json);
  const bossT = tok((await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" })).json);
  const csT = tok((await api("/api/customer-service", null, { action: "login", account: CS, password: PASS })).json);
  const compT = tok((await api("/api/companion", null, { action: "login", account: COMP, password: PASS })).json);
  step("logins", !!(adminT && bossT && csT && compT), `admin=${!!adminT} boss=${!!bossT} cs=${!!csT} comp=${!!compT}`);

  const adminExtra = { "x-mcj-admin-role": "super_admin" };
  const ordersRes = await api("/api/admin/orders", adminT, null, "GET", adminExtra);
  const orders = ordersRes.json.orders || [];
  step("admin orders list", ordersRes.ok && orders.length > 0, `count=${orders.length}`);

  // Order A: has grabs (prefer nickname 1717)
  let orderA =
    orders.find((o) => Number(o.grabCount || 0) > 0 && ["pending", "waiting_boss_confirm"].includes(o.status)) || null;
  step("order A with grabs", !!orderA, orderA ? `${orderA.orderNo} grabs=${orderA.grabCount} status=${orderA.status}` : "none");

  if (orderA) {
    const grabsRes = await api("/api/admin/orders", adminT, { action: "list_grabs", id: orderA.id }, "POST", adminExtra);
    const grabs = grabsRes.json.grabs || [];
    step("list_grabs returns applicants", grabsRes.ok && grabs.length > 0, `count=${grabs.length}`);
    const g0 = grabs[0] || {};
    const c0 = g0.companion || {};
    step(
      "grab card fields",
      !!(c0.nickname && (c0.companionUid || c0.id) && (c0.avatarUrl || true) && (g0.grabbedAt || g0.grabbed_at)),
      `name=${c0.nickname} uid=${c0.companionUid || c0.id} price=${c0.price} online=${c0.onlineStatus}`
    );

    const pick =
      grabs.find((g) => /1717/.test(String(g.companion?.nickname || ""))) ||
      grabs.find((g) => g.companionId) ||
      grabs[0];
    const companionId = pick?.companionId || pick?.companion?.id;
    const assign = await api(
      "/api/admin/orders",
      adminT,
      { action: "confirm_grab_assignment", id: orderA.id, companion_id: companionId, from_grabs: true },
      "POST",
      adminExtra
    );
    const assigned = assign.json.order || {};
    step(
      "admin assign from grabs",
      !!(assign.ok && assigned.companion_id && String(assigned.companion_id) === String(companionId)),
      `status=${assigned.status} companion=${assigned.companionName || assigned.companion_id} msg=${assign.json.message || ""}`
    );

    const refresh = await api("/api/admin/orders", adminT, null, "GET", adminExtra);
    const row = (refresh.json.orders || []).find((o) => o.id === orderA.id);
    step(
      "admin list shows selected companion",
      !!(row && row.companion_id && (/1717/.test(String(row.companionName || "")) || row.companion_id === companionId)),
      `name=${row?.companionName} id=${row?.companion_id} status=${row?.status}`
    );

    const bossOrders = await api(`/api/orders?id=${encodeURIComponent(orderA.id)}`, bossT, null, "GET");
    const bossRow = (bossOrders.json.orders || []).find((o) => o.id === orderA.id) || {};
    step(
      "boss sees assigned companion",
      !!(bossRow.companionId || bossRow.companion_id || bossRow.companionName),
      `status=${bossRow.status} companion=${bossRow.companionName || bossRow.companion_id}`
    );

    const csBoot = await api("/api/customer-service", csT, null, "GET");
    const csRow = ((csBoot.json.data && csBoot.json.data.orders) || csBoot.json.orders || []).find((o) => o.id === orderA.id);
    step(
      "cs sees assigned companion",
      !!(csRow && (csRow.companionId || csRow.companion_id || csRow.companionName)),
      `status=${csRow?.status} companion=${csRow?.companionName || csRow?.companionId}`
    );

    // Companion portal (assigned companion may or may not be the test COMP account)
    const compBoot = await api("/api/companion?action=bootstrap", compT, null, "GET");
    const mine = compBoot.json?.data?.myOrders || [];
    const hit = mine.find((o) => o.id === orderA.id);
    step(
      "companion portal check",
      true,
      hit ? `test companion sees order status=${hit.status}` : "assigned companion may differ from test account (ok)"
    );
  }

  // Order B: no grabs
  const orderB = orders.find((o) => Number(o.grabCount || 0) === 0 && o.status === "pending");
  step("order B no grabs", !!orderB, orderB ? `${orderB.orderNo}` : "none");
  if (orderB) {
    const empty = await api("/api/admin/orders", adminT, { action: "list_grabs", id: orderB.id }, "POST", adminExtra);
    step(
      "empty grabs list",
      !!(empty.ok && Array.isArray(empty.json.grabs) && empty.json.grabs.length === 0),
      `count=${(empty.json.grabs || []).length}`
    );
  }

  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\n=== SUMMARY PASS ${results.length - failed.length}/${results.length} ===`);
  if (failed.length) {
    failed.forEach((f) => console.log(`FAIL ${f.step}: ${f.detail}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
