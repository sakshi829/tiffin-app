-- =============================================================================
-- 1500 BILLING (Phase 5a): kitchen contact phone, late-payment fees (decision 11),
-- due reminders, low-advance alerts, "bills for the whole month".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings: kitchen phone for customers; the date late fees were switched on
-- (fees only ever apply to bills made AFTER that date, never retroactively).
-- ---------------------------------------------------------------------------
alter table public.business_settings
  add column contact_phone text check (contact_phone ~ '^[0-9+ \-]{7,20}$'),
  add column late_fee_since date;

-- Same server clock as every other time rule (fee eligibility compares these dates).
alter table public.bills alter column generated_at set default app.now();

create or replace function public.owner_update_settings(p_kitchen uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  allowed constant text[] := array['display_name','upi_id','upi_qr_path','signup_mode','free_late_skips_per_month',
    'late_skip_charge_percent','late_fee_enabled','late_fee_grace_days','late_fee_type','late_fee_value',
    'low_balance_threshold_paise','media_retention_days','order_horizon_days','contact_phone'];
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
    late_fee_since              = case when p ? 'late_fee_enabled' and (p ->> 'late_fee_enabled')::boolean and not b.late_fee_enabled
                                       then app.today()
                                       when p ? 'late_fee_enabled' and not (p ->> 'late_fee_enabled')::boolean then null
                                       else b.late_fee_since end,
    late_fee_grace_days         = case when p ? 'late_fee_grace_days' then (p ->> 'late_fee_grace_days')::int else b.late_fee_grace_days end,
    late_fee_type               = case when p ? 'late_fee_type' then p ->> 'late_fee_type' else b.late_fee_type end,
    late_fee_value              = case when p ? 'late_fee_value' then (p ->> 'late_fee_value')::int else b.late_fee_value end,
    low_balance_threshold_paise = case when p ? 'low_balance_threshold_paise' then (p ->> 'low_balance_threshold_paise')::bigint else b.low_balance_threshold_paise end,
    media_retention_days        = case when p ? 'media_retention_days' then (p ->> 'media_retention_days')::int else b.media_retention_days end,
    order_horizon_days          = case when p ? 'order_horizon_days' then (p ->> 'order_horizon_days')::int else b.order_horizon_days end,
    contact_phone               = case when p ? 'contact_phone' then nullif(btrim(p ->> 'contact_phone'), '') else b.contact_phone end
  where b.kitchen_id = p_kitchen;
end $$;

-- ---------------------------------------------------------------------------
-- New alert kinds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'meal_delivered','late_skip','closure','closure_cancelled','location_reminder','location_changed',
  'route_ready','payment_submitted','payment_confirmed','payment_rejected','bill_ready',
  'daily_summary','announcement',
  'due_reminder','late_fee','low_balance','chat_message','referral_request','referral_decision'));

create or replace function app.mutable_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['location_reminder','meal_delivered','route_ready','location_changed','late_skip','daily_summary',
               'payment_submitted','low_balance','chat_message','referral_request']
$$;

-- ---------------------------------------------------------------------------
-- Late fees: at most ONE per bill, recorded in the ledger like any charge.
-- ---------------------------------------------------------------------------
create table public.bill_late_fees (
  bill_id          uuid primary key references public.bills(id),
  kitchen_id       uuid not null,
  customer_id      uuid not null,
  ledger_entry_id  uuid not null references public.ledger_entries(id),
  amount_paise     bigint not null check (amount_paise > 0),
  created_at       timestamptz not null default app.now(),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id)
);
create trigger bill_late_fees_immutable before update or delete on public.bill_late_fees
  for each row execute function app.forbid_mutation();
alter table public.bill_late_fees enable row level security;
grant select on public.bill_late_fees to authenticated;
create policy read_own on public.bill_late_fees for select to authenticated
  using (app.can_read_customer_row(kitchen_id, customer_id));

-- What is still unpaid from a bill: payments made since lower today's balance.
create or replace function app.bill_outstanding(p_bill uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select greatest(0, least(b.closing_balance_paise, app.customer_balance(b.customer_id)))::bigint
  from public.bills b where b.id = p_bill
$$;

create or replace function app.run_billing_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_out bigint; v_fee bigint; v_entry uuid; v_value int;
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

  -- 2. Late fee, once, the day after the due date, only if enabled before the bill was made.
  for r in
    select b.*, c.user_id, c.late_fee_mode, c.late_fee_custom_value, s.late_fee_type, s.late_fee_value
    from public.bills b
    join public.customers c on c.id = b.customer_id
    join public.business_settings s on s.kitchen_id = b.kitchen_id
    where b.due_date < app.today()
      and s.late_fee_enabled and s.late_fee_since is not null and b.generated_at::date >= s.late_fee_since
      and c.late_fee_mode <> 'exempt' and c.status <> 'archived'
      and not exists (select 1 from public.bill_late_fees f where f.bill_id = b.id)
  loop
    v_out := app.bill_outstanding(r.id);
    continue when v_out <= 0;
    v_value := case when r.late_fee_mode = 'custom' then r.late_fee_custom_value else r.late_fee_value end;
    v_fee := case when r.late_fee_type = 'percent' then round(v_out * v_value / 100.0) else v_value end;
    continue when coalesce(v_fee, 0) <= 0;
    insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, note)
    values (r.kitchen_id, r.customer_id, app.today(), 'late_fee', v_fee, 'Late fee for bill ' || r.bill_no)
    returning id into v_entry;
    insert into public.bill_late_fees (bill_id, kitchen_id, customer_id, ledger_entry_id, amount_paise)
    values (r.id, r.kitchen_id, r.customer_id, v_entry, v_fee);
    perform app.notify(r.kitchen_id, r.user_id, 'late_fee', 'Late fee added',
      app.rupees(v_fee) || ' late fee added: bill ' || r.bill_no || ' was due ' || to_char(r.due_date, 'DD Mon') || '.',
      jsonb_build_object('bill_id', r.id), 'latefee:' || r.id);
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
-- Owner: bills for everyone for one finished month (skips existing ones).
-- ---------------------------------------------------------------------------
create or replace function public.owner_generate_month_bills(p_kitchen uuid, p_month date) returns int
language plpgsql security definer set search_path = '' as $$
declare v_from date := date_trunc('month', p_month)::date; v_to date; r record; v int := 0;
begin
  perform app.require_owner(p_kitchen);
  if p_month is null then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;
  v_to := (v_from + interval '1 month' - interval '1 day')::date;
  if v_to >= app.today() then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;   -- month must be over
  for r in
    select c.id from public.customers c
    where c.kitchen_id = p_kitchen and c.status <> 'archived'
      and not exists (select 1 from public.bills b where b.customer_id = c.id and b.period_start = v_from and b.period_end = v_to)
      and (exists (select 1 from public.ledger_entries e where e.customer_id = c.id and e.entry_date between v_from and v_to)
           or app.customer_balance(c.id) <> 0)
    order by c.full_name
  loop
    perform public.owner_generate_bill(r.id, v_from, v_to, null);
    v := v + 1;
  end loop;
  return v;
end $$;

grant execute on function public.owner_generate_month_bills(uuid, date) to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    -- 10:00 IST daily
    perform cron.schedule('billing-jobs', '30 4 * * *', 'select app.run_billing_jobs()');
  end if;
end $$;
