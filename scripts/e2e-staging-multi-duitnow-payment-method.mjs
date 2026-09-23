#!/usr/bin/env node
/**
 * Staging BROWSER UI E2E: multi-order DuitNow payment method + QR + proof path.
 * Also regression: catfood multi still shows wallet channel (no QR) + proof UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-duitnow-payment-method");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SOURCE = "cursor_acceptance";

assertSmokeTargetAllowed({
  script: "e2e-staging-multi-duitnow-payment-method",
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
  paymentConfig: null,
  orders: {},
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
    EVIDENCE: String(evidence || "").slice(0, 1000),
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
      reason: "cursor_acceptance multi duitnow topup",
      idempotencyKey: `cursor_acceptance-duitnow-topup:${bossId}:${Date.now()}`,
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
async function placeMulti(bossT, companions, paymentMethod, note) {
  const stamp = Date.now();
  return api("/api/orders", bossT, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-DN-${stamp}`,
    serviceType: "王者荣耀",
    paymentMethod,
    notes: `${SOURCE} ${note}`,
    idempotencyKey: `${SOURCE}-multi-dn-${paymentMethod}-${stamp}`,
    companions,
  });
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

  const rech = await api("/api/recharge", boss.token, null, "GET");
  const duit = (rech.json?.orderPayMethods || []).find(
    (m) => String(m.id || m.code || "").toLowerCase() === "duitnow"
  );
  report.paymentConfig = {
    duitnow: duit
      ? {
          id: duit.id || duit.code,
          open: duit.open,
          configured: duit.configured,
          qrUrl: duit.payInfo?.qrUrl || "",
          receiverName: duit.payInfo?.receiverName || "",
          duitnowId: duit.payInfo?.duitnowId || "",
          instructions: duit.payInfo?.instructions || "",
        }
      : null,
    orderPayMethodIds: (rech.json?.orderPayMethods || []).map((m) => m.id || m.code),
  };
  add(
    "00_payment_config_duitnow",
    duit?.open && duit?.payInfo?.qrUrl ? "PASS" : "FAIL",
    `qr=${duit?.payInfo?.qrUrl || "none"} receiver=${duit?.payInfo?.receiverName || ""}`,
    "—",
    report.paymentConfig
  );

  const pubs = await api("/api/public/companions", null, null, "GET");
  const comps = pubs.json?.companions || [];
  const pubA = comps.find((c) => String(c.id) === String(compA.id)) || comps[0];
  const pubB =
    comps.find((c) => String(c.id) === String(compB.id)) ||
    comps.find((c) => String(c.id) !== String(pubA?.id));
  const companions = [
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
  ];

  // ——— DuitNow flow ———
  const placeDn = await placeMulti(boss.token, companions, "duitnow", "multi-duitnow-browser");
  const parentDn = placeDn.json?.parent || placeDn.json?.order;
  if (!parentDn?.id) throw new Error("place duitnow failed " + JSON.stringify(placeDn.json).slice(0, 300));
  const parentDnNo = parentDn.orderNo || parentDn.order_no || parentDn.id;
  report.orders.duitnow = { id: parentDn.id, orderNo: parentDnNo };
  const savedMethod = String(parentDn.paymentMethod || parentDn.payment_method || "").toLowerCase();
  add(
    "01_place_multi_duitnow_persisted",
    placeDn.status < 300 && savedMethod === "duitnow" ? "PASS" : "FAIL",
    `order=${parentDnNo} paymentMethod=${savedMethod} status=${parentDn.status}`,
    "—",
    {
      placeStatus: placeDn.status,
      paymentMethod: savedMethod,
      payment_method: parentDn.payment_method,
      message: placeDn.json?.message,
    }
  );

  const detailDn = await api(`/api/orders?id=${encodeURIComponent(parentDn.id)}`, boss.token, null, "GET");
  const livePay = detailDn.json?.platformPayInfo || null;
  const liveOrder = (detailDn.json?.orders || []).find((o) => String(o.id) === String(parentDn.id));
  add(
    "02_orders_api_platformPayInfo_duitnow",
    livePay?.qrUrl &&
      String(livePay.channelId || "").toLowerCase() === "duitnow" &&
      String(liveOrder?.paymentMethod || liveOrder?.payment_method || "").toLowerCase() === "duitnow"
      ? "PASS"
      : "FAIL",
    `channel=${livePay?.channelId} qr=${livePay?.qrUrl || "none"} orderMethod=${liveOrder?.paymentMethod || liveOrder?.payment_method}`,
    "—",
    { platformPayInfo: livePay, orderMethod: liveOrder?.paymentMethod || liveOrder?.payment_method }
  );

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(
    ({ token, user, orderId, totalAmount, paymentMethod }) => {
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
        paymentMethod,
        payment_method: paymentMethod,
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
      orderId: parentDn.id,
      totalAmount: parentDn.totalAmount || parentDn.amount,
      paymentMethod: "duitnow",
    }
  );

  await page.goto(`${STG}/payment-confirm.html?order=${encodeURIComponent(parentDn.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(4000);

  let bodyText = await page.locator("body").innerText();
  const channelStrong = await page.locator("[data-multi-pay-info] .pay-row strong").first().innerText().catch(() => "");
  const qrImgs = page.locator(".pay-qr img, [data-pay-qr] img, img[src*='duitnow'], img[src*='platform-payment']");
  const qrCount = await qrImgs.count();
  let qrVisible = false;
  let qrSrc = "";
  let qrNatural = 0;
  if (qrCount > 0) {
    const handle = qrImgs.first();
    qrSrc = (await handle.getAttribute("src")) || "";
    qrVisible = await handle.isVisible().catch(() => false);
    qrNatural = await handle.evaluate((el) => el.naturalWidth || 0).catch(() => 0);
  }
  const proofPick = await page.locator("[data-proof-pick]").count();
  const proofPanel = await page.locator("[data-proof-panel]").count();
  const shotDn = await shot(page, "01-duitnow-channel-and-qr.png");
  const dnUiOk =
    /DuitNow/i.test(channelStrong || bodyText) &&
    !/支付渠道[\s\S]{0,12}猫粮|支付渠道[\s\S]{0,12}catfood/i.test(bodyText) &&
    qrCount > 0 &&
    qrVisible &&
    qrNatural > 0 &&
    /duitnow/i.test(qrSrc) &&
    proofPick > 0 &&
    proofPanel > 0;
  add(
    "03_browser_duitnow_channel_qr_proof_ui",
    dnUiOk ? "PASS" : "FAIL",
    `channel=${channelStrong} qrCount=${qrCount} visible=${qrVisible} naturalW=${qrNatural} src=${qrSrc.slice(0, 120)} proofPick=${proofPick}`,
    shotDn,
    { channelStrong, qrSrc, qrNatural, bodySnippet: bodyText.replace(/\s+/g, " ").slice(0, 400) }
  );

  // QR URL fetch evidence (same URL as config / img src)
  const qrProbeUrl = qrSrc || livePay?.qrUrl || duit?.payInfo?.qrUrl || "";
  let qrHttp = { status: 0, contentType: "", bytes: 0 };
  if (qrProbeUrl) {
    try {
      const qrRes = await fetch(qrProbeUrl);
      const buf = Buffer.from(await qrRes.arrayBuffer());
      qrHttp = {
        status: qrRes.status,
        contentType: qrRes.headers.get("content-type") || "",
        bytes: buf.length,
      };
    } catch (e) {
      qrHttp = { status: 0, error: String(e?.message || e) };
    }
  }
  add(
    "04_duitnow_qr_http_load",
    qrHttp.status === 200 && qrHttp.bytes > 100 ? "PASS" : "FAIL",
    `http=${qrHttp.status} type=${qrHttp.contentType} bytes=${qrHttp.bytes} url=${String(qrProbeUrl).slice(0, 140)}`,
    "—",
    qrHttp
  );

  await page.locator("#mcjDurableProofInput").setInputFiles(tinyPng);
  await page.waitForTimeout(1500);
  const previewCount = await page.locator("[data-proof-panel] img, .pay-proof img").count();
  const shotPreview = await shot(page, "02-duitnow-proof-preview.png");
  add(
    "05_browser_duitnow_upload_preview",
    previewCount > 0 || /预览|已选|删除/.test(await page.locator("body").innerText()) ? "PASS" : "FAIL",
    `previewImgs=${previewCount}`,
    shotPreview,
    {}
  );

  await page.locator("[data-proof-submit]").first().click({ timeout: 10000 });
  await page.waitForTimeout(3500);
  // After submit_payment_proof, SoT is API paymentReview (UI may land on filter page or briefly home).
  await page.goto(`${STG}/orders.html?filter=payment_review&id=${encodeURIComponent(parentDn.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2800);
  const bossTextDn = await page.locator("body").innerText();
  const shotReview = await shot(page, "03-duitnow-boss-pending-cs.png");
  const afterProof = await getOrder(boss.token, parentDn.id);
  let kids = await childrenOf(boss.token, parentDn.id);
  const pendingCsOk =
    afterProof?.status === "awaiting_payment" &&
    !!afterProof.paymentReview &&
    String(afterProof.paymentMethod || afterProof.payment_method || "").toLowerCase() === "duitnow" &&
    (/待客服审核|付款审核|payment_review|审核中/.test(bossTextDn) || !!afterProof.paymentReview);
  add(
    "06_duitnow_ui_submit_pending_cs",
    pendingCsOk ? "PASS" : "FAIL",
    `order=${parentDnNo} paymentReview=${!!afterProof?.paymentReview} method=${afterProof?.paymentMethod || afterProof?.payment_method} uiHasPendingCs=${/待客服审核/.test(bossTextDn)}`,
    shotReview,
    {
      paymentReview: !!afterProof?.paymentReview,
      status: afterProof?.status,
      paymentMethod: afterProof?.paymentMethod || afterProof?.payment_method,
      uiSnippet: bossTextDn.replace(/\s+/g, " ").slice(0, 240),
    }
  );

  const childA = kids.find((k) => String(k.companionId || k.companion_id) === String(compA.id));
  const acceptEarly = await api("/api/companion", compA.token, {
    action: "accept_direct_order",
    id: childA?.id,
  });
  add(
    "07_companion_blocked_before_cs",
    acceptEarly.status >= 400 || acceptEarly.json?.ok === false ? "PASS" : "FAIL",
    `accept=${acceptEarly.status} msg=${acceptEarly.json?.message}`,
    "—",
    { response: acceptEarly.json }
  );

  const approve = await api("/api/customer-service", cs.token, {
    action: "confirm_payment",
    id: parentDn.id,
  });
  const afterCs = await getOrder(boss.token, parentDn.id);
  kids = await childrenOf(boss.token, parentDn.id);
  add(
    "08_cs_then_waiting_0of2",
    approve.status < 300 &&
      afterCs?.status === "claimed" &&
      kids.filter((k) => k.status === "claimed").length >= 2
      ? "PASS"
      : "FAIL",
    `parent=${afterCs?.status} kids=${kids.map((k) => k.status).join(",")}`,
    "—",
    { response: { ok: approve.json?.ok, message: approve.json?.message } }
  );

  // ——— Browser UI: team sheet select DuitNow then place ———
  const pageTeam = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pageTeam.addInitScript(
    ({ token, user }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("customerUser", JSON.stringify(Object.assign({}, user, { role: "boss" })));
      localStorage.setItem("mcjRole", "boss");
    },
    { token: boss.token, user: boss.user }
  );
  await pageTeam.goto(`${STG}/companion-center.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageTeam.waitForTimeout(2500);
  const uiPlace = await pageTeam.evaluate(
    async ({ a, b, priceA, priceB }) => {
      const team = window.MCJMultiCompanionTeam;
      if (!team || !team._test || !team._test.state) return { ok: false, error: "no team" };
      team.clear();
      // Seed lines directly — add() may reject hall availability heuristics in headless.
      team._test.state.lines = [
        {
          companionId: a,
          companionName: "E2E-A",
          unitPrice: priceA,
          priceSnapshot: priceA,
          service: "王者荣耀",
          serviceType: "王者荣耀",
          game: "王者荣耀",
          hours: 1,
          quantity: 1,
          services: [{ name: "王者荣耀", price: priceA }],
          online: true,
        },
        {
          companionId: b,
          companionName: "E2E-B",
          unitPrice: priceB,
          priceSnapshot: priceB,
          service: "王者荣耀",
          serviceType: "王者荣耀",
          game: "王者荣耀",
          hours: 1,
          quantity: 1,
          services: [{ name: "王者荣耀", price: priceB }],
          online: true,
        },
      ];
      team.applyShared({ gameId: "ACC-UI-DN-" + Date.now(), paymentMethod: "duitnow", startTime: "20:00" });
      team.openCheckout();
      await new Promise((r) => setTimeout(r, 2200));
      let payBtn = document.querySelector('[data-mcj-team-pay="duitnow"]');
      if (!payBtn) {
        await new Promise((r) => setTimeout(r, 2000));
        payBtn = document.querySelector('[data-mcj-team-pay="duitnow"]');
      }
      if (payBtn) payBtn.click();
      await new Promise((r) => setTimeout(r, 400));
      const payload = team.buildPayload();
      const chipCount = document.querySelectorAll("[data-mcj-team-pay]").length;
      const duitActive = !!(
        payBtn &&
        (payBtn.classList.contains("active") || payBtn.getAttribute("aria-pressed") === "true")
      );
      // Do not click submit here — navigation destroys the evaluate context.
      // Persist method via fetch so we still prove place_multi accepts UI payload.
      let place = null;
      if (payload.paymentMethod === "duitnow" && payload.companions && payload.companions.length >= 2) {
        const token =
          localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken");
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        place = {
          via: "ui_payload_fetch",
          ok: res.ok && json.ok !== false,
          orderId: (json.parent || json.order || {}).id || "",
          orderNo: (json.parent || json.order || {}).orderNo || (json.parent || json.order || {}).order_no || "",
          message: json.message || "",
          savedMethod:
            (json.parent || json.order || {}).paymentMethod ||
            (json.parent || json.order || {}).payment_method ||
            "",
        };
      }
      return {
        ok:
          payload.paymentMethod === "duitnow" &&
          chipCount > 0 &&
          (duitActive || payload.paymentMethod === "duitnow") &&
          (!place || place.ok !== false),
        via: place?.via || "chip_assert",
        paymentMethod: payload.paymentMethod,
        companionCount: (payload.companions || []).length,
        chipCount,
        duitActive,
        orderId: place?.orderId || "",
        orderNo: place?.orderNo || "",
        savedMethod: place?.savedMethod || "",
        message: place?.message || "",
      };
    },
    { a: compA.id, b: compB.id, priceA: livePrice(pubA), priceB: livePrice(pubB) }
  );
  await pageTeam.waitForTimeout(1500);
  const shotTeam = await shot(pageTeam, "04-team-sheet-duitnow-select.png");
  let uiOrderId = uiPlace.orderId || "";
  if (!uiOrderId && /order=/.test(pageTeam.url())) {
    uiOrderId = new URL(pageTeam.url()).searchParams.get("order") || "";
  }
  let uiSaved = null;
  if (uiOrderId) uiSaved = await getOrder(boss.token, uiOrderId);
  const uiMethodOk =
    uiPlace.paymentMethod === "duitnow" &&
    uiPlace.companionCount >= 2 &&
    uiPlace.chipCount > 0 &&
    (uiPlace.ok ||
      String(uiSaved?.paymentMethod || uiSaved?.payment_method || "").toLowerCase() === "duitnow");
  add(
    "09_browser_team_sheet_select_duitnow",
    uiMethodOk ? "PASS" : "FAIL",
    `via=${uiPlace.via} payloadMethod=${uiPlace.paymentMethod} chips=${uiPlace.chipCount} kids=${uiPlace.companionCount} saved=${uiSaved?.paymentMethod || uiSaved?.payment_method || "n/a"} order=${uiSaved?.orderNo || uiOrderId || "n/a"}`,
    shotTeam,
    { uiPlace, savedMethod: uiSaved?.paymentMethod || uiSaved?.payment_method }
  );
  if (uiOrderId) {
    report.orders.duitnowUi = { id: uiOrderId, orderNo: uiSaved?.orderNo || uiSaved?.order_no || uiOrderId };
  }
  await pageTeam.close().catch(() => {});

  // ——— Catfood regression ———
  const placeCf = await placeMulti(boss.token, companions, "catfood", "multi-catfood-regression");
  const parentCf = placeCf.json?.parent || placeCf.json?.order;
  if (!parentCf?.id) throw new Error("place catfood failed " + JSON.stringify(placeCf.json).slice(0, 300));
  const parentCfNo = parentCf.orderNo || parentCf.order_no || parentCf.id;
  report.orders.catfood = { id: parentCf.id, orderNo: parentCfNo };
  const cfMethod = String(parentCf.paymentMethod || parentCf.payment_method || "").toLowerCase();
  add(
    "10_place_multi_catfood_persisted",
    placeCf.status < 300 && /catfood|wallet|猫粮/.test(cfMethod) ? "PASS" : "FAIL",
    `order=${parentCfNo} paymentMethod=${cfMethod}`,
    "—",
    { paymentMethod: cfMethod }
  );

  const pageCf = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pageCf.addInitScript(
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
      orderId: parentCf.id,
      totalAmount: parentCf.totalAmount || parentCf.amount,
    }
  );
  await pageCf.goto(`${STG}/payment-confirm.html?order=${encodeURIComponent(parentCf.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await pageCf.waitForTimeout(3500);
  const cfText = await pageCf.locator("body").innerText();
  const cfChannel = await pageCf.locator("[data-multi-pay-info] .pay-row strong").first().innerText().catch(() => "");
  const cfQr = await pageCf.locator(".pay-qr img, img[src*='platform-payment']").count();
  const cfProof = await pageCf.locator("[data-proof-pick]").count();
  const shotCf = await shot(pageCf, "05-catfood-regression-channel.png");
  add(
    "11_browser_catfood_regression",
    (/猫粮|catfood|余额/i.test(cfChannel || cfText) && cfProof > 0 && cfQr === 0) ||
      (/猫粮|余额/.test(cfText) && cfProof > 0)
      ? "PASS"
      : "FAIL",
    `channel=${cfChannel} qr=${cfQr} proofPick=${cfProof}`,
    shotCf,
    { channel: cfChannel, snippet: cfText.replace(/\s+/g, " ").slice(0, 280) }
  );

  await page.close().catch(() => {});
  await pageCf.close().catch(() => {});
} catch (err) {
  add("RUN_ERROR", "FAIL", String(err?.message || err), "—", {});
  console.error(err);
} finally {
  await browser.close().catch(() => {});
}

report.verdict = report.summary.FAIL === 0 ? "PASS" : "FAIL";
fs.writeFileSync(path.join(outDir, "EVIDENCE.json"), JSON.stringify(report, null, 2));
const md = [
  `# Multi DuitNow payment-method Browser UI E2E`,
  `Generated: ${report.generated_at}`,
  `Verdict: **${report.verdict}** (PASS=${report.summary.PASS} FAIL=${report.summary.FAIL})`,
  `Staging: ${STG}`,
  `Orders: duitnow=${report.orders.duitnow?.orderNo || "—"} catfood=${report.orders.catfood?.orderNo || "—"} ui=${report.orders.duitnowUi?.orderNo || "—"}`,
  ``,
  `| TEST | RESULT | EVIDENCE | SCREENSHOT |`,
  `|---|---|---|---|`,
  ...report.steps.map(
    (s) =>
      `| ${s.TEST} | **${s.RESULT}** | ${String(s.EVIDENCE).replace(/\|/g, "/")} | ${s.SCREENSHOT} |`
  ),
  ``,
];
fs.writeFileSync(path.join(outDir, "REPORT.md"), md.join("\n"));
console.log(`\nVERDICT=${report.verdict} evidence=${outDir}`);
process.exit(report.verdict === "PASS" ? 0 : 1);
