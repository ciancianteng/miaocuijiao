/**
 * Designated-order notifications for companions:
 * - inbox notice
 * - Resend/SMTP email (idempotent by notification_key)
 * - realtime broadcast fallback (does not require orders publication)
 *
 * Failures never block order mutations.
 */
import { insertCompanionNotification } from "./_companion-inbox.js";
import { sendMail } from "./_mail.js";
import { claimedAtFromOrder, confirmDeadlineIso, COMPANION_CONFIRM_TIMEOUT_MS } from "./_order-confirm-timeout.js";
import { resolvePlatformCommission } from "./_commission-rates.js";

function nowIso() {
  return new Date().toISOString();
}

function env(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null) return String(fallback || "").trim();
  return String(raw).trim().replace(/^['"]|['"]$/g, "");
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

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function publicSiteOrigin() {
  const raw =
    env("PUBLIC_SITE_URL") ||
    env("SITE_URL") ||
    env("APP_URL") ||
    (env("VERCEL_ENV") === "production" ? "https://meowcuijiao.com" : "https://meow-cuijiao-homepage-staging.vercel.app");
  return String(raw || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
}

function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function orderNoOf(order = {}) {
  return String(order.order_no || order.orderNo || order.id || "").trim();
}

function durationLabel(order = {}) {
  if (order.hours) return `${order.hours}小时`;
  if (order.rounds || order.games_count) return `${order.rounds || order.games_count}局`;
  return String(order.duration || order.service_duration || "-").trim() || "-";
}

function estimateCompanionIncome(order = {}, companionShareRate) {
  const amount = money(order.total_amount ?? order.amount);
  const rate =
    Number.isFinite(Number(companionShareRate)) && Number(companionShareRate) > 0
      ? Number(companionShareRate)
      : resolvePlatformCommission(order.commission_rate || order.companion_rate).companionShareRate;
  return Math.round(((amount * rate) / 100) * 100) / 100;
}

function buildNotificationKey({ orderId, companionId, eventType }) {
  return `${String(orderId || "").trim()}:${String(companionId || "").trim()}:${String(eventType || "assign").trim()}`;
}

const MAIL_TYPE_LABEL = {
  assign: "新指定订单",
  reassign: "重新指定订单",
  status: "订单状态变化",
  timeout_warn: "确认即将超时",
  unassigned: "订单已改派",
};

async function findEmailLogByKey(notificationKey) {
  const key = String(notificationKey || "").trim();
  if (!key) return null;
  const mailKey = key.startsWith("mail:") ? key : `mail:${key}`;
  try {
    const byNotice = await supabaseJson(
      restUrl("companion_notification_emails", `?notice_key=eq.${encodeURIComponent(key)}&select=*&limit=1`),
      { headers: serviceHeaders() }
    );
    if (byNotice?.[0]) return byNotice[0];
  } catch (err) {
    if (/Could not find the table|schema cache|PGRST/i.test(String(err?.message || err || ""))) {
      // fall through to notifications fallback
    } else {
      /* ignore other */
    }
  }
  try {
    const byNotif = await supabaseJson(
      restUrl("companion_notification_emails", `?notification_key=eq.${encodeURIComponent(key)}&select=*&limit=1`),
      { headers: serviceHeaders() }
    );
    if (byNotif?.[0]) return byNotif[0];
  } catch {
    /* ignore */
  }
  try {
    const fallback = await supabaseJson(
      restUrl(
        "companion_notifications",
        `?or=(notice_key.eq.${encodeURIComponent(mailKey)},notice_key.eq.${encodeURIComponent(key)})&category=eq.email_log&select=*&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (fallback?.[0]) {
      let meta = {};
      try {
        meta = JSON.parse(fallback[0].body || "{}");
      } catch {
        meta = {};
      }
      return {
        id: fallback[0].id,
        notice_key: fallback[0].notice_key || mailKey,
        notification_key: key,
        email_status: meta.emailStatus || "email_pending",
        detail: meta.detail || "",
        email: meta.email || "",
        retry_count: Number(meta.retryCount || 0) || 0,
        _fallback: true,
        _fallbackRow: fallback[0],
        _meta: meta,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function persistEmailLogFallback(row) {
  const notificationKey = row.notificationKey;
  const mailKey = `mail:${notificationKey}`;
  const body = JSON.stringify({
    email: row.email || "",
    subject: row.subject || "",
    emailStatus: row.emailStatus || "email_pending",
    detail: row.detail || "",
    mailType: row.mailType || "assign",
    orderId: row.orderId || "",
    orderNo: row.orderNo || "",
    retryCount: Number(row.retryCount || 0) || 0,
    sentAt: row.emailStatus === "sent" ? nowIso() : "",
    notificationKey,
  });
  try {
    await insertCompanionNotification({
      companionUserId: row.companionId,
      category: "email_log",
      title: row.subject || "邮件通知记录",
      body,
      href: "/companion/orders",
      noticeKey: mailKey,
      notificationType: "email_log",
    });
    return { id: mailKey, notice_key: mailKey, notification_key: notificationKey, _fallback: true };
  } catch (err) {
    console.warn("[companion-order-notify] fallback email log failed", err?.message || err);
    return null;
  }
}

async function persistEmailLog(row) {
  const payload = {
    companion_id: row.companionId,
    notice_key: row.notificationKey,
    notification_key: row.notificationKey,
    email: String(row.email || "").trim(),
    subject: String(row.subject || "").trim(),
    body: String(row.body || "").trim().slice(0, 8000),
    related_application_id: null,
    email_status: row.emailStatus || "email_pending",
    detail: String(row.detail || "").slice(0, 800),
    mail_type: row.mailType || "assign",
    order_id: row.orderId || null,
    order_no: row.orderNo || "",
    retry_count: Number(row.retryCount || 0) || 0,
    last_attempt_at: nowIso(),
    sent_at: row.emailStatus === "sent" ? nowIso() : null,
    created_at: nowIso(),
  };
  try {
    const created = await supabaseJson(restUrl("companion_notification_emails", ""), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify(payload),
    });
    return created?.[0] || payload;
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/Could not find the table|schema cache|PGRST205/i.test(msg) || /column|PGRST204/i.test(msg)) {
      // Columns may be missing before migration — try lean row, then notifications fallback.
      if (!/Could not find the table|PGRST205/i.test(msg)) {
        try {
          const lean = {
            companion_id: payload.companion_id,
            notice_key: payload.notice_key,
            email: payload.email,
            subject: payload.subject,
            body: payload.body,
            email_status: payload.email_status,
            detail: payload.detail,
            created_at: payload.created_at,
          };
          const created = await supabaseJson(restUrl("companion_notification_emails", ""), {
            method: "POST",
            headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
            body: JSON.stringify(lean),
          });
          return created?.[0] || lean;
        } catch {
          /* fall through */
        }
      }
      return persistEmailLogFallback(row);
    }
    if (/duplicate|unique|23505/i.test(msg)) {
      return findEmailLogByKey(row.notificationKey);
    }
    console.warn("[companion-order-notify] persist email log failed", msg);
    return persistEmailLogFallback(row);
  }
}

async function patchEmailLog(id, patch) {
  if (!id) return;
  try {
    await supabaseJson(restUrl("companion_notification_emails", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ ...patch, last_attempt_at: nowIso() }),
    });
    return;
  } catch {
    /* try fallback notice_key patch */
  }
  try {
    const existing = await findEmailLogByKey(String(id));
    const meta = {
      ...(existing?._meta || {}),
      emailStatus: patch.email_status || existing?._meta?.emailStatus,
      detail: patch.detail || existing?._meta?.detail || "",
      retryCount: patch.retry_count != null ? patch.retry_count : existing?._meta?.retryCount || 0,
      email: patch.email || existing?._meta?.email || "",
      subject: patch.subject || existing?._meta?.subject || "",
      sentAt: patch.sent_at || (patch.email_status === "sent" ? nowIso() : existing?._meta?.sentAt || ""),
    };
    const key = existing?.notice_key || (String(id).startsWith("mail:") ? String(id) : `mail:${id}`);
    await supabaseJson(
      restUrl("companion_notifications", `?notice_key=eq.${encodeURIComponent(key)}&category=eq.email_log`),
      {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ body: JSON.stringify(meta), title: meta.subject || "邮件通知记录" }),
      }
    );
  } catch {
    /* optional */
  }
}

function orderEmailHtml({ order, income, confirmDeadline, viewUrl, eventType }) {
  const no = orderNoOf(order);
  const game = String(order.game || order.service_name || order.title || "-");
  const service = String(order.service_name || order.title || game || "-");
  const amount = money(order.total_amount ?? order.amount).toFixed(2);
  const rows = [
    ["订单编号", no],
    ["游戏/服务", `${game} / ${service}`],
    ["服务时长", durationLabel(order)],
    ["订单金额", `${amount} 猫粮`],
    ["预计陪玩收益", `${Number(income).toFixed(2)} 猫粮`],
    ["下单时间", formatTime(order.created_at || order.createdAt)],
    ["最迟确认时间", formatTime(confirmDeadline)],
  ];
  const title =
    eventType === "timeout_warn"
      ? "订单即将超时，请尽快确认"
      : eventType === "reassign"
        ? "您被重新指定了一个订单"
        : eventType === "status"
          ? "订单状态已更新"
          : eventType === "unassigned"
            ? "订单已改派给其他陪玩"
            : "您有一个新的指定订单";
  return (
    `<div style="font-family:Segoe UI,PingFang SC,Helvetica,sans-serif;line-height:1.65;color:#221018;max-width:560px;margin:0 auto">` +
    `<p style="font-size:18px;font-weight:700;margin:0 0 12px">【妙脆角】${title}</p>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:8px 0;color:#666;width:120px">${k}</td><td style="padding:8px 0;font-weight:600">${String(v)}</td></tr>`
      )
      .join("") +
    `</table>` +
    `<p style="margin:20px 0 8px"><a href="${viewUrl}" style="display:inline-block;background:#d9488a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">立即查看订单</a></p>` +
    `<p style="margin:0;color:#888;font-size:12px">若按钮无法打开，请复制链接：${viewUrl}</p>` +
    `</div>`
  );
}

function orderEmailText({ order, income, confirmDeadline, viewUrl, eventType }) {
  const no = orderNoOf(order);
  const title =
    eventType === "timeout_warn"
      ? "订单即将超时，请尽快确认"
      : eventType === "reassign"
        ? "您被重新指定了一个订单"
        : "您有一个新的指定订单";
  return (
    `【妙脆角】${title}\n\n` +
    `订单编号：${no}\n` +
    `游戏/服务：${order.game || "-"} / ${order.service_name || order.title || "-"}\n` +
    `服务时长：${durationLabel(order)}\n` +
    `订单金额：${money(order.total_amount ?? order.amount).toFixed(2)} 猫粮\n` +
    `预计陪玩收益：${Number(income).toFixed(2)} 猫粮\n` +
    `下单时间：${formatTime(order.created_at)}\n` +
    `最迟确认时间：${formatTime(confirmDeadline)}\n\n` +
    `立即查看订单：${viewUrl}\n`
  );
}

async function resolveCompanionEmail(companionUserId, emailHint = "") {
  let to = String(emailHint || "").trim().toLowerCase();
  if (to) return to;
  if (!companionUserId) return "";
  try {
    const rows = await supabaseJson(
      restUrl("profiles", `?id=eq.${encodeURIComponent(companionUserId)}&select=email&limit=1`),
      { headers: serviceHeaders() }
    );
    return String(rows?.[0]?.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

/** Fire-and-forget Realtime broadcast so open companion tabs wake without waiting for poll. */
export async function broadcastCompanionOrderEvent(companionId, event, payload = {}) {
  const uid = String(companionId || "").trim();
  if (!uid) return { ok: false, skipped: true };
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return { ok: false, skipped: true, reason: "no_supabase" };
  const topic = `mcj-companion-orders:${uid}`;
  try {
    const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic,
            event: String(event || "order_changed"),
            payload: { companionId: uid, at: nowIso(), ...payload },
            private: false,
          },
        ],
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[companion-order-notify] broadcast fail", response.status, text.slice(0, 200));
      return { ok: false, status: response.status };
    }
    return { ok: true, topic };
  } catch (err) {
    console.warn("[companion-order-notify] broadcast error", err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

async function sendOrderMailOnce({
  companionId,
  order,
  eventType = "assign",
  email = "",
  forceRetry = false,
} = {}) {
  const orderId = String(order?.id || "").trim();
  const cid = String(companionId || order?.companion_id || "").trim();
  if (!orderId || !cid) return { ok: false, skipped: true, reason: "missing_ids" };

  const notificationKey = buildNotificationKey({ orderId, companionId: cid, eventType });
  const existing = await findEmailLogByKey(notificationKey);
  if (existing && String(existing.email_status || "") === "sent" && !forceRetry) {
    return { ok: true, skipped: true, reason: "already_sent", notificationKey, logId: existing.id };
  }
  if (existing && !forceRetry && /sent|skipped/i.test(String(existing.email_status || ""))) {
    return { ok: true, skipped: true, reason: "already_logged", notificationKey, logId: existing.id };
  }

  const to = await resolveCompanionEmail(cid, email || existing?.email);
  const no = orderNoOf(order);
  const income = estimateCompanionIncome(order);
  const anchor = claimedAtFromOrder(order) || order.accepted_at || order.paid_at || order.created_at || nowIso();
  const confirmDeadline = confirmDeadlineIso(anchor);
  const viewUrl = `${publicSiteOrigin()}/companion/orders?focus=${encodeURIComponent(orderId)}&filter=waiting_confirm`;
  const subject =
    eventType === "timeout_warn"
      ? `【妙脆角】订单即将超时未确认 ${no}`
      : String(eventType).startsWith("status_")
        ? `【妙脆角】订单状态更新 ${no}`
        : eventType === "unassigned"
          ? `【妙脆角】订单已改派 ${no}`
          : `【妙脆角】您有一个新的指定订单 ${no}`;
  const html = orderEmailHtml({
    order,
    income,
    confirmDeadline,
    viewUrl,
    eventType: String(eventType).startsWith("status_") ? "status" : eventType,
  });
  const text = orderEmailText({
    order,
    income,
    confirmDeadline,
    viewUrl,
    eventType: String(eventType).startsWith("status_") ? "status" : eventType,
  });
  const mailType = eventType === "reassign" ? "reassign" : String(eventType).startsWith("status_") ? "status" : eventType;

  let logId = existing?.id || null;
  const retryCount = Number(existing?.retry_count || 0) + (existing ? 1 : 0);
  if (!existing) {
    const created = await persistEmailLog({
      companionId: cid,
      notificationKey,
      email: to,
      subject,
      body: text,
      emailStatus: "email_pending",
      detail: to ? "queued" : "无收件邮箱",
      mailType,
      orderId,
      orderNo: no,
      retryCount: 0,
    });
    logId = created?.id || null;
    if (!logId) {
      // Unique race: another worker inserted the same notification_key.
      const raced = await findEmailLogByKey(notificationKey);
      if (raced && String(raced.email_status || "") === "sent") {
        return { ok: true, skipped: true, reason: "already_sent_race", notificationKey, logId: raced.id };
      }
      logId = raced?.id || null;
    }
    if (!to) {
      return { ok: false, notificationKey, emailStatus: "email_pending", detail: "无收件邮箱", logId };
    }
  } else if (forceRetry || /failed|email_pending/i.test(String(existing.email_status || ""))) {
    await patchEmailLog(logId, {
      email_status: "email_pending",
      detail: forceRetry ? "retrying" : "resuming",
      retry_count: retryCount,
      email: to || existing.email,
      subject,
      body: text,
    });
  }

  if (!to) {
    await patchEmailLog(logId, { email_status: "failed", detail: "无收件邮箱", retry_count: retryCount });
    return { ok: false, notificationKey, emailStatus: "failed", detail: "无收件邮箱", logId };
  }

  try {
    const preferredFrom = env("RESEND_ORDERS_FROM") || "Meow Cui Jiao <orders@meowcuijiao.com>";
    try {
      await sendMail({
        to,
        subject,
        text,
        html,
        purpose: `companion_order_${mailType}`,
        from: preferredFrom,
      });
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (/domain is not verified|not verified/i.test(msg) && preferredFrom) {
        // Staging / unverified custom domain → fall back to configured RESEND_FROM.
        await sendMail({
          to,
          subject,
          text,
          html,
          purpose: `companion_order_${mailType}`,
        });
      } else {
        throw err;
      }
    }
    await patchEmailLog(logId, {
      email_status: "sent",
      detail: "sent",
      sent_at: nowIso(),
      retry_count: retryCount,
      email: to,
    });
    return { ok: true, notificationKey, emailStatus: "sent", logId };
  } catch (err) {
    const detail = String(err?.message || err || "send failed").slice(0, 500);
    await patchEmailLog(logId, {
      email_status: "failed",
      detail,
      retry_count: retryCount,
      email: to,
    });
    console.warn("[companion-order-notify] mail failed", notificationKey, detail);
    return { ok: false, notificationKey, emailStatus: "failed", detail, logId };
  }
}

/**
 * New designated assign / reassign → inbox + email + broadcast.
 * @param {'assign'|'reassign'} eventType
 */
export async function notifyCompanionOrderAssigned(order, { eventType = "assign", email = "", previousCompanionId = "" } = {}) {
  const companionId = String(order?.companion_id || "").trim();
  if (!order?.id || !companionId) return { ok: false, skipped: true };
  // Unpaid designated bind: still notify so companion sees upcoming order, but only when claimed/pending confirm path preferred.
  const status = String(order.status || "");
  if (status === "awaiting_payment") {
    // Skip email until paid→claimed; still broadcast lightly so UI can refresh.
    await broadcastCompanionOrderEvent(companionId, "order_changed", {
      orderId: order.id,
      status,
      reason: "assigned_unpaid",
    }).catch(() => {});
    return { ok: true, skipped: true, reason: "awaiting_payment" };
  }

  const type = eventType === "reassign" || (previousCompanionId && previousCompanionId !== companionId) ? "reassign" : "assign";
  const no = orderNoOf(order);
  const href = `/companion/orders?focus=${encodeURIComponent(order.id)}&filter=waiting_confirm`;
  const noticeKey = buildNotificationKey({ orderId: order.id, companionId, eventType: type });

  try {
    await insertCompanionNotification({
      companionUserId: companionId,
      category: "order",
      title: type === "reassign" ? "你有新的重新指定订单" : "你有新的指定订单",
      body: `订单 ${no} 等待确认接单。`,
      href,
      noticeKey,
      notificationType: type === "reassign" ? "order_reassigned" : "order_assigned",
    });
  } catch (err) {
    console.warn("[companion-order-notify] inbox failed", err?.message || err);
  }

  await broadcastCompanionOrderEvent(companionId, "order_assigned", {
    orderId: order.id,
    orderNo: no,
    status: order.status,
    eventType: type,
  }).catch(() => {});

  if (previousCompanionId && previousCompanionId !== companionId) {
    const prevKey = buildNotificationKey({
      orderId: order.id,
      companionId: previousCompanionId,
      eventType: "unassigned",
    });
    try {
      await insertCompanionNotification({
        companionUserId: previousCompanionId,
        category: "order",
        title: "订单已改派",
        body: `订单 ${no} 已改派给其他陪玩。`,
        href: "/companion/orders",
        noticeKey: prevKey,
        notificationType: "order_unassigned",
      });
    } catch {
      /* ignore */
    }
    await broadcastCompanionOrderEvent(previousCompanionId, "order_changed", {
      orderId: order.id,
      eventType: "unassigned",
    }).catch(() => {});
    sendOrderMailOnce({
      companionId: previousCompanionId,
      order: { ...order, companion_id: previousCompanionId },
      eventType: "unassigned",
    }).catch(() => {});
  }

  const mail = await sendOrderMailOnce({ companionId, order, eventType: type, email }).catch((err) => ({
    ok: false,
    emailStatus: "failed",
    detail: String(err?.message || err),
  }));
  return { ok: true, eventType: type, mail, notificationKey: noticeKey };
}

/** Important status change email (idempotent per status). */
export async function notifyCompanionOrderStatusChange(order, { status, email = "" } = {}) {
  const companionId = String(order?.companion_id || "").trim();
  const st = String(status || order?.status || "").trim();
  if (!order?.id || !companionId || !st) return { ok: false, skipped: true };
  const important = new Set(["confirmed", "in_progress", "completed", "cancelled", "refunded", "refund_requested"]);
  if (!important.has(st)) return { ok: false, skipped: true, reason: "not_important" };

  const eventType = `status_${st}`;
  const noticeKey = buildNotificationKey({ orderId: order.id, companionId, eventType });
  try {
    await insertCompanionNotification({
      companionUserId: companionId,
      category: "order",
      title: "订单状态更新",
      body: `订单 ${orderNoOf(order)} 状态：${st}`,
      href: `/companion/orders?focus=${encodeURIComponent(order.id)}`,
      noticeKey,
      notificationType: "order_status",
    });
  } catch {
    /* ignore */
  }
  await broadcastCompanionOrderEvent(companionId, "order_changed", {
    orderId: order.id,
    status: st,
    eventType: "status",
  }).catch(() => {});
  const mail = await sendOrderMailOnce({
    companionId,
    order: { ...order, status: st },
    eventType,
    email,
  }).catch((err) => ({ ok: false, detail: String(err?.message || err) }));
  return { ok: true, mail, notificationKey: noticeKey };
}

/**
 * Warn when claimed order is close to confirm timeout (idempotent).
 * Default: ≤90s remaining (SLA = COMPANION_CONFIRM_TIMEOUT_MS).
 */
export async function maybeNotifyConfirmDeadlineWarning(order, { email = "" } = {}) {
  if (!order || order.status !== "claimed" || !order.companion_id) return { ok: false, skipped: true };
  const anchor = claimedAtFromOrder(order) || order.accepted_at || "";
  if (!anchor) return { ok: false, skipped: true, reason: "no_anchor" };
  const elapsed = Date.now() - Date.parse(anchor);
  if (!Number.isFinite(elapsed) || elapsed < 0) return { ok: false, skipped: true };
  const remaining = COMPANION_CONFIRM_TIMEOUT_MS - elapsed;
  if (remaining > 90 * 1000 || remaining < 0) return { ok: false, skipped: true, reason: "not_near_timeout" };

  const companionId = String(order.companion_id).trim();
  const noticeKey = buildNotificationKey({ orderId: order.id, companionId, eventType: "timeout_warn" });
  try {
    await insertCompanionNotification({
      companionUserId: companionId,
      category: "order",
      title: "指定订单即将超时",
      body: `订单 ${orderNoOf(order)} 即将超过确认时限，请尽快确认接单。`,
      href: `/companion/orders?focus=${encodeURIComponent(order.id)}&filter=waiting_confirm`,
      noticeKey,
      notificationType: "order_timeout_warn",
    });
  } catch {
    /* ignore */
  }
  await broadcastCompanionOrderEvent(companionId, "order_assigned", {
    orderId: order.id,
    eventType: "timeout_warn",
  }).catch(() => {});
  const mail = await sendOrderMailOnce({ companionId, order, eventType: "timeout_warn", email }).catch((err) => ({
    ok: false,
    detail: String(err?.message || err),
  }));
  return { ok: true, mail, notificationKey: noticeKey };
}

/** Retry failed / pending order emails (admin + opportunistic). */
export async function retryFailedCompanionOrderEmails({ limit = 10 } = {}) {
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl(
        "companion_notification_emails",
        `?or=(email_status.eq.failed,email_status.eq.email_pending)&order=created_at.asc&limit=${Math.min(40, Number(limit) || 10)}`
      ),
      { headers: serviceHeaders() }
    );
  } catch {
    rows = [];
  }
  if (!rows?.length) {
    // Fallback source when email table is missing.
    const mapped = await listCompanionNotificationEmails({ limit: Math.min(40, Number(limit) || 10) });
    rows = (mapped || [])
      .filter((x) => /failed|email_pending/i.test(String(x.status || "")))
      .map((x) => ({
        id: x.id,
        companion_id: x.companionId,
        notice_key: x.notificationKey,
        notification_key: x.notificationKey,
        email: x.recipient,
        order_id: x.orderId,
        order_no: x.orderNo,
        mail_type: x.mailType,
        email_status: x.status,
        retry_count: x.retryCount,
        _fallback: x.source === "notifications_fallback",
      }));
  }
  const out = [];
  for (const row of rows || []) {
    if (!row?.order_id && !/^[0-9a-f-]{36}:/i.test(String(row.notice_key || row.notification_key || ""))) continue;
    const parts = String(row.notice_key || row.notification_key || "").replace(/^mail:/, "").split(":");
    const orderId = row.order_id || parts[0] || "";
    const companionId = row.companion_id || parts[1] || "";
    const eventType = parts[2] || row.mail_type || "assign";
    if (!orderId || !companionId) continue;
    let order = { id: orderId, order_no: row.order_no, companion_id: companionId };
    try {
      const found = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&limit=1`), {
        headers: serviceHeaders(),
      });
      if (found?.[0]) order = found[0];
    } catch {
      /* use stub */
    }
    const result = await sendOrderMailOnce({
      companionId,
      order,
      eventType,
      email: row.email,
      forceRetry: true,
    });
    out.push(result);
  }
  return { ok: true, retried: out.length, results: out };
}

export async function listCompanionNotificationEmails({ limit = 100, status = "" } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  let q = `?select=*&order=created_at.desc&limit=${lim}`;
  if (status) q = `?email_status=eq.${encodeURIComponent(status)}&select=*&order=created_at.desc&limit=${lim}`;
  try {
    const rows = await supabaseJson(restUrl("companion_notification_emails", q), { headers: serviceHeaders() });
    return (rows || []).map((row) => ({
      id: row.id,
      recipient: row.email || "",
      orderNo: row.order_no || "",
      orderId: row.order_id || "",
      mailType: row.mail_type || MAIL_TYPE_LABEL[String(row.notice_key || "").split(":")[2]] || "generic",
      mailTypeLabel: MAIL_TYPE_LABEL[row.mail_type] || MAIL_TYPE_LABEL[String(row.notice_key || "").split(":")[2]] || row.mail_type || "通知",
      notificationKey: row.notification_key || row.notice_key || "",
      createdAt: row.created_at || "",
      sentAt: row.sent_at || "",
      status: row.email_status || "",
      success: String(row.email_status || "") === "sent",
      failReason: String(row.email_status || "") === "sent" ? "" : row.detail || "",
      retryCount: Number(row.retry_count || 0) || 0,
      subject: row.subject || "",
      companionId: row.companion_id || "",
      source: "email_table",
    }));
  } catch (err) {
    // Table may be missing before migration — fall back to companion_notifications mail_log rows.
    console.warn("[companion-order-notify] email table list fallback", err?.message || err);
    try {
      const notices = await supabaseJson(
        restUrl(
          "companion_notifications",
          `?category=eq.email_log&order=created_at.desc&limit=${lim}`
        ),
        { headers: serviceHeaders() }
      );
      return (notices || []).map((row) => {
        let meta = {};
        try {
          meta = JSON.parse(row.body || "{}");
        } catch {
          meta = { detail: row.body || "" };
        }
        const rawKey = String(row.notice_key || "").replace(/^mail:/, "");
        return {
          id: row.id || row.notice_key,
          recipient: meta.email || "",
          orderNo: meta.orderNo || "",
          orderId: meta.orderId || "",
          mailType: meta.mailType || "generic",
          mailTypeLabel: MAIL_TYPE_LABEL[meta.mailType] || meta.mailType || "通知",
          notificationKey: meta.notificationKey || rawKey,
          createdAt: row.created_at || "",
          sentAt: meta.sentAt || "",
          status: meta.emailStatus || "",
          success: String(meta.emailStatus || "") === "sent",
          failReason: String(meta.emailStatus || "") === "sent" ? "" : meta.detail || "",
          retryCount: Number(meta.retryCount || 0) || 0,
          subject: meta.subject || row.title || "",
          companionId: row.companion_id || "",
          source: "notifications_fallback",
        };
      });
    } catch {
      return [];
    }
  }
}

export { buildNotificationKey, MAIL_TYPE_LABEL };
