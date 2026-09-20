/**
 * Build PWA / iOS / favicon assets from the official transparent cat logo.
 * Uses playwright-core + Chromium/Edge canvas (no sharp/jimp required).
 *
 * Source: public/og/meowcuijiao-logo-transparent.png
 * Outputs:
 *   public/icons/icon-{192,512}.png              (purpose: any)
 *   public/icons/icon-{192,512}-maskable.png     (purpose: maskable, ~20% safe zone)
 *   public/icons/apple-touch-icon.png            (180×180)
 *   public/apple-touch-icon.png                  (Safari default path)
 *   public/favicon-32.png
 *   public/favicon.ico                           (single 32×32 PNG-in-ICO)
 *   docs/pwa-install-accept/icon-previews/*      (evidence + maskable circle overlay)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "og", "meowcuijiao-logo-transparent.png");
const ICONS_DIR = path.join(ROOT, "public", "icons");
const PUBLIC = path.join(ROOT, "public");
const PREVIEW_DIR = path.join(ROOT, "docs", "pwa-install-accept", "icon-previews");

const BG_TOP = "#120818";
const BG_BOTTOM = "#1a0a18";
const BG_ACCENT = "#2a1030";

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    path.join(
      process.env.LOCALAPPDATA || "",
      "ms-playwright",
      "chromium-1148",
      "chrome-win64",
      "chrome.exe"
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "ms-playwright",
      "chromium-1148",
      "chrome-win",
      "chrome.exe"
    ),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fallback: scan ms-playwright for any chrome.exe
  const ms = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(ms)) {
    const stack = [ms];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(full);
        else if (ent.name.toLowerCase() === "chrome.exe") return full;
      }
    }
  }
  return null;
}

function ensureDirs() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

/** Minimal ICO: one 32×32 PNG embedded (Vista+). */
function pngToIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bitcount
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset

  return Buffer.concat([header, entry, pngBuf]);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Missing source logo:", SRC);
    process.exit(1);
  }
  ensureDirs();

  const exe = findBrowser();
  if (!exe) {
    console.error("No Chromium/Edge/Chrome found for playwright-core");
    process.exit(1);
  }
  console.log("Using browser:", exe);

  const logoB64 = fs.readFileSync(SRC).toString("base64");
  const logoDataUrl = `data:image/png;base64,${logoB64}`;

  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
  });
  const page = await browser.newPage();

  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c"></canvas>
