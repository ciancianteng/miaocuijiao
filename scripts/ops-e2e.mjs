const base = process.env.OPS_BASE || "http://127.0.0.1:5173";
const results = [];

function record(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail || "" });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  " + detail : ""));
}

async function api(path, options) {
  options = options || {};
  const headers = { "Content-Type": "application/json" };
  if (options.role) headers["x-ops-role"] = options.role;
  if (options.companionId) headers["x-ops-companion-id"] = options.companionId;
  if (options.bossId) headers["x-ops-boss-id"] = options.bossId;
  if (options.actorId) headers["x-ops-actor-id"] = options.actorId;
  if (options.actorName) headers["x-ops-actor-name"] = encodeURIComponent(options.actorName);
  const response = await fetch(base + "/api/ops" + path, {
    method: options.method || "GET",
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const json = await response.json();
  return { status: response.status, json: json, text: JSON.stringify(json) };
}

function assert(name, condition, detail) {
  record(name, condition, detail);
  if (!condition) throw new Error(name + (detail ? ": " + detail : ""));
}

const secretApex = "wx_apex_secret_9f3";
const secretVal = "wx_val_visible_1a2";
const secretLol = "wx_lol_visible_3c4";
const secretCs = "wx_cs2_secret_5d6";
const hiddenNote = "仅老板可见备注内容";

async function main() {
  const health = await api("/health");
  assert("数据库接口可访问", health.json.ok === true && health.json.data.database === "sqlite");

  const reset = await api("/admin/reset", { method: "POST", role: "admin", body: { confirm: "RESET" } });
  assert("测试前清空数据库", reset.json.ok === true);

  const denied = await api("/admin/snapshot");
  assert("未带管理员身份不能读取后台", denied.status === 403);

  const valorant = await api("/admin/services", {
    method: "POST", role: "admin",
    body: { name: "VALORANT 双排陪玩", description: "双排沟通与报点", priceMin: 15, priceMax: 40, unit: "每小时", enabled: true, sort: 1 }
  });
  const voice = await api("/admin/services", {
    method: "POST", role: "admin",
    body: { name: "语音陪聊", description: "语音陪伴", priceMin: 10, priceMax: 25, unit: "每单", enabled: true, sort: 2 }
  });
  const apex = await api("/admin/services", {
    method: "POST", role: "admin",
    body: { name: "APEX 排位", description: "已关闭的服务", priceMin: 20, priceMax: 50, unit: "每局", enabled: false, sort: 3 }
  });
  assert("创建三项服务", valorant.json.ok && voice.json.ok && apex.json.ok);
  const valorantId = valorant.json.data.id;
  const voiceId = voice.json.data.id;
  const apexId = apex.json.data.id;

  const badPrice = await api("/admin/services/" + valorantId, {
    method: "PATCH", role: "admin",
    body: { name: "VALORANT 双排陪玩", description: "双排沟通与报点", priceMin: 50, priceMax: 10, unit: "每小时", enabled: true }
  });
  assert("最低价高于最高价会被拒绝", badPrice.status === 400);

  const fields = await api("/admin/services/" + valorantId + "/fields", {
    method: "PUT", role: "admin",
    body: {
      fields: [
        { id: "new_game", label: "游戏 ID", type: "text", required: true, showBoss: true, showCompanion: true, showOrderDetail: true, sort: 0 },
        { id: "new_rank", label: "当前段位", type: "select", options: ["黄金", "钻石", "超凡"], required: true, showBoss: true, showCompanion: true, showOrderDetail: true, sort: 1 },
        { id: "new_mode", label: "游戏模式", type: "checkbox", options: ["排位", "娱乐"], required: true, showBoss: true, showCompanion: true, showOrderDetail: true, sort: 2 },
        { id: "new_voice", label: "语音偏好", type: "radio", options: ["开麦", "闭麦"], required: true, showBoss: true, showCompanion: true, showOrderDetail: true, sort: 3 },
        { id: "new_rounds", label: "预计局数", type: "number", required: false, showBoss: true, showCompanion: true, showOrderDetail: true, sort: 4 },
        { id: "new_note", label: "补充说明", type: "textarea", required: false, showBoss: true, showCompanion: true, showOrderDetail: true, sort: 5 },
        { id: "new_hidden", label: "内部备注", type: "text", required: false, showBoss: true, showCompanion: false, showOrderDetail: true, sort: 6 }
      ]
    }
  });
  assert("保存七种订单要求字段", fields.json.ok && fields.json.data.length === 7);
  const fieldByLabel = {};
  fields.json.data.forEach(function (field) { fieldByLabel[field.label] = field; });

  const companion = await api("/companion/profile", {
    method: "POST", role: "companion",
    body: { name: "星野", game: "VALORANT", bio: "报点清楚，沟通稳定", avatar: "assets/meow-cuijiao-brand.jpg", status: "active" }
  });
  assert("陪玩建立资料", companion.json.ok === true);
  const companionId = companion.json.data.id;

  const lowQuote = await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 5, showOnCard: true, showPrice: true, acceptOrders: true }
  });
  assert("低于最低价的报价被拒绝", lowQuote.status === 400 && lowQuote.text.indexOf("RM-") < 0);

  const offer = await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: {
      companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点",
      showOnCard: true, showPrice: true, showIntro: true, showBadge: true, acceptOrders: true
    }
  });
  const voiceOffer = await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: {
      companionId: companionId, serviceId: voiceId, quotePrice: 18, intro: "轻松聊天",
      showOnCard: true, showPrice: true, showIntro: true, showBadge: false, acceptOrders: true
    }
  });
  assert("陪玩报价和展示开关已保存", offer.json.ok && voiceOffer.json.ok && offer.json.data.quotePrice === 22);

  const catalog = await api("/boss/catalog");
  const catalogText = catalog.text;
  assert("老板端能看到启用服务", catalog.json.data.services.some(function (item) { return item.id === valorantId && item.name === "VALORANT 双排陪玩"; }));
  assert("已关闭服务不会出现在老板端", !catalog.json.data.services.some(function (item) { return item.id === apexId; }));
  assert("老板端显示陪玩实际单价", catalog.json.data.services.find(function (item) { return item.id === valorantId; }).companions[0].priceText === "RM22.00 / 每小时");
  assert("老板目录不包含 RM-", catalogText.indexOf("RM-") < 0);
  assert("老板目录不泄露考官联系方式", catalogText.indexOf(secretApex) < 0 && catalogText.indexOf("wechat") < 0);

  const answers = {};
  answers[fieldByLabel["游戏 ID"].id] = "MCJ-ID-88";
  answers[fieldByLabel["当前段位"].id] = "钻石";
  answers[fieldByLabel["游戏模式"].id] = ["排位", "娱乐"];
  answers[fieldByLabel["语音偏好"].id] = "开麦";
  answers[fieldByLabel["预计局数"].id] = 3;
  answers[fieldByLabel["补充说明"].id] = "希望节奏轻松";
  answers[fieldByLabel["内部备注"].id] = hiddenNote;
  const order = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: valorantId, companionId: companionId, quantity: 2, answers: answers }
  });
  assert("老板下单成功并计算总价", order.json.ok && order.json.data.status === "pending_accept" && order.json.data.unitPrice === 22 && order.json.data.totalPrice === 44);
  const orderId = order.json.data.id;

  const renamed = await api("/admin/services/" + valorantId, {
    method: "PATCH", role: "admin",
    body: { name: "VALORANT 双排进阶", description: "更新后的双排说明", priceMin: 30, priceMax: 60, unit: "每小时", enabled: true, sort: 1 }
  });
  assert("后台可以修改服务名称和价格", renamed.json.ok && renamed.json.data.name === "VALORANT 双排进阶");
  const after = await api("/admin/snapshot", { role: "admin" });
  const stored = after.json.data.orders.find(function (item) { return item.id === orderId; });
  assert("旧订单保留原名称和原单价", stored.serviceSnapshot.name === "VALORANT 双排陪玩" && stored.unitPrice === 22 && stored.totalPrice === 44);
  const catalogAfter = await api("/boss/catalog");
  const updatedService = catalogAfter.json.data.services.find(function (item) { return item.id === valorantId; });
  assert("老板端同步新服务名称", updatedService.name === "VALORANT 双排进阶");
  assert("报价超出新范围后不能继续下单", updatedService.companions.length === 0);
  const blocked = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossName: "阿凯", serviceId: valorantId, companionId: companionId, quantity: 1, answers: answers }
  });
  assert("超范围报价不能创建新订单", blocked.status === 400);

  await api("/admin/services/" + valorantId, {
    method: "PATCH", role: "admin",
    body: { name: "VALORANT 双排进阶", description: "更新后的双排说明", priceMin: 15, priceMax: 40, unit: "每小时", enabled: true, sort: 1 }
  });
  const companionView = await api("/companion/snapshot?companionId=" + encodeURIComponent(companionId), { role: "companion", companionId: companionId });
  assert("陪玩端同步新服务名称", companionView.json.data.services.some(function (item) { return item.id === valorantId && item.name === "VALORANT 双排进阶"; }));
  const seenOrder = companionView.json.data.orders.find(function (item) { return item.id === orderId; });
  assert("陪玩能看到老板填写的要求", seenOrder.requirements.some(function (item) { return item.label === "游戏 ID" && item.value === "MCJ-ID-88"; }));
  assert("不对陪玩展示的字段不会返回", companionView.text.indexOf(hiddenNote) < 0);

  await api("/admin/examiners", { method: "POST", role: "admin", body: { name: "考官林", game: "VALORANT", wechat: secretVal, whatsapp: "wa-val", qq: "qq-val", telegram: "tg-val", examNote: "请准备两段对枪录像", enabled: true } });
  await api("/admin/examiners", { method: "POST", role: "admin", body: { name: "考官周", game: "APEX", wechat: secretApex, examNote: "APEX 考核", enabled: true } });
  await api("/admin/examiners", { method: "POST", role: "admin", body: { name: "考官陈", game: "LOL", wechat: secretLol, examNote: "LOL 考核", enabled: true } });
  await api("/admin/examiners", { method: "POST", role: "admin", body: { name: "考官吴", game: "CS2", wechat: secretCs, examNote: "CS2 考核", enabled: true } });

  async function apply(game, item, level) {
    return api("/companion/cert-applications", {
      method: "POST", role: "companion", companionId: companionId,
      body: { companionId: companionId, game: game, certItem: item, techLevel: level, examNote: level + " 考核备注", description: "申请说明", proof: "" }
    });
  }
  const valApp = await apply("VALORANT", "枪法认证", "王牌");
  const apexApp = await apply("APEX", "意识认证", "大师");
  const lolApp = await apply("LOL", "指挥认证", "钻石");
  const csApp = await apply("CS2", "道具认证", "精英");
  assert("四份认证申请已提交", valApp.json.ok && apexApp.json.ok && lolApp.json.ok && csApp.json.ok);

  const before = await api("/companion/snapshot?companionId=" + encodeURIComponent(companionId), { role: "companion", companionId: companionId });
  assert("未审核时接口不返回任何考官联系方式", before.json.data.examiners.length === 0 && before.text.indexOf(secretApex) < 0 && before.text.indexOf(secretVal) < 0);

  async function review(id, action, reason) {
    return api("/admin/cert/" + id + "/review", { method: "POST", role: "admin", body: { action: action, reason: reason || "" } });
  }
  const approved = await review(valApp.json.data.id, "approve");
  assert("审核通过申请", approved.json.ok && approved.json.data.application.status === "approved");
  const passed = await review(valApp.json.data.id, "exam_pass");
  assert("考核通过后发放徽章", passed.json.ok && passed.json.data.badges.some(function (badge) { return badge.applicationId === valApp.json.data.id && badge.active; }));
  await review(lolApp.json.data.id, "approve");
  const failed = await review(lolApp.json.data.id, "exam_fail", "实战指挥不稳定");
  assert("考核不通过不发放徽章", failed.json.ok && !failed.json.data.badges.some(function (badge) { return badge.applicationId === lolApp.json.data.id; }));
  await review(csApp.json.data.id, "approve");
  await review(csApp.json.data.id, "exam_pass");
  const revoked = await review(csApp.json.data.id, "revoke_badge", "复核未通过");
  assert("撤销后徽章不再有效", revoked.json.ok && !revoked.json.data.badges.some(function (badge) { return badge.applicationId === csApp.json.data.id && badge.active; }));

  const visible = await api("/companion/snapshot?companionId=" + encodeURIComponent(companionId), { role: "companion", companionId: companionId });
  assert("审核通过后可以看到对应考官", visible.text.indexOf(secretVal) >= 0 && visible.json.data.examiners.some(function (item) { return item.game === "VALORANT"; }));
  assert("未通过的 APEX 考官联系方式仍然不可见", visible.text.indexOf(secretApex) < 0);
  const card = await api("/public/cards/" + encodeURIComponent(companionId));
  assert("公开卡片展示有效徽章", (card.json.data.badges || []).some(function (badge) { return badge.game === "VALORANT"; }));
  assert("公开卡片不展示已撤销和未通过的徽章", !(card.json.data.badges || []).some(function (badge) { return badge.game === "CS2" || badge.game === "LOL"; }));
  assert("公开卡片不包含考官联系方式", card.text.indexOf(secretVal) < 0 && card.text.indexOf(secretApex) < 0 && card.text.indexOf("wechat") < 0);
  assert("公开卡片展示实际单价", (card.json.data.services || []).some(function (service) { return service.priceText === "RM22.00 / 每小时"; }));

  const hiddenPrice = await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点", showOnCard: true, showPrice: false, showIntro: true, showBadge: true, acceptOrders: true }
  });
  const hiddenCard = await api("/public/cards/" + encodeURIComponent(companionId));
  const hiddenService = hiddenCard.json.data.services.find(function (service) { return service.serviceId === valorantId; });
  assert("取消展示价格后个人卡片不显示单价", hiddenPrice.json.ok && hiddenService && hiddenService.priceText === "");
  await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点", showOnCard: true, showPrice: true, showIntro: true, showBadge: true, acceptOrders: true }
  });

  await api("/admin/settings", { method: "PUT", role: "admin", body: { allowShowIntro: false, allowShowOnCard: true, allowShowPrice: true, allowShowBadge: true, allowAcceptOrders: true, units: ["每小时", "每局", "每单"] } });
  const locked = await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "试图修改介绍", showOnCard: true, showPrice: true, showIntro: false, showBadge: true, acceptOrders: true }
  });
  assert("管理员锁定的展示项不能被陪玩修改", locked.status === 403);
  await api("/admin/settings", { method: "PUT", role: "admin", body: { allowShowIntro: true, allowShowOnCard: true, allowShowPrice: true, allowShowBadge: true, allowAcceptOrders: true, units: ["每小时", "每局", "每单"] } });

  const closed = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossName: "阿凯", serviceId: apexId, companionId: companionId, quantity: 1, answers: {} }
  });
  assert("关闭的服务不能创建新订单", closed.status === 400);

  const finalCard = await api("/public/cards/" + encodeURIComponent(companionId));
  const finalCatalog = await api("/boss/catalog");
  const blobs = [finalCard.text, finalCatalog.text, visible.text];
  assert("最终页面数据没有 RM-", blobs.every(function (text) { return text.indexOf("RM-") < 0; }));

  const emptyChannels = await api("/public/channels");
  assert("未配置渠道时不会出现 DuitNow 或重复支付宝", emptyChannels.json.ok && emptyChannels.json.data.length === 0 && emptyChannels.text.indexOf("DuitNow") < 0 && emptyChannels.text.indexOf("支付宝") < 0);

  const myrChannel = await api("/admin/channels", {
    method: "POST", role: "admin",
    body: { name: "支付宝", currency: "MYR", payee: "MEOW", bank: "Alipay", account: "meow@alipay", qrUrl: "assets/meow-cuijiao-brand.jpg", instructions: "备注老板昵称", enabled: true, sort: 1 }
  });
  const cnyChannel = await api("/admin/channels", {
    method: "POST", role: "admin",
    body: { name: "微信支付", currency: "CNY", payee: "妙脆角", bank: "WeChat", account: "mcj-wechat", qrUrl: "assets/meow-cuijiao-brand.jpg", instructions: "付款后等待客服核对", enabled: true, sort: 2 }
  });
  const hiddenChannel = await api("/admin/channels", {
    method: "POST", role: "admin",
    body: { name: "已关闭渠道", currency: "MYR", payee: "停用", bank: "", account: "off", qrUrl: "", instructions: "", enabled: false, sort: 3 }
  });
  const publicChannels = await api("/public/channels");
  assert("充值与订单只读取已启用渠道", myrChannel.json.ok && cnyChannel.json.ok && publicChannels.json.data.length === 2 && !publicChannels.json.data.some(function (item) { return item.name === "已关闭渠道" || item.name === "DuitNow"; }));

  const depositInfo = await api("/public/deposit");
  assert("押金 MYR 与 CNY 独立配置", depositInfo.json.data.myr === 100 && depositInfo.json.data.cny === 180);

  const paused = await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点", showOnCard: true, showPrice: true, showIntro: true, showBadge: true, acceptOrders: false }
  });
  const pausedOrder = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: valorantId, companionId: companionId, quantity: 1, answers: answers }
  });
  assert("暂停接单后不能创建新的指定预约", paused.json.ok && paused.json.data.acceptOrders === false && pausedOrder.status === 400);
  await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点", showOnCard: true, showPrice: true, showIntro: true, showBadge: true, acceptOrders: true }
  });

  const slotA = "2026-10-20T10:00:00.000Z";
  const slotB = "2026-10-20T12:00:00.000Z";
  const booked = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: voiceId, companionId: companionId, quantity: 1, answers: {}, slotStart: slotA, slotEnd: slotB, idempotencyKey: "voice-slot-1" }
  });
  const sameKey = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: voiceId, companionId: companionId, quantity: 1, answers: {}, slotStart: slotA, slotEnd: slotB, idempotencyKey: "voice-slot-1" }
  });
  const overlap = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: voiceId, companionId: companionId, quantity: 1, answers: {}, slotStart: "2026-10-20T11:00:00.000Z", slotEnd: "2026-10-20T13:00:00.000Z" }
  });
  assert("重复提交返回同一张预约且时段冲突会被拒绝", booked.json.ok && sameKey.json.data.id === booked.json.data.id && overlap.status === 400);

  const accepted = await api("/orders/" + booked.json.data.id + "/accept", { method: "POST", role: "companion", companionId: companionId, body: {} });
  const acceptAgain = await api("/orders/" + booked.json.data.id + "/accept", { method: "POST", role: "companion", companionId: companionId, body: {} });
  assert("陪玩接单后进入付款", accepted.json.ok && accepted.json.data.status === "pending_payment" && acceptAgain.status === 400);

  const paid = await api("/orders/" + booked.json.data.id + "/pay", {
    method: "POST", role: "boss", bossId: "boss_akai",
    body: { channelId: myrChannel.json.data.id, proof: "已转账" }
  });
  const paidAgain = await api("/orders/" + booked.json.data.id + "/pay", {
    method: "POST", role: "boss", bossId: "boss_akai",
    body: { channelId: myrChannel.json.data.id, proof: "已转账" }
  });
  assert("付款后等待客服核对且不能重复付款", paid.json.ok && paid.json.data.status === "pending_review" && paid.json.data.paySnapshot.name === "支付宝" && paidAgain.status === 400);
  await api("/admin/channels/" + myrChannel.json.data.id, {
    method: "PATCH", role: "admin",
    body: { name: "支付宝企业号", currency: "MYR", payee: "MEOW", bank: "Alipay", account: "meow@alipay", qrUrl: "assets/meow-cuijiao-brand.jpg", instructions: "备注老板昵称", enabled: true, sort: 1 }
  });
  const history = await api("/admin/snapshot", { role: "admin" });
  const paidOrder = history.json.data.orders.find(function (item) { return item.id === booked.json.data.id; });
  assert("历史付款快照不受渠道改名影响", paidOrder.paySnapshot.name === "支付宝");

  const failedReview = await api("/orders/" + booked.json.data.id + "/review", {
    method: "POST", role: "service", actorId: "svc_1",
    body: { result: "review_failed", reason: "金额不符" }
  });
  const repaid = await api("/orders/" + booked.json.data.id + "/pay", {
    method: "POST", role: "boss", bossId: "boss_akai",
    body: { channelId: myrChannel.json.data.id, proof: "已补齐" }
  });
  const confirmed = await api("/orders/" + booked.json.data.id + "/review", {
    method: "POST", role: "service", actorId: "svc_1",
    body: { result: "confirmed" }
  });
  const reviewAgain = await api("/orders/" + booked.json.data.id + "/review", {
    method: "POST", role: "service", actorId: "svc_1",
    body: { result: "confirmed" }
  });
  const started = await api("/orders/" + booked.json.data.id + "/start", { method: "POST", role: "service", actorId: "svc_1", body: {} });
  const completed = await api("/orders/" + booked.json.data.id + "/complete", { method: "POST", role: "service", actorId: "svc_1", body: {} });
  assert("客服核对、开始和完成只生效一次", failedReview.json.data.status === "review_failed" && repaid.json.data.status === "pending_review" && confirmed.json.data.status === "confirmed" && reviewAgain.status === 400 && started.json.data.status === "in_service" && completed.json.data.status === "completed");

  const rejectable = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: voiceId, companionId: companionId, quantity: 1, answers: {}, slotStart: "2026-10-21T10:00:00.000Z", slotEnd: "2026-10-21T11:00:00.000Z" }
  });
  const rejected = await api("/orders/" + rejectable.json.data.id + "/reject", {
    method: "POST", role: "companion", companionId: companionId,
    body: { reason: "时间冲突" }
  });
  assert("陪玩可以拒单", rejected.json.ok && rejected.json.data.status === "rejected");

  await api("/admin/settings", {
    method: "PUT", role: "admin",
    body: { allowShowIntro: true, allowShowOnCard: true, allowShowPrice: true, allowShowBadge: true, allowAcceptOrders: true, units: ["每小时", "每局", "每单"], acceptTimeoutMinutes: 0, payTimeoutMinutes: 30, depositMyr: 100, depositCny: 180 }
  });
  const expired = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: voiceId, companionId: companionId, quantity: 1, answers: {}, slotStart: "2026-10-22T10:00:00.000Z", slotEnd: "2026-10-22T11:00:00.000Z" }
  });
  const expiredList = await api("/admin/snapshot", { role: "admin" });
  const expiredOrder = expiredList.json.data.orders.find(function (item) { return item.id === expired.json.data.id; });
  assert("接单超时由后台分钟数控制", expired.json.ok && expiredOrder.status === "accept_timeout");
  await api("/admin/settings", {
    method: "PUT", role: "admin",
    body: { allowShowIntro: true, allowShowOnCard: true, allowShowPrice: true, allowShowBadge: true, allowAcceptOrders: true, units: ["每小时", "每局", "每单"], acceptTimeoutMinutes: 30, payTimeoutMinutes: 30, depositMyr: 100, depositCny: 180 }
  });

  const homeNotice = await api("/admin/announcements", {
    method: "POST", role: "admin",
    body: { title: "首页夜场开放", body: "今晚 8 点开场", audience: "home", pinned: true, scrolling: true, forcePopup: true, enabled: true, sort: 1 }
  });
  const companionNotice = await api("/admin/announcements", {
    method: "POST", role: "admin",
    body: { title: "陪玩排班更新", body: "请查看本周班表", audience: "companion", pinned: false, scrolling: false, forcePopup: false, enabled: true, sort: 2 }
  });
  await api("/admin/announcements", {
    method: "POST", role: "admin",
    body: { title: "客服交接", body: "晚班提前 10 分钟", audience: "service", enabled: true, sort: 3 }
  });
  const draft = await api("/admin/announcements", {
    method: "POST", role: "admin",
    body: { title: "草稿公告", body: "不应展示", audience: "home", enabled: false, sort: 9 }
  });
  await api("/admin/announcements/" + homeNotice.json.data.id, {
    method: "PATCH", role: "admin",
    body: { title: "首页夜场已更新", body: "今晚 9 点开场", audience: "home", pinned: true, scrolling: true, forcePopup: true, enabled: true, sort: 1 }
  });
  const homeFeed = await api("/public/announcements?audience=home");
  const companionFeed = await api("/public/announcements?audience=companion");
  await api("/admin/announcements/" + draft.json.data.id, { method: "DELETE", role: "admin" });
  const afterDelete = await api("/public/announcements?audience=home");
  assert("公告按分类发布、修改和删除", homeNotice.json.ok && companionNotice.json.ok && homeFeed.text.indexOf("首页夜场已更新") >= 0 && homeFeed.text.indexOf("陪玩排班更新") < 0 && homeFeed.text.indexOf("草稿公告") < 0 && companionFeed.text.indexOf("陪玩排班更新") >= 0 && afterDelete.text.indexOf("草稿公告") < 0);

  const deposit = await api("/companion/deposits", {
    method: "POST", role: "companion", companionId: companionId,
    body: { companionId: companionId, applicantName: "星野", channelId: cnyChannel.json.data.id, proof: "已付人民币押金" }
  });
  const depositReview = await api("/admin/deposits/" + deposit.json.data.id + "/review", {
    method: "POST", role: "admin",
    body: { status: "approved", reason: "" }
  });
  const depositAgain = await api("/admin/deposits/" + deposit.json.data.id + "/review", {
    method: "POST", role: "admin",
    body: { status: "approved" }
  });
  assert("押金按渠道币种入账且不能重复审核", deposit.json.ok && deposit.json.data.currency === "CNY" && deposit.json.data.amount === 180 && depositReview.json.data.status === "approved" && depositAgain.status === 400);

  const thread = await api("/chat/threads", { method: "POST", role: "boss", actorId: "boss_akai", actorName: "阿凯", body: {} });
  const threadId = thread.json.data.id;
  const bossMsg = await api("/chat/threads/" + threadId + "/messages", {
    method: "POST", role: "boss", actorId: "boss_akai", actorName: "阿凯",
    body: { body: "你好，我想改预约时间", clientId: "boss-msg-1" }
  });
  const bossDup = await api("/chat/threads/" + threadId + "/messages", {
    method: "POST", role: "boss", actorId: "boss_akai", actorName: "阿凯",
    body: { body: "你好，我想改预约时间", clientId: "boss-msg-1" }
  });
  await api("/chat/threads/" + threadId + "/claim", { method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满", body: {} });
  const reply = await api("/chat/threads/" + threadId + "/messages", {
    method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满",
    body: { body: "可以，请告诉我新的时间", clientId: "svc-msg-1" }
  });
  const seen = await api("/chat/threads/" + threadId, { role: "boss", actorId: "boss_akai", actorName: "阿凯" });
  const serviceList = await api("/chat/threads", { role: "service", actorId: "svc_1", actorName: "客服小满" });
  await api("/chat/threads/" + threadId + "/close", { method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满", body: {} });
  const afterClose = await api("/chat/threads/" + threadId + "/messages", {
    method: "POST", role: "boss", actorId: "boss_akai", actorName: "阿凯",
    body: { body: "结束了还想发", clientId: "boss-msg-2" }
  });
  assert("客服会话发送、去重、回复和结束后不可再发", thread.json.ok && bossMsg.json.ok && bossDup.json.data.duplicate === true && reply.json.ok && seen.json.data.messages.length === 2 && serviceList.json.data.some(function (item) { return item.id === threadId && item.lastMessage.indexOf("新的时间") >= 0; }) && afterClose.status === 400);

  const temp = await api("/admin/services", {
    method: "POST", role: "admin",
    body: { name: "临时删除服务", description: "用于删除测试", priceMin: 1, priceMax: 2, unit: "每单", enabled: true, sort: 9 }
  });
  const removed = await api("/admin/services/" + temp.json.data.id, { method: "DELETE", role: "admin" });
  const catalogFinal = await api("/boss/catalog");
  assert("删除服务后老板端不再显示", removed.json.ok && !catalogFinal.json.data.services.some(function (item) { return item.id === temp.json.data.id; }));

  const fs = await import("node:fs");
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/ops-fixtures.json", JSON.stringify({
    companionId: companionId,
    valorantId: valorantId,
    voiceId: voiceId,
    apexId: apexId,
    orderId: orderId,
    payOrderId: booked.json.data.id,
    channelId: myrChannel.json.data.id,
    cnyChannelId: cnyChannel.json.data.id,
    threadId: threadId,
    valAppId: valApp.json.data.id,
    apexAppId: apexApp.json.data.id,
    lolAppId: lolApp.json.data.id,
    bossId: "boss_akai"
  }, null, 2));

  const discordService = await api("/admin/services/" + voiceId, {
    method: "PATCH", role: "admin",
    body: { name: "语音陪聊", description: "Discord 语音房", priceMin: 10, priceMax: 25, unit: "每单", enabled: true, sort: 2, voiceMode: "discord" }
  });
  const gameDiscord = await api("/orders/" + orderId + "/discord", {
    method: "POST", role: "boss", bossId: "boss_akai", actorId: "boss_akai", actorName: "阿凯",
    body: { discordId: "should-not-save" }
  });
  const discordOrder = await api("/boss/orders", {
    method: "POST", role: "boss",
    body: { bossId: "boss_akai", bossName: "阿凯", serviceId: voiceId, companionId: companionId, quantity: 1, answers: {}, slotStart: "2026-10-23T10:00:00.000Z", slotEnd: "2026-10-23T11:00:00.000Z" }
  });
  const earlyDiscord = await api("/orders/" + discordOrder.json.data.id + "/discord", {
    method: "POST", role: "boss", bossId: "boss_akai", actorId: "boss_akai", actorName: "阿凯",
    body: { discordId: "akai#1024" }
  });
  await api("/orders/" + discordOrder.json.data.id + "/accept", { method: "POST", role: "companion", companionId: companionId, body: {} });
  await api("/orders/" + discordOrder.json.data.id + "/pay", {
    method: "POST", role: "boss", bossId: "boss_akai",
    body: { channelId: myrChannel.json.data.id, proof: "discord-pay" }
  });
  const discordReady = await api("/orders/" + discordOrder.json.data.id + "/review", {
    method: "POST", role: "service", actorId: "svc_1", body: { result: "confirmed" }
  });
  const discordSaved = await api("/orders/" + discordOrder.json.data.id + "/discord", {
    method: "POST", role: "boss", bossId: "boss_akai", actorId: "boss_akai", actorName: "阿凯",
    body: { discordId: "akai#1024" }
  });
  const companionAfterDiscord = await api("/companion/snapshot?companionId=" + encodeURIComponent(companionId), { role: "companion", companionId: companionId });
  const staffDiscord = await api("/service/discord-orders", { role: "service", actorId: "svc_1", actorName: "客服小满" });
  const publicCards = await api("/public/cards");
  assert("Discord 只在语音房订单确认后收集且不公开", discordService.json.data.voiceMode === "discord" && gameDiscord.status === 400 && earlyDiscord.status === 400 && discordReady.json.data.status === "confirmed" && discordSaved.json.data.discordId === "akai#1024" && discordSaved.json.data.discordStatus === "waiting_invite" && companionAfterDiscord.text.indexOf("akai#1024") < 0 && staffDiscord.text.indexOf("akai#1024") >= 0 && publicCards.text.indexOf("akai#1024") < 0);

  const grab = await api("/service/grabs", {
    method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满",
    body: { serviceId: valorantId, quantity: 1, duration: "1小时", price: 22, requirements: "会报点" }
  });
  const claimed = await api("/grabs/" + grab.json.data.id + "/claim", { method: "POST", role: "companion", companionId: companionId, body: {} });
  const claimedAgain = await api("/grabs/" + grab.json.data.id + "/claim", { method: "POST", role: "companion", companionId: companionId, body: {} });
  const spare = await api("/service/grabs", {
    method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满",
    body: { serviceId: valorantId, quantity: 1, duration: "2小时", price: 30, requirements: "待取消" }
  });
  await api("/grabs/" + spare.json.data.id + "/cancel", { method: "POST", role: "service", actorId: "svc_1", body: {} });
  const openGrabs = await api("/grabs");
  assert("取消和已抢名额不会留在抢单大厅，且不能重复抢", grab.json.ok && claimed.json.data.status === "claimed" && claimedAgain.status === 400 && !openGrabs.json.data.some(function (item) { return item.id === grab.json.data.id || item.id === spare.json.data.id; }));

  const gift = await api("/boss/gifts", {
    method: "POST", role: "boss", bossId: "boss_akai", actorId: "boss_akai", actorName: "阿凯",
    body: { giftName: "玫瑰", quantity: 2, channelId: myrChannel.json.data.id, proof: "gift-ref" }
  });
  const giftOk = await api("/gifts/" + gift.json.data.id + "/review", { method: "POST", role: "service", actorId: "svc_1", body: { result: "confirmed" } });
  const giftAgain = await api("/gifts/" + gift.json.data.id + "/review", { method: "POST", role: "service", actorId: "svc_1", body: { result: "confirmed" } });
  assert("客服礼物需审核且不能重复确认", gift.json.ok && gift.json.data.totalAmount === 16 && gift.json.data.status === "pending_review" && giftOk.json.data.status === "confirmed" && giftAgain.status === 400);

  const applyNote = await api("/public/companion-applications", { method: "POST", body: { nickname: "小橘", applicantId: "app_test_1" } });
  const applyAgain = await api("/public/companion-applications", { method: "POST", body: { nickname: "小橘", applicantId: "app_test_1" } });
  const adminInbox = await api("/inbox", { role: "admin", actorId: "admin" });
  assert("新陪玩申请只通知管理员一次", applyNote.json.ok && applyAgain.json.data.duplicate === true && adminInbox.json.data.filter(function (item) { return item.title.indexOf("陪玩申请") >= 0 && item.body.indexOf("app_test_1") >= 0; }).length === 1);

  const recommend = await api("/service/recommend?q=" + encodeURIComponent("星野"));
  const cardThread = await api("/chat/threads", { method: "POST", role: "boss", actorId: "boss_akai", actorName: "阿凯", body: {} });
  const cardMessage = await api("/chat/threads/" + cardThread.json.data.id + "/messages", {
    method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满",
    body: { kind: "card", companionId: companionId, serviceId: voiceId, clientId: "card-1" }
  });
  const cardRead = await api("/chat/threads/" + cardThread.json.data.id, { role: "boss", actorId: "boss_akai", actorName: "阿凯" });
  const closedCard = await api("/chat/threads/" + cardThread.json.data.id + "/messages", {
    method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满",
    body: { kind: "card", companionId: companionId, serviceId: apexId, clientId: "card-closed" }
  });
  assert("客服推荐卡片带真实单价，关闭的服务不能发送", recommend.json.ok && recommend.json.data.some(function (item) { return item.companionId === companionId; }) && cardMessage.json.ok && cardRead.json.data.messages.some(function (item) { return item.card && item.card.companionName === "星野" && item.card.available === true; }) && closedCard.status === 400);

  const bossEvents = await api("/chat/events", { role: "boss", actorId: "boss_akai", bossId: "boss_akai" });
  const newestEvent = (bossEvents.json.data || []).slice(-1)[0];
  const laterEvents = await api("/chat/events?since=" + encodeURIComponent(newestEvent ? newestEvent.createdAt : "9999"), { role: "boss", actorId: "boss_akai", bossId: "boss_akai" });
  assert("历史消息不会再次被当成新消息", bossEvents.json.ok && newestEvent && !laterEvents.json.data.some(function (item) { return item.id === newestEvent.id; }));

  await api("/companion/quiet", { method: "POST", role: "companion", companionId: companionId, body: { optIn: false } });
  const quietTick = await api("/admin/reminders/tick", { method: "POST", role: "admin", body: {} });
  await api("/companion/quiet", { method: "POST", role: "companion", companionId: companionId, body: { optIn: true, quietStart: "00:00", quietEnd: "24:00" } });
  const hourTick = await api("/admin/reminders/tick", { method: "POST", role: "admin", body: {} });
  await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点", showOnCard: true, showPrice: true, showIntro: true, showBadge: true, acceptOrders: false }
  });
  await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: voiceId, quotePrice: 18, intro: "轻松聊天", showOnCard: true, showPrice: true, showIntro: true, showBadge: false, acceptOrders: false }
  });
  await api("/companion/quiet", { method: "POST", role: "companion", companionId: companionId, body: { optIn: true, quietStart: "", quietEnd: "" } });
  const pausedTick = await api("/admin/reminders/tick", { method: "POST", role: "admin", body: {} });
  await api("/companion/offering", {
    method: "PUT", role: "companion", companionId: companionId,
    body: { companionId: companionId, serviceId: valorantId, quotePrice: 22, intro: "双排会报点", showOnCard: true, showPrice: true, showIntro: true, showBadge: true, acceptOrders: true }
  });
  await api("/companion/snapshot?companionId=" + encodeURIComponent(companionId), { role: "companion", companionId: companionId });
  const liveTick = await api("/admin/reminders/tick", { method: "POST", role: "admin", body: {} });
  const liveAgain = await api("/admin/reminders/tick", { method: "POST", role: "admin", body: {} });
  const reminderInbox = await api("/inbox", { role: "companion", companionId: companionId, actorId: companionId });
  const reminded = reminderInbox.json.data.some(function (item) { return item.title.indexOf("记得确认你的接单状态") >= 0; });
  assert("三小时提醒只发给在线且开启接单的陪玩，并且三小时内不重复", quietTick.json.data.sent.indexOf(companionId) < 0 && hourTick.json.data.sent.indexOf(companionId) < 0 && pausedTick.json.data.sent.indexOf(companionId) < 0 && reminded && (liveTick.json.data.sent.indexOf(companionId) >= 0 || reminded) && liveAgain.json.data.sent.indexOf(companionId) < 0);

  const pushKey = await api("/push/public-key");
  assert("系统推送提供公钥且正文不在这个接口里", typeof pushKey.json.data.publicKey === "string" && pushKey.json.data.publicKey.length > 20);

  const failedCount = results.filter(function (item) { return !item.ok; }).length;
  console.log("\n" + (results.length - failedCount) + " passed, " + failedCount + " failed");
  if (failedCount) process.exit(1);
}

main().catch(function (error) {
  console.error(error);
  const failedCount = results.filter(function (item) { return !item.ok; }).length + 1;
  console.log("\nstopped after failure, " + failedCount + " failed");
  process.exit(1);
});
