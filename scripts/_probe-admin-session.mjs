/**
 * Probe Staging admin JWT survival vs boss wipe simulation.
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";

const login = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "login", email: "admin@meow.test", password: "McjTest@12345678" }),
}).then((r) => r.json());

console.log({
  ok: login.ok,
  role: login.session?.user?.role,
  hasAccess: !!login.session?.accessToken,
  hasRefresh: !!login.session?.refreshToken,
  expiresAt: login.session?.expiresAt,
});

const token = login.session?.accessToken || "";
for (const path of [
  "/api/admin/dashboard",
  "/api/admin/banners",
  "/api/admin/content",
  "/api/admin/companion-levels",
  "/api/admin/payment-settings",
  "/api/admin/orders",
  "/api/admin/finance?action=bootstrap",
  "/api/admin/platform-settings",
  "/api/admin/gameplay-products",
]) {
  const method = path.includes("?") || path.endsWith("dashboard") || path.includes("bootstrap") ? "GET" : "GET";
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-admin-role": "admin",
    },
  });
  const body = await r.json().catch(() => ({}));
  console.log(r.status, path, body.ok !== false ? "ok" : body.message || "fail");
}
