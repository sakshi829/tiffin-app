-- =============================================================================
-- 0600 CUSTOMER FUNCTIONS (+ invite redemption, devices)
-- The ONLY ways a customer can change data. Every function:
--   * derives identity from auth.uid() (client-sent ids are only *targets*
--     and are verified to belong to the caller -> no IDOR/BOLA);
--   * checks cutoffs against the server clock;
--   * validates every input; never accepts prices.
-- "Not yours" and "does not exist" return the same NOT_FOUND error.
-- =============================================================================

-- Lock an order that belongs to the caller (as customer).
create or replace function app.lock_my_order(p_order uuid) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_status text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.customer_id is distinct from app.my_customer_id(o.kitchen_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select status into v_status from public.customers where id = o.customer_id;
  if v_status not in ('active','paused') then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  return o;
end $$;

create or replace function app.clean_text(p text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p), '');
begin
  if v is null then return null; end if;
  if char_length(v) > p_max then raise exception 'TEXT_TOO_LONG' using errcode = 'P0001'; end if;
  if v ~ '[[:cntrl:]]' then raise exception 'INVALID_TEXT' using errcode = 'P0001'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Today's location
-- ---------------------------------------------------------------------------
create or replace function public.customer_set_location(p_order uuid, p_location_node uuid, p_location_text text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  v_text text := app.clean_text(p_location_text, 120);
  v_cutoff timestamptz;
begin
  o := app.lock_my_order(p_order);
  if o.status <> 'scheduled' then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select t.location_cutoff_at into v_cutoff from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t;
  if app.now() >= v_cutoff then raise exception 'CUTOFF_PASSED' using errcode = 'P0001'; end if;
  if p_location_node is null and v_text is null then raise exception 'LOCATION_REQUIRED' using errcode = 'P0001'; end if;
  if p_location_node is not null and not exists (
       select 1 from public.location_nodes n where n.id = p_location_node and n.kitchen_id = o.kitchen_id and n.active) then
    raise exception 'INVALID_LOCATION' using errcode = 'P0001';
  end if;

  update public.orders
     set location_node_id = p_location_node, location_text = v_text, location_updated_at = app.now()
   where id = o.id;

  insert into public.customer_saved_locations (kitchen_id, customer_id, location_node_id, location_text, last_used_at)
  values (o.kitchen_id, o.customer_id, p_location_node, v_text, app.now())
  on conflict (customer_id, coalesce(location_node_id::text, ''), coalesce(location_text, ''))
  do update set last_used_at = excluded.last_used_at;

  return jsonb_build_object('order_id', o.id, 'location_node_id', p_location_node,
                            'location_text', v_text, 'location_updated_at', app.now());
end $$;

-- ---------------------------------------------------------------------------
-- Skip / un-skip one meal
-- ---------------------------------------------------------------------------
create or replace function public.customer_skip_meal(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; t record; v_new text;
begin
  o := app.lock_my_order(p_order);
  if o.status in ('skipped','skipped_late') then
    return jsonb_build_object('order_id', o.id, 'status', o.status, 'charged', o.late_skip_charged);
  end if;
  if o.status <> 'scheduled' then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select * into t from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot);
  if app.now() >= t.delivery_at then raise exception 'TOO_LATE' using errcode = 'P0001'; end if;

  v_new := case when app.now() < t.addon_cutoff_at then 'skipped' else 'skipped_late' end;
  update public.orders set status = v_new, skipped_at = app.now() where id = o.id;
  if v_new = 'skipped_late' then perform app.charge_late_skip(o.id); end if;

  select * into o from public.orders where id = o.id;
  return jsonb_build_object('order_id', o.id, 'status', o.status, 'charged', o.late_skip_charged);
end $$;

create or replace function public.customer_unskip_meal(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_cutoff timestamptz; v_cstatus text;
begin
  o := app.lock_my_order(p_order);
  if o.status = 'scheduled' then return jsonb_build_object('order_id', o.id, 'status', o.status); end if;
  if o.status <> 'skipped' then raise exception 'CANNOT_UNSKIP' using errcode = 'P0001'; end if;
  select status into v_cstatus from public.customers where id = o.customer_id;
  if v_cstatus <> 'active' then raise exception 'ACCOUNT_PAUSED' using errcode = 'P0001'; end if;
  select t.addon_cutoff_at into v_cutoff from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t;
  if app.now() >= v_cutoff then raise exception 'CUTOFF_PASSED' using errcode = 'P0001'; end if;
  if app.closure_covers(o.kitchen_id, o.order_date, o.meal_slot) then raise exception 'KITCHEN_CLOSED' using errcode = 'P0001'; end if;
  update public.orders set status = 'scheduled', skipped_at = null where id = o.id;
  return jsonb_build_object('order_id', o.id, 'status', 'scheduled');
end $$;

-- ---------------------------------------------------------------------------
-- Leave / vacation range
-- ---------------------------------------------------------------------------
create or replace function public.customer_skip_range(p_kitchen uuid, p_from date, p_to date, p_meal_slot text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := app.my_customer_id(p_kitchen); v_skip uuid; v_count int;
begin
  if v_customer is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_from is null or p_to is null or p_from < app.today() or p_to < p_from or p_to - p_from > 92 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  if p_meal_slot is not null and p_meal_slot not in ('lunch','dinner') then
    raise exception 'INVALID_SLOT' using errcode = 'P0001';
  end if;

  insert into public.customer_skips (kitchen_id, customer_id, from_date, to_date, meal_slot, created_by_role)
  values (p_kitchen, v_customer, p_from, p_to, p_meal_slot, 'customer') returning id into v_skip;

  -- Only orders still before their cutoff are skipped here (late ones must be skipped individually).
  with upd as (
    update public.orders o set status = 'skipped', skipped_at = app.now()
    where o.customer_id = v_customer and o.status = 'scheduled'
      and o.order_date between p_from and p_to
      and (p_meal_slot is null or o.meal_slot = p_meal_slot)
      and app.now() < (select t.addon_cutoff_at from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t)
    returning 1)
  select count(*) into v_count from upd;

  return jsonb_build_object('skip_id', v_skip, 'orders_skipped', v_count);
end $$;

create or replace function public.customer_cancel_skip_range(p_skip uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.customer_skips; v_count int; v_cstatus text;
begin
  select * into s from public.customer_skips where id = p_skip for update;
  if not found or s.customer_id is distinct from app.my_customer_id(s.kitchen_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if s.cancelled_at is not null then return jsonb_build_object('skip_id', s.id, 'orders_restored', 0); end if;
  update public.customer_skips set cancelled_at = app.now() where id = s.id;

  select status into v_cstatus from public.customers where id = s.customer_id;
  if v_cstatus <> 'active' then return jsonb_build_object('skip_id', s.id, 'orders_restored', 0); end if;

  with upd as (
    update public.orders o set status = 'scheduled', skipped_at = null
    where o.customer_id = s.customer_id and o.status = 'skipped'
      and o.order_date between greatest(s.from_date, app.today()) and s.to_date
      and (s.meal_slot is null or o.meal_slot = s.meal_slot)
      and not app.skip_covers(o.customer_id, o.order_date, o.meal_slot)
      and not app.closure_covers(o.kitchen_id, o.order_date, o.meal_slot)
      and app.now() < (select t.addon_cutoff_at from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t)
    returning 1)
  select count(*) into v_count from upd;
  return jsonb_build_object('skip_id', s.id, 'orders_restored', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- Extras (decision 7: auto-accepted before the cutoff)
-- ---------------------------------------------------------------------------
create or replace function public.customer_request_addon(p_order uuid, p_item uuid, p_qty int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; i public.items; v_cutoff timestamptz; v_price bigint; v_addon uuid;
begin
  o := app.lock_my_order(p_order);
  if o.status <> 'scheduled' then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select t.addon_cutoff_at into v_cutoff from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t;
  if app.now() >= v_cutoff then raise exception 'CUTOFF_PASSED' using errcode = 'P0001'; end if;

  select * into i from public.items where id = p_item and kitchen_id = o.kitchen_id;
  if not found or not i.active or not i.customer_orderable then
    raise exception 'ITEM_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > i.max_qty_per_order then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;

  v_price := app.item_price(o.kitchen_id, o.customer_id, i.id, o.order_date);

  update public.order_addons set qty = p_qty, unit_price_paise = v_price
   where order_id = o.id and item_id = i.id and status = 'accepted'
  returning id into v_addon;
  if v_addon is null then
    insert into public.order_addons (kitchen_id, order_id, item_id, qty, unit_price_paise, requested_by_role, status)
    values (o.kitchen_id, o.id, i.id, p_qty, v_price, 'customer', 'accepted')
    returning id into v_addon;
  end if;
  return jsonb_build_object('addon_id', v_addon, 'order_id', o.id, 'item_id', i.id, 'qty', p_qty,
                            'unit_price_paise', v_price, 'status', 'accepted');
end $$;

create or replace function public.customer_cancel_addon(p_addon uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.order_addons; o public.orders; v_cutoff timestamptz;
begin
  select * into a from public.order_addons where id = p_addon;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  o := app.lock_my_order(a.order_id);   -- ownership check
  if a.status <> 'accepted' then return jsonb_build_object('addon_id', a.id, 'status', a.status); end if;
  if o.status <> 'scheduled' then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select t.addon_cutoff_at into v_cutoff from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t;
  if app.now() >= v_cutoff then raise exception 'CUTOFF_PASSED' using errcode = 'P0001'; end if;
  update public.order_addons set status = 'cancelled' where id = a.id;
  return jsonb_build_object('addon_id', a.id, 'status', 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- Box: "I kept my box at ..."
-- ---------------------------------------------------------------------------
create or replace function public.customer_mark_box_kept(p_order uuid, p_location_text text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_text text := app.clean_text(p_location_text, 120); v_id uuid;
begin
  o := app.lock_my_order(p_order);
  if o.status <> 'delivered' or o.order_date < app.today() - 3 then
    raise exception 'ORDER_NOT_DELIVERED' using errcode = 'P0001';
  end if;
  if v_text is null then raise exception 'LOCATION_REQUIRED' using errcode = 'P0001'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.box_movements where kitchen_id = o.kitchen_id and idempotency_key = p_idempotency_key;
    if v_id is not null then return jsonb_build_object('movement_id', v_id); end if;
  end if;
  insert into public.box_movements (kitchen_id, customer_id, order_id, kind, location_text, actor_user_id, actor_role, idempotency_key)
  values (o.kitchen_id, o.customer_id, o.id, 'kept_at', v_text, auth.uid(), 'customer', p_idempotency_key)
  returning id into v_id;
  return jsonb_build_object('movement_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Payment submission (UPI + UTR; owner confirms)
-- ---------------------------------------------------------------------------
create or replace function public.customer_submit_payment(
  p_kitchen uuid, p_amount_paise bigint, p_utr text, p_paid_on date, p_idempotency_key text, p_note text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := app.my_customer_id(p_kitchen);
  v_utr text := upper(btrim(coalesce(p_utr, '')));
  p public.payments;
begin
  if v_customer is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  select * into p from public.payments where kitchen_id = p_kitchen and idempotency_key = p_idempotency_key;
  if found then
    if p.customer_id <> v_customer then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
    return jsonb_build_object('payment_id', p.id, 'status', p.status);
  end if;
  if not app.rate_limit_hit('submit_payment', 10, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  if p_amount_paise is null or p_amount_paise < 100 or p_amount_paise > 100000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;
  if v_utr !~ '^[A-Z0-9]{6,30}$' then raise exception 'INVALID_UTR' using errcode = 'P0001'; end if;
  if p_paid_on is null or p_paid_on > app.today() or p_paid_on < app.today() - 60 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments x where x.kitchen_id = p_kitchen and upper(x.utr) = v_utr and x.status <> 'rejected') then
    raise exception 'UTR_ALREADY_USED' using errcode = 'P0001';
  end if;

  insert into public.payments (kitchen_id, customer_id, amount_paise, method, utr, paid_on, status,
                               submitted_by_role, idempotency_key, note, created_by)
  values (p_kitchen, v_customer, p_amount_paise, 'upi', v_utr, p_paid_on, 'submitted',
          'customer', p_idempotency_key, app.clean_text(p_note, 300), auth.uid())
  returning * into p;
  return jsonb_build_object('payment_id', p.id, 'status', p.status);
end $$;

-- ---------------------------------------------------------------------------
-- Misc
-- ---------------------------------------------------------------------------
create or replace function public.customer_accept_terms(p_kitchen uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := app.my_customer_id(p_kitchen);
begin
  if v_customer is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.customers set terms_accepted_at = app.now() where id = v_customer and terms_accepted_at is null;
end $$;

create or replace function public.my_balance(p_kitchen uuid) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v_customer uuid := app.my_customer_id(p_kitchen);
begin
  if v_customer is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return app.customer_balance(v_customer);
end $$;

-- ---------------------------------------------------------------------------
-- Invite redemption (customers and staff)
-- Failures return {ok:false} instead of raising, so the failure counter is
-- committed (a raised error would roll it back and defeat the lockout).
-- ---------------------------------------------------------------------------
create or replace function public.redeem_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  i public.invites;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if app.rate_limited('redeem_invite_fail', 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  if char_length(v_norm) = 10 then
    select * into i from public.invites
    where code_hash = encode(extensions.digest(v_norm, 'sha256'), 'hex') for update;
  end if;
  if i.id is null or i.used_at is not null or i.revoked_at is not null or i.expires_at <= app.now() then
    perform app.rate_limit_hit('redeem_invite_fail', 5, interval '1 hour');
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');   -- same answer for every failure
  end if;

  if i.kind = 'customer' then
    if exists (select 1 from public.customers c where c.kitchen_id = i.kitchen_id and c.user_id = auth.uid()) then
      return jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED');
    end if;
    update public.customers set user_id = auth.uid()
     where id = i.customer_id and user_id is null and status <> 'archived';
    if not found then
      perform app.rate_limit_hit('redeem_invite_fail', 5, interval '1 hour');
      return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
    end if;
  else
    if exists (select 1 from public.staff_members s where s.kitchen_id = i.kitchen_id and s.user_id = auth.uid()) then
      return jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED');
    end if;
    insert into public.staff_members (kitchen_id, user_id, display_name, role)
    values (i.kitchen_id, auth.uid(), i.staff_display_name, i.staff_role);
  end if;

  update public.invites set used_at = app.now(), used_by = auth.uid() where id = i.id;
  return jsonb_build_object('ok', true, 'kind', i.kind, 'kitchen_id', i.kitchen_id);
end $$;

-- ---------------------------------------------------------------------------
-- Push devices (own only)
-- ---------------------------------------------------------------------------
create or replace function public.register_device(p_platform text, p_expo_push_token text, p_web_push jsonb, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_platform not in ('android','ios','web') then raise exception 'INVALID_PLATFORM' using errcode = 'P0001'; end if;
  if p_web_push is not null and (jsonb_typeof(p_web_push) <> 'object' or char_length(p_web_push::text) > 2000) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if not app.rate_limit_hit('register_device', 20, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  -- A token moves with the physical device: remove it from any previous owner.
  if p_expo_push_token is not null then
    delete from public.devices where expo_push_token = p_expo_push_token and user_id <> auth.uid();
    select id into v_id from public.devices where expo_push_token = p_expo_push_token;
  end if;
  if v_id is not null then
    update public.devices set last_seen_at = app.now(), device_label = app.clean_text(p_label, 100) where id = v_id;
  else
    insert into public.devices (user_id, platform, expo_push_token, web_push, device_label)
    values (auth.uid(), p_platform, p_expo_push_token, p_web_push, app.clean_text(p_label, 100))
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.unregister_device(p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.devices where id = p_device and user_id = auth.uid();
end $$;
