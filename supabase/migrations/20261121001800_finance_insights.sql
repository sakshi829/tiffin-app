-- =============================================================================
-- 1800 PHASE 6: expenses extras (receipts, recurring, budgets), ingredients &
-- shopping list, waste, reports (P&L, trends, attendance), insights, loyalty.
-- All owner-only. Expenses/categories tables exist since 0500.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Receipts bucket (owner only): <kitchen>/<uuid>.(jpg|jpeg|png|webp)
-- ---------------------------------------------------------------------------
create or replace function app.media_kind_ok(p_bucket text, p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_bucket
    when 'kitchen-media'   then p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$'
    when 'receipts'        then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    when 'delivery-proofs' then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    when 'payment-proofs'  then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    when 'voice-notes'     then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(m4a|webm)$'
    else false end
$$;

create or replace function app.can_read_media(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.media_kind_ok(p_bucket, p_name) and case p_bucket
    when 'kitchen-media' then app.is_member(app.try_uuid(split_part(p_name, '/', 1)))
    when 'receipts'      then app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
    else app.can_read_customer_row(app.try_uuid(split_part(p_name, '/', 1)), app.try_uuid(split_part(p_name, '/', 2)))
  end
$$;

create or replace function app.can_write_media(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.media_kind_ok(p_bucket, p_name) and case p_bucket
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

alter table public.expenses add constraint receipt_in_kitchen
  check (receipt_path is null or (app.media_kind_ok('receipts', receipt_path) and split_part(receipt_path, '/', 1) = kitchen_id::text));

-- ---------------------------------------------------------------------------
-- Staff tasks also return the directions photo of the delivery spot (F31).
-- Same function as 0700 plus one column at the end; return type changes, so drop + create.
-- ---------------------------------------------------------------------------
drop function public.staff_my_tasks(uuid, date, text);
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
  location_updated_at  timestamptz,
  location_photo_path  text          -- phase 6: photo of the way in (kitchen-media; staff may read it)
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
    o.location_updated_at,
    ln.directions_photo_path
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
grant execute on function public.staff_my_tasks(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- New alert kinds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'meal_delivered','late_skip','closure','closure_cancelled','location_reminder','location_changed',
  'route_ready','payment_submitted','payment_confirmed','payment_rejected','bill_ready',
  'daily_summary','announcement','due_reminder','late_fee','low_balance','chat_message','referral_request','referral_decision',
  'expense_due','loyalty_reward'));

create or replace function app.mutable_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['location_reminder','meal_delivered','route_ready','location_changed','late_skip','daily_summary',
               'payment_submitted','low_balance','chat_message','referral_request','expense_due','loyalty_reward']
$$;

-- ---------------------------------------------------------------------------
-- Tables (owner configuration; owner writes directly, column-limited, RLS)
-- ---------------------------------------------------------------------------
create table public.recurring_expenses (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references public.kitchens(id),
  title         text not null check (char_length(btrim(title)) between 1 and 80),
  category_id   uuid not null,
  kind          text not null default 'running' check (kind in ('running','investment')),
  amount_paise  bigint not null check (amount_paise between 1 and 100000000),
  vendor        text check (char_length(vendor) <= 100),
  method        text not null default 'cash' check (method in ('cash','upi','bank','card','other')),
  every         text not null check (every in ('weekly','monthly')),
  next_due      date not null,
  active        boolean not null default true,
  created_at    timestamptz not null default app.now(),
  foreign key (category_id, kitchen_id) references public.expense_categories (id, kitchen_id)
);

create table public.budgets (
  kitchen_id    uuid not null references public.kitchens(id),
  category_id   uuid not null,
  amount_paise  bigint not null check (amount_paise between 1 and 100000000),   -- per month
  primary key (kitchen_id, category_id),
  foreign key (category_id, kitchen_id) references public.expense_categories (id, kitchen_id)
);

create table public.ingredients (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references public.kitchens(id),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  unit        text not null check (unit in ('kg','g','l','ml','pcs')),
  active      boolean not null default true,
  unique (id, kitchen_id)
);
create unique index ingredients_name_uniq on public.ingredients (kitchen_id, lower(btrim(name)));

create table public.item_ingredients (
  kitchen_id     uuid not null,
  item_id        uuid not null,
  ingredient_id  uuid not null,
  qty            numeric(10,3) not null check (qty > 0 and qty <= 10000),   -- per ONE item (e.g. 0.03 kg atta per roti)
  primary key (item_id, ingredient_id),
  foreign key (item_id, kitchen_id) references public.items (id, kitchen_id) on delete cascade,
  foreign key (ingredient_id, kitchen_id) references public.ingredients (id, kitchen_id)
);

create table public.waste_entries (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references public.kitchens(id),
  entry_date  date not null,
  meal_slot   text not null check (meal_slot in ('lunch','dinner')),
  tiffins     int not null check (tiffins between 1 and 1000),
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default app.now()
);

create table public.loyalty_rules (
  kitchen_id     uuid primary key references public.kitchens(id),
  active         boolean not null default false,          -- off by default (decision 21)
  every_n_meals  int not null default 30 check (every_n_meals between 5 and 500),
  reward_paise   bigint not null default 2000 check (reward_paise between 100 and 100000),
  reward_label   text not null default 'free salad' check (char_length(reward_label) between 1 and 60)
);

create table public.loyalty_rewards (
  customer_id      uuid not null,
  milestone        int not null,
  kitchen_id       uuid not null,
  ledger_entry_id  uuid not null references public.ledger_entries(id),
  created_at       timestamptz not null default app.now(),
  primary key (customer_id, milestone),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id)
);

do $$
declare t text;
begin
  foreach t in array array['recurring_expenses','budgets','ingredients','item_ingredients','waste_entries','loyalty_rules','loyalty_rewards'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy read_owner on public.%I for select to authenticated using (app.is_owner(kitchen_id))', t);
  end loop;
  foreach t in array array['recurring_expenses','budgets','ingredients','item_ingredients','waste_entries'] loop
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (app.is_owner(kitchen_id))', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (app.is_owner(kitchen_id)) with check (app.is_owner(kitchen_id))', t);
  end loop;
  foreach t in array array['budgets','item_ingredients','waste_entries'] loop
    execute format('create policy owner_delete on public.%I for delete to authenticated using (app.is_owner(kitchen_id))', t);
  end loop;
end $$;
-- customers can see their own loyalty rewards
create policy read_own on public.loyalty_rewards for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));

