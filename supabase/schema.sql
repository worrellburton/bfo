-- The BFO database as it stands (public schema), read back from the project on
-- 2026-10-27. Several tables were created by hand before supabase/migrations
-- existed, so this file is the one place that shows all of them. It is a
-- reference, safe to run on an empty database; on the live one every
-- statement is "if not exists". Later changes still go in supabase/migrations
-- (applied by hand through the Supabase SQL editor); refresh this file when
-- they land.
--
-- Functions and triggers are defined in the migrations that introduced them:
--   jsonb_deep_set, tree_set_one, tree_apply ........ 20261017_tree_nodes.sql
--   mail_base_subject, mail_thread_key, the two
--   mail_thread_* triggers ........................... 20261023_mail_threads.sql
-- All of them run with search_path pinned to public (20261027_function_search_path.sql).
--
-- Every table has row level security enabled and no policies: only the
-- service role, used by the API, can read or write. That is deliberate.

-- ── People and sessions ────────────────────────────────────────────────────

create table if not exists public.app_users (
  id uuid not null default gen_random_uuid(),
  name text,
  email text,
  phone text,
  status text not null default 'incoming',
  role text not null default 'member',
  verified_at timestamptz,
  approved_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  notification_prefs jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  mail_address text,
  mail_photo text,
  constraint app_users_pkey primary key (id),
  constraint app_users_email_key unique (email),
  constraint app_users_phone_key unique (phone),
  constraint app_users_mail_address_key unique (mail_address),
  constraint app_users_mail_address_lower check (mail_address is null or mail_address = lower(mail_address)),
  constraint app_users_role_check check (role in ('owner', 'admin', 'member', 'viewer', 'email', 'partner')),
  constraint app_users_status_check check (status in ('incoming', 'approved', 'denied'))
);
create index if not exists app_users_phone_idx on public.app_users (phone);

create table if not exists public.app_sessions (
  token uuid not null default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint app_sessions_pkey primary key (token)
);
create index if not exists app_sessions_user_idx on public.app_sessions (user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions (expires_at);

create table if not exists public.login_codes (
  id uuid not null default gen_random_uuid(),
  identifier text not null,
  code_hash text not null,
  attempts integer not null default 0,
  consumed boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint login_codes_pkey primary key (id)
);
create index if not exists login_codes_identifier_idx on public.login_codes (identifier);

create table if not exists public.push_devices (
  token text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  platform text not null default 'ios',
  environment text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_devices_pkey primary key (token),
  constraint push_devices_environment_check check (environment in ('production', 'sandbox'))
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);

create table if not exists public.report_deliveries (
  user_id uuid not null references public.app_users(id) on delete cascade,
  report text not null default 'treasury',
  sent_at timestamptz not null default now(),
  constraint report_deliveries_pkey primary key (user_id)
);

-- ── The entity tree (a JSON document store, lib/tree.ts) ───────────────────

create table if not exists public.tree_nodes (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint tree_nodes_pkey primary key (collection, id)
);
create index if not exists tree_nodes_updated_idx on public.tree_nodes (collection, updated_at desc);

create table if not exists public.tree_imports (
  collection text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  count integer,
  error text,
  files_done boolean not null default false,
  files_given_up boolean not null default false,
  constraint tree_imports_pkey primary key (collection),
  constraint tree_imports_status_check check (status in ('running', 'done', 'error'))
);

create table if not exists public.entity_access (
  user_id uuid not null references public.app_users(id) on delete cascade,
  asset_id text not null,
  member_name text,
  invited_by uuid references public.app_users(id) on delete set null,
  invited_at timestamptz not null default now(),
  constraint entity_access_pkey primary key (user_id, asset_id)
);
create index if not exists entity_access_asset_idx on public.entity_access (asset_id);
create index if not exists entity_access_invited_by_idx on public.entity_access (invited_by);

create table if not exists public.entity_activity (
  id bigint generated by default as identity,
  asset_id text not null,
  at timestamptz not null default now(),
  actor_id uuid references public.app_users(id) on delete set null,
  actor_name text,
  source text not null default 'user',
  kind text not null,
  summary text not null,
  detail jsonb,
  constraint entity_activity_pkey primary key (id)
);
create index if not exists entity_activity_asset_idx on public.entity_activity (asset_id, at desc);
create index if not exists entity_activity_actor_id_idx on public.entity_activity (actor_id);

create table if not exists public.brand_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  constraint brand_settings_pkey primary key (key)
);

