import {
  buildObjectPath,
  companionDb,
  createSignedUrl,
  decodeDataUrl,
  ensurePrivateBucket,
  uploadPrivateObject,
} from "./_companion-media-store.js";
import { isDbUuid, isDevLogin } from "./_account-codes.js";

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

/** Real staff display name only — never email / uuid / hardcoded 客服|管理员. */
export function staffReviewerNameFromProfile(profile = {}) {
  const name = String(profile.display_name || profile.nickname || profile.name || "").trim();
  if (!name) return "";
  if (/@/.test(name) || isDbUuid(name) || isDevLogin(name)) return "";
  if (/^(客服|管理员|admin|cs|customer[\s_-]?service)$/i.test(name)) return "";
  return name;
}

export async function loadStaffReviewer(staffId) {
  const id = String(staffId || "").trim();
  if (!id || !isDbUuid(id)) return { id: "", name: "" };
  const rows = await companionDb(
    "profiles",
    `?id=eq.${encodeURIComponent(id)}&select=id,display_name,nickname,email,role&limit=1`
  ).catch(() => []);
  const profile = rows?.[0] || null;
  return { id, name: staffReviewerNameFromProfile(profile || {}), profile };
}

const REVIEW_STAFF_MARK_RE = /\[\[REVIEW_STAFF:([^\]|]+)\|([^\]|]+)\|([^\]]+)\]\]/;

export function encodeReviewStaffMark({ staffId, staffName, reviewedAt }) {
  const id = String(staffId || "").trim();
  const name = String(staffName || "").trim().replace(/[|\]]/g, "");
  const at = String(reviewedAt || nowIso()).trim();
  if (!id || !name) return "";
  return `[[REVIEW_STAFF:${id}|${name}|${at}]]`;
}

export function parseReviewStaffMark(text = "") {
  const m = String(text || "").match(REVIEW_STAFF_MARK_RE);
  if (!m) return null;
  return {
    reviewed_by_staff_id: String(m[1] || "").trim(),
    reviewed_by_staff_name: String(m[2] || "").trim(),
    reviewed_at: String(m[3] || "").trim(),
  };
}

