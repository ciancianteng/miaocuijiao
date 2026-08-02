import fs from "node:fs";
import path from "node:path";

const VALID_ROLES = new Set(["boss", "companion", "customer_service", "admin", "super_admin"]);
const TABLES = ["profiles", "companion_profiles", "orders", "conversations", "messages", "transactions", "banners", "announcements", "customer_service_reports"];

loadLocalEnv();

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}

function envStatus() {
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !envValue(key));
  return { configured: missing.length === 0, missing };
}

function json(res, status, data) {
  res.status(status).json(data);
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return false;
  const configured = String(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed =
    configured.includes(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin) ||
    /^https:\/\/[\w.-]+\.vercel\.app$/i.test(origin);
  if (!allowed) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, x-mcj-access-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  return true;
}

function headersWithServiceRole(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function authHeaders(extra = {}) {
  return {
    apikey: envValue("SUPABASE_ANON_KEY"),
    "Content-Type": "application/json",
    ...extra,
  };
}

function authUrl(route) {
  return `${envValue("SUPABASE_URL")}/auth/v1/${route}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function redirectFor(role) {
  const key = String(role || "").trim();
  if (key === "super_admin") return "/admin/";
  return {
    boss: "/index.html",
    companion: "/companion/dashboard/",
    customer_service: "/customer-service/dashboard/",
    admin: "/admin/",
  }[key] || "/index.html";
}

function metaBossUid(authUser = {}) {
  return String(authUser?.user_metadata?.boss_uid || authUser?.app_metadata?.boss_uid || "").trim();
}

function safeProfile(profile = {}, authUser = {}) {
  let role = String(profile.role || "").trim();
  const roleLower = role.toLowerCase();
  // Frontend historically used "customer" for the same boss account.
  if (roleLower === "customer" || roleLower === "owner" || roleLower === "user") role = "boss";
  const bossUid = String(profile.boss_uid || metaBossUid(authUser) || "").trim();
  return {
    id: profile.id || authUser.id || "",
    bossUid,
    boss_uid: bossUid,
    uid: bossUid || profile.id || authUser.id || "",
    role,
    displayName: profile.display_name || authUser.user_metadata?.display_name || authUser.email || "",
    email: profile.email || authUser.email || "",
    phone: profile.phone || authUser.phone || "",
    avatarUrl: profile.avatar_url || "",
    status: profile.status || "pending",
    createdAt: profile.created_at || authUser.created_at || "",
    lastSignInAt: authUser.last_sign_in_at || profile.last_sign_in_at || "",
  };
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

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = body?.error_description || body?.msg || body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return body;
}

async function profileFor(userId) {
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}&limit=1`), {
    headers: headersWithServiceRole(),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function allocateBossUid() {
  const rows = await supabaseJson(
    restUrl("profiles", "?role=eq.boss&select=boss_uid&boss_uid=not.is.null&order=created_at.desc&limit=200"),
    { headers: headersWithServiceRole() }
  ).catch(() => []);
  let next = 100001;
  for (const row of Array.isArray(rows) ? rows : []) {
    const match = String(row?.boss_uid || "").trim().match(/^B(\d+)$/i);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  // Also scan Auth metadata when profiles.boss_uid column is missing / empty.
  try {
    const authUsers = await supabaseJson(authUrl("admin/users?page=1&per_page=200"), {
      headers: headersWithServiceRole(),
    });
    const list = authUsers?.users || authUsers || [];
    for (const u of Array.isArray(list) ? list : []) {
      const match = metaBossUid(u).match(/^B(\d+)$/i);
      if (match) next = Math.max(next, Number(match[1]) + 1);
    }
  } catch {
    /* optional */
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `B${next + attempt}`;
    const existing = await supabaseJson(
      restUrl("profiles", `?boss_uid=eq.${encodeURIComponent(candidate)}&select=id&limit=1`),
      { headers: headersWithServiceRole() }
    ).catch(() => []);
    if (!Array.isArray(existing) || existing.length === 0) return candidate;
  }
  return `B${Date.now().toString().slice(-9)}`;
}

async function persistBossUidMeta(userId, bossUid, authUser = {}) {
  const prevMeta = authUser?.user_metadata && typeof authUser.user_metadata === "object" ? authUser.user_metadata : {};
  await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
    method: "PUT",
    headers: headersWithServiceRole(),
    body: JSON.stringify({ user_metadata: { ...prevMeta, boss_uid: bossUid } }),
  });
}

async function ensureBossUid(profile, authUser = null) {
  if (!profile?.id) return profile;
  const existing = String(profile.boss_uid || metaBossUid(authUser || {}) || "").trim();
  if (existing) {
    if (!profile.boss_uid) {
      try {
        const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
          method: "PATCH",
          headers: headersWithServiceRole({ Prefer: "return=representation" }),
          body: JSON.stringify({ boss_uid: existing }),
        });
        const saved = Array.isArray(rows) ? rows[0] : null;
        if (saved?.boss_uid) return saved;
      } catch {
        /* column may be missing — keep metadata UID */
      }
    }
    return { ...profile, boss_uid: existing };
  }
  let lastError = null;
  let columnMissing = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bossUid = await allocateBossUid();
    if (!bossUid) break;
    try {
      const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: headersWithServiceRole({ Prefer: "return=representation" }),
        body: JSON.stringify({ boss_uid: bossUid }),
      });
      const saved = Array.isArray(rows) ? rows[0] : { ...profile, boss_uid: bossUid };
      if (saved?.boss_uid) {
        try {
          await persistBossUidMeta(profile.id, saved.boss_uid, authUser || {});
        } catch {
          /* best-effort mirror */
        }
        return saved;
      }
    } catch (error) {
      lastError = error;
      const detail = String(error.message || "");
      if (/boss_uid|schema cache|Could not find/i.test(detail)) {
        columnMissing = true;
        try {
          await persistBossUidMeta(profile.id, bossUid, authUser || {});
          return { ...profile, boss_uid: bossUid };
        } catch (metaErr) {
          lastError = metaErr;
        }
        break;
      }
    }
  }
  if (columnMissing) {
    const fallback = `B${Date.now().toString().slice(-9)}`;
    try {
      await persistBossUidMeta(profile.id, fallback, authUser || {});
      return { ...profile, boss_uid: fallback };
    } catch {
      /* fall through */
    }
  }
  throw new Error(lastError?.message || "老板 UID 生成失败，请稍后重试。");
}

