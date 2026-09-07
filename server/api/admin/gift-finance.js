/**
 * Admin gift / tipping / recharge accounting reports (PR179).
 */
import { companionDb, isMissingRelation } from "../_companion-media-store.js";
import {
  giftTransactionsToCsv,
  listGiftTransactionsAdmin,
  mapGiftIncomeRow,
  summarizeGiftIncome,
} from "../_gift-income.js";

function json(res, status, data) {
  return res.status(status).json(data);
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function csvEscapeRow(cols) {
  return cols.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

function rechargeToCsv(rows) {
  const header = [
    "payment_no",
    "created_at",
    "boss_id",
    "amount_rm",
    "cat_food",
    "bonus_cat_food",
    "status",
    "method",
    "paid_at",
    "submitted_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows || []) {
    lines.push(
      csvEscapeRow([
        r.paymentNo || r.payment_no || "",
        r.createdAt || r.created_at || "",
        r.bossId || r.boss_id || "",
        r.amountRm ?? r.amount_rm ?? r.amount ?? "",
        r.catFood ?? r.cat_food_amount ?? "",
        r.bonusCatFood ?? r.bonus_cat_food ?? "",
        r.status || "",
        r.method || r.payment_method || "",
        r.paidAt || r.paid_at || "",
        r.submittedAt || r.submitted_at || "",
      ])
    );
  }
  return `\ufeff${lines.join("\n")}`;
}

async function loadProfileMap(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  try {
    const rows = await companionDb(
      "profiles",
      `?id=in.(${unique.map((id) => `"${id}"`).join(",")})&select=id,display_name,boss_uid,role&limit=500`
    );
    for (const p of rows || []) {
      map.set(p.id, p);
    }
  } catch {
    /* optional */
  }
  return map;
}

async function loadCompanionCodeMap(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  try {
    const rows = await companionDb(
      "companion_profiles",
      `?user_id=in.(${unique.map((id) => `"${id}"`).join(",")})&select=user_id,public_id,nickname&limit=500`
    );
    for (const c of rows || []) {
      map.set(c.user_id, c);
    }
  } catch {
    /* optional */
  }
  return map;
}

export default async function handler(req, res) {
  try {
    await (await import("../_admin-auth.js")).requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  try {
    const action = String(
      req.method === "GET" ? req.query?.action || "summary" : (await parseBody(req)).action || "summary"
    ).trim();
    const query = req.method === "GET" ? req.query || {} : await parseBody(req);
    const limit = Math.min(1000, Math.max(1, Number(query.limit || 300)));

    if (action === "summary" || action === "bootstrap") {
      const [giftRows, rechargeRows] = await Promise.all([
        listGiftTransactionsAdmin({ limit: 500 }),
        companionDb(
          "payment_orders",
          `?or=(type.eq.recharge,kind.eq.recharge,purpose.eq.recharge)&order=created_at.desc&limit=200`
        ).catch((e) => (isMissingRelation(e) ? [] : [])),
      ]);
      // Fallback: all recent payment_orders if type filter unsupported
      let recharges = rechargeRows;
      if (!recharges.length) {
        recharges = await companionDb("payment_orders", "?order=created_at.desc&limit=200").catch(() => []);
        recharges = (recharges || []).filter((r) =>
          /recharge|充值/i.test(String(r.type || r.kind || r.purpose || r.product_name || "recharge"))
        );
      }
      const giftSummary = summarizeGiftIncome(giftRows);
      const companionEarnings = {};
      for (const tx of giftRows || []) {
        const cid = tx.receiver_companion_id;
        if (!cid) continue;
        if (!companionEarnings[cid]) companionEarnings[cid] = { companionId: cid, income: 0, count: 0, gross: 0 };
        companionEarnings[cid].income += money(tx.companion_income);
        companionEarnings[cid].gross += money(tx.gross_cat_food);
        companionEarnings[cid].count += 1;
      }
      const topCompanions = Object.values(companionEarnings)
        .sort((a, b) => b.income - a.income)
        .slice(0, 20);
      const codeMap = await loadCompanionCodeMap(topCompanions.map((c) => c.companionId));
      return json(res, 200, {
        ok: true,
        giftSummary,
        rechargeCount: (recharges || []).length,
        rechargePaidCount: (recharges || []).filter((r) => /paid|approved|confirmed|success/i.test(String(r.status || ""))).length,
        topCompanions: topCompanions.map((c) => ({
          ...c,
          income: Math.round(c.income * 100) / 100,
          gross: Math.round(c.gross * 100) / 100,
          companionCode: codeMap.get(c.companionId)?.public_id || "",
          companionName: codeMap.get(c.companionId)?.nickname || "",
        })),
      });
    }

    if (action === "gift_transactions" || action === "export_gift_transactions") {
      const rows = await listGiftTransactionsAdmin({
        limit,
        from: String(query.from || ""),
        to: String(query.to || ""),
      });
      const senderIds = rows.map((r) => r.sender_boss_id);
      const companionIds = rows.map((r) => r.receiver_companion_id);
      const [profiles, companions] = await Promise.all([
        loadProfileMap(senderIds.concat(companionIds)),
        loadCompanionCodeMap(companionIds),
      ]);
      const mapped = rows.map((r) => {
        const sender = profiles.get(r.sender_boss_id) || {};
        const cp = companions.get(r.receiver_companion_id) || {};
        const receiverProfile = profiles.get(r.receiver_companion_id) || {};
        return mapGiftIncomeRow(r, {
          senderName: sender.display_name || "",
          senderCode: sender.boss_uid || "",
          companionCode: cp.public_id || "",
          companionName: cp.nickname || receiverProfile.display_name || "",
        });
      });
      if (action === "export_gift_transactions") {
        return json(res, 200, {
          ok: true,
          csv: giftTransactionsToCsv(mapped),
          filename: `gift-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
          count: mapped.length,
        });
      }
      return json(res, 200, { ok: true, transactions: mapped, count: mapped.length });
    }

    if (action === "recharge_records" || action === "export_recharge_records") {
      let rows = await companionDb("payment_orders", `?order=created_at.desc&limit=${limit}`).catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      });
      rows = (rows || []).filter((r) =>
        /recharge|充值/i.test(String(r.type || r.kind || r.purpose || r.product_name || r.channel || "recharge"))
      );
      const mapped = rows.map((r) => ({
        paymentNo: r.payment_no || r.id,
        createdAt: r.created_at,
        bossId: r.boss_id || r.user_id || "",
        amountRm: money(r.amount_rm ?? r.amount),
        catFood: money(r.cat_food_amount ?? r.paid_cat_food ?? r.cat_food),
        bonusCatFood: money(r.bonus_cat_food ?? 0),
        status: r.status || "",
        method: r.payment_method || r.method || "",
        paidAt: r.paid_at || r.credited_at || "",
        submittedAt: r.submitted_at || "",
      }));
      if (action === "export_recharge_records") {
        return json(res, 200, {
          ok: true,
          csv: rechargeToCsv(mapped),
          filename: `recharge-records-${new Date().toISOString().slice(0, 10)}.csv`,
          count: mapped.length,
        });
      }
      return json(res, 200, { ok: true, recharges: mapped, count: mapped.length });
    }

    if (action === "companion_earnings" || action === "export_companion_earnings") {
      const rows = await listGiftTransactionsAdmin({ limit: 1000 });
      const byCompanion = new Map();
      for (const tx of rows || []) {
        const cid = tx.receiver_companion_id;
        if (!cid) continue;
        const cur = byCompanion.get(cid) || {
          companionId: cid,
          transactionCount: 0,
          totalGross: 0,
          totalIncome: 0,
          totalCommission: 0,
        };
        cur.transactionCount += 1;
        cur.totalGross += money(tx.gross_cat_food);
        cur.totalIncome += money(tx.companion_income);
        cur.totalCommission += money(tx.platform_commission_amount);
        byCompanion.set(cid, cur);
      }
      const list = [...byCompanion.values()].sort((a, b) => b.totalIncome - a.totalIncome);
      const codeMap = await loadCompanionCodeMap(list.map((x) => x.companionId));
      const mapped = list.map((x) => ({
        ...x,
        totalGross: Math.round(x.totalGross * 100) / 100,
        totalIncome: Math.round(x.totalIncome * 100) / 100,
        totalCommission: Math.round(x.totalCommission * 100) / 100,
        companionCode: codeMap.get(x.companionId)?.public_id || "",
        companionName: codeMap.get(x.companionId)?.nickname || "",
      }));
      if (action === "export_companion_earnings") {
        const header = ["companion_id", "companion_code", "companion_name", "tx_count", "gross", "income", "commission"];
        const lines = [header.join(",")].concat(
          mapped.map((r) =>
            csvEscapeRow([
              r.companionId,
              r.companionCode,
              r.companionName,
              r.transactionCount,
              r.totalGross,
              r.totalIncome,
              r.totalCommission,
            ])
          )
        );
        return json(res, 200, {
          ok: true,
          csv: `\ufeff${lines.join("\n")}`,
          filename: `companion-gift-earnings-${new Date().toISOString().slice(0, 10)}.csv`,
          count: mapped.length,
        });
      }
      return json(res, 200, { ok: true, companions: mapped, count: mapped.length });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, {
        ok: false,
        message: "请先执行 supabase/pending-prod/06_gift_tipping_system_v1.sql / companion-marketplace.sql",
        detail: String(error?.message || "").slice(0, 240),
      });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "礼物财务报表异常" });
  }
}
