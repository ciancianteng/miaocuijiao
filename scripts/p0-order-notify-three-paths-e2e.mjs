/**
 * P0 order notify chain E2E — three paid→claimed paths on Staging/Preview.
 *
 * A) designated create + pay_order → claimed notify
 * B) open hall + companion grab + boss want_him → claimed notify
 * C) marketplace create_and_pay → claimed notify
 *
 * Verifies: companion inbox, Realtime broadcast, sendOrderMailOnce / Resend id, admin mail_logs.
 * Does NOT treat mail_ping as PASS.
 *
 * Usage:
 *   BASE_URL=https://<preview-or-staging> node scripts/p0-order-notify-three-paths-e2e.mjs
 * Optional: E2E_ORDER_MAIL_TO=you@gmail.com (Resend-deliverable; staging profile email override only)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BASE = String(
  process.env.BASE_URL || process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const MAIL_TO = String(process.env.E2E_ORDER_MAIL_TO || "ciancianteng@gmail.com").trim().toLowerCase();

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
  return !!ok;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

async function api(pathname, token, body, method = null, headers = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.ok !== false, json };
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text.slice(0, 240)}`);
  return data;
}

async function creditBoss(bossId, amount) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mcj_wallet_credit`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_boss_id: bossId,
      p_transaction_type: "admin_adjust",
      p_amount: amount,
      p_balance_type: "paid",
      p_idempotency_key: `e2e-order-notify-topup:${bossId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      p_reason: "E2E order notify topup",
      p_internal_note: "scripts/p0-order-notify-three-paths-e2e.mjs",
      p_operator_id: bossId,
      p_related_order_id: null,
      p_related_recharge_id: null,
      p_campaign_id: null,
      p_compensation_id: null,
      p_expires_at: null,
      p_recharge_rm: 0,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`wallet credit ${r.status}: ${text.slice(0, 200)}`);
}

async function subscribeRealtime(companionId, accessToken) {
  const client = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    realtime: { params: { apikey: ANON } },
  });
  const topic = `mcj-companion-orders:${companionId}`;
  const got = { assigned: null, changed: null, ready: false, error: "" };
  await new Promise((resolve) => {
    const channel = client.channel(topic, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "order_assigned" }, (payload) => {
      got.assigned = (payload && payload.payload) || payload || {};
    });
    channel.on("broadcast", { event: "order_changed" }, (payload) => {
      got.changed = (payload && payload.payload) || payload || {};
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        got.ready = true;
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        got.error = status;
        resolve();
      }
    });
    setTimeout(() => resolve(), 8000);
  });
  return {
    got,
    async waitForOrder(orderId, ms = 12000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit =
          (got.assigned && String(got.assigned.orderId || got.assigned.order_id || "") === String(orderId)) ||
          (got.changed && String(got.changed.orderId || got.changed.order_id || "") === String(orderId));
        if (hit) return true;
        await sleep(400);
      }
      return false;
    },
    async close() {
      try {
        await client.removeAllChannels();
      } catch {
        /* ignore */
      }
    },
  };
}

async function inboxHasOrder(compTok, orderId) {
  const inbox = await api(`/api/companion?action=inbox`, compTok, null, "GET");
  const items = inbox.json?.items || inbox.json?.data?.items || inbox.json?.notifications || [];
  const hit = (Array.isArray(items) ? items : []).find(
    (n) =>
      String(n.href || "").includes(orderId) ||
      String(n.body || "").includes(orderId) ||
      String(n.noticeKey || n.notice_key || "").startsWith(orderId)
  );
  if (hit) return { ok: true, via: "inbox_api", hit };
  // Fallback: direct table (same DB as staging)
  const rows = await rest(
    "companion_notifications",
    `?or=(notice_key.ilike.${encodeURIComponent(orderId + "%")},href.ilike.${encodeURIComponent("%" + orderId + "%")})&order=created_at.desc&limit=5`
  ).catch(() => []);
  const row = (rows || [])[0];
  return { ok: !!row, via: row ? "db" : "none", hit: row || null, inboxStatus: inbox.status };
}

