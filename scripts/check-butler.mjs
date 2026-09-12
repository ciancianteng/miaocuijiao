import { chromium } from "playwright";
const BASE = process.env.PREVIEW_URL || "https://meow-cuijiao-homepage-3cwg33kl1-ciancianteng-4581s-projects.vercel.app";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(3000);
const found = await page.evaluate(() => {
  const text = document.body.innerText || "";
  const nodes = [...document.querySelectorAll(
    "#floatingCustomerService,.floating-cs-button,.floating-service,#mcjButler,[data-mcj-meow-butler],.service-float,.online-service,#floatingService"
  )];
  const allFixed = [...document.querySelectorAll("*")].filter((el) => {
    const s = getComputedStyle(el);
    return s.position === "fixed" && (el.innerText || "").includes("喵");
  }).map((el) => ({ tag: el.tagName, id: el.id, className: String(el.className).slice(0, 80), text: (el.innerText || "").slice(0, 40) }));
  return {
    textHasButler: text.includes("喵管家"),
    nodes: nodes.map((n) => ({ id: n.id, className: String(n.className).slice(0, 80), display: getComputedStyle(n).display, visibility: getComputedStyle(n).visibility })),
    fixed喵: allFixed,
    scripts: [...document.scripts].map((s) => s.src).filter((s) => /butler|floating/i.test(s)),
  };
});
console.log(JSON.stringify(found, null, 2));
await page.screenshot({ path: "tmp/cs-p2-verify/home-desktop-butler-check.png", fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await page.screenshot({ path: "tmp/cs-p2-verify/home-mobile-butler-check.png", fullPage: false });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
await page.screenshot({ path: "tmp/cs-p2-verify/home-mobile-bottom-butler-check.png", fullPage: false });
await browser.close();
