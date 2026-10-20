-- More than one address per account: each row is an extra address on the
-- family domain that delivers to (and can send as) one user, alongside their
-- app_users.mail_address. An address belongs to one account only; the app
-- also refuses one that's someone's main address.

create table if not exists public.mail_aliases (
  address text primary key check (address = lower(address)),
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists mail_aliases_user_idx on public.mail_aliases (user_id);
alter table public.mail_aliases enable row level security;
