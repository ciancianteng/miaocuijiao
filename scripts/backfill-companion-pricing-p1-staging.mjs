#!/usr/bin/env node
/**
 * Staging-only: apply companion pricing P1 DDL + backfill companion_services.
 *
 * Refuses Production (jqfaknpmcnqwqvatrwgo). Never falls back to Production SUPABASE_*.
 *
 * Usage:
 *   STAGING_SUPABASE_URL=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
 *   STAGING_DATABASE_URL=… (or STAGING_DB_PASSWORD=…) \
 *   node scripts/backfill-companion-pricing-p1-staging.mjs
 *
 * Optional:
 *   SKIP_DDL=1          — skip migration SQL (columns must already exist)
 *   SKIP_BACKFILL=1     — only apply DDL / verify schema
 *   SKIP_QUARANTINE=1   — do not set allow_orders=false for no-level companions
 *   DRY_RUN=1           — print plan without writes
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
import { readGamePrices, parseServiceIds, splitGames, priceForGame } from "../server/api/_game-prices.js";

const SQL_CANDIDATES = [
  "supabase/migrations/20260908_companion_pricing_p1.sql",
  "server/api/_sql/20260908_companion_pricing_p1.sql",
];

function resolveStagingUrl() {
  const explicit = String(process.env.STAGING_SUPABASE_URL || "").trim();
  if (explicit) return explicit;
  const fallback = String(process.env.SUPABASE_URL || "").trim();
  if (projectRefFromSupabaseUrl(fallback) === STAGING_PROJECT_REF) return fallback;
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
const DRY_RUN = ["1", "true", "yes"].includes(String(process.env.DRY_RUN || "").toLowerCase());

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

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isApproved(status) {
  const s = String(status || "").toLowerCase();
  return s === "approved" || s === "active" || s === "通过";
}

async function probeSchema() {
  const levels = await rest("/rest/v1/companion_levels?select=id,min_price,base_price&limit=5");
  const missingBase = (levels || []).some((r) => !("base_price" in r));
  let servicesOk = true;
  let serviceSample = null;
  try {
    serviceSample = await rest(
      "/rest/v1/companion_services?select=id,price,proposed_price,source,base_price_snapshot,level_id_at_price&limit=1"
    );
  } catch (e) {
    if (/proposed_price|base_price_snapshot|PGRST/i.test(String(e.message || e))) servicesOk = false;
    else throw e;
  }
  return {
    levelsSample: levels,
    missingBase,
    servicesOk,
    serviceSample,
  };
}

/** Ensure base companion_services exists before P1 ALTER (Staging may lack marketplace DDL). */
const ENSURE_COMPANION_SERVICES_SQL = `
create table if not exists public.companion_services (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id),
  service_id uuid,
  service_name text not null default '',
  price numeric(12,2) not null default 0,
  pricing_unit text not null default '小时',
  specs jsonb not null default '[]'::jsonb,
  requires_game_id boolean not null default true,
  custom_fields jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  review_status text not null default 'approved',
  base_price_snapshot numeric(12,2),
  proposed_price numeric(12,2),
  proposed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  source text,
  level_id_at_price text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_companion_services_companion
  on public.companion_services (companion_id, enabled);
`;

function isDirectDbHost(dbUrl) {
  try {
    const host = new URL(String(dbUrl || "")).hostname.toLowerCase();
    return /^db\.[a-z0-9]+\.supabase\.co$/.test(host);
  } catch {
    return false;
  }
}

function resolveDdlDatabaseUrls() {
  const oneshotDb = String(process.env.STAGING_DATABASE_URL || "").trim();
  const oneshotPass = String(process.env.STAGING_DB_PASSWORD || "").trim();
  const urls = [];
  const push = (u, via) => {
    const s = String(u || "").trim();
    if (!s) return;
    if (urls.some((x) => x.url === s)) return;
    urls.push({ url: s, via });
  };
  // Prefer Session pooler on IPv4-capable hosts when password is available.
  // Direct db.*.supabase.co is often IPv6-only and fails with ENETUNREACH in Cloud Agents.
  if (oneshotPass) push(buildStagingPoolerUrl(oneshotPass), "pooler_password");
  if (oneshotDb && !isDirectDbHost(oneshotDb)) push(oneshotDb, "database_url");
  if (oneshotDb) push(oneshotDb, "database_url_direct");
  return urls;
}

