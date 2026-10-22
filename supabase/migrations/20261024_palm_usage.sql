-- Every Palm API call Palm bills for (lib/palm-pricing.ts), as it's made:
-- what it was, what it cost, who or what asked, for which entity. Test-mode
-- calls are logged too (cents 0: the sandbox isn't billed).
create table if not exists public.palm_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  mode text not null check (mode in ('test', 'live')),
  product text not null,
  cents integer not null,
  method text not null,
  path text not null,
  status integer not null,
  actor_id uuid,
  actor_name text,
  asset_id text,
  reason text
);
create index if not exists palm_usage_at_idx on public.palm_usage (at desc);
alter table public.palm_usage enable row level security;
