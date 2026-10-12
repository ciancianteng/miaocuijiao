import fs from "node:fs";
import puppeteer from "puppeteer-core";

const base = process.env.OPS_BASE || "http://127.0.0.1:5173";
const outDir = "/opt/cursor/artifacts/screenshots";
const fixtures = JSON.parse(fs.readFileSync("artifacts/ops-fixtures.json", "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
});

async function prepare(page, width, height) {
  await page.setViewport({ width: width, height: height, deviceScaleFactor: 1 });
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE", msg.text());
  });
}

async function shot(page, name, fullPage) {
  const path = outDir + "/" + name + ".png";
  await page.screenshot({ path: path, fullPage: fullPage !== false });
  console.log("saved", path);
}

async function showAdmin(page, section, text) {
  const state = await page.evaluate((name) => {
    const button = document.querySelector('[data-section="' + name + '"]');
    if (!button) return "missing-button";
    button.click();
    const node = document.getElementById("section-" + name);
    return node && node.classList.contains("active") ? "active" : "inactive";
  }, section);
  console.log("open", section, state);
  await page.waitForFunction((name) => {
    const node = document.getElementById("section-" + name);
    return node && node.classList.contains("active");
  }, {}, section);
  if (text) await page.waitForFunction((value) => document.body.innerText.includes(value), {}, text);
}

const desktop = await browser.newPage();
await prepare(desktop, 1440, 900);
await desktop.goto(base + "/admin.html", { waitUntil: "networkidle0" });
await desktop.evaluate((id) => {
  localStorage.setItem("mcjOpsCompanionId", id);
  localStorage.setItem("mcjOpsBossId", "boss_akai");
  localStorage.setItem("mcjOpsBossName", "阿凯");
}, fixtures.companionId);

await desktop.goto(base + "/admin.html#dashboard", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("运营总览") && document.body.innerText.includes("VALORANT"));
const menuDisplay = await desktop.evaluate(() => getComputedStyle(document.querySelector("button.ops-menu-btn")).display);
console.log("desktop menu display", menuDisplay);
await shot(desktop, "01-admin-home");

await showAdmin(desktop, "ops-services", "新增服务");
await shot(desktop, "02-admin-services");

await desktop.click("[data-ops='edit-service']");
await desktop.waitForSelector("#serviceForm");
await shot(desktop, "03-admin-service-price", false);
await desktop.click("[data-ops='close-modal']");

await showAdmin(desktop, "ops-requirements", "保存字段配置");
const fieldStyle = await desktop.evaluate(() => {
  const input = document.querySelector("#fieldEditor input");
  const style = getComputedStyle(input);
  return { value: input.value, color: style.color, background: style.backgroundColor };
});
console.log("requirement field", JSON.stringify(fieldStyle));
await shot(desktop, "04-admin-requirements");

await showAdmin(desktop, "ops-certs", "技术认证申请审核");
await shot(desktop, "05-admin-cert-list");
await desktop.click("[data-ops='open-cert'][data-id='" + fixtures.valAppId + "']");
await desktop.waitForFunction(() => document.body.innerText.includes("认证申请详情") && document.body.innerText.includes("考核通过"));
await shot(desktop, "06-admin-cert-detail", false);
await desktop.click("[data-ops='close-modal']");

await showAdmin(desktop, "ops-examiners", "停用");
await shot(desktop, "07-admin-examiners");

await showAdmin(desktop, "ops-badges", "枪法认证");
await shot(desktop, "08-admin-badges");

await desktop.goto(base + "/boss-order.html", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("VALORANT"));
await shot(desktop, "09-boss-services");
await desktop.click("[data-service]");
await desktop.waitForSelector("[data-companion]");
await desktop.click("[data-companion]");
await desktop.waitForFunction(() => document.body.innerText.includes("游戏 ID"));
await shot(desktop, "10-boss-requirements");

