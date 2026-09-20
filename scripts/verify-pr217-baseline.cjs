const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "docs", "linglu-pr217-accept");
const BASE = process.env.BASE || "http://127.0.0.1:5180";
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync(OUT, { recursive: true });

const REQUIRED = [
  "妙脆角",
  "在线陪玩",
  "完成订单",
  "好评率",
  "专业陪玩，每一场游戏认真对待，每一位热爱电竞的你。",
  "进入陪玩大厅",
  "联系客服",
  "官方公告",
  "了解俱乐部等级制度",
  "申请成为陪玩",
  "本周人气榜",
  "更多陪玩",
];

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await page.goto(BASE + "/?v=baseline-fix", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5500);

  // Scroll full page so below-fold modules exist in layout/text
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  const report = await page.evaluate(async (required) => {
    const text = document.body.innerText || "";
    const missing = required.filter((k) => !text.includes(k));
    const qmarks = (text.match(/\?{3,}/g) || []).length;
    const img = document.querySelector("img.mcj-hero-image");
    const vp = document.querySelector(".mcj-hero-viewport") || document.querySelector(".mcj-home-hero");
    const src = img ? img.currentSrc || img.getAttribute("src") || "" : "";
    let net = null;
    if (src) {
      try {
        const r = await fetch(src);
        const buf = await r.arrayBuffer();
        net = { status: r.status, bytes: buf.byteLength, ct: r.headers.get("content-type") };
      } catch (e) {
        net = { error: String(e) };
      }
    }
    const box = vp ? vp.getBoundingClientRect() : null;
    return {
      title: (document.querySelector(".home-brand-hero-title") || {}).textContent || "",
      missing,
      qmarks,
      src,
      net,
      nat: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      bannerBox: box
        ? { w: Math.round(box.width), h: Math.round(box.height) }
        : null,
      fallback: img ? img.dataset.bannerFallbackReason || "" : "",
      dots: document.querySelectorAll(".mcj-hero-dots button").length,
    };
  }, REQUIRED);

  await page.evaluate((m) => {
    const vp = document.querySelector(".mcj-hero-viewport");
    if (!vp || !m) return;
    const tag = document.createElement("div");
    tag.textContent = m.w + " × " + m.h;
    Object.assign(tag.style, {
      position: "absolute",
      left: "8px",
      bottom: "8px",
      zIndex: "30",
      padding: "4px 8px",
      borderRadius: "8px",
      background: "rgba(0,0,0,.75)",
      color: "#fff",
      fontSize: "11px",
      fontWeight: "700",
      pointerEvents: "none",
    });
    vp.appendChild(tag);
  }, report.bannerBox);

  await page.screenshot({
    path: path.join(OUT, "01-390-home-hero-top.png"),
    clip: { x: 0, y: 0, width: 390, height: 560 },
  });
  const by = report.bannerBox ? Math.max(0, report.bannerBox.top || 300) : 300;
  // recompute top
  const top = await page.evaluate(() => {
    const vp = document.querySelector(".mcj-hero-viewport");
    return vp ? Math.max(0, vp.getBoundingClientRect().top - 12) : 300;
  });
  await page.screenshot({
    path: path.join(OUT, "02-390-banner-carousel.png"),
    clip: { x: 0, y: top, width: 390, height: 210 },
  });

  const pass =
    report.missing.length === 0 &&
    report.qmarks === 0 &&
    report.net &&
    report.net.status === 200 &&
    report.nat &&
    report.nat.w >= 200 &&
    report.bannerBox &&
    report.bannerBox.h >= 140 &&
    report.bannerBox.h <= 160;

  fs.writeFileSync(
    path.join(OUT, "baseline-verify.json"),
    JSON.stringify({ base: BASE, pass, report }, null, 2)
  );
  console.log(JSON.stringify({ pass, report }, null, 2));
  await browser.close();
  if (!pass) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
