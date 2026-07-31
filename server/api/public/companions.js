import "../_load-env.js";
import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";
import { resolvePlatformCommission } from "../_commission-rates.js";
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function json(res, status, data) {
  res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
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
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || "陪玩数据库请求失败");
  return body;
}
function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function availabilityCode(row = {}) {
  const raw = String(row.availability_status || row.online_status || "offline").toLowerCase();
  if (raw === "online") return "online";
  if (raw === "busy") return "busy";
  if (raw === "paused") return "paused";
  return "offline";
}
function availabilityText(code) {
  return ({ online: "在线可接单", busy: "忙碌中", paused: "暂停接单", offline: "离线" })[code] || "离线";
}
function resolveAvatar(profile = {}, row = {}) {
  const raw = String(profile.avatar_url || row.card_image_url || "").trim();
  if (!raw || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(raw)) {
    return "/default-avatar.png";
  }
  return raw;
}
function isGarbledName(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return true;
  const marks = (s.match(/[?\uFFFD？]/g) || []).length;
  if (marks >= 2 && marks >= Math.ceil(s.length * 0.4)) return true;
  if (/^(?:\?|？|\uFFFD){2,}/.test(s)) return true;
  return false;
}
function resolveCompanionName(row = {}, profile = {}) {
  const candidates = [row.nickname, profile.display_name, profile.email];
  for (const c of candidates) {
    const s = String(c == null ? "" : c).trim();
    if (!s) continue;
    if (isGarbledName(s)) continue;
    if (/@/.test(s)) return s.split("@")[0] || s;
    return s;
  }
  return "";
}
function findLevelMeta(levels, row = {}) {
  const list = Array.isArray(levels) ? levels : [];
  const id = String(row.level_id || "").trim();
  const name = String(row.level_name || "").trim();
  return (
    list.find((l) => String(l.id) === id) ||
    list.find((l) => String(l.code) === id || String(l.code) === name) ||
    list.find((l) => String(l.name) === name) ||
    list.find((l) => name && `${l.code || ""} ${l.name || ""}`.trim() === name) ||
    null
  );
}
function publicCompanion(row = {}, profile = {}, levels = []) {
  const avail = availabilityCode(row);
  const publicId = row.companion_uid ? `P${row.companion_uid}` : "";
  const avatar = resolveAvatar(profile, row);
  const name = resolveCompanionName(row, profile) || "未命名陪玩";
  const level = findLevelMeta(levels, row);
  const levelName = level
    ? `${level.code || ""} ${level.name || ""}`.trim()
    : row.level_name && !/^未设置/.test(String(row.level_name))
      ? row.level_name
      : "未设置等级";
  const rates = resolvePlatformCommission(row.commission_rate, level?.commissionRate ?? 20);
  return {
    id: row.user_id || row.id,
    uid: row.user_id || row.id,
    publicId,
    companionUid: row.companion_uid || null,
    companionProfileId: row.id,
    name,
    nickname: name,
    nameValid: !!resolveCompanionName(row, profile),
    game: row.game || "",
    mainGame: row.game || "",
    level: levelName,
    levelName,
    levelId: level?.id || row.level_id || "",
    price: money(row.price),
    priceValue: money(row.price),
    hourlyPrice: money(row.price),
    pricingUnit: row.pricing_unit || "小时",
    availabilityStatus: avail,
    availabilityText: availabilityText(avail),
    onlineStatus: availabilityText(avail),
    status: availabilityText(avail),
    canOrderNow: avail === "online",
    avatar,
    cover: row.card_image_url || avatar,
    voiceUrl: row.voice_url || "",
    cardImageUrl: row.card_image_url || "",
    desc: row.description || "",
    description: row.description || "",
    tags: String(row.tags || "")
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter(Boolean),
    commissionRate: rates.platformRate,
    giftCommissionRate: money(row.gift_commission_rate),
    directRebateRate: money(row.direct_rebate_rate),
    verificationStatus: row.verification_status || "",
    depositStatus: row.deposit_status || "",
    lastOnlineAt: row.last_online_at || "",
    statusUpdatedAt: row.status_updated_at || "",
  };
}
async function loadCompanions(id = "") {
  let query = id
    ? `?or=(user_id.eq.${encodeURIComponent(id)},companion_uid.eq.${encodeURIComponent(String(id).replace(/^P/i, ""))})&verification_status=eq.approved&limit=1`
    : "?verification_status=eq.approved&order=updated_at.desc&limit=300";
  // Fallback if companion_uid column missing
  let rows;
  try {
    rows = await supabaseJson(restUrl("companion_profiles", query), { headers: headers() });
  } catch (e) {
    if (id && /companion_uid|column/i.test(String(e.message || ""))) {
      rows = await supabaseJson(
        restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}&verification_status=eq.approved&limit=1`),
        { headers: headers() }
      );
    } else throw e;
  }
  const companions = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(companions.map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [];
  const [profiles, levels] = await Promise.all([
    supabaseJson(
      restUrl("profiles", `?id=in.(${userIds.map(encodeURIComponent).join(",")})&role=eq.companion&status=eq.active&select=id,display_name,avatar_url,email,status,role`),
      { headers: headers() }
    ),
    readLocalLevels().catch(() => []),
  ]);
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  const levelList = Array.isArray(levels) ? levels.map((l) => toPublicLevel(l)) : [];
  return companions.filter((row) => profileMap[row.user_id]).map((row) => publicCompanion(row, profileMap[row.user_id], levelList));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDb()) {
    return json(res, 200, { ok: true, configured: false, companions: [], message: "未配置 Supabase，陪玩大厅不返回假数据。" });
  }
  try {
    const companions = await loadCompanions(String(req.query.id || req.query.uid || req.query.player || ""));
    return json(res, 200, { ok: true, configured: true, companions });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "陪玩列表接口异常" });
  }
}
