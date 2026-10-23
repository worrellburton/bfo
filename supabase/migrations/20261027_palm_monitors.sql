-- Palm Monitor: one row per state registration BFO asked Palm to watch
-- (an entity's home state, or a state it's registered in as a foreign
-- entity). Palm bills each one monthly while active. Its webhooks
-- (business.registration.updated / business.filing.due / .overdue) name
-- the Palm business, and this is how they find their entity and state.
create table if not exists public.palm_monitors (
  business_id uuid not null,
  mode text not null check (mode in ('test', 'live')),
  asset_id text not null,
  state text not null check (state ~ '^[A-Z]{2}$'),
  subscription_id uuid,
  status text not null,
  started_at timestamptz not null default now(),
  started_by uuid,
  ended_at timestamptz,
  primary key (business_id, mode)
);
create index if not exists palm_monitors_asset_idx on public.palm_monitors (asset_id, mode);
alter table public.palm_monitors enable row level security;
