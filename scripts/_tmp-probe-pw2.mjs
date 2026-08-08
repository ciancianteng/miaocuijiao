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

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(q) {
  const res = await fetch(`${url}/rest/v1/${q}`, { headers: h });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return body;
}

const rows = await rest(
  "companion_profiles?companion_code=eq.PW00002&select=*"
);
const row = Array.isArray(rows) ? rows[0] : null;
console.log("=== companion_profiles PW00002 ===");
console.log(JSON.stringify(row, null, 2));

if (row) {
  const profiles = await rest(
    `profiles?id=eq.${encodeURIComponent(row.user_id)}&select=*`
  );
  console.log("\n=== profiles ===");
  console.log(JSON.stringify(profiles, null, 2));

  const media = await rest(
    `companion_media?companion_profile_id=eq.${encodeURIComponent(row.id)}&select=*&order=created_at.asc`
  );
  console.log("\n=== companion_media count", Array.isArray(media) ? media.length : 0);
  console.log(
    JSON.stringify(
      (media || []).map((m) => ({
        id: m.id,
        type: m.media_type,
        status: m.status,
        bucket: m.storage_bucket,
        path: m.storage_path,
        url: m.public_url || m.url || "",
      })),
      null,
      2
    )
  );

  try {
    const cert = await rest(
      `companion_cert_tag_assignments?companion_profile_id=eq.${encodeURIComponent(row.id)}&select=*`
    );
    console.log("\n=== cert assignments ===", JSON.stringify(cert, null, 2));
  } catch (e) {
    console.log("\n=== cert assignments error ===", e.message);
  }
}

const pub = await (
  await fetch(
    "https://meow-cuijiao-homepage-staging.vercel.app/api/public/companions?id=PW00002",
    { cache: "no-store" }
  )
).json();
console.log("\n=== staging public ===");
console.log(JSON.stringify(pub.companions?.[0] || pub, null, 2));
