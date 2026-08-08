import fs from "node:fs";
import { chromium } from "playwright-core";

function chrome() {
  for (const p of [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

fs.mkdirSync("tmp-restore-verify", { recursive: true });

const browser = await chromium.launch({ executablePath: chrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://127.0.0.1:4173/?v=pw2", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);

const homeInfo = await page.evaluate(() => {
  const hot = [...document.querySelectorAll("#hotCompanionTrack .companion-card:not(.hot-more-card)")].map((c) => ({
    name: (c.querySelector("h3") || {}).textContent,
    id: c.getAttribute("data-companion-id"),
  }));
  const pop = (document.querySelector('[aria-label*="人气"]') || {}).innerText || "";
  const empty = (document.body.innerText || "").includes("暂无陪玩");
  return { hot, pop: pop.slice(0, 500), empty };
});

await page.locator("#hotCompanionTrack").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: "tmp-restore-verify/local-hot.png" });

const popLoc = page.locator('[aria-label*="人气"]');
if (await popLoc.count()) {
  await popLoc.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "tmp-restore-verify/local-popularity.png" });
}

await page.goto("http://127.0.0.1:4173/companion-center.html", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: "tmp-restore-verify/local-hall.png" });

const hallInfo = await page.evaluate(() => {
  const text = document.body.innerText || "";
  return {
    countMatch: (text.match(/共\s*\d+\s*位陪玩/) || [])[0] || null,
    empty: text.includes("暂无陪玩"),
    names: [...document.querySelectorAll(".companion-card h3, .companion-card .name")].map((n) => n.textContent).slice(0, 8),
  };
});

console.log(JSON.stringify({ homeInfo, hallInfo }, null, 2));
await browser.close();
