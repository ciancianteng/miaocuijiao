import fs from "fs";
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
  })
);
const u = (env.SUPABASE_URL || "").replace(/\/$/, "");
const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const s = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const email = "companion.final.1785714993009@meow.test";

const auth = await fetch(`${u}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: PASS }),
}).then((r) => r.json());
const uid = auth.user.id;
const cp = await fetch(`${u}/rest/v1/companion_profiles?user_id=eq.${uid}&select=id,user_id`, {
  headers: { apikey: s, Authorization: `Bearer ${s}` },
}).then((r) => r.json());
const cpId = cp?.[0]?.id;
console.log("companion", uid, "profile", cpId);

const existing = await fetch(
  `${u}/rest/v1/companion_payment_accounts?user_id=eq.${uid}&select=id,status,bank_name,account_name`,
  { headers: { apikey: s, Authorization: `Bearer ${s}` } }
).then((r) => r.json());
console.log("accounts", existing);

let accountId = existing?.[0]?.id;
if (!accountId) {
  const created = await fetch(`${u}/rest/v1/companion_payment_accounts`, {
    method: "POST",
    headers: {
      apikey: s,
      Authorization: `Bearer ${s}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      companion_profile_id: cpId,
      user_id: uid,
      bank_name: "Maybank",
      account_name: "E2E Companion",
      bank_account: "1234567890",
      account_last4: "7890",
      status: "approved",
      submitted_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  const text = await created.text();
  console.log("create", created.status, text.slice(0, 400));
  accountId = text ? JSON.parse(text)?.[0]?.id : null;
} else if (!/approved|verified/i.test(String(existing[0].status || ""))) {
  const patched = await fetch(`${u}/rest/v1/companion_payment_accounts?id=eq.${accountId}`, {
    method: "PATCH",
    headers: {
      apikey: s,
      Authorization: `Bearer ${s}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ status: "approved", reviewed_at: new Date().toISOString() }),
  });
  console.log("patch", patched.status, await patched.text());
}

// Also ensure companion can withdraw (allow_orders etc)
await fetch(`${u}/rest/v1/companion_profiles?user_id=eq.${uid}`, {
  method: "PATCH",
  headers: { apikey: s, Authorization: `Bearer ${s}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    allow_orders: true,
    application_status: "approved",
    verification_status: "approved",
    deposit_status: "approved",
    online_status: "online",
  }),
}).then(async (r) => console.log("cp patch", r.status, (await r.text()).slice(0, 200)));

console.log("accountId", accountId);
