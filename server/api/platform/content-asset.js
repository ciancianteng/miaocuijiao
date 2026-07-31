const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "platform_content_items";

function json(res, status, data) {
  res.status(status).json(data);
}

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDatabaseConfig()) return json(res, 503, { ok: false, message: "数据库未配置" });
  const id = String(req.query.id || "").trim();
  if (!id) return json(res, 400, { ok: false, message: "缺少资源 ID" });

  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&type=eq.content_assets&enabled=eq.true&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(rows?.message || "读取资源失败");
    const row = Array.isArray(rows) ? rows[0] : null;
    const asset = row && (row.published || row.draft || {});
    const parsed = parseDataUrl(asset && asset.dataUrl);
    if (!parsed) return json(res, 404, { ok: false, message: "资源不存在" });
    res.setHeader("Content-Type", parsed.mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(parsed.buffer);
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "资源接口异常" });
  }
}
