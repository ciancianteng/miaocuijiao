-- 2026-10-04: per-service standards (服务内容/执行标准/包含/不包含/计费标准/注意事项)
-- companion_profiles.service_standards = { "<service_id>": { content, process, includes, excludes, billing, notes, updatedAt } }
-- orders.service_snapshot = frozen copy of the standard + name/price at order time (never rewritten after insert)
-- Non-destructive / idempotent.

alter table public.companion_profiles
  add column if not exists service_standards jsonb not null default '{}'::jsonb;

alter table public.orders
  add column if not exists service_snapshot jsonb;

comment on column public.companion_profiles.service_standards is
  '陪玩每个服务项目的服务标准：按 services.id 键（兼容名称键）';
comment on column public.orders.service_snapshot is
  '下单时的服务项目快照（名称/单价/计费单位/服务标准），下单后不可随陪玩修改而变化';

notify pgrst, 'reload schema';
