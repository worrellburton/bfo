-- Owners and members invited to BFO see only the entities they're on.
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role = any (array['owner','admin','member','viewer','email','partner']));

create table if not exists public.entity_access (
  user_id uuid not null references public.app_users(id) on delete cascade,
  asset_id text not null,
  -- The name they have on the entity's member list, to match the row.
  member_name text,
  invited_by uuid references public.app_users(id) on delete set null,
  invited_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
create index if not exists entity_access_asset_idx on public.entity_access (asset_id);
alter table public.entity_access enable row level security;
