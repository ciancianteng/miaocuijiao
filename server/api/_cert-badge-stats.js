/**
 * Badge statistics. Attribution comes ONLY from orders.cert_badge_snapshot (frozen at bind time),
 * never from the companion's current badges. Money comes from the settlement ledger:
 *
 *   gross              orders.total_amount (child row for multi-companion orders; parents skipped)
 *   refund             boss_refund_requests status=paid  (paid_amount_rm, legacy name — cat food)
 *   actualSettled      gross − refund
 *   companionIncome    settlement snapshot (orders.companion_income) − clawbacks on the income tx
 *   platformCommission actualSettled − companionIncome
 *
 * Counted orders: settled (settlement_status=settled or a companion_income tx exists — test parties
 * are never settled), status completed/reviewed, actualSettled > 0. Each order id counts once.
 */
import { db, readOrderBadgeSnapshot, listAssignments, listCommissionLog, isSchemaMissing, viewAssignment } from "./_cert-badge-ledger.js";
import { readCertTags, toAdminCertTag } from "./_companion-cert-tags-store.js";
import { resolveCompanionPublicCode, resolveBossPublicCode } from "./_account-codes.js";

export const COMPLETED_STATUSES = ["completed", "reviewed"];
const TZ_OFFSET_MS = 8 * 3600 * 1000; // Malaysia (UTC+8) calendar days / months

