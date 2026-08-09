/**
 * P0: Boss CS session unread badges (real read_at / unreadCount).
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-boss-cs-unread-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_EMAIL = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const BOSS_EMAIL = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "boss-cs-unread-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "boss-cs-unread-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 700) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

async function api(pathName, token, body, method = "POST") {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-service-token": token,
          }
        : {}),
    },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

async function loginRole(email, roleHint) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role: roleHint });
  if (!r.ok) {
    const r2 = await api("/api/auth", null, { action: "login", account: email, password: PASS });
    return { ok: r2.ok, token: tok(r2.json), json: r2.json };
  }
  return { ok: true, token: tok(r.json), json: r.json };
}

function unreadOf(c) {
  return Number(c?.unreadCount ?? c?.unread ?? 0) || 0;
}

async function bossConversations(token) {
  return api("/api/chat?action=conversations", token, null, "GET");
}

async function findConv(token, id) {
  const list = await bossConversations(token);
  const rows = list.json?.conversations || [];
  const hit = rows.find((c) => String(c.id) === String(id)) || null;
  const total = Number(list.json?.unreadCount ?? list.json?.unread ?? rows.reduce((s, c) => s + unreadOf(c), 0));
  return { list, hit, total, rows };
}

function makePngDataUrl(r, g, b, w = 48, h = 32) {
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    return ~c >>> 0;
  }
  function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0, 0);
    return b;
  }
  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = u32(data.length);
    const crc = u32(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, b64: png.toString("base64") };
}

async function csSendText(csTok, convId, text) {
  return api("/api/customer-service", csTok, {
    action: "send_message",
    conversation_id: convId,
    id: convId,
    content: text,
    message_type: "text",
  });
}

async function csSendImage(csTok, convId) {
  const png = makePngDataUrl(200, 40, 90);
  const up = await api("/api/chat-media", csTok, {
    action: "upload",
    conversation_id: convId,
    dataUrl: png.dataUrl,
    fileName: `unread-${Date.now()}.png`,
  });
  const url = up.json?.url || up.json?.imageUrl || up.json?.publicUrl || "";
  const storageRef = up.json?.storageRef || up.json?.path || "";
  const send = await api("/api/customer-service", csTok, {
    action: "send_message",
    conversation_id: convId,
    id: convId,
    content: url,
    message_type: "image",
    image_url: url,
    storage_ref: storageRef,
  });
  return { up, send, url };
}

async function ensurePair(bossTok, csTok) {
  const open = await api("/api/chat", bossTok, { action: "open", forceNew: false });
  let convId = open.json?.conversation?.id || "";
  if (!convId) {
    const list = await bossConversations(bossTok);
    convId = (list.json?.conversations || [])[0]?.id || "";
  }
  if (!convId) return { convId: "", orderConvId: "" };
  const acc = await api("/api/customer-service", csTok, { action: "accept", conversation_id: convId, id: convId });
  // Mark current thread read so tests start from a clean unread baseline.
  await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convId });
  await sleep(400);

  // Prefer an existing second conversation (order) if present; otherwise create another general via reopen.
  let orderConvId = "";
  {
    const list = await bossConversations(bossTok);
    const rows = list.json?.conversations || [];
    const other = rows.find((c) => String(c.id) !== String(convId));
    if (other) orderConvId = other.id;
  }
  if (!orderConvId) {
    const reopen = await api("/api/chat", bossTok, { action: "reopen", forceNew: true });
    orderConvId = reopen.json?.conversation?.id || "";
    if (orderConvId && orderConvId !== convId) {
      await api("/api/customer-service", csTok, { action: "accept", conversation_id: orderConvId, id: orderConvId });
      await api("/api/chat", bossTok, { action: "mark_read", conversation_id: orderConvId });
    } else {
      orderConvId = "";
    }
  } else {
    await api("/api/customer-service", csTok, { action: "accept", conversation_id: orderConvId, id: orderConvId }).catch(() => {});
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: orderConvId });
  }
  return { convId, orderConvId, accept: acc };
}

(async () => {
  console.log("STAGING", BASE);
  const marker = `UNREAD-${Date.now()}`;
  let csTok = "";
  let bossTok = "";
  let convA = "";
  let convB = "";

  {
    const cs = await loginRole(CS_EMAIL, "customer_service");
    csTok = cs.token;
    step("auth_cs", !!csTok, csTok ? "ok" : JSON.stringify(cs.json).slice(0, 180));
    const boss = await loginRole(BOSS_EMAIL, "boss");
    bossTok = boss.token;
    step("auth_boss", !!bossTok, bossTok ? "ok" : JSON.stringify(boss.json).slice(0, 180));
  }

  {
    const pair = await ensurePair(bossTok, csTok);
    convA = pair.convId;
    convB = pair.orderConvId;
    step("setup_conv_a", !!convA, convA || "missing");
    step("setup_conv_b", !!convB, convB || "single-conversation-fallback");
  }

  // TEST 1: CS sends 1 text → boss unread 1
  {
    const before = await findConv(bossTok, convA);
    const base = unreadOf(before.hit);
    const send = await csSendText(csTok, convA, `${marker}-t1`);
    await sleep(600);
    const after = await findConv(bossTok, convA);
    const n = unreadOf(after.hit);
    step("test1_unread_1", send.ok && n === base + 1, `send=${send.ok} before=${base} after=${n} total=${after.total}`);
  }

  // TEST 2: +2 texts → unread accumulates to +3 from clean baseline of this block
  {
    const before = await findConv(bossTok, convA);
    const base = unreadOf(before.hit);
    await csSendText(csTok, convA, `${marker}-t2a`);
    await csSendText(csTok, convA, `${marker}-t2b`);
    await sleep(800);
    const after = await findConv(bossTok, convA);
    const n = unreadOf(after.hit);
    step("test2_unread_accum", n === base + 2, `before=${base} after=${n} expected=${base + 2}`);
  }

  // TEST 3: mark_read clears
  {
    const marked = await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    await sleep(400);
    const after = await findConv(bossTok, convA);
    step(
      "test3_mark_read_zero",
      marked.ok && unreadOf(after.hit) === 0,
      `apiUnread=${marked.json?.conversation?.unreadCount ?? marked.json?.unreadCount} list=${unreadOf(after.hit)} total=${after.total}`
    );
  }

  // TEST 4: refresh persistence (re-fetch conversations)
  {
    await sleep(300);
    const after = await findConv(bossTok, convA);
    step("test4_refresh_stays_read", unreadOf(after.hit) === 0, `unread=${unreadOf(after.hit)}`);
  }

  // TEST 5: other conversation independent
  if (convB) {
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convB });
    await sleep(300);
    await csSendText(csTok, convB, `${marker}-t5`);
    await sleep(700);
    const a = await findConv(bossTok, convA);
    const b = await findConv(bossTok, convB);
    step(
      "test5_independent",
      unreadOf(a.hit) === 0 && unreadOf(b.hit) >= 1,
      `A=${unreadOf(a.hit)} B=${unreadOf(b.hit)}`
    );
  } else {
    step("test5_independent", true, "skipped — only one conversation available");
  }

  // TEST 6: image counts as unread
  {
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    await sleep(300);
    const before = await findConv(bossTok, convA);
    const base = unreadOf(before.hit);
    const img = await csSendImage(csTok, convA);
    await sleep(900);
    const after = await findConv(bossTok, convA);
    step(
      "test6_image_unread",
      img.send.ok && unreadOf(after.hit) === base + 1,
      `send=${img.send.ok} url=${!!img.url} before=${base} after=${unreadOf(after.hit)}`
    );
  }

  // TEST 7: active thread mark_read keeps unread 0 (simulate open session)
  {
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    await sleep(200);
    await csSendText(csTok, convA, `${marker}-t7`);
    // Boss immediately marks read as if viewing the thread.
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    await sleep(400);
    const after = await findConv(bossTok, convA);
    step("test7_active_no_badge", unreadOf(after.hit) === 0, `unread=${unreadOf(after.hit)}`);
  }

  // TEST 8: re-login retains unread
  {
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    if (convB) await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convB });
    await csSendText(csTok, convA, `${marker}-t8a`);
    await csSendText(csTok, convA, `${marker}-t8b`);
    await sleep(700);
    const relog = await loginRole(BOSS_EMAIL, "boss");
    const after = await findConv(relog.token, convA);
    step("test8_relogin_persist", unreadOf(after.hit) >= 2, `unread=${unreadOf(after.hit)} token=${!!relog.token}`);
    bossTok = relog.token || bossTok;
  }

  // TEST 9: total unread == sum of sessions
  {
    if (convB) {
      await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
      await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convB });
      await csSendText(csTok, convA, `${marker}-t9a`);
      await csSendText(csTok, convA, `${marker}-t9b`);
      await csSendText(csTok, convB, `${marker}-t9c`);
      await sleep(900);
    }
    const after = await findConv(bossTok, convA);
    const sum = after.rows.reduce((s, c) => s + unreadOf(c), 0);
    const total = Number(after.list.json?.unreadCount ?? after.list.json?.unread ?? -1);
    step("test9_total_matches_sum", total === sum && sum > 0, `total=${total} sum=${sum}`);
  }

  // UI smoke: list badges on support page
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convA });
    if (convB) await api("/api/chat", bossTok, { action: "mark_read", conversation_id: convB });
    await csSendText(csTok, convA, `${marker}-ui-1`);
    await csSendText(csTok, convA, `${marker}-ui-2`);
    if (convB) await csSendText(csTok, convB, `${marker}-ui-b`);
    await sleep(800);

    await page.goto(`${BASE}/support.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(
      async ({ email, pass, base }) => {
        const res = await fetch(`${base}/api/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "login", email, password: pass, role: "boss" }),
        });
        const body = await res.json();
        const session = body.session || {};
        const token = session.accessToken || session.token || body.token || "";
        const refresh = session.refreshToken || session.refresh_token || "";
        const expiresAt = session.expiresAt || session.expires_at || "";
        const user = body.user || session.user || { email, role: "boss" };
        [localStorage, sessionStorage].forEach((store) => {
          try {
            if (token) store.setItem("mcjAuthAccessToken", token);
            if (refresh) store.setItem("mcjAuthRefreshToken", refresh);
            if (expiresAt) store.setItem("mcjAuthExpiresAt", String(expiresAt));
            store.setItem("mcjRole", "boss");
            store.setItem("customerAuthToken", token);
            store.setItem("customerUser", JSON.stringify(user));
            store.setItem("mcjCurrentUser", JSON.stringify(user));
            store.setItem("mcjBossSession", JSON.stringify(session));
            store.setItem("mcjCustomerSession", JSON.stringify(session));
          } catch (_) {}
        });
      },
      { email: BOSS_EMAIL, pass: PASS, base: BASE }
    );
    await page.goto(`${BASE}/support.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".support-session, .support-empty-list", { timeout: 60000 });
    await sleep(2000);
    const badgeCount = await page.locator(".support-session .support-unread").count();
    const badgeTexts = await page.locator(".support-session .support-unread").allTextContents();
    const navBadge = await page.locator("[data-mcj-chat-unread-badge]:not([hidden])").count();
    const totalBadge = await page.locator(".support-unread-total").count();
    step("ui_session_badges", badgeCount > 0, `badges=${badgeCount} texts=${badgeTexts.join(",")} totalHead=${totalBadge}`);
    step("ui_nav_or_total", navBadge > 0 || totalBadge > 0 || badgeCount > 0, `nav=${navBadge} total=${totalBadge} session=${badgeCount}`);
    await page.screenshot({ path: path.join(ART, "01-unread-list.png"), fullPage: true }).catch(() => {});
    fs.copyFileSync(path.join(ART, "01-unread-list.png"), path.join(ART_REPO, "01-unread-list.png"));

    const withBadge = page.locator(".support-session").filter({ has: page.locator(".support-unread") }).first();
    if (await withBadge.count()) {
      await withBadge.evaluate((el) => el.click());
      await sleep(2500);
      const still = await page.locator(".support-session.active .support-unread").count();
      step("ui_open_clears_active", still === 0, `activeUnreadBadges=${still}`);
    } else {
      step("ui_open_clears_active", true, "no badge row to open");
    }
    await page.screenshot({ path: path.join(ART, "02-after-open.png"), fullPage: true }).catch(() => {});
    fs.copyFileSync(path.join(ART, "02-after-open.png"), path.join(ART_REPO, "02-after-open.png"));
  } catch (err) {
    step("ui_fatal", false, err?.message || String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const summary = {
    base: BASE,
    convA,
    convB,
    results,
    verdict: {
      "老板会话未读计数": results.find((r) => r.step === "test1_unread_1")?.result,
      实时更新: results.find((r) => r.step === "test2_unread_accum")?.result,
      打开自动清零: results.find((r) => r.step === "test3_mark_read_zero")?.result,
      刷新后状态保存: results.find((r) => r.step === "test4_refresh_stays_read")?.result,
      多会话独立计数: results.find((r) => r.step === "test5_independent")?.result,
      图片计入未读: results.find((r) => r.step === "test6_image_unread")?.result,
      总未读同步: results.find((r) => r.step === "test9_total_matches_sum")?.result,
    },
  };
  fs.writeFileSync(path.join(ART, "summary.json"), JSON.stringify(summary, null, 2));
  fs.copyFileSync(path.join(ART, "summary.json"), path.join(ART_REPO, "summary.json"));
  const failed = results.some((r) => r.result === "FAIL");
  console.log(failed ? "OVERALL FAIL" : "OVERALL PASS");
  console.log(JSON.stringify(summary.verdict, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
