/**
 * Accept: admin uploads payment QR (no manual https link) → Storage public URL → DB → payment page shows image.
 * Usage: node scripts/p0-admin-pay-qr-upload-accept.mjs
 */
const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

  const upload1 = await api("/api/admin/payment-settings", adminT, {
    action: "upload_qr",
    channelId: "duitnow",
    dataUrl: PNG,
    filename: "duitnow-qr.png",
  });
  const qr1 = String(upload1.json?.qrUrl || "").trim();
  step(
    "upload_qr_writes_public_url",
    upload1.ok && /^https?:\/\//i.test(qr1) && /platform-payment|storage\/v1\/object\/public/i.test(qr1),
    `url=${qr1.slice(0, 120)} msg=${upload1.json?.message || ""}`
  );

  const upload2 = await api("/api/admin/payment-settings", adminT, {
    action: "upload_qr",
    channelId: "duitnow",
    dataUrl: PNG,
    filename: "duitnow-qr-overwrite.png",
  });
  const qr2 = String(upload2.json?.qrUrl || "").trim();
  step(
    "reupload_overwrites",
    upload2.ok && /^https?:\/\//i.test(qr2),
    `url=${qr2.slice(0, 120)}`
  );

  const settings = await api("/api/admin/payment-settings", adminT, null, "GET");
  const duitnow = (settings.json?.channels || []).find((c) => (c.channel_id || c.id) === "duitnow") || {};
  const savedQr = String(duitnow?.data?.manual?.qrUrl || duitnow?.data?.qrUrl || "").trim();
  step(
    "channel_db_has_qr",
    settings.ok && /^https?:\/\//i.test(savedQr),
    `saved=${savedQr.slice(0, 120)}`
  );

  // UI source should not require manual https input label
  const adminHtml = await fetch(`${BASE}/admin.html`).then((r) => r.text());
  const payJs = await fetch(`${BASE}/src/admin-payment-settings.js`).then((r) => r.text());
  step(
    "admin_ui_is_upload_not_link_field",
    /上传二维码图片/.test(payJs) && !/收款二维码图片链接/.test(payJs) && !/placeholder="https:\/\/\.\.\.\/duitnow-qr\.png"/.test(payJs),
    `admin.html=${adminHtml.includes("admin-payment-settings")}`
  );

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
      title: "P0 QR upload",
      game: "VALORANT",
      game_id: `P0-QR-${Date.now()}`,
      hours: 1,
      unit_price: 10,
      total_amount: 10,
      payment_method: "manual_transfer",
      description: "qr upload accept",
    },
  });
  const oid = create.json?.order?.id || "";
  step("boss_create_order", create.ok && !!oid, oid);

  const bossOrders = await api(`/api/orders?id=${encodeURIComponent(oid)}`, bossT, null, "GET");
  const loaded = (bossOrders.json?.orders || [])[0] || bossOrders.json?.order || {};
  const payQr = String(
    bossOrders.json?.platformPayInfo?.qrUrl || loaded.platformPayInfo?.qrUrl || ""
  ).trim();
  step(
    "payment_page_qr_available",
    bossOrders.ok && /^https?:\/\//i.test(payQr),
    `qr=${payQr.slice(0, 140)} source=${bossOrders.json?.platformPayInfo?.source || loaded.platformPayInfo?.source || ""}`
  );

  // Public settings must still strip qrUrl
  const pub = await api("/api/platform/settings", null, null, "GET");
  const pubSettings = pub.json?.settings || {};
  step(
    "public_settings_hide_qr",
    pub.ok && !pubSettings.qrUrl && !pubSettings.paymentChannelsPublic,
    "stripped"
  );

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
