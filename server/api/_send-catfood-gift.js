/**
 * Catfood gift send — balance must be locked server-side before any gift/income write.
 */
import {
  creditWallet,
  debitWallet,
  getWallet,
  money,
  notifyBoss,
  viewWallet,
} from "./_wallet.js";
import { companionDb, isMissingRelation } from "./_companion-media-store.js";
import { insertCompanionNotification } from "./_companion-inbox.js";
import { scheduleRecomputeSoft } from "./_popularity.js";

function nowIso() {
  return new Date().toISOString();
}

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function errText(e) {
  return `${e?.message || ""} ${JSON.stringify(e?.body || "")} ${e?.details || ""}`;
}

function isInsufficient(e) {
  return /不足|insufficient|not enough|balance/i.test(errText(e));
}

function isGiftTypeUnsupported(e) {
  const t = errText(e);
  if (isInsufficient(e)) return false;
  return /invalid.*(input|type|transaction)|check constraint|enum|violates|transaction_type|not of type/i.test(t);
}

function extractWalletTxId(debitResult) {
  if (!debitResult || typeof debitResult !== "object") return null;
  if (debitResult.id) return debitResult.id;
  if (debitResult.transaction_id) return debitResult.transaction_id;
  if (debitResult.transaction?.id) return debitResult.transaction.id;
  const txs = debitResult.transactions;
  if (Array.isArray(txs) && txs[0]) {
    return txs[0].id || txs[0].transaction_id || null;
  }
  if (Array.isArray(debitResult) && debitResult[0]?.id) return debitResult[0].id;
  return null;
}

async function giftCommissionRate(companionRow) {
  const fromCompanion = money(companionRow?.gift_commission_rate);
  if (fromCompanion > 0) return fromCompanion;
  try {
    const rows = await companionDb("gift_settings", "?id=eq.1&limit=1");
    return money(rows?.[0]?.commission_rate ?? 20);
  } catch {
    return 20;
  }
}

async function creditCompanionIncome(companionId, amount, note) {
  if (amount <= 0) return null;
  try {
    const rows = await companionDb("transactions", "", {
      method: "POST",
      body: JSON.stringify({
        user_id: companionId,
        order_id: null,
        transaction_type: "companion_income",
        amount,
        status: "completed",
        note: note || "礼物收益",
        created_at: nowIso(),
      }),
    });
    return rows?.[0] || null;
  } catch (e) {
    if (!isMissingRelation(e)) console.warn("[send-catfood-gift] creditCompanionIncome", e?.message || e);
    return null;
  }
}

