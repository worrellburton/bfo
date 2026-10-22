-- A conversation archived from Active: its received mail moves to Archive,
-- and every message in it (our sent copies too, which stay in Out) is
-- hidden from Active until the conversation moves again: a new message in
-- it arrives (or is sent) unhidden, and moving it back to the inbox clears it.
alter table public.mail_messages add column if not exists active_hidden boolean not null default false;