async function userFromToken(token) {
  return supabaseJson(authUrl("user"), {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    return json(res, 204, { ok: true });
  }

  const action = String(req.method === "GET" ? req.query.action || "health" : req.body?.action || "").trim();
  const env = envStatus();

  if (req.method === "GET" && action === "health") {
    return json(res, 200, { ok: true, configured: env.configured, missing: env.missing, tables: TABLES });
  }

  if (!env.configured) {
    return json(res, 503, {
      ok: false,
      configured: false,
      message: `未配置 ${env.missing.join(" / ")}，无法进行真实数据库登录。`,
      missing: env.missing,
    });
  }

  try {
    if (req.method === "GET" && action === "me") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      let profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
      if (["boss", "customer", "owner", "user"].includes(String(profile.role || "").trim().toLowerCase())) {
        try {
          profile = await ensureBossUid({ ...profile, role: "boss" }, authUser);
        } catch {
          /* keep session usable */
        }
      }
      const user = safeProfile(profile, authUser);
      if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
      if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
      let pendingForced = [];
      let forcedAckRequired = false;
      if (["boss", "customer", "owner", "user"].includes(String(user.role || "").toLowerCase())) {
        try {
          const acks = await import("./_content-acks.js");
          pendingForced = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
          forcedAckRequired = pendingForced.length > 0;
        } catch {
          /* optional */
        }
      }
      return json(res, 200, { ok: true, user, redirect: redirectFor(user.role), pendingForced, forcedAckRequired });
    }

    if (req.method === "GET" && action === "pending_forced") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      const pending = await (await import("./_content-acks.js")).pendingForcedForUser(profile.id, { audience: "boss" });
      return json(res, 200, { ok: true, pendingForced: pending, forcedAckRequired: pending.length > 0 });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const requestedAction = String(body.action || "login");
    if (requestedAction === "acknowledge_forced" || requestedAction === "ack_forced") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      const contentId = String(body.content_id || body.contentId || body.id || "").trim();
      const contentVersion = String(body.content_version || body.contentVersion || body.version || "1").trim() || "1";
      const contentType = String(body.content_type || body.contentType || "player_rules").trim() || "player_rules";
      if (!contentId) return json(res, 400, { ok: false, message: "缺少内容 ID" });
      const acks = await import("./_content-acks.js");
      const pending = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
      const match = pending.find((p) => String(p.id) === contentId);
      if (!match && contentType !== "announcement") {
        return json(res, 404, { ok: false, message: "强制内容不存在或已确认" });
      }
      const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
      const saved = await acks.acknowledgeContent({
        userId: profile.id,
        contentType: match?.contentType || contentType,
        contentId,
        contentVersion: contentVersion || match?.version || "1",
        effectiveAt: match?.publishedAt || "",
        contentUpdatedAt: match?.updatedAt || "",
        ip,
        userAgent: String(req.headers["user-agent"] || ""),
      });
      const still = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
      return json(res, 200, {
        ok: true,
        message: "已确认阅读",
        ack: saved,
        pendingForced: still,
        forcedAckRequired: still.length > 0,
      });
    }
    if (requestedAction === "update_profile") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (profile.status !== "active") return json(res, 403, { ok: false, message: "账号未启用。" });
      const patch = {};
      if (typeof body.displayName === "string") patch.display_name = body.displayName.trim().slice(0, 40);
      if (typeof body.phone === "string") patch.phone = body.phone.trim().slice(0, 30);
      if (typeof body.avatarUrl === "string") patch.avatar_url = body.avatarUrl.trim().slice(0, 500);
      if (typeof body.email === "string") {
        const nextEmail = body.email.trim().toLowerCase().slice(0, 120);
        if (nextEmail && nextEmail !== String(profile.email || authUser.email || "").toLowerCase()) {
          patch.email = nextEmail;
        }
      }
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, message: "没有可保存的资料。" });
      const savedRows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}`), {
        method: "PATCH",
        headers: headersWithServiceRole({ Prefer: "return=representation" }),
        body: JSON.stringify(patch),
      });
      const saved = Array.isArray(savedRows) ? savedRows[0] : { ...profile, ...patch };
      return json(res, 200, { ok: true, message: "资料已保存", user: safeProfile(saved, authUser), redirect: redirectFor(saved.role) });
    }
    if (requestedAction === "change_password") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (profile.status !== "active") return json(res, 403, { ok: false, message: "账号未启用。" });
      const currentPassword = String(body.currentPassword || body.oldPassword || "");
      const newPassword = String(body.newPassword || body.password || "");
      const confirmPassword = String(body.confirmPassword || "");
      if (!currentPassword || !newPassword) return json(res, 400, { ok: false, message: "请填写当前密码和新密码。" });
      if (confirmPassword && confirmPassword !== newPassword) return json(res, 400, { ok: false, message: "两次输入的新密码不一致。" });
      if (newPassword.length < 6) return json(res, 400, { ok: false, message: "新密码至少 6 位。" });
      const email = String(profile.email || authUser.email || "").trim().toLowerCase();
      if (!email) return json(res, 400, { ok: false, message: "账号缺少邮箱，无法验证当前密码。" });
      await supabaseJson(authUrl("token?grant_type=password"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password: currentPassword }),
      });
      await supabaseJson(authUrl("user"), {
        method: "PUT",
        headers: authHeaders({ Authorization: `Bearer ${token}` }),
        body: JSON.stringify({ password: newPassword }),
      });
      return json(res, 200, { ok: true, message: "密码已更新" });
    }
    if (requestedAction === "refresh") {
      const refreshToken = String(body.refreshToken || body.refresh_token || "").trim();
      if (!refreshToken) return json(res, 400, { ok: false, message: "缺少 refreshToken。" });
      const auth = await supabaseJson(authUrl("token?grant_type=refresh_token"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const authUser = auth.user || (auth.access_token ? await userFromToken(auth.access_token).catch(() => null) : null);
      const profile = authUser ? await profileFor(authUser.id) : null;
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
      const user = safeProfile(profile, authUser || {});
      if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
      if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
      return json(res, 200, {
        ok: true,
        session: {
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token || refreshToken,
          expiresAt: auth.expires_at,
          user,
        },
        redirect: redirectFor(user.role),
      });
    }
    if (requestedAction === "register") {
      const email = String(body.email || body.account || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || body.nickname || body.name || "").trim().slice(0, 40);
      const phone = String(body.phone || "").trim().slice(0, 30);
      if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" });
      if (password.length < 6) return json(res, 400, { ok: false, message: "密码至少 6 位。" });
      let created;
      try {
        created = await supabaseJson(authUrl("admin/users"), {
          method: "POST",
          headers: headersWithServiceRole(),
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { display_name: displayName || email.split("@")[0] || "老板" },
          }),
        });
      } catch (error) {
        let message = String(error.message || "").trim();
        if (/user already registered|already.*(registered|exists)|duplicate|unique/i.test(message)) {
          message = "该邮箱已注册，请直接登录。";
        }
        return json(res, 400, { ok: false, message: message || "注册失败，请检查邮箱是否已存在。" });
      }
      const userId = created?.id || created?.user?.id;
      if (!userId) return json(res, 500, { ok: false, message: "Auth 账号创建失败，未返回用户 ID。" });
      let profile;
      try {
        const baseProfile = {
          id: userId,
          role: "boss",
          display_name: displayName || email.split("@")[0] || "老板",
          email,
          phone,
          avatar_url: "",
          status: "active",
          created_at: new Date().toISOString(),
        };
        let bossUid = "";
        try {
          bossUid = await allocateBossUid();
        } catch {
          bossUid = "";
        }
        let rows;
        try {
          rows = await supabaseJson(restUrl("profiles"), {
            method: "POST",
            headers: headersWithServiceRole({ Prefer: "return=representation" }),
            body: JSON.stringify(bossUid ? { ...baseProfile, boss_uid: bossUid } : baseProfile),
          });
        } catch (insertError) {
          const detail = String(insertError.message || "");
          if (/boss_uid|schema cache/i.test(detail) && bossUid) {
            rows = await supabaseJson(restUrl("profiles"), {
              method: "POST",
              headers: headersWithServiceRole({ Prefer: "return=representation" }),
              body: JSON.stringify(baseProfile),
            });
          } else {
            throw insertError;
          }
        }
        profile = Array.isArray(rows) ? rows[0] : rows;
        try {
          profile = await ensureBossUid(profile, created?.user || created || { id: userId, user_metadata: { display_name: displayName } });
        } catch (uidError) {
          // Last resort: still register, but surface empty UID only if metadata also fails.
          const detail = String(uidError.message || "");
          if (!/boss_uid|schema cache|Could not find|Auth|metadata|user/i.test(detail)) throw uidError;
          profile = { ...(profile || baseProfile), boss_uid: profile?.boss_uid || "" };
        }
      } catch (error) {
        try {
          await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
            method: "DELETE",
            headers: headersWithServiceRole(),
          });
        } catch {
          /* best-effort rollback */
        }
        return json(res, 500, {
          ok: false,
          message: `老板资料创建失败：${error.message || "未知错误"}。Auth 账号已回滚，请重试。`,
        });
      }
      const auth = await supabaseJson(authUrl("token?grant_type=password"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password }),
      });
      const authUser = auth.user || { id: userId, email, user_metadata: { boss_uid: profile?.boss_uid } };
      const user = safeProfile(profile, authUser);
      const bossUidOut = user.bossUid || user.boss_uid || "";
      return json(res, 200, {
        ok: true,
        message: bossUidOut ? `注册成功。您的老板 UID：${bossUidOut}` : "注册成功。",
        bossUid: bossUidOut || undefined,
        session: {
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token,
          expiresAt: auth.expires_at,
          user,
        },
        redirect: redirectFor("boss"),
      });
    }
    if (requestedAction !== "login") return json(res, 400, { ok: false, message: "未知登录操作" });
    const email = String(body.email || body.account || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" });

    const auth = await supabaseJson(authUrl("token?grant_type=password"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const authUser = auth.user;
    let profile = await profileFor(authUser.id);
    if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
    if (["boss", "customer", "owner", "user"].includes(String(profile.role || "").trim().toLowerCase())) {
      try {
        profile = await ensureBossUid({ ...profile, role: "boss" }, authUser);
      } catch {
        /* keep login usable even if UID backfill fails */
      }
    }
    const user = safeProfile(profile, { ...authUser, user_metadata: { ...(authUser?.user_metadata || {}), boss_uid: profile.boss_uid || metaBossUid(authUser) } });
    if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
    if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });

    return json(res, 200, {
      ok: true,
      session: {
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        expiresAt: auth.expires_at,
        user,
      },
      redirect: redirectFor(user.role),
    });
  } catch (error) {
    const action = String((req.body && req.body.action) || req.query?.action || "");
    let message = String(error.message || "").trim();
    if (/failed to fetch|fetch failed|network|econnrefused|enotfound|timeout/i.test(message)) {
      message = "暂时无法连接服务器，请稍后重试";
    } else if (/invalid login credentials|invalid.*(email|password)|email not confirmed/i.test(message)) {
      message = "邮箱或密码错误。";
    }
    if (action === "change_password" || action === "update_profile") {
      const status = /密码|password|credentials|invalid|邮箱或密码/i.test(message) ? 400 : 401;
      return json(res, status, { ok: false, message: message || (action === "change_password" ? "修改密码失败。" : "保存资料失败。") });
    }
    const fallback = action === "refresh" ? "refreshToken 已失效，请重新登录。" : "邮箱或密码错误。";
    return json(res, 401, { ok: false, message: message || fallback });
  }
}


