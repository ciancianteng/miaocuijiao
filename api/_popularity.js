import {
  envValue,
  hasWalletDb,
  isMissingRelation,
  money,
  nowIso,
  restUrl,
  serviceHeaders,
  supabaseJson,
  writeAdminLog,
} from "./_wallet.js";

const TZ = "Asia/Kuala_Lumpur";
const BRUSH_ORDER_LIMIT_24H = 5;

export function hasPopularityDb() {
  return hasWalletDb();
}

function datePartsInTz(date = new Date(), timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

export function todayYmd(timeZone = TZ) {
  const p = datePartsInTz(new Date(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekdayIndex(ymd, timeZone = TZ) {
  // Mon=0 ... Sun=6 in MY timezone for that calendar date noon UTC approx
  const [y, m, d] = ymd.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
  const wd = datePartsInTz(probe, timeZone).weekday;
  return { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd] ?? 0;
}

export function periodBounds(periodType, anchorYmd = todayYmd()) {
  const type = String(periodType || "weekly");
  if (type === "daily") {
    return { periodType: "daily", periodStart: anchorYmd, periodEnd: anchorYmd };
  }
  if (type === "weekly") {
    const offset = weekdayIndex(anchorYmd);
    const start = addDaysYmd(anchorYmd, -offset);
    const end = addDaysYmd(start, 6);
    return { periodType: "weekly", periodStart: start, periodEnd: end };
  }
  if (type === "monthly") {
    const start = `${anchorYmd.slice(0, 7)}-01`;
    const [y, m] = start.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${start.slice(0, 7)}-${String(last).padStart(2, "0")}`;
    return { periodType: "monthly", periodStart: start, periodEnd: end };
  }
  // total: from far past
  return { periodType: "total", periodStart: "2000-01-01", periodEnd: "9999-12-31" };
}

async function db(table, query = "", init) {
  return supabaseJson(restUrl(table, query), {
    method: init?.method || "GET",
    headers: serviceHeaders(init?.headers || {}),
    body: init?.body,
  });
}

async function dbMaybe(table, query = "", init) {
  try {
    return await db(table, query, init);
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

export async function loadRules() {
  const rows = await dbMaybe("popularity_rules", "?id=eq.1&limit=1");
  const r = rows?.[0];
  if (!r) {
    return {
      id: 1,
      completed_order_points: 20,
      five_star_points: 15,
      four_star_points: 8,
      gift_points_per_10_cat_food: 1,
      online_hour_points: 1,
      streak_day_points: 3,
      favorite_points: 2,
      cancel_penalty: 10,
      complaint_penalty: 30,
      reject_penalty: 5,
      timeout_penalty: 3,
      gift_daily_cap_points: 50,
      display_count: 10,
      show_score: true,
      show_orders: true,
      show_gifts: true,
      show_online: false,
      enable_weekly: true,
      enable_monthly: true,
      enable_total: true,
      enable_daily: false,
      enabled: true,
      rewards_enabled: false,
      reward_top1: 100,
      reward_top2: 60,
      reward_top3: 30,
      _missing: true,
    };
  }
  return r;
}

export function viewRules(r = {}) {
  return {
    completedOrderPoints: money(r.completed_order_points ?? 20),
    fiveStarPoints: money(r.five_star_points ?? 15),
    fourStarPoints: money(r.four_star_points ?? 8),
    giftPointsPer10CatFood: money(r.gift_points_per_10_cat_food ?? 1),
    onlineHourPoints: money(r.online_hour_points ?? 1),
    streakDayPoints: money(r.streak_day_points ?? 3),
    favoritePoints: money(r.favorite_points ?? 2),
    cancelPenalty: money(r.cancel_penalty ?? 10),
    complaintPenalty: money(r.complaint_penalty ?? 30),
    rejectPenalty: money(r.reject_penalty ?? 5),
    timeoutPenalty: money(r.timeout_penalty ?? 3),
    giftDailyCapPoints: money(r.gift_daily_cap_points ?? 50),
    displayCount: Math.max(1, Number(r.display_count || 10)),
    showScore: r.show_score !== false,
    showOrders: r.show_orders !== false,
    showGifts: r.show_gifts !== false,
    showOnline: !!r.show_online,
    enableWeekly: r.enable_weekly !== false,
    enableMonthly: r.enable_monthly !== false,
    enableTotal: r.enable_total !== false,
    enableDaily: !!r.enable_daily,
    enabled: r.enabled !== false,
    rewardsEnabled: !!r.rewards_enabled,
    rewardTop1: money(r.reward_top1 ?? 100),
    rewardTop2: money(r.reward_top2 ?? 60),
    rewardTop3: money(r.reward_top3 ?? 30),
    updatedAt: r.updated_at || "",
    missing: !!r._missing,
  };
}

function inPeriod(iso, startYmd, endYmd) {
  const day = String(iso || "").slice(0, 10);
  if (!day || day.length < 10) return false;
  return day >= startYmd && day <= endYmd;
}

function gameKeyOf(order = {}, companion = {}) {
  return String(order.game || order.service_name || companion.game || companion.main_service || "").trim();
}

function emptyBucket() {
  return {
    completed_orders: 0,
    five_star_reviews: 0,
    four_star_reviews: 0,
    gift_cat_food: 0,
    online_minutes: 0,
    favorites: 0,
    cancellations: 0,
    complaints: 0,
    rejected_orders: 0,
    timeout_count: 0,
    streak_days: 0,
    gift_points: 0,
    adjustment_points: 0,
    anomaly_flag: false,
    anomaly_note: "",
  };
}

function scoreFromBucket(b, rules) {
  const orderPts = b.completed_orders * money(rules.completed_order_points);
  const fivePts = b.five_star_reviews * money(rules.five_star_points);
  const fourPts = b.four_star_reviews * money(rules.four_star_points);
  const giftPts = b.gift_points;
  const onlinePts = (b.online_minutes / 60) * money(rules.online_hour_points);
  const streakPts = b.streak_days * money(rules.streak_day_points);
  const favPts = b.favorites * money(rules.favorite_points);
  const cancelPts = b.cancellations * money(rules.cancel_penalty);
  const complaintPts = b.complaints * money(rules.complaint_penalty);
  const rejectPts = b.rejected_orders * money(rules.reject_penalty);
  const timeoutPts = b.timeout_count * money(rules.timeout_penalty);
  const raw =
    orderPts +
    fivePts +
    fourPts +
    giftPts +
    onlinePts +
    streakPts +
    favPts +
    money(b.adjustment_points) -
    cancelPts -
    complaintPts -
    rejectPts -
    timeoutPts;
  return Math.round(raw * 100) / 100;
}

async function snapshotHistoryIfNeeded(periodType, periodStart, periodEnd, gameKey, rankedRows) {
  if (periodType === "total") return;
  const today = todayYmd();
  // Only archive when period has ended
  if (periodEnd >= today) return;
  const existed = await dbMaybe(
    "popularity_history",
    `?period_type=eq.${encodeURIComponent(periodType)}&period_start=eq.${encodeURIComponent(periodStart)}&game_key=eq.${encodeURIComponent(gameKey)}&limit=1`
  );
  if (existed?.length) return;
  const payload = rankedRows.map((row) => ({
    companion_id: row.companion_id,
    period_type: periodType,
    period_start: periodStart,
    period_end: periodEnd,
    game_key: gameKey,
    final_score: row.popularity_score,
    final_rank: row.rank,
    snapshot: {
      completed_orders: row.completed_orders,
      gift_cat_food: row.gift_cat_food,
      five_star_reviews: row.five_star_reviews,
    },
    reward_status: "none",
    created_at: nowIso(),
  }));
  if (!payload.length) return;
  // insert in chunks
  for (let i = 0; i < payload.length; i += 80) {
    await db("popularity_history", "", {
      method: "POST",
      body: JSON.stringify(payload.slice(i, i + 80)),
    }).catch((e) => {
      if (!isMissingRelation(e)) throw e;
    });
  }
}

/**
 * Recompute popularity stats for enabled periods.
 * Homepage reads companion_popularity_stats — never heavy-calc on page load.
 */
export async function recomputePopularity({ periods, gameKeys, operatorId, operatorRole } = {}) {
  if (!hasPopularityDb()) throw Object.assign(new Error("数据库未配置"), { status: 503 });
  const rules = await loadRules();
  if (rules._missing) {
    throw Object.assign(new Error("请先执行 supabase/popularity-ranking.sql"), { status: 503 });
  }
  if (rules.enabled === false) {
    return { ok: true, skipped: true, message: "人气榜已停用", rules: viewRules(rules) };
  }

  const enabledPeriods = [];
  if (rules.enable_daily) enabledPeriods.push("daily");
  if (rules.enable_weekly !== false) enabledPeriods.push("weekly");
  if (rules.enable_monthly !== false) enabledPeriods.push("monthly");
  if (rules.enable_total !== false) enabledPeriods.push("total");
  const periodList = (periods && periods.length ? periods : enabledPeriods).filter((p) =>
    enabledPeriods.includes(p)
  );

  let orders = await db(
    "orders",
    "?select=id,boss_id,companion_id,status,game,service_name,completed_at,cancelled_at,created_at,updated_at,note,cancel_reason&order=created_at.desc&limit=8000"
  ).catch(async (e) => {
    if (/note|cancel_reason|column/i.test(String(e.message || ""))) {
      return dbMaybe(
        "orders",
        "?select=id,boss_id,companion_id,status,game,service_name,completed_at,cancelled_at,created_at,updated_at&order=created_at.desc&limit=8000"
      );
    }
    if (isMissingRelation(e)) return [];
    throw e;
  });

  let gifts = await db(
    "gift_transactions",
    "?select=id,sender_boss_id,receiver_companion_id,gross_cat_food,created_at,related_order_id,refunded_at&order=created_at.desc&limit=8000"
  ).catch(async (e) => {
    if (/refunded_at|column/i.test(String(e.message || ""))) {
      return dbMaybe(
        "gift_transactions",
        "?select=id,sender_boss_id,receiver_companion_id,gross_cat_food,created_at,related_order_id&order=created_at.desc&limit=8000"
      );
    }
    if (isMissingRelation(e)) return [];
    throw e;
  });

  const [companions, reviews, favorites, complaints, sessions, adjustments] = await Promise.all([
    dbMaybe(
      "companion_profiles",
      "?verification_status=eq.approved&select=user_id,nickname,game,main_service,level_name,level_id,price,pricing_unit,card_image_url,availability_status,online_status,companion_uid&limit=3000"
    ),
    dbMaybe("companion_reviews", "?select=id,companion_id,boss_id,rating,status,created_at&order=created_at.desc&limit=5000"),
    dbMaybe("companion_favorites", "?select=id,boss_id,companion_id,created_at&limit=8000"),
    dbMaybe("companion_complaints", "?select=id,companion_id,status,confirmed_at,created_at&limit=3000"),
    dbMaybe("companion_online_sessions", "?select=companion_id,started_at,ended_at,status&order=started_at.desc&limit=8000"),
    dbMaybe("popularity_adjustments", "?select=companion_id,points,created_at&order=created_at.desc&limit=3000"),
  ]);

  const companionMap = {};
  for (const c of companions || []) {
    if (c.user_id) companionMap[c.user_id] = c;
  }
  const companionIds = Object.keys(companionMap);
  const allGameKeys = new Set([""]);
  for (const o of orders || []) {
    const gk = gameKeyOf(o, companionMap[o.companion_id] || {});
    if (gk) allGameKeys.add(gk);
  }
  for (const c of companions || []) {
    if (c.game) allGameKeys.add(String(c.game).trim());
  }
  const gameKeyList = gameKeys && gameKeys.length ? gameKeys : Array.from(allGameKeys);

  const results = [];

  for (const periodType of periodList) {
    const bounds = periodBounds(periodType);
    for (const gameKey of gameKeyList) {
      const buckets = {};
      for (const id of companionIds) buckets[id] = emptyBucket();

      // Orders
      const brushMap = {}; // companion|boss -> timestamps
      for (const o of orders || []) {
        const cid = o.companion_id;
        if (!cid || !buckets[cid]) continue;
        const gk = gameKeyOf(o, companionMap[cid] || {});
        if (gameKey && gk !== gameKey) continue;
        const ts = o.completed_at || o.cancelled_at || o.updated_at || o.created_at;
        if (!inPeriod(ts, bounds.periodStart, bounds.periodEnd) && periodType !== "total") {
          if (periodType !== "total") continue;
        }
        if (periodType !== "total" && !inPeriod(ts, bounds.periodStart, bounds.periodEnd)) continue;

        if (o.status === "completed") {
          buckets[cid].completed_orders += 1;
          const key = `${cid}|${o.boss_id || ""}`;
          brushMap[key] = brushMap[key] || [];
          brushMap[key].push(new Date(ts || o.created_at).getTime());
        } else if (o.status === "refunded" || o.status === "refund_requested") {
          // refunded / in refund: do not count as completed
        } else if (o.status === "cancelled") {
          const note = `${o.note || ""} ${o.cancel_reason || ""}`;
          if (/拒绝|拒单|reject/i.test(note)) buckets[cid].rejected_orders += 1;
          else buckets[cid].cancellations += 1;
        } else if (o.status === "rejected" || o.status === "companion_rejected") {
          buckets[cid].rejected_orders += 1;
        }
      }

      // Detect brush: same boss > BRUSH_ORDER_LIMIT_24H completed within 24h
      for (const [key, times] of Object.entries(brushMap)) {
        times.sort((a, b) => a - b);
        for (let i = 0; i < times.length; i++) {
          let count = 1;
          for (let j = i + 1; j < times.length; j++) {
            if (times[j] - times[i] <= 86400000) count += 1;
            else break;
          }
          if (count > BRUSH_ORDER_LIMIT_24H) {
            const cid = key.split("|")[0];
            if (buckets[cid]) {
              buckets[cid].anomaly_flag = true;
              buckets[cid].anomaly_note = `同一老板 24h 内完成 ${count} 单，疑似刷单`;
            }
            break;
          }
        }
      }

      // Reviews
      for (const r of reviews || []) {
        if (r.status && r.status !== "published") continue;
        const cid = r.companion_id;
        if (!cid || !buckets[cid]) continue;
        if (gameKey) {
          const cg = String(companionMap[cid]?.game || "").trim();
          if (cg && cg !== gameKey) continue;
        }
        if (periodType !== "total" && !inPeriod(r.created_at, bounds.periodStart, bounds.periodEnd)) continue;
        const rating = Number(r.rating || 0);
        if (rating >= 5) buckets[cid].five_star_reviews += 1;
        else if (rating >= 4) buckets[cid].four_star_reviews += 1;
      }

      // Gifts with daily cap + no self-gift
      const giftByDay = {}; // cid|day -> cat food
      for (const g of gifts || []) {
        const cid = g.receiver_companion_id;
        if (!cid || !buckets[cid]) continue;
        if (g.sender_boss_id && g.sender_boss_id === cid) continue; // self gift
        if (g.refunded_at) continue;
        if (gameKey) {
          const cg = String(companionMap[cid]?.game || "").trim();
          if (cg && cg !== gameKey) continue;
        }
        if (periodType !== "total" && !inPeriod(g.created_at, bounds.periodStart, bounds.periodEnd)) continue;
        const day = String(g.created_at || "").slice(0, 10);
        const k = `${cid}|${day}`;
        giftByDay[k] = (giftByDay[k] || 0) + money(g.gross_cat_food);
        buckets[cid].gift_cat_food += money(g.gross_cat_food);
      }
      const per10 = money(rules.gift_points_per_10_cat_food);
      const dailyCap = money(rules.gift_daily_cap_points);
      for (const [k, catFood] of Object.entries(giftByDay)) {
        const cid = k.split("|")[0];
        let pts = Math.floor(catFood / 10) * per10;
        if (dailyCap > 0) pts = Math.min(pts, dailyCap);
        buckets[cid].gift_points += pts;
      }

      // Favorites (unique already)
      for (const f of favorites || []) {
        const cid = f.companion_id;
        if (!cid || !buckets[cid]) continue;
        if (gameKey) {
          const cg = String(companionMap[cid]?.game || "").trim();
          if (cg && cg !== gameKey) continue;
        }
        if (periodType !== "total" && !inPeriod(f.created_at, bounds.periodStart, bounds.periodEnd)) continue;
        buckets[cid].favorites += 1;
      }

      // Complaints confirmed
      for (const c of complaints || []) {
        const cid = c.companion_id;
        if (!cid || !buckets[cid]) continue;
        if (!/confirmed|approved|upheld|成立/.test(String(c.status || ""))) continue;
        const ts = c.confirmed_at || c.created_at;
        if (periodType !== "total" && !inPeriod(ts, bounds.periodStart, bounds.periodEnd)) continue;
        buckets[cid].complaints += 1;
      }

      // Online sessions minutes
      for (const s of sessions || []) {
        const cid = s.companion_id;
        if (!cid || !buckets[cid]) continue;
        const start = new Date(s.started_at).getTime();
        const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        // Clip to period roughly by start day
        if (periodType !== "total" && !inPeriod(s.started_at, bounds.periodStart, bounds.periodEnd)) continue;
        buckets[cid].online_minutes += Math.round((end - start) / 60000);
      }

      // Streak: consecutive days with completed order ending at period end / today
      for (const cid of companionIds) {
        const days = new Set();
        for (const o of orders || []) {
          if (o.companion_id !== cid || o.status !== "completed") continue;
          const day = String(o.completed_at || o.created_at || "").slice(0, 10);
          if (periodType !== "total" && (day < bounds.periodStart || day > bounds.periodEnd)) continue;
          days.add(day);
        }
        let streak = 0;
        let cursor = periodType === "total" ? todayYmd() : bounds.periodEnd > todayYmd() ? todayYmd() : bounds.periodEnd;
        while (days.has(cursor)) {
          streak += 1;
          cursor = addDaysYmd(cursor, -1);
        }
        buckets[cid].streak_days = streak;
      }

      // Adjustments
      for (const a of adjustments || []) {
        const cid = a.companion_id;
        if (!cid || !buckets[cid]) continue;
        if (periodType !== "total" && !inPeriod(a.created_at, bounds.periodStart, bounds.periodEnd)) continue;
        buckets[cid].adjustment_points += money(a.points);
      }

      const scored = companionIds.map((cid) => {
        const b = buckets[cid];
        const popularity_score = scoreFromBucket(b, rules);
        return {
          companion_id: cid,
          period_type: periodType,
          period_start: bounds.periodStart,
          period_end: bounds.periodEnd,
          game_key: gameKey,
          completed_orders: b.completed_orders,
          five_star_reviews: b.five_star_reviews,
          four_star_reviews: b.four_star_reviews,
          gift_cat_food: Math.round(b.gift_cat_food * 100) / 100,
          online_minutes: b.online_minutes,
          favorites: b.favorites,
          cancellations: b.cancellations,
          complaints: b.complaints,
          rejected_orders: b.rejected_orders,
          timeout_count: b.timeout_count,
          streak_days: b.streak_days,
          popularity_score,
          anomaly_flag: b.anomaly_flag,
          anomaly_note: b.anomaly_note,
          updated_at: nowIso(),
        };
      });

      scored.sort((a, b) => b.popularity_score - a.popularity_score || b.completed_orders - a.completed_orders);
      scored.forEach((row, idx) => {
        row.rank = row.popularity_score > 0 || row.completed_orders > 0 || row.gift_cat_food > 0 ? idx + 1 : 0;
      });

      // Upsert via delete+insert for this period+game slice (keeps ranks consistent)
      await db(
        "companion_popularity_stats",
        `?period_type=eq.${encodeURIComponent(periodType)}&period_start=eq.${encodeURIComponent(bounds.periodStart)}&game_key=eq.${encodeURIComponent(gameKey)}`,
        { method: "DELETE" }
      ).catch((e) => {
        if (!isMissingRelation(e)) throw e;
      });

      const toInsert = scored.filter((r) => r.rank > 0 || r.popularity_score !== 0);
      for (let i = 0; i < toInsert.length; i += 80) {
        await db("companion_popularity_stats", "", {
          method: "POST",
          body: JSON.stringify(toInsert.slice(i, i + 80)),
        });
      }

      // Anomaly logs
      for (const row of toInsert.filter((r) => r.anomaly_flag)) {
        await db("popularity_anomaly_logs", "", {
          method: "POST",
          body: JSON.stringify({
            companion_id: row.companion_id,
            period_type: periodType,
            note: row.anomaly_note,
            meta: { score: row.popularity_score, completed_orders: row.completed_orders },
            created_at: nowIso(),
          }),
        }).catch(() => {});
      }

      await snapshotHistoryIfNeeded(periodType, bounds.periodStart, bounds.periodEnd, gameKey, toInsert);

      results.push({
        periodType,
        periodStart: bounds.periodStart,
        periodEnd: bounds.periodEnd,
        gameKey,
        count: toInsert.length,
      });
    }
  }

  if (operatorId || operatorRole) {
    await writeAdminLog({
      module: "popularity",
      action: "recompute",
      targetType: "popularity_stats",
      targetId: periodList.join(","),
      operatorId,
      operatorRole,
      reason: "手动或事件触发人气榜重算",
      after: { slices: results.length },
    }).catch(() => {});
  }

  return { ok: true, slices: results, rules: viewRules(rules), computedAt: nowIso() };
}

export async function listBoard({ period = "weekly", gameKey = "", limit, onlineOnly, level } = {}) {
  const rules = await loadRules();
  if (rules.enabled === false) {
    return { ok: true, enabled: false, items: [], rules: viewRules(rules) };
  }
  const bounds = periodBounds(period);
  const displayLimit = Math.max(1, Number(limit || rules.display_count || 10));
  const gk = String(gameKey || "");
  let rows = await dbMaybe(
    "companion_popularity_stats",
    `?period_type=eq.${encodeURIComponent(bounds.periodType)}&period_start=eq.${encodeURIComponent(bounds.periodStart)}&game_key=eq.${encodeURIComponent(gk)}&order=rank.asc&limit=${displayLimit * 3}`
  );
  // If empty board, try soft recompute once for this period (best-effort, not blocking forever)
  if (!rows.length) {
    try {
      await recomputePopularity({ periods: [bounds.periodType], gameKeys: [gk] });
      rows = await dbMaybe(
        "companion_popularity_stats",
        `?period_type=eq.${encodeURIComponent(bounds.periodType)}&period_start=eq.${encodeURIComponent(bounds.periodStart)}&game_key=eq.${encodeURIComponent(gk)}&order=rank.asc&limit=${displayLimit * 3}`
      );
    } catch {
      /* leave empty */
    }
  }

  const ids = rows.map((r) => r.companion_id).filter(Boolean);
  let companions = [];
  let profiles = [];
  if (ids.length) {
    const inList = ids.map(encodeURIComponent).join(",");
    companions = await dbMaybe("companion_profiles", `?user_id=in.(${inList})&limit=500`);
    profiles = await dbMaybe("profiles", `?id=in.(${inList})&select=id,display_name,avatar_url&limit=500`);
  }
  const cMap = Object.fromEntries((companions || []).map((c) => [c.user_id, c]));
  const pMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  let items = rows
    .filter((r) => r.rank > 0)
    .map((r) => {
      const c = cMap[r.companion_id] || {};
      const p = pMap[r.companion_id] || {};
      const availRaw = String(c.availability_status || c.online_status || "offline").toLowerCase();
      const availabilityStatus =
        availRaw === "online" ? "online" : availRaw === "busy" ? "busy" : availRaw === "paused" ? "paused" : "offline";
      return {
        rank: r.rank,
        companionId: r.companion_id,
        publicId: c.companion_uid ? `P${c.companion_uid}` : "",
        nickname: c.nickname || p.display_name || "未命名陪玩",
        avatar: p.avatar_url || c.card_image_url || "assets/meow-cuijiao-brand.jpg",
        level: c.level_name || "未设置等级",
        levelId: c.level_id || "",
        mainService: c.main_service || c.game || "",
        game: c.game || "",
        price: money(c.price),
        pricingUnit: c.pricing_unit || "小时",
        availabilityStatus,
        availabilityText: ({ online: "在线可接单", busy: "忙碌中", paused: "暂停接单", offline: "离线" })[
          availabilityStatus
        ],
        popularityScore: money(r.popularity_score),
        completedOrders: r.completed_orders || 0,
        fiveStarReviews: r.five_star_reviews || 0,
        fourStarReviews: r.four_star_reviews || 0,
        giftCatFood: money(r.gift_cat_food),
        onlineMinutes: r.online_minutes || 0,
        favorites: r.favorites || 0,
        anomaly: !!r.anomaly_flag,
        periodType: r.period_type,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        gameKey: r.game_key || "",
      };
    });

  if (onlineOnly) items = items.filter((i) => i.availabilityStatus === "online");
  if (level) items = items.filter((i) => String(i.level).includes(String(level)) || String(i.levelId) === String(level));

  items = items.slice(0, displayLimit);
  return {
    ok: true,
    enabled: true,
    period: bounds.periodType,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    gameKey: gk,
    items,
    rules: viewRules(rules),
    updatedAt: rows[0]?.updated_at || "",
  };
}

export async function companionPopularityMe(companionId) {
  const rules = await loadRules();
  const periods = ["weekly", "monthly", "total"];
  const out = {};
  for (const period of periods) {
    const bounds = periodBounds(period);
    const rows = await dbMaybe(
      "companion_popularity_stats",
      `?period_type=eq.${encodeURIComponent(period)}&period_start=eq.${encodeURIComponent(bounds.periodStart)}&game_key=eq.&order=rank.asc&limit=500`
    );
    const mine = rows.find((r) => r.companion_id === companionId);
    const myRank = mine?.rank || 0;
    const myScore = money(mine?.popularity_score);
    let prev = null;
    let nextGap = null;
    let tip = "";
    if (myRank > 1) {
      prev = rows.find((r) => r.rank === myRank - 1);
      if (prev) {
        nextGap = Math.max(0, Math.round((money(prev.popularity_score) - myScore) * 100) / 100);
        const orderPts = money(rules.completed_order_points) || 20;
        const ordersNeeded = orderPts > 0 ? Math.ceil(nextGap / orderPts) : null;
        if (ordersNeeded && ordersNeeded > 0 && ordersNeeded <= 20) {
          tip = `再完成 ${ordersNeeded} 单即可超过上一名。`;
        } else {
          tip = `距离上一名还差 ${nextGap} 人气值。`;
        }
      }
    } else if (!myRank || myRank > 10) {
      const tenth = rows.find((r) => r.rank === 10);
      if (tenth) {
        nextGap = Math.max(0, Math.round((money(tenth.popularity_score) - myScore) * 100) / 100);
        tip = `距离前 10 名还差 ${nextGap} 人气值。`;
      } else if (!myRank) {
        tip = "完成本周第一单，即可登上人气榜。";
      }
    } else if (myRank === 1) {
      tip = "你当前是本周期冠军，保持接单与好评！";
    }

    const penalties = [];
    if (mine) {
      if (mine.cancellations) penalties.push({ type: "取消订单", count: mine.cancellations, points: -mine.cancellations * money(rules.cancel_penalty) });
      if (mine.complaints) penalties.push({ type: "有效投诉", count: mine.complaints, points: -mine.complaints * money(rules.complaint_penalty) });
      if (mine.rejected_orders) penalties.push({ type: "拒单", count: mine.rejected_orders, points: -mine.rejected_orders * money(rules.reject_penalty) });
      if (mine.timeout_count) penalties.push({ type: "超时未响应", count: mine.timeout_count, points: -mine.timeout_count * money(rules.timeout_penalty) });
    }

    out[period] = {
      rank: myRank,
      score: myScore,
      gapToPrevious: nextGap,
      tip,
      completedOrders: mine?.completed_orders || 0,
      fiveStarReviews: mine?.five_star_reviews || 0,
      fourStarReviews: mine?.four_star_reviews || 0,
      giftCatFood: money(mine?.gift_cat_food),
      onlineMinutes: mine?.online_minutes || 0,
      penalties,
      periodStart: bounds.periodStart,
      periodEnd: bounds.periodEnd,
    };
  }
  return { ok: true, companionId, weekly: out.weekly, monthly: out.monthly, total: out.total, rules: viewRules(rules) };
}

export async function recordOnlineSession(companionId, nextStatus) {
  if (!companionId) return;
  try {
    const open = await dbMaybe(
      "companion_online_sessions",
      `?companion_id=eq.${encodeURIComponent(companionId)}&ended_at=is.null&order=started_at.desc&limit=5`
    );
    for (const row of open || []) {
      await db("companion_online_sessions", `?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ended_at: nowIso() }),
      }).catch(() => {});
    }
    if (nextStatus === "online" || nextStatus === "busy") {
      await db("companion_online_sessions", "", {
        method: "POST",
        body: JSON.stringify({
          companion_id: companionId,
          started_at: nowIso(),
          status: nextStatus,
        }),
      });
    }
  } catch (e) {
    if (!isMissingRelation(e)) {
      /* non-fatal */
    }
  }
}

export async function scheduleRecomputeSoft() {
  // Fire-and-forget safe wrapper for event hooks
  try {
    await recomputePopularity({ periods: ["weekly", "monthly", "total"], gameKeys: [""] });
  } catch {
    /* ignore */
  }
}

export { envValue, money, nowIso, isMissingRelation };
