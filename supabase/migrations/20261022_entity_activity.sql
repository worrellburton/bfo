-- What happened to each entity, newest first: edits, filings, Palm, paper mail.
create table if not exists public.entity_activity (
  id bigint generated always as identity primary key,
  asset_id text not null,
  at timestamptz not null default now(),
  actor_id uuid references public.app_users(id) on delete set null,
  actor_name text,
  -- user | palm | stable | system
  source text not null default 'user',
  kind text not null,
  summary text not null,
  detail jsonb
);
create index if not exists entity_activity_asset_idx on public.entity_activity (asset_id, at desc);
alter table public.entity_activity enable row level security;
