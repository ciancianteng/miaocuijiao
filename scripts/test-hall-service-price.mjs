import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import playwright from "/tmp/mcj-pay-verify/node_modules/playwright-core/index.mjs";
import {
  hallPriceSummary,
  priceForGame,
  serviceQuotes,
} from "../server/api/_game-prices.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceA = "21e0c745-77a4-41a6-9286-f2351b074450";
const serviceB = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const single = hallPriceSummary({
  price: 35,
  service_ids: [serviceA],
  game: "三角洲",
  game_prices: { [serviceA]: 35, 三角洲: 35 },
});
assert.equal(single.price, 35);
assert.equal(single.count, 1);
assert.equal(single.label, "35 猫粮起");
assert.equal(priceForGame({ price: 35, service_ids: [serviceA], game: "三角洲", game_prices: { [serviceA]: 35 } }, "三角洲", serviceA), 35);

const multiCompanion = {
  price: 60,
  service_ids: [serviceA, serviceB],
  game: "三角洲、无畏契约",
  game_prices: { [serviceA]: 35, 三角洲: 35, [serviceB]: 60, 无畏契约: 60 },
};
const multi = hallPriceSummary(multiCompanion);
assert.equal(multi.price, 35);
assert.equal(multi.label, "35 猫粮起");
assert.equal(multi.count, 2);
assert.equal(priceForGame(multiCompanion, "无畏契约", serviceB), 60);
assert.equal(priceForGame(multiCompanion, "三角洲", serviceA), 35);
assert.notEqual(priceForGame(multiCompanion, "无畏契约", serviceB), multi.price);

const changed = {
  price: 35,
  service_ids: [serviceA],
  game: "三角洲 手游 国服",
  game_prices: { [serviceA]: 60, "三角洲 手游": 60 },
};
const changedSummary = hallPriceSummary(changed);
assert.equal(changedSummary.price, 35);
assert.equal(changedSummary.label, "35 猫粮起");
assert.equal(priceForGame(changed, "三角洲 手游 国服", serviceA), 35);
assert.equal(serviceQuotes(changed)[0].price, 35);

const fromRows = hallPriceSummary(
  { price: 60, service_ids: [serviceA], game_prices: {} },
  [{ service_id: serviceA, service_name: "三角洲", price: 35, enabled: true, review_status: "approved" }]
);
assert.equal(fromRows.price, 35);
assert.equal(fromRows.label, "35 猫粮起");
assert.equal(priceForGame(
  { price: 60, service_ids: [serviceA], game_prices: { [serviceA]: 35 } },
  "三角洲",
  serviceA
), 35);

const noQuote = hallPriceSummary({ price: 60, service_ids: [], game: "", game_prices: {} });
assert.equal(noQuote.state, "no_quote");
assert.equal(noQuote.price, 0);
assert.equal(noQuote.label, "暂无报价");
assert.equal(priceForGame({ price: 60, game_prices: {} }, "三角洲", serviceA), 0);
assert.equal(priceForGame({ price: 60, service_ids: [serviceA], game_prices: {} }, "三角洲", serviceA), 0);
assert.equal(
  priceForGame(
    { price: 100, game_prices: {}, service_ids: [] },
    "默认服务",
    "",
    [{ service_name: "默认服务", price: 20, enabled: true, review_status: "approved" }]
  ),
  20
);

const disabledRow = hallPriceSummary(
  { price: 60, game_prices: {} },
  [{ service_id: serviceA, service_name: "三角洲", price: 60, enabled: false, review_status: "approved" }]
);
assert.equal(disabledRow.state, "no_quote");

const historicalOrder = { order_no: "MCJ0000435", unit_price: 60, total_amount: 120 };
assert.equal(historicalOrder.unit_price, 60);
assert.equal(historicalOrder.total_amount, 120);
const ordersSource = fs.readFileSync(path.join(root, "server/api/orders.js"), "utf8");
assert.equal(ordersSource.includes("unitPrice = money(cp.price)"), false);
assert.match(ordersSource, /尚未设置有效服务报价/);
assert.match(ordersSource, /Client unit\/total are only a mismatch check/);

const companions = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "单服务",
    priceValue: 35,
    priceState: "quoted",
    priceLabel: "35 猫粮起",
    serviceQuoteCount: 1,
    game: "三角洲",
    availabilityStatus: "online",
    status: "在线可接单",
    avatar: "/default-avatar.png",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "多服务",
    priceValue: 35,
    priceState: "quoted",
    priceLabel: "35 猫粮起",
    serviceQuoteCount: 2,
    game: "三角洲、无畏契约",
    availabilityStatus: "online",
    status: "在线可接单",
    avatar: "/default-avatar.png",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "无报价",
    priceValue: 0,
    price: 60,
    hourlyPrice: 60,
    priceState: "no_quote",
    priceLabel: "暂无报价",
    serviceQuoteCount: 0,
    game: "未设置",
    availabilityStatus: "offline",
    status: "离线",
    avatar: "/default-avatar.png",
  },
];

const fixture = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/companion-hall.css">
<style>body{margin:0;background:#0b0a10;color:#f8f5f8}#playerList{display:grid;gap:12px;padding:12px}</style>
</head><body>
<div id="resultCount"></div>
<div id="playerList"></div>
<div id="emptyState" hidden><strong></strong><span></span></div>
<div id="companionPagination"></div>
<script src="/src/companion-hall.js"></script>
</body></html>`;

function listen() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/fixture.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(fixture);
      return;
    }
    if (url.pathname === "/default-avatar.png") {
      res.statusCode = 200;
      res.end("");
      return;
    }
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("missing");
      return;
    }
    res.setHeader("content-type", file.endsWith(".css") ? "text/css" : "text/javascript");
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = await listen();
const port = server.address().port;
const browser = await playwright.chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.route("**/api/public/companions**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, companions }),
  })
);
await page.route("**/api/dev/seed-p03-preview", (route) => route.fulfill({ status: 204, body: "" }));

const shots = [];
for (const width of [375, 390]) {
  await page.setViewportSize({ width, height: 812 });
  await page.goto(`http://127.0.0.1:${port}/fixture.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.innerText.includes("35 猫粮起") && document.body.innerText.includes("暂无报价"));
  const text = await page.locator("#playerList").innerText();
  assert.match(text, /35 猫粮起/);
  assert.equal(text.includes("猫粮/小时"), false);
  assert.equal(text.includes("60"), false);
  const orderPrices = await page.locator("[data-hall-order]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: node.getAttribute("data-hall-name"),
      price: node.getAttribute("data-hall-price"),
    }))
  );
  assert.deepEqual(orderPrices, [
    { name: "单服务", price: "35" },
    { name: "多服务", price: "" },
    { name: "无报价", price: "" },
  ]);
  const file = `/opt/cursor/artifacts/hall-price-${width}.png`;
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
}

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log(JSON.stringify({
  ok: true,
  checks: ["single-35", "multi-min-35-order-60", "stale-60-to-35", "service-row-35", "no-quote-ignores-60", "historical-order-untouched", "hall-375", "hall-390"],
  shots,
}, null, 2));
