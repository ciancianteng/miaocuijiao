/**
 * Staging-only manual payment MVP smoke chain. Requires the seeded E2E accounts in .env.local.
 * node scripts/e2e-manual-payment-chain.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).filter(Boolean)
  .filter((line) => !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const i = line.indexOf("="); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
const BASE = (process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const SUPABASE = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const password = env.E2E_PASSWORD || "McjTest@12345678";
const account = {
  boss: env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test",
  cs: env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test",
  companion: env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test",
  admin: env.E2E_ADMIN_EMAIL || "admin@meow.test",
};
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6nQAAAABJRU5ErkJggg==";
const result = [];
const check = (name, ok, detail = "") => { result.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`); return ok; };
if (/localhost|127\.0\.0\.1/i.test(BASE)) throw new Error("Refuse localhost; use fixed Staging URL");

async function login(email) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`login ${email}: ${body.message || response.status}`);
  return body;
}
async function api(pathname, token, body, extra = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok && json.ok !== false, status: response.status, body: json };
}

try {
  const [boss, cs, companion, admin] = await Promise.all([login(account.boss), login(account.cs), login(account.companion), login(account.admin)]);
  check("logins", true);
  const created = await api("/api/orders", boss.access_token, {
    action: "create", order: {
      companion_id: companion.user.id,
      companionId: companion.user.id,
      order_type: "direct_companion",
      game: "ManualPaymentE2E",
      title: `人工付款 E2E ${Date.now()}`,
      description: "manual payment E2E",
      hours: 1,
      unit_price: 22,
      total_amount: 22,
      paymentMethod: "tng",
      payment_method: "tng",
    },
  });
  const order = created.body.order;
  if (!check("boss_create_tng", created.ok && order?.id && (order.companionId === companion.user.id || order.companion_id === companion.user.id), created.body.message || `companion=${order?.companionId || order?.companion_id || "missing"}`)) throw new Error("create failed");
  const proof = await api("/api/orders", boss.access_token, { action: "submit_payment_proof", id: order.id, proofDataUrl: tinyPng, paymentMethod: "tng" });
  if (!check("boss_submit_proof", proof.ok && proof.body.order?.paymentReview, proof.body.message || "")) throw new Error("proof failed");
  const csBoot = await api("/api/customer-service", cs.access_token);
  const pending = (csBoot.body.data?.orders || []).find((row) => row.id === order.id);
  if (!check("cs_sees_pending_proof", csBoot.ok && pending?.paymentReview, "")) throw new Error("CS receipt absent");
  const confirmed = await api("/api/customer-service", cs.access_token, { action: "confirm_payment", id: order.id });
  if (!check("cs_confirms_and_ledgers", confirmed.ok && ["claimed", "pending"].includes(confirmed.body.order?.status), confirmed.body.message || "")) throw new Error("confirm failed");
  const after = confirmed.body.order || {};
  const companionBoot = await api(`/api/companion?action=bootstrap`, companion.access_token);
  const myOrders = companionBoot.body?.data?.myOrders || companionBoot.body?.myOrders || [];
  const pendingDirect = companionBoot.body?.data?.pendingDirectOrders || companionBoot.body?.pendingDirectOrders || [];
  const delivered =
    myOrders.some((row) => row.id === order.id) ||
    pendingDirect.some((row) => row.id === order.id) ||
    after.companionId === companion.user.id ||
    after.companion_id === companion.user.id;
  check(
    "companion_receives_designated",
    companionBoot.ok && delivered,
    `status=${after.status} companion=${after.companionId || after.companion_id || ""} my=${myOrders.length} bootOk=${companionBoot.ok} msg=${companionBoot.body?.message || ""}`
  );
  const paid = await api("/api/admin/finance", admin.access_token, { action: "list_payment_receipts" }, { "x-mcj-admin-role": "admin" });
  check("admin_lists_paid_receipt", paid.ok && (paid.body.rows || []).some((row) => row.order_id === order.id), paid.body.message || "");
} catch (error) {
  check("chain_exception", false, error.message || String(error));
}
const passed = result.every((row) => row.ok);
console.log(`MANUAL_PAYMENT_E2E_${passed ? "PASS" : "FAIL"}`);
process.exit(passed ? 0 : 1);
