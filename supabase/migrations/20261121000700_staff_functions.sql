-- =============================================================================
-- 0700 STAFF FUNCTIONS
-- Staff have NO direct read access to orders, customers or any money table.
-- They see only their own tasks, with only the columns they need.
--   kitchen / kitchen_delivery  -> packing list for the day (no phone numbers)
--   delivery / kitchen_delivery -> deliveries ASSIGNED to them
--                                   (phone only if the owner enabled it)
-- =============================================================================

create or replace function app.location_path(p_node uuid) returns text
language sql stable security definer set search_path = '' as $$
  with recursive chain as (
    select n.id, n.parent_id, n.place_id, n.name, 0 as depth from public.location_nodes n where n.id = p_node
    union all
    select p.id, p.parent_id, p.place_id, p.name, c.depth + 1
    from public.location_nodes p join chain c on p.id = c.parent_id
    where c.depth < 10
  )
  select concat_ws(' > ',
           (select pl.name from public.places pl where pl.id = (select place_id from chain limit 1)),
           (select string_agg(name, ' > ' order by depth desc) from chain))
$$;

create or replace function public.staff_my_tasks(p_kitchen uuid, p_date date, p_meal_slot text)
returns table (
  task                 text,
  order_id             uuid,
  order_date           date,
  meal_slot            text,
  status               text,
  customer_name        text,
  customer_phone       text,
  food_notes           text,
  tiffin_type_name     text,
  is_veg               boolean,
  addons               jsonb,
  location_text        text,
  location_path        text,
  location_directions  text,
  location_updated_at  timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare s public.staff_members := app.my_staff(p_kitchen);
begin
  if s.id is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  if p_date is null or p_date < app.today() - 1 or p_date > app.today() + 1 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  if p_meal_slot is not null and p_meal_slot not in ('lunch','dinner') then
    raise exception 'INVALID_SLOT' using errcode = 'P0001';
  end if;

  return query
  select
    x.task, o.id, o.order_date, o.meal_slot, o.status,
    c.full_name,
    case when x.task = 'deliver' and s.can_see_phone and o.order_date = app.today() then c.phone end,
    c.food_notes,
    tt.name, tt.is_veg,
    coalesce((select jsonb_agg(jsonb_build_object('name', it.name, 'qty', a.qty) order by it.name)
              from public.order_addons a join public.items it on it.id = a.item_id
              where a.order_id = o.id and a.status = 'accepted'), '[]'::jsonb),
    o.location_text,
    case when o.location_node_id is not null then app.location_path(o.location_node_id) end,
    ln.directions,
    o.location_updated_at
  from public.orders o
  join public.customers c     on c.id = o.customer_id
  join public.tiffin_types tt on tt.id = o.tiffin_type_id
  left join public.location_nodes ln on ln.id = o.location_node_id
  cross join lateral (
    select 'pack'::text as task
      where s.role in ('kitchen','kitchen_delivery') and o.status in ('scheduled','delivered')
    union all
    select 'deliver'::text
      where s.role in ('delivery','kitchen_delivery') and o.assigned_staff_id = s.id
        and o.status in ('scheduled','delivered','not_delivered')
  ) x
  where o.kitchen_id = p_kitchen and o.order_date = p_date
    and (p_meal_slot is null or o.meal_slot = p_meal_slot)
  order by 1, 4, 13 nulls last, 6;   -- task, meal_slot, location_path, customer_name
end $$;

-- Lock an order assigned to the calling delivery staff member, for today.
create or replace function app.lock_my_delivery(p_order uuid) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare o public.orders; s public.staff_members;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  s := app.my_staff(o.kitchen_id);
  if s.id is null or s.role not in ('delivery','kitchen_delivery') or o.assigned_staff_id is distinct from s.id then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if o.order_date <> app.today() then raise exception 'NOT_TODAY' using errcode = 'P0001'; end if;
  return o;
end $$;

create or replace function public.staff_mark_delivered(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  o := app.lock_my_delivery(p_order);
  if o.status = 'delivered' then
    return jsonb_build_object('order_id', o.id, 'status', o.status);   -- idempotent (offline retries)
  end if;
  if o.status not in ('scheduled','not_delivered') then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  update public.orders
     set status = 'delivered', delivered_at = app.now(), delivered_by = auth.uid(), not_delivered_reason = null
   where id = o.id;
  perform app.charge_delivered(o.id);
  return jsonb_build_object('order_id', o.id, 'status', 'delivered');
end $$;

create or replace function public.staff_mark_not_delivered(p_order uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_reason text := app.clean_text(p_reason, 200);
begin
  o := app.lock_my_delivery(p_order);
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if o.status = 'not_delivered' then return jsonb_build_object('order_id', o.id, 'status', o.status); end if;
  if o.status <> 'scheduled' then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  update public.orders set status = 'not_delivered', not_delivered_reason = v_reason where id = o.id;
  return jsonb_build_object('order_id', o.id, 'status', 'not_delivered');
end $$;

-- Box collected (scan QR or tap). Customer is taken from an order assigned to
-- this staff member in the last 7 days, never from client input.
create or replace function public.staff_box_collected(p_order uuid, p_box_code text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; s public.staff_members; v_box uuid; v_id uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  s := app.my_staff(o.kitchen_id);
  if s.id is null or s.role not in ('delivery','kitchen_delivery') or o.assigned_staff_id is distinct from s.id
     or o.order_date < app.today() - 7 then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_box_code is not null then
    select id into v_box from public.boxes
     where kitchen_id = o.kitchen_id and code = upper(btrim(p_box_code)) and active;
    if v_box is null then raise exception 'UNKNOWN_BOX' using errcode = 'P0001'; end if;
  end if;
  if p_idempotency_key is not null then
    select id into v_id from public.box_movements where kitchen_id = o.kitchen_id and idempotency_key = p_idempotency_key;
    if v_id is not null then return jsonb_build_object('movement_id', v_id); end if;
  end if;
  insert into public.box_movements (kitchen_id, box_id, customer_id, order_id, kind, actor_user_id, actor_role, idempotency_key)
  values (o.kitchen_id, v_box, o.customer_id, o.id, 'collected', auth.uid(), 'staff', p_idempotency_key)
  returning id into v_id;
  return jsonb_build_object('movement_id', v_id);
end $$;
