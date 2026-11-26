-- =============================================================================
-- 2200 JOIN REQUESTS + STORE REVIEW DEMO (Phase 8b)
--   - "Request to join" (decision 12, F15): when signup_mode is request_to_join,
--     a signed-in person without an invite asks to join; the owner approves.
--     In "open" mode the request is approved at once.
--   - Store review (F43): a separate demo kitchen with sample data and one
--     reviewer account, created and ended by the database owner only.
-- Tests: 27-join-review.test.mjs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Join requests
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'meal_delivered','late_skip','closure','closure_cancelled','location_reminder','location_changed',
  'route_ready','payment_submitted','payment_confirmed','payment_rejected','bill_ready',
  'daily_summary','announcement','due_reminder','late_fee','low_balance','chat_message','referral_request','referral_decision',
  'expense_due','loyalty_reward','new_sign_in','join_request','join_decision'));

create or replace function app.mutable_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['location_reminder','meal_delivered','route_ready','location_changed','late_skip','daily_summary',
               'payment_submitted','low_balance','chat_message','referral_request','expense_due','loyalty_reward','join_request']
$$;

create table public.join_requests (
  id                   uuid primary key default gen_random_uuid(),
  kitchen_id           uuid not null references public.kitchens(id),
  user_id              uuid not null references auth.users(id),
  full_name            text not null check (char_length(btrim(full_name)) between 1 and 100),
  phone                text not null check (phone ~ '^[0-9+ \-]{7,20}$'),
  location_text        text check (char_length(location_text) <= 120),
  note                 text check (char_length(note) <= 300),
  status               text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_customer_id  uuid,
  decided_by           uuid references auth.users(id),
  decided_at           timestamptz,
  created_at           timestamptz not null default app.now(),
  foreign key (created_customer_id, kitchen_id) references public.customers (id, kitchen_id)
);
create unique index join_requests_one_pending on public.join_requests (kitchen_id, user_id) where status = 'pending';
create index join_requests_kitchen on public.join_requests (kitchen_id, status, created_at desc);
alter table public.join_requests enable row level security;
grant select on public.join_requests to authenticated;
create policy read_own on public.join_requests for select to authenticated
  using (user_id = auth.uid() or kitchen_id = any (array(select app.my_owned_kitchens())));
create trigger join_requests_audit after insert or update on public.join_requests
  for each row execute function app.audit_row('true', 'full_name', 'phone', 'location_text', 'note');

-- What a not-yet-linked person may know about a kitchen: its name and whether it takes requests.
create or replace function public.kitchen_join_info(p_kitchen uuid)
returns table (name text, signup_mode text, my_request_status text)
language sql stable security definer set search_path = '' as $$
  select coalesce(b.display_name, k.name), b.signup_mode,
         (select j.status from public.join_requests j where j.kitchen_id = p_kitchen and j.user_id = auth.uid()
           order by j.created_at desc limit 1)
  from public.kitchens k join public.business_settings b on b.kitchen_id = k.id
  where k.id = p_kitchen and auth.uid() is not null
$$;

