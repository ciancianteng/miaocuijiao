import {
  listWorkRules,
  ensureDefaultWorkRules,
  saveWorkRule,
  loadClubLevelGuide,
  saveClubLevelGuide,
} from "../_companion-work-rules.js";
import { listAckRecords, companionsNeedingAck, listActiveForcedAnnouncements } from "../_content-acks.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((k) => process.env[k]);
}
function rest(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}
function anonHeaders(extra = {}) {
  return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
}
async function sb(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw Object.assign(new Error(body?.message || `HTTP ${response.status}`), { status: response.status });
  return body;
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
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
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录后台"), { status: 401 });
  const user = await sb(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await sb(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权限"), { status: 403 });
  return profile;
}
async function profileMap(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await sb(
    rest("profiles", `?id=in.(${unique.map(encodeURIComponent).join(",")})&select=id,display_name,email,status,role`),
    { headers: serviceHeaders() }
  );
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((p) => {
    map[p.id] = p;
  });
  return map;
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, message: "未配置数据库" });
  try {
    const admin = await requireAdmin(req);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(req.query?.action || body.action || "bootstrap").trim();

    if (action === "bootstrap" || action === "summary") {
      const [guide, rules, forced, ackBundle] = await Promise.all([
        loadClubLevelGuide(),
        ensureDefaultWorkRules().catch(() => listWorkRules({ includeDisabled: true })),
        listActiveForcedAnnouncements({ audience: "companion" }),
        companionsNeedingAck().catch(() => ({ pendingPairs: [] })),
      ]);
      return json(res, 200, {
        ok: true,
        guide,
        workRules: rules,
        forcedAnnouncements: forced,
        pendingAckCount: (ackBundle.pendingPairs || []).length,
      });
    }

    if (action === "guide" || action === "get_guide") {
      return json(res, 200, { ok: true, guide: await loadClubLevelGuide() });
    }
    if (action === "save_guide") {
      const saved = await saveClubLevelGuide(body.guide || body.payload || body, admin.id);
      return json(res, 200, { ok: true, message: "等级说明页已保存", guide: saved.guide });
    }

    if (action === "work_rules" || action === "list_work_rules") {
      const rules = await ensureDefaultWorkRules().catch(() => listWorkRules({ includeDisabled: true }));
      return json(res, 200, { ok: true, rules });
    }
    if (action === "save_work_rule") {
      const saved = await saveWorkRule(body.rule || body.payload || body, admin.id);
      return json(res, 200, { ok: true, message: "陪玩规则已保存", rule: saved });
    }

    if (action === "ack_records" || action === "reading_records") {
      const status = String(req.query?.status || body.status || "").trim();
      const companionId = String(req.query?.companion_id || body.companion_id || "").trim();
      const filter = String(req.query?.filter || body.filter || "").trim();
      const rows = await listAckRecords({ status: filter === "acked" || filter === "unread" ? "" : status, companionId, limit: 300 });
      const bundle = await companionsNeedingAck();
      const profiles = await profileMap(rows.map((r) => r.user_id).concat(bundle.pendingPairs.map((p) => p.companionId)));
      const acked = rows
        .filter((r) => r.status === "acked" && !r.revoked)
        .map((r) => ({
          id: r.id,
          companionId: r.user_id,
          companionName: profiles[r.user_id]?.display_name || profiles[r.user_id]?.email || r.user_id,
          companionActive: profiles[r.user_id]?.status === "active",
          contentType: r.content_type,
          contentId: r.content_id,
          contentVersion: r.content_version,
          status: r.expired ? "expired" : r.revoked ? "revoked" : "acked",
          statusText: r.expired ? "版本过期" : r.revoked ? "已撤销" : "已阅读",
          acknowledgedAt: r.acknowledged_at || "",
          needsReconfirm: false,
          ip: r.ip || "",
        }));
      let unread = bundle.pendingPairs.map((p) => ({
        id: `pending:${p.companionId}:${p.contentId}:${p.contentVersion}`,
        companionId: p.companionId,
        companionName: p.companionName,
        companionActive: p.companionStatus === "active",
        contentType: "announcement",
        contentId: p.contentId,
        contentTitle: p.contentTitle,
        contentVersion: p.contentVersion,
        status: "unread",
        statusText: "未阅读",
        acknowledgedAt: "",
        needsReconfirm: true,
        ip: "",
      }));
      if (filter === "acked") unread = [];
      if (filter === "unread") return json(res, 200, { ok: true, records: unread });
      if (filter === "expired") return json(res, 200, { ok: true, records: acked.filter((r) => r.status === "expired") });
      if (filter === "inactive") {
        return json(res, 200, {
          ok: true,
          records: acked.concat(unread).filter((r) => r.companionActive === false),
        });
      }
      return json(res, 200, { ok: true, records: [...unread, ...acked] });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "制度与等级接口异常" });
  }
}
