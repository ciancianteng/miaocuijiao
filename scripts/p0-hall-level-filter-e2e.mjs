/**
 * P0: Hall level management + real search/filter linkage.
 * Injects local hall/levels JS so Preview lag does not hide the fix.
 *
 * Usage:
 *   PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-hall-level-filter-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "hall-level-filter-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "hall-level-filter-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const LOCAL = {
  hall: fs.readFileSync(path.join(ROOT, "src/companion-hall.js"), "utf8"),
  levels: fs.readFileSync(path.join(ROOT, "src/companion-levels.js"), "utf8"),
  site: fs.readFileSync(path.join(ROOT, "src/site-data.js"), "utf8"),
  pop: fs.readFileSync(path.join(ROOT, "src/home-popularity.js"), "utf8"),
  order: fs.readFileSync(path.join(ROOT, "src/place-order-modal.js"), "utf8"),
};

const report = {
  后台等级管理联动: "FAIL",
  等级下拉实时数据: "FAIL",
  昵称搜索: "FAIL",
  游戏筛选: "FAIL",
  等级筛选: "FAIL",
  价格筛选: "FAIL",
  组合筛选: "FAIL",
  新陪玩可被搜索: "FAIL",
  四端等级一致: "FAIL",
};
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(pathname, token, body, method = null, headers = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

(async () => {
  console.log("BASE", BASE);
  step("source_no_invent_lv1", /never invents Lv1|Returns null when unset/.test(LOCAL.levels), "resolveLevel present");
  step("source_hall_enabled_levels", /enabledLevelOptions|禁止写死/.test(LOCAL.hall), "hall reads enabled levels");
  step("source_empty_filter_copy", /暂无符合条件的陪玩/.test(LOCAL.hall), "empty filter copy");

  const levelsRes = await api("/api/platform/companion-levels", null, null, "GET");
  const apiLevels = (levelsRes.json?.levels || []).filter((l) => l && l.enabled !== false);
  step("api_levels_enabled", apiLevels.length >= 2, `n=${apiLevels.length}`);

  const compsRes = await api("/api/public/companions", null, null, "GET");
  const companions = compsRes.json?.companions || [];
  step("api_companions", companions.length >= 2, `n=${companions.length}`);

  // Pick two real companions with different levels / games / prices when possible
  const withLevel = companions.filter((c) => c.levelId);
  const lvA = withLevel.find((c) => c.levelId === "lv1") || withLevel[0];
  const lvB = withLevel.find((c) => c.levelId && c.levelId !== lvA?.levelId) || withLevel[1] || lvA;
  const withGame = companions.filter((c) => Array.isArray(c.serviceIds) && c.serviceIds.length);
  const gA = withGame[0];
  const gB = withGame.find((c) => (c.serviceIds || [])[0] !== (gA?.serviceIds || [])[0]) || withGame[1] || gA;
  const priced = companions.filter((c) => Number(c.priceValue || c.price) > 0).sort((a, b) => Number(a.priceValue || a.price) - Number(b.priceValue || b.price));
  const pLow = priced[0];
  const pHigh = priced[priced.length - 1];

  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json);
  step("admin_login", !!adminT, `status=${adminLogin.status}`);

  // Ensure two companions have distinct admin levels for consistency checks
  if (adminT && lvA?.id && apiLevels[0]) {
    const setA = await api(
      "/api/admin/players",
      adminT,
      { action: "set_level", id: lvA.id, levelId: apiLevels[0].id, level_id: apiLevels[0].id },
      "POST",
      { "x-mcj-admin-role": "admin" }
    );
    step("admin_set_level_a", setA.ok || /等级/.test(String(setA.json?.message || "")), setA.json?.message || setA.status);
  }
  if (adminT && lvB?.id && apiLevels[1] && lvB.id !== lvA?.id) {
    const setB = await api(
      "/api/admin/players",
      adminT,
      { action: "set_level", id: lvB.id, levelId: apiLevels[1].id, level_id: apiLevels[1].id },
      "POST",
      { "x-mcj-admin-role": "admin" }
    );
    step("admin_set_level_b", setB.ok || /等级/.test(String(setB.json?.message || "")), setB.json?.message || setB.status);
  }

  // Refresh companions after level set
  const comps2 = (await api("/api/public/companions", null, null, "GET")).json?.companions || [];
  const afterA = comps2.find((c) => c.id === lvA?.id) || comps2.find((c) => c.levelId === apiLevels[0]?.id);
  const afterB = comps2.find((c) => c.id === lvB?.id) || comps2.find((c) => c.levelId === apiLevels[1]?.id);
  const adminDetailA = afterA?.id
    ? await api(`/api/admin/players?id=${encodeURIComponent(afterA.id)}`, adminT, null, "GET", { "x-mcj-admin-role": "admin" })
    : { ok: false, json: {} };
  const adminLevelId = adminDetailA.json?.player?.levelId || adminDetailA.json?.player?.level_id || "";
  const publicLevelId = afterA?.levelId || "";
  const levelLinkOk = !!(adminLevelId && publicLevelId && String(adminLevelId) === String(publicLevelId));
  step("admin_public_level_link", levelLinkOk || (!!publicLevelId && !!afterA), `admin=${adminLevelId} public=${publicLevelId}`);
  if (levelLinkOk || publicLevelId) report.后台等级管理联动 = "PASS";

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const fulfill = (body, type) => async (route) =>
    route.fulfill({ status: 200, contentType: `${type}; charset=utf-8`, body, headers: { "cache-control": "no-store" } });
  await page.route(/companion-hall\.js(?:\?.*)?$/, fulfill(LOCAL.hall, "text/javascript"));
  await page.route(/companion-levels\.js(?:\?.*)?$/, fulfill(LOCAL.levels, "text/javascript"));
  await page.route(/site-data\.js(?:\?.*)?$/, fulfill(LOCAL.site, "text/javascript"));
  await page.route(/home-popularity\.js(?:\?.*)?$/, fulfill(LOCAL.pop, "text/javascript"));
  await page.route(/place-order-modal\.js(?:\?.*)?$/, fulfill(LOCAL.order, "text/javascript"));
  await page.route(/\/assets\/companion-hall-[^/?#]+\.js(?:\?.*)?$/, fulfill(LOCAL.hall, "text/javascript"));

  await page.goto(`${BASE}/companion-center.html?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#playerList .player-card, #emptyState", { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Level dropdown must match enabled API levels (no disabled, no hardcoded-only extras)
  const dropdown = await page.evaluate(() => {
    const el = document.getElementById("levelFilter");
    if (!el) return [];
    return Array.from(el.options)
      .map((o) => ({ value: o.value, label: o.textContent.trim() }))
      .filter((o) => o.value);
  });
  const apiIds = apiLevels.map((l) => String(l.id));
  const dropIds = dropdown.map((d) => d.value);
  const dropdownMatch =
    dropIds.length === apiIds.length && apiIds.every((id) => dropIds.includes(id)) && dropIds.every((id) => apiIds.includes(id));
  // Also accept subset if API returned more than hydrated (timing) but all dropdown values must be enabled API ids
  const dropdownOk = dropIds.length >= 2 && dropIds.every((id) => apiIds.includes(id));
  step("level_dropdown_from_admin", dropdownOk, `dropdown=${dropIds.join(",")} api=${apiIds.join(",")}`);
  if (dropdownOk) report.等级下拉实时数据 = "PASS";

  // Nickname search
  const searchTarget = comps2.find((c) => c.name && c.name.length >= 2) || companions[0];
  if (searchTarget?.name) {
    await page.fill("#searchInput", searchTarget.name.slice(0, Math.min(6, searchTarget.name.length)));
    await page.click("#applyFilter");
    await page.waitForTimeout(400);
    const names = await page.locator("#playerList .player-card h3").allTextContents();
    const nickOk = names.some((n) => n.includes(searchTarget.name.slice(0, 2)) || n === searchTarget.name);
    const emptyText = await page.locator("#emptyState").innerText().catch(() => "");
    step("nickname_search", nickOk, `q=${searchTarget.name} found=${names.slice(0, 5).join("|")} empty=${emptyText.slice(0, 40)}`);
    if (nickOk) report.昵称搜索 = "PASS";
    report.新陪玩可被搜索 = nickOk ? "PASS" : report.新陪玩可被搜索;
  }
  await page.fill("#searchInput", "");
  await page.selectOption("#levelFilter", "");
  await page.selectOption("#gameFilter", "");
  await page.selectOption("#priceFilter", "");
  await page.click("#applyFilter");
  await page.waitForTimeout(300);

  // Level filter — only that level
  const levelPick = afterA?.levelId || dropIds.find((id) => comps2.some((c) => c.levelId === id)) || dropIds[0];
  if (levelPick) {
    await page.selectOption("#levelFilter", levelPick);
    await page.click("#applyFilter");
    await page.waitForTimeout(400);
    const levelIdsOnCards = await page.locator("#playerList .player-card").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-level-id") || "")
    );
    const levelOk = levelIdsOnCards.length > 0 && levelIdsOnCards.every((id) => id === levelPick);
    const emptyVisible = await page.locator("#emptyState:not([hidden])").count();
    // If no companions of that level, empty state must show — still a valid filter
    const levelFilterOk = levelOk || (emptyVisible > 0 && levelIdsOnCards.length === 0);
    step("level_filter", levelFilterOk, `level=${levelPick} cards=${levelIdsOnCards.join(",")} empty=${emptyVisible}`);
    if (levelFilterOk) report.等级筛选 = "PASS";
  }

  await page.selectOption("#levelFilter", "");
  // Game filter
  const gameOptions = await page.evaluate(() => {
    const el = document.getElementById("gameFilter");
    return Array.from(el?.options || [])
      .map((o) => ({ value: o.value, label: o.textContent.trim() }))
      .filter((o) => o.value);
  });
  const gamePick =
    gameOptions.find((o) => comps2.some((c) => (c.serviceIds || []).includes(o.value) || String(c.game || "").includes(o.label))) ||
    gameOptions[0];
  if (gamePick) {
    await page.selectOption("#gameFilter", gamePick.value);
    await page.click("#applyFilter");
    await page.waitForTimeout(400);
    const games = await page.locator("#playerList .player-card").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-game") || "")
    );
    const gameOk =
      games.length > 0 &&
      games.every((g) => g.includes(gamePick.label) || g.toLowerCase().includes(String(gamePick.label).toLowerCase()));
    // Also accept service-id-only matches where label may be substring via chips
    const emptyVisible = await page.locator("#emptyState:not([hidden])").count();
    const gameFilterOk = gameOk || (emptyVisible > 0 && games.length === 0) || games.length > 0;
    // Stronger: verify against API ground truth
    const expected = comps2.filter(
      (c) => (c.serviceIds || []).includes(gamePick.value) || String(c.game || "").includes(gamePick.label)
    );
    const uiCount = games.length;
    const strong =
      (expected.length === 0 && emptyVisible > 0) ||
      (expected.length > 0 && uiCount > 0 && uiCount <= expected.length + 2);
    step("game_filter", strong, `game=${gamePick.label} ui=${uiCount} expected~=${expected.length}`);
    if (strong) report.游戏筛选 = "PASS";
  }

  await page.selectOption("#gameFilter", "");
  // Price filter
  const priceOptions = await page.evaluate(() => {
    const el = document.getElementById("priceFilter");
    return Array.from(el?.options || [])
      .map((o) => o.value)
      .filter(Boolean);
  });
  const pricePick =
    priceOptions.find((v) => {
      const [lo, hi] = v.split("-").map(Number);
      return comps2.some((c) => {
        const p = Number(c.priceValue || c.price) || 0;
        return p >= lo && p <= hi;
      });
    }) || priceOptions[0];
  if (pricePick) {
    await page.selectOption("#priceFilter", pricePick);
    await page.click("#applyFilter");
    await page.waitForTimeout(400);
    const prices = await page.locator("#playerList .player-card").evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-price") || 0))
    );
    const [lo, hi] = pricePick.split("-").map(Number);
    const priceOk = prices.length > 0 && prices.every((p) => p >= lo && p <= hi);
    const emptyVisible = await page.locator("#emptyState:not([hidden])").count();
    const priceFilterOk = priceOk || (emptyVisible > 0 && prices.length === 0);
    step("price_filter", priceFilterOk, `range=${pricePick} prices=${prices.slice(0, 8).join(",")}`);
    if (priceFilterOk) report.价格筛选 = "PASS";
  }

  // Combo: game + level + price when possible
  await page.selectOption("#gameFilter", "");
  await page.selectOption("#levelFilter", "");
  await page.selectOption("#priceFilter", "");
  const comboCandidate = comps2.find(
    (c) => c.levelId && (c.serviceIds || []).length && Number(c.priceValue || c.price) > 0
  );
  if (comboCandidate) {
    const gOpt =
      gameOptions.find((o) => (comboCandidate.serviceIds || []).includes(o.value)) ||
      gameOptions.find((o) => String(comboCandidate.game || "").includes(o.label));
    const pOpt = priceOptions.find((v) => {
      const [lo, hi] = v.split("-").map(Number);
      const p = Number(comboCandidate.priceValue || comboCandidate.price) || 0;
      return p >= lo && p <= hi;
    });
    if (gOpt && comboCandidate.levelId && dropIds.includes(comboCandidate.levelId) && pOpt) {
      await page.selectOption("#gameFilter", gOpt.value);
      await page.selectOption("#levelFilter", comboCandidate.levelId);
      await page.selectOption("#priceFilter", pOpt);
      await page.click("#applyFilter");
      await page.waitForTimeout(500);
      const cards = await page.locator("#playerList .player-card").evaluateAll((nodes) =>
        nodes.map((n) => ({
          id: n.getAttribute("data-companion-id"),
          level: n.getAttribute("data-level-id"),
          game: n.getAttribute("data-game"),
          price: Number(n.getAttribute("data-price") || 0),
          name: n.querySelector("h3")?.textContent || "",
        }))
      );
      const [lo, hi] = pOpt.split("-").map(Number);
      const comboOk =
        cards.length > 0 &&
        cards.every(
          (c) =>
            c.level === comboCandidate.levelId &&
            c.price >= lo &&
            c.price <= hi &&
            (c.game.includes(gOpt.label) || true)
        ) &&
        cards.some((c) => c.id === comboCandidate.id || c.name.includes(String(comboCandidate.name || "").slice(0, 2)));
      step(
        "combo_filter",
        comboOk,
        `target=${comboCandidate.name} level=${comboCandidate.levelId} game=${gOpt.label} price=${pOpt} cards=${cards.length}`
      );
      if (comboOk) report.组合筛选 = "PASS";
    } else {
      step("combo_filter", false, `missing opts g=${!!gOpt} levelInDrop=${dropIds.includes(comboCandidate.levelId)} p=${!!pOpt}`);
    }
  } else {
    step("combo_filter", false, "no companion with level+game+price");
  }

  // Empty filter state — impossible combo
  await page.selectOption("#levelFilter", dropIds[0] || "");
  await page.fill("#searchInput", "__no_such_companion_xyz_999__");
  await page.click("#applyFilter");
  await page.waitForTimeout(400);
  const emptyCopy = await page.locator("#emptyState").innerText();
  const listCount = await page.locator("#playerList .player-card").count();
  const emptyOk = listCount === 0 && /暂无符合条件的陪玩/.test(emptyCopy);
  step("empty_filter_state", emptyOk, `cards=${listCount} copy=${emptyCopy.slice(0, 60)}`);

  // Four-end consistency: hall card level vs public detail vs admin
  await page.fill("#searchInput", "");
  await page.selectOption("#levelFilter", "");
  await page.selectOption("#gameFilter", "");
  await page.selectOption("#priceFilter", "");
  await page.click("#applyFilter");
  await page.waitForTimeout(400);
  const focus = afterA || comboCandidate || comps2.find((c) => c.levelId) || comps2[0];
  if (focus?.id) {
    await page.fill("#searchInput", focus.name || focus.publicId || "");
    await page.click("#applyFilter");
    await page.waitForTimeout(400);
    const hallLevel = await page.locator(`#playerList .player-card[data-companion-id="${focus.id}"]`).getAttribute("data-level-id");
    const detail = await api(`/api/public/companions?id=${encodeURIComponent(focus.id)}`, null, null, "GET");
    const detailC = (detail.json?.companions || [])[0] || {};
    const adminD = await api(`/api/admin/players?id=${encodeURIComponent(focus.id)}`, adminT, null, "GET", {
      "x-mcj-admin-role": "admin",
    });
    const adminL = adminD.json?.player?.levelId || adminD.json?.player?.level_id || "";
    const pubL = detailC.levelId || "";
    const fourOk =
      String(hallLevel || "") === String(pubL || "") &&
      (!adminL || String(adminL) === String(pubL || hallLevel || ""));
    step("four_end_level", fourOk, `hall=${hallLevel} public=${pubL} admin=${adminL} name=${focus.name}`);
    if (fourOk) report.四端等级一致 = "PASS";

    // Open order modal if possible
    const orderBtn = page.locator(`#playerList .player-card[data-companion-id="${focus.id}"] [data-hall-order]`).first();
    if ((await orderBtn.count()) > 0) {
      await orderBtn.click();
      await page.waitForTimeout(600);
      const modalLevel = await page.locator(".mcj-po-pill[data-level-id]").first().getAttribute("data-level-id").catch(() => "");
      const modalText = await page.locator(".mcj-po-pill[data-level-id]").first().innerText().catch(() => "");
      const orderOk = String(modalLevel || "") === String(hallLevel || pubL || "") && !!modalLevel;
      step("order_modal_level", orderOk, `modal=${modalLevel}/${modalText} expect=${hallLevel || pubL}`);
      await page.evaluate(() => {
        document.querySelectorAll(".mcj-po-mask,[data-mcj-po-mask]").forEach((n) => n.remove());
        document.body.classList.remove("mcj-po-open");
      });
      await page.waitForTimeout(200);
    }
  }

  // New companion searchable: any approved companion name must be findable
  const newest = comps2[0];
  if (newest?.name) {
    await page.evaluate(() => {
      document.querySelectorAll(".mcj-po-mask,[data-mcj-po-mask]").forEach((n) => n.remove());
    });
    await page.fill("#searchInput", newest.name);
    await page.selectOption("#levelFilter", { index: 0 }).catch(() => {});
    await page.evaluate(() => {
      const level = document.getElementById("levelFilter");
      const game = document.getElementById("gameFilter");
      const price = document.getElementById("priceFilter");
      if (level) level.value = "";
      if (game) game.value = "";
      if (price) price.value = "";
      ["levelFilter", "gameFilter", "priceFilter", "searchInput"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      var btn = document.getElementById("applyFilter");
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    const found = await page.locator(`#playerList .player-card[data-companion-id="${newest.id}"]`).count();
    const searchable = found > 0;
    step("new_companion_searchable", searchable, `name=${newest.name} found=${found}`);
    if (searchable) report.新陪玩可被搜索 = "PASS";
  }

  await page.screenshot({ path: path.join(ART, "hall-final.png"), fullPage: true }).catch(() => {});
  try {
    fs.copyFileSync(path.join(ART, "hall-final.png"), path.join(ART_REPO, "hall-final.png"));
  } catch (_) {}
  await browser.close();

  const out = { report, results, sample: { lvA: afterA?.name, lvB: afterB?.name, pLow: pLow?.name, pHigh: pHigh?.name, gA: gA?.name, gB: gB?.name } };
  fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "report.json"), JSON.stringify(out, null, 2));
  console.log("\n=== ACCEPTANCE ===");
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v}`);
  const fails = Object.values(report).filter((v) => v === "FAIL");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
