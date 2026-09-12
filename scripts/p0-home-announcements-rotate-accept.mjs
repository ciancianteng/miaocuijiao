/**
 * P0: homepage announcements must rotate through ALL published home items.
 * Usage: node scripts/p0-home-announcements-rotate-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";
const MARK = `P0ANN-${Date.now()}`;

const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.token || "";
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${STAGING}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function saveAnn(token, ann) {
  return api("/api/admin/content", token, { action: "save_announcement", announcement: ann });
}

async function homeList() {
  const { json } = await api("/api/platform/content?types=announcements&audience=home", null, null, "GET");
  return (json?.byType?.announcements || []).filter((r) => {
    const kind = String(r.kind || "normal").toLowerCase();
    return kind !== "forced" && r.requiresAck !== true && r.requires_ack !== true;
  });
}

(async () => {
  console.log("BASE", STAGING);
  const login = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS });
  const adminT = tok(login.json);
  ok("admin login", !!adminT, login.json?.message || "");

  const created = [];
  for (let i = 1; i <= 3; i += 1) {
    const title = `${MARK}-标题${i}`;
    const content = `${MARK}-内容${i}-请完整滚动后再切换`;
    const res = await saveAnn(adminT, {
      title,
      content,
      category: "home",
      audience: "home",
      sort_order: i,
      is_active: true,
      is_scrolling: true,
      kind: "normal",
    });
    const id = res.json?.announcement?.id;
    created.push({ id, title, content, sort: i });
    ok(`create home ann ${i}`, !!id && !!res.json?.ok, id || res.json?.message || res.status);
  }

  let home = await homeList();
  const ours = home.filter((r) => String(r.title || "").includes(MARK));
  ok("home API returns 3 created", ours.length === 3, `ours=${ours.length} homeTotal=${home.length}`);
  const sorts = ours.map((r) => Number(r.sort_order ?? r.sort)).sort((a, b) => a - b);
  ok("sort_order 1,2,3 present", sorts.join(",") === "1,2,3", sorts.join(","));

  // Reorder: swap 1 and 3
  const bySort = Object.fromEntries(ours.map((r) => [Number(r.sort_order ?? r.sort), r]));
  await saveAnn(adminT, {
    id: bySort[1].id,
    title: bySort[1].title,
    content: bySort[1].content,
    category: "home",
    audience: "home",
    sort_order: 30,
    is_active: true,
    is_scrolling: true,
  });
  await saveAnn(adminT, {
    id: bySort[3].id,
    title: bySort[3].title,
    content: bySort[3].content,
    category: "home",
    audience: "home",
    sort_order: 1,
    is_active: true,
    is_scrolling: true,
  });
  home = await homeList();
  const ours2 = home
    .filter((r) => String(r.title || "").includes(MARK))
    .slice()
    .sort((a, b) => Number(a.sort_order ?? a.sort) - Number(b.sort_order ?? b.sort));
  ok(
    "after reorder first is former #3",
    String(ours2[0]?.title || "").includes("标题3") && Number(ours2[0]?.sort_order ?? ours2[0]?.sort) === 1,
    ours2.map((r) => `${r.sort_order ?? r.sort}:${r.title}`).join(" | ")
  );

  // Disable middle (former #2, sort 2)
  const mid = ours2.find((r) => String(r.title || "").includes("标题2"));
  await saveAnn(adminT, {
    id: mid.id,
    title: mid.title,
    content: mid.content,
    category: "home",
    audience: "home",
    sort_order: Number(mid.sort_order ?? mid.sort ?? 2),
    is_active: false,
    is_scrolling: true,
  });
  home = await homeList();
  const ours3 = home.filter((r) => String(r.title || "").includes(MARK));
  ok("disabled #2 excluded from home", ours3.length === 2 && !ours3.some((r) => String(r.title).includes("标题2")), `n=${ours3.length}`);

  // Frontend source checks on Staging (resolve hashed URL from homepage HTML)
  const homeHtml = await fetch(`${STAGING}/`, { cache: "no-store" }).then((r) => r.text());
  const jsMatch =
    homeHtml.match(/src="([^"]*home-announcements[^"]*)"/i) ||
    homeHtml.match(/href="([^"]*home-announcements[^"]*\.js[^"]*)"/i);
  const jsPath = jsMatch ? jsMatch[1] : "/src/home-announcements.js?v=20260805annRotate1";
  const jsUrl = jsPath.startsWith("http") ? jsPath : `${STAGING}${jsPath.startsWith("/") ? "" : "/"}${jsPath}`;
  const jsRes = await fetch(jsUrl, { cache: "no-store" });
  const js = await jsRes.text();
  ok("homepage references announcements script", /home-announcements/i.test(homeHtml), jsPath);
  ok("staging JS reachable", jsRes.ok && js.length > 500, `status=${jsRes.status} len=${js.length}`);
  ok("no tickerText items[0]-only helper", !/function tickerText\(items\)[\s\S]*items\[0\]/.test(js), "tickerText removed");
  ok("has advanceToNext carousel", /function advanceToNext\(/.test(js) && /animationiteration/.test(js), "advance + animationiteration");
  ok("does not hardcode only first record render", /currentItem\(/.test(js) && /state\.index/.test(js), "index-based currentItem");
  ok("empty state 暂无公告", /暂无最新公告/.test(js), "empty copy present");

  // Leave 3 enabled home announcements for visual Staging check (re-enable #2)
  if (mid?.id) {
    await saveAnn(adminT, {
      id: mid.id,
      title: mid.title,
      content: mid.content,
      category: "home",
      audience: "home",
      sort_order: 2,
      is_active: true,
      is_scrolling: true,
    });
  }
  // Normalize sorts: 标题3→1, 标题2→2, 标题1→3 for clear rotate order
  const finalRows = (await homeList()).filter((r) => String(r.title || "").includes(MARK));
  for (const row of finalRows) {
    const n = /标题(\d)/.exec(String(row.title || ""));
    const sort = n ? Number(n[1]) : 100;
    await saveAnn(adminT, {
      id: row.id,
      title: row.title,
      content: row.content,
      category: "home",
      audience: "home",
      sort_order: sort,
      is_active: true,
      is_scrolling: true,
    });
  }
  const left = (await homeList()).filter((r) => String(r.title || "").includes(MARK));
  ok("leave 3 enabled home anns for visual", left.length === 3, left.map((r) => `${r.sort_order ?? r.sort}:${r.title}`).join(" | "));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
