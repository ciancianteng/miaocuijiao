/**
 * Production pre-launch final acceptance (four portals) against LIVE staging.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/prod-final-accept-four-portals.mjs
 *
 * Does not invent features — reports PASS/FAIL with evidence only.
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
const PASS = process.env.PASS || "McjTest@12345678";
const ART = path.join("/opt/cursor/artifacts", "prod-final-accept");
const ART_REPO = path.join(ROOT, "artifacts", "prod-final-accept");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  [
    "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
  ].find((p) => fs.existsSync(p));

const results = [];
function step(portal, name, ok, detail) {
  const row = {
    portal,
    step: name,
    result: ok ? "PASS" : "FAIL",
    detail: String(detail || "").slice(0, 1200),
  };
  results.push(row);
  console.log(`[${row.result}] [${portal}] ${name} :: ${row.detail}`);
  return ok;
}

async function api(pathname, token, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-companion-token": token,
            "x-mcj-admin-role": extraHeaders["x-mcj-admin-role"] || undefined,
          }
        : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: String(text).slice(0, 200) };
  }
  return {
    ok: res.ok && json.ok !== false,
    status: res.status,
    json,
    headers: res.headers,
    text: String(text).slice(0, 400),
  };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: false });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

async function openPortal(browser, urlPath, viewport) {
  const context = await browser.newContext({
    ...(viewport || { viewport: { width: 1280, height: 800 } }),
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const res = await page.goto(`${BASE}${urlPath}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  return { context, page, pageErrors, consoleErrors, status: res?.status() || 0 };
}

function meaningfulConsoleErrors(list) {
  return (list || []).filter(
    (t) =>
      !/favicon|Failed to load resource:.*404|net::ERR_BLOCKED_BY_CLIENT|Download the React DevTools/i.test(t) &&
      !/third-party|chrome-extension/i.test(t)
  );
}

async function main() {
  let failed = 0;

  // ---------- Backend / security ----------
  const healthish = [
    ["/", "user home", { ok: (s) => s === 200 }],
    ["/admin.html", "admin html", { ok: (s) => s === 200 }],
    ["/companion/", "companion portal", { ok: (s) => s === 200 }],
    ["/companion.html", "companion html alias", { ok: (s) => s === 200 || (s >= 301 && s < 400) }],
    ["/companion/login/", "companion login", { ok: (s) => s === 200 }],
    ["/customer-service/login/", "cs login", { ok: (s) => s === 200 }],
    ["/api/gateway?path=platform%2Fcontent&types=banners", "public banners api", { ok: (s) => s === 200 }],
    ["/api/public/companions", "public companions", { ok: (s) => s === 200 }],
  ];
  for (const [p, label, rule] of healthish) {
    const r = await fetch(`${BASE}${p}`, { headers: { Accept: "*/*" }, cache: "no-store", redirect: "manual" });
    const okFn = rule?.ok || ((s) => s >= 200 && s < 400);
    if (!step("API", `reachable ${label}`, okFn(r.status), `HTTP ${r.status}`)) failed += 1;
  }

  // Auth matrix — real CS email is service@meow.test (not cs@meow.test)
  const roles = [
    { email: "boss@meow.test", portal: "boss", label: "User/Boss" },
    { email: "admin@meow.test", portal: "admin", label: "Admin" },
    { email: "companion@meow.test", portal: "companion", label: "Partner" },
    { email: "service@meow.test", portal: "customer_service", label: "CS" },
  ];
  const tokens = {};
  const sessions = {};
  for (const role of roles) {
    const login = await api("/api/auth", null, {
      action: "login",
      email: role.email,
      password: PASS,
      loginPortal: role.portal,
    });
    const t = tok(login.json);
    tokens[role.portal] = t;
    sessions[role.portal] = login.json?.session || {};
    if (!step("API", `login ${role.label}`, !!t && login.ok, `status=${login.status} tok=${!!t} msg=${login.json?.message || ""}`)) {
      failed += 1;
    }
  }

  // Permission isolation
  if (tokens.boss) {
    const adminAsBoss = await api("/api/admin/banners", tokens.boss, null, { "x-mcj-admin-role": "admin" });
    if (
      !step(
        "API",
        "boss cannot access admin banners",
        adminAsBoss.status === 401 || adminAsBoss.status === 403 || adminAsBoss.ok === false,
        `status=${adminAsBoss.status} msg=${adminAsBoss.json?.message || ""}`
      )
    ) {
      failed += 1;
    }
  }
  if (tokens.companion) {
    const adminAsComp = await api("/api/admin/players", tokens.companion, null, { "x-mcj-admin-role": "admin" });
    if (
      !step(
        "API",
        "companion cannot access admin players",
        adminAsComp.status === 401 || adminAsComp.status === 403 || adminAsComp.ok === false,
        `status=${adminAsComp.status} msg=${adminAsComp.json?.message || ""}`
      )
    ) {
      failed += 1;
    }
  }
  if (tokens.admin) {
    const banners = await api("/api/admin/banners", tokens.admin, null, { "x-mcj-admin-role": "admin" });
    if (!step("API", "admin banners OK", banners.ok, `status=${banners.status} count=${(banners.json?.history || []).length}`)) {
      failed += 1;
    }
    const players = await api("/api/admin/players", tokens.admin, null, { "x-mcj-admin-role": "admin" });
    if (!step("API", "admin players OK", players.ok || players.status === 200, `status=${players.status}`)) failed += 1;
  }
  if (tokens.companion) {
    const boot = await api("/api/companion?action=bootstrap", tokens.companion, null);
    if (!step("API", "companion bootstrap OK", boot.ok || !!boot.json?.data, `status=${boot.status}`)) failed += 1;
  }
  if (tokens.boss) {
    const comps = await api("/api/public/companions", null, null);
    if (!step("API", "public companions OK", comps.ok || Array.isArray(comps.json?.companions), `status=${comps.status} n=${(comps.json?.companions || []).length}`)) {
      failed += 1;
    }
  }

  // Error leak checks (English runtime dumps)
  const anonBad = await api("/api/companion", null, { action: "bootstrap" });
  const msg = String(anonBad.json?.message || "");
  if (
    !step(
      "API",
      "unauth companion returns zh / no stack",
      !/TypeError|ReferenceError|Assignment to constant|at Object\.|stack/i.test(msg),
      `status=${anonBad.status} msg=${msg.slice(0, 160)}`
    )
  ) {
    failed += 1;
  }

  // Security headers / secrets exposure on HTML
  const homeHtml = await fetch(`${BASE}/`, { cache: "no-store" });
  const homeText = await homeHtml.text();
  const homeHdr = homeHtml.headers;
  const needHdrs = ["x-content-type-options", "x-frame-options", "referrer-policy"];
  const missingHdrs = needHdrs.filter((h) => !homeHdr.get(h));
  if (
    !step(
      "API",
      "security headers present",
      missingHdrs.length === 0,
      missingHdrs.length ? `missing=${missingHdrs.join(",")}` : `xcto=${homeHdr.get("x-content-type-options")} xfo=${homeHdr.get("x-frame-options")} rp=${homeHdr.get("referrer-policy")}`
    )
  ) {
    failed += 1;
  }
  const leaked =
    /SUPABASE_SERVICE_ROLE_KEY|service_role|sk_live_|HITPAY_API_KEY|eyJhbGciOi.*service_role/i.test(homeText);
  if (!step("API", "home HTML no secrets", !leaked, `len=${homeText.length}`)) failed += 1;

  // Failed login must not leak OTP / stack
  const badLogin = await api("/api/auth", null, {
    action: "login",
    email: "nobody@meow.test",
    password: "WrongPass!999",
    loginPortal: "boss",
  });
  const badMsg = JSON.stringify(badLogin.json || {});
  if (
    !step(
      "API",
      "failed login no OTP/stack leak",
      !/otp|verification.?code|stack|TypeError|SUPABASE_SERVICE/i.test(badMsg),
      `status=${badLogin.status} msg=${String(badLogin.json?.message || "").slice(0, 120)}`
    )
  ) {
    failed += 1;
  }

  // Evil Origin must not be reflected on auth CORS
  const corsProbe = await fetch(`${BASE}/api/auth`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  const acao = corsProbe.headers.get("access-control-allow-origin") || "";
  if (!step("API", "evil Origin not reflected", acao !== "https://evil.example", `acao=${acao || "(none)"} status=${corsProbe.status}`)) {
    failed += 1;
  }

  // Source scan for hardcoded secrets in repo (static)
  const secretHits = [];
  for (const rel of ["src", "server/api", "api"]) {
    const dir = path.join(ROOT, rel);
    if (!fs.existsSync(dir)) continue;
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(js|mjs|html|json)$/.test(name) && !/node_modules|artifacts|checkpoints/.test(p)) {
          const t = fs.readFileSync(p, "utf8");
          if (/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]eyJ/.test(t) || /sk_live_[A-Za-z0-9]{10,}/.test(t)) {
            secretHits.push(p.replace(ROOT + "/", ""));
          }
        }
      }
    };
    walk(dir);
  }
  if (!step("API", "repo no hardcoded live secrets", secretHits.length === 0, secretHits.join(",") || "none")) failed += 1;

  // Banner SoT consistency
  if (tokens.admin) {
    const adminB = await api("/api/admin/banners", tokens.admin, null, { "x-mcj-admin-role": "admin" });
    const homeB = await api(`/api/gateway?path=${encodeURIComponent("platform/content")}&types=banners&_=${Date.now()}`, null, null);
    const adminIds = new Set((adminB.json?.history || []).filter((b) => b.is_active !== false).map((b) => String(b.id)));
    const homeIds = ((homeB.json?.byType?.banners) || []).map((b) => String(b.id));
    const homeOnly = homeIds.filter((id) => !adminIds.has(id));
    if (!step("API", "banner homepage ⊆ admin", homeOnly.length === 0, JSON.stringify({ homeIds, homeOnly }))) failed += 1;
    if (!step("API", "no E2E blue banners", !homeIds.some((id) => false) && !((homeB.json?.byType?.banners) || []).some((b) => /E2E|UPLOAD E2E/i.test(String(b.title || ""))), ((homeB.json?.byType?.banners) || []).map((b) => b.title).join("|"))) {
      failed += 1;
    }
  }

  // Tiny upload smoke (companion avatar) — non-destructive tiny png
  if (tokens.companion) {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const up = await api("/api/companion", tokens.companion, {
      action: "upload_media",
      media_type: "avatar",
      data_url: png,
      filename: "prod-accept-avatar.png",
    });
    if (
      !step(
        "API",
        "companion image upload",
        up.ok && !/TypeError|Assignment to constant/i.test(String(up.json?.message || "")),
        `status=${up.status} msg=${String(up.json?.message || "").slice(0, 120)} path=${up.json?.path || ""}`
      )
    ) {
      failed += 1;
    }
  }

  // ---------- UI portals ----------
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // User frontend desktop + mobile
  {
    const desk = await openPortal(browser, "/", { viewport: { width: 1280, height: 800 } });
    await shot(desk.page, "01-user-home-desktop");
    const hero = await desk.page.locator("[data-mcj-home-hero], .mcj-home-hero").count();
    const defaultBanner = await desk.page.evaluate(() => {
      const imgs = [...document.querySelectorAll(".mcj-hero-image")];
      return imgs.some((i) => /default-home-banner/i.test(i.currentSrc || i.getAttribute("src") || ""));
    });
    const errs = meaningfulConsoleErrors([...desk.pageErrors, ...desk.consoleErrors]);
    if (!step("User", "home loads", desk.status < 400 && hero > 0, `status=${desk.status} hero=${hero}`)) failed += 1;
    if (!step("User", "no default-home-banner src", !defaultBanner, `default=${defaultBanner}`)) failed += 1;
    if (!step("User", "home console clean", errs.length === 0, JSON.stringify(errs.slice(0, 5)))) failed += 1;
    await desk.context.close();

    const mob = await openPortal(browser, "/", {
      ...devices["iPhone 13"],
    });
    await shot(mob.page, "02-user-home-mobile");
    const overflow = await mob.page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth - doc.clientWidth > 8 };
    });
    const mErrs = meaningfulConsoleErrors([...mob.pageErrors, ...mob.consoleErrors]);
    if (!step("User", "mobile no horizontal overflow", !overflow.overflow, JSON.stringify(overflow))) failed += 1;
    if (!step("User", "mobile console clean", mErrs.length === 0, JSON.stringify(mErrs.slice(0, 5)))) failed += 1;
    await mob.context.close();
  }

  // Admin dashboard — inject dedicated admin soft session + JWT keys
  {
    const { context, page, pageErrors, consoleErrors, status } = await openPortal(browser, "/admin.html");
    const adminSess = sessions.admin || {};
    await page.evaluate(
      ({ token, refresh, expiresAt, email }) => {
        const soft = "admin_session_v4_" + Date.now();
        const user = {
          email,
          account: email,
          role: "admin",
          adminRole: "admin",
          roles: ["admin"],
          permissions: ["admin"],
          name: "管理员",
          status: "active",
        };
        const storeKeys = [
          ["adminAuthToken", soft],
          ["adminUser", JSON.stringify(user)],
          ["mcjRole", "admin"],
          ["mcjAdminAccessToken", token],
          ["mcjAdminRefreshToken", refresh || ""],
          ["mcjAdminExpiresAt", String(expiresAt || "")],
          ["mcjAuthAccessToken", token],
          ["mcjAuthRefreshToken", refresh || ""],
          ["mcjAuthExpiresAt", String(expiresAt || "")],
        ];
        for (const [k, v] of storeKeys) {
          if (!v && k.includes("Refresh")) continue;
          localStorage.setItem(k, v);
          sessionStorage.setItem(k, v);
        }
      },
      {
        token: tokens.admin || "",
        refresh: adminSess.refreshToken || "",
        expiresAt: adminSess.expiresAt || "",
        email: "admin@meow.test",
      }
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);
    // Stay on admin if redirected to login
    if (/\/admin\/login/.test(page.url())) {
      await page.goto(`${BASE}/admin.html#banners`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }
    await shot(page, "03-admin-dashboard");
    const hasBannerNav = (await page.locator('[data-section="banners"], a:has-text("Banner"), button:has-text("Banner"), [href*="banner"]').count()) > 0;
    if (hasBannerNav) {
      await page.locator('[data-section="banners"], a:has-text("Banner"), button:has-text("Banner")').first().click().catch(() => {});
      await page.waitForTimeout(2000);
      await shot(page, "04-admin-banners");
    } else {
      // Direct hash route used by admin suite
      await page.goto(`${BASE}/admin.html#banners`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2200);
      await shot(page, "04-admin-banners");
    }
    const deleteBtns = await page.locator("[data-banner-delete]").count();
    const editBtns = await page.locator("[data-banner-edit]").count();
    const toggleBtns = await page.locator("[data-banner-toggle-active]").count();
    const errs = meaningfulConsoleErrors([...pageErrors, ...consoleErrors]);
    const onAdmin = !/\/admin\/login/.test(page.url());
    if (!step("Admin", "admin page loads", status < 400 && onAdmin, `status=${status} url=${page.url()}`)) failed += 1;
    if (
      !step(
        "Admin",
        "banner edit/delete/toggle present",
        deleteBtns + editBtns + toggleBtns >= 2,
        `edit=${editBtns} del=${deleteBtns} toggle=${toggleBtns}`
      )
    ) {
      failed += 1;
    }
    if (!step("Admin", "admin console clean", errs.length === 0, JSON.stringify(errs.slice(0, 5)))) failed += 1;
    // Admin responsive smoke
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await shot(page, "04b-admin-banners-mobile");
    const adminOverflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { overflow: doc.scrollWidth - doc.clientWidth > 24, sw: doc.scrollWidth, cw: doc.clientWidth };
    });
    if (!step("Admin", "mobile no severe overflow", !adminOverflow.overflow, JSON.stringify(adminOverflow))) failed += 1;
    await context.close();
  }

  // Partner / companion dashboard
  {
    const { context, page, pageErrors, consoleErrors, status } = await openPortal(browser, "/companion/");
    const compSess = sessions.companion || {};
    await page.evaluate(
      ({ token, refresh, expiresAt, email }) => {
        const user = { role: "companion", email, name: "Companion", id: "" };
        const soft = "companion_session_v4_" + Date.now();
        const session = {
          token,
          accessToken: token,
          refreshToken: refresh || "",
          expiresAt: expiresAt || "",
          user,
          remember: true,
          portal: "companion",
          portalLoginAt: Date.now(),
        };
        localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
        sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
        localStorage.setItem("companionAuthToken", soft);
        sessionStorage.setItem("companionAuthToken", soft);
        localStorage.setItem("companionUser", JSON.stringify(user));
        sessionStorage.setItem("companionUser", JSON.stringify(user));
      },
      {
        token: tokens.companion || "",
        refresh: compSess.refreshToken || "",
        expiresAt: compSess.expiresAt || "",
        email: "companion@meow.test",
      }
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);
    await shot(page, "05-companion-dashboard");
    const bodyText = await page.locator("body").innerText();
    const errs = meaningfulConsoleErrors([...pageErrors, ...consoleErrors]);
    if (!step("Partner", "companion portal loads", status < 400, `status=${status}`)) failed += 1;
    if (
      !step(
        "Partner",
        "no English runtime dump",
        !/Assignment to constant variable|TypeError:|ReferenceError:/i.test(bodyText),
        bodyText.replace(/\s+/g, " ").slice(0, 160)
      )
    ) {
      failed += 1;
    }
    if (!step("Partner", "companion console clean", errs.length === 0, JSON.stringify(errs.slice(0, 5)))) failed += 1;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await shot(page, "05b-companion-mobile");
    const partnerOverflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { overflow: doc.scrollWidth - doc.clientWidth > 24, sw: doc.scrollWidth, cw: doc.clientWidth };
    });
    if (!step("Partner", "mobile no severe overflow", !partnerOverflow.overflow, JSON.stringify(partnerOverflow))) failed += 1;
    await context.close();
  }

  // CS ops portal (customer service) — uses mcjServiceSession
  {
    const { context, page, pageErrors, consoleErrors, status } = await openPortal(browser, "/customer-service/");
    const csSess = sessions.customer_service || {};
    await page.evaluate(
      ({ token, refresh, expiresAt, email }) => {
        const user = { email, role: "customer_service", roles: ["customer_service"] };
        const soft = "customer_service_session_v4_" + Date.now();
        const session = {
          token,
          accessToken: token,
          refreshToken: refresh || "",
          expiresAt: expiresAt || "",
          user,
          remember: true,
          portal: "customer_service",
        };
        localStorage.setItem("mcjServiceSession", JSON.stringify(session));
        sessionStorage.setItem("mcjServiceSession", JSON.stringify(session));
        localStorage.setItem("customerServiceAuthToken", soft);
        sessionStorage.setItem("customerServiceAuthToken", soft);
        localStorage.setItem("customerServiceUser", JSON.stringify(user));
        sessionStorage.setItem("customerServiceUser", JSON.stringify(user));
      },
      {
        token: tokens.customer_service || "",
        refresh: csSess.refreshToken || "",
        expiresAt: csSess.expiresAt || "",
        email: "service@meow.test",
      }
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shot(page, "06-cs-dashboard");
    const errs = meaningfulConsoleErrors([...pageErrors, ...consoleErrors]);
    if (!step("BackendOps", "CS portal loads", status < 400, `status=${status}`)) failed += 1;
    if (!step("BackendOps", "CS console clean", errs.length === 0, JSON.stringify(errs.slice(0, 5)))) failed += 1;
    await context.close();
  }

  await browser.close();

  const passCount = results.filter((r) => r.result === "PASS").length;
  const failCount = results.filter((r) => r.result === "FAIL").length;
  const summary = {
    base: BASE,
    at: new Date().toISOString(),
    passCount,
    failCount,
    ALL_PASS: failCount === 0,
    results,
  };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(summary, null, 2));
  const line = failCount ? `PROD_FINAL_ACCEPT_FAIL ${failCount}` : "PROD_FINAL_ACCEPT_PASS";
  fs.writeFileSync(
    path.join(ART, "summary.txt"),
    line +
      "\n" +
      results.map((r) => `${r.result}\t[${r.portal}]\t${r.step}\t${r.detail}`).join("\n")
  );
  fs.copyFileSync(path.join(ART, "summary.txt"), path.join(ART_REPO, "summary.txt"));
  console.log(line);
  process.exit(failCount ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
