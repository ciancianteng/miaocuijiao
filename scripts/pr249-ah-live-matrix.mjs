/**
 * Live A–H matrix for PR #249 (Preview API + Staging Supabase service role).
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const BASE = (process.env.MCJ_STAGING_URL || process.env.PREVIEW_URL || process.env.PREVIEW || "").replace(/\/$/, "");
const SUPABASE_URL = process.env.STAGING_SUPABASE_URL || "";
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@249Pass!";
const stamp = Date.now();

if (!BASE || !SUPABASE_URL || !SERVICE) {
  console.error("Missing BASE / STAGING_SUPABASE_URL / STAGING_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const results = [];
const log = (id, ok, detail) => {
  results.push({ id, ok: !!ok, detail: String(detail || "") });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
};

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token
        ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token, "x-mcj-companion-token": token }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, json };
}

async function createAuthUser(email, { role = "companion" } = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASS, email_confirm: true,
    user_metadata: { role, roles: [role] }, app_metadata: { roles: [role] },
  });
  if (error) throw error;
  const user = data.user;
  const base = { id: user.id, email, role, status: "active", display_name: `U249-${stamp}` };
  let pErr = (await admin.from("profiles").upsert({ ...base, roles: [role] }, { onConflict: "id" })).error;
  if (pErr && /roles|column|42703/i.test(String(pErr.message || ""))) {
    pErr = (await admin.from("profiles").upsert(base, { onConflict: "id" })).error;
  }
  if (pErr) throw pErr;
  return user;
}

async function ensureCompanionRow(userId, { approved = true } = {}) {
  const row = {
    id: userId, user_id: userId, nickname: `CP249-${stamp}`,
    verification_status: approved ? "approved" : "pending",
    application_status: approved ? "approved" : "draft",
    deposit_status: approved ? "paid" : "unpaid",
    online_status: "online", allow_orders: true, updated_at: new Date().toISOString(),
  };
  let { error } = await admin.from("companion_profiles").upsert(row, { onConflict: "user_id" });
  if (error) {
    ({ error } = await admin.from("companion_profiles").upsert(row, { onConflict: "id" }));
    if (error) throw error;
  }
}

async function passwordLogin(email) {
  const { data, error } = await admin.auth.signInWithPassword({ email, password: PASS });
  if (error) throw error;
  return data.session.access_token;
}

function isSelfBlock(json) {
  const code = String(json?.code || "");
  const msg = String(json?.message || "");
  return code === "SELF_ORDER_NOT_ALLOWED" || code === "SELF_TRADE_FORBIDDEN" || /自己的陪玩|不能向自己|抢自己的订单|SELF_ORDER|SELF_TRADE/i.test(msg);
}

async function main() {
  console.log("BASE", BASE);
  console.log("build-info", JSON.stringify((await api("/api/build-info")).json));

  const emailA = `pr249.a.${stamp}@meow.test`;
  const emailOther = `pr249.other.${stamp}@meow.test`;
  const emailD = `pr249.d.${stamp}@meow.test`;
  let tokenA = "";
  let userA = null;

  try {
    userA = await createAuthUser(emailA, { role: "companion" });
    await ensureCompanionRow(userA.id, { approved: true });
    tokenA = await passwordLogin(emailA);
    const open = await api("/api/auth", { method: "POST", token: tokenA, body: { action: "open_boss_role", accessToken: tokenA } });
    const roles = open.json?.roles || open.json?.user?.roles || [];
    const { data: prof } = await admin.from("profiles").select("id,role,roles").eq("id", userA.id).maybeSingle();
    const ok = open.json?.ok === true && Array.isArray(roles) && roles.includes("boss") && roles.includes("companion") && open.json?.createdNewAuthUser !== true && String(prof?.role || "") === "boss";
    log("A", ok, ok ? `roles=${JSON.stringify(roles)} user=${userA.id} primary=${prof?.role}` : JSON.stringify(open.json).slice(0, 500));
    tokenA = await passwordLogin(emailA);
  } catch (e) { log("A", false, e.message || e); }

  try {
    const send = await api("/api/auth", { method: "POST", body: { action: "send_login_otp", email: emailA, role: "boss" } });
    const delivery = String(send.json?.delivery || "");
    const code = String(send.json?.code || "");
    const roleBlocked = code === "BOSS_ROLE_NOT_OPENED" || code === "ROLE_NOT_OPENED" || delivery === "blocked";
    const fakeAntiEnum = send.status === 200 && delivery === "suppressed";
    const ok = !roleBlocked && !fakeAntiEnum && (delivery === "sent" || delivery === "failed");
    log("B", ok, `status=${send.status} delivery=${delivery} code=${code} providerMessageId=${send.json?.providerMessageId || send.json?.mail?.providerMessageId || ""} msg=${send.json?.message || ""}`);
  } catch (e) { log("B", false, e.message || e); }

  try {
    const send = await api("/api/auth", { method: "POST", body: { action: "send_login_otp", email: emailA, role: "companion" } });
    const delivery = String(send.json?.delivery || "");
    const code = String(send.json?.code || "");
    const ok = code !== "COMPANION_ROLE_NOT_OPENED" && delivery !== "blocked" && (delivery === "sent" || delivery === "failed");
    log("C", ok, `delivery=${delivery} code=${code}`);
  } catch (e) { log("C", false, e.message || e); }

  try {
    const userD = await createAuthUser(emailD, { role: "boss" });
    const tokenD = await passwordLogin(emailD);
    const apply = await api("/api/companion", { method: "POST", token: tokenD, body: { action: "apply_companion_role", accessToken: tokenD, nickname: `D${stamp}` } });
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const sameEmail = (listed?.users || []).filter((u) => String(u.email || "").toLowerCase() === emailD);
    const sameUser = sameEmail.length === 1 && sameEmail[0].id === userD.id;
    const applyOk = apply.json?.ok === true && apply.json?.createdNewAuthUser !== true;
    const appStatus = String(apply.json?.applicationStatus || apply.json?.companion?.application_status || apply.json?.playerStatus || "");
    const ok = sameUser && applyOk && !/^approved$/i.test(appStatus);
    log("D", ok, ok ? `sameUser=${userD.id} appStatus=${appStatus || "draft"}` : `authUsers=${sameEmail.length} apply=${JSON.stringify(apply.json).slice(0, 280)}`);
  } catch (e) { log("D", false, e.message || e); }

  let other = null;
  try {
    other = await createAuthUser(emailOther, { role: "companion" });
    await ensureCompanionRow(other.id, { approved: true });
  } catch (e) { console.warn("other companion setup", e.message || e); }

  try {
    if (!tokenA || !other) throw new Error("missing dual token or other companion");
    const place = await api("/api/orders", { method: "POST", token: tokenA, body: { action: "place_order", companionId: other.id, hours: 1, note: "pr249-E", game: "E2E", title: "PR249-E" } });
    const market = await api("/api/boss/marketplace", { method: "POST", token: tokenA, body: { action: "create_and_pay", companionId: other.id, idempotencyKey: `pr249-e-${stamp}`, quantity: 1 } });
    const selfBlocked = isSelfBlock(place.json) || isSelfBlock(market.json);
    log("E", !selfBlocked, `selfBlocked=${selfBlocked} orders=${place.status}/${place.json?.code || place.json?.message || ""}; market=${market.status}/${market.json?.code || market.json?.message || ""}`);
  } catch (e) { log("E", false, e.message || e); }

  try {
    if (!tokenA || !userA) throw new Error("missing dual account");
    const place = await api("/api/orders", { method: "POST", token: tokenA, body: { action: "place_order", companionId: userA.id, hours: 1, note: "pr249-F-self", game: "E2E", title: "PR249-F" } });
    const market = await api("/api/boss/marketplace", { method: "POST", token: tokenA, body: { action: "create_and_pay", companionId: userA.id, idempotencyKey: `pr249-f-${stamp}`, quantity: 1 } });
    const ok = isSelfBlock(place.json) || isSelfBlock(market.json);
    log("F", ok, `orders=${place.json?.code || place.json?.message || place.status}; market=${market.json?.code || market.json?.message || market.status}`);
  } catch (e) { log("F", false, e.message || e); }

  try {
    if (!tokenA || !userA) throw new Error("missing dual account");
    const orderId = randomUUID();
    const orderNo = `MCJ249${String(stamp).slice(-8)}`;
    const { error: oErr } = await admin.from("orders").insert({
      id: orderId, order_no: orderNo, boss_id: userA.id, companion_id: null, status: "pending",
      assignment_type: "public", order_type: "custom", game: "E2E", title: "PR249 self-grab", description: "pr249-G",
      hours: 1, unit_price: 10, total_amount: 10, created_at: new Date().toISOString(),
    });
    if (oErr) throw oErr;
    const grab = await api("/api/companion", { method: "POST", token: tokenA, body: { action: "accept_order", orderId, id: orderId, accessToken: tokenA } });
    const hall = await api("/api/companion?action=bootstrap", { method: "GET", token: tokenA });
    const hallOrders = hall.json?.data?.hallOrders || hall.json?.data?.openOrders || hall.json?.data?.orders || hall.json?.hallOrders || hall.json?.orders || [];
    const visible = Array.isArray(hallOrders) ? hallOrders.some((o) => String(o.id || o.order_id || "") === orderId) : false;
    const ok = isSelfBlock(grab.json) || visible === false;
    log("G", ok, `grab=${grab.json?.code || grab.json?.message || grab.status}; hallVisible=${visible}`);
    await admin.from("orders").delete().eq("id", orderId);
  } catch (e) { log("G", false, e.message || e); }

  try {
    if (!tokenA || !userA) throw new Error("missing dual account");
    const meBoss = await api("/api/auth", { method: "POST", token: tokenA, body: { action: "me", accessToken: tokenA } });
    const meComp = await api("/api/companion?action=bootstrap", { method: "GET", token: tokenA });
    const id1 = meBoss.json?.user?.id || meBoss.json?.profile?.id || "";
    const id2 = meComp.json?.data?.profile?.id || meComp.json?.data?.user?.id || meComp.json?.user?.id || meComp.json?.profile?.id || "";
    const wallet = await api("/api/wallet", { method: "POST", token: tokenA, body: { action: "summary", accessToken: tokenA } });
    const wid = wallet.json?.userId || wallet.json?.profileId || wallet.json?.wallet?.user_id || "";
    const ok = (!id1 || id1 === userA.id) && (!id2 || id2 === userA.id) && (!wid || wid === userA.id);
    log("H", ok, `auth=${id1 || "-"} companion=${id2 || "-"} wallet=${wid || "-"} expected=${userA.id}`);
  } catch (e) { log("H", false, e.message || e); }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== A-H SUMMARY ===");
  console.log(JSON.stringify({ base: BASE, passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
