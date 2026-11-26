-- =============================================================================
-- 0300 MENU
-- Items, tiffin types built from items, price history, customer overrides,
-- daily menu, packing instructions for staff.
-- Prices are NEVER accepted from clients for orders: they are resolved here.
-- Past prices are immutable (a price change never changes old bills).
-- =============================================================================

create table public.items (
  id                  uuid primary key default gen_random_uuid(),
  kitchen_id          uuid not null references public.kitchens(id),
  name                text not null check (char_length(btrim(name)) between 1 and 80),
  category            text not null default 'addon' check (category in ('main','addon')),
  is_veg              boolean not null default true,
  unit                text not null default 'piece' check (char_length(btrim(unit)) between 1 and 20),
  customer_orderable  boolean not null default false,   -- may customers request it as an extra?
  max_qty_per_order   int not null default 5 check (max_qty_per_order between 1 and 20),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (id, kitchen_id)
);
create unique index items_name_uniq on public.items (kitchen_id, lower(btrim(name)));

create table public.item_prices (
  id              uuid primary key default gen_random_uuid(),
  kitchen_id      uuid not null,
  item_id         uuid not null,
  price_paise     bigint not null check (price_paise between 0 and 1000000),  -- max ₹10,000
  effective_from  date not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  foreign key (item_id, kitchen_id) references public.items (id, kitchen_id),
  unique (item_id, effective_from)
);

