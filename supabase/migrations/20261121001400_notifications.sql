-- =============================================================================
-- 1400 NOTIFICATIONS (Phase 4)
-- Every event writes an INBOX row (visible in the apps). A separate push
-- sender (Edge Function `send-push`, service role only) delivers pending rows
-- to phones via Expo Push. Events are raised by triggers, so every path
-- (owner, staff, customer, scheduled job) notifies consistently.
-- =============================================================================

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  kitchen_id       uuid not null references public.kitchens(id),
  user_id          uuid not null references auth.users(id),
  kind             text not null check (kind in (
                     'meal_delivered','late_skip','closure','closure_cancelled','location_reminder','location_changed',
                     'route_ready','payment_submitted','payment_confirmed','payment_rejected','bill_ready',
                     'daily_summary','announcement')),
  title            text not null check (char_length(title) between 1 and 80),
  body             text not null check (char_length(body) between 1 and 300),
  data             jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1000),
  dedupe_key       text unique,
  created_at       timestamptz not null default app.now(),   -- same server clock as every time rule
  read_at          timestamptz,
  push_status      text not null default 'pending' check (push_status in ('pending','sending','sent','failed','skipped')),
  push_attempts    int not null default 0,
  push_updated_at  timestamptz
);
create index notifications_user_created on public.notifications (user_id, created_at desc);
create index notifications_push_queue on public.notifications (created_at) where push_status in ('pending','sending');

