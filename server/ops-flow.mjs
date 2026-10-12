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
    const id = String(headers["x-ops-actor-id"] || headers["x-ops-companion-id"] || headers["x-ops-boss-id"] || body.actorId || "");
    let name = String(headers["x-ops-actor-name"] || body.actorName || "");
    try { name = decodeURIComponent(name); } catch (e) { name = String(headers["x-ops-actor-name"] || ""); }
    if (["boss", "service", "admin", "companion"].indexOf(role) < 0) throw new OpsError("需要老板、陪玩、客服或管理员身份", 403);
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
      : actor.role === "companion"
        ? this.db.prepare("SELECT * FROM chat_threads WHERE target_role = 'companion' AND target_id = ? ORDER BY updated_at DESC").all(actor.id)
        : this.db.prepare("SELECT * FROM chat_threads ORDER BY updated_at DESC").all();
    return rows.map((row) => {
      const last = this.db.prepare("SELECT body, sender_role, created_at FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1").get(row.id);
      return { id: row.id, bossId: row.boss_id, bossName: row.boss_name, status: row.status, assigneeName: row.assignee_name || "", updatedAt: row.updated_at, lastMessage: last ? last.body : "", lastRole: last ? last.sender_role : "" };
    });
  };

  OpsStore.prototype.chatThread = function (id, withMessages) {
    const row = this.db.prepare("SELECT * FROM chat_threads WHERE id = ?").get(id);
    if (!row) throw new OpsError("会话不存在", 404);
    const thread = { id: row.id, bossId: row.boss_id, bossName: row.boss_name, status: row.status, assigneeName: row.assignee_name || "", targetRole: row.target_role || "boss", targetId: row.target_id || "", updatedAt: row.updated_at };
    if (!withMessages) return thread;
    thread.messages = this.db.prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC").all(id).map((item) => {
      const payload = parseJson(item.payload_json, null);
      const message = { id: item.id, clientId: item.client_id || "", senderRole: item.sender_role, senderName: item.sender_name, body: item.body, kind: item.kind || "text", createdAt: item.created_at };
      if (payload) {
        message.card = payload;
        message.card.available = this.cardStillOpen(payload);
      }
      return message;
    });
    return thread;
  };

  OpsStore.prototype.readChat = function (id, actor) {
    const thread = this.chatThread(id, true);
    if (actor.role === "boss" && thread.bossId !== actor.id) throw new OpsError("不能查看别人的会话", 403);
    if (actor.role === "companion" && thread.targetId !== actor.id) throw new OpsError("不能查看别人的会话", 403);
    return thread;
  };

  OpsStore.prototype.sendChat = function (id, actor, input) {
    const thread = this.chatThread(id, false);
    if (thread.status !== "open") throw new OpsError("会话已结束");
    if (actor.role === "boss" && thread.bossId !== actor.id) throw new OpsError("不能向别人的会话发消息", 403);
    if (actor.role === "companion" && thread.targetId !== actor.id) throw new OpsError("不能向别人的会话发消息", 403);
    const kind = input.kind === "card" ? "card" : "text";
    let body = String(input.body || "").trim();
    let payload = "";
    if (kind === "card") {
      if (actor.role !== "service" && actor.role !== "admin") throw new OpsError("只有客服可以发送陪玩卡片", 403);
      const card = this.recommendSnapshot(input.companionId, input.serviceId);
      body = card.companionName + " · " + card.serviceName;
      payload = JSON.stringify(card);
    }
    if (!body) throw new OpsError("请输入消息");
    const clientId = String(input.clientId || "").trim();
    if (clientId) {
      const existing = this.db.prepare("SELECT * FROM chat_messages WHERE client_id = ?").get(clientId);
      if (existing) return { id: existing.id, duplicate: true };
    }
    const messageId = uid("msg");
    const ts = now();
    this.db.prepare("INSERT INTO chat_messages (id, thread_id, client_id, sender_role, sender_name, body, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(messageId, id, clientId || null, actor.role, actor.name, body, kind, payload, ts);
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

  const GIFTS = [{ name: "玫瑰", price: 8 }, { name: "奶茶", price: 18 }, { name: "粉色火箭", price: 66 }];

  OpsStore.prototype.cardStillOpen = function (card) {
    if (!card) return false;
    const service = this.getService(card.serviceId);
    const offering = service && this.getOffering(card.companionId, card.serviceId);
    return !!(service && service.enabled && offering && offering.acceptOrders && this.quoteIsValid(service, offering.quotePrice));
  };

  OpsStore.prototype.recommendSnapshot = function (companionId, serviceId) {
    const service = this.getService(serviceId);
    const companion = this.getCompanion(companionId);
    if (!service || !service.enabled) throw new OpsError("这个服务已经关闭，不能推荐");
    if (!companion || companion.status !== "active") throw new OpsError("这位陪玩当前不可推荐");
    const offering = this.getOffering(companion.id, service.id);
    if (!offering || !offering.acceptOrders || !this.quoteIsValid(service, offering.quotePrice)) throw new OpsError("这位陪玩没有在接这个服务");
    const badges = this.listBadges(companion.id).filter((item) => item.active).map((item) => item.game || item.name || "认证");
    return {
      companionId: companion.id,
      companionName: companion.name,
      avatar: companion.avatar || "",
      game: companion.game || "",
      serviceId: service.id,
      serviceName: service.name,
      unit: service.unit,
      priceText: "RM" + Number(offering.quotePrice).toFixed(2) + " / " + service.unit,
      acceptOrders: true,
      badges: badges,
      href: "boss-order.html?service=" + encodeURIComponent(service.id) + "&companion=" + encodeURIComponent(companion.id)
    };
  };

  OpsStore.prototype.searchRecommend = function (query) {
    const q = String(query || "").trim().toLowerCase();
    const rows = [];
    this.listServices().filter((service) => service.enabled).forEach((service) => {
      this.orderableCompanions(service).forEach((companion) => {
        const blob = (companion.name + " " + companion.id + " " + service.name + " " + (companion.game || "")).toLowerCase();
        if (q && blob.indexOf(q) < 0) return;
        rows.push(this.recommendSnapshot(companion.id, service.id));
      });
    });
    return rows.slice(0, 12);
  };

  OpsStore.prototype.notify = function (input) {
    const key = String(input.dedupeKey || "").trim();
    if (key) {
      const existing = this.db.prepare("SELECT * FROM inbox_notifications WHERE dedupe_key = ?").get(key);
      if (existing) return { id: existing.id, duplicate: true };
    }
    const id = uid("ntf");
    this.db.prepare("INSERT INTO inbox_notifications (id, audience, actor_id, dedupe_key, title, body, href, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, String(input.audience || "admin"), String(input.actorId || ""), key || null, String(input.title || "通知"), String(input.body || ""), String(input.href || ""), now());
    this.queuePush(input.audience === "companion" ? "companion" : input.audience === "boss" ? "boss" : "admin", input.actorId || "", input.title || "通知", input.href || "");
    return { id: id, duplicate: false };
  };

  OpsStore.prototype.queuePush = function (role, actorId, title, href) {
    this._pushQueue = this._pushQueue || [];
    this._pushQueue.push({ role: role, actorId: actorId || "", title: title, body: "你有一条新通知，打开后查看。", href: href || "" });
  };

  OpsStore.prototype.takePushQueue = function () {
    const jobs = this._pushQueue || [];
    this._pushQueue = [];
    return jobs;
  };

  OpsStore.prototype.pushSubscriptions = function (role, actorId) {
    if (actorId) return this.db.prepare("SELECT * FROM push_subscriptions WHERE role = ? AND actor_id = ?").all(role, actorId);
    return this.db.prepare("SELECT * FROM push_subscriptions WHERE role = ?").all(role);
  };

  OpsStore.prototype.listNotifications = function (actor) {
    const audience = actor.role === "companion" ? "companion" : actor.role === "boss" ? "boss" : "admin";
    const rows = this.db.prepare("SELECT * FROM inbox_notifications WHERE audience = ? AND (actor_id = '' OR actor_id = ?) ORDER BY created_at DESC LIMIT 40")
      .all(audience, actor.id);
    return rows.map((row) => ({ id: row.id, title: row.title, body: row.body, href: row.href, createdAt: row.created_at, read: !!row.read_at }));
  };

  OpsStore.prototype.markNotification = function (id, actor) {
    const row = this.db.prepare("SELECT * FROM inbox_notifications WHERE id = ?").get(id);
    if (!row) throw new OpsError("通知不存在", 404);
    this.db.prepare("UPDATE inbox_notifications SET read_at = ? WHERE id = ? AND read_at = ''").run(now(), id);
    return { id: id, read: true };
  };

  OpsStore.prototype.savePushSubscription = function (actor, input) {
    const endpoint = String(input.endpoint || "");
    if (!endpoint || !input.keys) throw new OpsError("推送订阅不完整");
    const id = uid("push");
    this.db.prepare("INSERT INTO push_subscriptions (id, role, actor_id, endpoint, p256dh, auth_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET role = excluded.role, actor_id = excluded.actor_id")
      .run(id, actor.role, actor.id, endpoint, String(input.keys.p256dh || ""), String(input.keys.auth || ""), now());
    return { saved: true };
  };

  OpsStore.prototype.forgetPush = function (actor) {
    this.db.prepare("DELETE FROM push_subscriptions WHERE role = ? AND actor_id = ?").run(actor.role, actor.id);
    return { removed: true };
  };

  OpsStore.prototype.messageCompanion = function (actor, input) {
    if (actor.role !== "service" && actor.role !== "admin") throw new OpsError("需要客服身份", 403);
    const companion = this.getCompanion(input.companionId);
    if (!companion) throw new OpsError("陪玩不存在", 404);
    const body = String(input.body || "").trim();
    if (!body) throw new OpsError("请输入消息");
    let thread = this.db.prepare("SELECT * FROM chat_threads WHERE target_role = 'companion' AND target_id = ? AND status = 'open'").get(companion.id);
    const ts = now();
    if (!thread) {
      const id = uid("chat");
      this.db.prepare("INSERT INTO chat_threads (id, boss_id, boss_name, status, target_role, target_id, created_at, updated_at) VALUES (?, '', ?, 'open', 'companion', ?, ?, ?)")
        .run(id, companion.name, companion.id, ts, ts);
      thread = { id: id };
    }
    const messageId = uid("msg");
    this.db.prepare("INSERT INTO chat_messages (id, thread_id, sender_role, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(messageId, thread.id, actor.role, actor.name, body, ts);
    this.db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(ts, thread.id);
    this.notify({ audience: "companion", actorId: companion.id, dedupeKey: "chat:" + messageId, title: "客服给你发来消息", body: "打开工作台查看", href: "companion-studio.html#messages" });
    return this.chatThread(thread.id, true);
  };

  OpsStore.prototype.chatEvents = function (actor, since) {
    const cutoff = String(since || "");
    const threads = this.listChats(actor);
    const fresh = [];
    threads.forEach((thread) => {
      const rows = this.db.prepare("SELECT id, body, sender_role, created_at FROM chat_messages WHERE thread_id = ? AND created_at > ? AND sender_role != ? ORDER BY created_at ASC")
        .all(thread.id, cutoff, actor.role);
      rows.forEach((row) => fresh.push({ id: row.id, threadId: thread.id, createdAt: row.created_at }));
    });
    return fresh;
  };

  OpsStore.prototype.openGrabs = function () {
    return this.db.prepare("SELECT * FROM grab_posts WHERE status = 'open' ORDER BY created_at DESC").all().filter((row) => {
      const service = this.getService(row.service_id);
      return service && service.enabled;
    }).map(mapGrab);
  };

  OpsStore.prototype.createGrab = function (actor, input) {
    if (actor.role !== "service" && actor.role !== "admin") throw new OpsError("需要客服身份", 403);
    const service = this.getService(input.serviceId);
    if (!service || !service.enabled) throw new OpsError("请选择已启用的服务");
    const id = uid("grab");
    this.db.prepare("INSERT INTO grab_posts (id, service_id, service_name, quantity, duration, price, requirements, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)")
      .run(id, service.id, service.name, Number(input.quantity || 1), String(input.duration || ""), Number(input.price || service.priceMin || 0), String(input.requirements || ""), actor.id, now());
    return mapGrab(this.db.prepare("SELECT * FROM grab_posts WHERE id = ?").get(id));
  };

  OpsStore.prototype.cancelGrab = function (id) {
    const changed = this.db.prepare("UPDATE grab_posts SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(id);
    if (!changed.changes) throw new OpsError("这个名额不能取消");
    return mapGrab(this.db.prepare("SELECT * FROM grab_posts WHERE id = ?").get(id));
  };

  OpsStore.prototype.claimGrab = function (id, companionId) {
    const post = this.db.prepare("SELECT * FROM grab_posts WHERE id = ?").get(id);
    const service = post && this.getService(post.service_id);
    if (!service || !service.enabled || !post || post.status !== "open") throw new OpsError("这个名额已经关闭");
    const companion = this.getCompanion(companionId);
    if (!companion || companion.status !== "active") throw new OpsError("当前不能抢单", 403);
    const changed = this.db.prepare("UPDATE grab_posts SET status = 'claimed', claimed_by = ? WHERE id = ? AND status = 'open'").run(companionId, id);
    if (!changed.changes) throw new OpsError("这个名额已经被抢走或已关闭");
    return mapGrab(this.db.prepare("SELECT * FROM grab_posts WHERE id = ?").get(id));
  };

  OpsStore.prototype.giftCatalog = function () {
    return GIFTS.map((item) => Object.assign({ currency: "MYR" }, item));
  };

  OpsStore.prototype.createGift = function (actor, input) {
    if (actor.role !== "boss") throw new OpsError("需要老板身份", 403);
    const gift = GIFTS.find((item) => item.name === input.giftName);
    if (!gift) throw new OpsError("没有这个礼物");
    const quantity = Math.round(Number(input.quantity || 1));
    if (!quantity || quantity < 1) throw new OpsError("请填写数量");
    const snapshot = this.paymentSnapshot(input);
    const id = uid("gift");
    const ts = now();
    const total = Math.round(gift.price * quantity * 100) / 100;
    this.db.prepare("INSERT INTO service_gifts (id, boss_id, boss_name, gift_name, quantity, total_amount, currency, proof, pay_snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?)")
      .run(id, actor.id, actor.name || "老板", gift.name, quantity, total, String(input.proof || ""), JSON.stringify(snapshot), ts, ts);
    return mapGift(this.db.prepare("SELECT * FROM service_gifts WHERE id = ?").get(id));
  };

  OpsStore.prototype.reviewGift = function (id, input) {
    const row = this.db.prepare("SELECT * FROM service_gifts WHERE id = ?").get(id);
    if (!row) throw new OpsError("礼物记录不存在", 404);
    if (row.status !== "pending_review") throw new OpsError("这笔礼物已经审核过");
    const status = input.result === "confirmed" ? "confirmed" : "review_failed";
    if (status !== "confirmed" && !String(input.reason || "").trim()) throw new OpsError("未通过时需要填写原因");
    const changed = this.db.prepare("UPDATE service_gifts SET status = ?, review_note = ?, updated_at = ? WHERE id = ? AND status = 'pending_review'")
      .run(status, String(input.reason || "到账已确认，分成仍按礼物抽成规则由财务处理，这里不直接发放").trim(), now(), id);
    if (!changed.changes) throw new OpsError("这笔礼物已经审核过");
    return mapGift(this.db.prepare("SELECT * FROM service_gifts WHERE id = ?").get(id));
  };

  OpsStore.prototype.listGifts = function () {
    return this.db.prepare("SELECT * FROM service_gifts ORDER BY created_at DESC").all().map(mapGift);
  };

  OpsStore.prototype.staffDiscordOrders = function () {
    return this.listOrders().filter((order) => (order.serviceSnapshot || {}).voiceMode === "discord").map((order) => ({
      id: order.id,
      bossName: order.bossName,
      status: order.status,
      serviceName: (order.serviceSnapshot || {}).name || "",
      discordId: order.discordId || "",
      discordStatus: order.discordId ? (order.discordStatus || "waiting_invite") : "need_id"
    }));
  };

  OpsStore.prototype.saveDiscord = function (actor, orderId, discordId) {
    const order = this.getOrder(orderId);
    if (!order) throw new OpsError("订单不存在", 404);
    if (actor.role !== "boss" || actor.id !== order.bossId) throw new OpsError("只能由下单老板填写", 403);
    if ((order.serviceSnapshot || {}).voiceMode !== "discord") throw new OpsError("这张订单不使用 Discord 语音房");
    if (["confirmed", "in_service", "completed"].indexOf(order.status) < 0) throw new OpsError("客服确认到账后才能填写 Discord ID");
    const value = String(discordId || "").trim();
    if (!value) throw new OpsError("请填写 Discord ID");
    this.db.prepare("UPDATE orders SET discord_id = ?, discord_status = 'waiting_invite', updated_at = ? WHERE id = ?").run(value, now(), orderId);
    this.notify({ audience: "admin", dedupeKey: "discord:" + orderId, title: "老板已填写 Discord ID", body: order.bossName + " · " + orderId, href: "admin.html#ops-orders" });
    return this.getOrder(orderId);
  };

  OpsStore.prototype.setDiscordStatus = function (orderId, status) {
    if (["waiting_invite", "arranged"].indexOf(status) < 0) throw new OpsError("状态不正确");
    const order = this.getOrder(orderId);
    if (!order || !order.discordId) throw new OpsError("还没有 Discord ID");
    this.db.prepare("UPDATE orders SET discord_status = ?, updated_at = ? WHERE id = ?").run(status, now(), orderId);
    return this.getOrder(orderId);
  };

  OpsStore.prototype.dailyAdmin = function () {
    const day = now().slice(0, 10);
    const orders = this.listOrders().filter((order) => String(order.createdAt || "").slice(0, 10) === day);
    const paid = orders.filter((order) => ["confirmed", "in_service", "completed"].indexOf(order.status) >= 0);
    const amount = paid.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
    return {
      date: day,
      orders: orders.length,
      turnover: Math.round(amount * 100) / 100,
      pendingPayments: orders.filter((order) => order.status === "pending_review").length,
      applications: this.listNotifications({ role: "admin", id: "admin" }).filter((item) => item.title.indexOf("陪玩申请") >= 0 && String(item.createdAt || item.href || "").length >= 0 && !item.read).length,
      onlineCompanions: this.db.prepare("SELECT COUNT(*) AS n FROM companions WHERE last_seen_at >= ?").get(new Date(Date.now() - 20 * 60000).toISOString()).n,
      pendingChats: this.db.prepare("SELECT COUNT(*) AS n FROM chat_threads WHERE status = 'open' AND assignee_name = ''").get().n
    };
  };

  OpsStore.prototype.dailyCompanion = function (companionId) {
    const day = now().slice(0, 10);
    const orders = this.db.prepare("SELECT * FROM orders WHERE companion_id = ?").all(companionId).map((row) => this.mapOrder(row));
    const today = orders.filter((order) => String(order.createdAt || "").slice(0, 10) === day && order.status === "completed");
    const income = today.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
    const pending = orders.filter((order) => order.status === "pending_accept").length;
    const unread = this.listNotifications({ role: "companion", id: companionId }).filter((item) => !item.read).length;
    const accepting = this.listOfferings(companionId).some((item) => item.acceptOrders);
    return { date: day, orders: today.length, income: Math.round(income * 100) / 100, pending: pending, unread: unread, accepting: accepting };
  };

  OpsStore.prototype.saveQuietHours = function (companionId, input) {
    this.db.prepare("UPDATE companions SET quiet_start = ?, quiet_end = ?, reminder_opt_in = ? WHERE id = ?")
      .run(String(input.quietStart || ""), String(input.quietEnd || ""), input.optIn === false ? 0 : 1, companionId);
    return { saved: true };
  };

  OpsStore.prototype.tickReminders = function () {
    if (this.setting("status_reminder_enabled") === "0") return [];
    const sent = [];
    const companions = this.db.prepare("SELECT * FROM companions WHERE status = 'active' AND reminder_opt_in = 1").all();
    const nowMs = Date.now();
    companions.forEach((row) => {
      const offerings = this.listOfferings(row.id);
      if (!offerings.some((item) => item.acceptOrders)) return;
      const seen = Date.parse(row.last_seen_at || "") || 0;
      if (!seen || nowMs - seen > 20 * 60000) return;
      if (inQuietHours(row.quiet_start, row.quiet_end, new Date())) return;
      const last = Date.parse(row.last_reminder_at || "") || 0;
      if (nowMs - last < 3 * 60 * 60000) return;
      const bucket = Math.floor(nowMs / (3 * 60 * 60000));
      const note = this.notify({
        audience: "companion",
        actorId: row.id,
        dedupeKey: "reminder:" + row.id + ":" + bucket,
        title: "喵～记得确认你的接单状态哦！",
        body: "避免老板下单时找不到你 🐱💕",
        href: "companion-studio.html"
      });
      if (!note.duplicate) {
        this.db.prepare("UPDATE companions SET last_reminder_at = ? WHERE id = ?").run(now(), row.id);
        sent.push(row.id);
      }
    });
    return sent;
  };

  OpsStore.prototype.submitCompanionApplication = function (input) {
    const nickname = String(input.nickname || "").trim();
    const applicantId = String(input.applicantId || "").trim();
    if (!nickname || !applicantId) throw new OpsError("请填写申请人");
    return this.notify({
      audience: "admin",
      dedupeKey: "apply:" + applicantId,
      title: "新的陪玩申请",
      body: nickname + " · " + applicantId + " · " + now(),
      href: "admin.html#ops-companions"
    });
  };

  function mapGrab(row) {
    return { id: row.id, serviceId: row.service_id, serviceName: row.service_name, quantity: Number(row.quantity), duration: row.duration, price: Number(row.price), requirements: row.requirements, status: row.status, claimedBy: row.claimed_by || "", createdAt: row.created_at };
  }

  function mapGift(row) {
    return { id: row.id, bossId: row.boss_id, bossName: row.boss_name, giftName: row.gift_name, quantity: Number(row.quantity), totalAmount: Number(row.total_amount), currency: row.currency, status: row.status, proof: row.proof, paySnapshot: parseJson(row.pay_snapshot_json, {}), reviewNote: row.review_note, createdAt: row.created_at };
  }

  function inQuietHours(start, end, date) {
    if (!start || !end) return false;
    const toMin = (value) => {
      const parts = String(value).split(":");
      return Number(parts[0]) * 60 + Number(parts[1] || 0);
    };
    const nowMin = date.getHours() * 60 + date.getMinutes();
    const a = toMin(start);
    const b = toMin(end);
    if (a === b) return false;
    if (a < b) return nowMin >= a && nowMin < b;
    return nowMin >= a || nowMin < b;
  }
}
