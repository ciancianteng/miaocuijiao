/**
 * Weekly Friday settlement helpers (Asia/Kuala_Lumpur).
 * Cutoff: Thursday 23:59 → this Friday; after cutoff → next Friday.
 */

export const SETTLEMENT_TZ = "Asia/Kuala_Lumpur";

export const PAYOUT_STATUS = {
  submitted: "submitted",
  pending_friday: "pending_friday",
  reviewing: "reviewing",
  approved: "approved",
  pending_payment: "pending_payment",
  processing: "processing",
  paid: "paid",
  completed: "completed",
  rejected: "rejected",
  failed: "failed",
  rolled_over: "rolled_over",
};

/** Chinese labels for frontends */
export const PAYOUT_STATUS_TEXT = {
  submitted: "已提交",
  pending_friday: "待周五结算",
  reviewing: "审核中",
  approved: "审核通过待打款",
  pending_payment: "审核通过待打款",
  processing: "正在打款",
  paid: "已打款",
  completed: "已完成",
  rejected: "已驳回",
  failed: "打款失败",
  rolled_over: "顺延至下周",
  // product aliases
  pending_review: "待审核",
  approved_for_payout: "审核通过，待周五结算",
  included_in_batch: "已进入本周批次",
  carried_forward: "顺延下周",
  // legacy aliases
  pending: "已提交",
  approved_pending_pay: "审核通过待打款",
  paying: "审核通过待打款",
  paid_pending_receipt: "已打款",
  pay_failed: "打款失败",
  cancelled: "已撤销",
  draft: "待结算",
};

/** Statuses that freeze balance / block re-apply of same sources */
export const PAYOUT_FROZEN_STATUSES = new Set([
  "submitted",
  "pending_friday",
  "reviewing",
  "approved",
  "pending_payment",
  "processing",
  "paid",
  "rolled_over",
  "failed",
  // legacy
  "pending",
  "pending_review",
  "approved_pending_pay",
  "paying",
  "paid_pending_receipt",
]);

export const PAYOUT_TERMINAL_DONE = new Set(["completed", "paid"]);
export const PAYOUT_OPEN_STATUSES = new Set([
  ...PAYOUT_FROZEN_STATUSES,
  "completed",
]);

export const DEFAULT_WEEKLY_SETTINGS = {
  payout_weekday: 5, // Friday (Mon=1 … Sun=7)
  application_cutoff_weekday: 4, // Thursday
  application_cutoff_time: "23:59",
  payout_window_start: "12:00",
  payout_window_end: "23:59",
  holiday_rollover_enabled: true,
  min_withdraw_cat_food: 50,
  max_withdrawals_per_week: 2,
  max_withdrawals_per_month: 8,
  timezone: SETTLEMENT_TZ,
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Parts in SETTLEMENT_TZ for a Date */
export function zonedParts(date = new Date(), timeZone = SETTLEMENT_TZ) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] || 1,
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function weekdayOfDateKey(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  // Use noon UTC to avoid DST edge; KL has no DST
  const wd = new Date(Date.UTC(y, m - 1, d, 4, 0, 0)).getUTCDay(); // 0=Sun
  return wd === 0 ? 7 : wd;
}

function fridayOfWeekContaining(dateKey) {
  const wd = weekdayOfDateKey(dateKey);
  return addDaysToDateKey(dateKey, 5 - wd);
}

/**
 * Compute settlement_date (YYYY-MM-DD Friday) for an application moment.
 * Before/at Thursday 23:59 → this week's Friday.
 * After Thursday 23:59 → next week's Friday.
 * If that Friday already passed relative to "now" date (e.g. Fri morning after cutoff), still next Friday.
 */
export function computeSettlementDate(now = new Date(), settings = {}) {
  const tz = settings.timezone || SETTLEMENT_TZ;
  const cutoffWd = Number(settings.application_cutoff_weekday ?? DEFAULT_WEEKLY_SETTINGS.application_cutoff_weekday);
  const cutoffTime = String(settings.application_cutoff_time || DEFAULT_WEEKLY_SETTINGS.application_cutoff_time);
  const [ch, cm] = cutoffTime.split(":").map((x) => Number(x) || 0);
  const parts = zonedParts(now, tz);
  const thisFriday = fridayOfWeekContaining(parts.dateKey);

  const pastCutoff =
    parts.weekday > cutoffWd ||
    (parts.weekday === cutoffWd && (parts.hour > ch || (parts.hour === ch && parts.minute > cm)));

  if (!pastCutoff) return thisFriday;
  // After cutoff → next Friday (7 days after this week's Friday, or friday of next week)
  return addDaysToDateKey(thisFriday, 7);
}

/** Next settlement Friday after a given settlement_date (rollover). */
export function nextSettlementFriday(settlementDate) {
  return addDaysToDateKey(String(settlementDate).slice(0, 10), 7);
}

export function formatSettlementHint(settlementDate) {
  const d = String(settlementDate || "").slice(0, 10);
  return d ? `预计发放日期：${d}（星期五）` : "预计发放日期：本周五或下周五";
}

export function weeklyBannerCopy(settings = {}) {
  const cutoff = settings.application_cutoff_time || "23:59";
  return {
    companionTitle: "每周五统一发放",
    companionBody: `周四 ${cutoff} 前提交 → 本周五发放；截止后提交 → 下周五发放。平台时区 Asia/Kuala_Lumpur。`,
    csTitle: "每周五统一结算",
    csBody: `本周可提交工资结算申请（金额系统自动计算）。周四 ${cutoff} 前 → 本周五；截止后 → 下周五。`,
  };
}

