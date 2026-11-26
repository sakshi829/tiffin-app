-- =============================================================================
-- 1200 CUSTOMER VIEWS (Customer app, Phase 3)
-- Read functions return ONLY the caller's own data (identity from auth.uid()).
-- Cutoff times are computed by the server so the app can show exact countdowns;
-- the write functions still re-check them.
-- =============================================================================

create or replace function public.customer_my_orders(p_kitchen uuid, p_from date, p_to date)
returns table (
  order_id             uuid,
  order_date           date,
  meal_slot            text,
  status               text,
  tiffin_type_id       uuid,
  tiffin_type_name     text,
  is_veg               boolean,
  unit_price_paise     bigint,
  addons               jsonb,
  location_node_id     uuid,
  location_text        text,
  location_path        text,
  location_updated_at  timestamptz,
  delivery_at          timestamptz,
  addon_cutoff_at      timestamptz,
  location_cutoff_at   timestamptz,
  late_skip_charged    boolean,
  delivered_at         timestamptz,
  box_kept_at          text
)
language plpgsql stable security definer set search_path = '' as $$
declare v_customer uuid := app.my_customer_id(p_kitchen);
begin
  if v_customer is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62
     or p_from < app.today() - 62 or p_to > app.today() + 31 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  return query
  select o.id, o.order_date, o.meal_slot, o.status, tt.id, tt.name, tt.is_veg, o.unit_price_paise,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'addon_id', a.id, 'item_id', a.item_id, 'name', it.name, 'qty', a.qty,
                     'unit_price_paise', a.unit_price_paise, 'requested_by_role', a.requested_by_role) order by it.name)
                   from public.order_addons a join public.items it on it.id = a.item_id
                   where a.order_id = o.id and a.status = 'accepted'), '[]'::jsonb),
         o.location_node_id, o.location_text,
         case when o.location_node_id is not null then app.location_path(o.location_node_id) end,
         o.location_updated_at,
         st.delivery_at, st.addon_cutoff_at, st.location_cutoff_at,
         o.late_skip_charged, o.delivered_at,
         (select bm.location_text from public.box_movements bm
           where bm.order_id = o.id and bm.kind = 'kept_at' order by bm.created_at desc limit 1)
  from public.orders o
  join public.tiffin_types tt on tt.id = o.tiffin_type_id
  cross join lateral app.slot_times(o.kitchen_id, o.order_date, o.meal_slot) st
  where o.customer_id = v_customer and o.order_date between p_from and p_to
  order by o.order_date, case o.meal_slot when 'lunch' then 0 else 1 end;
end $$;

-- Extras a customer may add to one of THEIR meals, priced for them on that date.
create or replace function public.customer_addon_menu(p_order uuid)
returns table (item_id uuid, name text, is_veg boolean, unit text, max_qty int, price_paise bigint)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.customer_id is distinct from app.my_customer_id(o.kitchen_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select i.id, i.name, i.is_veg, i.unit, i.max_qty_per_order,
         app.item_price(o.kitchen_id, o.customer_id, i.id, o.order_date)
  from public.items i
  where i.kitchen_id = o.kitchen_id and i.active and i.customer_orderable
    and exists (select 1 from public.item_prices ip where ip.item_id = i.id and ip.effective_from <= o.order_date)
  order by i.name;
end $$;

-- The one profile field customers edit themselves (allergies, "less spicy").
create or replace function public.customer_update_food_notes(p_kitchen uuid, p_food_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := app.my_customer_id(p_kitchen);
begin
  if v_customer is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not app.rate_limit_hit('update_food_notes', 20, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  update public.customers set food_notes = app.clean_text(p_food_notes, 500) where id = v_customer;
end $$;

-- ---------------------------------------------------------------------------
-- redeem_invite v2: each app says which kind of code it expects. A valid code
-- of the other kind is NOT used up (a staff code typed into the customer app
-- stays valid for the Staff app). Old one-argument calls keep working.
-- ---------------------------------------------------------------------------
drop function public.redeem_invite(text);

create function public.redeem_invite(p_code text, p_expected_kind text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  i public.invites;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_expected_kind is not null and p_expected_kind not in ('customer', 'staff') then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
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

  if p_expected_kind is not null and i.kind <> p_expected_kind then
    return jsonb_build_object('ok', false, 'error', 'WRONG_APP');     -- not used up
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

revoke all on function public.redeem_invite(text, text) from public, anon;

grant execute on function
  public.redeem_invite(text, text),
  public.customer_my_orders(uuid, date, date),
  public.customer_addon_menu(uuid),
  public.customer_update_food_notes(uuid, text)
to authenticated;