create table public.tiffin_types (
  id            uuid primary key default gen_random_uuid(),
  kitchen_id    uuid not null references public.kitchens(id),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  description   text check (char_length(description) <= 500),
  is_veg        boolean not null default true,
  pricing_mode  text not null default 'fixed' check (pricing_mode in ('fixed','sum_of_items')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  unique (id, kitchen_id)
);
create unique index tiffin_types_name_uniq on public.tiffin_types (kitchen_id, lower(btrim(name)));

create table public.tiffin_type_items (
  kitchen_id      uuid not null,
  tiffin_type_id  uuid not null,
  item_id         uuid not null,
  qty             int not null check (qty between 1 and 20),
  primary key (tiffin_type_id, item_id),
  foreign key (tiffin_type_id, kitchen_id) references public.tiffin_types (id, kitchen_id) on delete cascade,
  foreign key (item_id, kitchen_id)        references public.items (id, kitchen_id)
);

create table public.tiffin_type_prices (
  id              uuid primary key default gen_random_uuid(),
  kitchen_id      uuid not null,
  tiffin_type_id  uuid not null,
  price_paise     bigint not null check (price_paise between 0 and 1000000),
  effective_from  date not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  foreign key (tiffin_type_id, kitchen_id) references public.tiffin_types (id, kitchen_id),
  unique (tiffin_type_id, effective_from)
);

-- Special price for one customer (e.g. long-time regular). Exactly one target.
create table public.customer_price_overrides (
  id              uuid primary key default gen_random_uuid(),
  kitchen_id      uuid not null,
  customer_id     uuid not null,
  tiffin_type_id  uuid,
  item_id         uuid,
  price_paise     bigint not null check (price_paise between 0 and 1000000),
  effective_from  date not null,
  effective_to    date,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int not null default 1,
  foreign key (customer_id, kitchen_id)    references public.customers (id, kitchen_id),
  foreign key (tiffin_type_id, kitchen_id) references public.tiffin_types (id, kitchen_id),
  foreign key (item_id, kitchen_id)        references public.items (id, kitchen_id),
  check ((tiffin_type_id is null) <> (item_id is null)),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.daily_menu (
  kitchen_id   uuid not null references public.kitchens(id),
  menu_date    date not null,
  meal_slot    text not null check (meal_slot in ('lunch','dinner')),
  description  text not null check (char_length(btrim(description)) between 1 and 500),
  updated_at   timestamptz not null default now(),
  primary key (kitchen_id, menu_date, meal_slot)
);

-- How to pack each tiffin type (for staff). Text + optional photo/voice.
create table public.packing_instructions (
  tiffin_type_id  uuid primary key,
  kitchen_id      uuid not null,
  instructions    text not null check (char_length(btrim(instructions)) between 1 and 2000),
  photo_path      text check (char_length(photo_path) <= 300),
  voice_path      text check (char_length(voice_path) <= 300),
  updated_at      timestamptz not null default now(),
  foreign key (tiffin_type_id, kitchen_id) references public.tiffin_types (id, kitchen_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Price resolution (server-side only)
-- ---------------------------------------------------------------------------
create or replace function app.item_price(p_kitchen uuid, p_customer uuid, p_item uuid, p_date date) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v bigint;
begin
  select o.price_paise into v
  from public.customer_price_overrides o
  where o.kitchen_id = p_kitchen and o.customer_id = p_customer and o.item_id = p_item
    and o.effective_from <= p_date and (o.effective_to is null or o.effective_to >= p_date)
  order by o.effective_from desc limit 1;
  if v is not null then return v; end if;

  select ip.price_paise into v
  from public.item_prices ip
  where ip.kitchen_id = p_kitchen and ip.item_id = p_item and ip.effective_from <= p_date
  order by ip.effective_from desc limit 1;
  if v is null then
    raise exception 'PRICE_NOT_SET' using errcode = 'P0001', detail = format('item %s on %s', p_item, p_date);
  end if;
  return v;
end $$;

create or replace function app.tiffin_price(p_kitchen uuid, p_customer uuid, p_tiffin_type uuid, p_date date) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v bigint; v_mode text; r record;
begin
  select o.price_paise into v
  from public.customer_price_overrides o
  where o.kitchen_id = p_kitchen and o.customer_id = p_customer and o.tiffin_type_id = p_tiffin_type
    and o.effective_from <= p_date and (o.effective_to is null or o.effective_to >= p_date)
  order by o.effective_from desc limit 1;
  if v is not null then return v; end if;

  select t.pricing_mode into v_mode from public.tiffin_types t
  where t.id = p_tiffin_type and t.kitchen_id = p_kitchen;
  if v_mode is null then raise exception 'TIFFIN_TYPE_NOT_FOUND' using errcode = 'P0001'; end if;

  if v_mode = 'fixed' then
    select tp.price_paise into v
    from public.tiffin_type_prices tp
    where tp.kitchen_id = p_kitchen and tp.tiffin_type_id = p_tiffin_type and tp.effective_from <= p_date
    order by tp.effective_from desc limit 1;
    if v is null then
      raise exception 'PRICE_NOT_SET' using errcode = 'P0001', detail = format('tiffin type %s on %s', p_tiffin_type, p_date);
    end if;
    return v;
  end if;

  -- sum_of_items (customer item overrides apply to each item)
  v := 0;
  for r in select ti.item_id, ti.qty from public.tiffin_type_items ti where ti.tiffin_type_id = p_tiffin_type loop
    v := v + r.qty * app.item_price(p_kitchen, p_customer, r.item_id, p_date);
  end loop;
  if v = 0 and not exists (select 1 from public.tiffin_type_items where tiffin_type_id = p_tiffin_type) then
    raise exception 'TIFFIN_TYPE_HAS_NO_ITEMS' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Price history rows can only be inserted (by owner functions); past rows are
-- immutable. Same-day or future rows may be replaced via the owner function.
-- ---------------------------------------------------------------------------
create or replace function app.protect_price_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_from <= app.today() then
      raise exception 'IMMUTABLE: past or current prices cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  -- UPDATE
  if old.effective_from < app.today() or new.effective_from <> old.effective_from
     or new.kitchen_id <> old.kitchen_id then
    raise exception 'IMMUTABLE: past prices cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger item_prices_protect        before update or delete on public.item_prices        for each row execute function app.protect_price_row();
create trigger tiffin_type_prices_protect before update or delete on public.tiffin_type_prices for each row execute function app.protect_price_row();

create trigger items_touch                    before update on public.items                    for each row execute function app.touch();
create trigger tiffin_types_touch             before update on public.tiffin_types             for each row execute function app.touch();
create trigger customer_price_overrides_touch before update on public.customer_price_overrides for each row execute function app.touch();

create trigger items_audit                    after insert or update or delete on public.items                    for each row execute function app.audit_row('true');
create trigger item_prices_audit              after insert or update or delete on public.item_prices              for each row execute function app.audit_row('true');
create trigger tiffin_types_audit             after insert or update or delete on public.tiffin_types             for each row execute function app.audit_row('true');
create trigger tiffin_type_items_audit        after insert or update or delete on public.tiffin_type_items        for each row execute function app.audit_row('true');
create trigger tiffin_type_prices_audit       after insert or update or delete on public.tiffin_type_prices       for each row execute function app.audit_row('true');
create trigger customer_price_overrides_audit after insert or update or delete on public.customer_price_overrides for each row execute function app.audit_row('true');
