const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function storageUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/${path}`;
}
function publicStorageUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${path}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
}
function supabaseError(body, response) {
  const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
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
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status, body });
  return body;
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问后台内容管理。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}
async function uploadBanner(dataUrl, filename = "banner") {
  const file = decodeDataUrl(dataUrl);
  if (!file) return "";
  const ext = (file.contentType.split("/")[1] || "png").replace("jpeg", "jpg");
  const path = `banners/${Date.now()}-${filename.replace(/[^a-z0-9.-]/gi, "-")}.${ext}`;
  const response = await fetch(storageUrl(`banners/${path}`), {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.contentType,
      "x-upsert": "true",
    },
    body: file.buffer,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Banner 图片上传失败：${text || response.status}`);
  }
  return publicStorageUrl(`banners/${path}`);
}
function truthy(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off", "停用", "关闭", "隐藏", "否", "下线"].includes(text)) return false;
  if (["true", "1", "yes", "on", "启用", "开启", "显示", "是", "上线"].includes(text)) return true;
  return fallback;
}
function toIsoDateTime(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}
const ANNOUNCEMENT_CATEGORIES = new Set(["home", "companion", "customer_service"]);
const ANNOUNCEMENT_AUDIENCES = new Set(["home", "boss", "companion", "customer_service", "all"]);

