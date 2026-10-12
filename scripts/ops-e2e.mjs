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
  assert("老板下单成功并计算总价", order.json.ok && order.json.data.unitPrice === 22 && order.json.data.totalPrice === 44);
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

  const fs = await import("node:fs");
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/ops-fixtures.json", JSON.stringify({
    companionId: companionId,
    valorantId: valorantId,
    voiceId: voiceId,
    apexId: apexId,
    orderId: orderId,
    valAppId: valApp.json.data.id,
    apexAppId: apexApp.json.data.id,
    lolAppId: lolApp.json.data.id,
    bossId: "boss_akai"
  }, null, 2));

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
