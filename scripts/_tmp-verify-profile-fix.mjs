const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const COMPANION_ID = "592ec1d2-5357-42af-b4d3-dc4136fd10f4";
const EMAIL = "companion.idcard.1785715257525@meow.test";
const PASS = "McjTest@12345678";

async function main() {
  const pub = await fetch(`${BASE}/api/public/companions?id=${encodeURIComponent(COMPANION_ID)}`, {
    headers: { Accept: "application/json" },
  }).then((r) => r.json());
  const c = pub.companion || pub.player || pub.data || pub;
  const keys = Object.keys(c || {});
  console.log("PUBLIC_OK", pub.ok !== false, {
    name: c.name || c.displayName || c.nickname,
    age: c.age,
    region: c.region,
    bio: String(c.bio || "").slice(0, 60),
    tags: c.tags || c.publicTags,
  });
  console.log("PUBLIC_KEYS_SAMPLE", keys.slice(0, 50));
  const bad = keys.filter((k) =>
    /contact|phone|id_card|identity_no|bank|deposit|tng|real_name|id_front|id_back/i.test(k)
  );
  console.log("PRIVACY_KEYS", bad);
  for (const k of bad) console.log(" ", k, "=", JSON.stringify(c[k]).slice(0, 120));

  const html = await fetch(`${BASE}/companion/profile/`).then((r) => r.text());
  const jsMatch = html.match(/src="([^"]*companion-workbench[^"]*)"/);
  console.log("PROFILE_HAS_WB", !!jsMatch, jsMatch?.[1]);
  if (jsMatch) {
    const jsUrl = jsMatch[1].startsWith("http") ? jsMatch[1] : BASE + jsMatch[1];
    const js = await fetch(jsUrl).then((r) => r.text());
    console.log("FIX_MARKERS", {
      profileDraft: js.includes("profileDraft"),
      isEditing: js.includes("isEditingProfileForm"),
      softToast: js.includes("Avoid full paint"),
      capture: js.includes("captureLiveForms"),
    });
  }

  // UI-ish persistence simulation: draft helpers exist; also re-login + bootstrap persistence
  const login = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account: EMAIL, password: PASS, remember: true }),
  }).then((r) => r.json());
  const token = login.session?.accessToken || login.session?.token;
  const boot = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { "x-mcj-companion-token": token, Accept: "application/json" },
  }).then((r) => r.json());
  const p = boot.data?.player || {};
  console.log("RELOGIN_BOOT", {
    name: p.name,
    age: p.raw?.age,
    region: p.raw?.region,
    bio: String(p.bio || "").slice(0, 60),
    gameId: p.gameId || p.raw?.game_id,
    tags: p.publicTags,
    level: boot.data?.levelInfo?.level,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
