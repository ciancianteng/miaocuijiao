/**
 * Web Push (VAPID) helpers.
 * Private key stays in server env only. Recipients always resolved by user_id.
 */
import crypto from "node:crypto";

const TABLE = "push_subscriptions";

function env(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null || raw === "") return String(fallback || "");
  return String(raw).trim().replace(/^["']|["']$/g, "");
}

function hasDb() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

function serviceHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
  if (key && !key.startsWith("sb_secret_")) {
    base.Authorization = "Bearer " + key;
  }
  return base;
}

function restUrl(table, query) {
  return env("SUPABASE_URL") + "/rest/v1/" + table + (query || "");
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
      (body && (body.message || body.hint || body.details)) ||
      (typeof body === "string" ? body : "") ||
      response.status + " " + response.statusText;
    const err = new Error(msg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function nowIso() {
  return new Date().toISOString();
}

export function hashEndpoint(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint || "")).digest("hex");
}

export function getVapidPublicKey() {
  return env("VAPID_PUBLIC_KEY") || env("WEB_PUSH_VAPID_PUBLIC_KEY") || "";
}

function getVapidPrivateKey() {
  return env("VAPID_PRIVATE_KEY") || env("WEB_PUSH_VAPID_PRIVATE_KEY") || "";
}

function getVapidSubject() {
  return (
    env("VAPID_SUBJECT") ||
    env("WEB_PUSH_VAPID_SUBJECT") ||
    "mailto:security@meowcuijiao.com"
  );
}

export function isWebPushConfigured() {
  return !!(getVapidPublicKey() && getVapidPrivateKey());
}

let webPushMod = null;
async function loadWebPush() {
  if (webPushMod) return webPushMod;
  const mod = await import("web-push");
  webPushMod = mod.default || mod;
  const pub = getVapidPublicKey();
  const priv = getVapidPrivateKey();
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webPushMod.setVapidDetails(getVapidSubject(), pub, priv);
  return webPushMod;
}

function sanitizeUa(ua) {
  return String(ua || "").replace(/[\r\n]+/g, " ").slice(0, 240);
}

function deviceLabelFromUa(ua) {
  const s = String(ua || "");
  if (/iPhone|iPad|iPod/i.test(s)) return "iOS";
  if (/Android/i.test(s)) return "Android";
  if (/Windows/i.test(s)) return "Windows";
  if (/Mac OS|Macintosh/i.test(s)) return "macOS";
  if (/Linux/i.test(s)) return "Linux";
  return "Browser";
}

export async function upsertPushSubscription(input) {
  const opts = input || {};
  if (!hasDb()) throw Object.assign(new Error("数据库未配置"), { status: 503 });
  const uid = String(opts.userId || "").trim();
  const ep = String(opts.endpoint || "").trim();
  const key = String(opts.p256dh || "").trim();
  const authSecret = String(opts.auth || "").trim();
  if (!uid) throw Object.assign(new Error("缺少 user_id"), { status: 400 });
  if (!ep || !/^https:\/\//i.test(ep)) {
    throw Object.assign(new Error("无效的 push endpoint"), { status: 400 });
  }
  if (!key || !authSecret) {
    throw Object.assign(new Error("缺少 subscription keys"), { status: 400 });
  }

  const row = {
    user_id: uid,
    role: String(opts.role || "boss").trim().toLowerCase() || "boss",
    endpoint: ep,
    endpoint_hash: hashEndpoint(ep),
    p256dh: key,
    auth: authSecret,
    user_agent: sanitizeUa(opts.userAgent || ""),
    device_label: deviceLabelFromUa(opts.userAgent || ""),
    status: String(opts.status || "active"),
    updated_at: nowIso(),
    last_seen_at: nowIso(),
  };

  const saved = await supabaseJson(restUrl(TABLE, "?on_conflict=endpoint_hash"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(row),
  });
  return Array.isArray(saved) ? saved[0] : saved;
}

export async function disablePushSubscription(input) {
  const opts = input || {};
  if (!hasDb()) return false;
  const uid = String(opts.userId || "").trim();
  const ep = String(opts.endpoint || "").trim();
  if (!uid || !ep) return false;
  const hash = hashEndpoint(ep);
  await supabaseJson(
    restUrl(
      TABLE,
      "?user_id=eq." + encodeURIComponent(uid) + "&endpoint_hash=eq." + encodeURIComponent(hash)
    ),
    {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        status: "disabled",
        updated_at: nowIso(),
        last_error: String(opts.reason || "unsubscribed").slice(0, 200),
        last_error_at: nowIso(),
      }),
    }
  ).catch(function () {
    return null;
  });
  return true;
}

