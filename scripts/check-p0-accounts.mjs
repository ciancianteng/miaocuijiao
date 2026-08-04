/**
 * Quick auth check for P0 acceptance accounts.
 * node scripts/check-p0-accounts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const PASS = "McjTest@12345678";
const emails = [
  "boss.final.1785714993009@meow.test",
  "companion.idcard.1785715257525@meow.test",
  "companion.final.1785714993009@meow.test",
  "service.final.1785714993009@meow.test",
  "admin@meow.test",
];

for (const email of emails) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  console.log(email, r.ok ? "OK" : "FAIL", r.ok ? j.user?.id : JSON.stringify(j).slice(0, 220));
}
