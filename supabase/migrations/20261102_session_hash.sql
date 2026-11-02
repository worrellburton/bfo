-- Sessions are looked up by the SHA-256 of the bearer token (lib/auth.ts
-- currentUser), so a copy of this table can't be used to sign in. Rows from
-- before get their hash here. The plaintext `token` column stays for now:
-- its default fills new rows with a throwaway value that nothing reads, and
-- it is dropped once no code looks it up. Expired rows are pruned daily
-- (lib/auth.ts pruneSessions, from the state-records cron).
alter table public.app_sessions add column if not exists token_hash text;
update public.app_sessions set token_hash = encode(extensions.digest(token::text, 'sha256'), 'hex') where token_hash is null;
create unique index if not exists app_sessions_token_hash_idx on public.app_sessions (token_hash);
