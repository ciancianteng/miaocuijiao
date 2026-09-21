#!/usr/bin/env node
/**
 * Capture profile「真实订单评价」empty + existing review screenshots.
 * Serves local Vite; mocks /api/public/companions for deterministic UI.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts", "profile-reviews-empty-copy");
const uploadDir = "/opt/cursor/artifacts/profile-reviews-empty-copy";
mkdirSync(outDir, { recursive: true });
mkdirSync(uploadDir, { recursive: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";

const emptyCompanion = {
  id: "empty-review-companion",
  uid: "empty-review-companion",
  name: "验收空评价",
  companionCode: "PW00999",
  online: false,
  desc: "用于验收真实订单评价空状态文案",
  gameName: "综合游戏",
  levelName: "未设置等级",
  priceMin: 0,
  priceMax: 0,
  reviewCount: 0,
  completedOrders: 0,
  reviews: [],
  rating: 0,
  goodReviewCount: 0,
};

const withReviewsCompanion = {
  ...emptyCompanion,
  id: "has-review-companion",
  uid: "has-review-companion",
  name: "验收有评价",
  companionCode: "PW00998",
  reviewCount: 2,
  completedOrders: 3,
  rating: 5,
  goodReviewCount: 2,
  reviews: [
    {
      rating: 5,
      content: "沟通顺畅，准时上号，体验很好会再约。",
      bossCode: "B10001",
      orderNo: "MCJ202609210001",
      gameName: "三角洲 手游",
      createdAt: "2026-09-18T12:00:00.000Z",
    },
    {
      rating: 4,
      content: "技术稳定，氛围轻松，推荐。",
      bossCode: "B10002",
      orderNo: "MCJ202609200002",
      gameName: "永劫无间",
      createdAt: "2026-09-19T15:30:00.000Z",
    },
  ],
};

function companionPayload(c) {
  return JSON.stringify({ ok: true, companions: [c] });
}

async function shotReviewWall(page, fileBase, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForSelector(".real-review-wall", { timeout: 15000 });
  await page.locator(".real-review-wall").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const wall = page.locator(".real-review-wall");
  const shotPath = path.join(outDir, `${fileBase}.png`);
  await wall.screenshot({ path: shotPath });
  const uploadPath = path.join(uploadDir, `${fileBase}.png`);
  await wall.screenshot({ path: uploadPath });
  // Also full-page crop around review for context
  const fullPath = path.join(outDir, `${fileBase}_full.png`);
  await page.screenshot({ path: fullPath, fullPage: false });
  await page.screenshot({ path: path.join(uploadDir, `${fileBase}_full.png`), fullPage: false });
  const text = await wall.innerText();
  return { shotPath, text };
}

async function openProfile(page, companion) {
  await page.route("**/api/public/companions**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: companionPayload(companion),
    });
  });
  await page.route("**/api/popularity**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.goto(`${BASE}/profile.html?id=${encodeURIComponent(companion.id)}&_=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    // Mobile 0 reviews
    {
      const page = await browser.newPage();
      await openProfile(page, emptyCompanion);
      const r = await shotReviewWall(page, "01_mobile_0_reviews", { width: 390, height: 844 });
      const pass =
        r.text.includes("真实订单评价") &&
        r.text.includes("新人陪玩") &&
        r.text.includes("暂无评价") &&
        r.text.includes("完成订单后将展示老板的真实评价与排名") &&
        !r.text.includes("⭐");
      results.push({ case: "A mobile 0-review", pass, text: r.text });
      await page.close();
    }

    // Desktop 0 reviews
    {
      const page = await browser.newPage();
      await openProfile(page, emptyCompanion);
      const r = await shotReviewWall(page, "02_desktop_0_reviews", { width: 1280, height: 900 });
      const pass =
        r.text.includes("真实订单评价") &&
        r.text.includes("新人陪玩") &&
        r.text.includes("暂无评价") &&
        r.text.includes("完成订单后将展示老板的真实评价与排名");
      results.push({ case: "E desktop 0-review", pass, text: r.text });
      await page.close();
    }

    // With reviews (desktop)
    {
      const page = await browser.newPage();
      await openProfile(page, withReviewsCompanion);
      const r = await shotReviewWall(page, "03_desktop_with_reviews", { width: 1280, height: 900 });
      const pass =
        r.text.includes("真实订单评价") &&
        r.text.includes("沟通顺畅") &&
        !r.text.includes("暂无评价") &&
        !r.text.includes("完成订单后将展示老板的真实评价与排名");
      results.push({ case: "B/C with reviews", pass, text: r.text.slice(0, 400) });
      await page.close();
    }

    // Mobile with reviews (layout sanity)
    {
      const page = await browser.newPage();
      await openProfile(page, withReviewsCompanion);
      const r = await shotReviewWall(page, "04_mobile_with_reviews", { width: 390, height: 844 });
      const pass = r.text.includes("沟通顺畅") && !r.text.includes("暂无评价");
      results.push({ case: "D mobile with reviews", pass, text: r.text.slice(0, 300) });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const summary = {
    overall: results.every((r) => r.pass) ? "PASS" : "FAIL",
    results,
    outDir,
    uploadDir,
  };
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(uploadDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.overall !== "PASS") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
