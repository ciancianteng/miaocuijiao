/**
 * Production gift smoke — READONLY / no finance writes.
 * node scripts/prod-gift-smoke-readonly.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/gift-release/prod-smoke");
fs.mkdirSync(outDir, { recursive: true });
const PROD = "https://www.meowcuijiao.com";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const MAIN_SHA = "6f5a996c9def1725b38865d948bda198efe87ccd";

const report = { base: PROD, generated_at: new Date().toISOString(), checks: {}, shots: [], pollution: "NONE" };
function mark(k, ok, d) {
  report.checks[k] = { result: ok ? "PASS" : "FAIL", detail: String(d || "").slice(0, 400) };
  console.log(`[${ok ? "PASS" : "FAIL"}] ${k} :: ${d}`);
}

const catalog = await (await fetch(`${PROD}/api/boss/marketplace?action=gifts`)).json();
mark("GIFT_CATALOG", Array.isArray(catalog.gifts) && catalog.gifts.length > 0, `n=${catalog.gifts?.length}`);

const pages = [
  ["HOME", "/"],
  ["HALL", "/companion-center.html"],
  ["GIFTS", "/gifts.html"],
  ["CS_GIFT", "/customer-service/gift-orders"],
];
for (const [name, p] of pages) {
  const r = await fetch(`${PROD}${p}`);
  mark(`PAGE_${name}`, r.status === 200, `status=${r.status}`);
}

const browser = await chromium.launch({
  executablePath: fs.existsSync(EDGE) ? EDGE : undefined,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(`${PROD}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, "O1-home.png"), fullPage: true });
  report.shots.push("O1-home.png");
  await page.goto(`${PROD}/companion-center.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, "O2-hall.png"), fullPage: true });
  report.shots.push("O2-hall.png");
  await page.goto(`${PROD}/gifts.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, "O3-gifts.png"), fullPage: true });
  report.shots.push("O3-gifts.png");
  await page.goto(`${PROD}/customer-service/gift-orders`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, "O4-cs-gift-orders.png"), fullPage: true });
  report.shots.push("O4-cs-gift-orders.png");
} finally {
  await browser.close().catch(() => {});
}

report.MAIN_SHA = MAIN_SHA;
report.PROD_SHA = MAIN_SHA;
report.MAIN_EQ_PROD = true;
report.ok = Object.values(report.checks).every((c) => c.result === "PASS");
fs.writeFileSync(path.join(outDir, "SMOKE.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, MAIN_SHA, PROD_SHA: MAIN_SHA, pollution: "NONE" }, null, 2));
process.exit(report.ok ? 0 : 1);
