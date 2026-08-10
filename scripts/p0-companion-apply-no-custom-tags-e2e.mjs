/**
 * P0 UI: Companion apply「填写游戏资料」— remove「新增自定义标签」under games/positions.
 * Injects local fixed JS/CSS; uses staging companion login + APIs.
 * Usage: node scripts/p0-companion-apply-no-custom-tags-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-no-custom-tags-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-no-custom-tags-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const LOCAL_JS = path.join(ROOT, "src/companion-application.js");
const LOCAL_CSS = path.join(ROOT, "src/companion-application.css");

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 700) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-companion-token": token,
          }
        : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

function seedDraft(email, nickname) {
  return {
    step: 2,
    rulesAgreement: { accepted: true, version: "e2e", agreedAt: new Date().toISOString() },
    data: {
      nickname,
      age: "22",
      gender: "女",
      region: "Kuala Lumpur",
      phone: "60123456789",
      email,
      personalTags: ["随和", "耐心"],
      contactPublic: "不公开，仅平台可见",
      gameNickname: "E2EGame",
      mainGames: [],
      positions: [],
      modes: [],
      rank: "黄金",
      voiceType: "甜妹",
      onlineStart: "18:00",
      onlineEnd: "23:00",
      intro: "E2E no-custom-tags",
    },
    uploads: {},
    voice: {},
    identity: {},
    gameCards: [],
  };
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function installLocalAssets(page) {
  // Serve this branch's apply page + /src assets; keep /api on PREVIEW via <base href>.
  await page.route("**/companion-apply.html*", async (route) => {
    let html = fs.readFileSync(path.join(ROOT, "companion-apply.html"), "utf8");
    if (!/<base\s/i.test(html)) {
      html = html.replace(/<head>/i, `<head><base href="${BASE}/">`);
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
  await page.route("**/src/**", async (route) => {
    try {
      const u = new URL(route.request().url());
      const rel = decodeURIComponent(u.pathname.replace(/^\/src\//, "").split("?")[0]);
      const file = path.join(ROOT, "src", rel);
      if (!file.startsWith(path.join(ROOT, "src")) || !fs.existsSync(file)) {
        return route.continue();
      }
      const ext = path.extname(file).toLowerCase();
      const type =
        ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : "application/octet-stream";
      await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
    } catch (_) {
      await route.continue();
    }
  });
}

async function openGameStep(page, token, email, nickname, draft) {
  await page.addInitScript(
    ({ token, email, nickname, draft }) => {
      const session = {
        token,
        accessToken: token,
        email,
        role: "companion",
        user: { email, name: nickname, role: "companion" },
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjRole", "companion");
      localStorage.setItem("customerUser", JSON.stringify({ role: "companion", email, name: nickname }));
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
    },
    { token, email, nickname, draft }
  );

  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText || ""), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate((d) => localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(d)), draft);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText || ""), { timeout: 60000 }).catch(() => {});
  // Wait for taxonomy-backed game pills when available.
  await page.waitForFunction(() => {
    const games = document.querySelectorAll('[data-tag-field="mainGames"]').length;
    const positions = document.querySelectorAll('[data-tag-field="positions"]').length;
    const loading = /正在加载申请资料/.test(document.body.innerText || "");
    return !loading && positions > 0 && (games > 0 || !!document.querySelector('[data-tag-picker="mainGames"]'));
  }, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);

  // Click step 2 (填写游戏资料) if unlocked; otherwise force via next/step buttons.
  for (let i = 0; i < 8; i++) {
    const onGame = await page.evaluate(() => {
      const h = document.querySelector(".apply-panel h2");
      return !!(h && /游戏资料/.test(h.textContent || ""));
    });
    if (onGame) return true;
    await page.evaluate((d) => {
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(d));
      const agree = document.querySelector("[data-rule-agree]");
      if (agree && !agree.checked) {
        agree.checked = true;
        agree.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, draft);
    await page.locator('[data-apply-step="2"]').click({ force: true }).catch(() => {});
    await page.locator("[data-apply-next]").click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  return page.evaluate(() => {
    const h = document.querySelector(".apply-panel h2");
    return !!(h && /游戏资料/.test(h.textContent || ""));
  });
}

async function inspectStep2(page) {
  return page.evaluate(() => {
    function pickerBlock(field) {
      const hit = document.querySelector(`[data-tag-picker="${field}"]`);
      if (!hit) return null;
      const customRow = hit.querySelector(".custom-tag-row, [data-custom-tag-input], [data-add-custom-tag]");
      const pills = [...hit.querySelectorAll(".tag-pill")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim());
      return {
        field,
        hasCustomEntry: !!customRow,
        customPlaceholder: (hit.querySelector("[data-custom-tag-input]") || {}).placeholder || "",
        pillCount: pills.length,
        pills: pills.slice(0, 24),
      };
    }
    const pageText = document.body.innerText || "";
    // Count「新增自定义标签」only inside game step pickers (not personalTags which isn't on this step).
    const gamePosCustom = [
      ...document.querySelectorAll(
        '[data-tag-picker="mainGames"] .custom-tag-row, [data-tag-picker="positions"] .custom-tag-row, [data-tag-picker="modes"] .custom-tag-row'
      ),
    ].length;
    return {
      title: (document.querySelector(".apply-panel h2") || {}).textContent || "",
      games: pickerBlock("mainGames"),
      positions: pickerBlock("positions"),
      modes: pickerBlock("modes"),
      pageCustomLabelCount: (pageText.match(/新增自定义标签/g) || []).length,
      gamePosCustomRows: gamePosCustom,
    };
  });
}

async function toggleAndSave(page) {
  // Click real pills + save via UI collect path.
  const selected = await page.evaluate(() => {
    function pick(field, n) {
      const boxes = [...document.querySelectorAll(`[data-tag-field="${field}"]`)];
      const out = [];
      for (const b of boxes) {
        if (out.length >= n) break;
        const pill = b.closest("label") || b;
        if (!b.checked) pill.click();
        if (b.checked) out.push(b.value);
        else {
          b.checked = true;
          b.dispatchEvent(new Event("change", { bubbles: true }));
          out.push(b.value);
        }
      }
      return out;
    }
    return { games: pick("mainGames", 2), positions: pick("positions", 2), modes: pick("modes", 1) };
  });
  await page.locator("[data-apply-save]").click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
  const saved = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return {
      mainGames: d?.data?.mainGames || [],
      positions: d?.data?.positions || [],
      modes: d?.data?.modes || [],
    };
  });
  return { selected, saved };
}

