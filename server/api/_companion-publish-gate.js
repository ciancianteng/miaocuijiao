/**
 * Shared companion public-listing / orderability gate.
 * Boss home / hall / detail / place-order must all use this.
 *
 * hallVisible ≡ published:
 *   application approved + allow_orders + active + not archived/banned
 *   + NOT is_test_account
 *   + critical profile complete (nickname, ≥1 game, price > 0)
 *   + (identity_verified OR deposit_verified)  — never require both
 * Level missing is soft: sync/approve writes platform default level.
 * Soft media (avatar / gallery / voice) never blocks listing.
 */
import {
  isUnstableMediaUrl,
  pickStableMediaUrl,
  resolveCompanionAvatar,
  DEFAULT_COMPANION_AVATAR,
} from "./_companion-public-map.js";
import { isCredentialOrOk } from "./_companion-credential-gate.js";
import { isTestAccountRecord } from "./_test-accounts.js";

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

/** True when listing/public-ready pricing exists: price > 0 OR any game_prices value > 0. */
export function hasPositivePrice(row = {}) {
  if (money(row.price) > 0) return true;
  const gp = readGamePrices({
    game_prices: row.game_prices ?? row.gamePrices ?? row.game_price_map ?? row.gamePriceMap,
  });
  return Object.keys(gp).some((k) => money(gp[k]) > 0);
}

/** Normalize request/body/draft into a price-check row. */
export function priceCheckRow(source = {}, existing = {}) {
  const gamePrices =
    source.game_prices ??
    source.gamePrices ??
    source.game_price_map ??
    source.gamePriceMap ??
    existing.game_prices ??
    existing.gamePrices ??
    {};
  const price =
    source.price ??
    source.hourly_price ??
    source.hourlyPrice ??
    existing.price ??
    existing.hourly_price;
  return { price, game_prices: gamePrices };
}

export const MISSING_PRICE_MESSAGE =
  "请先设置接单价格：单价 price > 0，或至少一个游戏价格 game_prices > 0。";

export function assertHasPositivePrice(source = {}, existing = {}, message = MISSING_PRICE_MESSAGE) {
  if (hasPositivePrice(priceCheckRow(source, existing))) return true;
  const err = new Error(message);
  err.status = 400;
  err.code = "MISSING_PRICE";
  throw err;
}

/**
 * PERMANENT RULE — price validation scope:
 * - Enforce on: companion application submit, and first transition into approved.
 * - Never enforce on: admin correction/edit of an already-approved companion
 *   (profile, avatar, game/service, pricing, payment review, deposit/identity,
 *   allow_orders, featured, etc. must remain editable even when price is missing).
 * Public listing gate is separate and unchanged.
 */
export function isApprovedApplicationStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "approved" || raw === "verified" || raw === "passed" || /已通过|已认证/.test(String(value || ""));
}

