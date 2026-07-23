const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_CONTENT_BUCKET"];
const ADMIN_ROLES = new Set(["super_admin", "admin", "content_admin"]);

function roleFromRequest(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-mcj-role"] || "").trim();
}

function hasStorageConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function json(res, status, data) {
  res.status(status).json(data);
}

function safeName(name) {
  return String(name || "upload.bin").replace(/[^a-z0-9._-]/gi, "-").slice(-90);
}

export default async function handler(req, res) {
  const role = roleFromRequest(req);
  if (!ADMIN_ROLES.has(role)) return json(res, 403, { ok: false, message: "没有上传权限" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasStorageConfig()) {
    return json(res, 503, {
      ok: false,
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_CONTENT_BUCKET，文件没有保存到本地或 localStorage"
    });
  }

  try {
    const body = req.body || {};
    const mimeType = String(body.mimeType || "application/octet-stream");
    const base64 = String(body.base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!base64) return json(res, 400, { ok: false, message: "缺少文件内容" });
    const buffer = Buffer.from(base64, "base64");
    const limit = 8 * 1024 * 1024;
    if (buffer.length > limit) return json(res, 400, { ok: false, message: "文件不能超过 8MB" });
    if (!/^(image\/|audio\/|application\/pdf)/.test(mimeType)) {
      return json(res, 400, { ok: false, message: "仅支持图片、音频和 PDF 附件" });
    }

    const bucket = process.env.SUPABASE_CONTENT_BUCKET;
    const type = String(body.type || "platform-content").replace(/[^a-z0-9_-]/gi, "");
    const path = `${type}/${Date.now()}-${safeName(body.fileName)}`;
    const upload = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": mimeType,
        "x-upsert": "false"
      },
      body: buffer
    });
    const text = await upload.text();
    if (!upload.ok) {
      let detail = text;
      try { detail = JSON.parse(text).message || detail; } catch {}
      throw new Error(detail || "上传失败");
    }
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
    return json(res, 200, { ok: true, url: publicUrl, path, mimeType, size: buffer.length });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "上传接口异常" });
  }
}
