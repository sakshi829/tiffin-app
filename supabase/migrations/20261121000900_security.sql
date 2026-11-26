-- =============================================================================
-- 0900 SECURITY: Row Level Security + grants (all in one place for review)
--
-- Model (PLAN.md 13.1):
--   anon          -> nothing at all
--   customer      -> reads own rows + menu; writes ONLY via customer_* functions
--   staff         -> reads menu/locations/instructions; tasks ONLY via staff_* functions
--   owner (aal2)  -> reads everything in own kitchen; writes config tables
--                    directly (column-limited), money/orders via owner_* functions
-- Tests in supabase/tests assert this matrix; CI blocks any change that breaks it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Start from zero
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every public table (deny by default)
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers used inside policies
-- ---------------------------------------------------------------------------
create or replace function app.can_read_customer_row(p_kitchen uuid, p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_owner(p_kitchen) or (p_customer is not null and p_customer = app.my_customer_id(p_kitchen))
$$;

create or replace function app.subscription_customer(p_subscription uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select customer_id from public.subscriptions where id = p_subscription
$$;

create or replace function app.order_customer(p_order uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select customer_id from public.orders where id = p_order
$$;

grant execute on function
  app.now(), app.today(), app.has_mfa(), app.recent_mfa(int), app.is_owner(uuid), app.is_staff(uuid),
  app.my_staff(uuid), app.my_customer_id(uuid), app.is_member(uuid), app.can_read_customer_row(uuid, uuid),
  app.subscription_customer(uuid), app.order_customer(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. SELECT (read) policies
-- ---------------------------------------------------------------------------
grant select on all tables in schema public to authenticated;   -- RLS below decides which ROWS

-- kitchen-wide reference data: any member (owner, staff, customer)
create policy read_members on public.kitchens          for select to authenticated using (app.is_member(id));
create policy read_members on public.business_settings for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.places            for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.location_nodes    for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.items             for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.tiffin_types      for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.tiffin_type_items for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.daily_menu        for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.meal_slots        for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.slot_overrides    for select to authenticated using (app.is_member(kitchen_id));
create policy read_members on public.closures          for select to authenticated using (app.is_member(kitchen_id));

-- prices: owner + customers (menu prices). Staff NEVER see prices.
create policy read_prices on public.item_prices        for select to authenticated
  using (app.is_owner(kitchen_id) or app.my_customer_id(kitchen_id) is not null);
create policy read_prices on public.tiffin_type_prices for select to authenticated
  using (app.is_owner(kitchen_id) or app.my_customer_id(kitchen_id) is not null);

-- staff-facing reference data
create policy read_staff on public.packing_instructions for select to authenticated
  using (app.is_owner(kitchen_id) or app.is_staff(kitchen_id));
create policy read_staff on public.boxes for select to authenticated
  using (app.is_owner(kitchen_id) or app.is_staff(kitchen_id));

-- staff rows: owner sees all; a staff member sees only their own row
create policy read_staff_members on public.staff_members for select to authenticated
  using (app.is_owner(kitchen_id) or user_id = auth.uid());

-- owner-only
create policy read_owner on public.audit_log          for select to authenticated using (app.is_owner(kitchen_id));
create policy read_owner on public.companies          for select to authenticated using (app.is_owner(kitchen_id));
create policy read_owner on public.invites            for select to authenticated using (app.is_owner(kitchen_id));
create policy read_owner on public.expense_categories for select to authenticated using (app.is_owner(kitchen_id));
create policy read_owner on public.expenses           for select to authenticated using (app.is_owner(kitchen_id));

-- customer-owned rows: owner, or that customer only
create policy read_own on public.customers                for select to authenticated using (app.can_read_customer_row(kitchen_id, id));
create policy read_own on public.customer_saved_locations for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.customer_price_overrides for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.subscriptions            for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.customer_skips           for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.orders                   for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.box_movements            for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.ledger_entries           for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.payments                 for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.bills                    for select to authenticated using (app.can_read_customer_row(kitchen_id, customer_id));
create policy read_own on public.subscription_addons      for select to authenticated
  using (app.can_read_customer_row(kitchen_id, app.subscription_customer(subscription_id)));
create policy read_own on public.order_addons             for select to authenticated
  using (app.can_read_customer_row(kitchen_id, app.order_customer(order_id)));

-- devices: own only
create policy read_own_devices on public.devices for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Owner direct writes: configuration tables only, column-limited.
--    (orders, money, invites, prices, staff, subscriptions -> functions only)
-- ---------------------------------------------------------------------------
grant insert (kitchen_id, name, kind, active)               on public.places to authenticated;
grant update (name, kind, active)                           on public.places to authenticated;

grant insert (kitchen_id, place_id, parent_id, name, kind, directions, directions_photo_path, directions_voice_path, active)
                                                            on public.location_nodes to authenticated;
grant update (parent_id, name, kind, directions, directions_photo_path, directions_voice_path, active)
                                                            on public.location_nodes to authenticated;

grant insert (kitchen_id, name, contact_name, contact_phone, billing_mode, active) on public.companies to authenticated;
grant update (name, contact_name, contact_phone, billing_mode, active)             on public.companies to authenticated;

-- customers: user_id / terms_accepted_at are NOT writable directly
grant insert (kitchen_id, full_name, phone, email, food_notes, default_location_node_id, default_location_text, status,
              company_id, billing_mode, late_fee_mode, late_fee_custom_value, late_skip_free_override,
              late_skip_charge_percent_override, joined_on)  on public.customers to authenticated;
grant update (full_name, phone, email, food_notes, default_location_node_id, default_location_text, status,
              company_id, billing_mode, late_fee_mode, late_fee_custom_value, late_skip_free_override,
              late_skip_charge_percent_override, joined_on)  on public.customers to authenticated;

grant insert (kitchen_id, name, category, is_veg, unit, customer_orderable, max_qty_per_order, active) on public.items to authenticated;
grant update (name, category, is_veg, unit, customer_orderable, max_qty_per_order, active)             on public.items to authenticated;

grant insert (kitchen_id, name, description, is_veg, pricing_mode, active) on public.tiffin_types to authenticated;
grant update (name, description, is_veg, pricing_mode, active)             on public.tiffin_types to authenticated;

grant insert (kitchen_id, tiffin_type_id, item_id, qty) on public.tiffin_type_items to authenticated;
grant update (qty)                                      on public.tiffin_type_items to authenticated;
grant delete                                            on public.tiffin_type_items to authenticated;

grant insert (kitchen_id, menu_date, meal_slot, description) on public.daily_menu to authenticated;
grant update (description)                                   on public.daily_menu to authenticated;
grant delete                                                 on public.daily_menu to authenticated;

grant insert (tiffin_type_id, kitchen_id, instructions, photo_path, voice_path) on public.packing_instructions to authenticated;
grant update (instructions, photo_path, voice_path)                             on public.packing_instructions to authenticated;

grant update (delivery_time, addon_cutoff_mode, addon_cutoff_minutes, addon_cutoff_time,
              location_cutoff_mode, location_cutoff_minutes, location_cutoff_time, active) on public.meal_slots to authenticated;

grant insert (kitchen_id, override_date, meal_slot, delivery_time, addon_cutoff_time, location_cutoff_time, note)
                                                                            on public.slot_overrides to authenticated;
grant update (delivery_time, addon_cutoff_time, location_cutoff_time, note) on public.slot_overrides to authenticated;
grant delete                                                                on public.slot_overrides to authenticated;

grant insert (kitchen_id, code, active) on public.boxes to authenticated;
grant update (active)                   on public.boxes to authenticated;

grant insert (kitchen_id, name, default_kind, active) on public.expense_categories to authenticated;
grant update (name, default_kind, active)             on public.expense_categories to authenticated;

alter table public.expenses alter column created_by set default auth.uid();
grant insert (kitchen_id, expense_date, category_id, kind, amount_paise, vendor, method, note, receipt_path, staff_member_id)
                                                                on public.expenses to authenticated;
grant update (expense_date, category_id, kind, amount_paise, vendor, method, note, receipt_path, staff_member_id, archived_at)
                                                                on public.expenses to authenticated;

do $$
declare t text;
begin
  foreach t in array array['places','location_nodes','companies','customers','items','tiffin_types','tiffin_type_items',
                           'daily_menu','packing_instructions','meal_slots','slot_overrides','boxes',
                           'expense_categories','expenses'] loop
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (app.is_owner(kitchen_id))', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (app.is_owner(kitchen_id)) with check (app.is_owner(kitchen_id))', t);
  end loop;
  foreach t in array array['tiffin_type_items','daily_menu','slot_overrides'] loop
    execute format('create policy owner_delete on public.%I for delete to authenticated using (app.is_owner(kitchen_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Functions callable through the API (each re-checks its caller)
-- ---------------------------------------------------------------------------
grant execute on function
  -- customer
  public.customer_set_location(uuid, uuid, text),
  public.customer_skip_meal(uuid),
  public.customer_unskip_meal(uuid),
  public.customer_skip_range(uuid, date, date, text),
  public.customer_cancel_skip_range(uuid),
  public.customer_request_addon(uuid, uuid, int),
  public.customer_cancel_addon(uuid),
  public.customer_mark_box_kept(uuid, text, text),
  public.customer_submit_payment(uuid, bigint, text, date, text, text),
  public.customer_accept_terms(uuid),
  public.my_balance(uuid),
  public.redeem_invite(text),
  public.register_device(text, text, jsonb, text),
  public.unregister_device(uuid),
  -- staff
  public.staff_my_tasks(uuid, date, text),
  public.staff_mark_delivered(uuid),
  public.staff_mark_not_delivered(uuid, text),
  public.staff_box_collected(uuid, text, text),
  -- owner
  public.owner_create_customer_invite(uuid, int),
  public.owner_create_staff_invite(uuid, text, text, int),
  public.owner_revoke_invite(uuid),
  public.owner_unlink_customer(uuid),
  public.owner_set_staff(uuid, text, boolean, boolean),
  public.owner_set_item_price(uuid, bigint, date),
  public.owner_set_tiffin_price(uuid, bigint, date),
  public.owner_set_price_override(uuid, uuid, uuid, bigint, date, date),
  public.owner_end_price_override(uuid, date),
  public.owner_save_subscription(uuid, uuid, text, uuid, date, date, int[], uuid, text, text, text, jsonb),
  public.owner_add_closure(uuid, date, text, text),
  public.owner_cancel_closure(uuid),
  public.owner_generate_orders(uuid, date, date),
  public.owner_set_order_status(uuid, text, text),
  public.owner_assign_orders(uuid, uuid[], uuid),
  public.owner_set_order_addon(uuid, uuid, int),
  public.owner_record_payment(uuid, bigint, text, text, date, text, text),
  public.owner_confirm_payment(uuid),
  public.owner_reject_payment(uuid, text),
  public.owner_add_ledger_entry(uuid, text, bigint, text, uuid),
  public.owner_generate_bill(uuid, date, date, int),
  public.owner_update_settings(uuid, jsonb)
to authenticated;

-- Never callable from the API: app.bootstrap_kitchen, app.generate_orders*, app.charge_*,
-- app.reverse_order_charges, app.reprice_orders, app.resync_subscription, app.store_invite ...
-- (they have no grants; only the database owner / scheduled jobs can run them).
