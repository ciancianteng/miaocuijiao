import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import playwright from "/tmp/mcj-pay-verify/node_modules/playwright-core/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";

const calls = [];
let handler = async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return handler(String(url), init || {});
};

const { saveAnnouncement } = await import("../server/api/admin/content.js");

function dbRow(extra) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "数据库标题",
    content: "数据库正文",
    category: "home",
    audience: "home",
    is_active: true,
    is_pinned: false,
    published_at: "2026-10-18T00:00:00.000Z",
    updated_at: "2026-10-18T01:02:03.000Z",
    created_at: "2026-10-18T00:00:00.000Z",
    ...extra,
  };
}

async function expectFail(fn, status) {
  await assert.rejects(fn, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.ok, undefined);
    assert.ok(String(error.message || "").trim());
    return true;
  });
}

calls.length = 0;
handler = async (url, init) => {
  if (init.method === "POST") return new Response(JSON.stringify([dbRow()]), { status: 201, headers: { "content-type": "application/json" } });
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
};
const created = await saveAnnouncement({ title: "客户端标题", content: "客户端正文", category: "home", audience: "home" });
assert.equal(created.id, "11111111-1111-1111-1111-111111111111");
assert.equal(created.updated_at, "2026-10-18T01:02:03.000Z");
assert.equal(created.title, "数据库标题");
assert.equal(calls.some((call) => call.init.method === "POST"), true);

calls.length = 0;
handler = async (url, init) => {
  if (!init.method || init.method === "GET") return new Response(JSON.stringify([dbRow({ title: "旧标题" })]), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify([dbRow({ title: "新标题", content: "新正文", updated_at: "2026-10-18T02:00:00.000Z" })]), { status: 200, headers: { "content-type": "application/json" } });
};
const updated = await saveAnnouncement({ id: created.id, title: "新标题", content: "新正文", category: "home", audience: "home" });
assert.equal(updated.title, "新标题");
assert.equal(updated.updated_at, "2026-10-18T02:00:00.000Z");

