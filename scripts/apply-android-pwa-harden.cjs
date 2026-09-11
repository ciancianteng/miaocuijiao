/**
 * Apply Android PWA installability hardening on fix/android-pwa-installability.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const V = "20260911pwaFix1";

function writeBothManifests() {
  const json = {
    id: "/",
    name: "妙脆角 MEOW CUI JIAO",
    short_name: "妙脆角",
    description: "专业陪玩，每一场游戏认真对待每一位热爱电竞的你。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0a0610",
    theme_color: "#0a0610",
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
  const body = JSON.stringify(json, null, 2) + "\n";
  fs.writeFileSync(path.join(ROOT, "manifest.webmanifest"), body, "utf8");
  fs.writeFileSync(path.join(ROOT, "public", "manifest.webmanifest"), body, "utf8");
  console.log("wrote manifests with id");
}

function patchIndexHtml() {
  const file = path.join(ROOT, "index.html");
  let html = fs.readFileSync(file, "utf8");

  // Cache-bust static PWA asset links (first occurrence block in head)
  html = html.replace(
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="manifest" href="/manifest.webmanifest?v=' + V + '">'
  );
  html = html.replace(
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=' + V + '">'
  );
  html = html.replace(
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
    '<link rel="icon" href="/favicon.ico?v=' +
      V +
      '">\n  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=' +
      V +
      '">'
  );
  html = html.replace(
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png?v=' + V + '">'
  );

  if (!html.includes("data-mcj-pwa-sw-early")) {
    const early =
      '  <script data-mcj-pwa-sw-early>\n' +
      "  (function () {\n" +
      '    if (!("serviceWorker" in navigator)) return;\n' +
      "    try {\n" +
      '      navigator.serviceWorker.register("/sw-mcj.js?v=' +
      V +
      '", { scope: "/" }).catch(function () {});\n' +
      "    } catch (e) {}\n" +
      "  })();\n" +
      "  </script>\n";
    html = html.replace(
      '<script src="/src/supabase-recovery-reset.js?v=20260907recoveryReset1"></script>',
      early +
        '<script src="/src/supabase-recovery-reset.js?v=20260907recoveryReset1"></script>'
    );
  }

  fs.writeFileSync(file, html, "utf8");
  console.log("patched index.html");
}

function patchPwaInstallPrompt() {
  const file = path.join(ROOT, "src", "pwa-install-prompt.js");
  let s = fs.readFileSync(file, "utf8");
  if (!s.includes("20260911pwaIcon2")) {
    throw new Error("unexpected pwa-install-prompt version marker");
  }
  s = s.split("20260911pwaIcon2").join(V);
  s = s.replace(
    'navigator.serviceWorker.register("/sw-mcj.js", { scope: "/" })',
    'navigator.serviceWorker.register("/sw-mcj.js?v=' + V + '", { scope: "/" })'
  );

  // Prefer Install app wording for Android teach fallback
  s = s.replace(
    "<span>安装应用 / 添加到主屏幕</span>",
    "<span>优先选「安装应用」</span>"
  );

  // Ensure favicon.ico link is injected for shortcut path
  if (!s.includes("data-mcj-pwa-favicon-ico")) {
    const needle =
      'ensureMetaTag(\'link[rel="icon"][data-mcj-pwa-favicon-32]\', function () {';
    const insert =
      'ensureMetaTag(\'link[rel="icon"][data-mcj-pwa-favicon-ico]\', function () {\n' +
      "      var l = document.createElement(\"link\");\n" +
      '      l.rel = "icon";\n' +
      '      l.href = "/favicon.ico?v=" + iconV;\n' +
      '      l.setAttribute("data-mcj-pwa-favicon-ico", "1");\n' +
      "      return l;\n" +
      "    });\n" +
      "    " +
      needle;
    if (!s.includes(needle)) throw new Error("favicon-32 ensureMetaTag not found");
    s = s.replace(needle, insert);
  }

  fs.writeFileSync(file, s, "utf8");
  console.log("patched pwa-install-prompt.js");
}

function patchBossHeader() {
  const file = path.join(ROOT, "src", "boss-header.js");
  let s = fs.readFileSync(file, "utf8");
  if (!s.includes("20260911pwaIcon2")) {
    throw new Error("unexpected boss-header pwa version marker");
  }
  s = s.split("20260911pwaIcon2").join(V);
  fs.writeFileSync(file, s, "utf8");
  console.log("patched boss-header.js");
}

function patchServiceWorker() {
  const body =
    "/* MCJ minimal service worker — network-first passthrough for installability.\n" +
    "   Version: " +
    V +
    "\n" +
    "   Do NOT aggressively cache HTML/API (avoids stale login/session pages). */\n" +
    'self.addEventListener("install", function (event) {\n' +
    "  self.skipWaiting();\n" +
    "});\n" +
    "\n" +
    'self.addEventListener("activate", function (event) {\n' +
    "  event.waitUntil(self.clients.claim());\n" +
    "});\n" +
    "\n" +
    'self.addEventListener("fetch", function (event) {\n' +
    "  var req = event.request;\n" +
    '  if (!req || req.method !== "GET") return;\n' +
    "  var url;\n" +
    "  try {\n" +
    "    url = new URL(req.url);\n" +
    "  } catch (e) {\n" +
    "    return;\n" +
    "  }\n" +
    "  if (url.origin !== self.location.origin) return;\n" +
    "  // Never intercept API or auth-sensitive paths with a cache strategy.\n" +
    '  if (url.pathname.indexOf("/api/") === 0) return;\n' +
    "  event.respondWith(\n" +
    "    fetch(req)\n" +
    "      .then(function (res) {\n" +
    "        return res;\n" +
    "      })\n" +
    "      .catch(function () {\n" +
    "        return fetch(req);\n" +
    "      })\n" +
    "  );\n" +
    "});\n";
  fs.writeFileSync(path.join(ROOT, "public", "sw-mcj.js"), body, "utf8");
  // Some deploys also serve root copy if present
  const rootSw = path.join(ROOT, "sw-mcj.js");
  if (fs.existsSync(rootSw)) fs.writeFileSync(rootSw, body, "utf8");
  console.log("patched sw-mcj.js");
}

function patchVercelSwHeader() {
  const file = path.join(ROOT, "vercel.json");
  const raw = fs.readFileSync(file, "utf8");
  if (raw.includes('"/sw-mcj.js"')) {
    console.log("vercel.json already has sw-mcj headers");
    return;
  }
  // Insert SW cache headers near manifest block
  const needle = '      {\n        "source": "/manifest.webmanifest",';
  if (!raw.includes(needle)) {
    console.warn("manifest header block not found; skip vercel sw header");
    return;
  }
  const insert =
    '      {\n' +
    '        "source": "/sw-mcj.js",\n' +
    '        "headers": [\n' +
    '          { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },\n' +
    '          { "key": "Service-Worker-Allowed", "value": "/" },\n' +
    '          { "key": "X-Content-Type-Options", "value": "nosniff" }\n' +
    "        ]\n" +
    "      },\n" +
    needle;
  fs.writeFileSync(file, raw.replace(needle, insert), "utf8");
  console.log("patched vercel.json SW headers");
}

writeBothManifests();
patchIndexHtml();
patchPwaInstallPrompt();
patchBossHeader();
patchServiceWorker();
patchVercelSwHeader();
console.log("done", V);
