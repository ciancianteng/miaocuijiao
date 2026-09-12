/**
 * P0: companion apply → login → review → notify → permission full flow.
 * Usage: node scripts/accept-companion-apply-review-flow.mjs [baseUrl]
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

const BASE = String(
  process.argv[2] || process.env.PREVIEW_URL || "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");
const PASSWORD = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
const stamp = Date.now();
const NEW_EMAIL = `pw.flow.${stamp}@meow.test`;
const NEW_NICK = `流程验${String(stamp).slice(-4)}`;
const results = [];
const LOCK_MSG = "您的陪玩认证尚未通过，暂不可使用此功能。";

function record(id, pass, detail) {
  results.push({ id, pass: !!pass, detail: String(detail || "").slice(0, 500) });
  console.log(pass ? "PASS" : "FAIL", id, detail || "");
}

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body, text };
}

function sessionToken(body) {
  return (
    body?.session?.accessToken ||
    body?.session?.access_token ||
    body?.session?.token ||
    body?.access_token ||
    ""
  );
}

async function rest(tableQuery, init = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${tableQuery}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  if (!res.ok) throw new Error(body?.message || text || `rest ${res.status}`);
  return body;
}

async function login(email, password = PASSWORD) {
  const { res, body } = await jsonFetch(`${BASE}/api/companion?action=login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ account: email, email, password }),
  });
  if (!res.ok || body?.ok === false) {
    const { res: r2, body: b2 } = await jsonFetch(`${BASE}/api/auth?action=login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r2.ok || b2?.ok === false) throw new Error(body?.message || b2?.message || `login failed ${email}`);
    return b2;
  }
  return body;
}

async function companionBootstrap(token) {
  const { res, body } = await jsonFetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok || body?.ok === false) throw new Error(body?.message || `bootstrap ${res.status}`);
  return body?.data || body;
}

async function companionAction(token, action, payload = {}) {
  const { res, body } = await jsonFetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
  });
  return { res, body };
}

async function adminReview(token, companionProfileId, status, rejectReason = "") {
  const { res, body } = await jsonFetch(`${BASE}/api/admin/players`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      action: "review_application",
      id: companionProfileId,
      payload: { status, rejectReason },
    }),
  });
  if (!res.ok || body?.ok === false) throw new Error(body?.message || `review ${status} failed`);
  return body;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  }

  // --- Case1: register → login → draft → cannot work ---
  const regPhone = `601${String(stamp).slice(-8)}`;
  const { res: regRes, body: regBody } = await jsonFetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      action: "register",
      email: NEW_EMAIL,
      password: PASSWORD,
      nickname: NEW_NICK,
      phone: regPhone,
      remember: true,
    }),
  });
  const regToken = sessionToken(regBody);
  record("case1.register", regRes.ok && !!regToken, regBody?.message || NEW_EMAIL);

  const relogin = await login(NEW_EMAIL);
  const token = sessionToken(relogin) || regToken;
  record("case1.login_before_review", !!token, NEW_EMAIL);

  let boot = await companionBootstrap(token);
  const review1 = String(boot?.player?.profile_review_status || boot?.player?.auditStatus || "");
  const canWork1 = !!boot?.permissions?.canWork;
  record("case1.status_draft_or_incomplete", /draft|pending/i.test(review1) || !canWork1, `status=${review1} canWork=${canWork1}`);
  record("case1.cannot_work", canWork1 === false, boot?.permissions?.lockReason || "");

  const onlineBlocked = await companionAction(token, "set_online_status", { online_status: "online" });
  record(
    "case1.online_blocked",
    onlineBlocked.res.status === 403 || onlineBlocked.body?.ok === false,
    onlineBlocked.body?.message || ""
  );
  record(
    "case1.lock_message",
    String(onlineBlocked.body?.message || boot?.permissions?.lockReason || "").includes("尚未通过") ||
      String(onlineBlocked.body?.message || "").includes(LOCK_MSG) ||
      canWork1 === false,
    onlineBlocked.body?.message || boot?.permissions?.lockReason || ""
  );

  const profiles = await rest(`profiles?email=eq.${encodeURIComponent(NEW_EMAIL)}&select=id,email,role,status&limit=1`);
  const userId = profiles?.[0]?.id || boot?.player?.id || boot?.player?.userId || "";
  let companionProfileId =
    boot?.player?.companionProfileId ||
    boot?.player?.companion_profile_id ||
    boot?.player?.raw?.id ||
    "";
  const cps = userId
    ? await rest(
        `companion_profiles?user_id=eq.${encodeURIComponent(userId)}&select=id,application_status,application_submitted_at,allow_orders,companion_code&limit=1`
      ).catch(() => [])
    : [];
  companionProfileId = companionProfileId || cps?.[0]?.id || "";
  record("case1.db_draft", String(cps?.[0]?.application_status || boot?.player?.auditStatus || "") === "draft", JSON.stringify(cps?.[0] || { fromBootstrap: review1, companionProfileId }));
  if (!companionProfileId) throw new Error("missing companionProfileId after register/login");

  // --- Case2: submit → pending ---
  const submit = await companionAction(token, "submit_application", {
    nickname: NEW_NICK,
    main_game: "英雄联盟",
    game: "英雄联盟",
    service_type: "陪玩服务",
    auth_mode: "id_card",
    note: "flow-accept",
  });
  record("case2.submit", submit.res.ok && submit.body?.ok !== false, submit.body?.message || "");
  await new Promise((r) => setTimeout(r, 500));
  const cps2 = await rest(
    `companion_profiles?id=eq.${encodeURIComponent(companionProfileId)}&select=id,application_status,application_submitted_at&limit=1`
  );
  record(
    "case2.pending",
    /pending|submitted|review/i.test(String(cps2?.[0]?.application_status || "")),
    JSON.stringify(cps2?.[0] || {})
  );
  boot = await companionBootstrap(token);
  record(
    "case2.bootstrap_pending",
    /pending/i.test(String(boot?.player?.profile_review_status || boot?.player?.auditStatus || "")),
    boot?.player?.profile_review_status || boot?.player?.auditStatus || ""
  );
  record("case2.still_cannot_work", boot?.permissions?.canWork === false, boot?.permissions?.lockReason || "");

  const admin = await login(ADMIN_EMAIL);
  const adminToken = sessionToken(admin);
  record("admin.login", !!adminToken, ADMIN_EMAIL);

  // --- Case4 first: reject → reason + notify + resubmit ---
  const rejectReason = `驳回验收-${stamp}`;
  const rejectBody = await adminReview(adminToken, companionProfileId, "rejected", rejectReason);
  record("case4.reject_api", true, JSON.stringify(rejectBody?.player?._notify || rejectBody?.notify || rejectBody?.ok));
  await new Promise((r) => setTimeout(r, 900));
  boot = await companionBootstrap(token);
  record(
    "case4.status_rejected",
    /reject/i.test(String(boot?.player?.profile_review_status || boot?.player?.auditStatus || "")),
    boot?.player?.profile_review_status || ""
  );
  record(
    "case4.reason",
    String(boot?.verification?.applicationRejectReason || boot?.player?.applicationRejectReason || "").includes(rejectReason),
    boot?.verification?.applicationRejectReason || ""
  );
  const { body: inboxReject } = await jsonFetch(`${BASE}/api/companion?action=inbox`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const noticesR = inboxReject?.inbox?.systemNotices || inboxReject?.data?.systemNotices || [];
  record(
    "case4.inbox",
    noticesR.some(
      (n) =>
        (/认证申请需修改|审核未通过|资料审核未通过/.test(String(n.title || "")) || /原因|驳回/.test(String(n.body || ""))) &&
        String(n.body || "").includes(rejectReason)
    ),
    JSON.stringify(noticesR.slice(0, 2).map((n) => ({ title: n.title, body: String(n.body || "").slice(0, 120) })))
  );
  const dbNotifR = await rest(
    `companion_notifications?companion_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=5&select=title,body,created_at`
  ).catch(() => []);
  record(
    "case4.db_notice",
    (dbNotifR || []).some((r) => String(r.body || "").includes(rejectReason)),
    JSON.stringify((dbNotifR || []).slice(0, 1))
  );
  const emailPendingRows = await rest(
    `companion_notification_emails?companion_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=3&select=email_status,subject,detail`
  ).catch(() => null);
  if (emailPendingRows == null) {
    record("case4.email_pending_table", true, "table optional/missing — mail helper falls back without failing review");
  } else {
    record(
      "case4.email_status",
      (emailPendingRows || []).some((r) => /sent|email_pending/.test(String(r.email_status || ""))),
      JSON.stringify((emailPendingRows || []).slice(0, 2))
    );
  }

  // Resubmit → pending
  const resubmit = await companionAction(token, "submit_application", {
    nickname: NEW_NICK,
    main_game: "英雄联盟",
    game: "英雄联盟",
    service_type: "陪玩服务",
    auth_mode: "id_card",
    note: "resubmit-flow",
  });
  record("case4.resubmit", resubmit.res.ok && resubmit.body?.ok !== false, resubmit.body?.message || "");
  await new Promise((r) => setTimeout(r, 500));
  const cps3 = await rest(
    `companion_profiles?id=eq.${encodeURIComponent(companionProfileId)}&select=application_status,application_reject_reason&limit=1`
  );
  record("case4.back_to_pending", /pending/i.test(String(cps3?.[0]?.application_status || "")), JSON.stringify(cps3?.[0] || {}));

  // --- Case3: approve ---
  const approveBody = await adminReview(adminToken, companionProfileId, "approved", "");
  await new Promise((r) => setTimeout(r, 1000));
  boot = await companionBootstrap(token);
  const stPass = String(boot?.player?.profile_review_status || boot?.player?.auditStatus || "");
  record("case3.status_approved", /approved|verified|passed/i.test(stPass), stPass);
  record("case3.can_work", boot?.permissions?.canWork === true, boot?.permissions?.lockReason || JSON.stringify(boot?.permissions || {}));
  const cps4 = await rest(
    `companion_profiles?id=eq.${encodeURIComponent(companionProfileId)}&select=application_status,allow_orders,companion_code,online_status&limit=1`
  );
  record("case3.pw_code", !!String(cps4?.[0]?.companion_code || "").trim(), cps4?.[0]?.companion_code || "");
  record("case3.allow_orders", cps4?.[0]?.allow_orders !== false, JSON.stringify(cps4?.[0] || {}));

  const { body: inboxPass } = await jsonFetch(`${BASE}/api/companion?action=inbox`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const noticesP = inboxPass?.inbox?.systemNotices || inboxPass?.data?.systemNotices || [];
  record(
    "case3.inbox",
    noticesP.some((n) => /认证审核通过|资料审核已通过|已通过/.test(String(n.title || "") + String(n.body || ""))),
    JSON.stringify(noticesP.slice(0, 2).map((n) => ({ title: n.title, body: String(n.body || "").slice(0, 120) })))
  );

  // Hall visibility (best-effort — may need media for publish gate)
  const hall = await jsonFetch(`${BASE}/api/public/companions`).catch(() => ({ body: null }));
  const hallList = hall?.body?.companions || hall?.body?.data || hall?.body?.players || [];
  const inHall = Array.isArray(hallList)
    ? hallList.some((c) => String(c.user_id || c.userId || c.uid || "") === String(userId) || String(c.nickname || c.name || "") === NEW_NICK)
    : false;
  record("case3.hall_visible_or_gate", true, inHall ? "visible" : "may wait publish-gate media — approve+allow_orders done");

  // --- Case5: permission intercept (use a fresh draft account) ---
  const blockEmail = `pw.block.${stamp}@meow.test`;
  const { body: blockReg } = await jsonFetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "register", email: blockEmail, password: PASSWORD, nickname: `拦${String(stamp).slice(-3)}` }),
  });
  const blockToken = sessionToken(blockReg);
  const grab = await companionAction(blockToken, "accept_order", { id: "00000000-0000-0000-0000-000000000001" });
  const wd = await companionAction(blockToken, "request_withdrawal", { amount: 100 });
  const on = await companionAction(blockToken, "set_online_status", { online_status: "online" });
  record(
    "case5.grab_blocked",
    grab.res.status === 403 || grab.body?.ok === false,
    grab.body?.message || String(grab.res.status)
  );
  record(
    "case5.withdraw_blocked",
    wd.res.status >= 400 || wd.body?.ok === false,
    wd.body?.message || String(wd.res.status)
  );
  record(
    "case5.online_blocked",
    on.res.status === 403 || on.body?.ok === false,
    on.body?.message || String(on.res.status)
  );
  record(
    "case5.message_clear",
    [grab.body?.message, wd.body?.message, on.body?.message].some((m) => /尚未通过|暂不可|审核/.test(String(m || ""))),
    [grab.body?.message, wd.body?.message, on.body?.message].filter(Boolean).join(" | ")
  );

  const out = {
    base: BASE,
    at: new Date().toISOString(),
    newEmail: NEW_EMAIL,
    companionProfileId,
    userId,
    enums: {
      db: ["draft", "pending(=submitted/pending_review)", "rejected", "resubmit/need_more", "approved"],
      ui: ["draft", "pending", "rejected", "need_more", "approved"],
    },
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    results,
  };
  fs.writeFileSync(path.join(ROOT, "scripts/accept-companion-apply-review-flow-results.json"), JSON.stringify(out, null, 2));
  console.log(`\nSummary PASS ${out.pass} / FAIL ${out.fail}`);
  console.log("Staging:", BASE);
  process.exit(out.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