grant insert (kitchen_id, title, category_id, kind, amount_paise, vendor, method, every, next_due, active) on public.recurring_expenses to authenticated;
grant update (title, category_id, kind, amount_paise, vendor, method, every, next_due, active) on public.recurring_expenses to authenticated;
grant insert (kitchen_id, category_id, amount_paise) on public.budgets to authenticated;
grant update (amount_paise) on public.budgets to authenticated;
grant delete on public.budgets to authenticated;
grant insert (kitchen_id, name, unit, active) on public.ingredients to authenticated;
grant update (name, unit, active) on public.ingredients to authenticated;
grant insert (kitchen_id, item_id, ingredient_id, qty) on public.item_ingredients to authenticated;
grant update (qty) on public.item_ingredients to authenticated;
grant delete on public.item_ingredients to authenticated;
grant insert (kitchen_id, entry_date, meal_slot, tiffins, note) on public.waste_entries to authenticated;
grant delete on public.waste_entries to authenticated;

create trigger recurring_expenses_audit after insert or update on public.recurring_expenses for each row execute function app.audit_row('true');
create trigger budgets_audit after insert or update or delete on public.budgets for each row execute function app.audit_row('true');
create trigger loyalty_rules_audit after insert or update on public.loyalty_rules for each row execute function app.audit_row('true');
create trigger loyalty_rewards_immutable before update or delete on public.loyalty_rewards for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Recurring expenses: reminder when due; one tap records it and moves next_due.
-- ---------------------------------------------------------------------------
create or replace function public.owner_record_recurring(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.recurring_expenses; v_id uuid; v_next date; i int := 0;
begin
  select * into r from public.recurring_expenses where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(r.kitchen_id);
  if not r.active then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  insert into public.expenses (kitchen_id, expense_date, category_id, kind, amount_paise, vendor, method, note, created_by)
  values (r.kitchen_id, app.today(), r.category_id, r.kind, r.amount_paise, r.vendor, r.method, r.title, auth.uid())
  returning id into v_id;
  -- Keep the usual due day (rent on the 5th stays on the 5th), skipping periods already past.
  v_next := r.next_due;
  loop
    i := i + 1;
    v_next := case when r.every = 'weekly' then v_next + 7 else (r.next_due + make_interval(months => i))::date end;
    exit when v_next > app.today() or i > 2000;
  end loop;
  update public.recurring_expenses set next_due = v_next where id = r.id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Loyalty: every N delivered meals -> credit (discount) once per milestone.
-- Rules change money on bills, so they are set only through this function,
-- which needs a fresh authenticator code (like prices and settings).
-- ---------------------------------------------------------------------------
create or replace function public.owner_set_loyalty(p_kitchen uuid, p_active boolean, p_every_n_meals int, p_reward_paise bigint, p_reward_label text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_label text := app.clean_text(p_reward_label, 60);
begin
  perform app.require_step_up(p_kitchen);
  if p_active is null or p_every_n_meals is null or p_every_n_meals not between 5 and 500 or v_label is null then
    raise exception 'INVALID_SETTING' using errcode = 'P0001';
  end if;
  if p_reward_paise is null or p_reward_paise not between 100 and 100000 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  insert into public.loyalty_rules (kitchen_id, active, every_n_meals, reward_paise, reward_label)
  values (p_kitchen, p_active, p_every_n_meals, p_reward_paise, v_label)
  on conflict (kitchen_id) do update set active = excluded.active, every_n_meals = excluded.every_n_meals,
    reward_paise = excluded.reward_paise, reward_label = excluded.reward_label;
end $$;

create or replace function app.loyalty_on_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lr public.loyalty_rules; c public.customers; v_count int; v_milestone int; v_entry uuid;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into lr from public.loyalty_rules where kitchen_id = new.kitchen_id;
  if lr.kitchen_id is null or not lr.active then return new; end if;
  select count(*) into v_count from public.orders where customer_id = new.customer_id and status = 'delivered';
  if v_count = 0 or v_count % lr.every_n_meals <> 0 then return new; end if;
  v_milestone := v_count;
  if exists (select 1 from public.loyalty_rewards where customer_id = new.customer_id and milestone = v_milestone) then return new; end if;
  insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, order_id, note)
  values (new.kitchen_id, new.customer_id, app.today(), 'discount', -lr.reward_paise, new.id,
          'Loyalty reward: ' || v_milestone || ' meals (' || lr.reward_label || ')')
  returning id into v_entry;
  insert into public.loyalty_rewards (customer_id, milestone, kitchen_id, ledger_entry_id) values (new.customer_id, v_milestone, new.kitchen_id, v_entry);
  select * into c from public.customers where id = new.customer_id;
  perform app.notify(new.kitchen_id, c.user_id, 'loyalty_reward', 'Thank you for ' || v_milestone || ' meals!',
    'You get a ' || lr.reward_label || ' on us: ' || app.rupees(lr.reward_paise) || ' taken off your bill.', '{}'::jsonb,
    'loyalty:' || new.customer_id || ':' || v_milestone);
  return new;
end $$;
create trigger orders_loyalty after update of status on public.orders
  for each row when (new.status = 'delivered' and old.status is distinct from 'delivered') execute function app.loyalty_on_delivery();

-- ---------------------------------------------------------------------------
-- Prep / shopping list for one day: items and ingredients to cook.
-- ---------------------------------------------------------------------------
create or replace function public.owner_prep_totals(p_kitchen uuid, p_date date)
returns table (kind text, name text, unit text, qty numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  return query
  with cooked as (
    select o.id, o.tiffin_type_id from public.orders o
    where o.kitchen_id = p_kitchen and o.order_date = p_date and o.status in ('scheduled','delivered')
  ), item_qty as (
    select ti.item_id, sum(ti.qty)::numeric as q
      from cooked c join public.tiffin_type_items ti on ti.tiffin_type_id = c.tiffin_type_id group by ti.item_id
    union all
    select a.item_id, sum(a.qty)::numeric
      from cooked c join public.order_addons a on a.order_id = c.id and a.status = 'accepted' group by a.item_id
  ), items as (
    select item_id, sum(q) as q from item_qty group by item_id
  )
  select 'item'::text, it.name, it.unit, i.q
    from items i join public.items it on it.id = i.item_id
  union all
  select 'ingredient'::text, g.name, g.unit, round(sum(i.q * ii.qty), 3)
    from items i join public.item_ingredients ii on ii.item_id = i.item_id
    join public.ingredients g on g.id = ii.ingredient_id
   group by g.name, g.unit
  order by 1, 2;
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create or replace function app.billed(p_kitchen uuid, p_from date, p_to date) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_paise), 0)::bigint from public.ledger_entries
  where kitchen_id = p_kitchen and entry_date between p_from and p_to and kind <> 'payment'
