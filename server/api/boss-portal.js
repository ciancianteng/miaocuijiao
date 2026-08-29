/**
 * Boss Portal personal center aggregate — real wallet / points / level / referral / order counts.
 */
import { getBossLevelProgress } from "./_boss-level.js";
import { getUserPoints, viewPoints, hasPointsDb } from "./_points.js";
import { getBossReferralSummary } from "./_referral.js";
import {
  getWallet,
  envValue,
  isMissingRelation,
  restUrl,
  serviceHeaders,
  supabaseJson,
  viewWallet,
} from "./_wallet.js";

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  res.status(status).json(data);
}

function authHeaders(extra = {}) {
  return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

async function profileFromToken(req) {
  const auth = String(req.headers.authorization || req.headers.Authorization || "").trim();
  const headerTok = String(req.headers["x-mcj-access-token"] || "").trim();
  const token = (auth.match(/^Bearer\s+(.+)$/i) || [])[1] || headerTok;
  if (!token) throw Object.assign(new Error("未登录"), { status: 401 });
  const userRes = await fetch(`${envValue("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/user`, {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
  const userBody = await userRes.json().catch(() => ({}));
  if (!userRes.ok) throw Object.assign(new Error(userBody?.msg || userBody?.message || "登录已过期"), { status: 401 });
  const uid = userBody.id;
  if (!uid) throw Object.assign(new Error("登录已过期"), { status: 401 });
  const profiles = await supabaseJson(
    restUrl(
      "profiles",
      `?id=eq.${encodeURIComponent(uid)}&select=id,role,status,display_name,email,avatar_url,boss_uid,phone&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) throw Object.assign(new Error("未绑定平台资料"), { status: 403 });
  return profile;
}

async function orderStatusCounts(bossId) {
  const empty = {
    awaitingPayment: 0,
    pendingAccept: 0,
    inService: 0,
    pendingSettle: 0,
    completed: 0,
  };
  try {
    const rows = await supabaseJson(
      restUrl("orders", `?boss_id=eq.${encodeURIComponent(bossId)}&select=id,status,note,description&limit=500`),
      { headers: serviceHeaders() }
    );
    if (!Array.isArray(rows)) return empty;
    for (const o of rows) {
      const s = String(o.status || "").toLowerCase();
      const note = String(o.note || "") + String(o.description || "");
      if (s === "awaiting_payment" || s === "pending_payment") empty.awaitingPayment += 1;
      else if (s === "pending" || s === "claimed" || s === "waiting_boss_confirm") empty.pendingAccept += 1;
      else if (
        (s === "confirmed" || s === "in_progress") &&
        /\[\[COMPLETION_PENDING\]\]/i.test(note)
      ) {
        empty.pendingSettle += 1;
      } else if (s === "confirmed" || s === "in_progress") empty.inService += 1;
      else if (s === "completed" || s === "reviewed") empty.completed += 1;
    }
    return empty;
  } catch (error) {
    if (isMissingRelation(error)) return empty;
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, message: "Method not allowed" });
  if (!hasPointsDb() && !envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    return json(res, 503, { ok: false, message: "未配置数据库" });
  }

  let profile;
  try {
    profile = await profileFromToken(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "未登录" });
  }

  const userId = profile.id;
  const warnings = [];

  let wallet = null;
  try {
    wallet = viewWallet(await getWallet(userId), userId);
  } catch (error) {
    warnings.push("wallet:" + (error.message || "fail"));
    wallet = viewWallet(null, userId);
  }

  let points = viewPoints(null, userId);
  try {
    points = viewPoints(await getUserPoints(userId), userId);
  } catch (error) {
    warnings.push("points:" + (error.message || "fail"));
  }

  let level = null;
  try {
    level = await getBossLevelProgress(userId);
  } catch (error) {
    warnings.push("level:" + (error.message || "fail"));
    level = {
      ok: true,
      totalPoints: points.totalPoints || 0,
      levelLabel: "萌新老板",
      levelRank: 1,
      progressPercent: 0,
      pointsToNext: null,
      nextHint: "等级配置读取失败",
      current: { code: "newbie", name: "萌新老板", levelRank: 1, minPoints: 0, badgeLabel: "萌新老板" },
      next: null,
    };
  }

  let referral = null;
  try {
    referral = await getBossReferralSummary(userId);
  } catch (error) {
    warnings.push("referral:" + (error.message || "fail"));
    referral = {
      inviteCode: "",
      inviteeCount: 0,
      totalEarnedCatFood: 0,
      banner: {
        title: "推广返利 · 邀请好友",
        subtitle: "双方得奖励 · 最高返利 30%",
        maxRebatePercent: 30,
        bothSides: true,
      },
      recentRewards: [],
      schemaMissing: true,
    };
  }

  let orderCounts = {
    awaitingPayment: 0,
    pendingAccept: 0,
    inService: 0,
    pendingSettle: 0,
    completed: 0,
  };
  try {
    orderCounts = await orderStatusCounts(userId);
  } catch (error) {
    warnings.push("orders:" + (error.message || "fail"));
  }

  return json(res, 200, {
    ok: true,
    profile: {
      id: profile.id,
      displayName: profile.display_name || "",
      email: profile.email || "",
      avatarUrl: profile.avatar_url || "",
      bossUid: profile.boss_uid || "",
      gender: "",
      phone: profile.phone || "",
      role: profile.role || "",
      status: profile.status || "",
    },
    wallet,
    points,
    level,
    referral,
    orderCounts,
    warnings: warnings.length ? warnings : undefined,
  });
}
