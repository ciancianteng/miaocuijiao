import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { OpsError, openOpsDb } from "./ops-db.mjs";

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.OPS_DB_PATH || path.join(root, "data", "mcj-ops.sqlite");
let store;

function db() {
  if (!store) store = openOpsDb(dbPath);
  return store;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new OpsError("请求格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function requireAdmin(headers) {
  if (String(headers["x-ops-role"] || "") !== "admin") throw new OpsError("需要管理员权限", 403);
}

function orderActor(headers) {
  const role = String(headers["x-ops-role"] || "");
  if (role === "companion") return { role: role, id: String(headers["x-ops-companion-id"] || ""), name: "陪玩" };
  if (role === "boss") return { role: role, id: String(headers["x-ops-boss-id"] || ""), name: "老板" };
  if (role === "admin" || role === "service") return { role: role, id: String(headers["x-ops-actor-id"] || role), name: role === "service" ? "客服" : "管理员" };
  throw new OpsError("身份不正确", 403);
}

function requireCompanion(headers, companionId) {
  if (String(headers["x-ops-role"] || "") !== "companion") throw new OpsError("需要陪玩身份", 403);
  if (!companionId || String(headers["x-ops-companion-id"] || "") !== companionId) {
    throw new OpsError("不能操作其他陪玩的资料", 403);
  }
}

async function route(ctx) {
  const pathName = ctx.path;
  const method = ctx.method;
  const body = ctx.body || {};
  const store = ctx.store;

  if (method === "GET" && pathName === "/health") {
    return { ok: true, database: "sqlite" };
  }

  if (method === "POST" && pathName === "/admin/reset") {
    requireAdmin(ctx.headers);
    if (process.env.NODE_ENV === "production" && process.env.OPS_ALLOW_RESET !== "1") {
      throw new OpsError("当前环境不允许重置", 403);
    }
    if (body.confirm !== "RESET") throw new OpsError("确认口令不正确");
    store.reset();
    return { reset: true };
  }

  if (method === "GET" && pathName === "/admin/snapshot") {
    requireAdmin(ctx.headers);
    return store.adminSnapshot();
  }

  if (method === "POST" && pathName === "/admin/services") {
    requireAdmin(ctx.headers);
    return store.saveService(body);
  }

  const servicePatch = pathName.match(/^\/admin\/services\/([^/]+)$/);
  if (method === "PATCH" && servicePatch) {
    requireAdmin(ctx.headers);
    return store.saveService(body, decodeURIComponent(servicePatch[1]));
  }
  if (method === "DELETE" && servicePatch) {
    requireAdmin(ctx.headers);
    return store.deleteService(decodeURIComponent(servicePatch[1]));
  }

  const fieldsPut = pathName.match(/^\/admin\/services\/([^/]+)\/fields$/);
  if (method === "PUT" && fieldsPut) {
    requireAdmin(ctx.headers);
    return store.replaceFields(decodeURIComponent(fieldsPut[1]), body.fields || []);
  }

  if (method === "POST" && pathName === "/admin/companions") {
    requireAdmin(ctx.headers);
    return store.saveCompanion(body);
  }

  const companionPatch = pathName.match(/^\/admin\/companions\/([^/]+)$/);
  if (method === "PATCH" && companionPatch) {
    requireAdmin(ctx.headers);
    return store.saveCompanion(body, decodeURIComponent(companionPatch[1]));
  }

  if (method === "PUT" && pathName === "/admin/offerings") {
    requireAdmin(ctx.headers);
    return store.saveOffering(body, "admin");
  }

  if (method === "PUT" && pathName === "/admin/settings") {
    requireAdmin(ctx.headers);
    return store.updateSettings(body);
  }

  if (method === "POST" && pathName === "/admin/examiners") {
    requireAdmin(ctx.headers);
    return store.saveExaminer(body);
  }

  const examinerPatch = pathName.match(/^\/admin\/examiners\/([^/]+)$/);
  if (method === "PATCH" && examinerPatch) {
    requireAdmin(ctx.headers);
    return store.saveExaminer(body, decodeURIComponent(examinerPatch[1]));
  }

  const reviewPost = pathName.match(/^\/admin\/cert\/([^/]+)\/review$/);
  if (method === "POST" && reviewPost) {
    requireAdmin(ctx.headers);
    return store.reviewApplication(decodeURIComponent(reviewPost[1]), body);
  }

  if (method === "POST" && pathName === "/companion/profile") {
    if (String(ctx.headers["x-ops-role"] || "") !== "companion") throw new OpsError("需要陪玩身份", 403);
    return store.saveCompanion(body);
  }

  const companionProfile = pathName.match(/^\/companion\/profile\/([^/]+)$/);
  if (method === "PATCH" && companionProfile) {
    const id = decodeURIComponent(companionProfile[1]);
    requireCompanion(ctx.headers, id);
    return store.saveCompanion(body, id);
  }

  if (method === "GET" && pathName === "/companion/snapshot") {
    const id = ctx.query.get("companionId") || "";
    requireCompanion(ctx.headers, id);
    return store.companionSnapshot(id);
  }

  if (method === "PUT" && pathName === "/companion/offering") {
    requireCompanion(ctx.headers, body.companionId);
    return store.saveOffering(body, "companion");
  }

  if (method === "POST" && pathName === "/companion/cert-applications") {
    requireCompanion(ctx.headers, body.companionId);
    return store.createApplication(body);
  }

  if (method === "GET" && pathName === "/boss/catalog") {
    return store.bossCatalog();
  }

  if (method === "POST" && pathName === "/boss/orders") {
    if (String(ctx.headers["x-ops-role"] || "") !== "boss") throw new OpsError("需要老板身份", 403);
    return store.createOrder(body);
  }

  if (method === "GET" && pathName === "/boss/orders") {
    if (String(ctx.headers["x-ops-role"] || "") !== "boss") throw new OpsError("需要老板身份", 403);
    const bossId = ctx.query.get("bossId") || String(ctx.headers["x-ops-boss-id"] || "");
    return store.listOrders().filter((order) => order.bossId === bossId).map((order) => store.orderForBoss(order));
  }

  const orderAction = pathName.match(/^\/orders\/([^/]+)\/(accept|reject|pay|cancel|review|start|complete)$/);
  if (method === "POST" && orderAction) {
    return store.orderAction(decodeURIComponent(orderAction[1]), orderAction[2], body, orderActor(ctx.headers));
  }

  if (method === "POST" && pathName === "/admin/channels") {
    requireAdmin(ctx.headers);
    return store.saveChannel(body);
  }
  const channelPatch = pathName.match(/^\/admin\/channels\/([^/]+)$/);
  if (method === "PATCH" && channelPatch) {
    requireAdmin(ctx.headers);
    return store.saveChannel(body, decodeURIComponent(channelPatch[1]));
  }
  if (method === "DELETE" && channelPatch) {
    requireAdmin(ctx.headers);
    return store.deleteChannel(decodeURIComponent(channelPatch[1]));
  }

  if (method === "POST" && pathName === "/admin/announcements") {
    requireAdmin(ctx.headers);
    return store.saveAnnouncement(body);
  }
  const announcementPatch = pathName.match(/^\/admin\/announcements\/([^/]+)$/);
  if (method === "PATCH" && announcementPatch) {
    requireAdmin(ctx.headers);
    return store.saveAnnouncement(body, decodeURIComponent(announcementPatch[1]));
  }
  if (method === "DELETE" && announcementPatch) {
    requireAdmin(ctx.headers);
    return store.deleteAnnouncement(decodeURIComponent(announcementPatch[1]));
  }

  const depositReview = pathName.match(/^\/admin\/deposits\/([^/]+)\/review$/);
  if (method === "POST" && depositReview) {
    requireAdmin(ctx.headers);
    return store.reviewDeposit(decodeURIComponent(depositReview[1]), body);
  }
  if (method === "POST" && pathName === "/companion/deposits") {
    if (String(ctx.headers["x-ops-role"] || "") !== "companion") throw new OpsError("需要陪玩身份", 403);
    return store.createDeposit(body);
  }

  if (method === "GET" && pathName === "/public/channels") return store.listChannels(true);
  if (method === "GET" && pathName === "/public/deposit") return store.depositConfig();
  if (method === "GET" && pathName === "/public/announcements") {
    return store.publicAnnouncements(ctx.query.get("audience") || "home");
  }

  if (method === "GET" && pathName === "/chat/threads") return store.listChats(store.chatActor(ctx.headers, body));
  if (method === "POST" && pathName === "/chat/threads") return store.openChat(store.chatActor(ctx.headers, body), body);
  const chatRead = pathName.match(/^\/chat\/threads\/([^/]+)$/);
  if (method === "GET" && chatRead) return store.readChat(decodeURIComponent(chatRead[1]), store.chatActor(ctx.headers, body));
  const chatSend = pathName.match(/^\/chat\/threads\/([^/]+)\/messages$/);
  if (method === "POST" && chatSend) return store.sendChat(decodeURIComponent(chatSend[1]), store.chatActor(ctx.headers, body), body);
  const chatClose = pathName.match(/^\/chat\/threads\/([^/]+)\/close$/);
  if (method === "POST" && chatClose) return store.closeChat(decodeURIComponent(chatClose[1]), store.chatActor(ctx.headers, body));
  const chatDesk = pathName.match(/^\/chat\/threads\/([^/]+)\/(claim|release|reopen)$/);
  if (method === "POST" && chatDesk) {
    const id = decodeURIComponent(chatDesk[1]);
    const actor = store.chatActor(ctx.headers, body);
    if (chatDesk[2] === "claim") return store.claimChat(id, actor, !!body.force);
    if (chatDesk[2] === "release") return store.releaseChat(id, actor);
    return store.reopenChat(id, actor);
  }

  if (method === "GET" && pathName === "/public/cards") {
    return store.publicCards();
  }

  const publicCard = pathName.match(/^\/public\/cards\/([^/]+)$/);
  if (method === "GET" && publicCard) {
    const card = store.publicCard(decodeURIComponent(publicCard[1]));
    if (!card) throw new OpsError("个人卡片不存在", 404);
    return card;
  }

  if (method === "GET" && pathName === "/inbox") return store.listNotifications(store.chatActor(ctx.headers, body));
  const inboxRead = pathName.match(/^\/inbox\/([^/]+)\/read$/);
  if (method === "POST" && inboxRead) return store.markNotification(decodeURIComponent(inboxRead[1]), store.chatActor(ctx.headers, body));
  if (method === "GET" && pathName === "/push/public-key") return { publicKey: pushPublicKey() };
  if (method === "POST" && pathName === "/push/subscribe") return store.savePushSubscription(store.chatActor(ctx.headers, body), body);
  if (method === "POST" && pathName === "/push/forget") return store.forgetPush(store.chatActor(ctx.headers, body));
  if (method === "GET" && pathName === "/chat/events") return store.chatEvents(store.chatActor(ctx.headers, body), ctx.query.get("since") || "");
  if (method === "POST" && pathName === "/service/companion-messages") return store.messageCompanion(store.chatActor(ctx.headers, body), body);
  if (method === "GET" && pathName === "/service/recommend") return store.searchRecommend(ctx.query.get("q") || "");
  if (method === "GET" && pathName === "/grabs") return store.openGrabs();
  if (method === "POST" && pathName === "/service/grabs") return store.createGrab(store.chatActor(ctx.headers, body), body);
  const grabCancel = pathName.match(/^\/grabs\/([^/]+)\/cancel$/);
  if (method === "POST" && grabCancel) {
    const role = String(ctx.headers["x-ops-role"] || "");
    if (role !== "admin" && role !== "service") throw new OpsError("需要客服身份", 403);
    return store.cancelGrab(decodeURIComponent(grabCancel[1]));
  }
  const grabClaim = pathName.match(/^\/grabs\/([^/]+)\/claim$/);
  if (method === "POST" && grabClaim) {
    if (String(ctx.headers["x-ops-role"] || "") !== "companion") throw new OpsError("需要陪玩身份", 403);
    return store.claimGrab(decodeURIComponent(grabClaim[1]), String(ctx.headers["x-ops-companion-id"] || ""));
  }
  if (method === "GET" && pathName === "/gifts/catalog") return store.giftCatalog();
  if (method === "GET" && pathName === "/gifts") {
    const role = String(ctx.headers["x-ops-role"] || "");
    if (role !== "admin" && role !== "service") throw new OpsError("需要客服身份", 403);
    return store.listGifts();
  }
  if (method === "POST" && pathName === "/boss/gifts") return store.createGift(store.chatActor(ctx.headers, body), body);
  const giftReview = pathName.match(/^\/gifts\/([^/]+)\/review$/);
  if (method === "POST" && giftReview) {
    const role = String(ctx.headers["x-ops-role"] || "");
    if (role !== "admin" && role !== "service") throw new OpsError("需要客服身份", 403);
    return store.reviewGift(decodeURIComponent(giftReview[1]), body);
  }
  const discordSave = pathName.match(/^\/orders\/([^/]+)\/discord$/);
  if (method === "POST" && discordSave) return store.saveDiscord(store.chatActor(ctx.headers, body), decodeURIComponent(discordSave[1]), body.discordId);
  const discordStatus = pathName.match(/^\/orders\/([^/]+)\/discord-status$/);
  if (method === "POST" && discordStatus) {
    const role = String(ctx.headers["x-ops-role"] || "");
    if (role !== "admin" && role !== "service") throw new OpsError("需要客服身份", 403);
    return store.setDiscordStatus(decodeURIComponent(discordStatus[1]), body.status);
  }
  if (method === "GET" && pathName === "/service/discord-orders") {
    const role = String(ctx.headers["x-ops-role"] || "");
    if (role !== "admin" && role !== "service") throw new OpsError("需要客服身份", 403);
    return store.staffDiscordOrders();
  }
  if (method === "POST" && pathName === "/admin/reminders/tick") {
    requireAdmin(ctx.headers);
    return { sent: store.tickReminders() };
  }
  if (method === "GET" && pathName === "/admin/daily") {
    requireAdmin(ctx.headers);
    return store.dailyAdmin();
  }
  if (method === "GET" && pathName === "/companion/daily") {
    if (String(ctx.headers["x-ops-role"] || "") !== "companion") throw new OpsError("需要陪玩身份", 403);
    return store.dailyCompanion(String(ctx.headers["x-ops-companion-id"] || ""));
  }
  if (method === "POST" && pathName === "/companion/quiet") {
    if (String(ctx.headers["x-ops-role"] || "") !== "companion") throw new OpsError("需要陪玩身份", 403);
    return store.saveQuietHours(String(ctx.headers["x-ops-companion-id"] || ""), body);
  }
  if (method === "POST" && pathName === "/admin/reminder") {
    requireAdmin(ctx.headers);
    store.setSetting("status_reminder_enabled", body.enabled === false ? "0" : "1");
    return store.getSettings();
  }
  if (method === "POST" && pathName === "/public/companion-applications") return store.submitCompanionApplication(body);

  throw new OpsError("接口不存在", 404);
}

let vapidKeys;
function pushPublicKey() {
  try {
    const webpush = require("web-push");
    if (!vapidKeys) {
      const file = path.join(root, "data", "vapid.json");
      if (fs.existsSync(file)) vapidKeys = JSON.parse(fs.readFileSync(file, "utf8"));
      else {
        vapidKeys = webpush.generateVAPIDKeys();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(vapidKeys));
      }
      webpush.setVapidDetails("mailto:ops@meowcuijiao.local", vapidKeys.publicKey, vapidKeys.privateKey);
    }
    return vapidKeys.publicKey;
  } catch (error) {
    return "";
  }
}

