import { readFileSync, writeFileSync } from "node:fs";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({
  script: "batch-p1-p10-followup",
  base: BASE,
  supabaseUrl: "https://cfccwysniduwkjskiqgy.supabase.co",
  requireStagingSupabase: true,
});
const PASS = "McjTest@12345678";
const organicPassword = JSON.parse(
  readFileSync("C:/Users/cianc/Desktop/meow-cuijiao-homepage/wt-p0-price-sot-prod/artifacts/go-live-organic/organic-accounts.json", "utf8")
).password;

const results = [];
function record(id, ok, note = "") {
  results.push({ id, ok: !!ok, note: String(note || "").slice(0, 800) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? " — " + String(note).slice(0, 420) : ""}`);
}
async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
async function get(path, token) {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function tokenOf(login) {
  const s = login.json?.session || {};
  return s.token || s.accessToken || "";
}

const admin = await post("/api/auth", { action: "login", email: "admin@meow.test", password: PASS, loginPortal: "admin" });
const boss = await post("/api/auth", { action: "login", email: "boss@meow.test", password: PASS, loginPortal: "boss" });
const comp = await post("/api/companion", { action: "login", account: "organic.companion@mcj-staging-organic.invalid", password: organicPassword });
const testComp = await post("/api/companion", { action: "login", account: "companion@meow.test", password: PASS });
const adminTok = tokenOf(admin);
const bossTok = tokenOf(boss);
const compTok = tokenOf(comp);
const testTok = tokenOf(testComp);
const compId = comp.json?.session?.user?.id || "";

const low = await post("/api/companion", { action: "request_withdrawal", amount: 0.5 }, testTok);
record("G-server-rejects-low", low.status === 400 && /高于 RM0\.80/.test(String(low.json?.message || "")), `${low.status} ${low.json?.message || ""}`);

const services = await get("/api/admin/services", adminTok);
const list = services.json?.services || [];
const target = list.find((item) => /默认/.test(item.name || "")) || list[0];
const original = target?.orderFields || [];
if (target?.id) {
  await post("/api/admin/services", {
    action: "save_order_fields",
    id: target.id,
    orderFields: [
      { name: "游戏ID", kind: "text", required: true, enabled: true },
      { name: "区服", kind: "select", required: true, options: ["国服", "国际服"], enabled: true },
    ],
  }, adminTok);
}
const pub = await get("/api/platform/services?scope=all");
const live = (pub.json?.services || []).find((item) => item.id === target?.id);
const fields = live?.orderFields || [];
const answers = fields.map((field) => ({ fieldId: field.id, value: field.kind === "select" ? field.options[0] : "SNAP-KEEP" }));
const placed = await post("/api/orders", {
  action: "place_order",
  companionId: compId,
  serviceId: target?.id || "",
  service: target?.name || "",
  game: target?.name || "",
  hours: 1,
  quantity: 1,
  gameId: "SNAP-KEEP",
  orderRequirements: answers,
  paymentMethod: "catfood",
  idempotencyKey: `follow-${Date.now()}`,
}, bossTok);
const order = placed.json?.order || {};
const snap = order.serviceSnapshot?.requirements || [];
const snapText = JSON.stringify(snap);
record("A-order-snapshot", !!placed.json?.ok && /SNAP-KEEP/.test(snapText) && /国服/.test(snapText), `${placed.status} ${placed.json?.message || ""} ${snapText.slice(0, 300)}`);

if (target?.id) {
  await post("/api/admin/services", {
    action: "save_order_fields",
    id: target.id,
    orderFields: [{ name: "后来才加的字段", kind: "text", required: false, enabled: true }],
  }, adminTok);
}
const adminList = await get("/api/admin/orders", adminTok);
const saved = (adminList.json?.orders || []).find((row) => row.id === order.id);
const reread = JSON.stringify(saved?.serviceSnapshot?.requirements || []);
record("B-old-order-unchanged", !!order.id && reread === snapText && !/后来才加的字段/.test(reread), `match=${reread === snapText} ${reread.slice(0, 240)}`);
record("A-companion-sees-requirements", /SNAP-KEEP/.test(reread) && /国服/.test(reread), reread.slice(0, 240));

if (order.id) {
  const cancelled = await post("/api/orders", { action: "cancel_order", id: order.id, reason: "batch followup" }, bossTok);
  record("I-cancel", cancelled.json?.order?.status === "cancelled" || /已取消/.test(String(cancelled.json?.message || "")), `${cancelled.status} ${cancelled.json?.order?.status || ""} ${cancelled.json?.message || ""}`);
}
if (target?.id) {
  await post("/api/admin/services", { action: "save_order_fields", id: target.id, orderFields: original }, adminTok);
}
for (const item of list) {
  if (!item?.id || item.id === target?.id) continue;
  const names = (item.orderFields || []).map((field) => field.name).join(",");
  if (names === "游戏ID,区服,备注") {
    await post("/api/admin/services", { action: "save_order_fields", id: item.id, orderFields: [] }, adminTok);
  }
}

writeFileSync("artifacts/batch-p1-p10/followup-report.json", JSON.stringify({ results }, null, 2));
