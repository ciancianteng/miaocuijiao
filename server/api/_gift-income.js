/**
 * Gift income reporting helpers (companion + admin accounting).
 */
import { companionDb, isMissingRelation } from "./_companion-media-store.js";

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

export function mapGiftIncomeRow(tx, extras = {}) {
  return {
    id: tx.id,
    transactionId: tx.tx_no || tx.id,
    txNo: tx.tx_no || "",
    createdAt: tx.created_at || "",
    senderBossId: tx.sender_boss_id || "",
    senderName: extras.senderName || "",
    senderCode: extras.senderCode || "",
    companionId: tx.receiver_companion_id || "",
    companionCode: extras.companionCode || "",
    companionName: extras.companionName || "",
    giftId: tx.gift_id || null,
    giftName: tx.gift_name || (tx.kind === "tip" ? "自由打赏" : "礼物"),
    quantity: Math.max(1, Number(tx.quantity) || 1),
    value: money(tx.gross_cat_food),
    companionIncome: money(tx.companion_income),
    platformCommission: money(tx.platform_commission_amount),
    kind: tx.kind || "gift",
    sourceChannel: tx.source_channel || (tx.kind === "tip" ? "tip_sheet" : "companion_detail"),
    message: tx.message || "",
  };
}

export async function listGiftTransactionsForCompanion(companionId, { limit = 200 } = {}) {
  const cid = String(companionId || "").trim();
  if (!cid) return [];
  try {
    const rows = await companionDb(
      "gift_transactions",
      `?receiver_companion_id=eq.${encodeURIComponent(cid)}&order=created_at.desc&limit=${Math.min(500, Math.max(1, limit))}`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}

export function summarizeGiftIncome(rows, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  let total = 0;
  let daily = 0;
  let monthly = 0;
  let totalGross = 0;
  for (const row of rows || []) {
    const income = money(row.companion_income);
    const gross = money(row.gross_cat_food);
    total += income;
    totalGross += gross;
    if (dayKey(row.created_at) === today) daily += income;
    if (monthKey(row.created_at) === month) monthly += income;
  }
  return {
    totalGiftEarnings: Math.round(total * 100) / 100,
    dailyEarnings: Math.round(daily * 100) / 100,
    monthlyEarnings: Math.round(monthly * 100) / 100,
    totalGrossValue: Math.round(totalGross * 100) / 100,
    transactionCount: (rows || []).length,
  };
}

export async function listGiftTransactionsAdmin({ limit = 300, from = "", to = "" } = {}) {
  try {
    let q = `?order=created_at.desc&limit=${Math.min(1000, Math.max(1, limit))}`;
    if (from) q += `&created_at=gte.${encodeURIComponent(from)}`;
    if (to) q += `&created_at=lte.${encodeURIComponent(to)}`;
    const rows = await companionDb("gift_transactions", q);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}

export function giftTransactionsToCsv(rows) {
  const header = [
    "transaction_id",
    "created_at",
    "sender_boss_id",
    "sender_name",
    "companion_id",
    "companion_code",
    "companion_name",
    "gift_name",
    "quantity",
    "gross_value",
    "companion_income",
    "platform_commission",
    "kind",
    "source_channel",
  ];
  const lines = [header.join(",")];
  for (const r of rows || []) {
    const vals = [
      r.transactionId || r.txNo || r.id || "",
      r.createdAt || "",
      r.senderBossId || "",
      r.senderName || "",
      r.companionId || "",
      r.companionCode || "",
      r.companionName || "",
      r.giftName || "",
      r.quantity ?? "",
      r.value ?? "",
      r.companionIncome ?? "",
      r.platformCommission ?? "",
      r.kind || "",
      r.sourceChannel || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(vals.join(","));
  }
  return `\ufeff${lines.join("\n")}`;
}
