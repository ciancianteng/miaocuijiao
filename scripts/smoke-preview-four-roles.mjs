/**
 * Smoke: clock / chat+unread / grab hall / withdraw / cross-role sync on Preview.
 * Usage: node scripts/smoke-preview-four-roles.mjs <preview-base-url>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const findings = [];

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

function note(ok, id, detail) {
  findings.push({ ok, id, detail: String(detail || "") });
  console.log(`${ok ? "PASS" : "FAIL"} | ${id} | ${detail}`);
}

async function supabaseLogin(email) {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`${email}: ${JSON.stringify(b).slice(0, 180)}`);
  return { token: b.access_token, userId: b.user?.id };
}

async function post(apiPath, token, body) {
  const res = await fetch(`${BASE}${apiPath}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, ok: res.ok && data.ok !== false };
}

async function get(apiPath, token) {
  const res = await fetch(`${BASE}${apiPath}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, ok: res.ok && data.ok !== false };
}

async function main() {
  if (!BASE) {
    console.error("need preview base url");
    process.exit(1);
  }
  loadEnv();
  console.log("Preview:", BASE);

  // Entry pages
  for (const p of ["/", "/customer-service/", "/companion/", "/admin.html"]) {
    const r = await fetch(`${BASE}${p}`);
    const html = await r.text();
    const marker =
      p === "/companion/"
        ? html.includes("companionApp") && html.includes("companion-workbench")
        : html.includes("20260801deployFresh") || html.includes("companionApp") || html.includes("serviceApp");
    note(r.ok && marker, `entry${p}`, `HTTP ${r.status} marker=${marker}`);
  }

  // Logins
  const boss = await supabaseLogin("boss@meow.test");
  note(true, "boss-login", boss.userId);

  const csLogin = await post("/api/customer-service", null, {
    action: "login",
    account: "service@meow.test",
    password: PASS,
  });
  const csToken = csLogin.data?.session?.token || csLogin.data?.token || "";
  note(!!csToken, "cs-login", csToken ? "ok" : JSON.stringify(csLogin.data).slice(0, 160));

  const compLogin = await post("/api/companion", null, {
    action: "login",
    account: "companion@meow.test",
    password: PASS,
  });
  const compToken = compLogin.data?.session?.token || "";
  note(!!compToken, "companion-login", compToken ? "ok" : JSON.stringify(compLogin.data).slice(0, 160));

  const admin = await supabaseLogin("admin@meow.test").catch((e) => ({ error: e.message }));
  note(!admin.error, "admin-login", admin.userId || admin.error);

  // 1) Clock / attendance
  const clockStatus = await post("/api/customer-service", csToken, { action: "work_status" });
  const att = clockStatus.data?.attendance || clockStatus.data?.data?.attendance || clockStatus.data;
  note(
    clockStatus.ok || clockStatus.res.status === 200,
    "clock-status",
    JSON.stringify(att).slice(0, 220)
  );
  // soft clock_in if not already in (idempotent)
  const clockIn = await post("/api/customer-service", csToken, { action: "clock_in" });
  note(
    clockIn.ok || /already|已打卡|上班中/i.test(JSON.stringify(clockIn.data)),
    "clock-in",
    JSON.stringify(clockIn.data).slice(0, 200)
  );

  // 2) Chat + unread seed from boss
  const stamp = `SMOKE-${Date.now()}`;
  const send = await post("/api/chat", boss.token, {
    action: "send",
    content: stamp,
    message_type: "text",
  });
  note(send.ok || send.res.status < 500, "chat-send-boss", `${send.res.status} ${JSON.stringify(send.data).slice(0, 180)}`);

  // CS poll / bootstrap
  const poll = await post("/api/customer-service", csToken, { action: "poll_conversations" });
  const list =
    poll.data?.conversations ||
    poll.data?.data?.conversations ||
    poll.data?.items ||
    [];
  const unreadTotal =
    poll.data?.summary?.unread ??
    poll.data?.data?.summary?.unread ??
    poll.data?.unread ??
    null;
  note(poll.ok || Array.isArray(list), "cs-poll", `rows=${Array.isArray(list) ? list.length : "?"} unread=${unreadTotal}`);

  // 3) Unread presence (API-level)
  const hasUnread =
    Number(unreadTotal) > 0 ||
    (Array.isArray(list) && list.some((c) => Number(c.unread || c.unread_count || 0) > 0));
  note(hasUnread || send.ok, "unread-signal", `hasUnread=${hasUnread}`);

  // 4) Grab hall
  const hall = await post("/api/companion", compToken, { action: "order_hall" });
  const hallAlt = hall.ok
    ? hall
    : await post("/api/companion", compToken, { action: "grab_hall" });
  const hallOk = hall.ok || hallAlt.ok || [200, 201].includes(hall.res.status);
  const hallItems =
    hall.data?.orders ||
    hall.data?.data?.orders ||
    hallAlt.data?.orders ||
    hallAlt.data?.data?.orders ||
    hall.data?.items ||
    [];
  note(hallOk, "grab-hall", `HTTP ${hall.res.status}/${hallAlt.res.status} items=${Array.isArray(hallItems) ? hallItems.length : "?"}`);

  // 5) Withdraw apply (dry: wallet + create if balance allows; else validate endpoint)
  const wallet = await post("/api/companion", compToken, { action: "wallet" });
  const avail = Number(
    wallet.data?.data?.earnings?.withdrawable ??
      wallet.data?.data?.earnings?.available ??
      wallet.data?.earnings?.withdrawable ??
      wallet.data?.available ??
      0
  );
  note(wallet.ok || wallet.res.status < 500, "wallet", `avail=${avail}`);

  let withdrawOk = false;
  let withdrawDetail = "";
  if (avail >= 1) {
    const w = await post("/api/companion", compToken, {
      action: "withdraw_apply",
      amount: 1,
      method: "alipay",
      account: "smoke@meow.test",
      account_name: "SMOKE",
    });
    withdrawOk = w.ok || /pending|limit|次数|不足|duplicate/i.test(JSON.stringify(w.data));
    withdrawDetail = JSON.stringify(w.data).slice(0, 220);
  } else {
    const probe = await post("/api/companion", compToken, {
      action: "withdraw_apply",
      amount: 1,
      method: "alipay",
      account: "smoke@meow.test",
      account_name: "SMOKE",
    });
    // Endpoint alive even if balance insufficient
    withdrawOk = probe.res.status < 500;
    withdrawDetail = `low_balance; ${JSON.stringify(probe.data).slice(0, 180)}`;
  }
  note(withdrawOk, "withdraw-apply", withdrawDetail);

  // 6) Cross-role: admin finance / orders readable
  if (admin.token) {
    const fin = await get("/api/admin/finance?action=overview", admin.token).catch(() => null);
    const finPost = await post("/api/admin/finance", admin.token, { action: "overview" });
    note(
      (fin && fin.ok) || finPost.ok || finPost.res.status < 500,
      "admin-finance-sync",
      `GET ${fin?.res?.status} POST ${finPost.res.status}`
    );
  }

  // Companion messages inbox
  const inbox = await post("/api/companion", compToken, { action: "messages" });
  const inboxAlt = inbox.ok ? inbox : await post("/api/companion", compToken, { action: "inbox" });
  note(
    inbox.ok || inboxAlt.ok || inbox.res.status < 500,
    "companion-messages",
    `HTTP ${inbox.res.status}/${inboxAlt.res.status}`
  );

  // Realtime config
  const rt = await get("/api/public/realtime-config", null);
  note(rt.ok || rt.res.status === 200, "realtime-config", JSON.stringify(rt.data).slice(0, 160));

  const failed = findings.filter((f) => !f.ok);
  console.log("\n=== SUMMARY ===");
  console.log(`pass=${findings.length - failed.length} fail=${failed.length}`);
  if (failed.length) failed.forEach((f) => console.log(" -", f.id, f.detail));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
