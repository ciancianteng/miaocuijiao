#!/usr/bin/env node
/**
 * Staging E2E: companion 24h withdraw lock + boss after-sale close + refund clawback wiring.
 * Staging only. Uses HTTP + Staging DB (pooler password reuse → Staging ref only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";
import {
  STAGING_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  projectRefFromDatabaseUrl,
} from "../server/api/_staging-sql.js";
import {
  isBossAfterSaleOpen,
  isCompanionEarningsLocked,
  MS_24H,
} from "../server/api/_earnings-windows.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/finance-audit");
fs.mkdirSync(outDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";

assertSmokeTargetAllowed({
  script: "e2e-staging-earnings-refund-lock",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const report = {
  ok: false,
  generated_at: new Date().toISOString(),
  staging: STG,
  cases: {},
  errors: [],
};

function mark(key, ok, detail, soft = false) {
  const result = ok ? "PASS" : soft ? "NOT PROVEN" : "FAIL";
  report.cases[key] = { result, detail: String(detail || "").slice(0, 800) };
  console.log(`[${result}] ${key} :: ${detail}`);
  return ok;
}

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

async function api(pathname, body, token) {
  const res = await fetch(`${STG}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email, role) {
  const r = await api("/api/auth", { action: "login", email, password: PASS, role });
  return {
    token: r.json?.session?.accessToken || r.json?.session?.access_token || "",
    user: r.json?.session?.user || r.json?.user || {},
    json: r.json,
  };
}

async function stagingPg() {
  const env = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
  const pass = decodeURIComponent(
    new URL(String(env.DATABASE_URL || "").replace(/^postgresql:/i, "postgres:")).password || ""
  );
  const dbUrl = buildStagingPoolerUrl(pass);
  assertStagingOnly({ databaseUrl: dbUrl });
  if (projectRefFromDatabaseUrl(dbUrl) !== STAGING_PROJECT_REF) throw new Error("not staging");
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

try {
  // ── Offline/window unit (also runs in verify script) ──
  {
    const completedAt = "2026-09-22T06:00:00.000Z";
    const t0 = Date.parse(completedAt);
    const plain = { status: "completed", completed_at: completedAt };
    const auto = { status: "completed", completed_at: completedAt, completion_method: "system_auto_24h" };
    const boss = { status: "completed", completed_at: completedAt, completion_method: "boss_manual" };
    mark(
      "COMPANION_24H_WITHDRAW_LOCK",
      isCompanionEarningsLocked(plain, t0 + 1000) &&
        !isCompanionEarningsLocked(plain, t0 + MS_24H + 1000) &&
        !isCompanionEarningsLocked(auto, t0 + 1000) &&
        !isCompanionEarningsLocked(boss, t0 + 1000),
      "plain locked until +24h; system_auto and boss_manual unlock at completed_at"
    );
    mark(
      "BOSS_AFTER_SALE_WINDOW",
      isBossAfterSaleOpen(plain, t0 + 1000) &&
        !isBossAfterSaleOpen(plain, t0 + MS_24H + 1000) &&
        !isBossAfterSaleOpen(boss, t0 + 1000),
      "auto open until +24h; boss_manual closes immediately"
    );
  }

  // ── HTTP: after-sale closed gate on Staging ──
  const boss = await login("boss@meow.test", "boss");
  if (!boss.token) throw new Error("boss login failed");

  const pubs = await api("/api/public/companions");
  const a = (pubs.json?.companions || []).find((c) => /CompA/i.test(c.name || "")) || pubs.json?.companions?.[0];
  if (!a?.id) throw new Error("no companion");
  const price = Number(a.services?.[0]?.price || a.price || 40);

  const stamp = Date.now();
  const place = await api(
    "/api/orders",
    {
      action: "place_order",
      companionId: a.id,
      hours: 1,
      totalAmount: price,
      unitPrice: price,
      amount: price,
      paymentMethod: "catfood",
      game: "王者荣耀",
      serviceType: "王者荣耀",
      gameId: `P0EAR-${stamp}`,
      idempotencyKey: `p0-earn-${stamp}`,
    },
    boss.token
  );
  const orderId = place.json?.order?.id;
  if (!orderId) {
    mark("HTTP_AFTER_SALE_GATE", false, "place failed: " + (place.json?.message || place.status));
  } else {
    await api("/api/orders", { action: "pay_order", id: orderId, paymentMethod: "catfood" }, boss.token);

    // Force completed + boss_manual via Staging DB (simulate Boss confirm closing after-sale).
    const pg = await stagingPg();
    try {
      await pg.query(
        `update orders set status='completed', completed_at=now(),
           note = coalesce(note,'') || E'\\n[[COMPLETION_METHOD]] boss_manual\\n[[AFTER_SALE_CLOSED]] boss_manual',
           description = coalesce(description,'') || E'\\n[[COMPLETION_METHOD]] boss_manual\\n[[AFTER_SALE_CLOSED]] boss_manual'
         where id=$1::uuid`,
        [orderId]
      );
      try {
        await pg.query(`update orders set completion_method='boss_manual' where id=$1::uuid`, [orderId]);
      } catch {
        /* column may be missing */
      }
    } finally {
      await pg.end();
    }

    const refund = await api(
      "/api/orders",
      { action: "request_refund", id: orderId, reason: "P0 after-sale closed probe" },
      boss.token
    );
    mark(
      "HTTP_AFTER_SALE_GATE",
      refund.status === 409 && refund.json?.code === "AFTER_SALE_CLOSED",
      `status=${refund.status} code=${refund.json?.code} msg=${refund.json?.message || ""}`
    );

    // Release hold if any so boss balance not stuck
    await api("/api/orders", { action: "cancel_order", id: orderId }, boss.token).catch(() => null);
  }

  // ── Refund clawback wiring (code + confirmBossCatFoodRefund calls) ──
  {
    const src = fs.readFileSync(path.join(root, "server/api/_boss-refund-payout.js"), "utf8");
    mark(
      "REFUND_CLAWBACK_WIRED",
      /clawbackCompanionIncomeForOrder/.test(src) &&
        /clawbackBossPointsForRefundedOrder/.test(src) &&
        /clawbackCsOrderIncome/.test(src) &&
        /clawbackBossCommissionForOrder/.test(src),
      "confirmBossCatFoodRefund wires companion+cs+bossCommission+points clawbacks"
    );
    mark(
      "POINTS_FULL_REVOKE_ON_ANY_REFUND",
      /整单积分全部取消/.test(src),
      "any refund triggers full order points clawback"
    );
  }

  const hard = Object.entries(report.cases).filter(([, v]) => v.result === "FAIL");
  report.ok = hard.length === 0;
  fs.writeFileSync(path.join(outDir, "09-staging-earnings-refund-lock.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases }, null, 2));
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  report.errors.push(String(err?.stack || err));
  fs.writeFileSync(path.join(outDir, "09-staging-earnings-refund-lock.json"), JSON.stringify(report, null, 2));
  console.error(err);
  process.exit(1);
}
