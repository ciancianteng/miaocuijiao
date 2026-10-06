#!/usr/bin/env node
/**
 * Staging-only E2E: cert badge statistics + unified badge commission.
 *
 *   Badge A 70% → PW-A (PW00077) ; Badge B 80% → PW-B (PW00076)
 *   A1, A2, B1 settle 70/30, 70/30, 80/20 → stats
 *   A 70→75: A3 settles 75, A1/A2 keep 70
 *   remove PW-A from A (pending → approve): A4 not attributed, history stays in A
 *   B2 partial refund / B3 full refund → actual settled, refund totals
 *   repeat completion calls → no duplicate settlement
 *   multi order (PW-A re-granted A, PW-B) → per-child attribution, parent not counted
 *   export CSV, permissions, admin UI screenshots (desktop + mobile)
 *
 * Test data is tagged "[cert-badge-e2e]" in order notes and badge names start with "E2E勋章".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assertSmokeTargetAllowed({ script: "cert-badge-commission-e2e", base: STG, supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co` });
const build = await fetch(`${STG}/api/build-info`).then((r) => r.json());
if (!build.supabaseIsStaging || build.supabaseIsProduction || build.supabaseRef !== STAGING_SUPABASE_REF) {
  throw new Error(`not staging DB: ${JSON.stringify(build)}`);
}

const organicPath = [
  path.resolve(here, "../../../wt-p0-price-sot-prod/artifacts/go-live-organic/organic-accounts.json"),
  path.resolve(here, "../../../meow-cuijiao-homepage/artifacts/go-live-organic/organic-accounts.json"),
].find((p) => fs.existsSync(p));
if (!organicPath) throw new Error("organic staging accounts file not found");
const ORG_PASS = JSON.parse(fs.readFileSync(organicPath, "utf8")).password;
const BOSS_EMAIL = "organic.invitee.boss@mcj-staging-organic.invalid";
const PWA_ACC = "organic.invitee.comp@mcj-staging-organic.invalid"; // PW00077
const PWB_ACC = "organic.companion@mcj-staging-organic.invalid"; // PW00076
const ADMIN = { email: "admin@meow.test", password: "McjTest@12345678" };
const CS = { account: "service@meow.test", password: "McjTest@12345678" };
const STAMP = Date.now();
const TAG = "[cert-badge-e2e]";

const report = { generated_at: new Date().toISOString(), staging: STG, build, stamp: STAMP, badges: {}, orders: {}, checks: [], screenshots: [] };
let pass = 0;
let fail = 0;
function check(no, name, ok, evidence) {
  if (ok) pass += 1;
  else fail += 1;
  report.checks.push({ no, name, result: ok ? "PASS" : "FAIL", evidence });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${no} ${name} :: ${typeof evidence === "string" ? evidence : String(JSON.stringify(evidence ?? null)).slice(0, 400)}`);
}
function save() {
  report.summary = { total: pass + fail, pass, fail };
  fs.writeFileSync(path.join(here, "report.json"), JSON.stringify(report, null, 2));
}
const tok = (j) => j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
async function api(p, token, body, method = "POST", extra = {}) {
  const res = await fetch(`${STG}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...extra,
    },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const brief = (r) => ({ status: r.status, ok: r.json?.ok, message: r.json?.message, code: r.json?.code, orderStatus: r.json?.order?.status });
const m2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const near = (a, b) => Math.abs(m2(a) - m2(b)) < 0.011;

// ---------------------------------------------------------------- logins
const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN.email, password: ADMIN.password })).json);
const bossL = await api("/api/auth", null, { action: "login", email: BOSS_EMAIL, password: ORG_PASS, loginPortal: "boss" });
const bossT = tok(bossL.json);
const csT = tok((await api("/api/customer-service", null, { action: "login", ...CS })).json);
async function companionLogin(account) {
  const r = await api("/api/companion", null, { action: "login", account, password: ORG_PASS });
  return { t: tok(r.json), id: r.json?.session?.user?.id || "" };
}
const pwA = await companionLogin(PWA_ACC);
const pwB = await companionLogin(PWB_ACC);
if (!adminT || !bossT || !pwA.t || !pwB.t) {
  console.error("login failed", { admin: !!adminT, boss: !!bossT, pwA: !!pwA.t, pwB: !!pwB.t });
  process.exit(1);
}
const adminH = { "x-mcj-admin-role": "admin" };
const CERT = "/api/admin/companion-cert-tags";
const cget = (q) => api(`${CERT}?${q}`, adminT, null, "GET", adminH);
const cpost = (body) => api(CERT, adminT, body, "POST", adminH);

for (const c of [pwA, pwB]) {
  const pf = await api("/api/companion", c.t, { action: "pending_forced" });
  for (const item of pf.json?.pendingForced || []) {
    await api("/api/companion", c.t, { action: "acknowledge_forced", id: item.id || item.contentId, content_id: item.id || item.contentId });
  }
  await api("/api/companion", c.t, { action: "set_online_status", online_status: "online" });
}

// ---------------------------------------------------------------- precheck: migration applied
const probeA = await cget("action=companion&ref=PW00077");
const probeB = await cget("action=companion&ref=PW00076");
check("M0", "Staging migration applied (ledger readable)", probeA.status === 200 && probeB.status === 200, { a: brief(probeA), b: brief(probeB) });
if (probeA.status !== 200) {
  save();
  console.error("migration not applied — run supabase/migrations/20261005_cert_badge_commission.sql on Staging first");
  process.exit(2);
}
report.baseline = { pwA: probeA.json, pwB: probeB.json };
const pwAProfileId = probeA.json.companion.id;
report.baseline.pwBProfileId = probeB.json.companion.id;

// ---------------------------------------------------------------- badges
async function createBadge(name, rate, priority, color) {
  const r = await cpost({ action: "save", tag: { name, icon: "🎖️", color, sort: 900, enabled: true, companionShareRate: rate, commissionPriority: priority } });
  return { r, item: r.json?.item || {} };
}
const A = await createBadge(`E2E勋章A-${String(STAMP).slice(-5)}`, 70, 1, "#4cc9f0");
const B = await createBadge(`E2E勋章B-${String(STAMP).slice(-5)}`, 80, 2, "#ff9f1c");
report.badges = { A: A.item, B: B.item };
check("S1", "Create badge A 70% / badge B 80%", A.r.status === 200 && B.r.status === 200 && A.item.companionShareRate === 70 && B.item.companionShareRate === 80 && A.item.platformRate === 30, { A: A.item, B: B.item });
const AID = A.item.id;
const BID = B.item.id;

const gA = await cpost({ action: "grant", id: AID, companionRef: "PW00077" });
const gB = await cpost({ action: "grant", id: BID, companionRef: "PW00076" });
const gDup = await cpost({ action: "grant", id: AID, companionRef: "PW00077" });
check("S2", "Grant A→PW00077, B→PW00076 (with granted time / admin); duplicate grant is idempotent", gA.status === 200 && gB.status === 200 && gDup.json?.duplicate === true && !!gA.json?.assignment?.grantedAt, { gA: gA.json?.assignment, dup: brief(gDup) });
// make the new badge the commission badge even if the companion already holds another rated badge
await cpost({ action: "set_primary", id: AID, companionRef: "PW00077" });
await cpost({ action: "set_primary", id: BID, companionRef: "PW00076" });
const viewA = await cget("action=companion&ref=PW00077");
const viewB = await cget("action=companion&ref=PW00076");
check("S3", "Admin sees which badge drives commission (PW-A → A 70%, PW-B → B 80%)", viewA.json?.commissionBadge?.badgeId === AID && viewA.json?.commissionBadge?.companionShareRate === 70 && viewB.json?.commissionBadge?.badgeId === BID, { a: viewA.json?.commissionBadge, b: viewB.json?.commissionBadge });

// players detail reflects the same effective rate (no "shows 70, settles 80")
const playerA = await api(`/api/admin/players?id=${encodeURIComponent(pwA.id)}`, adminT, null, "GET", adminH);
const pA = playerA.json?.player || {};
check("S4", "Companion detail effective commission = badge rate (source cert_badge)", pA.commissionEffectiveShareRate === 70 && pA.commissionSource === "cert_badge", { rate: pA.commissionEffectiveShareRate, source: pA.commissionSource, label: pA.commissionSourceLabel });

// ---------------------------------------------------------------- order flow helpers
async function adminOrder(id) {
  const r = await api(`/api/admin/orders?id=${encodeURIComponent(id)}`, adminT, null, "GET", adminH);
  return r.json?.order || {};
}
async function driveToCompletion(orderId, pw, label) {
  const steps = [];
  const status = async () => (await adminOrder(orderId)).status || (await adminOrder(orderId)).dbStatus || "";
  let st = await status();
  for (let i = 0; i < 6 && !["completed", "reviewed"].includes(st); i += 1) {
    let r;
    if (st === "claimed") r = await api("/api/companion", pw.t, { action: "accept_direct_order", id: orderId });
    else if (st === "confirmed") r = await api("/api/companion", pw.t, { action: "start_order", id: orderId });
    else if (st === "in_progress") {
      r = await api("/api/companion", pw.t, { action: "complete_order", id: orderId });
      steps.push({ step: "complete_order", ...brief(r) });
      r = await api("/api/orders", bossT, { action: "confirm_completion", id: orderId });
    } else break;
    steps.push({ st, ...brief(r) });
    st = await status();
  }
  return { status: st, steps };
}
async function directOrder(pw, label) {
  // Same request shape as the boss order page (place_order → server-authoritative price).
  const created = await api("/api/orders", bossT, {
    action: "place_order",
    companionId: pw.id,
    serviceType: "默认服务",
    service: "默认服务",
    game: "默认服务",
    hours: 1,
    quantity: 1,
    gameId: `CB-${label}-${STAMP}`,
    schedule: "20:00 - 21:00",
    startTime: "20:00",
    endTime: "21:00",
    notes: `${TAG} ${label} staging test data`,
    paymentMethod: "catfood",
    idempotencyKey: `cb-${label}-${STAMP}`,
  });
  const o = created.json?.order || {};
  const pay = o.id ? await api("/api/orders", bossT, { action: "pay_order", id: o.id, paymentMethod: "catfood" }) : null;
  const drive = o.id ? await driveToCompletion(o.id, pw, label) : { status: "", steps: [] };
  const final = o.id ? await adminOrder(o.id) : {};
  const row = { id: o.id, orderNo: o.orderNo || o.order_no, create: brief(created), pay: pay && brief(pay), drive, status: final.status, total: final.totalAmount ?? final.total_amount ?? final.amount, companionIncome: final.companionIncome, platformFee: final.platformFee ?? final.platform_fee };
  report.orders[label] = row;
  console.log(`  order ${label}: ${row.orderNo} → ${row.status} total=${row.total} companion=${row.companionIncome}`);
  return row;
}
async function detail(badgeId, range = "all") {
  const r = await cget(`action=detail&id=${encodeURIComponent(badgeId)}&range=${range}`);
  return r.json || {};
}
const orderIn = (d, id) => (d.orders || []).find((o) => o.orderId === id);

// ---------------------------------------------------------------- A1, A2, B1
const wallet0 = await api(`/api/admin/wallet?bossId=${encodeURIComponent(bossL.json?.session?.user?.id || "")}`, adminT, null, "GET", adminH);
report.bossWalletBefore = wallet0.json?.wallet || null;
const A1 = await directOrder(pwA, "A1");
const A2 = await directOrder(pwA, "A2");
const B1 = await directOrder(pwB, "B1");
check("O1", "A1 / A2 / B1 completed through real flow", [A1, A2, B1].every((o) => o.status === "completed"), [A1, A2, B1].map((o) => ({ no: o.orderNo, st: o.status, steps: o.drive.steps.length })));

let dA = await detail(AID);
let dB = await detail(BID);
const fA1 = orderIn(dA, A1.id);
const fA2 = orderIn(dA, A2.id);
const fB1 = orderIn(dB, B1.id);
check("C1", "A1 settled 70/30 from ledger", fA1 && fA1.companionShareRate === 70 && near(fA1.companionIncome, fA1.gross * 0.7) && near(fA1.platformCommission, fA1.gross * 0.3), fA1);
check("C2", "A2 settled 70/30", fA2 && near(fA2.companionIncome, fA2.gross * 0.7), fA2 && { gross: fA2.gross, c: fA2.companionIncome });
check("C3", "B1 settled 80/20", fB1 && fB1.companionShareRate === 80 && near(fB1.companionIncome, fB1.gross * 0.8) && near(fB1.platformCommission, fB1.gross * 0.2), fB1);
check("C4", "Badge A: completed 2, revenue = A1+A2, platform = 30%", dA.kpis?.completedCount === 2 && near(dA.kpis.actualSettled, (fA1?.gross || 0) + (fA2?.gross || 0)) && near(dA.kpis.platformCommission, ((fA1?.gross || 0) + (fA2?.gross || 0)) * 0.3), dA.kpis);
check("C5", "Badge B: completed 1, 80/20", dB.kpis?.completedCount === 1 && near(dB.kpis.companionIncome, (fB1?.gross || 0) * 0.8), dB.kpis);
check("C6", "Members list: PW00077 in A with counts / income / commission", (dA.members || []).some((m) => m.pwCode === "PW00077" && m.completedCount === 2 && m.status === "active"), (dA.members || []).map((m) => ({ pw: m.pwCode, st: m.status, n: m.completedCount, by: m.grantedByName })));
check("C7", "Order rows carry order no / boss / companion / commission badge", !!(fA1 && fA1.orderNo && fA1.pwCode === "PW00077" && fA1.commissionBadgeId === AID && fA1.bossName !== undefined), fA1 && { no: fA1.orderNo, pw: fA1.pwCode, boss: fA1.bossName, badge: fA1.commissionBadgeName });

// ---------------------------------------------------------------- duplicate settlement
const dupC = await api("/api/companion", pwA.t, { action: "complete_order", id: A1.id });
const dupB = await api("/api/orders", bossT, { action: "confirm_completion", id: A1.id });
const dA2 = await detail(AID);
check("D1", "Repeat complete/confirm on settled order: no extra income, counts unchanged", dA2.kpis?.completedCount === 2 && near(dA2.kpis.companionIncome, dA.kpis.companionIncome) && !orderIn(dA2, A1.id)?.duplicateIncomeTx, { dupC: brief(dupC), dupB: brief(dupB), kpis: dA2.kpis });

// ---------------------------------------------------------------- 70 → 75
const rc = await cpost({ action: "set_commission", id: AID, companionShareRate: 75 });
check("R1", "Change badge A 70% → 75% (logged)", rc.status === 200 && rc.json?.oldRate === 70 && rc.json?.newRate === 75, brief(rc));
const A3 = await directOrder(pwA, "A3");
dA = await detail(AID);
const fA3 = orderIn(dA, A3.id);
check("R2", "New order after change settles 75/25", fA3 && fA3.companionShareRate === 75 && near(fA3.companionIncome, fA3.gross * 0.75), fA3 && { gross: fA3.gross, c: fA3.companionIncome, rate: fA3.companionShareRate });
check("R3", "Old orders keep 70% snapshot", orderIn(dA, A1.id)?.companionShareRate === 70 && orderIn(dA, A2.id)?.companionShareRate === 70, { a1: orderIn(dA, A1.id)?.companionShareRate, a2: orderIn(dA, A2.id)?.companionShareRate });
check("R4", "Commission change log has 70 → 75 with operator", (dA.commissionLog || []).some((l) => l.oldRate === 70 && l.newRate === 75 && l.changedByName), dA.commissionLog?.[0]);

// ---------------------------------------------------------------- removal approval
const memberA = (dA.members || []).find((m) => m.pwCode === "PW00077");
const noReason = await cpost({ action: "request_removal", assignmentId: memberA?.id, reason: "" });
const req = await cpost({ action: "request_removal", assignmentId: memberA?.id, reason: `${TAG} 测试取消` });
const dPending = await detail(AID);
const pend = (dPending.members || []).find((m) => m.id === memberA?.id);
check("X1", "Removal needs a reason; request → 待取消 (initiator / time / reason recorded)", noReason.status === 400 && req.status === 200 && pend?.status === "pending_removal" && pend.statusLabel === "待取消" && !!pend.removalRequestedAt && !!pend.removalReason, { noReason: brief(noReason), pend });
const pub = await api("/api/public/companions", null, null, "GET");
const pubA = (pub.json?.companions || []).find((c) => String(c.userId || c.user_id || "") === pwA.id || String(c.id) === pwAProfileId || String(c.companionCode || c.publicId || "") === "PW00077");
const pubHas = JSON.stringify(pubA?.certTags || pubA?.cert_tags || pubA?.badges || []).includes(AID);
check("X2", "While 待取消 the front end still shows the badge (display unchanged)", !pubA || pubHas, { found: !!pubA, pubHas });
check("X3", "While 待取消 the badge still drives commission", (await cget("action=companion&ref=PW00077")).json?.commissionBadge?.badgeId === AID, "");
const appr = await cpost({ action: "approve_removal", assignmentId: memberA?.id });
const dRemoved = await detail(AID);
const rem = (dRemoved.members || []).find((m) => m.id === memberA?.id);
check("X4", "Approve → 已取消 (approver / time recorded)", appr.status === 200 && rem?.status === "removed" && !!rem.removalApprovedAt && !!rem.removalApprovedByName, rem);
const A4 = await directOrder(pwA, "A4");
dA = await detail(AID);
check("H1", "After removal: new order A4 not attributed to A", !orderIn(dA, A4.id), { a4: A4.orderNo });
check("H2", "History stays in A after removal (A1, A2, A3 still counted)", dA.kpis?.completedCount === 3 && !!orderIn(dA, A1.id) && !!orderIn(dA, A3.id), dA.kpis);
const a4Final = await adminOrder(A4.id);
report.orders.A4.settlementRate = a4Final.companionCommissionRateSnapshot ?? null;

// ---------------------------------------------------------------- refunds (B2 partial, B3 full)
const B2 = await directOrder(pwB, "B2");
const B3 = await directOrder(pwB, "B3");
const partialAmt = m2(Number(B2.total || 0) * 0.3);
const rfP = await api("/api/admin/orders", adminT, { action: "refund", id: B2.id, amount: partialAmt, reason: `${TAG} partial` }, "POST", adminH);
const rfF = await api("/api/admin/orders", adminT, { action: "refund", id: B3.id, amount: Number(B3.total || 0), reason: `${TAG} full` }, "POST", adminH);
dB = await detail(BID);
const fB2 = orderIn(dB, B2.id);
const fB3 = orderIn(dB, B3.id);
check("F1", "Partial refund counted at actual settled amount (gross − refund)", fB2 && near(fB2.refund, partialAmt) && near(fB2.actualSettled, fB2.gross - partialAmt) && fB2.effective === true, { rf: brief(rfP), f: fB2 && { gross: fB2.gross, refund: fB2.refund, actual: fB2.actualSettled, c: fB2.companionIncome, p: fB2.platformCommission } });
check("F2", "Partial refund: companion income reduced by clawback, platform = actual − companion", fB2 && fB2.companionIncome < m2(fB2.gross * 0.8) && near(fB2.platformCommission, fB2.actualSettled - fB2.companionIncome), fB2 && { c: fB2.companionIncome, p: fB2.platformCommission });
check("F3", "Full refund not counted as completed revenue; refund recorded", fB3 && fB3.effective === false && near(fB3.refund, fB3.gross), { rf: brief(rfF), f: fB3 && { refund: fB3.refund, effective: fB3.effective, status: fB3.statusLabel } });
check("F4", "Badge B totals: 2 completed (B1, B2), refund = partial + full", dB.kpis?.completedCount === 2 && near(dB.kpis.refundAmount, partialAmt + Number(fB3?.gross || 0)) && dB.kpis.refundedOrders === 2, dB.kpis);

// ---------------------------------------------------------------- multi-companion order
await cpost({ action: "grant", id: AID, companionRef: "PW00077" });
await cpost({ action: "set_primary", id: AID, companionRef: "PW00077" });
const multi = await api("/api/orders", bossT, {
  action: "place_multi_order",
  idempotencyKey: `cb-multi-${STAMP}`,
  paymentMethod: "catfood",
  gameId: `CB-MULTI-${STAMP}`,
  game: "默认服务",
  notes: `${TAG} multi`,
  companions: [
    { companionId: pwA.id, service: "默认服务", hours: 1 },
    { companionId: pwB.id, service: "默认服务", hours: 1 },
  ],
});
const parentId = multi.json?.order?.id || multi.json?.parent?.id || multi.json?.parentOrderId || "";
const payM = parentId ? await api("/api/orders", bossT, { action: "pay_order", id: parentId, paymentMethod: "catfood" }) : null;
const children = (multi.json?.children || multi.json?.childOrders || []).map((c) => ({ id: c.id, companionId: c.companionId || c.companion_id }));
for (const ch of children) {
  const pw = ch.companionId === pwA.id ? pwA : pwB;
  let st = (await adminOrder(ch.id)).status;
  if (st === "claimed") await api("/api/companion", pw.t, { action: "accept_direct_order", id: ch.id });
  st = (await adminOrder(ch.id)).status;
  if (st === "confirmed") await api("/api/companion", pw.t, { action: "start_order", id: ch.id });
  await api("/api/companion", pw.t, { action: "complete_order", id: ch.id });
}
const confM = parentId ? await api("/api/orders", bossT, { action: "confirm_completion", id: parentId }) : null;
report.orders.multi = { parentId, create: brief(multi), pay: payM && brief(payM), confirm: confM && brief(confM), children };
dA = await detail(AID);
dB = await detail(BID);
const chA = children.find((c) => c.companionId === pwA.id);
const chB = children.find((c) => c.companionId === pwB.id);
const fChA = chA && orderIn(dA, chA.id);
const fChB = chB && orderIn(dB, chB.id);
check("G1", "Multi order: each child attributed to its own badge and rate (A 75%, B 80%)", fChA && fChB && fChA.companionShareRate === 75 && fChB.companionShareRate === 80, { create: brief(multi), a: fChA && { gross: fChA.gross, rate: fChA.companionShareRate }, b: fChB && { gross: fChB.gross, rate: fChB.companionShareRate } });
check("G2", "Multi parent never counted", !orderIn(dA, parentId) && !orderIn(dB, parentId), { parentId });

// ---------------------------------------------------------------- overview, filters, export
const ovAll = await cget("action=stats&range=all");
const ovToday = await cget("action=stats&range=today");
const ovMonth = await cget("action=stats&range=month");
const ovWeek = await cget("action=stats&range=week");
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const ovCustom = await cget(`action=stats&range=custom&from=${today}&to=${today}`);
const ovCustomPast = await cget("action=stats&range=custom&from=2020-01-01&to=2020-01-31");
const cardA = (ovAll.json?.badges || []).find((b) => b.id === AID);
const cardAToday = (ovToday.json?.badges || []).find((b) => b.id === AID);
check("K1", "Overview card A: holders / completed / revenue / profit / commission % / status", cardA && cardA.holders === 1 && cardA.completedCount === dA.kpis.completedCount && cardA.companionShareRate === 75 && cardA.enabled === true && cardA.month, cardA);
check("K2", "Date filters: today = month = week = custom(today) for today's orders; past range = 0", cardAToday?.completedCount === cardA?.completedCount && (ovMonth.json?.badges || []).find((b) => b.id === AID)?.completedCount === cardA?.completedCount && (ovWeek.json?.badges || []).find((b) => b.id === AID)?.completedCount === cardA?.completedCount && (ovCustom.json?.badges || []).find((b) => b.id === AID)?.completedCount === cardA?.completedCount && ((ovCustomPast.json?.badges || []).find((b) => b.id === AID)?.completedCount || 0) === 0, { all: cardA?.completedCount, today: cardAToday?.completedCount });
check("K3", "Top KPIs dedupe orders across badges (≤ sum of badge cards)", ovAll.json?.kpis && ovAll.json.kpis.completedCount <= (ovAll.json.badges || []).reduce((n, b) => n + b.completedCount, 0), ovAll.json?.kpis);
check("K4", "Monthly summary present in detail", Array.isArray(dA.monthly) && dA.monthly.length >= 1 && dA.monthly[0].completedCount === dA.kpis.completedCount, dA.monthly?.[0]);
const nowMy = new Date(Date.now() + 8 * 3600 * 1000);
const exA = await cget(`action=export&year=${nowMy.getUTCFullYear()}&month=${nowMy.getUTCMonth() + 1}&id=${encodeURIComponent(AID)}`);
const exAll = await cget(`action=export&year=${nowMy.getUTCFullYear()}&month=${nowMy.getUTCMonth() + 1}`);
fs.writeFileSync(path.join(here, "export-badgeA.csv"), "\ufeff" + (exA.json?.csv || ""));
fs.writeFileSync(path.join(here, "export-all.csv"), "\ufeff" + (exAll.json?.csv || ""));
check("E1", "Monthly export (badge A): summary + order detail rows with PW code / amounts", exA.status === 200 && /勋章名称,持有人数,完成单量/.test(exA.json?.csv || "") && exA.json?.orderCount === dA.orders.length && (exA.json?.csv || "").includes("PW00077"), { file: exA.json?.fileBase, orders: exA.json?.orderCount });
check("E2", "Monthly export (all badges)", exAll.status === 200 && (exAll.json?.summaryCount || 0) >= 2, { file: exAll.json?.fileBase, summary: exAll.json?.summaryCount, orders: exAll.json?.orderCount });

// ---------------------------------------------------------------- permissions
const csTry = await api(`${CERT}?action=stats`, csT, null, "GET");
const bossTry = await api(CERT, bossT, { action: "set_commission", id: AID, companionShareRate: 99 }, "POST");
const compTry = await api(CERT, pwA.t, { action: "grant", id: AID, companionRef: "PW00077" }, "POST");
const anonTry = await api(`${CERT}?action=stats`, null, null, "GET");
check("P1", "CS / boss / companion / anonymous cannot read stats or change commission / grant", [csTry, bossTry, compTry, anonTry].every((r) => r.status === 401 || r.status === 403), [csTry, bossTry, compTry, anonTry].map(brief));
const delTry = await cpost({ action: "delete", id: AID });
check("P2", "Badge with history cannot be deleted (use disable)", delTry.status === 409, brief(delTry));
const badRate = await cpost({ action: "set_commission", id: AID, companionShareRate: 120 });
check("P3", "Invalid commission rate rejected", badRate.status === 400, brief(badRate));

// ---------------------------------------------------------------- four-end consistency (companion wallet sees same income)
const compBoot = await api("/api/companion?action=wallet", pwB.t, null, "GET");
const walletTxt = JSON.stringify(compBoot.json || {});
check("W1", "Companion earnings ledger contains B1 income equal to badge stats", !!fB1 && walletTxt.includes(String(fB1.companionIncome)), { b1: fB1?.companionIncome });

save();

// ---------------------------------------------------------------- screenshots
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
async function adminPage(viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${STG}/admin/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('form[data-admin-login] input[name="account"]').fill(ADMIN.email);
  await page.locator('form[data-admin-login] input[name="password"]').fill(ADMIN.password);
  await page.locator('form[data-admin-login] [type="submit"]').click();
  await page.waitForURL((u) => /\/admin/.test(String(u)) && !/\/admin\/login/.test(String(u)), { timeout: 45000 }).catch(() => {});
  await page.goto(`${STG}/admin/#companion-cert-tags`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#companionCertTagManagement .metric-grid", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}
async function shot(page, name, full = false) {
  const file = path.join(here, name);
  await page.screenshot({ path: file, fullPage: full });
  report.screenshots.push(name);
}
try {
  for (const [label, vp, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
    const page = await adminPage(vp, mobile);
    await page.locator('[data-cert-range="all"]').first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, `${label}-01-overview.png`, true);
    await page.locator(`[data-cert-detail="${AID}"]`).first().click();
    await page.waitForSelector("[data-cert-detail-tab]", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, `${label}-02-detail-members.png`, true);
    await page.locator('[data-cert-detail-tab="orders"]').click();
    await page.waitForTimeout(600);
    await shot(page, `${label}-03-detail-orders.png`, true);
    await page.locator('[data-cert-detail-tab="monthly"]').click();
    await page.waitForTimeout(400);
    await shot(page, `${label}-04-detail-monthly.png`);
    await page.locator('[data-cert-detail-tab="log"]').click();
    await page.waitForTimeout(400);
    await shot(page, `${label}-05-commission-log.png`);
    const text = await page.locator("#companionCertTagManagement").innerText();
    check(`U-${label}`, `Admin UI (${label}) renders KPIs, members, orders, two-decimal money`, /完成单量/.test(text) && /\d+\.\d{2}/.test(text), text.slice(0, 160));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (mobile) check("U-mobile-overflow", "Mobile: page has no horizontal overflow (tables scroll inside their wrapper)", overflow <= 2, { overflow });
    await page.context().close();
  }
  // pending-removal state on mobile: request removal on PW-B in B, screenshot, then reject (restore)
  const dB2 = await detail(BID);
  const memberB = (dB2.members || []).find((m) => m.pwCode === "PW00076" && m.status === "active");
  await cpost({ action: "request_removal", assignmentId: memberB?.id, reason: `${TAG} 截图待取消` });
  const page = await adminPage({ width: 390, height: 844 }, true);
  await page.locator(`[data-cert-detail="${BID}"]`).first().click();
  await page.waitForSelector("[data-cert-detail-tab]", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, "mobile-06-pending-removal.png", true);
  const pendText = await page.locator("#companionCertTagManagement").innerText();
  check("U-pending", "Admin shows 待取消 with approve / reject actions", /待取消/.test(pendText) && /批准取消/.test(pendText) && /驳回/.test(pendText), "");
  await page.context().close();
  const rej = await cpost({ action: "reject_removal", assignmentId: memberB?.id });
  check("X5", "Reject removal → badge active again", rej.status === 200 && rej.json?.assignment?.status === "active", brief(rej));
} finally {
  await browser.close();
}

save();
console.log(`\nTotal ${pass + fail}  PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
