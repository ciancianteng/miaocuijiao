/**
 * Generic backfill: sync ALL formally approved companions into public listing.
 *
 * SAFETY: status-only. NEVER overwrites nickname/game/price/level/media/tags
 * with null / "" / 0 / defaults. Only fills missing companion_code and missing level.
 *
 * Usage: node scripts/backfill-approved-companion-listing.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeCompanionProfilePatch,
  evaluatePublishGate,
  isFormallyApproved,
  listingBlockReason,
  listingStatusOnlyPatch,
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

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function rest(tableQuery, init = {}) {
  const res = await fetch(`${url}/rest/v1/${tableQuery}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(body?.message || body?.hint || text || `HTTP ${res.status}`);
  return body;
}

async function patchCompanion(id, patch) {
  const body = { ...patch };
  delete body.listing_synced_at;
  delete body.is_visible;
  delete body.is_published;
  return rest(`companion_profiles?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function formatPw(n) {
  return "PW" + String(n).padStart(5, "0");
}

async function nextCompanionCode() {
  try {
    const rpc = await rest("rpc/mcj_allocate_companion_code", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const code = typeof rpc === "string" ? rpc : rpc?.mcj_allocate_companion_code || rpc?.code || "";
    if (/^PW\d+$/i.test(String(code || "").trim())) return String(code).trim().toUpperCase();
  } catch {
    /* scan fallback */
  }
  const rows = await rest(
    "companion_profiles?select=companion_code&companion_code=not.is.null&order=companion_code.desc&limit=500"
  );
  let next = 1;
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = String(row.companion_code || "").match(/^PW0*(\d+)$/i);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return formatPw(next);
}

function isBanned(profile = {}) {
  const st = String(profile.status || "").trim().toLowerCase();
  return /disabled|banned|frozen|blocked|suspended|deleted/.test(st);
}

async function main() {
  const rows = await rest("companion_profiles?select=*&order=created_at.asc&limit=500");
  const all = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(all.map((r) => r.user_id).filter(Boolean))];
  const profiles = userIds.length
    ? await rest(
        `profiles?id=in.(${userIds.map(encodeURIComponent).join(",")})&select=id,email,display_name,status,role`
      )
    : [];
  const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  // Eligible for publish sync: formally approved application, not banned/deleted.
  const list = all.filter((r) => {
    if (!isFormallyApproved(r)) return false;
    const p = profileMap[r.user_id] || {};
    if (isBanned(p)) return false;
    return true;
  });

  console.log(`Found ${list.length} formally approved (unbanned) companions to sync`);
  const results = [];
  const now = new Date().toISOString();
  let ok = 0;
  let fail = 0;

  for (const row of list) {
    const beforeProfile = profileMap[row.user_id] || { role: "companion", status: "active" };
    const beforeGate = evaluatePublishGate(row, beforeProfile, {});
    // STATUS-ONLY: never touch nickname/game/price/media/tags/voice/gender/…
    const extra = {
      // Preserve current online_status — do not force offline.
      online_status: row.online_status || "offline",
      fillDefaultLevel: true,
    };
    if (!row.companion_code) {
      try {
        extra.companion_code = await nextCompanionCode();
      } catch (err) {
        console.warn("code alloc failed", row.id, err.message);
      }
    }
    const patch = listingStatusOnlyPatch(row, extra);
    patch.updated_at = now;

    let afterRow = row;
    try {
      const patched = await patchCompanion(row.id, patch);
      afterRow = Array.isArray(patched) && patched[0] ? patched[0] : { ...row, ...patch };
    } catch (err) {
      fail += 1;
      console.error("patch failed", row.companion_code || row.id, err.message);
      results.push({
        id: row.id,
        code: row.companion_code,
        nickname: row.nickname,
        ok: false,
        error: err.message,
      });
      continue;
    }

    if (row.user_id) {
      try {
        // Status-only patch — must not overwrite profiles.role (dual-role safe).
        await rest(`profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
          method: "PATCH",
          body: JSON.stringify(activeCompanionProfilePatch()),
        });
        profileMap[row.user_id] = {
          ...(profileMap[row.user_id] || {}),
          ...activeCompanionProfilePatch(),
          id: row.user_id,
        };
      } catch (err) {
        console.warn("profile patch failed", row.user_id, err.message);
      }
    }

    try {
      await rest(`companion_media?companion_profile_id=eq.${encodeURIComponent(row.id)}&status=neq.approved`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved", updated_at: now }),
      });
    } catch {
      /* optional */
    }

    const profile = profileMap[row.user_id] || { role: "companion", status: "active" };
    const gate = evaluatePublishGate(afterRow, profile, {});
    const item = {
      id: row.id,
      user_id: row.user_id,
      code: afterRow.companion_code || patch.companion_code || row.companion_code,
      nickname: afterRow.nickname || row.nickname,
      beforeHall: !!beforeGate.hallVisible,
      afterHall: !!gate.hallVisible,
      canWork: !!gate.canWork,
      statusLabel: gate.statusLabel,
      blockReason: listingBlockReason(gate),
      softMissing: gate.softMissing,
      criticalMissing: gate.criticalMissing,
      allow_orders: afterRow.allow_orders !== false,
      application_status: afterRow.application_status,
      ok: true,
    };
    if (item.afterHall) ok += 1;
    else fail += 1;
    results.push(item);
    console.log(
      item.afterHall ? "LIST" : "HIDE",
      item.code,
      item.nickname,
      item.statusLabel,
      item.blockReason || ""
    );
  }

  const outPath = path.join(ROOT, "scripts", "backfill-approved-companion-listing-results.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: now,
        processed: results.length,
        success: ok,
        failed: fail,
        results,
      },
      null,
      2
    )
  );
  console.log("Wrote", outPath);
  console.log(`Hall visible after sync: ${ok}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
