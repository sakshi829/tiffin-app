// Structural security: RLS everywhere, no anon access, minimal grants,
// hardened SECURITY DEFINER functions, safe defaults for FUTURE objects.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './helpers/db.mjs';

let t;
before(async () => { t = await createDb(); });
after(async () => { await t.close(); });

test('every public table has Row Level Security enabled', async () => {
  const rows = await t.sql(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
  assert.deepEqual(rows, []);
});

test('anon has no privileges on any table, column or function', async () => {
  assert.deepEqual(await t.sql(`select table_name, privilege_type from information_schema.role_table_grants
                                where grantee = 'anon' and table_schema in ('public','app')`), []);
  assert.deepEqual(await t.sql(`select table_name, column_name from information_schema.column_privileges
                                where grantee = 'anon' and table_schema in ('public','app')`), []);
  assert.deepEqual(await t.sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname in ('public','app') and has_function_privilege('anon', p.oid, 'execute')`), []);
});

test('authenticated has table-level write privileges ONLY where intended', async () => {
  const rows = await t.sql(`select table_name, privilege_type from information_schema.role_table_grants
                            where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'
                            order by 1, 2`);
  assert.deepEqual(rows.map((r) => `${r.table_name}:${r.privilege_type}`),
    ['budgets:DELETE', 'daily_menu:DELETE', 'item_ingredients:DELETE', 'slot_overrides:DELETE', 'waste_entries:DELETE']);
});

test('column-level write grants exist only on owner configuration tables', async () => {
  const rows = await t.sql(`select distinct table_name from information_schema.column_privileges
                            where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE')
                            order by 1`);
  assert.deepEqual(rows.map((r) => r.table_name), [
    'boxes', 'budgets', 'companies', 'customers', 'daily_menu', 'expense_categories', 'expenses', 'ingredients',
    'item_ingredients', 'items', 'location_nodes', 'meal_slots', 'packing_instructions', 'places',
    'recurring_expenses', 'slot_overrides', 'tiffin_types', 'waste_entries',
  ]);
});

test('sensitive columns are never directly writable', async () => {
  const forbidden = [
    ['customers', 'user_id'], ['customers', 'terms_accepted_at'], ['customers', 'id'],
    ['customers', 'kitchen_id', 'UPDATE'], ['expenses', 'created_by'], ['expenses', 'kitchen_id', 'UPDATE'],
    ['items', 'kitchen_id', 'UPDATE'], ['location_nodes', 'place_id', 'UPDATE'],
  ];
  for (const [table, column, only] of forbidden) {
    const rows = await t.sql(`select privilege_type from information_schema.column_privileges
                              where grantee = 'authenticated' and table_schema = 'public' and table_name = $1 and column_name = $2
                                and privilege_type in ('INSERT','UPDATE')`, [table, column]);
    const types = rows.map((r) => r.privilege_type);
    if (only) assert.ok(!types.includes(only), `${table}.${column} must not have ${only}`);
    else assert.deepEqual(types, [], `${table}.${column} must not be writable`);
  }
});

test('money, orders, prices, staff, invites and audit tables have NO write grants at all', async () => {
  for (const table of ['orders', 'order_addons', 'ledger_entries', 'payments', 'bills', 'item_prices', 'tiffin_type_prices',
    'customer_price_overrides', 'staff_members', 'invites', 'audit_log', 'subscriptions', 'subscription_addons',
    'customer_skips', 'closures', 'box_movements', 'business_settings', 'kitchens', 'devices', 'customer_saved_locations',
    'loyalty_rewards', 'loyalty_rules']) {
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
      const [{ ok }] = await t.sql(`select has_table_privilege('authenticated', $1, $2) as ok`, [`public.${table}`, priv]);
      assert.equal(ok, false, `authenticated must not have ${priv} on ${table}`);
      const cols = await t.sql(`select column_name from information_schema.column_privileges
                                where grantee = 'authenticated' and table_schema = 'public' and table_name = $1 and privilege_type = $2`,
      [table, priv]);
      assert.deepEqual(cols, [], `no column ${priv} on ${table}`);
    }
  }
});

test('only intended API functions are executable by authenticated', async () => {
  const rows = await t.sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')`);
  for (const { proname } of rows) {
    assert.match(proname, /^(customer_|staff_|owner_|redeem_invite$|register_device$|unregister_device$|my_balance$|mark_notifications_read$|set_notification_prefs$|chat_mark_read$|forget_other_devices$|record_sign_in$|kitchen_join_info$|set_my_language$|loyalty_progress$)/,
      `unexpected executable function public.${proname}`);
  }
  const appRows = await t.sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'app' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
  // Helpers used INSIDE row-level / storage policies (Postgres runs them as the user). Each only
  // answers a yes/no question about the caller; none returns other people's data.
  assert.deepEqual(appRows.map((r) => r.proname), [
    'can_delete_media', 'can_read_customer_row', 'can_read_media', 'can_see_place', 'can_upload_delivery_proof', 'can_write_media',
    'direct_write_step_up', 'has_mfa', 'is_member', 'is_owner', 'is_staff', 'media_kind_ok', 'my_customer_id', 'my_customer_ids', 'my_owned_kitchens', 'my_staff', 'now',
    'order_customer', 'recent_mfa', 'subscription_customer', 'today', 'try_uuid',
  ]);
});

test('privileged internals are NOT callable by any API role', async () => {
  for (const fn of ['app.bootstrap_kitchen(text,uuid,text)', 'app.generate_orders(uuid,date,date,uuid)', 'app.generate_orders_all()',
    'app.charge_delivered(uuid)', 'app.charge_late_skip(uuid)', 'app.reverse_order_charges(uuid,text)',
    'app.reprice_orders(uuid,date,uuid)', 'app.resync_subscription(uuid)', 'app.store_invite(uuid,text,uuid,text,text,int)',
    'app.new_invite_code()', 'app.rate_limit_hit(text,int,interval)',
    'public.push_claim(int)', 'public.push_complete(jsonb)', 'app.notify(uuid,uuid,text,text,text,jsonb,text)',
    'public.media_expired(int)', 'app.object_exists(text,text)',
    'public.push_receipts_due(int)', 'public.push_receipts_done(text[],text[])', 'public.media_forget(jsonb)',
    'app.create_review_demo(text,text)', 'app.localize_alert(text,text)', 'app.localize_dates(text,text)', 'app.localize_insight(text,text)', 'app.owner_insights_en(uuid)', 'app.end_review_demo(text)', 'app.act_as(uuid,boolean)', 'app.approve_join(uuid,uuid)',
    'app.run_notification_jobs()', 'app.run_finance_jobs()', 'app.loyalty_on_delivery()',
    'app.billed(uuid,date,date)', 'app.spent(uuid,date,date,text)', 'app.meals_delivered(uuid,date,date)',
    'app.upload_quota_ok(uuid)', 'app.limit_member_writes()', 'app.trim_saved_locations()', 'app.customers_step_up()',
    'app.tiffin_types_step_up()', 'app.remember_status_before_closure()', 'app.payments_utr_confirm_check()']) {
    const [{ ok }] = await t.sql(`select has_function_privilege('authenticated', $1, 'execute') as ok`, [fn]);
    assert.equal(ok, false, `${fn} must not be executable`);
  }
});

test('every SECURITY DEFINER function pins search_path (no hijacking)', async () => {
  const rows = await t.sql(`select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname in ('public','app') and p.prosecdef
                              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(rows, []);
});

test('FUTURE tables and functions are private by default', async () => {
  await t.sql('create table public.zz_future (id int)');
  await t.sql('create function public.zz_future_fn() returns int language sql as $$ select 1 $$');
  for (const role of ['anon', 'authenticated']) {
    const [{ sel }] = await t.sql(`select has_table_privilege($1, 'public.zz_future', 'select') as sel`, [role]);
    const [{ ex }] = await t.sql(`select has_function_privilege($1, 'public.zz_future_fn()', 'execute') as ex`, [role]);
    assert.equal(sel, false, `${role} can read a new table`);
    assert.equal(ex, false, `${role} can execute a new function`);
  }
  await t.db.exec('drop function public.zz_future_fn(); drop table public.zz_future;');
});
