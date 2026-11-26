-- =============================================================================
-- 1900 HARDENING (Phase 7): fixes from the pre-launch security review.
-- Each section names the finding it closes; tests: 22-hardening.test.mjs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Late fees (HIGH). Each bill's fee is DECIDED ONCE, the first run after the
--    due date, and the decision is stored even when nothing is charged, so a
--    bill paid on time can never get a fee later. The fee is based on what was
--    still unpaid ON the due date, only on the bill's OWN new charges (never on
--    older debt or earlier fees), waits while a payment made by the due date is
--    still waiting for the owner, is capped at 100 % and never exceeds the
--    unpaid amount. Overlapping bills of one customer are charged once.
-- ---------------------------------------------------------------------------
alter table public.bill_late_fees drop constraint bill_late_fees_amount_paise_check;
alter table public.bill_late_fees alter column ledger_entry_id drop not null;
alter table public.bill_late_fees
  add column outcome text not null default 'charged'
    check (outcome in ('charged','nothing_due','exempt','overlap')),
  add constraint late_fee_outcome_consistent check (
    (outcome = 'charged' and ledger_entry_id is not null and amount_paise > 0)
    or (outcome <> 'charged' and ledger_entry_id is null and amount_paise = 0));

create or replace function app.run_billing_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_out bigint; v_fee bigint; v_entry uuid; v_value int;
  v_bal bigint; v_own bigint; v_base bigint; v_outcome text;
