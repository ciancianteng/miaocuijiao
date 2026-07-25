const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "platform_content_items";

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function json(res, status, data) {
  res.status(status).json(data);
}

function cleanType(type) {
  return String(type || "").replace(/[^a-z0-9_:-]/gi, "");
}

function isPublished(status) {
  const text = String(status || "").toLowerCase();
  return text === "published" || text.includes("已发布") || text.includes("publish");
}

async function readContent(types) {
  const typeFilter = types.length ? `&type=in.(${types.map(encodeURIComponent).join(",")})` : "";
  const url = `${process.env.SUPABASE_URL}/rest/v1/${TABLE}?enabled=eq.true${typeFilter}&order=type.asc,sort.asc,published_at.desc`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || "读取平台内容失败");
  return Array.isArray(body) ? body.filter((row) => isPublished(row.status)) : [];
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDatabaseConfig()) {
    return json(res, 200, {
      ok: true,
      configured: false,
      items: [],
      byType: {},
      message: "平台内容数据库未配置，前台不会读取浏览器本地假数据。"
    });
  }

  try {
    const raw = String(req.query.types || req.query.type || "");
    const types = raw.split(",").map(cleanType).filter(Boolean);
    const rows = await readContent(types);
    const items = rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      slug: row.slug,
      sort: row.sort,
      enabled: row.enabled !== false,
      version: row.version,
      publishedAt: row.published_at,
      data: row.published || row.draft || {}
    }));
    const byType = items.reduce((acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push({
        id: item.id,
        title: item.title,
        sort: item.sort,
        enabled: item.enabled,
        published: true,
        ...(item.data || {}),
        _version: item.version,
        _publishedAt: item.publishedAt
      });
      return acc;
    }, {});
    return json(res, 200, { ok: true, configured: true, items, byType });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "平台内容接口异常" });
  }
}
