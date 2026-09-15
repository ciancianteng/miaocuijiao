/**
 * Boss VIP = CS-confirmed net spend → auto highest matching enabled tier.
 * Independent from boss_levels (commission / 直属陪玩门槛).
 *
 * Spend SoT: payment_transactions.net_amount for paid rows with confirmed_by/at.
 * Test / unconfirmed / awaiting_payment do not count.
 * Real refunds reduce net_amount, then VIP is recast from net spend.
 */
import { indexProfilesForStats, isTestTouchedOrder } from "./_test-accounts.js";
import { isMissingRelation, money, nowIso, notifyBoss, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const LEVELS_TABLE = "boss_vip_levels";
const STATUS_TABLE = "boss_vip_status";
const HISTORY_TABLE = "boss_vip_history";
const TX_TABLE = "payment_transactions";
const NOT_INITIALIZED = "Boss VIP 功能尚未初始化";
const INELIGIBLE_ORDER_STATUSES = new Set(["awaiting_payment"]);
const TX_SELECT =
  "id,order_id,boss_id,gross_amount,refunded_amount,net_amount,payment_status,confirmed_by,confirmed_at";
const ORDER_SELECT =
  "id,boss_id,companion_id,customer_service_id,player_id,status,boss_name,companion_name,player_name,customer_service_name,service_name,total_amount";
const PROFILE_SELECT = "id,email,display_name,nickname,name,role,is_test_account,boss_uid";

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function netAmountFromTx(tx = {}) {
  if (!tx || typeof tx !== "object") return 0;
  if (tx.net_amount != null && tx.net_amount !== "") return Math.max(0, money(tx.net_amount));
  return Math.max(0, money(tx.gross_amount) - money(tx.refunded_amount));
}

export function isConfirmedPaidTx(tx = {}) {
  if (!tx || typeof tx !== "object") return false;
  if (String(tx.payment_status || "").toLowerCase() !== "paid") return false;
  if (!tx.confirmed_by && !tx.confirmed_at) return false;
  return true;
}

export function applyRefundToTx(tx = {}, refundAmount = 0) {
  const gross = Math.max(0, money(tx.gross_amount));
  const refunded = Math.min(gross, money(tx.refunded_amount) + money(refundAmount));
  return {
    ...tx,
    refunded_amount: refunded,
    net_amount: Math.max(0, gross - refunded),
  };
}

export function isVipEligibleSpend({ tx, order, testIds, byId } = {}) {
  if (!isConfirmedPaidTx(tx)) return false;
  if (!order) return false;
  const st = String(order.status || "").toLowerCase();
  if (INELIGIBLE_ORDER_STATUSES.has(st)) return false;
  if (order.is_test === true || order.is_test_order === true) return false;
  if (testIds && byId && isTestTouchedOrder(order, testIds, byId)) return false;
  return true;
}

export function sumEligibleSpend(items = []) {
  let confirmedSpend = 0;
  let eligibleOrderCount = 0;
  for (const item of items || []) {
    if (!isVipEligibleSpend(item)) continue;
    const amt = netAmountFromTx(item.tx);
    if (amt <= 0) continue;
    confirmedSpend += amt;
    eligibleOrderCount += 1;
  }
  return { confirmedSpend: money(confirmedSpend), eligibleOrderCount };
}

export function viewVipLevel(row = {}, extra = {}) {
  return {
    id: row.id || "",
    name: row.name || "",
    spendThreshold: money(row.spend_threshold ?? row.spendThreshold),
    benefits: row.benefits || "",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    isActive: row.is_active !== false && row.isActive !== false,
    bossCount: extra.bossCount != null ? Number(extra.bossCount) : 0,
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
  };
}

export function resolveVipLevel(confirmedSpend, levels = []) {
  const spend = money(confirmedSpend);
  const active = (levels || [])
    .map((row) => viewVipLevel(row))
    .filter((lv) => lv.isActive)
    .sort((a, b) => a.spendThreshold - b.spendThreshold || a.sortOrder - b.sortOrder);
  let current = active[0] || null;
  for (const lv of active) {
    if (spend >= lv.spendThreshold) current = lv;
  }
  const idx = current ? active.findIndex((lv) => lv.id === current.id) : -1;
  const next = idx >= 0 && idx < active.length - 1 ? active[idx + 1] : null;
  const remaining = next ? Math.max(0, money(next.spendThreshold - spend)) : 0;
  return { current, next, remaining, active };
}

export function isUpgrade(prevLevel, nextLevel) {
  const prevT = prevLevel ? money(prevLevel.spend_threshold ?? prevLevel.spendThreshold) : 0;
  const nextT = nextLevel ? money(nextLevel.spend_threshold ?? nextLevel.spendThreshold) : 0;
  return nextT > prevT;
}

export function formatCatFood(amount) {
  const n = money(amount);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "");
}

