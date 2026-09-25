const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const h = await (await fetch(`${STG}/companion-hall.html?cb=${Date.now()}`, { cache: "no-store" })).text();
console.log("len", h.length);
console.log("scripts", [...h.matchAll(/src=\"([^\"]+)\"/g)].map((m) => m[1]).filter((s) => /hall|site-data|companion/i.test(s)).slice(0, 20));

const r = await fetch(`${STG}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "login", email: "admin@meow.test", password: "McjTest@12345678", role: "admin" }),
});
const j = await r.json();
const t = j.session?.accessToken;
const cfg = await fetch(`${STG}/api/admin/service-accounts?action=commission_config`, {
  headers: { Authorization: `Bearer ${t}`, "x-mcj-admin-role": "admin" },
});
console.log("cfg", cfg.status, JSON.stringify(await cfg.json()).slice(0, 800));

const boss = await (
  await fetch(`${STG}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: "organic.boss@mcj-staging-organic.invalid",
      password: "OrganicGoLive!Mcj2026",
      role: "boss",
    }),
  })
).json();
const bt = boss.session?.accessToken;
const pubs = await (await fetch(`${STG}/api/public/companions`)).json();
const comps = pubs.companions || [];
const a = comps[0];
const b = comps.find((c) => c.id !== a?.id);
console.log(
  "comps",
  comps.slice(0, 2).map((c) => ({
    id: c.id,
    price: c.price,
    services: c.services?.[0],
  }))
);
const multi = await fetch(`${STG}/api/orders`, {
  method: "POST",
  headers: { Authorization: `Bearer ${bt}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "place_multi_order",
    serviceType: "默认服务",
    game: "默认服务",
    gameId: "PROBE1",
    note: "[FINANCE-P0] probe multi",
    companions: [
      { companionId: a.id, companionName: a.name || "A", unitPrice: Number(a.price || 20), hours: 1, quantity: 1 },
      { companionId: b.id, companionName: b.name || "B", unitPrice: Number(b.price || 20), hours: 1, quantity: 1 },
    ],
  }),
});
const mj = await multi.json();
console.log("multi keys", Object.keys(mj));
console.log("multi slice", JSON.stringify(mj).slice(0, 600));
