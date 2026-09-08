#!/usr/bin/env node
/**
 * Staging-only: apply gameplay_products.commission_rate + verify persist round-trip.
 *
 * Refuses Production (jqfaknpmcnqwqvatrwgo).
 *
 * Usage:
 *   STAGING_SUPABASE_URL=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
 *   STAGING_DATABASE_URL=… (or STAGING_DB_PASSWORD=…) \
 *   node scripts/apply-and-verify-gameplay-commission-staging.mjs
 *
 * Optional:
 *   PRODUCT_ID=… PRODUCT_NAME='S11 3x3 不包战损'
 */
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  readSqlFile,
  applySqlViaPostgres,
  applySqlViaManagementApi,
  projectRefFromDatabaseUrl,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";

const STAGING_URL = String(
  process.env.STAGING_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    `https://${STAGING_PROJECT_REF}.supabase.co`
).trim();
const STAGING_KEY = String(
  process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const PRODUCT_NAME = String(process.env.PRODUCT_NAME || "S11 3x3 不包战损").trim();
const PRODUCT_ID_HINT = String(process.env.PRODUCT_ID || "").trim();

function headers(extra = {}) {
  return {
    apikey: STAGING_KEY,
    Authorization: `Bearer ${STAGING_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function rest(path, init = {}) {
  const res = await fetch(`${STAGING_URL.replace(/\/$/, "")}${path}`, init);
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

async function setRate(id, rate) {
  const rows = await rest(`/rest/v1/gameplay_products?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ commission_rate: rate, updated_at: new Date().toISOString() }),
  });
  const saved = rows?.[0];
  if (!saved) throw new Error(`PATCH returned empty for rate=${rate}`);
  if (Number(saved.commission_rate) !== Number(rate)) {
    throw new Error(`Mismatch after PATCH: expected ${rate}, got ${saved.commission_rate}`);
  }
  const again = await rest(
    `/rest/v1/gameplay_products?id=eq.${encodeURIComponent(id)}&select=id,name,commission_rate&limit=1`,
    { headers: headers() }
  );
  if (Number(again?.[0]?.commission_rate) !== Number(rate)) {
    throw new Error(`Re-read mismatch: expected ${rate}, got ${again?.[0]?.commission_rate}`);
  }
  return again[0];
}

async function main() {
  const urlRef = projectRefFromSupabaseUrl(STAGING_URL);
  if (urlRef === PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing Production Supabase (${PRODUCTION_PROJECT_REF}).`);
  }
  if (urlRef && urlRef !== STAGING_PROJECT_REF) {
    throw new Error(`Refusing non-Staging Supabase ref=${urlRef}. Expected ${STAGING_PROJECT_REF}.`);
  }
  if (!STAGING_KEY) throw new Error("Missing STAGING_SUPABASE_SERVICE_ROLE_KEY");

  const oneshotDb = String(process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD || "").trim();
  const oneshotPat = String(process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || "").trim();
  const dbUrl = oneshotDb || (oneshotPass ? buildStagingPoolerUrl(oneshotPass) : "");

  if (dbUrl) {
    const ref = projectRefFromDatabaseUrl(dbUrl);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production DATABASE_URL");
    assertStagingOnly({ databaseUrl: dbUrl, supabaseUrl: STAGING_URL });
  }

  console.log(`[verify] stagingRef=${STAGING_PROJECT_REF}`);
  console.log(`[verify] supabase=${STAGING_URL}`);

  // 1) Apply DDL
  const { path: sqlPath, sql } = readSqlFile([
    "supabase/migrations/20260806_gameplay_commission_rate.sql",
    "supabase/pending-prod/10_gameplay_products_commission_rate.sql",
  ]);
  console.log(`[apply] sql=${sqlPath}`);
  if (dbUrl) {
    console.log("[apply]", await applySqlViaPostgres(dbUrl, sql));
  } else if (oneshotPat) {
    console.log("[apply]", await applySqlViaManagementApi(oneshotPat, sql));
  } else {
    // Column may already exist — probe before failing.
    try {
      await rest(`/rest/v1/gameplay_products?select=commission_rate&limit=1`, { headers: headers() });
      console.log("[apply] skipped DDL (no STAGING_DATABASE_URL); column already selectable");
    } catch (err) {
      throw new Error(
        `Need STAGING_DATABASE_URL or STAGING_DB_PASSWORD to add commission_rate. Probe failed: ${err.message}`
      );
    }
  }

  // 2) Resolve product
  let product;
  if (PRODUCT_ID_HINT) {
    product = (
      await rest(
        `/rest/v1/gameplay_products?id=eq.${encodeURIComponent(PRODUCT_ID_HINT)}&select=id,name,commission_rate,price&limit=1`,
        { headers: headers() }
      )
    )?.[0];
  }
  if (!product) {
    const encoded = encodeURIComponent(`*${PRODUCT_NAME}*`);
    product = (
      await rest(`/rest/v1/gameplay_products?name=ilike.${encoded}&select=id,name,commission_rate,price&limit=5`, {
        headers: headers(),
      })
    )?.[0];
  }
  if (!product) {
    // Create a temporary staging product for verification if S11 missing on Staging.
    const id = `gp-commission-verify-${Date.now()}`;
    const created = await rest(`/rest/v1/gameplay_products`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        id,
        name: PRODUCT_NAME || "commission-verify",
        category: "护航",
        games_text: "三角洲行动",
        game_ids: ["三角洲行动"],
        short_description: "commission verify",
        description: "staging commission persist verify",
        price: 238,
        pricing_unit: "每单",
        status: "draft",
        commission_rate: 0,
        featured: false,
        sort_order: 9999,
      }),
    });
    product = created?.[0];
    console.log(`[verify] created staging draft product ${product?.id}`);
  }
  if (!product?.id) throw new Error("Could not resolve product for verification");
  console.log(`[verify] product id=${product.id} name=${product.name} baseline_rate=${product.commission_rate}`);

  const steps = [0, 15, 20, 0];
  for (const rate of steps) {
    const row = await setRate(product.id, rate);
    console.log(`[PASS] rate=${rate} db=${row.commission_rate}`);
  }

  console.log("[PASS] round-trip 0→15→20→0");
  console.log("[PASS] Production was NOT touched");
}

main().catch((err) => {
  console.error("[FAIL]", err.message || err);
  process.exit(1);
});