export async function listActiveSubscriptionsForUser(userId) {
  if (!hasDb()) return [];
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const query =
    "?user_id=eq." +
    encodeURIComponent(uid) +
    "&status=eq.active&select=id,user_id,role,endpoint,endpoint_hash,p256dh,auth,device_label,user_agent,updated_at,last_seen_at&limit=50";
  const rows = await supabaseJson(restUrl(TABLE, query), {
    headers: serviceHeaders(),
  }).catch(function (err) {
    if (/does not exist|schema cache|push_subscriptions/i.test(String(err && err.message ? err.message : ""))) {
      return [];
    }
    throw err;
  });
  return Array.isArray(rows) ? rows : [];
}

export async function getPushStatusForUser(userId, currentEndpoint) {
  const rows = await listActiveSubscriptionsForUser(userId);
  const ep = String(currentEndpoint || "").trim();
  const currentHash = ep ? hashEndpoint(ep) : "";
  const current = currentHash ? rows.find(function (r) {
    return r.endpoint_hash === currentHash;
  }) : null;
  return {
    configured: isWebPushConfigured(),
    activeCount: rows.length,
    devices: rows.map(function (r) {
      return {
        id: r.id,
        role: r.role,
        deviceLabel: r.device_label || "Browser",
        lastSeenAt: r.last_seen_at || r.updated_at || "",
        isCurrent: currentHash ? r.endpoint_hash === currentHash : false,
      };
    }),
    currentActive: !!current,
  };
}

function buildPayload(input) {
  const opts = input || {};
  return {
    title: String(opts.title || "妙脆角").slice(0, 80),
    body: String(opts.body || "").slice(0, 180),
    icon: opts.icon || "/icons/icon-192.png",
    badge: opts.badge || "/icons/icon-192.png",
    url: String(opts.url || "/").slice(0, 500),
    notification_type: String(opts.notificationType || "system").slice(0, 64),
    entity_id: String(opts.entityId || "").slice(0, 120),
    tag: String(opts.tag || opts.notificationType || "mcj").slice(0, 80),
  };
}

async function markSuccess(id) {
  if (!id) return;
  await supabaseJson(restUrl(TABLE, "?id=eq." + encodeURIComponent(id)), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      last_success_at: nowIso(),
      last_seen_at: nowIso(),
      updated_at: nowIso(),
      last_error: "",
    }),
  }).catch(function () {
    return null;
  });
}

async function markFailure(row, statusCode, message) {
  const gone = statusCode === 404 || statusCode === 410;
  await supabaseJson(restUrl(TABLE, "?id=eq." + encodeURIComponent(row.id)), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      status: gone ? "expired" : row.status || "active",
      last_error_at: nowIso(),
      last_error: String(message || statusCode || "push failed").slice(0, 200),
      updated_at: nowIso(),
    }),
  }).catch(function () {
    return null;
  });
}

export async function sendWebPushToUser(userId, payloadInput) {
  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, sent: 0, failed: 0, skipped: "missing_user" };
  if (!isWebPushConfigured()) {
    return { ok: false, sent: 0, failed: 0, skipped: "vapid_unconfigured" };
  }

  const rows = await listActiveSubscriptionsForUser(uid);
  if (!rows.length) return { ok: true, sent: 0, failed: 0, skipped: "no_subscriptions" };

  let webPush;
  try {
    webPush = await loadWebPush();
  } catch (err) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      skipped: String(err && err.message ? err.message : "webpush_load_failed"),
    };
  }

  const payload = buildPayload(payloadInput || {});
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async function (row) {
      try {
        await webPush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" }
        );
        sent += 1;
        await markSuccess(row.id);
      } catch (err) {
        failed += 1;
        const statusCode = Number(err && (err.statusCode || err.status) ? err.statusCode || err.status : 0);
        console.warn(
          "[web-push] send failed",
          JSON.stringify({
            userId: uid,
            status: statusCode || null,
            device: row.device_label || "",
            message: String(err && err.message ? err.message : "error").slice(0, 120),
          })
        );
        await markFailure(row, statusCode, (err && err.message) || "send failed");
      }
    })
  );

  return { ok: failed === 0, sent: sent, failed: failed };
}

export function fanoutWebPush(userId, payload) {
  Promise.resolve()
    .then(function () {
      return sendWebPushToUser(userId, payload);
    })
    .catch(function (err) {
      console.warn("[web-push] fanout error", String(err && err.message ? err.message : err).slice(0, 120));
    });
}