async function applyDdl() {
  const oneshotPat = String(process.env.SUPABASE_ACCESS_TOKEN || process.env.STAGING_SUPABASE_ACCESS_TOKEN || "").trim();
  const candidates = resolveDdlDatabaseUrls();
  for (const c of candidates) {
    const ref = projectRefFromDatabaseUrl(c.url);
    if (ref === PRODUCTION_PROJECT_REF) throw new Error(`Refusing Production DATABASE_URL.`);
    assertStagingOnly({ supabaseUrl: STAGING_URL, databaseUrl: c.url });
  }
  if (!candidates.length) assertStagingOnly({ supabaseUrl: STAGING_URL });
  if (!candidates.length && !oneshotPat) {
    throw Object.assign(
      new Error(
        "Missing STAGING_DATABASE_URL / STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN for DDL apply."
      ),
      { status: 2 }
    );
  }
  const { path: sqlPath, sql: p1Sql } = readSqlFile(SQL_CANDIDATES);
  const sql = `${ENSURE_COMPANION_SERVICES_SQL}\n${p1Sql}`;
  console.log(`[ddl] sql=${sqlPath} (+ ensure companion_services)`);
  if (DRY_RUN) {
    console.log("[ddl] DRY_RUN skip apply");
    return { dryRun: true, sqlPath };
  }
  const errors = [];
  for (const c of candidates) {
    try {
      const result = await applySqlViaPostgres(c.url, sql);
      return { ...result, viaDetail: c.via };
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      errors.push(`${c.via}: ${msg.slice(0, 180)}`);
      console.warn(`[ddl] ${c.via} failed: ${msg.slice(0, 180)}`);
    }
  }
  if (oneshotPat) {
    return applySqlViaManagementApi(oneshotPat, sql);
  }
  throw new Error(
    `DDL apply failed (no Production fallback). Tried: ${errors.join(" | ") || "none"}. ` +
      `Need Session pooler STAGING_DATABASE_URL (aws-0-*.pooler.supabase.com / postgres.${STAGING_PROJECT_REF}) ` +
      `or matching STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN.`
  );
}

async function loadLevelsMap() {
  const rows = await rest("/rest/v1/companion_levels?select=id,code,level,min_price,base_price,is_enabled&order=sort_order.asc");
  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r.id), r);
    if (r.code) map.set(String(r.code), r);
    if (r.level != null) map.set(`lv${r.level}`, r);
  }
  return { rows: rows || [], map };
}

