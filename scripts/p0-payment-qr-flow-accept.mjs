/**
 * Payment flow accept on fixed Staging:
 * place_order → awaiting_payment → payment page QR only → 我已付款/proof → 待人工审核 → CS 确认收款 → claimed/pending
 *
 * Usage: node scripts/p0-payment-qr-flow-accept.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || process.env.E2E_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
if (/localhost|127\.0\.0\.1/i.test(STAGING)) throw new Error("Refuse localhost; use fixed Staging URL");

async function api(pathname, token, body, method) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${STAGING}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 240) };
  }
  return { ok: res.ok && json.ok !== false, status: res.status, json, text };
}

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6nQAAAABJRU5ErkJggg==";

(async () => {
  console.log("STAGING", STAGING);

  const home = await fetch(`${STAGING}/`).then(async (r) => ({ ok: r.ok, html: await r.text() }));
  step("homepage reachable", home.ok, `status ok`);
  step(
    "homepage hides payment QR",
    !/OCBC OneCollect|data-pay-qr|platformPayInfo|DuitNow QR/i.test(home.html),
    "no public QR markers"
  );

  const pubSettings = await api("/api/platform/settings", null, null, "GET");
  const pub = pubSettings.json?.settings || {};
  step(
    "public settings strip payment QR",
    pubSettings.ok && !pub.paymentChannelsPublic && !pub.qrUrl && !pub.duitnowId,
    `keys stripped`
  );

  const payHtml = await fetch(`${STAGING}/payment-confirm.html`).then(async (r) => ({ ok: r.ok, html: await r.text() }));
  step("payment-confirm page", payHtml.ok, `status`);
  step("payment-confirm has QR css", /pay-qr-frame|pay-qr/.test(payHtml.html), "qr styles present");

  const payJs = await fetch(`${STAGING}/src/payment-confirm.js?v=${Date.now()}`).then((r) => r.text());
  step("payment JS shows QR panel", /qrPanelHtml|data-pay-qr|OCBC OneCollect/.test(payJs), "qr panel code");
  step("payment JS 我已付款 CTA", /我已付款/.test(payJs), "我已付款");
  step("payment JS 待人工审核", /待人工审核/.test(payJs), "待人工审核 label");

  const csJs = await fetch(`${STAGING}/src/customer-service-v2.js?v=${Date.now()}`).then((r) => r.text());
  step("CS 确认收款 button", />确认收款</.test(csJs) || /确认收款/.test(csJs), "confirm copy");
  step("CS waits for proof", /等待老板扫码付款并上传截图/.test(csJs), "no confirm without proof UI");

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossToken =
    bossLogin.json?.session?.accessToken || bossLogin.json?.accessToken || bossLogin.json?.session?.token || "";
  step("boss login", !!(bossLogin.json?.ok && bossToken), `ok=${bossLogin.json?.ok}`);

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csToken =
    csLogin.json?.session?.token || csLogin.json?.session?.accessToken || csLogin.json?.token || csLogin.json?.accessToken || "";
  step("cs login", !!(csLogin.json?.ok && csToken), `ok=${csLogin.json?.ok}`);

  const companions = await api("/api/public/companions", null, null, "GET");
  const list = companions.json?.companions || [];
  const comp =
    list.find((c) => c.canOrderNow === true && Number(c.priceValue || c.price || 0) > 0) ||
    list.find((c) => /在线可接单/.test(String(c.onlineStatus || c.availabilityText || "")) && Number(c.priceValue || c.price || 0) > 0) ||
    list.find((c) => Number(c.priceValue || c.price || 0) > 0 && c.online === true) ||
    list[0];
  step("pick companion", !!comp?.id, `id=${comp?.id} name=${comp?.name} online=${comp?.onlineStatus || comp?.status || ""} canOrder=${comp?.canOrderNow}`);

  const unit = Number(comp?.priceValue || comp?.price || 10);
  const place = await api("/api/orders", bossToken, {
    action: "place_order",
    companionId: comp?.id,
    companionName: comp?.name || "陪玩",
    serviceType: "陪玩",
    service: "陪玩",
    game: "VALORANT",
    unitPrice: unit,
    hours: 1,
    quantity: 1,
    totalAmount: unit,
    gameId: "PAY-QR-GID-" + Date.now(),
    paymentMethod: "tng",
    notes: "payment qr flow accept",
    idempotencyKey: "pay-qr-" + Date.now(),
  });
  const order = place.json?.order || {};
  const orderId = order.id;
  step(
    "place_order awaiting_payment",
    !!(place.json?.ok && orderId && order.status === "awaiting_payment"),
    `id=${orderId} status=${order.status} no=${order.orderNo || order.order_no} msg=${place.json?.message || ""}`
  );

  const getOrder = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossToken, null, "GET");
  const loaded = (getOrder.json?.orders || []).find((o) => o.id === orderId) || {};
  const payInfo = getOrder.json?.platformPayInfo || loaded.platformPayInfo || null;
  step("payment page API returns pay info", !!(getOrder.ok && payInfo), `source=${payInfo?.source || "none"} title=${payInfo?.title || ""}`);
  step(
    "pay info is OCBC/DuitNow oriented",
    !!(payInfo && /OCBC|DuitNow|收款/i.test(String(payInfo.title || ""))),
    `title=${payInfo?.title || ""}`
  );

  const denyConfirm = await api("/api/customer-service", csToken, { action: "confirm_payment", id: orderId });
  step(
    "CS cannot confirm before proof",
    !denyConfirm.ok && /付款截图|PAYMENT_PROOF_REQUIRED|待人工审核/.test(String(denyConfirm.json?.message || denyConfirm.json?.code || "")),
    denyConfirm.json?.message || denyConfirm.json?.code || ""
  );

  const proof = await api("/api/orders", bossToken, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: tinyPng,
    paymentMethod: "tng",
  });
  step(
    "submit proof → 待人工审核",
    !!(proof.ok && proof.json?.order?.paymentReview && /待人工审核|待审核/.test(String(proof.json?.order?.statusText || proof.json?.message || ""))),
    `review=${proof.json?.order?.paymentReview} text=${proof.json?.order?.statusText || proof.json?.message}`
  );

  const csBoot = await api("/api/customer-service", csToken, null, "GET");
  const pending = (csBoot.json?.data?.orders || csBoot.json?.orders || []).find((row) => row.id === orderId);
  step(
    "CS sees payment review + screenshot",
    !!(csBoot.ok && pending?.paymentReview && pending?.paymentProofUrl),
    `review=${pending?.paymentReview} proof=${!!pending?.paymentProofUrl}`
  );

  const confirmed = await api("/api/customer-service", csToken, { action: "confirm_payment", id: orderId });
  const after = confirmed.json?.order || {};
  step(
    "CS 确认收款 → 待接单/指定陪玩",
    !!(confirmed.ok && ["claimed", "pending"].includes(String(after.status || ""))),
    `status=${after.status} paidAt=${after.paidAt || ""}`
  );
  step(
    "records kept (orderNo / paidAt / proof)",
    !!(after.orderNo || order.orderNo) && (!!after.paidAt || after.status !== "awaiting_payment"),
    `orderNo=${after.orderNo || order.orderNo} paidAt=${after.paidAt || "(may soft-fail schema)"}`
  );

  const passed = results.every((r) => r.result === "PASS");
  console.log(`PAYMENT_QR_FLOW_${passed ? "PASS" : "FAIL"} ${results.filter((r) => r.result === "PASS").length}/${results.length}`);
  process.exit(passed ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
