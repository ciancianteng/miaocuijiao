-- Discord order voice: persist real invite URL (usable join link).
-- Non-destructive / idempotent.

alter table public.orders
  add column if not exists discord_invite_url text;

alter table public.orders
  add column if not exists discord_invite_code text;

comment on column public.orders.discord_invite_url is
  'Discord invite URL (discord.gg/...) for this order voice channel; parent for multi.';
comment on column public.orders.discord_invite_code is
  'Discord invite code for this order voice channel.';
