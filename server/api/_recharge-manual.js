/**
 * Manual recharge review helpers shared by admin wallet + customer-service.
 * Status model:
 *   pending_payment = 待支付
 *   pending_review  = 待审核
 *   paid            = 已完成
 *   rejected        = 审核拒绝
 *   cancelled / expired = 已取消 / 已过期
 */
import {
  buildObjectPath,
  createSignedUrl,
  decodeDataUrl,
  ensurePrivateBucket,
  uploadPrivateObject,
} from "./_companion-media-store.js";
import { creditRechargePayment, money } from "./_wallet.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const PROOF_BUCKET = "companion-payment-proofs";
const PROOF_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export const RECHARGE_STATUS_TEXT = {
  pending: "待支付",
  pending_payment: "待支付",
  pending_review: "待审核",
  paid: "已完成",
  credited: "已完成",
  rejected: "审核拒绝",
  cancelled: "已取消",
  expired: "已过期",
  failed: "失败",
  unavailable: "暂未开放",
};

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    "User-Agent": "MCJ-Server/1.0",
    Prefer: "return=representation",
    ...extra,
  };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body?.message || body?.hint || body?.details || body?.error_description || (typeof body === "string" ? body : "") || "Supabase 请求失败";
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

export function rechargeStatusText(status) {
  const key = String(status || "").toLowerCase();
  return RECHARGE_STATUS_TEXT[key] || status || "-";
}

export function normalizeRechargeStatus(status) {
  const key = String(status || "").toLowerCase();
  if (key === "pending" || key === "awaiting" || key === "unpaid") return "pending_payment";
  if (key === "credited") return "paid";
  return key || "pending_payment";
}

export function rawOf(row) {
  return row?.raw_response && typeof row.raw_response === "object" ? row.raw_response : {};
}

export function proofOf(row) {
  return rawOf(row).proof || null;
}

export async function signedRechargeProofUrl(proof) {
  if (!proof?.bucket || !proof?.path) return "";
  try {
    return (await createSignedUrl(proof.bucket, proof.path, 60 * 30)) || "";
  } catch {
    return "";
  }
}

export function viewRechargeRecord(row, extras = {}) {
  const raw = rawOf(row);
  const proof = raw.proof || null;
  const status = normalizeRechargeStatus(row.status);
  return {
    id: row.id,
    paymentNo: row.payment_no || row.id,
    amount: money(row.amount),
    amountRm: money(row.amount),
    catFoodAmount: money(row.cat_food_amount),
    paidCatFood: money(row.paid_cat_food || row.cat_food_amount),
    bonusCatFood: money(row.bonus_cat_food),
    campaignId: row.campaign_id || "",
    paymentMethod: row.payment_method || "",
    status,
    statusText: rechargeStatusText(status),
    paymentUrl: row.payment_url || "",
    creditedAt: row.credited_at || "",
    createdAt: row.created_at || "",
    hasProof: Boolean(proof?.path),
    proofUploadedAt: proof?.uploadedAt || raw.submittedAt || "",
    rejectReason: raw.rejectReason || raw.reject_reason || "",
    rejectedAt: raw.rejectedAt || "",
    canResubmit: status === "rejected" || status === "pending_payment",
    canCancel: status === "pending_payment",
    ...extras,
  };
}

export async function findPaymentOrderByNo(paymentNo) {
  const no = String(paymentNo || "").trim();
  if (!no) return null;
  const query = isUuid(no)
    ? `?or=(payment_no.eq.${encodeURIComponent(no)},id.eq.${encodeURIComponent(no)})&limit=1`
    : `?payment_no=eq.${encodeURIComponent(no)}&limit=1`;
  const rows = await supabaseJson(restUrl("payment_orders", query), { headers: serviceHeaders() });
  return rows?.[0] || null;
}

