-- The brokerage accounts' value on days before BFO recorded it
-- (lib/invest-history.ts, api/plaid/history.ts): rebuilt from today's
-- holdings, up to 24 months of Plaid investment transactions, and daily
-- closing prices. treasury_daily wins on any day both have.
create table if not exists public.investment_history (
  day date primary key,
  value numeric not null,
  method text not null,
  built_at timestamptz not null default now()
);
alter table public.investment_history enable row level security;
