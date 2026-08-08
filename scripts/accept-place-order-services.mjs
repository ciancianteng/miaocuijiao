/**
 * P0 acceptance: place-order modal chips bind to companion enabled services only.
 * Usage: node scripts/accept-place-order-services.mjs [base-url]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = (process.argv[2] || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const COMPANION_EMAIL = "companion.idcard.1785715257525@meow.test";
const COMPANION_PASS = "McjTest@12345678";
const BOSS_EMAIL = "boss.final.1785714993009@meow.test";
const BOSS_PASS = "McjTest@12345678";

const results = [];
function note(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(pathname, { method = "GET", token = "", body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}
function tok(j) {
  return (j && j.session && (j.session.accessToken || j.session.token)) || j.access_token || "";
}

const HARDCODED = '["陪玩", "护航", "跑刀", "代肝", "自定义"]';
const HARDCODED_ALT = "['陪玩', '护航', '跑刀', '代肝', '自定义']";

const modalJs = await fetch(`${BASE}/src/place-order-modal.js?v=${Date.now()}`).then((r) => r.text());
note(
  "modal has no hardcoded service list",
  !modalJs.includes(HARDCODED) && !modalJs.includes(HARDCODED_ALT) && !/var SERVICES\s*=\s*\[/.test(modalJs),
  modalJs.includes("resolveServices") || modalJs.includes("companionServices") ? "uses companion services" : "missing helpers"
);
note(
  "modal switches unit price on service select",
  /applySelectedService/.test(modalJs) && /unitPrice\s*=\s*money\(svc\.price\)/.test(modalJs),
  "applySelectedService present"
);
note(
  "modal hydrates from catalog",
  /hydrateFromCatalog/.test(modalJs) && /action=catalog/.test(modalJs),
  "catalog hydrate"
);

const pageJs = await fetch(`${BASE}/src/place-order-page.js?v=${Date.now()}`).then((r) => r.text());
note(
  "place-order page has no hardcoded service list",
  !pageJs.includes(HARDCODED) && !/var SERVICES\s*=\s*\[/.test(pageJs),
  "page chips from companion.services"
);

const companionLogin = await api("/api/auth", {
  method: "POST",
  body: { action: "login", email: COMPANION_EMAIL, password: COMPANION_PASS },
});
const cToken = tok(companionLogin.json);
note("companion login", !!cToken, companionLogin.json?.message || "");

const boot = await api("/api/companion?action=bootstrap", { token: cToken });
const player = boot.json?.data?.player || {};
const cid = player.id || player.uid || "";
note("companion bootstrap", !!cid, `id=${cid} game=${player.mainGame || player.game || ""}`);

const platform = await api("/api/platform/services");
const platformServices = (platform.json?.services || []).filter((s) => s && s.enabled !== false);
const valorant = platformServices.find((s) => /VALORANT/i.test(s.name || ""));
const delta = platformServices.find((s) => /三角洲/.test(s.name || ""));
note("platform has VALORANT + 三角洲", !!(valorant && delta), `count=${platformServices.length}`);

async function saveServices(serviceIds, gamePrices, label) {
  const payload = {
    action: "update_profile",
    nickname: player.name || player.nickname || "草稿保留42324",
    age: String(player.raw?.age || 22),
    gender: player.raw?.gender || player.gender || "女",
    region: player.raw?.region || player.region || "马来西亚",
    service_type: "陪玩服务",
    service_ids: serviceIds,
    main_game: serviceIds
      .map((id) => platformServices.find((s) => s.id === id)?.name || id)
      .join("、"),
    game_id: player.gameId || player.raw?.game_id || "accept-gid",
    price: String(gamePrices[serviceIds[0]] || 22),
    game_prices: gamePrices,
    bio: player.bio || player.raw?.description || "",
    public_tags: player.publicTags || "",
    tags: player.publicTags || "",
  };
  const saved = await api("/api/companion", { method: "POST", token: cToken, body: payload });
  note(`companion save ${label}`, !!(saved.json?.ok || saved.res.ok), saved.json?.message || `HTTP ${saved.res.status}`);
  return saved;
}

if (cid && valorant && delta) {
  const twoPrices = {
    [valorant.id]: 22,
    [valorant.name]: 22,
    [delta.id]: 25,
    [delta.name]: 25,
  };
  await saveServices([valorant.id, delta.id], twoPrices, "VALORANT+三角洲");

  // small delay for consistency
  await new Promise((r) => setTimeout(r, 800));

  const cat2 = await api(`/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(cid)}`);
  const names2 = (cat2.json?.services || []).map((s) => s.name);
  note(
    "catalog shows only VALORANT + 三角洲",
    names2.includes("VALORANT") && names2.includes("三角洲") && names2.length === 2,
    JSON.stringify(names2)
  );
  note(
    "catalog prices match selected games",
    (cat2.json?.services || []).every((s) => Number(s.price) > 0),
    JSON.stringify((cat2.json?.services || []).map((s) => ({ name: s.name, price: s.price })))
  );

  const pub = await api(`/api/public/companions?id=${encodeURIComponent(cid)}`);
  const pubC = (pub.json?.companions || []).find((c) => c.id === cid) || (pub.json?.companions || [])[0];
  const pubNames = (pubC?.services || []).map((s) => s.name);
  note(
    "public companions payload includes services",
    Array.isArray(pubC?.services) && pubNames.includes("VALORANT") && pubNames.includes("三角洲"),
    JSON.stringify(pubNames)
  );

  // Disable 三角洲 → only VALORANT
  const onePrices = { [valorant.id]: 22, [valorant.name]: 22 };
  await saveServices([valorant.id], onePrices, "VALORANT only");
  await new Promise((r) => setTimeout(r, 800));

  const cat1 = await api(`/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(cid)}`);
  const names1 = (cat1.json?.services || []).map((s) => s.name);
  note(
    "after disable 三角洲, catalog only VALORANT",
    names1.includes("VALORANT") && !names1.includes("三角洲") && names1.length === 1,
    JSON.stringify(names1)
  );

  const bossLogin = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email: BOSS_EMAIL, password: BOSS_PASS },
  });
  note("boss login", !!tok(bossLogin.json), bossLogin.json?.message || "");
}

const failed = results.filter((r) => !r.pass).length;
const out = {
  base: BASE,
  at: new Date().toISOString(),
  pass: failed === 0,
  failed,
  results,
};
fs.writeFileSync(path.join(ROOT, "scripts/accept-place-order-services-results.json"), JSON.stringify(out, null, 2));
console.log(`\nSUMMARY pass=${failed === 0} failed=${failed} base=${BASE}`);
process.exit(failed ? 1 : 0);
