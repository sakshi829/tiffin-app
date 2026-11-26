import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSlotTimes, nodePath, phoneDigits, quantityWithUnit, slotTimes, telLink, whatsappLink } from './display.ts';
import type { MealSlotRow } from './types.ts';

const lunch: MealSlotRow = {
  id: 's', kitchen_id: 'k', meal_slot: 'lunch', delivery_time: '13:30:00', addon_cutoff_mode: 'relative', addon_cutoff_minutes: 150,
  addon_cutoff_time: null, location_cutoff_mode: 'relative', location_cutoff_minutes: 30, location_cutoff_time: null, active: true, version: 1,
};

test('slotTimes mirrors the database rule (same cases as 04-cutoffs test)', () => {
  assert.deepEqual(slotTimes(lunch), { delivery: '13:30', addonCutoff: '11:00', locationCutoff: '13:00' });
  assert.deepEqual(slotTimes({ ...lunch, delivery_time: '14:00' }), { delivery: '14:00', addonCutoff: '11:30', locationCutoff: '13:30' });
  assert.equal(slotTimes({ ...lunch, addon_cutoff_mode: 'fixed', addon_cutoff_time: '12:00' }).addonCutoff, '12:00');
  assert.equal(slotTimes(lunch, { delivery_time: null, addon_cutoff_time: '10:00', location_cutoff_time: null }).addonCutoff, '10:00');
  assert.equal(slotTimes(lunch, { delivery_time: null, addon_cutoff_time: '15:00', location_cutoff_time: null }).addonCutoff, '13:30');
  assert.equal(describeSlotTimes(lunch), 'Delivery 1:30 PM · extras/skip until 11:00 AM · location until 1:00 PM');
});

test('nodePath builds place > parent > node', () => {
  const data = {
    places: [{ id: 'p', kitchen_id: 'k', name: 'City Hospital', kind: 'hospital', active: true }],
    nodes: [
      { id: 'b', kitchen_id: 'k', place_id: 'p', parent_id: null, name: 'Block A', kind: 'building', directions: null, directions_photo_path: null, active: true },
      { id: 'w', kitchen_id: 'k', place_id: 'p', parent_id: 'b', name: 'Ward 5', kind: 'ward', directions: null, directions_photo_path: null, active: true },
    ],
  };
  assert.equal(nodePath('w', data), 'City Hospital > Block A > Ward 5');
  assert.equal(nodePath('missing', data), null);
  assert.equal(nodePath(null, data), null);
});

test('phone links for Indian numbers', () => {
  assert.equal(phoneDigits('98000 00001'), '919800000001');
  assert.equal(phoneDigits('09800000001'), '919800000001');
  assert.equal(phoneDigits('+91-98000-00001'), '919800000001');
  assert.equal(phoneDigits('12345'), null);
  assert.equal(telLink('9800000001'), 'tel:+919800000001');
  assert.equal(whatsappLink('9800000001', 'Bill ₹1,200 & thanks'), 'https://wa.me/919800000001?text=Bill%20%E2%82%B91%2C200%20%26%20thanks');
  assert.equal(whatsappLink(null), null);
});

test('quantityWithUnit: plain English count words agree with the number; everything else stays as typed', () => {
  assert.equal(quantityWithUnit(32, 'piece'), '32 pieces');
  assert.equal(quantityWithUnit(1, 'piece'), '1 piece');
  assert.equal(quantityWithUnit(1, 'pieces'), '1 piece');
  assert.equal(quantityWithUnit(3, 'pieces'), '3 pieces');
  assert.equal(quantityWithUnit(2, 'box'), '2 boxes');
  assert.equal(quantityWithUnit(1, 'boxes'), '1 box');
  assert.equal(quantityWithUnit(4, 'patty'), '4 patties');
  assert.equal(quantityWithUnit(1, 'patties'), '1 patty');
  assert.equal(quantityWithUnit(2, 'glass'), '2 glasses');
  assert.equal(quantityWithUnit(1, 'glass'), '1 glass');
  assert.equal(quantityWithUnit(0.5, 'plate'), '0.5 plates');
  assert.equal(quantityWithUnit(2.25, 'kg'), '2.25 kg');
  assert.equal(quantityWithUnit(1.5, 'litre'), '1.5 litre');
  assert.equal(quantityWithUnit(500, 'g'), '500 g');
  assert.equal(quantityWithUnit(2, 'नग'), '2 नग');
  assert.equal(quantityWithUnit(2, 'small bowl'), '2 small bowl');
  assert.equal(quantityWithUnit(1 / 3, 'piece'), '0.333 pieces');
  assert.equal(quantityWithUnit(3, ''), '3');
  assert.equal(quantityWithUnit(3, null), '3');
});
