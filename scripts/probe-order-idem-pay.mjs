/**
 * Probe order create idempotency + test pay on Staging.
 * node scripts/probe-order-idem-pay.mjs
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
const URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
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

async function api(pathname, token, body) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const boss = await auth("boss.final.1785714993009@meow.test");
const key = `probe-idem-${Date.now()}`;
const body = {
  action: "create",
  order: {
    order_type: "open_grab",
    game: "无畏契约",
    title: "idemprobe",
    hours: 1,
    unit_price: 40,
    idempotency_key: key,
  },
  idempotencyKey: key,
  idempotency_key: key,
};
const a = await api("/api/orders", boss.access_token, body);
const b = await api("/api/orders", boss.access_token, body);
const id1 = a.j.order?.id || a.j.data?.order?.id;
const id2 = b.j.order?.id || b.j.data?.order?.id;
console.log("c1", a.status, a.j.ok, id1, a.j.message);
console.log("c2", b.status, b.j.ok, id2, b.j.message, "same=", id1 === id2);

const id = id1 || id2;
const payVariants = [
  { action: "pay_order", id, preview_test: "1", test_pay: "1", paymentMethod: "test" },
  { action: "pay_order", id, allowTestPay: true, preview_test: "1", paymentMethod: "catfood" },
  { action: "pay_order", id, paymentMethod: "catfood" },
];
for (const p of payVariants) {
  const pay = await api("/api/orders", boss.access_token, p);
  console.log(
    "pay",
    JSON.stringify(p).slice(0, 80),
    pay.status,
    pay.j.ok,
    pay.j.message,
    pay.j.order?.status || pay.j.data?.order?.status
  );
  if (pay.j.ok) break;
}

const rowRes = await fetch(`${URL}/rest/v1/orders?id=eq.${id}&select=*`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
const row = (await rowRes.json())[0];
console.log("status", row?.status, "idem", row?.idempotency_key);
console.log(
  "has_idem_col",
  Object.prototype.hasOwnProperty.call(row || {}, "idempotency_key"),
  "keys_sample",
  Object.keys(row || {})
    .filter((k) => /idem|pay|status|balance|amount/i.test(k))
    .join(",")
);

// balance
const bal = await fetch(`${URL}/rest/v1/profiles?id=eq.${boss.user.id}&select=id,cat_food_balance,balance,wallet_balance`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
console.log("boss_balance", await bal.text());