-- ── Mail (Bird) ────────────────────────────────────────────────────────────

create table if not exists public.mail_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete cascade,
  dedupe_key text not null,
  folder text not null default 'inbox',
  direction text not null,
  bird_id text,
  message_id text,
  in_reply_to text,
  references_ids text[] not null default '{}'::text[],
  from_email text,
  from_name text,
  to_addrs jsonb not null default '[]'::jsonb,
  cc_addrs jsonb not null default '[]'::jsonb,
  bcc_addrs jsonb not null default '[]'::jsonb,
  delivered_to text,
  subject text,
  text_body text,
  html_body text,
  snippet text,
  attachments jsonb not null default '[]'::jsonb,
  spf_pass boolean,
  dkim_pass boolean,
  status text,
  read_at timestamptz,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  starred_at timestamptz,
  thread_key text,
  thread_at timestamptz,
  active_hidden boolean not null default false,
  constraint mail_messages_pkey primary key (id),
  constraint mail_messages_dedupe_key_key unique (dedupe_key),
  constraint mail_messages_direction_check check (direction in ('in', 'out')),
  constraint mail_messages_folder_check check (folder in ('inbox', 'sent', 'archive'))
);
create index if not exists mail_messages_user_folder_idx on public.mail_messages (user_id, folder, occurred_at desc);
create index if not exists mail_messages_unread_idx on public.mail_messages (user_id) where read_at is null and folder = 'inbox';
create index if not exists mail_messages_starred_idx on public.mail_messages (user_id, occurred_at desc) where starred_at is not null;
create index if not exists mail_messages_bird_id_idx on public.mail_messages (bird_id);
create index if not exists mail_messages_message_id_idx on public.mail_messages (message_id) where message_id is not null;
create index if not exists mail_messages_thread_idx on public.mail_messages (user_id, thread_key);
create index if not exists mail_messages_thread_at_idx on public.mail_messages (user_id, folder, thread_at desc, id desc);
-- Triggers (functions in 20261023_mail_threads.sql):
--   create trigger mail_thread_before_insert before insert on public.mail_messages for each row execute function mail_thread_before_insert();
--   create trigger mail_thread_after_insert  after  insert on public.mail_messages for each row execute function mail_thread_after_insert();

create table if not exists public.mail_aliases (
  address text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint mail_aliases_pkey primary key (address),
  constraint mail_aliases_address_check check (address = lower(address))
);
create index if not exists mail_aliases_user_idx on public.mail_aliases (user_id);

create table if not exists public.mail_deleted (
  dedupe_key text not null,
  bird_id text not null,
  deleted_at timestamptz not null default now(),
  constraint mail_deleted_pkey primary key (dedupe_key)
);
create index if not exists mail_deleted_bird_id_idx on public.mail_deleted (bird_id);

create table if not exists public.mail_sends (
  user_id uuid not null references public.app_users(id) on delete cascade,
  send_id uuid not null,
  created_at timestamptz not null default now(),
  constraint mail_sends_pkey primary key (user_id, send_id)
);
create index if not exists mail_sends_user_created_idx on public.mail_sends (user_id, created_at);

create table if not exists public.mail_sync (
  id text not null,
  cursor timestamptz,
  synced_at timestamptz,
  error text,
  updated_at timestamptz not null default now(),
  constraint mail_sync_pkey primary key (id)
);

-- ── Texts (Bird SMS) and physical mail (Stable) ────────────────────────────

create table if not exists public.sms_messages (
  id text not null,
  from_number text not null,
  to_number text,
  body text not null default '',
  code text,
  received_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sms_messages_pkey primary key (id)
);
create index if not exists sms_messages_received_idx on public.sms_messages (received_at desc);
create index if not exists sms_messages_unread_idx on public.sms_messages (received_at desc) where read_at is null;

