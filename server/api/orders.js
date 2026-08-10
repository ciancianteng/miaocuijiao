import fs from "node:fs";
import path from "node:path";
import { assertBossProfile, identityView } from "./_boss-identity.js";
import { resolvePlatformCommission } from "./_commission-rates.js";
import { readLocalLevels } from "./_companion-levels-store.js";
import { priceForGame } from "./_game-prices.js";
import {
  ORDER_STATUS_LABELS,
  allowPreviewTestPay,
  bossFacingStatusText,
  normalizeOrderStatus,
  orderStatusLabel,
  writeOrderStatusLog,
  transitionOrderStatus,
} from "./_order-status.js";
import { evaluatePublishGate } from "./_companion-publish-gate.js";
import { allocateOrderNo, resolveOrderPublicNo } from "./_account-codes.js";
import { companionDb } from "./_companion-media-store.js";
import { listPendingForCs, latestRejectedForOrders, latestApprovedForOrders, signedProofUrl, uploadProof, receiptReviewerFields } from "./_payment-receipts.js";
import { loadPlatformPayQr, listBossOrderPaymentMethods, normalizePaymentChannelId, isWalletPayEnabled, loadPaymentChannelsContext } from "./_platform-pay-qr.js";
import { stripInternalOrderMarkers } from "./_order-grabs.js";
import {
  completionCountdown,
  formatRemainingLabel,
  parseCompletionMethod,
  createOrderCompleteHelpers,
} from "./_order-complete.js";

loadLocalEnv();

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}
function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "orders";
const STATUS_TEXT = ORDER_STATUS_LABELS;
const ORDER_TYPE_TEXT = {
  customer_service: "客服派单",
  direct_companion: "指定陪玩",
  open_grab: "公开抢单",
  custom: "自定义订单",
  gameplay_mall: "固定玩法订单",
  gameplay: "固定玩法订单"
};

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => envValue(key)); }
function anonHeaders(extra = {}) { return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
}
function restUrl(table, query = "") { return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`; }
function authUrl(path) { return `${envValue("SUPABASE_URL")}/auth/v1/${path}`; }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }

/** Load companion pricing row; omit optional columns that may be missing in older schemas. */
async function loadCompanionPricingRow(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  // Prefer wide select, but never fall all the way to price-only — publish gate needs profile fields.
  const selects = [
    "id,user_id,price,game_prices,tags,game,main_service,service_ids,pricing_unit,nickname,age,gender,region,service_type,voice_url,card_image_url,application_status,verification_status,deposit_status,allow_orders,online_status,availability_status",
    "id,user_id,price,game_prices,tags,game,main_service,service_ids,nickname,age,gender,region,service_type,voice_url,card_image_url,application_status,verification_status,allow_orders,online_status,availability_status",
    "id,user_id,price,game_prices,tags,game,main_service,nickname,age,gender,region,service_type,voice_url,card_image_url,application_status,verification_status,allow_orders,online_status",
    "id,user_id,price,tags,game,nickname,age,gender,region,voice_url,card_image_url,application_status,verification_status,allow_orders,online_status",
    "id,user_id,price,game,nickname,application_status,verification_status,allow_orders,online_status",
  ];
  for (const select of selects) {
    try {
      const rows = await supabaseJson(
        restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}&select=${select}&limit=1`),
        { headers: serviceHeaders() }
      );
      if (Array.isArray(rows) && rows[0]) return rows[0];
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (!/42703|column|schema cache|PGRST204|does not exist/i.test(msg)) throw error;
    }
  }
  return null;
}

async function loadCompanionMediaExtras(companionProfileId) {
  const pid = String(companionProfileId || "").trim();
  if (!pid) return {};
  try {
    const rows = await supabaseJson(
      restUrl(
        "companion_media",
        `?companion_profile_id=eq.${encodeURIComponent(pid)}&media_type=in.(avatar,cover,gallery,voice)&select=id,media_type,storage_path,status&limit=50`
      ),
      { headers: serviceHeaders() }
    );
    const list = Array.isArray(rows) ? rows : [];
    const extras = { avatarUrl: "", voiceUrl: "", gallery: [] };
    for (const row of list) {
      if (row.status && /rejected|deleted/i.test(String(row.status))) continue;
      // Presence markers only — publish gate checks existence, not durable public URLs.
      if (row.media_type === "avatar" && (row.storage_path || row.id)) {
        extras.avatarUrl = "storage://present/" + (row.storage_path || row.id);
      }
      if (row.media_type === "voice" && (row.storage_path || row.id)) {
        extras.voiceUrl = "storage://present/" + (row.storage_path || row.id);
      }
      if (row.media_type === "gallery") {
        extras.gallery.push({ id: row.id, url: row.storage_path || String(row.id) });
      }
    }
    return extras;
  } catch {
    return {};
  }
}

async function assertCompanionOrderable(companionUserId) {
  const cp = await loadCompanionPricingRow(companionUserId);
  if (!cp) return { ok: false, message: "指定陪玩不存在或不可下单。" };
  let profile = null;
  try {
    const rows = await supabaseJson(
      restUrl("profiles", `?id=eq.${encodeURIComponent(companionUserId)}&select=id,display_name,avatar_url,status,role&limit=1`),
      { headers: serviceHeaders() }
    );
    profile = Array.isArray(rows) ? rows[0] : null;
  } catch {
    profile = null;
  }
  const mediaExtras = await loadCompanionMediaExtras(cp.id);
  const gate = evaluatePublishGate(
    cp,
    profile || { role: "companion", status: "active", display_name: cp.nickname, avatar_url: "" },
    mediaExtras
  );
  if (!gate.ok) {
    return {
      ok: false,
      message: gate.statusLabel === "资料不完整"
        ? "该陪玩资料未完善，暂不可下单"
        : gate.statusLabel === "待审核"
          ? "该陪玩尚未通过审核，暂不可下单"
          : `该陪玩暂不可下单（${gate.statusLabel}）`,
      gate,
      cp,
    };
  }
  const online = String(cp.availability_status || cp.online_status || "offline").toLowerCase();
  if (online === "paused") {
    return { ok: false, message: "该陪玩已暂停接单，请稍后再试", gate, cp };
  }
  if (online === "offline") {
    return { ok: false, message: "该陪玩当前离线，暂不可下单", gate, cp };
  }
  return { ok: true, gate, cp, online };
}

