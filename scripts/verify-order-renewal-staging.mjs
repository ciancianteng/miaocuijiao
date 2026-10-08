/**
 * Staging-only renewal flow. Never targets Production.
 * Does not print tokens or passwords.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = (
  process.env.RENEWAL_BASE ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");
const PASS = "McjTest@12345678";
const OUT = path.resolve("artifacts/order-renewal");
fs.mkdirSync(OUT, { recursive: true });

assertSmokeTargetAllowed({
  script: "verify-order-renewal-staging",
  base: BASE,
  supabaseUrl: "https://cfccwysniduwkjskiqgy.supabase.co",
});

const BOSSES = ["boss@meow.test", "boss.final.1785714993009@meow.test"];
const COMPANIONS = [
  "companion@meow.test",
  "companion.final.1785714993009@meow.test",
  "companion.idcard.1785715257525@meow.test",
];
const SERVICES = ["service@meow.test", "service.final.1785714993009@meow.test"];
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const report = { base: BASE, staging: true, production: false, tests: {}, notes: [] };
function record(id, ok, detail) {
  report.tests[id] = { ok: !!ok, detail };
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

async function api(pathname, token, body, method = "POST") {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.ok !== false, json };
}

async function login(email, role) {
  const hit = await api("/api/auth", "", { action: "login", email, password: PASS, role });
  const session = hit.json.session || hit.json;
  const token = session.accessToken || session.token || session.access_token || "";
  const user = session.user || hit.json.user || hit.json.profile || {};
  return { ok: hit.ok && !!token, status: hit.status, token, userId: user.id || "", role: user.role || role, email };
}

function orderList(json) {
  if (Array.isArray(json.orders)) return json.orders;
  if (Array.isArray(json.data?.orders)) return json.data.orders;
  if (Array.isArray(json.data?.myOrders)) return json.data.myOrders;
  if (Array.isArray(json.myOrders)) return json.myOrders;
  return [];
}

async function main() {
  const info = await api("/api/build-info", "", null, "GET");
  record(
    "staging-target",
    info.json.supabaseIsStaging === true && info.json.supabaseIsProduction === false,
    `ref=${info.json.supabaseRef || "?"} env=${info.json.envLabel || info.json.env || "?"}`
  );
  if (!report.tests["staging-target"].ok) throw new Error("refusing non-staging target");

  const bosses = [];
  for (const email of BOSSES) {
    const row = await login(email, "boss").catch((err) => ({ ok: false, email, error: err.message }));
    if (row.ok) bosses.push(row);
  }
  const companions = [];
  for (const email of COMPANIONS) {
    const row = await login(email, "companion").catch((err) => ({ ok: false, email, error: err.message }));
    if (row.ok) companions.push(row);
  }
  const services = [];
  for (const email of SERVICES) {
    const row = await login(email, "customer_service").catch((err) => ({ ok: false, email, error: err.message }));
    if (row.ok) services.push(row);
  }
  report.notes.push(`logins boss=${bosses.length} companion=${companions.length} cs=${services.length}`);
  const companionById = Object.fromEntries(companions.map((c) => [c.userId, c]));

  let source = null;
  let boss = null;
  for (const candidate of bosses) {
    const listed = await api("/api/orders", candidate.token, null, "GET");
    const orders = orderList(listed.json);
    const hits = orders.filter(
      (o) =>
        (o.status === "completed" || o.status === "reviewed") &&
        (o.companionId || o.companion_id) &&
        companionById[o.companionId || o.companion_id] &&
        !o.isMultiGroupParent &&
        String(o.orderType || o.order_type || "").toLowerCase() !== "multi_group"
    );
    for (const hit of hits) {
      const hours = Number(hit.hours) === 2 ? 3 : 2;
      const peeked = await api("/api/orders", candidate.token, {
        action: "preview_renewal",
        sourceOrderId: hit.id,
        hours,
      });
      if (peeked.ok && Number(peeked.json.quote?.unitPrice) > 0) {
        source = hit;
        boss = candidate;
        break;
      }
    }
    if (source) break;
  }
  if (!source) {
    record("1-create", false, "no completed order owned by a known staging companion");
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    return;
  }
  const companion = companionById[source.companionId || source.companion_id];
  const other = companions.find((c) => c.userId !== companion.userId) || null;
  const cs = services[0] || null;
  const before = {
    id: source.id,
    orderNo: source.orderNo || source.order_no,
    status: source.status,
    hours: source.hours,
    unitPrice: source.unitPrice || source.unit_price,
    total: source.totalAmount || source.total_amount,
    reviewed: !!source.reviewed,
  };
  report.source = { orderNo: before.orderNo, status: before.status, hours: before.hours, total: before.total };
  const nextHours = before.hours === 2 ? 3 : 2;

  const tamper = await api("/api/orders", boss.token, {
    action: "create_renewal",
    sourceOrderId: source.id,
    hours: nextHours,
    unitPrice: 0.01,
    totalAmount: 0.01,
  });
  record(
    "10-amount-tamper",
    tamper.status === 409 && tamper.json.code === "PRICE_CHANGED",
    `status=${tamper.status} code=${tamper.json.code || ""}`
  );

  const preview = await api("/api/orders", boss.token, {
    action: "preview_renewal",
    sourceOrderId: source.id,
    hours: nextHours,
  });
  const quote = preview.json.quote || {};
  const expected = Math.round(Number(quote.unitPrice) * nextHours * 100) / 100;
  record(
    "2-recalc",
    preview.ok && Number(quote.hours) === nextHours && Number(quote.totalAmount) === expected && Number(quote.totalAmount) !== Number(before.total),
    `hours=${quote.hours} unit=${quote.unitPrice} total=${quote.totalAmount} sourceTotal=${before.total}`
  );

  const [first, second] = await Promise.all([
    api("/api/orders", boss.token, { action: "create_renewal", sourceOrderId: source.id, hours: nextHours }),
    api("/api/orders", boss.token, { action: "create_renewal", sourceOrderId: source.id, hours: nextHours }),
  ]);
  const createdA = first.json.order || {};
  const createdB = second.json.order || {};
  const sameId = createdA.id && createdA.id === createdB.id;
  const schemaMissing = first.json.code === "RENEWAL_SCHEMA" || second.json.code === "RENEWAL_SCHEMA";
  record(
    "1-create",
    !schemaMissing && sameId && createdA.orderNo && createdA.orderNo !== before.orderNo && createdA.status === "awaiting_payment" && createdA.isRenewal === true && createdA.renewalSourceOrderNo === before.orderNo,
    schemaMissing
      ? "RENEWAL_SCHEMA — migration not applied on Staging"
      : `new=${createdA.orderNo || "?"} sameId=${!!sameId} status=${createdA.status || first.status} deduped=${!!(first.json.deduped || second.json.deduped)}`
  );
  record(
    "8-no-duplicate",
    !schemaMissing && sameId && (first.json.deduped || second.json.deduped),
    `a=${createdA.orderNo || first.json.code || first.status} b=${createdB.orderNo || second.json.code || second.status}`
  );
  if (!report.tests["1-create"].ok) {
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    await screenshots(
      { bossToken: boss.token, companionToken: companion?.token || "", csToken: "" },
      before,
      { id: "" }
    ).catch((err) => console.log("FAIL screenshots:", err.message || err));
    return;
  }
  const renewal = createdA;
  report.renewal = {
    id: renewal.id,
    orderNo: renewal.orderNo,
    hours: renewal.hours,
    unitPrice: renewal.unitPrice,
    total: renewal.totalAmount,
    status: renewal.status,
  };

  const early = await api("/api/companion", companion.token, { action: "accept_direct_order", id: renewal.id });
  record("11-accept-before-cs", !early.ok && early.status === 409, `status=${early.status} message=${early.json.message || early.json.code || ""}`);

  const proof = await api("/api/orders", boss.token, {
    action: "submit_payment_proof",
    id: renewal.id,
    proofDataUrl: PNG,
    paymentMethod: "duitnow",
  });
  record("3-proof-upload", proof.ok, `status=${proof.status} code=${proof.json.code || ""}`);

  let csSeen = false;
  let proofUrl = "";
  if (cs) {
    const boot = await api("/api/customer-service", cs.token, { action: "bootstrap" });
    const rows = orderList(boot.json);
    const row = rows.find((o) => o.id === renewal.id);
    csSeen = !!row && row.isRenewal === true && row.renewalSourceOrderNo === before.orderNo;
    proofUrl = row?.paymentProofUrl || "";
    record("3-cs-sees-renewal", csSeen, `found=${!!row} isRenewal=${row?.isRenewal} source=${row?.renewalSourceOrderNo || ""} proof=${proofUrl ? "yes" : "no"}`);
    const confirmed = await api("/api/customer-service", cs.token, { action: "confirm_payment", id: renewal.id });
    const again = await api("/api/customer-service", cs.token, { action: "confirm_payment", id: renewal.id });
    record(
    "4-cs-confirm",
    confirmed.ok &&
      (confirmed.json.order?.status === "claimed" || confirmed.json.path === "assigned_confirm") &&
      (again.json.duplicate === true || again.json.already === true || again.json.order?.status === "claimed"),
    `status=${confirmed.json.order?.status || confirmed.status} path=${confirmed.json.path || ""} again=${again.json.order?.status || again.status} duplicate=${!!(again.json.duplicate || again.json.already)}`
    );
  } else {
    record("3-cs-sees-renewal", false, "no customer-service login");
    record("4-cs-confirm", false, "no customer-service login");
  }

  const mine = await api("/api/companion?action=bootstrap", companion.token, null, "GET");
  const mineRows = orderList(mine.json);
  const visible = mineRows.find((o) => o.id === renewal.id);
  record(
    "5-companion-sees",
    !!visible && visible.isRenewal === true && visible.renewalSourceOrderNo === before.orderNo,
    `found=${!!visible} status=${visible?.status || ""} source=${visible?.renewalSourceOrderNo || ""}`
  );

  if (other) {
    const wrong = await api("/api/companion", other.token, { action: "accept_direct_order", id: renewal.id });
    record("9-other-companion", !wrong.ok, `status=${wrong.status} code=${wrong.json.code || ""}`);
  } else {
    record("9-other-companion", false, "no second companion login");
  }

  const accepted = await api("/api/companion", companion.token, { action: "accept_direct_order", id: renewal.id });
  const acceptedStatus = accepted.json.order?.status || "";
  record(
    "6-accept",
    accepted.ok && (acceptedStatus === "in_progress" || acceptedStatus === "confirmed"),
    `status=${acceptedStatus || accepted.status} acceptedAt=${accepted.json.order?.acceptedAt || accepted.json.order?.accepted_at || ""}`
  );

  const bossAgain = await login(boss.email, "boss");
  const reread = await api(`/api/orders?id=${encodeURIComponent(renewal.id)}`, bossAgain.token, null, "GET");
  const rereadRows = orderList(reread.json);
  const fresh = rereadRows.find((row) => row.id === renewal.id) || reread.json.order || {};
  const sourceRead = await api(`/api/orders?id=${encodeURIComponent(source.id)}`, bossAgain.token, null, "GET");
  const sourceNow = orderList(sourceRead.json)[0] || {};
  record(
    "7-persists",
    fresh.id === renewal.id && (fresh.status === "in_progress" || fresh.status === "confirmed") && fresh.isRenewal === true,
    `status=${fresh.status || "missing"} relogin=${bossAgain.ok}`
  );
  record(
    "12-source-unchanged",
    sourceNow.id === source.id &&
      sourceNow.status === before.status &&
      Number(sourceNow.totalAmount || sourceNow.total_amount) === Number(before.total) &&
      Number(sourceNow.hours) === Number(before.hours),
    `status=${sourceNow.status} hours=${sourceNow.hours} total=${sourceNow.totalAmount || sourceNow.total_amount}`
  );

  const requested = await api("/api/companion", companion.token, { action: "complete_order", id: renewal.id });
  const settled = await api("/api/orders", boss.token, { action: "confirm_completion", id: renewal.id });
  const settledStatus = settled.json.order?.status || "";
  record(
    "13-settle",
    requested.ok && requested.json.awaitingBossConfirm === true && settled.ok && settledStatus === "completed" && !!settled.json.settlement,
    `request=${requested.json.message || requested.status} settle=${settledStatus || settled.status} settlement=${settled.json.settlement ? "yes" : "no"} duplicate=${!!settled.json.duplicate}`
  );
  const settledAgain = await api("/api/orders", boss.token, { action: "confirm_completion", id: renewal.id });
  record(
    "14-settle-once",
    settledAgain.ok && (settledAgain.json.duplicate === true || settledAgain.json.order?.status === "completed"),
    `again=${settledAgain.json.order?.status || settledAgain.status} duplicate=${!!settledAgain.json.duplicate}`
  );

  const unpaidCreate = await api("/api/orders", boss.token, {
    action: "create_renewal",
    sourceOrderId: source.id,
    hours: nextHours === 2 ? 1 : 2,
  });
  const unpaid = unpaidCreate.json.order || {};
  const cancelled = unpaid.id
    ? await api("/api/orders", boss.token, { action: "cancel_order", id: unpaid.id, reason: "renewal acceptance cancel before payment" })
    : { ok: false, json: unpaidCreate.json, status: unpaidCreate.status };
  record(
    "15-cancel-unpaid",
    unpaidCreate.ok && unpaid.orderNo && unpaid.orderNo !== before.orderNo && unpaid.orderNo !== renewal.orderNo && cancelled.ok && cancelled.json.order?.status === "cancelled" && cancelled.json.code !== "PAID_CANCEL_USE_REFUND",
    `new=${unpaid.orderNo || unpaidCreate.json.code || unpaidCreate.status} cancel=${cancelled.json.order?.status || cancelled.json.code || cancelled.status}`
  );

  report.sessions = {
    bossEmail: boss.email,
    companionEmail: companion.email,
    otherEmail: other?.email || "",
    csEmail: cs?.email || "",
    bossToken: boss.token,
    companionToken: companion.token,
    csToken: cs?.token || "",
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ...report, sessions: undefined }, null, 2));
  await screenshots(report.sessions, before, renewal).catch((err) => {
    report.notes.push(`screenshots: ${err.message || err}`);
    console.log("FAIL screenshots:", err.message || err);
  });
  const publicReport = { ...report };
  delete publicReport.sessions;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(publicReport, null, 2));
}

async function screenshots(sessions, before, renewal) {
  if (!sessions?.bossToken) return;
  const require = createRequire("C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage/package.json");
  const { chromium } = require("playwright-core");
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((token) => {
    const exp = String(Math.floor(Date.now() / 1000) + 3600);
    localStorage.setItem("mcjRole", "boss");
    localStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("mcjAuthExpiresAt", exp);
    sessionStorage.setItem("mcjRole", "boss");
    sessionStorage.setItem("mcjAuthAccessToken", token);
    sessionStorage.setItem("mcjAuthExpiresAt", exp);
  }, sessions.bossToken);
  await page.goto(`${BASE}/orders.html?filter=completed`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".order-card", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(800);
  const ui = await page.evaluate(() => ({
    href: location.href,
    tokenLen: String(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "").length,
    cards: document.querySelectorAll(".order-card").length,
    renew: document.querySelectorAll("[data-renew-order]").length,
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 240),
  }));
  console.log("boss-ui", JSON.stringify(ui));
  const card = page.locator(`[data-order-id="${before.id}"]`).first();
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(OUT, "01-boss-renew-button.png") });
  } else {
    await page.screenshot({ path: path.join(OUT, "01-boss-orders.png") });
  }
  const renewBtn = page.locator(`[data-renew-order="${before.id}"]`).first();
  if (await renewBtn.count()) {
    await renewBtn.click();
    await page.waitForSelector("#renewModal.open", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const modal = page.locator("#renewModal.open").first();
    if (await modal.count()) await modal.screenshot({ path: path.join(OUT, "02-renew-hours-modal.png") });
    else await page.screenshot({ path: path.join(OUT, "02-renew-hours-modal.png") });
  }
  await page.goto(`${BASE}/orders.html?filter=awaiting_payment`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const renewalCard = page.locator(`[data-order-id="${renewal.id}"]`).first();
  if (await renewalCard.count()) await renewalCard.screenshot({ path: path.join(OUT, "03-new-renewal-card.png") });
  await browser.close();

  if (sessions.csToken) {
    const csBrowser = await chromium.launch({ executablePath: edge, headless: true });
    const csPage = await csBrowser.newPage({ viewport: { width: 1280, height: 800 } });
    await csPage.addInitScript((token) => {
      const blob = { token, accessToken: token, user: { role: "customer_service" }, portal: "customer_service", remember: true };
      localStorage.setItem("mcjServiceSession", JSON.stringify(blob));
      sessionStorage.setItem("mcjServiceSession", JSON.stringify(blob));
      localStorage.setItem("customerServiceAuthToken", "customer_service_session_renewal");
      localStorage.setItem("customerServiceUser", JSON.stringify({ role: "customer_service" }));
    }, sessions.csToken);
    await csPage.goto(`${BASE}/customer-service/orders/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await csPage.waitForTimeout(4000);
    await csPage.screenshot({ path: path.join(OUT, "04-cs-orders.png") });
    await csBrowser.close();
  }

  if (sessions.companionToken) {
    const pwBrowser = await chromium.launch({ executablePath: edge, headless: true });
    const pwPage = await pwBrowser.newPage({ viewport: { width: 390, height: 844 } });
    await pwPage.addInitScript((token) => {
      const blob = {
        token,
        accessToken: token,
        user: { role: "companion" },
        portal: "companion",
        remember: true,
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(blob));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(blob));
      localStorage.setItem("companionAuthToken", "companion_session_renewal");
      localStorage.setItem("companionUser", JSON.stringify({ role: "companion" }));
    }, sessions.companionToken);
    await pwPage.goto(`${BASE}/companion/orders/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await pwPage.waitForTimeout(2500);
    await pwPage.screenshot({ path: path.join(OUT, "05-companion-orders.png") });
    await pwBrowser.close();
  }
}

main().catch((err) => {
  console.error("FAILED", err.message || err);
  report.notes.push(String(err.message || err));
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  process.exit(1);
});
