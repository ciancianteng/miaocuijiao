import {
  PRIVATE_BUCKETS,
  companionDb,
  companionServiceHeaders,
  createSignedUrl,
  hasCompanionDb,
  isMissingRelation,
  maskBankAccount,
  maskIdentityNo,
} from "../_companion-media-store.js";
import { readLocalLevels } from "../_companion-levels-store.js";
import { resolvePlatformCommission } from "../_commission-rates.js";
import { resolveCompanionAvatar, resolveCompanionCover } from "../_companion-public-map.js";
import { evaluatePublishGate, listingBlockReason } from "../_companion-publish-gate.js";
import {
  activeCompanionProfilePatch,
  approveListingPatchForRow,
  ensureDefaultLevelPatch,
  preserveExistingContent,
  unlistListingPatch,
} from "../_companion-listing-sync.js";
import { resolveCertTagsForProfiles, setAssignmentsForProfile, readCertTags, toPublicCertTag } from "../_companion-cert-tags-store.js";
import { formatCompanionCode, parseCompanionCodeNumber, resolveCompanionPublicCode } from "../_account-codes.js";
import { requireAdmin as requireAdminJwt } from "../_admin-auth.js";
import { notifyCompanionReviewResult } from "../_companion-inbox.js";
import {
  DRAFT_TTL_MS,
  isApplicationDraft,
  isApplicationQueueRow,
  isExpiredDraft,
  isFormalCompanion,
  normalizeApplicationStatus,
} from "../_companion-draft.js";

const ADMIN_ROLES = new Set(["super_admin", "admin", "finance_admin"]);
const PLAYER_TABLE = "companion_profiles";
const SIGN_TTL = 300;
const ANON_KEY = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const ACCOUNT_LABEL = { active: "正常", disabled: "冻结", pending: "待审核" };
const STATUS_LABEL = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  resubmit: "需要补资料",
  verified: "已通过",
  unverified: "未认证",
  paid: "已缴纳",
  unpaid: "未缴纳",
  refunded: "已退回",
  draft: "申请草稿",
  archived: "已归档",
  none: "无",
};
const ONLINE_LABEL = { online: "在线", offline: "离线", busy: "忙碌", paused: "暂停接单" };

async function resolveLevelMeta(levelIdOrName) {
  const key = String(levelIdOrName || "").trim();
  if (!key) return null;
  const levels = await readLocalLevels().catch(() => []);
  const found = (levels || []).find(
    (l) =>
      String(l.id) === key ||
      String(l.code) === key ||
      String(l.name) === key ||
      String(l.level) === key ||
      `${l.code || ""} ${l.name || ""}`.trim() === key
  );
  if (!found) {
    return { id: key, name: key, min: null, commissionRate: null };
  }
  return {
    id: found.id,
    name: `${found.code || ""} ${found.name || ""}`.trim() || found.name || found.id,
    min: found.min,
    max: found.max,
    commissionRate: found.commissionRate,
  };
}