create or replace function app.approve_join(p_request uuid, p_by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.join_requests; v_customer uuid;
begin
  select * into r from public.join_requests where id = p_request for update;
  insert into public.customers (kitchen_id, full_name, phone, default_location_text, user_id)
  values (r.kitchen_id, r.full_name, r.phone, r.location_text, r.user_id) returning id into v_customer;
  update public.join_requests set status = 'approved', created_customer_id = v_customer, decided_by = p_by, decided_at = app.now()
   where id = r.id;
  perform app.notify(r.kitchen_id, r.user_id, 'join_decision', 'Welcome to ' || coalesce(
      (select display_name from public.business_settings where kitchen_id = r.kitchen_id), 'the kitchen'),
    'You can now choose your meals in the app.', '{}'::jsonb, 'joindec:' || r.id);
  return v_customer;
end $$;

create or replace function public.customer_request_to_join(p_kitchen uuid, p_full_name text, p_phone text, p_location_text text, p_note text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.business_settings; v_id uuid; v_name text := app.clean_text(p_full_name, 100); v_phone text := btrim(coalesce(p_phone, ''));
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into s from public.business_settings where kitchen_id = p_kitchen;
  if not found or s.signup_mode = 'invite_only' then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if exists (select 1 from public.customers c where c.kitchen_id = p_kitchen and c.user_id = auth.uid())
     or exists (select 1 from public.staff_members m where m.kitchen_id = p_kitchen and m.user_id = auth.uid()) then
    raise exception 'ALREADY_LINKED' using errcode = 'P0001';
  end if;
  if v_name is null or v_phone !~ '^[0-9+ \-]{7,20}$' then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if exists (select 1 from public.join_requests j where j.kitchen_id = p_kitchen and j.user_id = auth.uid() and j.status = 'pending') then
    return jsonb_build_object('status', 'pending');                                   -- already asked; nothing new
  end if;
  if not app.rate_limit_hit('join_request', 3, interval '1 day') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  insert into public.join_requests (kitchen_id, user_id, full_name, phone, location_text, note)
  values (p_kitchen, auth.uid(), v_name, v_phone, app.clean_text(p_location_text, 120), app.clean_text(p_note, 300))
  returning id into v_id;
  if s.signup_mode = 'open' then
    perform app.approve_join(v_id, null);
    return jsonb_build_object('status', 'approved');
  end if;
  perform app.notify_owners(p_kitchen, 'join_request', 'New request to join',
    v_name || ' asked to join. Open More › Join requests to approve.', jsonb_build_object('join_request_id', v_id), 'join:' || v_id);
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.owner_decide_join(p_id uuid, p_approve boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.join_requests;
begin
  select * into r from public.join_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(r.kitchen_id);
  if r.status <> 'pending' then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if exists (select 1 from public.customers c where c.kitchen_id = r.kitchen_id and c.user_id = r.user_id) then
    raise exception 'ALREADY_LINKED' using errcode = 'P0001';
  end if;
  if p_approve then return app.approve_join(r.id, auth.uid()); end if;
  update public.join_requests set status = 'rejected', decided_by = auth.uid(), decided_at = app.now() where id = r.id;
  perform app.notify(r.kitchen_id, r.user_id, 'join_decision', 'About your request to join',
    'The kitchen cannot take new customers right now. Please contact them for details.', '{}'::jsonb, 'joindec:' || r.id);
  return null;
end $$;

revoke execute on function public.kitchen_join_info(uuid), public.customer_request_to_join(uuid, text, text, text, text),
  public.owner_decide_join(uuid, boolean) from public, anon;
grant execute on function public.kitchen_join_info(uuid), public.customer_request_to_join(uuid, text, text, text, text),
  public.owner_decide_join(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Store review demo (F43). Database owner only (SQL editor); never callable
--    through the API. It acts AS the demo owner and AS the reviewer through the
--    normal functions, so the demo data passes every real check.
-- ---------------------------------------------------------------------------
create or replace function app.act_as(p_user uuid, p_mfa boolean) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_mfa then 'aal2' else 'aal1' end,
    'amr', case when p_mfa then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from app.now())::bigint))
                else jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from app.now())::bigint)) end)::text, true);
end $$;

