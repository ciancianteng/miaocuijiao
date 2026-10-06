/** Staging-only cleanup of an aborted E2E run: cancel its open orders, remove + disable its E2E badges. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "cert-badge-cleanup", base: STG, supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co` });
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
const adminH = { "x-mcj-admin-role": "admin" };
const adminT = tok((await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: "McjTest@12345678" })).json);
const bossT = tok((await api("/api/auth", null, { action: "login", email: "organic.invitee.boss@mcj-staging-organic.invalid", password: PASS, loginPortal: "boss" })).json);

const badgeNames = (process.argv[2] || "").split(",").filter(Boolean);
const orderIds = (process.argv[3] || "").split(",").filter(Boolean);

const mine = await api("/api/orders", bossT, null, "GET");
for (const o of mine.json?.orders || []) {
  const no = String(o.orderNo || o.order_no || "");
  if (!orderIds.includes(no)) continue;
  const c = await api("/api/orders", bossT, { action: "cancel_order", id: o.id, reason: "[cert-badge-e2e] aborted run cleanup" });
  console.log("cancel", no, o.status, c.status, c.json?.message);
}

const CERT = "/api/admin/companion-cert-tags";
const list = await api(`${CERT}?action=stats&range=all`, adminT, null, "GET", adminH);
for (const b of list.json?.badges || []) {
  if (!badgeNames.includes(b.name)) continue;
  const d = await api(`${CERT}?action=detail&id=${encodeURIComponent(b.id)}&range=all`, adminT, null, "GET", adminH);
  for (const m of d.json?.members || []) {
    if (m.status === "removed") continue;
    if (m.status === "active") await api(CERT, adminT, { action: "request_removal", assignmentId: m.id, reason: "[cert-badge-e2e] aborted run cleanup" }, "POST", adminH);
    const a = await api(CERT, adminT, { action: "approve_removal", assignmentId: m.id }, "POST", adminH);
    console.log("remove", b.name, m.pwCode, a.status, a.json?.message || "");
  }
  const t = await api(CERT, adminT, { action: "save", tag: { id: b.id, name: b.name, enabled: false, companionShareRate: b.companionShareRate } }, "POST", adminH);
  console.log("disable", b.name, t.status, t.json?.message || "");
}
