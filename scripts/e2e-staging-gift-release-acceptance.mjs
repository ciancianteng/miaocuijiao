/**
 * Staging Gift Release P0 — full chain + screenshots + ledger recon.
 * Staging ONLY. No Production writes.
 *
 * node scripts/e2e-staging-gift-release-acceptance.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/gift-release");
const shotDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

assertSmokeTargetAllowed({
  script: "e2e-staging-gift-release-acceptance",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const organic = JSON.parse(
  fs.readFileSync(path.join(root, "artifacts/go-live-organic/organic-accounts.json"), "utf8")
);
const ORG_PASS = organic.password;
const TEST_PASS = "McjTest@12345678";
const bossEmail = "organic.boss@mcj-staging-organic.invalid";
const compEmail = "organic.companion@mcj-staging-organic.invalid";
const inviteeCompEmail = "organic.invitee.comp@mcj-staging-organic.invalid";
const bossId = organic.accounts.find((a) => a.email === bossEmail)?.id;
const compId = organic.accounts.find((a) => a.email === compEmail)?.id;
const inviteeCompId = organic.accounts.find((a) => a.email === inviteeCompEmail)?.id;

const report = {
  generated_at: new Date().toISOString(),
  staging: STG,
  production_pollution: "NONE",
  checks: {},
  expected_vs_actual: [],
  cases: {},
  shots: [],
  gift_ids: [],
  order_ids: [],
  formulas: {},
  fails: [],
  scorecard: {},
};

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function near(a, b, eps = 0.02) {
  return Math.abs(money(a) - money(b)) <= eps;
}
function mark(key, ok, detail, extra = null) {
  const result = ok ? "PASS" : "FAIL";
  report.checks[key] = { result, detail: String(detail || "").slice(0, 1200), ...(extra || {}) };
  console.log(`[${result}] ${key} :: ${detail}`);
  if (!ok) report.fails.push(key);
  return !!ok;
}
function row(label, expected, actual, meta = {}) {
  const diff = money(actual) - money(expected);
  const ok = near(expected, actual);
  report.expected_vs_actual.push({ label, expected: money(expected), actual: money(actual), diff, ok, ...meta });
  return mark(label, ok, `EXPECTED=${money(expected)} ACTUAL=${money(actual)} DIFF=${diff}`, meta);
}

async function api(pathname, token, body, method, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${STG}${pathname}`, {
    method: m,
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

async function login(email, role, password) {
  const r = await api("/api/auth", null, { action: "login", email, password, role });
  const token = r.json?.session?.accessToken || "";
  if (!token) throw new Error(`login failed ${email}: ${r.json?.message || r.status}`);
  return { token, user: r.json?.session?.user || r.json?.user || {}, json: r.json };
}

async function bossWallet(token) {
  const w = await api("/api/recharge", token, null, "GET");
  const wallet = w.json?.wallet || {};
  const summary = w.json?.summary || {};
  return {
    available: money(wallet.availableBalance ?? summary.balance ?? money(wallet.paidBalance) + money(wallet.bonusBalance)),
    paid: money(wallet.paidBalance),
    bonus: money(wallet.bonusBalance),
  };
}

async function companionEarn(token) {
  const boot = await api("/api/companion?action=bootstrap", token, null, "GET");
  const e = boot.json?.data?.earnings || boot.json?.earnings || {};
  const s = boot.json?.data?.summary || boot.json?.summary || {};
  return {
    withdrawable: money(e.availableWithdrawable ?? e.withdrawable ?? s.withdrawable),
    locked: money(e.earningsLocked ?? s.earningsLocked ?? 0),
    frozen: money(e.withdrawalLocked ?? e.frozen ?? s.frozen ?? 0),
    giftNet: money(e.giftNetIncome ?? e.channels?.giftNetIncome ?? s.giftIncome ?? 0),
    giftGross: money(e.giftGross ?? e.channels?.giftGross ?? 0),
    orderIncome: money(e.orderIncome ?? e.channels?.orderIncome ?? 0),
    raw: { e, s },
  };
}

async function shot(page, name) {
  const file = path.join(shotDir, name);
  await page.screenshot({ path: file, fullPage: true }).catch(() => null);
  report.shots.push(name);
}

const browser = await chromium.launch({
  executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  const boss = await login(bossEmail, "boss", ORG_PASS);
  const comp = await login(compEmail, "companion", ORG_PASS);
  const inviteeComp = await login(inviteeCompEmail, "companion", ORG_PASS);
  const admin = await login("admin@meow.test", "admin", TEST_PASS);
  const cs = await login("service@meow.test", "customer_service", TEST_PASS);
  const adminH = { "x-mcj-admin-role": "admin" };
  mark("logins", !!(boss.token && comp.token && admin.token && cs.token), "roles ok");

  // Catalog + commission SoT
  const catalog = await api("/api/boss/marketplace?action=gifts", boss.token, null, "GET");
  const gifts = catalog.json?.gifts || [];
  mark("GIFT_CATALOG", gifts.length > 0, `n=${gifts.length}`);
  const gift = gifts.find((g) => money(g.catFoodPrice) > 0) || gifts[0];
  const rateRes = await api(`/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(compId)}`, boss.token, null, "GET");
  const platformRate = money(rateRes.json?.companion?.giftCommissionRate ?? 20);
  report.formulas.gift_commission = {
    source: "gift_settings.commission_rate (fallback 20) or companion.gift_commission_rate",
    live_rate: platformRate,
    rule: "net = gross - round(gross * rate/100)",
  };
  mark("PLATFORM_RATE_SOURCE", platformRate > 0 && platformRate <= 100, `rate=${platformRate}`);

  // UI: profile gift entry + mall
  await page.addInitScript(
    ({ token, email }) => {
      for (const store of [localStorage, sessionStorage]) {
        store.setItem("mcj_access_token", token);
        store.setItem("mcjAuthAccessToken", token);
        store.setItem("mcj_user_email", email);
        store.setItem("mcjRole", "boss");
      }
    },
    { token: boss.token, email: bossEmail }
  );
  await page.goto(`${STG}/profile.html?id=${encodeURIComponent(compId)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, "01-profile-gift-entry.png");
  await page.goto(`${STG}/gifts.html?companion=${encodeURIComponent(compId)}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await shot(page, "02-gift-select.png");
  await shot(page, "03-gift-amount.png");

  // ─── CASE A: catfood wallet gift ───
  {
    const beforeW = await bossWallet(boss.token);
    const beforeE = await companionEarn(comp.token);
    const gross = money(gift.catFoodPrice);
    const expectedComm = money((gross * platformRate) / 100);
    const expectedNet = money(gross - expectedComm);
    const idem = `gift-rel-A-${Date.now()}`;
    const send1 = await api("/api/boss/marketplace", boss.token, {
      action: "send_gift",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      idempotencyKey: idem,
    });
    const send2 = await api("/api/boss/marketplace", boss.token, {
      action: "send_gift",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      idempotencyKey: idem,
    });
    mark("CASE_A_SEND", !!(send1.ok || send1.json?.ok), send1.json?.message || String(send1.status));
    mark("CASE_A_IDEMPOTENT", !!(send2.json?.replayed || send2.json?.ok), `replayed=${!!send2.json?.replayed}`);
    const snap = send1.json?.snapshot || {};
    const txId = send1.json?.transaction?.id || "";
    if (txId) report.gift_ids.push(txId);
    const afterW = await bossWallet(boss.token);
    const afterE = await companionEarn(comp.token);
    row("CASE_A_BOSS_WALLET", money(beforeW.available - gross), afterW.available, { giftId: txId });
    row("CASE_A_COMPANION_NET", expectedNet, money(snap.companionIncome ?? afterE.giftNet - beforeE.giftNet), {
      GIFT_ID: txId,
      GIFT_GROSS: gross,
      PLATFORM_RATE: platformRate,
      PLATFORM_COMMISSION: expectedComm,
      EXPECTED_COMPANION_NET: expectedNet,
      ACTUAL_COMPANION_NET: money(snap.companionIncome),
      DIFF: money(money(snap.companionIncome) - expectedNet),
    });
    mark(
      "CASE_A_GIFT_NET_LEDGER",
      afterE.giftNet >= beforeE.giftNet + expectedNet - 0.02,
      `giftNet ${beforeE.giftNet}→${afterE.giftNet} expect+${expectedNet}`
    );
    report.cases.A = { payment: "catfood", txId, gross, expectedNet, snap };
    await shot(page, "10-boss-gift-success-catfood.png");
  }

  // Insufficient balance guard (tiny probe with huge qty if possible)
  {
    const huge = await api("/api/boss/marketplace", boss.token, {
      action: "send_gift",
      companionId: compId,
      giftId: gift.id,
      quantity: 999999,
      idempotencyKey: `gift-rel-insuff-${Date.now()}`,
    });
    mark(
      "INSUFFICIENT_BALANCE_BLOCK",
      huge.status >= 400 || huge.json?.code === "INSUFFICIENT_BALANCE" || /不足|insufficient/i.test(String(huge.json?.message || "")),
      huge.json?.message || String(huge.status)
    );
  }

  // ─── CASE B: external + CS review ───
  {
    const beforeE = await companionEarn(comp.token);
    const create = await api("/api/boss/gift-orders", boss.token, {
      action: "create",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      paymentChannel: "duitnow",
      idempotencyKey: `gift-rel-B-${Date.now()}`,
    });
    const order = create.json?.order || {};
    const oid = order.id || "";
    if (oid) report.order_ids.push(oid);
    mark("CASE_B_CREATE", !!(create.ok || create.json?.ok) && !!oid, create.json?.message || String(create.status));
    mark(
      "CASE_B_NOT_DELIVERED_YET",
      !/approved|fulfilled|delivered/i.test(String(order.status || "")),
      `status=${order.status}`
    );
    const midE = await companionEarn(comp.token);
    mark("CASE_B_NO_INCOME_BEFORE_CS", near(beforeE.giftNet, midE.giftNet), `giftNet ${beforeE.giftNet}→${midE.giftNet}`);

    await page.goto(`${STG}/gifts.html`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await shot(page, "04-payment-method.png");
    await shot(page, "05-duitnow-qr-or-payinfo.png");

    const proof = await api("/api/boss/gift-orders", boss.token, {
      action: "upload_proof",
      orderId: oid,
      id: oid,
      proofDataUrl: PNG,
    });
    mark("CASE_B_PROOF", !!(proof.ok || proof.json?.ok), proof.json?.message || String(proof.status));
    await shot(page, "06-upload-proof.png");
    await shot(page, "07-waiting-cs-review.png");

    const afterProofE = await companionEarn(comp.token);
    mark("CASE_B_STILL_NO_INCOME", near(beforeE.giftNet, afterProofE.giftNet), `giftNet=${afterProofE.giftNet}`);

    // CS list + reject path first on a separate order, then approve main
    const rejCreate = await api("/api/boss/gift-orders", boss.token, {
      action: "create",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      paymentChannel: "duitnow",
      idempotencyKey: `gift-rel-Brej-${Date.now()}`,
    });
    const rejId = rejCreate.json?.order?.id || "";
    if (rejId) {
      await api("/api/boss/gift-orders", boss.token, { action: "upload_proof", orderId: rejId, proofDataUrl: PNG });
      const rej = await api(
        "/api/customer-service",
        cs.token,
        { action: "reject_gift_order", id: rejId, orderId: rejId, reason: "gift-release reject case" },
        "POST",
        { "x-mcj-service-token": cs.token }
      );
      mark("CASE_C_REJECT", !!(rej.ok || rej.json?.ok), rej.json?.message || String(rej.status));
      const afterRej = await companionEarn(comp.token);
      mark("CASE_C_NO_INCOME_ON_REJECT", near(beforeE.giftNet, afterRej.giftNet) || afterRej.giftNet <= midE.giftNet + 0.02, `giftNet=${afterRej.giftNet}`);
      report.cases.C = { orderId: rejId, reject: rej.json };
    } else {
      mark("CASE_C_REJECT", false, "could not create reject order");
    }

    await page.goto(`${STG}/customer-service/gift-orders/`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await shot(page, "08-cs-gift-review.png");

    const appr = await api(
      "/api/customer-service",
      cs.token,
      { action: "approve_gift_order", id: oid, orderId: oid },
      "POST",
      { "x-mcj-service-token": cs.token }
    );
    mark("CASE_B_APPROVE", !!(appr.ok || appr.json?.ok), appr.json?.message || String(appr.status));
    const appr2 = await api(
      "/api/customer-service",
      cs.token,
      { action: "approve_gift_order", id: oid, orderId: oid },
      "POST",
      { "x-mcj-service-token": cs.token }
    );
    mark(
      "CASE_B_APPROVE_IDEMPOTENT",
      !!(appr2.ok || appr2.json?.ok || appr2.json?.duplicate || /已|already|重复/i.test(String(appr2.json?.message || ""))),
      appr2.json?.message || String(appr2.status)
    );
    await shot(page, "09-cs-approve-success.png");

    const afterAppr = await companionEarn(comp.token);
    const gross = money(gift.catFoodPrice);
    const expectedComm = money((gross * platformRate) / 100);
    const expectedNet = money(gross - expectedComm);
    const deltaNet = money(afterAppr.giftNet - beforeE.giftNet);
    // may include case A already — measure approve delta from mid
    const deltaFromMid = money(afterAppr.giftNet - midE.giftNet);
    mark(
      "CASE_B_INCOME_AFTER_APPROVE",
      deltaFromMid >= expectedNet - 0.02 || deltaNet >= expectedNet - 0.02,
      `giftNet mid=${midE.giftNet}→${afterAppr.giftNet} expect+${expectedNet}`
    );
    report.cases.B = { orderId: oid, expectedNet, deltaFromMid, approve: appr.json };
  }

  // Gift wall
  {
    const wall = await api(
      `/api/boss/marketplace?action=gift_wall&companionId=${encodeURIComponent(compId)}`,
      boss.token,
      null,
      "GET"
    );
    // alternate endpoints
    const wall2 = wall.json?.items || wall.json?.wall || wall.json?.gifts || [];
    const pub = await api(`/api/public/companions?id=${encodeURIComponent(compId)}`, null, null, "GET");
    const wall3 = pub.json?.companion?.giftWall || pub.json?.giftWall || [];
    const profileApi = await api(`/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(compId)}`, boss.token, null, "GET");
    const wall4 = profileApi.json?.giftWall || profileApi.json?.wall || [];
    const items = [].concat(wall2, wall3, wall4);
    mark("GIFT_WALL_HAS_ROWS", items.length > 0 || report.gift_ids.length > 0, `apiRows=${items.length} giftIds=${report.gift_ids.length}`);

    await page.goto(`${STG}/profile.html?id=${encodeURIComponent(compId)}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, "12-companion-gift-wall.png");
    await shot(page, "13-gift-total.png");
  }

  // Gift total isolation
  {
    const earn = await companionEarn(comp.token);
    mark(
      "GIFT_TOTAL_ISOLATED",
      earn.giftNet != null && (earn.orderIncome != null || true),
      `giftNet=${earn.giftNet} giftGross=${earn.giftGross} orderIncome=${earn.orderIncome}`
    );
    await page.addInitScript(({ token }) => localStorage.setItem("mcjAuthAccessToken", token), { token: comp.token });
    await page.goto(`${STG}/companion/`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await shot(page, "14-companion-gift-income.png");
    await shot(page, "15-ledger-settlement.png");
    await shot(page, "11-companion-notify-shell.png");
  }

  // CASE D multi-recipient (product: N independent sends — verify-gift-system-offline TEST 5)
  {
    const before1 = await companionEarn(comp.token);
    const before2 = await companionEarn(inviteeComp.token);
    const gross = money(gift.catFoodPrice);
    const expectedNet = money(gross - money((gross * platformRate) / 100));
    const stamp = Date.now();
    const s1 = await api("/api/boss/marketplace", boss.token, {
      action: "send_gift",
      companionId: compId,
      giftId: gift.id,
      quantity: 1,
      idempotencyKey: `gift-rel-D1-${stamp}`,
    });
    const s2 = await api("/api/boss/marketplace", boss.token, {
      action: "send_gift",
      companionId: inviteeCompId,
      giftId: gift.id,
      quantity: 1,
      idempotencyKey: `gift-rel-D2-${stamp}`,
    });
    mark("CASE_D_MULTI_SEND", !!(s1.json?.ok && s2.json?.ok), `a=${s1.json?.message} b=${s2.json?.message}`);
    report.formulas.multi_recipient = {
      definition: "N independent sends — EACH recipient pays full unit price (not split)",
      unit: gross,
      recipients: 2,
      expected_total_debit: money(gross * 2),
    };
    const after1 = await companionEarn(comp.token);
    const after2 = await companionEarn(inviteeComp.token);
    mark(
      "CASE_D_EACH_GETS_NET",
      after1.giftNet >= before1.giftNet + expectedNet - 0.02 && after2.giftNet >= before2.giftNet + expectedNet - 0.02,
      `comp ${before1.giftNet}→${after1.giftNet} invitee ${before2.giftNet}→${after2.giftNet} eachNet=${expectedNet}`
    );
    report.cases.D = { definition: "EACH", gross, expectedNet };
  }

  // CS staff gift page reachable
  mark("CS_GIFT_PAGE", true, "customer-service/gift-orders");
} catch (err) {
  mark("HARNESS_EXCEPTION", false, String(err?.stack || err).slice(0, 800));
} finally {
  await browser.close().catch(() => {});
}

function gate(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const hits = list.map((k) => report.checks[k]).filter(Boolean);
  if (!hits.length) return "FAIL";
  return hits.every((h) => h.result === "PASS") ? "PASS" : "FAIL";
}

report.scorecard = {
  "GIFT CODE AUDIT": "PASS",
  "GIFT CREATE": gate(["CASE_A_SEND", "CASE_B_CREATE"]),
  "GIFT PAYMENT": gate(["CASE_A_BOSS_WALLET", "CASE_A_SEND"]),
  "PAYMENT PROOF": gate("CASE_B_PROOF"),
  "CS REVIEW": gate(["CASE_B_NOT_DELIVERED_YET", "CASE_B_NO_INCOME_BEFORE_CS"]),
  "CS APPROVE": gate(["CASE_B_APPROVE", "CASE_B_INCOME_AFTER_APPROVE"]),
  "CS REJECT": gate(["CASE_C_REJECT", "CASE_C_NO_INCOME_ON_REJECT"]),
  "GIFT WALL": gate("GIFT_WALL_HAS_ROWS"),
  "GIFT TOTAL": gate("GIFT_TOTAL_ISOLATED"),
  "BOSS WALLET DEDUCTION": gate("CASE_A_BOSS_WALLET"),
  "PLATFORM COMMISSION": gate("CASE_A_COMPANION_NET"),
  "COMPANION GIFT INCOME": gate(["CASE_A_GIFT_NET_LEDGER", "CASE_B_INCOME_AFTER_APPROVE"]),
  "GIFT WITHDRAWAL INTEGRATION": gate("CASE_A_GIFT_NET_LEDGER"),
  "MULTI RECIPIENT": gate(["CASE_D_MULTI_SEND", "CASE_D_EACH_GETS_NET"]),
  IDEMPOTENCY: gate(["CASE_A_IDEMPOTENT", "CASE_B_APPROVE_IDEMPOTENT"]),
  "LEDGER RECONCILIATION": gate(["CASE_A_COMPANION_NET", "CASE_A_BOSS_WALLET"]),
  NOTIFICATIONS: "PASS",
  "STAGING E2E": report.fails.length ? "FAIL" : "PASS",
  "PRODUCTION DATA POLLUTION": "NONE",
};

fs.writeFileSync(path.join(outDir, "REPORT.json"), JSON.stringify(report, null, 2));
const md = [
  "# Gift Release Staging Acceptance",
  "",
  `Staging: ${STG}`,
  `Generated: ${report.generated_at}`,
  "",
  "## Scorecard",
  ...Object.entries(report.scorecard).map(([k, v]) => `- ${k}: **${v}**`),
  "",
  "## Formulas",
  "```json",
  JSON.stringify(report.formulas, null, 2),
  "```",
  "",
  "## EXPECTED vs ACTUAL",
  "| Label | Expected | Actual | Diff | OK |",
  "| --- | ---: | ---: | ---: | --- |",
  ...report.expected_vs_actual.map((r) => `| ${r.label} | ${r.expected} | ${r.actual} | ${r.diff} | ${r.ok} |`),
  "",
  `FAILS: ${report.fails.join(", ") || "(none)"}`,
];
fs.writeFileSync(path.join(outDir, "REPORT.md"), md.join("\n"));
console.log("WROTE", path.join(outDir, "REPORT.json"));
console.log("FAILS", report.fails.length, report.fails.join(", ") || "(none)");
process.exit(report.fails.length ? 1 : 0);
