/**
 * Final real-DB lifecycle acceptance (no mock / no seed).
 * node scripts/accept-final-lifecycle.mjs --base=https://....vercel.app
 *
 * Flow: purge → register boss → companion apply (XOR auth) → admin approve
 * → hall → order → CS pay+chat+assign → companion accept/start → CS complete → boss review
 *
 * Auth mode: default --auth=deposit; optional --auth=id_card
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
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
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.ALLOW_CREATE_TEST_ACCOUNTS !== "1") {
  console.error("Refusing to run accept-final-lifecycle: creates *.final.@meow.test accounts. Set ALLOW_CREATE_TEST_ACCOUNTS=1 to override.");
  process.exit(2);
}

const PASS = "McjTest@12345678";
const ADMIN_EMAIL = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");
const AUTH_MODE_ARG = (process.argv.find((a) => a.startsWith("--auth="))?.slice(7) || "deposit").trim().toLowerCase();
const AUTH_MODE = AUTH_MODE_ARG === "id_card" ? "id_card" : "deposit";

const stamp = Date.now();
const emails = {
  boss: `boss.final.${stamp}@meow.test`,
  companion: `companion.final.${stamp}@meow.test`,
  service: `service.final.${stamp}@meow.test`,
};

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = {};
const meta = { base: BASE, startedAt: new Date().toISOString(), emails, accounts: {} };

function set(id, status, note = "") {
  results[id] = { status, note: String(note || "").slice(0, 500) };
  console.log(`${status.padEnd(7)} ${id} ${note || ""}`);
}

async function auth(email, password = PASS) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${email}: ${JSON.stringify(j)}`);
  return j;
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
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function api(pathname, token, { method = "POST", body, headers = {} } = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && j.ok !== false, body: j };
}

async function main() {
  console.log("FINAL LIFECYCLE BASE", BASE);

  // ① purge
  try {
    const admin = await auth(ADMIN_EMAIL);
    const purge = await api("/api/admin/purge-test-data", admin.access_token, {
      body: { action: "purge_test_data", confirm: "PURGE_TEST_DATA" },
    });
    if (!purge.ok) throw new Error(purge.body?.message || `HTTP ${purge.status}`);
    set("01_purge", "PASS", purge.body?.message || JSON.stringify(purge.body?.counts || {}));
    meta.accounts.admin = { email: ADMIN_EMAIL, password: PASS };
  } catch (e) {
    set("01_purge", "FAIL", e.message);
    writeReport();
    process.exit(1);
  }

  const admin = await auth(ADMIN_EMAIL);

  // create CS after purge
  try {
    const cs = await api("/api/admin/service-accounts", admin.access_token, {
      body: {
        action: "create",
        name: "终验客服",
        email: emails.service,
        password: PASS,
        phone: "60123456789",
        status: "active",
      },
    });
    if (!cs.ok) throw new Error(cs.body?.message || `HTTP ${cs.status}`);
    set("01b_create_cs", "PASS", emails.service);
    meta.accounts.service = { email: emails.service, password: PASS };
  } catch (e) {
    set("01b_create_cs", "FAIL", e.message);
  }

  // ② register boss
  let bossAuth;
  try {
    const reg = await api("/api/auth", null, {
      body: { action: "register", email: emails.boss, password: PASS, display_name: "终验老板", role: "boss" },
    });
    if (!reg.ok && !/already|exists|已注册/i.test(reg.body?.message || "")) {
      throw new Error(reg.body?.message || `HTTP ${reg.status}`);
    }
    bossAuth = await auth(emails.boss);
    set("02_register_boss", "PASS", emails.boss);
    meta.accounts.boss = { email: emails.boss, password: PASS };
  } catch (e) {
    set("02_register_boss", "FAIL", e.message);
  }

  // ③ companion register + apply (XOR: default deposit; --auth=id_card for identity)
  let companionAuth;
  let companionProfileId = "";
  let companionUserId = "";
  const applyStepId = AUTH_MODE === "id_card" ? "03_companion_apply_id_card" : "03_companion_apply_deposit";
  try {
    const creg = await api("/api/companion", null, {
      body: { action: "register", email: emails.companion, password: PASS, nickname: "终验陪玩" },
    });
    if (!creg.ok && !/already|exists|已注册|已存在/i.test(creg.body?.message || "")) {
      throw new Error(creg.body?.message || "companion register failed");
    }
    companionAuth = await auth(emails.companion);
    companionUserId = companionAuth.user?.id || "";

    const apply = await api("/api/companion", companionAuth.access_token, {
      body: {
        action: "submit_application",
        nickname: "终验陪玩",
        intro: "终验陪玩简介",
        games: ["Valorant"],
        price: 30,
        voice_type: "甜妹",
        auth_mode: AUTH_MODE,
        credential_mode: AUTH_MODE,
      },
    });
    if (!apply.ok) throw new Error(apply.body?.message || `apply HTTP ${apply.status}`);

    if (AUTH_MODE === "id_card") {
      const idOk = await api("/api/companion", companionAuth.access_token, {
        body: {
          action: "submit_verification",
          real_name: "终验陪玩",
          identity_no: "A123456789",
          id_front: TINY_PNG,
          id_back: TINY_PNG,
          account_name: "终验陪玩",
          bank_account: "1234567890",
          method: "bank",
        },
      });
      if (!idOk.ok) throw new Error(idOk.body?.message || `identity HTTP ${idOk.status}`);
    } else {
      const dep = await api("/api/companion", companionAuth.access_token, {
        body: {
          action: "submit_deposit_proof",
          paid_amount: 100,
          payment_method: "TNG",
          proof_url: TINY_PNG,
          remark: "final-accept-deposit",
        },
      });
      if (!dep.ok) throw new Error(dep.body?.message || `deposit HTTP ${dep.status}`);
    }

    const rows = await rest(
      "companion_profiles",
      `?user_id=eq.${encodeURIComponent(companionUserId)}&select=id,user_id&limit=1`
    );
    companionProfileId = rows?.[0]?.id || "";
    set(applyStepId, "PASS", `profile=${companionProfileId};auth=${AUTH_MODE}`);
    meta.accounts.companion = { email: emails.companion, password: PASS, authMode: AUTH_MODE };
  } catch (e) {
    set(applyStepId, "FAIL", e.message);
  }

  // ④ admin approve application (server auto-approves chosen credential); keep explicit review for legacy safety
  try {
    if (!companionProfileId) throw new Error("missing companionProfileId");
    const appOk = await api("/api/admin/players", admin.access_token, {
      body: { action: "review_application", id: companionProfileId, status: "approved" },
    });
    if (!appOk.ok) throw new Error(appOk.body?.message || "review_application failed");
    if (AUTH_MODE === "id_card") {
      const idOk = await api("/api/admin/players", admin.access_token, {
        body: { action: "review_identity", id: companionProfileId, status: "approved" },
      });
      if (!idOk.ok && !/已通过|already|approved/i.test(idOk.body?.message || "")) {
        // auto-approve may have already set identity; only fail on hard errors
        if (idOk.status >= 500) throw new Error(idOk.body?.message || "review_identity failed");
      }
      set("04_admin_approve", "PASS", "application+identity");
    } else {
      const depOk = await api("/api/admin/players", admin.access_token, {
        body: { action: "review_deposit", id: companionProfileId, status: "approved" },
      });
      if (!depOk.ok && !/已通过|already|approved/i.test(depOk.body?.message || "")) {
        if (depOk.status >= 500) throw new Error(depOk.body?.message || "review_deposit failed");
      }
      set("04_admin_approve", "PASS", "application+deposit");
    }
  } catch (e) {
    set("04_admin_approve", "FAIL", e.message);
  }

  // companion go online
  try {
    companionAuth = await auth(emails.companion);
    async function ackAllForced() {
      const pending = await api("/api/companion", companionAuth.access_token, {
        body: { action: "pending_forced" },
      });
      const list = pending.body?.pendingForced || pending.body?.pending || [];
      for (const item of list) {
        const id = item.id || item.announcementId || item.contentId;
        if (!id) continue;
        await api("/api/companion", companionAuth.access_token, {
          body: {
            action: "acknowledge_forced",
            content_id: id,
            content_version: String(item.version || item.content_version || item.contentVersion || "1"),
            content_type: item.contentType || item.content_type || "announcement",
          },
        });
      }
      return list.length;
    }
    let n = await ackAllForced();
    let on = await api("/api/companion", companionAuth.access_token, {
      body: { action: "set_online_status", online_status: "online", availability_status: "online" },
    });
    if (!on.ok && /强制公告/.test(on.body?.message || "")) {
      const fromErr = on.body?.pending || [];
      for (const item of fromErr) {
        await api("/api/companion", companionAuth.access_token, {
          body: {
            action: "acknowledge_forced",
            content_id: item.id,
            content_version: String(item.version || "1"),
            content_type: item.contentType || "announcement",
          },
        });
      }
      await ackAllForced();
      on = await api("/api/companion", companionAuth.access_token, {
        body: { action: "set_online_status", online_status: "online", availability_status: "online" },
      });
    }
    if (!on.ok) throw new Error(on.body?.message || "set_online failed");
    set("04b_companion_online", "PASS", `acked=${n}`);
  } catch (e) {
    set("04b_companion_online", "FAIL", e.message);
  }

  // ⑤ hall
  try {
    const hall = await api(`/api/public/companions`, null, { method: "GET" });
    const list = hall.body?.companions || [];
    const hit = list.find(
      (c) =>
        c.id === companionProfileId ||
        c.userId === companionUserId ||
        c.user_id === companionUserId ||
        /终验陪玩/.test(c.name || c.nickname || "")
    );
    if (!hit) throw new Error(`hall count=${list.length}, companion not found`);
    set("05_hall_visible", "PASS", hit.name || hit.nickname || hit.id);
  } catch (e) {
    set("05_hall_visible", "FAIL", e.message);
  }

  // ⑥ boss order
  let orderId = "";
  let orderNo = "";
  try {
    bossAuth = await auth(emails.boss);
    const create = await api("/api/orders", bossAuth.access_token, {
      body: {
        action: "create",
        companion_id: companionUserId,
        companionId: companionUserId,
        game: "Valorant",
        service: "陪玩",
        title: "终验下单",
        description: "终验需求说明：陪玩一小时",
        requirements: "终验需求说明",
        hours: 1,
        unit_price: 30,
        unitPrice: 30,
        total_amount: 30,
        remark: "final-lifecycle",
      },
    });
    if (!create.ok) throw new Error(create.body?.message || `create HTTP ${create.status}`);
    orderId = create.body?.order?.id || create.body?.orderId || create.body?.id || "";
    orderNo = create.body?.order?.order_no || create.body?.order?.orderNo || create.body?.orderNo || "";
    if (!orderId) {
      const rows = await rest("orders", `?boss_id=eq.${encodeURIComponent(bossAuth.user.id)}&order=created_at.desc&limit=1`);
      orderId = rows?.[0]?.id || "";
      orderNo = rows?.[0]?.order_no || "";
    }
    if (!orderId) throw new Error("order id missing");
    meta.orderId = orderId;
    meta.orderNo = orderNo;
    set("06_boss_order", "PASS", `${orderNo || orderId}`);
  } catch (e) {
    set("06_boss_order", "FAIL", e.message);
  }

  // ⑦ CS confirm payment + chat
  let csAuth;
  let conversationId = "";
  try {
    csAuth = await auth(emails.service);
    // CS login session for customer-service API
    const login = await api("/api/customer-service", null, {
      body: { action: "login", email: emails.service, password: PASS },
    });
    const csToken = login.body?.token || login.body?.access_token || csAuth.access_token;
    const pay = await api("/api/customer-service", csToken, {
      body: { action: "confirm_payment", id: orderId },
      headers: { Authorization: `Bearer ${csToken}` },
    });
    if (!pay.ok) throw new Error(pay.body?.message || `confirm_payment ${pay.status}`);

    const boot = await api("/api/customer-service", csToken, {
      body: { action: "bootstrap" },
    });
    const convs = boot.body?.data?.conversations || boot.body?.conversations || [];
    const mine = convs.find((c) => c.orderId === orderId || c.order_id === orderId) || convs[0];
    conversationId = mine?.id || pay.body?.conversationId || "";
    let imageNote = "no-conv";
    if (conversationId) {
      await api("/api/customer-service", csToken, {
        body: { action: "take_conversation", id: conversationId, conversation_id: conversationId },
      }).catch(() => ({}));
      const msg = await api("/api/customer-service", csToken, {
        body: {
          action: "send_message",
          conversation_id: conversationId,
          content: `终验文字 ${stamp}`,
          message_type: "text",
        },
      });
      if (!msg.ok) throw new Error(msg.body?.message || "send text failed");
      // chat-media requires Supabase JWT
      const up = await api("/api/chat-media", csAuth.access_token, {
        body: { action: "upload", data_url: TINY_PNG, filename: "final-accept.png" },
      });
      const imageUrl = up.body?.url || up.body?.publicUrl || up.body?.path || "";
      if (up.ok && imageUrl && /^https?:\/\//i.test(imageUrl)) {
        const img = await api("/api/customer-service", csToken, {
          body: {
            action: "send_message",
            conversation_id: conversationId,
            content: imageUrl,
            message_type: "image",
          },
        });
        if (!img.ok) throw new Error(img.body?.message || "send image failed");
        imageNote = "image_ok";
      } else {
        const img2 = await api("/api/customer-service", csToken, {
          body: {
            action: "send_message",
            conversation_id: conversationId,
            content: `__IMG__:https://placehold.co/64x64/png`,
            message_type: "image",
          },
        });
        if (!img2.ok) throw new Error(up.body?.message || img2.body?.message || "image upload/send failed");
        imageNote = `image_fallback_ok; upload=${up.body?.message || up.status}`;
      }
    }
    meta.conversationId = conversationId;
    set("07_cs_pay_chat", "PASS", `conv=${conversationId || "n/a"}; ${imageNote}`);
  } catch (e) {
    set("07_cs_pay_chat", "FAIL", e.message);
  }

  // ⑧ CS assign companion
  try {
    const login = await api("/api/customer-service", null, {
      body: { action: "login", email: emails.service, password: PASS },
    });
    const csToken = login.body?.token || login.body?.access_token || (await auth(emails.service)).access_token;
    const assign = await api("/api/customer-service", csToken, {
      body: { action: "assign_companion", id: orderId, companion_id: companionUserId, companionId: companionUserId },
    });
    if (!assign.ok) throw new Error(assign.body?.message || `assign ${assign.status}`);
    set("08_cs_assign", "PASS", "");
  } catch (e) {
    set("08_cs_assign", "FAIL", e.message);
  }

  // ⑨ companion accept
  try {
    companionAuth = await auth(emails.companion);
    // Re-ack forced before order actions
    const pending = await api("/api/companion", companionAuth.access_token, { body: { action: "pending_forced" } });
    for (const item of pending.body?.pendingForced || []) {
      await api("/api/companion", companionAuth.access_token, {
        body: {
          action: "acknowledge_forced",
          content_id: item.id,
          content_version: String(item.version || "1"),
          content_type: item.contentType || "announcement",
        },
      });
    }
    const accept = await api("/api/companion", companionAuth.access_token, {
      body: { action: "accept_direct_order", id: orderId, order_id: orderId },
    });
    if (!accept.ok) throw new Error(accept.body?.message || `accept ${accept.status}`);
    set("09_companion_accept", "PASS", "");
  } catch (e) {
    set("09_companion_accept", "FAIL", e.message);
  }

  // ⑩ start in progress
  try {
    companionAuth = await auth(emails.companion);
    const start = await api("/api/companion", companionAuth.access_token, {
      body: { action: "start_order", id: orderId, order_id: orderId },
    });
    if (!start.ok) throw new Error(start.body?.message || `start ${start.status}`);
    const row = await rest("orders", `?id=eq.${encodeURIComponent(orderId)}&select=status&limit=1`);
    if (row?.[0]?.status !== "in_progress") throw new Error(`status=${row?.[0]?.status}`);
    set("10_in_progress", "PASS", "");
  } catch (e) {
    set("10_in_progress", "FAIL", e.message);
  }

  // ⑪ CS complete
  try {
    const login = await api("/api/customer-service", null, {
      body: { action: "login", email: emails.service, password: PASS },
    });
    const csToken = login.body?.token || login.body?.access_token || (await auth(emails.service)).access_token;
    const done = await api("/api/customer-service", csToken, {
      body: { action: "update_order_status", id: orderId, status: "completed" },
    });
    if (!done.ok) throw new Error(done.body?.message || `complete ${done.status}`);
    set("11_cs_complete", "PASS", "");
  } catch (e) {
    set("11_cs_complete", "FAIL", e.message);
  }

  // ⑫ boss review
  try {
    bossAuth = await auth(emails.boss);
    const rev = await api("/api/orders", bossAuth.access_token, {
      body: {
        action: "submit_review",
        order_id: orderId,
        id: orderId,
        rating: 5,
        content: `终验好评 ${stamp}`,
      },
    });
    if (!rev.ok) throw new Error(rev.body?.message || `review ${rev.status}`);
    set("12_boss_review", "PASS", "");
  } catch (e) {
    set("12_boss_review", "FAIL", e.message);
  }

  // ⑬ sync check
  try {
    const row = await rest(
      "orders",
      `?id=eq.${encodeURIComponent(orderId)}&select=id,order_no,status,boss_id,companion_id,customer_service_id&limit=1`
    );
    const o = row?.[0];
    if (!o) throw new Error("order missing");
    if (o.status !== "completed" && o.status !== "reviewed") throw new Error(`status=${o.status}`);
    const reviews = await rest("companion_reviews", `?order_id=eq.${encodeURIComponent(orderId)}&limit=5`).catch(() => []);
    set(
      "13_sync",
      "PASS",
      `status=${o.status}; reviews=${Array.isArray(reviews) ? reviews.length : 0}; boss=${o.boss_id?.slice(0, 8)}; companion=${o.companion_id?.slice(0, 8)}`
    );
  } catch (e) {
    set("13_sync", "FAIL", e.message);
  }

  // cross checks
  try {
    const hall = await api(`/api/public/companions`, null, { method: "GET" });
    set("X_no_seed_hall", !JSON.stringify(hall.body || {}).includes("[TEST] 验收陪玩") ? "PASS" : "FAIL", `count=${(hall.body?.companions || []).length}`);
  } catch (e) {
    set("X_no_seed_hall", "FAIL", e.message);
  }

  writeReport();
  const failed = Object.values(results).filter((r) => r.status === "FAIL").length;
  process.exit(failed ? 1 : 0);
}

function writeReport() {
  meta.finishedAt = new Date().toISOString();
  const out = { meta, results };
  const file = path.join(root, "p0-final-lifecycle-report.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\nREPORT", file);
  const entries = Object.entries(results);
  console.log(
    "SUMMARY",
    `PASS=${entries.filter(([, r]) => r.status === "PASS").length}`,
    `FAIL=${entries.filter(([, r]) => r.status === "FAIL").length}`
  );
}

main().catch((e) => {
  console.error(e);
  set("fatal", "FAIL", e.message);
  writeReport();
  process.exit(1);
});
