-- The JSON tree that used to live in Firebase Realtime Database.
--
-- A path like "assets/<id>/documents/<docId>" is a collection ("assets"), a
-- row id ("<id>") and a path inside that row's JSON. Reads are plain selects;
-- writes go through tree_apply(), which sets, merges or removes at a path in
-- one statement so concurrent edits to different fields don't clobber each
-- other. Keys set to null are removed and empty objects are pruned, as in
-- Firebase.

create table if not exists public.tree_nodes (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists tree_nodes_updated_idx on public.tree_nodes (collection, updated_at desc);
alter table public.tree_nodes enable row level security;

-- One row per collection copied out of Firebase, so the copy runs once.
create table if not exists public.tree_imports (
  collection text primary key,
  status text not null check (status in ('running', 'done', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  count integer,
  error text,
  -- assets only: every file once stored in Firebase Storage now lives in Supabase Storage.
  files_done boolean not null default false
);
alter table public.tree_imports enable row level security;

-- Set `value` at `path` inside `target`, creating objects on the way. A null
-- value removes the key; an object left empty is removed too.
create or replace function public.jsonb_deep_set(target jsonb, path text[], value jsonb)
returns jsonb language plpgsql immutable as $$
declare
  base jsonb;
  k text;
  nxt jsonb;
  gone boolean;
begin
  if coalesce(array_length(path, 1), 0) = 0 then
    return value;
  end if;
  base := case when jsonb_typeof(target) = 'object' then target else '{}'::jsonb end;
  k := path[1];
  if array_length(path, 1) = 1 then
    nxt := value;
  else
    nxt := public.jsonb_deep_set(base -> k, path[2:], value);
  end if;
  gone := nxt is null or jsonb_typeof(nxt) = 'null' or nxt = '{}'::jsonb;
  if gone then
    return base - k;
  end if;
  return base || jsonb_build_object(k, nxt);
end $$;

-- Set one path. Depth 0 replaces everything, depth 1 a collection, deeper a
-- row or part of one. Null removes.
create or replace function public.tree_set_one(path text[], value jsonb)
returns void language plpgsql as $$
declare
  depth integer := coalesce(array_length(path, 1), 0);
  kv record;
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

  if depth = 2 then
    next_data := value;
  else
    select public.jsonb_deep_set(t.data, path[3:], value) into next_data
      from public.tree_nodes t where t.collection = path[1] and t.id = path[2];
    if not found then
      next_data := public.jsonb_deep_set(null, path[3:], value);
    end if;
  end if;

  if next_data is null or jsonb_typeof(next_data) = 'null' or next_data = '{}'::jsonb then
    delete from public.tree_nodes where collection = path[1] and id = path[2];
    return;
  end if;

  insert into public.tree_nodes (collection, id, data, updated_at)
    values (path[1], path[2], next_data, now())
    on conflict (collection, id) do update set data = excluded.data, updated_at = now();
end $$;

-- Apply a list of operations in one transaction:
--   {"op":"set","path":["assets","x"],"value":{...}}        replace (null removes)
--   {"op":"update","path":["assets","x"],"value":{"a":1,"b/c":null}}  set each key (keys may hold "/")
create or replace function public.tree_apply(ops jsonb)
returns void language plpgsql as $$
declare
  op jsonb;
  path text[];
  kv record;
begin
  for op in select * from jsonb_array_elements(ops) loop
    path := coalesce(array(select jsonb_array_elements_text(op -> 'path')), '{}'::text[]);
    if op ->> 'op' = 'update' then
      for kv in select key, val from jsonb_each(coalesce(op -> 'value', '{}'::jsonb)) as e(key, val) loop
        perform public.tree_set_one(path || string_to_array(kv.key, '/'), kv.val);
      end loop;
    else
      perform public.tree_set_one(path, op -> 'value');
    end if;
  end loop;
end $$;
