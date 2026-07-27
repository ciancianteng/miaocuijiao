import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

loadLocalEnv();

function loadLocalEnv() {
  const apiDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(apiDir, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}
function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}
function hasDb() { return REQUIRED_ENV.every((key) => envValue(key)); }
function json(res, status, data) { res.status(status).json(data); }
function anonHeaders(extra = {}) { return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra }; }
function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", Prefer: "return=representation", "User-Agent": "MCJ-Server/1.0", ...extra };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}
function authUrl(route) { return `${envValue("SUPABASE_URL")}/auth/v1/${route}`; }
function restUrl(table, query = "") { return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`; }
function nowIso() { return new Date().toISOString(); }
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(body?.error_description || body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || `${response.status} ${response.statusText}`);
  }
  return body;
}
function tokenFrom(req) { return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim(); }
async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号。"), { status: 401 });
  const authUser = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("账号未启用。"), { status: 403 });
  if (profile.role !== "boss") throw Object.assign(new Error("只有老板账号可以使用老板端在线客服。"), { status: 403 });
  return profile;
}
async function getOrCreateConversation(profile, orderId = "") {
  const query = orderId
    ? `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=eq.${encodeURIComponent(orderId)}&limit=1`
    : `?boss_id=eq.${encodeURIComponent(profile.id)}&order_id=is.null&limit=1`;
  const existing = await supabaseJson(restUrl("conversations", query), { headers: serviceHeaders() });
  if (existing?.[0]) return existing[0];
  const rows = await supabaseJson(restUrl("conversations"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ boss_id: profile.id, order_id: orderId || null, status: "waiting_service", created_at: nowIso(), updated_at: nowIso() })
  });
  return rows?.[0];
}
async function loadMessages(conversationId) {
  const rows = await supabaseJson(restUrl("messages", `?conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=200`), { headers: serviceHeaders() });
  return Array.isArray(rows) ? rows : [];
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, configured: false, message: "未配置 Supabase，在线客服不能保存真实聊天。" });
  try {
    const profile = await profileFromToken(req);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const orderId = String(req.method === "GET" ? req.query.order_id || "" : body.order_id || "");
    const conversation = await getOrCreateConversation(profile, orderId);
    if (req.method === "GET") {
      return json(res, 200, { ok: true, conversation, messages: await loadMessages(conversation.id), serviceStatus: conversation.customer_service_id ? "客服已接入" : "正在等待客服接入" });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const content = String(body.content || "").trim();
    if (!content) return json(res, 400, { ok: false, message: "请输入消息内容。" });
    const rows = await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ conversation_id: conversation.id, sender_id: profile.id, sender_role: "boss", message_type: "text", content, order_id: orderId || null, created_at: nowIso() })
    });
    await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversation.id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ updated_at: nowIso() }) });
    return json(res, 200, { ok: true, message: "消息已发送", row: rows?.[0] || null });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "在线客服接口异常" });
  }
}
