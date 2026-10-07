import { readFileSync, writeFileSync } from "node:fs";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({
  script: "batch-p1-p10-notices",
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
const adminTok = tokenOf(admin);
const bossTok = tokenOf(boss);
const compTok = tokenOf(comp);
const compId = comp.json?.session?.user?.id || "";

const services = await get("/api/platform/services?scope=all");
const target = (services.json?.services || []).find((item) => /默认/.test(item.name || "")) || (services.json?.services || [])[0];
const answers = (target?.orderFields || []).filter((field) => field.enabled !== false).map((field) => ({
  fieldId: field.id,
  value: field.kind === "select" ? (field.options || [])[0] : field.kind === "number" ? "1" : "NOTICE-KEEP",
}));
const placed = await post("/api/orders", {
  action: "place_order",
  companionId: compId,
  serviceId: target?.id || "",
  service: target?.name || "",
  game: target?.name || "",
  hours: 1,
  quantity: 1,
  gameId: "NOTICE-KEEP",
  orderRequirements: answers,
  paymentMethod: "catfood",
  idempotencyKey: `notice-${Date.now()}`,
}, bossTok);
const order = placed.json?.order || {};
const inbox = await get("/api/companion?action=inbox&include_messages=0", compTok);
const notices = inbox.json?.inbox?.systemNotices || inbox.json?.data?.systemNotices || [];
const designated = notices.find((item) => String(item.title || "").includes("老板指定下单") && String(item.body || item.key || "").includes(order.orderNo || order.order_no || order.id || "___"));
record("D-companion-designated", !!order.id && !!designated && designated.unread !== false, `${placed.status} ${placed.json?.message || ""} inbox=${notices.length} title=${designated?.title || ""}`);

const adminNotes = await get("/api/admin/notifications", adminTok);
const staffHit = (adminNotes.json?.notifications || []).find((item) => item.kind === "new_order" && String(item.relatedId || item.body || "").includes(order.orderNo || order.order_no || ""));
record("D-admin-new-order", adminNotes.status === 200 && !!staffHit, `${adminNotes.status} unread=${adminNotes.json?.unread} n=${(adminNotes.json?.notifications || []).length} kind=${staffHit?.kind || ""} sample=${(adminNotes.json?.notifications || []).slice(0, 2).map((item) => item.title + ":" + item.body).join(" | ")}`);
const cs = await post("/api/customer-service", { action: "login", account: "service@meow.test", password: PASS });
const csTok = tokenOf(cs);
const csBoot = await post("/api/customer-service", { action: "bootstrap" }, csTok);
const csNotes = csBoot.json?.data?.notifications || [];
const rechargeHit = csNotes.some((item) => item.kind === "recharge_proof" || /充值/.test(String(item.title || "")));
record("E-recharge-notice-present", rechargeHit, rechargeHit ? `persisted recharge notices=${csNotes.filter((item) => item.kind === "recharge_proof").length}` : "missing");

if (order.id) {
  await post("/api/orders", { action: "cancel_order", id: order.id, reason: "notice followup" }, bossTok);
  const again = await get("/api/companion?action=inbox&include_messages=0", compTok);
  const list = again.json?.inbox?.systemNotices || again.json?.data?.systemNotices || [];
  const cancelled = list.find((item) => /取消|状态更新/.test(String(item.title || "") + String(item.body || "")) && String(item.body || "").includes(order.orderNo || order.order_no || ""));
  record("D-companion-cancel", !!cancelled, cancelled?.title || "missing");
}

writeFileSync("artifacts/batch-p1-p10/notice-report.json", JSON.stringify({ results, orderNo: order.orderNo || order.order_no || "" }, null, 2));
