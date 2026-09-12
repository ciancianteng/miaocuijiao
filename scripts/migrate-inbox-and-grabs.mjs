import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const FILES = [
  "supabase/migrations/20260731_companion_inbox.sql",
  "supabase/migrations/20260731_order_grabs_fix.sql",
];

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    for (const rel of FILES) {
      const sql = fs.readFileSync(path.join(ROOT, rel), "utf8");
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log("applied", rel);
    }
    const check = await client.query(`
      select to_regclass('public.companion_notification_reads') as reads,
             to_regclass('public.order_grabs') as grabs
    `);
    console.log(check.rows[0]);
    await client.query(`notify pgrst, 'reload schema'`);
    console.log("ok");
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FAILED", e.message || e);
  process.exit(1);
});
