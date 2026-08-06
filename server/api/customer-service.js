import "./_load-env.js";
import { mapCompanionPublicFields } from "./_companion-public-map.js";
import { ORDER_STATUS_LABELS } from "./_order-status.js";
import {
  allocateOrderNo,
  csDisplayName,
  formatBossCode,
  formatCompanionCode,
  parseBossCodeNumber,
  parseCompanionCodeNumber,
  resolveCompanionPublicCode,
} from "./_account-codes.js";
import { companionDb } from "./_companion-media-store.js";
import { approveAndLedger, listPendingForCs, rejectProof, signedProofUrl } from "./_payment-receipts.js";
import { bossForCs } from "./_privacy.js";
import { sendEmailOtp, mailProviderStatus } from "./_mail.js";
import {
  conversationLockedByOther as lockOwnedByOther,
  consultTypeLabel,
  normalizeCompanionConsultType,
  normalizeBossConsultType,
  companionProactiveTitle,
  TRANSFER_USER_TIP,
  isPendingTransferStatus,
} from "./_conversation-lock.js";
import {
  CS_LOCK_DENIED,
  CS_LOCK_VIEW_ONLY,
  assertCanMutateOrder,
  assertOwnsConversation,
  isAdminLike,
  lockStatusOf,
  touchConversationActive,
  writeLockLog,
} from "./_cs-session-lock.js";
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ORDER_STATUS_TEXT = { ...ORDER_STATUS_LABELS };
const SERVICE_ROLES = new Set(["customer_service"]);
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const ASSIGN_LOCKS = new Map();
const TEST_NOISE_RE = /\[TEST\]|E2E-MSG|E2E[_-]|CHAT-|CS-LINK|SVC-|MSG-|ORDER-CHAT-|acceptance|自动化测试/i;
const GARBLE_RE = /Ã.|Â.|ä¸|æ.|å.|ç.|è.|é.|ðŸ|ï¼|ï½/;

function json(res, status, data) { return res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
function authUrl(path) { return `${process.env.SUPABASE_URL}/auth/v1/${path}`; }
function serviceHeaders(extra = {}) { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }; }
function anonHeaders(extra = {}) { return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra }; }
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const raw = typeof body === "string" ? body : "";
    const detail = body?.error_description || body?.message || body?.hint || body?.details || body?.error || raw || "";
    const code = body?.code ? ` [${body.code}]` : "";
    throw new Error((detail ? `${detail}${code}` : `Supabase 请求失败 (HTTP ${response.status})`) || `Supabase 请求失败 (HTTP ${response.status})`);
  }
  return body;
}
async function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }
function tokenFrom(req) { return String(req.headers["x-mcj-service-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function nowIso() { return new Date().toISOString(); }
async function nextOrderNo() {
  try {
    return await allocateOrderNo(companionDb);
  } catch {
    return `MCJO${String(Date.now()).slice(-6)}`;
  }
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}
async function tableRows(table, query = "") { const rows = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() }); return Array.isArray(rows) ? rows : []; }
async function maybeRows(table, query = "") { try { return await tableRows(table, query); } catch { return []; } }
async function profileById(id) {
  if (!isUuid(id)) return null;
  const rows = await tableRows("profiles", `?id=eq.${encodeURIComponent(String(id).trim())}&limit=1`);
  return rows[0] || null;
}
async function profileByBossUid(uid) {
  const value = String(uid || "").trim();
  if (!value) return null;
  const rows = await maybeRows("profiles", `?boss_uid=eq.${encodeURIComponent(value)}&role=eq.boss&limit=1`);
  return rows[0] || null;
}
async function resolveBoss(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (isUuid(value)) return profileById(value);
  if (/^(MCJ|B)\d+$/i.test(value)) {
    const n = parseBossCodeNumber(value);
    const normalized = n ? formatBossCode(n) : "";
    if (normalized) {
      const byNormalized = await profileByBossUid(normalized);
      if (byNormalized) return byNormalized;
    }
    return profileByBossUid(value.toUpperCase());
  }
  if (/^\d+$/.test(value)) {
    const withPrefix = await profileByBossUid(formatBossCode(Number(value)));
    if (withPrefix) return withPrefix;
    const legacyPrefix = await profileByBossUid(`B${value}`);
    if (legacyPrefix) return legacyPrefix;
  }
  return profileByBossUid(value);
}
async function resolveCompanion(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (isUuid(value)) {
    const byId = await profileById(value);
    if (byId && byId.role === "companion") return byId;
    return null;
  }
  const seq = parseCompanionCodeNumber(value);
  if (seq > 0) {
    const code = formatCompanionCode(seq);
    const byCode = await maybeRows(
      "companion_profiles",
      `?companion_code=eq.${encodeURIComponent(code)}&select=user_id,companion_uid,companion_code&limit=1`
    );
    if (isUuid(byCode[0]?.user_id)) {
      const profile = await profileById(byCode[0].user_id);
      if (profile && profile.role === "companion") return profile;
    }
    for (const uid of [seq, seq + 100000, code.replace(/^PW/i, "")]) {
      const rows = await maybeRows(
        "companion_profiles",
        `?companion_uid=eq.${encodeURIComponent(uid)}&select=user_id&limit=1`
      );
      if (isUuid(rows[0]?.user_id)) {
        const profile = await profileById(rows[0].user_id);
        if (profile && profile.role === "companion") return profile;
      }
    }
    // Scan public-code resolution (covers missing companion_code column values).
    const pool = await maybeRows(
      "companion_profiles",
      "?select=user_id,companion_uid,companion_code,nickname&limit=500"
    );
    const hit = (pool || []).find((cp) => resolveCompanionPublicCode(cp) === code);
    if (isUuid(hit?.user_id)) {
      const profile = await profileById(hit.user_id);
      if (profile && profile.role === "companion") return profile;
    }
  }
  // Nickname / display_name fallback (exact then ilike).
  const nickExact = await maybeRows(
    "companion_profiles",
    `?nickname=eq.${encodeURIComponent(value)}&select=user_id&limit=3`
  );
  for (const row of nickExact || []) {
    if (!isUuid(row?.user_id)) continue;
    const profile = await profileById(row.user_id);
    if (profile && profile.role === "companion") return profile;
  }
  const nameExact = await maybeRows(
    "profiles",
    `?role=eq.companion&display_name=eq.${encodeURIComponent(value)}&select=id&limit=3`
  );
  if (isUuid(nameExact[0]?.id)) {
    const profile = await profileById(nameExact[0].id);
    if (profile && profile.role === "companion") return profile;
  }
  return null;
}
async function profileMap(ids) { const uniq = [...new Set((ids || []).filter(isUuid))]; if (!uniq.length) return {}; const rows = await maybeRows("profiles", `?id=in.(${uniq.map(encodeURIComponent).join(",")})&limit=1000`); return rows.reduce((map, row) => { map[row.id] = row; return map; }, {}); }
async function authUserFromToken(token) { return supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) }); }
async function requireService(req) { const token = tokenFrom(req); if (!token) throw Object.assign(new Error("请先登录客服端。"), { status: 401 }); const authUser = await authUserFromToken(token); const profile = await profileById(authUser.id); if (!profile || !SERVICE_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问客服端。"), { status: 403 }); if (profile.status !== "active") throw Object.assign(new Error("该客服账号已被停用，请联系管理员。"), { status: 403 }); return { token, authUser, profile }; }

function randomOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function maskPhoneHint(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 7) return "";
  return d.slice(0, 3) + "****" + d.slice(-4);
}
function maskEmailHint(email) {
  const s = String(email || "").trim();
  const at = s.indexOf("@");
  if (at < 1) return "";
  return s.slice(0, 1) + "***" + s.slice(at);
}
async function resolveCsAccount(accountRaw) {
  const account = String(accountRaw || "").trim();
  if (!account) return null;
  // MVP: email-only recovery / lookup for CS accounts.
  if (/@/.test(account)) {
    const byEmail = await maybeRows(
      "profiles",
      `?role=eq.customer_service&email=eq.${encodeURIComponent(account.toLowerCase())}&select=id,email,phone,phone_e164,display_name,status&limit=1`
    );
    if (byEmail[0]?.id) return { profile: byEmail[0], via: "email" };
  }
  return null;
}
async function storeCsResetOtp(accountKey, code) {
  const id = `csr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const exp = Date.now() + 15 * 60 * 1000;
  const status = `otp:${code}:exp:${exp}`;
  try {
    await supabaseJson(restUrl("password_reset_requests"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ id, account: accountKey, role: "customer_service", status, created_at: new Date().toISOString() }),
    });
  } catch {
    globalThis.__mcjCsResets = globalThis.__mcjCsResets || new Map();
    globalThis.__mcjCsResets.set(accountKey, { id, code, exp });
  }
  return { id, exp };
}
async function findCsResetOtp(accountKey) {
  const rows = await supabaseJson(
    restUrl(
      "password_reset_requests",
      `?account=eq.${encodeURIComponent(accountKey)}&role=eq.customer_service&order=created_at.desc&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  for (const row of rows || []) {
    const m = String(row.status || "").match(/^otp:(\d{6}):exp:(\d+)$/);
    if (m) return { id: row.id, code: m[1], exp: Number(m[2]), row };
    const v = String(row.status || "").match(/^verified:([A-Za-z0-9_-]+):exp:(\d+)$/);
    if (v) return { id: row.id, verifiedToken: v[1], exp: Number(v[2]), row };
  }
  const mem = globalThis.__mcjCsResets?.get(accountKey);
  if (mem) return mem;
  return null;
}
async function markCsResetVerified(accountKey, rowId, token) {
  const exp = Date.now() + 15 * 60 * 1000;
  if (rowId) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(rowId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: `verified:${token}:exp:${exp}` }),
    }).catch(() => null);
  }
  globalThis.__mcjCsResets = globalThis.__mcjCsResets || new Map();
  globalThis.__mcjCsResets.set(accountKey, { id: rowId || token, verifiedToken: token, exp });
  return exp;
}
function csResetAccountKey(profile) {
  return String(profile?.id || profile?.email || "").trim().toLowerCase();
}
async function handleCsSendResetCode(body, res) {
  const account = String(body.account || body.email || body.phone || "").trim().toLowerCase();
  const genericOk = {
    ok: true,
    message: "如该邮箱已绑定客服账号，将收到验证码邮件。请查收后继续。",
    channel: "email",
    expiresInSec: 900,
  };
  if (!account || !/^\S+@\S+\.\S+$/.test(account)) {
    return json(res, 400, { ok: false, message: "请输入绑定邮箱。" });
  }
  const resolved = await resolveCsAccount(account);
  if (!resolved?.profile || resolved.profile.status === "disabled") return json(res, 200, genericOk);
  const profile = resolved.profile;
  const code = randomOtpCode();
  const key = csResetAccountKey(profile);
  await storeCsResetOtp(key, code);
  const email = String(profile.email || account).trim().toLowerCase();
  const staging =
    String(process.env.ALLOW_STAGING_OTP || "") === "1" ||
    String(process.env.MCJ_OTP_DEBUG || "") === "1" ||
    (String(process.env.VERCEL_ENV || "").toLowerCase() !== "production" &&
      (/staging|localhost|127\.0\.0\.1/i.test(String(process.env.MCJ_PUBLIC_BASE || process.env.VERCEL_URL || "")) ||
        String(process.env.VERCEL_ENV || "").toLowerCase() === "preview"));
  let mailOk = false;
  let mailError = "";
  try {
    await sendEmailOtp({ to: email, code, purpose: "forgot", roleLabel: "客服端" });
    mailOk = true;
  } catch (err) {
    mailError = String(err?.message || err || "");
  }
  const out = {
    ok: true,
    message: mailOk
      ? `验证码已发送至 ${maskEmailHint(email)}。`
      : staging
        ? "邮件服务暂不可用，已生成 Staging 调试验证码。"
        : genericOk.message,
    channel: "email",
    phoneMasked: "",
    emailMasked: maskEmailHint(email),
    expiresInSec: 900,
    mail: mailProviderStatus(),
  };
  if (staging) out.devCode = code;
  if (!mailOk && staging && mailError) out.mailWarning = mailError;
  return json(res, 200, out);
}
async function handleCsVerifyResetCode(body, res) {
  const account = String(body.account || body.phone || body.email || "").trim();
  const code = String(body.code || body.otp || "").trim();
  if (!account || !/^\d{4,8}$/.test(code)) {
    return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  }
  const resolved = await resolveCsAccount(account);
  if (!resolved?.profile) return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  const key = csResetAccountKey(resolved.profile);
  const stored = await findCsResetOtp(key);
  if (stored && stored.code && String(stored.code) === code && Number(stored.exp) > Date.now()) {
    const token = "mcj_" + randomOtpCode() + Date.now().toString(36);
    await markCsResetVerified(key, stored.id, token);
    return json(res, 200, { ok: true, message: "验证成功，请设置新密码", resetToken: token });
  }
  return json(res, 400, { ok: false, message: "验证码无效或已过期" });
}
async function handleCsResetPassword(body, res) {
  const newPassword = String(body.newPassword || body.password || "");
  const confirmPassword = String(body.confirmPassword || body.confirm_password || "");
  if (!newPassword || newPassword.length < 8) return json(res, 400, { ok: false, message: "新密码至少 8 位" });
  if (confirmPassword && confirmPassword !== newPassword) {
    return json(res, 400, { ok: false, message: "两次输入的新密码不一致" });
  }
  const resetToken = String(body.resetToken || body.token || "").trim();
  const account = String(body.account || body.phone || body.email || "").trim();
  if (!resetToken.startsWith("mcj_")) return json(res, 400, { ok: false, message: "请先完成验证码校验" });
  const resolved = await resolveCsAccount(account);
  if (!resolved?.profile?.id) return json(res, 400, { ok: false, message: "缺少账号信息" });
  const key = csResetAccountKey(resolved.profile);
  const stored = await findCsResetOtp(key);
  if (!stored || stored.verifiedToken !== resetToken || Number(stored.exp) < Date.now()) {
    return json(res, 400, { ok: false, message: "重置凭证无效或已过期，请重新获取验证码" });
  }
  await supabaseJson(authUrl("admin/users/" + encodeURIComponent(resolved.profile.id)), {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ password: newPassword }),
  });
  if (globalThis.__mcjCsResets) globalThis.__mcjCsResets.delete(key);
  return json(res, 200, { ok: true, message: "密码已重设，请使用新密码登录" });
}
function safeProfile(row) {
  const bossUid = row.boss_uid || "";
  return {
    id: row.id,
    bossUid,
    boss_uid: bossUid,
    uid: bossUid || row.id,
    name: csDisplayName(row),
    email: row.email || "",
    phone: row.phone || "",
    avatar: row.avatar_url || "",
    status: row.status || "",
  };
}
function safeOrder(row, profiles = {}, extras = {}) {
  const boss = profiles[row.boss_id] || {};
  const companion = profiles[row.companion_id] || {};
  const service = profiles[row.customer_service_id] || {};
  const bossInfo = bossForCs(boss);
  const bossUid = bossInfo.bossUid;
  const note = String(row.note || row.cancel_reason || "");
  const needsReassign =
    row.status === "pending" && /无法接单|确认超时|拒单|重新安排/.test(note);
  const flowStatus =
    extras.flowStatus ||
    ({
      awaiting_payment: "draft",
      pending: "pending_grab",
      waiting_boss_confirm: "selecting",
      claimed: "pending_companion_confirm",
      confirmed: "confirmed",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    }[row.status] || row.status || "");
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    bossId: row.boss_id || "",
    bossUid,
    bossName: bossInfo.bossName,
    companionId: row.companion_id || "",
    companionName: String(companion.display_name || companion.nickname || "").trim() || "-",
    serviceId: row.customer_service_id || "",
    serviceName: csDisplayName(service),
    orderType: row.order_type || "custom",
    assignmentType:
      row.assignment_type ||
      (row.companion_id ? "assigned" : "public"),
    game: row.game || "",
    title: row.title || "",
    description: row.description || "",
    hours: money(row.hours),
    unitPrice: money(row.unit_price),
    totalAmount: money(row.total_amount),
    status: row.status || "",
    flowStatus,
    statusText: (() => {
      const gc = Number(extras.grabCount != null ? extras.grabCount : 0) || 0;
      const assignment = String(row.assignment_type || extras.assignmentType || "").toLowerCase();
      const isPublic =
        assignment === "public" ||
        assignment === "open" ||
        assignment === "open_grab" ||
        (!assignment && !row.companion_id);
      const completionPending =
        String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
        String(row.description || "").includes("[[COMPLETION_PENDING]]");
      if (row.status === "awaiting_payment" && extras.paymentReceipt) return "待人工审核";
      if (row.status === "claimed") return "待陪玩确认";
      if (row.status === "in_progress" && completionPending) {
        if (
          /\[\[ORDER_FROZEN\]\]|\[\[ORDER_DISPUTE\]\]|\[\[COMPLETION_AUTO_PAUSED\]\]/i.test(
            String(row.note || "") + String(row.description || "")
          )
        ) {
          return "等待处理订单问题";
        }
        return "已申请完成，等待老板确认";
      }
      if ((row.status === "pending" || row.status === "waiting_boss_confirm") && isPublic && !row.companion_id) {
        return gc > 0 ? `抢单中（${gc}人）` : "抢单中";
      }
      if ((row.status === "pending" || row.status === "waiting_boss_confirm") && gc > 0) {
        return `已有 ${gc} 位陪玩抢单`;
      }
      return ORDER_STATUS_TEXT[row.status] || row.status || "-";
    })(),
    completionPending:
      String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
      String(row.description || "").includes("[[COMPLETION_PENDING]]"),
    note,
    paymentReview: !!extras.paymentReceipt,
    paymentProofUrl: extras.paymentProofUrl || "",
    paymentReceiptId: extras.paymentReceipt?.id || "",
    paymentRejectReason: extras.paymentRejectReason || "",
    paymentReviewedByName: extras.paymentReviewedByName || "",
    paymentReviewedAt: extras.paymentReviewedAt || "",
    paidAt: row.paid_at || extras.paidAt || "",
    cancelReason: row.cancel_reason || "",
    needsReassign,
    reassignHint: needsReassign
      ? /确认超时/.test(note)
        ? "陪玩确认超时，需重新指定陪玩"
        : "陪玩无法接单，可更换陪玩 / 推送抢单 / 联系老板 / 发起退款"
      : "",
    grabCount: Number(extras.grabCount != null ? extras.grabCount : 0) || 0,
    grabs: extras.grabs || [],
    bossIntent: extras.bossIntent || null,
    preferredCompanionId: extras.bossIntent?.companionId || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
    acceptedAt: row.accepted_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
  };
}
function safeMessage(row, profiles = {}) {
  const sender = profiles[row.sender_id] || {};
  let senderName = "";
  if (row.sender_role === "customer_service") {
    senderName = csDisplayName(sender);
  } else if (row.sender_role === "boss") {
    senderName = bossForCs(sender).bossName;
  } else if (row.sender_role === "companion") {
    senderName = String(sender.display_name || "").trim() || "陪玩";
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    senderName,
    messageType: row.message_type || row.type || "text",
    content: row.content || "",
    orderId: row.order_id || "",
    createdAt: row.created_at || "",
    readAt: row.read_at || "",
  };
}
function unreadRolesForConversation(conversation) {
  const isCompanionSupport =
    String(conversation?.conversation_type || "") === "companion_support" ||
    (!conversation?.boss_id && conversation?.companion_id);
  return isCompanionSupport ? ["companion"] : ["boss"];
}
function isAdminProfile(profile) {
  return ADMIN_ROLES.has(String(profile?.role || "")) || isAdminLike(profile);
}
function conversationLockedByOther(conversation, serviceProfileId) {
  return lockOwnedByOther(conversation, serviceProfileId);
}
/** View is allowed for other CS; mutate is not. Kept for legacy callers. */
async function lockMessageForConversation(conversation, serviceProfile) {
  if (!conversation?.customer_service_id || conversation.customer_service_id === serviceProfile.id) return null;
  if (isAdminProfile(serviceProfile)) return null;
  const other = await profileById(conversation.customer_service_id);
  const otherName = String(other?.display_name || "").trim() || "其他客服";
  return CS_LOCK_VIEW_ONLY(otherName);
}
function withConversationLockFields(conv, serviceProfileId) {
  if (!conv || !serviceProfileId) return conv;
  const raw = String(conv.rawStatus || conv.status || "").toLowerCase();
  const statusForLock =
    raw === "closed" || raw === "ended" || conv.status === "已结束"
      ? "closed"
      : raw === "pending_transfer" || conv.status === "待转接"
        ? "pending_transfer"
        : "open";
  const lockedByOther = conversationLockedByOther(
    {
      customer_service_id: conv.currentServiceId || conv.assignedCsId || "",
      status: statusForLock,
      rawStatus: raw,
    },
    serviceProfileId
  );
  const assignedCsId = String(conv.currentServiceId || conv.assignedCsId || "").trim();
  return Object.assign({}, conv, {
    lockedByOther,
    assignedCsId,
    assignedCsName: conv.currentServiceName || conv.assignedCsName || "",
    assignedAt: conv.acceptedAt || conv.assignedAt || "",
    lockStatus: lockStatusOf({
      status: statusForLock,
      customer_service_id: assignedCsId,
      rawStatus: raw,
    }),
    lockBanner: lockedByOther
      ? CS_LOCK_VIEW_ONLY(conv.currentServiceName || conv.assignedCsName || "其他客服")
      : "",
  });
}
async function loadOpenConversationByOrderId(orderId) {
  if (!orderId) return null;
  const rows = await maybeRows(
    "conversations",
    `?order_id=eq.${encodeURIComponent(orderId)}&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
  );
  return rows?.[0] || null;
}
async function assertOrderMutationAllowed(order, serviceProfile, { requireOwner = false } = {}) {
  try {
    return await assertCanMutateOrder({
      order,
      serviceProfile,
      loadOpenConversation: loadOpenConversationByOrderId,
      allowAdmin: true,
      requireOwner,
    });
  } catch (err) {
    err.status = err.status || 403;
    err.message = err.message || CS_LOCK_DENIED;
    throw err;
  }
}
async function logSessionAction(payload) {
  return writeLockLog({ restUrl, supabaseJson, serviceHeaders }, payload);
}
async function countUnreadBossMessages(conversationId, opts = {}) {
  const roles = Array.isArray(opts.roles) && opts.roles.length ? opts.roles : ["boss"];
  let total = 0;
  for (const role of roles) {
    const rows = await maybeRows(
      "messages",
      `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.${encodeURIComponent(role)}&read_at=is.null&select=id&limit=1000`
    );
    total += Array.isArray(rows) ? rows.length : 0;
  }
  return total;
}
async function markConversationBossMessagesRead(conversationId, opts = {}) {
  const readAt = nowIso();
  const bossId = String(opts.bossId || "").trim();
  const roles = Array.isArray(opts.roles) && opts.roles.length ? opts.roles : unreadRolesForConversation(opts.conversation || {});
  for (const role of roles) {
    try {
      await supabaseJson(
        restUrl(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.${encodeURIComponent(role)}&read_at=is.null`
        ),
        { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
      );
    } catch (_) {}
  }
  // Also mark by boss sender_id in case sender_role was stored inconsistently.
  if (isUuid(bossId) && roles.includes("boss")) {
    try {
      await supabaseJson(
        restUrl(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_id=eq.${encodeURIComponent(bossId)}&read_at=is.null`
        ),
        { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
      );
    } catch (_) {}
  }
  // Persist CS reading cursor (column may be missing on older DBs).
  try {
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ last_read_at: readAt, unread_count: 0, updated_at: readAt }),
    });
  } catch (err) {
    const detail = String(err?.message || "");
    if (/unread_count/i.test(detail)) {
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ last_read_at: readAt, updated_at: readAt }),
        });
      } catch (err2) {
        const detail2 = String(err2?.message || "");
        if (!/last_read_at|column|schema cache|PGRST/i.test(detail2)) throw err2;
        try {
          await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ updated_at: readAt }),
          });
        } catch (_) {}
      }
    } else if (!/last_read_at|column|schema cache|PGRST/i.test(detail)) {
      throw err;
    } else {
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ updated_at: readAt }),
        });
      } catch (_) {}
    }
  }
  let remaining = await countUnreadBossMessages(conversationId, { roles });
  // One retry if PostgREST returned success but rows still unread (race / filter).
  if (remaining > 0) {
    for (const role of roles) {
      try {
        await supabaseJson(
          restUrl(
            "messages",
            `?conversation_id=eq.${encodeURIComponent(conversationId)}&sender_role=eq.${encodeURIComponent(role)}&read_at=is.null`
          ),
          { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ read_at: readAt }) }
        );
      } catch (_) {}
    }
    remaining = await countUnreadBossMessages(conversationId, { roles });
  }
  return { readAt, unread: remaining };
}
function isTestNoiseConversation(row, msgs = [], orderNo = "") {
  if (row?.is_test === true || row?.is_test === "true" || row?.meta?.is_test) return true;
  const blob = [
    orderNo,
    row?.last_message,
    row?.title,
    ...(msgs || []).slice(-8).map((m) => m.content || ""),
  ]
    .map((v) => String(v || ""))
    .join("\n");
  if (TEST_NOISE_RE.test(blob)) return true;
  if (GARBLE_RE.test(blob)) return true;
  return false;
}
async function ensureConversation({
  boss_id,
  companion_id = null,
  customer_service_id = null,
  order_id = null,
  consult_type = "",
  forceNew = false,
}) {
  const consultType = order_id
    ? normalizeBossConsultType(consult_type || "current_order", { orderId: order_id })
    : normalizeBossConsultType(consult_type || "other");
  let rows = [];
  if (!forceNew) {
    let query = order_id
      ? `?order_id=eq.${encodeURIComponent(order_id)}&status=not.in.(closed,ended)&limit=1`
      : `?boss_id=eq.${encodeURIComponent(boss_id)}&order_id=is.null&consult_type=eq.${encodeURIComponent(consultType)}&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`;
    rows = await maybeRows("conversations", query);
    if (!rows[0] && !order_id) {
      // Column may be missing — fall back to order-null open thread only (still not all statuses).
      rows = await maybeRows(
        "conversations",
        `?boss_id=eq.${encodeURIComponent(boss_id)}&order_id=is.null&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
      );
    }
  }
  if (rows[0]) {
    try {
      await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(rows[0].id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ updated_at: nowIso() }),
      });
    } catch (_) {}
    return rows[0];
  }
  const base = {
    boss_id,
    companion_id,
    customer_service_id,
    order_id,
    status: customer_service_id ? "open" : "waiting_service",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const rich = {
    ...base,
    conversation_type: order_id ? "order_support" : "general_support",
    consult_type: consultType,
  };
  try {
    const inserted = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(rich),
    });
    return inserted[0] || null;
  } catch (err) {
    if (!/consult_type|conversation_type|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    const legacy = { ...base };
    if (!/conversation_type/i.test(String(err?.message || ""))) {
      legacy.conversation_type = order_id ? "order_support" : "general_support";
    }
    const inserted = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(legacy),
    });
    return inserted[0] || null;
  }
}