function stripMissingColumnFromPatch(patch, error) {
  const next = { ...patch };
  const msg = String(error?.message || error || "");
  const m =
    msg.match(/Could not find the '([^']+)' column/i) ||
    msg.match(/column\s+[\"']?([a-z0-9_]+)[\"']?\s+of\s+relation/i) ||
    msg.match(/column\s+[\"']?([a-z0-9_]+)[\"']?\s+does not exist/i);
  if (m && m[1] && m[1] in next) {
    delete next[m[1]];
    return next;
  }
  // Known optional columns (never drop allow_orders / application_status / verification_status).
  const optional = [
    "listing_synced_at",
    "is_visible",
    "is_published",
    "gift_commission_rate",
    "direct_rebate_rate",
    "level_id",
    "level_effective_at",
    "commission_effective_at",
    "featured",
    "main_service",
    "tags",
    "voice_type",
    "age",
    "gender",
    "region",
    "companion_code",
    "price_min",
    "price_max",
  ];
  for (const key of optional) {
    if (key in next) {
      delete next[key];
      return next;
    }
  }
  return next;
}

async function patchCompanionRow(id, patch) {
  let body = { ...patch, updated_at: patch.updated_at || new Date().toISOString() };
  // Drop known-missing listing stamp up front so approve never fails to set allow_orders.
  if ("listing_synced_at" in body) delete body.listing_synced_at;
  if ("is_visible" in body) delete body.is_visible;
  if ("is_published" in body) delete body.is_published;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!isMissingRelation(error) && !/column|schema cache|PGRST/i.test(String(error.message || ""))) throw error;
      const next = stripMissingColumnFromPatch(body, error);
      if (Object.keys(next).length === Object.keys(body).length) throw error;
      body = next;
    }
  }
  return companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Allocate a formal PW##### code, preferring the DB sequence RPC (never reused). */
async function allocateCompanionCodeViaRpc() {
  try {
    const result = await companionDb("rpc/mcj_allocate_companion_code", "", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const code = typeof result === "string" ? result : result?.mcj_allocate_companion_code || result?.code || "";
    return /^PW\d+$/i.test(String(code || "").trim()) ? String(code).trim().toUpperCase() : "";
  } catch {
    return "";
  }
}

async function allocateCompanionCodeByScan() {
  const rows = await companionDb(
    PLAYER_TABLE,
    "?select=companion_code&companion_code=not.is.null&order=companion_code.desc&limit=500"
  ).catch(() => []);
  let next = 1;
  for (const row of Array.isArray(rows) ? rows : []) {
    const n = parseCompanionCodeNumber(row?.companion_code);
    if (n) next = Math.max(next, n + 1);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = formatCompanionCode(next + attempt);
    const existing = await companionDb(
      PLAYER_TABLE,
      `?companion_code=eq.${encodeURIComponent(candidate)}&select=id&limit=1`
    ).catch(() => []);
    if (!Array.isArray(existing) || existing.length === 0) return candidate;
  }
  return formatCompanionCode(next + (Date.now() % 1000));
}

async function allocateCompanionCode() {
  const viaRpc = await allocateCompanionCodeViaRpc();
  if (viaRpc) return viaRpc;
  return allocateCompanionCodeByScan();
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "").trim();
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function requireAdmin(req) {
  // Shared JWT → profiles.role check (role aliases + anon key env fallbacks).
  // Do not trust x-mcj-admin-role alone.
  try {
    return await requireAdminJwt(req, { allowRoles: ADMIN_ROLES });
  } catch (error) {
    const status = error?.status || 403;
    if (status === 401) {
      throw Object.assign(new Error("请先登录管理员账号。"), { status: 401 });
    }
    // Keep a stable internal code; UI must never show this raw string.
    throw Object.assign(new Error("没有陪玩管理权限"), { status: 403, code: "NO_PLAYER_ADMIN" });
  }
}

function labelStatus(value, fallback = "待审核") {
  const key = String(value || "").toLowerCase();
  return STATUS_LABEL[key] || value || fallback;
}

function normalizeStatusInput(value, fallback = "pending") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/待审核|pending_review|submitted|pending|审核中/i.test(text)) return "pending";
  if (/已通过|approved|已认证|verified|已缴纳|paid|已到账/i.test(text)) return "approved";
  if (/已驳回|已拒绝|rejected/i.test(text)) return "rejected";
  if (/重新提交|resubmit|待补充|need_more/i.test(text)) return "resubmit";
  if (/草稿|draft/i.test(text)) return "draft";
  if (/未缴纳|unpaid/i.test(text)) return "unpaid";
  if (/已退回|refunded/i.test(text)) return "refunded";
  if (/正常|启用|active/i.test(text)) return "active";
  if (/冻结|封禁|停用|disabled/i.test(text)) return "disabled";
  if (/暂停接单/i.test(text)) return "paused";
  return text;
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function percent(value) {
  const n = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(n) ? n : undefined;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "是", "开启", "显示"].includes(text)) return true;
  if (["false", "0", "no", "否", "关闭", "隐藏"].includes(text)) return false;
  return fallback;
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function logOperation(req, action, targetId, beforeValue, afterValue, reason = "") {
  try {
    await companionDb("admin_operation_logs", "", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        module: "players",
        action,
        target_type: "companion",
        target_id: String(targetId || ""),
        operator_role: roleFrom(req),
        reason: String(reason || ""),
        before_value: beforeValue || null,
        after_value: afterValue || null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* best effort */
  }
}

function parseAuthModeFromNote(note = "") {
  const m = String(note || "").match(/\[AUTH_MODE:(id_card|deposit)\]/i);
  return m ? String(m[1]).toLowerCase() : "";
}

function authModeLabelOf(mode = "") {
  if (mode === "id_card") return "身份证认证";
  if (mode === "deposit") return "押金认证";
  return "-";
}

function resolveAuthMode(row = {}, related = {}) {
  const tagged =
    parseAuthModeFromNote(row.application_note) ||
    String(row.credential_mode || row.auth_mode || row.authMode || "")
      .trim()
      .toLowerCase();
  if (tagged === "id_card" || tagged === "deposit") return tagged;
  const identity = related.identity;
  const deposit = related.deposit;
  const hasIdDocs = !!(identity && (identity.id_front_path || identity.id_back_path));
  const hasDepositProof = !!(deposit && deposit.proof_path);
  if (hasIdDocs && !hasDepositProof) return "id_card";
  if (hasDepositProof && !hasIdDocs) return "deposit";
  const idSt = String(row.identity_status || row.verification_status || "").toLowerCase();
  const depSt = String((deposit && deposit.status) || row.deposit_status || "").toLowerCase();
  const idSubmitted = /pending|approved|verified|passed|resubmit|rejected/.test(idSt) && idSt !== "unverified";
  const depSubmitted = /pending|paid|approved|verified|passed|resubmit|rejected|received/.test(depSt) && depSt !== "unpaid";
  if (idSubmitted && !depSubmitted) return "id_card";
  if (depSubmitted && !idSubmitted) return "deposit";
  return "";
}

function normalizeProfileReviewStatus(row = {}) {
  const raw = String(row.application_status || "")
    .trim()
    .toLowerCase();
  if (/approved|verified|passed/.test(raw)) return "approved";
  if (/reject/.test(raw)) return "rejected";
  if (/resubmit|need_more/.test(raw)) return "need_more";
  if (/^draft$|^archived$|^deleted$/.test(raw)) return "draft";
  if (isApplicationDraft(row)) return "draft";
  return "pending";
}

function normalizeDepositStatus(row = {}, related = {}) {
  const raw = String((related.deposit && related.deposit.status) || row.deposit_status || "")
    .trim()
    .toLowerCase();
  if (/approved|verified|passed|paid|received/.test(raw)) return "approved";
  if (/reject/.test(raw)) return "rejected";
  if (/pending|review|submitted/.test(raw)) return "pending";
  if (/unpaid|draft|none|not_submitted/.test(raw) || !raw) return "unpaid";
  return "pending";
}

function labelDepositStatus(norm, raw) {
  if (norm === "approved") return "已缴纳";
  if (norm === "unpaid") return "未缴纳";
  if (norm === "rejected") return "已驳回";
  if (norm === "pending") return "待审核";
  return labelStatus(raw, "未缴纳");
}

function labelProfileReviewStatus(norm) {
  if (norm === "approved") return "已通过";
  if (norm === "rejected") return "已驳回";
  if (norm === "need_more") return "需要补资料";
  if (norm === "draft") return "申请草稿";
  return "待审核";
}

/** Current review media only: 1 avatar, 1 cover, unique gallery, 1 latest voice (+ history separate). */
function partitionCompanionMedia(mediaSigned = []) {
  const buckets = { avatar: [], cover: [], gallery: [], voice: [], other: [] };
  for (const item of mediaSigned) {
    const t = String(item.mediaType || item.media_type || "").toLowerCase();
    if (t === "avatar") buckets.avatar.push(item);
    else if (t === "cover" || t === "card" || t === "card_image") buckets.cover.push(item);
    else if (t === "gallery") buckets.gallery.push(item);
    else if (t === "voice") buckets.voice.push(item);
    else buckets.other.push(item);
  }
  const byUploadedDesc = (a, b) =>
    new Date(b.uploadedAt || b.uploaded_at || 0).getTime() - new Date(a.uploadedAt || a.uploaded_at || 0).getTime();
  const bySortThenUpload = (a, b) => {
    const sa = Number(a.sortOrder ?? a.sort_order ?? 100);
    const sb = Number(b.sortOrder ?? b.sort_order ?? 100);
    if (sa !== sb) return sa - sb;
    return (
      new Date(a.uploadedAt || a.uploaded_at || 0).getTime() -
      new Date(b.uploadedAt || b.uploaded_at || 0).getTime()
    );
  };

  const avatars = buckets.avatar.slice().sort(byUploadedDesc);
  const avatarMedia = avatars[0] || null;

  const covers = buckets.cover.slice().sort(byUploadedDesc);
  let coverMedia = covers[0] || null;

  const gallerySeen = new Set();
  const gallery = [];
  for (const g of buckets.gallery.slice().sort(bySortThenUpload)) {
    const key = String(g.storagePath || g.storage_path || g.url || g.id || "").trim();
    if (!key || gallerySeen.has(key)) continue;
    gallerySeen.add(key);
    gallery.push(g);
  }
  // Legacy DB without cover type: treat gallery sort_order=1 as card cover when no cover row.
  if (!coverMedia && gallery.length) {
    const maybeCover = gallery.find((g) => Number(g.sortOrder ?? g.sort_order ?? 100) === 1);
    if (maybeCover) {
      coverMedia = { ...maybeCover, mediaType: "cover" };
      const idx = gallery.indexOf(maybeCover);
      if (idx >= 0) gallery.splice(idx, 1);
    }
  }

  const voicesSorted = buckets.voice.slice().sort(byUploadedDesc);
  const voiceCurrent = voicesSorted[0] || null;
  const voiceHistory = voicesSorted.slice(1);

  return {
    avatarMedia,
    coverMedia,
    gallery,
    voices: voiceCurrent ? [voiceCurrent] : [],
    voiceHistory,
    currentItems: [avatarMedia, coverMedia, ...gallery, voiceCurrent].filter(Boolean),
  };
}

function deriveMediaStatusFromItems(items = [], fallback = "pending") {
  const statuses = items.map((m) => String(m.status || "pending").toLowerCase());
  if (!statuses.length) return fallback || "pending";
  if (statuses.some((s) => s === "rejected")) return "rejected";
  if (statuses.some((s) => s === "resubmit")) return "resubmit";
  if (statuses.some((s) => !s || s === "pending" || s === "unverified")) return "pending";
  if (statuses.every((s) => s === "approved" || s === "verified")) return "approved";
  return fallback || "pending";
}

function resolveAccountAccessStatus(profile = {}, row = {}, related = {}) {
  const profileSt = normalizeProfileReviewStatus(row);
  const depositSt = normalizeDepositStatus(row, related);
  const depositRow = related.deposit || null;
  const authMode = resolveAuthMode(row, related);
  if (profile.status && profile.status !== "active" && profile.status !== "pending") {
    return { status: "blocked", label: "账号已停用，无法接单。" };
  }
  if (profile.status !== "active") {
    return { status: "pending", label: "账号尚未启用，暂时无法接单。" };
  }
  if (row.allow_orders === false && profileSt === "approved") {
    return { status: "blocked", label: "后台已暂停该账号接单权限。" };
  }
  if (profileSt === "rejected") {
    const appReason = String(row.application_reject_reason || "").trim();
    return {
      status: "rejected",
      label: appReason ? `审核未通过：${appReason}` : "资料审核未通过，请修改后重新提交。",
    };
  }
  if (profileSt === "need_more") {
    const appReason = String(row.application_reject_reason || "").trim();
    return {
      status: "need_more",
      label: appReason ? `需补交资料：${appReason}` : "请按审核意见补交资料后再接单。",
    };
  }
  if (profileSt === "draft") {
    return { status: "draft", label: "资料未完成，请继续填写申请。" };
  }
  if (profileSt !== "approved") {
    return { status: "pending", label: "资料审核中，暂时无法接单。" };
  }
  if (authMode === "deposit" && depositSt === "rejected") {
    const depReason = String(depositRow?.reject_reason || row.deposit_reject_reason || "").trim();
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
  if (row.allow_orders === false) {
    return { status: "blocked", label: "后台已暂停该账号接单权限。" };
  }
  return { status: "approved", label: "认证已通过，可正常接单。" };
}

function mapListPlayer(row = {}, profile = {}, related = {}) {
  const accountRaw = profile.status || "active";
  const identityRaw = row.identity_status || row.verification_status || "pending";
  const applicationRaw = row.application_status || "pending";
  const verificationRaw = row.verification_status || "pending";
  const depositRaw = (related.deposit && related.deposit.status) || row.deposit_status || "unpaid";
  const mediaRaw = row.media_status || "pending";
  const authMode = resolveAuthMode(row, related);
  const profileReviewStatus = normalizeProfileReviewStatus(row);
  const depositStatusNorm = normalizeDepositStatus(row, related);
  const access = resolveAccountAccessStatus(profile, row, related);
  const accountAccessApproved = access.status === "approved";
  return {
    id: row.id,
    uid: row.user_id,
    user_id: row.user_id,
    playerId: row.id,
    companion_code: row.companion_code || "",
    companionCode: row.companion_code || "",
    publicId: resolveCompanionPublicCode(row),
    nickname: row.nickname || profile.display_name || "-",
    name: row.nickname || profile.display_name || "-",
    email: profile.email || "",
    phone: row.contact_phone || profile.phone || "",
    avatar: resolveCompanionAvatar(profile, row),
    avatar_url: resolveCompanionAvatar(profile, row),
    cover: resolveCompanionCover(profile, row),
    card_image_url: resolveCompanionCover(profile, row),
    game: row.game || "",
    mainGame: row.game || "",
    main_service: row.main_service || "",
    mainService: row.main_service || "",
    level_id: row.level_id || "",
    levelId: row.level_id || row.level_name || "",
    level_name: row.level_name || "",
    levelName: row.level_name || "",
    price: row.price,
    commission_rate: resolvePlatformCommission(row.commission_rate).platformRate,
    orderCommissionRate: resolvePlatformCommission(row.commission_rate).platformRate,
    gift_commission_rate: row.gift_commission_rate,
    giftCommissionRate: row.gift_commission_rate,
    direct_rebate_rate: row.direct_rebate_rate,
    directRebateRate: row.direct_rebate_rate,
    featured: !!row.featured,
    allow_orders: row.allow_orders !== false,
    allowOrders: row.allow_orders !== false,
    object_position_x: row.object_position_x != null ? Number(row.object_position_x) : undefined,
    object_position_y: row.object_position_y != null ? Number(row.object_position_y) : undefined,
    objectPositionX: row.object_position_x != null ? Number(row.object_position_x) : undefined,
    objectPositionY: row.object_position_y != null ? Number(row.object_position_y) : undefined,
    cover_fit: row.cover_fit || undefined,
    coverFit: row.cover_fit || undefined,
    tags: row.tags || "",
    voice_type: row.voice_type || "",
    voiceType: row.voice_type || "",
    deposit_status: depositStatusNorm,
    depositStatus: labelDepositStatus(depositStatusNorm, depositRaw),
    deposit_status_raw: depositRaw,
    profile_review_status: profileReviewStatus,
    profileReviewStatus,
    profileReviewStatusLabel: labelProfileReviewStatus(profileReviewStatus),
    account_access_status: access.status,
    accountAccessStatus: access.status,
    accountAccessLabel: access.label,
    verification_status: verificationRaw,
    verificationStatus: labelStatus(verificationRaw, "未认证"),
    auditStatus: labelProfileReviewStatus(profileReviewStatus),
    audit: labelProfileReviewStatus(profileReviewStatus),
    identity_status: identityRaw,
    identityStatus: labelProfileReviewStatus(profileReviewStatus),
    realNameStatus: labelStatus(identityRaw, "未认证"),
    media_status: mediaRaw,
    mediaStatus: labelStatus(mediaRaw),
    application_status: applicationRaw,
    applicationStatus: labelProfileReviewStatus(profileReviewStatus),
    application_submitted_at: row.application_submitted_at || "",
    applicationSubmittedAt: row.application_submitted_at || "",
    isDraft: isApplicationDraft(row),
    isFormal: isFormalCompanion(row),
    authMode,
    auth_mode: authMode,
    authModeLabel: authModeLabelOf(authMode),
    credential_mode: authMode || row.credential_mode || "",
    online_status: accountAccessApproved ? row.online_status || "offline" : "offline",
    onlineStatus: (() => {
      const code = accountAccessApproved ? row.online_status || "offline" : "offline";
      return ONLINE_LABEL[code] || code || "离线";
    })(),
    status: ACCOUNT_LABEL[accountRaw] || accountRaw,
    accountStatus: ACCOUNT_LABEL[accountRaw] || accountRaw,
    account_status: accountRaw,
    created_at: row.created_at || profile.created_at,
    updated_at: row.updated_at,
    registered_at: row.created_at || profile.created_at,
    last_login: row.last_login_at || "",
    lastLogin: row.last_login_at || "",
  };
}

async function loadRelated(profileId, companionId) {
  const empty = { identity: null, payment: null, media: [], deposit: null, orders: [], income: [], reviews: [] };
  try {
    const [identityRows, paymentRows, mediaRows, depositRows, orderRows, txRows, reviewRows] = await Promise.all([
      companionDb("companion_identity_verifications", `?companion_profile_id=eq.${encodeURIComponent(companionId)}&limit=1`).catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      }),
      companionDb("companion_payment_accounts", `?companion_profile_id=eq.${encodeURIComponent(companionId)}&limit=1`).catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      }),
      companionDb(
        "companion_media",
        `?companion_profile_id=eq.${encodeURIComponent(companionId)}&order=sort_order.asc,uploaded_at.desc`
      ).catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      }),
      companionDb("companion_deposits", `?companion_profile_id=eq.${encodeURIComponent(companionId)}&order=created_at.desc&limit=1`).catch(
        (e) => {
          if (isMissingRelation(e)) return [];
          throw e;
        }
      ),
      companionDb("orders", `?companion_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=20`).catch(() => []),
      companionDb(
        "transactions",
        `?user_id=eq.${encodeURIComponent(profileId)}&transaction_type=eq.companion_income&order=created_at.desc&limit=30`
      ).catch(() => []),
      companionDb(
        "companion_reviews",
        `?companion_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=50&select=id,order_id,boss_id,rating,content,status,created_at`
      ).catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      }),
    ]);
    return {
      identity: identityRows?.[0] || null,
      payment: paymentRows?.[0] || null,
      media: Array.isArray(mediaRows) ? mediaRows : [],
      deposit: depositRows?.[0] || null,
      orders: Array.isArray(orderRows) ? orderRows : [],
      income: Array.isArray(txRows) ? txRows : [],
      reviews: Array.isArray(reviewRows) ? reviewRows : [],
    };
  } catch (error) {
    if (isMissingRelation(error)) return empty;
    throw error;
  }
}

