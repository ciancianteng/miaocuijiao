/** Staging-only: diagnose why E2E direct orders stay awaiting_payment with total 0. Cancels its own order. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "cert-badge-debug-order", base: STG, supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co` });
const build = await fetch(`${STG}/api/build-info`).then((r) => r.json());
if (!build.supabaseIsStaging || build.supabaseIsProduction) throw new Error("not staging");
const organicPath = [
  path.resolve(here, "../../../wt-p0-price-sot-prod/artifacts/go-live-organic/organic-accounts.json"),
  path.resolve(here, "../../../meow-cuijiao-homepage/artifacts/go-live-organic/organic-accounts.json"),
].find((p) => fs.existsSync(p));
const PASS = JSON.parse(fs.readFileSync(organicPath, "utf8")).password;
const tok = (j) => j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
async function api(p, token, body, method = "POST", extra = {}) {
  const res = await fetch(`${STG}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}), ...extra },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const brief = (r) => ({ status: r.status, ok: r.json?.ok, message: r.json?.message, code: r.json?.code });

const bossT = tok((await api("/api/auth", null, { action: "login", email: "organic.invitee.boss@mcj-staging-organic.invalid", password: PASS, loginPortal: "boss" })).json);
const comp = await api("/api/companion", null, { action: "login", account: "organic.invitee.comp@mcj-staging-organic.invalid", password: PASS });
const pwId = comp.json?.session?.user?.id || "";
const rc = await api("/api/recharge", bossT, null, "GET");
console.log("wallet", JSON.stringify(rc.json?.wallet || rc.json?.summary || {}).slice(0, 200));
console.log("orderPayMethods", (rc.json?.orderPayMethods || []).map((m) => m.code).join(","), "walletPayEnabled", rc.json?.walletPayEnabled);

const created = await api("/api/orders", bossT, {
  action: "create",
  order: { title: "[cert-badge-e2e] debug", game: "VALORANT", game_id: `CB-DEBUG-${Date.now()}`, description: "[cert-badge-e2e] debug staging test data", hours: 1, companion_id: pwId, payment_method: "catfood", paymentMethod: "catfood" },
});
const o = created.json?.order || {};
console.log("create", JSON.stringify(brief(created)), "status", o.status, "total", o.totalAmount ?? o.total_amount, "unit", o.unitPrice ?? o.unit_price, "pm", o.paymentMethod);
if (o.id) {
  const pay = await api("/api/orders", bossT, { action: "pay_order", id: o.id, paymentMethod: "catfood" });
  console.log("pay", JSON.stringify(brief(pay)), "status", pay.json?.order?.status);
  const c = await api("/api/orders", bossT, { action: "cancel_order", id: o.id, reason: "[cert-badge-e2e] debug cleanup" });
  console.log("cleanup", o.orderNo, JSON.stringify(brief(c)));
}
