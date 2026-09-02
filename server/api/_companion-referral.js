/**
 * Companion referral rebate (Companion invites Boss → rebate on Boss paid orders).
 * Separate from companion_income, boss_commission_earnings, Boss wallets/points.
 */
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const REL_TABLE = "referral_relations";
const RULE_TABLE = "referral_commission_rules";
const REC_TABLE = "referral_commission_records";
const WALLET_TABLE = "referral_wallets";

const DEFAULT_ORDER_REBATE_RATE = 5;
const DEFAULT_REBATE_SOURCE = "PLATFORM_PROFIT";

function nowIso() {
  return new Date().toISOString();
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}
export function isReferralMissing(error) {
  return isMissingRelation(error) || /referral_relations|referral_commission|referral_wallets|PGRST205/i.test(String(error?.message || ""));
}

export function viewReferralWallet(row = {}, userId = "") {
  return {
    userId: row.user_id || userId || "",
    pendingAmount: money(row.pending_amount),
    availableAmount: money(row.available_amount),
    frozenAmount: money(row.frozen_amount),
    totalEarned: money(row.total_earned),
    totalWithdrawn: money(row.total_withdrawn),
    updatedAt: row.updated_at || null,
  };
}

export function viewReferralRecord(row = {}) {
  return {
    id: row.id || "",
    orderId: row.order_id || "",
    relationId: row.relation_id || "",
    inviterUserId: row.inviter_user_id || "",
    invitedUserId: row.invited_user_id || "",
    commissionType: row.commission_type || "order_rebate",
    baseAmount: money(row.base_amount),
    rebateRate: money(row.rebate_rate),
    rebateAmount: money(row.rebate_amount),
    rebateSource: row.rebate_source || DEFAULT_REBATE_SOURCE,
    status: row.status || "",
    settledAt: row.settled_at || row.created_at || "",
    createdAt: row.created_at || "",
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
    type: "邀请返点",
    typeCode: "referral_rebate",
  };
}

export async function ensureReferralWallet(userId) {
  if (!userId) throw httpError("缺少 userId", 400);
  try {
    const rows = await supabaseJson(
      restUrl(WALLET_TABLE, `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    if (rows?.[0]) return rows[0];
  } catch (error) {
    if (isReferralMissing(error)) throw error;
  }
  try {
    const created = await supabaseJson(restUrl(WALLET_TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: userId,
        pending_amount: 0,
        available_amount: 0,
        frozen_amount: 0,
        total_earned: 0,
        total_withdrawn: 0,
        updated_at: nowIso(),
        created_at: nowIso(),
      }),
    });
    return Array.isArray(created) ? created[0] : created;
  } catch (error) {
    if (/duplicate|23505/i.test(String(error?.message || ""))) {
      const again = await supabaseJson(
        restUrl(WALLET_TABLE, `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
        { headers: serviceHeaders() }
      );
      return again?.[0] || null;
    }
    throw error;
  }
}

export async function getReferralWallet(userId) {
  if (!userId) return viewReferralWallet({}, "");
  try {
    const row = await ensureReferralWallet(userId);
    return viewReferralWallet(row || {}, userId);
  } catch (error) {
    if (isReferralMissing(error)) {
      return { ...viewReferralWallet({}, userId), tablesReady: false };
    }
    throw error;
  }
}

/**
 * Upsert active Companion→Boss referral when Companion invite is accepted.
 */
