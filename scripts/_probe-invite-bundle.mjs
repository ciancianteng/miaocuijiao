const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const html = await (await fetch(`${BASE}/companion/account`)).text();
const scripts = [...html.matchAll(/src="([^"]*companion-workbench[^"]*)"/g)].map((x) => x[1]);
console.log("scripts", scripts);
for (const s of scripts) {
  const u = s.startsWith("http") ? s : `${BASE}${s.startsWith("/") ? "" : "/"}${s}`;
  const js = await (await fetch(u)).text();
  console.log({
    src: s.slice(0, 100),
    len: js.length,
    hasRequery: js.includes("Always target the live node"),
    hasPersonal: js.includes("invite-links?action=personal"),
    hasInviteCard: js.includes("pwInviteCard"),
    hasIsConnectedNearInvite: /pwInviteCard[\s\S]{0,400}isConnected/.test(js),
  });
}
