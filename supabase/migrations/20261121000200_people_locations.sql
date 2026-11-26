-- =============================================================================
-- 0200 PEOPLE & LOCATIONS
-- Places/locations (any workplace: hospital, office, college...), companies
-- (corporate, future), customers, invites, devices, rate limits.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Locations: Place -> Building -> Floor/Department/Ward/Lab/Desk (+ free text)
-- ---------------------------------------------------------------------------
create table public.places (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null references public.kitchens(id),
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  kind        text not null default 'other' check (kind in ('hospital','office','college','home','other')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     int not null default 1,
  unique (id, kitchen_id)
);

create table public.location_nodes (
  id                     uuid primary key default gen_random_uuid(),
  kitchen_id             uuid not null references public.kitchens(id),
  place_id               uuid not null,
  parent_id              uuid,
  name                   text not null check (char_length(btrim(name)) between 1 and 100),
  kind                   text not null default 'other'
                           check (kind in ('building','floor','department','ward','lab','desk','gate','other')),
  -- Directions for staff ("3rd floor, lift B, nurse station")
  directions             text check (char_length(directions) <= 1000),
  directions_photo_path  text check (char_length(directions_photo_path) <= 300),
  directions_voice_path  text check (char_length(directions_voice_path) <= 300),
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int not null default 1,
  unique (id, kitchen_id),
  -- composite FKs guarantee a node can never point into another kitchen
  foreign key (place_id, kitchen_id)  references public.places (id, kitchen_id),
  foreign key (parent_id, kitchen_id) references public.location_nodes (id, kitchen_id),
  check (parent_id is null or parent_id <> id)
);
create index location_nodes_place on public.location_nodes (kitchen_id, place_id);

-- ---------------------------------------------------------------------------
-- Companies (corporate customers, future phase; schema ready now)
-- ---------------------------------------------------------------------------
create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references public.kitchens(id),
  name           text not null check (char_length(btrim(name)) between 1 and 150),
  contact_name   text check (char_length(contact_name) <= 100),
  contact_phone  text check (contact_phone ~ '^[0-9+ \-]{7,20}$'),
  billing_mode   text not null default 'employee_pays' check (billing_mode in ('employee_pays','company_pays')),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        int not null default 1,
  unique (id, kitchen_id)
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id                                 uuid primary key default gen_random_uuid(),
  kitchen_id                         uuid not null references public.kitchens(id),
  -- Linked login. Set ONLY by redeem_invite() or cleared by owner_unlink_customer().
  user_id                            uuid references auth.users(id),
  full_name                          text not null check (char_length(btrim(full_name)) between 1 and 100),
  phone                              text check (phone ~ '^[0-9+ \-]{7,20}$'),
  email                              text check (email ~* '^[^@\s]{1,64}@[^@\s]{1,255}$'),
  food_notes                         text check (char_length(food_notes) <= 500),
  default_location_node_id           uuid,
  default_location_text              text check (char_length(default_location_text) <= 120),
  status                             text not null default 'active'
                                       check (status in ('active','paused','stopped','archived')),
  company_id                         uuid,
  billing_mode                       text not null default 'postpaid' check (billing_mode in ('postpaid','advance')),
  late_fee_mode                      text not null default 'follow_global'
                                       check (late_fee_mode in ('follow_global','exempt','custom')),
  late_fee_custom_value              int check (late_fee_custom_value between 0 and 1000000),
  late_skip_free_override            int check (late_skip_free_override between 0 and 31),
  late_skip_charge_percent_override  int check (late_skip_charge_percent_override between 0 and 100),
  joined_on                          date not null default ((now() at time zone 'Asia/Kolkata')::date),
  terms_accepted_at                  timestamptz,
  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now(),
  version                            int not null default 1,
  unique (id, kitchen_id),
  unique (kitchen_id, user_id),
  foreign key (default_location_node_id, kitchen_id) references public.location_nodes (id, kitchen_id),
  foreign key (company_id, kitchen_id)               references public.companies (id, kitchen_id),
  check (late_fee_mode <> 'custom' or late_fee_custom_value is not null)
);
create index customers_user on public.customers (user_id) where user_id is not null;

