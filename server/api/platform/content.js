import { loadPublicServices } from "./services.js";
import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";
import { readLocalTags, toPublicTag } from "../_companion-tags-store.js";
import { readVoiceTypes, toPublicVoiceType } from "../_companion-voice-types-store.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function hasDatabaseConfig() { return REQUIRED_ENV.every((key) => process.env[key]); }
function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.status(status).json(data);
}
function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = { apikey: key };
  if (key && !String(key).startsWith("sb_secret_")) {
    base.Authorization = `Bearer ${key}`;
  }
  return base;
}
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
async function rows(table, query) {
  const response = await fetch(restUrl(table, query), { headers: headers() });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || `读取 ${table} 失败`);
  return Array.isArray(body) ? body : [];
}
function cleanType(type) { return String(type || "").replace(/[^a-z0-9_:-]/gi, ""); }
function stripMcjMarker(text) {
  return String(text || "")
    .replace(/\s*\[mcj:[^\]]+\]/gi, "")
    .replace(/\s*\[mcj-ann:[^\]]+\]/gi, "")
    .trim();
}
function bannerItem(row) {
  const image = row.image_url || "";
  const mobileImage = String(row.mobile_image_url || "").trim();
  const title = stripMcjMarker(row.title || "");
  const isMain = row.is_main === true;
  const cropRaw = row.crop_meta || row.crop || {};
  const mobileCropRaw = row.mobile_crop_meta || row.mobile_crop || {};
  const crop =
    cropRaw && typeof cropRaw === "object" && !Array.isArray(cropRaw)
      ? (() => {
          let zoom = Number(cropRaw.zoom ?? cropRaw.scale ?? 1) || 1;
          let x = Number(cropRaw.x ?? cropRaw.offsetX ?? cropRaw.nx ?? 0) || 0;
          let y = Number(cropRaw.y ?? cropRaw.offsetY ?? cropRaw.ny ?? 0) || 0;
          if (zoom < 1) zoom = 1;
          if (Math.abs(x) > 2 || Math.abs(y) > 2) {
            x = Math.max(-1.5, Math.min(1.5, x / 640));
            y = Math.max(-1.5, Math.min(1.5, y / 360));
          }
          return {
            zoom,
            scale: zoom,
            x,
            y,
            offsetX: x,
            offsetY: y,
            ratioW: Number(cropRaw.ratioW ?? cropRaw.ratio_w ?? 1920) || 1920,
            ratioH: Number(cropRaw.ratioH ?? cropRaw.ratio_h ?? 700) || 700,
            ratio: String(cropRaw.ratio || `${cropRaw.ratioW || 1920}:${cropRaw.ratioH || 700}`),
          };
        })()
      : { zoom: 1, scale: 1, x: 0, y: 0, offsetX: 0, offsetY: 0, ratioW: 1920, ratioH: 700, ratio: "1920:700" };
  const mobileCrop =
    mobileCropRaw && typeof mobileCropRaw === "object" && !Array.isArray(mobileCropRaw)
      ? {
          zoom: Number(mobileCropRaw.zoom ?? mobileCropRaw.scale ?? 1) || 1,
          x: Number(mobileCropRaw.x ?? mobileCropRaw.offsetX ?? mobileCropRaw.nx ?? 0) || 0,
          y: Number(mobileCropRaw.y ?? mobileCropRaw.offsetY ?? mobileCropRaw.ny ?? 0) || 0,
          ratioW: Number(mobileCropRaw.ratioW ?? mobileCropRaw.ratio_w ?? 1080) || 1080,
          ratioH: Number(mobileCropRaw.ratioH ?? mobileCropRaw.ratio_h ?? 1350) || 1350,
          ratio: String(mobileCropRaw.ratio || `${mobileCropRaw.ratioW || 1080}:${mobileCropRaw.ratioH || 1350}`),
        }
      : { zoom: 1, x: 0, y: 0, ratioW: 1080, ratioH: 1350, ratio: "1080:1350" };
  return {
    id: row.id,
    title: title,
    name: title || "MEOW CUI JIAO Banner",
    subtitle: row.subtitle || "",
    image: image,
    image_url: image,
    desktopImage: image,
    mobileImage: mobileImage || image,
    mobile_image_url: mobileImage,
    hasDedicatedMobile: !!mobileImage,
    buttonText: row.button_text || "",
    button_text: row.button_text || "",
    link: row.button_link || "",
    href: row.button_link || "",
    button_link: row.button_link || "",
    sort: row.sort_order == null ? 100 : row.sort_order,
    sort_order: row.sort_order == null ? 100 : row.sort_order,
    isMain,
    is_main: isMain,
    enabled: row.is_active === true,
    published: true,
    fitMode: "cover",
    crop,
    crop_meta: crop,
    mobileCrop,
    mobile_crop: mobileCrop,
    mobile_crop_meta: mobileCrop,
    objectPosition: `${50 + crop.x * 50}% ${50 + crop.y * 50}%`,
  };
}
function announcementItem(row) {
  const title = stripMcjMarker(row.title || "");
  const rawCat = String(row.category || "").trim().toLowerCase();
  let category = "home";
  if (rawCat === "companion" || rawCat === "player") category = "companion";
  else if (rawCat === "customer_service" || rawCat === "cs" || rawCat === "service") category = "customer_service";
  let audience = String(row.audience || "").trim().toLowerCase();
  if (audience === "homepage" || audience === "index") audience = "home";
  if (audience === "cs" || audience === "service") audience = "customer_service";
  if (audience === "player") audience = "companion";
  if (audience === "system_internal" || audience === "internal") audience = "system_internal";
  if (!audience) {
    if (category === "companion") audience = "companion";
    else if (category === "customer_service") audience = "customer_service";
    else audience = "home";
  }
  const kind = String(row.kind || "normal").toLowerCase() === "forced" ? "forced" : "normal";
  return {
    id: row.id,
    title: title,
    content: row.content || "",
    text: row.content || title || "",
    category,
    audience,
    kind,
    contentVersion: Number(row.content_version || 1) || 1,
    content_version: Number(row.content_version || 1) || 1,
    requiresAck: kind === "forced" || row.requires_ack === true,
    requires_ack: kind === "forced" || row.requires_ack === true,
    startAt: row.start_at || "",
    endAt: row.end_at || "",
    start_at: row.start_at || "",
    end_at: row.end_at || "",
    scroll: row.is_scrolling !== false,
    is_scrolling: row.is_scrolling !== false,
    sort: row.sort_order == null ? 100 : Number(row.sort_order),
    sort_order: row.sort_order == null ? 100 : Number(row.sort_order),
    enabled: row.is_active !== false,
    pinned: row.is_pinned === true,
    is_pinned: row.is_pinned === true,
    publishedAt: row.published_at || row.created_at || "",
    published_at: row.published_at || row.created_at || "",
    updatedAt: row.updated_at || "",
    created_at: row.created_at || "",
    published: true
  };
}
function inAnnouncementSchedule(row, now = Date.now()) {
  const start = row.start_at || row.startAt;
  const end = row.end_at || row.endAt;
  if (start) {
    const t = Date.parse(start);
    if (Number.isFinite(t) && now < t) return false;
  }
  if (end) {
    const t = Date.parse(end);
    if (Number.isFinite(t) && now > t) return false;
  }
  return true;
}
function matchesAnnouncementAudience(item, audience) {
  const want = String(audience || "").trim().toLowerCase();
  if (!want || want === "all") return true;
  const itemAudience = String(item.audience || "").toLowerCase();
  const category = String(item.category || "").toLowerCase();
  if (itemAudience === "system_internal" || itemAudience === "internal") return false;
  if (itemAudience === "all") return true;
  if (want === "home" || want === "homepage" || want === "boss") {
    // Homepage ticker: home + homepage_only. Boss strip: home only (not homepage_only).
    if (category === "companion" || category === "customer_service") return false;
    if (itemAudience === "companion" || itemAudience === "customer_service") return false;
    if (want === "boss" && category === "homepage_only") return false;
    return category === "home" || category === "homepage_only" || !category || itemAudience === "home" || itemAudience === "all" || itemAudience === "boss";
  }
  if (want === "homepage_only" || want === "home_only") {
    return category === "homepage_only";
  }
  if (want === "companion" || want === "player") {
    return category === "companion" || itemAudience === "companion";
  }
  if (want === "customer_service" || want === "cs") {
    return category === "customer_service" || itemAudience === "customer_service";
  }
  return itemAudience === want || category === want;
}
function isPublicAnnouncementRow(row) {
  const title = String(row?.title || "");
  const content = String(row?.content || "");
  const blob = `${title}\n${content}`;
  const audience = String(row?.audience || "").toLowerCase();
  if (audience === "system_internal" || audience === "internal") return false;
  // Include forced announcements so homepage can popup; ticker clients filter kind.
  if (title.includes("[MCJ_GP]") || title.startsWith("[MCJ_PC]") || blob.includes("MCJ_CS_DOCK")) return false;
  if (/^\s*[{\[]/.test(content) && /"type"\s*:|"slug"\s*:|"draft"\s*:/i.test(content)) return false;
  return true;
}
async function loadAnnouncements(audience) {
  const now = Date.now();
  let list = [];
  try {
    list = await rows(
      "announcements",
      "?is_active=eq.true&order=is_pinned.desc,sort_order.asc.nullslast,published_at.asc.nullslast,created_at.asc&limit=80"
    );
  } catch {
    try {
      list = await rows("announcements", "?is_active=eq.true&order=is_pinned.desc,published_at.desc.nullslast,created_at.desc&limit=80");
    } catch {
      list = await rows("announcements", "?is_active=eq.true&order=created_at.desc&limit=80");
    }
  }
  return list
    .filter(isPublicAnnouncementRow)
    .filter((row) => inAnnouncementSchedule(row, now))
    .map(announcementItem)
    .filter((item) => matchesAnnouncementAudience(item, audience));
}
function serviceTaxonomyItem(service) {
  return {
    id: service.id,
    name: service.name,
    title: service.name,
    category: service.category,
    icon: service.icon || "",
    defaultPrice: service.defaultPrice || service.default_price || "",
    displayPositions: service.displayPositions || service.display_positions || [],
    sort: service.sort,
    enabled: service.enabled !== false,
    showOnHome: service.showHome !== false,
    allowApply: service.allowApply !== false,
    allowOrder: service.allowOrder !== false,
    draft: {
      name: service.name,
      category: service.category,
      icon: service.icon || "",
      defaultPrice: service.defaultPrice || service.default_price || "",
      displayPositions: service.displayPositions || service.display_positions || [],
      showOnHome: service.showHome !== false,
      allowApply: service.allowApply !== false,
      allowOrder: service.allowOrder !== false,
      sort: service.sort
    }
  };
}
function teamLobbyItem(row = {}) {
  const data = (row.published && typeof row.published === "object" ? row.published : null)
    || (row.draft && typeof row.draft === "object" ? row.draft : {})
    || {};
  const status = String(row.status || data.status || "").toLowerCase();
  const published =
    !status ||
    status === "published" ||
    status.includes("发布") ||
    status === "已发布";
  const enabled = row.enabled !== false && published && data.enabled !== false && data.visible !== false;
  const showOnHome = data.showOnHome !== false && data.showOnHome !== "false";
  return {
    id: row.id,
    type: "team_lobby_channels",
    title: data.name || row.title || "未命名频道",
    name: data.name || row.title || "未命名频道",
    status: published ? "已发布" : row.status || "",
    enabled,
    sort: Number(row.sort ?? data.sort ?? 100),
    draft: {
      image: data.image || data.cover || "",
      name: data.name || row.title || "未命名频道",
      description: data.description || data.intro || "",
      discordUrl: data.discordUrl || data.discordLink || data.link || "",
      sort: Number(data.sort ?? row.sort ?? 100),
      enabled,
      showOnHome
    },
    published: {
      image: data.image || data.cover || "",
      name: data.name || row.title || "未命名频道",
      description: data.description || data.intro || "",
      discordUrl: data.discordUrl || data.discordLink || data.link || "",
      sort: Number(data.sort ?? row.sort ?? 100),
      enabled,
      showOnHome
    }
  };
}
function playerRuleItem(row = {}) {
  const draft = row.draft && typeof row.draft === "object" ? row.draft : {};
  const published = row.published && typeof row.published === "object" ? row.published : {};
  const data = { ...published, ...draft };
  const enabled = row.enabled !== false && String(row.status || "published") !== "disabled" && String(row.status || "") !== "unpublished";
  const body = String(data.body || data.content || "").trim();
  return {
    id: row.id,
    type: "player_rules",
    slug: row.slug || data.slug || "",
    title: data.title || row.title || "陪玩制度",
    status: row.status || (enabled ? "published" : "draft"),
    enabled,
    sort: Number(row.sort ?? data.sort ?? 100),
    updated_at: row.updated_at || row.published_at || "",
    published_at: row.published_at || row.updated_at || "",
    draft: {
      title: data.title || row.title || "陪玩制度",
      body,
      content: body,
      subtitle: data.subtitle || "",
      versionNote: data.versionNote || data.version || "",
      version: data.version || data.versionNote || "",
      notes: data.notes || "",
      penaltyRules: data.penaltyRules || "",
      depositRules: data.depositRules || "",
      sort: Number(data.sort ?? row.sort ?? 100),
      forceConfirm: data.forceConfirm === true || data.requiresAck === true,
      slug: row.slug || data.slug || "",
    },
    published: {
      title: data.title || row.title || "陪玩制度",
      body,
      content: body,
      subtitle: data.subtitle || "",
      versionNote: data.versionNote || data.version || "",
      version: data.version || data.versionNote || "",
      notes: data.notes || "",
      penaltyRules: data.penaltyRules || "",
      depositRules: data.depositRules || "",
      sort: Number(data.sort ?? row.sort ?? 100),
      forceConfirm: data.forceConfirm === true || data.requiresAck === true,
      slug: row.slug || data.slug || "",
    },
    body,
    content: body,
    versionNote: data.versionNote || data.version || "",
    notes: data.notes || "",
    penaltyRules: data.penaltyRules || "",
    depositRules: data.depositRules || "",
    forceConfirm: data.forceConfirm === true || data.requiresAck === true,
  };
}

async function loadPlayerRules() {
  try {
    const list = await rows(
      "platform_content_items",
      "?type=eq.player_rules&order=sort.desc,updated_at.desc&limit=20"
    );
    return list
      .map(playerRuleItem)
      .filter((item) => {
        const st = String(item.status || "published").toLowerCase();
        const published = st === "published" || st === "已发布" || st === "";
        return item.enabled !== false && !!item.body && published;
      });
  } catch {
    /* fall through to announcements stub storage */
  }
  try {
    const list = await rows("announcements", "?order=updated_at.desc&limit=200");
    return list
      .filter((row) => String(row.title || "").startsWith("[MCJ_PC]player_rules:"))
      .map((row) => {
        try {
          const parsed = JSON.parse(row.content || "{}");
          if (!parsed || parsed.type !== "player_rules") return null;
          return playerRuleItem({
            ...parsed,
            id: parsed.id || row.id,
            updated_at: row.updated_at || parsed.updated_at || "",
            enabled: row.is_active !== false && parsed.enabled !== false,
            status: parsed.status || (row.is_active === false ? "disabled" : "published"),
          });
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((item) => item.enabled !== false && item.body);
  } catch {
    return [];
  }
}

async function loadTeamLobbyChannels() {
  try {
    const list = await rows(
      "platform_content_items",
      "?type=eq.team_lobby_channels&status=eq.published&enabled=eq.true&order=sort.asc,updated_at.desc&limit=50"
    );
    return list.map(teamLobbyItem).filter((item) => item.enabled !== false);
  } catch {
    /* fall through */
  }
  try {
    const banners = await rows("banners", "?is_active=eq.true&order=sort_order.asc&limit=50");
    return banners
      .filter((row) => /__team_lobby__|组队频道|\[TEST\].*组队/i.test(`${row.title || ""} ${row.subtitle || ""}`))
      .map((row) =>
        teamLobbyItem({
          id: row.id,
          title: row.title,
          status: "published",
          enabled: true,
          sort: row.sort_order || 1,
          draft: {
            image: row.image_url || "",
            name: row.title || "组队频道",
            description: String(row.subtitle || "").replace(/\s*\|?__team_lobby__\|?\s*/g, "").trim(),
            discordUrl: row.button_link || "",
            sort: row.sort_order || 1,
            enabled: true,
            showOnHome: true,
          },
          published: {
            image: row.image_url || "",
            name: row.title || "组队频道",
            description: String(row.subtitle || "").replace(/\s*\|?__team_lobby__\|?\s*/g, "").trim(),
            discordUrl: row.button_link || "",
            sort: row.sort_order || 1,
            enabled: true,
            showOnHome: true,
          },
        })
      )
      .filter((item) => item.enabled !== false && (item.draft?.discordUrl || item.published?.discordUrl));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { ok: false, message: "Method Not Allowed" }); }
  try {
    const raw = String(req.query.types || req.query.type || "banners,announcements");
    const types = raw.split(",").map(cleanType).filter(Boolean);
    const byType = {};
    const needBanners = !types.length || types.includes("banners");
    const needAnnouncements = !types.length || types.includes("announcements");
    const needServices = types.includes("services") || types.includes("games") || types.includes("service_types") || types.includes("hot_games");
    const needLevels = types.includes("companion_levels");
    const needTags = types.includes("companion_tags");
    const needVoiceTypes = types.includes("voice_types");
    const needTeamLobby = types.includes("team_lobby_channels");
    const needPlayerRules = types.includes("player_rules");
    const needWorkRules = types.includes("companion_work_rules");
    const needClubGuide = types.includes("club_level_guide");

    if (hasDatabaseConfig()) {
      if (needBanners) {
        let bannerRows = [];
        try {
          bannerRows = await rows(
            "banners",
            "?is_active=eq.true&order=is_main.desc,sort_order.asc.nullslast,updated_at.desc&limit=100"
          );
        } catch {
          bannerRows = await rows("banners", "?is_active=eq.true&order=sort_order.asc,updated_at.desc&limit=100");
        }
        byType.banners = bannerRows
          .filter((row) => !/__team_lobby__/i.test(String(row.subtitle || "")))
          .map(bannerItem)
          .sort((a, b) => {
            const mainDiff = Number(!!b.isMain) - Number(!!a.isMain);
            if (mainDiff) return mainDiff;
            return Number(a.sort || 100) - Number(b.sort || 100);
          });
      }
      if (needAnnouncements) {
        const audience = String(req.query.audience || req.query.target || "").trim();
        byType.announcements = await loadAnnouncements(audience || "home");
      }
      if (needTeamLobby) byType.team_lobby_channels = await loadTeamLobbyChannels();
      if (needPlayerRules) byType.player_rules = await loadPlayerRules();
      if (needWorkRules) {
        try {
          const rulesApi = await import("../_companion-work-rules.js");
          byType.companion_work_rules = await rulesApi.listWorkRules({ includeDisabled: false });
        } catch {
          byType.companion_work_rules = [];
        }
      }
      if (needClubGuide) {
        try {
          const rulesApi = await import("../_companion-work-rules.js");
          byType.club_level_guide = [await rulesApi.loadClubLevelGuide()];
        } catch {
          byType.club_level_guide = [];
        }
      }
    } else {
      if (needBanners) byType.banners = [];
      if (needAnnouncements) byType.announcements = [];
      if (needTeamLobby) byType.team_lobby_channels = [];
      if (needPlayerRules) byType.player_rules = [];
      if (needWorkRules) byType.companion_work_rules = [];
      if (needClubGuide) byType.club_level_guide = [];
    }

    if (needServices) {
      const loaded = await loadPublicServices();
      const services = Array.isArray(loaded) ? loaded : loaded.services || [];
      const mapped = services.map(serviceTaxonomyItem);
      if (types.includes("services") || !types.length) byType.services = mapped;
      if (types.includes("games")) {
        byType.games = mapped.filter(
          (item) => item.allowApply !== false && (item.displayPositions || []).includes("companion_apply")
        );
      }
      if (types.includes("service_types")) {
        // 服务类型固定为陪玩/陪聊，禁止把 games/services 游戏名塞进服务类型
        byType.service_types = [
          { id: "play_service", name: "陪玩服务", title: "陪玩服务", category: "服务类型", enabled: true, sort: 1 },
          { id: "chat_service", name: "陪聊服务", title: "陪聊服务", category: "服务类型", enabled: true, sort: 2 },
        ];
      }
      if (types.includes("hot_games")) {
        byType.hot_games = mapped.filter(
          (item) => item.showOnHome !== false && (item.displayPositions || []).includes("home")
        );
      }
    }

    if (needLevels) {
      const levels = await readLocalLevels();
      byType.companion_levels = levels.filter((item) => item.enabled !== false).map(toPublicLevel);
    }

    if (needTags) {
      const tags = await readLocalTags();
      byType.companion_tags = tags.filter((item) => item.enabled !== false).map(toPublicTag);
    }

    if (needVoiceTypes) {
      const voices = await readVoiceTypes();
      byType.voice_types = voices.filter((item) => item.enabled !== false).map(toPublicVoiceType);
    }

    const items = Object.keys(byType).flatMap((type) => byType[type].map((item) => ({ id: item.id, type, title: item.title || item.name, sort: item.sort, enabled: item.enabled, data: item })));
    return json(res, 200, { ok: true, configured: true, items, byType });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "平台内容接口异常" });
  }
}
