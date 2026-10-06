#!/usr/bin/env node
/**
 * Staging-only acceptance: super-admin badge holder drill-down.
 *
 *   Badge H (70%) → PW00077 + PW00076
 *   PW00077: H1, H2 completed · H3 accepted + in progress · H4 paid, not yet accepted
 *   PW00076: H5 completed
 *   Expect badge: holders 2, 接单 4, 已完成 3; PW00077: 接单 3, 已完成 2, all 4 orders in drill-down.
 *   Filters (badge / holder by UID · 昵称 / date range), four-end consistency vs admin / boss / companion,
 *   admin UI desktop + mobile screenshots.
 *
 * REUSE=1 re-checks the badge + orders recorded in holders/report.json instead of creating new test data.
 * Test data: order notes "[cert-badge-holders-e2e]", badge name starts with "E2E持有人勋章".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "holders");
fs.mkdirSync(OUT, { recursive: true });
// STG_URL: pin the immutable Staging deployment when the shared alias is being re-pointed by another session.
const STG = /^https:\/\/meow-cuijiao-homepage-[a-z0-9]+-ciancianteng-4581s-projects\.vercel\.app$/.test(process.env.STG_URL || "")
  ? process.env.STG_URL
  : "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assertSmokeTargetAllowed({ script: "cert-badge-holders-acceptance", base: STG, supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co` });
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
const ADMIN = { email: "admin@meow.test", password: "McjTest@12345678" };
const STAMP = Date.now();
const TAG = "[cert-badge-holders-e2e]";
const prev = process.env.REUSE === "1" ? JSON.parse(fs.readFileSync(path.join(OUT, "report.json"), "utf8")) : null;

const report = { generated_at: new Date().toISOString(), staging: STG, build, stamp: STAMP, orders: {}, checks: [], screenshots: [] };
let pass = 0;
let fail = 0;
function check(no, name, ok, evidence) {
  if (ok) pass += 1;
  else fail += 1;
  report.checks.push({ no, name, result: ok ? "PASS" : "FAIL", evidence });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${no} ${name} :: ${String(typeof evidence === "string" ? evidence : JSON.stringify(evidence ?? null)).slice(0, 400)}`);
}
function save() {
  report.summary = { total: pass + fail, pass, fail };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
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

const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN.email, password: ADMIN.password })).json);
const bossL = await api("/api/auth", null, { action: "login", email: BOSS_EMAIL, password: ORG_PASS, loginPortal: "boss" });
const bossT = tok(bossL.json);
async function companionLogin(account) {
  const r = await api("/api/companion", null, { action: "login", account, password: ORG_PASS });
  return { t: tok(r.json), id: r.json?.session?.user?.id || "" };
}
const pwA = await companionLogin("organic.invitee.comp@mcj-staging-organic.invalid"); // PW00077
const pwB = await companionLogin("organic.companion@mcj-staging-organic.invalid"); // PW00076
if (!adminT || !bossT || !pwA.t || !pwB.t) {
  console.error("login failed", { admin: !!adminT, boss: !!bossT, pwA: !!pwA.t, pwB: !!pwB.t });
  process.exit(1);
}
const adminH = { "x-mcj-admin-role": "admin" };
const CERT = "/api/admin/companion-cert-tags";
const cget = (q) => api(`${CERT}?${q}`, adminT, null, "GET", adminH);
const cpost = (body) => api(CERT, adminT, body, "POST", adminH);
if (!prev) {
  for (const c of [pwA, pwB]) {
    const pf = await api("/api/companion", c.t, { action: "pending_forced" });
    for (const item of pf.json?.pendingForced || []) {
      await api("/api/companion", c.t, { action: "acknowledge_forced", id: item.id || item.contentId, content_id: item.id || item.contentId });
    }
    await api("/api/companion", c.t, { action: "set_online_status", online_status: "online" });
  }
}

/** Staging alias must keep serving this build (EXPECT_DEPLOY = deployment host) for the whole run. */
async function assertBuild(stage) {
  if (!process.env.EXPECT_DEPLOY) return;
  const b = await fetch(`${STG}/api/build-info?t=${Date.now()}`).then((r) => r.json());
  if (b.url !== process.env.EXPECT_DEPLOY) {
    report.aliasMoved = { stage, serving: b.url, expected: process.env.EXPECT_DEPLOY };
    save();
    console.error(`Staging alias moved during ${stage}: serving ${b.url}, expected ${process.env.EXPECT_DEPLOY}`);
    process.exit(3);
  }
}
await assertBuild("start");

