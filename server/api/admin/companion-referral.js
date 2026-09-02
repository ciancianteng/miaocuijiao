/**
 * Admin: Companion referral rebate tables (Staging ensure + status).
 * Never touches Production. Separate from companion_income / Boss commission.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAdmin } from "../_admin-auth.js";
import {
  isReferralMissing,
  listReferralRecordsForInviter,
  REL_TABLE,
  RULE_TABLE,
  REC_TABLE,
  WALLET_TABLE,
  upsertCompanionBossReferral,
  getReferralWallet,
} from "../_companion-referral.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "../_wallet.js";

const STAGING_PROJECT_REF = "cfccwysniduwkjskiqgy";
const PRODUCTION_PROJECT_REF = "jqfaknpmcnqwqvatrwgo";
const MIGRATION_REL = "supabase/migrations/20260904_companion_referral_rebate.sql";
const BUNDLED_RELS = ["server/api/_sql/20260904_companion_referral_rebate.sql"];
const MGMT_QUERY = `https://api.supabase.com/v1/projects/${STAGING_PROJECT_REF}/database/query`;

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
  return String(body.action || req.query?.action || url.searchParams.get("action") || "").trim();
}

function projectRefFromUrl(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function projectRefFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(dbUrl);
    const direct = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    return "";
  } catch {
    return "";
  }
}

function buildStagingPoolerUrl(password, region = "ap-southeast-1") {
  const pass = String(password || "").trim();
  if (!pass) return "";
  const u = new URL(`postgresql://x@aws-0-${region}.pooler.supabase.com:5432/postgres`);
  u.username = `postgres.${STAGING_PROJECT_REF}`;
  u.password = pass;
  return u.toString();
}

function resolveMigrationPaths() {
  const root = process.cwd();
  const found = [];
  const missing = [];
  const candidates = [
    path.join(root, MIGRATION_REL),
    ...BUNDLED_RELS.map((rel) => path.join(root, rel)),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "_sql", "20260904_companion_referral_rebate.sql"),
  ];
  const seen = new Set();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (fs.existsSync(p)) found.push({ path: p });
    else missing.push(p);
  }
  // Deduplicate by basename — prefer first existing
  const byBase = new Map();
  for (const f of found) {
    const base = path.basename(f.path);
    if (!byBase.has(base)) byBase.set(base, f);
  }
  const unique = [...byBase.values()];
  if (!unique.length) return { ok: false, missing: missing.join(", "), found: [] };
  return { ok: true, found: unique, missing: "" };
}

function skippedNeedCredential(message) {
  return {
    ok: false,
    skipped: true,
    tablesReady: false,
    message,
    migration: MIGRATION_REL,
    stagingRef: STAGING_PROJECT_REF,
  };
}

async function applyViaManagementApi(accessToken, sql) {
  const res = await fetch(MGMT_QUERY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${parsed?.message || parsed?.error || text.slice(0, 400)}`);
  }
  return parsed;
}

async function ensureMigration(oneshot = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const oneshotDb = String(oneshot.databaseUrl || "").trim();
  const oneshotToken = String(oneshot.accessToken || "").trim();
  const oneshotPassword = String(oneshot.databasePassword || "").trim();
  let databaseUrl = String(
    oneshotDb || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || ""
  ).trim();
  if (!databaseUrl && oneshotPassword) {
    databaseUrl = buildStagingPoolerUrl(oneshotPassword);
  }
  const accessToken = String(
    oneshotToken ||
      process.env.SUPABASE_ACCESS_TOKEN ||
      process.env.SUPABASE_MANAGEMENT_TOKEN ||
      process.env.SUPABASE_PAT ||
      ""
  ).trim();
  const urlRef = projectRefFromUrl(supabaseUrl);
  const dbRef = projectRefFromDatabaseUrl(databaseUrl);
  const usedOneshot = Boolean(oneshotDb || oneshotToken || oneshotPassword);

  if (urlRef === PRODUCTION_PROJECT_REF || dbRef === PRODUCTION_PROJECT_REF) {
    return { ok: false, skipped: true, message: `拒绝执行：Production（${PRODUCTION_PROJECT_REF}）禁止触碰` };
  }
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
      message: `拒绝执行：DATABASE_URL 项目 ${dbRef} 不是 Staging（${STAGING_PROJECT_REF}）`,
    };
  }
  if (dbRef === "" && databaseUrl) {
    return { ok: false, skipped: true, message: "无法从 DATABASE_URL 解析 Staging project ref，拒绝执行" };
  }

  const resolved = resolveMigrationPaths();
  if (!resolved.ok) {
    return { ok: false, message: `migration 文件不存在：${resolved.missing}` };
  }
  const sql = resolved.found.map((f) => fs.readFileSync(f.path, "utf8")).join("\n\n");

  if (databaseUrl) {
    if (!urlRef && !dbRef) {
      return { ok: false, skipped: true, message: "无法从 SUPABASE_URL / DATABASE_URL 确认项目 ref，拒绝执行" };
    }
    const { default: pg } = await import("pg");
    const candidates = [databaseUrl];
    if (oneshotPassword && !oneshotDb) {
      for (const region of ["ap-southeast-1", "ap-northeast-1", "us-east-1", "eu-west-1"]) {
        const next = buildStagingPoolerUrl(oneshotPassword, region);
        if (next && !candidates.includes(next)) candidates.push(next);
      }
    }
    let lastErr = null;
    for (const candidate of candidates) {
      const client = new pg.Client({
        connectionString: candidate,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 12000,
      });
      try {
        await client.connect();
        try {
          await client.query(sql);
          try {
            await client.query("notify pgrst, 'reload schema'");
          } catch {
            /* optional */
          }
        } finally {
          await client.end();
        }
        return {
          ok: true,
          tablesReady: true,
          message: usedOneshot
            ? "已用一次性 Staging 凭证执行 companion referral migration（未落库保存）"
            : "已在 Staging 执行 companion referral rebate migration",
          stagingRef: STAGING_PROJECT_REF,
          migration: MIGRATION_REL,
          via: "postgres",
        };
      } catch (err) {
        lastErr = err;
        try {
          await client.end();
        } catch {
          /* ignore */
        }
      }
    }
    throw lastErr || new Error("Postgres apply failed");
  }

  if (accessToken) {
    await applyViaManagementApi(accessToken, sql);
    return {
      ok: true,
      tablesReady: true,
      message: usedOneshot
        ? "已用一次性 Supabase PAT 经 Management API 执行 Staging referral migration（未落库保存）"
        : "已经 Management API 执行 Staging companion referral migration",
      stagingRef: STAGING_PROJECT_REF,
      migration: MIGRATION_REL,
      via: "management_api",
    };
  }

  return skippedNeedCredential(
    "未配置 DATABASE_URL / SUPABASE_ACCESS_TOKEN。可一次性粘贴 Staging DB password、Postgres URI 或 PAT；或打开 Staging SQL Editor 粘贴 20260904_companion_referral_rebate.sql。"
  );
}

