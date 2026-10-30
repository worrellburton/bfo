-- Texts BFO sends from its Bird number (the Phone page's composer, lib/sms-send.ts)
-- live beside the ones it receives, so a conversation is one list.
--
-- An outbound row ('out'): id is Bird's sms_id; from_number is BFO's number and
-- to_number the recipient; received_at is when BFO sent it (the column orders
-- both directions in one timeline); read_at is set at once, since BFO wrote it.
-- status is Bird's (accepted, sent, delivered, undelivered, failed, rejected,
-- expired), moved by the delivery receipts api/mail-webhook.ts takes; error is
-- why it wasn't delivered, in plain words. Incoming rows keep status null.
alter table public.sms_messages
  add column if not exists direction text not null default 'in',
  add column if not exists status text,
  add column if not exists error text,
  add column if not exists sent_by uuid references public.app_users(id) on delete set null;

alter table public.sms_messages drop constraint if exists sms_messages_direction_check;
alter table public.sms_messages add constraint sms_messages_direction_check check (direction in ('in', 'out'));

-- A conversation: every text to or from one number, in time order.
create index if not exists sms_messages_from_idx on public.sms_messages (from_number, received_at desc);
create index if not exists sms_messages_to_idx on public.sms_messages (to_number, received_at desc);
-- Sent texts still waiting on a final receipt.
create index if not exists sms_messages_out_open_idx on public.sms_messages (received_at desc)
  where direction = 'out' and (status is null or status in ('accepted', 'sent'));
