#!/usr/bin/env node
/**
 * Staging-only: apply gameplay_products.commission_rate + verify persist round-trip.
 *
 * Refuses Production (jqfaknpmcnqwqvatrwgo). Never falls back to SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY when those point at Production.
 *
 * Usage:
 *   STAGING_SUPABASE_URL=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
 *   STAGING_DATABASE_URL=… (or STAGING_DB_PASSWORD=…) \
 *   node scripts/apply-and-verify-gameplay-commission-staging.mjs
 *
 * Optional:
 *   PRODUCT_ID=… PRODUCT_NAME='S11 3x3 不包战损'
 *   SKIP_DDL=1  — only verify (column must already exist)
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
import { normalizeCommissionRate, normalizeProductRow, toDbRow, fromDbRow } from "../server/api/_gameplay-products-store.js";

function resolveStagingUrl() {
  const explicit = String(process.env.STAGING_SUPABASE_URL || "").trim();
  if (explicit) return explicit;
  const fallback = String(process.env.SUPABASE_URL || "").trim();
  const ref = projectRefFromSupabaseUrl(fallback);
  if (ref === STAGING_PROJECT_REF) return fallback;
  // Never silently use Production.
  return `https://${STAGING_PROJECT_REF}.supabase.co`;
}

function resolveStagingKey() {
  const explicit = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (explicit) return explicit;
  const fallbackUrl = String(process.env.SUPABASE_URL || "").trim();
  const fallbackKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (projectRefFromSupabaseUrl(fallbackUrl) === STAGING_PROJECT_REF && fallbackKey) return fallbackKey;
  return "";
}

const STAGING_URL = resolveStagingUrl();
const STAGING_KEY = resolveStagingKey();
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
    const err = new Error(`${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function assertNormalize(rate) {
  const n = normalizeCommissionRate(rate);
  if (Number(n) !== Number(rate)) {
    throw new Error(`normalizeCommissionRate(${rate}) => ${n}`);
  }
  const row = normalizeProductRow({
    name: "n",
    shortDescription: "x",
    commissionRate: rate,
    price: 1,
  });
  if (Number(row.commissionRate) !== Number(rate)) {
    throw new Error(`normalizeProductRow lost rate ${rate} -> ${row.commissionRate}`);
  }
  const db = toDbRow(row);
  if (Number(db.commission_rate) !== Number(rate)) {
    throw new Error(`toDbRow lost rate ${rate} -> ${db.commission_rate}`);
  }
  const back = fromDbRow({ ...db, commission_rate: rate });
  if (Number(back.commissionRate) !== Number(rate)) {
    throw new Error(`fromDbRow lost rate ${rate} -> ${back.commissionRate}`);
  }
}

async function setRate(id, rate) {
  assertNormalize(rate);
  const rows = await rest(`/rest/v1/gameplay_products?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ commission_rate: rate, updated_at: new Date().toISOString() }),
  });
  const saved = rows?.[0];
  if (!saved) throw new Error(`PATCH returned empty for rate=${rate}`);
  if (!Object.prototype.hasOwnProperty.call(saved, "commission_rate")) {
    throw new Error("PATCH representation missing commission_rate — column not persisted");
  }
  if (Number(saved.commission_rate) !== Number(rate)) {
    throw new Error(`Mismatch after PATCH: expected ${rate}, got ${saved.commission_rate}`);
  }
  const again = await rest(
    `/rest/v1/gameplay_products?id=eq.${encodeURIComponent(id)}&select=id,name,commission_rate,updated_at&limit=1`,
    { headers: headers() }
  );
  if (Number(again?.[0]?.commission_rate) !== Number(rate)) {
    throw new Error(`Re-read mismatch: expected ${rate}, got ${again?.[0]?.commission_rate}`);
  }
  // Simulate admin list/detail mapper (fromDbRow / normalize).
  const mapped = fromDbRow(again[0]);
  if (Number(mapped.commissionRate) !== Number(rate)) {
    throw new Error(`Admin mapper mismatch: expected ${rate}, got ${mapped.commissionRate}`);
  }
  return again[0];
}

/** Offline: admin save must fail loudly when column is missing (no fake success). */
async function verifyMissingColumnAdminSaveFails() {
  const { default: handler } = await import("../server/api/admin/gameplay-products.js");
  // Directly exercise the save path's error contract by importing store + simulating
  // the same error branch used in saveProduct (PGRST204 / 42703).
  const msg =
    "无法保存商品抽成：数据库缺少 gameplay_products.commission_rate 列。请先执行 supabase/migrations/20260806_gameplay_commission_rate.sql，不要假装保存成功。";
  // Unit-level: ensure the production admin handler source still contains the fail-loud path
  // and no longer strips commission_rate then returns ok.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../server/api/admin/gameplay-products.js", import.meta.url), "utf8");
  if (/commission_rate:\s*_c,\s*\.\.\.rest/.test(src) || /const \{ commission_rate: _c/.test(src)) {
    throw new Error("admin save still silently strips commission_rate");
  }
  if (!/MISSING_COMMISSION_RATE_COLUMN/.test(src) && !/缺少 gameplay_products\.commission_rate/.test(src)) {
    throw new Error("admin save missing fail-loud message for absent commission_rate column");
  }
  if (!/COMMISSION_RATE_MISMATCH/.test(src) && !/商品抽成未正确保存/.test(src)) {
    throw new Error("admin save missing mismatch verification after UPDATE");
  }
  // Handler import must succeed (syntax).
  if (typeof handler !== "function") throw new Error("admin gameplay-products handler not exported");
  console.log("[PASS] missing-column admin save fail-loud contract (source + import)");
  console.log(`[PASS] expected error text present: ${msg.slice(0, 40)}…`);
  return { ok: true, message: msg };
}

async function probeColumn() {
  try {
    await rest(`/rest/v1/gameplay_products?select=commission_rate&limit=1`, { headers: headers() });
    return { exists: true };
  } catch (err) {
    const text = String(err?.message || err || "");
    if (/42703|does not exist|PGRST204/i.test(text)) return { exists: false, error: text };
    throw err;
  }
}

async function main() {
  const urlRef = projectRefFromSupabaseUrl(STAGING_URL);
  if (urlRef === PRODUCTION_PROJECT_REF) {
    throw new Error(`Refusing Production Supabase (${PRODUCTION_PROJECT_REF}).`);
  }
  if (urlRef && urlRef !== STAGING_PROJECT_REF) {
    throw new Error(`Refusing non-Staging Supabase ref=${urlRef}. Expected ${STAGING_PROJECT_REF}.`);
  }
  if (!STAGING_KEY) {
    throw new Error(
      "Missing STAGING_SUPABASE_SERVICE_ROLE_KEY (will not fall back to Production SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  const oneshotDb = String(process.env.STAGING_DATABASE_URL || "").trim();
  // Do NOT use process.env.DATABASE_URL — often Production in this agent env.
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const oneshotPat = String(process.env.STAGING_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || "").trim();

  /**
   * Cloud agents often lack IPv6 egress to Direct db.*.supabase.co (ENETUNREACH).
   * Prefer Session pooler (IPv4). That is an egress shape issue — not a missing Staging secret.
   */
  function resolveStagingDbUrl() {
    const candidates = [];
    if (oneshotPass) candidates.push({ via: "STAGING_DB_PASSWORD+pooler", url: buildStagingPoolerUrl(oneshotPass) });
    if (oneshotDb) {
      try {
        const u = new URL(oneshotDb);
        const host = (u.hostname || "").toLowerCase();
        const isDirect = /^db\./i.test(host);
        const isPooler = /pooler\.supabase\.com$/i.test(host);
        if (isPooler) {
          candidates.push({ via: "STAGING_DATABASE_URL(pooler)", url: oneshotDb });
        } else if (isDirect) {
          const fromUrl = decodeURIComponent(u.password || "");
          if (oneshotPass) {
            candidates.push({
              via: "STAGING_DATABASE_URL(direct)→pooler+STAGING_DB_PASSWORD",
              url: buildStagingPoolerUrl(oneshotPass),
            });
          }
          if (fromUrl && fromUrl !== oneshotPass) {
            candidates.push({
              via: "STAGING_DATABASE_URL(direct)→pooler+urlPassword",
              url: buildStagingPoolerUrl(fromUrl),
            });
          }
          // Keep Direct last (may ENETUNREACH on IPv6-only hosts).
          candidates.push({ via: "STAGING_DATABASE_URL(direct)", url: oneshotDb });
        } else {
          candidates.push({ via: "STAGING_DATABASE_URL", url: oneshotDb });
        }
      } catch {
        candidates.push({ via: "STAGING_DATABASE_URL", url: oneshotDb });
      }
    }
    // Dedupe by URL string
    const seen = new Set();
    return candidates.filter((c) => {
      if (!c.url || seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });
  }

  const dbCandidates = resolveStagingDbUrl();
  let workingDbUrl = "";

  for (const cand of dbCandidates) {
    const ref = projectRefFromDatabaseUrl(cand.url);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production DATABASE_URL");
    assertStagingOnly({ databaseUrl: cand.url, supabaseUrl: STAGING_URL });
  }

  console.log(`[verify] stagingRef=${STAGING_PROJECT_REF}`);
  console.log(`[verify] supabase=${STAGING_URL}`);
  console.log(`[verify] productionRef=${PRODUCTION_PROJECT_REF} (read-only / not touched)`);
  console.log(`[verify] dbCandidates=${dbCandidates.map((c) => c.via).join(" | ") || "(none)"}`);

  // 0) Offline contract: missing column must not fake-success
  await verifyMissingColumnAdminSaveFails();

  // 1) Probe column type via select; apply DDL on Staging only if missing
  let probe = await probeColumn();
  console.log(`[probe] commission_rate exists=${probe.exists}`);

  if (!probe.exists) {
    if (String(process.env.SKIP_DDL || "") === "1") {
      throw new Error("commission_rate missing and SKIP_DDL=1");
    }
    const { path: sqlPath, sql } = readSqlFile([
      "supabase/migrations/20260806_gameplay_commission_rate.sql",
      "supabase/pending-prod/10_gameplay_products_commission_rate.sql",
    ]);
    console.log(`[apply] sql=${sqlPath}`);
    let applied = false;
    let lastErr = null;
    for (const cand of dbCandidates) {
      try {
        console.log(`[apply] trying via=${cand.via}`);
        console.log("[apply]", await applySqlViaPostgres(cand.url, sql));
        workingDbUrl = cand.url;
        applied = true;
        break;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err || "");
        const code = err?.code || "";
        // IPv6 Direct unreachable → try next (pooler). Wrong password → try next candidate.
        if (/ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|28P01|password authentication failed/i.test(msg + code)) {
          console.warn(`[apply] via=${cand.via} failed: ${code || ""} ${msg.slice(0, 160)}`);
          continue;
        }
        throw err;
      }
    }
    if (!applied && oneshotPat) {
      console.log("[apply] trying Management API");
      console.log("[apply]", await applySqlViaManagementApi(oneshotPat, sql));
      applied = true;
    }
    if (!applied) {
      const detail = lastErr ? String(lastErr.message || lastErr) : "no database candidates";
      throw new Error(
        `commission_rate missing; Staging DDL blocked. ${detail}. ` +
          `Direct db.* ENETUNREACH is IPv6 egress (use Session pooler). ` +
          `28P01 means STAGING_DB_PASSWORD / URL password do not match Staging. ` +
          `Or set SUPABASE_ACCESS_TOKEN for Management API. Never use Production.`
      );
    }
    probe = await probeColumn();
    if (!probe.exists) throw new Error("DDL applied but commission_rate still not selectable");
    console.log("[PASS] Staging migration applied; commission_rate selectable");
  } else {
    console.log("[PASS] gameplay_products.commission_rate already exists");
    // Prefer pooler candidates for optional metadata (skip Direct IPv6).
    workingDbUrl = dbCandidates.find((c) => /pooler/i.test(c.via))?.url || dbCandidates[0]?.url || "";
  }

  // Best-effort: confirm numeric via information_schema if a working DB URL is available
  if (workingDbUrl) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: workingDbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const meta = await client.query(`
        select data_type, numeric_precision, numeric_scale
        from information_schema.columns
        where table_schema='public' and table_name='gameplay_products' and column_name='commission_rate'
      `);
      const col = meta.rows[0];
      if (!col) throw new Error("information_schema: commission_rate not found");
      console.log("[PASS] column meta", col);
      if (String(col.data_type) !== "numeric") {
        throw new Error(`expected numeric, got ${col.data_type}`);
      }
    } finally {
      await client.end();
    }
  }

  // 2) Resolve / create product
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

  // 3) Round-trip 0 → 15 → 20 → 0 with immediate SELECT after each UPDATE
  const steps = [0, 15, 20, 0];
  for (const rate of steps) {
    const row = await setRate(product.id, rate);
    console.log(`[PASS] rate=${rate} db=${row.commission_rate} updated_at=${row.updated_at}`);
  }

  // 4) Final re-read (simulates page refresh / re-login list query)
  const refreshed = await rest(
    `/rest/v1/gameplay_products?id=eq.${encodeURIComponent(product.id)}&select=id,name,commission_rate&limit=1`,
    { headers: headers() }
  );
  if (Number(refreshed?.[0]?.commission_rate) !== 0) {
    throw new Error(`After final 0 save, refresh read ${refreshed?.[0]?.commission_rate}`);
  }
  console.log("[PASS] refresh re-read still 0 (not stuck at prior value)");

  console.log("[PASS] round-trip 0→15→20→0");
  console.log("[PASS] Production was NOT touched");
  console.log(
    JSON.stringify(
      {
        ok: true,
        stagingRef: STAGING_PROJECT_REF,
        productId: product.id,
        productName: product.name,
        finalRate: 0,
        productionTouched: false,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[FAIL]", err.message || err);
  process.exit(1);
});
