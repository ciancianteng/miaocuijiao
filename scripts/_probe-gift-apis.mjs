const bases = [
  "https://www.meowcuijiao.com",
  "https://meow-cuijiao-homepage-staging.vercel.app",
];
const paths = [
  "/api/boss/marketplace?action=list_gifts",
  "/api/boss/marketplace?action=gifts",
  "/api/admin/gifts?action=list",
  "/api/gifts",
  "/gifts.html",
  "/api/boss/gift-orders",
];
for (const base of bases) {
  console.log("\n==", base);
  for (const p of paths) {
    try {
      const r = await fetch(base + p, { headers: { Accept: "application/json" } });
      const t = await r.text();
      console.log(p, r.status, t.slice(0, 120).replace(/\s+/g, " "));
    } catch (e) {
      console.log(p, "ERR", e.message);
    }
  }
}
