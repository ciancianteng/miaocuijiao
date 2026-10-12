const AUDIENCES = ["home", "companion", "service", "all"];
const CURRENCIES = ["MYR", "CNY"];
const HOLD_STATUSES = ["pending_accept", "pending_payment", "pending_review", "confirmed", "in_service"];

function uid(prefix) {
  return prefix + "_" + Math.random().toString(16).slice(2, 10);
}

function now() {
  return new Date().toISOString();
}

function flag(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function parseJson(text, fallback) {
  try { return JSON.parse(text || ""); } catch (e) { return fallback; }
}

export function installFlow(OpsStore, OpsError) {
  OpsStore.prototype.assertSlotFree = function (companionId, slotStart, slotEnd, exceptId) {
    const rows = this.db.prepare(`SELECT id FROM orders
      WHERE companion_id = ? AND id != ? AND slot_start != '' AND slot_end != ''
      AND status IN (${HOLD_STATUSES.map(() => "?").join(",")})
      AND slot_start < ? AND slot_end > ?`).all(companionId, exceptId || "", ...HOLD_STATUSES, slotEnd, slotStart);
    if (rows.length) throw new OpsError("这个时段已经有预约，不能重复占用");
  };

  OpsStore.prototype.expireOrders = function () {
    const ts = now();
    this.db.prepare("UPDATE orders SET status = 'accept_timeout', updated_at = ? WHERE status = 'pending_accept' AND accept_deadline != '' AND accept_deadline <= ?").run(ts, ts);
    this.db.prepare("UPDATE orders SET status = 'payment_timeout', updated_at = ? WHERE status = 'pending_payment' AND pay_deadline != '' AND pay_deadline <= ?").run(ts, ts);
  };

  OpsStore.prototype.getOrder = function (id) {
    this.expireOrders();
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    return row ? this.mapOrder(row) : null;
  };

  OpsStore.prototype.pushOrderLog = function (order, action, actor, note) {
    const log = Array.isArray(order.log) ? order.log.slice() : [];
    log.push({ action: action, at: now(), actor: actor || "", note: note || "" });
    return JSON.stringify(log);
  };

  OpsStore.prototype.deleteService = function (id) {
    if (!this.getService(id)) throw new OpsError("服务不存在", 404);
    this.db.prepare("DELETE FROM requirement_fields WHERE service_id = ?").run(id);
    this.db.prepare("DELETE FROM offerings WHERE service_id = ?").run(id);
    this.db.prepare("DELETE FROM services WHERE id = ?").run(id);
    return { deleted: true, id: id };
  };

  OpsStore.prototype.orderAction = function (id, action, input, actor) {
    const order = this.getOrder(id);
    if (!order) throw new OpsError("订单不存在", 404);
    input = input || {};
    const ts = now();
    const log = this.pushOrderLog(order, action, actor, input.reason || input.note || "");
    if (action === "accept") {
      if (actor.role !== "companion" || actor.id !== order.companionId) throw new OpsError("只能由被预约的陪玩接单", 403);
      if (order.status !== "pending_accept") throw new OpsError("当前状态不能接单");
      const payDeadline = new Date(Date.now() + this.getSettings().payTimeoutMinutes * 60000).toISOString();
      this.db.prepare("UPDATE orders SET status = 'pending_payment', pay_deadline = ?, updated_at = ?, log_json = ? WHERE id = ? AND status = 'pending_accept'")
        .run(payDeadline, ts, log, id);
    } else if (action === "reject") {
      if (actor.role !== "companion" || actor.id !== order.companionId) throw new OpsError("只能由被预约的陪玩拒单", 403);
      if (order.status !== "pending_accept") throw new OpsError("当前状态不能拒单");
      if (!String(input.reason || "").trim()) throw new OpsError("拒单需要填写原因");
      this.db.prepare("UPDATE orders SET status = 'rejected', review_note = ?, updated_at = ?, log_json = ? WHERE id = ? AND status = 'pending_accept'")
        .run(String(input.reason).trim(), ts, log, id);
    } else if (action === "pay") {
      if (actor.role !== "boss" || actor.id !== order.bossId) throw new OpsError("只能由下单老板付款", 403);
      if (order.status !== "pending_payment" && order.status !== "review_failed") throw new OpsError("当前状态不能付款");
      const snapshot = this.paymentSnapshot(input);
      this.db.prepare(`UPDATE orders SET status = 'pending_review', pay_channel_id = ?, pay_currency = ?, pay_amount = ?, pay_proof = ?, pay_snapshot_json = ?, updated_at = ?, log_json = ?
        WHERE id = ? AND status IN ('pending_payment', 'review_failed')`)
        .run(snapshot.channelId, snapshot.currency, order.totalPrice, String(input.proof || "").trim(), JSON.stringify(snapshot), ts, log, id);
    } else if (action === "cancel") {
      const allowed = actor.role === "admin" || (actor.role === "boss" && actor.id === order.bossId);
      if (!allowed) throw new OpsError("不能取消这张订单", 403);
      if (["pending_accept", "pending_payment", "pending_review", "review_failed", "payment_exception", "accept_timeout", "payment_timeout"].indexOf(order.status) < 0) {
        throw new OpsError("当前状态不能取消");
      }
      this.db.prepare("UPDATE orders SET status = 'cancelled', review_note = ?, updated_at = ?, log_json = ? WHERE id = ?")
        .run(String(input.reason || "").trim(), ts, log, id);
    } else if (action === "review") {
      if (actor.role !== "admin" && actor.role !== "service") throw new OpsError("需要客服或管理员权限", 403);
      if (order.status !== "pending_review" && order.status !== "payment_exception") throw new OpsError("当前状态不能审核付款");
      const result = String(input.result || "");
      if (["confirmed", "review_failed", "payment_exception"].indexOf(result) < 0) throw new OpsError("审核结果不正确");
      if (result !== "confirmed" && !String(input.reason || "").trim()) throw new OpsError("未通过或异常核对时需要填写原因");
      this.db.prepare("UPDATE orders SET status = ?, review_note = ?, updated_at = ?, log_json = ? WHERE id = ? AND status IN ('pending_review', 'payment_exception')")
        .run(result, String(input.reason || "").trim(), ts, log, id);
    } else if (action === "start") {
      if (actor.role !== "admin" && actor.role !== "service") throw new OpsError("需要客服或管理员权限", 403);
      if (order.status !== "confirmed") throw new OpsError("客服确认到账后才能开始服务");
      this.db.prepare("UPDATE orders SET status = 'in_service', updated_at = ?, log_json = ? WHERE id = ? AND status = 'confirmed'").run(ts, log, id);
    } else if (action === "complete") {
      if (actor.role !== "admin" && actor.role !== "service") throw new OpsError("需要客服或管理员权限", 403);
      if (order.status !== "in_service") throw new OpsError("服务开始后才能完成");
      this.db.prepare("UPDATE orders SET status = 'completed', updated_at = ?, log_json = ? WHERE id = ? AND status = 'in_service'").run(ts, log, id);
    } else {
      throw new OpsError("不支持的订单操作");
    }
    const next = this.getOrder(id);
    if (!next || next.updatedAt < ts && next.status === order.status) throw new OpsError("操作没有生效，请刷新后重试");
    return next;
  };

  OpsStore.prototype.paymentSnapshot = function (input) {
    if (String(input.method || "") === "wallet") {
      return { channelId: "wallet", name: "猫粮余额", currency: "MYR", payee: "平台内部钱包", bank: "", account: "", qrUrl: "", instructions: "使用猫粮余额，仍需客服核对扣款。", kind: "wallet" };
    }
    const channel = this.getChannel(input.channelId);
    if (!channel || !channel.enabled) throw new OpsError("这个收款渠道没有启用");
    return {
      channelId: channel.id,
      name: channel.name,
      currency: channel.currency,
      payee: channel.payee,
      bank: channel.bank,
      account: channel.account,
      qrUrl: channel.qrUrl,
      instructions: channel.instructions,
      kind: "external"
    };
  };

  OpsStore.prototype.mapChannel = function (row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      currency: row.currency,
      payee: row.payee || "",
      bank: row.bank || "",
      account: row.account || "",
      qrUrl: row.qr_url || "",
      instructions: row.instructions || "",
      enabled: !!row.enabled,
      sort: Number(row.sort_order || 0),
      updatedAt: row.updated_at
    };
  };

  OpsStore.prototype.listChannels = function (enabledOnly) {
    const sql = enabledOnly
      ? "SELECT * FROM payment_channels WHERE enabled = 1 ORDER BY sort_order ASC, name ASC"
      : "SELECT * FROM payment_channels ORDER BY sort_order ASC, name ASC";
    return this.db.prepare(sql).all().map((row) => this.mapChannel(row));
  };

  OpsStore.prototype.getChannel = function (id) {
    return this.mapChannel(this.db.prepare("SELECT * FROM payment_channels WHERE id = ?").get(id));
  };

  OpsStore.prototype.saveChannel = function (input, id) {
    const name = String(input.name || "").trim();
    const currency = String(input.currency || "").trim().toUpperCase();
    if (!name) throw new OpsError("请填写渠道名称");
    if (CURRENCIES.indexOf(currency) < 0) throw new OpsError("币种只支持 MYR 或 CNY");
    const ts = now();
    const values = [name, currency, String(input.payee || "").trim(), String(input.bank || "").trim(), String(input.account || "").trim(), String(input.qrUrl || "").trim(), String(input.instructions || "").trim(), input.enabled === undefined ? 1 : flag(input.enabled), Number(input.sort || 0), ts];
    if (!id) {
      id = uid("pay");
      this.db.prepare(`INSERT INTO payment_channels
        (id, name, currency, payee, bank, account, qr_url, instructions, enabled, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ...values);
    } else {
      if (!this.getChannel(id)) throw new OpsError("渠道不存在", 404);
      this.db.prepare(`UPDATE payment_channels SET name = ?, currency = ?, payee = ?, bank = ?, account = ?, qr_url = ?, instructions = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?`)
        .run(...values, id);
    }
    return this.getChannel(id);
  };

  OpsStore.prototype.deleteChannel = function (id) {
    if (!this.getChannel(id)) throw new OpsError("渠道不存在", 404);
    this.db.prepare("DELETE FROM payment_channels WHERE id = ?").run(id);
    return { deleted: true, id: id };
  };

  OpsStore.prototype.mapAnnouncement = function (row) {
    return {
      id: row.id,
      title: row.title,
      body: row.body || "",
      audience: row.audience,
      pinned: !!row.pinned,
      scrolling: !!row.scrolling,
      forcePopup: !!row.force_popup,
      enabled: !!row.enabled,
      sort: Number(row.sort_order || 0),
      startsAt: row.starts_at || "",
      endsAt: row.ends_at || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  };

  OpsStore.prototype.listAnnouncements = function () {
    return this.db.prepare("SELECT * FROM announcements ORDER BY pinned DESC, sort_order ASC, created_at DESC").all().map((row) => this.mapAnnouncement(row));
  };

  OpsStore.prototype.publicAnnouncements = function (audience) {
    const nowIso = now();
    return this.listAnnouncements().filter((item) => {
      if (!item.enabled) return false;
      if (item.audience !== "all" && item.audience !== audience) return false;
      if (item.startsAt && item.startsAt > nowIso) return false;
      if (item.endsAt && item.endsAt < nowIso) return false;
      return true;
    });
  };

  OpsStore.prototype.saveAnnouncement = function (input, id) {
    const title = String(input.title || "").trim();
    const audience = String(input.audience || "home");
    if (!title) throw new OpsError("请填写公告标题");
    if (AUDIENCES.indexOf(audience) < 0) throw new OpsError("公告分类不正确");
    const ts = now();
    const values = [title, String(input.body || "").trim(), audience, flag(input.pinned), flag(input.scrolling), flag(input.forcePopup), input.enabled === undefined ? 1 : flag(input.enabled), Number(input.sort || 0), String(input.startsAt || ""), String(input.endsAt || ""), ts];
    if (!id) {
      id = uid("ann");
      this.db.prepare(`INSERT INTO announcements
        (id, title, body, audience, pinned, scrolling, force_popup, enabled, sort_order, starts_at, ends_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ...values, ts);
    } else {
      const current = this.db.prepare("SELECT id FROM announcements WHERE id = ?").get(id);
      if (!current) throw new OpsError("公告不存在", 404);
      this.db.prepare(`UPDATE announcements SET title = ?, body = ?, audience = ?, pinned = ?, scrolling = ?, force_popup = ?, enabled = ?, sort_order = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`)
        .run(...values, id);
    }
    return this.mapAnnouncement(this.db.prepare("SELECT * FROM announcements WHERE id = ?").get(id));
  };

  OpsStore.prototype.deleteAnnouncement = function (id) {
    const current = this.db.prepare("SELECT id FROM announcements WHERE id = ?").get(id);
    if (!current) throw new OpsError("公告不存在", 404);
    this.db.prepare("DELETE FROM announcements WHERE id = ?").run(id);
    return { deleted: true, id: id };
  };

  OpsStore.prototype.depositConfig = function () {
    const settings = this.getSettings();
    return {
      myr: settings.depositMyr,
      cny: settings.depositCny,
      channels: this.listChannels(true),
      wallet: { id: "wallet", name: "猫粮余额", currency: "MYR", kind: "wallet" }
    };
  };

  OpsStore.prototype.createDeposit = function (input) {
    const channel = this.getChannel(input.channelId);
    if (!channel || !channel.enabled) throw new OpsError("请选择已启用的押金渠道");
    const settings = this.getSettings();
    const amount = channel.currency === "CNY" ? settings.depositCny : settings.depositMyr;
    const id = uid("dep");
    const ts = now();
    this.db.prepare(`INSERT INTO deposit_submissions
      (id, companion_id, applicant_name, channel_id, currency, amount, proof, status, channel_snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(
      id, String(input.companionId || ""), String(input.applicantName || "").trim(), channel.id, channel.currency, amount,
      String(input.proof || "").trim(), JSON.stringify(channel), ts, ts
    );
    return this.mapDeposit(this.db.prepare("SELECT * FROM deposit_submissions WHERE id = ?").get(id));
  };

  OpsStore.prototype.mapDeposit = function (row) {
    return {
      id: row.id,
      companionId: row.companion_id,
      applicantName: row.applicant_name,
      channelId: row.channel_id,
      currency: row.currency,
      amount: Number(row.amount),
      proof: row.proof || "",
      status: row.status,
      reviewNote: row.review_note || "",
      channelSnapshot: parseJson(row.channel_snapshot_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  };

  OpsStore.prototype.listDeposits = function () {
    return this.db.prepare("SELECT * FROM deposit_submissions ORDER BY created_at DESC").all().map((row) => this.mapDeposit(row));
  };

  OpsStore.prototype.reviewDeposit = function (id, input) {
    const row = this.db.prepare("SELECT * FROM deposit_submissions WHERE id = ?").get(id);
    if (!row) throw new OpsError("押金申请不存在", 404);
    if (row.status !== "pending") throw new OpsError("这张押金申请已经审核过");
    const status = String(input.status || "");
    if (["approved", "rejected"].indexOf(status) < 0) throw new OpsError("审核结果不正确");
    if (status === "rejected" && !String(input.reason || "").trim()) throw new OpsError("拒绝时需要填写原因");
    this.db.prepare("UPDATE deposit_submissions SET status = ?, review_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, String(input.reason || "").trim(), now(), id);
    return this.mapDeposit(this.db.prepare("SELECT * FROM deposit_submissions WHERE id = ?").get(id));
  };

  OpsStore.prototype.chatActor = function (headers, body) {
    const role = String(headers["x-ops-role"] || "");
    const id = String(headers["x-ops-actor-id"] || body.actorId || "");
    let name = String(headers["x-ops-actor-name"] || body.actorName || "");
    try { name = decodeURIComponent(name); } catch (e) { name = String(headers["x-ops-actor-name"] || ""); }
    if (["boss", "service", "admin"].indexOf(role) < 0) throw new OpsError("需要老板、客服或管理员身份", 403);
    if (!id) throw new OpsError("缺少会话身份");
    return { role: role, id: id, name: name || role };
  };

  OpsStore.prototype.openChat = function (actor, input) {
    const bossId = actor.role === "boss" ? actor.id : String(input.bossId || "");
    const bossName = actor.role === "boss" ? (actor.name || "老板") : String(input.bossName || "老板");
    if (!bossId) throw new OpsError("请指定老板");
    const existing = this.db.prepare("SELECT * FROM chat_threads WHERE boss_id = ? AND status = 'open' ORDER BY updated_at DESC").get(bossId);
    if (existing) return this.chatThread(existing.id, false);
    const id = uid("chat");
    const ts = now();
    this.db.prepare("INSERT INTO chat_threads (id, boss_id, boss_name, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)").run(id, bossId, bossName, ts, ts);
    return this.chatThread(id, false);
  };

  OpsStore.prototype.listChats = function (actor) {
    const rows = actor.role === "boss"
      ? this.db.prepare("SELECT * FROM chat_threads WHERE boss_id = ? ORDER BY updated_at DESC").all(actor.id)
      : this.db.prepare("SELECT * FROM chat_threads ORDER BY updated_at DESC").all();
    return rows.map((row) => {
      const last = this.db.prepare("SELECT body, sender_role, created_at FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1").get(row.id);
      return { id: row.id, bossId: row.boss_id, bossName: row.boss_name, status: row.status, assigneeName: row.assignee_name || "", updatedAt: row.updated_at, lastMessage: last ? last.body : "", lastRole: last ? last.sender_role : "" };
    });
  };

  OpsStore.prototype.chatThread = function (id, withMessages) {
    const row = this.db.prepare("SELECT * FROM chat_threads WHERE id = ?").get(id);
    if (!row) throw new OpsError("会话不存在", 404);
    const thread = { id: row.id, bossId: row.boss_id, bossName: row.boss_name, status: row.status, assigneeName: row.assignee_name || "", updatedAt: row.updated_at };
    if (!withMessages) return thread;
    thread.messages = this.db.prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC").all(id).map((item) => ({
      id: item.id, clientId: item.client_id || "", senderRole: item.sender_role, senderName: item.sender_name, body: item.body, createdAt: item.created_at
    }));
    return thread;
  };

  OpsStore.prototype.readChat = function (id, actor) {
    const thread = this.chatThread(id, true);
    if (actor.role === "boss" && thread.bossId !== actor.id) throw new OpsError("不能查看别人的会话", 403);
    return thread;
  };

  OpsStore.prototype.sendChat = function (id, actor, input) {
    const thread = this.chatThread(id, false);
    if (thread.status !== "open") throw new OpsError("会话已结束");
    if (actor.role === "boss" && thread.bossId !== actor.id) throw new OpsError("不能向别人的会话发消息", 403);
    const body = String(input.body || "").trim();
    if (!body) throw new OpsError("请输入消息");
    const clientId = String(input.clientId || "").trim();
    if (clientId) {
      const existing = this.db.prepare("SELECT * FROM chat_messages WHERE client_id = ?").get(clientId);
      if (existing) return { id: existing.id, duplicate: true };
    }
    const messageId = uid("msg");
    const ts = now();
    this.db.prepare("INSERT INTO chat_messages (id, thread_id, client_id, sender_role, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(messageId, id, clientId || null, actor.role, actor.name, body, ts);
    const assignee = actor.role === "service" ? actor.name : thread.assigneeName;
    this.db.prepare("UPDATE chat_threads SET updated_at = ?, assignee_name = ? WHERE id = ?").run(ts, assignee || "", id);
    return { id: messageId, duplicate: false, createdAt: ts };
  };

  OpsStore.prototype.closeChat = function (id, actor) {
    const thread = this.chatThread(id, false);
    if (actor.role === "boss" && thread.bossId !== actor.id) throw new OpsError("不能结束别人的会话", 403);
    this.db.prepare("UPDATE chat_threads SET status = 'closed', updated_at = ? WHERE id = ?").run(now(), id);
    return this.chatThread(id, false);
  };

  OpsStore.prototype.claimChat = function (id, actor, force) {
    if (actor.role !== "service" && actor.role !== "admin") throw new OpsError("需要客服身份", 403);
    const thread = this.chatThread(id, false);
    if (thread.status !== "open") throw new OpsError("会话已结束");
    if (thread.assigneeName && thread.assigneeName !== actor.name && !force) throw new OpsError("该会话正在由客服 " + thread.assigneeName + " 接待");
    this.db.prepare("UPDATE chat_threads SET assignee_name = ?, updated_at = ? WHERE id = ?").run(actor.name, now(), id);
    return this.chatThread(id, false);
  };

  OpsStore.prototype.releaseChat = function (id, actor) {
    if (actor.role !== "service" && actor.role !== "admin") throw new OpsError("需要客服身份", 403);
    this.chatThread(id, false);
    this.db.prepare("UPDATE chat_threads SET assignee_name = '', updated_at = ? WHERE id = ?").run(now(), id);
    return this.chatThread(id, false);
  };

  OpsStore.prototype.reopenChat = function (id, actor) {
    if (actor.role !== "service" && actor.role !== "admin") throw new OpsError("需要客服身份", 403);
    this.chatThread(id, false);
    this.db.prepare("UPDATE chat_threads SET status = 'open', updated_at = ? WHERE id = ?").run(now(), id);
    return this.chatThread(id, false);
  };
}
