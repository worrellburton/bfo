-- Signatures (lib/sign.ts, api/sign.ts): what an executed request keeps.
--
--   original_sha256   SHA-256 (hex) of the original document as sent.
--   executed_sha256   SHA-256 of the signed pages before the certificate
--                     (printed on the certificate, which can't carry its own).
--   signed_sha256     SHA-256 of the signed copy as filed and emailed: the
--                     signed pages plus the certificate.
--   archived_*        Archive instead of delete: a request that has been sent
--                     is never deleted. Archiving hides it from the list and
--                     keeps the row, its history and its files, with who,
--                     when and why. Owners and admins only (api/sign.ts).
--   replaces,         A request sent again as a new one points back at the
--   replaced_by       one it came from, and that one forward at it.
--   filed_path        Where the signed copy was filed with the entity's
--                     documents (assets/<id>/…), so it is filed once.
--
-- The consent, the evidence of each signature (address, device, method, the
-- game or not, the time zone of the date stamp), the first opening and any
-- decline live on each party in the existing `parties` jsonb; they need no
-- column.
--
-- Additive: new nullable columns and an index. Nothing existing changes. Until
-- this is applied, api/sign.ts writes without these columns (signing keeps
-- working; there are no fingerprints and no archive).
alter table public.signature_requests add column if not exists original_sha256 text;
alter table public.signature_requests add column if not exists executed_sha256 text;
alter table public.signature_requests add column if not exists signed_sha256 text;
alter table public.signature_requests add column if not exists archived_at timestamptz;
alter table public.signature_requests add column if not exists archived_by text;
alter table public.signature_requests add column if not exists archived_by_name text;
alter table public.signature_requests add column if not exists archived_reason text;
alter table public.signature_requests add column if not exists replaces uuid;
alter table public.signature_requests add column if not exists replaced_by uuid;
alter table public.signature_requests add column if not exists filed_path text;

-- The list reads the requests that aren't archived, newest first.
create index if not exists signature_requests_live_idx on public.signature_requests (created_at desc, id desc) where archived_at is null;
-- The request page looks for other versions of the same document for the same entity.
create index if not exists signature_requests_title_idx on public.signature_requests (asset_id, title);
