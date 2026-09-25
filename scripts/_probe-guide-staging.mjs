#!/usr/bin/env node
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const pages = [
  "/guide.html",
  "/guide.html?role=boss",
  "/guide.html?role=companion",
  "/guide",
  "/companion/login/",
];
for (const p of pages) {
  const r = await fetch(BASE + p, { redirect: "follow" });
  const t = await r.text();
  const m = t.match(/guide-tutorial(?:-config|-css)?\.js\?v=([^"']+)/);
  const m2 = t.match(/guide-tutorial\.css\?v=([^"']+)/);
  console.log(
    JSON.stringify({
      path: p,
      status: r.status,
      final: r.url,
      hasRoot: t.includes("mcjGuideRoot"),
      cacheJs: m ? m[1] : null,
      cacheCss: m2 ? m2[1] : null,
      len: t.length,
    })
  );
}