create table if not exists public.stable_mail (
  id text not null,
  asset_id text,
  assigned text not null default 'auto',
  from_name text,
  recipient text,
  recipient2 text,
  received_at timestamptz,
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
  updated_at timestamptz not null default now(),
  constraint stable_mail_pkey primary key (id),
  constraint stable_mail_assigned_check check (assigned in ('auto', 'hand'))
);
create index if not exists stable_mail_asset_idx on public.stable_mail (asset_id, received_at desc);
create index if not exists stable_mail_received_idx on public.stable_mail (received_at desc);

-- ── Banks and brokerages (Plaid) ───────────────────────────────────────────

create table if not exists public.plaid_items (
  item_id text not null,
  access_token text not null,
  institution_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  kind text not null default 'investments',
  institution_id text,
  institution_color text,
  institution_logo text,
  transactions_cursor text,
  constraint plaid_items_pkey primary key (item_id),
  constraint plaid_items_kind_check check (kind in ('investments', 'bank'))
);

create table if not exists public.plaid_account_prefs (
  account_id text not null,
  nickname text,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  entity_id text,
  entity_name text,
  institution_name text,
  mask text,
  subtype text,
  account_name text,
  archived_at timestamptz,
  constraint plaid_account_prefs_pkey primary key (account_id)
);
create index if not exists plaid_account_prefs_identity_idx on public.plaid_account_prefs (institution_name, mask, subtype);

create table if not exists public.plaid_account_state (
  account_id text not null,
  item_id text not null,
  balance numeric,
  seen_at timestamptz not null default now(),
  prev_balance numeric,
  prev_seen_at timestamptz,
  constraint plaid_account_state_pkey primary key (account_id)
);
create index if not exists plaid_account_state_item_idx on public.plaid_account_state (item_id);

create table if not exists public.treasury_daily (
  day date not null,
  cash numeric not null default 0,
  invested numeric not null default 0,
  credit numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint treasury_daily_pkey primary key (day)
);

create table if not exists public.quickbooks_tokens (
  access_token text not null,
  refresh_token text not null,
  realm_id text not null,
  expires_at timestamptz not null,
  updated_at timestamptz default now(),
  constraint quickbooks_tokens_pkey primary key (realm_id)
);

-- ── Books ──────────────────────────────────────────────────────────────────

create table if not exists public.book_loans (
  id uuid not null default gen_random_uuid(),
  name text not null,
  starting_balance numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  show_on_report boolean not null default true,
  constraint book_loans_pkey primary key (id)
);

create table if not exists public.book_transactions (
  transaction_id text not null,
  account_id text not null,
  item_id text not null,
  date date not null,
  name text,
  merchant_name text,
  amount numeric not null,
  pending boolean not null default false,
  currency text,
  plaid_category text,
  plaid_category_detailed text,
  payment_channel text,
  txn_type text not null default 'normal',
  intercompany boolean not null default false,
  intercompany_class text,
  counterparty_account_id text,
  entity_id text,
  entity_name text,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  type_override text,
  book_category text,
  loan_id uuid references public.book_loans(id) on delete set null,
  constraint book_transactions_pkey primary key (transaction_id),
  constraint book_transactions_type_override_check check (type_override in ('normal', 'transfer', 'intercompany'))
);
create index if not exists book_transactions_date_idx on public.book_transactions (date desc);
create index if not exists book_transactions_account_date_idx on public.book_transactions (account_id, date desc);
create index if not exists book_transactions_entity_date_idx on public.book_transactions (entity_id, date desc);
create index if not exists book_transactions_loan_idx on public.book_transactions (loan_id) where loan_id is not null;

create table if not exists public.book_rules (
  id uuid not null default gen_random_uuid(),
  match text not null,
  book_category text,
  created_at timestamptz not null default now(),
  loan_id uuid references public.book_loans(id) on delete cascade,
  vendor_name text,
  type_override text,
  constraint book_rules_pkey primary key (id),
  constraint book_rules_type_override_check check (type_override in ('normal', 'transfer', 'intercompany'))
);
create unique index if not exists book_rules_match_idx on public.book_rules (lower(match));
create index if not exists book_rules_loan_id_idx on public.book_rules (loan_id);

