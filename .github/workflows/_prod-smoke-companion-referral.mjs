/**
 * Production smoke (CI-only): Companion referral rebate
 * invite → order complete → rebate → wallet → withdraw
 *
 * Requires env: BASE, PASS, ADMIN_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Seeded accounts are ephemeral *@mcj-prod-smoke.invalid
 */
import fs from "node:fs";

const BASE = (process.env.BASE || "https://www.meowcuijiao.com").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
function loadSmokeEnv() {
  const fromFile = process.env.SMOKE_ENV_JSON || "";
  if (fromFile && fs.existsSync(fromFile)) {
    try {
      return JSON.parse(fs.readFileSync(fromFile, "utf8"));
    } catch {
      /* fall through */
    }
  }
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}
const smokeEnv = loadSmokeEnv();
let URL = String(smokeEnv.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = String(smokeEnv.SUPABASE_SERVICE_ROLE_KEY || "");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const stamp = Date.now();
const DOMAIN = "mcj-prod-smoke.invalid";

if (!SERVICE) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
if (!/meowcuijiao\.com/i.test(BASE)) {
  console.error("Refusing non-production BASE", BASE);
  process.exit(2);
}

async function resolveSupabaseUrl() {
  const candidates = [URL, smokeEnv.SUPABASE_URL, process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL];
  for (const c of candidates) {
    const u = String(c || "").trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
    try {
      if (u && /^https?:\/\//i.test(u)) {
        const host = new URL(u).host;
        if (host) return u;
      }
    } catch {
      /* next */
    }
  }
  const cfg = await fetch(BASE + "/api/public/realtime-config").then((r) => r.json()).catch(() => ({}));
  const live = String(cfg?.url || "").trim().replace(/\/$/, "");
  if (!live) throw new Error("Could not resolve SUPABASE_URL from env pull or /api/public/realtime-config");
  return live;
}

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + String(detail).slice(0, 220) : ""}`);
  return ok;
}

function svcHeaders(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: "Bearer " + SERVICE,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function rest(path, query = "", opts = {}) {
  const q = query ? (query.startsWith("?") ? query : "?" + query) : "";
  const res = await fetch(`${URL}/rest/v1/${path}${q}`, {
    method: opts.method || "GET",
    headers: svcHeaders(opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function authAdmin(path, opts = {}) {
  const res = await fetch(`${URL}/auth/v1/admin/${path}`, {
    method: opts.method || "GET",
    headers: svcHeaders(),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`auth ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function api(path, { method = "GET", token, body, admin = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: "Bearer " + token,
            ...(admin ? { "x-mcj-admin-role": "admin" } : {}),
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.access_token || "";
}
function uid(j) {
  return j?.session?.user?.id || j?.user?.id || j?.data?.player?.id || j?.profile?.id || "";
}

async function ensureAuthUser(email, display) {
  const prof = await rest("profiles", `email=eq.${encodeURIComponent(email)}&select=id&limit=1`).catch(() => []);
  if (Array.isArray(prof) && prof[0]?.id) {
    await authAdmin(`users/${prof[0].id}`, {
      method: "PUT",
      body: { password: PASS, email_confirm: true, ban_duration: "none" },
    });
    return prof[0].id;
  }
  const created = await authAdmin("users", {
    method: "POST",
    body: {
      email,
      password: PASS,
      email_confirm: true,
      user_metadata: { display_name: display },
    },
  });
  return created.id || created.user?.id;
}

async function ensureProfile(id, { email, role, display }) {
  const rows = await rest("profiles", `id=eq.${id}&select=id,role`).catch(() => []);
  const payload = {
    role,
    status: "active",
    email,
    display_name: display,
    updated_at: new Date().toISOString(),
  };
  if (Array.isArray(rows) && rows[0]) {
    await rest("profiles", `id=eq.${id}`, { method: "PATCH", body: payload });
    return;
  }
  await rest("profiles", "", {
    method: "POST",
    body: { id, ...payload, created_at: new Date().toISOString(), ...(role === "boss" ? { boss_uid: `SMK${String(stamp).slice(-8)}` } : {}) },
  });
}

async function ensureCompanionRow(userId, display, { price = 30 } = {}) {
  const rows = await rest("companion_profiles", `user_id=eq.${userId}&select=id`).catch(() => []);
  const patch = {
    nickname: display,
    application_status: "approved",
    verification_status: "approved",
    deposit_status: "approved",
    allow_orders: true,
    online_status: "online",
    availability_status: "online",
    price,
    main_service: "VALORANT",
    games: ["Valorant"],
    updated_at: new Date().toISOString(),
  };
  if (Array.isArray(rows) && rows[0]) {
    await rest("companion_profiles", `user_id=eq.${userId}`, { method: "PATCH", body: patch });
    return rows[0].id;
  }
  const created = await rest("companion_profiles", "", {
    method: "POST",
    body: { user_id: userId, ...patch, created_at: new Date().toISOString() },
  });
  return Array.isArray(created) ? created[0]?.id : created?.id;
}

async function ensurePaymentAccountRow(companionProfileId, userId) {
  // Try API path first after login; also seed DB row if table exists
  try {
    const existing = await rest(
      "companion_payment_accounts",
      `companion_profile_id=eq.${companionProfileId}&select=id,status&limit=5`
    );
    if (Array.isArray(existing) && existing[0]?.id) {
      await rest("companion_payment_accounts", `id=eq.${existing[0].id}`, {
        method: "PATCH",
        body: { status: "approved", review_status: "approved", updated_at: new Date().toISOString() },
      });
      return existing[0].id;
    }
  } catch {
    /* table shape may differ */
  }
  try {
    const created = await rest("companion_payment_accounts", "", {
      method: "POST",
      body: {
        companion_profile_id: companionProfileId,
        user_id: userId,
        method: "bank",
        account_name: "ProdSmoke",
        bank_name: "Maybank",
        bank_account: "9000" + String(stamp).slice(-8),
        status: "approved",
        review_status: "approved",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return Array.isArray(created) ? created[0]?.id : created?.id;
  } catch (e) {
    console.log("payment account seed soft-fail", String(e.message || e).slice(0, 200));
    return "";
  }
}

async function main() {
  console.log("BASE", BASE);
  URL = await resolveSupabaseUrl();
  console.log("SUPABASE host", new URL(URL).host);
  const build = await api("/api/build-info");
  if (!step("build_info_cc56689", build.json?.short === "cc56689" || String(build.json?.sha || "").startsWith("cc56689"), JSON.stringify(build.json))) {
    process.exit(1);
  }

  const adminLogin = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email: ADMIN_EMAIL, password: PASS, loginPortal: "admin", role: "admin" },
  });
  const adminToken = tok(adminLogin.json);
  if (!step("admin_login", !!adminToken, adminLogin.json?.message || "")) process.exit(1);

  const status = await api("/api/admin/companion-referral?action=status", { token: adminToken, admin: true });
  if (!step("referral_tables_ready", status.json?.tablesReady === true, JSON.stringify(status.json?.tables || {}))) {
    process.exit(1);
  }

  const inviterEmail = `inviter.${stamp}@${DOMAIN}`;
  const serviceEmail = `service.${stamp}@${DOMAIN}`;
  const bossEmail = `boss.${stamp}@${DOMAIN}`;
  const csEmail = `cs.${stamp}@${DOMAIN}`;

  const inviterId = await ensureAuthUser(inviterEmail, "ProdSmokeInviter");
  await ensureProfile(inviterId, { email: inviterEmail, role: "companion", display: "ProdSmokeInviter" });
  const inviterProfileId = await ensureCompanionRow(inviterId, "ProdSmokeInviter", { price: 30 });
  step("seed_inviter_companion", !!(inviterId && inviterProfileId), `${inviterId} / ${inviterProfileId}`);

  const serviceId = await ensureAuthUser(serviceEmail, "ProdSmokeService");
  await ensureProfile(serviceId, { email: serviceEmail, role: "companion", display: "ProdSmokeService" });
  const serviceProfileId = await ensureCompanionRow(serviceId, "ProdSmokeService", { price: 30 });
  step("seed_service_companion", !!(serviceId && serviceProfileId), `${serviceId} / ${serviceProfileId}`);

  const bossId = await ensureAuthUser(bossEmail, "ProdSmokeBoss");
  await ensureProfile(bossId, { email: bossEmail, role: "boss", display: "ProdSmokeBoss" });
  step("seed_invited_boss", !!bossId, bossId);

  // CS via admin API (can set password)
  const csCreate = await api("/api/admin/service-accounts", {
    method: "POST",
    token: adminToken,
    admin: true,
    body: { action: "create", name: "ProdSmokeCS", email: csEmail, password: PASS, status: "启用" },
  });
  step("seed_cs_account", csCreate.json?.ok !== false, csCreate.json?.message || csCreate.json?.account?.id || String(csCreate.status));

  await ensurePaymentAccountRow(inviterProfileId, inviterId);

  const inviterLogin = await api("/api/companion", {
    method: "POST",
    body: { action: "login", account: inviterEmail, password: PASS },
  });
  const inviterToken = tok(inviterLogin.json);
  step("login_inviter", !!inviterToken, inviterLogin.json?.message || uid(inviterLogin.json));

  const serviceLogin = await api("/api/companion", {
    method: "POST",
    body: { action: "login", account: serviceEmail, password: PASS },
  });
  const serviceToken = tok(serviceLogin.json);
  step("login_service", !!serviceToken, serviceLogin.json?.message || uid(serviceLogin.json));

  const bossLogin = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email: bossEmail, password: PASS, loginPortal: "boss", role: "boss" },
  });
  const bossToken = tok(bossLogin.json);
  step("login_boss", !!bossToken, bossLogin.json?.message || uid(bossLogin.json));

  const csLogin = await api("/api/customer-service", {
    method: "POST",
    body: { action: "login", account: csEmail, password: PASS },
  });
  const csToken = tok(csLogin.json);
  step("login_cs", !!csToken, csLogin.json?.message || "");

  // Invite → accept → ensure referral
  const invite = await api("/api/companion/boss-invitations", {
    method: "POST",
    token: inviterToken,
    body: { action: "invite", bossId, message: "prod-smoke-invite" },
  });
  const invitationId = invite.json?.invitation?.id || "";
  step("companion_invite_boss", !!invitationId, invitationId || invite.json?.message || "");

  if (invitationId) {
    const accept = await api("/api/boss/companion-invitations", {
      method: "POST",
      token: bossToken,
      body: { action: "accept", invitationId },
    });
    step("boss_accept_invite", accept.json?.ok !== false, accept.json?.message || accept.json?.referral?.id || "");
  } else {
    step("boss_accept_invite", false, "no invitation");
  }

  const ensureRel = await api("/api/companion", {
    method: "POST",
    token: inviterToken,
    body: { action: "ensure_referral_relation", bossId, remark: "prod-smoke-ensure" },
  });
  step(
    "ensure_referral_relation",
    ensureRel.json?.ok === true && !!(ensureRel.json?.relation?.id || ensureRel.json?.relations?.length),
    ensureRel.json?.message || ensureRel.json?.relation?.id || String(ensureRel.status)
  );

  const unitPrice = 30;
  const hours = 200;
  const orderAmount = unitPrice * hours;
  const place = await api("/api/orders", {
    method: "POST",
    token: bossToken,
    body: {
      action: "place_order",
      companionId: serviceId,
      serviceType: "VALORANT",
      service: "VALORANT",
      game: "VALORANT",
      gameId: "PROD-SMOKE-" + stamp,
      game_id: "PROD-SMOKE-" + stamp,
      unitPrice,
      hours,
      quantity: 1,
      totalAmount: orderAmount,
      paymentMethod: "duitnow",
      notes: "PROD-REFERRAL-SMOKE",
      idempotencyKey: "prod-ref-smoke-" + stamp,
    },
  });
  const orderId = place.json?.order?.id || "";
  step("place_boss_order", !!orderId, orderId || place.json?.message || "");

  if (orderId) {
    await api("/api/orders", {
      method: "POST",
      token: bossToken,
      body: { action: "submit_payment_proof", id: orderId, proofDataUrl: PNG, paymentMethod: "duitnow" },
    });

    if (csToken) {
      const payOk = await api("/api/customer-service", {
        method: "POST",
        token: csToken,
        body: { action: "confirm_payment", orderId, id: orderId },
      });
      step("cs_confirm_payment", payOk.json?.ok !== false, payOk.json?.message || String(payOk.status));
    } else {
      const adm = await api("/api/admin/orders", {
        method: "POST",
        token: adminToken,
        admin: true,
        body: { action: "update_status", id: orderId, status: "claimed" },
      });
      step("cs_confirm_payment", adm.json?.ok !== false, "admin fallback " + (adm.json?.message || ""));
    }

    await api("/api/companion", { method: "POST", token: serviceToken, body: { action: "accept_direct_order", id: orderId } });
    await api("/api/companion", { method: "POST", token: serviceToken, body: { action: "start_order", id: orderId } });
    const complete = await api("/api/companion", { method: "POST", token: serviceToken, body: { action: "complete_order", id: orderId } });
    const bossConfirm = await api("/api/orders", { method: "POST", token: bossToken, body: { action: "confirm_complete", id: orderId } });
    const adminConfirm = await api("/api/admin/orders", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: { action: "confirm_complete", id: orderId },
    });
    const statusProbe = await api("/api/admin/orders?id=" + encodeURIComponent(orderId), { token: adminToken, admin: true });
    const finalStatus = statusProbe.json?.order?.status || statusProbe.json?.orders?.[0]?.status || "";
    step(
      "order_complete_settled",
      String(finalStatus) === "completed",
      `status=${finalStatus} complete=${complete.json?.message || ""} boss=${bossConfirm.json?.message || ""} admin=${adminConfirm.json?.message || ""}`
    );
  }

  const records = await api("/api/admin/companion-referral", {
    method: "POST",
    token: adminToken,
    admin: true,
    body: { action: "records", companionId: inviterId, limit: 20 },
  });
  const hit = (records.json?.records || []).find((r) => r.orderId === orderId);
  const expected = (orderAmount * 0.2 * 5) / 100;
  step(
    "referral_commission_record",
    !!hit && Number(hit.rebateAmount) > 0,
    hit ? `amount=${hit.rebateAmount} expected~=${expected} status=${hit.status}` : `none msg=${records.json?.message || ""}`
  );

  const wallet = await api("/api/companion?action=wallet", { token: inviterToken });
  const earnings = wallet.json?.data?.earnings || wallet.json?.earnings || {};
  const referralBlock = wallet.json?.data?.referral || wallet.json?.referral || {};
  const serviceW = Number(earnings.serviceWithdrawable ?? 0);
  const referralW = Number(earnings.referralWithdrawable ?? referralBlock?.wallet?.availableAmount ?? 0);
  const totalW = Number(earnings.withdrawable ?? 0);
  step(
    "companion_wallet_referral",
    referralW > 0,
    `service=${serviceW} referral=${referralW} total=${totalW}`
  );

  // Payment account via API if DB seed insufficient
  await api("/api/companion", {
    method: "POST",
    token: inviterToken,
    body: {
      action: "submit_payment_account",
      method: "bank",
      account_name: "ProdSmoke",
      bank_name: "Maybank",
      bank_account: "8000" + String(stamp).slice(-8),
    },
  });
  if (inviterProfileId) {
    await api("/api/admin/players", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: { action: "review_payment", id: inviterProfileId, status: "approved" },
    });
  }
  const wallet2 = await api("/api/companion?action=wallet", { token: inviterToken });
  const accounts =
    wallet2.json?.data?.withdrawalRules?.approvedAccounts ||
    wallet2.json?.data?.paymentAccounts ||
    wallet2.json?.withdrawalRules?.approvedAccounts ||
    [];
  const accountId = accounts[0]?.id || "";
  step("payment_account_ready", !!accountId, accountId || "missing");

  const withdrawAmt = Math.min(Math.max(50, Math.floor(serviceW + referralW)), Math.floor(totalW || serviceW + referralW));
  let wdId = "";
  let fromReferral = 0;
  if (accountId && withdrawAmt >= 50) {
    const wd = await api("/api/companion", {
      method: "POST",
      token: inviterToken,
      body: { action: "request_withdrawal", amount: withdrawAmt, paymentAccountId: accountId, remark: "prod-smoke-withdraw" },
    });
    wdId = wd.json?.item?.id || wd.json?.withdrawal?.id || wd.json?.data?.id || "";
    fromReferral = Number(
      wd.json?.item?.referral_rebate_withdrawn_amount ??
        wd.json?.item?.referralRebateWithdrawnAmount ??
        wd.json?.streamAlloc?.referralAmount ??
        0
    );
    step(
      "request_withdrawal",
      !!wdId && wd.json?.ok !== false,
      `id=${wdId} amt=${withdrawAmt} referralAlloc=${fromReferral} msg=${wd.json?.message || ""}`
    );
    step(
      "withdrawal_includes_referral",
      fromReferral > 0 || referralW < 0.01,
      `fromReferral=${fromReferral}`
    );
  } else {
    step("request_withdrawal", false, `account=${accountId} amt=${withdrawAmt} totalW=${totalW}`);
    step("withdrawal_includes_referral", false, "skipped");
  }

  if (wdId) {
    const review = await api("/api/admin/finance", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: { action: "approve_withdraw", id: wdId, withdrawalId: wdId },
    });
    step("admin_approve_withdraw", review.json?.ok !== false, review.json?.message || "");
    const paid = await api("/api/admin/finance", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: {
        action: "mark_withdraw_paid",
        id: wdId,
        withdrawalId: wdId,
        bankReference: `PROD-SMOKE-${stamp}`,
        receiptDataUrl: PNG,
      },
    });
    step("admin_mark_withdraw_paid", paid.json?.ok !== false, paid.json?.message || "");
    const after = await api("/api/companion?action=wallet", { token: inviterToken });
    const refAfter = after.json?.data?.referral?.wallet || after.json?.referral?.wallet || {};
    step(
      "referral_wallet_after_paid",
      Number(refAfter.frozenAmount || 0) < 0.01,
      `available=${refAfter.availableAmount} frozen=${refAfter.frozenAmount} withdrawn=${refAfter.totalWithdrawn}`
    );
  } else {
    step("admin_approve_withdraw", false, "no withdrawal");
    step("admin_mark_withdraw_paid", false, "no withdrawal");
    step("referral_wallet_after_paid", false, "no withdrawal");
  }

  const failed = results.filter((r) => r.result === "FAIL");
  const out = {
    ok: failed.length === 0,
    base: BASE,
    orderId,
    inviterId,
    bossId,
    serviceId,
    withdrawalId: wdId,
    accounts: { inviterEmail, serviceEmail, bossEmail, csEmail },
    expectedRebateApprox: expected,
    results,
  };
  console.log("\nSUMMARY", failed.length ? "FAIL" : "PASS", `${results.length - failed.length}/${results.length}`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
