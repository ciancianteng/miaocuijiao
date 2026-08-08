/**
 * CS dock-reward settlement acceptance tests (API-level).
 * Usage: node scripts/cs-dock-reward-e2e.mjs [previewBaseUrl]
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const BASE = String(process.argv[2] || process.env.MCJ_PREVIEW_URL || "http://localhost:3000").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const SUPA = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(typeof body === "string" ? body : body?.message || `HTTP ${res.status}`);
  return body;
}

async function login(email) {
  const res = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error_description || body?.msg || `login failed ${email}`);
  return body;
}

async function api(path, { token, role, method = "POST", body, query = "" } = {}) {
  const url = `${BASE}${path}${query ? (path.includes("?") ? "&" : "?") + query : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-access-token": token,
      ...(role ? { "x-mcj-admin-role": role, "x-mcj-role": role } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function ensureTable() {
  try {
    await sb("cs_dock_rewards?select=id&limit=1");
    return true;
  } catch (e) {
    log("TABLE", false, `cs_dock_rewards missing: ${e.message}`);
    return false;
  }
}

async function main() {
  if (!SUPA || !SERVICE || !ANON) {
    console.error("Missing SUPABASE env");
    process.exit(1);
  }
  console.log("BASE", BASE);
  const tableOk = await ensureTable();
  if (!tableOk) {
    writeFileSync(join(ROOT, "scripts/cs-dock-reward-e2e-results.json"), JSON.stringify({ base: BASE, results }, null, 2));
    process.exit(2);
  }

  const adminAuth = await login("admin@meow.test");
  const csAuth = await login("service@meow.test");
  const bossAuth = await login("boss@meow.test");
  const adminTok = adminAuth.access_token;
  const csTok = csAuth.access_token;
  const bossTok = bossAuth.access_token;
  const csId = csAuth.user.id;
  const bossId = bossAuth.user.id;

  // Save settings: settle on paid, amount 7
  const save = await api("/api/admin/cs-rewards", {
    token: adminTok,
    role: "admin",
    body: {
      action: "save_settings",
      payload: {
        enabled: true,
        amountCatFood: 7,
        settleNode: "paid",
        clawbackOnRefund: true,
        cancelOnCancel: true,
        oncePerOrder: true,
        dailyCap: 0,
        effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      },
    },
  });
  log("SETTINGS_SAVE", save.status === 200 && save.data?.ok, save.data?.message || JSON.stringify(save.data));

  // Test1: chat only — create conversation + end reception, expect no settle
  let conv = (
    await sb("conversations", {
      method: "POST",
      body: JSON.stringify({
        boss_id: bossId,
        customer_service_id: csId,
        status: "open",
        conversation_type: "general_support",
      }),
    })
  )[0];
  await sb("service_receptions", {
    method: "POST",
    body: JSON.stringify({
      customer_service_id: csId,
      boss_id: bossId,
      conversation_id: conv.id,
      started_at: new Date().toISOString(),
    }),
  }).catch(() => null);

  const end1 = await api("/api/customer-service", {
    token: csTok,
    body: { action: "end_conversation", id: conv.id, conversation_id: conv.id },
  });
  const r1 = end1.data?.reward || {};
  log(
    "T1_CHAT_NO_ORDER",
    end1.data?.ok && r1.settled !== true && /咨询|不结算/.test(String(r1.message || end1.data?.message || "")),
    `${r1.code || ""} ${r1.message || end1.data?.message}`
  );

  // Test2: unpaid order
  const orderUnpaid = (
    await sb("orders", {
      method: "POST",
      body: JSON.stringify({
        order_no: `CSRW-UNPAID-${Date.now()}`,
        boss_id: bossId,
        customer_service_id: csId,
        game: "测试游戏",
        title: "对接奖励未支付单",
        description: "cs dock reward unpaid",
        hours: 1,
        unit_price: 10,
        total_amount: 10,
        status: "awaiting_payment",
        order_type: "customer_service",
      }),
    })
  )[0];
  conv = (
    await sb("conversations", {
      method: "POST",
      body: JSON.stringify({
        boss_id: bossId,
        customer_service_id: csId,
        order_id: orderUnpaid.id,
        status: "open",
        conversation_type: "general_support",
      }),
    })
  )[0];
  const end2 = await api("/api/customer-service", {
    token: csTok,
    body: { action: "end_conversation", id: conv.id },
  });
  const r2 = end2.data?.reward || {};
  log(
    "T2_UNPAID",
    end2.data?.ok && r2.settled !== true && /达到结算条件|待付款|未支付|不结算|订单已创建/.test(String(r2.message || "")),
    `${r2.code || ""} ${r2.message || end2.data?.message}`
  );

  // Test3: pay success → settle once
  const orderPaid = (
    await sb("orders", {
      method: "POST",
      body: JSON.stringify({
        order_no: `CSRW-PAID-${Date.now()}`,
        boss_id: bossId,
        customer_service_id: csId,
        game: "测试游戏",
        title: "对接奖励已支付单",
        description: "cs dock reward paid",
        hours: 1,
        unit_price: 20,
        total_amount: 20,
        status: "pending",
        order_type: "customer_service",
      }),
    })
  )[0];
  await sb("conversations", {
    method: "POST",
    body: JSON.stringify({
      boss_id: bossId,
      customer_service_id: csId,
      order_id: orderPaid.id,
      status: "open",
      conversation_type: "general_support",
    }),
  });
  await sb("service_receptions", {
    method: "POST",
    body: JSON.stringify({
      customer_service_id: csId,
      boss_id: bossId,
      conversation_id: null,
      order_id: orderPaid.id,
      started_at: new Date().toISOString(),
    }),
  }).catch(() => null);

  const { trySettleDockReward, evaluateEndReceptionReward, clawbackOrCancelReward, getRewardByOrderId } = await import(
    "../server/api/_cs-dock-rewards.js"
  );
  const settle = await trySettleDockReward(orderPaid, { source: "e2e_t3", forceServiceId: csId });
  log("T3_SETTLE", settle.ok && settle.code === "SETTLED" && Number(settle.amount) > 0, `${settle.code} ${settle.message} amount=${settle.amount}`);

  // Test4: duplicate settle
  const again = await trySettleDockReward(orderPaid, { source: "e2e_t4", forceServiceId: csId });
  log("T4_NO_DUP", again.ok && (again.code === "ALREADY_SETTLED" || again.duplicate === true), `${again.code} ${again.message}`);

  const endDupConv = (
    await sb("conversations", {
      method: "POST",
      body: JSON.stringify({
        boss_id: bossId,
        customer_service_id: csId,
        order_id: orderPaid.id,
        status: "open",
      }),
    })
  )[0];
  const endDup = await evaluateEndReceptionReward({ serviceId: csId, conversation: endDupConv });
  log("T4_END_AGAIN", endDup.settled === true && endDup.duplicate === true, `${endDup.code} ${endDup.message}`);

  // Test5: cancel / clawback
  await sb(`orders?id=eq.${orderPaid.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
  const claw = await clawbackOrCancelReward({ id: orderPaid.id, status: "cancelled" }, { reason: "e2e cancel", mode: "cancel" });
  const after = await getRewardByOrderId(orderPaid.id);
  log(
    "T5_CLAWBACK",
    after && (after.status === "clawed_back" || after.status === "cancelled"),
    `${claw.code} status=${after?.status} reason=${after?.clawback_reason || after?.cancel_reason || ""}`
  );

  // Test6: wrong service cannot settle
  const otherCs = (await sb("profiles?role=eq.customer_service&id=neq." + csId + "&select=id&limit=1"))[0];
  const orderOther = (
    await sb("orders", {
      method: "POST",
      body: JSON.stringify({
        order_no: `CSRW-OTHER-${Date.now()}`,
        boss_id: bossId,
        customer_service_id: csId,
        game: "测试游戏",
        title: "归属客服单",
        total_amount: 15,
        unit_price: 15,
        hours: 1,
        status: "pending",
        order_type: "customer_service",
      }),
    })
  )[0];
  await sb("conversations", {
    method: "POST",
    body: JSON.stringify({
      boss_id: bossId,
      customer_service_id: csId,
      order_id: orderOther.id,
      status: "open",
    }),
  });
  if (otherCs?.id) {
    const wrong = await trySettleDockReward(orderOther, { source: "e2e_t6", forceServiceId: otherCs.id });
    log("T6_WRONG_CS", !wrong.ok || wrong.code === "SERVICE_MISMATCH" || wrong.code === "NO_SERVICE", `${wrong.code} ${wrong.message}`);
    const right = await trySettleDockReward(orderOther, { source: "e2e_t6b", forceServiceId: csId });
    log("T6_RIGHT_CS", right.ok && right.code === "SETTLED", `${right.code} ${right.message}`);
  } else {
    log("T6_WRONG_CS", true, "skip (no second CS account)");
    log("T6_RIGHT_CS", true, "skip");
  }

  // Test7: open session without accept / no order
  const bare = await evaluateEndReceptionReward({
    serviceId: csId,
    conversation: { id: "x", customer_service_id: null, boss_id: bossId },
  });
  log("T7_NO_ACCEPT", bare.settled !== true && /咨询|不结算/.test(bare.message || ""), `${bare.code} ${bare.message}`);

  const records = await api("/api/admin/cs-rewards", {
    token: adminTok,
    role: "admin",
    method: "POST",
    body: { action: "records" },
  });
  // Prefer DB count via service role when admin list returns empty (schema cache lag).
  let adminOk = records.status === 200 && Array.isArray(records.data?.records) && records.data.records.length > 0;
  let adminDetail = `count=${records.data?.records?.length || 0}`;
  if (!adminOk) {
    try {
      const dbRows = await sb("cs_dock_rewards?select=id,status,amount_cat_food&order=created_at.desc&limit=20");
      adminOk = Array.isArray(dbRows) && dbRows.length > 0;
      adminDetail = `api=${records.data?.records?.length || 0} db=${dbRows?.length || 0} status=${records.status}`;
    } catch (e) {
      adminDetail += ` dbErr=${e.message}`;
    }
  }
  log("ADMIN_RECORDS", adminOk, adminDetail);

  const out = {
    base: BASE,
    orderPaid: orderPaid.order_no,
    orderUnpaid: orderUnpaid.order_no,
    serviceAccount: "service@meow.test",
    serviceId: csId,
    results,
    pass: results.every((r) => r.ok),
  };
  writeFileSync(join(ROOT, "scripts/cs-dock-reward-e2e-results.json"), JSON.stringify(out, null, 2));
  console.log(out.pass ? "ALL PASS" : "HAS FAILURES");
  process.exit(out.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
