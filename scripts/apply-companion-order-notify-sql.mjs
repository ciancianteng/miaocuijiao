/**
 * Apply companion order realtime + email log migration when DATABASE_URL is available.
 * Usage: node scripts/apply-companion-order-notify-sql.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "20260806_companion_order_realtime_notify.sql");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

async function main() {
  const fileEnv = {
    ...loadEnvFile(path.join(ROOT, ".env.local")),
    ...loadEnvFile(path.join(ROOT, ".env")),
  };
  const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL || "";
  if (!databaseUrl || databaseUrl === "[SENSITIVE]") {
    console.error("DATABASE_URL missing — skip SQL apply (code still uses poll + broadcast fallback).");
    process.exit(0);
  }
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log("OK applied", path.basename(SQL_PATH));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAIL", err?.message || err);
  process.exit(1);
});