// ---------------------------------------------------------------- badge + holders
let HID;
let BADGE_NAME;
if (prev) {
  HID = prev.badge.id;
  BADGE_NAME = prev.badge.name;
  report.badge = prev.badge;
  report.reusedFrom = prev.reusedFrom || prev.generated_at;
  const view = (await cget(`action=companion&ref=PW00077`)).json;
  const held = (view.assignments || []).some((a) => String(a.tagId) === String(HID) && a.status === "active");
  check("S1", "Reuse badge H from previous run (PW00077 still holds it)", held, { id: HID, name: BADGE_NAME });
} else {
  BADGE_NAME = `E2E持有人勋章-${String(STAMP).slice(-5)}`;
  const created = await cpost({ action: "save", tag: { name: BADGE_NAME, icon: "🏆", color: "#7bd389", sort: 5, enabled: true, companionShareRate: 70, commissionPriority: 1 } });
  HID = created.json?.item?.id;
  const gA = await cpost({ action: "grant", id: HID, companionRef: "PW00077" });
  const gB = await cpost({ action: "grant", id: HID, companionRef: "PW00076" });
  await cpost({ action: "set_primary", id: HID, companionRef: "PW00077" });
  await cpost({ action: "set_primary", id: HID, companionRef: "PW00076" });
  report.badge = { id: HID, name: BADGE_NAME };
  check("S1", "Create badge H 70% and grant PW00077 + PW00076", created.status === 200 && !!HID && gA.status === 200 && gB.status === 200, { created: brief(created), gA: brief(gA), gB: brief(gB) });
}

