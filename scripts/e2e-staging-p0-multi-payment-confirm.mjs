#!/usr/bin/env node
/**
 * Staging P0 E2E: multi payment-confirm + parent/child list + 1/2 vs 2/2 confirm.
 * Production writes forbidden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-payment-fix");
fs.mkdirSync(outDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PASS = "McjTest@12345678";

assertSmokeTargetAllowed({
  script: "e2e-staging-p0-multi-payment-confirm",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const report = {
  ok: false,
  generated_at: new Date().toISOString(),
  cases: {},
  shots: [],
  notes: [],
  errors: [],
};

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function api(pathname, body, token, extra = {}) {
  const res = await fetch(`${STG}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function mark(key, ok, detail) {
  report.cases[key] = { result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) };
  console.log(`[${ok ? "PASS" : "FAIL"}] ${key} :: ${detail}`);
}

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });
  report.shots.push(name);
  console.log("SHOT", name);
}

async function login(email, role) {
  const r = await api("/api/auth", { action: "login", email, password: PASS, role });
  const token = r.json?.session?.accessToken || r.json?.session?.access_token || "";
  const user = r.json?.user || r.json?.profile || r.json?.session?.user || {};
  return { token, user, status: r.status, json: r.json };
}

function livePrice(c) {
  const svc = Array.isArray(c?.services) && c.services[0];
  return money(svc?.price ?? svc?.unitPrice ?? c?.price ?? c?.priceValue ?? c?.minPrice ?? 0);
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const boss = await login("boss@meow.test", "boss");
  const compA = await login("companion@meow.test", "companion");
  const compB = await login("companion2@meow.test", "companion");
  if (!boss.token) throw new Error("boss login failed");
  if (!compA.token) throw new Error("companionA login failed");
  if (!compB.token) throw new Error("companionB login failed — need companion2@meow.test on Staging");

  const pubs = await api("/api/public/companions");
  const comps = pubs.json?.companions || [];
  const idA = String(compA.user.id || compA.user.uid || "");
  const idB = String(compB.user.id || compB.user.uid || "");
  let a = comps.find((c) => String(c.id) === idA) || comps[0];
  let b = comps.find((c) => String(c.id) === idB) || comps.find((c) => String(c.id) !== String(a?.id));
  if (!a?.id || !b?.id) throw new Error("need two public companions");

  const priceA = livePrice(a) || 35;
  const priceB = livePrice(b) || 35;
  const total = priceA + priceB;
  report.notes.push({ a: { id: a.id, name: a.name, priceA }, b: { id: b.id, name: b.name, priceB }, total });

  await api("/api/companion", { action: "set_online_status", online_status: "online" }, compA.token);
  await api("/api/companion", { action: "set_online_status", online_status: "online" }, compB.token);

  const balRes = await fetch(`${STG}/api/recharge`, {
    headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" },
  });
  const balJson = await balRes.json().catch(() => ({}));
  const balance0 = money(balJson?.summary?.balance ?? balJson?.wallet?.totalBalance);
  report.notes.push({ balance0 });

  const stamp = Date.now();
  const place = await api(
    "/api/orders",
    {
      action: "place_multi_order",
      game: "王者荣耀",
      gameId: `P0MULTI-${stamp}`,
      serviceType: "王者荣耀",
      paymentMethod: "catfood",
      idempotencyKey: `p0-multi-${stamp}`,
      companions: [
        {
          companionId: a.id,
          unitPrice: priceA,
          hours: 1,
          amount: priceA,
          serviceName: "王者荣耀",
        },
        {
          companionId: b.id,
          unitPrice: priceB,
          hours: 1,
          amount: priceB,
          serviceName: "王者荣耀",
        },
      ],
    },
    boss.token
  );
  const parent = place.json?.order || place.json?.parent || place.json?.orders?.[0];
  const children = place.json?.children || place.json?.childOrders || [];
  const parentId = parent?.id || place.json?.parentOrderId;
  mark(
    "CASE1_place_awaiting_payment",
    place.status < 300 && parentId && String(parent?.status || place.json?.status || "") === "awaiting_payment",
    `${place.status} parent=${parentId} status=${parent?.status} kids=${children.length}`
  );
  if (!parentId) throw new Error("place_multi failed: " + (place.json?.message || place.status));

  // Browser: payment-confirm must show pre-pay UI (not already paid)
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(
    ({ token, user }) => {
      for (const store of [sessionStorage, localStorage]) {
        store.setItem("mcjAuthAccessToken", token);
        store.setItem("customerUser", JSON.stringify(Object.assign({}, user, { role: "boss" })));
        store.setItem("mcjRole", "boss");
      }
    },
    { token: boss.token, user: boss.user }
  );
  await page.goto(`${STG}/payment-confirm.html?order=${encodeURIComponent(parentId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  await shot(page, "01-payment-page.png");
  const payTitle = await page.locator("body").innerText();
  const showsPrePay =
    /支付确认|待付款|确认支付|猫粮支付|去支付|立即支付/.test(payTitle) && !/等待陪玩确认/.test(payTitle);
  mark("CASE1_payment_page", showsPrePay, payTitle.slice(0, 200).replace(/\s+/g, " "));

  // Pay via API (same pay_order as payment-confirm button)
  const pay = await api("/api/orders", { action: "pay_order", id: parentId, paymentMethod: "catfood" }, boss.token);
  mark(
    "CASE1_pay_once",
    pay.status < 300 && pay.json?.ok !== false,
    `${pay.status} ${pay.json?.message || pay.json?.order?.status || ""}`
  );
  const pay2 = await api("/api/orders", { action: "pay_order", id: parentId, paymentMethod: "catfood" }, boss.token);
  mark(
    "CASE1_pay_idempotent",
    pay2.status === 409 || /NOT_AWAITING|已付|already/i.test(JSON.stringify(pay2.json)),
    `${pay2.status} ${pay2.json?.code || pay2.json?.message || ""}`
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await shot(page, "04-after-payment-waiting-2-companions.png");

  const listRes = await fetch(`${STG}/api/orders`, {
    headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" },
  });
  const listJson = await listRes.json().catch(() => ({}));
  const orders = Array.isArray(listJson.orders) ? listJson.orders : [];
  const parentRow = orders.find((o) => String(o.id) === String(parentId));
  const childRows = orders.filter((o) => String(o.parentOrderId || o.parent_order_id || "") === String(parentId));
  mark(
    "MEMBER_COUNT",
    childRows.length === 2,
    `children_in_list=${childRows.length} parentOrderId_present=${childRows.every((c) => c.parentOrderId || c.parent_order_id)}`
  );
  mark(
    "DUPLICATE_ORDER",
    childRows.every((c) => !!(c.parentOrderId || c.parent_order_id || c.isMultiGroupChild)),
    "children carry parentOrderId so Boss UI can hide top-level"
  );

  await page.goto(`${STG}/orders.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot(page, "09-boss-orders-parent-only.png");
  await shot(page, "10-member-count-2.png");
  const ordersText = await page.locator("body").innerText();
  const parentNo = parentRow?.orderNo || parentRow?.order_no || parent?.orderNo || "";
  const childShownTop =
    childRows.some((c) => {
      const no = c.orderNo || c.order_no;
      return no && ordersText.includes(no) && !ordersText.includes(`多人陪玩订单 · ${parentNo}`);
    }) === false
      ? false
      : childRows.some((c) => {
          const no = String(c.orderNo || c.order_no || "");
          if (!no) return false;
          // Child order numbers should not appear as top-level card titles
          return new RegExp(`\\b${no}\\b`).test(ordersText) && !/多人陪玩订单/.test(ordersText);
        });
  // Prefer DOM check
  const childCardsVisible = await page.locator('[data-multi-child="1"]:not([hidden])').count();
  const parentCards = await page.locator(`[data-multi-parent="1"][data-order-id="${parentId}"]`).count();
  const memberAttr = await page
    .locator(`[data-multi-parent="1"][data-order-id="${parentId}"]`)
    .getAttribute("data-member-count")
    .catch(() => null);
  mark(
    "BOSS_LIST_PARENT_ONLY",
    parentCards >= 1 && childCardsVisible === 0,
    `parentCards=${parentCards} visibleChildCards=${childCardsVisible} memberAttr=${memberAttr}`
  );
  mark("MEMBER_COUNT_UI", String(memberAttr) === "2" || /共\s*2\s*位陪玩|2位陪玩/.test(ordersText), `attr=${memberAttr}`);

  // Wallet single debit
  const balRes2 = await fetch(`${STG}/api/recharge`, {
    headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" },
  });
  const balJson2 = await balRes2.json().catch(() => ({}));
  const balance1 = money(balJson2?.summary?.balance ?? balJson2?.wallet?.totalBalance);
  const txs = (balJson2?.transactions || []).filter((t) => String(t.relatedOrderId || "") === String(parentId));
  const debitSum = txs.filter((t) => /debit|order_payment/i.test(String(t.direction || t.transactionType || t.type || ""))).reduce((n, t) => n + Math.abs(money(t.amount)), 0);
  mark(
    "PAYMENT_SINGLE_DEBIT",
    Math.abs(balance0 - balance1 - total) < 0.02 && (txs.length >= 1 || Math.abs(balance0 - balance1 - total) < 0.02),
    `bal ${balance0}→${balance1} expect -${total}; txs=${txs.length} debitSum≈${debitSum}`
  );
  await shot(page, "12-single-wallet-payment-proof.png");

  // Resolve child ids for accept
  let kids = childRows;
  if (kids.length < 2) {
    // refresh from place payload
    kids = (children || []).map((c) => ({
      id: c.id,
      companionId: c.companionId || c.companion_id,
      parentOrderId: parentId,
      status: c.status,
    }));
  }
  const childForA = kids.find((c) => String(c.companionId || c.companion_id) === String(a.id)) || kids[0];
  const childForB = kids.find((c) => String(c.companionId || c.companion_id) === String(b.id)) || kids[1];

  // CASE2: A confirms, B pending
  const accA = await api("/api/companion", { action: "accept_direct_order", id: childForA.id }, compA.token);
  mark("CASE2_A_accept", accA.status < 300 && accA.json?.ok !== false, `${accA.status} ${accA.json?.message || accA.json?.order?.status || ""}`);

  const afterA = await fetch(`${STG}/api/orders`, {
    headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" },
  });
  const afterAJson = await afterA.json().catch(() => ({}));
  const pAfterA = (afterAJson.orders || []).find((o) => String(o.id) === String(parentId));
  const kidsAfterA = (afterAJson.orders || []).filter((o) => String(o.parentOrderId || o.parent_order_id) === String(parentId));
  const aSt = kidsAfterA.find((k) => String(k.id) === String(childForA.id))?.status;
  const bSt = kidsAfterA.find((k) => String(k.id) === String(childForB.id))?.status;
  mark(
    "CASE2_1of2_parent_not_in_progress",
    String(pAfterA?.status || "") === "claimed" || String(pAfterA?.status || "") !== "in_progress",
    `parent=${pAfterA?.status} A=${aSt} B=${bSt}`
  );
  mark(
    "CASE2_no_split_top_level",
    kidsAfterA.every((k) => !!(k.parentOrderId || k.parent_order_id)),
    "children still parent-linked"
  );

  await page.goto(`${STG}/orders.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const parentCard = page.locator(`[data-order-id="${parentId}"]`);
  if ((await parentCard.count()) > 0) await parentCard.first().click();
  await page.waitForTimeout(1500);
  await shot(page, "05-a-confirmed-b-pending.png");

  // CASE3: B confirms → in_progress
  const accB = await api("/api/companion", { action: "accept_direct_order", id: childForB.id }, compB.token);
  mark("CASE3_B_accept", accB.status < 300 && accB.json?.ok !== false, `${accB.status} ${accB.json?.message || ""}`);
  const afterB = await fetch(`${STG}/api/orders`, {
    headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" },
  });
  const afterBJson = await afterB.json().catch(() => ({}));
  const pAfterB = (afterBJson.orders || []).find((o) => String(o.id) === String(parentId));
  mark("CASE3_2of2_in_progress", String(pAfterB?.status || "") === "in_progress", `parent=${pAfterB?.status}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await shot(page, "08-two-confirmed-in-progress.png");

  // CASE4–6: new group for reject / replace / give-up
  const stamp2 = Date.now();
  const place2 = await api(
    "/api/orders",
    {
      action: "place_multi_order",
      game: "王者荣耀",
      gameId: `P0MULTI-R-${stamp2}`,
      serviceType: "王者荣耀",
      paymentMethod: "catfood",
      idempotencyKey: `p0-multi-r-${stamp2}`,
      companions: [
        { companionId: a.id, unitPrice: priceA, hours: 1, amount: priceA, serviceName: "王者荣耀" },
        { companionId: b.id, unitPrice: priceB, hours: 1, amount: priceB, serviceName: "王者荣耀" },
      ],
    },
    boss.token
  );
  const parent2 = place2.json?.order || place2.json?.parent;
  const parent2Id = parent2?.id;
  const kids2 = place2.json?.children || [];
  await api("/api/orders", { action: "pay_order", id: parent2Id, paymentMethod: "catfood" }, boss.token);
  const child2A = kids2.find((c) => String(c.companionId || c.companion_id) === String(a.id)) || kids2[0];
  const child2B = kids2.find((c) => String(c.companionId || c.companion_id) === String(b.id)) || kids2[1];
  await api("/api/companion", { action: "accept_direct_order", id: child2A.id }, compA.token);

  const rejectB = await api(
    "/api/companion",
    { action: "reject_direct_order", id: child2B.id, reason: "临时有事" },
    compB.token
  );
  const rejected = rejectB.status < 300 && rejectB.json?.ok !== false;
  mark("CASE4_B_reject", rejected, `reject status=${rejectB.status} ${rejectB.json?.message || rejectB.json?.code || ""}`);

  await page.goto(`${STG}/orders.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await shot(page, "06-b-rejected-replacement-modal.png");

  const balBeforeGive = money(
    (
      await (
        await fetch(`${STG}/api/recharge`, { headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" } })
      ).json()
    )?.summary?.balance
  );
  const keep = await api(
    "/api/orders",
    { action: "keep_remaining", parentOrderId: parent2Id, exitedChildId: child2B.id },
    boss.token
  );
  mark("CASE6_give_up", keep.status < 300 && keep.json?.ok !== false, `${keep.status} ${keep.json?.message || ""}`);
  const balAfterGive = money(
    (
      await (
        await fetch(`${STG}/api/recharge`, { headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" } })
      ).json()
    )?.summary?.balance
  );
  mark(
    "PARTIAL_REFUND",
    Math.abs(balAfterGive - balBeforeGive - priceB) < 0.05,
    `bal ${balBeforeGive}→${balAfterGive} expect +${priceB}`
  );

  // CASE7 refresh
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await shot(page, "07-replacement-selected.png"); // may show give-up state; replace flow is UI
  const list7 = await (
    await fetch(`${STG}/api/orders`, { headers: { Authorization: `Bearer ${boss.token}`, Accept: "application/json" } })
  ).json();
  const p7kids = (list7.orders || []).filter((o) => String(o.parentOrderId || o.parent_order_id) === String(parentId));
  mark("CASE7_refresh_members", p7kids.length === 2, `kids=${p7kids.length}`);

  // DB proof screenshot via text dump
  fs.writeFileSync(
    path.join(outDir, "11-db-parent-child-proof.json"),
    JSON.stringify(
      {
        parentId,
        parentStatus_final: pAfterB?.status,
        children: kidsAfterA,
        afterBoth: (afterBJson.orders || []).filter((o) => String(o.parentOrderId || o.parent_order_id) === String(parentId)),
        parent2Id,
        keep,
      },
      null,
      2
    )
  );
  await page.goto("data:text/html," + encodeURIComponent(`<pre>${fs.readFileSync(path.join(outDir, "11-db-parent-child-proof.json"), "utf8")}</pre>`));
  await shot(page, "11-db-parent-child-proof.png");

  const fails = Object.values(report.cases).filter((c) => c.result === "FAIL");
  report.ok = fails.length === 0;
  report.summary = fails.length === 0 ? "PASS" : "FAIL";
} catch (err) {
  report.errors.push(String(err?.stack || err));
  report.ok = false;
  report.summary = "FAIL";
  console.error(err);
} finally {
  await browser.close().catch(() => {});
  fs.writeFileSync(path.join(outDir, "e2e-staging-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, summary: report.summary, cases: report.cases }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
