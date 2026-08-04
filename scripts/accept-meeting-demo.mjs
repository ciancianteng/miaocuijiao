/**
 * Meeting demo entry smoke: every click-path URL must return 200 HTML (not 404/blank).
 * Usage: node scripts/accept-meeting-demo.mjs [previewBase]
 */
import fs from "node:fs";
import path from "node:path";

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

const BASE = String(process.argv[2] || process.env.PREVIEW_URL || "").replace(/\/$/, "");
const results = [];

function record(section, id, pass, detail) {
  results.push({ section, id, pass: !!pass, detail: detail || "" });
  console.log(pass ? "PASS" : "FAIL", `[${section}]`, id, detail || "");
}

async function checkPage(section, id, urlPath, opts = {}) {
  const url = `${BASE}${urlPath}`;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { Accept: "text/html" } });
    const text = await res.text();
    const okStatus = res.status >= 200 && res.status < 400;
    const looksHtml = /<html|<body|doctype/i.test(text);
    const isBlank = text.trim().length < 40;
    const hasDevWall = /功能开发中|今晚暂未开放|Coming Soon/i.test(text) && !opts.allowDevWall;
    const pass = okStatus && looksHtml && !isBlank && !hasDevWall;
    record(section, id, pass, `status=${res.status} bytes=${text.length}${hasDevWall ? " DEV_WALL" : ""}`);
    return { pass, text, status: res.status };
  } catch (e) {
    record(section, id, false, e.message);
    return { pass: false };
  }
}

async function checkApi(section, id, urlPath) {
  const url = `${BASE}${urlPath}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const pass = res.status < 500;
    record(section, id, pass, `status=${res.status} ok=${body?.ok}`);
    return { pass, body, status: res.status };
  } catch (e) {
    record(section, id, false, e.message);
    return { pass: false };
  }
}

async function main() {
  if (!BASE) {
    console.error("Preview base URL required");
    process.exit(1);
  }

  // Home
  await checkPage("home", "index", "/");
  await checkPage("home", "companion-center", "/companion-center.html");
  await checkPage("home", "more-gameplays", "/more-gameplays.html");
  await checkPage("home", "custom-order", "/custom-order.html");
  await checkPage("home", "team-lobby", "/team-lobby.html");
  await checkPage("home", "companion-apply", "/companion-apply.html");
  await checkPage("home", "support", "/support.html");
  await checkPage("home", "club-levels", "/club-levels.html");
  await checkApi("home", "api-public-companions", "/api/public/companions");
  await checkApi("home", "api-banners", "/api/gateway?path=platform%2Fcontent&types=banners");
  await checkApi("home", "api-announcements", "/api/gateway?path=platform%2Fcontent&types=announcements");

  // Boss
  await checkPage("boss", "login", "/login.html");
  await checkPage("boss", "mine", "/mine.html");
  await checkPage("boss", "recharge", "/recharge.html");
  await checkPage("boss", "orders", "/orders.html");
  await checkPage("boss", "payment-confirm", "/payment-confirm.html");
  await checkPage("boss", "profile", "/profile.html");
  await checkPage("boss", "player-redirect", "/player.html?id=demo");

  // Stub redirects must not serve fake content walls
  await checkPage("boss", "checkin-redirect", "/checkin.html");
  await checkPage("boss", "favorites-redirect", "/favorites.html");
  await checkPage("boss", "gifts-redirect", "/gifts.html");

  // CS
  await checkPage("cs", "login", "/customer-service/login/");
  await checkPage("cs", "dashboard", "/customer-service/dashboard/");
  await checkPage("cs", "conversations", "/customer-service/conversations");
  await checkPage("cs", "orders", "/customer-service/orders");
  await checkPage("cs", "reports", "/customer-service/reports");

  // Companion
  await checkPage("companion", "login", "/companion/login/");
  await checkPage("companion", "dashboard", "/companion/dashboard/");
  await checkPage("companion", "hall", "/companion/order-hall/");
  await checkPage("companion", "orders", "/companion/orders/");
  await checkPage("companion", "earnings", "/companion/earnings/");
  await checkPage("companion", "wallet", "/companion/wallet/");
  await checkPage("companion", "messages", "/companion/messages/");
  await checkPage("companion", "profile", "/companion/profile/");
  await checkPage("companion", "apply", "/companion-apply.html");

  // Admin
  await checkPage("admin", "login", "/admin/login/");
  await checkPage("admin", "home", "/admin.html");

  // Critical: no player.html 404
  const player = results.find((r) => r.id === "player-redirect");
  if (player) {
    record("critical", "player.html_not_404", player.pass && !/status=404/.test(player.detail), player.detail);
  }

  const out = {
    base: BASE,
    at: new Date().toISOString(),
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    results,
  };
  fs.writeFileSync(path.join(ROOT, "scripts/accept-meeting-demo-results.json"), JSON.stringify(out, null, 2));
  console.log(`\nSummary PASS ${out.pass} / FAIL ${out.fail}`);
  process.exit(out.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
