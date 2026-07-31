import {
  hasPopularityDb,
  isMissingRelation,
  loadRules,
  money,
  nowIso,
  recomputePopularity,
  viewRules,
} from "../_popularity.js";
import { restUrl, serviceHeaders, supabaseJson, writeAdminLog } from "../_wallet.js";

function json(res, status, data) {
  return res.status(status).json(data);
}
function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || "").trim() || "admin";
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

async function db(table, query = "", init) {
  return supabaseJson(restUrl(table, query), {
    method: init?.method || "GET",
    headers: serviceHeaders(init?.headers || {}),
    body: init?.body,
  });
}

export default async function handler(req, res) {
  if (!hasPopularityDb()) return json(res, 503, { ok: false, message: "数据库未配置" });
  try {
    if (req.method === "GET") {
      const action = String(req.query.action || "bootstrap").trim();
      if (action === "bootstrap" || action === "rules") {
        const rules = await loadRules();
        const anomalies = await db(
          "popularity_anomaly_logs",
          "?order=created_at.desc&limit=50"
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)));
        const adjustments = await db(
          "popularity_adjustments",
          "?order=created_at.desc&limit=50"
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)));
        const rewards = await db(
          "popularity_reward_records",
          "?order=created_at.desc&limit=50"
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)));
        const history = await db(
          "popularity_history",
          "?order=created_at.desc&limit=30"
        ).catch((e) => (isMissingRelation(e) ? [] : Promise.reject(e)));
        return json(res, 200, {
          ok: true,
          rules: viewRules(rules),
          rawRules: rules._missing ? null : rules,
          anomalies: anomalies || [],
          adjustments: adjustments || [],
          rewards: rewards || [],
          history: history || [],
        });
      }
      return json(res, 400, { ok: false, message: "未知操作" });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "").trim();
    const role = roleFrom(req);

    if (action === "save_rules") {
      const payload = {
        id: 1,
        completed_order_points: money(body.completedOrderPoints ?? body.completed_order_points ?? 20),
        five_star_points: money(body.fiveStarPoints ?? body.five_star_points ?? 15),
        four_star_points: money(body.fourStarPoints ?? body.four_star_points ?? 8),
        gift_points_per_10_cat_food: money(body.giftPointsPer10CatFood ?? body.gift_points_per_10_cat_food ?? 1),
        online_hour_points: money(body.onlineHourPoints ?? body.online_hour_points ?? 1),
        streak_day_points: money(body.streakDayPoints ?? body.streak_day_points ?? 3),
        favorite_points: money(body.favoritePoints ?? body.favorite_points ?? 2),
        cancel_penalty: money(body.cancelPenalty ?? body.cancel_penalty ?? 10),
        complaint_penalty: money(body.complaintPenalty ?? body.complaint_penalty ?? 30),
        reject_penalty: money(body.rejectPenalty ?? body.reject_penalty ?? 5),
        timeout_penalty: money(body.timeoutPenalty ?? body.timeout_penalty ?? 3),
        gift_daily_cap_points: money(body.giftDailyCapPoints ?? body.gift_daily_cap_points ?? 50),
        display_count: Math.max(1, Number(body.displayCount ?? body.display_count ?? 10)),
        show_score: body.showScore !== false && body.show_score !== false && body.showScore !== "false",
        show_orders: body.showOrders !== false && body.show_orders !== false && body.showOrders !== "false",
        show_gifts: body.showGifts !== false && body.show_gifts !== false && body.showGifts !== "false",
        show_online: body.showOnline === true || body.show_online === true || body.showOnline === "true",
        enable_weekly: body.enableWeekly !== false && body.enable_weekly !== false && body.enableWeekly !== "false",
        enable_monthly: body.enableMonthly !== false && body.enable_monthly !== false && body.enableMonthly !== "false",
        enable_total: body.enableTotal !== false && body.enable_total !== false && body.enableTotal !== "false",
        enable_daily: body.enableDaily === true || body.enable_daily === true || body.enableDaily === "true",
        enabled: body.enabled !== false && body.enabled !== "false",
        rewards_enabled: body.rewardsEnabled === true || body.rewards_enabled === true || body.rewardsEnabled === "true",
        reward_top1: money(body.rewardTop1 ?? body.reward_top1 ?? 100),
        reward_top2: money(body.rewardTop2 ?? body.reward_top2 ?? 60),
        reward_top3: money(body.rewardTop3 ?? body.reward_top3 ?? 30),
        updated_at: nowIso(),
      };
      await db("popularity_rules", "?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload),
      });
      await writeAdminLog({
        module: "popularity",
        action: "save_rules",
        targetType: "popularity_rules",
        targetId: "1",
        operatorRole: role,
        reason: "更新人气榜规则",
        after: payload,
      });
      return json(res, 200, { ok: true, message: "人气榜规则已保存", rules: viewRules(payload) });
    }

    if (action === "recompute") {
      const result = await recomputePopularity({
        periods: body.periods,
        gameKeys: body.gameKeys,
        operatorRole: role,
      });
      return json(res, 200, { ...result, message: "人气榜已重算" });
    }

    if (action === "adjust") {
      const companionId = String(body.companionId || body.companion_id || "").trim();
      const points = money(body.points);
      const reason = String(body.reason || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "缺少陪玩 ID" });
      if (!reason) return json(res, 400, { ok: false, message: "人工调分必须填写原因" });
      if (!points) return json(res, 400, { ok: false, message: "请填写非零调分" });
      const rows = await db("popularity_adjustments", "", {
        method: "POST",
        body: JSON.stringify({
          companion_id: companionId,
          points,
          reason,
          operator_id: body.operatorId || null,
          created_at: nowIso(),
        }),
      });
      await writeAdminLog({
        module: "popularity",
        action: "manual_adjust",
        targetType: "companion",
        targetId: companionId,
        operatorRole: role,
        reason,
        after: { points },
      });
      await recomputePopularity({ periods: ["weekly", "monthly", "total"], gameKeys: [""], operatorRole: role });
      return json(res, 200, { ok: true, message: "调分已记录并重算", adjustment: rows?.[0] });
    }

    if (action === "approve_reward") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少奖励记录" });
      const rows = await db("popularity_reward_records", `?id=eq.${encodeURIComponent(id)}&limit=1`);
      const rec = rows?.[0];
      if (!rec) return json(res, 404, { ok: false, message: "奖励记录不存在" });
      if (rec.status === "approved") return json(res, 200, { ok: true, message: "已发放过" });
      const rules = await loadRules();
      if (!rules.rewards_enabled) return json(res, 400, { ok: false, message: "榜单奖励未启用" });

      // Credit companion wallet via transactions table (cat food income)
      await db("transactions", "", {
        method: "POST",
        body: JSON.stringify({
          user_id: rec.companion_id,
          transaction_type: "popularity_reward",
          amount: money(rec.reward_cat_food),
          status: "completed",
          note: `人气榜奖励 第${rec.rank}名 ${rec.period_type} ${rec.period_start}`,
          created_at: nowIso(),
        }),
      }).catch(() => {});

      await db("popularity_reward_records", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved", approved_at: nowIso() }),
      });
      await writeAdminLog({
        module: "popularity",
        action: "approve_reward",
        targetType: "popularity_reward",
        targetId: id,
        operatorRole: role,
        reason: body.reason || "审核发放人气榜奖励",
        after: { amount: rec.reward_cat_food, companionId: rec.companion_id },
      });
      return json(res, 200, { ok: true, message: "奖励已审核发放" });
    }

    if (action === "create_period_rewards") {
      const period = String(body.period || "weekly");
      const rules = await loadRules();
      if (!rules.rewards_enabled) return json(res, 400, { ok: false, message: "请先启用榜单奖励" });
      const { periodBounds } = await import("../_popularity.js");
      const bounds = periodBounds(period);
      const top = await db(
        "companion_popularity_stats",
        `?period_type=eq.${encodeURIComponent(period)}&period_start=eq.${encodeURIComponent(bounds.periodStart)}&game_key=eq.&order=rank.asc&limit=3`
      );
      const amounts = [money(rules.reward_top1), money(rules.reward_top2), money(rules.reward_top3)];
      const created = [];
      for (const row of top || []) {
        if (!row.rank || row.rank > 3) continue;
        const amount = amounts[row.rank - 1] || 0;
        if (amount <= 0) continue;
        const existed = await db(
          "popularity_reward_records",
          `?companion_id=eq.${encodeURIComponent(row.companion_id)}&period_type=eq.${encodeURIComponent(period)}&period_start=eq.${encodeURIComponent(bounds.periodStart)}&rank=eq.${row.rank}&limit=1`
        ).catch(() => []);
        if (existed?.[0]) continue;
        const rows = await db("popularity_reward_records", "", {
          method: "POST",
          body: JSON.stringify({
            companion_id: row.companion_id,
            period_type: period,
            period_start: bounds.periodStart,
            rank: row.rank,
            reward_cat_food: amount,
            status: "pending",
            created_at: nowIso(),
          }),
        });
        created.push(rows?.[0]);
      }
      await writeAdminLog({
        module: "popularity",
        action: "create_period_rewards",
        targetType: "popularity_reward",
        targetId: `${period}:${bounds.periodStart}`,
        operatorRole: role,
        reason: "生成待审核榜单奖励",
      });
      return json(res, 200, { ok: true, message: `已生成 ${created.length} 条待审核奖励`, created });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/popularity-ranking.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "人气榜管理异常" });
  }
}
