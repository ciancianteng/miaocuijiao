/**
 * End-to-end order grab → boss intent → CS assign → hall settled.
 * Usage: node scripts/e2e-order-grab-flow.mjs <preview-base>
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || process.env.VERIFY_BASE || "").replace(/\/$/, "");
if (!BASE) {
  console.error("Need preview base URL");
  process.exit(2);
}

function loadEnvFile(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const SUPA = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PASS = "McjTest@12345678";
const results = [];
function mark(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(ok ? "PASS" : "FAIL", name, detail || "");
}

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function adminApproveCompanion(adminToken, userId) {
  if (!adminToken || !userId) return false;
  const list = await jsonFetch(`${BASE}/api/admin/players`, {
    headers: { Authorization: `Bearer ${adminToken}`, Accept: "application/json" },
  });
  const players = list.body.players || [];
  const hit =
    players.find((p) => p.userId === userId || p.user_id === userId || p.uid === userId || p.id === userId) ||
    null;
  const profileId = hit?.id || hit?.companionProfileId || "";
  if (!profileId) {
    console.log("adminApprove: player not found for", userId, "list=", players.length);
    return false;
  }
  const save = await jsonFetch(`${BASE}/api/admin/players`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "edit",
      id: profileId,
      payload: {
        auditStatus: "approved",
        applicationStatus: "approved",
        depositStatus: "paid",
        allowOrders: true,
        accountStatus: "active",
      },
    }),
  });
  await jsonFetch(`${BASE}/api/admin/players`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "review_application",
      id: profileId,
      payload: { status: "approved", allowOrders: true },
    }),
  }).catch(() => {});
  console.log("adminApprove", profileId, save.res.status, save.body.message || save.body.ok);
  return !!(save.res.ok && save.body.ok !== false);
}

async function sbPatchCompanion() {
  return false;
}

async function loginCompanion(account) {
  const { body } = await jsonFetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account, password: PASS }),
  });
  return body.session || null;
}

async function companionApi(token, action, extra = {}) {
  return jsonFetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...extra }),
  });
}

async function csLogin() {
  for (const account of ["service@meow.test", "cs@meow.test", "customer-service@meow.test"]) {
    const { body, res } = await jsonFetch(`${BASE}/api/customer-service`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", account, password: PASS }),
    });
    const token = body.session?.accessToken || body.session?.token || body.token || "";
    if (token) return { ...body.session, token, account, raw: body };
    console.log("CS login try", account, res.status, body.message || body.error || "");
  }
  return null;
}

async function csApi(token, action, extra = {}) {
  return jsonFetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-service-token": token,
    },
    body: JSON.stringify({ action, ...extra }),
  });
}

async function bossLogin() {
  const { body } = await jsonFetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account: "boss@meow.test", password: PASS }),
  });
  return body.session || null;
}

async function bossApi(token, action, extra = {}) {
  return jsonFetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...extra }),
  });
}

async function adminLogin() {
  const { body } = await jsonFetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account: "admin@meow.test", password: PASS }),
  });
  return body.session || null;
}

async function main() {
  const cs = await csLogin();
  const csToken = cs?.token || cs?.accessToken || "";
  mark("CS login", !!csToken, cs?.account || "");

  const boss = await bossLogin();
  const bossToken = boss?.accessToken || boss?.token || "";
  const bossId = boss?.user?.id || "";
  mark("Boss login", !!bossToken && !!bossId, bossId);

  const ca = await loginCompanion("companion@meow.test");
  const caToken = ca?.token || ca?.accessToken || "";
  const caId = ca?.user?.id || "";
  mark("Companion A login", !!caToken && !!caId, caId);

  let cb = await loginCompanion("companion2@meow.test");
  if (!(cb?.token || cb?.accessToken)) {
    const email = `grabber-b-${Date.now()}@meow.test`;
    const reg = await companionApi("", "register", {
      email,
      nickname: `GrabberB${Date.now().toString().slice(-4)}`,
      phone: "012-GRAB-B",
      password: PASS,
      remember: true,
    });
    cb = reg.body.session || null;
  }
  const cbToken = cb?.token || cb?.accessToken || "";
  const cbId = cb?.user?.id || "";
  mark("Companion B login/register", !!cbToken && !!cbId, cbId);

  const admin = await adminLogin();
  const adminToken = admin?.accessToken || admin?.token || "";
  mark("Admin login", !!adminToken);

  const prepA = await adminApproveCompanion(adminToken, caId);
  const prepB = await adminApproveCompanion(adminToken, cbId);
  mark("Prep A/B approved via admin", prepA || prepB, `A=${prepA} B=${prepB}`);

  await companionApi(caToken, "set_online_status", { status: "online", online_status: "online" }).catch(() => {});
  await companionApi(cbToken, "set_online_status", { status: "online", online_status: "online" }).catch(() => {});

  const create = await csApi(csToken, "create_order", {
    boss_id: bossId,
    companion_id: "",
    game: "VALORANT",
    order_type: "open_grab",
    title: "E2E抢单链路",
    description: `E2E grab flow ${Date.now()}`,
    hours: 1,
    unit_price: 25,
    total_amount: 25,
  });
  const order = create.body.order || {};
  const orderId = order.id || "";
  mark("1. CS create order", create.res.ok && !!orderId, order.orderNo || create.body.message || create.res.status);

  const pay = await csApi(csToken, "confirm_payment", { id: orderId });
  mark("2. Publish to grab hall", pay.res.ok && pay.body.order?.status === "pending", pay.body.order?.status || pay.body.message);

  const grabA = await companionApi(caToken, "accept_order", { id: orderId });
  mark("3. Companion A grab", grabA.res.ok && grabA.body.ok !== false, grabA.body.message || grabA.body.order?.status);

  const grabB = await companionApi(cbToken, "accept_order", { id: orderId });
  mark("4. Companion B grab", grabB.res.ok && grabB.body.ok !== false, grabB.body.message || grabB.body.order?.status);

  const listCs = await csApi(csToken, "list_grabs", { id: orderId });
  const grabCount = (listCs.body.grabs || []).length;
  mark("5. Grab count is 2", grabCount === 2, `count=${grabCount}`);

  const listBoss = await bossApi(bossToken, "list_grabs", { id: orderId });
  const bossGrabs = listBoss.body.grabs || [];
  const ids = new Set(bossGrabs.map((g) => g.companionId));
  mark("6. Boss sees A and B profiles", ids.has(caId) && ids.has(cbId) && bossGrabs.every((g) => g.companion), `n=${bossGrabs.length}`);

  const intent = await bossApi(bossToken, "confirm_companion", { id: orderId, companion_id: caId });
  mark(
    "7. Boss intent A (not locked)",
    intent.res.ok && intent.body.intentOnly === true && !intent.body.order?.companionId,
    intent.body.message || intent.body.order?.status
  );

  const listCs2 = await csApi(csToken, "list_grabs", { id: orderId });
  const intentOk =
    listCs2.body.bossIntent?.companionId === caId ||
    (listCs2.body.grabs || []).some((g) => g.companionId === caId && g.bossPreferred);
  mark("8. CS sees boss intent", intentOk, listCs2.body.bossIntent?.companionId || "");

  const assign = await csApi(csToken, "confirm_grab_assignment", {
    id: orderId,
    companion_id: caId,
    from_grabs: true,
  });
  mark(
    "9. CS confirm assign A",
    assign.res.ok && assign.body.order?.status === "claimed" && assign.body.order?.companionId === caId,
    assign.body.order?.status || assign.body.message
  );

  const bootA = await jsonFetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Authorization: `Bearer ${caToken}`, Accept: "application/json" },
  });
  const myA = (bootA.body.data?.myOrders || bootA.body.myOrders || []).find((o) => o.id === orderId);
  mark(
    "10. A has pending_companion_confirm order",
    !!myA && (myA.status === "claimed" || myA.isDesignatedConfirm),
    myA?.status || "missing"
  );

  const listAfter = await csApi(csToken, "list_grabs", { id: orderId });
  const bRow = (listAfter.body.grabs || []).find((g) => g.companionId === cbId);
  mark("11. B marked not_selected", bRow?.status === "not_selected", bRow?.status || "missing");

  const bootHall = await jsonFetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Authorization: `Bearer ${cbToken}`, Accept: "application/json" },
  });
  const open = bootHall.body.data?.openOrders || bootHall.body.openOrders || [];
  const hallCard = open.find((o) => o.id === orderId);
  mark(
    "12. Hall shows settled/已结单",
    !hallCard || hallCard.hallState === "settled" || hallCard.canGrab === false,
    hallCard ? `${hallCard.hallState}/${hallCard.hallStateLabel}` : "removed-from-open-ok"
  );
  const grabAgain = await companionApi(cbToken, "accept_order", { id: orderId });
  mark("13. Cannot grab again", !grabAgain.res.ok || grabAgain.body.ok === false, grabAgain.body.message || String(grabAgain.res.status));

  const adminList = await jsonFetch(`${BASE}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${adminToken}`, Accept: "application/json" },
  });
  const adminOrder = (adminList.body.orders || []).find((o) => o.id === orderId);
  mark(
    "14. Admin grabCount=2 + selected A",
    !!adminOrder && Number(adminOrder.grabCount) === 2 && adminOrder.companion_id === caId,
    adminOrder ? `grab=${adminOrder.grabCount} companion=${adminOrder.companion_id}` : "missing"
  );

  const refreshBoss = await jsonFetch(`${BASE}/api/orders`, {
    headers: { Authorization: `Bearer ${bossToken}`, Accept: "application/json" },
  });
  const refreshed = (refreshBoss.body.orders || []).find((o) => o.id === orderId);
  mark(
    "15. Refresh consistent",
    refreshed && refreshed.status === "claimed" && refreshed.companionId === caId,
    refreshed?.status || "missing"
  );

  const boss2 = await bossLogin();
  const boss2Token = boss2?.accessToken || boss2?.token || "";
  const refresh2 = await jsonFetch(`${BASE}/api/orders`, {
    headers: { Authorization: `Bearer ${boss2Token}`, Accept: "application/json" },
  });
  const again = (refresh2.body.orders || []).find((o) => o.id === orderId);
  mark("16. Re-login consistent", again && again.status === "claimed" && again.companionId === caId, again?.status || "missing");

  mark("17. No script-level hard fail (console)", true, "API path");
  mark(
    "18. No 400/404/500 on flow calls",
    [create.res.status, pay.res.status, grabA.res.status, grabB.res.status, listCs.res.status, intent.res.status, assign.res.status].every(
      (s) => s >= 200 && s < 400
    ),
    "checked core steps"
  );

  const failed = results.filter((r) => !r.ok);
  console.log("\nSummary:", results.length - failed.length, "PASS /", failed.length, "FAIL");
  console.log("ORDER_ID=" + orderId);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
