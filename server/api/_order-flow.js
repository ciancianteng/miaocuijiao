/**
 * Cross-portal order flow helpers:
 * - Public status aliases (draft / pending_grab / selecting / …) ↔ DB enum
 * - Boss intent markers (意向，不直接锁单)
 * - Shared grabber profile enrichment
 */
import { mapCompanionPublicFields } from "./_companion-public-map.js";
import { normalizeOrderStatus, orderStatusLabel } from "./_order-status.js";

/** Required public flow keys → DB mcj_order_status */
export const FLOW_TO_DB = Object.freeze({
  draft: "awaiting_payment",
  pending_grab: "pending",
  selecting: "waiting_boss_confirm",
  pending_companion_confirm: "claimed",
  confirmed: "confirmed",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
  expired: "cancelled", // DB enum has no expired; use cancelled + expire flag
});

/** DB → public flow key */
export const DB_TO_FLOW = Object.freeze({
  awaiting_payment: "draft",
  pending: "pending_grab",
  waiting_boss_confirm: "selecting",
  claimed: "pending_companion_confirm",
  confirmed: "confirmed",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
  refund_requested: "cancelled",
  refunded: "cancelled",
});

export const FLOW_STATUS_LABELS = Object.freeze({
  draft: "待付款",
  pending_grab: "等待陪玩抢单",
  selecting: "等待老板选择",
  pending_companion_confirm: "等待陪玩确认",
  confirmed: "进行中",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  expired: "已失效",
});

const INTENT_START = "[[BOSS_INTENT]]";
const INTENT_END = "[[/BOSS_INTENT]]";
const EXPIRED_MARKER = "[[ORDER_EXPIRED]]";

export function toDbStatus(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (FLOW_TO_DB[key]) return FLOW_TO_DB[key];
  return normalizeOrderStatus(key);
}

export function toFlowStatus(dbStatus, { expired = false } = {}) {
  if (expired) return "expired";
  const db = normalizeOrderStatus(dbStatus);
  return DB_TO_FLOW[db] || db;
}

export function flowStatusLabel(dbOrFlow, opts = {}) {
  const flow = FLOW_STATUS_LABELS[dbOrFlow] ? dbOrFlow : toFlowStatus(dbOrFlow, opts);
  return FLOW_STATUS_LABELS[flow] || orderStatusLabel(dbOrFlow, opts.portal || "boss");
}

export function isOrderExpired(order = {}) {
  const blob = `${order.note || ""}\n${order.description || ""}\n${order.cancel_reason || ""}`;
  return blob.includes(EXPIRED_MARKER) || /已失效|订单超时|expired/i.test(blob);
}

export function parseBossIntent(orderOrText = {}) {
  const raw =
    typeof orderOrText === "string"
      ? orderOrText
      : `${orderOrText.note || ""}\n${orderOrText.description || ""}`;
  const start = raw.indexOf(INTENT_START);
  const end = raw.indexOf(INTENT_END);
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start + INTENT_START.length, end).trim());
    if (!json || !json.companion_id) return null;
    return {
      companionId: String(json.companion_id),
      companionName: String(json.companion_name || ""),
      at: String(json.at || ""),
      by: String(json.by || "boss"),
    };
  } catch {
    return null;
  }
}

export function withBossIntent(text = "", intent) {
  const stripped = String(text || "")
    .replace(/\[\[BOSS_INTENT\]\][\s\S]*?\[\[\/BOSS_INTENT\]\]/g, "")
    .trim();
  if (!intent || !intent.companion_id) return stripped;
  const body = `${INTENT_START}${JSON.stringify(intent)}${INTENT_END}`;
  return stripped ? `${stripped}\n${body}` : body;
}

