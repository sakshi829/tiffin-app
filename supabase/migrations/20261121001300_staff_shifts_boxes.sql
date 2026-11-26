-- =============================================================================
-- 1300 STAFF APP (Phase 3b): shifts (attendance) + box pickup lists
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shifts: staff check in / out. Staff see their own; the owner sees all.
-- ---------------------------------------------------------------------------
create table public.staff_shifts (
  id          uuid primary key default gen_random_uuid(),
  kitchen_id  uuid not null,
  staff_id    uuid not null,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (staff_id, kitchen_id) references public.staff_members (id, kitchen_id),
  check (ended_at is null or ended_at >= started_at)
);
-- at most one open shift per staff member
create unique index staff_shifts_one_open on public.staff_shifts (staff_id) where ended_at is null;
create index staff_shifts_kitchen_started on public.staff_shifts (kitchen_id, started_at desc);
create trigger staff_shifts_no_delete before delete on public.staff_shifts
  for each row execute function app.forbid_mutation();
create trigger staff_shifts_audit after update on public.staff_shifts
  for each row execute function app.audit_row('false');

alter table public.staff_shifts enable row level security;
grant select on public.staff_shifts to authenticated;
create policy read_shifts on public.staff_shifts for select to authenticated
  using (app.is_owner(kitchen_id) or staff_id = (app.my_staff(kitchen_id)).id);

create or replace function public.staff_check_in(p_kitchen uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.staff_members := app.my_staff(p_kitchen); v public.staff_shifts;
begin
  if s.id is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select * into v from public.staff_shifts where staff_id = s.id and ended_at is null;
  if found then return jsonb_build_object('shift_id', v.id, 'started_at', v.started_at); end if;   -- idempotent
  insert into public.staff_shifts (kitchen_id, staff_id, started_at) values (p_kitchen, s.id, app.now()) returning * into v;
  return jsonb_build_object('shift_id', v.id, 'started_at', v.started_at);
end $$;

create or replace function public.staff_check_out(p_kitchen uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.staff_members := app.my_staff(p_kitchen); v public.staff_shifts;
begin
  if s.id is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.staff_shifts set ended_at = app.now() where staff_id = s.id and ended_at is null returning * into v;
  if not found then return jsonb_build_object('shift_id', null); end if;
  return jsonb_build_object('shift_id', v.id, 'started_at', v.started_at, 'ended_at', v.ended_at);
end $$;

-- Owner deactivating a staff member also closes an open shift.
create or replace function app.close_shift_on_deactivate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.staff_shifts set ended_at = app.now() where staff_id = new.id and ended_at is null;
  return new;
end $$;
create trigger staff_members_close_shift after update of active on public.staff_members
  for each row when (old.active and not new.active) execute function app.close_shift_on_deactivate();

-- ---------------------------------------------------------------------------
-- Boxes not back yet: delivered meals with no 'collected' movement.
-- ---------------------------------------------------------------------------
create or replace function app.boxes_out(p_kitchen uuid, p_staff uuid, p_days int)
returns table (order_id uuid, order_date date, meal_slot text, customer_id uuid, customer_name text,
               location_path text, location_text text, kept_at text, kept_at_time timestamptz, days_out int)
language sql stable security definer set search_path = '' as $$
  select o.id, o.order_date, o.meal_slot, c.id, c.full_name,
         case when o.location_node_id is not null then app.location_path(o.location_node_id) end, o.location_text,
         k.location_text, k.created_at, (app.today() - o.order_date)::int
  from public.orders o
  join public.customers c on c.id = o.customer_id
  left join lateral (
    select bm.location_text, bm.created_at from public.box_movements bm
    where bm.order_id = o.id and bm.kind = 'kept_at' order by bm.created_at desc limit 1) k on true
  where o.kitchen_id = p_kitchen and o.status = 'delivered'
    and o.order_date >= app.today() - p_days
    and (p_staff is null or o.assigned_staff_id = p_staff)
    and not exists (select 1 from public.box_movements x where x.order_id = o.id and x.kind = 'collected')
  order by k.created_at desc nulls last, o.order_date, c.full_name
$$;

-- Delivery staff: boxes to pick up from THEIR deliveries of the last 7 days.
create or replace function public.staff_box_pickups(p_kitchen uuid)
returns table (order_id uuid, order_date date, meal_slot text, customer_name text,
               location_path text, location_text text, kept_at text, kept_at_time timestamptz, days_out int)
language plpgsql stable security definer set search_path = '' as $$
declare s public.staff_members := app.my_staff(p_kitchen);
begin
  if s.id is null or s.role not in ('delivery','kitchen_delivery') then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return query select b.order_id, b.order_date, b.meal_slot, b.customer_name, b.location_path, b.location_text,
                      b.kept_at, b.kept_at_time, b.days_out
               from app.boxes_out(p_kitchen, s.id, 7) b;
end $$;

-- Owner: every box not back in the last 30 days.
create or replace function public.owner_boxes_out(p_kitchen uuid)
returns table (order_id uuid, order_date date, meal_slot text, customer_id uuid, customer_name text,
               location_path text, location_text text, kept_at text, kept_at_time timestamptz, days_out int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  return query select * from app.boxes_out(p_kitchen, null, 30);
end $$;

-- Owner collected a box themselves.
create or replace function public.owner_box_collected(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_id uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(o.kitchen_id);
  if o.status <> 'delivered' then raise exception 'ORDER_NOT_DELIVERED' using errcode = 'P0001'; end if;
  select id into v_id from public.box_movements where order_id = o.id and kind = 'collected' limit 1;
  if v_id is null then
    insert into public.box_movements (kitchen_id, customer_id, order_id, kind, actor_user_id, actor_role)
    values (o.kitchen_id, o.customer_id, o.id, 'collected', auth.uid(), 'owner') returning id into v_id;
  end if;
  return jsonb_build_object('movement_id', v_id);
end $$;

grant execute on function
  public.staff_check_in(uuid), public.staff_check_out(uuid), public.staff_box_pickups(uuid),
  public.owner_boxes_out(uuid), public.owner_box_collected(uuid)
to authenticated;
