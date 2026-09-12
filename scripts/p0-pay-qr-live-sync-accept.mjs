/**
 * Accept: admin upload/replace payment QR → boss payment page reads latest live QR.
 * Staging only. Usage: node scripts/p0-pay-qr-live-sync-accept.mjs
 */
const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";

function pngDataUrl(seedByte) {
  // Minimal valid 1x1 PNG; vary last bytes of base64 payload via seed comment in filename only —
  // actual pixels stay tiny; cache-bust comes from server ?v=timestamp on Storage URL.
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(path, token, body, method = "POST", extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    cache: "no-store",
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

(async () => {
  console.log("STAGING", BASE);

  const adminLogin = await api("/api/auth", null, {
    action: "login",
    email: ADMIN,
    password: PASS,
    loginPortal: "admin",
  });
  const adminT = tok(adminLogin.json);
  step("admin_login", !!adminT, adminLogin.json?.message || "");

  const upload1 = await api(
    "/api/admin/payment-settings",
    adminT,
    { action: "upload_qr", channelId: "duitnow", dataUrl: pngDataUrl(1), filename: "live-qr-a.png" },
    "POST",
    { "x-mcj-admin-role": "super_admin" }
  );
  const qr1 = String(upload1.json?.qrUrl || upload1.json?.activePublicQr?.qrUrl || "").trim();
  step(
    "upload1_storage_url",
    upload1.ok && /^https?:\/\//i.test(qr1) && /platform-payment|storage\/v1\/object\/public/i.test(qr1),
    qr1.slice(0, 160)
  );
  step(
    "upload1_active_public_preview",
    !!(upload1.json?.activePublicQr?.available && upload1.json?.activePublicQr?.qrUrl),
    JSON.stringify(upload1.json?.activePublicQr || {}).slice(0, 200)
  );

  await new Promise((r) => setTimeout(r, 800));

  const upload2 = await api(
    "/api/admin/payment-settings",
    adminT,
    { action: "upload_qr", channelId: "duitnow", dataUrl: pngDataUrl(2), filename: "live-qr-b.png" },
    "POST",
    { "x-mcj-admin-role": "super_admin" }
  );
  const qr2 = String(upload2.json?.qrUrl || upload2.json?.activePublicQr?.qrUrl || "").trim();
  step("upload2_new_url", upload2.ok && /^https?:\/\//i.test(qr2), qr2.slice(0, 160));
  step(
    "upload2_cache_bust_differs",
    !!qr1 && !!qr2 && qr2 !== qr1,
    `qr1=${qr1.slice(-40)} qr2=${qr2.slice(-40)}`
  );

  const settings = await api("/api/admin/payment-settings", adminT, null, "GET", {
    "x-mcj-admin-role": "super_admin",
  });
  const active = settings.json?.activePublicQr || {};
  step(
    "admin_get_active_public_qr",
    settings.ok && active.available === true && String(active.qrUrl || "") === qr2,
    `active=${String(active.qrUrl || "").slice(0, 140)}`
  );

  const payJs = await fetch(`${BASE}/src/payment-confirm.js?v=check`, { cache: "no-store" }).then((r) => r.text());
  step(
    "boss_js_no_stale_qr_cache",
    /支付通道暂不可用/.test(payJs) && /Never reuse a cached QR|delete safe\.platformPayInfo|delete parsed\.platformPayInfo/.test(payJs),
    "empty copy + strip cache"
  );
  step("boss_js_no_static_asset_fallback", !/assets\/.*qr|images\/.*pay-qr|duitnow-qr\.png/i.test(payJs), "no static qr path");

  const bossLogin = await api("/api/auth", null, {
    action: "login",
    email: BOSS,
    password: PASS,
    loginPortal: "boss",
  });
  const bossT = tok(bossLogin.json);
  step("boss_login", !!bossT, bossLogin.json?.message || "");

  const create = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P0 live QR sync",
      game: "VALORANT",
      game_id: `P0-LIVE-QR-${Date.now()}`,
      hours: 1,
      unit_price: 10,
      total_amount: 10,
      payment_method: "duitnow",
      description: "live qr sync accept",
    },
  });
  const oid = create.json?.order?.id || "";
  step("boss_create_order", create.ok && !!oid, oid);

  const bossOrders = await api(`/api/orders?id=${encodeURIComponent(oid)}`, bossT, null, "GET");
  const payInfo = bossOrders.json?.platformPayInfo || {};
  const payQr = String(payInfo.qrUrl || "").trim();
  step(
    "boss_reads_latest_qr",
    bossOrders.ok && payQr === qr2 && payInfo.enabled !== false && String(payInfo.channelId || "") === "duitnow",
    `payQr=${payQr.slice(0, 140)} channel=${payInfo.channelId || ""} source=${payInfo.source || ""}`
  );
  step("boss_not_old_qr", !!payQr && payQr !== qr1, `old=${qr1.slice(-30)} new=${payQr.slice(-30)}`);

  // Disable all manual QR channels → boss must not see any QR / must get unavailable copy
  const manualIds = ["duitnow", "bank-transfer", "bank-my", "tng"];
  for (const cid of manualIds) {
    const disable = await api(
      "/api/admin/payment-settings",
      adminT,
      { action: "toggle_channel", channelId: cid, enabled: false },
      "POST",
      { "x-mcj-admin-role": "super_admin" }
    );
    const missing = /不存在/.test(String(disable.json?.message || ""));
    step(
      `disable_${cid}`,
      disable.ok || missing,
      disable.json?.message || JSON.stringify(disable.json || {}).slice(0, 120)
    );
  }
  const afterDisable = await api(`/api/orders?id=${encodeURIComponent(oid)}`, bossT, null, "GET");
  const emptyInfo = afterDisable.json?.platformPayInfo || {};
  step(
    "boss_empty_when_disabled",
    afterDisable.ok &&
      !String(emptyInfo.qrUrl || "").trim() &&
      (/支付通道暂不可用|暂未开放/.test(String(emptyInfo.instructions || "")) || emptyInfo.unavailable === true),
    JSON.stringify({ qrUrl: emptyInfo.qrUrl, instructions: emptyInfo.instructions, enabled: emptyInfo.enabled, channelId: emptyInfo.channelId }).slice(0, 220)
  );

  // Re-enable DuitNow with latest QR for staging continuity
  const enable = await api(
    "/api/admin/payment-settings",
    adminT,
    { action: "toggle_channel", channelId: "duitnow", enabled: true },
    "POST",
    { "x-mcj-admin-role": "super_admin" }
  );
  step("reenable_channel", enable.ok && !!enable.json?.activePublicQr?.qrUrl, enable.json?.message || "");

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
