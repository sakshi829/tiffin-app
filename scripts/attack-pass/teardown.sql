-- =============================================================================
-- ATTACK PASS: remove the test users' access (STAGING). Same v_base as setup.sql.
-- The two test kitchens stay (history is never deleted); afterwards the 7 test
-- users see nothing, and you may delete them under Authentication > Users.
-- =============================================================================
do $$
declare
  v_base text := 'CHANGE-ME@example.com';   -- <<< same address as in setup.sql
  v_owner1 uuid; v_staff uuid; v_role text; n int := 0;
begin
  if v_base = 'CHANGE-ME@example.com' then raise exception 'Put your own email address in v_base first.'; end if;
  foreach v_role in array array['custa', 'custb', 'custc'] loop
    n := n + app.end_review_demo(replace(v_base, '@', '+atk-' || v_role || '@'));
  end loop;
  select id into v_owner1 from auth.users where lower(email) = lower(replace(v_base, '@', '+atk-owner1@'));
  select s.id into v_staff from public.staff_members s join auth.users u on u.id = s.user_id
   where lower(u.email) = lower(replace(v_base, '@', '+atk-staff@')) and s.active;
  if v_owner1 is not null and v_staff is not null then
    perform app.act_as(v_owner1, true);
    perform public.owner_set_staff(v_staff, 'delivery', false, false);
    n := n + 1;
  end if;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'Attack fixture closed: % accounts unlinked.', n;
end $$;