async function probeTables() {
  const out = {};
  const probes = [
    [REL_TABLE, "id"],
    [RULE_TABLE, "id"],
    [REC_TABLE, "id"],
    [WALLET_TABLE, "user_id"],
  ];
  for (const [table, col] of probes) {
    try {
      await supabaseJson(restUrl(table, `?select=${col}&limit=1`), { headers: serviceHeaders() });
      out[table] = { ok: true };
    } catch (err) {
      out[table] = {
        ok: false,
        missing: isReferralMissing(err) || isMissingRelation(err),
        message: String(err?.message || err).slice(0, 160),
      };
    }
  }
  const ready = Object.values(out).every((v) => v.ok);
  return { tablesReady: ready, tables: out };
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  const body = req.method === "GET" ? {} : await parseBody(req);
  const action = actionOf(req, body) || (req.method === "GET" ? "status" : "");

  try {
    if (action === "ensure" && (req.method === "POST" || req.method === "PUT")) {
      const result = await ensureMigration({
        databaseUrl: body.databaseUrl || body.DATABASE_URL || body.stagingDatabaseUrl || "",
        accessToken:
          body.accessToken || body.supabaseAccessToken || body.SUPABASE_ACCESS_TOKEN || body.pat || "",
        databasePassword:
          body.databasePassword ||
          body.dbPassword ||
          body.SUPABASE_DB_PASSWORD ||
          body.password ||
          "",
      });
      const probe = await probeTables().catch(() => null);
      return json(res, 200, { ...result, probe, adminId: admin.id });
    }

    if (action === "status" || action === "probe" || req.method === "GET") {
      const probe = await probeTables();
      return json(res, 200, {
        ok: true,
        ...probe,
        migration: MIGRATION_REL,
        stagingRef: STAGING_PROJECT_REF,
        message: probe.tablesReady ? "" : "邀请返点表未就绪，请执行 ensure",
      });
    }

    if (action === "bind" || action === "ensure_relation") {
      const companionId = String(body.companionId || body.companion_id || body.inviterUserId || "").trim();
      const bossId = String(body.bossId || body.boss_id || body.invitedUserId || "").trim();
      if (!companionId || !bossId) {
        return json(res, 400, { ok: false, message: "请提供 companionId 与 bossId" });
      }
      try {
        const row = await upsertCompanionBossReferral({
          companionId,
          bossId,
          invitationId: body.invitationId || null,
          remark: String(body.remark || body.reason || "admin:bind_referral").trim(),
          boundByAdmin: true,
        });
        const wallet = await getReferralWallet(companionId);
        return json(res, 200, { ok: true, relation: row, wallet, message: "邀请返点关系已建立" });
      } catch (err) {
        if (isReferralMissing(err)) {
          return json(res, 503, {
            ok: false,
            message: "邀请返点表未初始化",
            code: "REFERRAL_TABLES_MISSING",
            migration: MIGRATION_REL,
          });
        }
        return json(res, err.status || 400, { ok: false, message: err.message || "绑定失败" });
      }
    }

    if (action === "records") {
      const companionId = String(body.companionId || body.companion_id || req.query?.companionId || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "请提供 companionId" });
      try {
        const records = await listReferralRecordsForInviter(companionId, {
          limit: Number(body.limit || 50),
        });
        const wallet = await getReferralWallet(companionId);
        return json(res, 200, { ok: true, records, wallet });
      } catch (err) {
        if (isReferralMissing(err)) {
          return json(res, 200, { ok: true, tablesReady: false, records: [], wallet: null });
        }
        throw err;
      }
    }

    return json(res, 400, { ok: false, message: "未知 action" });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, message: err.message || "失败" });
  }
}