async function signPath(bucket, objectPath) {
  if (!objectPath) return "";
  try {
    return await createSignedUrl(bucket, objectPath, SIGN_TTL);
  } catch {
    return "";
  }
}

async function resolveStoredMediaUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^storage:\/\//i.test(s)) {
    const rest = s.replace(/^storage:\/\//i, "");
    const slash = rest.indexOf("/");
    if (slash > 0) return signPath(rest.slice(0, slash), rest.slice(slash + 1));
    return "";
  }
  if (/^https?:\/\//i.test(s) && !/\/storage\/v1\/object\/sign\//i.test(s)) return s;
  if (s.startsWith("/") && !/^\/default-avatar/i.test(s)) return s;
  return "";
}

async function buildDetail(row, profile, opts = {}) {
  const related = await loadRelated(row.user_id, row.id);
  const revealId = !!opts.revealId;
  const revealBank = !!opts.revealBank;

  const identity = related.identity;
  const payment = related.payment;
  const deposit = related.deposit;
  const media = related.media;

  const idFrontUrl = identity?.id_front_path
    ? await signPath(PRIVATE_BUCKETS.identity, identity.id_front_path)
    : "";
  const idBackUrl = identity?.id_back_path ? await signPath(PRIVATE_BUCKETS.identity, identity.id_back_path) : "";
  const idHandheldUrl = identity?.id_handheld_path
    ? await signPath(PRIVATE_BUCKETS.identity, identity.id_handheld_path)
    : "";
  const proofUrl = deposit?.proof_path
    ? await signPath(deposit.proof_bucket || PRIVATE_BUCKETS.payment, deposit.proof_path)
    : "";

  const mediaSigned = [];
  for (const item of media) {
    const url = await signPath(item.storage_bucket || PRIVATE_BUCKETS.gallery, item.storage_path);
    mediaSigned.push({
      id: item.id,
      mediaType: item.media_type,
      status: item.status,
      statusLabel: labelStatus(item.status),
      rejectReason: item.reject_reason || "",
      durationSeconds: item.duration_seconds,
      uploadedAt: item.uploaded_at || item.created_at,
      sortOrder: item.sort_order,
      storagePath: item.storage_path || "",
      storageBucket: item.storage_bucket || "",
      url,
      contentType: item.content_type || "",
    });
  }

  const partitioned = partitionCompanionMedia(mediaSigned);
  const avatarMedia = partitioned.avatarMedia;
  const coverMedia = partitioned.coverMedia;
  const gallery = partitioned.gallery;
  const voices = partitioned.voices;
  const voiceHistory = partitioned.voiceHistory;
  const currentMediaItems = partitioned.currentItems;
  let derivedMediaStatus = deriveMediaStatusFromItems(currentMediaItems, row.media_status || "pending");
  const profileReviewForMedia = normalizeProfileReviewStatus(row);
  if (profileReviewForMedia === "approved") {
    derivedMediaStatus = "approved";
  }

  const completed = related.orders.filter((o) => o.status === "completed").length;
  const cancelled = related.orders.filter((o) => o.status === "cancelled").length;
  const refunded = related.orders.filter((o) => /refund/i.test(String(o.status || ""))).length;
  const totalIncome = related.income.reduce((n, row) => n + money(row.amount), 0);
  const reviewList = (related.reviews || []).filter((r) => !r.status || r.status === "published" || r.status === "显示中");
  const reviewRatings = reviewList.map((r) => Number(r.rating) || 0).filter((n) => n >= 1 && n <= 5);
  const reviewCount = reviewRatings.length;
  const avgRating = reviewCount ? Math.round((reviewRatings.reduce((n, v) => n + v, 0) / reviewCount) * 10) / 10 : 0;
  const goodReviewCount = reviewRatings.filter((n) => n >= 4).length;

  const relatedForAuth = { identity, deposit };
  const base = mapListPlayer(
    {
      ...row,
      identity_status: identity?.status || row.verification_status,
      media_status: derivedMediaStatus,
    },
    profile,
    relatedForAuth
  );
  const authMode = base.authMode || resolveAuthMode(row, relatedForAuth);
  const profileReviewStatus = base.profile_review_status || normalizeProfileReviewStatus(row);

  // Real DB sync: once overall profile review is approved, current media must not stay pending.
  if (profileReviewStatus === "approved") {
    const toApprove = currentMediaItems.filter((m) => {
      const st = String(m.status || "").toLowerCase();
      return m.id && !/approved|verified/.test(st);
    });
    for (const item of toApprove) {
      try {
        await companionDb("companion_media", `?id=eq.${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "approved",
            reject_reason: "",
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
        item.status = "approved";
        item.statusLabel = labelStatus("approved");
      } catch {
        /* best effort */
      }
    }
    if (String(row.media_status || "").toLowerCase() !== "approved") {
      try {
        await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ media_status: "approved", media_reject_reason: "", updated_at: new Date().toISOString() }),
        });
        row.media_status = "approved";
      } catch {
        /* best effort */
      }
    }
    derivedMediaStatus = "approved";
  }

  const markApprovedIfNeeded = (item) => {
    if (!item) return item;
    if (profileReviewStatus === "approved") {
      return { ...item, status: "approved", statusLabel: labelStatus("approved") };
    }
    return item;
  };
  const galleryOut = gallery.map(markApprovedIfNeeded);
  const voicesOut = voices.map(markApprovedIfNeeded);
  const voiceHistoryOut = voiceHistory.map((v) => ({ ...v, isHistory: true }));
  const avatarOut = markApprovedIfNeeded(avatarMedia);
  const coverOut = markApprovedIfNeeded(coverMedia);

  const cardImageResolved =
    (coverOut && coverOut.url) ||
    (await resolveStoredMediaUrl(row.card_image_url)) ||
    "";
  const avatarResolved =
    (avatarOut && avatarOut.url) ||
    (await resolveStoredMediaUrl(profile.avatar_url)) ||
    cardImageResolved ||
    "";

  const detailBase = {
    ...base,
    media_status: derivedMediaStatus,
    mediaStatus: labelStatus(derivedMediaStatus),
    authMode,
    auth_mode: authMode,
    authModeLabel: authModeLabelOf(authMode),
    age: row.age ?? "",
    gender: row.gender || "",
    region: row.region || "",
    description: row.description || "",
    contact_phone: row.contact_phone || profile.phone || "",
    voice_url: row.voice_url || "",
    card_image_url: cardImageResolved || row.card_image_url || "",
    level_effective_at: row.level_effective_at || "",
    commission_effective_at: row.commission_effective_at || "",
    application: {
      submittedAt: row.application_submitted_at || "",
      mainService: row.main_service || "",
      mainGame: row.game || "",
      gameRank: row.game_rank || "",
      position: row.position || "",
      voiceType: row.voice_type || "",
      schedule: row.schedule || "",
      note: row.application_note || "",
      authMode,
      authModeLabel: authModeLabelOf(authMode),
      status: profileReviewStatus,
      statusLabel: labelProfileReviewStatus(profileReviewStatus),
      rejectReason: row.application_reject_reason || "",
      empty: !row.application_submitted_at && !row.main_service && !row.game,
    },
    identity: identity
      ? {
          realName: identity.real_name || "",
          identityNoMasked: maskIdentityNo(identity.identity_no),
          identityNoFull: revealId ? identity.identity_no || "" : "",
          hasIdentityNo: !!identity.identity_no,
          idFrontUrl,
          idBackUrl,
          idHandheldUrl,
          id_front_path: identity.id_front_path || "",
          id_back_path: identity.id_back_path || "",
          hasFront: !!identity.id_front_path,
          hasBack: !!identity.id_back_path,
          hasHandheld: !!identity.id_handheld_path,
          submittedAt: identity.submitted_at || identity.created_at,
          status: identity.status,
          statusLabel: labelStatus(identity.status),
          reviewedBy: identity.reviewed_by || "",
          reviewedAt: identity.reviewed_at || "",
          rejectReason: identity.reject_reason || "",
          empty: false,
        }
      : {
          empty: true,
          status: "unverified",
          statusLabel: "尚未上传身份证",
          hasFront: false,
          hasBack: false,
          hasHandheld: false,
          hasIdentityNo: false,
        },
    payment: payment
      ? {
          method: payment.method || "",
          bankName: payment.bank_name || "",
          accountName: payment.account_name || "",
          bankAccountMasked: maskBankAccount(payment.bank_account),
          bankAccountFull: revealBank ? payment.bank_account || "" : "",
          hasBankAccount: !!payment.bank_account,
          tngAccount: revealBank ? payment.tng_account || "" : maskBankAccount(payment.tng_account),
          tngAccountFull: revealBank ? payment.tng_account || "" : "",
          alipayAccount: revealBank ? payment.alipay_account || "" : maskBankAccount(payment.alipay_account),
          alipayAccountFull: revealBank ? payment.alipay_account || "" : "",
          submittedAt: payment.submitted_at || payment.created_at,
          status: payment.status,
          statusLabel: labelStatus(payment.status),
          rejectReason: payment.reject_reason || "",
          empty: false,
        }
      : { empty: true, statusLabel: "尚未填写结款账户" },
    media: {
      avatarUrl: avatarResolved,
      coverUrl: cardImageResolved,
      avatar: avatarOut
        ? {
            id: avatarOut.id,
            url: avatarOut.url,
            status: avatarOut.status,
            statusLabel: avatarOut.statusLabel,
            uploadedAt: avatarOut.uploadedAt,
          }
        : null,
      cover: coverOut
        ? {
            id: coverOut.id,
            url: coverOut.url,
            status: coverOut.status,
            statusLabel: coverOut.statusLabel,
            uploadedAt: coverOut.uploadedAt,
          }
        : null,
      gallery: galleryOut,
      voices: voicesOut,
      voiceHistory: voiceHistoryOut,
      status: derivedMediaStatus,
      statusLabel: labelStatus(derivedMediaStatus),
      rejectReason: row.media_reject_reason || "",
      empty:
        !avatarOut &&
        !coverOut &&
        !galleryOut.length &&
        !voicesOut.length &&
        !cardImageResolved &&
        !row.voice_url,
    },
    deposit: deposit
      ? {
          requiredAmount: deposit.required_amount,
          paidAmount: deposit.paid_amount,
          paidAt: deposit.paid_at || "",
          paymentMethod: deposit.payment_method || "",
          proofUrl,
          proof_path: deposit.proof_path || "",
          hasProof: !!deposit.proof_path,
          status: deposit.status,
          statusLabel: labelStatus(deposit.status),
          refundStatus: deposit.refund_status || "none",
          refundStatusLabel: labelStatus(deposit.refund_status || "none", "无"),
          rejectReason: deposit.reject_reason || "",
          remark: deposit.remark || "",
          empty: false,
        }
      : {
          empty: true,
          statusLabel: "尚未缴纳押金",
          requiredAmount: 100,
          paidAmount: 0,
          hasProof: false,
        },
    authMaterials: {
      authMode,
      authModeLabel: authModeLabelOf(authMode),
      idFrontUrl: idFrontUrl || "",
      idBackUrl: idBackUrl || "",
      depositProofUrl: proofUrl || "",
    },
    stats: {
      totalOrders: related.orders.length,
      completedOrders: completed,
      cancelledOrders: cancelled,
      refundOrders: refunded,
      totalIncome,
      withdrawable: totalIncome,
      withdrawn: 0,
      rating: avgRating,
      reviewCount,
      goodReviewCount,
      goodRate: reviewCount ? Math.round((goodReviewCount / reviewCount) * 1000) / 10 : 0,
    },
    rating: avgRating,
    reviewCount,
    goodReviewCount,
    recentOrders: related.orders.slice(0, 10).map((o) => ({
      id: o.id,
      orderNo: o.order_no || o.id,
      game: o.game || "",
      amount: o.total_amount,
      status: o.status,
      createdAt: o.created_at,
    })),
    incomeRows: related.income.slice(0, 20).map((t) => ({
      id: t.id,
      type: t.transaction_type || "companion_income",
      amount: t.amount,
      status: t.status,
      createdAt: t.created_at,
      note: t.note || "",
    })),
    reviews: reviewList.slice(0, 30).map((r) => ({
      id: r.id,
      orderId: r.order_id || "",
      rating: Number(r.rating) || 0,
      content: r.content || "",
      status: r.status || "published",
      createdAt: r.created_at || "",
    })),
    schemaReady: true,
  };

  const mediaExtrasForGate = {
    avatarUrl: (avatarOut && avatarOut.url) || "",
    voiceUrl: (voicesOut[0] && voicesOut[0].url) || row.voice_url || "",
    gallery: galleryOut.map((g) => ({ id: g.id, url: g.url })),
  };
  const publishGate = evaluatePublishGate(row, profile, mediaExtrasForGate);
  const blockedReason = listingBlockReason(publishGate);
  const listingDiag = {
    applicationStatus: row.application_status || "",
    verificationStatus: row.verification_status || "",
    canWork: !!publishGate.canWork,
    allowOrders: row.allow_orders !== false,
    accountStatus: profile?.status || "",
    publicStatus: publishGate.statusLabel,
    hallVisible: !!publishGate.hallVisible,
    inCompanionHall: !!publishGate.hallVisible,
    blockReason: blockedReason || (publishGate.hallVisible ? "" : "未进入公开列表"),
    softMissing: publishGate.softMissing || [],
    criticalMissing: publishGate.criticalMissing || [],
    listingSyncedAt: row.listing_synced_at || row.updated_at || row.created_at || "",
  };
  let certTags = [];
  let certTagIds = [];
  let certTagCatalog = [];
  try {
    const [assignMap, catalog] = await Promise.all([
      resolveCertTagsForProfiles([row.id]),
      readCertTags(),
    ]);
    certTags = assignMap[row.id] || [];
    certTagIds = certTags.map((t) => t.id);
    certTagCatalog = (catalog || []).map(toPublicCertTag);
  } catch (err) {
    console.warn("[admin/players] cert tags load failed", err?.message || err);
  }

  return {
    ...detailBase,
    publishGate,
    publishStatus: publishGate.statusLabel,
    publishReady: publishGate.publishReady,
    profileComplete: publishGate.criticalComplete,
    publishMissing: [
      ...(publishGate.blockReasons || []),
      ...(publishGate.criticalMissing || []),
    ],
    softMissing: publishGate.softMissing || [],
    canWork: !!publishGate.canWork,
    hallVisible: !!publishGate.hallVisible,
    inCompanionHall: !!publishGate.hallVisible,
    listingBlockReason: listingDiag.blockReason,
    listingSyncedAt: listingDiag.listingSyncedAt,
    listingDiag,
    certTags,
    certTagIds,
    certTagCatalog,
  };
}

async function getCompanion(id) {
  const rows = await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows?.[0] || null;
}

async function getProfile(userId) {
  if (!userId) return {};
  const rows = await companionDb("profiles", `?id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows?.[0] || {};
}

function companionEditablePatch(payload = {}) {
  const patch = { updated_at: new Date().toISOString() };
  if (payload.nickname != null) patch.nickname = String(payload.nickname || "").trim();
  if (payload.contact_phone != null || payload.phone != null || payload.contactPhone != null) {
    patch.contact_phone = String(payload.contact_phone || payload.phone || payload.contactPhone || "").trim();
  }
  if (payload.mainService != null || payload.main_service != null) {
    patch.main_service = String(payload.mainService || payload.main_service || "").trim();
  }
  if (payload.mainGame != null || payload.game != null) {
    patch.game = String(payload.mainGame || payload.game || "").trim();
  }
  if (payload.tags != null) patch.tags = String(payload.tags || "").trim();
  if (payload.voiceType != null || payload.voice_type != null) {
    patch.voice_type = String(payload.voiceType || payload.voice_type || "").trim();
  }
  if (payload.gender != null) patch.gender = String(payload.gender || "").trim();
  if (payload.age != null && payload.age !== "") {
    const ageNum = Number(payload.age);
    if (Number.isFinite(ageNum)) patch.age = ageNum;
  }
  if (payload.region != null) patch.region = String(payload.region || "").trim();
  if (payload.description != null || payload.desc != null || payload.bio != null) {
    patch.description = String(payload.description || payload.desc || payload.bio || "").trim();
  }
  if (payload.levelId != null || payload.level_id != null) {
    patch.level_id = String(payload.levelId || payload.level_id || "").trim();
  }
  if (payload.levelName != null || payload.level_name != null) {
    patch.level_name = String(payload.levelName || payload.level_name || "").trim();
  }
  if (payload.price != null) patch.price = money(payload.price);
  const orderRate = percent(payload.orderCommissionRate ?? payload.commission_rate);
  if (orderRate !== undefined) patch.commission_rate = orderRate;
  const giftRate = percent(payload.giftCommissionRate ?? payload.gift_commission_rate);
  if (giftRate !== undefined) patch.gift_commission_rate = giftRate;
  const rebate = percent(payload.directRebateRate ?? payload.direct_rebate_rate);
  if (rebate !== undefined) patch.direct_rebate_rate = rebate;
  if (payload.featured != null) patch.featured = bool(payload.featured, false);
  const focalX = payload.objectPositionX ?? payload.object_position_x;
  const focalY = payload.objectPositionY ?? payload.object_position_y;
  const coverFit = payload.coverFit ?? payload.cover_fit;
  if (focalX != null || focalY != null || coverFit != null) {
    const x = Math.max(0, Math.min(100, Number(focalX != null ? focalX : 50)));
    const y = Math.max(0, Math.min(100, Number(focalY != null ? focalY : 25)));
    const fit = String(coverFit || "cover").toLowerCase() === "contain" ? "contain" : "cover";
    // Prefer dedicated columns when available; tags marker is a portable fallback.
    patch.object_position_x = x;
    patch.object_position_y = y;
    patch.cover_fit = fit;
    if (payload.tags != null) {
      const baseTags = String(payload.tags || "").replace(/\[\[MCJ_FOCAL:[^\]]*\]\]/gi, "").trim();
      patch.tags = (baseTags ? baseTags + " " : "") + "[[MCJ_FOCAL:" + x + "," + y + "," + fit + "]]";
    }
  }
  if (payload.allowOrders != null || payload.allow_orders != null) {
    patch.allow_orders = bool(payload.allowOrders ?? payload.allow_orders, true);
  }
  if (payload.depositStatus != null) patch.deposit_status = normalizeStatusInput(payload.depositStatus, "pending");
  if (payload.auditStatus != null || payload.applicationStatus != null) {
    patch.application_status = normalizeStatusInput(payload.auditStatus || payload.applicationStatus, "pending");
    patch.verification_status = patch.application_status === "approved" ? "approved" : patch.application_status;
    if (patch.application_status === "approved") {
      patch.allow_orders = true;
    } else if (/rejected|resubmit|archived|deleted/.test(String(patch.application_status))) {
      patch.allow_orders = false;
      patch.online_status = "offline";
    }
  }
  if (payload.rejectReason != null || payload.applicationRejectReason != null) {
    patch.application_reject_reason = String(payload.rejectReason || payload.applicationRejectReason || "");
  }
  if (payload.onlineStatus === "paused" || payload.accountStatus === "暂停接单") {
    patch.online_status = "paused";
    patch.allow_orders = false;
  }
  return patch;
}

function profileEditablePatch(payload = {}) {
  const patch = {};
  if (payload.nickname != null) patch.display_name = String(payload.nickname || "").trim();
  if (payload.phone != null || payload.contact_phone != null || payload.contactPhone != null) {
    patch.phone = String(payload.phone || payload.contact_phone || payload.contactPhone || "").trim();
  }
  if (payload.accountStatus != null) {
    const status = normalizeStatusInput(payload.accountStatus, "active");
    if (status === "disabled" || status === "paused") patch.status = status === "paused" ? "active" : "disabled";
    else if (status === "active" || status === "pending") patch.status = status;
    else if (/正常|启用/.test(String(payload.accountStatus))) patch.status = "active";
    else if (/冻结|封禁|停用/.test(String(payload.accountStatus))) patch.status = "disabled";
  }
  return patch;
}

async function listPlayers(scope = "formal") {
  const [companions, profiles] = await Promise.all([
    companionDb(PLAYER_TABLE, "?order=updated_at.desc,created_at.desc&limit=500"),
    companionDb("profiles", "?role=eq.companion&limit=800").catch(() => []),
  ]);
  const profileMap = (Array.isArray(profiles) ? profiles : []).reduce((m, p) => {
    m[p.id] = p;
    return m;
  }, {});
  let companionRows = Array.isArray(companions) ? companions : [];

  // Best-effort: mark legacy never-submitted rows as draft + purge expired drafts.
  const cleanupStats = await cleanupCompanionDrafts(companionRows, profileMap).catch(() => ({
    migrated: 0,
    archived: 0,
  }));
  if (cleanupStats.migrated || cleanupStats.archived) {
    companionRows = await companionDb(PLAYER_TABLE, "?order=updated_at.desc,created_at.desc&limit=500").catch(
      () => companionRows
    );
    companionRows = Array.isArray(companionRows) ? companionRows : [];
  }

  const scopeKey = String(scope || "formal").trim().toLowerCase();
  if (scopeKey === "drafts" || scopeKey === "draft") {
    companionRows = companionRows.filter((row) => isApplicationDraft(row) && !isApplicationArchivedSafe(row));
  } else if (scopeKey === "applications" || scopeKey === "application" || scopeKey === "queue") {
    companionRows = companionRows.filter((row) => isApplicationQueueRow(row));
  } else if (scopeKey === "all") {
    /* keep all for debug */
  } else {
    // Default formal 陪玩管理: approved only
    companionRows = companionRows.filter((row) => isFormalCompanion(row));
  }

  const depositMap = {};
  const ids = companionRows.map((r) => r.id).filter(Boolean);
  if (ids.length) {
    // PostgREST `in` batches — chunk to keep URL length safe.
    const chunkSize = 80;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const filter = chunk.map((id) => `"${id}"`).join(",");
      const depositRows = await companionDb(
        "companion_deposits",
        `?companion_profile_id=in.(${filter})&order=created_at.desc&select=id,companion_profile_id,status,reject_reason,paid_amount,required_amount,proof_path,created_at`
      ).catch((e) => {
        if (isMissingRelation(e)) return [];
        return [];
      });
      for (const d of Array.isArray(depositRows) ? depositRows : []) {
        const key = d.companion_profile_id;
        if (key && !depositMap[key]) depositMap[key] = d;
      }
    }
  }
  return companionRows.map((row) =>
    mapListPlayer(row, profileMap[row.user_id] || {}, { deposit: depositMap[row.id] || null })
  );
}

function isApplicationArchivedSafe(row = {}) {
  return /^(archived|deleted)$/.test(normalizeApplicationStatus(row));
}

/**
 * Migrate legacy never-submitted pending → draft;
 * archive drafts older than 30 days (disable profile);
 * archive draft rows whose nickname already has a formal companion.
 */
async function cleanupCompanionDrafts(rows = [], profileMap = {}) {
  let migrated = 0;
  let archived = 0;
  const now = new Date().toISOString();
  const formalByNick = new Map();
  for (const row of rows) {
    if (!isFormalCompanion(row)) continue;
    const nick = String(row.nickname || "").trim().toLowerCase();
    if (nick) formalByNick.set(nick, row);
  }
  for (const row of rows) {
    if (!row?.id) continue;
    const st = normalizeApplicationStatus(row);
    const submitted = row.application_submitted_at;
    // Legacy register rows: pending/empty without submit → draft
    if (!submitted && !/^(draft|archived|deleted|approved|verified|passed|rejected|resubmit|need_more)$/.test(st)) {
      try {
        await patchCompanionRow(row.id, { application_status: "draft", updated_at: now });
        row.application_status = "draft";
        migrated += 1;
      } catch {
        /* best effort */
      }
    }
    const nick = String(row.nickname || "").trim().toLowerCase();
    const formalTwin = nick && formalByNick.get(nick);
    const shouldArchiveDup = formalTwin && formalTwin.id !== row.id && isApplicationDraft(row);
    const shouldExpire = isExpiredDraft(row, DRAFT_TTL_MS);
    const shouldArchiveDraftNick = /^草稿保留/i.test(String(row.nickname || "")) && isFormalCompanion(row);
    if (shouldArchiveDup || shouldExpire || shouldArchiveDraftNick) {
      try {
        await patchCompanionRow(row.id, {
          application_status: "archived",
          online_status: "offline",
          allow_orders: false,
          updated_at: now,
        });
        row.application_status = "archived";
        if (row.user_id) {
          await companionDb("profiles", `?id=eq.${encodeURIComponent(row.user_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "disabled", updated_at: now }),
          }).catch(() => null);
          if (profileMap[row.user_id]) profileMap[row.user_id].status = "disabled";
        }
        archived += 1;
      } catch {
        /* best effort */
      }
    }
  }
  return { migrated, archived };
}

async function assertNoDuplicateFormalIdentity(companion, profile) {
  const email = String(profile?.email || "").trim().toLowerCase();
  const phone = String(companion?.contact_phone || profile?.phone || profile?.phone_e164 || "")
    .trim()
    .replace(/\s+/g, "");
  if (!email && !phone) return;

  const others = await companionDb(PLAYER_TABLE, "?select=id,user_id,application_status,contact_phone&limit=800").catch(() => []);
  const otherRows = (Array.isArray(others) ? others : []).filter((r) => r.id && r.id !== companion.id && isFormalCompanion(r));
  if (!otherRows.length) return;

  const userIds = [...new Set(otherRows.map((r) => r.user_id).filter(Boolean))];
  const profileChunks = [];
  for (let i = 0; i < userIds.length; i += 80) {
    const chunk = userIds.slice(i, i + 80);
    const filter = chunk.map((id) => `"${id}"`).join(",");
    const rows = await companionDb("profiles", `?id=in.(${filter})&select=id,email,phone,phone_e164`).catch(() => []);
    profileChunks.push(...(Array.isArray(rows) ? rows : []));
  }
  const otherProfiles = Object.fromEntries(profileChunks.map((p) => [p.id, p]));

  for (const row of otherRows) {
    const p = otherProfiles[row.user_id] || {};
    const otherEmail = String(p.email || "").trim().toLowerCase();
    const otherPhone = String(row.contact_phone || p.phone || p.phone_e164 || "")
      .trim()
      .replace(/\s+/g, "");
    if (email && otherEmail && email === otherEmail) {
      throw Object.assign(new Error("该邮箱已存在正式陪玩，不能重复审核通过。"), { status: 409 });
    }
    if (phone && otherPhone && phone === otherPhone) {
      throw Object.assign(new Error("该手机号已存在正式陪玩，不能重复审核通过。"), { status: 409 });
    }
  }
}

/** After approve: archive any leftover draft rows sharing email/phone/nickname (should be rare). */
async function archiveSiblingDrafts(companion, profile) {
  const email = String(profile?.email || "").trim().toLowerCase();
  const phone = String(companion?.contact_phone || profile?.phone || "")
    .trim()
    .replace(/\s+/g, "");
  const nick = String(companion?.nickname || profile?.display_name || "")
    .trim()
    .toLowerCase();
  if (!email && !phone && !nick) return 0;
  const all = await companionDb(PLAYER_TABLE, "?select=id,user_id,application_status,contact_phone,nickname,application_submitted_at&limit=800").catch(
    () => []
  );
  const drafts = (Array.isArray(all) ? all : []).filter((r) => r.id !== companion.id && isApplicationDraft(r));
  if (!drafts.length) return 0;
  const userIds = [...new Set(drafts.map((r) => r.user_id).filter(Boolean))];
  const profiles = [];
  for (let i = 0; i < userIds.length; i += 80) {
    const chunk = userIds.slice(i, i + 80);
    const filter = chunk.map((id) => `"${id}"`).join(",");
    const rows = await companionDb("profiles", `?id=in.(${filter})&select=id,email,phone,phone_e164`).catch(() => []);
    profiles.push(...(Array.isArray(rows) ? rows : []));
  }
  const pmap = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const now = new Date().toISOString();
  let n = 0;
  for (const row of drafts) {
    const p = pmap[row.user_id] || {};
    const otherEmail = String(p.email || "").trim().toLowerCase();
    const otherPhone = String(row.contact_phone || p.phone || p.phone_e164 || "")
      .trim()
      .replace(/\s+/g, "");
    const otherNick = String(row.nickname || "").trim().toLowerCase();
    const match =
      (email && otherEmail && email === otherEmail) ||
      (phone && otherPhone && phone === otherPhone) ||
      (nick && otherNick && nick === otherNick);
    if (!match) continue;
    try {
      await patchCompanionRow(row.id, {
        application_status: "archived",
        online_status: "offline",
        allow_orders: false,
        updated_at: now,
      });
      if (row.user_id) {
        await companionDb("profiles", `?id=eq.${encodeURIComponent(row.user_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "disabled", updated_at: now }),
        }).catch(() => null);
      }
      n += 1;
    } catch {
      /* best effort */
    }
  }
  return n;
}

async function reviewIdentity(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.identityStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回身份认证时必须填写原因。"), { status: 400 });
  }
  const rows = await companionDb(
    "companion_identity_verifications",
    `?companion_profile_id=eq.${encodeURIComponent(companion.id)}`
  ).catch((e) => {
    if (isMissingRelation(e)) throw Object.assign(new Error("请先执行 supabase/companion-admin-data.sql"), { status: 503 });
    throw e;
  });
  const before = rows?.[0];
  if (!before) throw Object.assign(new Error("该陪玩尚未上传身份证资料。"), { status: 404 });
  const after = await companionDb("companion_identity_verifications", `?id=eq.${encodeURIComponent(before.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      reject_reason: reason,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companion.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      verification_status: status === "approved" ? "approved" : status,
      updated_at: new Date().toISOString(),
    }),
  });
  await logOperation(req, "review_identity", companion.id, before, after?.[0] || { status, reason }, reason);
  if (companion.user_id && !payload._silentNotify && !/申请审核通过自动认证|申请审核/.test(reason)) {
    await notifyCompanionReviewResult(companion.user_id, { status, reason, kind: "identity" });
  }
  return after?.[0];
}

async function reviewPayment(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.paymentStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回结款账户时必须填写原因。"), { status: 400 });
  }
  const rows = await companionDb(
    "companion_payment_accounts",
    `?companion_profile_id=eq.${encodeURIComponent(companion.id)}`
  ).catch((e) => {
    if (isMissingRelation(e)) throw Object.assign(new Error("请先执行 supabase/companion-admin-data.sql"), { status: 503 });
    throw e;
  });
  const before = rows?.[0];
  if (!before) throw Object.assign(new Error("该陪玩尚未填写结款账户。"), { status: 404 });
  const after = await companionDb("companion_payment_accounts", `?id=eq.${encodeURIComponent(before.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      reject_reason: reason,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  await logOperation(req, "review_payment", companion.id, before, after?.[0] || { status, reason }, reason);
  if (companion.user_id && !payload._silentNotify && !/申请审核通过自动认证|申请审核/.test(reason)) {
    await notifyCompanionReviewResult(companion.user_id, { status, reason, kind: "payment" });
  }
  return after?.[0];
}

async function deriveMediaAggregateStatus(companionId) {
  const rows = await companionDb(
    "companion_media",
    `?companion_profile_id=eq.${encodeURIComponent(companionId)}&select=id,status,media_type,storage_path,sort_order,uploaded_at,created_at`
  ).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const signedLike = list.map((item) => ({
    id: item.id,
    mediaType: item.media_type,
    status: item.status,
    storagePath: item.storage_path || "",
    sortOrder: item.sort_order,
    uploadedAt: item.uploaded_at || item.created_at,
  }));
  const { currentItems } = partitionCompanionMedia(signedLike);
  return deriveMediaStatusFromItems(currentItems, "pending");
}

async function approveAllCurrentMedia(companionId) {
  const rows = await companionDb(
    "companion_media",
    `?companion_profile_id=eq.${encodeURIComponent(companionId)}&select=id,status,media_type,storage_path,sort_order,uploaded_at,created_at`
  ).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ media_status: "approved", media_reject_reason: "", updated_at: new Date().toISOString() }),
    }).catch(() => null);
    return { status: "approved", count: 0 };
  }
  const signedLike = list.map((item) => ({
    id: item.id,
    mediaType: item.media_type,
    status: item.status,
    storagePath: item.storage_path || "",
    sortOrder: item.sort_order,
    uploadedAt: item.uploaded_at || item.created_at,
  }));
  const { currentItems } = partitionCompanionMedia(signedLike);
  for (const item of currentItems) {
    if (!item.id) continue;
    await companionDb("companion_media", `?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "approved",
        reject_reason: "",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  }
  await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ media_status: "approved", media_reject_reason: "", updated_at: new Date().toISOString() }),
  });
  return { status: "approved", count: currentItems.length };
}

async function reviewMedia(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.mediaStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回头像/相册/语音时必须填写原因。"), { status: 400 });
  }
  const mediaId = String(payload.mediaId || "").trim();
  let aggregateStatus = status;
  if (mediaId) {
    const beforeRows = await companionDb("companion_media", `?id=eq.${encodeURIComponent(mediaId)}&limit=1`);
    const before = beforeRows?.[0];
    if (!before) throw Object.assign(new Error("媒体不存在。"), { status: 404 });
    const after = await companionDb("companion_media", `?id=eq.${encodeURIComponent(mediaId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        reject_reason: reason,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    await logOperation(req, "review_media", companion.id, before, after?.[0], reason);
    const derived = await deriveMediaAggregateStatus(companion.id);
    if (derived) aggregateStatus = derived;
  } else {
    const allRows = await companionDb(
      "companion_media",
      `?companion_profile_id=eq.${encodeURIComponent(companion.id)}&select=id`
    ).catch((e) => {
      if (isMissingRelation(e)) return [];
      throw e;
    });
    const ids = (Array.isArray(allRows) ? allRows : []).map((row) => row.id).filter(Boolean);
    for (const id of ids) {
      await companionDb("companion_media", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          reject_reason: reason,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
    }
    aggregateStatus = status;
  }
  await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companion.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      media_status: aggregateStatus,
      media_reject_reason: reason,
      updated_at: new Date().toISOString(),
    }),
  });
  await logOperation(
    req,
    "review_media_batch",
    companion.id,
    { media_status: companion.media_status },
    { status: aggregateStatus, reason, itemStatus: status, mediaId: mediaId || null },
    reason
  );
  if (companion.user_id) {
    await notifyCompanionReviewResult(companion.user_id, { status: aggregateStatus, reason, kind: "media" });
  }
  return { status: aggregateStatus, itemStatus: status, reason };
}

