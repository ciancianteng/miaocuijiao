const u = "https://meow-cuijiao-homepage-staging.vercel.app";

async function login(account) {
  const r = await fetch(`${u}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account, password: "McjTest@12345678" }),
  });
  const j = await r.json();
  if (!j?.session?.token && !j?.session?.accessToken) {
    // try CS login endpoint
    const r2 = await fetch(`${u}/api/customer-service`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", account, password: "McjTest@12345678" }),
    });
    return r2.json();
  }
  return j;
}

const cs = await login("service.final.1785714993009@meow.test");
const token = cs?.session?.token || cs?.session?.accessToken;
console.log("cs login", !!token, cs?.ok, cs?.message || "");

const boot = await fetch(`${u}/api/customer-service`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ action: "bootstrap" }),
}).then((r) => r.json());

const bosses = boot.data?.bosses || [];
const comps = boot.data?.companions || [];
const convs = boot.data?.conversations || [];
const orders = boot.data?.orders || [];

const emailishBosses = bosses.filter((x) => /@/.test(String(x.bossName || x.name || "")));
const emailishConvs = convs.filter((c) => /@/.test(String(c.bossName || "")));
const emailishOrders = orders.filter((o) => /@/.test(String(o.bossName || "")));

console.log(
  JSON.stringify(
    {
      bosses: bosses.length,
      emailishBosses: emailishBosses.slice(0, 5),
      emailishConvs: emailishConvs.slice(0, 5).map((c) => ({ n: c.bossName, u: c.bossUid })),
      emailishOrders: emailishOrders.slice(0, 5).map((o) => ({ n: o.bossName, no: o.orderNo })),
      sampleBoss: bosses.find((b) => /MCJ|final|boss/i.test(JSON.stringify(b))) || bosses[0],
      compSample: comps.slice(0, 3).map((c) => ({
        name: c.name,
        uid: c.companionUid,
        code: c.companionCode,
        publicId: c.publicId,
        id: c.id,
      })),
      pw00002: comps.filter(
        (c) =>
          String(c.companionCode || c.publicId || "") === "PW00002" ||
          String(c.companionUid) === "2" ||
          Number(c.companionUid) === 2
      ),
      companionConvs: convs
        .filter((c) => c.conversationType === "companion_support")
        .slice(0, 5)
        .map((c) => ({
          id: c.id,
          name: c.bossName,
          svc: c.currentServiceId,
          unread: c.unread,
          last: c.lastMessage,
        })),
    },
    null,
    2
  )
);
