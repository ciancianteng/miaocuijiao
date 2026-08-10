/**
 * P0: companion forced-ack + cert status separation accept (staging API).
 * 1) admin create forced companion ann
 * 2) companion bootstrap sees pending + approved review
 * 3) online blocked until ack
 * 4) ack unlocks; refresh no re-prompt
 * 5) second forced locks again
 * 6) deactivate second unlocks
 *
 * Usage: node scripts/p0-companion-forced-ack-status-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const OUT_DIR = path.join(process.cwd(), "artifacts", "companion-forced-ack-status-e2e");

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 400) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
}

async function api(pathname, token, body, method) {
  const m = method || (body != null ? "POST" : "GET");
  const res = await fetch(BASE + pathname, {
    method: m,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }
  return { status: res.status, json };
}

async function login(email, role) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role });
  const token =
    r.json.token ||
    r.json.accessToken ||
    r.json.session?.accessToken ||
    r.json.session?.token ||
    r.json.data?.token ||
    "";
  return { ...r, token };
}

function reviewOf(boot) {
  const d = boot.json?.data || {};
  const p = d.player || {};
  const raw = p.raw || {};
  return String(
    p.profile_review_status || p.profileReviewStatus || p.auditStatus || raw.application_status || d.permissions?.applicationStatus || ""
  ).toLowerCase();
}

async function bootstrap(token) {
  return api("/api/companion?action=bootstrap", token, null, "GET");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = Date.now();
  const createdIds = [];

  const adminLogin = await login(ADMIN, "admin");
  step("admin_login", !!adminLogin.token, adminLogin.json?.message || "");
  if (!adminLogin.token) throw new Error("admin login failed");

  const compLogin = await login(COMP, "companion");
  step("companion_login", !!compLogin.token, COMP);
  if (!compLogin.token) throw new Error("companion login failed");

  // Create forced #1
  const title1 = `P0强制公告A ${stamp}`;
  const create1 = await api("/api/admin/content", adminLogin.token, {
    action: "save_announcement",
    title: title1,
    content: `强制阅读内容 A ${stamp}\n请确认后才能接单。`,
    category: "companion",
    audience: "companion",
    kind: "forced",
    requires_ack: true,
    is_active: true,
    published_at: new Date().toISOString(),
  });
  const ann1 = create1.json?.announcement || create1.json?.item || create1.json?.data || {};
  const id1 = ann1.id || create1.json?.id;
  if (id1) createdIds.push(id1);
  step("create_forced_1", create1.status < 400 && !!id1, JSON.stringify({ status: create1.status, id: id1, msg: create1.json?.message }).slice(0, 220));

  // Ensure active forced via list
  const list = await api("/api/admin/content?action=list_announcements", adminLogin.token, null, "GET");
  const items = list.json?.announcements || list.json?.items || list.json?.data || [];
  const hit1 = (Array.isArray(items) ? items : []).find((a) => a.id === id1 || a.title === title1);
  step("admin_list_forced_1", !!(hit1 && (hit1.kind === "forced" || hit1.requires_ack) && hit1.is_active !== false), JSON.stringify({ kind: hit1?.kind, active: hit1?.is_active, audience: hit1?.audience || hit1?.category }).slice(0, 200));

  const boot1 = await bootstrap(compLogin.token);
  const d1 = boot1.json?.data || {};
  const pending1 = d1.pendingForced || [];
  const review1 = reviewOf(boot1);
  const forced1 = !!d1.forcedAckRequired || pending1.length > 0;
  const titles1 = pending1.map((p) => p.title);
  step("companion_sees_forced_1", forced1 && titles1.some((t) => String(t).includes("P0强制公告A")), JSON.stringify({ review: review1, pending: titles1, canWork: d1.permissions?.canWork, canSetAvailable: d1.permissions?.canSetAvailable }).slice(0, 300));
  step("review_still_approved_while_forced", /approved|verified|passed/.test(review1), review1);
  step("canWork_true_canSetAvailable_false", d1.permissions?.canWork === true && d1.permissions?.canSetAvailable === false, JSON.stringify(d1.permissions || {}).slice(0, 220));

  const onlineBlocked = await api("/api/companion", compLogin.token, { action: "set_online_status", status: "online" });
  const blocked =
    onlineBlocked.status === 403 ||
    onlineBlocked.json?.code === "FORCED_ACK_REQUIRED" ||
    /强制|确认|阅读/.test(String(onlineBlocked.json?.message || ""));
  step("online_blocked_before_ack", blocked, `${onlineBlocked.status} ${onlineBlocked.json?.message || onlineBlocked.json?.code || ""}`);

  // Ack all pending (may include older forced like 咕咕嘎嘎)
  let guard = 0;
  let bootLoop = await bootstrap(compLogin.token);
  while (((bootLoop.json?.data?.pendingForced) || []).length && guard < 12) {
    const item = bootLoop.json.data.pendingForced[0];
    const ack = await api("/api/companion", compLogin.token, {
      action: "acknowledge_forced",
      content_id: item.id,
      content_version: String(item.version || 1),
      content_type: item.contentType || "announcement",
    });
    step(`ack_${guard + 1}`, ack.json?.ok === true, `${item.title} → pending=${(ack.json?.pendingForced || []).length}`);
    bootLoop = await bootstrap(compLogin.token);
    guard += 1;
  }

  const boot2 = await bootstrap(compLogin.token);
  const d2 = boot2.json?.data || {};
  step("unlocked_after_ack", !(d2.forcedAckRequired || (d2.pendingForced || []).length), JSON.stringify({ pending: (d2.pendingForced || []).length, canSetAvailable: d2.permissions?.canSetAvailable, review: reviewOf(boot2) }).slice(0, 220));

  const onlineOk = await api("/api/companion", compLogin.token, { action: "set_online_status", status: "online" });
  step("online_allowed_after_ack", onlineOk.status < 400 && onlineOk.json?.ok !== false, `${onlineOk.status} ${onlineOk.json?.message || ""}`);

  // Refresh: same announcements must not reappear
  const boot3 = await bootstrap(compLogin.token);
  const again = (boot3.json?.data?.pendingForced || []).some((p) => p.id === id1);
  step("no_reprompt_same_announcement", !again, JSON.stringify((boot3.json?.data?.pendingForced || []).map((p) => p.title)).slice(0, 200));

  // Second forced
  const title2 = `P0强制公告B ${stamp}`;
  const create2 = await api("/api/admin/content", adminLogin.token, {
    action: "save_announcement",
    title: title2,
    content: `强制阅读内容 B ${stamp}`,
    category: "companion",
    audience: "companion",
    kind: "forced",
    requires_ack: true,
    is_active: true,
    published_at: new Date().toISOString(),
  });
  const ann2 = create2.json?.announcement || create2.json?.item || create2.json?.data || {};
  const id2 = ann2.id || create2.json?.id;
  if (id2) createdIds.push(id2);
  step("create_forced_2", !!id2, id2 || create2.json?.message || "");

  const boot4 = await bootstrap(compLogin.token);
  const pending4 = boot4.json?.data?.pendingForced || [];
  step("second_forced_requires_ack", pending4.some((p) => p.id === id2 || String(p.title).includes("P0强制公告B")), JSON.stringify(pending4.map((p) => p.title)).slice(0, 200));
  step("review_still_approved_on_second", /approved|verified|passed/.test(reviewOf(boot4)), reviewOf(boot4));

  // Deactivate second without ack → unlock
  if (id2) {
    const disable = await api("/api/admin/content", adminLogin.token, {
      action: "save_announcement",
      id: id2,
      title: title2,
      content: `强制阅读内容 B ${stamp}`,
      category: "companion",
      audience: "companion",
      kind: "forced",
      requires_ack: true,
      is_active: false,
    });
    step("deactivate_forced_2", disable.status < 400 && disable.json?.ok !== false, disable.json?.message || String(disable.status));
  } else {
    step("deactivate_forced_2", false, "missing id2");
  }

  const boot5 = await bootstrap(compLogin.token);
  const pending5 = boot5.json?.data?.pendingForced || [];
  const stillB = pending5.some((p) => p.id === id2 || String(p.title).includes("P0强制公告B"));
  step("deactivated_no_longer_locks", !stillB && !(boot5.json?.data?.forcedAckRequired), JSON.stringify(pending5.map((p) => p.title)).slice(0, 200));

  // Cleanup: deactivate first test ann too
  for (const id of createdIds) {
    await api("/api/admin/content", adminLogin.token, {
      action: "save_announcement",
      id,
      title: `cleanup ${id}`,
      content: "cleanup",
      category: "companion",
      audience: "companion",
      kind: "forced",
      is_active: false,
    }).catch(() => {});
  }

  const pass = results.every((r) => r.result === "PASS");
  const out = {
    base: BASE,
    companion: COMP,
    createdIds,
    results,
    pass,
    sot: {
      announcementsTable: "announcements",
      ackTable: "content_ack_records",
      certField: "companion_profiles.application_status → profile_review_status",
      orderGate: ["canWork (cert/account/deposit)", "pendingForced empty (canSetAvailable/canAcceptOrder/canStartOrder)", "online_status chosen by companion"],
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(out, null, 2));
  console.log(pass ? "\nALL PASS" : "\nHAS FAILURES");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