begin
  -- 1. Reminder 2 days before a bill is due (also the promised late-fee warning).
  for r in
    select b.*, c.user_id, s.late_fee_enabled, s.late_fee_since, c.late_fee_mode
    from public.bills b
    join public.customers c on c.id = b.customer_id
    join public.business_settings s on s.kitchen_id = b.kitchen_id
    where b.due_date = app.today() + 2
  loop
    v_out := app.bill_outstanding(r.id);
    continue when v_out <= 0;
    perform app.notify(r.kitchen_id, r.user_id, 'due_reminder', 'Payment due ' || to_char(r.due_date, 'DD Mon'),
      app.rupees(v_out) || ' is due by ' || to_char(r.due_date, 'DD Mon') || ' (bill ' || r.bill_no || ').'
        || case when r.late_fee_enabled and r.late_fee_since is not null and r.generated_at::date >= r.late_fee_since
                     and r.late_fee_mode <> 'exempt' then ' A late fee applies after that date.' else '' end,
      jsonb_build_object('bill_id', r.id), 'due:' || r.id);
  end loop;

  -- 2. Late fee: one decision per bill (see section header).
  for r in
    select b.*, c.user_id, c.status as customer_status, c.late_fee_mode, c.late_fee_custom_value,
           s.late_fee_type, s.late_fee_value
    from public.bills b
    join public.customers c on c.id = b.customer_id
    join public.business_settings s on s.kitchen_id = b.kitchen_id
    where b.due_date < app.today()
      and s.late_fee_enabled and s.late_fee_since is not null and b.generated_at::date >= s.late_fee_since
      and not exists (select 1 from public.bill_late_fees f where f.bill_id = b.id)
    order by b.due_date, b.generated_at
  loop
    -- A UPI payment made by the due date may still be waiting for the owner: decide after they act.
    continue when exists (select 1 from public.payments p
                          where p.customer_id = r.customer_id and p.status = 'submitted' and p.paid_on <= r.due_date);
    v_fee := 0; v_entry := null;
    if r.late_fee_mode = 'exempt' or r.customer_status = 'archived' then
      v_outcome := 'exempt';
    elsif exists (select 1 from public.bill_late_fees f join public.bills o on o.id = f.bill_id
                  where o.customer_id = r.customer_id and f.outcome = 'charged'
                    and o.period_start <= r.period_end and o.period_end >= r.period_start) then
      v_outcome := 'overlap';
    else
      -- balance on the due date (payments count on the day they were paid)
      select coalesce(sum(amount_paise), 0) into v_bal from public.ledger_entries
       where customer_id = r.customer_id and entry_date <= r.due_date;
      -- this bill's own new charges (meals, extras, late skips, minus reversals/discounts/waivers)
      select coalesce(sum(amount_paise), 0) into v_own from public.ledger_entries
       where customer_id = r.customer_id and entry_date between r.period_start and r.period_end
         and kind not in ('payment','late_fee');
      v_base := greatest(0, least(r.closing_balance_paise, v_bal, v_own));
      v_value := case when r.late_fee_mode = 'custom' then r.late_fee_custom_value else r.late_fee_value end;
      v_fee := case when r.late_fee_type = 'percent' then round(v_base * least(greatest(coalesce(v_value, 0), 0), 100) / 100.0)
                    else greatest(coalesce(v_value, 0), 0) end;
      v_fee := least(v_fee, v_base);
      v_outcome := case when v_fee > 0 then 'charged' else 'nothing_due' end;
      if v_outcome <> 'charged' then v_fee := 0; end if;
    end if;

    if v_outcome = 'charged' then
      insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, note)
      values (r.kitchen_id, r.customer_id, app.today(), 'late_fee', v_fee, 'Late fee for bill ' || r.bill_no)
      returning id into v_entry;
    end if;
    insert into public.bill_late_fees (bill_id, kitchen_id, customer_id, ledger_entry_id, amount_paise, outcome)
    values (r.id, r.kitchen_id, r.customer_id, v_entry, v_fee, v_outcome);
    if v_outcome = 'charged' then
      perform app.notify(r.kitchen_id, r.user_id, 'late_fee', 'Late fee added',
        app.rupees(v_fee) || ' late fee added: bill ' || r.bill_no || ' was due ' || to_char(r.due_date, 'DD Mon') || '.',
        jsonb_build_object('bill_id', r.id), 'latefee:' || r.id);
    end if;
  end loop;

  -- 3. Advance customers running low (once a day, only while they have an active plan).
  for r in
    select c.id, c.kitchen_id, c.user_id, s.low_balance_threshold_paise, app.customer_balance(c.id) as bal
    from public.customers c
    join public.business_settings s on s.kitchen_id = c.kitchen_id
    where c.billing_mode = 'advance' and c.status = 'active' and c.user_id is not null
      and exists (select 1 from public.subscriptions x where x.customer_id = c.id and x.status = 'active')
  loop
    continue when -r.bal >= r.low_balance_threshold_paise;
    perform app.notify(r.kitchen_id, r.user_id, 'low_balance', 'Advance running low',
      case when r.bal < 0 then 'Advance left: ' || app.rupees(-r.bal) || '. Please top up soon.'
           when r.bal = 0 then 'Your advance is used up. Please top up.'
           else 'Your advance is used up and ' || app.rupees(r.bal) || ' is due. Please top up.' end,
      '{}'::jsonb, 'lowbal:' || r.id || ':' || app.today());
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Step-up on direct table writes (MEDIUM). Owner screens write some tables
--    directly; these triggers make the money-affecting changes need a recent
--    authenticator code, exactly like the step-up functions. They act only on
--    API writes (current_user = 'authenticated'); SECURITY DEFINER functions run
--    as the table owner and do their own checks.
-- ---------------------------------------------------------------------------
-- Same check as app.require_step_up, written inline because these triggers run as the API user.
create or replace function app.direct_write_step_up(p_kitchen uuid) returns void
language plpgsql stable set search_path = '' as $fn$
begin
  if p_kitchen is null or not app.is_owner(p_kitchen) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not app.recent_mfa(10) then
    raise exception 'STEP_UP_REQUIRED' using errcode = '42501',
      hint = 'Re-enter your authenticator code and try again.';
  end if;
end $fn$;
grant execute on function app.direct_write_step_up(uuid) to authenticated;   -- answers only about the caller

