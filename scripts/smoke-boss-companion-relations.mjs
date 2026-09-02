/**
 * Unit / offline smoke for Boss ↔ Companion 直属关系.
 * Covers capability gate reuse (#128), history semantics, migration presence.
 * No Production touches.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasBossRole, hasCompanionRole, computeCapabilities } from "../server/api/_account-roles.js";
import {
  viewRelation,
  viewEvent,
  ACTIVE,
  UNBOUND,
  REPLACED,
} from "../server/api/_boss-companion-relations.js";

function section(n) {
  console.log(`\n== ${n} ==`);
}

section("migration file exists + RLS + unique active companion");
{
  const mig = fs.readFileSync(
    path.resolve("supabase/migrations/20260901_boss_companion_relations.sql"),
    "utf8"
  );
  assert.match(mig, /boss_companion_relations/);
  assert.match(mig, /boss_companion_relation_events/);
  assert.match(mig, /uq_boss_companion_relations_active_companion/);
  assert.match(mig, /enable row level security/i);
  assert.match(mig, /boss_id = auth\.uid\(\)/);
  assert.match(mig, /companion_id = auth\.uid\(\)/);
  assert.match(mig, /append|bind|rebind|unbind/i);
  assert.match(mig, /super_admin/);
  // Staging profiles.role is enum mcj_user_role — policies must cast ::text before coalesce
  assert.match(mig, /p\.role::text/);
  assert.match(mig, /coalesce\(p\.role::text,\s*''\)/);
  assert.match(mig, /bcre_admin_select/);
  assert.match(mig, /bcre_admin_insert/);
  assert.match(mig, /bcr_forbid_event_mutation/);
  assert.match(mig, /trg_bcre_no_update/);
  assert.match(mig, /trg_bcre_no_delete/);
  assert.doesNotMatch(mig, /create policy bcre_admin_all/);
  assert.doesNotMatch(mig, /referral_/);
}

section("#128 capability resolver reused — no second role engine in relations API");
{
  const core = fs.readFileSync(path.resolve("server/api/_boss-companion-relations.js"), "utf8");
  assert.match(core, /hasBossRole/);
  assert.match(core, /hasCompanionRole/);
  assert.match(core, /from "\.\/_account-roles\.js"/);
  assert.doesNotMatch(core, /profiles\.role\s*=/);
  // Must not mutate capability
  assert.doesNotMatch(core, /update.*role/i);
}

section("bind requires hasBoss + hasCompanion");
{
  assert.equal(hasBossRole({ role: "boss", status: "active" }), true);
  assert.equal(hasCompanionRole({ role: "companion" }, { companion: { id: "c1" } }), true);
  assert.equal(hasBossRole({ role: "companion", boss_uid: "MCJ00001" }), false);
  const caps = computeCapabilities({ role: "admin" });
  assert.equal(caps.hasBoss, false);
}

section("viewRelation / viewEvent shape");
{
  const rel = viewRelation(
    {
      id: "r1",
      boss_id: "b1",
      companion_id: "c1",
      status: ACTIVE,
      bound_at: "2026-09-01T00:00:00Z",
    },
    {
      boss: { id: "b1", display_name: "BossA", boss_uid: "MCJ00015", email: "a@x.com", role: "boss" },
      companion: { id: "c1", display_name: "PW1", email: "p@x.com", role: "companion" },
      companionProfile: { user_id: "c1", companion_code: "PW00001" },
    }
  );
  assert.equal(rel.boss.bossUid, "MCJ00015");
  assert.equal(rel.companion.companionCode, "PW00001");
  assert.equal(rel.status, "active");

  const ev = viewEvent(
    {
      id: "e1",
      action: "rebind",
      from_boss_id: "b1",
      to_boss_id: "b2",
      companion_id: "c1",
      created_at: "2026-09-01T01:00:00Z",
    },
    {
      fromBoss: { id: "b1", boss_uid: "MCJ00015", display_name: "A" },
      toBoss: { id: "b2", boss_uid: "MCJ00016", display_name: "B" },
    }
  );
  assert.equal(ev.action, "rebind");
  assert.equal(ev.fromBoss.bossUid, "MCJ00015");
  assert.equal(ev.toBoss.bossUid, "MCJ00016");
}

section("status constants cover bind history");
{
  assert.equal(ACTIVE, "active");
  assert.equal(UNBOUND, "unbound");
  assert.equal(REPLACED, "replaced");
}

section("API routes + UI entry points present");
{
  for (const f of [
    "server/api/admin/boss-companion-relations.js",
    "server/api/admin/boss-levels.js",
    "server/api/_boss-commission.js",
    "server/api/_boss-levels.js",
    "server/api/_boss-companion-invitations.js",
    "server/api/boss/direct-companions.js",
    "server/api/boss/companion-invitations.js",
    "server/api/companion/direct-boss.js",
    "server/api/companion/boss-invitations.js",
    "src/admin-boss-companion-relations.js",
    "src/admin-boss-levels.js",
    "my-direct-companions.html",
    "src/my-direct-companions.js",
    "scripts/apply-boss-companion-relations.mjs",
    "supabase/migrations/20260902_boss_commission_from_platform_fee.sql",
    "supabase/migrations/20260903_boss_levels_invites_safeguards.sql",
  ]) {
    assert.ok(fs.existsSync(path.resolve(f)), `missing ${f}`);
  }
  const adminHtml = fs.readFileSync(path.resolve("admin.html"), "utf8");
  assert.match(adminHtml, /boss-companion-relations/);
  assert.match(adminHtml, /boss-levels/);
  assert.match(adminHtml, /直属关系管理/);
  const mig3 = fs.readFileSync(
    path.resolve("supabase/migrations/20260903_boss_levels_invites_safeguards.sql"),
    "utf8"
  );
  assert.match(mig3, /uq_boss_commission_earnings_order_id/);
  assert.match(mig3, /mcj_forbid_boss_earnings_money_rewrite/);
  assert.match(mig3, /pin_mode/);
  assert.match(mig3, /boss_companion_invitations/);
  assert.match(mig3, /reason text/);
  const core = fs.readFileSync(path.resolve("server/api/_boss-companion-relations.js"), "utf8");
  assert.match(core, /requireAdminReason/);
  const mine = fs.readFileSync(path.resolve("mine.html"), "utf8");
  assert.match(mine, /my-direct-companions\.html/);
  assert.match(mine, /我的直属陪玩/);
  const wb = fs.readFileSync(path.resolve("src/companion-workbench.js"), "utf8");
  assert.match(wb, /pwDirectBossCard/);
  assert.match(wb, /\/api\/companion\/direct-boss/);
  assert.match(wb, /老板直属分成由平台抽成支付/);
  const vite = fs.readFileSync(path.resolve("vite.config.js"), "utf8");
  assert.match(vite, /my-direct-companions\.html/);
}

section("staging guard refuses production ref in apply script");
{
  const apply = fs.readFileSync(path.resolve("scripts/apply-boss-companion-relations.mjs"), "utf8");
  assert.match(apply, /cfccwysniduwkjskiqgy/);
  assert.match(apply, /jqfaknpmcnqwqvatrwgo/);
  assert.match(apply, /refusing Production|PRODUCTION_REF/);
  assert.match(apply, /STAGING_DB_PASSWORD|buildStagingPoolerUrl/);
}

section("#128 files untouched (capability rules / OTP / portal gate)");
{
  // Soft check: this branch should not rewrite capability semantics in _account-roles
  // (import-only is fine). We only assert the exports still exist.
  assert.equal(typeof hasBossRole, "function");
  assert.equal(typeof hasCompanionRole, "function");
  assert.equal(typeof computeCapabilities, "function");
}

section("local SQL validate script present");
{
  assert.ok(fs.existsSync(path.resolve("scripts/validate-boss-companion-relations-sql-local.mjs")));
}

console.log("\nOK smoke-boss-companion-relations");
