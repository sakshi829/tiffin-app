// A realistic test world built ONLY through the same paths the apps will use:
// owner direct writes (RLS) + owner/customer/staff functions.
//
// Clock: Tue 1 Dec 2026 09:00 IST. Lunch 13:30 -> add-on cutoff 11:00, location cutoff 13:00.
import { createDb } from './db.mjs';

export const T0 = '2026-12-01T03:30:00Z';           // 09:00 IST
export const IST = (date, hhmm) => {                  // '2026-12-01','11:30' -> ISO UTC
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d.toISOString().replace('.000Z', 'Z');
};

export async function buildWorld() {
  const t = await createDb();
  await t.setNow(T0);

  const u = {};
  for (const l of ['owner', 'custA', 'custB', 'delivery', 'delivery2', 'kitchen', 'owner2', 'custC', 'stranger']) {
    u[l] = await t.createUser(l);
  }

  const k1 = (await t.sql(`select app.bootstrap_kitchen('Amruta''s Kitchen', $1, 'Amruta') as id`, [u.owner.id]))[0].id;
  const k2 = (await t.sql(`select app.bootstrap_kitchen('Other Kitchen', $1, 'Other') as id`, [u.owner2.id]))[0].id;

  const O = (q, p) => t.as(u.owner, q, p);
  const O2 = (q, p) => t.as(u.owner2, q, p);
  const one = async (p) => (await p)[0].id;

  // --- locations
  const place = await one(O(`insert into public.places (kitchen_id, name, kind) values ($1, 'City Hospital', 'hospital') returning id`, [k1]));
  const ward5 = await one(O(`insert into public.location_nodes (kitchen_id, place_id, name, kind, directions)
                              values ($1, $2, 'Ward 5', 'ward', '3rd floor, lift B, nurse station') returning id`, [k1, place]));
  const lab2 = await one(O(`insert into public.location_nodes (kitchen_id, place_id, name, kind) values ($1, $2, 'Lab 2', 'lab') returning id`, [k1, place]));
  const place2 = await one(O2(`insert into public.places (kitchen_id, name) values ($1, 'Tech Park') returning id`, [k2]));
  const k2node = await one(O2(`insert into public.location_nodes (kitchen_id, place_id, name) values ($1, $2, 'Desk 9') returning id`, [k2, place2]));

  // --- items
  const item = (name, category, orderable, max = 5) =>
    one(O(`insert into public.items (kitchen_id, name, category, customer_orderable, max_qty_per_order)
           values ($1, $2, $3, $4, $5) returning id`, [k1, name, category, orderable, max]));
  const egg = await item('Egg', 'addon', true, 4);
  const salad = await item('Salad', 'addon', true, 2);
  const bhakri = await item('Bhakri', 'addon', true, 6);
  const roti = await item('Roti', 'main', false, 10);
  const pickle = await item('Pickle', 'addon', true, 2);
  await O(`update public.items set active = false where id = $1`, [pickle]);
  for (const [id, price] of [[egg, 1500], [salad, 2000], [bhakri, 1000], [roti, 800], [pickle, 500]]) {
    await t.call(u.owner, 'public.owner_set_item_price($1, $2, $3)', [id, price, '2026-12-01']);
  }

  // --- tiffin types
  const veg = await one(O(`insert into public.tiffin_types (kitchen_id, name, is_veg, pricing_mode) values ($1, 'Veg Standard', true, 'fixed') returning id`, [k1]));
  const nonveg = await one(O(`insert into public.tiffin_types (kitchen_id, name, is_veg, pricing_mode) values ($1, 'Non-Veg', false, 'fixed') returning id`, [k1]));
  await t.call(u.owner, 'public.owner_set_tiffin_items($1, $2::jsonb)', [veg, JSON.stringify([{ item_id: roti, qty: 4 }])]);
  await t.call(u.owner, 'public.owner_set_tiffin_price($1, $2, $3)', [veg, 8000, '2026-12-01']);
  await t.call(u.owner, 'public.owner_set_tiffin_price($1, $2, $3)', [nonveg, 12000, '2026-12-01']);

  // kitchen 2 menu
  const k2item = await one(O2(`insert into public.items (kitchen_id, name, customer_orderable) values ($1, 'Raita', true) returning id`, [k2]));
  await t.call(u.owner2, 'public.owner_set_item_price($1, $2, $3)', [k2item, 1000, '2026-12-01']);
  const k2veg = await one(O2(`insert into public.tiffin_types (kitchen_id, name) values ($1, 'Thali') returning id`, [k2]));
  await t.call(u.owner2, 'public.owner_set_tiffin_price($1, $2, $3)', [k2veg, 9000, '2026-12-01']);

  // --- customers + invites
  const custA = await one(O(`insert into public.customers (kitchen_id, full_name, phone, food_notes, default_location_node_id)
                              values ($1, 'Priya', '9800000001', 'less spicy', $2) returning id`, [k1, ward5]));
  const custB = await one(O(`insert into public.customers (kitchen_id, full_name, phone) values ($1, 'Anil', '9800000002') returning id`, [k1]));
  const custC = await one(O2(`insert into public.customers (kitchen_id, full_name, phone) values ($1, 'Carol', '9800000003') returning id`, [k2]));

  for (const [cust, user, owner] of [[custA, u.custA, u.owner], [custB, u.custB, u.owner], [custC, u.custC, u.owner2]]) {
    const code = await t.call(owner, 'public.owner_create_customer_invite($1, 7)', [cust]);
    const r = await t.call(user, 'public.redeem_invite($1)', [code]);
    if (!r.ok) throw new Error(`redeem failed: ${JSON.stringify(r)}`);
  }

  // --- staff
  for (const [user, role, name] of [[u.delivery, 'delivery', 'Ravi'], [u.delivery2, 'delivery', 'Sunil'], [u.kitchen, 'kitchen', 'Meena']]) {
    const code = await t.call(u.owner, 'public.owner_create_staff_invite($1, $2, $3, 3)', [k1, role, name]);
    const r = await t.call(user, 'public.redeem_invite($1)', [code]);
    if (!r.ok) throw new Error(`staff redeem failed: ${JSON.stringify(r)}`);
  }
  const staffId = async (user) => (await t.sql('select id from public.staff_members where user_id = $1', [user.id]))[0].id;
  const staff = { delivery: await staffId(u.delivery), delivery2: await staffId(u.delivery2), kitchen: await staffId(u.kitchen) };

  // --- subscriptions (orders are generated for today .. today + 7)
  const sub = (cust, slot, type, start, addons = null) =>
    t.call(u.owner, `public.owner_save_subscription(null, $1, $2, $3, $4::date, null, null, null, null, null, null, $5::jsonb)`,
      [cust, slot, type, start, addons ? JSON.stringify(addons) : null]);
  const subA = await sub(custA, 'lunch', veg, '2026-12-01');
  const subBLunch = await sub(custB, 'lunch', nonveg, '2026-12-01');
  const subBDinner = await sub(custB, 'dinner', veg, '2026-12-01', [{ item_id: egg, qty: 1 }]);
  const subC = await t.call(u.owner2, `public.owner_save_subscription(null, $1, 'lunch', $2, '2026-12-01'::date, null, null, null, null, null, null, null)`, [custC, k2veg]);

  const order = async (cust, date, slot) =>
    (await t.sql('select * from public.orders where customer_id = $1 and order_date = $2 and meal_slot = $3', [cust, date, slot]))[0];

  return {
    t, u, k1, k2, place, ward5, lab2, k2node, staff,
    items: { egg, salad, bhakri, roti, pickle, k2item },
    types: { veg, nonveg, k2veg },
    cust: { A: custA, B: custB, C: custC },
    subs: { A: subA, BLunch: subBLunch, BDinner: subBDinner, C: subC },
    order,
  };
}