/** Release owned open conversations back to the waiting pool (CS off-duty / transfer). */
async function releaseConversationsToPool(serviceProfile, conversationIds = null, reason = "off_duty") {
  const serviceId = serviceProfile?.id;
  if (!serviceId) return { released: 0, ids: [] };
  let rows = [];
  if (Array.isArray(conversationIds) && conversationIds.length) {
    const ids = conversationIds.filter(Boolean);
    for (const id of ids) {
      const found = (await maybeRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (found) rows.push(found);
    }
  } else {
    rows = await maybeRows(
      "conversations",
      `?customer_service_id=eq.${encodeURIComponent(serviceId)}&status=not.in.(closed,ended)&limit=200`
    );
  }
  const releasedIds = [];
  const nick = String(serviceProfile.display_name || "").trim() || "客服";
  const tip =
    reason === "transfer"
      ? TRANSFER_USER_TIP
      : `${TRANSFER_USER_TIP}（原客服 ${nick} 已下班/离线）`;
  for (const row of rows || []) {
    if (!row?.id) continue;
    if (row.customer_service_id && row.customer_service_id !== serviceId && reason !== "admin") continue;
    const patchedAt = nowIso();
    let updated = null;
    try {
      const patchRows = await supabaseJson(
        restUrl(
          "conversations",
          `?id=eq.${encodeURIComponent(row.id)}&customer_service_id=eq.${encodeURIComponent(serviceId)}`
        ),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            customer_service_id: null,
            status: "pending_transfer",
            updated_at: patchedAt,
          }),
        }
      );
      updated = Array.isArray(patchRows) ? patchRows[0] : null;
    } catch (err) {
      // status check may reject pending_transfer on older DBs — fall back to waiting_service
      try {
        const patchRows = await supabaseJson(
          restUrl(
            "conversations",
            `?id=eq.${encodeURIComponent(row.id)}&customer_service_id=eq.${encodeURIComponent(serviceId)}`
          ),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              customer_service_id: null,
              status: "waiting_service",
              updated_at: patchedAt,
            }),
          }
        );
        updated = Array.isArray(patchRows) ? patchRows[0] : null;
      } catch (_) {
        updated = null;
      }
    }
    if (!updated) continue;
    try {
      await (await import("./_service-receptions.js")).endReceptionRecord(row.id, serviceId);
    } catch (_) {}
    await addMessage(updated, serviceId, "customer_service", tip, "system");
    releasedIds.push(row.id);
  }
  return { released: releasedIds.length, ids: releasedIds };
}
async function addMessage(conversation, sender, senderRole, content, messageType = "system", orderId = null) {
  if (!conversation) return null;
  const payload = {
    conversation_id: conversation.id,
    sender_id: sender,
    sender_role: senderRole,
    message_type: messageType,
    content: String(content || ""),
    order_id: orderId || conversation.order_id || null,
    created_at: nowIso(),
  };
  let rows;
  try {
    rows = await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Enum may lag migrations — persist card payload as text so boss still receives it.
    if (
      (messageType === "companion_card" || messageType === "product_card" || messageType === "image") &&
      /enum|invalid input|message_type/i.test(String(err?.message || ""))
    ) {
      rows = await supabaseJson(restUrl("messages"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ ...payload, message_type: "text" }),
      });
    } else {
      throw err;
    }
  }
  await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ updated_at: nowIso() }),
  });
  return rows[0] || null;
}

