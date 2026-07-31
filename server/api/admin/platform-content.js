const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "platform_content_items";
const ADMIN_ROLES = new Set(["super_admin", "admin", "content_admin"]);

function roleFromRequest(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-mcj-role"] || "").trim();
}

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

function endpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${TABLE}${path}`;
}

function announcementsEndpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/announcements${path}`;
}

const ANN_PREFIX = "[MCJ_PC]";

function isMissingTableError(error) {
  return /PGRST205|Could not find the table|schema cache/i.test(String(error?.message || error || ""));
}

function annTitle(type, slug) {
  return `${ANN_PREFIX}${type}:${slug || "item"}`;
}

function itemFromAnnouncement(row = {}) {
  try {
    const parsed = JSON.parse(row.content || "{}");
    if (parsed && parsed.type) {
      return {
        ...parsed,
        id: parsed.id || row.id,
        _source: "announcements",
        _announcementId: row.id,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function listAnnouncementItems(type = "") {
  const rows = await fetch(announcementsEndpoint("?is_active=eq.true&order=updated_at.desc&limit=200"), {
    headers: headers(),
  }).then(async (response) => {
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) throw new Error(body?.message || "读取 announcements 失败");
    return Array.isArray(body) ? body : [];
  });
  return rows
    .filter((row) => String(row.title || "").startsWith(ANN_PREFIX))
    .map(itemFromAnnouncement)
    .filter(Boolean)
    .filter((item) => !type || item.type === type);
}

async function upsertAnnouncementItem(item) {
  const title = annTitle(item.type, item.slug || item.id);
  const content = JSON.stringify(item);
  const existingRes = await fetch(
    announcementsEndpoint(`?title=eq.${encodeURIComponent(title)}&limit=1`),
    { headers: headers() }
  );
  const existingText = await existingRes.text();
  let existing = null;
  try {
    existing = existingText ? JSON.parse(existingText) : null;
  } catch {
    existing = null;
  }
  const row = { title, content, is_active: item.enabled !== false, updated_at: new Date().toISOString() };
  if (Array.isArray(existing) && existing[0]) {
    const response = await fetch(announcementsEndpoint(`?id=eq.${encodeURIComponent(existing[0].id)}`), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(row),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || "更新失败");
    return { ...item, id: item.id || existing[0].id, _source: "announcements", _announcementId: existing[0].id };
  }
  const response = await fetch(announcementsEndpoint(""), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(row),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.message || text || "创建失败");
  const created = Array.isArray(body) ? body[0] : body;
  return { ...item, id: item.id || created?.id, _source: "announcements", _announcementId: created?.id };
}

function bannersEndpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/banners${path}`;
}

function publicAnnouncementEndpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/announcements${path}`;
}

/** Mirror platform_content banners → public `banners` table (homepage source of truth). */
async function syncBannerToPublicTable(item) {
  const draft = item?.draft && typeof item.draft === "object" ? item.draft : {};
  const published = item?.published && typeof item.published === "object" ? item.published : {};
  const src = { ...draft, ...published };
  const image =
    String(src.desktopImage || src.mobileImage || src.image || src.image_url || src.imageUrl || "").trim();
  const title = String(item.title || src.title || src.name || "Banner").trim() || "Banner";
  const subtitle = String(src.subtitle || "").trim();
  const buttonText = String(src.buttonText || src.button_text || "").trim();
  const buttonLink = String(src.link || src.href || src.button_link || src.buttonLink || "").trim();
  const sort = Number(item.sort ?? src.sort ?? 100);
  const active = item.enabled !== false && String(item.status || "published") !== "disabled";
  const externalId = String(item.id || item.slug || "").trim();
  const row = {
    title,
    subtitle,
    image_url: image,
    button_text: buttonText,
    button_link: buttonLink,
    is_active: active,
    sort_order: Number.isFinite(sort) ? sort : 100,
    updated_at: new Date().toISOString(),
  };
  // Prefer upsert by matching title+image when possible; deactivate others when publishing active.
  if (active) {
    await fetch(bannersEndpoint("?is_active=eq.true"), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }
  const marker = `[mcj:${externalId}]`;
  const taggedTitle = title.includes(marker) ? title : `${title} ${marker}`.trim();
  row.title = taggedTitle;
  const existingRes = await fetch(
    bannersEndpoint(`?title=eq.${encodeURIComponent(taggedTitle)}&limit=1`),
    { headers: headers() }
  );
  const existingText = await existingRes.text();
  let existing = [];
  try {
    existing = existingText ? JSON.parse(existingText) : [];
  } catch {
    existing = [];
  }
  if (Array.isArray(existing) && existing[0]?.id) {
    const response = await fetch(bannersEndpoint(`?id=eq.${encodeURIComponent(existing[0].id)}`), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(row),
    });
    if (!response.ok) throw new Error((await response.text()) || "同步 banners 失败");
    return;
  }
  const response = await fetch(bannersEndpoint(""), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...row, created_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error((await response.text()) || "写入 banners 失败");
}

/** Mirror real homepage announcements (not [MCJ_PC] stubs) into `announcements`. */
async function syncAnnouncementToPublicTable(item) {
  const draft = item?.draft && typeof item.draft === "object" ? item.draft : {};
  const content = String(draft.content || draft.text || item.title || "").trim();
  const title = String(item.title || draft.title || content.slice(0, 40) || "公告").trim();
  const active = item.enabled !== false && String(item.status || "") !== "disabled";
  const externalId = String(item.id || item.slug || "").trim();
  const marker = `[mcj-ann:${externalId}]`;
  const taggedTitle = title.includes(marker) ? title : `${title} ${marker}`.trim();
  const row = {
    title: taggedTitle,
    content: content || title,
    is_active: active,
    updated_at: new Date().toISOString(),
  };
  const existingRes = await fetch(
    publicAnnouncementEndpoint(`?title=eq.${encodeURIComponent(taggedTitle)}&limit=1`),
    { headers: headers() }
  );
  const existingText = await existingRes.text();
  let existing = [];
  try {
    existing = existingText ? JSON.parse(existingText) : [];
  } catch {
    existing = [];
  }
  if (Array.isArray(existing) && existing[0]?.id) {
    const response = await fetch(publicAnnouncementEndpoint(`?id=eq.${encodeURIComponent(existing[0].id)}`), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(row),
    });
    if (!response.ok) throw new Error((await response.text()) || "同步 announcements 失败");
    return;
  }
  const response = await fetch(publicAnnouncementEndpoint(""), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...row, created_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error((await response.text()) || "写入 announcements 失败");
}

async function syncPublicFrontTables(item) {
  if (!item?.type) return;
  try {
    if (item.type === "banners") await syncBannerToPublicTable(item);
    if (item.type === "announcements") await syncAnnouncementToPublicTable(item);
  } catch (error) {
    console.error("[platform-content] public sync failed", item.type, String(error?.message || error));
  }
}

function json(res, status, data) {
  res.status(status).json(data);
}

function sanitizeType(type) {
  return String(type || "").trim().replace(/[^a-z0-9_:-]/gi, "");
}

function normalizeStatus(value, fallback = "draft") {
  const text = String(value || "").trim().toLowerCase();
  if (["published", "publish", "online"].includes(text) || text.includes("发布")) return "published";
  if (["pending", "pending_publish"].includes(text) || text.includes("待")) return "pending";
  if (["unpublished", "offline"].includes(text) || text.includes("下架")) return "unpublished";
  if (["disabled", "inactive"].includes(text) || text.includes("停")) return "disabled";
  if (["draft", "草稿"].includes(text)) return "draft";
  return fallback;
}

function normalizeBool(value, fallback = true) {
  if (value === true || value === "true" || value === "1" || value === 1 || value === "启用") return true;
  if (value === false || value === "false" || value === "0" || value === 0 || value === "停用") return false;
  return fallback;
}

function normalizeItem(input = {}, fallbackType = "") {
  const type = sanitizeType(input.type || fallbackType);
  const draft = input.draft && typeof input.draft === "object" ? input.draft : {};
  const title = String(input.title || draft.title || draft.name || draft.content || "").trim();
  const sort = Number(input.sort ?? draft.sort ?? 100);
  return {
    type,
    slug: String(input.slug || draft.slug || title || `${type}-${Date.now()}`).trim(),
    title,
    status: normalizeStatus(input.status, "draft"),
    enabled: normalizeBool(input.enabled, true),
    sort: Number.isFinite(sort) ? sort : 100,
    draft,
    updated_by: String(input.updatedBy || input.admin || "super_admin"),
    updated_at: new Date().toISOString()
  };
}

function supabaseError(body, response) {
  const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
  const base = parts[0] || "数据库请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status}) · table=${TABLE}`;
}
async function supabaseFetch(path, init = {}) {
  const response = await fetch(endpoint(path), { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(supabaseError(body, response));
  }
  return body;
}

async function getItem(id) {
  const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function writeLog(req, action, type, itemId, beforeValue, afterValue) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/admin_operation_logs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        module: "platform_content",
        action,
        target_type: type,
        target_id: itemId,
        operator_role: roleFromRequest(req),
        before_value: beforeValue || null,
        after_value: afterValue || null,
        created_at: new Date().toISOString()
      })
    });
  } catch {}
}

