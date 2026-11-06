-- The shared audit trail (lib/audit.ts): who did what, to what, and when,
-- across the app: a person's access or role changed, an entity archived,
-- mail or a signature request deleted, many transactions changed at once.
-- One row per action, written by the server with the service key. Rows are
-- never changed or removed: the triggers below refuse UPDATE, DELETE and
-- TRUNCATE for every role, the service role included.
--
-- Never holds a secret, an SSN, a verification code or a message body
-- (lib/audit.ts strips those before writing); `detail` carries ids, counts
-- and before/after values of ordinary fields.
--
-- Additive: a new table, its indexes and its guard. Nothing existing changes.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Who: the person (kept as a name if the account is later removed), or a
  -- system actor ('system', 'cron', 'webhook') with no person.
  actor_id uuid references public.app_users(id) on delete set null,
  actor_name text,
  actor_role text,
  actor_kind text not null default 'user',
  -- What: "<area>.<verb>", e.g. user.role_change, entity.archive,
  -- mail.delete, signature.delete, books.bulk_update.
  action text not null,
  area text not null,
  -- To what: the record's kind, id, and its name at the time.
  target_type text,
  target_id text,
  target_label text,
  -- How many records a bulk action touched.
  count integer,
  -- One plain sentence, as a person would read it in an activity list.
  summary text not null,
  detail jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id, at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_area_idx on public.audit_log (area, at desc);

alter table public.audit_log enable row level security;

-- Append-only, for everyone.
create or replace function public.audit_log_append_only() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log is append-only: rows are never changed or removed';
end;
$$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();
