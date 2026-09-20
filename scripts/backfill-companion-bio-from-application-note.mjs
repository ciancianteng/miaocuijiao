/**
 * One-time repair: move mis-mapped personal intro text from application_note → description.
 *
 * Rules:
 * - Only when description is empty
 * - Strip [AUTH_MODE:…] marker from application_note
 * - Remaining text becomes public bio (description)
 * - application_note kept as AUTH_MODE marker only (or emptied)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-companion-bio-from-application-note.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function stripAuthMode(raw) {
  return String(raw || "")
    .replace(/\[AUTH_MODE:(?:id_card|deposit)\]\s*/gi, "")
    .trim();
}

function authModeOnly(raw) {
  const m = String(raw || "").match(/\[AUTH_MODE:(id_card|deposit)\]/i);
  return m ? `[AUTH_MODE:${m[1].toLowerCase()}]` : "";
}

async function main() {
  const rows = await db(
    "companion_profiles",
    "?select=id,nickname,description,application_note&order=created_at.asc&limit=1000"
  );
  const list = Array.isArray(rows) ? rows : [];
  let migrated = 0;
  let skipped = 0;
  const results = [];

  for (const row of list) {
    const desc = String(row.description || "").trim();
    const noteRaw = String(row.application_note || "");
    const intro = stripAuthMode(noteRaw);
    const mode = authModeOnly(noteRaw);

    if (desc) {
      // Already has public bio — still clean application_note if it duplicates bio
      if (intro && intro === desc) {
        await db(`companion_profiles`, `?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            application_note: mode,
            updated_at: new Date().toISOString(),
          }),
        });
        results.push({ id: row.id, nickname: row.nickname, action: "clean_duplicate_note", bio: desc });
        migrated += 1;
        continue;
      }
      skipped += 1;
      continue;
    }

    if (!intro) {
      skipped += 1;
      continue;
    }

    await db(`companion_profiles`, `?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: intro,
        application_note: mode,
        updated_at: new Date().toISOString(),
      }),
    });
    migrated += 1;
    results.push({ id: row.id, nickname: row.nickname, action: "migrate_bio", bio: intro, note: mode || "" });
    console.log("OK", row.nickname || row.id, "→ bio:", intro.slice(0, 40));
  }

  console.log(JSON.stringify({ ok: true, total: list.length, migrated, skipped, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
