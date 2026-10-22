-- Concurrent tree writes no longer lose each other.
--
-- tree_set_one (20261017_tree_nodes.sql) read a row, changed one path in its
-- JSON, and upserted the whole row back, with nothing held in between. Two
-- writes to different fields of one entity at the same moment both read the
-- old row, and whichever committed second put its stale copy back over the
-- first's field.
--
-- Now a write below the row level takes the row's lock as it reads it
-- (select ... for update), so a second writer waits and then works from the
-- first one's result. A row that doesn't exist yet can't be locked, so its
-- insert merges into whatever a concurrent writer inserted first (on conflict,
-- the path is set against the stored row, not replaced). Everything else is
-- unchanged: depth 0 and 1 still recurse, depth 2 still replaces the row
-- (last write wins, as a whole-row set should), null removes, and a row left
-- empty is deleted.

create or replace function public.tree_set_one(path text[], value jsonb)
returns void language plpgsql as $$
declare
  depth integer := coalesce(array_length(path, 1), 0);
  kv record;
  current_data jsonb;
  next_data jsonb;
begin
  if depth = 0 then
    if value is null or jsonb_typeof(value) = 'null' then
      delete from public.tree_nodes;
    elsif jsonb_typeof(value) = 'object' then
      delete from public.tree_nodes where collection not in (select key from jsonb_object_keys(value) as key);
      for kv in select key, val from jsonb_each(value) as e(key, val) loop
        perform public.tree_set_one(array[kv.key], kv.val);
      end loop;
    end if;
    return;
  end if;

  if depth = 1 then
    if value is null or jsonb_typeof(value) = 'null' then
      delete from public.tree_nodes where collection = path[1];
    elsif jsonb_typeof(value) = 'object' then
      delete from public.tree_nodes where collection = path[1] and id not in (select key from jsonb_object_keys(value) as key);
      for kv in select key, val from jsonb_each(value) as e(key, val) loop
        perform public.tree_set_one(array[path[1], kv.key], kv.val);
      end loop;
    end if;
    return;
  end if;

  -- Depth 2: the whole row is replaced, so there's nothing to merge with.
  if depth = 2 then
    next_data := value;
    if next_data is null or jsonb_typeof(next_data) = 'null' or next_data = '{}'::jsonb then
      delete from public.tree_nodes where collection = path[1] and id = path[2];
      return;
    end if;
    insert into public.tree_nodes (collection, id, data, updated_at)
      values (path[1], path[2], next_data, now())
      on conflict (collection, id) do update set data = excluded.data, updated_at = now();
    return;
  end if;

  -- Deeper: part of a row. Lock the row while reading it, so the change is
  -- made to the latest version and nobody else's lands in between.
  select t.data into current_data
    from public.tree_nodes t
    where t.collection = path[1] and t.id = path[2]
    for update;

  if found then
    next_data := public.jsonb_deep_set(current_data, path[3:], value);
    if next_data is null or jsonb_typeof(next_data) = 'null' or next_data = '{}'::jsonb then
      delete from public.tree_nodes where collection = path[1] and id = path[2];
    else
      update public.tree_nodes set data = next_data, updated_at = now()
        where collection = path[1] and id = path[2];
    end if;
    return;
  end if;

  -- No row yet. Removing a path from a row that isn't there changes nothing
  -- (and must not delete a row a concurrent writer has just created).
  next_data := public.jsonb_deep_set(null, path[3:], value);
  if next_data is null or jsonb_typeof(next_data) = 'null' or next_data = '{}'::jsonb then
    return;
  end if;
  -- If another writer inserted the row meanwhile, set this path within theirs
  -- instead of replacing it. Setting a non-empty value never empties a row.
  insert into public.tree_nodes as t (collection, id, data, updated_at)
    values (path[1], path[2], next_data, now())
    on conflict (collection, id) do update
      set data = public.jsonb_deep_set(t.data, path[3:], value), updated_at = now();
end $$;
