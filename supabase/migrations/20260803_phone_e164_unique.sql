-- Unique international phone when non-empty (boss registration uniqueness)
create unique index if not exists profiles_phone_e164_unique_idx
  on public.profiles (phone_e164)
  where phone_e164 is not null and phone_e164 <> '';
