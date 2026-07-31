const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const BANNER_BUCKET = () => String(process.env.SUPABASE_CONTENT_BUCKET || process.env.SUPABASE_BANNER_BUCKET || "banners").trim() || "banners";

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
function storageObjectUrl(bucket, objectPath) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
}
function publicStorageUrl(bucket, objectPath) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
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
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status });
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
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问 Banner 管理。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}
async function ensureBannerBucket() {
  const bucket = BANNER_BUCKET();
  const listRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const listText = await listRes.text();
  let list = [];
  try {
    list = listText ? JSON.parse(listText) : [];
  } catch {
    list = [];
  }
  if (!listRes.ok) {
    throw new Error(`读取 Storage 桶失败：${listText || listRes.status}`);
  }
  const exists = Array.isArray(list) && list.some((item) => item && (item.id === bucket || item.name === bucket));
  if (exists) return bucket;

  const createRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: 10485760,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    }),
  });
  const createText = await createRes.text();
  if (!createRes.ok && !/already exists|duplicate/i.test(createText)) {
    throw new Error(`创建 Storage 桶失败：${createText || createRes.status}`);
  }
  return bucket;
}
async function uploadBannerImage(dataUrl, filename = "banner") {
  const file = decodeDataUrl(dataUrl);
  if (!file) throw new Error("图片数据无效，请重新上传。");
  const bucket = await ensureBannerBucket();
  const ext = (file.contentType.split("/")[1] || "png").replace("jpeg", "jpg");
  const safeName = String(filename || "homepage-banner").replace(/[^a-z0-9.-]/gi, "-") || "homepage-banner";
  const objectPath = `homepage/${Date.now()}-${safeName}.${ext}`;
  const response = await fetch(storageObjectUrl(bucket, objectPath), {
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
  return publicStorageUrl(bucket, objectPath);
}
function mapBanner(row) {
  return {
    id: row.id,
    title: row.title || "",
    subtitle: row.subtitle || "",
    image_url: row.image_url || "",
    button_text: row.button_text || "",
    button_link: row.button_link || "",
    is_active: row.is_active === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
async function listBanners() {
  const rows = await supabaseJson(restUrl("banners", "?order=created_at.desc&limit=50"), { headers: serviceHeaders() });
  const banners = (Array.isArray(rows) ? rows : []).map(mapBanner);
  const current = banners.find((b) => b.is_active) || null;
  return { current, history: banners };
}
async function deactivateAll() {
  await supabaseJson(restUrl("banners", "?is_active=eq.true"), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
  });
}
async function activateBanner(id) {
  await deactivateAll();
  const rows = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ is_active: true, sort_order: 0, updated_at: new Date().toISOString() }),
  });
  return rows[0] || null;
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      current: null,
      history: [],
      message: "未配置 Supabase，Banner 管理不可用。",
    });
  }
  try {
    await requireAdmin(req);
    if (req.method === "GET") {
      const data = await listBanners();
      return json(res, 200, { ok: true, configured: true, ...data });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "");
    if (action === "publish") {
      const imageData = String(body.image_data || body.imageData || "");
      if (!imageData) return json(res, 400, { ok: false, message: "请先上传 Banner 图片。" });
      const imageUrl = await uploadBannerImage(imageData, body.filename || "homepage-banner");
      await deactivateAll();
      const now = new Date().toISOString();
      const rows = await supabaseJson(restUrl("banners"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          title: String(body.title || "").trim(),
          subtitle: String(body.subtitle || "").trim(),
          image_url: imageUrl,
          button_text: String(body.button_text || body.buttonText || "").trim(),
          button_link: String(body.button_link || body.buttonLink || body.link || "").trim(),
          is_active: true,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        }),
      });
      const banner = mapBanner(rows[0] || { image_url: imageUrl, is_active: true, created_at: now, updated_at: now });
      return json(res, 200, {
        ok: true,
        message: "Banner 发布成功",
        banner,
        homepage_url: imageUrl,
      });
    }
    if (action === "set_current") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const banner = await activateBanner(id);
      if (!banner) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      return json(res, 200, { ok: true, message: "Banner 发布成功", banner: mapBanner(banner) });
    }
    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const existing = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() });
      if (!existing[0]) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      const wasActive = existing[0].is_active === true;
      await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}`), { method: "DELETE", headers: serviceHeaders() });
      let data = await listBanners();
      if (wasActive && !data.current && data.history.length) {
        await activateBanner(data.history[0].id);
        data = await listBanners();
      }
      return json(res, 200, { ok: true, message: "Banner 已删除。", ...data });
    }
    return json(res, 400, { ok: false, message: "未知 Banner 操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "Banner 管理接口异常。" });
  }
}
