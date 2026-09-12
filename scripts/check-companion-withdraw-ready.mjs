/**
 * Read-only check of companion@meow.test withdraw readiness.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = "companion@meow.test";

async function rest(table, qs) {
  const r = await fetch(`${url}/rest/v1/${table}${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${table} ${r.status} ${t}`);
  return t ? JSON.parse(t) : [];
}

const profiles = await rest("profiles", `?email=eq.${encodeURIComponent(email)}&select=id,email,role,status&limit=1`);
const p = profiles[0];
if (!p) {
  console.log(JSON.stringify({ ok: false, message: "profile missing" }, null, 2));
  process.exit(1);
}
const [cp, idv, dep, pay] = await Promise.all([
  rest("companion_profiles", `?user_id=eq.${p.id}&select=id,verification_status,application_status,deposit_status,allow_orders&limit=1`),
  rest("companion_identity_verifications", `?user_id=eq.${p.id}&select=id,status,real_name&order=updated_at.desc&limit=1`),
  rest("companion_deposits", `?user_id=eq.${p.id}&select=id,status,paid_amount&order=updated_at.desc&limit=1`),
  rest("companion_payment_accounts", `?user_id=eq.${p.id}&select=id,status,bank_name,account_last4&order=updated_at.desc&limit=3`),
]);
const out = {
  userId: p.id,
  profile: p,
  companion: cp[0] || null,
  identity: idv[0] || null,
  deposit: dep[0] || null,
  payments: pay,
  ready:
    p.status === "active" &&
    /approved|verified|passed/.test(String(cp[0]?.verification_status || "")) &&
    /approved|verified|passed|paid|received/.test(String(cp[0]?.deposit_status || dep[0]?.status || "")) &&
    /approved|verified|passed/.test(String(idv[0]?.status || cp[0]?.verification_status || "")) &&
    (pay || []).some((a) => /approved|verified/.test(String(a.status || ""))),
};
console.log(JSON.stringify(out, null, 2));
