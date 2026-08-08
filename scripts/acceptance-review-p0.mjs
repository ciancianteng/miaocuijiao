/**
 * P0 review flow: complete order → 立即评价 → DB → public profile → admin
 * node scripts/acceptance-review-p0.mjs --base=https://....vercel.app
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
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");

const out = {};
const set = (id, status, note = "") => {
  out[id] = { status, note: String(note).slice(0, 300) };
  console.log(status, id, note || "");
};

async function auth(email) {
  const j = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  }).then((r) => r.json());
  if (!j.access_token) throw new Error("auth failed " + email);
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
  const t = await r.text();
  const data = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${t}`);
  return data;
}
async function api(pathname, token, body, method = "POST") {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok !== false, body: j, status: r.status };
}

const companion = await auth("companion@meow.test");
const boss = await auth("boss@meow.test");
await api("/api/companion", companion.access_token, { action: "set_online_status", online_status: "online" });

const created = await api("/api/orders", boss.access_token, {
  action: "create",
  order: {
    order_type: "open_grab",
    game: "无畏契约",
    title: "评价验收订单",
    description: "评价验收\n区服：亚服",
    hours: 1,
    unit_price: 80,
  },
});
const order = created.body?.order || created.body?.data?.order;
const orderId = order?.id;
const orderNo = order?.orderNo || order?.order_no;
if (!orderId) throw new Error("create failed");
await api("/api/orders", boss.access_token, {
  action: "pay_order",
  id: orderId,
  preview_test: "1",
  test_pay: "1",
  paymentMethod: "test",
});
await api("/api/companion", companion.access_token, { action: "accept_order", id: orderId });
await api("/api/orders", boss.access_token, {
  action: "select_grabber",
  id: orderId,
  companionId: companion.user.id,
});
await api("/api/companion", companion.access_token, { action: "start_order", id: orderId });
await api("/api/companion", companion.access_token, { action: "complete_order", id: orderId });
await api("/api/orders", boss.access_token, { action: "confirm_completion", id: orderId });

const list = await api("/api/orders?action=list", boss.access_token, null, "GET");
const o = (list.body?.orders || list.body?.data || []).find((x) => x.id === orderId);
set("R01_can_review_button", o?.canReview === true ? "PASS" : "FAIL", `canReview=${o?.canReview} status=${o?.status} reviewed=${o?.reviewed}`);

const content = `P0评价验收 ${Date.now()} 服务很好`;
const review = await api("/api/orders", boss.access_token, {
  action: "submit_review",
  id: orderId,
  rating: 5,
  content,
});
set("R02_submit", review.ok ? "PASS" : "FAIL", review.body?.message);

const db = await rest(
  "companion_reviews",
  `?order_id=eq.${orderId}&select=id,rating,content,companion_id,boss_id,status`
);
const row = db?.[0];
set(
  "R03_db",
  row && Number(row.rating) === 5 && String(row.content).includes("P0评价验收") ? "PASS" : "FAIL",
  JSON.stringify(row || {})
);

const pub = await fetch(`${BASE}/api/public/companions?id=${encodeURIComponent(companion.user.id)}`, {
  headers: { Accept: "application/json" },
}).then((r) => r.json());
const pc = (pub.companions || [])[0];
const hit = (pc?.reviews || []).some((r) => r.id === row?.id || String(r.content || "").includes("P0评价验收"));
set(
  "R04_public_profile",
  pc && Number(pc.goodReviewCount) >= 1 && (hit || Number(pc.reviewCount) >= 1) ? "PASS" : "FAIL",
  `rating=${pc?.rating} reviews=${pc?.reviewCount} good=${pc?.goodReviewCount} hit=${hit}`
);

const profileId = (
  await rest("companion_profiles", `?user_id=eq.${companion.user.id}&select=id`)
)?.[0]?.id;
const admin = await fetch(`${BASE}/api/admin/players?id=${encodeURIComponent(profileId)}`, {
  headers: { Accept: "application/json", "x-mcj-admin-role": "admin" },
}).then((r) => r.json());
const detail = admin.player || admin.detail || {};
const adminHit = (detail.reviews || []).some((r) => r.id === row?.id || String(r.content || "").includes("P0评价验收"));
set(
  "R05_admin",
  admin.ok && Number(detail.stats?.goodReviewCount || detail.goodReviewCount) >= 1 && (adminHit || Number(detail.stats?.reviewCount) >= 1)
    ? "PASS"
    : "FAIL",
  `rating=${detail.stats?.rating} good=${detail.stats?.goodReviewCount} hit=${adminHit}`
);

const list2 = await api("/api/orders?action=list", boss.access_token, null, "GET");
const o2 = (list2.body?.orders || list2.body?.data || []).find((x) => x.id === orderId);
set("R06_button_gone", o2?.canReview === false && o2?.reviewed === true ? "PASS" : "FAIL", `canReview=${o2?.canReview} reviewed=${o2?.reviewed}`);

const fails = Object.values(out).filter((v) => v.status === "FAIL").length;
const blocked = Object.values(out).filter((v) => v.status === "BLOCKED").length;
const pass = Object.values(out).filter((v) => v.status === "PASS").length;
const summary = {
  total: Object.keys(out).length,
  pass,
  fail: fails,
  blocked,
  launch: fails === 0 && blocked === 0 ? "YES" : "NO",
  orderNo,
  orderId,
  reviewId: row?.id,
  base: BASE,
};
fs.writeFileSync(path.join(root, "scripts", "acceptance-review-p0-results.json"), JSON.stringify({ summary, results: out }, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.launch !== "YES") process.exitCode = 2;
