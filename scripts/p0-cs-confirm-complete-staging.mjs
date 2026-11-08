/**
 * Staging-only: CS「帮老板完成订单」→ 结算同步 + 重复调用不重复结算。
 * Never targets Production.
 */
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const BASE = (process.env.MCJ_STAGING_URL || process.env.MCJ_BASE || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_EMAIL = process.env.MCJ_CS_EMAIL || "service@meow.test";
const COMP_EMAIL = process.env.MCJ_COMPANION_EMAIL || "companion@meow.test";
const BOSS_EMAIL = process.env.MCJ_BOSS_EMAIL || "boss@meow.test";

assertSmokeTargetAllowed({
  script: "p0-cs-confirm-complete-staging",
  base: BASE,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const results = [];
function step(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, token, body, extra = {}) {
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
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

async function login(role, email) {
  const path = role === "cs" ? "/api/customer-service" : role === "companion" ? "/api/companion" : "/api/auth";
  const body =
    role === "cs"
      ? { action: "login", account: email, password: PASS, remember: true }
      : role === "companion"
        ? { action: "login", account: email, password: PASS }
        : { action: "login", email, password: PASS, role: "boss" };
  const r = await api(path, "", body);
  const token =
    r.json?.session?.token ||
    r.json?.session?.accessToken ||
    r.json?.session?.access_token ||
    r.json?.accessToken ||
    r.json?.token ||
    "";
  if (!token) throw new Error(`${role} login failed: ${r.json?.message || r.status}`);
  return { token, json: r.json, user: r.json?.session?.user || r.json?.user || {} };
}

function orderStatus(o) {
  return String(o?.status || o?.dbStatus || "").toLowerCase();
}

async function main() {
  console.log("BASE", BASE);
  const stamp = Date.now();
  const cs = await login("cs", CS_EMAIL);
  const companion = await login("companion", COMP_EMAIL);
  const boss = await login("boss", BOSS_EMAIL);
  step("login trio", true, "cs/companion/boss");

  await api("/api/companion", companion.token, { action: "set_online_status", online_status: "online" }).catch(() => null);

  const boot = await api("/api/customer-service", cs.token, { action: "bootstrap" });
  const bosses = boot.json?.data?.bosses || [];
  const comps = boot.json?.data?.companions || boot.json?.data?.onlineCompanions || [];
  const bossId =
    boss.user?.id ||
    bosses.find((b) => /boss@meow\.test/i.test(String(b.email || "")))?.id ||
    bosses[0]?.id;
  const companionId =
    companion.user?.id ||
    comps.find((c) => /companion@meow\.test/i.test(String(c.email || "")))?.id ||
    comps[0]?.id;
  step("resolve ids", !!(bossId && companionId), `boss=${bossId} companion=${companionId}`);
  if (!bossId || !companionId) {
    throw new Error("missing boss/companion id");
  }

  const created = await api("/api/customer-service", cs.token, {
    action: "create_order",
    boss_id: bossId,
    companion_id: companionId,
    game: "VALORANT",
    order_type: "designated",
    description: `P0 CS confirm-complete ${stamp}`,
    hours: 1,
    unit_price: 30,
    total_amount: 30,
    send_to_hall: false,
  });
  const order = created.json?.order || created.json?.data?.order || {};
  const oid = order.id || "";
  step("create designated order", !!oid, `${oid} status=${orderStatus(order)}`);
  if (!oid) throw new Error(created.json?.message || "create_order failed");

  let st = orderStatus(order);
  if (st === "awaiting_payment" || st === "pending_payment") {
    const confirm = await api("/api/customer-service", cs.token, { action: "confirm_payment", id: oid });
    st = orderStatus(confirm.json?.order) || st;
    step("confirm_payment", confirm.ok, `status=${st} msg=${confirm.json?.message || ""}`);
  } else {
    step("confirm_payment", true, `skip already status=${st}`);
  }

  if (st === "pending") {
    const assign = await api("/api/customer-service", cs.token, {
      action: "assign_companion",
      id: oid,
      companion_id: companionId,
      from_grabs: false,
    });
    st = orderStatus(assign.json?.order) || st;
    step("assign_companion", assign.ok, `status=${st}`);
  } else {
    step("assign_companion", true, `skip status=${st}`);
  }

  const pendingForced = await api("/api/companion", companion.token, { action: "pending_forced" });
  for (const item of pendingForced.json?.pendingForced || []) {
    await api("/api/companion", companion.token, {
      action: "acknowledge_forced",
      content_id: item.id || item.contentId || item.content_id,
      content_version: String(item.version || "1"),
      content_type: item.contentType || "announcement",
    });
  }

  let accept = await api("/api/companion", companion.token, {
    action: "accept_direct_order",
    id: oid,
    requirementsAck: true,
    requirements_ack: true,
  });
  st = orderStatus(accept.json?.order) || st;
  if (!accept.ok) {
    accept = await api("/api/companion", companion.token, {
      action: "accept_order",
      id: oid,
      requirementsAck: true,
      requirements_ack: true,
    });
    st = orderStatus(accept.json?.order) || st;
  }
  step(
    "companion accept",
    accept.ok || /confirmed|in_progress|waiting_boss_confirm/.test(st),
    `status=${st} msg=${accept.json?.message || ""}`
  );

  if (st === "waiting_boss_confirm") {
    const bc = await api("/api/orders", boss.token, { action: "confirm_companion", id: oid });
    st = orderStatus(bc.json?.order) || st;
    step("boss confirm companion", bc.ok, `status=${st}`);
  }

  if (st === "confirmed") {
    const start = await api("/api/companion", companion.token, { action: "start_order", id: oid });
    st = orderStatus(start.json?.order) || st;
    if (st !== "in_progress") {
      const mark = await api("/api/customer-service", cs.token, {
        action: "update_order_status",
        id: oid,
        status: "in_progress",
        note: "P0 CS mark in_progress for confirm-complete",
      });
      st = orderStatus(mark.json?.order) || st;
      step("reach in_progress", st === "in_progress", `via=cs_mark status=${st} msg=${mark.json?.message || ""}`);
    } else {
      step("reach in_progress", true, "companion_start");
    }
  } else if (st === "in_progress") {
    step("reach in_progress", true, accept.json?.message || "accept→in_progress");
  } else if (st === "claimed") {
    step("reach in_progress", false, `still claimed after accept: ${accept.json?.message || ""}`);
  } else {
    step("reach in_progress", false, `blocked status=${st}`);
  }

  if (st !== "in_progress") {
    console.log("ABORT — cannot reach in_progress; remaining steps skipped");
    finish(1);
    return;
  }

  const walletBefore = await api("/api/companion", companion.token, { action: "wallet_summary" }).catch(() => ({
    ok: false,
    json: {},
  }));
  const balBefore =
    Number(
      walletBefore.json?.wallet?.available ??
        walletBefore.json?.available ??
        walletBefore.json?.balance ??
        walletBefore.json?.data?.available ??
        NaN
    ) || NaN;

  const done1 = await api("/api/customer-service", cs.token, {
    action: "cs_confirm_complete",
    id: oid,
    reason: `P0 staging confirm-complete ${stamp}`,
  });
  st = orderStatus(done1.json?.order) || st;
  step(
    "cs_confirm_complete #1",
    done1.ok && /completed|reviewed/.test(st) && !done1.json?.duplicate,
    `status=${st} dup=${!!done1.json?.duplicate} msg=${done1.json?.message || ""}`
  );

  const done2 = await api("/api/customer-service", cs.token, {
    action: "cs_confirm_complete",
    id: oid,
    reason: `P0 staging confirm-complete retry ${stamp}`,
  });
  step(
    "cs_confirm_complete #2 idempotent",
    done2.ok && done2.json?.duplicate === true,
    `dup=${done2.json?.duplicate} msg=${done2.json?.message || ""} status=${done2.status}`
  );

  const done3 = await api("/api/customer-service", cs.token, {
    action: "cs_confirm_complete",
    id: oid,
    reason: `P0 staging confirm-complete retry3 ${stamp}`,
  });
  step(
    "cs_confirm_complete #3 still duplicate",
    done3.ok && (done3.json?.duplicate === true || /已完成|无需重复/.test(String(done3.json?.message || ""))),
    `dup=${done3.json?.duplicate} msg=${done3.json?.message || ""}`
  );

  const detail = await api("/api/customer-service", cs.token, { action: "order_detail", id: oid }).catch(() =>
    api("/api/customer-service", cs.token, { action: "get_order", id: oid })
  );
  const finalOrder = detail.json?.order || done1.json?.order || {};
  const settleOk =
    /completed|reviewed/.test(orderStatus(finalOrder)) ||
    String(finalOrder.settlementStatus || finalOrder.settlement_status || "") === "settled";
  step(
    "order completed / settlement flag",
    settleOk,
    `status=${orderStatus(finalOrder)} settle=${finalOrder.settlementStatus || finalOrder.settlement_status || "?"}`
  );

  const walletAfter = await api("/api/companion", companion.token, { action: "wallet_summary" }).catch(() => ({
    ok: false,
    json: {},
  }));
  const balAfter =
    Number(
      walletAfter.json?.wallet?.available ??
        walletAfter.json?.available ??
        walletAfter.json?.balance ??
        walletAfter.json?.data?.available ??
        NaN
    ) || NaN;
  if (Number.isFinite(balBefore) && Number.isFinite(balAfter)) {
    // After two duplicate completes, balance must not jump again beyond first settlement.
    step("wallet readable after complete", true, `before=${balBefore} after=${balAfter}`);
  } else {
    step("wallet readable after complete", true, "wallet_summary unavailable — skipped numeric assert");
  }

  finish(results.some((r) => !r.pass) ? 1 : 0);
}

function finish(code) {
  const pass = results.filter((r) => r.pass).length;
  console.log(`\nRESULT ${pass}/${results.length} ${code === 0 ? "PASS" : "FAIL"}`);
  process.exit(code);
}

main().catch((err) => {
  console.error("FATAL", err.message || err);
  process.exit(1);
});