function normalizeCategory(value, audience) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "homepage" || raw === "boss" || raw === "index") return "home";
  if (raw === "player" || raw === "陪玩" || raw === "companion") return "companion";
  if (raw === "cs" || raw === "service" || raw === "customer-service" || raw === "客服" || raw === "客服公告") {
    return "customer_service";
  }
  if (ANNOUNCEMENT_CATEGORIES.has(raw)) return raw;
  const aud = String(audience || "").trim().toLowerCase();
  if (aud === "companion") return "companion";
  if (aud === "customer_service" || aud === "cs") return "customer_service";
  return "home";
}
function normalizeAudience(value, category) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "homepage" || raw === "index") return "home";
  if (raw === "cs" || raw === "service" || raw === "customer-service") return "customer_service";
  if (raw === "player") return "companion";
  if (raw === "system_internal" || raw === "internal") return "system_internal";
  if (ANNOUNCEMENT_AUDIENCES.has(raw)) return raw;
  const cat = normalizeCategory(category);
  if (cat === "companion") return "companion";
  if (cat === "customer_service") return "customer_service";
  return "home";
}
/** Real admin-published announcements only — exclude configs / forced / stubs. */
function isAdminManagedAnnouncement(row = {}) {
  const title = String(row.title || "");
  const content = String(row.content || "");
  const blob = `${title}\n${content}`;
  const audience = String(row.audience || "").trim().toLowerCase();
  if (audience === "system_internal" || audience === "internal") return false;
  if (title.startsWith("[MCJ_PC]") || title.includes("[MCJ_GP]") || blob.includes("MCJ_CS_DOCK")) return false;
  if (/^\s*[{\[]/.test(content) && /"type"\s*:|"slug"\s*:|"draft"\s*:|gameplay|ad_slots|reward/i.test(content)) {
    return false;
  }
  return true;
}
function optionalIsoDateTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
function mapAnnouncement(row = {}) {
  const category = normalizeCategory(row.category, row.audience);
  const audience = normalizeAudience(row.audience, category);
  const kind = String(row.kind || "normal").toLowerCase() === "forced" ? "forced" : "normal";
  return {
    id: row.id,
    title: row.title || "",
    content: row.content || "",
    category,
    audience,
    kind,
    content_version: Number(row.content_version || 1) || 1,
    requires_ack: kind === "forced" || row.requires_ack === true,
    start_at: row.start_at || "",
    end_at: row.end_at || "",
    is_scrolling: row.is_scrolling !== false,
    sort_order: Number(row.sort_order ?? 100),
    is_active: row.is_active !== false,
    is_pinned: row.is_pinned === true,
    published_at: row.published_at || row.created_at || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}
function announcementPayload(input = {}, previous = null) {
  const title = String(input.title || "").trim();
  const content = String(input.content || "").trim();
  if (!title) throw Object.assign(new Error("请填写公告标题。"), { status: 400 });
  if (!content) throw Object.assign(new Error("请填写公告内容。"), { status: 400 });
  if (title.startsWith("[MCJ_PC]") || title.includes("[MCJ_GP]") || content.includes("MCJ_CS_DOCK")) {
    throw Object.assign(new Error("公告管理仅允许发布真实公告，不可写入系统配置 JSON。"), { status: 400 });
  }
  const category = normalizeCategory(input.category || input.announcement_category, input.audience);
  let audience = normalizeAudience(input.audience || input.target || input.publish_to, category);
  // Category owns routing for admin-published announcements.
  if (category === "companion") audience = "companion";
  else if (category === "customer_service") audience = "customer_service";
  else if (audience === "companion" || audience === "customer_service") audience = "home";
  if (audience === "system_internal") {
    throw Object.assign(new Error("系统内部配置不可写入公告管理。"), { status: 400 });
  }
  const sortOrder = Number(input.sort_order ?? input.sortOrder ?? input.sort ?? 100);
  const kindRaw = String(input.kind || previous?.kind || "normal").trim().toLowerCase();
  const kind = kindRaw === "forced" || truthy(input.requires_ack ?? input.requiresAck, false) ? "forced" : "normal";
  let contentVersion = Number(input.content_version ?? input.contentVersion ?? previous?.content_version ?? 1) || 1;
  if (previous && (String(previous.content || "") !== content || String(previous.title || "") !== title)) {
    contentVersion = (Number(previous.content_version) || 1) + 1;
  }
  const clearSchedule = truthy(input.clear_schedule ?? input.clearSchedule, false);
  const startAt = clearSchedule ? null : optionalIsoDateTime(input.start_at || input.startAt);
  const endAt = clearSchedule ? null : optionalIsoDateTime(input.end_at || input.endAt);
  const publishedAt =
    optionalIsoDateTime(input.published_at || input.publishedAt || input.publish_time) ||
    previous?.published_at ||
    new Date().toISOString();
  return {
    title,
    content,
    category,
    audience,
    kind,
    content_version: contentVersion,
    requires_ack: kind === "forced",
    start_at: startAt,
    end_at: endAt,
    is_scrolling: truthy(input.is_scrolling ?? input.isScrolling ?? input.scroll, true),
    sort_order: Number.isFinite(sortOrder) ? Math.max(0, Math.round(sortOrder)) : 100,
    is_active: truthy(input.is_active ?? input.isActive ?? input.visible, true),
    is_pinned: truthy(input.is_pinned ?? input.isPinned ?? input.pinned, false),
    published_at: publishedAt,
    updated_at: new Date().toISOString(),
  };
}
function payloadFallbacks(payload) {
  return [
    payload,
    {
      title: payload.title,
      content: payload.content,
      category: payload.category,
      audience: payload.audience,
      kind: payload.kind,
      content_version: payload.content_version,
      requires_ack: payload.requires_ack,
      start_at: payload.start_at,
      end_at: payload.end_at,
      is_scrolling: payload.is_scrolling,
      sort_order: payload.sort_order,
      is_active: payload.is_active,
      is_pinned: payload.is_pinned,
      published_at: payload.published_at,
      updated_at: payload.updated_at,
    },
    {
      title: payload.title,
      content: payload.content,
      category: payload.category,
      audience: payload.audience,
      start_at: payload.start_at,
      end_at: payload.end_at,
      is_scrolling: payload.is_scrolling,
      sort_order: payload.sort_order,
      is_active: payload.is_active,
      is_pinned: payload.is_pinned,
      published_at: payload.published_at,
      updated_at: payload.updated_at,
    },
    {
      title: payload.title,
      content: payload.content,
      category: payload.category,
      audience: payload.audience,
      is_active: payload.is_active,
      is_pinned: payload.is_pinned,
      published_at: payload.published_at,
      updated_at: payload.updated_at,
    },
    {
      title: payload.title,
      content: payload.content,
      is_active: payload.is_active,
      is_pinned: payload.is_pinned,
      published_at: payload.published_at,
      updated_at: payload.updated_at,
    },
    {
      title: payload.title,
      content: payload.content,
      is_active: payload.is_active,
      updated_at: payload.updated_at,
    },
  ];
}
async function listAnnouncements() {
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl("announcements", "?order=category.asc,is_pinned.desc,sort_order.asc.nullslast,published_at.desc.nullslast,created_at.desc&limit=200"),
      { headers: serviceHeaders() }
    );
  } catch {
    try {
      rows = await supabaseJson(
        restUrl("announcements", "?order=is_pinned.desc,published_at.desc.nullslast,created_at.desc&limit=200"),
        { headers: serviceHeaders() }
      );
    } catch {
      rows = await supabaseJson(restUrl("announcements", "?order=created_at.desc&limit=200"), { headers: serviceHeaders() });
    }
  }
  return (Array.isArray(rows) ? rows : []).filter(isAdminManagedAnnouncement).map(mapAnnouncement);
}
async function saveAnnouncement(input = {}) {
  const id = String(input.id || "").trim();
  let previous = null;
  if (id) {
    try {
      const rows = await supabaseJson(restUrl("announcements", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: serviceHeaders(),
      });
      previous = Array.isArray(rows) ? rows[0] : null;
    } catch {
      previous = null;
    }
  }
  const payload = announcementPayload(input, previous);
  const attempts = payloadFallbacks(payload);
  let lastError = null;
  for (const body of attempts) {
    try {
      if (id) {
        const rows = await supabaseJson(restUrl("announcements", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(body),
        });
        return mapAnnouncement(rows?.[0] || { ...body, id });
      }
      const rows = await supabaseJson(restUrl("announcements"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ ...body, created_at: new Date().toISOString() }),
      });
      return mapAnnouncement(rows?.[0] || body);
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || error?.body?.message || "");
      // Retry only when PostgREST rejects unknown columns / schema cache.
      if (!/column|schema cache|Could not find/i.test(msg)) throw error;
    }
  }
  throw lastError || Object.assign(new Error("公告保存失败。"), { status: 500 });
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      banners: [],
      announcements: [],
      message: "未配置 Supabase，后台内容不返回假数据。",
    });
  }
  try {
    await requireAdmin(req);
    if (req.method === "GET") {
      const [banners, announcements] = await Promise.all([
        supabaseJson(restUrl("banners", "?order=sort_order.asc,created_at.desc&limit=100"), { headers: serviceHeaders() }).catch(() => []),
        listAnnouncements().catch(() => []),
      ]);
      return json(res, 200, { ok: true, configured: true, banners, announcements });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method Not Allowed" });
    const body = await parseBody(req);
    const action = String(body.action || "");
    if (action === "save_banner") {
      const input = body.banner || body;
      let imageUrl = String(input.image_url || input.imageUrl || "");
      if (input.image_data) imageUrl = await uploadBanner(input.image_data, input.filename || "banner");
      const payload = {
        title: String(input.title || ""),
        subtitle: String(input.subtitle || ""),
        image_url: imageUrl,
        button_text: String(input.button_text || input.buttonText || ""),
        button_link: String(input.button_link || input.buttonLink || ""),
        is_active: input.is_active === true || input.isActive === true || String(input.is_active || input.status || "true") !== "false",
        sort_order: Number(input.sort_order || input.sortOrder || 0),
        updated_at: new Date().toISOString(),
      };
      if (input.id) {
        const rows = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(input.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(payload),
        });
        return json(res, 200, { ok: true, message: "Banner 已保存。", banner: rows[0] || null });
      }
      const rows = await supabaseJson(restUrl("banners"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
      });
      return json(res, 200, { ok: true, message: "Banner 已新增。", banner: rows[0] || null });
    }
    if (action === "delete_banner") {
      await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(String(body.id || ""))}`), {
        method: "DELETE",
        headers: serviceHeaders(),
      });
      return json(res, 200, { ok: true, message: "Banner 已删除。" });
    }
    if (action === "save_announcement") {
      const announcement = await saveAnnouncement(body.announcement || body);
      return json(res, 200, { ok: true, message: "公告已保存，对应端将实时同步显示。", announcement });
    }
    if (action === "delete_announcement") {
      await supabaseJson(restUrl("announcements", `?id=eq.${encodeURIComponent(String(body.id || ""))}`), {
        method: "DELETE",
        headers: serviceHeaders(),
      });
      return json(res, 200, { ok: true, message: "公告已删除。" });
    }
    return json(res, 400, { ok: false, message: "未知内容管理操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "内容管理接口异常。" });
  }
}
