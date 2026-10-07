/**
 * Boss recharge (payment_orders) proof review — shared by 后台 /api/admin/wallet and 客服
 * /api/customer-service so both ends read and write the same rows with the same rules.
 *
 * Crediting goes through creditRechargePayment → mcj_wallet_credit_recharge, which locks the
 * row and short-circuits once credited, so approve is idempotent at the DB level.
 */
import {
  isMissingRelation,
  money,
  notifyBoss,
  creditRechargePayment,
  restUrl,
  serviceHeaders,
  supabaseJson,
  writeAdminLog,
} from "./_wallet.js";
import { staffReviewerNameFromProfile } from "./_payment-receipts.js";
import { companionDb, createSignedUrl } from "./_companion-media-store.js";
import { bankMethodLabels } from "./_payment-bank-accounts.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Statuses that still need a human decision. */
export const RECHARGE_PENDING_REVIEW = "pending_review";

function fail(status, message, extra = {}) {
  return { status, body: { ok: false, message, ...extra } };
}

async function loadRecharge(paymentNo) {
  const key = String(paymentNo || "").trim();
  if (!key) return null;
  const match = UUID_RE.test(key)
    ? `or=(payment_no.eq.${encodeURIComponent(key)},id.eq.${encodeURIComponent(key)})`
    : `payment_no=eq.${encodeURIComponent(key)}`;
  const rows = await supabaseJson(restUrl("payment_orders", `?${match}&limit=1`), { headers: serviceHeaders() });
  return rows?.[0] || null;
}

async function signedProofUrl(row) {
  const raw = row.raw_response && typeof row.raw_response === "object" ? row.raw_response : {};
  const storedUrl = String(row.proof_url || raw.proofUrl || "").trim();
  const bucket = String(row.proof_bucket || raw.proofBucket || "companion-payment-proofs").trim();
  const objectPath = String(row.proof_path || raw.proofPath || "").trim();
  if (bucket && objectPath) {
    try {
      return (await createSignedUrl(bucket, objectPath, 60 * 60)) || "";
    } catch {
      return "";
    }
  }
  return /^https?:\/\//i.test(storedUrl) ? storedUrl : "";
}

export async function latestPendingRechargePaymentNo() {
  try {
    const rows = await listPendingReviewRows(1);
    return String(rows?.[0]?.payment_no || "");
  } catch {
    return "";
  }
}

