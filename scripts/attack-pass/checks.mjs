// =============================================================================
// ATTACK PASS: the list of attacks. Shared by two runners:
//   scripts/attack-pass/run.mjs            -> against STAGING, through the real API (laptop)
//   supabase/tests/30-attack-pass.test.mjs -> against the test database (every `npm test`)
// so the list itself is tested before it is pointed at a real server.
//
// Every attack must be BLOCKED. Blocked means:
//   select           -> an error, or no rows
//   insert/update/delete -> an error, or no rows changed
//   rpc              -> an error (or, for `emptyOk` reads, an empty answer)
//   upload           -> an error; list -> an error or nothing listed
// The users all sign in with a password only, like a phone that has not done the
// owner's authenticator step: so "owner1" here is an owner WITHOUT MFA.
// =============================================================================

/** Every table in the public schema. The test fails when a table is added and not listed here. */
export const PUBLIC_TABLES = `announcements audit_log bill_late_fees bills box_movements boxes budgets business_settings
  chat_messages closures companies customer_price_overrides customer_saved_locations customer_skips customers daily_menu
  delivery_proofs devices expense_categories expenses ingredients invites item_ingredients item_prices items join_requests
  kitchens ledger_entries location_nodes loyalty_rewards loyalty_rules meal_slots notification_prefs notifications
  order_addons orders packing_instructions payments place_delivery_staff places recurring_expenses referral_requests
  slot_overrides special_menus staff_members staff_shifts subscription_addons subscriptions tiffin_type_items
  tiffin_type_prices tiffin_types waste_entries`.split(/\s+/).filter(Boolean);

/** The signed-in test users (setup.sql makes them; their emails are you+atk-<name>@...). */
export const USERS = ['owner1', 'custa', 'custb', 'custc', 'staff', 'stranger'];

export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const key = () => globalThis.crypto.randomUUID();

/**
 * Finds the ids the attacks aim at, by doing what each user is ALLOWED to do.
 * `run(who, op)` returns the data or throws. If a legal read fails, the fixture is
 * missing and nothing else is meaningful, so this throws.
 */
export async function discover(run, today) {
  const rows = async (who, op, what) => {
    const d = await run(who, op);
    const list = Array.isArray(d) ? d : d == null ? [] : [d];
    if (!list.length) throw new Error(`Fixture check failed: ${who} cannot see ${what}. Did setup.sql run on this project?`);
    return list;
  };
  const [a] = await rows('custa', { select: 'customers' }, 'their own customer record');
  const [b] = await rows('custb', { select: 'customers' }, 'their own customer record');
  const [c] = await rows('custc', { select: 'customers' }, 'their own customer record');
  if (a.kitchen_id !== b.kitchen_id || a.kitchen_id === c.kitchen_id) throw new Error('Fixture check failed: A and B must share kitchen 1, C must be in kitchen 2.');
  const week = (k) => ({ p_kitchen: k, p_from: today, p_to: addDays(today, 6) });
  const [oa] = await rows('custa', { rpc: 'customer_my_orders', args: week(a.kitchen_id) }, 'their meals');
  const [ob] = await rows('custb', { rpc: 'customer_my_orders', args: week(b.kitchen_id) }, 'their meals');
  const [oc] = await rows('custc', { rpc: 'customer_my_orders', args: week(c.kitchen_id) }, 'their meals');
  const [pay] = await rows('custa', { select: 'payments' }, 'their payment');
  const [st] = await rows('staff', { select: 'staff_members' }, 'their own staff record');
  if (st.kitchen_id !== a.kitchen_id) throw new Error('Fixture check failed: the staff user must work in kitchen 1.');
  return {
    today, K1: a.kitchen_id, K2: c.kitchen_id, A: a.id, B: b.id, C: c.id,
    orderA: oa.order_id, orderB: ob.order_id, orderC: oc.order_id, payA: pay.id, staffId: st.id,
  };
}

