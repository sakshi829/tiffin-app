-- =============================================================================
-- 2000 LAUNCH (Phase 7b): push receipts (F22), new sign-in alert (F24), live chat
-- (F29), tidy references to deleted files (F32), unused receipt clean-up (F33),
-- meals-by-weekday heatmap (F36). Tests: 24-launch.test.mjs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Push receipts (F22). Expo gives a ticket per message; ~15 min later its
--    receipt says whether the phone really got it. "DeviceNotRegistered" means
--    the app was uninstalled: that token is removed. Service role only.
-- ---------------------------------------------------------------------------
create table app.push_tickets (
  ticket_id   text primary key check (char_length(ticket_id) between 1 and 100),
  token       text not null check (char_length(token) <= 260),
  created_at  timestamptz not null default app.now()
);
revoke all on app.push_tickets from public, anon, authenticated;

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
    if jsonb_typeof(e -> 'tickets') = 'array' then
      insert into app.push_tickets (ticket_id, token)
      select x ->> 'id', x ->> 'token' from jsonb_array_elements(e -> 'tickets') x
      where char_length(coalesce(x ->> 'id', '')) between 1 and 100 and char_length(coalesce(x ->> 'token', '')) between 1 and 260
      on conflict (ticket_id) do nothing;
    end if;
  end loop;
  return v;
end $$;

-- Tickets whose receipts are ready (15 min .. 24 h old). Older ones are dropped:
-- Expo keeps receipts for about a day.
create or replace function public.push_receipts_due(p_limit int) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  delete from app.push_tickets where created_at < app.now() - interval '24 hours';
  return query
  select t.ticket_id from app.push_tickets t
  where t.created_at <= app.now() - interval '15 minutes'
  order by t.created_at
  limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end $$;

-- p_checked: tickets whose receipt was read; p_unregistered: those that said DeviceNotRegistered.
create or replace function public.push_receipts_done(p_checked text[], p_unregistered text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  delete from public.devices d
   where d.expo_push_token in (select t.token from app.push_tickets t where t.ticket_id = any (coalesce(p_unregistered, '{}')));
  get diagnostics v = row_count;
  delete from app.push_tickets where ticket_id = any (coalesce(p_checked, '{}'));
  return v;
end $$;
revoke execute on function public.push_receipts_due(int), public.push_receipts_done(text[], text[]) from public, anon, authenticated;
grant execute on function public.push_receipts_due(int), public.push_receipts_done(text[], text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. "New sign-in on your account" (F24). Each app reports a completed sign-in;
--    from the second sign-in on, the person gets an alert on all their devices
--    and in the app. It cannot be muted.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'meal_delivered','late_skip','closure','closure_cancelled','location_reminder','location_changed',
  'route_ready','payment_submitted','payment_confirmed','payment_rejected','bill_ready',
  'daily_summary','announcement','due_reminder','late_fee','low_balance','chat_message','referral_request','referral_decision',
  'expense_due','loyalty_reward','new_sign_in'));

create table app.sign_ins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id),
  app_name    text not null check (app_name in ('owner','customer','staff')),
  label       text check (char_length(label) <= 60),
  created_at  timestamptz not null default app.now()
);
create index sign_ins_user on app.sign_ins (user_id, created_at desc);
revoke all on app.sign_ins from public, anon, authenticated;

