/**
 * POST /api/chat-media
 * { action: "upload", data_url|dataUrl, filename? }
 */
import { uploadChatImageDataUrl } from "./_chat-media.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

function bearer(req) {
  const h = String(req.headers.authorization || req.headers.Authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return String(
    req.headers["x-mcj-access-token"] ||
      req.headers["x-mcj-service-token"] ||
      req.headers["x-mcj-companion-token"] ||
      ""
  ).trim();
}

async function resolveUser(token) {
  if (!token) return null;
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !anon) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) return null;
  return body;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const body = parseBody(req);
    const action = String(body.action || "upload").trim();
    if (action !== "upload") {
      return json(res, 400, { ok: false, message: "未知操作" });
    }
    const token = bearer(req);
    const user = await resolveUser(token);
    if (!user) return json(res, 401, { ok: false, message: "请先登录后再上传图片" });

    const dataUrl = body.data_url || body.dataUrl || body.image || "";
    if (!dataUrl || !String(dataUrl).startsWith("data:image/")) {
      return json(res, 400, { ok: false, message: "请选择图片文件" });
    }
    if (String(dataUrl).length > 14 * 1024 * 1024) {
      return json(res, 413, { ok: false, message: "图片过大，请压缩后重试（最大 10MB）" });
    }

    const uploaded = await uploadChatImageDataUrl({
      userId: user.id,
      dataUrl,
      filename: body.filename || body.name || "chat.jpg",
    });
    return json(res, 200, {
      ok: true,
      message: "上传成功",
      url: uploaded.url,
      path: uploaded.path,
      bucket: uploaded.bucket,
    });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "图片上传失败" });
  }
}
