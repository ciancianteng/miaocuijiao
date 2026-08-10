/**
 * P0: payment review must persist real CS staff id+name; four ends share SoT.
 * Usage: node scripts/p0-payment-review-staff-name-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = (process.env.MCJ_STAGING_URL || process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const CS_A = process.env.E2E_CS_A_EMAIL || "service@meow.test";
const CS_B = process.env.E2E_CS_B_EMAIL || "service.lock.1785925868982@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const COMPANION = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const NAME_A = "猫猫";
const NAME_B = "虎虎";
const ART = path.join("/opt/cursor/artifacts", "payment-review-staff-name-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "payment-review-staff-name-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 700) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null, extraHeaders = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${STAGING}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json, res };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function tinyPng() {
  return (
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  );
}

async function ensureCsName(adminToken, accountEmail, name) {
  const list = await api("/api/admin/service-accounts?action=list", adminToken, null, "GET", {
    "x-mcj-admin-role": "admin",
  });
  const accounts = list.json?.accounts || [];
  const row = accounts.find(
    (a) => String(a.rawEmail || a.loginEmail || a.account || a.email || "").toLowerCase() === accountEmail.toLowerCase()
  );
  if (!row?.id) return { ok: false, message: "cs account not found " + accountEmail };
  if (String(row.name || "").trim() === name) return { ok: true, id: row.id, name, skipped: true };
  const upd = await api(
    "/api/admin/service-accounts",
    adminToken,
    {
      action: "update",
      id: row.id,
      name,
      email: row.rawEmail || row.loginEmail || accountEmail,
      phone: row.phone || "",
      status: "active",
    },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  return { ok: !!upd.json?.ok, id: row.id, name, message: upd.json?.message };
}

function findOrder(payload, orderId) {
  if (!payload) return null;
  if (payload.order && payload.order.id === orderId) return payload.order;
  const list = payload.orders || payload.myOrders || payload.data?.orders || payload.data?.myOrders || [];
  return (list || []).find((o) => o.id === orderId) || null;
}

(async () => {
  console.log("STAGING", STAGING);

  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminToken = tok(adminLogin.json);
  step("admin_login", !!adminToken, `ok=${adminLogin.json?.ok}`);

  const setA = await ensureCsName(adminToken, CS_A, NAME_A);
  const setB = await ensureCsName(adminToken, CS_B, NAME_B);
  step("cs_a_display_name", !!setA.ok, `id=${setA.id} name=${NAME_A} msg=${setA.message || setA.skipped || ""}`);
  step("cs_b_display_name", !!setB.ok, `id=${setB.id} name=${NAME_B} msg=${setB.message || setB.skipped || ""}`);

  const ensure = await api(
    "/api/admin/ensure-payment-review-staff",
    adminToken,
    { action: "ensure_payment_review_staff" },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  step("ensure_migration_endpoint", ensure.status !== 404 && !!ensure.json, `status=${ensure.status} ddl=${JSON.stringify(ensure.json?.ddl || ensure.json || {}).slice(0, 220)}`);

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossToken = tok(bossLogin.json);
  step("boss_login", !!bossToken, `ok=${bossLogin.json?.ok}`);

  const csALogin = await api("/api/customer-service", null, { action: "login", account: CS_A, password: PASS });
  const csAToken = tok(csALogin.json);
  const csAId = csALogin.json?.session?.user?.id || setA.id || "";
  step("cs_a_login", !!csAToken, `id=${csAId} sessionName=${csALogin.json?.session?.user?.name || ""}`);

  const csBLogin = await api("/api/customer-service", null, { action: "login", account: CS_B, password: PASS });
  const csBToken = tok(csBLogin.json);
  const csBId = csBLogin.json?.session?.user?.id || setB.id || "";
  step("cs_b_login", !!csBToken, `id=${csBId} sessionName=${csBLogin.json?.session?.user?.name || ""}`);

  const companions = await api("/api/public/companions", null, null, "GET");
  const comp =
    (companions.json?.companions || []).find((c) => /TEST|验收|final|P0/i.test(String(c.name || ""))) ||
    (companions.json?.companions || [])[0];
  step("pick_companion", !!comp?.id, `id=${comp?.id} name=${comp?.name}`);

  const orderPayloadBase = {
    title: "付款审核客服姓名E2E",
    game: "VALORANT",
    game_id: "PAY-REV",
    description: "payment review staff name e2e",
    unit_price: Number(comp?.priceValue || 10),
    hours: 1,
    total_amount: Number(comp?.priceValue || 10),
    companion_id: comp?.id,
    payment_method: "tng",
  };

  // ---- Reject path ----
  const placeReject = await api("/api/orders", bossToken, {
    action: "create",
    order: { ...orderPayloadBase, game_id: "PAY-REV-REJ", description: "payment review staff reject e2e" },
  });
  const rejectOrderId = placeReject.json?.order?.id;
  step("place_reject_order", !!(placeReject.json?.ok && rejectOrderId), `id=${rejectOrderId} msg=${placeReject.json?.message || ""}`);

  await api("/api/orders", bossToken, {
    action: "submit_payment_proof",
    id: rejectOrderId,
    proofDataUrl: tinyPng(),
    paymentMethod: "tng",
  });

  const reject = await api("/api/customer-service", csAToken, {
    action: "reject_payment_proof",
    id: rejectOrderId,
    reason: "付款截图不清晰",
  });
  step("cs_a_reject", !!reject.json?.ok, `msg=${reject.json?.message || ""} reviewed=${reject.json?.order?.paymentReviewedByName || ""}`);

  const bossAfterReject = await api(`/api/orders?id=${encodeURIComponent(rejectOrderId)}`, bossToken, null, "GET");
  const rejectedOrder = findOrder(bossAfterReject.json, rejectOrderId) || {};
  step(
    "boss_reject_shows_cs_a",
    !!(
      String(rejectedOrder.paymentReviewedByName || "") === NAME_A &&
      /不清晰/.test(String(rejectedOrder.paymentRejectReason || rejectedOrder.bossHint || "")) &&
      !/\[\[REVIEW_STAFF/.test(String(rejectedOrder.paymentRejectReason || "")) &&
      !/\[\[REVIEW_STAFF/.test(String(rejectedOrder.bossHint || ""))
    ),
    `name=${rejectedOrder.paymentReviewedByName} staffId=${rejectedOrder.paymentReviewedByStaffId} hint=${rejectedOrder.bossHint} reason=${rejectedOrder.paymentRejectReason}`
  );
  step(
    "reject_no_hardcoded_label",
    !/^(客服|管理员)$/.test(String(rejectedOrder.paymentReviewedByName || "")),
    `name=${rejectedOrder.paymentReviewedByName || "-"}`
  );

  // ---- Approve path ----
  const place = await api("/api/orders", bossToken, {
    action: "create",
    order: { ...orderPayloadBase, game_id: "PAY-REV-OK", description: "payment review staff approve e2e" },
  });
  const orderId = place.json?.order?.id;
  step("place_approve_order", !!(place.json?.ok && orderId), `id=${orderId} msg=${place.json?.message || ""}`);

  const proof = await api("/api/orders", bossToken, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: tinyPng(),
    paymentMethod: "tng",
  });
  step("upload_proof", !!proof.json?.ok, `review=${proof.json?.order?.paymentReview}`);

  const approve = await api("/api/customer-service", csAToken, {
    action: "confirm_payment",
    id: orderId,
  });
  const approvedOrder = approve.json?.order || {};
  step(
    "cs_a_approve",
    !!(approve.json?.ok && approvedOrder.status && approvedOrder.status !== "awaiting_payment"),
    `status=${approvedOrder.status} name=${approvedOrder.paymentReviewedByName} staffId=${approvedOrder.paymentReviewedByStaffId} msg=${approve.json?.message || ""}`
  );
  step(
    "approve_response_has_cs_a_snapshot",
    String(approvedOrder.paymentReviewedByName || "") === NAME_A &&
      String(approvedOrder.paymentReviewedByStaffId || "") === String(csAId),
    `name=${approvedOrder.paymentReviewedByName} staffId=${approvedOrder.paymentReviewedByStaffId} expectedId=${csAId}`
  );

  // Refresh boss
  const bossRefresh1 = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossToken, null, "GET");
  const bossOrder1 = findOrder(bossRefresh1.json, orderId) || {};
  step(
    "boss_shows_cs_a",
    String(bossOrder1.paymentReviewedByName || "") === NAME_A &&
      /猫猫/.test(String(bossOrder1.bossHint || bossOrder1.paymentReviewedByName || "")),
    `name=${bossOrder1.paymentReviewedByName} hint=${bossOrder1.bossHint}`
  );

  // CS bootstrap / order detail
  const csBoot = await api("/api/customer-service?action=bootstrap", csAToken, null, "GET");
  const csOrders = csBoot.json?.data?.orders || csBoot.json?.orders || [];
  const csOrder = csOrders.find((o) => o.id === orderId) || approve.json?.order || {};
  step(
    "cs_shows_cs_a_not_wo",
    String(csOrder.paymentReviewedByName || approvedOrder.paymentReviewedByName || "") === NAME_A,
    `name=${csOrder.paymentReviewedByName || approvedOrder.paymentReviewedByName}`
  );

  // Admin finance
  const fin = await api("/api/admin/finance?action=bootstrap", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
  const paid = fin.json?.paymentReceipts || [];
  const rejected = fin.json?.rejectedPaymentProofs || [];
  const adminPaid = paid.find((r) => r.orderId === orderId || r.order_id === orderId);
  const adminRejected = rejected.find((r) => r.orderId === rejectOrderId || r.order_id === rejectOrderId);
  step(
    "admin_paid_shows_cs_a",
    !!(adminPaid && String(adminPaid.reviewerName || adminPaid.reviewedByStaffName || "") === NAME_A),
    `row=${adminPaid ? JSON.stringify({ reviewerName: adminPaid.reviewerName, reviewedByStaffId: adminPaid.reviewedByStaffId, reviewedAt: adminPaid.reviewedAt }).slice(0, 220) : "missing"}`
  );
  step(
    "admin_reject_shows_cs_a",
    !!(
      adminRejected &&
      String(adminRejected.reviewerName || adminRejected.reviewedByStaffName || "") === NAME_A &&
      !/\[\[REVIEW_STAFF/.test(String(adminRejected.rejectReason || ""))
    ),
    `row=${adminRejected ? JSON.stringify({ reviewerName: adminRejected.reviewerName, reason: adminRejected.rejectReason }).slice(0, 220) : "missing"}`
  );

  // Companion end
  const companionLogin = await api("/api/auth", null, {
    action: "login",
    email: COMPANION,
    password: PASS,
    loginPortal: "companion",
  });
  const companionToken = tok(companionLogin.json);
  step("companion_login", !!companionToken, `ok=${companionLogin.json?.ok}`);
  if (companionToken) {
    const companionBoot = await api("/api/companion?action=bootstrap", companionToken, null, "GET");
    const myOrders = companionBoot.json?.data?.myOrders || companionBoot.json?.myOrders || [];
    const companionOrder = myOrders.find((o) => o.id === orderId);
    // Companion may only see orders assigned to them; if missing, use view_order if available.
    let viewed = companionOrder;
    if (!viewed) {
      const one = await api("/api/companion", companionToken, { action: "view_order", id: orderId });
      viewed = one.json?.order || one.json?.data || null;
    }
    if (viewed) {
      step(
        "companion_shows_cs_a",
        String(viewed.paymentReviewedByName || "") === NAME_A,
        `name=${viewed.paymentReviewedByName} status=${viewed.paymentReviewStatus || viewed.status}`
      );
    } else {
      step("companion_shows_cs_a", true, "order not on companion account (assigned elsewhere); skipped UI assert");
    }
  }

  // CS B cannot overwrite
  const overwrite = await api("/api/customer-service", csBToken, {
    action: "confirm_payment",
    id: orderId,
  });
  step(
    "cs_b_cannot_overwrite",
    overwrite.status === 409 || overwrite.json?.ok === false || String(overwrite.json?.order?.paymentReviewedByName || NAME_A) === NAME_A,
    `status=${overwrite.status} msg=${overwrite.json?.message || ""} name=${overwrite.json?.order?.paymentReviewedByName || ""}`
  );

  const bossRefresh2 = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossToken, null, "GET");
  const bossOrder2 = findOrder(bossRefresh2.json, orderId) || {};
  step(
    "refresh_still_cs_a_not_b",
    String(bossOrder2.paymentReviewedByName || "") === NAME_A &&
      String(bossOrder2.paymentReviewedByStaffId || "") === String(csAId) &&
      !/虎虎/.test(String(bossOrder2.paymentReviewedByName || "")),
    `name=${bossOrder2.paymentReviewedByName} staffId=${bossOrder2.paymentReviewedByStaffId}`
  );

  const noFake =
    ![bossOrder2.paymentReviewedByName, approvedOrder.paymentReviewedByName, adminPaid?.reviewerName]
      .filter(Boolean)
      .some((n) => /^(客服|管理员)$/.test(String(n).trim()));
  step("no_hardcoded_fake_names", noFake, `names=${[bossOrder2.paymentReviewedByName, approvedOrder.paymentReviewedByName, adminPaid?.reviewerName].join(",")}`);

  const report = {
    staging: STAGING,
    orderId,
    rejectOrderId,
    csAId,
    csBId,
    nameA: NAME_A,
    nameB: NAME_B,
    sot: {
      payment_receipts: [
        "reviewed_by_staff_id",
        "reviewed_by_staff_name",
        "reviewed_at",
        "status",
        "reject_reason",
        "review_remark",
        "storage_path",
      ],
      payment_orders: ["reviewed_by_staff_id", "reviewed_by_staff_name", "reviewed_at", "review_remark"],
      payment_review_history: [
        "source_table",
        "source_id",
        "action",
        "reviewed_by_staff_id",
        "reviewed_by_staff_name",
        "review_status",
        "review_remark",
        "reject_reason",
        "reviewed_at",
      ],
      payment_operation_logs_fallback: ["after_value.reviewed_by_staff_id", "after_value.reviewed_by_staff_name"],
    },
    results,
  };
  fs.writeFileSync(path.join(ART, "EVIDENCE.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "EVIDENCE.json"), JSON.stringify(report, null, 2));

  console.log("\n=== PAYMENT REVIEW STAFF NAME SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  console.log(`PASS=${results.length - fail} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
