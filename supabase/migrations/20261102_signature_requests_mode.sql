-- Signatures: how a request's parties sign (lib/sign.ts, api/sign.ts).
--   normal  the signing page as it is: the document, a name, a signature.
--   game    "Anything Is Possible": they walk into a theater, watch the clip,
--           and the door to the signing room opens when it ends.
-- Chosen on the request while it's a draft; both parties get the same mode.
alter table public.signature_requests add column if not exists mode text not null default 'normal';
