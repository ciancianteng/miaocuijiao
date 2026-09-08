#!/usr/bin/env node
/**
 * Staging-only backfill for companion pricing P1.
 * Refuses Production. Does not run unless STAGING_* credentials are set.
 *
 * STAGING_SUPABASE_URL=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
 *   node scripts/backfill-companion-pricing-p1-staging.mjs
 *
 * Optional: APPLY_DDL=1 to apply supabase/migrations/20260908_companion_pricing_p1.sql via Management API / DB URL
 *           DRY_RUN=1 to only report
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  projectRefFromSupabaseUrl,
} from "../server/api/_staging-sql.js";
import { parseServiceIds, readGamePrices, splitGames } from "../server/api/_game-prices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const DRY = String(process.env.DRY_RUN || "") === "1";

function headers(extra = {}) {
  return {
    apikey: STAGING_KEY,
    Authorization: `Bearer ${STAGING_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function rest(pathname, init = {}) {
  const res = await fetch(`${STAGING_URL.replace(/\/$/, "")}${pathname}`, init);
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
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const ref = projectRefFromSupabaseUrl(STAGING_URL);
  if (ref === PRODUCTION_PROJECT_REF) throw new Error("Refusing Production");
  if (ref && ref !== STAGING_PROJECT_REF) throw new Error(`Refusing non-staging ref=${ref}`);
  if (!STAGING_KEY) {
    throw new Error(
      "Missing STAGING_SUPABASE_SERVICE_ROLE_KEY (will not fall back to Production SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  // Probe base_price column
  try {
    await rest(`/rest/v1/companion_levels?select=id,base_price,min_price&limit=1`, { headers: headers() });
  } catch (err) {
    throw new Error(
      `companion_levels.base_price missing or unreadable. Apply supabase/migrations/20260908_companion_pricing_p1.sql on Staging first. (${err.message})`
    );
  }

  const levels = await rest(`/rest/v1/companion_levels?select=id,code,name,base_price,min_price&order=sort_order.asc`, {
    headers: headers(),
  });
  const missingBase = (levels || []).filter((l) => l.base_price == null);
  if (missingBase.length) {
    if (DRY) {
      console.log(`[DRY] would backfill base_price for ${missingBase.length} levels`);
    } else {
      for (const l of missingBase) {
        await rest(`/rest/v1/companion_levels?id=eq.${encodeURIComponent(l.id)}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ base_price: money(l.min_price) }),
        });
      }
      console.log(`[OK] backfilled base_price for ${missingBase.length} levels`);
    }
  } else {
    console.log(`[OK] all ${levels.length} levels have base_price`);
  }

  // Probe companion_services columns
  try {
    await rest(`/rest/v1/companion_services?select=id,source,proposed_price,base_price_snapshot&limit=1`, {
      headers: headers(),
    });
  } catch (err) {
    throw new Error(`companion_services P1 columns missing. Apply P1 migration on Staging. (${err.message})`);
  }

  const companions = await rest(
    `/rest/v1/companion_profiles?select=id,user_id,price,game_prices,game,main_service,service_ids,level_id,level_name,allow_orders,application_status,verification_status&or=(application_status.eq.approved,verification_status.eq.approved)&limit=500`,
    { headers: headers() }
  );

  let created = 0;
  let suspended = 0;
  for (const cp of companions || []) {
    const levelKey = String(cp.level_id || "").trim();
    const level =
      (levels || []).find((l) => l.id === levelKey) ||
      (levels || []).find((l) => String(l.code) === String(cp.level_name || "").trim());
    if (!level) {
      if (cp.allow_orders !== false) {
        suspended += 1;
        if (!DRY) {
          await rest(`/rest/v1/companion_profiles?id=eq.${encodeURIComponent(cp.id)}`, {
            method: "PATCH",
            headers: headers(),
            body: JSON.stringify({ allow_orders: false }),
          });
        }
      }
      continue;
    }

    const existing = await rest(
      `/rest/v1/companion_services?companion_id=eq.${encodeURIComponent(cp.user_id)}&select=id&limit=5`,
      { headers: headers() }
    );
    if (Array.isArray(existing) && existing.length) continue;

    const prices = readGamePrices(cp);
    const ids = parseServiceIds(cp.service_ids);
    const games = splitGames(cp.game || cp.main_service);
    const entries = [];
    if (ids.length) {
      ids.forEach((id, idx) => {
        const name = games[idx] || String(id);
        const price = money(prices[id] || prices[name] || cp.price || level.base_price);
        entries.push({ service_id: /^[0-9a-f-]{36}$/i.test(id) ? id : null, service_name: name, price });
      });
    } else if (games.length) {
      games.forEach((name) => {
        entries.push({
          service_id: null,
          service_name: name,
          price: money(prices[name] || cp.price || level.base_price),
        });
      });
    } else if (money(cp.price) > 0 || money(level.base_price) > 0) {
      entries.push({
        service_id: null,
        service_name: String(cp.main_service || cp.game || "默认服务"),
        price: money(cp.price || level.base_price),
      });
    }

    if (!entries.length) {
      suspended += 1;
      if (!DRY && cp.allow_orders !== false) {
        await rest(`/rest/v1/companion_profiles?id=eq.${encodeURIComponent(cp.id)}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ allow_orders: false }),
        });
      }
      continue;
    }

    const rows = entries.map((e) => ({
      companion_id: cp.user_id,
      service_id: e.service_id,
      service_name: e.service_name,
      price: e.price > 0 ? e.price : money(level.base_price),
      pricing_unit: "小时",
      enabled: true,
      review_status: "approved",
      source: "legacy_import",
      base_price_snapshot: money(level.base_price),
      level_id_at_price: level.id,
      proposed_price: null,
      review_note: "",
    }));

    if (DRY) {
      created += rows.length;
      continue;
    }
    await rest(`/rest/v1/companion_services`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(rows),
    });
    created += rows.length;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: DRY,
        levels: levels.length,
        companions: (companions || []).length,
        servicesCreated: created,
        suspendedNoLevelOrPrice: suspended,
        note: "No Production writes. Pending custom prices not created.",
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`[FAIL] ${err.message || err}`);
  process.exit(1);
});
