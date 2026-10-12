import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpsError, openOpsDb } from "./ops-db.mjs";

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
    const bossId = ctx.query.get("bossId") || "";
    return store.listOrders().filter((order) => order.bossId === bossId);
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

  throw new OpsError("接口不存在", 404);
}

export function attachOpsApi(middlewares) {
  middlewares.use((req, res, next) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/ops")) return next();
    const pathName = url.pathname.replace(/^\/api\/ops/, "") || "/";
    const run = async () => {
      const body = req.method === "GET" || req.method === "HEAD" ? {} : await readJson(req);
      const data = await route({
        method: req.method || "GET",
        path: pathName,
        body: body,
        query: url.searchParams,
        headers: req.headers || {},
        store: db()
      });
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