await desktop.goto(base + "/public-card.html?id=" + fixtures.companionId, { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("星野") && document.body.innerText.includes("枪法认证"));
await shot(desktop, "11-boss-public-card");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#services", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("展开设置"));
await shot(desktop, "12-companion-services");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#display", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("展示在我的个人卡片"));
await shot(desktop, "13-companion-toggles");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#orders", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("接受") || document.body.innerText.includes("pending_accept"));
await desktop.click("[data-order='" + fixtures.orderId + "']");
await desktop.waitForFunction(() => document.body.innerText.includes("MCJ-ID-88"));
await shot(desktop, "14-companion-order");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#apply", { waitUntil: "networkidle0" });
await desktop.waitForSelector("#certForm");
await shot(desktop, "15-companion-apply");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#status", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("考核通过"));
const layout = await desktop.evaluate(() => {
  const side = document.querySelector(".portal-side");
  const main = document.querySelector(".portal-main");
  const button = side.querySelector("button");
  return {
    side: Math.round(side.getBoundingClientRect().height),
    button: Math.round(button.getBoundingClientRect().height),
    main: Math.round(main.getBoundingClientRect().height),
    sideTop: Math.round(side.getBoundingClientRect().top),
    mainTop: Math.round(main.getBoundingClientRect().top)
  };
});
console.log("companion layout", JSON.stringify(layout));
await shot(desktop, "16-companion-status");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#examiner", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("wx_val_visible_1a2") && document.body.innerText.includes("尚未开放"));
await shot(desktop, "17-companion-examiner");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#card", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("公开个人卡片预览") && document.body.innerText.includes("枪法认证"));
await shot(desktop, "18-companion-card");

const mobile = await browser.newPage();
await prepare(mobile, 390, 844);
await mobile.goto(base + "/admin.html#dashboard", { waitUntil: "networkidle0" });
await mobile.waitForFunction(() => document.body.innerText.includes("运营总览"));
await shot(mobile, "m-admin-home", false);
await mobile.goto(base + "/boss-order.html", { waitUntil: "networkidle0" });
await mobile.waitForFunction(() => document.body.innerText.includes("VALORANT"));
await shot(mobile, "m-boss-services", false);
await mobile.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#display", { waitUntil: "networkidle0" });
await mobile.waitForFunction(() => document.body.innerText.includes("展示在我的个人卡片"));
await shot(mobile, "m-companion-toggles", false);
await mobile.goto(base + "/public-card.html?id=" + fixtures.companionId, { waitUntil: "networkidle0" });
await mobile.waitForFunction(() => document.body.innerText.includes("星野"));
await shot(mobile, "m-public-card", false);

await desktop.goto(base + "/admin.html#dashboard", { waitUntil: "networkidle0" });
await desktop.waitForFunction(() => document.body.innerText.includes("运营总览"));
await showAdmin(desktop, "ops-orders", "预约订单");
await shot(desktop, "19-admin-orders");
await showAdmin(desktop, "ops-payments", "支付渠道");
await shot(desktop, "20-admin-payments");
await showAdmin(desktop, "ops-announcements", "首页夜场已更新");
await shot(desktop, "21-admin-announcements");
await showAdmin(desktop, "ops-deposits", "押金审核");
await shot(desktop, "22-admin-deposits");
await showAdmin(desktop, "ops-settlement", "周五结算");
await shot(desktop, "23-admin-settlement");

await desktop.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("点击我"));
await shot(desktop, "24-home-apply-nudge", false);

await desktop.goto(base + "/miao-coin.html", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("支付宝企业号") && document.body.innerText.includes("猫粮余额") && !document.body.innerText.includes("DuitNow"));
await shot(desktop, "25-boss-recharge");

