-- =============================================================================
-- 0100 FOUNDATION
-- Safe defaults, private helper schema, tenant (kitchen), settings, staff,
-- audit log and generic triggers.
--
-- SECURITY PRINCIPLES (see PLAN.md section 13):
--   * Nothing is exposed by default: Supabase grants ALL on new public tables
--     to anon/authenticated by default; we revoke that FIRST, then grant
--     explicitly per table in 0900_security.sql.
--   * Functions are not executable by PUBLIC by default.
--   * Identity always comes from auth.uid(); never from client-sent ids.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Lock down default privileges (objects created by this role from now on)
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- PUBLIC execute on functions is a global default, so it must be revoked globally.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 2. Private schema for helpers (NOT exposed through the Data API)
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- Server clock. All cutoff checks use this; tests replace it to simulate time.
-- Clients can never influence it.
create or replace function app.now() returns timestamptz
language sql stable set search_path = '' as $$ select pg_catalog.now() $$;

create or replace function app.today() returns date
language sql stable set search_path = '' as $$ select (app.now() at time zone 'Asia/Kolkata')::date $$;

-- Local (Asia/Kolkata) date + time  ->  absolute timestamptz
create or replace function app.local_ts(p_date date, p_time time) returns timestamptz
language sql immutable set search_path = '' as $$ select (p_date + p_time) at time zone 'Asia/Kolkata' $$;

-- ---------------------------------------------------------------------------
-- 3. Generic triggers
-- ---------------------------------------------------------------------------
-- updated_at + optimistic-locking version
create or replace function app.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  new.version := old.version + 1;
  return new;
end $$;

-- Append-only / immutable tables
create or replace function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE: % rows cannot be %d', tg_table_name, lower(tg_op)
    using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tenant, settings, staff
-- ---------------------------------------------------------------------------
create table public.kitchens (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     int not null default 1
);

create table public.business_settings (
  kitchen_id                    uuid primary key references public.kitchens(id),
  display_name                  text not null check (char_length(btrim(display_name)) between 1 and 100),
  upi_id                        text check (upi_id ~ '^[A-Za-z0-9.\-_]{2,64}@[A-Za-z0-9]{2,64}$'),
  upi_qr_path                   text check (char_length(upi_qr_path) <= 300),
  signup_mode                   text not null default 'invite_only'
                                  check (signup_mode in ('invite_only','request_to_join','open')),
  -- late skip (decision 8): charged in full after the first N per month
  free_late_skips_per_month     int  not null default 1   check (free_late_skips_per_month between 0 and 31),
  late_skip_charge_percent      int  not null default 100 check (late_skip_charge_percent between 0 and 100),
  -- late payment fee (decision 11), off by default
  late_fee_enabled              boolean not null default false,
  late_fee_grace_days           int  not null default 7 check (late_fee_grace_days between 0 and 90),
  late_fee_type                 text not null default 'flat' check (late_fee_type in ('flat','percent')),
  late_fee_value                int  not null default 0 check (late_fee_value between 0 and 1000000),
  low_balance_threshold_paise   bigint not null default 20000 check (low_balance_threshold_paise between 0 and 10000000),
  media_retention_days          int  not null default 30 check (media_retention_days between 1 and 365),
  order_horizon_days            int  not null default 7  check (order_horizon_days between 1 and 31),
  updated_at                    timestamptz not null default now(),
  version                       int not null default 1,
  constraint late_fee_percent_range check (late_fee_type <> 'percent' or late_fee_value <= 100)
);

create table public.staff_members (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid not null references public.kitchens(id),
  user_id        uuid not null references auth.users(id),
  display_name   text not null check (char_length(btrim(display_name)) between 1 and 100),
  phone          text check (phone ~ '^[0-9+ \-]{7,20}$'),
  role           text not null check (role in ('owner','kitchen','delivery','kitchen_delivery')),
  can_see_phone  boolean not null default false,   -- decision 14: owner enables per staff
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        int not null default 1,
  unique (kitchen_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. Audit log (immutable; written only by trigger)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  kitchen_id     uuid,
  actor_user_id  uuid,
  actor_role     text,
  table_name     text not null,
  record_id      uuid,
  action         text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data       jsonb,
  new_data       jsonb,
  at             timestamptz not null default now()
);
create index audit_log_kitchen_at on public.audit_log (kitchen_id, at desc);

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function app.forbid_mutation();

-- Audit trigger.
--   TG_ARGV[0] = 'true' | 'false'  -> audit INSERTs?
--   TG_ARGV[1..] = column names to ignore in UPDATE diffs
-- UPDATEs store ONLY the changed columns (keeps the free-tier DB small).
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
    v_new := to_jsonb(new); v_diff_new := v_new;
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
    v_old := to_jsonb(old); v_diff_old := v_old;
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

create trigger kitchens_touch          before update on public.kitchens          for each row execute function app.touch();
create trigger business_settings_touch before update on public.business_settings for each row execute function app.touch();
create trigger staff_members_touch     before update on public.staff_members     for each row execute function app.touch();

create trigger kitchens_audit          after insert or update or delete on public.kitchens          for each row execute function app.audit_row('true');
create trigger business_settings_audit after insert or update or delete on public.business_settings for each row execute function app.audit_row('true');
create trigger staff_members_audit     after insert or update or delete on public.staff_members     for each row execute function app.audit_row('true');

-- ---------------------------------------------------------------------------
-- 6. Identity helpers (SECURITY DEFINER so they can be used inside RLS
--    policies without recursive policy evaluation). All read auth.uid().
-- ---------------------------------------------------------------------------
create or replace function app.has_mfa() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- TOTP verified within the last p_minutes (step-up for dangerous actions).
-- Reads the detailed AMR format [{method, timestamp}] that Supabase issues by
-- default. The RFC-8176 string format (only with custom token hooks) carries
-- no timestamp, so it can never satisfy step-up (fails closed).
create or replace function app.recent_mfa(p_minutes int) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(
           case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) as e
    where jsonb_typeof(e) = 'object'
      and e ->> 'method' in ('totp', 'mfa/totp')
      and (e ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and (e ->> 'timestamp')::bigint >= extract(epoch from app.now())::bigint - p_minutes * 60
  )
$$;

-- Owner = active owner row AND the session completed MFA (aal2).
create or replace function app.is_owner(p_kitchen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_mfa() and exists (
    select 1 from public.staff_members s
    where s.kitchen_id = p_kitchen and s.user_id = auth.uid() and s.role = 'owner' and s.active
  )
$$;

-- Active non-owner staff row for the caller (null if none).
create or replace function app.my_staff(p_kitchen uuid) returns public.staff_members
language sql stable security definer set search_path = '' as $$
  select s.* from public.staff_members s
  where s.kitchen_id = p_kitchen and s.user_id = auth.uid() and s.role <> 'owner' and s.active
$$;

create or replace function app.is_staff(p_kitchen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members s
    where s.kitchen_id = p_kitchen and s.user_id = auth.uid() and s.role <> 'owner' and s.active
  )
$$;

create or replace function app.require_owner(p_kitchen uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kitchen is null or not app.is_owner(p_kitchen) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end $$;

-- Owner + MFA verified in the last 10 minutes.
create or replace function app.require_step_up(p_kitchen uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_kitchen);
  if not app.recent_mfa(10) then
    raise exception 'STEP_UP_REQUIRED' using errcode = '42501',
      hint = 'Re-enter your authenticator code and try again.';
  end if;
end $$;