$$;
create or replace function app.spent(p_kitchen uuid, p_from date, p_to date, p_kind text) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount_paise), 0)::bigint from public.expenses
  where kitchen_id = p_kitchen and archived_at is null and kind = p_kind and expense_date between p_from and p_to
$$;
create or replace function app.meals_delivered(p_kitchen uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.orders where kitchen_id = p_kitchen and status = 'delivered' and order_date between p_from and p_to
$$;

create or replace function public.owner_profit_loss(p_kitchen uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_billed bigint; v_received bigint; v_running bigint; v_invest bigint; v_meals int;
  v_inv_all bigint; v_profit_all bigint; v_first date;
begin
  perform app.require_owner(p_kitchen);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;
  v_billed := app.billed(p_kitchen, p_from, p_to);
  select coalesce(-sum(amount_paise), 0) into v_received from public.ledger_entries
   where kitchen_id = p_kitchen and kind = 'payment' and entry_date between p_from and p_to;
  v_running := app.spent(p_kitchen, p_from, p_to, 'running');
  v_invest := app.spent(p_kitchen, p_from, p_to, 'investment');
  v_meals := app.meals_delivered(p_kitchen, p_from, p_to);
  select min(expense_date) into v_first from public.expenses where kitchen_id = p_kitchen and kind = 'investment' and archived_at is null;
  v_inv_all := app.spent(p_kitchen, '2000-01-01', app.today(), 'investment');
  v_profit_all := case when v_first is null then 0
                       else app.billed(p_kitchen, v_first, app.today()) - app.spent(p_kitchen, v_first, app.today(), 'running') end;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'billed_paise', v_billed, 'received_paise', v_received,
    'running_expenses_paise', v_running, 'investments_paise', v_invest,
    'profit_paise', v_billed - v_running,
    'meals_delivered', v_meals,
    'cost_per_meal_paise', case when v_meals > 0 then round(v_running::numeric / v_meals) end,
    'billed_per_meal_paise', case when v_meals > 0 then round(v_billed::numeric / v_meals) end,
    'waste_tiffins', (select coalesce(sum(tiffins), 0) from public.waste_entries where kitchen_id = p_kitchen and entry_date between p_from and p_to),
    'investments_all_time_paise', v_inv_all,
    'profit_since_first_investment_paise', v_profit_all,
    'payback_percent', case when v_inv_all > 0 then least(100, greatest(0, round(v_profit_all * 100.0 / v_inv_all))) end,
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'kind', x.kind, 'amount_paise', x.amt, 'budget_paise', x.budget) order by x.amt desc)
      from (select ec.name, e.kind, sum(e.amount_paise)::bigint as amt, b.amount_paise as budget
            from public.expenses e join public.expense_categories ec on ec.id = e.category_id
            left join public.budgets b on b.kitchen_id = e.kitchen_id and b.category_id = e.category_id
            where e.kitchen_id = p_kitchen and e.archived_at is null and e.expense_date between p_from and p_to
            group by ec.name, e.kind, b.amount_paise) x), '[]'::jsonb),
    'by_tiffin_type', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'meals', x.meals, 'billed_paise', x.amt) order by x.amt desc)
      from (select tt.name, count(*)::int as meals, sum(le.amount_paise)::bigint as amt
            from public.ledger_entries le join public.orders o on o.id = le.order_id
            join public.tiffin_types tt on tt.id = o.tiffin_type_id
            where le.kitchen_id = p_kitchen and le.kind = 'meal' and le.entry_date between p_from and p_to
            group by tt.name) x), '[]'::jsonb));
