import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function redactUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    return {
      protocol: x.protocol,
      hostname: x.hostname,
      port: x.port || null,
      pathname: x.pathname,
      username: x.username ? `len:${x.username.length}` : null,
      hasPassword: Boolean(x.password),
      passwordLen: x.password ? x.password.length : 0,
    };
  } catch (e) {
    return { parseError: String(e.message), rawPrefix: String(u).slice(0, 28) };
  }
}

function keyMeta(v) {
  if (!v) return null;
  return { len: v.length, prefix: v.slice(0, 6), suffix: v.slice(-4) };
}

const root = process.cwd();
const local = loadEnvFile(path.join(root, ".env.local"));
const env = loadEnvFile(path.join(root, ".env"));
const keys = [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "POSTGRES_URL",
  "DIRECT_URL",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_PASSWORD",
  "DB_PASSWORD",
];

const report = {
  files: {
    env: fs.existsSync(path.join(root, ".env")),
    envLocal: fs.existsSync(path.join(root, ".env.local")),
  },
  local: {},
  envfile: {},
};

for (const k of keys) {
  if (local[k] != null) {
    report.local[k] = /URL|PASSWORD|KEY/i.test(k) && k.includes("URL")
      ? redactUrl(local[k])
      : /PASSWORD|KEY/i.test(k)
        ? keyMeta(local[k])
        : redactUrl(local[k]) || keyMeta(local[k]);
  }
  if (env[k] != null) {
    report.envfile[k] = k.includes("URL") ? redactUrl(env[k]) : keyMeta(env[k]);
  }
}

const supabaseUrl = local.SUPABASE_URL || local.VITE_SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
let projectRef = null;
try {
  projectRef = new URL(supabaseUrl).hostname.split(".")[0];
} catch {
  projectRef = null;
}
report.projectRefFromSupabaseUrl = projectRef;
report.dbHost =
  (report.local.DATABASE_URL && report.local.DATABASE_URL.hostname) ||
  (report.envfile.DATABASE_URL && report.envfile.DATABASE_URL.hostname) ||
  null;
report.hostIncludesProjectRef = Boolean(
  report.dbHost && projectRef && String(report.dbHost).includes(projectRef)
);

const candidates = [];
if (projectRef) {
  candidates.push(`db.${projectRef}.supabase.co`);
  candidates.push(`aws-0-ap-southeast-1.pooler.supabase.com`);
  candidates.push(`${projectRef}.supabase.co`);
}
if (report.dbHost) candidates.unshift(report.dbHost);

const uniq = [...new Set(candidates.filter(Boolean))];
report.dns = {};
for (const host of uniq) {
  try {
    const addrs = await dns.lookup(host, { all: true });
    report.dns[host] = { ok: true, addresses: addrs.map((a) => a.address) };
  } catch (e) {
    report.dns[host] = { ok: false, code: e.code || null, message: e.message };
  }
}

// Probe REST health with service role (no secrets printed)
const serviceKey = local.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
if (supabaseUrl && serviceKey) {
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    report.restProbe = { status: r.status, ok: r.ok || r.status === 200 || r.status === 404 };
  } catch (e) {
    report.restProbe = { ok: false, message: e.message };
  }
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/services?select=id&limit=1`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    report.servicesTableProbe = {
      status: r.status,
      bodyPrefix: text.slice(0, 160),
    };
  } catch (e) {
    report.servicesTableProbe = { ok: false, message: e.message };
  }
}

console.log(JSON.stringify(report, null, 2));
