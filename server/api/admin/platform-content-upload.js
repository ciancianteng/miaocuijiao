const DB_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "platform_content_items";
const ADMIN_ROLES = new Set(["super_admin", "admin", "content_admin"]);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function json(res, status, data) {
  res.status(status).json(data);
}

function roleFromRequest(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-mcj-role"] || "").trim();
}

function hasDatabaseConfig() {
  return DB_ENV.every((key) => process.env[key]);
}

function headers(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra
  };
}

function endpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${TABLE}${path}`;
}

function safeName(name) {
  return String(name || "upload.bin").replace(/[^a-z0-9._-]/gi, "-").slice(-90) || "upload.bin";
}

function sanitizeType(type) {
  return String(type || "platform-content").replace(/[^a-z0-9_-]/gi, "");
}

function parseUpload(body) {
  const raw = String(body.base64 || "");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = String(body.mimeType || (match && match[1]) || "application/octet-stream");
  const base64 = match ? match[2] : raw;
  if (!base64) return null;
  return { mimeType, base64, buffer: Buffer.from(base64, "base64") };
}

async function supabaseFetch(path, init = {}) {
  const response = await fetch(endpoint(path), { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(body?.message || body?.hint || body?.details || "数据库请求失败");
  }
  return body;
}

async function uploadToStorage({ type, fileName, mimeType, buffer }) {
  const bucket = process.env.SUPABASE_CONTENT_BUCKET;
  if (!bucket) return null;
  const path = `${type}/${Date.now()}-${safeName(fileName)}`;
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": mimeType,
      "x-upsert": "false"
    },
    body: buffer
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try { detail = JSON.parse(text).message || detail; } catch {}
    throw new Error(detail || "上传到存储桶失败");
  }
  return {
    url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
    path,
    storage: "supabase_storage"
  };
}

async function uploadToDatabaseAsset({ type, fileName, mimeType, base64, size }) {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const payload = {
    type: "content_assets",
    slug: `asset-${Date.now()}-${safeName(fileName)}`,
    title: safeName(fileName),
    status: "published",
    enabled: true,
    sort: 100,
    draft: { type, fileName: safeName(fileName), mimeType, size, dataUrl, storage: "database" },
    published: { type, fileName: safeName(fileName), mimeType, size, dataUrl, storage: "database" },
    version: 1,
    created_by: roleFromRequest({ headers: {} }) || "super_admin",
    created_at: new Date().toISOString(),
    updated_by: "super_admin",
    updated_at: new Date().toISOString(),
    published_by: "super_admin",
    published_at: new Date().toISOString()
  };
  const rows = await supabaseFetch("", { method: "POST", body: JSON.stringify(payload) });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    url: `/api/platform/content-asset?id=${encodeURIComponent(row.id)}`,
    path: String(row.id),
    storage: "database_asset"
  };
}

export default async function handler(req, res) {
  try {
    await (await import("../_admin-auth.js")).requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有上传权限" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDatabaseConfig()) {
    return json(res, 503, {
      ok: false,
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，Banner 文件不能保存到数据库或存储桶。"
    });
  }

  try {
    const body = req.body || {};
    const parsed = parseUpload(body);
    if (!parsed) return json(res, 400, { ok: false, message: "缺少文件内容" });
    if (!/^(image\/|audio\/|application\/pdf)/.test(parsed.mimeType)) {
      return json(res, 400, { ok: false, message: "仅支持图片、音频和 PDF 附件" });
    }
    if (parsed.buffer.length > MAX_UPLOAD_BYTES) {
      return json(res, 413, { ok: false, message: "文件不能超过 4MB" });
    }

    const type = sanitizeType(body.type || "banners");
    const stored = await uploadToStorage({ type, fileName: body.fileName, mimeType: parsed.mimeType, buffer: parsed.buffer })
      || await uploadToDatabaseAsset({ type, fileName: body.fileName, mimeType: parsed.mimeType, base64: parsed.base64, size: parsed.buffer.length });

    return json(res, 200, { ok: true, url: stored.url, path: stored.path, storage: stored.storage, mimeType: parsed.mimeType, size: parsed.buffer.length });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "上传接口异常" });
  }
}
