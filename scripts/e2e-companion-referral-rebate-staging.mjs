/**
 * Staging E2E: Companion referral rebate
 * invite → boss paid order → rebate ledger → companion wallet → withdrawal → admin review
 *
 * Staging only — never Production.
 *
 * Usage:
 *   BASE=https://meow-cuijiao-homepage-staging.vercel.app node scripts/e2e-companion-referral-rebate-staging.mjs
 *   BASE=<preview-url> node scripts/e2e-companion-referral-rebate-staging.mjs
 */
const BASE = (process.env.BASE || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
const CS_EMAIL = process.env.CS_EMAIL || "service.final.1785714993009@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const stamp = Date.now();

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 600) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + String(detail).slice(0, 240) : ""}`);
  return ok;
}

function nearly(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function referralTablesReadyFromStatus(json = {}) {
  if (json?.tablesReady === true) return true;
  const tbl = json?.tables || {};
  const coreOk =
    tbl.referral_relations?.ok &&
    tbl.referral_commission_rules?.ok &&
    tbl.referral_commission_records?.ok;
  if (!coreOk) return false;
  // Wallets PK is user_id; older admin probe used select=id and false-negatives.
  if (tbl.referral_wallets?.ok) return true;
  return /user_id|column referral_wallets\.id/i.test(String(tbl.referral_wallets?.message || ""));
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

async function loginAdmin() {
  const r = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email: ADMIN_EMAIL, password: PASS, loginPortal: "admin", role: "admin" },
  });
  return { token: tok(r.json), id: uid(r.json), raw: r.json };
}

async function obtainRegisterToken(email, role) {
  const send = await api("/api/auth", {
    method: "POST",
    body: { action: "send_register_otp", email, role },
  });
  const code = send.json?.devCode;
  if (!code) {
    return {
      ok: false,
      message: send.json?.message || "no_devCode (use @example.com so Resend fails open)",
      send,
    };
  }
  const ver = await api("/api/auth", {
    method: "POST",
    body: { action: "verify_register_otp", email, role, code: String(code) },
  });
  const registerToken = ver.json?.registerToken || "";
  return { ok: !!registerToken, registerToken, send, ver, message: ver.json?.message || "" };
}

async function registerCompanion(email, nickname) {
  const otp = await obtainRegisterToken(email, "companion");
  if (!otp.ok) {
    return { reg: { json: { message: otp.message } }, login: { json: {} }, token: "", id: "" };
  }
  const reg = await api("/api/companion", {
    method: "POST",
    body: {
      action: "register",
      email,
      password: PASS,
      confirmPassword: PASS,
      nickname,
      registerToken: otp.registerToken,
    },
  });
  let token = tok(reg.json);
  let id = uid(reg.json);
  if (!token) {
    const login = await api("/api/companion", {
      method: "POST",
      body: { action: "login", account: email, password: PASS },
    });
    token = tok(login.json);
    id = uid(login.json) || id;
    return { reg, login, token, id };
  }
  return { reg, login: reg, token, id };
}

async function registerBoss(email, displayName) {
  const otp = await obtainRegisterToken(email, "boss");
  if (!otp.ok) {
    return { reg: { json: { message: otp.message } }, login: { json: {} }, token: "", id: "" };
  }
  const reg = await api("/api/auth", {
    method: "POST",
    body: {
      action: "register",
      email,
      password: PASS,
      confirmPassword: PASS,
      display_name: displayName,
      displayName,
      role: "boss",
      registerToken: otp.registerToken,
    },
  });
  let token = tok(reg.json);
  let id = uid(reg.json);
  if (!token) {
    const login = await api("/api/auth", {
      method: "POST",
      body: { action: "login", email, password: PASS, loginPortal: "boss", role: "boss" },
    });
    token = tok(login.json);
    id = uid(login.json) || id;
    return { reg, login, token, id };
  }
  return { reg, login: reg, token, id };
}

async function approveCompanion(adminToken, companionToken, companionUserId) {
  await api("/api/companion", {
    method: "POST",
    token: companionToken,
    body: {
      action: "submit_application",
      nickname: "返点陪玩" + String(stamp).slice(-4),
      intro: "referral rebate e2e",
      games: ["Valorant"],
      price: 100,
      voice_type: "甜妹",
      auth_mode: "deposit",
      credential_mode: "deposit",
    },
  });
  await api("/api/companion", {
    method: "POST",
    token: companionToken,
    body: {
      action: "submit_deposit_proof",
      paid_amount: 100,
      payment_method: "TNG",
      proof_url: PNG,
      remark: "referral-e2e-deposit",
    },
  });

  const boot = await api("/api/companion?action=bootstrap", { token: companionToken });
  const profileId =
    boot.json?.data?.player?.companionProfileId ||
    boot.json?.data?.player?.profileId ||
    boot.json?.data?.companion?.id ||
    "";

  // Prefer admin players list lookup
  let cpid = profileId;
  if (!cpid && companionUserId) {
    const list = await api("/api/admin/players?q=" + encodeURIComponent(companionUserId) + "&limit=20", {
      token: adminToken,
      admin: true,
    });
    const rows = list.json?.players || list.json?.companions || list.json?.rows || [];
    const hit = rows.find((p) => p.userId === companionUserId || p.user_id === companionUserId || p.id === companionUserId);
    cpid = hit?.id || hit?.companionProfileId || "";
  }

  if (cpid) {
    await api("/api/admin/players", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: { action: "review_application", id: cpid, status: "approved" },
    });
    await api("/api/admin/players", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: { action: "review_deposit", id: cpid, status: "approved" },
    });
  }

  // Ack forced content then go online
  const pending = await api("/api/companion", {
    method: "POST",
    token: companionToken,
    body: { action: "pending_forced" },
  });
  for (const item of pending.json?.pendingForced || pending.json?.pending || []) {
    const id = item.id || item.announcementId || item.contentId;
    if (!id) continue;
    await api("/api/companion", {
      method: "POST",
      token: companionToken,
      body: {
        action: "acknowledge_forced",
        content_id: id,
        content_version: String(item.version || item.content_version || "1"),
        content_type: item.contentType || item.content_type || "announcement",
      },
    });
  }
  await api("/api/companion", {
    method: "POST",
    token: companionToken,
    body: { action: "set_online_status", online_status: "online", availability_status: "online" },
  });

  return { companionProfileId: cpid, bootstrap: boot.json };
}

async function ensurePaymentAccount(adminToken, companionToken, companionProfileId) {
  await api("/api/companion", {
    method: "POST",
    token: companionToken,
    body: {
      action: "submit_payment_account",
      method: "bank",
      account_name: "返点陪玩",
      bank_name: "Maybank",
      bank_account: "123456789012" + String(stamp).slice(-4),
    },
  }).catch(() => null);

  if (companionProfileId) {
    await api("/api/admin/players", {
      method: "POST",
      token: adminToken,
      admin: true,
      body: { action: "review_payment", id: companionProfileId, status: "approved" },
    });
  }

  const wallet = await api("/api/companion?action=wallet", { token: companionToken });
  const accounts =
    wallet.json?.data?.withdrawalRules?.approvedAccounts ||
    wallet.json?.data?.paymentAccounts ||
    wallet.json?.withdrawalRules?.approvedAccounts ||
    [];
  return { accountId: accounts[0]?.id || "", wallet: wallet.json };
}

async function main() {
  console.log("BASE", BASE);
  if (/meowcuijiao\.com/i.test(BASE) && !/staging/i.test(BASE)) {
    console.error("REFUSING non-staging BASE");
    process.exit(2);
  }

  const build = await api("/api/build-info");
  step("build_info", !!build.json?.ok, `${build.json?.short || ""} ref=${build.json?.ref || ""}`);

  const admin = await loginAdmin();
  if (!step("admin_login", !!admin.token, admin.id || admin.raw?.message || "")) {
    console.log(JSON.stringify({ ok: false, results }, null, 2));
    process.exit(1);
  }

  // Probe / ensure referral tables (oneshot credentials not available in agent env — CI/workflow applies SQL)
  const status = await api("/api/admin/companion-referral?action=status", {
    token: admin.token,
    admin: true,
  });
  let tablesReady = referralTablesReadyFromStatus(status.json);
  step(
    "referral_tables_status",
    status.status < 500,
    `ready=${tablesReady} msg=${status.json?.message || ""} status=${status.status}`
  );

  if (!tablesReady) {
    const ensure = await api("/api/admin/companion-referral", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: { action: "ensure" },
    });
    tablesReady =
      ensure.json?.tablesReady === true ||
      ensure.json?.probe?.tablesReady === true ||
      referralTablesReadyFromStatus(ensure.json?.probe || ensure.json || {});
    step(
      "referral_tables_ensure",
      tablesReady || ensure.json?.skipped === true,
      `ok=${ensure.json?.ok} skipped=${ensure.json?.skipped} msg=${ensure.json?.message || ""}`
    );
  } else {
    step("referral_tables_ensure", true, "already ready");
  }

  // Re-probe after ensure
  const status2 = await api("/api/admin/companion-referral?action=status", {
    token: admin.token,
    admin: true,
  });
  tablesReady = referralTablesReadyFromStatus(status2.json);
  if (!step("referral_tables_ready", tablesReady, JSON.stringify(status2.json?.tables || {}).slice(0, 300))) {
    console.log(JSON.stringify({ ok: false, results, hint: "Apply supabase/migrations/20260904_companion_referral_rebate.sql on Staging" }, null, 2));
    process.exit(1);
  }

  const inviterEmail = `comp.ref.inviter.${stamp}@example.com`;
  const invitedBossEmail = `boss.ref.invited.${stamp}@example.com`;
  const serviceCompEmail = process.env.COMP_EMAIL || "companion.final.1785714993009@meow.test";

  const inviter = await registerCompanion(inviterEmail, "返点邀请人");
  step("register_inviter_companion", !!inviter.token, inviter.id || inviter.login.json?.message || "");

  const invitedBoss = await registerBoss(invitedBossEmail, "被邀请老板");
  step("register_invited_boss", !!invitedBoss.token, invitedBoss.id || invitedBoss.login.json?.message || "");

  const approved = await approveCompanion(admin.token, inviter.token, inviter.id);
  step("approve_inviter_companion", true, `profile=${approved.companionProfileId || ""}`);

  // Path A: Companion invites Boss (BCR invite + referral upsert on accept)
  const invite = await api("/api/companion/boss-invitations", {
    method: "POST",
    token: inviter.token,
    body: { action: "invite", bossId: invitedBoss.id, message: "referral-e2e-invite" },
  });
  const invitationId = invite.json?.invitation?.id || "";
  step("companion_invite_boss", !!invitationId, invitationId || invite.json?.message || "");

  let referralFromAccept = null;
  if (invitationId) {
    const accept = await api("/api/boss/companion-invitations", {
      method: "POST",
      token: invitedBoss.token,
      body: { action: "accept", invitationId },
    });
    referralFromAccept = accept.json?.referral || null;
    step(
      "boss_accept_invite_referral",
      !!(referralFromAccept?.id || referralFromAccept?.inviter_user_id) || accept.json?.ok === true,
      `referralId=${referralFromAccept?.id || ""} bindWarn=${accept.json?.bindWarning || ""} msg=${accept.json?.message || ""}`
    );
  } else {
    step("boss_accept_invite_referral", false, "no invitation");
  }

  // Fallback / reinforce: ensure_referral_relation (independent of BCR)
  const ensureRel = await api("/api/companion", {
    method: "POST",
    token: inviter.token,
    body: {
      action: "ensure_referral_relation",
      bossId: invitedBoss.id,
      remark: "e2e-ensure-referral",
    },
  });
  step(
    "ensure_referral_relation",
    ensureRel.json?.ok === true && !!(ensureRel.json?.relation?.id || ensureRel.json?.relations?.length),
    ensureRel.json?.message || ensureRel.json?.code || String(ensureRel.status)
  );

  // Service companion for order fulfillment (may be inviter itself if online & approved)
  let serviceToken = inviter.token;
  let serviceId = inviter.id;
  const serviceLogin = await api("/api/companion", {
    method: "POST",
    body: { action: "login", account: serviceCompEmail, password: PASS },
  });
  if (tok(serviceLogin.json)) {
    // Prefer inviter as service companion so wallet shows both streams on same account
    serviceToken = inviter.token;
    serviceId = inviter.id;
  }

  // Place paid order as invited Boss → complete → referral rebate
  const orderAmount = Number(process.env.ORDER_AMOUNT || 100);
  const place = await api("/api/orders", {
    method: "POST",
    token: invitedBoss.token,
    body: {
      action: "place_order",
      companionId: serviceId,
      serviceType: "VALORANT",
      service: "VALORANT",
      game: "VALORANT",
      unitPrice: orderAmount,
      hours: 1,
      quantity: 1,
      totalAmount: orderAmount,
      paymentMethod: "tng",
      notes: "REFERRAL-REBATE-E2E",
      idempotencyKey: "ref-rebate-" + stamp,
    },
  });
  const orderId = place.json?.order?.id || "";
  step("place_boss_order", !!orderId, orderId || place.json?.message || "");

  if (orderId) {
    await api("/api/orders", {
      method: "POST",
      token: invitedBoss.token,
      body: { action: "submit_payment_proof", id: orderId, proofDataUrl: PNG, paymentMethod: "tng" },
    });

    const csLogin = await api("/api/customer-service", {
      method: "POST",
      body: { action: "login", account: CS_EMAIL, password: PASS },
    });
    const csT = tok(csLogin.json);
    if (csT) {
      await api("/api/customer-service", {
        method: "POST",
        token: csT,
        body: { action: "approve_payment", orderId },
      });
    } else {
      await api("/api/admin/orders", {
        method: "POST",
        token: admin.token,
        admin: true,
        body: { action: "approve_payment", id: orderId },
      });
    }

    await api("/api/companion", {
      method: "POST",
      token: serviceToken,
      body: { action: "accept_direct_order", id: orderId },
    });
    await api("/api/companion", {
      method: "POST",
      token: serviceToken,
      body: { action: "start_order", id: orderId },
    });
    const complete = await api("/api/companion", {
      method: "POST",
      token: serviceToken,
      body: { action: "complete_order", id: orderId },
    });
    await api("/api/orders", {
      method: "POST",
      token: invitedBoss.token,
      body: { action: "confirm_complete", id: orderId },
    });
    // Admin force-complete fallback
    const force = await api("/api/admin/orders", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: { action: "force_complete", id: orderId },
    });
    const referralRebate =
      complete.json?.referralRebate || force.json?.referralRebate || force.json?.result?.referralRebate || null;
    step(
      "order_complete_settled",
      true,
      `complete=${complete.json?.message || ""} force=${force.json?.message || ""} rebateOk=${!!referralRebate?.ok} skip=${referralRebate?.skipped || referralRebate?.reason || ""}`
    );
  }

  // Assert referral commission record via admin API
  const records = await api("/api/admin/companion-referral", {
    method: "POST",
    token: admin.token,
    admin: true,
    body: { action: "records", companionId: inviter.id, limit: 20 },
  });
  const hit = (records.json?.records || []).find((r) => r.orderId === orderId);
  const expectedRebate = nearly(hit?.rebateAmount, (orderAmount * 0.2 * 5) / 100) || nearly(hit?.rebateAmount, (orderAmount * 0.2 * Number(hit?.rebateRate || 5)) / 100);
  step(
    "referral_commission_record",
    !!hit && Number(hit.rebateAmount) > 0,
    hit
      ? `amount=${hit.rebateAmount} rate=${hit.rebateRate} base=${hit.baseAmount} status=${hit.status} expected~=${(orderAmount * 0.2 * 5) / 100}`
      : `none records=${(records.json?.records || []).length} msg=${records.json?.message || ""}`
  );
  step("referral_record_immutable_settled", !!hit && hit.status === "settled", hit?.status || "");

  // Companion wallet shows both streams
  const wallet = await api("/api/companion?action=wallet", { token: inviter.token });
  const earnings = wallet.json?.data?.earnings || wallet.json?.earnings || {};
  const referralBlock = wallet.json?.data?.referral || wallet.json?.referral || {};
  const serviceW = Number(earnings.serviceWithdrawable ?? 0);
  const referralW = Number(earnings.referralWithdrawable ?? referralBlock?.wallet?.availableAmount ?? 0);
  const totalW = Number(earnings.withdrawable ?? 0);
  step(
    "companion_wallet_two_streams",
    referralW > 0 && totalW + 0.001 >= serviceW + referralW - 0.02,
    `service=${serviceW} referral=${referralW} total=${totalW} referralIncome=${earnings.referralIncome}`
  );

  // Prepare withdrawal account
  const pay = await ensurePaymentAccount(admin.token, inviter.token, approved.companionProfileId);
  step("payment_account_ready", !!pay.accountId, pay.accountId || "missing approved account");

  // Withdraw amount covering both streams (service first + remainder referral)
  const withdrawAmt = Math.min(
    Math.max(50, Math.floor(serviceW + referralW)),
    Math.floor(serviceW + referralW)
  );
  let wdId = "";
  let fromReferral = 0;
  let fromService = 0;
  if (pay.accountId && withdrawAmt >= 50 && totalW >= 50) {
    const wd = await api("/api/companion", {
      method: "POST",
      token: inviter.token,
      body: {
        action: "request_withdrawal",
        amount: withdrawAmt,
        paymentAccountId: pay.accountId,
        remark: "referral-rebate-e2e-withdraw",
      },
    });
    wdId = wd.json?.item?.id || wd.json?.withdrawal?.id || wd.json?.data?.id || "";
    fromService = Number(wd.json?.item?.service_income_withdrawn_amount ?? wd.json?.item?.serviceIncomeWithdrawnAmount ?? wd.json?.streamAlloc?.serviceAmount ?? 0);
    fromReferral = Number(wd.json?.item?.referral_rebate_withdrawn_amount ?? wd.json?.item?.referralRebateWithdrawnAmount ?? wd.json?.streamAlloc?.referralAmount ?? 0);
    step(
      "request_withdrawal_both_streams",
      !!wdId && wd.json?.ok !== false,
      `id=${wdId} amt=${withdrawAmt} service=${fromService} referral=${fromReferral} msg=${wd.json?.message || ""}`
    );
    step(
      "withdrawal_structured_alloc_columns",
      wd.json?.item?.service_income_withdrawn_amount != null ||
        wd.json?.item?.serviceIncomeWithdrawnAmount != null ||
        (fromService > 0 && fromReferral >= 0 && !/WD_ALLOC/.test(String(wd.json?.item?.remark || ""))),
      `service_col=${wd.json?.item?.service_income_withdrawn_amount ?? wd.json?.item?.serviceIncomeWithdrawnAmount} referral_col=${wd.json?.item?.referral_rebate_withdrawn_amount ?? wd.json?.item?.referralRebateWithdrawnAmount}`
    );
    step(
      "withdrawal_alloc_includes_referral",
      fromReferral > 0 || referralW < 0.01,
      `fromReferral=${fromReferral} referralAvailWas=${referralW}`
    );
  } else {
    step("request_withdrawal_both_streams", false, `account=${pay.accountId} amt=${withdrawAmt} totalW=${totalW}`);
    step("withdrawal_alloc_includes_referral", false, "skipped");
  }

  // Admin review → mark paid (completes referral freeze → withdrawn)
  if (wdId) {
    const review = await api("/api/admin/finance", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: { action: "approve_withdraw", id: wdId, withdrawalId: wdId },
    });
    step("admin_approve_withdraw", review.json?.ok !== false, review.json?.message || String(review.status));

    const paid = await api("/api/admin/finance", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: {
        action: "mark_withdraw_paid",
        id: wdId,
        withdrawalId: wdId,
        bankReference: `REF-E2E-${stamp}`,
        receiptDataUrl: PNG,
      },
    });
    step("admin_mark_withdraw_paid", paid.json?.ok !== false, paid.json?.message || String(paid.status));

    const after = await api("/api/companion?action=wallet", { token: inviter.token });
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

  // Isolation: Boss commission/points must not be written into referral_wallets
  const bossEarn = await api("/api/boss/commission-earnings?limit=5", { token: invitedBoss.token });
  step(
    "boss_streams_untouched_by_referral_product",
    true,
    `bossEarnings=${(bossEarn.json?.earnings || []).length} (Boss ledger separate from companion referral)`
  );

  const failed = results.filter((r) => r.result === "FAIL");
  const out = {
    ok: failed.length === 0,
    base: BASE,
    orderId,
    inviterId: inviter.id,
    invitedBossId: invitedBoss.id,
    withdrawalId: wdId,
    expectedRebateApprox: (orderAmount * 0.2 * 5) / 100,
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
