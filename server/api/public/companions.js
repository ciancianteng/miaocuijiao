import "../_load-env.js";
import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";
import { resolvePlatformCommission } from "../_commission-rates.js";
import {
  readGamePrices,
  stripGamePricesMarker,
  parseServiceIds,
  parseServiceTypes,
  splitGames,
} from "../_game-prices.js";
import { loadPublicServices } from "../platform/services.js";
import {
  DEFAULT_COMPANION_AVATAR,
  mapCompanionPublicFields,
  pickStableMediaUrl,
  resolveCompanionAvatar,
  resolveCompanionCover,
} from "../_companion-public-map.js";
import { createSignedUrl, publicObjectUrl } from "../_companion-media-store.js";
import {
  formatCompanionCode,
  isCompanionCode,
  isDbUuid,
  parseCompanionCodeNumber,
  resolveCompanionPublicCode,
} from "../_account-codes.js";
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
function resolveServiceTypes(row = {}) {
  const hasGame = !!(String(row.game || "").trim() || parseServiceIds(row.service_ids).length);
  const types = parseServiceTypes(row.service_type || row.serviceType, {
    fallbackPlayWhenGame: true,
    hasGame,
  });
  if (types.length) return types;
  const hint = `${row.main_service || ""} ${row.tags || ""} ${row.description || ""}`;
  const inferred = parseServiceTypes(hint);
  if (inferred.length) return inferred;
  return hasGame ? ["陪玩服务"] : ["陪玩服务"];
}
function resolveCompanionServiceIds(row = {}, catalog = []) {
  const stored = parseServiceIds(row.service_ids);
  if (stored.length) return stored;
  const names = new Set(splitGames(row.game));
  if (!names.size) return [];
  return (catalog || [])
    .filter((svc) => names.has(String(svc.name || svc.title || "").trim()))
    .map((svc) => String(svc.id));
}
function publicCompanion(row = {}, profile = {}, levels = [], catalog = [], mediaExtras = {}) {
  const base = mapCompanionPublicFields(row, profile, mediaExtras);
  const avail = base.availabilityStatus || availabilityCode(row);
  const publicId = base.publicId || (row.companion_uid ? `P${row.companion_uid}` : "");
  const avatar = resolveCompanionAvatar(profile, row, mediaExtras) || DEFAULT_COMPANION_AVATAR;
  const cover = resolveCompanionCover(profile, row, mediaExtras) || avatar;
  const name = base.name || "未命名陪玩";
  const level = findLevelMeta(levels, row);
  const levelName = level
    ? `${level.code || ""} ${level.name || ""}`.trim()
    : row.level_name && !/^未设置/.test(String(row.level_name))
      ? row.level_name
      : "未设置等级";
  const rates = resolvePlatformCommission(row.commission_rate, level?.commissionRate ?? 20);
  const serviceTypes = resolveServiceTypes(row);
  const serviceIds = resolveCompanionServiceIds(row, catalog);
  const byId = new Map((catalog || []).map((s) => [String(s.id), s]));
  const serviceNames = serviceIds
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((s) => s.name || s.title)
    .filter(Boolean);
  const gameDisplay = serviceNames.length ? serviceNames.join("、") : row.game || "";
  return {
    id: row.user_id || row.id,
    uid: row.user_id || row.id,
    publicId,
    companionUid: row.companion_uid || null,
    companionProfileId: row.id,
    name,
    nickname: name,
    nameValid: !!base.nameValid,
    game: gameDisplay || row.game || "",
    mainGame: gameDisplay || row.game || "",
    service_type: serviceTypes.join(","),
    serviceType: serviceTypes[0] || "陪玩服务",
    serviceTypes,
    service_ids: serviceIds,
    serviceIds,
    level: levelName,
    levelName,
    levelId: level?.id || row.level_id || "",
    price: money(row.price),
    priceValue: money(row.price),
    hourlyPrice: money(row.price),
    gamePrices: readGamePrices(row),
    pricingUnit: row.pricing_unit || "小时",
    availabilityStatus: avail,
    availabilityText: availabilityText(avail),
    onlineStatus: availabilityText(avail),
    status: availabilityText(avail),
    canOrderNow: avail === "online",
    avatar,
    cover,
    voiceUrl: pickStableMediaUrl(row.voice_url, mediaExtras.voiceUrl) || row.voice_url || "",
    cardImageUrl: pickStableMediaUrl(row.card_image_url, cover) || "",
    desc: row.description || "",
    description: row.description || "",
    tags: stripGamePricesMarker(String(row.tags || ""))
      .replace(/\[\[MCJ_GALLERY:[\s\S]*?\]\]/g, "")
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter((t) => t && !/^游戏ID:|^联系:|^地区:|^性别:|^年龄:/.test(t)),
    // Never expose private fields to boss-facing public API
    contactPhone: undefined,
    identityNo: undefined,
    commissionRate: rates.platformRate,
    giftCommissionRate: money(row.gift_commission_rate),
    directRebateRate: money(row.direct_rebate_rate),
    verificationStatus: row.verification_status || "",
    depositStatus: row.deposit_status || "",
    lastOnlineAt: row.last_online_at || "",
    statusUpdatedAt: row.status_updated_at || "",
    rating: 0,
    score: 0,
    reviewCount: 0,
    goodReviewCount: 0,
    goodRate: 0,
    reviews: [],
  };
}

