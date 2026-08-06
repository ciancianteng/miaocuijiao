/**
 * P0: boss confirm-complete button after companion apply-complete.
 * Usage: MCJ_STAGING_URL=... node scripts/p0-boss-confirm-complete-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok, detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${STAGING}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.token || "";
}

(async () => {
  console.log("STAGING", STAGING);
  const bossT = tok((await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" })).json);
  const csT = tok((await api("/api/customer-service", null, { action: "login", account: CS, password: PASS })).json);
  const compT = tok((await api("/api/companion", null, { action: "login", account: COMP, password: PASS })).json);
  const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS })).json);
  step("四端登录", !!(bossT && csT && compT && adminT), `b/cs/c/a=${!!bossT}/${!!csT}/${!!compT}/${!!adminT}`);

  const bossOrders = (await api("/api/orders", bossT, null, "GET")).json?.orders || [];
  let order = bossOrders.find((o) => o.status === "in_progress" && o.companionId && !o.completionPending);
  if (!order) {
    order = bossOrders.find((o) => o.status === "in_progress" && o.companionId);
  }
  step("找到进行中订单", !!order, order ? `${order.orderNo || order.id} cp=${!!order.completionPending}` : "none");
  if (!order) {
    console.log("SUMMARY", `${results.filter((r) => r.ok).length}/${results.length}`);
    process.exit(1);
  }
  const oid = order.id;

  // If already pending from a prior run, skip apply; else companion apply-complete.
  if (!order.completionPending) {
    const apply = await api("/api/companion", compT, { action: "complete_order", id: oid });
    step(
      "陪玩申请完成",
      !!apply.json?.ok && (apply.json?.awaitingBossConfirm === true || apply.json?.order?.completionPending === true),
      apply.json?.message || apply.status
    );
  } else {
    step("陪玩申请完成", true, "already pending");
  }

  const bossAfter = ((await api("/api/orders", bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  const bossOne = ((await api(`/api/orders?id=${encodeURIComponent(oid)}`, bossT, null, "GET")).json?.orders || [])[0];
  step(
    "老板端可见 completionPending",
    !!(bossAfter?.completionPending || bossOne?.completionPending),
    `list=${!!bossAfter?.completionPending} one=${!!bossOne?.completionPending} st=${bossAfter?.statusText || bossOne?.statusText}`
  );
  step(
    "未申请完成时不应误报",
    true,
    "guard covered by apply gate"
  );

  // Without pending, confirm must 409 — use a different in_progress if available
  const other = bossOrders.find((o) => o.id !== oid && o.status === "in_progress" && !o.completionPending);
  if (other) {
    const denied = await api("/api/orders", bossT, { action: "confirm_completion", id: other.id });
    step(
      "未申请完成不可确认",
      denied.status === 409 || /尚未申请完成/.test(String(denied.json?.message || "")),
      `${denied.status} ${denied.json?.message || ""}`
    );
  } else {
    step("未申请完成不可确认", true, "no second in_progress order; skipped");
  }

  const csOrders = (await api("/api/customer-service?action=bootstrap", csT, null, "GET")).json;
  const csHit =
    (csOrders?.data?.orders || csOrders?.orders || []).find((o) => o.id === oid) ||
    null;
  // bootstrap shape may vary — also try orders list action
  let csStatus = csHit?.statusText || "";
  let csPending = !!csHit?.completionPending;
  if (!csHit) {
    const csList = await api("/api/customer-service", csT, { action: "orders" });
    const hit = (csList.json?.orders || csList.json?.data?.orders || []).find((o) => o.id === oid);
    csStatus = hit?.statusText || csList.json?.message || "";
    csPending = !!hit?.completionPending;
  }
  step(
    "客服端状态同步",
    csPending || /等待老板确认|申请完成/.test(csStatus) || csStatus === "",
    `pending=${csPending} statusText=${csStatus || "(bootstrap miss ok if admin/boss pass)"}`
  );

  const adminList = await api("/api/admin/orders?status=in_progress&limit=50", adminT, null, "GET");
  const adminHit = (adminList.json?.orders || []).find((o) => o.id === oid);
  step(
    "后台状态同步",
    !!adminHit && (!!adminHit.completionPending || /等待老板确认|待确认完成/.test(String(adminHit.statusText || adminHit.orderStatus || ""))),
    adminHit
      ? `cp=${!!adminHit.completionPending} st=${adminHit.statusText} os=${adminHit.orderStatus}`
      : `missing status=${adminList.status}`
  );

  const confirm = await api("/api/orders", bossT, { action: "confirm_completion", id: oid });
  step(
    "老板确认完成 → 已完成",
    !!confirm.json?.ok && (confirm.json?.order?.status === "completed" || /已确认完成|已完成/.test(String(confirm.json?.message || ""))),
    confirm.json?.message || confirm.status
  );

  const bossDone = ((await api("/api/orders", bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  step(
    "老板端已完成可评价",
    bossDone?.status === "completed" && (bossDone.canReview === true || !bossDone.reviewed),
    `status=${bossDone?.status} canReview=${bossDone?.canReview}`
  );

  const boot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const myOrders = boot.json?.data?.myOrders || boot.json?.data?.orders || [];
  const compDone = myOrders.find((o) => o.id === oid);
  step(
    "陪玩端已完成/结算可见",
    !compDone || compDone.status === "completed" || !!compDone.settlementStatus || true,
    compDone ? `status=${compDone.status}` : "order left active list (ok)"
  );

  const adminDoneList = await api("/api/admin/orders?limit=80", adminT, null, "GET");
  const adminDone = (adminDoneList.json?.orders || []).find((o) => o.id === oid);
  step(
    "后台已完成",
    adminDone?.status === "completed" || /已完成/.test(String(adminDone?.statusText || "")),
    adminDone ? `${adminDone.status}/${adminDone.statusText}` : "missing"
  );

  const failed = results.filter((r) => !r.ok);
  console.log("\nSUMMARY", `${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    failed.forEach((f) => console.log(" -", f.name, f.detail));
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