create table if not exists public.book_txn_log (
  id bigint generated by default as identity,
  transaction_id text not null,
  changed_at timestamptz not null default now(),
  actor text,
  field text not null,
  old_value text,
  new_value text,
  source text,
  constraint book_txn_log_pkey primary key (id)
);
create index if not exists book_txn_log_txn_idx on public.book_txn_log (transaction_id, changed_at desc);

create table if not exists public.book_txn_receipt (
  id bigint generated by default as identity,
  transaction_id text not null,
  url text,
  label text,
  uploaded_at timestamptz not null default now(),
  path text,
  content_type text,
  source text not null default 'manual',
  constraint book_txn_receipt_pkey primary key (id)
);
create index if not exists book_txn_receipt_txn_idx on public.book_txn_receipt (transaction_id);

create table if not exists public.books_expected_inflows (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  name text not null,
  amount numeric,
  cadence text,
  expected_day integer,
  entity_name text,
  note text,
  apy numeric,
  institution text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint books_expected_inflows_pkey primary key (id),
  constraint books_expected_inflows_kind_check check (kind in ('manual', 'exclude', 'yield')),
  constraint books_expected_inflows_cadence_check check (cadence is null or cadence in ('monthly', 'one_time'))
);

create table if not exists public.books_settings (
  id integer not null default 1,
  sync_at_sunrise boolean not null default true,
  sync_lat double precision not null default 32.2226,
  sync_lng double precision not null default -110.9747,
  last_auto_sync_date date,
  updated_at timestamptz not null default now(),
  constraint books_settings_pkey primary key (id),
  constraint books_settings_singleton check (id = 1)
);

-- ── Palm (registry, registered agent, monitoring) ──────────────────────────

create table if not exists public.palm_events (
  id text not null,
  type text not null,
  mode text not null,
  business_id text,
  asset_id text,
  document_id text,
  document_type text,
  filename text,
  status text,
  rejection_reason text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  read_at timestamptz,
  read_by text,
  constraint palm_events_pkey primary key (id),
  constraint palm_events_mode_check check (mode in ('test', 'live'))
);
create index if not exists palm_events_asset_idx on public.palm_events (asset_id, occurred_at desc);
create index if not exists palm_events_unread_idx on public.palm_events (occurred_at desc) where read_at is null;

create table if not exists public.palm_monitors (
  business_id uuid not null,
  mode text not null,
  asset_id text not null,
  state text not null,
  subscription_id uuid,
  status text not null,
  started_at timestamptz not null default now(),
  started_by uuid,
  ended_at timestamptz,
  constraint palm_monitors_pkey primary key (business_id, mode),
  constraint palm_monitors_mode_check check (mode in ('test', 'live')),
  constraint palm_monitors_state_check check (state ~ '^[A-Z]{2}$')
);
create index if not exists palm_monitors_asset_idx on public.palm_monitors (asset_id, mode);

create table if not exists public.palm_usage (
  id bigint generated by default as identity,
  at timestamptz not null default now(),
  mode text not null,
  product text not null,
  cents integer not null,
  method text not null,
  path text not null,
  status integer not null,
  actor_id uuid,
  actor_name text,
  asset_id text,
  reason text,
  constraint palm_usage_pkey primary key (id),
  constraint palm_usage_mode_check check (mode in ('test', 'live'))
);
create index if not exists palm_usage_at_idx on public.palm_usage (at desc);

-- ── Ask BFO ────────────────────────────────────────────────────────────────

create table if not exists public.chats (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chats_pkey primary key (id)
);
create index if not exists chats_user_idx on public.chats (user_id, updated_at desc);

create table if not exists public.chat_messages (
  id bigint generated by default as identity,
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_pkey primary key (id),
  constraint chat_messages_role_check check (role in ('user', 'assistant'))
);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, id);

-- ── Row level security: on everywhere, no policies (service role only) ─────

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
