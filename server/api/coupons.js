const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "platform_content_items";
const COUPON_TYPE = "marketing_coupons";
const CLAIM_TYPE = "user_coupon_claims";

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

function endpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${TABLE}${path}`;
}

function json(res, status, data) {
  res.status(status).json(data);
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dateOnly(value) {
  return sanitizeText(value).slice(0, 10);
}

function todayTime() {
  return Date.now();
}

function endOfDay(date) {
  return new Date(`${date}T23:59:59`).getTime();
}

function startOfDay(date) {
  return new Date(`${date}T00:00:00`).getTime();
}

function draftOf(item) {
  return item && item.draft && typeof item.draft === "object" ? item.draft : {};
}

function isEnabledCoupon(item) {
  return item && item.enabled !== false && !["disabled", "unpublished"].includes(String(item.status || "").toLowerCase());
}

function isPublicClaim(draft) {
  const value = sanitizeText(draft.claimMethod || draft.claim_method || "public");
  return ["public", "用户公开领取", "公開领取"].includes(value);
}

function isRechargeScope(draft) {
  const value = sanitizeText(draft.scope || "all");
  return ["cat_food_recharge", "catfood_recharge", "recharge", "all", "猫粮充值", "全平台"].includes(value);
}

function isValidPeriod(draft) {
  const now = todayTime();
  const start = dateOnly(draft.startAt || draft.startDate);
  const end = dateOnly(draft.endAt || draft.endDate);
  if (start && startOfDay(start) > now) return false;
  if (end && endOfDay(end) < now) return false;
  return true;
}

function isExpired(draft) {
  const end = dateOnly(draft.endAt || draft.endDate);
  return Boolean(end && endOfDay(end) < todayTime());
}

function typeLabel(type) {
  if (type === "fixed") return "固定金额减免";
  if (type === "discount") return "折扣券";
  if (type === "cat_food") return "赠送猫粮";
  return type || "优惠券";
}

function valueText(draft) {
  if (draft.type === "fixed") return `减免 ${numberValue(draft.value).toFixed(2).replace(/\.00$/, "")} 猫粮`;
  if (draft.type === "discount") return `${sanitizeText(draft.value)} 折`;
  if (draft.type === "cat_food") return `赠送 ${Math.floor(numberValue(draft.value))} 猫粮`;
  return "-";
}

function thresholdText(draft) {
  const threshold = numberValue(draft.threshold, 0);
  return threshold > 0 ? `满 ${threshold.toFixed(2).replace(/\.00$/, "")} 猫粮 可用` : "无门槛";
}

function scopeLabel(draft) {
  return sanitizeText(draft.scope) === "cat_food_recharge" ? "猫粮充值" : "全平台";
}

function totalLimit(draft) {
  const raw = sanitizeText(draft.totalLimit || draft.total_limit);
  if (!raw) return Infinity;
  const n = numberValue(raw, Infinity);
  return n > 0 ? n : Infinity;
}

function claimLimit(draft) {
  const n = numberValue(draft.claimLimitPerUser || draft.claim_limit_per_user, 1);
  return n > 0 ? n : 1;
}

function couponClaimedCount(draft, claims) {
  const saved = numberValue(draft.claimedCount || draft.claimed_count, 0);
  return Math.max(saved, claims.length);
}

async function supabaseFetch(path, init = {}) {
  const response = await fetch(endpoint(path), { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || "数据库请求失败");
  return body;
}

async function getCoupons() {
  try {
    const rows = await supabaseFetch(`?type=eq.${encodeURIComponent(COUPON_TYPE)}&order=sort.asc,updated_at.desc`);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (!/PGRST205|Could not find the table|schema cache/i.test(String(error.message || ""))) throw error;
  }
  // Fallback: announcements-backed platform content ([MCJ_PC]marketing_coupons:...)
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/announcements?is_active=eq.true&order=updated_at.desc&limit=200`, {
      headers: headers(),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) return [];
    return (Array.isArray(body) ? body : [])
      .filter((row) => String(row.title || "").startsWith("[MCJ_PC]marketing_coupons:"))
      .map((row) => {
        try {
          return JSON.parse(row.content || "{}");
        } catch {
          return null;
        }
      })
      .filter((item) => item && (item.type === COUPON_TYPE || item.draft || item.title));
  } catch {
    return [];
  }
}