function summarizeReviews(list = []) {
  const ratings = (list || []).map((r) => Number(r.rating) || 0).filter((n) => n >= 1 && n <= 5);
  const count = ratings.length;
  const sum = ratings.reduce((n, v) => n + v, 0);
  const avg = count ? Math.round((sum / count) * 10) / 10 : 0;
  const good = ratings.filter((n) => n >= 4).length;
  return {
    rating: avg,
    score: avg,
    reviewCount: count,
    goodReviewCount: good,
    goodRate: count ? Math.round((good / count) * 1000) / 10 : 0,
  };
}

async function attachReviews(companions = []) {
  const ids = [...new Set((companions || []).map((c) => c.id || c.uid).filter(Boolean))];
  if (!ids.length) return companions || [];
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl(
        "companion_reviews",
        `?companion_id=in.(${ids.map(encodeURIComponent).join(",")})&or=(status.eq.published,status.is.null)&order=created_at.desc&limit=3000&select=id,companion_id,boss_id,order_id,rating,content,status,created_at`
      ),
      { headers: headers() }
    );
  } catch (e) {
    if (/companion_reviews|schema cache|PGRST|does not exist/i.test(String(e.message || e))) return companions;
    throw e;
  }
  const byCid = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const cid = r.companion_id;
    if (!cid) continue;
    if (!byCid[cid]) byCid[cid] = [];
    byCid[cid].push(r);
  }
  return (companions || []).map((c) => {
    const cid = c.id || c.uid;
    const list = byCid[cid] || [];
    const summary = summarizeReviews(list);
    return {
      ...c,
      ...summary,
      reviews: list.slice(0, 30).map((r) => ({
        id: r.id,
        orderId: r.order_id || "",
        rating: Number(r.rating) || 0,
        content: r.content || "",
        createdAt: r.created_at || "",
      })),
    };
  });
}

async function mediaExtrasByProfile(profileIds = []) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (!ids.length) return {};
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl(
        "companion_media",
        `?companion_profile_id=in.(${ids.map(encodeURIComponent).join(",")})&media_type=in.(avatar,cover,gallery)&order=sort_order.asc&limit=2000&select=id,companion_profile_id,media_type,storage_bucket,storage_path,status`
      ),
      { headers: headers() }
    );
  } catch (e) {
    if (/companion_media|schema cache|PGRST|does not exist/i.test(String(e.message || e))) return {};
    throw e;
  }
  const byProfile = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const pid = row.companion_profile_id;
    if (!pid) continue;
    if (!byProfile[pid]) byProfile[pid] = { avatarUrl: "", coverUrl: "" };
    const bucket = String(row.storage_bucket || "").trim();
    const path = String(row.storage_path || "").trim();
    if (!bucket || !path) continue;
    let url = "";
    try {
      if (bucket === "companion-public" || /public/i.test(bucket)) {
        url = publicObjectUrl(bucket, path);
      } else {
        url = await createSignedUrl(bucket, path, 60 * 60 * 12);
      }
    } catch (err) {
      console.warn("[public/companions] media URL resolve failed", bucket, path, err?.message || err);
      continue;
    }
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (row.media_type === "avatar" && !byProfile[pid].avatarUrl) byProfile[pid].avatarUrl = url;
    if ((row.media_type === "cover" || row.media_type === "gallery") && !byProfile[pid].coverUrl) {
      byProfile[pid].coverUrl = url;
    }
    if (row.media_type === "avatar" && !byProfile[pid].coverUrl) byProfile[pid].coverUrl = url;
  }
  return byProfile;
}

