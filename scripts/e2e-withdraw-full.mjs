/**
 * Full withdraw E2E against Preview API + Supabase.
 * node scripts/e2e-withdraw-full.mjs --base=https://....vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const COMPANION_ID = "c776e811-6003-48a4-8f11-ed9eb1b70898";
const ACCOUNT_ID = "f65343a7-997c-4c81-b4e1-bab1bd34622f";
const API_BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!API_BASE) throw new Error("need --base=");

async function auth(email, pass) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function rest(table, qs, { method = "GET", body, service = true } = {}) {
  const key = SERVICE;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function companionApi(token, action, body = {}) {
  const getOnly = action === "wallet" || action === "earnings" || action === "bootstrap";
  const url = getOnly
    ? `${API_BASE}/api/companion?action=${encodeURIComponent(action)}`
    : `${API_BASE}/api/companion`;
  const r = await fetch(url, {
    method: getOnly ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: getOnly ? undefined : JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`companion ${action}: ${j.message || JSON.stringify(j)}`);
  return j;
}

async function finance(action, body = {}) {
  const isGet = action === "bootstrap";
  const url = isGet ? `${API_BASE}/api/admin/finance?action=bootstrap` : `${API_BASE}/api/admin/finance`;
  const r = await fetch(url, {
    method: isGet ? "GET" : "POST",
    headers: {
      "x-mcj-admin-role": "admin",
      "x-user-role": "admin",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: isGet ? undefined : JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`finance ${action}: ${j.message || JSON.stringify(j)}`);
  return j;
}

async function ensureIncome() {
  const txs = await rest(
    "transactions",
    `?user_id=eq.${COMPANION_ID}&transaction_type=eq.companion_income&select=amount,status`
  );
  const sum = (txs || []).reduce((n, t) => n + Number(t.amount || 0), 0);
  if (sum < 300) {
    await rest("transactions", "", {
      method: "POST",
      body: {
        user_id: COMPANION_ID,
        transaction_type: "companion_income",
        amount: 500,
        status: "completed",
        note: "e2e full withdraw seed",
        created_at: new Date().toISOString(),
      },
    });
  }
}

async function cancelPending() {
  const pending = await rest(
    "companion_withdrawals",
    `?companion_id=eq.${COMPANION_ID}&status=in.(pending,pending_review)&select=id`
  );
  for (const p of pending || []) {
    await rest(`companion_withdrawals?id=eq.${p.id}`, "", {
      method: "PATCH",
      body: { status: "cancelled", reject_reason: "e2e cleanup", rejection_reason: "e2e cleanup" },
    });
  }
}

async function main() {
  console.log("base", API_BASE);
  console.log("project_ref", new URL(SUPABASE_URL).hostname.split(".")[0]);
  await ensureIncome();
  await cancelPending();
  const token = await auth("companion@meow.test", "McjTest@12345678");

  // 1) create
  const created = await companionApi(token, "request_withdrawal", {
    amount: 50,
    remark: "e2e full flow",
    paymentAccountId: ACCOUNT_ID,
  });
  const id = created.item?.id || created.data?.withdrawalId;
  console.log("STEP1_create", { id, message: created.message, status: created.item?.status });
  if (!id) throw new Error("no id");
  if (!/提现申请已提交/.test(created.message || "")) throw new Error("wrong success message");

  // 2) db pending
  const db1 = (await rest("companion_withdrawals", `?id=eq.${id}&select=*`))?.[0];
  console.log("STEP2_db", { status: db1.status, freeze: db1.freeze_tx_id, account: db1.account_name });
  if (db1.status !== "pending_review") throw new Error("expected pending_review");
  if (!db1.freeze_tx_id) console.warn("WARN no freeze_tx_id");

  // 3) companion wallet shows pending
  const wallet = await companionApi(token, "wallet");
  const w = (wallet.data?.withdrawals || []).find((x) => x.id === id);
  console.log("STEP3_companion", {
    status: w?.status,
    statusText: w?.statusText,
    account: wallet.data?.withdrawalRules?.currentAccount,
  });
  if (!w || !/pending/.test(w.status)) throw new Error("companion missing pending record");
  if (/Preview Test/i.test(wallet.data?.withdrawalRules?.currentAccount || "")) {
    throw new Error("fake Preview Test account still showing");
  }

  // 4) admin sees it
  const boot = await finance("bootstrap");
  const adminRow = (boot.withdrawals || []).find((x) => x.id === id);
  console.log("STEP4_admin_see", { found: !!adminRow, status: adminRow?.status });
  if (!adminRow) throw new Error("admin cannot see withdrawal");

  // 5) reject path (separate record)
  await cancelPending();
  // recreate after cancel cleaned the pending one - wait, cancelPending cancelled our id!
  // Need separate reject test - create rejectId first before cancel, or don't cancel the main id.

  // Actually we cancelled everything including id. Re-run create for reject and approve separately.
  const rejCreate = await companionApi(token, "request_withdrawal", {
    amount: 50,
    remark: "e2e reject",
    paymentAccountId: ACCOUNT_ID,
  });
  const rejectId = rejCreate.item?.id;
  const rej = await finance("reject_withdraw", { id: rejectId, reason: "E2E 驳回原因" });
  const rejDb = (await rest("companion_withdrawals", `?id=eq.${rejectId}&select=id,status,rejection_reason,freeze_tx_id`))?.[0];
  console.log("STEP5_reject", { ok: rej.ok, status: rejDb.status, reason: rejDb.rejection_reason });
  if (rejDb.status !== "rejected") throw new Error("reject failed");

  // 6) approve path
  const aprCreate = await companionApi(token, "request_withdrawal", {
    amount: 50,
    remark: "e2e approve",
    paymentAccountId: ACCOUNT_ID,
  });
  const approveId = aprCreate.item?.id;
  const apr = await finance("approve_withdraw", { id: approveId });
  const aprDb = (await rest("companion_withdrawals", `?id=eq.${approveId}&select=id,status,reviewed_at`))?.[0];
  const pay = await rest(
    "finance_payments",
    `?related_record_id=eq.${approveId}&select=id,status,payment_type,amount_rm`
  );
  console.log("STEP6_approve", {
    ok: apr.ok,
    status: aprDb.status,
    payment: pay?.[0],
    message: apr.message,
  });
  if (aprDb.status !== "approved_pending_pay") throw new Error("approve status mismatch");
  if (!apr.ok) throw new Error("approve API not ok");

  // final companion sync
  const wallet2 = await companionApi(token, "wallet");
  const rejW = (wallet2.data?.withdrawals || []).find((x) => x.id === rejectId);
  const aprW = (wallet2.data?.withdrawals || []).find((x) => x.id === approveId);
  console.log("STEP7_sync", {
    rejected: rejW?.status,
    approved: aprW?.status,
  });
  if (rejW?.status !== "rejected") throw new Error("reject not synced to companion");
  if (aprW?.status !== "approved_pending_pay") throw new Error("approve not synced to companion");

  console.log("ALL_PASS=true");
  console.log("PRIMARY_TEST_ID", approveId);
  console.log("REJECT_TEST_ID", rejectId);
  console.log("FIRST_CREATE_ID", id);
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