export function m(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function localParts(date) {
  const d = new Date(date.getTime() + TZ_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
}
function localMidnightUtc(y, mo, d) {
  return new Date(Date.UTC(y, mo, d) - TZ_OFFSET_MS);
}
export function monthKey(iso) {
  if (!iso) return "";
  const p = localParts(new Date(iso));
  return `${p.y}-${String(p.mo + 1).padStart(2, "0")}`;
}
export function localDate(iso) {
  if (!iso) return "";
  const p = localParts(new Date(iso));
  return `${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** range: today | week | month | custom | all  → [fromIso, toIso) in Malaysia time. */
export function rangeBounds({ range = "all", from = "", to = "", year = 0, month = 0, now = new Date() } = {}) {
  const p = localParts(now);
  const key = String(range || "all");
  if (year && month) {
    const y = Number(year);
    const mo = Number(month) - 1;
    return { range: "month_of", fromIso: localMidnightUtc(y, mo, 1).toISOString(), toIso: localMidnightUtc(y, mo + 1, 1).toISOString() };
  }
  if (key === "today") {
    return { range: key, fromIso: localMidnightUtc(p.y, p.mo, p.d).toISOString(), toIso: localMidnightUtc(p.y, p.mo, p.d + 1).toISOString() };
  }
  if (key === "week") {
    const back = (p.wd + 6) % 7; // Monday start
    return { range: key, fromIso: localMidnightUtc(p.y, p.mo, p.d - back).toISOString(), toIso: localMidnightUtc(p.y, p.mo, p.d + 1).toISOString() };
  }
  if (key === "month") {
    return { range: key, fromIso: localMidnightUtc(p.y, p.mo, 1).toISOString(), toIso: localMidnightUtc(p.y, p.mo + 1, 1).toISOString() };
  }
  if (key === "custom") {
    const re = /^(\d{4})-(\d{2})-(\d{2})$/;
    const a = re.exec(String(from || ""));
    const b = re.exec(String(to || from || ""));
    if (!a || !b) throw Object.assign(new Error("自定义日期格式应为 YYYY-MM-DD"), { status: 400 });
    const fromD = localMidnightUtc(+a[1], +a[2] - 1, +a[3]);
    const toD = localMidnightUtc(+b[1], +b[2] - 1, +b[3] + 1);
    if (toD <= fromD) throw Object.assign(new Error("结束日期不能早于开始日期"), { status: 400 });
    return { range: key, fromIso: fromD.toISOString(), toIso: toD.toISOString() };
  }
  return { range: "all", fromIso: "", toIso: "" };
}

export function parseClawbacks(note = "") {
  let partial = 0;
  const re = /\[\[PARTIAL_CLAWBACK\]\](\{[^\n]*\})/g;
  let hit;
  while ((hit = re.exec(String(note || "")))) {
    try {
      partial += m(JSON.parse(hit[1]).clawAmount);
    } catch {
      /* malformed audit line: ignore */
    }
  }
  return { partial: m(partial), full: /\[\[CLAWBACK\]\]/.test(String(note || "")) };
}

function settlementMeta(order = {}) {
  const raw = String(order.settlement_note || "");
  const i = raw.indexOf("MCJ_SETTLEMENT:");
  if (i < 0) return {};
  try {
    return JSON.parse(raw.slice(i + "MCJ_SETTLEMENT:".length).trim().split("\n")[0]) || {};
  } catch {
    return {};
  }
}

/** One order → ledger figures, or null when the order is not a settled badge-attributed child order. */
export function orderFigures(order = {}, incomeTxs = [], refunds = []) {
  if (!order?.id || !order.companion_id) return null;
  if (String(order.order_type || "") === "multi_group") return null;
  const snap = readOrderBadgeSnapshot(order);
  if (!snap) return null;
  const txs = (incomeTxs || []).filter(
    (t) => String(t.order_id) === String(order.id) && (!t.user_id || String(t.user_id) === String(order.companion_id))
  );
  const settled = String(order.settlement_status || "") === "settled" || txs.length > 0;
  if (!settled) return null;
  const live = txs.filter((t) => String(t.status || "") !== "cancelled");
  const gross = m(order.total_amount);
  const refundRows = (refunds || []).filter((r) => String(r.order_id) === String(order.id) && String(r.status || "") === "paid");
  const refund = Math.min(gross, m(refundRows.reduce((n, r) => n + m(r.paid_amount_rm ?? r.amount_rm), 0)));
  let base;
  if (txs.length && !live.length) base = 0;
  else if (order.companion_income != null && order.companion_income !== "") base = m(order.companion_income);
  else base = m(Math.max(0, ...live.map((t) => m(t.amount))));
  const partial = m(live.reduce((n, t) => n + parseClawbacks(t.note).partial, 0));
  const companionIncome = m(Math.max(0, base - partial));
  const actualSettled = m(Math.max(0, gross - refund));
  const platformCommission = m(actualSettled - companionIncome);
  const status = String(order.status || "");
  const meta = settlementMeta(order);
  const shareRate =
    order.companion_commission_rate_snapshot != null && order.companion_commission_rate_snapshot !== ""
      ? m(order.companion_commission_rate_snapshot)
      : meta.companionShareRate != null
        ? m(meta.companionShareRate)
        : order.platform_fee_rate != null
          ? m(100 - Number(order.platform_fee_rate))
          : null;
  return {
    orderId: String(order.id),
    orderNo: order.order_no || "",
    parentOrderId: order.parent_order_id || "",
    status,
    completedAt: order.completed_at || "",
    bossId: order.boss_id || "",
    companionId: String(order.companion_id),
    companionProfileId: snap.companionProfileId || "",
    badgeIds: snap.badgeIds.map(String),
    badgeNames: (snap.badges || []).map((b) => b.name),
    commissionBadgeId: meta.certBadgeId || snap.commission?.badgeId || "",
    commissionBadgeName: meta.certBadgeName || snap.commission?.badgeName || "",
    commissionSource: meta.commissionSource || "",
    companionShareRate: shareRate,
    gross,
    refund,
    actualSettled,
    companionIncome,
    platformCommission,
    duplicateIncomeTx: live.length > 1,
    // Admin refund marks the order "refunded" even for a partial amount; that order still completed at its actual amount.
    effective: actualSettled > 0 && (COMPLETED_STATUSES.includes(status) || (status === "refunded" && refund > 0 && refund < gross)),
    refunded: refund > 0,
  };
}

export function emptyTotals() {
  return { completedCount: 0, gross: 0, actualSettled: 0, companionIncome: 0, platformCommission: 0, refundAmount: 0, refundedOrders: 0 };
}

export function sumFigures(figs = []) {
  const t = emptyTotals();
  const seen = new Set();
  for (const f of figs) {
    if (!f || seen.has(f.orderId)) continue;
    seen.add(f.orderId);
    if (f.refund > 0) {
      t.refundAmount += f.refund;
      t.refundedOrders += 1;
    }
    if (!f.effective) continue;
    t.completedCount += 1;
    t.gross += f.gross;
    t.actualSettled += f.actualSettled;
    t.companionIncome += f.companionIncome;
    t.platformCommission += f.platformCommission;
  }
  for (const k of Object.keys(t)) if (k !== "completedCount" && k !== "refundedOrders") t[k] = m(t[k]);
  return t;
}

export function inRange(iso, { fromIso = "", toIso = "" } = {}) {
  if (!fromIso && !toIso) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (fromIso && t < new Date(fromIso).getTime()) return false;
  if (toIso && t >= new Date(toIso).getTime()) return false;
  return true;
}

export function monthlyRows(rows = []) {
  const by = new Map();
  const bucket = (k) => {
    if (!by.has(k)) by.set(k, { settled: [], takenCount: 0, takenAmount: 0 });
    return by.get(k);
  };
  for (const r of rows) {
    if (r.taken) {
      const tk = monthKey(r.takenAt);
      if (tk) {
        bucket(tk).takenCount += 1;
        bucket(tk).takenAmount += m(r.gross);
      }
    }
    const k = r.settled === false ? "" : monthKey(r.completedAt);
    if (k) bucket(k).settled.push(r);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, b]) => ({ month, takenCount: b.takenCount, takenAmount: m(b.takenAmount), ...sumFigures(b.settled) }));
}

const STATUS_LABELS = {
  pending: "待付款",
  awaiting_payment: "待付款",
  payment_review: "付款审核中",
  paid: "待接单",
  open: "待接单",
  published: "待接单",
  claimed: "待陪玩确认",
  ready: "待开始",
  accepted: "已接单",
  confirmed: "已接单",
  in_progress: "进行中",
  waiting_boss_confirm: "待老板确认完成",
  completed: "已完成",
  reviewed: "已完成（已评价）",
  refund_requested: "退款处理中",
  refunded: "已退款",
  cancelled: "已取消",
};

/**
 * Every badge-attributed child order (any status) → activity row. Settled ledger figures are merged in
 * when present, so taken / completed / money all come from the same order + ledger source.
 *   taken      the companion confirmed the order (accepted_at / started_at / completed_at) and it is not cancelled
 *   takenAt    when it was taken (range filter for 接单 stats); completedAt drives completed / money stats
 */
export function orderActivity(order = {}, fig = null) {
  if (!order?.id || !order.companion_id) return null;
  if (String(order.order_type || "") === "multi_group") return null;
  const snap = readOrderBadgeSnapshot(order);
  if (!snap) return null;
  const status = String(order.status || "");
  const takenAt = order.accepted_at || order.started_at || order.completed_at || "";
  const settledLabel = fig ? (fig.effective ? (fig.refund > 0 ? "已完成（部分退款）" : "已完成") : status === "refunded" || fig.refund >= fig.gross ? "已退款" : "") : "";
  return {
    orderId: String(order.id),
    orderNo: order.order_no || "",
    parentOrderId: order.parent_order_id || "",
    status,
    statusLabel: settledLabel || STATUS_LABELS[status] || status || "-",
    createdAt: order.created_at || "",
    takenAt,
    completedAt: order.completed_at || "",
    taken: !!takenAt && status !== "cancelled",
    bossId: order.boss_id || "",
    companionId: String(order.companion_id),
    companionProfileId: snap.companionProfileId || "",
    badgeIds: snap.badgeIds.map(String),
    badgeNames: (snap.badges || []).map((b) => b.name),
    gross: m(order.total_amount),
    settled: !!fig,
    effective: !!fig?.effective,
    refund: fig ? fig.refund : 0,
    actualSettled: fig ? fig.actualSettled : 0,
    companionIncome: fig ? fig.companionIncome : 0,
    platformCommission: fig ? fig.platformCommission : 0,
    companionShareRate: fig ? fig.companionShareRate : null,
    commissionBadgeId: fig?.commissionBadgeId || snap.commission?.badgeId || "",
    commissionBadgeName: fig?.commissionBadgeName || snap.commission?.badgeName || "",
  };
}

/** 接单 stats by takenAt, completed / money stats by completedAt (settled only). Order ids count once. */
export function activityTotals(rows = [], bounds = {}) {
  const seen = new Set();
  let takenCount = 0;
  let takenAmount = 0;
  const settled = [];
  for (const r of rows) {
    if (!r || seen.has(r.orderId)) continue;
    seen.add(r.orderId);
    if (r.taken && inRange(r.takenAt, bounds)) {
      takenCount += 1;
      takenAmount += m(r.gross);
    }
    if (r.settled && inRange(r.completedAt, bounds)) settled.push(r);
  }
  return { takenCount, takenAmount: m(takenAmount), ...sumFigures(settled) };
}

function touchesRange(r, bounds) {
  if (!bounds.fromIso && !bounds.toIso) return true;
  return [r.createdAt, r.takenAt, r.completedAt].some((iso) => iso && inRange(iso, bounds));
}

function belongsTo(r, who) {
  if (!who) return true;
  if (who.profileId && r.companionProfileId) return r.companionProfileId === String(who.profileId);
  return !!who.userId && r.companionId === String(who.userId);
}

// ---------------------------------------------------------------- loaders

async function pageAll(table, query, pageSize = 1000, max = 20000) {
  const out = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const rows = await db(table, `${query}&limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function inChunks(ids, fn, size = 80) {
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await fn(list.slice(i, i + size))));
  return out;
}

const ORDER_COLS =
  "id,order_no,status,settlement_status,settlement_note,order_type,parent_order_id,boss_id,companion_id,total_amount,companion_income,platform_fee,platform_fee_rate,companion_commission_rate_snapshot,created_at,accepted_at,started_at,completed_at,cert_badge_snapshot";

/** Columns the stats cannot work without; the rest are optional settlement extras (older schemas lack some). */
const REQUIRED_ORDER_COLS = new Set(["id", "status", "companion_id", "total_amount", "completed_at", "cert_badge_snapshot"]);

/** includeOpen: every badge-attributed order (any status, date filtering done by the caller). */
export async function loadBadgeOrders({ tagId = "", fromIso = "", toIso = "", includeOpen = false, companionId = "" } = {}) {
  const filters = includeOpen
    ? ["cert_badge_snapshot=not.is.null", "order=created_at.desc"]
    : ["cert_badge_snapshot=not.is.null", "completed_at=not.is.null", "order=completed_at.desc"];
  if (tagId) filters.push(`cert_badge_snapshot=cs.${encodeURIComponent(JSON.stringify({ badgeIds: [String(tagId)] }))}`);
  if (companionId) filters.push(`companion_id=eq.${encodeURIComponent(companionId)}`);
  if (!includeOpen && fromIso) filters.push(`completed_at=gte.${encodeURIComponent(fromIso)}`);
  if (!includeOpen && toIso) filters.push(`completed_at=lt.${encodeURIComponent(toIso)}`);
  let cols = ORDER_COLS.split(",");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await pageAll("orders", `?select=${cols.join(",")}&${filters.join("&")}`);
    } catch (err) {
      if (!isSchemaMissing(err)) throw err;
      const missing = String(err?.message || err || "").match(/orders\.([a-z0-9_]+)/i)?.[1] || "";
      if (!missing || REQUIRED_ORDER_COLS.has(missing) || !cols.includes(missing)) return [];
      cols = cols.filter((c) => c !== missing);
    }
  }
  return [];
}

