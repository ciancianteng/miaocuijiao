const { chromium } = require("playwright-core");

const widths = [375, 390, 393, 430];
const TARGET =
  process.env.HALL_URL ||
  "https://meow-cuijiao-homepage-git-fi-a57b94-ciancianteng-4581s-projects.vercel.app/companion-center.html";

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (_) {
    try {
      return await chromium.launch({ channel: "msedge", headless: true });
    } catch (__) {
      return await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
    }
  }
}

(async () => {
  const html = await (await fetch(TARGET)).text();
  const assets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  console.log(
    JSON.stringify(
      {
        htmlProbe: {
          hallCompact4: html.includes("hallCompact4"),
          hallCompact3: html.includes("hallCompact3"),
          bannerHall2: html.includes("bannerHall2"),
          css: assets.filter((u) => /\.css/.test(u)).slice(0, 12),
        },
      },
      null,
      2
    )
  );

  const browser = await launch();
  const results = [];
  for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 } });
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".player-card", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const data = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".player-card")];
      const first = cards[0];
      const media = first && first.querySelector(".companion-card-media");
      const cs = media ? getComputedStyle(media) : null;
      const vh = window.innerHeight;
      return {
        cardH: first ? first.offsetHeight : null,
        cardRatio: first ? +(first.offsetHeight / vh).toFixed(3) : null,
        mediaAR: cs ? cs.aspectRatio : null,
        mediaH: media ? media.offsetHeight : null,
        mediaMaxH: cs ? cs.maxHeight : null,
        verified: [...document.querySelectorAll(".mcj-verified-badge")].map((el) => el.textContent.trim()),
        hasYiRenZheng: document.body.innerText.includes("已认证"),
        visibleApprox: cards.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.top < vh && r.bottom > 40;
        }).length,
      };
    });
    results.push({ width: w, ...data });
    await page.close();
  }
  console.log(JSON.stringify({ target: TARGET, results }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
