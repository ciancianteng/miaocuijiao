/**
 * Backup + soft-hide polluted rows in public.announcements.
 * Does NOT touch other business tables.
 *
 * Usage: node scripts/clean-polluted-announcements.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const f of [".env.local", ".env", ".env.vercel.tmp"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("FAIL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

function isPolluted(r) {
  const t = String(r.title || "");
  const c = String(r.content || "");
  const blob = `${t}\n${c}`;
  const audience = String(r.audience || "").toLowerCase();
  const kind = String(r.kind || "").toLowerCase();
  if (t.startsWith("[MCJ_PC]") || t.includes("[MCJ_GP]") || blob.includes("MCJ_CS_DOCK")) return true;
  if (audience === "system_internal") return true;
  if (kind === "forced") return true;
  if (/^\s*[{\[]/.test(c) && /"type"|"slug"|"draft"|gameplay|ad_slots|reward/i.test(c)) return true;
  return false;
}

async function sb(pathQuery, init = {}) {
  const res = await fetch(`${url}/rest/v1/${pathQuery}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

const rows = await sb(
  "announcements?select=*&order=created_at.desc&limit=500"
);
if (!Array.isArray(rows)) throw new Error("announcements list failed");

const polluted = rows.filter(isPolluted);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(ROOT, "scripts", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `announcements-polluted-${stamp}.json`);
fs.writeFileSync(
  backupPath,
  JSON.stringify({ table: "announcements", backedUpAt: new Date().toISOString(), count: polluted.length, rows: polluted }, null, 2),
  "utf8"
);
console.log(`BACKUP ${polluted.length} rows → ${backupPath}`);

// Migrate [MCJ_PC] stubs into platform_content_items when possible, then soft-hide.
let migrated = 0;
for (const row of polluted) {
  const title = String(row.title || "");
  if (!title.startsWith("[MCJ_PC]")) continue;
  let item = null;
  try {
    item = JSON.parse(row.content || "{}");
  } catch {
    item = null;
  }
  if (!item || !item.type) continue;
  const id = String(item.id || item.slug || row.id);
  const payload = {
    id,
    type: item.type,
    slug: item.slug || id,
    title: item.title || title.replace(/^\[MCJ_PC\][^:]+:/, "").trim() || id,
    status: item.status || "published",
    enabled: item.enabled !== false,
    sort: Number(item.sort ?? 100),
    draft: item.draft || {},
    published: item.published || item.draft || {},
    version: Number(item.version || 1) || 1,
    updated_at: new Date().toISOString(),
  };
  try {
    const existing = await sb(`platform_content_items?id=eq.${encodeURIComponent(id)}&select=id&limit=1`);
    if (Array.isArray(existing) && existing[0]) {
      await sb(`platform_content_items?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await sb("platform_content_items", {
        method: "POST",
        body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
      });
    }
    migrated += 1;
    console.log("MIGRATED", item.type, id);
  } catch (err) {
    console.warn("MIGRATE_SKIP", id, err.message);
  }
}

let cleaned = 0;
for (const row of polluted) {
  const patch = {
    is_active: false,
    audience: "system_internal",
    updated_at: new Date().toISOString(),
  };
  // Keep title/content intact for restore from backup.
  await sb(`announcements?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  cleaned += 1;
  console.log("SOFT_HIDE", row.id, String(row.title || "").slice(0, 80));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      table: "announcements",
      pollutedFound: polluted.length,
      cleaned,
      migratedToPlatformContent: migrated,
      backupPath,
      remainingVisible: rows.length - cleaned,
    },
    null,
    2
  )
);
