-- 更多玩法商品单无人接单自动处理：每分钟由数据库定时调用 /api/cron/gameplay-no-taker
--   指定陪玩 30 分钟未确认/拒单 → 抢单大厅；抢单大厅 30 分钟无人接 → 全额退回猫粮余额
-- 不依赖任何页面访问。端点本身幂等（CAS + 钱包幂等键），重复/并发调用不会重复转大厅或重复退款。
--
-- 本文件只装基础设施（扩展 + 函数 + 权限），不创建、不启用定时任务。
-- 启用定时任务是单独一步，必须在部署、密钥、Vault 都就绪且接口返回 401 校验通过之后：
--   Production：supabase/pending-prod/22_gameplay_no_taker_cron_step2_activate.sql
--   Staging：scripts/apply-gameplay-no-taker-cron-staging.mjs（写入 Vault 后再注册）
-- Production 完整顺序见 supabase/pending-prod/22_gameplay_no_taker_cron_step1_infra.sql 文件头。
-- 本文件可重复执行。

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.mcj_set_gameplay_no_taker_cron(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_url), '') = '' or coalesce(trim(p_secret), '') = '' then
    raise exception 'url and secret are required';
  end if;
  select id into v_id from vault.secrets where name = 'gameplay_no_taker_cron_url';
  if v_id is null then
    perform vault.create_secret(trim(p_url), 'gameplay_no_taker_cron_url');
  else
    perform vault.update_secret(v_id, trim(p_url));
  end if;
  v_id := null;
  select id into v_id from vault.secrets where name = 'gameplay_no_taker_cron_secret';
  if v_id is null then
    perform vault.create_secret(trim(p_secret), 'gameplay_no_taker_cron_secret');
  else
    perform vault.update_secret(v_id, trim(p_secret));
  end if;
end;
$$;

create or replace function public.mcj_gameplay_no_taker_tick()
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gameplay_no_taker_cron_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gameplay_no_taker_cron_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise notice 'gameplay_no_taker cron: vault secrets missing, skipped';
    return null;
  end if;
  return net.http_get(
    url := v_url,
    headers := jsonb_build_object('x-cron-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.mcj_set_gameplay_no_taker_cron(text, text) from public, anon, authenticated;
revoke all on function public.mcj_gameplay_no_taker_tick() from public, anon, authenticated;
