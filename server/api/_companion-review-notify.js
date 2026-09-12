/**
 * Companion application review: inbox notice + email (or email_pending).
 */
import { insertCompanionNotification } from "./_companion-inbox.js";
import { sendMail } from "./_mail.js";

function nowIso() {
  return new Date().toISOString();
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
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
    throw new Error(body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || "数据库请求失败");
  }
  return body;
}

export const COMPANION_AUTH_LOCK_MSG = "您的陪玩认证尚未通过，暂不可使用此功能。";

/**
 * Canonical application_status values stored in DB:
 * draft | pending (= submitted / pending_review) | rejected | resubmit | need_more | approved
 * (+ legacy verified|passed, archive archived|deleted)
 */
export function normalizeApplicationStatus(raw = "") {
  const v = String(raw || "").trim().toLowerCase();
  if (/approved|verified|passed/.test(v)) return "approved";
  if (/reject/.test(v)) return "rejected";
  if (/resubmit|need_more/.test(v)) return "need_more";
  if (/^draft$|^archived$|^deleted$/.test(v)) return "draft";
  if (/submitted|pending_review|pending|review/.test(v)) return "pending";
  return v || "draft";
}

async function trySendReviewEmail({ to, approved, reason = "" }) {
  if (!to) {
    return { ok: false, status: "email_pending", detail: "无收件邮箱" };
  }
  try {
    const subject = approved ? "妙脆角陪玩认证已通过" : "妙脆角陪玩申请需要修改";
    const text = approved
      ? "恭喜您已通过 Meow Cui Jiao 陪玩认证。\n现在可以登录陪玩端开始接单。"
      : `您的陪玩申请暂未通过。\n请登录陪玩端查看驳回原因并修改后重新提交。${reason ? `\n驳回原因：${reason}` : ""}`;
    await sendMail({ to, subject, text, purpose: "companion_review" });
    return { ok: true, status: "sent", detail: "sent" };
  } catch (err) {
    return { ok: false, status: "email_pending", detail: String(err?.message || err || "send failed") };
  }
}

async function persistEmailPendingRecord({ companionUserId, noticeKey, email, subject, body, applicationId, emailStatus, detail }) {
  const row = {
    companion_id: companionUserId,
    notice_key: noticeKey,
    email: String(email || "").trim(),
    subject: String(subject || "").trim(),
    body: String(body || "").trim(),
    related_application_id: applicationId || null,
    email_status: emailStatus || "email_pending",
    detail: String(detail || "").slice(0, 500),
    created_at: nowIso(),
  };
  try {
    await supabaseJson(restUrl("companion_notification_emails", ""), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
    return true;
  } catch {
    console.warn("[companion-review-notify] email_pending record not persisted:", row.email_status, row.detail);
    return false;
  }
}

/**
 * Inbox + email for application review result.
 * Email never pretends success when mail provider missing — surfaces email_pending.
 */
export async function notifyCompanionApplicationReview(
  companionUserId,
  { status, reason = "", applicationId = "", email = "" } = {}
) {
  const st = normalizeApplicationStatus(status);
  const approved = st === "approved";
  const rejected = st === "rejected" || st === "need_more" || /reject|resubmit|need_more/i.test(String(status || ""));
  if (!approved && !rejected) {
    return { inboxKey: null, emailStatus: "skipped" };
  }

  const title = approved ? "认证审核通过" : "认证申请需修改";
  const content = approved
    ? "您的陪玩认证已通过，接单权限已经开放。"
    : `原因：${String(reason || "").trim() || "请根据驳回原因修改后重新提交。"}`;
  const href = approved ? "/companion/dashboard" : "/companion/profile";
  const noticeKey = `audit-application-${approved ? "pass" : "reject"}-${Date.now()}`;

  const inboxKey = await insertCompanionNotification({
    companionUserId,
    category: "audit",
    title,
    body: content,
    href,
    noticeKey,
    notificationType: approved ? "application_approved" : "application_rejected",
    relatedApplicationId: applicationId,
  });

  let to = String(email || "").trim().toLowerCase();
  if (!to && companionUserId) {
    try {
      const rows = await supabaseJson(
        restUrl("profiles", `?id=eq.${encodeURIComponent(companionUserId)}&select=email&limit=1`),
        { headers: serviceHeaders() }
      );
      to = String(rows?.[0]?.email || "").trim().toLowerCase();
    } catch {
      to = "";
    }
  }

  const mailSubject = approved ? "妙脆角陪玩认证已通过" : "妙脆角陪玩申请需要修改";
  const mailBody = approved
    ? "恭喜您已通过 Meow Cui Jiao 陪玩认证。\n现在可以登录陪玩端开始接单。"
    : `您的陪玩申请暂未通过。\n请登录陪玩端查看驳回原因并修改后重新提交。${reason ? `\n驳回原因：${reason}` : ""}`;

  const mail = await trySendReviewEmail({ to, approved, reason });
  await persistEmailPendingRecord({
    companionUserId,
    noticeKey: noticeKey || `mail-${Date.now()}`,
    email: to,
    subject: mailSubject,
    body: mailBody,
    applicationId,
    emailStatus: mail.status,
    detail: mail.detail,
  });

  // Surface email_pending on the same notice body when mail was not sent.
  if (mail.status === "email_pending" && inboxKey) {
    try {
      const pendingNote = `${content}\n\n[email_pending] 邮件待发送：${mail.detail || "邮件服务未配置或发送失败"}`;
      await supabaseJson(
        restUrl("companion_notifications", `?companion_id=eq.${encodeURIComponent(companionUserId)}&notice_key=eq.${encodeURIComponent(inboxKey)}`),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ body: pendingNote }),
        }
      );
    } catch {
      /* optional */
    }
  }

  return {
    inboxKey,
    emailStatus: mail.status,
    emailDetail: mail.detail,
    emailPending: mail.status === "email_pending",
  };
}
