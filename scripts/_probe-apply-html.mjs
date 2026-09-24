const r = await fetch("https://meow-cuijiao-homepage-staging.vercel.app/companion-apply.html");
const t = await r.text();
console.log(
  "all scripts",
  [...t.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1])
);
console.log("voiceConfirm1", t.includes("voiceConfirm1"));
console.log("has root", t.includes("companionApplyRoot"));
