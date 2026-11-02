-- Every call to Claude (lib/anthropic.ts): which feature, which model, tokens
-- in and out, how long, who asked and for which entity. Read by the ops
-- views; never by the browser directly.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  area text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  ms integer not null default 0,
  actor_id uuid,
  asset_id text,
  ok boolean not null default true,
  error text
);
create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
create index if not exists ai_usage_area_idx on public.ai_usage (area, at desc);
alter table public.ai_usage enable row level security;
