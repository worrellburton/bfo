-- A Firebase file migration that can't finish (a file gone from the old
-- storage) stops retrying on every tree poll once lib/firebase-bridge.ts
-- gives up on it.
alter table public.tree_imports add column if not exists files_given_up boolean not null default false;