calls.length = 0;
handler = async (url, init) => {
  if (!init.method || init.method === "GET") return new Response(JSON.stringify([dbRow()]), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
};
await expectFail(() => saveAnnouncement({ id: created.id, title: "不会写入", content: "不会写入", category: "home", audience: "home" }), 409);
assert.equal(calls.filter((call) => call.init.method === "PATCH").length, 1);

calls.length = 0;
handler = async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
await expectFail(() => saveAnnouncement({ id: "missing-id", title: "不存在", content: "不存在", category: "home", audience: "home" }), 404);
assert.equal(calls.some((call) => call.init.method === "PATCH"), false);

calls.length = 0;
handler = async (url, init) => {
  if (init.method === "POST") return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
};
await expectFail(() => saveAnnouncement({ title: "插入失败", content: "插入失败", category: "home", audience: "home" }), 502);

handler = async () => new Response(JSON.stringify({ message: "database unavailable" }), { status: 500, headers: { "content-type": "application/json" } });
await expectFail(() => saveAnnouncement({ title: "数据库错误", content: "数据库错误", category: "home", audience: "home" }), 500);

const homeSource = fs.readFileSync(path.join(root, "src/home-announcements.js"), "utf8");
const adminSource = fs.readFileSync(path.join(root, "src/admin-final-v1.js"), "utf8");
assert.equal(homeSource.includes("PLATFORM_DEFAULT_HOME_ANNOUNCEMENTS"), false);
assert.equal(adminSource.includes("a.category==='companion'?'companion':'home'"), false);
assert.equal(adminSource.includes("category')==='customer_service'?'customer_service':'home'"), true);

const { announcementItem, matchesAnnouncementAudience } = await import("../server/api/platform/content.js");
const homeOnly = announcementItem({
  id: "home-only",
  title: "仅首页通知",
  content: "只在官网首页",
  category: "homepage_only",
  audience: "home",
  is_active: true,
});
assert.equal(homeOnly.category, "homepage_only");
assert.equal(homeOnly.audience, "home");
assert.equal(matchesAnnouncementAudience(homeOnly, "home"), true);
assert.equal(matchesAnnouncementAudience(homeOnly, "boss"), false);
assert.equal(matchesAnnouncementAudience(homeOnly, "companion"), false);
const csItem = announcementItem({
  id: "cs-1",
  title: "客服通知",
  content: "客服可见",
  category: "customer_service",
  audience: "customer_service",
  is_active: true,
});
assert.equal(csItem.category, "customer_service");
assert.equal(csItem.audience, "customer_service");
assert.equal(matchesAnnouncementAudience(csItem, "home"), false);
assert.equal(matchesAnnouncementAudience(csItem, "customer_service"), true);
const companionItem = announcementItem({
  id: "pw-1",
  title: "陪玩通知",
  content: "陪玩可见",
  category: "companion",
  audience: "companion",
  is_active: true,
});
assert.equal(matchesAnnouncementAudience(companionItem, "companion"), true);
assert.equal(matchesAnnouncementAudience(companionItem, "home"), false);

calls.length = 0;
handler = async (url, init) => {
  if (init.method === "POST") {
    const sent = JSON.parse(init.body);
    return new Response(JSON.stringify([dbRow({ category: sent.category, audience: sent.audience, title: sent.title })]), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
};
for (const [category, audience] of [
  ["homepage_only", "home"],
  ["customer_service", "customer_service"],
  ["companion", "companion"],
]) {
  calls.length = 0;
  const saved = await saveAnnouncement({ title: `${category}标题`, content: `${category}正文`, category, audience });
  const post = calls.find((call) => call.init.method === "POST");
  const sent = JSON.parse(post.init.body);
  assert.equal(sent.category, category);
  assert.equal(sent.audience, audience);
  assert.equal(saved.category, category);
  assert.equal(saved.audience, audience);
  assert.ok(saved.id);
  assert.ok(saved.updated_at);
}

const fixture = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/home-announcements.css">
<style>
  body{margin:0;background:#0b0a10;color:#f8f5f8;font-family:sans-serif}
  main{padding:16px 12px 32px}
  h1{margin:0 0 8px;font-size:15px;font-weight:650}
  h2{margin:18px 0 0;font-size:13px;color:#afa6b5;font-weight:650}
</style></head><body><main>
<h1>公告验收</h1>
<h2>首页</h2>
<div id="homeAnnouncementBar" class="announcement-strip" hidden></div>
<h2>陪玩工作台</h2>
<div class="pw-announcement-host" data-pw-announcement-host hidden></div>
<script src="/src/home-announcements.js"></script>
<script src="/src/companion-announcements.js"></script>
<script>window.MCJCompanionAnnouncements.start();</script>
</main></body></html>`;

const adminRows = [
  { id: "home-only", category: "homepage_only", audience: "boss", kind: "normal", title: "仅首页通知", content: "只在官网首页", is_active: true, is_pinned: false, is_scrolling: true, sort_order: 10 },
  { id: "cs-1", category: "customer_service", audience: "customer_service", kind: "normal", title: "客服通知", content: "客服可见", is_active: true, is_pinned: false, is_scrolling: true, sort_order: 20 },
  { id: "pw-1", category: "companion", audience: "companion", kind: "normal", title: "陪玩通知", content: "陪玩可见", is_active: true, is_pinned: true, sort_order: 5 },
];
const adminFixture = `<!doctype html><html><body>
<div id="table-announcements"></div>
<script>
window.__ANN = ${JSON.stringify(adminRows)};
window.MCJAdminAuthFetch = {
  ensureValidToken: function () { return Promise.resolve(); },
  get: function (url) {
    if (String(url).indexOf("/api/admin/content") >= 0) return Promise.resolve({ announcements: window.__ANN });
    return Promise.resolve({ ok: true, orders: [], stats: {} });
  },
  post: function () { return Promise.resolve({ ok: true, message: "已保存" }); }
};
</script>
<script src="/src/admin-final-v1.js"></script>
</body></html>`;

function listen() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/fixture.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(fixture);
      return;
    }
    if (url.pathname === "/admin-fixture.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(adminFixture);
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

function ann(extra) {
  return {
    id: extra.id,
    title: extra.title,
    content: extra.content || extra.title,
    category: extra.category || "home",
    audience: extra.audience || extra.category || "home",
    kind: "normal",
    enabled: extra.enabled !== false,
    is_active: extra.enabled !== false,
    pinned: !!extra.pinned,
    is_pinned: !!extra.pinned,
    sort: extra.sort ?? 100,
    sort_order: extra.sort ?? 100,
    publishedAt: extra.publishedAt || "2026-10-10T00:00:00.000Z",
    startAt: extra.startAt || "",
    endAt: extra.endAt || "",
    platformDefault: !!extra.platformDefault,
  };
}

const soon = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
let mode = "home-create";

function rowsFor(audience) {
  if (mode === "fail") return null;
  if (mode === "home-create" && audience === "home") {
    return [ann({ id: "home-1", title: "周末维护通知", content: "今晚 23 点维护" })];
  }
  if (mode === "home-edit" && audience === "home") {
    return [ann({ id: "home-1", title: "周末维护通知", content: "已改为凌晨维护" })];
  }
  if (mode === "home-off" || mode === "home-empty") {
    return audience === "home"
      ? [ann({ id: "mcj-default-home-ops-announcement", title: "🎉 MEOW CUI JIAO 妙脆角开启试运营！", content: "试运营阶段", platformDefault: true })]
      : [];
  }
  if (mode === "companion") {
    if (audience === "companion") {
      return [
        ann({ id: "pw-real", category: "companion", audience: "companion", title: "陪玩提现提醒", content: "请在工作台查看" }),
        ann({ id: "pw-real", category: "companion", audience: "companion", title: "陪玩提现提醒", content: "请在工作台查看" }),
        ann({ id: "cs-secret", category: "customer_service", audience: "customer_service", title: "客服私有公告", content: "不应出现" }),
        ann({ id: "home-secret", category: "home", audience: "home", title: "首页私有公告", content: "不应出现在陪玩端" }),
      ];
    }
    return [];
  }
  if (mode === "rules" && audience === "home") {
    return [
      ann({ id: "late", title: "排序靠后", sort: 20, publishedAt: "2026-10-03T00:00:00.000Z" }),
      ann({ id: "pin", title: "置顶公告", sort: 50, pinned: true, publishedAt: "2026-10-01T00:00:00.000Z" }),
      ann({ id: "pin", title: "置顶公告", sort: 50, pinned: true }),
      ann({ id: "early", title: "排序靠前", sort: 10, publishedAt: "2026-10-02T00:00:00.000Z" }),
      ann({ id: "old", title: "已过期", endAt: past }),
      ann({ id: "future", title: "未开始", startAt: soon }),
      ann({ id: "off", title: "已停用", enabled: false }),
    ];
  }
  return [];
}

const server = await listen();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const browser = await playwright.chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.route("**/api/platform/content**", async (route) => {
  const audience = new URL(route.request().url()).searchParams.get("audience");
  if (mode === "fail") {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, message: "database unavailable" }) });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, byType: { announcements: rowsFor(audience) } }),
  });
});

async function openFixture(width) {
  await page.setViewportSize({ width, height: 812 });
  await page.goto(`${base}/fixture.html`, { waitUntil: "networkidle" });
}

async function shot(name) {
  const file = `/opt/cursor/artifacts/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

const results = [];
function pass(name) { results.push(name); }

mode = "home-create";
await openFixture(375);
await page.waitForFunction(() => document.body.innerText.includes("今晚 23 点维护"));
assert.equal(await page.locator("#homeAnnouncementBar").innerText().then((text) => text.includes("试运营")), false);
await shot("announcement-home-375");
pass("create home announcement visible at 375");

await openFixture(390);
await page.waitForFunction(() => document.body.innerText.includes("今晚 23 点维护"));
await shot("announcement-home-390");
pass("create home announcement visible at 390");

mode = "home-edit";
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.innerText.includes("已改为凌晨维护"));
assert.equal(await page.locator("body").innerText().then((text) => text.includes("今晚 23 点维护")), false);
pass("edit home announcement shows updated copy");

mode = "home-off";
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.innerText.includes("暂无最新公告"));
assert.equal(await page.locator("body").innerText().then((text) => text.includes("试运营")), false);
pass("disabled home announcement is not shown");

mode = "home-empty";
await openFixture(375);
await page.waitForFunction(() => document.querySelector("[data-empty='1']"));
const empty375 = await page.locator("#homeAnnouncementBar").innerText();
assert.match(empty375, /暂无最新公告/);
assert.equal(empty375.includes("试运营"), false);
assert.equal(await page.locator("#homeAnnouncementBar [data-load-error]").count(), 0);
await shot("announcement-empty-375");
pass("empty home list has no trial fallback at 375");

await openFixture(390);
await page.waitForFunction(() => document.body.innerText.includes("暂无最新公告"));
await shot("announcement-empty-390");
pass("empty home list has no trial fallback at 390");

mode = "fail";
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.innerText.includes("公告加载失败"));
const failedText = await page.locator("#homeAnnouncementBar").innerText();
assert.match(failedText, /公告加载失败/);
assert.equal(failedText.includes("暂无最新公告"), false);
assert.equal(failedText.includes("试运营"), false);
assert.equal(await page.locator("#homeAnnouncementBar [data-load-error]").count(), 1);
const companionFail = await page.locator("[data-pw-announcement-bar]").innerText();
assert.match(companionFail, /公告加载失败/);
assert.equal(companionFail.includes("试运营"), false);
await shot("announcement-fail-390");
pass("api failure is not shown as an empty or stale announcement");

mode = "companion";
await openFixture(375);
await page.waitForFunction(() => document.body.innerText.includes("陪玩提现提醒"));
const homeText = await page.locator("#homeAnnouncementBar").innerText();
const companionText = await page.locator("[data-pw-announcement-bar]").innerText();
assert.match(homeText, /暂无最新公告/);
assert.match(companionText, /陪玩提现提醒/);
assert.equal(companionText.includes("客服私有公告"), false);
assert.equal(companionText.includes("首页私有公告"), false);
const companionItems = await page.evaluate(() => window.MCJCompanionAnnouncements.items().map((item) => item.id));
assert.deepEqual(companionItems, ["pw-real"]);
await shot("announcement-companion-375");
pass("companion announcement is only on the companion ticker");

mode = "rules";
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const items = window.MCJHomeAnnouncements && window.MCJHomeAnnouncements.items();
  return items && items.length === 3;
});
const ordered = await page.evaluate(() => window.MCJHomeAnnouncements.items().map((item) => item.title));
assert.deepEqual(ordered, ["置顶公告", "排序靠前", "排序靠后"]);
pass("pin, sort, schedule, and disabled filters stay in place");

const adminPage = await browser.newPage();
await adminPage.goto(`${base}/admin-fixture.html`, { waitUntil: "networkidle" });
await adminPage.waitForSelector("[data-edit-announcement]");
const edits = [
  ["仅首页通知", "homepage_only", "boss"],
  ["客服通知", "customer_service", "customer_service"],
  ["陪玩通知", "companion", "companion"],
];
for (const [title, category, audience] of edits) {
  await adminPage.locator(`[data-edit-announcement]`).evaluateAll((buttons, wanted) => {
    const button = buttons.find((node) => decodeURIComponent(node.getAttribute("data-edit-announcement") || "").includes(wanted));
    button.click();
  }, title);
  await adminPage.waitForFunction((expected) => {
    const form = document.querySelector("[data-announcement-form]");
    return form && form.elements.category.value === expected[0] && form.elements.audience.value === expected[1];
  }, [category, audience]);
}
pass("editing keeps stored category and audience");

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log(JSON.stringify({ ok: true, checks: results }, null, 2));
