import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const list = await fetch(`${url}/rest/v1/announcements?or=(title.ilike.*MCJ_CS_DOCK_REWARD_SETTINGS*,content.ilike.*MCJ_CS_DOCK_REWARD_SETTINGS*)&select=id,title,is_active`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
}).then((r) => r.json());
console.log("found", list);
for (const row of Array.isArray(list) ? list : []) {
  const patched = await fetch(`${url}/rest/v1/announcements?id=eq.${row.id}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ is_active: false, audience: "system_internal" }),
  }).then((r) => r.json());
  console.log("patched", patched?.[0]?.id, patched?.[0]?.is_active);
}
