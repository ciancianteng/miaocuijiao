/**
 * Read-only: probe which Supabase pooler connection works.
 * Does not write files. Does not print password.
 */
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import pg from "pg";

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

const env = loadEnvFile(path.join(process.cwd(), ".env.local"));
const projectRef = new URL(env.SUPABASE_URL || env.VITE_SUPABASE_URL).hostname.split(".")[0];
const parsed = new URL(env.DATABASE_URL);
const password = decodeURIComponent(parsed.password || "");

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

const results = [];
let winner = null;

for (const region of regions) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  if (!(await hostOk(host))) {
    results.push({ ok: false, label: `dns-${region}`, code: "ENOTFOUND", message: "host dns missing" });
    continue;
  }
  const forms = [
    {
      label: `pooler-session-${region}`,
      url: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres`,
    },
    {
      label: `pooler-transaction-${region}`,
      url: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:6543/postgres`,
    },
  ];
  for (const f of forms) {
    const r = await tryConnect(f.url, f.label);
    results.push(r);
    if (r.ok) {
      winner = { label: f.label, host, port: f.label.includes("transaction") ? 6543 : 5432, userMode: "postgres.PROJECT_REF" };
      break;
    }
  }
  if (winner) break;
}

console.log(JSON.stringify({ projectRef, oldHost: parsed.hostname, results, winner }, null, 2));
process.exit(winner ? 0 : 2);