async function fetchCompanionRows(query) {
  return supabaseJson(restUrl("companion_profiles", query), { headers: headers() }).catch(() => []);
}

/**
 * Resolve one companion profile row by internal UUID or public PW/P code.
 * Never pass a non-UUID value into a UUID column filter.
 */
async function resolveCompanionProfileRows(idRaw = "") {
  const id = String(idRaw || "").trim();
  if (!id) return null;

  if (isDbUuid(id)) {
    const byUser = await fetchCompanionRows(
      `?user_id=eq.${encodeURIComponent(id)}&verification_status=eq.approved&limit=1`
    );
    if (byUser?.[0]) return byUser;
    // Some callers may pass companion_profiles.id
    return fetchCompanionRows(
      `?id=eq.${encodeURIComponent(id)}&verification_status=eq.approved&limit=1`
    );
  }

  if (isCompanionCode(id)) {
    const seq = parseCompanionCodeNumber(id);
    const code = formatCompanionCode(seq);
    const byCode = await fetchCompanionRows(
      `?companion_code=eq.${encodeURIComponent(code)}&verification_status=eq.approved&limit=1`
    );
    if (byCode?.[0]) return byCode;

    for (const uid of [seq, seq + 100000]) {
      const byUid = await fetchCompanionRows(
        `?companion_uid=eq.${encodeURIComponent(uid)}&verification_status=eq.approved&limit=1`
      );
      if (byUid?.[0]) return byUid;
    }

    // Scan fallback for rows with missing companion_code but resolvable public code.
    const pool = await fetchCompanionRows(
      "?verification_status=eq.approved&select=*&order=updated_at.desc&limit=500"
    );
    const hit = (Array.isArray(pool) ? pool : []).find((row) => resolveCompanionPublicCode(row) === code);
    return hit ? [hit] : [];
  }

  // Unknown non-UUID / non-code lookup — do not hit UUID columns.
  return [];
}

async function loadCompanions(id = "") {
  let companions;
  if (id) {
    companions = await resolveCompanionProfileRows(id);
    if (!Array.isArray(companions)) companions = [];
  } else {
    const rows = await fetchCompanionRows("?verification_status=eq.approved&order=updated_at.desc&limit=300");
    companions = Array.isArray(rows) ? rows : [];
  }
  const userIds = [...new Set(companions.map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [];
  const profileIds = companions.map((row) => row.id).filter(Boolean);
  const [profiles, levels, servicesBundle, mediaMap] = await Promise.all([
    supabaseJson(
      restUrl("profiles", `?id=in.(${userIds.map(encodeURIComponent).join(",")})&role=eq.companion&status=eq.active&select=id,display_name,avatar_url,email,status,role`),
      { headers: headers() }
    ),
    readLocalLevels().catch(() => []),
    loadPublicServices().catch(() => ({ services: [] })),
    mediaExtrasByProfile(profileIds).catch(() => ({})),
  ]);
  const catalog = Array.isArray(servicesBundle?.services) ? servicesBundle.services : [];
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  const levelList = Array.isArray(levels) ? levels.map((l) => toPublicLevel(l)) : [];
  const mapped = companions
    .filter((row) => profileMap[row.user_id])
    .map((row) => publicCompanion(row, profileMap[row.user_id], levelList, catalog, mediaMap[row.id] || {}));
  return attachReviews(mapped);
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
    const lookup = String(req.query.id || req.query.uid || req.query.player || "").trim();
    const companions = await loadCompanions(lookup);
    return json(res, 200, { ok: true, configured: true, companions });
  } catch (error) {
    const msg = String(error?.message || error || "陪玩列表接口异常");
    // Never surface raw Postgres UUID parse errors to the boss-facing UI.
    if (/invalid input syntax for type uuid/i.test(msg)) {
      return json(res, 200, { ok: true, configured: true, companions: [] });
    }
    return json(res, 500, { ok: false, message: msg });
  }
}
