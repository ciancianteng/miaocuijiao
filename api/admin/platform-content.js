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
      const items = await supabaseFetch(query);
      return json(res, 200, { ok: true, configured: true, items });
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
        if (item.type === "banners" && item.enabled !== false) {
          item.status = "published";
          item.published = item.draft || {};
          item.version = 1;
          item.published_by = role;
          item.published_at = new Date().toISOString();
        }
        const rows = await supabaseFetch("", { method: "POST", body: JSON.stringify(item) });
        await writeLog(req, item.type === "banners" ? "create_publish" : "create", item.type, rows?.[0]?.id, null, rows?.[0] || item);
        return json(res, 200, { ok: true, message: item.type === "banners" ? "已保存并同步到前台" : "已保存", item: rows?.[0] || item });
      }

      if (!id) return json(res, 400, { ok: false, message: "缺少内容 ID" });
      const before = await getItem(id);
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
        if (before.type === "banners" && item.enabled !== false) {
          item.status = "published";
          item.published = item.draft || {};
          item.version = Number(before.version || 0) + 1;
          item.published_by = role;
          item.published_at = new Date().toISOString();
        }
        const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(item) });
        await writeLog(req, before.type === "banners" ? "save_publish" : "save_draft", before.type, id, before, rows?.[0] || item);
        return json(res, 200, { ok: true, message: before.type === "banners" ? "已保存并同步到前台" : "已保存", item: rows?.[0] || item });
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
        await writeLog(req, "publish", before.type, id, before, rows?.[0] || next);
        return json(res, 200, { ok: true, message: "已发布并同步到前台", item: rows?.[0] || next });
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

