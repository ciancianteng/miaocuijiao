import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const OUT = path.resolve("scripts/tmp-layout-shots");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function shot(name, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

await shot("pw00002-home.png", `${BASE}/`);
await shot("pw00002-hall.png", `${BASE}/companion-center.html`);
await shot("pw00002-detail.png", `${BASE}/profile.html?player=PW00002`);

// Also capture API truth
const pub = await (await fetch(`${BASE}/api/public/companions?id=PW00002`, { cache: "no-store" })).json();
const c = pub.companions?.[0] || null;
fs.writeFileSync(
  path.join(OUT, "pw00002-public-api.json"),
  JSON.stringify(
    {
      name: c?.name,
      price: c?.price,
      level: c?.level,
      game: c?.game,
      voiceType: c?.voiceType,
      gender: c?.gender,
      tags: c?.tags,
      certTags: (c?.certTags || []).map((t) => t.name || t.id),
      avatar: c?.avatar,
      cover: c?.cover,
      galleryCount: (c?.gallery || []).length,
      hasVoice: !!c?.voiceUrl,
      featured: c?.featured,
    },
    null,
    2
  )
);
console.log("api", c?.name, c?.price, c?.level, c?.game);

await browser.close();
