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
function bannerItem(row) {
  return {
    id: row.id,
    title: row.title || "",
    name: row.title || "MEOW CUI JIAO Banner",
    subtitle: row.subtitle || "",
    image: row.image_url || "",
    desktopImage: row.image_url || "",
    mobileImage: row.mobile_image_url || row.image_url || "",
    buttonText: row.button_text || "",
    link: row.button_link || "",
    href: row.button_link || "",
    sort: row.sort_order || 100,
    enabled: row.is_active !== false,
    published: true,
    fitMode: "cover"
  };
}
function announcementItem(row) {
  return {
    id: row.id,
    title: row.title || "",
    content: row.content || "",
    text: row.content || row.title || "",
    sort: row.sort_order || 100,
    enabled: row.is_active !== false,
    published: true
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return json(res, 405, { ok: false, message: "Method Not Allowed" }); }
  if (!hasDatabaseConfig()) return json(res, 200, { ok: true, configured: false, items: [], byType: {}, message: "平台内容数据库未配置，首页不返回假 Banner 或公告。" });
  try {
    const raw = String(req.query.types || req.query.type || "banners,announcements");
    const types = raw.split(",").map(cleanType).filter(Boolean);
    const byType = {};
    if (!types.length || types.includes("banners")) byType.banners = (await rows("banners", "?is_active=eq.true&order=sort_order.asc,updated_at.desc&limit=20")).map(bannerItem);
    if (!types.length || types.includes("announcements")) byType.announcements = (await rows("announcements", "?is_active=eq.true&order=created_at.desc&limit=20")).map(announcementItem);
    const items = Object.keys(byType).flatMap((type) => byType[type].map((item) => ({ id: item.id, type, title: item.title, sort: item.sort, enabled: item.enabled, data: item })));
    return json(res, 200, { ok: true, configured: true, items, byType });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "平台内容接口异常" });
  }
}
