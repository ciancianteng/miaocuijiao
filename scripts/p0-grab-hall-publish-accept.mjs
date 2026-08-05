/**
 * P0 accept: CS confirm payment → grab hall listing → companion sees order → grab → count updates.
 * Usage: node scripts/p0-grab-hall-publish-accept.mjs
 * Targets fixed Staging by default.
 */
const BASE = process.env.MCJ_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_EMAIL = process.env.MCJ_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP_EMAIL = process.env.MCJ_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const BOSS_EMAIL = process.env.MCJ_BOSS_EMAIL || "boss.final.1785714993009@meow.test";

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-service-token": token,
          }
        : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const err = new Error(json.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function login(role, email) {
  const action = role === "companion" ? "login" : role === "cs" ? "login" : "login";
  const path =
    role === "companion"
      ? "/api/companion"
      : role === "cs"
        ? "/api/customer-service"
        : "/api/auth";
  const body =
    role === "cs"
      ? { action: "login", account: email, password: PASS, remember: true }
      : role === "companion"
        ? { action: "login", account: email, password: PASS }
        : { action: "login", email, password: PASS, role: "boss" };
  const res = await api(path, "", body);
  const token =
    res.session?.accessToken ||
    res.session?.access_token ||
    res.accessToken ||
    res.token ||
    res.data?.session?.accessToken ||
    "";
  if (!token) throw new Error(`login missing token for ${role}`);
  return { token, session: res.session || res };
}

async function main() {
  console.log("BASE", BASE);
  const cs = await login("cs", CS_EMAIL);
  const companion = await login("companion", COMP_EMAIL);
  const boss = await login("boss", BOSS_EMAIL);

  // Ensure companion is online for hall visibility rules (soft).
  await api(
    "/api/companion",
    companion.token,
    { action: "set_online_status", online_status: "online" },
    { "x-mcj-access-token": companion.token }
  ).catch(() => null);

  const boot = await api("/api/customer-service", cs.token, { action: "bootstrap" }, { "x-mcj-service-token": cs.token });
  const bosses = boot.data?.bosses || [];
  const bossId =
    bosses.find((b) => /boss\.final|1785714993009/i.test(`${b.email || ""}${b.bossUid || ""}${b.name || ""}`))?.id ||
    bosses[0]?.id ||
    boss.session?.user?.id ||
    boss.session?.profile?.id;
  ok("resolve boss", !!bossId, bossId || "missing");

  const created = await api(
    "/api/customer-service",
    cs.token,
    {
      action: "create_order",
      boss_id: bossId,
      companion_id: "",
      game: "VALORANT",
      order_type: "open_grab",
      description: `P0 grab-hall accept ${Date.now()}`,
      hours: 1,
      unit_price: 35,
      total_amount: 35,
      send_to_hall: false,
    },
    { "x-mcj-service-token": cs.token }
  );
  const order = created.order || created.data?.order || created;
  const oid = order.id || order.orderId;
  ok("create open order awaiting_payment", !!oid && (order.status === "awaiting_payment" || created.order?.status === "awaiting_payment"), oid);

  // Simulate payment proof pending if needed: confirm_payment should still work (wallet soft-skip).
  const confirm = await api(
    "/api/customer-service",
    cs.token,
    { action: "confirm_payment", id: oid },
    { "x-mcj-service-token": cs.token }
  );
  ok(
    "confirm_payment publishes hall",
    confirm.sentToGrabHall === true && /抢单大厅/.test(String(confirm.message || "")),
    confirm.message
  );
  ok(
    "order status pending/抢单中",
    confirm.order?.status === "pending" || /抢单中/.test(String(confirm.order?.statusText || "")),
    `${confirm.order?.status} / ${confirm.order?.statusText}`
  );
  ok("assignment public / no companion", !confirm.order?.companionId && (confirm.order?.assignmentType === "public" || !confirm.order?.assignmentType), JSON.stringify({
    companionId: confirm.order?.companionId,
    assignmentType: confirm.order?.assignmentType,
  }));
  ok("listing bound", !!(confirm.listing || confirm.sentToGrabHall), confirm.listing ? "listing present" : "listing via marker/path");

  // Idempotent re-publish
  const again = await api(
    "/api/customer-service",
    cs.token,
    { action: "push_to_grab_hall", id: oid },
    { "x-mcj-service-token": cs.token }
  );
  ok("duplicate publish blocked/idempotent", again.alreadyPublished === true || /已在抢单大厅/.test(String(again.message || "")), again.message);

  // Companion hall must include the order
  const hall = await api("/api/companion", companion.token, null, {
    "x-mcj-access-token": companion.token,
  }).catch(() => null);
  // bootstrap via GET action
  const hallBoot = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${companion.token}`,
      "x-mcj-access-token": companion.token,
    },
  }).then((r) => r.json());
  const openOrders = hallBoot.data?.openOrders || hallBoot.openOrders || [];
  const seen = openOrders.some((o) => o.id === oid || o.orderId === oid);
  ok("companion hall shows order", seen, `openOrders=${openOrders.length}`);

  // Companion grabs
  const grab = await api(
    "/api/companion",
    companion.token,
    { action: "accept_order", id: oid },
    { "x-mcj-access-token": companion.token }
  ).catch(async (err) => {
    // Some builds use claim_order
    return api(
      "/api/companion",
      companion.token,
      { action: "claim_order", order_id: oid, id: oid },
      { "x-mcj-access-token": companion.token }
    ).catch(() => ({ ok: false, message: err.message }));
  });
  ok("companion can grab", grab.ok !== false && !/不在|不能|失败/.test(String(grab.message || "")), grab.message || "grabbed");

  const grabs = await api(
    "/api/customer-service",
    cs.token,
    { action: "list_grabs", id: oid },
    { "x-mcj-service-token": cs.token }
  );
  ok("grab count >= 1", Number(grabs.grabCount || grabs.grabs?.length || 0) >= 1, String(grabs.grabCount || grabs.grabs?.length || 0));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL", err.message || err);
  process.exit(1);
});
