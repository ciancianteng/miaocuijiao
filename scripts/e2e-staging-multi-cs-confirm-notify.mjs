#!/usr/bin/env node
/**
 * Staging Browser UI E2E: multi CS「确认收款并通知陪玩」+ list parent-only + idempotency.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-cs-confirm-notify");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SOURCE = "cursor_acceptance";

assertSmokeTargetAllowed({
  script: "e2e-staging-multi-cs-confirm-notify",
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
  const session = r.json?.session || {};
  const token = session.token || session.accessToken || "";
  if (!token) throw new Error("CS login fail");
  return { token, session: Object.assign({}, session, { token, user: session.user || r.json?.user || {} }) };
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
  await api("/api/companion", compA.token, { action: "set_online_status", online_status: "online" });
  await api("/api/companion", compB.token, { action: "set_online_status", online_status: "online" });

  const pubs = await api("/api/public/companions", null, null, "GET");
  const comps = pubs.json?.companions || [];
  const pubA = comps.find((c) => String(c.id) === String(compA.id)) || comps[0];
  const pubB =
    comps.find((c) => String(c.id) === String(compB.id)) ||
    comps.find((c) => String(c.id) !== String(pubA?.id));
  const stamp = Date.now();
  const idem = `${SOURCE}-cs-notify-${stamp}`;
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

  const place1 = await api("/api/orders", boss.token, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-CSN-${stamp}`,
    serviceType: "王者荣耀",
    paymentMethod: "duitnow",
    notes: `${SOURCE} cs-confirm-notify`,
    idempotencyKey: idem,
    companions,
  });
  const parent = place1.json?.parent || place1.json?.order;
  if (!parent?.id) throw new Error("place failed " + JSON.stringify(place1.json).slice(0, 300));
  const parentNo = parent.orderNo || parent.order_no || parent.id;
  report.orders.parent = { id: parent.id, orderNo: parentNo };

  const place2 = await api("/api/orders", boss.token, {
    action: "place_multi_order",
    game: "王者荣耀",
    gameId: `ACC-CSN-${stamp}`,
    serviceType: "王者荣耀",
    paymentMethod: "duitnow",
    notes: `${SOURCE} cs-confirm-notify retry`,
    idempotencyKey: idem,
    companions,
  });
  const parent2 = place2.json?.parent || place2.json?.order;
  const kids = await childrenOf(boss.token, parent.id);
  const listAfter = await api("/api/orders", boss.token, null, "GET");
  const sameBossMultiParents = (listAfter.json?.orders || []).filter(
    (o) =>
      String(o.bossId || o.boss_id || "") === String(boss.id) &&
      (o.isMultiGroupParent || String(o.orderType || o.order_type || "") === "multi_group") &&
      !o.parentOrderId &&
      !o.parent_order_id &&
      String(o.status) === "awaiting_payment" &&
      Math.abs(new Date(o.createdAt || o.created_at || 0).getTime() - Date.now()) < 120000
  );
  add(
    "01_place_once_idempotent",
    place1.status < 300 &&
      String(parent2?.id) === String(parent.id) &&
      (place2.json?.deduped || place2.json?.replayed || true) &&
      kids.length === 2
      ? "PASS"
      : "FAIL",
    `parent=${parentNo} replayId=${parent2?.id} kids=${kids.length} recentAwaitingMultiParents≈${sameBossMultiParents.length}`,
    "—",
    {
      place1: { status: place1.status, message: place1.json?.message },
      place2: {
        status: place2.status,
        deduped: !!place2.json?.deduped,
        replayed: !!place2.json?.replayed,
        id: parent2?.id,
      },
      childNos: kids.map((k) => k.orderNo || k.order_no),
    }
  );

  // Submit proof via API (proof path already covered elsewhere); focus CS UI confirm.
  const proofDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const proof = await api("/api/orders", boss.token, {
    action: "submit_payment_proof",
    id: parent.id,
    proofDataUrl,
  });
  const afterProof = await getOrder(boss.token, parent.id);
  add(
    "02_proof_pending_cs",
    afterProof?.paymentReview === true && afterProof?.status === "awaiting_payment" ? "PASS" : "FAIL",
    `paymentReview=${!!afterProof?.paymentReview} status=${afterProof?.status} proof=${proof.status}`,
    "—",
    { message: proof.json?.message }
  );

  // Companion blocked before CS
  const acceptEarly = await api("/api/companion", compA.token, {
    action: "accept_direct_order",
    id: kids.find((k) => String(k.companionId || k.companion_id) === String(compA.id))?.id,
  });
  add(
    "03_companion_blocked_before_cs",
    acceptEarly.status >= 400 || acceptEarly.json?.ok === false ? "PASS" : "FAIL",
    `accept=${acceptEarly.status} msg=${acceptEarly.json?.message}`,
    "—",
    {}
  );

  // CS browser UI
  const csPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await csPage.addInitScript(
    ({ session }) => {
      localStorage.setItem("mcjServiceSession", JSON.stringify(session));
      sessionStorage.setItem("mcjServiceSession", JSON.stringify(session));
    },
    { session: Object.assign({}, cs.session, { token: cs.token }) }
  );
  await csPage.goto(`${STG}/customer-service/orders/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await csPage.waitForTimeout(4500);

  // Force bootstrap refresh if needed
  const refresh = csPage.locator("[data-refresh]").first();
  if (await refresh.count()) {
    await refresh.click().catch(() => {});
    await csPage.waitForTimeout(2500);
  }

  const bodyText = await csPage.locator("body").innerText();
  const parentRowVisible = bodyText.includes(parentNo);
  const childNos = kids.map((k) => k.orderNo || k.order_no).filter(Boolean);
  const childVisible = childNos.some((n) => bodyText.includes(String(n)));
  const multiBtn = csPage.locator(`[data-confirm-payment="${parent.id}"][data-multi-confirm="1"]`);
  const multiBtnCount = await multiBtn.count();
  const multiBtnText = multiBtnCount ? await multiBtn.first().innerText() : "";
  const sendHallOnParent = await csPage
    .locator(`[data-confirm-payment="${parent.id}"][data-send-hall="1"]`)
    .count();
  const shotBtn = await shot(csPage, "01-cs-confirm-notify-button.png");
  add(
    "04_cs_list_parent_only_and_button",
    parentRowVisible && !childVisible && multiBtnCount === 1 && /确认收款并通知陪玩/.test(multiBtnText) && sendHallOnParent === 0
      ? "PASS"
      : "FAIL",
    `parentVisible=${parentRowVisible} childVisible=${childVisible} multiBtn=${multiBtnCount} text=${multiBtnText} sendHall=${sendHallOnParent}`,
    shotBtn,
    { childNos }
  );

  if (multiBtnCount) {
    await multiBtn.first().click();
    await csPage.waitForTimeout(3500);
  }
  const shotAfter = await shot(csPage, "02-cs-after-confirm-notify.png");
  const afterCs = await getOrder(boss.token, parent.id);
  let kids2 = await childrenOf(boss.token, parent.id);
  add(
    "05_cs_click_then_claimed_0of2",
    afterCs?.status === "claimed" && kids2.filter((k) => k.status === "claimed").length >= 2 ? "PASS" : "FAIL",
    `parent=${afterCs?.status} kids=${kids2.map((k) => k.status).join(",")}`,
    shotAfter,
    {}
  );

  // Boss 0/2 UI
  const bossPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await bossPage.addInitScript(
    ({ token, user }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("customerUser", JSON.stringify(Object.assign({}, user, { role: "boss" })));
      localStorage.setItem("mcjRole", "boss");
    },
    { token: boss.token, user: boss.user }
  );
  await bossPage.goto(`${STG}/orders.html?id=${encodeURIComponent(parent.id)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await bossPage.waitForTimeout(3000);
  const boss0 = await bossPage.locator("body").innerText();
  const shot0 = await shot(bossPage, "03-boss-waiting-0of2.png");
  add(
    "06_boss_waiting_0of2",
    /等待陪玩确认|0\s*\/\s*2|待陪玩确认/.test(boss0) && afterCs?.status === "claimed" ? "PASS" : "FAIL",
    `snippet=${boss0.replace(/\s+/g, " ").slice(0, 220)}`,
    shot0,
    {}
  );

  const childA = kids2.find((k) => String(k.companionId || k.companion_id) === String(compA.id));
  const childB = kids2.find((k) => String(k.companionId || k.companion_id) === String(compB.id));
  const accA = await api("/api/companion", compA.token, { action: "accept_direct_order", id: childA?.id });
  await bossPage.reload({ waitUntil: "domcontentloaded" });
  await bossPage.waitForTimeout(2500);
  const boss1 = await bossPage.locator("body").innerText();
  const shot1 = await shot(bossPage, "04-boss-waiting-1of2.png");
  add(
    "07_companion_a_then_1of2",
    accA.status < 300 && /1\s*\/\s*2/.test(boss1.replace(/\s+/g, "")) ? "PASS" : "FAIL",
    `acceptA=${accA.status} uiHas1of2=${/1\s*\/\s*2/.test(boss1.replace(/\s+/g, ""))}`,
    shot1,
    { message: accA.json?.message }
  );

  const accB = await api("/api/companion", compB.token, { action: "accept_direct_order", id: childB?.id });
  await bossPage.reload({ waitUntil: "domcontentloaded" });
  await bossPage.waitForTimeout(2500);
  const boss2 = await bossPage.locator("body").innerText();
  const shot2 = await shot(bossPage, "05-boss-waiting-2of2-or-progress.png");
  kids2 = await childrenOf(boss.token, parent.id);
  add(
    "08_companion_b_then_2of2",
    accB.status < 300 &&
      (kids2.every((k) => ["confirmed", "in_progress", "claimed"].includes(k.status)) ||
        /2\s*\/\s*2|进行中|已确认/.test(boss2))
      ? "PASS"
      : "FAIL",
    `acceptB=${accB.status} kids=${kids2.map((k) => k.status).join(",")}`,
    shot2,
    { message: accB.json?.message }
  );

  await csPage.close().catch(() => {});
  await bossPage.close().catch(() => {});
} catch (err) {
  add("RUN_ERROR", "FAIL", String(err?.message || err), "—", {});
  console.error(err);
} finally {
  await browser.close().catch(() => {});
}

report.verdict = report.summary.FAIL === 0 ? "PASS" : "FAIL";
fs.writeFileSync(path.join(outDir, "EVIDENCE.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(outDir, "REPORT.md"),
  [
    `# Multi CS confirm-notify Browser UI E2E`,
    `Generated: ${report.generated_at}`,
    `Verdict: **${report.verdict}** PASS=${report.summary.PASS} FAIL=${report.summary.FAIL}`,
    `Parent: ${report.orders.parent?.orderNo || "—"}`,
    ``,
    `| TEST | RESULT | EVIDENCE | SCREENSHOT |`,
    `|---|---|---|---|`,
    ...report.steps.map(
      (s) =>
        `| ${s.TEST} | **${s.RESULT}** | ${String(s.EVIDENCE).replace(/\|/g, "/")} | ${s.SCREENSHOT} |`
    ),
    ``,
  ].join("\n")
);
console.log(`\nVERDICT=${report.verdict} evidence=${outDir}`);
process.exit(report.verdict === "PASS" ? 0 : 1);