export function stripReviewStaffMark(text = "") {
  return String(text || "")
    .replace(REVIEW_STAFF_MARK_RE, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function receiptReviewerFields(receipt = {}) {
  const marked = parseReviewStaffMark(receipt.review_remark || "") || parseReviewStaffMark(receipt.reject_reason || "");
  const staffId = String(
    receipt.reviewed_by_staff_id || marked?.reviewed_by_staff_id || receipt.reviewed_by || receipt.confirmed_by || ""
  ).trim();
  const staffName = String(receipt.reviewed_by_staff_name || marked?.reviewed_by_staff_name || "").trim();
  return {
    paymentReviewedByStaffId: staffId,
    paymentReviewedByName: staffName,
    paymentReviewedAt: receipt.reviewed_at || marked?.reviewed_at || receipt.confirmed_at || "",
    paymentReviewStatus: receipt.status || "",
    paymentRejectReason: stripReviewStaffMark(receipt.reject_reason || ""),
    paymentReviewRemark: stripReviewStaffMark(receipt.review_remark || ""),
  };
}

/** Durable snapshot when payment_review_history / staff columns are not yet migrated. */
async function appendOperationLogSnapshot({
  sourceTable,
  sourceId,
  action,
  staffId,
  staffName,
  reviewStatus,
  reviewRemark = "",
  rejectReason = "",
  reviewedAt,
}) {
  try {
    await companionDb("payment_operation_logs", "", {
      method: "POST",
      body: JSON.stringify({
        id: `payrev-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        action: `payment_review_${String(action || reviewStatus || "review")}`,
        target_id: String(sourceId || ""),
        operator_role: "customer_service",
        ip: "",
        device: sourceTable || "",
        before_value: null,
        after_value: {
          source_table: sourceTable,
          source_id: sourceId,
          reviewed_by_staff_id: staffId || null,
          reviewed_by_staff_name: String(staffName || ""),
          review_status: String(reviewStatus || ""),
          review_remark: String(reviewRemark || ""),
          reject_reason: String(rejectReason || ""),
          reviewed_at: reviewedAt || nowIso(),
        },
        created_at: nowIso(),
      }),
    });
  } catch (error) {
    if (!/PGRST205|Could not find the table|schema cache|does not exist/i.test(String(error?.message || ""))) {
      console.warn("[payment_operation_logs review]", error?.message || error);
    }
  }
}

/** Load first-reviewer snapshots from payment_operation_logs (never overwrite-first). */
export async function loadReviewerSnapshotsFromLogs(sourceIds = []) {
  const ids = [...new Set((sourceIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await companionDb(
    "payment_operation_logs",
    `?or=(action.eq.payment_review_approved,action.eq.payment_review_rejected,action.eq.payment_review_review)&target_id=in.(${ids.map(encodeURIComponent).join(",")})&order=created_at.asc&limit=1000`
  ).catch(() => []);
  const map = {};
  for (const row of rows || []) {
    const tid = String(row?.target_id || "").trim();
    if (!tid || map[tid]) continue;
    const after = row.after_value && typeof row.after_value === "object" ? row.after_value : {};
    const name = String(after.reviewed_by_staff_name || "").trim();
    const staffId = String(after.reviewed_by_staff_id || "").trim();
    if (!name && !staffId) continue;
    map[tid] = {
      reviewed_by_staff_id: staffId || null,
      reviewed_by_staff_name: name,
      reviewed_at: after.reviewed_at || row.created_at || "",
      review_status: after.review_status || "",
      review_remark: after.review_remark || "",
      reject_reason: after.reject_reason || "",
    };
  }
  return map;
}

/** Merge DB columns + log snapshot (columns win when present). */
export function mergeReceiptReviewerSnapshot(receipt = {}, logSnap = null) {
  if (!receipt) return receipt;
  const storedName = String(receipt.reviewed_by_staff_name || "").trim();
  const storedId = String(receipt.reviewed_by_staff_id || "").trim();
  if (storedName && storedId) return receipt;
  if (!logSnap) return receipt;
  return {
    ...receipt,
    reviewed_by_staff_id: storedId || logSnap.reviewed_by_staff_id || receipt.reviewed_by || null,
    reviewed_by_staff_name: storedName || String(logSnap.reviewed_by_staff_name || "").trim(),
    reviewed_at: receipt.reviewed_at || logSnap.reviewed_at || "",
    review_remark: receipt.review_remark || logSnap.review_remark || "",
    reject_reason: receipt.reject_reason || logSnap.reject_reason || "",
  };
}

export async function hydrateReceiptReviewers(receipts = []) {
  const list = Array.isArray(receipts) ? receipts : [];
  if (!list.length) return list;
  const need = list.filter((r) => r && !String(r.reviewed_by_staff_name || "").trim());
  let snaps = {};
  if (need.length) {
    snaps = await loadReviewerSnapshotsFromLogs(need.map((r) => r.id));
  }
  const merged = list.map((r) => mergeReceiptReviewerSnapshot(r, snaps[r?.id] || null));
  const withMarks = merged.map((r) => {
    if (!r || String(r.reviewed_by_staff_name || "").trim()) return r;
    const marked = parseReviewStaffMark(r.review_remark || "") || parseReviewStaffMark(r.reject_reason || "");
    if (!marked?.reviewed_by_staff_name) return r;
    return {
      ...r,
      reviewed_by_staff_id: r.reviewed_by_staff_id || marked.reviewed_by_staff_id || r.reviewed_by || null,
      reviewed_by_staff_name: marked.reviewed_by_staff_name,
      reviewed_at: r.reviewed_at || marked.reviewed_at || "",
    };
  });
  // Live profiles fallback for legacy rows / missing DDL columns — keyed by immutable reviewed_by id.
  const stillNeed = withMarks.filter((r) => r && !String(r.reviewed_by_staff_name || "").trim());
  if (!stillNeed.length) return withMarks;
  const ids = [
    ...new Set(
      stillNeed
        .map((r) => String(r.reviewed_by_staff_id || r.reviewed_by || r.confirmed_by || "").trim())
        .filter((id) => isDbUuid(id))
    ),
  ];
  if (!ids.length) return withMarks;
  const profiles = await companionDb(
    "profiles",
    `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,nickname,email,role&limit=500`
  ).catch(() => []);
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  return withMarks.map((r) => {
    if (!r || String(r.reviewed_by_staff_name || "").trim()) return r;
    const id = String(r.reviewed_by_staff_id || r.reviewed_by || r.confirmed_by || "").trim();
    const name = staffReviewerNameFromProfile(profileMap[id] || {});
    if (!name) return r;
    return {
      ...r,
      reviewed_by_staff_id: id || r.reviewed_by_staff_id || null,
      reviewed_by_staff_name: name,
    };
  });
}

/** Persist reviewer snapshot beside proof file when DB columns / history table unavailable. */
async function writeReviewSidecar(receipt, snapshot) {
  const base = String(receipt?.storage_path || "").trim();
  if (!base) return;
  try {
    await uploadPrivateObject(
      BUCKET,
      `${base}.staff-review.json`,
      Buffer.from(JSON.stringify(snapshot), "utf8"),
      "text/plain"
    );
  } catch (error) {
    console.warn("[payment_review_sidecar]", error?.message || error);
  }
}

async function readReviewSidecar(receipt) {
  const base = String(receipt?.storage_path || "").trim();
  if (!base) return null;
  try {
    const url = await createSignedUrl(receipt.storage_bucket || BUCKET, `${base}.staff-review.json`, 180);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== "object") return null;
    return {
      reviewed_by_staff_id: json.reviewed_by_staff_id || null,
      reviewed_by_staff_name: String(json.reviewed_by_staff_name || "").trim(),
      reviewed_at: json.reviewed_at || "",
      review_status: json.review_status || "",
      review_remark: json.review_remark || "",
      reject_reason: json.reject_reason || "",
    };
  } catch {
    return null;
  }
}

async function appendReviewHistory({
  sourceTable,
  sourceId,
  action,
  staffId,
  staffName,
  reviewStatus,
  reviewRemark = "",
  rejectReason = "",
  reviewedAt,
}) {
  const payload = {
    sourceTable,
    sourceId,
    action,
    staffId,
    staffName,
    reviewStatus,
    reviewRemark,
    rejectReason,
    reviewedAt,
  };
  try {
    await companionDb("payment_review_history", "", {
      method: "POST",
      body: JSON.stringify({
        source_table: sourceTable,
        source_id: sourceId,
        action: String(action || ""),
        reviewed_by_staff_id: staffId || null,
        reviewed_by_staff_name: String(staffName || ""),
        review_status: String(reviewStatus || ""),
        review_remark: String(reviewRemark || ""),
        reject_reason: String(rejectReason || ""),
        reviewed_at: reviewedAt || nowIso(),
        created_at: nowIso(),
      }),
    });
  } catch (error) {
    // History table may be missing before migration; never block approve/reject.
    if (!/PGRST205|Could not find the table|schema cache|does not exist/i.test(String(error?.message || ""))) {
      console.warn("[payment_review_history]", error?.message || error);
    }
  }
  // Always dual-write to existing payment_operation_logs so snapshot survives without DDL.
  await appendOperationLogSnapshot(payload);
}

async function persistReviewerSnapshotArtifacts(receipt, payload) {
  await appendReviewHistory(payload);
  await writeReviewSidecar(receipt, {
    source_table: payload.sourceTable,
    source_id: payload.sourceId,
    reviewed_by_staff_id: payload.staffId || null,
    reviewed_by_staff_name: String(payload.staffName || ""),
    review_status: String(payload.reviewStatus || ""),
    review_remark: String(payload.reviewRemark || ""),
    reject_reason: String(payload.rejectReason || ""),
    reviewed_at: payload.reviewedAt || nowIso(),
  });
}

function reviewPatch({ staffId, staffName, status, at, reason = "", remark = "" }) {
  const mark = encodeReviewStaffMark({ staffId, staffName, reviewedAt: at });
  // Always embed snapshot mark into existing text columns so name survives without DDL.
  const reasonWithMark =
    status === "rejected"
      ? [String(reason || "").trim(), mark].filter(Boolean).join("\n")
      : mark;
  const remarkWithMark = [String(remark || reason || "").trim(), mark].filter(Boolean).join("\n");
  const patch = {
    status,
    reviewed_at: at,
    reviewed_by: staffId || null,
    reviewed_by_staff_id: staffId || null,
    reviewed_by_staff_name: String(staffName || ""),
    // For approved rows reject_reason normally empty — use it as durable name SoT when columns missing.
    reject_reason: status === "rejected" ? reasonWithMark : mark,
    review_remark: remarkWithMark,
  };
  if (status === "approved") {
    patch.confirmed_at = at;
    patch.confirmed_by = staffId || null;
  }
  return patch;
}

async function patchReceiptReview(receiptId, patch) {
  // Prefer full staff snapshot columns; fall back if migration not applied yet.
  try {
    return await companionDb("payment_receipts", `?id=eq.${encodeURIComponent(receiptId)}&status=eq.pending`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch (error) {
    const msg = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
    if (!/reviewed_by_staff|review_remark|Could not find the .* column/i.test(msg)) throw error;
    const legacy = {
      status: patch.status,
      reviewed_at: patch.reviewed_at,
      reviewed_by: patch.reviewed_by,
      // Keep REVIEW_STAFF mark inside reject_reason (existing column) as durable name snapshot.
      reject_reason: patch.reject_reason || "",
    };
    if (patch.confirmed_at) legacy.confirmed_at = patch.confirmed_at;
    if (patch.confirmed_by) legacy.confirmed_by = patch.confirmed_by;
    return companionDb("payment_receipts", `?id=eq.${encodeURIComponent(receiptId)}&status=eq.pending`, {
      method: "PATCH",
      body: JSON.stringify(legacy),
    });
  }
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

export async function approveAndLedger({ order, receipt, reviewerId, reviewerName = "" }) {
  const existing = await companionDb("payment_transactions", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`).catch(() => []);
  if (existing?.[0]) return { transaction: existing[0], duplicate: true };
  const at = nowIso();
  const staff = await loadStaffReviewer(reviewerId);
  const staffId = staff.id || String(reviewerId || "").trim();
  const staffName = String(reviewerName || staff.name || "").trim();
  if (!staffId) throw Object.assign(new Error("缺少审核客服身份，无法确认付款。"), { status: 401 });
  if (!staffName) {
    throw Object.assign(new Error("当前客服账号未设置真实显示名称，请先在客服资料中填写姓名后再审核。"), {
      status: 400,
    });
  }

  // Already reviewed: never overwrite first reviewer; recover TX if needed.
  if (receipt?.status && receipt.status !== "pending") {
    if (receipt.status === "approved") {
      const recovered = await recoverApprovedWithoutTx({ order, reviewerId: staffId });
      if (recovered?.transaction) return { ...recovered, duplicate: true };
    }
    throw Object.assign(new Error("付款凭证已被处理，审核人不可覆盖。"), { status: 409 });
  }

  const approved = await patchReceiptReview(
    receipt.id,
    reviewPatch({ staffId, staffName, status: "approved", at })
  );
  const approvedReceipt = approved?.[0];
  if (!approvedReceipt) {
    const replay = await companionDb("payment_transactions", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`).catch(() => []);
    if (replay?.[0]) return { transaction: replay[0], duplicate: true };
    const recovered = await recoverApprovedWithoutTx({ order, reviewerId: staffId });
    if (recovered?.transaction) return recovered;
    throw Object.assign(new Error("付款凭证已被处理，请刷新后重试。"), { status: 409 });
  }

  // Ensure snapshot fields present even if DB returned legacy row without new columns.
  const receiptOut = {
    ...approvedReceipt,
    reviewed_by: staffId,
    reviewed_by_staff_id: staffId,
    reviewed_by_staff_name: staffName || approvedReceipt.reviewed_by_staff_name || "",
    reviewed_at: approvedReceipt.reviewed_at || at,
    storage_path: approvedReceipt.storage_path || receipt.storage_path,
    storage_bucket: approvedReceipt.storage_bucket || receipt.storage_bucket,
  };

  await persistReviewerSnapshotArtifacts(receiptOut, {
    sourceTable: "payment_receipts",
    sourceId: approvedReceipt.id,
    action: "approved",
    staffId,
    staffName,
    reviewStatus: "approved",
    reviewedAt: at,
  });

  try {
    const transaction = await insertPaidTransaction({ order, receipt: receiptOut, reviewerId: staffId, at });
    return { transaction, receipt: receiptOut, duplicate: false };
  } catch (error) {
    if (!/duplicate|unique/i.test(String(error?.message || ""))) {
      console.warn("[approveAndLedger] TX insert failed after approve", error?.message || error);
      throw error;
    }
    const replay = await companionDb("payment_transactions", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`);
    return { transaction: replay?.[0] || null, receipt: receiptOut, duplicate: true };
  }
}

export async function rejectProof({ receipt, reviewerId, reviewerName = "", reason, remark = "" }) {
  const at = nowIso();
  const staff = await loadStaffReviewer(reviewerId);
  const staffId = staff.id || String(reviewerId || "").trim();
  const staffName = String(reviewerName || staff.name || "").trim();
  if (!staffId) throw Object.assign(new Error("缺少审核客服身份，无法驳回付款。"), { status: 401 });
  if (!staffName) {
    throw Object.assign(new Error("当前客服账号未设置真实显示名称，请先在客服资料中填写姓名后再审核。"), {
      status: 400,
    });
  }
  if (receipt?.status && receipt.status !== "pending") {
    throw Object.assign(new Error("付款凭证已被处理，审核人不可覆盖。"), { status: 409 });
  }
  const rows = await patchReceiptReview(
    receipt.id,
    reviewPatch({
      staffId,
      staffName,
      status: "rejected",
      at,
      reason,
      remark: remark || reason,
    })
  );
  if (!rows?.[0]) throw Object.assign(new Error("付款凭证已被处理，请刷新后重试。"), { status: 409 });
  const out = {
    ...rows[0],
    reviewed_by: staffId,
    reviewed_by_staff_id: staffId,
    reviewed_by_staff_name: staffName,
    reviewed_at: rows[0].reviewed_at || at,
    storage_path: rows[0].storage_path || receipt.storage_path,
    storage_bucket: rows[0].storage_bucket || receipt.storage_bucket,
  };
  await persistReviewerSnapshotArtifacts(out, {
    sourceTable: "payment_receipts",
    sourceId: out.id,
    action: "rejected",
    staffId,
    staffName,
    reviewStatus: "rejected",
    reviewRemark: remark || reason,
    rejectReason: reason,
    reviewedAt: at,
  });
  return out;
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
  const hydrated = await hydrateReceiptReviewers(filtered);
  return Promise.all(
    hydrated.map(async (receipt) => {
      const order = orderMap[receipt.order_id] || {};
      const boss = profileMap[receipt.boss_id || order.boss_id] || {};
      const reviewer = profileMap[receipt.reviewed_by_staff_id || receipt.reviewed_by] || {};
      const proofUrl = await signedProofUrl(receipt).catch(() => "");
      const storedName = String(receipt.reviewed_by_staff_name || "").trim();
      return {
        ...receipt,
        order,
        orderNo: order.order_no || order.id || receipt.order_id || "",
        bossName: String(boss.display_name || "").trim() || boss.email || receipt.boss_id || "",
        bossUid: boss.boss_uid || "",
        reviewerName: storedName || staffReviewerNameFromProfile(reviewer) || "",
        reviewedByStaffId: receipt.reviewed_by_staff_id || receipt.reviewed_by || "",
        reviewedByStaffName: storedName || staffReviewerNameFromProfile(reviewer) || "",
        amount: money(receipt.amount != null ? receipt.amount : order.total_amount),
        proofUrl: proofUrl || "",
        reject_reason: stripReviewStaffMark(receipt.reject_reason || ""),
        rejectReason: stripReviewStaffMark(receipt.reject_reason || ""),
      };
    })
  );
}

/** Enrich pending/approved admin rows with boss + reviewer display names. */
export async function enrichReceiptAudit(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const withSnap = await hydrateReceiptReviewers(
    list.map((row) => {
      const receipt = row.receipt || row;
      return {
        ...receipt,
        reviewed_by_staff_id: row.reviewed_by_staff_id || receipt.reviewed_by_staff_id,
        reviewed_by_staff_name: row.reviewed_by_staff_name || receipt.reviewed_by_staff_name,
        reviewed_by: row.reviewed_by || receipt.reviewed_by,
        confirmed_by: row.confirmed_by || receipt.confirmed_by,
        reviewed_at: row.reviewed_at || receipt.reviewed_at,
        reject_reason: row.reject_reason || receipt.reject_reason,
        review_remark: row.review_remark || receipt.review_remark,
        _row: row,
      };
    })
  );
  const bossIds = [...new Set(withSnap.map((r) => r.boss_id || r._row?.boss_id || r._row?.bossId || r._row?.order?.boss_id).filter(Boolean))];
  const reviewerIds = [
    ...new Set(
      withSnap
        .flatMap((r) => [r.reviewed_by_staff_id, r.reviewed_by, r.confirmed_by])
        .filter(Boolean)
    ),
  ];
  const profileIds = [...new Set([...bossIds, ...reviewerIds])];
  const profiles = profileIds.length
    ? await companionDb(
        "profiles",
        `?id=in.(${profileIds.map(encodeURIComponent).join(",")})&select=id,display_name,nickname,email,role,boss_uid&limit=800`
      ).catch(() => [])
    : [];
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  return Promise.all(
    withSnap.map(async (receipt) => {
      const row = receipt._row || receipt;
      const bossId = row.boss_id || row.bossId || row.order?.boss_id || receipt.boss_id || "";
      const reviewerId =
        receipt.reviewed_by_staff_id ||
        receipt.reviewed_by ||
        receipt.confirmed_by ||
        "";
      const boss = profileMap[bossId] || {};
      const reviewer = profileMap[reviewerId] || {};
      const proofUrl = row.proofUrl || (await signedProofUrl(receipt).catch(() => "")) || "";
      const storedName = String(receipt.reviewed_by_staff_name || "").trim();
      return {
        ...row,
        ...receipt,
        orderNo: row.orderNo || row.order?.order_no || row.order_id || row.orderId || "",
        bossName: String(boss.display_name || "").trim() || boss.email || bossId || "",
        bossUid: boss.boss_uid || "",
        // Prefer immutable snapshot; live profile only if snapshot missing (legacy rows).
        reviewerName: storedName || staffReviewerNameFromProfile(reviewer) || "",
        reviewedByStaffId: reviewerId,
        reviewedByStaffName: storedName || staffReviewerNameFromProfile(reviewer) || "",
        reviewedAt: receipt.reviewed_at || row.confirmed_at || receipt.confirmed_at || "",
        rejectReason: stripReviewStaffMark(receipt.reject_reason || row.reject_reason || ""),
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
  const hydrated = await hydrateReceiptReviewers(receipts || []);
  const map = {};
  for (const row of hydrated) {
    if (!row?.order_id || map[row.order_id]) continue;
    // Ignore legacy auto-reject rows created by older re-upload path.
    if (String(row.reject_reason || "") === "老板重新上传付款凭证") continue;
    map[row.order_id] = row;
  }
  return map;
}

/** Latest approved receipt per order — SoT for reviewer name after payment passes. */
export async function latestApprovedForOrders(orderIds = []) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const receipts = await companionDb(
    "payment_receipts",
    `?order_id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.approved&order=reviewed_at.desc&limit=800`
  ).catch(() => []);
  const hydrated = await hydrateReceiptReviewers(receipts || []);
  const map = {};
  for (const row of hydrated) {
    if (!row?.order_id || map[row.order_id]) continue;
    map[row.order_id] = row;
  }
  return map;
}

export async function listPaidForAdmin({ year = "", month = "" } = {}) {
  const rows = await companionDb("payment_transactions", "?payment_status=eq.paid&order=confirmed_at.desc&limit=2000").catch(() => []);
  const receipts = await companionDb("payment_receipts", "?status=eq.approved&limit=2000").catch(() => []);
  const hydratedReceipts = await hydrateReceiptReviewers(receipts || []);
  const receiptMap = Object.fromEntries((hydratedReceipts || []).map((row) => [row.id, row]));
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
