/**
 * Ensure payment_methods exists + seed one manual method for meeting recharge demo.
 * Idempotent. Does not invent third-party API credentials — uses manual/offline category.
 * Hard-guarded against Production.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

const ROOT = process.cwd();
guardAfterEnvLoad("seed-payment-methods.mjs");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const report = { at: new Date().toISOString(), actions: [] };

await c.query(`
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  is_enabled boolean not null default false,
  sort_order integer not null default 100,
  mode text not null default 'test',
  api_base_url text not null default '',
  merchant_id text not null default '',
  api_key text not null default '',
  api_secret text not null default '',
  callback_secret text not null default '',
  redirect_url text not null default '',
  callback_url text not null default '',
  category text not null default 'api',
  updated_at timestamptz not null default now()
);
`);
report.actions.push("ensure_table_payment_methods");

const cols = await c.query(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='payment_methods'
`);
const names = new Set(cols.rows.map((r) => r.column_name));
for (const col of [
  ["category", "text not null default 'api'"],
  ["mode", "text not null default 'test'"],
  ["api_base_url", "text not null default ''"],
  ["merchant_id", "text not null default ''"],
  ["api_key", "text not null default ''"],
  ["api_secret", "text not null default ''"],
  ["callback_secret", "text not null default ''"],
  ["redirect_url", "text not null default ''"],
  ["callback_url", "text not null default ''"],
]) {
  if (!names.has(col[0])) {
    await c.query(`alter table public.payment_methods add column if not exists ${col[0]} ${col[1]}`);
    report.actions.push("add_column_" + col[0]);
  }
}

// Ensure payment_orders exists lightly (used by recharge create)
await c.query(`
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  payment_no text,
  boss_id uuid,
  method_code text,
  amount numeric(12,2) not null default 0,
  currency text not null default 'MYR',
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
report.actions.push("ensure_table_payment_orders");

const existing = await c.query(`select code, name, is_enabled, category from public.payment_methods order by sort_order`);
report.before = existing.rows;

if (!existing.rowCount) {
  const ins = await c.query(`
    insert into public.payment_methods
      (code, name, is_enabled, sort_order, mode, category, redirect_url)
    values
      ('manual_tng', 'Touch n Go / 人工确认', true, 1, 'live', 'manual', '/recharge.html')
    returning code, name, is_enabled, category
  `);
  report.actions.push({ inserted: ins.rows[0] });
} else {
  const enabled = existing.rows.filter((r) => r.is_enabled);
  if (!enabled.length) {
    const upd = await c.query(`
      update public.payment_methods
      set is_enabled = true, updated_at = now()
      where code = $1
      returning code, name, is_enabled
    `, [existing.rows[0].code]);
    report.actions.push({ enabledExisting: upd.rows[0] });
  } else {
    report.actions.push({ ok_existing_enabled: enabled.map((r) => r.code) });
  }
}

const campaigns = await c.query(`select id, name, enabled, pay_amount_rm, base_cat_food from public.recharge_campaigns where enabled=true`);
report.campaigns = campaigns.rows;
report.after = (await c.query(`select code, name, is_enabled, category, mode from public.payment_methods order by sort_order`)).rows;

fs.writeFileSync(path.join(ROOT, "scripts/seed-payment-methods-results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await c.end();