create or replace function public.record_sign_in(p_app text, p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_first boolean; v_label text := coalesce(app.clean_text(p_label, 60), 'a device'); v_id uuid; k uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_app not in ('owner','customer','staff') then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if not app.rate_limit_hit('record_sign_in', 10, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  v_first := not exists (select 1 from app.sign_ins where user_id = auth.uid());
  insert into app.sign_ins (user_id, app_name, label) values (auth.uid(), p_app, v_label) returning id into v_id;
  delete from app.sign_ins where user_id = auth.uid() and created_at < app.now() - interval '180 days';
  if v_first then return; end if;
  -- one alert per kitchen the person belongs to (normally one)
  for k in
    select s.kitchen_id from public.staff_members s where s.user_id = auth.uid() and s.active
    union
    select c.kitchen_id from public.customers c where c.user_id = auth.uid() and c.status <> 'archived'
  loop
    perform app.notify(k, auth.uid(), 'new_sign_in', 'New sign-in to your account',
      'Signed in on ' || v_label || ' at ' || app.ist_clock(app.now()) || ', ' || to_char(app.now() at time zone 'Asia/Kolkata', 'DD Mon')
        || '. Not you? Sign out on all your devices and tell the kitchen.',
      jsonb_build_object('app', p_app), 'signin:' || v_id || ':' || k);
  end loop;
end $$;
revoke execute on function public.record_sign_in(text, text) from public, anon;
grant execute on function public.record_sign_in(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Live chat (F29): new messages are pushed to the open chat screen by
--    Supabase Realtime. Realtime applies the same row-level security, so each
--    person only ever receives their own thread. (Skipped where the publication
--    does not exist, e.g. the test database.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'chat_messages') then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. After the daily clean-up deletes files, forget them (F32): the apps then
--    simply show nothing instead of "photo no longer available". Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.media_forget(p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare e jsonb; v int := 0; n int;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    n := 0;
    case e ->> 'bucket'
      when 'delivery-proofs' then delete from public.delivery_proofs where path = e ->> 'name';
      when 'voice-notes'     then update public.chat_messages set voice_path = null, voice_seconds = null where voice_path = e ->> 'name';
      when 'payment-proofs'  then update public.payments set proof_path = null where proof_path = e ->> 'name';
      when 'receipts'        then update public.expenses set receipt_path = null where receipt_path = e ->> 'name';
      else null;
    end case;
    if e ->> 'bucket' in ('delivery-proofs','voice-notes','payment-proofs','receipts') then get diagnostics n = row_count; end if;
    v := v + n;
  end loop;
  return v;
end $$;
revoke execute on function public.media_forget(jsonb) from public, anon, authenticated;
grant execute on function public.media_forget(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Media clean-up list, now also: receipt photos no expense points to, older
--    than 2 days (F33: picked on the form, then the form was abandoned).
-- ---------------------------------------------------------------------------
create or replace function public.media_expired(p_limit int)
returns table (bucket_id text, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select o.bucket_id, o.name
  from storage.objects o
  join public.business_settings s on s.kitchen_id = app.try_uuid(split_part(o.name, '/', 1))
  where (o.bucket_id in ('delivery-proofs','voice-notes') and o.created_at < app.now() - make_interval(days => s.media_retention_days))
     or (o.bucket_id = 'payment-proofs' and o.created_at < app.now() - interval '400 days')
     or (o.bucket_id in ('delivery-proofs','voice-notes','payment-proofs')
         and exists (select 1 from public.customers c where c.id = app.try_uuid(split_part(o.name, '/', 2)) and c.erased_at is not null))
     or (o.bucket_id = 'receipts' and o.created_at < app.now() - interval '2 days'
         and not exists (select 1 from public.expenses x where x.receipt_path = o.name))
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Meals by weekday x lunch/dinner (F36), for the Reports heatmap.
-- ---------------------------------------------------------------------------
create or replace function public.owner_weekday_counts(p_kitchen uuid, p_from date, p_to date)
returns table (weekday int, meal_slot text, delivered int, skipped int, days int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  return query
  select g.wd, g.slot,
         coalesce(sum(case when o.status = 'delivered' then 1 else 0 end), 0)::int,
         coalesce(sum(case when o.status in ('skipped','skipped_late') then 1 else 0 end), 0)::int,
         (select count(*)::int from generate_series(p_from, p_to, interval '1 day') d where extract(isodow from d)::int = g.wd)
  from (select wd, slot from generate_series(1, 7) wd cross join (values ('lunch'), ('dinner')) s(slot)) g
  left join public.orders o
    on o.kitchen_id = p_kitchen and o.order_date between p_from and p_to
   and extract(isodow from o.order_date)::int = g.wd and o.meal_slot = g.slot
  group by g.wd, g.slot
  order by g.wd, g.slot;
end $$;
revoke execute on function public.owner_weekday_counts(uuid, date, date) from public, anon;
grant execute on function public.owner_weekday_counts(uuid, date, date) to authenticated;
