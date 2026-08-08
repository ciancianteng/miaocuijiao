/**
 * Diagnose companion→CS visibility: bootstrap + noise + UI filter simulation + Playwright UI.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const COMP = "companion.idcard.1785715257525@meow.test";
const CS = "service.final.1785714993009@meow.test";
const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TEST_NOISE_RE =
  /\[TEST\]|E2E-MSG|E2E[_-]|CHAT-|CS-LINK|SVC-|MSG-|ORDER-CHAT-|acceptance|自动化测试/i;

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function rest(table, qs) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  return r.json();
}

async function post(pathName, token, body) {
  const r = await fetch(`${STAGING}${pathName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

function isClosedConv(c) {
  const raw = String(c.rawStatus || "").toLowerCase();
  return raw === "closed" || raw === "ended" || c.status === "已结束";
}
function simFilter(convs, myId, filter) {
  const all = convs || [];
  if (filter === "active") {
    return all.filter((c) => {
      if (isClosedConv(c)) return false;
      if (!c.currentServiceId) return false;
      const mine = !!(c.currentServiceId && (c.currentServiceId === myId || c.currentServiceId === "local-self"));
      const locked = !!(
        c.lockedByOther ||
        (c.currentServiceId && myId && c.currentServiceId !== myId && c.currentServiceId !== "local-self")
      );
      return mine || locked;
    });
  }
  return all.filter((c) => {
    if (isClosedConv(c)) return filter === "ended";
    if (c.currentServiceId) return filter === "active";
    return filter === "waiting";
  });
}

async function main() {
  const marker = `LIVE-UI-${Date.now()}`;
  const out = { marker, staging: STAGING };

  const comp = await login(COMP);
  const cs = await login(CS);
  out.compUid = comp.user?.id;
  out.csUid = cs.user?.id;

  const send = await post("/api/companion", comp.access_token, {
    action: "send_cs_message",
    content: marker,
  });
  out.send = {
    ok: send.json?.ok,
    msgId: send.json?.messageRow?.id,
    convId: send.json?.messageRow?.conversationId,
    status: send.status,
  };
  const convId = out.send.convId || "";
  out.convId = convId;

  if (convId) {
    out.dbMsgs = await rest(
      "messages",
      `?conversation_id=eq.${encodeURIComponent(convId)}&order=created_at.desc&limit=12&select=id,sender_role,content,created_at,message_type`
    );
    out.noiseHits = (out.dbMsgs || [])
      .slice(0, 8)
      .filter((m) => TEST_NOISE_RE.test(String(m.content || "")))
      .map((m) => ({ id: m.id, content: String(m.content || "").slice(0, 80) }));
    out.dbConv = (
      await rest("conversations", `?id=eq.${encodeURIComponent(convId)}&select=*`)
    )?.[0];
  }

  const boot = await post("/api/customer-service", cs.access_token, { action: "bootstrap" });
  const convs = boot.json?.data?.conversations || [];
  const msgs = boot.json?.data?.messages || [];
  const staff = boot.json?.data?.staff || {};
  out.staffId = staff.id;
  out.staffMatchesCs = staff.id === cs.user?.id;
  out.foundConv = convs.find((c) => c.id === convId) || null;
  out.foundMsg = msgs.find((m) => String(m.content || "").includes(marker)) || null;
  out.simWaiting = simFilter(convs, staff.id, "waiting")
    .filter((c) => c.id === convId || c.conversationType === "companion_support")
    .map((c) => ({ id: c.id, name: c.bossName, status: c.status, svc: c.currentServiceId }));
  out.simActive = simFilter(convs, staff.id, "active")
    .filter((c) => c.id === convId || c.conversationType === "companion_support")
    .map((c) => ({ id: c.id, name: c.bossName, status: c.status, svc: c.currentServiceId, locked: c.lockedByOther }));
  out.inWaitingTab = !!simFilter(convs, staff.id, "waiting").find((c) => c.id === convId);
  out.inActiveTab = !!simFilter(convs, staff.id, "active").find((c) => c.id === convId);
  out.invisibleInBothTabs = !out.inWaitingTab && !out.inActiveTab;

  // Playwright: exact UI path
  let browser;
  try {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const csPage = await context.newPage();
    const compPage = await context.newPage();

    // CS login
    await csPage.goto(`${STAGING}/customer-service/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await csPage.fill('input[name="account"]', CS);
    await csPage.fill('input[name="password"]', PASS);
    await csPage.click('button[type="submit"]');
    await csPage.waitForURL(/customer-service\/(dashboard|conversations)/, { timeout: 30000 }).catch(() => {});
    await csPage.waitForTimeout(2500);
    await csPage.goto(`${STAGING}/customer-service/conversations`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await csPage.waitForTimeout(4000);

    const uiBefore = await csPage.evaluate((cid) => {
      const text = document.body.innerText || "";
      const rows = [...document.querySelectorAll("[data-open-conversation], .cs-conv-item, [data-conv-id]")].map((el) => ({
        id: el.getAttribute("data-open-conversation") || el.getAttribute("data-conv-id") || "",
        text: (el.innerText || "").slice(0, 120),
      }));
      const tabs = [...document.querySelectorAll("[data-conv-filter]")].map((el) => ({
        filter: el.getAttribute("data-conv-filter"),
        text: (el.innerText || "").trim(),
        active: el.classList.contains("active"),
      }));
      return {
        url: location.href,
        hasCompanionLabel: /陪玩/.test(text),
        hasMarker: text.includes("LIVE-UI-"),
        hasConvId: text.includes(cid) || rows.some((r) => r.id === cid),
        tabs,
        rowCount: rows.length,
        rows: rows.slice(0, 15),
        sessionId: (() => {
          try {
            const s = JSON.parse(localStorage.getItem("mcjServiceSession") || "null");
            return s?.user?.id || s?.user?.user_id || "";
          } catch {
            return "";
          }
        })(),
      };
    }, convId);
    out.uiBefore = uiBefore;

    // Click each tab and search for companion / marker
    const tabResults = {};
    for (const filter of ["waiting", "active", "ended"]) {
      const btn = csPage.locator(`[data-conv-filter="${filter}"]`);
      if (await btn.count()) {
        await btn.click();
        await csPage.waitForTimeout(800);
      }
      tabResults[filter] = await csPage.evaluate(
        ({ cid, marker }) => {
          const text = document.body.innerText || "";
          const rows = [...document.querySelectorAll("[data-open-conversation], .cs-conv-item, button[data-open-conversation]")];
          const hit = rows.find((el) => {
            const id = el.getAttribute("data-open-conversation") || "";
            const t = el.innerText || "";
            return id === cid || t.includes("草稿保留") || t.includes("陪玩") || t.includes(marker);
          });
          return {
            bodyHasMarker: text.includes(marker),
            bodyHasCompanion: /陪玩\s*·/.test(text) || text.includes("草稿保留"),
            hit: hit
              ? {
                  id: hit.getAttribute("data-open-conversation") || "",
                  text: (hit.innerText || "").slice(0, 150),
                }
              : null,
            listText: (document.querySelector("[data-cs-chat-list], .cs-chat-list")?.innerText || "").slice(0, 500),
          };
        },
        { cid: convId, marker }
      );
    }
    out.tabResults = tabResults;

    // Companion send via UI while CS watches active tab
    await csPage.locator('[data-conv-filter="active"]').click().catch(() => {});
    await csPage.waitForTimeout(500);

    await compPage.goto(`${STAGING}/companion/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // companion login fields may vary
    const accountSel = 'input[name="account"], input[name="email"], input[type="email"], input[placeholder*="账号"], input[placeholder*="邮箱"]';
    await compPage.waitForSelector(accountSel, { timeout: 15000 });
    await compPage.fill(accountSel, COMP);
    await compPage.fill('input[name="password"], input[type="password"]', PASS);
    await compPage.click('button[type="submit"]');
    await compPage.waitForTimeout(3500);
    await compPage.goto(`${STAGING}/companion/messages/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await compPage.waitForTimeout(3000);

    const marker2 = `${marker}-RT`;
    const composer = compPage.locator('textarea, input[name="content"], [data-chat-input]').first();
    await composer.waitFor({ timeout: 15000 });
    await composer.fill(marker2);
    const sendBtn = compPage.locator('button[type="submit"], button:has-text("发送"), [data-send]').first();
    await sendBtn.click();
    await compPage.waitForTimeout(2000);

    // Wait up to 5s for CS UI without refresh
    let appeared = false;
    let appearedAt = -1;
    for (let i = 0; i < 10; i++) {
      const hit = await csPage.evaluate((m) => (document.body.innerText || "").includes(m), marker2);
      if (hit) {
        appeared = true;
        appearedAt = i * 500;
        break;
      }
      // also check list items
      const listHit = await csPage.evaluate((m) => {
        const list = document.querySelector("[data-cs-chat-list], .cs-chat-list");
        return list ? (list.innerText || "").includes(m) || (list.innerText || "").includes("LIVE-UI-") : false;
      }, marker2);
      if (listHit) {
        appeared = true;
        appearedAt = i * 500;
        break;
      }
      await csPage.waitForTimeout(500);
    }
    out.realtimeUi = { marker2, appeared, appearedAtMs: appearedAt };

    // Open conversation if found
    const openBtn = csPage.locator(`[data-open-conversation="${convId}"]`).first();
    if (await openBtn.count()) {
      await openBtn.click();
      await csPage.waitForTimeout(1500);
      out.openConv = await csPage.evaluate((m) => {
        const box = document.querySelector(".cs-chat-messages");
        const text = box ? box.innerText : document.body.innerText;
        return {
          hasMarker: text.includes(m),
          hasMarker2: text.includes(m + "-RT") || text.includes("-RT"),
          snippet: (text || "").slice(0, 400),
        };
      }, marker);
    } else {
      out.openConv = { error: "conv row not found to click" };
    }

    await csPage.screenshot({ path: path.join(ROOT, "scripts/_diag-cs-conversations.png"), fullPage: true });
    await compPage.screenshot({ path: path.join(ROOT, "scripts/_diag-comp-messages.png"), fullPage: true });
  } catch (err) {
    out.uiError = String(err?.stack || err);
  } finally {
    if (browser) await browser.close();
  }

  fs.writeFileSync(path.join(ROOT, "scripts/_diag-comp-cs-ui-results.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