create table public.notification_prefs (
  user_id      uuid primary key references auth.users(id),
  muted_kinds  text[] not null default '{}',
  updated_at   timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
grant select on public.notifications, public.notification_prefs to authenticated;
create policy read_own on public.notifications      for select to authenticated using (user_id = auth.uid());
create policy read_own on public.notification_prefs for select to authenticated using (user_id = auth.uid());

-- Kinds a person may switch off. Days off, payments, bills and announcements always arrive.
create or replace function app.mutable_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['location_reminder','meal_delivered','route_ready','location_changed','late_skip','daily_summary','payment_submitted']
$$;

create or replace function app.rupees(p_paise bigint) returns text
language sql immutable set search_path = '' as $$
  select '₹' || regexp_replace(to_char(p_paise / 100.0, 'FM9999999990.00'), '\.00$', '')
$$;

create or replace function app.ist_clock(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select ltrim(to_char(p_ts at time zone 'Asia/Kolkata', 'HH12:MI AM'), '0')
$$;

create or replace function app.slot_label(p_slot text) returns text
language sql immutable set search_path = '' as $$
  select case p_slot when 'lunch' then 'Lunch' when 'dinner' then 'Dinner' else 'Meal' end
$$;

-- ---------------------------------------------------------------------------
-- Core: one inbox row (deduplicated). Muted kinds stay in the inbox, no push.
-- ---------------------------------------------------------------------------
create or replace function app.notify(p_kitchen uuid, p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_dedupe text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_muted boolean;
begin
  if p_user is null then return; end if;
  select p_kind = any (np.muted_kinds) into v_muted from public.notification_prefs np where np.user_id = p_user;
  insert into public.notifications (kitchen_id, user_id, kind, title, body, data, dedupe_key, push_status)
  values (p_kitchen, p_user, p_kind, left(p_title, 80), left(p_body, 300), coalesce(p_data, '{}'::jsonb), p_dedupe,
          case when coalesce(v_muted, false) then 'skipped' else 'pending' end)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function app.notify_owners(p_kitchen uuid, p_kind text, p_title text, p_body text, p_data jsonb, p_dedupe text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select user_id from public.staff_members where kitchen_id = p_kitchen and role = 'owner' and active loop
    perform app.notify(p_kitchen, r.user_id, p_kind, p_title, p_body, p_data,
                       case when p_dedupe is null then null else p_dedupe || ':' || r.user_id end);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Order events
-- ---------------------------------------------------------------------------
create or replace function app.orders_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers; s public.staff_members; cl public.closures;
  v_slot text := app.slot_label(new.meal_slot);
  v_day text := to_char(new.order_date, 'Dy DD Mon');
  v_data jsonb := jsonb_build_object('order_id', new.id, 'date', new.order_date, 'meal_slot', new.meal_slot);
  v_place text;
begin
  select * into c from public.customers where id = new.customer_id;
  if new.assigned_staff_id is not null then select * into s from public.staff_members where id = new.assigned_staff_id; end if;

  if new.status is distinct from old.status then
    if new.status = 'delivered' then
      perform app.notify(new.kitchen_id, c.user_id, 'meal_delivered', v_slot || ' delivered',
        'Your ' || lower(v_slot) || ' has been delivered. Enjoy your meal!', v_data, 'delivered:' || new.id);

    elsif new.status = 'skipped_late' then
      perform app.notify_owners(new.kitchen_id, 'late_skip', c.full_name || ' skipped ' || lower(v_slot) || ' late',
        c.full_name || ' will not take ' || lower(v_slot) || ' on ' || v_day || ' (after the cutoff).', v_data, 'lateskip:' || new.id);
      if s.id is not null then
        perform app.notify(new.kitchen_id, s.user_id, 'late_skip', 'Skip ' || c.full_name,
          c.full_name || ' will not take ' || lower(v_slot) || ' today. Do not deliver.', v_data, 'lateskip-staff:' || new.id);
      end if;

    elsif new.status = 'cancelled_closure' and new.order_date >= app.today() then
      select * into cl from public.closures x
       where x.kitchen_id = new.kitchen_id and x.closure_date = new.order_date and x.cancelled_at is null
         and (x.meal_slot is null or x.meal_slot = new.meal_slot)
       order by x.created_at desc limit 1;
      if cl.id is not null then
        perform app.notify(new.kitchen_id, c.user_id, 'closure', 'Kitchen closed ' || v_day,
          'No ' || case when cl.meal_slot is null then 'lunch or dinner' else lower(app.slot_label(cl.meal_slot)) end
            || ' on ' || v_day || coalesce(' (' || cl.reason || ')', '') || '. You will not be charged.',
          jsonb_build_object('date', new.order_date), 'closure:' || cl.id || ':' || new.customer_id);
      end if;

    elsif old.status = 'cancelled_closure' and new.order_date >= app.today() then
      select * into cl from public.closures x
       where x.kitchen_id = new.kitchen_id and x.closure_date = new.order_date and x.cancelled_at is not null
       order by x.cancelled_at desc limit 1;
      perform app.notify(new.kitchen_id, c.user_id, 'closure_cancelled', 'Kitchen open ' || v_day,
        'Good news: your ' || lower(v_slot) || ' on ' || v_day || ' is back on.', v_data,
        'reopen:' || coalesce(cl.id::text, 'x') || ':' || new.id);
    end if;
  end if;

  -- Route ready: once per staff member per day and meal.
  if s.id is not null and new.assigned_staff_id is distinct from old.assigned_staff_id and new.status = 'scheduled' then
    perform app.notify(new.kitchen_id, s.user_id, 'route_ready', v_slot || ' route ready',
      'Deliveries for ' || lower(v_slot) || ' on ' || v_day || ' are assigned to you.',
      jsonb_build_object('date', new.order_date, 'meal_slot', new.meal_slot),
      'route:' || s.id || ':' || new.order_date || ':' || new.meal_slot);
  end if;

  -- Customer moved after the route was planned (today, after the extras cutoff).
  if s.id is not null and new.status = 'scheduled' and new.order_date = app.today()
     and new.location_updated_at is distinct from old.location_updated_at
     and app.now() >= (select t.addon_cutoff_at from app.slot_times(new.kitchen_id, new.order_date, new.meal_slot) t) then
    v_place := coalesce(case when new.location_node_id is not null then app.location_path(new.location_node_id) end, '')
               || coalesce(case when new.location_node_id is not null and new.location_text is not null then ' (' || new.location_text || ')'
                                else new.location_text end, '');
    perform app.notify(new.kitchen_id, s.user_id, 'location_changed', c.full_name || ' moved',
      c.full_name || ' is now at: ' || coalesce(nullif(v_place, ''), 'see app') || '.', v_data,
      'loc:' || new.id || ':' || extract(epoch from new.location_updated_at)::bigint);
  end if;
  return new;
end $$;

create trigger orders_notify after update on public.orders
  for each row execute function app.orders_notify();

-- ---------------------------------------------------------------------------
-- Payment and bill events
-- ---------------------------------------------------------------------------
create or replace function app.payments_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_data jsonb := jsonb_build_object('payment_id', new.id);
begin
  select * into c from public.customers where id = new.customer_id;
  if tg_op = 'INSERT' and new.status = 'submitted' then
    perform app.notify_owners(new.kitchen_id, 'payment_submitted', c.full_name || ' paid ' || app.rupees(new.amount_paise),
      'UPI reference ' || coalesce(new.utr, '-') || '. Check your bank app, then confirm in Money.', v_data, 'paysub:' || new.id);
  end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    perform app.notify(new.kitchen_id, c.user_id, 'payment_confirmed', 'Payment received',
      app.rupees(new.amount_paise) || ' received. Thank you!', v_data, 'payok:' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform app.notify(new.kitchen_id, c.user_id, 'payment_rejected', 'Payment not found',
      app.rupees(new.amount_paise) || ' (UTR ' || coalesce(new.utr, '-') || ') could not be matched: ' || coalesce(new.rejected_reason, '') ,
      v_data, 'payno:' || new.id);
  end if;
  return new;
end $$;
create trigger payments_notify after insert or update on public.payments
  for each row execute function app.payments_notify();

create or replace function app.bills_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = new.customer_id;
  perform app.notify(new.kitchen_id, c.user_id, 'bill_ready', 'Your bill is ready',
    case when new.closing_balance_paise > 0
      then app.rupees(new.closing_balance_paise) || ' due by ' || to_char(new.due_date, 'DD Mon') || ' (bill ' || new.bill_no || ').'
      else 'Nothing due (bill ' || new.bill_no || ').' end,
    jsonb_build_object('bill_id', new.id), 'bill:' || new.id);
  return new;
end $$;
create trigger bills_notify after insert on public.bills
  for each row execute function app.bills_notify();

-- ---------------------------------------------------------------------------
-- Scheduled: reminders, owner's daily summary, push housekeeping, retention.
-- ---------------------------------------------------------------------------
create or replace function app.run_notification_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_summary text;
begin
  -- 1. "Where are you today?": 30 min before the location cutoff, if no place is set.
  for r in
    select o.id, o.kitchen_id, o.meal_slot, o.order_date, c.user_id, t.location_cutoff_at
    from public.orders o
    join public.customers c on c.id = o.customer_id
    cross join lateral app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t
    where o.order_date = app.today() and o.status = 'scheduled'
      and o.location_node_id is null and o.location_text is null and c.user_id is not null
      and app.now() >= t.location_cutoff_at - interval '30 minutes' and app.now() < t.location_cutoff_at
  loop
    perform app.notify(r.kitchen_id, r.user_id, 'location_reminder', 'Where are you today?',
      'Set your place for ' || lower(app.slot_label(r.meal_slot)) || ' before ' || app.ist_clock(r.location_cutoff_at) || ' so we can deliver.',
      jsonb_build_object('order_id', r.id, 'date', r.order_date, 'meal_slot', r.meal_slot), 'locrem:' || r.id);
  end loop;

  -- 2. Owner summary once the extras/skip cutoff has passed (what to cook).
  for r in
    select m.kitchen_id, m.meal_slot, t.addon_cutoff_at, t.delivery_at
    from public.meal_slots m
    cross join lateral app.slot_times(m.kitchen_id, app.today(), m.meal_slot) t
    where m.active and app.now() >= t.addon_cutoff_at and app.now() < t.delivery_at + interval '1 hour'
  loop
    select count(*) || ' tiffins (' || count(*) filter (where tt.is_veg) || ' veg, ' || count(*) filter (where not tt.is_veg) || ' non-veg).'
           || coalesce(' Extras: ' || (
                select string_agg(x.name || ' ' || x.q, ', ' order by x.name) from (
                  select it.name, sum(a.qty) as q from public.order_addons a
                  join public.orders o2 on o2.id = a.order_id
                  join public.items it on it.id = a.item_id
                  where o2.kitchen_id = r.kitchen_id and o2.order_date = app.today() and o2.meal_slot = r.meal_slot
                    and o2.status in ('scheduled','delivered') and a.status = 'accepted'
                  group by it.name) x) || '.', '')
      into v_summary
    from public.orders o join public.tiffin_types tt on tt.id = o.tiffin_type_id
    where o.kitchen_id = r.kitchen_id and o.order_date = app.today() and o.meal_slot = r.meal_slot
      and o.status in ('scheduled','delivered');
    continue when v_summary like '0 tiffins%';
    perform app.notify_owners(r.kitchen_id, 'daily_summary', app.slot_label(r.meal_slot) || ' today: final count', v_summary,
      jsonb_build_object('date', app.today(), 'meal_slot', r.meal_slot), 'summary:' || r.kitchen_id || ':' || app.today() || ':' || r.meal_slot);
  end loop;

  -- 3. Push sends that never completed (sender crashed) go back to the queue.
  update public.notifications set push_status = 'pending'
   where push_status = 'sending' and push_updated_at < app.now() - interval '10 minutes';
  -- 4. Old pushes that never went out are given up after a day.
  update public.notifications set push_status = 'failed'
   where push_status = 'pending' and created_at < app.now() - interval '1 day';
  -- 5. Inbox keeps 60 days.
  delete from public.notifications where created_at < app.now() - interval '60 days';
end $$;

-- ---------------------------------------------------------------------------
-- User-facing functions
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  update public.notifications set read_at = app.now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.set_notification_prefs(p_muted text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_muted is null or not (p_muted <@ app.mutable_kinds()) or cardinality(p_muted) > 20 then
    raise exception 'INVALID_SETTING' using errcode = 'P0001';
  end if;
  insert into public.notification_prefs (user_id, muted_kinds, updated_at) values (auth.uid(), p_muted, app.now())
  on conflict (user_id) do update set muted_kinds = excluded.muted_kinds, updated_at = excluded.updated_at;
end $$;

-- Owner message to all customers (and optionally staff). Rate-limited.
create or replace function public.owner_send_announcement(p_kitchen uuid, p_title text, p_body text, p_include_staff boolean)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_title text := app.clean_text(p_title, 80); v_body text := app.clean_text(p_body, 300); r record; v int := 0;
begin
  perform app.require_owner(p_kitchen);
  if v_title is null or v_body is null then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if not app.rate_limit_hit('announcement', 10, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  for r in
    select user_id from public.customers where kitchen_id = p_kitchen and user_id is not null and status in ('active','paused')
    union
    select user_id from public.staff_members where kitchen_id = p_kitchen and active and role <> 'owner' and coalesce(p_include_staff, false)
  loop
    perform app.notify(p_kitchen, r.user_id, 'announcement', v_title, v_body, '{}'::jsonb, null);
    v := v + 1;
  end loop;
  return v;
end $$;

grant execute on function
  public.mark_notifications_read(uuid[]), public.set_notification_prefs(text[]),
  public.owner_send_announcement(uuid, text, text, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- Push sender API: ONLY the service role (used by the send-push Edge Function).
-- ---------------------------------------------------------------------------
create or replace function public.push_claim(p_limit int)
returns table (notification_id uuid, title text, body text, data jsonb, tokens text[])
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
         coalesce(array_agg(d.expo_push_token) filter (where d.expo_push_token is not null), '{}'::text[])
  from upd u left join public.devices d on d.user_id = u.user_id
  group by u.id, u.title, u.body, u.data, u.kind;
end $$;

-- p_results: [{ "id": uuid, "status": "sent"|"retry"|"failed"|"no_device", "invalid_tokens": [..] }]
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
  end loop;
  return v;
end $$;

revoke all on function public.push_claim(int), public.push_complete(jsonb) from public, anon, authenticated;
grant execute on function public.push_claim(int), public.push_complete(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule (where pg_cron exists): every 5 minutes.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    perform cron.schedule('notification-jobs', '*/5 * * * *', 'select app.run_notification_jobs()');
  end if;
end $$;
