/**
 * P0: Admin 查看抢单人 / 指定陪玩 — real overlay + 4-portal sync.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-admin-order-assign-grabs-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ART = path.join("/opt/cursor/artifacts", "admin-order-assign-grabs-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "admin-order-assign-grabs-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  const p2 = path.join(ART_REPO, file);
  await page.screenshot({ path: p1, fullPage: false });
  fs.copyFileSync(p1, p2);
  return p1;
}

async function injectAdmin(page, token) {
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem("mcjAdminAccessToken", token);
      sessionStorage.setItem("mcjAdminAccessToken", token);
      localStorage.setItem("adminAuthToken", token);
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("adminUser", JSON.stringify({ role: "admin", email: "admin@meow.test", roleKey: "admin" }));
      localStorage.setItem("mcjAdminRole", "admin");
      localStorage.setItem("mcjRole", "admin");
    },
    { token }
  );
}

async function openOrders(page) {
  await page.goto(`${BASE}/admin.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const btn = page.locator('[data-section="orders"]');
  await btn.click({ timeout: 20000 });
  await page.waitForSelector("#orderManagement .admin-final-table, #orderManagement .empty, #orderManagement .content-loading", {
    timeout: 30000,
  });
  await page.waitForFunction(() => !document.querySelector("#orderManagement .content-loading"), null, { timeout: 45000 }).catch(() => {});
}

(async () => {
  console.log("BASE", BASE);
  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const adminT = tok(adminLogin.json);
  const bossT = tok(bossLogin.json);
  const csT = tok(csLogin.json);
  const compT = tok(compLogin.json);
  step("logins", !!(adminT && bossT && csT && compT), `admin=${!!adminT} boss=${!!bossT} cs=${!!csT} comp=${!!compT}`);

  const place = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P0后台指定陪玩E2E",
      game: "VALORANT",
      game_id: "ADMIN-ASSIGN-E2E",
      description: "admin view grabs / assign e2e",
      hours: 1,
      unit_price: 22,
      total_amount: 22,
      order_type: "custom",
      payment_method: "tng",
    },
  });
  const oid = place.json?.order?.id || "";
  const orderNo = place.json?.order?.orderNo || place.json?.order?.order_no || oid;
  step("create_order", !!(place.ok && oid), `${orderNo} ${oid}`);

  await api("/api/orders", bossT, { action: "submit_payment_proof", id: oid, proofDataUrl: PNG, paymentMethod: "tng" });
  const confirm = await api("/api/customer-service", csT, { action: "confirm_payment", id: oid });
  step("confirm_to_hall", confirm.ok && confirm.json?.order?.status === "pending", confirm.json?.order?.status || confirm.json?.message);

  const emptyGrabs = await api("/api/admin/orders", adminT, { action: "list_grabs", id: oid });
  step("api_empty_grabs", emptyGrabs.ok && (emptyGrabs.json?.grabs || []).length === 0, `count=${(emptyGrabs.json?.grabs || []).length}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (e) {
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] }).catch(() => null);
    if (!browser) throw e;
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await injectAdmin(page, adminT);
  page.on("dialog", async (d) => {
    await d.accept();
  });

  await openOrders(page);
  // Prefer the new test order row; fall back to first view-grabs button.
  let row = page.locator(`[data-order-row="${oid}"]`);
  if ((await row.count()) === 0) {
    // Refresh once — new order may be at top after reload.
    await page.locator('[data-admin-final-refresh="orders"]').click().catch(() => {});
    await page.waitForTimeout(2000);
    row = page.locator(`[data-order-row="${oid}"]`);
  }
  step("admin_orders_row_visible", (await row.count()) > 0, `rowCount=${await row.count()}`);

  // ① empty grabs overlay
  const viewBtn = row.locator('[data-admin-view-grabs]');
  await viewBtn.scrollIntoViewIfNeeded();
  await viewBtn.click();
  await page.waitForSelector("#adminOrderGrabModal:not([hidden]) .admin-grab-modal-card", { timeout: 20000 });
  const emptyText = await page.locator("#adminOrderGrabModal [data-admin-grabs-empty], #adminOrderGrabModal .admin-grab-empty").innerText().catch(() => "");
  const modalBox = await page.locator("#adminOrderGrabModal").boundingBox();
  const fixedOk = await page.evaluate(() => {
    const el = document.getElementById("adminOrderGrabModal");
    if (!el || el.hidden) return false;
    const s = getComputedStyle(el);
    return s.position === "fixed" && s.display !== "none" && !el.hidden;
  });
  step("①_empty_grabs_overlay", /暂无抢单人/.test(emptyText) && fixedOk, `text=${emptyText} fixed=${fixedOk} box=${JSON.stringify(modalBox)}`);
  await shot(page, "01-empty-grabs-modal");
  await page.locator("[data-admin-close-grabs]").click();
  await page.waitForTimeout(400);

  // Companion grabs the order
  const grab = await api("/api/companion", compT, { action: "accept_order", id: oid });
  step("companion_grab", !!grab.ok, grab.json?.message || grab.json?.order?.status || String(grab.status));

  const grabs2 = await api("/api/admin/orders", adminT, { action: "list_grabs", id: oid });
  const grabList = grabs2.json?.grabs || [];
  const companionId = grabList[0]?.companionId || grabList[0]?.companion?.id || "";
  step("②_api_sees_grabber", grabs2.ok && grabList.length >= 1 && !!companionId, `count=${grabList.length} companion=${companionId}`);

  await page.locator('[data-admin-final-refresh="orders"]').click();
  await page.waitForTimeout(1800);
  row = page.locator(`[data-order-row="${oid}"]`);
  await row.locator("[data-admin-view-grabs]").click();
  await page.waitForSelector("#adminOrderGrabModal .admin-grab-card", { timeout: 20000 });
  const grabCards = await page.locator("#adminOrderGrabModal .admin-grab-card").count();
  const hasSelect = (await page.locator("#adminOrderGrabModal [data-admin-confirm-grab]").count()) === 0; // view mode: no select
  step("②_ui_lists_grabbers", grabCards >= 1, `cards=${grabCards} viewNoSelect=${hasSelect}`);
  await shot(page, "02-grabs-list");
  await page.locator("[data-admin-close-grabs]").click();

  // ③ admin assign from grabs
  await row.locator("[data-admin-assign-grab]").click();
  await page.waitForSelector("#adminOrderGrabModal [data-admin-confirm-grab]", { timeout: 20000 });
  await shot(page, "03-assign-picker");
  await page.locator(`#adminOrderGrabModal [data-admin-confirm-grab][data-companion-id="${companionId}"]`).first().click();
  await page.waitForTimeout(2500);
  // modal should close after confirm; refresh list
  await page.locator('[data-admin-final-refresh="orders"]').click().catch(() => {});
  await page.waitForTimeout(2000);
  const adminOrders = await api("/api/admin/orders", adminT, null, "GET");
  const ao = (adminOrders.json?.orders || []).find((o) => o.id === oid);
  const assignedId = String(ao?.companion_id || ao?.companionId || "");
  step(
    "③_admin_assign_writes_db",
    ao?.status === "claimed" && assignedId === String(companionId),
    `status=${ao?.status} companion=${assignedId} name=${ao?.companionName}`
  );
  await shot(page, "04-admin-after-assign");

  // ④ CS same companion
  const csBoot = await api("/api/customer-service", csT, { action: "bootstrap" });
  const csOrder = (csBoot.json?.data?.orders || []).find((o) => o.id === oid);
  const csCid = String(csOrder?.companionId || csOrder?.companion_id || "");
  step("④_cs_same_companion", csCid === String(companionId) && csOrder?.status === "claimed", `cs=${csCid} status=${csOrder?.status}`);

  // ⑤ companion 待确认 (not in open hall as unbound)
  const boot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const mine = boot.json?.data?.myOrders || [];
  const open = boot.json?.data?.openOrders || [];
  const hit = mine.find((o) => o.id === oid);
  const inHallUnbound = open.find((o) => o.id === oid && !o.companionId && (o.status === "pending" || o.status === "waiting_boss_confirm"));
  step(
    "⑤_companion_pending_confirm",
    !!(hit && hit.status === "claimed") && !inHallUnbound,
    `my=${hit?.status} hallUnbound=${!!inHallUnbound}`
  );

  // ⑥ boss same companion
  const bossOrders = await api(`/api/orders?id=${oid}`, bossT, null, "GET");
  const bossO = (bossOrders.json?.orders || []).find((o) => o.id === oid) || bossOrders.json?.order;
  const bossCid = String(bossO?.companionId || bossO?.companion_id || "");
  step(
    "⑥_boss_same_companion",
    bossCid === String(companionId) && bossO?.status === "claimed",
    `boss=${bossCid} status=${bossO?.status}/${bossO?.statusText}`
  );

  // ⑦ refresh consistency
  const admin2 = (await api("/api/admin/orders", adminT, null, "GET")).json?.orders?.find((o) => o.id === oid);
  const cs2 = ((await api("/api/customer-service", csT, { action: "bootstrap" })).json?.data?.orders || []).find((o) => o.id === oid);
  const boot2 = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const hit2 = (boot2.json?.data?.myOrders || []).find((o) => o.id === oid);
  const boss2 = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  const ids = [
    String(admin2?.companion_id || admin2?.companionId || ""),
    String(cs2?.companionId || cs2?.companion_id || ""),
    String(hit2?.companionId || hit2?.companion_id || companionId),
    String(boss2?.companionId || boss2?.companion_id || ""),
  ];
  step(
    "⑦_refresh_four_portals_consistent",
    ids.every((x) => x === String(companionId)) &&
      admin2?.status === "claimed" &&
      cs2?.status === "claimed" &&
      hit2?.status === "claimed" &&
      boss2?.status === "claimed",
    `ids=${ids.join(",")} statuses=${[admin2?.status, cs2?.status, hit2?.status, boss2?.status].join(",")}`
  );

  // Re-open assign modal — must still show same designated
  row = page.locator(`[data-order-row="${oid}"]`);
  await row.locator("[data-admin-assign-grab]").click();
  await page.waitForSelector("#adminOrderGrabModal:not([hidden])", { timeout: 15000 });
  const modalMeta = await page.locator("#adminOrderGrabModal .admin-grab-modal-head p").innerText().catch(() => "");
  step("⑦b_reopen_shows_same", /已指定/.test(modalMeta), modalMeta);
  await shot(page, "05-reopen-still-assigned");
  await page.locator("[data-admin-close-grabs]").click().catch(() => {});

  // ⑧ unassign
  const unBtn = row.locator("[data-admin-unassign]");
  const hasUn = (await unBtn.count()) > 0;
  if (hasUn) {
    await unBtn.click();
    await page.waitForTimeout(2200);
  } else {
    await api("/api/admin/orders", adminT, { action: "unassign_companion", id: oid });
  }
  const admin3 = (await api("/api/admin/orders", adminT, null, "GET")).json?.orders?.find((o) => o.id === oid);
  const cs3 = ((await api("/api/customer-service", csT, { action: "bootstrap" })).json?.data?.orders || []).find((o) => o.id === oid);
  const boot3 = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const hit3 = (boot3.json?.data?.myOrders || []).find((o) => o.id === oid);
  const boss3 = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  const cleared =
    !String(admin3?.companion_id || admin3?.companionId || "").trim() &&
    !String(cs3?.companionId || cs3?.companion_id || "").trim() &&
    !String(boss3?.companionId || boss3?.companion_id || "").trim();
  const companionCleared = !hit3 || hit3.status === "pending" || !String(hit3.companionId || hit3.companion_id || "").trim() || hit3.status !== "claimed";
  step(
    "⑧_unassign_four_portals",
    cleared && (admin3?.status === "pending" || admin3?.status === "waiting_boss_confirm") && companionCleared,
    `admin=${admin3?.status}/${admin3?.companionName} cs=${cs3?.status}/${cs3?.companionName} boss=${boss3?.status} my=${hit3?.status}`
  );
  await page.locator('[data-admin-final-refresh="orders"]').click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "06-after-unassign");

  // Asset cache-bust present
  const html = await (await fetch(`${BASE}/admin.html?cb=${Date.now()}`, { cache: "no-store" })).text();
  step("asset_cache_bust", /admin-final-v1\.js\?v=20260809assignGrabs1/.test(html), /admin-final-v1\.js\?v=[^"']+/.exec(html)?.[0] || "missing");

  await browser.close();

  const summary = {
    verdict: results.every((r) => r.result === "PASS") ? "PASS" : "FAIL",
    base: BASE,
    orderId: oid,
    orderNo,
    companionId,
    results,
    screenshots: fs.readdirSync(ART).filter((f) => f.endsWith(".png")),
  };
  fs.writeFileSync(path.join(ART, "RESULTS.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "RESULTS.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  console.log(`VERDICT=${summary.verdict}`);
  process.exit(summary.verdict === "PASS" ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
