import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vite";

function ensureLocalEnv() {
  if (process.env.__MCJ_ENV_LOADED) return;
  process.env.__MCJ_ENV_LOADED = "1";
  const envPath = resolve(__dirname, ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

ensureLocalEnv();

const pages = [
  "index.html",
  "activities.html",
  "admin-audit.html",
  "admin-center.html",
  "admin-dashboard.html",
  "admin.html",
  "admin/login/index.html",
  "boss-chat.html",
  "checkin.html",
  "club-levels.html",
  "companion-apply.html",
  "companion-center.html",
  "companion-detail.html",
  "companion/index.html",
  "companion/login/index.html",
  "companion/dashboard/index.html",
  "companion/order-hall/index.html",
  "companion/orders/index.html",
  "companion/messages/index.html",
  "companion/earnings/index.html",
  "companion/wallet/index.html",
  "companion/profile/index.html",
  "companion/verification/index.html",
  "companion/review-status/index.html",
  "custom-order.html",
  "customer-service.html",
  "customer-service/index.html",
  "customer-service/login/index.html",
  "customer-service/dashboard/index.html",
  "customer-service/conversations/index.html",
  "customer-service/chats/index.html",
  "customer-service/orders/index.html",
  "customer-service/dispatch/index.html",
  "customer-service/after-sales/index.html",
  "customer-service/attendance/index.html",
  "customer-service/profile/index.html",
  "favorites.html",
  "fixed-order.html",
  "gifts.html",
  "gameplay-product.html",
  "invite.html",
  "launch-audit.html",
  "login.html",
  "leaderboard.html",
  "messages.html",
  "miao-coin.html",
  "mine.html",
  "mobile.html",
  "more-gameplays.html",
  "orders.html",
  "payment-confirm.html",
  "place-order.html",
  "points.html",
  "player.html",
  "preview.html",
  "profile.html",
  "ranking.html",
  "recharge.html",
  "support.html",
  "tasks.html",
  "team-lobby.html",
  "vip.html"
];

function localApiFunctions() {
  async function apiMiddleware(req, res, next) {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/")) return next();
    // Prefer server/api (Vercel catch-all layout); fall back to legacy ./api
    const rel = requestUrl.pathname.replace(/^\/api\//, "");
    const candidates = [
      resolve(__dirname, `./server/api/${rel}.js`),
      resolve(__dirname, `./server/api/${rel}/index.js`),
      resolve(__dirname, `.${requestUrl.pathname}.js`),
    ];
    const file = candidates.find((p) => existsSync(p));
    if (!file) return next();

    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      req.query = Object.fromEntries(requestUrl.searchParams.entries());
      req.body = rawBody ? JSON.parse(rawBody) : {};
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (data) => {
        if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(data));
      };
      res.send = (data) => {
        if (Buffer.isBuffer(data) || typeof data === "string") return res.end(data);
        res.end(JSON.stringify(data));
      };
      const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
      await mod.default(req, res);
    } catch (error) {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, message: error.message || "Local API error" }));
    }
  }
  return {
    name: "local-api-functions",
    configureServer(server) {
      server.middlewares.use(apiMiddleware);
    },
    // Same API middleware for `vite preview` so local acceptance can hit /api/*
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware);
    },
  };
}
function localRouteAliases() {
  const aliases = new Map([
    ["/companion", "/companion/index.html"],
    ["/companion/login", "/companion/login/index.html"],
    ["/companion/review-status", "/companion/review-status/index.html"],
    ["/customer-service", "/customer-service/index.html"],
    ["/customer-service/login", "/customer-service/login/index.html"],
    ["/customer-service/dashboard", "/customer-service/dashboard/index.html"],
    ["/customer-service/orders", "/customer-service/orders/index.html"],
    ["/customer-service/conversations", "/customer-service/conversations/index.html"],
    ["/customer-service/chats", "/customer-service/conversations/index.html"],
    ["/customer-service/create-order", "/customer-service/dashboard/index.html"],
    ["/customer-service/compensation", "/customer-service/dashboard/index.html"],
    ["/customer-service/reports", "/customer-service/dashboard/index.html"],
    ["/customer-service/profile", "/customer-service/profile/index.html"],
    ["/admin", "/admin.html"],
    ["/admin/login", "/admin/login/index.html"],
    ["/report", "/report/index.html"],
    ["/more-gameplays", "/more-gameplays.html"],
    ["/gameplay-product", "/gameplay-product.html"],
    ["/fixed-order", "/fixed-order.html"],
    ["/ranking", "/ranking.html"],
    ["/leaderboard", "/ranking.html"],
  ]);
  return {
    name: "local-route-aliases",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const requestUrl = new URL(req.url || "/", "http://localhost");
        const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";
        const target = aliases.get(pathname);
        if (target) req.url = `${target}${requestUrl.search}`;
        next();
      });
    },
  };
}
function copyRuntimeSource() {
  return {
    name: "copy-runtime-source",
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      const target = resolve(outDir, "src");
      mkdirSync(outDir, { recursive: true });
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      cpSync(resolve(__dirname, "src"), target, { recursive: true });
    }
  };
}

export default defineConfig({
  plugins: [localRouteAliases(), localApiFunctions(), copyRuntimeSource()],
  appType: "mpa",
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((page) => [page.replace(/\.html$/, ""), resolve(__dirname, page)])
      )
    }
  },
  server: {
    host: "0.0.0.0"
  },
  preview: {
    host: "0.0.0.0"
  }
});