async function loadLedger(orders) {
  const ids = orders.map((o) => o.id);
  const incomeTxs = await inChunks(ids, (chunk) =>
    db(
      "transactions",
      `?order_id=in.(${chunk.join(",")})&transaction_type=eq.companion_income&select=id,order_id,user_id,amount,status,note&limit=2000`
    )
  );
  const refunds = await inChunks(ids, (chunk) =>
    db(
      "boss_refund_requests",
      `?order_id=in.(${chunk.join(",")})&status=eq.paid&select=id,order_id,status,amount_rm,paid_amount_rm,paid_at&limit=2000`
    ).catch((err) => {
      if (isSchemaMissing(err)) return [];
      throw err;
    })
  );
  return { incomeTxs, refunds };
}

async function figuresFor(orders) {
  const { incomeTxs, refunds } = await loadLedger(orders);
  const txBy = new Map();
  for (const t of incomeTxs) {
    const k = String(t.order_id);
    if (!txBy.has(k)) txBy.set(k, []);
    txBy.get(k).push(t);
  }
  const rfBy = new Map();
  for (const r of refunds) {
    const k = String(r.order_id);
    if (!rfBy.has(k)) rfBy.set(k, []);
    rfBy.get(k).push(r);
  }
  return orders.map((o) => orderFigures(o, txBy.get(String(o.id)) || [], rfBy.get(String(o.id)) || [])).filter(Boolean);
}

