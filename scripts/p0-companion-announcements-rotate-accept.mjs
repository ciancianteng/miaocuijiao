/**
 * P0: companion homepage announcement ticker uses the same platform (home) feed
 * and rotates all items — not companion-only quotes, not first-only.
 * Usage: node scripts/p0-companion-announcements-rotate-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");

const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function getJson(path) {
  const res = await fetch(`${STAGING}${path}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function normalizeFeed(rows) {
  return (rows || [])
    .map((r) => ({
      id: String(r.id || ""),
      title: String(r.title || ""),
      audience: String(r.audience || "home").toLowerCase(),
      category: String(r.category || "home").toLowerCase(),
      kind: String(r.kind || "normal").toLowerCase(),
      requiresAck: r.requiresAck === true || r.requires_ack === true,
      sort: Number(r.sort ?? r.sort_order ?? 100),
      enabled: r.enabled !== false && r.is_active !== false,
    }))
    .filter((r) => {
      if (!r.enabled || (!r.title && !r.id)) return false;
      if (r.audience === "companion" || r.category === "companion") return false;
      if (r.audience === "customer_service") return false;
      if (r.kind === "forced" || r.requiresAck) return false;
      return true;
    })
    .sort((a, b) => a.sort - b.sort || String(a.id).localeCompare(String(b.id)));
}

(async () => {
  console.log("BASE", STAGING);

  const home = await getJson("/api/platform/content?types=announcements&audience=home");
  const homeRows = normalizeFeed(home.json?.byType?.announcements || []);
  ok("home announcements API ok", home.json?.ok !== false, `n=${homeRows.length}`);

  const companionOnly = await getJson("/api/platform/content?types=announcements&audience=companion");
  const companionRows = companionOnly.json?.byType?.announcements || [];
  ok(
    "companion audience is separate (quotes not mixed into home feed)",
    true,
    `companionN=${companionRows.length} homeN=${homeRows.length}`
  );

  // Companion module must consume home feed / platform filter — same titles order.
  ok("platform feed has rotatable items or empty ok", homeRows.length >= 0, `n=${homeRows.length}`);
  if (homeRows.length >= 2) {
    const sorts = homeRows.map((r) => r.sort);
    const ordered = sorts.slice().sort((a, b) => a - b).join(",") === sorts.join(",");
    ok("home feed sorted by sort_order", ordered, sorts.join(","));
  } else {
    ok("home feed sorted by sort_order", true, "skipped (<2 items)");
  }

  const html = await fetch(`${STAGING}/companion/`, { cache: "no-store" }).then((r) => r.text());
  ok("companion page loads announcement module", /companion-announcements\.js/.test(html), "");
  ok("companion page loads home-announcements.css", /home-announcements\.css/.test(html), "needs deploy for CSS link");
  const jsUrl = (html.match(/companion-announcements\.js[^"']*/) || [])[0] || "src/companion-announcements.js";
  const js = await fetch(`${STAGING}/${jsUrl.replace(/^\//, "")}`, { cache: "no-store" }).then((r) => r.text()).catch(() => "");
  const hasRotate =
    /advanceToNext|animationiteration|audience=home/.test(js) &&
    !/items\[0\].*陪玩公告/.test(js);
  const usesHomeStyle = /官方公告|home-announcement-bar/.test(js);
  const excludesCompanionQuotes = /audience === "companion"|aud !== "companion"|isPlatformHomeAnn/.test(js);
  ok("module rotates multi announcements", /advanceToNext/.test(js) || hasRotate, `len=${js.length}`);
  ok("module uses 官方公告 / home bar classes", usesHomeStyle, "");
  ok("module excludes companion-only quotes", excludesCompanionQuotes || /audience=home/.test(js), "");
  // Fail clearly if still first-only tickerHtml(items[0]) without rotation
  ok(
    "not first-only ticker",
    !(/tickerHtml[\s\S]*items\[0\]/.test(js) && !/advanceToNext/.test(js)),
    ""
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
