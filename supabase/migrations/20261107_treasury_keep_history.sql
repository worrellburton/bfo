-- Treasury keeps what it learned about an account after the bank stops
-- sharing it, and says who owns it.
--
-- Disconnecting a bank, or deselecting an account in the bank's picker, used
-- to delete the account's Books transactions (CSV imports included) and its
-- mapping. From now on (api/plaid/disconnect.ts, api/plaid/prune-accounts.ts)
-- the ledger stays where it is and the account's row in plaid_account_prefs
-- is marked instead: when it stopped syncing and why, its last known balance
-- and the date of its last Books transaction. A later reconnect links the new
-- account to the old one (lib/plaid-mappings.ts adoptMappings), so Books can
-- skip what it already holds.
--
-- It also records an account's owner when that isn't an entity (an IRA is a
-- person's; a JTWROS account belongs to its joint tenants), the account's tax
-- status, and an optional beneficiary entity.
--
-- plaid_account_daily keeps each account's balance once per day, so a change
-- is measured against the prior day's close instead of "since someone last
-- looked", and a total can be restated when the set of accounts changes.
--
-- Additive: new nullable columns and one new table. Nothing existing changes.

alter table public.plaid_account_prefs
  -- Stopped syncing: when, and why ('disconnected' when the connection was
  -- removed; 'not_shared' when the bank stopped reporting the account).
  add column if not exists disconnected_at timestamptz,
  add column if not exists disconnected_reason text,
  -- The last balance read from the bank, and when it was read.
  add column if not exists last_balance numeric,
  add column if not exists last_balance_at timestamptz,
  -- Plaid's account type (depository, investment, credit, loan, other).
  add column if not exists account_type text,
  -- The date of the account's newest Books transaction when it stopped syncing.
  add column if not exists books_through date,
  -- Reconnect lineage: the account this one continues, and the last day the
  -- earlier account's Books history covers (newer rows only are new).
  add column if not exists predecessor_account_id text,
  add column if not exists predecessor_through date,
  -- Set on the earlier account once a reconnected account continues it.
  add column if not exists successor_account_id text,
  -- Who owns the account when it isn't an entity: 'entity' (the default,
  -- read from entity_id), 'person' or 'joint'. A person's or joint account
  -- sits outside every entity's Books.
  add column if not exists owner_kind text,
  add column if not exists owner_names text[],
  -- For joint accounts: 'jtwros', 'tenants_in_common', 'community_property',
  -- 'tenancy_by_entirety'.
  add column if not exists tenancy text,
  -- 'taxable', 'tax_deferred' or 'tax_exempt'.
  add column if not exists tax_status text,
  -- An entity named as beneficiary (a trust named on an IRA), not the owner.
  add column if not exists beneficiary_entity_id text,
  add column if not exists beneficiary_name text,
  -- Who last changed the row, for the audit trail's convenience.
  add column if not exists updated_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plaid_account_prefs_owner_kind_check') then
    alter table public.plaid_account_prefs
      add constraint plaid_account_prefs_owner_kind_check check (owner_kind is null or owner_kind in ('entity', 'person', 'joint'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plaid_account_prefs_tax_status_check') then
    alter table public.plaid_account_prefs
      add constraint plaid_account_prefs_tax_status_check check (tax_status is null or tax_status in ('taxable', 'tax_deferred', 'tax_exempt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plaid_account_prefs_disconnected_reason_check') then
    alter table public.plaid_account_prefs
      add constraint plaid_account_prefs_disconnected_reason_check check (disconnected_reason is null or disconnected_reason in ('disconnected', 'not_shared'));
  end if;
end $$;

create index if not exists plaid_account_prefs_disconnected_idx on public.plaid_account_prefs (disconnected_at) where disconnected_at is not null;

-- One balance per account per day: the last reading of the day wins.
create table if not exists public.plaid_account_daily (
  account_id text not null,
  day date not null,
  balance numeric,
  available numeric,
  account_type text,
  item_id text,
  hidden boolean not null default false,
  recorded_at timestamptz not null default now(),
  constraint plaid_account_daily_pkey primary key (account_id, day)
);
create index if not exists plaid_account_daily_day_idx on public.plaid_account_daily (day desc);
alter table public.plaid_account_daily enable row level security;
