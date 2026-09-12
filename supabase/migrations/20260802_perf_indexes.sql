-- Performance indexes for launch (safe idempotent).
-- Apply in Supabase SQL editor before/after Preview deploy.

create index if not exists orders_status_created_at_idx
  on public.orders (status, created_at desc);

create index if not exists orders_boss_id_created_at_idx
  on public.orders (boss_id, created_at desc);

create index if not exists orders_companion_id_created_at_idx
  on public.orders (companion_id, created_at desc);

create index if not exists order_grabs_order_id_grabbed_at_idx
  on public.order_grabs (order_id, grabbed_at asc);

create index if not exists order_grabs_companion_status_idx
  on public.order_grabs (companion_id, status);

create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at desc);

create index if not exists conversations_service_updated_idx
  on public.conversations (customer_service_id, updated_at desc);

create index if not exists conversations_boss_updated_idx
  on public.conversations (boss_id, updated_at desc);

create index if not exists companion_profiles_verification_online_idx
  on public.companion_profiles (verification_status, online_status);

create index if not exists platform_content_items_type_status_sort_idx
  on public.platform_content_items (type, status, sort desc);
