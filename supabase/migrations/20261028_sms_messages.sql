-- Texts to BFO's Bird number (sms.received), for the Texts page: who sent it,
-- what it says, and the verification code in it when there is one.
create table if not exists public.sms_messages (
  id text primary key,
  from_number text not null,
  to_number text,
  body text not null default '',
  code text,
  received_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sms_messages_received_idx on public.sms_messages (received_at desc);
create index if not exists sms_messages_unread_idx on public.sms_messages (received_at desc) where read_at is null;
alter table public.sms_messages enable row level security;
