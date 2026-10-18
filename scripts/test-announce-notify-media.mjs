import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import playwright from "/tmp/mcj-pay-verify/node_modules/playwright-core/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const stagingOrigin = "https://meow-cuijiao-homepage-staging.vercel.app";
const productionRef = "jqfaknpmcnqwqvatrwgo";
const stagingRef = "cfccwysniduwkjskiqgy";

process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
process.env.SUPABASE_ANON_KEY = "anon-test";

const { mediaTypeConstraintFallback, assertImageUpload } = await import("../server/api/_companion-media-store.js");
require("../src/notify-target.js");
require("../src/mcj-upload.js");
const notify = globalThis.MCJNotifyTarget;
const uploadApi = globalThis.MCJUpload;

const results = [];
function pass(name) {
  results.push(name);
}

const appointment = notify.bossNotifyTarget({ kind: "appointment", relatedId: "apt-1" });
assert.equal(appointment.ok, false);
assert.equal(appointment.url, undefined);
assert.match(appointment.message, /预约/);
pass("appointment id is not opened as an order");

const missingOrder = notify.bossNotifyTarget({ kind: "order", relatedId: "" });
assert.equal(missingOrder.ok, false);
assert.match(missingOrder.message, /缺少订单编号/);
pass("order notice without an id stays put");

const order = notify.bossNotifyTarget({ kind: "order", relatedId: "MCJ0000999" });
assert.equal(order.ok, true);
assert.equal(order.url, "/orders.html?id=MCJ0000999");
pass("order notice keeps the real order id");

const cs = notify.bossNotifyTarget({ kind: "cs_reply", relatedId: "MCJ0000999" });
assert.equal(cs.url, "/support.html?order=MCJ0000999");
const gift = notify.bossNotifyTarget({ kind: "gift", relatedId: "" });
assert.equal(gift.url, "/gifts.html");
const recharge = notify.bossNotifyTarget({ kind: "recharge" });
assert.equal(recharge.url, "/recharge.html");
const unknown = notify.bossNotifyTarget({ kind: "payroll", relatedId: "x" });
assert.equal(unknown.ok, false);
pass("cs, gift, recharge, and unknown kinds keep their own targets");

assert.equal(notify.portalReturnAllowed("companion", "https://evil.example/companion/orders", "https://meow.local"), "");
assert.equal(notify.portalReturnAllowed("companion", "/orders.html?id=1", "https://meow.local"), "");
assert.equal(notify.portalReturnAllowed("companion", "/companion/orders?focus=abc", "https://meow.local"), "/companion/orders?focus=abc");
assert.equal(notify.portalReturnAllowed("customer_service", "/customer-service/reports/", "https://meow.local"), "/customer-service/reports/");
assert.equal(notify.portalReturnAllowed("customer_service", "/companion/orders", "https://meow.local"), "");
assert.equal(notify.portalReturnAllowed("boss", "/admin/login", "https://meow.local"), "");
assert.equal(notify.portalReturnAllowed("boss", "/orders.html?id=1", "https://meow.local"), "/orders.html?id=1");
pass("login return url is same-origin and role-scoped");

const heic = uploadApi.validateFile({ name: "IMG.HEIC", type: "", size: 1000 }, "image");
assert.equal(heic.ok, false);
assert.match(heic.error, /HEIC/);
const empty = uploadApi.validateFile({ name: "photo", type: "", size: 1000 }, "image");
assert.equal(empty.ok, false);
const octet = uploadApi.validateFile({ name: "shot.png", type: "application/octet-stream", size: 1000 }, "image");
assert.equal(octet.ok, true);
const jpeg = uploadApi.validateFile({ name: "shot.jpg", type: "image/jpeg", size: 1000 }, "image");
assert.equal(jpeg.ok, true);
pass("empty mime and HEIC are rejected; jpg and png still pass");

assert.throws(() => assertImageUpload({ buffer: Buffer.from("heic"), contentType: "image/heic" }), /HEIC/);
assert.equal(mediaTypeConstraintFallback("achievement", { message: "23514 media_type check constraint" }), false);
assert.equal(mediaTypeConstraintFallback("gallery", { message: "23514 media_type check constraint" }), false);
assert.equal(mediaTypeConstraintFallback("cover", { message: "23514 new row violates check constraint media_type" }), true);
assert.equal(mediaTypeConstraintFallback("video", { message: "network down" }), false);
assert.equal(mediaTypeConstraintFallback("cover", { message: "permission denied" }), false);
pass("only a cover or video media_type check can fall back");

const companionSource = fs.readFileSync(path.join(root, "server/api/companion.js"), "utf8");
assert.equal(companionSource.includes("战绩上传成功"), false);
assert.match(companionSource, /mediaTypeConstraintFallback\(mediaType, insertErr\)/);
assert.match(companionSource, /战绩截图暂不能写入/);
const reorder = companionSource.slice(companionSource.indexOf('action === "reorder_media"'));
assert.match(reorder.slice(0, 700), /sort_order: order/);
assert.equal(/media_type:/.test(reorder.slice(0, 700)), false);
pass("reorder writes sort only and achievement is not saved as gallery");

const workbench = fs.readFileSync(path.join(root, "src/companion-workbench.js"), "utf8");
assert.match(workbench, /confirmUploadAfterTimeout/);
assert.match(workbench, /isPersonalAlbumPhoto/);
assert.equal(workbench.includes("sortOrder>=500") || workbench.includes("sort_order >= 500"), false);
pass("timeout re-reads media and album type ignores sort");

