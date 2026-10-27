-- Supabase's security linter: a function without a fixed search_path can be
-- made to resolve names in another schema. These all live in public.
alter function public.jsonb_deep_set(target jsonb, path text[], value jsonb) set search_path = public;
alter function public.mail_base_subject(s text) set search_path = public;
alter function public.mail_thread_after_insert() set search_path = public;
alter function public.mail_thread_before_insert() set search_path = public;
alter function public.mail_thread_key(msg mail_messages) set search_path = public;
alter function public.tree_apply(ops jsonb) set search_path = public;
alter function public.tree_set_one(path text[], value jsonb) set search_path = public;

-- And the three foreign keys the performance linter found without an index.
create index if not exists book_rules_loan_id_idx on public.book_rules (loan_id);
create index if not exists entity_access_invited_by_idx on public.entity_access (invited_by);
create index if not exists entity_activity_actor_id_idx on public.entity_activity (actor_id);
