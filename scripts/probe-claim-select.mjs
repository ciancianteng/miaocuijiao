/**
 * Probe select_grabber / claim lock / companion auth / CS create.
 * node scripts/probe-claim-select.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['']$/g, "")];
    })
);
const URL = (env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";

async function auth(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  return r.json();
}
async function api(pathname, token, body, headers = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
async function rest(table, qs) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  return r.json();
}

const boss = await auth("boss.final.1785714993009@meow.test");
const companion = await auth("companion.idcard.1785715257525@meow.test");
const companionAlt = await auth("companion.final.1785714993009@meow.test");
const admin = await auth("admin@meow.test");

console.log("ids", {
  boss: boss.user.id,
  companion: companion.user.id,
  companionAlt: companionAlt.user.id,
});

const cp = await rest(
  "companion_profiles",
  `?user_id=in.(${companion.user.id},${companionAlt.user.id})&select=id,user_id,nickname,application_status,verification_status,deposit_status,identity_status,online_status`
);
console.log("profiles", JSON.stringify(cp, null, 2));

const key = `probe-claim-${Date.now()}`;
const created = await api("/api/orders", boss.access_token, {
  action: "create",
  order: {
    order_type: "open_grab",
    game: "无畏契约",
    title: "claimprobe",
    hours: 1,
    unit_price: 45,
    idempotency_key: key,
  },
  idempotencyKey: key,
});
const order = created.j.order;
console.log("create", created.status, order?.id, order?.status);

const paid = await api("/api/orders", boss.access_token, {
  action: "pay_order",
  id: order.id,
  preview_test: "1",
  allowTestPay: true,
  paymentMethod: "test",
});
console.log("pay", paid.status, paid.j.ok, paid.j.message, paid.j.order?.status);

await api("/api/companion", companion.access_token, {
  action: "set_online_status",
  online_status: "online",
});
const grab = await api("/api/companion", companion.access_token, {
  action: "accept_order",
  id: order.id,
});
console.log("grab", grab.status, grab.j.ok, grab.j.message);

const grabs = await api("/api/orders", boss.access_token, {
  action: "list_grabs",
  id: order.id,
});
console.log("list_grabs", JSON.stringify(grabs.j).slice(0, 500));

const select = await api("/api/orders", boss.access_token, {
  action: "select_grabber",
  id: order.id,
  companionId: companion.user.id,
  companion_id: companion.user.id,
});
console.log("select", select.status, select.j.ok, select.j.message, select.j.order?.status, select.j.order?.companionId);

const db = await rest("orders", `?id=eq.${order.id}&select=id,status,companion_id`);
console.log("db", db);

const selectAlt = await api("/api/orders", boss.access_token, {
  action: "select_grabber",
  id: order.id,
  companionId: companionAlt.user.id,
});
console.log("selectAlt", selectAlt.status, selectAlt.j.ok, selectAlt.j.message, selectAlt.j.order?.companionId);

const db2 = await rest("orders", `?id=eq.${order.id}&select=id,status,companion_id`);
console.log("db2", db2);

const start = await api("/api/companion", companion.access_token, {
  action: "start_order",
  id: order.id,
});
console.log("start", start.status, start.j.ok, start.j.message);

// CS create
const csEmail = `service.p0alt.${Date.now()}@meow.test`;
const csCreate = await api(
  "/api/admin/service-accounts",
  admin.access_token,
  {
    action: "create",
    name: "P0验收客服B",
    email: csEmail,
    password: PASS,
    phone: `601${String(Date.now()).slice(-8)}`,
    status: "active",
  },
  { "x-mcj-admin-role": "admin" }
);
console.log("csCreate", csCreate.status, csCreate.j.ok, csCreate.j.message, csEmail);
