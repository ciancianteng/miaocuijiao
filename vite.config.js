import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vite";

const pages = [
  "index.html",
  "activities.html",
  "admin-audit.html",
  "admin-center.html",
  "admin-dashboard.html",
  "admin.html",
  "boss-chat.html",
  "checkin.html",
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
  "companion/profile/index.html",
  "companion/verification/index.html",
  "custom-order.html",
  "customer-service.html",
  "customer-service/index.html",
  "customer-service/login/index.html",
  "customer-service/dashboard/index.html",
  "customer-service/chats/index.html",
  "customer-service/orders/index.html",
  "customer-service/dispatch/index.html",
  "customer-service/after-sales/index.html",
  "customer-service/attendance/index.html",
  "customer-service/profile/index.html",
  "favorites.html",
  "gifts.html",
  "invite.html",
  "leaderboard.html",
  "messages.html",
  "miao-coin.html",
  "mine.html",
  "mobile.html",
  "more-gameplays.html",
  "orders.html",
  "preview.html",
  "profile.html",
  "support.html",
  "tasks.html",
  "team-lobby.html",
  "vip.html"
];

function localApiFunctions() {
  return {
    name: "local-api-functions",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || "/", "http://localhost");
        if (!requestUrl.pathname.startsWith("/api/")) return next();
        const file = resolve(__dirname, `.${requestUrl.pathname}.js`);
        if (!existsSync(file)) return next();

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
      });
    }
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
  plugins: [localApiFunctions(), copyRuntimeSource()],
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

