/**
 * Boss level progress from real user_points.total_points + boss_level_tiers.
 * No mock balances — empty/missing tables → safe defaults.
 */
import {
  isMissingRelation,
  money,
  restUrl,
  rpcUrl,
  serviceHeaders,
  supabaseJson,
} from "./_wallet.js";
import { getUserPoints } from "./_points.js";

const DEFAULT_TIERS = [
  { code: "newbie", name: "萌新老板", level_rank: 1, min_points: 0, badge_label: "萌新老板" },
  { code: "bronze", name: "青铜老板", level_rank: 2, min_points: 1000, badge_label: "青铜老板" },
  { code: "silver", name: "白银老板", level_rank: 3, min_points: 3000, badge_label: "白银老板" },
  { code: "gold", name: "黄金老板", level_rank: 4, min_points: 6000, badge_label: "黄金老板" },
  { code: "platinum", name: "铂金老板", level_rank: 5, min_points: 15000, badge_label: "铂金老板" },
  { code: "diamond", name: "钻石老板", level_rank: 6, min_points: 40000, badge_label: "钻石老板" },
];

function viewTier(row) {
  if (!row) return null;
  return {
    code: row.code || "",
    name: row.name || "",
    levelRank: Number(row.level_rank) || 0,
    minPoints: money(row.min_points),
    badgeLabel: row.badge_label || row.name || "",
  };
}

function resolveFromTiers(totalPoints, tiers) {
  const pts = money(totalPoints);
  const enabled = (Array.isArray(tiers) ? tiers : [])
    .filter((t) => t && t.enabled !== false)
    .slice()
    .sort((a, b) => Number(a.level_rank) - Number(b.level_rank));
  const list = enabled.length ? enabled : DEFAULT_TIERS;
  let current = list[0] || null;
  for (const t of list) {
    if (money(t.min_points) <= pts) current = t;
  }
  const curRank = Number(current?.level_rank) || 0;
  const next = list.find((t) => Number(t.level_rank) > curRank) || null;
  if (!current) {
    return {
      ok: true,
      totalPoints: pts,
      current: null,
      next: null,
      pointsToNext: null,
      progressRatio: 0,
      progressPercent: 0,
      levelLabel: "萌新老板",
      levelRank: 1,
      nextHint: "",
    };
  }
  if (!next) {
    return {
      ok: true,
      totalPoints: pts,
      current: viewTier(current),
      next: null,
      pointsToNext: 0,
      progressRatio: 1,
      progressPercent: 100,
      levelLabel: current.badge_label || current.name || "萌新老板",
      levelRank: curRank,
      nextHint: "已达最高等级",
    };
  }
  const need = Math.max(0, money(next.min_points) - pts);
  const span = Math.max(1, money(next.min_points) - money(current.min_points));
  const ratio = Math.min(1, Math.max(0, (pts - money(current.min_points)) / span));
  const nextName = next.badge_label || next.name || "下一等级";
  return {
    ok: true,
    totalPoints: pts,
    current: viewTier(current),
    next: viewTier(next),
    pointsToNext: need,
    progressRatio: Math.round(ratio * 10000) / 10000,
    progressPercent: Math.round(ratio * 10000) / 100,
    levelLabel: current.badge_label || current.name || "萌新老板",
    levelRank: curRank,
    nextHint: need > 0 ? `距 ${nextName} 还差 ${need} 积分` : `已达 ${nextName}`,
  };
}

export async function listBossLevelTiers() {
  try {
    const rows = await supabaseJson(
      restUrl("boss_level_tiers", "?enabled=eq.true&order=level_rank.asc"),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) && rows.length ? rows : DEFAULT_TIERS;
  } catch (error) {
    if (isMissingRelation(error)) return DEFAULT_TIERS;
    throw error;
  }
}

export async function bossLevelFromPointsRpc(points) {
  try {
    const result = await supabaseJson(rpcUrl("mcj_boss_level_from_points"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ p_points: money(points) }),
    });
    if (result && typeof result === "object" && result.ok !== false) {
      const cur = result.current || null;
      const next = result.next || null;
      const pts = money(result.total_points ?? points);
      const need = result.points_to_next == null ? null : money(result.points_to_next);
      const ratio = Number(result.progress_ratio);
      const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
      return {
        ok: true,
        totalPoints: pts,
        current: viewTier(cur),
        next: viewTier(next),
        pointsToNext: need,
        progressRatio: safeRatio,
        progressPercent: Math.round(safeRatio * 10000) / 100,
        levelLabel: (cur && (cur.badge_label || cur.name)) || "萌新老板",
        levelRank: Number(cur?.level_rank) || 1,
        nextHint:
          !next
            ? "已达最高等级"
            : need > 0
              ? `距 ${next.badge_label || next.name} 还差 ${need} 积分`
              : `已达 ${next.badge_label || next.name}`,
      };
    }
  } catch (error) {
    if (
      !(
        isMissingRelation(error) ||
        /function .* does not exist|PGRST202|mcj_boss_level_from_points/i.test(String(error?.message || ""))
      )
    ) {
      throw error;
    }
  }
  return null;
}

export async function getBossLevelProgress(userId) {
  const ptsRow = await getUserPoints(userId);
  const totalPoints = money(ptsRow?.total_points);
  const fromRpc = await bossLevelFromPointsRpc(totalPoints);
  if (fromRpc) return fromRpc;
  const tiers = await listBossLevelTiers();
  return resolveFromTiers(totalPoints, tiers);
}
