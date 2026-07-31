import {
  getWallet,
  getWalletSettings,
  hasWalletDb,
  isMissingRelation,
  listWalletTx,
  money,
  nowIso,
  notifyBoss,
  creditWallet,
  creditRechargePayment,
  debitWallet,
  restUrl,
  serviceHeaders,
  supabaseJson,
  viewTx,
  viewWallet,
  writeAdminLog,
} from "../_wallet.js";

const ADMIN_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

function json(res, status, data) {
  res.status(status).json(data);
}

function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "").trim();
}

function canManage(req) {
  return ADMIN_ROLES.has(roleFrom(req));
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function authHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
    "Content-Type": "application/json",
    ...extra,
  };
}

async function adminFromToken(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { id: null, role: roleFrom(req) || "admin" };
  try {
    const user = await supabaseJson(`${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
      headers: authHeaders({ Authorization: `Bearer ${token}` }),
    });
    const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
      headers: serviceHeaders(),
    });
    return rows?.[0] || { id: user.id, role: roleFrom(req) || "admin" };
  } catch {
    return { id: null, role: roleFrom(req) || "admin" };
  }
}

function compensationTypeToTx(type) {
  return (
    {
      after_sale: "platform_compensation",
      bad_review: "platform_compensation",
      activity: "activity_reward",
      invite: "invite_reward",
      manual: "admin_adjustment",
      other: "admin_adjustment",
      refund_paid: "refund",
    }[type] || "platform_compensation"
  );
}

export default async function handler(req, res) {
  if (!canManage(req)) return json(res, 403, { ok: false, message: "没有钱包管理权限" });
  if (!hasWalletDb()) return json(res, 503, { ok: false, message: "未配置数据库" });

  try {
    if (req.method === "GET") {
      const bossId = String(req.query.bossId || req.query.boss_id || "").trim();
      const action = String(req.query.action || "wallet").trim();
      if (action === "settings") {
        const settings = await getWalletSettings();
        return json(res, 200, { ok: true, settings });
      }
      if (action === "compensations") {
        const status = String(req.query.status || "").trim();
        let query = "?order=created_at.desc&limit=200";
        if (status) query = `?status=eq.${encodeURIComponent(status)}&order=created_at.desc&limit=200`;
        const rows = await supabaseJson(restUrl("compensation_requests", query), { headers: serviceHeaders() }).catch((e) => {
          if (isMissingRelation(e)) return [];
          throw e;
        });
        return json(res, 200, { ok: true, items: Array.isArray(rows) ? rows : [] });
      }
      if (!bossId) return json(res, 400, { ok: false, message: "缺少 bossId" });
      const [wallet, txs] = await Promise.all([getWallet(bossId), listWalletTx(bossId, 100)]);
      return json(res, 200, {
        ok: true,
        wallet: viewWallet(wallet, bossId),
        transactions: txs.map(viewTx),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "").trim();
    const admin = await adminFromToken(req);
    const operatorId = admin.id || null;

    if (action === "grant") {
      const bossId = String(body.bossId || body.boss_id || "").trim();
      const amount = money(body.amount);
      const grantType = String(body.grantType || body.request_type || "manual").trim();
      const balanceType = String(body.balanceType || body.balance_type || "bonus").trim() === "paid" ? "paid" : "bonus";
      const reason = String(body.reason || "").trim();
      const internalNote = String(body.internalNote || body.internal_note || "").trim();
      const relatedOrderId = String(body.relatedOrderId || body.related_order_id || "").trim() || null;
      const notify = body.notifyBoss !== false;
      if (!bossId) return json(res, 400, { ok: false, message: "缺少老板 ID" });
      if (amount <= 0) return json(res, 400, { ok: false, message: "发放数量必须大于 0" });
      if (!reason) return json(res, 400, { ok: false, message: "必须填写发放原因" });
      if (grantType === "bad_review" && balanceType !== "bonus") {
        return json(res, 400, { ok: false, message: "差评安抚必须发放到赠送猫粮" });
      }

      const idempotencyKey = String(body.idempotencyKey || `admin-grant:${bossId}:${Date.now()}:${amount}:${grantType}`).trim();
      const before = viewWallet(await getWallet(bossId), bossId);
      const result = await creditWallet({
        bossId,
        transactionType: compensationTypeToTx(grantType),
        amount,
        balanceType,
        idempotencyKey,
        reason,
        internalNote,
        operatorId,
        relatedOrderId,
        expiresAt: body.expiresAt || null,
      });
      const after = viewWallet(result?.wallet || (await getWallet(bossId)), bossId);
      await writeAdminLog({
        module: "wallet",
        action: "grant",
        targetType: "boss",
        targetId: bossId,
        operatorId,
        operatorRole: roleFrom(req),
        reason,
        before,
        after,
      });
      if (notify) {
        await notifyBoss(bossId, "平台发放猫粮", `您收到 ${amount} ${balanceType === "paid" ? "充值" : "赠送"}猫粮。原因：${reason}`, "compensation", relatedOrderId || "");
      }
      return json(res, 200, { ok: true, message: "已发放猫粮", wallet: after, result });
    }

    if (action === "deduct") {
      const bossId = String(body.bossId || body.boss_id || "").trim();
      const amount = money(body.amount);
      const reason = String(body.reason || "").trim();
      if (!bossId) return json(res, 400, { ok: false, message: "缺少老板 ID" });
      if (amount <= 0) return json(res, 400, { ok: false, message: "扣减数量必须大于 0" });
      if (!reason) return json(res, 400, { ok: false, message: "必须填写扣减原因" });
      const before = viewWallet(await getWallet(bossId), bossId);
      if (before.totalBalance < amount) return json(res, 400, { ok: false, message: "余额不足，不能扣成负数" });
      const result = await debitWallet({
        bossId,
        transactionType: "admin_deduct",
        amount,
        idempotencyKey: String(body.idempotencyKey || `admin-deduct:${bossId}:${Date.now()}:${amount}`),
        reason,
        internalNote: String(body.internalNote || ""),
        operatorId,
        preferBalanceType: body.preferBalanceType || null,
      });
      const after = viewWallet(result?.wallet || (await getWallet(bossId)), bossId);
      await writeAdminLog({
        module: "wallet",
        action: "deduct",
        targetType: "boss",
        targetId: bossId,
        operatorId,
        operatorRole: roleFrom(req),
        reason,
        before,
        after,
      });
      return json(res, 200, { ok: true, message: "已扣减猫粮", wallet: after, result });
    }

    if (action === "freeze" || action === "unfreeze") {
      const bossId = String(body.bossId || body.boss_id || "").trim();
      if (!bossId) return json(res, 400, { ok: false, message: "缺少老板 ID" });
      const frozen = action === "freeze";
      await getWallet(bossId);
      const rows = await supabaseJson(restUrl("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ frozen, updated_at: nowIso() }),
      });
      await writeAdminLog({
        module: "wallet",
        action,
        targetType: "boss",
        targetId: bossId,
        operatorId,
        operatorRole: roleFrom(req),
        reason: String(body.reason || ""),
        after: rows?.[0] || { frozen },
      });
      return json(res, 200, { ok: true, message: frozen ? "钱包已冻结" : "钱包已解冻", wallet: viewWallet(rows?.[0], bossId) });
    }

    if (action === "review_compensation") {
      const id = String(body.id || body.requestId || "").trim();
      const decision = String(body.decision || "").trim();
      const reviewNote = String(body.reviewNote || body.review_note || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少申请 ID" });
      if (!/^(approve|reject)$/.test(decision)) return json(res, 400, { ok: false, message: "decision 只能是 approve 或 reject" });

      const rows = await supabaseJson(restUrl("compensation_requests", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: serviceHeaders(),
      });
      const reqRow = rows?.[0];
      if (!reqRow) return json(res, 404, { ok: false, message: "补偿申请不存在" });
      if (reqRow.status !== "pending") return json(res, 400, { ok: false, message: "该申请已处理" });

      if (decision === "reject") {
        const patched = await supabaseJson(restUrl("compensation_requests", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            status: "rejected",
            reviewer_id: operatorId,
            review_note: reviewNote,
            reviewed_at: nowIso(),
          }),
        });
        await writeAdminLog({
          module: "compensation",
          action: "reject",
          targetType: "compensation_request",
          targetId: id,
          operatorId,
          operatorRole: roleFrom(req),
          reason: reviewNote,
        });
        return json(res, 200, { ok: true, message: "已驳回", item: patched?.[0] || null });
      }

      const amount = money(body.approvedAmount != null ? body.approvedAmount : reqRow.suggested_amount);
      if (amount <= 0) return json(res, 400, { ok: false, message: "通过数量必须大于 0" });
      const balanceType = reqRow.balance_type === "paid" ? "paid" : "bonus";
      const credit = await creditWallet({
        bossId: reqRow.boss_id,
        transactionType: compensationTypeToTx(reqRow.request_type),
        amount,
        balanceType,
        idempotencyKey: `compensation:${id}`,
        reason: reqRow.reason || "平台补偿",
        internalNote: reviewNote || reqRow.staff_note || "",
        operatorId,
        relatedOrderId: reqRow.related_order_id || null,
        compensationId: id,
        expiresAt: reqRow.expires_at || null,
      });

      const patched = await supabaseJson(restUrl("compensation_requests", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          status: "approved",
          approved_amount: amount,
          reviewer_id: operatorId,
          review_note: reviewNote,
          reviewed_at: nowIso(),
        }),
      });

      if (reqRow.notify_boss !== false) {
        await notifyBoss(
          reqRow.boss_id,
          "补偿猫粮已到账",
          `平台已发放 ${amount} 赠送猫粮。原因：${reqRow.reason || "售后补偿"}`,
          "compensation",
          id
        );
      }
      await writeAdminLog({
        module: "compensation",
        action: "approve",
        targetType: "compensation_request",
        targetId: id,
        operatorId,
        operatorRole: roleFrom(req),
        reason: reviewNote || reqRow.reason,
        after: { amount, credit },
      });
      return json(res, 200, {
        ok: true,
        message: "已审核通过并入账",
        item: patched?.[0] || null,
        wallet: viewWallet(credit?.wallet || (await getWallet(reqRow.boss_id)), reqRow.boss_id),
      });
    }

    if (action === "save_settings") {
      const patch = {
        debit_order: String(body.debitOrder || body.debit_order || "expiring_bonus,bonus,paid"),
        bonus_can_withdraw: !!body.bonusCanWithdraw,
        bonus_has_expiry_default: !!body.bonusHasExpiryDefault,
        bonus_default_expire_days: Number(body.bonusDefaultExpireDays || 30),
        cs_max_per_request: money(body.csMaxPerRequest != null ? body.csMaxPerRequest : 100),
        cs_max_per_day: money(body.csMaxPerDay != null ? body.csMaxPerDay : 300),
        allow_cs_apply: body.allowCsApply !== false,
        updated_at: nowIso(),
      };
      const rows = await supabaseJson(restUrl("wallet_settings", "?id=eq.1"), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      });
      await writeAdminLog({
        module: "wallet",
        action: "save_settings",
        targetType: "wallet_settings",
        targetId: "1",
        operatorId,
        operatorRole: roleFrom(req),
        after: patch,
      });
      return json(res, 200, { ok: true, message: "钱包设置已保存", settings: rows?.[0] || patch });
    }

    if (action === "simulate_paid") {
      const paymentNo = String(body.paymentNo || body.payment_no || "").trim();
      if (!paymentNo) return json(res, 400, { ok: false, message: "缺少 paymentNo" });
      const orderRows = await supabaseJson(restUrl("payment_orders", `?payment_no=eq.${encodeURIComponent(paymentNo)}&limit=1`), {
        headers: serviceHeaders(),
      });
      const order = orderRows?.[0];
      if (!order) return json(res, 404, { ok: false, message: "充值订单不存在" });
      const methods = await supabaseJson(restUrl("payment_methods", `?code=eq.${encodeURIComponent(order.payment_method)}&limit=1`), {
        headers: serviceHeaders(),
      }).catch(() => []);
      const method = methods?.[0];
      if (method && String(method.mode || "test") !== "test") {
        return json(res, 403, { ok: false, message: "仅测试模式支付订单允许模拟到账" });
      }
      const result = await creditRechargePayment(paymentNo, `SIM-${Date.now()}`, `simulate:${paymentNo}`);
      await writeAdminLog({
        module: "wallet",
        action: "simulate_paid",
        targetType: "payment_order",
        targetId: paymentNo,
        operatorId,
        operatorRole: roleFrom(req),
        after: result,
      });
      return json(res, 200, {
        ok: true,
        message: result?.duplicate ? "已到账（重复模拟被忽略）" : "模拟支付成功，猫粮已入账",
        result,
      });
    }

    return json(res, 400, { ok: false, message: "未知钱包操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/wallet-system.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "钱包接口异常" });
  }
}
