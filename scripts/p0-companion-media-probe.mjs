/**
 * Probe companion profile / media / withdraw on Preview.
 * Usage: node scripts/p0-companion-media-probe.mjs [preview-base-url]
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/$/, "");

function loadEnv(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP = process.env.MCJ_TEST_COMPANION_EMAIL || "companion@meow.test";

if (!BASE || !url || !anon) {
  console.error("missing BASE or supabase env");
  process.exit(1);
}

async function login(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function api(path, token, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 240) };
  }
  return { res, body };
}

const auth = await login(COMP);
const token = auth.access_token;
const boot = await api("/api/companion?action=bootstrap", token);
const p = boot.body.data?.player || {};
const raw = p.raw || {};
const level = boot.body.data?.levelInfo || {};
const perms = boot.body.data?.permissions || {};
const rules = boot.body.data?.withdrawalRules || {};
const minP = Number(level.minPrice ?? 20);
const maxP = Number(level.maxPrice ?? 30);
const maxPlus = !!level.maxPlus;
let price = Number(level.price ?? p.rawPrice ?? p.price ?? 25);
if (!Number.isFinite(price) || price < minP || (!maxPlus && price > maxP)) price = minP;
console.log(
  "BOOT",
  JSON.stringify({
    name: p.name,
    voiceUrl: p.voiceUrl || raw.voice_url || "",
    price: p.price,
    game: p.mainGame,
    canWithdraw: perms.canWithdraw,
    withdrawLock: perms.withdrawLockReason,
    approvedAccounts: (rules.approvedAccounts || []).length,
    withdrawable: boot.body.data?.earnings?.withdrawable ?? boot.body.data?.summary?.withdrawable,
  })
);
const full = {
  action: "update_profile",
  nickname: String(p.name || "TEST陪玩"),
  age: String(raw.age || 23),
  gender: String(raw.gender || "女"),
  region: String(raw.region || "马来西亚·吉隆坡"),
  contact_phone: String(raw.contact_phone || "012-3456789"),
  main_game: String(p.mainGame || raw.game || "Valorant"),
  game_id: String(p.gameId || raw.game_id || "CMP001"),
  rank: String(raw.game_rank || raw.rank || ""),
  position: String(raw.position || ""),
  bio: String(p.bio || "P0验收"),
  price: String(price),
};
const up = await api("/api/companion", token, { method: "POST", body: JSON.stringify(full) });
console.log("UPDATE_PROFILE", up.res.status, up.body.message || JSON.stringify(up.body).slice(0, 200));

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const av = await api("/api/companion", token, {
  method: "POST",
  body: JSON.stringify({ action: "upload_media", media_type: "avatar", data_url: tinyPng, filename: "p0-avatar.png" }),
});
console.log("AVATAR", av.res.status, av.body.message || JSON.stringify(av.body).slice(0, 200), "url=", !!av.body.url);

const gal = await api("/api/companion", token, {
  method: "POST",
  body: JSON.stringify({ action: "upload_media", media_type: "gallery", data_url: tinyPng, filename: "p0-gal.png" }),
});
console.log("GALLERY", gal.res.status, gal.body.message || JSON.stringify(gal.body).slice(0, 200), "url=", !!gal.body.url);

const wav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const vo = await api("/api/companion", token, {
  method: "POST",
  body: JSON.stringify({ action: "upload_media", media_type: "voice", data_url: wav, filename: "p0-voice.wav" }),
});
console.log("VOICE", vo.res.status, vo.body.message || JSON.stringify(vo.body).slice(0, 300), "url=", !!vo.body.url);

const wd = await api("/api/companion", token, {
  method: "POST",
  body: JSON.stringify({ action: "request_withdrawal", amount: 50, remark: "P0 probe" }),
});
console.log("WITHDRAW", wd.res.status, wd.body.message || JSON.stringify(wd.body).slice(0, 200));

const boot2 = await api("/api/companion?action=bootstrap", token);
const p2 = boot2.body.data?.player || {};
console.log(
  "AFTER",
  JSON.stringify({
    voiceUrl: p2.voiceUrl || p2.raw?.voice_url || "",
    hasCustomAvatar: !!p2.hasCustomAvatar,
    media: (boot2.body.data?.media || []).map((m) => m.mediaType),
  })
);
