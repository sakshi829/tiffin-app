-- =============================================================================
-- 0800 OWNER FUNCTIONS
-- Every function checks app.require_owner() (owner + MFA/aal2).
-- Dangerous actions additionally require app.require_step_up()
-- (authenticator code verified within the last 10 minutes):
--   prices, price overrides, staff invites/changes, unlinking a customer,
--   waivers/discounts/adjustments, settings.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Invite codes: 10 chars from a 31-char alphabet (no 0/O/1/I/L), unbiased.
-- ---------------------------------------------------------------------------
create or replace function app.new_invite_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea; v text := ''; i int; x int;
begin
  while char_length(v) < 10 loop
    b := extensions.gen_random_bytes(16);
    for i in 0 .. 15 loop
      x := get_byte(b, i);
      if x < 248 and char_length(v) < 10 then           -- 248 = 8 * 31 -> no modulo bias
        v := v || substr(alphabet, (x % 31) + 1, 1);
      end if;
    end loop;
  end loop;
  return v;
end $$;

create or replace function app.store_invite(
  p_kitchen uuid, p_kind text, p_customer uuid, p_role text, p_name text, p_valid_days int)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text := app.new_invite_code();
begin
  if p_valid_days is null or p_valid_days not between 1 and 30 then
    raise exception 'INVALID_VALIDITY' using errcode = 'P0001';
  end if;
  insert into public.invites (kitchen_id, kind, customer_id, staff_role, staff_display_name, code_hash, expires_at, created_by)
  values (p_kitchen, p_kind, p_customer, p_role, p_name,
          encode(extensions.digest(v_code, 'sha256'), 'hex'),
          app.now() + make_interval(days => p_valid_days), auth.uid());
  return substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);   -- shown ONCE, never stored
end $$;

create or replace function public.owner_create_customer_invite(p_customer uuid, p_valid_days int default 7) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  if c.user_id is not null then raise exception 'ALREADY_LINKED' using errcode = 'P0001'; end if;
  if c.status = 'archived' then raise exception 'CUSTOMER_ARCHIVED' using errcode = 'P0001'; end if;
  -- only one live invite per customer
  update public.invites set revoked_at = app.now()
   where customer_id = c.id and used_at is null and revoked_at is null;
  return app.store_invite(c.kitchen_id, 'customer', c.id, null, null, p_valid_days);
end $$;

create or replace function public.owner_create_staff_invite(
  p_kitchen uuid, p_role text, p_display_name text, p_valid_days int default 3) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_step_up(p_kitchen);
  if p_role not in ('kitchen','delivery','kitchen_delivery') then raise exception 'INVALID_ROLE' using errcode = 'P0001'; end if;
  return app.store_invite(p_kitchen, 'staff', null, p_role, app.clean_text(p_display_name, 100), p_valid_days);
end $$;

create or replace function public.owner_revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invites;
begin
  select * into i from public.invites where id = p_invite;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(i.kitchen_id);
  update public.invites set revoked_at = app.now() where id = i.id and used_at is null and revoked_at is null;
end $$;