<script>
window.__logoDataUrl = ${JSON.stringify(logoDataUrl)};
window.__BG_TOP = ${JSON.stringify(BG_TOP)};
window.__BG_BOTTOM = ${JSON.stringify(BG_BOTTOM)};
window.__BG_ACCENT = ${JSON.stringify(BG_ACCENT)};
</script></body></html>`,
    { waitUntil: "domcontentloaded" }
  );

  const renderOne = async (opts) => {
    const { size, padRatio, outRel, circleOverlay } = opts;
    const result = await page.evaluate(
      async ({ size, padRatio, logoDataUrl, BG_TOP, BG_BOTTOM, BG_ACCENT, circleOverlay }) => {
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = () => rej(new Error("logo load failed"));
          img.src = logoDataUrl;
        });

        const canvas = document.getElementById("c");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Soft brand gradient (not pure black)
        const g = ctx.createLinearGradient(0, 0, size, size);
        g.addColorStop(0, BG_TOP);
        g.addColorStop(0.45, BG_ACCENT);
        g.addColorStop(1, BG_BOTTOM);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);

        // Subtle radial vignette toward center glow
        const rg = ctx.createRadialGradient(
          size * 0.5,
          size * 0.42,
          size * 0.05,
          size * 0.5,
          size * 0.5,
          size * 0.72
        );
        rg.addColorStop(0, "rgba(90, 40, 90, 0.28)");
        rg.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, size, size);

        const pad = size * padRatio;
        const box = size - pad * 2;
        const scale = Math.min(box / img.width, box / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (size - dw) / 2;
        const dy = (size - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);

        if (circleOverlay) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          // redraw clipped preview into a temp by darkening outside via second pass —
          // For evidence we instead stroke the safe circle after restoring.
          ctx.restore();

          // Dim outside circle
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, size, size);
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fill();
          ctx.restore();

          // Safe-zone ring (~80% diameter)
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 120, 200, 0.85)";
          ctx.lineWidth = Math.max(2, size * 0.008);
          ctx.setLineDash([size * 0.02, size * 0.015]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Outer circle edge
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = Math.max(2, size * 0.006);
          ctx.stroke();
        }

        const dataUrl = canvas.toDataURL("image/png");
        return {
          dataUrl,
          meta: {
            size,
            padRatio,
            imgW: img.width,
            imgH: img.height,
            drawW: Math.round(dw),
            drawH: Math.round(dh),
          },
        };
      },
      {
        size,
        padRatio,
        logoDataUrl,
        BG_TOP,
        BG_BOTTOM,
        BG_ACCENT,
        circleOverlay: !!circleOverlay,
      }
    );

    const b64 = result.dataUrl.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    const outAbs = path.join(ROOT, outRel);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, buf);
    console.log("Wrote", outRel, buf.length, "bytes", result.meta);
    return { outRel, bytes: buf.length, buf, meta: result.meta };
  };

  // any: ~10–12% padding (clearer / larger subject)
  const anyPad = 0.11;
  // maskable: ~20% padding each side → subject in center ~80%
  const maskPad = 0.2;
  // iOS apple-touch: ~8–12% margin
  const iosPad = 0.1;
  // favicon: slightly tighter so face reads at 32px
  const favPad = 0.06;

  const jobs = [
    { size: 192, padRatio: anyPad, outRel: "public/icons/icon-192.png" },
    { size: 512, padRatio: anyPad, outRel: "public/icons/icon-512.png" },
    { size: 192, padRatio: maskPad, outRel: "public/icons/icon-192-maskable.png" },
    { size: 512, padRatio: maskPad, outRel: "public/icons/icon-512-maskable.png" },
    { size: 180, padRatio: iosPad, outRel: "public/icons/apple-touch-icon.png" },
    { size: 180, padRatio: iosPad, outRel: "public/apple-touch-icon.png" },
    { size: 32, padRatio: favPad, outRel: "public/favicon-32.png" },
  ];

  const written = [];
  for (const job of jobs) {
    written.push(await renderOne(job));
  }

  // favicon.ico from 32png
  const fav32 = written.find((w) => w.outRel.endsWith("favicon-32.png"));
  const ico = pngToIco(fav32.buf);
  const icoRel = "public/favicon.ico";
  fs.writeFileSync(path.join(ROOT, icoRel), ico);
  console.log("Wrote", icoRel, ico.length, "bytes");

  // Evidence previews (copies + maskable circle overlay)
  const previewJobs = [
    { size: 192, padRatio: anyPad, outRel: "docs/pwa-install-accept/icon-previews/any-192.png" },
    { size: 512, padRatio: anyPad, outRel: "docs/pwa-install-accept/icon-previews/any-512.png" },
    {
      size: 512,
      padRatio: maskPad,
      outRel: "docs/pwa-install-accept/icon-previews/maskable-512-circle-overlay.png",
      circleOverlay: true,
    },
    {
      size: 192,
      padRatio: maskPad,
      outRel: "docs/pwa-install-accept/icon-previews/maskable-192-circle-overlay.png",
      circleOverlay: true,
    },
    { size: 180, padRatio: iosPad, outRel: "docs/pwa-install-accept/icon-previews/apple-touch-180.png" },
    { size: 32, padRatio: favPad, outRel: "docs/pwa-install-accept/icon-previews/favicon-32.png" },
  ];
  for (const job of previewJobs) {
    await renderOne(job);
  }

  // Also copy production-bound icon files into evidence folder for side-by-side
  for (const name of [
    "icon-192.png",
    "icon-512.png",
    "icon-192-maskable.png",
    "icon-512-maskable.png",
    "apple-touch-icon.png",
  ]) {
    fs.copyFileSync(path.join(ICONS_DIR, name), path.join(PREVIEW_DIR, "shipped-" + name));
  }
  fs.copyFileSync(path.join(PUBLIC, "favicon-32.png"), path.join(PREVIEW_DIR, "shipped-favicon-32.png"));

  await browser.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    source: "public/og/meowcuijiao-logo-transparent.png",
    background: { top: BG_TOP, accent: BG_ACCENT, bottom: BG_BOTTOM },
    padding: { any: anyPad, maskable: maskPad, ios: iosPad, favicon: favPad },
    outputs: [
      ...jobs.map((j) => j.outRel),
      icoRel,
      ...previewJobs.map((j) => j.outRel),
    ],
  };
  fs.writeFileSync(
    path.join(PREVIEW_DIR, "build-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log("Done. Summary written to docs/pwa-install-accept/icon-previews/build-summary.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
