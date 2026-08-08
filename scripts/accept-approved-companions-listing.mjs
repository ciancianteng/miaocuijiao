/**
 * Acceptance: all formally approved (unbanned) companions appear in public hall API.
 * Criterion: approvedCount === hallCount
 *
 * Usage: node scripts/accept-approved-companions-listing.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePublishGate,
  isFormallyApproved,
  listingBlockReason,
} from "../server/api/_companion-listing-sync.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = String(
  process.argv[2] || process.env.PREVIEW_URL || "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(tableQuery) {
  const res = await fetch(`${url}/rest/v1/${tableQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body;
}

function isBanned(profile = {}) {
  const st = String(profile.status || "").trim().toLowerCase();
  return /disabled|banned|frozen|blocked|suspended|deleted/.test(st);
}

async function main() {
  if (!url || !key) throw new Error("Missing SUPABASE env");

  const rows = await rest("companion_profiles?select=*&order=created_at.asc&limit=500");
  const all = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(all.map((r) => r.user_id).filter(Boolean))];
  const profiles = userIds.length
    ? await rest(
        `profiles?id=in.(${userIds.map(encodeURIComponent).join(",")})&select=id,email,display_name,status,role`
      )
    : [];
  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  const approvedEligible = [];
  const hidden = [];
  for (const row of all) {
    if (!isFormallyApproved(row)) continue;
    const profile = profileMap[row.user_id] || {};
    if (isBanned(profile)) continue;
    const gate = evaluatePublishGate(row, profile, {});
    const item = {
      id: row.id,
      user_id: row.user_id,
      code: row.companion_code || null,
      nickname: row.nickname || profile.display_name || "",
      application_status: row.application_status,
      allow_orders: row.allow_orders !== false,
      profile_status: profile.status || null,
      profile_role: profile.role || null,
      hallVisible: !!gate.hallVisible,
      canWork: !!gate.canWork,
      blockReason: listingBlockReason(gate) || "",
      statusLabel: gate.statusLabel,
    };
    approvedEligible.push(item);
    if (!gate.hallVisible) hidden.push(item);
  }

  const pub = await (await fetch(`${BASE}/api/public/companions`, { cache: "no-store" })).json();
  const hall = Array.isArray(pub.companions) ? pub.companions : [];
  const hallIds = new Set(hall.map((c) => String(c.id || c.uid || "")));
  const hallCodes = new Set(hall.map((c) => String(c.publicId || "").toUpperCase()).filter(Boolean));

  const missingFromHallApi = approvedEligible.filter((a) => {
    const byUser = a.user_id && hallIds.has(String(a.user_id));
    const byCode = a.code && hallCodes.has(String(a.code).toUpperCase());
    return !byUser && !byCode;
  });

  const approvedCount = approvedEligible.length;
  const hallCount = hall.length;
  const gateVisibleCount = approvedEligible.filter((a) => a.hallVisible).length;
  const pass =
    approvedCount === hallCount &&
    approvedCount === gateVisibleCount &&
    missingFromHallApi.length === 0 &&
    hidden.length === 0;

  const report = {
    at: new Date().toISOString(),
    base: BASE,
    pass,
    criterion: "approvedCount === hallCount === gateVisibleCount",
    approvedCount,
    hallCount,
    gateVisibleCount,
    homeSourceCount: hallCount,
    homeNote: "Homepage recommendation data source = /api/public/companions (UI may show top 3 only).",
    approvedList: approvedEligible.map((a) => ({
      code: a.code,
      nickname: a.nickname,
      user_id: a.user_id,
      id: a.id,
      hallVisible: a.hallVisible,
    })),
    hallList: hall.map((c) => ({
      code: c.publicId,
      nickname: c.name,
      user_id: c.id,
      hallVisible: c.hallVisible,
      publishStatus: c.publishStatus,
    })),
    hidden,
    missingFromHallApi,
  };

  const outPath = path.join(ROOT, "scripts", "accept-approved-companions-listing-results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(pass ? "ACCEPT PASS" : "ACCEPT FAIL", `approved=${approvedCount} hall=${hallCount}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
