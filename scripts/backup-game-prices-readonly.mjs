import fs from "node:fs";
import path from "node:path";

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"|"$/g, "").trim();
  }
  return out;
}

const env = loadEnv(".env.local");
const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!base || !key) {
  console.error("missing supabase env");
  process.exit(1);
}
const ref = base.replace(/^https?:\/\//, "").split(".")[0];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join("backups", `game-prices-${ref}-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
};

async function getAll(table, select, { order = "id.asc", pageSize = 1000 } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const url = `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${encodeURIComponent(order)}&offset=${from}&limit=${pageSize}`;
    const res = await fetch(url, { headers: { ...headers, Range: `${from}-${to}`, Prefer: "count=exact" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${table} ${res.status} ${text.slice(0, 200)}`);
    const chunk = text ? JSON.parse(text) : [];
    rows.push(...chunk);
    if (!Array.isArray(chunk) || chunk.length < pageSize) break;
  }
  return rows;
}

const profiles = await getAll(
  "companion_profiles",
  "user_id,nickname,price,game_prices,tags,level_id,level_name,updated_at",
  { order: "user_id.asc" }
);
const levels = await getAll("companion_levels", "*", { order: "sort_order.asc" });

const snapshot = {
  createdAt: new Date().toISOString(),
  supabaseRef: ref,
  readOnly: true,
  note: "Scheme A recovery point — game_prices backup before level markupAllowance admin change. Do not use to batch-write.",
  companionCount: profiles.length,
  levelCount: levels.length,
};

fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(snapshot, null, 2));
fs.writeFileSync(path.join(outDir, "companion_profiles_game_prices.json"), JSON.stringify(profiles, null, 2));
fs.writeFileSync(path.join(outDir, "companion_levels.json"), JSON.stringify(levels, null, 2));

const distinctSample = profiles
  .map((p) => {
    const gp = p.game_prices && typeof p.game_prices === "object" ? p.game_prices : {};
    const vals = [...new Set(Object.keys(gp).filter((k) => !/^[0-9a-f-]{36}$/i.test(k)).map((k) => Number(gp[k])).filter((n) => n > 0))];
    return { user_id: p.user_id, nickname: p.nickname, price: p.price, distinct: vals };
  })
  .filter((x) => x.distinct.length >= 2)
  .slice(0, 20);

fs.writeFileSync(path.join(outDir, "independent-price-sample.json"), JSON.stringify(distinctSample, null, 2));
console.log(JSON.stringify({ outDir, ...snapshot, independentSampleCount: distinctSample.length }, null, 2));
