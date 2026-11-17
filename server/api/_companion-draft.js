/**
 * Companion application draft lifecycle helpers.
 * Drafts must never appear in formal companion / hall / CS operational lists.
 *
 * Canonical application_status:
 *   draft | pending (= submitted / pending_review) | rejected | resubmit / need_more | approved
 * Archive: archived | deleted
 * Legacy approved aliases: verified | passed
 */

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeApplicationStatus(row = {}) {
  return String(row.application_status || row.applicationStatus || "")
    .trim()
    .toLowerCase();
}

export function isApplicationApproved(row = {}) {
  return /^(approved|verified|passed)$/.test(normalizeApplicationStatus(row));
}

export function isApplicationArchived(row = {}) {
  return /^(archived|deleted)$/.test(normalizeApplicationStatus(row));
}

/**
 * Explicitly submitted / in-review statuses. These belong in the admin queue
 * even when legacy rows are missing application_submitted_at.
 */
export function isExplicitPendingApplication(row = {}) {
  const st = normalizeApplicationStatus(row);
  return /^(pending|submitted|pending_review)$/.test(st) || (/review/.test(st) && !/preview/.test(st));
}

/**
 * Never-submitted / explicit draft / archived rows.
 * Explicit pending/submitted/review is NOT a draft — even if application_submitted_at is null.
 */
export function isApplicationDraft(row = {}) {
  if (!row || !row.id) return false;
  if (isApplicationApproved(row)) return false;
  const st = normalizeApplicationStatus(row);
  if (/^(draft|archived|deleted)$/.test(st)) return true;
  if (isExplicitPendingApplication(row)) return false;
  const submitted = row.application_submitted_at || row.applicationSubmittedAt || "";
  if (submitted) return false;
  if (/^(rejected|resubmit|need_more)$/.test(st)) return false;
  return true;
}

/** Formal 陪玩管理: only review-approved companions. */
export function isFormalCompanion(row = {}) {
  return isApplicationApproved(row) && !isApplicationArchived(row);
}

/** Infer submitted timestamp for legacy pending rows missing the column. */
export function inferApplicationSubmittedAt(row = {}) {
  const existing = row.application_submitted_at || row.applicationSubmittedAt || "";
  if (existing) return existing;
  if (!isExplicitPendingApplication(row) && !/^(rejected|resubmit|need_more)$/.test(normalizeApplicationStatus(row))) {
    return "";
  }
  return row.updated_at || row.updatedAt || row.created_at || row.createdAt || "";
}

/** 陪玩申请审核 queue: formally submitted OR explicit pending/review status. */
export function isApplicationQueueRow(row = {}) {
  if (!row || !row.id) return false;
  if (isApplicationArchived(row) || isApplicationApproved(row)) return false;
  if (isApplicationDraft(row)) return false;
  const submitted = inferApplicationSubmittedAt(row);
  if (submitted) return true;
  return isExplicitPendingApplication(row);
}

/** Active (non-archived) application — blocks duplicate register. */
export function isActiveApplication(row = {}) {
  if (!row || !row.id) return false;
  if (isApplicationArchived(row)) return false;
  if (isFormalCompanion(row)) return true;
  if (isApplicationDraft(row)) return true;
  const st = normalizeApplicationStatus(row);
  return /^(pending|submitted|pending_review|rejected|resubmit|need_more)$/.test(st) || /review/.test(st);
}

export function draftAgeMs(row = {}) {
  const raw = row.updated_at || row.updatedAt || row.created_at || row.createdAt || "";
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return 0;
  return Date.now() - t;
}

export function isExpiredDraft(row = {}, ttlMs = DRAFT_TTL_MS) {
  return isApplicationDraft(row) && draftAgeMs(row) > ttlMs;
}

export { DRAFT_TTL_MS };
