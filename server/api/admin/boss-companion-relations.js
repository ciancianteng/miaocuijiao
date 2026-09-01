/**
 * Admin · Boss ↔ Companion 直属关系
 * Write: bind / rebind / unbind（仅 Admin）
 * Read: list / search / history
 * Ensure: apply Staging migration when DATABASE_URL present (ref=cfccwysniduwkjskiqgy only)
 */
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../_admin-auth.js";
import {
  adminSearchRelations,
  bindRelation,
  enrichEvents,
  enrichRelations,
  isRelationsMissing,
  listRelationEvents,
  listRelations,
  rebindRelation,
  resolveBossIdFromInput,
  resolveCompanionIdFromInput,
  unbindRelation,
} from "../_boss-companion-relations.js";
import { loadLocalEnv } from "../_load-env.js";

loadLocalEnv();

/** Staging Supabase project — refuse Production. */
const STAGING_PROJECT_REF = "cfccwysniduwkjskiqgy";
const MIGRATION_REL = "supabase/migrations/20260901_boss_companion_relations.sql";

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  return res.status(status).json(data);
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

function actionOf(req, body = {}) {
  const url = new URL(req.url || "/", "http://localhost");
  return String(body.action || req.query?.action || url.searchParams.get("action") || "")
    .trim()
    .toLowerCase();
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname || "";
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function projectRefFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(String(dbUrl || ""));
    const host = (u.hostname || "").toLowerCase();
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    return "";
  } catch {
    return "";
  }
}

