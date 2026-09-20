/**
 * Capture per-portal PWA wiring evidence for PR #234.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = "/opt/cursor/artifacts/pwa-portal-start-urls";
fs.mkdirSync(OUT_DIR, { recursive: true });
const PORT = 8795;

function mime(f) {
  if (f.endsWith(".html")) return "text/html; charset=utf-8";
  if (f.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (f.endsWith(".css")) return "text/css; charset=utf-8";
  if (f.endsWith(".webmanifest") || f.endsWith(".json")) return "application/manifest+json; charset=utf-8";
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function createServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", "http://127.0.0.1");
        let rel = decodeURIComponent(u.pathname);
        if (rel.endsWith("/")) rel += "index.html";
        if (rel === "/admin" || rel === "/admin/") rel = "/admin.html";
        const file = path.join(ROOT, rel.replace(/^\//, ""));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404);
          res.end("not found " + rel);
          return;
        }
        res.writeHead(200, { "Content-Type": mime(file), "Cache-Control": "no-store" });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const portals = [
  { key: "boss", path: "/", expectManifest: "manifest.webmanifest", expectStart: "/", title: "老板端" },
  { key: "companion", path: "/companion/", expectManifest: "manifest-companion.webmanifest", expectStart: "/companion/", title: "陪玩端" },
  { key: "cs", path: "/customer-service/", expectManifest: "manifest-cs.webmanifest", expectStart: "/customer-service/", title: "客服端" },
  { key: "admin", path: "/admin/", expectManifest: "manifest-admin.webmanifest", expectStart: "/admin/", title: "Admin" },
];

async function main() {
  const server = await createServer();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const results = [];

  try {
    for (const portal of portals) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      });
      await page.goto(`http://127.0.0.1:${PORT}${portal.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(1200);

      const info = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const href = link ? link.href : "";
        let manifest = null;
        try {
          if (href) {
            const res = await fetch(href);
            manifest = await res.json();
          }
        } catch (e) {
          manifest = { error: String(e && e.message) };
        }
        return {
          pathname: location.pathname,
          manifestHref: href,
          portalBoot: window.__MCJ_PWA_PORTAL__ || null,
          manifest,
        };
      });

      const startUrl = info.manifest && info.manifest.start_url;
      const okManifest = String(info.manifestHref || "").includes(portal.expectManifest);
      const okStart = String(startUrl || "").startsWith(portal.expectStart);
      const ok = !!(okManifest && okStart && info.manifest && !info.manifest.error);

      await page.evaluate(
        ({ portal, info, ok }) => {
          document.querySelectorAll("[data-mcj-pwa-root], .mcj-pwa-root").forEach((el) => el.remove());
          const box = document.createElement("div");
          box.style.cssText =
            "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:rgba(10,6,16,.94);color:#ffe6f2;border:1px solid rgba(243,168,203,.45);border-radius:14px;padding:12px 14px;font:12px/1.45 ui-sans-serif,system-ui;box-shadow:0 10px 30px rgba(0,0,0,.45)";
          const m = info.manifest || {};
          box.innerHTML =
            "<div style='font-weight:800;margin-bottom:6px'>PWA · " +
            portal.title +
            (ok ? " · PASS" : " · FAIL") +
            "</div>" +
            "<div>page: " +
            info.pathname +
            "</div>" +
            "<div>manifest: " +
            String(info.manifestHref || "").replace(/^https?:\/\/[^/]+/, "") +
            "</div>" +
            "<div>id: " +
            (m.id || "—") +
            "</div>" +
            "<div>start_url: <b>" +
            (m.start_url || "—") +
            "</b></div>" +
            "<div>scope: " +
            (m.scope || "—") +
            "</div>" +
            "<div>display: " +
            (m.display || "—") +
            "</div>";
          document.body.appendChild(box);
        },
        { portal, info, ok }
      );

      const shot = path.join(OUT_DIR, `${portal.key}-manifest-start-url.png`);
      await page.screenshot({ path: shot, fullPage: false });
      results.push({
        portal: portal.key,
        title: portal.title,
        path: portal.path,
        manifestHref: info.manifestHref,
        start_url: startUrl,
        scope: info.manifest && info.manifest.scope,
        id: info.manifest && info.manifest.id,
        display: info.manifest && info.manifest.display,
        bootPortal: info.portalBoot,
        ok,
        screenshot: shot,
      });
      await page.close();
    }

    fs.writeFileSync(
      path.join(OUT_DIR, "results.json"),
      JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2)
    );

    const summary = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const rows = results
      .map(
        (r) =>
          `<tr><td>${r.title}</td><td><code>${r.manifestHref || ""}</code></td><td><b>${r.start_url}</b></td><td>${r.scope}</td><td>${r.id}</td><td>${r.ok ? "PASS" : "FAIL"}</td></tr>`
      )
      .join("");
    await summary.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#120910;color:#ffe6f2;font-family:system-ui;padding:24px}
      h1{margin:0 0 12px;font-size:22px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border-bottom:1px solid rgba(243,168,203,.22);padding:10px 8px;text-align:left;vertical-align:top}
      code,b{color:#ffd6ea}
    </style></head><body>
      <h1>PR #234 · 四入口 PWA manifest / start_url</h1>
      <table><thead><tr><th>角色</th><th>manifest</th><th>start_url</th><th>scope</th><th>id</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    await summary.screenshot({ path: path.join(OUT_DIR, "00-summary-table.png"), fullPage: true });
    await summary.close();

    console.log(JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2));
    if (!results.every((r) => r.ok)) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
