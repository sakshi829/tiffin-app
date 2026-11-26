-- =============================================================================
-- 2100 WEB PUSH (Phase 8): alerts for the web app (iPhone home-screen app and
-- Android/desktop browsers). Browser subscriptions are validated when saved,
-- handed to the push sender with the phone tokens, and removed when the push
-- service says they are gone. Tests: 26-web-push-db.test.mjs.
-- =============================================================================

-- A browser subscription: { endpoint: https://<real push service>/..., keys: { p256dh, auth } }.
-- Only Apple, Google/Chrome, Mozilla and Microsoft push services are accepted (no SSRF).
create or replace function app.valid_web_push(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and jsonb_typeof(p -> 'keys') = 'object'
     and coalesce(p ->> 'endpoint', '') ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/[!-~]+$'
     and char_length(p ->> 'endpoint') <= 1000
     and coalesce(p -> 'keys' ->> 'p256dh', '') ~ '^[A-Za-z0-9_-]{87}$'
     and coalesce(p -> 'keys' ->> 'auth', '') ~ '^[A-Za-z0-9_-]{22}$'
$$;

create or replace function public.register_device(p_platform text, p_expo_push_token text, p_web_push jsonb, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_sub jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_platform not in ('android','ios','web') then raise exception 'INVALID_PLATFORM' using errcode = 'P0001'; end if;
  if p_web_push is not null and not app.valid_web_push(p_web_push) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if (p_expo_push_token is null) = (p_web_push is null) then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if not app.rate_limit_hit('register_device', 20, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  -- A phone token / browser subscription moves with the physical device: remove it from any previous owner.
  if p_expo_push_token is not null then
    delete from public.devices where expo_push_token = p_expo_push_token and user_id <> auth.uid();
    select id into v_id from public.devices where expo_push_token = p_expo_push_token;
  else
    -- keep only what is needed: endpoint + keys
    v_sub := jsonb_build_object('endpoint', p_web_push ->> 'endpoint',
               'keys', jsonb_build_object('p256dh', p_web_push -> 'keys' ->> 'p256dh', 'auth', p_web_push -> 'keys' ->> 'auth'));
    delete from public.devices where web_push ->> 'endpoint' = v_sub ->> 'endpoint' and user_id <> auth.uid();
    select id into v_id from public.devices where web_push ->> 'endpoint' = v_sub ->> 'endpoint';
  end if;
  if v_id is not null then
    update public.devices set last_seen_at = app.now(), device_label = app.clean_text(p_label, 100),
                              web_push = coalesce(v_sub, web_push) where id = v_id;
  else
    insert into public.devices (user_id, platform, expo_push_token, web_push, device_label)
    values (auth.uid(), p_platform, p_expo_push_token, v_sub, app.clean_text(p_label, 100))
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- The sender now also receives each recipient's browser subscriptions.
drop function public.push_claim(int);
create function public.push_claim(p_limit int)
returns table (notification_id uuid, title text, body text, data jsonb, tokens text[], web jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select n.id from public.notifications n
    where n.push_status = 'pending' and n.push_attempts < 5 and n.created_at > app.now() - interval '1 day'
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), upd as (
    update public.notifications n
       set push_status = 'sending', push_attempts = n.push_attempts + 1, push_updated_at = app.now()
      from picked where n.id = picked.id
    returning n.id, n.user_id, n.title, n.body, n.data, n.kind
  )
  select u.id, u.title, u.body,
         u.data || jsonb_build_object('kind', u.kind, 'notification_id', u.id),
         coalesce(array_agg(d.expo_push_token) filter (where d.expo_push_token is not null), '{}'::text[]),
         coalesce(jsonb_agg(jsonb_build_object('device_id', d.id, 'sub', d.web_push)) filter (where d.web_push is not null), '[]'::jsonb)
  from upd u left join public.devices d on d.user_id = u.user_id
  group by u.id, u.title, u.body, u.data, u.kind;
end $$;
revoke execute on function public.push_claim(int) from public, anon, authenticated;
grant execute on function public.push_claim(int) to service_role;

-- push_complete: also remove browser subscriptions the push service reported gone (404/410).
create or replace function public.push_complete(p_results jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare e jsonb; v int := 0;
begin
  if jsonb_typeof(p_results) <> 'array' then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  for e in select * from jsonb_array_elements(p_results) loop
    update public.notifications n set
      push_status = case e ->> 'status'
                      when 'sent' then 'sent'
                      when 'no_device' then 'skipped'
                      when 'retry' then case when n.push_attempts >= 5 then 'failed' else 'pending' end
                      else 'failed' end,
      push_updated_at = app.now()
    where n.id = (e ->> 'id')::uuid and n.push_status = 'sending';
    v := v + 1;
    if jsonb_typeof(e -> 'invalid_tokens') = 'array' then
      delete from public.devices where expo_push_token in (select jsonb_array_elements_text(e -> 'invalid_tokens'));
    end if;
    if jsonb_typeof(e -> 'invalid_web') = 'array' then
      delete from public.devices
       where web_push is not null
         and id in (select app.try_uuid(x) from jsonb_array_elements_text(e -> 'invalid_web') x);
    end if;
    if jsonb_typeof(e -> 'tickets') = 'array' then
      insert into app.push_tickets (ticket_id, token)
      select x ->> 'id', x ->> 'token' from jsonb_array_elements(e -> 'tickets') x
      where char_length(coalesce(x ->> 'id', '')) between 1 and 100 and char_length(coalesce(x ->> 'token', '')) between 1 and 260
      on conflict (ticket_id) do nothing;
    end if;
  end loop;
  return v;
end $$;
