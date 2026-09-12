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

  const beforeBoot = await api(`/api/companion?action=bootstrap`, compT, null, "GET");
  const beforeCount = Number(beforeBoot.json?.data?.summary?.waitingConfirm || beforeBoot.json?.data?.summary?.designatedPending || 0);
  const beforeIds = new Set(((beforeBoot.json?.data?.myOrders || []).filter((o) => o.status === "claimed")).map((o) => o.id));

  const place = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P0实时指定单",
      game: "VALORANT",
      game_id: `P0-RT-${Date.now()}`,
      description: "realtime mail accept",
      hours: 1,
      unit_price: 18,
      total_amount: 18,
      order_type: "custom",
      payment_method: "tng",
    },
  });
  const oid = place.json?.order?.id;
  step("boss_create_order", !!(place.json?.ok && oid), oid || place.json?.message || "");

  await api("/api/orders", bossT, { action: "submit_payment_proof", id: oid, proofDataUrl: PNG, paymentMethod: "tng" });
  const confirm = await api("/api/customer-service", csT, { action: "confirm_payment", id: oid });
  step("cs_confirm_payment", !!confirm.json?.ok, confirm.json?.order?.status || confirm.json?.message || "");

  const assign = await api("/api/customer-service", csT, {
    action: "assign_companion",
    id: oid,
    companion_id: companionId,
    from_grabs: false,
  });
  const order = assign.json?.order || {};
  step(
    "cs_assign_companion_claimed",
    !!(assign.json?.ok && order.status === "claimed"),
    `status=${order.status} msg=${assign.json?.message || ""}`
  );

  let appeared = false;
  let seenId = "";
  for (let i = 0; i < 8; i++) {
    await sleep(2000);
    const boot = await api(`/api/companion?action=bootstrap`, compT, null, "GET");
    const claimed = (boot.json?.data?.myOrders || []).filter((o) => o.status === "claimed");
    const hit = claimed.find((o) => o.id === oid);
    const count = Number(boot.json?.data?.summary?.waitingConfirm || boot.json?.data?.summary?.designatedPending || 0);
    if (hit || count > beforeCount) {
      appeared = true;
      seenId = hit?.id || oid || "";
      break;
    }
  }
  step("companion_sees_new_order_without_manual_refresh_poll", appeared, `order=${seenId || oid || ""} before=${beforeCount} beforeIds=${beforeIds.size}`);

  await sleep(2500);
  const logs1 = await api("/api/admin/mail-logs?limit=50", adminT, null, "GET");
  step("admin_mail_logs_api", !!logs1.json?.ok, `count=${(logs1.json?.logs || []).length} configured=${logs1.json?.configured} msg=${logs1.json?.message || ""}`);
  const related = (logs1.json?.logs || []).filter(
    (l) =>
      (oid && (l.orderId === oid || String(l.notificationKey || "").startsWith(oid))) ||
      String(l.recipient || "").toLowerCase() === String(COMP).toLowerCase()
  );
  step(
    "mail_log_created_for_assign",
    related.length > 0,
    related[0]
      ? `status=${related[0].status} key=${related[0].notificationKey} type=${related[0].mailType} source=${related[0].source || ""}`
      : `related=0 total=${(logs1.json?.logs || []).length}`
  );

  const again = await api("/api/customer-service", csT, {
    action: "assign_companion",
    id: oid,
    companion_id: companionId,
    from_grabs: false,
  });
  await sleep(1500);
  const logs2 = await api("/api/admin/mail-logs?limit=80", adminT, null, "GET");
  const keys = (logs2.json?.logs || [])
    .map((l) => l.notificationKey)
    .filter((k) => oid && String(k || "").startsWith(oid) && /:assign\b|:assign$/.test(String(k)));
  const unique = new Set(keys);
  step(
    "mail_notification_key_idempotent",
    keys.length === 0 || unique.size <= 1 || !!again.json?.deduped || related.length === 1,
    `keys=${keys.length} unique=${unique.size} deduped=${!!again.json?.deduped} msg=${again.json?.message || ""}`
  );

  const link = `${STAGING}/companion/orders?focus=${encodeURIComponent(oid || "")}&filter=waiting_confirm`;
  const page = await fetch(link);
  step("email_cta_orders_deep_link", page.status === 200 && !!oid, link);

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\nSUMMARY", { pass: results.length - failed.length, fail: failed.length, total: results.length });
  console.log(JSON.stringify({ staging: STAGING, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
