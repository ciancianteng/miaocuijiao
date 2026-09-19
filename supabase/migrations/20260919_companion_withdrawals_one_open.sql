-- Enforce at most one open companion withdrawal per companion.
-- Completed / rejected / cancelled / failed do not count as open.
-- Balance reserve still uses WITHDRAW_ACTIVE (pending + paid/completed) in app code;
-- this index only blocks concurrent duplicate open requests.

create unique index if not exists uq_companion_withdrawals_one_open
  on public.companion_withdrawals (companion_id)
  where status in (
    'submitted',
    'pending_friday',
    'reviewing',
    'pending',
    'pending_review',
    'rolled_over',
    'approved',
    'pending_payment',
    'approved_pending_pay',
    'paying',
    'paid_pending_receipt',
    'paid',
    'processing'
  );

comment on index public.uq_companion_withdrawals_one_open is
  'One open companion withdrawal at a time; rejected/completed free the slot.';
