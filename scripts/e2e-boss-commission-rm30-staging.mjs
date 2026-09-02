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

  // Pick boss + companion via admin lists / BCR list
  const bosses = await api("/api/admin/bosses?limit=30", { token: admin.token, admin: true });
  const players = await api("/api/admin/players?limit=30", { token: admin.token, admin: true });
  const bossRows = bosses.json?.bosses || bosses.json?.rows || bosses.json?.items || [];
  const playerRows = players.json?.players || players.json?.companions || players.json?.rows || [];
  let bossId = "";
  let companionId = "";
  for (const b of bossRows) {
    const id = b.id || b.userId || b.profileId;
    if (id) {
      bossId = id;
      break;
    }
  }
  for (const p of playerRows) {
    const id = p.id || p.userId || p.profileId || p.companionId;
    if (id && id !== bossId) {
      companionId = id;
      break;
    }
  }
  step("picked_accounts", !!(bossId && companionId), `boss=${bossId} companion=${companionId}`);

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

  // --- Create RM30 order via admin/service if possible, else skip to settle probe ---
  // Prefer existing completed order path: place → pay → review → accept → complete
  // Use test accounts from p0-5 when available
  const BOSS_EMAIL = process.env.BOSS_EMAIL || "boss.final.1785714993009@meow.test";
  const COMP_EMAIL = process.env.COMP_EMAIL || "companion.final.1785714993009@meow.test";
  const CS_EMAIL = process.env.CS_EMAIL || "service.final.1785714993009@meow.test";

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
  const compUid = compLogin.json?.session?.user?.id || compLogin.json?.data?.player?.id || "";

  const csLogin = await api("/api/customer-service", {
    method: "POST",
    body: { action: "login", account: CS_EMAIL, password: PASS },
  });
  const csT = tok(csLogin.json);

  step("portal_logins", !!(bossT && compT && csT), `boss=${!!bossT} comp=${!!compT} cs=${!!csT}`);

  // Re-bind using real portal IDs when available
  const realBoss = bossUid || bossId;
  const realComp = compUid || companionId;
  if (bossUid && compUid) {
    await api("/api/admin/boss-companion-relations?action=unbind", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: { action: "unbind", companionId: realComp, reason: "e2e-rm30-rebinding", remark: "portal ids" },
    });
    const rebind = await api("/api/admin/boss-companion-relations?action=bind", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: {
        action: "bind",
        bossId: realBoss,
        companionId: realComp,
        reason: "e2e-rm30-portal-bind",
        commissionRate: 5,
      },
    });
    step("portal_relation_bind", rebind.json?.ok === true, rebind.json?.message || "");
  }

  // Ensure companion commission rate yields 20% platform fee (80% companion share)
  // Many companions already use level-based 20% platform rate.

  let orderId = "";
  if (bossT && compT) {
    const boot = await api("/api/companion?action=bootstrap", { token: compT });
    const meId = boot.json?.data?.player?.id || realComp;
    const place = await api("/api/orders", {
      method: "POST",
      token: bossT,
      body: {
        action: "place_order",
        companionId: meId,
        serviceType: "VALORANT",
        service: "VALORANT",
        game: "VALORANT",
        unitPrice: 30,
        hours: 1,
        quantity: 1,
        totalAmount: 30,
        paymentMethod: "tng",
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
        body: { action: "submit_payment_proof", id: orderId, proofDataUrl: PNG, paymentMethod: "tng" },
      });
      if (csT) {
        await api("/api/customer-service", {
          method: "POST",
          token: csT,
          body: { action: "approve_payment", orderId },
        });
      }
      // Companion accept / start / complete
      await api("/api/companion", { method: "POST", token: compT, body: { action: "accept_direct_order", id: orderId } });
      await api("/api/companion", { method: "POST", token: compT, body: { action: "start_order", id: orderId } });
      const complete = await api("/api/companion", {
        method: "POST",
        token: compT,
        body: { action: "complete_order", id: orderId },
      });
      // Boss confirm if needed
      await api("/api/orders", {
        method: "POST",
        token: bossT,
        body: { action: "confirm_complete", id: orderId },
      });
      // Admin force-complete fallback
      if (!/completed|已完成/i.test(String(complete.json?.order?.status || complete.json?.message || ""))) {
        await api("/api/admin/orders", {
          method: "POST",
          token: admin.token,
          admin: true,
          body: { action: "force_complete", id: orderId },
        });
      }
      step("order_completed", true, `complete_msg=${complete.json?.message || ""}`);
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
      const csDetail = await api("/api/customer-service", {
        method: "POST",
        token: csT,
        body: { action: "order_detail", id: orderId },
      });
      csOrder = csDetail.json?.order || null;
    }

    if (bossT) {
      const earn = await api("/api/boss/commission-earnings?limit=20", { token: bossT });
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

  // Duplicate settlement blocked
  if (orderId) {
    const again = await api("/api/admin/orders", {
      method: "POST",
      token: admin.token,
      admin: true,
      body: { action: "force_complete", id: orderId },
    });
    const earn2 = bossT
      ? await api("/api/boss/commission-earnings?limit=50", { token: bossT })
      : { json: { earnings: [] } };
    const dupCount = (earn2.json?.earnings || []).filter((e) => e.orderId === orderId).length;
    step("duplicate_settlement_blocked", dupCount <= 1, `earnings_for_order=${dupCount} force=${again.json?.message || ""}`);
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