async function ensureMigration() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "").trim();
  const urlRef = projectRefFromUrl(supabaseUrl);
  const dbRef = projectRefFromDatabaseUrl(databaseUrl);

  if (urlRef && urlRef !== STAGING_PROJECT_REF) {
    return {
      ok: false,
      skipped: true,
      message: `拒绝执行：SUPABASE_URL 项目 ${urlRef} 不是 Staging（${STAGING_PROJECT_REF}）`,
    };
  }
  if (dbRef && dbRef !== STAGING_PROJECT_REF) {
    return {
      ok: false,
      skipped: true,
      message: `拒绝执行：DATABASE_URL 项目 ${dbRef} 不是 Staging（${STAGING_PROJECT_REF}）。Production 禁止触碰。`,
    };
  }
  if (!databaseUrl) {
    return {
      ok: false,
      skipped: true,
      tablesReady: false,
      message:
        "未配置 DATABASE_URL，无法在线执行 DDL。请在 Staging Supabase SQL Editor（cfccwysniduwkjskiqgy）执行 supabase/migrations/20260901_boss_companion_relations.sql",
      stagingRef: STAGING_PROJECT_REF,
      migration: MIGRATION_REL,
    };
  }
  if (!urlRef && !dbRef) {
    return {
      ok: false,
      skipped: true,
      message: "无法从 SUPABASE_URL / DATABASE_URL 确认项目 ref，拒绝执行",
    };
  }

  const sqlPath = path.join(process.cwd(), MIGRATION_REL);
  if (!fs.existsSync(sqlPath)) {
    return { ok: false, message: `migration 文件不存在：${MIGRATION_REL}` };
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  return {
    ok: true,
    tablesReady: true,
    message: "已在 Staging 执行 boss_companion_relations migration",
    stagingRef: STAGING_PROJECT_REF,
    migration: MIGRATION_REL,
  };
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  const body = req.method === "GET" ? {} : await parseBody(req);
  const action = actionOf(req, body) || (req.method === "GET" ? "list" : "");

  try {
    if (action === "ensure" && (req.method === "POST" || req.method === "PUT")) {
      const result = await ensureMigration();
      return json(res, result.ok ? 200 : 200, result);
    }

    if (action === "list" || action === "search") {
      const url = new URL(req.url || "/", "http://localhost");
      const q = String(body.q || req.query?.q || url.searchParams.get("q") || "").trim();
      const status = String(body.status || req.query?.status || url.searchParams.get("status") || "").trim();
      const limit = Number(body.limit || req.query?.limit || url.searchParams.get("limit") || 100);
      let relations;
      try {
        relations = q
          ? await adminSearchRelations({ q, status, limit })
          : await enrichRelations(await listRelations({ status, limit }));
      } catch (error) {
        if (isRelationsMissing(error)) {
          return json(res, 200, {
            ok: true,
            tablesReady: false,
            relations: [],
            message: "直属关系表未初始化，请先执行 ensure / Staging migration",
          });
        }
        throw error;
      }
      return json(res, 200, { ok: true, tablesReady: true, relations, message: "" });
    }

    if (action === "history" || action === "events") {
      const url = new URL(req.url || "/", "http://localhost");
      const companionRaw = String(
        body.companionId || body.companion_id || req.query?.companionId || url.searchParams.get("companionId") || ""
      ).trim();
      const relationId = String(
        body.relationId || body.relation_id || req.query?.relationId || url.searchParams.get("relationId") || ""
      ).trim();
      const companionId = companionRaw ? await resolveCompanionIdFromInput(companionRaw) : "";
      if (!companionId && !relationId) {
        return json(res, 400, { ok: false, message: "请提供 companionId 或 relationId" });
      }
      let events;
      try {
        events = await enrichEvents(
          await listRelationEvents({ companionId, relationId, limit: Number(body.limit || 100) })
        );
      } catch (error) {
        if (isRelationsMissing(error)) {
          return json(res, 200, { ok: true, tablesReady: false, events: [], message: "直属关系表未初始化" });
        }
        throw error;
      }
      return json(res, 200, { ok: true, tablesReady: true, events, message: "" });
    }

    if (action === "bind" && (req.method === "POST" || req.method === "PUT")) {
      const bossId = await resolveBossIdFromInput(body.bossId || body.boss_id || body.bossUid || body.boss_uid);
      const companionId = await resolveCompanionIdFromInput(
        body.companionId || body.companion_id || body.companionCode || body.companion_code
      );
      if (!bossId) return json(res, 400, { ok: false, message: "无法解析老板（请用 profiles.id 或 boss_uid）" });
      if (!companionId) return json(res, 400, { ok: false, message: "无法解析陪玩（请用 profiles.id 或 companion_code）" });
      const result = await bindRelation({
        bossId,
        companionId,
        operatorId: admin.id,
        remark: body.remark || "",
      });
      return json(res, 200, { ok: true, ...result, message: "绑定成功" });
    }

    if (action === "rebind" && (req.method === "POST" || req.method === "PUT")) {
      const companionId = await resolveCompanionIdFromInput(
        body.companionId || body.companion_id || body.companionCode || body.companion_code
      );
      const newBossId = await resolveBossIdFromInput(
        body.newBossId || body.new_boss_id || body.bossId || body.boss_id || body.bossUid
      );
      if (!companionId) return json(res, 400, { ok: false, message: "无法解析陪玩" });
      if (!newBossId) return json(res, 400, { ok: false, message: "无法解析新老板" });
      const result = await rebindRelation({
        companionId,
        newBossId,
        operatorId: admin.id,
        remark: body.remark || "",
      });
      return json(res, 200, { ok: true, ...result, message: "换绑成功" });
    }

    if (action === "unbind" && (req.method === "POST" || req.method === "PUT")) {
      const companionId = await resolveCompanionIdFromInput(
        body.companionId || body.companion_id || body.companionCode || body.companion_code
      );
      if (!companionId) return json(res, 400, { ok: false, message: "无法解析陪玩" });
      const result = await unbindRelation({
        companionId,
        operatorId: admin.id,
        remark: body.remark || "",
      });
      return json(res, 200, { ok: true, ...result, message: "已解绑" });
    }

    return json(res, 400, {
      ok: false,
      message: "未知操作。支持：list/search/history/bind/rebind/unbind/ensure",
      action,
    });
  } catch (err) {
    if (isRelationsMissing(err)) {
      return json(res, 200, {
        ok: false,
        tablesReady: false,
        message: "直属关系表未初始化，请先在 Staging 执行 migration / ensure",
      });
    }
    return json(res, err.status || 500, {
      ok: false,
      message: err.message || "操作失败",
      code: err.code || "",
      activeRelationId: err.activeRelationId || undefined,
      activeBossId: err.activeBossId || undefined,
    });
  }
}
