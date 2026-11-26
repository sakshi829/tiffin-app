-- =============================================================================
-- ATTACK PASS: test fixture. STAGING ONLY. Never run this on the live project.
--
-- Before: in the STAGING dashboard, Authentication > Users > Add user (tick
-- "Auto confirm"), create these 7 users, all with the same password. They are
-- your own address with +atk-... added (Gmail and most mail services accept it):
--   you+atk-owner1@gmail.com   you+atk-owner2@gmail.com
--   you+atk-custa@gmail.com    you+atk-custb@gmail.com    you+atk-custc@gmail.com
--   you+atk-staff@gmail.com    you+atk-stranger@gmail.com
-- Then change v_base below to your address, paste this whole file into the
-- STAGING SQL editor and run it. Running it again does nothing.
--
-- It builds, through the normal app functions:
--   kitchen 1: owner1, customers A and B (lunch plans), delivery staff, A's pending payment
--   kitchen 2: owner2, customer C (lunch plan)
--   stranger:  signed up, belongs to nothing
-- Tested by supabase/tests/30-attack-pass.test.mjs.
-- =============================================================================
do $$
declare
  v_base text := 'CHANGE-ME@example.com';   -- <<< your address: the same one you give run.mjs as ATTACK_EMAIL_BASE
  v_role text; v_ids jsonb := '{}';
  k1 uuid; k2 uuid; v_node uuid; v_veg uuid; v_cust uuid; v_code text; r jsonb;
begin
  if v_base = 'CHANGE-ME@example.com' or v_base !~ '^[^@+\s]+@[^@\s]+$' then
    raise exception 'Put your own email address in v_base first (without +anything).';
  end if;
  foreach v_role in array array['owner1', 'owner2', 'custa', 'custb', 'custc', 'staff', 'stranger'] loop
    v_ids := v_ids || jsonb_build_object(v_role, (select id from auth.users where lower(email) = lower(replace(v_base, '@', '+atk-' || v_role || '@'))));
    if v_ids ->> v_role is null then
      raise exception 'Create the user % first (Authentication > Users > Add user, auto confirm).', replace(v_base, '@', '+atk-' || v_role || '@');
    end if;
  end loop;
  if exists (select 1 from public.customers where user_id = (v_ids ->> 'custa')::uuid) then
    raise notice 'The attack fixture already exists: nothing to do.';
    return;
  end if;

  k1 := app.create_review_demo(replace(v_base, '@', '+atk-custa@'), replace(v_base, '@', '+atk-owner1@'));
  k2 := app.create_review_demo(replace(v_base, '@', '+atk-custc@'), replace(v_base, '@', '+atk-owner2@'));

  -- customer B joins kitchen 1, exactly as through the apps
  perform app.act_as((v_ids ->> 'owner1')::uuid, true);
  select id into v_node from public.location_nodes where kitchen_id = k1 order by name limit 1;
  select id into v_veg from public.tiffin_types where kitchen_id = k1 order by name limit 1;
  insert into public.customers (kitchen_id, full_name, default_location_node_id) values (k1, 'Attack customer B', v_node) returning id into v_cust;
  v_code := public.owner_create_customer_invite(v_cust, 7);
  perform app.act_as((v_ids ->> 'custb')::uuid, false);
  r := to_jsonb(public.redeem_invite(v_code, 'customer'));
  if coalesce(r ->> 'ok', 'false') <> 'true' then raise exception 'Could not link customer B: %', r; end if;
  perform public.customer_accept_terms(k1);
  perform app.act_as((v_ids ->> 'owner1')::uuid, true);
  perform public.owner_save_subscription(null, v_cust, 'lunch', v_veg, app.today(), null, null, null, null, null, null, null);

  -- delivery staff in kitchen 1
  v_code := public.owner_create_staff_invite(k1, 'delivery', 'Attack staff', 3);
  perform app.act_as((v_ids ->> 'staff')::uuid, false);
  r := to_jsonb(public.redeem_invite(v_code, 'staff'));
  if coalesce(r ->> 'ok', 'false') <> 'true' then raise exception 'Could not link the staff user: %', r; end if;

  -- customer A reports a payment (stays pending: a target for "confirm it yourself")
  perform app.act_as((v_ids ->> 'custa')::uuid, false);
  perform public.customer_submit_payment(k1, 10000, 'ATKUTR' || to_char(app.now(), 'YYMMDDHH24MI'), app.today(), gen_random_uuid()::text, 'attack pass');

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Attack fixture ready. Kitchen 1: %  Kitchen 2: %', k1, k2;
end $$;
