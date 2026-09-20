/**
 * Offline acceptance for companion public ID allocate / ensure semantics.
 * No network, no Production writes.
 */
import assert from "node:assert/strict";
import {
  allocateCompanionCode,
  ensureCompanionPublicCode,
  ensureCompanionPublicCodes,
  resolveCompanionPublicCode,
  customerFacingCompanionId,
  formatCompanionCode,
  isDbUuid,
} from "../server/api/_account-codes.js";

function makeDb(seedRows = []) {
  const rows = new Map(seedRows.map((r) => [r.id, { ...r }]));
  const calls = { patch: [], rpc: [] };
  async function dbFn(table, query = "", init) {
    if (table === "rpc/mcj_allocate_companion_code" || String(table).includes("mcj_allocate")) {
      calls.rpc.push(table);
      throw new Error("rpc unavailable in offline test");
    }
    if (table !== "companion_profiles") throw new Error("unexpected table " + table);
    const method = String(init?.method || "GET").toUpperCase();
    if (method === "PATCH") {
      const idMatch = String(query).match(/id=eq\.([^&]+)/);
      const id = idMatch ? decodeURIComponent(idMatch[1]) : "";
      const body = JSON.parse(init.body || "{}");
      calls.patch.push({ id, body });
      const cur = rows.get(id) || { id };
      const next = { ...cur, ...body };
      rows.set(id, next);
      return [next];
    }
    // list scan for allocateCodeByScan
    if (/select=companion_code/.test(query)) {
      return [...rows.values()]
        .filter((r) => r.companion_code)
        .sort((a, b) => String(b.companion_code).localeCompare(String(a.companion_code)));
    }
    return [...rows.values()];
  }
  return { dbFn, rows, calls };
}

async function main() {
  // 1) resolve existing PW — never UUID
  assert.equal(resolveCompanionPublicCode({ companion_code: "PW00042" }), "PW00042");
  assert.equal(resolveCompanionPublicCode({ companion_code: "pw00007" }), "PW00007");
  assert.ok(!isDbUuid("PW00001"));
  assert.ok(isDbUuid("550e8400-e29b-41d4-a716-446655440000"));
  assert.equal(
    customerFacingCompanionId({ companion_code: "550e8400-e29b-41d4-a716-446655440000" }),
    ""
  );
  assert.equal(customerFacingCompanionId({ companion_code: "PW00009", id: "550e8400-e29b-41d4-a716-446655440000" }), "PW00009");

  // 2) allocate produces unique PW codes via scan fallback
  const { dbFn, rows, calls } = makeDb([
    { id: "a", companion_code: "PW00003" },
    { id: "b", companion_code: "PW00001" },
  ]);
  const c1 = await allocateCompanionCode(dbFn);
  assert.match(c1, /^PW\d{5}$/);
  assert.notEqual(c1, "PW00001");
  assert.notEqual(c1, "PW00003");
  // next after max existing (3) => 4
  assert.equal(c1, "PW00004");

  // 3) ensure does NOT rewrite existing PW
  const existing = { id: "keep", companion_code: "PW00088", companion_uid: 100088 };
  const before = existing.companion_code;
  const got = await ensureCompanionPublicCode(dbFn, existing);
  assert.equal(got, "PW00088");
  assert.equal(existing.companion_code, before);
  assert.equal(calls.patch.filter((p) => p.id === "keep" && p.body.companion_code !== "PW00088").length, 0);

  // 4) ensure allocates for missing code and persists
  const fresh = { id: "new1", companion_code: null };
  const allocated = await ensureCompanionPublicCode(dbFn, fresh);
  assert.match(allocated, /^PW\d{5}$/);
  assert.equal(fresh.companion_code, allocated);
  assert.ok(calls.patch.some((p) => p.id === "new1" && p.body.companion_code === allocated));
  assert.equal(rows.get("new1").companion_code, allocated);

  // 5) batch ensure: skip rows that already have codes; fill missing
  const batch = [
    { id: "x1", companion_code: "PW00010" },
    { id: "x2", companion_code: "" },
    { id: "x3", companion_code: "PW00011" },
  ];
  // Persist already-coded rows into mock DB so scan uniqueness is realistic.
  rows.set("x1", { ...batch[0] });
  rows.set("x3", { ...batch[2] });
  await ensureCompanionPublicCodes(dbFn, batch);
  assert.equal(batch[0].companion_code, "PW00010");
  assert.equal(batch[2].companion_code, "PW00011");
  assert.match(batch[1].companion_code, /^PW\d{5}$/);
  assert.notEqual(batch[1].companion_code, "PW00010");
  assert.notEqual(batch[1].companion_code, "PW00011");
  rows.set("x2", { id: "x2", companion_code: batch[1].companion_code });

  // 6) uniqueness across sequential allocates
  const codes = new Set(
    [...rows.values()].map((r) => r.companion_code).filter(Boolean)
  );
  for (let i = 0; i < 5; i++) {
    const n = await allocateCompanionCode(dbFn);
    assert.ok(!codes.has(n), "duplicate " + n);
    rows.set("alloc-" + i, { id: "alloc-" + i, companion_code: n });
    codes.add(n);
  }

  console.log(JSON.stringify({ ok: true, formatSample: formatCompanionCode(12), allocatedSample: allocated, uniqueCount: codes.size }, null, 2));
  console.log("verify-companion-public-id-offline: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
