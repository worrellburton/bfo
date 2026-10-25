-- The iPhone app's push notifications (lib/push.ts): each phone that allowed
-- notifications, and whose they are. A token belongs to one person at a time
-- (the app's current account); the APNs environment that accepted it is
-- learnt on the first send.
create table if not exists public.push_devices (
  token text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  platform text not null default 'ios',
  environment text check (environment in ('production', 'sandbox')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security;
