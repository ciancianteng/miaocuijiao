/**
 * Release Mode core acceptance — Preview/Production same script.
 * Usage: node scripts/release-e2e.mjs <base-url>
 */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const PASS = "McjTest@12345678";
if (!BASE) {
  console.error("Usage: node scripts/release-e2e.mjs <url>");
  process.exit(2);
}
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
async function jfetch(path, init = {}) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { res, body, status: res.status };
}
function tok(auth) {
  return auth?.session?.accessToken || auth?.session?.token || auth?.accessToken || "";
}
async function login(email, portal) {
  const { body } = await jfetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS, loginPortal: portal }),
  });
  return { ok: !!body?.ok, token: tok(body), body };
}

(async () => {
  const health = await jfetch("/api/auth?action=health");
  step("DB same Supabase configured", !!(health.body?.ok && health.body?.configured !== false), JSON.stringify(health.body).slice(0, 160));

  for (const [n, p] of [
    ["Boss", "/"],
    ["CS", "/customer-service/login/"],
    ["Companion", "/companion/login/"],
    ["Admin", "/admin/login/"],
  ]) {
    const r = await fetch(BASE + p);
    step(`Portal ${n}`, r.ok, `status=${r.status}`);
  }

  const home = await fetch(BASE + "/");
  const html = await home.text();
  step(
    "Home core entries present",
    /companion-center\.html/.test(html) && /custom-order\.html/.test(html) && /team-lobby\.html/.test(html) && /orders\.html/.test(html) && /support\.html/.test(html),
    "entries ok"
  );
  step("Home no freeze overlay script traps", !/今晚暂未开放运营/.test(html), "release freeze emptied");

  // Seed fixtures
  await jfetch("/api/dev/seed-p03-preview", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => ({}));

  const boss = await login("boss@meow.test", "boss");
  step("Boss login", boss.ok && !!boss.token, `ok=${boss.ok}`);
  const cs = await login("service@meow.test", "customer_service");
  step("CS login", cs.ok && !!cs.token, `ok=${cs.ok}`);
  const companion = await login("companion@meow.test", "companion");
  step("Companion login", companion.ok && !!companion.token, `ok=${companion.ok}`);
  const admin = await login("admin@meow.test", "admin");
  step("Admin login", admin.ok && !!admin.token, `ok=${admin.ok}`);

  // Boss register (idempotent — may already exist)
  const regEmail = `boss.release.${Date.now()}@meow.test`;
  const reg = await jfetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "register",
      email: regEmail,
      password: PASS,
      nickname: "Release老板",
      loginPortal: "boss",
    }),
  });
  step("Boss register", !!(reg.body?.ok || /already|存在|registered/i.test(reg.body?.message || "")), `ok=${reg.body?.ok} msg=${reg.body?.message} uid=${reg.body?.bossUid || reg.body?.session?.user?.bossUid || ""}`);
  if (reg.body?.ok) {
    step("Boss register UID issued", !!(reg.body?.bossUid || reg.body?.session?.user?.bossUid), `uid=${reg.body?.bossUid || reg.body?.session?.user?.bossUid || ""}`);
  }

  const bossLoginUid = boss.body?.session?.user?.bossUid || boss.body?.user?.bossUid || "";
  // Soft note for first pass; hard check after register path proves metadata UID works.
  step("Boss login session ok", boss.ok && !!boss.token, `uid=${bossLoginUid || "(may backfill on this deploy)"}`);

  const bh = { Authorization: `Bearer ${boss.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ch = { Authorization: `Bearer ${cs.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ph = { Authorization: `Bearer ${companion.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ah = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json", Accept: "application/json", "x-mcj-admin-role": "admin" };

  const comps = await jfetch("/api/public/companions");
  const testComp = (comps.body?.companions || []).find((c) => /TEST|验收/.test(c.name || "")) || (comps.body?.companions || [])[0];
  step("Companion list from DB", !!(testComp && testComp.id), `id=${testComp?.id} name=${testComp?.name}`);

  // Custom order without companion → CS receives → push companion
  const custom = await jfetch("/api/orders", {
    method: "POST",
    headers: bh,
    body: JSON.stringify({
      action: "create",
      order: {
        title: "Release自定义单",
        game: "VALORANT",
        game_id: "REL-GID",
        description: "Release 推送陪玩验收\n游戏ID：REL-GID",
        hours: 1,
        unit_price: 35,
        total_amount: 35,
        order_type: "custom",
      },
    }),
  });
  const oid = custom.body?.order?.id;
  step("Boss real order (custom)", !!(custom.body?.ok && oid), `id=${oid} status=${custom.body?.order?.status}`);

  const csGet = await jfetch("/api/customer-service", { method: "GET", headers: ch });
  const csOrders = csGet.body?.data?.orders || [];
  const seen = csOrders.some((o) => o.id === oid);
  step("CS receives order", !!(csGet.body?.ok && seen), `orders=${csOrders.length} seen=${seen}`);

  const pay = await jfetch("/api/customer-service", {
    method: "POST",
    headers: ch,
    body: JSON.stringify({ action: "confirm_payment", id: oid }),
  });
  step("CS confirm payment → pending/claimed", !!(pay.body?.ok), `status=${pay.body?.order?.status}`);

  const push = await jfetch("/api/customer-service", {
    method: "POST",
    headers: ch,
    body: JSON.stringify({ action: "push_companion", id: oid, companion_id: testComp.id }),
  });
  step("CS push companion", !!(push.body?.ok && push.body.order?.companion_id), `status=${push.body?.order?.status} companion=${push.body?.order?.companion_id}`);

  const accept = await jfetch("/api/companion", {
    method: "POST",
    headers: ph,
    body: JSON.stringify({ action: "accept_direct_order", id: oid }),
  });
  step("Companion accept", !!(accept.body?.ok && accept.body.order?.status === "confirmed"), `status=${accept.body?.order?.status}`);

  const start = await jfetch("/api/companion", {
    method: "POST",
    headers: ph,
    body: JSON.stringify({ action: "start_order", id: oid }),
  });
  step("Order → in_progress", !!(start.body?.ok && start.body.order?.status === "in_progress"), `status=${start.body?.order?.status}`);

  const complete = await jfetch("/api/companion", {
    method: "POST",
    headers: ph,
    body: JSON.stringify({ action: "complete_order", id: oid }),
  });
  step("Order → completed", !!(complete.body?.ok && complete.body.order?.status === "completed"), `status=${complete.body?.order?.status}`);

  const banners = await jfetch("/api/admin/content?type=banners", { headers: ah });
  step("Admin Banner", !!(banners.body?.ok || Array.isArray(banners.body?.banners) || Array.isArray(banners.body?.items)), `http=${banners.status}`);
  const anns = await jfetch("/api/admin/content?type=announcements", { headers: ah });
  step("Admin announcements", !!(anns.body?.ok || Array.isArray(anns.body?.announcements) || Array.isArray(anns.body?.items)), `http=${anns.status}`);
  const ordersAdmin = await jfetch("/api/admin/orders", { headers: ah });
  step("Admin orders", !!(ordersAdmin.body?.ok || Array.isArray(ordersAdmin.body?.orders)), `count=${(ordersAdmin.body?.orders || []).length}`);
  const players = await jfetch("/api/admin/players", { headers: ah });
  step("Admin companion audit list", !!(players.body?.ok || Array.isArray(players.body?.players) || Array.isArray(players.body?.items)), `http=${players.status}`);

  console.log("\n=== RELEASE E2E SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  const pass = results.filter((r) => r.result === "PASS").length;
  console.log(`PASS=${pass} FAIL=${fail}`);
  console.log(`BASE=${BASE}`);
  console.log(`ORDER_ID=${oid || ""}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
