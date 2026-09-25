#!/usr/bin/env node
/**
 * READONLY dry-run: find Production orders that illegally skipped 小喵 CS payment review.
 * Never INSERT/UPDATE/DELETE.
 *
 * Rule:
 *   KEEP_PENDING_REVIEW = awaiting_payment (+ optional proof) — normal, waiting 小喵
 *   KEEP_VALID_REVIEW   = past-review status AND approved payment_receipt by 小喵
 *   DELETE_CANDIDATES   = past-review status AND NO approved 小喵 review evidence
 *
 * node scripts/dry-run-invalid-orders-no-cs-review.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/invalid-legacy-orders");
fs.mkdirSync(outDir, { recursive: true });

const PAST_REVIEW_STATUSES = new Set([
  "claimed",
  "confirmed",
  "in_progress",
  "completed",
  "pending",
  "waiting_boss_confirm",
  "reviewed",
  "refund_requested",
  "refunded",
  // legacy aliases sometimes stored
  "paid",
  "cs_approved",
  "awaiting_companion_confirmation",
  "companion_confirmed",
]);

const PENDING_REVIEW_STATUSES = new Set(["awaiting_payment"]);

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!v || /\[SENSITIVE\]/i.test(v)) continue;
    o[m[1]] = v;
  }
  return o;
}

function loadEnv() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
    path.join(root, "../meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local"),
    path.join(root, ".env.vercel.prod.pull.tmp"),
  ];
  let merged = {};
  for (const p of candidates) Object.assign(merged, parseEnv(p));
  return merged;
}

const env = loadEnv();
const url = String(env.PROD_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!url || !key) {
  console.error("Missing Production SUPABASE_URL / SERVICE_ROLE_KEY");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];
if (ref !== PRODUCTION_SUPABASE_REF) {
  console.error("Refused: not Production ref", ref);
  process.exit(1);
}

async function sb(table, query = "", opts = {}) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${table} ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function paginate(table, select, filter = "", pageSize = 500) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const q = `?select=${select}${filter ? `&${filter}` : ""}&order=created_at.asc&limit=${pageSize}&offset=${offset}`;
    const batch = await sb(table, q);
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function isXiaomiaoName(name = "") {
  const n = String(name || "").trim();
  return /小喵/.test(n) && !/测试|test/i.test(n);
}

function parseReviewStaffMark(text = "") {
  const m = String(text || "").match(/\[\[REVIEW_STAFF:([^\]|]+)\|([^\]|]+)\|([^\]]+)\]\]/);
  if (!m) return null;
  return {
    reviewed_by_staff_id: String(m[1] || "").trim(),
    reviewed_by_staff_name: String(m[2] || "").trim(),
    reviewed_at: String(m[3] || "").trim(),
  };
}

function hasProof(order, receipts) {
  if (/\[\[PAYMENT_PROOF\]\]|\[\[PAYMENT_SUBMITTED\]\]|付款凭证|已上传付款/i.test(String(order.note || "") + String(order.description || ""))) {
    return true;
  }
  return (receipts || []).some((r) => String(r.storage_path || "").trim());
}

function enrichReceipt(r) {
  const marked = parseReviewStaffMark(r.reject_reason || "") || parseReviewStaffMark(r.review_remark || "");
  return {
    ...r,
    reviewed_by_staff_id: marked?.reviewed_by_staff_id || r.reviewed_by || r.confirmed_by || "",
    reviewed_by_staff_name: marked?.reviewed_by_staff_name || "",
    reviewed_at_effective: r.reviewed_at || r.confirmed_at || marked?.reviewed_at || "",
  };
}

function bestApprovedReceipt(receipts, xiaomiaoIds) {
  const enriched = (receipts || []).map(enrichReceipt);
  const approved = enriched.filter((r) =>
    /^(approved|confirmed|paid|pass|passed)$/i.test(String(r.status || ""))
  );
  const byXiao = approved.find((r) => {
    const name = String(r.reviewed_by_staff_name || "").trim();
    const id = String(r.reviewed_by_staff_id || r.reviewed_by || r.confirmed_by || "").trim();
    return isXiaomiaoName(name) || (id && xiaomiaoIds.has(id));
  });
  // Fallback: approved receipt reviewed_by == 小喵 id even without name mark
  const byXiaoIdOnly =
    byXiao ||
    approved.find((r) => {
      const id = String(r.reviewed_by || r.confirmed_by || "").trim();
      return id && xiaomiaoIds.has(id);
    });
  return { approved, byXiao: byXiaoIdOnly || null, any: approved[0] || null, enriched };
}

console.log("[dry-run] Production ref OK", ref);

const csProfiles = await paginate(
  "profiles",
  "id,display_name,email,role,status",
  "or=(role.eq.customer_service,role.eq.admin,role.eq.super_admin)"
).catch(async () => {
  // fallback broader pull
  return paginate("profiles", "id,display_name,email,role,status", "");
});

const xiaomiao = csProfiles.filter(
  (p) => isXiaomiaoName(p.display_name) || /小喵/.test(String(p.email || ""))
);
const xiaomiaoIds = new Set(xiaomiao.map((p) => p.id));
console.log(
  "[dry-run] 小喵 profiles:",
  xiaomiao.map((p) => ({ id: p.id, name: p.display_name, email: p.email }))
);

const orders = await paginate(
  "orders",
  [
    "id",
    "order_no",
    "boss_id",
    "companion_id",
    "total_amount",
    "status",
    "created_at",
    "parent_order_id",
    "order_type",
    "note",
    "description",
    "paid_at",
    "paid_cat_food",
    "idempotency_key",
    "settlement_status",
  ].join(",")
);
console.log("[dry-run] orders loaded", orders.length);

let receipts = [];
try {
  receipts = await paginate(
    "payment_receipts",
    [
      "id",
      "order_id",
      "status",
      "storage_path",
      "storage_bucket",
      "reviewed_by",
      "confirmed_by",
      "reviewed_at",
      "confirmed_at",
      "reject_reason",
      "uploaded_at",
      "created_at",
      "payment_method",
      "amount",
    ].join(",")
  );
} catch (e) {
  console.warn("[dry-run] payment_receipts load failed:", e.message);
}
console.log("[dry-run] payment_receipts loaded", receipts.length);

const receiptsByOrder = new Map();
for (const r of receipts) {
  const oid = String(r.order_id || "");
  if (!oid) continue;
  if (!receiptsByOrder.has(oid)) receiptsByOrder.set(oid, []);
  receiptsByOrder.get(oid).push(r);
}

// Also check payment_operation_logs for review snapshots
let opLogs = [];
try {
  opLogs = await paginate(
    "payment_operation_logs",
    "id,action,target_id,after_value,created_at",
    "action=like.payment_review_*"
  );
} catch (e) {
  console.warn("[dry-run] payment_operation_logs:", e.message);
}
const logByOrder = new Map();
for (const log of opLogs) {
  const after = log.after_value || {};
  const oid = String(after.source_id || log.target_id || "");
  if (!oid) continue;
  if (!logByOrder.has(oid)) logByOrder.set(oid, []);
  logByOrder.get(oid).push(log);
}

const profileIds = [...new Set(orders.flatMap((o) => [o.boss_id, o.companion_id]).filter(Boolean))];
const profileMap = {};
for (let i = 0; i < profileIds.length; i += 80) {
  const chunk = profileIds.slice(i, i + 80);
  const rows = await sb(
    "profiles",
    `?id=in.(${chunk.map(encodeURIComponent).join(",")})&select=id,display_name,boss_uid,email`
  );
  for (const p of rows || []) profileMap[p.id] = p;
}

const FOCUS_NOS = new Set(
  [
    "MCJO000399",
    "MCJO000400",
    "MCJO000401",
    "MCJO000407",
    "MCJO000408",
    "MCJO000409",
    "MCJO000410",
    "MCJO000411",
    "MCJO000412",
    "MCJO000413",
    "MCJO000414",
    "MCJO000415",
    "MCJO000416",
    "MCJO000417",
    "MCJO000395",
    "MCJO000356",
    "MCJO000357",
  ].map((s) => s.toUpperCase())
);
const BOSS_1717 = "458ce9ad-3425-42b1-ab66-24bca342f971";

function classify(order, orderById) {
  const st = String(order.status || "").toLowerCase();
  let recs = receiptsByOrder.get(order.id) || [];
  // Multi child: inherit parent payment review evidence
  if (order.parent_order_id) {
    const parentRecs = receiptsByOrder.get(order.parent_order_id) || [];
    if (parentRecs.length) recs = [...recs, ...parentRecs];
  }
  const logs = [
    ...(logByOrder.get(order.id) || []),
    ...(order.parent_order_id ? logByOrder.get(order.parent_order_id) || [] : []),
  ];
  const { approved, byXiao, any } = bestApprovedReceipt(recs, xiaomiaoIds);

  // Log-based 小喵 approve
  let logXiao = null;
  for (const log of logs) {
    const after = log.after_value || {};
    const name = String(after.reviewed_by_staff_name || "");
    const id = String(after.reviewed_by_staff_id || "");
    const rs = String(after.review_status || "");
    if (/approved|confirmed|paid/i.test(rs) && (isXiaomiaoName(name) || xiaomiaoIds.has(id))) {
      logXiao = after;
      break;
    }
  }

  const proof = hasProof(order, recs);
  const reviewer =
    byXiao?.reviewed_by_staff_name ||
    logXiao?.reviewed_by_staff_name ||
    any?.reviewed_by_staff_name ||
    (byXiao || any)?.reviewed_by ||
    "";
  const approvedAt =
    byXiao?.reviewed_at_effective ||
    logXiao?.reviewed_at ||
    any?.reviewed_at_effective ||
    null;

  const hasXiaomiaoApprove = !!(byXiao || logXiao);
  const hasAnyCsApprove = approved.length > 0 || !!logXiao;

  const catfoodPaid = Number(order.paid_cat_food || 0) > 0 || /付款方式[：:]\s*catfood/i.test(String(order.description || ""));

  const boss = profileMap[order.boss_id] || {};
  const companion = profileMap[order.companion_id] || {};
  const row = {
    id: order.id,
    order_no: order.order_no || "",
    boss: boss.display_name || boss.boss_uid || order.boss_id || "",
    boss_uid: boss.boss_uid || "",
    companion: companion.display_name || order.companion_id || "",
    amount: Number(order.total_amount) || 0,
    created_at: order.created_at,
    payment_proof: proof ? "YES" : "NO",
    reviewer: reviewer || "",
    cs_approved_at: approvedAt || "",
    payment_status: order.paid_at ? "paid_at_set" : catfoodPaid ? "catfood" : "",
    order_status: st,
    parent_order_id: order.parent_order_id || null,
    root_order_id: order.parent_order_id || order.id,
    order_type: order.order_type || "",
    has_xiaomiao_approve: hasXiaomiaoApprove,
    has_any_cs_approve: hasAnyCsApprove,
    receipt_count: recs.length,
    paid_at: order.paid_at || "",
    focus: FOCUS_NOS.has(String(order.order_no || "").toUpperCase()) || order.boss_id === BOSS_1717,
  };

  if (PENDING_REVIEW_STATUSES.has(st)) {
    return { bucket: "KEEP_PENDING_REVIEW", reason: proof ? "awaiting_payment+proof" : "awaiting_payment", row };
  }

  if (st === "cancelled") {
    return { bucket: "KEEP_CANCELLED", reason: "cancelled_current_status", row };
  }

  if (!PAST_REVIEW_STATUSES.has(st)) {
    return { bucket: "KEEP_OTHER_STATUS", reason: `status=${st}`, row };
  }

  if (hasXiaomiaoApprove) {
    return { bucket: "KEEP_VALID_XIAOMIAO", reason: "xiaomiao_approved_receipt", row };
  }
  if (hasAnyCsApprove) {
    return { bucket: "KEEP_OTHER_CS_APPROVED", reason: "approved_by_non_xiaomiao_cs", row };
  }

  const reasons = [];
  if (!hasAnyCsApprove) reasons.push("no_approved_payment_receipt");
  if (!proof) reasons.push("no_payment_proof");
  if (catfoodPaid) reasons.push("catfood_auto_paid_no_cs");
  return {
    bucket: "DELETE_CANDIDATES",
    reason: reasons.join("+") || "past_review_without_xiaomiao",
    row: { ...row, delete_reason: reasons.join("+"), tag: "INVALID_LEGACY_ORDER" },
  };
}

const orderById = new Map(orders.map((o) => [o.id, o]));

const buckets = {
  DELETE_CANDIDATES: [],
  KEEP_PENDING_REVIEW: [],
  KEEP_VALID_XIAOMIAO: [],
  KEEP_OTHER_CS_APPROVED: [],
  KEEP_CANCELLED: [],
  KEEP_OTHER_STATUS: [],
};

for (const o of orders) {
  const { bucket, reason, row } = classify(o, orderById);
  buckets[bucket].push({ ...row, classify_reason: reason });
}

function sumAmount(list) {
  return list.reduce((n, r) => n + (Number(r.amount) || 0), 0);
}

const focusDelete = buckets.DELETE_CANDIDATES.filter((r) => r.focus);
const focusKeepPending = buckets.KEEP_PENDING_REVIEW.filter((r) => r.focus);
const focusAll = orders
  .filter((o) => FOCUS_NOS.has(String(o.order_no || "").toUpperCase()) || o.boss_id === BOSS_1717)
  .map((o) => {
    const c = classify(o, orderById);
    return { bucket: c.bucket, reason: c.reason, ...c.row };
  });

const report = {
  readonly: true,
  produced_at: new Date().toISOString(),
  production_ref: ref,
  xiaomiao_reviewers: xiaomiao.map((p) => ({ id: p.id, display_name: p.display_name, email: p.email })),
  schema_notes: {
    pending_cs_review_db_status: "awaiting_payment (+ payment_receipt pending / proof)",
    cs_approve_sot: "payment_receipts.status=approved + reviewed_by*_name/id + reviewed_at/confirmed_at",
    past_review_statuses: [...PAST_REVIEW_STATUSES],
  },
  INVALID_ORDER_COUNT: buckets.DELETE_CANDIDATES.length,
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  amounts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, sumAmount(v)])),
  DELETE_CANDIDATES: buckets.DELETE_CANDIDATES,
  KEEP_PENDING_REVIEW: buckets.KEEP_PENDING_REVIEW,
  KEEP_VALID_XIAOMIAO: buckets.KEEP_VALID_XIAOMIAO,
  KEEP_OTHER_CS_APPROVED: buckets.KEEP_OTHER_CS_APPROVED,
  KEEP_CANCELLED_SAMPLE: buckets.KEEP_CANCELLED.slice(0, 30),
  FOCUS_BOSS_1717_AND_LISTED: focusAll,
  FOCUS_DELETE: focusDelete,
  FOCUS_KEEP_PENDING: focusKeepPending,
};

fs.writeFileSync(path.join(outDir, "DRY_RUN.json"), JSON.stringify(report, null, 2));

// Human table
const lines = [];
lines.push(`INVALID_ORDER_COUNT = ${report.INVALID_ORDER_COUNT}`);
lines.push("");
lines.push("=== DELETE_CANDIDATES (no 小喵 approved review + past review stage) ===");
for (const r of buckets.DELETE_CANDIDATES) {
  lines.push(
    [
      r.order_no || r.id.slice(0, 8),
      `boss=${r.boss}`,
      `comp=${r.companion || "-"}`,
      `amt=${r.amount}`,
      `status=${r.order_status}`,
      `proof=${r.payment_proof}`,
      `reviewer=${r.reviewer || "-"}`,
      `approved_at=${r.cs_approved_at || "-"}`,
      `parent=${r.parent_order_id ? "YES" : "NO"}`,
      r.classify_reason,
    ].join(" | ")
  );
}
lines.push("");
lines.push("=== KEEP_PENDING_REVIEW (awaiting_payment — DO NOT DELETE) ===");
for (const r of buckets.KEEP_PENDING_REVIEW) {
  lines.push(
    [
      r.order_no || r.id.slice(0, 8),
      `boss=${r.boss}`,
      `amt=${r.amount}`,
      `proof=${r.payment_proof}`,
      `status=${r.order_status}`,
      r.classify_reason,
    ].join(" | ")
  );
}
lines.push("");
lines.push("=== KEEP_OTHER_CS_APPROVED (approved but reviewer ≠ 小喵 — owner decide) ===");
for (const r of buckets.KEEP_OTHER_CS_APPROVED) {
  lines.push(
    [
      r.order_no || r.id.slice(0, 8),
      `boss=${r.boss}`,
      `amt=${r.amount}`,
      `status=${r.order_status}`,
      `reviewer=${r.reviewer || "-"}`,
      `approved_at=${r.cs_approved_at || "-"}`,
    ].join(" | ")
  );
}
lines.push("");
lines.push("=== FOCUS MCJO399-417 / boss 1717 ===");
for (const r of focusAll.sort((a, b) => String(a.order_no).localeCompare(String(b.order_no)))) {
  lines.push(
    `${r.bucket.padEnd(24)} ${r.order_no} status=${r.order_status} proof=${r.payment_proof} reviewer=${r.reviewer || "-"} amt=${r.amount} parent=${r.parent_order_id ? "child" : "root"}`
  );
}

fs.writeFileSync(path.join(outDir, "DRY_RUN.txt"), lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log("\nWrote", path.join(outDir, "DRY_RUN.json"));
console.log("Wrote", path.join(outDir, "DRY_RUN.txt"));