export function clearBossIntent(text = "") {
  return String(text || "")
    .replace(/\[\[BOSS_INTENT\]\][\s\S]*?\[\[\/BOSS_INTENT\]\]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function hallStateForOrder(order = {}, grabs = []) {
  const status = normalizeOrderStatus(order.status);
  if (isOrderExpired(order) || status === "cancelled") {
    return isOrderExpired(order) ? "expired" : "cancelled";
  }
  // Assigned / 指定陪玩 never participates in public hall state machine.
  const assignment = String(order.assignment_type || order.assignmentType || "").toLowerCase();
  if (assignment === "assigned" || assignment === "direct" || assignment === "direct_companion") {
    return "settled";
  }
  if (order.companion_id && ["claimed", "confirmed", "in_progress", "completed"].includes(status)) {
    return "settled";
  }
  if (status === "waiting_boss_confirm" || (status === "pending" && grabs.length > 0)) {
    return "grabbing";
  }
  if (status === "pending" || status === "waiting_boss_confirm") return "open";
  return status;
}

export function hallStateLabel(hallState) {
  return (
    {
      open: "待抢单",
      grabbing: "抢单中",
      settled: "已结单",
      cancelled: "已取消",
      expired: "已失效",
    }[hallState] || hallState
  );
}

/**
 * Enrich grab rows with real companion_profiles + profiles (unified public fields).
 */
export async function enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs = []) {
  const ids = [...new Set((grabs || []).map((g) => g.companionId || g.companion_id).filter(Boolean))];
  if (!ids.length) return (grabs || []).map((g) => ({ ...g, companion: null }));
  const [cps, ps] = await Promise.all([
    supabaseJson(restUrl("companion_profiles", `?user_id=in.(${ids.map(encodeURIComponent).join(",")})`), {
      headers: serviceHeaders(),
    }).catch(() => []),
    supabaseJson(
      restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,email,avatar_url,boss_uid`),
      { headers: serviceHeaders() }
    ).catch(() => []),
  ]);
  const cMap = Object.fromEntries((cps || []).map((c) => [c.user_id, c]));
  const pMap = Object.fromEntries((ps || []).map((p) => [p.id, p]));
  return (grabs || []).map((g) => {
    const cid = g.companionId || g.companion_id;
    const row = cMap[cid] || {};
    const profile = pMap[cid] || {};
    const mapped = mapCompanionPublicFields(row, profile, { id: cid });
    const onlineCode = String(row.availability_status || row.online_status || "offline").toLowerCase();
    return {
      ...g,
      companionId: cid,
      companion: {
        id: cid,
        companionId: cid,
        companionUid: mapped.publicId || "",
        companionCode: mapped.publicId || mapped.companionCode || "",
        publicId: mapped.publicId || "",
        nickname: mapped.nickname || profile.display_name || "陪玩",
        name: mapped.nickname || profile.display_name || "陪玩",
        avatarUrl: mapped.avatar || mapped.avatarUrl || "",
        cardImageUrl: mapped.cardImageUrl || mapped.cover || mapped.avatar || "",
        coverUrl: mapped.cover || "",
        level: row.level_name || "",
        levelId: row.level_id || "",
        gender: row.gender || "",
        voiceType: row.voice_type || "",
        voice_type: row.voice_type || "",
        game: row.game || "",
        mainGame: row.game || "",
        tags: row.tags || "",
        price: Number(row.price || 0) || 0,
        onlineStatus: onlineCode,
        onlineStatusLabel: mapped.availabilityText || onlineCode,
        rating: Number(row.rating || 0) || 0,
        completedOrders: Number(row.completed_orders || 0) || 0,
        voiceUrl: mapped.voiceUrl || row.voice_url || "",
        detailUrl: `/profile.html?player=${encodeURIComponent(cid)}`,
        bossPreferred: false,
        // Keep internal id off ops-facing labels; actions still use companionId.
      },
    };
  });
}

export async function patchOrderNoteField({ restUrl, supabaseJson, serviceHeaders }, orderId, mutateFn) {
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const order = Array.isArray(rows) ? rows[0] : null;
  if (!order) throw Object.assign(new Error("订单不存在。"), { status: 404 });
  const preferNote = Object.prototype.hasOwnProperty.call(order, "note");
  const current = preferNote ? String(order.note || "") : String(order.description || "");
  const next = mutateFn(current, order);
  const body = preferNote ? { note: next } : { description: next };
  try {
    await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ description: next }),
    });
  }
  return { ...order, note: preferNote ? next : order.note, description: preferNote ? order.description : next };
}
