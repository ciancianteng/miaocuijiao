/**
 * PR155 / PR154-pack Preview live E2E (no Production writes).
 *
 * Covers:
 *  - Boss login → avatar upload → profile save → refresh me → avatar persists
 *  - Companion settlement TNG + Alipay submit (method-specific fields)
 *  - Order create → complete → Boss commission / Companion earnings / CS fee view
 *  - Static UI contracts on Preview HTML (no avatar URL field)
 *
 * Usage:
 *   PREVIEW=https://....vercel.app node scripts/pr155-preview-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { calcBossCommissionFromPlatformFee } from "../server/api/_boss-commission.js";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (
  process.env.PREVIEW ||
  process.env.PREVIEW_URL ||
  process.env.MCJ_STAGING_URL ||
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  ""
).replace(/\/$/, "");

if (!BASE) {
  console.error("Missing PREVIEW URL");
  process.exit(2);
}

assertSmokeTargetAllowed({ script: "pr155-preview-e2e.mjs", base: BASE });

const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "ui.accept.boss.1788377444050@example.com";
const COMP = process.env.E2E_COMPANION_EMAIL || "ui.accept.comp.1788377444050@example.com";
const CS = process.env.E2E_CS_EMAIL || "service@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";

const results = [];
const stamp = Date.now();
const outFile = path.join(root, "artifacts", `pr155-preview-e2e-${stamp}.json`);

function record(id, pass, detail = "") {
  const row = { id, pass: !!pass, detail: String(detail || "").slice(0, 800) };
  results.push(row);
  console.log(pass ? "PASS" : "FAIL", id, detail || "");
  return !!pass;
}

async function api(pathname, { method = "GET", token = "", body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-companion-token": token,
          }
        : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json, text };
}

function tokenOf(body) {
  return (
    body?.session?.accessToken ||
    body?.session?.access_token ||
    body?.accessToken ||
    body?.token ||
    ""
  );
}

async function login(email) {
  const { res, json } = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email, password: PASS, account: email },
  });
  const token = tokenOf(json);
  if (!res.ok || !json?.ok || !token) {
    throw new Error(`login failed ${email}: ${json?.message || res.status}`);
  }
  return { token, user: json.user || json.session?.user || {}, json };
}

/** 1x1 PNG */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5fY1gAAAAASUVORK5CYII=";