/** Find boss↔CS conversation for card push (prefer live reception, else order thread). */
async function resolveBossCsConversation(order, serviceProfile) {
  const bossId = order.boss_id;
  if (!bossId) return null;
  const openRows = await maybeRows(
    "conversations",
    `?boss_id=eq.${encodeURIComponent(bossId)}&status=not.in.(closed,ended)&order=updated_at.desc&limit=20`
  );
  const live =
    (openRows || []).find(
      (c) =>
        c.customer_service_id === serviceProfile.id &&
        String(c.conversation_type || "") !== "companion_support" &&
        !(!c.boss_id && c.companion_id)
    ) ||
    (openRows || []).find(
      (c) =>
        String(c.conversation_type || "") !== "companion_support" &&
        !(!c.boss_id && c.companion_id) &&
        (c.order_id === order.id || !c.companion_id)
    );
  if (live) return live;
  return ensureConversation({
    boss_id: bossId,
    companion_id: null,
    customer_service_id: serviceProfile.id,
    order_id: order.id,
  });
}
async function allocateBossUid() {
  const rows = await maybeRows("profiles", "?role=eq.boss&select=boss_uid&boss_uid=not.is.null&order=created_at.desc&limit=500");
  let next = 1;
  for (const row of rows) {
    const n = parseBossCodeNumber(row?.boss_uid);
    if (n) next = Math.max(next, n + 1);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = formatBossCode(next + attempt);
    const existing = await maybeRows("profiles", `?boss_uid=eq.${encodeURIComponent(candidate)}&select=id&limit=1`);
    if (!existing.length) return candidate;
  }
  return formatBossCode(next + (Date.now() % 1000));
}
async function ensureBossUid(profile) {
  if (!profile?.id) return profile;
  if (profile.boss_uid && String(profile.boss_uid).trim()) return profile;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bossUid = await allocateBossUid();
    try {
      const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ boss_uid: bossUid }),
      });
      const saved = Array.isArray(rows) ? rows[0] : { ...profile, boss_uid: bossUid };
      if (saved?.boss_uid) return saved;
    } catch (_) {}
  }
  return profile;
}
async function loadBootstrap(serviceProfile) {
  try {
    const { expireCompanionConfirmTimeouts } = await import("./_order-confirm-timeout.js");
    await expireCompanionConfirmTimeouts({ limit: 50 });
  } catch {
    /* best-effort */
  }
  try {
    const { createOrderCompleteHelpers } = await import("./_order-complete.js");
    const helpers = createOrderCompleteHelpers({
      restUrl,
      supabaseJson,
      serviceHeaders,
      addSystemMessage: async () => {},
    });
    await Promise.race([
      helpers.expireCompletionAutoConfirms({ limit: 20 }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* best-effort */
  }
  const [ordersRaw, conversationsRaw, profilesRaw, companionsRaw, reportsRaw, payrollsRaw, workData] = await Promise.all([
    maybeRows("orders", "?order=created_at.desc&limit=300"),
    maybeRows("conversations", "?order=updated_at.desc&limit=300"),
    maybeRows("profiles", "?limit=1000"),
    maybeRows("companion_profiles", "?limit=1000"),
    maybeRows("customer_service_reports", `?customer_service_id=eq.${encodeURIComponent(serviceProfile.id)}&order=created_at.desc&limit=100`),
    maybeRows("staff_payrolls", `?staff_id=eq.${encodeURIComponent(serviceProfile.id)}&order=created_at.desc&limit=100`),
    import("./_customer-service-work.js").then((m) => m.loadServiceWorkData(serviceProfile.id)).catch(() => null),
  ]);
  const convIds = (conversationsRaw || []).map((c) => c.id).filter(Boolean);
  let messagesRawDesc = [];
  if (convIds.length) {
    const chunkSize = 40;
    for (let i = 0; i < convIds.length; i += chunkSize) {
      const chunk = convIds.slice(i, i + chunkSize);
      const rows = await maybeRows(
        "messages",
        `?conversation_id=in.(${chunk.map(encodeURIComponent).join(",")})&order=created_at.desc&limit=1200`
      );
      messagesRawDesc = messagesRawDesc.concat(rows || []);
    }
  } else {
    messagesRawDesc = await maybeRows("messages", "?order=created_at.desc&limit=1500");
  }
  const messagesRaw = (messagesRawDesc || []).slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const profiles = profilesRaw.reduce((map, row) => { map[row.id] = row; return map; }, {});
  // Backfill missing boss_uid so CS pool always shows 老板 UID.
  const bossIdsNeedingUid = [...new Set((conversationsRaw || []).map((c) => c.boss_id).filter((id) => id && profiles[id] && !profiles[id].boss_uid))];
  for (const id of bossIdsNeedingUid.slice(0, 20)) {
    profiles[id] = await ensureBossUid(profiles[id]);
  }
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const { parseBossIntent, enrichGrabCompanions, toFlowStatus } = await import("./_order-flow.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
  const grabEligible = (ordersRaw || []).slice(0, 80).filter((row) =>
    ["pending", "waiting_boss_confirm", "claimed", "confirmed"].includes(row.status)
  );
  const grabNoteMap = Object.fromEntries(grabEligible.map((row) => [row.id, row.note || row.description || ""]));
  const grabMapRaw = await grabsApi.listGrabsBatch(
    grabEligible.map((row) => row.id),
    grabNoteMap
  );
  const needsEnrich = grabEligible.filter((row) => ["pending", "waiting_boss_confirm"].includes(row.status));
  const enrichFlat = needsEnrich.flatMap((row) => grabMapRaw[row.id] || []);
  const enrichedAll = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, enrichFlat).catch(() => enrichFlat);
  const enrichedByKey = Object.fromEntries(
    (enrichedAll || []).map((g) => [String(g.id || g.grabId || `${g.orderId}:${g.companionId}`), g])
  );
  const grabExtras = (ordersRaw || []).slice(0, 80).map((row) => {
    if (!["pending", "waiting_boss_confirm", "claimed", "confirmed"].includes(row.status)) {
      return { id: row.id, grabCount: 0, grabs: [], bossIntent: parseBossIntent(row) };
    }
    const grabs = grabMapRaw[row.id] || [];
    const intent = parseBossIntent(row);
    let enriched = grabs;
    if (["pending", "waiting_boss_confirm"].includes(row.status) && grabs.length) {
      enriched = grabs.map((g) => {
        const key = String(g.id || g.grabId || `${g.orderId}:${g.companionId}`);
        const eg = enrichedByKey[key] || g;
        return {
          ...eg,
          bossPreferred: !!(intent && intent.companionId === eg.companionId),
          companion: eg.companion
            ? { ...eg.companion, bossPreferred: !!(intent && intent.companionId === eg.companionId) }
            : null,
        };
      });
    }
    return { id: row.id, grabCount: grabs.length, grabs: enriched, bossIntent: intent };
  });
  const grabMap = Object.fromEntries(grabExtras.map((g) => [g.id, g]));
  const pendingReceipts = await listPendingForCs({ orderIds: ordersRaw.map((row) => row.id).filter(Boolean) });
  const receiptByOrder = Object.fromEntries((pendingReceipts || []).map((receipt) => [receipt.order_id, receipt]));
  const signedPairs = await Promise.all(
    (pendingReceipts || []).map(async (receipt) => {
      const url = await signedProofUrl(receipt).catch(() => "");
      return [receipt.order_id, url || ""];
    })
  );
  const signedByOrder = Object.fromEntries(signedPairs);
  const orders = ordersRaw.map((row) => {
    const extra = grabMap[row.id] || {};
    const receipt = receiptByOrder[row.id] || null;
    return safeOrder(row, profiles, {
      grabCount: extra.grabCount || 0,
      grabs: extra.grabs || [],
      bossIntent: extra.bossIntent || null,
      flowStatus: toFlowStatus(row.status),
      paymentReceipt: receipt,
      paymentProofUrl: receipt ? signedByOrder[row.id] || "" : "",
    });
  }); const msgByConv = messagesRaw.reduce((map, msg) => { (map[msg.conversation_id] = map[msg.conversation_id] || []).push(msg); return map; }, {}); const conversationsMapped = conversationsRaw.map((row) => { const boss = profiles[row.boss_id] || {}; const companionProf = profiles[row.companion_id] || {}; const service = profiles[row.customer_service_id] || {}; const msgs = msgByConv[row.id] || []; const last = msgs[msgs.length - 1] || {}; const bossUid = bossForCs(boss).bossUid; const isCompanionSupport = String(row.conversation_type || "") === "companion_support" || (!row.boss_id && row.companion_id); const isClosed = row.status === "closed" || row.status === "ended"; const convStatus = isClosed ? "已结束" : (row.customer_service_id ? "正在接待" : "待接待"); const lastReadAt = row.last_read_at || ""; const unreadRoles = isCompanionSupport ? ["companion"] : ["boss"];   const unreadBoss = isClosed ? [] : msgs.filter((m) => {
    if (!unreadRoles.includes(m.sender_role) || m.read_at) return false;
    if (lastReadAt && String(m.created_at || "") <= String(lastReadAt)) return false;
    return true;
  });
  const companionNameRaw = String(companionProf.display_name || "").trim() || "陪玩";
  const companionName = /@/.test(companionNameRaw) || /^(boss|companion|service)\./i.test(companionNameRaw) ? "陪玩" : companionNameRaw;
  const identity = isCompanionSupport ? "陪玩" : "老板";
  const consultKey = row.consult_type
    || (isCompanionSupport ? (row.order_id ? "order_dock" : "other") : (row.order_id ? "current_order" : "other"));
  const consultLabel = consultTypeLabel(isCompanionSupport ? "companion" : "boss", consultKey);
  const userIdLabel = isCompanionSupport
    ? (companionProf.companion_uid || companionProf.companion_code || row.companion_id || "")
    : (bossUid || row.boss_id || "");
  const nickname = isCompanionSupport ? companionName : bossForCs(boss).bossName;
  const isTransfer = isPendingTransferStatus(row.status);
  const convStatusLabel = isClosed ? "已结束" : isTransfer ? "待转接" : (row.customer_service_id ? "接待中" : "待接待");
  return {
    id: row.id,
    identity,
    nickname,
    userId: userIdLabel,
    bossId: row.boss_id || "",
    bossUid: bossUid || "",
    bossName: isCompanionSupport ? `陪玩 · ${companionName}` : bossForCs(boss).bossName,
    companionId: row.companion_id || "",
    companionCode: isCompanionSupport ? (companionProf.companion_code || companionProf.companion_uid || "") : "",
    conversationType: row.conversation_type || (isCompanionSupport ? "companion_support" : "general_support"),
    consultType: consultKey,
    consultTypeLabel: consultLabel,
    title: row.title || "",
    orderId: row.order_id || "",
    orderNo: (orders.find((o) => o.id === row.order_id) || {}).orderNo || "",
    currentServiceId: isClosed ? (row.customer_service_id || "") : (isTransfer ? "" : (row.customer_service_id || "")),
    currentServiceName: isTransfer ? "待转接" : (row.customer_service_id ? csDisplayName(service) : "待接待"),
    assignedCsId: isClosed ? (row.customer_service_id || "") : (isTransfer ? "" : (row.customer_service_id || "")),
    assignedCsName: isTransfer ? "待转接" : (row.customer_service_id ? csDisplayName(service) : ""),
    assignedAt: row.accepted_at || "",
    lockStatus: isClosed ? "ended" : isTransfer ? "pending_transfer" : (row.customer_service_id ? "assigned" : "waiting"),
    lastActiveAt: row.last_active_at || row.updated_at || "",
    status: convStatusLabel,
    rawStatus: isClosed ? "closed" : (row.status || ""),
    lastMessage: last.content || "",
    lastTime: last.created_at || row.updated_at || "",
    createdAt: row.created_at || "",
    unread: unreadBoss.length,
    unreadCount: unreadBoss.length,
    closedAt: row.closed_at || "",
    closedBy: row.closed_by || "",
    lastReadAt,
    acceptedAt: row.accepted_at || "",
    updatedAt: row.updated_at || "",
  }; }); const conversations = conversationsMapped.filter((c) => {
    if (c.conversationType === "companion_support" || (!c.bossId && c.companionId)) return true;
    return !isTestNoiseConversation({ last_message: c.lastMessage, title: c.bossName }, (messagesRaw || []).filter((m) => m.conversation_id === c.id).map((m) => ({ content: m.content })), c.orderNo);
  }); const bosses = profilesRaw.filter((p) => p.role === "boss" && p.status === "active").map((p) => bossForCs(p)); const companions = companionsRaw.map((cp) => {
    const p = profiles[cp.user_id] || {};
    const appSt = String(cp.application_status || "").toLowerCase();
    const isDraft =
      /^(draft|archived|deleted)$/.test(appSt) ||
      (!cp.application_submitted_at && !/approved|verified|passed/.test(appSt));
    if (isDraft) return null;
    const verified = /approved|verified|passed/.test(String(cp.application_status || cp.verification_status || ""));
    if (!verified) return null;
    const mapped = mapCompanionPublicFields(cp, p);
    const onlineRaw = String(cp.online_status || mapped.availabilityStatus || "offline").toLowerCase();
    const onlineStatus = verified ? onlineRaw : "offline";
    const code = mapped.companionCode || mapped.publicId || "";
    return {
      id: mapped.id || cp.user_id,
      companionUid: mapped.companionUid || cp.companion_uid || "",
      companionCode: code,
      publicId: code,
      name: mapped.name || "陪玩",
      game: cp.game || "",
      level: cp.level_name || "",
      price: money(cp.price),
      avatar: mapped.avatar,
      cover: mapped.cover,
      cardImageUrl: mapped.cardImageUrl || mapped.cover,
      status: p.status || "",
      verificationStatus: mapped.verificationStatus || cp.verification_status || "",
      onlineStatus,
      online: onlineStatus === "online",
      idle: onlineStatus === "online",
    };
  }).filter((p) => p && isUuid(p.id) && (!p.status || p.status === "active" || p.status === "启用")); const today = new Date().toISOString().slice(0, 10); const receptionStats = await (await import("./_service-receptions.js")).loadReceptionStats(serviceProfile.id, conversations); const summary = { waitingConversations: conversations.filter((c) => !c.currentServiceId && c.rawStatus !== "closed").length, currentReceptions: workData?.summary?.currentReceptions || receptionStats.currentReceptions || 0, todayReceptions: workData?.summary?.todayReceptions || receptionStats.todayReceptions || 0, monthReceptions: receptionStats.monthReceptions || 0, awaitingPayment: orders.filter((o) => o.status === "awaiting_payment").length, pendingOrders: orders.filter((o) => o.status === "pending").length, waitingCompanionConfirm: orders.filter((o) => o.status === "claimed").length, needsReassign: orders.filter((o) => o.needsReassign).length, waitingBossConfirm: orders.filter((o) => o.status === "waiting_boss_confirm").length, inProgress: orders.filter((o) => o.status === "in_progress" || o.status === "confirmed").length, refundRequested: orders.filter((o) => o.status === "refund_requested").length, todayHandled: orders.filter((o) => o.serviceId === serviceProfile.id && String(o.createdAt).slice(0, 10) === today).length, todayCompleted: workData?.summary?.todayCompleted || 0, todayPaid: workData?.summary?.todayPaid || 0, todayRefunds: workData?.summary?.todayRefunds || 0, unreadMessages: workData?.summary?.unreadMessages || 0, monthAttendanceDays: workData?.summary?.monthAttendanceDays || 0, monthLateCount: workData?.summary?.monthLateCount || 0, monthAbsenceCount: workData?.summary?.monthAbsenceCount || 0, estimatedSalary: workData?.summary?.estimatedSalary || 0 }; const payrollStatusText = {
    draft: "草稿",
    submitted: "已提交",
    pending_friday: "待周五结算",
    reviewing: "审核中",
    pending: "已提交",
    pending_review: "待周五结算",
    approved: "审核通过待打款",
    pending_payment: "审核通过待打款",
    approved_pending_pay: "审核通过待打款",
    rejected: "已驳回",
    paying: "审核通过待打款",
    paid_pending_receipt: "已打款",
    paid: "已打款",
    completed: "已完成",
    rolled_over: "顺延至下周",
    pay_failed: "付款失败",
    cancelled: "已撤销",
  };
  const payrolls = (payrollsRaw || []).map((row) => {
    const snap = row.payment_account_snapshot || {};
    return {
      id: row.id,
      payrollNo: row.payroll_no,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      baseSalaryRm: money(row.base_salary_rm),
      bonusRm: money(row.bonus_rm),
      deductionRm: money(row.deduction_rm),
      netSalaryRm: money(row.net_salary_rm),
      accountLast4: snap.account_last4 || "",
      status: row.status,
      statusText: payrollStatusText[row.status] || row.status,
      settlementDate: row.settlement_date || "",
      settlementHint: row.settlement_date
        ? `预计发放日期：${String(row.settlement_date).slice(0, 10)}（星期五）`
        : "",
      submittedAt: row.submitted_at || row.created_at || "",
      reviewedAt: row.reviewed_at || row.approved_at || "",
      paidAt: row.paid_at || "",
      transactionNo: row.transaction_no || row.bank_reference || "",
      receiptUrl: row.receipt_url || "",
      rejectReason: row.reject_reason || "",
      note: row.note || "",
    };
  });
  let weeklySettlement = null;
  try {
    const { loadFinanceWeeklySettings, viewWeeklyRules } = await import("./_payout-requests.js");
    const { companionDb } = await import("./_companion-media-store.js");
    const cfg = await loadFinanceWeeklySettings(companionDb);
    weeklySettlement = viewWeeklyRules(cfg);
  } catch {
    weeklySettlement = null;
  }
  const pendingFridayAmount = payrolls
    .filter((p) => /pending_friday|reviewing|submitted|pending_review|rolled_over/.test(String(p.status || "")))
    .reduce((s, p) => s + money(p.netSalaryRm), 0);
  const appliedAmount = payrolls
    .filter((p) => !/rejected|cancelled|pay_failed/.test(String(p.status || "")))
    .reduce((s, p) => s + money(p.netSalaryRm), 0);
  let dockRewards = [];
  let staffNotifications = [];
  try {
    dockRewards = await maybeRows(
      "cs_dock_rewards",
      `?service_id=eq.${encodeURIComponent(serviceProfile.id)}&order=settled_at.desc.nullslast&limit=80`
    );
  } catch {
    dockRewards = [];
  }
  try {
    staffNotifications = await maybeRows(
      "staff_notifications",
      `?staff_id=eq.${encodeURIComponent(serviceProfile.id)}&order=created_at.desc&limit=40`
    );
  } catch {
    staffNotifications = [];
  }
  const settledRewards = (dockRewards || []).filter((r) => r.status === "settled");
  const dockRewardCatFood = settledRewards.reduce((sum, r) => sum + money(r.amount_cat_food), 0);
  summary.dockRewardCatFood = dockRewardCatFood;
  summary.dockRewardCount = settledRewards.length;
  summary.incomeToday = workData?.summary?.incomeToday || 0;
  summary.incomeMonth = workData?.summary?.incomeMonth || 0;
  summary.incomeTotal = workData?.summary?.incomeTotal || 0;
  const activePayrollStatuses = new Set(["draft", "pending_review", "approved_pending_pay", "paying", "paid_pending_receipt", "completed"]);
  const monthPayrollLocked = (payrolls || [])
    .filter((p) => activePayrollStatuses.has(String(p.status || "")) && String(p.periodStart || "").slice(0, 7) === String(today || "").slice(0, 7))
    .reduce((sum, p) => sum + money(p.netSalaryRm), 0);
  const estimated = money(workData?.summary?.estimatedSalary || summary.estimatedSalary || 0);
  summary.withdrawableSalary = Math.max(0, money(estimated - monthPayrollLocked));
  summary.orderFixedReward = money(workData?.config?.orderCommission || workData?.salary?.current?.orderFixedReward || 0);
  const conversationsWithLock = conversations.map((c) => withConversationLockFields(c, serviceProfile.id));
  const commissionSettlements = (workData?.commissionSettlements || []).map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNo: r.orderNo || "",
    rewardType: r.rewardType || "order_commission",
    category: r.category || "",
    categoryLabel: r.categoryLabel || "",
    paidAmount: money(r.paidAmount),
    paymentStatus: r.paymentStatus || "",
    fixedRewardRm: money(r.fixedRewardRm),
    percentCommissionRm: money(r.percentCommissionRm),
    nightShiftRm: money(r.nightShiftRm),
    attendanceBonusRm: money(r.attendanceBonusRm),
    clawbackRm: money(r.clawbackRm),
    finalAmountRm: money(r.finalAmountRm),
    status: r.status,
    settlementStatus: r.settlementStatus || r.status,
    settledAt: r.settledAt || "",
  }));
  return {
    staff: safeProfile(serviceProfile),
    summary,
    conversations: conversationsWithLock,
    messages: messagesRaw.map((row) => safeMessage(row, profiles)),
    orders,
    bosses,
    companions,
    reports: reportsRaw,
    payrolls,
    weeklySettlement,
    payrollSummary: {
      settleableAmount: money((workData?.summary?.estimatedSalary || 0) - pendingFridayAmount),
      appliedAmount,
      pendingFridayAmount,
      nextSettlementDate: weeklySettlement?.nextSettlementDate || "",
    },
    dockRewards: (dockRewards || []).slice(0, 40).map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNo: r.order_no || "",
      amount: money(r.amount_cat_food),
      status: r.status,
      settledAt: r.settled_at || "",
      clawbackAt: r.clawback_at || "",
    })),
    commissionSettlements,
    notifications: (staffNotifications || []).map((n) => ({
      id: n.id,
      key: n.notice_key,
      category: n.category || "payroll",
      title: n.title || "系统通知",
      body: n.body || "",
      href: n.href || "/customer-service/reports/",
      at: n.created_at || "",
    })),
    orderStatuses: ORDER_STATUS_TEXT,
    workData: workData || null,
    compensationPolicy: await (async () => {
      try {
        const settings = await (await import("./_wallet.js")).getWalletSettings();
        return {
          allowCsApply: settings.allow_cs_apply !== false,
          maxPerRequest: money(settings.cs_max_per_request != null ? settings.cs_max_per_request : 100),
          maxPerDay: money(settings.cs_max_per_day != null ? settings.cs_max_per_day : 300),
          allowedOrderStatuses: ["in_progress", "confirmed", "completed"],
        };
      } catch (_) {
        return { allowCsApply: true, allowedOrderStatuses: ["in_progress", "confirmed", "completed"] };
      }
    })(),
  };
}
async function orderById(id) { if (!isUuid(id)) return null; const rows = await tableRows("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`); return rows[0] || null; }
async function patchOrder(id, patch) { if (!isUuid(id)) return null; const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) }); return rows[0] || null; }
async function handler(req, res) { if (!hasDb()) return json(res, req.method === "GET" ? 200 : 503, { ok: req.method === "GET", configured: false, message: "未配置 Supabase，客服端不返回假数据。", data: { staff: {}, summary: { waitingConversations: 0, currentReceptions: 0, todayReceptions: 0, monthReceptions: 0, awaitingPayment: 0, pendingOrders: 0, waitingBossConfirm: 0, inProgress: 0, refundRequested: 0, todayHandled: 0 }, conversations: [], messages: [], orders: [], bosses: [], companions: [], reports: [], orderStatuses: ORDER_STATUS_TEXT } }); try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    if (req.method !== "GET") req.body = body;
    let pathAction = "";
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (/\/customer-service\/accept\/?$/.test(pathname) || /\/accept\/?$/.test(pathname)) pathAction = "accept";
    } catch (_) {}
    let action = String(req.method === "GET" ? (req.query?.action || "bootstrap") : (body.action || req.query?.action || pathAction || "")).trim();
    if (action === "accept") action = "take_conversation";
    if (action === "login") { const email = String(body.account || body.email || "").trim().toLowerCase(); const password = String(body.password || ""); if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" }); let auth; try { auth = await supabaseJson(authUrl("token?grant_type=password"), { method: "POST", headers: anonHeaders(), body: JSON.stringify({ email, password }) }); } catch { return json(res, 401, { ok: false, message: "账号或密码错误。" }); } const profile = await profileById(auth.user?.id); if (!profile || profile.role !== "customer_service") return json(res, 403, { ok: false, message: "无权访问客服端。" }); if (profile.status !== "active") return json(res, 403, { ok: false, message: "该客服账号已被停用，请联系管理员。" }); return json(res, 200, { ok: true, session: { token: auth.access_token, refreshToken: auth.refresh_token || "", expiresAt: auth.expires_at || auth.expires_in || "", user: safeProfile(profile), remember: true } }); }
    // Password recovery (public — before requireService). MVP: email OTP via Resend/SMTP.
    if (action === "forgot_password" || action === "send_reset_code") {
      return handleCsSendResetCode(body, res);
    }
    if (action === "verify_reset_code") {
      return handleCsVerifyResetCode(body, res);
    }
    if (action === "reset_password") {
      return handleCsResetPassword(body, res);
    }
    const service = await requireService(req); if (req.method === "GET") return json(res, 200, { ok: true, configured: true, data: await loadBootstrap(service.profile) });
    if (action === "bootstrap" || !action) return json(res, 200, { ok: true, configured: true, data: await loadBootstrap(service.profile) });
    if (action === "take_conversation") {
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        return json(res, 400, { ok: false, message: "会话已结束，无法接待。" });
      }
      if (existing.customer_service_id && existing.customer_service_id !== service.profile.id && !isPendingTransferStatus(existing.status)) {
        const other = await profileById(existing.customer_service_id);
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 409, { ok: false, message: `该会话已由客服 ${otherName} 接待。` });
      }
      if (existing.customer_service_id === service.profile.id && !isPendingTransferStatus(existing.status)) {
        await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
        return json(res, 200, {
          ok: true,
          message: "你已在接待该会话。",
          conversation: {
            ...existing,
            status: existing.status === "serving" ? "active" : (existing.status || "active"),
            customer_service_id: service.profile.id,
          },
        });
      }
      const nick = String(service.profile.display_name || "").trim() || "客服";
      const acceptedAt = nowIso();
      // If stuck in pending_transfer with a stale owner id, clear before CAS claim.
      if (isPendingTransferStatus(existing.status) && existing.customer_service_id) {
        try {
          await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ customer_service_id: null, status: "pending_transfer", updated_at: acceptedAt }),
          });
        } catch (_) {}
      }
      // pending_transfer / waiting: claim by null owner (release clears owner before pool).
      const claimFilter = `?id=eq.${encodeURIComponent(id)}&customer_service_id=is.null`;
      async function claimWith(patch) {
        const rows = await supabaseJson(restUrl("conversations", claimFilter), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(patch),
        });
        return Array.isArray(rows) ? rows[0] : null;
      }
      let conversation = null;
      try {
        conversation = await claimWith({
          customer_service_id: service.profile.id,
          status: "active",
          accepted_at: acceptedAt,
          updated_at: acceptedAt,
        });
      } catch (err) {
        const detail = String(err?.message || "");
        if (!/accepted_at|column|schema cache|PGRST/i.test(detail)) throw err;
        try {
          conversation = await claimWith({
            customer_service_id: service.profile.id,
            status: "active",
            updated_at: acceptedAt,
          });
        } catch (err2) {
          const detail2 = String(err2?.message || "");
          if (!/status|check|invalid/i.test(detail2)) throw err2;
          conversation = await claimWith({
            customer_service_id: service.profile.id,
            status: "serving",
            updated_at: acceptedAt,
          });
        }
      }
      if (!conversation) {
        try {
          conversation = await claimWith({
            customer_service_id: service.profile.id,
            status: "serving",
            updated_at: acceptedAt,
          });
        } catch (_) {}
      }
      if (!conversation) {
        const again = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
        if (again?.customer_service_id === service.profile.id) {
          await markConversationBossMessagesRead(id, { bossId: again.boss_id, conversation: again });
          return json(res, 200, { ok: true, message: "你已在接待该会话。", conversation: again });
        }
        const other = again?.customer_service_id ? await profileById(again.customer_service_id) : null;
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 409, { ok: false, message: `该会话已由客服 ${otherName} 接待。` });
      }
      // 有关联订单时绑定当前客服 ID（订单业务状态枚举不含 serving，不改 orders.status）。
      if (conversation.order_id) {
        try {
          await patchOrder(conversation.order_id, { customer_service_id: service.profile.id });
        } catch (_) {}
      }
      try {
        await (await import("./_service-receptions.js")).startReceptionRecord(conversation, service.profile.id);
      } catch (_) {}
      // sender_role 必须是 enum 合法值；系统提示用 message_type=system。
      await addMessage(conversation, service.profile.id, "customer_service", `客服 ${nick} 已接待您。`, "system");
      await markConversationBossMessagesRead(id, { bossId: conversation.boss_id || existing.boss_id, conversation: conversation || existing });
      await logSessionAction({
        conversationId: id,
        orderId: conversation.order_id || existing.order_id || null,
        action: "claim",
        fromCsId: null,
        toCsId: service.profile.id,
        operatorId: service.profile.id,
        operatorRole: "customer_service",
        detail: `开始接待 ${nick}`,
      });
      await touchConversationActive({ restUrl, supabaseJson, serviceHeaders }, id);
      return json(res, 200, {
        ok: true,
        message: "已接待该会话。",
        conversation: {
          ...conversation,
          status: conversation.status === "serving" ? "active" : (conversation.status || "active"),
          customer_service_id: service.profile.id,
          accepted_at: conversation.accepted_at || acceptedAt,
          assignedCsId: service.profile.id,
          assignedCsName: nick,
          assignedAt: conversation.accepted_at || acceptedAt,
          lockStatus: "assigned",
        },
      });
    }
    if (action === "force_take_conversation" || action === "admin_takeover") {
      if (!isAdminProfile(service.profile)) {
        return json(res, 403, { ok: false, message: "仅管理员可强制接管会话。" });
      }
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        return json(res, 400, { ok: false, message: "会话已结束，无法接管。" });
      }
      const targetId = String(body.target_cs_id || body.targetCsId || body.to_cs_id || service.profile.id).trim();
      const targetProfile = targetId === service.profile.id ? service.profile : await profileById(targetId);
      if (!targetProfile || (targetProfile.role !== "customer_service" && !isAdminProfile(targetProfile))) {
        return json(res, 400, { ok: false, message: "目标客服不存在或不可用。" });
      }
      if (String(targetProfile.status || "active") !== "active" && !isAdminProfile(targetProfile)) {
        return json(res, 400, { ok: false, message: "目标客服账号已停用。" });
      }
      const acceptedAt = nowIso();
      const adminNick = String(service.profile.display_name || "").trim() || "管理员";
      const nextNick = String(targetProfile.display_name || "").trim() || "客服";
      const prevOwner =
        existing.customer_service_id && existing.customer_service_id !== targetProfile.id
          ? await profileById(existing.customer_service_id)
          : null;
      const prevName = String(prevOwner?.display_name || "").trim() || "客服";
      let conversation = null;
      const forcePatch = {
        customer_service_id: targetProfile.id,
        status: "active",
        accepted_at: acceptedAt,
        updated_at: acceptedAt,
        last_active_at: acceptedAt,
      };
      try {
        const rows = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(forcePatch),
        });
        conversation = Array.isArray(rows) ? rows[0] : null;
      } catch (err) {
        const detail = String(err?.message || "");
        if (/accepted_at|last_active_at|column|schema/i.test(detail)) {
          const rows = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              customer_service_id: targetProfile.id,
              status: "active",
              updated_at: acceptedAt,
            }),
          });
          conversation = Array.isArray(rows) ? rows[0] : null;
        } else if (/status|check|invalid/i.test(detail)) {
          const rows = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              customer_service_id: targetProfile.id,
              status: "serving",
              updated_at: acceptedAt,
            }),
          });
          conversation = Array.isArray(rows) ? rows[0] : null;
        } else {
          throw err;
        }
      }
      if (!conversation) {
        conversation = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0] || existing;
      }
      if (conversation.order_id) {
        try {
          await patchOrder(conversation.order_id, { customer_service_id: targetProfile.id });
        } catch (_) {}
      }
      if (prevOwner?.id) {
        try {
          await (await import("./_service-receptions.js")).endReceptionRecord(id, prevOwner.id);
        } catch (_) {}
        await addMessage(
          conversation,
          service.profile.id,
          "customer_service",
          `管理员已将该订单从【${prevName}】转交给【${nextNick}】。`,
          "system"
        );
      } else if (!existing.customer_service_id) {
        await addMessage(conversation, service.profile.id, "customer_service", `客服 ${nextNick} 已接待您。`, "system");
      }
      try {
        await (await import("./_service-receptions.js")).startReceptionRecord(conversation, targetProfile.id);
      } catch (_) {}
      await logSessionAction({
        conversationId: id,
        orderId: conversation.order_id || existing.order_id || null,
        action: "admin_takeover",
        fromCsId: prevOwner?.id || null,
        toCsId: targetProfile.id,
        operatorId: service.profile.id,
        operatorRole: String(service.profile.role || "admin"),
        detail: `管理员 ${adminNick} 接管 → ${nextNick}`,
      });
      return json(res, 200, {
        ok: true,
        message: "已强制接管该会话。",
        conversation: {
          ...conversation,
          status: conversation.status === "serving" ? "active" : (conversation.status || "active"),
          customer_service_id: targetProfile.id,
          accepted_at: conversation.accepted_at || acceptedAt,
          assignedCsId: targetProfile.id,
          assignedCsName: nextNick,
          assignedAt: conversation.accepted_at || acceptedAt,
          lockStatus: "assigned",
        },
      });
    }
    if (action === "start_consult" || action === "create_conversation" || action === "new_conversation") {
      const targetRole = String(body.targetRole || body.target_role || body.role || "boss").trim().toLowerCase();
      const forceNew =
        body.forceNew === true ||
        body.force_new === true ||
        String(body.forceNew || body.force_new || "").trim() === "1";
      const orderIdRaw = String(body.orderId || body.order_id || "").trim();
      const consultRaw = String(body.consult_type || body.consultType || "").trim();

      if (targetRole === "companion" || targetRole === "player") {
        const companionInput = String(body.companionId || body.companion_id || body.targetId || body.target_id || "").trim();
        const companion = await resolveCompanion(companionInput);
        if (!companion || !isUuid(companion.id)) {
          return json(res, 400, { ok: false, message: "请选择有效陪玩（编号 PW00001 / 昵称）。" });
        }
        let order = null;
        let orderId = "";
        if (orderIdRaw) {
          order = (await orderById(orderIdRaw)) || null;
          if (!order && orderIdRaw) {
            const byNo = (
              await maybeRows("orders", `?order_no=eq.${encodeURIComponent(orderIdRaw)}&limit=1`)
            )[0];
            order = byNo || null;
          }
          if (!order) return json(res, 404, { ok: false, message: "关联订单不存在。" });
          orderId = order.id;
        }
        const consultType = normalizeCompanionConsultType(consultRaw || (orderId ? "order_dock" : "general"), {
          orderId,
        });
        const companionName = String(companion.display_name || "").trim() || "陪玩";
        const companionCode =
          resolveCompanionPublicCode(companion) ||
          companion.companion_code ||
          companion.companion_uid ||
          "";
        let existing = null;
        if (!forceNew && orderId) {
          existing = (
            await maybeRows(
              "conversations",
              `?companion_id=eq.${encodeURIComponent(companion.id)}&order_id=eq.${encodeURIComponent(orderId)}&conversation_type=eq.companion_support&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
            )
          )[0];
        } else if (!forceNew && !orderId) {
          existing = (
            await maybeRows(
              "conversations",
              `?companion_id=eq.${encodeURIComponent(companion.id)}&order_id=is.null&conversation_type=eq.companion_support&consult_type=eq.${encodeURIComponent(consultType)}&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
            )
          )[0];
        }
        let conversation = existing;
        if (!conversation) {
          const payload = {
            boss_id: null,
            companion_id: companion.id,
            customer_service_id: service.profile.id,
            order_id: orderId || null,
            status: "open",
            conversation_type: "companion_support",
            consult_type: consultType,
            title: order
              ? `陪玩 · ${companionName} · ${order.order_no || orderId}`
              : `陪玩 · ${companionName} · 普通咨询`,
            created_at: nowIso(),
            updated_at: nowIso(),
            accepted_at: nowIso(),
          };
          try {
            const inserted = await supabaseJson(restUrl("conversations"), {
              method: "POST",
              headers: serviceHeaders(),
              body: JSON.stringify(payload),
            });
            conversation = inserted?.[0] || null;
          } catch (err) {
            const legacy = { ...payload };
            delete legacy.consult_type;
            delete legacy.title;
            delete legacy.accepted_at;
            if (/boss_id/i.test(String(err?.message || ""))) delete legacy.boss_id;
            const inserted = await supabaseJson(restUrl("conversations"), {
              method: "POST",
              headers: serviceHeaders(),
              body: JSON.stringify(legacy),
            });
            conversation = inserted?.[0] || null;
          }
        } else if (!existing.customer_service_id) {
          try {
            await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(existing.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                customer_service_id: service.profile.id,
                status: "open",
                updated_at: nowIso(),
              }),
            });
            conversation = { ...existing, customer_service_id: service.profile.id, status: "open" };
          } catch (_) {}
        }
        if (!conversation?.id) return json(res, 500, { ok: false, message: "无法创建陪玩会话。" });
        return json(res, 200, {
          ok: true,
          message: orderId ? "已打开陪玩订单会话" : "已创建陪玩普通咨询",
          conversationId: conversation.id,
          conversation: {
            id: conversation.id,
            identity: "陪玩",
            nickname: companionName,
            bossName: `陪玩 · ${companionName}`,
            companionId: companion.id,
            companionCode,
            conversationType: "companion_support",
            consultType,
            consultTypeLabel: consultTypeLabel("companion", consultType),
            orderId: orderId || "",
            orderNo: order?.order_no || "",
            currentServiceId: conversation.customer_service_id || service.profile.id,
            currentServiceName: csDisplayName(service.profile) || "客服",
            status: "接待中",
            rawStatus: conversation.status || "open",
            lockedByOther: false,
          },
        });
      }

      // Boss general / order consult
      const bossInput = String(body.bossId || body.boss_id || body.targetId || body.target_id || "").trim();
      let boss = null;
      if (isUuid(bossInput)) boss = await profileById(bossInput);
      if (!boss) {
        const codeNum = parseBossCodeNumber(bossInput);
        if (codeNum) {
          boss = (
            await maybeRows(
              "profiles",
              `?or=(boss_uid.eq.${encodeURIComponent(formatBossCode(codeNum))},boss_uid.eq.${encodeURIComponent(String(codeNum))})&role=eq.boss&limit=1`
            )
          )[0];
        }
      }
      if (!boss) {
        const q = bossInput.replace(/[%_]/g, "");
        if (q) {
          boss = (
            await maybeRows(
              "profiles",
              `?role=eq.boss&or=(display_name.ilike.*${encodeURIComponent(q)}*,boss_uid.ilike.*${encodeURIComponent(q)}*)&limit=1`
            )
          )[0];
        }
      }
      if (!boss || !isUuid(boss.id)) {
        return json(res, 400, { ok: false, message: "请选择有效老板（编号 MCJ00001 / 昵称）。" });
      }
      let order = null;
      let orderId = "";
      if (orderIdRaw) {
        order = (await orderById(orderIdRaw)) || null;
        if (!order) {
          order = (
            await maybeRows("orders", `?order_no=eq.${encodeURIComponent(orderIdRaw)}&limit=1`)
          )[0];
        }
        if (!order) return json(res, 404, { ok: false, message: "关联订单不存在。" });
        orderId = order.id;
      }
      const consultType = normalizeBossConsultType(consultRaw || (orderId ? "current_order" : "other"), {
        orderId,
      });
      const conversation = await ensureConversation({
        boss_id: boss.id,
        companion_id: order?.companion_id || null,
        customer_service_id: service.profile.id,
        order_id: orderId || null,
        consult_type: consultType,
        forceNew: forceNew || (!orderId && (consultRaw === "other" || !consultRaw)),
      });
      if (!conversation?.id) return json(res, 500, { ok: false, message: "无法创建老板会话。" });
      const bossCode = formatBossCode(parseBossCodeNumber(boss.boss_uid) || boss.boss_uid) || boss.boss_uid || "";
      const bossName = String(boss.display_name || "").trim() || (bossCode ? `老板 ${bossCode}` : "老板");
      return json(res, 200, {
        ok: true,
        message: orderId ? "已打开老板订单会话" : "已创建老板普通咨询",
        conversationId: conversation.id,
        conversation: {
          id: conversation.id,
          identity: "老板",
          nickname: bossName,
          bossId: boss.id,
          bossUid: bossCode,
          bossName,
          companionId: conversation.companion_id || "",
          conversationType: orderId ? "order_support" : "general_support",
          consultType,
          consultTypeLabel: consultTypeLabel("boss", consultType),
          orderId: orderId || "",
          orderNo: order?.order_no || "",
          currentServiceId: conversation.customer_service_id || service.profile.id,
          currentServiceName: csDisplayName(service.profile) || "客服",
          status: "接待中",
          rawStatus: conversation.status || "open",
          lockedByOther: false,
        },
      });
    }

    if (action === "start_companion_chat") {
      const companionInput = String(body.companionId || body.companion_id || "").trim();
      const orderId = String(body.orderId || body.order_id || "").trim();
      const companion = await resolveCompanion(companionInput);
      if (!companion || !isUuid(companion.id)) {
        return json(res, 400, { ok: false, message: "请填写有效的陪玩编号 / 昵称。" });
      }
      // Allow general companion consult without order (CS 「新建对话」).
      if (!orderId) {
        body.targetRole = "companion";
        body.companionId = companion.id;
        body.consultType = body.consult_type || body.consultType || "general";
        body.forceNew = body.forceNew !== false;
        // Re-enter via start_consult path by recursive call pattern: fall through by rewriting.
        const consultType = normalizeCompanionConsultType(body.consultType || "general", { orderId: "" });
        const companionName = String(companion.display_name || "").trim() || "陪玩";
        const companionCode =
          resolveCompanionPublicCode(companion) || companion.companion_code || companion.companion_uid || "";
        const payload = {
          boss_id: null,
          companion_id: companion.id,
          customer_service_id: service.profile.id,
          order_id: null,
          status: "open",
          conversation_type: "companion_support",
          consult_type: consultType,
          title: `陪玩 · ${companionName} · 普通咨询`,
          created_at: nowIso(),
          updated_at: nowIso(),
          accepted_at: nowIso(),
        };
        let conversation = null;
        try {
          const inserted = await supabaseJson(restUrl("conversations"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify(payload),
          });
          conversation = inserted?.[0] || null;
        } catch (err) {
          const legacy = { ...payload };
          delete legacy.consult_type;
          delete legacy.title;
          delete legacy.accepted_at;
          const inserted = await supabaseJson(restUrl("conversations"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify(legacy),
          });
          conversation = inserted?.[0] || null;
        }
        if (!conversation?.id) return json(res, 500, { ok: false, message: "无法创建陪玩普通咨询。" });
        return json(res, 200, {
          ok: true,
          message: "已创建陪玩普通咨询",
          conversationId: conversation.id,
          conversation: {
            id: conversation.id,
            identity: "陪玩",
            nickname: companionName,
            bossName: `陪玩 · ${companionName}`,
            companionId: companion.id,
            companionCode,
            conversationType: "companion_support",
            consultType,
            consultTypeLabel: consultTypeLabel("companion", consultType),
            orderId: "",
            orderNo: "",
            currentServiceId: service.profile.id,
            currentServiceName: csDisplayName(service.profile) || "客服",
            status: "接待中",
            rawStatus: "open",
            lockedByOther: false,
          },
        });
      }
      if (!isUuid(orderId)) {
        return json(res, 400, { ok: false, message: "订单咨询请选择有效订单。" });
      }
      const order = await orderById(orderId);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const consultType = normalizeCompanionConsultType(body.consult_type || body.consultType || "order_dock", {
        orderId,
      });
      const companionName = String(companion.display_name || "").trim() || "陪玩";
      const companionCode =
        resolveCompanionPublicCode(companion) ||
        companion.companion_code ||
        companion.companion_uid ||
        companion.id;
      const orderNo = order.order_no || order.id;
      const title = companionProactiveTitle({
        nickname: companionName,
        companionCode,
        companionId: companion.id,
        orderNo,
        orderId,
      });

      // Scope lock to companion + order_id + consult_type (never whole companion account).
      let existing = (await maybeRows(
        "conversations",
        `?companion_id=eq.${encodeURIComponent(companion.id)}&order_id=eq.${encodeURIComponent(orderId)}&conversation_type=eq.companion_support&consult_type=eq.${encodeURIComponent(consultType)}&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
      ))[0];
      if (!existing) {
        // Fallback if consult_type column missing / older rows without consult_type.
        existing = (await maybeRows(
          "conversations",
          `?companion_id=eq.${encodeURIComponent(companion.id)}&order_id=eq.${encodeURIComponent(orderId)}&conversation_type=eq.companion_support&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
        ))[0];
        if (existing?.consult_type && existing.consult_type !== consultType) existing = null;
      }
      if (existing?.customer_service_id && existing.customer_service_id !== service.profile.id && !isAdminProfile(service.profile) && !isPendingTransferStatus(existing.status)) {
        const other = await profileById(existing.customer_service_id);
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 200, {
          ok: true,
          message: `已定位该订单陪玩会话（当前由 ${otherName} 接待）`,
          conversationId: existing.id,
          conversation: {
            id: existing.id,
            identity: "陪玩",
            nickname: companionName,
            userId: companionCode,
            bossId: "",
            bossUid: "",
            bossName: `陪玩 · ${companionName}`,
            companionId: companion.id,
            companionCode,
            conversationType: "companion_support",
            consultType,
            consultTypeLabel: consultTypeLabel("companion", consultType),
            title: existing.title || title,
            orderId,
            orderNo,
            currentServiceId: existing.customer_service_id,
            currentServiceName: otherName,
            status: "接待中",
            rawStatus: existing.status || "active",
            lockedByOther: true,
            lastMessage: existing.last_message || "",
            lastTime: existing.updated_at || "",
            createdAt: existing.created_at || "",
            unread: 0,
            unreadCount: 0,
          },
        });
      }
      const acceptedAt = nowIso();
      const nick = companionName;
      let conversation = existing;
      if (!conversation) {
        const payload = {
          boss_id: null,
          companion_id: companion.id,
          customer_service_id: service.profile.id,
          order_id: orderId,
          conversation_type: "companion_support",
          consult_type: consultType,
          title,
          status: "active",
          accepted_at: acceptedAt,
          created_at: acceptedAt,
          updated_at: acceptedAt,
        };
        try {
          const rows = await supabaseJson(restUrl("conversations"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify(payload),
          });
          conversation = rows?.[0] || null;
        } catch (err) {
          if (!/consult_type|title|conversation_type|column|schema/i.test(String(err?.message || ""))) throw err;
          const legacy = {
            boss_id: null,
            companion_id: companion.id,
            customer_service_id: service.profile.id,
            order_id: orderId,
            status: "active",
            created_at: acceptedAt,
            updated_at: acceptedAt,
          };
          if (!/conversation_type/i.test(String(err?.message || ""))) legacy.conversation_type = "companion_support";
          if (!/consult_type/i.test(String(err?.message || ""))) legacy.consult_type = consultType;
          if (!/title/i.test(String(err?.message || ""))) legacy.title = title;
          const rows = await supabaseJson(restUrl("conversations"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify(legacy),
          });
          conversation = rows?.[0] || null;
        }
        if (conversation?.id) {
          await addMessage(
            conversation,
            service.profile.id,
            "customer_service",
            `客服已主动联系陪玩（${title}）。范围仅限本订单对接。`,
            "system"
          );
        }
      } else if (!conversation.customer_service_id || conversation.customer_service_id === service.profile.id || isPendingTransferStatus(conversation.status)) {
        const claimFilter =
          conversation.customer_service_id && !isPendingTransferStatus(conversation.status)
            ? `?id=eq.${encodeURIComponent(conversation.id)}`
            : `?id=eq.${encodeURIComponent(conversation.id)}&customer_service_id=is.null`;
        try {
          const rows = await supabaseJson(restUrl("conversations", claimFilter), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              customer_service_id: service.profile.id,
              status: "active",
              accepted_at: acceptedAt,
              updated_at: acceptedAt,
              title: conversation.title || title,
              consult_type: conversation.consult_type || consultType,
            }),
          });
          conversation = Array.isArray(rows) ? rows[0] : conversation;
        } catch (err) {
          const detail = String(err?.message || "");
          if (/accepted_at|title|consult_type|column|schema/i.test(detail)) {
            const rows = await supabaseJson(restUrl("conversations", claimFilter), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                customer_service_id: service.profile.id,
                status: "active",
                updated_at: acceptedAt,
              }),
            });
            conversation = Array.isArray(rows) ? rows[0] : conversation;
          } else if (/status|check|invalid/i.test(detail)) {
            const rows = await supabaseJson(restUrl("conversations", claimFilter), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                customer_service_id: service.profile.id,
                status: "serving",
                updated_at: acceptedAt,
              }),
            });
            conversation = Array.isArray(rows) ? rows[0] : conversation;
          } else {
            throw err;
          }
        }
        if (!existing.customer_service_id || isPendingTransferStatus(existing.status)) {
          await addMessage(conversation, service.profile.id, "customer_service", `客服 ${String(service.profile.display_name || "").trim() || "客服"} 已接待陪玩 ${nick}（订单 ${orderNo}）。`, "system");
        }
      }
      if (!conversation?.id) return json(res, 500, { ok: false, message: "无法创建陪玩会话。" });
      const mapped = withConversationLockFields(
        {
          id: conversation.id,
          identity: "陪玩",
          nickname: companionName,
          userId: companionCode,
          bossId: "",
          bossUid: "",
          bossName: `陪玩 · ${companionName}`,
          companionId: companion.id,
          companionCode,
          conversationType: "companion_support",
          consultType: conversation.consult_type || consultType,
          consultTypeLabel: consultTypeLabel("companion", conversation.consult_type || consultType),
          title: conversation.title || title,
          orderId,
          orderNo,
          currentServiceId: service.profile.id,
          currentServiceName: String(service.profile.display_name || "").trim() || "客服",
          status: "接待中",
          rawStatus: conversation.status || "active",
          lastMessage: "",
          lastTime: conversation.updated_at || acceptedAt,
          createdAt: conversation.created_at || acceptedAt,
          unread: 0,
          unreadCount: 0,
          updatedAt: conversation.updated_at || acceptedAt,
        },
        service.profile.id
      );
      return json(res, 200, {
        ok: true,
        message: "已打开陪玩订单会话。",
        conversationId: conversation.id,
        conversation: mapped,
      });
    }
    if (action === "release_conversation" || action === "transfer_to_pool") {
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        return json(res, 400, { ok: false, message: "会话已结束，无法转接。" });
      }
      if (existing.customer_service_id && existing.customer_service_id !== service.profile.id && !isAdminProfile(service.profile)) {
        return json(res, 403, { ok: false, message: CS_LOCK_DENIED });
      }
      // Prefer targeted transfer when target provided.
      if (body.target_cs_id || body.targetCsId || body.to_cs_id) {
        action = "transfer_to_cs";
      } else {
        // Pool release is only allowed for admin (ops). Regular CS must pick a target CS.
        if (!isAdminProfile(service.profile)) {
          return json(res, 400, {
            ok: false,
            message: "转交必须选择目标客服。不允许解除锁定后让所有客服同时回复。",
            code: "TRANSFER_TARGET_REQUIRED",
          });
        }
        const result = await releaseConversationsToPool(service.profile, [id], "admin");
        if (!result.released && existing.customer_service_id) {
          const owner = await profileById(existing.customer_service_id);
          const alt = await releaseConversationsToPool(
            owner || { id: existing.customer_service_id, display_name: "客服" },
            [id],
            "admin"
          );
          if (!alt.released) return json(res, 500, { ok: false, message: "转接失败，请重试。" });
        }
        await logSessionAction({
          conversationId: id,
          orderId: existing.order_id || null,
          action: "transfer_pool",
          fromCsId: existing.customer_service_id || null,
          toCsId: null,
          operatorId: service.profile.id,
          operatorRole: String(service.profile.role || "admin"),
          detail: "管理员转回公共池",
        });
        const again = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0] || existing;
        return json(res, 200, {
          ok: true,
          message: "会话已转回公共池，其他在线客服可接待。",
          conversation: again,
          userTip: TRANSFER_USER_TIP,
        });
      }
    }
    if (action === "transfer_to_cs" || action === "transfer_conversation" || (action === "release_conversation" && (body.target_cs_id || body.targetCsId || body.to_cs_id))) {
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      const targetId = String(body.target_cs_id || body.targetCsId || body.to_cs_id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      if (!targetId) return json(res, 400, { ok: false, message: "请选择目标客服。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        return json(res, 400, { ok: false, message: "会话已结束，无法转交。" });
      }
      const isOwner = existing.customer_service_id === service.profile.id;
      if (!isOwner && !isAdminProfile(service.profile)) {
        return json(res, 403, { ok: false, message: CS_LOCK_DENIED });
      }
      if (!existing.customer_service_id) {
        return json(res, 400, { ok: false, message: "该会话尚无负责客服，请先接待。" });
      }
      if (targetId === existing.customer_service_id) {
        return json(res, 200, { ok: true, message: "目标客服已是当前负责人。", conversation: existing, deduped: true });
      }
      const target = await profileById(targetId);
      if (!target || target.role !== "customer_service") {
        return json(res, 400, { ok: false, message: "目标客服不存在。" });
      }
      if (String(target.status || "active") !== "active") {
        return json(res, 400, { ok: false, message: "目标客服账号已停用。" });
      }
      const fromProfile = await profileById(existing.customer_service_id);
      const fromName = String(fromProfile?.display_name || "").trim() || "客服";
      const toName = String(target.display_name || "").trim() || "客服";
      const now = nowIso();
      let conversation = null;
      try {
        const rows = await supabaseJson(
          restUrl(
            "conversations",
            `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(existing.customer_service_id)}`
          ),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              customer_service_id: target.id,
              status: "active",
              accepted_at: now,
              updated_at: now,
              last_active_at: now,
            }),
          }
        );
        conversation = Array.isArray(rows) ? rows[0] : null;
      } catch (err) {
        if (/accepted_at|last_active_at|column|schema|status|check/i.test(String(err?.message || ""))) {
          const rows = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              customer_service_id: target.id,
              status: "serving",
              updated_at: now,
            }),
          });
          conversation = Array.isArray(rows) ? rows[0] : null;
        } else {
          throw err;
        }
      }
      if (!conversation) {
        return json(res, 409, { ok: false, message: "转交失败，会话归属可能已变更，请刷新后重试。" });
      }
      if (conversation.order_id) {
        try {
          await patchOrder(conversation.order_id, { customer_service_id: target.id });
        } catch (_) {}
      }
      try {
        await (await import("./_service-receptions.js")).endReceptionRecord(id, existing.customer_service_id);
      } catch (_) {}
      try {
        await (await import("./_service-receptions.js")).startReceptionRecord(conversation, target.id);
      } catch (_) {}
      const sys =
        isAdminProfile(service.profile) && !isOwner
          ? `管理员已将该订单从【${fromName}】转交给【${toName}】。`
          : `该订单已由【${fromName}】转交给【${toName}】。`;
      await addMessage(conversation, service.profile.id, "customer_service", sys, "system");
      await logSessionAction({
        conversationId: id,
        orderId: conversation.order_id || existing.order_id || null,
        action: isAdminProfile(service.profile) && !isOwner ? "admin_transfer" : "transfer",
        fromCsId: existing.customer_service_id,
        toCsId: target.id,
        operatorId: service.profile.id,
        operatorRole: String(service.profile.role || "customer_service"),
        detail: sys,
      });
      return json(res, 200, {
        ok: true,
        message: "转交成功。",
        conversation: {
          ...conversation,
          assignedCsId: target.id,
          assignedCsName: toName,
          assignedAt: now,
          lockStatus: "assigned",
          currentServiceId: target.id,
          currentServiceName: toName,
        },
      });
    }
    if (action === "end_conversation") {
      const id = String(body.id || body.conversation_id || "").trim();
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (existing.status === "closed" || existing.status === "ended") {
        await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
        return json(res, 200, { ok: true, message: "会话已结束。", conversation: existing });
      }
      if (!existing.customer_service_id) {
        return json(res, 400, { ok: false, message: "该会话当前无人接待。" });
      }
      if (existing.customer_service_id !== service.profile.id) {
        const other = await profileById(existing.customer_service_id);
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 403, { ok: false, message: `只有接待中的客服可结束。当前由 ${otherName} 接待。` });
      }
      const closedAt = nowIso();
      const basePatch = {
        status: "ended",
        updated_at: closedAt,
      };
      // Prefer keeping customer_service_id for history; also try optional close metadata columns.
      const richPatch = {
        ...basePatch,
        closed_at: closedAt,
        ended_at: closedAt,
        closed_by: service.profile.id,
        unread_count: 0,
      };
      let conversation = null;
      try {
        const rows = await supabaseJson(
          restUrl("conversations", `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(service.profile.id)}`),
          { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(richPatch) }
        );
        conversation = Array.isArray(rows) ? rows[0] : null;
      } catch (err) {
        const detail = String(err?.message || "");
        if (!/closed_at|closed_by|ended_at|unread_count|schema cache|column|status|check|invalid/i.test(detail)) throw err;
        try {
          const rows = await supabaseJson(
            restUrl("conversations", `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(service.profile.id)}`),
            {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                status: /status|check|invalid/i.test(detail) ? "closed" : "ended",
                updated_at: closedAt,
                closed_at: closedAt,
                closed_by: service.profile.id,
              }),
            }
          );
          conversation = Array.isArray(rows) ? rows[0] : null;
        } catch (err2) {
          const detail2 = String(err2?.message || "");
          if (!/closed_at|closed_by|ended_at|schema cache|column|status|check|invalid/i.test(detail2)) throw err2;
          const rows = await supabaseJson(
            restUrl("conversations", `?id=eq.${encodeURIComponent(id)}&customer_service_id=eq.${encodeURIComponent(service.profile.id)}`),
            {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                status: /status|check|invalid/i.test(detail2) ? "closed" : "ended",
                updated_at: closedAt,
              }),
            }
          );
          conversation = Array.isArray(rows) ? rows[0] : null;
        }
      }
      if (!conversation) {
        const again = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
        conversation = again || existing;
      }
      try {
        await (await import("./_service-receptions.js")).endReceptionRecord(id, service.profile.id);
      } catch (_) {}
      let rewardEval = null;
      let commissionEval = null;
      try {
        rewardEval = await (await import("./_cs-dock-rewards.js")).evaluateEndReceptionReward({
          serviceId: service.profile.id,
          conversation: conversation || existing,
        });
      } catch (_) {
        rewardEval = { code: "ERROR", message: "奖励结算检查失败，请稍后在后台核对。", settled: false };
      }
      try {
        commissionEval = await (await import("./_cs-commission-settle.js")).evaluateEndReceptionCommission({
          serviceId: service.profile.id,
          conversation: conversation || existing,
        });
      } catch (_) {
        commissionEval = {
          code: "ERROR",
          message: "提成结算检查失败，请稍后在后台核对。",
          settled: false,
          commissionAmount: 0,
        };
      }
      await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
      await addMessage(conversation || existing, service.profile.id, "customer_service", "客服已结束本次接待。", "system");
      await logSessionAction({
        conversationId: id,
        orderId: existing.order_id || null,
        action: "end",
        fromCsId: service.profile.id,
        toCsId: service.profile.id,
        operatorId: service.profile.id,
        operatorRole: "customer_service",
        detail: "结束接待",
      });
      await markConversationBossMessagesRead(id, { bossId: existing.boss_id, conversation: existing });
      const consultMsg =
        commissionEval?.consultation || commissionEval?.code === "CONSULTATION" || commissionEval?.code === "UNPAID"
          ? "本次为普通咨询，无订单提成"
          : "";
      const endMessage =
        consultMsg ||
        commissionEval?.message ||
        rewardEval?.message ||
        "已结束接待。";
      return json(res, 200, {
        ok: true,
        message: endMessage,
        reward: rewardEval,
        commission: commissionEval,
        conversation: {
          ...(conversation || existing),
          status: "closed",
          closed_at: closedAt,
          closed_by: service.profile.id,
        },
      });
    }
    if (action === "mark_read" || action === "read_conversation") {
      const id = String(body.id || body.conversation_id || body.conversationId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      // Only the assigned CS (or admin) may clear unread. View-only CS must not wipe owner unread.
      const ownerId = String(existing.customer_service_id || "").trim();
      if (ownerId && ownerId !== service.profile.id && !isAdminProfile(service.profile)) {
        const unread = await countUnreadBossMessages(id, { roles: unreadRolesForConversation(existing) });
        return json(res, 200, {
          ok: true,
          message: "只读查看，未清除负责客服未读。",
          skipped: true,
          conversation: { ...existing, unread, unreadCount: unread },
          unread,
          unreadCount: unread,
        });
      }
      const roles = unreadRolesForConversation(existing);
      const marked = await markConversationBossMessagesRead(id, {
        bossId: existing.boss_id,
        conversation: existing,
        roles,
      });
      return json(res, 200, {
        ok: true,
        message: "已标记已读。",
        conversation: {
          ...existing,
          last_read_at: marked.readAt,
          unread: marked.unread,
          unreadCount: marked.unread,
        },
        unread: marked.unread,
        unreadCount: marked.unread,
        last_read_at: marked.readAt,
      });
    }
    if (action === "list_messages" || action === "conversation_messages") {
      const id = String(body.id || body.conversation_id || body.conversationId || req.query?.conversation_id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少会话 ID。" });
      const existing = (await tableRows("conversations", `?id=eq.${encodeURIComponent(id)}&limit=1`))[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在。" });
      // Other CS may VIEW messages; mutate endpoints still enforce ownership.
      const lockBanner = await lockMessageForConversation(existing, service.profile);
      const rows = await maybeRows(
        "messages",
        `?conversation_id=eq.${encodeURIComponent(id)}&order=created_at.asc&limit=500`
      );
      const ids = [...new Set((rows || []).map((m) => m.sender_id).filter(Boolean))];
      const profiles = await profileMap(ids.concat([existing.boss_id, existing.companion_id, existing.customer_service_id]));
      const other = existing.customer_service_id ? profiles[existing.customer_service_id] || (await profileById(existing.customer_service_id)) : null;
      const lockedByOther = !!lockBanner;
      return json(res, 200, {
        ok: true,
        conversationId: id,
        messages: (rows || []).map((row) => safeMessage(row, profiles)),
        locked: lockedByOther,
        lockedByOther,
        lockBanner: lockBanner || "",
        currentServiceId: existing.customer_service_id || "",
        currentServiceName: String(other?.display_name || "").trim() || "",
        assignedCsId: existing.customer_service_id || "",
        assignedCsName: String(other?.display_name || "").trim() || "",
        canMutate: !lockedByOther && !!existing.customer_service_id && existing.customer_service_id === service.profile.id,
      });
    }
    if (action === "poll_updates" || action === "chat_poll") {
      const activeId = String(body.conversation_id || body.conversationId || body.id || "").trim();
      const since = String(body.since || "").trim();
      // Prefer incremental conversation query when since is provided.
      let convQuery = "?order=updated_at.desc&limit=80";
      if (since) {
        convQuery = `?updated_at=gt.${encodeURIComponent(since)}&order=updated_at.desc&limit=80`;
      }
      const convRows = await maybeRows("conversations", convQuery);
      // When incremental returns few rows, still refresh top active pool lightly for status drift.
      let visible = (convRows || []).filter((row) => {
        const isCompanion =
          String(row.conversation_type || "") === "companion_support" || (!row.boss_id && row.companion_id);
        if (isCompanion) return true;
        return !isTestNoiseConversation(row, [], "");
      });
      if (since && visible.length < 5) {
        const top = await maybeRows("conversations", "?order=updated_at.desc&limit=40");
        const byId = {};
        (top || []).concat(visible).forEach((r) => {
          if (r?.id) byId[r.id] = r;
        });
        visible = Object.keys(byId).map((k) => byId[k]);
      }
      const profileIds = [
        ...new Set(
          visible
            .flatMap((c) => [c.boss_id, c.companion_id, c.customer_service_id])
            .filter(Boolean)
        ),
      ];
      const profiles = await profileMap(profileIds);
      // Always pull global recent/new messages so companion→CS traffic is not dropped
      // when another conversation is active in the desk UI.
      let msgRows = [];
      if (since) {
        msgRows = await maybeRows(
          "messages",
          `?created_at=gt.${encodeURIComponent(since)}&order=created_at.asc&limit=200`
        );
      } else {
        msgRows = await maybeRows("messages", "?order=created_at.desc&limit=200");
      }
      if (activeId) {
        const activeRows = await maybeRows(
          "messages",
          `?conversation_id=eq.${encodeURIComponent(activeId)}&order=created_at.desc&limit=120`
        );
        const byMsgId = {};
        (msgRows || []).concat(activeRows || []).forEach((row) => {
          if (row?.id) byMsgId[row.id] = row;
        });
        msgRows = Object.keys(byMsgId).map((k) => byMsgId[k]);
      }
      const orderIds = [...new Set(visible.map((c) => c.order_id).filter(Boolean))];
      // Also pull recent awaiting_payment / payment-review orders so CS desk sees new boss proofs
      // without requiring a conversation link or full bootstrap.
      let recentPayOrders = [];
      try {
        recentPayOrders = await maybeRows(
          "orders",
          since
            ? `?status=eq.awaiting_payment&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.desc&limit=40`
            : "?status=eq.awaiting_payment&order=updated_at.desc&limit=40"
        );
      } catch {
        recentPayOrders = [];
      }
      const allOrderIds = [...new Set(orderIds.concat((recentPayOrders || []).map((r) => r.id).filter(Boolean)))];
      const ordersRaw = allOrderIds.length
        ? await maybeRows("orders", `?id=in.(${allOrderIds.map(encodeURIComponent).join(",")})&limit=120`)
        : [];
      // Prefer rows already loaded for payment-review enrichment below.
      const orderByIdRaw = {};
      (ordersRaw || []).concat(recentPayOrders || []).forEach((row) => {
        if (row?.id) orderByIdRaw[row.id] = row;
      });
      const ordersMerged = Object.keys(orderByIdRaw).map((k) => orderByIdRaw[k]);
      const orderNoById = ordersMerged.reduce((m, o) => {
        m[o.id] = o.order_no || o.id;
        return m;
      }, {});
      const conversations = visible.map((row) => {
        const boss = profiles[row.boss_id] || {};
        const companionProf = profiles[row.companion_id] || {};
        const serviceProf = profiles[row.customer_service_id] || {};
        const isCompanionSupport =
          String(row.conversation_type || "") === "companion_support" || (!row.boss_id && row.companion_id);
        const isClosed = row.status === "closed" || row.status === "ended";
        const unreadRoles = isCompanionSupport ? ["companion"] : ["boss"];
        const lockedByOther = conversationLockedByOther(row, service.profile.id);
        const bossInfo = bossForCs(boss);
        return {
          id: row.id,
          bossId: row.boss_id || "",
          bossUid: bossInfo.bossUid,
          bossName: isCompanionSupport
            ? `陪玩 · ${(() => {
                const n = String(companionProf.display_name || "").trim() || "陪玩";
                return /@/.test(n) || /^(boss|companion|service)\./i.test(n) ? "陪玩" : n;
              })()}`
            : bossInfo.bossName,
          companionId: row.companion_id || "",
          conversationType: row.conversation_type || (isCompanionSupport ? "companion_support" : "general_support"),
          orderId: row.order_id || "",
          orderNo: orderNoById[row.order_id] || "",
          currentServiceId: isClosed ? row.customer_service_id || "" : row.customer_service_id || "",
          currentServiceName: row.customer_service_id ? csDisplayName(serviceProf) : "待接待",
          status: isClosed ? "已结束" : row.customer_service_id ? "正在接待" : "待接待",
          rawStatus: isClosed ? "closed" : row.status || "",
          lockedByOther,
          lastMessage: "",
          lastTime: row.updated_at || "",
          unread: 0,
          unreadCount: 0,
          lastReadAt: row.last_read_at || "",
          closedAt: row.closed_at || "",
          closedBy: row.closed_by || "",
          updatedAt: row.updated_at || "",
          _unreadRoles: unreadRoles,
        };
      });
      const messages = (msgRows || [])
        .slice()
        .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
        .map((row) => safeMessage(row, profiles));
      // Light unread recount for listed conversations using last_read_at + recent messages sample.
      const byConv = messages.reduce((m, msg) => {
        (m[msg.conversationId] = m[msg.conversationId] || []).push(msg);
        return m;
      }, {});
      for (const c of conversations) {
        if (c.lockedByOther) {
          const list = byConv[c.id] || [];
          if (list.length) {
            const last = list[list.length - 1];
            c.lastMessage = last.content || c.lastMessage || "";
            c.lastTime = last.createdAt || c.lastTime;
          }
          // Other CS can see that new messages exist, but must not clear owner unread via mark_read.
          const roles = c._unreadRoles || ["boss"];
          const peerNew = list.filter((m) => roles.includes(m.senderRole) && !m.readAt).length;
          if (peerNew > 0) {
            c.unread = Math.max(Number(c.unread || 0), peerNew);
            c.unreadCount = c.unread;
            c.hasNewMessages = true;
          }
          c.lockBanner = CS_LOCK_VIEW_ONLY(c.currentServiceName || "其他客服");
          delete c._unreadRoles;
          continue;
        }
        const list = byConv[c.id] || [];
        if (list.length) {
          const last = list[list.length - 1];
          c.lastMessage = last.content || "";
          c.lastTime = last.createdAt || c.lastTime;
        }
        const roles = c._unreadRoles || ["boss"];
        c.unread = list.filter((m) => {
          if (!roles.includes(m.senderRole) || m.readAt) return false;
          if (c.lastReadAt && String(m.createdAt || "") <= String(c.lastReadAt)) return false;
          return true;
        }).length;
        c.unreadCount = c.unread;
        delete c._unreadRoles;
      }
      // Accurate unread for active conversation.
      if (activeId) {
        const active = conversations.find((c) => c.id === activeId);
        if (active && !active.lockedByOther) {
          const roles = unreadRolesForConversation({
            conversation_type: active.conversationType,
            boss_id: active.bossId,
            companion_id: active.companionId,
          });
          active.unread = await countUnreadBossMessages(activeId, { roles });
          active.unreadCount = active.unread;
        }
      }
      const orders = await (async () => {
        const awaiting = (ordersMerged || []).filter((row) => row.status === "awaiting_payment");
        let receiptByOrder = {};
        let signedByOrder = {};
        if (awaiting.length) {
          try {
            const pendingReceipts = await listPendingForCs({ orderIds: awaiting.map((r) => r.id) });
            receiptByOrder = Object.fromEntries((pendingReceipts || []).map((r) => [r.order_id, r]));
            const pairs = await Promise.all(
              (pendingReceipts || []).map(async (receipt) => {
                const url = await signedProofUrl(receipt).catch(() => "");
                return [receipt.order_id, url || ""];
              })
            );
            signedByOrder = Object.fromEntries(pairs);
          } catch {
            receiptByOrder = {};
            signedByOrder = {};
          }
        }
        return (ordersMerged || []).map((row) =>
          safeOrder(row, profiles, {
            paymentReceipt: receiptByOrder[row.id] || null,
            paymentProofUrl: signedByOrder[row.id] || "",
          })
        );
      })();
      return json(res, 200, {
        ok: true,
        data: {
          conversations,
          messages,
          orders,
          polledAt: nowIso(),
          incremental: !!since,
        },
      });
    }
    if (action === "send_message") {
      const conversation = (await tableRows("conversations", `?id=eq.${encodeURIComponent(String(body.conversation_id || body.id || ""))}&limit=1`))[0];
      if (!conversation) return json(res, 404, { ok: false, message: "会话不存在。" });
      if (conversation.status === "closed" || conversation.status === "ended") {
        return json(res, 403, { ok: false, message: "会话已结束，无法继续发送消息。" });
      }
      if (!conversation.customer_service_id) {
        return json(res, 403, { ok: false, message: "请先点击「开始接待」后再回复。" });
      }
      if (conversation.customer_service_id !== service.profile.id && !isAdminProfile(service.profile)) {
        const other = await profileById(conversation.customer_service_id);
        const otherName = String(other?.display_name || "").trim() || "其他客服";
        return json(res, 403, {
          ok: false,
          message: CS_LOCK_DENIED,
          lockBanner: CS_LOCK_VIEW_ONLY(otherName),
          locked: true,
          currentServiceId: conversation.customer_service_id || "",
          currentServiceName: otherName,
          assignedCsId: conversation.customer_service_id || "",
          assignedCsName: otherName,
        });
      }
      let messageType = String(body.messageType || body.message_type || "text").trim() || "text";
      let content = String(body.content || "").trim();
      if (!content) return json(res, 400, { ok: false, message: "请输入消息内容。" });
      if (messageType === "image" && !(/^https?:\/\//i.test(content) || content.startsWith("__IMG__:"))) {
        return json(res, 400, { ok: false, message: "图片消息内容无效。" });
      }
      let msg = null;
      try {
        msg = await addMessage(conversation, service.profile.id, "customer_service", content, messageType);
      } catch (err) {
        if (messageType === "image" && /enum|invalid input|message_type/i.test(String(err.message || ""))) {
          content = content.startsWith("__IMG__:") ? content : `__IMG__:${content}`;
          msg = await addMessage(conversation, service.profile.id, "customer_service", content, "text");
          messageType = "text";
        } else {
          throw err;
        }
      }
      await touchConversationActive({ restUrl, supabaseJson, serviceHeaders }, conversation.id);
      const messageRow = msg
        ? Object.assign({}, safeMessage(msg, { [service.profile.id]: service.profile }), {
            senderName: String(service.profile.display_name || "").trim() || "客服",
            messageType: msg.message_type || messageType,
          })
        : null;
      return json(res, 200, { ok: true, message: "消息已发送。", messageRow });
    }
    if (action === "clock_in" || action === "clock_out") {
      const t0 = Date.now();
      const workApi = await import("./_customer-service-work.js");
      // Fast path only: no loadBootstrap / wage / conversation reload.
      const cfg = body.config || body.shiftConfig || null;
      const result =
        action === "clock_in"
          ? await workApi.clockInService(service.profile.id, { config: cfg })
          : await workApi.clockOutService(service.profile.id, { config: cfg });
      if (!result?.meta?.clockInAt && action === "clock_in") {
        return json(res, 500, { ok: false, message: "上班打卡未写入数据库，请重试。" });
      }
      if (action === "clock_out" && !result?.meta?.clockOutAt && !result?.already) {
        return json(res, 500, { ok: false, message: "下班打卡未写入数据库，请重试。" });
      }
      let released = { released: 0, ids: [] };
      // 下班不自动释放订单会话：避免其他客服误抢；必须走转交或管理员接管。
      if (action === "clock_out" && !result?.already) {
        released = { released: 0, ids: [], retained: true };
      }
      const attendance = result.meta;
      const totalMs = Date.now() - t0;
      return json(res, 200, {
        ok: true,
        message:
          action === "clock_in"
            ? result?.already
              ? "今日已上班打卡。"
              : "上班打卡成功。"
            : result?.already
              ? "今日已下班打卡。"
              : released.released
                ? `下班打卡成功，已将会话转回公共池（${released.released}）。`
                : "下班打卡成功。",
        attendance,
        already: !!result?.already,
        persisted: true,
        releasedConversations: released.ids,
        releasedCount: released.released,
        userTip: action === "clock_out" && released.released ? TRANSFER_USER_TIP : "",
        rowId: result?.row?.id || "",
        elapsedMs: result?.elapsedMs ?? totalMs,
        totalMs,
      });
    }
    if (action === "list_cs_staff" || action === "list_transfer_targets") {
      const rows = await maybeRows(
        "profiles",
        `?role=eq.customer_service&status=eq.active&select=id,display_name,email,status&order=display_name.asc&limit=200`
      );
      const staff = (rows || [])
        .filter((p) => p?.id)
        .map((p) => ({
          id: p.id,
          name: String(p.display_name || "").trim() || "客服",
          email: p.email || "",
          isSelf: p.id === service.profile.id,
        }));
      return json(res, 200, { ok: true, staff });
    }
    if (action === "create_after_sales_conversation" || action === "start_after_sales") {
      const orderId = String(body.order_id || body.orderId || body.id || "").trim();
      if (!orderId) return json(res, 400, { ok: false, message: "缺少订单 ID。" });
      const order = await orderById(orderId);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      // Close any leftover open order thread so after-sales is independent.
      try {
        const openRows = await maybeRows(
          "conversations",
          `?order_id=eq.${encodeURIComponent(orderId)}&status=not.in.(closed,ended)&limit=20`
        );
        for (const row of openRows || []) {
          if (row.customer_service_id && row.customer_service_id !== service.profile.id && !isAdminProfile(service.profile)) {
            continue;
          }
          await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(row.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ status: "ended", updated_at: nowIso(), closed_at: nowIso(), closed_by: service.profile.id }),
          }).catch(() => null);
        }
      } catch (_) {}
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: order.companion_id || null,
        customer_service_id: service.profile.id,
        order_id: orderId,
        consult_type: "refund",
        forceNew: true,
      });
      if (!conversation) return json(res, 500, { ok: false, message: "创建售后会话失败。" });
      // Ensure consult_type + claim
      try {
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            consult_type: "refund",
            conversation_type: "order_support",
            customer_service_id: service.profile.id,
            status: "active",
            accepted_at: nowIso(),
            updated_at: nowIso(),
          }),
        });
      } catch (_) {}
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `售后会话已创建（订单 ${order.order_no || orderId}）。由客服 ${String(service.profile.display_name || "").trim() || "客服"} 负责。`,
        "system",
        orderId
      );
      await logSessionAction({
        conversationId: conversation.id,
        orderId,
        action: "after_sales_create",
        fromCsId: null,
        toCsId: service.profile.id,
        operatorId: service.profile.id,
        operatorRole: "customer_service",
        detail: "创建售后会话",
      });
      return json(res, 200, {
        ok: true,
        message: "已创建售后会话。",
        conversationId: conversation.id,
        conversation,
      });
    }
    if (action === "create_order") {
      // If creating from a locked conversation, only the owner may mutate.
      const ctxConvId = String(body.conversation_id || body.conversationId || "").trim();
      if (ctxConvId) {
        const ctx = (await tableRows("conversations", `?id=eq.${encodeURIComponent(ctxConvId)}&limit=1`))[0];
        if (ctx) {
          try {
            await assertOwnsConversation({ conversation: ctx, serviceProfile: service.profile, allowUnassigned: true });
          } catch (err) {
            return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
          }
          if (ctx.status === "closed" || ctx.status === "ended") {
            return json(res, 403, { ok: false, message: "已结束会话中不能继续创建订单，请新建对话或售后会话。" });
          }
        }
      }
      const o = body.order || body;
      const rawBossId = String(o.boss_id || o.bossId || o.boss || "").trim();
      const rawBossUid = String(o.boss_uid || o.bossUid || "").trim();
      const bossInput = isUuid(rawBossId) ? rawBossId : (rawBossUid || rawBossId);
      const boss = await resolveBoss(bossInput);
      if (!boss || boss.role !== "boss" || !isUuid(boss.id)) {
        return json(res, 400, { ok: false, message: "请选择真实老板账号（支持老板 UID / UUID）。" });
      }
      const bossId = boss.id;
      const hours = Math.max(0.5, money(o.hours || o.duration || 1) || 1);
      const companionInput = String(o.companion_id || o.companionId || "").trim();
      let companionId = null;
      let unit = 0;
      if (companionInput) {
        const companion = await resolveCompanion(companionInput);
        if (!companion || !isUuid(companion.id)) {
          return json(res, 400, { ok: false, message: "指定陪玩无效，请选择真实陪玩账号（UUID / 陪玩 UID）。" });
        }
        companionId = companion.id;
        const { priceForGame } = await import("./_game-prices.js");
        const cpRows = await supabaseJson(
          restUrl(
            "companion_profiles",
            `?user_id=eq.${encodeURIComponent(companionId)}&select=price,game_prices,tags,game,main_service,service_ids&limit=1`
          ),
          { headers: serviceHeaders() }
        ).catch(() => []);
        const cp = Array.isArray(cpRows) ? cpRows[0] : null;
        const gameName = String(o.game || "").trim();
        unit = money(priceForGame(cp || {}, gameName, String(o.service_id || o.serviceId || "").trim()));
        if (!(unit > 0)) unit = money(cp?.price);
      }
      // Without companion catalog price, CS may quote — but total is always recomputed server-side from unit×hours.
      if (!(unit > 0)) unit = money(o.unit_price || o.unitPrice || o.price);
      const total = Math.round(unit * hours * 100) / 100;
      if (!o.game || (!o.description && !o.title) || total <= 0 || !(unit > 0)) {
        return json(res, 400, { ok: false, message: "请完整填写游戏、需求和金额。" });
      }
      const clientTotal = money(o.total_amount || o.totalAmount || o.amount);
      if (clientTotal > 0 && Math.abs(clientTotal - total) > 0.05) {
        return json(res, 400, { ok: false, message: `金额已按单价×时长重算为 ${total}，请刷新后重试。` });
      }
      const idempotencyKey = String(o.idempotencyKey || o.idempotency_key || "").trim();
      if (idempotencyKey) {
        try {
          const existing = await supabaseJson(
            restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
            { headers: serviceHeaders() }
          );
          if (existing?.[0]) {
            return json(res, 200, { ok: true, message: "订单已存在（幂等）。", order: existing[0], deduped: true });
          }
        } catch (_) {
          /* column may be missing */
        }
      }
      const wantHall =
        !companionId &&
        (o.send_to_hall === true ||
          o.sendToHall === true ||
          o.publish_to_hall === true ||
          /open_grab|customer_service|custom/i.test(String(o.order_type || o.orderType || "customer_service")));
      // A 公开抢单: companion_id null + assignment_type=public
      // B 指定陪玩: companion_id required + assignment_type=assigned
      if (companionId && (o.send_to_hall === true || o.sendToHall === true || o.publish_to_hall === true)) {
        return json(res, 400, {
          ok: false,
          message: "指定陪玩订单不能发布到抢单大厅。请选择「指定陪玩」或清空陪玩后发布公开抢单。",
        });
      }
      const assignmentType = companionId ? "assigned" : "public";
      const orderType = String(
        o.order_type ||
          o.orderType ||
          (assignmentType === "assigned" ? "direct_companion" : wantHall ? "open_grab" : "customer_service")
      );
      const payload = {
        order_no: await nextOrderNo(),
        boss_id: bossId,
        companion_id: companionId,
        customer_service_id: service.profile.id,
        order_type: orderType,
        assignment_type: assignmentType,
        game: String(o.game || ""),
        title: String(o.title || o.description || "客服创建订单"),
        description: String(o.description || o.requirements || o.title || ""),
        hours,
        unit_price: unit,
        total_amount: total,
        status: "awaiting_payment",
        created_at: nowIso(),
      };
      // Optional appointment / headcount / note fields when columns exist.
      const appointment = String(o.appointment_time || o.appointmentTime || o.scheduled_at || "").trim();
      const headcount = Number(o.headcount || o.head_count || o.players || 0) || 0;
      const bossNote = String(o.boss_note || o.bossNote || o.note || "").trim();
      if (appointment) payload.scheduled_at = appointment;
      if (headcount > 0) payload.headcount = headcount;
      if (bossNote && !payload.description.includes(bossNote)) {
        payload.description = payload.description ? `${payload.description}\n备注：${bossNote}` : bossNote;
      }
      if (idempotencyKey) payload.idempotency_key = idempotencyKey;
      let rows;
      async function insertOrder(body) {
        return supabaseJson(restUrl("orders"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify(body),
        });
      }
      try {
        rows = await insertOrder(payload);
      } catch (insertErr) {
        if (idempotencyKey && /duplicate|unique|idempotency/i.test(String(insertErr.message || ""))) {
          const existing = await supabaseJson(
            restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
            { headers: serviceHeaders() }
          ).catch(() => []);
          if (existing?.[0]) return json(res, 200, { ok: true, message: "订单已存在（幂等）。", order: existing[0], deduped: true });
        }
        if (/column|schema cache|PGRST/i.test(String(insertErr.message || ""))) {
          const {
            idempotency_key: _ik,
            scheduled_at: _sa,
            headcount: _hc,
            assignment_type: _at,
            ...rest
          } = payload;
          // Retry without optional columns; append appointment/headcount into description.
          let desc = String(rest.description || "");
          if (appointment) desc = desc ? `${desc}\n预约时间：${appointment}` : `预约时间：${appointment}`;
          if (headcount > 0) desc = desc ? `${desc}\n人数：${headcount}` : `人数：${headcount}`;
          rows = await insertOrder({ ...rest, description: desc });
        } else {
          throw insertErr;
        }
      }
      let order = rows[0];
      const autoPublish =
        !companionId &&
        (o.send_to_hall === true || o.sendToHall === true || o.publish_to_hall === true || body.send_to_hall === true);
      const conversation = await ensureConversation({
        boss_id: bossId,
        companion_id: order.companion_id || null,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      const companionLabel = companionId
        ? (await profileById(companionId).then((p) => p?.display_name).catch(() => "")) || "指定陪玩"
        : "未指定（公开抢单）";
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `新订单已提交，等待支付，指定陪玩为 ${companionLabel}。订单：${order.order_no} / ${order.game} / ${money(order.total_amount).toFixed(2)} 猫粮。`,
        "system",
        order.id
      );
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `订单卡片：${order.order_no} / ${order.game} / ${money(order.total_amount).toFixed(2)} 猫粮。请确认付款。`,
        "order_card",
        order.id
      );
      if (autoPublish) {
        // Create + publish to hall in one step when CS explicitly requests it.
        body.id = order.id;
        body.action = "confirm_payment";
        // Fall through by recursive-style inline: reuse confirm_payment path via status patch below.
        try {
          const walletApi = await import("./_wallet.js");
          await walletApi
            .debitWallet({
              bossId: order.boss_id,
              amount: money(order.total_amount),
              transactionType: "order_payment",
              idempotencyKey: `order-pay:${order.order_no || order.id}`,
              reason: `客服代下单发送抢单大厅 ${order.order_no || order.id}`,
              relatedOrderId: order.id,
              operatorId: service.profile.id,
            })
            .catch((e) => {
              if (!/insufficient|余额不足|not enough|idempotency|duplicate|already/i.test(String(e?.message || e || ""))) {
                throw e;
              }
            });
        } catch (_) {
          /* offline / ops confirm allowed */
        }
        const { transitionOrderStatus } = await import("./_order-status.js");
        const patched =
          (await transitionOrderStatus(
            { restUrl, supabaseJson, serviceHeaders },
            {
              orderId: order.id,
              filterQuery: `?id=eq.${encodeURIComponent(order.id)}&status=eq.awaiting_payment`,
              fromStatus: "awaiting_payment",
              toStatus: "pending",
              patch: {
                customer_service_id: service.profile.id,
                assignment_type: "public",
                companion_id: null,
                order_type: "open_grab",
              },
              operatorRole: "customer_service",
              operatorId: service.profile.id,
              note: "cs create_order auto send_to_hall",
            }
          ).catch(() => null)) ||
          (await patchOrder(order.id, {
            status: "pending",
            customer_service_id: service.profile.id,
            companion_id: null,
          }));
        order = patched || { ...order, status: "pending", assignment_type: "public", companion_id: null };
        try {
          const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
          const listingsApi = createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders });
          await listingsApi.upsertListing(
            { ...order, assignment_type: "public", companion_id: null, customer_service_id: service.profile.id },
            { publishedByCsId: service.profile.id }
          );
        } catch (_) {}
        await addMessage(
          conversation,
          service.profile.id,
          "customer_service",
          "客服已发送订单至抢单大厅。",
          "system",
          order.id
        );
        return json(res, 200, {
          ok: true,
          message: "订单已发布到抢单大厅",
          order,
          sentToGrabHall: true,
        });
      }
      return json(res, 200, {
        ok: true,
        message: companionId ? "订单已创建，进入待付款。" : "订单已创建。请点击「发送到抢单大厅」完成发布。",
        order,
        needsSendToHall: !companionId,
      });
    }
    if (action === "reject_payment_proof") {
      const order = await orderById(String(body.id || body.order_id || ""));
      const reason = String(body.reason || body.reject_reason || "").trim();
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      if (order.status !== "awaiting_payment") return json(res, 409, { ok: false, message: "当前订单不在付款审核中。" });
      if (!reason) return json(res, 400, { ok: false, message: "请填写驳回付款原因。" });
      const receipts = await listPendingForCs({ orderIds: [order.id] });
      const receipt = receipts?.[0];
      if (!receipt) return json(res, 404, { ok: false, message: "未找到待审核付款凭证。" });
      await rejectProof({ receipt, reviewerId: service.profile.id, reason });
      const stripProof = (text) =>
        String(text || "")
          .replace(/\n?\[\[PAYMENT_PROOF\]\][^\n]*/g, "")
          .replace(/\n?\[\[PAYMENT_SUBMITTED\]\][^\n]*/g, "")
          .trim();
      const nextNote = stripProof(order.note);
      const nextDescription = stripProof(order.description);
      await patchOrder(order.id, { note: nextNote, description: nextDescription }).catch(() =>
        patchOrder(order.id, { note: nextNote }).catch(() => null)
      );
      const conversation = await ensureConversation({
        boss_id: order.boss_id, companion_id: order.companion_id, customer_service_id: service.profile.id, order_id: order.id,
      });
      await addMessage(conversation, service.profile.id, "customer_service", `付款凭证已驳回：${reason}。请重新上传。`, "system", order.id);
      return json(res, 200, { ok: true, message: "已驳回付款凭证，老板可重新上传。", order: { ...order, paymentReview: false } });
    }
    if (action === "confirm_payment" || action === "push_to_grab_hall" || action === "send_to_grab_hall") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }

      const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
      const listingsApi = createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders });
      const assignedCompanionId = String(order.companion_id || "").trim() || "";
      const isAssignedPath = !!assignedCompanionId;
      const hallOpenAlready =
        !isAssignedPath &&
        ["pending", "waiting_boss_confirm"].includes(String(order.status || "")) &&
        String(order.assignment_type || "public").toLowerCase() !== "assigned";

      // Already in grab hall → never re-publish / re-debit; refresh listing + return 抢单中.
      if (hallOpenAlready) {
        const listing = await listingsApi.upsertListing(
          { ...order, assignment_type: order.assignment_type || "public", companion_id: null },
          { publishedByCsId: service.profile.id }
        );
        const profiles = await profileMap([order.boss_id, order.customer_service_id, service.profile.id]);
        const { createOrderGrabHelpers } = await import("./_order-grabs.js");
        const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
        const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
        return json(res, 200, {
          ok: true,
          message: "订单已在抢单大厅（抢单中）。",
          order: safeOrder(
            {
              ...order,
              status: order.status,
              assignment_type: order.assignment_type || "public",
              companion_id: null,
            },
            profiles,
            { grabCount: grabs.length, grabs }
          ),
          listing: listing.listing || null,
          sentToGrabHall: true,
          alreadyPublished: true,
        });
      }

      if (order.status !== "awaiting_payment") {
        return json(res, 400, {
          ok: false,
          message: "只有待付款确认订单可以确认付款 / 发送到抢单大厅。",
        });
      }

      if ((action === "push_to_grab_hall" || action === "send_to_grab_hall") && isAssignedPath) {
        return json(res, 400, {
          ok: false,
          message: "该订单已指定陪玩，不能发送到公开抢单大厅。请使用「确认收款并通知陪玩」进入待陪玩确认。",
        });
      }

      const amount = money(order.total_amount);
      if (!(amount > 0)) return json(res, 400, { ok: false, message: "订单金额无效，无法确认付款。" });
      const pendingReceipts = await listPendingForCs({ orderIds: [order.id] });
      const pendingReceipt = pendingReceipts?.[0] || null;
      const existingManualPayment =
        (
          await companionDb(
            "payment_transactions",
            `?order_id=eq.${encodeURIComponent(order.id)}&payment_status=eq.paid&limit=1`
          ).catch(() => [])
        )?.[0] || null;
      // Manual order flow: boss must upload payment screenshot before CS can confirm / dispatch.
      // Do not debit wallet or enter grab/assign until proof is approved.
      if (!pendingReceipt && !existingManualPayment) {
        return json(res, 400, {
          ok: false,
          message: "老板尚未上传付款截图。请等待付款凭证进入「待人工审核」后再确认收款。",
          code: "PAYMENT_PROOF_REQUIRED",
        });
      }
      // A submitted manual proof represents an off-wallet payment.
      let walletSkipped = false;
      if (pendingReceipt) {
        await approveAndLedger({ order, receipt: pendingReceipt, reviewerId: service.profile.id });
        walletSkipped = true;
      } else if (existingManualPayment) {
        walletSkipped = true;
      }

      /* A 指定陪玩 → claimed（待陪玩确认，永不进大厅）；B 公开抢单 → pending + listing */
      const next = isAssignedPath ? "claimed" : "pending";
      const { transitionOrderStatus } = await import("./_order-status.js");
      const basePatch = {
        customer_service_id: service.profile.id,
        assignment_type: isAssignedPath ? "assigned" : "public",
        ...(isAssignedPath
          ? { order_type: order.order_type || "direct_companion", companion_id: assignedCompanionId }
          : { order_type: order.order_type || "open_grab", companion_id: null }),
      };

      async function transitionWithOptionalPaidAt() {
        const tryPatch = async (patch) =>
          transitionOrderStatus(
            { restUrl, supabaseJson, serviceHeaders },
            {
              orderId: order.id,
              filterQuery: `?id=eq.${encodeURIComponent(order.id)}&status=eq.awaiting_payment`,
              fromStatus: "awaiting_payment",
              toStatus: next,
              patch,
              operatorRole: "customer_service",
              operatorId: service.profile.id,
              note: pendingReceipt
                ? "cs approved manual payment proof"
                : walletSkipped
                  ? "cs confirm_payment ops (no wallet debit)"
                  : "cs confirm_payment with wallet debit",
            }
          );
        try {
          return await tryPatch({ ...basePatch, paid_at: nowIso() });
        } catch (err) {
          const msg = String(err?.message || err || "");
          if (/paid_at|PGRST204|schema cache|column/i.test(msg)) {
            // Never drop assignment_type / companion_id / order_type on soft retry.
            try {
              return await tryPatch({ ...basePatch });
            } catch (err2) {
              if (/assignment_type|order_type|PGRST204|schema cache|column/i.test(String(err2?.message || err2))) {
                const soft = {
                  customer_service_id: service.profile.id,
                  companion_id: isAssignedPath ? assignedCompanionId : null,
                };
                return tryPatch(soft);
              }
              throw err2;
            }
          }
          throw err;
        }
      }

      let patched = await transitionWithOptionalPaidAt();
      if (!patched) {
        try {
          patched = await patchOrder(order.id, { status: next, ...basePatch, paid_at: nowIso() });
        } catch (err) {
          if (/paid_at|PGRST204|schema cache/i.test(String(err?.message || err))) {
            patched = await patchOrder(order.id, { status: next, ...basePatch });
          } else if (/assignment_type|order_type|PGRST204|schema cache|column/i.test(String(err?.message || err))) {
            patched = await patchOrder(order.id, {
              status: next,
              customer_service_id: service.profile.id,
              companion_id: isAssignedPath ? assignedCompanionId : null,
            });
          } else {
            throw err;
          }
        }
      }
      if (!patched || patched.status === "awaiting_payment") {
        return json(res, 409, { ok: false, message: "订单状态已变更，请刷新后重试。" });
      }

      // Harden routing fields if soft path dropped them.
      if (!isAssignedPath) {
        const needFix =
          String(patched.assignment_type || "").toLowerCase() !== "public" ||
          patched.companion_id != null;
        if (needFix) {
          patched =
            (await patchOrder(order.id, {
              assignment_type: "public",
              companion_id: null,
              order_type: patched.order_type || order.order_type || "open_grab",
              customer_service_id: service.profile.id,
            }).catch(() => null)) || { ...patched, assignment_type: "public", companion_id: null };
        }
      }

      if (next === "claimed") {
        try {
          const { stampClaimedAtNote } = await import("./_order-confirm-timeout.js");
          const { patchOrderNoteField } = await import("./_order-flow.js");
          await patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, order.id, (text) =>
            stampClaimedAtNote(text)
          );
        } catch {
          /* optional */
        }
      }

      let listingResult = null;
      if (!isAssignedPath) {
        listingResult = await listingsApi.upsertListing(
          {
            ...order,
            ...patched,
            status: "pending",
            assignment_type: "public",
            companion_id: null,
            customer_service_id: service.profile.id,
          },
          { publishedByCsId: service.profile.id, publishedAt: nowIso() }
        );
      } else {
        await listingsApi.closeListing(order.id, "assigned_direct").catch(() => null);
      }

      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: isAssignedPath ? assignedCompanionId : null,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      const sysMsg = isAssignedPath
        ? walletSkipped
          ? "客服已确认线下付款（未扣钱包余额），订单已支付，正在等待陪玩确认接单。"
          : "客服已确认付款，订单已支付，正在等待陪玩确认接单。"
        : walletSkipped
          ? "客服已确认线下付款（未扣钱包余额），订单已发布到抢单大厅。"
          : "客服已确认付款，订单已发布到抢单大厅。";
      await addMessage(conversation, service.profile.id, "customer_service", sysMsg, "system", order.id);

      let reward = null;
      try {
        reward = await (await import("./_cs-commission-settle.js")).settleCsOrderIncome(
          { ...order, ...patched, customer_service_id: service.profile.id, status: next },
          { source: "cs_confirm_payment", forceServiceId: service.profile.id }
        );
      } catch (_) {}

      const profiles = await profileMap([
        order.boss_id,
        isAssignedPath ? assignedCompanionId : null,
        service.profile.id,
      ]);
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = isAssignedPath
        ? []
        : await grabsApi.listGrabs(order.id, patched.note || order.note || order.description || "");
      const paidAtIso = patched.paid_at || nowIso();
      const finalOrder = safeOrder(
        {
          ...order,
          ...patched,
          status: next,
          paid_at: paidAtIso,
          assignment_type: isAssignedPath ? "assigned" : "public",
          companion_id: isAssignedPath ? assignedCompanionId : null,
          customer_service_id: service.profile.id,
        },
        profiles,
        {
          grabCount: grabs.length,
          grabs,
          paidAt: paidAtIso,
          paymentReviewedByName: csDisplayName(service.profile) || service.profile.display_name || "",
          paymentReviewedAt: paidAtIso,
          paymentProofUrl: pendingReceipt ? (await signedProofUrl(pendingReceipt).catch(() => "")) || "" : "",
        }
      );

      if (isAssignedPath && assignedCompanionId) {
        try {
          const { notifyCompanionOrderAssigned } = await import("./_companion-order-notify.js");
          const notifyOrder = {
            ...order,
            ...patched,
            status: next,
            companion_id: assignedCompanionId,
            assignment_type: "assigned",
          };
          await Promise.race([
            notifyCompanionOrderAssigned(notifyOrder, {
              eventType: "assign",
              email: profiles[assignedCompanionId]?.email || "",
            }).catch((err) => console.warn("[cs/confirm_payment] companion notify", err?.message || err)),
            new Promise((resolve) => setTimeout(resolve, 3500)),
          ]);
        } catch (err) {
          console.warn("[cs/confirm_payment] companion notify import", err?.message || err);
        }
      }

      return json(res, 200, {
        ok: true,
        message: isAssignedPath
          ? "已确认付款，订单进入待陪玩确认。"
          : "订单已发布到抢单大厅",
        order: finalOrder,
        reward,
        listing: listingResult?.listing || null,
        sentToGrabHall: !isAssignedPath,
        path: isAssignedPath ? "assigned_confirm" : "grab_hall",
      });
    }
    if (action === "cancel_grab_hall" || action === "cancel_open_grab") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      if (order.companion_id) {
        return json(res, 400, { ok: false, message: "已指定陪玩的订单不能取消抢单，请走取消订单 / 售后。" });
      }
      if (!["pending", "waiting_boss_confirm"].includes(String(order.status || ""))) {
        return json(res, 400, { ok: false, message: "当前订单不在抢单大厅。" });
      }
      const { transitionOrderStatus } = await import("./_order-status.js");
      const patched =
        (await transitionOrderStatus(
          { restUrl, supabaseJson, serviceHeaders },
          {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: "cancelled",
            patch: { cancelled_at: nowIso(), customer_service_id: service.profile.id, cancel_reason: String(body.reason || "客服取消抢单").slice(0, 200) },
            operatorRole: "customer_service",
            operatorId: service.profile.id,
            note: "cs cancel_grab_hall",
          }
        ).catch(() => null)) ||
        (await patchOrder(order.id, {
          status: "cancelled",
          cancelled_at: nowIso(),
          customer_service_id: service.profile.id,
          cancel_reason: String(body.reason || "客服取消抢单").slice(0, 200),
        }));
      try {
        const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
        await createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders }).closeListing(order.id, "cs_cancelled");
      } catch (_) {}
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: null,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      await addMessage(conversation, service.profile.id, "customer_service", "客服已取消该订单的抢单发布。", "system", order.id);
      const profiles = await profileMap([order.boss_id, service.profile.id]);
      return json(res, 200, {
        ok: true,
        message: "已取消抢单，订单已关闭。",
        order: safeOrder(patched || { ...order, status: "cancelled" }, profiles),
      });
    }
    if (action === "list_grabs" || action === "grab_applicants") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const { enrichGrabCompanions, parseBossIntent } = await import("./_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
      const intent = parseBossIntent(order);
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs);
      return json(res, 200, {
        ok: true,
        grabCount: enriched.length,
        bossIntent: intent,
        grabs: enriched.map((g) => ({
          ...g,
          bossPreferred: !!(intent && intent.companionId === g.companionId),
          companion: g.companion
            ? { ...g.companion, bossPreferred: !!(intent && intent.companionId === g.companionId) }
            : null,
        })),
        order: safeOrder(order, await profileMap([order.boss_id, order.companion_id, order.customer_service_id]), {
          grabCount: enriched.length,
          grabs: enriched,
          bossIntent: intent,
        }),
      });
    }
    if (
      action === "push_companion_to_boss" ||
      action === "push_to_boss" ||
      action === "send_companion_card"
    ) {
      const order = await orderById(String(body.id || body.order_id || ""));
      const companion = await resolveCompanion(String(body.companion_id || body.companionId || body.companion_uid || ""));
      if (!order || !companion || !isUuid(companion.id)) {
        return json(res, 400, { ok: false, message: "订单或陪玩不存在。" });
      }
      if (!["pending", "waiting_boss_confirm"].includes(order.status)) {
        return json(res, 409, { ok: false, message: "当前订单状态不能推送陪玩名片给老板。" });
      }
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const { enrichGrabCompanions } = await import("./_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
      const hit = grabs.find((g) => g.companionId === companion.id);
      if (!hit && grabs.length) {
        return json(res, 409, { ok: false, message: "只能推送已抢单的陪玩。" });
      }
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, [
        hit || { companionId: companion.id, status: "pending_customer_selection" },
      ]);
      const c = enriched[0]?.companion || {};
      const card = {
        type: "companion_card",
        orderId: order.id,
        orderNo: order.order_no || "",
        companionId: companion.id,
        nickname: c.nickname || companion.display_name || companion.nickname || "陪玩",
        companionCode: c.companionUid || c.publicId || "",
        avatarUrl: c.avatarUrl || c.cardImageUrl || "",
        level: c.level || "",
        voiceType: c.voiceType || c.voice_type || "",
        voiceUrl: c.voiceUrl || "",
        tags: c.tags || "",
        certTags: c.certTags || [],
        game: c.mainGame || c.game || order.game || "",
        unitPrice: Number(c.price || order.unit_price || 0) || 0,
        onlineStatus: c.onlineStatus || "",
        onlineStatusLabel: c.onlineStatusLabel || "",
        detailUrl: c.detailUrl || `/profile.html?player=${encodeURIComponent(companion.id)}`,
        actions: ["view_detail", "want_him"],
      };
      const conversation = await resolveBossCsConversation(order, service.profile);
      if (!conversation) {
        return json(res, 500, { ok: false, message: "无法定位老板客服会话。" });
      }
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `客服向您推荐陪玩：${card.nickname}（订单 ${order.order_no || order.id}）。`,
        "text",
        order.id
      );
      const msg = await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        JSON.stringify(card),
        "companion_card",
        order.id
      );
      return json(res, 200, {
        ok: true,
        message: "已推送陪玩名片给老板。",
        conversationId: conversation.id,
        messageRow: msg
          ? {
              id: msg.id,
              conversationId: conversation.id,
              messageType: msg.message_type || "companion_card",
              content: msg.content,
              orderId: order.id,
            }
          : null,
        card,
      });
    }
    if (action === "assign_companion" || action === "push_companion" || action === "dispatch_companion" || action === "confirm_grab_assignment") {
      const order = await orderById(String(body.id || body.order_id || ""));
      const companion = await resolveCompanion(String(body.companion_id || body.companionId || body.companion_uid || ""));
      if (!order || !companion || !isUuid(companion.id)) return json(res, 400, { ok: false, message: "订单或陪玩不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      // BOSS_PICK_LOCK: once companion is formally bound (claimed+), CS cannot steal/reassign.
      // Public grab hall (pending / waiting_boss_confirm): CS MAY confirm from grab list
      // (confirm_grab_assignment / from_grabs) — required for 查看抢单人 → 指定陪玩.
      {
        const st = String(order.status || "");
        const hasCompanion = !!String(order.companion_id || "").trim();
        if (hasCompanion && ["claimed", "confirmed", "in_progress"].includes(st)) {
          return json(res, 409, {
            ok: false,
            code: "BOSS_PICK_LOCK",
            message: "老板已选定陪玩，客服不可再次指定。如需更换，请等陪玩拒单或走售后。",
          });
        }
      }
      const companionId = companion.id;
      const lockKey = `${order.id}:${companionId}`;
      if (ASSIGN_LOCKS.get(lockKey) && Date.now() - ASSIGN_LOCKS.get(lockKey) < 8000) {
        return json(res, 409, { ok: false, message: "指定请求处理中，请勿重复点击。" });
      }
      ASSIGN_LOCKS.set(lockKey, Date.now());
      try {
        const { createOrderGrabHelpers } = await import("./_order-grabs.js");
        const { clearBossIntent, parseBossIntent, patchOrderNoteField } = await import("./_order-flow.js");
        const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
        const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
        const fromGrabs =
          body.from_grabs === true ||
          body.fromGrabs === true ||
          action === "confirm_grab_assignment" ||
          ["pending", "waiting_boss_confirm"].includes(order.status);
        if (fromGrabs && grabs.length) {
          const hit = grabs.find((g) => g.companionId === companionId);
          if (!hit) {
            return json(res, 409, { ok: false, message: "只能从已抢单陪玩中指定。请先查看抢单人列表。" });
          }
          if (hit.status === "not_selected") {
            return json(res, 409, { ok: false, message: "该陪玩已被标记为未选中。" });
          }
        }
        // After payment: push companion into claimed (waiting companion confirm). Before payment keep awaiting_payment with companion bound.
        // Direct assign (not from grabs) → assignment_type=assigned (NEVER public hall).
        // From grabs selection → keep public history but bind companion for confirm.
        let nextStatus = "claimed";
        if (order.status === "awaiting_payment") nextStatus = "awaiting_payment";
        else if (order.status === "pending" || order.status === "claimed" || order.status === "waiting_boss_confirm") nextStatus = "claimed";
        else if (order.status === "confirmed" || order.status === "in_progress" || order.status === "completed") {
          return json(res, 400, { ok: false, message: "当前订单状态不能重新派单。" });
        }
        const sameAlready =
          String(order.companion_id || "") === companionId &&
          String(order.status || "") === nextStatus &&
          nextStatus === "claimed";
        if (sameAlready) {
          return json(res, 200, {
            ok: true,
            message: "指定成功",
            order: await (async () => {
              const profiles = await profileMap([order.boss_id, companionId, service.profile.id]);
              return safeOrder(order, profiles);
            })(),
            deduped: true,
          });
        }
        if (grabs.length && nextStatus === "claimed") {
          await grabsApi.finalizeGrabSelection(order, companionId);
        }
        const directAssign = !fromGrabs || !grabs.length;
        const assignPatch = {
          companion_id: companionId,
          customer_service_id: service.profile.id,
          // Do NOT set accepted_at — companion must confirm.
          accepted_at: null,
          assignment_type: directAssign ? "assigned" : "public",
          order_type: directAssign ? "direct_companion" : order.order_type || "open_grab",
        };
        const { transitionOrderStatus } = await import("./_order-status.js");
        const deps = { restUrl, supabaseJson, serviceHeaders };
        let patched = null;
        try {
          patched =
            (await transitionOrderStatus(deps, {
              orderId: order.id,
              fromStatus: order.status,
              toStatus: nextStatus,
              patch: assignPatch,
              operatorRole: "customer_service",
              operatorId: service.profile.id,
              note: `指定陪玩 ${companion.display_name || companion.nickname || companionId}`,
            })) ||
            (await patchOrder(order.id, {
              ...assignPatch,
              status: nextStatus,
            }));
        } catch (err) {
          if (/assignment_type|PGRST204|schema cache|column/i.test(String(err?.message || err || ""))) {
            const { assignment_type: _a, order_type: _o, ...rest } = assignPatch;
            patched =
              (await transitionOrderStatus(deps, {
                orderId: order.id,
                fromStatus: order.status,
                toStatus: nextStatus,
                patch: rest,
                operatorRole: "customer_service",
                operatorId: service.profile.id,
                note: `指定陪玩 ${companion.display_name || companion.nickname || companionId}`,
              }).catch(() => null)) ||
              (await patchOrder(order.id, { ...rest, status: nextStatus }));
          } else {
            throw err;
          }
        }
        try {
          const { stampClaimedAtNote } = await import("./_order-confirm-timeout.js");
          await patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, order.id, (text) => {
            const cleared = clearBossIntent(text);
            if (nextStatus !== "claimed") return cleared;
            return stampClaimedAtNote(cleared);
          });
        } catch {
          /* ignore */
        }
        const conversation = await ensureConversation({
          boss_id: order.boss_id,
          companion_id: companionId,
          customer_service_id: service.profile.id,
          order_id: order.id,
        });
        const companionName = companion.display_name || companion.nickname || "陪玩";
        const intent = parseBossIntent(order);
        await addMessage(
          conversation,
          service.profile.id,
          "customer_service",
          `客服已确认指定陪玩：${companionName}。订单进入待陪玩确认。${
            intent && intent.companionId === companionId ? "（与老板意向一致）" : intent ? `（老板意向为 ${intent.companionName || "其他陪玩"}）` : ""
          }`,
          "system",
          order.id
        );
        try {
          const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
          const listingsApi = createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders });
          await listingsApi.closeListing(order.id, grabs.length ? "grab_assigned" : "direct_assigned");
        } catch (_) {}
        const profiles = await profileMap([patched?.boss_id || order.boss_id, companionId, service.profile.id]);
        const outOrder = patched || { ...order, companion_id: companionId, status: nextStatus };
        // Await briefly so Vercel doesn't freeze before inbox/email/broadcast flush.
        try {
          const { notifyCompanionOrderAssigned } = await import("./_companion-order-notify.js");
          const prevCompanion = String(order.companion_id || "").trim();
          await Promise.race([
            notifyCompanionOrderAssigned(outOrder, {
              eventType: prevCompanion && prevCompanion !== companionId ? "reassign" : "assign",
              previousCompanionId: prevCompanion,
              email: companion.email || profiles[companionId]?.email || "",
            }).catch((err) => console.warn("[cs/assign] companion notify", err?.message || err)),
            new Promise((resolve) => setTimeout(resolve, 3500)),
          ]);
        } catch (err) {
          console.warn("[cs/assign] companion notify import", err?.message || err);
        }
        return json(res, 200, {
          ok: true,
          message: grabs.length ? "指定成功，其他抢单陪玩已标记为未选中。" : "指定成功",
          order: safeOrder(outOrder, profiles, {
            grabCount: grabs.length,
          }),
        });
      } finally {
        setTimeout(() => ASSIGN_LOCKS.delete(lockKey), 3000);
      }
    }
    if (action === "update_order_status") {
      const id = String(body.id || body.order_id || "");
      const status = String(body.status || "");
      const order = await orderById(id);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      const { assertCsStatusTransition, transitionOrderStatus, CS_STATUS_ACTION_LABELS } = await import("./_order-status.js");
      let transition;
      try {
        transition = assertCsStatusTransition(order.status, status);
      } catch (err) {
        return json(res, err.status || 400, { ok: false, message: err.message || "非法状态跳转。" });
      }
      const patch = { customer_service_id: service.profile.id };
      if (transition.to === "completed") patch.completed_at = nowIso();
      if (transition.to === "cancelled") patch.cancelled_at = nowIso();
      if (transition.to === "in_progress") patch.started_at = order.started_at || nowIso();
      const deps = { restUrl, supabaseJson, serviceHeaders };
      const patched = await transitionOrderStatus(deps, {
        orderId: order.id,
        fromStatus: transition.from,
        toStatus: transition.to,
        patch,
        operatorRole: "customer_service",
        operatorId: service.profile.id,
        note: String(body.note || "客服改状态"),
      });
      const conversation = patched
        ? await ensureConversation({
            boss_id: patched.boss_id,
            companion_id: patched.companion_id,
            customer_service_id: service.profile.id,
            order_id: patched.id,
          })
        : null;
      const label = CS_STATUS_ACTION_LABELS[transition.to] || ORDER_STATUS_TEXT[transition.to] || transition.to;
      await addMessage(conversation, service.profile.id, "customer_service", `订单状态已更新为：${label}`, "system", id);
      let reward = null;
      try {
        const settleApi = await import("./_cs-commission-settle.js");
        if (transition.to === "cancelled" || transition.to === "refunded") {
          reward = await settleApi.clawbackCsOrderIncome(patched || { ...order, status: transition.to }, {
            reason: transition.to === "refunded" ? "订单退款" : "订单取消",
            mode: transition.to === "refunded" ? "refund" : "cancel",
          });
        } else {
          reward = await settleApi.settleCsOrderIncome(patched || { ...order, status: transition.to }, {
            source: "cs_status_update",
            forceServiceId: service.profile.id,
          });
        }
      } catch (_) {}
      try {
        const { notifyCompanionOrderStatusChange } = await import("./_companion-order-notify.js");
        const out = patched || { ...order, status: transition.to };
        if (out.companion_id) {
          notifyCompanionOrderStatusChange(out, { status: transition.to }).catch(() => {});
        }
      } catch (_) {}
      return json(res, 200, { ok: true, message: "订单状态已更新。", order: patched, reward });
    }
    if (action === "mark_order_dispute" || action === "mark_dispute") {
      const id = String(body.id || body.order_id || "");
      const order = await orderById(id);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      const { createOrderCompleteHelpers } = await import("./_order-complete.js");
      const helpers = createOrderCompleteHelpers({ restUrl, supabaseJson, serviceHeaders, addSystemMessage: async () => {} });
      await helpers.stampDispute(order, String(body.reason || body.note || "cs_dispute").slice(0, 80));
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: order.companion_id,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      await addMessage(conversation, service.profile.id, "customer_service", "客服已标记订单争议，24 小时自动确认已暂停。", "system", id);
      const fresh = await orderById(id);
      return json(res, 200, { ok: true, message: "已标记争议并暂停自动确认。", order: safeOrder(fresh || order, await profileMap([order.boss_id, order.companion_id, order.customer_service_id])) });
    }
    if (action === "clear_order_dispute" || action === "clear_dispute") {
      const id = String(body.id || body.order_id || "");
      const order = await orderById(id);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      const { createOrderCompleteHelpers } = await import("./_order-complete.js");
      const helpers = createOrderCompleteHelpers({ restUrl, supabaseJson, serviceHeaders, addSystemMessage: async () => {} });
      await helpers.clearDispute(order);
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: order.companion_id,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      await addMessage(conversation, service.profile.id, "customer_service", "客服已解除订单争议标记。", "system", id);
      const fresh = await orderById(id);
      return json(res, 200, { ok: true, message: "已解除争议标记。", order: safeOrder(fresh || order, await profileMap([order.boss_id, order.companion_id, order.customer_service_id])) });
    }
    if (action === "allowed_order_statuses") {
      const id = String(body.id || body.order_id || req.query?.id || "").trim();
      const order = await orderById(id);
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { allowedCsNextStatuses, CS_STATUS_ACTION_LABELS } = await import("./_order-status.js");
      const next = allowedCsNextStatuses(order.status);
      const options = {};
      next.forEach((k) => {
        options[k] = CS_STATUS_ACTION_LABELS[k] || ORDER_STATUS_TEXT[k] || k;
      });
      return json(res, 200, {
        ok: true,
        current: order.status,
        currentText: CS_STATUS_ACTION_LABELS[order.status] || ORDER_STATUS_TEXT[order.status] || order.status,
        options,
      });
    }
    if (action === "refund_decision") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order || order.status !== "refund_requested") return json(res, 400, { ok: false, message: "只有退款申请中的订单可以处理退款。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      const decision = String(body.decision || "");
      const note = String(body.note || "");
      if (!note) return json(res, 400, { ok: false, message: "退款处理必须填写备注。" });
      const refundApi = await import("./_boss-refund-payout.js");
      // Resolve or create Friday refund row for this order
      let refundRows = await companionDb(
        "boss_refund_requests",
        `?order_id=eq.${encodeURIComponent(order.id)}&status=eq.pending_review&order=created_at.desc&limit=1`
      ).catch(() => []);
      let refundRow = Array.isArray(refundRows) ? refundRows[0] : null;
      if (!refundRow && decision === "approve") {
        const created = await refundApi.createBossRefundRequest(companionDb, {
          order,
          boss: { id: order.boss_id, display_name: "", public_uid: "" },
          amount: money(order.total_amount),
          reason: note,
        });
        refundRow = created.refund
          ? { id: created.refund.id, status: "pending_review" }
          : null;
        if (created.refund?.id) {
          refundRows = await companionDb("boss_refund_requests", `?id=eq.${encodeURIComponent(created.refund.id)}&limit=1`).catch(() => []);
          refundRow = refundRows?.[0] || refundRow;
        }
      }
      if (!refundRow) {
        return json(res, 400, { ok: false, message: "未找到待审核退款申请，请老板先提交退款。" });
      }
      if (decision === "approve") {
        const result = await refundApi.csSuggestRefund(companionDb, {
          refundId: refundRow.id,
          decision: "approve",
          note,
          csProfile: service.profile,
        });
        if (!result.ok) return json(res, 400, result);
        // Keep order in refund_requested until Friday payout completes; mark CS binding
        const patched = await patchOrder(order.id, { customer_service_id: service.profile.id });
        // Claw back companion / CS commission when approved into Friday queue (prevents withdraw of refunded income)
        if (order.companion_id) {
          try {
            const incomeRows = await supabaseJson(
              restUrl(
                "transactions",
                `?order_id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(order.companion_id)}&transaction_type=eq.companion_income&status=neq.cancelled&select=id,amount&limit=5`
              ),
              { headers: serviceHeaders() }
            );
            const claw = (incomeRows || []).reduce((n, r) => n + money(r.amount), 0);
            if (claw > 0) {
              const existing = await supabaseJson(
                restUrl(
                  "transactions",
                  `?order_id=eq.${encodeURIComponent(order.id)}&user_id=eq.${encodeURIComponent(order.companion_id)}&transaction_type=eq.refund&select=id&limit=1`
                ),
                { headers: serviceHeaders() }
              ).catch(() => []);
              if (!(existing || []).length) {
                await supabaseJson(restUrl("transactions"), {
                  method: "POST",
                  headers: serviceHeaders(),
                  body: JSON.stringify({
                    user_id: order.companion_id,
                    order_id: order.id,
                    transaction_type: "refund",
                    amount: claw,
                    status: "completed",
                    note: note || "订单退款扣回陪玩收入（待周五退款）",
                    created_at: nowIso(),
                  }),
                });
              }
            }
          } catch (e) {
            /* keep approve even if clawback insert fails */
          }
        }
        let reward = null;
        try {
          reward = await (await import("./_cs-commission-settle.js")).clawbackCsOrderIncome(
            { ...order, status: "refund_requested" },
            { reason: note || "订单退款入周五队列，扣回奖励", mode: "refund" }
          );
        } catch (_) {}
        return json(res, 200, {
          ok: true,
          message: "已批准进入周五退款队列（不会即时到账）。后台打款完成并上传凭证后，老板才会收到退款。",
          order: patched,
          refund: result.refund,
          reward,
        });
      }
      const rejectResult = await refundApi.csSuggestRefund(companionDb, {
        refundId: refundRow.id,
        decision: "reject",
        note,
        csProfile: service.profile,
      });
      const restore = ["in_progress", "completed", "cancelled"].includes(String(body.restore_status))
        ? String(body.restore_status)
        : "in_progress";
      const patched = await patchOrder(order.id, { status: restore, customer_service_id: service.profile.id });
      return json(res, 200, {
        ok: true,
        message: "退款已拒绝。",
        order: patched,
        refund: rejectResult.refund,
      });
    }
    if (action === "submit_report") { return json(res, 400, { ok: false, message: "客服不能自行填写应付工资。请使用「申请本周结算」，金额由系统自动计算。" }); }
    if (
      action === "request_salary_withdraw" ||
      action === "request_withdraw" ||
      action === "apply_salary" ||
      action === "request_payroll" ||
      action === "apply_payroll_settlement"
    ) {
      const workApi = await import("./_customer-service-work.js");
      const {
        computeSettlementDate,
        mergeWeeklySettings,
        viewWeeklyRules,
        statusText: payoutStatusText,
      } = await import("./_weekly-settlement.js");
      const {
        loadFinanceWeeklySettings,
        lockPayoutSources,
        upsertPayoutRequest,
      } = await import("./_payout-requests.js");
      const { companionDb } = await import("./_companion-media-store.js");

      const work = await workApi.loadServiceWorkData(service.profile.id);
      const estimated = money(work?.summary?.estimatedSalary || work?.salary?.current?.totalSalary || 0);
      const payrollsRaw = await maybeRows(
        "staff_payrolls",
        `?staff_id=eq.${encodeURIComponent(service.profile.id)}&order=created_at.desc&limit=100`
      );
      const activeStatuses = new Set([
        "draft",
        "submitted",
        "pending_friday",
        "reviewing",
        "pending",
        "pending_review",
        "approved",
        "pending_payment",
        "approved_pending_pay",
        "paying",
        "paid_pending_receipt",
        "paid",
        "completed",
        "rolled_over",
      ]);
      const month = String(new Date().toISOString()).slice(0, 7);
      const locked = (payrollsRaw || [])
        .filter((p) => activeStatuses.has(String(p.status || "")) && String(p.period_start || "").slice(0, 7) === month)
        .reduce((sum, p) => sum + money(p.net_salary_rm), 0);
      const amount = Math.max(0, money(estimated - locked));
      if (amount <= 0) {
        return json(res, 400, {
          ok: false,
          message: "当前无可申请工资（工资中心实时计算为 0 或本月已申请/冻结）。",
          amount: 0,
          estimated,
          locked,
        });
      }
      // Reject any client-supplied amount — must use wage-center calculation only.
      if (body.amount != null && Math.abs(money(body.amount) - amount) > 0.009) {
        return json(res, 400, {
          ok: false,
          message: `提现金额必须等于工资中心实时计算值 RM ${amount}，不可人工修改。`,
          amount,
        });
      }

      const openDup = (payrollsRaw || []).find(
        (r) =>
          activeStatuses.has(String(r.status || "")) &&
          String(r.period_start || "").slice(0, 7) === month &&
          !/completed|rejected|cancelled|pay_failed/.test(String(r.status || ""))
      );
      if (openDup && /pending_friday|reviewing|pending_review|pending|submitted|rolled_over|approved|pending_payment|paying|paid/.test(String(openDup.status || ""))) {
        return json(res, 409, {
          ok: false,
          message: `本周期已有结算单 ${openDup.payroll_no || openDup.id}（${payoutStatusText(openDup.status)}），不可重复申请。`,
          payrollId: openDup.id,
          settlementDate: openDup.settlement_date || "",
        });
      }

      // Block CS payroll while this CS owns open Friday refund queues (commission may still claw)
      try {
        const openRefunds = await companionDb(
          "boss_refund_requests",
          `?assigned_cs_id=eq.${encodeURIComponent(service.profile.id)}&status=in.(pending_review,approved_for_payout,included_in_batch,processing,carried_forward)&select=id&limit=5`
        ).catch(() => []);
        if ((openRefunds || []).length) {
          return json(res, 400, {
            ok: false,
            message: "你名下仍有待周五退款的订单，相关提成可能冲减中。请等待退款打款完成或冲减落账后再申请工资。",
          });
        }
      } catch {
        /* keep apply path available if refund table missing */
      }

      const draft = await workApi.payrollDraftFromAttendance(service.profile.id);
      const weeklyCfg = await loadFinanceWeeklySettings(companionDb).catch(() => mergeWeeklySettings({}));
      const settlementDate = computeSettlementDate(new Date(), weeklyCfg);
      const periodKey = `cs-payroll:${service.profile.id}:${String(draft.periodStart).slice(0, 7)}`;
      const salary = draft.salary || {};
      const commissionRm = money(salary.orderCommission || 0);
      let catFoodRewardRm = 0;
      try {
        const rewards = await maybeRows(
          "cs_dock_rewards",
          `?service_id=eq.${encodeURIComponent(service.profile.id)}&status=eq.settled&limit=500`
        );
        catFoodRewardRm = (rewards || []).reduce((s, r) => s + money(r.amount_cat_food || r.amount_rm), 0);
      } catch {
        catFoodRewardRm = 0;
      }
      const wageBreakdown = {
        baseSalaryRm: money(draft.baseSalaryRm),
        commissionRm,
        catFoodRewardRm,
        receptionBonus: money(salary.receptionBonus),
        attendanceBonus: money(salary.attendanceBonus),
        nightShiftAllowance: money(salary.nightShiftAllowance),
        otherAdjustment: money(salary.otherAdjustment),
        deductionRm: money(draft.deductionRm),
        netSalaryRm: amount,
        autoCalculated: true,
        fromWageCenter: true,
      };
      const payrollNo = `PAYROLL-CS-${Date.now().toString(36).toUpperCase()}`;
      const insertPayload = {
        payroll_no: payrollNo,
        staff_id: service.profile.id,
        period_start: draft.periodStart,
        period_end: draft.periodEnd,
        work_days: draft.workDays || 0,
        full_attendance: !!draft.fullAttendance,
        reception_count: draft.receptionCount || 0,
        order_count: 0,
        base_salary_rm: money(draft.baseSalaryRm),
        bonus_rm: money(draft.bonusRm),
        deduction_rm: money(draft.deductionRm),
        net_salary_rm: amount,
        commission_rm: commissionRm,
        cat_food_reward_rm: catFoodRewardRm,
        wage_breakdown: wageBreakdown,
        note: `客服申请周结（工资中心实时计算 RM ${amount}，预计发放 ${settlementDate}）`,
        status: "pending_friday",
        settlement_date: settlementDate,
        source_ledger_ids: [periodKey],
        frozen_amount_rm: amount,
        submitted_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      let inserted = null;
      try {
        inserted = await supabaseJson(restUrl("staff_payrolls"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify(insertPayload),
        });
      } catch (err) {
        const msg = `${err?.message || ""}`;
        if (/Could not find the '/i.test(msg)) {
          delete insertPayload.commission_rm;
          delete insertPayload.cat_food_reward_rm;
          delete insertPayload.wage_breakdown;
          delete insertPayload.settlement_date;
          delete insertPayload.source_ledger_ids;
          delete insertPayload.frozen_amount_rm;
          insertPayload.status = "pending_review";
          try {
            inserted = await supabaseJson(restUrl("staff_payrolls"), {
              method: "POST",
              headers: serviceHeaders(),
              body: JSON.stringify(insertPayload),
            });
          } catch (err2) {
            return json(res, 500, { ok: false, message: err2.message || "创建工资申请失败。" });
          }
        } else {
          return json(res, 500, { ok: false, message: err.message || "创建工资申请失败。" });
        }
      }
      const item = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!item?.id) return json(res, 500, { ok: false, message: "创建工资申请失败。" });

      try {
        await lockPayoutSources(companionDb, {
          applicantId: service.profile.id,
          sources: [{ kind: "period", id: periodKey }],
          relatedTable: "staff_payrolls",
          relatedRecordId: item.id,
        });
      } catch (lockErr) {
        if (lockErr?.code === "SOURCE_LOCKED") {
          try {
            await supabaseJson(restUrl("staff_payrolls", `?id=eq.${encodeURIComponent(item.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                status: "cancelled",
                note: "重复周期锁定，已撤销",
                updated_at: nowIso(),
              }),
            });
          } catch {
            /* ignore */
          }
          return json(res, 409, { ok: false, message: lockErr.message });
        }
      }

      await upsertPayoutRequest(companionDb, {
        payoutNo: item.payroll_no || payrollNo,
        applicantType: "customer_service",
        applicantId: service.profile.id,
        applicantName: service.profile.display_name || "",
        applicantUid: service.profile.id || "",
        amount,
        currency: "MYR",
        payoutMethod: "bank",
        sourcePeriodStart: draft.periodStart,
        sourcePeriodEnd: draft.periodEnd,
        sourceLedgerIds: [periodKey],
        settlementDate,
        status: "pending_friday",
        payoutType: "cs_wage",
        relatedTable: "staff_payrolls",
        relatedRecordId: item.id,
        meta: { payout_type: "cs_wage", ...wageBreakdown },
      });

      try {
        await supabaseJson(restUrl("staff_notifications"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            staff_id: service.profile.id,
            notice_key: `payroll-submitted-${item.id}`,
            category: "payroll",
            title: "工资结算已提交",
            body: `工资单 ${item.payroll_no || payrollNo} 已进入待周五结算，应发 RM ${amount}，预计发放 ${settlementDate}。`,
            href: "/customer-service/reports/",
            created_at: nowIso(),
          }),
        });
      } catch {
        /* optional */
      }

      return json(res, 200, {
        ok: true,
        message: `已提交工资结算 RM ${amount}，进入待周五结算。预计发放日期：${settlementDate}（星期五）`,
        amount,
        settlementDate,
        weeklyRules: viewWeeklyRules(weeklyCfg),
        payroll: item,
        item: {
          id: item.id,
          payrollNo: item.payroll_no || payrollNo,
          netSalaryRm: amount,
          status: item.status || "pending_friday",
          statusText: "待周五结算",
          settlementDate,
        },
      });
    }
    if (action === "appeal_payroll") {
      const payrollId = String(body.payrollId || body.payroll_id || body.id || "").trim();
      const reason = String(body.reason || "").trim();
      if (!payrollId || !reason) return json(res, 400, { ok: false, message: "请选择工资单并填写申诉原因。" });
      const rows = await maybeRows("staff_payrolls", `?id=eq.${encodeURIComponent(payrollId)}&staff_id=eq.${encodeURIComponent(service.profile.id)}&limit=1`);
      if (!rows[0]) return json(res, 404, { ok: false, message: "工资单不存在。" });
      const inserted = await supabaseJson(restUrl("staff_payroll_appeals"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ payroll_id: payrollId, staff_id: service.profile.id, reason, status: "pending", created_at: nowIso() }),
      });
      return json(res, 200, { ok: true, message: "工资申诉已提交，等待管理员处理。", appeal: inserted[0] || null });
    }
    if (action === "urge_companion" || action === "remind_companion") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      if (String(order.status || "") !== "claimed") {
        return json(res, 400, { ok: false, message: "只有待陪玩确认的订单可以催单。" });
      }
      if (!order.companion_id) {
        return json(res, 400, { ok: false, message: "当前订单尚未指定陪玩。" });
      }
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: order.companion_id,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      const nick = String(service.profile.display_name || "").trim() || "客服";
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        `【催单提醒】客服 ${nick} 提醒陪玩尽快确认接单（订单 ${order.order_no || order.id}）。`,
        "system",
        order.id
      );
      await touchConversationActive({ restUrl, supabaseJson, serviceHeaders }, conversation?.id);
      return json(res, 200, { ok: true, message: "已发送催单提醒。" });
    }
    if (action === "return_to_grab_hall" || action === "reopen_grab_hall") {
      const order = await orderById(String(body.id || body.order_id || ""));
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      try {
        await assertOrderMutationAllowed(order, service.profile);
      } catch (err) {
        return json(res, err.status || 403, { ok: false, message: err.message || CS_LOCK_DENIED, code: err.code || "CS_SESSION_LOCKED" });
      }
      if (String(order.status || "") !== "claimed") {
        return json(res, 400, { ok: false, message: "只有待陪玩确认的订单可以返回抢单大厅。" });
      }
      const { transitionOrderStatus } = await import("./_order-status.js");
      const patch = {
        companion_id: null,
        assignment_type: "public",
        order_type: order.order_type === "direct_companion" ? "open_grab" : order.order_type || "open_grab",
        customer_service_id: service.profile.id,
        accepted_at: null,
      };
      let patched =
        (await transitionOrderStatus(
          { restUrl, supabaseJson, serviceHeaders },
          {
            orderId: order.id,
            fromStatus: "claimed",
            toStatus: "pending",
            patch,
            operatorRole: "customer_service",
            operatorId: service.profile.id,
            note: "cs return_to_grab_hall",
          }
        ).catch(() => null)) ||
        (await patchOrder(order.id, { status: "pending", ...patch }).catch(() => null));
      if (!patched) return json(res, 409, { ok: false, message: "返回抢单大厅失败，请刷新后重试。" });
      try {
        const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
        await createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders }).upsertListing(
          { ...order, ...patched, status: "pending", assignment_type: "public", companion_id: null },
          { publishedByCsId: service.profile.id }
        );
      } catch (_) {}
      const conversation = await ensureConversation({
        boss_id: order.boss_id,
        companion_id: null,
        customer_service_id: service.profile.id,
        order_id: order.id,
      });
      await addMessage(
        conversation,
        service.profile.id,
        "customer_service",
        "客服已将该订单返回抢单大厅，等待陪玩重新抢单。",
        "system",
        order.id
      );
      const profiles = await profileMap([order.boss_id, service.profile.id]);
      return json(res, 200, {
        ok: true,
        message: "已返回抢单大厅。",
        order: safeOrder({ ...order, ...patched, status: "pending", companion_id: null, assignment_type: "public" }, profiles),
      });
    }
    if (action === "apply_compensation") {
      try {
        const settings = await (await import("./_wallet.js")).getWalletSettings();
        if (settings.allow_cs_apply === false) return json(res, 403, { ok: false, message: "系统已关闭客服补偿申请。" });
        const bossInput = String(body.boss_id || body.bossId || body.bossUid || body.boss_uid || "").trim();
        const boss = await resolveBoss(bossInput);
        if (!boss || boss.role !== "boss" || !isUuid(boss.id)) return json(res, 400, { ok: false, message: "请填写真实老板 UID / UUID。" });
        const amount = money(body.suggested_amount || body.suggestedAmount || body.amount);
        const maxReq = money(settings.cs_max_per_request != null ? settings.cs_max_per_request : 100);
        if (amount <= 0) return json(res, 400, { ok: false, message: "建议补偿数量必须大于 0。" });
        if (amount > maxReq) return json(res, 400, { ok: false, message: `单笔申请不能超过 ${maxReq} 猫粮。` });
        const reason = String(body.reason || "").trim();
        if (!reason) return json(res, 400, { ok: false, message: "请填写差评或投诉原因。" });
        const today = new Date().toISOString().slice(0, 10);
        const todayRows = await maybeRows(
          "compensation_requests",
          `?applicant_id=eq.${encodeURIComponent(service.profile.id)}&created_at=gte.${encodeURIComponent(today + "T00:00:00.000Z")}&select=suggested_amount`
        );
        const todaySum = todayRows.reduce((n, r) => n + money(r.suggested_amount), 0);
        const maxDay = money(settings.cs_max_per_day != null ? settings.cs_max_per_day : 300);
        if (todaySum + amount > maxDay) return json(res, 400, { ok: false, message: `今日申请额度不足（上限 ${maxDay}）。` });
        const relatedOrderId = String(body.related_order_id || body.relatedOrderId || body.order_id || "").trim();
        if (isUuid(relatedOrderId)) {
          const related = await orderById(relatedOrderId);
          if (!related) return json(res, 400, { ok: false, message: "关联订单不存在。" });
          const st = String(related.status || "");
          if (!["in_progress", "confirmed", "completed"].includes(st)) {
            return json(res, 400, { ok: false, message: "仅进行中或已完成的订单可申请补偿。" });
          }
        }
        const rows = await supabaseJson(restUrl("compensation_requests"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            boss_id: boss.id,
            related_order_id: isUuid(relatedOrderId) ? relatedOrderId : null,
            request_type: String(body.request_type || body.requestType || "bad_review"),
            suggested_amount: amount,
            balance_type: "bonus",
            reason,
            staff_note: String(body.staff_note || body.staffNote || body.note || ""),
            evidence_urls: String(body.evidence_urls || body.evidenceUrls || ""),
            status: "pending",
            applicant_id: service.profile.id,
            notify_boss: body.notify_boss !== false,
            created_at: nowIso(),
          }),
        });
        return json(res, 200, { ok: true, message: "补偿申请已提交，等待管理员审核。", request: rows[0] || null });
      } catch (error) {
        const real = String(error?.message || error || "").trim();
        const text = `${real} ${JSON.stringify(error?.body || "")}`;
        if (error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text)) {
          // Do NOT swallow the real Supabase error. Compensation failure must not break CS bootstrap/dashboard.
          return json(res, 503, {
            ok: false,
            message:
              "补偿申请表 public.compensation_requests 不存在。请到 Supabase SQL Editor 执行 supabase/service-compensation.sql 后再提交。" +
              (real ? `（Supabase：${real}）` : ""),
            supabaseMessage: real || null,
            table: "compensation_requests",
            sqlFile: "supabase/service-compensation.sql",
          });
        }
        throw error;
      }
    }
    return json(res, 400, { ok: false, message: "未知客服端操作。" }); } catch (error) { return json(res, error.status || 500, { ok: false, message: error.message || "客服端接口异常。" }); } }
export default handler;
