-- Each entity's activity (public.entity_activity, lib/activity.ts) is an
-- audit trail: rows are added, never changed or removed. lib/activity.ts no
-- longer merges or deletes rows (a run of edits is grouped when shown); this
-- makes the table itself refuse it, for every role, the service role
-- included.
--
-- One update is allowed: when a person's account is removed, the foreign
-- key sets actor_id to null (actor_name keeps who it was). Nothing else in
-- the row may change.
--
-- Additive: a function and triggers. No data changes.
create or replace function public.entity_activity_append_only() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.actor_id is null
     and old.actor_id is not null
     and (new.id, new.asset_id, new.at, new.actor_name, new.source, new.kind, new.summary, new.detail)
         is not distinct from (old.id, old.asset_id, old.at, old.actor_name, old.source, old.kind, old.summary, old.detail) then
    return new;
  end if;
  raise exception 'entity_activity is append-only: rows are never changed or removed';
end;
$$;

drop trigger if exists entity_activity_no_change on public.entity_activity;
create trigger entity_activity_no_change
  before update or delete on public.entity_activity
  for each row execute function public.entity_activity_append_only();

drop trigger if exists entity_activity_no_truncate on public.entity_activity;
create trigger entity_activity_no_truncate
  before truncate on public.entity_activity
  for each statement execute function public.entity_activity_append_only();
