import { chromium } from "playwright";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";

async function sample(page) {
  return page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const blockers = [...document.querySelectorAll("*")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05) return false;
        if (s.pointerEvents === "none") return false;
        return s.position === "fixed" && r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.7;
      })
      .map((el) => ({
        id: el.id,
        cls: String(el.className || "").slice(0, 100),
        bg: getComputedStyle(el).backgroundColor,
        pe: getComputedStyle(el).pointerEvents,
        z: getComputedStyle(el).zIndex,
        open: el.classList.contains("open"),
        hidden: !!el.hidden,
      }));
    const modal = document.getElementById("modal");
    const cx = Math.floor(window.innerWidth / 2);
    const cy = Math.floor(window.innerHeight / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      bodyOv: document.body.style.overflow,
      htmlOv: document.documentElement.style.overflow,
      bodyPos: document.body.style.position,
      bodyCs: body.overflow + "|" + body.pointerEvents,
      modalOpen: !!(modal && modal.classList.contains("open")),
      modalDisp: modal ? getComputedStyle(modal).display : null,
      forced: !!document.querySelector("[data-pw-forced-mask]"),
      banner: !!document.querySelector("[data-pw-forced-banner]"),
      mnavOpen: !!document.querySelector(".mcj-mnav.open"),
      sheetHidden: (document.querySelector("[data-mcj-mnav-sheet]") || {}).hidden,
      classes: document.body.className,
      top: top ? { tag: top.tagName, id: top.id, cls: String(top.className).slice(0, 80) } : null,
      blockers,
      hasToken: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
    };
  });
}

async function visualDark(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display === "none" || s.visibility === "hidden") return false;
        if (r.width < window.innerWidth * 0.9 || r.height < window.innerHeight * 0.8) return false;
        const bg = s.backgroundColor;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/.exec(bg);
        if (!m) return false;
        const a = m[4] === undefined ? 1 : parseFloat(m[4]);
        return Number(m[1]) < 50 && Number(m[2]) < 50 && Number(m[3]) < 50 && a > 0.25;
      })
      .map((el) => ({
        tag: el.tagName,
        id: el.id,
        cls: String(el.className).slice(0, 90),
        bg: getComputedStyle(el).backgroundColor,
        pe: getComputedStyle(el).pointerEvents,
        disp: getComputedStyle(el).display,
        hidden: el.hidden,
        opacity: getComputedStyle(el).opacity,
      }))
  );
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console:" + m.text());
});

await page.goto(BASE + "/?t=pw" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
const a = await sample(page);
await page.waitForTimeout(5000);
const b = await sample(page);

const login = await page.evaluate(async () => {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: "boss.final.1785714993009@meow.test",
      password: "McjTest@12345678",
      account: "boss.final.1785714993009@meow.test",
    }),
  });
  const body = await res.json();
  const token = body.session?.accessToken || body.session?.access_token || body.accessToken || "";
  if (token) {
    localStorage.setItem("mcjAuthAccessToken", token);
    if (body.session?.refreshToken || body.refreshToken) {
      localStorage.setItem("mcjAuthRefreshToken", body.session?.refreshToken || body.refreshToken);
    }
    if (body.user) localStorage.setItem("mcjAuthUser", JSON.stringify(body.user));
    localStorage.setItem("mcjLoggedIn", "1");
  }
  return {
    ok: body.ok,
    hasToken: !!token,
    pending: (body.pendingForced || []).length,
    forcedAckRequired: body.forcedAckRequired,
    keys: Object.keys(body || {}),
  };
});

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
const c = await sample(page);
const visual = await visualDark(page);

const clickOk = await page.evaluate(() => {
  const btn =
    document.querySelector("[data-mcj-mnav-toggle]") ||
    document.querySelector('a[href*="companion-center"]') ||
    document.querySelector("a.quick-entry-card");
  if (!btn) return { ok: false, reason: "no btn" };
  const rect = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + 5, rect.top + 5);
  return {
    ok: true,
    btn: (btn.textContent || "").trim().slice(0, 40),
    hit: hit ? { tag: hit.tagName, cls: String(hit.className).slice(0, 80), id: hit.id } : null,
    canScroll: document.documentElement.scrollHeight > window.innerHeight + 20,
    scrollY: window.scrollY,
  };
});

// Force pending forced path: call show with fake pending to see if banner-only
const forcedProbe = await page.evaluate(() => {
  if (!window.MCJBossForcedAck) return { has: false };
  window.MCJBossForcedAck.show([
    {
      id: "probe",
      title: "PROBE RULE",
      content: "probe content for overlay test",
      version: "1",
      contentType: "player_rules",
    },
  ]);
  return {
    has: true,
    banner: !!document.querySelector("[data-pw-forced-banner]"),
    mask: !!document.querySelector("[data-pw-forced-mask]"),
    bodyOv: document.body.style.overflow,
    classes: document.body.className,
  };
});

console.log(JSON.stringify({ a, b, login, c, visual, clickOk, forcedProbe, errors: errors.slice(0, 30) }, null, 2));
await browser.close();
