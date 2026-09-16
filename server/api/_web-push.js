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

  const nextStatus = String(opts.status || "active").trim() || "active";
  const row = {
    user_id: uid,
    role: String(opts.role || "boss").trim().toLowerCase() || "boss",
    endpoint: ep,
    endpoint_hash: hashEndpoint(ep),
    p256dh: key,
    auth: authSecret,
    user_agent: sanitizeUa(opts.userAgent || ""),
    device_label: deviceLabelFromUa(opts.userAgent || ""),
    status: nextStatus,
    updated_at: nowIso(),
    last_seen_at: nowIso(),
  };
  // Re-enable must clear prior user_unsubscribe / disabled markers.
  if (nextStatus === "active") {
    row.last_error = "";
    row.last_error_at = null;
  }

  const saved = await supabaseJson(restUrl(TABLE, "?on_conflict=user_id,role,endpoint_hash"), {
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
  const role = String(opts.role || "").trim().toLowerCase();
  if (!uid || !ep) return false;
  const hash = hashEndpoint(ep);
  const roleFilter = role ? "&role=eq." + encodeURIComponent(role) : "";
  await supabaseJson(
    restUrl(
      TABLE,
      "?user_id=eq." +
        encodeURIComponent(uid) +
        roleFilter +
        "&endpoint_hash=eq." +
        encodeURIComponent(hash)
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
  const other = await supabaseJson(
    restUrl(
      TABLE,
      "?endpoint_hash=eq." +
        encodeURIComponent(hash) +
        "&status=eq.active&select=id&limit=1"
    ),
    { headers: serviceHeaders() }
  ).catch(function () {
    return [];
  });
  return {
    disabled: true,
    hasOtherActiveBindings: Array.isArray(other) && other.length > 0,
  };
}

export async function listActiveSubscriptionsForUser(userId) {
  if (!hasDb()) return [];
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const base =
    "?user_id=eq." +
    encodeURIComponent(uid) +
    "&status=eq.active";
  const columns =
    "id,user_id,role,endpoint,endpoint_hash,p256dh,auth,device_label,user_agent,updated_at,last_seen_at";
  let rows;
  try {
    rows = await supabaseJson(
      restUrl(
        TABLE,
        base +
          "&select=" +
          columns +
          ",last_provider_status,last_provider_response,last_provider_request_id&limit=50"
      ),
      { headers: serviceHeaders() }
    );
  } catch (err) {
    // Safe deploy order: delivery still works before the additive diagnostics
    // migration reaches an environment.
    if (/last_provider_|PGRST204|column/i.test(String(err && err.message ? err.message : ""))) {
      rows = await supabaseJson(restUrl(TABLE, base + "&select=" + columns + "&limit=50"), {
        headers: serviceHeaders(),
      });
    } else if (/does not exist|schema cache|push_subscriptions/i.test(String(err && err.message ? err.message : ""))) {
      rows = [];
    } else {
      throw err;
    }
  }
  if (!rows) rows = [];
  return Array.isArray(rows) ? rows : [];
}

async function listUniqueActiveSubscriptionsForUser(userId) {
  const rows = await listActiveSubscriptionsForUser(userId);
  const unique = new Map();
  rows.forEach(function (row) {
    const key = row.endpoint_hash || hashEndpoint(row.endpoint);
    if (!unique.has(key)) unique.set(key, row);
  });
  return Array.from(unique.values());
}

export async function getPushStatusForUser(userId, currentEndpoint, expectedRole = "") {
  const rows = await listActiveSubscriptionsForUser(userId);
  const ep = String(currentEndpoint || "").trim();
  const role = String(expectedRole || "").trim().toLowerCase();
  const currentHash = ep ? hashEndpoint(ep) : "";
  const current = currentHash
    ? rows.find(function (r) {
        return r.endpoint_hash === currentHash && (!role || r.role === role);
      })
    : null;

  // Look up THIS browser endpoint even when disabled/expired so UI cannot lie.
  let matchedStatus = "";
  let matchedId = null;
  if (currentHash && hasDb()) {
    const uid = String(userId || "").trim();
    const matched = await supabaseJson(
      restUrl(
        TABLE,
        "?user_id=eq." +
          encodeURIComponent(uid) +
          "&endpoint_hash=eq." +
          encodeURIComponent(currentHash) +
          "&select=id,status,last_error,updated_at&limit=1"
      ),
      { headers: serviceHeaders() }
    ).catch(function () {
      return [];
    });
    const row = Array.isArray(matched) ? matched[0] : matched;
    if (row) {
      matchedStatus = String(row.status || "");
      matchedId = row.id || null;
    }
  }

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
        providerStatus: r.last_provider_status || null,
        providerResponse: r.last_provider_response || "",
        providerRequestId: r.last_provider_request_id || "",
      };
    }),
    currentActive: !!current,
    matchedStatus: matchedStatus || (current ? "active" : ""),
    matchedId: matchedId,
    hasBrowserEndpoint: !!currentHash,
    expectedRole: role,
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
    notification_type: String(opts.notificationType || opts.eventType || "system").slice(0, 64),
    entity_id: String(opts.entityId || opts.orderId || "").slice(0, 120),
    // Business-event fields (additive; admin test path unchanged)
    event_type: String(opts.eventType || opts.notificationType || "").slice(0, 64),
    order_id: String(opts.orderId || opts.entityId || "").slice(0, 120),
    target_user_id: String(opts.targetUserId || "").slice(0, 80),
    tag: String(opts.tag || opts.notificationType || opts.eventType || "mcj").slice(0, 80),
  };
}

