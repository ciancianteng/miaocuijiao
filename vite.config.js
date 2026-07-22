import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
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
  "custom-order.html",
  "customer-service.html",
  "customer-service/index.html",
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
  plugins: [copyRuntimeSource()],
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