-- Detach a customer from their login (lost phone / wrong person). Step-up.
create or replace function public.owner_unlink_customer(p_customer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(c.kitchen_id);
  update public.customers set user_id = null where id = c.id;
end $$;

-- Change a staff member (never an owner row). Step-up.
create or replace function public.owner_set_staff(p_staff uuid, p_role text, p_can_see_phone boolean, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.staff_members;
begin
  select * into s from public.staff_members where id = p_staff for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(s.kitchen_id);
  if s.role = 'owner' then raise exception 'CANNOT_CHANGE_OWNER' using errcode = 'P0001'; end if;
  if p_role not in ('kitchen','delivery','kitchen_delivery') then raise exception 'INVALID_ROLE' using errcode = 'P0001'; end if;
  update public.staff_members
     set role = p_role, can_see_phone = coalesce(p_can_see_phone, false), active = coalesce(p_active, true)
   where id = s.id;
  if not coalesce(p_active, true) then
    -- unassign their future work
    update public.orders set assigned_staff_id = null
     where assigned_staff_id = s.id and order_date >= app.today() and status = 'scheduled';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Prices (step-up). New prices apply to every order not yet past its cutoff.
-- ---------------------------------------------------------------------------
create or replace function app.reprice_orders(p_kitchen uuid, p_from date, p_customer uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.orders o
     set unit_price_paise = app.tiffin_price(o.kitchen_id, o.customer_id, o.tiffin_type_id, o.order_date)
   where o.kitchen_id = p_kitchen
     and o.order_date >= greatest(p_from, app.today())
     and o.status in ('scheduled','skipped')
     and (p_customer is null or o.customer_id = p_customer)
     and app.now() < (select t.addon_cutoff_at from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t)
     and o.unit_price_paise <> app.tiffin_price(o.kitchen_id, o.customer_id, o.tiffin_type_id, o.order_date);

  update public.order_addons a
     set unit_price_paise = app.item_price(o.kitchen_id, o.customer_id, a.item_id, o.order_date)
    from public.orders o
   where a.order_id = o.id and a.status = 'accepted'
     and o.kitchen_id = p_kitchen
     and o.order_date >= greatest(p_from, app.today())
     and o.status in ('scheduled','skipped')
     and (p_customer is null or o.customer_id = p_customer)
     and app.now() < (select t.addon_cutoff_at from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) t)
     and a.unit_price_paise <> app.item_price(o.kitchen_id, o.customer_id, a.item_id, o.order_date);
end $$;

create or replace function public.owner_set_item_price(p_item uuid, p_price_paise bigint, p_effective_from date) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.items;
begin
  select * into i from public.items where id = p_item;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(i.kitchen_id);
  if p_effective_from is null or p_effective_from < app.today() then raise exception 'PAST_DATE' using errcode = 'P0001'; end if;
  if p_price_paise is null or p_price_paise not between 0 and 1000000 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  insert into public.item_prices (kitchen_id, item_id, price_paise, effective_from, created_by)
  values (i.kitchen_id, i.id, p_price_paise, p_effective_from, auth.uid())
  on conflict (item_id, effective_from) do update set price_paise = excluded.price_paise, created_by = excluded.created_by;
  perform app.reprice_orders(i.kitchen_id, p_effective_from);
end $$;

create or replace function public.owner_set_tiffin_price(p_tiffin_type uuid, p_price_paise bigint, p_effective_from date) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tiffin_types;
begin
  select * into t from public.tiffin_types where id = p_tiffin_type;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(t.kitchen_id);
  if p_effective_from is null or p_effective_from < app.today() then raise exception 'PAST_DATE' using errcode = 'P0001'; end if;
  if p_price_paise is null or p_price_paise not between 0 and 1000000 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  insert into public.tiffin_type_prices (kitchen_id, tiffin_type_id, price_paise, effective_from, created_by)
  values (t.kitchen_id, t.id, p_price_paise, p_effective_from, auth.uid())
  on conflict (tiffin_type_id, effective_from) do update set price_paise = excluded.price_paise, created_by = excluded.created_by;
  perform app.reprice_orders(t.kitchen_id, p_effective_from);
end $$;

create or replace function public.owner_set_price_override(
  p_customer uuid, p_tiffin_type uuid, p_item uuid, p_price_paise bigint, p_effective_from date, p_effective_to date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_id uuid;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(c.kitchen_id);
  if p_effective_from is null or p_effective_from < app.today() then raise exception 'PAST_DATE' using errcode = 'P0001'; end if;
  insert into public.customer_price_overrides
    (kitchen_id, customer_id, tiffin_type_id, item_id, price_paise, effective_from, effective_to, created_by)
  values (c.kitchen_id, c.id, p_tiffin_type, p_item, p_price_paise, p_effective_from, p_effective_to, auth.uid())
  returning id into v_id;
  perform app.reprice_orders(c.kitchen_id, p_effective_from, c.id);
  return v_id;
end $$;

create or replace function public.owner_end_price_override(p_override uuid, p_last_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.customer_price_overrides;
begin
  select * into o from public.customer_price_overrides where id = p_override for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(o.kitchen_id);
  if p_last_day is null or p_last_day < app.today() - 1 or p_last_day < o.effective_from - 1 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  update public.customer_price_overrides set effective_to = p_last_day where id = o.id;
  perform app.reprice_orders(o.kitchen_id, p_last_day + 1, o.customer_id);
end $$;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------
create or replace function public.owner_save_subscription(
  p_id uuid, p_customer uuid, p_meal_slot text, p_tiffin_type uuid, p_start_date date, p_end_date date,
  p_days_of_week int[], p_location_node uuid, p_location_text text, p_status text, p_notes text,
  p_addons jsonb)   -- [{"item_id": "...", "qty": 1}, ...]
returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_id uuid := p_id; v_old public.subscriptions; e jsonb;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  if p_addons is not null and jsonb_typeof(p_addons) <> 'array' then raise exception 'INVALID_ADDONS' using errcode = 'P0001'; end if;

  if v_id is null then
    insert into public.subscriptions (kitchen_id, customer_id, meal_slot, tiffin_type_id, start_date, end_date, days_of_week,
                                      default_location_node_id, default_location_text, status, notes)
    values (c.kitchen_id, c.id, p_meal_slot, p_tiffin_type, p_start_date, p_end_date,
            coalesce(p_days_of_week, '{1,2,3,4,5,6,7}'), p_location_node, app.clean_text(p_location_text, 120),
            coalesce(p_status, 'active'), app.clean_text(p_notes, 300))
    returning id into v_id;
  else
    select * into v_old from public.subscriptions where id = v_id for update;
    if not found or v_old.customer_id <> c.id then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    update public.subscriptions
       set meal_slot = p_meal_slot, tiffin_type_id = p_tiffin_type, start_date = p_start_date, end_date = p_end_date,
           days_of_week = coalesce(p_days_of_week, '{1,2,3,4,5,6,7}'), default_location_node_id = p_location_node,
           default_location_text = app.clean_text(p_location_text, 120), status = coalesce(p_status, 'active'),
           notes = app.clean_text(p_notes, 300)
     where id = v_id;
  end if;

  if p_addons is not null then
    delete from public.subscription_addons where subscription_id = v_id;
    for e in select * from jsonb_array_elements(p_addons) loop
      insert into public.subscription_addons (kitchen_id, subscription_id, item_id, qty)
      values (c.kitchen_id, v_id, (e ->> 'item_id')::uuid, (e ->> 'qty')::int);
    end loop;
  end if;

  perform app.resync_subscription(v_id);
  return v_id;
end $$;

-- Pausing/stopping a customer removes their unlocked future orders;
-- re-activating regenerates them.
create or replace function app.customer_status_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  for s in select id from public.subscriptions where customer_id = new.id loop
    perform app.resync_subscription(s.id);
  end loop;
  return new;
end $$;
create trigger customers_status_resync after update of status on public.customers
  for each row when (old.status is distinct from new.status) execute function app.customer_status_changed();

-- Tiffin composition / pricing mode changes re-price unlocked orders.
create or replace function app.tiffin_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.reprice_orders(coalesce(new.kitchen_id, old.kitchen_id), app.today());
  return null;
end $$;
create trigger tiffin_types_reprice after update of pricing_mode on public.tiffin_types
  for each row when (old.pricing_mode is distinct from new.pricing_mode) execute function app.tiffin_changed();
create trigger tiffin_type_items_reprice after insert or update or delete on public.tiffin_type_items
  for each row execute function app.tiffin_changed();

-- ---------------------------------------------------------------------------
-- Days off (closures)
-- ---------------------------------------------------------------------------
create or replace function public.owner_add_closure(p_kitchen uuid, p_date date, p_meal_slot text, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; o record;
begin
  perform app.require_owner(p_kitchen);
  if p_date is null or p_date < app.today() then raise exception 'PAST_DATE' using errcode = 'P0001'; end if;
  if p_meal_slot is not null and p_meal_slot not in ('lunch','dinner') then raise exception 'INVALID_SLOT' using errcode = 'P0001'; end if;
  insert into public.closures (kitchen_id, closure_date, meal_slot, reason, created_by)
  values (p_kitchen, p_date, p_meal_slot, app.clean_text(p_reason, 200), auth.uid())
  returning id into v_id;

  for o in
    select id, status from public.orders
    where kitchen_id = p_kitchen and order_date = p_date and (p_meal_slot is null or meal_slot = p_meal_slot)
      and status in ('scheduled','skipped','skipped_late')
    for update
  loop
    if o.status = 'skipped_late' then perform app.reverse_order_charges(o.id, 'Kitchen closed'); end if;
    update public.orders set status = 'cancelled_closure' where id = o.id;
  end loop;
  return v_id;
end $$;

create or replace function public.owner_cancel_closure(p_closure uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cl public.closures;
begin
  select * into cl from public.closures where id = p_closure for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(cl.kitchen_id);
  if cl.cancelled_at is not null then return; end if;
  if cl.closure_date < app.today() then raise exception 'PAST_DATE' using errcode = 'P0001'; end if;
  update public.closures set cancelled_at = app.now() where id = cl.id;
  update public.orders o
     set status = case when app.skip_covers(o.customer_id, o.order_date, o.meal_slot) then 'skipped' else 'scheduled' end
   where o.kitchen_id = cl.kitchen_id and o.order_date = cl.closure_date
     and (cl.meal_slot is null or o.meal_slot = cl.meal_slot)
     and o.status = 'cancelled_closure'
     and not app.closure_covers(o.kitchen_id, o.order_date, o.meal_slot);
end $$;

create or replace function public.owner_generate_orders(p_kitchen uuid, p_from date, p_to date) returns int
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  return app.generate_orders(p_kitchen, p_from, p_to);
end $$;

-- ---------------------------------------------------------------------------
-- Order corrections. Any change of status first reverses previous charges,
-- then applies the charges of the new status -> the ledger always matches.
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_order_status(p_order uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_reason text := app.clean_text(p_reason, 200);
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(o.kitchen_id);
  if p_status not in ('scheduled','delivered','not_delivered','skipped','skipped_late') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if o.status = 'cancelled_closure' then raise exception 'KITCHEN_CLOSED' using errcode = 'P0001'; end if;
  if o.status = p_status then return jsonb_build_object('order_id', o.id, 'status', o.status); end if;
  if p_status = 'not_delivered' and v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;

  perform app.reverse_order_charges(o.id, coalesce(v_reason, format('Status corrected %s -> %s', o.status, p_status)));

  update public.orders set
    status               = p_status,
    delivered_at         = case when p_status = 'delivered' then coalesce(o.delivered_at, app.now()) end,
    delivered_by         = case when p_status = 'delivered' then auth.uid() end,
    not_delivered_reason = case when p_status = 'not_delivered' then v_reason end,
    skipped_at           = case when p_status in ('skipped','skipped_late') then app.now() end
  where id = o.id;

  if p_status = 'delivered' then perform app.charge_delivered(o.id);
  elsif p_status = 'skipped_late' then perform app.charge_late_skip(o.id);
  end if;
  return jsonb_build_object('order_id', o.id, 'status', p_status);
end $$;

create or replace function public.owner_assign_orders(p_kitchen uuid, p_orders uuid[], p_staff uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  perform app.require_owner(p_kitchen);
  if p_staff is not null and not exists (
       select 1 from public.staff_members s
       where s.id = p_staff and s.kitchen_id = p_kitchen and s.active and s.role in ('delivery','kitchen_delivery')) then
    raise exception 'INVALID_STAFF' using errcode = 'P0001';
  end if;
  update public.orders set assigned_staff_id = p_staff
   where kitchen_id = p_kitchen and id = any (p_orders) and order_date >= app.today();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Owner may add/change/remove an extra at any time before delivery (qty 0 = remove).
create or replace function public.owner_set_order_addon(p_order uuid, p_item uuid, p_qty int) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; i public.items;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(o.kitchen_id);
  if o.status not in ('scheduled','skipped') then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select * into i from public.items where id = p_item and kitchen_id = o.kitchen_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 20 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;

  if p_qty = 0 then
    update public.order_addons set status = 'cancelled' where order_id = o.id and item_id = i.id and status = 'accepted';
    return;
  end if;
  update public.order_addons
     set qty = p_qty, unit_price_paise = app.item_price(o.kitchen_id, o.customer_id, i.id, o.order_date)
   where order_id = o.id and item_id = i.id and status = 'accepted';
  if not found then
    insert into public.order_addons (kitchen_id, order_id, item_id, qty, unit_price_paise, requested_by_role, status)
    values (o.kitchen_id, o.id, i.id, p_qty, app.item_price(o.kitchen_id, o.customer_id, i.id, o.order_date), 'owner', 'accepted');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create or replace function public.owner_record_payment(
  p_customer uuid, p_amount_paise bigint, p_method text, p_utr text, p_paid_on date, p_note text, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.customers; p public.payments; v_utr text := nullif(upper(btrim(coalesce(p_utr, ''))), '');
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  select * into p from public.payments where kitchen_id = c.kitchen_id and idempotency_key = p_idempotency_key;
  if found then return p.id; end if;
  if p_paid_on is null or p_paid_on > app.today() then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;

  insert into public.payments (kitchen_id, customer_id, amount_paise, method, utr, paid_on, status, submitted_by_role,
                               idempotency_key, note, confirmed_by, confirmed_at, created_by)
  values (c.kitchen_id, c.id, p_amount_paise, p_method, v_utr, p_paid_on, 'confirmed', 'owner',
          p_idempotency_key, app.clean_text(p_note, 300), auth.uid(), app.now(), auth.uid())
  returning * into p;

  insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, payment_id, created_by)
  values (p.kitchen_id, p.customer_id, p.paid_on, 'payment', -p.amount_paise, p.id, auth.uid());
  return p.id;
end $$;

create or replace function public.owner_confirm_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(p.kitchen_id);
  if p.status = 'confirmed' then return; end if;
  if p.status <> 'submitted' then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  update public.payments set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = app.now() where id = p.id;
  insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, payment_id, created_by)
  values (p.kitchen_id, p.customer_id, p.paid_on, 'payment', -p.amount_paise, p.id, auth.uid());
end $$;

create or replace function public.owner_reject_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments; v_reason text := app.clean_text(p_reason, 200);
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(p.kitchen_id);
  if p.status <> 'submitted' then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  update public.payments set status = 'rejected', rejected_reason = v_reason where id = p.id;
end $$;

-- Waiver / discount (credit) or signed adjustment. Step-up. Note required.
create or replace function public.owner_add_ledger_entry(
  p_customer uuid, p_kind text, p_amount_paise bigint, p_note text, p_order uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_amount bigint; v_id uuid; v_note text := app.clean_text(p_note, 300);
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(c.kitchen_id);
  if v_note is null then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
  if p_amount_paise is null or p_amount_paise = 0 or abs(p_amount_paise) > 100000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;
  v_amount := case p_kind
    when 'waiver'     then -abs(p_amount_paise)
    when 'discount'   then -abs(p_amount_paise)
    when 'adjustment' then p_amount_paise
    else null end;
  if v_amount is null then raise exception 'INVALID_KIND' using errcode = 'P0001'; end if;
  if p_order is not null and not exists (select 1 from public.orders where id = p_order and customer_id = c.id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, note, created_by)
  values (c.kitchen_id, c.id, app.today(), p_kind, v_amount, p_order, v_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Bills (statements over the immutable ledger)
-- ---------------------------------------------------------------------------
create or replace function public.owner_generate_bill(p_customer uuid, p_period_start date, p_period_end date, p_due_days int)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.customers; v_open bigint; v_charges bigint; v_credits bigint; v_seq int; v_id uuid; v_due int;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start
     or p_period_end - p_period_start > 92 or p_period_end > app.today() then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  select coalesce(p_due_days, b.late_fee_grace_days) into v_due from public.business_settings b where b.kitchen_id = c.kitchen_id;
  if v_due not between 0 and 90 then raise exception 'INVALID_DUE_DAYS' using errcode = 'P0001'; end if;

  select coalesce(sum(amount_paise), 0) into v_open
    from public.ledger_entries where customer_id = c.id and entry_date < p_period_start;
  select coalesce(sum(amount_paise) filter (where amount_paise > 0), 0),
         coalesce(sum(amount_paise) filter (where amount_paise < 0), 0)
    into v_charges, v_credits
    from public.ledger_entries where customer_id = c.id and entry_date between p_period_start and p_period_end;

  perform pg_advisory_xact_lock(hashtextextended(c.kitchen_id::text || ':bills', 0));
  select count(*) + 1 into v_seq from public.bills where kitchen_id = c.kitchen_id;

  insert into public.bills (kitchen_id, customer_id, bill_no, period_start, period_end, opening_balance_paise,
                            charges_paise, credits_paise, closing_balance_paise, due_date, generated_by)
  values (c.kitchen_id, c.id, format('AK-%s-%s', to_char(p_period_end, 'YYYYMM'), lpad(v_seq::text, 5, '0')),
          p_period_start, p_period_end, v_open, v_charges, v_credits, v_open + v_charges + v_credits,
          p_period_end + v_due, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Settings (step-up). Only whitelisted keys; unknown keys are rejected.
-- ---------------------------------------------------------------------------
create or replace function public.owner_update_settings(p_kitchen uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  allowed constant text[] := array['display_name','upi_id','upi_qr_path','signup_mode','free_late_skips_per_month',
    'late_skip_charge_percent','late_fee_enabled','late_fee_grace_days','late_fee_type','late_fee_value',
    'low_balance_threshold_paise','media_retention_days','order_horizon_days'];
begin
  perform app.require_step_up(p_kitchen);
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_SETTING' using errcode = 'P0001'; end if;
  for k in select jsonb_object_keys(p) loop
    if not k = any (allowed) then raise exception 'INVALID_SETTING' using errcode = 'P0001', detail = k; end if;
  end loop;
  update public.business_settings b set
    display_name                = case when p ? 'display_name' then app.clean_text(p ->> 'display_name', 100) else b.display_name end,
    upi_id                      = case when p ? 'upi_id' then nullif(btrim(p ->> 'upi_id'), '') else b.upi_id end,
    upi_qr_path                 = case when p ? 'upi_qr_path' then p ->> 'upi_qr_path' else b.upi_qr_path end,
    signup_mode                 = case when p ? 'signup_mode' then p ->> 'signup_mode' else b.signup_mode end,
    free_late_skips_per_month   = case when p ? 'free_late_skips_per_month' then (p ->> 'free_late_skips_per_month')::int else b.free_late_skips_per_month end,
    late_skip_charge_percent    = case when p ? 'late_skip_charge_percent' then (p ->> 'late_skip_charge_percent')::int else b.late_skip_charge_percent end,
    late_fee_enabled            = case when p ? 'late_fee_enabled' then (p ->> 'late_fee_enabled')::boolean else b.late_fee_enabled end,
    late_fee_grace_days         = case when p ? 'late_fee_grace_days' then (p ->> 'late_fee_grace_days')::int else b.late_fee_grace_days end,
    late_fee_type               = case when p ? 'late_fee_type' then p ->> 'late_fee_type' else b.late_fee_type end,
    late_fee_value              = case when p ? 'late_fee_value' then (p ->> 'late_fee_value')::int else b.late_fee_value end,
    low_balance_threshold_paise = case when p ? 'low_balance_threshold_paise' then (p ->> 'low_balance_threshold_paise')::bigint else b.low_balance_threshold_paise end,
    media_retention_days        = case when p ? 'media_retention_days' then (p ->> 'media_retention_days')::int else b.media_retention_days end,
    order_horizon_days          = case when p ? 'order_horizon_days' then (p ->> 'order_horizon_days')::int else b.order_horizon_days end
  where b.kitchen_id = p_kitchen;
end $$;

-- ---------------------------------------------------------------------------
-- One-time setup. NOT granted to any API role. Run ONCE from the Supabase SQL
-- editor after the owner has signed up and enrolled MFA:
--   select app.bootstrap_kitchen('Amruta''s Kitchen', '<owner auth user id>', 'Amruta');
-- ---------------------------------------------------------------------------
create or replace function app.bootstrap_kitchen(p_name text, p_owner_user uuid, p_owner_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare k uuid;
begin
  insert into public.kitchens (name) values (p_name) returning id into k;
  insert into public.business_settings (kitchen_id, display_name) values (k, p_name);
  insert into public.staff_members (kitchen_id, user_id, display_name, role) values (k, p_owner_user, p_owner_name, 'owner');
  insert into public.meal_slots (kitchen_id, meal_slot, delivery_time) values (k, 'lunch', '13:30'), (k, 'dinner', '20:30');
  insert into public.expense_categories (kitchen_id, name, default_kind) values
    (k, 'Vegetables', 'running'), (k, 'Grains & Flour', 'running'), (k, 'Oil & Spices', 'running'),
    (k, 'Dairy', 'running'), (k, 'Meat & Eggs', 'running'), (k, 'Gas & Fuel', 'running'),
    (k, 'Packaging', 'running'), (k, 'Transport', 'running'), (k, 'Staff salary', 'running'),
    (k, 'Utilities', 'running'), (k, 'Other', 'running'),
    (k, 'Tiffin boxes', 'investment'), (k, 'Kitchen equipment', 'investment');
  return k;
end $$;
