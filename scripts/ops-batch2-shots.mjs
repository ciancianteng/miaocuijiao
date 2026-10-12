import fs from "node:fs";
import puppeteer from "puppeteer-core";

const base = process.env.OPS_BASE || "http://127.0.0.1:5173";
const outDir = "/opt/cursor/artifacts/screenshots";
const fixtures = JSON.parse(fs.readFileSync("artifacts/ops-fixtures.json", "utf8"));
fs.mkdirSync(outDir, { recursive: true });

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
  if (!json.ok) throw new Error(path + " " + (json.error || response.status));
  return json.data;
}

await api("/companion/offering", {
  method: "PUT", role: "companion", companionId: fixtures.companionId,
  body: { companionId: fixtures.companionId, serviceId: fixtures.voiceId, quotePrice: 18, intro: "轻松聊天", showOnCard: true, showPrice: true, showIntro: true, showBadge: false, acceptOrders: true }
});
const pending = await api("/boss/orders", {
  method: "POST", role: "boss",
  body: { bossId: "boss_akai", bossName: "阿凯", serviceId: fixtures.voiceId, companionId: fixtures.companionId, quantity: 1, answers: {}, slotStart: "2026-10-24T10:00:00.000Z", slotEnd: "2026-10-24T11:00:00.000Z" }
});
const reviewing = await api("/boss/orders", {
  method: "POST", role: "boss",
  body: { bossId: "boss_akai", bossName: "阿凯", serviceId: fixtures.voiceId, companionId: fixtures.companionId, quantity: 1, answers: {}, slotStart: "2026-10-25T10:00:00.000Z", slotEnd: "2026-10-25T11:00:00.000Z" }
});
await api("/orders/" + reviewing.id + "/accept", { method: "POST", role: "companion", companionId: fixtures.companionId, body: {} });
await api("/orders/" + reviewing.id + "/pay", { method: "POST", role: "boss", bossId: "boss_akai", body: { channelId: fixtures.channelId, proof: "shot-proof" } });
const grab = await api("/service/grabs", {
  method: "POST", role: "service", actorId: "svc_1", actorName: "客服小满",
  body: { serviceId: fixtures.valorantId, quantity: 1, duration: "1小时", price: 22, requirements: "需要会报点，老板段位钻石" }
});
await api("/boss/gifts", {
  method: "POST", role: "boss", bossId: "boss_akai", actorId: "boss_akai", actorName: "阿凯",
  body: { giftName: "奶茶", quantity: 1, channelId: fixtures.channelId, proof: "gift-shot" }
});
const discordOrders = await api("/service/discord-orders", { role: "service", actorId: "svc_1", actorName: "客服小满" });
const discord = discordOrders.find((item) => item.discordId === "akai#1024");
if (!discord) throw new Error("missing discord order");

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
});

async function prepare(page, width, height) {
  await page.setViewport({ width: width, height: height, deviceScaleFactor: 1 });
  page.on("dialog", (dialog) => dialog.accept());
  await page.evaluateOnNewDocument((companionId) => {
    localStorage.setItem("customerServiceAuthToken", "customer_service_session_v3_shot");
    localStorage.setItem("customerServiceUser", JSON.stringify({ id: "svc_1", user_id: "svc_1", name: "客服小满", role: "customer_service" }));
    localStorage.setItem("mcjOpsCompanionId", companionId);
    localStorage.setItem("mcjOpsBossId", "boss_akai");
    localStorage.setItem("mcjOpsBossName", "阿凯");
    localStorage.setItem("mcj-chat-seen-service-ready", "1");
    localStorage.setItem("mcj-chat-seen-service", "{}");
    localStorage.setItem("mcj-chat-seen-companion-ready", "1");
    localStorage.setItem("mcj-chat-seen-companion", "{}");
    localStorage.setItem("mcj-chat-seen-admin-ready", "1");
    localStorage.setItem("mcj-chat-seen-admin", "{}");
    localStorage.setItem("mcj-chat-seen-boss-ready", "1");
    localStorage.setItem("mcj-chat-seen-boss", "{}");
  }, fixtures.companionId);
}

