-- Mail: deleting becomes recoverable, holds keep records, and Reply-To is kept.
--
-- Delete moves a message to Trash (deleted_at, deleted_by) instead of
-- removing it. It stays there, restorable, for 30 days; then the purge
-- (api/mail.ts ?cron=purge, and the inbox's own sync) removes it and its
-- stored files for good, writing each message's who/what/when (never its
-- words) to the audit log (20261106_audit_log.sql).
--
-- Holds: one message kept for records (held_at, held_by: set by an owner or
-- admin, lifted only by an owner), or every mailbox or one person's mailbox
-- (mail_holds, set and lifted by an owner). Held mail is never deleted or
-- purged: Delete archives it instead.
--
-- reply_to: the Reply-To addresses of received mail, so a reply goes where
-- the sender asked.
--
-- Additive: new nullable columns, a new table and new indexes. Nothing
-- existing changes. Apply before deploying the code that reads them: until
-- then Mail keeps working and Delete is refused (lib/mail.ts mailSchemaReady).
alter table public.mail_messages add column if not exists deleted_at timestamptz;
alter table public.mail_messages add column if not exists deleted_by uuid references public.app_users(id) on delete set null;
alter table public.mail_messages add column if not exists held_at timestamptz;
alter table public.mail_messages add column if not exists held_by uuid references public.app_users(id) on delete set null;
alter table public.mail_messages add column if not exists reply_to jsonb;

-- Trash, newest first, and the purge's oldest-first read.
create index if not exists mail_messages_trash_idx on public.mail_messages (user_id, deleted_at desc) where deleted_at is not null;
create index if not exists mail_messages_purge_idx on public.mail_messages (deleted_at) where deleted_at is not null and held_at is null;

create table if not exists public.mail_holds (
  id uuid primary key default gen_random_uuid(),
  -- The mailbox on hold; null holds every mailbox and Other.
  user_id uuid references public.app_users(id) on delete cascade,
  reason text,
  set_by uuid references public.app_users(id) on delete set null,
  set_at timestamptz not null default now(),
  lifted_by uuid references public.app_users(id) on delete set null,
  lifted_at timestamptz
);

create index if not exists mail_holds_active_idx on public.mail_holds (user_id) where lifted_at is null;

-- Server only (the service key); nothing reaches it from the browser.
alter table public.mail_holds enable row level security;
