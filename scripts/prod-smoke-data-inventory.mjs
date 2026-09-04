/**
 * READ-ONLY inventory of Production smoke/test accounts and related rows.
 *
 * Usage:
 *   ALLOW_PROD_SUPABASE_READ=1 CONFIRM_PROD_READ=I_UNDERSTAND_PROD_READ \
 *   PROD_SUPABASE_URL=https://jqfaknpmcnqwqvatrwgo.supabase.co \
 *   PROD_SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/prod-smoke-data-inventory.mjs
 *
 * Writes nothing. Outputs JSON manifest under artifacts/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_SUPABASE_REF,
  assertProductionSupabaseReadAllowed,
  loadEnvFiles,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);

const URL = (
  process.env.PROD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SERVICE = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Known contamination IDs from 2026-09-02 Production OTP smoke (incident report). */
const KNOWN_CONTAMINATION_USER_IDS = Object.freeze([
  "6d368f4b-7f33-4923-9441-c63cecef2070", // ProdSmokeInviter2
  "9f7fb39a-bec8-47cc-974a-e314ac2f5cd5", // ProdSmokeService2
  "0664ef55-de58-48e3-8dbb-ca8111318e91", // ProdSmokeBoss2
]);

const RETAIN_BY_DEFAULT = new Set(["admin@meow.test"]);

const EMAIL_HINT_RE =
  /@meow\.test\b|@mcj-prod-smoke\.invalid\b|smoke|fixture|demo|mock|ui\.accept\.|prodsmoke|test@|@test\./i;
const NAME_HINT_RE = /smoke|fixture|demo|mock|prodsmoke|测试账号|假陪玩/i;

function headers(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) {
    const err = new Error(`${method} ${table} ${r.status}: ${String(text).slice(0, 300)}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function countOrZero(table, qs) {
  try {
    const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
      method: "HEAD",
      headers: {
        ...headers(),
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    const range = r.headers.get("content-range") || "";
    const m = range.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]);
    // Fallback GET
    const rows = await rest(table, qs.includes("select=") ? qs : `${qs}${qs.includes("?") ? "&" : "?"}select=id`);
    return Array.isArray(rows) ? rows.length : 0;
  } catch (e) {
    if (/PGRST205|does not exist|schema cache|404/i.test(String(e.message || e))) return null;
    return { error: String(e.message || e).slice(0, 160) };
  }
}

function isCandidateProfile(p) {
  if (!p) return false;
  if (p.is_test_account === true || p.is_test === true) return true;
  if (KNOWN_CONTAMINATION_USER_IDS.includes(p.id)) return true;
  const email = String(p.email || "");
  const name = String(p.display_name || p.nickname || "");
  if (EMAIL_HINT_RE.test(email)) return true;
  if (NAME_HINT_RE.test(name)) return true;
  return false;
}

async function loadAllProfiles() {
  const out = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const rows = await rest(
      "profiles",
      `?select=id,email,role,status,display_name,avatar_url,is_test_account,created_at&order=created_at.asc&limit=${page}&offset=${offset}`
    );
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}

async function relatedCounts(userId, companionProfileId) {
  const uid = encodeURIComponent(userId);
  const counts = {};
  const specs = [
    ["companion_profiles", `?user_id=eq.${uid}`],
    ["companion_applications", `?user_id=eq.${uid}`],
    ["companion_media", companionProfileId ? `?companion_profile_id=eq.${encodeURIComponent(companionProfileId)}` : `?user_id=eq.${uid}`],
    ["companion_identity_verifications", companionProfileId ? `?companion_profile_id=eq.${encodeURIComponent(companionProfileId)}` : `?user_id=eq.${uid}`],
    ["companion_payment_accounts", `?user_id=eq.${uid}`],
    ["companion_withdrawals", `?companion_id=eq.${uid}`],
    ["companion_earnings", `?companion_id=eq.${uid}`],
    ["companion_reviews", `?companion_id=eq.${uid}`],
    ["companion_notifications", `?companion_id=eq.${uid}`],
    ["orders_as_boss", `?boss_id=eq.${uid}`, "orders"],
    ["orders_as_companion", `?companion_id=eq.${uid}`, "orders"],
    ["transactions", `?or=(user_id.eq.${uid},boss_id.eq.${uid},companion_id.eq.${uid})`],
    ["boss_companion_relations_as_boss", `?boss_id=eq.${uid}`, "boss_companion_relations"],
    ["boss_companion_relations_as_companion", `?companion_id=eq.${uid}`, "boss_companion_relations"],
    ["boss_commission_earnings", `?boss_id=eq.${uid}`],
    ["invitations", `?or=(inviter_id.eq.${uid},invitee_id.eq.${uid})`],
    ["companion_referral_relations", `?or=(inviter_id.eq.${uid},invitee_id.eq.${uid})`],
    ["wallets", `?user_id=eq.${uid}`],
    ["messages_sent", `?sender_id=eq.${uid}`, "messages"],
  ];

  for (const [key, qs, table] of specs) {
    const t = table || key;
    counts[key] = await countOrZero(t, qs);
  }
  return counts;
}

async function listStorageHints(userId) {
  // Best-effort: list object paths under known buckets if Storage list API works.
  const buckets = ["companion-public", "companion-gallery", "companion-identities", "avatars", "companion-audio", "companion-video"];
  const hits = [];
  for (const bucket of buckets) {
    try {
      const r = await fetch(`${URL}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ prefix: `${userId}/`, limit: 100 }),
      });
      const text = await r.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!r.ok) continue;
      const files = Array.isArray(body) ? body : [];
      if (files.length) {
        hits.push({
          bucket,
          count: files.length,
          sample: files.slice(0, 5).map((f) => f.name || f.id || f),
        });
      }
    } catch {
      /* ignore */
    }
  }
  return hits;
}

