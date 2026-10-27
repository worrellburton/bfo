-- Operations: the office finds out when something breaks without reading logs.
--
-- ops_alerts (lib/alert.ts): one row per alert raised to the owners/admins —
-- a cron that didn't finish, a webhook that couldn't store what it was sent.
-- The same kind isn't raised again within six hours; acknowledging one on the
-- Notifications page's System card sets acknowledged_at.
create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  detail text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index if not exists ops_alerts_kind_created_idx on public.ops_alerts (kind, created_at desc);
alter table public.ops_alerts enable row level security;

-- cron_runs (lib/cron.ts recordCronRun): when each scheduled job last ran and
-- how it went, for the System card and /api/ops.
create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  note text
);
create index if not exists cron_runs_name_started_idx on public.cron_runs (name, started_at desc);
alter table public.cron_runs enable row level security;