function providerResult(response, fallbackStatus = 0) {
  const statusCode = Number(response?.statusCode || response?.status || fallbackStatus || 0);
  const requestId = String(
    response?.headers?.["x-request-id"] ||
      response?.headers?.["x-guploader-uploadid"] ||
      response?.headers?.location ||
      ""
  ).slice(0, 160);
  return {
    statusCode: statusCode || null,
    requestId,
    body: String(response?.body || "").slice(0, 240),
  };
}

async function markSuccess(row, response) {
  if (!row || (!row.id && !row.endpoint)) return;
  const provider = providerResult(response, 201);
  const targetQuery =
    row.endpoint_hash || row.endpoint
      ? "?endpoint_hash=eq." + encodeURIComponent(row.endpoint_hash || hashEndpoint(row.endpoint))
      : "?id=eq." + encodeURIComponent(row.id);
  const basePatch = {
    last_success_at: nowIso(),
    last_seen_at: nowIso(),
    updated_at: nowIso(),
    last_error: "",
  };
  const diagnosticsPatch = {
    last_provider_status: provider.statusCode || 201,
    last_provider_response: provider.body || "accepted",
    last_provider_request_id: provider.requestId,
  };
  await supabaseJson(restUrl(TABLE, targetQuery), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ ...basePatch, ...diagnosticsPatch }),
  }).catch(async function (err) {
    if (/last_provider_|PGRST204|column/i.test(String(err && err.message ? err.message : ""))) {
      await supabaseJson(restUrl(TABLE, targetQuery), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(basePatch),
      }).catch(function () {});
    }
  });
}

async function markFailure(row, statusCode, message) {
  const gone = statusCode === 404 || statusCode === 410;
  const basePatch = {
    status: gone ? "expired" : row.status || "active",
    last_error_at: nowIso(),
    last_error: String(message || statusCode || "push failed").slice(0, 200),
    updated_at: nowIso(),
  };
  const diagnosticsPatch = {
    last_provider_status: Number(statusCode) || null,
    last_provider_response: String(message || "push failed").slice(0, 240),
    last_provider_request_id: "",
  };
  const targetQuery = gone
    ? "?endpoint_hash=eq." + encodeURIComponent(row.endpoint_hash || hashEndpoint(row.endpoint))
    : "?id=eq." + encodeURIComponent(row.id);
  await supabaseJson(restUrl(TABLE, targetQuery), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ ...basePatch, ...diagnosticsPatch }),
  }).catch(async function (err) {
    if (/last_provider_|PGRST204|column/i.test(String(err && err.message ? err.message : ""))) {
      await supabaseJson(restUrl(TABLE, targetQuery), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(basePatch),
      }).catch(function () {});
    }
  });
}

export async function sendWebPushToUser(userId, payloadInput) {
  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, sent: 0, failed: 0, skipped: "missing_user" };
  if (!isWebPushConfigured()) {
    return { ok: false, sent: 0, failed: 0, skipped: "vapid_unconfigured" };
  }

  const rows = await listUniqueActiveSubscriptionsForUser(uid);
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
  const results = [];

  await Promise.all(
    rows.map(async function (row) {
      try {
        const response = await webPush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" }
        );
        sent += 1;
        const provider = providerResult(response, 201);
        await markSuccess(row, response);
        console.info(
          "[web-push] provider accepted",
          JSON.stringify({
            userId: uid,
            subscriptionId: row.id || null,
            endpointHash: row.endpoint_hash || hashEndpoint(row.endpoint),
            status: provider.statusCode || 201,
            requestId: provider.requestId || null,
          })
        );
        results.push({
          subscriptionId: row.id || null,
          endpointHash: row.endpoint_hash || hashEndpoint(row.endpoint),
          outcome: "success",
          statusCode: provider.statusCode || 201,
          requestId: provider.requestId || null,
        });
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
        results.push({
          subscriptionId: row.id || null,
          endpointHash: row.endpoint_hash || hashEndpoint(row.endpoint),
          outcome: statusCode === 404 || statusCode === 410 ? "expired" : "failed",
          statusCode: statusCode || null,
          message: String(err && err.message ? err.message : "send failed").slice(0, 160),
        });
      }
    })
  );

  return { ok: failed === 0, sent: sent, failed: failed, results: results };
}

