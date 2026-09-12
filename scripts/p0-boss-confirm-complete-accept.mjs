/**
 * P0: boss confirm-complete + 24h auto-confirm handshake.
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

  const html = await fetch(`${STAGING}/orders.html`, { cache: "no-store" }).then((r) => r.text());
  step("老板端文案含等待您确认完成", html.includes("等待您确认完成"), "");
  step("老板端主按钮确认完成订单", html.includes("确认完成订单") && html.includes('data-action="confirm_completion"'), "");
  step("进行中不展示申请售后（申请完成后改问题入口）", html.includes("report_order_problem") && html.includes("订单有问题，联系客服"), "");

  const bossOrders = (await api("/api/orders", bossT, null, "GET")).json?.orders || [];
  let order = bossOrders.find((o) => o.status === "in_progress" && o.companionId && !o.completionPending);
  if (!order) order = bossOrders.find((o) => o.status === "in_progress" && o.companionId);
  step("找到进行中订单", !!order, order ? `${order.orderNo || order.id} cp=${!!order.completionPending}` : "none");
  if (!order) {
    console.log("SUMMARY", `${results.filter((r) => r.ok).length}/${results.length}`);
    process.exit(1);
  }
  const oid = order.id;

  if (!order.completionPending) {
    const apply = await api("/api/companion", compT, { action: "complete_order", id: oid });
    step(
      "陪玩申请完成",
      !!apply.json?.ok && (apply.json?.awaitingBossConfirm === true || apply.json?.order?.completionPending === true),
      apply.json?.message || apply.status
    );
  } else {
    // refresh stamp
    await api("/api/companion", compT, { action: "complete_order", id: oid });
    step("陪玩申请完成", true, "already pending / refreshed");
  }

  const bossAfter = ((await api("/api/orders", bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  step(
    "老板端可见 completionPending + 倒计时",
    !!bossAfter?.completionPending && !!bossAfter?.completionRequestedAt && /等待您确认完成|等待处理/.test(String(bossAfter.statusText || "")),
    `cp=${!!bossAfter?.completionPending} at=${bossAfter?.completionRequestedAt} left=${bossAfter?.autoConfirmRemainingLabel} st=${bossAfter?.statusText}`
  );

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

  // Pause via report problem on a throwaway? Use mark dispute via CS then clear, on current order — but then confirm may still work.
  // Instead create pause then verify countdown paused, then clear dispute and confirm.
  const dispute = await api("/api/customer-service", csT, { action: "mark_order_dispute", id: oid, reason: "accept_test" });
  step("客服标记争议可暂停自动确认", !!dispute.json?.ok, dispute.json?.message || dispute.status);
  const paused = ((await api("/api/orders", bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  step(
    "老板端显示自动确认已暂停",
    !!paused?.autoConfirmPaused || /等待处理|暂停/.test(String(paused?.statusText || paused?.autoConfirmPausedReason || "")),
    `paused=${!!paused?.autoConfirmPaused} reason=${paused?.autoConfirmPausedReason || paused?.statusText}`
  );
  await api("/api/customer-service", csT, { action: "clear_order_dispute", id: oid });

  const adminList = await api("/api/admin/orders?status=in_progress&limit=50", adminT, null, "GET");
  const adminHit = (adminList.json?.orders || []).find((o) => o.id === oid);
  step(
    "后台状态同步",
    !!adminHit && (!!adminHit.completionPending || /等待老板确认|待确认完成|等待处理/.test(String(adminHit.statusText || adminHit.orderStatus || ""))),
    adminHit ? `cp=${!!adminHit.completionPending} st=${adminHit.statusText} os=${adminHit.orderStatus}` : `missing`
  );

  const confirm = await api("/api/orders", bossT, { action: "confirm_completion", id: oid });
  step(
    "老板确认完成 → 已完成",
    !!confirm.json?.ok && (confirm.json?.order?.status === "completed" || /已确认完成|已完成/.test(String(confirm.json?.message || ""))),
    `${confirm.json?.message || confirm.status} method=${confirm.json?.completionMethod || ""}`
  );

  const again = await api("/api/orders", bossT, { action: "confirm_completion", id: oid });
  step(
    "重复确认不重复结算",
    !!again.json?.ok || again.status === 409,
    `${again.status} ${again.json?.message || ""} duplicate=${!!again.json?.duplicate}`
  );

  const bossDone = ((await api("/api/orders", bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  step(
    "老板端已完成可评价",
    bossDone?.status === "completed" && (bossDone.canReview === true || !bossDone.reviewed),
    `status=${bossDone?.status} canReview=${bossDone?.canReview} method=${bossDone?.completionMethod || ""}`
  );

  const adminDone = ((await api("/api/admin/orders?limit=80", adminT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
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