async function getClaims() {
  try {
    const rows = await supabaseFetch(`?type=eq.${encodeURIComponent(CLAIM_TYPE)}&order=created_at.desc&limit=2000`);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (/PGRST205|Could not find the table|schema cache/i.test(String(error.message || ""))) return [];
    throw error;
  }
}

function normalizeCoupon(item, claims, userId = "") {
  const draft = draftOf(item);
  const couponClaims = claims.filter((claim) => draftOf(claim).couponId === item.id);
  const userClaims = userId ? couponClaims.filter((claim) => draftOf(claim).userId === userId) : [];
  const claimed = couponClaimedCount(draft, couponClaims);
  const limit = totalLimit(draft);
  const isSoldOut = Number.isFinite(limit) && claimed >= limit;
  const expired = isExpired(draft);
  const disabled = !isEnabledCoupon(item);
  const userLimitReached = userId && userClaims.length >= claimLimit(draft);
  let claimState = "claimable";
  let claimText = "立即领取";
  if (!userId) {
    claimState = "login_required";
    claimText = "登录领取";
  } else if (disabled) {
    claimState = "disabled";
    claimText = "已失效";
  } else if (expired) {
    claimState = "expired";
    claimText = "已过期";
  } else if (isSoldOut) {
    claimState = "soldout";
    claimText = "已领完";
  } else if (userLimitReached) {
    claimState = "claimed";
    claimText = userClaims.length ? "已领取" : "已达到领取上限";
  }
  return {
    id: item.id,
    name: draft.name || item.title || "优惠券",
    code: draft.code || "",
    type: draft.type || "fixed",
    typeLabel: typeLabel(draft.type),
    valueText: valueText(draft),
    thresholdText: thresholdText(draft),
    scope: draft.scope || "all",
    scopeLabel: scopeLabel(draft),
    startAt: dateOnly(draft.startAt || draft.startDate),
    endAt: dateOnly(draft.endAt || draft.endDate),
    claimState,
    claimText,
    claimedCount: claimed,
    totalLimit: Number.isFinite(limit) ? limit : null,
    enabled: !disabled,
    expired
  };
}

function normalizeClaim(claim, couponsById) {
  const draft = draftOf(claim);
  const coupon = couponsById.get(draft.couponId);
  const couponDraft = draftOf(coupon || {});
  const expired = coupon ? isExpired(couponDraft) : false;
  const disabled = coupon ? !isEnabledCoupon(coupon) : true;
  let status = draft.status || "unused";
  let displayStatus = "可使用";
  if (status === "used") displayStatus = "已使用";
  else if (expired) displayStatus = "已过期";
  else if (disabled) displayStatus = "已失效";
  return {
    id: claim.id,
    couponId: draft.couponId,
    name: couponDraft.name || draft.couponName || claim.title || "优惠券",
    typeLabel: typeLabel(couponDraft.type || draft.type),
    valueText: valueText({ ...couponDraft, type: couponDraft.type || draft.type, value: couponDraft.value || draft.value }),
    thresholdText: thresholdText(couponDraft.threshold || draft.threshold),
    scopeLabel: scopeLabel(couponDraft.scope ? couponDraft : draft),
    startAt: dateOnly(couponDraft.startAt || draft.startAt),
    endAt: dateOnly(couponDraft.endAt || draft.endAt),
    claimedAt: draft.claimedAt || claim.created_at || "",
    status,
    displayStatus
  };
}

function availableCoupons(coupons, claims, userId) {
  return coupons
    .filter((item) => {
      const draft = draftOf(item);
      return isEnabledCoupon(item) && isPublicClaim(draft) && isRechargeScope(draft) && isValidPeriod(draft);
    })
    .map((item) => normalizeCoupon(item, claims, userId));
}

