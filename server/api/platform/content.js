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
  return {
    id: row.id,
    title: title,
    content: row.content || "",
    text: row.content || title || "",
    sort: row.sort_order || 100,
    enabled: row.is_active !== false,
    pinned: row.is_pinned === true,
    is_pinned: row.is_pinned === true,
    publishedAt: row.published_at || row.created_at || "",
    published_at: row.published_at || row.created_at || "",
    created_at: row.created_at || "",
    published: true
  };
}
async function loadAnnouncements() {
  try {
    return (await rows("announcements", "?is_active=eq.true&order=is_pinned.desc,published_at.desc.nullslast,created_at.desc&limit=50"))
      .filter((row) => !String(row.title || "").includes("[MCJ_GP]") && !String(row.title || "").startsWith("[MCJ_PC]"))
      .map(announcementItem);
  } catch {
    return (await rows("announcements", "?is_active=eq.true&order=created_at.desc&limit=50"))
      .filter((row) => !String(row.title || "").includes("[MCJ_GP]") && !String(row.title || "").startsWith("[MCJ_PC]"))
      .map(announcementItem);
  }
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

    if (hasDatabaseConfig()) {
      if (needBanners) {
        byType.banners = (await rows("banners", "?is_active=eq.true&order=sort_order.asc,updated_at.desc&limit=20"))
          .filter((row) => !/__team_lobby__/i.test(String(row.subtitle || "")))
          .map(bannerItem);
      }
      if (needAnnouncements) byType.announcements = await loadAnnouncements();
      if (needTeamLobby) byType.team_lobby_channels = await loadTeamLobbyChannels();
    } else {
      if (needBanners) byType.banners = [];
      if (needAnnouncements) byType.announcements = [];
      if (needTeamLobby) byType.team_lobby_channels = [];
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
        byType.service_types = mapped.filter(
          (item) =>
            item.allowOrder !== false &&
            ((item.displayPositions || []).includes("boss_order") || (item.displayPositions || []).includes("cs_order"))
        );
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
