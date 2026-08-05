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

const ADMIN_ROLES = new Set(["super_admin", "admin"]);
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

async function patchCompanionRow(id, patch) {
  const body = { ...patch, updated_at: patch.updated_at || new Date().toISOString() };
  try {
    return await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!isMissingRelation(error) && !/column|schema cache|PGRST/i.test(String(error.message || ""))) throw error;
    // Progressive strip of optional columns so gift/direct rebate still persist when present.
    const optional = [
      "gift_commission_rate",
      "direct_rebate_rate",
      "level_id",
      "level_effective_at",
      "commission_effective_at",
      "featured",
      "allow_orders",
      "main_service",
      "tags",
      "age",
      "gender",
      "region",
    ];
    let next = { ...body };
    for (const key of optional) {
      if (!(key in next)) continue;
      try {
        return await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(next),
        });
      } catch (inner) {
        if (!/column|schema cache|PGRST/i.test(String(inner.message || ""))) throw inner;
        delete next[key];
      }
    }
    return companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(next),
    });
  }
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
  const token = tokenFrom(req);
  if (!token || !ANON_KEY()) {
    throw Object.assign(new Error("请先登录管理员账号。"), { status: 401 });
  }
  const authRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const authText = await authRes.text();
  let authUser = null;
  try {
    authUser = authText ? JSON.parse(authText) : null;
  } catch {
    authUser = null;
  }
  if (!authRes.ok || !authUser?.id) throw Object.assign(new Error("请先登录管理员账号。"), { status: 401 });
  const profiles = await companionDb("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`);
  const profile = profiles?.[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("没有陪玩管理权限"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号未启用"), { status: 403 });
  return profile;
}

function labelStatus(value, fallback = "待审核") {
  const key = String(value || "").toLowerCase();
  return STATUS_LABEL[key] || value || fallback;
}

function normalizeStatusInput(value, fallback = "pending") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/待审核|pending|审核中/i.test(text)) return "pending";
  if (/已通过|approved|已认证|verified|已缴纳|paid|已到账/i.test(text)) return "approved";
  if (/已驳回|已拒绝|rejected/i.test(text)) return "rejected";
  if (/重新提交|resubmit|待补充/i.test(text)) return "resubmit";
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

function mapListPlayer(row = {}, profile = {}) {
  const accountRaw = profile.status || "active";
  const identityRaw = row.identity_status || row.verification_status || "pending";
  const applicationRaw = row.application_status || row.verification_status || "pending";
  const depositRaw = row.deposit_status || "unpaid";
  const mediaRaw = row.media_status || "pending";
  return {
    id: row.id,
    uid: row.user_id,
    user_id: row.user_id,
    playerId: row.id,
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
    tags: row.tags || "",
    deposit_status: depositRaw,
    depositStatus: labelStatus(depositRaw, depositRaw),
    verification_status: applicationRaw,
    auditStatus: labelStatus(applicationRaw),
    audit: labelStatus(applicationRaw),
    identity_status: identityRaw,
    identityStatus: labelStatus(identityRaw, "未认证"),
    media_status: mediaRaw,
    mediaStatus: labelStatus(mediaRaw),
    application_status: applicationRaw,
    applicationStatus: labelStatus(applicationRaw),
    online_status: (() => {
      const verified = /approved|verified|passed/.test(String(row.verification_status || applicationRaw || ""));
      if (!verified) return "offline";
      return row.online_status || "offline";
    })(),
    onlineStatus: (() => {
      const verified = /approved|verified|passed/.test(String(row.verification_status || applicationRaw || ""));
      const code = verified ? (row.online_status || "offline") : "offline";
      return ONLINE_LABEL[code] || code || "离线";
    })(),
    status: ACCOUNT_LABEL[accountRaw] || accountRaw,
    accountStatus: ACCOUNT_LABEL[accountRaw] || accountRaw,
    account_status: accountRaw,
    created_at: row.created_at || profile.created_at,
    updated_at: row.updated_at,
    registered_at: row.created_at || profile.created_at,
    last_login: profile.last_login_at || row.last_login_at || "",
    lastLogin: profile.last_login_at || row.last_login_at || "",
    last_login_ip: profile.last_login_ip || "",
    lastLoginIp: profile.last_login_ip || "",
    hasPassword: false,
    has_password: false,
    passwordSetAt: profile.password_set_at || "",
    password_set_at: profile.password_set_at || "",
    mustChangePassword: profile.must_change_password === true,
    must_change_password: profile.must_change_password === true,
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
      url,
      contentType: item.content_type || "",
      sortOrder: Number(item.sort_order || 0) || 0,
    });
  }

  const avatarMedia = mediaSigned.find((m) => m.mediaType === "avatar");
  const coverMedia =
    mediaSigned.find((m) => m.mediaType === "cover") ||
    mediaSigned.find((m) => m.mediaType === "gallery" && Number(m.sortOrder || 0) === 1) ||
    null;
  const gallery = mediaSigned.filter((m) => m.mediaType === "gallery" || m.mediaType === "cover");
  const voices = mediaSigned.filter((m) => m.mediaType === "voice");

  const completed = related.orders.filter((o) => o.status === "completed").length;
  const cancelled = related.orders.filter((o) => o.status === "cancelled").length;
  const refunded = related.orders.filter((o) => /refund/i.test(String(o.status || ""))).length;
  const totalIncome = related.income.reduce((n, row) => n + money(row.amount), 0);
  const reviewList = (related.reviews || []).filter((r) => !r.status || r.status === "published" || r.status === "显示中");
  const reviewRatings = reviewList.map((r) => Number(r.rating) || 0).filter((n) => n >= 1 && n <= 5);
  const reviewCount = reviewRatings.length;
  const avgRating = reviewCount ? Math.round((reviewRatings.reduce((n, v) => n + v, 0) / reviewCount) * 10) / 10 : 0;
  const goodReviewCount = reviewRatings.filter((n) => n >= 4).length;

  const base = mapListPlayer(
    {
      ...row,
      identity_status: identity?.status || row.verification_status,
      application_status: row.application_status || row.verification_status,
      deposit_status: deposit?.status || row.deposit_status,
      media_status: row.media_status,
    },
    profile
  );

  let hasPassword = profile?.has_password === true;
  let mustChangePassword = profile?.must_change_password === true;
  try {
    const { resolveHasPassword, resolveMustChangePassword } = await import("../_account-security.js");
    hasPassword = await resolveHasPassword(profile || {}, {}, { probeAuth: true });
    mustChangePassword = resolveMustChangePassword(profile || {}, {});
  } catch {
    /* keep defaults */
  }
  base.hasPassword = hasPassword;
  base.has_password = hasPassword;
  base.passwordSetAt = profile?.password_set_at || "";
  base.password_set_at = profile?.password_set_at || "";
  base.mustChangePassword = mustChangePassword;
  base.must_change_password = mustChangePassword;
  base.lastLogin = profile?.last_login_at || base.lastLogin || "";
  base.last_login = base.lastLogin;
  base.lastLoginIp = profile?.last_login_ip || "";
  base.last_login_ip = base.lastLoginIp;
  base.email = profile?.email || base.email || "";

  return {
    ...base,
    age: row.age ?? "",
    gender: row.gender || "",
    region: row.region || "",
    description: row.description || "",
    contact_phone: row.contact_phone || profile.phone || "",
    voice_url: row.voice_url || "",
    card_image_url: row.card_image_url || "",
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
      status: row.application_status || row.verification_status || "pending",
      statusLabel: labelStatus(row.application_status || row.verification_status || "pending"),
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
      avatarUrl: avatarMedia?.url || profile.avatar_url || row.card_image_url || "",
      coverUrl: coverMedia?.url || row.card_image_url || resolveCompanionCover(profile, row) || "",
      gallery,
      voices,
      status: row.media_status || "pending",
      statusLabel: labelStatus(row.media_status || "pending"),
      rejectReason: row.media_reject_reason || "",
      empty: !avatarMedia && !coverMedia && !gallery.length && !voices.length && !row.card_image_url && !row.voice_url,
    },
    deposit: deposit
      ? {
          requiredAmount: deposit.required_amount,
          paidAmount: deposit.paid_amount,
          paidAt: deposit.paid_at || "",
          paymentMethod: deposit.payment_method || "",
          proofUrl,
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
  if (payload.allowOrders != null || payload.allow_orders != null) {
    patch.allow_orders = bool(payload.allowOrders ?? payload.allow_orders, true);
  }
  if (payload.depositStatus != null) patch.deposit_status = normalizeStatusInput(payload.depositStatus, "pending");
  if (payload.auditStatus != null || payload.applicationStatus != null) {
    patch.application_status = normalizeStatusInput(payload.auditStatus || payload.applicationStatus, "pending");
    patch.verification_status = patch.application_status === "approved" ? "approved" : patch.application_status;
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

async function listPlayers() {
  const [companions, profiles] = await Promise.all([
    companionDb(PLAYER_TABLE, "?order=updated_at.desc,created_at.desc&limit=500"),
    companionDb("profiles", "?role=eq.companion&limit=800").catch(() => []),
  ]);
  const profileMap = (Array.isArray(profiles) ? profiles : []).reduce((m, p) => {
    m[p.id] = p;
    return m;
  }, {});
  return (Array.isArray(companions) ? companions : []).map((row) => mapListPlayer(row, profileMap[row.user_id] || {}));
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
  return after?.[0];
}

async function reviewMedia(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.mediaStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回头像/相册/语音时必须填写原因。"), { status: 400 });
  }
  const mediaId = String(payload.mediaId || "").trim();
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
  }
  await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companion.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      media_status: status,
      media_reject_reason: reason,
      updated_at: new Date().toISOString(),
    }),
  });
  await logOperation(req, "review_media_batch", companion.id, { media_status: companion.media_status }, { status, reason }, reason);
  return { status, reason };
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
  return { status: mapped, reason };
}

