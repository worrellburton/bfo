-- The picture a user chose for their mail: shown beside their messages in
-- every BFO inbox (their own sent mail, and mail they send colleagues). A
-- path in the private "mail" bucket, handed out through short-lived signed
-- links; null shows their initials.
alter table public.app_users add column if not exists mail_photo text;
