/**
 * Companion online-status write uses only online_status.
 * Production check: PATCH filter matches zero rows (no companion is updated).
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import { missingProfileColumn, patchCompanionProfile } from "../server/api/companion.js";

const source = fs.readFileSync(new URL("../server/api/companion.js", import.meta.url), "utf8");
const start = source.indexOf('if (action === "set_online_status")');
const end = source.indexOf('if (action === "update_profile")', start);
const block = source.slice(start, end);
assert.equal(block.includes("availability_status:"), false);
assert.equal(block.includes("status_updated_at"), false);
assert.equal(block.includes("last_online_at"), false);
assert.equal(block.includes("online_status: status"), true);
assert.match(block, /savedRow\.online_status/);
assert.match(block, /assertCompanionBusinessAccess/);
assert.match(block, /assertCompanionOrderEligibility/);

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
  updated_at: new Date().toISOString(),
});
assert.ok(Array.isArray(rows));
assert.equal(rows.length, 0, "nil user must not update a real companion");
for (const status of ["online", "busy", "offline"]) {
  const again = await patchCompanionProfile("?user_id=eq.00000000-0000-0000-0000-000000000000", {
    online_status: status,
    updated_at: new Date().toISOString(),
  });
  assert.equal(again.length, 0);
}
console.log("verify-companion-online-status: PASS online_status only, 0 rows");
