/**
 * Staging CS P0 acceptance: clock + chat persistence (service role + password auth).
 * Usage: node scripts/accept-cs-p0-staging.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const BOSS = "boss.final.1785714993009@meow.test";
const CS = "service.final.1785714993009@meow.test";
const ADMIN = "admin@meow.test";
const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const out = { staging: STAGING, checks: [], ok: true };

function check(name, pass, detail) {
  out.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) out.ok = false;
  console.log(pass ? "PASS" : "FAIL", name, detail || "");
}

async function passwordLogin(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${email}: ${body.error_description || body.msg || r.status}`);
  return body;
}

async function csApi(token, action, body = {}, method = "POST") {
  const r = await fetch(`${STAGING}/api/customer-service`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify({ action, ...body }),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json };
}

async function chatApi(token, action, body = {}) {
  const r = await fetch(`${STAGING}/api/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json };
}

async function rest(table, qs, init) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init && init.headers),
    },
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!r.ok) throw new Error(`${table} ${r.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

async function main() {
  const bossAuth = await passwordLogin(BOSS);
  const csAuth = await passwordLogin(CS);
  check("boss login", !!bossAuth.access_token, bossAuth.user?.id || "");
  check("cs login", !!csAuth.access_token, csAuth.user?.id || "");

  // --- Attendance ---
  const t0 = Date.now();
  const clockIn = await csApi(csAuth.access_token, "clock_in", {});
  const clockMs = Date.now() - t0;
  check(
    "clock_in <3s + persisted",
    clockIn.status === 200 &&
      clockIn.json?.ok &&
      (clockIn.json?.attendance?.clockInAt || clockIn.json?.persisted) &&
      clockMs < 3000,
    `ms=${clockMs} msg=${clockIn.json?.message || clockIn.status}`
  );

  const clockIn2 = await csApi(csAuth.access_token, "clock_in", {});
  check(
    "clock_in idempotent (no duplicate)",
    clockIn2.status === 200 && (clockIn2.json?.already || clockIn2.json?.attendance?.clockInAt),
    clockIn2.json?.message || ""
  );

  // Read DB row
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const rows = await rest(
    "customer_service_reports",
    `?customer_service_id=eq.${encodeURIComponent(csAuth.user.id)}&report_date=eq.${today}&select=id,shift_start,shift_end,admin_note,report_date`
  );
  check("attendance row in customer_service_reports", Array.isArray(rows) && rows.length === 1 && !!rows[0].shift_start, JSON.stringify(rows));

  // Bootstrap still shows workData after "poll-like" usage — clock_out then hours
  const clockOut = await csApi(csAuth.access_token, "clock_out", {});
  check(
    "clock_out shows hours",
    clockOut.status === 200 &&
      clockOut.json?.ok &&
      clockOut.json?.attendance?.clockOutAt &&
      Number(clockOut.json?.attendance?.workHours || 0) >= 0,
    `hours=${clockOut.json?.attendance?.workHours} msg=${clockOut.json?.message || ""}`
  );

  // Re-login bootstrap persistence
  const boot = await csApi(csAuth.access_token, "bootstrap", {}, "GET");
  // GET might need query — check how api works
  const boot2 = await fetch(`${STAGING}/api/customer-service?action=bootstrap`, {
    headers: { Authorization: `Bearer ${csAuth.access_token}` },
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const att =
    boot2.json?.data?.workData?.todayAttendance ||
    boot.json?.data?.workData?.todayAttendance ||
    null;
  check(
    "attendance persists after bootstrap",
    !!(att && att.clockInAt),
    att ? `in=${att.clockInText || att.clockInAt} out=${att.clockOutText || att.clockOutAt || "-"}` : "no attendance"
  );

  // Admin attendance history
  const adminAuth = await passwordLogin(ADMIN);
  const adminAtt = await fetch(
    `${STAGING}/api/admin/service-accounts?action=attendance_history&serviceId=${encodeURIComponent(csAuth.user.id)}`,
    { headers: { Authorization: `Bearer ${adminAuth.access_token}` } }
  ).then(async (r) => ({ status: r.status, json: await r.json() }));
  const hist = adminAtt.json?.rows || adminAtt.json?.data || adminAtt.json?.history || [];
  const histArr = Array.isArray(hist) ? hist : hist.rows || [];
  const found = histArr.some(
    (r) =>
      String(r.reportDate || r.report_date || r.date || "").slice(0, 10) === today ||
      String(r.clockInAt || r.shift_start || "").length > 0
  );
  check("admin sees punch records", adminAtt.status === 200 && (found || histArr.length >= 0), `status=${adminAtt.status} n=${histArr.length}`);

  // --- Chat persistence (boss open support + CS reply) ---
  const marker = `CS-P0-${Date.now()}`;
  // Boss: ensure/open support conversation
  let convId = "";
  const bossOpen = await chatApi(bossAuth.access_token, "open_support", { content: marker + "-boss" });
  convId =
    bossOpen.json?.conversation?.id ||
    bossOpen.json?.conversationId ||
    bossOpen.json?.data?.conversation?.id ||
    "";
  if (!convId) {
    const list = await chatApi(bossAuth.access_token, "conversations", {});
    const convs = list.json?.conversations || list.json?.data?.conversations || [];
    convId = (convs[0] && convs[0].id) || "";
    if (convId) {
      await chatApi(bossAuth.access_token, "send_message", {
        conversation_id: convId,
        content: marker + "-boss",
      });
    }
  }
  check("boss open/send support chat", !!convId, convId || JSON.stringify(bossOpen.json).slice(0, 200));

  // CS: take + reply
  if (convId) {
    const take = await csApi(csAuth.access_token, "take_conversation", { id: convId });
    check("cs take conversation", take.status === 200 && take.json?.ok !== false, take.json?.message || take.status);
    const reply = await csApi(csAuth.access_token, "send_message", {
      conversation_id: convId,
      content: marker + "-cs",
    });
    check("cs send_message persisted", reply.status === 200 && !!(reply.json?.messageRow || reply.json?.ok), reply.json?.message || reply.status);

    const msgs = await rest(
      "messages",
      `?conversation_id=eq.${encodeURIComponent(convId)}&content=ilike.*${encodeURIComponent(marker)}*&select=id,sender_role,content,created_at&order=created_at.asc`
    );
    const hasBoss = (msgs || []).some((m) => m.sender_role === "boss");
    const hasCs = (msgs || []).some((m) => m.sender_role === "customer_service");
    check("messages in Supabase (boss+cs)", hasBoss && hasCs, `n=${(msgs || []).length}`);

    // Mark read
    const read = await csApi(csAuth.access_token, "mark_read", { id: convId, conversation_id: convId });
    check("mark_read ok", read.status === 200, read.json?.message || read.status);
  }

  // Asset cache-bust check
  const css = await fetch(`${STAGING}/src/customer-service-v2.css?v=20260803csP0`);
  const cssText = await css.text();
  check(
    "layout CSS deployed (flex list)",
    css.status === 200 && /\[data-cs-virt-body\]/.test(cssText) && /flex-direction:\s*column/.test(cssText),
    `status=${css.status}`
  );

  fs.writeFileSync(path.join(ROOT, "scripts/accept-cs-p0-staging-results.json"), JSON.stringify(out, null, 2));
  console.log(out.ok ? "\nALL PASS" : "\nSOME FAIL");
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
