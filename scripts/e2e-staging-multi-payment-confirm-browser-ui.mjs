#!/usr/bin/env node
/**
 * Staging BROWSER UI E2E for multi payment-confirm proof flow.
 * Must click real UI controls — no submit_payment_proof API shortcut for the happy path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-payment-confirm-ui");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SOURCE = "cursor_acceptance";

assertSmokeTargetAllowed({
  script: "e2e-staging-multi-payment-confirm-browser-ui",
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

const report = {
  generated_at: new Date().toISOString(),
  staging: STG,
  source: SOURCE,
  steps: [],
  summary: { PASS: 0, FAIL: 0 },
};

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function add(test, result, evidence, screenshot, api) {
  report.steps.push({
    TEST: test,
    RESULT: result,
    EVIDENCE: String(evidence || "").slice(0, 800),
    SCREENSHOT: screenshot || "—",
    API: api || {},
  });
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
async function login(email, role) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role });
  const token = r.json?.session?.accessToken || r.json?.session?.access_token || "";
  const user = r.json?.session?.user || r.json?.user || {};
  if (!token) throw new Error(`login fail ${email}`);
  return { token, user, id: user.id || "" };
}
async function loginCs() {
  const r = await api("/api/customer-service", null, {
    action: "login",
    account: "service@meow.test",
    password: "McjTest@12345678",
  });
  const token = r.json?.session?.token || r.json?.session?.accessToken || "";
  if (!token) throw new Error("CS login fail");
  return { token };
}
async function loginAdmin() {
  const r = await api("/api/auth", null, {
    action: "login",
    email: "admin@meow.test",
    password: "McjTest@12345678",
    role: "admin",
  });
  const token = r.json?.session?.accessToken || r.json?.session?.access_token || "";
  return token ? { token } : null;
}
async function ensureFunds(admin, bossId) {
  if (!admin) return;
  await api(
    "/api/admin/wallet",
    admin.token,
    {
      action: "grant",
      bossId,
      amount: 300,
      balanceType: "paid",
      grantType: "manual",
      reason: "cursor_acceptance multi payment-confirm ui topup",
      idempotencyKey: `cursor_acceptance-payui-topup:${bossId}:${Date.now()}`,
    },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
}
function livePrice(c) {
  const svc = Array.isArray(c?.services) && c.services[0];
  return money(svc?.price ?? svc?.unitPrice ?? c?.price ?? 20) || 20;
}
async function shot(page, name) {
  const file = path.join(shotDir, name);
  await page.screenshot({ path: file, fullPage: true });
  return `screenshots/${name}`;
}
async function getOrder(bossT, id) {
  const list = await api("/api/orders", bossT, null, "GET");
  return (list.json?.orders || []).find((o) => String(o.id) === String(id)) || null;
}
async function childrenOf(bossT, parentId) {
  const list = await api("/api/orders", bossT, null, "GET");
  return (list.json?.orders || []).filter(
    (o) => String(o.parentOrderId || o.parent_order_id || "") === String(parentId)
  );
}

const tinyPng = path.join(shotDir, "_tiny-proof.png");
fs.writeFileSync(
  tinyPng,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
);

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const boss = await login(bossEmail, "boss");
  const compA = await login(compAEmail, "companion");
  const compB = await login(compBEmail, "companion");
  const cs = await loginCs();
  const admin = await loginAdmin();
  await ensureFunds(admin, boss.id);
  await api("/api/companion", compA.token, { action: "set_online_status", online_status: "online" });
  await api("/api/companion", compB.token, { action: "set_online_status", online_status: "online" });

  const pubs = await api("/api/public/companions", null, null, "GET");
  const comps = pubs.json?.companions || [];
  const pubA = comps.find((c) => String(c.id) === String(compA.id)) || comps[0];
  const pubB =
    comps.find((c) => String(c.id) === String(compB.id)) ||
    comps.find((c) => String(c.id) !== String(pubA?.id));
  const stamp = Date.now();

  const place = await api("/api/orders", boss.token, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-PAYUI-${stamp}`,
    serviceType: "王者荣耀",
    paymentMethod: "catfood",
    notes: `${SOURCE} multi-payment-confirm-ui`,
    idempotencyKey: `${SOURCE}-multi-payui-${stamp}`,
    companions: [
      {
        companionId: compA.id,
        unitPrice: livePrice(pubA),
        hours: 1,
        amount: livePrice(pubA),
        serviceName: "王者荣耀",
      },
      {
        companionId: compB.id,
        unitPrice: livePrice(pubB),
        hours: 1,
        amount: livePrice(pubB),
        serviceName: "王者荣耀",
      },
    ],
  });
  const parent = place.json?.order;
  if (!parent?.id) throw new Error("place_multi failed " + JSON.stringify(place.json).slice(0, 240));
  const parentNo = parent.orderNo || parent.order_no || parent.id;
  let kids = await childrenOf(boss.token, parent.id);
  const before = await getOrder(boss.token, parent.id);
  add(
    "01_create_multi",
    place.status < 300 && parent.status === "awaiting_payment" && kids.length === 2 ? "PASS" : "FAIL",
    `order=${parentNo} status=${parent.status} kids=${kids.length}`,
    "—",
    {
      paymentReview: !!before?.paymentReview,
      isMultiGroupParent: !!before?.isMultiGroupParent,
    }
  );

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(
    ({ token, user, orderId, totalAmount }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("customerUser", JSON.stringify(Object.assign({}, user, { role: "boss" })));
      localStorage.setItem("mcjRole", "boss");
      sessionStorage.setItem(
        "mcjMultiPendingPay",
        JSON.stringify({ orderId, totalAmount, at: Date.now() })
      );
      const cache = JSON.stringify({
        id: orderId,
        status: "awaiting_payment",
        paymentMethod: "catfood",
        payment_method: "catfood",
        totalAmount,
        isMultiGroupParent: true,
        orderTypeKey: "multi_group",
        order_type: "multi_group",
      });
      localStorage.setItem("mcjOrderCache:" + orderId, cache);
      sessionStorage.setItem("mcjOrderCache:" + orderId, cache);
    },
    {
      token: boss.token,
      user: boss.user,
      orderId: parent.id,
      totalAmount: parent.totalAmount || parent.amount,
    }
  );

  // Simulate real navigate after「确认并支付」
  await page.goto(`${STG}/payment-confirm.html?order=${encodeURIComponent(parent.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3200);

  let bodyText = await page.locator("body").innerText();
  let payOrderBtns = await page.locator("[data-pay-order]").count();
  let proofPick = await page.locator("[data-proof-pick]").count();
  let proofPanel = await page.locator("[data-proof-panel]").count();
  let payInfo = await page.locator("[data-multi-pay-info]").count();
  const shotChannel = await shot(page, "01-payment-channel-and-proof-ui.png");

  // If wallet shortcut still present, click it — must recover into proof UI (not empty fail).
  if (payOrderBtns > 0) {
    await page.locator("[data-pay-order]").first().click();
    await page.waitForTimeout(2200);
    bodyText = await page.locator("body").innerText();
    payOrderBtns = await page.locator("[data-pay-order]").count();
    proofPick = await page.locator("[data-proof-pick]").count();
    proofPanel = await page.locator("[data-proof-panel]").count();
    payInfo = await page.locator("[data-multi-pay-info]").count();
    await shot(page, "01b-after-wallet-shortcut-recovers-proof.png");
  }

  const noEmptyFail = !(
    proofPanel === 0 &&
    proofPick === 0 &&
    /重新加载/.test(bodyText) &&
    /查看我的订单/.test(bodyText)
  );
  const uiOk =
    /支付确认|付款截图|支付信息/.test(bodyText) &&
    payOrderBtns === 0 &&
    proofPick > 0 &&
    proofPanel > 0 &&
    payInfo > 0 &&
    noEmptyFail &&
    !/订单状态\s*等待陪玩确认|等待陪玩确认（0\s*\/\s*2）/.test(bodyText.replace(/\s+/g, ""));

  const midApi = await getOrder(boss.token, parent.id);
  add(
    "02_browser_payment_channel_proof_ui",
    uiOk && midApi?.paymentReview !== true ? "PASS" : "FAIL",
    `payOrderBtns=${payOrderBtns} proofPick=${proofPick} proofPanel=${proofPanel} payInfo=${payInfo} review=${!!midApi?.paymentReview}`,
    shotChannel,
    {
      snippet: bodyText.replace(/\s+/g, " ").slice(0, 320),
      paymentReview: !!midApi?.paymentReview,
      status: midApi?.status,
    }
  );

  // Real file upload via durable input (UI path)
  const durable = page.locator("#mcjDurableProofInput");
  await durable.setInputFiles(tinyPng);
  await page.waitForTimeout(1500);
  const previewCount = await page.locator("[data-proof-panel] img, .pay-proof img").count();
  const shotPreview = await shot(page, "02-proof-preview-after-pick.png");
  add(
    "03_browser_upload_preview",
    previewCount > 0 || /预览|已选|删除/.test(await page.locator("body").innerText()) ? "PASS" : "FAIL",
    `previewImgs=${previewCount}`,
    shotPreview,
    {}
  );

  const submitBtn = page.locator("[data-proof-submit]").first();
  await submitBtn.click({ timeout: 10000 });
  await page.waitForTimeout(3500);

  // May redirect to orders payment_review — accept either
  const afterUrl = page.url();
  if (/orders\.html/.test(afterUrl)) {
    await page.waitForTimeout(1500);
  } else {
    await page.goto(`${STG}/orders.html?filter=payment_review&id=${encodeURIComponent(parent.id)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
  }
  const bossText = await page.locator("body").innerText();
  const shotReview = await shot(page, "03-boss-pending-cs-after-ui-submit.png");
  const afterProof = await getOrder(boss.token, parent.id);
  kids = await childrenOf(boss.token, parent.id);
  const reviewOk =
    afterProof?.status === "awaiting_payment" &&
    !!afterProof.paymentReview &&
    /待客服审核/.test(bossText) &&
    !/等待陪玩确认（0\/2）/.test(bossText.replace(/\s+/g, "")) &&
    kids.every((k) => k.status === "awaiting_payment");

  add(
    "04_ui_submit_then_pending_cs",
    reviewOk ? "PASS" : "FAIL",
    `order=${parentNo} paymentReview=${!!afterProof?.paymentReview} status=${afterProof?.status}`,
    shotReview,
    {
      paymentReview: !!afterProof?.paymentReview,
      status: afterProof?.status,
      paymentStatus: afterProof?.paymentStatus,
      uiHasPendingCs: /待客服审核/.test(bossText),
    }
  );

  const childA = kids.find((k) => String(k.companionId || k.companion_id) === String(compA.id));
  const acceptEarly = await api("/api/companion", compA.token, {
    action: "accept_direct_order",
    id: childA?.id,
  });
  add(
    "05_api_companion_blocked_before_cs",
    acceptEarly.status >= 400 || acceptEarly.json?.ok === false ? "PASS" : "FAIL",
    `accept=${acceptEarly.status} msg=${acceptEarly.json?.message}`,
    "—",
    { response: acceptEarly.json }
  );

  const approve = await api("/api/customer-service", cs.token, {
    action: "confirm_payment",
    id: parent.id,
  });
  const afterCs = await getOrder(boss.token, parent.id);
  kids = await childrenOf(boss.token, parent.id);
  add(
    "06_api_cs_then_waiting_0of2",
    approve.status < 300 &&
      afterCs?.status === "claimed" &&
      kids.filter((k) => k.status === "claimed").length >= 2
      ? "PASS"
      : "FAIL",
    `parent=${afterCs?.status} kids=${kids.map((k) => k.status).join(",")}`,
    "—",
    { response: { ok: approve.json?.ok, message: approve.json?.message, path: approve.json?.path } }
  );

  await page.close().catch(() => {});
} catch (err) {
  add("RUN_ERROR", "FAIL", String(err?.message || err), "—", {});
  console.error(err);
} finally {
  await browser.close().catch(() => {});
}

fs.writeFileSync(path.join(outDir, "EVIDENCE.json"), JSON.stringify(report, null, 2));
const md = [
  `# Multi payment-confirm Browser UI E2E`,
  `Generated: ${report.generated_at}`,
  `Summary: PASS=${report.summary.PASS} FAIL=${report.summary.FAIL}`,
  ``,
  `| TEST | RESULT | EVIDENCE | SCREENSHOT |`,
  `|---|---|---|---|`,
  ...report.steps.map(
    (s) =>
      `| ${s.TEST} | **${s.RESULT}** | ${String(s.EVIDENCE).replace(/\|/g, "/")} | ${s.SCREENSHOT} |`
  ),
  ``,
].join("\n");
fs.writeFileSync(path.join(outDir, "REPORT.md"), md);
console.log("Summary", report.summary);
process.exit(report.summary.FAIL > 0 ? 1 : 0);
