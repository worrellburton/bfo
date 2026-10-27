-- The address a sign-in code was requested from, so request-code can cap codes
-- per IP as well as per number (SMS pumping cycles through fresh numbers).
alter table public.login_codes add column if not exists ip text;
create index if not exists login_codes_ip_created_at_idx on public.login_codes (ip, created_at);
