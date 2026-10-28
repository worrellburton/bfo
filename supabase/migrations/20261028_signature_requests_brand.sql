-- Who a signature request comes from when it must not mention BFO (an MSA
-- with "Entity name only"): the emails, the signing page and the certificate
-- show this name instead. Null means BFO.
alter table public.signature_requests add column if not exists brand text;
