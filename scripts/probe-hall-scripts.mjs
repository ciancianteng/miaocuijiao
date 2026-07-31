const BASE = process.argv[2] || "https://meow-cuijiao-homepage-jj88uty5m-ciancianteng-4581s-projects.vercel.app";
const html = await fetch(BASE + "/companion-center.html").then((r) => r.text());
const scripts = [...html.matchAll(/src="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((s) => /companion-hall|companion-levels|platform-taxonomy|place-order|role-gates/.test(s));
console.log("scripts", scripts);
for (const s of scripts) {
  const url = s.startsWith("http") ? s : BASE + (s.startsWith("/") ? s : "/" + s);
  const r = await fetch(url);
  const t = await r.text();
  console.log(s, r.status, "bytes=" + t.length);
}
