import fs from "node:fs";
import path from "node:path";
import pg from "pg";

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

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const cols = await c.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema='public' and table_name='payment_orders'
  order by ordinal_position
`);
console.log(JSON.stringify(cols.rows, null, 2));

// Add missing columns expected by recharge.js if needed
const need = [
  ["payment_no", "text"],
  ["boss_id", "uuid"],
  ["amount", "numeric(12,2) not null default 0"],
  ["cat_food_amount", "numeric(12,2) not null default 0"],
  ["paid_cat_food", "numeric(12,2) not null default 0"],
  ["bonus_cat_food", "numeric(12,2) not null default 0"],
  ["campaign_id", "uuid"],
  ["payment_method", "text"],
  ["status", "text not null default 'pending'"],
  ["created_at", "timestamptz not null default now()"],
  ["updated_at", "timestamptz not null default now()"],
];
const have = new Set(cols.rows.map((r) => r.column_name));
const added = [];
for (const [name, type] of need) {
  if (!have.has(name)) {
    await c.query(`alter table public.payment_orders add column if not exists ${name} ${type}`);
    added.push(name);
  }
}
console.log(JSON.stringify({ added }, null, 2));
await c.end();
