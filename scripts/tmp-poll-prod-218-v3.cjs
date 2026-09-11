const { chromium } = require("playwright-core");

const TARGET = "https://www.meowcuijiao.com/companion-center.html";
const widths = [375, 390, 393, 430];

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

async function probeHtml() {
  const html = await (await fetch(TARGET, { cache: "no-store" })).text();
  return {
    hallCompact4: html.includes("hallCompact4"),
    hallCompact3: html.includes("hallCompact3"),
    bannerHall2: html.includes("bannerHall2"),
    css: [...html.matchAll(/assets\/[^"']+\.css/g)].map((m) => m[0]).slice(0, 8),
  };
}

async function measure(browser, w) {
  const page = await browser.newPage({
    viewport: { width: w, height: 844 },
    // bypass SW cache a bit
  });
  await page.goto(TARGET + "?_=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".player-card", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4500);
  const data = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".player-card")];
    const first = cards[0];
    const media = first && first.querySelector(".companion-card-media");
    const cs = media ? getComputedStyle(media) : null;
    const vh = window.innerHeight;
    const sheets = [...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.href);
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
      sheets,
    };
  });
  await page.close();
  return data;
}

(async () => {
  const started = Date.now();
  let htmlProbe = null;
  while (Date.now() - started < 8 * 60 * 1000) {
    htmlProbe = await probeHtml();
    console.log(JSON.stringify({ t: new Date().toISOString(), htmlProbe }));
    if (htmlProbe.hallCompact4) break;
    await new Promise((r) => setTimeout(r, 20000));
  }
  if (!htmlProbe || !htmlProbe.hallCompact4) {
    console.error("TIMEOUT waiting for Production hallCompact4");
    process.exit(2);
  }

  const browser = await launch();
  const results = [];
  for (const w of widths) {
    results.push({ width: w, ...(await measure(browser, w)) });
  }
  console.log(JSON.stringify({ target: TARGET, results }, null, 2));
  await browser.close();

  const bad = results.filter(
    (r) =>
      r.hasYiRenZheng ||
      (r.verified && r.verified.length) ||
      !String(r.mediaAR || "").includes("2") ||
      (r.mediaH != null && r.mediaH > 180) ||
      (r.cardH != null && r.cardH >= 390)
  );
  if (bad.length) {
    console.error("PRODUCTION_SMOKE_FAIL", JSON.stringify(bad, null, 2));
    process.exit(3);
  }
  console.log("PRODUCTION_SMOKE_OK");
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
