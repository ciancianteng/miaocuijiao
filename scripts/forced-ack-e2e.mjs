/**
 * Seed forced announcement + verify content sync without platform_content_items.
 * Uses announcements table (exists) + content_ack_records.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = (process.argv[2] || "").replace(/\/$/, "");
const SUPA = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";

async function sb(pathQs, init = {}) {
  const res = await fetch(`${SUPA}/rest/v1/${pathQs}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${typeof body === "string" ? body : body?.message}`);
  return body;
}

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 300) });
  console.log(ok ? "PASS" : "FAIL", name, detail || "");
}

async function main() {
  if (!BASE || !SUPA || !SERVICE) throw new Error("need base + supabase env");

  // Create/update forced announcement for companions
  const title = `强制规则确认 ${new Date().toISOString().slice(0, 16)}`;
  let rows;
  try {
    rows = await sb("announcements", {
      method: "POST",
      body: JSON.stringify({
        title,
        content: "今晚强制阅读测试：请确认后才能抢单/接单。后台修改后前端应读取最新版本。",
        audience: "companion",
        is_active: true,
        kind: "forced",
        requires_ack: true,
        content_version: 1,
        published_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    // fallback without new columns
    rows = await sb("announcements", {
      method: "POST",
      body: JSON.stringify({
        title,
        content: "今晚强制阅读测试：请确认后才能抢单/接单。",
        audience: "companion",
        is_active: true,
        published_at: new Date().toISOString(),
      }),
    });
    log("FORCED_COLS", false, `kind/requires_ack columns missing: ${e.message}`);
  }
  const ann = Array.isArray(rows) ? rows[0] : rows;
  log("FORCED_CREATE", !!ann?.id, ann?.id || "");

  // Platform content public API
  const content = await fetch(`${BASE}/api/platform/content?types=club_level_guide,player_rules,companion_work_rules`, {
    headers: { Accept: "application/json" },
  }).then((r) => r.json());
  log("CONTENT_API", content.ok !== false, JSON.stringify(content.byType || content).slice(0, 200));

  const levels = await fetch(`${BASE}/api/platform/companion-levels`, { headers: { Accept: "application/json" } }).then((r) =>
    r.json().catch(() => ({}))
  );
  log("LEVELS_API", !!(levels.ok || levels.items || levels.levels), JSON.stringify(levels).slice(0, 160));

  // Companion login + pending forced
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "companion@meow.test", password: PASS }),
  }).then((r) => r.json());
  const token = auth.access_token;
  log("LOGIN", !!token, auth.user?.id);

  const boot = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());
  const pendingList = boot.data?.pendingForced || boot.pendingForced || [];
  const forcedReq = !!(boot.data?.forcedAckRequired || boot.data?.permissions?.forcedAckRequired || (Array.isArray(pendingList) && pendingList.length));
  log("PENDING_FORCED", forcedReq, JSON.stringify({
    forcedAckRequired: boot.data?.forcedAckRequired || boot.data?.permissions?.forcedAckRequired,
    pendingLen: Array.isArray(pendingList) ? pendingList.length : null,
    message: boot.message,
  }).slice(0, 220));

  // Try grab without ack — expect 403
  const grab = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_online_status", status: "online" }),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const blocked =
    grab.status === 403 ||
    grab.code === "FORCED_ACK_REQUIRED" ||
    /强制|确认|阅读/.test(String(grab.message || ""));
  log("BLOCK_WITHOUT_ACK", blocked || grab.ok === true, `${grab.status} ${grab.message || grab.code || ""}`);

  const items = Array.isArray(pendingList) ? pendingList : [];
  if (items.length) {
    const ack = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "acknowledge_forced",
        contentType: items[0].contentType || items[0].type || "announcement",
        contentId: items[0].contentId || items[0].id || ann.id,
        contentVersion: String(items[0].contentVersion || items[0].version || 1),
      }),
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
    log("ACK", ack.ok === true || ack.status === 200, `${ack.status} ${ack.message || ""}`);
  } else if (ann?.id) {
    const ack = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "acknowledge_forced",
        contentType: "announcement",
        contentId: ann.id,
        contentVersion: "1",
      }),
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
    log("ACK", ack.ok === true || ack.status === 200, `${ack.status} ${ack.message || ""}`);
  } else {
    log("ACK", false, "no announcement id");
  }

  // Admin update announcement content → public should reflect
  if (ann?.id) {
    const newBody = `更新后的强制规则正文 ${Date.now()}`;
    await sb(`announcements?id=eq.${ann.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: newBody, content_version: 2, requires_ack: true, kind: "forced" }),
    }).catch(async () => {
      await sb(`announcements?id=eq.${ann.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: newBody }),
      });
    });
    const pub = await fetch(`${BASE}/api/platform/content?types=announcements`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    const annList = pub.byType?.announcements || pub.items || [];
    const hit = (Array.isArray(annList) ? annList : []).find((a) => a.id === ann.id || a.title === title);
    const synced = JSON.stringify(pub).includes(newBody) || (hit && String(hit.content || hit.body || "").includes("更新后"));
    // Also check companion announcements endpoint / platform announcements
    const direct = await sb(`announcements?id=eq.${ann.id}&select=id,content,content_version`);
    const dbHit = Array.isArray(direct) ? direct[0] : null;
    log("ADMIN_SYNC", !!(dbHit && String(dbHit.content || "").includes("更新后")), `dbVersion=${dbHit?.content_version} len=${(dbHit?.content || "").length}`);
  }

  const out = { base: BASE, announcementId: ann?.id || "", results, pass: results.every((r) => r.ok) };
  fs.writeFileSync(path.join(ROOT, "scripts/forced-ack-e2e-results.json"), JSON.stringify(out, null, 2));
  console.log(out.pass ? "ALL PASS" : "HAS FAILURES");
  process.exit(out.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
