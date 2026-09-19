#!/usr/bin/env node
/**
 * Staging dry-run for role-agnostic direct relation migration.
 * Default: READ ONLY. Never targets Production.
 *
 * Usage:
 *   node scripts/dryrun-direct-relation-role-agnostic.mjs
 *   node scripts/dryrun-direct-relation-role-agnostic.mjs --apply-staging   # explicit Staging write
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply-staging");

function loadEnv() {
  for (const rel of [".env.local", ".env", "../meow-cuijiao-homepage/.env.local"]) {
    try {
      const raw = readFileSync(path.resolve(root, rel), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* optional */
    }
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.STAGING_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "";
const ref = String(url).match(/\/\/([^.]+)/)?.[1] || "";

function assertNotProduction() {
  const prodRefs = String(process.env.MCJ_PRODUCTION_SUPABASE_REF || "jqfaknpmcnqwqvatrwgo")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (prodRefs.includes(ref)) {
    throw new Error(`Refusing to run against Production project ref=${ref}`);
  }
  if (/prod|production/i.test(process.env.MCJ_ENV || "") && !process.env.MCJ_ALLOW_STAGING_LABEL) {
    throw new Error("MCJ_ENV looks like production — refuse");
  }
}

async function probe(pathname) {
  const r = await fetch(url + pathname, {
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {
    j = t.slice(0, 240);
  }
  return { status: r.status, body: j };
}

if (!url || !key) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "offline",
        message: "No Supabase env — skipped live dry-run; SQL file present",
        sql: "supabase/pending-prod/13_direct_relation_role_agnostic.sql",
        apply,
      },
      null,
      2
    )
  );
  process.exit(0);
}

assertNotProduction();

const relations = await probe(
  "/rest/v1/boss_companion_relations?select=id,boss_id,companion_id,status&status=eq.active&limit=500"
);
const earnings = await probe(
  "/rest/v1/boss_commission_earnings?select=id,boss_id,beneficiary_user_id,order_id,status,clawback_amount&limit=5"
);

const active = Array.isArray(relations.body) ? relations.body : [];
const targetCounts = new Map();
for (const row of active) {
  const t = row.companion_id;
  targetCounts.set(t, (targetCounts.get(t) || 0) + 1);
}
const duplicateTargets = [...targetCounts.entries()].filter(([, n]) => n > 1);

const earningsMissingBeneficiary =
  earnings.status >= 400 &&
  /beneficiary_user_id|PGRST204|42703|schema cache/i.test(JSON.stringify(earnings.body));

const report = {
  ok: duplicateTargets.length === 0,
  mode: apply ? "APPLY_STAGING_REQUESTED" : "DRY_RUN",
  projectRef: ref,
  activeRelations: active.length,
  duplicateActiveTargets: duplicateTargets.length,
  earningsProbeStatus: earnings.status,
  needsBeneficiaryColumn: earningsMissingBeneficiary,
  sqlFile: "supabase/pending-prod/13_direct_relation_role_agnostic.sql",
  note: apply
    ? "Apply not automated here — run SQL in Staging SQL editor after review."
    : "Read-only. Pass --apply-staging only as a reminder; this script does not execute DDL.",
  productionModified: false,
};

console.log(JSON.stringify(report, null, 2));
if (duplicateTargets.length) process.exit(2);