async function reviewApplication(req, companion, payload) {
  const status = normalizeStatusInput(payload.status || payload.applicationStatus || payload.auditStatus, "pending");
  const reason = String(payload.rejectReason || payload.reason || "").trim();
  if ((status === "rejected" || status === "resubmit") && !reason) {
    throw Object.assign(new Error("驳回或要求补资料时必须填写原因。"), { status: 400 });
  }
  const { approveListingPatchForRow, unlistListingPatch } = await import("../_companion-listing-sync.js");
  let patch;
  if (status === "approved") {
    const extras = {
      online_status: "offline",
      application_reject_reason: "",
    };
    if (payload.levelId != null || payload.level_id != null) {
      extras.level_id = String(payload.levelId || payload.level_id || "").trim();
    }
    if (payload.levelName != null || payload.level_name != null) {
      extras.level_name = String(payload.levelName || payload.level_name || "").trim();
    }
    const orderRate = percent(payload.orderCommissionRate ?? payload.commission_rate ?? payload.commissionRate);
    if (orderRate !== undefined) extras.commission_rate = orderRate;
    const giftRate = percent(payload.giftCommissionRate ?? payload.gift_commission_rate);
    if (giftRate !== undefined) extras.gift_commission_rate = giftRate;
    const rebate = percent(payload.directRebateRate ?? payload.direct_rebate_rate);
    if (rebate !== undefined) extras.direct_rebate_rate = rebate;
    if (payload.price != null) extras.price = money(payload.price);
    if (payload.minPrice != null || payload.price_min != null) {
      extras.price_min = money(payload.minPrice ?? payload.price_min);
    }
    if (payload.maxPrice != null || payload.price_max != null) {
      extras.price_max = money(payload.maxPrice ?? payload.price_max);
    }
    if (payload.allowOrders != null || payload.allow_orders != null) {
      extras.allow_orders = bool(payload.allowOrders ?? payload.allow_orders, true);
    }
    // Must set verification_status=approved so /api/public/companions (filters by it) publishes the companion.
    patch = approveListingPatchForRow(companion, extras);
  } else {
    patch = unlistListingPatch({ status, reason });
    // Drop undefined verification_status from unlist when archived
    Object.keys(patch).forEach((k) => {
      if (patch[k] === undefined) delete patch[k];
    });
  }
  const after = await companionDb(PLAYER_TABLE, `?id=eq.${encodeURIComponent(companion.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (status === "approved" && companion.user_id) {
    try {
      await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          role: "companion",
          status: "active",
          updated_at: new Date().toISOString(),
        }),
      });
    } catch {
      /* best effort: register already creates companion profile */
    }
  }
  await logOperation(req, "review_application", companion.id, companion, after?.[0], reason);
  return after?.[0];
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);
  } catch (error) {
    return json(res, error.status || 403, { ok: false, message: error.message || "没有陪玩管理权限" });
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
      const players = await listPlayers();
      return json(res, 200, { ok: true, configured: true, players, table: PLAYER_TABLE });
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
      await reviewApplication(req, companion, payload);
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "陪玩申请审核已保存", player: detail });
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
      return json(res, 200, { ok: true, message: "等级已更新", player: detail });
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
        try {
          const { revokeUserSessions } = await import("../_account-security.js");
          await revokeUserSessions(companion.user_id);
        } catch { /* best-effort */ }
      }
      await logOperation(req, action, id, companion, { status: "disabled" }, payload.reason || "");
      const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
      return json(res, 200, { ok: true, message: "账号已停用", player: detail });
    }

    if (
      action === "send_password_reset" ||
      action === "send_reset_email" ||
      action === "send_password_reset_email"
    ) {
      const userId = companion.user_id;
      if (!userId) return json(res, 400, { ok: false, message: "缺少用户 ID" });
      const profile = await getProfile(userId);
      if (!profile?.email) return json(res, 400, { ok: false, message: "该陪玩未绑定邮箱。" });
      const { sendEmailOtp } = await import("../_mail.js");
      const { storeOtp, randomOtpCode } = await import("../_otp-store.js");
      const { logSecurityAdminAction, RESET_EMAIL_GENERIC_MESSAGE } = await import("../_account-security.js");
      const code = randomOtpCode();
      await storeOtp({ accountKey: userId, role: "companion", code, kind: "otp", ttlMs: 10 * 60 * 1000 });
      let mailOk = false;
      let mailError = "";
      try {
        await sendEmailOtp({ to: String(profile.email).toLowerCase(), code, purpose: "forgot", roleLabel: "陪玩端" });
        mailOk = true;
      } catch (err) {
        mailError = String(err?.message || err || "");
      }
      await logOperation(req, "send_password_reset_email", id, companion, { mailOk }, payload.reason || mailError);
      await logSecurityAdminAction({
        operatorId: "",
        targetId: userId,
        targetType: "companion",
        action: "send_password_reset_email",
        result: mailOk ? "ok" : "mail_failed",
        reason: mailError,
      });
      if (!mailOk) {
        const staging =
          String(process.env.ALLOW_STAGING_OTP || "") === "1" || String(process.env.MCJ_OTP_DEBUG || "") === "1";
        if (staging) {
          return json(res, 200, {
            ok: true,
            message: RESET_EMAIL_GENERIC_MESSAGE + "（Staging 已生成调试验证码）",
            devCode: code,
          });
        }
        return json(res, 502, { ok: false, message: mailError || "重置邮件发送失败" });
      }
      return json(res, 200, { ok: true, message: RESET_EMAIL_GENERIC_MESSAGE });
    }

    if (action === "force_change_password" || action === "require_password_change") {
      const userId = companion.user_id;
      if (!userId) return json(res, 400, { ok: false, message: "缺少用户 ID" });
      const { markMustChangePassword } = await import("../_account-security.js");
      await markMustChangePassword(userId, true);
      await logOperation(req, "force_change_password", id, companion, { must_change_password: true }, payload.reason || "");
      return json(res, 200, { ok: true, message: "已要求用户下次登录后修改密码。" });
    }

    if (action === "revoke_sessions" || action === "logout_all" || action === "enable" || action === "unfreeze") {
      if (action === "enable" || action === "unfreeze") {
        if (companion.user_id) {
          await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "active" }),
          });
        }
        await logOperation(req, action, id, companion, { status: "active" }, payload.reason || "");
        const detail = await buildDetail(await getCompanion(id), await getProfile(companion.user_id));
        return json(res, 200, { ok: true, message: "账号已解封/启用", player: detail });
      }
      const userId = companion.user_id;
      if (!userId) return json(res, 400, { ok: false, message: "缺少用户 ID" });
      const { revokeUserSessions } = await import("../_account-security.js");
      await revokeUserSessions(userId);
      await logOperation(req, "revoke_sessions", id, companion, {}, payload.reason || "");
      return json(res, 200, { ok: true, message: "已注销该账号全部登录会话。" });
    }

    if (action === "reset_password" || action === "reset-password") {
      return json(res, 400, {
        ok: false,
        message: "禁止在后台直接设置用户明文密码。请使用「发送密码重置邮件」。",
      });
    }

    // default save / edit / quick-edit
    const companionPatch = companionEditablePatch(payload);
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
    const rows = await patchCompanionRow(id, companionPatch);

    const profilePatch = profileEditablePatch(payload);
    if (Object.keys(profilePatch).length && companion.user_id) {
      await companionDb("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}`, {
        method: "PATCH",
        body: JSON.stringify(profilePatch),
      });
    }

    await logOperation(req, action === "quick-edit" ? "quick_edit" : "edit", id, companion, rows?.[0], payload.reason || "");
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
