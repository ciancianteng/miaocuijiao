/**
 * Shared companion public-listing / orderability gate.
 * Boss home / hall / detail / place-order must all use this.
 *
 * hallVisible ≡ published:
 *   application approved + allow_orders + active + not archived/banned
 *   + NOT is_test_account
 *   + critical profile complete (nickname, ≥1 game, price > 0)
 * Level missing is soft: sync/approve writes platform default level.
 * Soft media (avatar / gallery / voice) never blocks listing.
 */
import {
  isUnstableMediaUrl,
  pickStableMediaUrl,
  resolveCompanionAvatar,
  DEFAULT_COMPANION_AVATAR,
} from "./_companion-public-map.js";

export const MIN_GALLERY = 1;

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readGamePrices(row = {}) {
  const raw = row.game_prices;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* ignore */
    }
  }
  return {};
}

function hasPositivePrice(row = {}) {
  if (money(row.price) > 0) return true;
  const gp = readGamePrices(row);
  return Object.keys(gp).some((k) => money(gp[k]) > 0);
}

function hasGameSet(row = {}) {
  if (String(row.game || "").trim()) return true;
  const ids = row.service_ids;
  if (Array.isArray(ids) && ids.length) return true;
  if (typeof ids === "string") {
    try {
      const parsed = JSON.parse(ids);
      if (Array.isArray(parsed) && parsed.length) return true;
    } catch {
      /* ignore */
    }
    if (ids.split(/[,，]/).map((s) => s.trim()).filter(Boolean).length) return true;
  }
  return Object.keys(readGamePrices(row)).length > 0;
}

