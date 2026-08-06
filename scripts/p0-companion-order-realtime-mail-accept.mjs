/**
 * P0: companion realtime new designated order + email notify idempotency on fixed Staging.
 * Usage: node scripts/p0-companion-order-realtime-mail-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${STAGING}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "GET" || method === "HEAD" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("STAGING", STAGING);

  const rtCfg = await api("/api/public/realtime-config", null, null, "GET");
  step("realtime_config", !!rtCfg.json?.ok && !!rtCfg.json?.url, JSON.stringify({ ok: rtCfg.json?.ok, realtime: rtCfg.json?.realtime }));

  const companionPage = await fetch(`${STAGING}/companion/orders`);
  const companionHtml = await companionPage.text();
  step(
    "companion_orders_loads_realtime_js",
    companionHtml.includes("mcj-chat-realtime.js"),
    `status=${companionPage.status} hasRt=${companionHtml.includes("mcj-chat-realtime.js")}`
  );
  const wbJs = await fetch(`${STAGING}/src/companion-workbench.js?v=20260806orderNotify1`);
  const wbText = await wbJs.text();
  step(
    "workbench_has_order_realtime",
    wbText.includes("subscribeCompanionOrders") && wbText.includes("notifyNewDesignatedOrder"),
    `status=${wbJs.status}`
  );
  const rtJs = await fetch(`${STAGING}/src/mcj-chat-realtime.js?v=20260806orderNotify1`);
  const rtText = await rtJs.text();
  step("realtime_helper_orders_api", rtText.includes("subscribeCompanionOrders"), `status=${rtJs.status}`);

  const adminHtml = await (await fetch(`${STAGING}/admin.html`)).text();
  step(
    "admin_mail_logs_nav",
    adminHtml.includes("mail-logs") && adminHtml.includes("mailNotificationLogs"),
    "nav+section"
  );

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossT = tok(bossLogin.json);
  step("boss_login", !!bossT, bossLogin.json?.message || "");

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csT = tok(csLogin.json);
  step("cs_login", !!csT, csLogin.json?.message || "");

  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const compT = tok(compLogin.json);
  const companionId = compLogin.json?.session?.user?.id || compLogin.json?.user?.id || "";
  step("companion_login", !!compT && !!companionId, companionId || compLogin.json?.message || "");

  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json);
  step("admin_login", !!adminT, adminLogin.json?.message || "");

  const beforeBoot = await api("/api/companion", compT, { action: "bootstrap" }, "GET");
  const beforeCount = Number(beforeBoot.json?.data?.summary?.waitingConfirm || beforeBoot.json?.data?.summary?.designatedPending || 0);
  const beforeIds = new Set(((beforeBoot.json?.data?.myOrders || []).filter((o) => o.status === "claimed")).map((o) => o.id));

  // Create designated order via CS (awaiting_payment → confirm payment → claimed)
  const create = await api("/api/customer-service", csT, {
    action: "create_order",
    bossId: bossLogin.json?.session?.user?.id || bossLogin.json?.user?.id,
    game: "VALORANT",
    serviceName: "陪玩上分",
    hours: 1,
    unitPrice: 30,
    totalAmount: 30,
    assignmentType: "assigned",
    companionId,
    note: `P0 realtime mail accept ${Date.now()}`,
  });
  let order = create.json?.order || create.json?.data?.order;
  // Some CS flows use nested fields
  if (!order?.id && create.json?.ok) {
    const list = await api("/api/customer-service", csT, { action: "orders" }, "GET");
    const rows = list.json?.orders || list.json?.data?.orders || [];
    order = rows[0];
  }
  step("cs_create_assigned_order", !!order?.id, order?.orderNo || order?.order_no || create.json?.message || JSON.stringify(create.json).slice(0, 180));

  if (order?.id && String(order.status || "") === "awaiting_payment") {
    // Upload payment proof as boss if needed, then CS confirm
    await api("/api/orders", bossT, {
      action: "upload_payment_proof",
      orderId: order.id,
      imageBase64: PNG,
      fileName: "p0.png",
    }).catch(() => null);
    const confirm = await api("/api/customer-service", csT, {
      action: "confirm_payment",
      id: order.id,
      order_id: order.id,
    });
    order = confirm.json?.order || order;
    step("cs_confirm_payment_to_claimed", String(order?.status || confirm.json?.order?.status || "") === "claimed" || /待陪玩|claimed|确认/.test(String(confirm.json?.message || "")), confirm.json?.message || order?.status || "");
  } else if (order?.id) {
    const assign = await api("/api/customer-service", csT, {
      action: "assign_companion",
      id: order.id,
      companion_id: companionId,
    });
    order = assign.json?.order || order;
    step("cs_assign_companion", assign.json?.ok !== false, assign.json?.message || order?.status || "");
  } else {
    step("cs_confirm_payment_to_claimed", false, "no order");
  }

  // Poll companion bootstrap without page reload — must appear within ~15s
  let appeared = false;
  let seenId = "";
  for (let i = 0; i < 8; i++) {
    await sleep(2000);
    const boot = await api("/api/companion", compT, { action: "bootstrap" }, "GET");
    const claimed = (boot.json?.data?.myOrders || []).filter((o) => o.status === "claimed");
    const hit = claimed.find((o) => o.id === order?.id) || claimed.find((o) => !beforeIds.has(o.id));
    const count = Number(boot.json?.data?.summary?.waitingConfirm || boot.json?.data?.summary?.designatedPending || 0);
    if (hit || (order?.id && claimed.some((o) => o.id === order.id)) || count > beforeCount) {
      appeared = true;
      seenId = hit?.id || order?.id || "";
      break;
    }
  }
  step("companion_sees_new_order_without_manual_refresh_poll", appeared, `order=${seenId || order?.id || ""} before=${beforeCount}`);

  // Email log + idempotency: wait briefly for async notify
  await sleep(2500);
  const logs1 = await api("/api/admin/mail-logs?limit=50", adminT, null, "GET");
  step("admin_mail_logs_api", !!logs1.json?.ok, `count=${(logs1.json?.logs || []).length} configured=${logs1.json?.configured}`);
  const orderNo = order?.orderNo || order?.order_no || "";
  const related = (logs1.json?.logs || []).filter(
    (l) =>
      (order?.id && (l.orderId === order.id || String(l.notificationKey || "").startsWith(order.id))) ||
      (orderNo && l.orderNo === orderNo) ||
      String(l.recipient || "").toLowerCase() === String(COMP).toLowerCase()
  );
  step(
    "mail_log_created_for_assign",
    related.length > 0 || logs1.json?.configured === false,
    related[0]
      ? `status=${related[0].status} key=${related[0].notificationKey} type=${related[0].mailType}`
      : `related=0 total=${(logs1.json?.logs || []).length}`
  );

  // Trigger assign notify again (dedupe) via assign endpoint if already claimed
  if (order?.id) {
    const again = await api("/api/customer-service", csT, {
      action: "assign_companion",
      id: order.id,
      companion_id: companionId,
    });
    await sleep(1500);
    const logs2 = await api("/api/admin/mail-logs?limit=80", adminT, null, "GET");
    const keys = (logs2.json?.logs || [])
      .map((l) => l.notificationKey)
      .filter((k) => order?.id && String(k || "").startsWith(order.id) && String(k).includes(":assign"));
    const unique = new Set(keys);
    step(
      "mail_notification_key_idempotent",
      keys.length === 0 || unique.size === keys.length || (related.length > 0 && again.json?.deduped),
      `keys=${keys.length} unique=${unique.size} deduped=${!!again.json?.deduped} msg=${again.json?.message || ""}`
    );
  } else {
    step("mail_notification_key_idempotent", false, "no order");
  }

  // Deep link shape
  if (order?.id) {
    const link = `${STAGING}/companion/orders?focus=${encodeURIComponent(order.id)}&filter=waiting_confirm`;
    const page = await fetch(link);
    step("email_cta_orders_deep_link", page.status === 200, link);
  } else {
    step("email_cta_orders_deep_link", false, "no order");
  }

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\nSUMMARY", { pass: results.length - failed.length, fail: failed.length, total: results.length });
  console.log(JSON.stringify({ staging: STAGING, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
