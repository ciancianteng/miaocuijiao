import {
  PRIVATE_BUCKETS,
  PUBLIC_BUCKETS,
  assertAudioUpload,
  assertImageUpload,
  assertVideoUpload,
  buildObjectPath,
  companionDb,
  createSignedUrl,
  decodeDataUrl,
  deleteStorageObject,
  ensureCompanionBuckets,
  isMissingRelation,
  maskBankAccount,
  publicObjectUrl,
  uploadPrivateObject,
} from "./_companion-media-store.js";
import { companionPopularityMe, recordOnlineSession, scheduleRecomputeSoft } from "./_popularity.js";
import { readLocalLevels, toPublicLevel } from "./_companion-levels-store.js";
import { resolvePlatformCommission } from "./_commission-rates.js";
import { writeOrderStatusLog, COMPANION_STATUS_LABELS } from "./_order-status.js";
import {
  completionCountdown,
  formatRemainingLabel,
  parseCompletionMethod,
} from "./_order-complete.js";
import {
  readGamePrices,
  writeGamePricesMarker,
  stripGamePricesMarker,
  splitGames,
  parseServiceIds,
  parseServiceTypes,
} from "./_game-prices.js";
import { loadPublicServices } from "./platform/services.js";
import {
  anonymousBossLabel,
  allocateWithdrawalNo,
  resolveBossPublicCode,
  publicDisplayName,
  resolveCompanionPublicCode,
} from "./_account-codes.js";
import {
  normalizeSelectedVoiceTypes,
} from "./_companion-voice-types-store.js";
import { evaluatePublishGate } from "./_companion-publish-gate.js";
import { resolveCertTagsForProfiles } from "./_companion-cert-tags-store.js";
import {
  buildCompanionInbox,
  ensureCompanionSupportConversation,
  endCompanionSupportConversation,
  sendCompanionChatMessage,
  markConversationMessagesRead,
  markNoticesRead,
  loadConversationMessages,
  loadCompanionThreadMessages,
  viewMessage,
  viewMessageSigned,
  buildSystemNotices,
  loadCompanionNotifications,
  loadReadKeys,
  insertCompanionNotification,
} from "./_companion-inbox.js";
import { isClosedConversationStatus } from "./_conversation-lock.js";
import "./_load-env.js";
import {
  computeSettlementDate,
  mergeWeeklySettings,
  normalizePayoutStatus,
  PAYOUT_STATUS_TEXT,
  PAYOUT_FROZEN_STATUSES,
  viewWeeklyRules,
} from "./_weekly-settlement.js";
import {
  loadFinanceWeeklySettings,
  lockPayoutSources,
  upsertPayoutRequest,
} from "./_payout-requests.js";

const ORDER_STATUS_TEXT = COMPANION_STATUS_LABELS;

const WITHDRAW_STATUS_TEXT = {
  ...PAYOUT_STATUS_TEXT,
  pending: "已提交",
  pending_review: "待周五结算",
  pending_friday: "待周五结算",
  reviewing: "审核中",
  approved: "审核通过待打款",
  approved_pending_pay: "审核通过待打款",
  pending_payment: "审核通过待打款",
  paying: "审核通过待打款",
  paid_pending_receipt: "已打款",
  paid: "已打款",
  completed: "已完成",
  rejected: "已驳回",
  rolled_over: "顺延至下周",
  pay_failed: "付款失败",
  cancelled: "已取消",
};
const WITHDRAW_FROZEN = PAYOUT_FROZEN_STATUSES;
const WITHDRAW_ACTIVE = new Set([...WITHDRAW_FROZEN, "completed", "paid"]);
const SETTLEMENT_PREFIX = "MCJ_SETTLEMENT:";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ORDER_TYPE_TEXT = {
  customer_service: "客服派单",
  direct_companion: "指定陪玩",
  open_grab: "公开抢单",
  custom: "自定义订单",
  gameplay_mall: "固定玩法订单",
  gameplay: "固定玩法订单"
};
const REJECT_REASONS = [
  "正在服务其他订单",
  "时间无法配合",
  "临时有事",
  "不接该项目",
  "其他",
];
const COMPANION_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function anonHeaders(extra = {}) { return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra }; }
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
async function patchCompanionProfile(query, patch, { maxRetries = 8 } = {}) {
  let body = { ...patch };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  let lastError = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await supabaseJson(restUrl("companion_profiles", query), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      const msg = `${error?.message || ""} ${typeof error?.body === "string" ? error.body : JSON.stringify(error?.body || "")}`;
      const m = msg.match(/Could not find the '([^']+)' column/i);
      if (!m) throw error;
      const col = m[1];
      if (!(col in body)) throw error;
      delete body[col];
    }
  }
  throw lastError || new Error("companion_profiles 更新失败");
}
function authUrl(path) { return `${process.env.SUPABASE_URL}/auth/v1/${path}`; }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
function nowIso() { return new Date().toISOString(); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function monthKey() { return new Date().toISOString().slice(0, 7); }
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function roundMoney(value) { return Math.round(money(value) * 100) / 100; }
function formatSupabaseError(body, response, url = "") {
  const parts = [
    body?.error_description,
    body?.msg,
    body?.message,
    body?.error,
    body?.hint,
    body?.details,
    body?.code ? `code=${body.code}` : "",
    typeof body === "string" ? body.slice(0, 240) : "",
  ].filter(Boolean);
  const path = String(url || "").replace(String(process.env.SUPABASE_URL || ""), "").slice(0, 140);
  return `${parts[0] || "Supabase 请求失败"} (HTTP ${response?.status || "?"}${path ? `; ${path}` : ""})`;
}
function parseSettlementNote(note) {
  const text = String(note || "");
  const idx = text.indexOf(SETTLEMENT_PREFIX);
  if (idx === -1) return null;
  try {
    return JSON.parse(text.slice(idx + SETTLEMENT_PREFIX.length));
  } catch {
    return null;
  }
}
function findLevelForCompanion(levels, companion = {}) {
  const list = Array.isArray(levels) ? levels : [];
  const id = String(companion.level_id || "").trim();
  const name = String(companion.level_name || "").trim();
  return (
    list.find((l) => l.id === id) ||
    list.find((l) => String(l.code) === id || String(l.code) === name) ||
    list.find((l) => String(l.name) === name) ||
    list.find((l) => name && `${l.code || ""} ${l.name || ""}`.trim() === name) ||
    list.find((l) => name && String(l.name).includes(l.name)) ||
    list.find((l) => Number(l.level) === Number(((String(name).match(/\d+/) || [])[0]))) ||
    null
  );
}
async function resolveLevelBundle(companion = {}) {
  const levels = await readLocalLevels().catch(() => []);
  const level = findLevelForCompanion(levels, companion);
  const publicLevel = level ? toPublicLevel(level) : null;
  const levelPlatform = publicLevel ? money(publicLevel.commissionRate) : null;
  const { platformRate, companionShareRate } = resolvePlatformCommission(
    companion.commission_rate,
    levelPlatform != null ? levelPlatform : 20
  );
  const price = money(companion.price);
  const min = publicLevel ? money(publicLevel.min) : 0;
  const max = publicLevel ? money(publicLevel.max) : 0;
  const maxPlus = !!(publicLevel && publicLevel.maxPlus);
  const inRange = !publicLevel ? true : price >= min && (maxPlus ? true : price <= max);
  return {
    levels: levels.map(toPublicLevel),
    level: publicLevel,
    platformCommissionRate: platformRate,
    companionShareRate,
    minPrice: min,
    maxPrice: max,
    maxPlus,
    price,
    priceInRange: !price ? false : inRange,
    priceNeedsReset: !!price && !!publicLevel && !inRange,
  };
}
function buildSettlement({ order, boss = {}, companion = {}, rates, completedAt }) {
  const total = money(order.total_amount);
  const platformRate = money(rates.platformCommissionRate);
  const companionShare = money(rates.companionShareRate);
  const rebateRate = money(companion.direct_rebate_rate);
  const platformFee = roundMoney((total * platformRate) / 100);
  const rebateDeduction = roundMoney((total * rebateRate) / 100);
  const netIncome = roundMoney(Math.max(0, (total * companionShare) / 100 - rebateDeduction));
  return {
    orderId: order.id,
    orderNo: order.order_no || order.id,
    bossName: anonymousBossLabel(boss),
    bossUid: resolveBossPublicCode(boss),
    bossId: order.boss_id || "",
    serviceName: order.title || order.description || order.game || "陪玩服务",
    game: order.game || "",
    duration: order.hours ? `${order.hours}小时` : "",
    hours: money(order.hours),
    totalCatFood: total,
    platformCommissionRate: platformRate,
    platformCommissionCatFood: platformFee,
    rebateRate,
    rebateOrOtherDeduction: rebateDeduction,
    companionShareRate: companionShare,
    companionNetCatFood: netIncome,
    completedAt: completedAt || order.completed_at || nowIso(),
    settlementStatus: "已结算",
    levelId: rates.level?.id || companion.level_id || "",
    levelName: rates.level ? `${rates.level.code || ""} ${rates.level.name || ""}`.trim() : companion.level_name || "",
  };
}
function ledgerTypeLabel(row = {}) {
  const type = String(row.transaction_type || "");
  const note = String(row.note || "");
  if (type === "companion_income") {
    if (/打赏|礼物|gift/i.test(note)) return "打赏收入";
    if (/返点|邀请/i.test(note)) return "邀请返点";
    if (/抽成|platform/i.test(note) && /扣/.test(note)) return "平台抽成";
    return "订单收入";
  }
  if (type === "refund") return "退款扣回";
  if (type === "withdrawal") {
    if (/驳回|拒绝|退回/.test(note)) return "提现驳回退回";
    if (/申请|冻结/.test(note)) return "提现申请";
    return "提现完成";
  }
  if (type === "salary") return "其他收入";
  return type || "流水";
}
async function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; const chunks=[]; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }
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
    const err = new Error(formatSupabaseError(body, response, url));
    err.status = response.status >= 400 && response.status < 600 ? response.status : 500;
    err.body = body;
    err.url = url;
    throw err;
  }
  return body;
}
function tokenFrom(req) { return String(req.headers["x-mcj-companion-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(); }
async function authUserFromToken(token) { return supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) }); }
async function profileById(id) { const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() }); return rows?.[0] || null; }
async function companionProfile(userId) { const rows = await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`), { headers: serviceHeaders() }); return rows?.[0] || null; }

function maskEmailHint(email = "") {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return "";
  const name = e.slice(0, at);
  const domain = e.slice(at + 1);
  const shown = name.length <= 2 ? `${name[0] || "*"}*` : `${name.slice(0, 2)}***`;
  return `${shown}@${domain}`;
}

async function resolveCompanionAuthEmail(accountRaw = "") {
  const account = String(accountRaw || "").trim();
  if (!account) return null;
  const lower = account.toLowerCase();
  // MVP: email is the primary auth identity. Companion UID remains a password-login alias.
  if (/^\S+@\S+\.\S+$/.test(lower)) {
    const byEmail = await supabaseJson(
      restUrl("profiles", `?email=eq.${encodeURIComponent(lower)}&role=eq.companion&limit=1`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    if (byEmail?.[0]?.email) return { email: String(byEmail[0].email).toLowerCase(), profile: byEmail[0] };
    return { email: lower, profile: null };
  }
  const byUid = await supabaseJson(
    restUrl("companion_profiles", `?companion_uid=eq.${encodeURIComponent(account)}&select=user_id,companion_uid&limit=1`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (byUid?.[0]?.user_id) {
    const profile = await profileById(byUid[0].user_id);
    if (profile?.role === "companion" && profile.email) {
      return { email: String(profile.email).toLowerCase(), profile };
    }
  }
  return null;
}

function randomOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function storePasswordResetOtp(email, code) {
  const id = `pwr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const exp = Date.now() + 15 * 60 * 1000;
  const status = `otp:${code}:exp:${exp}`;
  try {
    await supabaseJson(restUrl("password_reset_requests"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ id, account: email, role: "companion", status, created_at: new Date().toISOString() }),
    });
    return { id, exp };
  } catch {
    globalThis.__mcjPwResets = globalThis.__mcjPwResets || new Map();
    globalThis.__mcjPwResets.set(email, { id, code, exp });
    return { id, exp, memory: true };
  }
}

