import { readFileSync, existsSync } from "fs";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnv();

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) {
  console.log(JSON.stringify({ error: "missing_supabase_env" }));
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: "Bearer " + key,
  Accept: "application/json",
};

const tables = [
  ["orders", "?select=id&limit=1"],
  ["conversations", "?select=id&limit=1"],
  ["messages", "?select=id&limit=1"],
  ["profiles", "?select=id&limit=1"],
  ["companion_profiles", "?select=id&limit=1"],
  ["customer_service_reports", "?select=id&limit=1"],
  ["staff_payrolls", "?select=id&limit=1"],
  ["wallets", "?select=id&limit=1"],
  ["wallet_transactions", "?select=id&limit=1"],
  ["transactions", "?select=id&limit=1"],
];

const out = [];
for (const [table, q] of tables) {
  const res = await fetch(base + "/rest/v1/" + table + q, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  out.push({
    table,
    http: res.status,
    ok: res.ok,
    message:
      body && typeof body === "object"
        ? body.message || body.error_description || body.hint || body.details || null
        : typeof body === "string"
          ? body.slice(0, 200)
          : null,
    code: (body && body.code) || null,
  });
}

// App-level: CS bootstrap + platform services
const login = await fetch("http://localhost:5190/api/customer-service", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    action: "login",
    account: "service@meow.test",
    password: "McjTest@12345678",
    remember: true,
  }),
});
const loginBody = await login.json();
const token = loginBody?.session?.token || "";
const boot = await fetch("http://localhost:5190/api/customer-service?action=bootstrap", {
  headers: { Accept: "application/json", "x-mcj-service-token": token },
});
const bootText = await boot.text();
let bootJson = null;
try {
  bootJson = JSON.parse(bootText);
} catch {
  bootJson = bootText;
}

console.log(
  JSON.stringify(
    {
      app_bootstrap: {
        http: boot.status,
        ok: bootJson && bootJson.ok,
        message: bootJson && bootJson.message ? bootJson.message : null,
      },
      failing_tables: out.filter((r) => !r.ok),
      all_tables: out,
    },
    null,
    2
  )
);
