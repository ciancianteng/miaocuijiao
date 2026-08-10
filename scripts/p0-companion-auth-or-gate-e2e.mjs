/**
 * P0: companion order eligibility = approved profile + (identity OR deposit) + no forced + not banned.
 * Usage: node scripts/p0-companion-auth-or-gate-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const OUT = path.join(process.cwd(), "artifacts", "companion-auth-or-gate-e2e");

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 400) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 220) : ""}`);
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

async function bootstrap(token) {
  return api("/api/companion?action=bootstrap", token, null, "GET");
}

function snap(boot) {
  const d = boot.json?.data || {};
  const p = d.player || {};
  const v = d.verification || {};
  const dep = d.deposit || {};
  const perm = d.permissions || {};
  return {
    review: p.profile_review_status || p.profileReviewStatus,
    access: p.account_access_status || perm.accountAccessStatus,
    label: p.accountAccessLabel || perm.lockReason,
    canWork: perm.canWork,
    canSetAvailable: perm.canSetAvailable,
    identityStatus: v.identityStatus || perm.identityStatus,
    depositStatus: dep.status || perm.depositStatus || p.deposit_status,
    identityVerified: !!(perm.identityVerified || v.identityVerified),
    depositVerified: !!(perm.depositVerified || v.depositVerified),
    credentialOrOk: !!(perm.credentialOrOk || v.credentialOrOk),
    forced: !!(d.forcedAckRequired || (d.pendingForced || []).length),
  };
}

async function findCompanionId(adminToken) {
  const list = await api("/api/admin/players?action=list", adminToken, null, "GET");
  const players = list.json?.players || list.json?.items || [];
  const hit = (Array.isArray(players) ? players : []).find(
    (p) => String(p.email || "").toLowerCase() === COMP.toLowerCase() || String(p.nickname || "").includes("验收陪玩")
  );
  return hit?.id || hit?.companionId || "";
}

async function review(adminToken, companionId, kind, status) {
  const action = kind === "identity" ? "review_identity" : "review_deposit";
  const payload =
    kind === "identity"
      ? { action, id: companionId, companionId, status, identityStatus: status, reason: status === "rejected" ? "e2e reject" : "" }
      : { action, id: companionId, companionId, status, depositStatus: status, reason: status === "rejected" ? "e2e reject" : "" };
  return api("/api/admin/players", adminToken, payload);
}

async function setOnline(token, status = "online") {
  return api("/api/companion", token, { action: "set_online_status", status });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const adminLogin = await login(ADMIN, "admin");
  step("admin_login", !!adminLogin.token);
  const compLogin = await login(COMP, "companion");
  step("companion_login", !!compLogin.token, COMP);
  if (!adminLogin.token || !compLogin.token) throw new Error("login failed");

  const companionId = await findCompanionId(adminLogin.token);
  step("find_companion_id", !!companionId, companionId);

  // Snapshot original
  const before = snap(await bootstrap(compLogin.token));
  step("baseline_loaded", before.review === "approved", JSON.stringify(before).slice(0, 260));

  // Clear forced if any so it does not mask credential tests
  let boot = await bootstrap(compLogin.token);
  let guard = 0;
  while (((boot.json?.data?.pendingForced) || []).length && guard < 10) {
    const item = boot.json.data.pendingForced[0];
    await api("/api/companion", compLogin.token, {
      action: "acknowledge_forced",
      content_id: item.id,
      content_version: String(item.version || 1),
      content_type: item.contentType || "announcement",
    });
    boot = await bootstrap(compLogin.token);
    guard += 1;
  }

  // ---- Case: neither approved → cannot work ----
  // Force identity pending/draft path + deposit unpaid/pending via admin
  // Prefer: deposit unpaid + identity rejected/pending without approved
  const depOff = await review(adminLogin.token, companionId, "deposit", "unpaid");
  const idOff = await review(adminLogin.token, companionId, "identity", "pending");
  // If identity row missing, unpaid deposit alone may still leave id path open if identity_status profile says approved.
  // Also try resetting identity to rejected when possible.
  step("admin_set_deposit_unpaid", depOff.status < 400 && depOff.json?.ok !== false, depOff.json?.message || String(depOff.status));
  step("admin_set_identity_pending", idOff.status < 500, idOff.json?.message || String(idOff.status));

  let s = snap(await bootstrap(compLogin.token));
  // If identity still verified due to missing row / stuck approved on profile, force deposit-only incomplete by also rejecting identity if possible
  if (s.identityVerified && !s.depositVerified) {
    const idRej = await review(adminLogin.token, companionId, "identity", "rejected");
    step("admin_reject_identity_for_incomplete", idRej.status < 500, idRej.json?.message || "");
    s = snap(await bootstrap(compLogin.token));
  }
  const incompleteOk = s.review === "approved" && s.canWork === false && (s.access === "incomplete" || !s.credentialOrOk);
  step("profile_approved_but_no_credential_locks", incompleteOk, JSON.stringify(s).slice(0, 300));
  const blockedOnline = await setOnline(compLogin.token, "online");
  step(
    "online_blocked_when_incomplete",
    blockedOnline.status === 403 || blockedOnline.json?.ok === false,
    `${blockedOnline.status} ${blockedOnline.json?.message || ""}`
  );

  // ---- Deposit approved only ----
  const depOn = await review(adminLogin.token, companionId, "deposit", "approved");
  step("admin_approve_deposit", depOn.status < 400 && depOn.json?.ok !== false, depOn.json?.message || "");
  s = snap(await bootstrap(compLogin.token));
  step(
    "deposit_only_unlocks",
    s.canWork === true && s.depositVerified === true,
    JSON.stringify(s).slice(0, 300)
  );

  // ---- Deposit unpaid again, identity approved ----
  await review(adminLogin.token, companionId, "deposit", "unpaid");
  const idOn = await review(adminLogin.token, companionId, "identity", "approved");
  step("admin_approve_identity", idOn.status < 500 && idOn.json?.ok !== false, idOn.json?.message || String(idOn.status));
  s = snap(await bootstrap(compLogin.token));
  // If identity approve failed (no row), keep deposit path for restore
  if (!s.identityVerified) {
    step("identity_only_unlocks", false, "identity approve failed or no identity row; " + JSON.stringify(s).slice(0, 220));
    await review(adminLogin.token, companionId, "deposit", "approved");
  } else {
    step(
      "identity_only_unlocks",
      s.canWork === true && s.identityVerified === true && s.depositVerified === false,
      JSON.stringify(s).slice(0, 300)
    );
  }

  // ---- Both approved ----
  await review(adminLogin.token, companionId, "deposit", "approved");
  await review(adminLogin.token, companionId, "identity", "approved").catch(() => ({}));
  s = snap(await bootstrap(compLogin.token));
  step("both_approved_ok", s.canWork === true && s.credentialOrOk === true, JSON.stringify(s).slice(0, 260));

  // ---- Forced ack still locks set_available ----
  const stamp = Date.now();
  const ann = await api("/api/admin/content", adminLogin.token, {
    action: "save_announcement",
    title: `AuthOr强制 ${stamp}`,
    content: "auth-or gate forced lock test",
    category: "companion",
    audience: "companion",
    kind: "forced",
    requires_ack: true,
    is_active: true,
  });
  const annId = ann.json?.announcement?.id;
  step("create_forced", !!annId, annId || ann.json?.message || "");
  s = snap(await bootstrap(compLogin.token));
  step("forced_locks_while_credential_ok", s.canWork === true && s.canSetAvailable === false && s.forced === true, JSON.stringify(s).slice(0, 260));
  const onlineForced = await setOnline(compLogin.token, "online");
  step(
    "online_blocked_by_forced",
    onlineForced.status === 403 || /强制|确认|阅读/.test(String(onlineForced.json?.message || "")),
    `${onlineForced.status} ${onlineForced.json?.message || ""}`
  );

  // Ack + deactivate
  boot = await bootstrap(compLogin.token);
  for (const item of boot.json?.data?.pendingForced || []) {
    await api("/api/companion", compLogin.token, {
      action: "acknowledge_forced",
      content_id: item.id,
      content_version: String(item.version || 1),
      content_type: item.contentType || "announcement",
    });
  }
  if (annId) {
    await api("/api/admin/content", adminLogin.token, {
      action: "save_announcement",
      id: annId,
      title: `AuthOr强制 ${stamp}`,
      content: "done",
      category: "companion",
      audience: "companion",
      kind: "forced",
      is_active: false,
    });
  }
  s = snap(await bootstrap(compLogin.token));
  step("after_forced_ack_unlock", s.canWork === true && s.canSetAvailable === true && s.forced === false, JSON.stringify(s).slice(0, 260));
  const onlineOk = await setOnline(compLogin.token, "online");
  step("online_ok_after_all", onlineOk.status < 400 && onlineOk.json?.ok !== false, `${onlineOk.status} ${onlineOk.json?.message || ""}`);

  // Restore deposit approved (safe default for this test account)
  await review(adminLogin.token, companionId, "deposit", "approved");

  const pass = results.every((r) => r.result === "PASS");
  const out = { base: BASE, companion: COMP, companionId, before, results, pass };
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(out, null, 2));
  console.log(pass ? "\nALL PASS" : "\nHAS FAILURES");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
