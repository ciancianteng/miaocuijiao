/**
 * End-to-end withdraw probe against Preview Supabase + optional Preview API.
 * Usage:
 *   node scripts/test-companion-withdraw.mjs
 *   node scripts/test-companion-withdraw.mjs --base=https://xxx.vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
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
const EMAIL = "companion@meow.test";
const PASS = "McjTest@12345678";
const COMPANION_ID = "c776e811-6003-48a4-8f11-ed9eb1b70898";
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const API_BASE = (baseArg ? baseArg.slice(7) : process.env.PREVIEW_BASE || "").replace(/\/$/, "");

function projectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "";
  }
}

async function authToken() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function rest(table, qs, { method = "GET", token, body, service = false } = {}) {
  const key = service ? SERVICE : ANON;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${service ? SERVICE : token}`,
    "Content-Type": "application/json",
    Prefer: method === "POST" ? "return=representation" : "return=representation",
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function api(action, token, body = {}) {
  if (!API_BASE) throw new Error("no --base= Preview URL");
  const r = await fetch(`${API_BASE}/api/companion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`api ${action} ${r.status}: ${j.message || JSON.stringify(j)}`);
  return j;
}

async function ensureIncome() {
  const txs = await rest(
    "transactions",
    `?user_id=eq.${COMPANION_ID}&transaction_type=eq.companion_income&select=id,amount,status&limit=5`,
    { service: true }
  );
  const sum = (txs || []).reduce((n, t) => n + Number(t.amount || 0), 0);
  if (sum >= 100) {
    console.log("income_ok", sum);
    return;
  }
  const row = await rest("transactions", "", {
    method: "POST",
    service: true,
    body: {
      user_id: COMPANION_ID,
      order_id: null,
      transaction_type: "companion_income",
      amount: 200,
      status: "completed",
      note: "E2E withdraw test seed income",
      created_at: new Date().toISOString(),
    },
  });
  console.log("seeded_income", row?.[0]?.id || row);
}

async function main() {
  console.log("project_ref", projectRef());
  console.log("api_base", API_BASE || "(direct REST only)");
  await ensureIncome();

  // Cancel any pending withdrawals so we can create a fresh one
  const pending = await rest(
    "companion_withdrawals",
    `?companion_id=eq.${COMPANION_ID}&status=in.(pending,pending_review)&select=id,status`,
    { service: true }
  );
  for (const p of pending || []) {
    await rest(`companion_withdrawals?id=eq.${p.id}`, "", {
      method: "PATCH",
      service: true,
      body: { status: "cancelled", reject_reason: "e2e cleanup", rejection_reason: "e2e cleanup" },
    });
    console.log("cancelled_pending", p.id);
  }

  const token = await authToken();
  let created;
  if (API_BASE) {
    created = await api("request_withdrawal", token, {
      amount: 50,
      remark: "e2e withdraw test",
      paymentAccountId: "f65343a7-997c-4c81-b4e1-bab1bd34622f",
    });
    console.log("api_create", JSON.stringify({ message: created.message, id: created?.item?.id || created?.data?.withdrawalId, status: created?.item?.status }));
  } else {
    const rows = await rest("companion_withdrawals", "", {
      method: "POST",
      service: true,
      body: {
        withdrawal_no: `WD-E2E-${Date.now()}`,
        companion_id: COMPANION_ID,
        payment_account_id: "f65343a7-997c-4c81-b4e1-bab1bd34622f",
        amount: 50,
        cat_food_amount: 50,
        bank_name: "Maybank",
        account_name: "[TEST] 验收陪玩",
        account_holder: "[TEST] 验收陪玩",
        account_number: "******7890",
        account_last4: "7890",
        remark: "e2e direct insert",
        status: "pending_review",
      },
    });
    created = { item: rows?.[0] };
    console.log("direct_create", created.item?.id, created.item?.status);
  }

  const id = created?.item?.id || created?.data?.withdrawalId;
  if (!id) throw new Error("no withdrawal id");
  const dbRow = await rest(
    "companion_withdrawals",
    `?id=eq.${id}&select=id,status,amount,cat_food_amount,account_name,rejection_reason,companion_id`,
    { service: true }
  );
  console.log("db_row", JSON.stringify(dbRow?.[0] || null));
  console.log("TEST_WITHDRAWAL_ID", id);
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