await desktop.evaluate(() => {
  localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify({
    step: 4,
    rulesAgreement: { accepted: true },
    data: { nickname: "星野", age: "22", gender: "女", region: "吉隆坡", phone: "0123456789", email: "a@b.c", personalTags: ["温柔"], mainGames: ["Valorant"], positions: ["指挥"], modes: ["排位"], rank: "钻石", voiceType: "少女音", onlineStart: "20:00", onlineEnd: "24:00" },
    uploads: { avatar: "x", cover: "x" },
    voice: { confirmed: true },
    identity: {}
  }));
});
await desktop.goto(base + "/companion-apply.html", { waitUntil: "domcontentloaded" });
await desktop.waitForFunction(() => document.body.innerText.includes("认证押金") && document.body.innerText.includes("微信支付"));
await desktop.select("select[name='depositMethod']", "微信支付 · CNY");
await desktop.waitForFunction(() => document.body.innerText.includes("¥180") && document.body.innerText.includes("mcj-wechat"));
await shot(desktop, "26-companion-deposit");

await fetch(base + "/api/ops/chat/threads/" + fixtures.threadId + "/reopen", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-ops-role": "service", "x-ops-actor-id": "svc_1", "x-ops-actor-name": encodeURIComponent("客服小满") },
  body: "{}"
});
await desktop.goto(base + "/customer-service/index.html", { waitUntil: "domcontentloaded" });
await desktop.evaluate(() => {
  localStorage.setItem("customerServiceAuthToken", "customer_service_session_v3_screenshot");
  localStorage.setItem("customerServiceUser", JSON.stringify({ id: "svc_1", user_id: "svc_1", name: "客服小满", role: "customer_service" }));
});
await desktop.goto(base + "/customer-service/index.html", { waitUntil: "domcontentloaded" });
await desktop.click("[data-service-view='messages']");
await desktop.waitForFunction(() => document.body.innerText.includes("阿凯") && document.body.innerText.includes("新的时间"));
await shot(desktop, "27-service-chat");

await desktop.goto(base + "/companion-studio.html?companion=" + fixtures.companionId + "#services", { waitUntil: "domcontentloaded" });
await desktop.click("details summary");
await desktop.waitForFunction(() => document.body.innerText.includes("开启接单"));
await shot(desktop, "28-companion-service-open");

await desktop.goto(base + "/boss-order.html?service=" + fixtures.voiceId + "&companion=" + fixtures.companionId, { waitUntil: "domcontentloaded" });
await desktop.waitForSelector("#orderForm");
await desktop.click("#orderForm button[type='submit']");
await desktop.waitForFunction(() => document.body.innerText.includes("pending_accept"));
const freshId = await desktop.evaluate(() => {
  const text = document.body.innerText;
  const match = text.match(/ord_[0-9a-f]+/);
  return match ? match[0] : "";
});
console.log("fresh order", freshId);
await fetch(base + "/api/ops/orders/" + freshId + "/accept", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-ops-role": "companion", "x-ops-companion-id": fixtures.companionId },
  body: "{}"
});
await desktop.click("[data-refresh-order]");
await desktop.waitForFunction(() => document.body.innerText.includes("支付宝企业号") && document.body.innerText.includes("猫粮余额"));
await shot(desktop, "29-boss-pay");

await mobile.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
await mobile.waitForFunction(() => document.body.innerText.includes("点击我"));
await shot(mobile, "m-home-nudge", false);
await mobile.goto(base + "/customer-service/index.html", { waitUntil: "domcontentloaded" });
await mobile.evaluate(() => {
  localStorage.setItem("customerServiceAuthToken", "customer_service_session_v3_screenshot");
  localStorage.setItem("customerServiceUser", JSON.stringify({ id: "svc_1", user_id: "svc_1", name: "客服小满", role: "customer_service" }));
});
await mobile.goto(base + "/customer-service/index.html", { waitUntil: "domcontentloaded" });
await mobile.click("[data-service-view='messages']");
await mobile.waitForFunction(() => document.body.innerText.includes("阿凯"));
await shot(mobile, "m-service-chat", false);

await browser.close();
console.log("done");
