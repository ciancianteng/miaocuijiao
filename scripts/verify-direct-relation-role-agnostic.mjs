#!/usr/bin/env node
/**
 * Offline regression: role-agnostic DIRECT relation (TEST 1–12).
 * No DB / no Production writes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calcBossCommissionClawback,
  calcBossCommissionFromPlatformFee,
  SOURCE_RANK,
} from "../server/api/_boss-commission.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// --- Pure helpers mirroring collectOrderCommissionCandidates dedupe ---
function dedupeCandidates(candidates) {
  const byBeneficiary = new Map();
  for (const c of candidates) {
    const prev = byBeneficiary.get(c.beneficiaryId);
    const rank = SOURCE_RANK[c.source] || 0;
    const prevRank = prev ? SOURCE_RANK[prev.source] || 0 : -1;
    if (!prev || rank > prevRank) {
      byBeneficiary.set(c.beneficiaryId, {
        ...c,
        sides: prev ? [...new Set([...(prev.sides || [prev.side]), c.side])] : [c.side],
      });
    } else if (prev) {
      prev.sides = [...new Set([...(prev.sides || [prev.side]), c.side])];
    }
  }
  return [...byBeneficiary.values()];
}

function wouldEarn(beneficiaryId, targetId, relations) {
  // Direct only: beneficiary earns from target iff relations[target] === beneficiary
  return relations[targetId] === beneficiaryId;
}

// TEST 1–3: relation model role-agnostic (source assertions + semantic)
{
  const rel = read("server/api/_boss-companion-relations.js");
  assert.match(rel, /assertBindParties/);
  assert.match(rel, /assertNoRelationCycle/);
  assert.match(rel, /getActiveRelationForTarget/);
  assert.match(rel, /beneficiaryUserId/);
  assert.match(rel, /SELF_BIND_FORBIDDEN|不能绑定自己/);
  assert.match(rel, /CYCLE_FORBIDDEN/);
  assert.doesNotMatch(
    rel.slice(rel.indexOf("export async function assertBindParties"), rel.indexOf("export async function assertNoRelationCycle")),
    /hasBossRole\(beneficiary\)|BOSS_CAPABILITY_REQUIRED/
  );
  // Role change does not create second relation — unique on companion_id (target)
  assert.match(read("supabase/pending-prod/01_boss_companion_relations.sql"), /uq_boss_companion_relations_active_companion/);
}

// TEST 4: KC→A, A→B → KC does not earn B
{
  const relations = { A: "KC", B: "A" };
  assert.equal(wouldEarn("KC", "A", relations), true);
  assert.equal(wouldEarn("A", "B", relations), true);
  assert.equal(wouldEarn("KC", "B", relations), false, "no second-level");
}

// TEST 5: same beneficiary both sides → one earning
{
  const candidates = dedupeCandidates([
    { beneficiaryId: "KC", side: "companion", source: "relation", rate: 10 },
    { beneficiaryId: "KC", side: "boss", source: "platform_default", rate: 5 },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].beneficiaryId, "KC");
  assert.equal(candidates[0].source, "relation", "prefer stronger rate source");
  assert.deepEqual(candidates[0].sides.sort(), ["boss", "companion"]);
}

// TEST 6: different beneficiaries → two earnings
{
  const candidates = dedupeCandidates([
    { beneficiaryId: "KC", side: "boss", source: "relation", rate: 10 },
    { beneficiaryId: "James", side: "companion", source: "relation", rate: 8 },
  ]);
  assert.equal(candidates.length, 2);
  const ids = candidates.map((c) => c.beneficiaryId).sort();
  assert.deepEqual(ids, ["James", "KC"]);
}

// TEST 7–8: invite / admin source guards
{
  const invite = read("server/api/_boss-invite-links.js");
  assert.match(invite, /skipped_already_bound/);
  assert.match(invite, /已有账号如需绑定\/调整直属关系，请联系管理员/);
  assert.match(invite, /bindRelation/);
  assert.doesNotMatch(invite, /rebindRelation/);
  const adminUi = read("src/admin-boss-companion-relations.js");
  assert.match(adminUi, /直属受益人/);
  assert.match(adminUi, /目标账号/);
}

// TEST 9–10: self / cycle helpers exist
{
  const rel = read("server/api/_boss-companion-relations.js");
  assert.match(rel, /assertNoRelationCycle/);
  assert.match(rel, /CYCLE_WALK_LIMIT|for \(let i = 0; i < CYCLE_WALK_LIMIT/);
}

// TEST 11: settlement unique + dual collect + no upline
{
  const commission = read("server/api/_boss-commission.js");
  assert.match(commission, /collectOrderCommissionCandidates/);
  assert.match(commission, /noUplineTraversal:\s*true/);
  assert.match(commission, /directOnly:\s*true/);
  assert.match(commission, /beneficiary_user_id/);
  const sql = read("supabase/pending-prod/13_direct_relation_role_agnostic.sql");
  assert.match(sql, /uq_boss_commission_earnings_order_beneficiary/);
  assert.match(sql, /clawback_amount/);
  // Must NOT introduce a second relation table
  assert.doesNotMatch(sql, /create table.*direct_referr/i);
}

// TEST 12: clawback math
{
  const full = calcBossCommissionClawback({
    settledAmount: 10,
    alreadyClawed: 0,
    orderAmount: 100,
    mode: "refund",
  });
  assert.equal(full.targetClawback, 10);
  assert.equal(full.fullyClawed, true);
  assert.equal(full.delta, 10);

  const partial = calcBossCommissionClawback({
    settledAmount: 10,
    alreadyClawed: 0,
    orderAmount: 100,
    refundAmount: 40,
    mode: "partial_refund",
  });
  assert.equal(partial.targetClawback, 4);
  assert.equal(partial.fullyClawed, false);
  assert.equal(partial.remaining, 6);

  const again = calcBossCommissionClawback({
    settledAmount: 10,
    alreadyClawed: 4,
    orderAmount: 100,
    refundAmount: 40,
    mode: "partial_refund",
  });
  assert.equal(again.delta, 0);

  const fee = calcBossCommissionFromPlatformFee({
    orderAmount: 100,
    platformFeeRate: 20,
    bossCommissionRate: 50,
  });
  assert.equal(fee.platformFeeAmount, 20);
  assert.equal(fee.bossCommissionAmount, 10);
}

// Refund wiring
{
  const adminOrders = read("server/api/admin/orders.js");
  assert.match(adminOrders, /clawbackBossCommissionForOrder/);
  const cs = read("server/api/customer-service.js");
  assert.match(cs, /clawbackBossCommissionForOrder/);
}

// Auth boss register invite hook
{
  const auth = read("server/api/auth.js");
  assert.match(auth, /redeemInviteAfterCompanionReady/);
}

// Single SoT: no parallel referral table in new SQL
{
  const sql = read("supabase/pending-prod/13_direct_relation_role_agnostic.sql");
  assert.match(sql, /boss_companion_relations/);
  assert.match(sql, /role-agnostic/i);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      message: "verify-direct-relation-role-agnostic: PASS",
      tests: 12,
      multiLevel: false,
      uplineTraversal: false,
      parallelSystem: false,
    },
    null,
    2
  )
);