export async function upsertCompanionBossReferral({
  companionId,
  bossId,
  invitationId = null,
  remark = "",
  boundByAdmin = false,
} = {}) {
  if (!companionId || !bossId) throw httpError("缺少 companionId/bossId", 400);
  if (companionId === bossId) throw httpError("不能邀请自己", 400);

  // One active companion_invites_boss per Boss (invited).
  const existingForBoss = await supabaseJson(
    restUrl(
      REL_TABLE,
      `?invited_user_id=eq.${encodeURIComponent(bossId)}&relation_type=eq.companion_invites_boss&status=eq.active&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch((err) => {
    if (isReferralMissing(err)) throw err;
    return [];
  });

  const same = (existingForBoss || []).find(
    (r) => String(r.inviter_user_id) === String(companionId)
  );
  if (same) {
    await ensureReferralWallet(companionId).catch(() => null);
    return same;
  }

  for (const row of existingForBoss || []) {
    if (String(row.inviter_user_id) !== String(companionId)) {
      await supabaseJson(restUrl(REL_TABLE, `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          status: "revoked",
          bind_remark: `superseded_by:${companionId}`,
          updated_at: nowIso(),
        }),
      }).catch(() => null);
    }
  }

  const payload = {
    inviter_user_id: companionId,
    invited_user_id: bossId,
    inviter_role: "companion",
    invited_role: "boss",
    relation_type: "companion_invites_boss",
    status: "active",
    bound_by_admin: !!boundByAdmin,
    bind_remark: String(remark || "").trim() || null,
    invitation_id: invitationId || null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  try {
    const rows = await supabaseJson(restUrl(REL_TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    });
    await ensureReferralWallet(companionId).catch(() => null);
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (/duplicate|23505|uq_referral/i.test(String(error?.message || ""))) {
      const again = await supabaseJson(
        restUrl(
          REL_TABLE,
          `?inviter_user_id=eq.${encodeURIComponent(companionId)}&invited_user_id=eq.${encodeURIComponent(bossId)}&status=eq.active&limit=1`
        ),
        { headers: serviceHeaders() }
      );
      return again?.[0] || null;
    }
    throw error;
  }
}

