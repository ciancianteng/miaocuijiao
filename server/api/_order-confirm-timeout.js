/**
 * Designated companion confirm SLA (claimed status).
 * After payment → claimed; companion must accept within CONFIRM_TIMEOUT_MS.
 * On timeout: clear companion, status=pending, notify conversation for CS reassign.
 */
import "./_load-env.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
export const COMPANION_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}
function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}
function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}
function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}
function nowIso() {
  return new Date().toISOString();
}
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
    const detail = body?.message || body?.error_description || body?.hint || "";
    const err = new Error(detail || `Supabase HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

export function confirmDeadlineIso(fromIso) {
  const t = Date.parse(fromIso || "") || Date.now();
  return new Date(t + COMPANION_CONFIRM_TIMEOUT_MS).toISOString();
}

/** Stamp claim time into note so confirm SLA does not fall back to order created_at. */
export function stampClaimedAtNote(note, atIso = nowIso()) {
  const cleaned = String(note || "")
    .replace(/\n?\[\[CLAIMED_AT\]\][^\n]*/g, "")
    .trim();
  return `${cleaned}\n[[CLAIMED_AT]]${atIso}`.trim();
}

export function claimedAtFromOrder(order = {}) {
  const note = String(order.note || order.description || "");
  const hit = note.match(/\[\[CLAIMED_AT\]\]\s*([^\n|]+)/i);
  if (hit?.[1] && !Number.isNaN(Date.parse(hit[1].trim()))) return hit[1].trim();
  if (order.paid_at && !Number.isNaN(Date.parse(order.paid_at))) return order.paid_at;
  return "";
}

export function isCompanionConfirmTimedOut(order) {
  if (!order || order.status !== "claimed" || !order.companion_id) return false;
  // Do NOT use created_at — assign/pay may happen long after order creation.
  const anchor = claimedAtFromOrder(order) || order.accepted_at || "";
  if (!anchor) return false;
  return Date.now() - Date.parse(anchor) >= COMPANION_CONFIRM_TIMEOUT_MS;
}

async function ensureConversation(order) {
  const existing = await supabaseJson(
    restUrl("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`),
    { headers: serviceHeaders() }
  );
  if (existing?.[0]) return existing[0];
  const rows = await supabaseJson(restUrl("conversations"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      boss_id: order.boss_id,
      companion_id: null,
      customer_service_id: order.customer_service_id || null,
      order_id: order.id,
      status: "open",
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
  return rows?.[0] || null;
}

async function addSystemMessage(order, content) {
  try {
    const conversation = await ensureConversation(order);
    if (!conversation?.id) return;
    const senderId = order.customer_service_id || order.boss_id;
    if (!senderId) return;
    await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        conversation_id: conversation.id,
        sender_id: senderId,
        sender_role: "system",
        message_type: "system",
        content,
        order_id: order.id,
        created_at: nowIso(),
      }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Expire overdue claimed (waiting companion) orders → pending for CS reassign.
 * @returns {Promise<number>} number expired
 */
export async function expireCompanionConfirmTimeouts({ companionId = "", limit = 50 } = {}) {
  if (!hasDb()) return 0;
  let query = `?status=eq.claimed&order=accepted_at.asc.nullslast&limit=${Math.max(1, Math.min(limit, 100))}`;
  if (companionId) query += `&companion_id=eq.${encodeURIComponent(companionId)}`;
  else query += `&companion_id=not.is.null`;
  let rows = [];
  try {
    rows = await supabaseJson(restUrl("orders", query), { headers: serviceHeaders() });
  } catch {
    return 0;
  }
  const overdue = (Array.isArray(rows) ? rows : []).filter(isCompanionConfirmTimedOut);
  let n = 0;
  for (const order of overdue) {
    try {
      const note = `陪玩确认超时|原陪玩:${order.companion_id}|${nowIso()}`;
      await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}&status=eq.claimed`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          companion_id: null,
          status: "pending",
          accepted_at: null,
          note,
        }),
      });
      await addSystemMessage(
        { ...order, companion_id: null },
        `陪玩确认超时（订单 ${order.order_no || order.id}）。订单已回到待安排，请客服重新指定陪玩或联系老板。`
      );
      n += 1;
    } catch {
      try {
        await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}&status=eq.claimed`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            companion_id: null,
            status: "pending",
            accepted_at: null,
          }),
        });
        await addSystemMessage(
          { ...order, companion_id: null },
          `陪玩确认超时（订单 ${order.order_no || order.id}）。订单已回到待安排，请客服重新指定陪玩或联系老板。`
        );
        n += 1;
      } catch {
        /* continue */
      }
    }
  }
  return n;
}