create or replace function app.customers_step_up() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    if new.status = 'archived' or new.late_fee_mode <> 'follow_global' or new.late_fee_custom_value is not null
       or new.late_skip_free_override is not null or new.late_skip_charge_percent_override is not null then
      perform app.direct_write_step_up(new.kitchen_id);
    end if;
  elsif (old.status = 'archived') <> (new.status = 'archived')
     or old.late_fee_mode is distinct from new.late_fee_mode
     or old.late_fee_custom_value is distinct from new.late_fee_custom_value
     or old.late_skip_free_override is distinct from new.late_skip_free_override
     or old.late_skip_charge_percent_override is distinct from new.late_skip_charge_percent_override then
    perform app.direct_write_step_up(new.kitchen_id);
  end if;
  return new;
end $$;
create trigger customers_step_up before insert or update on public.customers
  for each row execute function app.customers_step_up();

create or replace function app.tiffin_types_step_up() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and old.pricing_mode is distinct from new.pricing_mode then
    perform app.direct_write_step_up(new.kitchen_id);
  end if;
  return new;
end $$;
create trigger tiffin_types_step_up before update on public.tiffin_types
  for each row execute function app.tiffin_types_step_up();

-- What goes into a tiffin changes the price of "sum of items" tiffins, so it is
-- set in ONE call (all or nothing; safe to retry after the authenticator prompt).
revoke insert, update, delete on public.tiffin_type_items from authenticated;
drop policy owner_insert on public.tiffin_type_items;
drop policy owner_update on public.tiffin_type_items;
drop policy owner_delete on public.tiffin_type_items;

