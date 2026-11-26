-- =============================================================================
-- 2700 DELETE A PLACE OR SPOT THAT WAS NEVER USED (owner request, 27 Nov 2026; decision T127)
-- "Hide" stays the way to retire a place that is in use. Delete is for mistakes and test entries.
-- "In use" is decided by the database's own foreign keys (spots inside a place, customers'
-- usual place, meal plans, orders, delivery zones...), so no reference can be missed:
-- the delete is attempted and a foreign-key refusal becomes LOCATION_IN_USE.
-- Owners have no DELETE grant on these tables; this function is the only way (verify_live 3).
-- Tests: 31-delete-locations.test.mjs.
-- =============================================================================

create or replace function public.owner_delete_location(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_kitchen uuid;
begin
  if p_kind = 'place' then
    select kitchen_id into v_kitchen from public.places where id = p_id for update;
  elsif p_kind = 'spot' then
    select kitchen_id into v_kitchen from public.location_nodes where id = p_id for update;
  else
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if v_kitchen is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform app.require_owner(v_kitchen);
  begin
    if p_kind = 'place' then
      delete from public.places where id = p_id;
    else
      delete from public.location_nodes where id = p_id;
    end if;
  exception when foreign_key_violation then
    raise exception 'LOCATION_IN_USE' using errcode = 'P0001';
  end;
end $$;

revoke execute on function public.owner_delete_location(text, uuid) from public, anon;
grant execute on function public.owner_delete_location(text, uuid) to authenticated;
