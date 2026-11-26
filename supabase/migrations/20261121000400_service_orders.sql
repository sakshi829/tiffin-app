-- =============================================================================
-- 0400 SERVICE & ORDERS
-- Meal slots (timings + cutoffs set by the owner), one-day overrides, closures
-- (days off), subscriptions, customer skips, daily orders, add-ons, boxes.
-- All cutoffs are evaluated against the SERVER clock in Asia/Kolkata.
-- =============================================================================

alter table public.staff_members add constraint staff_members_id_kitchen unique (id, kitchen_id);

-- ---------------------------------------------------------------------------
-- Meal slots & cutoffs (decisions 4, 5, 6)
-- ---------------------------------------------------------------------------
create table public.meal_slots (
  id                        uuid primary key default gen_random_uuid(),
  kitchen_id                uuid not null references public.kitchens(id),
  meal_slot                 text not null check (meal_slot in ('lunch','dinner')),
  delivery_time             time not null,
  addon_cutoff_mode         text not null default 'relative' check (addon_cutoff_mode in ('relative','fixed')),
  addon_cutoff_minutes      int  not null default 150 check (addon_cutoff_minutes between 0 and 720),
  addon_cutoff_time         time,
  location_cutoff_mode      text not null default 'relative' check (location_cutoff_mode in ('relative','fixed')),
  location_cutoff_minutes   int  not null default 30 check (location_cutoff_minutes between 0 and 720),
  location_cutoff_time      time,
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  version                   int not null default 1,
  unique (kitchen_id, meal_slot),
  check (addon_cutoff_mode    <> 'fixed' or (addon_cutoff_time    is not null and addon_cutoff_time    <= delivery_time)),
  check (location_cutoff_mode <> 'fixed' or (location_cutoff_time is not null and location_cutoff_time <= delivery_time))
);

create table public.slot_overrides (
  kitchen_id            uuid not null references public.kitchens(id),
  override_date         date not null,
  meal_slot             text not null check (meal_slot in ('lunch','dinner')),
  delivery_time         time,
  addon_cutoff_time     time,
  location_cutoff_time  time,
  note                  text check (char_length(note) <= 200),
  updated_at            timestamptz not null default now(),
  primary key (kitchen_id, override_date, meal_slot),
  check (delivery_time is not null or addon_cutoff_time is not null or location_cutoff_time is not null)
);

