-- Books: the controls the ledger needs before its figures can be relied on.
--
--   * A period lock (books_periods): a closed-through date per entity (or for
--     every entity). Edits, bulk refiles, rules, imports and receipt removals
--     dated on or before it are refused until an admin reopens the period,
--     with a reason. Every close and reopen is kept.
--   * Who taught a rule, why, and how it matches (book_rules): created_by,
--     reason, match_kind ('vendor' = the payee exactly, 'contains' = words in
--     the payee), an optional entity scope and effective date.
--   * The person's own note on a row (book_transactions.memo), so the bank's
--     description (`name`) is never edited; and the import a row came from.
--   * Receipts are removed, not deleted: the stored file stays, with who
--     added it and who removed it, when and why.
--   * The field history (book_txn_log) names the person, and is append-only.
--   * Each CSV import is a record: who, when, which file (name and sha256),
--     which account, how many rows and their totals; it can be undone.
--   * Loans say who holds them, which way they run, their terms, and from
--     when the starting balance counts.
--   * Possible duplicates can be settled ("two payments" or "the same
--     payment"), with who decided.
--   * An opening balance per bank account, so the ledger can tie to the
--     bank (Review › Bank vs books).
--   * Who turned the sunrise sync on or off.
--
-- Additive only: new tables, new nullable columns, new indexes and one
-- guard trigger. Nothing existing is renamed, dropped or rewritten. The app
-- reads and writes these defensively, so it runs before and after this file
-- is applied.

-- ── Period lock ─────────────────────────────────────────────────────────────
create table if not exists public.books_periods (
  id bigint generated always as identity primary key,
  -- The entity whose books are closed; null closes every entity's books.
  entity_id text,
  entity_name text,
  closed_through date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.app_users(id) on delete set null,
  closed_by_name text,
  reason text,
  -- A reopen keeps the row and says who reopened it and why.
  reopened_at timestamptz,
  reopened_by uuid references public.app_users(id) on delete set null,
  reopened_by_name text,
  reopen_reason text
);
create index if not exists books_periods_entity_idx on public.books_periods (entity_id, closed_through desc) where reopened_at is null;
alter table public.books_periods enable row level security;

-- ── Rules: who, why, how they match ────────────────────────────────────────
alter table public.book_rules add column if not exists created_by uuid references public.app_users(id) on delete set null;
alter table public.book_rules add column if not exists created_by_name text;
alter table public.book_rules add column if not exists reason text;
alter table public.book_rules add column if not exists match_kind text;
alter table public.book_rules add column if not exists scope_entity_id text;
alter table public.book_rules add column if not exists effective_from date;
alter table public.book_rules add column if not exists updated_at timestamptz;
do $$ begin
  alter table public.book_rules add constraint book_rules_match_kind_check check (match_kind is null or match_kind in ('vendor', 'contains'));
exception when duplicate_object then null; end $$;

-- ── Transactions: the person's note, and where an imported row came from ──
alter table public.book_transactions add column if not exists memo text;
alter table public.book_transactions add column if not exists import_id uuid;
create index if not exists book_transactions_import_idx on public.book_transactions (import_id) where import_id is not null;

-- ── Receipts: added by, removed (kept) by ──────────────────────────────────
alter table public.book_txn_receipt add column if not exists uploaded_by uuid references public.app_users(id) on delete set null;
alter table public.book_txn_receipt add column if not exists uploaded_by_name text;
alter table public.book_txn_receipt add column if not exists removed_at timestamptz;
alter table public.book_txn_receipt add column if not exists removed_by uuid references public.app_users(id) on delete set null;
alter table public.book_txn_receipt add column if not exists removed_by_name text;
alter table public.book_txn_receipt add column if not exists removed_reason text;

-- ── Field history: the person's name, and no changes after the fact ───────
alter table public.book_txn_log add column if not exists actor_name text;
create index if not exists book_txn_log_source_idx on public.book_txn_log (source, changed_at desc);

create or replace function public.book_txn_log_append_only() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'book_txn_log is append-only: history is never changed or removed';
end;
$$;

drop trigger if exists book_txn_log_no_change on public.book_txn_log;
create trigger book_txn_log_no_change
  before update or delete on public.book_txn_log
  for each row execute function public.book_txn_log_append_only();

-- ── CSV imports ─────────────────────────────────────────────────────────────
create table if not exists public.book_imports (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  account_label text,
  file_name text,
  file_sha256 text,
  rows_in_file integer not null default 0,
  inserted integer not null default 0,
  skipped integer not null default 0,
  total_in numeric not null default 0,
  total_out numeric not null default 0,
  first_date date,
  last_date date,
  signs_flipped boolean not null default false,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.app_users(id) on delete set null,
  imported_by_name text,
  undone_at timestamptz,
  undone_by uuid references public.app_users(id) on delete set null,
  undone_by_name text
);
create index if not exists book_imports_account_idx on public.book_imports (account_id, imported_at desc);
alter table public.book_imports enable row level security;

-- ── Loans: holder, direction, terms ─────────────────────────────────────────
alter table public.book_loans add column if not exists direction text;
alter table public.book_loans add column if not exists holder_entity_id text;
alter table public.book_loans add column if not exists holder_entity_name text;
alter table public.book_loans add column if not exists counterparty text;
alter table public.book_loans add column if not exists rate numeric;
alter table public.book_loans add column if not exists start_date date;
alter table public.book_loans add column if not exists maturity_date date;
alter table public.book_loans add column if not exists starting_balance_as_of date;
alter table public.book_loans add column if not exists hidden_reason text;
alter table public.book_loans add column if not exists created_by uuid references public.app_users(id) on delete set null;
alter table public.book_loans add column if not exists created_by_name text;
do $$ begin
  alter table public.book_loans add constraint book_loans_direction_check check (direction is null or direction in ('receivable', 'payable'));
exception when duplicate_object then null; end $$;

-- ── Possible duplicates, settled ────────────────────────────────────────────
create table if not exists public.book_duplicate_reviews (
  -- account|date|cents, the key Review groups by.
  group_key text primary key,
  decision text not null check (decision in ('separate', 'same')),
  -- For "the same payment": the row kept and the copy set aside.
  kept_id text,
  copy_id text,
  note text,
  decided_at timestamptz not null default now(),
  decided_by uuid references public.app_users(id) on delete set null,
  decided_by_name text
);
alter table public.book_duplicate_reviews enable row level security;

-- ── Opening balances, so the ledger can tie to the bank ────────────────────
create table if not exists public.book_account_openings (
  account_id text primary key,
  opening_balance numeric not null,
  as_of date not null,
  note text,
  set_at timestamptz not null default now(),
  set_by uuid references public.app_users(id) on delete set null,
  set_by_name text
);
alter table public.book_account_openings enable row level security;

-- ── Settings: who changed the automatic sync ───────────────────────────────
alter table public.books_settings add column if not exists updated_by uuid references public.app_users(id) on delete set null;
alter table public.books_settings add column if not exists updated_by_name text;