async function shot(page, name) {
  const path = outDir + "/" + name + ".png";
  await page.screenshot({ path: path, fullPage: false });
  console.log("saved", path);
}

const desktop = await browser.newPage();
await prepare(desktop, 1440, 900);

await desktop.goto(base + "/companion-studio.html?companion=" + encodeURIComponent(fixtures.companionId), { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("星野") || document.body.innerText.includes("我的服务"));
await shot(desktop, "b2-studio");
await desktop.click("[data-ops-bell]");
await desktop.waitForSelector("#opsInbox");
await desktop.waitForFunction(() => document.body.innerText.includes("记得确认你的接单状态") || document.body.innerText.includes("暂无通知") || document.body.innerText.includes("未读"));
await shot(desktop, "b2-bell");
await desktop.click("[data-close-inbox]");
await desktop.click('[data-view="grab"]');
await desktop.waitForFunction((id) => document.body.innerText.includes(id), {}, grab.id);
await shot(desktop, "b2-grab");

await desktop.goto(base + "/boss-order.html?order=" + pending.id + "&bossId=boss_akai", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("喵～预约已经送达啦"));
await shot(desktop, "b2-wait-accept");
await desktop.goto(base + "/boss-order.html?order=" + reviewing.id + "&bossId=boss_akai", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("谢谢款待喵"));
await shot(desktop, "b2-wait-review");
await desktop.goto(base + "/boss-order.html?order=" + discord.id + "&bossId=boss_akai", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("正在为您安排语音房"));
await shot(desktop, "b2-discord");
await desktop.goto(base + "/boss-order.html", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("给客服送礼"));
await shot(desktop, "b2-boss-gift");

await desktop.goto(base + "/admin.html#ops-orders", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.querySelector("[data-section='ops-orders']"));
await desktop.click("[data-section='ops-orders']");
await desktop.waitForFunction(() => document.body.innerText.includes("akai#1024"));
await shot(desktop, "b2-admin-discord");
await desktop.click("[data-ops-bell]");
await desktop.waitForSelector("#opsInbox");
await desktop.waitForFunction(() => document.body.innerText.includes("陪玩申请") || document.body.innerText.includes("未读"));
await shot(desktop, "b2-admin-inbox");

await desktop.goto(base + "/customer-service/index.html", { waitUntil: "domcontentloaded" });
await desktop.waitForSelector("[data-ops-desk='收到的礼物']");
await desktop.click("[data-ops-desk='收到的礼物']");
await desktop.waitForFunction(() => document.body.innerText.includes("奶茶"));
await shot(desktop, "b2-cs-gifts");
await desktop.click("[data-close-desk]");
await desktop.click("[data-ops-desk='Discord']");
await desktop.waitForFunction(() => document.body.innerText.includes("akai#1024"));
await shot(desktop, "b2-cs-discord");

const mobile = await browser.newPage();
await prepare(mobile, 390, 844);
await mobile.goto(base + "/companion-studio.html?companion=" + encodeURIComponent(fixtures.companionId), { waitUntil: "domcontentloaded" });
await mobile.waitForFunction(() => document.body.innerText.includes("星野") || document.body.innerText.includes("服务"));
await shot(mobile, "b2-mobile-studio");
await mobile.goto(base + "/boss-order.html?order=" + pending.id + "&bossId=boss_akai", { waitUntil: "domcontentloaded" });
await mobile.waitForFunction(() => document.body.innerText.includes("喵～预约已经送达啦"));
await shot(mobile, "b2-mobile-wait");
await mobile.goto(base + "/messages.html", { waitUntil: "domcontentloaded" });
await mobile.waitForFunction(() => document.body.innerText.includes("消息") || document.body.innerText.includes("加载"));
await new Promise((resolve) => setTimeout(resolve, 1200));
await shot(mobile, "b2-mobile-chat");

await browser.close();
console.log("shots ready", pending.id, reviewing.id, discord.id, grab.id);
