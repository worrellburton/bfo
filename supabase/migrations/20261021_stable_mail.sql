-- Paper mail received at the family's Stable address, one row per piece.
create table if not exists public.stable_mail (
  id text primary key,
  -- The BFO entity it's for: matched from the recipient, or set by hand.
  asset_id text,
  assigned text not null default 'auto' check (assigned in ('auto', 'hand')),
  from_name text,
  recipient text,
  recipient2 text,
  received_at timestamptz,
  -- Copies kept in the private "mail" bucket (Stable's links expire).
  envelope_path text,
  scan_path text,
  scan_status text,
  summary text,
  checks integer not null default 0,
  forward_status text,
  shred_status text,
  returned_to_sender boolean not null default false,
  archived_at timestamptz,
  read_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists stable_mail_asset_idx on public.stable_mail (asset_id, received_at desc);
create index if not exists stable_mail_received_idx on public.stable_mail (received_at desc);
alter table public.stable_mail enable row level security;
