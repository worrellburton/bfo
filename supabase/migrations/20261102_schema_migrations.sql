-- Which migrations have been applied: one row per file in supabase/migrations.
-- scripts/migrate.mjs applies the files not listed here and lists them as it
-- goes; `npm run migrate -- --check` says what is pending. Everything up to
-- this file was applied by hand before the table existed, so it is seeded
-- with them (this file included).
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
insert into public.schema_migrations (name) values
  ('20261017_tree_nodes.sql'),
  ('20261020_mail_aliases.sql'),
  ('20261021_entity_access.sql'),
  ('20261021_stable_mail.sql'),
  ('20261022_entity_activity.sql'),
  ('20261023_mail_threads.sql'),
  ('20261024_palm_usage.sql'),
  ('20261025_mail_photo.sql'),
  ('20261026_mail_active_hidden.sql'),
  ('20261026_tree_lock.sql'),
  ('20261027_function_search_path.sql'),
  ('20261027_login_codes_ip.sql'),
  ('20261027_ops_alerts.sql'),
  ('20261027_palm_monitors.sql'),
  ('20261027_tree_imports_given_up.sql'),
  ('20261028_signature_requests.sql'),
  ('20261028_signature_requests_brand.sql'),
  ('20261028_sms_messages.sql'),
  ('20261029_investment_history.sql'),
  ('20261029_push_devices.sql'),
  ('20261029_signature_requests_version.sql'),
  ('20261030_sms_outbound.sql'),
  ('20261030_stable_mail_reading.sql'),
  ('20261102_schema_migrations.sql')
on conflict (name) do nothing;