async function main() {
  if (!URL || !SERVICE) {
    throw new Error("Missing PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_*)");
  }
  assertProductionSupabaseReadAllowed("prod-smoke-data-inventory.mjs", URL);
  if (supabaseProjectRef(URL) !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing inventory: expected Production ref ${PRODUCTION_SUPABASE_REF}, got ${supabaseProjectRef(URL)}`);
  }

  const profiles = await loadAllProfiles();
  const candidates = profiles.filter(isCandidateProfile);

  const manifest = [];
  for (const p of candidates) {
    const email = String(p.email || "").toLowerCase();
    const cpRows = await rest(
      "companion_profiles",
      `?user_id=eq.${encodeURIComponent(p.id)}&select=id,nickname,status,is_test_account,card_image_url,avatar_url&limit=5`
    ).catch(() => []);
    const cp = Array.isArray(cpRows) ? cpRows[0] : null;
    const counts = await relatedCounts(p.id, cp?.id || "");
    const storage = await listStorageHints(p.id);
    const totalRelated = Object.values(counts).reduce((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
    manifest.push({
      userId: p.id,
      email,
      role: p.role || "",
      status: p.status || "",
      displayName: p.display_name || "",
      isTestAccount: p.is_test_account === true,
      companionProfileId: cp?.id || null,
      companionNickname: cp?.nickname || null,
      retainByDefault: RETAIN_BY_DEFAULT.has(email),
      knownContamination: KNOWN_CONTAMINATION_USER_IDS.includes(p.id),
      relatedCounts: counts,
      relatedTotal: totalRelated,
      storageObjects: storage,
      createdAt: p.created_at || null,
    });
  }

  manifest.sort((a, b) => Number(b.knownContamination) - Number(a.knownContamination) || b.relatedTotal - a.relatedTotal);

  const summary = {
    ok: true,
    mode: "inventory_readonly",
    supabaseRef: supabaseProjectRef(URL),
    scannedProfiles: profiles.length,
    candidateCount: manifest.length,
    retainByDefault: [...RETAIN_BY_DEFAULT],
    deleteCandidates: manifest.filter((m) => !m.retainByDefault).length,
    knownContaminationHits: manifest.filter((m) => m.knownContamination).length,
    generatedAt: new Date().toISOString(),
    note:
      "DRY inventory only. Do NOT delete until human confirms. Default retain: admin@meow.test (bootstrap). Purge via scripts/prod-smoke-data-purge.mjs after confirm.",
    accounts: manifest,
  };

  const outDir = path.join(root, "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `prod-smoke-inventory-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join("/opt/cursor/artifacts", path.basename(outFile)), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({
    ok: true,
    outFile,
    scannedProfiles: summary.scannedProfiles,
    candidateCount: summary.candidateCount,
    deleteCandidates: summary.deleteCandidates,
    retainByDefault: summary.retainByDefault,
    knownContaminationHits: summary.knownContaminationHits,
    preview: manifest.slice(0, 30).map((m) => ({
      email: m.email,
      role: m.role,
      userId: m.userId,
      companionProfileId: m.companionProfileId,
      relatedTotal: m.relatedTotal,
      retainByDefault: m.retainByDefault,
      knownContamination: m.knownContamination,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