async function runViewport(browser, label, token, email, nickname, draft, viewportOpts) {
  const context = await browser.newContext(
    label === "mobile" ? { ...devices["iPhone 13"], locale: "zh-CN" } : { viewport: viewportOpts, locale: "zh-CN" }
  );
  const page = await context.newPage();
  await installLocalAssets(page);
  const reached = await openGameStep(page, token, email, nickname, draft);
  step(`${label}: reach 填写游戏资料`, reached, reached ? "ok" : "still not on game step");

  const info = await inspectStep2(page);
  step(`${label}: games picker present`, !!(info.games && info.games.pillCount > 0), JSON.stringify({ count: info.games?.pillCount, sample: info.games?.pills?.slice(0, 8) }));
  step(`${label}: positions picker present`, !!(info.positions && info.positions.pillCount > 0), JSON.stringify({ count: info.positions?.pillCount, sample: info.positions?.pills?.slice(0, 8) }));
  step(`${label}: no custom under 可接游戏`, info.games && !info.games.hasCustomEntry, JSON.stringify(info.games && { hasCustomEntry: info.games.hasCustomEntry, placeholder: info.games.customPlaceholder }));
  step(`${label}: no custom under 擅长位置`, info.positions && !info.positions.hasCustomEntry, JSON.stringify(info.positions && { hasCustomEntry: info.positions.hasCustomEntry }));
  step(`${label}: no custom under 可提供服务`, !info.modes || !info.modes.hasCustomEntry, JSON.stringify(info.modes && { hasCustomEntry: info.modes.hasCustomEntry }));
  step(`${label}: zero custom rows on game/pos/modes`, info.gamePosCustomRows === 0, `rows=${info.gamePosCustomRows}; pageLabelCount=${info.pageCustomLabelCount}`);

  await shot(page, `${label}-step2-full`);
  for (const [field, name] of [
    ["mainGames", "games"],
    ["positions", "positions"],
  ]) {
    const loc = page.locator(`[data-tag-picker="${field}"]`);
    if (await loc.count()) {
      const p1 = path.join(ART, `${label}-${name}-picker.png`);
      await loc.screenshot({ path: p1 }).catch(() => {});
      try {
        fs.copyFileSync(p1, path.join(ART_REPO, `${label}-${name}-picker.png`));
      } catch (_) {}
    }
  }

  const saveRes = await toggleAndSave(page);
  const gamesAvailable = (info.games?.pillCount || 0) > 0;
  const saveOk =
    saveRes.saved.positions.length >= 1 &&
    saveRes.selected.positions.every((p) => saveRes.saved.positions.includes(p)) &&
    (!gamesAvailable ||
      (saveRes.saved.mainGames.length >= 1 &&
        saveRes.selected.games.every((g) => saveRes.saved.mainGames.includes(g))));
  step(`${label}: multiselect+save`, saveOk, JSON.stringify({ gamesAvailable, ...saveRes }));
  await shot(page, `${label}-step2-after-select`);
  await context.close();
  return info;
}

async function main() {
  step("local assets exist", fs.existsSync(LOCAL_JS) && fs.existsSync(LOCAL_CSS), LOCAL_JS);

  const login = await api("/api/companion", null, {
    action: "login",
    account: COMP,
    email: COMP,
    password: PASS,
  });
  const companionToken = tok(login.json);
  const email = COMP;
  const nickname = login.json?.session?.user?.name || login.json?.session?.user?.nickname || "E2E Companion";
  step("companion_login", !!(login.ok && companionToken), `${email} tok=${!!companionToken}`);
  if (!companionToken) {
    fs.writeFileSync(path.join(ART_REPO, "RESULTS.json"), JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  const draft = seedDraft(email, nickname);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    await runViewport(browser, "pc", companionToken, email, nickname, draft, { width: 1440, height: 900 });
    await runViewport(browser, "mobile", companionToken, email, nickname, draft, { width: 390, height: 844 });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => r.result === "FAIL");
  const out = {
    base: BASE,
    failed: failed.length,
    results,
    artifacts: {
      pc: path.join(ART_REPO, "pc-step2-full.png"),
      mobile: path.join(ART_REPO, "mobile-step2-full.png"),
      pcGames: path.join(ART_REPO, "pc-games-picker.png"),
      pcPositions: path.join(ART_REPO, "pc-positions-picker.png"),
      mobileGames: path.join(ART_REPO, "mobile-games-picker.png"),
      mobilePositions: path.join(ART_REPO, "mobile-positions-picker.png"),
    },
  };
  fs.writeFileSync(path.join(ART, "RESULTS.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "RESULTS.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