function galleryCount(row = {}, mediaExtras = {}) {
  const live = Array.isArray(mediaExtras.gallery)
    ? mediaExtras.gallery.filter((g) => g && (g.url || g.id))
    : [];
  if (live.length) return live.length;
  const tag = String(row.tags || "");
  const m = tag.match(/\[\[MCJ_GALLERY:([\s\S]*?)\]\]/);
  if (!m) return 0;
  try {
    const items = JSON.parse(m[1]);
    return Array.isArray(items) ? items.filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

function hasRealAvatar(profile = {}, row = {}, mediaExtras = {}) {
  const live = String(mediaExtras.avatarUrl || mediaExtras.mediaAvatarUrl || "").trim();
  if (live && /^storage:\/\/present\//i.test(live)) return true;
  if (live && /^https?:\/\//i.test(live) && !isUnstableMediaUrl(live)) return true;
  const resolved = resolveCompanionAvatar(profile, row, mediaExtras);
  if (!resolved || resolved === DEFAULT_COMPANION_AVATAR) return false;
  if (isUnstableMediaUrl(resolved)) return false;
  return !!pickStableMediaUrl(resolved);
}

function hasVoice(row = {}, mediaExtras = {}) {
  const live = String(mediaExtras.voiceUrl || "").trim();
  if (live && /^storage:\/\/present\//i.test(live)) return true;
  if (live && (/^https?:\/\//i.test(live) || live.startsWith("/"))) return true;
  const raw = String(row.voice_url || "").trim();
  if (!raw) return false;
  if (/^storage:\/\//i.test(raw)) return true;
  if (isUnstableMediaUrl(raw)) return false;
  return true;
}

function identityOk(row = {}) {
  return /approved|verified|passed/i.test(String(row.verification_status || ""));
}
function applicationApproved(row = {}) {
  return /approved|verified|passed/i.test(String(row.application_status || ""));
}
function applicationRejected(row = {}) {
  return /rejected|resubmit|need_more/i.test(String(row.application_status || ""));
}
function applicationIsDraft(row = {}) {
  const st = String(row.application_status || "").trim().toLowerCase();
  if (/^(draft|archived|deleted)$/.test(st)) return true;
  if (/approved|verified|passed/.test(st)) return false;
  if (/rejected|resubmit|need_more/.test(st)) return false;
  if (row.application_submitted_at) return false;
  return true;
}
function applicationArchived(row = {}) {
  return /^(archived|deleted)$/i.test(String(row.application_status || "").trim());
}

/**
 * Admin review approved: application must be formally approved.
 * Identity-only legacy without application approved does NOT auto-list.
 */
function reviewApproved(row = {}) {
  if (applicationIsDraft(row)) return false;
  if (applicationArchived(row)) return false;
  if (applicationRejected(row)) return false;
  return applicationApproved(row);
}

function isBannedOrDisabled(profile = {}) {
  const st = String(profile?.status || "").trim().toLowerCase();
  if (!st) return false;
  return /disabled|banned|frozen|blocked|suspended|deleted/.test(st);
}

/** Field-based test flag only — never nickname regex in the public gate. */
export function isTestAccount(row = {}, profile = {}) {
  if (row.is_test_account === true || row.is_test === true) return true;
  if (profile?.is_test_account === true || profile?.is_test === true) return true;
  return false;
}

export function hasAssignableLevel(row = {}) {
  const id = String(row.level_id || "").trim();
  const name = String(row.level_name || "").trim();
  if (id && !/^未设置/.test(id)) return true;
  if (name && !/^未设置/.test(name)) return true;
  return false;
}

/**
 * Soft / non-critical media gaps — never hide an approved companion from hall/home.
 */
function softMediaMissing(row = {}, profile = {}, mediaExtras = {}) {
  const soft = [];
  if (!hasRealAvatar(profile, row, mediaExtras)) soft.push("缺少头像");
  if (galleryCount(row, mediaExtras) < MIN_GALLERY) soft.push("缺少相册");
  if (!hasVoice(row, mediaExtras)) soft.push("缺少录音");
  return soft;
}

/**
 * Optional profile fields — informational only; do not block listing.
 * Missing level is soft: sync writes platform default so publish can proceed.
 */
function softProfileMissing(row = {}) {
  const soft = [];
  if (!(Number(row.age) >= 18 && Number(row.age) <= 60)) soft.push("缺少年龄");
  if (!String(row.gender || "").trim()) soft.push("缺少性别");
  if (!String(row.region || "").trim()) soft.push("缺少地区");
  if (!hasAssignableLevel(row)) soft.push("缺少等级");
  return soft;
}

/**
 * Critical boss-facing fields. Missing → block public hall/home until filled.
 * Avatar/card/voice are soft (brand default). Level is soft (default on sync).
 */
function criticalMissing(row = {}, profile = {}) {
  const missing = [];
  const nickname = String(row.nickname || profile.display_name || "").trim();
  if (!nickname || /未命名|未设置/.test(nickname)) missing.push("缺少昵称");
  if (!hasGameSet(row) && !String(row.service_type || "").trim()) missing.push("缺少游戏资料");
  else if (!hasGameSet(row)) missing.push("缺少游戏资料");
  if (!hasPositivePrice(row)) missing.push("缺少价格");
  return missing;
}

/**
 * @returns {{
 *   ok: boolean,
 *   missing: string[],
 *   softMissing: string[],
 *   criticalMissing: string[],
 *   blockReasons: string[],
 *   profileComplete: boolean,
 *   criticalComplete: boolean,
 *   adminApproved: boolean,
 *   accountEnabled: boolean,
 *   isTestAccount: boolean,
 *   canOrder: boolean,
 *   canWork: boolean,
 *   hallVisible: boolean,
 *   publishReady: boolean,
 *   statusLabel: string
 * }}
 */
export function evaluatePublishGate(row = {}, profile = {}, mediaExtras = {}) {
  const blockReasons = [];
  const role = String(profile?.role || "").trim().toLowerCase();
  const roles = Array.isArray(profile?.roles) ? profile.roles.map((r) => String(r || "").toLowerCase()) : [];
  const isCompanionCapable =
    role === "companion" ||
    role === "player" ||
    roles.includes("companion") ||
    roles.includes("player") ||
    !!(row && (row.user_id || row.id));
  const accountEnabled = !!(profile && isCompanionCapable && profile.status === "active");
  if (!profile || !isCompanionCapable) blockReasons.push("非陪玩账号");
  else if (isBannedOrDisabled(profile)) blockReasons.push("账号已封禁/停用");
  else if (profile.status !== "active") blockReasons.push("账号未启用");

  if (applicationArchived(row)) blockReasons.push("申请已归档");
  if (applicationRejected(row)) blockReasons.push("申请已驳回");

  const adminApproved = reviewApproved(row);
  if (!adminApproved && !applicationRejected(row) && !applicationArchived(row)) {
    blockReasons.push("待审核");
  }

  const allowOrders = row.allow_orders !== false;
  if (!allowOrders) blockReasons.push("禁止接单");

  const testAccount = isTestAccount(row, profile || {});
  if (testAccount) blockReasons.push("测试账号");

  const crit = criticalMissing(row, profile || {});
  const soft = [...softProfileMissing(row), ...softMediaMissing(row, profile || {}, mediaExtras)];
  const profileComplete = crit.length === 0 && soft.length === 0;
  const criticalComplete = crit.length === 0;

  if (adminApproved && accountEnabled && allowOrders && !testAccount && !criticalComplete) {
    blockReasons.push("资料不完整，暂未发布");
  }

  // Work eligibility (companion端 / admin): approved + active + allow + not test.
  // Public publish still requires criticalComplete.
  const canWorkBase =
    accountEnabled &&
    adminApproved &&
    allowOrders &&
    !testAccount &&
    !applicationRejected(row) &&
    !applicationArchived(row) &&
    !isBannedOrDisabled(profile || {});

  const hallVisible = canWorkBase && criticalComplete;
  const canWork = canWorkBase;
  const canOrder = hallVisible;
  const publishReady = hallVisible;
  const ok = hallVisible;

  const missing = [...new Set([...blockReasons, ...crit, ...soft])];

  let statusLabel = "可上架";
  if (testAccount) {
    statusLabel = "测试账号";
  } else if (!accountEnabled || isBannedOrDisabled(profile || {})) {
    statusLabel = blockReasons.includes("账号已封禁/停用") ? "账号已封禁/停用" : "账号未启用";
  } else if (applicationArchived(row)) {
    statusLabel = "已归档";
  } else if (applicationRejected(row)) {
    statusLabel = /resubmit|need_more/i.test(String(row.application_status || ""))
      ? "需补交资料"
      : "申请已驳回";
  } else if (!adminApproved) {
    statusLabel = "待审核";
  } else if (!allowOrders) {
    statusLabel = "禁止接单";
  } else if (!criticalComplete) {
    statusLabel = "资料不完整，暂未发布";
  } else if (soft.length) {
    statusLabel = "可上架";
  }

  return {
    ok,
    missing,
    softMissing: soft,
    criticalMissing: crit,
    blockReasons: [...new Set(blockReasons)],
    profileComplete,
    criticalComplete,
    adminApproved,
    accountEnabled,
    isTestAccount: testAccount,
    canOrder,
    canWork,
    hallVisible,
    publishReady,
    statusLabel,
    hasAvatar: hasRealAvatar(profile || {}, row, mediaExtras),
    hasGallery: galleryCount(row, mediaExtras) >= MIN_GALLERY,
    hasVoice: hasVoice(row, mediaExtras),
  };
}

export function hallVisibleByGate(row = {}, profile = {}, mediaExtras = {}) {
  return evaluatePublishGate(row, profile, mediaExtras).hallVisible;
}

export function listingBlockReason(gate = {}) {
  if (gate.hallVisible || gate.ok) return "";
  if (gate.isTestAccount) return "测试账号";
  const reasons = Array.isArray(gate.blockReasons) ? gate.blockReasons : [];
  const crit = Array.isArray(gate.criticalMissing) ? gate.criticalMissing : [];
  if (reasons.includes("资料不完整，暂未发布") || (crit.length && gate.adminApproved)) {
    const detail = crit.length ? crit.join("、") : "";
    return detail ? `资料不完整，暂未发布（${detail}）` : "资料不完整，暂未发布";
  }
  if (reasons.length) return reasons.join("、");
  const missing = Array.isArray(gate.missing) ? gate.missing : [];
  return missing.filter((m) => !/^缺少/.test(m)).join("、") || "未进入公开列表";
}
