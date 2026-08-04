import "../_load-env.js";
import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";
import { resolvePlatformCommission } from "../_commission-rates.js";
import {
  readGamePrices,
  stripGamePricesMarker,
  parseServiceIds,
  parseServiceTypes,
  splitGames,
  servicesFromGamePrices,
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
import { resolveCompanionPublicCode, resolveBossPublicCode, anonymousBossLabel } from "../_account-codes.js";
import { evaluatePublishGate, hallVisibleByGate } from "../_companion-publish-gate.js";
// hallVisible = approved + canWork + active；媒体缺失不挡列表
import { resolveCertTagsForProfiles } from "../_companion-cert-tags-store.js";
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

function resolveCoverFocal(row = {}) {
  const fromX = row.object_position_x ?? row.objectPositionX;
  const fromY = row.object_position_y ?? row.objectPositionY;
  let x = fromX != null && fromX !== "" ? Number(fromX) : null;
  let y = fromY != null && fromY !== "" ? Number(fromY) : null;
  let fit = String(row.cover_fit || row.coverFit || "cover").toLowerCase() === "contain" ? "contain" : "cover";
  const marker = String(row.tags || "").match(/\[\[MCJ_FOCAL:([\d.]+),([\d.]+)(?:,(cover|contain))?\]\]/i);
  if (marker) {
    if (!Number.isFinite(x)) x = Number(marker[1]);
    if (!Number.isFinite(y)) y = Number(marker[2]);
    if (marker[3]) fit = String(marker[3]).toLowerCase() === "contain" ? "contain" : "cover";
  }
  // Known display defaults (no re-upload): keep faces in frame on tall cards.
  const code = String(row.companion_code || "").toUpperCase();
  if ((!Number.isFinite(x) || !Number.isFinite(y)) && code === "PW00002") {
    x = 50; y = 22;
  }
  if ((!Number.isFinite(x) || !Number.isFinite(y)) && code === "PW00004") {
    x = 50; y = 40;
  }
  if (!Number.isFinite(x)) x = 50;
  if (!Number.isFinite(y)) y = 25;
  x = Math.max(0, Math.min(100, x));
  y = Math.max(0, Math.min(100, y));
  return {
    objectPositionX: x,
    objectPositionY: y,
    object_position_x: x,
    object_position_y: y,
    focalPoint: { x, y },
    coverFit: fit,
    cover_fit: fit,
  };
}

function publicCompanion(row = {}, profile = {}, levels = [], catalog = [], mediaExtras = {}, certTags = []) {
  const base = mapCompanionPublicFields(row, profile, mediaExtras);
  const avail = base.availabilityStatus || availabilityCode(row);
  const gate = evaluatePublishGate(row, profile, mediaExtras);
  const publicId = base.publicId || resolveCompanionPublicCode(row);
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
    services: servicesFromGamePrices(row, catalog)
      .filter((s) => money(s.price) > 0 && s.name && !/^[0-9a-f-]{36}$/i.test(String(s.name)))
      .map((s) => ({
        id: s.id || s.serviceId || s.name,
        serviceId: s.serviceId || s.id || "",
        name: s.name,
        price: money(s.price),
        pricingUnit: s.pricingUnit || row.pricing_unit || "小时",
      })),
    pricingUnit: row.pricing_unit || "小时",
    availabilityStatus: avail,
    availabilityText: availabilityText(avail),
    onlineStatus: availabilityText(avail),
    status: availabilityText(avail),
    online: avail === "online" || avail === "busy",
    isOnline: avail === "online" || avail === "busy",
    canAcceptOrders: gate.hallVisible && avail === "online",
    canOrderNow: gate.hallVisible && avail === "online",
    publishReady: gate.publishReady,
    profileComplete: !!gate.criticalComplete,
    criticalComplete: !!gate.criticalComplete,
    publishStatus: gate.statusLabel,
    publishMissing: Array.isArray(gate.criticalMissing) ? gate.criticalMissing : [],
    softMissing: Array.isArray(gate.softMissing) ? gate.softMissing : [],
    featured: !!row.featured,
    recommendationStatus: row.featured ? "featured" : "normal",
    ...resolveCoverFocal(row),
    hallVisible: !!gate.hallVisible,
    canWork: !!gate.canWork,
    certTags: Array.isArray(certTags) ? certTags : [],
    certificationTags: Array.isArray(certTags) ? certTags : [],
    avatar,
    cover,
    voiceUrl: (() => {
      // 缺录音不整人消失，仅前端隐藏录音按钮
      const live = String(mediaExtras.voiceUrl || "").trim();
      if (live && /^https?:\/\//i.test(live)) return live;
      const raw = String(row.voice_url || "").trim();
      if (!raw) return "";
      if (/^storage:\/\//i.test(raw)) return live || "";
      if (/\/storage\/v1\/object\/sign\//i.test(raw) || (/[?&]token=/i.test(raw) && /\/storage\/v1\//i.test(raw))) {
        return live || "";
      }
      return pickStableMediaUrl(raw) || "";
    })(),
    videoUrl: (() => {
      const live = String(mediaExtras.videoUrl || mediaExtras.showcaseVideoUrl || "").trim();
      return live && /^https?:\/\//i.test(live) ? live : "";
    })(),
    showcaseVideoUrl: (() => {
      const live = String(mediaExtras.videoUrl || mediaExtras.showcaseVideoUrl || "").trim();
      return live && /^https?:\/\//i.test(live) ? live : "";
    })(),
    gallery: Array.isArray(mediaExtras.gallery) ? mediaExtras.gallery : [],
    cardImageUrl: pickStableMediaUrl(row.card_image_url, cover) || "",
    desc: row.description || "",
    description: row.description || "",
    bio: row.description || "",
    age: row.age != null && row.age !== "" ? Number(row.age) || row.age : "",
    gender: row.gender || "",
    region: row.region || "",
    gameId: row.game_id || "",
    rank: row.game_rank || row.rank || "",
    position: row.position || "",
    voiceType: String(row.voice_type || row.voiceType || "").trim(),
    voice_type: String(row.voice_type || row.voiceType || "").trim(),
    tags: stripGamePricesMarker(String(row.tags || ""))
      .replace(/\[\[MCJ_GALLERY:[\s\S]*?\]\]/g, "")
      .replace(/\[\[MCJ_FOCAL:[\s\S]*?\]\]/gi, "")
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter((t) => t && !/^游戏ID:|^联系:|^地区:|^性别:|^年龄:|^声线[:：]/.test(t)),
    // Never expose private fields to boss-facing public API
    contactPhone: undefined,
    identityNo: undefined,
    bankName: undefined,
    bankAccount: undefined,
    depositAmount: undefined,
    commissionRate: rates.platformRate,
    giftCommissionRate: money(row.gift_commission_rate),
    directRebateRate: money(row.direct_rebate_rate),
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
    // one review per order
    if (r.order_id && byCid[cid].some((x) => String(x.order_id) === String(r.order_id))) continue;
    byCid[cid].push(r);
  }
  const allReviews = Object.values(byCid).flat();
  const bossIds = [...new Set(allReviews.map((r) => r.boss_id).filter(Boolean))];
  const orderIds = [...new Set(allReviews.map((r) => r.order_id).filter(Boolean))];
  let bosses = {};
  let orders = {};
  if (bossIds.length) {
    const profiles = await supabaseJson(
      restUrl("profiles", `?id=in.(${bossIds.map(encodeURIComponent).join(",")})&select=id,display_name,boss_uid`),
      { headers: headers() }
    ).catch(() => []);
    bosses = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }
  if (orderIds.length) {
    const orderRows = await supabaseJson(
      restUrl("orders", `?id=in.(${orderIds.map(encodeURIComponent).join(",")})&select=id,order_no,game`),
      { headers: headers() }
    ).catch(() => []);
    orders = Object.fromEntries((orderRows || []).map((o) => [o.id, o]));
  }
  return (companions || []).map((c) => {
    const cid = c.id || c.uid;
    const list = byCid[cid] || [];
    const summary = summarizeReviews(list);
    return {
      ...c,
      ...summary,
      reviews: list.slice(0, 30).map((r) => {
        const boss = bosses[r.boss_id] || {};
        const order = orders[r.order_id] || {};
        const bossCode = resolveBossPublicCode(boss) || "";
        return {
          id: r.id,
          orderId: order.order_no || r.order_id || "",
          orderNo: order.order_no || r.order_id || "",
          gameName: order.game || "",
          game: order.game || "",
          rating: Number(r.rating) || 0,
          content: r.content || "",
          createdAt: r.created_at || "",
          bossCode,
          bossUid: bossCode,
          bossName: anonymousBossLabel(boss),
        };
      }),
    };
  });
}

function mediaApproved(status) {
  const s = String(status || "approved").toLowerCase();
  return !s || /approved|verified|passed|published/i.test(s);
}

async function mediaExtrasByProfile(profileIds = []) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (!ids.length) return {};
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl(
        "companion_media",
        `?companion_profile_id=in.(${ids.map(encodeURIComponent).join(",")})&media_type=in.(avatar,cover,gallery,voice,video)&order=sort_order.asc&limit=3000&select=id,companion_profile_id,media_type,storage_bucket,storage_path,status`
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
    if (!mediaApproved(row.status)) continue;
    if (!byProfile[pid]) byProfile[pid] = { avatarUrl: "", coverUrl: "", voiceUrl: "", videoUrl: "", gallery: [] };
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
    if (row.media_type === "voice" && !byProfile[pid].voiceUrl) byProfile[pid].voiceUrl = url;
    if (row.media_type === "video" && !byProfile[pid].videoUrl) byProfile[pid].videoUrl = url;
    if (row.media_type === "gallery") {
      byProfile[pid].gallery.push({ id: row.id, url, status: row.status || "approved" });
      if (!byProfile[pid].coverUrl) byProfile[pid].coverUrl = url;
    }
    if (row.media_type === "cover" && !byProfile[pid].coverUrl) byProfile[pid].coverUrl = url;
    if (row.media_type === "avatar" && !byProfile[pid].coverUrl) byProfile[pid].coverUrl = url;
  }
  return byProfile;
}

function identityVisible(status = "") {
  return /approved|verified|passed/i.test(String(status || ""));
}
function depositVisible(status = "") {
  return /approved|paid|verified|passed|received/i.test(String(status || ""));
}
function applicationRejected(status = "") {
  return /rejected/i.test(String(status || ""));
}
function hallVisible(row = {}, profile = {}, mediaExtras = {}) {
  return hallVisibleByGate(row, profile, mediaExtras);
}

function isCompanionLookupUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}
async function loadCompanions(id = "") {
  const rawId = String(id || "").trim();
  let query = "?order=featured.desc,companion_code.asc.nullslast,updated_at.desc&limit=300";
  if (rawId) {
    const numericUid = rawId.replace(/^P(?:W)?0*/i, "").replace(/^P/i, "");
    const isNumeric = /^\d+$/.test(numericUid);
    const pwCode = /^PW\d+$/i.test(rawId)
      ? rawId.toUpperCase()
      : isNumeric
        ? "PW" + String(numericUid).padStart(5, "0")
        : "";
    // companion_uid is bigint — never pass a UUID into that filter or PostgREST 500s.
    if (isCompanionLookupUuid(rawId)) {
      query = "?or=(user_id.eq." + encodeURIComponent(rawId) + ",id.eq." + encodeURIComponent(rawId) + ")&limit=1";
    } else if (isNumeric || pwCode) {
      const parts = [];
      if (isNumeric) parts.push("companion_uid.eq." + encodeURIComponent(numericUid));
      if (pwCode) parts.push("companion_code.eq." + encodeURIComponent(pwCode));
      // user_id is uuid — never put PW codes into that filter (PostgREST 400s the whole OR).
      if (isCompanionLookupUuid(rawId)) parts.push("user_id.eq." + encodeURIComponent(rawId));
      query = "?or=(" + parts.join(",") + ")&limit=1";
    } else {
      query = "?user_id.eq." + encodeURIComponent(rawId) + "&limit=1";
    }
  }
  let rows;
  try {
    rows = await supabaseJson(restUrl("companion_profiles", query), { headers: headers() });
  } catch (e) {
    if (!rawId && /featured|companion_code|order/i.test(String(e.message || e))) {
      query = "?order=updated_at.desc&limit=300";
      rows = await supabaseJson(restUrl("companion_profiles", query), { headers: headers() });
    } else if (rawId && /companion_uid|column|invalid input syntax for type bigint/i.test(String(e.message || ""))) {
      const fallback = isCompanionLookupUuid(rawId)
        ? "?or=(user_id.eq." + encodeURIComponent(rawId) + ",id.eq." + encodeURIComponent(rawId) + ")&limit=1"
        : "?user_id.eq." + encodeURIComponent(rawId) + "&limit=1";
      rows = await supabaseJson(restUrl("companion_profiles", fallback), {
        headers: headers(),
      });
    } else throw e;
  }
  const companions = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(companions.map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [];
  const profileIds = companions.map((row) => row.id).filter(Boolean);
  const [profiles, levels, servicesBundle, mediaMap] = await Promise.all([
    supabaseJson(
      // Do not filter role here — gate decides listing; wrong/missing role is synced on approve/backfill.
      restUrl("profiles", "?id=in.(" + userIds.map(encodeURIComponent).join(",") + ")&select=id,display_name,avatar_url,status,role"),
      { headers: headers() }
    ),
    readLocalLevels().catch(() => []),
    loadPublicServices().catch(() => ({ services: [] })),
    mediaExtrasByProfile(profileIds).catch(() => ({})),
  ]);
  const catalog = Array.isArray(servicesBundle?.services) ? servicesBundle.services : [];
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  const levelList = Array.isArray(levels) ? levels.map((l) => toPublicLevel(l)) : [];
  const visibleRows = companions.filter((row) => {
    const profile = profileMap[row.user_id];
    const media = mediaMap[row.id] || {};
    // approved + canWork + active；媒体/年龄等非关键缺失不挡大厅与主页
    return hallVisible(row, profile, media);
  });
  let certMap = {};
  try {
    certMap = await resolveCertTagsForProfiles(visibleRows.map((r) => r.id).filter(Boolean));
  } catch (err) {
    console.warn("[public/companions] cert tags resolve failed", err?.message || err);
  }
  const mapped = visibleRows.map((row) =>
    publicCompanion(
      row,
      profileMap[row.user_id],
      levelList,
      catalog,
      mediaMap[row.id] || {},
      certMap[row.id] || []
    )
  );
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
    const companions = await loadCompanions(String(req.query.id || req.query.uid || req.query.player || ""));
    return json(res, 200, { ok: true, configured: true, companions });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "陪玩列表接口异常" });
  }
}