export function buildUpgradeNotice({ spend, newLevel } = {}) {
  const name = (newLevel && (newLevel.name || newLevel.currentName)) || "VIP";
  const benefits = String((newLevel && newLevel.benefits) || "").trim() || "以后台设置为准";
  return {
    title: "🎉 恭喜升级！",
    body:
      `您的累计有效消费已达到 ${formatCatFood(spend)} 猫粮，已自动升级为 ${name}。` +
      `当前可享福利：${benefits}`,
  };
}

export function viewBossVipSnapshot({ confirmedSpend, resolved, history = [] } = {}) {
  const current = resolved?.current || null;
  const next = resolved?.next || null;
  return {
    currentLevelName: current?.name || "普通会员",
    currentLevelId: current?.id || "",
    confirmedSpend: money(confirmedSpend),
    nextLevelName: next?.name || "",
    nextThreshold: next ? next.spendThreshold : null,
    remaining: next ? money(resolved.remaining) : 0,
    benefits: current?.benefits || "",
    isMaxLevel: !next,
    history: (history || []).slice(0, 20),
  };
}

async function restPage(table, queryBase) {
  const pageSize = 1000;
  const out = [];
  let offset = 0;
  const join = String(queryBase || "").includes("?") ? "&" : "?";
  for (;;) {
    const rows = await supabaseJson(
      restUrl(table, `${queryBase || ""}${join}limit=${pageSize}&offset=${offset}`),
      { headers: serviceHeaders() }
    );
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < pageSize) break;
    offset += pageSize;
    if (offset > 200000) break;
  }
  return out;
}