async function findPasswordResetOtp(email) {
  const rows = await supabaseJson(
    restUrl(
      "password_reset_requests",
      `?account=eq.${encodeURIComponent(email)}&role=eq.companion&order=created_at.desc&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  for (const row of rows || []) {
    const m = String(row.status || "").match(/^otp:(\d{6}):exp:(\d+)$/);
    if (m) return { id: row.id, code: m[1], exp: Number(m[2]), row };
    const v = String(row.status || "").match(/^verified:([A-Za-z0-9_-]+):exp:(\d+)$/);
    if (v) return { id: row.id, verifiedToken: v[1], exp: Number(v[2]), row };
  }
  const mem = globalThis.__mcjPwResets?.get(email);
  if (mem) return mem;
  return null;
}

async function markPasswordResetVerified(email, rowId, token) {
  const exp = Date.now() + 15 * 60 * 1000;
  if (rowId) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(rowId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: `verified:${token}:exp:${exp}` }),
    }).catch(() => null);
  }
  globalThis.__mcjPwResets = globalThis.__mcjPwResets || new Map();
  globalThis.__mcjPwResets.set(email, { id: rowId || token, verifiedToken: token, exp });
  return exp;
}

async function requireCompanion(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录陪玩端。"), { status: 401 });
  let authUser;
  try {
    authUser = await authUserFromToken(token);
  } catch (error) {
    throw Object.assign(new Error("登录状态已过期，请重新登录后继续。"), { status: 401, cause: error });
  }
  if (!authUser?.id) throw Object.assign(new Error("登录状态已过期，请重新登录后继续。"), { status: 401 });
  const profile = await profileById(authUser.id);
  if (!profile) throw Object.assign(new Error("陪玩资料不存在（profiles 为空），无法查询钱包。"), { status: 403 });
  if (profile.role !== "companion") throw Object.assign(new Error("无权访问陪玩端。"), { status: 403 });
  if (profile.status === "disabled") throw Object.assign(new Error("陪玩账号已停用。"), { status: 403 });
  const companion = await companionProfile(profile.id);
  return { token, authUser, profile, companion };
}
function statusLabel(code) {
  return ({ online: "在线可接单", busy: "忙碌", paused: "暂停接单", offline: "离线" })[code] || "离线";
}
function normalizeOnlineStatus(raw) {
  const s = String(raw || "offline").toLowerCase();
  if (s === "online" || s === "busy" || s === "paused" || s === "offline") return s;
  return "offline";
}
function resolveDisplayAvatar(profile = {}, companion = {}) {
  const raw = String(profile.avatar_url || companion.card_image_url || "").trim();
  if (!raw || /default-avatar\.png$/i.test(raw) || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(raw)) {
    return "/default-avatar.png";
  }
  return raw;
}
const GALLERY_MARK_START = "[[MCJ_GALLERY:";
const GALLERY_MARK_END = "]]";

function readGalleryFallback(tags) {
  const text = String(tags || "");
  const i = text.indexOf(GALLERY_MARK_START);
  if (i < 0) return { items: [], baseTags: text };
  const j = text.indexOf(GALLERY_MARK_END, i);
  if (j < 0) return { items: [], baseTags: text };
  let items = [];
  try {
    items = JSON.parse(text.slice(i + GALLERY_MARK_START.length, j));
  } catch {
    items = [];
  }
  const baseTags = `${text.slice(0, i)}${text.slice(j + GALLERY_MARK_END.length)}`
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .trim();
  return { items: Array.isArray(items) ? items : [], baseTags };
}

function writeGalleryFallback(baseTags, items) {
  const cleaned = String(baseTags || "").trim();
  if (!items.length) return cleaned;
  return `${cleaned}${cleaned ? "," : ""}${GALLERY_MARK_START}${JSON.stringify(items)}${GALLERY_MARK_END}`;
}

async function listStoragePrefix(bucket, prefix) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ prefix: String(prefix || "").replace(/^\/+/, ""), limit: 50, offset: 0 }),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : [];
    } catch {
      body = [];
    }
    if (!response.ok) return [];
    return Array.isArray(body) ? body.filter((x) => x && x.name && !String(x.name).endsWith("/")) : [];
  } catch {
    return [];
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function isSyntheticMediaId(value) {
  const id = String(value || "").trim();
  if (!id || isUuid(id)) return false;
  return /^(storage-gallery-|legacy-gallery-|legacy-avatar|legacy-voice|fb-|legacy-)/i.test(id);
}

function humanizeCompanionApiError(error) {
  const raw = String(error?.message || error || "");
  const status = Number(error?.status) || 500;
  const blob = `${raw} ${typeof error?.body === "string" ? error.body : JSON.stringify(error?.body || "")}`;
  if (
    status === 401 ||
    /jwt|token is expired|invalid jwt|unable to parse or verify|unauthorized|登录态无效|请先登录|登录已过期/i.test(blob)
  ) {
    return { status: 401, message: "登录状态已过期，请重新登录后继续。" };
  }
  if (/invalid input syntax for type uuid|22P02/i.test(blob)) {
    return { status: 400, message: "媒体数据异常，请刷新后重试。" };
  }
  if (/HTTP\s*403|\/auth\/v1\/user/i.test(blob) && /jwt|token|expired|signature/i.test(blob)) {
    return { status: 401, message: "登录状态已过期，请重新登录后继续。" };
  }
  if (/PGRST|PostgREST|supabase|schema cache|permission denied for/i.test(blob) && !/请|上传|删除|相册|头像|录音|视频/.test(raw)) {
    return { status: status >= 400 && status < 600 ? status : 500, message: "操作失败，请稍后重试。" };
  }
  // Never leak raw HTTP / JWT / UUID dumps to companion UI.
  if (/invalid JWT|HTTP\s*\d{3}|invalid input syntax/i.test(raw)) {
    if (/jwt|token|expired|403|401/i.test(raw)) {
      return { status: 401, message: "登录状态已过期，请重新登录后继续。" };
    }
    return { status: status >= 400 && status < 600 ? status : 500, message: "操作失败，请稍后重试。" };
  }
  return { status: status >= 400 && status < 600 ? status : 500, message: raw || "陪玩端接口异常" };
}

/**
 * When companion_media exists but gallery rows are empty, migrate durable tag/storage
 * gallery fallbacks into real UUID rows once. Never rehydrate storage after DB has gallery
 * rows — that would resurrect deleted photos.
 */
async function migrateGalleryFallbacksIntoMedia(profile, companionRow, mediaRows) {
  if (!profile?.id || !companionRow?.id) return Array.isArray(mediaRows) ? mediaRows : [];
  const existing = Array.isArray(mediaRows) ? mediaRows.slice() : [];
  const galleryImageRows = existing.filter((m) => {
    if (String(m.media_type || "") !== "gallery") return false;
    const ctype = String(m.content_type || "").toLowerCase();
    return !/^video\//.test(ctype);
  });
  const pathKeys = new Set(
    galleryImageRows
      .map((m) => `${String(m.storage_bucket || "").trim()}::${String(m.storage_path || "").trim()}`)
      .filter((k) => !k.startsWith("::") && k !== "::")
  );

  const insertGallery = async (bucket, objectPath, sortOrder, uploadedAt) => {
    const key = `${bucket}::${objectPath}`;
    if (!bucket || !objectPath || pathKeys.has(key)) return null;
    try {
      const rows = await companionDb("companion_media", "", {
        method: "POST",
        body: JSON.stringify({
          companion_profile_id: companionRow.id,
          user_id: profile.id,
          media_type: "gallery",
          storage_bucket: bucket,
          storage_path: objectPath,
          content_type: "image/jpeg",
          status: "approved",
          sort_order: sortOrder || 100,
          uploaded_at: uploadedAt || nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
        }),
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.id) {
        pathKeys.add(key);
        existing.push(row);
        return row;
      }
    } catch {
      /* best-effort migrate */
    }
    return null;
  };

  const { items: tagItems, baseTags } = readGalleryFallback(companionRow.tags);
  let migratedFromTags = 0;
  for (const g of tagItems) {
    const bucket = String(g.bucket || "").trim();
    const objectPath = String(g.path || "").trim();
    if (!bucket || !objectPath) continue;
    const row = await insertGallery(bucket, objectPath, g.sortOrder || 100, g.uploadedAt || "");
    if (row) migratedFromTags += 1;
  }
  if (tagItems.length) {
    try {
      await patchCompanionProfile(`?id=eq.${encodeURIComponent(companionRow.id)}`, {
        tags: writeGalleryFallback(baseTags, []),
        updated_at: nowIso(),
      });
      companionRow.tags = writeGalleryFallback(baseTags, []);
    } catch {
      /* optional */
    }
  }

  // IMPORTANT: never re-list Storage into companion_media when the table exists.
  // Doing so resurrects deleted gallery photos (DB empty + leftover objects → migrate → back).
  // Tags marker is the only bootstrap fallback; orphans without DB rows stay ignored.
  void migratedFromTags;

  return existing;
}

async function synthesizeMediaFallback(profile, companion, opts = {}) {
  const allowStorageListing = opts.allowStorageListing !== false;
  const signedMedia = [];
  const avatarUrl = resolveDisplayAvatar(profile, companion || {});
  if (avatarUrl && avatarUrl !== "/default-avatar.png") {
    signedMedia.push({
      id: "legacy-avatar",
      mediaType: "avatar",
      status: "approved",
      rejectReason: "",
      durationSeconds: null,
      uploadedAt: companion?.updated_at || "",
      sortOrder: 0,
      url: avatarUrl,
    });
  }

  const { items: galleryItems } = readGalleryFallback(companion?.tags);
  const gallerySeen = new Set();
  for (const g of galleryItems) {
    let gUrl = g.url || "";
    if (!gUrl && g.bucket && g.path) {
      try {
        gUrl =
          g.bucket === PUBLIC_BUCKETS.profile
            ? publicObjectUrl(g.bucket, g.path)
            : await createSignedUrl(g.bucket, g.path, 60 * 60 * 24 * 7);
      } catch {
        gUrl = "";
      }
    }
    if (!gUrl || gallerySeen.has(gUrl)) continue;
    gallerySeen.add(gUrl);
    signedMedia.push({
      id: g.id || `legacy-gallery-${g.path || gUrl}`,
      mediaType: "gallery",
      status: "approved",
      rejectReason: "",
      durationSeconds: null,
      uploadedAt: g.uploadedAt || "",
      sortOrder: g.sortOrder || 100,
      url: gUrl,
    });
  }

  // Storage listing is ONLY a last-resort when companion_media table is missing.
  // When the table exists, empty gallery means empty — never re-list Storage (resurrects deletes).
  if (allowStorageListing && !gallerySeen.size && profile?.id) {
    const buckets = [PRIVATE_BUCKETS.gallery, PUBLIC_BUCKETS.profile];
    let sort = 100;
    for (const bucket of buckets) {
      const files = await listStoragePrefix(bucket, `${profile.id}/gallery`);
      for (const file of files.slice(0, 6)) {
        const objectPath = `${profile.id}/gallery/${file.name}`;
        let gUrl = "";
        try {
          gUrl =
            bucket === PUBLIC_BUCKETS.profile
              ? publicObjectUrl(bucket, objectPath)
              : await createSignedUrl(bucket, objectPath, 60 * 60 * 24 * 7);
        } catch {
          gUrl = "";
        }
        if (!gUrl || gallerySeen.has(gUrl)) continue;
        gallerySeen.add(gUrl);
        signedMedia.push({
          id: `storage-gallery-${bucket}-${file.name}`,
          mediaType: "gallery",
          status: "approved",
          rejectReason: "",
          durationSeconds: null,
          uploadedAt: file.updated_at || file.created_at || "",
          sortOrder: sort,
          url: gUrl,
          storageBucket: bucket,
          storagePath: objectPath,
        });
        sort += 10;
      }
    }
  }

  if (companion?.voice_url) {
    let voiceUrl = String(companion.voice_url || "").trim();
    if (/^storage:\/\//i.test(voiceUrl)) {
      const rest = voiceUrl.replace(/^storage:\/\//i, "");
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const bucket = rest.slice(0, slash);
        const objectPath = rest.slice(slash + 1);
        try {
          voiceUrl = await createSignedUrl(bucket, objectPath, 60 * 60 * 24 * 7);
        } catch {
          voiceUrl = "";
        }
      } else {
        voiceUrl = "";
      }
    } else if (/\/storage\/v1\/object\/sign\//i.test(voiceUrl) || (/[?&]token=/i.test(voiceUrl) && /\/storage\/v1\//i.test(voiceUrl))) {
      // Stale signed URL — skip; companion_media row (if any) will provide a fresh one.
      voiceUrl = "";
    }
    if (voiceUrl) {
      signedMedia.push({
        id: "legacy-voice",
        mediaType: "voice",
        status: "approved",
        rejectReason: "",
        durationSeconds: null,
        uploadedAt: companion?.updated_at || "",
        sortOrder: 999,
        url: voiceUrl,
      });
    }
  }
  return signedMedia;
}

function safePlayer(profile = {}, companion = {}) {
  // Unverified accounts cannot work: never expose stale busy/online to client/admin sync.
  let onlineStatus = normalizeOnlineStatus(companion.availability_status || companion.online_status);
  if (!canWork(profile, companion)) onlineStatus = "offline";
  const gamePrices = readGamePrices(companion);
  const serviceTypes = parseServiceTypes(companion.service_type, {
    fallbackPlayWhenGame: true,
    hasGame: !!(companion.game || parseServiceIds(companion.service_ids).length),
  });
  const serviceIds = parseServiceIds(companion.service_ids);
  const publicTags = stripGamePricesMarker(companion.tags || "")
    .replace(/\[\[MCJ_GALLERY:[\s\S]*?\]\]/g, "")
    .replace(/游戏ID:[^,，]*/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .trim();
  return {
    id: profile.id,
    uid: profile.id,
    email: profile.email || "",
    name: companion.nickname || profile.display_name || profile.email || "陪玩",
    avatar: resolveDisplayAvatar(profile, companion),
    hasCustomAvatar: !!(profile.avatar_url || companion.card_image_url) && resolveDisplayAvatar(profile, companion) !== "/default-avatar.png",
    mainGame: companion.game || "",
    game: companion.game || "",
    serviceType: serviceTypes[0] || "陪玩服务",
    serviceTypes,
    service_type: serviceTypes.join(","),
    serviceIds,
    service_ids: serviceIds,
    gameId: companion.game_id || ((String(companion.tags || "").match(/游戏ID:([^,，]+)/) || [])[1] || "").trim(),
    level: companion.level_name || "未设置",
    rawPrice: money(companion.price),
    price: money(companion.price),
    gamePrices,
    publicTags,
    voiceType: String(companion.voice_type || "").trim(),
    voice_type: String(companion.voice_type || "").trim(),
    bio: companion.description || "",
    voiceUrl: companion.voice_url || "",
    onlineStatus,
    onlineStatusLabel: statusLabel(onlineStatus),
    workStatus: statusLabel(onlineStatus),
    accountStatus: profile.status || "pending",
    profileReviewStatus: normalizeProfileReviewStatus(companion),
    profile_review_status: normalizeProfileReviewStatus(companion),
    depositStatus: normalizeDepositStatus(companion),
    deposit_status: normalizeDepositStatus(companion),
    accountAccessStatus: resolveAccountAccessStatus(profile, companion).status,
    account_access_status: resolveAccountAccessStatus(profile, companion).status,
    accountAccessLabel: resolveAccountAccessStatus(profile, companion).label,
    auditStatus: normalizeProfileReviewStatus(companion),
    verificationStatus: companion.verification_status || "pending",
    orderCommissionRate: resolvePlatformCommission(companion.commission_rate).platformRate,
    giftCommissionRate: money(companion.gift_commission_rate) || 0,
    directRebateRate: money(companion.direct_rebate_rate) || 0,
    applicationRejectReason: companion.application_reject_reason || "",
    mediaRejectReason: companion.media_reject_reason || "",
    tags: companion.tags || "",
    updatedAt: companion.updated_at || profile.updated_at || "",
    raw: { ...profile, ...companion }
  };
}
function normalizeProfileReviewStatus(companion = {}) {
  const raw = String(companion.application_status || "").trim().toLowerCase();
  if (/approved|verified|passed/.test(raw)) return "approved";
  if (/reject/.test(raw)) return "rejected";
  if (/resubmit|need_more/.test(raw)) return "need_more";
  if (/^draft$|^archived$|^deleted$/.test(raw)) return "draft";
  // submitted / pending_review → pending (审核中)
  if (/submitted|pending_review/.test(raw)) return "pending";
  // Legacy never-submitted register rows behave as draft for UI.
  if (!companion.application_submitted_at && !/pending|submitted|review/.test(raw)) return "draft";
  if (!companion.application_submitted_at && (!raw || raw === "pending")) return "draft";
  return "pending";
}
function normalizeDepositStatus(companion = {}, depositRow = null) {
  const raw = String(depositRow?.status || companion.deposit_status || "").trim().toLowerCase();
  if (/approved|verified|passed|paid|received/.test(raw)) return "approved";
  if (/reject/.test(raw)) return "rejected";
  if (/pending|review|submitted/.test(raw)) return "pending";
  if (/unpaid|draft|none|not_submitted/.test(raw) || !raw) return "unpaid";
  return "pending";
}
function profileReviewApproved(companion = {}) {
  return normalizeProfileReviewStatus(companion) === "approved";
}
function depositApproved(companion = {}, depositRow = null) {
  return normalizeDepositStatus(companion, depositRow) === "approved";
}
const COMPANION_AUTH_LOCK_MSG = "您的陪玩认证尚未通过，暂不可使用此功能。";
const COMPANION_ISOLATION_MSG = "您的陪玩认证尚未通过，目前只能查看审核进度。";
/** Actions allowed while application is not approved (isolation mode). */
const COMPANION_ISOLATION_ALLOWED_ACTIONS = new Set([
  "bootstrap",
  "inbox",
  "thread",
  "conversation_messages",
  "update_profile",
  "submit_application",
  "submit_verification",
  "upload_private_doc",
  "delete_private_doc",
  "submit_deposit",
  "submit_deposit_proof",
  "upload_media",
  "delete_media",
  "reorder_media",
  "start_cs_consult",
  "open_cs_conversation",
  "end_cs_conversation",
  "end_conversation",
  "send_cs_message",
  "send_message",
  "mark_notices_read",
  "mark_all_read",
  "mark_cs_read",
  "read_cs_conversation",
  "acknowledge_forced",
  "ack_forced_announcement",
  "pending_forced",
]);
/** Maps "companion.enabled" — no dedicated column; allow_orders / enabled flag. */
function companionEnabled(companion = {}) {
  if (companion.enabled === false || companion.enabled === 0 || companion.enabled === "false") return false;
  if (companion.allow_orders === false) return false;
  return true;
}
/**
 * Isolation UI gate: draft / pending_review / rejected / need_more, or non-active account.
 * Approved companions leave isolation even if deposit/canWork still soft-locks grab.
 */
function isCompanionIsolated(profile = {}, companion = {}) {
  const accountOk = !profile.status || profile.status === "active" || profile.status === "pending";
  if (profile.status && profile.status !== "active" && profile.status !== "pending") return true;
  if (!accountOk) return true;
  return normalizeProfileReviewStatus(companion) !== "approved";
}
/**
 * Business API gate: application approved + companion enabled + account active.
 */
function assertCompanionBusinessAccess(profile = {}, companion = {}) {
  const appOk = normalizeProfileReviewStatus(companion) === "approved";
  const accountOk = profile.status === "active";
  const enabled = companionEnabled(companion);
  if (appOk && accountOk && enabled) return;
  const err = new Error(COMPANION_ISOLATION_MSG);
  err.status = 403;
  err.code = "COMPANION_ISOLATED";
  err.applicationStatus = normalizeProfileReviewStatus(companion);
  err.accountStatus = profile.status || "";
  err.companionEnabled = enabled;
  throw err;
}
function isolationForbiddenResponse(res, err) {
  return json(res, err?.status || 403, {
    ok: false,
    message: err?.message || COMPANION_ISOLATION_MSG,
    code: err?.code || "COMPANION_ISOLATED",
    applicationStatus: err?.applicationStatus,
    accountStatus: err?.accountStatus,
    companionEnabled: err?.companionEnabled,
  });
}
function resolveCredentialMode(companion = {}, depositRow = null) {
  const tagged = String(companion.credential_mode || companion.auth_mode || "").trim().toLowerCase();
  if (tagged === "id_card" || tagged === "deposit") return tagged;
  const note = String(companion.application_note || "");
  const m = note.match(/\[AUTH_MODE:(id_card|deposit)\]/i);
  if (m) return m[1].toLowerCase();
  const depSt = normalizeDepositStatus(companion, depositRow);
  if (depSt === "approved" || depSt === "pending") return "deposit";
  return "id_card";
}
/**
 * Work/order access: approved application + active + allow_orders.
 * Deposit is XOR with id_card — only required when credential_mode=deposit.
 */
function resolveAccountAccessStatus(profile = {}, companion = {}, depositRow = null) {
  const profileSt = normalizeProfileReviewStatus(companion);
  const depositSt = normalizeDepositStatus(companion, depositRow);
  const authMode = resolveCredentialMode(companion, depositRow);
  if (profile.status && profile.status !== "active" && profile.status !== "pending") {
    return { status: "blocked", label: "账号已停用，无法接单。" };
  }
  if (profile.status !== "active") {
    return { status: "pending", label: "账号尚未启用，暂时无法接单。" };
  }
  if (companion.allow_orders === false && profileSt === "approved") {
    return { status: "blocked", label: "后台已暂停该账号接单权限。" };
  }
  if (profileSt === "rejected") {
    const appReason = String(companion.application_reject_reason || "").trim();
    return {
      status: "rejected",
      label: appReason ? `审核未通过：${appReason}` : "资料审核未通过，请修改后重新提交。",
    };
  }
  if (profileSt === "need_more") {
    const appReason = String(companion.application_reject_reason || "").trim();
    return {
      status: "need_more",
      label: appReason ? `需补交资料：${appReason}` : "请按审核意见补交资料后再接单。",
    };
  }
  if (profileSt === "draft") {
    return { status: "draft", label: "资料未完成，请继续填写申请。完成后提交审核。" };
  }
  if (profileSt !== "approved") {
    return { status: "pending", label: "资料审核中，暂时无法接单。" };
  }
  // application approved
  if (authMode === "deposit" && depositSt === "rejected") {
    const depReason = String(depositRow?.reject_reason || companion.deposit_reject_reason || "").trim();
    return {
      status: "rejected",
      label: depReason ? `押金审核未通过：${depReason}` : "押金审核未通过，请重新提交。",
    };
  }
  if (authMode === "deposit" && depositSt !== "approved") {
    if (depositSt === "unpaid") {
      return { status: "pending", label: "请完成押金认证后再接单。" };
    }
    return { status: "pending", label: "押金审核中，暂时无法接单。" };
  }
  if (companion.allow_orders === false) {
    return { status: "blocked", label: "后台已暂停该账号接单权限。" };
  }
  return { status: "approved", label: "认证已通过，可正常接单。" };
}
function canWork(profile = {}, companion = {}, depositRow = null) {
  return resolveAccountAccessStatus(profile, companion, depositRow).status === "approved";
}
function canAccept(profile = {}, companion = {}, depositRow = null) {
  return canWork(profile, companion, depositRow) && normalizeOnlineStatus(companion.availability_status || companion.online_status) === "online";
}
function auditLockMessage(profile = {}, companion = {}, depositRow = null) {
  const access = resolveAccountAccessStatus(profile, companion, depositRow);
  if (access.status === "approved") return "";
  if (access.status === "rejected" || access.status === "need_more") return access.label || COMPANION_AUTH_LOCK_MSG;
  if (access.status === "draft") return access.label || "资料未完成，请继续填写申请。";
  return COMPANION_AUTH_LOCK_MSG;
}
function applyUnifiedAccessFields(player, profile, companionRow, depositRow = null) {
  const access = resolveAccountAccessStatus(profile, companionRow, depositRow);
  const profileReview = normalizeProfileReviewStatus(companionRow);
  const depositSt = normalizeDepositStatus(companionRow, depositRow);
  player.profileReviewStatus = profileReview;
  player.profile_review_status = profileReview;
  player.depositStatus = depositSt;
  player.deposit_status = depositSt;
  player.accountAccessStatus = access.status;
  player.account_access_status = access.status;
  player.accountAccessLabel = access.label;
  player.auditStatus = profileReview;
  return access;
}
function stripOrderFacingText(text = "") {
  return String(text || "")
    .replace(/\[\[ORDER_GRABS\]\][\s\S]*?\[\[\/ORDER_GRABS\]\]/g, "")
    .replace(/\[\[ORDER_GRABS\]\][\s\S]*$/g, "")
    .split("[[COMPLETION_PENDING]]")
    .join("")
    .replace(/\buuid\s+create\s+regression\s+\d+\b/gi, "")
    .replace(/\bcreate\s+regression\s+\d+\b/gi, "")
    .replace(/\bregression\s+\d+\b/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\b(selector|grabber|ORDER_GRABS|COMPLETION_PENDING)\b/gi, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
function viewOrder(row = {}, boss = {}, settlement = null) {
  const parsed = settlement || parseSettlementNote(row.settlement_note) || null;
  const rate = money(parsed?.companionShareRate || row.commission_rate || row.player_commission_rate || row.companion_rate || 80) || 80;
  const amount = money(row.total_amount);
  const net = parsed ? money(parsed.companionNetCatFood) : roundMoney((amount * rate) / 100);
  const platformFee = parsed ? money(parsed.platformCommissionCatFood) : roundMoney(amount - net);
  const description = stripOrderFacingText(row.description || "");
  const gameIdFromDesc = (description.match(/游戏ID[：:]\s*([^\n；;]+)/i) || [])[1] || "";
  const serverFromDesc =
    (description.match(/(?:区服|服务器|大区)[：:]\s*([^\n；;]+)/i) || [])[1] ||
    (String(row.server || row.region || row.game_server || "").trim());
  const notesLine = (() => {
    const rawNotes = stripOrderFacingText(row.notes || "").trim();
    if (rawNotes && !/^(区服|服务器|大区|游戏ID|付款方式)[：:]/i.test(rawNotes)) return rawNotes;
    const remarkFromDesc = (description.match(/(?:老板备注|备注)[：:]\s*([^\n；;]+)/i) || [])[1];
    if (remarkFromDesc) return stripOrderFacingText(remarkFromDesc).trim();
    return rawNotes || "";
  })();
  const gameId = String(row.game_id_value || row.game_id || gameIdFromDesc || "").trim();
  const unitPrice = money(row.unit_price);
  const confirmAnchor = row.accepted_at || row.created_at || "";
  // Companion confirm timeout cancelled — no deadline countdown.
  const confirmDeadline =
    COMPANION_CONFIRM_TIMEOUT_MS > 0 && confirmAnchor
      ? new Date(Date.parse(confirmAnchor) + COMPANION_CONFIRM_TIMEOUT_MS).toISOString()
      : "";
  const orderTypeKey = row.order_type || "custom";
  const completionPending =
    String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
    String(row.description || "").includes("[[COMPLETION_PENDING]]");
  let statusText = ORDER_STATUS_TEXT[row.status] || row.status || "待付款确认";
  if (row.status === "in_progress" && completionPending) statusText = "待老板确认完成";
  if (row._grabStatus === "pending_customer_selection") statusText = "等待老板选择";
  if (row._grabStatus === "not_selected") statusText = "该订单已由其他陪玩接单。";
  const countdown = completionCountdown(row);
  const serviceContent =
    description ||
    stripOrderFacingText(row.title || "") ||
    stripOrderFacingText(row.note || "") ||
    "";
  const durationLabel = row.hours
    ? `${row.hours}小时`
    : row.rounds || row.games_count
      ? `${row.rounds || row.games_count}局`
      : "";
  return {
    id: row.id,
    orderNo: row.order_no || row.id,
    orderType: ORDER_TYPE_TEXT[orderTypeKey] || orderTypeKey,
    orderTypeKey,
    orderSource: ORDER_TYPE_TEXT[orderTypeKey] || orderTypeKey,
    companionId: row.companion_id || "",
    bossName: anonymousBossLabel(boss),
    bossUid: resolveBossPublicCode(boss),
    bossId: row.boss_id || "",
    game: row.game || "",
    gameServer: serverFromDesc || "-",
    serviceContent: serviceContent || "无补充说明",
    serviceName: row.service_name || row.game || row.title || "",
    serviceType: row.service_name || row.title || ORDER_TYPE_TEXT[orderTypeKey] || orderTypeKey,
    duration: durationLabel,
    hours: money(row.hours),
    unitPrice,
    amount,
    playerIncome: net,
    platformFee,
    gameId,
    bossNotes: notesLine,
    remark: notesLine,
    confirmDeadline,
    acceptedAt: row.accepted_at || "",
    startedAt: row.started_at || "",
    requiredLevel: "不限",
    requiredTags: "无特殊标签",
    orderStatus: statusText,
    status: row.status,
    statusText,
    grabStatus: row._grabStatus || "",
    completionPending,
    completionRequestedAt: countdown.completionRequestedAt || "",
    autoConfirmAt: countdown.autoConfirmAt || "",
    autoConfirmRemainingMs: countdown.autoConfirmRemainingMs,
    autoConfirmRemainingLabel: formatRemainingLabel(countdown.autoConfirmRemainingMs),
    autoConfirmPaused: !!countdown.autoConfirmPaused,
    autoConfirmPausedReason: countdown.autoConfirmPausedReason || "",
    completionMethod: parseCompletionMethod(row) || "",
    paidAt: row.paid_at || "",
    paymentReviewedByName: row.paymentReviewedByName || "",
    paymentReviewedByStaffId: row.paymentReviewedByStaffId || "",
    paymentReviewedAt: row.paymentReviewedAt || "",
    paymentReviewStatus: row.paymentReviewStatus || "",
    paymentRejectReason: row.paymentRejectReason || "",
    appointmentAt: row.created_at || "",
    createdAt: row.created_at || "",
    completedAt: row.completed_at || parsed?.completedAt || "",
    settlement,
    hasSettlement: !!parsed || row.status === "completed",
    isDesignatedConfirm: row.status === "claimed",
    assignmentType: row.assignment_type || "",
    raw: row
  };
}
async function bossesForOrders(orders) { const ids=[...new Set((orders||[]).map((row)=>row.boss_id).filter(Boolean))]; if(!ids.length) return {}; const rows=await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() }); return Object.fromEntries((rows||[]).map((row)=>[row.id,row])); }
async function loadOrdersFor(profile, companion, transactions = []) {
  const {
    resolveAssignmentType,
    isPublicHallEligible,
    sanitizeHallOrderView,
    ASSIGNMENT_ASSIGNED,
    ASSIGNMENT_PUBLIC,
  } = await import("./_order-assignment.js");
  try {
    const { expireCompanionConfirmTimeouts } = await import("./_order-confirm-timeout.js");
    await expireCompanionConfirmTimeouts({ companionId: profile.id, limit: 40 });
  } catch {
    /* best-effort */
  }
  try {
    const { createOrderCompleteHelpers } = await import("./_order-complete.js");
    const helpers = createOrderCompleteHelpers({
      restUrl,
      supabaseJson,
      serviceHeaders,
      addSystemMessage: async (order, actorId, content) =>
        addSystemMessage(order, actorId || order.boss_id, "system", content),
    });
    await Promise.race([
      helpers.expireCompletionAutoConfirms({ limit: 15 }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* best-effort auto-complete */
  }
  const myRows = await supabaseJson(restUrl("orders", `?companion_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=200`), { headers: serviceHeaders() });
  // Best-effort: warn near confirm timeout (idempotent email/inbox).
  try {
    const { maybeNotifyConfirmDeadlineWarning } = await import("./_companion-order-notify.js");
    const claimed = (myRows || []).filter((row) => row.status === "claimed").slice(0, 8);
    await Promise.all(
      claimed.map((row) =>
        maybeNotifyConfirmDeadlineWarning(row).catch(() => null)
      )
    );
  } catch {
    /* ignore */
  }
  // Never surface unpaid designated orders (awaiting_payment) as actionable confirm tasks.
  // Assigned pending-confirm stays in 我的订单→待确认 only.
  const visibleMine = (myRows || []).filter((row) => row.status !== "awaiting_payment");
  // 抢单大厅 ONLY: public (or null assignment_type) + companion_id null + hall-open statuses.
  const openQueryWithType =
    "?and=(or(assignment_type.eq.public,assignment_type.is.null),companion_id.is.null,or(status.eq.pending,status.eq.waiting_boss_confirm))&order=created_at.desc&limit=100";
  const openQueryFallback =
    "?and=(companion_id.is.null,or(status.eq.pending,status.eq.waiting_boss_confirm))&order=created_at.desc&limit=100";
  let openRows = [];
  try {
    openRows = await supabaseJson(restUrl("orders", openQueryWithType), { headers: serviceHeaders() });
  } catch (err) {
    if (/assignment_type|PGRST204|schema cache|column/i.test(String(err?.message || err || ""))) {
      openRows = await supabaseJson(restUrl("orders", openQueryFallback), { headers: serviceHeaders() }).catch(() => []);
    } else {
      openRows = [];
    }
  }
  openRows = (openRows || []).filter((row) => isPublicHallEligible(row));
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const { hallStateForOrder, hallStateLabel, toFlowStatus, isOrderExpired } = await import("./_order-flow.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
  const myGrabRows = await grabsApi.listMyPendingGrabs(profile.id);
  // Also load not_selected / selected grabs for this companion (outcome visibility).
  let myOutcomeGrabs = [];
  try {
    myOutcomeGrabs = await supabaseJson(
      restUrl(
        "order_grabs",
        `?companion_id=eq.${encodeURIComponent(profile.id)}&or=(status.eq.not_selected,status.eq.selected)&order=grabbed_at.desc&limit=40`
      ),
      { headers: serviceHeaders() }
    );
    if (!Array.isArray(myOutcomeGrabs)) myOutcomeGrabs = [];
  } catch {
    myOutcomeGrabs = [];
  }
  const grabOrderIds = [...new Set([...myGrabRows.map((g) => g.order_id), ...myOutcomeGrabs.map((g) => g.order_id)].filter(Boolean))];
  let grabOrders = [];
  if (grabOrderIds.length) {
    grabOrders = await supabaseJson(
      restUrl("orders", `?id=in.(${grabOrderIds.map(encodeURIComponent).join(",")})&order=created_at.desc`),
      { headers: serviceHeaders() }
    ).catch(() => []);
  }
  // Settled hall cards: ONLY public-hall history (had grabs). Never assigned-only orders.
  // Prefer orders this companion actually grabbed; fall back to recent public settled with grabs.
  const settledCandidateIds = [...new Set(grabOrderIds)];
  let settledRows = [];
  if (settledCandidateIds.length) {
    settledRows = await supabaseJson(
      restUrl(
        "orders",
        `?id=in.(${settledCandidateIds.map(encodeURIComponent).join(",")})&or=(status.eq.claimed,status.eq.confirmed,status.eq.in_progress,status.eq.cancelled,status.eq.completed)&order=created_at.desc&limit=40`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
  }
  // Optional: recent public settled (assignment_type=public) that others grabbed — still only if grabs exist.
  let recentPublicSettled = [];
  try {
    recentPublicSettled = await supabaseJson(
      restUrl(
        "orders",
        "?and=(assignment_type.eq.public,companion_id.not.is.null,or(status.eq.claimed,status.eq.confirmed,status.eq.in_progress,status.eq.cancelled))&order=created_at.desc&limit=30"
      ),
      { headers: serviceHeaders() }
    );
  } catch {
    recentPublicSettled = [];
  }
  const settledById = new Map();
  for (const row of [...(settledRows || []), ...(recentPublicSettled || [])]) {
    if (!row?.id) continue;
    if (resolveAssignmentType(row) === ASSIGNMENT_ASSIGNED) continue;
    settledById.set(row.id, row);
  }
  const openSlice = (openRows || []).slice(0, 40);
  const openNoteMap = Object.fromEntries(openSlice.map((row) => [row.id, row.note || row.description || ""]));
  const openGrabMap = await grabsApi.listGrabsBatch(
    openSlice.map((row) => row.id),
    openNoteMap
  );
  const openWithMine = openSlice.map((row) => {
    const grabs = openGrabMap[row.id] || [];
    const mine = grabs.find((g) => g.companionId === profile.id);
    const hallState = hallStateForOrder(row, grabs);
    return { ...row, _myGrab: mine || null, _grabs: grabs, _hallState: hallState, _hadPublicGrabs: true };
  });
  const openIds = new Set(openWithMine.map((r) => r.id));
  const settledSlice = [...settledById.values()].slice(0, 30);
  const settledNoteMap = Object.fromEntries(settledSlice.map((row) => [row.id, row.note || row.description || ""]));
  const settledGrabMap = await grabsApi.listGrabsBatch(
    settledSlice.map((row) => row.id),
    settledNoteMap
  );
  const settledHall = [];
  for (const row of settledSlice) {
    if (openIds.has(row.id)) continue;
    if (resolveAssignmentType({ ...row, _hadPublicGrabs: true }) === ASSIGNMENT_ASSIGNED) continue;
    const grabs = settledGrabMap[row.id] || [];
    // Hard privacy rule: no grab history ⇒ never show in public hall (blocks assigned leaks).
    if (!grabs.length) continue;
    const createdMs = Date.parse(row.accepted_at || row.created_at || "") || 0;
    if (createdMs && Date.now() - createdMs > 1000 * 60 * 60 * 48) continue; // 48h retention
    const hallState = hallStateForOrder(row, grabs);
    if (!["settled", "cancelled", "expired"].includes(hallState)) continue;
    settledHall.push({
      ...row,
      _myGrab: grabs.find((g) => g.companionId === profile.id) || null,
      _grabs: grabs,
      _hallState: hallState,
      _hadPublicGrabs: true,
    });
  }
  const mineIds = new Set(visibleMine.map((r) => r.id));
  const pendingSelection = [];
  for (const row of grabOrders || []) {
    if (mineIds.has(row.id)) continue;
    // Assigned orders must not leak into "pending selection" via grab rows.
    if (resolveAssignmentType(row) === ASSIGNMENT_ASSIGNED) continue;
    const g =
      myGrabRows.find((x) => x.order_id === row.id) ||
      myOutcomeGrabs.find((x) => x.order_id === row.id);
    pendingSelection.push({ ...row, _grabStatus: g?.status || "pending_customer_selection" });
  }
  for (const row of openWithMine) {
    if (row._myGrab && !mineIds.has(row.id) && !pendingSelection.some((p) => p.id === row.id)) {
      pendingSelection.push({ ...row, _grabStatus: row._myGrab.status });
    }
  }
  const bossMap = await bossesForOrders([...visibleMine, ...pendingSelection, ...openWithMine, ...settledHall]);
  const settlementByOrder = {};
  (transactions || []).forEach((tx) => {
    if (tx.transaction_type !== "companion_income" || !tx.order_id) return;
    const parsed = parseSettlementNote(tx.note);
    if (parsed) settlementByOrder[tx.order_id] = { ...parsed, transactionId: tx.id, settledAmount: money(tx.amount) };
  });
  let approvedPaymentByOrder = {};
  try {
    const { latestApprovedForOrders, receiptReviewerFields } = await import("./_payment-receipts.js");
    const payIds = [...visibleMine, ...pendingSelection]
      .map((r) => r.id)
      .filter(Boolean);
    if (payIds.length) {
      approvedPaymentByOrder = await latestApprovedForOrders(payIds);
    }
    for (const [oid, receipt] of Object.entries(approvedPaymentByOrder || {})) {
      const fields = receiptReviewerFields(receipt);
      const target = visibleMine.find((r) => r.id === oid) || pendingSelection.find((r) => r.id === oid);
      if (target) Object.assign(target, fields);
    }
  } catch {
    approvedPaymentByOrder = {};
  }
  return {
    myOrders: [
      ...visibleMine.map((row) => {
        const v = viewOrder(row, bossMap[row.boss_id] || {}, settlementByOrder[row.id] || null);
        return {
          ...v,
          assignmentType: resolveAssignmentType(row),
          isDesignatedConfirm:
            row.status === "claimed" && resolveAssignmentType(row) === ASSIGNMENT_ASSIGNED,
        };
      }),
      ...pendingSelection.map((row) =>
        viewOrder(row, bossMap[row.boss_id] || {}, settlementByOrder[row.id] || null)
      ),
    ],
    openOrders: [...openWithMine, ...settledHall].map((row) => {
      const viewed = viewOrder(row, bossMap[row.boss_id] || {});
      const hallState = row._hallState || hallStateForOrder(row, row._grabs || []);
      const hallView = {
        ...viewed,
        assignmentType: ASSIGNMENT_PUBLIC,
        myGrab: row._myGrab || null,
        grabCount: (row._grabs || []).length,
        alreadyGrabbed: !!row._myGrab,
        hallState,
        hallStateLabel: hallStateLabel(hallState),
        flowStatus: toFlowStatus(row.status, { expired: isOrderExpired(row) }),
        canGrab: hallState === "open" || hallState === "grabbing",
      };
      return sanitizeHallOrderView(hallView);
    }),
  };
}
async function transactionsFor(userId) {
  try {
    const rows = await supabaseJson(
      restUrl("transactions", `?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=200`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    // Soft-fail: missing table / column / RLS must not blank the wallet page.
    if (isMissingRelation(error) || /column|schema cache|PGRST|permission|RLS/i.test(String(error.message || ""))) {
      return [];
    }
    throw error;
  }
}
async function financeSettings() {
  try {
    const rows = await companionDb("finance_settings", "?id=eq.1&limit=1");
    return (
      rows?.[0] || {
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 3,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
      }
    );
  } catch (e) {
    if (isMissingRelation(e)) {
      return {
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 3,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
      };
    }
    throw e;
  }
}
async function withdrawalsFor(userId) {
  try {
    const rows = await companionDb(
      "companion_withdrawals",
      `?companion_id=eq.${encodeURIComponent(userId)}&order=submitted_at.desc&limit=100`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (isMissingRelation(e) || /column|schema cache|PGRST|permission|RLS/i.test(String(e.message || ""))) return [];
    throw e;
  }
}

function emptyWalletBundle() {
  return {
    transactions: [],
    withdrawalRows: [],
    summary: {
      todayOrders: 0,
      waitingConfirm: 0,
      waitingStart: 0,
      waitingComplete: 0,
      runningOrders: 0,
      completedOrders: 0,
      todayCompleted: 0,
      todayIncome: 0,
      todayExpectedIncome: 0,
      monthIncome: 0,
      totalIncome: 0,
      withdrawn: 0,
      frozen: 0,
      pendingSettlement: 0,
      withdrawable: 0,
      unreadMessages: 0,
      monthReviews: 0,
      designatedPending: 0,
    },
    walletLedger: [],
    earningDetails: [],
    earnings: {
      todayIncome: 0,
      yesterdayIncome: 0,
      weekIncome: 0,
      monthIncome: 0,
      totalIncome: 0,
      withdrawable: 0,
      available: 0,
      frozen: 0,
      pendingSettlement: 0,
      withdrawn: 0,
    },
  };
}

async function loadWalletBundle(profile, myOrders = []) {
  const warnings = [];
  let transactions = [];
  let withdrawalRows = [];
  try {
    transactions = await transactionsFor(profile.id);
  } catch (error) {
    warnings.push(`transactions: ${error.message || error}`);
    transactions = [];
  }
  try {
    withdrawalRows = await withdrawalsFor(profile.id);
  } catch (error) {
    warnings.push(`companion_withdrawals: ${error.message || error}`);
    withdrawalRows = [];
  }
  const summary = summaryFrom(myOrders, transactions, withdrawalRows);
  const ledgerFromTx = (transactions || []).map((row) => ({
    id: row.id,
    orderId: row.order_id || "",
    type: ledgerTypeLabel(row),
    typeCode: row.transaction_type,
    amount: money(row.amount),
    direction: row.transaction_type === "refund" || row.transaction_type === "withdrawal" ? "out" : "in",
    status: row.status || "completed",
    note: row.note || "",
    createdAt: row.created_at,
    settlement: parseSettlementNote(row.note),
  }));
  const ledgerFromWithdraw = (withdrawalRows || []).flatMap((w) => {
    const rows = [
      {
        id: `wd-apply-${w.id}`,
        orderId: "",
        type: "提现申请",
        typeCode: "withdrawal_request",
        amount: money(w.cat_food_amount),
        direction: "out",
        status: w.status,
        note: w.remark || "",
        createdAt: w.submitted_at || w.created_at,
        withdrawalId: w.id,
      },
    ];
    if (w.status === "rejected") {
      rows.push({
        id: `wd-reject-${w.id}`,
        orderId: "",
        type: "提现驳回退回",
        typeCode: "withdrawal_reject_return",
        amount: money(w.cat_food_amount),
        direction: "in",
        status: "completed",
        note: w.reject_reason || "",
        createdAt: w.updated_at || w.submitted_at || w.created_at,
        withdrawalId: w.id,
      });
    }
    return rows;
  });
  const walletLedger = [...ledgerFromTx, ...ledgerFromWithdraw].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  const earningDetails = ledgerFromTx
    .filter((row) => row.typeCode === "companion_income")
    .map((row) => {
      const settlement = row.settlement || parseSettlementNote(row.note) || {};
      return {
        ...row,
        orderNo: settlement.orderNo || settlement.order_no || "",
        grossAmount: money(settlement.orderAmountCatFood || settlement.gross || row.amount),
        platformFee: money(settlement.platformCommissionCatFood || settlement.platformFee || 0),
        netIncome: money(settlement.companionNetCatFood || row.amount),
        statusText: row.status === "completed" ? "已完成" : row.status === "pending" ? "待处理" : row.status || "-",
      };
    });
  return {
    transactions,
    withdrawalRows,
    summary,
    walletLedger,
    earningDetails,
    earnings: {
      todayIncome: summary.todayIncome || 0,
      yesterdayIncome: summary.yesterdayIncome || 0,
      weekIncome: summary.weekIncome || 0,
      monthIncome: summary.monthIncome || 0,
      totalIncome: summary.totalIncome || 0,
      withdrawable: summary.withdrawable || 0,
      available: summary.withdrawable || 0,
      frozen: summary.frozen || 0,
      pendingSettlement: summary.pendingSettlement || 0,
      withdrawn: summary.withdrawn || 0,
    },
    warnings,
  };
}
function summaryFrom(myOrders, transactions, withdrawals = []) {
  const today = todayKey();
  const month = monthKey();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const weekStart = (() => {
    const d = new Date();
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    return d.toISOString().slice(0, 10);
  })();
  const incomeRows = (transactions || []).filter((row) => row.transaction_type === "companion_income" && row.status !== "cancelled");
  const refundRows = (transactions || []).filter((row) => row.transaction_type === "refund" && row.status !== "cancelled");
  const frozen = (withdrawals || [])
    .filter((w) => WITHDRAW_FROZEN.has(w.status))
    .reduce((n, w) => n + money(w.cat_food_amount), 0);
  const withdrawn = (withdrawals || [])
    .filter((w) => w.status === "completed")
    .reduce((n, w) => n + money(w.cat_food_amount), 0);
  const locked = (withdrawals || [])
    .filter((w) => WITHDRAW_ACTIVE.has(w.status))
    .reduce((n, w) => n + money(w.cat_food_amount), 0);
  const gross = incomeRows.reduce((n, row) => n + money(row.amount), 0);
  const refundTotal = refundRows.reduce((n, row) => n + money(row.amount), 0);
  const netGross = Math.max(0, roundMoney(gross - refundTotal));
  const sumIncomeOn = (pred) => incomeRows.filter(pred).reduce((n, row) => n + money(row.amount), 0);
  return {
    todayOrders: myOrders.filter((o) => String(o.createdAt || "").slice(0,10) === today).length,
    waitingConfirm: myOrders.filter((o) => o.status === "claimed").length,
    waitingStart: myOrders.filter((o) => o.status === "confirmed" || o.status === "in_progress").length,
    waitingComplete: myOrders.filter((o) => o.status === "waiting_boss_confirm" && o.startedAt).length,
    runningOrders: myOrders.filter((o) => o.status === "in_progress").length,
    completedOrders: myOrders.filter((o) => o.status === "completed").length,
    todayCompleted: myOrders.filter((o) => o.status === "completed" && String(o.completedAt || "").slice(0,10) === today).length,
    todayIncome: sumIncomeOn((row) => String(row.created_at || "").slice(0, 10) === today),
    yesterdayIncome: sumIncomeOn((row) => String(row.created_at || "").slice(0, 10) === yesterday),
    weekIncome: sumIncomeOn((row) => String(row.created_at || "").slice(0, 10) >= weekStart),
    todayExpectedIncome: myOrders
      .filter((o) => ["claimed", "confirmed", "in_progress"].includes(o.status) && String(o.createdAt || "").slice(0, 10) === today)
      .reduce((n, o) => n + money(o.playerIncome), 0),
    monthIncome: sumIncomeOn((row) => String(row.created_at || "").slice(0, 7) === month),
    totalIncome: netGross,
    withdrawn,
    frozen,
    pendingSettlement: frozen,
    withdrawable: Math.max(0, roundMoney(netGross - locked)),
    unreadMessages: 0,
    monthReviews: 0,
    designatedPending: myOrders.filter((o) => o.status === "claimed").length,
  };
}
async function bootstrapData(profile, companion) {
  const warnings = [];
  // Heal stale online/busy while audit-locked so admin/companion/boss stay consistent.
  let companionRow = companion || {};
  const isolated = isCompanionIsolated(profile, companionRow);
  if (!canWork(profile, companionRow) || isolated) {
    const cur = normalizeOnlineStatus(companionRow.availability_status || companionRow.online_status);
    if (cur !== "offline") {
      try {
        await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            online_status: "offline",
            updated_at: nowIso(),
          }),
        });
        companionRow = { ...companionRow, online_status: "offline", availability_status: "offline" };
      } catch (error) {
        warnings.push(`offline_heal: ${error.message || error}`);
        companionRow = { ...companionRow, online_status: "offline", availability_status: "offline" };
      }
    }
  }
  const player = safePlayer(profile, companionRow);
  const permissions = {
    canLogin: true,
    canWork: canWork(profile, companionRow),
    canSetAvailable: canWork(profile, companionRow),
    canAcceptOrder: canAccept(profile, companionRow),
    canStartOrder: canWork(profile, companionRow),
    canWithdraw: false,
    messagesMode: isolated ? "system_cs_only" : "system_only",
    lockReason: auditLockMessage(profile, companionRow),
    isolationMode: isolated,
    applicationStatus: normalizeProfileReviewStatus(companionRow),
    accountStatus: profile.status || "active",
    companionEnabled: companionEnabled(companionRow),
    isolationMessage: isolated ? COMPANION_ISOLATION_MSG : "",
    allowedRoutes: isolated
      ? ["review-status", "profile", "account", "login"]
      : null,
  };
  const [cfg, levelBundle] = await Promise.all([
    isolated
      ? Promise.resolve({
          min_withdraw_cat_food: 50,
          max_withdrawals_per_month: 3,
          cat_food_to_rm_rate: 1,
          withdraw_fee_rm: 0,
          withdraw_fee_percent: 0,
        })
      : financeSettings().catch((error) => {
          warnings.push(`finance_settings: ${error.message || error}`);
          return {
            min_withdraw_cat_food: 50,
            max_withdrawals_per_month: 3,
            cat_food_to_rm_rate: 1,
            withdraw_fee_rm: 0,
            withdraw_fee_percent: 0,
          };
        }),
    resolveLevelBundle(companionRow).catch((error) => {
      warnings.push(`levels: ${error.message || error}`);
      return {
        levels: [],
        level: null,
        platformCommissionRate: resolvePlatformCommission(companionRow?.commission_rate).platformRate,
        companionShareRate: resolvePlatformCommission(companionRow?.commission_rate).companionShareRate,
        minPrice: 0,
        maxPrice: 0,
        maxPlus: false,
        price: money(companionRow?.price),
        priceInRange: true,
        priceNeedsReset: false,
      };
    }),
  ]);

  let myOrders = [];
  let openOrders = [];
  let wallet = emptyWalletBundle();
  if (!isolated) {
    try {
      // Prefetch transactions for settlement notes; soft-fail inside transactionsFor.
      const preTx = await transactionsFor(profile.id).catch((error) => {
        warnings.push(`transactions:preload: ${error.message || error}`);
        return [];
      });
      const loaded = await loadOrdersFor(profile, companionRow, preTx);
      myOrders = loaded.myOrders || [];
      openOrders = loaded.openOrders || [];
    } catch (error) {
      warnings.push(`orders: ${error.message || error}`);
      myOrders = [];
      openOrders = [];
    }
    wallet = await loadWalletBundle(profile, myOrders);
    if (wallet.warnings?.length) warnings.push(...wallet.warnings);
  }
  const { summary, walletLedger, earningDetails, earnings, withdrawalRows } = wallet;

  player.priceNeedsReset = levelBundle.priceNeedsReset;
  player.priceInRange = levelBundle.priceInRange;
  player.rawPrice = levelBundle.price;
  player.price = levelBundle.price;
  player.level = levelBundle.level
    ? `${levelBundle.level.code || ""} ${levelBundle.level.name || ""}`.trim()
    : player.level;
  // Do not expose internal commission rates while isolated.
  player.orderCommissionRate = isolated ? null : levelBundle.platformCommissionRate;

  let identity = null;
  let payment = null;
  let deposit = null;
  let media = [];
  let mediaTableAvailable = false;
  let paymentAccounts = [];
  try {
    const cpId = companionRow?.id || "";
    const byProfile = (table, extra = "") =>
      cpId
        ? companionDb(table, `?companion_profile_id=eq.${encodeURIComponent(cpId)}${extra}`).catch((e) =>
            isMissingRelation(e) ? [] : Promise.reject(e)
          )
        : Promise.resolve([]);
    const byUser = (table, extra = "") =>
      companionDb(table, `?user_id=eq.${encodeURIComponent(profile.id)}${extra}`).catch((e) =>
        isMissingRelation(e) ? [] : Promise.reject(e)
      );
    // Detect companion_media availability separately so empty gallery ≠ missing table.
    let mediaRowsRaw = [];
    try {
      if (cpId) {
        mediaRowsRaw = await companionDb(
          "companion_media",
          `?companion_profile_id=eq.${encodeURIComponent(cpId)}&order=sort_order.asc`
        );
        mediaTableAvailable = true;
      } else {
        mediaRowsRaw = await companionDb(
          "companion_media",
          `?user_id=eq.${encodeURIComponent(profile.id)}&order=sort_order.asc`
        );
        mediaTableAvailable = true;
      }
    } catch (mediaErr) {
      if (isMissingRelation(mediaErr)) {
        mediaTableAvailable = false;
        mediaRowsRaw = [];
      } else {
        throw mediaErr;
      }
    }
    const [identityRowsRaw, paymentRowsRaw, depositRowsRaw] = await Promise.all([
      byProfile("companion_identity_verifications", "&order=updated_at.desc&limit=1"),
      byProfile("companion_payment_accounts", "&order=submitted_at.desc&limit=20"),
      byProfile("companion_deposits", "&order=created_at.desc&limit=1"),
    ]);
    let identityRows = identityRowsRaw;
    let paymentRows = paymentRowsRaw;
    let depositRows = depositRowsRaw;
    let mediaRows = mediaRowsRaw;
    if (!identityRows?.length || !paymentRows?.length || !depositRows?.length || (mediaTableAvailable && !mediaRows?.length)) {
      const [i2, p2, d2, m2] = await Promise.all([
        identityRows?.length ? Promise.resolve(identityRows) : byUser("companion_identity_verifications", "&order=updated_at.desc&limit=1"),
        paymentRows?.length ? Promise.resolve(paymentRows) : byUser("companion_payment_accounts", "&order=submitted_at.desc&limit=20"),
        depositRows?.length ? Promise.resolve(depositRows) : byUser("companion_deposits", "&order=created_at.desc&limit=1"),
        mediaTableAvailable && !mediaRows?.length
          ? byUser("companion_media", "&order=sort_order.asc")
          : Promise.resolve(mediaRows),
      ]);
      identityRows = i2;
      paymentRows = p2;
      depositRows = d2;
      mediaRows = m2;
    }
    identity = identityRows?.[0] || null;
    paymentAccounts = Array.isArray(paymentRows) ? paymentRows : [];
    payment = paymentAccounts.find((a) => a.status === "approved" || a.status === "verified") || paymentAccounts[0] || null;
    deposit = depositRows?.[0] || null;
    media = Array.isArray(mediaRows) ? mediaRows : [];
    if (mediaTableAvailable && companionRow?.id) {
      media = await migrateGalleryFallbacksIntoMedia(profile, companionRow, media);
    }
  } catch (error) {
    warnings.push(`profile-assets: ${error.message || error}`);
  }

  if (deposit?.status && companionRow?.id) {
    const tableDep = String(deposit.status || "").trim();
    const profileDep = String(companionRow.deposit_status || "").trim();
    if (tableDep && tableDep !== profileDep) {
      try {
        await patchCompanionProfile(`?id=eq.${encodeURIComponent(companionRow.id)}`, {
          deposit_status: tableDep,
          updated_at: nowIso(),
        });
        companionRow = { ...companionRow, deposit_status: tableDep };
      } catch (error) {
        warnings.push(`deposit_status_sync: ${error.message || error}`);
      }
    }
  }

  const unifiedAccess = applyUnifiedAccessFields(player, profile, companionRow, deposit);
  permissions.canWork = canWork(profile, companionRow, deposit);
  permissions.canSetAvailable = permissions.canWork;
  permissions.canAcceptOrder = canAccept(profile, companionRow, deposit);
  permissions.canStartOrder = permissions.canWork;
  permissions.lockReason = auditLockMessage(profile, companionRow, deposit);
  permissions.isolationMode = isCompanionIsolated(profile, companionRow);
  permissions.applicationStatus = normalizeProfileReviewStatus(companionRow);
  permissions.accountStatus = profile.status || "active";
  permissions.companionEnabled = companionEnabled(companionRow);
  permissions.isolationMessage = permissions.isolationMode ? COMPANION_ISOLATION_MSG : "";
  permissions.allowedRoutes = permissions.isolationMode
    ? ["review-status", "profile", "account", "login"]
    : null;
  if (permissions.isolationMode) {
    permissions.canWork = false;
    permissions.canSetAvailable = false;
    permissions.canAcceptOrder = false;
    permissions.canStartOrder = false;
    permissions.canWithdraw = false;
    permissions.messagesMode = "system_cs_only";
  }

  const month = monthKey();
  const weeklyCfg = mergeWeeklySettings(cfg);
  const nextSettlement = computeSettlementDate(new Date(), weeklyCfg);
  const usedThisWeek = withdrawalRows.filter(
    (w) =>
      String(w.settlement_date || "").slice(0, 10) === nextSettlement &&
      !/rejected|cancelled|pay_failed/.test(String(w.status || ""))
  ).length;
  const usedThisMonth = withdrawalRows.filter(
    (w) => String(w.submitted_at || "").slice(0, 7) === month && !/rejected|cancelled|pay_failed/.test(String(w.status || ""))
  ).length;
  const weeklyLimit = Number(weeklyCfg.max_withdrawals_per_week || cfg.max_withdrawals_per_month || 2);
  const monthlyLimit = Number(cfg.max_withdrawals_per_month || 8);
  const minAmount = money(cfg.min_withdraw_cat_food);
  const rate = money(cfg.cat_food_to_rm_rate) || 1;
  const depositOk = depositApproved(companionRow, deposit);
  const bankOk = /approved|verified/.test(String(payment?.status || ""));
  const accountOk = profile.status === "active" && !companionRow?.withdraw_frozen;
  const authModeWd = resolveCredentialMode(companionRow, deposit);
  const credentialOk = authModeWd === "deposit" ? depositOk : true;
  const openPending = withdrawalRows.some((w) =>
    /^(submitted|pending_friday|reviewing|pending|pending_review|rolled_over)$/.test(String(w.status || ""))
  );
  const canWithdrawNow =
    canWork(profile, companionRow, deposit) &&
    credentialOk &&
    bankOk &&
    accountOk &&
    summary.withdrawable >= minAmount &&
    usedThisWeek < weeklyLimit &&
    !openPending;
  permissions.canWithdraw = canWithdrawNow;
  if (permissions.isolationMode) {
    permissions.canWithdraw = false;
    permissions.canWork = false;
    permissions.canSetAvailable = false;
    permissions.canAcceptOrder = false;
    permissions.canStartOrder = false;
  }
  if (!canWithdrawNow) {
    if (!canWork(profile, companionRow, deposit)) {
      permissions.withdrawLockReason = COMPANION_AUTH_LOCK_MSG;
    } else if (!credentialOk) permissions.withdrawLockReason = "请先完成押金认证并通过审核";
    else if (!bankOk) permissions.withdrawLockReason = "请先提交并等待结款账户审核通过";
    else if (companionRow?.withdraw_frozen) permissions.withdrawLockReason = "提现已被冻结";
    else if (openPending) permissions.withdrawLockReason = "已有待周五结算的提现申请，请等待处理后再提交";
    else if (summary.withdrawable < minAmount) permissions.withdrawLockReason = `可提现余额不足（最低 ${minAmount}）`;
    else if (usedThisWeek >= weeklyLimit) permissions.withdrawLockReason = "已达本周提现次数上限";
    else if (profile.status !== "active") permissions.withdrawLockReason = "账号状态异常";
    else permissions.withdrawLockReason = permissions.lockReason || "暂不可提现";
  }

  const feePercent = money(cfg.withdraw_fee_percent);
  const feeFixed = money(cfg.withdraw_fee_rm);
  // Companion self bootstrap: return full account details for the owner.
  // Boss/public APIs never use this payload — keep masking only on admin default + public strippers.
  const approvedAccounts = paymentAccounts
    .filter((a) => /approved|verified/.test(String(a.status || "")))
    .map((a) => ({
      id: a.id,
      bankName: a.bank_name || "",
      accountHolder: a.account_name || "",
      accountName: a.account_name || "",
      bankAccount: a.bank_account || "",
      tngAccount: a.tng_account || "",
      accountLast4: a.account_last4 || maskBankAccount(a.bank_account).slice(-4),
      status: a.status,
    }));

  const signedMediaRaw = [];
  const seenTypes = { avatar: false, cover: false, gallery: false, voice: false, video: false };
  for (const item of media) {
    let url = "";
    try {
      if (item.storage_bucket === PUBLIC_BUCKETS.profile || /public/i.test(String(item.storage_bucket || ""))) {
        url = publicObjectUrl(item.storage_bucket, item.storage_path);
      } else {
        url = await createSignedUrl(item.storage_bucket, item.storage_path, 60 * 60 * 24 * 7);
      }
    } catch {
      url = "";
    }
    signedMediaRaw.push({
      id: item.id,
      mediaType: item.media_type,
      status: item.status,
      rejectReason: item.reject_reason || "",
      durationSeconds: item.duration_seconds,
      uploadedAt: item.uploaded_at,
      sortOrder: item.sort_order,
      storagePath: item.storage_path || "",
      contentType: item.content_type || "",
      url,
    });
  }
  // Keep current review set only: 1 avatar, unique gallery, 1 latest voice.
  const byUploadedDesc = (a, b) =>
    new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime();
  const avatars = signedMediaRaw.filter((m) => m.mediaType === "avatar").sort(byUploadedDesc);
  const voicesOnly = signedMediaRaw.filter((m) => m.mediaType === "voice").sort(byUploadedDesc);
  const gallerySeen = new Set();
  const galleryOnly = [];
  for (const g of signedMediaRaw
    .filter((m) => {
      if (m.mediaType !== "gallery") return false;
      const ctype = String(m.contentType || m.content_type || "").toLowerCase();
      return !/^video\//.test(ctype);
    })
    .sort((a, b) => Number(a.sortOrder ?? 100) - Number(b.sortOrder ?? 100))) {
    const key = String(g.storagePath || g.url || g.id || "").trim();
    if (!key || gallerySeen.has(key)) continue;
    gallerySeen.add(key);
    galleryOnly.push(g);
  }
  const signedMedia = [];
  if (avatars[0]) {
    signedMedia.push(avatars[0]);
    seenTypes.avatar = true;
  }
  for (const g of galleryOnly) {
    signedMedia.push(g);
    seenTypes.gallery = true;
  }
  if (voicesOnly[0]) {
    signedMedia.push(voicesOnly[0]);
    seenTypes.voice = true;
  }
  for (const m of signedMediaRaw) {
    if (m.mediaType === "cover") {
      signedMedia.push(m);
      seenTypes.cover = true;
    }
  }
  const videosOnly = signedMediaRaw
    .filter((m) => {
      if (m.mediaType === "video") return true;
      const ctype = String(m.contentType || m.content_type || "").toLowerCase();
      return m.mediaType === "gallery" && /^video\//.test(ctype);
    })
    .sort(byUploadedDesc);
  if (videosOnly[0]) {
    signedMedia.push({ ...videosOnly[0], mediaType: "video" });
    seenTypes.video = true;
  }
  // Merge synthesized fallbacks for missing single-slot types.
  // Gallery: companion_media is canonical when the table exists — never mix storage listing
  // back in (that caused overwrite illusion + delete resurrection). When the table is missing,
  // allow ALL tag/storage gallery items (multi-append), not just the first.
  {
    const dbHadGallery = signedMedia.some((m) => m.mediaType === "gallery");
    const synthesized = await synthesizeMediaFallback(profile, companionRow, {
      allowStorageListing: !mediaTableAvailable,
    });
    for (const syn of synthesized) {
      const mt = String(syn.mediaType || "");
      if (mt === "avatar" && seenTypes.avatar) continue;
      if (mt === "cover" && seenTypes.cover) continue;
      if (mt === "voice" && seenTypes.voice) continue;
      if (mt === "video" && seenTypes.video) continue;
      if (mt === "gallery") {
        if (mediaTableAvailable || dbHadGallery) continue;
        if (signedMedia.some((m) => m.mediaType === "gallery" && m.url && m.url === syn.url)) continue;
        signedMedia.push(syn);
        continue;
      }
      if (mt === "avatar") seenTypes.avatar = true;
      if (mt === "cover") seenTypes.cover = true;
      if (mt === "voice") seenTypes.voice = true;
      if (mt === "video") seenTypes.video = true;
      signedMedia.push(syn);
    }
  }
  // Prefer fresh companion_media voice URL on player payload.
  const voiceFromMedia = signedMedia.find((m) => m.mediaType === "voice" && m.url);
  if (voiceFromMedia) {
    player.voiceUrl = voiceFromMedia.url;
  } else if (/^storage:\/\//i.test(String(player.voiceUrl || ""))) {
    player.voiceUrl = "";
  }
  const videoFromMedia = signedMedia.find((m) => m.mediaType === "video" && m.url);
  if (videoFromMedia) {
    player.videoUrl = videoFromMedia.url;
    player.showcaseVideoUrl = videoFromMedia.url;
  }

  let popularity = null;
  if (!permissions.isolationMode) {
    try {
      popularity = await companionPopularityMe(profile.id);
    } catch {
      popularity = null;
    }
  }

  let pendingForced = [];
  try {
    pendingForced = await (await import("./_content-acks.js")).pendingForcedForUser(profile.id, { audience: "companion" });
  } catch {
    pendingForced = [];
  }
  if (pendingForced.length) {
    permissions.canSetAvailable = false;
    permissions.canAcceptOrder = false;
    permissions.canStartOrder = false;
    permissions.forcedAckRequired = true;
    permissions.forcedAckReason = "请先阅读并确认最新强制公告";
  }

  const mediaExtrasForGate = {
    avatarUrl: signedMedia.find((m) => m.mediaType === "avatar" && m.url)?.url || "",
    voiceUrl: player.voiceUrl || "",
    gallery: signedMedia.filter((m) => m.mediaType === "gallery" && m.url).map((m) => ({ id: m.id, url: m.url })),
  };
  const publishGate = evaluatePublishGate(companionRow, profile, mediaExtrasForGate);
  permissions.publishReady = publishGate.publishReady;
  permissions.profileComplete = publishGate.profileComplete;
  let certTags = [];
  try {
    const map = await resolveCertTagsForProfiles([companionRow.id].filter(Boolean));
    certTags = map[companionRow.id] || [];
  } catch {
    certTags = [];
  }

  return {
    serverTime: nowIso(),
    player: { ...player, certTags },
    permissions,
    publishGate: permissions.isolationMode
      ? { publishReady: false, profileComplete: publishGate.profileComplete, missing: publishGate.missing || [], statusLabel: "审核未通过前不对老板公开" }
      : publishGate,
    publishStatus: permissions.isolationMode ? "审核未通过前不对老板公开" : publishGate.statusLabel,
    publishMissing: publishGate.missing,
    pendingForced: permissions.isolationMode ? [] : pendingForced,
    forcedAckRequired: permissions.isolationMode ? false : pendingForced.length > 0,
    summary: permissions.isolationMode ? emptyWalletBundle().summary : summary,
    popularity: permissions.isolationMode ? null : popularity,
    openOrders: permissions.isolationMode ? [] : openOrders,
    myOrders: permissions.isolationMode ? [] : myOrders,
    conversations: [],
    messages: [],
    earnings: permissions.isolationMode
      ? emptyWalletBundle().earnings
      : {
          todayIncome: summary.todayIncome || 0,
          yesterdayIncome: summary.yesterdayIncome || 0,
          weekIncome: summary.weekIncome || 0,
          monthIncome: summary.monthIncome || 0,
          totalIncome: summary.totalIncome || 0,
          withdrawable: summary.withdrawable || 0,
          available: summary.withdrawable || 0,
          frozen: summary.frozen || 0,
          pendingSettlement: summary.pendingSettlement || 0,
          withdrawn: summary.withdrawn || 0,
        },
    earningDetails: permissions.isolationMode ? [] : earningDetails,
    walletLedger: permissions.isolationMode ? [] : walletLedger,
    walletWarnings: warnings,
    warnings,
    withdrawalRules: permissions.isolationMode
      ? {
          monthlyLimit: 0,
          usedThisMonth: 0,
          remainingThisMonth: 0,
          weeklyLimit: 0,
          usedThisWeek: 0,
          remainingThisWeek: 0,
          minAmount: 0,
          exchangeRate: 1,
          feeRm: 0,
          feePercent: 0,
          nextSettlementDate: "",
          settlementHint: "",
          weeklyBanner: "",
          currentAccount: "",
          approvedAccounts: [],
        }
      : {
          monthlyLimit,
          usedThisMonth,
          remainingThisMonth: Math.max(0, monthlyLimit - usedThisMonth),
          weeklyLimit,
          usedThisWeek,
          remainingThisWeek: Math.max(0, weeklyLimit - usedThisWeek),
          minAmount,
          exchangeRate: rate,
          feeRm: feeFixed,
          feePercent,
          nextSettlementDate: nextSettlement,
          settlementHint: `预计发放日期：${nextSettlement}（星期五）`,
          weeklyBanner: viewWeeklyRules(weeklyCfg),
          currentAccount: payment
            ? `${payment.bank_name || ""} ${payment.account_name || ""} ${payment.bank_account || ""}`.trim()
            : "",
          currentAccountMasked: payment
            ? `${payment.bank_name || ""} ${payment.account_name || ""} ****${payment.account_last4 || maskBankAccount(payment.bank_account).slice(-4)}`.trim()
            : "",
          approvedAccounts,
        },
    withdrawals: permissions.isolationMode ? [] : await Promise.all(withdrawalRows.map((w) => viewCompanionWithdrawal(w))),
    verification: {
      identityStatus: identity?.status || "draft",
      contactStatus: companionRow?.verification_status || "draft",
      bankStatus: payment?.status || "draft",
      depositStatus: normalizeDepositStatus(companionRow, deposit),
      profile_review_status: normalizeProfileReviewStatus(companionRow),
      profileReviewStatus: normalizeProfileReviewStatus(companionRow),
      deposit_status: normalizeDepositStatus(companionRow, deposit),
      account_access_status: unifiedAccess.status,
      accountAccessStatus: unifiedAccess.status,
      accountAccessLabel: unifiedAccess.label,
      realName: identity?.real_name || "",
      // Self-view: full plaintext for the authenticated companion only.
      identityNo: identity?.identity_no || "",
      bankName: payment?.bank_name || "",
      accountName: payment?.account_name || "",
      bankAccount: payment?.bank_account || "",
      phone: companion?.contact_phone || "",
      tngAccount: payment?.tng_account || "",
      identityNoMasked: identity?.identity_no
        ? `****${String(identity.identity_no).replace(/\s+/g, "").slice(-4)}`
        : "",
      bankAccountMasked: payment?.account_last4
        ? `****${String(payment.account_last4)}`
        : payment?.bank_account
          ? `****${String(payment.bank_account).replace(/\s+/g, "").slice(-4)}`
          : "",
      hasIdentityNo: !!String(identity?.identity_no || "").trim(),
      hasBankAccount: !!String(payment?.bank_account || payment?.account_last4 || "").trim(),
      identitySubmitted: !!(
        String(identity?.real_name || "").trim() &&
        String(identity?.identity_no || "").trim() &&
        String(identity?.id_front_path || "").trim() &&
        String(identity?.id_back_path || "").trim() &&
        !/draft|uploaded|none|not_submitted/i.test(String(identity?.status || ""))
      ),
      paymentSubmitted: !!(
        String(payment?.bank_name || "").trim() &&
        String(payment?.bank_account || payment?.account_last4 || "").trim() &&
        !/draft|uploaded|none|not_submitted/i.test(String(payment?.status || ""))
      ),
      identityRejectReason: identity?.reject_reason || "",
      paymentRejectReason: payment?.reject_reason || "",
      applicationRejectReason: companionRow?.application_reject_reason || "",
      mediaRejectReason: companionRow?.media_reject_reason || "",
      depositRejectReason: deposit?.reject_reason || "",
      // Signed URLs for companion self-view only (never sent to public/boss APIs).
      idFrontUrl: await signedPrivateDocUrl(PRIVATE_BUCKETS.identity, identity?.id_front_path),
      idBackUrl: await signedPrivateDocUrl(PRIVATE_BUCKETS.identity, identity?.id_back_path),
      hasIdFront: !!String(identity?.id_front_path || "").trim(),
      hasIdBack: !!String(identity?.id_back_path || "").trim(),
    },
    deposit: {
      status: normalizeDepositStatus(companionRow, deposit),
      deposit_status: normalizeDepositStatus(companionRow, deposit),
      profile_review_status: normalizeProfileReviewStatus(companionRow),
      account_access_status: unifiedAccess.status,
      requiredAmount: deposit?.required_amount || 100,
      paidAmount: deposit?.paid_amount || 0,
      rejectReason: deposit?.reject_reason || "",
      paymentMethod: deposit?.payment_method || "",
      remark: deposit?.remark || "",
      depositSubmitted: !!(
        String(deposit?.proof_path || "").trim() &&
        Number(deposit?.paid_amount || 0) > 0 &&
        String(deposit?.payment_method || "").trim() &&
        !/draft|uploaded|none|not_submitted/i.test(String(deposit?.status || ""))
      ),
      proofUrl: await signedPrivateDocUrl(
        deposit?.proof_bucket || PRIVATE_BUCKETS.payment,
        deposit?.proof_path
      ),
      hasProof: !!String(deposit?.proof_path || "").trim(),
    },
    playerGames: [],
    media: signedMedia,
    levelInfo: {
      level: levelBundle.level ? `${levelBundle.level.code || ""} ${levelBundle.level.name || ""}`.trim() : companion?.level_name || "",
      levelId: levelBundle.level?.id || companion?.level_id || "",
      levelCode: levelBundle.level?.code || "",
      levelName: levelBundle.level?.name || companion?.level_name || "",
      orderCommissionRate: levelBundle.platformCommissionRate,
      platformCommissionRate: levelBundle.platformCommissionRate,
      giftCommissionRate: money(companion?.gift_commission_rate) || 0,
      directRebateRate: money(companion?.direct_rebate_rate) || 0,
      price: levelBundle.price,
      minPrice: levelBundle.minPrice,
      maxPrice: levelBundle.maxPrice,
      maxPlus: levelBundle.maxPlus,
      priceRangeText: levelBundle.level
        ? `RM${levelBundle.minPrice}–RM${levelBundle.maxPrice}${levelBundle.maxPlus ? "+" : ""} / 小时`
        : "请先联系后台设置等级",
      priceInRange: levelBundle.priceInRange,
      priceNeedsReset: levelBundle.priceNeedsReset,
      gamePrices: readGamePrices(companion || {}),
      effectiveAt: companion?.commission_effective_at || companion?.level_effective_at || "",
    },
    companionLevel: levelBundle.level,
    companionLevels: levelBundle.levels,
    invitation: { records: [] },
    reviews: await loadCompanionReviews(profile.id),
    orderStatuses: Object.values(ORDER_STATUS_TEXT),
    paymentStatuses: [],
  };
}

async function loadCompanionReviews(companionUserId) {
  if (!companionUserId) return [];
  try {
    const rows = await supabaseJson(
      restUrl(
        "companion_reviews",
        `?companion_id=eq.${encodeURIComponent(companionUserId)}&or=(status.eq.published,status.is.null)&order=created_at.desc&limit=50&select=id,order_id,boss_id,rating,content,status,created_at`
      ),
      { headers: serviceHeaders() }
    );
    const list = Array.isArray(rows) ? rows : [];
    // One review per order (keep newest).
    const byOrder = new Map();
    for (const r of list) {
      const key = String(r.order_id || r.id || "");
      if (!key) continue;
      if (!byOrder.has(key)) byOrder.set(key, r);
    }
    const deduped = [...byOrder.values()];
    const bossIds = [...new Set(deduped.map((r) => r.boss_id).filter(Boolean))];
    const orderIds = [...new Set(deduped.map((r) => r.order_id).filter(Boolean))];
    let bosses = {};
    let orders = {};
    if (bossIds.length) {
      const profiles = await supabaseJson(
        restUrl("profiles", `?id=in.(${bossIds.map(encodeURIComponent).join(",")})&select=id,display_name,boss_uid`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      bosses = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    }
    if (orderIds.length) {
      const orderRows = await supabaseJson(
        restUrl("orders", `?id=in.(${orderIds.map(encodeURIComponent).join(",")})&select=id,order_no,game,status,companion_id`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      orders = Object.fromEntries((orderRows || []).map((o) => [o.id, o]));
    }
    return deduped.map((r) => {
      const boss = bosses[r.boss_id] || {};
      const order = orders[r.order_id] || {};
      // Guard against mis-bound reviews leaking onto this companion profile.
      if (order.companion_id && String(order.companion_id) !== String(companionUserId)) return null;
      const bossCode = resolveBossPublicCode(boss) || "";
      return {
        id: r.id,
        orderId: order.order_no || r.order_id || "",
        orderNo: order.order_no || r.order_id || "",
        companionId: r.companion_id || companionUserId,
        bossId: r.boss_id || "",
        gameName: order.game || "",
        game: order.game || "",
        rating: Number(r.rating || 0),
        content: r.content || "",
        status: r.status || "published",
        createdAt: r.created_at || "",
        bossName: anonymousBossLabel(boss),
        bossUid: bossCode,
        bossCode,
        avatarUrl: "",
        anonymous: true,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function ensureCompanionRow(profile, companion) {
  if (companion?.id) return companion;
  const rows = await supabaseJson(restUrl("companion_profiles"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      user_id: profile.id,
      nickname: profile.display_name || "",
      contact_phone: String(profile.phone || profile.phone_e164 || "").trim() || "",
      verification_status: "pending",
      deposit_status: "pending",
      application_status: "draft",
      allow_orders: false,
      online_status: "offline",
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
  return rows?.[0] || companion || {};
}

async function upsertByCompanion(table, companionId, userId, payload) {
  const existing = await companionDb(table, `?companion_profile_id=eq.${encodeURIComponent(companionId)}&limit=1`).catch((e) => {
    if (isMissingRelation(e)) throw Object.assign(new Error("请先执行 supabase/companion-admin-data.sql"), { status: 503 });
    throw e;
  });

  async function write(body, method, query) {
    let next = { ...body };
    for (let i = 0; i < 8; i++) {
      try {
        return await companionDb(table, query, { method, body: JSON.stringify(next) });
      } catch (error) {
        const msg = `${error?.message || ""} ${typeof error?.body === "string" ? error.body : JSON.stringify(error?.body || "")}`;
        const m = msg.match(/Could not find the '([^']+)' column/i);
        if (!m || !(m[1] in next)) throw error;
        delete next[m[1]];
      }
    }
    throw Object.assign(new Error(`${table} 写入失败（列不兼容）`), { status: 500 });
  }

  if (existing?.[0]) {
    return write({ ...payload, updated_at: nowIso() }, "PATCH", `?id=eq.${encodeURIComponent(existing[0].id)}`);
  }
  return write(
    {
      companion_profile_id: companionId,
      user_id: userId,
      ...payload,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    "POST",
    ""
  );
}

async function saveUploadFromBody(userId, folder, bucket, dataUrlOrPath, filename) {
  if (!dataUrlOrPath) return { bucket: "", path: "" };
  const raw = String(dataUrlOrPath).trim();
  if (!raw) return { bucket: "", path: "" };
  if (/^(blob:|filesystem:|file:)/i.test(raw)) {
    throw Object.assign(new Error("不支持临时预览地址，请重新选择图片上传"), { status: 400 });
  }
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(raw)) {
    throw Object.assign(new Error("不支持本地路径，请重新选择图片上传"), { status: 400 });
  }
  if (!raw.startsWith("data:")) {
    // Existing durable storage path (not a public URL paste for identity docs)
    if (/^https?:\/\//i.test(raw)) {
      throw Object.assign(new Error("请通过上传按钮选择图片，不要粘贴链接"), { status: 400 });
    }
    return { bucket, path: raw };
  }
  const decoded = assertImageUpload(decodeDataUrl(raw));
  const objectPath = buildObjectPath(userId, folder, filename || "file.jpg");
  await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType);
  return { bucket, path: objectPath, contentType: decoded.contentType };
}

async function signedPrivateDocUrl(bucket, objectPath) {
  const path = String(objectPath || "").trim();
  if (!bucket || !path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return "";
  try {
    return await createSignedUrl(bucket, path, 60 * 60 * 6);
  } catch {
    return "";
  }
}

function parseReceiptPathFromRemark(remark = "") {
  const m = String(remark || "").match(/\[打款收据\][^\n]*path=([^\s]+)/);
  return m?.[1] || "";
}

async function viewCompanionWithdrawal(w) {
  let receiptPath = String(w.receipt_url || "").trim();
  if (!receiptPath) receiptPath = parseReceiptPathFromRemark(w.remark);
  const receiptUrl = receiptPath
    ? await signedPrivateDocUrl("finance-receipts", receiptPath)
    : "";
  const statusKey = normalizePayoutStatus(w.status);
  return {
    id: w.id,
    withdrawalNo: w.withdrawal_no,
    catFoodAmount: money(w.cat_food_amount || w.amount),
    grossAmountRm: money(w.gross_amount_rm),
    feeRm: money(w.fee_rm),
    netAmountRm: money(w.net_amount_rm),
    bankName: w.bank_name || "",
    accountName: w.account_name || w.account_holder || "",
    accountLast4: w.account_last4 || "",
    status: w.status,
    statusCanonical: statusKey,
    statusText: WITHDRAW_STATUS_TEXT[w.status] || WITHDRAW_STATUS_TEXT[statusKey] || w.status,
    rejectReason: w.reject_reason || w.rejection_reason || "",
    submittedAt: w.submitted_at || w.created_at,
    reviewedAt: w.reviewed_at || w.approved_at || "",
    approvedAt: w.approved_at || w.reviewed_at || "",
    paidAt: w.paid_at || "",
    completedAt: w.completed_at || "",
    settlementDate: w.settlement_date || "",
    settlementHint: w.settlement_date ? `预计发放日期：${String(w.settlement_date).slice(0, 10)}（星期五）` : "",
    bankReference: w.bank_reference || w.transaction_no || "",
    bankReferenceMasked: w.bank_reference || w.transaction_no || "",
    transactionNo: w.transaction_no || w.bank_reference || "",
    paymentRemark: w.payment_remark || "",
    receiptUrl,
    hasReceipt: !!receiptPath,
    amount: money(w.cat_food_amount || w.amount),
    createdAt: w.submitted_at || w.created_at,
  };
}
async function ensureConversation(order) {
  // System notices for order events belong on the BOSS↔CS order_support thread only.
  // Never attach companion_id and never reuse companion_support rows for the same order_id.
  const bossId = order?.boss_id || null;
  if (!bossId || !order?.id) return null;
  const typed = await supabaseJson(
    restUrl(
      "conversations",
      `?boss_id=eq.${encodeURIComponent(bossId)}&order_id=eq.${encodeURIComponent(order.id)}&conversation_type=eq.order_support&order=updated_at.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (typed?.[0]) return typed[0];
  const legacy = await supabaseJson(
    restUrl(
      "conversations",
      `?boss_id=eq.${encodeURIComponent(bossId)}&order_id=eq.${encodeURIComponent(order.id)}&order=updated_at.desc&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const hit = (Array.isArray(legacy) ? legacy : []).find((row) => {
    const t = String(row.conversation_type || "");
    return t !== "companion_support" && !!row.boss_id;
  });
  if (hit) return hit;
  const rows = await supabaseJson(restUrl("conversations"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      boss_id: bossId,
      companion_id: null,
      customer_service_id: order.customer_service_id || null,
      order_id: order.id,
      conversation_type: "order_support",
      status: "open",
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  }).catch(async (err) => {
    if (!/conversation_type/i.test(String(err?.message || ""))) throw err;
    return supabaseJson(restUrl("conversations"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        boss_id: bossId,
        companion_id: null,
        customer_service_id: order.customer_service_id || null,
        order_id: order.id,
        status: "open",
        created_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
  });
  return rows?.[0] || null;
}
async function addSystemMessage(order, senderId, senderRole, content) {
  const conversation = await ensureConversation(order);
  if (!conversation) return;
  await supabaseJson(restUrl("messages"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      conversation_id: conversation.id,
      sender_id: senderId,
      sender_role: senderRole,
      message_type: "system",
      content,
      order_id: order.id,
      created_at: nowIso(),
    }),
  });
}
async function claimOrder(profile, companion, id) {
  if (!canAccept(profile, companion)) {
    const status = normalizeOnlineStatus(companion.availability_status || companion.online_status);
    const reason = !canWork(profile, companion)
      ? COMPANION_AUTH_LOCK_MSG
      : status === "busy"
        ? "忙碌中，无法抢新订单。"
        : status === "paused"
          ? "已暂停接单，无法抢新订单。"
          : "请先在工作台切换为在线接单。";
    throw Object.assign(new Error(reason), { status: 403 });
  }
  const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() });
  const before = beforeRows?.[0];
  if (!before) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  const { resolveAssignmentType, ASSIGNMENT_ASSIGNED, isPublicHallEligible } = await import("./_order-assignment.js");
  // Open grab only: never auto-bind companion_id; never jump to confirmed/in_progress.
  // Assigned / 指定陪玩 orders are invisible to the public hall and cannot be grabbed.
  if (resolveAssignmentType(before) === ASSIGNMENT_ASSIGNED || before.companion_id) {
    throw Object.assign(new Error("该订单为指定陪玩单，不在公开抢单大厅。"), { status: 409 });
  }
  const openForGrab = isPublicHallEligible(before);
  if (!openForGrab) throw Object.assign(new Error("该订单当前不可抢单。"), { status: 409 });
  if (["confirmed", "in_progress", "completed", "claimed"].includes(before.status)) {
    throw Object.assign(new Error("该订单已进入正式接单，不能再抢。"), { status: 409 });
  }
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
  const { grab, created, grabs } = await grabsApi.insertGrab(before, profile.id);
  if (!created) {
    return { ...before, _grab: grab, _already: true, _grabs: grabs };
  }
  // Keep hall open for others: do NOT set companion_id until boss manually selects.
  let order = before;
  if (before.status === "pending") {
    const rows = await supabaseJson(
      restUrl("orders", `?id=eq.${encodeURIComponent(id)}&status=eq.pending&companion_id=is.null`),
      {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status: "waiting_boss_confirm" }),
      }
    );
    order = rows?.[0] || { ...before, status: "waiting_boss_confirm" };
  }
  // Guard: claim must not leave companion_id set.
  if (order.companion_id) {
    await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ companion_id: null }),
    });
    order = { ...order, companion_id: null };
  }
  await addSystemMessage(order, profile.id, "companion", "陪玩已抢单，等待老板选择。");
  return { ...order, companion_id: null, _grab: grab, _grabs: grabs };
}
async function patchOwnOrder(profile, id, expected, patch, message) {
  const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: serviceHeaders() });
  const before = beforeRows?.[0];
  if (!before) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  if (expected && before.status !== expected) throw Object.assign(new Error("当前订单状态不能执行该操作。"), { status: 409 });
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(profile.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) });
  const saved = rows?.[0] || { ...before, ...patch };
  if (patch.status && patch.status !== before.status) {
    await writeOrderStatusLog(
      { restUrl, supabaseJson, serviceHeaders },
      {
        orderId: id,
        fromStatus: before.status,
        toStatus: patch.status,
        operatorRole: "companion",
        operatorId: profile.id,
        note: message || "",
      }
    );
  }
  if (message) await addSystemMessage(saved, profile.id, "companion", message);
  return saved;
}

async function trySendResetCodeEmail(email, code) {
  try {
    const { sendEmailOtp } = await import("./_mail.js");
    await sendEmailOtp({ to: email, code, purpose: "forgot", roleLabel: "陪玩端" });
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, req.method === "GET" ? 200 : 503, { ok: req.method === "GET", data: { player: {}, permissions: { canAcceptOrder: false, lockReason: "真实数据库未配置" }, summary: { todayOrders: 0, waitingConfirm: 0, runningOrders: 0, completedOrders: 0, monthIncome: 0, withdrawable: 0 }, openOrders: [], myOrders: [], earnings: {}, earningDetails: [] }, message: "未配置 Supabase，陪玩端不返回假业务数据。" });
  try {
    const bodyEarly = req.method === "GET" ? null : await parseBody(req);
    if (bodyEarly && typeof bodyEarly === "object" && (!req.body || typeof req.body !== "object")) {
      req.body = bodyEarly;
    }
    const action = String(
      req.method === "GET"
        ? req.query.action || "bootstrap"
        : bodyEarly?.action || req.query?.action || ""
    ).trim();
    if (action === "login") {
      const body = bodyEarly || (await parseBody(req)); const account=String(body.account || body.email || "").trim().toLowerCase(); const password=String(body.password || "");
      if (!account || !password) return json(res,400,{ok:false,message:"请输入邮箱和密码"});
      const resolvedLogin = await resolveCompanionAuthEmail(account);
      const email = (resolvedLogin && resolvedLogin.email) || account.toLowerCase();
      if (resolvedLogin?.profile && String(resolvedLogin.profile.status || "").toLowerCase() === "disabled") {
        return json(res,403,{ok:false,message:"陪玩账号已停用"});
      }
      let auth;
      try {
        auth = await supabaseJson(authUrl("token?grant_type=password"), { method:"POST", headers: anonHeaders(), body: JSON.stringify({ email, password }) });
      } catch (loginErr) {
        const raw = String(loginErr?.message || "").trim();
        const looksLikeBadPassword =
          /invalid login credentials|invalid.*(email|password)|wrong password|invalid email or password/i.test(raw);
        if (looksLikeBadPassword && resolvedLogin?.profile) {
          try {
            const { resolveHasPassword, NO_PASSWORD_LOGIN_MESSAGE } = await import("./_account-security.js");
            const hasPwd = await resolveHasPassword(resolvedLogin.profile, {}, { probeAuth: true });
            if (hasPwd === false) return json(res,400,{ok:false,message:NO_PASSWORD_LOGIN_MESSAGE,code:"NO_PASSWORD"});
          } catch { /* fall through */ }
        }
        return json(res,401,{ok:false,message:"账号或密码错误"});
      }
      const profile = await profileById(auth.user.id);
      if (!profile || profile.role !== "companion") return json(res,403,{ok:false,message:"无权访问陪玩端"});
      if (profile.status === "disabled") return json(res,403,{ok:false,message:"陪玩账号已停用"});
      try {
        const { resolveEmailVerified } = await import("./_account-security.js");
        if (!resolveEmailVerified(profile, auth.user || {})) {
          return json(res,403,{ok:false,message:"请先完成邮箱验证。",code:"EMAIL_NOT_VERIFIED"});
        }
      } catch { /* if helper missing, continue */ }
      const companion = await companionProfile(profile.id);
      try {
        const { touchLastLogin, stampPasswordSet } = await import("./_account-security.js");
        await stampPasswordSet(profile.id, { mustChangePassword: false }).catch(() => null);
        await touchLastLogin(profile.id, "");
      } catch { /* optional */ }
      return json(res,200,{ok:true,session:{
        token:auth.access_token,
        accessToken:auth.access_token,
        refreshToken:auth.refresh_token || "",
        expiresAt:auth.expires_at || "",
        user:safePlayer(profile, companion || {}),
        remember:!!body.remember
      }});
    }
    if (action === "forgot_password" || action === "send_reset_code") {
      const body = await parseBody(req);
      const account = String(body.account || body.email || "").trim();
      const genericOk = {
        ok: true,
        message: "如该邮箱已注册，将收到重设邮件或验证码，请查收后继续。",
        emailMasked: "",
        expiresInSec: 900,
      };
      if (!account) return json(res, 400, { ok: false, message: "请输入注册邮箱" });
      const resolved = await resolveCompanionAuthEmail(account);
      const email = resolved && resolved.email;
      // Anti-enumeration: always return the same success shape when lookup fails.
      if (!email) return json(res, 200, genericOk);
      const profile =
        (resolved && resolved.profile) ||
        (
          await supabaseJson(
            restUrl("profiles", `?role=eq.companion&email=eq.${encodeURIComponent(email)}&select=id,role,status&limit=1`),
            { headers: serviceHeaders() }
          ).catch(() => [])
        )?.[0];
      if (!profile || profile.status === "disabled") return json(res, 200, genericOk);
      const code = randomOtpCode();
      await storePasswordResetOtp(email, code);
      const mailSent = await trySendResetCodeEmail(email, code);
      const staging =
        String(process.env.ALLOW_STAGING_OTP || "") === "1" ||
        String(process.env.MCJ_OTP_DEBUG || "") === "1" ||
        (String(process.env.VERCEL_ENV || "").toLowerCase() !== "production" &&
          (/staging|localhost|127\.0\.0\.1/i.test(String(process.env.MCJ_PUBLIC_BASE || process.env.VERCEL_URL || "")) ||
            String(process.env.VERCEL_ENV || "").toLowerCase() === "preview"));
      const masked = maskEmailHint(email);
      const out = {
        ok: true,
        message: mailSent
          ? `如该邮箱已注册，验证码已发送至 ${masked || "你的邮箱"}。`
          : staging
            ? "邮件服务暂不可用，已生成 Staging 调试验证码。"
            : "如该邮箱已注册，将收到验证码邮件，请查收后继续。",
        emailMasked: masked,
        expiresInSec: 900,
      };
      if (staging) out.devCode = code;
      return json(res, 200, out);
    }
    if (action === "verify_reset_code") {
      const body = await parseBody(req);
      const account = String(body.account || body.email || "").trim();
      const code = String(body.code || body.otp || "").trim();
      const resolvedV = await resolveCompanionAuthEmail(account);
      const email = resolvedV && resolvedV.email;
      if (!email || !/^\d{4,8}$/.test(code)) {
        return json(res, 400, { ok: false, message: "验证码无效或已过期" });
      }
      const stored = await findPasswordResetOtp(email);
      if (stored && stored.code && String(stored.code) === code && Number(stored.exp) > Date.now()) {
        const token = "mcj_" + randomOtpCode() + Date.now().toString(36);
        await markPasswordResetVerified(email, stored.id, token);
        // One-time: wipe OTP code from memory after issue token
        return json(res, 200, { ok: true, message: "验证成功，请设置新密码", resetToken: token, emailMasked: maskEmailHint(email) });
      }
      try {
        const verified = await supabaseJson(authUrl("verify"), {
          method: "POST",
          headers: anonHeaders(),
          body: JSON.stringify({ type: "email", email, token: code }),
        });
        if (verified?.access_token) {
          return json(res, 200, {
            ok: true,
            message: "验证成功，请设置新密码",
            resetToken: verified.access_token,
            emailMasked: maskEmailHint(email),
          });
        }
      } catch {
        /* fall through */
      }
      try {
        const verified = await supabaseJson(authUrl("verify"), {
          method: "POST",
          headers: anonHeaders(),
          body: JSON.stringify({ type: "recovery", email, token: code }),
        });
        if (verified?.access_token) {
          return json(res, 200, {
            ok: true,
            message: "验证成功，请设置新密码",
            resetToken: verified.access_token,
            emailMasked: maskEmailHint(email),
          });
        }
      } catch {
        /* fall through */
      }
      return json(res, 400, { ok: false, message: "验证码无效或已过期" });
    }
    if (action === "reset_password") {
      const body = await parseBody(req);
      const newPassword = String(body.newPassword || body.password || "");
      const confirmPassword = String(body.confirmPassword || body.confirm_password || "");
      if (!newPassword || newPassword.length < 8) return json(res, 400, { ok: false, message: "新密码至少 8 位" });
      if (confirmPassword && confirmPassword !== newPassword) {
        return json(res, 400, { ok: false, message: "两次输入的新密码不一致" });
      }
      const resetToken = String(body.resetToken || body.token || "").trim();
      if (!resetToken) return json(res, 400, { ok: false, message: "请先完成验证码校验" });
      if (resetToken.startsWith("mcj_") || resetToken.startsWith("mcj:")) {
        if (resetToken.startsWith("mcj_")) {
          const resolvedR = await resolveCompanionAuthEmail(String(body.account || body.email || ""));
          const emailR = resolvedR && resolvedR.email;
          if (!emailR) return json(res, 400, { ok: false, message: "缺少账号信息" });
          const storedR = await findPasswordResetOtp(emailR);
          if (!storedR || storedR.verifiedToken !== resetToken || Number(storedR.exp) < Date.now()) {
            return json(res, 400, { ok: false, message: "重置凭证无效或已过期，请重新获取验证码" });
          }
          const rowsR = await supabaseJson(
            restUrl("profiles", "?role=eq.companion&email=eq." + encodeURIComponent(emailR) + "&select=id&limit=1"),
            { headers: serviceHeaders() }
          ).catch(() => []);
          const profileR = (resolvedR && resolvedR.profile) || (rowsR && rowsR[0]);
          if (!profileR || !profileR.id) return json(res, 404, { ok: false, message: "账号不存在" });
          await supabaseJson(authUrl("admin/users/" + encodeURIComponent(profileR.id)), {
            method: "PUT",
            headers: serviceHeaders(),
            body: JSON.stringify({ password: newPassword }),
          });
          if (globalThis.__mcjPwResets) globalThis.__mcjPwResets.delete(emailR);
          return json(res, 200, { ok: true, message: "密码已重设，请使用新密码登录" });
        }
        if (resetToken.startsWith("mcj:")) {
        let payload;
        try {
          payload = JSON.parse(Buffer.from(resetToken.slice(4), "base64url").toString("utf8"));
        } catch {
          return json(res, 400, { ok: false, message: "重置凭证无效，请重新获取验证码" });
        }
        if (!payload?.email || Date.now() - Number(payload.at || 0) > 20 * 60 * 1000) {
          return json(res, 400, { ok: false, message: "重置凭证已过期，请重新获取验证码" });
        }
        const profile = (
          await supabaseJson(
            restUrl("profiles", `?role=eq.companion&email=eq.${encodeURIComponent(payload.email)}&select=id&limit=1`),
            { headers: serviceHeaders() }
          ).catch(() => [])
        )?.[0];
        if (!profile?.id) return json(res, 404, { ok: false, message: "账号不存在" });
        await supabaseJson(authUrl(`admin/users/${encodeURIComponent(profile.id)}`), {
          method: "PUT",
          headers: serviceHeaders(),
          body: JSON.stringify({ password: newPassword }),
        });
        return json(res, 200, { ok: true, message: "密码已重设，请使用新密码登录" });
        }
      }
      // Supabase recovery/session token path
      try {
        await supabaseJson(authUrl("user"), {
          method: "PUT",
          headers: anonHeaders({ Authorization: `Bearer ${resetToken}` }),
          body: JSON.stringify({ password: newPassword }),
        });
        return json(res, 200, { ok: true, message: "密码已重设，请使用新密码登录" });
      } catch (err) {
        return json(res, 400, { ok: false, message: err.message || "重设失败，请重新获取验证码" });
      }
    }
    if (action === "register") {
      const body = await parseBody(req); const email=String(body.email || body.account || "").trim().toLowerCase(); const password=String(body.password || ""); const nickname=String(body.nickname || body.name || "").trim();
      const registerToken = String(body.registerToken || body.emailOtpToken || body.otpToken || "").trim();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res,400,{ok:false,message:"请输入有效邮箱"});
      if (!registerToken) return json(res,400,{ok:false,message:"请先完成邮箱验证。"});
      if (!nickname) return json(res,400,{ok:false,message:"请输入陪玩昵称"});
      if (!password) return json(res,400,{ok:false,message:"请设置登录密码。"});
      const { validatePassword } = await import("./_password-policy.js");
      const policy = validatePassword(password, body.confirmPassword || body.confirm_password);
      if (!policy.ok) return json(res,400,{ok:false,message:policy.message});
      const wantsPassword = true;
      const authPassword = password;
      try {
        const { consumeRegisterVerified } = await import("./_otp-store.js");
        await consumeRegisterVerified(email, "companion", registerToken);
      } catch (otpErr) {
        return json(res, otpErr?.status || 400, {
          ok: false,
          message: otpErr?.message || "请先完成邮箱验证。",
        });
      }
      // Block register when email already belongs to a formal (approved) companion,
      // or an active draft/pending application (must login to continue, not create duplicates).
      try {
        const { isFormalCompanion, isApplicationDraft } = await import("./_companion-draft.js");
        const emailProfiles = await supabaseJson(
          restUrl("profiles", `?email=eq.${encodeURIComponent(email)}&select=id,email,role&limit=5`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        for (const ep of Array.isArray(emailProfiles) ? emailProfiles : []) {
          const cp = await companionProfile(ep.id);
          if (!cp) continue;
          if (isFormalCompanion(cp)) {
            return json(res, 409, { ok: false, message: "该邮箱已是正式陪玩账号，请直接登录。" });
          }
          const st = String(cp.application_status || "").toLowerCase();
          if (!/archived|deleted/.test(st) && (isApplicationDraft(cp) || /pending|submitted|review|reject|resubmit|need_more/.test(st))) {
            return json(res, 409, { ok: false, message: "该邮箱已有陪玩申请，请直接登录陪玩端继续填写或查看审核进度。" });
          }
        }
      } catch (uniqErr) {
        console.warn("[companion/register] uniqueness probe:", uniqErr?.message || uniqErr);
      }
      const created = await supabaseJson(authUrl("admin/users"), {
        method:"POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          email,
          password: authPassword,
          email_confirm: true,
          user_metadata: {
            display_name: nickname,
            has_password: wantsPassword,
            email_verified: true,
            email_verified_at: nowIso(),
            ...(wantsPassword ? { password_set_at: nowIso() } : {}),
          },
          app_metadata: { has_password: wantsPassword, email_verified: true },
        }),
      });
      const companionProfilePayload = {
        id: created.id,
        role: "companion",
        display_name: nickname,
        email,
        phone: "",
        status: "active",
        created_at: nowIso(),
        email_verified: true,
        email_verified_at: nowIso(),
      };
      try {
        await supabaseJson(restUrl("profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify(companionProfilePayload) });
      } catch (profErr) {
        if (/email_verified|Could not find|schema cache/i.test(String(profErr?.message || ""))) {
          const { email_verified, email_verified_at, ...fallback } = companionProfilePayload;
          void email_verified;
          void email_verified_at;
          await supabaseJson(restUrl("profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify(fallback) });
        } else {
          throw profErr;
        }
      }
      await supabaseJson(restUrl("companion_profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ user_id: created.id, nickname, contact_phone: "", verification_status: "pending", deposit_status: "pending", application_status: "draft", allow_orders: false, online_status: "offline", created_at: nowIso(), updated_at: nowIso() }) });
      try {
        const { stampPasswordSet, stampPasswordUnset } = await import("./_account-security.js");
        if (wantsPassword) await stampPasswordSet(created.id, { mustChangePassword: false });
        else await stampPasswordUnset(created.id);
      } catch { /* optional columns */ }
      let auth;
      if (wantsPassword) {
        auth = await supabaseJson(authUrl("token?grant_type=password"), { method:"POST", headers: anonHeaders(), body: JSON.stringify({ email, password: authPassword }) });
      } else {
        // Session without revealing opaque system password.
        const link = await supabaseJson(authUrl("admin/generate_link"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({ type: "magiclink", email }),
        });
        const hashed = link?.hashed_token || link?.properties?.hashed_token || "";
        auth = await supabaseJson(authUrl("verify"), {
          method: "POST",
          headers: anonHeaders(),
          body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
        });
      }
      const profile = await profileById(created.id);
      const companion = await companionProfile(created.id);
      return json(res,200,{
        ok:true,
        message: wantsPassword
          ? "陪玩账号已创建，请继续填写资料。草稿不会出现在正式陪玩列表。"
          : "陪玩账号已创建。建议前往账号安全设置密码（审核状态不影响密码设置）。",
        suggestSetPassword: !wantsPassword,
        session:{token:auth.access_token,accessToken:auth.access_token,refreshToken:auth.refresh_token||"",user:safePlayer(profile, companion || {}),remember:!!body.remember}
      });
    }
    const auth = await requireCompanion(req);
    const companion = auth.companion || await companionProfile(auth.profile.id) || {};
    const isolated = isCompanionIsolated(auth.profile, companion);
    if (isolated && !COMPANION_ISOLATION_ALLOWED_ACTIONS.has(action || "bootstrap")) {
      return isolationForbiddenResponse(res, {
        status: 403,
        message: COMPANION_ISOLATION_MSG,
        code: "COMPANION_ISOLATED",
        applicationStatus: normalizeProfileReviewStatus(companion),
        accountStatus: auth.profile.status || "",
        companionEnabled: companionEnabled(companion),
      });
    }
    if (req.method === "GET" && action === "bootstrap") return json(res,200,{ok:true,data:await bootstrapData(auth.profile, companion)});
    if (req.method === "GET" && action === "inbox") {
      const activeConversationId = String(req.query.conversation_id || req.query.conversationId || "").trim();
      const light =
        String(req.query.light || "").trim() === "1" ||
        String(req.query.mode || "").trim().toLowerCase() === "light";
      const includeActiveMessages =
        String(req.query.include_messages || req.query.includeMessages || (light ? "0" : "1")).trim() !== "0";
      try {
        let slice = {
          light,
          includeActiveMessages,
          activeConversationId,
          skipDerivedNotices: light,
        };
        if (!light) {
          const data = await bootstrapData(auth.profile, companion).catch(() => ({}));
          slice = {
            ...slice,
            player: data.player,
            verification: data.verification,
            deposit: data.deposit,
            myOrders: data.permissions?.isolationMode ? [] : data.myOrders,
            withdrawals: data.permissions?.isolationMode ? [] : data.withdrawals,
            popularity: data.permissions?.isolationMode ? null : data.popularity,
            auditLocked: !data.permissions?.canWork || !!data.permissions?.isolationMode,
            auditHint: data.permissions?.isolationMessage || data.permissions?.lockReason || "",
          };
        }
        const inbox = await buildCompanionInbox(auth.profile, companion, slice);
        return json(res, 200, { ok: true, data: inbox, inbox });
      } catch (err) {
        return json(res, 200, {
          ok: true,
          data: {
            conversations: [
              { id: "system", key: "system", type: "system", title: "系统通知", subtitle: "", lastMessage: "", unread: 0 },
            ],
            csConversations: [],
            csConversationId: "",
            messages: [],
            systemNotices: [],
            unreadTotal: 0,
            unreadMessages: 0,
            connectError: err.message || "客服连接失败",
          },
          message: err.message || "客服连接失败",
        });
      }
    }
    if (req.method === "GET" && (action === "thread" || action === "conversation_messages")) {
      const conversationId = String(req.query.conversation_id || req.query.conversationId || "").trim();
      try {
        const thread = await loadCompanionThreadMessages(auth.profile, conversationId);
        return json(res, 200, { ok: true, data: thread, messages: thread.messages, conversationId: thread.conversationId });
      } catch (err) {
        const status = Number(err?.status) || 500;
        return json(res, status >= 400 && status < 600 ? status : 500, {
          ok: false,
          message: err.message || "会话消息加载失败",
        });
      }
    }
    if (req.method === "GET" && (action === "wallet" || action === "earnings")) {
      try {
        assertCompanionBusinessAccess(auth.profile, companion);
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      if (!auth.profile?.id) {
        return json(res, 403, { ok: false, message: "profile_id 为空，无法查询钱包" });
      }
      let myOrders = [];
      try {
        const myRows = await supabaseJson(
          restUrl("orders", `?companion_id=eq.${encodeURIComponent(auth.profile.id)}&order=created_at.desc&limit=200`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        myOrders = (Array.isArray(myRows) ? myRows : [])
          .filter((row) => row.status !== "awaiting_payment")
          .map((row) => viewOrder(row, {}, null));
      } catch {
        myOrders = [];
      }
      const wallet = await loadWalletBundle(auth.profile, myOrders);
      const cfg = await financeSettings().catch(() => ({
        min_withdraw_cat_food: 50,
        max_withdrawals_per_month: 3,
        cat_food_to_rm_rate: 1,
        withdraw_fee_rm: 0,
        withdraw_fee_percent: 0,
      }));
      const paymentAccounts = await companionDb(
        "companion_payment_accounts",
        `?user_id=eq.${encodeURIComponent(auth.profile.id)}&order=submitted_at.desc&limit=20`
      ).catch(() => []);
      const payment =
        (paymentAccounts || []).find((a) => /approved|verified/.test(String(a.status || ""))) ||
        null;
      // Self wallet/earnings: full settlement account for the owner (same as bootstrap).
      const approvedAccounts = (paymentAccounts || [])
        .filter((a) => /approved|verified/.test(String(a.status || "")))
        .map((a) => ({
          id: a.id,
          bankName: a.bank_name || "",
          accountHolder: a.account_name || "",
          accountName: a.account_name || "",
          bankAccount: a.bank_account || "",
          tngAccount: a.tng_account || "",
          accountLast4: a.account_last4 || maskBankAccount(a.bank_account).slice(-4),
          status: a.status,
        }));
      const usedThisMonth = (wallet.withdrawalRows || []).filter(
        (w) =>
          String(w.submitted_at || "").slice(0, 7) === monthKey() &&
          !/rejected|cancelled/.test(String(w.status || ""))
      ).length;
      const monthlyLimit = Number(cfg.max_withdrawals_per_month || 3);
      return json(res, 200, {
        ok: true,
        data: {
          profileId: auth.profile.id,
          companionId: companion.id || null,
          summary: wallet.summary,
          earnings: wallet.earnings,
          walletLedger: wallet.walletLedger,
          earningDetails: wallet.earningDetails,
          withdrawals: await Promise.all((wallet.withdrawalRows || []).map((w) => viewCompanionWithdrawal(w))),
          withdrawalRules: {
            monthlyLimit,
            usedThisMonth,
            remainingThisMonth: Math.max(0, monthlyLimit - usedThisMonth),
            minAmount: money(cfg.min_withdraw_cat_food),
            exchangeRate: money(cfg.cat_food_to_rm_rate) || 1,
            feeRm: money(cfg.withdraw_fee_rm),
            feePercent: money(cfg.withdraw_fee_percent),
            currentAccount: payment
              ? `${payment.bank_name || ""} ${payment.account_name || ""} ${payment.bank_account || ""}`.trim()
              : "",
            currentAccountMasked: payment
              ? `${payment.bank_name || ""} ${payment.account_name || ""} ****${payment.account_last4 || maskBankAccount(payment.bank_account).slice(-4)}`.trim()
              : "",
            approvedAccounts,
          },
          warnings: wallet.warnings || [],
        },
      });
    }
    if (req.method === "GET" && action === "get_settlement") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion);
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      const orderId = String(req.query.id || req.query.order_id || "").trim();
      if (!orderId) return json(res, 400, { ok: false, message: "缺少订单 ID" });
      const txs = await transactionsFor(auth.profile.id);
      const tx = txs.find((t) => t.order_id === orderId && t.transaction_type === "companion_income");
      const settlement = tx ? parseSettlementNote(tx.note) : null;
      if (!settlement) return json(res, 404, { ok: false, message: "未找到该订单的结算详情" });
      return json(res, 200, { ok: true, settlement, transactionId: tx.id });
    }
    if (req.method !== "POST") return json(res,405,{ok:false,message:"Method Not Allowed"});
    const body = await parseBody(req);
    if (action === "accept_order") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      if (!canWork(auth.profile, companion || {})) {
        return json(res, 403, { ok: false, message: COMPANION_AUTH_LOCK_MSG });
      }
      try {
        await (await import("./_content-acks.js")).assertCompanionCanWork(auth.profile.id);
      } catch (err) {
        return json(res, err.status || 403, {
          ok: false,
          message: err.message || "请先确认强制公告",
          code: err.code || "FORCED_ACK_REQUIRED",
          pending: err.pending || [],
        });
      }
      const order = await claimOrder(auth.profile, companion, String(body.id || ""));
      const already = !!order._already;
      return json(res, 200, {
        ok: true,
        message: already ? "你已抢过该单，请等待老板选择。" : "已抢单，等待老板选择。",
        order: viewOrder({ ...order, companion_id: null, status: order.status || "waiting_boss_confirm" }),
        grab: order._grab || null,
        already,
        // Explicit: grab is NOT formal accept / NOT startable.
        formalAccepted: false,
        canStart: false,
      });
    }
    if (action === "accept_direct_order" || action === "accept_direct") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      if (!canWork(auth.profile, companion || {})) {
        return json(res, 403, { ok: false, message: COMPANION_AUTH_LOCK_MSG });
      }
      try {
        await (await import("./_content-acks.js")).assertCompanionCanWork(auth.profile.id);
      } catch (err) {
        return json(res, err.status || 403, {
          ok: false,
          message: err.message || "请先确认强制公告",
          code: err.code || "FORCED_ACK_REQUIRED",
          pending: err.pending || [],
        });
      }
      const id = String(body.id || "");
      const name = String(auth.profile.display_name || companion.nickname || "陪玩").trim() || "陪玩";
      const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = beforeRows?.[0];
      if (!before || before.status !== "claimed") return json(res, 409, { ok: false, message: "当前订单不能确认接单" });
      const now = nowIso();
      const order = await patchOwnOrder(
        auth.profile,
        id,
        "claimed",
        { status: "in_progress", accepted_at: now, started_at: now },
        `陪玩 ${name} 已确认接单，订单进入进行中。`
      );
      return json(res, 200, { ok: true, message: "已确认接单，订单进入进行中", order: viewOrder(order) });
    }
    if (action === "reject_direct_order") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      const id = String(body.id || "");
      const reasonRaw = String(body.reason || body.reject_reason || body.payload?.reason || "").trim();
      const reason = REJECT_REASONS.includes(reasonRaw) ? reasonRaw : (reasonRaw ? "其他原因" : "");
      if (!reason) return json(res, 400, { ok: false, message: "请选择无法接单的原因", reasons: REJECT_REASONS });
      const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = beforeRows?.[0];
      if (!before || before.status !== "claimed") return json(res, 409, { ok: false, message: "当前订单不能拒绝" });
      const name = String(auth.profile.display_name || companion.nickname || "陪玩").trim() || "陪玩";
      const note = `陪玩无法接单|原因:${reason}|原陪玩:${auth.profile.id}|${nowIso()}`;
      // Reject designated → reopen as public hall for CS re-assign / public grab.
      // Staging schema may lack cancel_reason / assignment_type / order_type — try progressively.
      const rejectAttempts = [
        {
          companion_id: null,
          status: "pending",
          accepted_at: null,
          assignment_type: "public",
          order_type: "open_grab",
          note,
        },
        {
          companion_id: null,
          status: "pending",
          accepted_at: null,
          note,
        },
        {
          companion_id: null,
          status: "pending",
          accepted_at: null,
        },
      ];
      let rows = null;
      let lastErr = null;
      for (const patch of rejectAttempts) {
        try {
          rows = await supabaseJson(
            restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&status=eq.claimed`),
            {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify(patch),
            }
          );
          if (rows?.[0] || Array.isArray(rows)) break;
        } catch (err) {
          lastErr = err;
          if (!/PGRST204|schema cache|column|Could not find/i.test(String(err?.message || err || ""))) throw err;
        }
      }
      if (!rows?.[0] && lastErr) throw lastErr;
      const saved = rows?.[0] || { ...before, companion_id: null, status: "pending", assignment_type: "public", note };
      await writeOrderStatusLog(
        { restUrl, supabaseJson, serviceHeaders },
        {
          orderId: id,
          fromStatus: before.status,
          toStatus: "pending",
          operatorRole: "companion",
          operatorId: auth.profile.id,
          note: `reject_direct: ${reason}`,
        }
      );
      await addSystemMessage(
        { ...saved, companion_id: null },
        auth.profile.id,
        "companion",
        `陪玩 ${name} 无法接单（${reason}）。订单 ${before.order_no || before.id} 状态：陪玩无法接单，等待重新安排。请客服更换陪玩、推送抢单、联系老板或发起退款。`
      );
      scheduleRecomputeSoft();
      return json(res, 200, {
        ok: true,
        message: "已提交无法接单，订单已交由客服重新安排",
        order: viewOrder(saved),
        reasons: REJECT_REASONS,
      });
    }
    if (action === "start_order") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      if (!canWork(auth.profile, companion || {})) {
        return json(res, 403, { ok: false, message: COMPANION_AUTH_LOCK_MSG });
      }
      try {
        await (await import("./_content-acks.js")).assertCompanionCanWork(auth.profile.id);
      } catch (err) {
        return json(res, err.status || 403, {
          ok: false,
          message: err.message || "请先确认强制公告",
          code: err.code || "FORCED_ACK_REQUIRED",
          pending: err.pending || [],
        });
      }
      const orderId = String(body.id || "");
      const beforeRows = await supabaseJson(
        restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const before = beforeRows?.[0];
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      // Already started by accept_direct (claimed → in_progress): idempotent OK.
      if (before.status === "in_progress") {
        return json(res, 200, {
          ok: true,
          message: "订单已在进行中。",
          order: viewOrder(before),
          already: true,
        });
      }
      // Legacy confirmed hop still supported.
      if (before.status !== "confirmed") {
        return json(res, 409, {
          ok: false,
          message:
            before.status === "waiting_boss_confirm" || before.status === "pending"
              ? "老板尚未确认人选，不能开始订单。"
              : before.status === "claimed"
                ? "请先确认接单。"
                : "当前订单状态不能开始服务。",
        });
      }
      const order = await patchOwnOrder(
        auth.profile,
        orderId,
        "confirmed",
        { status: "in_progress", started_at: nowIso() },
        "陪玩已开始服务。"
      );
      let reward = null;
      try {
        reward = await (await import("./_cs-commission-settle.js")).settleCsOrderIncome(
          { ...before, ...order, status: "in_progress" },
          { source: "companion_start" }
        );
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        message: "已开始服务，订单进入进行中。",
        order: viewOrder(order),
        reward,
      });
    }
    if (action === "complete_order" || action === "confirm_complete") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      const orderId = String(body.id || "");
      const existingTx = (await transactionsFor(auth.profile.id)).find(
        (t) => t.order_id === orderId && t.transaction_type === "companion_income" && t.status !== "cancelled"
      );
      if (existingTx) {
        const settlement = parseSettlementNote(existingTx.note) || null;
        return json(res, 200, {
          ok: true,
          message: "订单已结算",
          order: { id: orderId, status: "completed" },
          settlement,
          transactionId: existingTx.id,
        });
      }
      const beforeRows = await supabaseJson(
        restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const before = beforeRows?.[0];
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      if (before.status !== "in_progress") {
        return json(res, 409, { ok: false, message: "当前订单状态不能完成。" });
      }
      const { createOrderGrabHelpers } = await import("./_order-grabs.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      if (grabsApi.orderHasCompletionPending(before)) {
        // Backfill request timestamp for legacy pending rows (required for 24h auto-confirm).
        await grabsApi.markCompletionPending(before);
        const refreshed = (
          await supabaseJson(
            restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
            { headers: serviceHeaders() }
          )
        )?.[0] || before;
        return json(res, 200, {
          ok: true,
          message: "已申请完成，等待老板确认。",
          order: viewOrder(refreshed),
          awaitingBossConfirm: true,
        });
      }
      await grabsApi.markCompletionPending(before);
      const afterRows = await supabaseJson(
        restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const saved = afterRows?.[0] || before;
      await addSystemMessage(saved, auth.profile.id, "companion", "陪玩已完成服务，请确认订单。若老板 24 小时内未确认且无售后/争议，系统将自动确认完成。");
      return json(res, 200, {
        ok: true,
        message: "已提交完成申请，等待老板确认后结算。",
        order: viewOrder(saved),
        awaitingBossConfirm: true,
      });
    }
    if (action === "acknowledge_forced" || action === "ack_forced_announcement") {
      const contentId = String(body.content_id || body.contentId || body.id || "").trim();
      const contentVersion = String(body.content_version || body.contentVersion || body.version || "1").trim() || "1";
      const contentType = String(body.content_type || body.contentType || "announcement").trim() || "announcement";
      if (!contentId) return json(res, 400, { ok: false, message: "缺少内容 ID" });
      const acks = await import("./_content-acks.js");
      const pending = await acks.pendingForcedForUser(auth.profile.id, { audience: "companion" });
      const match = pending.find(
        (p) =>
          String(p.id) === contentId &&
          String(p.version) === contentVersion &&
          (!p.contentType || p.contentType === contentType || contentType === "announcement")
      );
      const forced = contentType === "announcement" ? await acks.listActiveForcedAnnouncements({ audience: "companion" }) : [];
      const row = forced.find((f) => String(f.id) === contentId) || match;
      if (!row && !match) return json(res, 404, { ok: false, message: "强制内容不存在或已停用" });
      const ver = contentVersion || String(row?.content_version || match?.version || 1);
      const type = match?.contentType || contentType || "announcement";
      const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
      const saved = await acks.acknowledgeContent({
        userId: auth.profile.id,
        contentType: type,
        contentId,
        contentVersion: ver,
        effectiveAt: row?.start_at || match?.publishedAt || "",
        contentUpdatedAt: row?.updated_at || match?.updatedAt || "",
        ip,
        userAgent: String(req.headers["user-agent"] || ""),
      });
      const still = await acks.pendingForcedForUser(auth.profile.id, { audience: "companion" });
      return json(res, 200, {
        ok: true,
        message: "已确认阅读强制公告",
        ack: saved,
        pendingForced: still,
        forcedAckRequired: still.length > 0,
      });
    }
    if (action === "pending_forced") {
      const pending = await (await import("./_content-acks.js")).pendingForcedForUser(auth.profile.id, { audience: "companion" });
      return json(res, 200, { ok: true, pendingForced: pending, forcedAckRequired: pending.length > 0 });
    }
    if (action === "set_online_status") {
      const allowed = new Set(["online", "busy", "paused", "offline"]);
      const raw = String(body.online_status || body.availability_status || body.status || "offline").toLowerCase();
      const status = allowed.has(raw) ? raw : "offline";
      if (auth.profile.status !== "active") return json(res, 403, { ok: false, message: "账号已停用，不能接单" });
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      if (!canWork(auth.profile, companion || {})) {
        return json(res, 403, { ok: false, message: COMPANION_AUTH_LOCK_MSG });
      }
      if (status === "online" || status === "busy") {
        try {
          await (await import("./_content-acks.js")).assertCompanionCanWork(auth.profile.id);
        } catch (err) {
          return json(res, err.status || 403, {
            ok: false,
            message: err.message || "请先确认强制公告",
            code: err.code || "FORCED_ACK_REQUIRED",
            pending: err.pending || [],
          });
        }
      }
      const patch = {
        online_status: status,
        availability_status: status,
        status_updated_at: nowIso(),
        updated_at: nowIso(),
      };
      if (status === "online") patch.last_online_at = nowIso();
      try {
        const rows = await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(patch),
        });
        await recordOnlineSession(auth.profile.id, status);
        return json(res, 200, {
          ok: true,
          message: ({ online: "已设为在线可接单", busy: "已设为忙碌", paused: "已暂停接单", offline: "已离线" })[status],
          onlineStatus: status,
          onlineStatusLabel: statusLabel(status),
          profile: rows?.[0] || null,
        });
      } catch (e) {
        const rows = await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ online_status: status, updated_at: nowIso() }),
        });
        await recordOnlineSession(auth.profile.id, status === "online" ? "online" : "offline");
        return json(res, 200, {
          ok: true,
          message: ({ online: "已设为在线可接单", busy: "已设为忙碌", paused: "已暂停接单", offline: "已离线" })[status],
          onlineStatus: status,
          onlineStatusLabel: statusLabel(status),
          profile: rows?.[0] || null,
        });
      }
    }
    if (action === "update_profile") {
      if (body.privacy_only) {
        const privacyContact = String(body.contact_phone || body.phone || "").trim();
        if (!privacyContact) return json(res, 400, { ok: false, message: "请填写联系方式", field: "contact_phone" });
        await patchCompanionProfile(`?user_id=eq.${encodeURIComponent(auth.profile.id)}`, {
          contact_phone: privacyContact,
          updated_at: nowIso(),
        });
        try {
          await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ phone: privacyContact }),
          });
        } catch {
          /* optional */
        }
        return json(res, 200, { ok: true, message: "联系方式已保存（仅自己/客服/后台可见）" });
      }

      const nickname = String(body.nickname || "").trim();
      const ageNum = body.age === "" || body.age == null ? null : Number(body.age);
      const gender = String(body.gender || "").trim();
      const region = String(body.region || "").trim();
      const contactProvided = body.contact_phone != null || body.phone != null;
      const contact = contactProvided ? String(body.contact_phone || body.phone || "").trim() : "";
      const gameId = String(body.game_id || "").trim();
      if (!nickname) return json(res, 400, { ok: false, message: "请填写昵称", field: "nickname" });
      if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 60) return json(res, 400, { ok: false, message: "年龄须为 18–60 的数字", field: "age" });
      if (!["男", "女", "不公开"].includes(gender)) return json(res, 400, { ok: false, message: "请选择性别", field: "gender" });
      if (!region) return json(res, 400, { ok: false, message: "请填写地区", field: "region" });
      if (contactProvided && !contact) return json(res, 400, { ok: false, message: "请填写联系方式", field: "contact_phone" });
      if (!gameId) return json(res, 400, { ok: false, message: "请填写游戏 ID", field: "game_id" });

      const servicesBundle = await loadPublicServices().catch(() => ({ services: [] }));
      const catalog = Array.isArray(servicesBundle?.services) ? servicesBundle.services : [];
      const byId = new Map(catalog.map((s) => [String(s.id), s]));
      const byName = new Map(catalog.map((s) => [String(s.name || s.title || "").trim(), s]));

      let serviceIds = [];
      if (Array.isArray(body.service_ids) || Array.isArray(body.serviceIds)) {
        serviceIds = parseServiceIds(body.service_ids || body.serviceIds);
      } else if (body.service_ids != null || body.serviceIds != null) {
        serviceIds = parseServiceIds(body.service_ids || body.serviceIds);
      }
      const selectedNamesFromBody = splitGames(body.main_game || body.game || "");
      if (!serviceIds.length && selectedNamesFromBody.length) {
        serviceIds = selectedNamesFromBody
          .map((name) => byName.get(name)?.id)
          .filter(Boolean)
          .map(String);
      }
      serviceIds = [...new Set(serviceIds.filter((id) => byId.has(String(id))))];
      if (!serviceIds.length) {
        return json(res, 400, { ok: false, message: "请至少选择一个可接游戏", field: "main_game" });
      }
      const selectedServices = serviceIds.map((id) => byId.get(String(id))).filter(Boolean);
      const mainGame = selectedServices.map((s) => s.name || s.title).filter(Boolean).join("、");

      const serviceTypes = parseServiceTypes(body.service_type || body.serviceType || body.service_types || body.serviceTypes, {
        fallbackPlayWhenGame: false,
      });
      if (!serviceTypes.length) {
        return json(res, 400, { ok: false, message: "请至少选择一种可提供服务（陪玩服务 / 陪聊服务）", field: "service_type" });
      }

      const levelBundle = await resolveLevelBundle(companion || {});
      const min = money(levelBundle.minPrice);
      const max = money(levelBundle.maxPrice);
      const reviewStNow = normalizeProfileReviewStatus(companion || {});
      // 审核中不可改价；草稿/驳回可改；通过后可改。
      if (reviewStNow === "pending") {
        return json(res, 403, {
          ok: false,
          message: "资料审核中，暂不可修改价格。请等待审核结果。",
          field: "price",
        });
      }
      let gamePricesInput = body.game_prices;
      if (typeof gamePricesInput === "string") {
        try { gamePricesInput = JSON.parse(gamePricesInput); } catch { gamePricesInput = {}; }
      }
      if (!gamePricesInput || typeof gamePricesInput !== "object") gamePricesInput = {};
      const nextGamePrices = {};
      if (!levelBundle.level) {
        return json(res, 400, { ok: false, message: "当前账号尚未设置等级，无法保存单价，请联系后台", field: "price" });
      }
      for (const svc of selectedServices) {
        const id = String(svc.id);
        const name = String(svc.name || svc.title || "").trim();
        const rawG = gamePricesInput[id] != null
          ? String(gamePricesInput[id]).trim()
          : gamePricesInput[name] != null
            ? String(gamePricesInput[name]).trim()
            : "";
        if (!rawG) return json(res, 400, { ok: false, message: `请填写 ${name} 的价格`, field: "price" });
        if (!/^\d+(\.\d{1,2})?$/.test(rawG)) {
          return json(res, 400, { ok: false, message: `${name} 单价只能输入有效数字，最多保留 2 位小数`, field: "price" });
        }
        const pv = roundMoney(rawG);
        if (pv < min || (!levelBundle.maxPlus && pv > max)) {
          return json(res, 400, {
            ok: false,
            message: `${name} 单价必须在 RM${min}–RM${max}${levelBundle.maxPlus ? "+" : ""} 之间`,
            field: "price",
            minPrice: min,
            maxPrice: max,
          });
        }
        nextGamePrices[id] = pv;
        if (name) nextGamePrices[name] = pv;
      }

      let priceValue = companion.price != null ? money(companion.price) : null;
      const firstId = serviceIds[0];
      const firstName = selectedServices[0]?.name || selectedServices[0]?.title || "";
      if (firstId && nextGamePrices[firstId] != null) {
        priceValue = money(nextGamePrices[firstId]);
      } else if (firstName && nextGamePrices[firstName] != null) {
        priceValue = money(nextGamePrices[firstName]);
      } else if (body.price != null && String(body.price).trim() !== "") {
        const rawPrice = String(body.price).trim();
        if (!/^\d+(\.\d{1,2})?$/.test(rawPrice)) {
          return json(res, 400, { ok: false, message: "单价只能输入有效数字，最多保留 2 位小数", field: "price" });
        }
        priceValue = roundMoney(rawPrice);
        if (priceValue < min || (!levelBundle.maxPlus && priceValue > max)) {
          return json(res, 400, {
            ok: false,
            message: `单价必须在 RM${min}–RM${max}${levelBundle.maxPlus ? "+" : ""} 之间`,
            field: "price",
            minPrice: min,
            maxPrice: max,
          });
        }
      } else if (levelBundle.priceNeedsReset && !Object.keys(nextGamePrices).length) {
        return json(res, 400, {
          ok: false,
          message: "当前单价已超出等级范围，请重新设置单价后再保存",
          field: "price",
          priceNeedsReset: true,
        });
      }

      const publicTags = String(body.public_tags || body.tags || "").trim();
      const galleryKeep = (String(companion.tags || "").match(/\[\[MCJ_GALLERY:[\s\S]*?\]\]/) || [])[0] || "";
      let tagsForWrite = publicTags || stripGamePricesMarker(String(companion.tags || "")).replace(/\[\[MCJ_GALLERY:[\s\S]*?\]\]/g, "").trim();
      if (galleryKeep) tagsForWrite = `${tagsForWrite}${tagsForWrite ? "," : ""}${galleryKeep}`;
      tagsForWrite = writeGamePricesMarker(tagsForWrite, nextGamePrices);

      let voiceTypeValue = "";
      try {
        voiceTypeValue = await normalizeSelectedVoiceTypes(
          body.voice_type != null || body.voiceType != null
            ? body.voice_type || body.voiceType
            : companion.voice_type || "",
          { required: true }
        );
      } catch (voiceErr) {
        return json(res, voiceErr.status || 400, {
          ok: false,
          message: voiceErr.message || "请选择声线",
          field: voiceErr.field || "voice_type",
        });
      }

      const patch = {
        nickname,
        game: mainGame,
        main_service: String(body.main_service || body.mainService || companion.main_service || ""),
        service_type: serviceTypes.join(","),
        service_ids: serviceIds,
        description: String(body.bio || body.description || ""),
        voice_url: String(body.voice_url || companion.voice_url || ""),
        voice_type: voiceTypeValue,
        price: priceValue != null ? priceValue : money(companion.price),
        game_prices: nextGamePrices,
        age: ageNum,
        gender,
        region,
        tags: tagsForWrite,
        game_rank: String(body.rank || body.game_rank || ""),
        position: String(body.position || ""),
        schedule: String(body.schedule || companion.schedule || ""),
        game_id: gameId,
        // Already-approved companions keep approved so price writes stay live for boss orders.
        // Rejected / resubmit / pending → re-enter review queue and clear prior reject text.
        application_status: /approved|verified|passed/i.test(String(companion.application_status || ""))
          ? "approved"
          : "pending",
        updated_at: nowIso(),
      };
      if (!/approved|verified|passed/i.test(String(companion.application_status || ""))) {
        patch.application_reject_reason = "";
      }
      if (contactProvided) patch.contact_phone = contact;
      if (body.card_image_url) patch.card_image_url = String(body.card_image_url);
      Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
      try {
        if (!companion.id) {
          await supabaseJson(restUrl("companion_profiles"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify({ user_id: auth.profile.id, ...patch, deposit_status: "pending", online_status: "offline", created_at: nowIso() }),
          });
        } else {
          await patchCompanionProfile(`?user_id=eq.${encodeURIComponent(auth.profile.id)}`, patch);
        }
      } catch (error) {
        // Last-resort core fields that exist on early schemas.
        const core = {
          nickname: patch.nickname,
          game: patch.game,
          description: patch.description,
          voice_url: patch.voice_url,
          voice_type: patch.voice_type,
          price: patch.price,
          updated_at: patch.updated_at,
          tags: writeGamePricesMarker(String(patch.tags || ""), nextGamePrices),
        };
        if (patch.card_image_url) core.card_image_url = patch.card_image_url;
        const tagBits = [core.tags];
        if (gameId) tagBits.push(`游戏ID:${gameId}`);
        if (contactProvided && contact) tagBits.push(`联系:${contact}`);
        if (region) tagBits.push(`地区:${region}`);
        if (gender) tagBits.push(`性别:${gender}`);
        if (ageNum != null) tagBits.push(`年龄:${ageNum}`);
        const tagsJoined = tagBits.filter(Boolean).join(",");
        if (tagsJoined) core.tags = tagsJoined;
        await patchCompanionProfile(`?user_id=eq.${encodeURIComponent(auth.profile.id)}`, core);
      }
      await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          display_name: nickname,
          ...(contactProvided ? { phone: contact } : {}),
        }),
      });
      const stayedApproved = /approved|verified|passed/i.test(String(patch.application_status || ""));
      const wasRejected = /reject|resubmit|need_more/i.test(String(companion.application_status || ""));
      return json(res, 200, {
        ok: true,
        message: stayedApproved
          ? "保存成功"
          : wasRejected
            ? "已重新提交审核，请等待后台复核"
            : "保存成功，资料已提交审核",
        gamePrices: nextGamePrices,
        price: priceValue != null ? priceValue : money(companion.price),
        applicationStatus: patch.application_status,
      });
    }

    if (action === "submit_verification") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      const existingIdentity = (
        await companionDb(
          "companion_identity_verifications",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&limit=1`
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)))
      )?.[0];
      const existingPayment = (
        await companionDb(
          "companion_payment_accounts",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)))
      )?.[0];
      const frontRaw = body.id_front || body.idFront || "";
      const backRaw = body.id_back || body.idBack || "";
      const handheldRaw = body.id_handheld || body.idHandheld || "";
      const front = frontRaw
        ? await saveUploadFromBody(auth.profile.id, "id-front", PRIVATE_BUCKETS.identity, frontRaw, "id-front.jpg")
        : { path: existingIdentity?.id_front_path || "" };
      const back = backRaw
        ? await saveUploadFromBody(auth.profile.id, "id-back", PRIVATE_BUCKETS.identity, backRaw, "id-back.jpg")
        : { path: existingIdentity?.id_back_path || "" };
      const handheld = handheldRaw
        ? await saveUploadFromBody(
            auth.profile.id,
            "id-handheld",
            PRIVATE_BUCKETS.identity,
            handheldRaw,
            "id-handheld.jpg"
          )
        : { path: existingIdentity?.id_handheld_path || "" };
      if (!front.path || !back.path) {
        return json(res, 400, { ok: false, message: "请上传身份证正面和反面照片。" });
      }
      const identityNoRaw = String(body.identity_no || body.identityNo || "").trim();
      const identityNo =
        !identityNoRaw || /^\*+\d{0,4}$/.test(identityNoRaw)
          ? String(existingIdentity?.identity_no || "")
          : identityNoRaw;
      if (!identityNo) {
        // Apply form uploads ID photos but does not collect identity_no; allow pending review with empty number.
        if (!(front.path && back.path)) {
          return json(res, 400, { ok: false, message: "请填写身份证号码。" });
        }
        identityNo = "";
      }
      const bankAccountRaw = String(body.bank_account || body.bankAccount || "").trim();
      const bankAccount =
        !bankAccountRaw || /^\*+\d{0,4}$/.test(bankAccountRaw)
          ? String(existingPayment?.bank_account || "")
          : bankAccountRaw;
      await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
        real_name: String(body.real_name || body.realName || ""),
        identity_no: identityNo,
        id_front_path: front.path || "",
        id_back_path: back.path || "",
        id_handheld_path: handheld.path || "",
        status: "pending",
        reject_reason: "",
        submitted_at: nowIso(),
      });
      if (body.bank_name || bankAccount || body.settlementMethod || body.method || body.tng_account || body.alipay_account) {
        await upsertByCompanion("companion_payment_accounts", row.id, auth.profile.id, {
          method: String(body.settlementMethod || body.method || body.payment_method || "bank"),
          bank_name: String(body.bank_name || body.bankName || ""),
          account_name: String(body.account_name || body.accountName || body.real_name || ""),
          bank_account: bankAccount,
          account_last4: String(bankAccount || "")
            .replace(/\s+/g, "")
            .slice(-4),
          tng_account: String(body.tng_account || body.tngAccount || existingPayment?.tng_account || ""),
          alipay_account: String(body.alipay_account || body.alipayAccount || ""),
          status: "pending",
          reject_reason: "",
          submitted_at: nowIso(),
        });
      }
      if (body.phone || body.contact_phone) {
        try {
          await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              contact_phone: String(body.phone || body.contact_phone || "").trim(),
              updated_at: nowIso(),
            }),
          });
        } catch {
          /* optional */
        }
      }
      await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          verification_status: "pending",
          application_status: "pending",
          application_reject_reason: "",
          application_submitted_at: nowIso(),
          updated_at: nowIso(),
        }),
      });
      return json(res, 200, { ok: true, message: "已提交审核，等待后台审核。" });
    }

    if (action === "upload_private_doc") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      const docType = String(body.doc_type || body.docType || body.media_type || "").trim();
      const dataUrl = body.data_url || body.dataUrl || body.file;
      if (!dataUrl || !String(dataUrl).startsWith("data:")) {
        return json(res, 400, { ok: false, message: "请选择图片文件上传。" });
      }
      if (docType === "id_front" || docType === "id-front") {
        const uploaded = await saveUploadFromBody(
          auth.profile.id,
          "id-front",
          PRIVATE_BUCKETS.identity,
          dataUrl,
          body.filename || "id-front.jpg"
        );
        const existing = (
          await companionDb(
            "companion_identity_verifications",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&limit=1`
          ).catch(() => [])
        )?.[0];
        const cur = String(existing?.status || "").toLowerCase();
        const keepPending =
          /pending|review|submit/.test(cur) &&
          String(existing?.real_name || "").trim() &&
          String(existing?.identity_no || "").trim();
        await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
          real_name: existing?.real_name || "",
          identity_no: existing?.identity_no || "",
          id_front_path: uploaded.path,
          id_back_path: existing?.id_back_path || "",
          id_handheld_path: existing?.id_handheld_path || "",
          status: keepPending ? "pending" : "draft",
          reject_reason: existing?.reject_reason || "",
          submitted_at: existing?.submitted_at || null,
        });
        const url = await signedPrivateDocUrl(PRIVATE_BUCKETS.identity, uploaded.path);
        return json(res, 200, { ok: true, message: "身份证正面上传成功", docType: "id_front", url, path: uploaded.path });
      }
      if (docType === "id_back" || docType === "id-back") {
        const uploaded = await saveUploadFromBody(
          auth.profile.id,
          "id-back",
          PRIVATE_BUCKETS.identity,
          dataUrl,
          body.filename || "id-back.jpg"
        );
        const existing = (
          await companionDb(
            "companion_identity_verifications",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&limit=1`
          ).catch(() => [])
        )?.[0];
        const cur = String(existing?.status || "").toLowerCase();
        const keepPending =
          /pending|review|submit/.test(cur) &&
          String(existing?.real_name || "").trim() &&
          String(existing?.identity_no || "").trim();
        await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
          real_name: existing?.real_name || "",
          identity_no: existing?.identity_no || "",
          id_front_path: existing?.id_front_path || "",
          id_back_path: uploaded.path,
          id_handheld_path: existing?.id_handheld_path || "",
          status: keepPending ? "pending" : "draft",
          reject_reason: existing?.reject_reason || "",
          submitted_at: existing?.submitted_at || null,
        });
        const url = await signedPrivateDocUrl(PRIVATE_BUCKETS.identity, uploaded.path);
        return json(res, 200, { ok: true, message: "身份证反面上传成功", docType: "id_back", url, path: uploaded.path });
      }
      if (docType === "deposit_proof" || docType === "deposit" || docType === "proof") {
        const uploaded = await saveUploadFromBody(
          auth.profile.id,
          "deposit",
          PRIVATE_BUCKETS.payment,
          dataUrl,
          body.filename || "deposit-proof.jpg"
        );
        const existing = (
          await companionDb(
            "companion_deposits",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`
          ).catch(() => [])
        )?.[0];
        const cur = String(existing?.status || "").toLowerCase();
        const keepPending =
          /pending|review|submit/.test(cur) &&
          Number(existing?.paid_amount || 0) > 0 &&
          String(existing?.payment_method || "").trim();
        await upsertByCompanion("companion_deposits", row.id, auth.profile.id, {
          required_amount: money(existing?.required_amount || 100) || 100,
          paid_amount: money(existing?.paid_amount || body.paid_amount || 0),
          payment_method: String(existing?.payment_method || body.payment_method || ""),
          proof_path: uploaded.path,
          proof_bucket: uploaded.bucket || PRIVATE_BUCKETS.payment,
          status: keepPending ? "pending" : "draft",
          reject_reason: existing?.reject_reason || "",
          remark: String(existing?.remark || body.remark || ""),
          paid_at: existing?.paid_at || null,
        });
        const url = await signedPrivateDocUrl(PRIVATE_BUCKETS.payment, uploaded.path);
        return json(res, 200, {
          ok: true,
          message: "付款凭证上传成功",
          docType: "deposit_proof",
          url,
          path: uploaded.path,
        });
      }
      return json(res, 400, { ok: false, message: "不支持的证件类型" });
    }

    if (action === "delete_private_doc") {
      const row = await ensureCompanionRow(auth.profile, companion);
      const docType = String(body.doc_type || body.docType || "").trim();
      if (docType === "id_front" || docType === "id-front") {
        const existing = (
          await companionDb(
            "companion_identity_verifications",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&limit=1`
          ).catch(() => [])
        )?.[0];
        if (existing?.id_front_path) {
          try {
            await deleteStorageObject(PRIVATE_BUCKETS.identity, existing.id_front_path);
          } catch {
            /* ignore */
          }
        }
        if (existing) {
          await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
            real_name: existing.real_name || "",
            identity_no: existing.identity_no || "",
            id_front_path: "",
            id_back_path: existing.id_back_path || "",
            id_handheld_path: existing.id_handheld_path || "",
            status: "pending",
            reject_reason: "",
            submitted_at: existing.submitted_at || nowIso(),
          });
        }
        return json(res, 200, { ok: true, message: "已删除身份证正面" });
      }
      if (docType === "id_back" || docType === "id-back") {
        const existing = (
          await companionDb(
            "companion_identity_verifications",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&limit=1`
          ).catch(() => [])
        )?.[0];
        if (existing?.id_back_path) {
          try {
            await deleteStorageObject(PRIVATE_BUCKETS.identity, existing.id_back_path);
          } catch {
            /* ignore */
          }
        }
        if (existing) {
          await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
            real_name: existing.real_name || "",
            identity_no: existing.identity_no || "",
            id_front_path: existing.id_front_path || "",
            id_back_path: "",
            id_handheld_path: existing.id_handheld_path || "",
            status: "pending",
            reject_reason: "",
            submitted_at: existing.submitted_at || nowIso(),
          });
        }
        return json(res, 200, { ok: true, message: "已删除身份证反面" });
      }
      if (docType === "deposit_proof" || docType === "deposit" || docType === "proof") {
        const existing = (
          await companionDb(
            "companion_deposits",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`
          ).catch(() => [])
        )?.[0];
        if (existing?.proof_path) {
          try {
            await deleteStorageObject(existing.proof_bucket || PRIVATE_BUCKETS.payment, existing.proof_path);
          } catch {
            /* ignore */
          }
        }
        if (existing) {
          await upsertByCompanion("companion_deposits", row.id, auth.profile.id, {
            required_amount: money(existing.required_amount || 100) || 100,
            paid_amount: money(existing.paid_amount),
            payment_method: String(existing.payment_method || ""),
            proof_path: "",
            proof_bucket: existing.proof_bucket || PRIVATE_BUCKETS.payment,
            status: "pending",
            reject_reason: "",
            remark: String(existing.remark || ""),
            paid_at: existing.paid_at || nowIso(),
          });
        }
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ deposit_status: "pending", updated_at: nowIso() }),
        });
        return json(res, 200, { ok: true, message: "已删除付款凭证" });
      }
      return json(res, 400, { ok: false, message: "不支持的证件类型" });
    }

    if (action === "submit_deposit_proof" || action === "submit_deposit") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      const existingDeposit = (
        await companionDb(
          "companion_deposits",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)))
      )?.[0];
      const proofRaw = body.proof_url || body.proofUrl || body.proof || "";
      const proof = proofRaw
        ? await saveUploadFromBody(
            auth.profile.id,
            "deposit",
            PRIVATE_BUCKETS.payment,
            proofRaw,
            "deposit-proof.jpg"
          )
        : {
            path: existingDeposit?.proof_path || "",
            bucket: existingDeposit?.proof_bucket || PRIVATE_BUCKETS.payment,
          };
      if (!proof.path) {
        return json(res, 400, { ok: false, message: "请先上传押金付款凭证图片。" });
      }
      await upsertByCompanion("companion_deposits", row.id, auth.profile.id, {
        required_amount: money(body.required_amount || existingDeposit?.required_amount || 100) || 100,
        paid_amount: money(body.paid_amount || body.paidAmount),
        payment_method: String(body.payment_method || body.paymentMethod || ""),
        proof_path: proof.path || "",
        proof_bucket: proof.bucket || PRIVATE_BUCKETS.payment,
        status: "pending",
        reject_reason: "",
        remark: String(body.remark || ""),
        paid_at: nowIso(),
      });
      const bankAccountRaw = String(body.bank_account || body.bankAccount || body.settlementAccount || "").trim();
      const settlementMethod = String(
        body.settlementMethod || body.method || body.payment_method || body.paymentMethod || ""
      ).trim();
      const settlementName = String(body.account_name || body.accountName || body.settlementName || "").trim();
      const settlementBank = String(body.bank_name || body.bankName || body.settlementBank || "").trim();
      const tngAccount = String(body.tng_account || body.tngAccount || "").trim();
      const alipayAccount = String(body.alipay_account || body.alipayAccount || "").trim();
      if (bankAccountRaw || settlementName || settlementBank || tngAccount || alipayAccount || settlementMethod) {
        const existingPayment = (
          await companionDb(
            "companion_payment_accounts",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`
          ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)))
        )?.[0];
        const bankAccount =
          !bankAccountRaw || /^\*+\d{0,4}$/.test(bankAccountRaw)
            ? String(existingPayment?.bank_account || "")
            : bankAccountRaw;
        await upsertByCompanion("companion_payment_accounts", row.id, auth.profile.id, {
          method: settlementMethod || String(existingPayment?.method || "bank"),
          bank_name: settlementBank || String(existingPayment?.bank_name || ""),
          account_name: settlementName || String(existingPayment?.account_name || ""),
          bank_account: bankAccount,
          account_last4: String(bankAccount || "")
            .replace(/\s+/g, "")
            .slice(-4),
          tng_account: tngAccount || String(existingPayment?.tng_account || ""),
          alipay_account: alipayAccount || String(existingPayment?.alipay_account || ""),
          status: "pending",
          reject_reason: "",
          submitted_at: nowIso(),
        });
      }
      await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ deposit_status: "pending", updated_at: nowIso() }),
      });
      return json(res, 200, { ok: true, message: "已提交审核，等待后台审核。" });
    }

    if (action === "upload_media") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      let mediaType = String(body.media_type || body.mediaType || "gallery");
      if (mediaType === "card" || mediaType === "card_image") mediaType = "cover";
      if (!["avatar", "cover", "gallery", "voice", "video"].includes(mediaType)) {
        return json(res, 400, { ok: false, message: "不支持的媒体类型" });
      }
      const dataUrl = body.data_url || body.dataUrl || body.file;
      if (!dataUrl) return json(res, 400, { ok: false, message: "请选择要上传的文件" });

      const galleryFallback = readGalleryFallback(row.tags || companion.tags || "");
      if (mediaType === "gallery") {
        const existing = await companionDb(
          "companion_media",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.gallery&select=id,sort_order,content_type,storage_path`
        ).catch((e) => (isMissingRelation(e) ? null : Promise.reject(e)));
        const galleryRows = (existing || []).filter((g) => !/^video\//i.test(String(g.content_type || "")));
        const galleryCount = existing == null ? galleryFallback.items.length : galleryRows.length;
        if (galleryCount >= 6) {
          return json(res, 400, { ok: false, message: "相册最多上传 6 张，请先删除后再上传" });
        }
        // Append semantics: next sort_order = max + 10 (never overwrite prior rows).
        if (existing != null && body.sort_order == null) {
          const maxSort = galleryRows.reduce((acc, g) => Math.max(acc, Number(g.sort_order) || 0), 0);
          body.sort_order = maxSort + 10;
        }
      }

      let uploaded;
      let publicUrl = "";
      if (mediaType === "voice") {
        const decoded = decodeDataUrl(dataUrl);
        if (!decoded) return json(res, 400, { ok: false, message: "请选择要上传的语音文件" });
        const checked = assertAudioUpload(decoded);
        const objectPath = buildObjectPath(auth.profile.id, "voice", body.filename || "voice.webm");
        await uploadPrivateObject(PRIVATE_BUCKETS.audio, objectPath, checked.buffer, checked.contentType);
        uploaded = { bucket: PRIVATE_BUCKETS.audio, path: objectPath, contentType: checked.contentType };
      } else if (mediaType === "video") {
        const decoded = decodeDataUrl(dataUrl);
        if (!decoded) return json(res, 400, { ok: false, message: "请选择要上传的视频文件" });
        const checked = assertVideoUpload(decoded);
        const dur = body.duration_seconds != null ? Number(body.duration_seconds) : null;
        if (dur && dur > 30.5) return json(res, 400, { ok: false, message: "视频最长 30 秒" });
        const objectPath = buildObjectPath(auth.profile.id, "video", body.filename || "showcase.mp4");
        const bucket = PRIVATE_BUCKETS.video;
        await uploadPrivateObject(bucket, objectPath, checked.buffer, checked.contentType);
        uploaded = { bucket, path: objectPath, contentType: checked.contentType };
      } else {
        const decoded = assertImageUpload(decodeDataUrl(dataUrl));
        const objectPath = buildObjectPath(auth.profile.id, mediaType, body.filename || `${mediaType}.jpg`);
        let bucket = PUBLIC_BUCKETS.profile;
        try {
          await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType);
          publicUrl = publicObjectUrl(bucket, objectPath);
        } catch (publicErr) {
          // Private fallback is allowed for storage, but NEVER persist signed URLs into profile fields.
          bucket = PRIVATE_BUCKETS.gallery;
          await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType);
          publicUrl = "";
          console.warn(
            "[companion.upload_media] public bucket failed, stored in private gallery without durable profile URL",
            publicErr?.message || publicErr
          );
        }
        uploaded = { bucket, path: objectPath, contentType: decoded.contentType };
      }
      if (!uploaded.path) return json(res, 400, { ok: false, message: "缺少上传文件" });

      if (mediaType === "avatar" || mediaType === "cover" || mediaType === "voice" || mediaType === "video") {
        const oldRows = await companionDb(
          "companion_media",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.${encodeURIComponent(mediaType)}`
        ).catch(() => []);
        let legacyVideoRows = [];
        if (mediaType === "video") {
          // Older DBs may store showcase video as gallery + video/* content_type.
          const galleryRows = await companionDb(
            "companion_media",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.gallery&select=*`
          ).catch(() => []);
          legacyVideoRows = (galleryRows || []).filter(
            (g) =>
              /^video\//i.test(String(g.content_type || "")) ||
              /\/video\//i.test(String(g.storage_path || "")) ||
              String(g.storage_bucket || "") === PRIVATE_BUCKETS.video
          );
        }
        for (const old of [...(oldRows || []), ...legacyVideoRows]) {
          try {
            await deleteStorageObject(old.storage_bucket, old.storage_path);
          } catch {
            /* ignore */
          }
          try {
            await companionDb("companion_media", `?id=eq.${encodeURIComponent(old.id)}`, { method: "DELETE" });
          } catch {
            /* ignore */
          }
        }
      }

      const sortOrder =
        mediaType === "avatar"
          ? 0
          : mediaType === "cover"
            ? 1
          : body.sort_order != null
            ? Number(body.sort_order)
            : 100 + (Date.now() % 100000);
      let mediaRow = null;
      let mediaTableMissing = false;
      let persistedMediaType = mediaType;
      try {
        const mediaPayload = {
          companion_profile_id: row.id,
          user_id: auth.profile.id,
          media_type: mediaType,
          storage_bucket: uploaded.bucket,
          storage_path: uploaded.path,
          content_type: uploaded.contentType || "",
          duration_seconds: body.duration_seconds != null ? Number(body.duration_seconds) : null,
          status: "pending",
          sort_order: sortOrder,
          uploaded_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        try {
          const mediaRows = await companionDb("companion_media", "", {
            method: "POST",
            body: JSON.stringify(mediaPayload),
          });
          mediaRow = Array.isArray(mediaRows) ? mediaRows[0] : mediaRows;
        } catch (insertErr) {
          // Legacy DB check only allows avatar|gallery|voice — store cover as gallery sort 1 so admin still sees it.
          const insertMsg = `${insertErr?.message || ""} ${JSON.stringify(insertErr?.body || "")}`;
          if (
            (mediaType === "cover" || mediaType === "video") &&
            /media_type|check|23514|violates/i.test(insertMsg)
          ) {
            persistedMediaType = "gallery";
            const fallbackPayload = {
              ...mediaPayload,
              media_type: "gallery",
              sort_order: mediaType === "cover" ? 1 : 2,
            };
            const mediaRows = await companionDb("companion_media", "", {
              method: "POST",
              body: JSON.stringify(fallbackPayload),
            });
            mediaRow = Array.isArray(mediaRows) ? mediaRows[0] : mediaRows;
          } else {
            throw insertErr;
          }
        }
      } catch (error) {
        if (!isMissingRelation(error)) throw error;
        mediaTableMissing = true;
      }

      if (!publicUrl && uploaded.bucket && uploaded.path) {
        try {
          if (uploaded.bucket === PUBLIC_BUCKETS.profile || /public/i.test(uploaded.bucket)) {
            publicUrl = publicObjectUrl(uploaded.bucket, uploaded.path);
          } else {
            // Request response may include a short-lived signed URL for immediate preview,
            // but profile.avatar_url / card_image_url stay empty so public pages resolve via companion_media.
            publicUrl = await createSignedUrl(uploaded.bucket, uploaded.path, 60 * 60);
          }
        } catch {
          publicUrl = "";
        }
      }

      // Keep media pending until admin review_application / review_media approves.
      const companionPatch = { media_status: "pending", media_reject_reason: "", updated_at: nowIso() };
      const durablePublicUrl =
        uploaded.bucket === PUBLIC_BUCKETS.profile || /public/i.test(String(uploaded.bucket || ""))
          ? publicObjectUrl(uploaded.bucket, uploaded.path)
          : "";
      const durableStorageRef =
        uploaded.bucket && uploaded.path ? `storage://${uploaded.bucket}/${uploaded.path}` : "";
      if (mediaType === "avatar" && durablePublicUrl) {
        // Avatar updates profile.avatar_url. Only seed card_image_url when cover is empty.
        if (!String(companion.card_image_url || "").trim()) {
          companionPatch.card_image_url = durablePublicUrl;
        }
        await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ avatar_url: durablePublicUrl }),
        });
      } else if (mediaType === "avatar" && !durablePublicUrl) {
        // Clear stale signed/broken avatar URLs; keep existing cover if present.
        await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ avatar_url: "" }),
        }).catch(() => {});
      }
      if (mediaType === "cover" && durablePublicUrl) {
        companionPatch.card_image_url = durablePublicUrl;
      } else if (mediaType === "cover" && !durablePublicUrl && durableStorageRef) {
        // Private bucket fallback: durable storage:// ref (admin/public resolve via companion_media + sign).
        companionPatch.card_image_url = durableStorageRef;
      }
      if (mediaType === "gallery" && durablePublicUrl && !companion.card_image_url && !auth.profile.avatar_url) {
        companionPatch.card_image_url = durablePublicUrl;
      }
      if (mediaType === "voice") {
        // Never persist short-lived signed URLs into voice_url; companion_media is source of truth.
        companionPatch.voice_url = durableStorageRef || `storage://${uploaded.bucket}/${uploaded.path}`;
      }

      let fallbackMediaId = mediaRow?.id || null;
      if (mediaTableMissing && mediaType === "gallery") {
        const nextItems = galleryFallback.items.concat([
          {
            id: `fb-${Date.now()}`,
            bucket: uploaded.bucket,
            path: uploaded.path,
            url: publicUrl,
            sortOrder,
            uploadedAt: nowIso(),
          },
        ]);
        companionPatch.tags = writeGalleryFallback(galleryFallback.baseTags, nextItems);
        fallbackMediaId = nextItems[nextItems.length - 1].id;
      }

      await patchCompanionProfile(`?id=eq.${encodeURIComponent(row.id)}`, companionPatch);
      return json(res, 200, {
        ok: true,
        message:
          mediaType === "avatar"
            ? "头像上传成功"
            : mediaType === "cover"
              ? "卡面上传成功"
            : mediaType === "gallery"
              ? "相册照片上传成功"
              : mediaType === "voice"
                ? "录音上传成功"
                : mediaType === "video"
                  ? "展示视频上传成功"
                : "媒体上传成功",
        url: publicUrl,
        path: uploaded.path,
        bucket: uploaded.bucket,
        media: {
          id: fallbackMediaId || `legacy-${mediaType}`,
          mediaType: persistedMediaType || mediaType,
          url: publicUrl,
          path: uploaded.path,
          bucket: uploaded.bucket,
          sortOrder,
        },
      });
    }

    if (action === "delete_media") {
      const row = await ensureCompanionRow(auth.profile, companion);
      const mediaId = String(body.media_id || body.id || "").trim();
      const mediaType = String(body.media_type || body.mediaType || "").trim();

      async function clearGalleryTagItem(predicate) {
        const galleryFallback = readGalleryFallback(row.tags || companion.tags || "");
        const nextItems = galleryFallback.items.filter((g) => !predicate(g));
        if (nextItems.length !== galleryFallback.items.length) {
          await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ tags: writeGalleryFallback(galleryFallback.baseTags, nextItems), updated_at: nowIso() }),
          });
        }
        return nextItems;
      }

      async function deleteStorageByBucketPath(bucket, objectPath) {
        if (!bucket || !objectPath) return;
        try {
          await deleteStorageObject(bucket, objectPath);
        } catch {
          /* ignore missing object */
        }
      }

      // Legacy / soft-fallback ids when companion_media table is missing OR synthetic client ids.
      if (mediaId === "legacy-avatar" || (mediaType === "avatar" && mediaId.startsWith("legacy-"))) {
        await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ avatar_url: "" }),
        });
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ card_image_url: "", updated_at: nowIso() }),
        });
        return json(res, 200, { ok: true, message: "已删除" });
      }

      if (mediaId.startsWith("fb-") || mediaId.startsWith("legacy-gallery-")) {
        const restPath = mediaId.startsWith("legacy-gallery-") ? mediaId.slice("legacy-gallery-".length) : "";
        await clearGalleryTagItem((g) => {
          if (String(g.id) === mediaId) return true;
          if (restPath && (String(g.path || "") === restPath || String(g.url || "") === restPath)) return true;
          return false;
        });
        // Best-effort: also remove matching companion_media / storage when path is known.
        if (restPath && !/^https?:\/\//i.test(restPath)) {
          for (const bucket of [PUBLIC_BUCKETS.profile, PRIVATE_BUCKETS.gallery]) {
            await deleteStorageByBucketPath(bucket, restPath);
            try {
              await companionDb(
                "companion_media",
                `?user_id=eq.${encodeURIComponent(auth.profile.id)}&storage_path=eq.${encodeURIComponent(restPath)}`,
                { method: "DELETE" }
              );
            } catch {
              /* ignore */
            }
          }
        }
        return json(res, 200, { ok: true, message: "已删除" });
      }

      // Fake storage-listing ids must NEVER hit companion_media.id (uuid column).
      // Format: storage-gallery-{bucket}-{filename}
      const storageSyn = mediaId.match(/^storage-gallery-(companion-public|companion-gallery)-(.+)$/i);
      if (storageSyn) {
        const bucket = storageSyn[1];
        const fileName = storageSyn[2];
        const objectPath = `${auth.profile.id}/gallery/${fileName}`;
        await deleteStorageByBucketPath(bucket, objectPath);
        try {
          await companionDb(
            "companion_media",
            `?user_id=eq.${encodeURIComponent(auth.profile.id)}&storage_bucket=eq.${encodeURIComponent(bucket)}&storage_path=eq.${encodeURIComponent(objectPath)}`,
            { method: "DELETE" }
          );
        } catch (error) {
          if (!isMissingRelation(error)) {
            /* path delete is enough for SoT when table missing */
          }
        }
        await clearGalleryTagItem(
          (g) =>
            String(g.path || "") === objectPath ||
            (String(g.bucket || "") === bucket && String(g.path || "").endsWith(`/${fileName}`))
        );
        return json(res, 200, { ok: true, message: "已删除" });
      }

      if (mediaId && !isUuid(mediaId)) {
        // Any other non-UUID id: refuse uuid eq filter; try tag cleanup only.
        await clearGalleryTagItem((g) => String(g.id) === mediaId);
        return json(res, 200, { ok: true, message: "已删除" });
      }

      let items = [];
      try {
        if (mediaId) {
          items = await companionDb(
            "companion_media",
            `?id=eq.${encodeURIComponent(mediaId)}&user_id=eq.${encodeURIComponent(auth.profile.id)}`
          );
        } else if (mediaType === "avatar" || mediaType === "voice" || mediaType === "video") {
          items = await companionDb(
            "companion_media",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.${encodeURIComponent(mediaType)}`
          );
          if (mediaType === "video" && !(items || []).length) {
            const galleryRows = await companionDb(
              "companion_media",
              `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.gallery`
            ).catch(() => []);
            items = (galleryRows || []).filter(
              (g) =>
                /^video\//i.test(String(g.content_type || "")) ||
                /\/video\//i.test(String(g.storage_path || "")) ||
                String(g.storage_bucket || "") === PRIVATE_BUCKETS.video
            );
          }
        } else {
          return json(res, 400, { ok: false, message: "缺少要删除的媒体" });
        }
      } catch (error) {
        if (isMissingRelation(error) && mediaType === "avatar") {
          await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ avatar_url: "" }),
          });
          await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ card_image_url: "", updated_at: nowIso() }),
          });
          return json(res, 200, { ok: true, message: "已删除" });
        }
        throw error;
      }
      if (!items?.length) return json(res, 404, { ok: false, message: "媒体不存在" });
      const deletedTypes = new Set((items || []).map((i) => String(i.media_type || "")));
      const deletedVideoLike = (items || []).some(
        (i) =>
          i.media_type === "video" ||
          /^video\//i.test(String(i.content_type || "")) ||
          String(i.storage_bucket || "") === PRIVATE_BUCKETS.video
      );
      for (const item of items) {
        await deleteStorageByBucketPath(item.storage_bucket, item.storage_path);
        try {
          await companionDb("companion_media", `?id=eq.${encodeURIComponent(item.id)}`, { method: "DELETE" });
        } catch (error) {
          if (!isMissingRelation(error)) throw error;
        }
        if (item.media_type === "gallery") {
          await clearGalleryTagItem(
            (g) =>
              String(g.path || "") === String(item.storage_path || "") ||
              String(g.id || "") === String(item.id || "")
          );
        }
      }
      const deletedAvatar = deletedTypes.has("avatar");
      if (deletedAvatar) {
        await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ avatar_url: "" }),
        });
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ card_image_url: "", updated_at: nowIso() }),
        });
      }
      // Voice/video must unbind profile fields so public + self views cannot resurrect old files.
      if (deletedTypes.has("voice")) {
        await patchCompanionProfile(`?id=eq.${encodeURIComponent(row.id)}`, {
          voice_url: "",
          media_status: "pending",
          updated_at: nowIso(),
        }).catch(() => null);
      }
      if (deletedTypes.has("video") || deletedVideoLike) {
        await patchCompanionProfile(`?id=eq.${encodeURIComponent(row.id)}`, {
          media_status: "pending",
          updated_at: nowIso(),
        }).catch(() => null);
      }
      return json(res, 200, { ok: true, message: "已删除" });
    }

    if (action === "reorder_media") {
      const row = await ensureCompanionRow(auth.profile, companion);
      const ids = Array.isArray(body.ordered_ids || body.ids) ? body.ordered_ids || body.ids : [];
      if (!ids.length) return json(res, 400, { ok: false, message: "缺少排序列表" });
      let order = 10;
      for (const id of ids) {
        if (!isUuid(id)) continue;
        await companionDb(
          "companion_media",
          `?id=eq.${encodeURIComponent(id)}&companion_profile_id=eq.${encodeURIComponent(row.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ sort_order: order, updated_at: nowIso() }),
          }
        );
        order += 10;
      }
      return json(res, 200, { ok: true, message: "相册顺序已更新" });
    }

    if (action === "submit_application") {
      const row = await ensureCompanionRow(auth.profile, companion);
      const applyGameNames = splitGames(body.main_game || body.game || body.mainGame || "");
      const servicesBundle = await loadPublicServices().catch(() => ({ services: [] }));
      const catalog = Array.isArray(servicesBundle?.services) ? servicesBundle.services : [];
      const byId = new Map(catalog.map((s) => [String(s.id), s]));
      const byName = new Map(catalog.map((s) => [String(s.name || s.title || "").trim(), s]));
      let applyServiceIds = parseServiceIds(body.service_ids || body.serviceIds);
      if (!applyServiceIds.length && applyGameNames.length) {
        applyServiceIds = applyGameNames.map((n) => byName.get(n)?.id).filter(Boolean).map(String);
      }
      applyServiceIds = [...new Set(applyServiceIds.filter((id) => byId.has(String(id))))];
      const applyGame = applyServiceIds.length
        ? applyServiceIds.map((id) => byId.get(String(id))?.name || byId.get(String(id))?.title).filter(Boolean).join("、")
        : applyGameNames.join("、");
      const applyServiceTypes = parseServiceTypes(body.service_type || body.serviceType || body.modes, {
        fallbackPlayWhenGame: true,
        hasGame: !!applyGame,
      });
      const authModeRaw = String(body.auth_mode || body.credential_mode || body.authMode || body.credentialMode || "")
        .trim()
        .toLowerCase();
      const authMode = authModeRaw === "id_card" || authModeRaw === "deposit" ? authModeRaw : "";
      const rawNote = String(body.note || body.application_note || "").replace(/\[AUTH_MODE:(?:id_card|deposit)\]\s*/gi, "").trim();
      const applicationNote = authMode ? `[AUTH_MODE:${authMode}]${rawNote ? ` ${rawNote}` : ""}` : rawNote;
      let applyVoiceType = "";
      try {
        applyVoiceType = await normalizeSelectedVoiceTypes(body.voice_type || body.voiceType || "", {
          required: false,
        });
      } catch {
        applyVoiceType = String(body.voice_type || body.voiceType || "").trim();
      }
      const patch = {
        main_service: String(body.main_service || body.mainService || applyGameNames[0] || ""),
        game: applyGame,
        service_type: (applyServiceTypes.length ? applyServiceTypes : ["陪玩服务"]).join(","),
        service_ids: applyServiceIds,
        game_rank: String(body.rank || body.game_rank || ""),
        position: String(body.position || ""),
        voice_type: applyVoiceType,
        schedule: String(body.schedule || ""),
        application_note: applicationNote,
        tags: String(body.tags || ""),
        application_status: "pending",
        application_reject_reason: "",
        application_submitted_at: nowIso(),
        verification_status: companion.verification_status || "pending",
        updated_at: nowIso(),
      };
      if (authMode) patch.credential_mode = authMode;
      if (body.nickname) patch.nickname = String(body.nickname).trim();
      if (body.phone || body.contact_phone) patch.contact_phone = String(body.phone || body.contact_phone || "").trim();
      if (body.price != null && body.price !== "") patch.price = money(body.price);
      if (body.age != null && body.age !== "") patch.age = Number(body.age) || null;
      if (body.gender) patch.gender = String(body.gender).trim();
      if (body.region) patch.region = String(body.region).trim();
      if (body.contact_public != null) patch.contact_public = String(body.contact_public).trim();
      if (body.game_prices && typeof body.game_prices === "object") {
        try { patch.game_prices = body.game_prices; } catch { /* optional column */ }
      }
      try {
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(patch),
        });
      } catch (firstErr) {
        // Optional credential_mode column may be absent — strip and retry like other optional cols.
        let patched = false;
        if (patch.credential_mode && /column|schema cache|PGRST|credential_mode/i.test(String(firstErr?.message || firstErr || ""))) {
          delete patch.credential_mode;
          try {
            await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify(patch),
            });
            patched = true;
          } catch {
            /* fall through to core strip */
          }
        }
        if (!patched) {
          const core = {
            main_service: patch.main_service,
            game: patch.game,
            service_type: patch.service_type,
            game_rank: patch.game_rank,
            position: patch.position,
            voice_type: patch.voice_type,
            schedule: patch.schedule,
            application_note: patch.application_note,
            tags: patch.tags,
            application_status: "pending",
            application_reject_reason: "",
            application_submitted_at: nowIso(),
            updated_at: nowIso(),
          };
          if (patch.nickname) core.nickname = patch.nickname;
          if (patch.contact_phone) core.contact_phone = patch.contact_phone;
          if (patch.price != null) core.price = patch.price;
          try {
            await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify(core),
            });
          } catch {
            await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
              method: "PATCH",
              headers: serviceHeaders(),
              body: JSON.stringify({
                game: patch.game,
                application_note: patch.application_note,
                application_status: "pending",
                updated_at: nowIso(),
              }),
            });
          }
        }
      }
      // Formal submit: promote draft identity / deposit rows so admin review sees materials immediately.
      try {
        const identityRow = (
          await companionDb(
            "companion_identity_verifications",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&limit=1`
          ).catch(() => [])
        )?.[0];
        if (
          identityRow &&
          String(identityRow.status || "").toLowerCase() === "draft" &&
          (identityRow.id_front_path || identityRow.id_back_path)
        ) {
          await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
            real_name: identityRow.real_name || "",
            identity_no: identityRow.identity_no || "",
            id_front_path: identityRow.id_front_path || "",
            id_back_path: identityRow.id_back_path || "",
            id_handheld_path: identityRow.id_handheld_path || "",
            status: "pending",
            reject_reason: "",
            submitted_at: nowIso(),
          });
        }
      } catch {
        /* optional */
      }
      try {
        const depositRow = (
          await companionDb(
            "companion_deposits",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`
          ).catch(() => [])
        )?.[0];
        if (depositRow && String(depositRow.status || "").toLowerCase() === "draft" && depositRow.proof_path) {
          await upsertByCompanion("companion_deposits", row.id, auth.profile.id, {
            required_amount: money(depositRow.required_amount || 100) || 100,
            paid_amount: money(depositRow.paid_amount),
            payment_method: String(depositRow.payment_method || ""),
            proof_path: depositRow.proof_path || "",
            proof_bucket: depositRow.proof_bucket || PRIVATE_BUCKETS.payment,
            status: "pending",
            reject_reason: "",
            remark: String(depositRow.remark || ""),
            paid_at: depositRow.paid_at || nowIso(),
          });
        }
      } catch {
        /* optional */
      }
      return json(res, 200, { ok: true, message: "申请已提交，等待后台审核。" });
    }

    if (action === "start_cs_consult" || action === "open_cs_conversation") {
      const orderId = String(body.order_id || body.orderId || "").trim();
      const consultType = String(body.consult_type || body.consultType || "").trim();
      const forceNew =
        action === "start_cs_consult"
          ? body.forceNew !== false && String(body.forceNew || body.force_new || "").trim() !== "0"
          : body.forceNew === true || String(body.forceNew || body.force_new || "").trim() === "1";
      const conversation = await ensureCompanionSupportConversation(auth.profile.id, {
        orderId,
        consultType,
        forceNew,
      });
      const activeConversationId = String(conversation?.id || "").trim();
      const inbox = await buildCompanionInbox(auth.profile, companion, {
        light: true,
        includeActiveMessages: true,
        skipDerivedNotices: true,
        activeConversationId,
      });
      return json(res, 200, {
        ok: true,
        message: "咨询会话已创建",
        conversationId: activeConversationId,
        consultType: conversation?.consult_type || consultType || "",
        orderId: conversation?.order_id || orderId || "",
        data: inbox,
        inbox,
      });
    }
    if (action === "end_cs_conversation" || action === "end_conversation") {
      const conversationId = String(body.conversation_id || body.conversationId || body.id || "").trim();
      await endCompanionSupportConversation(auth.profile.id, conversationId);
      const inbox = await buildCompanionInbox(auth.profile, companion, {
        light: true,
        includeActiveMessages: false,
        skipDerivedNotices: true,
        activeConversationId: conversationId,
      });
      return json(res, 200, {
        ok: true,
        message: "会话已结束",
        conversationId,
        data: inbox,
        inbox,
      });
    }

    if (action === "send_cs_message" || action === "send_message") {
      const orderId = String(body.order_id || body.orderId || "").trim();
      const consultType = String(body.consult_type || body.consultType || "").trim();
      const conversationId = String(body.conversation_id || body.conversationId || "").trim();
      const forceNew =
        body.forceNew === true ||
        String(body.forceNew || body.force_new || "").trim() === "1";
      let conversation = null;
      if (conversationId && !forceNew) {
        const rows = await supabaseJson(
          restUrl(
            "conversations",
            `?id=eq.${encodeURIComponent(conversationId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`
          ),
          { headers: serviceHeaders() }
        ).catch(() => []);
        conversation = rows?.[0] || null;
        if (!conversation) {
          return json(res, 404, { ok: false, message: "会话不存在或无权访问" });
        }
        try {
          const { assertCompanionCanAccessConversation } = await import("./_conversation-privacy.js");
          assertCompanionCanAccessConversation(conversation, auth.profile.id);
        } catch (err) {
          return json(res, err.status || 403, { ok: false, message: err.message || "无权访问该会话" });
        }
        if (isClosedConversationStatus(conversation.status)) {
          return json(res, 403, { ok: false, message: "会话已结束，无法继续发送" });
        }
      } else {
        conversation = await ensureCompanionSupportConversation(auth.profile.id, {
          orderId,
          consultType,
          forceNew,
        });
      }
      const messageType = String(body.messageType || body.message_type || "text").trim() || "text";
      const msg = await sendCompanionChatMessage(
        conversation,
        auth.profile.id,
        body.content || body.message || "",
        messageType
      );
      const messageRow = msg ? await viewMessageSigned(msg) : null;
      return json(res, 200, {
        ok: true,
        message: "消息已发送",
        conversationId: conversation?.id || conversationId || "",
        consultType: conversation?.consult_type || consultType || "",
        orderId: conversation?.order_id || orderId || "",
        messageRow: messageRow || (msg ? viewMessage(msg) : null),
      });
    }
    if (action === "mark_notices_read") {
      const keys = Array.isArray(body.keys) ? body.keys : body.key ? [body.key] : [];
      const result = await markNoticesRead(auth.profile.id, keys);
      return json(res, 200, { ok: true, message: "已标记已读", ...result });
    }
    if (action === "mark_all_read") {
      const data = await bootstrapData(auth.profile, companion);
      const derived = buildSystemNotices({
        companionUserId: auth.profile.id,
        player: data.player,
        verification: data.verification,
        deposit: data.deposit,
        orders: data.myOrders,
        withdrawals: data.withdrawals,
        popularity: data.popularity,
        auditLocked: !data.permissions?.canWork,
        auditHint: data.permissions?.lockReason || "",
      });
      const dbNotices = await loadCompanionNotifications(auth.profile.id).catch(() => []);
      const notices = [...(dbNotices || []), ...(derived || [])];
      const keys = Array.isArray(body.keys) && body.keys.length
        ? body.keys
        : notices.map((n) => n.key);
      await markNoticesRead(auth.profile.id, keys);
      // Mark most recent open CS thread only — do not create a new consult lock.
      const openRows = await supabaseJson(
        restUrl(
          "conversations",
          `?companion_id=eq.${encodeURIComponent(auth.profile.id)}&conversation_type=eq.companion_support&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
        ),
        { headers: serviceHeaders() }
      ).catch(() => []);
      const conversation = openRows?.[0] || null;
      if (conversation?.id) await markConversationMessagesRead(conversation.id, { companionUserId: auth.profile.id });
      return json(res, 200, { ok: true, message: "已全部标记已读", marked: keys.length });
    }
    if (action === "mark_cs_read" || action === "read_cs_conversation") {
      const conversationId = String(body.conversation_id || body.conversationId || "").trim();
      let conversation = null;
      if (conversationId) {
        const rows = await supabaseJson(
          restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        conversation = rows?.[0] || null;
      }
      if (!conversation) {
        const openRows = await supabaseJson(
          restUrl(
            "conversations",
            `?companion_id=eq.${encodeURIComponent(auth.profile.id)}&conversation_type=eq.companion_support&status=not.in.(closed,ended)&order=updated_at.desc&limit=1`
          ),
          { headers: serviceHeaders() }
        ).catch(() => []);
        conversation = openRows?.[0] || null;
      }
      if (conversation?.id) await markConversationMessagesRead(conversation.id, { companionUserId: auth.profile.id });
      return json(res, 200, { ok: true, message: "已标记已读" });
    }

    if (action === "request_withdrawal") {
      try {
        assertCompanionBusinessAccess(auth.profile, companion || {});
      } catch (err) {
        return isolationForbiddenResponse(res, err);
      }
      const amount = money(body.amount || body.cat_food_amount || body.catFoodAmount);
      const remark = String(body.remark || body.note || "").trim();
      const accountId = String(body.paymentAccountId || body.payment_account_id || "").trim();
      const data = await bootstrapData(auth.profile, companion);
      if (!data.permissions.canWithdraw) {
        return json(res, 400, { ok: false, message: data.permissions.withdrawLockReason || "暂不可提现" });
      }
      if (!(amount > 0)) return json(res, 400, { ok: false, message: "提现金额必须大于 0" });
      if (amount < money(data.withdrawalRules.minAmount)) {
        return json(res, 400, { ok: false, message: `最低提现 ${data.withdrawalRules.minAmount} 猫粮` });
      }
      if (amount > money(data.earnings.withdrawable)) {
        return json(res, 400, { ok: false, message: "可提现余额不足" });
      }
      if (Number(data.withdrawalRules.remainingThisWeek ?? data.withdrawalRules.remainingThisMonth ?? 0) <= 0) {
        return json(res, 400, { ok: false, message: "本周提现次数已用完" });
      }
      const accounts = data.withdrawalRules.approvedAccounts || [];
      const account = accounts.find((a) => a.id === accountId) || accounts[0];
      if (!account) return json(res, 400, { ok: false, message: "没有已审核通过的结款账户，请先提交并等待审核" });

      const fullAccounts = await companionDb(
        "companion_payment_accounts",
        `?id=eq.${encodeURIComponent(account.id)}&limit=1`
      ).catch(() => []);
      const full = fullAccounts?.[0];
      if (!full || !/approved|verified/.test(String(full.status || ""))) {
        return json(res, 400, { ok: false, message: "结款账户未审核通过" });
      }

      const pendingDup = (data.withdrawals || []).find((w) =>
        /^(submitted|pending_friday|reviewing|pending|pending_review|rolled_over)$/.test(String(w.status || ""))
      );
      if (pendingDup) {
        return json(res, 400, {
          ok: false,
          message: "已有待周五结算的提现申请，请等待后台处理后再提交",
        });
      }

      // Block withdraw while companion has orders in Friday refund queue / open refund
      {
        const openRefunds = await companionDb(
          "boss_refund_requests",
          `?status=in.(pending_review,approved_for_payout,included_in_batch,processing,carried_forward)&select=id,order_id,status&limit=200`
        ).catch(() => []);
        const refundOrderIds = new Set((openRefunds || []).map((r) => r.order_id).filter(Boolean));
        if (refundOrderIds.size) {
          const incomeOnRefund = await companionDb(
            "transactions",
            `?user_id=eq.${encodeURIComponent(auth.profile.id)}&transaction_type=eq.companion_income&status=neq.cancelled&select=order_id&limit=500`
          ).catch(() => []);
          const hit = (incomeOnRefund || []).some((t) => t.order_id && refundOrderIds.has(t.order_id));
          if (hit) {
            return json(res, 400, {
              ok: false,
              message: "存在待处理/待周五退款的订单，相关收入暂不可提现。请等待退款结算完成或冲减后再申请。",
            });
          }
        }
      }

      const weeklyCfg = await loadFinanceWeeklySettings(companionDb).catch(() => mergeWeeklySettings({}));
      const settlementDate = computeSettlementDate(new Date(), weeklyCfg);

      const rate = money(data.withdrawalRules.exchangeRate) || 1;
      const gross = Math.round(amount * rate * 100) / 100;
      const fee = Math.round((money(data.withdrawalRules.feeRm) + gross * (money(data.withdrawalRules.feePercent) / 100)) * 100) / 100;
      const net = Math.max(0, Math.round((gross - fee) * 100) / 100);
      const rawAccount = String(full.bank_account || full.tng_account || full.alipay_account || "").replace(/\s+/g, "");
      const last4 = full.account_last4 || (rawAccount ? rawAccount.slice(-4) : maskBankAccount(full.bank_account).slice(-4));
      const holder = String(full.account_name || full.account_holder || auth.profile.display_name || "").trim();
      const accountNumber = rawAccount
        ? rawAccount.length <= 4
          ? rawAccount
          : `${"*".repeat(Math.max(0, rawAccount.length - 4))}${last4}`
        : last4
          ? `****${last4}`
          : "";

      const withdrawalNo = await allocateWithdrawalNo(companionDb).catch(
        () => `WD${String(Date.now()).slice(-6)}`
      );
      const withdrawalPayload = {
        withdrawal_no: withdrawalNo,
        companion_id: auth.profile.id,
        payment_account_id: full.id,
        amount,
        cat_food_amount: amount,
        exchange_rate: rate,
        gross_amount_rm: gross,
        fee_rm: fee,
        net_amount_rm: net,
        bank_name: full.bank_name || "",
        account_name: holder,
        account_holder: holder,
        account_number: accountNumber,
        account_last4: last4,
        remark,
        status: "pending_friday",
        settlement_date: settlementDate,
        source_ledger_ids: [],
        source_order_ids: [],
        currency: "CAT_FOOD",
        payout_method: full.tng_account ? "tng" : "bank",
        tng_account: full.tng_account ? `****${String(full.tng_account).slice(-4)}` : "",
        submitted_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      let item = null;
      {
        let payload = { ...withdrawalPayload };
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            const rows = await companionDb("companion_withdrawals", "", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            item = rows?.[0] || null;
            break;
          } catch (error) {
            const msg = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
            if (/companion_withdrawals|schema cache|PGRST/i.test(msg) && /Could not find the table/i.test(msg)) {
              return json(res, 503, {
                ok: false,
                message: "提现表未就绪，请稍后重试或联系管理员执行数据库迁移",
              });
            }
            const m = msg.match(/Could not find the '([^']+)' column/i);
            if (!m || !(m[1] in payload)) throw error;
            delete payload[m[1]];
          }
        }
      }
      if (!item) return json(res, 500, { ok: false, message: "提现申请写入失败，请稍后重试" });

      let freezeTxId = null;
      try {
        const txRows = await supabaseJson(restUrl("transactions"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            user_id: auth.profile.id,
            order_id: null,
            transaction_type: "withdrawal",
            amount,
            status: "pending",
            note: `提现申请冻结 ${item?.withdrawal_no || ""} 预计发放 ${settlementDate}`.trim(),
            created_at: nowIso(),
          }),
        });
        freezeTxId = txRows?.[0]?.id || null;
        if (freezeTxId && item?.id) {
          await companionDb("companion_withdrawals", `?id=eq.${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ freeze_tx_id: freezeTxId, updated_at: nowIso() }),
          }).catch(() => null);
          item = { ...item, freeze_tx_id: freezeTxId };
        }
      } catch {
        /* ledger marker optional */
      }

      // Anti-duplicate: period-level lock for this withdrawal row (amount freeze via freeze_tx).
      const sourceLedgerIds = freezeTxId ? [String(freezeTxId)] : [];
      const sourceOrderIds = [];

      const payoutRow = await upsertPayoutRequest(companionDb, {
        payoutNo: item.withdrawal_no,
        applicantType: "companion",
        applicantId: auth.profile.id,
        applicantName: auth.profile.display_name || "",
        applicantUid: auth.profile.boss_uid || auth.profile.id || "",
        amount: net,
        currency: "MYR",
        payoutMethod: withdrawalPayload.payout_method,
        bankName: full.bank_name || "",
        accountName: holder,
        accountNumberMasked: accountNumber,
        tngAccount: withdrawalPayload.tng_account,
        sourceOrderIds,
        sourceLedgerIds,
        settlementDate,
        status: "pending_friday",
        payoutType: "companion_wage",
        relatedTable: "companion_withdrawals",
        relatedRecordId: item.id,
        meta: { payout_type: "companion_wage", catFoodAmount: amount, grossRm: gross, feeRm: fee },
      });

      try {
        await lockPayoutSources(companionDb, {
          applicantId: auth.profile.id,
          sources: [{ kind: "period", id: `companion-wd:${item.id}` }],
          payoutRequestId: payoutRow?.id,
          relatedTable: "companion_withdrawals",
          relatedRecordId: item.id,
        });
      } catch (lockErr) {
        if (lockErr?.code === "SOURCE_LOCKED") {
          return json(res, 409, { ok: false, message: lockErr.message });
        }
      }

      try {
        await insertCompanionNotification({
          companionUserId: auth.profile.id,
          category: "withdraw",
          title: "提现申请已提交",
          body: `提现单 ${item.withdrawal_no} 已进入待周五结算，预计发放 ${settlementDate}。`,
          href: "/companion/withdraw/",
          noticeKey: `withdraw-submitted-${item.id}`,
        });
      } catch {
        /* optional */
      }

      return json(res, 200, {
        ok: true,
        message: "提现申请已提交，进入待周五结算",
        preview: {
          catFoodAmount: amount,
          amount,
          grossAmountRm: gross,
          feeRm: fee,
          netAmountRm: net,
          bankName: full.bank_name,
          accountHolder: holder,
          accountLast4: last4,
          withdrawalNo: item.withdrawal_no,
          settlementDate,
          status: item.status || "pending_friday",
          statusText: WITHDRAW_STATUS_TEXT[item.status || "pending_friday"] || "待周五结算",
        },
        item,
        data: {
          withdrawalId: item.id,
          withdrawalNo: item.withdrawal_no,
          status: item.status || "pending_friday",
          settlementDate,
        },
      });
    }

    return json(res, 400, { ok: false, message: "未知陪玩端操作" });
  } catch (error) {
    const friendly = humanizeCompanionApiError(error);
    return json(res, friendly.status || 500, {
      ok: false,
      message: friendly.message || "陪玩端接口异常",
      status: friendly.status || 500,
    });
  }
}