/** Normalize any DB/legacy status → canonical payout status */
export function normalizePayoutStatus(raw) {
  const s = String(raw || "").trim();
  const map = {
    pending: "submitted",
    pending_review: "pending_friday",
    draft: "submitted",
    submitted: "submitted",
    pending_friday: "pending_friday",
    reviewing: "reviewing",
    processing: "processing",
    approved: "approved",
    approved_for_payout: "pending_payment",
    approved_pending_pay: "pending_payment",
    pending_payment: "pending_payment",
    included_in_batch: "pending_payment",
    paying: "pending_payment",
    paid_pending_receipt: "paid",
    paid: "paid",
    completed: "completed",
    rejected: "rejected",
    failed: "failed",
    rolled_over: "rolled_over",
    carried_forward: "rolled_over",
    pay_failed: "failed",
    cancelled: "rejected",
  };
  return map[s] || s || "submitted";
}

export function statusText(raw) {
  const n = normalizePayoutStatus(raw);
  return PAYOUT_STATUS_TEXT[n] || PAYOUT_STATUS_TEXT[raw] || raw || "-";
}

/** Whether admin can start review / approve from this status */
export function canStartReview(status) {
  const n = normalizePayoutStatus(status);
  return n === "submitted" || n === "pending_friday" || n === "rolled_over";
}

export function canApprove(status) {
  const n = normalizePayoutStatus(status);
  return n === "reviewing" || n === "submitted" || n === "pending_friday" || n === "rolled_over";
}

export function canMarkPaid(status) {
  const n = normalizePayoutStatus(status);
  return n === "approved" || n === "pending_payment" || n === "processing" || n === "paid" || n === "failed";
}

export function canReject(status) {
  const n = normalizePayoutStatus(status);
  return !["completed", "rejected", "paid"].includes(n) || n === "paid";
}

/** ISO week number in SETTLEMENT_TZ for a Friday date key YYYY-MM-DD */
export function isoWeekParts(dateKey, timeZone = SETTLEMENT_TZ) {
  const key = String(dateKey || "").slice(0, 10);
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) {
    const parts = zonedParts(new Date(), timeZone);
    return isoWeekParts(parts.dateKey, timeZone);
  }
  // ISO week: Thursday of this week determines year
  const date = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return { weekYear: date.getUTCFullYear(), weekNumber: weekNo };
}

/** Batch code e.g. MCJ-PAYOUT-2026-W32 */
export function buildBatchCode(settlementFriday, timeZone = SETTLEMENT_TZ) {
  const { weekYear, weekNumber } = isoWeekParts(settlementFriday, timeZone);
  return `MCJ-PAYOUT-${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}

export function weekRangeFromFriday(fridayKey) {
  const end = String(fridayKey || "").slice(0, 10);
  const start = addDaysToDateKey(end, -4); // Mon–Fri window display
  return { weekStart: start, weekEnd: end };
}

/** Merge finance_settings row with weekly defaults */
export function mergeWeeklySettings(row = {}) {
  return {
    ...DEFAULT_WEEKLY_SETTINGS,
    ...row,
    min_withdraw_cat_food: Number(row.min_withdraw_cat_food ?? DEFAULT_WEEKLY_SETTINGS.min_withdraw_cat_food),
    max_withdrawals_per_week: Number(
      row.max_withdrawals_per_week ?? row.max_withdrawals_per_month ?? DEFAULT_WEEKLY_SETTINGS.max_withdrawals_per_week
    ),
    holiday_rollover_enabled:
      row.holiday_rollover_enabled == null ? true : !!row.holiday_rollover_enabled,
    timezone: row.timezone || SETTLEMENT_TZ,
  };
}

/** Count withdrawals in current settlement week (by settlement_date or submitted_at) */
export function isSameSettlementWeek(settlementDate, targetFriday) {
  return String(settlementDate || "").slice(0, 10) === String(targetFriday || "").slice(0, 10);
}

export function viewWeeklyRules(settings = {}, now = new Date()) {
  const cfg = mergeWeeklySettings(settings);
  const settlementDate = computeSettlementDate(now, cfg);
  const parts = zonedParts(now, cfg.timezone);
  const thisFriday = fridayOfWeekContaining(parts.dateKey);
  const copy = weeklyBannerCopy(cfg);
  return {
    timezone: cfg.timezone,
    payoutWeekday: "星期五",
    applicationCutoff: `星期四 ${cfg.application_cutoff_time}`,
    payoutWindow: `${cfg.payout_window_start}–${cfg.payout_window_end}`,
    holidayRolloverEnabled: !!cfg.holiday_rollover_enabled,
    minWithdrawAmount: cfg.min_withdraw_cat_food,
    maxPerWeek: cfg.max_withdrawals_per_week,
    nextSettlementDate: settlementDate,
    thisFriday,
    nextFriday: addDaysToDateKey(thisFriday, 7),
    bannerTitle: copy.companionTitle,
    bannerBody: copy.companionBody,
    csBannerTitle: copy.csTitle,
    csBannerBody: copy.csBody,
    settlementHint: formatSettlementHint(settlementDate),
  };
}
