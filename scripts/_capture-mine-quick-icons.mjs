/**
 * Capture boss mine quick-entry icons (zh + en) for UI acceptance.
 * Pure static serve + API stubs — no auth backend required.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = "/workspace";
const PUBLIC = path.join(ROOT, "public");
const OUT = "/opt/cursor/artifacts/mine-quick-icons";
fs.mkdirSync(OUT, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function resolveFile(rel) {
  const clean = decodeURIComponent(rel).replace(/^\/+/, "");
  for (const base of [ROOT, PUBLIC]) {
    const file = path.join(base, clean);
    if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function createServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", "http://127.0.0.1");
        let rel = u.pathname;
        if (rel.endsWith("/")) rel += "index.html";
        if (rel === "/portal-early-gate.js" || rel === "/api/stub") {
          res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
          res.end("/* stub */\n");
          return;
        }
        if (rel.startsWith("/api/")) {
          const user = {
            id: "boss-demo",
            role: "boss",
            hasBoss: true,
            displayName: "验收老板",
            nickname: "验收老板",
            bossUid: "MCJ-QA-01",
            publicUid: "MCJ-QA-01",
            avatarUrl: "",
            hasPassword: true,
            status: "active",
          };
          const body = JSON.stringify({
            ok: true,
            user,
            passwordHint: "",
            wallet: { totalBalance: 128, paidBalance: 100, bonusBalance: 28, total: 128, paid: 100, bonus: 28 },
            balance: 128,
            points: 36,
            account: { balance: 128, lifetimeEarned: 200 },
            companions: [{ id: 1 }, { id: 2 }],
            items: [{ id: 1 }, { id: 2 }],
            orders: [],
          });
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(body);
          return;
        }
        const file = resolveFile(rel);
        if (!file) {
          res.writeHead(404);
          res.end("not found " + rel);
          return;
        }
        res.writeHead(200, {
          "Content-Type": mime[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function installAuth() {
  return ({ token }) => {
    const user = {
      id: "boss-demo",
      role: "boss",
      hasBoss: true,
      displayName: "验收老板",
      bossUid: "MCJ-QA-01",
      display_name: "验收老板",
      avatarUrl: "",
      hasPassword: true,
    };
    try {
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjRole", "boss");
      localStorage.setItem("mcjRole", "boss");
      sessionStorage.setItem("customerUser", JSON.stringify(user));
      localStorage.setItem("customerUser", JSON.stringify(user));
    } catch (e) {}
  };
}

async function shotLang(browser, base, lang) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(installAuth(), {
    token:
      "eyJhbGciOiJub25lIn0." +
      Buffer.from(
        JSON.stringify({
          sub: "boss-demo",
          role: "boss",
          exp: Math.floor(Date.now() / 1000) + 86400,
        })
      ).toString("base64url") +
      ".x",
  });
  if (lang === "en") {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("mcjLang", "en");
      } catch (e) {}
    });
  }
  const url = lang === "en" ? `${base}/mine.html?lang=en` : `${base}/mine.html`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".mine-quick a", { timeout: 20000 });
  await page.waitForTimeout(900);

  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll(".mine-quick a")].map((a) => {
      const ico = a.querySelector(".mine-quick-ico");
      const svg = ico && ico.querySelector("svg");
      return {
        href: a.getAttribute("href"),
        label: (a.querySelector(".mine-quick-label") || {}).textContent || "",
        aria: a.getAttribute("aria-label") || "",
        iconText: (ico && ico.textContent || "").replace(/\s+/g, ""),
        hasSvg: !!svg,
        svgPaths: svg ? svg.querySelectorAll("path,rect,circle").length : 0,
      };
    });
    return {
      lang: document.documentElement.lang,
      charIcons: links.some((l) => /[单信客充]/.test(l.iconText)),
      links,
    };
  });

  const file =
    lang === "en"
      ? path.join(OUT, "02-mine-quick-en-mobile.png")
      : path.join(OUT, "01-mine-quick-zh-mobile.png");
  await page.screenshot({ path: file, fullPage: false });
  await context.close();
  return { file, info };
}

const server = await createServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const zh = await shotLang(browser, base, "zh");
  const en = await shotLang(browser, base, "en");
  const report = {
    routes: zh.info.links.map((l) => ({ labelZh: l.label, href: l.href })),
    zh: zh.info,
    en: en.info,
    pass: {
      noCharIcons: !zh.info.charIcons && !en.info.charIcons,
      allSvg: zh.info.links.every((l) => l.hasSvg) && en.info.links.every((l) => l.hasSvg),
      hrefUnchanged: JSON.stringify(zh.info.links.map((l) => l.href)) ===
        JSON.stringify(["/orders.html", "/messages.html", "support.html?start=1", "/recharge.html"]),
    },
  };
  fs.writeFileSync(path.join(OUT, "routes.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("saved", zh.file);
  console.log("saved", en.file);
} finally {
  await browser.close();
  server.close();
}
