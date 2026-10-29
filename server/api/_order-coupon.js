/**
 * Order coupons. Boss payable is reduced; companion wage stays on the original total.
 * Club subsidy is recorded separately and is never taken from companion income.
 */
const COUPON_TYPE = "marketing_coupons";
const REDEEM_TYPE = "coupon_redemptions";
const MARKER = "[[COUPON]]";

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function text(value) {
  return String(value || "").trim();
}

function draftOf(item) {
  return item && item.draft && typeof item.draft === "object" ? item.draft : {};
}

function malaysiaNowMs() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`);
}

function dayStart(date) {
  const day = text(date).slice(0, 10);
  return day ? Date.parse(`${day}T00:00:00+08:00`) : NaN;
}

function dayEnd(date) {
  const day = text(date).slice(0, 10);
  return day ? Date.parse(`${day}T23:59:59+08:00`) : NaN;
}

function enabled(item) {
  if (!item || item.enabled === false) return false;
  const status = text(item.status).toLowerCase();
  return !["disabled", "unpublished", "ended", "paused"].includes(status);
}

function campaignOpen(draft) {
  const state = text(draft.campaignStatus || draft.campaign_status || "active").toLowerCase();
  return !["paused", "ended", "disabled"].includes(state);
}

function inPeriod(draft, now = malaysiaNowMs()) {
  const start = dayStart(draft.startAt || draft.startDate);
  const end = dayEnd(draft.endAt || draft.endDate);
  if (Number.isFinite(start) && start > now) return false;
  if (Number.isFinite(end) && end < now) return false;
  return true;
}

function issueDirect(draft) {
  const value = text(draft.issueMethod || draft.issue_method || draft.claimMethod || "direct").toLowerCase();
  return ["direct", "auto", "public", "直接可用", "全平台"].includes(value) || value === "";
}

function audience(draft) {
  return text(draft.audience || draft.scope || "all").toLowerCase();
}

function listOf(value) {
  return text(value)
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function discountAmount(draft, original) {
  const type = text(draft.type || "fixed");
  const value = money(draft.value);
  if (type === "percent") return money(original * (Math.min(100, Math.max(0, value)) / 100));
  if (type === "discount") {
    const fold = Number(draft.value);
    if (fold > 0 && fold < 10) return money(original * (1 - fold / 10));
    return money(original * (Math.min(100, Math.max(0, fold)) / 100));
  }
  return value;
}

export function quoteCoupon(item, input = {}) {
  const draft = draftOf(item);
  const original = money(input.amount);
  const reasons = [];
  if (!enabled(item) || !campaignOpen(draft)) reasons.push("活动已暂停或结束");
  if (!inPeriod(draft, input.now)) reasons.push("不在有效期内");
  const threshold = money(draft.threshold);
  if (threshold > 0 && original + 0.001 < threshold) reasons.push(`未满 ${threshold.toFixed(2)} 猫粮`);
  const who = audience(draft);
  if (who === "users" || who === "user" || who === "指定用户") {
    const ids = listOf(draft.userIds || draft.user_ids);
    if (!ids.includes(text(input.bossId))) reasons.push("仅指定老板可用");
  }
  if (who === "new_user" || who === "新用户专属") {
    if (!input.isNewUser) reasons.push("仅新用户可用");
  }
  const services = listOf(draft.serviceIds || draft.service_ids);
  if ((who === "service" || who === "指定服务" || services.length) && input.serviceId && services.length && !services.includes(text(input.serviceId))) {
    reasons.push("不适用于当前服务");
  }
  const games = listOf(draft.games || draft.gameNames);
  if (games.length && input.game && !games.some((name) => text(input.game).includes(name))) reasons.push("不适用于当前游戏");
  if (!issueDirect(draft)) {
    const claimed = (input.claims || []).some((claim) => draftOf(claim).couponId === item.id && draftOf(claim).userId === input.bossId && draftOf(claim).status !== "used");
    if (!claimed) reasons.push("需要先领取");
  }
  const usedByUser = (input.redemptions || []).filter((row) => {
    const data = draftOf(row);
    return data.couponId === item.id && data.bossId === input.bossId && data.status !== "released";
  }).length;
  const perUser = Math.max(1, Math.floor(Number(draft.perUserLimit || draft.claimLimitPerUser || 1) || 1));
  if (usedByUser >= perUser) reasons.push("已达到每人使用次数");
  const active = (input.redemptions || []).filter((row) => draftOf(row).couponId === item.id && draftOf(row).status !== "released");
  const totalLimit = Number(draft.totalLimit || 0);
  if (totalLimit > 0 && active.length >= totalLimit) reasons.push("活动数量已用完");
  const spent = active.reduce((sum, row) => sum + money(draftOf(row).discount), 0);
  const budget = money(draft.budget);
  const discount = Math.min(original, Math.max(0, discountAmount(draft, original)));
  if (budget > 0 && spent + discount > budget + 0.001) reasons.push("活动预算已用完");
  if (!(discount > 0)) reasons.push("优惠金额无效");
  const ok = reasons.length === 0 && original > 0;
  return {
    ok,
    id: item.id,
    name: draft.name || item.title || "优惠券",
    code: draft.code || "",
    type: draft.type || "fixed",
    discount: ok ? discount : 0,
    payable: ok ? money(original - discount) : original,
    threshold,
    startAt: text(draft.startAt || draft.startDate).slice(0, 10),
    endAt: text(draft.endAt || draft.endDate).slice(0, 10),
    condition: threshold > 0 ? `满 ${threshold.toFixed(2)} 猫粮可用` : "无最低消费",
    reason: reasons[0] || "",
    bearer: "club",
    stackable: false,
  };
}

export function couponMarker(snapshot) {
  return `${MARKER}${JSON.stringify(snapshot)}`;
}

export function readCouponSnapshot(order = {}) {
  const blob = `${order.description || ""}\n${order.notes || ""}\n${order.note || ""}`;
  const match = blob.match(/\[\[COUPON\]\](\{.*?\})/);
  if (!match) return null;
  try {
    const snap = JSON.parse(match[1]);
    if (!snap || !(money(snap.discount) > 0)) return null;
    return snap;
  } catch {
    return null;
  }
}

export function bossPayableAmount(order = {}) {
  const original = money(order.total_amount ?? order.totalAmount);
  const snap = readCouponSnapshot(order);
  if (!snap) return original;
  const discount = Math.min(original, money(snap.discount));
  return money(original - discount);
}

export function couponSettlement(order, companionNet, platformFee) {
  const snap = readCouponSnapshot(order);
  const original = money(order.total_amount ?? order.totalAmount);
  const wage = money(companionNet);
  const commission = money(platformFee);
  if (!snap) {
    return {
      originalAmount: original,
      wageBase: original,
      companionWage: wage,
      clubCommission: commission,
      subsidy: 0,
      clubNet: commission,
    };
  }
  const subsidy = Math.min(original, money(snap.discount));
  return {
    couponId: snap.couponId || "",
    couponName: snap.name || "",
    originalAmount: original,
    discount: subsidy,
    bossPaid: money(original - subsidy),
    wageBase: original,
    companionWage: wage,
    clubCommission: commission,
    subsidy,
    clubNet: money(commission - subsidy),
    bearer: "club",
  };
}

function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function contentFetch(path, init = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/platform_content_items${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  const textBody = await response.text();
  let body = null;
  try {
    body = textBody ? JSON.parse(textBody) : null;
  } catch {
    body = textBody;
  }
  if (!response.ok) {
    const error = new Error(body?.message || body?.hint || "优惠券数据读取失败");
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function loadCouponRows() {
  const [coupons, redemptions] = await Promise.all([
    contentFetch(`?type=eq.${encodeURIComponent(COUPON_TYPE)}&order=updated_at.desc&limit=200`).catch(() => []),
    contentFetch(`?type=eq.${encodeURIComponent(REDEEM_TYPE)}&order=created_at.desc&limit=2000`).catch(() => []),
  ]);
  return {
    coupons: Array.isArray(coupons) ? coupons : [],
    redemptions: Array.isArray(redemptions) ? redemptions : [],
  };
}

export async function reserveCoupon(row) {
  const now = new Date().toISOString();
  const slug = `${REDEEM_TYPE}-${row.orderId}`;
  const existing = await contentFetch(
    `?type=eq.${encodeURIComponent(REDEEM_TYPE)}&slug=eq.${encodeURIComponent(slug)}&limit=1`
  ).catch(() => []);
  const hit = Array.isArray(existing) ? existing[0] : null;
  const draft = { ...row, status: "reserved", reservedAt: now };
  if (hit && draftOf(hit).status !== "released") return hit;
  if (hit) {
    const patched = await contentFetch(`?id=eq.${encodeURIComponent(hit.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ draft, status: "published", enabled: true }),
    });
    return Array.isArray(patched) ? patched[0] : patched;
  }
  const saved = await contentFetch("", {
    method: "POST",
    body: JSON.stringify({
      id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: REDEEM_TYPE,
      slug,
      title: `${row.name || "优惠券"} / ${row.orderNo || row.orderId}`,
      status: "published",
      enabled: true,
      sort: 100,
      draft,
    }),
  });
  return Array.isArray(saved) ? saved[0] : saved;
}

