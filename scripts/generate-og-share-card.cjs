/**
 * Generate dedicated WeChat/OG share preview cards (not homepage screenshots).
 * Outputs stable public URLs under /og/*.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "og");
const BRAND = path.join(ROOT, "assets", "meow-cuijiao-brand.jpg");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

fs.mkdirSync(OUT_DIR, { recursive: true });

function brandDataUrl() {
  const buf = fs.readFileSync(BRAND);
  return "data:image/jpeg;base64," + buf.toString("base64");
}

function cardHtml({ width, height, mode }) {
  const img = brandDataUrl();
  const isSquare = mode === "square";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#09070c;}
  .wrap{
    width:${width}px;height:${height}px;box-sizing:border-box;
    display:flex;align-items:center;justify-content:center;gap:${isSquare ? 0 : 48}px;
    padding:${isSquare ? "48px" : "56px 72px"};
    background:
      radial-gradient(ellipse 55% 70% at 78% 42%, rgba(255,126,189,.28), transparent 62%),
      radial-gradient(ellipse 40% 50% at 12% 20%, rgba(255,158,207,.12), transparent 60%),
      linear-gradient(160deg, #120b14 0%, #09070c 55%, #050406 100%);
    font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;color:#fff8fc;
  }
  .copy{flex:1;min-width:0;max-width:${isSquare ? "100%" : "620px"};}
  .kicker{margin:0 0 14px;font-size:${isSquare ? 18 : 22}px;letter-spacing:.28em;font-weight:700;color:rgba(255,214,232,.72);text-transform:uppercase;}
  .title{margin:0;font-size:${isSquare ? 42 : 54}px;line-height:1.15;font-weight:900;letter-spacing:.04em;}
  .sub{margin:18px 0 0;font-size:${isSquare ? 20 : 24}px;line-height:1.55;font-weight:650;color:rgba(255,232,242,.82);max-width:18em;}
  .domain{margin-top:28px;display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;border:1px solid rgba(255,214,232,.22);background:rgba(255,255,255,.04);font-size:16px;font-weight:700;color:#ffd6e9;letter-spacing:.04em;}
  .visual{flex:0 0 auto;width:${isSquare ? 280 : 360}px;height:${isSquare ? 280 : 360}px;border-radius:36px;overflow:hidden;border:2px solid rgba(255,158,207,.35);box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 40px rgba(255,126,189,.18);background:#1a1018;}
  .visual img{width:100%;height:100%;object-fit:cover;display:block;}
  ${isSquare ? `.wrap{flex-direction:column;text-align:center}.copy{order:2}.visual{order:1;margin-bottom:28px}.sub{margin-left:auto;margin-right:auto}.domain{margin-left:auto;margin-right:auto}` : ""}
</style>
</head>
<body>
  <div class="wrap">
    <div class="copy">
      <p class="kicker">MEOW CUI JIAO</p>
      <h1 class="title">妙脆角｜专业游戏陪玩</h1>
      <p class="sub">专业陪玩，每一场游戏认真对待每一位热爱电竞的你。</p>
      <div class="domain">meowcuijiao.com</div>
    </div>
    <div class="visual"><img src="${img}" alt=""></div>
  </div>
</body>
</html>`;
}

async function shoot(page, file, width, height, mode) {
  await page.setViewportSize({ width, height });
  await page.setContent(cardHtml({ width, height, mode }), { waitUntil: "load" });
  await page.waitForTimeout(200);
  const out = path.join(OUT_DIR, file);
  await page.screenshot({ path: out, type: "jpeg", quality: 88 });
  const size = fs.statSync(out).size;
  console.log("wrote", file, size, "bytes");
}

(async () => {
  if (!fs.existsSync(BRAND)) throw new Error("missing brand asset: " + BRAND);
  if (!fs.existsSync(EDGE)) throw new Error("Edge not found");
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  await shoot(page, "share-card.jpg", 1200, 630, "wide");
  await shoot(page, "share-card-square.jpg", 600, 600, "square");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
