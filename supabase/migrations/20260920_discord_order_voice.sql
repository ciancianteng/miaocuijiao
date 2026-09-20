-- Discord private order voice rooms (Phase 1)
-- Backward compatible / non-destructive. Old orders default to game_mic.

alter table public.orders
  add column if not exists voice_mode text;

alter table public.orders
  add column if not exists discord_channel_id text;

alter table public.orders
  add column if not exists discord_channel_status text;

alter table public.orders
  add column if not exists discord_channel_created_at timestamptz;

alter table public.orders
  add column if not exists discord_channel_deleted_at timestamptz;

-- Safe defaults for legacy rows
update public.orders
set voice_mode = 'game_mic'
where voice_mode is null or btrim(voice_mode) = '';

alter table public.orders
  alter column voice_mode set default 'game_mic';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_voice_mode_chk'
  ) then
    alter table public.orders
      add constraint orders_voice_mode_chk
      check (voice_mode is null or voice_mode in ('game_mic', 'discord', 'none'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_discord_channel_status_chk'
  ) then
    alter table public.orders
      add constraint orders_discord_channel_status_chk
      check (
        discord_channel_status is null
        or discord_channel_status in (
          'pending',
          'creating',
          'ready',
          'error',
          'deleted'
        )
      );
  end if;
end $$;

create index if not exists orders_discord_channel_id_idx
  on public.orders (discord_channel_id)
  where discord_channel_id is not null and btrim(discord_channel_id) <> '';

-- orders has no updated_at in current Staging/Prod schema; use created_at.
create index if not exists orders_discord_cleanup_idx
  on public.orders (discord_channel_status, status, created_at)
  where discord_channel_id is not null;

-- User ↔ Discord account bindings (Boss + Companion)
create table if not exists public.user_discord_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  discord_user_id text not null,
  discord_username text,
  discord_avatar text,
  discord_connected_at timestamptz not null default now(),
  discord_access_token_enc text,
  discord_refresh_token_enc text,
  discord_token_expires_at timestamptz,
  guild_joined_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists user_discord_links_discord_user_uidx
  on public.user_discord_links (discord_user_id);

comment on column public.orders.voice_mode is
  'Order voice preference: game_mic | discord | none. Default game_mic.';
comment on column public.orders.discord_channel_id is
  'Discord voice channel id for this order (parent for multi-group).';
comment on table public.user_discord_links is
  'Meow user ↔ Discord user binding for private order voice rooms.';