-- Effective times for a (date, slot), honouring one-day overrides.
create or replace function app.slot_times(p_kitchen uuid, p_date date, p_slot text)
returns table (delivery_at timestamptz, addon_cutoff_at timestamptz, location_cutoff_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.meal_slots;
  o public.slot_overrides;
  v_delivery timestamptz;
begin
  select * into s from public.meal_slots m where m.kitchen_id = p_kitchen and m.meal_slot = p_slot;
  if not found then raise exception 'SLOT_NOT_CONFIGURED' using errcode = 'P0001'; end if;
  select * into o from public.slot_overrides x
   where x.kitchen_id = p_kitchen and x.override_date = p_date and x.meal_slot = p_slot;

  v_delivery := app.local_ts(p_date, coalesce(o.delivery_time, s.delivery_time));
  delivery_at := v_delivery;
  addon_cutoff_at := case
    when o.addon_cutoff_time is not null then app.local_ts(p_date, o.addon_cutoff_time)
    when s.addon_cutoff_mode = 'fixed'    then app.local_ts(p_date, s.addon_cutoff_time)
    else v_delivery - make_interval(mins => s.addon_cutoff_minutes) end;
  location_cutoff_at := case
    when o.location_cutoff_time is not null then app.local_ts(p_date, o.location_cutoff_time)
    when s.location_cutoff_mode = 'fixed'    then app.local_ts(p_date, s.location_cutoff_time)
    else v_delivery - make_interval(mins => s.location_cutoff_minutes) end;
  -- A cutoff can never be after delivery.
  addon_cutoff_at    := least(addon_cutoff_at, v_delivery);
  location_cutoff_at := least(location_cutoff_at, v_delivery);
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Closures (owner's days off). meal_slot null = whole day.
-- ---------------------------------------------------------------------------
create table public.closures (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references public.kitchens(id),
  closure_date  date not null,
  meal_slot     text check (meal_slot in ('lunch','dinner')),
  reason        text check (char_length(reason) <= 200),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  notified_at   timestamptz
);
create unique index closures_active_uniq
  on public.closures (kitchen_id, closure_date, coalesce(meal_slot, 'both')) where cancelled_at is null;

create or replace function app.closure_covers(p_kitchen uuid, p_date date, p_slot text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.closures c
    where c.kitchen_id = p_kitchen and c.closure_date = p_date and c.cancelled_at is null
      and (c.meal_slot is null or c.meal_slot = p_slot)
  )
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  kitchen_id                uuid not null,
  customer_id               uuid not null,
  meal_slot                 text not null check (meal_slot in ('lunch','dinner')),
  tiffin_type_id            uuid not null,
  start_date                date not null,
  end_date                  date,
  days_of_week              int[] not null default '{1,2,3,4,5,6,7}'   -- ISO: 1 = Monday ... 7 = Sunday
                              check (cardinality(days_of_week) between 1 and 7 and days_of_week <@ '{1,2,3,4,5,6,7}'::int[]),
  default_location_node_id  uuid,
  default_location_text     text check (char_length(default_location_text) <= 120),
  status                    text not null default 'active' check (status in ('active','paused','ended')),
  notes                     text check (char_length(notes) <= 300),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  version                   int not null default 1,
  unique (id, kitchen_id),
  foreign key (customer_id, kitchen_id)              references public.customers (id, kitchen_id),
  foreign key (tiffin_type_id, kitchen_id)           references public.tiffin_types (id, kitchen_id),
  foreign key (default_location_node_id, kitchen_id) references public.location_nodes (id, kitchen_id),
  check (end_date is null or end_date >= start_date)
);
create index subscriptions_customer on public.subscriptions (customer_id);

create table public.subscription_addons (
  kitchen_id       uuid not null,
  subscription_id  uuid not null,
  item_id          uuid not null,
  qty              int not null check (qty between 1 and 20),
  primary key (subscription_id, item_id),
  foreign key (subscription_id, kitchen_id) references public.subscriptions (id, kitchen_id) on delete cascade,
  foreign key (item_id, kitchen_id)         references public.items (id, kitchen_id)
);

-- Customer leave/pause ranges. meal_slot null = both.
create table public.customer_skips (
  id               uuid primary key default gen_random_uuid(),
  kitchen_id       uuid not null,
  customer_id      uuid not null,
  from_date        date not null,
  to_date          date not null,
  meal_slot        text check (meal_slot in ('lunch','dinner')),
  created_by_role  text not null check (created_by_role in ('customer','owner')),
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id),
  check (to_date >= from_date and to_date - from_date <= 92)
);
create index customer_skips_customer on public.customer_skips (customer_id, from_date);

create or replace function app.skip_covers(p_customer uuid, p_date date, p_slot text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customer_skips s
    where s.customer_id = p_customer and s.cancelled_at is null
      and p_date between s.from_date and s.to_date
      and (s.meal_slot is null or s.meal_slot = p_slot)
  )
$$;

-- ---------------------------------------------------------------------------
-- Orders (one row per customer per meal per day)
-- ---------------------------------------------------------------------------
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  kitchen_id             uuid not null,
  customer_id            uuid not null,
  subscription_id        uuid,
  order_date             date not null,
  meal_slot              text not null check (meal_slot in ('lunch','dinner')),
  tiffin_type_id         uuid not null,
  order_source           text not null default 'subscription'
                           check (order_source in ('subscription','one_off','special','swiggy','zomato')),
  status                 text not null default 'scheduled'
                           check (status in ('scheduled','delivered','not_delivered','skipped','skipped_late','cancelled_closure')),
  unit_price_paise       bigint not null check (unit_price_paise between 0 and 1000000),  -- snapshot
  location_node_id       uuid,
  location_text          text check (char_length(location_text) <= 120),
  location_updated_at    timestamptz,
  assigned_staff_id      uuid,
  delivered_at           timestamptz,
  delivered_by           uuid references auth.users(id),
  not_delivered_reason   text check (char_length(not_delivered_reason) <= 200),
  skipped_at             timestamptz,
  late_skip_charged      boolean not null default false,
  received_confirmed_at  timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int not null default 1,
  unique (id, kitchen_id),
  foreign key (customer_id, kitchen_id)       references public.customers (id, kitchen_id),
  foreign key (subscription_id, kitchen_id)   references public.subscriptions (id, kitchen_id),
  foreign key (tiffin_type_id, kitchen_id)    references public.tiffin_types (id, kitchen_id),
  foreign key (location_node_id, kitchen_id)  references public.location_nodes (id, kitchen_id),
  foreign key (assigned_staff_id, kitchen_id) references public.staff_members (id, kitchen_id),
  check (status <> 'delivered' or delivered_at is not null)
);
create unique index orders_subscription_day_uniq
  on public.orders (subscription_id, order_date, meal_slot) where subscription_id is not null;