/** True only when moving into approved from a non-approved state. */
export function isFirstApprovalTransition(existing = {}, nextStatus = "") {
  if (!isApprovedApplicationStatus(nextStatus)) return false;
  const current =
    existing.application_status ??
    existing.applicationStatus ??
    existing.verification_status ??
    existing.verificationStatus ??
    existing.auditStatus ??
    "";
  return !isApprovedApplicationStatus(current);
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

  // Credential is OR: identity OR deposit. Never require both for hall / homepage.
  const credentialOrOk = isCredentialOrOk(row, mediaExtras?.identityRow || null, mediaExtras?.depositRow || null);
  if (adminApproved && accountEnabled && allowOrders && !testAccount && !credentialOrOk) {
    blockReasons.push("认证未完成（身份证或押金二选一）");
  }

  const crit = criticalMissing(row, profile || {});
  const soft = [...softProfileMissing(row), ...softMediaMissing(row, profile || {}, mediaExtras)];
  const profileComplete = crit.length === 0 && soft.length === 0;
  const criticalComplete = crit.length === 0;

  if (adminApproved && accountEnabled && allowOrders && !testAccount && credentialOrOk && !criticalComplete) {
    blockReasons.push("资料不完整，暂未发布");
  }

  // Work eligibility (companion端 / admin): approved + active + allow + not test + credential OR.
  // Public publish still requires criticalComplete.
  const canWorkBase =
    accountEnabled &&
    adminApproved &&
    allowOrders &&
    !testAccount &&
    credentialOrOk &&
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
  } else if (!credentialOrOk) {
    statusLabel = "认证未完成（身份证或押金二选一）";
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
    credentialOrOk,
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

/**
 * Admin-facing publish snapshot.
 * Contract: adminApproved && !isTestAccount && hallVisible=false MUST expose clear blockReasons.
 */
export function adminPublishSnapshot(row = {}, profile = {}, mediaExtras = {}) {
  const gate = evaluatePublishGate(row, profile, mediaExtras);
  const crit = Array.isArray(gate.criticalMissing) ? gate.criticalMissing : [];
  let blockReasons = Array.isArray(gate.blockReasons) ? [...gate.blockReasons] : [];
  // Prefer concrete admin/UI reasons over the generic “资料不完整，暂未发布” umbrella.
  if (crit.length) {
    blockReasons = blockReasons.filter((r) => r !== "资料不完整，暂未发布");
    for (const item of crit) {
      if (item && !blockReasons.includes(item)) blockReasons.push(item);
    }
  }
  if (gate.adminApproved && !gate.isTestAccount && !gate.hallVisible) {
    if (!blockReasons.length) {
      blockReasons.push(listingBlockReason(gate) || "已通过但未进入公开大厅");
    }
  }
  const reasonText =
    blockReasons.length > 0
      ? blockReasons.join("、")
      : listingBlockReason({ ...gate, blockReasons }) || "";
  return {
    adminApproved: !!gate.adminApproved,
    hallVisible: !!gate.hallVisible,
    isTestAccount: !!gate.isTestAccount,
    credentialOrOk: !!gate.credentialOrOk,
    criticalComplete: !!gate.criticalComplete,
    criticalMissing: crit,
    blockReasons: [...new Set(blockReasons)],
    statusLabel: gate.statusLabel || "",
    listingBlockReason: reasonText,
    publishReady: !!gate.hallVisible,
    // True when approval and hall are out of sync for a real (non-test) companion.
    approvedButHidden: !!(gate.adminApproved && !gate.isTestAccount && !gate.hallVisible),
  };
}

/** Merge existing companion + approve/edit payload into the row that will be gated. */
export function projectApprovedRow(existing = {}, payload = {}) {
  const next = { ...existing };
  const nickname = payload.nickname ?? payload.name ?? payload.display_name ?? payload.displayName;
  if (nickname != null) next.nickname = String(nickname || "").trim();
  const game = payload.game ?? payload.mainGame ?? payload.main_service ?? payload.mainService;
  if (game != null) next.game = String(game || "").trim();
  if (payload.service_ids != null || payload.serviceIds != null) {
    next.service_ids = payload.service_ids ?? payload.serviceIds;
  }
  if (payload.service_type != null || payload.serviceType != null) {
    next.service_type = payload.service_type ?? payload.serviceType;
  }
  if (payload.game_prices != null || payload.gamePrices != null) {
    next.game_prices = payload.game_prices ?? payload.gamePrices;
  }
  if (payload.price != null) next.price = payload.price;
  if (payload.price_min != null || payload.minPrice != null) {
    next.price_min = payload.price_min ?? payload.minPrice;
  }
  if (payload.price_max != null || payload.maxPrice != null) {
    next.price_max = payload.price_max ?? payload.maxPrice;
  }
  next.application_status = "approved";
  next.verification_status = "approved";
  if (payload.allowOrders != null || payload.allow_orders != null) {
    next.allow_orders = payload.allowOrders !== false && payload.allow_orders !== false;
  } else {
    next.allow_orders = true;
  }
  return next;
}

export const APPROVE_INCOMPLETE_MESSAGE =
  "无法通过审核：陪玩资料未满足大厅展示条件。请先补齐昵称、游戏与接单价格后再通过。";

/**
 * First transition into approved must be hall-ready for real accounts.
 * Test accounts may still be marked approved (isolated from public hall).
 * Throws Error with status=400, code, blockReasons, criticalMissing.
 */
export function assertApproveCanPublish(existing = {}, payload = {}, profile = {}) {
  const projectedRow = projectApprovedRow(existing, payload);
  const projectedProfile = {
    ...(profile || {}),
    status: "active",
  };
  // Same smoke/test heuristics as public hall so approve cannot create silent hidden rows.
  if (isTestAccount(projectedRow, projectedProfile) || isTestAccountRecord(projectedProfile, projectedRow)) {
    const snap = adminPublishSnapshot(
      { ...projectedRow, is_test_account: true },
      { ...projectedProfile, is_test_account: true },
      {}
    );
    return {
      ...snap,
      isTestAccount: true,
      hallVisible: false,
      approvedButHidden: false,
      blockReasons: ["测试账号"],
      listingBlockReason: "测试账号",
      statusLabel: "测试账号",
    };
  }
  const snap = adminPublishSnapshot(projectedRow, projectedProfile, {});
  if (snap.hallVisible) return snap;
  // Admin UI language: concrete missing fields only when possible.
  const reasons = (snap.criticalMissing && snap.criticalMissing.length
    ? snap.criticalMissing
    : snap.blockReasons.length
      ? snap.blockReasons.filter((r) => r !== "资料不完整，暂未发布")
      : ["资料不完整，暂未发布"]
  ).filter(Boolean);
  const err = new Error(
    reasons.length
      ? `无法通过审核：${reasons.join("、")}。请先补齐后再通过。`
      : APPROVE_INCOMPLETE_MESSAGE
  );
  err.status = 400;
  err.code = "APPROVE_NOT_HALL_READY";
  err.blockReasons = reasons;
  err.criticalMissing = snap.criticalMissing;
  err.publish = { ...snap, blockReasons: reasons };
  throw err;
}
