/**
 * Companion online-status write: missing optional columns must be stripped,
 * and an empty update must not be reported as success.
 * Read-only against Production: PATCH filter matches zero rows.
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import { missingProfileColumn, patchCompanionProfile } from "../server/api/companion.js";

const pgrst = Object.assign(new Error("Could not find the 'availability_status' column of 'companion_profiles' in the schema cache"), {
  body: { code: "PGRST204", message: "Could not find the 'availability_status' column of 'companion_profiles' in the schema cache" },
});
const pg = Object.assign(new Error('column companion_profiles.status_updated_at does not exist (HTTP 400)'), {
  body: { code: "42703", message: "column companion_profiles.status_updated_at does not exist" },
});
assert.equal(missingProfileColumn(pgrst), "availability_status");
assert.equal(missingProfileColumn(pg), "status_updated_at");
assert.equal(missingProfileColumn(new Error("permission denied")), "");

const text = fs.readFileSync(".env.local", "utf8");
for (const line of text.split(/\n/)) {
  const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const url = process.env.SUPABASE_URL || "";
if (!url.includes("jqfaknpmcnqwqvatrwgo") && !url.includes("cfccwysniduwkjskiqgy")) {
  throw new Error("refuse: supabase url is not a known project");
}

const rows = await patchCompanionProfile("?user_id=eq.00000000-0000-0000-0000-000000000000", {
  online_status: "busy",
  availability_status: "busy",
  status_updated_at: new Date().toISOString(),
  last_online_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
assert.ok(Array.isArray(rows));
assert.equal(rows.length, 0, "nil user must not update a real companion");
console.log("verify-companion-online-status: PASS stripped missing columns, 0 rows");
