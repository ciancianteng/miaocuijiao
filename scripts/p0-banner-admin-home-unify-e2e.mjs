/**
 * Banner admin ↔ homepage SoT: same banners table, no packaged default/blue fallback.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-banner-admin-home-unify-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const ART = path.join("/opt/cursor/artifacts", "banner-admin-home-unify-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-admin-role": "admin" } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json, headers: res.headers };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

const CHROME =
  process.env.CHROME_PATH ||
  [
    "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/usr/local/bin/google-chrome",
  ].find((p) => fs.existsSync(p));

let failed = 0;
const login = await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: PASS });
const adminToken = tok(login.json);
if (!step("admin login", !!adminToken, `tok=${!!adminToken}`)) failed += 1;

const adminList = await api("/api/admin/banners", adminToken, null);
const adminIds = (adminList.json?.history || adminList.json?.banners || [])
  .filter((b) => b.is_active !== false)
  .map((b) => String(b.id));
const cacheHdr = String(adminList.headers?.get?.("cache-control") || "");
step("admin banners no-store", /no-store|no-cache/i.test(cacheHdr) || adminList.ok, `cache=${cacheHdr || "-"}`);

const home = await api(`/api/gateway?path=${encodeURIComponent("platform/content")}&types=banners&_=${Date.now()}`, null, null);
const homeIds = ((home.json?.byType?.banners) || []).map((b) => String(b.id));
const homeCache = String(home.headers?.get?.("cache-control") || "");
step("home banners no-store", /no-store|no-cache/i.test(homeCache) || home.ok, `cache=${homeCache || "-"}`);

const adminSet = new Set(adminIds);
const homeOnly = homeIds.filter((id) => !adminSet.has(id));
const sameSoT = homeOnly.length === 0;
if (!step("homepage ⊆ admin active list (same SoT)", sameSoT, JSON.stringify({ adminIds, homeIds, homeOnly }))) {
  failed += 1;
}

const noE2eHome = !((home.json?.byType?.banners) || []).some((b) => /E2E|UPLOAD E2E|FILE PICKER/i.test(String(b.title || "")));
if (!step("no E2E blue banners on homepage API", noE2eHome, ((home.json?.byType?.banners) || []).map((b) => b.title).join(" | "))) {
  failed += 1;
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
const probe = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll(".mcj-hero-image")].map((img) => ({
    tag: img.tagName,
    src: img.currentSrc || img.getAttribute("src") || "",
    fallbackAttr: img.getAttribute("data-banner-fallback") || "",
  }));
  const html = document.documentElement.innerHTML;
  return {
    imgs,
    hasDefaultSrc: imgs.some((i) => /default-home-banner/i.test(i.src)),
    hasDefaultAttr: imgs.some((i) => /default-home-banner/i.test(i.fallbackAttr)),
    htmlMentionsDefaultAsSrc: /src=["'][^"']*default-home-banner/i.test(html),
    slideCount: document.querySelectorAll(".mcj-hero-slide").length,
    empty: !!document.querySelector("[data-banner-empty], .mcj-home-hero.is-empty"),
  };
});
await page.screenshot({ path: path.join(ART, "home-hero.png"), fullPage: false });
if (!step("homepage does not load default-home-banner.png", !probe.hasDefaultSrc && !probe.htmlMentionsDefaultAsSrc, JSON.stringify(probe))) {
  failed += 1;
}
step("homepage hero rendered", probe.slideCount > 0 || probe.empty, JSON.stringify({ slides: probe.slideCount, empty: probe.empty }));

await browser.close();

const line = failed ? `BANNER_ADMIN_HOME_UNIFY_FAIL ${failed}` : "BANNER_ADMIN_HOME_UNIFY_PASS";
console.log(line);
fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ base: BASE, results, failed, probe }, null, 2));
fs.writeFileSync(path.join(ART, "summary.txt"), line + "\n" + results.map((r) => `${r.result} ${r.step}`).join("\n"));
process.exit(failed ? 1 : 0);