export async function patchPaymentOrder(id, patch) {
  if (!id) return null;
  const rows = await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

export async function listRechargeOrders({ status = "pending_review", limit = 200 } = {}) {
  let query = `?order=created_at.desc&limit=${Math.min(Math.max(Number(limit) || 200, 1), 500)}`;
  const st = String(status || "").trim();
  if (st === "pending_payment" || st === "pending") {
    query = `?status=in.(pending_payment,pending)&order=created_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`;
  } else if (st === "pending_review" || st === "review") {
    query = `?status=eq.pending_review&order=created_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`;
  } else if (st === "queue" || st === "awaiting_review") {
    // CS/admin work queue: only screenshot-submitted.
    query = `?status=eq.pending_review&order=created_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`;
  } else if (st === "open") {
    query = `?status=in.(pending_payment,pending,pending_review,rejected)&order=created_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`;
  } else if (st && st !== "all") {
    query = `?status=eq.${encodeURIComponent(st)}&order=created_at.desc&limit=${Math.min(Number(limit) || 200, 500)}`;
  }
  const rows = await supabaseJson(restUrl("payment_orders", query), { headers: serviceHeaders() }).catch((e) => {
    if (/relation|does not exist|schema cache/i.test(String(e.message || ""))) return [];
    throw e;
  });
  const list = Array.isArray(rows) ? rows : [];
  const bossIds = [...new Set(list.map((r) => r.boss_id).filter(Boolean))];
  const profileMap = {};
  await Promise.all(
    bossIds.map(async (id) => {
      try {
        const profiles = await supabaseJson(
          restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&select=id,display_name,nickname,email,phone&limit=1`),
          { headers: serviceHeaders() }
        );
        profileMap[id] = profiles?.[0] || null;
      } catch {
        profileMap[id] = null;
      }
    })
  );
  const items = await Promise.all(
    list.map(async (row) => {
      const p = profileMap[row.boss_id] || {};
      const proof = proofOf(row);
      const proofUrl = await signedRechargeProofUrl(proof);
      return {
        ...viewRechargeRecord(row, {
          bossId: row.boss_id || "",
          bossName: p.display_name || p.nickname || p.email || "老板",
          bossEmail: p.email || "",
          proofUrl,
        }),
      };
    })
  );
  return items;
}

export async function uploadRechargeProofFile({ paymentOrder, bossId, dataUrl }) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded?.buffer?.length || !PROOF_TYPES.has(String(decoded.contentType || "").toLowerCase())) {
    throw Object.assign(new Error("请上传 JPG、PNG 或 WEBP 格式的付款截图"), { status: 400 });
  }
  if (decoded.buffer.length > 10 * 1024 * 1024) {
    throw Object.assign(new Error("付款截图不能超过 10MB"), { status: 413 });
  }
  await ensurePrivateBucket(PROOF_BUCKET, [...PROOF_TYPES]);
  const ext = String(decoded.contentType).includes("png") ? "png" : String(decoded.contentType).includes("webp") ? "webp" : "jpg";
  const paymentNo = String(paymentOrder.payment_no || paymentOrder.id);
  const storagePath = buildObjectPath(bossId, `recharge-proofs/${paymentNo}`, `proof-${Date.now()}.${ext}`);
  await uploadPrivateObject(PROOF_BUCKET, storagePath, decoded.buffer, decoded.contentType);
  return { bucket: PROOF_BUCKET, path: storagePath, uploadedAt: new Date().toISOString() };
}

export async function submitRechargeProof({ paymentOrder, bossId, dataUrl }) {
  const status = normalizeRechargeStatus(paymentOrder.status);
  if (/paid|cancelled|expired|failed|unavailable/.test(status)) {
    throw Object.assign(new Error("当前充值单状态不可再提交付款截图。"), { status: 409 });
  }
  if (!/pending_payment|pending_review|rejected/.test(status)) {
    throw Object.assign(new Error("当前充值单状态不可再提交付款截图。"), { status: 409 });
  }
  const proof = await uploadRechargeProofFile({ paymentOrder, bossId, dataUrl });
  const prevRaw = rawOf(paymentOrder);
  const saved = await patchPaymentOrder(paymentOrder.id, {
    status: "pending_review",
    raw_response: {
      ...prevRaw,
      mode: "manual",
      message: "老板已上传付款截图，等待人工审核。",
      proof,
      submittedAt: new Date().toISOString(),
      rejectReason: "",
      rejectedAt: "",
      rejectedBy: "",
    },
  });
  return saved || paymentOrder;
}

export async function confirmManualRecharge({ paymentNo, operatorId = null, operatorRole = "admin", reason = "" }) {
  const order = await findPaymentOrderByNo(paymentNo);
  if (!order) throw Object.assign(new Error("充值订单不存在"), { status: 404 });
  const st = normalizeRechargeStatus(order.status);
  if (st === "paid") {
    return { ok: true, duplicate: true, message: "该充值单已到账", paymentNo: order.payment_no, order };
  }
  if (st !== "pending_review") {
    if (st === "pending_payment") {
      throw Object.assign(new Error("老板尚未上传付款截图，不能审核通过。"), { status: 400 });
    }
    if (st === "rejected") {
      throw Object.assign(new Error("该充值单已被拒绝，请等待老板重新上传凭证。"), { status: 400 });
    }
    throw Object.assign(new Error(`当前状态不可确认到账：${rechargeStatusText(st)}`), { status: 400 });
  }
  if (!proofOf(order)?.path) {
    throw Object.assign(new Error("缺少付款截图，不能审核通过。"), { status: 400 });
  }
  const tradeNo = `MANUAL-${Date.now()}`;
  const idem = `manual-confirm:${order.payment_no}`;
  const result = await creditRechargePayment(order.payment_no, tradeNo, idem);
  const prevRaw = rawOf(order);
  await patchPaymentOrder(order.id, {
    status: "paid",
    raw_response: {
      ...prevRaw,
      approvedAt: new Date().toISOString(),
      approvedBy: operatorId || "",
      approvedRole: operatorRole || "",
      approveReason: String(reason || "人工确认到账"),
    },
  }).catch(() => null);
  return {
    ok: true,
    duplicate: Boolean(result?.duplicate),
    message: result?.duplicate ? "已到账（重复确认被忽略）" : "已确认到账，猫粮已入账",
    paymentNo: order.payment_no,
    result,
    order,
  };
}

export async function rejectManualRecharge({ paymentNo, operatorId = null, operatorRole = "admin", reason = "" }) {
  const why = String(reason || "").trim();
  if (!why) throw Object.assign(new Error("请填写拒绝原因"), { status: 400 });
  const order = await findPaymentOrderByNo(paymentNo);
  if (!order) throw Object.assign(new Error("充值订单不存在"), { status: 404 });
  const st = normalizeRechargeStatus(order.status);
  if (st === "paid") throw Object.assign(new Error("已完成的充值单不能拒绝"), { status: 400 });
  if (st !== "pending_review") {
    if (st === "pending_payment") {
      throw Object.assign(new Error("老板尚未提交付款截图，请等待提交后再审核。"), { status: 400 });
    }
    throw Object.assign(new Error(`当前状态不可拒绝：${rechargeStatusText(st)}`), { status: 400 });
  }
  const prevRaw = rawOf(order);
  const saved = await patchPaymentOrder(order.id, {
    status: "rejected",
    raw_response: {
      ...prevRaw,
      message: "充值审核已拒绝，请按原因重新上传付款截图。",
      rejectReason: why,
      rejectedAt: new Date().toISOString(),
      rejectedBy: operatorId || "",
      rejectedRole: operatorRole || "",
    },
  });
  return {
    ok: true,
    message: "已拒绝该充值单",
    paymentNo: order.payment_no,
    order: saved || order,
    rejectReason: why,
  };
}

export function hasRechargeDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}
