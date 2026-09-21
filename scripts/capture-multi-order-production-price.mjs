/**
 * Screenshots for the multi-order price P0.
 * 1) Current Production profile (live JS, may still show the 30 bug).
 * 2) This branch's scripts + live Production companion payloads (小灰灰 35 + 小宏 30).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outDir = "/opt/cursor/artifacts/multi-order-prod-price";
fs.mkdirSync(outDir, { recursive: true });

const PROD = "https://www.meowcuijiao.com";
const XIAOHUIHUI = "737b7c07-cab8-4270-a2da-6eee49135559";
const XIAOHONG = "458c3d2e-5803-403b-9a25-af1d12c8d142";
const LOCAL = process.env.ACCEPT_BASE || "http://127.0.0.1:8765";
const result = { production: {}, local: {} };

async function save(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function productionPass() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (msg) => logs.push(msg.type() + " " + msg.text()));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.goto(`${PROD}/profile.html?id=${XIAOHUIHUI}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scale: window.visualViewport ? window.visualViewport.scale : null,
  }));
  result.production.metrics = metrics;
  await save(page, "01_prod_mobile_profile_xiaohuihui.png");

  const opened = await page.evaluate(async () => {
    const btn = document.querySelector("[data-open-order]");
    if (btn) btn.click();
    for (let i = 0; i < 20; i++) {
      if (document.querySelector(".mcj-po-mask,[data-mcj-po-mask]")) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  });
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => (document.body.innerText || "").slice(0, 2500));
  result.production.modalOpened = opened;
  result.production.has35 = /35/.test(text);
  result.production.priceHits = (text.match(/单价[^\n]{0,24}|小计[^\n]{0,24}|30–40|猫粮/g) || []).slice(0, 12);
  await save(page, "01b_prod_mobile_order_modal.png");
  result.production.logs = logs.slice(-15);
  await ctx.close();

  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  const dpage = await desk.newPage();
  await dpage.goto(`${PROD}/profile.html?id=${XIAOHUIHUI}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await dpage.waitForTimeout(1200);
  await save(dpage, "06_prod_desktop_profile.png");
  await desk.close();
}

function toTeamLine(row, serviceName) {
  const services = Array.isArray(row.services) ? row.services : [];
  const picked = services.find((s) => s.name === serviceName) || services[0];
  return {
    companionId: row.id,
    companionName: row.name || row.nickname,
    avatar: row.avatar || row.cover || "",
    unitPrice: 30,
    service: picked?.name || serviceName,
    serviceId: picked?.serviceId || picked?.id || "",
    game: row.game,
    services,
    gamePrices: row.gamePrices || {},
    online: true,
    hours: 1,
    quantity: 1,
  };
}

async function localPass() {
  const hui = await fetch(`${PROD}/api/public/companions?id=${XIAOHUIHUI}`).then((r) => r.json());
  const hong = await fetch(`${PROD}/api/public/companions?id=${XIAOHONG}`).then((r) => r.json());
  const rowA = (hui.companions || [])[0];
  const rowB = (hong.companions || [])[0];
  result.local.payload = {
    a: (rowA.services || []).map((s) => [s.name, s.price]),
    b: (rowB.services || []).map((s) => [s.name, s.price]),
    aListing: rowA.price,
    bListing: rowB.price,
  };

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  await page.goto(`${LOCAL}/artifacts/multi-order-prod-price/accept.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MCJPlaceOrder && window.MCJMultiCompanionTeam);

  await page.evaluate((row) => {
    window.MCJPlaceOrder.openFromCompanion(row, {
      companionId: row.id,
      companionName: row.name,
      unitPrice: Number(row.priceValue != null ? row.priceValue : row.price) || 0,
      service: (row.services && row.services[0] && row.services[0].name) || row.game,
      services: row.services || [],
      gamePrices: row.gamePrices || {},
      avatar: row.avatar || "",
    });
  }, rowA);
  await page.waitForTimeout(400);
  const modalPrice = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      text: (t.match(/三角洲[^\n]{0,40}|单价[^\n]{0,20}|35|30/g) || []).slice(0, 20),
      hero: (document.querySelector(".mcj-po-mask") || {}).innerText?.slice(0, 500) || "",
    };
  });
  result.local.modal = modalPrice;
  await save(page, "02_local_mobile_service_35.png");

  const catalogServices = [
    { id: "9c74ee76-bf3f-4cfa-874e-5c7bc08ad228", name: "三角洲陪跑刀 一千万", price: 30, serviceId: "" },
    { id: "d380713c-e8f8-40cc-aa95-05df4d0b1e7e", name: "三角洲 手游 国服", price: 35, serviceId: "" },
    { id: "9237feb1-ea5a-48cb-a56f-63b2f7e79a33", name: "王者荣耀", price: 30, serviceId: "" },
  ];
  const afterCatalog = await page.evaluate(({ row, services }) => {
    window.MCJPlaceOrder.openFromCompanion(row, {
      companionId: row.id,
      companionName: row.name,
      unitPrice: Number(row.price) || 30,
      services,
      game: row.game,
      gamePrices: row.gamePrices || {},
    });
    const hero = (document.querySelector(".mcj-po-mask") || {}).innerText || "";
    return {
      keeps35: /35/.test(hero) && /当前服务：三角洲 手游 国服/.test(hero),
      flippedToRun: /当前服务：三角洲陪跑刀/.test(hero),
      snippet: hero.slice(0, 280),
    };
  }, { row: rowA, services: catalogServices });
  result.local.afterCatalogRefresh = afterCatalog;
  await save(page, "02b_local_mobile_after_catalog_refresh.png");
  await page.evaluate(() => window.MCJPlaceOrder && window.MCJPlaceOrder.close && window.MCJPlaceOrder.close());

  const added = await page.evaluate(
    ({ a, b }) => {
      window.MCJMultiCompanionTeam.clear();
      const ra = window.MCJMultiCompanionTeam.add(a);
      const rb = window.MCJMultiCompanionTeam.add(b);
      window.MCJMultiCompanionTeam.openCheckout();
      const raw = sessionStorage.getItem("mcjMultiTeamSelection");
      return { ra, rb, raw };
    },
    { a: toTeamLine(rowA, "三角洲 手游 国服"), b: toTeamLine(rowB, "王者荣耀 国服") }
  );
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll("[data-mcj-team-toast]").forEach((el) => el.remove());
  });
  const sheet = await page.evaluate(() => {
    const el = document.querySelector(".mcj-team-sheet");
    const foot = document.querySelector(".mcj-team-sheet-foot");
    const last = document.querySelector(".mcj-team-line:last-of-type");
    const fr = foot && foot.getBoundingClientRect();
    const lr = last && last.getBoundingClientRect();
    return {
      text: (document.querySelector(".mcj-team-sheet") || {}).innerText || "",
      footTop: fr && fr.top,
      lastBottom: lr && lr.bottom,
      overlap: !!(fr && lr && lr.bottom > fr.top + 2 && lr.top < fr.bottom),
      sheetH: el && el.getBoundingClientRect().height,
      innerH: window.innerHeight,
    };
  });
  result.local.added = { ra: added.ra, rb: added.rb };
  result.local.sheet = {
    overlap: sheet.overlap,
    footTop: sheet.footTop,
    lastBottom: sheet.lastBottom,
    has35: /单价 35/.test(sheet.text) || /单价\s*35/.test(sheet.text),
    has30: /单价 30/.test(sheet.text),
    total: (sheet.text.match(/合计[\s\S]{0,20}/) || [])[0],
  };
  await save(page, "03_local_mobile_team_two_prices.png");

  await page.evaluate(() => {
    const sc = document.querySelector(".mcj-team-sheet-scroll");
    if (sc) sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(200);
  const scrolled = await page.evaluate(() => {
    const sc = document.querySelector(".mcj-team-sheet-scroll");
    const foot = document.querySelector(".mcj-team-sheet-foot");
    const submit = document.querySelector("[data-mcj-team-submit]");
    const total = document.querySelector("[data-mcj-team-sheet-total]");
    function hit(el) {
      if (!el) return { ok: false };
      const r = el.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 2, Math.max(2, r.left + r.width / 2));
      const y = Math.min(window.innerHeight - 2, Math.max(2, r.top + Math.min(r.height / 2, r.height - 2)));
      const top = document.elementFromPoint(x, y);
      return { ok: !!(top && (top === el || el.contains(top))), top: top && (top.className || top.tagName), y };
    }
    return {
      scrollTop: sc && sc.scrollTop,
      scrollH: sc && sc.scrollHeight,
      clientH: sc && sc.clientHeight,
      submit: hit(submit),
      total: hit(total),
      footBottom: foot && Math.round(foot.getBoundingClientRect().bottom),
      innerH: window.innerHeight,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  result.local.scrolled = scrolled;
  await save(page, "05_local_mobile_scrolled_bottom.png");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MCJMultiCompanionTeam);
  const reloaded = await page.evaluate(() => {
    const raw = sessionStorage.getItem("mcjMultiTeamSelection");
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    const lines = (parsed && parsed.lines) || [];
    if (window.MCJMultiCompanionTeam.openCheckout) window.MCJMultiCompanionTeam.openCheckout();
    return lines.map((l) => ({
      name: l.companionName,
      service: l.service,
      unitPrice: l.unitPrice,
      serviceId: l.serviceId,
    }));
  });
  await page.waitForTimeout(300);
  result.local.reload = reloaded;
  await save(page, "04_local_mobile_checkout_after_reload.png");
  await ctx.close();

  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  const dpage = await desk.newPage();
  await dpage.goto(`${LOCAL}/artifacts/multi-order-prod-price/accept.html`, { waitUntil: "domcontentloaded" });
  await dpage.waitForFunction(() => window.MCJMultiCompanionTeam);
  await dpage.evaluate(
    ({ a, b }) => {
      window.MCJMultiCompanionTeam.clear();
      window.MCJMultiCompanionTeam.add(a);
      window.MCJMultiCompanionTeam.add(b);
      window.MCJMultiCompanionTeam.openCheckout();
    },
    { a: toTeamLine(rowA, "三角洲 手游 国服"), b: toTeamLine(rowB, "王者荣耀 国服") }
  );
  await dpage.waitForTimeout(400);
  const deskLayout = await dpage.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    sheets: document.querySelectorAll(".mcj-team-sheet").length,
    feet: document.querySelectorAll(".mcj-team-sheet-foot").length,
    innerW: window.innerWidth,
  }));
  result.local.desktop = deskLayout;
  await save(dpage, "06_local_desktop_checkout.png");
  await desk.close();
}

try {
  await productionPass();
  await localPass();
  result.ok = true;
} catch (err) {
  result.ok = false;
  result.error = String(err && err.stack || err);
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
