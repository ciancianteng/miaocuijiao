/**
 * Gift income reporting helpers (companion + admin accounting).
 * Settlement statuses (traceable):
 *   received → pending_settlement → available → withdrawn
 */
import { companionDb, isMissingRelation } from "./_companion-media-store.js";

export const GIFT_SETTLEMENT_STATUSES = Object.freeze({
  RECEIVED: "received",
  PENDING_SETTLEMENT: "pending_settlement",
  AVAILABLE: "available",
  WITHDRAWN: "withdrawn",
});

export const GIFT_SETTLEMENT_LABELS = Object.freeze({
  received: "已收到",
  pending_settlement: "待结算",
  available: "可提现",
  withdrawn: "已提现",
});

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function dayKey(iso) {
  return String(iso || "").slice(0, 10);
}

function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

export function normalizeGiftSettlementStatus(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (GIFT_SETTLEMENT_LABELS[key]) return key;
  if (key === "pending" || key === "settling") return GIFT_SETTLEMENT_STATUSES.PENDING_SETTLEMENT;
  if (key === "settled" || key === "ready") return GIFT_SETTLEMENT_STATUSES.AVAILABLE;
  if (key === "paid" || key === "payout") return GIFT_SETTLEMENT_STATUSES.WITHDRAWN;
  return GIFT_SETTLEMENT_STATUSES.RECEIVED;
}

export function giftSettlementLabel(status) {
  const key = normalizeGiftSettlementStatus(status);
  return GIFT_SETTLEMENT_LABELS[key] || key;
}

export function mapGiftIncomeRow(tx, extras = {}) {
  const settlementStatus = normalizeGiftSettlementStatus(tx.settlement_status || extras.settlementStatus);
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
    settlementStatus,
    settlementStatusText: giftSettlementLabel(settlementStatus),
    incomeTransactionId: tx.income_transaction_id || "",
    withdrawalId: tx.withdrawal_id || "",
    receivedAt: tx.received_at || tx.created_at || "",
    availableAt: tx.available_at || "",
    withdrawnAt: tx.withdrawn_at || "",
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
  const byStatus = {
    received: 0,
    pending_settlement: 0,
    available: 0,
    withdrawn: 0,
  };
  for (const row of rows || []) {
    const income = money(row.companion_income);
    const gross = money(row.gross_cat_food);
    total += income;
    totalGross += gross;
    if (dayKey(row.created_at) === today) daily += income;
    if (monthKey(row.created_at) === month) monthly += income;
    const st = normalizeGiftSettlementStatus(row.settlement_status);
    byStatus[st] = money((byStatus[st] || 0) + income);
  }
  return {
    totalGiftEarnings: Math.round(total * 100) / 100,
    dailyEarnings: Math.round(daily * 100) / 100,
    monthlyEarnings: Math.round(monthly * 100) / 100,
    totalGrossValue: Math.round(totalGross * 100) / 100,
    transactionCount: (rows || []).length,
    receivedAmount: byStatus.received,
    pendingSettlementAmount: byStatus.pending_settlement,
    availableAmount: byStatus.available,
    withdrawnAmount: byStatus.withdrawn,
    byStatus,
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
    "settlement_status",
    "income_transaction_id",
    "withdrawal_id",
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
      r.settlementStatus || "",
      r.incomeTransactionId || "",
      r.withdrawalId || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(vals.join(","));
  }
  return `\ufeff${lines.join("\n")}`;
}

/**
 * FIFO-mark available gift incomes as withdrawn when companion cash-out succeeds.
 * Soft-fails if settlement columns are missing.
 */
export async function markGiftIncomeWithdrawn(companionId, amount, withdrawalId) {
  const cid = String(companionId || "").trim();
  const wid = String(withdrawalId || "").trim();
  let remaining = money(amount);
  if (!cid || !wid || !(remaining > 0)) return { marked: 0, remaining };

  let rows = [];
  try {
    rows = await companionDb(
      "gift_transactions",
      `?receiver_companion_id=eq.${encodeURIComponent(cid)}&settlement_status=eq.available&order=created_at.asc&limit=500`
    );
  } catch (err) {
    if (isMissingRelation(err) || /settlement_status|column|PGRST/i.test(String(err?.message || ""))) {
      return { marked: 0, remaining, skipped: true };
    }
    throw err;
  }

  let marked = 0;
  const now = new Date().toISOString();
  for (const row of rows || []) {
    if (!(remaining > 0)) break;
    const income = money(row.companion_income);
    if (!(income > 0)) continue;
    try {
      await companionDb("gift_transactions", `?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          settlement_status: GIFT_SETTLEMENT_STATUSES.WITHDRAWN,
          withdrawal_id: wid,
          withdrawn_at: now,
          updated_at: now,
        }),
      });
      remaining = Math.max(0, money(remaining - income));
      marked += 1;
    } catch (err) {
      if (/settlement_status|withdrawal_id|column|PGRST/i.test(String(err?.message || ""))) {
        return { marked, remaining, skipped: true };
      }
      console.warn("[gift-income] mark withdrawn", err?.message || err);
    }
  }
  return { marked, remaining: money(remaining) };
}
