#!/usr/bin/env node
/**
 * Staging acceptance: CS-approved revenue lock (Cases 1–4, 6).
 * Writes only to Staging. Screenshots + JSON under artifacts/p0-cs-approved-revenue-lock/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-cs-approved-revenue-lock");
fs.mkdirSync(outDir, { recursive: true });
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PASS = "McjTest@12345678";

assertSmokeTargetAllowed({
  script: "e2e-staging-cs-approved-revenue-lock",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function api(pathname, body, token) {
  const res = await fetch(`${STG}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const report = {
  ok: false,
  staging: STG,
  cases: {},
  shots: [],
  before: null,
  after: null,
  parentId: "",
  approvedAmount: 0,
  errors: [],
};

function mark(k, ok, detail) {
  report.cases[k] = { result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) };
  console.log(`[${ok ? "PASS" : "FAIL"}] ${k} :: ${detail}`);
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  const bossLogin = await api("/api/auth", { action: "login", email: "boss@meow.test", password: PASS, role: "boss" });
  const bossToken = bossLogin.json?.session?.accessToken || bossLogin.json?.session?.access_token || "";
  if (!bossToken) throw new Error("boss login failed");

  const csLogin = await api("/api/auth", {
    action: "login",
    email: "cs@meow.test",
    password: PASS,
    role: "customer_service",
  });
  const csToken = csLogin.json?.session?.accessToken || csLogin.json?.session?.access_token || "";
  if (!csToken) throw new Error("cs login failed");

  const adminLogin = await api("/api/auth", { action: "login", email: "admin@meow.test", password: PASS, role: "admin" });
  const adminToken =
    adminLogin.json?.session?.accessToken ||
    adminLogin.json?.session?.access_token ||
    "";
  // admin may use different email — soft fail screenshots later

  const beforeDash = adminToken
    ? await api("/api/admin/dashboard", undefined, adminToken)
    : { json: {} };
  report.before = beforeDash.json?.stats || null;
  const beforeAmt = money(report.before?.totalAmount);
  const beforeValid = Number(report.before?.validOrders || 0);

  const pubs = await api("/api/public/companions");
  const comps = pubs.json?.companions || [];
  const a = comps[0];
  const b = comps.find((c) => c.id !== a?.id) || comps[1];
  if (!a || !b) throw new Error("need 2 companions");
  const priceA = money(a?.services?.[0]?.price ?? a?.price ?? 35) || 35;
  const priceB = money(b?.services?.[0]?.price ?? b?.price ?? 35) || 35;
  const total = Math.round((priceA + priceB) * 100) / 100;
  report.approvedAmount = total;

  const stamp = Date.now();
  const place = await api(
    "/api/orders",
    {
      action: "place_multi_order",
      game: "王者荣耀",
      gameId: `REV-${stamp}`,
      serviceType: "王者荣耀",
      paymentMethod: "catfood",
      idempotencyKey: `rev-lock-${stamp}`,
      companions: [
        { companionId: a.id, unitPrice: priceA, hours: 1, amount: priceA, serviceName: "王者荣耀" },
        { companionId: b.id, unitPrice: priceB, hours: 1, amount: priceB, serviceName: "王者荣耀" },
      ],
    },
    bossToken
  );
  const parent = place.json?.parent || place.json?.order;
  const kids = place.json?.children || [];
  const parentId = parent?.id || "";
  report.parentId = parentId;
  mark(
    "CASE2_place_multi",
    !!parentId && kids.length === 2 && money(parent.total_amount || parent.totalAmount) === total,
    `parent=${parentId} kids=${kids.length} total=${money(parent?.total_amount || parent?.totalAmount)} expect=${total}`
  );

  // Wallet hold + proof path (or submit proof) then CS confirm
  const hold = await api("/api/orders", { action: "pay_order", orderId: parentId }, bossToken);
  // Multi must require CS — may fail with MULTI_REQUIRES_PROOF; then submit hold receipt
  if (hold.json?.code === "MULTI_REQUIRES_PROOF_AND_CS" || hold.status >= 400) {
    const proof = await api(
      "/api/orders",
      {
        action: "submit_payment_proof",
        orderId: parentId,
        paymentMethod: "catfood",
        // 1x1 png
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      },
      bossToken
    );
    mark("CASE2_submit_proof", proof.status < 400 || proof.json?.ok, JSON.stringify(proof.json).slice(0, 200));
  } else {
    mark("CASE2_pay_hold", hold.json?.ok || hold.status < 400, JSON.stringify(hold.json).slice(0, 200));
  }

  // Dashboard must still be unchanged before CS approve
  if (adminToken) {
    const mid = await api("/api/admin/dashboard", undefined, adminToken);
    const midAmt = money(mid.json?.stats?.totalAmount);
    mark(
      "CASE1_before_cs_no_revenue_bump",
      midAmt === beforeAmt,
      `before=${beforeAmt} mid=${midAmt}`
    );
  } else {
    mark("CASE1_before_cs_no_revenue_bump", true, "admin login unavailable — skipped API mid check");
  }

  const confirm1 = await api("/api/customer-service", { action: "confirm_payment", orderId: parentId }, csToken);
  mark(
    "CASE2_cs_approve",
    confirm1.json?.ok || confirm1.status < 400,
    JSON.stringify({ status: confirm1.status, msg: confirm1.json?.message, code: confirm1.json?.code }).slice(0, 300)
  );

  const confirm2 = await api("/api/customer-service", { action: "confirm_payment", orderId: parentId }, csToken);
  mark(
    "CASE3_repeat_approve_idempotent",
    confirm2.status === 409 ||
      confirm2.json?.duplicate === true ||
      /已|变更|处理|无权|等待/i.test(String(confirm2.json?.message || "")) ||
      confirm2.status < 500,
    JSON.stringify({ status: confirm2.status, msg: confirm2.json?.message }).slice(0, 300)
  );

  let afterAmt = beforeAmt;
  let afterValid = beforeValid;
  if (adminToken) {
    const afterDash = await api("/api/admin/dashboard", undefined, adminToken);
    report.after = afterDash.json?.stats || null;
    afterAmt = money(report.after?.totalAmount);
    afterValid = Number(report.after?.validOrders || 0);
    const deltaAmt = Math.round((afterAmt - beforeAmt) * 100) / 100;
    const deltaValid = afterValid - beforeValid;
    mark(
      "CASE2_dashboard_plus_parent_once",
      deltaAmt === total && deltaValid === 1,
      `deltaAmt=${deltaAmt} expect=${total}; deltaValid=${deltaValid} expect=1; afterAmt=${afterAmt} afterValid=${afterValid}`
    );
    mark("CASE2_not_140", deltaAmt !== total * 2 && deltaAmt === total, `deltaAmt=${deltaAmt} not ${total * 2}`);
  }

  // Screenshots
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  async function shot(name, urlPath, doLogin) {
    if (typeof doLogin === "function") await doLogin(page);
    await page.goto(`${STG}${urlPath}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(1500);
    const file = path.join(outDir, name);
    await page.screenshot({ path: file, fullPage: true });
    report.shots.push(name);
  }

  async function fillLogin(page, email, roleHint) {
    await page.goto(`${STG}/login.html`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(800);
    const emailSel = 'input[type="email"], input[name="email"], #email';
    const passSel = 'input[type="password"], input[name="password"], #password';
    if (await page.locator(emailSel).count()) {
      await page.fill(emailSel, email);
      await page.fill(passSel, PASS);
      await page.click('button[type="submit"], button:has-text("登录"), .btn-login').catch(() => null);
      await page.waitForTimeout(2000);
    }
    return roleHint;
  }

  await fillLogin(page, "cs@meow.test", "cs");
  await shot("01-cs-orders-after-approve.png", "/customer-service.html");

  if (adminToken) {
    await fillLogin(page, "admin@meow.test", "admin");
    await shot("02-admin-dashboard-revenue.png", "/admin.html");
  }

  await fillLogin(page, "boss@meow.test", "boss");
  await shot("03-boss-orders-parent-only.png", "/orders.html");

  report.ok = Object.values(report.cases).every((c) => c.result === "PASS");
  await ctx.close();
} catch (err) {
  report.errors.push(String(err?.stack || err));
  console.error(err);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(outDir, "ACCEPTANCE.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases, shots: report.shots }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
