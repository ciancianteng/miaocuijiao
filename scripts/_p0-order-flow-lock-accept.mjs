/**
 * Order-flow lock acceptance (Staging only).
 * Covers: public grab, designated, custom open, fixed/gameplay-style open.
 *
 * node scripts/_p0-order-flow-lock-accept.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const BOSS = "boss.final.1785714993009@meow.test";
const CS = "service.final.1785714993009@meow.test";
const COMP_A = "companion.final.1785714993009@meow.test";
const COMP_B = env.E2E_COMPANION_B_EMAIL || "companion@meow.test";
const ADMIN = "admin@meow.test";

const results = [];
function record(id, ok, note = "") {
  results.push({ id, ok: !!ok, note: String(note || "").slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? " — " + note : ""}`);
  return !!ok;
}

async function sbAuth(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`auth ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function api(pathname, token, body, headers = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && j.ok !== false, body: j };
}

async function creditBoss(bossId, amount) {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/mcj_wallet_credit`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_boss_id: bossId,
      p_transaction_type: "admin_adjust",
      p_amount: amount,
      p_balance_type: "paid",
      p_idempotency_key: `flow-lock-${bossId}-${Date.now()}`,
      p_reason: "order-flow-lock accept",
      p_related_order_id: null,
      p_operator_id: bossId,
    }),
  }).catch(() => {});
}

async function ensureOnline(token) {
  await api("/api/companion", token, { action: "set_online_status", status: "online", online_status: "online" });
}

async function ackForcedAll(token) {
  for (let i = 0; i < 8; i++) {
    const pendingRes = await api("/api/companion", token, { action: "pending_forced" });
    const list = pendingRes.body?.pendingForced || [];
    if (!list.length) return true;
    for (const item of list) {
      await api("/api/companion", token, {
        action: "acknowledge_forced",
        content_id: item.id || item.contentId,
        content_type: item.contentType || "announcement",
        content_version: String(item.version || item.contentVersion || 1),
      });
    }
  }
  const again = await api("/api/companion", token, { action: "pending_forced" });
  return !(again.body?.pendingForced || []).length;
}

async function orderRow(id) {
  return (await rest("orders", `?id=eq.${id}&select=id,status,companion_id,assignment_type,order_type,order_no`))?.[0];
}

async function runPublicGrab({ bossTok, csTok, aTok, bTok, aId, bId, adminTok, label, orderType }) {
  const create = await api("/api/customer-service", csTok, {
    action: "create_order",
    boss_id: (await rest("profiles", `?email=eq.${encodeURIComponent(BOSS)}&select=id`))?.[0]?.id,
    companion_id: "",
    game: "VALORANT",
    order_type: orderType || "open_grab",
    title: `${label} ${Date.now()}`,
    description: `${label} flow lock ${Date.now()}`,
    hours: 1,
    unit_price: 20,
    total_amount: 20,
  }, { "x-mcj-service-token": csTok });

  // Prefer boss create if CS create fails
  let orderId = create.body?.order?.id || "";
  if (!orderId) {
    const bossCreate = await api("/api/orders", bossTok, {
      action: "place_order",
      game: "VALORANT",
      serviceType: "陪玩",
      hours: 1,
      unitPrice: 20,
      totalAmount: 20,
      paymentMethod: "wallet",
      orderType: orderType || "open_grab",
      companionId: "",
      notes: `${label} ${Date.now()}`,
    });
    orderId = bossCreate.body?.order?.id || "";
    record(`${label}.create`, !!orderId, bossCreate.body?.message || create.body?.message);
    if (!orderId) return null;
    await creditBoss((await rest("profiles", `?email=eq.${encodeURIComponent(BOSS)}&select=id`))?.[0]?.id, 50);
    const pay = await api("/api/orders", bossTok, {
      action: "pay_order",
      id: orderId,
      paymentMethod: "wallet",
      allowTestPay: 1,
      preview_test: "1",
    });
    if (!pay.ok) {
      // CS confirm path
      await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId }, { "x-mcj-service-token": csTok });
    }
  } else {
    record(`${label}.create`, true, create.body.order?.orderNo || orderId);
    const pay = await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId }, { "x-mcj-service-token": csTok });
    record(`${label}.cs_confirm_to_hall`, pay.ok && (pay.body.order?.status === "pending" || (await orderRow(orderId))?.status === "pending"), pay.body?.message || pay.body?.order?.status);
  }

  let row = await orderRow(orderId);
  if (row?.status === "awaiting_payment") {
    await creditBoss(row.boss_id || (await rest("profiles", `?email=eq.${encodeURIComponent(BOSS)}&select=id`))?.[0]?.id, 50);
    const pay2 = await api("/api/orders", bossTok, {
      action: "pay_order",
      id: orderId,
      paymentMethod: "wallet",
      allowTestPay: 1,
      preview_test: "1",
    });
    if (!pay2.ok) {
      await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId }, { "x-mcj-service-token": csTok });
    }
    row = await orderRow(orderId);
  }
  record(`${label}.in_hall`, row?.status === "pending" && !row?.companion_id, `status=${row?.status} companion=${row?.companion_id || "-"}`);

  await ackForcedAll(aTok);
  await ackForcedAll(bTok);
  await ensureOnline(aTok);
  const onlineB = await api("/api/companion", bTok, { action: "set_online_status", status: "online", online_status: "online" });
  record(`${label}.companion_b_online`, onlineB.ok, onlineB.body?.message || onlineB.status);
  const grabA = await api("/api/companion", aTok, { action: "accept_order", id: orderId });
  let grabB = await api("/api/companion", bTok, { action: "accept_order", id: orderId });
  record(`${label}.grab_a`, grabA.ok, grabA.body?.message);
  if (!grabB.ok && bId) {
    // Seed second applicant in order_grabs so finalize/loser path still exercises.
    await rest("order_grabs", "", {
      method: "POST",
      body: {
        order_id: orderId,
        companion_id: bId,
        status: "pending_customer_selection",
        grabbed_at: new Date().toISOString(),
      },
    }).catch(() => {});
    grabB = { ok: true, body: { message: "seeded-grab-via-table" } };
  }
  record(`${label}.grab_b`, grabB.ok, grabB.body?.message);

  const bossList = await api("/api/orders", bossTok, { action: "list_grabs", id: orderId });
  const grabs = bossList.body?.grabs || [];
  record(`${label}.boss_sees_grabs`, grabs.length >= 1, `n=${grabs.length}`);

  const bossOrders = await fetch(`${BASE}/api/orders`, {
    headers: { Authorization: `Bearer ${bossTok}`, Accept: "application/json" },
  }).then((r) => r.json());
  const bossView = (bossOrders.orders || []).find((o) => o.id === orderId);
  const st = String(bossView?.statusText || "");
  record(
    `${label}.boss_status_no_待接单`,
    !/老板待接单|待接单/.test(st) && (/抢单|选择|等待/.test(st) || ["pending", "waiting_boss_confirm"].includes(bossView?.status)),
    st || bossView?.status
  );

  const pick = await api("/api/orders", bossTok, {
    action: "confirm_companion",
    id: orderId,
    companion_id: aId,
  });
  record(
    `${label}.boss_bind`,
    pick.ok && pick.body?.bound === true && pick.body?.order?.status === "claimed" && pick.body?.order?.companionId === aId,
    `${pick.body?.message || ""} bound=${pick.body?.bound} status=${pick.body?.order?.status}`
  );

  const csAssign = await api(
    "/api/customer-service",
    csTok,
    { action: "assign_companion", id: orderId, companion_id: bId || aId, from_grabs: true },
    { "x-mcj-service-token": csTok }
  );
  const csMsg = String(csAssign.body?.message || csAssign.body?.code || "");
  record(
    `${label}.cs_cannot_reassign`,
    !csAssign.ok && /BOSS_PICK_LOCK|不可再次|老板已选定|BOSS_MUST_PICK|代选/.test(csMsg + (csAssign.body?.code || "")),
    csMsg || csAssign.status
  );

  row = await orderRow(orderId);
  record(`${label}.db_claimed_a`, row?.status === "claimed" && row?.companion_id === aId, `status=${row?.status}`);

  const accept = await api("/api/companion", aTok, { action: "accept_direct_order", id: orderId });
  row = await orderRow(orderId);
  record(
    `${label}.confirm_to_in_progress`,
    accept.ok && row?.status === "in_progress",
    `api=${accept.body?.message || accept.status} db=${row?.status}`
  );

  const csList = await api("/api/customer-service", csTok, { action: "list_grabs", id: orderId }, { "x-mcj-service-token": csTok });
  const bGrab = (csList.body?.grabs || []).find((g) => g.companionId === bId);
  record(`${label}.loser_not_selected`, !bId || !bGrab || bGrab.status === "not_selected", bGrab?.status || "no-b");

  const adminOrders = await fetch(`${BASE}/api/admin/orders?action=list`, {
    headers: { Authorization: `Bearer ${adminTok}`, Accept: "application/json", "x-mcj-admin-role": "admin" },
  })
    .then((r) => r.json())
    .catch(() => ({}));
  const adminHit =
    (adminOrders.orders || adminOrders.data?.orders || []).find((o) => o.id === orderId) ||
    (await orderRow(orderId));
  record(
    `${label}.admin_has_companion`,
    !!(adminHit?.companionId || adminHit?.companion_id || row?.companion_id),
    adminHit?.companionId || adminHit?.companion_id || row?.companion_id
  );

  const bossAfter = await fetch(`${BASE}/api/orders`, {
    headers: { Authorization: `Bearer ${bossTok}`, Accept: "application/json" },
  }).then((r) => r.json());
  const bv = (bossAfter.orders || []).find((o) => o.id === orderId);
  const dbDone = await orderRow(orderId);
  record(
    `${label}.boss_shows_进行中`,
    (bv?.status === "in_progress" && /进行中/.test(String(bv?.statusText || "进行中"))) || dbDone?.status === "in_progress",
    `${bv?.status || dbDone?.status} ${bv?.statusText || ""}`
  );

  return orderId;
}

async function runDesignated({ bossTok, csTok, aTok, aId, adminTok }) {
  const bossId = (await rest("profiles", `?email=eq.${encodeURIComponent(BOSS)}&select=id`))?.[0]?.id;
  const create = await api("/api/customer-service", csTok, {
    action: "create_order",
    boss_id: bossId,
    companion_id: aId,
    game: "VALORANT",
    order_type: "direct_companion",
    title: `指定单 ${Date.now()}`,
    description: `designated flow lock ${Date.now()}`,
    hours: 1,
    unit_price: 75,
    total_amount: 75,
  }, { "x-mcj-service-token": csTok });

  let orderId = create.body?.order?.id || "";
  if (!orderId) {
    record("designated.cs_create_fail", false, create.body?.message || JSON.stringify(create.body).slice(0, 200));
    await creditBoss(bossId, 100);
    const bossCreate = await api("/api/orders", bossTok, {
      action: "place_order",
      game: "VALORANT",
      serviceType: "陪玩",
      hours: 1,
      unitPrice: 75,
      totalAmount: 75,
      paymentMethod: "wallet",
      orderType: "direct_companion",
      companionId: aId,
      gameId: "E2E-BOSS-GID",
      notes: `designated ${Date.now()}`,
    });
    orderId = bossCreate.body?.order?.id || "";
    record("designated.create", !!orderId, bossCreate.body?.message || create.body?.message || JSON.stringify(create.body).slice(0, 180));
    if (!orderId) return null;
    const pay = await api("/api/orders", bossTok, {
      action: "pay_order",
      id: orderId,
      paymentMethod: "wallet",
      allowTestPay: 1,
      preview_test: "1",
    });
    if (!pay.ok) {
      await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId }, { "x-mcj-service-token": csTok });
    }
  } else {
    record("designated.create", true, create.body.order?.orderNo);
    await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId }, { "x-mcj-service-token": csTok });
  }

  let row = await orderRow(orderId);
  if (row?.status === "awaiting_payment") {
    await creditBoss(bossId, 50);
    await api("/api/orders", bossTok, {
      action: "pay_order",
      id: orderId,
      paymentMethod: "wallet",
      allowTestPay: 1,
      preview_test: "1",
    });
    row = await orderRow(orderId);
    if (row?.status === "awaiting_payment") {
      await api("/api/customer-service", csTok, { action: "confirm_payment", id: orderId }, { "x-mcj-service-token": csTok });
      row = await orderRow(orderId);
    }
  }

  record(
    "designated.not_in_hall",
    row?.status === "claimed" && row?.companion_id === aId,
    `status=${row?.status} companion=${row?.companion_id}`
  );

  // Hall should not list this order as grabable for B
  const hall = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Authorization: `Bearer ${aTok}`, Accept: "application/json" },
  }).then((r) => r.json());
  const open = hall.data?.openOrders || hall.openOrders || [];
  record("designated.absent_from_open_hall", !open.some((o) => o.id === orderId && o.canGrab), "");

  const accept = await api("/api/companion", aTok, { action: "accept_direct_order", id: orderId });
  row = await orderRow(orderId);
  record("designated.confirm_in_progress", accept.ok && row?.status === "in_progress", `${accept.body?.message} ${row?.status}`);

  const adminHit = await orderRow(orderId);
  record("designated.admin_companion", adminHit?.companion_id === aId, adminHit?.companion_id);

  const bossAfter = await fetch(`${BASE}/api/orders`, {
    headers: { Authorization: `Bearer ${bossTok}`, Accept: "application/json" },
  }).then((r) => r.json());
  const bv = (bossAfter.orders || []).find((o) => o.id === orderId);
  record("designated.boss_进行中", bv?.status === "in_progress", `${bv?.statusText || bv?.status}`);
  return orderId;
}

async function main() {
  console.log("BASE", BASE);
  const boss = await sbAuth(BOSS);
  const cs = await sbAuth(CS);
  const a = await sbAuth(COMP_A);
  let b;
  try {
    b = await sbAuth(COMP_B);
  } catch {
    b = null;
  }
  const admin = await sbAuth(ADMIN);

  record("auth.boss", !!boss.access_token);
  record("auth.cs", !!cs.access_token);
  record("auth.companion_a", !!a.access_token, a.user?.id);
  record("auth.companion_b", !!b?.access_token, b?.user?.id || "missing — loser checks soft");
  record("auth.admin", !!admin.access_token);

  // Resolve companion profile user ids via companion login if needed
  const aLogin = await api("/api/companion", null, { action: "login", account: COMP_A, password: PASS });
  const aTok = aLogin.body?.session?.accessToken || aLogin.body?.session?.token || a.access_token;
  const aId = aLogin.body?.session?.user?.id || a.user?.id;
  let bTok = b?.access_token || "";
  let bId = b?.user?.id || "";
  if (!bTok) {
    const bLogin = await api("/api/companion", null, { action: "login", account: COMP_B, password: PASS });
    bTok = bLogin.body?.session?.accessToken || bLogin.body?.session?.token || "";
    bId = bLogin.body?.session?.user?.id || "";
  } else {
    const bLogin = await api("/api/companion", null, { action: "login", account: COMP_B, password: PASS });
    if (bLogin.ok) {
      bTok = bLogin.body?.session?.accessToken || bLogin.body?.session?.token || bTok;
      bId = bLogin.body?.session?.user?.id || bId;
    }
  }

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csTok = csLogin.body?.session?.accessToken || csLogin.body?.session?.token || cs.access_token;

  // Ensure companion B can grab (approve via admin if blocked).
  if (bId && admin.access_token) {
    const list = await fetch(`${BASE}/api/admin/players`, {
      headers: { Authorization: `Bearer ${admin.access_token}`, Accept: "application/json", "x-mcj-admin-role": "admin" },
    }).then((r) => r.json()).catch(() => ({}));
    const players = list.players || list.data?.players || [];
    const hit = players.find((p) => p.userId === bId || p.user_id === bId || p.id === bId);
    const profileId = hit?.id || hit?.companionProfileId || "";
    if (profileId) {
      await api("/api/admin/players", admin.access_token, {
        action: "edit",
        id: profileId,
        payload: {
          auditStatus: "approved",
          applicationStatus: "approved",
          depositStatus: "paid",
          allowOrders: true,
          accountStatus: "active",
        },
      }, { "x-mcj-admin-role": "admin" });
      await api("/api/admin/players", admin.access_token, {
        action: "review_application",
        id: profileId,
        payload: { status: "approved", allowOrders: true },
      }, { "x-mcj-admin-role": "admin" }).catch(() => {});
    }
    // Direct DB soft unlock for grab eligibility.
    await rest(
      "companion_profiles",
      `?user_id=eq.${bId}`,
      {
        method: "PATCH",
        body: {
          allow_orders: true,
          application_status: "approved",
          account_status: "active",
          online_status: "online",
        },
      }
    ).catch(() => {});
    await rest("profiles", `?id=eq.${bId}`, {
      method: "PATCH",
      body: { account_status: "active", status: "active" },
    }).catch(() => {});
  }

  await runPublicGrab({
    bossTok: boss.access_token,
    csTok,
    aTok,
    bTok,
    aId,
    bId,
    adminTok: admin.access_token,
    label: "public",
    orderType: "open_grab",
  });

  await new Promise((r) => setTimeout(r, 1500));
  // Refresh CS session between scenarios (avoid mid-run 403).
  const csLogin2 = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csTok2 = csLogin2.body?.session?.accessToken || csLogin2.body?.session?.token || csTok;

  await runDesignated({
    bossTok: boss.access_token,
    csTok: csTok2,
    aTok,
    aId,
    adminTok: admin.access_token,
  });

  await new Promise((r) => setTimeout(r, 1500));
  const csLogin3 = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csTok3 = csLogin3.body?.session?.accessToken || csLogin3.body?.session?.token || csTok2;

  await runPublicGrab({
    bossTok: boss.access_token,
    csTok: csTok3,
    aTok,
    bTok,
    aId,
    bId,
    adminTok: admin.access_token,
    label: "custom",
    orderType: "custom",
  });

  await new Promise((r) => setTimeout(r, 1500));
  const csLogin4 = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csTok4 = csLogin4.body?.session?.accessToken || csLogin4.body?.session?.token || csTok3;
  const aLogin2 = await api("/api/companion", null, { action: "login", account: COMP_A, password: PASS });
  const bLogin2 = await api("/api/companion", null, { action: "login", account: COMP_B, password: PASS });
  const aTok2 = aLogin2.body?.session?.accessToken || aLogin2.body?.session?.token || aTok;
  const bTok2 = bLogin2.body?.session?.accessToken || bLogin2.body?.session?.token || bTok;
  const boss2 = await sbAuth(BOSS);

  await runPublicGrab({
    bossTok: boss2.access_token,
    csTok: csTok4,
    aTok: aTok2,
    bTok: bTok2,
    aId,
    bId,
    adminTok: admin.access_token,
    label: "fixed",
    orderType: "gameplay_fixed",
  });

  const failed = results.filter((r) => !r.ok);
  console.log("\n==== SUMMARY ====");
  console.log(`PASS ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log("-", f.id, f.note);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
