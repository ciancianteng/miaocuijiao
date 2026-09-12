import {
  companionPopularityMe,
  hasPopularityDb,
  isMissingRelation,
  listBoard,
  loadRules,
  periodBounds,
  recomputePopularity,
  viewRules,
} from "./_popularity.js";
import { envValue, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

async function authCompanion(req) {
  const token = String(req.headers["x-mcj-companion-token"] || req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return null;
  try {
    const user = await supabaseJson(`${envValue("SUPABASE_URL")}/auth/v1/user`, {
      headers: {
        apikey: envValue("SUPABASE_ANON_KEY") || envValue("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!user?.id) return null;
    const profiles = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
      headers: serviceHeaders(),
    });
    const profile = profiles?.[0];
    if (!profile || profile.role !== "companion") return null;
    return profile;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!hasPopularityDb()) {
    return json(res, 503, { ok: false, message: "数据库未配置" });
  }
  try {
    const action = String(req.method === "GET" ? req.query.action || "board" : req.body?.action || "board").trim();

    if (req.method === "GET" && (action === "board" || action === "home")) {
      const period = String(req.query.period || "weekly");
      const gameKey = String(req.query.game || req.query.gameKey || req.query.service || "");
      const limit = Number(req.query.limit || (action === "home" ? 10 : 50));
      const onlineOnly = req.query.online === "1" || req.query.online === "true";
      const level = String(req.query.level || "");
      const board = await listBoard({ period, gameKey, limit, onlineOnly, level });
      return json(res, 200, board);
    }

    if (req.method === "GET" && action === "meta") {
      const rules = viewRules(await loadRules());
      return json(res, 200, {
        ok: true,
        rules,
        periods: [
          rules.enableWeekly && { id: "weekly", label: "本周" },
          rules.enableMonthly && { id: "monthly", label: "本月" },
          rules.enableTotal && { id: "total", label: "总榜" },
          rules.enableDaily && { id: "daily", label: "日榜" },
        ].filter(Boolean),
        bounds: {
          weekly: periodBounds("weekly"),
          monthly: periodBounds("monthly"),
          total: periodBounds("total"),
        },
      });
    }

    if (req.method === "GET" && action === "me") {
      const profile = await authCompanion(req);
      if (!profile) return json(res, 401, { ok: false, message: "请先登录陪玩账号" });
      const data = await companionPopularityMe(profile.id);
      return json(res, 200, data);
    }

    if (req.method === "GET" && action === "companion") {
      const id = String(req.query.id || req.query.companionId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少陪玩 ID" });
      // Resolve P100001 -> user_id
      let companionId = id;
      if (/^P\d+$/i.test(id) || /^\d+$/.test(id)) {
        const uid = String(id).replace(/^P/i, "");
        const rows = await supabaseJson(
          restUrl("companion_profiles", `?companion_uid=eq.${encodeURIComponent(uid)}&select=user_id&limit=1`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        if (rows?.[0]?.user_id) companionId = rows[0].user_id;
      }
      const data = await companionPopularityMe(companionId);
      return json(res, 200, data);
    }

    if (req.method === "POST" && action === "recompute_cron") {
      // Optional cron secret
      const secret = process.env.POPULARITY_CRON_SECRET || "";
      const provided = String(req.headers["x-mcj-cron-secret"] || req.query.secret || "").trim();
      if (secret && provided !== secret) {
        return json(res, 401, { ok: false, message: "无权触发" });
      }
      const result = await recomputePopularity({});
      return json(res, 200, result);
    }

    if (req.method === "POST" && action === "favorite") {
      const token = String(req.headers["x-mcj-access-token"] || req.headers.authorization || "")
        .replace(/^Bearer\s+/i, "")
        .trim();
      if (!token) return json(res, 401, { ok: false, message: "请先登录老板账号" });
      let body = req.body;
      if (!body || typeof body !== "object") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          body = {};
        }
      }
      const companionId = String(body.companionId || body.companion_id || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "缺少陪玩" });
      const user = await supabaseJson(`${envValue("SUPABASE_URL")}/auth/v1/user`, {
        headers: {
          apikey: envValue("SUPABASE_ANON_KEY") || envValue("SUPABASE_SERVICE_ROLE_KEY"),
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => null);
      if (!user?.id) return json(res, 401, { ok: false, message: "登录已失效" });
      await supabaseJson(restUrl("companion_favorites", "?on_conflict=boss_id,companion_id"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
        body: JSON.stringify({ boss_id: user.id, companion_id: companionId, created_at: new Date().toISOString() }),
      });
      const { scheduleRecomputeSoft } = await import("./_popularity.js");
      scheduleRecomputeSoft();
      return json(res, 200, { ok: true, message: "已收藏（同一老板仅计分一次）" });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/popularity-ranking.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "人气榜异常" });
  }
}