async function flushPush(current) {
  const jobs = current.takePushQueue ? current.takePushQueue() : [];
  if (!jobs.length || !pushPublicKey()) return;
  let webpush;
  try { webpush = require("web-push"); } catch (error) { return; }
  for (const job of jobs) {
    const subs = current.pushSubscriptions(job.role, job.actorId);
    for (const sub of subs) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key }
        }, JSON.stringify({ title: job.title, body: "你有一条新通知，打开后查看。", href: job.href || "/" }));
      } catch (error) {
        if (error && (error.statusCode === 404 || error.statusCode === 410)) {
          current.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
        }
      }
    }
  }
}

export function attachOpsApi(middlewares) {
  if (!globalThis.__mcjReminder) {
    globalThis.__mcjReminder = setInterval(() => {
      try { db().tickReminders(); flushPush(db()); } catch (error) { /* reminder loop stays quiet */ }
    }, 60000);
    if (globalThis.__mcjReminder.unref) globalThis.__mcjReminder.unref();
  }
  middlewares.use((req, res, next) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/ops")) return next();
    const pathName = url.pathname.replace(/^\/api\/ops/, "") || "/";
    const run = async () => {
      const body = req.method === "GET" || req.method === "HEAD" ? {} : await readJson(req);
      const current = db();
      const data = await route({
        method: req.method || "GET",
        path: pathName,
        body: body,
        query: url.searchParams,
        headers: req.headers || {},
        store: current
      });
      await flushPush(current);
      send(res, 200, { ok: true, data: data });
    };
    run().catch((error) => {
      const status = error instanceof OpsError ? error.status : 500;
      send(res, status, { ok: false, error: error.message || "服务器错误" });
    });
  });
}

export function opsDbPath() {
  return dbPath;
}