export default async function handler(req, res) {
  if (!hasDatabaseConfig()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      availableCoupons: [],
      myCoupons: [],
      usableCount: 0,
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，优惠券不会写入本地假数据。",
      requiredTable: TABLE
    });
  }

  try {
    if (req.method === "GET") {
      const userId = sanitizeText(req.query.userId);
      const [coupons, claims] = await Promise.all([getCoupons(), getClaims()]);
      const couponsById = new Map(coupons.map((item) => [item.id, item]));
      const userClaims = userId ? claims.filter((claim) => draftOf(claim).userId === userId) : [];
      const myCoupons = userClaims.map((claim) => normalizeClaim(claim, couponsById));
      const usableCount = myCoupons.filter((item) => item.displayStatus === "可使用").length;
      return json(res, 200, {
        ok: true,
        configured: true,
        availableCoupons: availableCoupons(coupons, claims, userId),
        myCoupons,
        usableCount
      });
    }

    if (req.method === "POST") {
      const action = sanitizeText(req.body?.action);
      if (action !== "claim") return json(res, 400, { ok: false, message: "不支持的优惠券操作" });
      const userId = sanitizeText(req.body?.userId);
      const couponId = sanitizeText(req.body?.couponId);
      if (!userId) return json(res, 401, { ok: false, message: "请先登录后再领取优惠券。" });
      if (!couponId) return json(res, 400, { ok: false, message: "缺少优惠券 ID" });

      const [coupons, claims] = await Promise.all([getCoupons(), getClaims()]);
      const coupon = coupons.find((item) => item.id === couponId);
      if (!coupon) return json(res, 404, { ok: false, message: "优惠券不存在" });
      const draft = draftOf(coupon);
      if (!isEnabledCoupon(coupon)) return json(res, 400, { ok: false, message: "优惠券已停用，不能领取。" });
      if (!isPublicClaim(draft)) return json(res, 400, { ok: false, message: "该优惠券不支持公开领取。" });
      if (!isRechargeScope(draft)) return json(res, 400, { ok: false, message: "该优惠券不适用于猫粮充值。" });
      if (!isValidPeriod(draft)) return json(res, 400, { ok: false, message: "优惠券不在有效期内。" });

      const couponClaims = claims.filter((claim) => draftOf(claim).couponId === couponId);
      const userClaims = couponClaims.filter((claim) => draftOf(claim).userId === userId);
      const limit = totalLimit(draft);
      if (Number.isFinite(limit) && couponClaimedCount(draft, couponClaims) >= limit) return json(res, 400, { ok: false, message: "优惠券已领完。" });
      if (userClaims.length >= claimLimit(draft)) return json(res, 400, { ok: false, message: "已达到领取上限。" });

      const now = new Date().toISOString();
      const claimItem = {
        type: CLAIM_TYPE,
        slug: `${CLAIM_TYPE}-${couponId}-${userId}-${Date.now()}`,
        title: `${draft.name || coupon.title || "优惠券"} / ${userId}`,
        status: "published",
        enabled: true,
        sort: Date.now(),
        draft: {
          userId,
          couponId,
          couponCode: draft.code || "",
          couponName: draft.name || coupon.title || "优惠券",
          status: "unused",
          claimedAt: now
        },
        created_by: userId,
        created_at: now,
        updated_by: userId,
        updated_at: now
      };
      const rows = await supabaseFetch("", { method: "POST", body: JSON.stringify(claimItem) });
      const nextDraft = { ...draft, claimedCount: couponClaimedCount(draft, couponClaims) + 1 };
      await supabaseFetch(`?id=eq.${encodeURIComponent(couponId)}`, {
        method: "PATCH",
        body: JSON.stringify({ draft: nextDraft, updated_by: "coupon_claim", updated_at: now })
      });
      return json(res, 200, { ok: true, message: "优惠券领取成功，已放入“我的优惠券”。", claim: rows?.[0] || claimItem });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "优惠券接口异常" });
  }
}