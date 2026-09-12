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
  // Boss re-upload: supersede any pending receipt (do not mark as CS-rejected).
  const active = await companionDb("payment_receipts", `?order_id=eq.${encodeURIComponent(order.id)}&status=eq.pending&limit=1`).catch(() => []);
  if (active?.[0]) {
    await companionDb("payment_receipts", `?id=eq.${encodeURIComponent(active[0].id)}&status=eq.pending`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "superseded",
        reviewed_at: nowIso(),
      }),
    }).catch(() => {});
  }
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

async function insertPaidTransaction({ order, receipt, reviewerId, at }) {
  const rows = await companionDb("payment_transactions", "", {
    method: "POST",
    body: JSON.stringify({
      order_id: order.id,
      receipt_id: receipt.id,
      boss_id: order.boss_id,
      gross_amount: money(order.total_amount),
      refunded_amount: 0,
      net_amount: money(order.total_amount),
      payment_status: "paid",
      payment_method: receipt.payment_method || paymentMethod(order),
      confirmed_by: reviewerId,
      confirmed_at: at,
      created_at: at,
    }),
  });
  return rows?.[0] || null;
}

/** Recover approved receipt that never got a payment_transactions row (half-commit). */
export async function recoverApprovedWithoutTx({ order, reviewerId }) {
  const existing = await companionDb(
    "payment_transactions",
    `?order_id=eq.${encodeURIComponent(order.id)}&payment_status=eq.paid&limit=1`
  ).catch(() => []);
  if (existing?.[0]) return { transaction: existing[0], receipt: null, duplicate: true };
  const approvedRows = await companionDb(
    "payment_receipts",
    `?order_id=eq.${encodeURIComponent(order.id)}&status=eq.approved&order=reviewed_at.desc&limit=1`
  ).catch(() => []);
  const approvedReceipt = approvedRows?.[0] || null;
  if (!approvedReceipt) return null;
  const at = nowIso();
  try {
    const transaction = await insertPaidTransaction({
      order,
      receipt: approvedReceipt,
      reviewerId: reviewerId || approvedReceipt.confirmed_by || approvedReceipt.reviewed_by,
      at,
    });
    return { transaction, receipt: approvedReceipt, duplicate: false, recovered: true };
  } catch (error) {
    if (!/duplicate|unique/i.test(String(error?.message || ""))) throw error;
    const replay = await companionDb(
      "payment_transactions",
      `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`
    ).catch(() => []);
    return { transaction: replay?.[0] || null, receipt: approvedReceipt, duplicate: true, recovered: true };
  }
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
    // Receipt already approved but TX insert previously failed — recover instead of 409.
    const recovered = await recoverApprovedWithoutTx({ order, reviewerId });
    if (recovered?.transaction) return recovered;
    throw Object.assign(new Error("付款凭证已被处理，请刷新后重试。"), { status: 409 });
  }
  try {
    const transaction = await insertPaidTransaction({ order, receipt: approvedReceipt, reviewerId, at });
    return { transaction, receipt: approvedReceipt, duplicate: false };
  } catch (error) {
    if (!/duplicate|unique/i.test(String(error?.message || ""))) {
      // Keep approved receipt; next confirm_payment will recover via recoverApprovedWithoutTx.
      console.warn("[approveAndLedger] TX insert failed after approve", error?.message || error);
      throw error;
    }
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

export async function listPendingForAdmin() {
  const receipts = await companionDb("payment_receipts", "?status=eq.pending&order=uploaded_at.asc&limit=500").catch(() => []);
  const orderIds = [...new Set((receipts || []).map((row) => row.order_id).filter(Boolean))];
  let orders = [];
  if (orderIds.length) {
    orders = await companionDb(
      "orders",
      `?id=in.(${orderIds.map(encodeURIComponent).join(",")})&select=id,order_no,boss_id,companion_id,total_amount,status,payment_method,note,description&limit=500`
    ).catch(() => []);
  }
  const orderMap = Object.fromEntries((orders || []).map((row) => [row.id, row]));
  return Promise.all(
    (receipts || []).map(async (receipt) => {
      const order = orderMap[receipt.order_id] || {};
      const proofUrl = await signedProofUrl(receipt).catch(() => "");
      return {
        ...receipt,
        order,
        orderNo: order.order_no || order.id || receipt.order_id || "",
        amount: money(receipt.amount != null ? receipt.amount : order.total_amount),
        proofUrl: proofUrl || "",
      };
    })
  );
}

export async function listRejectedForAdmin({ limit = 200 } = {}) {
  const receipts = await companionDb(
    "payment_receipts",
    `?status=eq.rejected&order=reviewed_at.desc&limit=${Math.min(500, Number(limit) || 200)}`
  ).catch(() => []);
  const filtered = (receipts || []).filter((row) => String(row.reject_reason || "") !== "老板重新上传付款凭证");
  const orderIds = [...new Set(filtered.map((row) => row.order_id).filter(Boolean))];
  const reviewerIds = [...new Set(filtered.map((row) => row.reviewed_by).filter(Boolean))];
  const bossIds = [...new Set(filtered.map((row) => row.boss_id).filter(Boolean))];
  let orders = [];
  let profiles = [];
  if (orderIds.length) {
    orders = await companionDb(
      "orders",
      `?id=in.(${orderIds.map(encodeURIComponent).join(",")})&select=id,order_no,boss_id,companion_id,total_amount,status,payment_method,note,description&limit=500`
    ).catch(() => []);
  }
  const profileIds = [...new Set([...bossIds, ...reviewerIds])];
  if (profileIds.length) {
    profiles = await companionDb(
      "profiles",
      `?id=in.(${profileIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,role,boss_uid&limit=500`
    ).catch(() => []);
  }
  const orderMap = Object.fromEntries((orders || []).map((row) => [row.id, row]));
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  return Promise.all(
    filtered.map(async (receipt) => {
      const order = orderMap[receipt.order_id] || {};
      const boss = profileMap[receipt.boss_id || order.boss_id] || {};
      const reviewer = profileMap[receipt.reviewed_by] || {};
      const proofUrl = await signedProofUrl(receipt).catch(() => "");
      return {
        ...receipt,
        order,
        orderNo: order.order_no || order.id || receipt.order_id || "",
        bossName: String(boss.display_name || "").trim() || boss.email || receipt.boss_id || "",
        bossUid: boss.boss_uid || "",
        reviewerName: String(reviewer.display_name || "").trim() || reviewer.email || receipt.reviewed_by || "",
        amount: money(receipt.amount != null ? receipt.amount : order.total_amount),
        proofUrl: proofUrl || "",
      };
    })
  );
}

/** Enrich pending/approved admin rows with boss + reviewer display names. */
export async function enrichReceiptAudit(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const bossIds = [...new Set(list.map((r) => r.boss_id || r.bossId || r.order?.boss_id).filter(Boolean))];
  const reviewerIds = [
    ...new Set(list.flatMap((r) => [r.reviewed_by, r.confirmed_by, r.receipt?.reviewed_by, r.receipt?.confirmed_by]).filter(Boolean)),
  ];
  const profileIds = [...new Set([...bossIds, ...reviewerIds])];
  const profiles = profileIds.length
    ? await companionDb(
        "profiles",
        `?id=in.(${profileIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,role,boss_uid&limit=800`
      ).catch(() => [])
    : [];
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  return Promise.all(
    list.map(async (row) => {
      const receipt = row.receipt || row;
      const bossId = row.boss_id || row.bossId || row.order?.boss_id || "";
      const reviewerId = row.reviewed_by || row.confirmed_by || receipt.reviewed_by || receipt.confirmed_by || "";
      const boss = profileMap[bossId] || {};
      const reviewer = profileMap[reviewerId] || {};
      const proofUrl = row.proofUrl || (await signedProofUrl(receipt).catch(() => "")) || "";
      return {
        ...row,
        orderNo: row.orderNo || row.order?.order_no || row.order_id || row.orderId || "",
        bossName: String(boss.display_name || "").trim() || boss.email || bossId || "",
        bossUid: boss.boss_uid || "",
        reviewerName: String(reviewer.display_name || "").trim() || reviewer.email || reviewerId || "",
        reviewedAt: row.reviewed_at || row.confirmed_at || receipt.reviewed_at || receipt.confirmed_at || "",
        rejectReason: row.reject_reason || receipt.reject_reason || "",
        proofUrl,
      };
    })
  );
}

export async function latestRejectedForOrders(orderIds = []) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const receipts = await companionDb(
    "payment_receipts",
    `?order_id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.rejected&order=reviewed_at.desc&limit=500`
  ).catch(() => []);
  const map = {};
  for (const row of receipts || []) {
    if (!row?.order_id || map[row.order_id]) continue;
    // Ignore legacy auto-reject rows created by older re-upload path.
    if (String(row.reject_reason || "") === "老板重新上传付款凭证") continue;
    map[row.order_id] = row;
  }
  return map;
}

