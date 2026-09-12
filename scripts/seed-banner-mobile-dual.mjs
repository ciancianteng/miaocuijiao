/**
 * Seed dedicated mobile image on the main/active banner for dual-image verification.
 * Usage: node scripts/seed-banner-mobile-dual.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

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

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`missing ${key}`);
    process.exit(1);
  }
}

const bucket = String(process.env.SUPABASE_CONTENT_BUCKET || process.env.SUPABASE_BANNER_BUCKET || "banners").trim() || "banners";
const mobilePath = path.join(ROOT, "scripts", "_banner-staging-mobile.png");
if (!fs.existsSync(mobilePath)) {
  console.error("missing scripts/_banner-staging-mobile.png");
  process.exit(1);
}

const bytes = fs.readFileSync(mobilePath);
const objectPath = `homepage/seed-mobile-dual-${Date.now()}.png`;
const uploadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
const uploadRes = await fetch(uploadUrl, {
  method: "POST",
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "image/png",
    "x-upsert": "true",
  },
  body: bytes,
});
if (!uploadRes.ok) {
  console.error("upload failed", await uploadRes.text());
  process.exit(1);
}
const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const pick = await c.query(
  `select id, title, image_url, mobile_image_url, is_main, is_active
   from public.banners
   order by is_main desc, is_active desc, sort_order asc nulls last, updated_at desc nulls last
   limit 1`
);
if (!pick.rowCount) {
  console.error("no banners");
  await c.end();
  process.exit(1);
}
const id = pick.rows[0].id;
await c.query(
  `update public.banners
   set mobile_image_url = $2,
       mobile_crop_meta = coalesce(mobile_crop_meta, '{}'::jsonb),
       updated_at = now()
   where id = $1`,
  [id, publicUrl]
);
const after = await c.query(
  `select id, title, left(image_url, 72) as desktop, left(mobile_image_url, 72) as mobile, is_main, is_active
   from public.banners where id = $1`,
  [id]
);
console.log(JSON.stringify({ ok: true, banner: after.rows[0], mobileUrl: publicUrl }, null, 2));
await c.end();