/**
 * Admin diagnostics: send to ONE user's active endpoints only.
 * Returns per-endpoint outcomes. Never logs or returns VAPID private key.
 * Does not create orders / mutate wallet / points / CS payroll / profiles.
 */
export async function sendAdminTestWebPushToUser(userId, payloadInput) {
  const uid = String(userId || "").trim();
  if (!uid) {
    return {
      ok: false,
      vapidConfigured: isWebPushConfigured(),
      sent: 0,
      failed: 0,
      skipped: "missing_user",
      results: [],
    };
  }
  const vapidConfigured = isWebPushConfigured();
  if (!vapidConfigured) {
    return {
      ok: false,
      vapidConfigured: false,
      sent: 0,
      failed: 0,
      skipped: "vapid_unconfigured",
      results: [],
      message: "Production VAPID 未配置（VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）",
    };
  }

  const rows = await listUniqueActiveSubscriptionsForUser(uid);
  if (!rows.length) {
    return {
      ok: false,
      vapidConfigured: true,
      userId: uid,
      activeCount: 0,
      sent: 0,
      failed: 0,
      skipped: "no_active_subscriptions",
      results: [],
      message: "该用户没有 status=active 的 push_subscriptions",
    };
  }

  let webPush;
  try {
    webPush = await loadWebPush();
  } catch (err) {
    return {
      ok: false,
      vapidConfigured: true,
      userId: uid,
      activeCount: rows.length,
      sent: 0,
      failed: 0,
      skipped: "webpush_load_failed",
      results: [],
      message: String(err && err.message ? err.message : "webpush_load_failed").slice(0, 120),
    };
  }

  const payload = buildPayload(
    Object.assign(
      {
        url: "/mine.html",
        notificationType: "admin_test",
        tag: "admin_test_web_push",
      },
      payloadInput || {},
      {
        // Test sender is diagnostic-only. Never impersonate a business event.
        title: "妙脆角通知测试",
        body: "这是一条系统 Push 测试通知",
        notificationType: "admin_test",
        eventType: "admin_test",
        tag: "admin_test_web_push",
      }
    )
  );
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const results = [];

  await Promise.all(
    rows.map(async function (row) {
      const endpoint = String(row.endpoint || "");
      const endpointPrefix = endpoint.slice(0, 48);
      const base = {
        subscriptionId: row.id || null,
        deviceLabel: row.device_label || "Browser",
        endpointPrefix: endpointPrefix,
        endpointHash: row.endpoint_hash || hashEndpoint(endpoint),
      };
      try {
        const response = await webPush.sendNotification(
          {
            endpoint: endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" }
        );
        sent += 1;
        const provider = providerResult(response, 201);
        await markSuccess(row, response);
        results.push(
          Object.assign({}, base, {
            outcome: "success",
            statusCode: provider.statusCode || 201,
            requestId: provider.requestId || null,
            message: "sent",
          })
        );
      } catch (err) {
        failed += 1;
        const statusCode = Number(err && (err.statusCode || err.status) ? err.statusCode || err.status : 0);
        const rawMsg = String(err && err.message ? err.message : "send failed").slice(0, 160);
        let outcome = "fail";
        if (statusCode === 404 || statusCode === 410) outcome = "expired";
        else if (
          statusCode === 400 ||
          statusCode === 403 ||
          /invalid\s*subscription|bad\s*jwt|unauthorized|forbidden/i.test(rawMsg)
        ) {
          outcome = "invalid_subscription";
        }
        // Only mark expired/disabled for THIS endpoint; never delete other rows.
        await markFailure(row, statusCode, rawMsg);
        console.warn(
          "[web-push] admin test send failed",
          JSON.stringify({
            userId: uid,
            status: statusCode || null,
            outcome: outcome,
            device: row.device_label || "",
            message: rawMsg.slice(0, 120),
          })
        );
        results.push(
          Object.assign({}, base, {
            outcome: outcome,
            statusCode: statusCode || null,
            message: rawMsg,
          })
        );
      }
    })
  );

  return {
    ok: failed === 0 && sent > 0,
    vapidConfigured: true,
    userId: uid,
    activeCount: rows.length,
    sent: sent,
    failed: failed,
    payload: {
      title: payload.title,
      body: payload.body,
      url: payload.url,
    },
    results: results,
  };
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
