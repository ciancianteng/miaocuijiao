/**
 * Add companion_profiles.service_type and backfill defaults.
 * Does not print secrets.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.cwd());
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "20260731_companion_service_type.sql");

function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) throw new Error(".env.local missing");
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

function buildPoolerUrl(databaseUrl, supabaseUrl) {
  const parsed = new URL(databaseUrl);
  const password = decodeURIComponent(parsed.password || "");
  if (!password) throw new Error("DATABASE_URL password missing");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return (
    `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}` +
    `@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
  );
}

async function connectWithFallback() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const attempts = [{ label: "DATABASE_URL", url: databaseUrl }];
  if (supabaseUrl) {
    attempts.push({ label: "pooler-session-ap-southeast-1", url: buildPoolerUrl(databaseUrl, supabaseUrl) });
  }
  let lastErr = null;
  for (const attempt of attempts) {
    const client = new pg.Client({
      connectionString: attempt.url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      console.log("connected via", attempt.label);
      return client;
    } catch (error) {
      lastErr = error;
      console.log("connect failed", attempt.label, error.code || error.message);
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr || new Error("Unable to connect to database");
}

async function main() {
  loadEnv();
  if (!fs.existsSync(SQL_PATH)) throw new Error("migration sql missing");
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const client = await connectWithFallback();
  try {
    await client.query(sql);
    const summary = await client.query(`
      select service_type, count(*)::int as n
      from public.companion_profiles
      group by service_type
      order by n desc
    `);
    console.log("service_type distribution:", summary.rows);
    console.log("migration ok");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("FAILED", error.message || error);
  process.exit(1);
});
