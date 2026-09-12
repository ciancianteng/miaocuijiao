#!/usr/bin/env node
/**
 * Phase 2–5 final verification: real BEFORE (prod) vs AFTER (Preview).
 * Usage: node scripts/perf-final-verify.mjs <previewOrigin> [prodOrigin]
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const preview = String(process.argv[2] || "").replace(/\/$/, "");
const prod = String(process.argv[3] || "https://www.meowcuijiao.com").replace(/\/$/, "");
if (!preview) {
  console.error("Usage: node scripts/perf-final-verify.mjs <previewOrigin> [prodOrigin]");
  process.exit(2);
}

const htmlPages = [
  { key: "Homepage", path: "/" },
  { key: "Hall", path: "/companion-center.html" },
  { key: "Detail", path: "/companion-detail.html" },
  { key: "Orders", path: "/orders.html" },
  { key: "Mine", path: "/mine.html" },
  { key: "Workbench", path: "/companion/dashboard/index.html" },
  { key: "Messages", path: "/messages.html" },
  { key: "LoginBoss", path: "/login.html" },
  { key: "LoginCompanion", path: "/companion/login/index.html" },
  { key: "LoginCS", path: "/customer-service/login/index.html" },
  { key: "LoginAdmin", path: "/admin/login/index.html" },
];

const apis = ["/api/public/companions", "/api/home/daily-stats", "/api/platform/services"];

const otpPortals = [
  { name: "boss", role: "boss" },
  { name: "companion", role: "companion" },
  { name: "cs", role: "customer_service" },
  { name: "admin", role: "admin" },
];

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

async function timedFetch(url, { method = "GET", body, bust = false } = {}) {
  const target = bust ? `${url}${url.includes("?") ? "&" : "?"}_bust=${Date.now()}` : url;
  const t0 = Date.now();
  const res = await fetch(target, {
    method,
    headers: {
      "user-agent": "mcj-perf-final-verify/1",
      accept: "*/*",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(bust ? { "cache-control": "no-cache", pragma: "no-cache" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "follow",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    http: res.status,
    ms: Date.now() - t0,
    bytes: buf.length,
    cacheControl: res.headers.get("cache-control") || "",
    xVercelCache: res.headers.get("x-vercel-cache") || "",
    age: res.headers.get("age") || "",
    memCache: res.headers.get("x-mcj-mem-cache") || "",
    body: buf,
  };
}

async function measureApis(origin) {
  const out = {};
  for (const api of apis) {
    const cold = await timedFetch(origin + api, { bust: true });
    const samples = [];
    let last = cold;
    for (let i = 0; i < 3; i++) {
      last = await timedFetch(origin + api);
      samples.push({
        ms: last.ms,
        http: last.http,
        bytes: last.bytes,
        xVercelCache: last.xVercelCache,
        age: last.age,
        memCache: last.memCache,
      });
    }
    let companionCount = null;
    let sampleNames = [];
    try {
      const j = JSON.parse(last.body.toString("utf8"));
      if (Array.isArray(j.companions)) {
        companionCount = j.companions.length;
        sampleNames = j.companions.slice(0, 5).map((c) => c.name || c.nickname || c.id);
      }
    } catch {
      /* ignore */
    }
    out[api] = {
      cold_ms: cold.ms,
      cold_xvc: cold.xVercelCache,
      p50_ms: median(samples.map((s) => s.ms)),
      samples,
      cacheControl: last.cacheControl,
      warm_xvc: last.xVercelCache,
      warm_mem: last.memCache,
      companionCount,
      sampleNames,
    };
    console.log(
      `API ${origin} ${api} cold=${cold.ms}/${cold.xVercelCache} p50=${out[api].p50_ms} warm=${last.xVercelCache}/${last.memCache} n=${companionCount}`
    );
  }
  return out;
}

async function measureHtml(origin) {
  const out = [];
  for (const p of htmlPages) {
    const r = await timedFetch(origin + p.path);
    out.push({
      key: p.key,
      path: p.path,
      http: r.http,
      ms: r.ms,
      bytes: r.bytes,
      xVercelCache: r.xVercelCache,
    });
    console.log(`HTML ${origin} ${p.path} ${r.http} ${r.ms}ms ${r.bytes}b`);
  }
  return out;
}

