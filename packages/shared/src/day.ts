/** Pure functions behind the Today / Kitchen / Packing / Delivery screens. */
import type { MealSlot, OrderStatus } from './constants.ts';
import type { DayOrder } from './types.ts';

/** Orders the kitchen must cook/pack (not skipped, not cancelled, not failed). */
export const COOK_STATUSES: readonly OrderStatus[] = ['scheduled', 'delivered'];

export interface SlotSummary {
  meal_slot: MealSlot;
  total: number;                    // tiffins to cook
  veg: number;
  nonVeg: number;
  byType: { name: string; is_veg: boolean; count: number }[];
  addons: { name: string; qty: number }[];
  status: Record<OrderStatus, number>;
}

const emptyStatus = (): Record<OrderStatus, number> => ({
  scheduled: 0, delivered: 0, not_delivered: 0, skipped: 0, skipped_late: 0, cancelled_closure: 0,
});

export function summarizeDay(orders: readonly DayOrder[]): SlotSummary[] {
  const slots: MealSlot[] = ['lunch', 'dinner'];
  return slots.map((slot) => {
    const all = orders.filter((o) => o.meal_slot === slot);
    const cook = all.filter((o) => COOK_STATUSES.includes(o.status));
    const status = emptyStatus();
    for (const o of all) status[o.status] += 1;

    const types = new Map<string, { name: string; is_veg: boolean; count: number }>();
    const addons = new Map<string, number>();
    for (const o of cook) {
      const t = types.get(o.tiffin_type_id) ?? { name: o.tiffin_type_name, is_veg: o.is_veg, count: 0 };
      t.count += 1;
      types.set(o.tiffin_type_id, t);
      for (const a of o.addons) addons.set(a.name, (addons.get(a.name) ?? 0) + a.qty);
    }
    return {
      meal_slot: slot,
      total: cook.length,
      veg: cook.filter((o) => o.is_veg).length,
      nonVeg: cook.filter((o) => !o.is_veg).length,
      byType: [...types.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      addons: [...addons.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => a.name.localeCompare(b.name)),
      status,
    };
  });
}

export interface LocationGroup { location: string; orders: DayOrder[] }

/** Delivery list grouped by where the customer is today (place > ward), unknown last. */
export function groupByLocation(orders: readonly DayOrder[]): LocationGroup[] {
  const groups = new Map<string, DayOrder[]>();
  for (const o of orders) {
    const key = o.location_path ?? o.location_text ?? '';
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, list]) => ({
      location: key === '' ? 'Location not set' : key,
      orders: list.sort((x, y) => x.customer_name.localeCompare(y.customer_name)),
    }));
}

/** "Ward 5 (near reception)": the node path plus the customer's own note, when both exist. */
export function describeLocation(o: Pick<DayOrder, 'location_path' | 'location_text'>): string {
  if (o.location_path && o.location_text) return `${o.location_path} (${o.location_text})`;
  return o.location_path ?? o.location_text ?? 'Location not set';
}