create table public.customer_saved_locations (
  id                uuid primary key default gen_random_uuid(),
  kitchen_id        uuid not null,
  customer_id       uuid not null,
  location_node_id  uuid,
  location_text     text check (char_length(location_text) <= 120),
  last_used_at      timestamptz not null default now(),
  foreign key (customer_id, kitchen_id)      references public.customers (id, kitchen_id),
  foreign key (location_node_id, kitchen_id) references public.location_nodes (id, kitchen_id),
  check (location_node_id is not null or location_text is not null)
);
create unique index customer_saved_locations_uniq
  on public.customer_saved_locations (customer_id, coalesce(location_node_id::text, ''), coalesce(location_text, ''));

-- ---------------------------------------------------------------------------
-- Invites (customers AND staff). Only the SHA-256 hash of the code is stored.
-- ---------------------------------------------------------------------------
create table public.invites (
  id                  uuid primary key default gen_random_uuid(),
  kitchen_id          uuid not null references public.kitchens(id),
  kind                text not null check (kind in ('customer','staff')),
  customer_id         uuid,
  staff_role          text check (staff_role in ('kitchen','delivery','kitchen_delivery')),  -- never 'owner'
  staff_display_name  text check (char_length(btrim(staff_display_name)) between 1 and 100),
  code_hash           text not null unique,
  expires_at          timestamptz not null,
  used_at             timestamptz,
  used_by             uuid references auth.users(id),
  revoked_at          timestamptz,
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id),
  check ((kind = 'customer' and customer_id is not null and staff_role is null)
      or (kind = 'staff' and customer_id is null and staff_role is not null and staff_display_name is not null))
);

-- ---------------------------------------------------------------------------
-- Devices (push tokens). Users manage only their own, via register_device().
-- ---------------------------------------------------------------------------
create table public.devices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id),
  platform           text not null check (platform in ('android','ios','web')),
  expo_push_token    text check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,200}\]$'),
  web_push           jsonb,
  device_label       text check (char_length(device_label) <= 100),
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  check (expo_push_token is not null or web_push is not null)
);
create unique index devices_token on public.devices (expo_push_token) where expo_push_token is not null;

-- ---------------------------------------------------------------------------
-- Rate limits (per user, per action, per window). Private: functions only.
-- ---------------------------------------------------------------------------
create table app.rate_limits (
  user_id       uuid not null,
  action        text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (user_id, action, window_start)
);

-- Returns true if allowed (and counts the hit), false if over the limit.
create or replace function app.rate_limit_hit(p_action text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from app.now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits int;
begin
  if auth.uid() is null then return false; end if;
  insert into app.rate_limits (user_id, action, window_start, hits)
  values (auth.uid(), p_action, v_window, 1)
  on conflict (user_id, action, window_start) do update set hits = app.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Read-only check (does not count).
create or replace function app.rate_limited(p_action text, p_max int, p_window interval) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select hits >= p_max from app.rate_limits
    where user_id = auth.uid() and action = p_action
      and window_start = to_timestamp(floor(extract(epoch from app.now()) / extract(epoch from p_window)) * extract(epoch from p_window))
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- Customer identity helper (after customers exists)
-- ---------------------------------------------------------------------------
create or replace function app.my_customer_id(p_kitchen uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.customers c
  where c.kitchen_id = p_kitchen and c.user_id = auth.uid() and c.status <> 'archived'
$$;

create or replace function app.is_member(p_kitchen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_owner(p_kitchen) or app.is_staff(p_kitchen) or app.my_customer_id(p_kitchen) is not null
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger places_touch          before update on public.places          for each row execute function app.touch();
create trigger location_nodes_touch  before update on public.location_nodes  for each row execute function app.touch();
create trigger companies_touch       before update on public.companies       for each row execute function app.touch();
create trigger customers_touch       before update on public.customers       for each row execute function app.touch();

create trigger places_audit          after insert or update or delete on public.places          for each row execute function app.audit_row('true');
create trigger location_nodes_audit  after insert or update or delete on public.location_nodes  for each row execute function app.audit_row('true');
create trigger companies_audit       after insert or update or delete on public.companies       for each row execute function app.audit_row('true');
create trigger customers_audit       after insert or update or delete on public.customers       for each row execute function app.audit_row('true');
create trigger invites_audit         after insert or update or delete on public.invites         for each row execute function app.audit_row('true', 'code_hash');