async function loadActiveRule({ inviterUserId, invitedUserId } = {}) {
  // Prefer pair-specific rule, then global (null pair).
  const pair = await supabaseJson(
    restUrl(
      RULE_TABLE,
      `?status=eq.active&inviter_user_id=eq.${encodeURIComponent(inviterUserId)}&invited_user_id=eq.${encodeURIComponent(invitedUserId)}&order=effective_from.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (pair?.[0]) return pair[0];

  const globals = await supabaseJson(
    restUrl(
      RULE_TABLE,
      `?status=eq.active&inviter_user_id=is.null&invited_user_id=is.null&order=effective_from.desc&limit=5`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (globals?.[0]) return globals[0];

  // Fallback: any active global-ish rule without pair filter
  const any = await supabaseJson(
    restUrl(RULE_TABLE, `?status=eq.active&order=effective_from.desc&limit=20`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const g = (any || []).find((r) => !r.inviter_user_id && !r.invited_user_id);
  return g || null;
}

async function resolveRebateRate(rule) {
  let rate = money(rule?.order_rebate_rate);
  if (!(rate > 0)) {
    // platform_settings.defaultRebateRate if > 0
    try {
      const rows = await supabaseJson(restUrl("platform_settings", "?id=eq.global&limit=1"), {
        headers: serviceHeaders(),
      });
      const raw = rows?.[0]?.data || rows?.[0] || {};
      const fromSettings = money(raw.defaultRebateRate ?? raw.default_rebate_rate);
      if (fromSettings > 0) rate = fromSettings;
    } catch {
      /* ignore */
    }
  }
  if (!(rate > 0)) rate = DEFAULT_ORDER_REBATE_RATE;
  return Math.max(0, Math.min(100, rate));
}

function resolveBaseAmount(order, rebateSource, extras = {}) {
  const source = String(rebateSource || DEFAULT_REBATE_SOURCE).toUpperCase();
  const orderAmount = money(order.total_amount ?? order.amount ?? 0);
  const platformFee = money(
    extras.platformFeeAmount ?? order.platform_fee ?? order.platformFee ?? 0
  );
  if (source === "ORDER_AMOUNT") return { base: orderAmount, source };
  if (source === "COMPANION_INCOME") {
    return {
      base: money(extras.companionIncomeAmount ?? order.companion_income ?? 0),
      source,
    };
  }
  // PLATFORM_PROFIT — prefer explicit fee; else derive 20% fallback from order
  if (platformFee > 0) return { base: platformFee, source: "PLATFORM_PROFIT" };
  const derived = money((orderAmount * 20) / 100);
  return { base: derived, source: "PLATFORM_PROFIT" };
}

/**
 * Settle Companion referral rebate when invited Boss's paid order completes.
 * Idempotent on (order_id, inviter, order_rebate).
 */
export async function settleReferralRebateForOrder(order, extras = {}) {
  const bossId = String(order?.boss_id || "").trim();
  const orderId = String(order?.id || "").trim();
  if (!bossId || !orderId) {
    return { skipped: true, reason: "missing_boss_or_order" };
  }

  let relations = [];
  try {
    relations = await supabaseJson(
      restUrl(
        REL_TABLE,
        `?invited_user_id=eq.${encodeURIComponent(bossId)}&invited_role=eq.boss&status=eq.active&relation_type=eq.companion_invites_boss&limit=5`
      ),
      { headers: serviceHeaders() }
    );
  } catch (error) {
    if (isReferralMissing(error)) return { skipped: true, reason: "tables_missing" };
    throw error;
  }
  const relation = Array.isArray(relations) ? relations[0] : null;
  if (!relation?.inviter_user_id) {
    return { skipped: true, reason: "no_active_referral" };
  }

  const inviterId = relation.inviter_user_id;

  // Duplicate check
  const existing = await supabaseJson(
    restUrl(
      REC_TABLE,
      `?order_id=eq.${encodeURIComponent(orderId)}&inviter_user_id=eq.${encodeURIComponent(inviterId)}&commission_type=eq.order_rebate&status=in.(pending,settled)&limit=1`
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  if (existing?.[0]) {
    return { duplicate: true, record: viewReferralRecord(existing[0]), wallet: await getReferralWallet(inviterId) };
  }

  const rule = await loadActiveRule({ inviterUserId: inviterId, invitedUserId: bossId });
  const rebateSource = rule?.rebate_source || DEFAULT_REBATE_SOURCE;
  const rebateRate = await resolveRebateRate(rule);
  const { base, source } = resolveBaseAmount(order, rebateSource, extras);
  const rebateAmount = money((base * rebateRate) / 100);
  if (!(rebateAmount > 0)) {
    return { skipped: true, reason: "zero_rebate", base, rebateRate };
  }

  const settledAt = extras.completedAt || order.completed_at || nowIso();
  const meta = {
    formula: "rebate = base * rebate_rate / 100",
    baseField: source === "ORDER_AMOUNT" ? "order_amount" : source === "COMPANION_INCOME" ? "companion_income" : "platform_fee",
    orderAmount: money(order.total_amount),
    platformFee: money(extras.platformFeeAmount ?? order.platform_fee),
    companionIncomeUnrelated: true,
    completionMethod: extras.method || "",
    relationId: relation.id,
    ruleId: rule?.id || null,
  };

  let recordRow = null;
  try {
    const rows = await supabaseJson(restUrl(REC_TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        order_id: orderId,
        relation_id: relation.id,
        inviter_user_id: inviterId,
        invited_user_id: bossId,
        invited_player_id: order.companion_id || null,
        commission_type: "order_rebate",
        base_amount: base,
        rebate_rate: rebateRate,
        rebate_amount: rebateAmount,
        rebate_source: source,
        status: "settled",
        rule_id: rule?.id || null,
        meta,
        settled_at: settledAt,
        created_at: settledAt,
      }),
    });
    recordRow = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (/duplicate|23505|uq_referral_commission/i.test(String(error?.message || ""))) {
      const again = await supabaseJson(
        restUrl(
          REC_TABLE,
          `?order_id=eq.${encodeURIComponent(orderId)}&inviter_user_id=eq.${encodeURIComponent(inviterId)}&commission_type=eq.order_rebate&limit=1`
        ),
        { headers: serviceHeaders() }
      );
      return { duplicate: true, record: viewReferralRecord(again?.[0] || {}), wallet: await getReferralWallet(inviterId) };
    }
    throw error;
  }

  // Credit referral wallet (available)
  const walletBefore = await ensureReferralWallet(inviterId);
  const nextAvailable = money(walletBefore.available_amount) + rebateAmount;
  const nextEarned = money(walletBefore.total_earned) + rebateAmount;
  const walletRows = await supabaseJson(
    restUrl(WALLET_TABLE, `?user_id=eq.${encodeURIComponent(inviterId)}`),
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        available_amount: nextAvailable,
        total_earned: nextEarned,
        updated_at: nowIso(),
      }),
    }
  );
  const wallet = Array.isArray(walletRows) ? walletRows[0] : walletRows;

  return {
    ok: true,
    duplicate: false,
    record: viewReferralRecord(recordRow),
    wallet: viewReferralWallet(wallet || walletBefore, inviterId),
    calc: { base, rebateRate, rebateAmount, source },
  };
}

export async function listReferralRecordsForInviter(userId, { limit = 100 } = {}) {
  if (!userId) return [];
  try {
    const rows = await supabaseJson(
      restUrl(
        REC_TABLE,
        `?inviter_user_id=eq.${encodeURIComponent(userId)}&order=settled_at.desc&limit=${Math.max(1, Math.min(200, Number(limit) || 100))}`
      ),
      { headers: serviceHeaders() }
    );
    return (Array.isArray(rows) ? rows : []).map(viewReferralRecord);
  } catch (error) {
    if (isReferralMissing(error)) return [];
    throw error;
  }
}

export async function listReferralRelationsForInviter(userId) {
  if (!userId) return [];
  try {
    const rows = await supabaseJson(
      restUrl(
        REL_TABLE,
        `?inviter_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&order=created_at.desc&limit=100`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isReferralMissing(error)) return [];
    throw error;
  }
}

/**
 * Freeze referral available → frozen for a withdrawal allocation.
 */
export async function freezeReferralForWithdraw(userId, amount) {
  const amt = money(amount);
  if (!(amt > 0)) return viewReferralWallet(await ensureReferralWallet(userId), userId);
  const w = await ensureReferralWallet(userId);
  const available = money(w.available_amount);
  if (amt > available + 0.001) {
    throw httpError("邀请返点可提现余额不足", 400, { code: "REFERRAL_INSUFFICIENT" });
  }
  const rows = await supabaseJson(restUrl(WALLET_TABLE, `?user_id=eq.${encodeURIComponent(userId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      available_amount: money(available - amt),
      frozen_amount: money(money(w.frozen_amount) + amt),
      updated_at: nowIso(),
    }),
  });
  return viewReferralWallet(Array.isArray(rows) ? rows[0] : rows, userId);
}

