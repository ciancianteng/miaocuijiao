/**
 * Staging regression for the service-requirement / offers / notify / quick-reply / fee batch.
 * Does not load production env. Does not call production.
 */
import { writeFileSync } from "node:fs";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";
import { captureRequirementAnswers } from "../server/api/_order-requirements.js";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({
  script: "batch-p1-p10-staging",
  base: BASE,
  supabaseUrl: "https://cfccwysniduwkjskiqgy.supabase.co",
  requireStagingSupabase: true,
});

const PASS = "McjTest@12345678";
const results = [];
function record(id, ok, note = "") {
  results.push({ id, ok: !!ok, note: String(note || "").slice(0, 800) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? " — " + String(note).slice(0, 400) : ""}`);
  return !!ok;
}
async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
async function get(path, token) {
  const res = await fetch(BASE + path, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function tokenOf(login) {
  const s = login.json?.session || {};
  return s.token || s.accessToken || login.json?.token || "";
}

function feeCents(grossRm) {
  const grossCents = Math.round(Number(grossRm) * 100);
  const feeCents = 80;
  if (grossCents <= feeCents) return { ok: false, message: "可提现金额必须高于 RM0.80" };
  return { ok: true, gross: grossCents / 100, fee: 0.8, net: (grossCents - feeCents) / 100 };
}

async function main() {
  const info = await get("/api/build-info");
  record(
    "staging-ref",
    info.json?.supabaseRef === "cfccwysniduwkjskiqgy" && info.json?.supabaseIsProduction !== true,
    `ref=${info.json?.supabaseRef || ""}`
  );

  const localFee = feeCents(72);
  record("G-formula", localFee.ok && localFee.fee === 0.8 && localFee.net === 71.2, JSON.stringify(localFee));
  record("G-reject-low", feeCents(0.8).ok === false, feeCents(0.8).message);

  const snap = captureRequirementAnswers(
    [{ id: "game", name: "游戏ID", kind: "text", required: true, enabled: true }],
    [{ fieldId: "game", value: "OLD-ID" }]
  );
  const changed = captureRequirementAnswers(
    [{ id: "rank", name: "段位", kind: "text", required: true, enabled: true }],
    [{ fieldId: "rank", value: "新段位" }]
  );
  record("B-snapshot-isolated", snap.fields[0]?.value === "OLD-ID" && changed.fields[0]?.name === "段位" && snap.fields[0]?.name === "游戏ID", JSON.stringify({ snap, changed }));

  const admin = await post("/api/auth", { action: "login", email: "admin@meow.test", password: PASS, loginPortal: "admin" });
  const adminTok = tokenOf(admin);
  let activeService = null;
  let activeFields = [];
  const services = await get("/api/admin/services", adminTok);
  const service = (services.json?.services || []).find((item) => item && item.id);
  if (!service) {
    record("A-admin-fields", false, services.json?.message || "no service");
  } else {
    const saved = await post("/api/admin/services", {
      action: "save_order_fields",
      id: service.id,
      orderFields: [
        { name: "游戏ID", kind: "text", required: true, placeholder: "请输入游戏ID", enabled: true },
        { name: "区服", kind: "select", required: true, options: ["国服", "国际服"], enabled: true },
        { name: "备注", kind: "textarea", required: false, enabled: true },
      ],
    }, adminTok);
    const pub = await get("/api/platform/services?scope=all");
    const live = (pub.json?.services || []).find((item) => item.id === service.id);
    const names = (live?.orderFields || []).map((field) => field.name);
    record("A-admin-fields", saved.json?.ok === true && names.includes("游戏ID") && names.includes("区服"), `save=${saved.status} ${saved.json?.message || ""} names=${names.join(",")}`);
    activeService = service;
    activeService.originalFields = service.orderFields || [];
    activeFields = live?.orderFields || [];
  }

  const cs = await post("/api/customer-service", { action: "login", account: "service@meow.test", password: PASS });
  const csTok = tokenOf(cs);
  const marker = `付款提醒-${Date.now()}`;
  const listed = await post("/api/customer-service", { action: "list_quick_replies" }, csTok);
  const replies = Array.isArray(listed.json?.replies) ? listed.json.replies : [];
  const savedReplies = await post("/api/customer-service", {
    action: "save_quick_replies",
    replies: replies.concat([{ title: marker, content: "老板您好，请确认订单资料及付款后，我们会尽快为您安排陪玩。", enabled: true }]),
  }, csTok);
  const again = await post("/api/customer-service", { action: "list_quick_replies" }, csTok);
  const found = (again.json?.replies || []).some((item) => item.title === marker);
  record("F-quick-reply-persisted", savedReplies.json?.ok === true && found, `save=${savedReplies.status} found=${found}`);
  if (found) {
    await post("/api/customer-service", {
      action: "save_quick_replies",
      replies: (again.json.replies || []).filter((item) => item.title !== marker),
    }, csTok);
  }

  const companion = await post("/api/companion", { action: "login", account: "companion@meow.test", password: PASS });
  const compTok = tokenOf(companion);
  const compId = companion.json?.session?.user?.id || "";
  const offers = await post("/api/companion", { action: "my_offers" }, compTok);
  const catalog = offers.json?.catalog?.services || [];
  if (catalog[0]) {
    const saveOffers = await post("/api/companion", {
      action: "save_offers",
      offers: [{ kind: "service", id: catalog[0].id, enabled: true, sort: 0 }],
    }, compTok);
    const pubOffers = await get(`/api/companion-offers?userId=${encodeURIComponent(compId)}`);
    const visible = (pubOffers.json?.offers || []).some((item) => item.id === catalog[0].id && item.enabled !== false);
    record("C-offers", saveOffers.json?.ok === true && visible, `save=${saveOffers.status} ${saveOffers.json?.message || ""} public=${pubOffers.status} visible=${visible}`);
  } else {
    record("C-offers", false, offers.json?.message || "no catalog");
  }

  const low = await post("/api/companion", { action: "request_withdrawal", amount: 0.5, remark: "fee-guard" }, compTok);
  record("G-server-rejects-low", low.status === 400 && /0\.80/.test(String(low.json?.message || "")), `${low.status} ${low.json?.message || ""}`);

  const boot = await get("/api/companion?action=bootstrap", compTok);
  const rules = boot.json?.data?.withdrawalRules || boot.json?.withdrawalRules || {};
  record("P6-fee-shown", Number(rules.feeRm) === 0.8 && Number(rules.feePercent) === 0, JSON.stringify({ feeRm: rules.feeRm, feePercent: rules.feePercent }));

  const dup = await post("/api/companion", { action: "request_withdrawal", amount: 0.5, orderId: "00000000-0000-4000-8000-000000000000" }, compTok);
  record("H-unknown-order", dup.status === 400, `${dup.status} ${dup.json?.message || ""}`);

  const boss = await post("/api/auth", { action: "login", email: "boss@meow.test", password: PASS, loginPortal: "boss" });
  const bossTok = tokenOf(boss);
  const answers = (activeFields || []).filter((field) => field.required !== false).map((field) => ({
    fieldId: field.id,
    value: field.kind === "select" ? (field.options && field.options[0]) || "国服" : "SNAP-1",
  }));
  const placed = await post("/api/orders", {
    action: "place_order",
    companionId: compId,
    serviceId: activeService?.id || catalog[0]?.id || "",
    service: activeService?.name || catalog[0]?.name || "默认服务",
    game: activeService?.name || catalog[0]?.name || "默认服务",
    hours: 1,
    quantity: 1,
    gameId: "SNAP-1",
    orderRequirements: answers,
    paymentMethod: "catfood",
    idempotencyKey: `batch-${Date.now()}`,
  }, bossTok);
  const orderId = placed.json?.order?.id || "";
  const snapshot = placed.json?.order?.serviceSnapshot?.requirements || [];
  record(
    "A-order-snapshot",
    !!placed.json?.ok && Array.isArray(snapshot),
    `${placed.status} ${placed.json?.message || ""} snap=${JSON.stringify(snapshot).slice(0, 240)}`
  );
  if (orderId && activeService?.id) {
    await post("/api/admin/services", {
      action: "save_order_fields",
      id: activeService.id,
      orderFields: [{ name: "全新字段", kind: "text", required: false, enabled: true }],
    }, adminTok);
    const reread = await get(`/api/orders?id=${encodeURIComponent(orderId)}`, bossTok);
    const againSnap = reread.json?.order?.serviceSnapshot?.requirements || reread.json?.orders?.[0]?.serviceSnapshot?.requirements || snapshot;
    record("B-old-order-unchanged", JSON.stringify(againSnap) === JSON.stringify(snapshot), `reread=${reread.status}`);
    await post("/api/orders", { action: "cancel_order", id: orderId, reason: "batch regression cleanup" }, bossTok);
    await post("/api/admin/services", { action: "save_order_fields", id: activeService.id, orderFields: activeService.originalFields || [] }, adminTok);
  }
  const notices = await get("/api/companion?action=bootstrap", compTok);
  const noticeList = notices.json?.data?.systemNotices || notices.json?.data?.notices || [];
  record("D-companion-inbox", Array.isArray(noticeList), `count=${Array.isArray(noticeList) ? noticeList.length : "n/a"}`);

  writeFileSync("artifacts/batch-p1-p10/staging-report.json", JSON.stringify({ base: BASE, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
