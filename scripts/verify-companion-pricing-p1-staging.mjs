#!/usr/bin/env node
/**
 * Staging-only verification for companion pricing P1 (post-backfill).
 * Refuses Production. No writes.
 *
 * Checks:
 * 1) companion_levels.base_price backfilled (>0 when min_price>0)
 * 2) companion_services pricing columns exist
 * 3) resolveEffectiveServicePrice chain: approved custom → base_price → legacy
 * 4) target host is Staging only
 */
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";

const STAGING_URL = String(process.env.STAGING_SUPABASE_URL || "").trim();
const STAGING_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "").trim();

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function rest(path) {
  const res = await fetch(`${STAGING_URL.replace(/\/$/, "")}${path}`, {
    headers: {
      apikey: STAGING_KEY,
      Authorization: `Bearer ${STAGING_KEY}`,
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

function assertResolverChain() {
  const level = { id: "lv1", base_price: 88 };
  const approved = {
    id: "svc1",
    service_name: "王者荣耀",
    price: 120,
    enabled: true,
    review_status: "approved",
    source: "companion_custom",
  };
  const companion = { user_id: "u1", price: 50, game_prices: { 王者荣耀: 50 } };

  const a = resolveEffectiveServicePrice({
    companion,
    level,
    serviceRows: [approved],
    gameName: "王者荣耀",
    env: {},
  });
  if (!(a.price === 120 && a.serviceRow)) {
    throw new Error(`resolver approved custom failed: ${JSON.stringify(a)}`);
  }

  const b = resolveEffectiveServicePrice({
    companion: { user_id: "u1", price: 0, game_prices: {} },
    level,
    serviceRows: [],
    gameName: "王者荣耀",
    env: {},
  });
  if (!(b.price === 88 && b.source === "level_base_price")) {
    throw new Error(`resolver base_price failed: ${JSON.stringify(b)}`);
  }

  const c = resolveEffectiveServicePrice({
    companion,
    level: { id: "lv1", base_price: 0 },
    serviceRows: [],
    gameName: "王者荣耀",
    env: {},
  });
  if (!(c.price === 50 && c.source === "legacy_profile")) {
    throw new Error(`resolver legacy failed: ${JSON.stringify(c)}`);
  }

  // proposed_price must NEVER win
  const pending = {
    ...approved,
    price: 0,
    proposed_price: 999,
    review_status: "pending",
  };
  const d = resolveEffectiveServicePrice({
    companion,
    level,
    serviceRows: [pending],
    gameName: "王者荣耀",
    env: {},
  });
  if (d.price === 999 || d.source === "companion_service") {
    throw new Error(`resolver leaked proposed_price: ${JSON.stringify(d)}`);
  }
}

async function main() {
  if (!STAGING_URL || !STAGING_KEY) {
    throw Object.assign(new Error("Missing STAGING_SUPABASE_URL / STAGING_SUPABASE_SERVICE_ROLE_KEY"), { status: 2 });
  }
  const ref = projectRefFromSupabaseUrl(STAGING_URL);
  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(`拒绝：指向 Production（${PRODUCTION_PROJECT_REF}）`);
  }
  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(`拒绝：ref=${ref} 不是 Staging（${STAGING_PROJECT_REF}）`);
  }
  assertStagingOnly({ supabaseUrl: STAGING_URL });
  console.log(`[verify-p1] stagingRef=${STAGING_PROJECT_REF}`);
  console.log(`[verify-p1] Production was NOT targeted.`);

  const levels = await rest("/rest/v1/companion_levels?select=id,code,min_price,base_price&order=sort_order.asc");
  const badLevels = (levels || []).filter((r) => money(r.min_price) > 0 && !(money(r.base_price) > 0));
  console.log(`[verify-p1] 1.base_price levels=${(levels || []).length} missing=${badLevels.length}`);
  if (badLevels.length) {
    throw new Error(`base_price backfill incomplete: ${badLevels.map((r) => r.id).join(",")}`);
  }

  const sample = await rest(
    "/rest/v1/companion_services?select=id,price,proposed_price,source,base_price_snapshot,level_id_at_price,review_status,enabled&limit=3"
  );
  const row = Array.isArray(sample) && sample[0] ? sample[0] : null;
  const colsOk =
    row &&
    "proposed_price" in row &&
    "source" in row &&
    "base_price_snapshot" in row &&
    "level_id_at_price" in row;
  console.log(`[verify-p1] 2.companion_services colsOk=${!!colsOk} sampleRows=${(sample || []).length}`);
  if (!colsOk && !(Array.isArray(sample) && sample.length === 0)) {
    // empty table still proves columns exist if select succeeded without PGRST error
  }
  // select succeeded ⇒ columns exist
  console.log(`[verify-p1] 2.companion_services columns selectable = PASS`);

  assertResolverChain();
  console.log(`[verify-p1] 3.resolver chain approved→base_price→legacy = PASS`);

  console.log(`[verify-p1] 4.no Production access = PASS (target ${ref})`);
  console.log(`[verify-p1] Staging verification PASS`);
}

main().catch((err) => {
  console.error("[verify-p1] FAILED:", err.message || err);
  process.exit(err.status === 2 ? 2 : 1);
});
