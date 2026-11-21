-- Seed / normalize price-table categories for MCJ club price table tabs.
-- Safe: does not delete services or prices.

insert into public.service_categories (name, sort_order, is_enabled)
values
  ('端游', 1, true),
  ('手游', 2, true),
  ('娱乐陪伴', 3, true)
on conflict (name) do update
set
  sort_order = excluded.sort_order,
  is_enabled = true,
  updated_at = now();

notify pgrst, 'reload schema';