create index orders_kitchen_day on public.orders (kitchen_id, order_date, meal_slot);
create index orders_customer_day on public.orders (customer_id, order_date);
create index orders_staff_day on public.orders (assigned_staff_id, order_date) where assigned_staff_id is not null;

create table public.order_addons (
  id                 uuid primary key default gen_random_uuid(),
  kitchen_id         uuid not null,
  order_id           uuid not null,
  item_id            uuid not null,
  qty                int not null check (qty between 1 and 20),
  unit_price_paise   bigint not null check (unit_price_paise between 0 and 1000000),  -- snapshot
  requested_by_role  text not null check (requested_by_role in ('customer','owner','subscription')),
  status             text not null default 'accepted' check (status in ('accepted','rejected','cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int not null default 1,
  unique (id, kitchen_id),
  foreign key (order_id, kitchen_id) references public.orders (id, kitchen_id) on delete cascade,
  foreign key (item_id, kitchen_id)  references public.items (id, kitchen_id)
);
create unique index order_addons_active_uniq on public.order_addons (order_id, item_id) where status = 'accepted';

-- ---------------------------------------------------------------------------
-- Boxes (QR stickers, decision 19) and box movements (append-only)
-- ---------------------------------------------------------------------------
create table public.boxes (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references public.kitchens(id),
  code        text not null check (code ~ '^[A-Z0-9\-]{2,20}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (kitchen_id, code),
  unique (id, kitchen_id)
);

create table public.box_movements (
  id               uuid primary key default gen_random_uuid(),
  kitchen_id       uuid not null,
  box_id           uuid,
  customer_id      uuid not null,
  order_id         uuid,
  kind             text not null check (kind in ('issued','kept_at','collected')),
  location_text    text check (char_length(location_text) <= 120),
  photo_path       text check (char_length(photo_path) <= 300),
  actor_user_id    uuid references auth.users(id),
  actor_role       text not null check (actor_role in ('customer','staff','owner')),
  idempotency_key  text check (char_length(idempotency_key) between 8 and 80),
  created_at       timestamptz not null default now(),
  foreign key (box_id, kitchen_id)      references public.boxes (id, kitchen_id),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id),
  foreign key (order_id, kitchen_id)    references public.orders (id, kitchen_id)
);
create unique index box_movements_idem on public.box_movements (kitchen_id, idempotency_key) where idempotency_key is not null;
create index box_movements_customer on public.box_movements (customer_id, created_at desc);

create trigger box_movements_immutable before update or delete on public.box_movements
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Order generation (subscriptions -> orders), idempotent.
-- Called by the nightly job and by owner functions.
-- ---------------------------------------------------------------------------
create or replace function app.generate_orders(p_kitchen uuid, p_from date, p_to date, p_subscription uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int := 0;
  r record;
  d date;
  v_order uuid;
  v_status text;
begin
  if p_from < app.today() then p_from := app.today(); end if;
  if p_to < p_from then return 0; end if;
  if p_to - p_from > 62 then raise exception 'INVALID_RANGE' using errcode = 'P0001'; end if;

  for r in
    select s.*, c.default_location_node_id as c_loc_node, c.default_location_text as c_loc_text
    from public.subscriptions s
    join public.customers c on c.id = s.customer_id
    where s.kitchen_id = p_kitchen
      and (p_subscription is null or s.id = p_subscription)
      and s.status = 'active' and c.status = 'active'
      and s.start_date <= p_to and (s.end_date is null or s.end_date >= p_from)
  loop
    for d in
      select gs::date from generate_series(greatest(p_from, r.start_date),
                                           least(p_to, coalesce(r.end_date, p_to)),
                                           interval '1 day') as gs
    loop
      continue when not (extract(isodow from d)::int = any (r.days_of_week));
      -- never create an order the kitchen can no longer plan for
      continue when d = app.today()
        and app.now() >= (select t.addon_cutoff_at from app.slot_times(p_kitchen, d, r.meal_slot) t);

      v_status := case
        when app.closure_covers(p_kitchen, d, r.meal_slot) then 'cancelled_closure'
        when app.skip_covers(r.customer_id, d, r.meal_slot) then 'skipped'
        else 'scheduled' end;

      v_order := null;
      insert into public.orders (kitchen_id, customer_id, subscription_id, order_date, meal_slot, tiffin_type_id,
                                 status, unit_price_paise, location_node_id, location_text,
                                 skipped_at)
      values (p_kitchen, r.customer_id, r.id, d, r.meal_slot, r.tiffin_type_id,
              v_status, app.tiffin_price(p_kitchen, r.customer_id, r.tiffin_type_id, d),
              coalesce(r.default_location_node_id, r.c_loc_node),
              coalesce(r.default_location_text, r.c_loc_text),
              case when v_status = 'skipped' then app.now() end)
      on conflict (subscription_id, order_date, meal_slot) where subscription_id is not null do nothing
      returning id into v_order;

      if v_order is not null then
        v_count := v_count + 1;
        insert into public.order_addons (kitchen_id, order_id, item_id, qty, unit_price_paise, requested_by_role, status)
        select p_kitchen, v_order, sa.item_id, sa.qty,
               app.item_price(p_kitchen, r.customer_id, sa.item_id, d), 'subscription', 'accepted'
        from public.subscription_addons sa where sa.subscription_id = r.id;
      end if;
    end loop;
  end loop;
  return v_count;
end $$;

-- Bring future, still-unlocked orders of one subscription in line with it.
create or replace function app.resync_subscription(p_subscription uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  o record;
  v_horizon int;
begin
  select sub.*, c.status as customer_status into s
  from public.subscriptions sub join public.customers c on c.id = sub.customer_id
  where sub.id = p_subscription;
  if not found then return; end if;

  for o in
    select ord.* from public.orders ord
    where ord.subscription_id = p_subscription
      and ord.order_date >= app.today()
      and ord.status in ('scheduled','skipped')
      and app.now() < (select t.addon_cutoff_at from app.slot_times(ord.kitchen_id, ord.order_date, ord.meal_slot) t)
  loop
    if s.status <> 'active' or s.customer_status <> 'active'
       or o.order_date < s.start_date
       or (s.end_date is not null and o.order_date > s.end_date)
       or not (extract(isodow from o.order_date)::int = any (s.days_of_week))
       or o.meal_slot <> s.meal_slot then
      delete from public.orders where id = o.id;      -- unlocked + never charged: safe to remove
    elsif o.tiffin_type_id <> s.tiffin_type_id then
      update public.orders
         set tiffin_type_id = s.tiffin_type_id,
             unit_price_paise = app.tiffin_price(s.kitchen_id, s.customer_id, s.tiffin_type_id, o.order_date)
       where id = o.id;
    end if;
  end loop;

  select b.order_horizon_days into v_horizon from public.business_settings b where b.kitchen_id = s.kitchen_id;
  perform app.generate_orders(s.kitchen_id, app.today(), app.today() + coalesce(v_horizon, 7), p_subscription);
end $$;

-- Daily job entry point: every kitchen, today .. today + horizon.
create or replace function app.generate_orders_all() returns int
language plpgsql security definer set search_path = '' as $$
declare k record; v_total int := 0;
begin
  for k in select b.kitchen_id, b.order_horizon_days from public.business_settings b loop
    v_total := v_total + app.generate_orders(k.kitchen_id, app.today(), app.today() + k.order_horizon_days);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger meal_slots_touch    before update on public.meal_slots    for each row execute function app.touch();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function app.touch();
create trigger orders_touch        before update on public.orders        for each row execute function app.touch();
create trigger order_addons_touch  before update on public.order_addons  for each row execute function app.touch();

create trigger meal_slots_audit          after insert or update or delete on public.meal_slots          for each row execute function app.audit_row('true');
create trigger slot_overrides_audit      after insert or update or delete on public.slot_overrides      for each row execute function app.audit_row('true');
create trigger closures_audit            after insert or update or delete on public.closures            for each row execute function app.audit_row('true');
create trigger subscriptions_audit       after insert or update or delete on public.subscriptions       for each row execute function app.audit_row('true');
create trigger subscription_addons_audit after insert or update or delete on public.subscription_addons for each row execute function app.audit_row('true');
create trigger customer_skips_audit      after insert or update or delete on public.customer_skips      for each row execute function app.audit_row('true');
create trigger boxes_audit               after insert or update or delete on public.boxes               for each row execute function app.audit_row('true');
-- Orders/add-ons: generated in bulk, so INSERTs are not audited; location fields
-- (customer self-service, stored on the row) are ignored in diffs.
create trigger orders_audit       after update or delete on public.orders
  for each row execute function app.audit_row('false', 'location_node_id', 'location_text', 'location_updated_at', 'received_confirmed_at');
create trigger order_addons_audit after update or delete on public.order_addons
  for each row execute function app.audit_row('false');
