/**
 * P0-4/5: assign companion + companion portal smoke on fixed Staging.
 * Usage: node scripts/p0-4-assign-companion-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${STAGING}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

(async () => {
  console.log("STAGING", STAGING);
  const bossT = tok((await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" })).json);
  const csT = tok((await api("/api/customer-service", null, { action: "login", account: CS, password: PASS })).json);
  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const compT = tok(compLogin.json);
  const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS })).json);
  step("Logins", !!(bossT && csT && compT && adminT), `boss=${!!bossT} cs=${!!csT} comp=${!!compT} admin=${!!adminT}`);

  const comps = (await api("/api/public/companions", null, null, "GET")).json.companions || [];
  const c1 = comps.find((c) => /Final/i.test(c.name || "")) || comps[0];
  step("Companion exists", !!c1?.id, `${c1?.name} ${c1?.id}`);

  // --- Assign path ---
  const place = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P04指定陪玩",
      game: "VALORANT",
      game_id: "P04-ASSIGN",
      description: "P0-4 assign",
      hours: 1,
      unit_price: 18,
      total_amount: 18,
      order_type: "custom",
      payment_method: "tng",
    },
  });
  const oid = place.json?.order?.id;
  step("Create unpaid order", !!(place.json?.ok && oid), oid);
  await api("/api/orders", bossT, { action: "submit_payment_proof", id: oid, proofDataUrl: PNG, paymentMethod: "tng" });
  const confirm = await api("/api/customer-service", csT, { action: "confirm_payment", id: oid });
  step("Confirm → pending hall", confirm.json?.ok && confirm.json?.order?.status === "pending", confirm.json?.order?.status);

  const assign = await api("/api/customer-service", csT, {
    action: "assign_companion",
    id: oid,
    companion_id: c1.id,
    from_grabs: false,
  });
  step(
    "CS assign writes claimed",
    !!(assign.json?.ok && assign.json?.order?.status === "claimed" && /指定成功/.test(String(assign.json?.message || ""))),
    `status=${assign.json?.order?.status} msg=${assign.json?.message} companion=${assign.json?.order?.companionId || assign.json?.order?.companion_id}`
  );

  const bossO = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json.orders || []).find((o) => o.id === oid);
  step(
    "Boss → 等待陪玩确认",
    bossO?.status === "claimed" && /等待陪玩确认/.test(String(bossO?.statusText || "")),
    `${bossO?.status}/${bossO?.statusText}`
  );

  const boot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const mine = boot.json?.data?.myOrders || [];
  const hit = mine.find((o) => o.id === oid);
  step("Companion sees designated", !!(hit && hit.status === "claimed"), `found=${!!hit} status=${hit?.status}`);

  // Reject path on second order
  const place2 = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P04拒单回派",
      game: "VALORANT",
      game_id: "P04-REJ",
      description: "reject",
      hours: 1,
      unit_price: 14,
      total_amount: 14,
      order_type: "custom",
      payment_method: "tng",
    },
  });
  const oid2 = place2.json?.order?.id;
  await api("/api/orders", bossT, { action: "submit_payment_proof", id: oid2, proofDataUrl: PNG, paymentMethod: "tng" });
  await api("/api/customer-service", csT, { action: "confirm_payment", id: oid2 });
  await api("/api/customer-service", csT, { action: "assign_companion", id: oid2, companion_id: c1.id, from_grabs: false });
  const reject = await api("/api/companion", compT, { action: "reject_direct_order", id: oid2, reason: "档期冲突" });
  step("Companion reject", !!reject.json?.ok && reject.json?.order?.status === "pending", `ok=${reject.json?.ok} status=${reject.json?.order?.status} msg=${reject.json?.message}`);

  const boss2 = ((await api(`/api/orders?id=${oid2}`, bossT, null, "GET")).json.orders || []).find((o) => o.id === oid2);
  const csBoot = await api("/api/customer-service", csT, { action: "bootstrap" });
  const cs2 = (csBoot.json?.data?.orders || []).find((o) => o.id === oid2);
  step(
    "Reject → pending redispatch",
    boss2?.status === "pending" && !boss2?.companionId && cs2?.status === "pending" && cs2?.needsReassign === true,
    `boss=${boss2?.status}/${boss2?.companionId} cs=${cs2?.status}/needsReassign=${cs2?.needsReassign}`
  );

  // Accept path on first order
  const accept = await api("/api/companion", compT, { action: "accept_direct_order", id: oid });
  step("Companion accept → in_progress", !!accept.json?.ok && accept.json?.order?.status === "in_progress", accept.json?.order?.status);

  const boss3 = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json.orders || []).find((o) => o.id === oid);
  const cs3 = ((await api("/api/customer-service", csT, { action: "bootstrap" })).json?.data?.orders || []).find((o) => o.id === oid);
  const adminOrders = await api("/api/admin/orders", adminT, null, "GET");
  const ao = (adminOrders.json?.orders || []).find((o) => o.id === oid);
  step(
    "三端同步进行中",
    boss3?.status === "in_progress" && cs3?.status === "in_progress" && ao?.status === "in_progress",
    `boss=${boss3?.statusText || boss3?.status} cs=${cs3?.statusText || cs3?.status} admin=${ao?.statusText || ao?.status}`
  );

  // Grab hall alreadyGrabbed
  const hallBoot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const open = hallBoot.json?.data?.openOrders || [];
  const grabTarget = open.find((o) => o.status === "pending" && !o.alreadyGrabbed);
  if (grabTarget) {
    const grab = await api("/api/companion", compT, { action: "accept_order", id: grabTarget.id });
    const after = ((await api("/api/companion?action=bootstrap", compT, null, "GET")).json?.data?.openOrders || []).find(
      (o) => o.id === grabTarget.id
    );
    step(
      "Grab hall shows 已抢单",
      !!(grab.json?.ok && after?.alreadyGrabbed),
      `grabOk=${grab.json?.ok} already=${after?.alreadyGrabbed} status=${after?.status}`
    );
  } else {
    step("Grab hall shows 已抢单", open.some((o) => o.alreadyGrabbed), `no fresh target; existing alreadyGrabbed=${open.filter((o) => o.alreadyGrabbed).length}`);
  }

  // Media / earnings / withdraw
  const avatar = await api("/api/companion", compT, { action: "upload_media", media_type: "avatar", data_url: PNG, filename: "a.png" });
  const gallery = await api("/api/companion", compT, { action: "upload_media", media_type: "gallery", data_url: PNG, filename: "g.png" });
  const voice = await api("/api/companion", compT, {
    action: "upload_media",
    media_type: "voice",
    data_url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
    filename: "v.wav",
  });
  step("Upload avatar/gallery/voice", !!(avatar.json?.ok && gallery.json?.ok && voice.json?.ok), `a=${avatar.json?.ok} g=${gallery.json?.ok} v=${voice.json?.ok}`);

  const earnings = hallBoot.json?.data?.earnings || {};
  step("Earnings real stats", typeof earnings.totalIncome === "number" || typeof earnings.monthIncome === "number", JSON.stringify(earnings).slice(0, 120));

  const fin = await api("/api/admin/finance?action=bootstrap", adminT, null, "GET");
  const wds = fin.json?.withdrawals || [];
  step("Admin has withdrawal records capability", Array.isArray(wds), `count=${wds.length}`);
  const wd = await api("/api/companion", compT, { action: "request_withdrawal", amount: 1, remark: "p04" });
  step(
    "Withdraw API real path",
    !!(wd.json?.ok || /上限|余额|账户|审核|pending|提现/.test(String(wd.json?.message || ""))),
    `ok=${wd.json?.ok} msg=${wd.json?.message}`
  );

  const js = await fetch(`${STAGING}/src/companion-workbench.js?v=20260805p04c1`).then((r) => r.text());
  step("PC grab UI stays on hall", /已抢单，等待老板选择/.test(js) && /go\('\/companion\/order-hall'\)/.test(js), "workbench asset");

  console.log("\n=== P0-4 ASSIGN / COMPANION SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  console.log(`PASS=${results.length - fail} FAIL=${fail}`);
  console.log(`STAGING=${STAGING}/`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