export async function unfreezeReferralForWithdraw(userId, amount) {
  const amt = money(amount);
  if (!(amt > 0) || !userId) return null;
  const w = await ensureReferralWallet(userId);
  const frozen = money(w.frozen_amount);
  const release = Math.min(frozen, amt);
  const rows = await supabaseJson(restUrl(WALLET_TABLE, `?user_id=eq.${encodeURIComponent(userId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      available_amount: money(money(w.available_amount) + release),
      frozen_amount: money(frozen - release),
      updated_at: nowIso(),
    }),
  });
  return viewReferralWallet(Array.isArray(rows) ? rows[0] : rows, userId);
}

export async function completeReferralWithdraw(userId, amount) {
  const amt = money(amount);
  if (!(amt > 0) || !userId) return null;
  const w = await ensureReferralWallet(userId);
  const frozen = money(w.frozen_amount);
  const take = Math.min(frozen, amt);
  const rows = await supabaseJson(restUrl(WALLET_TABLE, `?user_id=eq.${encodeURIComponent(userId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      frozen_amount: money(frozen - take),
      total_withdrawn: money(money(w.total_withdrawn) + take),
      updated_at: nowIso(),
    }),
  });
  return viewReferralWallet(Array.isArray(rows) ? rows[0] : rows, userId);
}

export function parseWithdrawalReferralAmount(row = {}) {
  if (row.referral_rebate_withdrawn_amount != null && row.referral_rebate_withdrawn_amount !== "") {
    const n = Number(row.referral_rebate_withdrawn_amount);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }
  // Legacy fallback only
  const remark = String(row.remark || row.note || "");
  const m = remark.match(/\[\[WD_ALLOC\]\]([\s\S]*?)\[\[\/WD_ALLOC\]\]/);
  if (!m) return 0;
  try {
    const j = JSON.parse(m[1]);
    const n = Number(j.referralAmount ?? j.fromReferral ?? 0);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

export {
  REL_TABLE,
  RULE_TABLE,
  REC_TABLE,
  WALLET_TABLE,
  DEFAULT_ORDER_REBATE_RATE,
  DEFAULT_REBATE_SOURCE,
};
