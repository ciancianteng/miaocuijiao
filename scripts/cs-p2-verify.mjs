import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = "https://meow-cuijiao-homepage-hmhx3tr2j-ciancianteng-4581s-projects.vercel.app";
const OUT = path.resolve("tmp/cs-p2-verify");
fs.mkdirSync(OUT, { recursive: true });
const results = { preview: BASE, ready: true, steps: [] };
function log(step, ok, detail) {
  results.steps.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

async function loginRole(page, rolePath, email, password) {
  await page.goto(`${BASE}${rolePath}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('input[name="account"], input[name="email"], input[type="email"]', { timeout: 30000 });
  const account = page.locator('input[name="account"], input[name="email"], input[type="email"]').first();
  const pwd = page.locator('input[name="password"], input[type="password"]').first();
  await account.fill(email);
  await pwd.fill(password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
}

async function createBossSupportMessage(context) {
  const page = await context.newPage();
  // Boss login via homepage/login if needed
  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  // Try API auth directly
  const auth = await page.evaluate(async () => {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: "login", email: "boss@meow.test", password: "McjTest@12345678", role: "boss" }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  console.log("boss auth", auth.status, JSON.stringify(auth.body).slice(0, 200));
  const token = auth.body?.session?.accessToken || auth.body?.token || auth.body?.access_token || "";
  const bossId = auth.body?.session?.user?.id || auth.body?.user?.id || auth.body?.profile?.id || "";
  const msg = await page.evaluate(async ({ token }) => {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (token) {
      headers.Authorization = "Bearer " + token;
      headers["x-mcj-access-token"] = token;
    }
    const r = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "send",
        content: "CS-P2-VERIFY 未读测试 " + Date.now(),
        message_type: "text",
      }),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  }, { token });
  console.log("boss chat", msg.status, JSON.stringify(msg.body).slice(0, 300));
  await page.close();
  return msg;
}

async function readCounts(page) {
  return page.evaluate(() => {
    const get = (f) => {
      const btn = document.querySelector(`[data-conv-filter="${f}"] em`);
      return btn ? Number(btn.textContent || 0) : null;
    };
    const unreadNav = document.querySelector("[data-nav-unread]");
    return {
      waiting: get("waiting"),
      active: get("active"),
      ended: get("ended"),
      unreadNav: unreadNav && !unreadNav.hidden ? String(unreadNav.textContent || "0") : "0",
      cards: document.querySelectorAll(".cs-conversation").length,
      unreads: document.querySelectorAll(".cs-conv-unread").length,
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    // Seed a waiting conversation with unread
    await createBossSupportMessage(context);

    await loginRole(page, "/customer-service/login/", "service@meow.test", "McjTest@12345678");
    await page.goto(`${BASE}/customer-service/dashboard`, { waitUntil: "domcontentloaded", timeout: 90000 });
    // Bootstrap can take 30–60s on Preview.
    await page.waitForFunction(() => {
      const loading = document.body.innerText.includes("正在读取真实数据");
      const att = document.querySelector(".cs-att-section");
      return !loading && !!att;
    }, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "01-dashboard-attendance-after.png"), fullPage: true });
    const hasAtt = await page.locator(".cs-att-section").count();
    log("attendance-section", hasAtt > 0, hasAtt ? "ok" : "missing");
    const ths = await page.locator(".cs-att-table thead th").allTextContents();
    log("attendance-columns", ths.join("|").includes("上班时间") && ths.join("|").includes("当日工时"), ths.join(" | "));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    log("no-page-overflow", !overflow, overflow ? "overflow" : "ok");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "02-attendance-mobile-cards.png"), fullPage: true });
    log("mobile-cards", (await page.locator(".cs-att-cards").count()) > 0, "cards container present");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/customer-service/conversations`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".cs-conv-tabs", { timeout: 45000 });
    await page.waitForFunction(() => {
      if (document.body.innerText.includes("正在读取真实数据")) return false;
      const w = document.querySelector('[data-conv-filter="waiting"] em');
      return w && Number(w.textContent || 0) >= 0 && !document.body.innerText.includes("正在读取");
    }, { timeout: 120000 }).catch(() => {});
    // Extra: wait until waiting count > 0 or any conversation card exists
    await page.waitForFunction(() => {
      const w = Number((document.querySelector('[data-conv-filter="waiting"] em') || {}).textContent || 0);
      const a = Number((document.querySelector('[data-conv-filter="active"] em') || {}).textContent || 0);
      const cards = document.querySelectorAll(".cs-conversation").length;
      return w + a > 0 || cards > 0;
    }, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.locator('[data-conv-filter="waiting"]').click();
    await page.waitForTimeout(800);
    let before = await readCounts(page);
    log("pool-before", before.waiting != null, JSON.stringify(before));
    await page.screenshot({ path: path.join(OUT, "03-pool-before.png"), fullPage: true });

    // If still empty, try active/ended for smoke; else create via soft refresh after seed
    if (!before.cards) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      await page.locator('[data-conv-filter="waiting"]').click();
      await page.waitForTimeout(800);
      before = await readCounts(page);
      log("pool-before-retry", before.cards > 0, JSON.stringify(before));
    }

    const first = page.locator(".cs-conversation").first();
    if (!(await first.count())) {
      log("flow", false, "still no conversations after seed");
    } else {
      const unreadBeforeNav = before.unreadNav;
      await first.click();
      await page.waitForTimeout(1800);
      const afterOpen = await readCounts(page);
      const unreadCleared = (await page.locator(".cs-conversation.active .cs-conv-unread").count()) === 0;
      log("unread-clear", unreadCleared, `nav ${unreadBeforeNav} -> ${afterOpen.unreadNav}; active badge cleared=${unreadCleared}`);

      const take = page.locator("[data-take]").first();
      if (await take.count()) {
        const w0 = afterOpen.waiting;
        const a0 = afterOpen.active;
        await take.click();
        await page.waitForTimeout(2500);
        const afterAccept = await readCounts(page);
        const acceptOk = afterAccept.waiting < w0 && afterAccept.active > a0;
        log("accept-waiting-to-active", acceptOk, `w ${w0}->${afterAccept.waiting}; a ${a0}->${afterAccept.active}`);
        await page.screenshot({ path: path.join(OUT, "04-pool-after-accept.png"), fullPage: true });

        const end = page.locator("[data-end]").first();
        if (await end.count()) {
          page.once("dialog", (d) => d.accept());
          const a1 = afterAccept.active;
          const e1 = afterAccept.ended;
          await end.click();
          await page.waitForTimeout(3000);
          const afterEnd = await readCounts(page);
          log("end-active-to-ended", afterEnd.active < a1 && afterEnd.ended > e1, `a ${a1}->${afterEnd.active}; e ${e1}->${afterEnd.ended}`);
          await page.screenshot({ path: path.join(OUT, "05-pool-after-end.png"), fullPage: true });
        } else {
          log("end-active-to-ended", false, "no end button");
        }
      } else {
        // already claimed — still verify unread clear
        log("accept-waiting-to-active", false, "no take button (already claimed?)");
      }
    }

    await page.goto(`${BASE}/customer-service/dashboard`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, "07-dashboard-metrics.png"), fullPage: true });
    const metrics = await page.evaluate(() => ({
      current: document.querySelector("[data-metric-current]")?.textContent,
      unread: document.querySelector("[data-metric-unread]")?.textContent,
    }));
    log("dashboard-metrics", metrics.current != null && metrics.unread != null, JSON.stringify(metrics));
  } catch (err) {
    log("script-error", false, String(err && err.stack ? err.stack : err));
    await page.screenshot({ path: path.join(OUT, "99-error.png"), fullPage: true }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    await browser.close();
  }
}

main();
