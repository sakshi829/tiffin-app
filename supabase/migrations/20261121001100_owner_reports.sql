-- =============================================================================
-- 1100 OWNER REPORTS (read-only views for the Owner app, Phase 2)
-- Joins happen here (tested) instead of in the app. Owner + MFA only.
-- =============================================================================

-- All orders of one day with everything the Today / Kitchen / Packing /
-- Delivery screens need.
create or replace function public.owner_day_orders(p_kitchen uuid, p_date date)
returns table (
  order_id             uuid,
  meal_slot            text,
  status               text,
  customer_id          uuid,
  customer_name        text,
  customer_phone       text,
  food_notes           text,
  tiffin_type_id       uuid,
  tiffin_type_name     text,
  is_veg               boolean,
  unit_price_paise     bigint,
  addons               jsonb,
  location_text        text,
  location_path        text,
  location_updated_at  timestamptz,
  assigned_staff_id    uuid,
  assigned_staff_name  text,
  delivered_at         timestamptz,
  not_delivered_reason text,
  late_skip_charged    boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  if p_date is null then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;
  return query
  select o.id, o.meal_slot, o.status, c.id, c.full_name, c.phone, c.food_notes,
         tt.id, tt.name, tt.is_veg, o.unit_price_paise,
         coalesce((select jsonb_agg(jsonb_build_object('item_id', a.item_id, 'name', it.name, 'qty', a.qty,
                                                       'unit_price_paise', a.unit_price_paise) order by it.name)
                   from public.order_addons a join public.items it on it.id = a.item_id
                   where a.order_id = o.id and a.status = 'accepted'), '[]'::jsonb),
         o.location_text,
         case when o.location_node_id is not null then app.location_path(o.location_node_id) end,
         o.location_updated_at, o.assigned_staff_id, s.display_name,
         o.delivered_at, o.not_delivered_reason, o.late_skip_charged
  from public.orders o
  join public.customers c     on c.id = o.customer_id
  join public.tiffin_types tt on tt.id = o.tiffin_type_id
  left join public.staff_members s on s.id = o.assigned_staff_id
  where o.kitchen_id = p_kitchen and o.order_date = p_date
  order by 2, 14 nulls last, 5;
end $$;

-- Every non-archived customer with live balance (positive = owes you).
create or replace function public.owner_customer_balances(p_kitchen uuid)
returns table (
  customer_id       uuid,
  full_name         text,
  phone             text,
  status            text,
  billing_mode      text,
  linked            boolean,
  balance_paise     bigint,
  last_payment_on   date,
  pending_payments  int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  return query
  select c.id, c.full_name, c.phone, c.status, c.billing_mode, c.user_id is not null,
         coalesce((select sum(e.amount_paise) from public.ledger_entries e where e.customer_id = c.id), 0)::bigint,
         (select max(p.paid_on) from public.payments p where p.customer_id = c.id and p.status = 'confirmed'),
         (select count(*)::int from public.payments p where p.customer_id = c.id and p.status = 'submitted')
  from public.customers c
  where c.kitchen_id = p_kitchen and c.status <> 'archived'
  order by 7 desc, 2;
end $$;

-- Statement for one customer and date range: opening, entries, closing.
create or replace function public.owner_customer_statement(p_customer uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; v_open bigint; v_entries jsonb; v_close bigint;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then
    raise exception 'INVALID_DATES' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount_paise), 0) into v_open from public.ledger_entries
   where customer_id = c.id and entry_date < p_from;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'entry_date', e.entry_date, 'kind', e.kind, 'amount_paise', e.amount_paise,
           'note', e.note, 'order_id', e.order_id, 'created_at', e.created_at)
         order by e.entry_date, e.created_at), '[]'::jsonb),
         v_open + coalesce(sum(e.amount_paise), 0)
    into v_entries, v_close
    from public.ledger_entries e
   where e.customer_id = c.id and e.entry_date between p_from and p_to;
  return jsonb_build_object('customer_id', c.id, 'full_name', c.full_name, 'from', p_from, 'to', p_to,
                            'opening_paise', v_open, 'entries', v_entries, 'closing_paise', v_close);
end $$;

grant execute on function
  public.owner_day_orders(uuid, date),
  public.owner_customer_balances(uuid),
  public.owner_customer_statement(uuid, date, date)
to authenticated;
