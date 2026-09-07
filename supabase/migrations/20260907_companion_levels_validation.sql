-- Validate companion_levels visual/pricing fields used by marketplace cards.
-- Frontend reads these via /api/platform/companion-levels and /api/public/companions.levelConfig.

do $$
begin
  if to_regclass('public.companion_levels') is null then
    raise notice 'companion_levels missing — skip validation constraints';
    return;
  end if;

  begin
    alter table public.companion_levels
      add constraint companion_levels_card_background_check
      check (card_background is null or card_background in ('solid', 'gradient', 'glass'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.companion_levels
      add constraint companion_levels_min_price_check
      check (min_price is null or min_price >= 0);
  exception when duplicate_object then null;
  end;

  begin
    alter table public.companion_levels
      add constraint companion_levels_max_price_check
      check (max_price is null or min_price is null or max_price >= min_price);
  exception when duplicate_object then null;
  end;

  begin
    alter table public.companion_levels
      add constraint companion_levels_commission_check
      check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.companion_levels
      add constraint companion_levels_color_hex_check
      check (color is null or color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$');
  exception when duplicate_object then null;
  end;

  begin
    alter table public.companion_levels
      add constraint companion_levels_display_color_hex_check
      check (display_color is null or display_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$');
  exception when duplicate_object then null;
  end;

  begin
    alter table public.companion_levels
      add constraint companion_levels_badge_border_hex_check
      check (badge_border is null or badge_border ~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$');
  exception when duplicate_object then null;
  end;
end $$;

comment on column public.companion_levels.color is 'Marketplace card primary color (admin-managed).';
comment on column public.companion_levels.display_color is 'Marketplace card secondary/display color.';
comment on column public.companion_levels.card_background is 'Card style: solid | gradient | glass.';
comment on column public.companion_levels.badge_border is 'Level badge border color.';
comment on column public.companion_levels.min_price is 'Admin level price band minimum (猫粮).';
comment on column public.companion_levels.max_price is 'Admin level price band maximum (猫粮).';
