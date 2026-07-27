const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["super_admin", "admin"]);
const PLAYER_TABLE = "players";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function roleFrom(req) { return req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || ""; }
function canManage(req) { return ADMIN_ROLES.has(String(roleFrom(req)).trim()); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function headers(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function endpoint(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
async function db(table, query = "", init = {}) {
  const response = await fetch(endpoint(table, query), { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || `数据库请求失败：${table}`);
  return body;
}
function normalizePercent(value) {
  const text = String(value ?? "").replace("%", "").trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}
function normalizeBool(value) {
  if (value === true || value === "true" || value === "1" || value === 1 || value === "是") return true;
  if (value === false || value === "false" || value === "0" || value === 0 || value === "否") return false;
  return undefined;
}
function patchFromPayload(payload = {}) {
  const patch = {};
  if (payload.levelId != null) patch.level_id = String(payload.levelId || "");
  if (payload.auditStatus != null) patch.audit_status = String(payload.auditStatus || "");
  if (payload.identityStatus != null) patch.identity_status = String(payload.identityStatus || "");
  if (payload.depositStatus != null) patch.deposit_status = String(payload.depositStatus || "");
  if (payload.accountStatus != null) patch.status = String(payload.accountStatus || "");
  const orderRate = normalizePercent(payload.orderCommissionRate);
  if (orderRate !== undefined) patch.order_commission_rate = orderRate;
  const giftRate = normalizePercent(payload.giftCommissionRate);
  if (giftRate !== undefined) patch.gift_commission_rate = giftRate;
  const rebateRate = normalizePercent(payload.directRebateRate);
  if (rebateRate !== undefined) patch.direct_rebate_rate = rebateRate;
  const featured = normalizeBool(payload.featured);
  if (featured !== undefined) patch.featured = featured;
  const pinned = normalizeBool(payload.pinned);
  if (pinned !== undefined) patch.pinned = pinned;
  if (payload.rejectReason != null) patch.review_remark = String(payload.rejectReason || "");
  if (payload.depositConfirmRemark != null) patch.deposit_review_remark = String(payload.depositConfirmRemark || "");
  if (payload.withdrawStatus != null) patch.withdraw_status = String(payload.withdrawStatus || "");
  if (payload.withdrawRejectReason != null) patch.withdraw_reject_reason = String(payload.withdrawRejectReason || "");
  patch.updated_at = new Date().toISOString();
  return patch;
}
async function logOperation(req, action, id, beforeValue, afterValue) {
  try {
    await db("admin_operation_logs", "", {
      method: "POST",
      body: JSON.stringify({
        module: "players",
        action,
        target_type: "player",
        target_id: id,
        operator_role: roleFrom(req),
        before_value: beforeValue || null,
        after_value: afterValue || null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {}
}

export default async function handler(req, res) {
  if (!canManage(req)) return json(res, 403, { ok: false, message: "没有陪玩管理权限" });

  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      players: [],
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，陪玩管理不返回模拟数据，修改不会写入本地。",
      migration: "docs/v1-core-database.sql",
    });
  }

  try {
    if (req.method === "GET") {
      const players = await db(PLAYER_TABLE, "?order=updated_at.desc,created_at.desc&limit=300");
      return json(res, 200, { ok: true, configured: true, players: Array.isArray(players) ? players : [] });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method Not Allowed" });

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {}

    const id = String(body.id || "").trim();
    const action = String(body.action || "edit");
    if (!id) return json(res, 400, { ok: false, message: "缺少陪玩 ID" });

    const beforeRows = await db(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}&limit=1`);
    const before = beforeRows?.[0];
    if (!before) return json(res, 404, { ok: false, message: "陪玩不存在" });

    let patch = patchFromPayload(body.payload || {});
    if (action === "freeze") patch = { status: "冻结", updated_at: new Date().toISOString() };
    if (action === "ban-order") patch = { status: "暂停接单", updated_at: new Date().toISOString() };
    if (!Object.keys(patch).length) return json(res, 400, { ok: false, message: "没有可保存的陪玩字段" });

    const rows = await db(PLAYER_TABLE, `?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    await logOperation(req, action, id, before, rows?.[0] || patch);
    return json(res, 200, { ok: true, message: "陪玩资料已保存", player: rows?.[0] || patch });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "陪玩管理接口异常" });
  }
};
