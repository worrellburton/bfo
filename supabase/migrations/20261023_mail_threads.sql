-- Conversations. Every message gets a thread_key, shared by the messages of
-- one conversation (per mailbox owner), and thread_at, the time of the
-- conversation's latest message, so a list can show each conversation once,
-- ordered by its latest activity.
--
-- A message joins the conversation of any earlier message it names (its
-- Message-ID, In-Reply-To or References). Our sent mail goes out without a
-- Message-ID we know (the sending service assigns it), so a reply to it names
-- an id we've never seen: such a reply joins the sent message to its sender
-- with the same subject (Re: aside, or ours inside a ticket desk's), and that
-- sent message learns its id.
-- Otherwise the conversation is keyed by its root: the first References id,
-- else In-Reply-To, else its own Message-ID, else its row id.

alter table public.mail_messages add column if not exists thread_key text;
alter table public.mail_messages add column if not exists thread_at timestamptz;

create index if not exists mail_messages_thread_idx on public.mail_messages (user_id, thread_key);
create index if not exists mail_messages_thread_at_idx on public.mail_messages (user_id, folder, thread_at desc, id desc);
create index if not exists mail_messages_message_id_idx on public.mail_messages (message_id) where message_id is not null;

-- "Re: Fwd: [2] Hello" → "hello"
create or replace function public.mail_base_subject(s text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(s, ''), '^(\s*(re|fw|fwd|aw|sv|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i')))
$$;

-- The conversation a message belongs to (looking only at messages already keyed).
create or replace function public.mail_thread_key(msg public.mail_messages) returns text
language plpgsql as $$
declare
  ids text[];
  found_key text;
  sent_id uuid;
begin
  ids := array_remove(array[msg.message_id, msg.in_reply_to] || coalesce(msg.references_ids, '{}'::text[]), null);

  if array_length(ids, 1) > 0 then
    select m.thread_key into found_key
    from public.mail_messages m
    where m.user_id is not distinct from msg.user_id
      and m.thread_key is not null
      and m.id <> msg.id
      and (m.message_id = any(ids) or m.in_reply_to = any(ids) or m.references_ids && ids)
    order by m.occurred_at desc nulls last
    limit 1;
  end if;

  -- A reply to our own sent mail, whose Message-ID we never knew.
  if found_key is null and msg.direction = 'in' and msg.from_email is not null
     and (msg.in_reply_to is not null or msg.subject ~* '^\s*(re|aw|sv)\s*:')
     and public.mail_base_subject(msg.subject) <> '' then
    select m.id, m.thread_key into sent_id, found_key
    from public.mail_messages m
    where m.user_id is not distinct from msg.user_id
      and m.direction = 'out'
      and m.message_id is null
      and m.thread_key is not null
      and m.id <> msg.id
      -- Same subject, or ours inside theirs (ticket desks add "[Request #123 received]").
      and (public.mail_base_subject(m.subject) = public.mail_base_subject(msg.subject)
        or (length(public.mail_base_subject(m.subject)) >= 8
          and position(public.mail_base_subject(m.subject) in lower(msg.subject)) > 0))
      and coalesce(m.occurred_at, m.created_at) <= coalesce(msg.occurred_at, now())
      and coalesce(m.occurred_at, m.created_at) > coalesce(msg.occurred_at, now()) - interval '120 days'
      and exists (
        select 1 from jsonb_array_elements(coalesce(m.to_addrs, '[]'::jsonb) || coalesce(m.cc_addrs, '[]'::jsonb)) a
        where lower(a->>'email') = lower(msg.from_email)
      )
    order by m.occurred_at desc nulls last
    limit 1;
    if sent_id is not null and msg.in_reply_to is not null then
      update public.mail_messages set message_id = msg.in_reply_to where id = sent_id and message_id is null;
    end if;
  end if;

  return coalesce(found_key, msg.references_ids[1], msg.in_reply_to, msg.message_id, 'id:' || msg.id::text);
end;
$$;

create or replace function public.mail_thread_before_insert() returns trigger
language plpgsql as $$
declare
  latest timestamptz;
begin
  if new.thread_key is null then
    new.thread_key := public.mail_thread_key(new);
  end if;
  select max(m.thread_at) into latest
  from public.mail_messages m
  where m.user_id is not distinct from new.user_id and m.thread_key = new.thread_key and m.id <> new.id;
  new.thread_at := greatest(coalesce(new.occurred_at, new.created_at, now()), latest);
  return new;
end;
$$;

create or replace function public.mail_thread_after_insert() returns trigger
language plpgsql as $$
begin
  update public.mail_messages
  set thread_at = new.thread_at
  where user_id is not distinct from new.user_id
    and thread_key = new.thread_key
    and id <> new.id
    and (thread_at is null or thread_at < new.thread_at);
  return null;
end;
$$;

drop trigger if exists mail_thread_before_insert on public.mail_messages;
create trigger mail_thread_before_insert before insert on public.mail_messages
  for each row execute function public.mail_thread_before_insert();

drop trigger if exists mail_thread_after_insert on public.mail_messages;
create trigger mail_thread_after_insert after insert on public.mail_messages
  for each row execute function public.mail_thread_after_insert();

-- Existing mail, oldest first, as if it had just arrived.
do $$
declare
  r public.mail_messages;
begin
  for r in select * from public.mail_messages where thread_key is null order by coalesce(occurred_at, created_at), id loop
    update public.mail_messages set thread_key = public.mail_thread_key(r) where id = r.id;
  end loop;
  update public.mail_messages m
  set thread_at = t.latest
  from (
    select user_id, thread_key, max(coalesce(occurred_at, created_at)) as latest
    from public.mail_messages group by user_id, thread_key
  ) t
  where m.user_id is not distinct from t.user_id and m.thread_key = t.thread_key and m.thread_at is null;
end;
$$;