async function mailLogForOrder(adminTok, orderId) {
  const logs = await api(`/api/admin/mail-logs?limit=80`, adminTok, null, "GET");
  const list = logs.json?.logs || [];
  // Strict: only rows for this order (never match by recipient alone — that leaks prior path mails).
  const forOrder = list.filter(
    (l) => orderId && (l.orderId === orderId || String(l.notificationKey || "").startsWith(`${orderId}:`))
  );
  return { ok: !!logs.json?.ok, logs: forOrder, allCount: list.length, message: logs.json?.message };
}

async function verifyNotifyBundle({ label, orderId, companionId, compTok, adminTok, rt, expectMailTo }) {
  const out = { inbox: false, realtime: false, mailSent: false, resendId: "", mailStatus: "" };

  let inbox = await inboxHasOrder(compTok, orderId);
  for (let i = 0; i < 6 && !inbox.ok; i++) {
    await sleep(1500);
    inbox = await inboxHasOrder(compTok, orderId);
  }
  out.inbox = inbox.ok;
  step(`${label}.inbox`, inbox.ok, `via=${inbox.via} title=${inbox.hit?.title || ""}`);

  out.realtime = await rt.waitForOrder(orderId, 10000);
  step(`${label}.realtime`, out.realtime, `ready=${rt.got.ready} err=${rt.got.error || ""} assigned=${!!rt.got.assigned}`);

  let mail = await mailLogForOrder(adminTok, orderId);
  for (let i = 0; i < 8 && !(mail.logs || []).length; i++) {
    await sleep(1500);
    mail = await mailLogForOrder(adminTok, orderId);
  }
  const top = (mail.logs || [])[0];
  out.mailStatus = top?.status || "";
  const detail = String(top?.detail || top?.failReason || "");
  const idMatch = detail.match(/sent:([A-Za-z0-9_-]+)/) || detail.match(/\b(re_[A-Za-z0-9]+)\b/);
  out.resendId = idMatch ? idMatch[1] : "";
  out.mailSent = String(out.mailStatus) === "sent" && !!out.resendId;
  step(
    `${label}.mail_logs`,
    !!(top && (out.mailSent || out.mailStatus === "sent" || out.mailStatus === "failed" || out.mailStatus === "email_pending")),
    `status=${out.mailStatus} recipient=${top?.recipient || top?.email || ""} key=${top?.notificationKey || ""} detail=${detail.slice(0, 120)}`
  );
  step(`${label}.resend_message_id`, out.mailSent, out.resendId || detail.slice(0, 160) || "no provider id");

  // Idempotency: re-trigger notify path should not create a second assign mail key
  return out;
}

async function ensureCompanionReady(compId, compTok) {
  await ackForcedAll(compTok);
  await api("/api/companion", compTok, { action: "set_online_status", online_status: "online", status: "online" });
  await rest(`companion_profiles?user_id=eq.${encodeURIComponent(compId)}`, "", {
    method: "PATCH",
    body: {
      application_status: "approved",
      verification_status: "approved",
      deposit_status: "approved",
      allow_orders: true,
      online_status: "online",
      availability_status: "online",
      // marketplace create_and_pay falls back to game_prices when companion_services table is absent
      game_prices: { VALORANT: 18 },
      game: "VALORANT",
      price: 18,
      pricing_unit: "小时",
      updated_at: new Date().toISOString(),
    },
  }).catch(() => null);
}

