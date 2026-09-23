#!/usr/bin/env node
/**
 * P0: multi-order must: payment page + proof upload → 待客服审核 → CS approve → 0/2 → 1/2 → 2/2
 * Staging only. Proves API status machine (not UI-only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-proof-cs-review");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SOURCE = "cursor_acceptance";
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

assertSmokeTargetAllowed({
  script: "e2e-staging-multi-proof-cs-review",
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
    EVIDENCE: String(evidence || "").slice(0, 700),
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
  const session = r.json?.session || {};
  const token = session.accessToken || session.access_token || "";
  const refreshToken = session.refreshToken || session.refresh_token || "";
  const user = session.user || r.json?.user || {};
  if (!token) throw new Error(`login fail ${email}: ${r.json?.message || r.status}`);
  return { token, refreshToken, user, id: user.id || "", session };
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
async function injectComp(page, comp) {
  await page.addInitScript(
    ({ token, refreshToken, user }) => {
      const payload = {
        token,
        accessToken: token,
        refreshToken: refreshToken || "",
        user: Object.assign({}, user, { role: "companion" }),
        remember: true,
        portal: "companion",
        portalLoginAt: Date.now(),
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(payload));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(payload));
      localStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
      sessionStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
      localStorage.setItem("companionUser", JSON.stringify(payload.user));
      sessionStorage.setItem("companionUser", JSON.stringify(payload.user));
      localStorage.setItem("mcjRole", "companion");
    },
    { token: comp.token, refreshToken: comp.refreshToken || "", user: comp.user }
  );
}
async function openBossOrder(page, orderId, orderNo, filter) {
  const q = filter ? `filter=${encodeURIComponent(filter)}&` : "";
  await page.goto(`${STG}/orders.html?${q}id=${encodeURIComponent(orderId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2800);
  const needle = String(orderNo || orderId);
  const body = await page.locator("body").innerText();
  if (!body.includes(needle)) {
    const card = page.locator(`[data-order-id="${orderId}"], [data-detail="${orderId}"]`).first();
    if (await card.count()) await card.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  return page.locator("body").innerText();
}
async function loginCs() {
  const r = await api("/api/customer-service", null, {
    action: "login",
    account: "service@meow.test",
    password: "McjTest@12345678",
  });
  const token = r.json?.session?.token || r.json?.session?.accessToken || "";
  if (!token) throw new Error("CS login fail");
  return { token, profile: r.json?.session?.user || {} };
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
      reason: "cursor_acceptance multi proof cs-review topup",
      idempotencyKey: `cursor_acceptance-proof-topup:${bossId}:${Date.now()}`,
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
function snap(order, kids = []) {
  return {
    order_status: order?.status || null,
    paymentReview: !!order?.paymentReview,
    paymentStatus: order?.paymentStatus || order?.statusText || null,
    paidAt: order?.paidAt || order?.paid_at || null,
    children: (kids || []).map((k) => ({
      id: k.id,
      status: k.status,
      companionConfirm: k.companionConfirm?.key || null,
      companionId: k.companionId || k.companion_id,
    })),
  };
}

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
  const idA = compA.id;
  const idB = compB.id;
  const pubA = comps.find((c) => String(c.id) === String(idA)) || comps[0];
  const pubB = comps.find((c) => String(c.id) === String(idB)) || comps.find((c) => String(c.id) !== String(idA));
  const priceA = livePrice(pubA);
  const priceB = livePrice(pubB);
  const stamp = Date.now();

  // ① create multi
  const place = await api("/api/orders", boss.token, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-PROOF-${stamp}`,
    serviceType: "王者荣耀",
    paymentMethod: "catfood",
    notes: `${SOURCE} multi-proof-cs`,
    idempotencyKey: `${SOURCE}-multi-proof-${stamp}`,
    companions: [
      { companionId: idA, unitPrice: priceA, hours: 1, amount: priceA, serviceName: "王者荣耀" },
      { companionId: idB, unitPrice: priceB, hours: 1, amount: priceB, serviceName: "王者荣耀" },
    ],
  });
  const parent = place.json?.order;
  if (!parent?.id) throw new Error("place_multi failed " + JSON.stringify(place.json).slice(0, 300));
  let kids = await childrenOf(boss.token, parent.id);
  add(
    "01_create_multi",
    place.status < 300 && parent.status === "awaiting_payment" && kids.length === 2 ? "PASS" : "FAIL",
    `parent=${parent.status} kids=${kids.length}`,
    "—",
    { place: place.json?.message, snap: snap(parent, kids) }
  );

  const parentNo = parent.orderNo || parent.order_no || parent.id;

  // ②③ open payment-confirm — must show proof upload, NOT wallet confirm-pay shortcut
  const pageBoss = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectBoss(pageBoss, boss);
  await pageBoss.goto(`${STG}/payment-confirm.html?order=${encodeURIComponent(parent.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await pageBoss.waitForTimeout(2800);
  const payText = await pageBoss.locator("body").innerText();
  const shot4 = await shot(pageBoss, "04-payment-info-and-proof-upload.png");
  const hasProofUi =
    /付款截图|我已付款|上传/.test(payText) &&
    !pageBoss.locator("[data-pay-order]").count().then
      ? (await pageBoss.locator("[data-pay-order]").count()) === 0
      : true;
  const payOrderBtns = await pageBoss.locator("[data-pay-order]").count();
  const proofBtns = await pageBoss.locator("[data-proof-submit], [data-proof-pick]").count();
  add(
    "04_payment_page_shows_proof_not_wallet_shortcut",
    /支付确认|付款/.test(payText) && payOrderBtns === 0 && proofBtns > 0 ? "PASS" : "FAIL",
    `payOrderBtns=${payOrderBtns} proofBtns=${proofBtns}`,
    shot4,
    { payOrderBtns, proofBtns, snippet: payText.replace(/\s+/g, " ").slice(0, 280) }
  );

  // pay_order must be rejected for multi
  const payReject = await api("/api/orders", boss.token, {
    action: "pay_order",
    id: parent.id,
    paymentMethod: "catfood",
  });
  const afterReject = await getOrder(boss.token, parent.id);
  kids = await childrenOf(boss.token, parent.id);
  add(
    "03_pay_order_blocked_for_multi",
    payReject.status >= 400 &&
      payReject.json?.code === "MANUAL_PAYMENT_REQUIRES_PROOF" &&
      afterReject?.status === "awaiting_payment" &&
      kids.every((k) => k.status === "awaiting_payment")
      ? "PASS"
      : "FAIL",
    `code=${payReject.json?.code} status=${afterReject?.status}`,
    "—",
    { response: payReject.json, snap: snap(afterReject, kids) }
  );

  // ⑤ upload proof + submit
  const proof = await api("/api/orders", boss.token, {
    action: "submit_payment_proof",
    id: parent.id,
    proofDataUrl: TINY_PNG,
    paymentMethod: "catfood",
  });
  const afterProof = await getOrder(boss.token, parent.id);
  kids = await childrenOf(boss.token, parent.id);
  const proofOk =
    proof.status < 300 &&
    proof.json?.paymentReview === true &&
    afterProof?.status === "awaiting_payment" &&
    (afterProof.paymentReview || /待客服/.test(String(afterProof.paymentStatus || afterProof.statusText || ""))) &&
    kids.every((k) => k.status === "awaiting_payment") &&
    !kids.some((k) => k.companionConfirm?.key === "pending");

  const bossReviewText = await openBossOrder(pageBoss, parent.id, parentNo, "payment_review");
  const shot6 = await shot(pageBoss, "06-boss-pending-cs-review.png");
  const bossUiReview =
    bossReviewText.includes(String(parentNo)) &&
    /待客服审核/.test(bossReviewText) &&
    !/等待陪玩确认（0\/2）/.test(bossReviewText.replace(/\s+/g, ""));

  add(
    "05_06_submit_proof_boss_pending_cs",
    proofOk && bossUiReview ? "PASS" : "FAIL",
    `order=${parentNo} apiReview=${proof.json?.paymentReview} uiOk=${bossUiReview}`,
    shot6,
    {
      orderNo: parentNo,
      response: {
        ok: proof.json?.ok,
        message: proof.json?.message,
        paymentReview: proof.json?.paymentReview,
        orderStatus: proof.json?.order?.status || afterProof?.status,
      },
      snap: snap(afterProof, kids),
    }
  );

  // ⑦ companion cannot confirm
  const childAEarly = kids.find((k) => String(k.companionId || k.companion_id) === String(idA));
  const acceptEarly = await api("/api/companion", compA.token, {
    action: "accept_direct_order",
    id: childAEarly?.id,
  });
  const inboxEarly = await api("/api/companion", compA.token, { action: "my_orders" });
  const inboxOrders = inboxEarly.json?.orders || inboxEarly.json?.list || [];
  const claimableEarly = inboxOrders.some(
    (o) =>
      String(o.id) === String(childAEarly?.id) &&
      ["claimed", "pending"].includes(String(o.status || ""))
  );
  const pageComp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await injectComp(pageComp, compA);
  await pageComp.goto(`${STG}/companion/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageComp.waitForTimeout(2800);
  const compText = await pageComp.locator("body").innerText();
  const shot7 = await shot(pageComp, "07-companion-cannot-confirm-before-cs.png");
  const companionUiOk = !/登录/.test(compText.slice(0, 80)) || /工作台|订单|接单|我的/.test(compText);
  add(
    "07_companion_cannot_confirm_before_cs",
    (acceptEarly.status >= 400 || acceptEarly.json?.ok === false) && !claimableEarly ? "PASS" : "FAIL",
    `accept=${acceptEarly.status} msg=${acceptEarly.json?.message} claimable=${claimableEarly} uiLoggedIn=${companionUiOk}`,
    shot7,
    {
      response: acceptEarly.json,
      inboxHasClaimable: claimableEarly,
      companionUiSnippet: compText.replace(/\s+/g, " ").slice(0, 220),
    }
  );

  // ⑧ CS approve
  const approve = await api("/api/customer-service", cs.token, {
    action: "confirm_payment",
    id: parent.id,
  });
  const afterApprove = await getOrder(boss.token, parent.id);
  kids = await childrenOf(boss.token, parent.id);
  const bossWaitText = await openBossOrder(pageBoss, parent.id, parentNo, "waiting_companion");
  const shot9 = await shot(pageBoss, "09-boss-waiting-0of2-after-cs.png");
  const waitingOk =
    approve.status < 300 &&
    afterApprove?.status === "claimed" &&
    kids.filter((k) => k.status === "claimed").length >= 2 &&
    kids.every((k) => k.companionConfirm?.key === "pending") &&
    bossWaitText.includes(String(parentNo)) &&
    /等待陪玩确认/.test(bossWaitText) &&
    /0\s*\/\s*2|（0\/2）|\(0\/2\)/.test(bossWaitText.replace(/\s+/g, ""));

  add(
    "08_09_cs_approve_then_waiting_0of2",
    waitingOk ? "PASS" : "FAIL",
    `order=${parentNo} parent=${afterApprove?.status} kids=${kids.map((k) => k.status).join(",")}`,
    shot9,
    {
      orderNo: parentNo,
      response: { ok: approve.json?.ok, message: approve.json?.message, path: approve.json?.path },
      snap: snap(afterApprove, kids),
      bossUiSnippet: bossWaitText.replace(/\s+/g, " ").slice(0, 280),
    }
  );

  // ⑩ companions accept 0/2 → 1/2 → 2/2
  const childA = kids.find((k) => String(k.companionId || k.companion_id) === String(idA));
  const childB = kids.find((k) => String(k.companionId || k.companion_id) === String(idB));
  const a1 = await api("/api/companion", compA.token, { action: "accept_direct_order", id: childA?.id });
  const kids1 = await childrenOf(boss.token, parent.id);
  const mid = await getOrder(boss.token, parent.id);
  const text1 = await openBossOrder(pageBoss, parent.id, parentNo, "waiting_companion");
  const shot10a = await shot(pageBoss, "10a-boss-waiting-1of2.png");
  const a2 = await api("/api/companion", compB.token, { action: "accept_direct_order", id: childB?.id });
  const kids2 = await childrenOf(boss.token, parent.id);
  const fin = await getOrder(boss.token, parent.id);
  const text2 = await openBossOrder(pageBoss, parent.id, parentNo, "active");
  const shot10b = await shot(pageBoss, "10b-boss-after-2of2.png");
  const accepted = kids2.filter((k) => ["in_progress", "confirmed"].includes(String(k.status))).length;
  const oneOfTwo =
    kids1.filter((k) => ["in_progress", "confirmed"].includes(String(k.status))).length === 1 &&
    kids1.filter((k) => String(k.status) === "claimed").length === 1;
  add(
    "10_companions_0_1_2",
    a1.status < 300 && a2.status < 300 && oneOfTwo && accepted >= 2 ? "PASS" : "FAIL",
    `order=${parentNo} a1=${a1.status} a2=${a2.status} mid=${kids1.map((k) => k.status).join(",")} fin=${kids2.map((k) => k.status).join(",")}`,
    shot10b,
    {
      orderNo: parentNo,
      acceptA: { ok: a1.json?.ok, message: a1.json?.message, status: a1.json?.order?.status },
      acceptB: { ok: a2.json?.ok, message: a2.json?.message, status: a2.json?.order?.status },
      snap1of2: snap(mid, kids1),
      snap2of2: snap(fin, kids2),
      shot1of2: shot10a,
      ui1: text1.replace(/\s+/g, " ").slice(0, 180),
      ui2: text2.replace(/\s+/g, " ").slice(0, 180),
    }
  );

  await pageBoss.close().catch(() => {});
  await pageComp.close().catch(() => {});
} catch (err) {
  add("RUN_ERROR", "FAIL", String(err?.message || err), "—", {});
  console.error(err);
} finally {
  await browser.close().catch(() => {});
}

fs.writeFileSync(path.join(outDir, "EVIDENCE.json"), JSON.stringify(report, null, 2));
const md = [
  `# Multi proof → CS review E2E`,
  `Generated: ${report.generated_at}`,
  `Summary: PASS=${report.summary.PASS} FAIL=${report.summary.FAIL}`,
  ``,
  `| TEST | RESULT | EVIDENCE | SCREENSHOT |`,
  `|---|---|---|---|`,
  ...report.steps.map(
    (s) => `| ${s.TEST} | **${s.RESULT}** | ${String(s.EVIDENCE).replace(/\|/g, "/")} | ${s.SCREENSHOT} |`
  ),
  ``,
].join("\n");
fs.writeFileSync(path.join(outDir, "REPORT.md"), md);
console.log("Summary", report.summary);
process.exit(report.summary.FAIL > 0 ? 1 : 0);
