#!/usr/bin/env node
/**
 * Local auth-overlay perf harness against this checkout.
 * Injects synthetic boss JWTs and measures #mcjAuthBootOverlay lock time.
 */
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = process.env.MCJ_OUT || "/opt/cursor/artifacts/auth-overlay-local-after.json";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function makeJwt(expSecFromNow) {
  const header = b64url({ alg: "none", typ: "JWT" });
  const exp = Math.floor(Date.now() / 1000) + expSecFromNow;
  const payload = b64url({ sub: "probe-boss", role: "boss", exp });
  return `${header}.${payload}.sig`;
}

function createServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        if (urlPath === "/") urlPath = "/index.html";
        let filePath = path.join(ROOT, urlPath.replace(/^\//, ""));
        if (urlPath === "/portal-early-gate.js") {
          filePath = path.join(ROOT, "public/portal-early-gate.js");
        }
        if (urlPath.startsWith("/api/")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "local probe stub" }));
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const scenarios = [
  {
    name: "valid_jwt_clean",
    accessExpSec: 3600,
    build(access) {
      return { access, authExp: Date.now() + 3_600_000, adminExp: null, refresh: "probe-refresh" };
    },
  },
  {
    name: "valid_jwt_stale_auth_expires",
    accessExpSec: 3600,
    build(access) {
      return { access, authExp: Date.now() - 60_000, adminExp: null, refresh: "probe-refresh" };
    },
  },
  {
    name: "valid_jwt_stale_admin_expires",
    accessExpSec: 3600,
    build(access) {
      return {
        access,
        authExp: Date.now() + 3_600_000,
        adminExp: Date.now() - 60_000,
        refresh: "probe-refresh",
      };
    },
  },
  {
    name: "expired_jwt_with_refresh",
    accessExpSec: -120,
    build(access) {
      return { access, authExp: Date.now() - 120_000, adminExp: null, refresh: "probe-refresh" };
    },
  },
];

const pages = ["/mine.html", "/orders.html", "/messages.html"];

async function seedStorage(page, cfg) {
  await page.addInitScript((c) => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
    const user = JSON.stringify({ role: "boss", displayName: "Probe", id: "probe" });
    localStorage.setItem("mcjAuthAccessToken", c.access);
    sessionStorage.setItem("mcjAuthAccessToken", c.access);
    localStorage.setItem("mcjAuthExpiresAt", String(c.authExp));
    sessionStorage.setItem("mcjAuthExpiresAt", String(c.authExp));
    if (c.adminExp != null) {
      localStorage.setItem("mcjAdminExpiresAt", String(c.adminExp));
      sessionStorage.setItem("mcjAdminExpiresAt", String(c.adminExp));
    }
    if (c.refresh) {
      localStorage.setItem("mcjAuthRefreshToken", c.refresh);
      sessionStorage.setItem("mcjAuthRefreshToken", c.refresh);
    }
    localStorage.setItem("mcjRole", "boss");
    sessionStorage.setItem("mcjRole", "boss");
    localStorage.setItem("customerUser", user);
    sessionStorage.setItem("customerUser", user);
  }, cfg);
}

async function measurePage(page, url, base) {
  const t0 = Date.now();
  const marks = {
    overlaySeenAt: null,
    overlayGoneAt: null,
    firstUsableAt: null,
    overlayTexts: [],
    errors: [],
  };
  page.on("pageerror", (e) => marks.errors.push(String(e && e.message ? e.message : e)));
  await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const deadline = Date.now() + 8000;
  let saw = false;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => {
      const el = document.getElementById("mcjAuthBootOverlay");
      const text = el ? String(el.innerText || "").replace(/\s+/g, " ").trim() : "";
      let visible = false;
      if (el) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.05 &&
          rect.width > 2 &&
          rect.height > 2;
      }
      const hasShell = !!(document.body && document.body.children.length > 1);
      return {
        visible,
        text,
        gate: document.documentElement.getAttribute("data-mcj-auth-gate") || "",
        usable: hasShell && !visible,
      };
    });
    if (info.visible) {
      if (!saw) {
        saw = true;
        marks.overlaySeenAt = Date.now() - t0;
      }
      if (info.text && marks.overlayTexts.indexOf(info.text) < 0) {
        marks.overlayTexts.push(info.text);
      }
    } else if (saw && marks.overlayGoneAt == null) {
      marks.overlayGoneAt = Date.now() - t0;
      break;
    } else if (!saw && Date.now() - t0 > 700) {
      break;
    }
    if (info.usable && marks.firstUsableAt == null) {
      marks.firstUsableAt = Date.now() - t0;
    }
    await page.waitForTimeout(30);
  }
  if (saw && marks.overlayGoneAt == null) marks.overlayGoneAt = Date.now() - t0;
  if (marks.firstUsableAt == null) {
    marks.firstUsableAt = marks.overlayGoneAt != null ? marks.overlayGoneAt : Date.now() - t0;
  }
  marks.overlayDurationMs =
    marks.overlaySeenAt == null
      ? 0
      : (marks.overlayGoneAt ?? Date.now() - t0) - marks.overlaySeenAt;
  marks.authBootstrapMs = marks.firstUsableAt;
  marks.final = await page.evaluate(() => ({
    gate: document.documentElement.getAttribute("data-mcj-auth-gate"),
    reason: document.documentElement.getAttribute("data-mcj-auth-reason"),
    overlay: !!document.getElementById("mcjAuthBootOverlay"),
  }));
  marks.totalMs = Date.now() - t0;
  return marks;
}

const server = await createServer();
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const results = [];
for (const sc of scenarios) {
  for (const url of pages) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      if (/action=me|auth\?action=me/i.test(req.url())) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            user: { id: "probe", role: "boss", hasBoss: true, displayName: "Probe" },
          }),
        });
        return;
      }
      if (req.method() === "POST") {
        let body = {};
        try {
          body = req.postDataJSON() || {};
        } catch (e) {}
        if (body.action === "refresh") {
          await new Promise((r) => setTimeout(r, 1200));
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, message: "Refresh token is not valid" }),
          });
          return;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    const access = makeJwt(sc.accessExpSec);
    await seedStorage(page, sc.build(access));
    try {
      const marks = await measurePage(page, url, base);
      const row = { scenario: sc.name, url, ...marks };
      results.push(row);
      console.log(
        JSON.stringify({
          scenario: sc.name,
          url,
          overlayMs: marks.overlayDurationMs,
          firstUi: marks.firstUsableAt,
          authBootstrapMs: marks.authBootstrapMs,
          texts: marks.overlayTexts,
          final: marks.final,
          errors: marks.errors.slice(0, 3),
        })
      );
    } catch (e) {
      console.log(JSON.stringify({ scenario: sc.name, url, error: String(e) }));
      results.push({ scenario: sc.name, url, error: String(e) });
    }
    await context.close();
  }
}

await browser.close();
server.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2));
console.log("WROTE", OUT);
