-- Bumped on every write. A write names the version it read
-- (PATCH …&version=eq.N), so two signers, or a signer and the office, can't
-- overwrite each other's changes (api/sign.ts).
alter table public.signature_requests add column if not exists version integer not null default 0;
