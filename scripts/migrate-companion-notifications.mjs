/**
 * Apply companion_notifications table migration.
 * Usage: node scripts/migrate-companion-notifications.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "20260804_companion_notifications.sql");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const envPath = path.join(ROOT, name);
    if (!fs.existsSync(envPath)) continue;
    for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line
        .slice(i + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

async function main() {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
  if (!dbUrl) throw new Error("DATABASE_URL missing");
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });
  await client.connect();
  try {
    await client.query(fs.readFileSync(SQL_PATH, "utf8"));
    const check = await client.query(`select to_regclass('public.companion_notifications') as t`);
    console.log("table", check.rows[0]);
    console.log("migration ok");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FAILED", e.message || e);
  process.exit(1);
});
