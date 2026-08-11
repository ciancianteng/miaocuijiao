/**
 * Staging E2E: admin payment settings ↔ boss order pay ↔ boss recharge (single SoT).
 * TEST 1–7 from P0 支付渠道前后台未打通.
 *
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-payment-linkage-unify-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ART = path.join(ROOT, "artifacts", "payment-linkage-unify-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-store",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json, headers: res.headers };
}

function tokenOf(login) {
  return login.json?.session?.accessToken || login.json?.session?.token || login.json?.accessToken || login.json?.token || "";
}

async function adminGet(token) {
  return api("/api/admin/payment-settings", token, null, "GET", { "x-mcj-admin-role": "admin" });
}

async function toggle(token, id, enabled) {
  return api(
    "/api/admin/payment-settings",
    token,
    { action: "toggle_channel", channelId: id, enabled: !!enabled },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
}

async function saveChannel(token, channel) {
  return api(
    "/api/admin/payment-settings",
    token,
    { action: "save_channel", channel },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
}

async function bossPay(token) {
  return api("/api/recharge", token, null, "GET");
}

function codes(list) {
  return (list || []).map((m) => m.code).filter(Boolean);
}

function channelOf(adminJson, id) {
  return (adminJson.channels || []).find((c) => (c.channel_id || c.id) === id) || null;
}

function hasCode(list, id) {
  return codes(list).includes(id);
}

async function main() {
  let failed = 0;
  const snap = {};

  const adminLogin = await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: PASS });
  const bossLogin = await api("/api/auth", null, { action: "login", email: "boss@meow.test", password: PASS });
  const adminToken = tokenOf(adminLogin);
  const bossToken = tokenOf(bossLogin);
  if (!step("auth admin+boss", !!adminToken && !!bossToken, `admin=${!!adminToken} boss=${!!bossToken}`)) {
    failed += 1;
    finish(failed);
    return;
  }

  const before = await adminGet(adminToken);
  snap.before = {
    channelSource: before.json.channelSource,
    tablesReady: before.json.tablesReady,
    message: before.json.message,
    channels: (before.json.channels || []).map((c) => ({
      id: c.channel_id || c.id,
      enabled: c.enabled,
      forOrder: c.forOrder,
      forRecharge: c.forRecharge,
      bossOrderOpen: c.bossOrderOpen,
      bossRechargeOpen: c.bossRechargeOpen,
      qr: c.data?.manual?.qrUrl || c.data?.qrUrl || "",
    })),
  };

  const tng0 = channelOf(before.json, "tng");
  const dn0 = channelOf(before.json, "duitnow");
  if (!step("admin lists tng+duitnow", !!tng0 && !!dn0, `tng=${!!tng0} dn=${!!dn0}`)) failed += 1;

  // Snapshot restore helpers
  const restoreManual = async (id, enabled, forOrder, forRecharge) => {
    const cur = await adminGet(adminToken);
    const ch = channelOf(cur.json, id);
    if (!ch) return;
    await saveChannel(adminToken, {
      ...ch,
      enabled: !!enabled,
      visible: !!enabled,
      data: { ...(ch.data || {}), forOrder: forOrder !== false, forRecharge: forRecharge !== false },
    });
    if (!enabled) await toggle(adminToken, id, false);
    else await toggle(adminToken, id, true);
  };

  // Ensure TNG has payee material so enable can succeed.
  {
    const cur = await adminGet(adminToken);
    const tng = channelOf(cur.json, "tng");
    const data = { ...(tng?.data || {}) };
    const manual = { ...(data.manual || {}) };
    if (!manual.receiverName) manual.receiverName = "MEOW CUI JIAO ENTERPRISE";
    if (!manual.phone && !manual.qrUrl) {
      manual.phone = "60123456789";
      manual.qrUrl =
        manual.qrUrl ||
        "https://jqfaknpmcnqwqvatrwgo.supabase.co/storage/v1/object/public/platform-payment/qr/tng.png";
    }
    data.manual = manual;
    data.qrUrl = manual.qrUrl || data.qrUrl || "";
    data.forOrder = true;
    data.forRecharge = true;
    await saveChannel(adminToken, { ...tng, enabled: false, visible: false, data });
  }

  // ——— TEST 1: disable TNG → order hide ———
  const dis1 = await toggle(adminToken, "tng", false);
  const admin1 = await adminGet(adminToken);
  const boss1 = await bossPay(bossToken);
  const tng1 = channelOf(admin1.json, "tng");
  const t1 =
    dis1.ok &&
    tng1 &&
    tng1.enabled !== true &&
    !hasCode(boss1.json.orderPayMethods, "tng") &&
    tng1.bossOrderOpen !== true;
  if (!step("TEST1 disable TNG → order hide", t1, JSON.stringify({
    toggleOk: dis1.ok,
    adminEnabled: tng1?.enabled,
    bossOrder: codes(boss1.json.orderPayMethods),
    bossOrderOpen: tng1?.bossOrderOpen,
  }))) failed += 1;

  // ——— TEST 2: disable TNG → recharge hide ———
  const t2 =
    tng1 &&
    tng1.enabled !== true &&
    !hasCode(boss1.json.methods, "tng") &&
    tng1.bossRechargeOpen !== true;
  if (!step("TEST2 disable TNG → recharge hide", t2, JSON.stringify({
    adminEnabled: tng1?.enabled,
    bossMethods: codes(boss1.json.methods),
    bossRechargeOpen: tng1?.bossRechargeOpen,
  }))) failed += 1;

  // ——— TEST 3: enable TNG + forOrder only ———
  {
    const cur = await adminGet(adminToken);
    const tng = channelOf(cur.json, "tng");
    await saveChannel(adminToken, {
      ...tng,
      enabled: true,
      visible: true,
      data: { ...(tng.data || {}), forOrder: true, forRecharge: false },
    });
    await toggle(adminToken, "tng", true);
  }
  const admin3 = await adminGet(adminToken);
  const boss3 = await bossPay(bossToken);
  const tng3 = channelOf(admin3.json, "tng");
  const t3 =
    tng3?.enabled === true &&
    tng3?.forOrder !== false &&
    tng3?.forRecharge === false &&
    hasCode(boss3.json.orderPayMethods, "tng") &&
    !hasCode(boss3.json.methods, "tng");
  if (!step("TEST3 TNG order-only", t3, JSON.stringify({
    enabled: tng3?.enabled,
    forOrder: tng3?.forOrder,
    forRecharge: tng3?.forRecharge,
    order: codes(boss3.json.orderPayMethods),
    recharge: codes(boss3.json.methods),
    bossOrderOpen: tng3?.bossOrderOpen,
    bossRechargeOpen: tng3?.bossRechargeOpen,
  }))) failed += 1;

  // ——— TEST 4: enable TNG + forRecharge only ———
  {
    const cur = await adminGet(adminToken);
    const tng = channelOf(cur.json, "tng");
    await saveChannel(adminToken, {
      ...tng,
      enabled: true,
      visible: true,
      data: { ...(tng.data || {}), forOrder: false, forRecharge: true },
    });
    await toggle(adminToken, "tng", true);
  }
  const admin4 = await adminGet(adminToken);
  const boss4 = await bossPay(bossToken);
  const tng4 = channelOf(admin4.json, "tng");
  const t4 =
    tng4?.enabled === true &&
    tng4?.forOrder === false &&
    tng4?.forRecharge !== false &&
    !hasCode(boss4.json.orderPayMethods, "tng") &&
    hasCode(boss4.json.methods, "tng");
  if (!step("TEST4 TNG recharge-only", t4, JSON.stringify({
    enabled: tng4?.enabled,
    forOrder: tng4?.forOrder,
    forRecharge: tng4?.forRecharge,
    order: codes(boss4.json.orderPayMethods),
    recharge: codes(boss4.json.methods),
  }))) failed += 1;

  // ——— TEST 5: disable all manual channels ———
  for (const id of ["tng", "duitnow", "bank-transfer", "alipay"]) {
    await toggle(adminToken, id, false).catch(() => null);
  }
  const admin5 = await adminGet(adminToken);
  const boss5 = await bossPay(bossToken);
  const manualOpen = (boss5.json.methods || []).filter((m) => m.code !== "catfood");
  const orderManual = (boss5.json.orderPayMethods || []).filter((m) => m.code !== "catfood");
  const anyAdminManualOn = (admin5.json.channels || []).some(
    (c) => ["tng", "duitnow", "bank-transfer", "alipay"].includes(c.channel_id || c.id) && c.enabled === true
  );
  const t5 = !anyAdminManualOn && manualOpen.length === 0 && orderManual.length === 0;
  if (!step("TEST5 all manual off → front empty", t5, JSON.stringify({
    anyAdminManualOn,
    recharge: codes(boss5.json.methods),
    order: codes(boss5.json.orderPayMethods),
  }))) failed += 1;

  // ——— TEST 6: change DuitNow QR → boss payInfo updates ———
  const qrMarker = `e2e-qr-${Date.now()}`;
  const newQr = `https://jqfaknpmcnqwqvatrwgo.supabase.co/storage/v1/object/public/platform-payment/qr/duitnow.jpg?v=${qrMarker}`;
  {
    const cur = await adminGet(adminToken);
    const dn = channelOf(cur.json, "duitnow");
    const data = { ...(dn?.data || {}) };
    const prevManual = data.manual && typeof data.manual === "object" ? data.manual : {};
    const manual = {
      ...prevManual,
      qrUrl: newQr,
      receiverName: prevManual.receiverName || "MEOW CUI JIAO ENTERPRISE",
      duitnowId: prevManual.duitnowId || "E2E-DN",
    };
    data.manual = manual;
    data.qrUrl = newQr;
    data.forOrder = true;
    data.forRecharge = true;
    await saveChannel(adminToken, { ...dn, enabled: true, visible: true, data });
    await toggle(adminToken, "duitnow", true);
  }
  const admin6 = await adminGet(adminToken);
  const boss6 = await bossPay(bossToken);
  const dn6 = channelOf(admin6.json, "duitnow");
  const dnMethod = (boss6.json.methods || []).find((m) => m.code === "duitnow") || (boss6.json.orderPayMethods || []).find((m) => m.code === "duitnow");
  const frontQr = String(dnMethod?.payInfo?.qrUrl || "");
  const adminQr = String(dn6?.data?.manual?.qrUrl || dn6?.data?.qrUrl || "");
  const t6 =
    dn6?.enabled === true &&
    adminQr.includes(qrMarker) &&
    frontQr.includes(qrMarker) &&
    (hasCode(boss6.json.methods, "duitnow") || hasCode(boss6.json.orderPayMethods, "duitnow"));
  if (!step("TEST6 DuitNow QR live sync", t6, JSON.stringify({
    enabled: dn6?.enabled,
    adminQr: adminQr.slice(0, 120),
    frontQr: frontQr.slice(0, 120),
    marker: qrMarker,
  }))) failed += 1;

  // ——— TEST 7: refresh consistency ———
  const admin7a = await adminGet(adminToken);
  const boss7a = await bossPay(bossToken);
  await new Promise((r) => setTimeout(r, 800));
  const admin7b = await adminGet(adminToken);
  const boss7b = await bossPay(bossToken);
  const sig = (adminJson, bossJson) =>
    JSON.stringify({
      channels: (adminJson.channels || []).map((c) => ({
        id: c.channel_id || c.id,
        enabled: !!c.enabled,
        forOrder: c.forOrder !== false,
        forRecharge: c.forRecharge !== false,
      })),
      order: codes(bossJson.orderPayMethods).sort(),
      recharge: codes(bossJson.methods).sort(),
    });
  const t7 = sig(admin7a.json, boss7a.json) === sig(admin7b.json, boss7b.json);
  if (!step("TEST7 refresh consistency", t7, "admin+boss stable across refresh")) failed += 1;

  // Admin enabled must match boss open for each manual channel (no false-closed admin UI).
  const adminFinal = await adminGet(adminToken);
  const bossFinal = await bossPay(bossToken);
  let linkageOk = true;
  const linkageDetail = [];
  for (const id of ["tng", "duitnow", "bank-transfer"]) {
    const ch = channelOf(adminFinal.json, id);
    if (!ch) continue;
    const inOrder = hasCode(bossFinal.json.orderPayMethods, id);
    const inRecharge = hasCode(bossFinal.json.methods, id);
    if (ch.enabled !== true) {
      if (inOrder || inRecharge) {
        linkageOk = false;
        linkageDetail.push(`${id}: admin off but boss still shows`);
      }
    } else {
      // enabled but may lack scope/config — bossOrderOpen flags must agree with lists
      if (!!ch.bossOrderOpen !== inOrder) {
        linkageOk = false;
        linkageDetail.push(`${id}: bossOrderOpen=${ch.bossOrderOpen} orderHas=${inOrder}`);
      }
      if (!!ch.bossRechargeOpen !== inRecharge) {
        linkageOk = false;
        linkageDetail.push(`${id}: bossRechargeOpen=${ch.bossRechargeOpen} rechargeHas=${inRecharge}`);
      }
    }
  }
  if (!step("admin↔boss linkage parity", linkageOk, linkageDetail.join("; ") || "aligned")) failed += 1;

  // Restore: leave TNG/DuitNow disabled with both scopes true (safe default for staging).
  try {
    await restoreManual("tng", false, true, true);
    await restoreManual("duitnow", false, true, true);
    await restoreManual("bank-transfer", false, true, true);
  } catch (e) {
    console.warn("restore soft-fail", e?.message || e);
  }

  snap.after = {
    failed,
    results,
    channelSource: adminFinal.json.channelSource,
    tablesReady: adminFinal.json.tablesReady,
  };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ base: BASE, snap, results }, null, 2));
  finish(failed);
}

function finish(failed) {
  const line = failed ? `PAYMENT_LINKAGE_UNIFY_FAIL ${failed}` : "PAYMENT_LINKAGE_UNIFY_PASS";
  console.log(line);
  fs.writeFileSync(path.join(ART, "summary.txt"), line + "\n" + results.map((r) => `${r.result} ${r.step} :: ${r.detail}`).join("\n"));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