export default async function handler(req, res) {
  const role = roleFromRequest(req);
  if (!ADMIN_ROLES.has(role)) {
    return json(res, 403, { ok: false, message: "没有平台内容管理权限" });
  }
  if (!hasDatabaseConfig()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      items: [],
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，平台内容没有写入任何本地假数据。",
      requiredTable: TABLE
    });
  }

  try {
    if (req.method === "GET") {
      const type = sanitizeType(req.query.type);
      const query = type
        ? `?type=eq.${encodeURIComponent(type)}&order=sort.asc,updated_at.desc`
        : "?order=type.asc,sort.asc,updated_at.desc";
      try {
        const items = await supabaseFetch(query);
        return json(res, 200, { ok: true, configured: true, items, source: TABLE });
      } catch (error) {
        const message = error.message || "平台内容读取失败";
        const missing = isMissingTableError(message);
        if (missing) {
          const items = await listAnnouncementItems(type).catch(() => []);
          return json(res, 200, {
            ok: true,
            configured: true,
            items,
            source: "announcements",
            message: items.length ? "使用 announcements 兼容存储（platform_content_items 未建表）。" : message,
            requiredTable: TABLE,
            hint: "数据库中不存在 platform_content_items。已回退 announcements 兼容读写优惠券/广告位等。",
          });
        }
        throw error;
      }
    }

    if (req.method === "POST") {
      const action = String(req.body?.action || "save");
      const type = sanitizeType(req.body?.type);
      const id = req.body?.id ? String(req.body.id) : "";
      const payload = req.body?.payload || {};

      if (action === "create") {
        const item = normalizeItem(payload, type);
        item.created_by = role;
        item.created_at = new Date().toISOString();
        if (!item.id) item.id = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (item.type === "banners" && item.enabled !== false) {
          item.status = "published";
          item.published = item.draft || {};
          item.version = 1;
          item.published_by = role;
          item.published_at = new Date().toISOString();
        }
        try {
          const rows = await supabaseFetch("", { method: "POST", body: JSON.stringify(item) });
          const saved = rows?.[0] || item;
          await syncPublicFrontTables(saved);
          await writeLog(req, item.type === "banners" ? "create_publish" : "create", item.type, saved?.id, null, saved);
          return json(res, 200, { ok: true, message: item.type === "banners" ? "已保存并同步到前台" : "已保存", item: saved });
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
          const saved = await upsertAnnouncementItem(item);
          await syncPublicFrontTables(saved);
          return json(res, 200, { ok: true, message: "已保存（announcements 兼容存储）", item: saved, source: "announcements" });
        }
      }

      if (!id) return json(res, 400, { ok: false, message: "缺少内容 ID" });
      let before = null;
      try {
        before = await getItem(id);
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
      if (!before) {
        const annItems = await listAnnouncementItems(type).catch(() => []);
        before = annItems.find((item) => String(item.id) === String(id) || String(item._announcementId) === String(id)) || null;
      }
      if (!before) return json(res, 404, { ok: false, message: "内容不存在" });

      if (action === "save") {
        const mergedPayload = {
          ...before,
          ...payload,
          draft: { ...(before.draft || {}), ...(payload.draft || {}) },
          title: payload.title ?? before.title,
          slug: payload.slug ?? before.slug,
          status: payload.status ?? before.status,
          enabled: payload.enabled ?? before.enabled,
          sort: payload.sort ?? before.sort
        };
        const item = normalizeItem(mergedPayload, before.type);
        item.id = before.id || id;
        if (before.type === "banners" && item.enabled !== false) {
          item.status = "published";
          item.published = item.draft || {};
          item.version = Number(before.version || 0) + 1;
          item.published_by = role;
          item.published_at = new Date().toISOString();
        }
        try {
          const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(item) });
          const saved = rows?.[0] || item;
          await syncPublicFrontTables(saved);
          await writeLog(req, before.type === "banners" ? "save_publish" : "save_draft", before.type, id, before, saved);
          return json(res, 200, { ok: true, message: before.type === "banners" ? "已保存并同步到前台" : "已保存", item: saved });
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
          const saved = await upsertAnnouncementItem(item);
          await syncPublicFrontTables(saved);
          return json(res, 200, { ok: true, message: "已保存（announcements 兼容存储）", item: saved, source: "announcements" });
        }
      }

      if (action === "publish") {
        const version = Number(before.version || 0) + 1;
        const next = {
          status: "published",
          enabled: before.enabled !== false,
          published: before.draft || {},
          version,
          published_by: role,
          published_at: new Date().toISOString(),
          updated_by: role,
          updated_at: new Date().toISOString()
        };
        const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(next) });
        const saved = { ...before, ...(rows?.[0] || next) };
        await syncPublicFrontTables(saved);
        await writeLog(req, "publish", before.type, id, before, saved);
        return json(res, 200, { ok: true, message: "已发布并同步到前台", item: saved });
      }

      if (action === "unpublish" || action === "disable") {
        const next = {
          status: action === "disable" ? "disabled" : "unpublished",
          enabled: action !== "disable",
          updated_by: role,
          updated_at: new Date().toISOString()
        };
        const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(next) });
        await writeLog(req, action, before.type, id, before, rows?.[0] || next);
        return json(res, 200, { ok: true, message: action === "disable" ? "已停用" : "已下架", item: rows?.[0] || next });
      }

      if (action === "delete") {
        await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
        await writeLog(req, "delete", before.type, id, before, null);
        return json(res, 200, { ok: true, message: "已删除" });
      }

      if (action === "duplicate") {
        const copy = {
          ...before,
          id: undefined,
          title: `${before.title || "未命名"} 副本`,
          slug: `${before.slug || before.type}-${Date.now()}`,
          status: "draft",
          published: null,
          version: 0,
          created_by: role,
          created_at: new Date().toISOString(),
          updated_by: role,
          updated_at: new Date().toISOString(),
          published_by: null,
          published_at: null
        };
        const rows = await supabaseFetch("", { method: "POST", body: JSON.stringify(copy) });
        await writeLog(req, "duplicate", before.type, rows?.[0]?.id, before, rows?.[0] || copy);
        return json(res, 200, { ok: true, message: "已复制", item: rows?.[0] || copy });
      }

      if (action === "reorder") {
        const sort = Number(payload.sort);
        if (!Number.isFinite(sort)) return json(res, 400, { ok: false, message: "排序值无效" });
        const next = { sort, updated_by: role, updated_at: new Date().toISOString() };
        const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(next) });
        await writeLog(req, "reorder", before.type, id, before, rows?.[0] || next);
        return json(res, 200, { ok: true, message: "排序已更新", item: rows?.[0] || next });
      }

      return json(res, 400, { ok: false, message: "未知平台内容操作" });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "平台内容接口异常" });
  }
}

