/**
 * Read-only Production readiness probe for PR-A settlement enablement.
 * Does NOT set SETTLEMENT_ENABLED. Does NOT mutate data.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-settlement-prod-readiness.mjs
 *
 * Exit 0 = required settlement schema present (Gate 0 gift objects + settlement DDL).
 * Exit 1 = missing required objects — do not enable SETTLEMENT_ENABLED.
 * Exit 2 = missing env.
 */
const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(
  /\/$/,
  ""
);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!url || !key) {
  console.error("Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

async function get(path, opts = {}) {
  const res = await fetch(`${url}${path}`, {
    method: opts.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(opts.headers || {}),
    },
    body: opts.body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function missingMsg(data) {
  return data?.message || data?.code || JSON.stringify(data).slice(0, 160);
}

const blocking = [];

function pass(name, detail) {
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  blocking.push(name);
}
function note(name, detail) {
  console.log(`NOTE  ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  console.log("PR-A settlement readiness probe (read-only)");
  console.log("Host:", url.replace(/^https:\/\//, "").split(".")[0] + ".…");

  console.log("\n[Gate 0] PR-B gift schema (required before proceeding PR-A policy)");
  for (const table of [
    "gifts",
    "gift_transactions",
    "companion_gift_wall",
    "reward_events",
    "gift_settings",
  ]) {
    const r = await get(`/rest/v1/${table}?select=*&limit=0`);
    if (r.status === 200) pass(`table ${table}`, "present");
    else fail(`table ${table}`, missingMsg(r.data));
  }
  const rpc = await get("/rest/v1/rpc/mcj_send_gift_tip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const rpcMissing =
    rpc.status === 404 || /Could not find the function|PGRST202/i.test(JSON.stringify(rpc.data));
  if (rpcMissing) fail("rpc mcj_send_gift_tip", missingMsg(rpc.data));
  else pass("rpc mcj_send_gift_tip", `reachable status=${rpc.status}`);

  console.log("\n[Checklist 1–2, 4] Settlement DDL");
  for (const col of [
    "platform_fee",
    "companion_income",
    "settlement_status",
    "settlement_note",
    "platform_fee_rate",
  ]) {
    const r = await get(`/rest/v1/orders?select=${col}&limit=1`);
    const miss =
      r.data?.code === "42703" || /does not exist|PGRST204/i.test(JSON.stringify(r.data));
    if (miss) fail(`orders.${col}`, "MISSING — apply pending-prod/02_…sql");
    else pass(`orders.${col}`, "PRESENT");
  }
  for (const col of ["paid_at", "paid_cat_food"]) {
    const r = await get(`/rest/v1/orders?select=${col}&limit=1`);
    const miss =
      r.data?.code === "42703" || /does not exist|PGRST204/i.test(JSON.stringify(r.data));
    if (miss) note(`orders.${col}`, "MISSING optional — apply 07 when ready");
    else pass(`orders.${col}`, "PRESENT");
  }

  const bce = await get("/rest/v1/boss_commission_earnings?select=*&limit=0");
  if (bce.status === 200) pass("table boss_commission_earnings", "present");
  else fail("table boss_commission_earnings", missingMsg(bce.data));

  console.log("\n[Checklist 3, 5, 6] Manual E2E (not automated here)");
  note("companion_income write", "complete non-test order with flag ON; assert transactions row");
  note("non-test parties", "boss+companion is_test_account=false");
  note("no skipped income", "settlement.skipped must be false; no [[SETTLEMENT_SKIPPED]]");

  console.log("\n---");
  if (blocking.length) {
    console.log(`BLOCKED (${blocking.length}): do NOT set SETTLEMENT_ENABLED=true`);
    for (const name of blocking) console.log(`  - ${name}`);
    process.exit(1);
  }
  console.log(
    "Schema gates OK. Finish manual checklist 3/5/6 + human sign-off before enabling flag."
  );
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