export async function countPendingRechargeReviews() {
  try {
    const res = await fetch(restUrl("payment_orders", `?status=eq.${RECHARGE_PENDING_REVIEW}&select=id`), {
      headers: { ...serviceHeaders(), Prefer: "count=exact", Range: "0-0" },
    });
    const range = res.headers.get("content-range") || "";
    const total = Number(range.split("/")[1]);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {{ status?: string, includeProofPath?: boolean }} opts
 *   status: pending_review (default) | queue | paid | rejected | all | any payment_orders status
 */
/** submitted_at is optional on payment_orders (proof writer falls back to raw_response); never let the sort hide rows. */
async function listPendingReviewRows(limit) {
  try {
    return await supabaseJson(
      restUrl("payment_orders", `?status=eq.pending_review&order=submitted_at.desc.nullslast,created_at.desc&limit=${limit}`),
      { headers: serviceHeaders() }
    );
  } catch (e) {
    if (!/submitted_at|column|PGRST|42703/i.test(`${e?.message || ""} ${JSON.stringify(e?.body || "")}`)) throw e;
    return supabaseJson(restUrl("payment_orders", `?status=eq.pending_review&order=created_at.desc&limit=${limit}`), {
      headers: serviceHeaders(),
    });
  }
}

export async function listRecharges({ status = RECHARGE_PENDING_REVIEW, includeProofPath = false, limit = 200 } = {}) {
  const statusFilter = String(status || RECHARGE_PENDING_REVIEW).trim();
  let rows = [];
  try {
    if (statusFilter === "pending_all" || statusFilter === "queue") {
      const [a, b] = await Promise.all([
        listPendingReviewRows(limit).catch(() => []),
        supabaseJson(restUrl("payment_orders", `?status=eq.pending_payment&order=created_at.desc&limit=100`), {
          headers: serviceHeaders(),
        }).catch(() => []),
      ]);
      rows = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
    } else if (statusFilter === "reviewed") {
      rows = await supabaseJson(
        restUrl("payment_orders", `?status=in.(paid,credited,rejected)&order=updated_at.desc.nullslast,created_at.desc&limit=${limit}`),
        { headers: serviceHeaders() }
      );
    } else if (statusFilter === RECHARGE_PENDING_REVIEW) {
      rows = await listPendingReviewRows(limit);
    } else if (statusFilter && statusFilter !== "all") {
      rows = await supabaseJson(
        restUrl("payment_orders", `?status=eq.${encodeURIComponent(statusFilter)}&order=created_at.desc&limit=${limit}`),
        { headers: serviceHeaders() }
      );
    } else {
      rows = await supabaseJson(restUrl("payment_orders", `?order=created_at.desc&limit=${limit}`), { headers: serviceHeaders() });
    }
  } catch (e) {
    if (isMissingRelation(e)) rows = [];
    else throw e;
  }
  const list = Array.isArray(rows) ? rows : [];
  const bossIds = [...new Set(list.map((r) => r.boss_id).filter(Boolean))];
  const profileMap = {};
  if (bossIds.length) {
    try {
      const profiles = await supabaseJson(
        restUrl(
          "profiles",
          `?id=in.(${bossIds.map(encodeURIComponent).join(",")})&select=id,display_name,nickname,email,phone`
        ),
        { headers: serviceHeaders() }
      );
      for (const p of Array.isArray(profiles) ? profiles : []) profileMap[p.id] = p;
    } catch {
      /* names optional */
    }
  }
  const bankLabels = await bankMethodLabels(list.map((row) => row.payment_method)).catch(() => ({}));
  const items = [];
  for (const row of list) {
    const p = profileMap[row.boss_id] || {};
    const raw = row.raw_response && typeof row.raw_response === "object" ? row.raw_response : {};
    const objectPath = String(row.proof_path || raw.proofPath || "").trim();
    const item = {
      id: row.id,
      paymentNo: row.payment_no || row.id,
      bossId: row.boss_id || "",
      bossName: p.display_name || p.nickname || p.email || "老板",
      bossEmail: p.email || "",
      amountRm: money(row.amount),
      catFoodAmount: money(row.cat_food_amount || row.paid_cat_food),
      paidCatFood: money(row.paid_cat_food || row.cat_food_amount),
      bonusCatFood: money(row.bonus_cat_food),
      totalCatFood: money(row.cat_food_amount) || money(row.paid_cat_food) + money(row.bonus_cat_food),
      paymentMethod: row.payment_method || "",
      paymentMethodName: bankLabels[String(row.payment_method || "").toLowerCase()] || "",
      status: row.status || "pending_payment",
      paymentUrl: row.payment_url || "",
      proofUrl: await signedProofUrl(row),
      hasProof: !!(objectPath || row.proof_url || raw.proofUrl),
      rejectReason: String(row.reject_reason || raw.rejectReason || "").trim(),
      reviewedByStaffId: row.reviewed_by_staff_id || raw.reviewedByStaffId || "",
      reviewedByStaffName: String(row.reviewed_by_staff_name || raw.reviewedByStaffName || "").trim(),
      reviewedAt: row.reviewed_at || raw.reviewedAt || "",
      submittedAt: row.submitted_at || raw.submittedAt || "",
      createdAt: row.created_at || "",
      creditedAt: row.credited_at || "",
    };
    if (includeProofPath) item.proofPath = objectPath;
    items.push(item);
  }
  return items;
}

/**
 * @param {{ paymentNo: string, reviewer: object, reason?: string, tradeNo?: string,
 *           operatorRole?: string, requireProof?: boolean, idempotencyPrefix?: string }} opts
 */
export async function approveRecharge({
  paymentNo,
  reviewer,
  reason = "",
  tradeNo = "",
  operatorRole = "admin",
  requireProof = false,
  idempotencyPrefix = "admin-confirm",
}) {
  if (!String(paymentNo || "").trim()) return fail(400, "缺少 paymentNo");
  const order = await loadRecharge(paymentNo);
  if (!order) return fail(404, "充值订单不存在");
  const operatorId = reviewer?.id || null;
  const st = String(order.status || "").toLowerCase();
  if (st === "paid" || st === "credited") {
    return { status: 200, body: { ok: true, message: "该充值单已到账", paymentNo: order.payment_no, duplicate: true } };
  }
  if (st === "rejected") return fail(409, "该充值单已被拒绝，不能再通过");
  if (!/pending|pending_payment|pending_review|awaiting|unpaid|manual/i.test(st)) {
    return fail(400, `当前状态不可确认到账：${order.status || "-"}`);
  }
  const raw = order.raw_response && typeof order.raw_response === "object" ? order.raw_response : {};
  const hasProof = !!(order.proof_path || order.proof_url || raw.proofPath || raw.proofUrl);
  if (!hasProof && (st === "pending_review" || requireProof)) {
    return fail(400, "该充值单缺少付款截图，不能审核通过");
  }
  if (order.reviewed_by_staff_id && String(order.reviewed_by_staff_id) !== String(operatorId || "")) {
    return fail(409, "该充值单已由其他审核人处理，不可覆盖审核人。", {
      reviewedByStaffId: order.reviewed_by_staff_id,
      reviewedByStaffName: order.reviewed_by_staff_name || "",
    });
  }
  const staffName = staffReviewerNameFromProfile(reviewer || {});
  if (!staffName) return fail(400, "当前账号未设置真实显示名称，请先在资料中填写姓名后再审核。");
  const reviewedAt = new Date().toISOString();
  const remark = String(reason || "审核通过");
  try {
    await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(order.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        reviewed_by_staff_id: operatorId,
        reviewed_by_staff_name: staffName,
        reviewed_at: reviewedAt,
        review_remark: remark,
        updated_at: reviewedAt,
      }),
    });
  } catch {
    const rawKeep = { ...raw, reviewedByStaffId: operatorId, reviewedByStaffName: staffName, reviewedAt };
    await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(order.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ raw_response: rawKeep, updated_at: reviewedAt }),
    }).catch(() => null);
  }
  await companionDb("payment_review_history", "", {
    method: "POST",
    body: JSON.stringify({
      source_table: "payment_orders",
      source_id: order.id,
      action: "approved",
      reviewed_by_staff_id: operatorId,
      reviewed_by_staff_name: staffName,
      review_status: "approved",
      review_remark: remark,
      reviewed_at: reviewedAt,
      created_at: reviewedAt,
    }),
  }).catch(() => null);
  const trade = String(tradeNo || `MANUAL-${Date.now()}`).trim();
  const result = await creditRechargePayment(order.payment_no, trade, `${idempotencyPrefix}:${order.payment_no}`);
  await writeAdminLog({
    module: "wallet",
    action: "confirm_manual_recharge",
    targetType: "payment_order",
    targetId: order.payment_no,
    operatorId,
    operatorRole,
    reason: String(reason || "确认线下转账到账"),
    after: { ...result, reviewedByStaffId: operatorId, reviewedByStaffName: staffName },
  }).catch(() => null);
  if (!result?.duplicate) {
    // Inbox row is written by mcj_wallet_credit_recharge; only fan out Web Push here.
    try {
      const { fanoutWebPush } = await import("./_web-push.js");
      fanoutWebPush(order.boss_id, {
        title: "充值到账",
        body: `充值成功，订单 ${order.payment_no} 猫粮已入账。`,
        url: "/recharge.html",
        notificationType: "recharge",
        entityId: order.payment_no,
        tag: "boss-recharge-" + order.payment_no,
      });
    } catch {
      /* optional */
    }
  }
  return {
    status: 200,
    body: {
      ok: true,
      message: result?.duplicate ? "已到账（重复确认被忽略）" : "已确认到账，猫粮已入账",
      result,
      duplicate: !!result?.duplicate,
      paymentNo: order.payment_no,
      reviewedByStaffId: operatorId,
      reviewedByStaffName: staffName,
      reviewedAt,
    },
  };
}