async function loadByIds(table, ids, select) {
  const map = new Map();
  const unique = [...new Set((ids || []).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const rows = await supabaseJson(
      restUrl(table, `?id=in.(${chunk.map(encodeURIComponent).join(",")})&select=${select}`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    for (const row of rows || []) {
      if (row?.id) map.set(row.id, row);
    }
  }
  return map;
}

export async function ensureBossVipReady() {
  try {
    await supabaseJson(restUrl(LEVELS_TABLE, "?select=id&limit=1"), { headers: serviceHeaders() });
    return { ok: true, message: "" };
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, message: NOT_INITIALIZED };
    throw error;
  }
}

export async function listVipLevelRows({ includeInactive = true } = {}) {
  const q = includeInactive
    ? "?select=*&order=sort_order.asc,spend_threshold.asc"
    : "?select=*&is_active=eq.true&order=sort_order.asc,spend_threshold.asc";
  const rows = await supabaseJson(restUrl(LEVELS_TABLE, q), { headers: serviceHeaders() });
  return Array.isArray(rows) ? rows : [];
}

export async function listVipLevelsForAdmin() {
  const ready = await ensureBossVipReady();
  if (!ready.ok) {
    return { ok: true, tablesReady: false, message: ready.message, levels: [] };
  }
  const levels = await listVipLevelRows({ includeInactive: true });
  const statuses = await restPage(STATUS_TABLE, "?select=boss_id,current_level_id").catch(() => []);
  const counts = new Map();
  for (const row of statuses || []) {
    const key = row.current_level_id || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return {
    ok: true,
    tablesReady: true,
    message: "",
    levels: levels.map((row) => viewVipLevel(row, { bossCount: counts.get(row.id) || 0 })),
  };
}

export async function upsertVipLevel(payload = {}) {
  const name = String(payload.name || "").trim();
  if (!name) throw httpError("请填写等级名称");
  const spendThreshold = money(payload.spendThreshold ?? payload.spend_threshold);
  if (spendThreshold < 0) throw httpError("消费门槛不能为负数");
  const benefits = String(payload.benefits ?? "");
  const sortRaw = Number(payload.sortOrder ?? payload.sort_order ?? 100);
  const sortOrder = Number.isFinite(sortRaw) ? sortRaw : 100;
  const isActive = payload.isActive !== false && payload.is_active !== false;
  const now = nowIso();
  const body = {
    name,
    spend_threshold: spendThreshold,
    benefits,
    sort_order: sortOrder,
    is_active: isActive,
    updated_at: now,
  };
  if (payload.id) {
    const rows = await supabaseJson(restUrl(LEVELS_TABLE, `?id=eq.${encodeURIComponent(payload.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(body),
    });
    if (!rows?.[0]) throw httpError("等级不存在", 404);
    return rows[0];
  }
  const rows = await supabaseJson(restUrl(LEVELS_TABLE), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ ...body, created_at: now }),
  });
  return rows?.[0] || body;
}

export async function setVipLevelActive(id, isActive) {
  const rows = await supabaseJson(restUrl(LEVELS_TABLE, `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ is_active: !!isActive, updated_at: nowIso() }),
  });
  if (!rows?.[0]) throw httpError("等级不存在", 404);
  return rows[0];
}

export async function reorderVipLevels(orderedIds = []) {
  const ids = (orderedIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const now = nowIso();
  for (let i = 0; i < ids.length; i += 1) {
    await supabaseJson(restUrl(LEVELS_TABLE, `?id=eq.${encodeURIComponent(ids[i])}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ sort_order: (i + 1) * 10, updated_at: now }),
    });
  }
  return listVipLevelRows({ includeInactive: true });
}

async function computeBossSpend(bossId) {
  const txs = await restPage(
    TX_TABLE,
    `?boss_id=eq.${encodeURIComponent(bossId)}&payment_status=eq.paid&select=${TX_SELECT}`
  );
  const orderIds = [...new Set(txs.map((tx) => tx.order_id).filter(Boolean))];
  const orders = await loadByIds("orders", orderIds, ORDER_SELECT);
  const profileIds = new Set([bossId]);
  for (const order of orders.values()) {
    [order.boss_id, order.companion_id, order.customer_service_id, order.player_id]
      .filter(Boolean)
      .forEach((id) => profileIds.add(id));
  }
  const profiles = [...(await loadByIds("profiles", [...profileIds], PROFILE_SELECT)).values()];
  const { byId, testIds } = indexProfilesForStats(profiles);
  const items = txs.map((tx) => ({
    tx,
    order: orders.get(tx.order_id) || null,
    testIds,
    byId,
  }));
  return { ...sumEligibleSpend(items), txCount: txs.length };
}

async function readStatus(bossId) {
  const rows = await supabaseJson(restUrl(STATUS_TABLE, `?boss_id=eq.${encodeURIComponent(bossId)}&limit=1`), {
    headers: serviceHeaders(),
  }).catch((error) => {
    if (isMissingRelation(error)) return [];
    throw error;
  });
  return rows?.[0] || null;
}

async function writeStatus(row) {
  const existing = await readStatus(row.boss_id);
  if (existing) {
    const patched = await supabaseJson(restUrl(STATUS_TABLE, `?boss_id=eq.${encodeURIComponent(row.boss_id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
    return patched?.[0] || row;
  }
  const inserted = await supabaseJson(restUrl(STATUS_TABLE), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(row),
  });
  return inserted?.[0] || row;
}

export async function recastBossVip(bossId, opts = {}) {
  const id = String(bossId || "").trim();
  if (!id) return null;
  const ready = await ensureBossVipReady();
  if (!ready.ok) return { skipped: true, reason: "not_initialized", message: ready.message };

  const levels = await listVipLevelRows({ includeInactive: true });
  const { confirmedSpend, eligibleOrderCount } = await computeBossSpend(id);
  const resolved = resolveVipLevel(confirmedSpend, levels);
  const prev = await readStatus(id);
  const prevLevel = prev?.current_level_id
    ? viewVipLevel(levels.find((row) => row.id === prev.current_level_id) || { id: prev.current_level_id })
    : null;
  const nextLevel = resolved.current;
  const now = nowIso();
  const levelChanged = String(prev?.current_level_id || "") !== String(nextLevel?.id || "");
  const spendChanged = money(prev?.confirmed_spend) !== confirmedSpend;
  const countChanged = Number(prev?.eligible_order_count || 0) !== eligibleOrderCount;
  if (!prev || levelChanged || spendChanged || countChanged) {
    await writeStatus({
      boss_id: id,
      current_level_id: nextLevel?.id || null,
      confirmed_spend: confirmedSpend,
      eligible_order_count: eligibleOrderCount,
      updated_at: now,
    });
  }
  const shouldRecordHistory = levelChanged || opts.reason === "refund";
  if (shouldRecordHistory) {
    await supabaseJson(restUrl(HISTORY_TABLE), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        boss_id: id,
        old_level_id: prev?.current_level_id || null,
        new_level_id: nextLevel?.id || null,
        old_level_name: prevLevel?.name || "",
        new_level_name: nextLevel?.name || "",
        confirmed_spend: confirmedSpend,
        trigger_order_id: opts.triggerOrderId || null,
        reason: opts.reason || "recast",
        created_at: now,
      }),
    }).catch((error) => {
      if (!isMissingRelation(error)) console.warn("[boss-vip] history", error?.message || error);
    });
  }

  const upgraded = isUpgrade(prevLevel, nextLevel);
  if (upgraded && opts.notify !== false && opts.reason !== "backfill") {
    const notice = buildUpgradeNotice({ spend: confirmedSpend, newLevel: nextLevel });
    await notifyBoss(id, notice.title, notice.body, "vip_upgrade", opts.triggerOrderId || nextLevel?.id || "");
  }

  return {
    bossId: id,
    confirmedSpend,
    eligibleOrderCount,
    current: nextLevel,
    next: resolved.next,
    remaining: resolved.remaining,
    upgraded,
    levelChanged,
    snapshot: viewBossVipSnapshot({ confirmedSpend, resolved }),
  };
}

export async function recastBossVipSafe(bossId, opts = {}) {
  try {
    return await recastBossVip(bossId, opts);
  } catch (error) {
    console.warn("[boss-vip] recast", error?.message || error);
    return null;
  }
}

export async function recastAllBosses(opts = {}) {
  const ready = await ensureBossVipReady();
  if (!ready.ok) return { ok: false, message: ready.message, count: 0 };
  const txs = await restPage(TX_TABLE, "?payment_status=eq.paid&select=boss_id");
  const statuses = await restPage(STATUS_TABLE, "?select=boss_id").catch(() => []);
  const ids = [
    ...new Set(
      [...txs, ...statuses]
        .map((row) => row.boss_id)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const results = [];
  for (const id of ids) {
    results.push(
      await recastBossVip(id, {
        notify: opts.notify === true,
        reason: opts.reason || "recast_all",
      })
    );
  }
  return { ok: true, count: ids.length, results };
}

export async function previewBossVipBackfill() {
  const ready = await ensureBossVipReady();
  if (!ready.ok) return { ok: false, tablesReady: false, message: ready.message, rows: [] };
  const levels = await listVipLevelRows({ includeInactive: true });
  const txs = await restPage(TX_TABLE, `?payment_status=eq.paid&select=${TX_SELECT}`);
  const orderIds = [...new Set(txs.map((tx) => tx.order_id).filter(Boolean))];
  const orders = await loadByIds("orders", orderIds, ORDER_SELECT);
  const profileIds = new Set();
  for (const tx of txs) if (tx.boss_id) profileIds.add(tx.boss_id);
  for (const order of orders.values()) {
    [order.boss_id, order.companion_id, order.customer_service_id, order.player_id]
      .filter(Boolean)
      .forEach((id) => profileIds.add(id));
  }
  const profiles = await loadByIds("profiles", [...profileIds], PROFILE_SELECT);
  const { byId, testIds } = indexProfilesForStats([...profiles.values()]);
  const grouped = new Map();
  for (const tx of txs) {
    const bossId = tx.boss_id;
    if (!bossId) continue;
    if (!grouped.has(bossId)) grouped.set(bossId, []);
    grouped.get(bossId).push({
      tx,
      order: orders.get(tx.order_id) || null,
      testIds,
      byId,
    });
  }
  const rows = [];
  for (const [bossId, items] of grouped.entries()) {
    const { confirmedSpend, eligibleOrderCount } = sumEligibleSpend(items);
    const resolved = resolveVipLevel(confirmedSpend, levels);
    const profile = profiles.get(bossId) || {};
    rows.push({
      bossId,
      bossUid: profile.boss_uid || "",
      displayName: profile.display_name || profile.nickname || "",
      eligibleOrderCount,
      confirmedSpend,
      vipName: resolved.current?.name || "普通会员",
      vipId: resolved.current?.id || "",
    });
  }
  rows.sort((a, b) => b.confirmedSpend - a.confirmedSpend);
  return {
    ok: true,
    tablesReady: true,
    message: "",
    count: rows.length,
    totalConfirmedSpend: money(rows.reduce((sum, row) => sum + money(row.confirmedSpend), 0)),
    rows,
  };
}

export async function applyBossVipBackfill({ notify = false } = {}) {
  return recastAllBosses({ notify: !!notify, reason: "backfill" });
}

export async function getBossVipView(bossId) {
  const ready = await ensureBossVipReady();
  if (!ready.ok) {
    return {
      ok: true,
      tablesReady: false,
      message: ready.message,
      vip: viewBossVipSnapshot({
        confirmedSpend: 0,
        resolved: { current: { name: "普通会员", benefits: "", spendThreshold: 0 }, next: null, remaining: 0 },
      }),
    };
  }
  const levels = await listVipLevelRows({ includeInactive: true });
  const spend = await computeBossSpend(bossId);
  const resolved = resolveVipLevel(spend.confirmedSpend, levels);
  const history = await supabaseJson(
    restUrl(HISTORY_TABLE, `?boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=20`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  return {
    ok: true,
    tablesReady: true,
    message: "",
    vip: {
      ...viewBossVipSnapshot({ confirmedSpend: spend.confirmedSpend, resolved }),
      history: (history || []).map((row) => ({
        oldLevelName: row.old_level_name || "",
        newLevelName: row.new_level_name || "",
        confirmedSpend: money(row.confirmed_spend),
        reason: row.reason || "",
        createdAt: row.created_at || "",
        triggerOrderId: row.trigger_order_id || "",
      })),
    },
  };
}
