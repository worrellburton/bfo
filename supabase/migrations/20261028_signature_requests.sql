-- Signatures (lib/sign.ts, api/sign.ts, Tools › Signatures): a document sent
-- out for signature, who signs it, where their marks go, and how far along it
-- is. The PDFs live in the private "documents" bucket under signatures/<id>/.
--
-- parties: [{ key: "a"|"b", role, name, email, status, tokenHash, sentAt,
--             viewedAt, signedAt, declinedAt, declinedReason, ip, signedAs }]
-- fields:  [{ id, party, type: signature|initials|name|date, page, x, y, w, h }]
--          (fractions of the page; y from the top)
-- events:  [{ at, kind, party?, by?, note? }]  the audit trail
create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft',
  source text not null default 'upload',
  asset_id text,
  contract_id text,
  created_by text,
  created_by_name text,
  original_path text,
  current_path text,
  signed_path text,
  pages jsonb not null default '[]'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  parties jsonb not null default '[]'::jsonb,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  copy_sent_at timestamptz
);
create index if not exists signature_requests_created_idx on public.signature_requests (created_at desc);
create index if not exists signature_requests_contract_idx on public.signature_requests (asset_id, contract_id);
-- A signer's link is looked up by its token's hash inside parties.
create index if not exists signature_requests_parties_idx on public.signature_requests using gin (parties jsonb_path_ops);
alter table public.signature_requests enable row level security;