const staging = { build: null, home: null, companion: null, deployedHomeHasFailureCopy: null, deployedCompanionAudience: "" };
const buildRes = await fetch(`${stagingOrigin}/api/build-info`, { headers: { Accept: "application/json" } });
staging.build = await buildRes.json();
assert.equal(buildRes.ok, true);
assert.notEqual(staging.build.supabaseRef, productionRef);
assert.equal(staging.build.supabaseIsProduction, false);
assert.equal(staging.build.supabaseIsStaging, true);
assert.equal(staging.build.isolationOk, true);
pass("staging build-info is isolated from production");

for (const audience of ["home", "companion"]) {
  const res = await fetch(`${stagingOrigin}/api/platform/content?types=announcements&audience=${audience}`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.json();
  staging[audience === "home" ? "home" : "companion"] = { status: res.status, body };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.byType.announcements));
}
pass("staging announcement API returns an array for home and companion");

const homeHtml = await fetch(`${stagingOrigin}/`).then((res) => res.text());
const asset = homeHtml.match(/\/assets\/index-[^"]+\.js/);
assert.ok(asset, "staging homepage bundle");
const bundle = await fetch(`${stagingOrigin}${asset[0]}`).then((res) => res.text());
staging.deployedBundle = asset[0];
staging.deployedHome = {
  hasFailureCopy: bundle.includes("公告加载失败"),
  hasTrialDefault: bundle.includes("试运营"),
  hasDefaultId: bundle.includes("mcj-default-home-ops-announcement"),
};
const companionScript = await fetch(`${stagingOrigin}/src/companion-announcements.js`).then((res) => res.text());
staging.deployedCompanion = {
  hasFailureCopy: companionScript.includes("公告加载失败"),
  requestsHome: companionScript.includes("audience=home"),
  requestsCompanion: companionScript.includes("audience=companion"),
};

const dbUrl = process.env.STAGING_DATABASE_URL || "";
if (!dbUrl) {
  staging.db = "STAGING_DATABASE_URL missing";
} else if (dbUrl.includes(productionRef) || !dbUrl.includes(stagingRef)) {
  throw new Error("refused database target that is not isolated staging");
} else {
  const query = spawnSync(
    "psql",
    [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", "select category||'|'||audience||'|'||is_active::text||'|'||left(title,24) from announcements order by created_at desc limit 20;"],
    { encoding: "utf8" }
  );
  if (query.status !== 0) throw new Error("announcement read failed");
  staging.dbRows = query.stdout.trim().split("\n").filter(Boolean);
  pass("staging announcement rows were read without writes");
}

const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="/src/home-announcements.css">
<style>body{margin:0;background:#0b0a10}main{padding:16px 12px}</style></head><body><main>
<div id="homeAnnouncementBar" class="announcement-strip" hidden></div>
<div class="pw-announcement-host" data-pw-announcement-host hidden></div>
<script src="/src/home-announcements.js"></script>
<script src="/src/companion-announcements.js"></script>
<script>window.MCJCompanionAnnouncements.start();</script>
</main></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/fixture.html") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(fixture);
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let mode = "live";
const browser = await playwright.chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 812 } });
await page.route("**/api/platform/content**", async (route) => {
  const audience = new URL(route.request().url()).searchParams.get("audience");
  if (mode === "fail") {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    return;
  }
  const live = audience === "companion" ? staging.companion.body : staging.home.body;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(live) });
});
await page.goto(`http://127.0.0.1:${port}/fixture.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.innerText.includes("暂无最新公告") || document.body.innerText.includes("公告加载失败"));
const liveText = await page.locator("body").innerText();
const homeLiveEmpty = Array.isArray(staging.home.body.byType.announcements) && staging.home.body.byType.announcements.length === 0;
const companionLiveEmpty = Array.isArray(staging.companion.body.byType.announcements) && staging.companion.body.byType.announcements.length === 0;
if (homeLiveEmpty) assert.match(await page.locator("#homeAnnouncementBar").innerText(), /暂无最新公告/);
if (companionLiveEmpty) assert.match(await page.locator("[data-pw-announcement-bar]").innerText(), /暂无最新公告/);
assert.equal(liveText.includes("公告加载失败"), false);
assert.equal(liveText.includes("试运营"), false);
await page.screenshot({ path: "/opt/cursor/artifacts/announcement-staging-live-390.png", fullPage: true });
pass("current source renders the live staging payload without a fake default");

mode = "fail";
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.innerText.includes("公告加载失败"));
assert.match(await page.locator("#homeAnnouncementBar").innerText(), /公告加载失败/);
assert.match(await page.locator("[data-pw-announcement-bar]").innerText(), /公告加载失败/);
await page.screenshot({ path: "/opt/cursor/artifacts/announcement-forced-fail-390.png", fullPage: true });
pass("forced API failure still shows the failure copy");

await browser.close();
server.close();

const report = {
  results,
  staging: {
    env: staging.build.env,
    envLabel: staging.build.envLabel,
    supabaseRef: staging.build.supabaseRef,
    supabaseIsProduction: staging.build.supabaseIsProduction,
    supabaseIsStaging: staging.build.supabaseIsStaging,
    isolationOk: staging.build.isolationOk,
    homeStatus: staging.home.status,
    homeCount: staging.home.body.byType.announcements.length,
    companionStatus: staging.companion.status,
    companionCount: staging.companion.body.byType.announcements.length,
    deployedBundle: staging.deployedBundle,
    deployedHome: staging.deployedHome,
    deployedCompanion: staging.deployedCompanion,
    dbRows: staging.dbRows || staging.db || [],
  },
};
fs.writeFileSync("/opt/cursor/artifacts/announce-notify-media.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