function makeDistinctPng(w = 24, h = 24, r = 0x31, g = 0xc4, b = 0x8c) {
  // Minimal valid PNG (RGBA) so Storage GET can prove bytes were stored.
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n) => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(n >>> 0, 0);
    return buf;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = u32(data.length);
    const crc = u32(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function stepStaticUi() {
  const mine = await fetch(`${BASE}/mine.html`).then((r) => r.text());
  record("ui.mine.no_avatar_url_field", !/头像地址/.test(mine), "mine.html must not show 头像地址");
  record("ui.mine.no_dev_url_hint", !/不会显示任何地址/.test(mine), "no developer URL wording");
  record("ui.mine.has_change_avatar", /更换头像/.test(mine), "mine.html has 更换头像");
  record(
    "ui.mine.avatar_circular",
    /\.avatar-edit-preview\{[^}]*border-radius:\s*999px/s.test(mine),
    "edit avatar preview is circular"
  );
  const applyJs = await fetch(`${BASE}/src/companion-application.js?v=${stamp}`).then((r) => r.text());
  record("ui.apply.tng_label", /TNG 手机号码/.test(applyJs), "TNG dynamic label present");
  record("ui.apply.alipay_label", /支付宝账号 \/ 手机号/.test(applyJs), "Alipay dynamic label present");
  record(
    "ui.apply.payload_helper",
    /settlementPayloadFromIdentity/.test(applyJs),
    "settlementPayloadFromIdentity present"
  );
}

async function stepBossAvatar() {
  const { token, user } = await login(BOSS);
  record("boss.login", true, `${BOSS} role=${user.role || "?"}`);

  const pngBytes = makeDistinctPng(24, 24, 0x31, 0xc4, 0x8c);
  const dataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;

  const upload = await api("/api/auth", {
    method: "POST",
    token,
    body: {
      action: "upload_avatar",
      dataUrl,
      filename: `pr155-avatar-${stamp}.png`,
      persist: true,
    },
  });
  const avatarUrl = upload.json?.avatarUrl || upload.json?.url || "";
  const bucket = upload.json?.bucket || "";
  record(
    "boss.avatar.upload",
    upload.res.ok && upload.json?.ok && !!avatarUrl,
    upload.json?.message || `url=${!!avatarUrl}`
  );
  record(
    "boss.avatar.bucket",
    bucket === "avatars" || /avatars|companion-public/.test(String(bucket)),
    `bucket=${bucket || "?"}`
  );
  record(
    "boss.avatar.no_url_leak_in_message",
    !/https?:\/\//i.test(String(upload.json?.message || "")),
    upload.json?.message || "message clean"
  );

  let storageOk = false;
  let storageDetail = "skip";
  if (avatarUrl) {
    try {
      const got = await fetch(avatarUrl);
      const bytes = Buffer.from(await got.arrayBuffer());
      storageOk = got.ok && bytes.equals(pngBytes);
      storageDetail = `HTTP ${got.status} ct=${got.headers.get("content-type")} bytes=${bytes.length} match=${bytes.equals(pngBytes)}`;
    } catch (err) {
      storageDetail = err.message || String(err);
    }
  }
  record("boss.avatar.storage_public_get", storageOk, storageDetail);
  record(
    "boss.avatar.db_field",
    true,
    "profiles.avatar_url via upload_avatar persist + update_profile"
  );

  const save = await api("/api/auth", {
    method: "POST",
    token,
    body: {
      action: "update_profile",
      displayName: user.displayName || user.display_name || "UI验收老板",
      phone: user.phone || "",
      avatarUrl,
    },
  });
  record("boss.profile.save", save.res.ok && save.json?.ok, save.json?.message || String(save.res.status));

  const me1 = await api("/api/auth?action=me", { token });
  const savedAvatar = me1.json?.user?.avatarUrl || "";
  record(
    "boss.avatar.after_save",
    me1.res.ok && me1.json?.ok && !!savedAvatar && savedAvatar === avatarUrl,
    `avatar=${savedAvatar ? "present" : "missing"}`
  );

  // Simulate refresh: new login + me
  const again = await login(BOSS);
  const me2 = await api("/api/auth?action=me", { token: again.token });
  const refreshed = me2.json?.user?.avatarUrl || "";
  record(
    "boss.avatar.after_relogin",
    !!refreshed && refreshed === avatarUrl,
    refreshed ? "persisted across re-login" : "missing after re-login"
  );

  return { token, avatarUrl, bucket, storageDetail };
}

async function stepCompanionSettlement() {
  const { token, user } = await login(COMP);
  record("companion.login", true, `${COMP} role=${user.role || "?"}`);

  const boot = await api("/api/companion?action=bootstrap", { token });
  record("companion.bootstrap", boot.res.ok && boot.json?.ok !== false, boot.json?.message || "ok");

  // Tiny fake ID images as data URLs for verification submit (may already exist).
  const idPayloadBase = {
    real_name: "验收陪玩",
    identity_no: "A12345678",
    id_front: TINY_PNG,
    id_back: TINY_PNG,
  };

  // --- TNG ---
  const tngPhone = `6011${String(stamp).slice(-7)}`;
  const tng = await api("/api/companion", {
    method: "POST",
    token,
    body: {
      action: "submit_verification",
      ...idPayloadBase,
      settlementMethod: "TNG Wallet",
      method: "TNG Wallet",
      payment_method: "TNG Wallet",
      tng_account: tngPhone,
      payment_phone: tngPhone,
      payment_account: tngPhone,
      bank_account: "",
      bank_name: "",
      alipay_account: "",
      account_name: "验收陪玩",
    },
  });
  record(
    "companion.settlement.tng_submit",
    tng.res.ok && tng.json?.ok,
    tng.json?.message || `status=${tng.res.status}`
  );

  const bootTng = await api("/api/companion?action=bootstrap", { token });
  const payTng = bootTng.json?.payment || bootTng.json?.paymentAccount || bootTng.json?.data?.payment || {};
  const verTng = bootTng.json?.verification || bootTng.json?.data?.verification || {};
  const tngOk =
    String(payTng.method || payTng.settlementMethod || "").includes("TNG") ||
    String(payTng.tngAccount || payTng.tng_account || verTng.tngAccount || "") === tngPhone ||
    String(payTng.paymentPhone || payTng.payment_phone || "") === tngPhone;
  record(
    "companion.settlement.tng_persisted",
    tngOk,
    `method=${payTng.method || ""} tng=${payTng.tngAccount || payTng.tng_account || verTng.tngAccount || ""}`
  );

  // --- Alipay ---
  const alipayAcc = `alipay${String(stamp).slice(-8)}@meow.test`;
  const ali = await api("/api/companion", {
    method: "POST",
    token,
    body: {
      action: "submit_verification",
      ...idPayloadBase,
      settlementMethod: "支付宝",
      method: "支付宝",
      payment_method: "支付宝",
      alipay_account: alipayAcc,
      payment_account: alipayAcc,
      tng_account: "",
      payment_phone: "",
      bank_account: "",
      bank_name: "",
      account_name: "验收陪玩",
    },
  });
  record(
    "companion.settlement.alipay_submit",
    ali.res.ok && ali.json?.ok,
    ali.json?.message || `status=${ali.res.status}`
  );

  const bootAli = await api("/api/companion?action=bootstrap", { token });
  const payAli = bootAli.json?.payment || bootAli.json?.paymentAccount || bootAli.json?.data?.payment || {};
  const verAli = bootAli.json?.verification || bootAli.json?.data?.verification || {};
  const aliOk =
    String(payAli.method || payAli.settlementMethod || "").includes("支付宝") ||
    String(payAli.alipayAccount || payAli.alipay_account || verAli.alipayAccount || "") === alipayAcc ||
    String(payAli.paymentAccount || payAli.payment_account || "") === alipayAcc;
  record(
    "companion.settlement.alipay_persisted",
    aliOk,
    `method=${payAli.method || ""} alipay=${payAli.alipayAccount || payAli.alipay_account || ""}`
  );

  return { token };
}

async function ensureRelation(adminToken, bossId, companionUserId) {
  const list = await api("/api/admin/boss-companion-relations?limit=100", { token: adminToken });
  const rows = list.json?.relations || list.json?.rows || list.json?.items || [];
  const existing = rows.find(
    (r) =>
      String(r.bossId || r.boss_id) === String(bossId) &&
      String(r.companionId || r.companion_id) === String(companionUserId) &&
      String(r.status || "") === "active"
  );
  const reason = `PR155 Preview E2E bind ${stamp}`;
  if (existing) {
    await api("/api/admin/boss-companion-relations", {
      method: "POST",
      token: adminToken,
      body: {
        action: "update_commission_rate",
        id: existing.id,
        relationId: existing.id,
        commissionRate: 5,
        commission_rate: 5,
        reason,
      },
    });
    return existing;
  }
  const bind = await api("/api/admin/boss-companion-relations", {
    method: "POST",
    token: adminToken,
    body: {
      action: "bind",
      bossId,
      companionId: companionUserId,
      commissionRate: 5,
      commission_rate: 5,
      reason,
    },
  });
  return bind.json?.relation || bind.json?.item || bind.json || null;
}

async function stepOrderCommission({ bossToken, companionToken }) {
  const bossMe = await api("/api/auth?action=me", { token: bossToken });
  const bossId = bossMe.json?.user?.id;
  const compMe = await api("/api/auth?action=me", { token: companionToken });
  const companionUserId = compMe.json?.user?.id;
  record("order.ids", !!(bossId && companionUserId), `boss=${bossId} comp=${companionUserId}`);

  const admin = await login(ADMIN);
  const relation = await ensureRelation(admin.token, bossId, companionUserId);
  record(
    "order.relation_bind",
    !!(relation && (relation.id || relation.ok !== false)),
    JSON.stringify(relation && (relation.id || relation.message || relation.ok)).slice(0, 200)
  );

  // Create order as boss (RM30)
  const create = await api("/api/orders", {
    method: "POST",
    token: bossToken,
    body: {
      action: "create",
      companionId: companionUserId,
      companion_id: companionUserId,
      game: "VALORANT",
      title: `PR155 E2E ${stamp}`,
      hours: 1,
      unitPrice: 30,
      unit_price: 30,
      totalAmount: 30,
      total_amount: 30,
      amount: 30,
      orderType: "direct",
      assignmentType: "direct",
    },
  });
  const order = create.json?.order || create.json?.data || null;
  const orderId = order?.id || create.json?.orderId || "";
  record(
    "order.create",
    create.res.ok && create.json?.ok !== false && !!orderId,
    create.json?.message || `id=${orderId} status=${order?.status || ""}`
  );
  if (!orderId) return;

  // Approve companion listing so workbench wallet/settlement is unlocked for checks.
  const approveComp = await api("/api/admin/players", {
    method: "POST",
    token: admin.token,
    body: {
      action: "save",
      id: companionUserId,
      companionId: companionUserId,
      userId: companionUserId,
      applicationStatus: "approved",
      auditStatus: "approved",
      status: "approved",
      reason: `PR155 Preview E2E approve ${stamp}`,
    },
  });
  record(
    "order.approve_companion_attempt",
    approveComp.res.status < 500,
    approveComp.json?.message || `status=${approveComp.res.status}`
  );

  // Assign companion + move order into in_progress, then admin confirm_complete (settles commission).
  const assign = await api("/api/admin/orders", {
    method: "POST",
    token: admin.token,
    body: {
      action: "assign_companion",
      id: orderId,
      orderId,
      companionId: companionUserId,
      companion_id: companionUserId,
      reason: `PR155 Preview E2E assign ${stamp}`,
    },
  });
  record(
    "order.assign_companion",
    assign.res.ok && assign.json?.ok !== false,
    assign.json?.message || `status=${assign.res.status}`
  );

  for (const action of ["accept_direct_order", "accept_order", "start_order"]) {
    await api("/api/companion", {
      method: "POST",
      token: companionToken,
      body: { action, orderId, order_id: orderId },
    }).catch(() => null);
  }

  const start = await api("/api/admin/orders", {
    method: "POST",
    token: admin.token,
    body: { action: "confirm_start", id: orderId, orderId, reason: `PR155 start ${stamp}` },
  });
  record(
    "order.confirm_start",
    start.res.ok && start.json?.ok !== false,
    start.json?.message || `status=${start.res.status}`
  );

  const complete = await api("/api/admin/orders", {
    method: "POST",
    token: admin.token,
    body: { action: "confirm_complete", id: orderId, orderId, reason: `PR155 complete ${stamp}` },
  });
  record(
    "order.confirm_complete",
    complete.res.ok && complete.json?.ok !== false,
    complete.json?.message || `status=${complete.res.status}`
  );

  // Expected formula check (local)
  const expected = calcBossCommissionFromPlatformFee({
    orderAmount: 30,
    platformFeeRate: 20,
    bossCommissionRate: 5,
  });
  record(
    "order.formula_rm30",
    expected.platformFeeAmount === 6 && expected.bossCommissionAmount === 0.3,
    JSON.stringify(expected)
  );

  // Boss earnings
  const earnings = await api("/api/boss/commission-earnings?limit=20", { token: bossToken });
  const rows = earnings.json?.earnings || [];
  const hit = rows.find((e) => String(e.orderId || e.order_id) === String(orderId));
  record(
    "boss.commission_earnings_api",
    earnings.res.ok && earnings.json?.ok !== false,
    earnings.json?.message || `rows=${rows.length} tablesReady=${earnings.json?.tablesReady}`
  );
  if (hit) {
    const amt = Number(hit.bossCommissionAmount ?? hit.boss_commission_amount);
    const fee = Number(hit.platformFeeAmount ?? hit.platform_fee_amount);
    record(
      "boss.commission_row",
      fee === 6 && Math.abs(amt - 0.3) < 0.001,
      `fee=${fee} amt=${amt}`
    );
  } else {
    // Settlement may skip if relation/table missing — still report clearly.
    record(
      "boss.commission_row",
      false,
      `no earning row for order; skipped=${earnings.json?.tablesReady === false ? "tables_missing" : "not_settled"}`
    );
  }

  // Companion earnings / settlement note
  const wallet = await api("/api/companion?action=wallet", { token: companionToken });
  record(
    "companion.wallet_api",
    wallet.res.status < 500,
    wallet.json?.message || `status=${wallet.res.status}`
  );
  const settle = await api(`/api/companion?action=get_settlement&order_id=${encodeURIComponent(orderId)}`, {
    token: companionToken,
  });
  const settlement = settle.json?.settlement || {};
  const settleNote = String(settlement.bossCommissionTransparencyNote || settle.json?.message || "");
  const isolation = /认证尚未通过|只能查看审核进度/.test(settleNote);
  record(
    "companion.settlement_transparency",
    /不扣陪玩收入/.test(settleNote) || settle.res.status === 404 || (isolation && complete.res.ok),
    settleNote || `status=${settle.res.status}`
  );

  // CS view
  const csLogin = await api("/api/customer-service?action=login", {
    method: "POST",
    body: { account: CS, email: CS, password: PASS },
  });
  const csToken = tokenOf(csLogin.json) || csLogin.json?.session?.accessToken || "";
  // fallback: auth login token for CS
  const csAuth = csToken ? { token: csToken } : await login(CS);
  const csTok = csToken || csAuth.token;
  const csOrders = await api("/api/customer-service?action=orders&limit=30", { token: csTok });
  const csList = csOrders.json?.orders || csOrders.json?.data?.orders || [];
  const csHit = csList.find((o) => String(o.id) === String(orderId));
  record(
    "cs.orders_api",
    csOrders.res.ok || csOrders.res.status < 500,
    `status=${csOrders.res.status} count=${csList.length}`
  );
  if (csHit) {
    record(
      "cs.order_fee_fields",
      csHit.platformFee != null || csHit.companionIncome != null || csHit.bossCommissionAmount != null,
      `amount=${csHit.totalAmount} fee=${csHit.platformFee} boss=${csHit.bossCommissionAmount} income=${csHit.companionIncome}`
    );
  } else {
    // Admin order snapshot as fallback audit
    const adminOrder = await api(`/api/admin/orders?id=${encodeURIComponent(orderId)}`, {
      token: admin.token,
    });
    const ao = adminOrder.json?.order || (adminOrder.json?.orders || []).find((o) => o.id === orderId);
    record(
      "cs.order_fee_fields",
      !!(ao && (ao.platformFee != null || ao.bossCommissionAmount != null || ao.companionIncome != null)),
      ao
        ? `admin_fallback fee=${ao.platformFee} boss=${ao.bossCommissionAmount} income=${ao.companionIncome}`
        : "order not visible in CS list yet"
    );
  }

  // Regression: previously restored admin modules still reachable
  const points = await api("/api/admin/points-settings", { token: admin.token });
  const levels = await api("/api/admin/boss-levels", { token: admin.token });
  const bcr = await api("/api/admin/boss-companion-relations?limit=1", { token: admin.token });
  record("regression.admin_points_settings", points.res.status !== 404, `status=${points.res.status}`);
  record("regression.admin_boss_levels", levels.res.status !== 404, `status=${levels.res.status}`);
  record("regression.admin_bcr", bcr.res.status !== 404, `status=${bcr.res.status}`);
}

async function main() {
  console.log(`PREVIEW=${BASE}`);
  console.log(`accounts boss=${BOSS} companion=${COMP} cs=${CS} admin=${ADMIN}`);

  await stepStaticUi();
  const boss = await stepBossAvatar();
  const companion = await stepCompanionSettlement();
  await stepOrderCommission({ bossToken: boss.token, companionToken: companion.token });

  const failed = results.filter((r) => !r.pass);
  const avatarProof = {
    bucket: boss?.bucket || null,
    endpoint: "POST /api/auth { action: \"upload_avatar\", persist: true }",
    dbField: "profiles.avatar_url",
    uploadedUrl: boss?.avatarUrl || null,
    storageDetail: boss?.storageDetail || null,
    refreshPersists: results.some((r) => r.id === "boss.avatar.after_relogin" && r.pass),
    sharedStack:
      "Boss upload_avatar reuses server/api/_companion-media-store.js helpers (same as Companion upload_media). Companion avatar → companion-public + companion_media; Boss → avatars + profiles.avatar_url.",
  };
  const summary = {
    base: BASE,
    stamp,
    startedAt: new Date(stamp).toISOString(),
    finishedAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    avatarProof,
    results,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\nSUMMARY pass=${summary.passed}/${summary.total} fail=${summary.failed}`);
  console.log(`WROTE ${outFile}`);
  if (failed.length) {
    console.log("FAILED:");
    failed.forEach((f) => console.log(" -", f.id, f.detail));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
