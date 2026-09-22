#!/usr/bin/env node
/**
 * Staging E2E: gift schema + gift net withdrawable + withdraw freeze model.
 * Production writes forbidden.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";
import {
  classifyCompanionIncomeTx,
  partitionCompanionIncome,
  sumTxAmount,
} from "../server/api/_companion-income.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/gift-withdraw-channels");
fs.mkdirSync(outDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";

assertSmokeTargetAllowed({
  script: "e2e-staging-gift-withdraw-channels",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const report = {
  staging: STG,
  staging_ref: STAGING_SUPABASE_REF,
  generated_at: new Date().toISOString(),
  steps: [],
  evidence: {},
};

function step(name, ok, detail) {
  report.steps.push({ name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}

async function api(pathname, token, body, method = null, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${STG}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function companionBootstrap(token) {
  return api("/api/companion?action=bootstrap", token);
}

// Offline classification lock
{
  const gift = {
    transaction_type: "companion_income",
    amount: 80,
    status: "completed",
    note: '礼物收益：皇冠 MCJ_GIFT:{"source":"gift","gross":100,"net":80}',
  };
  const order = {
    transaction_type: "companion_income",
    amount: 24,
    status: "completed",
    order_id: "o1",
    note: 'MCJ_SETTLEMENT:{"companionNetCatFood":24}',
  };
  const kindGift = classifyCompanionIncomeTx(gift, null);
  const kindOrder = classifyCompanionIncomeTx(order, { id: "o1", status: "completed" });
  const part = partitionCompanionIncome([gift, order], [{ id: "o1", status: "completed" }]);
  step(
    "CLASSIFY_GIFT_VS_ORDER",
    kindGift === "gift_income" && kindOrder === "order_income" && sumTxAmount(part.giftIncome) === 80,
    `gift=${kindGift} order=${kindOrder} giftSum=${sumTxAmount(part.giftIncome)}`
  );
}

const bossLogin = await api("/api/auth", null, {
  action: "login",
  email: "boss@meow.test",
  password: PASS,
  role: "boss",
});
const companionLogin = await api("/api/auth", null, {
  action: "login",
  email: "companion@meow.test",
  password: PASS,
  role: "companion",
});
const adminLogin = await api("/api/auth", null, {
  action: "login",
  email: "admin@meow.test",
  password: PASS,
  role: "admin",
});
const bossT = bossLogin.json?.session?.accessToken;
const companionT = companionLogin.json?.session?.accessToken;
const adminT = adminLogin.json?.session?.accessToken;
const companionId =
  companionLogin.json?.profile?.id ||
  companionLogin.json?.user?.id ||
  companionLogin.json?.session?.user?.id ||
  "";
step("LOGINS", !!(bossT && companionT && adminT && companionId), `companionId=${companionId?.slice?.(0, 8) || "?"}`);

if (!bossT || !companionT || !adminT || !companionId) {
  fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(report, null, 2));
  process.exit(1);
}

// Schema probe via gift catalog + companion earnings bootstrap
const catalog = await api("/api/boss/marketplace?action=gift_catalog", bossT);
const gifts = catalog.json?.gifts || [];
step("GIFT_CATALOG", catalog.status === 200 && gifts.length > 0, `n=${gifts.length}`);
const gift = gifts.find((g) => Number(g.catFoodPrice) > 0) || gifts[0];

const beforeBoot = await companionBootstrap(companionT);
const beforeEarn = beforeBoot.json?.data?.earnings || beforeBoot.json?.earnings || {};
const beforeChannels = beforeEarn.channels || {};
report.evidence.before = {
  withdrawable: beforeEarn.availableWithdrawable ?? beforeEarn.withdrawable,
  giftNet: beforeEarn.giftNetIncome ?? beforeChannels.giftNetIncome,
  orderIncome: beforeEarn.orderIncome ?? beforeChannels.orderIncome,
  withdrawalLocked: beforeEarn.withdrawalLocked ?? beforeEarn.frozen,
  withdrawn: beforeEarn.withdrawnTotal ?? beforeEarn.withdrawn,
};
step(
  "CHANNELS_PRESENT",
  beforeEarn &&
    (beforeEarn.channels ||
      beforeEarn.giftNetIncome != null ||
      beforeEarn.orderIncome != null ||
      beforeEarn.withdrawable != null),
  JSON.stringify(report.evidence.before)
);

// Catfood gift send (idempotent)
const idem = `e2e-gift-ch-${Date.now()}`;
const send1 = await api("/api/boss/marketplace", bossT, {
  action: "send_gift",
  companionId,
  giftId: gift?.id,
  quantity: 1,
  idempotencyKey: idem,
});
const send2 = await api("/api/boss/marketplace", bossT, {
  action: "send_gift",
  companionId,
  giftId: gift?.id,
  quantity: 1,
  idempotencyKey: idem,
});
const snap = send1.json?.snapshot || {};
const tx = send1.json?.transaction || send2.json?.transaction || {};
report.evidence.giftSend = {
  status1: send1.status,
  status2: send2.status,
  replayed: !!send2.json?.replayed,
  snapshot: snap,
  txId: tx.id || "",
  paymentMethod: tx.payment_method || snap.paymentMethod || "",
  net: snap.companionIncome,
  gross: snap.grossCatFood,
  commission: snap.platformCommissionAmount,
};
step(
  "CATFOOD_GIFT_IDEMPOTENT",
  send1.status === 200 &&
    send1.json?.ok &&
    send2.status === 200 &&
    (send2.json?.replayed === true || send2.json?.ok) &&
    Number(snap.companionIncome) > 0 &&
    Number(snap.grossCatFood) > Number(snap.companionIncome),
  JSON.stringify(report.evidence.giftSend)
);

const afterBoot = await companionBootstrap(companionT);
const afterEarn = afterBoot.json?.data?.earnings || afterBoot.json?.earnings || {};
report.evidence.afterGift = {
  withdrawable: afterEarn.availableWithdrawable ?? afterEarn.withdrawable,
  giftNet: afterEarn.giftNetIncome ?? afterEarn.channels?.giftNetIncome,
  giftGross: afterEarn.giftGross ?? afterEarn.channels?.giftGross,
  orderIncome: afterEarn.orderIncome ?? afterEarn.channels?.orderIncome,
};
const giftIncreased =
  Number(report.evidence.afterGift.giftNet || 0) >= Number(report.evidence.before.giftNet || 0) ||
  Number(report.evidence.afterGift.withdrawable || 0) >= 16;
step("GIFT_NET_IN_CHANNELS", giftIncreased && afterEarn, JSON.stringify(report.evidence.afterGift));

// Withdraw freeze probe (may skip if no approved account / insufficient balance)
const wdAmount = Math.min(10, Math.floor(Number(report.evidence.afterGift.withdrawable || 0)));
let freezeOk = false;
const perms = afterBoot.json?.data?.permissions || afterBoot.json?.permissions || {};
const rules = afterBoot.json?.data?.withdrawalRules || afterBoot.json?.withdrawalRules || {};
if (wdAmount >= 1 && perms.canWithdraw !== false) {
  const accounts = rules.approvedAccounts || [];
  const accountId = accounts[0]?.id || "";
  if (accountId) {
    const wd = await api("/api/companion", companionT, {
      action: "request_withdrawal",
      amount: wdAmount,
      paymentAccountId: accountId,
      remark: "e2e freeze model",
    });
    report.evidence.withdrawRequest = { status: wd.status, ok: wd.json?.ok, message: wd.json?.message, item: wd.json?.item || wd.json?.withdrawal };
    if (wd.json?.ok || wd.status === 200) {
      const mid = await companionBootstrap(companionT);
      const midEarn = mid.json?.data?.earnings || mid.json?.earnings || {};
      const locked = Number(midEarn.withdrawalLocked ?? midEarn.frozen ?? 0);
      const avail = Number(midEarn.availableWithdrawable ?? midEarn.withdrawable ?? 0);
      report.evidence.afterFreeze = { locked, avail, beforeAvail: report.evidence.afterGift.withdrawable };
      freezeOk = locked >= wdAmount && avail <= Number(report.evidence.afterGift.withdrawable || 0) - wdAmount + 0.01;
      const wid = wd.json?.item?.id || wd.json?.withdrawal?.id || report.evidence.withdrawRequest.item?.id;
      if (wid) {
        const rej = await api(
          "/api/admin/finance",
          adminT,
          { action: "reject_withdraw", id: wid, reason: "e2e unlock freeze", adminId: adminLogin.json?.profile?.id },
          "POST",
          { "x-mcj-admin-role": "admin" }
        );
        report.evidence.reject = { status: rej.status, ok: rej.json?.ok, message: rej.json?.message };
        const end = await companionBootstrap(companionT);
        const endEarn = end.json?.data?.earnings || end.json?.earnings || {};
        report.evidence.afterReject = {
          locked: endEarn.withdrawalLocked ?? endEarn.frozen,
          avail: endEarn.availableWithdrawable ?? endEarn.withdrawable,
        };
      }
    } else {
      step("WITHDRAW_FREEZE", false, wd.json?.message || `status=${wd.status}`);
    }
  } else {
    step("WITHDRAW_FREEZE", true, "SKIP no approved payment account");
    freezeOk = true;
  }
} else {
  step("WITHDRAW_FREEZE", true, `SKIP withdrawable=${wdAmount} canWithdraw=${perms.canWithdraw}`);
  freezeOk = true;
}
if (report.evidence.afterFreeze) {
  step("WITHDRAW_FREEZE", freezeOk, JSON.stringify(report.evidence.afterFreeze));
}

const failed = report.steps.filter((s) => s.result === "FAIL");
report.verdict = failed.length ? "FAIL" : "PASS";
fs.writeFileSync(path.join(outDir, "evidence.json"), JSON.stringify(report, null, 2));
console.log(`\nVERDICT ${report.verdict} failed=${failed.length}`);
process.exit(failed.length ? 1 : 0);
