import {
  buildObjectPath,
  companionDb,
  createSignedUrl,
  decodeDataUrl,
  ensurePrivateBucket,
  uploadPrivateObject,
} from "./_companion-media-store.js";

const BUCKET = "companion-payment-proofs";
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const nowIso = () => new Date().toISOString();
const receiptNo = () => `PAYR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function paymentMethod(order = {}) {
  const text = String(order.payment_method || order.paymentMethod || order.description || "");
  const hit = text.match(/付款方式[：:]\s*([^\n；;]+)/i);
  return (hit ? hit[1] : text).trim() || "manual";
}

export async function uploadProof({ order, bossId, dataUrl, paymentMethod: method }) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded?.buffer?.length || !IMAGE_TYPES.has(String(decoded.contentType).toLowerCase())) {
    throw Object.assign(new Error("请上传 JPG、PNG 或 WEBP 格式的付款凭证"), { status: 400 });
  }
  if (decoded.buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error("付款凭证不能超过 10MB"), { status: 413 });
  const active = await companionDb("payment_receipts", `?order_id=eq.${encodeURIComponent(order.id)}&status=eq.pending&limit=1`).catch(() => []);
  if (active?.[0]) return { receipt: active[0], duplicate: true };
  const previous = await companionDb("payment_receipts", `?order_id=eq.${encodeURIComponent(order.id)}&select=version&order=version.desc&limit=1`).catch(() => []);
  const version = Number(previous?.[0]?.version || 0) + 1;
  await ensurePrivateBucket(BUCKET, [...IMAGE_TYPES]);
  const ext = String(decoded.contentType).includes("png") ? "png" : String(decoded.contentType).includes("webp") ? "webp" : "jpg";
  const storagePath = buildObjectPath(bossId, `payment-proofs/${order.id}`, `proof-v${version}.${ext}`);
  await uploadPrivateObject(BUCKET, storagePath, decoded.buffer, decoded.contentType);
  const rows = await companionDb("payment_receipts", "", {
    method: "POST",
    body: JSON.stringify({
      receipt_no: receiptNo(), order_id: order.id, boss_id: bossId, storage_bucket: BUCKET, storage_path: storagePath,
      payment_method: String(method || paymentMethod(order)), amount: money(order.total_amount), status: "pending", version,
      uploaded_at: nowIso(), created_at: nowIso(),
    }),
  });
  return { receipt: rows?.[0] || null, duplicate: false };
}

export async function listPendingForCs({ orderIds = [] } = {}) {
  const query = orderIds.length
    ? `?status=eq.pending&order_id=in.(${orderIds.map(encodeURIComponent).join(",")})&order=uploaded_at.asc&limit=500`
    : "?status=eq.pending&order=uploaded_at.asc&limit=500";
  return companionDb("payment_receipts", query).catch(() => []);
}

export async function approveAndLedger({ order, receipt, reviewerId }) {
  const existing = await companionDb("payment_transactions", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`).catch(() => []);
  if (existing?.[0]) return { transaction: existing[0], duplicate: true };
  const at = nowIso();
  const approved = await companionDb("payment_receipts", `?id=eq.${encodeURIComponent(receipt.id)}&status=eq.pending`, {
    method: "PATCH",
    body: JSON.stringify({ status: "approved", reviewed_at: at, reviewed_by: reviewerId, confirmed_at: at, confirmed_by: reviewerId }),
  });
  const approvedReceipt = approved?.[0];
  if (!approvedReceipt) {
    const replay = await companionDb("payment_transactions", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`).catch(() => []);
    if (replay?.[0]) return { transaction: replay[0], duplicate: true };
    throw Object.assign(new Error("付款凭证已被处理，请刷新后重试。"), { status: 409 });
  }
  try {
    const rows = await companionDb("payment_transactions", "", {
      method: "POST",
      body: JSON.stringify({
        order_id: order.id, receipt_id: approvedReceipt.id, boss_id: order.boss_id,
        gross_amount: money(order.total_amount), refunded_amount: 0, net_amount: money(order.total_amount),
        payment_status: "paid", payment_method: approvedReceipt.payment_method, confirmed_by: reviewerId, confirmed_at: at, created_at: at,
      }),
    });
    return { transaction: rows?.[0] || null, receipt: approvedReceipt, duplicate: false };
  } catch (error) {
    if (!/duplicate|unique/i.test(String(error?.message || ""))) throw error;
    const replay = await companionDb("payment_transactions", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`);
    return { transaction: replay?.[0] || null, receipt: approvedReceipt, duplicate: true };
  }
}

export async function rejectProof({ receipt, reviewerId, reason }) {
  const rows = await companionDb("payment_receipts", `?id=eq.${encodeURIComponent(receipt.id)}&status=eq.pending`, {
    method: "PATCH",
    body: JSON.stringify({ status: "rejected", reject_reason: reason, reviewed_at: nowIso(), reviewed_by: reviewerId }),
  });
  if (!rows?.[0]) throw Object.assign(new Error("付款凭证已被处理，请刷新后重试。"), { status: 409 });
  return rows[0];
}

export async function listPaidForAdmin({ year = "", month = "" } = {}) {
  const rows = await companionDb("payment_transactions", "?payment_status=eq.paid&order=confirmed_at.desc&limit=2000").catch(() => []);
  const receipts = await companionDb("payment_receipts", "?status=eq.approved&limit=2000").catch(() => []);
  const receiptMap = Object.fromEntries((receipts || []).map((row) => [row.id, row]));
  return (rows || []).filter((row) => {
    const date = String(row.confirmed_at || row.created_at || "");
    return (!year || date.startsWith(year)) && (!month || date.slice(5, 7) === String(month).padStart(2, "0"));
  }).map((row) => ({ ...row, receipt: receiptMap[row.receipt_id] || null }));
}

export function exportCsv(rows = []) {
  return "付款单号,订单ID,凭证编号,老板ID,金额,付款方式,确认时间,凭证路径\n" + rows.map((row) =>
    [row.id, row.order_id, row.receipt?.receipt_no || "", row.boss_id, row.net_amount, row.payment_method, row.confirmed_at, row.receipt?.storage_path || ""]
      .map(csvCell).join(",")
  ).join("\n");
}

export async function signedProofUrl(receipt) {
  return receipt?.storage_path ? createSignedUrl(receipt.storage_bucket || BUCKET, receipt.storage_path, 300) : "";
}