function no(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/**
 * Atomically-ish send a catfood gift:
 * 1) lock-check available balance
 * 2) debit wallet
 * 3) write gift_transactions + companion income + gift wall
 * 4) notify boss + companion
 * On mid-flight failure after debit → refund debit.
 */
export async function sendCatfoodGift({
  bossId,
  companionId,
  giftId = null,
  quantity = 1,
  amount = null,
  kind = "gift",
  idempotencyKey,
  message = "",
  relatedOrderId = null,
  companionRow = null,
  giftRow = null,
  bossProfile = null,
}) {
  const boss = String(bossId || "").trim();
  const companion = String(companionId || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!boss) throw httpError("请先登录老板账号", 401);
  if (!companion) throw httpError("请选择赠送对象陪玩", 400);
  if (!key) throw httpError("缺少 idempotency_key", 400);

  try {
    const existed = await companionDb(
      "gift_transactions",
      `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`
    );
    if (existed?.[0]) {
      return {
        ok: true,
        replayed: true,
        message: kind === "tip" ? "打赏已处理（防重复）" : "礼物已处理（防重复）",
        transaction: existed[0],
      };
    }
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }

  let giftName = kind === "tip" ? "自由打赏" : "礼物";
  let giftIconUrl = "";
  let qty = Math.max(1, Math.floor(Number(quantity || 1)));
  let unitPrice = 0;
  let gross = 0;
  let resolvedGiftId = giftId ? String(giftId).trim() : null;

  if (kind === "gift") {
    if (!resolvedGiftId) throw httpError("请选择礼物", 400);
    let gift = giftRow;
    if (!gift) {
      const gifts = await companionDb(
        "gifts",
        `?id=eq.${encodeURIComponent(resolvedGiftId)}&enabled=eq.true&limit=1`
      ).catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      });
      gift = gifts?.[0];
    }
    if (!gift) throw httpError("礼物不存在或已下架", 400);
    giftName = String(gift.name || "礼物");
    giftIconUrl = String(gift.icon_url || "");
    // Never trust client total — recompute from catalog unit price × qty
    unitPrice = money(gift.cat_food_price);
    if (unitPrice <= 0) throw httpError("礼物价格无效", 400);
    gross = money(unitPrice * qty);
  } else {
    gross = money(amount);
    qty = 1;
    unitPrice = gross;
    if (gross <= 0) throw httpError("请输入打赏数量", 400);
  }

  if (gross <= 0) throw httpError("礼物金额无效", 400);

  const walletRow = await getWallet(boss);
  const vw = viewWallet(walletRow || {}, boss);
  if (vw.frozen) {
    throw httpError("钱包已冻结，无法送礼", 403, { code: "WALLET_FROZEN" });
  }
  if (vw.availableBalance < gross) {
    throw httpError("猫粮余额不足", 400, {
      code: "INSUFFICIENT_BALANCE",
      availableBalance: vw.availableBalance,
      requiredAmount: gross,
      shortfall: Math.round((gross - vw.availableBalance) * 100) / 100,
      rechargeUrl: "/recharge.html",
    });
  }

  const rate = await giftCommissionRate(companionRow || {});
  const commissionAmount = Math.round(gross * (rate / 100) * 100) / 100;
  const companionIncome = Math.round((gross - commissionAmount) * 100) / 100;
  const debitKey = `gift:${key}`;

  let walletDebit = null;
  try {
    walletDebit = await debitWallet({
      bossId: boss,
      amount: gross,
      transactionType: kind === "gift" ? "gift" : "tip",
      idempotencyKey: debitKey,
      reason: `${giftName} x${qty} → ${companionRow?.nickname || companion}`,
      operatorId: boss,
    });
  } catch (e) {
    if (isInsufficient(e)) {
      const latest = viewWallet((await getWallet(boss).catch(() => null)) || {}, boss);
      throw httpError("猫粮余额不足", 400, {
        code: "INSUFFICIENT_BALANCE",
        availableBalance: latest.availableBalance,
        requiredAmount: gross,
        shortfall: Math.round((gross - latest.availableBalance) * 100) / 100,
        rechargeUrl: "/recharge.html",
      });
    }
    if (isGiftTypeUnsupported(e)) {
      try {
        walletDebit = await debitWallet({
          bossId: boss,
          amount: gross,
          transactionType: "order_payment",
          idempotencyKey: debitKey,
          reason: `${giftName} x${qty}`,
          operatorId: boss,
        });
      } catch (e2) {
        if (isInsufficient(e2)) {
          const latest = viewWallet((await getWallet(boss).catch(() => null)) || {}, boss);
          throw httpError("猫粮余额不足", 400, {
            code: "INSUFFICIENT_BALANCE",
            availableBalance: latest.availableBalance,
            requiredAmount: gross,
            shortfall: Math.round((gross - latest.availableBalance) * 100) / 100,
            rechargeUrl: "/recharge.html",
          });
        }
        throw e2;
      }
    } else {
      throw e;
    }
  }

  if (!walletDebit || walletDebit.ok === false) {
    throw httpError("猫粮扣款失败，礼物未送出", 500, { code: "WALLET_DEBIT_FAILED" });
  }

  const walletTxId = extractWalletTxId(walletDebit);
  const giftNote = `礼物收益：${giftName} MCJ_GIFT:${JSON.stringify({
    source: "gift",
    giftName,
    qty,
    gross,
    platformCommission: commissionAmount,
    net: companionIncome,
    paymentMethod: "catfood",
  })}`;

  let incomeTx = null;
  let tx = null;
  try {
    incomeTx = await creditCompanionIncome(companion, companionIncome, giftNote);

    let payload = {
      tx_no: no("GIFT"),
      sender_boss_id: boss,
      receiver_companion_id: companion,
      gift_id: resolvedGiftId,
      gift_name: giftName,
      quantity: qty,
      unit_price: unitPrice,
      gross_cat_food: gross,
      gross_amount: gross,
      platform_commission_rate: rate,
      platform_commission_amount: commissionAmount,
      platform_commission: commissionAmount,
      companion_income: companionIncome,
      net_companion_income: companionIncome,
      message: String(message || "").trim(),
      related_order_id: relatedOrderId || null,
      kind: kind === "gift" ? "gift" : "tip",
      idempotency_key: key,
      fulfillment_status: "completed",
      gift_image_url: giftIconUrl || "",
      payment_method: "catfood",
      payment_status: "paid",
      approval_status: "auto",
      wallet_transaction_id: walletTxId,
      settlement_transaction_id: incomeTx?.id || null,
      delivered_at: nowIso(),
      created_at: nowIso(),
    };

    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const rows = await companionDb("gift_transactions", "", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        tx = rows?.[0] || null;
        break;
      } catch (err) {
        const msg = errText(err);
        if (/duplicate|unique|23505/i.test(msg)) {
          const again = await companionDb(
            "gift_transactions",
            `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`
          ).catch(() => []);
          if (again?.[0]) {
            return {
              ok: true,
              replayed: true,
              message: "礼物已处理（防重复）",
              transaction: again[0],
            };
          }
        }
        const m = msg.match(/Could not find the '([^']+)' column/i);
        if (m && m[1] in payload) {
          delete payload[m[1]];
          continue;
        }
        throw err;
      }
    }

    if (!tx?.id && !isMissingRelation({ message: "gift_transactions" })) {
      // gift_transactions table may be missing on some envs — still require a durable record when table exists
    }

    if (kind === "gift") {
      try {
        const { recordCompanionGiftWallHit } = await import("./_gift-orders.js");
        await recordCompanionGiftWallHit({
          companionId: companion,
          giftId: resolvedGiftId,
          giftName,
          giftImageUrl: giftIconUrl,
          quantity: qty,
        });
      } catch (wallErr) {
        console.warn("[send-catfood-gift] gift wall", wallErr?.message || wallErr);
      }
    }

    const companionName = companionRow?.nickname || "陪玩";
    const bossName =
      bossProfile?.nickname || bossProfile?.display_name || bossProfile?.boss_uid || "一位老板";

    await notifyBoss(
      boss,
      "🎁 礼物赠送成功",
      `你已成功向「${companionName}」赠送「${giftName} ×${qty}」\n共支付：${gross} 猫粮`,
      "gift",
      tx?.id || key
    ).catch(() => null);

    await insertCompanionNotification({
      companionUserId: companion,
      category: "gift",
      title: "🎁 你收到新礼物啦",
      body: `老板送给你：「${giftName} ×${qty}」\n礼物总额：${gross} 猫粮`,
      href: "/companion/gifts",
      noticeKey: `gift-catfood-${key}`,
      notificationType: "gift_received",
      relatedApplicationId: tx?.id || null,
    }).catch((err) => console.warn("[send-catfood-gift] companion notify", err?.message || err));

    try {
      scheduleRecomputeSoft();
    } catch {
      /* optional */
    }

    const walletAfter = viewWallet((await getWallet(boss).catch(() => null)) || {}, boss);

    return {
      ok: true,
      replayed: false,
      message: kind === "tip" ? "打赏成功" : "礼物已送出",
      transaction: tx,
      wallet: walletAfter,
      snapshot: {
        grossCatFood: gross,
        platformCommissionRate: rate,
        platformCommissionAmount: commissionAmount,
        companionIncome,
        giftName,
        quantity: qty,
        paymentMethod: "catfood",
        availableBalance: walletAfter.availableBalance,
      },
    };
  } catch (midErr) {
    // Debit succeeded but gift write failed → refund so we never keep money without gift
    try {
      await creditWallet({
        bossId: boss,
        amount: gross,
        transactionType: "refund",
        balanceType: "paid",
        idempotencyKey: `gift-refund:${key}`,
        reason: `礼物失败自动退回：${giftName}`,
        operatorId: boss,
      });
    } catch (refundErr) {
      console.error(
        "[send-catfood-gift] CRITICAL refund failed after debit",
        refundErr?.message || refundErr,
        "original",
        midErr?.message || midErr
      );
    }
    throw midErr;
  }
}

export function insufficientPayload(error) {
  return {
    ok: false,
    code: error.code || "INSUFFICIENT_BALANCE",
    message: error.message || "猫粮余额不足",
    availableBalance: error.availableBalance ?? 0,
    requiredAmount: error.requiredAmount ?? null,
    shortfall: error.shortfall ?? null,
    rechargeUrl: error.rechargeUrl || "/recharge.html",
  };
}