// ---------------------------------------------------------------- orders
async function adminOrder(id) {
  const r = await api(`/api/admin/orders?id=${encodeURIComponent(id)}`, adminT, null, "GET", adminH);
  return r.json?.order || {};
}
async function drive(orderId, pw, stopAt) {
  const steps = [];
  const status = async () => {
    const o = await adminOrder(orderId);
    return o.status || o.dbStatus || "";
  };
  let st = await status();
  for (let i = 0; i < 6 && st !== stopAt && !["completed", "reviewed"].includes(st); i += 1) {
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
async function order(pw, label, stopAt) {
  const c = await api("/api/orders", bossT, {
    action: "place_order",
    companionId: pw.id,
    serviceType: "默认服务",
    service: "默认服务",
    game: "默认服务",
    hours: 1,
    quantity: 1,
    gameId: `CBH-${label}-${STAMP}`,
    schedule: "20:00 - 21:00",
    startTime: "20:00",
    endTime: "21:00",
    notes: `${TAG} ${label} staging test data`,
    paymentMethod: "catfood",
    idempotencyKey: `cbh-${label}-${STAMP}`,
  });
  const o = c.json?.order || {};
  const pay = o.id ? await api("/api/orders", bossT, { action: "pay_order", id: o.id, paymentMethod: "catfood" }) : null;
  const d = o.id ? await drive(o.id, pw, stopAt) : { status: "", steps: [] };
  const final = o.id ? await adminOrder(o.id) : {};
  const row = {
    id: o.id,
    orderNo: o.orderNo || o.order_no,
    create: brief(c),
    pay: pay && brief(pay),
    steps: d.steps,
    status: final.status,
    total: final.totalAmount ?? final.total_amount ?? final.amount,
    companionIncome: final.companionIncome,
  };
  report.orders[label] = row;
  console.log(`  order ${label}: ${row.orderNo} → ${row.status} total=${row.total}`);
  return row;
}
async function reuse(label) {
  const o = prev.orders[label];
  const final = await adminOrder(o.id);
  const row = { ...o, status: final.status, total: final.totalAmount ?? final.total_amount ?? final.amount, companionIncome: final.companionIncome };
  report.orders[label] = row;
  return row;
}
const H1 = prev ? await reuse("H1") : await order(pwA, "H1");
const H2 = prev ? await reuse("H2") : await order(pwA, "H2");
const H3 = prev ? await reuse("H3") : await order(pwA, "H3", "in_progress");
const H4 = prev ? await reuse("H4") : await order(pwA, "H4", "claimed");
const H5 = prev ? await reuse("H5") : await order(pwB, "H5");
await assertBuild("orders");
check(
  "O1",
  "Orders in mixed states: H1/H2/H5 completed, H3 in progress, H4 waiting for companion",
  [H1, H2, H5].every((o) => o.status === "completed") && H3.status === "in_progress" && H4.status === "claimed",
  [H1, H2, H3, H4, H5].map((o) => `${o.orderNo}:${o.status}`)
);
save();

// ---------------------------------------------------------------- API checks
// Other Staging sessions may also order from PW00077 (it holds H), so badge / holder totals are checked as
// "at least our orders" and our orders' per-order figures are checked exactly.
const sum = (rows, k) => m2(rows.reduce((n, r) => n + Number(r[k] || 0), 0));
const ours = new Set([H1, H2, H3, H4, H5].map((o) => o.id));
const det = (await cget(`action=detail&id=${encodeURIComponent(HID)}&range=all`)).json;
const ourRows = (det.orders || []).filter((o) => ours.has(o.orderId));
const extra = (det.orders || []).filter((o) => !ours.has(o.orderId));
const extraTaken = extra.filter((o) => o.taken).length;
const extraDone = extra.filter((o) => o.effective).length;
report.extraOrders = extra.map((o) => `${o.orderNo}:${o.statusLabel}:${o.pwCode}`);

const ov = (await cget(`action=stats&range=all&id=${encodeURIComponent(HID)}`)).json;
const bH = (ov.badges || [])[0] || {};
check(
  "K1",
  "Badge stats: holders 2, 接单 = 4 + other sessions' taken, 已完成 = 3 + others, 总利润 = sum of order profits",
  (ov.badges || []).length === 1 && bH.holders === 2 && bH.takenCount === 4 + extraTaken && bH.completedCount === 3 + extraDone && near(bH.platformCommission, sum((det.orders || []).filter((o) => o.effective), "platformCommission")),
  { holders: bH.holders, taken: bH.takenCount, takenAmount: bH.takenAmount, completed: bH.completedCount, gross: bH.gross, profit: bH.platformCommission, extraTaken, extraDone }
);
const ourFig = (o) => ourRows.find((r) => r.orderId === o.id) || {};
check(
  "K1b",
  "Our completed orders settled at badge H 70/30 and are credited to H",
  [H1, H2, H5].every((o) => ourFig(o).companionShareRate === 70 && near(ourFig(o).platformCommission, o.total * 0.3) && ourFig(o).commissionBadgeId === HID),
  [H1, H2, H5].map((o) => ({ no: o.orderNo, rate: ourFig(o).companionShareRate, profit: ourFig(o).platformCommission, badge: ourFig(o).commissionBadgeName }))
);

const mA = (det.members || []).find((m) => m.pwCode === "PW00077") || {};
const mB = (det.members || []).find((m) => m.pwCode === "PW00076") || {};
report.holderA = { nickname: mA.nickname, uid: mA.uid, profileId: mA.companionProfileId };
const extraA = extra.filter((o) => o.pwCode === "PW00077");
const allA = (det.orders || []).filter((o) => o.pwCode === "PW00077");
check(
  "K2",
  "Holder row: 昵称 / UID / 徽章名称 / 获得时间 + PW00077 接单 / 已完成 / 接单总金额 / 订单总金额 / 利润 = its orders",
  !!mA.nickname && mA.uid === "PW00077" && mA.badgeName === BADGE_NAME && !!mA.joinedAt && mA.takenCount === 3 + extraA.filter((o) => o.taken).length && mA.completedCount === 2 + extraA.filter((o) => o.effective).length && near(mA.takenAmount, sum(allA.filter((o) => o.taken), "gross")) && near(mA.gross, sum(allA.filter((o) => o.effective), "gross")) && near(mA.platformCommission, sum(allA.filter((o) => o.effective), "platformCommission")),
  { nickname: mA.nickname, uid: mA.uid, badge: mA.badgeName, joinedAt: mA.joinedAt, taken: mA.takenCount, done: mA.completedCount, takenAmount: mA.takenAmount, gross: mA.gross, profit: mA.platformCommission }
);
check("K3", "PW00076 row: 接单 ≥ 1 · 已完成 ≥ 1 (H5)", mB.takenCount >= 1 && mB.completedCount >= 1 && mB.uid === "PW00076", { taken: mB.takenCount, done: mB.completedCount, uid: mB.uid });
check("K4", "Badge order list contains all 5 of our orders (incl. in progress / waiting)", ourRows.length === 5, { ours: ourRows.length, total: (det.orders || []).length });

const hold = (await cget(`action=holder&id=${encodeURIComponent(HID)}&companion=PW00077&range=all`)).json;
const hRows = hold.orders || [];
const byId = (id) => hRows.find((o) => o.orderId === id) || {};
check(
  "K5",
  "Holder drill-down (PW00077): every related order incl. H1–H4 with per-order status",
  hRows.length === allA.length && [H1, H2, H3, H4].every((o) => !!byId(o.id).orderId) && byId(H3.id).statusLabel === "进行中" && byId(H4.id).taken === false && /待陪玩确认/.test(byId(H4.id).statusLabel) && byId(H1.id).effective === true,
  hRows.map((o) => `${o.orderNo}:${o.statusLabel}:taken=${o.taken}`)
);
check("K6", "Holder drill-down KPIs = holder row", hold.kpis?.takenCount === mA.takenCount && hold.kpis?.completedCount === mA.completedCount && near(hold.kpis?.platformCommission, mA.platformCommission), hold.kpis);

const byUid = (await cget(`action=holder&id=${encodeURIComponent(HID)}&companion=${encodeURIComponent(mA.uid)}&range=all`)).json;
const byNick = await cget(`action=holder&id=${encodeURIComponent(HID)}&companion=${encodeURIComponent(mA.nickname)}&range=all`);
check(
  "F1",
  "Holder filter accepts UID and 昵称 (same holder / same orders)",
  byUid.holder?.companionProfileId === mA.companionProfileId && (byUid.orders || []).length === hRows.length && (byNick.status === 409 || byNick.json?.holder?.companionProfileId === mA.companionProfileId),
  { uid: mA.uid, uidOrders: (byUid.orders || []).length, nick: mA.nickname, nickStatus: byNick.status, nickMsg: byNick.json?.message }
);
const ovB = (await cget(`action=stats&range=all&id=${encodeURIComponent(HID)}&companion=PW00076`)).json;
check("F2", "List filter 徽章 + 持有人 PW00076 → only PW00076's figures", (ovB.badges || [])[0]?.takenCount === mB.takenCount && (ovB.badges || [])[0]?.completedCount === mB.completedCount && ovB.filters?.companion?.pwCode === "PW00076", { b: (ovB.badges || [])[0] && { taken: ovB.badges[0].takenCount, done: ovB.badges[0].completedCount }, f: ovB.filters });
const detA = (await cget(`action=detail&id=${encodeURIComponent(HID)}&range=all&companion=PW00077`)).json;
check(
  "F3",
  "Badge detail holder filter → only PW00077 member + orders",
  (detA.members || []).length === 1 && (detA.orders || []).every((o) => o.pwCode === "PW00077") && (detA.orders || []).length === allA.length && (detA.holderOptions || []).length >= 2,
  { members: (detA.members || []).length, orders: (detA.orders || []).length, options: (detA.holderOptions || []).length }
);
const myDate = (d) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const created = myDate(new Date(ourFig(H1).createdAt || Date.now()));
const before = myDate(new Date(new Date(`${created}T00:00:00+08:00`).getTime() - 86400000));
const ovDay = (await cget(`action=stats&range=custom&from=${created}&to=${created}&id=${encodeURIComponent(HID)}`)).json;
const ovBefore = (await cget(`action=stats&range=custom&from=${before}&to=${before}&id=${encodeURIComponent(HID)}`)).json;
check(
  "F4",
  "Date range filter: order day includes our orders; the day before = 0",
  ovDay.badges?.[0]?.takenCount >= 4 && ovDay.badges?.[0]?.completedCount >= 3 && ovBefore.badges?.[0]?.takenCount === 0 && ovBefore.badges?.[0]?.completedCount === 0,
  { day: created, before, d: ovDay.badges?.[0] && [ovDay.badges[0].takenCount, ovDay.badges[0].completedCount], b: ovBefore.badges?.[0] && [ovBefore.badges[0].takenCount, ovBefore.badges[0].completedCount] }
);
const consistent = [H1, H2, H5].map((o) => {
  const f = ourFig(o);
  return { no: o.orderNo, orderTotal: o.total, statsGross: f.gross, orderIncome: o.companionIncome, statsIncome: f.companionIncome };
});
check("C1", "Four-end source: stats amounts = admin order totals / companion income", consistent.every((c) => near(c.orderTotal, c.statsGross) && (c.orderIncome == null || near(c.orderIncome, c.statsIncome))), consistent);
const bossOrders = await api("/api/orders", bossT, null, "GET");
const bossSeen = (bossOrders.json?.orders || []).filter((o) => ours.has(o.id)).map((o) => `${o.orderNo || o.order_no}:${o.status}`);
check("C2", "Boss end sees the same 5 orders (same status as stats)", bossSeen.length === 5, bossSeen);
const compBoot = await api("/api/companion?action=bootstrap", pwA.t, null, "GET");
const compTxt = JSON.stringify(compBoot.json || {});
const compSeen = [H1, H2, H3].filter((h) => compTxt.includes(h.id) || compTxt.includes(h.orderNo)).map((h) => h.orderNo);
report.consistency = { bossSeen, compSeen, compStatus: compBoot.status };
check("C3", "Companion end (PW00077 workbench) sees its taken orders H1–H3", compSeen.length === 3, { compSeen, status: compBoot.status });
save();
await assertBuild("api-checks");

// ---------------------------------------------------------------- admin UI (desktop + mobile)
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
  await page.waitForSelector("#companionCertTagManagement [data-cert-filter-tag]", { timeout: 45000 });
  await page.waitForTimeout(1200);
  return page;
}
const root = "#companionCertTagManagement";
async function shot(page, name, full = true) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: full });
  report.screenshots.push(`holders/${name}`);
}
async function settle(page, ms = 1500) {
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .content-loading`), root, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
try {
  for (const [label, vp, mobile] of [
    ["desktop", { width: 1440, height: 900 }, false],
    ["mobile", { width: 390, height: 844 }, true],
  ]) {
    const page = await adminPage(vp, mobile);
    const scriptSrc = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("admin-companion-cert-tags")) || "");
    check(`U0-${label}`, `Staging serves the new badge admin script (${label})`, /certHolders3/.test(scriptSrc), scriptSrc);
    await page.locator('[data-cert-range="all"]').first().click();
    await page.selectOption(`${root} [data-cert-filter-tag]`, HID);
    await settle(page, 2500);
    await shot(page, `${label}-01-list-badge-filter.png`);
    const listText = await page.locator(root).innerText();
    check(`U1-${label}`, `List: badge card shows 持有人数 / 接单数量 / 已完成订单 / 订单总金额 / 总利润 (${label})`, ["持有人数", "接单数量", "已完成订单", "订单总金额", "总利润", BADGE_NAME].every((s) => listText.includes(s)), "");
    const cardCount = await page.locator(`${root} .panel[data-cert-detail]`).count();
    check(`U1b-${label}`, `List badge filter → exactly 1 badge card and KPIs scoped to 1 badge (${label})`, cardCount === 1 && listText.includes("1 个勋章"), { cardCount });

    await page.locator(`${root} .panel[data-cert-detail="${HID}"]`).first().click();
    await page.waitForSelector(`${root} [data-cert-detail-tab]`, { timeout: 30000 });
    await settle(page);
    await shot(page, `${label}-02-detail-holders.png`);
    const detText = await page.locator(root).innerText();
    check(`U2-${label}`, `Detail: holder list with 昵称 / UID / 徽章名称 / 获得徽章时间 / 接单 / 已完成 / 金额 / 利润 (${label})`, ["PW00077", "PW00076", "UID", "获得徽章时间", "接单数量", "已完成订单", "接单总金额", "接单总利润", BADGE_NAME].every((s) => detText.includes(s)), "");
    if (mobile) {
      const vis = await page.evaluate((sel) => {
        const cards = document.querySelector(`${sel} .capp-mobile-cards`);
        const table = document.querySelector(`${sel} .capp-table-wrap`);
        return { cards: cards ? getComputedStyle(cards).display : "none", table: table ? getComputedStyle(table).display : "none" };
      }, root);
      check("U-mobile-cards", "Mobile: holder list renders as cards (table hidden)", vis.cards !== "none" && vis.table === "none", vis);
    }

    await page.locator(`${root} [data-cert-holder="${mA.companionProfileId}"] >> visible=true`).first().click();
    await page.waitForSelector(`${root} [data-cert-holder-back]`, { timeout: 30000 });
    await settle(page);
    await shot(page, `${label}-03-holder-orders.png`);
    const holdText = await page.locator(root).innerText();
    check(`U3-${label}`, `Holder page: all PW00077 orders listed with KPIs (${label})`, [H1, H2, H3, H4].every((o) => holdText.includes(o.orderNo)) && holdText.includes("进行中") && holdText.includes("待陪玩确认") && holdText.includes("获得徽章时间"), "");

    await page.locator(`${root} [data-cert-order-filter="open"]`).first().click();
    await page.waitForTimeout(500);
    await shot(page, `${label}-04-holder-orders-unfinished.png`);
    const openText = await page.locator(root).innerText();
    check(`U4-${label}`, `Holder order filter 未完成 → H3 + H4, not completed H1 (${label})`, openText.includes(H3.orderNo) && openText.includes(H4.orderNo) && !openText.includes(H1.orderNo), "");
    if (mobile) check("U-mobile-overflow-holder", "Mobile holder page: no horizontal overflow", (await overflow(page)) <= 2, { overflow: await overflow(page) });

    await page.locator(`${root} [data-cert-holder-back]`).click();
    await page.waitForSelector(`${root} [data-cert-detail-tab]`, { timeout: 30000 });
    await settle(page);
    await page.locator(`${root} [data-cert-detail-tab="orders"]`).click();
    await page.waitForTimeout(500);
    await shot(page, `${label}-05-detail-all-orders.png`);
    const ordText = await page.locator(root).innerText();
    check(`U5-${label}`, `Detail 订单明细 tab: all 5 of our badge orders (${label})`, [H1, H2, H3, H4, H5].every((o) => ordText.includes(o.orderNo)), "");

    await page.selectOption(`${root} [data-cert-detail-holder]`, mB.companionProfileId);
    await settle(page);
    await page.locator(`${root} [data-cert-detail-tab="members"]`).click().catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, `${label}-06-detail-holder-filter.png`);
    const fText = await page.locator(root).innerText();
    const visRows =
      (await page.locator(`${root} .capp-table-wrap tbody tr >> visible=true`).count()) + (await page.locator(`${root} .capp-mobile-cards .capp-card >> visible=true`).count());
    check(`U6-${label}`, `Detail holder filter PW00076 → exactly 1 holder row (${label})`, visRows === 1 && fText.includes("PW00076"), { visRows });
    if (mobile) check("U-mobile-overflow-detail", "Mobile detail page: no horizontal overflow", (await overflow(page)) <= 2, { overflow: await overflow(page) });

    await page.locator(`${root} [data-cert-back]`).click();
    await settle(page);
    await page.fill(`${root} [data-cert-filter-companion]`, "PW00077");
    await page.locator(`${root} [data-cert-filter-apply]`).click();
    await settle(page);
    await shot(page, `${label}-07-list-holder-filter.png`);
    const lText = await page.locator(root).innerText();
    check(`U7-${label}`, `List holder filter PW00077 → 当前陪玩 banner + 查看该陪玩全部订单 (${label})`, lText.includes("当前陪玩") && lText.includes("PW00077") && lText.includes("查看该陪玩全部订单"), "");
    if (mobile) check("U-mobile-overflow-list", "Mobile list page: no horizontal overflow", (await overflow(page)) <= 2, { overflow: await overflow(page) });
    await page.context().close();
    await assertBuild(`ui-${label}`);
  }
} finally {
  await browser.close();
}

save();
console.log(`\nTotal ${pass + fail}  PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
