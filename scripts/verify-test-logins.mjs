import fs from "node:fs";
import path from "node:path";

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

const BASE = (process.argv[2] || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const accounts = [
  ["boss", "boss.final.1785714993009@meow.test"],
  ["companion", "companion.idcard.1785715257525@meow.test"],
  ["companion2", "companion.final.1785714993009@meow.test"],
  ["cs", "service.final.1785714993009@meow.test"],
  ["cs_legacy", "service@meow.test"],
  ["admin", "admin@meow.test"],
  ["boss_legacy", "boss@meow.test"],
  ["companion_legacy", "companion@meow.test"],
];

async function tryLogin(label, email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS }),
  });
  const json = await res.json().catch(() => ({}));
  const ok = !!(json.ok || json.session?.accessToken);
  console.log(`${label}\t${email}\t${ok ? "LOGIN_OK" : "FAIL"}\t${json.message || res.status}`);
}

for (const [label, email] of accounts) {
  await tryLogin(label, email);
}
