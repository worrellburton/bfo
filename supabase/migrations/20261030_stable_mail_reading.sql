-- What BFO read off a piece of paper mail (lib/paper-read.ts): the envelope's
-- addresses and postage, and from the scan what the piece is and asks for.
-- reading_from names the copies that were read, so a new scan is read again.
alter table public.stable_mail
  add column if not exists reading jsonb,
  add column if not exists reading_from text,
  add column if not exists reading_at timestamptz;
