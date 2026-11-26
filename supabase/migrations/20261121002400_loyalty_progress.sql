-- =============================================================================
-- 2400 LOYALTY PROGRESS (F35): how far a customer is from the next reward.
-- Same count as the reward itself (delivered meals; a reward every N).
-- Readable by the kitchen's owner and by that customer. Tests: 29-loyalty-progress.
-- =============================================================================
create or replace function public.loyalty_progress(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; lr public.loyalty_rules; v_count int; v_given int;
begin
  select * into c from public.customers where id = p_customer;
  if not found or not (app.is_owner(c.kitchen_id) or coalesce(c.id = app.my_customer_id(c.kitchen_id), false)) then   -- NULL-safe
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into lr from public.loyalty_rules where kitchen_id = c.kitchen_id;
  if lr.kitchen_id is null or not lr.active then return jsonb_build_object('active', false); end if;
  select count(*) into v_count from public.orders where customer_id = c.id and status = 'delivered';
  select count(*) into v_given from public.loyalty_rewards where customer_id = c.id;
  return jsonb_build_object(
    'active', true,
    'delivered', v_count,
    'every_n', lr.every_n_meals,
    'toward_next', v_count % lr.every_n_meals,
    'to_go', lr.every_n_meals - (v_count % lr.every_n_meals),
    'reward_label', lr.reward_label,
    'reward_paise', lr.reward_paise,
    'rewards_given', v_given);
end $$;
revoke execute on function public.loyalty_progress(uuid) from public, anon;
grant execute on function public.loyalty_progress(uuid) to authenticated;