create or replace function app.create_review_demo(p_reviewer_email text, p_demo_owner_email text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_reviewer uuid; v_owner uuid; k uuid; v_place uuid; v_node uuid; v_cust uuid; v_code text; r jsonb;
  v_roti uuid; v_dal uuid; v_salad uuid; v_veg uuid;
begin
  select id into v_reviewer from auth.users where lower(email) = lower(p_reviewer_email);
  select id into v_owner from auth.users where lower(email) = lower(p_demo_owner_email);
  if v_reviewer is null or v_owner is null then
    raise exception 'Create both users first (Authentication > Users): % and %', p_reviewer_email, p_demo_owner_email;
  end if;
  if v_reviewer = v_owner then raise exception 'Use two different emails'; end if;
  if exists (select 1 from public.staff_members where user_id = v_reviewer) or exists (select 1 from public.customers where user_id = v_reviewer) then
    raise exception 'The reviewer email must be a fresh account that belongs to no kitchen';
  end if;
  if exists (select 1 from public.staff_members where user_id = v_owner) then
    raise exception 'The demo owner email must not own or work in another kitchen';
  end if;

  k := app.bootstrap_kitchen('Demo Kitchen (store review)', v_owner, 'Demo owner');

  -- as the demo owner (with a fresh authenticator check), through the normal owner functions
  perform app.act_as(v_owner, true);
  insert into public.places (kitchen_id, name, kind) values (k, 'Demo Hospital', 'hospital') returning id into v_place;
  insert into public.location_nodes (kitchen_id, place_id, name, kind, directions)
    values (k, v_place, 'Ward 1', 'ward', 'Ground floor, near the lift') returning id into v_node;
  insert into public.items (kitchen_id, name, category, customer_orderable, max_qty_per_order) values (k, 'Roti', 'main', false, 10) returning id into v_roti;
  insert into public.items (kitchen_id, name, category, customer_orderable, max_qty_per_order) values (k, 'Dal', 'main', false, 2) returning id into v_dal;
  insert into public.items (kitchen_id, name, category, customer_orderable, max_qty_per_order) values (k, 'Salad', 'addon', true, 2) returning id into v_salad;
  perform public.owner_set_item_price(v_roti, 800, app.today());
  perform public.owner_set_item_price(v_dal, 2000, app.today());
  perform public.owner_set_item_price(v_salad, 1500, app.today());
  insert into public.tiffin_types (kitchen_id, name, is_veg, pricing_mode) values (k, 'Veg Thali', true, 'fixed') returning id into v_veg;
  perform public.owner_set_tiffin_items(v_veg, jsonb_build_array(jsonb_build_object('item_id', v_roti, 'qty', 4), jsonb_build_object('item_id', v_dal, 'qty', 1)));
  perform public.owner_set_tiffin_price(v_veg, 8000, app.today());
  insert into public.customers (kitchen_id, full_name, default_location_node_id, food_notes)
    values (k, 'App Reviewer', v_node, 'Demo account for store review') returning id into v_cust;
  v_code := public.owner_create_customer_invite(v_cust, 7);

  -- as the reviewer: redeem the invite and accept the kitchen rules
  perform app.act_as(v_reviewer, false);
  r := to_jsonb(public.redeem_invite(v_code, 'customer'));
  if coalesce(r ->> 'ok', 'false') <> 'true' then raise exception 'Could not link the reviewer: %', r; end if;
  perform public.customer_accept_terms(k);

  -- back to the owner: a lunch plan, so there are meals to look at
  perform app.act_as(v_owner, true);
  perform public.owner_save_subscription(null, v_cust, 'lunch', v_veg, app.today(), null, null, null, null, null, null, null);
  perform set_config('request.jwt.claims', '', true);
  return k;
end $$;

-- After approval: the reviewer can no longer see anything (the user can then be deleted).
create or replace function app.end_review_demo(p_reviewer_email text) returns int
language plpgsql set search_path = '' as $$
declare v_user uuid; v int;
begin
  select id into v_user from auth.users where lower(email) = lower(p_reviewer_email);
  if v_user is null then return 0; end if;
  delete from public.devices where user_id = v_user;
  update public.customers set status = 'archived', user_id = null
   where user_id = v_user and kitchen_id in (select id from public.kitchens where name = 'Demo Kitchen (store review)');
  get diagnostics v = row_count;
  return v;
end $$;
revoke execute on function app.act_as(uuid, boolean), app.create_review_demo(text, text), app.end_review_demo(text),
  app.approve_join(uuid, uuid) from public, anon, authenticated;
