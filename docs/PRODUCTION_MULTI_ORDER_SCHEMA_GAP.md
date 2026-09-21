# Production multi-order schema gap (read-only audit)

Checked against Production Postgres (project `jqfaknpmcnqwqvatrwgo`) on 2026-09-21.

## Applied

| Column / object | Status |
|---|---|
| `orders.parent_order_id` | YES (migration `20260919_orders_parent_order_id.sql`) |

## Missing on Production (code already soft-falls back via description)

| Column / object | Repo migration | Needed for |
|---|---|---|
| `orders.voice_mode` | `20260920_discord_order_voice.sql` | Discord vs 游戏麦 column SoT |
| `orders.discord_channel_*` | same | Discord join room persistence |
| `public.user_discord_links` | same | Discord OAuth binding |
| `orders.game_id_value` | `supabase/companion-marketplace.sql` (not a dated migration) | Structured game ID (today snapshotted as `游戏ID：…` in `description`) |
| `orders.service_name` | companion-marketplace.sql | Structured service name |
| `orders.payment_method` | companion-marketplace / payment migrations | Structured payment method |
| `orders.notes` / `quantity` / `paid_at` / `paid_cat_food` / `pricing_unit` | various | stamps / extras |

## Safe apply steps (WAIT for owner confirmation — do NOT run from this agent)

1. Snapshot / backup Production `orders` (and related).
2. Apply in order (non-destructive `ADD COLUMN IF NOT EXISTS`):
   - `supabase/migrations/20260920_discord_order_voice.sql`
   - Optionally promote `game_id_value` / `service_name` / `payment_method` / `notes` / `quantity` / `paid_at` / `paid_cat_food` from `supabase/companion-marketplace.sql` into a dated pending-prod migration after review.
3. Verify with:
   ```sql
   select column_name from information_schema.columns
   where table_schema='public' and table_name='orders'
     and column_name in ('voice_mode','game_id_value','service_name','payment_method','paid_cat_food');
   ```
4. Smoke one Staging multi-order with Discord before Production.

## Until applied

`place_multi_order` now retries without optional columns and keeps:
- `游戏ID：…`
- `语音方式：Discord语音房|游戏麦`
- price snapshots

inside `description` so companion / boss UIs that parse description keep working.