async function reviewDeposit(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.depositStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回押金时必须填写原因。"), { status: 400 });
  }
  const rows = await companionDb(
    "companion_deposits",
    `?companion_profile_id=eq.${encodeURIComponent(companion.id)}&order=created_at.desc&limit=1`
  ).catch((e) => {
    if (isMissingRelation(e)) throw Object.assign(new Error("请先执行 supabase/companion-admin-data.sql"), { status: 503 });
    throw e;
  });
  const before = rows?.[0];
  const mapped =
    status === "approved" ? "paid" : status === "unpaid" ? "unpaid" : status === "refunded" ? "refunded" : status;
  if (before) {
    await companionDb("companion_deposits", `?id=eq.${encodeURIComponent(before.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: mapped,
        reject_reason: reason,
        remark: String(payload.remark || payload.depositConfirmRemark || before.remark || ""),
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  }
  await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companion.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ deposit_status: mapped, updated_at: new Date().toISOString() }),
  });
  await logOperation(req, "review_deposit", companion.id, before || companion, { status: mapped, reason }, reason);
  if (companion.user_id && !payload._silentNotify && !/申请审核通过自动认证|申请审核/.test(reason)) {
    await notifyCompanionReviewResult(companion.user_id, { status: mapped, reason, kind: "deposit" });
  }
  return { status: mapped, reason };
}

async function reviewApplication(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.applicationStatus || payload.auditStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回或要求补资料时必须填写原因。"), { status: 400 });
  }
  if (isApplicationDraft(companion) && status === "approved" && !companion.application_submitted_at) {
    throw Object.assign(new Error("申请草稿尚未正式提交，不能直接审核通过。请申请人先提交审核。"), { status: 400 });
  }
  let profileForIdentity = null;
  if (status === "approved" && companion.user_id) {
    profileForIdentity = await getProfile(companion.user_id);
    await assertNoDuplicateFormalIdentity(companion, profileForIdentity);
  }
  // Unified publish rule: approve → auto list; reject/resubmit → auto unlist.
  // Content fields: only apply non-blank admin values; never wipe existing profile with ""/0.
  let patch;
  if (status === "approved") {
    const allowOverride =
      payload.allowOrders != null || payload.allow_orders != null
        ? bool(payload.allowOrders ?? payload.allow_orders, true)
        : true;
    const contentExtras = {
      allow_orders: allowOverride,
      application_reject_reason: "",
    };
    const levelIdRaw = payload.levelId ?? payload.level_id;
    const levelNameRaw = payload.levelName ?? payload.level_name;
    if (levelIdRaw != null && String(levelIdRaw).trim()) {
      contentExtras.level_id = String(levelIdRaw).trim();
    }
    if (levelNameRaw != null && String(levelNameRaw).trim()) {
      contentExtras.level_name = String(levelNameRaw).trim();
    }
    Object.assign(contentExtras, ensureDefaultLevelPatch({ ...companion, ...contentExtras }));
    const orderRate = percent(payload.orderCommissionRate ?? payload.commission_rate ?? payload.commissionRate);
    if (orderRate !== undefined) contentExtras.commission_rate = orderRate;
    const giftRate = percent(payload.giftCommissionRate ?? payload.gift_commission_rate);
    if (giftRate !== undefined) contentExtras.gift_commission_rate = giftRate;
    const rebate = percent(payload.directRebateRate ?? payload.direct_rebate_rate);
    if (rebate !== undefined) contentExtras.direct_rebate_rate = rebate;
    if (payload.price != null && payload.price !== "" && Number(payload.price) > 0) {
      contentExtras.price = money(payload.price);
    }
    if (payload.minPrice != null || payload.price_min != null) {
      const minP = money(payload.minPrice ?? payload.price_min);
      if (minP > 0) contentExtras.price_min = minP;
    }
    if (payload.maxPrice != null || payload.price_max != null) {
      const maxP = money(payload.maxPrice ?? payload.price_max);
      if (maxP > 0) contentExtras.price_max = maxP;
    }
    if (!companion.companion_code) {
      try {
        const code = await allocateCompanionCode();
        if (code) contentExtras.companion_code = code;
      } catch {
        /* best effort: admin can retry review to assign code */
      }
    }
    patch = approveListingPatchForRow(companion, preserveExistingContent(companion, contentExtras));
  } else if (status === "rejected" || status === "resubmit") {
    patch = unlistListingPatch({ status, reason });
  } else {
    patch = {
      application_status: status,
      application_reject_reason: reason,
      updated_at: new Date().toISOString(),
    };
  }
  const after = await patchCompanionRow(companion.id, patch);
  if (status === "approved" && companion.user_id) {
    try {
      await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
        method: "PATCH",
        body: JSON.stringify(activeCompanionProfilePatch()),
      });
    } catch {
      /* best effort: register already creates companion profile */
    }
    try {
      await archiveSiblingDrafts(companion, profileForIdentity || (await getProfile(companion.user_id)));
    } catch (err) {
      console.warn("[admin/players] archive sibling drafts on approve:", err?.message || err);
    }
  }
  // XOR：申请通过时自动通过所选认证方式，解锁 canWork / 大厅
  if (status === "approved") {
    let related = { identity: null, deposit: null };
    try {
      related = await loadRelated(companion.user_id, companion.id);
    } catch {
      related = { identity: null, deposit: null };
    }
    const authMode = resolveAuthMode(after?.[0] || companion, related);
    if (authMode === "id_card") {
      try {
        await reviewIdentity(req, companion, { status: "approved", reason: reason || "申请审核通过自动认证", _silentNotify: true });
      } catch (err) {
        console.warn("[admin/players] auto review_identity on application approve:", err?.message || err);
      }
      try {
        await reviewPayment(req, companion, { status: "approved", reason: reason || "申请审核通过自动认证", _silentNotify: true });
      } catch (err) {
        console.warn("[admin/players] auto review_payment on application approve:", err?.message || err);
      }
    } else if (authMode === "deposit") {
      try {
        await reviewDeposit(req, companion, { status: "approved", reason: reason || "申请审核通过自动认证", _silentNotify: true });
      } catch (err) {
        console.warn("[admin/players] auto review_deposit on application approve:", err?.message || err);
      }
    }
    try {
      await approveAllCurrentMedia(companion.id);
    } catch (err) {
      console.warn("[admin/players] auto approve media on application approve:", err?.message || err);
    }
  }
  if (status === "rejected" || status === "resubmit") {
    try {
      await reviewIdentity(req, companion, { status, reason, _silentNotify: true });
    } catch (err) {
      console.warn("[admin/players] cascade review_identity on application reject:", err?.message || err);
    }
    try {
      await reviewPayment(req, companion, { status, reason, _silentNotify: true });
    } catch (err) {
      console.warn("[admin/players] cascade review_payment on application reject:", err?.message || err);
    }
  }
  await logOperation(req, "review_application", companion.id, companion, after?.[0], reason);
  let reviewNotify = null;
  if (companion.user_id) {
    const profileForMail = profileForIdentity || (await getProfile(companion.user_id).catch(() => null));
    reviewNotify = await notifyCompanionReviewResult(companion.user_id, {
      status,
      reason,
      kind: "application",
      applicationId: companion.id,
      email: profileForMail?.email || "",
    });
  }
  const result = after?.[0] || null;
  if (result && reviewNotify && typeof reviewNotify === "object") {
    result._notify = {
      emailStatus: reviewNotify.emailStatus || "",
      emailPending: !!reviewNotify.emailPending,
      inboxKey: reviewNotify.inboxKey || null,
    };
  }
  return result;
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);
  } catch (error) {
    const status = error.status || 403;
    const message =
      status === 401
        ? "请先登录管理员账号。"
        : "资料暂时无法加载，请稍后再试。";
    return json(res, status, { ok: false, message, code: error.code || (status === 401 ? "UNAUTHORIZED" : "NO_PLAYER_ADMIN") });
  }

  if (!hasCompanionDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      players: [],
      message: "未配置 Supabase，陪玩管理不返回模拟数据。",
      migration: "supabase/companion-admin-data.sql",
    });
  }

  try {
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (id) {
        const companion = await getCompanion(id);
        if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
        const profile = await getProfile(companion.user_id);
        try {
          const detail = await buildDetail(companion, profile);
          return json(res, 200, { ok: true, configured: true, player: detail, detail });
        } catch (error) {
          if (isMissingRelation(error)) {
            return json(res, 503, {
              ok: false,
              message: "陪玩扩展表未初始化。请执行 supabase/companion-admin-data.sql 后重试。",
              player: mapListPlayer(companion, profile),
            });
          }
          throw error;
        }
      }
      const players = await listPlayers(String(req.query?.scope || req.query?.list || "formal").trim());
      return json(res, 200, { ok: true, configured: true, players, table: PLAYER_TABLE, scope: String(req.query?.scope || "formal") });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method Not Allowed" });
    const body = await parseBody(req);
    const action = String(body.action || "edit").trim();
    const id = String(body.id || "").trim();
    if (!id && action !== "list") return json(res, 400, { ok: false, message: "缺少陪玩 ID" });

    if (action === "detail" || action === "get") {
      const companion = await getCompanion(id);
      if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
      const profile = await getProfile(companion.user_id);
      const detail = await buildDetail(companion, profile, {
        revealId: !!body.revealId,
        revealBank: !!body.revealBank,
      });
      return json(res, 200, { ok: true, player: detail, detail });
    }

    const companion = await getCompanion(id);
    if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
    const payload = body.payload || body || {};

    if (action === "reveal_identity_no") {
      const related = await loadRelated(companion.user_id, companion.id);
      if (!related.identity?.identity_no) return json(res, 404, { ok: false, message: "尚未上传身份证号码" });
      await logOperation(req, "reveal_identity_no", companion.id, { masked: true }, { revealed: true }, payload.reason || "");
      return json(res, 200, {
        ok: true,
        identityNo: related.identity.identity_no,
        message: "已记录查看完整身份证号码操作",
      });
    }

    if (action === "reveal_bank_account") {
      const related = await loadRelated(companion.user_id, companion.id);
      if (!related.payment) return json(res, 404, { ok: false, message: "尚未填写结款账户" });
      await logOperation(req, "reveal_bank_account", companion.id, { masked: true }, { revealed: true }, payload.reason || "");
      return json(res, 200, {
        ok: true,
        payment: {
          bankAccount: related.payment.bank_account || "",
          tngAccount: related.payment.tng_account || "",
          alipayAccount: related.payment.alipay_account || "",
        },
        message: "已记录查看完整银行账号操作",
      });
    }

    if (action === "view_identity_image") {
      await logOperation(req, "view_identity_image", companion.id, null, { side: payload.side || "unknown" }, payload.reason || "");
      return json(res, 200, { ok: true, message: "已记录查看身份证图片" });
    }

    if (action === "sign_media") {
      const bucket = String(payload.bucket || PRIVATE_BUCKETS.gallery);
      const objectPath = String(payload.path || payload.storage_path || "");
      const url = await createSignedUrl(bucket, objectPath, SIGN_TTL);
      if (/identity/i.test(bucket)) {
        await logOperation(req, "view_identity_image", companion.id, null, { path: objectPath }, "");
      }
      return json(res, 200, { ok: true, url, expiresIn: SIGN_TTL });
    }

    if (action === "review_identity") {
      await reviewIdentity(req, companion, payload);
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "身份认证审核已保存", player: detail });
    }
    if (action === "review_payment") {
      await reviewPayment(req, companion, payload);
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "结款账户审核已保存", player: detail });
    }
    if (action === "review_media") {
      await reviewMedia(req, companion, payload);
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "媒体审核已保存", player: detail });
    }
    if (action === "review_deposit") {
      await reviewDeposit(req, companion, payload);
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "押金审核已保存", player: detail });
    }
    if (action === "review_application") {
      const reviewed = await reviewApplication(req, companion, payload);
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      const st = String(payload.status || payload.applicationStatus || payload.auditStatus || "").toLowerCase();
      let message = "陪玩申请审核已保存";
      if (/approved|verified|passed/.test(st)) {
        const ready = detail?.publishReady || detail?.publishGate?.publishReady;
        message = ready
          ? "已通过并自动上架：首页/陪玩大厅/详情页刷新即可看到，无需手动发布。默认离线，陪玩上线后可接单。"
          : "已通过并写入公开列表条件。若仍不可见，请查看详情诊断（拦截原因）。缺口：" +
            ((detail?.listingBlockReason || detail?.publishMissing || detail?.publishGate?.missing || []).length
              ? Array.isArray(detail?.publishMissing)
                ? detail.publishMissing.join("、")
                : detail?.listingBlockReason || "见诊断"
              : "无硬拦截") +
            "。";
      } else if (/rejected/.test(st)) {
        message = "已驳回，已立即从首页/陪玩大厅隐藏，不可下单。";
      } else if (/resubmit|need_more/.test(st)) {
        message = "已要求补资料，已从大厅隐藏，待重新提交审核。";
      }
      return json(res, 200, { ok: true, message, player: detail, reviewed });
    }

    if (action === "archive_draft" || action === "delete_draft") {
      if (!isApplicationDraft(companion) && !isApplicationArchivedSafe(companion)) {
        return json(res, 400, { ok: false, message: "仅申请草稿可归档或删除。" });
      }
      const now = new Date().toISOString();
      const hardDelete = action === "delete_draft" && (payload.hard === true || payload.hardDelete === true);
      if (hardDelete) {
        await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
        if (companion.user_id) {
          await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "disabled", updated_at: now }),
          }).catch(() => null);
        }
        await logOperation(req, "delete_draft", id, companion, { deleted: true }, payload.reason || "");
        return json(res, 200, { ok: true, message: "申请草稿已删除" });
      }
      const after = await patchCompanionRow(id, {
        application_status: "archived",
        online_status: "offline",
        allow_orders: false,
        updated_at: now,
      });
      if (companion.user_id) {
        await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "disabled", updated_at: now }),
        }).catch(() => null);
      }
      await logOperation(req, "archive_draft", id, companion, after?.[0], payload.reason || "");
      return json(res, 200, { ok: true, message: "申请草稿已归档", player: mapListPlayer(after?.[0] || companion, await getProfile(companion.user_id)) });
    }

    if (action === "set_level") {
      const levelId = String(payload.levelId || payload.level_id || "").trim();
      const levelNameRaw = String(payload.levelName || payload.level_name || "").trim();
      const reason = String(payload.reason || "").trim();
      if (!levelId && !levelNameRaw) return json(res, 400, { ok: false, message: "请选择等级" });
      const meta = await resolveLevelMeta(levelId || levelNameRaw);
      const after = await patchCompanionRow(id, {
        level_id: meta?.id || levelId || levelNameRaw,
        level_name: meta?.name || levelNameRaw || levelId,
        level_effective_at: new Date().toISOString(),
        ...(meta?.commissionRate != null
          ? {
              commission_rate: resolvePlatformCommission(meta.commissionRate).platformRate,
              commission_effective_at: new Date().toISOString(),
            }
          : {}),
        ...(payload.price != null ? { price: money(payload.price) } : meta?.min != null && !(money(companion.price) > 0) ? { price: money(meta.min) } : {}),
      });
      await logOperation(
        req,
        "set_level",
        id,
        { level_id: companion.level_id, level_name: companion.level_name },
        after?.[0],
        reason
      );
      const detail = await buildDetail(after?.[0] || (await getCompanion(id)), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "等级已更新（抽成已按等级默认同步，仅影响新订单）", player: detail });
    }

    if (action === "set_commission") {
      const orderRate = percent(payload.orderCommissionRate ?? payload.commission_rate);
      const giftRate = percent(payload.giftCommissionRate ?? payload.gift_commission_rate);
      const rebate = percent(payload.directRebateRate ?? payload.direct_rebate_rate);
      const reason = String(payload.reason || "").trim();
      const patch = {
        commission_effective_at: payload.effectiveAt || new Date().toISOString(),
      };
      if (orderRate !== undefined) patch.commission_rate = resolvePlatformCommission(orderRate).platformRate;
      if (giftRate !== undefined) patch.gift_commission_rate = giftRate;
      if (rebate !== undefined) patch.direct_rebate_rate = rebate;
      const after = await patchCompanionRow(id, patch);
      await logOperation(
        req,
        "set_commission",
        id,
        {
          commission_rate: companion.commission_rate,
          gift_commission_rate: companion.gift_commission_rate,
          direct_rebate_rate: companion.direct_rebate_rate,
        },
        after?.[0],
        reason
      );
      const detail = await buildDetail(after?.[0] || (await getCompanion(id)), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "抽成与返点已更新（仅影响新订单）", player: detail });
    }

    if (action === "freeze" || action === "ban-order" || action === "disable") {
      await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          online_status: "offline",
          allow_orders: false,
          updated_at: new Date().toISOString(),
        }),
      });
      if (companion.user_id) {
        await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "disabled" }),
        });
      }
      await logOperation(req, action, id, companion, { status: "disabled" }, payload.reason || "");
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "账号已停用", player: detail });
    }

    // default save / edit / quick-edit
    const companionPatch = companionEditablePatch(payload);
    if (
      (companionPatch.object_position_x != null || companionPatch.object_position_y != null) &&
      companionPatch.tags == null
    ) {
      const x = companionPatch.object_position_x != null ? companionPatch.object_position_x : 50;
      const y = companionPatch.object_position_y != null ? companionPatch.object_position_y : 25;
      const fit = companionPatch.cover_fit || "cover";
      const baseTags = String(companion.tags || "").replace(/\[\[MCJ_FOCAL:[^\]]*\]\]/gi, "").trim();
      companionPatch.tags = (baseTags ? baseTags + " " : "") + "[[MCJ_FOCAL:" + x + "," + y + "," + fit + "]]";
    }
    if (companionPatch.commission_rate != null) {
      companionPatch.commission_rate = resolvePlatformCommission(companionPatch.commission_rate).platformRate;
    }
    if (action === "set_level" || payload.levelId || payload.level_id || companionPatch.level_id) {
      companionPatch.level_effective_at = new Date().toISOString();
      const meta = await resolveLevelMeta(companionPatch.level_id || companionPatch.level_name || payload.levelId);
      if (meta) {
        companionPatch.level_id = meta.id;
        companionPatch.level_name = meta.name;
        if (companionPatch.price == null && !(money(companion.price) > 0) && meta.min != null) {
          companionPatch.price = money(meta.min);
        }
      } else if (!companionPatch.level_name && companionPatch.level_id) {
        companionPatch.level_name = companionPatch.level_id;
      }
    }
    if (
      payload.orderCommissionRate != null ||
      payload.giftCommissionRate != null ||
      payload.directRebateRate != null
    ) {
      companionPatch.commission_effective_at = new Date().toISOString();
    }

    companionPatch.updated_at = new Date().toISOString();
    const profilePatch = profileEditablePatch(payload);
    // Ban / freeze → auto unlist; re-activate approved → restore allow_orders.
    if (profilePatch.status === "disabled") {
      companionPatch.allow_orders = false;
      companionPatch.online_status = "offline";
    } else if (profilePatch.status === "active") {
      const appSt = String(companionPatch.application_status || companion.application_status || "");
      if (/approved|verified|passed/i.test(appSt) && companionPatch.allow_orders == null) {
        companionPatch.allow_orders = true;
      }
    }
    const rows = await patchCompanionRow(id, companionPatch);

    if (Object.keys(profilePatch).length && companion.user_id) {
      await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
        method: "PATCH",
        body: JSON.stringify(profilePatch),
      });
    }

    await logOperation(req, action === "quick-edit" ? "quick_edit" : "edit", id, companion, rows?.[0], payload.reason || "");

    if (payload.certTagIds != null || payload.cert_tag_ids != null || payload.certTags != null) {
      let ids = payload.certTagIds ?? payload.cert_tag_ids;
      if (ids == null && Array.isArray(payload.certTags)) {
        ids = payload.certTags.map((t) => (typeof t === "string" ? t : t && t.id)).filter(Boolean);
      }
      if (typeof ids === "string") {
        ids = ids.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      }
      if (!Array.isArray(ids)) ids = [];
      try {
        await setAssignmentsForProfile(id, ids);
      } catch (err) {
        console.warn("[admin/players] cert tag assign failed", err?.message || err);
      }
    }

    let detail;
    try {
      detail = await buildDetail(rows?.[0] || (await getCompanion(id)), await getProfile(companion.user_id));
    } catch {
      detail = mapListPlayer(rows?.[0] || companion, await getProfile(companion.user_id));
    }
    return json(res, 200, { ok: true, message: "修改已保存", player: detail });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "陪玩管理接口异常",
      table: PLAYER_TABLE,
      migration: "supabase/companion-admin-data.sql",
    });
  }
}
