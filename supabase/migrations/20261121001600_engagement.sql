-- =============================================================================
-- 1600 ENGAGEMENT (Phase 5a): scheduled announcements, automatic delivery
-- assignment by place, refer-a-friend (owner approves), customer <-> owner chat.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Announcements: shared sender + scheduled ones.
-- ---------------------------------------------------------------------------
create or replace function app.announce(p_kitchen uuid, p_title text, p_body text, p_include_staff boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v int := 0;
begin
  for r in
    select user_id from public.customers where kitchen_id = p_kitchen and user_id is not null and status in ('active','paused')
    union
    select user_id from public.staff_members where kitchen_id = p_kitchen and active and role <> 'owner' and coalesce(p_include_staff, false)
  loop
    perform app.notify(p_kitchen, r.user_id, 'announcement', p_title, p_body, '{}'::jsonb, null);
    v := v + 1;
  end loop;
  return v;
end $$;

create or replace function public.owner_send_announcement(p_kitchen uuid, p_title text, p_body text, p_include_staff boolean)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_title text := app.clean_text(p_title, 80); v_body text := app.clean_text(p_body, 300);
begin
  perform app.require_owner(p_kitchen);
  if v_title is null or v_body is null then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if not app.rate_limit_hit('announcement', 10, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  return app.announce(p_kitchen, v_title, v_body, p_include_staff);
end $$;

create table public.announcements (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references public.kitchens(id),
  title          text not null check (char_length(title) between 1 and 80),
  body           text not null check (char_length(body) between 1 and 300),
  include_staff  boolean not null default false,
  send_at        timestamptz not null,
  sent_at        timestamptz,
  sent_count     int,
  cancelled_at   timestamptz,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default app.now()
);
alter table public.announcements enable row level security;
grant select on public.announcements to authenticated;
create policy read_owner on public.announcements for select to authenticated using (app.is_owner(kitchen_id));

create or replace function public.owner_schedule_announcement(
  p_kitchen uuid, p_title text, p_body text, p_include_staff boolean, p_send_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text := app.clean_text(p_title, 80); v_body text := app.clean_text(p_body, 300);
begin
  perform app.require_owner(p_kitchen);
  if v_title is null or v_body is null then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if p_send_at is null or p_send_at <= app.now() or p_send_at > app.now() + interval '60 days' then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  if (select count(*) from public.announcements where kitchen_id = p_kitchen and sent_at is null and cancelled_at is null) >= 20 then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  insert into public.announcements (kitchen_id, title, body, include_staff, send_at, created_by)
  values (p_kitchen, v_title, v_body, coalesce(p_include_staff, false), p_send_at, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.owner_cancel_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.announcements;
begin
  select * into a from public.announcements where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(a.kitchen_id);
  if a.sent_at is not null then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  update public.announcements set cancelled_at = app.now() where id = a.id and cancelled_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- Automatic delivery assignment: "Ravi always delivers to City Hospital".
-- ---------------------------------------------------------------------------
create table public.place_delivery_staff (
  place_id    uuid primary key,
  kitchen_id  uuid not null,
  staff_id    uuid not null,
  updated_at  timestamptz not null default app.now(),
  foreign key (place_id, kitchen_id) references public.places (id, kitchen_id),
  foreign key (staff_id, kitchen_id) references public.staff_members (id, kitchen_id)
);
alter table public.place_delivery_staff enable row level security;
grant select on public.place_delivery_staff to authenticated;
create policy read_owner on public.place_delivery_staff for select to authenticated using (app.is_owner(kitchen_id));
create trigger place_delivery_staff_audit after insert or update or delete on public.place_delivery_staff
  for each row execute function app.audit_row('true');

create or replace function public.owner_set_place_staff(p_place uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare pl public.places;
begin
  select * into pl from public.places where id = p_place;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(pl.kitchen_id);
  if p_staff is null then
    delete from public.place_delivery_staff where place_id = pl.id;
    return;
  end if;
  if not exists (select 1 from public.staff_members s where s.id = p_staff and s.kitchen_id = pl.kitchen_id
                 and s.active and s.role in ('delivery','kitchen_delivery')) then
    raise exception 'INVALID_STAFF' using errcode = 'P0001';
  end if;
  insert into public.place_delivery_staff (place_id, kitchen_id, staff_id) values (pl.id, pl.kitchen_id, p_staff)
  on conflict (place_id) do update set staff_id = excluded.staff_id, updated_at = app.now();
end $$;

-- Assign unassigned meals whose place has a default delivery person (never overrides a manual choice).
create or replace function app.auto_assign(p_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.orders o set assigned_staff_id = pds.staff_id
    from public.location_nodes n
    join public.place_delivery_staff pds on pds.place_id = n.place_id
    join public.staff_members s on s.id = pds.staff_id and s.active and s.role in ('delivery','kitchen_delivery')
   where o.location_node_id = n.id and o.order_date = p_date and o.status = 'scheduled' and o.assigned_staff_id is null;
  get diagnostics v = row_count;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Refer a friend (decision 22): request -> owner approves -> customer record.
-- ---------------------------------------------------------------------------
create table public.referral_requests (
  id                    uuid primary key default gen_random_uuid(),
  kitchen_id            uuid not null references public.kitchens(id),
  referrer_customer_id  uuid not null,
  friend_name           text not null check (char_length(friend_name) between 1 and 100),
  friend_phone          text not null check (friend_phone ~ '^[0-9+ \-]{7,20}$'),
  note                  text check (char_length(note) <= 300),
  status                text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_customer_id   uuid,
  decided_by            uuid references auth.users(id),
  decided_at            timestamptz,
  created_at            timestamptz not null default app.now(),
  foreign key (referrer_customer_id, kitchen_id) references public.customers (id, kitchen_id),
  foreign key (created_customer_id, kitchen_id) references public.customers (id, kitchen_id)
);
alter table public.referral_requests enable row level security;
grant select on public.referral_requests to authenticated;
create policy read_own on public.referral_requests for select to authenticated
  using (app.can_read_customer_row(kitchen_id, referrer_customer_id));

create or replace function public.customer_refer_friend(p_kitchen uuid, p_name text, p_phone text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.my_customer_id(p_kitchen); v_id uuid; v_name text := app.clean_text(p_name, 100);
        v_phone text := btrim(coalesce(p_phone, '')); c public.customers;
begin
  if v_me is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_name is null or v_phone !~ '^[0-9+ \-]{7,20}$' then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if not app.rate_limit_hit('refer_friend', 5, interval '1 day') then raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001'; end if;
  insert into public.referral_requests (kitchen_id, referrer_customer_id, friend_name, friend_phone, note)
  values (p_kitchen, v_me, v_name, v_phone, app.clean_text(p_note, 300)) returning id into v_id;
  select * into c from public.customers where id = v_me;
  perform app.notify_owners(p_kitchen, 'referral_request', c.full_name || ' referred ' || v_name,
    v_name || ' (' || v_phone || ') may want tiffins. Approve in More › Referrals.', jsonb_build_object('referral_id', v_id), 'ref:' || v_id);
  return v_id;
end $$;

create or replace function public.owner_decide_referral(p_id uuid, p_approve boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.referral_requests; v_customer uuid; ref public.customers;
begin
  select * into r from public.referral_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(r.kitchen_id);
  if r.status <> 'pending' then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if p_approve then
    insert into public.customers (kitchen_id, full_name, phone, food_notes)
    values (r.kitchen_id, r.friend_name, r.friend_phone, null) returning id into v_customer;
  end if;
  update public.referral_requests
     set status = case when p_approve then 'approved' else 'rejected' end, created_customer_id = v_customer,
         decided_by = auth.uid(), decided_at = app.now()
   where id = r.id;
  select * into ref from public.customers where id = r.referrer_customer_id;
  perform app.notify(r.kitchen_id, ref.user_id, 'referral_decision', 'Thank you for referring ' || r.friend_name,
    case when p_approve then 'We have added ' || r.friend_name || ' and will contact them soon.'
         else 'We will keep ' || r.friend_name || ' in mind.' end, '{}'::jsonb, 'refdec:' || r.id);
  return v_customer;
end $$;

-- ---------------------------------------------------------------------------
-- Chat: one thread per customer, customer <-> owner only.
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  kitchen_id   uuid not null,
  customer_id  uuid not null,
  sender_role  text not null check (sender_role in ('customer','owner')),
  sender_user  uuid references auth.users(id),
  body         text not null check (char_length(body) between 1 and 1000),
  created_at   timestamptz not null default app.now(),
  read_at      timestamptz,
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id)
);
create index chat_messages_thread on public.chat_messages (customer_id, created_at desc);
create trigger chat_messages_no_delete before delete on public.chat_messages
  for each row execute function app.forbid_mutation();
alter table public.chat_messages enable row level security;
grant select on public.chat_messages to authenticated;
create policy read_own on public.chat_messages for select to authenticated
  using (app.can_read_customer_row(kitchen_id, customer_id));

create or replace function public.customer_send_message(p_kitchen uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.my_customer_id(p_kitchen); v_body text := app.clean_text(replace(coalesce(p_body, ''), E'\n', ' '), 1000);
        v_id uuid; c public.customers;
begin
  if v_me is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_body is null then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if not app.rate_limit_hit('chat_send', 30, interval '1 hour') then raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001'; end if;
  insert into public.chat_messages (kitchen_id, customer_id, sender_role, sender_user, body)
  values (p_kitchen, v_me, 'customer', auth.uid(), v_body) returning id into v_id;
  select * into c from public.customers where id = v_me;
  perform app.notify_owners(p_kitchen, 'chat_message', 'Message from ' || c.full_name, left(v_body, 300),
    jsonb_build_object('customer_id', v_me), 'chat:' || v_id);
  return v_id;
end $$;

create or replace function public.owner_send_message(p_customer uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_body text := app.clean_text(replace(coalesce(p_body, ''), E'\n', ' '), 1000); v_id uuid;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  if v_body is null then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  insert into public.chat_messages (kitchen_id, customer_id, sender_role, sender_user, body)
  values (c.kitchen_id, c.id, 'owner', auth.uid(), v_body) returning id into v_id;
  perform app.notify(c.kitchen_id, c.user_id, 'chat_message', 'Message from the kitchen', left(v_body, 300), '{}'::jsonb, 'chat:' || v_id);
  return v_id;
end $$;

-- Mark the OTHER side's messages in a thread as read.
create or replace function public.chat_mark_read(p_customer uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v int;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if app.is_owner(c.kitchen_id) then
    update public.chat_messages set read_at = app.now() where customer_id = c.id and sender_role = 'customer' and read_at is null;
  elsif c.id = app.my_customer_id(c.kitchen_id) then
    update public.chat_messages set read_at = app.now() where customer_id = c.id and sender_role = 'owner' and read_at is null;
  else
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.owner_chat_threads(p_kitchen uuid)
returns table (customer_id uuid, full_name text, last_body text, last_at timestamptz, last_from text, unread int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  return query
  select c.id, c.full_name, m.body, m.created_at, m.sender_role,
         (select count(*)::int from public.chat_messages u where u.customer_id = c.id and u.sender_role = 'customer' and u.read_at is null)
  from public.customers c
  join lateral (select x.body, x.created_at, x.sender_role from public.chat_messages x
                where x.customer_id = c.id order by x.created_at desc limit 1) m on true
  where c.kitchen_id = p_kitchen
  order by 4 desc;
end $$;

-- ---------------------------------------------------------------------------
-- Jobs: scheduled announcements + auto-assignment (every 5 minutes).
-- ---------------------------------------------------------------------------
create or replace function app.run_engagement_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  for a in
    select * from public.announcements where sent_at is null and cancelled_at is null and send_at <= app.now()
    order by send_at for update skip locked
  loop
    update public.announcements set sent_at = app.now(), sent_count = app.announce(a.kitchen_id, a.title, a.body, a.include_staff)
     where id = a.id;
  end loop;
  perform app.auto_assign(app.today());
  perform app.auto_assign(app.today() + 1);
end $$;

grant execute on function
  public.owner_schedule_announcement(uuid, text, text, boolean, timestamptz), public.owner_cancel_announcement(uuid),
  public.owner_set_place_staff(uuid, uuid), public.customer_refer_friend(uuid, text, text, text),
  public.owner_decide_referral(uuid, boolean), public.customer_send_message(uuid, text), public.owner_send_message(uuid, text),
  public.chat_mark_read(uuid), public.owner_chat_threads(uuid)
to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    perform cron.schedule('engagement-jobs', '*/5 * * * *', 'select app.run_engagement_jobs()');
  end if;
end $$;
