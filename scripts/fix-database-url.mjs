/**
 * Find a working Supabase Postgres connection (pooler) and rewrite DATABASE_URL.
 * Never prints password.
 */
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import pg from "pg";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function loadEnvFile(filePath) {
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

function upsertEnvKey(filePath, key, value) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (k !== key) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) next.push(`${key}=${value}`);
  fs.writeFileSync(filePath, next.join("\n"), "utf8");
}

async function hostOk(host) {
  try {
    await dns.lookup(host);
    return true;
  } catch {
    return false;
  }
}

async function tryConnect(connectionString, label) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const r = await client.query("select current_database() as db, current_user as usr");
    await client.end();
    return { ok: true, label, db: r.rows[0].db, usr: r.rows[0].usr };
  } catch (e) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return { ok: false, label, code: e.code || null, message: String(e.message || e).slice(0, 180) };
  }
}

const env = loadEnvFile(ENV_PATH);
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const oldDbUrl = env.DATABASE_URL || "";
if (!oldDbUrl) throw new Error("DATABASE_URL missing in .env.local");
const parsed = new URL(oldDbUrl);
const password = decodeURIComponent(parsed.password || "");
if (!password) throw new Error("DATABASE_URL has no password");

const regions = [
  "ap-southeast-1",
  "ap-northeast-1",
  "ap-south-1",
  "us-east-1",
  "us-west-1",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-2",
];

const candidates = [];
// Legacy direct (known broken DNS here, but keep for completeness)
candidates.push({
  label: "direct-db",
  url: `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`,
});

for (const region of regions) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  if (!(await hostOk(host))) continue;
  // Session pooler (5432) with pooler username
  candidates.push({
    label: `pooler-session-${region}`,
    url: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres`,
  });
  // Transaction pooler (6543)
  candidates.push({
    label: `pooler-transaction-${region}`,
    url: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:6543/postgres`,
  });
  // Sometimes username is plain postgres on pooler
  candidates.push({
    label: `pooler-session-plainuser-${region}`,
    url: `postgresql://postgres:${encodeURIComponent(password)}@${host}:5432/postgres`,
  });
}

const results = [];
let winner = null;
for (const c of candidates) {
  const r = await tryConnect(c.url, c.label);
  results.push(r);
  if (r.ok) {
    winner = c;
    break;
  }
}

console.log(
  JSON.stringify(
    {
      projectRef,
      oldHost: parsed.hostname,
      oldPort: parsed.port,
      tried: results,
      winner: winner ? winner.label : null,
    },
    null,
    2
  )
);

if (!winner) {
  process.exit(2);
}

upsertEnvKey(ENV_PATH, "DATABASE_URL", winner.url);
// Keep a human-readable note host for diagnostics
upsertEnvKey(ENV_PATH, "DATABASE_URL_MODE", winner.label);
console.log("UPDATED_DATABASE_URL_MODE", winner.label);
