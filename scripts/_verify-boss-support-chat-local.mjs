/**
 * Local boss support-chat speed + UI + keyboard checks. No deploy.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "artifacts", "local-boss-support-chat-390");
const BASE = process.env.LOCAL_BASE || "http://127.0.0.1:5188";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.MCJ_TEST_BOSS_EMAIL || "boss@meow.test";
fs.mkdirSync(OUT, { recursive: true });

const js = fs.readFileSync(path.join(ROOT, "src/support-chat.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src/support-chat.css"), "utf8");
const skin = fs.readFileSync(path.join(ROOT, "src/mcj-chat-skin.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "support.html"), "utf8");
const fails = [];
function check(cond, msg) {
  if (!cond) fails.push(msg);
}

check(/20261121chatVvFocus1/.test(html), "support.html cache bust missing");
check(/applyVisualViewportCss/.test(js), "boss JS missing applyVisualViewportCss");
check(/support-chat-lock/.test(js), "boss JS missing support-chat-lock");
check(/support-kb-open/.test(js), "boss JS missing support-kb-open");
check(/findReusableConversation/.test(js), "boss JS missing findReusableConversation");
check(/showOpeningShell/.test(js), "boss JS missing showOpeningShell");
check(/SUPPORT_ICO_IMAGE/.test(js) && /SUPPORT_ICO_SEND/.test(js), "boss JS missing SVG icons");
check(!/data-toggle-emoji/.test(js), "emoji toggle must be removed from composer");
check(!/>图片</.test(js), "literal 图片 text button must be removed");
check(/data-cancel-pending-image/.test(js) && /data-confirm-pending-image/.test(js), "image preview cancel/confirm missing");
check(/html\.support-chat-lock/.test(css), "boss CSS missing support-chat-lock");
check(/--support-vv-top/.test(css), "boss CSS missing --support-vv-top");
check(/linear-gradient\(180deg,\s*#ffb0d8/.test(css) || /linear-gradient\(180deg,#ffb0d8/.test(skin), "send button pink-purple gradient missing");
check(/support-image-preview/.test(css), "image preview CSS missing");
check(/body\.support-page\.support-kb-open\s+\.support-footer/.test(css), "kb-open footer zero-pad missing");

const mod = await import(pathToFileURL(path.join(ROOT, "src/scroll-keep.js")).href);
assert.equal(typeof mod.applyVisualViewportCss, "function");
assert.equal(mod.keyboardInsetPx({ innerHeight: 800, visualViewport: { height: 420, offsetTop: 0 } }), 380);

const require = createRequire(import.meta.url);
let chromium;
try {
  chromium = require("playwright-core").chromium;
} catch {
  chromium = require("playwright").chromium;
}
function findChrome() {
  const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    if (!d.startsWith("chromium-")) continue;
    for (const sub of ["chrome-win", "chrome-win64"]) {
      const exe = path.join(base, d, sub, "chrome.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  if (fs.existsSync(edge)) return edge;
  return null;
}

const exe = findChrome();
if (!exe) throw new Error("No chromium/edge");
const browser = await chromium.launch({ executablePath: exe, headless: true });

// --- Harness: composer + keyboard ---
const harnessPage = await browser.newPage();
await harnessPage.setViewportSize({ width: 390, height: 844 });
await harnessPage.goto(`${BASE}/scripts/fixtures/boss-support-chat-harness.html`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await harnessPage.waitForTimeout(300);
const closed = await harnessPage.evaluate(() => window.__applyKb(false));
await harnessPage.screenshot({ path: path.join(OUT, "composer-closed-390.png"), fullPage: false });
const open = await harnessPage.evaluate(() => window.__applyKb(true));
await harnessPage.screenshot({ path: path.join(OUT, "composer-kb-open-390.png"), fullPage: false });
const restored = await harnessPage.evaluate(() => window.__applyKb(false));
await harnessPage.screenshot({ path: path.join(OUT, "composer-kb-restored-390.png"), fullPage: false });
await harnessPage.close();

check(!closed.hasEmoji, "harness must not show emoji button");
check(closed.imageIsSvg && closed.sendIsSvg, "harness image/send must be SVG");
check(!closed.imageText || closed.imageText === "", "image button must not show 图片 text");
check(!closed.overflowX, "harness must not overflow horizontally");
check(open.kb === true && open.lock === true, "kb+lock classes when open");
check(open.composerBottom <= open.shellTop + open.shellHeight + 2, "composer inside shell when kb open");
check(Math.abs(open.shellTop + open.shellHeight - open.composerBottom) < 80, "composer near shell bottom above keyboard");
check(open.msgsHeight < closed.msgsHeight, "message area shrinks when keyboard open");
check(restored.kb === false, "kb class off when restored");
check(Math.abs(restored.msgsHeight - closed.msgsHeight) < 40, "message area restores after keyboard");

// --- Live support.html with mocked APIs (local .env points at Prod — no Prod smoke writes) ---
const live = { ok: false, perf: {}, notes: [], mode: "mock-api" };
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  const CID = "mock-conv-reuse-1";
  const CID_CLOSED = "mock-conv-closed-1";
  let openCalls = 0;
  const convOpen = {
    id: CID,
    status: "waiting_service",
    conversationType: "general_support",
    lastMessage: "你好，客服在线",
    lastMessageAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    unreadCount: 0,
  };
  const convClosed = {
    id: CID_CLOSED,
    status: "closed",
    conversationType: "general_support",
    lastMessage: "会话已结束",
    lastMessageAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    unreadCount: 0,
  };
  let conversations = [convOpen, convClosed];
  let messages = [
    {
      id: "m1",
      conversation_id: CID,
      sender_role: "customer_service",
      content: "您好，请问有什么可以帮您？",
      created_at: new Date(Date.now() - 60000).toISOString(),
    },
    {
      id: "m2",
      conversation_id: CID,
      sender_role: "boss",
      content: "我想咨询一下订单",
      created_at: new Date(Date.now() - 30000).toISOString(),
    },
  ];

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    const action = url.searchParams.get("action") || "";
    let body = {};
    if (method === "POST") {
      try {
        body = req.postDataJSON() || {};
      } catch {
        body = {};
      }
    }
    const postAction = String(body.action || action || "");

    if (path.endsWith("/api/auth") && (action === "me" || postAction === "me" || method === "GET")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: {
            id: "boss-mock-1",
            role: "boss",
            email: BOSS,
            displayName: "本地验收老板",
            bossUid: "B100001",
          },
        }),
      });
    }
    if (path.includes("/api/auth") && method === "POST") {
      const expSec = Math.floor(Date.now() / 1000) + 7200;
      const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");
      const accessToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({
        exp: expSec,
        role: "boss",
        sub: "boss-mock-1",
        email: BOSS,
      })}.mocksig`;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: {
            id: "boss-mock-1",
            role: "boss",
            email: BOSS,
            displayName: "本地验收老板",
            bossUid: "B100001",
          },
          session: {
            accessToken,
            access_token: accessToken,
            refreshToken: "mock-refresh-token",
            refresh_token: "mock-refresh-token",
            expiresAt: expSec * 1000,
            expires_at: expSec,
            user: { id: "boss-mock-1", role: "boss", email: BOSS },
          },
        }),
      });
    }
    if (path.includes("/api/chat")) {
      const qCid =
        url.searchParams.get("conversation_id") ||
        url.searchParams.get("conversation") ||
        String(body.conversation_id || body.conversationId || "").trim();
      if (method === "GET" && (action === "conversations" || action === "list_conversations" || action === "list" || (!qCid && !action))) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            conversations,
            unread: 0,
            identity: { bossId: "boss-mock-1", role: "boss", bossUid: "B100001", displayName: "本地验收老板" },
            serviceOnline: true,
            serviceStatus: "等待客服接待",
          }),
        });
      }
      if (method === "GET" && qCid) {
        const conv = conversations.find((c) => c.id === qCid) || { ...convOpen, id: qCid };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            conversation: conv,
            messages: messages.filter((m) => m.conversation_id === qCid),
            conversations,
            serviceOnline: true,
            serviceStatus: "等待客服接待",
          }),
        });
      }
      if (method === "POST" && (postAction === "open" || postAction === "create" || postAction === "ensure" || postAction === "reopen")) {
        openCalls += 1;
        const forceNew = postAction === "reopen" || body.forceNew === true;
        let conversation = conversations.find((c) => c.status !== "closed" && c.status !== "ended" && !c.orderId);
        if (!conversation || forceNew) {
          conversation = {
            id: "mock-conv-new-" + openCalls,
            status: "waiting_service",
            conversationType: "general_support",
            lastMessage: "新会话",
            lastMessageAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            unreadCount: 0,
          };
          conversations = [conversation, ...conversations.filter((c) => c.id !== conversation.id)];
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            created: forceNew || openCalls > 1,
            conversation,
            messages: messages.filter((m) => m.conversation_id === conversation.id),
            conversations,
            serviceOnline: true,
            serviceStatus: "等待客服接待",
          }),
        });
      }
      if (method === "POST" && (postAction === "send" || postAction === "mark_read" || postAction === "read_conversation")) {
        if (postAction === "mark_read" || postAction === "read_conversation" || body.action === "mark_read") {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, conversations, unread: 0 }),
          });
        }
        const content = String(body.content || "").trim();
        if (!content) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, message: "空消息不可发送" }),
          });
        }
        const row = {
          id: "m-send-" + Date.now(),
          conversation_id: body.conversation_id || CID,
          sender_role: "boss",
          content,
          created_at: new Date().toISOString(),
        };
        messages = messages.concat([row]);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, row, appended: row, conversation: convOpen }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, conversations, messages, conversation: convOpen }),
      });
    }
    if (path.includes("/api/orders")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, orders: [] }),
      });
    }
    // Allow other assets/APIs to continue (platform settings etc.)
    return route.continue();
  });

  await page.addInitScript(
    ({ email }) => {
      // Pin mock auth keys so header/ensureSession cannot wipe the harness session mid-test.
      const protect = (storage) => {
        const origRemove = storage.removeItem.bind(storage);
        const origSet = storage.setItem.bind(storage);
        storage.removeItem = function (key) {
          if (/^(mcjAuth|customerUser|mcjCurrentUser|customerAuthToken|mcjRole)/.test(String(key || ""))) {
            return;
          }
          return origRemove(key);
        };
        storage.setItem = function (key, value) {
          if (
            /^(mcjAuthAccessToken|mcjAuthRefreshToken|mcjRole|customerUser|mcjCurrentUser|customerAuthToken)$/.test(
              String(key || "")
            ) &&
            !String(value || "").trim()
          ) {
            return;
          }
          return origSet(key, value);
        };
      };
      try {
        protect(localStorage);
        protect(sessionStorage);
      } catch (_) {}

      const expSec = Math.floor(Date.now() / 1000) + 7200;
      // Keep base64 padding so atob(JWT payload) never fails in boss-auth-session.
      const b64 = (obj) => btoa(JSON.stringify(obj));
      const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
        exp: expSec,
        role: "boss",
        sub: "boss-mock-1",
        email,
      })}.mocksig`;
      const expMs = String(expSec * 1000);
      const user = JSON.stringify({
        id: "boss-mock-1",
        role: "boss",
        email,
        displayName: "本地验收老板",
        bossUid: "B100001",
      });
      [
        ["mcjAuthAccessToken", token],
        ["mcjAuthRefreshToken", "mock-refresh-token"],
        ["mcjAuthExpiresAt", expMs],
        ["mcjRole", "boss"],
        ["mcjAuthEmail", email],
        ["customerUser", user],
        ["mcjCurrentUser", user],
        ["customerAuthToken", token],
      ].forEach(([k, v]) => {
        localStorage.setItem(k, v);
        sessionStorage.setItem(k, v);
      });
    },
    { email: BOSS }
  );

  const tNav = Date.now();
  await page.goto(`${BASE}/support.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".support-layout, [data-contact-service]", { timeout: 20000 });
  live.perf.domReadyMs = Date.now() - tNav;
  // Keep mock session stable during UI checks (header ensureSession refresh can clear fake JWT).
  await page.evaluate(() => {
    const block = function () {
      /* no-op for local mock verification */
    };
    if (window.MCJBossAuth) {
      try {
        window.MCJBossAuth.clearSession = block;
      } catch (_) {}
    }
  });

  // Wait until logged-in hub is stable for 2 consecutive checks (auth wipe races).
  let hubStable = null;
  for (let i = 0; i < 20; i++) {
    hubStable = await page.evaluate((cid) => ({
      guest: document.body.classList.contains("is-guest"),
      selectCount: document.querySelectorAll("[data-select-conversation]").length,
      hasCid: !!document.querySelector(`[data-select-conversation="${cid}"]`),
      aside: (document.querySelector(".support-aside")?.innerText || "").slice(0, 280),
      token: !!(sessionStorage.getItem("mcjAuthAccessToken") || localStorage.getItem("mcjAuthAccessToken")),
    }), CID);
    if (!hubStable.guest && hubStable.hasCid && hubStable.token) break;
    await page.waitForTimeout(200);
  }
  live.perf.afterBootstrapMs = Date.now() - tNav;
  live.perf.marks = await page.evaluate(() => window.__MCJ_SUPPORT_PERF || {});
  live.hub = hubStable;
  if (!hubStable || hubStable.guest || !hubStable.hasCid) {
    throw new Error("hub never stabilized logged-in: " + JSON.stringify(hubStable));
  }
  await page.screenshot({ path: path.join(OUT, "hub-390.png"), fullPage: false });

  // Open chat in the same evaluate as the hub probe to avoid softUpdate remount races.
  const tSelect = Date.now();
  const clickResult = await page.evaluate((cid) => {
    const hub = {
      guest: document.body.classList.contains("is-guest"),
      selectCount: document.querySelectorAll("[data-select-conversation]").length,
      hasCid: !!document.querySelector(`[data-select-conversation="${cid}"]`),
      aside: (document.querySelector(".support-aside")?.innerText || "").slice(0, 280),
    };
    const el = document.querySelector(`[data-select-conversation="${cid}"]`);
    if (!el) return { ok: false, hub };
    el.click();
    return { ok: true, hub };
  }, CID);
  live.hub = clickResult.hub;
  if (!clickResult.ok) throw new Error("select button missing at click time: " + JSON.stringify(live.hub));
  try {
    await page.waitForFunction(
      (cid) => {
        const box = document.querySelector("[data-messages]");
        return (
          !!document.querySelector(".support-composer") &&
          box &&
          box.getAttribute("data-cid") === cid
        );
      },
      CID,
      { timeout: 8000 }
    );
  } catch (err) {
    const openedFail = await page.evaluate(() => ({
      layout: document.querySelector(".support-layout")?.className || "",
      mainHtml: (document.querySelector(".support-main")?.innerHTML || "").slice(0, 500),
      composer: !!document.querySelector(".support-composer"),
      cid: document.querySelector("[data-messages]")?.getAttribute("data-cid") || "",
      error: document.querySelector(".support-empty-panel")?.innerText || "",
      toast: document.querySelector("[data-support-toast]")?.textContent || "",
    }));
    await page.screenshot({ path: path.join(OUT, "open-fail-390.png"), fullPage: false });
    throw new Error("failed to open conversation: " + JSON.stringify(openedFail));
  }
  const opened = await page.evaluate(() => ({
    layout: document.querySelector(".support-layout")?.className || "",
    composer: !!document.querySelector(".support-composer"),
    ended: !!document.querySelector("[data-ended-panel]"),
    opening: !!document.querySelector(".support-opening-panel"),
    cid: document.querySelector("[data-messages]")?.getAttribute("data-cid") || "",
    msgCount: document.querySelectorAll("[data-messages] .support-msg").length,
  }));
  live.opened = opened;
  if (!opened.composer || opened.cid !== CID) {
    await page.screenshot({ path: path.join(OUT, "open-fail-390.png"), fullPage: false });
    throw new Error("failed to open conversation: " + JSON.stringify(opened));
  }
  live.perf.selectOpenMs = Date.now() - tSelect;
  live.notes.push("list select opened conversation");

  // Contact reuse: return hub via navigation, click 新建客服咨询, must not create.
  await page.goto(`${BASE}/support.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (cid) => !!document.querySelector(`[data-select-conversation="${cid}"]`),
    CID,
    { timeout: 15000 }
  );
  const beforeOpen = openCalls;
  const tReuse = Date.now();
  await page.evaluate(() => {
    const el = document.querySelector("[data-contact-service]");
    if (el) el.click();
  });
  await page.waitForTimeout(500);
  const reuseState = await page.evaluate(() => ({
    modal: !!document.querySelector("[data-support-consult-modal]"),
    composer: !!document.querySelector(".support-composer"),
    cid: document.querySelector("[data-messages]")?.getAttribute("data-cid") || "",
    layout: document.querySelector(".support-layout")?.className || "",
    toast: document.querySelector("[data-support-toast]")?.textContent || "",
  }));
  live.reuseState = reuseState;
  if (reuseState.modal) {
    await page.click("[data-consult-cancel]");
    throw new Error("contact opened modal instead of reuse: " + JSON.stringify(reuseState));
  }
  if (!reuseState.composer || reuseState.cid !== CID) {
    throw new Error("contact reuse failed: " + JSON.stringify(reuseState));
  }
  live.perf.reuseOpenMs = Date.now() - tReuse;
  check(openCalls === beforeOpen, "reuse path must not call open API");
  live.notes.push("contact reuse opened existing conversation without open API");

  const liveUi = await page.evaluate(() => {
    const img = document.querySelector("[data-chat-image-btn]");
    const send = document.querySelector("[data-send-btn]");
    const emoji = document.querySelector("[data-toggle-emoji], .support-emoji-panel");
    const footer = document.querySelector(".support-footer");
    const msgs = document.querySelector("[data-messages]");
    const fr = footer ? footer.getBoundingClientRect() : null;
    const mr = msgs ? msgs.getBoundingClientRect() : null;
    return {
      hasComposer: !!document.querySelector(".support-composer"),
      imageSvg: !!(img && img.querySelector("svg")),
      sendSvg: !!(send && send.querySelector("svg")),
      imageText: String(img?.textContent || "").trim(),
      hasEmoji: !!emoji,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      footerBottom: fr ? Math.round(fr.bottom) : null,
      msgsHeight: mr ? Math.round(mr.height) : null,
      viewportH: window.innerHeight,
      cid: document.querySelector("[data-messages]")?.getAttribute("data-cid") || "",
      msgCount: msgs ? msgs.querySelectorAll(".support-msg").length : 0,
    };
  });
  live.ui = liveUi;
  await page.screenshot({ path: path.join(OUT, "chat-390.png"), fullPage: false });

  check(liveUi.hasComposer, "chat composer visible after reuse");
  check(liveUi.imageSvg && liveUi.sendSvg, "live composer SVG icons");
  check(!liveUi.hasEmoji, "live composer must not show emoji");
  check(!liveUi.imageText, "image button must not show 图片 text");
  check(!liveUi.overflowX, "live chat must not overflow X");
  check(liveUi.msgCount >= 2, "messages loaded in chat");

  // Empty send disabled / typed enable
  const disabledEmpty = await page.evaluate(() => !!document.querySelector("[data-send-btn]")?.disabled);
  check(disabledEmpty, "empty composer send must stay disabled");
  await page.fill('textarea[name="content"]', "本地验收消息");
  await page.waitForTimeout(80);
  const enabled = await page.evaluate(() => {
    const btn = document.querySelector("[data-send-btn]");
    return !!(btn && !btn.disabled);
  });
  check(enabled, "non-empty composer must enable send");
  check(liveUi.imageSvg, "image icon present for album picker");

  // Ended panel via deep-link (avoids mobile aside visibility races after back).
  await page.goto(`${BASE}/support.html?conversation=${CID_CLOSED}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-ended-panel]").waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, "ended-390.png"), fullPage: false });
  const endedUi = await page.evaluate(() => ({
    hasEnded: !!document.querySelector("[data-ended-panel]"),
    hasReopen: !!document.querySelector("[data-reopen-chat]"),
    hasBack: !!document.querySelector("[data-ended-panel] [data-back-list], .support-ended-actions [data-back-list]"),
  }));
  check(endedUi.hasEnded && endedUi.hasReopen && endedUi.hasBack, "ended panel actions present");

  // Reopen creates/reuses without blank page
  const beforeReopen = openCalls;
  await page.evaluate(() => {
    const btn = document.querySelector("[data-reopen-chat]");
    if (btn) btn.click();
  });
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(".support-composer") ||
        !!document.querySelector(".support-opening-panel"),
      { timeout: 10000 }
    );
  } catch (_) {}
  await page.waitForTimeout(400);
  const reopened = await page.evaluate(() => ({
    composer: !!document.querySelector(".support-composer"),
    opening: !!document.querySelector(".support-opening-panel"),
    ended: !!document.querySelector("[data-ended-panel]"),
    cid: document.querySelector("[data-messages]")?.getAttribute("data-cid") || "",
  }));
  live.reopened = reopened;
  check(
    (reopened.composer || reopened.opening) && !reopened.ended,
    "reopen must leave ended panel for composer/opening shell"
  );
  check(openCalls > beforeReopen, "reopen must call open/reopen API");
  await page.screenshot({ path: path.join(OUT, "reopened-390.png"), fullPage: false });

  // Keyboard sim on live shell
  const kbLive = await page.evaluate(() => {
    document.body.classList.add("support-chat-live");
    const doc = document.documentElement;
    doc.style.setProperty("--support-vv-top", "0px");
    doc.style.setProperty("--support-vv-height", "420px");
    doc.style.setProperty("--support-keyboard-inset", "0px");
    doc.classList.add("support-chat-lock", "support-kb-open");
    document.body.classList.add("support-chat-lock", "support-kb-open");
    const footer = document.querySelector(".support-footer");
    const shell = document.querySelector(".support-shell, #supportApp");
    const msgs = document.querySelector("[data-messages]");
    const fr = footer.getBoundingClientRect();
    const sr = shell.getBoundingClientRect();
    return {
      composerBottom: Math.round(fr.bottom),
      shellBottom: Math.round(sr.top + sr.height),
      msgsHeight: Math.round(msgs.getBoundingClientRect().height),
      pad: getComputedStyle(footer).paddingBottom,
    };
  });
  live.kbLive = kbLive;
  await page.screenshot({ path: path.join(OUT, "chat-kb-sim-390.png"), fullPage: false });
  check(kbLive.composerBottom <= kbLive.shellBottom + 2, "live composer stays inside shell under kb sim");

  // Refresh keeps conversation route
  await page.goto(`${BASE}/support.html?conversation=${CID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-messages][data-cid="${CID}"], .support-composer`, { timeout: 15000 });
  const afterReload = await page.evaluate((cid) => {
    const box = document.querySelector("[data-messages]");
    return {
      active: !!(box && box.getAttribute("data-cid") === cid),
      msgCount: box ? box.querySelectorAll(".support-msg").length : 0,
    };
  }, CID);
  live.reload = afterReload;
  check(afterReload.active && afterReload.msgCount >= 1, "refresh keeps conversation messages");
  await page.screenshot({ path: path.join(OUT, "chat-after-reload-390.png"), fullPage: false });

  live.openCalls = openCalls;
  live.ok = true;
  live.notes.push(`open API calls total=${openCalls}`);
  await page.close();
} catch (err) {
  live.notes.push(String(err && err.message ? err.message : err));
  live.ok = false;
}
check(live.ok, "live support.html mock flow must pass: " + (live.notes || []).join(" | "));

// CS desk must still include keyboard helpers (non-regression smoke on source)
const csJs = fs.readFileSync(path.join(ROOT, "src/customer-service-v2.js"), "utf8");
check(/applyVisualViewportCss\('cs'/.test(csJs) || /applyVisualViewportCss\("cs"/.test(csJs), "CS keyboard helper still present");
check(/CS_ICO_SEND/.test(csJs), "CS send icon still present");

await browser.close();

const report = {
  ok: fails.length === 0,
  fails,
  harness: { closed, open, restored },
  live,
  out: OUT,
};
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
if (fails.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