async function ackForcedAll(token) {
  for (let i = 0; i < 8; i++) {
    const pendingRes = await api("/api/companion", token, { action: "pending_forced" });
    const list = pendingRes.json?.pendingForced || [];
    if (!list.length) return true;
    for (const item of list) {
      await api("/api/companion", token, {
        action: "acknowledge_forced",
        content_id: item.id || item.contentId,
        content_type: item.contentType || "announcement",
        content_version: String(item.version || item.contentVersion || 1),
      });
    }
  }
  const again = await api("/api/companion", token, { action: "pending_forced" });
  return !(again.json?.pendingForced || []).length;
}

async function ensureMarketplaceService(compId) {
  // Prefer game_prices fallback (companion_services may be missing on staging schema).
  await rest(`companion_profiles?user_id=eq.${encodeURIComponent(compId)}`, "", {
    method: "PATCH",
    body: {
      game_prices: { VALORANT: 18 },
      game: "VALORANT",
      price: 18,
      pricing_unit: "小时",
      verification_status: "approved",
      online_status: "online",
      availability_status: "online",
      updated_at: new Date().toISOString(),
    },
  });
  return { id: "VALORANT", price: 18 };
}

async function main() {
  console.log("BASE", BASE);
  console.log("DB", SUPABASE_URL);

  // Source guards (this branch)
  const mkt = fs.readFileSync(path.join(root, "server/api/boss/marketplace.js"), "utf8");
  const header = fs.readFileSync(path.join(root, "src/boss-header.js"), "utf8");
  const notify = fs.readFileSync(path.join(root, "server/api/_companion-order-notify.js"), "utf8");
  step("src.marketplace_calls_notify", /notifyCompanionOrderAssigned/.test(mkt), "create_and_pay");
  step("src.boss_notify_poll_restored", /setInterval/.test(header) && /loadNotifications\(\{ silent: true \}\)/.test(header) && !/通知推送未完成/.test(header), "poll");
  step("src.mail_stores_provider_id", /sent:\$\{providerId\}|providerMessageId/.test(notify), "detail");

  const rtCfg = await api("/api/public/realtime-config", null, null, "GET");
  step("realtime_config", !!rtCfg.json?.ok && !!rtCfg.json?.url, JSON.stringify({ ok: rtCfg.json?.ok, url: rtCfg.json?.url }));

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossT = tok(bossLogin.json);
  const bossId = bossLogin.json?.session?.user?.id || bossLogin.json?.user?.id || "";
  step("auth.boss", !!bossT && !!bossId, bossLogin.json?.message || bossId);

  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const compT = tok(compLogin.json);
  const compId = compLogin.json?.session?.user?.id || compLogin.json?.user?.id || "";
  step("auth.companion", !!compT && !!compId, compLogin.json?.message || compId);

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csT = tok(csLogin.json);
  step("auth.cs", !!csT, csLogin.json?.message || "");

  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json);
  step("auth.admin", !!adminT, adminLogin.json?.message || "");

  if (!bossT || !compT || !adminT) {
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  // Staging-only: point companion profile.email at a Resend-deliverable inbox (auth login email unchanged).
  const priorEmailRows = await rest("profiles", `?id=eq.${encodeURIComponent(compId)}&select=id,email`);
  const priorEmail = priorEmailRows?.[0]?.email || COMP;
  await rest(`profiles?id=eq.${encodeURIComponent(compId)}`, "", {
    method: "PATCH",
    body: { email: MAIL_TO },
  });
  step("staging.mail_target_override", true, `${priorEmail} → ${MAIL_TO}`);

  await ensureCompanionReady(compId, compT);
  await creditBoss(bossId, 500).catch((e) => step("wallet.topup", false, e.message));
  step("wallet.topup", true, "500");

  // P1: boss notification bell data path (API, not mock)
  const beforeNotif = await api("/api/notifications?action=list", bossT, null, "GET");
  const beforeUnread = Number(beforeNotif.json?.unread || 0);
  const nTitle = `E2E铃铛 ${Date.now()}`;
  await rest("boss_notifications", "", {
    method: "POST",
    body: {
      boss_id: bossId,
      title: nTitle,
      body: "order-notify e2e auto refresh",
      kind: "system",
      created_at: new Date().toISOString(),
    },
  });
  let saw = false;
  let unread = beforeUnread;
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const n = await api("/api/notifications?action=list", bossT, null, "GET");
    unread = Number(n.json?.unread || 0);
    const items = n.json?.items || [];
    if (items.some((x) => x.title === nTitle) && unread >= beforeUnread + 1) {
      saw = true;
      break;
    }
  }
  step("boss_notify.api_auto_visible", saw, `unread ${beforeUnread}→${unread}`);
  step(
    "boss_notify.poll_source",
    /startNotifyPoll/.test(header) && /12000/.test(header),
    "12s poll /api/notifications (no localStorage mock)"
  );

  const rt = await subscribeRealtime(compId, compT);
  step("realtime.subscribe", rt.got.ready, rt.got.error || "subscribed");

  // ── A: pay_order designated ──
  {
    const label = "A_pay_assign";
    const create = await api("/api/orders", bossT, {
      action: "create",
      order: {
        order_type: "direct_companion",
        companion_id: compId,
        companionId: compId,
        game: "VALORANT",
        title: `NotifyA ${Date.now()}`,
        description: "path A designated pay",
        hours: 1,
        unit_price: 18,
        total_amount: 18,
        service_name: "上分",
      },
    });
    const oid = create.json?.order?.id;
    step(`${label}.create`, !!oid, create.json?.message || oid);
    if (oid) {
      rt.got.assigned = null;
      const pay = await api("/api/orders", bossT, { action: "pay_order", id: oid, paymentMethod: "catfood" });
      const row = (await rest("orders", `?id=eq.${encodeURIComponent(oid)}&select=id,status,companion_id`))?.[0];
      step(
        `${label}.claimed`,
        !!(pay.ok || row?.status === "claimed") && row?.status === "claimed" && row?.companion_id === compId,
        `api=${pay.json?.message || pay.status} db=${row?.status}`
      );
      await verifyNotifyBundle({ label, orderId: oid, companionId: compId, compTok: compT, adminTok: adminT, rt, expectMailTo: MAIL_TO });
      // Idempotency retry
      await api("/api/orders", bossT, { action: "pay_order", id: oid, paymentMethod: "catfood" }).catch(() => null);
      await sleep(2000);
      const mail = await mailLogForOrder(adminT, oid);
      const assignKeys = (mail.logs || [])
        .map((l) => l.notificationKey)
        .filter((k) => String(k || "").includes(":assign"));
      step(`${label}.mail_idempotent`, new Set(assignKeys).size <= 1, `keys=${assignKeys.length} unique=${new Set(assignKeys).size}`);
    }
  }

  // ── B: want_him / confirm_companion ──
  {
    const label = "B_want_him";
    await ackForcedAll(compT);
    const create = await api("/api/orders", bossT, {
      action: "create",
      order: {
        order_type: "custom",
        game: "VALORANT",
        title: `NotifyB ${Date.now()}`,
        description: "path B grab then want_him",
        hours: 1,
        unit_price: 18,
        total_amount: 18,
      },
    });
    const oid = create.json?.order?.id;
    step(`${label}.create`, !!oid, create.json?.message || oid);
    if (oid) {
      await creditBoss(bossId, 50).catch(() => null);
      let pay = await api("/api/orders", bossT, { action: "pay_order", id: oid, paymentMethod: "catfood" });
      if (!pay.ok) {
        pay = await api("/api/customer-service", csT, { action: "confirm_payment", id: oid }, null, {
          "x-mcj-service-token": csT,
        });
      }
      let row = (await rest("orders", `?id=eq.${encodeURIComponent(oid)}&select=id,status,companion_id`))?.[0];
      step(`${label}.open_hall`, row?.status === "pending" && !row?.companion_id, `status=${row?.status}`);
      const grab = await api("/api/companion", compT, { action: "accept_order", id: oid });
      step(`${label}.grab`, grab.ok, grab.json?.message || grab.status);
      rt.got.assigned = null;
      const pick = await api("/api/orders", bossT, { action: "want_him", id: oid, companion_id: compId });
      row = (await rest("orders", `?id=eq.${encodeURIComponent(oid)}&select=id,status,companion_id`))?.[0];
      step(
        `${label}.claimed`,
        !!(pick.ok || row?.status === "claimed") && row?.status === "claimed" && row?.companion_id === compId,
        `api=${pick.json?.message || pick.status} db=${row?.status}`
      );
      await verifyNotifyBundle({ label, orderId: oid, companionId: compId, compTok: compT, adminTok: adminT, rt, expectMailTo: MAIL_TO });
      await api("/api/orders", bossT, { action: "want_him", id: oid, companion_id: compId });
      await sleep(1500);
      const mail = await mailLogForOrder(adminT, oid);
      const assignKeys = (mail.logs || [])
        .map((l) => l.notificationKey)
        .filter((k) => String(k || "").includes(":assign"));
      step(`${label}.mail_idempotent`, new Set(assignKeys).size <= 1, `keys=${assignKeys.length} unique=${new Set(assignKeys).size}`);
    }
  }

  // ── C: marketplace create_and_pay ──
  {
    const label = "C_marketplace";
    const svc = await ensureMarketplaceService(compId);
    const catalog = await api(`/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(compId)}`, bossT, null, "GET");
    const serviceId = catalog.json?.services?.[0]?.id || svc?.id || "VALORANT";
    step(`${label}.catalog`, !!serviceId && (catalog.json?.services || []).length > 0, `svc=${serviceId} n=${(catalog.json?.services || []).length} msg=${catalog.json?.message || catalog.status}`);
    await creditBoss(bossId, 100).catch(() => null);
    rt.got.assigned = null;
    const idem = `mkt-notify-${Date.now()}`;
    const pay = await api("/api/boss/marketplace", bossT, {
      action: "create_and_pay",
      companionId: compId,
      serviceId,
      quantity: 1,
      idempotencyKey: idem,
      gameIdValue: "E2E-BOSS",
      notes: "path C marketplace notify",
    });
    const order = pay.json?.order || {};
    const oid = order.id;
    step(
      `${label}.create_and_pay_claimed`,
      !!(pay.ok && oid && (order.status === "claimed" || (await rest("orders", `?id=eq.${encodeURIComponent(oid)}&select=status`))?.[0]?.status === "claimed")),
      `status=${order.status} msg=${pay.json?.message || pay.status}`
    );
    if (oid) {
      await verifyNotifyBundle({ label, orderId: oid, companionId: compId, compTok: compT, adminTok: adminT, rt, expectMailTo: MAIL_TO });
      // Replay same idempotency key — must remain single assign mail
      await api("/api/boss/marketplace", bossT, {
        action: "create_and_pay",
        companionId: compId,
        serviceId,
        quantity: 1,
        idempotencyKey: idem,
      });
      await sleep(2000);
      const mail = await mailLogForOrder(adminT, oid);
      const assignKeys = (mail.logs || [])
        .map((l) => l.notificationKey)
        .filter((k) => String(k || "").includes(":assign"));
      step(`${label}.mail_idempotent`, new Set(assignKeys).size <= 1, `keys=${assignKeys.length} unique=${new Set(assignKeys).size}`);
    }
  }

  await rt.close();
  // Restore companion profile email (login account email stays COMP)
  await rest(`profiles?id=eq.${encodeURIComponent(compId)}`, "", {
    method: "PATCH",
    body: { email: COMP },
  }).catch(() => null);
  step("staging.mail_target_restored", true, COMP);

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\nSUMMARY", { pass: results.length - failed.length, fail: failed.length, total: results.length, base: BASE });
  console.log(JSON.stringify({ base: BASE, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
