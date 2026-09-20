/**
 * Capture multi-order mobile P0 acceptance screenshots (local fixed branch).
 */
import { chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/multi-order-mobile-p0");
const optDir = "/opt/cursor/artifacts/multi-order-mobile-p0";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(optDir, { recursive: true });

const BASE = process.env.ACCEPT_BASE || "http://127.0.0.1:8765";
const url = BASE + "/artifacts/multi-order-mobile-p0/accept.html";

function save(page, name) {
  const p1 = path.join(outDir, name);
  const p2 = path.join(optDir, name);
  return page.screenshot({ path: p1, fullPage: false }).then(() => {
    fs.copyFileSync(p1, p2);
    return p1;
  });
}

const result = { ok: false, steps: [] };

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  // Desktop-ish for admin + place-order price
  const desk = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const dpage = await desk.newPage();
  await dpage.goto(url, { waitUntil: "networkidle" });
  await dpage.waitForTimeout(400);
  await save(dpage, "01_admin_service_prices_delta_35.png");
  result.steps.push("01 admin prices");

  await dpage.click("#btnOpen35");
  await dpage.waitForTimeout(700);
  await save(dpage, "02_place_order_unit_35.png");
  result.steps.push("02 place order 35");

  // Mobile iPhone profile with stacked bars
  const iphone = devices["iPhone 13"];
  const mob = await browser.newContext({
    ...iphone,
    locale: "zh-CN",
  });
  const mpage = await mob.newPage();
  await mpage.goto(url, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(400);

  // Seed team with A=35 without leaving via 再加一位 navigation
  await mpage.evaluate(() => {
    window.MCJMultiCompanionTeam.clear();
    return window.MCJMultiCompanionTeam.add({
      companionId: "458c3d2e-5803-403b-9a25-af1d12c8d142",
      companionName: "小宏",
      avatar: "/default-avatar.png",
      unitPrice: 30,
      service: "三角洲手游 国服",
      serviceId: "svc-delta",
      services: [
        { name: "王者荣耀", price: 30, serviceId: "svc-wz" },
        { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
        { name: "三角洲陪跑刀 一千万", price: 30, serviceId: "svc-knife" },
      ],
      online: true,
    });
  });
  await mpage.waitForTimeout(500);
  // Ensure both bars are in the visual viewport before hit-testing
  await mpage.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    if (window.MCJMultiCompanionTeam._test) {
      window.MCJMultiCompanionTeam._test.syncBottomStackOffset();
    }
  });
  await mpage.waitForTimeout(200);
  await save(mpage, "04_mobile_team_bar_above_bottom_ctas.png");
  result.steps.push("04 stacked bars");

  // Hit-test: all four buttons should be clickable (no overlap covering)
  const hit = await mpage.evaluate(() => {
    function centerClickable(sel) {
      const el = document.querySelector(sel);
      if (!el) return { sel, ok: false, reason: "missing" };
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
      const y = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      const ok = !!(top && (top === el || el.contains(top) || (top.closest && top.closest(sel))));
      return {
        sel,
        ok,
        x,
        y,
        top: top && (top.className || top.tagName),
        rect: { top: r.top, bottom: r.bottom, height: r.height },
      };
    }
    const team = document.querySelector("[data-mcj-team-bar]");
    const bottom = document.querySelector(".profile-bottom-bar");
    const tr = team && team.getBoundingClientRect();
    const br = bottom && bottom.getBoundingClientRect();
    const gap = tr && br ? Math.round(br.top - tr.bottom) : null;
    return {
      continue: centerClickable("[data-mcj-team-continue]"),
      checkout: centerClickable("[data-mcj-team-checkout]"),
      cs: centerClickable(".pd-bottom-secondary"),
      order: centerClickable(".pd-bottom-primary"),
      offset: getComputedStyle(document.documentElement).getPropertyValue("--mcj-bottom-actions-h"),
      teamBottom: team ? getComputedStyle(team).bottom : "",
      teamPosition: team ? getComputedStyle(team).position : "",
      gapPx: gap,
      noOverlap: gap == null ? false : gap >= 4,
    };
  });
  result.hitTest = hit;
  const allClickable =
    hit.continue.ok && hit.checkout.ok && hit.cs.ok && hit.order.ok && hit.noOverlap;
  result.steps.push("hitTest " + (allClickable ? "PASS" : "FAIL"));

  // Continue选 → real hall navigation
  const continuePromise = mpage.waitForURL(/companion-center\.html/, { timeout: 5000 });
  await mpage.click("[data-mcj-team-continue]");
  let continueHref = null;
  try {
    await continuePromise;
    continueHref = mpage.url();
  } catch (e) {
    continueHref = null;
  }
  result.continueNav = {
    href: continueHref,
    picking: await mpage.evaluate(() => sessionStorage.getItem("mcjMultiTeamPicking")),
  };
  await save(mpage, "05_continue_select_targets_hall.png");
  result.steps.push("05 continue → hall");

  // Return to accept page, restore draft A, simulate picking B
  await mpage.goto(url, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(400);
  await mpage.evaluate(() => {
    window.MCJMultiCompanionTeam.clear();
    window.MCJMultiCompanionTeam.add({
      companionId: "458c3d2e-5803-403b-9a25-af1d12c8d142",
      companionName: "小宏",
      avatar: "/default-avatar.png",
      unitPrice: 30,
      service: "三角洲手游 国服",
      serviceId: "svc-delta",
      services: [
        { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
        { name: "三角洲陪跑刀 一千万", price: 30, serviceId: "svc-knife" },
      ],
      online: true,
    });
    sessionStorage.setItem("mcjMultiTeamPicking", "1");
    return window.MCJMultiCompanionTeam.add({
      companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      companionName: "陪玩B",
      avatar: "/default-avatar.png",
      unitPrice: 30,
      service: "三角洲陪跑刀 一千万",
      serviceId: "svc-knife-b",
      services: [{ name: "三角洲陪跑刀 一千万", price: 30, serviceId: "svc-knife-b" }],
      online: true,
    });
  });
  await mpage.waitForTimeout(600);
  await save(mpage, "03_multi_total_65.png");
  await save(mpage, "06_after_add_B_auto_checkout.png");
  result.steps.push("06 A+B=65 checkout");

  const total = await mpage.evaluate(() => ({
    total: window.MCJMultiCompanionTeam.getTotal(),
    lines: window.MCJMultiCompanionTeam.getLines().map((l) => ({
      name: l.companionName,
      service: l.service,
      unitPrice: l.unitPrice,
      serviceId: l.serviceId,
    })),
    sheet: (document.querySelector("[data-mcj-team-sheet-total]") || {}).textContent || "",
  }));
  result.totals = total;

  // Mask probe — back on accept page, close overlays, open modal + submit
  await mpage.goto(url, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(300);
  await mpage.evaluate(() => {
    document.querySelectorAll("[data-mcj-team-sheet],.mcj-po-mask,[data-mcj-po-mask],[data-mcj-team-bar]").forEach((n) => n.remove());
  });
  const maskProbe = await mpage.evaluate(() => {
    try {
      window.MCJPlaceOrder.open({
        companionId: "458c3d2e-5803-403b-9a25-af1d12c8d142",
        companionName: "小宏",
        avatar: "/default-avatar.png",
        unitPrice: 35,
        service: "三角洲手游 国服",
        serviceId: "svc-delta",
        services: [{ name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" }],
        online: true,
      });
    } catch (e) {
      return { hasMaskError: /Can't find variable:\s*mask/i.test(String(e.message)), thrown: String(e.message) };
    }
    try {
      const gid = document.querySelector("[data-po-game-id]");
      if (gid) gid.value = "boss-gid-demo";
      window.MCJPlaceOrder.submit();
      return { hasMaskError: false, invoked: true };
    } catch (err) {
      return {
        hasMaskError: /Can't find variable:\s*mask/i.test(String(err.message)),
        thrown: String(err.message),
      };
    }
  });
  result.maskProbe = maskProbe;
  await mpage.waitForTimeout(500);
  await save(mpage, "07_iphone_no_mask_error.png");
  result.steps.push("07 mask probe");

  await save(mpage, "07b_iphone_place_order_scale.png");

  result.ok =
    allClickable &&
    /companion-center\.html/.test(String(result.continueNav.href || "")) &&
    total.total === 65 &&
    total.lines[0].unitPrice === 35 &&
    total.lines[1].unitPrice === 30 &&
    !maskProbe.hasMaskError;

  await desk.close();
  await mob.close();
} catch (e) {
  result.error = String(e && e.stack || e);
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
fs.copyFileSync(path.join(outDir, "result.json"), path.join(optDir, "result.json"));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