async function measureOtp(origin) {
  const results = [];
  for (const portal of otpPortals) {
    const r = await timedFetch(origin + "/api/auth", {
      method: "POST",
      body: {
        action: "send_login_otp",
        email: "perf-verify-nonexist@example.com",
        role: portal.role,
      },
    });
    let json = null;
    try {
      json = JSON.parse(r.body.toString("utf8"));
    } catch {
      json = { raw: r.body.toString("utf8").slice(0, 200) };
    }
    const cachedBadly = /public/i.test(r.cacheControl) && /s-maxage|max-age=[1-9]/i.test(r.cacheControl);
    const pass = r.http < 500 && !cachedBadly;
    results.push({
      portal: portal.name,
      http: r.http,
      ms: r.ms,
      cacheControl: r.cacheControl,
      xVercelCache: r.xVercelCache,
      body: json,
      pass,
    });
    console.log(`OTP ${origin} ${portal.name} http=${r.http} ${r.ms}ms cache=${r.cacheControl || "(none)"} pass=${pass}`);
  }
  return results;
}

async function measurePwa(origin) {
  const candidates = [
    { portal: "boss", html: "/" },
    { portal: "companion", html: "/companion/index.html" },
    { portal: "cs", html: "/customer-service/index.html" },
    { portal: "admin", html: "/admin/index.html" },
  ];
  const out = [];
  for (const c of candidates) {
    const html = await timedFetch(origin + c.html);
    const text = html.body.toString("utf8");
    const manifestLink =
      (text.match(/rel=["']manifest["'][^>]*href=["']([^"']+)["']/i) ||
        text.match(/href=["']([^"']*manifest[^"']*)["'][^>]*rel=["']manifest["']/i) ||
        [])[1] || null;
    let manifestHttp = null;
    let startUrl = null;
    if (manifestLink) {
      const abs = manifestLink.startsWith("http")
        ? manifestLink
        : new URL(manifestLink, origin + "/").toString();
      const m = await timedFetch(abs);
      manifestHttp = m.http;
      try {
        const j = JSON.parse(m.body.toString("utf8"));
        startUrl = j.start_url || j.scope || null;
      } catch {
        /* ignore */
      }
    }
    const pass = html.http === 200 && (manifestLink ? manifestHttp === 200 : true);
    out.push({
      portal: c.portal,
      html: c.html,
      htmlHttp: html.http,
      manifestLink,
      manifestHttp,
      startUrl,
      pass,
    });
    console.log(`PWA ${origin} ${c.portal} html=${html.http} manifest=${manifestLink || "(none)"} mhttp=${manifestHttp}`);
  }
  return out;
}

async function measureBusiness(origin) {
  const companions = await timedFetch(origin + "/api/public/companions");
  let list = [];
  let ok = false;
  try {
    const j = JSON.parse(companions.body.toString("utf8"));
    list = Array.isArray(j.companions) ? j.companions : [];
    ok = j.ok !== false && companions.http === 200;
  } catch {
    ok = false;
  }
  const withPrice = list.filter((c) => Number(c.price || c.priceValue || c.hourlyPrice || 0) > 0);
  const services = await timedFetch(origin + "/api/platform/services");
  let serviceCount = 0;
  try {
    const j = JSON.parse(services.body.toString("utf8"));
    serviceCount = Array.isArray(j.services) ? j.services.length : 0;
  } catch {
    /* ignore */
  }
  const orders = await timedFetch(origin + "/api/orders");
  let messages = { http: 0, ms: 0 };
  try {
    messages = await timedFetch(origin + "/api/messages");
  } catch {
    try {
      messages = await timedFetch(origin + "/api/chat/sessions");
    } catch {
      messages = { http: 0, ms: 0 };
    }
  }
  return {
    companionsOk: ok,
    companionCount: list.length,
    pricedCount: withPrice.length,
    sample: list.slice(0, 3).map((c) => ({
      name: c.name || c.nickname,
      price: c.price ?? c.priceValue ?? c.hourlyPrice,
      status: c.availabilityStatus || c.status || c.onlineStatus,
    })),
    servicesHttp: services.http,
    serviceCount,
    ordersHttp: orders.http,
    ordersNot5xx: orders.http > 0 && orders.http < 500,
    messagesHttp: messages.http,
    messagesNot5xx: messages.http === 0 || messages.http < 500,
  };
}

async function measureNav(origin, label) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const scenarios = [
    { name: "mobile", device: devices["iPhone 13"] },
    { name: "desktop", viewport: { width: 1440, height: 900 }, userAgent: "mcj-perf-desktop" },
  ];
  const transitions = [
    { from: "/", to: "/companion-center.html", name: "home→hall" },
    { from: "/companion-center.html", to: "/companion-detail.html", name: "hall→detail" },
    { from: "/companion-detail.html", to: "/companion-center.html", name: "detail→hall" },
    { from: "/mine.html", to: "/orders.html", name: "mine→orders" },
    { from: "/companion/index.html", to: "/companion/dashboard/index.html", name: "companion→workbench" },
  ];
  const out = { label, origin, scenarios: {} };
  for (const sc of scenarios) {
    const context = await browser.newContext(
      sc.device ? { ...sc.device } : { viewport: sc.viewport, userAgent: sc.userAgent }
    );
    const page = await context.newPage();
    const results = [];

    const coldCtx = await browser.newContext(
      sc.device ? { ...sc.device } : { viewport: sc.viewport, userAgent: sc.userAgent }
    );
    const coldPage = await coldCtx.newPage();
    const c0 = Date.now();
    try {
      await coldPage.goto(origin + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      const first = Date.now() - c0;
      await coldPage
        .waitForFunction(
          () => ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim().length > 40,
          { timeout: 15000 }
        )
        .catch(() => {});
      const useful = Date.now() - c0;
      await coldPage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      results.push({ name: "home cold", firstContentMs: first, usefulContentMs: useful, settledMs: Date.now() - c0 });
      console.log(`NAV ${label}/${sc.name} home cold useful=${useful}ms settled=${Date.now() - c0}ms`);
    } catch (err) {
      results.push({ name: "home cold", error: String(err?.message || err).slice(0, 240) });
      console.log(`NAV ${label}/${sc.name} home cold ERROR ${err?.message || err}`);
    }
    await coldCtx.close();

    for (const t of transitions) {
      try {
        await page.goto(origin + t.from, { waitUntil: "domcontentloaded", timeout: 60000 });
        const t0 = Date.now();
        await page.goto(origin + t.to, { waitUntil: "domcontentloaded", timeout: 60000 });
        const first = Date.now() - t0;
        await page
          .waitForFunction(
            () => {
              const text = ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim();
              const hasUi = !!document.querySelector(
                ".player-card, .companion-card, .order-card, .pw-app, main, .hall-skel-card, .pw-boot-skel, .mine-quick"
              );
              return text.length > 40 || hasUi;
            },
            { timeout: 15000 }
          )
          .catch(() => {});
        const useful = Date.now() - t0;
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        results.push({
          name: t.name,
          firstContentMs: first,
          usefulContentMs: useful,
          settledMs: Date.now() - t0,
          url: page.url(),
        });
        console.log(`NAV ${label}/${sc.name} ${t.name} first=${first}ms useful=${useful}ms settled=${Date.now() - t0}ms`);
      } catch (err) {
        results.push({ name: t.name, error: String(err?.message || err).slice(0, 240) });
        console.log(`NAV ${label}/${sc.name} ${t.name} ERROR ${err?.message || err}`);
      }
    }
    await context.close();
    out.scenarios[sc.name] = results;
  }
  await browser.close();
  return out;
}

function evaluateGate(report) {
  const afterApis = report.after.apis;
  const beforeApis = report.before.apis;
  const companionsWarm = afterApis["/api/public/companions"]?.p50_ms;
  const companionsCold = afterApis["/api/public/companions"]?.cold_ms;
  const beforeWarm = beforeApis["/api/public/companions"]?.p50_ms;
  const beforeCold = beforeApis["/api/public/companions"]?.cold_ms;
  const dailyWarm = afterApis["/api/home/daily-stats"]?.p50_ms;
  const dailyHit =
    afterApis["/api/home/daily-stats"]?.warm_xvc === "HIT" ||
    afterApis["/api/home/daily-stats"]?.warm_mem === "HIT";

  const otpPass = (report.after.otp || []).every((o) => o.pass);
  const pwaCore = (report.after.pwa || []).filter((p) => ["boss", "companion"].includes(p.portal));
  const pwaPass = pwaCore.length > 0 && pwaCore.every((p) => p.pass);
  const biz = report.after.business;

  const navAll = [
    ...(report.after.nav?.scenarios?.mobile || []),
    ...(report.after.nav?.scenarios?.desktop || []),
  ].filter((n) => n.name !== "home cold" && !n.error);

  const navNoBlank = navAll.length > 0 && navAll.every((n) => (n.usefulContentMs ?? 99999) < 3000);
  const navTargetHits = navAll.map((n) => ({
    name: n.name,
    usefulContentMs: n.usefulContentMs,
    under1s: (n.usefulContentMs ?? 99999) < 1000,
  }));

  const checks = {
    companionsWarmUnder800: companionsWarm != null && companionsWarm < 800,
    companionsImprovedVsProd: companionsWarm != null && beforeWarm != null && companionsWarm < beforeWarm * 0.5,
    companionsColdImproved: companionsCold != null && beforeCold != null && companionsCold < beforeCold,
    dailyWarmUnder400: dailyWarm != null && dailyWarm < 400,
    dailyCacheHit: !!dailyHit,
    otpPreviewPass: otpPass,
    pwaBossCompanionPass: pwaPass,
    companionsDataOk: !!(biz?.companionsOk && biz.companionCount > 0),
    pricesPresent: (biz?.pricedCount || 0) > 0,
    ordersApiNot5xx: !!biz?.ordersNot5xx,
    navNoMultiSecondBlank: navNoBlank,
  };

  const hardFails = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    checks,
    navTargetHits,
    hardFails,
    verdict: hardFails.length === 0 ? "READY FOR FINAL REVIEW" : "FAIL",
  };
}

const report = {
  at: new Date().toISOString(),
  preview,
  prod,
  before: {},
  after: {},
};

console.log("\n=== BEFORE prod APIs ===");
report.before.apis = await measureApis(prod);
console.log("\n=== AFTER preview APIs ===");
report.after.apis = await measureApis(preview);

console.log("\n=== BEFORE prod HTML ===");
report.before.html = await measureHtml(prod);
console.log("\n=== AFTER preview HTML ===");
report.after.html = await measureHtml(preview);

console.log("\n=== OTP prod ===");
report.before.otp = await measureOtp(prod);
console.log("\n=== OTP preview ===");
report.after.otp = await measureOtp(preview);

console.log("\n=== PWA prod ===");
report.before.pwa = await measurePwa(prod);
console.log("\n=== PWA preview ===");
report.after.pwa = await measurePwa(preview);

console.log("\n=== Business prod ===");
report.before.business = await measureBusiness(prod);
console.log("\n=== Business preview ===");
report.after.business = await measureBusiness(preview);

console.log("\n=== NAV prod ===");
report.before.nav = await measureNav(prod, "prod");
console.log("\n=== NAV preview ===");
report.after.nav = await measureNav(preview, "preview");

report.gate = evaluateGate(report);

const dir = path.resolve("docs/perf-fullsite");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `final-verify-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "final-verify-latest.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\nWROTE ${file}`);
console.log(`VERDICT ${report.gate.verdict}`);
console.log(`HARD_FAILS ${JSON.stringify(report.gate.hardFails)}`);
console.log(`CHECKS ${JSON.stringify(report.gate.checks, null, 2)}`);
if (report.gate.verdict !== "READY FOR FINAL REVIEW") process.exitCode = 1;
