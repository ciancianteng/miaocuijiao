import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.PREVIEW_URL || "https://meow-cuijiao-homepage-b11jr2yoe-ciancianteng-4581s-projects.vercel.app";
const OUT = path.resolve("tmp/cs-p2-verify");
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => {
    if (m.type() === "error") console.log("ERR", m.text().slice(0, 200));
  });

  // login
  await page.goto(`${BASE}/customer-service/login/`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="account"]', "service@meow.test");
  await page.fill('input[name="password"]', "McjTest@12345678");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto(`${BASE}/customer-service/conversations`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const w = Number((document.querySelector('[data-conv-filter="waiting"] em') || {}).textContent || -1);
    return w > 0;
  }, { timeout: 120000 });

  const before = await page.evaluate(() => ({
    waiting: Number(document.querySelector('[data-conv-filter="waiting"] em').textContent),
    active: Number(document.querySelector('[data-conv-filter="active"] em').textContent),
    ended: Number(document.querySelector('[data-conv-filter="ended"] em').textContent),
    unreadNav: document.querySelector("[data-nav-unread]")?.textContent || "0",
  }));
  console.log("before", before);
  await page.screenshot({ path: path.join(OUT, "03-pool-before.png"), fullPage: true });

  // Find a waiting card with unread
  await page.locator('[data-conv-filter="waiting"]').click();
  await page.waitForTimeout(500);
  let target = page.locator(".cs-conversation:has(.cs-conv-unread)").first();
  if (!(await target.count())) target = page.locator(".cs-conversation").first();
  const unreadText = await target.locator(".cs-conv-unread").textContent().catch(() => "0");
  console.log("open unread badge", unreadText);
  await target.click();
  await page.waitForTimeout(2000);

  const afterOpen = await page.evaluate(() => ({
    waiting: Number(document.querySelector('[data-conv-filter="waiting"] em').textContent),
    active: Number(document.querySelector('[data-conv-filter="active"] em').textContent),
    unreadNav: document.querySelector("[data-nav-unread]:not([hidden])")?.textContent || "0",
    activeUnread: document.querySelector(".cs-conversation.active .cs-conv-unread") ? "yes" : "no",
    take: !!document.querySelector("[data-take]"),
    end: !!document.querySelector("[data-end]"),
    head: document.querySelector(".cs-chat-head")?.innerText?.slice(0, 120) || "",
  }));
  console.log("afterOpen", afterOpen);
  await page.screenshot({ path: path.join(OUT, "03b-after-open.png"), fullPage: true });

  if (afterOpen.take) {
    const acceptResp = page.waitForResponse((r) => /\/accept|customer-service/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 }).catch(() => null);
    await page.click("[data-take]");
    const resp = await acceptResp;
    if (resp) {
      const t = await resp.text().catch(() => "");
      console.log("accept resp", resp.status(), t.slice(0, 250));
    }
    await page.waitForTimeout(2500);
    const afterAccept = await page.evaluate(() => ({
      waiting: Number(document.querySelector('[data-conv-filter="waiting"] em').textContent),
      active: Number(document.querySelector('[data-conv-filter="active"] em').textContent),
      ended: Number(document.querySelector('[data-conv-filter="ended"] em').textContent),
      unreadNav: document.querySelector("[data-nav-unread]:not([hidden])")?.textContent || "0",
      take: !!document.querySelector("[data-take]"),
      end: !!document.querySelector("[data-end]"),
      filter: document.querySelector(".cs-conv-tab.active")?.textContent || "",
    }));
    console.log("afterAccept", afterAccept);
    await page.screenshot({ path: path.join(OUT, "04-pool-after-accept.png"), fullPage: true });

    if (afterAccept.end) {
      await page.click("[data-end]");
      await page.waitForTimeout(3000);
      const afterEnd = await page.evaluate(() => ({
        waiting: Number(document.querySelector('[data-conv-filter="waiting"] em').textContent),
        active: Number(document.querySelector('[data-conv-filter="active"] em').textContent),
        ended: Number(document.querySelector('[data-conv-filter="ended"] em').textContent),
      }));
      console.log("afterEnd", afterEnd);
      await page.screenshot({ path: path.join(OUT, "05-pool-after-end.png"), fullPage: true });
    }
  }

  // attendance screenshot
  await page.goto(`${BASE}/customer-service/dashboard`);
  await page.waitForSelector(".cs-att-section", { timeout: 120000 });
  await page.waitForFunction(() => !document.body.innerText.includes("正在读取真实数据"), { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, "01-dashboard-attendance-after.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "02-attendance-mobile-cards.png"), fullPage: true });

  fs.writeFileSync(path.join(OUT, "flow.json"), JSON.stringify({ before, afterOpen }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
