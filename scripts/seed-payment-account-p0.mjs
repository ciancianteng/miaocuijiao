/**
 * Seed + approve payment account for idcard companion.
 * node scripts/seed-payment-account-p0.mjs
 * Hard-guarded against Production.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertSafeDbTarget, loadEnvFiles } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
assertSafeDbTarget({ script: "seed-payment-account-p0.mjs" });
const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function auth(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  return r.json();
}
async function api(pathname, token, body, headers = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function rest(table, qs, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
    method: init.method || "GET",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

const companion = await auth("companion.idcard.1785715257525@meow.test");
const admin = await auth("admin@meow.test");
const cp = await rest("companion_profiles", `?user_id=eq.${companion.user.id}&select=id&limit=1`);
const cpid = cp.body?.[0]?.id;
console.log("cpid", cpid, "uid", companion.user.id);

// Discover columns
const any = await rest("companion_payment_accounts", "?select=*&limit=1");
console.log("sample cols", any.status, any.body?.[0] ? Object.keys(any.body[0]) : any.body);

const submit = await api("/api/companion", companion.access_token, {
  action: "submit_verification",
  real_name: "验收陪玩",
  identity_no: "A987654321",
  id_front: TINY_PNG,
  id_back: TINY_PNG,
  account_name: "验收陪玩",
  bank_account: "123456789012",
  bank_name: "Maybank",
  method: "bank",
});
console.log("submit", submit.status, submit.body.ok, submit.body.message);

const byUser = await rest(
  "companion_payment_accounts",
  `?user_id=eq.${companion.user.id}&select=*&order=submitted_at.desc&limit=5`
);
console.log("byUser", byUser.status, byUser.body);
const byProf = await rest(
  "companion_payment_accounts",
  `?companion_profile_id=eq.${cpid}&select=*&order=submitted_at.desc&limit=5`
);
console.log("byProf", byProf.status, byProf.body);

const review = await api(
  "/api/admin/players",
  admin.access_token,
  { action: "review_payment", id: cpid, status: "approved" },
  { "x-mcj-admin-role": "admin" }
);
console.log("review_payment", review.status, review.body.ok, review.body.message);

await api(
  "/api/admin/players",
  admin.access_token,
  { action: "review_identity", id: cpid, status: "approved" },
  { "x-mcj-admin-role": "admin" }
);

const wallet = await fetch(`${BASE}/api/companion?action=wallet`, {
  headers: { Authorization: `Bearer ${companion.access_token}`, Accept: "application/json" },
}).then(async (r) => r.json());
console.log(
  "canWithdraw",
  wallet?.data?.permissions?.canWithdraw,
  wallet?.data?.permissions?.withdrawLockReason,
  "accounts",
  wallet?.data?.withdrawalRules?.approvedAccounts
);

const wd = await api("/api/companion", companion.access_token, {
  action: "request_withdrawal",
  amount: 40,
  remark: "probe withdraw",
  paymentAccountId: wallet?.data?.withdrawalRules?.approvedAccounts?.[0]?.id,
});
console.log("withdraw", wd.status, wd.body.ok, wd.body.message, wd.body.item?.id || wd.body.data);
