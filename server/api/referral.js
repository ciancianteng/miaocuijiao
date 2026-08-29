/**
 * Boss referral API — invite code, bind, reward history (Supabase-backed).
 */
import {
  bindReferral,
  getBossReferralSummary,
  listReferralRewards,
  viewReferralReward,
} from "./_referral.js";
import { envValue, isMissingRelation } from "./_wallet.js";

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
  const { restUrl, serviceHeaders, supabaseJson } = await import("./_wallet.js");
  const profiles = await supabaseJson(
    restUrl("profiles", `?id=eq.${encodeURIComponent(uid)}&select=id,role,status,display_name,email&limit=1`),
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) throw Object.assign(new Error("未绑定平台资料"), { status: 403 });
  return profile;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }
  if (!envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    return json(res, 503, { ok: false, message: "未配置数据库" });
  }

  let profile;
  try {
    profile = await profileFromToken(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "未登录" });
  }

  const userId = profile.id;

  try {
    if (req.method === "POST") {
      const body = readBody(req);
      const action = String(body.action || req.query?.action || "bind").trim().toLowerCase();
      if (action === "bind") {
        const inviteCode = String(body.inviteCode || body.invite_code || body.code || "").trim();
        const result = await bindReferral({ inviteeId: userId, inviteCode });
        return json(res, 200, result);
      }
      return json(res, 400, { ok: false, message: "未知 action" });
    }

    const action = String(req.query?.action || "summary").trim().toLowerCase();
    if (action === "rewards" || action === "history" || action === "ledger") {
      const as = String(req.query?.as || "beneficiary").trim().toLowerCase() === "inviter" ? "inviter" : "beneficiary";
      const rows = await listReferralRewards(userId, {
        as,
        limit: Number(req.query?.limit || 50),
      });
      const summary = await getBossReferralSummary(userId);
      return json(res, 200, {
        ok: true,
        summary,
        items: rows.map(viewReferralReward),
      });
    }

    const summary = await getBossReferralSummary(userId);
    return json(res, 200, { ok: true, referral: summary });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 200, {
        ok: true,
        referral: {
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
        },
        warning: "请先执行 supabase/migrations/20260829_boss_levels_and_referral.sql",
      });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "推广读取失败" });
  }
}