async function activityFor(orders) {
  const figs = await figuresFor(orders);
  const figBy = new Map(figs.map((f) => [f.orderId, f]));
  return orders.map((o) => orderActivity(o, figBy.get(String(o.id)) || null)).filter(Boolean);
}

async function loadCompanionProfiles({ ids = [], userIds = [] } = {}) {
  const cols = "id,user_id,nickname,companion_code,companion_uid";
  const a = await inChunks(ids, (c) => db("companion_profiles", `?id=in.(${c.join(",")})&select=${cols}`));
  const b = await inChunks(userIds, (c) => db("companion_profiles", `?user_id=in.(${c.join(",")})&select=${cols}`));
  const byId = new Map();
  const byUser = new Map();
  for (const r of [...a, ...b]) {
    byId.set(String(r.id), r);
    if (r.user_id) byUser.set(String(r.user_id), r);
  }
  return { byId, byUser };
}

async function loadAccounts(userIds = []) {
  const run = (cols) => inChunks(userIds, (c) => db("profiles", `?id=in.(${c.join(",")})&select=${cols}`));
  let rows;
  try {
    rows = await run("id,display_name,email,status,boss_uid");
  } catch (err) {
    if (!isSchemaMissing(err)) throw err;
    rows = await run("id,display_name,email,status");
  }
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** uid = the companion's public UID shown across admin (PW code, as in 订单管理「陪玩 UID」). */
function companionLabel(cp = {}, account = {}) {
  const pwCode = resolveCompanionPublicCode(cp) || "";
  return {
    pwCode,
    uid: pwCode || (cp.companion_uid != null && cp.companion_uid !== "" ? String(cp.companion_uid) : ""),
    nickname: cp.nickname || account.display_name || "",
  };
}

const MEMBER_RANK = { active: 0, pending_removal: 1, removed: 2 };

function orderView(r, byId, byUser, accounts) {
  const cp = (r.companionProfileId && byId.get(r.companionProfileId)) || byUser.get(r.companionId) || {};
  const acc = accounts.get(r.companionId) || accounts.get(String(cp.user_id || "")) || {};
  const boss = accounts.get(String(r.bossId)) || {};
  return {
    ...r,
    ...companionLabel(cp, acc),
    companionProfileId: r.companionProfileId || String(cp.id || ""),
    bossName: boss.display_name || "",
    bossCode: resolveBossPublicCode(boss) || "",
  };
}

// ---------------------------------------------------------------- API views

function badgeTotals(figs, tagId) {
  return sumFigures(figs.filter((f) => f.badgeIds.includes(String(tagId))));
}

function withBadge(rows, tagId) {
  return rows.filter((r) => r.badgeIds.includes(String(tagId)));
}

function loadAllAssignments(filter = {}) {
  return listAssignments({ limit: 20000, ...filter }).catch((err) => {
    if (isSchemaMissing(err)) return [];
    throw err;
  });
}

function pickMembership(assignments) {
  const memberOf = new Map();
  for (const a of assignments) {
    const pid = String(a.companion_profile_id);
    const prev = memberOf.get(pid);
    if (!prev || MEMBER_RANK[a.status] < MEMBER_RANK[prev.status]) memberOf.set(pid, a);
  }
  return memberOf;
}

function monthBrief(t) {
  return { takenCount: t.takenCount, completedCount: t.completedCount, actualSettled: t.actualSettled, platformCommission: t.platformCommission };
}

/** who: resolved holder filter { profileId, userId, label } (optional); tagId narrows to one badge (optional). */
export async function badgeOverview({ range = "all", from = "", to = "", tagId = "", who = null } = {}) {
  const bounds = rangeBounds({ range, from, to });
  const monthBounds = rangeBounds({ range: "month" });
  const [allTags, openAll] = await Promise.all([readCertTags(), loadAllAssignments({ statuses: ["active", "pending_removal"] })]);
  if (tagId && !allTags.some((t) => String(t.id) === String(tagId))) throw Object.assign(new Error("认证勋章不存在"), { status: 404 });
  const tags = tagId ? allTags.filter((t) => String(t.id) === String(tagId)) : allTags;
  const openRows = who?.profileId ? openAll.filter((r) => String(r.companion_profile_id) === String(who.profileId)) : openAll;
  const orders = await loadBadgeOrders({ includeOpen: true, tagId: tagId ? String(tagId) : "", companionId: who?.userId || "" });
  const rows = (await activityFor(orders)).filter((r) => belongsTo(r, who));
  const badges = tags.map((tag) => {
    const id = String(tag.id);
    const holders = openRows.filter((r) => String(r.tag_id) === id);
    const mine = withBadge(rows, id);
    return {
      ...toAdminCertTag(tag),
      holders: holders.length,
      pendingRemoval: holders.filter((r) => r.status === "pending_removal").length,
      ...activityTotals(mine, bounds),
      commissionOrders: mine.filter((r) => r.effective && r.commissionBadgeId === id && inRange(r.completedAt, bounds)).length,
      month: monthBrief(activityTotals(mine, monthBounds)),
    };
  });
  const scoped = tagId ? withBadge(rows, tagId) : rows;
  const holderIds = new Set(openRows.filter((r) => !tagId || String(r.tag_id) === String(tagId)).map((r) => String(r.companion_profile_id)));
  return {
    range: bounds,
    filters: { tagId: tagId ? String(tagId) : "", companion: who?.label || null },
    kpis: { ...activityTotals(scoped, bounds), holders: holderIds.size, badges: tags.length },
    month: activityTotals(scoped, monthBounds),
    badges,
    note: "接单数量按陪玩确认接单时间统计；已完成单量 / 金额 / 利润按完成时间统计（只计已结算订单）。多勋章陪玩的订单会同时计入其持有的每个勋章，顶部合计按订单去重。历史订单按绑定陪玩时的勋章快照归属。",
  };
}

export async function badgeDetail({ tagId, range = "all", from = "", to = "", who = null } = {}) {
  const tags = await readCertTags();
  const tag = tags.find((t) => String(t.id) === String(tagId));
  if (!tag) throw Object.assign(new Error("认证勋章不存在"), { status: 404 });
  const bounds = rangeBounds({ range, from, to });
  const monthBounds = rangeBounds({ range: "month" });
  const assignmentsAll = await loadAllAssignments({ tagId: String(tag.id) });
  const orders = await loadBadgeOrders({ tagId: String(tag.id), includeOpen: true, companionId: who?.userId || "" });
  const rows = (await activityFor(orders)).filter((r) => belongsTo(r, who));
  const rangeRows = rows.filter((r) => touchesRange(r, bounds));

  const { byId, byUser } = await loadCompanionProfiles({
    ids: [...assignmentsAll.map((a) => a.companion_profile_id), ...rows.map((r) => r.companionProfileId)],
    userIds: rows.map((r) => r.companionId),
  });
  const accounts = await loadAccounts([...byId.values()].map((p) => p.user_id).concat(rangeRows.map((r) => r.bossId)));

  const memberAll = pickMembership(assignmentsAll);
  const holderOptions = [...memberAll.entries()].map(([pid, a]) => {
    const cp = byId.get(pid) || {};
    return { companionProfileId: pid, status: a.status, ...companionLabel(cp, accounts.get(String(cp.user_id || "")) || {}) };
  });
  const members = [...memberAll.entries()]
    .filter(([pid]) => !who?.profileId || pid === String(who.profileId))
    .map(([pid, a]) => {
      const cp = byId.get(pid) || {};
      const acc = accounts.get(String(cp.user_id || "")) || {};
      const mine = rows.filter((r) => belongsTo(r, { profileId: pid, userId: cp.user_id }));
      const t = activityTotals(mine, bounds);
      return {
        ...viewAssignment(a, tag),
        ...companionLabel(cp, acc),
        companionUserId: cp.user_id || "",
        badgeName: tag.name,
        accountStatus: acc.status || "",
        joinedAt: a.granted_at || a.created_at || "",
        orderCount: mine.filter((r) => touchesRange(r, bounds)).length,
        takenCount: t.takenCount,
        takenAmount: t.takenAmount,
        completedCount: t.completedCount,
        gross: t.gross,
        actualSettled: t.actualSettled,
        companionIncome: t.companionIncome,
        platformCommission: t.platformCommission,
        refundAmount: t.refundAmount,
      };
    });
  members.sort((a, b) => MEMBER_RANK[a.status] - MEMBER_RANK[b.status] || b.takenCount - a.takenCount || b.platformCommission - a.platformCommission);

  return {
    badge: { ...toAdminCertTag(tag), holders: [...memberAll.values()].filter((x) => x.status !== "removed").length },
    range: bounds,
    filters: { companion: who?.label || null },
    holderOptions,
    kpis: activityTotals(rows, bounds),
    month: activityTotals(rows, monthBounds),
    members,
    orders: rangeRows.map((r) => orderView(r, byId, byUser, accounts)),
    monthly: monthlyRows(rows),
    commissionLog: await listCommissionLog(String(tag.id)),
  };
}

/** One holder: every related order (any status) + totals; tagId limits to orders attributed to that badge. */
export async function badgeHolder({ tagId = "", who, range = "all", from = "", to = "" } = {}) {
  if (!who?.profileId && !who?.userId) throw Object.assign(new Error("缺少陪玩"), { status: 400 });
  const tags = await readCertTags();
  const tag = tagId ? tags.find((t) => String(t.id) === String(tagId)) : null;
  if (tagId && !tag) throw Object.assign(new Error("认证勋章不存在"), { status: 404 });
  const bounds = rangeBounds({ range, from, to });
  const orders = await loadBadgeOrders({ includeOpen: true, tagId: tag ? String(tag.id) : "", companionId: who.userId || "" });
  const rows = (await activityFor(orders)).filter((r) => belongsTo(r, who));
  const rangeRows = rows.filter((r) => touchesRange(r, bounds));
  const assignments = who.profileId ? await loadAllAssignments({ profileIds: [who.profileId] }) : [];
  const { byId, byUser } = await loadCompanionProfiles({ ids: [who.profileId].filter(Boolean), userIds: [who.userId].filter(Boolean) });
  const cp = byId.get(String(who.profileId || "")) || byUser.get(String(who.userId || "")) || {};
  const accounts = await loadAccounts([cp.user_id || who.userId].filter(Boolean).concat(rangeRows.map((r) => r.bossId)));
  const acc = accounts.get(String(cp.user_id || who.userId || "")) || {};
  const tagBy = new Map(tags.map((t) => [String(t.id), t]));
  const badgeRows = assignments
    .map((a) => viewAssignment(a, tagBy.get(String(a.tag_id))))
    .sort((a, b) => MEMBER_RANK[a.status] - MEMBER_RANK[b.status]);
  const current = tag ? badgeRows.find((a) => String(a.tagId) === String(tag.id)) || null : null;
  return {
    holder: { ...companionLabel(cp, acc), companionProfileId: String(cp.id || who.profileId || ""), companionUserId: String(cp.user_id || who.userId || ""), accountStatus: acc.status || "" },
    badge: tag ? toAdminCertTag(tag) : null,
    assignment: current,
    badges: badgeRows,
    range: bounds,
    kpis: activityTotals(rows, bounds),
    allTime: activityTotals(rows, {}),
    orders: rangeRows.map((r) => orderView(r, byId, byUser, accounts)),
    monthly: monthlyRows(rows),
  };
}

function csvCell(c) {
  return `"${String(c ?? "").replace(/"/g, '""')}"`;
}
function csvLine(cells) {
  return cells.map(csvCell).join(",");
}
const f2 = (v) => m(v).toFixed(2);

export async function badgeMonthlyExport({ year, month, tagId = "" } = {}) {
  const y = Number(year);
  const mo = Number(month);
  if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(mo) || mo < 1 || mo > 12) {
    throw Object.assign(new Error("请选择导出的年份和月份"), { status: 400 });
  }
  const tags = await readCertTags();
  const picked = tagId ? tags.filter((t) => String(t.id) === String(tagId)) : tags;
  if (tagId && !picked.length) throw Object.assign(new Error("认证勋章不存在"), { status: 404 });
  const bounds = rangeBounds({ year: y, month: mo });
  const openRows = await listAssignments({ statuses: ["active", "pending_removal"], limit: 20000 }).catch(() => []);
  const orders = await loadBadgeOrders({ tagId: tagId ? String(tagId) : "", ...bounds });
  const figs = await figuresFor(orders);
  const { byId, byUser } = await loadCompanionProfiles({ ids: figs.map((f) => f.companionProfileId), userIds: figs.map((f) => f.companionId) });
  const accounts = await loadAccounts(figs.map((f) => f.companionId));

  const summaryHead = ["勋章名称", "持有人数", "完成单量", "订单总金额", "实际结算金额", "陪玩收入", "平台佣金", "退款金额"];
  const summary = picked.map((t) => {
    const s = badgeTotals(figs, t.id);
    return [t.name, openRows.filter((r) => String(r.tag_id) === String(t.id)).length, s.completedCount, f2(s.gross), f2(s.actualSettled), f2(s.companionIncome), f2(s.platformCommission), f2(s.refundAmount)];
  });
  const detailHead = ["勋章名称", "订单号", "陪玩PW编号", "陪玩昵称", "完成日期", "订单金额", "实际结算金额", "陪玩收入", "平台佣金", "退款金额", "佣金勋章", "陪玩分成%"];
  const detail = [];
  for (const t of picked) {
    for (const f of figs.filter((x) => x.badgeIds.includes(String(t.id)))) {
      const cp = (f.companionProfileId && byId.get(f.companionProfileId)) || byUser.get(f.companionId) || {};
      const who = companionLabel(cp, accounts.get(f.companionId) || {});
      detail.push([t.name, f.orderNo, who.pwCode, who.nickname, localDate(f.completedAt), f2(f.gross), f2(f.actualSettled), f2(f.companionIncome), f2(f.platformCommission), f2(f.refund), f.commissionBadgeName, f.companionShareRate == null ? "" : f2(f.companionShareRate)]);
    }
  }
  const ym = `${y}_${String(mo).padStart(2, "0")}`;
  const scope = tagId ? String(picked[0].name).replace(/[\\/:*?"<>|\s]+/g, "_") : "ALL";
  const summaryCsv = [csvLine(summaryHead), ...summary.map(csvLine)].join("\n");
  const ordersCsv = [csvLine(detailHead), ...detail.map(csvLine)].join("\n");
  return {
    fileBase: `MeowCuiJiao_CertBadge_${scope}_${ym}`,
    month: `${y}-${String(mo).padStart(2, "0")}`,
    summaryCount: summary.length,
    orderCount: detail.length,
    summaryCsv,
    ordersCsv,
    csv: `月度汇总 ${y}-${String(mo).padStart(2, "0")}\n${summaryCsv}\n\n订单明细\n${ordersCsv}`,
    formats: ["csv", "xlsx_via_csv"],
  };
}
