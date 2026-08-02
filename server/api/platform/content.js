import { loadPublicServices } from "./services.js";
import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";
import { readLocalTags, toPublicTag } from "../_companion-tags-store.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function hasDatabaseConfig() { return REQUIRED_ENV.every((key) => process.env[key]); }
function json(res, status, data) { res.status(status).json(data); }
function headers() { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }; }
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
  const title = stripMcjMarker(row.title || "");
  return {
    id: row.id,
    title: title,
    name: title || "MEOW CUI JIAO Banner",
    subtitle: row.subtitle || "",
    image: image,
    image_url: image,
    desktopImage: image,
    mobileImage: row.mobile_image_url || image,
    buttonText: row.button_text || "",
    button_text: row.button_text || "",
    link: row.button_link || "",
    href: row.button_link || "",
    button_link: row.button_link || "",
    sort: row.sort_order == null ? 100 : row.sort_order,
    enabled: row.is_active === true,
    published: true,
    fitMode: "cover"
  };
}
function announcementItem(row) {
  const title = stripMcjMarker(row.title || "");
  const category = String(row.category || "").trim().toLowerCase() === "companion" ? "companion" : "home";
  let audience = String(row.audience || "").trim().toLowerCase();
  if (audience === "homepage" || audience === "index") audience = "home";
  if (audience === "cs" || audience === "service") audience = "customer_service";
  if (audience === "player") audience = "companion";
  if (!audience) audience = category === "companion" ? "companion" : "home";
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
  if (itemAudience === "all") return true;
  if (want === "home" || want === "homepage" || want === "boss") {
    // Homepage / boss: home category, or audience home/boss/all; legacy empty = home
    if (category === "companion" && itemAudience !== "all" && itemAudience !== "home" && itemAudience !== "boss") return false;
    if (itemAudience === "companion" || itemAudience === "customer_service") return false;
    return category !== "companion" || itemAudience === "home" || itemAudience === "boss" || itemAudience === "all" || !itemAudience;
  }
  if (want === "companion" || want === "player") {
    return category === "companion" || itemAudience === "companion" || itemAudience === "all";
  }
  if (want === "customer_service" || want === "cs") {
    return itemAudience === "customer_service" || itemAudience === "all";
  }
  return itemAudience === want || category === want;
}
async function loadAnnouncements(audience) {
  const now = Date.now();
  let list = [];
  try {
    list = await rows(
      "announcements",
      "?is_active=eq.true&order=is_pinned.desc,sort_order.asc.nullslast,published_at.desc.nullslast,created_at.desc&limit=80"
    );
  } catch {
    try {
      list = await rows("announcements", "?is_active=eq.true&order=is_pinned.desc,published_at.desc.nullslast,created_at.desc&limit=80");
    } catch {
      list = await rows("announcements", "?is_active=eq.true&order=created_at.desc&limit=80");
    }
  }
  return list
    .filter((row) => !String(row.title || "").includes("[MCJ_GP]") && !String(row.title || "").startsWith("[MCJ_PC]"))
    .filter((row) => inAnnouncementSchedule(row, now))
    .map(announcementItem)
    .filter((item) => {
      const blob = `${item?.title || ""} ${item?.content || ""} ${item?.body || ""}`;
      return !blob.includes("[MCJ_CS_DOCK_REWARD_SETTINGS]");
    })
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
  const enabled = row.enabled !== false && String(row.status || "").toLowerCase() === "published";
  return {
    id: row.id,
    type: "team_lobby_channels",
    title: data.name || row.title || "未命名频道",
    name: data.name || row.title || "未命名频道",
    status: row.status === "published" ? "已发布" : row.status || "",
    enabled,
    sort: Number(row.sort ?? data.sort ?? 100),
    draft: {
      image: data.image || data.cover || "",
      name: data.name || row.title || "未命名频道",
      description: data.description || data.intro || "",
      discordUrl: data.discordUrl || data.discordLink || data.link || "",
      sort: Number(data.sort ?? row.sort ?? 100),
      enabled
    },
    published: {
      image: data.image || data.cover || "",
      name: data.name || row.title || "未命名频道",
      description: data.description || data.intro || "",
      discordUrl: data.discordUrl || data.discordLink || data.link || "",
      sort: Number(data.sort ?? row.sort ?? 100),
      enabled
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
    },
    body,
    content: body,
    versionNote: data.versionNote || data.version || "",
    notes: data.notes || "",
    penaltyRules: data.penaltyRules || "",
    depositRules: data.depositRules || "",
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
          },
          published: {
            image: row.image_url || "",
            name: row.title || "组队频道",
            description: String(row.subtitle || "").replace(/\s*\|?__team_lobby__\|?\s*/g, "").trim(),
            discordUrl: row.button_link || "",
            sort: row.sort_order || 1,
            enabled: true,
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
    const needTeamLobby = types.includes("team_lobby_channels");
    const needPlayerRules = types.includes("player_rules");
    const needWorkRules = types.includes("companion_work_rules");
    const needClubGuide = types.includes("club_level_guide");

    if (hasDatabaseConfig()) {
      if (needBanners) {
        byType.banners = (await rows("banners", "?is_active=eq.true&order=sort_order.asc,updated_at.desc&limit=20"))
          .filter((row) => !/__team_lobby__/i.test(String(row.subtitle || "")))
          .map(bannerItem);
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

    const items = Object.keys(byType).flatMap((type) => byType[type].map((item) => ({ id: item.id, type, title: item.title || item.name, sort: item.sort, enabled: item.enabled, data: item })));
    return json(res, 200, { ok: true, configured: true, items, byType });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "平台内容接口异常" });
  }
}