/** Resolve profiles.id / companion_profiles.id / PW code → profiles user id. */
async function resolveCompanionUserId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  try {
    const byUser = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&role=eq.companion&select=id&limit=1`), {
      headers: serviceHeaders(),
    });
    if (Array.isArray(byUser) && byUser[0]?.id) return byUser[0].id;
  } catch {
    /* continue */
  }
  try {
    const byCpId = await supabaseJson(
      restUrl("companion_profiles", `?id=eq.${encodeURIComponent(id)}&select=user_id&limit=1`),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(byCpId) && byCpId[0]?.user_id) return byCpId[0].user_id;
  } catch {
    /* continue */
  }
  const code = id.toUpperCase();
  if (/^PW\d+$/i.test(code) || /^P\d+$/i.test(code)) {
    try {
      const byCode = await supabaseJson(
        restUrl("companion_profiles", `?companion_code=eq.${encodeURIComponent(code)}&select=user_id&limit=1`),
        { headers: serviceHeaders() }
      );
      if (Array.isArray(byCode) && byCode[0]?.user_id) return byCode[0].user_id;
    } catch {
      /* column may be missing */
    }
    const digits = code.replace(/^PW0*/i, "").replace(/^P0*/i, "");
    if (digits) {
      try {
        const byUid = await supabaseJson(
          restUrl("companion_profiles", `?companion_uid=eq.${encodeURIComponent(digits)}&select=user_id&limit=1`),
          { headers: serviceHeaders() }
        );
        if (Array.isArray(byUid) && byUid[0]?.user_id) return byUid[0].user_id;
      } catch {
        /* continue */
      }
    }
  }
  return id;
}
function nowIso() { return new Date().toISOString(); }
async function nextOrderNo() {
  try {
    return await allocateOrderNo(companionDb);
  } catch {
    return `MCJO${String(Date.now()).slice(-6)}`;
  }
}
function paymentMethodLabel(method) {
  const key = String(method || "").toLowerCase();
  if (/duitnow/.test(key)) return "DuitNow";
  if (/tng/.test(key)) return "TNG";
  if (/bank|银行/.test(key)) return "银行卡";
  if (/alipay|支付宝/.test(key)) return "支付宝";
  if (/stripe/.test(key)) return "Stripe";
  if (/hitpay/.test(key)) return "HitPay";
  if (/cat.?food|wallet|猫粮|余额/.test(key)) return "猫粮余额";
  return method || "猫粮余额";
}
function isWalletMethod(method) {
  return /cat.?food|wallet|猫粮|余额/.test(String(method || "").toLowerCase());
}
function isPreviewTestMethod(method) {
  return /tng|duitnow|bank|银行|card|银行卡|alipay|支付宝|hitpay|stripe|toyyib/.test(String(method || "").toLowerCase());
}

async function assertOrderPaymentMethodAllowed(paymentMethod) {
  const raw = String(paymentMethod || "").trim();
  if (!raw) return { ok: false, message: "请选择支付方式" };
  if (isWalletMethod(raw)) {
    const ctx = await loadPaymentChannelsContext();
    if (!isWalletPayEnabled(ctx.platformData, ctx.publicMap, ctx.byId)) {
      return { ok: false, message: "余额支付暂未开放，请选择其他支付方式" };
    }
    return { ok: true, code: "catfood" };
  }
  const listed = await listBossOrderPaymentMethods([]);
  const code = normalizePaymentChannelId(raw) || raw.toLowerCase();
  const hit = (listed.methods || []).find((m) => m.code === code || m.id === code || m.code === raw || m.id === raw);
  if (!hit || hit.open === false) {
    return { ok: false, message: "该支付方式暂未开放，请选择其他支付方式" };
  }
  return { ok: true, code: hit.code || code };
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail =
      body?.error_description ||
      body?.message ||
      body?.hint ||
      body?.details ||
      (typeof body === "string" ? body : "") ||
      "";
    const code = body?.code ? ` [${body.code}]` : "";
    const err = new Error((detail ? `${detail}${code}` : `Supabase 请求失败${code} (HTTP ${response.status})`) || "Supabase 请求失败");
    err.status = response.status;
    err.code = body?.code || "";
    err.body = body;
    throw err;
  }
  return body;
}
function isMissingWalletRpc(error) {
  const text = `${error?.message || ""} ${error?.code || ""} ${JSON.stringify(error?.body || {})}`;
  return (
    error?.status === 404 ||
    /Could not find the function|schema cache|PGRST202|function .* does not exist|mcj_wallet_debit/i.test(text)
  );
}
function isWalletBalanceError(error) {
  const text = String(error?.message || "");
  return /余额不足|insufficient balance|wallet is frozen|账户冻结|钱包冻结/i.test(text);
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}
async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录后查看我的订单。"), { status: 401, code: "NO_SESSION" });
  const authUser = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  if (!authUser?.id) throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401, code: "EXPIRED" });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号资料加载失败，请重试。"), { status: 403, code: "NO_PROFILE" });
  const boss = await assertBossProfile(profile, {
    lookupOwnedOrder: async (bossId) => {
      const owned = await supabaseJson(
        restUrl(TABLE, `?boss_id=eq.${encodeURIComponent(bossId)}&select=id&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      return !!(Array.isArray(owned) && owned[0]);
    },
  });
  boss._identity = identityView(boss, authUser);
  return boss;
}
function bossHint(row = {}) {
  const status = row.status || "";
  const note = String(row.note || row.cancel_reason || "");
  const reviewerName = String(row.paymentReviewedByName || "").trim();
  if (status === "awaiting_payment") {
    // Source of truth: pending payment_receipts row (not leftover note markers).
    if (row.paymentReceipt) return "付款凭证已提交，等待人工审核。";
    if (row.paymentRejectReason) {
      return reviewerName
        ? `付款凭证未通过（审核客服：${reviewerName}）：${row.paymentRejectReason}。请重新上传。`
        : `付款凭证已驳回：${row.paymentRejectReason}。请重新上传。`;
    }
    return "请尽快完成付款并上传凭证。";
  }
  if (status === "claimed") {
    return reviewerName
      ? `已由客服 ${reviewerName} 审核通过，正在等待陪玩确认接单`
      : "订单已付款，正在等待陪玩确认接单";
  }
  if (status === "confirmed" || status === "in_progress") {
    if (
      String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
      String(row.description || "").includes("[[COMPLETION_PENDING]]")
    ) {
      const cd = completionCountdown(row);
      if (cd.autoConfirmPaused) return cd.autoConfirmPausedReason || "订单问题处理中，自动确认已暂停。";
      const left = formatRemainingLabel(cd.autoConfirmRemainingMs);
      return left
        ? `陪玩已申请完成，请确认本次服务。若没有问题，系统将在 ${left} 后自动确认完成。`
        : "陪玩已申请完成，请确认本次服务。";
    }
    return reviewerName ? `付款已由客服 ${reviewerName} 审核通过，服务进行中` : "服务进行中";
  }
  if (status === "pending" && /陪玩确认超时|确认超时/.test(note)) return "陪玩暂未响应，客服正在处理中";
  if (status === "pending" && /无法接单|拒单/.test(note)) return "陪玩暂时无法接单，订单已重新进入抢单大厅";
  if (status === "pending") {
    return reviewerName
      ? `已由客服 ${reviewerName} 审核通过，待派单/抢单。`
      : "付款已确认，待客服处理派单。";
  }
  if (status === "waiting_boss_confirm") return "已有陪玩抢单，请选择一位";
  if ((status === "completed" || status === "reviewed") && reviewerName) {
    return `付款已由客服 ${reviewerName} 审核通过`;
  }
  return "";
}
function paymentStatusLabel(row = {}) {
  const s = row.status || "";
  if (s === "awaiting_payment") {
    return row.paymentReceipt ? "待人工审核" : "待付款";
  }
  if (s === "cancelled") return "已取消";
  return "已付款";
}
function acceptStatusLabel(row = {}) {
  const s = row.status || "";
  const note = String(row.note || row.cancel_reason || "");
  if (s === "awaiting_payment") return "尚未付款";
  if (s === "claimed") return "等待陪玩确认";
  if (s === "confirmed" || s === "in_progress") return "进行中";
  if (s === "waiting_boss_confirm") return "等待老板选择";
  if (s === "completed" || s === "reviewed") return "已完成";
  if (s === "pending" && /陪玩确认超时|确认超时/.test(note)) return "陪玩确认超时";
  if (s === "pending" && /无法接单|拒单/.test(note)) return "陪玩无法接单，等待重新安排";
  if (s === "pending") return "待客服处理";
  if (s === "cancelled") return "已取消";
  return bossFacingStatusText(row);
}
function viewOrder(row = {}) {
  const reviewed = !!(row.reviewed || row.review_id || row.reviewId);
  const status = reviewed && row.status === "completed" ? "reviewed" : row.status || "awaiting_payment";
  const description = String(row.description || "");
  const gameIdFromDesc = (description.match(/游戏ID[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const payFromDesc = (description.match(/付款方式[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const companionFromDesc = (description.match(/指定陪玩[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const notesFromDesc = description.split("\n")[0] || "";
  const serviceName = String(row.service_name || row.serviceName || row.game || row.title || "").trim();
  const gameId = String(row.game_id_value || row.game_id || row.gameId || gameIdFromDesc || "").trim();
  const paymentMethodRaw = String(row.payment_method || row.paymentMethod || payFromDesc || "").trim();
  const paymentMethod =
    normalizePaymentChannelId(paymentMethodRaw) ||
    (/duitnow/i.test(paymentMethodRaw)
      ? "duitnow"
      : /tng/i.test(paymentMethodRaw)
        ? "tng"
        : /alipay|支付宝/i.test(paymentMethodRaw)
          ? "alipay"
          : /bank|银行/i.test(paymentMethodRaw)
            ? "bank-transfer"
            : paymentMethodRaw);
  const companionName =
    (row.companion && (row.companion.display_name || row.companion.nickname || row.companion.email)) ||
    row.companion_name ||
    row.companionName ||
    companionFromDesc ||
    "";
  const bossNotes = String(row.notes || "").trim() || notesFromDesc;
  const completionPending =
    String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
    String(row.description || "").includes("[[COMPLETION_PENDING]]");
  const countdown = completionCountdown(row);
  const grabCount = Array.isArray(row.grabs)
    ? row.grabs.length
    : Number(row.grabCount != null ? row.grabCount : row.grab_count || 0) || 0;
  let statusText = bossFacingStatusText({ ...row, status, grabs: row.grabs }, grabCount);
  if (status === "in_progress" && completionPending) {
    statusText = countdown.autoConfirmPaused ? "等待处理订单问题" : "等待您确认完成";
  }
  if ((status === "pending" || status === "waiting_boss_confirm") && grabCount > 0) {
    statusText = `已有 ${grabCount} 位陪玩抢单（点击查看）`;
  }
  const bossIntent = row.bossIntent || null;
  const flowStatus =
    row.flowStatus ||
    ({
      awaiting_payment: "draft",
      pending: "pending_grab",
      waiting_boss_confirm: "selecting",
      claimed: "pending_companion_confirm",
      confirmed: "confirmed",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    }[status] || status);
  // Pending receipt only — leftover [[PAYMENT_PROOF]] notes must not keep 待人工审核 after reject.
  const paymentReview = status === "awaiting_payment" && !!row.paymentReceipt;
  if (paymentReview && status === "awaiting_payment") {
    statusText = "待人工审核";
  } else if (status === "awaiting_payment" && row.paymentRejectReason) {
    statusText = "待付款";
  }
  const cleanDescription = stripInternalOrderMarkers(description);
  const cleanNote = stripInternalOrderMarkers(String(row.note || ""));
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    order_no: row.order_no || row.id,
    bossId: row.boss_id || "",
    companionId: row.companion_id || "",
    companionName,
    customerServiceId: row.customer_service_id || "",
    orderType: ORDER_TYPE_TEXT[row.order_type] || row.order_type || "自定义订单",
    orderTypeKey: row.order_type || "custom",
    game: row.game || "",
    title: row.title || "",
    description: cleanDescription,
    notes: bossNotes,
    bossNotes,
    serviceType: serviceName || row.game || "",
    serviceName: serviceName || row.game || "",
    gameId,
    game_id: gameId,
    paymentMethod: paymentMethod || "线下确认",
    payment_method: paymentMethod || "线下确认",
    hours: Number(row.hours || 0),
    unitPrice: money(row.unit_price),
    totalAmount: money(row.total_amount),
    amount: money(row.total_amount),
    paidCatFood: money(row.paid_cat_food || (status !== "awaiting_payment" && status !== "cancelled" ? row.total_amount : 0)),
    status,
    dbStatus: row.status || "awaiting_payment",
    flowStatus,
    statusText,
    completionPending,
    completionRequestedAt: countdown.completionRequestedAt || "",
    autoConfirmAt: countdown.autoConfirmAt || "",
    autoConfirmRemainingMs: countdown.autoConfirmRemainingMs,
    autoConfirmRemainingLabel: formatRemainingLabel(countdown.autoConfirmRemainingMs),
    autoConfirmPaused: !!countdown.autoConfirmPaused,
    autoConfirmPausedReason: countdown.autoConfirmPausedReason || "",
    completionMethod: parseCompletionMethod(row) || "",
    grabs: row.grabs || [],
    grabCount,
    bossIntent,
    preferredCompanionId: bossIntent?.companionId || "",
    paymentStatus: paymentStatusLabel(row),
    acceptStatus: acceptStatusLabel(row),
    paymentReview,
    paymentProofUrl: row.paymentProofUrl || "",
    paymentRejectReason: row.paymentRejectReason || "",
    paymentReviewedAt: row.paymentReviewedAt || "",
    paymentReviewedByName: row.paymentReviewedByName || "",
    paymentReviewedByStaffId: row.paymentReviewedByStaffId || "",
    paymentReviewStatus: row.paymentReviewStatus || "",
    paidAt: row.paid_at || row.paidAt || "",
    bossHint: bossHint(row),
    cancelReason: row.cancel_reason || "",
    note: cleanNote,
    reviewed,
    reviewId: row.review_id || row.reviewId || "",
    reviewRating: row.review_rating != null ? Number(row.review_rating) : null,
    reviewContent: row.review_content || "",
    canReview: row.status === "completed" && !reviewed && !!row.companion_id,
    createdAt: row.created_at || "",
    acceptedAt: row.accepted_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    cancelledAt: row.cancelled_at || "",
    companion: row.companion
      ? { ...row.companion, display_name: row.companion.display_name || companionName || row.companion.email }
      : companionName
        ? { display_name: companionName }
        : null,
    customerService: row.customerService || null
  };
}
async function loadOrders(profile, id = "") {
  try {
    const { expireCompanionConfirmTimeouts } = await import("./_order-confirm-timeout.js");
    await Promise.race([
      expireCompanionConfirmTimeouts({ limit: 30 }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* best-effort SLA — never block boss list */
  }
  try {
    const helpers = createOrderCompleteHelpers({
      restUrl,
      supabaseJson,
      serviceHeaders,
      addSystemMessage: async (order, actorId, content) => addSystemMessage(order, actorId || order.boss_id, content),
    });
    await Promise.race([
      helpers.expireCompletionAutoConfirms({ limit: 20 }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    /* best-effort auto-complete */
  }
  // Core columns always include description (completion-pending marker dual-writes here).
  // note is preferred for markers; cancel_reason is optional — never drop note when cancel_reason is missing.
  const selectCore =
    "id,order_no,boss_id,companion_id,customer_service_id,order_type,game,title,description,hours,unit_price,total_amount,status,created_at,accepted_at,started_at,completed_at,cancelled_at";
  const selectWithNote = selectCore + ",note";
  const selectRich = selectWithNote + ",cancel_reason";
  if (id) {
    // Ownership check first — foreign order id must not leak existence details as 200 empty.
    let probe;
    try {
      probe = await supabaseJson(
        restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&select=id,boss_id&limit=1`),
        { headers: serviceHeaders() }
      );
    } catch {
      probe = [];
    }
    const hit = Array.isArray(probe) ? probe[0] : null;
    if (!hit) {
      throw Object.assign(new Error("订单不存在。"), { status: 404, code: "ORDER_NOT_FOUND" });
    }
    if (String(hit.boss_id || "") !== String(profile.id || "")) {
      throw Object.assign(new Error("无权限查看该订单。"), { status: 403, code: "FORBIDDEN_ORDER" });
    }
  }
  const queryOf = (sel) =>
    id
      ? `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&select=${sel}&order=created_at.desc&limit=1`
      : `?boss_id=eq.${encodeURIComponent(profile.id)}&select=${sel}&order=created_at.desc&limit=80`;
  let rows;
  try {
    rows = await supabaseJson(restUrl(TABLE, queryOf(selectRich)), { headers: serviceHeaders() });
  } catch (err) {
    if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    try {
      rows = await supabaseJson(restUrl(TABLE, queryOf(selectWithNote)), { headers: serviceHeaders() });
    } catch (err2) {
      if (!/column|schema cache|PGRST/i.test(String(err2?.message || ""))) throw err2;
      rows = await supabaseJson(restUrl(TABLE, queryOf(selectCore)), { headers: serviceHeaders() });
    }
  }
  const orders = Array.isArray(rows) ? rows : [];
  const companionIds = [...new Set(orders.map((row) => row.companion_id).filter(Boolean))];
  const serviceIds = [...new Set(orders.map((row) => row.customer_service_id).filter(Boolean))];
  const orderIds = orders.map((row) => row.id).filter(Boolean);

  const [companions, services, reviews] = await Promise.all([
    companionIds.length
      ? supabaseJson(
          restUrl("profiles", `?id=in.(${companionIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,avatar_url,role`),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
    serviceIds.length
      ? supabaseJson(
          restUrl("profiles", `?id=in.(${serviceIds.map(encodeURIComponent).join(",")})&select=id,display_name,email,role`),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
    orderIds.length
      ? supabaseJson(
          restUrl(
            "companion_reviews",
            `?order_id=in.(${orderIds.map(encodeURIComponent).join(",")})&boss_id=eq.${encodeURIComponent(profile.id)}&select=id,order_id,rating,content,created_at&order=created_at.desc&limit=200`
          ),
          { headers: serviceHeaders() }
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const companionMap = Object.fromEntries((companions || []).map((p) => [p.id, p]));
  const serviceMap = Object.fromEntries((services || []).map((p) => [p.id, p]));
  const reviewByOrder = {};
  for (const rev of Array.isArray(reviews) ? reviews : []) {
    if (rev?.order_id && !reviewByOrder[rev.order_id]) reviewByOrder[rev.order_id] = rev;
  }
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const { enrichGrabCompanions, parseBossIntent, toFlowStatus, isOrderExpired } = await import("./_order-flow.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });

  const grabEligible = orders.filter((row) =>
    ["waiting_boss_confirm", "pending", "claimed", "confirmed"].includes(row.status)
  );
  const grabNoteMap = Object.fromEntries(grabEligible.map((row) => [row.id, row.note || row.description || ""]));
  const grabMapRaw = await grabsApi.listGrabsBatch(
    grabEligible.map((row) => row.id),
    grabNoteMap
  );
  const allGrabsFlat = grabEligible.flatMap((row) => grabMapRaw[row.id] || []);
  const enrichedAll = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, allGrabsFlat).catch(() => allGrabsFlat);
  const enrichedById = Object.fromEntries((enrichedAll || []).map((g) => [String(g.id || g.grabId || `${g.orderId}:${g.companionId}`), g]));

  async function grabsFor(row) {
    if (!["waiting_boss_confirm", "pending", "claimed", "confirmed"].includes(row.status)) return [];
    try {
      const grabs = grabMapRaw[row.id] || [];
      const intent = parseBossIntent(row);
      return grabs.map((g) => {
        const key = String(g.id || g.grabId || `${g.orderId}:${g.companionId}`);
        const enriched = enrichedById[key] || g;
        return {
          ...enriched,
          companion: enriched.companion
            ? { ...enriched.companion, bossPreferred: !!(intent && intent.companionId === enriched.companionId) }
            : null,
          bossPreferred: !!(intent && intent.companionId === enriched.companionId),
        };
      });
    } catch {
      return [];
    }
  }

  // Parallelize grab enrichment so list GET stays under Preview cold-start budgets.
  const grabLists = await Promise.all(orders.map((row) => grabsFor(row)));
  let receiptByOrder = {};
  let proofUrlByOrder = {};
  let rejectedByOrder = {};
  let approvedByOrder = {};
  const awaitingIds = orders.filter((row) => row.status === "awaiting_payment").map((row) => row.id).filter(Boolean);
  const paidIds = orders
    .filter((row) => row.status && row.status !== "awaiting_payment" && row.status !== "cancelled")
    .map((row) => row.id)
    .filter(Boolean);
  if (awaitingIds.length || paidIds.length) {
    try {
      if (awaitingIds.length) {
        const receipts = await listPendingForCs({ orderIds: awaitingIds });
        receiptByOrder = Object.fromEntries((receipts || []).map((receipt) => [receipt.order_id, receipt]));
        const pairs = await Promise.all(
          (receipts || []).map(async (receipt) => [receipt.order_id, (await signedProofUrl(receipt).catch(() => "")) || ""])
        );
        proofUrlByOrder = Object.fromEntries(pairs);
        const needReject = awaitingIds.filter((oid) => !receiptByOrder[oid]);
        if (needReject.length) rejectedByOrder = await latestRejectedForOrders(needReject);
      }
      if (paidIds.length) {
        approvedByOrder = await latestApprovedForOrders(paidIds);
        const approvedPairs = await Promise.all(
          Object.values(approvedByOrder).map(async (receipt) => [
            receipt.order_id,
            (await signedProofUrl(receipt).catch(() => "")) || "",
          ])
        );
        for (const [oid, url] of approvedPairs) {
          if (url && !proofUrlByOrder[oid]) proofUrlByOrder[oid] = url;
        }
      }
    } catch {
      receiptByOrder = {};
      proofUrlByOrder = {};
      rejectedByOrder = {};
      approvedByOrder = {};
    }
  }
  return orders.map((row, index) => {
    const rev = reviewByOrder[row.id];
    const grabs = grabLists[index] || [];
    const intent = parseBossIntent(row);
    const receipt = receiptByOrder[row.id] || null;
    const rejected = rejectedByOrder[row.id] || null;
    const approved = approvedByOrder[row.id] || null;
    const reviewSrc = approved || rejected || null;
    const reviewFields = reviewSrc ? receiptReviewerFields(reviewSrc) : {};
    const viewed = viewOrder({
      ...row,
      grabs,
      grabCount: grabs.length,
      bossIntent: intent,
      flowStatus: toFlowStatus(row.status, { expired: isOrderExpired(row) }),
      companion: companionMap[row.companion_id] || null,
      customerService: serviceMap[row.customer_service_id] || null,
      reviewed: !!rev,
      review_id: rev?.id || "",
      review_rating: rev?.rating,
      review_content: rev?.content || "",
      paymentReceipt: receipt,
      paymentProofUrl: proofUrlByOrder[row.id] || "",
      paymentRejectReason: rejected?.reject_reason || "",
      ...reviewFields,
    });
    if (proofUrlByOrder[row.id]) viewed.paymentProofUrl = proofUrlByOrder[row.id];
    if (rejected?.reject_reason) {
      viewed.paymentRejectReason = rejected.reject_reason;
      viewed.paymentReviewedAt = reviewFields.paymentReviewedAt || rejected.reviewed_at || "";
      viewed.paymentReviewedByName = reviewFields.paymentReviewedByName || "";
      viewed.paymentReviewedByStaffId = reviewFields.paymentReviewedByStaffId || "";
      if (!receipt) {
        viewed.bossHint = bossHint({
          ...row,
          paymentRejectReason: rejected.reject_reason,
          paymentReviewedByName: viewed.paymentReviewedByName,
        });
      }
    }
    return viewed;
  });
}
async function ensureConversation(order, bossId) {
  // Boss↔CS order_support only. Never stamp companion_id; never reuse companion_support by order_id.
  const typed = await supabaseJson(
    restUrl(
      "conversations",
      `?boss_id=eq.${encodeURIComponent(bossId)}&order_id=eq.${encodeURIComponent(order.id)}&conversation_type=eq.order_support&order=updated_at.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (typed?.[0]) {
    if (typed[0].companion_id) {
      await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(typed[0].id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ companion_id: null, updated_at: nowIso() }),
      }).catch(() => null);
      return { ...typed[0], companion_id: null };
    }
    return typed[0];
  }
  const existingRows = await supabaseJson(
    restUrl(
      "conversations",
      `?boss_id=eq.${encodeURIComponent(bossId)}&order_id=eq.${encodeURIComponent(order.id)}&order=updated_at.desc&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const existing = (Array.isArray(existingRows) ? existingRows : []).find(
    (r) => String(r.conversation_type || "") !== "companion_support"
  );
  if (existing) {
    const patch = { updated_at: nowIso(), companion_id: null };
    if (order.customer_service_id && !existing.customer_service_id) {
      patch.customer_service_id = order.customer_service_id;
    }
    try {
      await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      });
    } catch (_) {}
    return { ...existing, ...patch };
  }
  const base = {
    boss_id: bossId,
    companion_id: null,
    customer_service_id: order.customer_service_id || null,
    order_id: order.id,
    status: "open",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const rich = { ...base, conversation_type: "order_support", last_message_at: nowIso() };
  try {
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(rich),
    });
    return rows?.[0] || null;
  } catch (err) {
    if (!/conversation_type|last_message_at|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    const rows = await supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(base),
    });
    return rows?.[0] || null;
  }
}
async function touchConversation(conversationId, patch = {}) {
  if (!conversationId) return;
  const body = { updated_at: nowIso(), ...patch };
  try {
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ ...body, last_message_at: body.updated_at }),
    });
  } catch (err) {
    if (!/last_message_at|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ updated_at: body.updated_at }),
    });
  }
}
async function addSystemMessage(order, bossId, content) {
  const conversation = await ensureConversation(order, bossId);
  if (!conversation) return;
  await supabaseJson(restUrl("messages"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      conversation_id: conversation.id,
      sender_id: bossId,
      sender_role: "boss",
      message_type: "system",
      content,
      order_id: order.id,
      created_at: nowIso(),
    }),
  });
  await touchConversation(conversation.id);
}
async function patchOwnedOrder(profile, id, allowedStatuses, patch, message) {
  const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
  const before = beforeRows?.[0];
  if (!before) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  if (allowedStatuses && !allowedStatuses.includes(before.status)) throw Object.assign(new Error("当前订单状态不能执行该操作。"), { status: 409 });
  const nextStatus = patch.status ? normalizeOrderStatus(patch.status) : before.status;
  const body = { ...patch, ...(patch.status ? { status: nextStatus } : {}) };
  const rows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(body) });
  const saved = rows?.[0] || { ...before, ...body };
  if (patch.status && patch.status !== before.status) {
    await writeOrderStatusLog(
      { restUrl, supabaseJson, serviceHeaders },
      {
        orderId: id,
        fromStatus: before.status,
        toStatus: nextStatus,
        operatorRole: "boss",
        operatorId: profile.id,
        note: message || "",
      }
    );
  }
  if (message) await addSystemMessage(saved, profile.id, message);
  return viewOrder(saved);
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, { ok: false, configured: false, message: "未配置 Supabase，老板订单不能读取或保存真实数据库。" });
  }
  try {
    const profile = await profileFromToken(req);
    if (req.method === "GET") {
      const orders = await loadOrders(profile, String(req.query.id || ""));
      let refundByOrder = {};
      try {
        const refundApi = await import("./_boss-refund-payout.js");
        const refunds = await refundApi.listBossRefunds(companionDb, { bossId: profile.id, limit: 200 });
        for (const r of refunds || []) {
          if (r.orderId && !refundByOrder[r.orderId]) refundByOrder[r.orderId] = r;
        }
      } catch {
        refundByOrder = {};
      }
      const enriched = (orders || []).map((o) => {
        const r = refundByOrder[o.id];
        if (!r) return o;
        return {
          ...o,
          fridayRefundStatus: r.status,
          fridayRefundStatusText: r.statusText,
          fridaySettlementDate: r.settlementDate || "",
          fridayRefundAmountRm: r.amountRm,
          fridayRefundNo: r.refundNo,
        };
      });
      let platformPayInfo = null;
      const singleId = String(req.query.id || "").trim();
      if (singleId) {
        const target = enriched.find((o) => String(o.id) === singleId || String(o.orderNo || o.order_no || "") === singleId);
        if (target && String(target.status || "") === "awaiting_payment" && !isWalletMethod(target.paymentMethod || target.payment_method)) {
          try {
            // Bind QR strictly to this order's selected payment_method — never cross-fallback.
            platformPayInfo = await loadPlatformPayQr(target.paymentMethod || target.payment_method || "");
          } catch (err) {
            console.warn("[orders] platformPayInfo", String(err?.message || err).slice(0, 160));
            const methodHint = String(target.paymentMethod || target.payment_method || "").trim();
            platformPayInfo = {
              channelId: "",
              requestedMethod: methodHint,
              title: methodHint || "平台收款",
              qrUrl: "",
              instructions: methodHint
                ? `${paymentMethodLabel(methodHint)} 暂未开放，请选择其他支付方式`
                : "支付通道暂不可用",
              enabled: false,
              unavailable: true,
              source: "error",
            };
          }
        }
      }
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return json(res, 200, {
        ok: true,
        configured: true,
        orders: enriched.map((o) =>
          platformPayInfo &&
          (String(o.id) === singleId || String(o.orderNo || o.order_no || "") === singleId)
            ? { ...o, platformPayInfo }
            : o
        ),
        platformPayInfo,
        statusText: STATUS_TEXT,
        identity: profile._identity || null,
        allowTestPay: allowPreviewTestPay({
          allowTestPay: req.query?.allowTestPay ?? req.query?.allow_test_pay,
        }),
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "create");
    if (action === "list_my_refunds" || action === "my_refunds") {
      try {
        const refundApi = await import("./_boss-refund-payout.js");
        const refunds = await refundApi.listBossRefunds(companionDb, { bossId: profile.id, limit: 100 });
        return json(res, 200, { ok: true, refunds });
      } catch (e) {
        return json(res, 200, { ok: true, refunds: [], message: e.message || "" });
      }
    }
    if (action === "create" || action === "place_order") {
      const order = body.order || body;
      const idempotencyKey = String(
        body.idempotencyKey || body.idempotency_key || order.idempotencyKey || order.idempotency_key || ""
      ).trim();
      if (idempotencyKey) {
        try {
          const existing = await supabaseJson(
            restUrl(TABLE, `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
            { headers: serviceHeaders() }
          );
          if (existing?.[0]) {
            return json(res, 200, {
              ok: true,
              message: "订单已存在（防重复提交）",
              order: viewOrder(existing[0]),
              deduped: true,
              replayed: true,
            });
          }
        } catch (e) {
          if (!/idempotency|column|schema cache|PGRST/i.test(String(e.message || ""))) throw e;
        }
      }
      let companionId = String(order.companion_id || order.companionId || body.companionId || "").trim();
      if (action === "place_order" && !companionId) {
        return json(res, 400, { ok: false, message: "缺少陪玩信息，无法下单。" });
      }
      if (companionId) {
        companionId = (await resolveCompanionUserId(companionId)) || companionId;
      }
      const quantity = Math.max(1, Math.floor(money(order.quantity || 1) || 1));
      const baseHours = Math.max(0.5, money(order.hours || order.duration || 1));
      const hours = Math.round(baseHours * quantity * 100) / 100;
      const serviceType = String(order.serviceType || order.service_type || order.serviceName || order.service || "陪玩").trim() || "陪玩";
      const companionName = String(order.companionName || order.companion_name || "").trim();
      const gameId = String(order.gameId || order.game_id || order.gameIdValue || order.game_id_value || "").trim();
      const couponCode = String(order.couponCode || order.coupon || "").trim();
      let paymentMethod = String(order.paymentMethod || order.payment_method || "").trim().toLowerCase();
      const payGate = await assertOrderPaymentMethodAllowed(paymentMethod || "catfood");
      if (!payGate.ok) {
        return json(res, 409, { ok: false, message: payGate.message || "该支付方式暂未开放" });
      }
      paymentMethod = String(payGate.code || paymentMethod).toLowerCase();
      const notes = String(order.notes || order.remark || order.description || "").trim();
      const game = String(order.game || serviceType || "陪玩").trim();
      let unitPrice = 0;
      let totalAmount = 0;

      if (companionId) {
        let companions = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(companionId)}&limit=1`), { headers: serviceHeaders() });
        let companion = Array.isArray(companions) ? companions[0] : null;
        if (!companion || companion.role !== "companion") {
          try {
            const cpRows = await supabaseJson(
              restUrl("companion_profiles", `?id=eq.${encodeURIComponent(companionId)}&select=id,user_id&limit=1`),
              { headers: serviceHeaders() }
            );
            const userId = Array.isArray(cpRows) && cpRows[0] ? cpRows[0].user_id : "";
            if (userId) {
              companions = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}&limit=1`), { headers: serviceHeaders() });
              companion = Array.isArray(companions) ? companions[0] : null;
              if (companion && companion.role === "companion") companionId = companion.id;
            }
          } catch (_) {
            /* keep original 404 path */
          }
        }
        if (!companion || companion.role !== "companion") {
          return json(res, 404, { ok: false, message: "指定陪玩不存在或不可下单。" });
        }
      }

      if (action === "place_order") {
        if (!gameId) return json(res, 400, { ok: false, message: "请填写游戏 ID。" });
        // Server-authoritative unit price from companion_profiles — never trust client unit/total.
        const orderable = await assertCompanionOrderable(companionId);
        if (!orderable.ok) {
          return json(res, 400, { ok: false, message: orderable.message || "该陪玩暂不可下单" });
        }
        const cp = orderable.cp;
        const serviceId = String(order.serviceId || order.service_id || "").trim();
        const gameHint = String(order.gameName || order.game_name || order.mainGame || order.main_game || game || "").trim();
        unitPrice = money(priceForGame(cp, gameHint, serviceId));
        if (!(unitPrice > 0)) unitPrice = money(cp.price);
        if (!(unitPrice > 0)) {
          // Prefer first positive game_prices entry when service/game labels don't match keys.
          const gp = cp.game_prices && typeof cp.game_prices === "object" ? cp.game_prices : {};
          for (const k of Object.keys(gp)) {
            const v = money(gp[k]);
            if (v > 0) {
              unitPrice = v;
              break;
            }
          }
        }
        if (!(unitPrice > 0)) {
          return json(res, 400, { ok: false, message: "该陪玩尚未设置单价" });
        }
        totalAmount = Math.round(unitPrice * hours * 100) / 100;
        const clientUnit = money(order.unit_price || order.unitPrice || order.price || order.budget || 0);
        const clientTotal = money(order.total_amount || order.totalAmount);
        if (clientUnit > 0 && Math.abs(clientUnit - unitPrice) > 0.05) {
          return json(res, 400, { ok: false, message: `价格已变化，请刷新后重试（单价 ${unitPrice}）` });
        }
        if (clientTotal > 0 && Math.abs(clientTotal - totalAmount) > 0.05) {
          return json(res, 400, { ok: false, message: `价格已变化，请刷新后重试（应付 ${totalAmount}）` });
        }
        if (!(totalAmount > 0)) return json(res, 400, { ok: false, message: "订单金额无效。" });
      } else {
        if (!order.game || (!order.description && !order.requirements && !order.title)) {
          return json(res, 400, { ok: false, message: "请填写游戏和需求说明。" });
        }
        unitPrice = money(order.unit_price || order.unitPrice || order.price || order.budget || 0);
        totalAmount = money(order.total_amount || order.totalAmount);
        if (!(totalAmount > 0)) totalAmount = Math.round(unitPrice * hours * 100) / 100;
      }

      const useWallet = action === "place_order" && isWalletMethod(paymentMethod);
      // 统一支付链路：下单只创建待付款订单，真正支付在 payment-confirm 完成。
      let status = "awaiting_payment";
      const title = companionName
        ? `${serviceType} · ${companionName} · ${hours}小时`
        : String(order.title || `${serviceType} · ${hours}小时`);
      const descriptionParts =
        action === "place_order"
          ? [
              notes || `${serviceType}订单`,
              gameId ? `游戏ID：${gameId}` : "",
              couponCode ? `优惠券：${couponCode}` : "",
              `付款方式：${paymentMethod}`,
              companionName ? `指定陪玩：${companionName}` : "",
            ].filter(Boolean)
          : [
              String(order.description || order.requirements || order.service_content || notes || ""),
              gameId && !String(order.description || "").includes("游戏ID") ? `游戏ID：${gameId}` : "",
              // Persist selected channel for QR routing (create path previously dropped it → 线下确认).
              `付款方式：${paymentMethod}`,
            ].filter(Boolean);

      const row = {
        order_no: await nextOrderNo(),
        boss_id: profile.id,
        companion_id: companionId || null,
        customer_service_id: null,
        order_type: companionId ? "direct_companion" : String(order.order_type || order.orderType || "custom"),
        assignment_type: companionId ? "assigned" : "public",
        game: action === "place_order" ? game : String(order.game || game || ""),
        title: action === "place_order" ? title : String(order.title || "自定义订单"),
        description: descriptionParts.join("\n"),
        hours,
        unit_price: unitPrice,
        total_amount: totalAmount,
        status,
        created_at: nowIso()
      };
      if (idempotencyKey) row.idempotency_key = idempotencyKey;
      // Optional marketplace columns (ignore if schema missing).
      const enriched = {
        ...row,
        payment_method: paymentMethod,
        service_name: serviceType,
        game_id_value: gameId || String(order.game_id || "").trim(),
        notes: notes || descriptionParts.join("\n"),
        quantity,
        pricing_unit: String(order.pricingUnit || order.pricing_unit || "小时"),
      };
      let rows;
      try {
        rows = await supabaseJson(restUrl(TABLE), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(enriched) });
      } catch (insertErr) {
        const msg = String(insertErr.message || "");
        if (idempotencyKey && /duplicate|unique|idempotency/i.test(msg)) {
          const existing = await supabaseJson(
            restUrl(TABLE, `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
            { headers: serviceHeaders() }
          ).catch(() => []);
          if (existing?.[0]) {
            return json(res, 200, {
              ok: true,
              message: "订单已存在（防重复提交）",
              order: viewOrder(existing[0]),
              deduped: true,
              replayed: true,
            });
          }
        }
        if (!/column|schema cache|PGRST/i.test(msg)) throw insertErr;
        try {
          rows = await supabaseJson(restUrl(TABLE), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify(row),
          });
        } catch (e2) {
          const msg2 = String(e2.message || "");
          if (idempotencyKey && /duplicate|unique|idempotency/i.test(msg2)) {
            const existing = await supabaseJson(
              restUrl(TABLE, `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
              { headers: serviceHeaders() }
            ).catch(() => []);
            if (existing?.[0]) {
              return json(res, 200, {
                ok: true,
                message: "订单已存在（防重复提交）",
                order: viewOrder(existing[0]),
                deduped: true,
                replayed: true,
              });
            }
          }
          if (idempotencyKey && /idempotency_key|column|schema cache|PGRST/i.test(msg2)) {
            const { idempotency_key: _ik, assignment_type: _at, ...core } = row;
            rows = await supabaseJson(restUrl(TABLE), {
              method: "POST",
              headers: serviceHeaders(),
              body: JSON.stringify(core),
            });
          } else if (/assignment_type|column|schema cache|PGRST/i.test(msg2)) {
            const { assignment_type: _at, ...core } = row;
            rows = await supabaseJson(restUrl(TABLE), {
              method: "POST",
              headers: serviceHeaders(),
              body: JSON.stringify(core),
            });
          } else {
            throw e2;
          }
        }
      }
      let saved = rows?.[0] || enriched;

      const companionLabel = companionName || companionId || "未指定（公开抢单）";
      const notify = `新订单已提交，等待支付，指定陪玩为 ${companionLabel}。支付方式：${paymentMethodLabel(paymentMethod)}；服务：${serviceType}；时长：${hours}小时；金额：${totalAmount} 猫粮。`;
      await addSystemMessage(saved, profile.id, notify);
      const okMessage = useWallet ? "订单已创建，请完成支付。" : "订单已提交，请完成支付。";
      return json(res, 200, {
        ok: true,
        message: okMessage,
        order: viewOrder(saved),
      });
    }
    const id = String(body.id || body.order_id || body.orderId || "");
    if (!id) return json(res, 400, { ok: false, message: "缺少订单 ID。" });
    if (action === "submit_payment_proof") {
      const beforeRows = await supabaseJson(
        restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (before.status !== "awaiting_payment") {
        return json(res, 409, { ok: false, message: "当前订单无需提交付款凭证。", order: viewOrder(before) });
      }
      const result = await uploadProof({
        order: before,
        bossId: profile.id,
        dataUrl: body.proofDataUrl || body.paymentProof || body.fileDataUrl || body.file || "",
        paymentMethod: body.paymentMethod || body.payment_method || viewOrder(before).paymentMethod,
      });
      const marker = `[[PAYMENT_PROOF]] bucket=${result.receipt?.storage_bucket || "companion-payment-proofs"} path=${result.receipt?.storage_path || ""}`;
      let saved = before;
      const note = `${String(before.note || "").replace(/\[\[PAYMENT_PROOF\]\][^\n]*/g, "").trim()}\n${marker}`.trim();
      const description = `${String(before.description || "").replace(/\[\[PAYMENT_PROOF\]\][^\n]*/g, "").trim()}\n${marker}`.trim();
      try {
        const rows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ note, description }),
        });
        saved = rows?.[0] || { ...before, note, description };
      } catch (err) {
        // note/description columns may be unavailable — receipt row remains source of truth.
        console.warn("[submit_payment_proof] note patch", String(err?.message || err).slice(0, 160));
        saved = { ...before, note, description, paymentReceipt: result.receipt };
      }
      await addSystemMessage(saved, profile.id, "老板已上传付款凭证，等待人工审核。").catch(() => {});
      const proofUrl = await signedProofUrl(result.receipt).catch(() => "");
      return json(res, 200, {
        ok: true,
        message: "付款凭证已提交，等待人工审核。",
        receipt: { id: result.receipt?.id, receiptNo: result.receipt?.receipt_no },
        order: {
          ...viewOrder({ ...saved, paymentReceipt: result.receipt, paymentProofUrl: proofUrl || "" }),
          paymentReview: true,
          paymentProofUrl: proofUrl || result.receipt?.storage_path || "",
          statusText: "待人工审核",
          paymentStatus: "待人工审核",
        },
      });
    }
    if (action === "pay_order") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (normalizeOrderStatus(before.status) !== "awaiting_payment") {
        return json(res, 409, { ok: false, message: "当前订单无需再次支付。", order: viewOrder(before) });
      }
      const paymentMethodRaw = String(body.paymentMethod || body.payment_method || viewOrder(before).paymentMethod || "").trim().toLowerCase();
      const payGate = await assertOrderPaymentMethodAllowed(paymentMethodRaw);
      if (!payGate.ok) {
        return json(res, 409, { ok: false, message: payGate.message || "该支付方式暂未开放" });
      }
      const paymentMethod = String(payGate.code || paymentMethodRaw).toLowerCase();
      const previewTest =
        String(body.preview_test || body.previewTest || "").trim() === "1" ||
        String(body.test_pay || "").trim() === "1";
      const previewAllowed = allowPreviewTestPay({
        allowTestPay: body.allowTestPay ?? body.allow_test_pay ?? req.query?.allowTestPay,
      });
      if (previewTest && !previewAllowed) {
        return json(res, 403, {
          ok: false,
          message: "测试支付未开启。请使用猫粮支付，或在 URL 加 ?allowTestPay=1 / 设置 MCJ_ALLOW_TEST_PAY=1。",
          allowTestPay: false,
        });
      }

      let usedTestPay = false;
      if (isWalletMethod(paymentMethod) && !previewTest) {
        try {
          const walletApi = await import("./_wallet.js");
          await walletApi.debitWallet({
            bossId: profile.id,
            amount: money(before.total_amount),
            transactionType: "order_payment",
            idempotencyKey: `order-pay:${before.order_no || before.id}`,
            reason: `订单支付 ${before.order_no || before.id}`,
            relatedOrderId: before.id,
            operatorId: profile.id,
          });
        } catch (e) {
          // Preview: wallet missing / empty → allow explicit TEST pay only (never silent fake).
          if (previewAllowed && (isMissingWalletRpc(e) || isWalletBalanceError(e))) {
            return json(res, 400, {
              ok: false,
              code: "USE_TEST_PAY",
              message: "猫粮支付不可用或余额不足。Preview 请点击「测试支付成功（TEST）」完成状态流转。",
              allowTestPay: true,
            });
          }
          if (isMissingWalletRpc(e)) {
            return json(res, 503, { ok: false, code: "WALLET_UNAVAILABLE", message: "猫粮支付暂不可用" });
          }
          if (isWalletBalanceError(e)) {
            return json(res, 400, { ok: false, code: "INSUFFICIENT_BALANCE", message: e.message || "猫粮余额不足", rechargeUrl: "/recharge.html" });
          }
          throw e;
        }
      } else if (previewTest && previewAllowed) {
        usedTestPay = true;
      } else if (!isPreviewTestMethod(paymentMethod)) {
        if (previewAllowed) {
          return json(res, 400, {
            ok: false,
            code: "USE_TEST_PAY",
            message: "当前支付方式未接通真实网关。Preview 请使用「测试支付成功（TEST）」。",
            allowTestPay: true,
          });
        }
        return json(res, 400, { ok: false, message: "当前支付方式不支持自动支付，请联系客服确认。" });
      } else if (!previewAllowed) {
        return json(res, 400, { ok: false, message: "正式环境请使用已接通的支付渠道。" });
      } else {
        usedTestPay = true;
      }

      const nextStatus = before.companion_id ? "claimed" : "pending";
      // Companion must confirm before accepted_at / start — never pre-stamp on pay.
      const deps = { restUrl, supabaseJson, serviceHeaders };
      const payPatch = {
        accepted_at: null,
        assignment_type: before.companion_id ? "assigned" : "public",
        ...(before.companion_id
          ? { order_type: before.order_type || "direct_companion" }
          : { companion_id: null, order_type: before.order_type || "open_grab" }),
      };
      let saved;
      try {
        saved = await transitionOrderStatus(deps, {
          orderId: before.id,
          filterQuery: `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&status=eq.awaiting_payment`,
          fromStatus: before.status,
          toStatus: nextStatus,
          patch: payPatch,
          operatorRole: "boss",
          operatorId: profile.id,
          note: usedTestPay ? "TEST preview pay success" : "boss wallet/gateway pay success",
        });
      } catch (e) {
        // Retry without optional columns if schema missing.
        if (!/accepted_at|assignment_type|order_type|column|schema cache|PGRST/i.test(String(e.message || ""))) throw e;
        saved = await transitionOrderStatus(deps, {
          orderId: before.id,
          filterQuery: `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&status=eq.awaiting_payment`,
          fromStatus: before.status,
          toStatus: nextStatus,
          patch: before.companion_id ? {} : { companion_id: null },
          operatorRole: "boss",
          operatorId: profile.id,
          note: usedTestPay ? "TEST preview pay success" : "boss pay success",
        });
      }
      if (!saved) {
        const again = await supabaseJson(
          restUrl(TABLE, `?id=eq.${encodeURIComponent(before.id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
          { headers: serviceHeaders() }
        );
        saved = again?.[0] || { ...before, status: nextStatus, accepted_at: null };
        await writeOrderStatusLog(deps, {
          orderId: before.id,
          fromStatus: before.status,
          toStatus: nextStatus,
          operatorRole: "boss",
          operatorId: profile.id,
          note: usedTestPay ? "TEST preview pay success (empty patch return)" : "boss pay success",
        });
      }

      const companionLabel =
        viewOrder(saved).companionName ||
        saved.companion_id ||
        (before.companion_id ? "指定陪玩" : "公开抢单");
      try {
        await addSystemMessage(
          saved,
          profile.id,
          nextStatus === "claimed"
            ? `${usedTestPay ? "[TEST] " : ""}订单已支付，指定陪玩为 ${companionLabel}，等待陪玩确认。`
            : `${usedTestPay ? "[TEST] " : ""}订单已支付，已进入抢单大厅，等待陪玩抢单。`
        );
      } catch (_) {
        /* chat soft-fail — status already persisted */
      }
      if (nextStatus === "pending" && !before.companion_id) {
        try {
          const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
          const listingsApi = createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders });
          await listingsApi.upsertListing(saved || before, {
            publishedByCsId: null,
            reason: usedTestPay ? "boss_test_pay_open_grab" : "boss_pay_open_grab",
          });
        } catch (err) {
          console.warn("[orders/pay_order] upsertListing", err?.message || err);
        }
      }
      if (nextStatus === "claimed" && before.companion_id) {
        try {
          const { notifyCompanionOrderAssigned } = await import("./_companion-order-notify.js");
          await Promise.race([
            notifyCompanionOrderAssigned(saved || { ...before, status: "claimed" }, {
              eventType: "assign",
              email: "",
            }).catch((err) => console.warn("[orders/pay_order] companion notify", err?.message || err)),
            new Promise((resolve) => setTimeout(resolve, 3500)),
          ]);
        } catch (err) {
          console.warn("[orders/pay_order] companion notify import", err?.message || err);
        }
      }
      let reward = null;
      try {
        reward = await (await import("./_cs-commission-settle.js")).settleCsOrderIncome(saved, {
          source: usedTestPay ? "boss_test_pay" : "boss_pay",
        });
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        testPay: usedTestPay,
        message: usedTestPay
          ? nextStatus === "claimed"
            ? "测试支付成功（TEST）。订单已进入等待陪玩确认。"
            : "测试支付成功（TEST）。订单已进入抢单大厅。"
          : nextStatus === "claimed"
            ? "支付成功，订单已进入等待陪玩确认。"
            : "支付成功，订单已进入抢单大厅。",
        order: viewOrder(saved),
        allowTestPay: previewAllowed,
        reward,
      });
    }
    if (action === "list_grabs" || action === "grab_applicants") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const { enrichGrabCompanions, parseBossIntent } = await import("./_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(before.id, before.note || before.description || "");
      const intent = parseBossIntent(before);
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs);
      const marked = enriched.map((g) => ({
        ...g,
        bossPreferred: !!(intent && intent.companionId === g.companionId),
        companion: g.companion
          ? { ...g.companion, bossPreferred: !!(intent && intent.companionId === g.companionId) }
          : null,
      }));
      return json(res, 200, {
        ok: true,
        grabCount: marked.length,
        bossIntent: intent,
        grabs: marked,
        order: viewOrder({
          ...before,
          grabs: marked,
          grabCount: marked.length,
          bossIntent: intent,
        }),
      });
    }
    if (action === "confirm_companion" || action === "select_grabber" || action === "set_boss_intent" || action === "want_him" || action === "select_and_bind") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      // Idempotent: already bound to this companion.
      {
        const alreadyCompanion = String(before.companion_id || "").trim();
        const wantId = String(body.companion_id || body.companionId || body.grab_companion_id || "").trim();
        if (
          alreadyCompanion &&
          wantId &&
          alreadyCompanion === wantId &&
          ["claimed", "confirmed", "in_progress"].includes(String(before.status || ""))
        ) {
          return json(res, 200, {
            ok: true,
            message: "已指定该陪玩。",
            intentOnly: false,
            bound: true,
            deduped: true,
            order: viewOrder(before),
          });
        }
      }
      if (!["waiting_boss_confirm", "pending"].includes(before.status)) {
        return json(res, 409, { ok: false, message: "当前订单状态不能选择陪玩。" });
      }
      const { createOrderGrabHelpers, isSelectableGrabStatus } = await import("./_order-grabs.js");
      const {
        enrichGrabCompanions,
        parseBossIntent,
        withBossIntent,
        clearBossIntent,
        patchOrderNoteField,
        toFlowStatus,
      } = await import("./_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(before.id, before.note || before.description || "");
      let selectedId = String(body.companion_id || body.companionId || body.grab_companion_id || "").trim();
      const grabId = String(body.grab_id || body.grabId || "").trim();
      if (!selectedId && grabId) {
        selectedId = (grabs.find((g) => g.grabId === grabId || g.id === grabId) || {}).companionId || "";
      }
      if (!selectedId) {
        return json(res, 400, { ok: false, message: "请选择一位陪玩。" });
      }
      if (!grabs.length) {
        return json(res, 409, { ok: false, message: "暂无陪玩抢单，请等待陪玩申请后再选择。" });
      }
      let hit = grabs.find((g) => String(g.companionId || "") === String(selectedId));
      // Allow companion public code / uid on the card to resolve to the grab UUID.
      if (!hit && !/^[0-9a-f-]{36}$/i.test(selectedId)) {
        try {
          const profiles = await supabaseJson(
            restUrl(
              "profiles",
              `?or=(companion_uid.eq.${encodeURIComponent(selectedId)},companion_code.eq.${encodeURIComponent(selectedId)},id.eq.${encodeURIComponent(selectedId)})&select=id,companion_uid,companion_code&limit=3`
            ),
            { headers: serviceHeaders() }
          );
          const pid = Array.isArray(profiles) && profiles[0]?.id ? String(profiles[0].id) : "";
          if (pid) {
            selectedId = pid;
            hit = grabs.find((g) => String(g.companionId || "") === pid);
          }
        } catch {
          /* ignore */
        }
      }
      if (!hit || !isSelectableGrabStatus(hit.status)) {
        return json(res, 409, {
          ok: false,
          message: "该陪玩未抢单或状态无效，请从抢单列表中选择。",
          code: "GRAB_STATUS_INVALID",
        });
      }
      // Product: boss「我要他/她」= bind companion now (四端同步).
      // Only explicit set_boss_intent stays intent-only.
      const shouldBind = action !== "set_boss_intent";
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs);
      const pick = enriched.find((g) => String(g.companionId || "") === String(selectedId));
      const pickName = pick?.companion?.nickname || "陪玩";

      if (shouldBind) {
        const { transitionOrderStatus } = await import("./_order-status.js");
        const patched =
          (await transitionOrderStatus(
            { restUrl, supabaseJson, serviceHeaders },
            {
              orderId: id,
              fromStatus: before.status,
              toStatus: "claimed",
              patch: {
                companion_id: selectedId,
                accepted_at: null,
                assignment_type: "public",
              },
              operatorRole: "boss",
              operatorId: profile.id,
              note: `老板选择陪玩 ${pickName}`,
            }
          ).catch(() => null)) ||
          (
            await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                status: "claimed",
                companion_id: selectedId,
                accepted_at: null,
                assignment_type: "public",
              }),
            })
          )?.[0];
        if (!patched || String(patched.status || "") === String(before.status || "")) {
          // Soft fallback without assignment_type if column missing.
          const soft = (
            await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({ status: "claimed", companion_id: selectedId, accepted_at: null }),
            }).catch(() => null)
          )?.[0];
          if (!soft) {
            return json(res, 409, { ok: false, message: "订单状态已变更，请刷新后重试。" });
          }
        }
        const order = patched || { ...before, status: "claimed", companion_id: selectedId };
        await grabsApi.finalizeGrabSelection(order, selectedId).catch((err) =>
          console.warn("[orders/want_him] finalizeGrabSelection", err?.message || err)
        );
        try {
          const { stampClaimedAtNote } = await import("./_order-confirm-timeout.js");
          await patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, id, (text) =>
            stampClaimedAtNote(clearBossIntent(text))
          );
        } catch {
          /* ignore */
        }
        try {
          const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
          const listingsApi = createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders });
          await listingsApi.closeListing(id, "boss_selected");
        } catch {
          /* optional */
        }
        await addSystemMessage(
          order,
          profile.id,
          `老板已选择陪玩 ${pickName}。订单进入等待陪玩确认。`
        );
        for (const g of enriched) {
          if (String(g.companionId || "") === String(selectedId)) continue;
          try {
            await addSystemMessage(
              { ...order, companion_id: g.companionId },
              profile.id,
              "该订单已由其他陪玩接单。"
            );
          } catch {
            /* best-effort */
          }
        }
        try {
          const { notifyCompanionOrderAssigned } = await import("./_companion-order-notify.js");
          await Promise.race([
            notifyCompanionOrderAssigned(
              { ...order, companion_id: selectedId, status: "claimed" },
              { eventType: "assign" }
            ).catch((err) => console.warn("[orders/want_him] companion notify", err?.message || err)),
            new Promise((resolve) => setTimeout(resolve, 3500)),
          ]);
        } catch (err) {
          console.warn("[orders/want_him] companion notify import", err?.message || err);
        }
        return json(res, 200, {
          ok: true,
          message: `已选择陪玩 ${pickName}，等待陪玩确认接单。`,
          intentOnly: false,
          bound: true,
          order: viewOrder({
            ...order,
            status: "claimed",
            companion_id: selectedId,
            flowStatus: toFlowStatus("claimed"),
            grabCount: enriched.length,
          }),
        });
      }

      // Legacy intent-only path (set_boss_intent).
      let order = before;
      if (before.status === "pending") {
        const rows = await supabaseJson(
          restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}`),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ status: "waiting_boss_confirm" }),
          }
        );
        order = rows?.[0] || { ...before, status: "waiting_boss_confirm" };
        await writeOrderStatusLog(
          { restUrl, supabaseJson, serviceHeaders },
          {
            orderId: id,
            fromStatus: before.status,
            toStatus: "waiting_boss_confirm",
            operatorRole: "boss",
            operatorId: profile.id,
            note: "boss intent selection opened selecting state",
          }
        );
      }
      order = await patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, id, (text) =>
        withBossIntent(text, {
          companion_id: selectedId,
          companion_name: pickName,
          at: nowIso(),
          by: "boss",
        })
      );
      await addSystemMessage(
        order,
        profile.id,
        `老板选择了陪玩 ${pickName}（意向）。请客服确认指定后，订单才会锁定。`
      );
      const intent = parseBossIntent(order);
      const marked = enriched.map((g) => ({
        ...g,
        bossPreferred: String(g.companionId || "") === String(selectedId),
        companion: g.companion
          ? { ...g.companion, bossPreferred: String(g.companionId || "") === String(selectedId) }
          : null,
      }));
      return json(res, 200, {
        ok: true,
        message: `已提交意向：${pickName}。等待客服确认指定。`,
        intentOnly: true,
        order: viewOrder({
          ...order,
          status: order.status || "waiting_boss_confirm",
          companion_id: null,
          grabs: marked,
          grabCount: marked.length,
          bossIntent: intent,
          flowStatus: toFlowStatus(order.status || "waiting_boss_confirm"),
        }),
      });
    }
    if (action === "reject_companion") {
      const order = await patchOwnedOrder(profile, id, ["waiting_boss_confirm", "pending"], { status: "pending", companion_id: null, accepted_at: null }, "老板已选择换一个陪玩，请客服重新安排。");
      return json(res, 200, { ok: true, message: "已选择换一个陪玩，客服将重新安排。", order });
    }
    if (action === "confirm_completion" || action === "confirm_complete") {
      const beforeRows = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      const helpers = createOrderCompleteHelpers({
        restUrl,
        supabaseJson,
        serviceHeaders,
        addSystemMessage: async (order, actorId, content) => addSystemMessage(order, actorId || profile.id, content),
      });
      try {
        const out = await helpers.finalizeOrderCompletion(before, {
          method: "boss_manual",
          actorId: profile.id,
          message: "老板已确认完成订单。",
        });
        return json(res, 200, {
          ok: true,
          message: out.message || "已确认完成，订单已完成。",
          order: viewOrder(out.order || before),
          reward: out.reward || null,
          settlement: out.settlement || null,
          completionMethod: out.completionMethod || "boss_manual",
          duplicate: !!out.duplicate,
        });
      } catch (err) {
        const status = Number(err?.status) || 500;
        return json(res, status >= 400 && status < 600 ? status : 500, {
          ok: false,
          message: err?.message || "确认完成失败。",
        });
      }
    }
    if (action === "report_order_problem" || action === "pause_auto_confirm") {
      const beforeRows = await supabaseJson(
        restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (before.status !== "in_progress") {
        return json(res, 409, { ok: false, message: "当前订单状态不能提交问题。" });
      }
      const helpers = createOrderCompleteHelpers({
        restUrl,
        supabaseJson,
        serviceHeaders,
        addSystemMessage: async (order, actorId, content) => addSystemMessage(order, actorId || profile.id, content),
      });
      if (!helpers.orderHasCompletionPending(before)) {
        return json(res, 409, { ok: false, message: "陪玩尚未申请完成，请直接联系客服。" });
      }
      await helpers.stampAutoPaused(before, String(body.reason || "boss_problem").slice(0, 80));
      await addSystemMessage(before, profile.id, "老板反馈订单有问题，已暂停 24 小时自动确认，请客服处理。");
      const fresh = (
        await supabaseJson(
          restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
          { headers: serviceHeaders() }
        )
      )?.[0] || before;
      return json(res, 200, {
        ok: true,
        message: "已记录订单问题并暂停自动确认，请联系客服继续处理。",
        order: viewOrder(fresh),
        supportUrl: `/support.html?order=${encodeURIComponent(id)}`,
      });
    }
    if (action === "cancel_order") {
      const order = await patchOwnedOrder(profile, id, ["awaiting_payment", "pending", "claimed", "waiting_boss_confirm", "confirmed"], { status: "cancelled", cancelled_at: nowIso() }, "老板已取消订单。");
      try {
        await (await import("./_cs-commission-settle.js")).clawbackCsOrderIncome(
          { id: order?.id || id, status: "cancelled" },
          { reason: "老板取消订单", mode: "cancel" }
        );
      } catch (_) {}
      return json(res, 200, { ok: true, message: "订单已取消。", order });
    }
    if (action === "request_refund") {
      const beforeRows = await supabaseJson(
        restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
      const order = await patchOwnedOrder(profile, id, ["confirmed", "in_progress", "completed"], { status: "refund_requested" }, "老板已申请退款，等待客服处理。预计周五统一退款，不会即时到账。");
      let refund = null;
      try {
        const refundApi = await import("./_boss-refund-payout.js");
        const amount = money(body.amount != null ? body.amount : order?.total_amount || before?.total_amount || order?.paid_cat_food);
        const created = await refundApi.createBossRefundRequest(companionDb, {
          order: order || before || { id, boss_id: profile.id, total_amount: amount, order_no: before?.order_no },
          boss: profile,
          amount,
          reason: String(body.reason || body.note || "老板申请退款"),
        });
        if (created.ok) refund = created.refund;
      } catch (e) {
        console.warn("[orders] friday refund enqueue:", e?.message || e);
      }
      return json(res, 200, {
        ok: true,
        message: "退款申请已提交。当前状态：待审核。预计处理日为本周五或下周五，不会即时到账。",
        order,
        refund,
      });
    }
    if (action === "submit_review") {
      const beforeRows = await supabaseJson(
        restUrl(TABLE, `?id=eq.${encodeURIComponent(id)}&boss_id=eq.${encodeURIComponent(profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const order = Array.isArray(beforeRows) ? beforeRows[0] : null;
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const statusNow = String(order.status || "");
      if (/^(cancelled|refunded|refund_requested)$/.test(statusNow)) {
        return json(res, 400, { ok: false, message: "已取消或退款的订单不能评价。" });
      }
      if (statusNow !== "completed") return json(res, 400, { ok: false, message: "只有已完成订单可以评价。" });
      if (!order.companion_id) return json(res, 400, { ok: false, message: "该订单没有可评价的陪玩。" });
      const bodyCompanionId = String(body.companion_id || body.companionId || "").trim();
      if (bodyCompanionId && bodyCompanionId !== String(order.companion_id)) {
        return json(res, 400, { ok: false, message: "评价陪玩与订单陪玩不一致。" });
      }
      const rating = Math.max(1, Math.min(5, Number(body.rating || body.stars || 0) || 0));
      if (!(rating >= 1 && rating <= 5)) return json(res, 400, { ok: false, message: "请选择 1-5 星评分。" });
      const content = String(body.content || body.comment || body.note || "").trim();
      const existing = await supabaseJson(
        restUrl(
          "companion_reviews",
          `?order_id=eq.${encodeURIComponent(order.id)}&select=id,order_id,companion_id,boss_id,rating,content,status,created_at&order=created_at.desc&limit=1`
        ),
        { headers: serviceHeaders() }
      ).catch(() => []);
      if (Array.isArray(existing) && existing[0]) {
        return json(res, 200, {
          ok: true,
          message: "该订单已评价。",
          review: existing[0],
          already: true,
          companionId: order.companion_id,
          order: viewOrder({
            ...order,
            reviewed: true,
            review_id: existing[0].id,
            review_rating: existing[0].rating,
            review_content: existing[0].content || "",
          }),
        });
      }
      let rows;
      try {
        rows = await supabaseJson(restUrl("companion_reviews"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            order_id: order.id,
            boss_id: profile.id,
            companion_id: order.companion_id,
            rating,
            content,
            status: "published",
            created_at: nowIso(),
          }),
        });
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (/companion_reviews|schema cache|PGRST|does not exist/i.test(msg)) {
          return json(res, 503, {
            ok: false,
            message: "评价表未初始化。请在 Supabase 执行 supabase/popularity-ranking.sql。",
          });
        }
        throw e;
      }
      try {
        const pop = await import("./_popularity.js");
        if (typeof pop.scheduleRecomputeSoft === "function") pop.scheduleRecomputeSoft();
      } catch (_) {}
      const review = rows?.[0] || null;
      return json(res, 200, {
        ok: true,
        message: "评价已提交。",
        review,
        companionId: order.companion_id,
        order: viewOrder({
          ...order,
          reviewed: true,
          review_id: review?.id || "",
          review_rating: rating,
          review_content: content,
        }),
      });
    }
    return json(res, 400, { ok: false, message: "未知订单操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "订单接口异常" });
  }
}







