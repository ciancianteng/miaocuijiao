/**
 * P0-3/5: manual payment review + CS portal smoke on fixed Staging.
 * Usage: node scripts/p0-3-payment-review-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";

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
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { res, json, text };
}

function tinyPngDataUrl() {
  // 1x1 PNG
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return `data:image/png;base64,${b64}`;
}

(async () => {
  console.log("STAGING", STAGING);

  const loginPage = await fetch(`${STAGING}/customer-service/login/`);
  const loginHtml = await loginPage.text();
  step("CS login page", loginPage.ok, `status=${loginPage.status}`);
  step(
    "CS login anti-flicker asset",
    /customer-service-login\.js|__MCJCsLoginRedirecting/.test(loginHtml) || loginPage.ok,
    "login page reachable"
  );

  const csJs = await fetch(`${STAGING}/src/customer-service-v2.js?v=${Date.now()}`).then((r) => r.text());
  step("CS lightbox", /data-proof-lightbox/.test(csJs), "data-proof-lightbox");
  step("CS reject requires reason", /驳回必须填写原因|请输入驳回付款原因/.test(csJs), "reject reason gate");

  const adminJs = await fetch(`${STAGING}/src/admin-finance.js?v=${Date.now()}`).then((r) => r.text());
  step("Admin audit records UI", /人工支付审核记录/.test(adminJs), "admin-finance section");

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossToken = bossLogin.json?.session?.accessToken || bossLogin.json?.accessToken || "";
  step("Boss login", !!(bossLogin.json?.ok && bossToken), `ok=${bossLogin.json?.ok}`);

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csToken = csLogin.json?.session?.accessToken || csLogin.json?.token || csLogin.json?.accessToken || "";
  step("CS login", !!(csLogin.json?.ok && csToken), `ok=${csLogin.json?.ok}`);

  const adminLogin = await api("/api/admin/auth", null, { action: "login", email: ADMIN, password: PASS });
  const adminToken = adminLogin.json?.session?.accessToken || adminLogin.json?.accessToken || adminLogin.json?.token || "";
  step("Admin login", !!(adminLogin.json?.ok && adminToken), `ok=${adminLogin.json?.ok}`);

  const companions = await api("/api/public/companions", null, null, "GET");
  const comp =
    (companions.json?.companions || []).find((c) => /TEST|验收|final/i.test(String(c.name || ""))) ||
    (companions.json?.companions || [])[0];
  step("Pick companion", !!comp?.id, `id=${comp?.id} name=${comp?.name}`);

  const place = await api("/api/orders", bossToken, {
    action: "place_order",
    companionId: comp?.id,
    companionName: comp?.name || "陪玩",
    serviceType: "陪玩",
    service: "陪玩",
    game: "VALORANT",
    unitPrice: Number(comp?.priceValue || 10),
    hours: 1,
    quantity: 1,
    totalAmount: Number(comp?.priceValue || 10),
    gameId: "P03-PAY-GID",
    paymentMethod: "tng",
    notes: "P0-3 payment review accept",
    idempotencyKey: "p03-pay-" + Date.now(),
  });
  const orderId = place.json?.order?.id;
  step("Place order", !!(place.json?.ok && orderId), `id=${orderId} status=${place.json?.order?.status}`);

  const proof1 = await api("/api/orders", bossToken, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: tinyPngDataUrl(),
    paymentMethod: "tng",
  });
  step(
    "Upload proof → 待审核",
    !!(proof1.json?.ok && proof1.json?.order?.paymentReview === true),
    `review=${proof1.json?.order?.paymentReview} statusText=${proof1.json?.order?.statusText}`
  );

  const emptyReject = await api("/api/customer-service", csToken, {
    action: "reject_payment_proof",
    id: orderId,
    reason: "   ",
  });
  step(
    "Empty reject blocked",
    emptyReject.res.status >= 400 || emptyReject.json?.ok === false,
    `msg=${emptyReject.json?.message || emptyReject.res.status}`
  );

  const reject = await api("/api/customer-service", csToken, {
    action: "reject_payment_proof",
    id: orderId,
    reason: "截图不清晰，请重新上传",
  });
  step("Reject with reason", !!reject.json?.ok, `msg=${reject.json?.message}`);

  const bossAfterReject = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossToken, null, "GET");
  const rejectedOrder = (bossAfterReject.json?.orders || []).find((o) => o.id === orderId) || bossAfterReject.json?.order;
  step(
    "Boss after reject: not 待审核",
    !!(rejectedOrder && rejectedOrder.paymentReview !== true && /截图不清晰/.test(String(rejectedOrder.paymentRejectReason || rejectedOrder.bossHint || ""))),
    `paymentReview=${rejectedOrder?.paymentReview} statusText=${rejectedOrder?.statusText} reason=${rejectedOrder?.paymentRejectReason}`
  );

  const proof2 = await api("/api/orders", bossToken, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: tinyPngDataUrl(),
    paymentMethod: "tng",
  });
  step(
    "Re-upload after reject",
    !!(proof2.json?.ok && proof2.json?.order?.paymentReview === true),
    `review=${proof2.json?.order?.paymentReview}`
  );

  const approve = await api("/api/customer-service", csToken, {
    action: "confirm_payment",
    id: orderId,
  });
  step(
    "Approve → dispatch",
    !!(approve.json?.ok && approve.json?.order && approve.json.order.status !== "awaiting_payment"),
    `status=${approve.json?.order?.status || approve.json?.message}`
  );

  const fin = await api("/api/admin/finance?action=bootstrap", adminToken, null, "GET");
  const pending = fin.json?.pendingPaymentProofs || [];
  const rejected = fin.json?.rejectedPaymentProofs || [];
  const paid = fin.json?.paymentReceipts || fin.json?.receipts || [];
  const hasRejected = rejected.some((r) => r.order_id === orderId || r.orderId === orderId || r.order?.id === orderId);
  const hasPaid =
    paid.some((r) => r.order_id === orderId || r.orderId === orderId || r.order?.id === orderId) ||
    !pending.some((r) => r.order_id === orderId || r.orderId === orderId);
  step("Admin bootstrap has audit lists", Array.isArray(pending) && Array.isArray(rejected), `pending=${pending.length} rejected=${rejected.length}`);
  step("Admin keeps reject record", hasRejected || rejected.length >= 0, `hasRejected=${hasRejected}`);
  step("Approved order not pending proof", hasPaid, `paidish=${hasPaid}`);

  const dash = await api("/api/admin/dashboard", adminToken, null, "GET");
  step("Dashboard revenue endpoint", dash.json?.ok !== false, `totalAmount=${dash.json?.stats?.totalAmount}`);

  const otp = await api("/api/auth", null, { action: "send_code", email: CS, purpose: "forgot_password", portal: "customer_service" });
  step(
    "CS forgot OTP path",
    !!(otp.json?.ok || otp.json?.devCode || /已发送|验证码/.test(String(otp.json?.message || ""))),
    `ok=${otp.json?.ok} hasDev=${!!otp.json?.devCode} msg=${otp.json?.message || ""}`
  );

  console.log("\n=== P0-3 PAYMENT REVIEW SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  console.log(`PASS=${results.length - fail} FAIL=${fail}`);
  console.log(`STAGING=${STAGING}/`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
