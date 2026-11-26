import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeLocation, groupByLocation, summarizeDay } from './day.ts';
import type { DayOrder } from './types.ts';

const base: DayOrder = {
  order_id: 'o', meal_slot: 'lunch', status: 'scheduled', customer_id: 'c', customer_name: 'X', customer_phone: null,
  food_notes: null, tiffin_type_id: 'veg', tiffin_type_name: 'Veg Standard', is_veg: true, unit_price_paise: 8000,
  addons: [], location_text: null, location_path: null, location_updated_at: null, assigned_staff_id: null,
  assigned_staff_name: null, delivered_at: null, not_delivered_reason: null, late_skip_charged: false,
};
const o = (p: Partial<DayOrder>): DayOrder => ({ ...base, ...p });

test('summarizeDay counts only meals to cook, per slot, with extras totals', () => {
  const orders = [
    o({ order_id: '1', customer_name: 'Priya', addons: [{ item_id: 'e', name: 'Egg', qty: 2, unit_price_paise: 1500 }] }),
    o({ order_id: '2', customer_name: 'Anil', tiffin_type_id: 'nv', tiffin_type_name: 'Non-Veg', is_veg: false, status: 'delivered',
        addons: [{ item_id: 'e', name: 'Egg', qty: 1, unit_price_paise: 1500 }] }),
    o({ order_id: '3', status: 'skipped', addons: [{ item_id: 's', name: 'Salad', qty: 1, unit_price_paise: 2000 }] }),
    o({ order_id: '4', status: 'cancelled_closure' }),
    o({ order_id: '5', meal_slot: 'dinner' }),
  ];
  const [lunch, dinner] = summarizeDay(orders);
  assert.equal(lunch!.total, 2);
  assert.equal(lunch!.veg, 1);
  assert.equal(lunch!.nonVeg, 1);
  assert.deepEqual(lunch!.addons, [{ name: 'Egg', qty: 3 }]);          // skipped order's salad not counted
  assert.deepEqual(lunch!.status, { scheduled: 1, delivered: 1, not_delivered: 0, skipped: 1, skipped_late: 0, cancelled_closure: 1 });
  assert.equal(dinner!.total, 1);
});

test('groupByLocation sorts places and puts unknown last', () => {
  const groups = groupByLocation([
    o({ customer_name: 'B', location_path: 'City Hospital > Ward 5' }),
    o({ customer_name: 'C' }),
    o({ customer_name: 'A', location_path: 'City Hospital > Ward 5' }),
    o({ customer_name: 'D', location_text: 'Admin block' }),
  ]);
  assert.deepEqual(groups.map((g) => g.location), ['Admin block', 'City Hospital > Ward 5', 'Location not set']);
  assert.deepEqual(groups[1]!.orders.map((x) => x.customer_name), ['A', 'B']);
});

test('describeLocation', () => {
  assert.equal(describeLocation({ location_path: 'H > Ward 5', location_text: 'near lift' }), 'H > Ward 5 (near lift)');
  assert.equal(describeLocation({ location_path: null, location_text: null }), 'Location not set');
});
