/**
 * /api/push — authenticated Web Push subscription management.
 * Actions: vapidPublicKey | status | subscribe | unsubscribe | deny
 */
import {
  disablePushSubscription,
  getPushStatusForUser,
  getVapidPublicKey,
  isWebPushConfigured,
  upsertPushSubscription,
} from "./_web-push.js";
import { publicRolesPayload, resolveRoles } from "./_account-roles.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") {
    return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  }
  return process.env[key] || "";
}

function hasDb() {
  return REQUIRED_ENV.every(function (key) {
    return !!envValue(key);
  });
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function anonHeaders(extra) {
  return Object.assign(
    { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json" },
    extra || {}
  );
}

function serviceHeaders(extra) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = Object.assign(
    {
      apikey: key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    extra || {}
  );
  if (key && !key.startsWith("sb_secret_")) {
    base.Authorization = "Bearer " + key;
  }
  return base;
}

function authUrl(route) {
  return envValue("SUPABASE_URL") + "/auth/v1/" + route;
}

function restUrl(table, query) {
  return envValue("SUPABASE_URL") + "/rest/v1/" + table + (query || "");
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function supabaseJson(url, init) {
  const response = await fetch(url, init || {});
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg =
      (body && (body.error_description || body.message || body.hint || body.details)) ||
      (typeof body === "string" ? body : "") ||
      response.status + " " + response.statusText;
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }
  return body;
}

function isAuthTokenFailure(message, status) {
  const text = String(message || "").toLowerCase();
  if (Number(status) === 401) return true;
  return /jwt|expired|invalid claim|invalid token|not authenticated|403 forbidden/.test(text);
}

async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录。"), { status: 401 });
  let authUser;
  try {
    authUser = await supabaseJson(authUrl("user"), {
      headers: anonHeaders({ Authorization: "Bearer " + token }),
    });
  } catch (error) {
    const message = String((error && error.message) || error || "");
    if (isAuthTokenFailure(message, error && error.status)) {
      throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401 });
    }
    throw Object.assign(new Error(message || "登录校验失败。"), { status: 401 });
  }
  if (!authUser || !authUser.id) {
    throw Object.assign(new Error("登录已过期，请重新登录。"), { status: 401 });
  }
  const rows = await supabaseJson(
    restUrl("profiles", "?id=eq." + encodeURIComponent(authUser.id) + "&limit=1"),
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403 });
  if (profile.status && profile.status !== "active") {
    throw Object.assign(new Error("账号未启用。"), { status: 403 });
  }
  return { profile: profile, authUser: authUser };
}

function pickRole(profile, authUser, requested) {
  const roles = resolveRoles(profile, { authUser: authUser }).map(function (r) {
    return String(r || "").toLowerCase();
  });
  const payload = publicRolesPayload(profile, { authUser: authUser });
  const primary = String((payload && payload.primaryRole) || profile.role || "").toLowerCase();
  const reqRole = String(requested || "").trim().toLowerCase();
  const allowed = new Set(
    roles.concat([primary]).filter(function (r) {
      return /^(boss|companion|customer_service|cs|admin|super_admin|player|pw)$/.test(r);
    })
  );
  if (reqRole && allowed.has(reqRole)) {
    if (reqRole === "player" || reqRole === "pw") return "companion";
    if (reqRole === "cs") return "customer_service";
    return reqRole;
  }
  if (allowed.has("companion") || allowed.has("player") || allowed.has("pw")) return "companion";
  if (allowed.has("customer_service") || allowed.has("cs")) return "customer_service";
  if (allowed.has("admin") || allowed.has("super_admin")) return "admin";
  return "boss";
}

function readSubscription(body) {
  const src = body || {};
  const sub = src.subscription || src.pushSubscription || src;
  const endpoint = String(sub.endpoint || src.endpoint || "").trim();
  const keys = sub.keys || src.keys || {};
  const p256dh = String(keys.p256dh || src.p256dh || "").trim();
  const auth = String(keys.auth || src.auth || "").trim();
  return { endpoint: endpoint, p256dh: p256dh, auth: auth };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, { ok: false, configured: false, message: "服务暂不可用" });
  }

  try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(
      (req.method === "GET" ? req.query && req.query.action : body.action) ||
        (req.method === "GET" ? "status" : "")
    ).trim();

    if (action === "vapidPublicKey" || action === "vapid_public_key") {
      return json(res, 200, {
        ok: true,
        configured: isWebPushConfigured(),
        publicKey: getVapidPublicKey(),
      });
    }

    const auth = await profileFromToken(req);
    const profile = auth.profile;
    const authUser = auth.authUser;
    const userId = profile.id;

    if (req.method === "GET" && (action === "status" || action === "list" || !action)) {
      const endpoint = String((req.query && req.query.endpoint) || "").trim();
      const status = await getPushStatusForUser(userId, endpoint);
      return json(res, 200, Object.assign({ ok: true, userId: userId }, status));
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    if (action === "subscribe") {
      if (!isWebPushConfigured()) {
        return json(res, 503, {
          ok: false,
          message: "Web Push 尚未配置 VAPID，请联系管理员。",
        });
      }
      const foreign = String(body.target_user_id || body.targetUserId || body.user_id || "").trim();
      if (foreign && foreign !== userId) {
        return json(res, 403, { ok: false, message: "禁止为其他用户绑定推送订阅。" });
      }
      const sub = readSubscription(body);
      const role = pickRole(profile, authUser, body.role);
      const saved = await upsertPushSubscription({
        userId: userId,
        role: role,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        userAgent: String(req.headers["user-agent"] || ""),
        status: "active",
      });
      return json(res, 200, {
        ok: true,
        message: "已开启通知",
        subscriptionId: (saved && saved.id) || null,
        role: role,
      });
    }

    if (action === "unsubscribe") {
      const sub = readSubscription(body);
      if (!sub.endpoint) return json(res, 400, { ok: false, message: "缺少 endpoint" });
      await disablePushSubscription({
        userId: userId,
        endpoint: sub.endpoint,
        reason: "user_unsubscribe",
      });
      return json(res, 200, { ok: true, message: "已关闭本机通知" });
    }

    if (action === "deny") {
      const sub = readSubscription(body);
      if (sub.endpoint && sub.p256dh && sub.auth) {
        await upsertPushSubscription({
          userId: userId,
          role: pickRole(profile, authUser, body.role),
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          userAgent: String(req.headers["user-agent"] || ""),
          status: "denied",
        });
      }
      return json(res, 200, { ok: true, message: "已记录拒绝状态" });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "推送设置暂时无法处理",
    });
  }
}