async function fetchAllCompanions() {
  const pageSize = 200;
  let from = 0;
  const all = [];
  for (;;) {
    const chunk = await rest(
      `/rest/v1/companion_profiles?select=user_id,level_id,price,game_prices,game,main_service,service_ids,tags,application_status,verification_status,allow_orders,pricing_unit&order=user_id.asc&limit=${pageSize}&offset=${from}`
    );
    if (!Array.isArray(chunk) || !chunk.length) break;
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function existingServices(companionId) {
  return (
    (await rest(
      `/rest/v1/companion_services?companion_id=eq.${encodeURIComponent(companionId)}&select=id,service_id,service_name,price,source,enabled,review_status`
    )) || []
  );
}

function buildServiceSeeds(companion, level) {
  const prices = readGamePrices(companion);
  const ids = parseServiceIds(companion.service_ids);
  const games = splitGames(companion.game || companion.main_service);
  const unit = companion.pricing_unit || "小时";
  const levelId = level ? String(level.id) : "";
  const base = money(level?.base_price ?? level?.basePrice);
  const seeds = [];
  const seen = new Set();

  const push = ({ serviceId = "", name = "", price = 0, source = "legacy_import" }) => {
    const nm = String(name || "").trim() || "服务";
    const key = `${String(serviceId || "").trim()}::${nm}`;
    if (seen.has(key)) return;
    seen.add(key);
    const p = money(price);
    const effective = p > 0 ? p : base;
    if (!(effective > 0)) return;
    seeds.push({
      companion_id: companion.user_id,
      service_id: serviceId || null,
      service_name: nm,
      price: effective,
      pricing_unit: unit,
      enabled: true,
      review_status: "approved",
      source: p > 0 ? source : "level_default",
      base_price_snapshot: base > 0 ? base : null,
      level_id_at_price: levelId || null,
      updated_at: new Date().toISOString(),
    });
  };

  if (ids.length) {
    ids.forEach((id, idx) => {
      const name =
        games[idx] ||
        Object.keys(prices).find((k) => k !== id && !/^[0-9a-f-]{36}$/i.test(k)) ||
        String(id);
      push({
        serviceId: id,
        name: /^[0-9a-f-]{36}$/i.test(String(name)) ? games[idx] || "游戏" : name,
        price: priceForGame(companion, name, id),
        source: "legacy_import",
      });
    });
  } else if (games.length) {
    games.forEach((g) => {
      push({ name: g, price: priceForGame(companion, g, ""), source: "legacy_import" });
    });
  } else if (Object.keys(prices).length) {
    Object.keys(prices).forEach((k) => {
      if (/^[0-9a-f-]{36}$/i.test(k)) return;
      push({ name: k, price: prices[k], source: "legacy_import" });
    });
  }

  if (!seeds.length && base > 0) {
    push({
      name: String(companion.game || companion.main_service || "默认服务").split(/[,，]/)[0] || "默认服务",
      price: base,
      source: "level_default",
    });
  }

  return seeds;
}

function findExisting(existing, seed) {
  const sid = String(seed.service_id || "");
  const name = String(seed.service_name || "");
  return (
    existing.find((r) => sid && String(r.service_id || "") === sid) ||
    existing.find((r) => name && String(r.service_name || "") === name) ||
    null
  );
}

async function backfill(levelsMap) {
  const companions = await fetchAllCompanions();
  const report = {
    companions: companions.length,
    upserted: 0,
    skippedExisting: 0,
    quarantined: 0,
    noPrice: 0,
    errors: [],
  };

  for (const cp of companions) {
    const approved = isApproved(cp.application_status) || isApproved(cp.verification_status);
    const level = cp.level_id ? levelsMap.map.get(String(cp.level_id)) : null;

    if (approved && !level) {
      report.quarantined += 1;
      if (!DRY_RUN && !["1", "true", "yes"].includes(String(process.env.SKIP_QUARANTINE || "").toLowerCase())) {
        if (cp.allow_orders !== false) {
          try {
            await rest(`/rest/v1/companion_profiles?user_id=eq.${encodeURIComponent(cp.user_id)}`, {
              method: "PATCH",
              headers: headers({ Prefer: "return=minimal" }),
              body: JSON.stringify({
                allow_orders: false,
                updated_at: new Date().toISOString(),
              }),
            });
          } catch (e) {
            report.errors.push(`${cp.user_id}: quarantine ${e.message || e}`);
          }
        }
      }
      continue;
    }

    if (!approved && cp.allow_orders !== true) continue;

    const seeds = buildServiceSeeds(cp, level);
    if (!seeds.length) {
      report.noPrice += 1;
      continue;
    }

    let existing = [];
    try {
      existing = await existingServices(cp.user_id);
    } catch (e) {
      report.errors.push(`${cp.user_id}: list services ${e.message || e}`);
      continue;
    }

    for (const seed of seeds) {
      const hit = findExisting(existing, seed);
      if (hit) {
        report.skippedExisting += 1;
        continue;
      }
      if (DRY_RUN) {
        report.upserted += 1;
        continue;
      }
      try {
        await rest("/rest/v1/companion_services", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(seed),
        });
        report.upserted += 1;
      } catch (e) {
        report.errors.push(`${cp.user_id}/${seed.service_name}: ${e.message || e}`);
      }
    }
  }

  return report;
}

async function verify(levels) {
  const badLevels = (levels.rows || []).filter((r) => !(money(r.base_price) > 0));
  const orderable = await rest(
    "/rest/v1/companion_profiles?allow_orders=eq.true&select=user_id,level_id&limit=500"
  );
  let missingServices = 0;
  for (const cp of orderable || []) {
    const rows = await existingServices(cp.user_id);
    const ok = (rows || []).some(
      (r) => r.enabled !== false && ["approved", "active"].includes(String(r.review_status || "").toLowerCase())
    );
    if (!ok) missingServices += 1;
  }
  return {
    levelsWithoutBasePrice: badLevels.map((r) => r.id),
    orderableChecked: (orderable || []).length,
    orderableMissingServices: missingServices,
    ok: !badLevels.length && missingServices === 0,
  };
}

async function main() {
  const urlRef = projectRefFromSupabaseUrl(STAGING_URL);
  if (urlRef === PRODUCTION_PROJECT_REF) {
    throw new Error(`拒绝：STAGING_SUPABASE_URL 指向 Production（${PRODUCTION_PROJECT_REF}）。`);
  }
  if (urlRef && urlRef !== STAGING_PROJECT_REF) {
    throw new Error(`拒绝：STAGING_SUPABASE_URL ref=${urlRef} 不是 Staging（${STAGING_PROJECT_REF}）。`);
  }
  if (!STAGING_KEY) {
    throw Object.assign(
      new Error("Missing STAGING_SUPABASE_SERVICE_ROLE_KEY (refuses Production SUPABASE_* fallback)."),
      { status: 2 }
    );
  }
  assertStagingOnly({ supabaseUrl: STAGING_URL });

  console.log(`[p1] stagingRef=${STAGING_PROJECT_REF} url=${STAGING_URL}`);
  console.log(`[p1] Production was NOT targeted.`);

  if (!["1", "true", "yes"].includes(String(process.env.SKIP_DDL || "").toLowerCase())) {
    const ddl = await applyDdl();
    console.log("[p1] ddl", ddl);
  } else {
    console.log("[p1] SKIP_DDL=1");
  }

  const probe = await probeSchema();
  console.log("[p1] schema probe", {
    missingBase: probe.missingBase,
    servicesOk: probe.servicesOk,
    levelsSample: (probe.levelsSample || []).map((r) => ({
      id: r.id,
      min_price: r.min_price,
      base_price: r.base_price,
    })),
  });
  if (probe.missingBase || !probe.servicesOk) {
    throw new Error("Schema incomplete after DDL — base_price or companion_services columns missing.");
  }

  const levels = await loadLevelsMap();
  // Ensure base_price backfilled via REST if SQL update missed (idempotent)
  for (const row of levels.rows) {
    if (!(money(row.base_price) > 0) && money(row.min_price) > 0 && !DRY_RUN) {
      await rest(`/rest/v1/companion_levels?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: headers({ Prefer: "return=minimal" }),
        body: JSON.stringify({ base_price: money(row.min_price), updated_at: new Date().toISOString() }),
      });
      row.base_price = money(row.min_price);
    }
  }

  let backfillReport = { skipped: true };
  if (!["1", "true", "yes"].includes(String(process.env.SKIP_BACKFILL || "").toLowerCase())) {
    backfillReport = await backfill(levels);
    console.log("[p1] backfill", backfillReport);
  } else {
    console.log("[p1] SKIP_BACKFILL=1");
  }

  const verification = await verify(levels);
  console.log("[p1] verify", verification);
  if (!verification.ok) {
    process.exitCode = 1;
    console.error("[p1] Staging verification FAILED");
  } else {
    console.log("[p1] Staging verification PASS");
  }
}

main().catch((err) => {
  console.error("[p1] failed:", err.message || err);
  process.exit(err.status === 2 ? 2 : 1);
});
