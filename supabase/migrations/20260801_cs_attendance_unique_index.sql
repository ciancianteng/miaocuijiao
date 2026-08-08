-- Speed up CS clock-in/out: unique day row + lookup indexes.
-- report_date is the work date (Asia/Shanghai YYYY-MM-DD); config rows use 1970-01-01.

create index if not exists idx_cs_reports_service_id
  on public.customer_service_reports (customer_service_id);

create index if not exists idx_cs_reports_report_date
  on public.customer_service_reports (report_date);

create unique index if not exists idx_cs_reports_service_date_unique
  on public.customer_service_reports (customer_service_id, report_date);
