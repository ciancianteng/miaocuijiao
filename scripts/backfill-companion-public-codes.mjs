/**
 * Backfill companion_profiles.companion_code (PW#####) for all rows missing a public ID.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-companion-public-codes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allocateCompanionCode,
  ensureCompanionPublicCode,
  resolveCompanionPublicCode,
} from "../server/api/_account-codes.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_URL || process.env.PROD_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function db(table, query = "", init = {}) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(body?.message || body?.hint || text || `HTTP ${res.status}`);
  return body;
}

async function main() {
  const rows = await db(
    "companion_profiles",
    "?select=id,user_id,nickname,companion_code,companion_uid,verification_status,application_status&order=created_at.asc&limit=1000"
  );
  const list = Array.isArray(rows) ? rows : [];
  console.log(`Loaded ${list.length} companion_profiles`);
  let assigned = 0;
  let skipped = 0;
  let failed = 0;
  const results = [];

  for (const row of list) {
    const before = resolveCompanionPublicCode(row);
    if (before && String(row.companion_code || "").trim()) {
      skipped += 1;
      results.push({ id: row.id, nickname: row.nickname, code: before, action: "keep" });
      continue;
    }
    try {
      const code = await ensureCompanionPublicCode(db, row);
      if (!code) {
        // Fallback allocate + patch
        const alloc = await allocateCompanionCode(db);
        if (alloc) {
          await db(`companion_profiles`, `?id=eq.${encodeURIComponent(row.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ companion_code: alloc, updated_at: new Date().toISOString() }),
          });
          row.companion_code = alloc;
        }
      }
      const after = resolveCompanionPublicCode(row);
      if (after) {
        assigned += 1;
        results.push({ id: row.id, nickname: row.nickname, code: after, action: "assign" });
        console.log("OK", row.nickname || row.id, "→", after);
      } else {
        failed += 1;
        results.push({ id: row.id, nickname: row.nickname, code: "", action: "fail" });
        console.warn("FAIL empty", row.id);
      }
    } catch (err) {
      failed += 1;
      results.push({ id: row.id, nickname: row.nickname, error: err.message, action: "error" });
      console.error("ERR", row.id, err.message);
    }
  }

  console.log(JSON.stringify({ ok: true, total: list.length, assigned, skipped, failed, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
