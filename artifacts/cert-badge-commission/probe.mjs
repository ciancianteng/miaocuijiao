#!/usr/bin/env node
/** Read-only Staging probe: is the cert-badge migration applied? No writes. */
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "../../scripts/lib/prod-guard.mjs";

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
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
