-- Staging only. Appointment requests are NOT orders and never touch wallets.
create table if not exists public.companion_booking_settings (
  companion_id uuid primary key,
  accept_booking boolean not null default true,
  available_dates jsonb not null default '[]'::jsonb,
  time_ranges jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.companion_appointments (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null,
  companion_id uuid not null,
  service_name text not null default '',
  unit_price numeric not null,
  hours numeric not null,
  total_amount numeric not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  requirements text not null default '',
  status text not null default 'pending',
  idempotency_key text not null,
  charge_state text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companion_appointments_status_chk check (
    status in (
      'pending',
      'confirmed',
      'rejected',
      'cancelled',
      'awaiting_payment',
      'in_progress',
      'completed',
      'expired'
    )
  ),
  constraint companion_appointments_charge_chk check (charge_state in ('none')),
  constraint companion_appointments_idem_uq unique (boss_id, idempotency_key)
);

create index if not exists companion_appointments_companion_status_idx
  on public.companion_appointments (companion_id, status, start_at);

alter table public.companion_booking_settings enable row level security;
alter table public.companion_appointments enable row level security;
