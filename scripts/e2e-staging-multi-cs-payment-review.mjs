#!/usr/bin/env node
/**
 * P0: multi-order payment must go CS review BEFORE waiting_companion.
 * Staging only. Cases 1–5 with screenshots + DB/API evidence.
 * source=cursor_acceptance
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-cs-payment-review");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SOURCE = "cursor_acceptance";

assertSmokeTargetAllowed({
  script: "e2e-staging-multi-cs-payment-review",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const organic = JSON.parse(
  fs.readFileSync(path.join(root, "artifacts/go-live-organic/organic-accounts.json"), "utf8")
);
const PASS = organic.password;
const bossEmail = "organic.invitee.boss@mcj-staging-organic.invalid";
const compAEmail = "organic.companion@mcj-staging-organic.invalid";
const compBEmail = "organic.invitee.comp@mcj-staging-organic.invalid";
const CS_CANDIDATES = [
  { account: process.env.E2E_CS_ACCOUNT || "service@meow.test", password: process.env.E2E_CS_PASSWORD || "McjTest@12345678" },
  { account: "service@meow.test", password: PASS },
  { account: "service.final.1785714993009@meow.test", password: "McjTest@12345678" },
];
const ADMIN_CANDIDATES = [
  { email: "admin@meow.test", password: process.env.E2E_ADMIN_PASSWORD || "McjTest@12345678" },
  { email: "admin@meow.test", password: PASS },
];
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const report = {
  generated_at: new Date().toISOString(),
  staging: STG,
  source: SOURCE,
  root_cause:
    "Multi pay_order reused wallet instant-success → claimed + companion notify, skipping CS review.",
  files: [
    "server/api/orders.js",
    "server/api/customer-service.js",
    "server/api/_payment-receipts.js",
    "server/api/_place-multi-order.js",
    "src/payment-confirm.js",
    "orders.html",
  ],
  cases: [],
  summary: { PASS: 0, FAIL: 0, BLOCKED: 0 },
};

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function add(test, result, evidence, screenshot, dbApi, notes = "") {
  const row = {
    TEST: test,
    RESULT: result,
    EVIDENCE: String(evidence || "").slice(0, 800),
    SCREENSHOT: screenshot || "—",
    "DB/API": String(dbApi || "").slice(0, 1200),
    NOTES: notes,
  };
  report.cases.push(row);
  report.summary[result] = (report.summary[result] || 0) + 1;
  console.log(`[${result}] ${test} :: ${evidence}`);
  return result === "PASS";
}

async function api(pathname, token, body, method = "POST", extra = {}) {
  const res = await fetch(`${STG}${pathname}`, {
    method: body == null && method === "GET" ? "GET" : method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, json: await res.json().catch(() => ({})) };
}

async function loginBoss(email) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" });
  const token = r.json?.session?.accessToken || r.json?.session?.access_token || "";
  const user = r.json?.session?.user || r.json?.user || {};
  if (!token) throw new Error(`boss login fail: ${r.json?.message || r.status}`);
  return { token, user, id: user.id || "" };
}

async function loginComp(email) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role: "companion" });
  const token = r.json?.session?.accessToken || r.json?.session?.access_token || "";
  const user = r.json?.session?.user || r.json?.user || {};
  if (!token) throw new Error(`comp login fail ${email}: ${r.json?.message || r.status}`);
  return { token, user, id: user.id || "" };
}

async function loginAdmin() {
  for (const c of ADMIN_CANDIDATES) {
    const r = await api("/api/auth", null, { action: "login", email: c.email, password: c.password, role: "admin" });
    const token = r.json?.session?.accessToken || r.json?.session?.access_token || r.json?.session?.token || "";
    if (token) return { token, email: c.email };
  }
  return null;
}

async function ensureBossFunds(admin, bossId, need = 200) {
  if (!admin?.token || !bossId) return { ok: false };
  const grant = await api(
    "/api/admin/wallet",
    admin.token,
    {
      action: "grant",
      bossId,
      amount: need,
      balanceType: "paid",
      grantType: "manual",
      reason: "cursor_acceptance multi cs-review topup",
      idempotencyKey: `cursor_acceptance-topup:${bossId}:${Date.now()}`,
    },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  return { ok: grant.status < 300 && grant.json?.ok !== false, message: grant.json?.message, status: grant.status };
}

async function bal(token) {
  const w = await api("/api/recharge", token, null, "GET");
  const wallet = w.json?.wallet || {};
  const summary = w.json?.summary || {};
  return {
    total: money(summary.balance ?? wallet.totalBalance ?? 0),
    available: money(wallet.availableBalance ?? summary.paidBalance ?? wallet.paidBalance ?? 0),
    held: money(wallet.heldBalance ?? 0),
  };
}

async function loginCs() {
  for (const c of CS_CANDIDATES) {
    const r = await api("/api/customer-service", null, { action: "login", account: c.account, password: c.password });
    const token =
      r.json?.session?.token ||
      r.json?.session?.accessToken ||
      r.json?.session?.access_token ||
      r.json?.accessToken ||
      r.json?.token ||
      "";
    if (token) {
      return {
        token,
        account: c.account,
        profile: r.json?.session?.user || r.json?.profile || r.json?.user || {},
      };
    }
    console.warn("CS login miss", c.account, r.status, r.json?.message || "");
  }
  // Fallback: /api/auth customer_service portal
  for (const c of CS_CANDIDATES) {
    const r = await api("/api/auth", null, {
      action: "login",
      email: c.account,
      password: c.password,
      role: "customer_service",
    });
    const token = r.json?.session?.accessToken || r.json?.session?.access_token || r.json?.session?.token || "";
    if (token) {
      return { token, account: c.account, profile: r.json?.session?.user || r.json?.user || {} };
    }
  }
  return null;
}

function livePrice(c) {
  const svc = Array.isArray(c?.services) && c.services[0];
  return money(svc?.price ?? svc?.unitPrice ?? c?.price ?? c?.minPrice ?? 0) || 20;
}

async function shot(page, name) {
  const file = path.join(shotDir, name);
  await page.screenshot({ path: file, fullPage: true });
  return `screenshots/${name}`;
}

async function injectBoss(page, boss) {
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("customerUser", JSON.stringify(Object.assign({}, user, { role: "boss" })));
      localStorage.setItem("mcjRole", "boss");
    },
    { token: boss.token, user: boss.user }
  );
}

async function injectCs(page, cs) {
  await page.addInitScript(
    ({ token, profile }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjCsToken", token);
      localStorage.setItem("mcjRole", "customer_service");
      localStorage.setItem("customerServiceUser", JSON.stringify(profile || { role: "customer_service" }));
    },
    { token: cs.token, profile: cs.profile }
  );
}

async function injectComp(page, comp) {
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("companionUser", JSON.stringify(Object.assign({}, user, { role: "companion" })));
      localStorage.setItem("mcjRole", "companion");
    },
    { token: comp.token, user: comp.user }
  );
}

async function getBossOrder(bossT, id) {
  const list = await api("/api/orders", bossT, null, "GET");
  const orders = Array.isArray(list.json?.orders) ? list.json.orders : [];
  return orders.find((o) => String(o.id) === String(id)) || null;
}

async function childrenOf(bossT, parentId) {
  const list = await api("/api/orders", bossT, null, "GET");
  const orders = Array.isArray(list.json?.orders) ? list.json.orders : [];
  return orders.filter((o) => String(o.parentOrderId || o.parent_order_id || "") === String(parentId));
}

async function companionInboxHasOrder(compT, orderId) {
  const r = await api("/api/companion", compT, { action: "my_orders" });
  const orders = r.json?.orders || r.json?.list || [];
  return orders.some((o) => String(o.id) === String(orderId) || String(o.parentOrderId || o.parent_order_id || "") === String(orderId));
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const boss = await loginBoss(bossEmail);
  const compA = await loginComp(compAEmail);
  const compB = await loginComp(compBEmail);
  await api("/api/companion", compA.token, { action: "set_online_status", online_status: "online" });
  await api("/api/companion", compB.token, { action: "set_online_status", online_status: "online" });
  const cs = await loginCs();
  if (!cs) {
    add("CS_login", "BLOCKED", "No staging CS credentials worked", "—", "", "Need service@meow.test");
    throw new Error("CS login blocked");
  }
  add("CS_login", "PASS", `logged in as ${cs.account}`, "—", JSON.stringify({ account: cs.account }));

  const admin = await loginAdmin();
  const bal0 = await bal(boss.token);
  if (bal0.available < 120) {
    const topped = await ensureBossFunds(admin, boss.id || boss.user?.id, 300);
    add(
      "BOSS_TOPUP",
      topped.ok ? "PASS" : "FAIL",
      `avail0=${bal0.available} grant=${topped.message || topped.status}`,
      "—",
      JSON.stringify({ bal0, topped })
    );
  } else {
    add("BOSS_TOPUP", "PASS", `avail=${bal0.available} held=${bal0.held}`, "—", JSON.stringify(bal0));
  }

  const pubs = await api("/api/public/companions", null, null, "GET");
  const comps = pubs.json?.companions || [];
  const idA = compA.id;
  const idB = compB.id;
  const pubA = comps.find((c) => String(c.id) === String(idA)) || comps[0];
  const pubB = comps.find((c) => String(c.id) === String(idB)) || comps.find((c) => String(c.id) !== String(idA));
  const priceA = livePrice(pubA) || 20;
  const priceB = livePrice(pubB) || 20;

  // ─── CASE 1: submit payment → pending CS review ───
  const stamp1 = Date.now();
  const place1 = await api("/api/orders", boss.token, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-CSR-${stamp1}`,
    serviceType: "王者荣耀",
    paymentMethod: "catfood",
    notes: `${SOURCE} multi-cs-review`,
    idempotencyKey: `${SOURCE}-multi-cs-${stamp1}`,
    companions: [
      { companionId: idA, unitPrice: priceA, hours: 1, amount: priceA, serviceName: "王者荣耀" },
      { companionId: idB, unitPrice: priceB, hours: 1, amount: priceB, serviceName: "王者荣耀" },
    ],
  });
  const parent1 = place1.json?.order;
  if (!parent1?.id) throw new Error("place_multi failed: " + JSON.stringify(place1.json).slice(0, 300));

  const pay1 = await api("/api/orders", boss.token, {
    action: "pay_order",
    id: parent1.id,
    paymentMethod: "catfood",
  });
  const afterPay = pay1.json?.order || {};
  const kids1 = await childrenOf(boss.token, parent1.id);
  const parentAfter = await getBossOrder(boss.token, parent1.id);
  const reviewOk =
    pay1.status < 300 &&
    pay1.json?.paymentReview === true &&
    String(afterPay.status || parentAfter?.status) === "awaiting_payment" &&
    (afterPay.paymentReview || /待客服|待人工/.test(String(afterPay.statusText || afterPay.paymentStatus || ""))) &&
    kids1.every((k) => String(k.status) === "awaiting_payment");

  const pageBoss1 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectBoss(pageBoss1, boss);
  await pageBoss1.goto(`${STG}/orders.html?filter=payment_review&id=${encodeURIComponent(parent1.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await pageBoss1.waitForTimeout(2500);
  const bossText1 = await pageBoss1.locator("body").innerText();
  const shot1 = await shot(pageBoss1, "01-boss-pending-cs-review.png");
  // Soften CASE1: require order detail status text, not just tab label presence
  const detailStatus = await pageBoss1.locator(".od-status, .order-status, [data-order-status], .pay-status").first().textContent().catch(() => "");
  const bossDetailOk =
    (/订单状态\s*待客服审核|付款状态\s*待客服审核|订单状态\s*待人工审核|付款状态\s*待人工审核/.test(bossText1.replace(/\s+/g, " ")) ||
      /待客服审核|待人工审核/.test(String(detailStatus || ""))) &&
    !/订单已付款，正在等待陪玩确认/.test(bossText1) &&
    !/订单状态\s*等待陪玩确认/.test(bossText1.replace(/\s+/g, " "));

  const pageComp1 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectComp(pageComp1, compA);
  await pageComp1.goto(`${STG}/companion/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageComp1.waitForTimeout(2500);
  const shot2 = await shot(pageComp1, "02-companion-no-claimable-before-cs.png");
  const inboxBefore = await companionInboxHasOrder(compA.token, parent1.id);
  const kidsClaimable = kids1.some((k) => String(k.status) === "claimed");

  add(
    "CASE1_submit_then_pending_cs_review",
    reviewOk && bossDetailOk && !kidsClaimable && !inboxBefore ? "PASS" : "FAIL",
    `payReview=${pay1.json?.paymentReview} parent=${afterPay.status || parentAfter?.status} kids=${kids1.map((k) => k.status).join(",")}`,
    shot1,
    JSON.stringify({
      parentBeforeApproval: {
        id: parent1.id,
        orderNo: parent1.orderNo || parent1.order_no,
        status: afterPay.status || parentAfter?.status,
        paymentReview: afterPay.paymentReview || parentAfter?.paymentReview,
        paidAt: afterPay.paidAt || parentAfter?.paidAt || null,
      },
      childrenBeforeApproval: kids1.map((k) => ({
        id: k.id,
        orderNo: k.orderNo || k.order_no,
        status: k.status,
        companionId: k.companionId || k.companion_id,
      })),
      payMessage: pay1.json?.message,
      companionInboxHasOrder: inboxBefore,
      bossUiSnippet: bossText1.replace(/\s+/g, " ").slice(0, 280),
    }),
    kidsClaimable || inboxBefore ? "companion wrongly notified/claimable" : ""
  );
  add(
    "CASE1_boss_ui_pending_cs",
    bossDetailOk ? "PASS" : "FAIL",
    bossDetailOk ? "Boss order detail shows 待客服审核" : "Boss UI missing 待客服审核 on order",
    shot1,
    bossText1.replace(/\s+/g, " ").slice(0, 400)
  );
  add(
    "CASE1_companion_no_order_before_approve",
    !inboxBefore && !kidsClaimable ? "PASS" : "FAIL",
    `inbox=${inboxBefore} kidsClaimable=${kidsClaimable}`,
    shot2,
    JSON.stringify({ kids: kids1.map((k) => k.status) })
  );

  // ─── CASE 4: refresh still pending review ───
  await pageBoss1.reload({ waitUntil: "domcontentloaded" });
  await pageBoss1.waitForTimeout(2000);
  const bossTextRefresh = await pageBoss1.locator("body").innerText();
  const parentRefresh = await getBossOrder(boss.token, parent1.id);
  const shot4 = await shot(pageBoss1, "04-boss-refresh-still-pending-cs.png");
  add(
    "CASE4_refresh_still_pending_cs",
    parentRefresh?.status === "awaiting_payment" &&
      (parentRefresh.paymentReview || /待客服|待人工/.test(String(parentRefresh.statusText || parentRefresh.paymentStatus || ""))) &&
      /待客服审核|待人工审核|等待客服/.test(bossTextRefresh)
      ? "PASS"
      : "FAIL",
    `status=${parentRefresh?.status} review=${parentRefresh?.paymentReview}`,
    shot4,
    JSON.stringify({ parent: parentRefresh?.status, paymentStatus: parentRefresh?.paymentStatus })
  );

  // ─── CASE 5: repeat pay_order must not claim / double ledger ───
  const payRetry = await api("/api/orders", boss.token, {
    action: "pay_order",
    id: parent1.id,
    paymentMethod: "catfood",
  });
  const afterRetry = payRetry.json?.order || {};
  const kidsRetry = await childrenOf(boss.token, parent1.id);
  add(
    "CASE5_repeat_submit_no_bypass",
    String(afterRetry.status || "") === "awaiting_payment" &&
      kidsRetry.every((k) => String(k.status) === "awaiting_payment") &&
      String(afterRetry.status) !== "claimed"
      ? "PASS"
      : "FAIL",
    `retry status=${afterRetry.status} msg=${payRetry.json?.message}`,
    "—",
    JSON.stringify({ payRetry: payRetry.json?.message, kids: kidsRetry.map((k) => k.status) })
  );

  // ─── CASE 2: CS APPROVE → 0/2 ───
  const pageCs = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await injectCs(pageCs, cs);
  await pageCs.goto(`${STG}/customer-service/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageCs.waitForTimeout(3000);
  const shot3 = await shot(pageCs, "03-cs-dashboard-before-approve.png");

  const approve = await api("/api/customer-service", cs.token, {
    action: "confirm_payment",
    id: parent1.id,
  });
  const shot4b = await shot(pageCs, "04b-cs-after-approve-api.png");
  await pageCs.waitForTimeout(500);

  const parentApproved = await getBossOrder(boss.token, parent1.id);
  const kidsApproved = await childrenOf(boss.token, parent1.id);
  const approveOk =
    approve.status < 300 &&
    approve.json?.ok !== false &&
    String(parentApproved?.status) === "claimed" &&
    kidsApproved.filter((k) => String(k.status) === "claimed").length >= 2;

  const pageBoss2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectBoss(pageBoss2, boss);
  await pageBoss2.goto(`${STG}/orders.html?filter=waiting_companion&id=${encodeURIComponent(parent1.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await pageBoss2.waitForTimeout(2500);
  const bossText2 = await pageBoss2.locator("body").innerText();
  const shot5 = await shot(pageBoss2, "05-boss-waiting-0of2-after-cs-approve.png");
  const waitingUi = /等待陪玩确认/.test(bossText2);

  const pageComp2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectComp(pageComp2, compA);
  await pageComp2.goto(`${STG}/companion/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageComp2.waitForTimeout(2500);
  const shot6 = await shot(pageComp2, "06-companion-sees-order-after-cs-approve.png");
  const inboxAfter = await companionInboxHasOrder(compA.token, parent1.id);

  add(
    "CASE2_cs_approve_then_waiting_0of2",
    approveOk && waitingUi ? "PASS" : "FAIL",
    `approve=${approve.status} parent=${parentApproved?.status} kids=${kidsApproved.map((k) => k.status).join(",")}`,
    shot5,
    JSON.stringify({
      approveMessage: approve.json?.message,
      parentAfterApproval: {
        id: parent1.id,
        status: parentApproved?.status,
        paidAt: parentApproved?.paidAt || parentApproved?.paid_at,
      },
      childrenAfterApproval: kidsApproved.map((k) => ({
        id: k.id,
        status: k.status,
        companionId: k.companionId || k.companion_id,
      })),
      path: approve.json?.path,
      csShot: shot3,
      apiShot: shot4b,
    }),
    approve.json?.message || ""
  );
  add(
    "CASE2_companion_receives_after_approve",
    inboxAfter || kidsApproved.some((k) => String(k.companionId || k.companion_id) === String(idA) && k.status === "claimed")
      ? "PASS"
      : "FAIL",
    `inboxAfter=${inboxAfter}`,
    shot6,
    JSON.stringify({ kidsApproved: kidsApproved.map((k) => ({ id: k.id, st: k.status, cid: k.companionId || k.companion_id })) })
  );

  // ─── CASE 3: CS REJECT path on a fresh multi order ───
  const stamp3 = Date.now() + 7;
  const place3 = await api("/api/orders", boss.token, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-CSR-REJ-${stamp3}`,
    serviceType: "王者荣耀",
    paymentMethod: "catfood",
    notes: `${SOURCE} multi-cs-reject`,
    idempotencyKey: `${SOURCE}-multi-cs-rej-${stamp3}`,
    companions: [
      { companionId: idA, unitPrice: priceA, hours: 1, amount: priceA, serviceName: "王者荣耀" },
      { companionId: idB, unitPrice: priceB, hours: 1, amount: priceB, serviceName: "王者荣耀" },
    ],
  });
  const parent3 = place3.json?.order;
  const pay3 = await api("/api/orders", boss.token, {
    action: "pay_order",
    id: parent3.id,
    paymentMethod: "catfood",
  });
  const reject = await api("/api/customer-service", cs.token, {
    action: "reject_payment_proof",
    id: parent3.id,
    reason: "cursor_acceptance reject test — please resubmit",
  });
  const parentRej = await getBossOrder(boss.token, parent3.id);
  const kidsRej = await childrenOf(boss.token, parent3.id);
  const inboxRej = await companionInboxHasOrder(compA.token, parent3.id);
  const rejectOk =
    reject.status < 300 &&
    String(parentRej?.status) === "awaiting_payment" &&
    kidsRej.every((k) => String(k.status) === "awaiting_payment") &&
    !inboxRej;

  const pageBoss3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectBoss(pageBoss3, boss);
  await pageBoss3.goto(`${STG}/orders.html?id=${encodeURIComponent(parent3.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await pageBoss3.waitForTimeout(2000);
  const shot7 = await shot(pageBoss3, "07-boss-after-cs-reject.png");

  add(
    "CASE3_cs_reject_no_waiting_companion",
    rejectOk ? "PASS" : "FAIL",
    `reject=${reject.status} parent=${parentRej?.status} msg=${reject.json?.message}`,
    shot7,
    JSON.stringify({
      pay3: pay3.json?.paymentReview,
      parent: parentRej?.status,
      kids: kidsRej.map((k) => k.status),
      inboxRej,
      rejectMessage: reject.json?.message,
    })
  );

  // resubmit after reject
  const resubmit = await api("/api/orders", boss.token, {
    action: "pay_order",
    id: parent3.id,
    paymentMethod: "catfood",
  });
  add(
    "CASE3_resubmit_after_reject",
    resubmit.status < 300 && resubmit.json?.paymentReview === true && String(resubmit.json?.order?.status) === "awaiting_payment"
      ? "PASS"
      : "FAIL",
    `resubmit=${resubmit.status} review=${resubmit.json?.paymentReview}`,
    "—",
    JSON.stringify({ message: resubmit.json?.message, status: resubmit.json?.order?.status })
  );

  await pageBoss1.close().catch(() => {});
  await pageBoss2.close().catch(() => {});
  await pageBoss3.close().catch(() => {});
  await pageComp1.close().catch(() => {});
  await pageComp2.close().catch(() => {});
  await pageCs.close().catch(() => {});
} catch (err) {
  add("RUN_ERROR", "FAIL", String(err?.message || err), "—", "");
  console.error(err);
} finally {
  await browser.close().catch(() => {});
}

const md = [
  `# P0 Multi CS Payment Review — Staging Evidence`,
  ``,
  `Generated: ${report.generated_at}`,
  `Staging: ${report.staging}`,
  `Summary: PASS=${report.summary.PASS} FAIL=${report.summary.FAIL} BLOCKED=${report.summary.BLOCKED}`,
  ``,
  `## Root cause`,
  report.root_cause,
  ``,
  `## Files`,
  ...report.files.map((f) => `- ${f}`),
  ``,
  `| TEST | RESULT | EVIDENCE | SCREENSHOT |`,
  `|---|---|---|---|`,
  ...report.cases.map(
    (c) => `| ${c.TEST} | **${c.RESULT}** | ${String(c.EVIDENCE).replace(/\|/g, "/")} | ${c.SCREENSHOT} |`
  ),
  ``,
].join("\n");

fs.writeFileSync(path.join(outDir, "EVIDENCE.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "REPORT.md"), md);
console.log("\nWrote", path.join(outDir, "EVIDENCE.json"));
console.log("Summary", report.summary);
process.exit(report.summary.FAIL > 0 || report.summary.BLOCKED > 0 ? 1 : 0);
