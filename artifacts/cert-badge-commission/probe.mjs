#!/usr/bin/env node
/** Read-only Staging probe: is the cert-badge migration applied? No writes. */
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const STG = /^https:\/\/meow-cuijiao-homepage-[a-z0-9]+-ciancianteng-4581s-projects\.vercel\.app$/.test(process.env.STG_URL || "")
  ? process.env.STG_URL
  : "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "cert-badge-probe", base: STG, supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co` });
const build = await fetch(`${STG}/api/build-info`).then((r) => r.json());
if (!build.supabaseIsStaging || build.supabaseIsProduction || build.supabaseRef !== STAGING_SUPABASE_REF) {
  throw new Error(`not staging DB: ${JSON.stringify(build)}`);
}
const tok = (j) => j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
async function api(p, token, body, method = "POST") {
  const res = await fetch(`${STG}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const admin = tok((await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: "McjTest@12345678" })).json);
const list = await api("/api/admin/companion-cert-tags", admin, null, "GET");
const stats = await api("/api/admin/companion-cert-tags?action=stats&range=all", admin, null, "GET");
const comp = await api("/api/admin/companion-cert-tags?action=companion&ref=PW00076", admin, null, "GET");
for (const q of (process.argv[2] || "").split("|").filter(Boolean)) {
  const r = await api(`/api/admin/companion-cert-tags?${q}`, admin, null, "GET");
  console.log(q, "→", r.status, r.json?.message || "", JSON.stringify(r.json?.kpis || r.json?.badges?.[0] || {}).slice(0, 300));
  const pick = (r.json?.orders || []).find((o) => o.orderNo === process.argv[3]);
  if (pick) console.log("order", JSON.stringify(pick));
  if (r.json?.commissionLog) console.log("commissionLog", JSON.stringify(r.json.commissionLog));
  if (r.json?.badge) console.log("badge", JSON.stringify({ rate: r.json.badge.companionShareRate, priority: r.json.badge.commissionPriority }));
}
console.log(
  JSON.stringify(
    {
      build: { ref: build.supabaseRef, staging: build.supabaseIsStaging, commit: build.commit || build.gitCommit || "" },
      adminLogin: !!admin,
      list: { status: list.status, n: list.json?.items?.length, sample: list.json?.items?.[0] },
      stats: { status: stats.status, message: stats.json?.message, kpis: stats.json?.kpis },
      companion: { status: comp.status, message: comp.json?.message, assignments: comp.json?.assignments?.length },
    },
    null,
    2
  )
);
