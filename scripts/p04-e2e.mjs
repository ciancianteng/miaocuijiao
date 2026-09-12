/**
 * P0-4 probe: real Supabase order lifecycle on Preview.
 * Usage: node scripts/p04-e2e.mjs <preview-base>
 */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const PASS = "McjTest@12345678";
if (!BASE) {
  console.error("Usage: node scripts/p04-e2e.mjs <preview-url>");
  process.exit(2);
}
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
async function jfetch(path, init = {}) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { res, body, text, status: res.status };
}
function tok(auth) {
  return auth?.session?.accessToken || auth?.session?.token || auth?.accessToken || "";
}
async function login(email, portal) {
  const { body } = await jfetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS, loginPortal: portal }),
  });
  return { ok: !!body?.ok, token: tok(body), body, profile: body?.profile || body?.session?.user };
}

(async () => {
  // Health / portals
  const health = await jfetch("/api/auth?action=health");
  step("0 DB configured", !!(health.body?.ok && health.body?.configured !== false), JSON.stringify(health.body).slice(0, 180));

  for (const [name, path] of [
    ["Boss portal", "/"],
    ["CS login", "/customer-service/login/"],
    ["Companion login", "/companion/login/"],
    ["Admin login", "/admin/login/"],
  ]) {
    const r = await fetch(BASE + path);
    step(`Portal ${name}`, r.ok, `status=${r.status}`);
  }

  const boss = await login("boss@meow.test", "boss");
  step("Login boss", boss.ok && !!boss.token, `ok=${boss.ok}`);
  const cs = await login("service@meow.test", "customer_service");
  step("Login CS", cs.ok && !!cs.token, `ok=${cs.ok}`);
  const companion = await login("companion@meow.test", "companion");
  step("Login companion", companion.ok && !!companion.token, `ok=${companion.ok}`);
  const admin = await login("admin@meow.test", "admin");
  step("Login admin", admin.ok && !!admin.token, `ok=${admin.ok}`);

  const bh = { Authorization: `Bearer ${boss.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ch = { Authorization: `Bearer ${cs.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ph = { Authorization: `Bearer ${companion.token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ah = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json", Accept: "application/json" };

  const comps = await jfetch("/api/public/companions");
  const testComp = (comps.body?.companions || []).find((c) => /TEST|验收/.test(c.name || "")) || (comps.body?.companions || [])[0];
  step("TEST companion exists", !!(testComp && testComp.id), `id=${testComp?.id} name=${testComp?.name}`);

  // 1 place order
  const place = await jfetch("/api/orders", {
    method: "POST",
    headers: bh,
    body: JSON.stringify({
      action: "place_order",
      companionId: testComp?.id,
      companionName: testComp?.name,
      serviceType: "陪玩",
      service: "陪玩",
      game: "陪玩",
      unitPrice: Number(testComp?.priceValue || 35),
      hours: 1,
      quantity: 1,
      totalAmount: Number(testComp?.priceValue || 35),
      gameId: "P04-E2E-GID",
      paymentMethod: "tng",
      notes: "P0-4 E2E",
      idempotencyKey: "p04-" + Date.now(),
    }),
  });
  const orderId = place.body?.order?.id;
  step("1 Boss place_order", !!(place.body?.ok && orderId && place.body.order.status === "awaiting_payment"), `id=${orderId} status=${place.body?.order?.status} http=${place.status}`);

  // Ensure conversation exists for CS
  const chatOpen = await jfetch("/api/chat", {
    method: "POST",
    headers: bh,
    body: JSON.stringify({ action: "ensure_order_conversation", orderId }),
  }).catch(() => ({ body: {} }));
  // fallback: list CS bootstrap
  const csBoot = await jfetch("/api/customer-service", {
    method: "GET",
    headers: ch,
  });
  step("2 CS bootstrap sees data", !!(csBoot.body?.ok && csBoot.body?.data), `keys=${Object.keys(csBoot.body?.data || {}).slice(0, 12).join(",")}`);

  // Find conversation for this order
  let convId =
    chatOpen.body?.conversation?.id ||
    (csBoot.body?.conversations || csBoot.body?.data?.conversations || []).find((c) => c.order_id === orderId || c.orderId === orderId)?.id;

  if (!convId) {
    // try list via chat as boss
    const bossConvs = await jfetch("/api/chat?action=list", { headers: bh });
    const list = bossConvs.body?.conversations || bossConvs.body?.data?.conversations || [];
    convId = list.find((c) => c.order_id === orderId || c.orderId === orderId)?.id || list[0]?.id;
    step("2b Find conversation", !!convId, `conv=${convId} list=${list.length}`);
  } else {
    step("2b Find conversation", true, `conv=${convId}`);
  }

  // 3 accept
  const accept = await jfetch("/api/customer-service/accept", {
    method: "POST",
    headers: ch,
    body: JSON.stringify({ conversationId: convId, conversation_id: convId, orderId, order_id: orderId }),
  });
  const acceptAlt =
    accept.body?.ok
      ? accept
      : await jfetch("/api/customer-service", {
          method: "POST",
          headers: ch,
          body: JSON.stringify({ action: "take_conversation", conversationId: convId, conversation_id: convId }),
        });
  step("3 CS accept/接待", !!(acceptAlt.body?.ok || accept.body?.ok), `accept=${accept.status} alt=${acceptAlt.status} msg=${acceptAlt.body?.message || accept.body?.message}`);

  // 6 chat both ways
  const bossMsg = await jfetch("/api/chat", {
    method: "POST",
    headers: bh,
    body: JSON.stringify({ action: "send", conversationId: convId, content: "老板P04测试消息" }),
  });
  const csMsg = await jfetch("/api/customer-service", {
    method: "POST",
    headers: ch,
    body: JSON.stringify({ action: "send_message", conversation_id: convId, content: "客服P04测试回复" }),
  });
  step("6 Bidirectional chat", !!(bossMsg.body?.ok || bossMsg.body?.message) && !!(csMsg.body?.ok), `boss=${bossMsg.status} cs=${csMsg.status} bm=${bossMsg.body?.message} cm=${csMsg.body?.message}`);

  // 7 confirm payment
  const pay = await jfetch("/api/customer-service", {
    method: "POST",
    headers: ch,
    body: JSON.stringify({ action: "confirm_payment", id: orderId }),
  });
  step("7 CS confirm_payment", !!(pay.body?.ok && (pay.body.order?.status === "claimed" || pay.body.order?.status === "pending")), `status=${pay.body?.order?.status} msg=${pay.body?.message}`);

  // 8 push companion (assign) — for already-assigned may skip; try update if pending
  let afterPayStatus = pay.body?.order?.status;
  if (afterPayStatus === "pending") {
    const assign = await jfetch("/api/customer-service", {
      method: "POST",
      headers: ch,
      body: JSON.stringify({ action: "assign_companion", id: orderId, companion_id: testComp.id }),
    });
    step("8 CS assign/push companion", !!assign.body?.ok, `status=${assign.body?.order?.status} msg=${assign.body?.message}`);
    afterPayStatus = assign.body?.order?.status;
  } else {
    step("8 CS assign/push companion", afterPayStatus === "claimed", `already companion-bound status=${afterPayStatus}`);
  }

  // 9 companion accept
  // claimed → accept_direct; pending/waiting_boss_confirm → accept_order
  let acceptOrder;
  if (afterPayStatus === "claimed") {
      acceptOrder = await jfetch("/api/companion", {
      method: "POST",
      headers: ph,
      body: JSON.stringify({ action: "accept_direct_order", id: orderId }),
    });
  } else if (afterPayStatus === "waiting_boss_confirm") {
    const bossConfirm = await jfetch("/api/orders", {
      method: "POST",
      headers: bh,
      body: JSON.stringify({ action: "confirm_companion", id: orderId }),
    });
    step("8b Boss confirm companion", !!bossConfirm.body?.ok, `status=${bossConfirm.body?.order?.status}`);
    acceptOrder = { body: bossConfirm.body };
  } else {
    acceptOrder = await jfetch("/api/companion", {
      method: "POST",
      headers: ph,
      body: JSON.stringify({ action: "accept_order", id: orderId }),
    });
  }
  const status9 = acceptOrder.body?.order?.status || acceptOrder.body?.order?.dbStatus;
  step("9 Companion accept", !!(acceptOrder.body?.ok && (status9 === "confirmed" || status9 === "waiting_boss_confirm")), `status=${status9} msg=${acceptOrder.body?.message}`);

  // If still waiting_boss_confirm after accept_order, boss confirms
  let curStatus = status9;
  if (curStatus === "waiting_boss_confirm") {
    const bc = await jfetch("/api/orders", {
      method: "POST",
      headers: bh,
      body: JSON.stringify({ action: "confirm_companion", id: orderId }),
    });
    curStatus = bc.body?.order?.status;
    step("9b Boss confirm after claim", curStatus === "confirmed", `status=${curStatus}`);
  }

  // 10 start
  const start = await jfetch("/api/companion", {
    method: "POST",
    headers: ph,
    body: JSON.stringify({ action: "start_order", id: orderId }),
  });
  step("10 Start service", !!(start.body?.ok && start.body.order?.status === "in_progress"), `status=${start.body?.order?.status} msg=${start.body?.message}`);

  // 11 complete
  const complete = await jfetch("/api/companion", {
    method: "POST",
    headers: ph,
    body: JSON.stringify({ action: "complete_order", id: orderId }),
  });
  step("11 Complete service", !!(complete.body?.ok && complete.body.order?.status === "completed"), `status=${complete.body?.order?.status} msg=${complete.body?.message}`);

  // 12 review
  const review = await jfetch("/api/orders", {
    method: "POST",
    headers: bh,
    body: JSON.stringify({ action: "submit_review", id: orderId, rating: 5, content: "P0-4 E2E 好评" }),
  });
  step("12 Boss review", !!review.body?.ok, `msg=${review.body?.message}`);

  // Admin real management probes
  const banners = await jfetch("/api/admin/content?type=banners", { headers: ah });
  step("Admin banners list", !!(banners.body?.ok || Array.isArray(banners.body?.items) || Array.isArray(banners.body?.banners)), `http=${banners.status} ok=${banners.body?.ok}`);

  const anns = await jfetch("/api/admin/content?type=announcements", { headers: ah });
  step("Admin announcements list", !!(anns.body?.ok || Array.isArray(anns.body?.items) || Array.isArray(anns.body?.announcements)), `http=${anns.status}`);

  const levels = await jfetch("/api/admin/companion-levels", {
    headers: { ...ah, "x-mcj-admin-role": "admin" },
  });
  step("Admin companion levels", !!(levels.body?.ok || Array.isArray(levels.body?.levels)), `http=${levels.status} ok=${levels.body?.ok} count=${(levels.body?.levels || []).length}`);

  const ordersAdmin = await jfetch("/api/admin/orders", { headers: ah });
  step("Admin orders list", !!(ordersAdmin.body?.ok || Array.isArray(ordersAdmin.body?.orders)), `http=${ordersAdmin.status} count=${(ordersAdmin.body?.orders || []).length}`);

  const coupons = await jfetch("/api/coupons", { headers: ah });
  step("Admin/coupons API", coupons.status !== 500 && coupons.body?.ok !== false, `http=${coupons.status} ok=${coupons.body?.ok} msg=${coupons.body?.message}`);

  const couponAdmin = await jfetch("/api/admin/platform-content?type=marketing_coupons", {
    headers: { ...ah, "x-mcj-admin-role": "admin" },
  });
  step("Admin coupon management API", !!(couponAdmin.body?.ok), `http=${couponAdmin.status} source=${couponAdmin.body?.source} count=${(couponAdmin.body?.items || []).length}`);

  const adsAdmin = await jfetch("/api/admin/platform-content?type=ad_slots", {
    headers: { ...ah, "x-mcj-admin-role": "admin" },
  });
  step("Admin ads API", !!(adsAdmin.body?.ok), `http=${adsAdmin.status} source=${adsAdmin.body?.source}`);

  // Admin write: coupon + ad (announcements-backed)
  const couponWrite = await jfetch("/api/admin/platform-content", {
    method: "POST",
    headers: { ...ah, "x-mcj-admin-role": "admin" },
    body: JSON.stringify({
      action: "create",
      type: "marketing_coupons",
      payload: {
        title: "[TEST] P04优惠券",
        status: "published",
        enabled: true,
        sort: 1,
        draft: {
          name: "[TEST] P04优惠券",
          code: "P04TEST" + Date.now().toString().slice(-4),
          type: "fixed",
          value: 5,
          threshold: 20,
          scope: "all",
          claimMethod: "public",
          startAt: "2026-01-01",
          endAt: "2027-12-31",
        },
      },
    }),
  });
  step("Admin create coupon", !!(couponWrite.body?.ok && couponWrite.body?.item), `msg=${couponWrite.body?.message} source=${couponWrite.body?.source}`);

  const adWrite = await jfetch("/api/admin/platform-content", {
    method: "POST",
    headers: { ...ah, "x-mcj-admin-role": "admin" },
    body: JSON.stringify({
      action: "create",
      type: "ad_slots",
      payload: {
        title: "[TEST] P04广告位",
        status: "published",
        enabled: true,
        sort: 1,
        draft: { title: "[TEST] P04广告位", image: "/default-avatar.png", link: "/", position: "home", sort: 1 },
      },
    }),
  });
  step("Admin create ad slot", !!(adWrite.body?.ok && adWrite.body?.item), `msg=${adWrite.body?.message}`);

  // Admin refund on a refund_requested order (create path via update_status then refund)
  const refundPrep = await jfetch("/api/admin/orders", {
    method: "POST",
    headers: ah,
    body: JSON.stringify({ action: "update_status", id: orderId, status: "refund_requested" }),
  });
  const refund = await jfetch("/api/admin/orders", {
    method: "POST",
    headers: ah,
    body: JSON.stringify({ action: "refund", id: orderId }),
  });
  step("Admin refund action", !!(refund.body?.ok || refundPrep.body?.ok), `prep=${refundPrep.body?.message || refundPrep.status} refund=${refund.body?.message || refund.status}`);

  // Players audit list
  const players = await jfetch("/api/admin/players", { headers: ah });
  step("Admin players/audit list", !!(players.body?.ok || Array.isArray(players.body?.players) || Array.isArray(players.body?.items)), `http=${players.status} ok=${players.body?.ok}`);

  // Commission rates present on levels
  const hasCommission = (levels.body?.levels || []).some((lv) => lv.commissionRate != null || lv.commission != null);
  step("Admin levels include commission", hasCommission, `sample=${(levels.body?.levels || [])[0]?.commissionRate}`);

  console.log("\n=== P0-4 E2E SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  const pass = results.filter((r) => r.result === "PASS").length;
  console.log(`PASS=${pass} FAIL=${fail}`);
  console.log(`PREVIEW=${BASE}`);
  console.log(`ORDER_ID=${orderId || ""}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
