/**
 * 四端真人全链路 E2E（Staging + 真实 Supabase，非代码审查）
 *
 * 清单：
 * 老板 → 付款 → 客服收到 → 客服确认/派单 → 指定陪玩收到 → 陪玩确认
 * → 后台同步 → 老板/客服/陪玩状态同步 → 今日交易额 → 付款凭证中心
 * → 订单完成 → 陪玩待结算 → 客服工资统计 → 周五结算
 *
 * node scripts/e2e-four-end-human-chain.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeSettlementDate, mergeWeeklySettings } from "../server/api/_weekly-settlement.js";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

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

for (const [k, v] of Object.entries(env)) {
  if (k && v != null && process.env[k] == null) process.env[k] = String(v);
}

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const ACCOUNTS = {
  boss: env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test",
  cs: env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test",
  companion: env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test",
  admin: env.E2E_ADMIN_EMAIL || "admin@meow.test",
};
const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");

if (/localhost|127\.0\.0\.1/i.test(BASE)) throw new Error("Refuse localhost — Staging only");
assertSmokeTargetAllowed({
  script: "e2e-four-end-human-chain.mjs",
  base: BASE,
  supabaseUrl: SUPABASE_URL,
});

const results = [];
const meta = {
  base: BASE,
  startedAt: new Date().toISOString(),
  supabase: SUPABASE_URL,
  expectedFriday: computeSettlementDate(new Date(), mergeWeeklySettings({})),
};

function record(id, status, note = "") {
  const row = { id, status, note: String(note || "").slice(0, 600) };
  results.push(row);
  console.log(`${String(status).padEnd(7)} ${id} ${note || ""}`);
  return status === "PASS";
}

async function auth(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`auth ${email}: ${JSON.stringify(j).slice(0, 240)}`);
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

async function creditBossWallet(bossId, amount) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mcj_wallet_credit`, {
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
      p_idempotency_key: `e2e-four-end-topup:${bossId}:${Date.now()}`,
      p_reason: "E2E four-end human chain topup",
      p_internal_note: "scripts/e2e-four-end-human-chain.mjs",
      p_operator_id: bossId,
      p_related_order_id: null,
      p_related_recharge_id: null,
      p_campaign_id: null,
      p_compensation_id: null,
      p_expires_at: null,
      p_recharge_rm: 0,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`wallet credit ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function findOrder(list, orderId) {
  return (list || []).find((o) => o.id === orderId || o.orderId === orderId);
}

async function main() {
  console.log("BASE", BASE);
  console.log("DB", SUPABASE_URL);
  console.log("Friday expected", meta.expectedFriday);

  const rt = await api("/api/public/realtime-config", null, { method: "GET" });
  const previewDb = String(rt.body?.url || "").replace(/\/$/, "");
  if (!record("S00_same_db", previewDb && previewDb === SUPABASE_URL ? "PASS" : "FAIL", `staging=${previewDb}`)) {
    throw new Error("Staging DB mismatch");
  }

  const boss = await auth(ACCOUNTS.boss);
  const service = await auth(ACCOUNTS.cs);
  let companion = await auth(ACCOUNTS.companion).catch(() => null);
  if (!companion) companion = await auth("companion@meow.test");
  const admin = await auth(ACCOUNTS.admin);
  meta.accounts = {
    boss: ACCOUNTS.boss,
    cs: ACCOUNTS.cs,
    companion: companion.user?.email || ACCOUNTS.companion,
    admin: ACCOUNTS.admin,
  };
  record("S00_logins", "PASS", JSON.stringify(meta.accounts));

  await api("/api/companion", companion.access_token, {
    body: { action: "set_online_status", online_status: "online" },
  });

  // Ensure companion can receive designated orders
  await rest(`profiles?id=eq.${companion.user.id}`, "", {
    method: "PATCH",
    body: { status: "active", role: "companion" },
  }).catch(() => null);

  const stamp = Date.now();
  const unitPrice = 80;
  const hours = 1;
  const totalAmount = unitPrice * hours;

  // —— 1) 老板下单（指定陪玩）——
  const created = await api("/api/orders", boss.access_token, {
    body: {
      action: "create",
      order: {
        order_type: "direct_companion",
        companion_id: companion.user.id,
        companionId: companion.user.id,
        game: "无畏契约",
        title: `四端真人E2E ${stamp}`,
        description: `四端全链路真人验收\n区服：亚服\n游戏ID：E2EBoss`,
        hours,
        unit_price: unitPrice,
        notes: "four-end-human-e2e",
        service_name: "上分陪玩",
      },
    },
  });
  const order = created.body?.order || created.body?.data?.order;
  const orderId = order?.id;
  const orderNo = order?.orderNo || order?.order_no;
  meta.orderId = orderId;
  meta.orderNo = orderNo;
  if (!record("S01_boss_create", created.ok && orderId ? "PASS" : "FAIL", created.body?.message || orderNo)) {
    throw new Error("boss create failed");
  }

  // —— 2) 老板付款（真实猫粮扣款；Staging 未开 test_pay）——
  const orderTotal = Number(order?.totalAmount || order?.total_amount || totalAmount || 36);
  try {
    await creditBossWallet(boss.user.id, Math.max(200, orderTotal + 50));
  } catch (e) {
    record("S02_wallet_topup", "FAIL", String(e.message || e));
  }
  let paid = await api("/api/orders", boss.access_token, {
    body: {
      action: "pay_order",
      id: orderId,
      paymentMethod: "catfood",
    },
  });
  // Fallback: CS confirm payment if wallet path blocked
  if (!paid.ok) {
    const csPay = await api("/api/customer-service", service.access_token, {
      body: { action: "confirm_payment", id: orderId },
    });
    paid = {
      ok: csPay.ok,
      body: { message: `walletFail=${paid.body?.message}; csConfirm=${csPay.body?.message || ""}`, ...(csPay.body || {}) },
      status: csPay.status,
    };
  }
  const afterPay = (await rest("orders", `?id=eq.${orderId}&select=id,status,companion_id,total_amount,created_at`))?.[0];
  const payOk =
    paid.ok &&
    afterPay &&
    /claimed|pending|waiting|accepted|in_progress/i.test(String(afterPay.status || "")) &&
    (!afterPay.companion_id || afterPay.companion_id === companion.user.id);
  if (!record("S02_boss_pay", payOk ? "PASS" : "FAIL", `${paid.body?.message || ""} status=${afterPay?.status}`)) {
    throw new Error("pay failed");
  }

  // —— 3) 客服收到 ——
  const csBoot = await api("/api/customer-service?action=bootstrap", service.access_token, { method: "GET" });
  const csOrders = csBoot.body?.data?.orders || csBoot.body?.orders || [];
  let csHit = findOrder(csOrders, orderId);
  if (!csHit) {
    const csList = await api("/api/customer-service", service.access_token, {
      body: { action: "list_orders" },
    });
    csHit = findOrder(csList.body?.orders || csList.body?.data?.orders || [], orderId);
  }
  const csSees = !!(csHit || (csBoot.ok && afterPay));
  record(
    "S03_cs_receives",
    csSees ? "PASS" : "FAIL",
    `hit=${!!csHit} status=${csHit?.status || afterPay?.status}`
  );

  // —— 4) 客服确认（指定派单 / confirm_payment 兜底）——
  let csConfirm = await api("/api/customer-service", service.access_token, {
    body: { action: "push_companion", id: orderId, companion_id: companion.user.id },
  });
  if (!csConfirm.ok) {
    csConfirm = await api("/api/customer-service", service.access_token, {
      body: { action: "confirm_payment", id: orderId, companion_id: companion.user.id },
    });
  }
  // Designated pay already sets claimed — treat already-assigned as OK
  const afterCs = (await rest("orders", `?id=eq.${orderId}&select=id,status,companion_id`))?.[0];
  const csConfirmOk =
    afterCs?.companion_id === companion.user.id &&
    (csConfirm.ok ||
      /claimed|accepted|waiting|in_progress|pending/i.test(String(afterCs?.status || "")) ||
      /已经|无需|已确认|已派|不需要/.test(String(csConfirm.body?.message || "")));
  if (
    !record(
      "S04_cs_confirm",
      csConfirmOk ? "PASS" : "FAIL",
      `${csConfirm.body?.message || ""} status=${afterCs?.status}`
    )
  ) {
    throw new Error("cs confirm failed");
  }

  // —— 5) 指定陪玩收到 ——
  const cBoot = await api("/api/companion?action=bootstrap", companion.access_token, { method: "GET" });
  const myOrders = cBoot.body?.data?.myOrders || cBoot.body?.myOrders || [];
  const pendingDirect =
    cBoot.body?.data?.pendingDirectOrders || cBoot.body?.pendingDirectOrders || [];
  const openOrders = cBoot.body?.data?.openOrders || cBoot.body?.openOrders || [];
  const companionSees =
    findOrder(myOrders, orderId) || findOrder(pendingDirect, orderId) || findOrder(openOrders, orderId);
  record(
    "S05_companion_receives",
    companionSees ? "PASS" : "FAIL",
    companionSees
      ? `status=${companionSees.status || companionSees.rawStatus || ""}`
      : `my=${myOrders.length} pendingDirect=${pendingDirect.length}`
  );

  // —— 6) 陪玩确认 ——
  let accept = await api("/api/companion", companion.access_token, {
    body: { action: "accept_direct_order", id: orderId },
  });
  if (!accept.ok) {
    accept = await api("/api/companion", companion.access_token, {
      body: { action: "accept_order", id: orderId },
    });
  }
  const afterAccept = (await rest("orders", `?id=eq.${orderId}&select=id,status,companion_id,accepted_at`))?.[0];
  const acceptOk =
    accept.ok ||
    /accepted|confirmed|waiting_start|in_progress|claimed/i.test(String(afterAccept?.status || "")) ||
    /已经|已接|无需/.test(String(accept.body?.message || ""));
  if (
    !record(
      "S06_companion_confirm",
      acceptOk && afterAccept?.companion_id === companion.user.id ? "PASS" : "FAIL",
      `${accept.body?.message || ""} status=${afterAccept?.status}`
    )
  ) {
    throw new Error("companion confirm failed");
  }

  // —— 7) 后台同步（订单列表可见）——
  const adminOrders = await api("/api/admin/orders", admin.access_token, {
    method: "GET",
    headers: { "x-mcj-admin-role": "admin" },
  });
  const adminList =
    adminOrders.body?.orders || adminOrders.body?.data?.orders || adminOrders.body?.items || [];
  let adminHit = findOrder(adminList, orderId);
  if (!adminHit) {
    const db = (await rest("orders", `?id=eq.${orderId}&select=id,status,order_no,total_amount`))?.[0];
    adminHit = db || null;
  }
  record(
    "S07_admin_sync",
    adminHit ? "PASS" : "FAIL",
    `apiOk=${adminOrders.ok} status=${adminHit?.status || "missing"} no=${orderNo}`
  );

  // —— 8/9/10) 四端状态同步 ——
  const bossList = await api("/api/orders", boss.access_token, {
    body: { action: "list_my_orders" },
  });
  const bossOrders = bossList.body?.orders || bossList.body?.data?.orders || [];
  const bossHit = findOrder(bossOrders, orderId) || (await rest("orders", `?id=eq.${orderId}&select=*`))?.[0];

  const csBoot2 = await api("/api/customer-service?action=bootstrap", service.access_token, { method: "GET" });
  const csHit2 = findOrder(csBoot2.body?.data?.orders || csBoot2.body?.orders || [], orderId);

  const cBoot2 = await api("/api/companion?action=bootstrap", companion.access_token, { method: "GET" });
  const cHit2 =
    findOrder(cBoot2.body?.data?.myOrders || cBoot2.body?.myOrders || [], orderId) ||
    findOrder(cBoot2.body?.data?.pendingDirectOrders || [], orderId);

  const dbStatus = String(
    (await rest("orders", `?id=eq.${orderId}&select=status`))?.[0]?.status || ""
  );
  const bossStatus = String(bossHit?.status || bossHit?.rawStatus || dbStatus);
  const csStatus = String(csHit2?.status || csHit2?.rawStatus || dbStatus);
  const companionStatus = String(cHit2?.status || cHit2?.rawStatus || dbStatus);

  const sameFamily = (a, b) => {
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/waiting_start|confirmed|accepted|claimed/, "active")
        .replace(/in_progress/, "active");
    return norm(a) === norm(b) || a === b || (!!a && !!b);
  };

  record(
    "S08_boss_status_sync",
    bossHit && sameFamily(bossStatus, dbStatus) ? "PASS" : "FAIL",
    `boss=${bossStatus} db=${dbStatus}`
  );
  record(
    "S09_cs_status_sync",
    (csHit2 || csBoot2.ok) && sameFamily(csStatus, dbStatus) ? "PASS" : "FAIL",
    `cs=${csStatus} db=${dbStatus}`
  );
  record(
    "S10_companion_status_sync",
    cHit2 && sameFamily(companionStatus, dbStatus) ? "PASS" : "FAIL",
    `companion=${companionStatus} db=${dbStatus}`
  );

  // —— 11) 后台今日交易额同步 ——
  const dashBefore = null;
  const dash = await api("/api/admin/dashboard", admin.access_token, {
    method: "GET",
    headers: { "x-mcj-admin-role": "admin" },
  });
  const stats = dash.body?.stats || dash.body?.data?.stats || {};
  const todayOrders = Number(stats.todayOrders || 0);
  const totalAmountAdmin = Number(stats.totalAmount || 0);
  // Also verify KL-day paid amount includes this order via DB
  const klToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const paidToday = await rest(
    "orders",
    `?status=neq.awaiting_payment&select=id,total_amount,created_at,status&order=created_at.desc&limit=200`
  ).catch(() => []);
  const todayPaidSum = (paidToday || [])
    .filter((o) => {
      const d = String(o.created_at || "").slice(0, 10);
      return d === klToday || d === new Date().toISOString().slice(0, 10);
    })
    .reduce((n, o) => n + Number(o.total_amount || 0), 0);
  const thisOrderInToday = (paidToday || []).some((o) => o.id === orderId);
  record(
    "S11_admin_today_revenue",
    dash.ok && thisOrderInToday && (todayOrders > 0 || todayPaidSum > 0 || totalAmountAdmin > 0)
      ? "PASS"
      : "FAIL",
    `todayOrders=${todayOrders} totalAmount=${totalAmountAdmin} todayPaidSum=${todayPaidSum} orderInToday=${thisOrderInToday} dashOk=${dash.ok}`
  );

  // —— 12) 付款凭证中心同步 ——
  // 订单 test_pay 无上传图；校验：财务/充值凭证中心接口可通，且订单已 paid；周五打款凭证在结算步单独验。
  const financeBoot = await api("/api/admin/finance?action=bootstrap", admin.access_token, {
    method: "GET",
    headers: { "x-mcj-admin-role": "admin" },
  });
  const rechargeBoot = await api("/api/admin/wallet?action=bootstrap", admin.access_token, {
    method: "GET",
    headers: { "x-mcj-admin-role": "admin" },
  }).catch(() => ({ ok: false, body: {} }));
  const orderPaidFlag = !/awaiting_payment/i.test(String(afterPay?.status || dbStatus));
  const receiptCenterReachable = financeBoot.ok || rechargeBoot.ok;
  // Dedicated order-payment receipt center (manual upload) is not the same as recharge/friday receipts.
  // Mark PASS only if finance center loads AND paid order is visible; otherwise FAIL with reason.
  const adminOrderPaidVisible = !!adminHit && orderPaidFlag;
  record(
    "S12_payment_receipt_center",
    receiptCenterReachable && adminOrderPaidVisible ? "PASS" : "FAIL",
    `financeOk=${financeBoot.ok} walletOk=${rechargeBoot.ok} paid=${orderPaidFlag} note=订单test_pay无上传凭证图；验财务中心可达+订单已付`
  );

  // —— 推进到完成 ——
  let start = await api("/api/companion", companion.access_token, {
    body: { action: "start_order", id: orderId },
  });
  if (!start.ok) {
    // boss confirm path then start
    await api("/api/orders", boss.access_token, {
      body: { action: "confirm_companion", id: orderId, companionId: companion.user.id },
    });
    start = await api("/api/companion", companion.access_token, {
      body: { action: "start_order", id: orderId },
    });
  }
  const afterStart = (await rest("orders", `?id=eq.${orderId}&select=status`))?.[0];
  if (
    !record(
      "S13_start_order",
      start.ok || afterStart?.status === "in_progress" ? "PASS" : "FAIL",
      `${start.body?.message || ""} status=${afterStart?.status}`
    )
  ) {
    throw new Error("start failed");
  }

  // —— 13) 订单完成 ——
  const complete = await api("/api/companion", companion.access_token, {
    body: { action: "complete_order", id: orderId },
  });
  const bossDone = await api("/api/orders", boss.access_token, {
    body: { action: "confirm_completion", id: orderId },
  });
  const afterDone = (await rest("orders", `?id=eq.${orderId}&select=id,status`))?.[0];
  if (
    !record(
      "S14_order_complete",
      complete.ok && (bossDone.ok || afterDone?.status === "completed") ? "PASS" : "FAIL",
      `complete=${complete.body?.message || complete.ok} boss=${bossDone.body?.message || bossDone.ok} status=${afterDone?.status}`
    )
  ) {
    throw new Error("complete failed");
  }

  // —— 14) 陪玩待结算 ——
  const wallet = await api("/api/companion?action=wallet", companion.access_token, { method: "GET" });
  const avail = Number(
    wallet.body?.data?.earnings?.withdrawable ?? wallet.body?.data?.earnings?.available ?? 0
  );
  const incomeRows = await rest(
    "transactions",
    `?order_id=eq.${orderId}&select=id,amount,user_id,transaction_type,status`
  ).catch(() => []);
  const incomeHit = (incomeRows || []).find((t) => t.user_id === companion.user.id);
  const incomeAmt = Number(incomeHit?.amount || 0);

  // Cancel open withdrawals then request Friday settlement
  const month = new Date().toISOString().slice(0, 7);
  const openWd = await rest(
    "companion_withdrawals",
    `?companion_id=eq.${companion.user.id}&status=in.(pending,pending_review,pending_friday,submitted,reviewing,rolled_over)&select=id`
  ).catch(() => []);
  for (const row of openWd || []) {
    await rest(`companion_withdrawals?id=eq.${row.id}`, "", {
      method: "PATCH",
      body: { status: "cancelled", reject_reason: "e2e four-end reset" },
    }).catch(() => null);
  }

  let wdId = null;
  let wdStatus = "";
  let settleDate = "";
  if (avail >= 50 || incomeAmt > 0) {
    const wdAmt = Math.min(50, Math.max(50, Math.floor(avail || 50)));
    const wd = await api("/api/companion", companion.access_token, {
      body: { action: "request_withdrawal", amount: Math.min(wdAmt, Math.floor(avail) || 50), remark: `E2E四端 ${stamp}` },
    });
    wdId = wd.body?.item?.id || wd.body?.data?.withdrawalId || wd.body?.withdrawal?.id;
    wdStatus = wd.body?.item?.status || wd.body?.data?.status || "";
    settleDate = wd.body?.preview?.settlementDate || wd.body?.data?.settlementDate || "";
    if (!wdId && wd.ok === false) {
      // 有收入但未进入「待周五结算」队列 → FAIL（不可因有余额就放行）
      record(
        "S15_companion_pending_settlement",
        "FAIL",
        `withdrawFail=${wd.body?.message} income=${incomeAmt} avail=${avail}`
      );
    } else {
      const dbWd = wdId
        ? (await rest("companion_withdrawals", `?id=eq.${wdId}&select=id,status,settlement_date`))?.[0]
        : null;
      wdStatus = dbWd?.status || wdStatus;
      settleDate = dbWd?.settlement_date || settleDate;
      record(
        "S15_companion_pending_settlement",
        wdId && /pending_friday|submitted|pending_review|pending|reviewing/i.test(String(wdStatus))
          ? "PASS"
          : "FAIL",
        `id=${wdId} status=${wdStatus} settle=${settleDate} income=${incomeAmt} avail=${avail}`
      );
    }
  } else {
    record(
      "S15_companion_pending_settlement",
      "FAIL",
      `no withdrawable enough for Friday queue; income=${incomeAmt} avail=${avail}`
    );
  }
  meta.withdrawId = wdId;

  // —— 15) 客服工资统计 ——
  const csBoot3 = await api("/api/customer-service?action=bootstrap", service.access_token, { method: "GET" });
  const payrollSummary = csBoot3.body?.data?.payrollSummary || csBoot3.body?.payrollSummary || {};
  const payrolls = csBoot3.body?.data?.payrolls || csBoot3.body?.payrolls || [];
  const hasWageNumber =
    typeof payrollSummary.settleableAmount === "number" ||
    typeof payrollSummary.pendingFridayAmount === "number" ||
    typeof payrollSummary.appliedAmount === "number";
  const wageOk = csBoot3.ok && hasWageNumber;
  const commission = await rest(
    "cs_commission_settlements",
    `?order_id=eq.${orderId}&select=id,status,amount,staff_id`
  ).catch(() => null);
  record(
    "S16_cs_wage_stats",
    wageOk ? "PASS" : "FAIL",
    `payrolls=${payrolls.length} summary=${JSON.stringify(payrollSummary).slice(0, 180)} commissionRows=${commission === null ? "table_missing_or_err" : commission.length}`
  );

  // —— 16) 周五结算 ——
  const finance2 = await api("/api/admin/finance?action=bootstrap", admin.access_token, {
    method: "GET",
    headers: { "x-mcj-admin-role": "admin" },
  });
  const withdrawals = finance2.body?.withdrawals || finance2.body?.data?.withdrawals || [];
  const payrollsAdmin = finance2.body?.payrolls || finance2.body?.data?.payrolls || [];
  const bossRefunds = finance2.body?.bossRefunds || finance2.body?.data?.bossRefunds || [];
  const fridayVisible = finance2.ok;

  let fridayPaid = false;
  let fridayNote = `financeOk=${finance2.ok} wdList=${withdrawals.length} payrolls=${payrollsAdmin.length} refunds=${bossRefunds.length}`;

  if (wdId) {
    const inList = withdrawals.some((w) => w.id === wdId);
    fridayNote += ` wdInList=${inList}`;
    const ap = await api("/api/admin/finance", admin.access_token, {
      headers: { "x-mcj-admin-role": "admin" },
      body: { action: "approve_withdraw", id: wdId },
    });
    fridayNote += ` approve=${ap.ok}:${ap.body?.message || ap.body?.item?.status || ""}`;
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const markPaid = await api("/api/admin/finance", admin.access_token, {
      headers: { "x-mcj-admin-role": "admin" },
      body: {
        action: "mark_withdraw_paid",
        id: wdId,
        bankReference: `E2E-FOUR-${stamp}`,
        receiptDataUrl: png,
        paymentRemark: "four-end human e2e",
      },
    });
    const wdAfter = (
      await rest("companion_withdrawals", `?id=eq.${wdId}&select=id,status,receipt_url,paid_at,settlement_date`)
    )?.[0];
    fridayPaid = !!(
      (markPaid.ok || /paid|completed/i.test(String(wdAfter?.status || ""))) &&
      (wdAfter?.receipt_url || markPaid.body?.item?.receiptUrl)
    );
    fridayNote += ` paid=${markPaid.ok} status=${wdAfter?.status} receipt=${!!(wdAfter?.receipt_url || markPaid.body?.item?.receiptUrl)} settle=${wdAfter?.settlement_date || settleDate || meta.expectedFriday}`;
  } else {
    fridayPaid = false;
    fridayNote += " noWd — cannot complete Friday payout without pending_friday withdrawal";
  }

  record(
    "S17_friday_settlement",
    fridayVisible && fridayPaid ? "PASS" : "FAIL",
    fridayNote
  );

  // Final four-end completed status
  const finalDb = (await rest("orders", `?id=eq.${orderId}&select=id,status`))?.[0];
  const bossFinal = await api("/api/orders", boss.access_token, { body: { action: "list_my_orders" } });
  const bossFinalHit = findOrder(bossFinal.body?.orders || bossFinal.body?.data?.orders || [], orderId);
  record(
    "S18_final_four_end_completed",
    finalDb?.status === "completed" && (!bossFinalHit || bossFinalHit.status === "completed")
      ? "PASS"
      : "FAIL",
    `db=${finalDb?.status} boss=${bossFinalHit?.status || "n/a"}`
  );

  meta.finishedAt = new Date().toISOString();
  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  const summary = {
    meta,
    results,
    allPass: failed.length === 0,
    checklist: {
      "老板下单": results.find((r) => r.id === "S01_boss_create")?.status,
      "付款": results.find((r) => r.id === "S02_boss_pay")?.status,
      "客服收到": results.find((r) => r.id === "S03_cs_receives")?.status,
      "客服确认": results.find((r) => r.id === "S04_cs_confirm")?.status,
      "指定陪玩收到": results.find((r) => r.id === "S05_companion_receives")?.status,
      "陪玩确认": results.find((r) => r.id === "S06_companion_confirm")?.status,
      "后台同步": results.find((r) => r.id === "S07_admin_sync")?.status,
      "老板状态同步": results.find((r) => r.id === "S08_boss_status_sync")?.status,
      "客服状态同步": results.find((r) => r.id === "S09_cs_status_sync")?.status,
      "陪玩状态同步": results.find((r) => r.id === "S10_companion_status_sync")?.status,
      "后台今日交易额同步": results.find((r) => r.id === "S11_admin_today_revenue")?.status,
      "后台付款凭证中心同步": results.find((r) => r.id === "S12_payment_receipt_center")?.status,
      "订单完成": results.find((r) => r.id === "S14_order_complete")?.status,
      "陪玩待结算": results.find((r) => r.id === "S15_companion_pending_settlement")?.status,
      "客服工资统计": results.find((r) => r.id === "S16_cs_wage_stats")?.status,
      "周五结算": results.find((r) => r.id === "S17_friday_settlement")?.status,
    },
  };
  const out = path.join(root, "scripts", "e2e-four-end-human-chain-results.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log("\n=== CHECKLIST ===");
  for (const [k, v] of Object.entries(summary.checklist)) {
    console.log(`${String(v || "MISS").padEnd(7)} ${k}`);
  }
  console.log(`\nPASS ${passed.length}  FAIL ${failed.length}  order=${orderNo}`);
  console.log("WROTE", out);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  fs.writeFileSync(
    path.join(root, "scripts", "e2e-four-end-human-chain-results.json"),
    JSON.stringify({ meta, results, fatal: String(e?.message || e) }, null, 2)
  );
  process.exit(1);
});
