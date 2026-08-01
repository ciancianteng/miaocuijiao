import {
  PRIVATE_BUCKETS,
  PUBLIC_BUCKETS,
  assertImageUpload,
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
  readGamePrices,
  writeGamePricesMarker,
  stripGamePricesMarker,
  splitGames,
  parseServiceIds,
  parseServiceTypes,
} from "./_game-prices.js";
import { loadPublicServices } from "./platform/services.js";
import {
  buildCompanionInbox,
  ensureCompanionSupportConversation,
  sendCompanionChatMessage,
  markConversationMessagesRead,
  markNoticesRead,
  loadConversationMessages,
  viewMessage,
  buildSystemNotices,
  loadReadKeys,
} from "./_companion-inbox.js";
import "./_load-env.js";

const ORDER_STATUS_TEXT = COMPANION_STATUS_LABELS;
const WITHDRAW_STATUS_TEXT = {
  pending: "待审核",
  pending_review: "待审核",
  approved: "已通过",
  approved_pending_pay: "已通过",
  rejected: "已拒绝",
  paying: "审核中",
  paid_pending_receipt: "已通过",
  completed: "已打款",
  pay_failed: "付款失败",
  cancelled: "已取消",
};
const WITHDRAW_FROZEN = new Set([
  "pending",
  "pending_review",
  "approved",
  "approved_pending_pay",
  "paying",
  "paid_pending_receipt",
]);
const WITHDRAW_ACTIVE = new Set([...WITHDRAW_FROZEN, "completed"]);
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
    bossName: boss.display_name || boss.email || "老板",
    bossUid: boss.boss_uid || "",
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
async function requireCompanion(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录陪玩端。"), { status: 401 });
  let authUser;
  try {
    authUser = await authUserFromToken(token);
  } catch (error) {
    throw Object.assign(new Error(`陪玩登录态无效：${error.message || "无法校验 token"}`), { status: 401 });
  }
  if (!authUser?.id) throw Object.assign(new Error("陪玩登录态无效：auth user 为空"), { status: 401 });
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

async function synthesizeMediaFallback(profile, companion) {
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

  // Storage listing fallback when companion_media / tags gallery encoding unavailable.
  if (!gallerySeen.size && profile?.id) {
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
        });
        sort += 10;
      }
    }
  }

  if (companion?.voice_url) {
    signedMedia.push({
      id: "legacy-voice",
      mediaType: "voice",
      status: "approved",
      rejectReason: "",
      durationSeconds: null,
      uploadedAt: companion?.updated_at || "",
      sortOrder: 999,
      url: companion.voice_url,
    });
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
    bio: companion.description || "",
    voiceUrl: companion.voice_url || "",
    onlineStatus,
    onlineStatusLabel: statusLabel(onlineStatus),
    workStatus: statusLabel(onlineStatus),
    accountStatus: profile.status || "pending",
    auditStatus: companion.application_status || companion.verification_status || "pending",
    depositStatus: companion.deposit_status || "pending",
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
function canWork(profile = {}, companion = {}) {
  const profileOk = profile.status === "active";
  const verified = /approved|verified|passed/.test(String(companion.verification_status || ""));
  return profileOk && verified;
}
function canAccept(profile = {}, companion = {}) {
  return canWork(profile, companion) && normalizeOnlineStatus(companion.availability_status || companion.online_status) === "online";
}
function auditLockMessage(profile = {}, companion = {}) {
  if (canWork(profile, companion)) return "";
  if (profile.status && profile.status !== "active" && profile.status !== "pending") {
    return "账号已停用，无法接单。";
  }
  return "账号审核通过后即可开始接单。";
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
  const confirmDeadline = confirmAnchor
    ? new Date(Date.parse(confirmAnchor) + COMPANION_CONFIRM_TIMEOUT_MS).toISOString()
    : "";
  const orderTypeKey = row.order_type || "custom";
  const completionPending =
    String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
    String(row.description || "").includes("[[COMPLETION_PENDING]]");
  let statusText = ORDER_STATUS_TEXT[row.status] || row.status || "待付款确认";
  if (row.status === "in_progress" && completionPending) statusText = "待老板确认完成";
  if (row._grabStatus === "pending_customer_selection") statusText = "等待老板选择";
  if (row._grabStatus === "not_selected") statusText = "未被选中";
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
    bossName: boss.display_name || boss.email || "老板",
    bossUid: boss.boss_uid || "",
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
    appointmentAt: row.created_at || "",
    createdAt: row.created_at || "",
    completedAt: row.completed_at || parsed?.completedAt || "",
    settlement,
    hasSettlement: !!parsed || row.status === "completed",
    isDesignatedConfirm: row.status === "claimed",
    raw: row
  };
}
async function bossesForOrders(orders) { const ids=[...new Set((orders||[]).map((row)=>row.boss_id).filter(Boolean))]; if(!ids.length) return {}; const rows=await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() }); return Object.fromEntries((rows||[]).map((row)=>[row.id,row])); }
async function loadOrdersFor(profile, companion, transactions = []) {
  try {
    const { expireCompanionConfirmTimeouts } = await import("./_order-confirm-timeout.js");
    await expireCompanionConfirmTimeouts({ companionId: profile.id, limit: 40 });
  } catch {
    /* best-effort */
  }
  const myRows = await supabaseJson(restUrl("orders", `?companion_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=200`), { headers: serviceHeaders() });
  // Never surface unpaid designated orders (awaiting_payment) as actionable confirm tasks.
  const visibleMine = (myRows || []).filter((row) => row.status !== "awaiting_payment");
  const openQuery =
    "?and=(companion_id.is.null,or(status.eq.pending,status.eq.waiting_boss_confirm))&order=created_at.desc&limit=100";
  // Always list open hall orders so non-online statuses can show disabled grab buttons with reasons.
  const openRows = await supabaseJson(restUrl("orders", openQuery), { headers: serviceHeaders() }).catch(() => []);
  const { createOrderGrabHelpers } = await import("./_order-grabs.js");
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
  const myGrabRows = await grabsApi.listMyPendingGrabs(profile.id);
  const grabOrderIds = myGrabRows.map((g) => g.order_id).filter(Boolean);
  let grabOrders = [];
  if (grabOrderIds.length) {
    grabOrders = await supabaseJson(
      restUrl("orders", `?id=in.(${grabOrderIds.map(encodeURIComponent).join(",")})&order=created_at.desc`),
      { headers: serviceHeaders() }
    ).catch(() => []);
  }
  const openWithMine = await Promise.all(
    (openRows || []).slice(0, 40).map(async (row) => {
      try {
        const grabs = await grabsApi.listGrabs(row.id, row.note || row.description || "");
        const mine = grabs.find((g) => g.companionId === profile.id);
        return { ...row, _myGrab: mine || null, _grabs: grabs };
      } catch {
        return { ...row, _myGrab: null, _grabs: [] };
      }
    })
  );
  const mineIds = new Set(visibleMine.map((r) => r.id));
  const pendingSelection = [];
  for (const row of grabOrders || []) {
    if (mineIds.has(row.id)) continue;
    const g = myGrabRows.find((x) => x.order_id === row.id);
    pendingSelection.push({ ...row, _grabStatus: g?.status || "pending_customer_selection" });
  }
  for (const row of openWithMine) {
    if (row._myGrab && !mineIds.has(row.id) && !pendingSelection.some((p) => p.id === row.id)) {
      pendingSelection.push({ ...row, _grabStatus: row._myGrab.status });
    }
  }
  const bossMap = await bossesForOrders([...visibleMine, ...pendingSelection, ...openWithMine]);
  const settlementByOrder = {};
  (transactions || []).forEach((tx) => {
    if (tx.transaction_type !== "companion_income" || !tx.order_id) return;
    const parsed = parseSettlementNote(tx.note);
    if (parsed) settlementByOrder[tx.order_id] = { ...parsed, transactionId: tx.id, settledAmount: money(tx.amount) };
  });
  return {
    myOrders: [
      ...visibleMine.map((row) => viewOrder(row, bossMap[row.boss_id] || {}, settlementByOrder[row.id] || null)),
      ...pendingSelection.map((row) =>
        viewOrder(row, bossMap[row.boss_id] || {}, settlementByOrder[row.id] || null)
      ),
    ],
    openOrders: openWithMine.map((row) => {
      const viewed = viewOrder(row, bossMap[row.boss_id] || {});
      return {
        ...viewed,
        myGrab: row._myGrab || null,
        grabCount: (row._grabs || []).length,
        alreadyGrabbed: !!row._myGrab,
      };
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
    waitingStart: myOrders.filter((o) => o.status === "confirmed").length,
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
  if (!canWork(profile, companionRow)) {
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
    messagesMode: "system_only",
    lockReason: auditLockMessage(profile, companionRow),
  };
  const [cfg, levelBundle] = await Promise.all([
    financeSettings().catch((error) => {
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
  const { summary, walletLedger, earningDetails, earnings, withdrawalRows } = wallet;

  player.priceNeedsReset = levelBundle.priceNeedsReset;
  player.priceInRange = levelBundle.priceInRange;
  player.rawPrice = levelBundle.price;
  player.price = levelBundle.price;
  player.level = levelBundle.level
    ? `${levelBundle.level.code || ""} ${levelBundle.level.name || ""}`.trim()
    : player.level;
  player.orderCommissionRate = levelBundle.platformCommissionRate;

  let identity = null;
  let payment = null;
  let deposit = null;
  let media = [];
  let paymentAccounts = [];
  try {
    const [identityRows, paymentRows, depositRows, mediaRows] = await Promise.all([
      companionDb("companion_identity_verifications", `?user_id=eq.${encodeURIComponent(profile.id)}&limit=1`).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
      companionDb("companion_payment_accounts", `?user_id=eq.${encodeURIComponent(profile.id)}&order=submitted_at.desc&limit=20`).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
      companionDb("companion_deposits", `?user_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=1`).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
      companionDb("companion_media", `?user_id=eq.${encodeURIComponent(profile.id)}&order=sort_order.asc`).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e))),
    ]);
    identity = identityRows?.[0] || null;
    paymentAccounts = Array.isArray(paymentRows) ? paymentRows : [];
    payment = paymentAccounts.find((a) => a.status === "approved" || a.status === "verified") || paymentAccounts[0] || null;
    deposit = depositRows?.[0] || null;
    media = Array.isArray(mediaRows) ? mediaRows : [];
  } catch (error) {
    warnings.push(`profile-assets: ${error.message || error}`);
  }

  const month = monthKey();
  const usedThisMonth = withdrawalRows.filter(
    (w) => String(w.submitted_at || "").slice(0, 7) === month && !/rejected|cancelled/.test(w.status)
  ).length;
  const monthlyLimit = Number(cfg.max_withdrawals_per_month || 3);
  const minAmount = money(cfg.min_withdraw_cat_food);
  const rate = money(cfg.cat_food_to_rm_rate) || 1;
  const identityOk = /approved|verified|passed/.test(String(identity?.status || companionRow?.verification_status || ""));
  const bankOk = /approved|verified/.test(String(payment?.status || ""));
  const accountOk = profile.status === "active" && !companionRow?.withdraw_frozen;
  const canWithdrawNow =
    canWork(profile, companionRow) &&
    identityOk &&
    bankOk &&
    accountOk &&
    summary.withdrawable >= minAmount &&
    usedThisMonth < monthlyLimit;
  permissions.canWithdraw = canWithdrawNow;
  if (!canWithdrawNow) {
    if (!canWork(profile, companionRow)) {
      permissions.withdrawLockReason = permissions.lockReason || "账号审核通过后即可开始接单。";
    } else if (!identityOk) permissions.withdrawLockReason = "请先完成实名认证";
    else if (!bankOk) permissions.withdrawLockReason = "请先提交并等待结款账户审核通过";
    else if (companionRow?.withdraw_frozen) permissions.withdrawLockReason = "提现已被冻结";
    else if (summary.withdrawable < minAmount) permissions.withdrawLockReason = `可提现余额不足（最低 ${minAmount}）`;
    else if (usedThisMonth >= monthlyLimit) permissions.withdrawLockReason = "已达本月提现次数上限";
    else if (profile.status !== "active") permissions.withdrawLockReason = "账号状态异常";
    else permissions.withdrawLockReason = permissions.lockReason || "暂不可提现";
  }

  const feePercent = money(cfg.withdraw_fee_percent);
  const feeFixed = money(cfg.withdraw_fee_rm);
  const approvedAccounts = paymentAccounts
    .filter((a) => /approved|verified/.test(String(a.status || "")))
    .map((a) => ({
      id: a.id,
      bankName: a.bank_name || "",
      accountHolder: a.account_name || "",
      accountLast4: a.account_last4 || maskBankAccount(a.bank_account).slice(-4),
      status: a.status,
    }));

  const signedMedia = [];
  for (const item of media) {
    let url = "";
    try {
      if (item.storage_bucket === PUBLIC_BUCKETS.profile) {
        url = publicObjectUrl(item.storage_bucket, item.storage_path);
      } else {
        url = await createSignedUrl(item.storage_bucket, item.storage_path, 60 * 60 * 24 * 7);
      }
    } catch {
      url = "";
    }
    signedMedia.push({
      id: item.id,
      mediaType: item.media_type,
      status: item.status,
      rejectReason: item.reject_reason || "",
      durationSeconds: item.duration_seconds,
      uploadedAt: item.uploaded_at,
      sortOrder: item.sort_order,
      url,
    });
  }
  // Soft-fallback when companion_media table is missing / empty.
  if (!signedMedia.length) {
    const synthesized = await synthesizeMediaFallback(profile, companionRow);
    signedMedia.push(...synthesized);
  }

  let popularity = null;
  try {
    popularity = await companionPopularityMe(profile.id);
  } catch {
    popularity = null;
  }

  return {
    serverTime: nowIso(),
    player,
    permissions,
    summary,
    popularity,
    openOrders,
    myOrders,
    conversations: [],
    messages: [],
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
    earningDetails,
    walletLedger,
    walletWarnings: warnings,
    warnings,
    withdrawalRules: {
      monthlyLimit,
      usedThisMonth,
      remainingThisMonth: Math.max(0, monthlyLimit - usedThisMonth),
      minAmount,
      exchangeRate: rate,
      feeRm: feeFixed,
      feePercent,
      currentAccount: payment
        ? `${payment.bank_name || ""} ${payment.account_name || ""} ****${payment.account_last4 || maskBankAccount(payment.bank_account).slice(-4)}`
        : "",
      approvedAccounts,
    },
    withdrawals: withdrawalRows.map((w) => ({
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
      statusText: WITHDRAW_STATUS_TEXT[w.status] || w.status,
      rejectReason: w.reject_reason || w.rejection_reason || "",
      submittedAt: w.submitted_at || w.created_at,
      reviewedAt: w.reviewed_at || w.approved_at || "",
      approvedAt: w.approved_at || w.reviewed_at || "",
      paidAt: w.paid_at || "",
      completedAt: w.completed_at || "",
      bankReferenceMasked: "",
      amount: money(w.cat_food_amount || w.amount),
      createdAt: w.submitted_at || w.created_at,
    })),
    verification: {
      identityStatus: identity?.status || companion?.verification_status || "pending",
      contactStatus: companion?.verification_status || "pending",
      bankStatus: payment?.status || "pending",
      depositStatus: deposit?.status || companion?.deposit_status || "pending",
      realName: identity?.real_name || "",
      bankName: payment?.bank_name || "",
      identityRejectReason: identity?.reject_reason || "",
      paymentRejectReason: payment?.reject_reason || "",
      applicationRejectReason: companion?.application_reject_reason || "",
      mediaRejectReason: companion?.media_reject_reason || "",
      depositRejectReason: deposit?.reject_reason || "",
    },
    deposit: {
      status: deposit?.status || companion?.deposit_status || "pending",
      requiredAmount: deposit?.required_amount || 100,
      paidAmount: deposit?.paid_amount || 0,
      rejectReason: deposit?.reject_reason || "",
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
        `?companion_id=eq.${encodeURIComponent(companionUserId)}&order=created_at.desc&limit=50&select=id,order_id,boss_id,rating,content,status,created_at`
      ),
      { headers: serviceHeaders() }
    );
    const list = Array.isArray(rows) ? rows : [];
    const bossIds = [...new Set(list.map((r) => r.boss_id).filter(Boolean))];
    let bosses = {};
    if (bossIds.length) {
      const profiles = await supabaseJson(
        restUrl("profiles", `?id=in.(${bossIds.map(encodeURIComponent).join(",")})&select=id,display_name,boss_uid`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      bosses = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    }
    return list.map((r) => {
      const boss = bosses[r.boss_id] || {};
      return {
        id: r.id,
        orderId: r.order_id || "",
        rating: Number(r.rating || 0),
        content: r.content || "",
        status: r.status || "published",
        createdAt: r.created_at || "",
        bossName: boss.display_name || boss.boss_uid || "老板",
      };
    });
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
      verification_status: "pending",
      deposit_status: "pending",
      application_status: "pending",
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
  if (!String(dataUrlOrPath).startsWith("data:")) {
    return { bucket, path: String(dataUrlOrPath) };
  }
  const decoded = decodeDataUrl(dataUrlOrPath);
  if (!decoded) throw Object.assign(new Error("文件格式无效"), { status: 400 });
  const objectPath = buildObjectPath(userId, folder, filename || "file");
  await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType);
  return { bucket, path: objectPath, contentType: decoded.contentType };
}
async function ensureConversation(order) { const existing=await supabaseJson(restUrl("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`), { headers: serviceHeaders() }); if(existing?.[0]) return existing[0]; const rows=await supabaseJson(restUrl("conversations"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ boss_id: order.boss_id, companion_id: order.companion_id || null, customer_service_id: order.customer_service_id || null, order_id: order.id, status: "open", created_at: nowIso(), updated_at: nowIso() }) }); return rows?.[0] || null; }
async function addSystemMessage(order, senderId, senderRole, content) { const conversation=await ensureConversation(order); if(!conversation) return; await supabaseJson(restUrl("messages"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ conversation_id: conversation.id, sender_id: senderId, sender_role: senderRole, message_type: "system", content, order_id: order.id, created_at: nowIso() }) }); }
async function claimOrder(profile, companion, id) {
  if (!canAccept(profile, companion)) {
    const status = normalizeOnlineStatus(companion.availability_status || companion.online_status);
    const reason = !canWork(profile, companion)
      ? "账号审核通过后即可开始接单。"
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
  // Open grab only: never auto-bind companion_id; never jump to confirmed/in_progress.
  const openForGrab =
    !before.companion_id &&
    (before.status === "pending" || before.status === "waiting_boss_confirm");
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
        body: JSON.stringify({ status: "waiting_boss_confirm", accepted_at: nowIso() }),
      }
    );
    order = rows?.[0] || { ...before, status: "waiting_boss_confirm", accepted_at: nowIso() };
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
  await addSystemMessage(order, profile.id, "companion", "陪玩已抢单，等待老板确认人选。");
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

export default async function handler(req, res) {
  if (!hasDb()) return json(res, req.method === "GET" ? 200 : 503, { ok: req.method === "GET", data: { player: {}, permissions: { canAcceptOrder: false, lockReason: "真实数据库未配置" }, summary: { todayOrders: 0, waitingConfirm: 0, runningOrders: 0, completedOrders: 0, monthIncome: 0, withdrawable: 0 }, openOrders: [], myOrders: [], earnings: {}, earningDetails: [] }, message: "未配置 Supabase，陪玩端不返回假业务数据。" });
  try {
    const action = String(req.method === "GET" ? req.query.action || "bootstrap" : (req.body?.action || ""));
    if (action === "login") {
      const body = await parseBody(req); const account=String(body.account || body.email || "").trim().toLowerCase(); const password=String(body.password || "");
      if (!account || !password) return json(res,400,{ok:false,message:"请输入邮箱和密码"});
      const auth = await supabaseJson(authUrl("token?grant_type=password"), { method:"POST", headers: anonHeaders(), body: JSON.stringify({ email: account, password }) });
      const profile = await profileById(auth.user.id);
      if (!profile || profile.role !== "companion") return json(res,403,{ok:false,message:"无权访问陪玩端"});
      if (profile.status === "disabled") return json(res,403,{ok:false,message:"陪玩账号已停用"});
      const companion = await companionProfile(profile.id);
      return json(res,200,{ok:true,session:{token:auth.access_token,user:safePlayer(profile, companion || {}),remember:!!body.remember}});
    }
    if (action === "register") {
      const body = await parseBody(req); const email=String(body.email || body.account || "").trim().toLowerCase(); const password=String(body.password || ""); const nickname=String(body.nickname || body.name || "").trim();
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res,400,{ok:false,message:"请输入有效邮箱"});
      if (!password || password.length < 8) return json(res,400,{ok:false,message:"密码至少 8 位"});
      if (!nickname) return json(res,400,{ok:false,message:"请输入陪玩昵称"});
      const created = await supabaseJson(authUrl("admin/users"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: nickname } }) });
      await supabaseJson(restUrl("profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ id: created.id, role: "companion", display_name: nickname, email, phone: String(body.phone || ""), status: "active", created_at: nowIso() }) });
      await supabaseJson(restUrl("companion_profiles"), { method:"POST", headers: serviceHeaders(), body: JSON.stringify({ user_id: created.id, nickname, verification_status: "pending", deposit_status: "pending", online_status: "offline", created_at: nowIso(), updated_at: nowIso() }) });
      const auth = await supabaseJson(authUrl("token?grant_type=password"), { method:"POST", headers: anonHeaders(), body: JSON.stringify({ email, password }) });
      const profile = await profileById(created.id);
      const companion = await companionProfile(created.id);
      return json(res,200,{ok:true,message:"陪玩账号已创建，请继续提交资料审核。",session:{token:auth.access_token,user:safePlayer(profile, companion || {}),remember:!!body.remember}});
    }
    const auth = await requireCompanion(req);
    const companion = auth.companion || await companionProfile(auth.profile.id) || {};
    if (req.method === "GET" && action === "bootstrap") return json(res,200,{ok:true,data:await bootstrapData(auth.profile, companion)});
    if (req.method === "GET" && action === "inbox") {
      const data = await bootstrapData(auth.profile, companion);
      const inbox = await buildCompanionInbox(auth.profile, companion, {
        player: data.player,
        verification: data.verification,
        deposit: data.deposit,
        myOrders: data.myOrders,
        withdrawals: data.withdrawals,
        popularity: data.popularity,
        auditLocked: !data.permissions?.canWork,
        auditHint: data.permissions?.lockReason || "",
      });
      data.summary = { ...(data.summary || {}), unreadMessages: inbox.unreadTotal };
      return json(res, 200, { ok: true, data: inbox, inbox });
    }
    if (req.method === "GET" && (action === "wallet" || action === "earnings")) {
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
      const approvedAccounts = (paymentAccounts || [])
        .filter((a) => /approved|verified/.test(String(a.status || "")))
        .map((a) => ({
          id: a.id,
          bankName: a.bank_name || "",
          accountHolder: a.account_name || "",
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
          withdrawals: (wallet.withdrawalRows || []).map((w) => ({
            id: w.id,
            withdrawalNo: w.withdrawal_no,
            catFoodAmount: money(w.cat_food_amount || w.amount),
            netAmountRm: money(w.net_amount_rm),
            status: w.status,
            statusText: WITHDRAW_STATUS_TEXT[w.status] || w.status,
            submittedAt: w.submitted_at || w.created_at,
            reviewedAt: w.reviewed_at || w.approved_at || "",
            rejectReason: w.reject_reason || w.rejection_reason || "",
            amount: money(w.cat_food_amount || w.amount),
            createdAt: w.submitted_at || w.created_at,
          })),
          withdrawalRules: {
            monthlyLimit,
            usedThisMonth,
            remainingThisMonth: Math.max(0, monthlyLimit - usedThisMonth),
            minAmount: money(cfg.min_withdraw_cat_food),
            exchangeRate: money(cfg.cat_food_to_rm_rate) || 1,
            feeRm: money(cfg.withdraw_fee_rm),
            feePercent: money(cfg.withdraw_fee_percent),
            currentAccount: payment
              ? `${payment.bank_name || ""} ${payment.account_name || ""} ****${payment.account_last4 || maskBankAccount(payment.bank_account).slice(-4)}`
              : "",
            approvedAccounts,
          },
          warnings: wallet.warnings || [],
        },
      });
    }
    if (req.method === "GET" && action === "get_settlement") {
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
      const order = await claimOrder(auth.profile, companion, String(body.id || ""));
      const already = !!order._already;
      return json(res, 200, {
        ok: true,
        message: already ? "你已抢过该单，请等待老板确认。" : "已抢单，等待老板确认。",
        order: viewOrder({ ...order, companion_id: null, status: order.status || "waiting_boss_confirm" }),
        grab: order._grab || null,
        already,
        // Explicit: grab is NOT formal accept / NOT startable.
        formalAccepted: false,
        canStart: false,
      });
    }
    if (action === "accept_direct_order" || action === "accept_direct") {
      const id = String(body.id || "");
      const name = String(auth.profile.display_name || companion.nickname || "陪玩").trim() || "陪玩";
      const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = beforeRows?.[0];
      if (!before || before.status !== "claimed") return json(res, 409, { ok: false, message: "当前订单不能确认接单" });
      const order = await patchOwnOrder(
        auth.profile,
        id,
        "claimed",
        { status: "confirmed", accepted_at: nowIso() },
        `陪玩 ${name} 已接受订单 ${before.order_no || before.id}。陪玩已确认接单。`
      );
      return json(res, 200, { ok: true, message: "已确认接单，订单进入待开始", order: viewOrder(order) });
    }
    if (action === "reject_direct_order") {
      const id = String(body.id || "");
      const reasonRaw = String(body.reason || body.reject_reason || body.payload?.reason || "").trim();
      const reason = REJECT_REASONS.includes(reasonRaw) ? reasonRaw : (reasonRaw ? "其他原因" : "");
      if (!reason) return json(res, 400, { ok: false, message: "请选择无法接单的原因", reasons: REJECT_REASONS });
      const beforeRows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`), { headers: serviceHeaders() });
      const before = beforeRows?.[0];
      if (!before || before.status !== "claimed") return json(res, 409, { ok: false, message: "当前订单不能拒绝" });
      const name = String(auth.profile.display_name || companion.nickname || "陪玩").trim() || "陪玩";
      const note = `陪玩无法接单|原因:${reason}|原陪玩:${auth.profile.id}|${nowIso()}`;
      let rows;
      try {
        rows = await supabaseJson(
          restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&status=eq.claimed`),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              companion_id: null,
              status: "pending",
              accepted_at: null,
              cancel_reason: `陪玩无法接单：${reason}`,
              note,
            }),
          }
        );
      } catch {
        rows = await supabaseJson(
          restUrl("orders", `?id=eq.${encodeURIComponent(id)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&status=eq.claimed`),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              companion_id: null,
              status: "pending",
              accepted_at: null,
            }),
          }
        );
      }
      const saved = rows?.[0] || { ...before, companion_id: null, status: "pending", note, cancel_reason: `陪玩无法接单：${reason}` };
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
      const orderId = String(body.id || "");
      const beforeRows = await supabaseJson(
        restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const before = beforeRows?.[0];
      if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });
      // Grab applicants cannot start until boss selects them (status=confirmed).
      if (before.status !== "confirmed") {
        return json(res, 409, {
          ok: false,
          message:
            before.status === "waiting_boss_confirm" || before.status === "pending"
              ? "老板尚未确认人选，不能开始订单。"
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
      return json(res, 200, { ok: true, message: "已开始服务，订单进入进行中。", order: viewOrder(order) });
    }
    if (action === "complete_order" || action === "confirm_complete") {
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
        return json(res, 200, {
          ok: true,
          message: "已申请完成，等待老板确认。",
          order: viewOrder(before),
          awaitingBossConfirm: true,
        });
      }
      await grabsApi.markCompletionPending(before);
      const afterRows = await supabaseJson(
        restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&companion_id=eq.${encodeURIComponent(auth.profile.id)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const saved = afterRows?.[0] || before;
      await addSystemMessage(saved, auth.profile.id, "companion", "陪玩已完成服务，请确认订单。");
      return json(res, 200, {
        ok: true,
        message: "已提交完成申请，等待老板确认后结算。",
        order: viewOrder(saved),
        awaitingBossConfirm: true,
      });
    }
    if (action === "set_online_status") {
      const allowed = new Set(["online", "busy", "paused", "offline"]);
      const raw = String(body.online_status || body.availability_status || body.status || "offline").toLowerCase();
      const status = allowed.has(raw) ? raw : "offline";
      if (auth.profile.status !== "active") return json(res, 403, { ok: false, message: "账号已停用，不能接单" });
      if (!canWork(auth.profile, companion || {})) {
        return json(res, 403, { ok: false, message: "账号审核通过后即可开始接单。" });
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

      const patch = {
        nickname,
        game: mainGame,
        main_service: String(body.main_service || body.mainService || companion.main_service || ""),
        service_type: serviceTypes.join(","),
        service_ids: serviceIds,
        description: String(body.bio || body.description || ""),
        voice_url: String(body.voice_url || companion.voice_url || ""),
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
        application_status: "pending",
        updated_at: nowIso(),
      };
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
      return json(res, 200, { ok: true, message: "公开资料已提交审核", gamePrices: nextGamePrices });
    }

    if (action === "submit_verification") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      const front = await saveUploadFromBody(auth.profile.id, "id-front", PRIVATE_BUCKETS.identity, body.id_front || body.idFront, "id-front.jpg");
      const back = await saveUploadFromBody(auth.profile.id, "id-back", PRIVATE_BUCKETS.identity, body.id_back || body.idBack, "id-back.jpg");
      const handheld = await saveUploadFromBody(
        auth.profile.id,
        "id-handheld",
        PRIVATE_BUCKETS.identity,
        body.id_handheld || body.idHandheld,
        "id-handheld.jpg"
      );
      await upsertByCompanion("companion_identity_verifications", row.id, auth.profile.id, {
        real_name: String(body.real_name || body.realName || ""),
        identity_no: String(body.identity_no || body.identityNo || ""),
        id_front_path: front.path || "",
        id_back_path: back.path || "",
        id_handheld_path: handheld.path || "",
        status: "pending",
        reject_reason: "",
        submitted_at: nowIso(),
      });
      if (body.bank_name || body.bank_account || body.settlementMethod || body.method || body.tng_account || body.alipay_account) {
        await upsertByCompanion("companion_payment_accounts", row.id, auth.profile.id, {
          method: String(body.settlementMethod || body.method || body.payment_method || "bank"),
          bank_name: String(body.bank_name || body.bankName || ""),
          account_name: String(body.account_name || body.accountName || body.real_name || ""),
          bank_account: String(body.bank_account || body.bankAccount || ""),
          account_last4: String(body.bank_account || body.bankAccount || "")
            .replace(/\s+/g, "")
            .slice(-4),
          tng_account: String(body.tng_account || body.tngAccount || ""),
          alipay_account: String(body.alipay_account || body.alipayAccount || ""),
          status: "pending",
          reject_reason: "",
          submitted_at: nowIso(),
        });
      }
      await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ verification_status: "pending", updated_at: nowIso() }),
      });
      return json(res, 200, { ok: true, message: "认证资料已提交，等待后台审核。" });
    }

    if (action === "submit_deposit_proof" || action === "submit_deposit") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      const proof = await saveUploadFromBody(
        auth.profile.id,
        "deposit",
        PRIVATE_BUCKETS.payment,
        body.proof_url || body.proofUrl || body.proof,
        "deposit-proof.jpg"
      );
      await upsertByCompanion("companion_deposits", row.id, auth.profile.id, {
        required_amount: money(body.required_amount || 100) || 100,
        paid_amount: money(body.paid_amount || body.paidAmount),
        payment_method: String(body.payment_method || body.paymentMethod || ""),
        proof_path: proof.path || "",
        proof_bucket: proof.bucket || PRIVATE_BUCKETS.payment,
        status: "pending",
        reject_reason: "",
        remark: String(body.remark || ""),
        paid_at: nowIso(),
      });
      await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ deposit_status: "pending", updated_at: nowIso() }),
      });
      return json(res, 200, { ok: true, message: "押金凭证已提交，等待后台确认。" });
    }

    if (action === "upload_media") {
      const row = await ensureCompanionRow(auth.profile, companion);
      await ensureCompanionBuckets();
      const mediaType = String(body.media_type || body.mediaType || "gallery");
      if (!["avatar", "gallery", "voice"].includes(mediaType)) {
        return json(res, 400, { ok: false, message: "不支持的媒体类型" });
      }
      const dataUrl = body.data_url || body.dataUrl || body.file;
      if (!dataUrl) return json(res, 400, { ok: false, message: "请选择要上传的文件" });

      const galleryFallback = readGalleryFallback(row.tags || companion.tags || "");
      if (mediaType === "gallery") {
        const existing = await companionDb(
          "companion_media",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.gallery&select=id`
        ).catch((e) => (isMissingRelation(e) ? null : Promise.reject(e)));
        const galleryCount = existing == null ? galleryFallback.items.length : (existing || []).length;
        if (galleryCount >= 6) {
          return json(res, 400, { ok: false, message: "相册最多上传 6 张，请先删除后再上传" });
        }
      }

      let uploaded;
      let publicUrl = "";
      if (mediaType === "voice") {
        uploaded = await saveUploadFromBody(
          auth.profile.id,
          mediaType,
          PRIVATE_BUCKETS.audio,
          dataUrl,
          body.filename || "voice.webm"
        );
      } else {
        const decoded = assertImageUpload(decodeDataUrl(dataUrl));
        const objectPath = buildObjectPath(auth.profile.id, mediaType, body.filename || `${mediaType}.jpg`);
        let bucket = PUBLIC_BUCKETS.profile;
        try {
          await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType);
          publicUrl = publicObjectUrl(bucket, objectPath);
        } catch {
          bucket = PRIVATE_BUCKETS.gallery;
          await uploadPrivateObject(bucket, objectPath, decoded.buffer, decoded.contentType);
          publicUrl = await createSignedUrl(bucket, objectPath, 60 * 60 * 24 * 30);
        }
        uploaded = { bucket, path: objectPath, contentType: decoded.contentType };
      }
      if (!uploaded.path) return json(res, 400, { ok: false, message: "缺少上传文件" });

      if (mediaType === "avatar") {
        const oldAvatars = await companionDb(
          "companion_media",
          `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.avatar`
        ).catch(() => []);
        for (const old of oldAvatars || []) {
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
          : body.sort_order != null
            ? Number(body.sort_order)
            : 100 + (Date.now() % 100000);
      let mediaRow = null;
      let mediaTableMissing = false;
      try {
        const mediaRows = await companionDb("companion_media", "", {
          method: "POST",
          body: JSON.stringify({
            companion_profile_id: row.id,
            user_id: auth.profile.id,
            media_type: mediaType,
            storage_bucket: uploaded.bucket,
            storage_path: uploaded.path,
            content_type: uploaded.contentType || "",
            duration_seconds: body.duration_seconds != null ? Number(body.duration_seconds) : null,
            status: "approved",
            sort_order: sortOrder,
            uploaded_at: nowIso(),
            created_at: nowIso(),
            updated_at: nowIso(),
          }),
        });
        mediaRow = Array.isArray(mediaRows) ? mediaRows[0] : mediaRows;
      } catch (error) {
        if (!isMissingRelation(error)) throw error;
        mediaTableMissing = true;
      }

      if (!publicUrl && uploaded.bucket && uploaded.path) {
        try {
          publicUrl =
            uploaded.bucket === PUBLIC_BUCKETS.profile
              ? publicObjectUrl(uploaded.bucket, uploaded.path)
              : await createSignedUrl(uploaded.bucket, uploaded.path, 60 * 60 * 24 * 30);
        } catch {
          publicUrl = "";
        }
      }

      const companionPatch = { media_status: "approved", media_reject_reason: "", updated_at: nowIso() };
      if (mediaType === "avatar" && publicUrl) {
        companionPatch.card_image_url = publicUrl;
        await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(auth.profile.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ avatar_url: publicUrl }),
        });
      }
      if (mediaType === "gallery" && publicUrl && !companion.card_image_url && !auth.profile.avatar_url) {
        companionPatch.card_image_url = publicUrl;
      }
      if (mediaType === "voice") companionPatch.voice_url = publicUrl || "";

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
            : mediaType === "gallery"
              ? "相册照片上传成功"
              : mediaType === "voice"
                ? "录音上传成功"
                : "媒体上传成功",
        url: publicUrl,
        media: {
          id: fallbackMediaId || `legacy-${mediaType}`,
          mediaType,
          url: publicUrl,
          sortOrder,
        },
      });
    }

    if (action === "delete_media") {
      const row = await ensureCompanionRow(auth.profile, companion);
      const mediaId = String(body.media_id || body.id || "").trim();
      const mediaType = String(body.media_type || body.mediaType || "").trim();

      // Legacy / soft-fallback ids when companion_media table is missing.
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
        const galleryFallback = readGalleryFallback(row.tags || companion.tags || "");
        const nextItems = galleryFallback.items.filter((g) => String(g.id) !== mediaId);
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ tags: writeGalleryFallback(galleryFallback.baseTags, nextItems), updated_at: nowIso() }),
        });
        return json(res, 200, { ok: true, message: "已删除" });
      }

      let items = [];
      try {
        if (mediaId) {
          items = await companionDb(
            "companion_media",
            `?id=eq.${encodeURIComponent(mediaId)}&user_id=eq.${encodeURIComponent(auth.profile.id)}`
          );
        } else if (mediaType === "avatar") {
          items = await companionDb(
            "companion_media",
            `?companion_profile_id=eq.${encodeURIComponent(row.id)}&media_type=eq.avatar`
          );
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
      for (const item of items) {
        try {
          await deleteStorageObject(item.storage_bucket, item.storage_path);
        } catch {
          /* ignore */
        }
        try {
          await companionDb("companion_media", `?id=eq.${encodeURIComponent(item.id)}`, { method: "DELETE" });
        } catch (error) {
          if (!isMissingRelation(error)) throw error;
        }
      }
      const deletedAvatar = items.some((i) => i.media_type === "avatar");
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
      return json(res, 200, { ok: true, message: "已删除" });
    }

    if (action === "reorder_media") {
      const row = await ensureCompanionRow(auth.profile, companion);
      const ids = Array.isArray(body.ordered_ids || body.ids) ? body.ordered_ids || body.ids : [];
      if (!ids.length) return json(res, 400, { ok: false, message: "缺少排序列表" });
      let order = 10;
      for (const id of ids) {
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
      const patch = {
        main_service: String(body.main_service || body.mainService || applyGameNames[0] || ""),
        game: applyGame,
        service_type: (applyServiceTypes.length ? applyServiceTypes : ["陪玩服务"]).join(","),
        service_ids: applyServiceIds,
        game_rank: String(body.rank || body.game_rank || ""),
        position: String(body.position || ""),
        voice_type: String(body.voice_type || body.voiceType || ""),
        schedule: String(body.schedule || ""),
        application_note: String(body.note || body.application_note || ""),
        tags: String(body.tags || ""),
        application_status: "pending",
        application_reject_reason: "",
        application_submitted_at: nowIso(),
        verification_status: "pending",
        updated_at: nowIso(),
      };
      try {
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(patch),
        });
      } catch {
        await supabaseJson(restUrl("companion_profiles", `?id=eq.${encodeURIComponent(row.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            game: patch.game,
            verification_status: "pending",
            updated_at: nowIso(),
          }),
        });
      }
      return json(res, 200, { ok: true, message: "陪玩申请已提交，等待后台审核。" });
    }

    if (action === "send_cs_message" || action === "send_message") {
      const conversation = await ensureCompanionSupportConversation(auth.profile.id);
      const msg = await sendCompanionChatMessage(conversation, auth.profile.id, body.content || body.message || "");
      return json(res, 200, {
        ok: true,
        message: "消息已发送",
        messageRow: viewMessage(msg),
      });
    }
    if (action === "mark_notices_read") {
      const keys = Array.isArray(body.keys) ? body.keys : body.key ? [body.key] : [];
      const result = await markNoticesRead(auth.profile.id, keys);
      return json(res, 200, { ok: true, message: "已标记已读", ...result });
    }
    if (action === "mark_all_read") {
      const data = await bootstrapData(auth.profile, companion);
      const notices = buildSystemNotices({
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
      const keys = Array.isArray(body.keys) && body.keys.length
        ? body.keys
        : notices.map((n) => n.key);
      await markNoticesRead(auth.profile.id, keys);
      const conversation = await ensureCompanionSupportConversation(auth.profile.id);
      if (conversation?.id) await markConversationMessagesRead(conversation.id, { companionUserId: auth.profile.id });
      return json(res, 200, { ok: true, message: "已全部标记已读", marked: keys.length });
    }
    if (action === "mark_cs_read" || action === "read_cs_conversation") {
      const conversation = await ensureCompanionSupportConversation(auth.profile.id);
      if (conversation?.id) await markConversationMessagesRead(conversation.id, { companionUserId: auth.profile.id });
      return json(res, 200, { ok: true, message: "已标记已读" });
    }

    if (action === "request_withdrawal") {
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
      if (Number(data.withdrawalRules.remainingThisMonth || 0) <= 0) {
        return json(res, 400, { ok: false, message: "本月提现次数已用完" });
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
        /^(pending|pending_review)$/.test(String(w.status || ""))
      );
      if (pendingDup) {
        return json(res, 400, {
          ok: false,
          message: "已有待审核提现申请，请等待后台处理后再提交",
        });
      }

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

      const withdrawalPayload = {
        withdrawal_no: `WD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
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
        status: "pending_review",
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
            note: `提现申请冻结 ${item?.withdrawal_no || ""}`.trim(),
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
        /* ledger marker optional if enum/status constraints fail; withdrawal row still pending */
      }

      return json(res, 200, {
        ok: true,
        message: "提现申请已提交，等待后台审核",
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
          status: item.status || "pending_review",
          statusText: "待审核",
        },
        item,
        data: {
          withdrawalId: item.id,
          withdrawalNo: item.withdrawal_no,
          status: item.status || "pending_review",
        },
      });
    }

    return json(res,400,{ok:false,message:"未知陪玩端操作"});
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "陪玩端接口异常",
      status: error.status || 500,
      supabase: error.body || null,
      url: error.url || "",
    });
  }
}

