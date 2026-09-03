/**
 * Read-safe Preview smoke (no real withdraw create).
 * Usage: node scripts/smoke-preview-safe.mjs <preview-base>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const out = [];

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

function log(ok, id, d) {
  out.push({ ok, id, d: String(d) });
  console.log(`${ok ? "PASS" : "FAIL"} | ${id} | ${d}`);
}

async function login(email) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`${email} ${JSON.stringify(b).slice(0, 120)}`);
  return b;
}

async function api(apiPath, token, body, method = "POST") {
  const opts = {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") opts.body = JSON.stringify(body || {});
  const r = await fetch(`${BASE}${apiPath}`, opts);
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && d.ok !== false, d };
}

if (!BASE) {
  console.error("need preview url");
  process.exit(1);
}
loadEnv();
assertSmokeTargetAllowed({
  script: "smoke-preview-safe.mjs",
  base: BASE,
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
});
console.log("Preview:", BASE);

const boss = await login("boss@meow.test");
log(true, "boss-login", boss.user.id);

const cs = await api("/api/customer-service", "", {
  action: "login",
  account: "service@meow.test",
  password: PASS,
});
const csTok = cs.d.session?.token;
log(!!csTok, "cs-login", csTok ? "ok" : JSON.stringify(cs.d).slice(0, 120));

const comp = await api("/api/companion", "", {
  action: "login",
  account: "companion@meow.test",
  password: PASS,
});
const cTok = comp.d.session?.token;
log(!!cTok, "companion-login", cTok ? "ok" : JSON.stringify(comp.d).slice(0, 120));

const admin = await login("admin@meow.test");
log(true, "admin-login", admin.user.id);

const clock = await api("/api/customer-service", csTok, { action: "clock_in" });
log(
  clock.ok || /已上班|already/i.test(JSON.stringify(clock.d)),
  "clock-in",
  JSON.stringify(clock.d).slice(0, 180)
);

const att = await api("/api/customer-service?action=bootstrap", csTok, null, "GET");
log(
  att.ok || att.status === 200,
  "cs-bootstrap",
  `unread=${att.d?.data?.summary?.unread ?? att.d?.summary?.unread} status=${att.status}`
);

const stamp = `RT-SMOKE-${Date.now()}`;
const send = await api("/api/chat", boss.access_token, {
  action: "send",
  content: stamp,
  message_type: "text",
});
log(send.ok, "chat-send", send.d?.row?.id || JSON.stringify(send.d).slice(0, 120));

await new Promise((r) => setTimeout(r, 2000));
const poll = await api("/api/customer-service", csTok, { action: "poll_updates" });
const sees =
  JSON.stringify(poll.d).includes(stamp) ||
  JSON.stringify(poll.d).includes(send.d?.row?.conversation_id || "___");
log(poll.status < 500, "msg-poll", `status=${poll.status} seesHint=${sees}`);

const boot2 = await api("/api/customer-service?action=bootstrap", csTok, null, "GET");
const unread = Number(boot2.d?.data?.summary?.unread ?? boot2.d?.summary?.unread ?? -1);
log(unread >= 0, "unread-number", `unread=${unread}`);

const hall = await api("/api/companion?action=bootstrap", cTok, null, "GET");
log(
  hall.ok || hall.status === 200,
  "grab-hall",
  `openOrders=${(hall.d?.data?.openOrders || []).length} my=${(hall.d?.data?.myOrders || []).length}`
);

const wallet = await api("/api/companion?action=wallet", cTok, null, "GET");
log(wallet.ok || wallet.status === 200, "wallet", `withdrawable=${wallet.d?.data?.earnings?.withdrawable}`);

// amount=1 should fail validation before insert (min usually 50)
const wd = await api("/api/companion", cTok, { action: "request_withdrawal", amount: 1 });
const wdMsg = String(wd.d?.message || "");
const wdOk = !wd.ok && /最低提现|余额不足|暂不可提现|结款账户|待审核|次数/.test(wdMsg);
log(wdOk || (!wd.ok && wd.status === 400), "withdraw-validate", `${wd.status} ${wdMsg.slice(0, 140)}`);

const inbox = await api("/api/companion?action=inbox", cTok, null, "GET");
log(inbox.ok || inbox.status === 200, "companion-inbox", JSON.stringify(inbox.d?.data || inbox.d).slice(0, 140));

const bossOrders = await api("/api/orders?action=list", boss.access_token, null, "GET");
log(
  bossOrders.status < 500,
  "boss-orders",
  `status=${bossOrders.status} n=${(bossOrders.d?.orders || bossOrders.d?.data || []).length}`
);

const adminOrders = await api("/api/admin/orders", admin.access_token, { action: "list" });
log(adminOrders.status !== 404, "admin-orders", `status=${adminOrders.status}`);

const rt = await api("/api/public/realtime-config", "", null, "GET");
log(!!(rt.d?.realtime || rt.d?.configured), "realtime-config", JSON.stringify(rt.d).slice(0, 100));

// Entry markers
for (const p of ["/", "/customer-service/", "/companion/", "/admin.html"]) {
  const r = await fetch(`${BASE}${p}`);
  const html = await r.text();
  const marker =
    p === "/companion/"
      ? html.includes("companionApp")
      : html.includes("20260801deployFresh") || html.includes("serviceApp") || html.includes("admin-shell");
  log(r.ok && marker, `entry${p}`, `HTTP ${r.status}`);
}

const fail = out.filter((x) => !x.ok);
console.log(`\nSUMMARY pass=${out.length - fail.length} fail=${fail.length}`);
if (fail.length) fail.forEach((f) => console.log(" -", f.id, f.d));
process.exit(fail.length ? 1 : 0);
