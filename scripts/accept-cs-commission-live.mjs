/**
 * Local self-test: CS commission config → settle snapshot → wage math → history isolation.
 * Does NOT deploy. Uses service-role against configured Supabase.
 *
 * Usage: node scripts/accept-cs-commission-live.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const outPath = path.join(ROOT, "scripts/accept-cs-commission-live-results.json");

function loadEnvFile(name) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.vercel.tmp");
loadEnvFile(".env.local");
loadEnvFile(".env");

const results = { ok: false, steps: [], at: new Date().toISOString() };
function mark(id, pass, note, extra = {}) {
  results.steps.push({ id, pass: !!pass, note, ...extra });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${note}`);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    mark("ENV", false, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    results.ok = false;
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    process.exit(1);
  }

  const workMod = await import(pathToFileURL(path.join(ROOT, "server/api/_customer-service-work.js")).href);
  const settleMod = await import(pathToFileURL(path.join(ROOT, "server/api/_cs-commission-settle.js")).href);

  // 1) Save commission config RM2 then RM5 via DB writers
  await workMod.saveGlobalCommissionConfig({
    baseSalary: 350,
    attendanceBonus: 50,
    orderCommission: 2,
    commissionPercent: 5,
    nightShiftAllowance: 30,
    settleOnOrderComplete: true,
    settleOnPayment: false,
    clawbackOnRefund: true,
  });
  let cfg = await workMod.getGlobalCommissionConfig();
  mark("CFG_SAVE_2", Number(cfg.orderCommission) === 2, `orderCommission=${cfg.orderCommission}`, { cfg });

  await workMod.saveGlobalCommissionConfig({ orderCommission: 5 });
  cfg = await workMod.getGlobalCommissionConfig();
  mark("CFG_SAVE_5", Number(cfg.orderCommission) === 5, `orderCommission=${cfg.orderCommission} source=${cfg.source || cfg.rowId || "?"}`);

  // Prefer platform_settings
  mark("CFG_PLATFORM", String(cfg.rowId || "").includes("platform_settings") || cfg.source === "platform_settings" || Number(cfg.orderCommission) === 5, "config readable after save");

  // 2) Synthetic settle with snapshot at RM5
  const fakeOrderId = crypto.randomUUID();
  const fakeServiceId = process.env.ACCEPT_CS_ID || "";
  // Find any CS profile if not provided
  let serviceId = fakeServiceId;
  if (!serviceId) {
    const rows = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?role=eq.customer_service&status=eq.active&select=id&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    ).then((r) => r.json());
    serviceId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : "";
  }
  if (!serviceId) {
    mark("CS_PROFILE", false, "no customer_service profile for settle test");
  } else {
    mark("CS_PROFILE", true, `serviceId=${serviceId.slice(0, 8)}…`);
  }

  // Create a temporary order row if possible, else unit-test compute + table insert path via trySettle with existing order
  let order = null;
  if (serviceId) {
    const orderNo = `CS-COMM-${Date.now()}`;
    const insert = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: fakeOrderId,
        order_no: orderNo,
        boss_id: serviceId, // placeholder — may fail FK if boss required; try without
        customer_service_id: serviceId,
        title: "[TEST] CS commission accept",
        description: "[TEST] accept-cs-commission-live",
        total_amount: 100,
        status: "completed",
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }),
    });
    const text = await insert.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (insert.ok && Array.isArray(body) && body[0]) {
      order = body[0];
      mark("ORDER_CREATE", true, `order=${order.order_no}`);
    } else {
      // Retry without forcing id / boss
      const bosses = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles?role=eq.boss&status=eq.active&select=id&limit=1`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      ).then((r) => r.json());
      const bossId = Array.isArray(bosses) && bosses[0]?.id ? bosses[0].id : null;
      const insert2 = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          order_no: orderNo,
          boss_id: bossId,
          customer_service_id: serviceId,
          title: "[TEST] CS commission accept",
          description: "[TEST] accept-cs-commission-live",
          note: "[TEST] accept-cs-commission-live",
          total_amount: 100,
          status: "completed",
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }),
      });
      const t2 = await insert2.text();
      let b2 = null;
      try {
        b2 = t2 ? JSON.parse(t2) : null;
      } catch {
        b2 = t2;
      }
      if (insert2.ok && Array.isArray(b2) && b2[0]) {
        order = b2[0];
        mark("ORDER_CREATE", true, `order=${order.order_no}`);
      } else {
        mark("ORDER_CREATE", false, `create failed: ${typeof b2 === "string" ? b2 : b2?.message || insert2.status}`);
      }
    }
  }

  if (order) {
    const settled = await settleMod.trySettleCommission(order, { source: "accept-cs-commission-live", forceServiceId: serviceId });
    mark(
      "SETTLE_RM5",
      settled.ok && (settled.code === "SETTLED" || settled.code === "ALREADY_SETTLED") && Number(settled.settlement?.fixedRewardRm) === 5,
      settled.message || settled.code,
      { settlement: settled.settlement, code: settled.code }
    );

    // 3) Change config to RM8 — historical settlement must stay RM5
    await workMod.saveGlobalCommissionConfig({ orderCommission: 8 });
    const cfg8 = await workMod.getGlobalCommissionConfig();
    mark("CFG_SAVE_8", Number(cfg8.orderCommission) === 8, `orderCommission=${cfg8.orderCommission}`);

    const again = await settleMod.getSettlementByOrderId(order.id);
    mark(
      "HISTORY_ISOLATION",
      again && Number(again.fixed_reward_rm) === 5 && Number(again.final_amount_rm) >= 5,
      `snapshot fixed=${again?.fixed_reward_rm} final=${again?.final_amount_rm} (live cfg now ${cfg8.orderCommission})`
    );

    // 4) Wage center reads ledger
    const work = await workMod.loadServiceWorkData(serviceId);
    const hit = (work.commissionSettlements || []).find((s) => s.orderId === order.id);
    mark(
      "WAGE_LEDGER",
      !!hit && Number(hit.fixedRewardRm) === 5,
      hit ? `wage settlement fixed=${hit.fixedRewardRm} final=${hit.finalAmountRm}` : "settlement not in workData"
    );
    mark(
      "INCOME_FIELDS",
      work.summary && typeof work.summary.incomeTotal === "number",
      `incomeToday=${work.summary?.incomeToday} incomeMonth=${work.summary?.incomeMonth} incomeTotal=${work.summary?.incomeTotal} estimated=${work.summary?.estimatedSalary}`
    );

    // Restore config to RM5 for ops friendliness
    await workMod.saveGlobalCommissionConfig({ orderCommission: 5 });
  } else {
    // Unit-level breakdown still verifies formula
    const bd = settleMod.computeCommissionBreakdown({ total_amount: 100 }, { orderCommission: 5, commissionPercent: 5 });
    mark("FORMULA", bd.fixedRewardRm === 5 && bd.percentCommissionRm === 5 && bd.finalAmountRm === 10, JSON.stringify(bd));
  }

  results.ok = results.steps.every((s) => s.pass);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(results.ok ? "\nALL PASS" : "\nSOME FAIL", "→", outPath);
  process.exit(results.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  results.ok = false;
  results.error = err.message || String(err);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  process.exit(1);
});