create or replace function public.owner_set_tiffin_items(p_tiffin_type uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tiffin_types; e jsonb; v_item uuid; v_qty int; v_seen uuid[] := '{}';
begin
  select * into t from public.tiffin_types where id = p_tiffin_type for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(t.kitchen_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  -- A tiffin already ordered or subscribed changes prices: needs a recent authenticator code.
  if exists (select 1 from public.subscriptions s where s.tiffin_type_id = t.id)
     or exists (select 1 from public.orders o where o.tiffin_type_id = t.id) then
    perform app.require_step_up(t.kitchen_id);
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    v_item := app.try_uuid(e ->> 'item_id');
    v_qty := case when (e ->> 'qty') ~ '^[0-9]{1,2}$' then (e ->> 'qty')::int end;
    if v_item is null or v_qty is null or v_qty not between 1 and 20 or v_item = any (v_seen)
       or not exists (select 1 from public.items i where i.id = v_item and i.kitchen_id = t.kitchen_id) then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_item;
  end loop;
  delete from public.tiffin_type_items x where x.tiffin_type_id = t.id and not (x.item_id = any (v_seen));
  insert into public.tiffin_type_items (kitchen_id, tiffin_type_id, item_id, qty)
  select t.kitchen_id, t.id, app.try_uuid(x.v ->> 'item_id'), (x.v ->> 'qty')::int from jsonb_array_elements(p_items) as x(v)
  on conflict (tiffin_type_id, item_id) do update set qty = excluded.qty
    where public.tiffin_type_items.qty is distinct from excluded.qty;
end $$;
revoke execute on function public.owner_set_tiffin_items(uuid, jsonb) from public, anon;
grant execute on function public.owner_set_tiffin_items(uuid, jsonb) to authenticated;

-- Correcting a meal's status undoes its charges (a waiver in effect) when it was
-- delivered or charged as a late skip: that needs step-up. Marking delivered does not.
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
  if o.status = 'delivered' or (o.status = 'skipped_late' and o.late_skip_charged) then
    perform app.require_step_up(o.kitchen_id);
  end if;

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

-- ---------------------------------------------------------------------------
-- 3. Unbounded growth by one user (MEDIUM): per-user limits on the rows a
--    customer or staff member can create, and only the 20 most recent saved
--    locations are kept. The owner and scheduled jobs are not limited.
-- ---------------------------------------------------------------------------
create or replace function app.limit_member_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max int; v_window interval; v_key text := tg_table_name;
begin
  if auth.uid() is null or app.is_owner(new.kitchen_id) then return new; end if;
  case tg_table_name
    when 'customer_saved_locations' then v_max := 30;  v_window := interval '1 hour';
    when 'customer_skips'           then v_max := 20;  v_window := interval '1 day';
    when 'order_addons'             then v_max := 60;  v_window := interval '1 hour';
    when 'box_movements'            then
      if new.actor_role = 'customer' then v_key := 'box_kept'; v_max := 20; else v_max := 400; end if;
      v_window := interval '1 day';
    else return new;
  end case;
  if not app.rate_limit_hit('rows:' || v_key, v_max, v_window) then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger limit_member_writes before insert on public.customer_saved_locations for each row execute function app.limit_member_writes();
create trigger limit_member_writes before insert on public.customer_skips           for each row execute function app.limit_member_writes();
create trigger limit_member_writes before insert on public.order_addons             for each row execute function app.limit_member_writes();
create trigger limit_member_writes before insert on public.box_movements            for each row execute function app.limit_member_writes();

create or replace function app.trim_saved_locations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.customer_saved_locations x
  where x.customer_id = new.customer_id
    and x.id not in (select y.id from public.customer_saved_locations y where y.customer_id = new.customer_id
                     order by y.last_used_at desc, y.id limit 20);
  return null;
end $$;
create trigger trim_saved_locations after insert on public.customer_saved_locations
  for each row execute function app.trim_saved_locations();

-- ---------------------------------------------------------------------------
-- 4. Cancelling a closure brings back exactly what each meal was before
--    (LOW-MEDIUM): a meal the customer skipped stays skipped.
-- ---------------------------------------------------------------------------
alter table public.orders add column status_before_closure text
  check (status_before_closure in ('scheduled','skipped','skipped_late'));

create or replace function app.remember_status_before_closure() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelled_closure' and old.status <> 'cancelled_closure' then
    new.status_before_closure := old.status;
  elsif new.status <> 'cancelled_closure' then
    new.status_before_closure := null;
  end if;
  return new;
end $$;
create trigger orders_status_before_closure before update of status on public.orders
  for each row execute function app.remember_status_before_closure();

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
  -- A late skip's charge was refunded by the closure; it comes back as a plain (free) skip.
  update public.orders o
     set status = case when o.status_before_closure in ('skipped','skipped_late')
                         or app.skip_covers(o.customer_id, o.order_date, o.meal_slot) then 'skipped'
                       else 'scheduled' end
   where o.kitchen_id = cl.kitchen_id and o.order_date = cl.closure_date
     and (cl.meal_slot is null or o.meal_slot = cl.meal_slot)
     and o.status = 'cancelled_closure'
     and not app.closure_covers(o.kitchen_id, o.order_date, o.meal_slot);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Delivery can't be marked before the customer's free-skip cutoff (LOW):
--    otherwise a meal could be charged while the customer may still skip it.
-- ---------------------------------------------------------------------------
create or replace function public.staff_mark_delivered(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; t record;
begin
  o := app.lock_my_delivery(p_order);
  if o.status = 'delivered' then
    return jsonb_build_object('order_id', o.id, 'status', o.status);   -- idempotent (offline retries)
  end if;
  if o.status not in ('scheduled','not_delivered') then raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001'; end if;
  select * into t from app.slot_times(o.kitchen_id, o.order_date, o.meal_slot);
  if app.now() < t.addon_cutoff_at then raise exception 'TOO_EARLY' using errcode = 'P0001'; end if;
  update public.orders
     set status = 'delivered', delivered_at = app.now(), delivered_by = auth.uid(), not_delivered_reason = null
   where id = o.id;
  perform app.charge_delivered(o.id);
  return jsonb_build_object('order_id', o.id, 'status', 'delivered');
end $$;

-- ---------------------------------------------------------------------------
-- 6. UTR (LOW): a submitted UTR is never refused for being "already used", so
--    nobody can probe which UTRs exist or block a real payer by submitting their
--    UTR first. The owner sees a "same UTR" flag; only CONFIRMED payments must
--    have unique UTRs (checked when confirming).
-- ---------------------------------------------------------------------------
drop index public.payments_utr_uniq;
create unique index payments_utr_confirmed_uniq on public.payments (kitchen_id, upper(utr))
  where utr is not null and status = 'confirmed';
create index payments_utr on public.payments (kitchen_id, upper(utr)) where utr is not null;

create or replace function app.payments_utr_confirm_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'confirmed' and new.utr is not null and (tg_op = 'INSERT' or old.status <> 'confirmed')
     and exists (select 1 from public.payments x where x.kitchen_id = new.kitchen_id and x.id <> new.id
                 and x.status = 'confirmed' and upper(x.utr) = upper(new.utr)) then
    raise exception 'UTR_ALREADY_USED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payments_utr_confirm_check before insert or update of status on public.payments
  for each row execute function app.payments_utr_confirm_check();

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

  insert into public.payments (kitchen_id, customer_id, amount_paise, method, utr, paid_on, status,
                               submitted_by_role, idempotency_key, note, created_by)
  values (p_kitchen, v_customer, p_amount_paise, 'upi', v_utr, p_paid_on, 'submitted',
          'customer', p_idempotency_key, app.clean_text(p_note, 300), auth.uid())
  returning * into p;
  return jsonb_build_object('payment_id', p.id, 'status', p.status);
end $$;

-- Owner's list of payments to confirm, with the "same UTR as another payment" flag.
create or replace function public.owner_pending_payments(p_kitchen uuid)
returns table (id uuid, customer_id uuid, customer_name text, amount_paise bigint, method text, utr text,
               paid_on date, proof_path text, note text, created_at timestamptz, same_utr_count int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, c.full_name, p.amount_paise, p.method, p.utr, p.paid_on, p.proof_path, p.note, p.created_at,
         (select count(*)::int from public.payments x where x.kitchen_id = p.kitchen_id and x.id <> p.id
            and x.status <> 'rejected' and p.utr is not null and upper(x.utr) = upper(p.utr))
  from public.payments p join public.customers c on c.id = p.customer_id
  where app.is_owner(p_kitchen) and p.kitchen_id = p_kitchen and p.status = 'submitted'
  order by p.created_at
$$;
revoke execute on function public.owner_pending_payments(uuid) from public, anon;
grant execute on function public.owner_pending_payments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Free late skips: two skips at the same moment can't both be "free" (LOW).
-- ---------------------------------------------------------------------------
create or replace function app.charge_late_skip(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; c public.customers; s public.business_settings;
  v_free int; v_pct int; v_prior int; v_base bigint; v_amount bigint;
begin
  select * into o from public.orders where id = p_order;
  select * into c from public.customers where id = o.customer_id for update;   -- serialises this customer's late skips
  select * into s from public.business_settings where kitchen_id = o.kitchen_id;
  v_free := coalesce(c.late_skip_free_override, s.free_late_skips_per_month);
  v_pct  := coalesce(c.late_skip_charge_percent_override, s.late_skip_charge_percent);

  select count(*) into v_prior from public.orders x
  where x.customer_id = o.customer_id and x.id <> o.id and x.status = 'skipped_late'
    and date_trunc('month', x.order_date) = date_trunc('month', o.order_date);

  if v_prior < v_free or v_pct = 0 then return; end if;

  select o.unit_price_paise + coalesce(sum(a.qty * a.unit_price_paise), 0) into v_base
  from public.order_addons a where a.order_id = o.id and a.status = 'accepted';
  v_amount := round(v_base * v_pct / 100.0);
  if v_amount > 0 then
    insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, note, created_by)
    values (o.kitchen_id, o.customer_id, o.order_date, 'late_skip', v_amount, o.id,
            format('Skipped after cutoff (%s%%)', v_pct), auth.uid());
    update public.orders set late_skip_charged = true where id = o.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Audit log: ignored columns (e.g. invite code hashes) are left out of
--    INSERT and DELETE rows too, not only from UPDATE diffs (LOW).
-- ---------------------------------------------------------------------------
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb;
  v_ignore text[] := array['updated_at','version'];
  v_diff_old jsonb := '{}'::jsonb; v_diff_new jsonb := '{}'::jsonb;
  k text; i int; v_claims jsonb;
begin
  if tg_nargs > 1 then
    for i in 1 .. tg_nargs - 1 loop v_ignore := v_ignore || tg_argv[i]; end loop;
  end if;

  if tg_op = 'INSERT' then
    if tg_argv[0] = 'false' then return new; end if;
    v_new := to_jsonb(new); v_diff_new := v_new - v_ignore;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any(v_ignore);
      if v_old -> k is distinct from v_new -> k then
        v_diff_old := v_diff_old || jsonb_build_object(k, v_old -> k);
        v_diff_new := v_diff_new || jsonb_build_object(k, v_new -> k);
      end if;
    end loop;
    if v_diff_new = '{}'::jsonb then return new; end if;
  else
    v_old := to_jsonb(old); v_diff_old := v_old - v_ignore;
  end if;

  v_claims := auth.jwt();
  insert into public.audit_log (kitchen_id, actor_user_id, actor_role, table_name, record_id, action, old_data, new_data)
  values (
    coalesce(v_new ->> 'kitchen_id', v_old ->> 'kitchen_id')::uuid,
    auth.uid(),
    coalesce(v_claims ->> 'role', current_user::text),
    tg_table_name,
    case when coalesce(v_new, v_old) ? 'id' then coalesce(v_new ->> 'id', v_old ->> 'id')::uuid end,
    tg_op,
    nullif(v_diff_old, '{}'::jsonb),
    nullif(v_diff_new, '{}'::jsonb)
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Boxes (LOW): a box is "collected" only after its meal was delivered (or
--    not delivered), scans are limited per staff member, and only packing
--    (kitchen) staff or the owner record which box went out.
-- ---------------------------------------------------------------------------
create or replace function public.staff_box_scan_collect(p_kitchen uuid, p_box_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.staff_members := app.my_staff(p_kitchen); v_box uuid; iss public.box_movements; v_id uuid; v_name text; v_status text;
begin
  if s.id is null or s.role not in ('delivery','kitchen_delivery') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select id into v_box from public.boxes where kitchen_id = p_kitchen and code = upper(btrim(coalesce(p_box_code, ''))) and active;
  if v_box is null then raise exception 'UNKNOWN_BOX' using errcode = 'P0001'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.box_movements where kitchen_id = p_kitchen and idempotency_key = p_idempotency_key;
  end if;
  select * into iss from public.box_movements where box_id = v_box and kind = 'issued' order by created_at desc limit 1;
  if iss.id is null then raise exception 'BOX_NOT_ISSUED' using errcode = 'P0001'; end if;
  select status into v_status from public.orders where id = iss.order_id;
  if v_status is distinct from 'delivered' and v_status is distinct from 'not_delivered' then
    raise exception 'BOX_NOT_DELIVERED' using errcode = 'P0001';
  end if;
  if v_id is null and not app.rate_limit_hit('box_scan', 200, interval '1 hour') then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.customers where id = iss.customer_id;
  if v_id is null and not exists (select 1 from public.box_movements where box_id = v_box and kind = 'collected' and created_at >= iss.created_at) then
    insert into public.box_movements (kitchen_id, box_id, customer_id, order_id, kind, actor_user_id, actor_role, idempotency_key)
    values (p_kitchen, v_box, iss.customer_id, iss.order_id, 'collected', auth.uid(), 'staff', p_idempotency_key);
  end if;
  return jsonb_build_object('box', upper(btrim(p_box_code)), 'customer_name', v_name);
end $$;

create or replace function public.staff_box_issued(p_order uuid, p_box_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; s public.staff_members; v_box uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  s := app.my_staff(o.kitchen_id);
  if (s.id is null or s.role not in ('kitchen','kitchen_delivery')) and not app.is_owner(o.kitchen_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if o.order_date not between app.today() and app.today() + 1 or o.status <> 'scheduled' then
    raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  select id into v_box from public.boxes where kitchen_id = o.kitchen_id and code = upper(btrim(coalesce(p_box_code, ''))) and active;
  if v_box is null then raise exception 'UNKNOWN_BOX' using errcode = 'P0001'; end if;
  insert into public.box_movements (kitchen_id, box_id, customer_id, order_id, kind, actor_user_id, actor_role)
  values (o.kitchen_id, v_box, o.customer_id, o.id, 'issued', auth.uid(), case when s.id is null then 'owner' else 'staff' end);
  return jsonb_build_object('box', upper(btrim(p_box_code)), 'customer_id', o.customer_id);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Storage (LOW): folder ids must be the standard lowercase UUID spelling
--     (other spellings would make files nothing can attach), and each person
--     can upload a limited number of files per day so nobody can fill the 1 GB.
-- ---------------------------------------------------------------------------
create or replace function app.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return p::uuid;
end $$;

create or replace function app.upload_quota_ok(p_kitchen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from storage.objects o
           where o.owner_id = auth.uid()::text and o.created_at > now() - interval '1 day')
         < case when app.is_owner(p_kitchen) then 500 else 150 end
$$;

create or replace function app.can_write_media(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.media_kind_ok(p_bucket, p_name)
     and app.upload_quota_ok(app.try_uuid(split_part(p_name, '/', 1)))
     and case p_bucket
    when 'kitchen-media'   then app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
    when 'receipts'        then app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
    when 'delivery-proofs' then app.can_upload_delivery_proof(app.try_uuid(split_part(p_name, '/', 1)),
                                  app.try_uuid(split_part(p_name, '/', 2)), app.try_uuid(split_part(split_part(p_name, '/', 3), '.', 1)))
    when 'payment-proofs'  then app.try_uuid(split_part(p_name, '/', 2)) = app.my_customer_id(app.try_uuid(split_part(p_name, '/', 1)))
    when 'voice-notes'     then app.try_uuid(split_part(p_name, '/', 2)) = app.my_customer_id(app.try_uuid(split_part(p_name, '/', 1)))
                                or (app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
                                    and exists (select 1 from public.customers c where c.id = app.try_uuid(split_part(p_name, '/', 2))
                                                and c.kitchen_id = app.try_uuid(split_part(p_name, '/', 1))))
    else false end
$$;

-- Remaining stored file paths must point into the row's own kitchen folder.
alter table public.location_nodes add constraint directions_voice_in_kitchen
  check (directions_voice_path is null or split_part(directions_voice_path, '/', 1) = kitchen_id::text);
alter table public.packing_instructions add constraint packing_voice_in_kitchen
  check (voice_path is null or split_part(voice_path, '/', 1) = kitchen_id::text);
alter table public.box_movements add constraint box_photo_in_kitchen
  check (photo_path is null or split_part(photo_path, '/', 1) = kitchen_id::text);

-- ---------------------------------------------------------------------------
-- 11. Home addresses (LOW): customers see the kitchen's shared places
--     (hospitals, offices...) but never another customer's home. Owner and
--     staff see all places as before.
-- ---------------------------------------------------------------------------
create or replace function app.can_see_place(p_kitchen uuid, p_place uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_member(p_kitchen) and (
       app.is_owner(p_kitchen) or app.is_staff(p_kitchen)
    or exists (select 1 from public.places p where p.id = p_place and p.kind <> 'home')
    or exists (select 1 from public.customers c join public.location_nodes n on n.id = c.default_location_node_id
               where c.user_id = auth.uid() and c.kitchen_id = p_kitchen and n.place_id = p_place))
$$;
grant execute on function app.can_see_place(uuid, uuid) to authenticated;   -- used inside the policies below
drop policy read_members on public.places;
drop policy read_members on public.location_nodes;
create policy read_members on public.places for select to authenticated using (app.can_see_place(kitchen_id, id));
create policy read_members on public.location_nodes for select to authenticated using (app.can_see_place(kitchen_id, place_id));

-- ---------------------------------------------------------------------------
-- 12. "Sign out on all my devices" also stops alerts to the other phones
--     (MEDIUM-LOW): pushes go to registered devices, not to sessions.
-- ---------------------------------------------------------------------------
create or replace function public.forget_other_devices(p_keep uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  delete from public.devices where user_id = auth.uid() and id is distinct from p_keep;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.forget_other_devices(uuid) from public, anon;
grant execute on function public.forget_other_devices(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Performance (load test, docs/STATUS.md): every delivery adds box rows;
--     "boxes out" and box scans look them up by order and by box.
-- ---------------------------------------------------------------------------
create index box_movements_order on public.box_movements (order_id, kind);
create index box_movements_box on public.box_movements (box_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 14. Performance of row-level security (load test: a customer reading their
--     ledger took 4 s with a year of data). The old rules called a function for
--     EVERY row of every customer. Now "which kitchens do I own / which customers
--     am I" is worked out once per request and each row is a cheap comparison.
--     Same meaning as app.can_read_customer_row: each row's customer belongs to
--     its kitchen (composite foreign keys), so matching the customer id is enough.
-- ---------------------------------------------------------------------------
create or replace function app.my_owned_kitchens() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.kitchen_id from public.staff_members s
  where app.has_mfa() and s.user_id = auth.uid() and s.role = 'owner' and s.active
$$;
create or replace function app.my_customer_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.customers c where c.user_id = auth.uid() and c.status <> 'archived'
$$;
grant execute on function app.my_owned_kitchens(), app.my_customer_ids() to authenticated;   -- answer only about the caller

do $$
declare r record; v_col text; v_n int := 0;
begin
  for r in select tablename, policyname, qual from pg_policies
           where schemaname = 'public' and cmd = 'SELECT'
             and qual ~ '^app\.can_read_customer_row\(kitchen_id, [a-z_]+\)$'
  loop
    v_col := substring(r.qual from '^app\.can_read_customer_row\(kitchen_id, ([a-z_]+)\)$');
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I for select to authenticated using ('
                   'kitchen_id = any (array(select app.my_owned_kitchens())) '
                   'or %I = any (array(select app.my_customer_ids())))', r.policyname, r.tablename, v_col);
    v_n := v_n + 1;
  end loop;
  if v_n < 15 then raise exception 'expected to rewrite at least 15 policies, rewrote %', v_n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 15. Right to erasure (PLAN 13.2 #16, DPDP Act; Google Play requires a way to
--     ask for account deletion). The owner erases a customer's PERSONAL data;
--     money records stay (amounts/dates, now under "Deleted customer") because
--     accounts must be kept. Files (voice notes, payment screenshots, delivery
--     photos) are removed by the daily media clean-up.
--     The audit log no longer copies customers' contact details at all, so an
--     erased person leaves no copy in the permanent log.
-- ---------------------------------------------------------------------------
drop trigger customers_audit on public.customers;
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function app.audit_row('true', 'full_name', 'phone', 'email', 'food_notes', 'default_location_text');

alter table public.customers add column erased_at timestamptz;

create or replace function public.owner_erase_customer(p_customer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_step_up(c.kitchen_id);
  if c.erased_at is not null then return; end if;
  if c.status <> 'archived' then raise exception 'ARCHIVE_FIRST' using errcode = 'P0001'; end if;

  if c.user_id is not null then
    delete from public.devices where user_id = c.user_id;
    delete from public.notifications where user_id = c.user_id and kitchen_id = c.kitchen_id;
    delete from public.notification_prefs where user_id = c.user_id;
  end if;
  delete from public.customer_saved_locations where customer_id = c.id;
  update public.invites set revoked_at = coalesce(revoked_at, app.now()) where customer_id = c.id and used_at is null;
  update public.chat_messages set body = '(deleted)', voice_path = null, voice_seconds = null where customer_id = c.id;
  update public.orders set location_text = null where customer_id = c.id and location_text is not null;
  update public.referral_requests set friend_name = 'Deleted', friend_phone = '0000000', note = null
   where referrer_customer_id = c.id;
  update public.customers set
    full_name = 'Deleted customer', phone = null, email = null, food_notes = null,
    default_location_text = null, default_location_node_id = null, user_id = null, erased_at = app.now()
  where id = c.id;
end $$;
revoke execute on function public.owner_erase_customer(uuid) from public, anon;
grant execute on function public.owner_erase_customer(uuid) to authenticated;

-- The daily media clean-up also removes every file of an erased customer.
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
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end $$;
