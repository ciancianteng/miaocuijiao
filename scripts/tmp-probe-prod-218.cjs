(async () => {
  const html = await (await fetch("https://www.meowcuijiao.com/companion-center.html")).text();
  const assets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => /assets\/|\.css|\.js/.test(u));
  console.log(JSON.stringify({
    sampleAssets: assets.slice(0, 25),
    hasHallCompact3: html.includes("hallCompact3"),
    hasBannerHall2: html.includes("bannerHall2"),
    len: html.length,
  }, null, 2));

  const polish = assets.find((u) => /ui-linglu-polish/.test(u));
  const hall = assets.find((u) => /companion-center|companion-hall/.test(u) && /\.css/.test(u));
  for (const label of [["polish", polish], ["hallBundle", hall]]) {
    const [name, url] = label;
    if (!url) continue;
    const abs = url.startsWith("http") ? url : "https://www.meowcuijiao.com" + (url.startsWith("/") ? url : "/" + url);
    const text = await (await fetch(abs)).text();
    console.log(JSON.stringify({
      name,
      url: abs,
      len: text.length,
      hasBannerMarker: text.includes("Banner+Hall compact"),
      r169: (text.match(/aspect-ratio:\s*16\s*\/\s*9/g) || []).length,
      r21: (text.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
      maxNone: (text.match(/max-height:\s*none/g) || []).length,
      verifiedHideHot: text.includes("hot-recommend-section .mcj-verified-badge"),
    }, null, 2));
  }
})().catch((e) => { console.error(e); process.exit(1); });