end $$;

create or replace function public.owner_daily_series(p_kitchen uuid, p_from date, p_to date)
returns table (day date, meals int, billed_paise bigint, expenses_paise bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;
  return query
  select d::date,
         (select count(*)::int from public.orders o where o.kitchen_id = p_kitchen and o.order_date = d::date and o.status = 'delivered'),
         app.billed(p_kitchen, d::date, d::date),
         (select coalesce(sum(e.amount_paise), 0)::bigint from public.expenses e
           where e.kitchen_id = p_kitchen and e.archived_at is null and e.expense_date = d::date)
  from generate_series(p_from, p_to, interval '1 day') d
  order by 1;
end $$;

create or replace function public.owner_attendance(p_kitchen uuid, p_from date, p_to date)
returns table (staff_id uuid, display_name text, shifts int, minutes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  return query
  select s.id, s.display_name, count(sh.id)::int,
         coalesce(sum(extract(epoch from (coalesce(sh.ended_at, app.now()) - sh.started_at)) / 60), 0)::int
  from public.staff_members s
  left join public.staff_shifts sh on sh.staff_id = s.id
       and (sh.started_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  where s.kitchen_id = p_kitchen and s.role <> 'owner'
  group by s.id, s.display_name
  order by 2;
end $$;

-- ---------------------------------------------------------------------------
-- Insights: simple rules with the numbers shown (PLAN.md section 11).
-- Compares this month so far with the SAME number of days of last month.
-- ---------------------------------------------------------------------------
create or replace function public.owner_insights(p_kitchen uuid)
returns table (severity text, title text, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app.today();
  m0 date := date_trunc('month', app.today())::date;
  v_days int := (app.today() - date_trunc('month', app.today())::date) + 1;
  p0 date := (date_trunc('month', app.today()) - interval '1 month')::date;
  p1 date;
  v_meals_now int; v_meals_prev int; v_run_now bigint; v_run_prev bigint;
  r record; v_txt text; v_n int; v_sum bigint; v_pl jsonb;
begin
  perform app.require_owner(p_kitchen);
  p1 := least(p0 + v_days - 1, (m0 - 1));
  v_meals_now := app.meals_delivered(p_kitchen, m0, v_today);
  v_meals_prev := app.meals_delivered(p_kitchen, p0, p1);
  v_run_now := app.spent(p_kitchen, m0, v_today, 'running');
  v_run_prev := app.spent(p_kitchen, p0, p1, 'running');

  -- 1. A spending category growing much faster than meals.
  for r in
    select ec.name,
           coalesce(sum(e.amount_paise) filter (where e.expense_date between m0 and v_today), 0)::bigint as now_amt,
           coalesce(sum(e.amount_paise) filter (where e.expense_date between p0 and p1), 0)::bigint as prev_amt
    from public.expense_categories ec left join public.expenses e on e.category_id = ec.id and e.archived_at is null and e.kind = 'running'
    where ec.kitchen_id = p_kitchen group by ec.name
  loop
    continue when r.prev_amt < 50000 or r.now_amt < r.prev_amt * 1.15;
    if (r.now_amt::numeric / r.prev_amt - 1) - (case when v_meals_prev > 0 then v_meals_now::numeric / v_meals_prev - 1 else 0 end) >= 0.10 then
      severity := 'warn';
      title := r.name || ' spending up ' || round((r.now_amt::numeric / r.prev_amt - 1) * 100) || '%';
      detail := app.rupees(r.now_amt) || ' so far this month vs ' || app.rupees(r.prev_amt) || ' in the same days last month, while meals changed '
                || coalesce(round((v_meals_now::numeric / nullif(v_meals_prev, 0) - 1) * 100) || '%', 'n/a') || '. Check prices or quantities.';
      return next;
    end if;
  end loop;

  -- 2. Cost per meal rising.
  if v_meals_now >= 20 and v_meals_prev >= 20 and v_run_prev > 0
     and (v_run_now::numeric / v_meals_now) >= (v_run_prev::numeric / v_meals_prev) * 1.10 then
    severity := 'warn'; title := 'Cost per meal is rising';
    detail := app.rupees(round(v_run_now::numeric / v_meals_now)::bigint) || ' per meal this month vs '
              || app.rupees(round(v_run_prev::numeric / v_meals_prev)::bigint) || ' last month.';
    return next;
  end if;

  -- 3. Weekday + meal with many skips (last 8 weeks).
  for r in
    select extract(isodow from o.order_date)::int as dow, o.meal_slot,
           count(*) filter (where o.status in ('skipped','skipped_late')) as skipped,
           count(*) as total, count(distinct o.order_date) as days
    from public.orders o
    where o.kitchen_id = p_kitchen and o.order_date between v_today - 56 and v_today - 1 and o.status <> 'cancelled_closure'
    group by 1, 2
  loop
    continue when r.total < 10 or r.skipped::numeric / r.total < 0.20;
    severity := 'info';
    title := trim(to_char(date '2024-01-01' + (r.dow - 1), 'Day')) || ' ' || r.meal_slot || ': ' || round(r.skipped * 100.0 / r.total) || '% skipped';
    v_n := greatest(1, round(r.skipped::numeric / greatest(r.days, 1)))::int;
    detail := 'About ' || v_n || ' fewer tiffin' || case when v_n = 1 then ' is' else 's are' end || ' needed on a typical '
              || trim(to_char(date '2024-01-01' + (r.dow - 1), 'Day')) || '. Consider cooking a little less.';
    return next;
  end loop;

  -- 4. Waste.
  select coalesce(sum(tiffins), 0) into v_n from public.waste_entries where kitchen_id = p_kitchen and entry_date between v_today - 30 and v_today;
  if app.meals_delivered(p_kitchen, v_today - 30, v_today) >= 20 and v_n::numeric / app.meals_delivered(p_kitchen, v_today - 30, v_today) >= 0.05 then
    severity := 'info'; title := 'Extra food: ' || round(v_n * 100.0 / app.meals_delivered(p_kitchen, v_today - 30, v_today)) || '% of meals';
    detail := v_n || ' tiffins were left over in the last 30 days. Cooking slightly less saves money.';
    return next;
  end if;

  -- 5. Old dues: money owed, billed 30+ days ago, and no confirmed payment in the last 30 days.
  select count(*), coalesce(sum(b.bal), 0), string_agg(b.full_name, ', ' order by b.bal desc)
    into v_n, v_sum, v_txt
  from (select c.full_name, app.customer_balance(c.id) as bal
        from public.customers c
        where c.kitchen_id = p_kitchen and c.status <> 'archived'
          and exists (select 1 from public.ledger_entries le where le.customer_id = c.id and le.kind <> 'payment' and le.entry_date <= v_today - 30)
          and not exists (select 1 from public.payments p where p.customer_id = c.id and p.status = 'confirmed' and p.paid_on > v_today - 30)
       ) b
  where b.bal > 0;
  if v_n > 0 then
    severity := 'warn'; title := v_n || ' customer' || case when v_n = 1 then '' else 's' end || ' with no payment for 30+ days';
    detail := app.rupees(v_sum) || ' due in total: ' || left(v_txt, 200) || '.';
    return next;
  end if;

  -- 6. Budgets exceeded this month.
  for r in
    select ec.name, b.amount_paise as budget, coalesce(sum(e.amount_paise), 0)::bigint as spent
    from public.budgets b join public.expense_categories ec on ec.id = b.category_id
    left join public.expenses e on e.category_id = b.category_id and e.archived_at is null and e.expense_date between m0 and v_today
    where b.kitchen_id = p_kitchen group by ec.name, b.amount_paise
  loop
    continue when r.spent <= r.budget;
    severity := 'warn'; title := r.name || ' is over budget';
    detail := app.rupees(r.spent) || ' spent of ' || app.rupees(r.budget) || ' this month.';
    return next;
  end loop;

  -- 7. Boxes out for 5+ days.
  select count(*) into v_n from app.boxes_out(p_kitchen, null, 30) b where b.days_out >= 5;
  if v_n > 0 then
    severity := 'info'; title := v_n || ' box' || case when v_n = 1 then '' else 'es' end || ' out for 5+ days';
    detail := 'See More › Boxes not back.';
    return next;
  end if;

  -- 8. Customers ordering much less than before (possible churn).
  select count(*), string_agg(x.full_name, ', ') into v_n, v_txt
  from (select c.full_name,
               (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'delivered' and o.order_date between v_today - 28 and v_today - 15) as before,
               (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'delivered' and o.order_date between v_today - 14 and v_today - 1) as recent
        from public.customers c where c.kitchen_id = p_kitchen and c.status = 'active') x
  where x.before >= 6 and x.recent * 2 <= x.before;
  if v_n > 0 then
    severity := 'info'; title := v_n || ' customer' || case when v_n = 1 then '' else 's' end || ' ordering much less';
    detail := 'Fewer meals in the last 2 weeks: ' || left(v_txt, 200) || '. A friendly message may help.';
    return next;
  end if;

  -- 9. Investment payback.
  select public.owner_profit_loss(p_kitchen, m0, v_today) into v_pl;
  v_sum := (v_pl ->> 'investments_all_time_paise')::bigint;
  if v_sum > 0 then
    severity := 'info'; title := coalesce((v_pl ->> 'payback_percent')::int, 0) || '% of your investments recovered';
    detail := 'Investments so far: ' || app.rupees(v_sum) || '. Profit since the first one: '
              || app.rupees((v_pl ->> 'profit_since_first_investment_paise')::bigint) || '.';
    return next;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Daily job: recurring expense reminders.
-- ---------------------------------------------------------------------------
create or replace function app.run_finance_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select * from public.recurring_expenses where active and next_due <= app.today() loop
    perform app.notify_owners(r.kitchen_id, 'expense_due', r.title || ' is due',
      app.rupees(r.amount_paise) || ' · tap Money › Expenses to record it.', jsonb_build_object('recurring_id', r.id),
      'expdue:' || r.id || ':' || r.next_due);
  end loop;
end $$;

grant execute on function
  public.owner_record_recurring(uuid), public.owner_set_loyalty(uuid, boolean, int, bigint, text), public.owner_prep_totals(uuid, date), public.owner_profit_loss(uuid, date, date),
  public.owner_daily_series(uuid, date, date), public.owner_attendance(uuid, date, date), public.owner_insights(uuid)
to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    perform cron.schedule('finance-jobs', '0 3 * * *', 'select app.run_finance_jobs()');   -- 08:30 IST
  end if;
end $$;
