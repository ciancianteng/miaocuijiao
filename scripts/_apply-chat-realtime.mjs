/**
 * Apply chat realtime publication + soft-close test conversations.
 * Loads env from .env.local without printing secrets.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) return;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

loadEnv();
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260731_chat_realtime_and_test_cleanup.sql"),
  "utf8"
);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log("migration applied: realtime + test cleanup");
} finally {
  await client.end();
}
