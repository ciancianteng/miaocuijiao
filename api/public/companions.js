const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function json(res, status, data) { res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function headers() { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }; }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || "陪玩数据库请求失败");
  return body;
}
function money(value) { const n = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function publicCompanion(row = {}, profile = {}) {
  return {
    id: row.user_id || row.id,
    uid: row.user_id || row.id,
    companionProfileId: row.id,
    name: row.nickname || profile.display_name || "未命名陪玩",
    nickname: row.nickname || profile.display_name || "未命名陪玩",
    game: row.game || "",
    mainGame: row.game || "",
    level: row.level_name || "未设置等级",
    levelName: row.level_name || "未设置等级",
    price: money(row.price),
    priceValue: money(row.price),
    hourlyPrice: money(row.price),
    onlineStatus: row.online_status === "online" ? "在线" : "暂停接单",
    status: row.online_status === "online" ? "在线" : "暂停接单",
    avatar: profile.avatar_url || row.card_image_url || "assets/meow-cuijiao-brand.jpg",
    cover: row.card_image_url || profile.avatar_url || "assets/meow-cuijiao-brand.jpg",
    voiceUrl: row.voice_url || "",
    cardImageUrl: row.card_image_url || "",
    desc: row.description || "",
    description: row.description || "",
    commissionRate: money(row.commission_rate)
  };
}
async function loadCompanions(id = "") {
  const query = id
    ? `?user_id=eq.${encodeURIComponent(id)}&verification_status=eq.approved&limit=1`
    : "?verification_status=eq.approved&order=updated_at.desc&limit=300";
  const rows = await supabaseJson(restUrl("companion_profiles", query), { headers: headers() });
  const companions = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(companions.map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [];
  const profiles = await supabaseJson(restUrl("profiles", `?id=in.(${userIds.map(encodeURIComponent).join(",")})&role=eq.companion&status=eq.active`), { headers: headers() });
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  return companions.filter((row) => profileMap[row.user_id]).map((row) => publicCompanion(row, profileMap[row.user_id]));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDb()) return json(res, 200, { ok: true, configured: false, companions: [], message: "未配置 Supabase，陪玩大厅不返回假数据。" });
  try {
    const companions = await loadCompanions(String(req.query.id || req.query.uid || ""));
    return json(res, 200, { ok: true, configured: true, companions });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "陪玩列表接口异常" });
  }
}
