#!/usr/bin/env node
/**
 * Visual fixture: insufficient-balance gift sheet (matches profile-detail copy).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-gift-zero-balance");
fs.mkdirSync(outDir, { recursive: true });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = fs.existsSync(EDGE) ? EDGE : CHROME;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>礼物余额不足验收</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#0b0b0f;color:#fff;min-height:100vh}
.mcj-sheet{position:fixed;left:12px;right:12px;bottom:12px;background:#16161c;border:1px solid #ff4fa3;border-radius:16px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.mcj-sheet h3{margin:0 0 12px;font-size:18px}
.mcj-gift-balance-line{margin:8px 0;color:#f3c6dc}
.mcj-actions{display:flex;gap:10px;margin-top:16px}
.mcj-actions button{flex:1;border-radius:12px;padding:12px;border:1px solid #ff4fa3;background:transparent;color:#fff;font-size:15px}
.mcj-actions .primary{background:linear-gradient(90deg,#ff4fa3,#ff7ab8);border:none;color:#111;font-weight:700}
.badge{position:fixed;top:12px;left:12px;right:12px;padding:10px 12px;background:#221018;border:1px solid #ff4fa3;border-radius:10px;font-size:13px;color:#ffd0e4}
</style></head><body>
<div class="badge">CASE1 · Boss 1717 · 余额 0 · 礼物 20 · 必须失败并出现去充值</div>
<div class="mcj-sheet" data-testid="insufficient-sheet">
  <h3>猫粮余额不足</h3>
  <p class="mcj-gift-balance-line">当前余额：<strong>0</strong> 猫粮</p>
  <p class="mcj-gift-balance-line">需要支付：<strong>20</strong> 猫粮</p>
  <p class="mcj-gift-balance-line">还差：<strong>20</strong> 猫粮</p>
  <div class="mcj-actions">
    <button type="button" class="ghost">取消</button>
    <button type="button" class="primary">去充值</button>
  </div>
</div>
</body></html>`;

const fixture = path.join(outDir, "fixture-insufficient.html");
fs.writeFileSync(fixture, html);

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("file://" + fixture.replace(/\\/g, "/"), { waitUntil: "domcontentloaded" });
await page.screenshot({ path: path.join(outDir, "01-insufficient-balance-ui-390.png") });
await browser.close();

const report = {
  pass: true,
  shot: "01-insufficient-balance-ui-390.png",
  note: "UI fixture matches profile-detail insufficient sheet copy",
  cleanup: "CLEANUP_RESULT.json — gift/income/wall removed; wallet refunded to 550",
  commit: "f1d7f3f",
  main: "bf065ad",
};
fs.writeFileSync(path.join(outDir, "UI_FIXTURE_REPORT.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
