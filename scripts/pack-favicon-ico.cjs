/**
 * Pack multi-size favicon.ico from existing PNGs (32 + 48 + 192).
 * 48 is downscaled from icon-192 via Chromium canvas.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "favicon.ico");

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(
      process.env.USERPROFILE || "",
      "AppData/Local/ms-playwright/chromium-1148/chrome-win/chrome.exe"
    ),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Multi-PNG ICO (Vista+). */
function pngsToIco(pngBuffersWithSize) {
  const count = pngBuffersWithSize.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngBuffersWithSize) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngBuffersWithSize.map((x) => x.buf)]);
}

async function resizePng(exe, srcPngPath, size) {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  const b64 = fs.readFileSync(srcPngPath).toString("base64");
  const dataUrl = "data:image/png;base64," + b64;
  const outB64 = await page.evaluate(
    async ({ dataUrl, size }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { dataUrl, size }
  );
  await browser.close();
  return Buffer.from(outB64, "base64");
}

async function main() {
  const exe = findChrome();
  if (!exe) {
    console.error("No Chromium/Edge for favicon pack");
    process.exit(1);
  }
  const png32 = fs.readFileSync(path.join(PUBLIC, "favicon-32.png"));
  const png192 = fs.readFileSync(path.join(PUBLIC, "icons", "icon-192.png"));
  const png48 = await resizePng(exe, path.join(PUBLIC, "icons", "icon-192.png"), 48);
  const ico = pngsToIco([
    { size: 32, buf: png32 },
    { size: 48, buf: png48 },
    { size: 192, buf: png192 },
  ]);
  fs.writeFileSync(OUT, ico);
  console.log("Wrote", OUT, "bytes", ico.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