export async function markCouponUsed(orderId) {
  if (!orderId) return;
  const rows = await contentFetch(
    `?type=eq.${encodeURIComponent(REDEEM_TYPE)}&slug=eq.${encodeURIComponent(`${REDEEM_TYPE}-${orderId}`)}&limit=1`
  ).catch(() => []);
  const hit = Array.isArray(rows) ? rows[0] : null;
  if (!hit || ["released", "used"].includes(draftOf(hit).status)) return;
  const usedAt = new Date().toISOString();
  const draft = { ...draftOf(hit), status: "used", usedAt };
  await contentFetch(`?id=eq.${encodeURIComponent(hit.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ draft, updated_at: usedAt }),
  }).catch(() => null);
}

export async function releaseCouponForOrder(orderId) {
  if (!orderId) return;
  const rows = await contentFetch(`?type=eq.${encodeURIComponent(REDEEM_TYPE)}&limit=50`).catch(() => []);
  const hit = (Array.isArray(rows) ? rows : []).find((item) => draftOf(item).orderId === orderId && draftOf(item).status !== "released");
  if (!hit) return;
  const draft = { ...draftOf(hit), status: "released", releasedAt: new Date().toISOString() };
  await contentFetch(`?id=eq.${encodeURIComponent(hit.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ draft, updated_at: draft.releasedAt }),
  }).catch(() => null);
}

export function findCoupon(rows, couponId, code) {
  const id = text(couponId);
  const token = text(code).toLowerCase();
  return (rows || []).find((item) => (id && item.id === id) || (token && text(draftOf(item).code).toLowerCase() === token)) || null;
}
