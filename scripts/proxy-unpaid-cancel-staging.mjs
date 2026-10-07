/**
 * Staging regression for proxy-order charge-on-confirm and no-refund-without-payment.
 * Does not load production env. Does not call production.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({
  script: "proxy-unpaid-cancel-staging",
  base: BASE,
  supabaseUrl: "https://cfccwysniduwkjskiqgy.supabase.co",
  requireStagingSupabase: true,
});

const PASS = "McjTest@12345678";
const results = [];
function record(id, ok, note = "") {
  results.push({ id, ok: !!ok, note: String(note || "").slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? " — " + String(note).slice(0, 360) : ""}`);
  return !!ok;
}

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
async function get(path, token) {
  const res = await fetch(BASE + path, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function tokenOf(login) {
  const s = login.json?.session || {};
  return s.token || s.accessToken || login.json?.token || "";
}
function idOf(login) {
  return login.json?.profile?.id || login.json?.user?.id || login.json?.session?.user?.id || "";
}
function bal(walletJson) {
  const w = walletJson?.wallet || {};
  const n = Number(w.availableBalance ?? w.totalBalance ?? w.paidBalance);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function organicPassword() {
  const path = "C:/Users/cianc/Desktop/meow-cuijiao-homepage/wt-p0-price-sot-prod/artifacts/go-live-organic/organic-accounts.json";
  return JSON.parse(readFileSync(path, "utf8")).password;
}

async function walletOf(adminTok, bossId) {
  const res = await get(`/api/admin/wallet?bossId=${encodeURIComponent(bossId)}`, adminTok);
  return { balance: bal(res.json), txs: res.json?.transactions || [], status: res.status, message: res.json?.message || "" };
}
function debitsFor(txs, orderId) {
  return (txs || []).filter((t) => {
    const rel = t.relatedOrderId || t.related_order_id || "";
    const type = t.type || t.transactionType || t.transaction_type || "";
    const dir = t.direction || "";
    return rel === orderId && type === "order_payment" && (dir === "debit" || dir === "");
  });
}

async function main() {
  const info = await get("/api/build-info");
  record("staging-ref", info.json?.supabaseRef === "cfccwysniduwkjskiqgy" && info.json?.supabaseIsProduction !== true, `ref=${info.json?.supabaseRef || ""} sha=${info.json?.sha || ""}`);

  const cs = await post("/api/customer-service", { action: "login", account: "service@meow.test", password: PASS });
  const boss = await post("/api/auth", { action: "login", email: "boss@meow.test", password: PASS, loginPortal: "boss" });
  const admin = await post("/api/auth", { action: "login", email: "admin@meow.test", password: PASS, loginPortal: "admin" });
  const comp = await post("/api/companion", {
    action: "login",
    account: "organic.companion@mcj-staging-organic.invalid",
    password: organicPassword(),
  });
  const csTok = tokenOf(cs);
  const bossTok = tokenOf(boss);
  const adminTok = tokenOf(admin);
  const compTok = tokenOf(comp);
  const bossId = idOf(boss);
  const compId = idOf(comp);
  record("logins", !!(csTok && bossTok && adminTok && compTok && bossId && compId), `boss=${bossId ? "ok" : "missing"} comp=${compId ? "ok" : "missing"}`);
  if (!csTok || !bossId || !compTok || !adminTok) return finish();

  const start = await walletOf(adminTok, bossId);
  record("wallet-readable", start.balance != null, `balance=${start.balance} ${start.message}`);
  if (start.balance == null) return finish();

  const tag = Date.now();
  const hall = await post("/api/customer-service", {
    action: "create_order",
    boss_id: bossId,
    send_to_hall: true,
    game: "默认服务",
    description: `proxy-unpaid-A ${tag}`,
    title: `proxy-unpaid-A ${tag}`,
    hours: 1,
    unit_price: 20,
    total_amount: 20,
    order_type: "customer_service",
  }, csTok);
  const hallOrder = hall.json?.order || {};
  const afterCreate = await walletOf(adminTok, bossId);
  const hallDebits = debitsFor(afterCreate.txs, hallOrder.id);
  record(
    "A-create-no-debit",
    !!hall.json?.ok && hallOrder.status === "pending" && afterCreate.balance === start.balance && hallDebits.length === 0,
    `status=${hallOrder.status} msg=${hall.json?.message || ""} bal ${start.balance}->${afterCreate.balance} debits=${hallDebits.length}`
  );
  const cancel1 = await post("/api/customer-service", { action: "cs_cancel_order", id: hallOrder.id, reason: "没找到陪玩" }, csTok);
  const afterCancel = await walletOf(adminTok, bossId);
  const cancelStatus = cancel1.json?.order?.status || "";
  record(
    "A-cancel-unpaid",
    !!cancel1.json?.ok && cancelStatus === "cancelled" && afterCancel.balance === start.balance && /未付款|无需退款|已取消/.test(String(cancel1.json?.message || "")),
    `status=${cancelStatus} msg=${cancel1.json?.message || ""} bal=${afterCancel.balance}`
  );
  const cancel2 = await post("/api/customer-service", { action: "cs_cancel_order", id: hallOrder.id, reason: "再取消一次" }, csTok);
  const afterCancel2 = await walletOf(adminTok, bossId);
  record(
    "E-cancel-twice",
    !!cancel2.json?.ok && afterCancel2.balance === start.balance && (cancel2.json?.order?.status === "cancelled" || cancel2.json?.duplicate),
    `msg=${cancel2.json?.message || ""} bal=${afterCancel2.balance}`
  );

  const priced = await post("/api/customer-service", {
    action: "create_order",
    boss_id: bossId,
    companion_id: compId,
    game: "默认服务",
    description: `proxy-confirm-B ${tag}`,
    title: `proxy-confirm-B ${tag}`,
    hours: 1,
    order_type: "customer_service",
  }, csTok);
  const pricedOrder = priced.json?.order || {};
  const unitTotal = Number(pricedOrder.total_amount || 0);
  const afterPriced = await walletOf(adminTok, bossId);
  record(
    "B-created-unpaid",
    !!priced.json?.ok && pricedOrder.status === "claimed" && !(pricedOrder.paid_at) && afterPriced.balance === start.balance,
    `status=${pricedOrder.status} total=${unitTotal} paid_at=${pricedOrder.paid_at || ""} bal=${afterPriced.balance} msg=${priced.json?.message || ""}`
  );

  const hoursC = unitTotal > 0 ? Math.max(1, Math.ceil((start.balance + 5) / unitTotal)) : 1;
  const tooBig = await post("/api/customer-service", {
    action: "create_order",
    boss_id: bossId,
    companion_id: compId,
    game: "默认服务",
    description: `proxy-poor-C ${tag}`,
    title: `proxy-poor-C ${tag}`,
    hours: hoursC,
    order_type: "customer_service",
  }, csTok);
  const big = tooBig.json?.order || {};
  const bigTotal = Number(big.total_amount || 0);
  const beforePoor = await walletOf(adminTok, bossId);
  const poor = await post("/api/companion", { action: "accept_direct_order", id: big.id }, compTok);
  const afterPoor = await walletOf(adminTok, bossId);
  const poorDebits = debitsFor(afterPoor.txs, big.id);
  record(
    "C-insufficient",
    bigTotal > beforePoor.balance && poor.json?.ok !== true && poor.json?.code === "INSUFFICIENT_BALANCE" && afterPoor.balance === beforePoor.balance && poorDebits.length === 0 && poor.json?.order?.status !== "in_progress",
    `need=${bigTotal} have=${beforePoor.balance} code=${poor.json?.code || ""} msg=${poor.json?.message || ""} status=${poor.status} bal=${afterPoor.balance}`
  );

  const beforeAccept = await walletOf(adminTok, bossId);
  const accept1 = await post("/api/companion", { action: "accept_direct_order", id: pricedOrder.id }, compTok);
  const afterAccept = await walletOf(adminTok, bossId);
  const acceptDebits = debitsFor(afterAccept.txs, pricedOrder.id);
  const acceptStatus = accept1.json?.order?.status || "";
  record(
    "B-confirm-debits-once",
    !!accept1.json?.ok && (acceptStatus === "in_progress" || accept1.json?.order?.status === "in_progress") && afterAccept.balance === Math.round((beforeAccept.balance - unitTotal) * 100) / 100 && acceptDebits.length === 1,
    `status=${acceptStatus} bal ${beforeAccept.balance}->${afterAccept.balance} expectedDrop=${unitTotal} debits=${acceptDebits.length} msg=${accept1.json?.message || ""}`
  );
  const accept2 = await post("/api/companion", { action: "accept_direct_order", id: pricedOrder.id }, compTok);
  const afterAccept2 = await walletOf(adminTok, bossId);
  const acceptDebits2 = debitsFor(afterAccept2.txs, pricedOrder.id);
  record(
    "G-double-confirm",
    afterAccept2.balance === afterAccept.balance && acceptDebits2.length === 1,
    `second=${accept2.json?.message || ""} dup=${!!accept2.json?.duplicate} bal=${afterAccept2.balance} debits=${acceptDebits2.length}`
  );

  const refund1 = await post("/api/admin/orders", { action: "refund", id: pricedOrder.id, reason: "已扣款后取消退实际支付" }, adminTok);
  const afterRefund = await walletOf(adminTok, bossId);
  record(
    "D-refund-actual-once",
    !!refund1.json?.ok && afterRefund.balance === beforeAccept.balance,
    `msg=${refund1.json?.message || ""} order=${refund1.json?.order?.status || ""} bal ${afterAccept.balance}->${afterRefund.balance} expected=${beforeAccept.balance}`
  );
  const refund2 = await post("/api/admin/orders", { action: "refund", id: pricedOrder.id, reason: "重复退款" }, adminTok);
  const afterRefund2 = await walletOf(adminTok, bossId);
  record(
    "F-refund-twice",
    afterRefund2.balance === afterRefund.balance && (refund2.json?.duplicate || /未重复|已退款/.test(String(refund2.json?.message || ""))),
    `msg=${refund2.json?.message || ""} dup=${!!refund2.json?.duplicate} bal=${afterRefund2.balance}`
  );

  const bossOrders = await get("/api/orders", bossTok);
  const hallView = (bossOrders.json?.orders || bossOrders.json?.data || []).find((o) => o.id === hallOrder.id || o.order_no === hallOrder.order_no) || {};
  const paidView = (bossOrders.json?.orders || bossOrders.json?.data || []).find((o) => o.id === pricedOrder.id) || {};
  record(
    "labels",
    (hallView.status === "cancelled" || hallView.statusText === "已取消" || cancelStatus === "cancelled") &&
      (paidView.status === "refunded" || paidView.statusText === "已退款" || refund1.json?.order?.status === "refunded"),
    `hall=${hallView.status || cancelStatus}/${hallView.statusText || hallView.paymentStatus || ""} paid=${paidView.status || refund1.json?.order?.status}/${paidView.statusText || ""}`
  );

  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  writeFileSync("artifacts/proxy-cancel-refund/staging-report.json", JSON.stringify({ at: new Date().toISOString(), failed: failed.length, results }, null, 2));
  console.log(JSON.stringify({ failed: failed.length, total: results.length }));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  record("crash", false, err?.message || String(err));
  finish();
});