export async function rejectRecharge({ paymentNo, reviewer, reason = "", operatorRole = "admin" }) {
  const why = String(reason || "").trim();
  if (!String(paymentNo || "").trim()) return fail(400, "缺少 paymentNo");
  if (!why) return fail(400, "请填写拒绝原因");
  const order = await loadRecharge(paymentNo);
  if (!order) return fail(404, "充值订单不存在");
  const operatorId = reviewer?.id || null;
  const st = String(order.status || "").toLowerCase();
  if (st === "paid" || st === "credited") return fail(409, "已到账订单不能拒绝");
  if (st === "rejected") {
    return { status: 200, body: { ok: true, message: "该充值申请已拒绝", paymentNo: order.payment_no, duplicate: true } };
  }
  if (!/pending_review|pending_payment|pending/i.test(st)) return fail(400, `当前状态不可拒绝：${order.status || "-"}`);
  if (order.reviewed_by_staff_id && String(order.reviewed_by_staff_id) !== String(operatorId || "")) {
    return fail(409, "该充值单已由其他审核人处理，不可覆盖审核人。");
  }
  const staffName = staffReviewerNameFromProfile(reviewer || {});
  if (!staffName) return fail(400, "当前账号未设置真实显示名称，请先在资料中填写姓名后再审核。");
  const reviewedAt = new Date().toISOString();
  const raw = order.raw_response && typeof order.raw_response === "object" ? { ...order.raw_response } : {};
  Object.assign(raw, { rejectReason: why, rejectedAt: reviewedAt, reviewedByStaffId: operatorId, reviewedByStaffName: staffName, reviewedAt });
  // Only rows still pending may flip, so a concurrent approve can never be overwritten.
  const guard = `?id=eq.${encodeURIComponent(order.id)}&status=in.(pending_review,pending_payment,pending)`;
  let saved = null;
  try {
    const rows = await supabaseJson(restUrl("payment_orders", guard), {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        status: "rejected",
        raw_response: raw,
        reject_reason: why,
        reviewed_by_staff_id: operatorId,
        reviewed_by_staff_name: staffName,
        reviewed_at: reviewedAt,
        review_remark: why,
        updated_at: reviewedAt,
      }),
    });
    saved = rows?.[0] || null;
  } catch (err) {
    if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    const rows = await supabaseJson(restUrl("payment_orders", guard), {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({ status: "rejected", raw_response: raw, updated_at: reviewedAt }),
    });
    saved = rows?.[0] || null;
  }
  if (!saved) return fail(409, "该充值单状态已变化，请刷新后再试");
  await companionDb("payment_review_history", "", {
    method: "POST",
    body: JSON.stringify({
      source_table: "payment_orders",
      source_id: order.id,
      action: "rejected",
      reviewed_by_staff_id: operatorId,
      reviewed_by_staff_name: staffName,
      review_status: "rejected",
      reject_reason: why,
      review_remark: why,
      reviewed_at: reviewedAt,
      created_at: reviewedAt,
    }),
  }).catch(() => null);
  await writeAdminLog({
    module: "wallet",
    action: "reject_manual_recharge",
    targetType: "payment_order",
    targetId: order.payment_no,
    operatorId,
    operatorRole,
    reason: why,
    after: saved,
  }).catch(() => null);
  await notifyBoss(
    order.boss_id,
    "充值审核未通过",
    `充值单 ${order.payment_no} 未通过（审核客服：${staffName}）：${why}`,
    "wallet",
    order.payment_no
  ).catch(() => null);
  return {
    status: 200,
    body: {
      ok: true,
      message: "已拒绝该充值申请",
      paymentNo: order.payment_no,
      reason: why,
      reviewedByStaffId: operatorId,
      reviewedByStaffName: staffName,
      reviewedAt,
    },
  };
}