/** The attacks. Each: { who, name, op, emptyOk?, laptopOnly? }. who 'anon' = not signed in. */
export function buildChecks(x) {
  const list = [];
  const add = (who, name, op, extra = {}) => list.push({ who, name, op, ...extra });
  const week = (k) => ({ p_kitchen: k, p_from: x.today, p_to: addDays(x.today, 6) });

  // ---- not signed in: nothing readable, nothing callable
  for (const t of PUBLIC_TABLES) add('anon', `read ${t}`, { select: t });
  add('anon', 'balance of kitchen 1', { rpc: 'my_balance', args: { p_kitchen: x.K1 } });
  add('anon', 'meals of kitchen 1', { rpc: 'customer_my_orders', args: week(x.K1) });
  add('anon', 'loyalty of customer A', { rpc: 'loyalty_progress', args: { p_customer: x.A } });
  add('anon', 'list receipts of kitchen 1', { list: 'receipts', prefix: x.K1 }, { laptopOnly: true });

  // ---- signed in, belongs to no kitchen: sees no rows anywhere
  for (const t of PUBLIC_TABLES) add('stranger', `read ${t}`, { select: t });
  add('stranger', 'meals of kitchen 1', { rpc: 'customer_my_orders', args: week(x.K1) }, { emptyOk: true });
  add('stranger', 'loyalty of customer A', { rpc: 'loyalty_progress', args: { p_customer: x.A } });
  add('stranger', 'accept kitchen 1 rules without being its customer', { rpc: 'customer_accept_terms', args: { p_kitchen: x.K1 } });

  // ---- customer A against customer B (same kitchen) and kitchen 2
  for (const [t, col, id] of [['customers', 'id', x.B], ['orders', 'customer_id', x.B], ['payments', 'customer_id', x.B],
    ['ledger_entries', 'customer_id', x.B], ['bills', 'customer_id', x.B], ['customer_skips', 'customer_id', x.B],
    ['customers', 'kitchen_id', x.K2], ['orders', 'id', x.orderC]]) {
    add('custa', `read ${t} where ${col} = ${col === 'kitchen_id' ? 'kitchen 2' : 'someone else'}`, { select: t, where: { [col]: id } });
  }
  for (const t of ['staff_members', 'audit_log', 'expenses', 'invites', 'budgets', 'recurring_expenses', 'join_requests', 'devices', 'staff_shifts']) {
    add('custa', `read ${t}`, { select: t });
  }
  add('custa', "skip customer B's meal", { rpc: 'customer_skip_meal', args: { p_order: x.orderB } });
  add('custa', "move customer B's delivery", { rpc: 'customer_set_location', args: { p_order: x.orderB, p_location_node: null, p_location_text: 'Gate 2' } });
  add('custa', "mark customer B's box as kept", { rpc: 'customer_mark_box_kept', args: { p_order: x.orderB, p_location_text: 'x', p_idempotency_key: key() } });
  add('custa', "read customer B's loyalty", { rpc: 'loyalty_progress', args: { p_customer: x.B } });
  add('custa', 'balance in kitchen 2', { rpc: 'my_balance', args: { p_kitchen: x.K2 } });
  add('custa', 'meals of kitchen 2', { rpc: 'customer_my_orders', args: week(x.K2) }, { emptyOk: true });
  add('custa', 'message kitchen 2', { rpc: 'customer_send_message', args: { p_kitchen: x.K2, p_body: 'hello' } });
  add('custa', 'report a payment to kitchen 2', { rpc: 'customer_submit_payment', args: { p_kitchen: x.K2, p_amount_paise: 10000, p_utr: 'ATKUTR999999', p_paid_on: x.today, p_idempotency_key: key(), p_note: null } });
  add('custa', 'confirm their own payment', { rpc: 'owner_confirm_payment', args: { p_payment: x.payA } });
  add('custa', 'record a cash payment for themself', { rpc: 'owner_record_payment', args: { p_customer: x.A, p_amount_paise: 100000, p_method: 'cash', p_utr: null, p_paid_on: x.today, p_note: null, p_idempotency_key: key() } });
  add('custa', 'add a credit to their own account', { rpc: 'owner_add_ledger_entry', args: { p_customer: x.A, p_kind: 'adjustment', p_amount_paise: -100000, p_note: 'x', p_order: null } });
  add('custa', 'read the day sheet', { rpc: 'owner_day_orders', args: { p_kitchen: x.K1, p_date: x.today } });
  add('custa', "read customer B's statement", { rpc: 'owner_customer_statement', args: { p_customer: x.B, p_from: addDays(x.today, -30), p_to: x.today } });
  add('custa', 'set their own meal to delivered', { rpc: 'owner_set_order_status', args: { p_order: x.orderA, p_status: 'delivered', p_reason: null } });
  add('custa', 'read the delivery list', { rpc: 'staff_my_tasks', args: { p_kitchen: x.K1, p_date: x.today, p_meal_slot: 'lunch' } });
  add('custa', 'mark their own meal delivered as staff', { rpc: 'staff_mark_delivered', args: { p_order: x.orderA } });
  add('custa', 'make a staff invite', { rpc: 'owner_create_staff_invite', args: { p_kitchen: x.K1, p_role: 'delivery', p_display_name: 'x', p_valid_days: 1 } });
  // direct table writes (the apps never do these; only functions may change data)
  add('custa', 'rename customer B', { update: 'customers', set: { full_name: 'hacked' }, where: { id: x.B } });
  add('custa', 'change own account status', { update: 'customers', set: { status: 'paused' }, where: { id: x.A } });
  add('custa', 'set own meal to delivered', { update: 'orders', set: { status: 'delivered' }, where: { id: x.orderA } });
  add('custa', 'confirm own payment in the table', { update: 'payments', set: { status: 'confirmed' }, where: { id: x.payA } });
  add('custa', 'write a credit into the ledger', { insert: 'ledger_entries', values: { customer_id: x.A, kind: 'adjustment', amount_paise: -100000, entry_date: x.today, note: 'x' } });
  add('custa', 'delete own meal', { delete: 'orders', where: { id: x.orderA } });
  add('custa', 'delete own payment', { delete: 'payments', where: { id: x.payA } });
  // stored files
  add('custa', "upload into customer B's payment proofs", { upload: 'payment-proofs', path: `${x.K1}/${x.B}/atk.jpg` }, { laptopOnly: true });
  add('custa', "upload into kitchen 2's payment proofs", { upload: 'payment-proofs', path: `${x.K2}/${x.C}/atk.jpg` }, { laptopOnly: true });
  add('custa', 'upload a kitchen photo', { upload: 'kitchen-media', path: `${x.K1}/atk.jpg` }, { laptopOnly: true });
  add('custa', "list customer B's payment proofs", { list: 'payment-proofs', prefix: `${x.K1}/${x.B}` }, { laptopOnly: true });
  add('custa', 'list expense receipts', { list: 'receipts', prefix: x.K1 }, { laptopOnly: true });

  // ---- customer C (kitchen 2) against kitchen 1
  add('custc', 'meals of kitchen 1', { rpc: 'customer_my_orders', args: week(x.K1) }, { emptyOk: true });
  add('custc', "skip customer A's meal", { rpc: 'customer_skip_meal', args: { p_order: x.orderA } });
  add('custc', 'read kitchen 1 customers', { select: 'customers', where: { kitchen_id: x.K1 } });
  add('custc', 'read kitchen 1 menu prices', { select: 'items', where: { kitchen_id: x.K1 } });

  // ---- delivery staff: delivery list only, no money, no customer records, no owner actions
  for (const t of ['customers', 'orders', 'payments', 'ledger_entries', 'bills', 'item_prices', 'expenses', 'audit_log', 'invites']) {
    add('staff', `read ${t}`, { select: t });
  }
  add('staff', 'read the day sheet', { rpc: 'owner_day_orders', args: { p_kitchen: x.K1, p_date: x.today } });
  add('staff', 'read balances', { rpc: 'owner_customer_balances', args: { p_kitchen: x.K1 } });
  add('staff', "set a meal's status as owner", { rpc: 'owner_set_order_status', args: { p_order: x.orderA, p_status: 'cancelled', p_reason: 'x' } });
  add('staff', "skip customer A's meal", { rpc: 'customer_skip_meal', args: { p_order: x.orderA } });
  add('staff', 'mark a kitchen 2 meal delivered', { rpc: 'staff_mark_delivered', args: { p_order: x.orderC } });
  add('staff', 'read kitchen 2 delivery list', { rpc: 'staff_my_tasks', args: { p_kitchen: x.K2, p_date: x.today, p_meal_slot: 'lunch' } }, { emptyOk: true });
  add('staff', 'make an invite', { rpc: 'owner_create_staff_invite', args: { p_kitchen: x.K1, p_role: 'kitchen', p_display_name: 'x', p_valid_days: 1 } });
  add('staff', 'record a payment', { rpc: 'owner_record_payment', args: { p_customer: x.A, p_amount_paise: 100, p_method: 'cash', p_utr: null, p_paid_on: x.today, p_note: null, p_idempotency_key: key() } });
  add('staff', 'set own meal to delivered in the table', { update: 'orders', set: { status: 'delivered' }, where: { id: x.orderA } });
  add('staff', 'make themself owner', { update: 'staff_members', set: { role: 'owner' }, where: { id: x.staffId } });
  add('staff', 'upload a kitchen photo', { upload: 'kitchen-media', path: `${x.K1}/atk.jpg` }, { laptopOnly: true });

  // ---- owner signed in with a password only (no authenticator): no owner rights at all
  for (const t of ['customers', 'orders', 'payments', 'ledger_entries', 'bills', 'expenses', 'audit_log', 'invites', 'item_prices']) {
    add('owner1', `read ${t} without the authenticator`, { select: t });
  }
  add('owner1', 'day sheet without the authenticator', { rpc: 'owner_day_orders', args: { p_kitchen: x.K1, p_date: x.today } });
  add('owner1', 'balances without the authenticator', { rpc: 'owner_customer_balances', args: { p_kitchen: x.K1 } });
  add('owner1', 'record a payment without the authenticator', { rpc: 'owner_record_payment', args: { p_customer: x.A, p_amount_paise: 100, p_method: 'cash', p_utr: null, p_paid_on: x.today, p_note: null, p_idempotency_key: key() } });
  add('owner1', 'invite staff without the authenticator', { rpc: 'owner_create_staff_invite', args: { p_kitchen: x.K1, p_role: 'delivery', p_display_name: 'x', p_valid_days: 1 } });
  add('owner1', 'rename a customer without the authenticator', { update: 'customers', set: { full_name: 'hacked' }, where: { id: x.A } });
  add('owner1', 'upload a receipt without the authenticator', { upload: 'receipts', path: `${x.K1}/atk.jpg` }, { laptopOnly: true });
  return list;
}

/** Was the attack blocked? `res` is { error } or { data }. */
export function isBlocked(check, res) {
  if (res.error) return true;
  const d = res.data;
  const empty = d == null || (Array.isArray(d) && d.length === 0);
  if ('rpc' in check.op) return !!check.emptyOk && empty;
  if ('upload' in check.op) return false;
  return empty;   // select, list, and writes (rows changed)
}