export async function listPaidForAdmin({ year = "", month = "" } = {}) {
  const rows = await companionDb("payment_transactions", "?payment_status=eq.paid&order=confirmed_at.desc&limit=2000").catch(() => []);
  const receipts = await companionDb("payment_receipts", "?status=eq.approved&limit=2000").catch(() => []);
  const receiptMap = Object.fromEntries((receipts || []).map((row) => [row.id, row]));
  const filtered = (rows || [])
    .filter((row) => {
      const date = String(row.confirmed_at || row.created_at || "");
      return (!year || date.startsWith(year)) && (!month || date.slice(5, 7) === String(month).padStart(2, "0"));
    })
    .map((row) => ({ ...row, receipt: receiptMap[row.receipt_id] || null }));
  return Promise.all(
    filtered.map(async (row) => {
      const proofUrl = row.receipt ? await signedProofUrl(row.receipt).catch(() => "") : "";
      return { ...row, proofUrl: proofUrl || "" };
    })
  );
}

export function exportCsv(rows = []) {
  return "付款单号,订单ID,凭证编号,老板ID,金额,付款方式,确认时间,凭证路径\n" + rows.map((row) =>
    [row.id, row.order_id, row.receipt?.receipt_no || "", row.boss_id, row.net_amount, row.payment_method, row.confirmed_at, row.receipt?.storage_path || ""]
      .map(csvCell).join(",")
  ).join("\n");
}

export async function signedProofUrl(receipt, expiresIn = 3600) {
  if (!receipt?.storage_path) return "";
  const ttl = Math.max(300, Number(expiresIn) || 3600);
  return createSignedUrl(receipt.storage_bucket || BUCKET, receipt.storage_path, ttl);
}

export async function latestReceiptForOrder(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return null;
  const rows = await companionDb(
    "payment_receipts",
    `?order_id=eq.${encodeURIComponent(id)}&status=in.(pending,approved)&order=uploaded_at.desc&limit=1`
  ).catch(() => []);
  return rows?.[0] || null;
}
