-- What a signature request does once everyone has signed (api/sign.ts,
-- lib/sign.ts OnComplete). Null means nothing beyond the office's notices.
--   { "kind": "closing-consent", "assetId": "<entity id>", "step": "consent" }
--     a consent to dissolve from the entity's closing checklist: the signed
--     copy is filed in the entity's Documents, that step is marked done, and
--     each party gets the signed copy by email (and a push if they use BFO).
alter table public.signature_requests add column if not exists on_complete jsonb;
