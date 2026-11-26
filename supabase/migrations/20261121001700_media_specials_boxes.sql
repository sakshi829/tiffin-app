-- =============================================================================
-- 1700 PHASE 5b: private files (storage access rules), delivery proof photos,
-- payment screenshots, chat voice notes, media retention list, special menus,
-- QR box stickers (issue at packing / scan at pickup).
--
-- Buckets are created in the Supabase dashboard (setup guide step 13); Supabase
-- treats storage tables as API-managed. Files are deleted only through the
-- Storage API (deleting rows in SQL would leave the file billed but orphaned):
-- the `media-retention` Edge Function does that using media_expired().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Paths. Every file lives under its kitchen (and customer) id:
--   kitchen-media   <kitchen>/<name>.(jpg|jpeg|png|webp)                  owner writes, members read
--   delivery-proofs <kitchen>/<customer>/<order>.(jpg|jpeg|png|webp)      assigned staff/owner write; owner + that customer read
--   payment-proofs  <kitchen>/<customer>/<uuid>.(jpg|jpeg|png|webp)       that customer writes; owner + that customer read
--   voice-notes     <kitchen>/<customer>/<uuid>.(m4a|webm)                that customer or owner write; owner + that customer read
-- Nobody can overwrite (no UPDATE policy) and only the owner can delete kitchen-media.
-- ---------------------------------------------------------------------------
create or replace function app.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function app.media_kind_ok(p_bucket text, p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_bucket
    when 'kitchen-media'   then p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$'
    when 'delivery-proofs' then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    when 'payment-proofs'  then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
    when 'voice-notes'     then p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(m4a|webm)$'
    else false end
$$;

create or replace function app.can_upload_delivery_proof(p_kitchen uuid, p_customer uuid, p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order and o.kitchen_id = p_kitchen and o.customer_id = p_customer
      and o.order_date >= app.today() - 1 and o.status in ('scheduled','delivered')
      and (app.is_owner(p_kitchen) or o.assigned_staff_id = (app.my_staff(p_kitchen)).id)
  )
$$;

create or replace function app.can_read_media(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.media_kind_ok(p_bucket, p_name) and case p_bucket
    when 'kitchen-media' then app.is_member(app.try_uuid(split_part(p_name, '/', 1)))
    else app.can_read_customer_row(app.try_uuid(split_part(p_name, '/', 1)), app.try_uuid(split_part(p_name, '/', 2)))
  end
$$;

create or replace function app.can_write_media(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.media_kind_ok(p_bucket, p_name) and case p_bucket
    when 'kitchen-media'   then app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
    when 'delivery-proofs' then app.can_upload_delivery_proof(app.try_uuid(split_part(p_name, '/', 1)),
                                  app.try_uuid(split_part(p_name, '/', 2)), app.try_uuid(split_part(split_part(p_name, '/', 3), '.', 1)))
    when 'payment-proofs'  then app.try_uuid(split_part(p_name, '/', 2)) = app.my_customer_id(app.try_uuid(split_part(p_name, '/', 1)))
    when 'voice-notes'     then app.try_uuid(split_part(p_name, '/', 2)) = app.my_customer_id(app.try_uuid(split_part(p_name, '/', 1)))
                                or (app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
                                    and exists (select 1 from public.customers c where c.id = app.try_uuid(split_part(p_name, '/', 2))
                                                and c.kitchen_id = app.try_uuid(split_part(p_name, '/', 1))))
    else false end
$$;

create or replace function app.can_delete_media(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_bucket = 'kitchen-media' and app.media_kind_ok(p_bucket, p_name)
     and app.is_owner(app.try_uuid(split_part(p_name, '/', 1)))
$$;

grant execute on function app.try_uuid(text), app.media_kind_ok(text, text), app.can_read_media(text, text),
  app.can_write_media(text, text), app.can_delete_media(text, text), app.can_upload_delivery_proof(uuid, uuid, uuid)
to authenticated;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'create policy ak_media_read on storage.objects for select to authenticated using (app.can_read_media(bucket_id, name))';
    execute 'create policy ak_media_insert on storage.objects for insert to authenticated with check (app.can_write_media(bucket_id, name))';
    execute 'create policy ak_media_delete on storage.objects for delete to authenticated using (app.can_delete_media(bucket_id, name))';
  end if;
end $$;

create or replace function app.object_exists(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_name);
end $$;

-- Paths stored in our tables must point inside the row's own kitchen.
alter table public.business_settings add constraint upi_qr_in_kitchen
  check (upi_qr_path is null or (app.media_kind_ok('kitchen-media', upi_qr_path) and split_part(upi_qr_path, '/', 1) = kitchen_id::text));
alter table public.location_nodes add constraint directions_photo_in_kitchen
  check (directions_photo_path is null or (app.media_kind_ok('kitchen-media', directions_photo_path) and split_part(directions_photo_path, '/', 1) = kitchen_id::text));
alter table public.packing_instructions add constraint packing_photo_in_kitchen
  check (photo_path is null or (app.media_kind_ok('kitchen-media', photo_path) and split_part(photo_path, '/', 1) = kitchen_id::text));

-- ---------------------------------------------------------------------------
-- Delivery proof photos
-- ---------------------------------------------------------------------------
create table public.delivery_proofs (
  order_id     uuid primary key,
  kitchen_id   uuid not null,
  customer_id  uuid not null,
  path         text not null,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default app.now(),
  foreign key (order_id, kitchen_id) references public.orders (id, kitchen_id),
  foreign key (customer_id, kitchen_id) references public.customers (id, kitchen_id)
);
alter table public.delivery_proofs enable row level security;
grant select on public.delivery_proofs to authenticated;
create policy read_own on public.delivery_proofs for select to authenticated
  using (app.can_read_customer_row(kitchen_id, customer_id));

create or replace function public.staff_attach_proof(p_order uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or not app.can_upload_delivery_proof(o.kitchen_id, o.customer_id, o.id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_path is null or split_part(p_path, '.', 1) <> o.kitchen_id || '/' || o.customer_id || '/' || o.id
     or not app.media_kind_ok('delivery-proofs', p_path) or not app.object_exists('delivery-proofs', p_path) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  insert into public.delivery_proofs (order_id, kitchen_id, customer_id, path, uploaded_by)
  values (o.id, o.kitchen_id, o.customer_id, p_path, auth.uid())
  on conflict (order_id) do update set path = excluded.path, uploaded_by = excluded.uploaded_by, created_at = app.now();
end $$;

-- The exact file name a delivery person (or owner) may upload for one meal. Staff tasks
-- don't carry customer ids, so the app asks for the path instead of building it.
create or replace function public.staff_proof_path(p_order uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or not app.can_upload_delivery_proof(o.kitchen_id, o.customer_id, o.id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return o.kitchen_id || '/' || o.customer_id || '/' || o.id || '.jpg';
end $$;

-- ---------------------------------------------------------------------------
-- Payment screenshot (customer, own payment, still waiting for confirmation)
-- ---------------------------------------------------------------------------
create or replace function public.customer_attach_payment_proof(p_payment uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or p.customer_id is distinct from app.my_customer_id(p.kitchen_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p.status <> 'submitted' then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p.kitchen_id::text or split_part(p_path, '/', 2) <> p.customer_id::text
     or not app.media_kind_ok('payment-proofs', p_path) or not app.object_exists('payment-proofs', p_path) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  update public.payments set proof_path = p_path where id = p.id;
end $$;

-- ---------------------------------------------------------------------------
-- Chat voice notes (max 30 s, decision 12 / PLAN 8.8)
-- ---------------------------------------------------------------------------
alter table public.chat_messages
  add column voice_path text,
  add column voice_seconds int check (voice_seconds between 1 and 30),
  add constraint voice_complete check ((voice_path is null) = (voice_seconds is null));

create or replace function app.check_voice(p_kitchen uuid, p_customer uuid, p_path text, p_seconds int) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_seconds is null or p_seconds not between 1 and 30 then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_kitchen::text or split_part(p_path, '/', 2) <> p_customer::text
     or not app.media_kind_ok('voice-notes', p_path) or not app.object_exists('voice-notes', p_path) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.customer_send_voice(p_kitchen uuid, p_path text, p_seconds int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.my_customer_id(p_kitchen); v_id uuid; c public.customers;
begin
  if v_me is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.check_voice(p_kitchen, v_me, p_path, p_seconds);
  if not app.rate_limit_hit('chat_send', 30, interval '1 hour') then raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001'; end if;
  insert into public.chat_messages (kitchen_id, customer_id, sender_role, sender_user, body, voice_path, voice_seconds)
  values (p_kitchen, v_me, 'customer', auth.uid(), 'Voice note (' || p_seconds || ' s)', p_path, p_seconds) returning id into v_id;
  select * into c from public.customers where id = v_me;
  perform app.notify_owners(p_kitchen, 'chat_message', 'Voice note from ' || c.full_name, 'Open Chats to listen.',
    jsonb_build_object('customer_id', v_me), 'chat:' || v_id);
  return v_id;
end $$;

create or replace function public.owner_send_voice(p_customer uuid, p_path text, p_seconds int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.customers; v_id uuid;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(c.kitchen_id);
  perform app.check_voice(c.kitchen_id, c.id, p_path, p_seconds);
  insert into public.chat_messages (kitchen_id, customer_id, sender_role, sender_user, body, voice_path, voice_seconds)
  values (c.kitchen_id, c.id, 'owner', auth.uid(), 'Voice note (' || p_seconds || ' s)', p_path, p_seconds) returning id into v_id;
  perform app.notify(c.kitchen_id, c.user_id, 'chat_message', 'Voice note from the kitchen', 'Open Message the kitchen to listen.', '{}'::jsonb, 'chat:' || v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Retention list for the media-retention Edge Function (service role only).
-- Delivery photos + voice notes: media_retention_days (decision 20, default 30).
-- Payment screenshots: 400 days (accounting evidence). Kitchen media: kept.
-- ---------------------------------------------------------------------------
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
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end $$;
revoke all on function public.media_expired(int) from public, anon, authenticated;
grant execute on function public.media_expired(int) to service_role;

-- ---------------------------------------------------------------------------
-- Special menus / pre-orders: a tiffin type marked special + a dated offer.
-- Ordering creates a normal order (order_source 'special'), so kitchen lists,
-- delivery, skipping, closures and billing all work unchanged.
-- ---------------------------------------------------------------------------
alter table public.tiffin_types add column is_special boolean not null default false;
grant insert (is_special), update (is_special) on public.tiffin_types to authenticated;

create table public.special_menus (
  id              uuid primary key default gen_random_uuid(),
  kitchen_id      uuid not null references public.kitchens(id),
  tiffin_type_id  uuid not null,
  menu_date       date not null,
  meal_slot       text not null check (meal_slot in ('lunch','dinner')),
  order_deadline  timestamptz not null,
  max_orders      int check (max_orders between 1 and 1000),
  active          boolean not null default true,
  created_at      timestamptz not null default app.now(),
  unique (id, kitchen_id),
  foreign key (tiffin_type_id, kitchen_id) references public.tiffin_types (id, kitchen_id)
);
alter table public.special_menus enable row level security;
grant select on public.special_menus to authenticated;
create policy read_members on public.special_menus for select to authenticated using (app.is_member(kitchen_id));
create trigger special_menus_audit after insert or update on public.special_menus
  for each row execute function app.audit_row('true');

alter table public.orders add column special_menu_id uuid;
alter table public.orders add constraint orders_special_fk foreign key (special_menu_id, kitchen_id) references public.special_menus (id, kitchen_id);
create unique index orders_special_once on public.orders (customer_id, special_menu_id) where special_menu_id is not null;

create or replace function public.owner_save_special(
  p_id uuid, p_kitchen uuid, p_tiffin_type uuid, p_date date, p_meal_slot text, p_deadline timestamptz, p_max int, p_active boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; t public.tiffin_types; v_delivery timestamptz;
begin
  perform app.require_owner(p_kitchen);
  select * into t from public.tiffin_types where id = p_tiffin_type and kitchen_id = p_kitchen;
  if not found or not t.is_special or t.pricing_mode <> 'fixed' then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if p_date is null or p_date < app.today() or p_date > app.today() + 60 then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;
  perform app.tiffin_price(p_kitchen, null, p_tiffin_type, p_date);                     -- raises PRICE_NOT_SET
  select st.delivery_at into v_delivery from app.slot_times(p_kitchen, p_date, p_meal_slot) st;
  if p_deadline is null or p_deadline > v_delivery then raise exception 'INVALID_DATES' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.special_menus (kitchen_id, tiffin_type_id, menu_date, meal_slot, order_deadline, max_orders, active)
    values (p_kitchen, p_tiffin_type, p_date, p_meal_slot, p_deadline, p_max, coalesce(p_active, true)) returning id into v_id;
  else
    update public.special_menus set tiffin_type_id = p_tiffin_type, menu_date = p_date, meal_slot = p_meal_slot,
           order_deadline = p_deadline, max_orders = p_max, active = coalesce(p_active, true)
     where id = v_id and kitchen_id = p_kitchen;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.customer_special_menus(p_kitchen uuid)
returns table (special_id uuid, name text, description text, is_veg boolean, menu_date date, meal_slot text,
               price_paise bigint, order_deadline timestamptz, my_order_id uuid, remaining int)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := app.my_customer_id(p_kitchen);
begin
  if v_me is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return query
  select sm.id, tt.name, tt.description, tt.is_veg, sm.menu_date, sm.meal_slot,
         app.tiffin_price(p_kitchen, v_me, tt.id, sm.menu_date), sm.order_deadline,
         (select o.id from public.orders o where o.customer_id = v_me and o.special_menu_id = sm.id and o.status <> 'skipped' limit 1),
         case when sm.max_orders is null then null
              else greatest(0, sm.max_orders - (select count(*)::int from public.orders o
                                                 where o.special_menu_id = sm.id and o.status <> 'skipped')) end
  from public.special_menus sm join public.tiffin_types tt on tt.id = sm.tiffin_type_id
  where sm.kitchen_id = p_kitchen and sm.active and sm.menu_date between app.today() and app.today() + 14
    and (app.now() < sm.order_deadline
         or exists (select 1 from public.orders o where o.customer_id = v_me and o.special_menu_id = sm.id))
  order by sm.menu_date, sm.meal_slot;
end $$;

create or replace function public.customer_order_special(p_special uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sm public.special_menus; c public.customers; v_id uuid; v_taken int; v_prev public.orders;
begin
  select * into sm from public.special_menus where id = p_special for update;    -- serialises the "max orders" count
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into c from public.customers where id = app.my_customer_id(sm.kitchen_id);
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if c.status <> 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001'; end if;
  if not sm.active or app.now() >= sm.order_deadline then raise exception 'CUTOFF_PASSED' using errcode = 'P0001'; end if;
  if app.closure_covers(sm.kitchen_id, sm.menu_date, sm.meal_slot) then raise exception 'KITCHEN_CLOSED' using errcode = 'P0001'; end if;
  -- Already ordered (and not cancelled): same order back, no capacity check needed.
  select * into v_prev from public.orders where customer_id = c.id and special_menu_id = sm.id for update;
  if v_prev.id is not null and v_prev.status <> 'skipped' then return v_prev.id; end if;
  if sm.max_orders is not null then
    select count(*) into v_taken from public.orders where special_menu_id = sm.id and status <> 'skipped';
    if v_taken >= sm.max_orders then raise exception 'SOLD_OUT' using errcode = 'P0001'; end if;
  end if;
  if v_prev.id is not null then
    update public.orders set status = 'scheduled', skipped_at = null where id = v_prev.id;      -- ordered again
    return v_prev.id;
  end if;
  insert into public.orders (kitchen_id, customer_id, order_date, meal_slot, tiffin_type_id, order_source, status,
                             unit_price_paise, location_node_id, location_text, special_menu_id)
  values (sm.kitchen_id, c.id, sm.menu_date, sm.meal_slot, sm.tiffin_type_id, 'special', 'scheduled',
          app.tiffin_price(sm.kitchen_id, c.id, sm.tiffin_type_id, sm.menu_date),
          c.default_location_node_id, c.default_location_text, sm.id)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- QR box stickers: create codes, link a box to a meal at packing, scan to collect.
-- ---------------------------------------------------------------------------
create or replace function public.owner_create_boxes(p_kitchen uuid, p_count int) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_next int; v_codes text[] := '{}'; i int;
begin
  perform app.require_owner(p_kitchen);
  if p_count is null or p_count not between 1 and 200 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_kitchen::text || ':boxes', 0));
  select coalesce(max(substring(code from '^AK-([0-9]{1,6})$')::int), 0) + 1 into v_next
    from public.boxes where kitchen_id = p_kitchen;
  for i in 0 .. p_count - 1 loop
    v_codes := v_codes || ('AK-' || lpad((v_next + i)::text, 3, '0'));
  end loop;
  insert into public.boxes (kitchen_id, code) select p_kitchen, unnest(v_codes);
  return v_codes;
end $$;

-- Kitchen/packing staff (or owner) scans a box while packing a meal: box -> customer.
create or replace function public.staff_box_issued(p_order uuid, p_box_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; s public.staff_members; v_box uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  s := app.my_staff(o.kitchen_id);
  if s.id is null and not app.is_owner(o.kitchen_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if o.order_date not between app.today() and app.today() + 1 or o.status <> 'scheduled' then
    raise exception 'ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  select id into v_box from public.boxes where kitchen_id = o.kitchen_id and code = upper(btrim(coalesce(p_box_code, ''))) and active;
  if v_box is null then raise exception 'UNKNOWN_BOX' using errcode = 'P0001'; end if;
  insert into public.box_movements (kitchen_id, box_id, customer_id, order_id, kind, actor_user_id, actor_role)
  values (o.kitchen_id, v_box, o.customer_id, o.id, 'issued', auth.uid(), case when s.id is null then 'owner' else 'staff' end);
  return jsonb_build_object('box', upper(btrim(p_box_code)), 'customer_id', o.customer_id);
end $$;

-- Delivery staff scan a box at pickup: finds whose it was and marks it collected.
create or replace function public.staff_box_scan_collect(p_kitchen uuid, p_box_code text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.staff_members := app.my_staff(p_kitchen); v_box uuid; iss public.box_movements; v_id uuid; v_name text;
begin
  if s.id is null or s.role not in ('delivery','kitchen_delivery') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select id into v_box from public.boxes where kitchen_id = p_kitchen and code = upper(btrim(coalesce(p_box_code, ''))) and active;
  if v_box is null then raise exception 'UNKNOWN_BOX' using errcode = 'P0001'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.box_movements where kitchen_id = p_kitchen and idempotency_key = p_idempotency_key;
  end if;
  select * into iss from public.box_movements where box_id = v_box and kind = 'issued' order by created_at desc limit 1;
  if iss.id is null then raise exception 'BOX_NOT_ISSUED' using errcode = 'P0001'; end if;
  select full_name into v_name from public.customers where id = iss.customer_id;
  if v_id is null and not exists (select 1 from public.box_movements where box_id = v_box and kind = 'collected' and created_at >= iss.created_at) then
    insert into public.box_movements (kitchen_id, box_id, customer_id, order_id, kind, actor_user_id, actor_role, idempotency_key)
    values (p_kitchen, v_box, iss.customer_id, iss.order_id, 'collected', auth.uid(), 'staff', p_idempotency_key);
  end if;
  return jsonb_build_object('box', upper(btrim(p_box_code)), 'customer_name', v_name);
end $$;

grant execute on function
  public.staff_attach_proof(uuid, text), public.staff_proof_path(uuid), public.customer_attach_payment_proof(uuid, text),
  public.customer_send_voice(uuid, text, int), public.owner_send_voice(uuid, text, int),
  public.owner_save_special(uuid, uuid, uuid, date, text, timestamptz, int, boolean),
  public.customer_special_menus(uuid), public.customer_order_special(uuid),
  public.owner_create_boxes(uuid, int), public.staff_box_issued(uuid, text), public.staff_box_scan_collect(uuid, text, text)
to authenticated;
