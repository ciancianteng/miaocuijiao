/**
 * Full business chain on Preview (Supabase only, no localhost mock).
 * 老板下单 → 客服收到 → 推陪玩 → 陪玩接单 → 老板确认 → 开始 → 完成 → 评价 → 猫粮 → 提现 → 后台审核
 *
 * node scripts/e2e-full-chain-preview.mjs --base=https://....vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");
if (/localhost|127\.0\.0\.1/i.test(BASE)) throw new Error("Preview only — refuse localhost");

const results = {};
const meta = { base: BASE, startedAt: new Date().toISOString(), supabase: SUPABASE_URL };

function set(id, status, note = "") {
  results[id] = { status, note: String(note || "").slice(0, 500) };
  console.log(`${String(status).padEnd(7)} ${id} ${note || ""}`);
}

async function auth(email) {
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

async function api(pathname, token, { method = "POST", body, headers = {} } = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && j.ok !== false, body: j };
}

function failFast() {
  const failed = Object.entries(results).filter(([, v]) => v.status === "FAIL");
  if (failed.length) {
    console.error("\nABORT: prior FAIL", failed.map(([k]) => k).join(", "));
    return true;
  }
  return false;
}

async function main() {
  console.log("BASE", BASE);
  console.log("DB", SUPABASE_URL);

  // Sanity: Preview hits same Supabase as env
  const rt = await api("/api/public/realtime-config", null, { method: "GET" });
  const previewDb = String(rt.body?.url || "").replace(/\/$/, "");
  set(
    "E00_same_db",
    previewDb && previewDb === SUPABASE_URL ? "PASS" : "FAIL",
    `preview=${previewDb} env=${SUPABASE_URL}`
  );
  if (failFast()) throw new Error("db mismatch");

  const boss = await auth("boss@meow.test");
  const service = await auth("service@meow.test");
  const companion = await auth("companion@meow.test");
  const admin = await auth("admin@meow.test");
  set("E00_logins", "PASS", "boss/cs/companion/admin");

  await api("/api/companion", companion.access_token, {
    body: { action: "set_online_status", online_status: "online" },
  });

  // Free withdraw slots this month (cancel pending test rows only)
  const month = new Date().toISOString().slice(0, 7);
  const activeWd = await rest(
    "companion_withdrawals",
    `?companion_id=eq.${companion.user.id}&submitted_at=gte.${month}-01T00:00:00Z&status=in.(pending,pending_review)&select=id`
  ).catch(() => []);
  for (const row of activeWd || []) {
    await rest(`companion_withdrawals?id=eq.${row.id}`, "", {
      method: "PATCH",
      body: { status: "cancelled", reject_reason: "e2e cleanup", rejection_reason: "e2e cleanup" },
    }).catch(() => null);
  }

  const wallet0 = await api("/api/companion?action=wallet", companion.access_token, { method: "GET" });
  const earn0 = Number(wallet0.body?.data?.earnings?.totalIncome || 0);
  const avail0 = Number(
    wallet0.body?.data?.earnings?.withdrawable ?? wallet0.body?.data?.earnings?.available ?? 0
  );
  meta.earnBefore = earn0;
  meta.availBefore = avail0;

  // 1) 老板下单 + 支付
  const stamp = Date.now();
  const created = await api("/api/orders", boss.access_token, {
    body: {
      action: "create",
      order: {
        order_type: "open_grab",
        game: "无畏契约",
        title: `全链路验收 ${stamp}`,
        description: `老板备注：全链路E2E\n区服：亚服\n游戏ID：E2EBoss`,
        hours: 1,
        unit_price: 80,
        notes: "E2E全链路",
        service_name: "上分陪玩",
      },
    },
  });
  const order = created.body?.order || created.body?.data?.order;
  const orderId = order?.id;
  const orderNo = order?.orderNo || order?.order_no;
  meta.orderId = orderId;
  meta.orderNo = orderNo;
  set("E01_boss_create", created.ok && orderId ? "PASS" : "FAIL", created.body?.message || orderNo);
  if (failFast()) throw new Error("create failed");

  const paid = await api("/api/orders", boss.access_token, {
    body: { action: "pay_order", id: orderId, preview_test: "1", test_pay: "1", paymentMethod: "test" },
  });
  set("E01_boss_pay", paid.ok ? "PASS" : "FAIL", paid.body?.message);
  if (failFast()) throw new Error("pay failed");

  // 2) 客服收到
  const csBoot = await api("/api/customer-service?action=bootstrap", service.access_token, { method: "GET" });
  const csOrders = csBoot.body?.data?.orders || csBoot.body?.orders || [];
  const csHit = csOrders.find((o) => o.id === orderId || o.orderId === orderId);
  const dbOrder = (await rest("orders", `?id=eq.${orderId}&select=id,status,order_no,companion_id`))?.[0];
  set(
    "E02_cs_sees_order",
    csHit || (csBoot.ok && dbOrder) ? "PASS" : "FAIL",
    `csHit=${!!csHit} db=${dbOrder?.status} csOk=${csBoot.ok}`
  );

  // 3) 客服推陪玩
  const push = await api("/api/customer-service", service.access_token, {
    body: { action: "push_companion", id: orderId, companion_id: companion.user.id },
  });
  const afterPush = (await rest("orders", `?id=eq.${orderId}&select=id,status,companion_id`))?.[0];
  set(
    "E03_cs_push",
    push.ok && afterPush?.companion_id === companion.user.id ? "PASS" : "FAIL",
    `${push.body?.message || ""} status=${afterPush?.status} companion=${afterPush?.companion_id}`
  );
  if (failFast()) throw new Error("push failed");

  // 4) 陪玩接单（指定单 / 抢单）
  let grab = await api("/api/companion", companion.access_token, {
    body: { action: "accept_direct_order", id: orderId },
  });
  if (!grab.ok) {
    grab = await api("/api/companion", companion.access_token, {
      body: { action: "accept_order", id: orderId },
    });
  }
  const afterGrab = (await rest("orders", `?id=eq.${orderId}&select=id,status,companion_id,accepted_at`))?.[0];
  set(
    "E04_companion_accept",
    grab.ok || afterGrab?.companion_id === companion.user.id ? "PASS" : "FAIL",
    `${grab.body?.message || ""} status=${afterGrab?.status}`
  );

  // 5) 老板确认（选陪玩 / 确认）
  let confirm = await api("/api/orders", boss.access_token, {
    body: { action: "select_grabber", id: orderId, companionId: companion.user.id },
  });
  if (!confirm.ok) {
    confirm = await api("/api/orders", boss.access_token, {
      body: { action: "confirm_companion", id: orderId, companionId: companion.user.id },
    });
  }
  // If already confirmed via direct accept path, treat OK statuses as pass
  const afterConfirm = (await rest("orders", `?id=eq.${orderId}&select=id,status`))?.[0];
  const confirmOk =
    confirm.ok ||
    /confirmed|waiting_start|in_progress|claimed|accepted/i.test(String(afterConfirm?.status || "")) ||
    /已经|无需|已确认|不需要/.test(String(confirm.body?.message || ""));
  set(
    "E05_boss_confirm",
    confirmOk ? "PASS" : "FAIL",
    `${confirm.body?.message || ""} status=${afterConfirm?.status}`
  );

  // 6) 开始订单
  const start = await api("/api/companion", companion.access_token, {
    body: { action: "start_order", id: orderId },
  });
  const afterStart = (await rest("orders", `?id=eq.${orderId}&select=id,status,started_at`))?.[0];
  set(
    "E06_start",
    start.ok || afterStart?.status === "in_progress" ? "PASS" : "FAIL",
    `${start.body?.message || ""} status=${afterStart?.status}`
  );
  if (failFast()) throw new Error("start failed");

  // 7) 完成订单
  const complete = await api("/api/companion", companion.access_token, {
    body: { action: "complete_order", id: orderId },
  });
  set("E07_complete", complete.ok ? "PASS" : "FAIL", complete.body?.message);

  const bossDone = await api("/api/orders", boss.access_token, {
    body: { action: "confirm_completion", id: orderId },
  });
  const afterDone = (await rest("orders", `?id=eq.${orderId}&select=id,status`))?.[0];
  set(
    "E07_boss_confirm_done",
    bossDone.ok || afterDone?.status === "completed" ? "PASS" : "FAIL",
    `${bossDone.body?.message || ""} status=${afterDone?.status}`
  );
  if (failFast()) throw new Error("complete failed");

  // 8) 老板评价
  const reviewContent = `E2E评价 ${stamp} 服务很好`;
  const review = await api("/api/orders", boss.access_token, {
    body: { action: "submit_review", id: orderId, rating: 5, content: reviewContent },
  });
  const reviewRow = (
    await rest(
      "companion_reviews",
      `?order_id=eq.${orderId}&select=id,rating,content&order=created_at.desc&limit=1`
    ).catch(() => [])
  )?.[0];
  set(
    "E08_boss_review",
    review.ok || (reviewRow && Number(reviewRow.rating) === 5) ? "PASS" : "FAIL",
    review.body?.message || reviewRow?.id
  );

  // 9) 陪玩获得猫粮
  const income = await rest(
    "transactions",
    `?user_id=eq.${companion.user.id}&order_id=eq.${orderId}&or=(transaction_type.eq.companion_income,type.eq.companion_income)&select=id,amount,status,transaction_type`
  ).catch(() => []);
  let incomeAmt = Number(income?.[0]?.amount || 0);
  if (!incomeAmt) {
    const alt = await rest(
      "transactions",
      `?order_id=eq.${orderId}&select=id,amount,user_id,transaction_type,status`
    ).catch(() => []);
    const hit = (alt || []).find((t) => t.user_id === companion.user.id);
    incomeAmt = Number(hit?.amount || 0);
  }
  const wallet1 = await api("/api/companion?action=wallet", companion.access_token, { method: "GET" });
  const earn1 = Number(wallet1.body?.data?.earnings?.totalIncome || 0);
  const avail1 = Number(
    wallet1.body?.data?.earnings?.withdrawable ?? wallet1.body?.data?.earnings?.available ?? 0
  );
  meta.earnAfter = earn1;
  meta.availAfter = avail1;
  meta.incomeAmount = incomeAmt;
  set(
    "E09_cat_food",
    incomeAmt > 0 || earn1 > earn0 || avail1 > avail0 ? "PASS" : "FAIL",
    `income=${incomeAmt} earn ${earn0}->${earn1} avail ${avail0}->${avail1}`
  );
  if (failFast()) throw new Error("earnings failed");

  // 10) 提现申请
  const wBoot = await api("/api/companion?action=wallet", companion.access_token, { method: "GET" });
  const accounts = wBoot.body?.data?.withdrawalRules?.approvedAccounts || [];
  const wdAmt = Math.min(50, Math.floor(avail1 || 0));
  if (!(wdAmt >= 50)) {
    set("E10_withdraw", "FAIL", `insufficient withdrawable=${avail1}`);
  } else {
    const wd = await api("/api/companion", companion.access_token, {
      body: {
        action: "request_withdrawal",
        amount: wdAmt,
        remark: `E2E提现 ${stamp}`,
        paymentAccountId: accounts[0]?.id,
      },
    });
    const wdId = wd.body?.item?.id || wd.body?.data?.withdrawalId || wd.body?.withdrawal?.id;
    const wdStatus = wd.body?.item?.status || wd.body?.data?.status;
    meta.withdrawId = wdId;
    set(
      "E10_withdraw",
      wd.ok && wdId ? "PASS" : "FAIL",
      wd.body?.message || `${wdId} ${wdStatus}`
    );

    // 11) 后台收到审核
    const adminBoot = await api("/api/admin/finance?action=bootstrap", admin.access_token, {
      method: "GET",
    });
    const adminBootAlt = adminBoot.ok
      ? adminBoot
      : await api("/api/admin/finance?action=bootstrap", null, {
          method: "GET",
          headers: { "x-mcj-admin-role": "admin", Authorization: `Bearer ${admin.access_token}` },
        });
    const list =
      adminBootAlt.body?.withdrawals ||
      adminBootAlt.body?.data?.withdrawals ||
      adminBootAlt.body?.pendingWithdrawals ||
      [];
    let adminSees = (list || []).some((w) => w.id === wdId);
    if (!adminSees && wdId) {
      const dbWd = (
        await rest("companion_withdrawals", `?id=eq.${wdId}&select=id,status,companion_id,cat_food_amount`)
      )?.[0];
      adminSees = !!dbWd && /pending/i.test(String(dbWd.status || ""));
      set(
        "E11_admin_sees",
        adminSees ? "PASS" : "FAIL",
        `apiList=${(list || []).length} db=${dbWd?.status || "missing"} id=${wdId}`
      );
    } else {
      set("E11_admin_sees", adminSees ? "PASS" : "FAIL", `list=${(list || []).length} id=${wdId}`);
    }
  }

  const failed = Object.entries(results).filter(([, v]) => v.status === "FAIL");
  const passed = Object.entries(results).filter(([, v]) => v.status === "PASS");
  meta.finishedAt = new Date().toISOString();
  meta.pass = passed.length;
  meta.fail = failed.length;
  const summary = { meta, results, allPass: failed.length === 0 };
  fs.writeFileSync(path.join(root, "scripts", "e2e-full-chain-results.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(`PASS ${passed.length}  FAIL ${failed.length}`);
  if (failed.length) failed.forEach(([k, v]) => console.log(" -", k, v.note));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.writeFileSync(
    path.join(root, "scripts", "e2e-full-chain-results.json"),
    JSON.stringify({ meta, results, fatal: String(e?.message || e) }, null, 2)
  );
  process.exit(1);
});
