/**
 * Customer-service dock-success cat-food rewards.
 * Settlement is order-bound and idempotent (unique order_id).
 * Never grant on chat-only end_reception.
 */
import { normalizeOrderStatus } from "./_order-status.js";

const SETTINGS_TYPE = "cs_dock_reward_settings";
const SETTINGS_SLUG = "default";

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  amountCatFood: 10,
  settleNode: "paid", // paid | in_progress | completed
  clawbackOnRefund: true,
  cancelOnCancel: true,
  oncePerOrder: true,
  effectiveFrom: "",
  dailyCap: 0, // 0 = unlimited
});

const VALID_PAID = new Set([
  "pending",
  "waiting_boss_confirm",
  "claimed",
  "confirmed",
  "in_progress",
  "completed",
  "reviewed",
]);

const INVALID = new Set(["awaiting_payment", "cancelled", "refund_requested", "refunded"]);

function nowIso() {
  return new Date().toISOString();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function rest(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}

async function sb(path, init = {}) {
  const response = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg = body?.message || body?.hint || (typeof body === "string" ? body : "") || `HTTP ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function isMissingTable(err) {
  return /PGRST205|Could not find the table|schema cache|cs_dock_rewards/i.test(String(err?.message || err || ""));
}

function isTestOrder(order = {}) {
  const blob = `${order.order_no || ""} ${order.note || ""} ${order.description || ""} ${order.title || ""}`;
  return /\[TEST\]|E2E-|acceptance|自动化测试|测试订单/i.test(blob);
}

export function mergeSettings(raw = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    enabled: raw.enabled !== false && raw.enabled !== "false",
    amountCatFood: Math.max(0, num(raw.amountCatFood ?? raw.amount, DEFAULT_SETTINGS.amountCatFood)),
    settleNode: ["paid", "in_progress", "completed"].includes(String(raw.settleNode || ""))
      ? String(raw.settleNode)
      : DEFAULT_SETTINGS.settleNode,
    clawbackOnRefund: raw.clawbackOnRefund !== false && raw.clawbackOnRefund !== "false",
    cancelOnCancel: raw.cancelOnCancel !== false && raw.cancelOnCancel !== "false",
    oncePerOrder: raw.oncePerOrder !== false && raw.oncePerOrder !== "false",
    effectiveFrom: String(raw.effectiveFrom || ""),
    dailyCap: Math.max(0, num(raw.dailyCap, 0)),
  };
}

export async function loadRewardSettings() {
  try {
    const rows = await sb(
      rest(
        "platform_content_items",
        `?type=eq.${SETTINGS_TYPE}&slug=eq.${SETTINGS_SLUG}&limit=1`
      )
    );
    const item = Array.isArray(rows) ? rows[0] : null;
    if (item) {
      const data = { ...(item.published || {}), ...(item.draft || {}) };
      return mergeSettings(data);
    }
  } catch (err) {
    if (!isMissingTable(err) && !/platform_content/i.test(String(err.message || ""))) {
      /* keep trying fallback */
    }
  }
  try {
    const marker = "[MCJ_CS_DOCK_REWARD_SETTINGS]";
    const rows = await sb(rest("announcements", `?is_active=eq.true&order=updated_at.desc&limit=30`));
    const hit = (Array.isArray(rows) ? rows : []).find((r) => String(r.title || "").includes(marker) || String(r.content || "").includes(marker));
    if (hit) {
      const raw = String(hit.content || "");
      const idx = raw.indexOf(marker);
      const json = idx >= 0 ? raw.slice(idx + marker.length) : "";
      const parsed = json ? JSON.parse(json) : null;
      if (parsed && typeof parsed === "object") return mergeSettings(parsed);
    }
  } catch {
    /* defaults */
  }
  return mergeSettings(DEFAULT_SETTINGS);
}

export async function saveRewardSettings(patch = {}, adminId = "admin") {
  const next = mergeSettings({ ...(await loadRewardSettings()), ...patch, effectiveFrom: patch.effectiveFrom || nowIso() });
  const row = {
    id: `pc-cs-dock-reward-settings`,
    type: SETTINGS_TYPE,
    slug: SETTINGS_SLUG,
    title: "客服对接奖励设置",
    status: "published",
    enabled: true,
    sort: 1,
    draft: next,
    published: next,
    version: 1,
    published_by: adminId,
    published_at: nowIso(),
    updated_by: adminId,
    updated_at: nowIso(),
  };
  try {
    const existing = await sb(
      rest("platform_content_items", `?type=eq.${SETTINGS_TYPE}&slug=eq.${SETTINGS_SLUG}&limit=1`)
    );
    if (Array.isArray(existing) && existing[0]?.id) {
      const patched = await sb(rest("platform_content_items", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        body: JSON.stringify({
          title: row.title,
          status: "published",
          enabled: true,
          draft: next,
          published: next,
          updated_by: adminId,
          updated_at: nowIso(),
          published_at: nowIso(),
          published_by: adminId,
        }),
      });
      return { settings: next, item: Array.isArray(patched) ? patched[0] : patched };
    }
    const created = await sb(rest("platform_content_items"), { method: "POST", body: JSON.stringify(row) });
    return { settings: next, item: Array.isArray(created) ? created[0] : created };
  } catch (err) {
    // Fallback: store settings JSON in announcements when CMS table missing
    if (!isMissingTable(err) && !/platform_content/i.test(String(err.message || ""))) throw err;
    const marker = "[MCJ_CS_DOCK_REWARD_SETTINGS]";
    const title = `${marker}客服对接奖励设置`;
    const content = `${marker}${JSON.stringify(next)}`;
    try {
      const found = await sb(
        rest("announcements", `?title=like.${encodeURIComponent("*" + marker + "*")}&limit=1`)
      ).catch(() => []);
      if (Array.isArray(found) && found[0]?.id) {
        const patched = await sb(rest("announcements", `?id=eq.${encodeURIComponent(found[0].id)}`), {
          method: "PATCH",
          body: JSON.stringify({ title, content, is_active: true, updated_at: nowIso() }),
        });
        return { settings: next, item: Array.isArray(patched) ? patched[0] : patched, source: "announcements" };
      }
      const created = await sb(rest("announcements"), {
        method: "POST",
        body: JSON.stringify({
          title,
          content,
          audience: "system_internal",
          is_active: false,
          published_at: nowIso(),
        }),
      });
      return { settings: next, item: Array.isArray(created) ? created[0] : created, source: "announcements" };
    } catch (e2) {
      throw Object.assign(new Error(`保存奖励设置失败：${e2.message || err.message}`), { status: 503 });
    }
  }
}

function nodeReached(status, settleNode) {
  const s = normalizeOrderStatus(status);
  if (INVALID.has(s)) return false;
  if (settleNode === "completed") return s === "completed" || s === "reviewed";
  if (settleNode === "in_progress") return ["in_progress", "completed", "reviewed"].includes(s);
  // paid
  return VALID_PAID.has(s);
}

async function findConversationForOrder(order) {
  if (!order?.id) return null;
  try {
    const byOrder = await sb(
      rest("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&order=updated_at.desc&limit=1`)
    );
    if (Array.isArray(byOrder) && byOrder[0]) return byOrder[0];
  } catch {
    /* ignore */
  }
  if (order.boss_id && order.customer_service_id) {
    try {
      const rows = await sb(
        rest(
          "conversations",
          `?boss_id=eq.${encodeURIComponent(order.boss_id)}&customer_service_id=eq.${encodeURIComponent(order.customer_service_id)}&order=updated_at.desc&limit=1`
        )
      );
      return Array.isArray(rows) ? rows[0] : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function hasActiveReception(serviceId, conversationId, bossId) {
  if (!serviceId) return false;
  try {
    let q = `?customer_service_id=eq.${encodeURIComponent(serviceId)}&order=started_at.desc&limit=5`;
    if (conversationId) q = `?customer_service_id=eq.${encodeURIComponent(serviceId)}&conversation_id=eq.${encodeURIComponent(conversationId)}&limit=3`;
    else if (bossId) q = `?customer_service_id=eq.${encodeURIComponent(serviceId)}&boss_id=eq.${encodeURIComponent(bossId)}&order=started_at.desc&limit=5`;
    const rows = await sb(rest("service_receptions", q));
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return true; // if receptions table missing, fall back to conversation.customer_service_id binding
  }
}

async function dailySettledAmount(serviceId) {
  const day = nowIso().slice(0, 10);
  try {
    const rows = await sb(
      rest(
        "cs_dock_rewards",
        `?service_id=eq.${encodeURIComponent(serviceId)}&status=eq.settled&settled_at=gte.${encodeURIComponent(day + "T00:00:00.000Z")}&select=amount_cat_food`
      )
    );
    return (Array.isArray(rows) ? rows : []).reduce((sum, r) => sum + num(r.amount_cat_food), 0);
  } catch {
    return 0;
  }
}

export async function getRewardByOrderId(orderId) {
  if (!orderId) return null;
  try {
    const rows = await sb(rest("cs_dock_rewards", `?order_id=eq.${encodeURIComponent(orderId)}&limit=1`));
    return Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Attempt to settle dock reward for an order. Idempotent.
 */
export async function trySettleDockReward(order, { source = "auto", forceServiceId = "" } = {}) {
  const settings = await loadRewardSettings();
  if (!settings.enabled) {
    return { ok: false, code: "DISABLED", message: "客服对接奖励未启用。" };
  }
  if (!order?.id) return { ok: false, code: "NO_ORDER", message: "缺少订单。" };
  if (isTestOrder(order)) return { ok: false, code: "TEST_ORDER", message: "测试订单不结算猫粮。" };

  const status = normalizeOrderStatus(order.status);
  if (INVALID.has(status) || status === "awaiting_payment") {
    return { ok: false, code: "NOT_PAID", message: "订单未进入有效状态，不结算猫粮。" };
  }
  if (!nodeReached(status, settings.settleNode)) {
    return {
      ok: false,
      code: "NODE_NOT_REACHED",
      message: `订单尚未达到结算节点（${settings.settleNode}）。`,
      settleNode: settings.settleNode,
      status,
    };
  }

  const existing = await getRewardByOrderId(order.id);
  if (existing) {
    if (existing.status === "settled") {
      return { ok: true, code: "ALREADY_SETTLED", message: "该订单奖励已结算过。", reward: existing, duplicate: true };
    }
    if (existing.status === "clawed_back" || existing.status === "cancelled") {
      return { ok: false, code: "CLOSED", message: "该订单奖励已取消或扣回，不可再发。", reward: existing };
    }
  }

  const serviceId = String(forceServiceId || order.customer_service_id || "").trim();
  if (!serviceId) {
    return { ok: false, code: "NO_SERVICE", message: "订单未绑定客服，不结算。" };
  }

  const conversation = await findConversationForOrder(order);
  if (!conversation) {
    return { ok: false, code: "NO_CONVERSATION", message: "未找到真实客服会话，不结算。" };
  }
  if (String(conversation.customer_service_id || "") !== serviceId) {
    return { ok: false, code: "SERVICE_MISMATCH", message: "订单客服与接待客服不一致，不结算。" };
  }

  const received = await hasActiveReception(serviceId, conversation.id, order.boss_id);
  if (!received && !conversation.customer_service_id) {
    return { ok: false, code: "NOT_ACCEPTED", message: "客服未接待该老板，不结算。" };
  }

  if (settings.dailyCap > 0) {
    const used = await dailySettledAmount(serviceId);
    if (used + settings.amountCatFood > settings.dailyCap + 1e-9) {
      return { ok: false, code: "DAILY_CAP", message: "已达客服每日奖励上限。" };
    }
  }

  if (settings.effectiveFrom) {
    const eff = Date.parse(settings.effectiveFrom);
    const created = Date.parse(order.created_at || "") || Date.now();
    if (Number.isFinite(eff) && created < eff) {
      return { ok: false, code: "NOT_EFFECTIVE", message: "订单创建早于奖励设置生效时间。" };
    }
  }

  const row = {
    service_id: serviceId,
    boss_id: order.boss_id || conversation.boss_id || null,
    conversation_id: conversation.id,
    order_id: order.id,
    order_no: order.order_no || "",
    order_amount: num(order.total_amount),
    amount_cat_food: settings.amountCatFood,
    status: "settled",
    settle_node: settings.settleNode,
    settled_at: nowIso(),
    source: source || "auto",
    is_manual: false,
    updated_at: nowIso(),
  };

  try {
    if (existing?.id && existing.status === "pending") {
      const patched = await sb(rest("cs_dock_rewards", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        body: JSON.stringify(row),
      });
      return {
        ok: true,
        code: "SETTLED",
        message: `本次对接成功，已结算 ${settings.amountCatFood} 猫粮。`,
        reward: Array.isArray(patched) ? patched[0] : patched,
        amount: settings.amountCatFood,
      };
    }
    const created = await sb(rest("cs_dock_rewards"), {
      method: "POST",
      body: JSON.stringify({ ...row, created_at: nowIso() }),
    });
    return {
      ok: true,
      code: "SETTLED",
      message: `本次对接成功，已结算 ${settings.amountCatFood} 猫粮。`,
      reward: Array.isArray(created) ? created[0] : created,
      amount: settings.amountCatFood,
    };
  } catch (err) {
    if (/duplicate|unique|23505/i.test(String(err.message || ""))) {
      const again = await getRewardByOrderId(order.id);
      return { ok: true, code: "ALREADY_SETTLED", message: "该订单奖励已结算过。", reward: again, duplicate: true };
    }
    if (isMissingTable(err)) {
      return { ok: false, code: "TABLE_MISSING", message: "奖励表未创建，请执行 cs_dock_rewards 迁移。" };
    }
    throw err;
  }
}

export async function clawbackOrCancelReward(order, { reason = "", mode = "auto" } = {}) {
  const settings = await loadRewardSettings();
  const status = normalizeOrderStatus(order?.status);
  const existing = await getRewardByOrderId(order?.id);
  if (!existing) return { ok: true, code: "NONE", message: "无奖励记录。" };

  if (status === "cancelled" || mode === "cancel") {
    if (!settings.cancelOnCancel && mode === "auto") return { ok: true, code: "SKIP", message: "设置未开启取消订单取消奖励。" };
    if (existing.status === "cancelled" || existing.status === "clawed_back") return { ok: true, code: "DONE", reward: existing };
    const patched = await sb(rest("cs_dock_rewards", `?id=eq.${encodeURIComponent(existing.id)}`), {
      method: "PATCH",
      body: JSON.stringify({
        status: existing.status === "settled" ? "clawed_back" : "cancelled",
        clawback_at: existing.status === "settled" ? nowIso() : null,
        clawback_reason: existing.status === "settled" ? reason || "订单取消，扣回奖励" : null,
        cancel_reason: existing.status !== "settled" ? reason || "订单取消" : existing.cancel_reason,
        updated_at: nowIso(),
      }),
    });
    return { ok: true, code: "CANCELLED", reward: Array.isArray(patched) ? patched[0] : patched };
  }

  if (status === "refunded" || status === "refund_requested" || mode === "refund") {
    if (!settings.clawbackOnRefund && mode === "auto") return { ok: true, code: "SKIP", message: "设置未开启退款扣回。" };
    if (existing.status !== "settled") {
      const patched = await sb(rest("cs_dock_rewards", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", cancel_reason: reason || "退款取消待结算", updated_at: nowIso() }),
      });
      return { ok: true, code: "CANCELLED", reward: Array.isArray(patched) ? patched[0] : patched };
    }
    const patched = await sb(rest("cs_dock_rewards", `?id=eq.${encodeURIComponent(existing.id)}`), {
      method: "PATCH",
      body: JSON.stringify({
        status: "clawed_back",
        clawback_at: nowIso(),
        clawback_reason: reason || "订单退款，扣回奖励",
        updated_at: nowIso(),
      }),
    });
    return { ok: true, code: "CLAWED", reward: Array.isArray(patched) ? patched[0] : patched };
  }

  return { ok: true, code: "NOOP", reward: existing };
}

/**
 * End-reception evaluation: never invent rewards; only report / settle if order qualifies.
 */
export async function evaluateEndReceptionReward({ serviceId, conversation }) {
  const settings = await loadRewardSettings();
  if (!settings.enabled) {
    return {
      code: "DISABLED",
      message: "客服对接奖励未启用。",
      settled: false,
    };
  }
  if (!conversation?.customer_service_id || String(conversation.customer_service_id) !== String(serviceId)) {
    return { code: "NOT_ACCEPTED", message: "本次仅为咨询，未产生有效订单，不结算猫粮。", settled: false };
  }

  let order = null;
  if (conversation.order_id) {
    try {
      const rows = await sb(rest("orders", `?id=eq.${encodeURIComponent(conversation.order_id)}&limit=1`));
      order = Array.isArray(rows) ? rows[0] : null;
    } catch {
      order = null;
    }
  }
  // Do NOT hunt other boss orders — chat-only sessions without order_id never settle.

  if (!order) {
    return { code: "NO_ORDER", message: "本次仅为咨询，未产生有效订单，不结算猫粮。", settled: false };
  }

  const status = normalizeOrderStatus(order.status);
  if (status === "awaiting_payment") {
    return {
      code: "UNPAID",
      message: "订单已创建，奖励将在订单达到结算条件后到账。",
      settled: false,
      orderId: order.id,
      orderNo: order.order_no,
    };
  }
  if (INVALID.has(status) || isTestOrder(order)) {
    return { code: "INVALID_ORDER", message: "本次仅为咨询，未产生有效订单，不结算猫粮。", settled: false, orderId: order.id };
  }

  if (!nodeReached(status, settings.settleNode)) {
    return {
      code: "PENDING_NODE",
      message: "订单已创建，奖励将在订单达到结算条件后到账。",
      settled: false,
      orderId: order.id,
      orderNo: order.order_no,
    };
  }

  const result = await trySettleDockReward(order, { source: "end_reception_check", forceServiceId: serviceId });
  if (result.ok && (result.code === "SETTLED" || result.code === "ALREADY_SETTLED")) {
    const amount = result.amount ?? result.reward?.amount_cat_food ?? settings.amountCatFood;
    return {
      code: result.code,
      message: result.duplicate
        ? `该订单奖励已结算过（${amount} 猫粮），不会重复发放。`
        : `本次对接成功，已结算 ${amount} 猫粮。`,
      settled: true,
      duplicate: !!result.duplicate,
      amount,
      reward: result.reward,
      orderId: order.id,
      orderNo: order.order_no,
    };
  }
  return {
    code: result.code || "SKIP",
    message: result.message || "订单已创建，奖励将在订单达到结算条件后到账。",
    settled: false,
    orderId: order.id,
    orderNo: order.order_no,
  };
}

export async function listRewards({ status = "", serviceId = "", limit = 100 } = {}) {
  let q = `?order=created_at.desc&limit=${Math.min(200, Math.max(1, Number(limit) || 100))}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  if (serviceId) q += `&service_id=eq.${encodeURIComponent(serviceId)}`;
  try {
    const rows = await sb(rest("cs_dock_rewards", q));
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export { DEFAULT_SETTINGS, VALID_PAID };
