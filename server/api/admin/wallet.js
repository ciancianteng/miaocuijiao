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
import { requireAdmin } from "../_admin-auth.js";

const ADMIN_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

function json(res, status, data) {
  res.status(status).json(data);
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
  let adminProfile;
  try {
    adminProfile = await requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有钱包管理权限" });
  }
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
      if (action === "pending_recharges" || action === "list_pending_recharges") {
        const statusFilter = String(req.query.status || "pending_review").trim();
        let rows = [];
        try {
          if (statusFilter === "pending_all" || statusFilter === "queue") {
            // Review queue: awaiting payment proof review (and legacy pending_payment shells).
            const a = await supabaseJson(
              restUrl("payment_orders", `?status=eq.pending_review&order=submitted_at.desc.nullslast,created_at.desc&limit=200`),
              { headers: serviceHeaders() }
            ).catch(() => []);
            const b = await supabaseJson(
              restUrl("payment_orders", `?status=eq.pending_payment&order=created_at.desc&limit=100`),
              { headers: serviceHeaders() }
            ).catch(() => []);
            rows = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
          } else if (statusFilter && statusFilter !== "all") {
            const query = `?status=eq.${encodeURIComponent(statusFilter)}&order=created_at.desc&limit=200`;
            rows = await supabaseJson(restUrl("payment_orders", query), { headers: serviceHeaders() });
          } else {
            rows = await supabaseJson(restUrl("payment_orders", "?order=created_at.desc&limit=200"), {
              headers: serviceHeaders(),
            });
          }
        } catch (e) {
          if (isMissingRelation(e)) rows = [];
          else throw e;
        }
        const list = Array.isArray(rows) ? rows : [];
        const bossIds = [...new Set(list.map((r) => r.boss_id).filter(Boolean))];
        const profileMap = {};
        await Promise.all(
          bossIds.map(async (id) => {
            try {
              const profiles = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&select=id,display_name,nickname,email,phone&limit=1`), {
                headers: serviceHeaders(),
              });
              profileMap[id] = profiles?.[0] || null;
            } catch {
              profileMap[id] = null;
            }
          })
        );
        const items = [];
        for (const row of list) {
          const p = profileMap[row.boss_id] || {};
          const raw = row.raw_response && typeof row.raw_response === "object" ? row.raw_response : {};
          let proofUrl = String(row.proof_url || raw.proofUrl || "").trim();
          const bucket = String(row.proof_bucket || raw.proofBucket || "").trim();
          const objectPath = String(row.proof_path || raw.proofPath || "").trim();
          if ((!proofUrl || !/^https?:\/\//i.test(proofUrl)) && bucket && objectPath) {
            try {
              const { createSignedUrl } = await import("../_companion-media-store.js");
              proofUrl = (await createSignedUrl(bucket, objectPath, 60 * 60)) || proofUrl;
            } catch {
              /* keep */
            }
          }
          items.push({
            id: row.id,
            paymentNo: row.payment_no || row.id,
            bossId: row.boss_id || "",
            bossName: p.display_name || p.nickname || p.email || "老板",
            bossEmail: p.email || "",
            amountRm: money(row.amount),
            catFoodAmount: money(row.cat_food_amount || row.paid_cat_food),
            paidCatFood: money(row.paid_cat_food || row.cat_food_amount),
            bonusCatFood: money(row.bonus_cat_food),
            totalCatFood: money(row.cat_food_amount) || money(row.paid_cat_food) + money(row.bonus_cat_food),
            paymentMethod: row.payment_method || "",
            status: row.status || "pending_payment",
            paymentUrl: row.payment_url || "",
            proofUrl,
            proofPath: objectPath,
            rejectReason: String(row.reject_reason || raw.rejectReason || "").trim(),
            submittedAt: row.submitted_at || raw.submittedAt || "",
            createdAt: row.created_at || "",
            creditedAt: row.credited_at || "",
          });
        }
        return json(res, 200, { ok: true, items });
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
    const admin = adminProfile;
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
        operatorRole: admin.role || "admin",
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
        operatorRole: admin.role || "admin",
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
        operatorRole: admin.role || "admin",
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
          operatorRole: admin.role || "admin",
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
        operatorRole: admin.role || "admin",
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
        operatorRole: admin.role || "admin",
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
        operatorRole: admin.role || "admin",
        after: result,
      });
      return json(res, 200, {
        ok: true,
        message: result?.duplicate ? "已到账（重复模拟被忽略）" : "模拟支付成功，猫粮已入账",
        result,
      });
    }

    if (action === "confirm_manual_recharge") {
      const paymentNo = String(body.paymentNo || body.payment_no || body.id || "").trim();
      if (!paymentNo) return json(res, 400, { ok: false, message: "缺少 paymentNo" });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentNo);
      const match = isUuid
        ? `or=(payment_no.eq.${encodeURIComponent(paymentNo)},id.eq.${encodeURIComponent(paymentNo)})`
        : `payment_no=eq.${encodeURIComponent(paymentNo)}`;
      const orderRows = await supabaseJson(restUrl("payment_orders", `?${match}&limit=1`), {
        headers: serviceHeaders(),
      });
      const order = orderRows?.[0];
      if (!order) return json(res, 404, { ok: false, message: "充值订单不存在" });
      const st = String(order.status || "").toLowerCase();
      if (st === "paid" || st === "credited") {
        return json(res, 200, { ok: true, message: "该充值单已到账", paymentNo: order.payment_no, duplicate: true });
      }
      if (!/pending|pending_payment|pending_review|awaiting|unpaid|manual/i.test(st)) {
        return json(res, 400, { ok: false, message: `当前状态不可确认到账：${order.status || "-"}` });
      }
      const raw = order.raw_response && typeof order.raw_response === "object" ? order.raw_response : {};
      const hasProof = !!(order.proof_path || order.proof_url || raw.proofPath || raw.proofUrl);
      if (!hasProof && st === "pending_review") {
        return json(res, 400, { ok: false, message: "该充值单缺少付款截图，不能审核通过" });
      }
      const tradeNo = String(body.tradeNo || body.trade_no || body.providerTradeNo || `MANUAL-${Date.now()}`).trim();
      const result = await creditRechargePayment(order.payment_no, tradeNo, `admin-confirm:${order.payment_no}`);
      await writeAdminLog({
        module: "wallet",
        action: "confirm_manual_recharge",
        targetType: "payment_order",
        targetId: order.payment_no,
        operatorId,
        operatorRole: admin.role || "admin",
        reason: String(body.reason || "管理员确认线下转账到账"),
        after: result,
      });
      try {
        await notifyBoss(
          order.boss_id,
          "充值已到账",
          `管理员已确认您的充值 ${order.payment_no}，猫粮已入账。`,
          "wallet",
          order.payment_no
        );
      } catch {
        /* optional */
      }
      return json(res, 200, {
        ok: true,
        message: result?.duplicate ? "已到账（重复确认被忽略）" : "已确认到账，猫粮已入账",
        result,
        paymentNo: order.payment_no,
      });
    }

    if (action === "reject_manual_recharge" || action === "reject_recharge") {
      const paymentNo = String(body.paymentNo || body.payment_no || body.id || "").trim();
      const reason = String(body.reason || body.rejectReason || body.reject_reason || "").trim();
      if (!paymentNo) return json(res, 400, { ok: false, message: "缺少 paymentNo" });
      if (!reason) return json(res, 400, { ok: false, message: "请填写拒绝原因" });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentNo);
      const match = isUuid
        ? `or=(payment_no.eq.${encodeURIComponent(paymentNo)},id.eq.${encodeURIComponent(paymentNo)})`
        : `payment_no=eq.${encodeURIComponent(paymentNo)}`;
      const orderRows = await supabaseJson(restUrl("payment_orders", `?${match}&limit=1`), {
        headers: serviceHeaders(),
      });
      const order = orderRows?.[0];
      if (!order) return json(res, 404, { ok: false, message: "充值订单不存在" });
      const st = String(order.status || "").toLowerCase();
      if (st === "paid" || st === "credited") {
        return json(res, 409, { ok: false, message: "已到账订单不能拒绝" });
      }
      if (!/pending_review|pending_payment|pending/i.test(st)) {
        return json(res, 400, { ok: false, message: `当前状态不可拒绝：${order.status || "-"}` });
      }
      const raw = order.raw_response && typeof order.raw_response === "object" ? { ...order.raw_response } : {};
      raw.rejectReason = reason;
      raw.rejectedAt = new Date().toISOString();
      const patch = { status: "rejected", raw_response: raw, reject_reason: reason };
      let saved = null;
      try {
        const rows = await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(order.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
        });
        saved = rows?.[0] || null;
      } catch (err) {
        if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
        const rows = await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(order.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ status: "rejected", raw_response: raw, updated_at: new Date().toISOString() }),
        });
        saved = rows?.[0] || null;
      }
      await writeAdminLog({
        module: "wallet",
        action: "reject_manual_recharge",
        targetType: "payment_order",
        targetId: order.payment_no,
        operatorId,
        operatorRole: admin.role || "admin",
        reason,
        after: saved,
      });
      try {
        await notifyBoss(order.boss_id, "充值审核未通过", `充值单 ${order.payment_no} 被拒绝：${reason}`, "wallet", order.payment_no);
      } catch {
        /* optional */
      }
      return json(res, 200, { ok: true, message: "已拒绝该充值申请", paymentNo: order.payment_no, reason });
    }

    if (action === "cleanup_test_recharges") {
      // Admin: cancel empty pending shells matching PAY- timestamps (no proof, not paid).
      const nos = Array.isArray(body.paymentNos)
        ? body.paymentNos.map((x) => String(x || "").trim()).filter(Boolean)
        : String(body.paymentNo || body.payment_no || "")
            .split(/[,，\s]+/)
            .map((x) => x.trim())
            .filter(Boolean);
      if (!nos.length) return json(res, 400, { ok: false, message: "缺少 paymentNos" });
      const cleaned = [];
      const skipped = [];
      for (const paymentNo of nos) {
        const orderRows = await supabaseJson(
          restUrl("payment_orders", `?payment_no=eq.${encodeURIComponent(paymentNo)}&limit=1`),
          { headers: serviceHeaders() }
        ).catch(() => []);
        const order = orderRows?.[0];
        if (!order) {
          skipped.push({ paymentNo, reason: "not_found" });
          continue;
        }
        const st = String(order.status || "").toLowerCase();
        const raw = order.raw_response && typeof order.raw_response === "object" ? order.raw_response : {};
        const hasProof = !!(order.proof_path || order.proof_url || raw.proofPath || raw.proofUrl);
        if (hasProof || /paid|credited|pending_review/.test(st)) {
          skipped.push({ paymentNo, reason: "has_proof_or_final", status: st });
          continue;
        }
        await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(order.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            status: "cancelled",
            raw_response: { ...raw, cancelledReason: "admin_cleanup_test_pending", cancelledAt: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          }),
        }).catch(() => null);
        cleaned.push(paymentNo);
      }
      return json(res, 200, { ok: true, cleaned, skipped });
    }

    return json(res, 400, { ok: false, message: "未知钱包操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/wallet-system.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "钱包接口异常" });
  }
}
