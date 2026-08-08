/**
 * P0: restore grab-hall flow —
 * boss order → CS review/pay → hall → companion grab → boss「我要她」intent → CS「确认指定」→ companion confirm
 * + VIP direct designate skips hall.
 *
 * Usage: node scripts/p0-grab-hall-boss-intent-cs-confirm-accept.mjs
 */
const BASE = (process.env.MCJ_STAGING_URL || process.env.MCJ_BASE || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const COMP_ALT = process.env.E2E_COMPANION_ALT_EMAIL || "companion2.final.1785714993009@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-service-token": token,
          }
        : {}),
    },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json, ok: res.ok && json.ok !== false };
}
async function ackForced(token) {
  const pending = await api("/api/companion", token, { action: "pending_forced" });
  const list = pending.json?.pendingForced || pending.json?.pending || [];
  for (const item of list) {
    const id = item.id || item.announcementId || item.contentId;
    if (!id) continue;
    await api("/api/companion", token, {
      action: "acknowledge_forced",
      content_id: id,
      content_version: String(item.version || item.content_version || item.contentVersion || "1"),
      content_type: item.contentType || item.content_type || "announcement",
    });
  }
}

(async () => {
  console.log("STAGING", BASE);

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossT = tok(bossLogin.json);
  step("boss_login", !!bossT, bossLogin.json?.message || "");

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csT = tok(csLogin.json);
  step("cs_login", !!csT, csLogin.json?.message || "");

  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const compT = tok(compLogin.json);
  const companionId = compLogin.json?.session?.user?.id || compLogin.json?.user?.id || "";
  step("companion_login", !!compT && !!companionId, companionId || compLogin.json?.message || "");

  let companionAltId = "";
  let compAltT = "";
  const altLogin = await api("/api/companion", null, { action: "login", account: COMP_ALT, password: PASS });
  if (altLogin.ok) {
    compAltT = tok(altLogin.json);
    companionAltId = altLogin.json?.session?.user?.id || altLogin.json?.user?.id || "";
  }
  step("companion_alt_optional", true, companionAltId ? `alt=${companionAltId}` : "alt missing (soft)");

  await ackForced(compT);
  if (compAltT) await ackForced(compAltT);
  await api("/api/companion", compT, { action: "set_online_status", online_status: "online" });
  if (compAltT) await api("/api/companion", compAltT, { action: "set_online_status", online_status: "online" });

  // ---------- A) Public grab hall path ----------
  const create = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P0抢单大厅流程",
      game: "VALORANT",
      game_id: `P0-GRAB-${Date.now()}`,
      description: "grab hall boss intent cs confirm",
      hours: 1,
      unit_price: 18,
      total_amount: 18,
      payment_method: "manual_transfer",
    },
  });
  const orderId = create.json?.order?.id || create.json?.id || "";
  const orderNo = create.json?.order?.orderNo || create.json?.order?.order_no || "";
  step("boss_create_public", create.ok && !!orderId, `${orderNo || orderId} status=${create.json?.order?.status}`);

  const proof = await api("/api/orders", bossT, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: PNG,
    paymentMethod: "tng",
  });
  step("boss_submit_proof", proof.ok, proof.json?.message || "");

  // CS must NOT free-assign before hall
  const earlyAssign = await api("/api/customer-service", csT, {
    action: "assign_companion",
    id: orderId,
    companion_id: companionId,
  });
  step(
    "cs_cannot_assign_before_hall",
    !earlyAssign.ok,
    earlyAssign.json?.message || earlyAssign.json?.code || ""
  );

  const confirmPay = await api("/api/customer-service", csT, {
    action: "confirm_payment",
    id: orderId,
    send_to_hall: true,
  });
  const afterPayStatus = confirmPay.json?.order?.status || "";
  step(
    "cs_confirm_to_hall",
    confirmPay.ok && (afterPayStatus === "pending" || afterPayStatus === "waiting_boss_confirm"),
    `status=${afterPayStatus} path=${confirmPay.json?.path || ""} msg=${confirmPay.json?.message || ""}`
  );

  // CS still cannot free-assign with empty grabs
  const assignEmpty = await api("/api/customer-service", csT, {
    action: "assign_companion",
    id: orderId,
    companion_id: companionId,
  });
  step(
    "cs_cannot_assign_without_grabs",
    !assignEmpty.ok && /抢单|NO_GRABBERS|暂无/i.test(assignEmpty.json?.message || assignEmpty.json?.code || ""),
    assignEmpty.json?.message || ""
  );

  const grab1 = await api("/api/companion", compT, { action: "accept_order", id: orderId });
  step("companion_grab", grab1.ok || /已抢|already/i.test(grab1.json?.message || ""), grab1.json?.message || "");

  if (compAltT && companionAltId) {
    const grabAlt = await api("/api/companion", compAltT, { action: "accept_order", id: orderId });
    step("companion_alt_grab", grabAlt.ok || /已抢|already/i.test(grabAlt.json?.message || ""), grabAlt.json?.message || "");
  } else {
    step("companion_alt_grab", true, "skipped");
  }

  const bossList = await api("/api/orders", bossT, { action: "list_grabs", id: orderId });
  const grabs = bossList.json?.grabs || [];
  const grabCount = Number(bossList.json?.grabCount != null ? bossList.json.grabCount : grabs.length) || 0;
  const sample = grabs[0]?.companion || {};
  const hasCardFields =
    !!sample &&
    ("nickname" in sample || sample.nickname) &&
    ("avatarUrl" in sample || "level" in sample || "price" in sample || "unitPrice" in sample);
  step(
    "boss_sees_grabbers",
    bossList.ok && grabCount >= 1 && hasCardFields,
    `count=${grabCount} fields=${JSON.stringify({
      nickname: sample.nickname,
      level: sample.level,
      tags: sample.tags,
      voiceType: sample.voiceType,
      price: sample.price ?? sample.unitPrice,
      rank: sample.gameRank || sample.rank,
      online: sample.onlineStatusLabel || sample.onlineStatus,
      grabbedAt: grabs[0]?.grabbedAt,
      voiceUrl: !!sample.voiceUrl,
    })}`
  );

  const bossOrders = await api("/api/orders", bossT, null, "GET");
  const bossOrder = (bossOrders.json?.orders || []).find((o) => o.id === orderId);
  step(
    "boss_order_shows_grab_count",
    !!bossOrder && Number(bossOrder.grabCount || (bossOrder.grabs || []).length || 0) >= 1,
    `grabCount=${bossOrder?.grabCount} status=${bossOrder?.status} text=${bossOrder?.statusText || ""}`
  );

  // Boss「我要她」= intent only (no companion_id bind)
  const want = await api("/api/orders", bossT, {
    action: "want_him",
    id: orderId,
    companion_id: companionId,
  });
  const intentOnly = want.json?.intentOnly === true || /意向|等待客服/i.test(want.json?.message || "");
  const afterWant = want.json?.order || {};
  step(
    "boss_want_her_intent_only",
    want.ok && intentOnly && !afterWant.companionId && !afterWant.companion_id,
    `intentOnly=${want.json?.intentOnly} companion=${afterWant.companionId || afterWant.companion_id || ""} msg=${want.json?.message || ""}`
  );

  const grabsAfterIntent = await api("/api/orders", bossT, { action: "list_grabs", id: orderId });
  const intent = grabsAfterIntent.json?.bossIntent || null;
  step(
    "boss_intent_visible",
    !!intent && String(intent.companionId) === String(companionId),
    JSON.stringify(intent || {})
  );

  // CS confirm指定 → claimed + companion_id
  const csConfirm = await api("/api/customer-service", csT, {
    action: "confirm_grab_assignment",
    id: orderId,
    companion_id: companionId,
    from_grabs: true,
  });
  const locked = csConfirm.json?.order || {};
  step(
    "cs_confirm_assign_locks",
    csConfirm.ok &&
      String(locked.companionId || locked.companion_id || "") === String(companionId) &&
      String(locked.status || "") === "claimed",
    `status=${locked.status} companion=${locked.companionId || locked.companion_id} msg=${csConfirm.json?.message || ""}`
  );

  // Cannot re-assign after lock
  if (companionAltId) {
    const steal = await api("/api/customer-service", csT, {
      action: "confirm_grab_assignment",
      id: orderId,
      companion_id: companionAltId,
      from_grabs: true,
    });
    step(
      "cs_cannot_steal_after_lock",
      !steal.ok || /不能|锁定|已指定|BOSS_PICK_LOCK/i.test(steal.json?.message || steal.json?.code || ""),
      steal.json?.message || steal.json?.code || ""
    );
  } else {
    step("cs_cannot_steal_after_lock", true, "skipped no alt");
  }

  const accept = await api("/api/companion", compT, { action: "accept_direct_order", id: orderId });
  const afterAccept = accept.json?.order || {};
  step(
    "companion_accept_to_service",
    accept.ok && ["confirmed", "in_progress"].includes(String(afterAccept.status || "")),
    `status=${afterAccept.status} msg=${accept.json?.message || ""}`
  );

  // ---------- B) VIP direct designate skips hall ----------
  const vipCreate = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P0 VIP指定",
      game: "VALORANT",
      game_id: `P0-VIP-${Date.now()}`,
      description: "vip direct companion",
      hours: 1,
      unit_price: 20,
      total_amount: 20,
      payment_method: "manual_transfer",
      companion_id: companionId,
      companionId,
    },
  });
  const vipId = vipCreate.json?.order?.id || "";
  const vipOrder = vipCreate.json?.order || {};
  step(
    "vip_create_assigned",
    vipCreate.ok &&
      !!vipId &&
      String(vipOrder.companionId || vipOrder.companion_id || "") === String(companionId),
    `status=${vipOrder.status} companion=${vipOrder.companionId || vipOrder.companion_id} type=${vipOrder.assignmentType || vipOrder.orderType || vipOrder.orderTypeText || ""}`
  );

  await api("/api/orders", bossT, {
    action: "submit_payment_proof",
    id: vipId,
    proofDataUrl: PNG,
    paymentMethod: "tng",
  });
  const vipPay = await api("/api/customer-service", csT, { action: "confirm_payment", id: vipId });
  const vipAfter = vipPay.json?.order || {};
  const vipPushHall = await api("/api/customer-service", csT, {
    action: "push_to_grab_hall",
    id: vipId,
  });
  step(
    "vip_confirm_skips_hall",
    vipPay.ok &&
      String(vipAfter.status || "") === "claimed" &&
      String(vipAfter.companionId || vipAfter.companion_id || "") === String(companionId) &&
      !vipPushHall.ok,
    `status=${vipAfter.status} companion=${vipAfter.companionId || vipAfter.companion_id} pushHall=${vipPushHall.json?.message || ""} path=${vipPay.json?.path || ""}`
  );

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\n=== SUMMARY ===");
  console.log(`PASS ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(`FAIL ${f.step}: ${f.detail}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
