/**
 * P0-5 full four-end lifecycle + admin probes on fixed Staging.
 * Usage: node scripts/p0-5-full-lifecycle-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = "boss.final.1785714993009@meow.test";
const CS = "service.final.1785714993009@meow.test";
const COMP = "companion.final.1785714993009@meow.test";
const ADMIN = "admin@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${STAGING}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json, status: res.status };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || "";
}

(async () => {
  console.log("STAGING", STAGING);
  const bossT = tok((await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" })).json);
  const csT = tok((await api("/api/customer-service", null, { action: "login", account: CS, password: PASS })).json);
  const compT = tok((await api("/api/companion", null, { action: "login", account: COMP, password: PASS })).json);
  const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS })).json);
  step("四端登录", !!(bossT && csT && compT && adminT), `b=${!!bossT} cs=${!!csT} c=${!!compT} a=${!!adminT}`);

  // Admin probes
  const dash = await api("/api/admin/dashboard", adminT, null, "GET");
  step("Dashboard paid stats", !!dash.json?.ok && dash.json?.stats?.awaitingPayment != null, `todayOrders=${dash.json?.stats?.todayOrders} total=${dash.json?.stats?.totalAmount}`);

  const commission = await api("/api/admin/service-accounts?action=commission_config", adminT, null, "GET");
  step("Commission config loads", !!commission.json?.ok && !!commission.json?.config, `base=${commission.json?.config?.baseSalary}`);

  const pay = await api("/api/admin/payment-settings", adminT, null, "GET");
  const providers = pay.json?.bankProviders || [];
  const need = ["Maybank", "CIMB", "Public Bank", "OCBC", "Touch 'n Go", "支付宝", "微信支付"];
  step(
    "Payment providers complete",
    need.every((n) => providers.includes(n)),
    providers.join(",")
  );
  const saveBank = await api("/api/admin/payment-settings", adminT, {
    action: "save_bank",
    bank: {
      bankName: "Maybank",
      accountName: "Meow CuiJiao",
      enterpriseName: "MCJ",
      accountNumber: "51234567890",
      currency: "MYR",
      enabled: true,
    },
  });
  step("Payment bank save", !!saveBank.json?.ok, saveBank.json?.message || saveBank.status);

  const banners = await api("/api/admin/banners", adminT, null, "GET");
  step("Banner list", !!banners.json?.ok, `count=${(banners.json?.banners || []).length}`);

  const anns = await api("/api/admin/content?types=announcements", adminT, null, "GET");
  const homeAnns = await api("/api/platform/content?types=announcements&audience=home", null, null, "GET");
  step(
    "Announcements API",
    anns.json?.ok !== false && homeAnns.status < 500,
    `admin=${(anns.json?.announcements || []).length} home=${(homeAnns.json?.byType?.announcements || homeAnns.json?.announcements || []).length}`
  );

  const svc = await api("/api/admin/service-accounts", adminT, null, "GET");
  step("CS management list", !!svc.json?.ok && Array.isArray(svc.json?.accounts), `n=${(svc.json?.accounts || []).length}`);

  // Full lifecycle — place to the logged-in companion (not an unrelated public listing)
  const bootMe = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const meId = bootMe.json?.data?.player?.id || "";
  const comps = (await api("/api/public/companions", null, null, "GET")).json?.companions || [];
  const c1 = comps.find((c) => String(c.id) === String(meId)) || comps.find((c) => /Final|1717/i.test(c.name || "")) || comps[0];
  step("Public companions published", !!c1?.id && String(c1.id) === String(meId || c1.id), `${c1?.name} id=${c1?.id} me=${meId}`);

  const unit = Number(
    (Array.isArray(c1.services) && c1.services[0] && (c1.services[0].price ?? c1.services[0].unitPrice)) ||
      c1.priceValue ||
      c1.price ||
      75
  );
  const place = await api("/api/orders", bossT, {
    action: "place_order",
    companionId: c1.id,
    companionName: c1.name,
    serviceType: (c1.services && c1.services[0] && (c1.services[0].name || c1.services[0].title)) || "VALORANT",
    service: (c1.services && c1.services[0] && (c1.services[0].name || c1.services[0].title)) || "VALORANT",
    game: c1.game || (c1.services && c1.services[0] && c1.services[0].name) || "VALORANT",
    unitPrice: unit,
    hours: 1,
    quantity: 1,
    totalAmount: unit,
    gameId: "P05-FULL",
    paymentMethod: "tng",
    notes: "P0-5 full lifecycle",
    idempotencyKey: "p05-" + Date.now(),
  });
  const oid = place.json?.order?.id;
  step("1 Boss place_order", !!(place.json?.ok && oid), oid);

  const proof = await api("/api/orders", bossT, {
    action: "submit_payment_proof",
    id: oid,
    proofDataUrl: PNG,
    paymentMethod: "tng",
  });
  step("2 Upload proof", !!proof.json?.ok && proof.json?.order?.paymentReview === true, `review=${proof.json?.order?.paymentReview}`);

  const confirm = await api("/api/customer-service", csT, { action: "confirm_payment", id: oid });
  step("3 CS approve payment", !!confirm.json?.ok && confirm.json?.order?.status === "claimed", confirm.json?.order?.status);

  // If somehow pending, assign
  let st = confirm.json?.order?.status;
  if (st === "pending") {
    const assign = await api("/api/customer-service", csT, {
      action: "assign_companion",
      id: oid,
      companion_id: c1.id,
      from_grabs: false,
    });
    st = assign.json?.order?.status;
    step("3b CS assign", assign.json?.ok && st === "claimed", st);
  } else {
    step("3b Already designated claimed", st === "claimed", st);
  }

  const bossMid = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  step("4 Boss 等待陪玩确认", bossMid?.status === "claimed" && /等待陪玩确认/.test(String(bossMid?.statusText || "")), bossMid?.statusText);

  const accept = await api("/api/companion", compT, { action: "accept_direct_order", id: oid });
  step("5 Companion accept", !!accept.json?.ok && accept.json?.order?.status === "in_progress", accept.json?.order?.status);

  const bossGo = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  const csGo = ((await api("/api/customer-service", csT, { action: "bootstrap" })).json?.data?.orders || []).find((o) => o.id === oid);
  const adminGo = ((await api("/api/admin/orders", adminT, null, "GET")).json?.orders || []).find((o) => o.id === oid);
  step(
    "6 四端进行中同步",
    bossGo?.status === "in_progress" && csGo?.status === "in_progress" && adminGo?.status === "in_progress",
    `b=${bossGo?.status} cs=${csGo?.status} a=${adminGo?.status}`
  );

  const complete = await api("/api/companion", compT, { action: "complete_order", id: oid });
  // may need boss confirm
  let finalStatus = complete.json?.order?.status;
  if (finalStatus === "in_progress" || /等待老板确认|申请完成/.test(String(complete.json?.message || ""))) {
    const bossConfirm = await api("/api/orders", bossT, { action: "confirm_complete", id: oid });
    finalStatus = bossConfirm.json?.order?.status || finalStatus;
    step("7 Complete (+boss confirm)", /completed/.test(String(finalStatus)), `${complete.json?.message} → ${finalStatus}`);
  } else {
    step("7 Complete", /completed/.test(String(finalStatus)), finalStatus);
  }

  const boot = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const earnings = boot.json?.data?.earnings || {};
  step("8 Earnings stats", typeof earnings.totalIncome === "number", JSON.stringify(earnings).slice(0, 100));

  const wd = await api("/api/companion", compT, { action: "request_withdrawal", amount: 1, remark: "p05" });
  step(
    "9 Withdraw path",
    !!(wd.json?.ok || /上限|余额|账户|审核|pending|提现/.test(String(wd.json?.message || ""))),
    wd.json?.message
  );

  const fin = await api("/api/admin/finance?action=bootstrap", adminT, null, "GET");
  step("10 Admin finance sync", !!fin.json?.ok && Array.isArray(fin.json?.withdrawals), `wd=${(fin.json?.withdrawals || []).length}`);

  // Admin order status sync probe on a fresh unpaid→cancel style order
  const place2 = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P05 admin status",
      game: "VALORANT",
      game_id: "P05S",
      description: "admin status sync",
      hours: 1,
      unit_price: 11,
      total_amount: 11,
      order_type: "custom",
      payment_method: "tng",
    },
  });
  const oid2 = place2.json?.order?.id;
  const upd = await api("/api/admin/orders", adminT, { action: "update_status", id: oid2, status: "cancelled", reason: "p05 admin sync" });
  const boss2 = ((await api(`/api/orders?id=${oid2}`, bossT, null, "GET")).json?.orders || []).find((o) => o.id === oid2);
  step("Admin status → boss sync", !!upd.json?.ok && boss2?.status === "cancelled", `upd=${upd.json?.message} boss=${boss2?.status}`);

  // Admin list_grabs / assign UI actions exist
  const grabs = await api("/api/admin/orders", adminT, { action: "list_grabs", id: oid });
  step("Admin view grabs", !!grabs.json?.ok, `grabs=${(grabs.json?.grabs || []).length}`);

  const assets = await Promise.all([
    fetch(`${STAGING}/src/admin-service-accounts.js?v=20260805p05a1`).then((r) => r.text()),
    fetch(`${STAGING}/src/admin-banner-manager.js?v=20260805p05a1`).then((r) => r.text()),
  ]);
  step("Commission UI wired", /__MCJRenderCsCommission/.test(assets[0]), "service-accounts");
  step("Banner publish is_main", /is_main:\s*true/.test(assets[1]), "banner-manager");

  console.log("\n=== P0-5 FULL LIFECYCLE SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  console.log(`PASS=${results.length - fail} FAIL=${fail}`);
  console.log(`STAGING=${STAGING}/`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
