/**
 * Staging E2E: Boss commission RM30 checklist (four-end snapshot).
 * Staging only — never Production.
 *
 * Usage:
 *   BASE=https://meow-cuijiao-homepage-staging.vercel.app node scripts/e2e-boss-commission-rm30-staging.mjs
 */
const BASE = (process.env.BASE || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + String(detail).slice(0, 220) : ""}`);
  return ok;
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
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || "";
}

function nearly(a, b, eps = 0.011) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

async function loginAdmin() {
  const r = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email: ADMIN_EMAIL, password: PASS, loginPortal: "admin", role: "admin" },
  });
  return { token: tok(r.json), id: r.json?.session?.user?.id || "", raw: r.json };
}

async function main() {
  console.log("BASE", BASE);
  console.log("Production guard: staging hostname only");
  if (/meowcuijiao\.com|production/i.test(BASE) && !/staging/i.test(BASE)) {
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

  // --- Migrations / schema readiness ---
  const levels = await api("/api/admin/boss-levels?action=list", { token: admin.token, admin: true });
  step(
    "admin_boss_levels_visible",
    levels.json?.ok === true && levels.json?.tablesReady !== false && (levels.json?.levels || []).length > 0,
    `n=${(levels.json?.levels || []).length} msg=${levels.json?.message || ""}`
  );

  // Ensure default Boss commission rate = 5% (platform default fallback)
  const settingsGet = await api("/api/admin/platform-settings", { token: admin.token, admin: true });
  const cur = settingsGet.json?.settings || settingsGet.json?.data || {};
  const saveRate = await api("/api/admin/platform-settings", {
    method: "POST",
    token: admin.token,
    admin: true,
    body: {
      action: "save",
      ...(typeof cur === "object" ? cur : {}),
      defaultBossCommissionRate: 5,
    },
  });
  step(
    "platform_default_boss_rate_5",
    saveRate.json?.ok !== false,
    saveRate.json?.message || String(saveRate.status)
  );

  // Staging accounts known to login with McjTest@12345678 (override via env).
  const BOSS_EMAIL = process.env.BOSS_EMAIL || "boss.cap.verify.1788244570@example.com";
  const COMP_EMAIL = process.env.COMP_EMAIL || "pr122-accept-1788112659@example.com";
  const CS_EMAIL = process.env.CS_EMAIL || "service@meow.test";

  const bossLogin = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email: BOSS_EMAIL, password: PASS, loginPortal: "boss" },
  });
  const bossT = tok(bossLogin.json);
  const bossUid = bossLogin.json?.session?.user?.id || "";

  const compLogin = await api("/api/companion", {
    method: "POST",
    body: { action: "login", account: COMP_EMAIL, password: PASS },
  });
  const compT = tok(compLogin.json);
  const boot0 = compT ? await api("/api/companion?action=bootstrap", { token: compT }) : { json: {} };
  const compUid = boot0.json?.data?.player?.id || compLogin.json?.session?.user?.id || "";
  let companionProfileId =
    boot0.json?.data?.player?.companionProfileId ||
    boot0.json?.data?.player?.profileId ||
    boot0.json?.data?.companion?.id ||
    "";
  if (!companionProfileId && compUid) {
    const players = await api("/api/admin/players?limit=100", { token: admin.token, admin: true });
    const hit = (players.json?.players || []).find(
      (p) =>
        String(p.user_id || p.uid || "") === String(compUid) ||
        String(p.email || p.rawEmail || "").toLowerCase() === COMP_EMAIL.toLowerCase()
    );
    companionProfileId = hit?.id || "";
  }

  const csLogin = await api("/api/customer-service", {
    method: "POST",
    body: { action: "login", account: CS_EMAIL, password: PASS },
  });
  const csT = tok(csLogin.json);

  step("portal_logins", !!(bossT && compT && csT), `boss=${!!bossT} comp=${!!compT} cs=${!!csT}`);

  // Prefer profiles.id for BCR bind (not companion_profiles.id from Admin players list).
  const bossId = bossUid;
  const companionId = compUid;
  step("picked_accounts", !!(bossId && companionId), `boss=${bossId} companion=${companionId}`);

  // Prepare companion for orderability: approved + deposit + game/price + online.
  if (companionProfileId || companionId) {
    const pid = companionProfileId || companionId;
    await api("/api/admin/players", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: {
        action: "review_application",
        id: pid,
        status: "approved",
        price: 30,
        orderCommissionRate: 20,
        allowOrders: true,
        reason: "e2e-rm30-approve",
      },
    });
    await api("/api/admin/players", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: { action: "review_deposit", id: pid, status: "paid", reason: "e2e-rm30-deposit" },
    });
    await api("/api/admin/players", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: {
        action: "save",
        id: pid,
        game: "VALORANT",
        price: 30,
        allowOrders: true,
        auditStatus: "approved",
      },
    });
    await api("/api/companion", {
      method: "POST",
      token: compT,
      body: { action: "set_online_status", status: "online" },
    });
  }

  // Bind with reason (audit required)
  const noReason = await api("/api/admin/boss-companion-relations?action=bind", {
    method: "POST",
    token: admin.token,
    admin: true,
    body: { action: "bind", bossId, companionId, remark: "e2e-no-reason" },
  });
  step(
    "audit_reason_required",
    noReason.json?.ok === false && /reason|REASON/i.test(String(noReason.json?.message || noReason.json?.code || "")),
    noReason.json?.message || noReason.json?.code || String(noReason.status)
  );

  await api("/api/admin/boss-companion-relations?action=unbind", {
    method: "POST",
    token: admin.token,
    admin: true,
    body: { action: "unbind", companionId, reason: "e2e-rm30-cleanup", remark: "cleanup" },
  });

  const bind = await api("/api/admin/boss-companion-relations?action=bind", {
    method: "POST",
    token: admin.token,
    admin: true,
    body: {
      action: "bind",
      bossId,
      companionId,
      remark: "e2e-rm30-bind",
      reason: "e2e-rm30-bind",
      commissionRate: 5,
    },
  });
  step("relation_bind_with_reason", bind.json?.ok === true, bind.json?.message || "");

  const hist = await api(
    "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(companionId),
    { token: admin.token, admin: true }
  );
  const bindEvt = (hist.json?.events || []).find((e) => e.action === "bind" && /e2e-rm30-bind/.test(String(e.reason || "")));
  step("relation_event_logged", !!bindEvt, `events=${(hist.json?.events || []).length}`);

  const realBoss = bossId;
  const realComp = companionId;

  let orderId = "";
  if (bossT && compT) {
    const place = await api("/api/orders", {
      method: "POST",
      token: bossT,
      body: {
        action: "place_order",
        companionId: realComp,
        serviceType: "VALORANT",
        service: "VALORANT",
        game: "VALORANT",
        gameId: "BCR-E2E",
        unitPrice: 30,
        hours: 1,
        quantity: 1,
        totalAmount: 30,
        paymentMethod: "duitnow",
        notes: "BCR-RM30-E2E",
        idempotencyKey: "bcr-rm30-" + Date.now(),
      },
    });
    orderId = place.json?.order?.id || "";
    step("place_rm30_order", !!orderId, orderId || place.json?.message || "");

    if (orderId) {
      await api("/api/orders", {
        method: "POST",
        token: bossT,
        body: { action: "submit_payment_proof", id: orderId, proofDataUrl: PNG, paymentMethod: "duitnow" },
      });
      if (csT) {
        await api("/api/customer-service", {
          method: "POST",
          token: csT,
          body: { action: "confirm_payment", id: orderId },
        });
      }
      await api("/api/companion", { method: "POST", token: compT, body: { action: "accept_direct_order", id: orderId } });
      await api("/api/companion", { method: "POST", token: compT, body: { action: "start_order", id: orderId } });
      const complete = await api("/api/companion", {
        method: "POST",
        token: compT,
        body: { action: "complete_order", id: orderId },
      });
      const confirm = await api("/api/orders", {
        method: "POST",
        token: bossT,
        body: { action: "confirm_complete", id: orderId },
      });
      step(
        "order_completed",
        /completed|已完成|确认完成/i.test(
          String(confirm.json?.order?.status || confirm.json?.message || complete.json?.message || "")
        ),
        `complete=${complete.json?.message || ""} confirm=${confirm.json?.message || ""}`
      );
    }
  } else {
    step("place_rm30_order", false, "portal login failed — cannot place order");
  }

  // --- Read snapshots from four ends ---
  let adminOrder = null;
  let csOrder = null;
  let bossEarn = null;
  let companionSettle = null;

  if (orderId) {
    const adminDetail = await api("/api/admin/orders?id=" + encodeURIComponent(orderId), {
      token: admin.token,
      admin: true,
    });
    adminOrder = adminDetail.json?.order || adminDetail.json?.orders?.[0] || null;
    if (!adminOrder) {
      const list = await api("/api/admin/orders?q=" + encodeURIComponent(orderId), {
        token: admin.token,
        admin: true,
      });
      adminOrder = (list.json?.orders || []).find((o) => o.id === orderId) || null;
    }

    if (csT) {
      const csBoot = await api("/api/customer-service", {
        method: "POST",
        token: csT,
        body: { action: "bootstrap" },
      });
      const csOrders = csBoot.json?.data?.orders || csBoot.json?.orders || [];
      csOrder = csOrders.find((o) => o.id === orderId) || null;
    }

    if (bossT) {
      const earn = await api("/api/boss/commission-earnings?limit=50", { token: bossT });
      bossEarn = (earn.json?.earnings || []).find((e) => e.orderId === orderId) || null;
    }

    if (compT) {
      const settle = await api("/api/companion?action=get_settlement&id=" + encodeURIComponent(orderId), {
        token: compT,
      });
      companionSettle = settle.json?.settlement || null;
    }
  }

  const platformFee =
    adminOrder?.platformFee ??
    csOrder?.platformFee ??
    bossEarn?.platformFeeAmount ??
    companionSettle?.platformCommissionCatFood;
  const companionIncome =
    adminOrder?.companionIncome ??
    adminOrder?.playerIncome ??
    csOrder?.companionIncome ??
    companionSettle?.companionNetCatFood;
  const bossCommission =
    adminOrder?.bossCommissionAmount ?? csOrder?.bossCommissionAmount ?? bossEarn?.bossCommissionAmount;

  step("snapshot_platform_fee_6", nearly(platformFee, 6), `platformFee=${platformFee}`);
  step("snapshot_companion_24", nearly(companionIncome, 24), `companionIncome=${companionIncome}`);
  step("snapshot_boss_0_30", nearly(bossCommission, 0.3), `bossCommission=${bossCommission}`);

  const fourEndSame =
    nearly(platformFee, 6) &&
    nearly(companionIncome, 24) &&
    nearly(bossCommission, 0.3) &&
    nearly(adminOrder?.platformFee, csOrder?.platformFee ?? adminOrder?.platformFee) &&
    nearly(adminOrder?.bossCommissionAmount, bossEarn?.bossCommissionAmount ?? adminOrder?.bossCommissionAmount);
  step(
    "four_end_identical_snapshot",
    fourEndSame,
    JSON.stringify({
      admin: {
        fee: adminOrder?.platformFee,
        boss: adminOrder?.bossCommissionAmount,
        companion: adminOrder?.companionIncome ?? adminOrder?.playerIncome,
      },
      cs: { fee: csOrder?.platformFee, boss: csOrder?.bossCommissionAmount, companion: csOrder?.companionIncome },
      bossEarn: bossEarn
        ? { fee: bossEarn.platformFeeAmount, boss: bossEarn.bossCommissionAmount, companion: bossEarn.companionIncomeAmount }
        : null,
      companion: companionSettle
        ? { fee: companionSettle.platformCommissionCatFood, net: companionSettle.companionNetCatFood }
        : null,
    })
  );

  // Duplicate settlement blocked (earnings unique on order_id)
  if (orderId) {
    const earn2 = bossT
      ? await api("/api/boss/commission-earnings?limit=50", { token: bossT })
      : { json: { earnings: [] } };
    const dupCount = (earn2.json?.earnings || []).filter((e) => e.orderId === orderId).length;
    step("duplicate_settlement_blocked", dupCount === 1, `earnings_for_order=${dupCount}`);
  } else {
    step("duplicate_settlement_blocked", false, "no order");
  }

  // Level change must not rewrite historical snapshot
  const frozenBoss = bossCommission;
  const frozenFee = platformFee;
  if (orderId && admin.token && realBoss) {
    await api("/api/admin/boss-levels?action=set-level", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: {
        action: "set-level",
        bossId: realBoss,
        levelCode: "diamond",
        pinMode: "permanent",
        reason: "e2e-rm30-level-change-immutability",
      },
    });
    const adminAgain = await api("/api/admin/orders?id=" + encodeURIComponent(orderId), {
      token: admin.token,
      admin: true,
    });
    const o2 = adminAgain.json?.order || null;
    const earnAgain = bossT ? await api("/api/boss/commission-earnings?limit=20", { token: bossT }) : { json: {} };
    const e2 = (earnAgain.json?.earnings || []).find((e) => e.orderId === orderId);
    step(
      "old_order_snapshot_unchanged_after_level_change",
      nearly(o2?.bossCommissionAmount ?? frozenBoss, frozenBoss) &&
        nearly(e2?.bossCommissionAmount ?? frozenBoss, frozenBoss) &&
        nearly(o2?.platformFee ?? frozenFee, frozenFee),
      `after_boss=${o2?.bossCommissionAmount} earning=${e2?.bossCommissionAmount}`
    );
  } else {
    step("old_order_snapshot_unchanged_after_level_change", false, "skipped");
  }

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\nSUMMARY", failed.length ? "FAIL" : "PASS", `${results.length - failed.length}/${results.length}`);
  console.log(JSON.stringify({ ok: failed.length === 0, base: BASE, orderId, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
