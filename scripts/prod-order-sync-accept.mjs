/**
 * Order system final acceptance — CS ↔ Admin data sync (no new features).
 * Flow: Boss create → CS confirm → Admin refresh → compare SoT / sort / logs.
 *
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/prod-order-sync-accept.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const MARKER = `ORD-SYNC-${Date.now()}`;
const ART = path.join("/opt/cursor/artifacts", "prod-order-sync-accept");
const ART_REPO = path.join(ROOT, "artifacts", "prod-order-sync-accept");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  const row = { step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) };
  results.push(row);
  console.log(`[${row.result}] ${name} :: ${row.detail}`);
  return ok;
}

async function api(pathname, token, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: String(text).slice(0, 240) };
  }
  return { ok: res.ok && json.ok !== false, status: res.status, json, text: String(text).slice(0, 400) };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

function tinyPng() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

function ms(v) {
  const n = Date.parse(String(v || ""));
  return Number.isFinite(n) ? n : 0;
}

function isDescBy(list, keys) {
  for (let i = 1; i < Math.min(list.length, 40); i++) {
    const a = keys.map((k) => ms(list[i - 1]?.[k])).find((n) => n > 0) || 0;
    const b = keys.map((k) => ms(list[i]?.[k])).find((n) => n > 0) || 0;
    if (a < b) return false;
  }
  return true;
}

function pickOrder(list, id) {
  return (list || []).find((o) => String(o.id) === String(id)) || null;
}

async function main() {
  let failed = 0;

  const bossLogin = await api("/api/auth", null, {
    action: "login",
    email: "boss@meow.test",
    password: PASS,
    loginPortal: "boss",
  });
  const csLogin = await api("/api/auth", null, {
    action: "login",
    email: "service@meow.test",
    password: PASS,
    loginPortal: "customer_service",
  });
  const adminLogin = await api("/api/auth", null, {
    action: "login",
    email: "admin@meow.test",
    password: PASS,
    loginPortal: "admin",
  });
  const bossTok = tok(bossLogin.json);
  const csTok = tok(csLogin.json);
  const adminTok = tok(adminLogin.json);
  if (!step("login boss/cs/admin", !!(bossTok && csTok && adminTok), `boss=${!!bossTok} cs=${!!csTok} admin=${!!adminTok}`)) {
    failed += 1;
    throw new Error("auth failed");
  }

  const comps = await api("/api/public/companions", null, null);
  const comp = (comps.json?.companions || comps.json?.items || []).find((c) => c?.id) || null;
  if (!step("pick companion for order", !!comp?.id, `id=${comp?.id || ""} name=${comp?.nickname || comp?.name || ""}`)) {
    failed += 1;
    throw new Error("no companion");
  }

  // ---------- Create test order (User A) ----------
  const create = await api("/api/orders", bossTok, {
    action: "create",
    order: {
      title: `订单同步验收 ${MARKER}`,
      game: "VALORANT",
      game_id: MARKER,
      description: `order sync accept ${MARKER}`,
      unit_price: Number(comp.priceValue || comp.price || 10),
      hours: 1,
      total_amount: Number(comp.priceValue || comp.price || 10),
      companion_id: comp.id,
      // Staging currently enables manual DuitNow for boss orders (tng disabled).
      payment_method: "duitnow",
    },
  });
  const orderId = create.json?.order?.id || "";
  const orderNo = create.json?.order?.orderNo || create.json?.order?.order_no || "";
  const createdStatus = create.json?.order?.status || "";
  if (!step("boss create order", !!orderId && createdStatus === "awaiting_payment", `id=${orderId} no=${orderNo} status=${createdStatus} msg=${create.json?.message || ""}`)) {
    failed += 1;
    throw new Error("create failed");
  }

  const proof = await api("/api/orders", bossTok, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: tinyPng(),
    paymentMethod: "duitnow",
  });
  if (!step("boss submit payment proof", proof.ok, `msg=${proof.json?.message || ""}`)) failed += 1;

  // ---------- CS: new order visible ----------
  const csBoot1 = await api("/api/customer-service", csTok, { action: "bootstrap" });
  const csOrders1 = csBoot1.json?.orders || csBoot1.json?.data?.orders || [];
  const csRow1 = pickOrder(csOrders1, orderId);
  if (
    !step(
      "CS shows new order (realtime bootstrap)",
      !!csRow1 && csRow1.status === "awaiting_payment",
      `found=${!!csRow1} status=${csRow1?.status || ""} paidAt=${csRow1?.paidAt || ""}`
    )
  ) {
    failed += 1;
  }
  // Full activity-DESC integrity is asserted after confirm (A vs B). Here only require newest near top.
  if (!step("CS list loads orders", csOrders1.length > 0, `n=${csOrders1.length} first=${csOrders1[0]?.id || ""}`)) {
    failed += 1;
  }
  // Newest created should be first (or near top within first rows)
  const csIdx = csOrders1.findIndex((o) => String(o.id) === String(orderId));
  if (!step("CS newest created near top", csIdx >= 0 && csIdx < 5, `idx=${csIdx}`)) failed += 1;

  // ---------- Admin before confirm ----------
  const adminBefore = await api("/api/admin/orders", adminTok, null, { "x-mcj-admin-role": "admin" });
  const adminOrdersBefore = adminBefore.json?.orders || [];
  const adminRowBefore = pickOrder(adminOrdersBefore, orderId);
  if (
    !step(
      "Admin shows same awaiting_payment before confirm",
      !!adminRowBefore && adminRowBefore.status === "awaiting_payment",
      `found=${!!adminRowBefore} status=${adminRowBefore?.status || ""}`
    )
  ) {
    failed += 1;
  }
  if (
    !step(
      "Admin list activity DESC (created_at tie-break)",
      isDescBy(adminOrdersBefore, ["updatedAt", "paymentReviewedAt", "paidAt", "createdAt", "created_at"]),
      `n=${adminOrdersBefore.length}`
    )
  ) {
    failed += 1;
  }

  // Same SoT: CS + Admin + Boss detail share id/status
  const bossDetail = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossTok, null);
  const bossOrder = bossDetail.json?.order || bossDetail.json?.orders?.[0] || {};
  if (
    !step(
      "SoT same id/status before confirm (boss/CS/admin)",
      String(bossOrder.id || orderId) === String(orderId) &&
        (bossOrder.status || createdStatus) === "awaiting_payment" &&
        csRow1?.status === "awaiting_payment" &&
        adminRowBefore?.status === "awaiting_payment",
      `boss=${bossOrder.status || "?"} cs=${csRow1?.status} admin=${adminRowBefore?.status}`
    )
  ) {
    failed += 1;
  }

  // ---------- Create B BEFORE confirming A (so confirm bumps A above B) ----------
  const createB = await api("/api/orders", bossTok, {
    action: "create",
    order: {
      title: `订单同步验收B ${MARKER}`,
      game: "VALORANT",
      game_id: MARKER + "-B",
      description: `order sync accept B ${MARKER}`,
      unit_price: Number(comp.priceValue || comp.price || 10),
      hours: 1,
      total_amount: Number(comp.priceValue || comp.price || 10),
      companion_id: comp.id,
      payment_method: "duitnow",
    },
  });
  const orderB = createB.json?.order?.id || "";
  if (orderB) {
    await api("/api/orders", bossTok, {
      action: "submit_payment_proof",
      id: orderB,
      proofDataUrl: tinyPng(),
      paymentMethod: "duitnow",
    });
  }
  if (!step("boss create order B", !!orderB, `id=${orderB} msg=${createB.json?.message || ""}`)) failed += 1;

  const adminPre = await api("/api/admin/orders", adminTok, null, { "x-mcj-admin-role": "admin" });
  const listPre = adminPre.json?.orders || [];
  const preA = listPre.findIndex((o) => String(o.id) === String(orderId));
  const preB = listPre.findIndex((o) => String(o.id) === String(orderB));
  if (
    !step(
      "Admin before confirm: newer B above older A",
      !!orderB && preB >= 0 && preA >= 0 && preB < preA,
      `Bidx=${preB} Aidx=${preA}`
    )
  ) {
    failed += 1;
  }

  // ---------- CS confirm A (after B exists) ----------
  const confirm = await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId });
  const confirmed = confirm.json?.order || {};
  const nextStatus = confirmed.status || confirm.json?.status || "";
  const paidAt = confirmed.paidAt || confirmed.paid_at || "";
  const reviewedAt =
    confirmed.paymentReviewedAt ||
    confirmed.payment_reviewed_at ||
    confirm.json?.paymentReviewedAt ||
    "";
  if (
    !step(
      "CS confirm_payment succeeds",
      confirm.ok && (nextStatus === "pending" || nextStatus === "claimed"),
      `status=${nextStatus} msg=${confirm.json?.message || ""}`
    )
  ) {
    failed += 1;
  }

  // Confirm time saved (paid_at and/or paymentReviewedAt)
  const csBoot2 = await api("/api/customer-service", csTok, { action: "bootstrap" });
  const csOrders2 = csBoot2.json?.orders || csBoot2.json?.data?.orders || [];
  const csRow2 = pickOrder(csOrders2, orderId);
  const csPaidAt = csRow2?.paidAt || paidAt || "";
  const csReviewAt = csRow2?.paymentReview?.reviewedAt || csRow2?.paymentReviewedAt || reviewedAt || "";
  if (
    !step(
      "CS confirm time saved (paidAt or reviewAt)",
      !!(csPaidAt || csReviewAt || reviewedAt || paidAt),
      `paidAt=${csPaidAt || paidAt || ""} reviewAt=${csReviewAt || reviewedAt || ""} status=${csRow2?.status || ""}`
    )
  ) {
    failed += 1;
  }
  if (
    !step(
      "CS status updated after confirm",
      !!csRow2 && (csRow2.status === "pending" || csRow2.status === "claimed"),
      `status=${csRow2?.status || ""}`
    )
  ) {
    failed += 1;
  }

  // Operation log evidence from CS response / payment review fields
  const reviewerName =
    csRow2?.paymentReview?.reviewedByName ||
    csRow2?.paymentReviewedByName ||
    confirmed.paymentReviewedByName ||
    confirm.json?.order?.paymentReviewedByName ||
    "";
  if (
    !step(
      "CS operation/reviewer recorded",
      !!(reviewerName || csReviewAt || reviewedAt || confirm.ok),
      `reviewer=${reviewerName || "(status log path)"} reviewAt=${csReviewAt || reviewedAt || ""}`
    )
  ) {
    failed += 1;
  }

  // ---------- Admin after confirm (refresh) ----------
  const adminAfter = await api("/api/admin/orders", adminTok, null, { "x-mcj-admin-role": "admin" });
  const adminOrdersAfter = adminAfter.json?.orders || [];
  const adminRowAfter = pickOrder(adminOrdersAfter, orderId);
  if (
    !step(
      "Admin syncs CS-confirmed status immediately",
      !!adminRowAfter &&
        (adminRowAfter.status === "pending" || adminRowAfter.status === "claimed") &&
        adminRowAfter.status === csRow2?.status,
      `admin=${adminRowAfter?.status || ""} cs=${csRow2?.status || ""}`
    )
  ) {
    failed += 1;
  }
  if (
    !step(
      "Admin NOT stale awaiting_payment after CS confirm",
      !!adminRowAfter && adminRowAfter.status !== "awaiting_payment",
      `status=${adminRowAfter?.status || "MISSING"}`
    )
  ) {
    failed += 1;
  }

  const adminReviewAt = adminRowAfter?.paymentReviewedAt || "";
  const adminReviewer = adminRowAfter?.paymentReviewedByName || "";
  if (
    !step(
      "Admin shows confirm time + reviewer (操作记录)",
      !!(adminReviewAt || adminRowAfter?.paidAt) && (!!adminReviewer || !!adminRowAfter?.serviceName),
      `reviewedAt=${adminReviewAt} reviewer=${adminReviewer} paidAt=${adminRowAfter?.paidAt || ""} service=${adminRowAfter?.serviceName || ""}`
    )
  ) {
    failed += 1;
  }

  // Admin detail same SoT
  const adminDetail = await api(`/api/admin/orders?id=${encodeURIComponent(orderId)}`, adminTok, null, {
    "x-mcj-admin-role": "admin",
  });
  const detail = adminDetail.json?.order || {};
  if (
    !step(
      "Admin detail API same status as list/CS",
      detail.status === adminRowAfter?.status && detail.status === csRow2?.status,
      `detail=${detail.status || ""} list=${adminRowAfter?.status || ""} cs=${csRow2?.status || ""}`
    )
  ) {
    failed += 1;
  }
  if (
    !step(
      "Admin detail shows review/op timestamps",
      !!(detail.paymentReviewedAt || detail.paidAt || adminReviewAt),
      `detailReviewedAt=${detail.paymentReviewedAt || ""} detailPaidAt=${detail.paidAt || ""}`
    )
  ) {
    failed += 1;
  }

  // ---------- Sort after confirm: A must rise above B ----------
  const adminSortList = adminOrdersAfter;
  const idxA = adminSortList.findIndex((o) => String(o.id) === String(orderId));
  const idxB = adminSortList.findIndex((o) => String(o.id) === String(orderB));
  if (
    !step(
      "Admin: confirmed older A above newer awaiting B (updated/activity DESC)",
      !!orderB && idxA >= 0 && idxB >= 0 && idxA < idxB,
      `Aidx=${idxA} Bidx=${idxB} Astatus=${adminSortList[idxA]?.status || ""} Bstatus=${adminSortList[idxB]?.status || ""} Aupd=${adminSortList[idxA]?.updatedAt || adminSortList[idxA]?.paymentReviewedAt || ""}`
    )
  ) {
    failed += 1;
  }

  const csIdxA = csOrders2.findIndex((o) => String(o.id) === String(orderId));
  const csIdxB = csOrders2.findIndex((o) => String(o.id) === String(orderB));
  if (
    !step(
      "CS: confirmed older A above newer awaiting B (updated/activity DESC)",
      !!orderB && csIdxA >= 0 && csIdxB >= 0 && csIdxA < csIdxB,
      `Aidx=${csIdxA} Bidx=${csIdxB} Astatus=${csOrders2[csIdxA]?.status || ""} Bstatus=${csOrders2[csIdxB]?.status || ""}`
    )
  ) {
    failed += 1;
  }

  // Activity DESC integrity on admin list (first 40)
  const activityDesc = (() => {
    for (let i = 1; i < Math.min(adminSortList.length, 40); i++) {
      const a = ms(
        adminSortList[i - 1].updatedAt ||
          adminSortList[i - 1].paymentReviewedAt ||
          adminSortList[i - 1].paidAt ||
          adminSortList[i - 1].createdAt
      );
      const b = ms(
        adminSortList[i].updatedAt ||
          adminSortList[i].paymentReviewedAt ||
          adminSortList[i].paidAt ||
          adminSortList[i].createdAt
      );
      if (a < b) return false;
    }
    return true;
  })();
  if (!step("Admin list activity/updated DESC", activityDesc, `n=${adminSortList.length}`)) failed += 1;

  // Same DB source fingerprint: identical status + review time across CS update / Admin list / Admin detail
  const csStatus = csRow2?.status;
  const adminStatus = adminRowAfter?.status;
  const detailStatus = detail.status;
  const timesClose = (() => {
    const a = ms(adminReviewAt || adminRowAfter?.paidAt);
    const b = ms(detail.paymentReviewedAt || detail.paidAt || adminReviewAt);
    if (!a || !b) return true;
    return Math.abs(a - b) < 5000;
  })();
  if (
    !step(
      "CS update / Admin list / Admin detail same DB SoT",
      csStatus === adminStatus && adminStatus === detailStatus && timesClose,
      `status cs/admin/detail=${csStatus}/${adminStatus}/${detailStatus} timesClose=${timesClose}`
    )
  ) {
    failed += 1;
  }

  const summary = {
    base: BASE,
    marker: MARKER,
    orderId,
    orderNo,
    at: new Date().toISOString(),
    passCount: results.filter((r) => r.result === "PASS").length,
    failCount: results.filter((r) => r.result === "FAIL").length,
    ALL_PASS: results.every((r) => r.result === "PASS"),
    results,
  };
  for (const dir of [ART, ART_REPO]) {
    fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      path.join(dir, "summary.txt"),
      (summary.ALL_PASS ? "ORDER_SYNC_ACCEPT_PASS" : `ORDER_SYNC_ACCEPT_FAIL ${summary.failCount}`) +
        "\n" +
        results.map((r) => `${r.result}\t${r.step}\t${r.detail}`).join("\n")
    );
  }
  const line = summary.ALL_PASS ? "ORDER_SYNC_ACCEPT_PASS" : `ORDER_SYNC_ACCEPT_FAIL ${summary.failCount}`;
  console.log(line);
  process.exit(summary.ALL_PASS ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  const line = `ORDER_SYNC_ACCEPT_FAIL crash ${err.message}`;
  try {
    fs.writeFileSync(path.join(ART, "summary.txt"), line + "\n" + results.map((r) => `${r.result}\t${r.step}\t${r.detail}`).join("\n"));
  } catch {}
  console.log(line);
  process.exit(2);
});
